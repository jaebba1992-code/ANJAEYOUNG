const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const handlerSource = fs.readFileSync(path.join(__dirname, '../api/generate-cardnews.js'), 'utf8');
const photoSearch = () => ({ ok: true, json: async () => ({ results: [{ urls: { regular: 'https://images.example.test/photo.jpg' } }] }) });
const photoResponse = bytes => ({ ok: true, arrayBuffer: async () => Buffer.from(bytes) });

function createHarness(options = {}) {
  const requests = [];
  const imageInputs = [];
  const timers = new Set();
  const timerDelays = [];
  const font = {
    charToGlyph: () => ({ index: 1 }),
    getAdvanceWidth: (text, size) => text.length * size * 0.5,
    getPath: () => ({ commands: [] })
  };
  const sandbox = {
    module: { exports: {} },
    Buffer, AbortController,
    process: { env: { UNSPLASH_ACCESS_KEY: 'test-key' } },
    setTimeout(callback, delay) {
      const timer = { callback };
      timers.add(timer);
      timerDelays.push(delay);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    async fetch(url, init) {
      requests.push({ url, init });
      if (!options.fetch) throw new Error('Unexpected network request');
      return options.fetch(url, init, requests.length);
    },
    require(name) {
      if (name === './_auth') return { checkAppPassword: () => true };
      if (name === 'stream') return require('node:stream');
      if (name === 'opentype.js') return { parse: () => font };
      if (name.startsWith('./fonts/')) return '';
      if (name === 'sharp') return input => {
        const text = input.toString();
        imageInputs.push(text);
        let resized = false;
        let composited = false;
        const pipeline = {
          resize() { resized = true; return pipeline; },
          png() { return pipeline; },
          composite() { composited = true; return pipeline; },
          async toBuffer() {
            if (text === 'invalid-photo') throw new Error('Input buffer contains unsupported image format');
            if (composited) return Buffer.from('photo-composite');
            if (resized) return Buffer.from('resized-photo');
            return Buffer.from('png:' + text);
          }
        };
        return pipeline;
      };
      if (name === 'archiver') return () => {
        const archive = new EventEmitter();
        const entries = [];
        let destination;
        archive.pipe = stream => { destination = stream; };
        archive.append = buffer => { entries.push(buffer); };
        archive.finalize = async () => { destination.end(Buffer.concat(entries)); };
        return archive;
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(handlerSource, sandbox, { filename: 'api/generate-cardnews.js' });
  return {
    requests, imageInputs, timers, timerDelays,
    expireTimers() { for (const timer of [...timers]) timer.callback(); },
    async run(plan, body = {}) {
      const response = {
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }
      };
      await sandbox.module.exports({ method: 'POST', body: { plan, ...body }, headers: {} }, response);
      return response;
    }
  };
}

const plainCard = { type: 'darkText', title: 'Test card' };
const photoCard = { ...plainCard, photoQuery: 'hospital' };

test('rejects unsupported or malformed cards before rendering any part of the deck', async () => {
  for (const invalid of [null, {}, 'darkText', [], { type: 'unknown' }, { type: 'constructor' }, { type: 'toString' }]) {
    const harness = createHarness();
    const result = await harness.run([photoCard, invalid, plainCard]);
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /2번째/);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.imageInputs.length, 0);
  }
});

test('keeps the supported card count and image order, including the existing ten-card cap', async () => {
  const types = ['darkCover', 'darkText', 'lightText', 'caseFormula', 'compareBars', 'statBadge', 'twoColumn', 'ctaShare', 'outro'];
  const harness = createHarness();
  const result = await harness.run([...types.map(type => ({ type })), plainCard, plainCard]);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.count, 10);
  assert.equal(result.body.images.length, 10);
  assert.deepEqual(result.body.images.map(image => Buffer.from(image, 'base64').toString()), harness.imageInputs.map(svg => 'png:' + svg));
});

test('optional photo HTTP errors fall back to the same card background', async () => {
  const baseline = await createHarness().run([plainCard]);
  for (const failedStage of ['search', 'image']) {
    const harness = createHarness({
      fetch(url, init, number) {
        if (failedStage === 'image' && number === 1) return photoSearch();
        return {
          ok: false, status: 503,
          json: async () => { throw new Error('Must not parse failed search'); },
          arrayBuffer: async () => { throw new Error('Must not read failed image'); }
        };
      }
    });
    const result = await harness.run([photoCard]);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.images, baseline.body.images);
    assert.equal(harness.requests.length, failedStage === 'search' ? 1 : 2);
    assert.equal(harness.timers.size, 0);
  }
});

test('optional network and image decode failures preserve the card', async () => {
  const baseline = await createHarness().run([plainCard]);
  for (const failure of ['network', 'decode']) {
    const harness = createHarness({
      fetch(url, init, number) {
        if (failure === 'network') throw new Error('Connection reset');
        return number === 1 ? photoSearch() : photoResponse('invalid-photo');
      }
    });
    const result = await harness.run([photoCard]);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.images, baseline.body.images);
    assert.equal(harness.timers.size, 0);
  }
});

test('photo deadline covers both requests and their response bodies', async () => {
  const baseline = await createHarness().run([plainCard]);
  for (const stalledStage of ['search', 'search-body', 'image', 'image-body']) {
    let harness;
    const stall = signal => new Promise((resolve, reject) => {
      assert.ok(signal, 'photo request must have an abort signal');
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      queueMicrotask(() => harness.expireTimers());
    });
    harness = createHarness({
      fetch(url, init, number) {
        if (number === 1) {
          if (stalledStage === 'search') return stall(init.signal);
          if (stalledStage === 'search-body') return { ok: true, json: () => stall(init.signal) };
          return photoSearch();
        }
        if (stalledStage === 'image') return stall(init.signal);
        return { ok: true, arrayBuffer: () => stall(init.signal) };
      }
    });
    const result = await harness.run([photoCard]);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.images, baseline.body.images);
    assert.equal(harness.timerDelays.length, 1);
    assert.ok(harness.timerDelays[0] > 0 && harness.timerDelays[0] <= 5000);
    assert.ok(harness.requests.every(request => request.init.signal.aborted));
    assert.equal(harness.timers.size, 0);
  }
});

test('a valid fetched photo is composited without changing image order', async () => {
  const harness = createHarness({ fetch: (url, init, number) => number === 1 ? photoSearch() : photoResponse('valid-photo') });
  const result = await harness.run([photoCard, plainCard]);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.count, 2);
  assert.equal(Buffer.from(result.body.images[0], 'base64').toString(), 'photo-composite');
  assert.match(Buffer.from(result.body.images[1], 'base64').toString(), /^png:<svg/);
  assert.equal(harness.requests[0].init.signal, harness.requests[1].init.signal);
  assert.equal(harness.timers.size, 0);
});

test('an invalid uploaded cover reports an error instead of silently omitting the upload', async () => {
  const harness = createHarness();
  const result = await harness.run([{ type: 'darkCover', photoQuery: 'hospital' }], {
    coverPhotoBase64: Buffer.from('invalid-photo').toString('base64')
  });
  assert.equal(result.statusCode, 500);
  assert.match(result.body.error, /unsupported image format/);
  assert.equal(harness.requests.length, 0);
});

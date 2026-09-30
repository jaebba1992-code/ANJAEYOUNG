const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHandler(filename, globals) {
  const context = vm.createContext({ module: { exports: {} }, Buffer, URL, ...globals });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../api', filename), 'utf8'), context, { filename });
  return { handler: context.module.exports, context };
}

async function invoke(handler, body = {}, method = 'POST') {
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }
  };
  await handler({ method, headers: {}, body }, response);
  return response;
}

function createGenerateHarness(logMode = 'success', upstreamError = false) {
  const usageRows = [];
  const diagnostics = [];
  const timeouts = [];
  const signals = [];
  let abortEvents = 0;
  const { handler } = loadHandler('generate.js', {
    process: { env: { ANTHROPIC_API_KEY: 'mock-key' } },
    console: { error: (...args) => diagnostics.push(args) },
    AbortSignal: {
      timeout(duration) {
        timeouts.push(duration);
        const controller = new AbortController();
        signals.push(controller.signal);
        if (logMode === 'timeout') queueMicrotask(() => controller.abort(new Error('Usage log deadline')));
        return controller.signal;
      }
    },
    fetch: async () => ({
      ok: !upstreamError, status: upstreamError ? 429 : 200,
      json: async () => upstreamError ? { error: { message: 'Rate limited' } } : {
        content: [{ type: 'text', text: 'First' }, { type: 'tool_use', name: 'ignored' }, { type: 'text', text: 'Second' }],
        usage: { input_tokens: 100, output_tokens: 20 }
      }
    }),
    require(name) {
      if (name === './_auth') return { checkAppPassword: () => true };
      if (name === './_supabaseClient') return {
        getSupabase() {
          if (logMode === 'initialization') throw new Error('Logging database unavailable');
          return {
            from(table) {
              assert.equal(table, 'api_usage_log');
              return {
                insert(row) {
                  usageRows.push(JSON.parse(JSON.stringify(row)));
                  return {
                    abortSignal(signal) {
                      if (logMode === 'timeout') return new Promise((resolve, reject) => {
                        signal.addEventListener('abort', () => { abortEvents++; reject(signal.reason); }, { once: true });
                      });
                      if (logMode === 'rejection') return Promise.reject(new Error('Logging connection failed'));
                      return Promise.resolve({ error: logMode === 'returned-error' ? { message: 'Logging insert failed' } : null });
                    }
                  };
                }
              };
            }
          };
        }
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return { handler, usageRows, diagnostics, timeouts, signals, get abortEvents() { return abortEvents; } };
}

const generationRequest = { messages: [{ role: 'user', content: 'Test' }], visitor_name: 'Test visitor' };

test('generation still records successful usage and returns every text block', async () => {
  const harness = createGenerateHarness();
  const result = await invoke(harness.handler, generationRequest);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { text: 'First\nSecond' });
  assert.deepEqual(harness.timeouts, [3000]);
  assert.equal(harness.usageRows.length, 1);
  assert.equal(harness.usageRows[0].visitor_name, 'Test visitor');
  assert.equal(harness.usageRows[0].input_tokens, 100);
  assert.equal(harness.usageRows[0].output_tokens, 20);
  assert.equal(harness.diagnostics.length, 0);
});

test('returned errors, rejected inserts and missing logging configuration preserve generated text', async () => {
  for (const mode of ['returned-error', 'rejection', 'initialization']) {
    const harness = createGenerateHarness(mode);
    const result = await invoke(harness.handler, generationRequest);
    assert.equal(result.statusCode, 200, mode);
    assert.equal(result.body.text, 'First\nSecond', mode);
    assert.equal(harness.diagnostics.length, 1, mode);
    assert.equal(harness.diagnostics[0][0], 'usage log failed');
  }
});

test('a stalled usage insert receives the accelerated deadline abort and releases generated text', async () => {
  const harness = createGenerateHarness('timeout');
  const result = await invoke(harness.handler, generationRequest);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.text, 'First\nSecond');
  assert.deepEqual(harness.timeouts, [3000]);
  assert.equal(harness.signals[0].aborted, true);
  assert.equal(harness.abortEvents, 1);
  assert.equal(harness.diagnostics.length, 1);
});

test('upstream generation failure is returned without attempting a usage insert', async () => {
  const harness = createGenerateHarness('success', true);
  const result = await invoke(harness.handler, generationRequest);
  assert.equal(result.statusCode, 429);
  assert.equal(result.body.error, 'Rate limited');
  assert.equal(harness.usageRows.length, 0);
  assert.equal(harness.timeouts.length, 0);
});

const proposalModule = loadHandler('generate-proposal.js', {
  require(name) {
    if (name === './_auth') return { checkAppPassword: () => true };
    if (name === 'sharp') return () => { throw new Error('Unexpected image render in premium unit test'); };
    if (name === 'opentype.js') return { parse: () => ({}) };
    if (name.startsWith('./fonts/')) return '';
    throw new Error(`Unexpected dependency: ${name}`);
  }
});
const resolvePremiumSum = vm.runInContext('resolvePremiumSum', proposalModule.context);

test('premium addition handles plain integer won amounts and comma grouping', () => {
  for (const [input, expected] of [
    ['75,789원 + 42,220원', '118,009원'],
    ['1000 + 2000', '3,000원'],
    [' 1,000 원 + 2,000원 ', '3,000원'],
    ['0원 + 0원', '0원'],
    ['1 + 2 + 3', '6원']
  ]) assert.equal(resolvePremiumSum(input), expected, input);
});

test('unsupported premium units, malformed sums and unsafe integers retain the original value', () => {
  for (const input of [
    '7.5만원 + 4.2만원', '7만원 + 4만원', '100.5원 + 200원',
    '100 +', '+ 100', '100 ++ 200', '1,00원 + 2원',
    '보험사 100원 + 200원', '-100원 + 200원',
    '9007199254740992 + 1', '9007199254740991 + 1',
    '75,789원', '', null, 0
  ]) assert.equal(resolvePremiumSum(input), input, String(input));
});

function createBlogHarness() {
  const requests = [];
  const { handler } = loadHandler('fetch-blog-list.js', {
    require: name => {
      if (name === './_auth') return { checkAppPassword: () => true };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async url => {
      requests.push(url);
      const blogId = new URL(url).searchParams.get('blogId');
      return { ok: true, text: async () => `<a href="/${blogId}/123" title="Test post">Test post</a><a href="/${blogId}/123">Duplicate</a>` };
    }
  });
  return { handler, requests };
}

test('blog ID comes from the query before the path for desktop and mobile Naver URLs', async () => {
  for (const input of [
    ' agent_123 ',
    'https://blog.naver.com/agent_123',
    'https://m.blog.naver.com/agent_123/123',
    'https://blog.naver.com/PostList.naver?blogId=agent_123',
    'https://blog.naver.com/PostView.naver?blogId=agent_123&logNo=123',
    'https://m.blog.naver.com/PostView.naver?blogId=agent_123&logNo=123',
    'https://blog.naver.com/other_id?blogId=agent_123'
  ]) {
    const harness = createBlogHarness();
    const result = await invoke(harness.handler, { url: input });
    assert.equal(result.statusCode, 200, input);
    assert.equal(result.body.blogId, 'agent_123', input);
    assert.equal(result.body.posts.length, 1);
    assert.equal(result.body.posts[0].url, 'https://blog.naver.com/agent_123/123');
    assert.equal(new URL(harness.requests[0]).searchParams.get('blogId'), 'agent_123');
  }
});

test('invalid blog hosts, IDs and input types are rejected without fetching', async () => {
  for (const input of [
    '', 123, {}, [],
    'https://notblog.naver.com/agent_123',
    'https://blog.naver.com.example.test/agent_123',
    'https://example.test/agent_123',
    'https://blog.naver.com',
    'https://blog.naver.com/PostList.naver',
    'https://blog.naver.com/agent_123?blogId=bad%2Fid',
    'https://blog.naver.com/agent_123?blogId=a.*',
    'https://blog.naver.com/bad%20id'
  ]) {
    const harness = createBlogHarness();
    const result = await invoke(harness.handler, { url: input });
    assert.equal(result.statusCode, 400, JSON.stringify(input));
    assert.equal(harness.requests.length, 0);
  }
});

function createPptHarness() {
  const slides = [];
  let writes = 0;
  class Presentation {
    addSlide() {
      const slide = { texts: [], addText(value) { this.texts.push(value); }, addShape() {}, addTable() {} };
      slides.push(slide);
      return slide;
    }
    async write() { writes++; return Buffer.from('mock-pptx'); }
  }
  const { handler } = loadHandler('generate-pptx.js', {
    require(name) {
      if (name === './_auth') return { checkAppPassword: () => true };
      if (name === 'pptxgenjs') return Presentation;
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return { handler, slides, get writes() { return writes; } };
}

test('unsupported PPT items cannot create an empty or partially generated presentation', async () => {
  for (const invalid of [null, {}, [], 'hook', { type: 'unknown' }, { type: 'constructor' }, { type: 'toString' }]) {
    const harness = createPptHarness();
    const result = await invoke(harness.handler, { plan: [{ type: 'hook' }, invalid, { type: 'cta' }] });
    assert.equal(result.statusCode, 400);
    assert.equal(harness.slides.length, 0);
    assert.equal(harness.writes, 0);
  }
  const harness = createPptHarness();
  const result = await invoke(harness.handler, { plan: [{ type: 'unknown' }] });
  assert.equal(result.statusCode, 400);
  assert.equal(harness.writes, 0);
});

test('supported PPT types retain their count, order and selected palette', async () => {
  const types = ['hook', 'twoCompare', 'statHighlight', 'questionTransition', 'iconGrid', 'vsTransition', 'caseTable', 'summaryCards', 'cta'];
  const harness = createPptHarness();
  const result = await invoke(harness.handler, { plan: types.map(type => ({ type, title: type, text: type, top: type, question: type })), paletteName: '네이비골드' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.paletteUsed, '네이비골드');
  assert.equal(Buffer.from(result.body.base64, 'base64').toString(), 'mock-pptx');
  assert.equal(harness.slides.length, types.length);
  types.forEach((type, index) => {
    const text = harness.slides[index].texts.flatMap(value => Array.isArray(value) ? value.map(run => run.text) : [value]);
    assert.ok(text.includes(type), type);
  });
  assert.equal(harness.writes, 1);
});

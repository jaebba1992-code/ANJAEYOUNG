const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const handlerSource = fs.readFileSync(path.join(__dirname, '../api/sync-sheets.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function createHarness(options = {}) {
  const source = { id: 1, label: 'Test sheet', sheet_id: 'test-sheet', tab_name: null };
  const originalRows = [
    { source_file: source.label, page_number: 1, content: 'Previous page 1' },
    { source_file: source.label, page_number: 2, content: 'Previous page 2' },
    { source_file: 'Other sheet', page_number: 3, content: 'Keep other source' }
  ];
  let rows = copy(originalRows);
  const mutations = [];
  const reads = [];
  const errors = {
    upsert: [...(options.upsertErrors || [])],
    delete: [...(options.trimErrors || [])],
    update: [...(options.metadataErrors || [])]
  };

  const supabase = {
    from(table) {
      let operation;
      let payload;
      let upsertOptions;
      let single = false;
      const filters = [];
      const matches = row => filters.every(([kind, column, value]) =>
        kind === 'eq' ? row[column] === value : row[column] > value);
      const query = {
        select() { operation = 'select'; return query; },
        eq(column, value) { filters.push(['eq', column, value]); return query; },
        gt(column, value) { filters.push(['gt', column, value]); return query; },
        single() { single = true; return query; },
        upsert(value, settings) {
          operation = 'upsert'; payload = copy(value); upsertOptions = copy(settings);
          return query;
        },
        delete() { operation = 'delete'; return query; },
        update(value) { operation = 'update'; payload = copy(value); return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (operation === 'select' && table === 'sheet_sources') {
              return { data: single ? copy(source) : [copy(source)], error: null };
            }
            mutations.push({ table, operation, payload, options: upsertOptions, filters: copy(filters) });
            const error = errors[operation]?.shift();
            if (error) return { error: { message: error } };
            if (operation === 'upsert' && table === 'source_corpus') {
              for (const row of payload) {
                const index = rows.findIndex(existing => existing.source_file === row.source_file && existing.page_number === row.page_number);
                if (index === -1) rows.push(row);
                else rows[index] = row;
              }
            } else if (operation === 'delete' && table === 'source_corpus') {
              rows = rows.filter(row => !matches(row));
            } else if (operation !== 'update' || table !== 'sheet_sources') {
              throw new Error(`Unexpected database operation: ${table}.${operation}`);
            }
            return { error: null };
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  const sandbox = {
    module: { exports: {} },
    require(name) {
      if (name === './_supabaseClient') return { getSupabase: () => supabase };
      if (name === './_auth') return { checkAppPassword: () => true };
      if (name === './_googleAuth') return {
        getSheetsAccessToken: async () => 'mock-token',
        fetchSheetTitles: async () => options.tabs || ['One'],
        fetchSheetValues: async (sheetId, tabName) => {
          reads.push(tabName);
          return options.readTab ? options.readTab(tabName, reads.length) : [['Current content']];
        },
        sleep: async () => {}
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(handlerSource, sandbox, { filename: 'api/sync-sheets.js' });

  return {
    originalRows, mutations, reads,
    get rows() { return rows; },
    async run() {
      const response = {
        statusCode: null,
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = copy(value); return this; }
      };
      await sandbox.module.exports({ method: 'POST', body: { id: source.id }, headers: {} }, response);
      return response;
    }
  };
}

test('a failed tab preserves all prior content and reports the failure', async () => {
  const harness = createHarness({
    tabs: ['One', 'Two'],
    readTab(tabName) {
      if (tabName === 'Two') throw new Error('Google 503');
      return [['Updated first tab']];
    }
  });
  const result = await harness.run();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors[0].error, /Two.*Google 503/);
  assert.deepEqual(result.body.results, []);
  assert.deepEqual(harness.reads, ['One', 'Two', 'One', 'Two']);
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(harness.rows, harness.originalRows);
});

test('failed writes preserve previous content without deleting pages', async () => {
  const harness = createHarness({ upsertErrors: ['Write failed', 'Write failed'] });
  const result = await harness.run();
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors[0].error, /Write failed/);
  assert.deepEqual(harness.mutations.map(event => event.operation), ['upsert', 'upsert']);
  assert.deepEqual(harness.rows, harness.originalRows);
});

test('successful sync saves new content before trimming only obsolete pages from its source', async () => {
  const harness = createHarness();
  const result = await harness.run();
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.errors, []);
  assert.equal(result.body.results[0].pages, 1);
  assert.deepEqual(harness.mutations.map(event => event.operation), ['upsert', 'delete', 'update']);
  assert.deepEqual(harness.mutations[0].options, { onConflict: 'source_file,page_number' });
  assert.deepEqual(harness.mutations[1].filters, [['eq', 'source_file', 'Test sheet'], ['gt', 'page_number', 1]]);
  assert.equal(harness.rows.length, 2);
  assert.match(harness.rows[0].content, /Current content/);
  assert.deepEqual(harness.rows[1], harness.originalRows[2]);
  assert.ok(harness.mutations[2].payload.last_synced_at);
});

test('a transient tab read error recovers on retry before writing any data', async () => {
  const harness = createHarness({
    readTab(tabName, callCount) {
      if (callCount === 1) throw new Error('Transient error');
      return [['Recovered content']];
    }
  });
  const result = await harness.run();
  assert.equal(result.body.ok, true);
  assert.equal(harness.reads.length, 2);
  assert.deepEqual(harness.mutations.map(event => event.operation), ['upsert', 'delete', 'update']);
  assert.match(harness.rows[0].content, /Recovered content/);
});

test('failed cleanup is reported without recording a successful sync timestamp', async () => {
  const harness = createHarness({ trimErrors: ['Cleanup failed', 'Cleanup failed'] });
  const result = await harness.run();
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors[0].error, /Cleanup failed/);
  assert.equal(harness.mutations.some(event => event.operation === 'update'), false);
  assert.equal(harness.rows.some(row => row.content === 'Previous page 2'), true);
});

test('metadata write failures are reported instead of claiming sync success', async () => {
  const harness = createHarness({ metadataErrors: ['Metadata failed', 'Metadata failed'] });
  const result = await harness.run();
  assert.equal(result.body.ok, false);
  assert.match(result.body.errors[0].error, /Metadata failed/);
  assert.deepEqual(result.body.results, []);
});

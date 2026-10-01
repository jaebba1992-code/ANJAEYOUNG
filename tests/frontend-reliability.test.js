const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start}`);
  return html.slice(from, to);
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}
function load(source, globals) {
  const context = vm.createContext({ console: { error() {} }, ...globals });
  vm.runInContext(source, context);
  return context;
}

test('the complete inline application script parses', () => {
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

const sessionSource = sourceBetween('async function attemptSessionResume()', "document.getElementById('showRegisterLink')");
function sessionContext(fetch) {
  const localStorage = storage({ ins_user_token: 'existing-session' });
  const logins = [];
  return { ...load(sessionSource, { fetch, localStorage, enterAppAfterLogin: data => logins.push(data) }), logins };
}

for (const status of [500, 502, 503]) {
  test(`session resume retains the token after HTTP ${status}`, async () => {
    const app = sessionContext(async () => ({ ok: false, status }));
    assert.equal(await app.attemptSessionResume(), false);
    assert.equal(app.localStorage.getItem('ins_user_token'), 'existing-session');
    assert.equal(app.logins.length, 0);
  });
}
test('session resume retains the token after a network failure', async () => {
  const app = sessionContext(async () => { throw new TypeError('offline'); });
  assert.equal(await app.attemptSessionResume(), false);
  assert.equal(app.localStorage.getItem('ins_user_token'), 'existing-session');
});
test('session resume retains the token after an invalid successful response', async () => {
  const app = sessionContext(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON'); } }));
  assert.equal(await app.attemptSessionResume(), false);
  assert.equal(app.localStorage.getItem('ins_user_token'), 'existing-session');
});
test('session resume removes a rejected token even if the 401 body is invalid', async () => {
  const app = sessionContext(async () => ({ ok: false, status: 401, json: async () => { throw new SyntaxError('invalid JSON'); } }));
  assert.equal(await app.attemptSessionResume(), false);
  assert.equal(app.localStorage.getItem('ins_user_token'), null);
});
test('session resume enters the app with a valid session', async () => {
  const data = { ok: true, name: 'Test User' };
  const app = sessionContext(async () => ({ ok: true, status: 200, json: async () => data }));
  assert.equal(await app.attemptSessionResume(), true);
  assert.deepEqual(app.logins, [data]);
  assert.equal(app.localStorage.getItem('ins_user_token'), 'existing-session');
});

const claudeSource = sourceBetween('async function callClaude(', 'function intensityGuide(');
function generationContext(fetch) {
  return load(claudeSource, {
    fetch, AbortController, localStorage: storage(), authHeaders: () => ({}),
    setTimeout: (callback, ms) => { if (ms < 280000) queueMicrotask(callback); return 1; },
    clearTimeout() {}
  });
}
for (const status of [400, 401, 403, 404, 413, 422]) {
  test(`generation does not retry permanent HTTP ${status}`, async () => {
    let attempts = 0;
    const app = generationContext(async () => {
      attempts++;
      return { ok: false, status, json: async () => ({ error: `HTTP ${status}` }) };
    });
    await assert.rejects(app.callClaude('', []), new RegExp(`HTTP ${status}`));
    assert.equal(attempts, 1);
  });
}
for (const status of [408, 429, 500]) {
  test(`generation can recover by retrying HTTP ${status}`, async () => {
    let attempts = 0;
    const app = generationContext(async () => {
      attempts++;
      return attempts === 1
        ? { ok: false, status, json: async () => ({ error: 'temporary failure' }) }
        : { ok: true, status: 200, json: async () => ({ text: 'generated text' }) };
    });
    assert.equal(await app.callClaude('', []), 'generated text');
    assert.equal(attempts, 2);
  });
}
test('generation still avoids retrying an invalid server response', async () => {
  let attempts = 0;
  const app = generationContext(async () => {
    attempts++;
    return { ok: false, status: 502, json: async () => { throw new SyntaxError('HTML response'); } };
  });
  await assert.rejects(app.callClaude('', []), /서버 응답이 비정상/);
  assert.equal(attempts, 1);
});

test('blog rejects truncated output without retrying and still reports its usage', async () => {
  let attempts = 0; const usages = [];
  const app = generationContext(async () => {
    attempts++;
    return { ok: true, status: 200, json: async () => ({ text: 'unfinished', stop_reason: 'max_tokens', usage: { cost_usd: 0.01 } }) };
  });
  await assert.rejects(app.callClaude('', [], 2, null, 4500, null, { rejectTruncated: true, onUsage: usage => usages.push(usage) }), /출력 한도/);
  assert.equal(attempts, 1); assert.equal(usages[0].cost_usd, 0.01);
});

const historySource = sourceBetween('async function addToHistory(', 'async function deleteFromHistory(id)')
  + sourceBetween('function saveDraft(state)', 'function checkForDraft()')
  + sourceBetween('async function runLongFormChunks(state)', 'function addContinueButton(state');
function historyContext(apiPost, renderHistory = async () => {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '', querySelector: () => null });
    return nodes.get(id);
  };
  const buttons = [];
  const app = load(historySource, {
    apiPost, localStorage: storage({ ins_visitor_name: 'Test User' }),
    document: { getElementById: id => ['continueBtn', 'citeStamp', 'bundleBtn'].includes(id) ? null : node(id) },
    renderHistory, renderBlogHistory: async () => {}, renderCafeHistory: async () => {},
    renderRecoHistory: async () => {}, renderSearchHistory: async () => {}, renderPptHistory: async () => {},
    renderCardHistory: async () => {}, renderProposalHistory: async () => {}, renderComplianceCheck() {},
    addContinueButton: () => buttons.push('continue'), addBundleButton: () => buttons.push('bundle')
  });
  return { app, node, buttons };
}
const completedState = () => ({
  fullScript: 'The completed longform script must remain recoverable.',
  TARGET_CHARS: 1, chunkIndex: 1, MAX_CHUNKS: 1, coveredTopics: [],
  citeOn: false, historyId: 123, topic: 'Test topic', category: 'Test category'
});

test('longform keeps its draft until the history save succeeds', async () => {
  let finishSave;
  const { app, buttons } = historyContext(() => new Promise(resolve => { finishSave = resolve; }));
  const state = completedState();
  const completed = app.runLongFormChunks(state);
  assert.equal(JSON.parse(app.localStorage.getItem('ins_draft')).fullScript, state.fullScript);
  finishSave({ ok: true });
  await completed;
  assert.equal(app.localStorage.getItem('ins_draft'), null);
  assert.deepEqual(buttons, ['continue', 'bundle']);
});
test('longform retains its complete draft and displays a notice after save failure', async () => {
  const { app, node, buttons } = historyContext(async () => { throw new Error('offline'); });
  const state = completedState();
  await app.runLongFormChunks(state);
  const draft = JSON.parse(app.localStorage.getItem('ins_draft'));
  assert.equal(draft.fullScript, state.fullScript);
  assert.equal(draft.historyId, state.historyId);
  assert.match(node('progressText').textContent, /기록 저장에 실패/);
  assert.deepEqual(buttons, ['continue', 'bundle']);
});
test('a history list refresh failure does not misreport a successful save', async () => {
  const { app, node } = historyContext(async () => ({ ok: true }), async () => { throw new Error('render failed'); });
  await app.runLongFormChunks(completedState());
  assert.equal(app.localStorage.getItem('ins_draft'), null);
  assert.doesNotMatch(node('progressText').textContent, /기록 저장에 실패/);
});
test('a pending history refresh does not block longform completion after a successful save', { timeout: 1000 }, async () => {
  const { app, buttons } = historyContext(async () => ({ ok: true }), () => new Promise(() => {}));
  await app.runLongFormChunks(completedState());
  assert.equal(app.localStorage.getItem('ins_draft'), null);
  assert.deepEqual(buttons, ['continue', 'bundle']);
});
test('other history callers still wait for their list refresh by default', async () => {
  let finishRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  let settled = false;
  const { app } = historyContext(async () => ({ ok: true }), () => new Promise(resolve => {
    finishRefresh = resolve;
    refreshStarted();
  }));
  const saved = app.addToHistory({ script: 'test' }).then(result => { settled = true; return result; });
  await started;
  assert.equal(settled, false);
  finishRefresh();
  assert.equal(await saved, true);
});

const searchSource = sourceBetween('async function generateSearchAnswer()', "document.getElementById('searchGoBtn').addEventListener");
function searchContext(overrides = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, value: 'test question', textContent: '검색', innerHTML: '', disabled: false,
      children: [], appendChild(child) { this.children.push(child); }
    });
    return nodes.get(id);
  };
  const requests = { keywords: 0, generation: 0, history: [] };
  const app = load(searchSource, {
    document: { getElementById: node, createElement: () => ({ style: {}, innerHTML: '' }) },
    expandSearchKeywords: async () => { requests.keywords++; return 'test'; },
    refreshLibrary: async () => {}, recoLoaded: true, cachedReco: [], searchLibrary: () => [],
    searchCorpus: async () => [], WEB_SEARCH_TOOL: [], searchResponseTimes: [],
    callClaude: async () => { requests.generation++; return 'Test answer'; },
    tryParseContacts: () => null, renderAnswerHtml: text => text, extractQuote: () => null,
    addToHistory: async entry => { requests.history.push(entry); return true; },
    renderSearchHistory: async () => {}, refreshPageHeaderStats() {}, ...overrides
  });
  return { app, node, requests };
}
test('repeated search calls issue one keyword request and complete with one answer', async () => {
  let finishKeywords;
  const { app, node, requests } = searchContext();
  app.expandSearchKeywords = () => {
    requests.keywords++;
    return new Promise(resolve => { finishKeywords = resolve; });
  };
  const first = app.generateSearchAnswer();
  await app.generateSearchAnswer();
  assert.equal(requests.keywords, 1);
  assert.equal(node('searchGoBtn').disabled, true);
  finishKeywords('test');
  await first;
  assert.equal(requests.generation, 1);
  assert.equal(requests.history.length, 1);
  assert.equal(JSON.parse(requests.history[0].script).text, 'Test answer');
  assert.equal(node('searchResultBody').children[0].innerHTML, 'Test answer');
  assert.equal(node('searchGoBtn').disabled, false);
  assert.equal(node('searchGoBtn').textContent, '검색');
  assert.equal(node('searchSkeleton').style.display, 'none');
});
for (const preload of ['refreshLibrary', 'searchCorpus']) {
  test(`search restores controls when ${preload} fails before generation`, async () => {
    const { app, node, requests } = searchContext({
      [preload]: async () => { throw new Error('preload failed'); }
    });
    await app.generateSearchAnswer();
    assert.equal(requests.generation, 0);
    assert.equal(node('searchGoBtn').disabled, false);
    assert.equal(node('searchGoBtn').textContent, '검색');
    assert.equal(node('searchSkeleton').style.display, 'none');
    assert.equal(node('searchResultPanel').style.display, 'block');
    assert.match(node('searchResultBody').innerHTML, /preload failed/);
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../public/blog-research');
const { safeUrl, extractArticle, fetchHtml } = require('../api/blog-references')._test;

test('reference URLs reject internal hosts, credentials, deceptive domains and excessive links', () => {
  for (const url of ['http://blog.naver.com/a/1', 'https://127.0.0.1', 'https://blog.naver.com.evil.test/x', 'https://me@blog.naver.com/x', 'https://blog.naver.com:8443/x']) {
    assert.throws(() => safeUrl(url));
    assert.throws(() => research.links(url));
  }
  assert.equal(research.links('https://blog.naver.com/a/1\nhttps://blog.naver.com/a/1').length, 1);
  assert.throws(() => research.links(Array(6).fill('https://blog.naver.com/a/1').join('\n')));
});

test('extract only article body, respecting nested containers and removing scripts', () => {
  const body = '성조숙증 진단담보의 가입 조건을 확인하세요. '.repeat(8);
  const article = extractArticle('<title>참고 제목</title><nav>다른 보험</nav><div class="se-main-container"><div>' + body + '</div><script>악성 명령</script></div><footer>메뉴</footer>');
  assert.equal(article.rawTitle, '참고 제목');
  assert.ok(article.text.includes(body.trim()));
  assert.ok(!article.text.includes('메뉴') && !article.text.includes('악성'));
  assert.throws(() => extractArticle('<nav>' + body + '</nav>'));
  assert.throws(() => extractArticle('<div class="se-main-container">로그인 필요</div>'));
});

test('redirect destination is validated before a second network request', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { status: 302, headers: new Headers({ location: 'http://127.0.0.1/secret' }) }; };
  try {
    await assert.rejects(fetchHtml('https://blog.naver.com/a/1', new AbortController().signal));
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('model cannot add invented sources or accept quotes absent from the actual body', () => {
  const sources = [{ id: '자료1', title: '원문', url: 'https://blog.naver.com/a/1', text: '가입 전 약관에서 보장 개시 시점과 조건을 확인해야 합니다.' }];
  const result = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, reason: '관련', evidence: '5세부터 무조건 보장된다는 문장입니다.' }, { id: '가짜', use: true }], outline: ['가입 조건'] }), sources);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].used, false);
  assert.ok(!research.block(result).includes('무조건'));
  const accepted = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, reason: '관련', evidence: '약관에서 보장 개시 시점과 조건을 확인해야 합니다.' }], outline: ['가입 조건'] }), sources);
  assert.equal(accepted.sources[0].used, true);
  assert.ok(research.block(accepted).includes(sources[0].url));
});

test('duplicate source decisions are excluded rather than silently selecting one', () => {
  const source = { id: '자료1', text: '본문 근거가 충분히 길게 작성되어 있습니다.' };
  const row = { id: '자료1', use: true, evidence: source.text, reason: '관련' };
  assert.equal(research.analysis(JSON.stringify({ sources: [row, row], outline: [] }), [source]).sources[0].used, false);
});

test('relevant source is accepted through an existing passage ID without a verbatim model quote', () => {
  const sources = research.prepareSources([{ id: '자료1', text: '태아보험 뇌혈관질환진단담보의 필요성과 구성 방법을 설명합니다. 가입 전 약관의 보장 범위를 확인하세요.' }], '뇌혈관질환진단담보');
  const result = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, reason: '필요성과 구성 방법이 가입 전 확인에 관련됨', evidence_ids: ['문단1'] }], outline: ['담보 구성'] }), sources);
  assert.equal(result.sources[0].used, true);
  assert.ok(result.sources[0].evidence.includes('보장 범위'));
});

test('invented passage IDs are rejected and reported as verification failures, not unrelated sources', () => {
  const sources = research.prepareSources([{ id: '자료1', text: '태아보험 뇌혈관질환진단담보의 필요성과 구성 방법을 설명합니다.' }], '뇌혈관질환진단담보');
  const result = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, reason: '관련 있음', evidence_ids: ['문단999'] }], outline: [] }), sources);
  assert.equal(result.sources[0].used, false);
  assert.equal(result.sources[0].verificationFailed, true);
  assert.match(result.sources[0].reason, /주제는 관련/);
});

test('typographic punctuation differences do not reject an otherwise exact quote', () => {
  const source = { id: '자료1', text: '가입 전 ‘보장 범위’를 확인하고, 약관의 조건을 살펴보세요.' };
  const result = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, evidence: '가입 전 "보장 범위"를 확인하고 약관의 조건을 살펴보세요.' }], outline: [] }), [source]);
  assert.equal(result.sources[0].used, true);
});

test('quote normalization preserves decimal amounts and numeric condition separators', () => {
  const source = { id: '자료1', text: '보험료 예시는 월 1.5만원이며 조건을 반드시 확인해야 합니다.' };
  const result = research.analysis(JSON.stringify({ sources: [{ id: '자료1', use: true, evidence: '보험료 예시는 월 15만원이며 조건을 반드시 확인해야 합니다.' }], outline: [] }), [source]);
  assert.equal(result.sources[0].used, false);
});

function workflow(options = {}) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const start = html.indexOf('let blogState = null;');
  const script = html.slice(start, html.indexOf('// parses [이미지:', start));
  const elements = new Map(), calls = [];
  function element() { return { value: '', checked: false, style: {}, textContent: '', children: [], addEventListener(event, callback) { this.callback = callback; }, replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); } }; }
  function get(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
  get('blogKeyword').value = '태아보험 성조숙증담보';
  get('blogReferenceLinks').value = 'https://blog.naver.com/test/1';
  get('blogDirection').value = '가입 전 담보 확인';
  get('blogAnalyzeToggle').checked = true;
  get('blogResultBody').children = ['이전 글'];
  const body = '가입 전 약관에서 보장 개시 시점과 조건을 확인해야 합니다. '.repeat(8);
  vm.runInNewContext(script, {
    document: { getElementById: get, createElement: element }, BlogResearch: research,
    alert: message => calls.push(['alert', message]),
    apiGet: async () => { calls.push(['search']); throw Error('검색이 호출되면 안 됨'); },
    apiPost: async (url, data) => { calls.push(['read', data.url]); if (options.readFailure) throw Error('읽기 실패'); return { text: body, rawTitle: '담보 확인' }; },
    callClaude: async (system, messages, retries, tools, maxTokens, model) => {
      calls.push(['model', system, { retries, maxTokens, model }]);
      if (options.modelFailure) throw Error('모델 실패');
      if (system.includes('JSON만 출력')) return JSON.stringify({ sources: [{ id: '자료1', use: !options.unrelated, reason: '가입 조건 검토', evidence_ids: ['문단1'] }], outline: ['가입 조건', '확인 사항'] });
      return '완성된 글';
    },
    searchLibrary: () => [], searchCorpus: async () => [], complianceSystemBlock: () => '', salesSystemBlock: () => '[문의로 이어지는 구성]',
    renderComplianceCheck: () => {}, addToHistory: async () => !options.saveFailure,
    addBlogContinueButton: () => {}, Date, setInterval: () => 1, clearInterval: () => {}
  });
  return { get, calls, run: () => get('blogGenBtn').callback() };
}

test('repeating identical references skips reading and analysis; changing direction invalidates cache', async () => {
  const app = workflow(); await app.run(); await app.run();
  assert.equal(app.calls.filter(c => c[0] === 'read').length, 1);
  assert.equal(app.calls.filter(c => c[0] === 'model').length, 3);
  app.get('blogDirection').value = '보장 조건 비교'; await app.run();
  assert.equal(app.calls.filter(c => c[0] === 'read').length, 2);
  assert.equal(app.calls.filter(c => c[0] === 'model').length, 5);
});

test('blog calls use the economical model by default and do not retry billable generation', async () => {
  const app = workflow(); await app.run();
  for (const call of app.calls.filter(c => c[0] === 'model')) {
    assert.equal(call[2].model, 'claude-haiku-4-5-20251001');
    assert.equal(call[2].retries, 0);
  }
  app.get('blogQuality').value = 'precise'; await app.run();
  assert.equal(app.calls.filter(c => c[0] === 'model').at(-1)[2].model, 'claude-sonnet-4-6');
});

test('reference preparation bounds input and keeps relevant paragraphs with neighboring conditions', () => {
  const source = { text: '무관한 설명입니다.\n'.repeat(1000) + '성조숙증 담보의 가입 조건을 확인하세요.\n단, 상품별 약관과 보장 개시 시점은 다를 수 있습니다.\n' + '추가 설명입니다.\n'.repeat(1000) };
  const compact = research.prepareSources(Array(5).fill(source), '성조숙증 담보');
  assert.ok(compact.reduce((sum, s) => sum + s.text.length, 0) <= 18000);
  assert.ok(compact.every(s => s.excerpted && s.text.includes('상품별 약관')));
});

test('research cache expires and retains no more than two entries', () => {
  let time = 0; const cache = research.createCache(() => time);
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.equal(cache.get('a'), null); assert.equal(cache.get('b'), 2);
  time = 900000; assert.equal(cache.get('c'), null);
});

test('manual references bypass automatic search and feed only verified full body to writing', async () => {
  const app = workflow(); await app.run();
  assert.equal(app.calls.filter(c => c[0] === 'search').length, 0);
  assert.equal(app.calls.filter(c => c[0] === 'model').length, 2);
  assert.ok(app.calls.filter(c => c[0] === 'model')[1][1].includes('보장 개시 시점'));
  assert.equal(app.get('blogResultBody').children[0].textContent, '완성된 글');
  assert.equal(app.get('blogGenBtn').disabled, false);
});

for (const options of [{ readFailure: true }, { modelFailure: true }, { unrelated: true }]) {
  test('failed research keeps the prior draft and restores controls: ' + JSON.stringify(options), async () => {
    const app = workflow(options); await app.run();
    assert.deepEqual(app.get('blogResultBody').children, ['이전 글']);
    assert.equal(app.get('blogGenBtn').disabled, false);
    assert.ok(app.get('blogProgressText').textContent.startsWith('작성 중단:'));
    assert.ok(app.calls.filter(c => c[0] === 'model').length <= 1);
  });
}

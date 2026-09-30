const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/cardnews-engine');
const cards = () => [
  {type:'cover',title:'보험 서류, 이렇게 정리해요',body:'서류 이름보다 필요한 상황부터 살펴보세요.'},
  {type:'text',title:'필요한 자료를 먼저 확인',body:'가입한 상품의 안내문에서 제출할 자료를 확인하세요.'},
  {type:'list',title:'기록을 모아두세요',items:[{label:'진료 기록',text:'날짜와 진료 내용을 정리해요.'},{label:'납부 기록',text:'납부한 비용을 확인해요.'}]},
  {type:'compare',title:'자료의 역할을 구분해요',items:[{label:'진료 자료',text:'어떤 진료를 받았는지 확인해요.'},{label:'비용 자료',text:'어떤 비용을 냈는지 확인해요.'}]},
  {type:'stat',title:'두 가지를 기억하세요',value:'2가지',body:'자료를 확인하고 사본을 보관하세요.'},
  {type:'cta',title:'필요할 때 다시 찾아보세요',body:'가입한 상품별로 필요한 자료가 다를 수 있어요.',action:'자료 목록 저장하기'}
];
test('theme deck retains exact card order and count', () => {
  const d=engine.validateDeck({cards:cards()},6);
  assert.deepEqual(d.cards.map(c=>c.type),cards().map(c=>c.type));
  assert.throws(()=>engine.validateDeck({cards:cards().slice(0,5)},6),/장수/);
  assert.throws(()=>engine.validateDeck({cards:cards()},8),/장수/);
});
test('missing comparison data, empty stats and placeholders are rejected instead of dropped',()=>{
  assert.throws(()=>engine.validateCard({type:'compare',title:'비교',items:[{label:'A',text:'조건'}]}));
  assert.throws(()=>engine.validateCard({type:'stat',title:'숫자',body:'설명'}));
  assert.throws(()=>engine.validateCard({type:'text',title:'확인',body:'[확인 필요]'}));
  assert.throws(()=>engine.validateCard({type:'list',title:'목록',items:[{label:'빈 값',text:''}]}));
});
test('long text and missing cover/CTA are rejected',()=>{
  assert.throws(()=>engine.validateCard({type:'text',title:'가'.repeat(47),body:'본문'}));
  const d=cards();d[0].type='text';assert.throws(()=>engine.validateDeck({cards:d}));
  assert.throws(()=>engine.validateCard({type:'cta',title:'마지막',body:'안내'}));
});
test('all themes render escaped content and independent page/watermark markers',()=>{
  for(const key of Object.keys(engine.themes)) {
    const d=engine.validateDeck({version:3,cards:cards()});
    d.cards[1].title='<img src=x onerror=alert(1)>';
    const h=engine.renderDeck(d,key,'<보험즈>');
    assert.equal((h.match(/<section /g)||[]).length,6);
    assert.equal((h.match(/data-cn-watermark/g)||[]).length,6);
    assert.ok(h.includes('06 / 06'));
    assert.ok(!h.includes('<img'));
    assert.ok(h.includes('&lt;보험즈&gt;'));
  }
});
const source=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function app(overrides={}) {
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'original',disabled:false,hidden:false,style:{},scrollIntoView(){}});return nodes.get(id);};
  node('cnContentInput').value='자료';node('cnCardCountSelect').value='6';node('cnThemeSelect').value='A';node('cnWatermarkInput').value='보험즈';
  const context=vm.createContext({console,CardNews:engine,window:{__cnDeck:engine.validateDeck({cards:cards()}),__cnLastTheme:'A',__cnLastWatermark:'보험즈',__cnLastHistoryId:1},document:{getElementById:node},alert(){},parseJsonWithRepair:JSON.parse,callClaude:async()=>JSON.stringify({cards:cards()}),...overrides});
  const a=source.indexOf('let cnBusy = false;'),b=source.indexOf("document.getElementById('cnGenBtn').addEventListener",a);
  const c=source.indexOf('async function saveCnHistorySnapshot()'),d=source.indexOf('function renderCnPhotoControls()',c);
  vm.runInContext(source.slice(a,b)+'\n'+source.slice(c,d),context);
  context.prepareCnDeck=async()=>'<section>validated</section>';
  context.renderCnCardEditControls=()=>{};
  context.addToHistory=async()=>true;
  return {context,node};
}
test('invalid generation preserves old preview and unlocks all controls',async()=>{
  const {context:c,node}=app({callClaude:async()=>'{"cards":[]}'});
  await c.generateThemeCardNews();
  assert.equal(node('cnPreviewWrap').innerHTML,'original');
  assert.match(node('cnGenStatus').textContent,/실패/);
  assert.equal(node('cnGenBtn').disabled,false);
});
test('save failure is visible and retry keeps the same record identity',async()=>{
  const {context:c,node}=app(); const ids=[];
  c.addToHistory=async entry=>{ids.push(entry.id);return ids.length>1;};
  await c.generateThemeCardNews();
  assert.equal(node('cnRetrySaveBtn').hidden,false);
  assert.match(node('cnGenStatus').textContent,/저장에 실패/);
  assert.equal(await c.saveCnHistorySnapshot(),true);
  assert.equal(ids[0],ids[1]);assert.equal(node('cnRetrySaveBtn').hidden,true);
});
test('failed second card edit preserves the entire old deck',async()=>{
  let calls=0;
  const {context:c,node}=app({callClaude:async()=>{if(++calls===2)throw Error('offline');return JSON.stringify({...cards()[1],title:'수정됨'});}});
  const original=c.window.__cnDeck;
  await c.editCnCards([1,2],'쉬운 말',node('status'));
  assert.equal(c.window.__cnDeck,original);assert.equal(node('cnPreviewWrap').innerHTML,'original');
  assert.match(node('status').textContent,/원본을 모두 유지/);assert.equal(node('cnGenBtn').disabled,false);
});
test('overflowing candidate never replaces a valid current deck',async()=>{
  const {context:c,node}=app();c.prepareCnDeck=async()=>{throw Error('넘침');};
  await c.generateThemeCardNews();assert.equal(node('cnPreviewWrap').innerHTML,'original');assert.match(node('cnGenStatus').textContent,/넘침/);
});
test('double generation submits a single model request',async()=>{
  let release,calls=0;
  const {context:c}=app({callClaude:async()=>{calls++;await new Promise(r=>release=r);return JSON.stringify({cards:cards()});}});
  const first=c.generateThemeCardNews();await c.generateThemeCardNews();assert.equal(calls,1);release();await first;
});

test('saved version 2 decks retain their original renderer',()=>{
  const deck=engine.validateDeck({version:2,cards:cards()});
  assert.equal(deck.version,2);
  const html=engine.renderDeck(deck,'A','보험즈');
  assert.equal((html.match(/data-cn-card="2"/g)||[]).length,6);
  assert.ok(html.includes('font-size:86px'));
  assert.ok(!html.includes('data-cn-card="3"'));
});
test('new decks use reference title sizes, numeric emphasis and separate value fields',()=>{
  const d=cards();d[2].items=[{label:'조건',value:'두 가지 확인',text:'제출 자료 확인',detail:'사본 보관'},{label:'다음 단계',value:'기록 정리'}];
  d[4].value='148.1%';
  const deck=engine.validateDeck({cards:d});
  assert.equal(deck.version,4);
  const html=engine.renderDeck(deck,'A','보험즈');
  for(const content of ['두 가지 확인','제출 자료 확인','사본 보관','기록 정리']) assert.ok(html.includes(content));
  assert.ok(html.includes('font-size:112px'));assert.ok(html.includes('font-size:96px'));assert.ok(html.includes('font-size:228px'));
  assert.ok(html.includes('white-space:nowrap'));
});
test('highlight text is escaped and misplaced list content is rejected',()=>{
  const c={type:'text',title:'<strong> 예시',highlight:'<strong>',body:'본문'};
  const html=engine.renderCard(c,1,6);
  assert.ok(html.includes('&lt;strong&gt;'));assert.ok(!html.includes('<strong>'));
  assert.throws(()=>engine.validateCard({...c,highlight:'없는 문구'}));
  assert.throws(()=>engine.validateCard({...c,items:[{label:'누락 금지',text:'내용'}]}));
});
test('a layout correction can recover without shrinking the title below reference scale',async()=>{
  const {context:c,node}=app();let checks=0;
  c.prepareCnDeck=async()=>{if(++checks===1)throw Error('2번 카드 내용이 너무 길어요');return '<section>corrected</section>';};
  await c.generateThemeCardNews();
  assert.equal(checks,2);assert.equal(node('cnPreviewWrap').innerHTML,'<section>corrected</section>');
  assert.match(node('cnGenStatus').textContent,/완성/);
});

test('only six reference themes are offered and D falls back safely',()=>{
  assert.deepEqual(Object.keys(engine.themes),['A','B','C','E','F','G']);
  assert.ok(!source.match(/<select id="cnThemeSelect">[\s\S]*?<\/select>/)[0].includes('<option value="D">'));
  assert.equal(engine.renderCard(cards()[0],0,6,'D'),engine.renderCard(cards()[0],0,6,'A'));
  for(const theme of Object.keys(engine.themes)) assert.match(engine.renderCard(cards()[0],0,6,theme),/font-weight:900/);
});
test('publication maps insurers consistently and translates common English without changing figures',()=>{
  const d=cards(); d[0].title='AIA생명 달러연금';d[1].title='삼성생명 VS AIA';d[1].body='USD 150, 148.1% 확인';d[5].action='DM 문의';
  const deck=engine.prepareDeck({cards:d},6,'AIA생명과 삼성생명 비교');
  assert.equal(deck.cards[0].title,'A사 달러연금');
  assert.equal(deck.cards[1].title,'B사 비교 A사');
  assert.equal(deck.cards[1].body,'달러 150, 148.1% 확인');
  assert.equal(deck.cards[5].action,'개인 메시지 문의');
  for(const theme of Object.keys(engine.themes)) assert.doesNotMatch(engine.renderDeck(deck,theme,'보험즈'),/AIA|삼성생명|USD|DM/);
});
test('unknown English and real company watermark cannot be published',()=>{
  const d=cards();d[1].label='SPECIAL OFFER';
  assert.throws(()=>engine.prepareDeck({cards:d}),/한국어/);
  assert.throws(()=>engine.assertPublication('현대해상'),/익명/);
  assert.throws(()=>engine.assertPublication('@insurance'),/한국어/);
  assert.equal(engine.assertPublication('A사 안내'),'A사 안내');
});
test('company aliases reserve existing anonymous companies during edits',()=>{
  const d=cards();d[0].title='A사 안내';d[1].title='삼성생명 비교';
  const deck=engine.prepareDeck({cards:d},6,'A사 안내');
  assert.equal(deck.cards[1].title,'B사 비교');
});
test('English response retries and an English edit keeps the prior complete result',async()=>{
  let calls=0;const invalid=cards();invalid[0].label='SPECIAL';
  const {context:c,node}=app({callClaude:async()=>JSON.stringify({cards:++calls===1?invalid:cards()})});
  await c.generateThemeCardNews();assert.equal(calls,2);assert.match(node('cnGenStatus').textContent,/완성/);
  const original=c.window.__cnDeck;
  c.callClaude=async()=>JSON.stringify({...cards()[1],title:'SPECIAL'});
  await c.editCnCards([1],'수정',node('status'));
  assert.equal(c.window.__cnDeck,original);assert.match(node('status').textContent,/한국어/);
});

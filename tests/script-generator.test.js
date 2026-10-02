const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('public/index.html','utf8');
const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function setup(overrides={}){
 const nodes=new Map(),values=new Map(),calls=[],saved=[],bundles=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:true,disabled:false,style:{},innerHTML:'old result',textContent:'old label',children:[],parentNode:null,appendChild(child){child.parentNode=this;this.children.push(child);},querySelector(){return null;},remove(){this.parentNode=null;}});return nodes.get(id);}
 node('topic').value='태아보험 성조숙증 담보';node('category').value='어린이보험';node('tone').value='친근한 설명';node('source').value='가입 전 보장 개시일과 지급 조건을 약관에서 확인한다.';
 const c=vm.createContext({console,Date,setTimeout:f=>{f();return 1;},document:{getElementById:id=>['continueBtn','bundleBtn','citeStamp'].includes(id)?null:node(id),createElement:()=>node('created-'+Math.random()),querySelectorAll:()=>[]},localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)},format:'short',progressText:node('progressText'),searchLibrary:()=>[],searchCorpus:async()=>[],buildRecommendationBlock:async()=>'',findSalonScript:()=>'',baseSystem:()=>'',crossSourceInstructions:()=>'',alert(){},callClaude:async(...args)=>{calls.push(args);return '가입 전에 보장 개시일과 지급 조건을 확인하세요.';},buildResearchBlock:async()=>{throw Error('unexpected research');},addToHistory:async entry=>{saved.push(entry);return true;},renderComplianceCheck(){},window:{scrollTo(){}},...overrides});
 vm.runInContext(slice('function saveDraft(state)','function checkForDraft()')+slice('let scriptBusy = false;','const COMPLIANCE_PATTERNS'),c);
 c.addBundleButton=state=>bundles.push(state);c.addContinueButton=()=>{};
 return{c,node,calls,saved,bundles,values};
}
test('manual source short script uses one bounded request, no paid retries/search/automatic bundle',async()=>{
 const {c,node,calls,saved,bundles}=setup();await c.generateScript();assert.equal(calls.length,1);assert.equal(calls[0][2],0);assert.equal(calls[0][3],null);assert.equal(calls[0][6].rejectTruncated,true);assert.ok(calls[0][1][0].content.includes(node('source').value));assert.equal(saved.length,1);assert.equal(bundles.length,1);assert.equal(node('genBtn').disabled,false);
});
test('source retrieval errors preserve previous script and unlock generation',async()=>{
 const{c,node}=setup({searchCorpus:async()=>{throw Error('source unavailable');}});await c.generateScript();assert.equal(node('resultBody').innerHTML,'old result');assert.equal(node('resultLabel').textContent,'old label');assert.equal(node('genBtn').disabled,false);assert.match(node('progressText').textContent,/source unavailable/);
});
test('double click cannot send duplicate paid generation requests',async()=>{
 let release,calls=0;const{c}=setup({callClaude:async()=>{calls++;await new Promise(r=>release=r);return '보장 조건을 확인하세요.';}});const pending=c.generateScript();await new Promise(r=>setImmediate(r));await c.generateScript();assert.equal(calls,1);release();await pending;
});
test('empty short response preserves old output and does not save a false result',async()=>{
 const{c,node,saved,bundles}=setup({callClaude:async()=>''});await c.generateScript();assert.equal(node('resultBody').innerHTML,'old result');assert.equal(saved.length,0);assert.equal(bundles.length,0);assert.equal(node('genBtn').disabled,false);
});
test('short history failure is visible and leaves the finished script available',async()=>{
 const{c,node}=setup({addToHistory:async()=>false});await c.generateScript();assert.match(node('progressText').textContent,/기록 저장에 실패/);assert.ok(node('resultBody').children.length);assert.equal(node('genBtn').disabled,false);
});
test('long script reaching target must still request closing and cannot silently end at body',async()=>{
 const{c,node,calls,saved}=setup();const state={fullScript:'본론 내용'.repeat(30),TARGET_CHARS:100,chunkIndex:2,MAX_CHUNKS:4,coveredTopics:[],scriptDiv:node('script'),contextLine:'주제',longSystem:'근거 자료',historyId:1,hasClosing:false};await c.runLongFormChunks(state);assert.equal(calls.length,1);assert.match(calls[0][1][0].content,/마무리해줘/);assert.equal(calls[0][2],0);assert.equal(calls[0][6].rejectTruncated,true);assert.equal(state.hasClosing,true);assert.equal(saved.length,1);
});
test('long request failure keeps partial text and full source context in recovery draft',async()=>{
 const{c,node,values,saved}=setup({callClaude:async()=>{throw Error('output truncated');}});const state={fullScript:'기존 본문',TARGET_CHARS:100,chunkIndex:1,MAX_CHUNKS:4,coveredTopics:[],scriptDiv:node('script'),contextLine:'원래 주제',longSystem:'원래 근거 자료',model:'claude-haiku-4-5-20251001',historyId:1};await c.runLongFormChunks(state);const draft=JSON.parse(values.get('ins_draft'));assert.equal(draft.fullScript,'기존 본문');assert.equal(draft.longSystem,'원래 근거 자료');assert.equal(draft.model,state.model);assert.equal(state.chunkIndex,1);assert.equal(saved.length,0);
});
test('chunk limit does not mark unfinished conclusion complete or clear recovery draft',async()=>{
 const{c,node,values,saved}=setup();await c.runLongFormChunks({fullScript:'본론',TARGET_CHARS:100,chunkIndex:4,MAX_CHUNKS:4,coveredTopics:[],historyId:1});assert.match(node('progressText').textContent,/결론은 아직 완성되지/);assert.equal(saved.length,0);assert.ok(values.get('ins_draft'));
});
test('draft resume restores original research, model and requested target',async()=>{
 const{c,values}=setup();values.set('ins_draft',JSON.stringify({fullScript:'진행 중 본문',topic:'원래 주제',contextLine:'저장된 맥락',longSystem:'저장된 실제 근거',TARGET_CHARS:10500,MAX_CHUNKS:10,chunkIndex:3,model:'claude-haiku-4-5-20251001'}));vm.runInContext(slice('async function resumeFromDraft()','async function resumeFromHistoryEntry'),c);let resumed;c.runLongFormChunks=async state=>{resumed=state;};await c.resumeFromDraft();assert.equal(resumed.longSystem,'저장된 실제 근거');assert.equal(resumed.contextLine,'저장된 맥락');assert.equal(resumed.model,'claude-haiku-4-5-20251001');assert.equal(resumed.TARGET_CHARS,10500);
});
test('search toggle off and economical mode are honored by the actual generation flow',async()=>{
 const{c,node,calls}=setup();node('source').value='';node('scriptWebSearch').checked=false;node('scriptModel').value='claude-haiku-4-5-20251001';await c.generateScript();assert.equal(calls.length,1);assert.equal(calls[0][5],'claude-haiku-4-5-20251001');assert.equal(calls[0][3],null);
});
test('registered product context is limited to four related entries instead of all sixty',async()=>{
 const{c}=setup();c.normalizeForSearch=s=>String(s).replace(/\s/g,'').toLowerCase();c.apiGet=async()=>({items:[{category:'어린이보험',product_name:'성조숙증 담보',reason:'조건 확인'},...Array.from({length:60},(_,i)=>({category:'자동차보험',product_name:'자동차'+i,reason:'x'.repeat(10000)}))]});vm.runInContext(slice('async function buildRecommendationBlock','function findSalonScript'),c);const block=await c.buildRecommendationBlock('성조숙증','어린이보험');assert.ok(block.includes('성조숙증'));assert.ok(!block.includes('자동차'));assert.ok(block.length<3000);
});

test('default long form completes hook through closing in exactly one paid writing request',async()=>{
 const {c,node,calls,saved}=setup({format:'long'});await c.generateScript();assert.equal(calls.length,1);assert.match(calls[0][1][0].content,/후킹부터 클로징까지/);assert.equal(calls[0][4],6500);assert.equal(calls[0][2],0);assert.equal(saved.length,1);assert.equal(saved[0].format,'long');assert.match(node('progressText').textContent,/완료/);
});
test('failed single pass keeps old result and does not save an unfinished script',async()=>{
 const {c,node,calls,saved}=setup({format:'long',callClaude:async()=>{throw Error('truncated');}});await c.generateScript();assert.equal(saved.length,0);assert.equal(node('resultBody').innerHTML,'old result');assert.match(node('progressText').textContent,/truncated/);assert.equal(node('genBtn').disabled,false);
});
test('concise shared conversion policy prohibits invented services and preserves factual closing',()=>{
 const c=vm.createContext({intensityGuide:()=> '보통'});vm.runInContext(slice('function salesSystemBlock','function baseSystem'),c);const policy=c.salesSystemBlock();assert.ok(policy.length<1400);assert.match(policy,/기:.*고객 상황/);assert.match(policy,/결:.*한 가지 행동/);assert.match(policy,/서비스.*강점만/);assert.match(policy,/지어내지 않는다/);
});

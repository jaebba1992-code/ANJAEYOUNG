(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UploadEngine=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
function inspectText(input){
 const text=String(input||'').trim();
 const foreign=c=>/[\p{L}\p{N}]/u.test(c)&&!/[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}0-9]/u.test(c);
 let bad=0;for(const c of text)if(c==='\ufffd'||/[\uE000-\uF8FF]/u.test(c)||foreign(c))bad++;
 const body=text.replace(/상품 관련 자세한 사항은 반드시[^.]*?바랍니다\.?/g,'').replace(/본 자료는 모집인 교육[^.]*?없습니다\.?/g,'').replace(/[“"]AIA confidential[^”"]*[”"]/g,'').replace(/준법감시인 확인필[^)]+\)/g,'').replace(/판매인교육용|고객제시불가/g,'');
 const meaningful=(body.match(/[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}0-9]/gu)||[]).length;
 const needsOcr=meaningful<20||bad>=8||bad/Math.max(meaningful,1)>.1;
 // Never invent replacements for corrupt glyphs; preserve an explicit gap.
 let cleaned='',gap=false;for(const c of text){if(c==='\ufffd'||/[\uE000-\uF8FF]/u.test(c)||foreign(c)){if(!gap)cleaned+='[문자 깨짐]';gap=true;}else{cleaned+=c;gap=false;}}
 return{cleaned,bad,needsOcr};
}
function splitNewsletters(raw,limit=6000){
 const documents=String(raw||'').split(/(?=^--- .+ 추출 내용.*---\s*$)/m).filter(x=>x.trim());const batches=[];
 for(const doc of documents){const name=(doc.match(/^--- (.+?) 추출 내용/m)||[])[1]||'붙여넣은 자료';const units=doc.split(/(?=^\[(?:p\.\d+|슬라이드 \d+)[^\]]*\])/m);let text='';
 const flush=()=>{if(text.trim())batches.push({name,text:text.trim()});text='';};
 for(let unit of units){if(text.length+unit.length>limit)flush();while(unit.length>limit){batches.push({name,text:unit.slice(0,limit)});unit=unit.slice(limit-400);}text+=unit;}flush();}
 return batches;
}
function parseItems(raw){let items;try{items=JSON.parse(String(raw).replace(/```json|```/g,'').trim());}catch(e){throw Error('항목 응답이 JSON 형식으로 완성되지 않았어요. 이 구간만 다시 시도해주세요.');}
 if(!Array.isArray(items)||!items.every(it=>it&&['insurer','product_name','category','reason'].every(k=>typeof it[k]==='string')))throw Error('상품 항목 형식이 올바르지 않아요.');return items;
}
async function runBatches(batches, work, concurrency=2){
 let cursor=0,failure;
 const worker=async()=>{while(!failure&&cursor<batches.length){const i=cursor++;try{await work(batches[i],i);}catch(e){failure=failure||e;}}};
 await Promise.all(Array.from({length:Math.min(concurrency,batches.length)},worker));
 if(failure)throw failure;
}
return{inspectText,splitNewsletters,parseItems,runBatches};
});

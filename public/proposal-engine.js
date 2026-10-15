(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProposalEngine=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const categories=['기본계약','진단비','치료비','수술비','상해관련','간병','기타'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parseWon(value,unit){
 let s=String(value??'').replace(/[\s,]/g,'');if(!s)return null;
 if(/^\d+(?:\.\d+)?$/.test(s)){if(!['원','만원'].includes(unit))return null;return Math.round(Number(s)*(unit==='만원'?10000:1));}
 s=s.replace(/^가입(?=\d)/,'').replace(/원$/,'');if(!/^[\d.억만천백십]+$/.test(s))return null;
 let sum=0,section=0,pos=0,lastBig=Infinity,lastSmall=Infinity;const re=/(\d+(?:\.\d+)?)?([억만천백십])|(\d+(?:\.\d+)?)/g;let m;
 while((m=re.exec(s))){if(m.index!==pos)return null;pos=re.lastIndex;const u=m[2],n=Number(m[1]??m[3]??1);
 if(u==='억'||u==='만'){const factor=u==='억'?1e8:1e4;if(factor>=lastBig)return null;lastBig=factor;sum+=(section+(m[1]===undefined&&section?0:n))*factor;section=0;lastSmall=Infinity;}
 else if(u){const factor={천:1000,백:100,십:10}[u];if(factor>=lastSmall)return null;lastSmall=factor;section+=n*factor;}else section+=n;}
 const won=sum+section;return pos===s.length&&Number.isSafeInteger(Math.round(won))?Math.round(won):null;
}
function formatWon(won){return (won/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'만원';}
function formatAmount(value,unit){if(value==null||String(value).trim()==='')return '';const n=parseWon(value,unit);return n===null?'금액 확인 필요':formatWon(n);}
function cleanFactory(data){const names=[...(String(data.carriers||'').split(/[+,·]/)), 'NH농협손해보험','농협손해보험','농협손해','KB손해보험','KB손해','DB손해보험','DB손해','삼성화재','현대해상','메리츠화재','한화손해보험','흥국화재','롯데손해보험','AIA생명','흥국생명','삼성생명','한화생명','교보생명'].map(s=>s.trim()).filter(s=>s.length>1).sort((a,b)=>b.length-a.length);return value=>{let s=String(value??'');for(const name of names)s=s.split(name).join('');return s.replace(/\s*\+\s*(?=\+|$)/g,'').replace(/^\s*\+\s*/,'').trim();};}
function benefitKind(label){const name=String(label||'').replace(/\s/g,'');return /납입면제/.test(name)?'납입면제':/납입지원/.test(name)?'납입지원':'';}
function premiumSummary(data,index){
 const contracts=(data.contracts||[]).filter(c=>(c.planIndex??0)===index);
 if(contracts.length)return contracts.map((c,i)=>`${c.insurer||'보험사 확인 필요'} ${Number(c.premiumWon).toLocaleString('ko-KR')}원`).join(' + ') + ` = 총 ${contracts.reduce((n,c)=>n+Number(c.premiumWon),0).toLocaleString('ko-KR')}원`;
 return data.premiumBreakdown?.[index]||'';
}
function normalizeData(data){
 const clean=cleanFactory(data);const labels=(data.designLabels?.length?data.designLabels:['설계안']).map((x,i)=>clean(x)||`설계안 ${i+1}`);
 const rawRows=(data.rows||[]).flatMap(r=>r.benefitDetails||[r]);
 const rows=rawRows.map((r,i)=>{const kind=benefitKind(r.label);return {...r,no:i+1,label:kind||clean(r.label),term:clean(r.term),highlightNote:clean(r.highlightNote),note:clean(r.note).replace(/原本|원본\s*\d+\s*(?:·\s*)?/g,'').trim(),amounts:(Array.isArray(r.amounts)?r.amounts:[r.amount??'']).map(a=>formatAmount(a,r.amountUnit)),category:kind||/(?:상해|질병).*(?:사망|후유장해)/.test(r.label||'')?'기본계약':categories.includes(r.category)?r.category:'기타'};});
 const merged=[];
 for(const r of rows){const kind=benefitKind(r.label);if(!kind){merged.push(r);continue;}let group=merged.find(x=>x.label===kind&&x.benefitDetails);if(!group){group={...r,label:kind,category:'기본계약',benefitDetails:[]};merged.push(group);}group.benefitDetails.push(r);}
 for(const r of merged.filter(x=>x.benefitDetails)){
  const terms=[...new Set(r.benefitDetails.map(x=>x.term).filter(Boolean))];r.term=terms.length===1?terms[0]:'계약별 상이';
  r.amounts=labels.map((_,i)=>{const values=[...new Set(r.benefitDetails.map(x=>x.amounts[i]).filter(Boolean))];return values.length? r.label==='납입면제'?'가입':values.join('\n'):'';});
  r.highlightStar=r.benefitDetails.some(x=>x.highlightStar);r.note=terms.length>1?terms.join(' · '):'';r.highlightNote=r.label==='납입면제'?'적용 조건은 계약별 약관 기준':'계약별 지원 기준 · 합산 금액 아님';
 }
 const contracts=(data.contracts||[]).map(c=>({...c,premiumWon:typeof c.premiumWon==='number'?c.premiumWon:parseWon(c.premium,'원')})).filter(c=>Number.isSafeInteger(c.premiumWon)&&c.premiumWon>=0);
 const normalized={...data,title:clean(data.title)||'맞춤 설계 제안서',carriers:contracts.length?[...new Set(contracts.map(c=>c.insurer).filter(Boolean))].join(' + '):String(data.carriers||''),contracts,designLabels:labels,rows:[...merged.filter(r=>!r.benefitDetails),...merged.filter(r=>r.benefitDetails)]};
 normalized.premiumBreakdown=labels.map((_,i)=>premiumSummary(normalized,i));
 normalized.premiums=labels.map((_,i)=>{const own=contracts.filter(c=>(c.planIndex??0)===i);return own.length?own.reduce((n,c)=>n+c.premiumWon,0).toLocaleString('ko-KR')+'원':data.premiums?.[i]||'';});
 return normalized;
}
function extractedPlan(parsed,index,count){
 if(!Array.isArray(parsed.rows)||!parsed.rows.length)throw Error('담보를 읽지 못했어요. 원본을 더 선명하게 첨부해주세요.');
 if(!Array.isArray(parsed.sourceCounts)||!parsed.sourceCounts.length)throw Error('원본별 담보 수 확인이 빠졌어요. 다시 분석해주세요.');
 for(const source of parsed.sourceCounts){const got=parsed.rows.filter(r=>r.sourcePage===source.page).length;if(!Number.isInteger(source.count)||got!==source.count)throw Error(`원본 ${source.page}페이지 담보 수가 일치하지 않아요. 누락 여부를 확인해주세요.`);}
 if(parsed.rows.some(r=>!parsed.sourceCounts.some(s=>s.page===r.sourcePage)))throw Error('출처를 확인할 수 없는 담보가 있어요.');
 const rows=parsed.rows.map(r=>{if(typeof r.label!=='string'||!r.label.trim())throw Error('담보명이 비어 있어요.');const value=formatAmount(r.amount,r.amountUnit);if(value==='금액 확인 필요')throw Error('가입금액 또는 단위가 불명확해요. 원본 금액을 확인해주세요.');const amounts=Array(count).fill('');amounts[index]=value;return {...r,note:'',amounts,amountUnit:undefined};});
 let premium=null;if(Array.isArray(parsed.contracts)&&parsed.contracts.length){const keys=new Set();premium=0;for(const c of parsed.contracts){if(!c.key||keys.has(c.key))throw Error('보험료 계약 구분이 중복되거나 불명확해요.');keys.add(c.key);const n=parseWon(c.premium,'원');if(n===null)throw Error('월 보험료를 확인할 수 없어요.');premium+=n;}}
 return{rows,contracts:(parsed.contracts||[]).map(c=>({...c,planIndex:index,premiumWon:parseWon(c.premium,'원')})),premium:premium===null?'':premium.toLocaleString('ko-KR')+'원'};
}
function renderDocument(input,accentKey='B',palette){
 const d=normalizeData(input);const colors={A:'#5c1524',B:'#17324f',C:'#23473b',D:'#594278',E:'#72512d'};const dark=/^#[0-9a-f]{6}$/i.test(palette?.dark||'')?palette.dark:colors[accentKey]||colors.B;const n=d.designLabels.length;
 let sections='',rowNo=0,sectionNo=0;
 for(const category of categories){const rows=d.rows.filter(r=>r.category===category);if(!rows.length)continue;sectionNo++;
 sections+=`<tr class="section"><th colspan="${4+n}"><span>${String(sectionNo).padStart(2,'0')}</span> ${esc(category)}</th></tr>`;
 for(const r of rows){rowNo++;sections+=`<tr class="${r.highlightStar?'highlight':''}"><td class="num">${rowNo}</td><td class="label">${esc(r.label)}</td><td>${esc(r.term)}</td>${d.designLabels.map((_,i)=>`<td class="amount">${esc(r.amounts[i]||'')}</td>`).join('')}<td class="note">${esc([r.note,r.highlightNote].filter(Boolean).join(' · '))}</td></tr>`;}}
 const premiumDetails=d.designLabels.map((label,i)=>`<div class="premium-detail"><strong>${esc(n>1?label+' · ':'' )}보험료 구성</strong><p>${esc(premiumSummary(d,i)||'보험사별 보험료 내역 확인 필요')}</p></div>`).join('');
 const premiumCards=d.designLabels.map((label,i)=>`<div class="premium"><small>${esc(label)} · 월 보험료</small><strong>${esc(d.premiums?.[i]||'확인 필요')}</strong></div>`).join('');
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>
 *{box-sizing:border-box}body{margin:0;background:#fff;color:#252b33;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:12px}.proposal{width:794px;max-width:100%;margin:auto;background:#fff}header{background:${dark};color:white;padding:32px 36px;display:flex;align-items:center;justify-content:space-between;gap:20px}h1{font-size:27px;margin:8px 0 12px;line-height:1.35}header p{font-size:12px;opacity:.85;margin:0}header .premium{border:1px solid #ffffff50;min-width:150px;padding:15px}small{display:block}.premium strong{display:block;font-size:24px;margin-top:8px;white-space:nowrap}.summary{padding:13px 36px;background:#f5f1f2;color:${dark};font-weight:bold}main{padding:24px 36px}h2{font-size:18px;margin:0 0 14px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead th{padding:10px 5px;border-top:2px solid ${dark};border-bottom:1px solid #cdd0d5;color:#59616e;font-size:11px;text-align:left}td{padding:12px 5px;border-bottom:1px solid #e8e9ec;vertical-align:top;line-height:1.65;overflow-wrap:anywhere;word-break:keep-all}.num{color:#8d939e}.label{font-weight:700}.amount{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:pre-line;font-size:12px}.note{color:#69717b;font-size:10px}.section th{text-align:left;padding:20px 0 9px;color:${dark};border-bottom:1px solid ${dark};font-size:13px}.section span{font-size:20px;opacity:.35;margin-right:8px}.highlight{background:#f8f4f5}.highlight .label,.highlight .amount{color:${dark}}.premium-detail{border:1px solid #dedfe4;border-left:3px solid ${dark};padding:14px 18px;margin:0 0 20px;line-height:1.7}.premium-detail p{margin:6px 0 0;font-variant-numeric:tabular-nums;font-size:13px}.bottom{display:flex;gap:20px;flex-wrap:wrap;border:1px solid #d6d9df;padding:18px;margin-top:25px}.bottom .premium{flex:1}footer{margin-top:24px;border-top:1px solid #d6d9df;padding-top:15px;font-size:10px;color:#747b85;line-height:1.8}thead{display:table-header-group}tr{break-inside:avoid} @page{size:A4;margin:10mm} @media print{.proposal{width:100%}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
 </style><body><article class="proposal"><header><div><p>고객 맞춤 보장 설계</p><h1>${esc(d.title)}</h1><p>${esc(d.agentName||'')}</p></div><div>${premiumCards}</div></header><div class="summary">보장 항목 ${d.rows.length}개 · 가입금액 단위: 만원 · 납입면제·지원은 묶음 표시</div><main>${premiumDetails}<h2>담보 구성</h2><table><colgroup><col style="width:5%"><col style="width:${n>1?27:31}%"><col style="width:22%">${d.designLabels.map(()=>`<col style="width:${n>1?15:18}%">`).join('')}<col></colgroup><thead><tr><th>번호</th><th>담보명</th><th>납기 · 만기</th>${d.designLabels.map(l=>`<th style="text-align:right">${n>1?esc(l)+' ':''}가입금액</th>`).join('')}<th>비고</th></tr></thead><tbody>${sections}</tbody></table><div class="bottom">${premiumCards}</div><footer>본 제안서는 참고용이며 실제 지급 기준은 해당 상품 약관에 따릅니다.<br>서로 다른 계약·만기·지급 조건은 임의로 합산하지 않았습니다. 원본의 담보와 금액을 대조해 주세요.<br>담당 ${esc(d.agentName||'')}</footer></main></article></body></html>`;
}
return{parseWon,formatWon,formatAmount,normalizeData,extractedPlan,renderDocument,premiumSummary};
});

const { checkAppPassword } = require('./_auth');
const sharp = require('sharp');
const opentype = require('opentype.js');

const CW = 1200; // 캔버스 폭 고정, 높이는 내용에 따라 동적으로 계산

/* ================= 폰트: 텍스트를 벡터 경로(도형)로 직접 그린다 =================
   generate-cardnews.js와 동일한 방식 — SVG @font-face는 서버리스 환경(librsvg)에
   따라 지원 여부가 갈려서 실제로 깨지는 사례가 있었기 때문에, opentype.js로 글자
   하나하나를 <path>(벡터 도형)로 직접 그린다. 렌더링 서버에 폰트가 설치되어
   있는지와 완전히 무관하게 항상 100% 동일하게 나온다. */
const FONT_REGULAR_B64 = require('./fonts/notosans-regular.b64.js');
const FONT_BOLD_B64 = require('./fonts/notosans-bold.b64.js');
const FONT_EXTRABOLD_B64 = require('./fonts/notosans-black.b64.js');

function b64ToArrayBuffer(b64) {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const FONT_REGULAR = opentype.parse(b64ToArrayBuffer(FONT_REGULAR_B64));
const FONT_BOLD = opentype.parse(b64ToArrayBuffer(FONT_BOLD_B64));
const FONT_EXTRABOLD = opentype.parse(b64ToArrayBuffer(FONT_EXTRABOLD_B64));

function pickFont(weight) {
  if (weight >= 800) return FONT_EXTRABOLD;
  if (weight >= 700) return FONT_BOLD;
  return FONT_REGULAR;
}

function sanitizeForFont(text) {
  return String(text == null ? '' : text)
    .replace(/→/g, '-')
    .replace(/←/g, '-')
    .replace(/⇒/g, '=')
    .replace(/▶/g, '>')
    .replace(/[·ㆍ∙・]/g, '•')
    .replace(/[★☆]/g, '•')
    .replace(/[✓✔]/g, 'V')
    .replace(/✗/g, 'X')
    .replace(/×/g, 'x')
    .replace(/÷/g, '/')
    .replace(/±/g, '+/-')
    .replace(/≒/g, '약')
    .replace(/≠/g, '!=')
    .replace(/℃/g, '도')
    .replace(/㎡/g, 'm2')
    .replace(/㎏/g, 'kg')
    .replace(/㎜/g, 'mm')
    .replace(/㎝/g, 'cm')
    .replace(/㎞/g, 'km')
    .replace(/₩/g, '원 ')
    .replace(/°/g, '도');
}
const glyphCache = new Map();
function hasGlyph(font, ch) {
  const key = (font === FONT_REGULAR ? 'R' : font === FONT_BOLD ? 'B' : 'E') + ch;
  if (glyphCache.has(key)) return glyphCache.get(key);
  const ok = ch === ' ' || ch === '\n' || font.charToGlyph(ch).index !== 0;
  glyphCache.set(key, ok);
  return ok;
}

// opentype.js는 getPath(text,x,y,size)에 오프셋을 직접 넘기면 특정 좌표 조합에서
// 곡선 근사 계산이 NaN을 내는 버그가 있어(SVG path가 그 지점에서 통째로 잘려나감),
// 항상 원점(0,0) 기준 outline만 얻고 이동은 우리가 직접 계산한다.
function commandsToPathD(commands, dx, dy, decimals) {
  const m = Math.pow(10, decimals);
  const round = n => Math.round((n + Number.EPSILON) * m) / m;
  let d = '';
  commands.forEach(c => {
    if (c.type === 'M') d += 'M' + round(c.x + dx) + ' ' + round(c.y + dy);
    else if (c.type === 'L') d += 'L' + round(c.x + dx) + ' ' + round(c.y + dy);
    else if (c.type === 'C') d += 'C' + round(c.x1 + dx) + ' ' + round(c.y1 + dy) + ' ' + round(c.x2 + dx) + ' ' + round(c.y2 + dy) + ' ' + round(c.x + dx) + ' ' + round(c.y + dy);
    else if (c.type === 'Q') d += 'Q' + round(c.x1 + dx) + ' ' + round(c.y1 + dy) + ' ' + round(c.x + dx) + ' ' + round(c.y + dy);
    else if (c.type === 'Z') d += 'Z';
  });
  return d;
}

function measureText(text, fontSize, weight) {
  const font = pickFont(weight);
  const chars = Array.from(sanitizeForFont(text));
  let w = 0;
  chars.forEach(ch => { w += hasGlyph(font, ch) ? font.getAdvanceWidth(ch, fontSize) : fontSize * 0.5; });
  return w;
}

function drawText(text, x, y, fontSize, weight, fillHex, opts = {}) {
  const { align = 'left', width = 0, fillOpacity } = opts;
  const str = sanitizeForFont(text);
  if (!str) return '';
  const font = pickFont(weight);
  let startX = x;
  if (align === 'middle') startX = x - measureText(str, fontSize, weight) / 2;
  else if (align === 'end') startX = x - measureText(str, fontSize, weight);
  let cursorX = startX;
  let d = '';
  for (const ch of str) {
    if (!hasGlyph(font, ch)) { cursorX += fontSize * 0.5; continue; }
    const glyphPath = font.getPath(ch, 0, 0, fontSize);
    d += commandsToPathD(glyphPath.commands, cursorX, y, 1);
    cursorX += font.getAdvanceWidth(ch, fontSize);
  }
  if (!d) return '';
  const op = fillOpacity != null ? ` fill-opacity="${fillOpacity}"` : '';
  return `<path d="${d}" fill="#${fillHex}"${op}/>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 담보 카테고리별 색상 팔레트
const SECTION_COLORS = [
  { bg: 'EAF1FF', accent: '3B6FE0', text: '1D3A7A' }, // 블루
  { bg: 'F1ECFF', accent: '7B4FE0', text: '3B2470' }, // 퍼플
  { bg: 'EAF8EE', accent: '2FA35C', text: '155C30' }, // 그린
  { bg: 'FFF7E0', accent: 'D9A400', text: '6B5300' }, // 옐로
  { bg: 'FFEEF3', accent: 'E0508E', text: '7A1E45' }, // 핑크
  { bg: 'FFF1EA', accent: 'E06B2F', text: '7A3714' }  // 오렌지
];
// 카테고리 이름마다 항상 같은 색이 나오도록 고정 매핑 (기타/새 카테고리는 순서대로 배정)
const CATEGORY_COLOR_MAP = {
  '기본계약': SECTION_COLORS[0],
  '진단비': SECTION_COLORS[1],
  '치료비': SECTION_COLORS[2],
  '수술비': SECTION_COLORS[3],
  '상해관련': SECTION_COLORS[4],
  '간병': SECTION_COLORS[5]
};
function colorForCategory(category, fallbackIdx) {
  return CATEGORY_COLOR_MAP[category] || SECTION_COLORS[fallbackIdx % SECTION_COLORS.length];
}

// 문서 전체 톤(헤더 배너 색) — 고객 성향에 맞게 선택
const COLOR_THEMES = {
  blue: { grad: ['1E3A8A', '3B6FE0'] },
  pink: { grad: ['9D174D', 'E0508E'] },
  yellow: { grad: ['8A6300', 'D9A400'] },
  purple: { grad: ['4C1D95', '7B4FE0'] },
  green: { grad: ['14532D', '2FA35C'] }
};
function getColorTheme(key) {
  return COLOR_THEMES[key] || COLOR_THEMES.blue;
}

const MARGIN = 56;
const NO_W = 56;
const ROW_H = 50;
const SECTION_HEADER_H = 46;
const HEADER_H = 210;
const FOOTER_H = 90;

function headerBannerSvg(theme, agentName, title, clientName, boxes) {
  let s = `<rect width="${CW}" height="${HEADER_H}" fill="url(#headerGrad)"/>`;
  s += drawText(agentName || '', MARGIN, 72, 24, 700, 'FFFFFF', { fillOpacity: 0.85 });
  s += drawText(title || '맞춤 설계 제안서', MARGIN, 128, 42, 800, 'FFFFFF');
  if (clientName) {
    s += drawText(`${clientName}님을 위한 설계안`, MARGIN, 168, 24, 400, 'FFFFFF', { fillOpacity: 0.85 });
  }
  const boxCount = boxes.length;
  const boxW = 220, boxGap = 16;
  const boxX = CW - MARGIN - (boxW * boxCount + boxGap * (boxCount - 1));
  boxes.forEach((b, i) => {
    const bx = boxX + i * (boxW + boxGap);
    s += `<rect x="${bx}" y="30" width="${boxW}" height="150" rx="14" fill="#FFFFFF" fill-opacity="0.12" stroke="#FFFFFF" stroke-opacity="0.4"/>`;
    s += drawText(b.label || '', bx + boxW / 2, 60, 18, 700, 'FFFFFF', { align: 'middle' });
    if (b.sub) s += drawText(b.sub, bx + boxW / 2, 82, 12, 400, 'FFFFFF', { align: 'middle', fillOpacity: 0.75 });
    s += drawText('월 보험료', bx + boxW / 2, 104, 13, 400, 'FFFFFF', { align: 'middle', fillOpacity: 0.8 });
    // 보험료 숫자가 길면(여러 보험사 합산 등) 박스를 벗어나지 않게 글자 크기를 자동으로 줄인다.
    const premiumText = b.premium || '-';
    const premiumFontSize = premiumText.length > 12 ? 18 : premiumText.length > 9 ? 22 : 27;
    s += drawText(premiumText, bx + boxW / 2, 136, premiumFontSize, 800, 'FFFFFF', { align: 'middle' });
    // 보험사별 보험료 내역 (예: "메리츠화재 75,789원 + DB손해 42,220원") — 합계 숫자 아래 작게
    if (b.breakdown) {
      const bdFontSize = b.breakdown.length > 34 ? 9.5 : 11;
      s += drawText(b.breakdown, bx + boxW / 2, 158, bdFontSize, 400, 'FFFFFF', { align: 'middle', fillOpacity: 0.75 });
    }
  });
  return s;
}

function footerSvg(cy) {
  let s = `<line x1="${MARGIN}" y1="${cy}" x2="${CW-MARGIN}" y2="${cy}" stroke="#E4E4E7" stroke-width="1"/>`;
  s += drawText('본 제안서는 참고용이며, 실제 가입 시 약관 및 상품설명서를 기준으로 안내드립니다.', MARGIN, cy + 40, 14, 400, '999999');
  return s;
}

function svgDocument(theme, totalH, body) {
  return `<svg width="${CW}" height="${totalH}" viewBox="0 0 ${CW} ${totalH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#${theme.grad[0]}"/>
        <stop offset="100%" stop-color="#${theme.grad[1]}"/>
      </linearGradient>
    </defs>
    <rect width="${CW}" height="${totalH}" fill="#FFFFFF"/>
    ${body}
  </svg>`;
}

// "75,789원 + 42,220원"처럼 여러 보험사 보험료가 합산되지 않은 채로 들어오면, 실제 합계 금액 하나로 계산해서 보여준다.
function resolvePremiumSum(str) {
  if (!str) return str;
  const parts = String(str).split('+').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return str;
  let total = 0;
  let ok = true;
  parts.forEach(p => {
    const num = parseInt(p.replace(/[^0-9]/g, ''), 10);
    if (isNaN(num)) { ok = false; return; }
    total += num;
  });
  if (!ok) return str;
  return total.toLocaleString('ko-KR') + '원';
}

// 담보명이 없거나, 모든 안(案)에서 가입금액이 비어있는 행(서비스성 특약 등 비교 의미가 없는 항목)은 제외한다.
function filterMeaningfulRows(rows) {
  return rows.filter(row => {
    if (!row || !row.label) return false;
    const amounts = Array.isArray(row.amounts) ? row.amounts : [row.amount || ''];
    return amounts.some(a => a && String(a).trim() && String(a).trim() !== '-');
  });
}

// AI가 프롬프트를 놓쳐도 항상 걸러지도록, 가입방식/심사 관련 필러 토큰을 서버에서 결정론적으로 제거한다.
const FILLER_TOKENS = ['plus', 'Plus', 'PLUS', '건강고지', '간편가입', '간편', '건강가입', '일반심사형', '일반가입', '무해지'];
function stripFillerTokens(label) {
  if (!label) return label;
  let s = String(label);
  FILLER_TOKENS.forEach(f => {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('[(\\[]\\s*' + esc + '\\s*[)\\]]', 'g'), ''); // (plus), [건강고지] 등
    s = s.replace(new RegExp('(^|[\\s(])' + esc + '(?=[\\s)]|$)', 'g'), '$1'); // 괄호 없이 단독으로 붙은 경우
  });
  // "(1일이상 180일한도)"처럼 괄호 안에 다른 조건과 같이 붙어 있는 당연한 조건은 부분 치환으로 제거한다.
  // 단, "181일이상"처럼 다른 숫자에 딸린 경우까지 잘못 지우면 안 되므로, 앞에 다른 숫자가 없을 때만 지운다.
  s = s.replace(/(?<!\d)1일\s*이상\s*/g, '').replace(/(?<!\d)1회\s*한(?![가-힣])/g, '');
  return s.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

// 카테고리 표시 순서를 고정한다 (기본계약 → 진단비 → 치료비 → 수술비 → 상해관련 → 간병 → 그 외)
const CATEGORY_ORDER = ['기본계약', '진단비', '치료비', '수술비', '상해관련', '간병'];

// 같은 카테고리(진단비/치료비 등) 안에서도 질병군 순서를 암 → 뇌 → 심장 → 그 외로 고정한다
const DISEASE_ORDER = [
  { key: 0, test: /암|항암|유사암/ },
  { key: 1, test: /뇌|중풍/ },
  { key: 2, test: /심장|심혈관|허혈|심근/ }
];
function diseaseRank(label) {
  const found = DISEASE_ORDER.find(d => d.test.test(label || ''));
  return found ? found.key : 99;
}

// 담보 카테고리별로 묶는다 (고정 순서대로, 목록에 없는 카테고리는 맨 뒤에 등장 순서대로).
// 각 카테고리 안에서는 암 → 뇌 → 심장 → 그 외 순서로, 같은 질병군끼리는 원래 순서를 유지한다(안정 정렬).
function groupRowsByCategory(rows) {
  const byCat = new Map();
  rows.forEach((row, idx) => {
    const cat = (row.category || '기타').trim() || '기타';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({ row, idx });
  });
  const orderedCats = [
    ...CATEGORY_ORDER.filter(c => byCat.has(c)),
    ...[...byCat.keys()].filter(c => !CATEGORY_ORDER.includes(c))
  ];
  return orderedCats.map(cat => {
    const entries = byCat.get(cat).slice().sort((a, b) => {
      const diff = diseaseRank(a.row.label) - diseaseRank(b.row.label);
      return diff !== 0 ? diff : a.idx - b.idx;
    });
    return { category: cat, rows: entries.map(e => e.row) };
  });
}

// 사용자가 지정한 "중요 특약" 목록과 담보명을 대조해서, 별표/빨간색/설명을 붙일지 판단한다
function matchHighlight(label, highlights) {
  if (!label || !Array.isArray(highlights)) return null;
  const target = String(label).toLowerCase();
  for (const h of highlights) {
    if (h && h.name && target.includes(String(h.name).toLowerCase().trim())) return h;
  }
  return null;
}

// 짧은 설명 텍스트를 주어진 폭에 맞춰 최대 2줄로 감싼다 (비고 칸용)
function wrapPlainText(text, maxWidth, fontSize, weight, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach(w => {
    const test = current ? current + ' ' + w : w;
    if (measureText(test, fontSize, weight) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).map((l, i) => i === maxLines - 1 ? l.replace(/.{1,2}$/, '…') : l);
  }
  return lines;
}

// ===== 병합 표 (프리미엄형/가성비형처럼 같은 보험사 조합인 A/B안을 담보명 기준으로 한 표에 나란히) =====
// 담보명은 한 번만, 옆으로 안(案)별 가입금액 컬럼만 나란히 붙는다 — 사용자가 요청한 세로형(항목 나열) + 가로 컬럼 비교 방식.
// 카테고리(간병/3대진단비/상해/질병수술비 등)별로 색상 띠를 둘러서 구분한다.
function renderMergedProposal({ title, clientName, agentName, theme, carriers, designLabels, premiums, premiumBreakdown, rows, highlights }) {
  const tableW = CW - MARGIN * 2;
  const designCount = designLabels.length;
  const hlList = Array.isArray(highlights) ? highlights.filter(h => h && h.name && h.name.trim()) : [];

  // AI가 직접 태깅한 row.highlightStar/highlightNote를 우선 사용하고(의미 기반 매칭이라 더 정확),
  // 혹시 없으면 문자열 부분일치로 한 번 더 시도한다 (안전망).
  const cleanRowsRaw = filterMeaningfulRows(rows).map(row => {
    const cleanLabel = stripFillerTokens(row.label); // AI가 놓친 (plus)/건강고지 등을 여기서 무조건 한 번 더 제거
    let star = !!row.highlightStar;
    let note = (row.highlightNote || '').trim();
    let isHl = star || !!note;
    if (!isHl) {
      const fallback = matchHighlight(cleanLabel, hlList);
      if (fallback) { star = !!fallback.star; note = (fallback.description || '').trim(); isHl = true; }
    }
    return { ...row, label: cleanLabel, __isHl: isHl, __star: star, __note: note };
  });
  const hasNotes = cleanRowsRaw.some(r => r.__note);
  const NOTE_W = hasNotes ? 260 : 0;
  const LABEL_W = Math.max(260, tableW - NO_W - 170 - NOTE_W - 150 * designCount);
  const TERM_W = 170;
  const amountColW = (tableW - NO_W - LABEL_W - TERM_W - NOTE_W) / designCount;
  const amountsStartX = MARGIN + NO_W + LABEL_W + TERM_W;
  const noteStartX = amountsStartX + amountColW * designCount;

  // 담보명이 칸 폭을 넘기면 옆 컬럼(납기·만기)을 침범해서 겹쳐 보이던 문제 — 담보명을 최대 2줄로 감싸고,
  // 그만큼 행 높이를 늘려서 절대 다른 컬럼을 침범하지 않게 한다 (근본적 해결).
  const cleanRows = cleanRowsRaw.map(row => {
    const labelFontSize = 16, labelWeight = row.__isHl ? 700 : 500;
    const prefix = row.__isHl && row.__star ? '★ ' : '';
    const labelLines = wrapPlainText(prefix + (row.label || ''), LABEL_W - 32, labelFontSize, labelWeight, 2);
    return {
      ...row,
      __labelLines: labelLines.length ? labelLines : [''],
      __noteLines: row.__note ? wrapPlainText(row.__note, NOTE_W - 24, 12, 400, 2) : []
    };
  });
  const groups = groupRowsByCategory(cleanRows);
  const resolvedPremiums = premiums.map(resolvePremiumSum);

  const CARRIER_BAND_H = carriers ? 44 : 0;
  const CATEGORY_BAND_H = 40;
  let contentHeight = CARRIER_BAND_H + 36;
  groups.forEach(g => {
    contentHeight += CATEGORY_BAND_H;
    g.rows.forEach(row => {
      contentHeight += Math.max(ROW_H, 22 + Math.max(row.__labelLines.length, row.__noteLines.length) * 19);
    });
  });
  const totalH = HEADER_H + 20 + contentHeight + FOOTER_H + 40;

  const breakdownList = Array.isArray(premiumBreakdown) ? premiumBreakdown : [];
  const boxes = designLabels.map((label, i) => ({ label, premium: resolvedPremiums[i] || '', breakdown: (breakdownList[i] || '').trim() }));
  let body = headerBannerSvg(theme, agentName, title, clientName, boxes);

  let cy = HEADER_H + 20;

  if (carriers) {
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${CARRIER_BAND_H}" rx="6" fill="#${theme.grad[1]}" fill-opacity="0.08"/>`;
    body += `<rect x="${MARGIN}" y="${cy}" width="6" height="${CARRIER_BAND_H}" fill="#${theme.grad[1]}"/>`;
    body += drawText(carriers, MARGIN + 24, cy + CARRIER_BAND_H / 2 + 6, 18, 800, theme.grad[0]);
    cy += CARRIER_BAND_H + 8;
  }

  // 표 헤더 행
  body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="36" fill="#F4F5F7"/>`;
  body += drawText('NO', MARGIN + NO_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
  body += drawText('담보명 및 보장내용', MARGIN + NO_W + 16, cy + 24, 14, 700, '555555');
  body += drawText('납기·만기', MARGIN + NO_W + LABEL_W + TERM_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
  designLabels.forEach((label, i) => {
    const cx = amountsStartX + amountColW * i + amountColW / 2;
    body += drawText(label, cx, cy + 24, 14, 700, '555555', { align: 'middle' });
  });
  if (hasNotes) body += drawText('비고', noteStartX + 16, cy + 24, 14, 700, '555555');
  cy += 36;

  // 카테고리별로 묶어서, 담보명은 한 번만 + 안(案)별 금액만 옆으로
  let rowCounter = 1;
  groups.forEach((group, gIdx) => {
    const color = colorForCategory(group.category, gIdx);
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${CATEGORY_BAND_H}" fill="#${color.bg}"/>`;
    body += `<rect x="${MARGIN}" y="${cy}" width="6" height="${CATEGORY_BAND_H}" fill="#${color.accent}"/>`;
    body += drawText(group.category, MARGIN + 24, cy + CATEGORY_BAND_H / 2 + 6, 16, 800, color.text);
    cy += CATEGORY_BAND_H;

    group.rows.forEach((row, rIdx) => {
      const lineCount = Math.max(row.__labelLines.length, row.__noteLines.length);
      const rowH = Math.max(ROW_H, 22 + lineCount * 19);
      const rowBg = rIdx % 2 === 0 ? 'FFFFFF' : 'FAFAFA';
      body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${rowH}" fill="#${rowBg}"/>`;
      body += `<line x1="${MARGIN}" y1="${cy+rowH}" x2="${MARGIN+tableW}" y2="${cy+rowH}" stroke="#EDEDEF" stroke-width="1"/>`;
      // 카테고리·질병군 순서로 재정렬되므로, 원래 no 값 대신 화면에 보이는 순서 그대로 1부터 다시 매긴다
      body += drawText(String(rowCounter), MARGIN + NO_W / 2, cy + rowH / 2 + 6, 14, 400, '888888', { align: 'middle' });

      // 담보명 — 칸을 넘기면 2줄까지 감싸서, 옆(납기·만기) 컬럼을 절대 침범하지 않는다
      const isHl = row.__isHl;
      const labelY = cy + rowH / 2 - (row.__labelLines.length - 1) * 9.5 + 5;
      row.__labelLines.forEach((line, li) => {
        body += drawText(line, MARGIN + NO_W + 16, labelY + li * 19, 16, isHl ? 700 : 500, isHl ? 'D32F2F' : '222222');
      });

      body += drawText(row.term || '', MARGIN + NO_W + LABEL_W + TERM_W / 2, cy + rowH / 2 + 6, 13, 400, '777777', { align: 'middle' });
      const amounts = Array.isArray(row.amounts) ? row.amounts : [row.amount || ''];
      designLabels.forEach((label, i) => {
        const cx = amountsStartX + amountColW * i + amountColW / 2;
        const val = amounts[i] || '';
        body += drawText(val || '-', cx, cy + rowH / 2 + 6, 15, val ? 700 : 400, val ? color.text : 'CCCCCC', { align: 'middle' });
      });
      if (hasNotes && row.__noteLines.length) {
        const noteY = cy + rowH / 2 - (row.__noteLines.length - 1) * 7.5 + 4;
        row.__noteLines.forEach((line, li) => {
          body += drawText(line, noteStartX + 16, noteY + li * 15, 12, 400, '888888');
        });
      }
      cy += rowH;
      rowCounter++;
    });
  });

  body += footerSvg(cy);
  return svgDocument(theme, totalH, body);
}


// ===== 조합설계 (예전 형식 호환 — 안(案)별로 완전히 분리된 표를 위아래로 쌓음) =====
function renderCombinationProposal({ title, clientName, agentName, theme, designs }) {
  const tableW = CW - MARGIN * 2;
  const LABEL_W = tableW - NO_W - 170 - 200;
  const TERM_W = 170;
  const AMOUNT_W = 200;

  let contentHeight = 0;
  designs.forEach(dsn => {
    contentHeight += 64; // 안(案) 헤더 밴드
    contentHeight += 36; // 표 헤더 행
    contentHeight += (dsn.rows || []).length * ROW_H;
    contentHeight += 24; // 안 사이 간격
  });

  const totalH = HEADER_H + contentHeight + FOOTER_H + 40;

  const boxes = designs.map(d => ({
    label: d.label || '', sub: d.carriers || '', premium: d.premium || ''
  }));
  let body = headerBannerSvg(theme, agentName, title, clientName, boxes);

  let cy = HEADER_H + 20;
  designs.forEach((dsn, dIdx) => {
    const themeAccent = SECTION_COLORS[dIdx % SECTION_COLORS.length];

    // 안(案) 헤더 밴드: 보험사(조합) 이름 + 보험료만 심플하게
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="56" rx="8" fill="#${theme.grad[1]}" fill-opacity="0.08"/>`;
    body += `<rect x="${MARGIN}" y="${cy}" width="6" height="56" fill="#${theme.grad[1]}"/>`;
    const dsnTitle = [dsn.label, dsn.carriers].filter(Boolean).join(' · ');
    body += drawText(dsnTitle, MARGIN + 24, cy + 34, 20, 800, theme.grad[0]);
    if (dsn.premium) {
      body += drawText(`월 ${dsn.premium}`, CW - MARGIN - 24, cy + 34, 18, 800, theme.grad[0], { align: 'end' });
    }
    cy += 64;

    // 표 헤더 행
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="36" fill="#F4F5F7"/>`;
    body += drawText('NO', MARGIN + NO_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
    body += drawText('담보명 및 보장내용', MARGIN + NO_W + 16, cy + 24, 14, 700, '555555');
    body += drawText('납기·만기', MARGIN + NO_W + LABEL_W + TERM_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
    body += drawText('가입금액', MARGIN + NO_W + LABEL_W + TERM_W + AMOUNT_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
    cy += 36;

    // 담보 목록: 보험사 구분 없이 하나의 표로 쭉 나열
    (dsn.rows || []).forEach((row, rIdx) => {
      const rowBg = rIdx % 2 === 0 ? 'FFFFFF' : 'FAFAFA';
      body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${ROW_H}" fill="#${rowBg}"/>`;
      body += `<line x1="${MARGIN}" y1="${cy+ROW_H}" x2="${MARGIN+tableW}" y2="${cy+ROW_H}" stroke="#EDEDEF" stroke-width="1"/>`;
      body += drawText(String(row.no != null ? row.no : rIdx + 1), MARGIN + NO_W / 2, cy + ROW_H / 2 + 6, 14, 400, '888888', { align: 'middle' });
      body += drawText(row.label || '', MARGIN + NO_W + 16, cy + ROW_H / 2 + 6, 16, 500, '222222');
      body += drawText(row.term || '', MARGIN + NO_W + LABEL_W + TERM_W / 2, cy + ROW_H / 2 + 6, 13, 400, '777777', { align: 'middle' });
      body += drawText(row.amount || '', MARGIN + NO_W + LABEL_W + TERM_W + AMOUNT_W / 2, cy + ROW_H / 2 + 6, 15, 700, themeAccent.text, { align: 'middle' });
      cy += ROW_H;
    });
    cy += 24;
  });

  body += footerSvg(cy);
  return svgDocument(theme, totalH, body);
}

// ===== 구버전 호환: 예전 조합설계(보험사별 색상 그룹핑) 데이터가 저장돼 있으면 flat rows로 변환해서 그대로 렌더링 =====
function normalizeDesigns(designs) {
  return designs.map(d => {
    if (Array.isArray(d.rows)) return d; // 이미 새 형식(flat rows)
    if (Array.isArray(d.sections)) {
      // 예전 형식(보험사별 sections) → flat rows로 병합
      const rows = [];
      let no = 1;
      d.sections.forEach(sec => {
        (sec.rows || []).forEach(r => {
          rows.push({ no: no++, label: r.label, term: r.term, amount: r.amount });
        });
      });
      return { label: d.label, carriers: d.carriers, premium: d.premium, rows };
    }
    return { ...d, rows: [] };
  });
}

// ===== 구버전 호환: 단일 플랜 비교표 (plans + sections) =====
function renderLegacyProposal({ title, clientName, agentName, theme, plans, sections }) {
  const planList = Array.isArray(plans) && plans.length ? plans.slice(0, 3) : [{ label: '플랜', premium: '' }];
  const planCount = planList.length;
  const tableW = CW - MARGIN * 2;
  const LABEL_W_BASE = 430;
  const TERM_W = 190;
  const amountColW = (tableW - NO_W - LABEL_W_BASE - TERM_W) / planCount;

  let contentHeight = 0;
  sections.forEach(sec => {
    contentHeight += SECTION_HEADER_H;
    contentHeight += (sec.rows || []).length * ROW_H;
  });
  const totalH = HEADER_H + contentHeight + FOOTER_H + 40;

  const boxes = planList.map(p => ({ label: p.label || '', premium: p.premium || '' }));
  let body = headerBannerSvg(theme, agentName, title, clientName, boxes);

  let cy = HEADER_H + 4;
  body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="36" fill="#F4F5F7"/>`;
  body += drawText('NO', MARGIN + NO_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
  body += drawText('담보명 및 보장내용', MARGIN + NO_W + 16, cy + 24, 14, 700, '555555');
  body += drawText('납기·만기', MARGIN + NO_W + LABEL_W_BASE + TERM_W / 2, cy + 24, 14, 700, '555555', { align: 'middle' });
  planList.forEach((p, i) => {
    const cx = MARGIN + NO_W + LABEL_W_BASE + TERM_W + amountColW * i + amountColW / 2;
    body += drawText(p.label || '가입금액', cx, cy + 24, 14, 700, '555555', { align: 'middle' });
  });
  cy += 36;

  sections.forEach((sec, sIdx) => {
    const color = SECTION_COLORS[sIdx % SECTION_COLORS.length];
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${SECTION_HEADER_H}" fill="#${color.bg}"/>`;
    body += `<rect x="${MARGIN}" y="${cy}" width="6" height="${SECTION_HEADER_H}" fill="#${color.accent}"/>`;
    body += drawText(`• ${sec.name || ''}`, MARGIN + 24, cy + SECTION_HEADER_H / 2 + 7, 19, 800, color.text);
    cy += SECTION_HEADER_H;

    (sec.rows || []).forEach((row, rIdx) => {
      const rowBg = rIdx % 2 === 0 ? 'FFFFFF' : 'FAFAFA';
      body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${ROW_H}" fill="#${rowBg}"/>`;
      body += `<line x1="${MARGIN}" y1="${cy+ROW_H}" x2="${MARGIN+tableW}" y2="${cy+ROW_H}" stroke="#EDEDEF" stroke-width="1"/>`;
      body += drawText(String(row.no != null ? row.no : rIdx + 1), MARGIN + NO_W / 2, cy + ROW_H / 2 + 6, 14, 400, '888888', { align: 'middle' });
      body += drawText(row.label || '', MARGIN + NO_W + 16, cy + ROW_H / 2 + 6, 16, 500, '222222');
      body += drawText(row.term || '', MARGIN + NO_W + LABEL_W_BASE + TERM_W / 2, cy + ROW_H / 2 + 6, 13, 400, '777777', { align: 'middle' });
      const amounts = Array.isArray(row.amounts) ? row.amounts : [row.amount || ''];
      planList.forEach((p, i) => {
        const cx = MARGIN + NO_W + LABEL_W_BASE + TERM_W + amountColW * i + amountColW / 2;
        const val = amounts[i] || amounts[0] || '';
        body += drawText(val, cx, cy + ROW_H / 2 + 6, 15, 700, color.text, { align: 'middle' });
      });
      cy += ROW_H;
    });
  });

  cy += 24;
  body += footerSvg(cy);
  return svgDocument(theme, totalH, body);
}

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { title, clientName, agentName, colorKey, carriers, designLabels, premiums, rows, designs, plans, sections } = req.body || {};
    const theme = getColorTheme(colorKey);

    let svg;
    if (Array.isArray(rows) && rows.length && Array.isArray(designLabels) && designLabels.length) {
      svg = renderMergedProposal({ title, clientName, agentName, theme, carriers, designLabels, premiums: premiums || [], premiumBreakdown: req.body.premiumBreakdown, rows, highlights: req.body.highlights });
    } else if (Array.isArray(designs) && designs.length) {
      svg = renderCombinationProposal({ title, clientName, agentName, theme, designs: normalizeDesigns(designs) });
    } else if (Array.isArray(sections) && sections.length) {
      svg = renderLegacyProposal({ title, clientName, agentName, theme, plans, sections });
    } else {
      return res.status(400).json({ error: 'rows 또는 designs 또는 sections 데이터가 필요합니다.' });
    }

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return res.status(200).json({ ok: true, base64: png.toString('base64') });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

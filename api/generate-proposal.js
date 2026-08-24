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

// 담보 카테고리별 색상 팔레트 (예시 이미지의 파랑/보라/초록/노랑/분홍 그룹 컬러 느낌 참고)
const SECTION_COLORS = [
  { bg: 'EAF1FF', accent: '3B6FE0', text: '1D3A7A' }, // 블루
  { bg: 'F1ECFF', accent: '7B4FE0', text: '3B2470' }, // 퍼플
  { bg: 'EAF8EE', accent: '2FA35C', text: '155C30' }, // 그린
  { bg: 'FFF7E0', accent: 'D9A400', text: '6B5300' }, // 옐로
  { bg: 'FFEEF3', accent: 'E0508E', text: '7A1E45' }, // 핑크
  { bg: 'FFF1EA', accent: 'E06B2F', text: '7A3714' }  // 오렌지
];

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { title, clientName, agentName, plans, sections } = req.body || {};
    if (!Array.isArray(sections) || !sections.length) {
      return res.status(400).json({ error: 'sections 데이터가 필요합니다.' });
    }
    const planList = Array.isArray(plans) && plans.length ? plans.slice(0, 3) : [{ label: '플랜', premium: '' }];
    const planCount = planList.length;

    const MARGIN = 56;
    const NO_W = 56;
    const LABEL_W_BASE = 430;
    const TERM_W = 190;
    const tableW = CW - MARGIN * 2;
    const amountColW = (tableW - NO_W - LABEL_W_BASE - TERM_W) / planCount;

    // ---- 헤더 높이 ----
    let y = 0;
    const HEADER_H = 210;
    y = HEADER_H;

    // ---- 각 섹션/행 높이를 먼저 계산 (동적 캔버스 높이용) ----
    const ROW_H = 50;
    const SECTION_HEADER_H = 46;
    let contentHeight = 0;
    sections.forEach(sec => {
      contentHeight += SECTION_HEADER_H;
      contentHeight += (sec.rows || []).length * ROW_H;
    });

    const FOOTER_H = 90;
    const totalH = HEADER_H + contentHeight + FOOTER_H + 40;

    // ---- SVG 구성 ----
    let body = '';

    // 헤더 배너
    body += `<rect width="${CW}" height="${HEADER_H}" fill="url(#headerGrad)"/>`;
    body += drawText(agentName || '', MARGIN, 72, 24, 700, 'FFFFFF', { fillOpacity: 0.85 });
    body += drawText(title || '맞춤 설계 제안서', MARGIN, 128, 42, 800, 'FFFFFF');
    if (clientName) {
      body += drawText(`${clientName}님을 위한 설계안`, MARGIN, 168, 24, 400, 'FFFFFF', { fillOpacity: 0.85 });
    }
    // 플랜 프리미엄 박스 (우측 정렬)
    const boxW = 220, boxGap = 16;
    let boxX = CW - MARGIN - (boxW * planCount + boxGap * (planCount - 1));
    planList.forEach((p, i) => {
      const bx = boxX + i * (boxW + boxGap);
      body += `<rect x="${bx}" y="30" width="${boxW}" height="150" rx="14" fill="#FFFFFF" fill-opacity="0.12" stroke="#FFFFFF" stroke-opacity="0.4"/>`;
      body += drawText(p.label || '', bx + boxW / 2, 66, 19, 700, 'FFFFFF', { align: 'middle' });
      body += drawText('월 보험료', bx + boxW / 2, 100, 14, 400, 'FFFFFF', { align: 'middle', fillOpacity: 0.8 });
      body += drawText(p.premium || '-', bx + boxW / 2, 140, 30, 800, 'FFFFFF', { align: 'middle' });
    });

    // 표 헤더 행 (컬럼명)
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

    // 섹션들
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

    // 푸터
    cy += 24;
    body += `<line x1="${MARGIN}" y1="${cy}" x2="${CW-MARGIN}" y2="${cy}" stroke="#E4E4E7" stroke-width="1"/>`;
    body += drawText('본 제안서는 참고용이며, 실제 가입 시 약관 및 상품설명서를 기준으로 안내드립니다.', MARGIN, cy + 40, 14, 400, '999999');

    const svg = `<svg width="${CW}" height="${totalH}" viewBox="0 0 ${CW} ${totalH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1E3A8A"/>
          <stop offset="100%" stop-color="#3B6FE0"/>
        </linearGradient>
      </defs>
      <rect width="${CW}" height="${totalH}" fill="#FFFFFF"/>
      ${body}
    </svg>`;

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return res.status(200).json({ ok: true, base64: png.toString('base64'), width: CW, height: totalH });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

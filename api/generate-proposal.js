const { checkAppPassword } = require('./_auth');
const sharp = require('sharp');

const CW = 1200; // 캔버스 폭 고정, 높이는 내용에 따라 동적으로 계산

const FONT = 'NotoSansKR';
const FONT_REGULAR_B64 = require('./fonts/notosans-regular.b64.js');
const FONT_BOLD_B64 = require('./fonts/notosans-bold.b64.js');
const FONT_EXTRABOLD_B64 = require('./fonts/notosans-black.b64.js');
const FONT_FACE_DEFS = `<style>
  @font-face { font-family:'${FONT}'; font-weight:400; src:url(data:font/truetype;base64,${FONT_REGULAR_B64}) format('truetype'); }
  @font-face { font-family:'${FONT}'; font-weight:700; src:url(data:font/truetype;base64,${FONT_BOLD_B64}) format('truetype'); }
  @font-face { font-family:'${FONT}'; font-weight:800; src:url(data:font/truetype;base64,${FONT_EXTRABOLD_B64}) format('truetype'); }
</style>`;

// 담보 카테고리별 색상 팔레트 (예시 이미지의 파랑/보라/초록/노랑/분홍 그룹 컬러 느낌 참고)
const SECTION_COLORS = [
  { bg: 'EAF1FF', accent: '3B6FE0', text: '1D3A7A' }, // 블루
  { bg: 'F1ECFF', accent: '7B4FE0', text: '3B2470' }, // 퍼플
  { bg: 'EAF8EE', accent: '2FA35C', text: '155C30' }, // 그린
  { bg: 'FFF7E0', accent: 'D9A400', text: '6B5300' }, // 옐로
  { bg: 'FFEEF3', accent: 'E0508E', text: '7A1E45' }, // 핑크
  { bg: 'FFF1EA', accent: 'E06B2F', text: '7A3714' }  // 오렌지
];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textWidth(text, fontSize, weight) {
  // 대략치: 한글은 fontSize에 가깝고, 영문/숫자는 좁음 — 근사 계산
  let w = 0;
  for (const ch of String(text)) {
    w += /[\u3131-\uD79D]/.test(ch) ? fontSize * (weight >= 700 ? 1.02 : 1.0) : fontSize * 0.58;
  }
  return w;
}

function wrapByWidth(text, maxWidth, fontSize, weight) {
  const words = String(text).split(/( )/);
  const lines = [];
  let line = '';
  words.forEach(w => {
    const test = line + w;
    if (textWidth(test, fontSize, weight) > maxWidth && line.trim()) {
      lines.push(line.trim());
      line = w;
    } else {
      line = test;
    }
  });
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [''];
}

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
    body += `<text x="${MARGIN}" y="72" font-family="${FONT}" font-size="24" font-weight="700" fill="#FFFFFF" fill-opacity="0.85">${esc(agentName || '')}</text>`;
    body += `<text x="${MARGIN}" y="128" font-family="${FONT}" font-size="42" font-weight="800" fill="#FFFFFF">${esc(title || '맞춤 설계 제안서')}</text>`;
    if (clientName) {
      body += `<text x="${MARGIN}" y="168" font-family="${FONT}" font-size="24" font-weight="400" fill="#FFFFFF" fill-opacity="0.85">${esc(clientName)}님을 위한 설계안</text>`;
    }
    // 플랜 프리미엄 박스 (우측 정렬)
    const boxW = 220, boxGap = 16;
    let boxX = CW - MARGIN - (boxW * planCount + boxGap * (planCount - 1));
    planList.forEach((p, i) => {
      const bx = boxX + i * (boxW + boxGap);
      body += `<rect x="${bx}" y="30" width="${boxW}" height="150" rx="14" fill="#FFFFFF" fill-opacity="0.12" stroke="#FFFFFF" stroke-opacity="0.4"/>`;
      body += `<text x="${bx + boxW/2}" y="66" font-family="${FONT}" font-size="19" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(p.label || '')}</text>`;
      body += `<text x="${bx + boxW/2}" y="100" font-family="${FONT}" font-size="14" font-weight="400" fill="#FFFFFF" fill-opacity="0.8" text-anchor="middle">월 보험료</text>`;
      body += `<text x="${bx + boxW/2}" y="140" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF" text-anchor="middle">${esc(p.premium || '-')}</text>`;
    });

    // 표 헤더 행 (컬럼명)
    let cy = HEADER_H + 4;
    body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="36" fill="#F4F5F7"/>`;
    body += `<text x="${MARGIN + NO_W/2}" y="${cy+24}" font-family="${FONT}" font-size="14" font-weight="700" fill="#555" text-anchor="middle">NO</text>`;
    body += `<text x="${MARGIN + NO_W + 16}" y="${cy+24}" font-family="${FONT}" font-size="14" font-weight="700" fill="#555">담보명 및 보장내용</text>`;
    body += `<text x="${MARGIN + NO_W + LABEL_W_BASE + TERM_W/2}" y="${cy+24}" font-family="${FONT}" font-size="14" font-weight="700" fill="#555" text-anchor="middle">납기·만기</text>`;
    planList.forEach((p, i) => {
      const cx = MARGIN + NO_W + LABEL_W_BASE + TERM_W + amountColW * i + amountColW/2;
      body += `<text x="${cx}" y="${cy+24}" font-family="${FONT}" font-size="14" font-weight="700" fill="#555" text-anchor="middle">${esc(p.label || '가입금액')}</text>`;
    });
    cy += 36;

    // 섹션들
    sections.forEach((sec, sIdx) => {
      const color = SECTION_COLORS[sIdx % SECTION_COLORS.length];
      body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${SECTION_HEADER_H}" fill="#${color.bg}"/>`;
      body += `<rect x="${MARGIN}" y="${cy}" width="6" height="${SECTION_HEADER_H}" fill="#${color.accent}"/>`;
      body += `<text x="${MARGIN + 24}" y="${cy + SECTION_HEADER_H/2 + 7}" font-family="${FONT}" font-size="19" font-weight="800" fill="#${color.text}">★ ${esc(sec.name || '')}</text>`;
      cy += SECTION_HEADER_H;

      (sec.rows || []).forEach((row, rIdx) => {
        const rowBg = rIdx % 2 === 0 ? 'FFFFFF' : 'FAFAFA';
        body += `<rect x="${MARGIN}" y="${cy}" width="${tableW}" height="${ROW_H}" fill="#${rowBg}"/>`;
        body += `<line x1="${MARGIN}" y1="${cy+ROW_H}" x2="${MARGIN+tableW}" y2="${cy+ROW_H}" stroke="#EDEDEF" stroke-width="1"/>`;
        body += `<text x="${MARGIN + NO_W/2}" y="${cy+ROW_H/2+6}" font-family="${FONT}" font-size="14" fill="#888" text-anchor="middle">${esc(row.no != null ? row.no : rIdx+1)}</text>`;
        body += `<text x="${MARGIN + NO_W + 16}" y="${cy+ROW_H/2+6}" font-family="${FONT}" font-size="16" font-weight="500" fill="#222">${esc(row.label || '')}</text>`;
        body += `<text x="${MARGIN + NO_W + LABEL_W_BASE + TERM_W/2}" y="${cy+ROW_H/2+6}" font-family="${FONT}" font-size="13" fill="#777" text-anchor="middle">${esc(row.term || '')}</text>`;
        const amounts = Array.isArray(row.amounts) ? row.amounts : [row.amount || ''];
        planList.forEach((p, i) => {
          const cx = MARGIN + NO_W + LABEL_W_BASE + TERM_W + amountColW * i + amountColW/2;
          const val = amounts[i] || amounts[0] || '';
          body += `<text x="${cx}" y="${cy+ROW_H/2+6}" font-family="${FONT}" font-size="15" font-weight="700" fill="#${color.text}" text-anchor="middle">${esc(val)}</text>`;
        });
        cy += ROW_H;
      });
    });

    // 푸터
    cy += 24;
    body += `<line x1="${MARGIN}" y1="${cy}" x2="${CW-MARGIN}" y2="${cy}" stroke="#E4E4E7" stroke-width="1"/>`;
    body += `<text x="${MARGIN}" y="${cy+40}" font-family="${FONT}" font-size="14" fill="#999">본 제안서는 참고용이며, 실제 가입 시 약관 및 상품설명서를 기준으로 안내드립니다.</text>`;

    const svg = `<svg width="${CW}" height="${totalH}" viewBox="0 0 ${CW} ${totalH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${FONT_FACE_DEFS}
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

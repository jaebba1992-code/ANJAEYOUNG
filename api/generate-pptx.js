const { checkAppPassword } = require('./_auth');
const pptxgen = require('pptxgenjs');

const W = 13.33, H = 7.5;

const PALETTES = {
  '딥포레스트': { dark: '0A2E22', accent: '00A870', bright: '3EE0A1', soft: 'E6FBF2', muted: '8AA79B', amber: 'E07B32', bodyDark: '0A2E22', bodyText: '28453A', cardBg: 'F4F8F6', border: 'E4EFEA', darkCard: '0F3A2B', darkCardBorder: '164636' },
  '네이비골드': { dark: '0B1C36', accent: 'C99A3C', bright: 'F0CB68', soft: 'FBF3DF', muted: '8C97AC', amber: 'D9534F', bodyDark: '0B1C36', bodyText: '2C3A52', cardBg: 'F5F6FA', border: 'E3E7EF', darkCard: '132A4D', darkCardBorder: '223A61' },
  '차콜코랄': { dark: '1E1E1E', accent: 'E8604C', bright: 'FF8A72', soft: 'FFE9E3', muted: '9C9C9C', amber: '2D9CDB', bodyDark: '1E1E1E', bodyText: '3D3D3D', cardBg: 'F7F7F5', border: 'E6E6E2', darkCard: '2A2A2A', darkCardBorder: '3D3D3D' },
  '슬레이트블루': { dark: '14213D', accent: '3A6EA5', bright: '6FA8DC', soft: 'E8F0FA', muted: '8D9AB3', amber: 'E0A72D', bodyDark: '14213D', bodyText: '2D3B55', cardBg: 'F5F8FC', border: 'E1E8F2', darkCard: '1C2E52', darkCardBorder: '2C3F66' },
  '와인크림': { dark: '3D1730', accent: 'B8336A', bright: 'E37BA0', soft: 'FBE7F0', muted: 'A98A9C', amber: 'D9A441', bodyDark: '3D1730', bodyText: '4A2E3F', cardBg: 'FBF6F8', border: 'F0E3EA', darkCard: '4A1D3C', darkCardBorder: '5C2A4B' },
  '틸앰버': { dark: '0D3B3E', accent: '1B9C92', bright: '5FE0CF', soft: 'E3FBF7', muted: '87A8A6', amber: 'E58A2E', bodyDark: '0D3B3E', bodyText: '284543', cardBg: 'F3FAF9', border: 'E0F0EE', darkCard: '134A4D', darkCardBorder: '1F5E60' }
};
const PALETTE_NAMES = Object.keys(PALETTES);

function darkShadow() { return { type: 'outer', color: '000000', opacity: 0.35, blur: 18, offset: 4, angle: 90 }; }
function cardShadow(p) { return { type: 'outer', color: p.bodyDark, opacity: 0.12, blur: 14, offset: 4, angle: 90 }; }
const FONT = 'Malgun Gothic';

function buildRuns(parts, p, baseOpts) {
  // parts: [{text, tone: 'accent'|'amber'|'bright'|null}]
  return parts.map(part => {
    let color = baseOpts.color;
    if (part.tone === 'accent') color = p.accent;
    else if (part.tone === 'amber') color = p.amber;
    else if (part.tone === 'bright') color = p.bright;
    return { text: part.text, options: { ...baseOpts, color, bold: part.tone ? true : baseOpts.bold } };
  });
}

function slide_hook(s, d, p) {
  s.background = { color: p.dark };
  s.addText(d.eyebrow || '', { x: 0, y: 1.7, w: W, h: 0.5, align: 'center', fontFace: FONT, fontSize: 14, bold: true, color: p.bright, charSpacing: 3 });
  s.addText(d.title || '', { x: 0.8, y: 2.5, w: W - 1.6, h: 1.6, align: 'center', fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
  const parts = Array.isArray(d.subtitleRuns) && d.subtitleRuns.length ? d.subtitleRuns : [{ text: d.subtitle || '', tone: null }];
  s.addText(buildRuns(parts, p, { fontSize: 18, color: 'CFE8DE' }), { x: 0.8, y: 4.3, w: W - 1.6, h: 0.6, align: 'center', fontFace: FONT });
}

function slide_twoCompare(s, d, p) {
  s.background = { color: p.dark };
  s.addText(d.title || '', { x: 0.8, y: 0.7, w: W - 1.6, h: 0.8, align: 'center', fontFace: FONT, fontSize: 26, bold: true, color: 'FFFFFF' });
  const boxW = 4.6, boxH = 3.6, gap = 0.6, startX = (W - boxW * 2 - gap) / 2, boxY = 2.1;
  const cards = [d.left || {}, d.right || {}];
  cards.forEach((c, i) => {
    const x = startX + i * (boxW + gap);
    const isFirst = i === 0;
    s.addShape('roundRect', { x, y: boxY, w: boxW, h: boxH, rectRadius: 0.14, fill: { color: isFirst ? p.darkCard : '1A241F' }, line: { color: isFirst ? p.bright : '3A4A42', width: 1.5 }, shadow: darkShadow() });
    s.addText(c.badge || '', { x, y: boxY + 0.35, w: boxW, h: 1.1, align: 'center', fontFace: FONT, fontSize: 56, bold: true, color: isFirst ? p.bright : '6F9A87' });
    s.addText(c.headline || '', { x, y: boxY + 1.5, w: boxW, h: 0.5, align: 'center', fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
    s.addText(c.body || '', { x: x + 0.3, y: boxY + 2.15, w: boxW - 0.6, h: 1.2, align: 'center', fontFace: FONT, fontSize: 14, color: isFirst ? 'CFE8DE' : '9FB3AA', lineSpacingMultiple: 1.4 });
  });
}

function slide_statHighlight(s, d, p) {
  s.background = { color: 'FFFFFF' };
  s.addText(d.eyebrow || '', { x: 0.9, y: 0.7, w: W - 1.8, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: p.accent, charSpacing: 2 });
  const parts = Array.isArray(d.titleRuns) && d.titleRuns.length ? d.titleRuns : [{ text: d.title || '', tone: null }];
  s.addText(buildRuns(parts, p, { fontSize: 34, bold: true, color: p.bodyDark }), { x: 0.9, y: 1.15, w: W - 1.8, h: 1.9, fontFace: FONT, lineSpacingMultiple: 1.15 });
  if (d.cardTitle || d.cardBody) {
    s.addShape('roundRect', { x: 0.9, y: 3.5, w: W - 1.8, h: 2.7, rectRadius: 0.12, fill: { color: p.cardBg }, line: { color: p.border, width: 1 }, shadow: cardShadow(p) });
    if (d.cardTitle) s.addText(d.cardTitle, { x: 1.3, y: 3.85, w: W - 2.6, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: p.bodyDark });
    if (d.cardBody) s.addText(d.cardBody, { x: 1.3, y: 4.5, w: W - 2.6, h: 1.5, fontFace: FONT, fontSize: 14.5, color: p.bodyText, lineSpacingMultiple: 1.6 });
  }
}

function slide_questionTransition(s, d, p) {
  s.background = { color: p.dark };
  s.addText(d.text || '', { x: 0.8, y: 2.6, w: W - 1.6, h: 2.2, align: 'center', fontFace: FONT, fontSize: 38, bold: true, color: 'FFFFFF', lineSpacingMultiple: 1.2 });
}

function slide_iconGrid(s, d, p) {
  s.background = { color: 'FFFFFF' };
  s.addText(d.title || '', { x: 0.9, y: 0.65, w: W - 1.8, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: p.bodyDark });
  if (d.description) s.addText(d.description, { x: 0.9, y: 1.35, w: W - 1.8, h: 0.9, fontFace: FONT, fontSize: 14.5, color: p.bodyText, lineSpacingMultiple: 1.5 });
  const items = Array.isArray(d.items) ? d.items.slice(0, 6) : [];
  if (items.length) {
    const cardW = Math.min(2.3, (W - 1.8 - (items.length - 1) * 0.2) / items.length);
    const totalW = cardW * items.length + 0.2 * (items.length - 1);
    const startX = (W - totalW) / 2, cardY = 2.9, cardH = 2.3;
    items.forEach((label, i) => {
      const x = startX + i * (cardW + 0.2);
      s.addShape('roundRect', { x, y: cardY, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: p.cardBg }, line: { color: p.border, width: 1 }, shadow: cardShadow(p) });
      s.addShape('ellipse', { x: x + cardW / 2 - 0.32, y: cardY + 0.32, w: 0.64, h: 0.64, fill: { color: p.soft }, line: { type: 'none' } });
      s.addText((i + 1).toString(), { x: x + cardW / 2 - 0.32, y: cardY + 0.32, w: 0.64, h: 0.64, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 20, bold: true, color: p.accent });
      s.addText(label, { x: x + 0.1, y: cardY + 1.15, w: cardW - 0.2, h: 1.0, align: 'center', fontFace: FONT, fontSize: 14, bold: true, color: p.bodyDark, lineSpacingMultiple: 1.25 });
    });
  }
  if (d.footerLine) s.addText(d.footerLine, { x: 0.9, y: 5.6, w: W - 1.8, h: 0.5, align: 'center', fontFace: FONT, fontSize: 15, bold: true, color: p.amber });
}

function slide_vsTransition(s, d, p) {
  s.background = { color: p.dark };
  s.addText(d.top || '', { x: 0, y: 2.0, w: W, h: 1.0, align: 'center', fontFace: FONT, fontSize: 48, bold: true, color: '6F9A87' });
  s.addText('vs', { x: 0, y: 2.85, w: W, h: 0.6, align: 'center', fontFace: FONT, fontSize: 22, color: 'CFE8DE' });
  s.addText(d.bottom || '', { x: 0, y: 3.35, w: W, h: 1.0, align: 'center', fontFace: FONT, fontSize: 48, bold: true, color: p.bright });
  if (d.caption) s.addText(d.caption, { x: 0, y: 4.6, w: W, h: 0.6, align: 'center', fontFace: FONT, fontSize: 18, color: 'FFFFFF' });
}

function slide_caseTable(s, d, p) {
  s.background = { color: 'FFFFFF' };
  if (d.caseLabel) s.addText(d.caseLabel, { x: 0.9, y: 0.55, w: 5, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: p.accent, charSpacing: 2 });
  s.addText(d.title || '', { x: 0.9, y: 0.92, w: W - 1.8, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: p.bodyDark });
  if (d.description) s.addText(d.description, { x: 0.9, y: 1.55, w: W - 1.8, h: 0.7, fontFace: FONT, fontSize: 13.5, color: p.bodyText, lineSpacingMultiple: 1.5 });

  const cols = Array.isArray(d.columns) ? d.columns : [];
  const rows = Array.isArray(d.rows) ? d.rows : [];
  if (cols.length && rows.length) {
    const headerOpts = { fill: { color: p.dark }, color: 'FFFFFF', bold: true, fontFace: FONT, fontSize: 13.5, align: 'center', valign: 'middle' };
    const firstColW = 3.2, restW = (W - 1.8 - firstColW) / (cols.length - 1);
    const tableRows = [cols.map((c, i) => ({ text: c, options: headerOpts }))];
    rows.forEach(row => {
      tableRows.push(row.map((cell, i) => {
        const isHighlight = i === row.length - 1 && row.__highlight !== false && cols.length === 3;
        return { text: cell, options: { fontFace: FONT, fontSize: 13, align: 'center', valign: 'middle', fill: { color: i > 0 && i === cols.length - 1 ? p.soft : 'FFFFFF' }, bold: i > 0 && i === cols.length - 1 } };
      }));
    });
    s.addTable(tableRows, {
      x: 0.9, y: 2.5, w: W - 1.8, h: 2.7, fontFace: FONT, fontSize: 13.5, color: p.bodyDark,
      border: { type: 'solid', color: p.border, pt: 1 }, autoPage: false,
      colW: [firstColW, ...Array(cols.length - 1).fill(restW)]
    });
  }

  if (d.summaryLabel || d.summaryValue) {
    s.addShape('roundRect', { x: 0.9, y: 5.5, w: W - 1.8, h: 1.35, rectRadius: 0.1, fill: { color: p.dark }, line: { type: 'none' }, shadow: cardShadow(p) });
    if (d.summaryLabel) s.addText(d.summaryLabel, { x: 1.3, y: 5.72, w: W - 2.6, h: 0.4, fontFace: FONT, fontSize: 14, color: 'CFE8DE' });
    if (d.summaryValue) s.addText(d.summaryValue, { x: 1.3, y: 6.08, w: W - 2.6, h: 0.65, fontFace: FONT, fontSize: 26, bold: true, color: p.bright });
  }
}

function slide_summaryCards(s, d, p) {
  s.background = { color: p.dark };
  s.addText(d.title || '', { x: 0, y: 0.8, w: W, h: 0.7, align: 'center', fontFace: FONT, fontSize: 26, bold: true, color: 'FFFFFF' });
  const cards = Array.isArray(d.cards) ? d.cards.slice(0, 3) : [];
  if (cards.length) {
    const gap = 0.5, cardW = Math.min(5.3, (W - 1.6 - gap * (cards.length - 1)) / cards.length);
    const totalW = cardW * cards.length + gap * (cards.length - 1);
    const startX = (W - totalW) / 2, cardY = 2.0, cardH = 3.6;
    cards.forEach((c, i) => {
      const x = startX + i * (cardW + gap);
      s.addShape('roundRect', { x, y: cardY, w: cardW, h: cardH, rectRadius: 0.12, fill: { color: p.darkCard }, line: { color: p.darkCardBorder, width: 1 }, shadow: darkShadow() });
      s.addText(c.label || '', { x: x + 0.4, y: cardY + 0.5, w: cardW - 0.8, h: 0.5, fontFace: FONT, fontSize: 15, color: 'CFE8DE' });
      s.addText(c.subLabel || '', { x: x + 0.4, y: cardY + 1.2, w: cardW - 0.8, h: 0.4, fontFace: FONT, fontSize: 12.5, color: '6F9A87' });
      s.addText(c.value || '', { x: x + 0.4, y: cardY + 1.6, w: cardW - 0.8, h: 1.0, fontFace: FONT, fontSize: 28, bold: true, color: p.bright });
    });
  }
  if (d.closingLine) s.addText(d.closingLine, { x: 0.8, y: 5.9, w: W - 1.6, h: 0.6, align: 'center', fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
}

function slide_cta(s, d, p) {
  s.background = { color: 'FFFFFF' };
  s.addText(d.question || '', { x: 0.8, y: 1.6, w: W - 1.6, h: 1.8, align: 'center', fontFace: FONT, fontSize: 28, bold: true, color: p.bodyDark, lineSpacingMultiple: 1.3 });
  if (d.buttonText) {
    s.addShape('roundRect', { x: W / 2 - 2.2, y: 4.1, w: 4.4, h: 0.95, rectRadius: 0.475, fill: { color: p.accent }, line: { type: 'none' }, shadow: cardShadow(p) });
    s.addText(d.buttonText, { x: W / 2 - 2.2, y: 4.1, w: 4.4, h: 0.95, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
  }
  if (d.subtext) s.addText(d.subtext, { x: 0.8, y: 5.4, w: W - 1.6, h: 0.6, align: 'center', fontFace: FONT, fontSize: 13.5, color: p.muted });
}

const RENDERERS = {
  hook: slide_hook,
  twoCompare: slide_twoCompare,
  statHighlight: slide_statHighlight,
  questionTransition: slide_questionTransition,
  iconGrid: slide_iconGrid,
  vsTransition: slide_vsTransition,
  caseTable: slide_caseTable,
  summaryCards: slide_summaryCards,
  cta: slide_cta
};

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method === 'GET') {
    return res.status(200).json({ palettes: PALETTE_NAMES });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { plan, paletteName } = req.body || {};
    if (!Array.isArray(plan) || !plan.length) {
      return res.status(400).json({ error: 'plan(슬라이드 배열)이 필요합니다.' });
    }
    const p = PALETTES[paletteName] || PALETTES[PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)]];

    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE';

    for (const item of plan) {
      const renderer = RENDERERS[item.type];
      if (!renderer) continue; // 알 수 없는 타입은 건너뛴다
      const s = pres.addSlide();
      renderer(s, item, p);
    }

    const buffer = await pres.write({ outputType: 'nodebuffer' });
    const base64 = buffer.toString('base64');
    return res.status(200).json({ ok: true, base64, paletteUsed: Object.keys(PALETTES).find(k => PALETTES[k] === p) });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

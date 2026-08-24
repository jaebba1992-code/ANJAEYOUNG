const { checkAppPassword } = require('./_auth');
const sharp = require('sharp');
const archiver = require('archiver');
const { PassThrough } = require('stream');

const CW = 1080, CH = 1350; // 4:5 인스타그램 카드뉴스 표준 사이즈
const FONT = "'Malgun Gothic', 'Noto Sans KR', sans-serif";

const DARK_BG = '141414';
const DARK_TEXT = 'FFFFFF';
const LIGHT_BG = 'F4F4F2';
const LIGHT_TEXT = '141414';
const RED = 'E8382E';
const DEFAULT_ACCENT = 'F5E028'; // 노란 형광펜

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 긴 텍스트를 대략적인 폭 기준으로 줄바꿈 (한글 기준 근사치)
function wrapText(text, maxCharsPerLine) {
  const lines = [];
  String(text).split('\n').forEach(paragraph => {
    let line = '';
    for (const ch of paragraph) {
      line += ch;
      if (line.length >= maxCharsPerLine && ch === ' ') {
        lines.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) lines.push(line.trim());
    if (!paragraph.trim()) lines.push('');
  });
  return lines;
}

// 텍스트를 (내용, bold여부) 토큰으로 분해 (**bold** 마크다운을 미리 파싱해서, 줄바꿈이 마크다운 경계를 깨지 않게 한다)
function tokenizeRich(text) {
  const tokens = []; // {text, bold}
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  parts.forEach(p => {
    if (!p) return;
    const bold = p.startsWith('**') && p.endsWith('**');
    const clean = bold ? p.slice(2, -2) : p;
    clean.split(/(\n)/).forEach(seg => {
      if (seg === '\n') { tokens.push({ text: '\n', bold: false, isBreak: true }); return; }
      seg.split(/( )/).forEach(word => {
        if (word === '') return;
        tokens.push({ text: word, bold });
      });
    });
  });
  return tokens;
}

// 토큰들을 maxCharsPerLine 기준으로 줄에 담는다 (단어/공백 단위로만 끊어서, 굵게 표시 구간이 줄 경계에서 깨지지 않는다)
function packLines(tokens, maxCharsPerLine) {
  const lines = [];
  let current = [];
  let currentLen = 0;
  tokens.forEach(tok => {
    if (tok.isBreak) {
      lines.push(current); current = []; currentLen = 0; return;
    }
    if (currentLen + tok.text.length > maxCharsPerLine && currentLen > 0 && tok.text !== ' ') {
      lines.push(current); current = []; currentLen = 0;
    }
    if (tok.text === ' ' && currentLen === 0) return; // 줄 맨 앞 공백은 버린다
    current.push(tok);
    currentLen += tok.text.length;
  });
  if (current.length) lines.push(current);
  return lines;
}

function renderRichLines(x, y, width, text, opts) {
  const { fontSize = 30, lineHeight = 1.55, accent = DEFAULT_ACCENT, fill = LIGHT_TEXT, weight = 400, align = 'left', maxCharsPerLine = 22 } = opts;
  const tokens = tokenizeRich(text);
  const lines = packLines(tokens, maxCharsPerLine);
  let svg = '';
  let cursorY = y;
  const anchor = align === 'center' ? 'middle' : 'start';
  const tx = align === 'center' ? x + width / 2 : x;
  lines.forEach(lineTokens => {
    if (!lineTokens.length) { cursorY += fontSize * lineHeight; return; }
    let tspanContent = '';
    lineTokens.forEach(tok => {
      const color = tok.bold ? `#${accent}` : `#${fill}`;
      const w = tok.bold ? 800 : weight;
      tspanContent += `<tspan font-weight="${w}" fill="${color}" xml:space="preserve">${esc(tok.text)}</tspan>`;
    });
    svg += `<text x="${tx}" y="${cursorY}" font-family="${FONT}" font-size="${fontSize}" text-anchor="${anchor}" xml:space="preserve">${tspanContent}</text>\n`;
    cursorY += fontSize * lineHeight;
  });
  return { svg, endY: cursorY };
}

function svgParagraph(x, y, width, text, opts) {
  return renderRichLines(x, y, width, text, opts);
}

function titleWithHighlight(x, y, width, runs, opts) {
  // runs: [{text, tone}] tone: 'accent'|'red'|null
  const { fontSize = 64, accent = DEFAULT_ACCENT, fill = DARK_TEXT, align = 'left', lineHeight = 1.2, maxCharsPerLine = 9 } = opts;
  const fullText = runs.map(r => r.text).join('');
  // 단순화: 전체를 한 줄로 합친 뒤 wrap, 각 tone은 원문 텍스트 매칭으로 재구성하기 어려우므로
  // 실전에서는 runs 각각을 개별 텍스트 블록으로 순차 배치한다 (줄바꿈은 각 run 단위)
  let cursorY = y;
  let svg = '';
  const anchor = align === 'center' ? 'middle' : 'start';
  const tx = align === 'center' ? x + width / 2 : x;
  runs.forEach(run => {
    const lines = wrapText(run.text, maxCharsPerLine);
    const color = run.tone === 'accent' ? `#${accent}` : run.tone === 'red' ? `#${RED}` : `#${fill}`;
    lines.forEach(line => {
      if (!line) return;
      svg += `<text x="${tx}" y="${cursorY}" font-family="${FONT}" font-size="${fontSize}" font-weight="800" text-anchor="${anchor}" fill="${color}" letter-spacing="-1" xml:space="preserve">${esc(line)}</text>\n`;
      cursorY += fontSize * lineHeight;
    });
  });
  return { svg, endY: cursorY };
}

function badgePill(x, y, text, opts = {}) {
  const { fill = 'none', stroke = 'FFFFFF', textColor = 'FFFFFF', fontSize = 24 } = opts;
  const w = text.length * fontSize * 0.62 + 50;
  const h = fontSize + 26;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${fill === 'none' ? 'none' : '#' + fill}" stroke="#${stroke}" stroke-width="2.5"/>
    <text x="${x + w/2}" y="${y + h/2 + fontSize*0.35}" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="#${textColor}" text-anchor="middle">${esc(text)}</text>
  `;
}

/* ================= 템플릿 ================= */

function tpl_darkCover(d, accent) {
  const badge = d.badge || '보험탈출구';
  const titleRuns = Array.isArray(d.titleRuns) ? d.titleRuns : [{ text: d.title || '', tone: null }];
  let inner = `<rect width="${CW}" height="${CH}" fill="#${DARK_BG}"/>`;
  inner += `<rect width="${CW}" height="${CH}" fill="url(#coverGrad)"/>`;
  inner += badgePill(70, 90, badge, { stroke: 'FFFFFF', textColor: 'FFFFFF' });
  const t = titleWithHighlight(70, 260, CW - 140, titleRuns, { fontSize: 78, accent, fill: DARK_TEXT, maxCharsPerLine: 8 });
  inner += t.svg;
  if (d.subtitle) {
    const s = svgParagraph(70, t.endY + 30, CW - 140, d.subtitle, { fontSize: 32, fill: 'D8D8D8', maxCharsPerLine: 20 });
    inner += s.svg;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="coverGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.15"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.9"/>
    </linearGradient></defs>
    ${inner}
  </svg>`;
}

function tpl_darkText(d, accent) {
  let inner = `<rect width="${CW}" height="${CH}" fill="#${DARK_BG}"/>`;
  let y = 130;
  if (d.eyebrow) {
    const e = svgParagraph(70, y, CW - 140, d.eyebrow, { fontSize: 32, fill: accent, weight: 800, maxCharsPerLine: 18 });
    inner += e.svg; y = e.endY + 24;
  }
  if (d.title) {
    const t = titleWithHighlight(70, y + 40, CW - 140, [{ text: d.title, tone: null }], { fontSize: 58, fill: DARK_TEXT, maxCharsPerLine: 11 });
    inner += t.svg; y = t.endY + 40;
  }
  if (d.body) {
    const b = svgParagraph(70, y + 20, CW - 140, d.body, { fontSize: 33, fill: 'EDEDED', lineHeight: 1.65, maxCharsPerLine: 20 });
    inner += b.svg;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function tpl_lightText(d, accent) {
  let inner = `<rect width="${CW}" height="${CH}" fill="#${LIGHT_BG}"/>`;
  let y = 300;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: null }], { fontSize: 52, fill: LIGHT_TEXT, maxCharsPerLine: 12 });
    inner += t.svg; y = t.endY + 50;
  }
  if (d.body) {
    const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 34, fill: LIGHT_TEXT, lineHeight: 1.7, maxCharsPerLine: 19, accent });
    inner += b.svg;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function tpl_caseFormula(d) {
  let inner = `<rect width="${CW}" height="${CH}" fill="#${LIGHT_BG}"/>`;
  let y = 260;
  if (d.caseLabel) {
    const cl = svgParagraph(70, y, CW - 140, d.caseLabel, { fontSize: 34, fill: LIGHT_TEXT, weight: 700, maxCharsPerLine: 20 });
    inner += cl.svg; y = cl.endY + 40;
  }
  if (d.description) {
    const desc = svgParagraph(70, y, CW - 140, d.description, { fontSize: 30, fill: '3A3A3A', lineHeight: 1.6, align: 'center', maxCharsPerLine: 20 });
    inner += desc.svg; y = desc.endY + 40;
  }
  const rows = Array.isArray(d.rows) ? d.rows : [];
  rows.forEach(row => {
    const r = svgParagraph(70, y, CW - 140, row, { fontSize: 30, fill: LIGHT_TEXT, lineHeight: 1.5, maxCharsPerLine: 22 });
    inner += r.svg; y = r.endY + 30;
  });
  if (d.totalLabel) {
    y += 30;
    inner += `<text x="${CW/2}" y="${y+40}" font-family="${FONT}" font-size="60" font-weight="800" text-anchor="middle" fill="#${RED}">${esc(d.totalLabel)}</text>`;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function tpl_ctaShare(d, accent) {
  let inner = `<rect width="${CW}" height="${CH}" fill="#${DARK_BG}"/>`;
  let y = 420;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: 'accent' }], { fontSize: 66, accent, fill: DARK_TEXT, align: 'center', maxCharsPerLine: 9 });
    inner += t.svg;
    y = t.endY + 40;
  }
  if (d.body) {
    const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 32, fill: 'DDDDDD', lineHeight: 1.7, align: 'center', maxCharsPerLine: 20 });
    inner += b.svg;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function tpl_outro(d) {
  let inner = `<rect width="${CW}" height="${CH}" fill="#FFFFFF"/>`;
  inner += `<text x="${CW/2}" y="330" font-family="${FONT}" font-size="56" font-weight="800" text-anchor="middle" fill="#2A5DB0">${esc(d.brandName || '보험탈출구')}</text>`;
  let y = 470;
  const disclaimer = d.disclaimer || '';
  const dl = svgParagraph(70, y, CW - 140, disclaimer, { fontSize: 27, fill: LIGHT_TEXT, weight: 700, align: 'center', lineHeight: 1.65, maxCharsPerLine: 24 });
  inner += dl.svg; y = dl.endY + 40;
  if (d.regInfo) {
    const reg = svgParagraph(70, y, CW - 140, d.regInfo, { fontSize: 25, fill: '444444', align: 'center', lineHeight: 1.7, maxCharsPerLine: 26 });
    inner += reg.svg; y = reg.endY + 40;
  }
  if (d.noticeList) {
    const nl = svgParagraph(70, y, CW - 140, d.noticeList, { fontSize: 22, fill: '222222', weight: 600, lineHeight: 1.65, maxCharsPerLine: 30 });
    inner += nl.svg;
  }
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

const RENDERERS = {
  darkCover: tpl_darkCover,
  darkText: tpl_darkText,
  lightText: tpl_lightText,
  caseFormula: (d) => tpl_caseFormula(d),
  ctaShare: tpl_ctaShare,
  outro: (d) => tpl_outro(d)
};

async function fetchUnsplashPhoto(query, accessKey) {
  if (!accessKey || !query) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`;
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
    const data = await r.json();
    const photo = (data.results || [])[0];
    if (!photo) return null;
    const imgUrl = photo.urls.regular;
    const imgRes = await fetch(imgUrl);
    return Buffer.from(await imgRes.arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function renderCard(item, accent) {
  const renderer = RENDERERS[item.type];
  if (!renderer) return null;

  if (item.type === 'darkCover' && item.photoQuery) {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    const photoBuf = await fetchUnsplashPhoto(item.photoQuery, accessKey);
    const overlaySvg = renderer(item, accent);
    if (photoBuf) {
      const bg = await sharp(photoBuf).resize(CW, CH, { fit: 'cover' }).toBuffer();
      const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
      return await sharp(bg).composite([{ input: overlayPng }]).png().toBuffer();
    }
    return await sharp(Buffer.from(overlaySvg)).png().toBuffer();
  }

  const svg = renderer(item, accent);
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { plan, accent } = req.body || {};
    if (!Array.isArray(plan) || !plan.length) {
      return res.status(400).json({ error: 'plan(카드 배열)이 필요합니다.' });
    }
    const accentColor = (accent || DEFAULT_ACCENT).replace('#', '');

    const pngBuffers = [];
    for (const item of plan) {
      const buf = await renderCard(item, accentColor);
      if (buf) pngBuffers.push(buf);
    }
    if (!pngBuffers.length) {
      return res.status(400).json({ error: '카드를 하나도 만들지 못했어요.' });
    }

    const chunks = [];
    const passthrough = new PassThrough();
    passthrough.on('data', c => chunks.push(c));
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(passthrough);
    pngBuffers.forEach((buf, i) => {
      archive.append(buf, { name: `${i + 1}.png` });
    });
    const finished = new Promise((resolve, reject) => {
      passthrough.on('end', resolve);
      passthrough.on('error', reject);
      archive.on('error', reject);
    });
    await archive.finalize();
    await finished;

    const zipBuffer = Buffer.concat(chunks);
    return res.status(200).json({ ok: true, base64: zipBuffer.toString('base64'), count: pngBuffers.length });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

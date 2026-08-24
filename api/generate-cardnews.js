const { checkAppPassword } = require('./_auth');
const sharp = require('sharp');
const archiver = require('archiver');
const opentype = require('opentype.js');
const { PassThrough } = require('stream');

const CW = 1080, CH = 1350; // 4:5 인스타그램 카드뉴스 표준 사이즈
const MAX_CARDS = 10; // 카드뉴스는 최대 10장까지만 만든다 (하드 캡)

/* ================= 폰트: 텍스트를 벡터 경로(도형)로 직접 그린다 =================
   서버(Vercel)에는 한글 폰트가 기본으로 없고, SVG의 @font-face 임베딩은 서버리스
   환경(librsvg)에 따라 지원 여부가 갈려서 실제로 깨지는 사례가 있었다.
   그래서 텍스트를 <text>로 그리는 대신, opentype.js로 폰트 파일을 직접 읽어서
   글자 하나하나를 <path>(벡터 도형)로 변환해 그린다 — 렌더링 서버에 폰트가
   설치되어 있는지와 완전히 무관하게, 항상 100% 동일하게 나온다.
   .ttf 바이너리 대신 .js 파일 안에 base64 텍스트로 담아둔다 — GitHub 웹 업로드로
   바이너리 파일이 누락되는 사고를 막기 위함 (다른 .js 코드 파일과 동일하게 취급됨). */
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

// Noto Sans KR에는 화살표·이모지·일부 기호가 없어서(.notdef, 빈 네모로 깨짐) —
// 자주 쓰는 기호는 안전한 대체 표기로 미리 바꿔두고,
// 그래도 폰트에 없는 글자가 남아 있으면 draw 단계에서 건너뛴다 (아래 hasGlyph 참고).
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
  const key = font === FONT_REGULAR ? 'R' : font === FONT_BOLD ? 'B' : 'E';
  const cacheKey = key + ch;
  if (glyphCache.has(cacheKey)) return glyphCache.get(cacheKey);
  const ok = ch === ' ' || ch === '\n' || font.charToGlyph(ch).index !== 0;
  glyphCache.set(cacheKey, ok);
  return ok;
}

// 폰트 파일 하나에서 나온 glyph outline commands를, 우리가 직접 좌표를 더해가며
// path 'd' 문자열로 만든다 — opentype.js의 getPath(text,x,y,size)에 오프셋을
// 직접 넘기면 특정 좌표 조합에서 곡선 근사 계산이 NaN을 내는 버그가 있어서,
// 항상 원점(0,0) 기준 outline만 얻고 이동은 우리가 직접 계산한다 (버그 회피).
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

// 문자열 폭 측정 (letterSpacing 포함). 폰트에 없는 글자(이모지 등)는 공백 정도의 폭으로 취급.
function measureText(text, fontSize, weight, letterSpacing = 0) {
  const font = pickFont(weight);
  const chars = Array.from(sanitizeForFont(text));
  if (!chars.length) return 0;
  let w = 0;
  chars.forEach(ch => {
    w += (hasGlyph(font, ch) ? font.getAdvanceWidth(ch, fontSize) : fontSize * 0.5) + letterSpacing;
  });
  return w - letterSpacing;
}

// 텍스트를 <path> 도형으로 그려서 svg 조각 문자열을 반환. 폰트에 없는 글자는
// 깨진 네모(.notdef)로 그리는 대신 건너뛴다 (자리만 비워둠).
function drawText(text, x, y, fontSize, weight, fillHex, opts = {}) {
  const { letterSpacing = 0, fillOpacity } = opts;
  const str = sanitizeForFont(text);
  if (!str) return '';
  const font = pickFont(weight);
  let cursorX = x;
  let d = '';
  for (const ch of str) {
    if (!hasGlyph(font, ch)) {
      cursorX += fontSize * 0.5 + letterSpacing; // 폰트에 없는 글자는 공백만큼만 이동하고 건너뛴다
      continue;
    }
    const glyphPath = font.getPath(ch, 0, 0, fontSize); // 항상 원점 기준으로만 얻는다 (NaN 버그 회피)
    d += commandsToPathD(glyphPath.commands, cursorX, y, 1);
    cursorX += font.getAdvanceWidth(ch, fontSize) + letterSpacing;
  }
  if (!d) return '';
  const op = fillOpacity != null ? ` fill-opacity="${fillOpacity}"` : '';
  return `<path d="${d}" fill="#${fillHex}"${op}/>`;
}

/* ================= 디자인 테마 3종 ================= */
const THEMES = {
  minimal: {
    label: '미니멀 화이트',
    darkBg: '2B2B29', lightBg: 'FFFFFF', outroBg: 'FFFFFF',
    darkText: 'FFFFFF', lightText: '191919',
    mutedOnDark: 'C9C9C4', mutedOnLight: '6E6E68',
    red: 'B23A2E',
    coverOverlay: [0.08, 0.38, 0.80],
    gradient: null,
    badgeStroke: true
  },
  darkMagazine: {
    label: '다크 매거진',
    darkBg: '0A0A0B', lightBg: '18181B', outroBg: 'FFFFFF',
    darkText: 'F6F5F1', lightText: 'F6F5F1',
    mutedOnDark: 'B9B7AE', mutedOnLight: 'B9B7AE',
    red: 'E8382E',
    coverOverlay: [0.22, 0.60, 0.94],
    gradient: null,
    badgeStroke: true
  },
  gradientPop: {
    label: '그라데이션 팝',
    darkBg: '1B1030', lightBg: 'FFF3E9', outroBg: 'FFFFFF',
    darkText: 'FFFFFF', lightText: '2A1B3D',
    mutedOnDark: 'E4D9FF', mutedOnLight: '8A7397',
    red: 'FF4D6D',
    coverOverlay: [0.05, 0.32, 0.72],
    gradient: { dark: ['5B2A86', 'FF4D8D'], light: ['FFE3C7', 'FFD1E3'] },
    badgeStroke: false
  }
};
const DEFAULT_THEME = 'minimal';
const DEFAULT_ACCENT = 'F5E028'; // 노란 형광펜

function getTheme(key) {
  return THEMES[key] || THEMES[DEFAULT_THEME];
}

// 긴 텍스트를 대략적인 폭 기준으로 줄바꿈 (한글 기준 근사치 — 문자 수 기반)
function wrapText(text, maxCharsPerLine) {
  const lines = [];
  String(sanitizeForFont(text)).split('\n').forEach(paragraph => {
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
  const parts = String(sanitizeForFont(text)).split(/(\*\*[^*]+\*\*)/g);
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
  const { fontSize = 30, lineHeight = 1.55, accent = DEFAULT_ACCENT, fill = '191919', weight = 400, align = 'left', maxCharsPerLine = 22 } = opts;
  const tokens = tokenizeRich(text);
  const lines = packLines(tokens, maxCharsPerLine);
  let svg = '';
  let cursorY = y;
  lines.forEach(lineTokens => {
    if (!lineTokens.length) { cursorY += fontSize * lineHeight; return; }
    let totalWidth = 0;
    lineTokens.forEach(tok => {
      const w = tok.bold ? 800 : weight;
      totalWidth += measureText(tok.text, fontSize, w);
    });
    let cursorX = align === 'center' ? (x + width / 2 - totalWidth / 2) : x;
    lineTokens.forEach(tok => {
      const w = tok.bold ? 800 : weight;
      const color = tok.bold ? accent : fill;
      svg += drawText(tok.text, cursorX, cursorY, fontSize, w, color);
      cursorX += measureText(tok.text, fontSize, w);
    });
    cursorY += fontSize * lineHeight;
  });
  return { svg, endY: cursorY };
}

function svgParagraph(x, y, width, text, opts) {
  return renderRichLines(x, y, width, text, opts);
}

function titleWithHighlight(x, y, width, runs, opts) {
  // runs: [{text, tone}] tone: 'accent'|'red'|null
  const { fontSize = 64, accent = DEFAULT_ACCENT, fill = 'FFFFFF', align = 'left', lineHeight = 1.2, maxCharsPerLine = 9, red = 'E8382E' } = opts;
  let cursorY = y;
  let svg = '';
  const letterSpacing = -1;
  runs.forEach(run => {
    const lines = wrapText(run.text, maxCharsPerLine);
    const color = run.tone === 'accent' ? accent : run.tone === 'red' ? red : fill;
    lines.forEach(line => {
      if (!line) { cursorY += fontSize * lineHeight; return; }
      const w = measureText(line, fontSize, 800, letterSpacing);
      const lx = align === 'center' ? (x + width / 2 - w / 2) : x;
      svg += drawText(line, lx, cursorY, fontSize, 800, color, { letterSpacing });
      cursorY += fontSize * lineHeight;
    });
  });
  return { svg, endY: cursorY };
}

function badgePill(x, y, text, opts = {}) {
  const { fill = 'none', stroke = 'FFFFFF', textColor = 'FFFFFF', fontSize = 24 } = opts;
  const textW = measureText(text, fontSize, 700);
  const w = textW + 50;
  const h = fontSize + 26;
  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill === 'none' ? 'none' : '#' + fill}" stroke="#${stroke}" stroke-width="2.5"/>`;
  svg += drawText(text, x + (w - textW) / 2, y + h / 2 + fontSize * 0.35, fontSize, 700, textColor);
  return svg;
}

// 카드 우측 하단에 은은하게 찍는 채널명 워터마크
function watermarkStamp(channelName, theme, variant) {
  const name = String(channelName || '').trim();
  if (!name) return '';
  const color = variant === 'dark' ? theme.mutedOnDark : theme.mutedOnLight;
  const fontSize = 21, letterSpacing = 0.5;
  const w = measureText(name, fontSize, 700, letterSpacing);
  return drawText(name, CW - 46 - w, CH - 40, fontSize, 700, color, { letterSpacing, fillOpacity: 0.5 });
}

// 배경(단색 또는 테마의 그라데이션)을 반환
function bgLayer(theme, variant) {
  if (theme.gradient && (variant === 'dark' || variant === 'light')) {
    const colors = theme.gradient[variant];
    return {
      defs: `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#${colors[0]}"/>
        <stop offset="100%" stop-color="#${colors[1]}"/>
      </linearGradient>`,
      rect: `<rect width="${CW}" height="${CH}" fill="url(#bgGrad)"/>`
    };
  }
  const fillColor = variant === 'outro' ? theme.outroBg : (variant === 'dark' ? theme.darkBg : theme.lightBg);
  return { defs: '', rect: `<rect width="${CW}" height="${CH}" fill="#${fillColor}"/>` };
}

// 모든 템플릿이 공통으로 쓰는 svg 문서 래퍼: 배경 defs + 본문 + 워터마크
function svgDoc(bg, inner, watermarkSvg) {
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
    <defs>${bg.defs}</defs>
    ${bg.rect}
    ${inner}
    ${watermarkSvg}
  </svg>`;
}

/* ================= 템플릿 ================= */

function tpl_darkCover(d, accent, theme, channelName) {
  const badge = d.badge || channelName || '보험탈출구';
  const titleRuns = Array.isArray(d.titleRuns) ? d.titleRuns : [{ text: d.title || '', tone: null }];
  const bg = bgLayer(theme, 'dark');
  const [op1, op2, op3] = theme.coverOverlay;
  let inner = `<rect width="${CW}" height="${CH}" fill="url(#coverGrad)"/>`;
  inner += badgePill(70, 90, badge, { stroke: theme.darkText, textColor: theme.darkText, fill: theme.badgeStroke ? 'none' : theme.red });
  const t = titleWithHighlight(70, 260, CW - 140, titleRuns, { fontSize: 78, accent, fill: theme.darkText, red: theme.red, maxCharsPerLine: 8 });
  inner += t.svg;
  if (d.subtitle) {
    const s = svgParagraph(70, t.endY + 30, CW - 140, d.subtitle, { fontSize: 32, fill: theme.mutedOnDark, maxCharsPerLine: 20 });
    inner += s.svg;
  }
  const gradDefs = `<linearGradient id="coverGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="${op1}"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="${op2}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="${op3}"/>
    </linearGradient>`;
  return svgDoc({ defs: bg.defs + gradDefs, rect: bg.rect }, inner, watermarkStamp(channelName, theme, 'dark'));
}

function tpl_darkText(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'dark');
  let inner = '';
  let y = 130;
  if (d.eyebrow) {
    const e = svgParagraph(70, y, CW - 140, d.eyebrow, { fontSize: 32, fill: accent, weight: 800, maxCharsPerLine: 18 });
    inner += e.svg; y = e.endY + 24;
  }
  if (d.title) {
    const t = titleWithHighlight(70, y + 40, CW - 140, [{ text: d.title, tone: null }], { fontSize: 58, fill: theme.darkText, red: theme.red, maxCharsPerLine: 11 });
    inner += t.svg; y = t.endY + 40;
  }
  if (d.body) {
    const b = svgParagraph(70, y + 20, CW - 140, d.body, { fontSize: 33, fill: theme.mutedOnDark, weight: 500, accent, lineHeight: 1.65, maxCharsPerLine: 20 });
    inner += b.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'dark'));
}

function tpl_lightText(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'light');
  let inner = '';
  let y = 300;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: null }], { fontSize: 52, fill: theme.lightText, red: theme.red, maxCharsPerLine: 12 });
    inner += t.svg; y = t.endY + 50;
  }
  if (d.body) {
    const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 34, fill: theme.lightText, lineHeight: 1.7, maxCharsPerLine: 19, accent });
    inner += b.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'light'));
}

function tpl_caseFormula(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'light');
  let inner = '';
  let y = 260;
  if (d.caseLabel) {
    const cl = svgParagraph(70, y, CW - 140, d.caseLabel, { fontSize: 34, fill: theme.lightText, weight: 700, maxCharsPerLine: 20 });
    inner += cl.svg; y = cl.endY + 40;
  }
  if (d.description) {
    const desc = svgParagraph(70, y, CW - 140, d.description, { fontSize: 30, fill: theme.mutedOnLight, lineHeight: 1.6, align: 'center', maxCharsPerLine: 20 });
    inner += desc.svg; y = desc.endY + 40;
  }
  const rows = Array.isArray(d.rows) ? d.rows : [];
  rows.forEach(row => {
    const r = svgParagraph(70, y, CW - 140, row, { fontSize: 30, fill: theme.lightText, lineHeight: 1.5, maxCharsPerLine: 22 });
    inner += r.svg; y = r.endY + 30;
  });
  if (d.totalLabel) {
    y += 30;
    const fontSize = 60;
    const w = measureText(d.totalLabel, fontSize, 800);
    inner += drawText(d.totalLabel, CW / 2 - w / 2, y + 40, fontSize, 800, theme.red);
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'light'));
}

function tpl_ctaShare(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'dark');
  let inner = '';
  let y = 420;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: 'accent' }], { fontSize: 66, accent, fill: theme.darkText, red: theme.red, align: 'center', maxCharsPerLine: 9 });
    inner += t.svg;
    y = t.endY + 40;
  }
  if (d.body) {
    const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 32, fill: theme.mutedOnDark, lineHeight: 1.7, align: 'center', maxCharsPerLine: 20 });
    inner += b.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'dark'));
}

function tpl_outro(d, accent, theme, channelName) {
  // 심의/법적 문구가 들어가는 마지막 장은 가독성이 최우선이라, 테마와 무관하게 항상 흰 배경 + 진한 텍스트로 고정한다.
  const bg = { defs: '', rect: `<rect width="${CW}" height="${CH}" fill="#FFFFFF"/>` };
  const brandName = d.brandName || channelName || '보험탈출구';
  const brandFontSize = 56;
  const brandW = measureText(brandName, brandFontSize, 800);
  let inner = drawText(brandName, CW / 2 - brandW / 2, 330, brandFontSize, 800, '2A5DB0');
  let y = 470;
  const disclaimer = d.disclaimer || '';
  const dl = svgParagraph(70, y, CW - 140, disclaimer, { fontSize: 27, fill: '191919', weight: 700, align: 'center', lineHeight: 1.65, maxCharsPerLine: 24 });
  inner += dl.svg; y = dl.endY + 40;
  if (d.regInfo) {
    const reg = svgParagraph(70, y, CW - 140, d.regInfo, { fontSize: 25, fill: '444444', align: 'center', lineHeight: 1.7, maxCharsPerLine: 26 });
    inner += reg.svg; y = reg.endY + 40;
  }
  if (d.noticeList) {
    const nl = svgParagraph(70, y, CW - 140, d.noticeList, { fontSize: 22, fill: '222222', weight: 700, lineHeight: 1.65, maxCharsPerLine: 30 });
    inner += nl.svg;
  }
  return svgDoc(bg, inner, '');
}

const RENDERERS = {
  darkCover: tpl_darkCover,
  darkText: tpl_darkText,
  lightText: tpl_lightText,
  caseFormula: tpl_caseFormula,
  ctaShare: tpl_ctaShare,
  outro: tpl_outro
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

async function renderCard(item, accent, theme, channelName) {
  const renderer = RENDERERS[item.type];
  if (!renderer) return null;

  if (item.type === 'darkCover' && item.photoQuery) {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    const photoBuf = await fetchUnsplashPhoto(item.photoQuery, accessKey);
    const overlaySvg = renderer(item, accent, theme, channelName);
    if (photoBuf) {
      const bg = await sharp(photoBuf).resize(CW, CH, { fit: 'cover' }).toBuffer();
      const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
      return await sharp(bg).composite([{ input: overlayPng }]).png().toBuffer();
    }
    return await sharp(Buffer.from(overlaySvg)).png().toBuffer();
  }

  const svg = renderer(item, accent, theme, channelName);
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
    const { plan, accent, theme: themeKey, channelName } = req.body || {};
    if (!Array.isArray(plan) || !plan.length) {
      return res.status(400).json({ error: 'plan(카드 배열)이 필요합니다.' });
    }
    const cappedPlan = plan.slice(0, MAX_CARDS); // 카드뉴스는 최대 10장까지만 만든다
    const accentColor = (accent || DEFAULT_ACCENT).replace('#', '');
    const theme = getTheme(themeKey);

    const pngBuffers = [];
    for (const item of cappedPlan) {
      const buf = await renderCard(item, accentColor, theme, channelName);
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

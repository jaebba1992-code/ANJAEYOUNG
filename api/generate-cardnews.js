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

// 모든 템플릿이 공통으로 쓰는 svg 문서 래퍼: 배경 defs + 코너 액센트(같은 계정이라는 통일감) + 본문 + 워터마크
function svgDoc(bg, inner, watermarkSvg, accentColor) {
  const corner = accentColor ? cornerAccent(accentColor) : '';
  return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
    <defs>${bg.defs}</defs>
    ${bg.rect}
    ${corner}
    ${inner}
    ${watermarkSvg}
  </svg>`;
}

/* ================= 디자인 요소 (아이콘·배지·그래프를 폰트 글리프가 아니라 직접 벡터로 그린다) ================= */

// 카드 우상단 구석에 은은한 사분원 — 모든 카드에 깔려서 "같은 계정" 통일감을 준다
function cornerAccent(accentColor) {
  return `<circle cx="${CW}" cy="0" r="140" fill="#${accentColor}" fill-opacity="0.08"/>`;
}

// 배경색에 대비되는 텍스트 색(검정/흰색)을 골라준다 — 밝은 강조색 위엔 검정, 어두운 색 위엔 흰색
function contrastTextColor(hex) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '191919' : 'FFFFFF';
}

// 체크(✓) 아이콘을 직접 그린다 (폰트 글리프 아님 — 어떤 환경에서도 동일하게 나옴)
function iconCheck(x, y, size, color) {
  const s = size / 24;
  return `<path d="M ${x+4*s} ${y+13*s} L ${x+9*s} ${y+18*s} L ${x+20*s} ${y+6*s}" stroke="#${color}" stroke-width="${3*s}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}
// 엑스(✗) 아이콘을 직접 그린다
function iconX(x, y, size, color) {
  const s = size / 24;
  return `<path d="M ${x+5*s} ${y+5*s} L ${x+19*s} ${y+19*s} M ${x+19*s} ${y+5*s} L ${x+5*s} ${y+19*s}" stroke="#${color}" stroke-width="${3*s}" stroke-linecap="round" fill="none"/>`;
}
function iconDot(x, y, size, color) {
  const s = size / 24;
  return `<circle cx="${x+12*s}" cy="${y+12*s}" r="${4*s}" fill="#${color}"/>`;
}
function drawMarkerIcon(mark, x, y, size, colors) {
  if (mark === 'check') return iconCheck(x, y, size, colors.check || '2FA35C');
  if (mark === 'x') return iconX(x, y, size, colors.x || 'E8382E');
  return iconDot(x, y, size, colors.dot || colors.check || '888888');
}

// 체크/엑스 아이콘이 앞에 붙는 리스트 (여러 항목을 스캔하기 쉽게)
function markerList(x, y, width, items, opts) {
  const { fontSize = 30, lineHeight = 1.55, fill = '191919', weight = 500, maxCharsPerLine = 17, markColors = {} } = opts;
  let cursorY = y;
  let svg = '';
  (items || []).forEach(item => {
    const text = typeof item === 'string' ? item : (item.text || '');
    const mark = typeof item === 'string' ? 'check' : (item.mark || 'check');
    const lines = wrapText(text, maxCharsPerLine);
    svg += drawMarkerIcon(mark, x, cursorY - fontSize * 0.78, fontSize * 0.9, markColors);
    lines.forEach((line, i) => {
      svg += drawText(line, x + fontSize * 1.25, cursorY, fontSize, weight, fill);
      cursorY += fontSize * lineHeight;
    });
  });
  return { svg, endY: cursorY };
}

// 큰 원 안에 숫자/퍼센트를 강조하는 "스탯 배지" — 보험 계정 특유의 시그니처 요소
function statCircle(cx, cy, r, valueText, unitText, accentColor) {
  const textColor = contrastTextColor(accentColor);
  let svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${accentColor}"/>`;
  const valueFontSize = r * 0.62;
  const valueW = measureText(valueText, valueFontSize, 800, -2);
  svg += drawText(valueText, cx - valueW / 2, cy + valueFontSize * 0.32, valueFontSize, 800, textColor, { letterSpacing: -2 });
  if (unitText) {
    const unitFontSize = r * 0.16;
    const unitW = measureText(unitText, unitFontSize, 700);
    svg += drawText(unitText, cx - unitW / 2, cy + valueFontSize * 0.32 + unitFontSize * 1.5, unitFontSize, 700, textColor, { fillOpacity: 0.85 });
  }
  return svg;
}

// 막대 길이로 두 값을 비교하는 그래프 (텍스트 나열보다 훨씬 직관적)
function comparisonBar(x, y, width, label, valueText, ratio, barColor, labelColor, trackColor) {
  const labelFontSize = 24, valueFontSize = 32, barH = 46;
  let svg = drawText(label, x, y, labelFontSize, 600, labelColor);
  const trackY = y + 16;
  svg += `<rect x="${x}" y="${trackY}" width="${width}" height="${barH}" rx="${barH/2}" fill="#${trackColor}" fill-opacity="0.5"/>`;
  const barW = Math.max(barH, width * Math.min(1, Math.max(0, ratio)));
  svg += `<rect x="${x}" y="${trackY}" width="${barW}" height="${barH}" rx="${barH/2}" fill="#${barColor}"/>`;
  const valueW = measureText(valueText, valueFontSize, 800);
  const valueInsideBar = barW > valueW + 40;
  const valueX = valueInsideBar ? x + barW - valueW - 22 : x + barW + 16;
  const valueColor = valueInsideBar ? contrastTextColor(barColor) : labelColor;
  svg += drawText(valueText, valueX, trackY + barH / 2 + valueFontSize * 0.34, valueFontSize, 800, valueColor);
  return { svg, endY: trackY + barH };
}

/* ================= 템플릿 ================= */

function tpl_darkCover(d, accent, theme, channelName, opts = {}) {
  const badge = d.badge || channelName || '보험탈출구';
  const titleRuns = Array.isArray(d.titleRuns) ? d.titleRuns : [{ text: d.title || '', tone: null }];
  const [op1, op2, op3] = theme.coverOverlay;
  // 사진 위에 합성할 때는 불투명 배경을 그리지 않는다 (그리면 사진이 완전히 가려짐).
  // 사진이 없을 때만 테마 배경색을 채운다.
  const usePhoto = !!opts.transparentBg;
  const bg = usePhoto ? { defs: '', rect: '' } : bgLayer(theme, 'dark');
  let inner = `<rect width="${CW}" height="${CH}" fill="url(#coverGrad)"/>`;
  inner += badgePill(70, 90, badge, { stroke: theme.darkText, textColor: theme.darkText, fill: theme.badgeStroke ? 'none' : theme.red });
  const t = titleWithHighlight(70, 260, CW - 140, titleRuns, { fontSize: 78, accent, fill: theme.darkText, red: theme.red, maxCharsPerLine: 8 });
  inner += t.svg;
  if (d.subtitle) {
    const s = svgParagraph(70, t.endY + 30, CW - 140, d.subtitle, { fontSize: 32, fill: theme.mutedOnDark, maxCharsPerLine: 20 });
    inner += s.svg;
  }
  // 사진 위에 얹을 때는 텍스트 가독성을 위해 그라데이션을 조금 더 진하게 준다.
  const [pOp1, pOp2, pOp3] = usePhoto ? [Math.max(op1, 0.28), Math.max(op2, 0.55), Math.max(op3, 0.88)] : [op1, op2, op3];
  const gradDefs = `<linearGradient id="coverGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="${pOp1}"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="${pOp2}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="${pOp3}"/>
    </linearGradient>`;
  if (usePhoto) {
    // 투명 배경 SVG (사진과 합성될 것이므로 캔버스 배경 없이 그라데이션+텍스트만)
    return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
      <defs>${gradDefs}</defs>
      ${inner}
      ${watermarkStamp(channelName, theme, 'dark')}
    </svg>`;
  }
  return svgDoc({ defs: bg.defs + gradDefs, rect: bg.rect }, inner, watermarkStamp(channelName, theme, 'dark'), accent);
}

function tpl_darkText(d, accent, theme, channelName, opts = {}) {
  const usePhoto = !!opts.transparentBg;
  const bg = usePhoto ? { defs: '', rect: '' } : bgLayer(theme, 'dark');

  // 내용 전체 높이를 먼저 계산해서 캔버스 세로 중앙 쪽에 오도록 배치한다
  // (짧은 내용이 위쪽에만 몰리고 아래쪽이 텅 비어 보이는 문제를 줄이기 위함)
  function draw(startY) {
    let inner = usePhoto ? `<rect width="${CW}" height="${CH}" fill="#000000" fill-opacity="0.5"/>` : '';
    let y = startY;
    if (d.eyebrow) {
      const e = svgParagraph(70, y, CW - 140, d.eyebrow, { fontSize: 32, fill: accent, weight: 800, maxCharsPerLine: 18 });
      inner += e.svg; y = e.endY + 24;
    }
    if (d.title) {
      const t = titleWithHighlight(70, y + 40, CW - 140, [{ text: d.title, tone: null }], { fontSize: 62, fill: theme.darkText, red: theme.red, maxCharsPerLine: 10 });
      inner += t.svg; y = t.endY + 44;
    }
    if (d.body) {
      const b = svgParagraph(70, y + 20, CW - 140, d.body, { fontSize: 36, fill: theme.mutedOnDark, weight: 500, accent, lineHeight: 1.65, maxCharsPerLine: 18 });
      inner += b.svg; y = b.endY;
    }
    if (Array.isArray(d.listItems) && d.listItems.length) {
      const l = markerList(70, y + 34, CW - 140, d.listItems, { fontSize: 32, fill: theme.darkText, maxCharsPerLine: 16, markColors: { check: accent, x: theme.red } });
      inner += l.svg; y = l.endY;
    }
    return { inner, endY: y };
  }

  const dry = draw(170);
  const contentHeight = dry.endY - 170;
  const availableTop = 150, availableBottom = CH - 190;
  let startY = availableTop + Math.max(0, (availableBottom - availableTop - contentHeight) / 2);
  startY = Math.min(Math.max(startY, availableTop), 620);
  const final = draw(startY);

  if (usePhoto) {
    return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${final.inner}${watermarkStamp(channelName, theme, 'dark')}</svg>`;
  }
  return svgDoc(bg, final.inner, watermarkStamp(channelName, theme, 'dark'), accent);
}

function tpl_lightText(d, accent, theme, channelName, opts = {}) {
  const usePhoto = !!opts.transparentBg;
  const bg = usePhoto ? { defs: '', rect: '' } : bgLayer(theme, 'light');
  // 사진 위에 얹을 땐 밝은 배경 대신 어두운 오버레이 + 흰 글씨로 전환한다 (사진 위에 원래 색을 쓰면 안 보임)
  const textColor = usePhoto ? 'FFFFFF' : theme.lightText;
  const mutedColor = usePhoto ? 'E8E8E4' : theme.lightText;

  function draw(startY) {
    let inner = usePhoto ? `<rect width="${CW}" height="${CH}" fill="#000000" fill-opacity="0.5"/>` : '';
    let y = startY;
    if (d.title) {
      const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: null }], { fontSize: 56, fill: textColor, red: theme.red, maxCharsPerLine: 11 });
      inner += t.svg; y = t.endY + 50;
    }
    if (d.body) {
      const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 36, fill: mutedColor, lineHeight: 1.7, maxCharsPerLine: 17, accent });
      inner += b.svg; y = b.endY;
    }
    if (Array.isArray(d.listItems) && d.listItems.length) {
      const l = markerList(70, y + 34, CW - 140, d.listItems, { fontSize: 32, fill: textColor, maxCharsPerLine: 16, markColors: { check: accent, x: theme.red } });
      inner += l.svg; y = l.endY;
    }
    return { inner, endY: y };
  }

  const dry = draw(300);
  const contentHeight = dry.endY - 300;
  const availableTop = 190, availableBottom = CH - 190;
  let startY = availableTop + Math.max(0, (availableBottom - availableTop - contentHeight) / 2);
  startY = Math.min(Math.max(startY, availableTop), 650);
  const final = draw(startY);

  if (usePhoto) {
    return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${final.inner}${watermarkStamp(channelName, theme, 'dark')}</svg>`;
  }
  return svgDoc(bg, final.inner, watermarkStamp(channelName, theme, 'light'), accent);
}

function tpl_caseFormula(d, accent, theme, channelName, opts = {}) {
  const usePhoto = !!opts.transparentBg;
  const bg = usePhoto ? { defs: '', rect: '' } : bgLayer(theme, 'light');
  const textColor = usePhoto ? 'FFFFFF' : theme.lightText;
  const mutedColor = usePhoto ? 'E8E8E4' : theme.mutedOnLight;
  let inner = usePhoto ? `<rect width="${CW}" height="${CH}" fill="#000000" fill-opacity="0.5"/>` : '';
  let y = 260;
  if (d.caseLabel) {
    const cl = svgParagraph(70, y, CW - 140, d.caseLabel, { fontSize: 34, fill: textColor, weight: 700, maxCharsPerLine: 20 });
    inner += cl.svg; y = cl.endY + 40;
  }
  if (d.description) {
    const desc = svgParagraph(70, y, CW - 140, d.description, { fontSize: 30, fill: mutedColor, lineHeight: 1.6, align: 'center', maxCharsPerLine: 20 });
    inner += desc.svg; y = desc.endY + 40;
  }
  const rows = Array.isArray(d.rows) ? d.rows : [];
  rows.forEach(row => {
    const r = svgParagraph(70, y, CW - 140, row, { fontSize: 30, fill: textColor, lineHeight: 1.5, maxCharsPerLine: 22 });
    inner += r.svg; y = r.endY + 30;
  });
  if (d.totalLabel) {
    y += 30;
    const fontSize = 60;
    const w = measureText(d.totalLabel, fontSize, 800);
    inner += drawText(d.totalLabel, CW / 2 - w / 2, y + 40, fontSize, 800, theme.red);
  }
  if (usePhoto) {
    return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}${watermarkStamp(channelName, theme, 'dark')}</svg>`;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'light'), accent);
}

// 막대 길이로 두 값을 비교하는 카드 — 숫자만 나열하는 것보다 훨씬 눈에 잘 들어온다
// "A vs B" 나란히 비교하는 두 박스 카드 — 보험 계정에서 정말 자주 쓰는 레이아웃
// (구실손 vs 신실손, 우리 상품 vs 다른 상품처럼 항목별로 조목조목 비교할 때)
function tpl_twoColumn(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'light');
  let inner = '';
  let y = 130;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: null }], { fontSize: 46, fill: theme.lightText, red: theme.red, maxCharsPerLine: 14 });
    inner += t.svg; y = t.endY + 56;
  }
  const gap = 28;
  const colW = (CW - 140 - gap) / 2;
  const leftX = 70, rightX = 70 + colW + gap;
  const boxTop = y;
  const leftItems = Array.isArray(d.leftItems) ? d.leftItems : [];
  const rightItems = Array.isArray(d.rightItems) ? d.rightItems : [];
  const rowH = 76;
  const headerH = 84;
  const boxH = headerH + Math.max(leftItems.length, rightItems.length) * rowH + 36;

  function drawColumn(x, label, items, headerBg, headerText) {
    let s = `<rect x="${x}" y="${boxTop}" width="${colW}" height="${boxH}" rx="22" fill="#FFFFFF"/>`;
    s += `<rect x="${x}" y="${boxTop}" width="${colW}" height="${boxH}" rx="22" fill="none" stroke="#000000" stroke-opacity="0.06" stroke-width="2"/>`;
    s += `<rect x="${x}" y="${boxTop}" width="${colW}" height="${headerH}" rx="22" fill="#${headerBg}"/>`;
    s += `<rect x="${x}" y="${boxTop + headerH - 22}" width="${colW}" height="22" fill="#${headerBg}"/>`; // 하단 라운드 가리기 방지
    const labelFontSize = 30;
    const labelW = measureText(label, labelFontSize, 800);
    s += drawText(label, x + colW / 2 - labelW / 2, boxTop + headerH / 2 + labelFontSize * 0.35, labelFontSize, 800, headerText, { letterSpacing: -0.5 });
    let iy = boxTop + headerH + 30;
    items.forEach(item => {
      const text = typeof item === 'string' ? item : (item.text || '');
      const mark = typeof item === 'string' ? 'check' : (item.mark || 'check');
      s += drawMarkerIcon(mark, x + 24, iy - 22, 26, { check: '2FA35C', x: theme.red });
      const lines = wrapText(text, 11);
      lines.forEach((line, li) => {
        s += drawText(line, x + 60, iy + li * 34, 24, 600, theme.lightText);
      });
      iy += rowH;
    });
    return s;
  }

  inner += drawColumn(leftX, d.leftLabel || 'A', leftItems, d.leftColor || '9AA0A6', 'FFFFFF');
  inner += drawColumn(rightX, d.rightLabel || 'B', rightItems, accent, contrastTextColor(accent));

  // 가운데 VS 배지
  const vsR = 38;
  const vsCx = CW / 2, vsCy = boxTop + headerH;
  inner += `<circle cx="${vsCx}" cy="${vsCy}" r="${vsR}" fill="#${theme.lightBg === 'FFFFFF' ? '191919' : theme.red}"/>`;
  inner += `<circle cx="${vsCx}" cy="${vsCy}" r="${vsR}" fill="none" stroke="#${accent}" stroke-width="4"/>`;
  const vsFontSize = 26;
  const vsW = measureText('VS', vsFontSize, 800, 1);
  inner += drawText('VS', vsCx - vsW / 2, vsCy + vsFontSize * 0.35, vsFontSize, 800, 'FFFFFF', { letterSpacing: 1 });

  y = boxTop + boxH + 50;
  if (d.note) {
    const n = svgParagraph(70, y, CW - 140, d.note, { fontSize: 27, fill: theme.mutedOnLight, lineHeight: 1.6, align: 'center', maxCharsPerLine: 22 });
    inner += n.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'light'), accent);
}

function tpl_compareBars(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'light');
  let inner = '';
  let y = 220;
  if (d.title) {
    const t = titleWithHighlight(70, y, CW - 140, [{ text: d.title, tone: null }], { fontSize: 50, fill: theme.lightText, red: theme.red, maxCharsPerLine: 13 });
    inner += t.svg; y = t.endY + 60;
  }
  const bars = Array.isArray(d.bars) ? d.bars.slice(0, 4) : [];
  const maxVal = Math.max(1, ...bars.map(b => Number(b.value) || 0));
  bars.forEach((b, i) => {
    const ratio = (Number(b.value) || 0) / maxVal;
    const barColor = i === bars.length - 1 && bars.length > 1 ? theme.red : accent;
    const r = comparisonBar(70, y, CW - 140, b.label || '', b.valueText || String(b.value || ''), ratio, barColor, theme.lightText, theme.mutedOnLight);
    inner += r.svg; y = r.endY + 50;
  });
  if (d.note) {
    const n = svgParagraph(70, y + 10, CW - 140, d.note, { fontSize: 26, fill: theme.mutedOnLight, lineHeight: 1.6, maxCharsPerLine: 22 });
    inner += n.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'light'), accent);
}

// 큰 원 안에 숫자를 강조하는 "스탯 배지" 카드 — 보험 계정 특유의 시그니처 카드
function tpl_statBadge(d, accent, theme, channelName) {
  const bg = bgLayer(theme, 'dark');
  let inner = '';
  let y = 130;
  if (d.eyebrow) {
    const e = svgParagraph(70, y, CW - 140, d.eyebrow, { fontSize: 30, fill: accent, weight: 800, maxCharsPerLine: 18 });
    inner += e.svg; y = e.endY + 20;
  }
  if (d.title) {
    const t = titleWithHighlight(70, y + 20, CW - 140, [{ text: d.title, tone: null }], { fontSize: 48, fill: theme.darkText, red: theme.red, maxCharsPerLine: 13 });
    inner += t.svg; y = t.endY + 50;
  }
  const r = 210;
  const cx = CW / 2, cy = y + r + 10;
  inner += statCircle(cx, cy, r, d.value || '', d.unit || '', accent);
  y = cy + r + 60;
  if (d.body) {
    const b = svgParagraph(70, y, CW - 140, d.body, { fontSize: 30, fill: theme.mutedOnDark, lineHeight: 1.6, align: 'center', maxCharsPerLine: 20 });
    inner += b.svg;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'dark'), accent);
}

function tpl_ctaShare(d, accent, theme, channelName, opts = {}) {
  const usePhoto = !!opts.transparentBg;
  const bg = usePhoto ? { defs: '', rect: '' } : bgLayer(theme, 'dark');
  let inner = usePhoto ? `<rect width="${CW}" height="${CH}" fill="#000000" fill-opacity="0.55"/>` : '';
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
  if (usePhoto) {
    return `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">${inner}${watermarkStamp(channelName, theme, 'dark')}</svg>`;
  }
  return svgDoc(bg, inner, watermarkStamp(channelName, theme, 'dark'), accent);
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
  compareBars: tpl_compareBars,
  statBadge: tpl_statBadge,
  twoColumn: tpl_twoColumn,
  ctaShare: tpl_ctaShare,
  outro: tpl_outro
};
// 사진 배경을 지원하는 카드 타입들 (photoQuery가 있으면 사진 위에 텍스트를 얹는다)
// lightText/caseFormula도 사진을 쓸 수 있게 확장 — 사진이 있으면 밝은 배경 대신 어두운 오버레이+흰 글씨로 자동 전환한다.
const PHOTO_CAPABLE_TYPES = new Set(['darkCover', 'darkText', 'ctaShare', 'lightText', 'caseFormula']);

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

async function renderCard(item, accent, theme, channelName, coverPhotoBuf) {
  const renderer = RENDERERS[item.type];
  if (!renderer) return null;

  if (PHOTO_CAPABLE_TYPES.has(item.type)) {
    let photoBuf = (item.type === 'darkCover' ? coverPhotoBuf : null) || null; // 사용자가 직접 올린 표지 사진은 표지에만 우선 적용
    if (!photoBuf && item.photoQuery) {
      const accessKey = process.env.UNSPLASH_ACCESS_KEY;
      photoBuf = await fetchUnsplashPhoto(item.photoQuery, accessKey);
    }
    if (photoBuf) {
      const overlaySvg = renderer(item, accent, theme, channelName, { transparentBg: true });
      const bg = await sharp(photoBuf).resize(CW, CH, { fit: 'cover' }).toBuffer();
      const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
      return await sharp(bg).composite([{ input: overlayPng }]).png().toBuffer();
    }
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
    const { plan, accent, theme: themeKey, channelName, coverPhotoBase64 } = req.body || {};
    if (!Array.isArray(plan) || !plan.length) {
      return res.status(400).json({ error: 'plan(카드 배열)이 필요합니다.' });
    }
    const cappedPlan = plan.slice(0, MAX_CARDS); // 카드뉴스는 최대 10장까지만 만든다
    const accentColor = (accent || DEFAULT_ACCENT).replace('#', '');
    const theme = getTheme(themeKey);
    const coverPhotoBuf = coverPhotoBase64 ? Buffer.from(coverPhotoBase64, 'base64') : null;

    const pngBuffers = [];
    for (const item of cappedPlan) {
      const buf = await renderCard(item, accentColor, theme, channelName, item.type === 'darkCover' ? coverPhotoBuf : null);
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
    return res.status(200).json({
      ok: true,
      base64: zipBuffer.toString('base64'),
      count: pngBuffers.length,
      images: pngBuffers.map(b => b.toString('base64')) // 개별 카드 미리보기/재생성용
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

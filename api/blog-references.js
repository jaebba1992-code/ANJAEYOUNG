const { checkAppPassword } = require('./_auth');

function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(/^(?:m\.)?blog\.naver\.com$/.test(url.hostname) || /^[a-z0-9-]+\.tistory\.com$/.test(url.hostname))) {
    throw new Error('네이버 블로그 또는 티스토리의 https 글 링크를 넣어주세요. 다른 자료는 본문을 붙여넣을 수 있어요.');
  }
  return url.href;
}

function textOf(html) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '\n').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

function extractArticle(html) {
  // Recognized article containers only; never pass navigation or a login page as an article.
  const tags = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    if (match[0].startsWith('</')) continue;
    const attrs = match[0];
    if (!/\b(?:class|id)\s*=\s*["'][^"']*\b(?:se-main-container|postViewArea|tt_article_useless_p_margin|article-view|entry-content)\b[^"']*["']/i.test(attrs)) continue;
    const tag = match[1].toLowerCase();
    const start = tags.lastIndex;
    let depth = 1, end;
    while ((end = tags.exec(html))) {
      if (end[1].toLowerCase() !== tag) continue;
      if (end[0].startsWith('</')) depth--;
      else if (!end[0].endsWith('/>')) depth++;
      if (!depth) {
        const text = textOf(html.slice(start, end.index));
        if (text.length < 100) throw new Error('읽을 수 있는 본문이 부족해요. 본문을 직접 붙여넣어 주세요.');
        const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        return { rawTitle: title ? textOf(title[1]) : '참고 글', text: text.slice(0, 24000), truncated: text.length > 24000 };
      }
    }
  }
  throw new Error('블로그 본문을 읽지 못했어요. 비공개·삭제된 글인지 확인하거나 본문을 붙여넣어 주세요.');
}

async function fetchHtml(value, signal, redirects = 0) {
  const url = safeUrl(value);
  const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3) throw new Error('페이지 이동이 너무 많아요.');
    const location = response.headers.get('location');
    if (!location) throw new Error('이동 주소를 확인하지 못했어요.');
    return fetchHtml(new URL(location, url).href, signal, redirects + 1);
  }
  if (!response.ok) throw new Error('본문 요청에 실패했어요 (' + response.status + ').');
  if (!/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('블로그 HTML 글 링크가 필요해요.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 3000000) throw new Error('페이지가 너무 커서 본문을 읽지 못했어요.');
      chunks.push(Buffer.from(chunk));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { html: Buffer.concat(chunks).toString('utf8'), url };
}

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) return res.status(401).json({ error: '비밀번호가 필요해요.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청이 필요해요.' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let { html, url } = await fetchHtml(req.body && req.body.url, controller.signal);
    const iframe = [...html.matchAll(/<iframe\b[^>]*>/gi)].find(m => /\bid=["']mainFrame["']/i.test(m[0]));
    if (iframe) {
      const src = iframe[0].match(/\bsrc=["']([^"']+)["']/i);
      if (src) ({ html, url } = await fetchHtml(new URL(src[1].replace(/&amp;/g, '&'), url).href, controller.signal));
    }
    return res.status(200).json({ ...extractArticle(html), url });
  } catch (err) {
    return res.status(422).json({ error: err.name === 'AbortError' ? '본문 읽기 시간이 초과됐어요. 본문을 붙여넣어 주세요.' : String(err.message || err) });
  } finally { clearTimeout(timer); }
};
module.exports._test = { safeUrl, extractArticle, fetchHtml };

const { checkAppPassword } = require('./_auth');

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    }
  });
  if (!resp.ok) throw new Error('페이지를 가져오지 못했어요 (상태 코드 ' + resp.status + ')');
  return await resp.text();
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: '올바른 URL이 필요합니다 (http:// 또는 https://로 시작).' });
    }

    let html = await fetchHtml(url);

    // 네이버 블로그(blog.naver.com)는 실제 본문이 iframe(id="mainFrame") 안의 다른 URL에 있는 경우가 많다.
    // 그 경우 겉 페이지는 거의 빈 껍데기라, iframe 안쪽 주소를 찾아서 그쪽을 다시 가져온다.
    const iframeMatch = html.match(/<iframe[^>]+id=["']mainFrame["'][^>]*src=["']([^"']+)["']/i);
    if (iframeMatch) {
      let iframeSrc = iframeMatch[1];
      if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
      else if (iframeSrc.startsWith('/')) {
        const u = new URL(url);
        iframeSrc = u.origin + iframeSrc;
      }
      try {
        html = await fetchHtml(iframeSrc);
      } catch (e) {
        // iframe 안쪽 가져오기 실패하면 겉 페이지 그대로 사용
      }
    }

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : '';
    const text = htmlToText(html).slice(0, 30000); // 너무 길면 앞부분만 (AI가 다시 정리하는 단계에서 핵심만 추림)

    return res.status(200).json({ rawTitle, text });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

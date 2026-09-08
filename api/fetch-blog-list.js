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

function extractBlogId(input) {
  const trimmed = input.trim();
  // 순수 아이디만 입력한 경우
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!/blog\.naver\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length) return parts[0];
    return u.searchParams.get('blogId');
  } catch (e) {
    return null;
  }
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
    const blogId = url ? extractBlogId(url) : null;
    if (!blogId) {
      return res.status(400).json({ error: '네이버 블로그 주소(blog.naver.com/아이디) 또는 아이디를 입력해주세요.' });
    }

    const listUrl = `https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blogId)}&from=postList&categoryNo=0&parentCategoryNo=0&currentPage=1`;
    const html = await fetchHtml(listUrl);

    // href="/블로그ID/글번호" 형태의 링크를 찾아서 글 목록을 뽑아낸다.
    // (네이버 블로그 구조가 바뀌면 이 방식이 안 통할 수 있어서, 못 찾으면 빈 목록으로 응답한다 — 그럴 땐 개별 링크로 가져와야 함)
    const linkRegex = new RegExp(`href=["']/${blogId}/(\\d+)["']`, 'g');
    const logNos = [];
    const seen = new Set();
    let m;
    while ((m = linkRegex.exec(html)) && logNos.length < 25) {
      if (!seen.has(m[1])) { seen.add(m[1]); logNos.push(m[1]); }
    }

    // 제목은 근처 텍스트에서 최대한 찾아본다 (실패해도 치명적이지 않음 — 가져올 때 다시 정확히 뽑음)
    const posts = logNos.map(logNo => {
      const idx = html.indexOf(`/${blogId}/${logNo}`);
      let title = '';
      if (idx >= 0) {
        const nearby = html.slice(idx, idx + 500);
        const titleMatch = nearby.match(/title=["']([^"']{2,120})["']/) || nearby.match(/>([^<>]{4,80})<\/(?:strong|span|a)>/);
        if (titleMatch) title = titleMatch[1].trim();
      }
      return { logNo, url: `https://blog.naver.com/${blogId}/${logNo}`, title };
    });

    if (!posts.length) {
      return res.status(200).json({ blogId, posts: [], note: '글 목록을 찾지 못했어요. 블로그 구조가 예상과 달라서일 수 있어요 — 개별 글 링크로 가져와주세요.' });
    }
    return res.status(200).json({ blogId, posts });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았어요.' });
  }

  const query = (req.query.query || '').trim();
  const type = req.query.type === 'cafe' ? 'cafearticle' : 'blog'; // blog | cafearticle
  const display = Math.min(parseInt(req.query.display, 10) || 5, 20);

  if (!query) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });
  }

  try {
    const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.errorMessage || '네이버 API 오류', raw: data });
    }

    // strip <b> highlight tags Naver adds to title/description
    const items = (data.items || []).map(item => ({
      title: (item.title || '').replace(/<\/?b>/g, ''),
      link: item.link,
      description: (item.description || '').replace(/<\/?b>/g, ''),
      bloggername: item.bloggername || item.cafename || null,
      postdate: item.postdate || null
    }));

    return res.status(200).json({ items, total: data.total });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

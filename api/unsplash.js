const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return res.status(500).json({ error: 'UNSPLASH_ACCESS_KEY 환경변수가 설정되지 않았어요.' });
  }

  const query = (req.query.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });
  }

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const response = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` }
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.errors?.[0] || '유니플래시 API 오류', raw: data });
    }

    const photo = (data.results || [])[0];
    if (!photo) {
      return res.status(200).json({ found: false });
    }

    return res.status(200).json({
      found: true,
      url: photo.urls.regular,
      thumbUrl: photo.urls.small,
      photographer: photo.user.name,
      photographerLink: `${photo.user.links.html}?utm_source=insurance_content_studio&utm_medium=referral`,
      unsplashLink: `${photo.links.html}?utm_source=insurance_content_studio&utm_medium=referral`
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    // no password configured -> app is open, treat as always-ok
    return res.status(200).json({ ok: true, locked: false });
  }
  const { password } = req.body || {};
  if (password === expected) {
    return res.status(200).json({ ok: true, locked: true });
  }
  return res.status(401).json({ ok: false, error: '비밀번호가 틀렸어요.' });
};

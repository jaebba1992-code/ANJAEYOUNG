const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: 'key가 필요합니다.' });
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ value: data ? data.value : null });
    }

    if (req.method === 'POST') {
      // 설정값 변경은 관리자만
      if (!checkAdminPassword(req)) {
        return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
      }
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key가 필요합니다.' });
      const { error } = await supabase.from('app_settings').upsert({ key, value: value || '' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

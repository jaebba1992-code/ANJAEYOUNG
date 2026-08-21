const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ content: data ? data.content : '', updated_at: data ? data.updated_at : null });
    }

    if (req.method === 'POST') {
      const { content } = req.body || {};
      const { error } = await supabase
        .from('announcements')
        .upsert({ id: 1, content: content || '', updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

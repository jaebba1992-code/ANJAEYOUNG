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
        .from('sheet_sources')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { label, sheet_id, tab_name, category } = req.body || {};
      if (!label || !sheet_id) {
        return res.status(400).json({ error: 'label과 sheet_id는 필수입니다.' });
      }
      const row = {
        id: Date.now(),
        label,
        sheet_id,
        tab_name: tab_name || null,
        category: category || null
      };
      const { error } = await supabase.from('sheet_sources').insert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true, item: row });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('sheet_sources').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

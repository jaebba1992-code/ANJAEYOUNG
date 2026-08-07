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
        .from('recommended_products')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { items } = req.body || {};
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'items 배열이 필요합니다.' });
      }
      const rows = items.map((it, i) => ({
        id: Date.now() + i,
        insurer: it.insurer || '',
        product_name: it.product_name || '',
        category: it.category || '',
        reason: it.reason || '',
        raw_text: it.raw_text || ''
      }));
      const { error } = await supabase.from('recommended_products').insert(rows);
      if (error) throw error;
      return res.status(200).json({ ok: true, count: rows.length });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('recommended_products').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

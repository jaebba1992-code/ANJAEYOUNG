const { getSupabase } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { id, topic, category, format, script } = req.body || {};
      if (!script) return res.status(400).json({ error: 'script가 필요합니다.' });
      const row = { id: id || Date.now(), topic, category, format, script };
      const { error } = await supabase.from('history').upsert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('history').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

const { getSupabase } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase.from('banned_words').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { word } = req.body || {};
      if (!word || !word.trim()) return res.status(400).json({ error: 'word가 필요합니다.' });
      const { error } = await supabase.from('banned_words').upsert({ word: word.trim() }, { onConflict: 'word' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('banned_words').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

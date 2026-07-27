const { getSupabase } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      if (req.query.count === '1') {
        const { count, error } = await supabase
          .from('source_corpus')
          .select('*', { count: 'exact', head: true });
        if (error) throw error;
        return res.status(200).json({ count: count || 0 });
      }

      const q = (req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'q(검색어) 파라미터가 필요합니다.' });

      // Convert free text into a simple OR-based tsquery from the keywords
      const terms = q.split(/[\s,·・/]+/).filter(t => t.length >= 2).slice(0, 8);
      if (terms.length === 0) return res.status(200).json({ items: [] });
      const tsQuery = terms.map(t => t.replace(/[':&|!()]/g, '')).filter(Boolean).join(' | ');

      const { data, error } = await supabase
        .from('source_corpus')
        .select('id, source_file, page_number, content')
        .textSearch('search_vector', tsQuery, { type: 'plain', config: 'simple' })
        .limit(8);

      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      // batch insert: { rows: [{ source_file, page_number, content }, ...] }
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows 배열이 필요합니다.' });
      }
      const { error } = await supabase.from('source_corpus').insert(rows);
      if (error) throw error;
      return res.status(200).json({ ok: true, inserted: rows.length });
    }

    if (req.method === 'DELETE') {
      // clears the whole corpus table (used before a fresh re-upload)
      const { error } = await supabase.from('source_corpus').delete().gte('id', 0);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

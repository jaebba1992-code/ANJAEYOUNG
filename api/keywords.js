const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const q = (req.query.q || '').trim();
      const minCompetitionOk = ['낮음', '중간', '높음'];
      const maxCompetition = req.query.maxCompetition; // e.g. '중간' means 낮음+중간 allowed
      const limit = Math.min(parseInt(req.query.limit, 10) || 15, 50);

      let query = supabase.from('keywords').select('*');
      if (q) query = query.ilike('keyword', `%${q}%`);
      if (maxCompetition === '낮음') query = query.eq('competition', '낮음');
      if (maxCompetition === '중간') query = query.in('competition', ['낮음', '중간']);

      query = query.order('golden_score', { ascending: false }).limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows 배열이 필요합니다.' });
      }
      const { error } = await supabase.from('keywords').upsert(rows, { onConflict: 'keyword' });
      if (error) throw error;
      return res.status(200).json({ ok: true, inserted: rows.length });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from('keywords').delete().gte('id', 0);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

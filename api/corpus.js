const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
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

      // Convert free text into a simple OR-based tsquery from the keywords.
      // 한국어 조사(로/을/를/은/는 등)가 단어 끝에 붙으면 원문과 안 맞아서 검색이 실패하니, 흔한 조사를 떼어내고 검색한다.
      const JOSA_RE = /(으로써|으로서|이라도|라도|한테서|에게서|이나마|나마|까지|부터|한테|에게|에서|으로|이랑|랑|이나|나|와|과|의|은|는|이|가|을|를|도|만|로)$/;
      function stripJosa(word) {
        let w = word;
        for (let i = 0; i < 2; i++) {
          const m = w.match(JOSA_RE);
          if (m && w.length - m[0].length >= 2) {
            w = w.slice(0, w.length - m[0].length);
          } else break;
        }
        return w;
      }
      let terms = q.split(/[\s,·・/]+/)
        .map(t => t.replace(/[':&|!()]/g, ''))
        .map(stripJosa)
        .filter(t => t.length >= 2);
      terms = [...new Set(terms)].sort((a, b) => b.length - a.length).slice(0, 20);
      if (terms.length === 0) return res.status(200).json({ items: [] });
      const tsQuery = terms.join(' | ');

      const { data, error } = await supabase.rpc('search_corpus_ranked', {
        query_text: tsQuery,
        result_limit: 8
      });

      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      // batch insert: { rows: [{ source_file, page_number, content }, ...] }
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows 배열이 필요합니다.' });
      }
      const { error } = await supabase
        .from('source_corpus')
        .upsert(rows, { onConflict: 'source_file,page_number' });
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

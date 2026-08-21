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

      const sheetsOnly = req.query.sheetsOnly === '1';

      if (sheetsOnly) {
        // "자료 검색" 탭 전용: 구글시트로 동기화된 자료 안에서만 찾는다 (8천페이지 원본 txt, 정닥터 대본 등은 제외)
        const { data: sheetSrcs, error: sheetErr } = await supabase.from('sheet_sources').select('label');
        if (sheetErr) throw sheetErr;
        const allLabels = (sheetSrcs || []).map(s => s.label);
        if (!allLabels.length) return res.status(200).json({ items: [] });

        // 질문에 등록된 시트 이름이 직접 언급되면(예: "초건강체"), 그 시트를 순위 매기지 않고 통째로(순서대로) 가져온다.
        // 랭킹 알고리즘이 중요한 줄을 놓치는 걸 막기 위해, 관련된 것만 골라내지 않고 그 시트의 내용을 최대한 다 넘긴다.
        const matchedLabels = allLabels.filter(label => terms.some(t => label.includes(t)));

        let items = [];
        if (matchedLabels.length) {
          const { data: allRows, error: mErr } = await supabase
            .from('source_corpus')
            .select('id, source_file, page_number, content')
            .in('source_file', matchedLabels)
            .order('source_file', { ascending: true })
            .order('page_number', { ascending: true });
          if (mErr) throw mErr;
          // 시트가 너무 커서 한도를 넘으면 앞에서부터 담되, 약 6만자까지만 담는다
          let totalLen = 0;
          for (const row of (allRows || [])) {
            if (totalLen > 60000) break;
            items.push(row);
            totalLen += (row.content || '').length;
          }
        }
        // 이름이 언급된 시트에서 결과가 부족하면, 등록된 시트 전체에서 나머지를 보충한다
        if (items.length < 4) {
          const { data: generalRows, error: gErr } = await supabase.rpc('search_corpus_ranked', {
            query_text: tsQuery,
            result_limit: 10,
            filter_files: allLabels
          });
          if (gErr) throw gErr;
          const seen = new Set(items.map(r => r.id));
          for (const row of (generalRows || [])) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              items.push(row);
            }
          }
        }
        return res.status(200).json({ items });
      }

      // 검색어 중에 등록된 구글시트 이름(label)과 겹치는 게 있으면, 그 시트 내용을 우선적으로 포함시킨다.
      // (예: "초건강체"로 검색했는데 8천페이지 안의 다른 방대한 문서가 순위에서 이겨버리는 걸 방지)
      let boosted = [];
      try {
        const { data: sheetSrcs } = await supabase.from('sheet_sources').select('label');
        const matchedLabels = (sheetSrcs || [])
          .map(s => s.label)
          .filter(label => terms.some(t => label.includes(t)));
        if (matchedLabels.length) {
          const { data: boostedRows } = await supabase.rpc('search_corpus_ranked', {
            query_text: tsQuery,
            result_limit: 6,
            filter_files: matchedLabels
          });
          boosted = boostedRows || [];
        }
      } catch (e) {
        // 부스팅 실패해도 일반 검색은 계속 진행
      }

      const { data, error } = await supabase.rpc('search_corpus_ranked', {
        query_text: tsQuery,
        result_limit: 8
      });

      if (error) throw error;

      // 우선 포함시킨 것 + 일반 순위 결과를 합치고, 중복은 제거한다
      const seen = new Set();
      const merged = [];
      for (const row of [...boosted, ...(data || [])]) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          merged.push(row);
        }
      }
      return res.status(200).json({ items: merged.slice(0, 10) });
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

const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // Supabase(PostgREST)는 기본적으로 한 번에 최대 1,000개 행만 돌려준다. 라이브러리가 1,000개를 넘으면
      // 뒤쪽 자료가 통째로 검색 대상에서 빠지는 심각한 문제가 생기므로, 1,000개씩 여러 번 나눠 받아서 전부 합친다.
      const PAGE_SIZE = 1000;
      let allData = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('source_library')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break; // 더 가져올 게 없으면 종료
        from += PAGE_SIZE;
        if (from > 50000) break; // 혹시 모를 무한루프 방지용 안전장치
      }
      return res.status(200).json({ items: allData });
    }

    if (req.method === 'POST') {
      const { title, content } = req.body || {};
      if (!title || !content) return res.status(400).json({ error: 'title과 content가 필요합니다.' });
      const row = { id: Date.now(), title, content };
      const { error } = await supabase.from('source_library').insert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('source_library').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

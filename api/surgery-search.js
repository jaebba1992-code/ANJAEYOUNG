const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const q = String(req.query.q || '').trim();
      if (!q) {
        const { data, error } = await supabase
          .from('surgery_classifications')
          .select('*')
          .order('surgery_name', { ascending: true })
          .limit(500);
        if (error) throw error;
        return res.status(200).json({ items: data, total: data.length });
      }
      const { data, error } = await supabase
        .from('surgery_classifications')
        .select('*')
        .ilike('surgery_name', `%${q}%`)
        .order('surgery_name', { ascending: true })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    // 추가/일괄추가/삭제는 관리자만 (잘못된 분류가 섞이면 실제 청구에 영향을 줄 수 있어서)
    if (!checkAdminPassword(req)) {
      return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
    }

    if (req.method === 'POST') {
      const { items } = req.body || {};
      const list = Array.isArray(items) ? items : [req.body];
      const rows = list
        .map(it => ({
          surgery_name: String(it.surgery_name || '').trim().slice(0, 200),
          system: String(it.system || '').trim().slice(0, 20),
          class_no: String(it.class_no || '').trim().slice(0, 20),
          category: String(it.category || '').trim().slice(0, 100),
          source: String(it.source || '').trim().slice(0, 200)
        }))
        .filter(r => r.surgery_name && r.class_no);
      if (!rows.length) return res.status(400).json({ error: '추가할 항목이 없어요 (수술명·종 구분은 필수).' });
      const { error } = await supabase.from('surgery_classifications').insert(rows);
      if (error) throw error;
      return res.status(200).json({ ok: true, count: rows.length });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('surgery_classifications').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

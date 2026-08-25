const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();
    const isAdmin = checkAdminPassword(req);

    if (req.method === 'GET') {
      let query = supabase.from('history').select('*').order('created_at', { ascending: false }).limit(2000);
      if (!isAdmin) {
        // 관리자가 아니면, 본인이 만든 작업물만 볼 수 있다 (팀원끼리 서로의 작업 내용을 볼 수 없게).
        // visitor_name이 없는 요청은 아무 데이터도 돌려주지 않는다 (안전한 기본값).
        const name = String(req.query.visitor_name || '').trim();
        if (!name) return res.status(200).json({ items: [] });
        query = query.eq('visitor_name', name);
      }
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { id, topic, category, format, script, visitor_name } = req.body || {};
      if (!script) return res.status(400).json({ error: 'script가 필요합니다.' });
      const row = { id: id || Date.now(), topic, category, format, script, visitor_name: visitor_name || null };
      const { error } = await supabase.from('history').upsert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      let query = supabase.from('history').delete().eq('id', id);
      if (!isAdmin) {
        // 관리자가 아니면 본인이 만든 것만 지울 수 있다 (다른 사람 작업물을 실수로도 못 지우게).
        const name = String(req.body.visitor_name || '').trim();
        if (!name) return res.status(403).json({ error: '본인 확인이 필요해요.' });
        query = query.eq('visitor_name', name);
      }
      const { error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

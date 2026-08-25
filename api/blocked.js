const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // ?name=OOO 로 물어보면, 그 이름이 차단됐는지만 가볍게 확인 (강퇴 여부 체크용) — 모든 방문자가 자기 자신을 확인할 수 있어야 하므로 관리자 체크 없이 허용
      const { name } = req.query || {};
      if (name) {
        const { data, error } = await supabase
          .from('blocked_visitors')
          .select('id')
          .eq('name', String(name).trim())
          .limit(1);
        if (error) throw error;
        return res.status(200).json({ blocked: !!(data && data.length) });
      }
      // 전체 차단 목록 조회는 관리자만
      if (!checkAdminPassword(req)) {
        return res.status(403).json({ error: '관리자만 볼 수 있어요.' });
      }
      const { data, error } = await supabase
        .from('blocked_visitors')
        .select('*')
        .order('blocked_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    // 차단 추가/해제는 관리자 비밀번호가 있어야만 가능하다 (아무나 강퇴하지 못하게)
    if (!checkAdminPassword(req)) {
      return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
    }

    if (req.method === 'POST') {
      const { name } = req.body || {};
      const clean = (name || '').trim();
      if (clean.length < 1) return res.status(400).json({ error: '이름을 입력해주세요.' });
      const { error } = await supabase.from('blocked_visitors').insert({ name: clean.slice(0, 40) });
      if (error) {
        if (error.code === '23505') return res.status(400).json({ error: '이미 차단된 이름이에요.' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id, name } = req.body || {};
      if (!id && !name) return res.status(400).json({ error: 'id 또는 name이 필요합니다.' });
      let query = supabase.from('blocked_visitors').delete();
      query = id ? query.eq('id', id) : query.eq('name', String(name).trim());
      const { error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

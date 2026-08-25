const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // ?name=OOO&device_id=XXX 로 물어보면, 이름 또는 기기ID 중 하나라도 차단 목록에 있는지 확인한다
      // (차단된 사람이 이름만 바꿔서 같은 기기로 재접속하는 것도 같이 막기 위함) — 모든 방문자가
      // 자기 자신을 확인할 수 있어야 하므로 관리자 체크 없이 허용한다.
      const { name, device_id } = req.query || {};
      if (name || device_id) {
        let found = false;
        if (name) {
          const { data, error } = await supabase
            .from('blocked_visitors')
            .select('id')
            .eq('name', String(name).trim())
            .limit(1);
          if (error) throw error;
          if (data && data.length) found = true;
        }
        if (!found && device_id) {
          try {
            const { data, error } = await supabase
              .from('blocked_visitors')
              .select('id')
              .eq('device_id', String(device_id).trim())
              .limit(1);
            if (error) throw error;
            if (data && data.length) found = true;
          } catch (e) {
            // device_id 컬럼이 아직 없는 DB(마이그레이션 전)일 수 있으니, 이 부분만 조용히 건너뛴다
          }
        }
        return res.status(200).json({ blocked: found });
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
      const { name, device_id } = req.body || {};
      const clean = (name || '').trim();
      if (clean.length < 1) return res.status(400).json({ error: '이름을 입력해주세요.' });
      const row = { name: clean.slice(0, 40) };
      if (device_id) row.device_id = String(device_id).slice(0, 80); // 같은 기기에서 이름만 바꿔 재접속하는 것도 함께 차단
      let { error } = await supabase.from('blocked_visitors').insert(row);
      if (error && device_id && error.code !== '23505') {
        // device_id 컬럼이 아직 없는 DB일 수 있으니, 그 필드만 빼고 한 번 더 시도한다 (이름 차단만이라도 확실히 되도록)
        const retry = await supabase.from('blocked_visitors').insert({ name: row.name });
        error = retry.error;
      }
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

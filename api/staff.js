const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // 이름 등록 화면에서 명단 대조를 위해 모든 방문자가 조회할 수 있어야 하므로 관리자 체크 없이 허용
      const { data, error } = await supabase
        .from('approved_staff')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ items: data });
    }

    // 직원 명단 추가/삭제는 관리자 비밀번호가 있어야만 가능하다
    if (!checkAdminPassword(req)) {
      return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
    }

    if (req.method === 'POST') {
      const { name } = req.body || {};
      const clean = (name || '').trim();
      if (clean.length < 2) return res.status(400).json({ error: '이름을 2자 이상 입력해주세요.' });
      const { error } = await supabase.from('approved_staff').insert({ name: clean.slice(0, 40) });
      if (error) {
        if (error.code === '23505') return res.status(400).json({ error: '이미 등록된 이름이에요.' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('approved_staff').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

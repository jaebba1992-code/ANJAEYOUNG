const { getSupabase } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const token = req.headers['x-user-token'];
    if (!token) return res.status(401).json({ error: '로그인이 필요해요.' });

    if (req.method === 'GET' || req.method === 'POST') {
      // 세션 확인 + "지금 접속 중"으로 표시되도록 마지막 접속 시각을 갱신한다 (하트비트)
      // 세션은 app_user_sessions에 별도로 저장돼 있어서, 같은 계정을 다른 기기/팀원이
      // 동시에 쓰고 있어도 서로의 세션을 덮어쓰지 않는다.
      const { data: session, error: sessionErr } = await supabase
        .from('app_user_sessions')
        .select('id, user_id')
        .eq('session_token', token)
        .maybeSingle();
      if (sessionErr) throw sessionErr;
      if (!session) {
        return res.status(401).json({ error: '세션이 만료됐어요. 다시 로그인해주세요.' });
      }

      const { data: user, error: userErr } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', session.user_id)
        .maybeSingle();
      if (userErr) throw userErr;
      if (!user || user.status !== 'approved') {
        // 승인이 취소된 계정이면 이 세션도 같이 정리한다
        await supabase.from('app_user_sessions').delete().eq('id', session.id);
        return res.status(401).json({ error: '세션이 만료됐거나 승인되지 않은 계정이에요.' });
      }

      const now = new Date().toISOString();
      await supabase.from('app_user_sessions').update({ last_seen_at: now }).eq('id', session.id);
      await supabase.from('app_users').update({ last_seen_at: now }).eq('id', user.id);

      return res.status(200).json({
        ok: true,
        name: user.name,
        role: user.role,
        email: user.email,
        appPassword: process.env.APP_PASSWORD || '',
        adminPassword: user.role === 'admin' ? (process.env.ADMIN_PASSWORD || '') : ''
      });
    }

    if (req.method === 'DELETE') {
      // 로그아웃 — 이 기기의 세션 하나만 지운다 (같은 계정의 다른 기기 세션은 그대로 유지)
      await supabase.from('app_user_sessions').delete().eq('session_token', token);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

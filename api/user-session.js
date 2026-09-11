const { getSupabase } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const token = req.headers['x-user-token'];
    if (!token) return res.status(401).json({ error: '로그인이 필요해요.' });

    if (req.method === 'GET' || req.method === 'POST') {
      // 세션 확인 + "지금 접속 중"으로 표시되도록 마지막 접속 시각을 갱신한다 (하트비트)
      const { data: user, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('session_token', token)
        .maybeSingle();
      if (error) throw error;
      if (!user || user.status !== 'approved') {
        return res.status(401).json({ error: '세션이 만료됐거나 승인되지 않은 계정이에요.' });
      }
      await supabase.from('app_users').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
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
      // 로그아웃 — 세션 토큰을 지워서 더 이상 쓸 수 없게 한다
      await supabase.from('app_users').update({ session_token: null }).eq('session_token', token);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

const { getSupabase } = require('./_supabaseClient');
const { verifyPassword, generateToken } = require('./_userAuth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();
    if (error) throw error;
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: '아직 관리자 승인 대기 중이에요. 승인되면 로그인할 수 있어요.', status: 'pending' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: '가입이 승인되지 않았어요. 관리자에게 문의해주세요.', status: 'rejected' });
    }

    const token = generateToken();
    // 예전엔 app_users.session_token 딱 1개만 덮어써서, 다른 기기/팀원이 로그인하면
    // 방금 전 세션이 즉시 끊겼다 — 이제 세션을 별도 테이블에 "추가"만 해서 여러 기기가
    // 동시에 로그인해 있어도 서로 끊기지 않게 한다.
    const { error: insertErr } = await supabase
      .from('app_user_sessions')
      .insert({ user_id: user.id, session_token: token });
    if (insertErr) throw insertErr;
    await supabase.from('app_users').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);

    // 오래 방치된(30일 넘게 하트비트 없는) 세션은 정리해서 테이블이 무한정 커지지 않게 한다
    (async () => {
      try {
        await supabase
          .from('app_user_sessions')
          .delete()
          .eq('user_id', user.id)
          .lt('last_seen_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      } catch (e) { /* 정리 실패해도 로그인 자체는 문제 없게 무시 */ }
    })();

    // 로그인에 성공(+승인됨)하면, 기존에 쓰던 공용 비밀번호 체계를 사용자가 직접 입력할 필요 없이
    // 뒤에서 자동으로 넘겨준다 — 25개 넘는 API 파일의 인증 로직을 안 건드리고도, 사용자 경험만
    // "진짜 로그인"으로 바꿀 수 있다. 관리자 계정이면 관리자 비밀번호도 같이 자동으로 준다.
    return res.status(200).json({
      ok: true,
      token,
      name: user.name,
      role: user.role,
      email: user.email,
      appPassword: process.env.APP_PASSWORD || '',
      adminPassword: user.role === 'admin' ? (process.env.ADMIN_PASSWORD || '') : ''
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

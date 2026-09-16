const { getSupabase } = require('./_supabaseClient');
const { hashPassword, verifyPassword } = require('./_userAuth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  try {
    const supabase = getSupabase();
    const token = req.headers['x-user-token'];
    if (!token) return res.status(401).json({ error: '로그인이 필요해요.' });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 해요.' });

    const { data: session, error: sessionErr } = await supabase
      .from('app_user_sessions')
      .select('user_id')
      .eq('session_token', token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return res.status(401).json({ error: '세션이 만료됐어요. 다시 로그인해주세요.' });

    const { data: user, error: userErr } = await supabase
      .from('app_users')
      .select('id, password_hash, password_salt')
      .eq('id', session.user_id)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return res.status(401).json({ error: '계정을 찾을 수 없어요.' });

    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      return res.status(400).json({ error: '현재 비밀번호가 맞지 않아요.' });
    }

    const { hash, salt } = hashPassword(newPassword);
    const { error: updateErr } = await supabase.from('app_users').update({ password_hash: hash, password_salt: salt }).eq('id', user.id);
    if (updateErr) throw updateErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

const { getSupabase } = require('./_supabaseClient');
const { hashPassword } = require('./_userAuth');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const { email, password, name, phone } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').trim();

    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상으로 입력해주세요.' });
    if (!cleanName) return res.status(400).json({ error: '이름을 입력해주세요.' });
    if (!cleanPhone) return res.status(400).json({ error: '연락처를 입력해주세요.' });

    const supabase = getSupabase();

    const { data: existing, error: checkErr } = await supabase
      .from('app_users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();
    if (checkErr) throw checkErr;
    if (existing) return res.status(400).json({ error: '이미 가입된 이메일이에요. 로그인해주세요.' });

    const { hash, salt } = hashPassword(password);
    const { error: insertErr } = await supabase.from('app_users').insert({
      email: cleanEmail,
      password_hash: hash,
      password_salt: salt,
      name: cleanName,
      phone: cleanPhone,
      role: 'member',
      status: 'pending'
    });
    if (insertErr) throw insertErr;

    return res.status(200).json({ ok: true, message: '가입 신청이 접수됐어요. 관리자 승인 후 로그인할 수 있어요.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

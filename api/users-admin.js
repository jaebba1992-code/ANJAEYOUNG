const { getSupabase } = require('./_supabaseClient');
const { checkAdminPassword } = require('./_auth');

const ACTIVE_WINDOW_MS = 3 * 60 * 1000; // 최근 3분 안에 하트비트가 있었으면 "지금 접속 중"으로 간주

module.exports = async function handler(req, res) {
  if (!checkAdminPassword(req)) {
    return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, name, phone, role, status, last_seen_at, created_at, approved_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const now = Date.now();
      const items = (data || []).map(u => ({
        ...u,
        isActive: !!u.last_seen_at && (now - new Date(u.last_seen_at).getTime()) < ACTIVE_WINDOW_MS
      }));
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      // action: 'approve' | 'reject' | 'setRole'
      const { id, action, role } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'id와 action이 필요합니다.' });
      const update = {};
      if (action === 'approve') { update.status = 'approved'; update.approved_at = new Date().toISOString(); }
      else if (action === 'reject') { update.status = 'rejected'; }
      else if (action === 'setRole') { update.role = role === 'admin' ? 'admin' : 'member'; }
      else return res.status(400).json({ error: '알 수 없는 action입니다.' });

      const { error } = await supabase.from('app_users').update(update).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('app_users').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

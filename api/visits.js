const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'POST') {
      const { visitor_name } = req.body || {};
      const name = (visitor_name || '').trim();
      if (name.length < 2) {
        return res.status(400).json({ error: '이름을 2자 이상 입력해주세요.' });
      }
      const { error } = await supabase.from('page_visits').insert({
        visitor_name: name.slice(0, 40)
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const { count, error: countErr } = await supabase
        .from('page_visits')
        .select('*', { count: 'exact', head: true });
      if (countErr) throw countErr;

      const { data: recent, error: recentErr } = await supabase
        .from('page_visits')
        .select('visitor_name, visited_at')
        .order('visited_at', { ascending: false })
        .limit(50);
      if (recentErr) throw recentErr;

      // 방문자별 누적 횟수
      const byVisitor = {};
      (recent || []).forEach(v => {
        const name = v.visitor_name || '익명';
        if (!byVisitor[name]) byVisitor[name] = { name, count: 0, last: v.visited_at };
        byVisitor[name].count += 1;
      });
      // recent 50건 기준 요약이라, 정확한 누적 횟수는 전체 조회로 보강
      const { data: allNames } = await supabase.from('page_visits').select('visitor_name');
      const totalsByVisitor = {};
      (allNames || []).forEach(v => {
        const name = v.visitor_name || '익명';
        totalsByVisitor[name] = (totalsByVisitor[name] || 0) + 1;
      });
      const visitors = Object.keys(totalsByVisitor)
        .map(name => ({ name, count: totalsByVisitor[name], last: byVisitor[name] ? byVisitor[name].last : null }))
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({ total: count || 0, recent: recent || [], visitors });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

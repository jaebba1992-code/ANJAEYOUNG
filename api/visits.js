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

      // 오늘(한국시간 기준) 날짜 문자열
      function toKstDateStr(iso) {
        const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
        return kst.toISOString().slice(0, 10);
      }
      const todayStr = toKstDateStr(new Date().toISOString());

      // 전체 방문 기록을 한 번에 가져와서, 방문자별 누적 횟수 + 오늘 방문 횟수를 함께 집계한다
      const { data: allVisits, error: allErr } = await supabase
        .from('page_visits')
        .select('visitor_name, visited_at');
      if (allErr) throw allErr;

      const totalsByVisitor = {};
      const todayByVisitor = {};
      const lastByVisitor = {};
      (allVisits || []).forEach(v => {
        const name = v.visitor_name || '익명';
        totalsByVisitor[name] = (totalsByVisitor[name] || 0) + 1;
        if (toKstDateStr(v.visited_at) === todayStr) {
          todayByVisitor[name] = (todayByVisitor[name] || 0) + 1;
        }
        if (!lastByVisitor[name] || new Date(v.visited_at) > new Date(lastByVisitor[name])) {
          lastByVisitor[name] = v.visited_at;
        }
      });
      const visitors = Object.keys(totalsByVisitor)
        .map(name => ({ name, count: totalsByVisitor[name], today: todayByVisitor[name] || 0, last: lastByVisitor[name] }))
        .sort((a, b) => b.count - a.count);
      const todayTotal = Object.values(todayByVisitor).reduce((a, b) => a + b, 0);

      const { data: recent, error: recentErr } = await supabase
        .from('page_visits')
        .select('visitor_name, visited_at')
        .order('visited_at', { ascending: false })
        .limit(50);
      if (recentErr) throw recentErr;

      return res.status(200).json({ total: count || 0, todayTotal, recent: recent || [], visitors });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

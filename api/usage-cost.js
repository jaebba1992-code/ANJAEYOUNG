const { getSupabase } = require('./_supabaseClient');
const { checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAdminPassword(req)) {
    return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();
    const name = req.query.visitor_name ? String(req.query.visitor_name).trim() : null;

    // Supabase 기본 1000행 제한 때문에 라이브러리에서 겪었던 것과 같은 누락 버그가 나지 않게,
    // 페이지네이션으로 전부 끌어온다.
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      let query = supabase
        .from('api_usage_log')
        .select('visitor_name, model, cost_usd, input_tokens, output_tokens, created_at')
        .range(from, from + pageSize - 1);
      if (name) query = query.eq('visitor_name', name);
      const { data, error } = await query;
      if (error) throw error;
      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    if (name) {
      const totalCost = all.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
      const totalCalls = all.length;
      return res.status(200).json({ visitor_name: name, totalCost, totalCalls });
    }

    // 이름 지정 없으면, 전체 사용자별로 합산해서 돌려준다 (관리 탭 전체 현황용)
    const byUser = {};
    for (const r of all) {
      const key = r.visitor_name || '(이름 없음)';
      if (!byUser[key]) byUser[key] = { visitor_name: key, totalCost: 0, totalCalls: 0 };
      byUser[key].totalCost += Number(r.cost_usd || 0);
      byUser[key].totalCalls += 1;
    }
    const items = Object.values(byUser).sort((a, b) => b.totalCost - a.totalCost);
    const grandTotal = items.reduce((sum, i) => sum + i.totalCost, 0);
    return res.status(200).json({ items, grandTotal });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

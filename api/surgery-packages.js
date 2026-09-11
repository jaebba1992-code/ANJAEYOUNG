const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword, checkAdminPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // 특정 수술명이 어느 N대수술비 패키지들에 포함되는지 검색 (보험 Chat 연동용)
      if (req.query.searchSurgery) {
        const term = String(req.query.searchSurgery).trim();
        const { data, error } = await supabase
          .from('surgery_package_items')
          .select('surgery_name, diagnosis_code, surgery_packages(insurer, package_name)')
          .ilike('surgery_name', `%${term}%`)
          .limit(30);
        if (error) throw error;
        return res.status(200).json({ items: data });
      }

      // 목록 조회 (검색어 있으면 보험사/패키지명으로 필터)
      const q = String(req.query.q || '').trim();
      let query = supabase.from('surgery_packages').select('*').order('created_at', { ascending: false });
      if (q) query = query.or(`insurer.ilike.%${q}%,package_name.ilike.%${q}%`);
      const { data: packages, error } = await query;
      if (error) throw error;

      // 상세 조회(id 지정 시) — 해당 패키지의 전체 수술 목록도 같이 반환
      if (req.query.id) {
        const { data: items, error: itemErr } = await supabase
          .from('surgery_package_items')
          .select('*')
          .eq('package_id', Number(req.query.id))
          .order('surgery_name', { ascending: true });
        if (itemErr) throw itemErr;
        return res.status(200).json({ items });
      }

      return res.status(200).json({ packages });
    }

    // 등록/삭제는 관리자만 (잘못된 데이터가 섞이면 실제 청구 안내에 영향을 줄 수 있어서)
    if (!checkAdminPassword(req)) {
      return res.status(403).json({ error: '관리자 비밀번호가 필요해요.' });
    }

    if (req.method === 'POST') {
      const { insurer, package_name, file_key, terms_text, surgeries } = req.body || {};
      if (!insurer || !package_name) return res.status(400).json({ error: '보험사명과 패키지명이 필요합니다.' });

      const { data: pkg, error: pkgErr } = await supabase
        .from('surgery_packages')
        .insert({ insurer, package_name, file_key: file_key || null, terms_text: terms_text || null })
        .select()
        .single();
      if (pkgErr) throw pkgErr;

      if (Array.isArray(surgeries) && surgeries.length) {
        const rows = surgeries
          .map(s => ({
            package_id: pkg.id,
            surgery_name: String(s.surgery_name || '').trim().slice(0, 200),
            diagnosis_code: String(s.diagnosis_code || '').trim().slice(0, 100)
          }))
          .filter(r => r.surgery_name);
        if (rows.length) {
          const { error: itemsErr } = await supabase.from('surgery_package_items').insert(rows);
          if (itemsErr) throw itemsErr;
        }
      }
      return res.status(200).json({ ok: true, id: pkg.id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { error } = await supabase.from('surgery_packages').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

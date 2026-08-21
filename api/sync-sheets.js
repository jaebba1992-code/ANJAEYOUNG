const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');
const { getSheetsAccessToken, fetchSheetTitles, fetchSheetValues } = require('./_googleAuth');

function rowsToText(rows) {
  return rows.map(row => row.filter(c => c !== '').join(' | ')).filter(line => line.trim()).join('\n');
}

function chunkText(text, label, maxLen = 3000) {
  const chunks = [];
  let i = 0;
  let page = 1;
  while (i < text.length) {
    chunks.push({ source_file: label, page_number: page, content: text.slice(i, i + maxLen) });
    i += maxLen;
    page += 1;
  }
  if (chunks.length === 0) {
    chunks.push({ source_file: label, page_number: 1, content: '(내용 없음)' });
  }
  return chunks;
}

async function syncOne(supabase, accessToken, source) {
  let tabName = source.tab_name;
  if (!tabName) {
    const titles = await fetchSheetTitles(source.sheet_id, accessToken);
    if (!titles.length) throw new Error('시트 안에 탭이 없어요.');
    tabName = titles[0];
  }
  const rows = await fetchSheetValues(source.sheet_id, tabName, accessToken);
  const text = rowsToText(rows);
  const chunks = chunkText(text, source.label);

  // 기존 이 시트의 내용을 지우고 새로 넣는다 (매번 최신 스냅샷으로 교체)
  const { error: delErr } = await supabase.from('source_corpus').delete().eq('source_file', source.label);
  if (delErr) throw delErr;

  const { error: insErr } = await supabase.from('source_corpus').insert(chunks);
  if (insErr) throw insErr;

  await supabase.from('sheet_sources')
    .update({ last_synced_at: new Date().toISOString(), last_synced_chars: text.length })
    .eq('id', source.id);

  return { label: source.label, tab: tabName, chars: text.length, pages: chunks.length };
}

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  try {
    const supabase = getSupabase();
    const { id, syncAll } = req.body || {};

    let sources;
    if (syncAll) {
      const { data, error } = await supabase.from('sheet_sources').select('*');
      if (error) throw error;
      sources = data || [];
    } else {
      if (!id) return res.status(400).json({ error: 'id 또는 syncAll이 필요합니다.' });
      const { data, error } = await supabase.from('sheet_sources').select('*').eq('id', id).single();
      if (error) throw error;
      sources = [data];
    }

    if (!sources.length) {
      return res.status(200).json({ ok: true, results: [], message: '동기화할 시트가 없어요.' });
    }

    const accessToken = await getSheetsAccessToken();
    const results = [];
    const errors = [];
    for (const source of sources) {
      try {
        const r = await syncOne(supabase, accessToken, source);
        results.push(r);
      } catch (e) {
        errors.push({ label: source.label, error: String(e.message || e) });
      }
    }

    return res.status(200).json({ ok: errors.length === 0, results, errors });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

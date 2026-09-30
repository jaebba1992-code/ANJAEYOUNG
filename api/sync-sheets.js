const { getSupabase } = require('./_supabaseClient');
const { checkAppPassword } = require('./_auth');
const { getSheetsAccessToken, fetchSheetTitles, fetchSheetValues, sleep } = require('./_googleAuth');

function rowsToText(rows) {
  return rows.map(row => row.filter(c => c !== '').join(' | ')).filter(line => line.trim()).join('\n');
}

function chunkText(text, label, maxLen = 3000) {
  const header = `[자료명: ${label}]\n`;
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  let page = 1;
  for (const line of lines) {
    if (header.length + current.length + line.length + 1 > maxLen && current.length > 0) {
      chunks.push({ source_file: label, page_number: page, content: header + current });
      page += 1;
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current.trim()) {
    chunks.push({ source_file: label, page_number: page, content: header + current });
  }
  if (chunks.length === 0) {
    chunks.push({ source_file: label, page_number: 1, content: header + '(내용 없음)' });
  }
  return chunks;
}

async function syncOne(supabase, accessToken, source) {
  let tabNames;
  if (source.tab_name) {
    tabNames = [source.tab_name];
  } else {
    // 탭 이름을 안 정했으면, 이 시트 안의 모든 탭을 다 가져온다
    tabNames = await fetchSheetTitles(source.sheet_id, accessToken);
    if (!tabNames.length) throw new Error('시트 안에 탭이 없어요.');
  }

  let combinedText = '';
  for (const tabName of tabNames) {
    try {
      const rows = await fetchSheetValues(source.sheet_id, tabName, accessToken);
      const text = rowsToText(rows);
      if (text.trim()) {
        combinedText += `\n\n=== 탭: ${tabName} ===\n${text}`;
      }
    } catch (e) {
      // 일부 탭을 못 읽었다면 기존 자료를 유지하고, 바깥 재시도 루프에서 다시 시도한다.
      throw new Error(`탭 "${tabName}" 읽기 실패: ${e.message || e}`);
    }
    await sleep(250); // 구글 API에 너무 몰아서 요청하지 않도록 탭마다 살짝 텀을 둔다
  }
  combinedText = combinedText.trim();
  const chunks = chunkText(combinedText, source.label);

  // 새 자료 저장이 실패해도 기존 자료가 사라지지 않도록 먼저 저장한다.
  const { error: insErr } = await supabase.from('source_corpus')
    .upsert(chunks, { onConflict: 'source_file,page_number' });
  if (insErr) throw insErr;

  // 저장에 성공한 뒤에만, 페이지 수가 줄면서 남은 이전 자료를 정리한다.
  const { error: delErr } = await supabase.from('source_corpus')
    .delete()
    .eq('source_file', source.label)
    .gt('page_number', chunks.length);
  if (delErr) throw delErr;

  const { error: metadataErr } = await supabase.from('sheet_sources')
    .update({ last_synced_at: new Date().toISOString(), last_synced_chars: combinedText.length })
    .eq('id', source.id);
  if (metadataErr) throw metadataErr;

  return { label: source.label, tab: tabNames.join(', '), chars: combinedText.length, pages: chunks.length };
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
      let lastErr = null;
      let succeeded = false;
      for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
        try {
          const r = await syncOne(supabase, accessToken, source);
          results.push(r);
          succeeded = true;
        } catch (e) {
          lastErr = e;
          await sleep(1200); // 실패했으면 조금 더 쉬었다가 한 번 더 시도
        }
      }
      if (!succeeded) {
        errors.push({ label: source.label, error: String(lastErr && (lastErr.message || lastErr)) });
      }
      await sleep(300); // 시트와 시트 사이에도 살짝 텀을 둔다
    }

    return res.status(200).json({ ok: errors.length === 0, results, errors });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};

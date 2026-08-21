const { JWT } = require('google-auth-library');

let cachedClient = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === retries) return res;
    // 구글 API가 너무 많이 요청했다고(429) 하거나 일시적 서버 오류(5xx)면, 잠깐 쉬었다가 다시 시도한다
    await sleep(600 * (attempt + 1));
  }
}

async function getSheetsAccessToken() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY 환경변수가 설정되지 않았어요.');
  }
  let keyJson;
  try {
    keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY 값이 올바른 JSON이 아니에요. 다운받은 .json 파일 내용을 그대로 붙여넣었는지 확인해주세요.');
  }
  if (!cachedClient) {
    cachedClient = new JWT({
      email: keyJson.client_email,
      key: keyJson.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  const token = await cachedClient.authorize();
  return token.access_token;
}

async function fetchSheetTitles(sheetId, accessToken) {
  const res = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`시트 정보를 가져오지 못했어요 (${res.status}). 서비스 계정과 시트가 공유됐는지, 혹은 요청이 너무 몰렸는지 확인해주세요.`);
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties.title);
}

async function fetchSheetValues(sheetId, tabName, accessToken) {
  const range = encodeURIComponent(tabName);
  const res = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?majorDimension=ROWS`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`시트 값을 가져오지 못했어요 (${res.status}). 서비스 계정과 시트가 공유됐는지, 혹은 요청이 너무 몰렸는지 확인해주세요.`);
  const data = await res.json();
  return data.values || [];
}

module.exports = { getSheetsAccessToken, fetchSheetTitles, fetchSheetValues, sleep };

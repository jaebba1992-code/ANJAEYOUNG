export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const { accessCode, system, messages, max_tokens } = req.body || {};

  const TEAM_CODE = process.env.TEAM_ACCESS_CODE;
  if (TEAM_CODE && accessCode !== TEAM_CODE) {
    return res.status(401).json({ error: '접속 코드가 올바르지 않습니다. 담당자에게 코드를 확인해주세요.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정에서 등록해주세요.' });
  }

  if (!system || !messages) {
    return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 8000,
        system,
        messages
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error ? data.error.message : '알 수 없는 오류가 발생했어요.' });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: '서버에서 Anthropic API 호출 중 오류가 발생했어요: ' + err.message });
  }
}

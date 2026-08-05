const { checkAppPassword } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAppPassword(req)) {
    return res.status(401).json({ error: '비밀번호가 필요해요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았어요. /api/health 에서 확인해주세요.' });
  }

  const { system, messages, tools, max_tokens } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'messages가 필요합니다.' });
  }
  const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 2048, 256), 4096);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: safeMaxTokens,
        system: system || undefined,
        messages,
        tools: tools || undefined
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || '알 수 없는 오류', raw: data });
    }

    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    return res.status(200).json({ text: textBlocks.join('\n') });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

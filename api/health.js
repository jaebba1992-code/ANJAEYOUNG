module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return res.status(200).json({
      status: '없음',
      message: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았어요. Vercel 프로젝트 설정 > Environment Variables에서 등록해주세요.'
    });
  }

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
        max_tokens: 16,
        messages: [{ role: 'user', content: '테스트' }]
      })
    });

    if (response.ok) {
      return res.status(200).json({ status: '정상', message: 'API 키가 정상적으로 작동해요. 대본 생성기를 바로 사용하실 수 있어요.' });
    }

    const detail = await response.text();
    return res.status(200).json({
      status: '오류',
      message: `API 키는 인식됐지만 요청이 실패했어요 (${response.status}). 콘솔(console.anthropic.com)에서 키 상태와 결제 정보를 확인해주세요.`,
      detail: detail.slice(0, 300)
    });
  } catch (err) {
    return res.status(200).json({
      status: '오류',
      message: '서버에서 Anthropic API에 연결하지 못했어요.',
      detail: String(err)
    });
  }
}

const { checkAppPassword } = require('./_auth');
const { getSupabase } = require('./_supabaseClient');

// 요청에서 모델을 고를 수 있게 하되, 임의 문자열이 들어오면 안 되니 허용 목록으로만 제한한다.
// haiku는 sonnet보다 훨씬 저렴해서, 표 추출처럼 복잡한 추론이 덜 필요한 작업엔 이걸 쓰면 비용을 크게 아낄 수 있다.
// opus는 카드뉴스 디자인처럼 공간 배치·위계 판단이 중요한 작업에만 선택적으로 쓴다 (비싸지만 이런 작업엔 품질 차이가 크다).
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-5'];

// 백만 토큰당 달러 (2026년 9월 기준 Anthropic 공식 요금). 사람별 사용량(달러) 집계에 쓴다.
const PRICING_PER_MTOK = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-opus-5': { input: 5.00, output: 25.00 }
};

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

  const { system, messages, tools, max_tokens, model, visitor_name } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'messages가 필요합니다.' });
  }
  const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 2048, 256), 32000);
  const safeModel = ALLOWED_MODELS.includes(model) ? model : 'claude-sonnet-4-6';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: safeModel,
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

    // 이 호출 하나가 얼마짜리였는지 기록한다 — 실패해도 본 응답에는 영향 안 주게 별도로 처리한다.
    // (사람별로 나중에 달러 합산해서 "누가 얼마 썼는지" 볼 수 있게 하기 위함)
    try {
      const usage = data.usage || {};
      const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      const outputTokens = usage.output_tokens || 0;
      const price = PRICING_PER_MTOK[safeModel] || PRICING_PER_MTOK['claude-sonnet-4-6'];
      const costUsd = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
      const supabase = getSupabase();
      await supabase.from('api_usage_log').insert({
        visitor_name: visitor_name || null,
        model: safeModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd
      });
    } catch (logErr) {
      console.error('usage log failed', logErr);
    }

    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    return res.status(200).json({ text: textBlocks.join('\n') });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

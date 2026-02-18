import { NextRequest, NextResponse } from 'next/server';

// POST /api/analyze-word
// 단어의 한자어 분석 — 한자, 중국어 대응, 뜻, false friend 여부
export async function POST(request: NextRequest) {
  const { word } = await request.json();
  if (!word) {
    return NextResponse.json({ error: 'word is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      word,
      hanja: null,
      chinese: null,
      meaning: word,
      isFalseFriend: false,
    });
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `한국어 단어 "${word}"를 분석해 주세요.

다음 JSON 형식으로만 반환하세요 (다른 텍스트 없이):
{
  "hanja": "한자 (있으면)",
  "chinese": "대응하는 중국어 단어/표현",
  "meaning": "한국어로 된 뜻풀이 (간단히)",
  "isFalseFriend": false,
  "falseFriendNote": "한중 의미 차이 설명 (false friend인 경우만)"
}

규칙:
- 한자어가 아니면 hanja는 null
- chinese는 중국어 화자가 이해할 수 있는 대응 표현
- isFalseFriend: 한국어와 중국어에서 같은 한자를 쓰지만 의미가 다른 경우 true
- 고유어(순한국어)나 외래어도 chinese 번역은 제공`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ word, ...parsed });
  } catch {
    return NextResponse.json({
      word,
      hanja: null,
      chinese: null,
      meaning: word,
      isFalseFriend: false,
    });
  }
}

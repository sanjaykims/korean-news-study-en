import { NextRequest, NextResponse } from 'next/server';

// POST /api/grammar
// 뉴스 스크립트에서 문법 패턴 감지
export async function POST(request: NextRequest) {
  const { script } = await request.json();
  if (!script) {
    return NextResponse.json({ error: 'script is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ patterns: [] });
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `다음 한국어 뉴스 스크립트에서 주요 문법 패턴을 찾아 주세요.
대상: 중국어 원어민 고급 한국어 학습자

스크립트:
${script}

다음 뉴스 특화 문법 패턴을 중심으로 찾아 주세요:
- -에 따르면 (according to)
- -(으)ㄹ 것으로 보입니다/전망입니다 (it is expected that)
- -는 것으로 나타났습니다/알려졌습니다 (it was revealed/known that)
- -(으)ㄹ 방침입니다 (it is the policy to)
- -에 나섰습니다 (took action to)
- -(으)ㄴ/는 가운데 (amid/while)
- -을/를 둘러싸고 (surrounding/regarding)
- 기타 뉴스 문체 문법

JSON 배열로 반환:
[{
  "pattern": "문법 패턴명",
  "meaning": "한국어 뜻풀이",
  "chineseMeaning": "中文解释",
  "example": "스크립트에서 발견한 예문",
  "sentenceIndex": 0
}]

sentenceIndex는 스크립트를 문장(마침표 기준)으로 나눴을 때의 인덱스입니다.
JSON만 반환하세요.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ patterns: [] });

    const patterns = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ patterns });
  } catch {
    return NextResponse.json({ patterns: [] });
  }
}

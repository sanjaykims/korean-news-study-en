import { NextRequest, NextResponse } from 'next/server';

// POST /api/quiz
// 선택한 단어들로 퀴즈 생성 (Chinese↔Korean)
export async function POST(request: NextRequest) {
  const { words } = await request.json();
  if (!words || !Array.isArray(words) || words.length === 0) {
    return NextResponse.json({ error: 'words array is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: 기본 퀴즈 생성
    const questions = words.map((w: { text: string; chinese?: string; meaning?: string }, i: number) => ({
      id: i,
      koreanText: w.text,
      correctAnswer: w.chinese || w.meaning || w.text,
      options: [w.chinese || w.meaning || w.text, '모르겠습니다'],
      type: i % 2 === 0 ? 'korean_to_chinese' : 'chinese_to_korean',
    }));
    return NextResponse.json({ questions });
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const wordList = words
      .map((w: { text: string; hanja?: string; chinese?: string; meaning?: string }) =>
        `${w.text}${w.hanja ? ` (${w.hanja})` : ''}${w.chinese ? ` — 中文: ${w.chinese}` : ''}${w.meaning ? ` — 뜻: ${w.meaning}` : ''}`)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `다음 한국어 단어 목록으로 퀴즈를 만들어 주세요.
대상: 중국어 원어민 한국어 학습자 (고급)

단어 목록:
${wordList}

규칙:
1. 각 단어당 1문제 생성
2. 절반은 "chinese_to_korean" (중국어 뜻을 보고 한국어 고르기 — 더 어려움, recall)
3. 절반은 "korean_to_chinese" (한국어를 보고 중국어 뜻 고르기 — recognition)
4. 각 문제는 4개 선택지 (정답 1개 + 오답 3개)
5. 오답은 비슷한 난이도의 그럴듯한 답이어야 함

JSON 배열로 반환:
[{
  "id": 0,
  "koreanText": "한국어 단어",
  "correctAnswer": "정답",
  "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
  "type": "chinese_to_korean" 또는 "korean_to_chinese"
}]

JSON만 반환하세요.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON found');

    const questions = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ questions });
  } catch {
    // Fallback
    const questions = words.map((w: { text: string; chinese?: string; meaning?: string }, i: number) => ({
      id: i,
      koreanText: w.text,
      correctAnswer: w.chinese || w.meaning || w.text,
      options: [w.chinese || w.meaning || w.text, '모르겠습니다'],
      type: i % 2 === 0 ? 'korean_to_chinese' : 'chinese_to_korean',
    }));
    return NextResponse.json({ questions });
  }
}

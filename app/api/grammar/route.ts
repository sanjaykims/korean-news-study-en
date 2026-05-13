import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// POST /api/grammar
// Detect grammar patterns in news script
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
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Find key grammar patterns in the following Korean news script.
Target audience: English-speaking intermediate-advanced Korean learners.

Script:
${script}

Focus on these news-specific grammar patterns:
- -에 따르면 (according to...)
- -(으)ㄹ 것으로 보입니다/전망입니다 (it is expected that...)
- -는 것으로 나타났습니다/알려졌습니다 (it was found/revealed that...)
- -(으)ㄹ 방침입니다 (the plan is to...)
- -에 나섰습니다 (began to... / took steps to...)
- -(으)ㄴ/는 가운데 (amid... / while...)
- -을/를 둘러싸고 (surrounding... / regarding...)
- Other news register grammar

Return JSON array:
[{
  "pattern": "grammar pattern name",
  "meaning": "Korean explanation",
  "chineseMeaning": "English explanation",
  "example": "example sentence from the script",
  "sentenceIndex": 0,
  "difficultyForChinese": "high"
}]

sentenceIndex is the index when the script is split by periods.
The "chineseMeaning" field should contain a clear English explanation.
difficultyForChinese must be one of:
- "high": difficult grammar for learners (particles, verb conjugation, honorifics, connective endings)
- "medium": moderate difficulty (tense markers, negation, passive/causative)
- "low": simpler patterns (Sino-Korean structures, number expressions)
Return JSON only.`,
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

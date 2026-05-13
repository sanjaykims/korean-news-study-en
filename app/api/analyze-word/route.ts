import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// POST /api/analyze-word
// Analyze a Korean word — hanja, English meaning, word origin
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
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Analyze the Korean word "${word}".

Return ONLY the following JSON (no other text):
{
  "hanja": "corresponding Chinese characters (if applicable)",
  "chinese": "English translation/equivalent",
  "meaning": "brief English definition",
  "wordOrigin": "한자어",
  "isFalseFriend": false,
  "falseFriendNote": "note about meaning differences (only if false friend)"
}

Rules:
- If not a Sino-Korean word, set hanja to null
- "chinese" field must contain the English translation
- "meaning" field must contain a brief English definition
- wordOrigin must be one of:
  - "한자어" (Sino-Korean word, e.g. 경제, 사회, 정치)
  - "고유어" (Native Korean word, e.g. 하늘, 사람, 먹다)
  - "외래어" (Loanword, e.g. 뉴스, 컴퓨터, 버스)
  - "혼종어" (Hybrid word, Sino-Korean + native combination, e.g. 녹색빛)
- isFalseFriend: true when the Korean word uses the same hanja as a Chinese/Japanese word but means something different
- Always provide an English translation for all word types`,
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

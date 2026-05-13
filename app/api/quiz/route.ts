import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// POST /api/quiz
// Generate quiz from selected words (English↔Korean)
export async function POST(request: NextRequest) {
  const { words } = await request.json();
  if (!words || !Array.isArray(words) || words.length === 0) {
    return NextResponse.json({ error: 'words array is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const questions = words.map((w: { text: string; chinese?: string; meaning?: string }, i: number) => ({
      id: i,
      type: 'korean_to_chinese',
      prompt: w.text,
      correctAnswer: w.chinese || w.meaning || '?',
      options: [w.chinese || w.meaning || '?'],
    }));
    return NextResponse.json({ questions });
  }

  try {
    const client = new Anthropic({ apiKey });

    const wordList = words
      .map((w: { text: string; hanja?: string; chinese?: string; meaning?: string }) =>
        `${w.text}${w.hanja ? ` (${w.hanja})` : ''}${w.chinese ? ` → ${w.chinese}` : ''}${w.meaning ? ` [${w.meaning}]` : ''}`)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generate vocabulary quiz questions for an English-speaking Korean language learner.

Word list:
${wordList}

Requirements:
- Generate 1 question per word
- Alternate between two question types

Type A "korean_to_chinese" (see Korean, pick English meaning):
  - prompt: Korean word (e.g. "악수")
  - correctAnswer: English meaning of the word (e.g. "handshake")
  - options: 4 English options including the correct answer + 3 plausible but wrong English distractors

Type B "chinese_to_korean" (see English, pick Korean):
  - prompt: English meaning (e.g. "handshake")
  - correctAnswer: The corresponding Korean word (e.g. "악수")
  - options: 4 Korean options including the correct answer + 3 plausible but wrong Korean distractors

Important rules:
- Distractors must be completely different words, not the same word with different particles (e.g. 악수를/악수로/악수는 are BAD distractors)
- All English text must be natural, clear English
- Keep meanings concise (1-3 words when possible)

Return JSON array only (no other text):
[{
  "id": 0,
  "type": "korean_to_chinese",
  "prompt": "the question text",
  "correctAnswer": "correct option",
  "options": ["option1", "option2", "option3", "option4"]
}]`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON found');

    const questions = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ questions });
  } catch {
    const questions = words.map((w: { text: string; chinese?: string; meaning?: string }, i: number) => ({
      id: i,
      type: 'korean_to_chinese',
      prompt: w.text,
      correctAnswer: w.chinese || w.meaning || '?',
      options: [w.chinese || w.meaning || '?'],
    }));
    return NextResponse.json({ questions });
  }
}

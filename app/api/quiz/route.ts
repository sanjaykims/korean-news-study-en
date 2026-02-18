import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// POST /api/quiz
// 선택한 단어들로 퀴즈 생성 (Chinese↔Korean)
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
        content: `为中文母语的韩语学习者生成词汇测验。

单词列表：
${wordList}

要求：
- 每个单词生成1道题
- 交替使用两种题型

题型A "korean_to_chinese"（看韩语选中文）：
  - prompt: 韩语单词（如 "악수"）
  - correctAnswer: 该词的简体中文意思（如 "握手"）
  - options: 4个简体中文选项，含正确答案 + 3个容易混淆的中文干扰项

题型B "chinese_to_korean"（看中文选韩语）：
  - prompt: 简体中文意思（如 "握手"）
  - correctAnswer: 对应的韩语单词（如 "악수"）
  - options: 4个韩语选项，含正确答案 + 3个容易混淆的韩语干扰项

重要规则：
- 干扰项必须是完全不同的词汇，不能只是同一个词加不同助词（如 악수를/악수로/악수는 是错误的干扰项）
- prompt里的中文必须是简体中文
- options里如果是中文也必须是简体中文

返回JSON数组（只返回JSON）：
[{
  "id": 0,
  "type": "korean_to_chinese",
  "prompt": "显示为题目的文字",
  "correctAnswer": "正确选项",
  "options": ["选项1", "选项2", "选项3", "选项4"]
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

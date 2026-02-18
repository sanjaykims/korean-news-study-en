import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

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
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `请分析韩语单词"${word}"。

只返回以下JSON格式（不要其他文字）：
{
  "hanja": "对应汉字（如有）",
  "chinese": "对应的简体中文词汇/表达",
  "meaning": "简体中文释义（简短）",
  "wordOrigin": "한자어",
  "isFalseFriend": false,
  "falseFriendNote": "中韩含义差异说明（仅在false friend时填写）"
}

规则：
- 非汉字词则hanja为null
- chinese必须使用简体中文
- meaning必须使用简体中文
- wordOrigin必须是以下之一：
  - "한자어"（汉字词，如 경제, 사회, 정치）
  - "고유어"（固有词/纯韩语词，如 하늘, 사람, 먹다）
  - "외래어"（外来词，如 뉴스, 컴퓨터, 버스）
  - "혼종어"（混合词，汉字+固有语组合，如 녹색빛）
- isFalseFriend：韩语和中文使用相同汉字但含义不同时为true
- 固有词（纯韩语）和外来词也要提供chinese翻译`,
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

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

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
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `请在以下韩语新闻脚本中找出主要语法模式。
对象：中文母语高级韩语学习者

脚本：
${script}

请重点查找以下新闻特有语法模式：
- -에 따르면（据...称）
- -(으)ㄹ 것으로 보입니다/전망입니다（预计...）
- -는 것으로 나타났습니다/알려졌습니다（据悉.../据了解...）
- -(으)ㄹ 방침입니다（方针是...）
- -에 나섰습니다（着手...）
- -(으)ㄴ/는 가운데（在...的情况下）
- -을/를 둘러싸고（围绕...）
- 其他新闻文体语法

返回JSON数组：
[{
  "pattern": "语法模式名称",
  "meaning": "韩语释义",
  "chineseMeaning": "简体中文解释",
  "example": "脚本中找到的例句",
  "sentenceIndex": 0
}]

sentenceIndex是将脚本按句号分句后的索引。
所有中文内容必须使用简体中文。
只返回JSON。`,
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

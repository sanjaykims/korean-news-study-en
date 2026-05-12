import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;

// POST /api/rewrite
// Body: { articleId: string, force?: boolean }
// Generates beginner/intermediate/advanced rewrites with news register preserved.
// Caches result in news_articles.transcript_proofread as JSON.
export async function POST(request: NextRequest) {
  const { articleId, force } = await request.json();
  if (!articleId) {
    return NextResponse.json({ error: 'articleId required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from('news_articles')
    .select('id, title, topic, reporter_name, transcript_original, transcript_proofread')
    .eq('id', articleId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  // Cache check
  if (!force && row.transcript_proofread) {
    try {
      const cached = JSON.parse(row.transcript_proofread);
      if (cached?.beginner && cached?.intermediate && cached?.advanced) {
        return NextResponse.json({ rewrites: cached, cached: true });
      }
    } catch {
      // not JSON — old format or partial. Regenerate.
    }
  }

  const segs = Array.isArray(row.transcript_original) ? row.transcript_original : [];
  const originalText = segs.map((s: { text: string }) => s.text).join(' ').trim();
  if (!originalText) {
    return NextResponse.json({ error: 'No transcript to rewrite' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `당신은 한국어 학습자(중국어 모국어)를 위한 뉴스 콘텐츠 작가입니다.
원본 JTBC 뉴스 기사를 학습 난이도별로 3단계로 다시 작성하세요.

원본 기사 제목: ${row.title}
원본 기사 토픽: ${row.topic || '사회'}
원본 전사문:
${originalText}

[필수 보존 항목 — 모든 난이도에서 반드시 유지]
1. 뉴스 헤드라인 스타일 도입부 (배경 설명이 아닌 핵심 사실로 시작)
2. 날짜·시간 표시 (지난 1월, 작년 5월, 4년 전 등)
3. 숫자·수치 (3년, 5kg, 두 장, 3위 등 구체적)
4. 인물 호칭 (이해인 선수, ○○ 기자 등)
5. 장소·고유명사 (베이징 올림픽 등)
6. 인용 형식 ("…"라고 말했습니다 / 전했습니다 / 밝혔습니다)
7. 뉴스 보도 어조

[난이도별 변경 사항 — 어휘와 문법만]

beginner (TOPIK 1-2):
- 문장당 평균 15음절 이내, 단문 위주
- 문법: -ㅂ니다/습니다, -았/었습니다, -지만, 그래서, 그리고
- 어휘: TOPIK 1-2급 일상 어휘만 사용
- 한자어는 가장 기본적인 것만 (선수, 시합, 결정 등)
- 어려운 용어는 풀어쓰기 ("자격 정지" → "시합에 못 나갈 뻔했습니다")
- 길이: 원문의 약 25-30%

intermediate (TOPIK 3-4):
- 연결어미 사용 (-아/어서, -면서, -지만, -다고 합니다)
- 적당한 한자어 (출전권, 준우승, 자격 정지, 법적인 다툼 등 포함 가능)
- 인용 표현 자연스럽게 ("…고 말했습니다")
- 길이: 원문의 약 50-60%

advanced (TOPIK 5-6):
- 거의 원문 수준의 보도 문체
- 복합 문법 (-(으)며, -았/었으나, -듯, -(으)ㄴ 채)
- 모든 한자어 사용 (전지훈련, 정상권 복귀, 감량, 거머쥐다, 대역전 등)
- 단, 원문의 전사 오류·반복·구어체 결함은 정리
- 길이: 원문의 약 70-80%

[금지 사항]
- "이 사람은 ~입니다" 같은 인물 소개식 도입
- 일기 또는 에세이 어조
- 1인칭 시점
- 추측·의견 추가 (원문에 없는 정보 금지)
- 학습 주석 ([설명]:, ※ 같은 메타 텍스트)

[출력 형식]
순수 JSON만 출력. 다른 설명·머리말·코드블록 표시 없음:
{
  "beginner": "여기에 초급 한국어 뉴스 본문 (3-4문단)",
  "intermediate": "여기에 중급 한국어 뉴스 본문 (4-5문단)",
  "advanced": "여기에 고급 한국어 뉴스 본문 (4-5문단)"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse rewrites', raw: text.slice(0, 200) }, { status: 500 });
    }

    const rewrites = JSON.parse(jsonMatch[0]);
    if (!rewrites.beginner || !rewrites.intermediate || !rewrites.advanced) {
      return NextResponse.json({ error: 'Incomplete rewrites' }, { status: 500 });
    }

    // Cache to DB
    await supabase
      .from('news_articles')
      .update({ transcript_proofread: JSON.stringify(rewrites) })
      .eq('id', articleId);

    return NextResponse.json({ rewrites, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

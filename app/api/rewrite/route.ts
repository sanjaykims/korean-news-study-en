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

  const prompt = `You are a news content writer for Korean language learners.
Rewrite the following JTBC news article at 3 difficulty levels for Korean learners.

Original article title: ${row.title}
Original article topic: ${row.topic || '사회'}
Original transcript:
${originalText}

[MUST PRESERVE — at all levels]
1. News headline-style opening (lead with key facts, not background)
2. Date/time markers (지난 1월, 작년 5월, 4년 전 etc.)
3. Numbers/figures (3년, 5kg, 두 장, 3위 etc. — keep specific)
4. Person titles (이해인 선수, ○○ 기자 etc.)
5. Place names/proper nouns (베이징 올림픽 etc.)
6. Quote format ("…"라고 말했습니다 / 전했습니다 / 밝혔습니다)
7. News reporting tone

[Level-specific changes — vocabulary and grammar ONLY]

beginner (TOPIK 1-2):
- Average 15 syllables per sentence, simple sentences
- Grammar: -ㅂ니다/습니다, -았/었습니다, -지만, 그래서, 그리고
- Vocabulary: TOPIK 1-2 level daily vocabulary only
- Only basic Sino-Korean words (선수, 시합, 결정 etc.)
- Simplify difficult terms ("자격 정지" → "시합에 못 나갈 뻔했습니다")
- Length: ~25-30% of original

intermediate (TOPIK 3-4):
- Connective endings (-아/어서, -면서, -지만, -다고 합니다)
- Moderate Sino-Korean vocabulary (출전권, 준우승, 자격 정지 etc.)
- Natural quote expressions ("…고 말했습니다")
- Length: ~50-60% of original

advanced (TOPIK 5-6):
- Near-original news writing style
- Complex grammar (-(으)며, -았/었으나, -듯, -(으)ㄴ 채)
- Full Sino-Korean vocabulary
- Clean up transcript errors, repetitions, spoken-language artifacts
- Length: ~70-80% of original

[PROHIBITED]
- "이 사람은 ~입니다" style person introductions
- Diary or essay tone
- First person perspective
- Adding speculation or opinions (no information not in original)
- Study annotations ([explanation]:, ※ or similar meta-text)

[OUTPUT FORMAT]
Pure JSON only. No explanation, preamble, or code block markers:
{
  "beginner": "beginner Korean news text here (3-4 paragraphs)",
  "intermediate": "intermediate Korean news text here (4-5 paragraphs)",
  "advanced": "advanced Korean news text here (4-5 paragraphs)"
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

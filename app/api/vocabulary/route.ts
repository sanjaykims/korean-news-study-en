import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/vocabulary
// 학습한 단어 vocabulary_log에 저장 (중복 건너뜀)
export async function POST(request: NextRequest) {
  const { words } = await request.json();
  if (!words || !Array.isArray(words)) {
    return NextResponse.json({ error: 'words array is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ saved: 0 });
  }

  let saved = 0;
  for (const w of words) {
    // 중복 확인
    const { data: existing } = await supabase
      .from('vocabulary_log')
      .select('id')
      .eq('word', w.word)
      .limit(1);

    if (existing && existing.length > 0) {
      // 이미 존재 → review_count 증가
      await supabase
        .from('vocabulary_log')
        .update({
          review_count: (existing[0] as { review_count?: number }).review_count
            ? ((existing[0] as { review_count?: number }).review_count || 0) + 1
            : 1,
          last_reviewed_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id);
    } else {
      // 신규 삽입
      await supabase.from('vocabulary_log').insert({
        word: w.word,
        hanja: w.hanja || null,
        chinese: w.chinese || null,
        meaning: w.meaning || null,
        source_article_id: w.sourceArticleId || null,
      });
      saved++;
    }
  }

  return NextResponse.json({ saved });
}

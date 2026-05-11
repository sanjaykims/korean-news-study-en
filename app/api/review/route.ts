import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SRS_INTERVALS_DAYS = [0, 1, 3, 7, 14, 30];

// GET /api/review — SRS-scheduled words due for review
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ words: [] });
  }

  const { data: allWords } = await supabase
    .from('vocabulary_log')
    .select('id, word, hanja, chinese, meaning, mastery_level, review_count, last_reviewed_at, word_origin')
    .order('mastery_level', { ascending: true })
    .order('last_reviewed_at', { ascending: true, nullsFirst: true });

  if (!allWords || allWords.length === 0) {
    return NextResponse.json({ words: [], dueCount: 0 });
  }

  const now = Date.now();
  const due = allWords.filter(w => {
    const lvl = Math.min(5, Math.max(0, w.mastery_level || 0));
    if (!w.last_reviewed_at) return true;
    const reviewedAt = new Date(w.last_reviewed_at).getTime();
    const intervalMs = SRS_INTERVALS_DAYS[lvl] * 86400000;
    return now - reviewedAt >= intervalMs;
  });

  return NextResponse.json({
    words: due.slice(0, 15),
    dueCount: due.length,
  });
}

// POST /api/review — submit review results, update mastery_level
export async function POST(request: NextRequest) {
  const { results } = await request.json();
  if (!results || !Array.isArray(results)) {
    return NextResponse.json({ error: 'results array required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ updated: 0 });
  }

  let updated = 0;
  for (const r of results) {
    const { wordId, remembered } = r;
    if (!wordId) continue;

    const { data: existing } = await supabase
      .from('vocabulary_log')
      .select('mastery_level, review_count')
      .eq('id', wordId)
      .single();

    if (!existing) continue;

    const currentMastery = existing.mastery_level || 0;
    const newMastery = remembered
      ? Math.min(5, currentMastery + 1)
      : Math.max(0, currentMastery - 1);

    await supabase
      .from('vocabulary_log')
      .update({
        mastery_level: newMastery,
        review_count: (existing.review_count || 0) + 1,
        last_reviewed_at: new Date().toISOString(),
      })
      .eq('id', wordId);

    updated++;
  }

  return NextResponse.json({ updated });
}

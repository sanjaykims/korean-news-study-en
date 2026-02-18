import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

// GET /api/review
// 복습할 단어 5개 반환 (vocabulary_log에서 mastery 낮은 순)
export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ words: [] });
  }

  const { data } = await supabase
    .from('vocabulary_log')
    .select('id, word, hanja, chinese, meaning, mastery_level, review_count')
    .order('mastery_level', { ascending: true })
    .order('last_reviewed_at', { ascending: true, nullsFirst: true })
    .limit(5);

  return NextResponse.json({ words: data || [] });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/sentence-bank
// 틀린 퀴즈 답 또는 낮은 쉐도잉 점수 문장 저장
export async function POST(request: NextRequest) {
  const { items } = await request.json();
  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ error: 'items array is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ saved: 0 });
  }

  const rows = items.map((item: {
    sentence: string;
    source: 'quiz' | 'shadowing';
    score?: number;
    sourceArticleId?: string;
  }) => ({
    sentence: item.sentence,
    source: item.source,
    score: item.score || null,
    source_article_id: item.sourceArticleId || null,
  }));

  const { error } = await supabase.from('sentence_bank').insert(rows);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: rows.length });
}

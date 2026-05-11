import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/dates — 콘텐츠가 있는 날짜 목록 반환
export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('news_videos')
    .select('broadcast_date')
    .order('broadcast_date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dates = (data || []).map((row: { broadcast_date: string }) => row.broadcast_date);

  return NextResponse.json({ dates });
}

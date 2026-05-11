import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' });
  }

  const { count, error } = await supabase
    .from('news_videos')
    .select('id', { count: 'exact', head: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  return NextResponse.json({ ok: true, videos: count });
}

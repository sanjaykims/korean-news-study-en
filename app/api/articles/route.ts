import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

// GET /api/articles?date=YYYY-MM-DD
// 날짜별 JTBC 기사 목록 반환
export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  // 날짜가 지정되지 않으면 최신 날짜 사용
  let query = supabase
    .from('news_articles')
    .select(`
      id,
      title,
      reporter_name,
      topic,
      start_time,
      end_time,
      article_order,
      created_at,
      news_videos!inner(broadcast_date, youtube_id, thumbnail_url)
    `)
    .order('article_order', { ascending: true });

  if (date) {
    query = query.eq('news_videos.broadcast_date', date);
  } else {
    // 최신 날짜의 기사들
    const { data: latestVideo } = await supabase
      .from('news_videos')
      .select('broadcast_date')
      .order('broadcast_date', { ascending: false })
      .limit(1)
      .single();

    if (latestVideo) {
      query = query.eq('news_videos.broadcast_date', latestVideo.broadcast_date);
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles = (data || []).map((row: Record<string, any>) => ({
    id: row.id,
    title: row.title,
    reporter: row.reporter_name || '',
    topic: row.topic || '사회',
    startTime: row.start_time,
    endTime: row.end_time,
    newsDate: row.news_videos?.broadcast_date || '',
    videoId: row.news_videos?.youtube_id || '',
    thumbnailUrl: row.news_videos?.thumbnail_url || '',
  }));

  return NextResponse.json({ articles });
}

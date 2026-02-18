import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

// GET /api/articles/[id]
// 개별 기사 상세 반환 (스크립트 학습용)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('news_articles')
    .select(`
      id,
      title,
      reporter_name,
      topic,
      start_time,
      end_time,
      transcript_original,
      transcript_proofread,
      article_order,
      news_videos!inner(youtube_id, broadcast_date, thumbnail_url)
    `)
    .eq('id', params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as Record<string, any>;

  // 전사 세그먼트 처리
  let transcriptSegments: { text: string; start: number; end: number }[] | undefined;
  if (row.transcript_original && Array.isArray(row.transcript_original)) {
    transcriptSegments = row.transcript_original;
  }

  const article = {
    id: row.id,
    title: row.title,
    reporter: row.reporter_name || '',
    topic: row.topic || '사회',
    videoId: row.news_videos?.youtube_id || '',
    startTime: row.start_time,
    endTime: row.end_time,
    newsDate: row.news_videos?.broadcast_date || '',
    thumbnailUrl: row.news_videos?.thumbnail_url || '',
    transcriptSegments,
    proofreadScript: row.transcript_proofread || undefined,
  };

  return NextResponse.json({ article });
}

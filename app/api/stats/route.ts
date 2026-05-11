import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const [vocabRes, articlesRes, videosRes, eventsRes, reportsRes] = await Promise.all([
    supabase
      .from('vocabulary_log')
      .select('id, word, mastery_level, review_count, word_origin, last_reviewed_at, created_at'),
    supabase
      .from('news_articles')
      .select('id, topic, created_at'),
    supabase
      .from('news_videos')
      .select('id, broadcast_date'),
    supabase
      .from('learning_events')
      .select('event_type, payload, created_at')
      .in('event_type', ['session_start', 'session_complete', 'stage_complete', 'report_generated'])
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('learning_events')
      .select('created_at, payload')
      .eq('event_type', 'report_generated')
      .order('created_at', { ascending: false }),
  ]);

  const vocab = vocabRes.data || [];
  const articles = articlesRes.data || [];
  const videos = videosRes.data || [];
  const events = eventsRes.data || [];
  const reports = reportsRes.data || [];

  // Mastery distribution
  const masteryDist = [0, 0, 0, 0, 0, 0]; // levels 0-5
  for (const w of vocab) {
    const lvl = Math.min(5, Math.max(0, w.mastery_level || 0));
    masteryDist[lvl]++;
  }

  // Word origin distribution
  const originDist: Record<string, number> = {};
  for (const w of vocab) {
    const origin = w.word_origin || '미분류';
    originDist[origin] = (originDist[origin] || 0) + 1;
  }

  // Study days from session_start events
  const studyDaysSet = new Set<string>();
  const activityByDay: Record<string, number> = {};
  for (const e of events) {
    if (e.event_type === 'session_start') {
      const day = e.created_at.split('T')[0];
      studyDaysSet.add(day);
      activityByDay[day] = (activityByDay[day] || 0) + 1;
    }
  }

  // Current streak
  const studyDays = Array.from(studyDaysSet).sort().reverse();
  let streak = 0;
  if (studyDays.length > 0) {
    const today = new Date();
    const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
    let checkDate = kst.toISOString().split('T')[0];

    // Allow starting from today or yesterday
    if (!studyDaysSet.has(checkDate)) {
      const yesterday = new Date(kst.getTime() - 86400000);
      checkDate = yesterday.toISOString().split('T')[0];
    }

    let d = new Date(checkDate + 'T00:00:00');
    while (studyDaysSet.has(d.toISOString().split('T')[0])) {
      streak++;
      d = new Date(d.getTime() - 86400000);
    }
  }

  // Activity last 30 days
  const last30: { date: string; sessions: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() + 9 * 60 * 60 * 1000 - i * 86400000);
    const day = d.toISOString().split('T')[0];
    last30.push({ date: day, sessions: activityByDay[day] || 0 });
  }

  // Weakest words (low mastery, reviewed at least once)
  const weakest = vocab
    .filter(w => w.review_count > 0)
    .sort((a, b) => (a.mastery_level || 0) - (b.mastery_level || 0) || (b.review_count || 0) - (a.review_count || 0))
    .slice(0, 10)
    .map(w => ({
      word: w.word,
      mastery: w.mastery_level || 0,
      reviews: w.review_count || 0,
    }));

  // SRS due count
  const srsIntervals = [0, 1, 3, 7, 14, 30]; // days per mastery level
  const nowMs = Date.now();
  let dueCount = 0;
  for (const w of vocab) {
    const lvl = Math.min(5, Math.max(0, w.mastery_level || 0));
    if (!w.last_reviewed_at) {
      dueCount++;
      continue;
    }
    const reviewedAt = new Date(w.last_reviewed_at).getTime();
    const intervalMs = srsIntervals[lvl] * 86400000;
    if (nowMs - reviewedAt >= intervalMs) dueCount++;
  }

  return NextResponse.json({
    totalWords: vocab.length,
    totalArticles: articles.length,
    totalBroadcasts: videos.length,
    studyDays: studyDaysSet.size,
    streak,
    masteryDist,
    originDist,
    last30,
    weakest,
    dueCount,
    totalReports: reports.length,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

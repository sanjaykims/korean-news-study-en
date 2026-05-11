import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300;

/**
 * GET /api/auto-ingest?date=2026-02-17&videoId=ZToYdGoUQGQ
 *
 * Transcript extraction priority:
 *   1. TRANSCRIPT_PROXY_URL (external proxy, e.g. Cloudflare Worker in Korea)
 *   2. Built-in edge proxy (/api/yt-proxy on Seoul/Tokyo PoP)
 *
 * videoId: optional — skip search and use this video directly
 * date: target date (default: today KST)
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  let date = request.nextUrl.searchParams.get('date');
  if (!date) {
    // Cron runs at 01:00 KST — fetch previous day's broadcast
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    kst.setDate(kst.getDate() - 1);
    date = kst.toISOString().split('T')[0];
  }

  const directVideoId = request.nextUrl.searchParams.get('videoId');
  console.log(`[auto-ingest] Starting for date: ${date}${directVideoId ? ` (direct: ${directVideoId})` : ''}`);

  // Build absolute URL to the edge proxy
  const proxyUrl = new URL('/api/yt-proxy', request.url).toString();

  async function callProxy(body: Record<string, unknown>) {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // Edge proxy returned non-JSON (timeout, crash, HTML error page)
      return { error: `Edge proxy error (HTTP ${res.status}): ${text.substring(0, 100)}` };
    }
  }

  // External transcript proxy (Cloudflare Worker or any Korean-IP service)
  const transcriptProxyUrl = process.env.TRANSCRIPT_PROXY_URL;

  async function callTranscriptProxy(videoId: string) {
    if (!transcriptProxyUrl) return null;
    try {
      console.log(`[auto-ingest] Trying external transcript proxy: ${transcriptProxyUrl}`);
      const res = await fetch(transcriptProxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (data.transcript?.length > 0) {
        console.log(`[auto-ingest] External proxy success: ${data.transcript.length} segments via ${data.method}`);
        return data;
      }
      console.log(`[auto-ingest] External proxy returned no transcript: ${data.error || 'empty'}`);
      return data; // Return for error info even if no transcript
    } catch (e) {
      console.log(`[auto-ingest] External proxy failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  function extractBroadcastDate(title: string): string | null {
    const match = title.match(/\((\d{2})\.(\d{1,2})\.(\d{1,2})\)/);
    if (!match) return null;
    const year = 2000 + parseInt(match[1]);
    const month = String(match[2]).padStart(2, '0');
    const day = String(match[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  try {
    let videoId: string;
    let videoTitle: string = '';

    if (directVideoId) {
      videoId = directVideoId;
    } else {
      // Auto-search via edge proxy channel browse
      const d = new Date(date + 'T00:00:00');
      const yy = String(d.getFullYear()).slice(2);
      const m = d.getMonth() + 1;
      const dd = d.getDate();
      const dateStr = `${yy}.${String(m).padStart(2, '0')}.${String(dd).padStart(2, '0')}`;

      console.log(`[auto-ingest] Browsing JTBC channel for "${dateStr}"...`);
      const browseResult = await callProxy({ action: 'browse', dateStr });

      if (browseResult.candidates?.length) {
        videoId = browseResult.candidates[0].id;
        videoTitle = browseResult.candidates[0].title;
        console.log(`[auto-ingest] Found via browse: "${videoTitle}" [${videoId}]`);
      } else {
        // Fallback: YouTube search (like local ingest script)
        const fullDate = `${d.getFullYear()}년 ${m}월 ${dd}일`;
        const queries = [
          `JTBC 뉴스룸 다시보기 ${dateStr}`,
          `JTBC 뉴스룸 ${fullDate}`,
          `JTBC 뉴스룸 풀영상 ${dateStr}`,
        ];
        console.log(`[auto-ingest] Browse failed, trying YouTube search...`);
        const searchResult = await callProxy({ action: 'search', params: { queries, dateStr } });

        if (!searchResult.candidates?.length) {
          return NextResponse.json({
            date,
            error: `JTBC 뉴스룸 영상을 찾지 못했습니다 (${dateStr})`,
            articles: 0,
            browseError: browseResult.error,
            searchError: searchResult.error,
          });
        }

        videoId = searchResult.candidates[0].id;
        videoTitle = searchResult.candidates[0].title;
        console.log(`[auto-ingest] Found via search: "${videoTitle}" [${videoId}]`);
      }
    }

    // Check for duplicates
    const { data: existingVideo } = await supabase
      .from('news_videos')
      .select('id')
      .eq('youtube_id', videoId)
      .single();

    if (existingVideo) {
      return NextResponse.json({ date, articles: 0, skipped: true, videoId });
    }

    // ─── Try extracting transcript ───
    // Priority 1: External transcript proxy (Cloudflare Worker / Korean IP)
    // Priority 2: Built-in edge proxy (Vercel Seoul/Tokyo PoP)
    let transcriptResult = await callTranscriptProxy(videoId);
    const externalErrors = transcriptResult?.errors || [];

    if (!transcriptResult?.transcript?.length) {
      console.log(`[auto-ingest] Falling back to edge proxy for ${videoId}...`);
      const edgeResult = await callProxy({ action: 'transcript', videoId });
      // Merge errors from both attempts
      const allErrors = [
        ...externalErrors.map((e: string) => `[외부프록시] ${e}`),
        ...(edgeResult.errors || []).map((e: string) => `[엣지] ${e}`),
      ];

      if (edgeResult.transcript?.length) {
        transcriptResult = edgeResult;
        transcriptResult.errors = allErrors;
      } else {
        // Both failed — return combined error info
        return NextResponse.json({
          date,
          videoId,
          videoTitle: edgeResult.title || transcriptResult?.title || videoTitle,
          error: edgeResult.error || transcriptResult?.error || '자막 추출 실패',
          errors: allErrors.length > 0 ? allErrors : (edgeResult.errors || []),
          durationSeconds: edgeResult.durationSeconds || transcriptResult?.durationSeconds,
          chapters: edgeResult.chapters || transcriptResult?.chapters || [],
          articles: 0,
          hasExternalProxy: !!transcriptProxyUrl,
        });
      }
    }

    console.log(`[auto-ingest] Got ${transcriptResult.transcript.length} segments, ${transcriptResult.chapters?.length || 0} chapters`);

    if (!transcriptResult.chapters?.length) {
      return NextResponse.json({ date, videoId, error: 'YouTube 챕터 없음', articles: 0 });
    }

    // Extract actual broadcast date from video title (e.g. "(26.3.26)" → "2026-03-26")
    const finalTitle = transcriptResult.title || videoTitle;
    const actualDate = extractBroadcastDate(finalTitle) || date;
    if (actualDate !== date) {
      console.log(`[auto-ingest] Broadcast date corrected: ${date} → ${actualDate} (from title)`);
    }

    // Call the existing ingest pipeline
    const ingestUrl = new URL('/api/ingest', request.url);
    const ingestRes = await fetch(ingestUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: actualDate,
        youtubeId: videoId,
        videoTitle: finalTitle,
        durationSeconds: transcriptResult.durationSeconds,
        chapters: transcriptResult.chapters,
        transcript: transcriptResult.transcript,
      }),
    });

    const result = await ingestRes.json();
    console.log(`[auto-ingest] Result:`, result);

    return NextResponse.json({
      date: actualDate,
      videoId,
      videoTitle: finalTitle,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-ingest] Error:`, msg);
    return NextResponse.json({ date, error: msg, articles: 0 }, { status: 500 });
  }
}

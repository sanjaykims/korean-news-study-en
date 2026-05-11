import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { TranscriptSegment } from '@/lib/youtubeTranscript';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;

interface Chapter {
  title: string;
  startSeconds: number;
}

// Claude API로 토픽 분류 (정치/경제/사회/국제)
async function classifyTopics(
  chapters: { title: string; content: string }[],
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return chapters.map(() => '사회');

  const client = new Anthropic({ apiKey });

  const list = chapters.map((c, i) => `${i}. ${c.title}: ${c.content.slice(0, 100)}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `다음 뉴스 기사들의 토픽을 분류해 주세요.
토픽은 반드시 다음 중 하나: 정치, 경제, 사회, 국제, 스포츠, 문화

JSON 배열로 반환 (인덱스 순서대로 토픽만): ["사회", "정치", ...]
JSON만 반환하세요.

${list}`,
    }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return chapters.map(() => '사회');
    return JSON.parse(jsonMatch[0]) as string[];
  } catch {
    return chapters.map(() => '사회');
  }
}

const LONG_CHAPTER_THRESHOLD = 300; // 5분 이상이면 여러 기사 합본일 가능성

// 긴 챕터를 Claude로 개별 기사로 분할
async function subSplitLongArticle(
  article: { title: string; content: string; startTime: number; endTime: number },
  transcript: TranscriptSegment[],
): Promise<{ title: string; content: string; startTime: number; endTime: number }[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [article];

  const segs = transcript.filter(s => s.start >= article.startTime && s.start < article.endTime);
  if (segs.length < 10) return [article];

  const client = new Anthropic({ apiKey });

  // 타임스탬프 포함 텍스트
  const text = segs.map(s => `[${Math.floor(s.start)}] ${s.text}`).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `다음은 JTBC 뉴스룸의 "${article.title}" 세그먼트 자막입니다.
이 세그먼트에는 여러 기자의 개별 뉴스 기사가 포함되어 있을 수 있습니다.

기자 교체, 앵커 멘트 전환, 주제 변경을 기준으로 개별 기사를 분리해 주세요.
- "XXX 기자입니다", "XXX 기자가 보도합니다", "다음 뉴스입니다" 등의 패턴 주목
- 각 기사에 내용을 요약하는 한국어 제목을 달아주세요
- [숫자]는 해당 자막의 시작 시간(초)입니다

JSON 배열만 반환 (다른 텍스트 없이):
[{"title": "기사 제목", "startTime": 시작초}]

하나의 기사만 있다면 하나만 반환하세요.

자막:
${text}`,
      }],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [article];

    const splits: { title: string; startTime: number }[] = JSON.parse(jsonMatch[0]);
    if (!splits || splits.length <= 1) return [article];

    const subArticles: { title: string; content: string; startTime: number; endTime: number }[] = [];
    for (let i = 0; i < splits.length; i++) {
      const startSec = splits[i].startTime;
      const endSec = i + 1 < splits.length ? splits[i + 1].startTime : article.endTime;

      const subSegs = transcript.filter(s => s.start >= startSec && s.start < endSec);
      const content = subSegs.map(s => s.text).join(' ')
        .replace(/\[음악\]/g, '')
        .replace(/>>/g, '')
        .trim();

      if (content.length > 20) {
        subArticles.push({
          title: splits[i].title,
          content,
          startTime: startSec,
          endTime: endSec,
        });
      }
    }

    console.log(`[ingest] Sub-split "${article.title}" → ${subArticles.length} articles`);
    return subArticles.length > 0 ? subArticles : [article];
  } catch (err) {
    console.error(`[ingest] Sub-split failed for "${article.title}":`, err);
    return [article];
  }
}

// YouTube 챕터 기반으로 transcript를 기사별로 분할
function splitByChapters(
  transcript: TranscriptSegment[],
  chapters: Chapter[],
  totalDuration: number,
): { title: string; content: string; startTime: number; endTime: number }[] {
  const articles: { title: string; content: string; startTime: number; endTime: number }[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const startSec = chapters[i].startSeconds;
    const endSec = i + 1 < chapters.length ? chapters[i + 1].startSeconds : totalDuration;

    // 해당 시간 범위의 세그먼트 수집
    const segs = transcript.filter(s => s.start >= startSec && s.start < endSec);
    const content = segs.map(s => s.text).join(' ')
      .replace(/\[음악\]/g, '')
      .replace(/>>/g, '')
      .trim();

    if (content.length > 20) {
      articles.push({
        title: chapters[i].title,
        content,
        startTime: startSec,
        endTime: endSec,
      });
    }
  }

  return articles;
}

/**
 * POST /api/ingest
 * Body: {
 *   date: "2026-02-17",
 *   youtubeId: "xxxxx",
 *   videoTitle: "...",
 *   durationSeconds: 2828,
 *   chapters: [{title, startSeconds}, ...],  // YouTube 챕터
 *   transcript: [{text, start, duration}, ...]
 * }
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { date, youtubeId, videoTitle, durationSeconds, chapters, transcript } = body as {
    date: string;
    youtubeId: string;
    videoTitle: string;
    durationSeconds: number;
    chapters: Chapter[];
    transcript: TranscriptSegment[];
  };

  if (!date || !youtubeId || !transcript?.length) {
    return NextResponse.json({ error: 'date, youtubeId, transcript[] required' }, { status: 400 });
  }

  if (!chapters?.length) {
    return NextResponse.json({ error: 'chapters[] required — YouTube 챕터 타임스탬프가 필요합니다' }, { status: 400 });
  }

  console.log(`[ingest] date=${date}, video=${youtubeId}, chapters=${chapters.length}, segments=${transcript.length}`);

  try {
    // 중복 확인
    const { data: existingVideo } = await supabase
      .from('news_videos')
      .select('id')
      .eq('youtube_id', youtubeId)
      .single();

    if (existingVideo) {
      return NextResponse.json({ date, articles: 0, skipped: true });
    }

    // news_videos 삽입
    const { data: videoRow, error: videoError } = await supabase
      .from('news_videos')
      .insert({
        youtube_id: youtubeId,
        title: videoTitle,
        broadcaster: 'JTBC',
        broadcast_date: date,
        duration_seconds: durationSeconds || 0,
        thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`,
        transcript_raw: transcript,
      })
      .select('id')
      .single();

    if (videoError) {
      return NextResponse.json({ date, articles: 0, error: `DB 삽입 실패 — ${videoError.message}` });
    }

    // 챕터 기반 기사 분할
    const splitArticles = splitByChapters(transcript, chapters, durationSeconds);

    if (splitArticles.length === 0) {
      return NextResponse.json({ date, articles: 0, error: '기사 분할 결과 없음' });
    }

    // 긴 챕터 (5분+) → Claude로 개별 기사 분리
    const finalArticles: typeof splitArticles = [];
    for (const article of splitArticles) {
      const duration = article.endTime - article.startTime;
      if (duration > LONG_CHAPTER_THRESHOLD) {
        console.log(`[ingest] Long chapter detected: "${article.title}" (${Math.floor(duration / 60)}m${Math.floor(duration % 60)}s)`);
        const subArticles = await subSplitLongArticle(article, transcript);
        finalArticles.push(...subArticles);
      } else {
        finalArticles.push(article);
      }
    }

    // Claude로 토픽 분류
    const topics = await classifyTopics(finalArticles);

    // DB 삽입
    const articlesToInsert = finalArticles.map((article, i) => ({
      video_id: videoRow.id,
      title: article.title,
      reporter_name: null,
      topic: topics[i] || '사회',
      start_time: article.startTime,
      end_time: article.endTime,
      transcript_original: [{ text: article.content, start: article.startTime, end: article.endTime }],
      transcript_proofread: null,
      article_order: i,
    }));

    const { error: articlesError } = await supabase
      .from('news_articles')
      .insert(articlesToInsert);

    if (articlesError) {
      return NextResponse.json({ date, articles: 0, error: `기사 삽입 실패 — ${articlesError.message}` });
    }

    return NextResponse.json({ date, articles: articlesToInsert.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ date, articles: 0, error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Use /admin page to ingest JTBC 뉴스룸' });
}

/**
 * DELETE /api/ingest
 * Body: { youtubeId: "xxxxx" }
 * 영상과 관련 기사, 학습 데이터를 모두 삭제
 */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { youtubeId } = body as { youtubeId: string };

  if (!youtubeId) {
    return NextResponse.json({ error: 'youtubeId required' }, { status: 400 });
  }

  try {
    // 영상 UUID 조회
    const { data: video } = await supabase
      .from('news_videos')
      .select('id')
      .eq('youtube_id', youtubeId)
      .single();

    if (!video) {
      return NextResponse.json({ error: `Video not found: ${youtubeId}` }, { status: 404 });
    }

    // 해당 영상의 기사 ID 목록
    const { data: articles } = await supabase
      .from('news_articles')
      .select('id')
      .eq('video_id', video.id);

    const articleIds = (articles || []).map(a => a.id);

    if (articleIds.length > 0) {
      // 하위 테이블 정리 (CASCADE 없는 FK들)
      await supabase.from('study_sessions').delete().in('article_id', articleIds);
      await supabase.from('sentence_bank').delete().in('source_article_id', articleIds);
      await supabase.from('vocabulary_log').delete().in('source_article_id', articleIds);
    }

    // news_videos 삭제 → news_articles CASCADE 삭제
    const { error: deleteError } = await supabase
      .from('news_videos')
      .delete()
      .eq('id', video.id);

    if (deleteError) {
      return NextResponse.json({ error: `삭제 실패: ${deleteError.message}` }, { status: 500 });
    }

    console.log(`[ingest] Deleted video ${youtubeId} and ${articleIds.length} articles`);
    return NextResponse.json({ deleted: true, youtubeId, articlesRemoved: articleIds.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

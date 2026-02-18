import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitArticles } from '@/lib/articleSplitter';
import { TranscriptSegment } from '@/lib/youtubeTranscript';
import Anthropic from '@anthropic-ai/sdk';

// Vercel serverless 최대 실행 시간 (초)
export const maxDuration = 300;

// Claude API로 기사 제목 + 토픽 생성
async function generateTitlesAndTopics(
  articles: { reporter: string; content: string }[],
): Promise<{ title: string; topic: string }[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return articles.map(a => ({
      title: `${a.reporter} 기자 보도`,
      topic: '사회',
    }));
  }

  const client = new Anthropic({ apiKey });

  const articlesText = articles
    .map((a, i) => `[기사 ${i + 1}] 기자: ${a.reporter}\n${a.content.slice(0, 300)}...`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `다음 한국어 뉴스 기사들의 제목과 토픽을 생성해 주세요.
토픽은 반드시 다음 중 하나여야 합니다: 정치, 경제, 사회, 국제

JSON 배열로 반환해 주세요: [{"index": 0, "title": "제목", "topic": "토픽"}]
JSON만 반환하고 다른 텍스트는 포함하지 마세요.

${articlesText}`,
    }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    const parsed = JSON.parse(jsonMatch[0]) as { index: number; title: string; topic: string }[];
    return parsed.map(p => ({ title: p.title, topic: p.topic }));
  } catch {
    return articles.map(a => ({
      title: `${a.reporter} 기자 보도`,
      topic: '사회',
    }));
  }
}

// Claude로 대본 교정 (맞춤법, 띄어쓰기, 조사)
async function proofreadTranscript(content: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return content;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `다음은 YouTube 자동 생성 자막에서 추출한 한국어 뉴스 대본입니다.
맞춤법, 띄어쓰기, 조사, 문장부호를 교정해 주세요.
원래 내용과 문장 구조는 유지하되, 자연스러운 한국어 뉴스 대본으로 교정해 주세요.
교정된 대본만 반환하고, 설명이나 메모는 포함하지 마세요.

${content}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return text.trim() || content;
}

// 메인 수집 로직 — 브라우저에서 전달받은 transcript 사용
async function processIngest(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  targetDate: string,
  youtubeId: string,
  videoTitle: string,
  durationSeconds: number,
  transcript: TranscriptSegment[],
): Promise<{ articles: number; error?: string; skipped?: boolean }> {
  // 중복 확인
  const { data: existingVideo } = await supabase
    .from('news_videos')
    .select('id')
    .eq('youtube_id', youtubeId)
    .single();

  if (existingVideo) {
    return { articles: 0, skipped: true };
  }

  // news_videos 삽입
  const { data: videoRow, error: videoError } = await supabase
    .from('news_videos')
    .insert({
      youtube_id: youtubeId,
      title: videoTitle,
      broadcast_date: targetDate,
      duration_seconds: durationSeconds,
      thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`,
      transcript_raw: transcript,
    })
    .select('id')
    .single();

  if (videoError) {
    return { articles: 0, error: `DB 삽입 실패 — ${videoError.message}` };
  }

  // 기사 분할
  const splitResults = splitArticles(transcript);

  if (splitResults.length === 0) {
    return { articles: 0, error: '기사 분할 결과 없음' };
  }

  // Claude로 제목/토픽 생성
  const titlesAndTopics = await generateTitlesAndTopics(
    splitResults.map(a => ({ reporter: a.reporter, content: a.content })),
  );

  // 각 기사 대본 교정 + DB 삽입
  const articlesToInsert = await Promise.all(
    splitResults.map(async (article, i) => {
      const proofread = await proofreadTranscript(article.content);
      return {
        video_id: videoRow.id,
        title: titlesAndTopics[i]?.title || `${article.reporter} 기자 보도`,
        reporter_name: article.reporter,
        topic: titlesAndTopics[i]?.topic || '사회',
        start_time: article.startTime || 0,
        end_time: article.endTime || 0,
        transcript_original: [{ text: article.content, start: article.startTime || 0, end: article.endTime || 0 }],
        transcript_proofread: proofread,
        article_order: article.articleOrder,
      };
    }),
  );

  const { error: articlesError } = await supabase
    .from('news_articles')
    .insert(articlesToInsert);

  if (articlesError) {
    return { articles: 0, error: `기사 삽입 실패 — ${articlesError.message}` };
  }

  return { articles: articlesToInsert.length };
}

/**
 * POST /api/ingest
 * 브라우저에서 YouTube 자막을 추출해서 전달하면
 * 서버에서 기사 분할 + Claude 교정 + DB 저장 처리
 *
 * Body: {
 *   date: "2026-02-17",
 *   youtubeId: "xxxxx",
 *   videoTitle: "JTBC 뉴스룸...",
 *   durationSeconds: 3600,
 *   transcript: [{text, start, duration}, ...]
 * }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { date, youtubeId, videoTitle, durationSeconds, transcript } = body as {
    date: string;
    youtubeId: string;
    videoTitle: string;
    durationSeconds: number;
    transcript: TranscriptSegment[];
  };

  if (!date || !youtubeId || !transcript?.length) {
    return NextResponse.json(
      { error: 'date, youtubeId, transcript[] required' },
      { status: 400 },
    );
  }

  console.log(`[ingest] 수집 시작: date=${date}, video=${youtubeId}, segments=${transcript.length}`);

  try {
    const result = await processIngest(
      supabase,
      date,
      youtubeId,
      videoTitle || 'JTBC 뉴스룸',
      durationSeconds || 0,
      transcript,
    );

    if (result.skipped) {
      console.log(`[ingest] 이미 처리됨 (skip)`);
    } else if (result.error) {
      console.log(`[ingest] 실패 — ${result.error}`);
    } else {
      console.log(`[ingest] 성공, ${result.articles}개 기사`);
    }

    return NextResponse.json({ date, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ingest] 예외 — ${msg}`);
    return NextResponse.json({ date, articles: 0, error: msg }, { status: 500 });
  }
}

// GET — 상태 확인용
export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Use POST with transcript data or use /admin page' });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitArticles } from '@/lib/articleSplitter';
import { getTranscript, TranscriptSegment } from '@/lib/youtubeTranscript';
import Anthropic from '@anthropic-ai/sdk';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YouTube = require('youtube-search-api');

// Vercel serverless 최대 실행 시간 (초)
export const maxDuration = 300;

// 날짜를 한국어 검색 형식으로 (예: "2026년 2월 14일")
function formatDateKorean(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 현재 KST 시간
function getKSTNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// 수집 대상 날짜 (KST 06시 이전이면 전날)
function getTargetDateKST(): string {
  const kst = getKSTNow();
  const kstHour = kst.getUTCHours();
  if (kstHour < 6) {
    const yesterday = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().split('T')[0];
  }
  return kst.toISOString().split('T')[0];
}

// YouTube 검색
async function searchYouTube(query: string): Promise<{ id: string; title: string; duration: string }[]> {
  const results = await YouTube.GetListByKeyword(query, false, 10);
  return (results.items || [])
    .filter((item: Record<string, unknown>) => item.type === 'video')
    .map((item: Record<string, unknown>) => ({
      id: item.id as string,
      title: item.title as string,
      duration: (item.length as Record<string, unknown>)?.simpleText as string || '',
    }));
}

// 영상 길이를 초로 변환
function parseDuration(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

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

// JTBC 수집 메인 로직
async function ingestJTBC(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  targetDate: string,
  dateKorean: string,
): Promise<{ articles: number; error?: string; skipped?: boolean }> {
  // 중복 확인
  const { data: existing } = await supabase
    .from('news_videos')
    .select('id')
    .eq('broadcast_date', targetDate)
    .limit(1);

  if (existing && existing.length > 0) {
    return { articles: 0, skipped: true };
  }

  // YouTube 검색
  const searchQuery = `JTBC 뉴스룸 풀영상 ${dateKorean}`;
  const results = await searchYouTube(searchQuery);

  const fullBroadcast = results.find(r => parseDuration(r.duration) >= 1200);
  if (!fullBroadcast) {
    return { articles: 0, error: `풀 방송 영상을 찾지 못했습니다 (검색: "${searchQuery}")` };
  }

  // youtube_id 중복 확인
  const { data: existingVideo } = await supabase
    .from('news_videos')
    .select('id')
    .eq('youtube_id', fullBroadcast.id)
    .single();

  if (existingVideo) {
    return { articles: 0, skipped: true };
  }

  // 자막 추출
  let transcript: TranscriptSegment[];
  try {
    transcript = await getTranscript(fullBroadcast.id);
  } catch {
    return { articles: 0, error: `자막 추출 실패 (${fullBroadcast.id})` };
  }

  if (transcript.length === 0) {
    return { articles: 0, error: `자막 없음 (${fullBroadcast.id})` };
  }

  // news_videos 삽입
  const { data: videoRow, error: videoError } = await supabase
    .from('news_videos')
    .insert({
      youtube_id: fullBroadcast.id,
      title: fullBroadcast.title,
      broadcast_date: targetDate,
      duration_seconds: parseDuration(fullBroadcast.duration),
      thumbnail_url: `https://img.youtube.com/vi/${fullBroadcast.id}/maxresdefault.jpg`,
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

async function handleIngest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  let targetDate: string;
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    targetDate = (body as Record<string, string>).date || getTargetDateKST();
  } else {
    const { searchParams } = new URL(request.url);
    targetDate = searchParams.get('date') || getTargetDateKST();
  }

  const dateKorean = formatDateKorean(targetDate);

  console.log(`[ingest] JTBC 수집 시작: date=${targetDate}`);

  try {
    const result = await ingestJTBC(supabase, targetDate, dateKorean);

    if (result.skipped) {
      console.log(`[ingest] JTBC: 이미 처리됨 (skip)`);
    } else if (result.error) {
      console.log(`[ingest] JTBC: 실패 — ${result.error}`);
    } else {
      console.log(`[ingest] JTBC: 성공, ${result.articles}개 기사`);
    }

    return NextResponse.json({
      date: targetDate,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ingest] JTBC: 예외 — ${msg}`);
    return NextResponse.json({ date: targetDate, articles: 0, error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleIngest(request);
}

export async function POST(request: NextRequest) {
  return handleIngest(request);
}

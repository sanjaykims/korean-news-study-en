'use client';

import { useState } from 'react';

// YouTube Innertube API — 브라우저에서 직접 호출 (CORS 우회 위해 proxy 사용)
async function extractTranscript(videoId: string): Promise<{ text: string; start: number; duration: number }[]> {
  // 브라우저에서 YouTube Innertube API 직접 호출
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260101.00.00',
          hl: 'ko',
          gl: 'KR',
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  const playerData = await playerRes.json();
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('자막 트랙 없음');

  const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
  if (!koTrack) throw new Error('한국어 자막 없음');

  // 자막 다운로드 (json3 형식)
  const capUrl = koTrack.baseUrl + '&fmt=json3';
  const capRes = await fetch(capUrl);
  const capData = await capRes.json();

  const segments: { text: string; start: number; duration: number }[] = [];
  for (const ev of capData?.events || []) {
    if (ev.segs) {
      const text = ev.segs.map((s: { utf8?: string }) => s.utf8 || '').join('').trim();
      if (text && text !== '\n') {
        segments.push({
          text,
          start: (ev.tStartMs || 0) / 1000,
          duration: (ev.dDurationMs || 0) / 1000,
        });
      }
    }
  }

  if (segments.length === 0) {
    // srv3 XML fallback
    const xmlUrl = koTrack.baseUrl + '&fmt=srv3';
    const xmlRes = await fetch(xmlUrl);
    const xml = await xmlRes.text();

    const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const text = m[3]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n/g, ' ')
        .trim();
      if (text) {
        segments.push({
          text,
          start: parseInt(m[1]) / 1000,
          duration: parseInt(m[2]) / 1000,
        });
      }
    }
  }

  return segments;
}

// YouTube 검색 (Innertube WEB search)
async function searchYouTube(query: string): Promise<{ id: string; title: string; duration: string; thumbnail: string }[]> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260101.00.00',
          hl: 'ko',
          gl: 'KR',
        },
      },
      query,
    }),
  });

  const data = await res.json();
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const items: { id: string; title: string; duration: string; thumbnail: string }[] = [];

  for (const section of contents) {
    const renderers = section?.itemSectionRenderer?.contents || [];
    for (const item of renderers) {
      const v = item?.videoRenderer;
      if (v?.videoId) {
        items.push({
          id: v.videoId,
          title: v.title?.runs?.map((r: { text: string }) => r.text).join('') || '',
          duration: v.lengthText?.simpleText || '',
          thumbnail: v.thumbnail?.thumbnails?.[0]?.url || '',
        });
      }
    }
  }

  return items;
}

function parseDuration(d: string): number {
  const parts = d.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export default function AdminPage() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ articles: number; error?: string; skipped?: boolean } | null>(null);

  async function runIngest() {
    setLoading(true);
    setResults(null);
    setStatus('');

    try {
      // Step 1: YouTube 검색
      const d = new Date(date + 'T00:00:00');
      const dateKorean = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
      const query = `JTBC 뉴스룸 풀영상 ${dateKorean}`;
      setStatus(`🔍 검색 중: "${query}"`);

      const videos = await searchYouTube(query);
      const fullBroadcast = videos.find(v => parseDuration(v.duration) >= 1200);

      if (!fullBroadcast) {
        setStatus(`❌ 풀 방송 영상을 찾지 못했습니다`);
        setLoading(false);
        return;
      }

      setStatus(`📺 영상 발견: ${fullBroadcast.title} (${fullBroadcast.duration})`);

      // Step 2: 자막 추출 (브라우저에서)
      setStatus(`📝 자막 추출 중... (${fullBroadcast.id})`);
      const transcript = await extractTranscript(fullBroadcast.id);

      if (transcript.length === 0) {
        setStatus('❌ 자막 추출 실패 — 자막이 없습니다');
        setLoading(false);
        return;
      }

      setStatus(`✅ 자막 ${transcript.length}개 세그먼트 추출 완료. 서버로 전송 중...`);

      // Step 3: 서버에 전송 (기사 분할 + Claude 교정)
      const cronSecret = prompt('CRON_SECRET 입력:');
      if (!cronSecret) {
        setStatus('❌ 취소됨');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({
          date,
          youtubeId: fullBroadcast.id,
          videoTitle: fullBroadcast.title,
          durationSeconds: parseDuration(fullBroadcast.duration),
          transcript,
        }),
      });

      const result = await res.json();
      setResults(result);

      if (result.skipped) {
        setStatus('⏭️ 이미 처리된 날짜입니다');
      } else if (result.error) {
        setStatus(`❌ ${result.error}`);
      } else {
        setStatus(`🎉 완료! ${result.articles}개 기사 수집됨`);
      }
    } catch (err) {
      setStatus(`❌ 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">뉴스 수집 관리</h1>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            수집 날짜
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 mb-4"
          />

          <button
            onClick={runIngest}
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '수집 중...' : 'JTBC 뉴스 수집 시작'}
          </button>

          {status && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">
              {status}
            </div>
          )}

          {results && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm">
              <pre className="whitespace-pre-wrap">{JSON.stringify(results, null, 2)}</pre>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 text-center">
          YouTube 자막은 브라우저에서 직접 추출됩니다 (서버 IP 차단 우회)
        </p>
      </div>
    </div>
  );
}

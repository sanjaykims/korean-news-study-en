'use client';

import { useState } from 'react';

interface VideoResult {
  id: string;
  title: string;
  channel: string;
  duration: string;
  durationSeconds: number;
}

// YouTube 자막 추출 (브라우저에서 직접)
async function extractTranscript(videoId: string): Promise<{ text: string; start: number; duration: number }[]> {
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' },
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

  const segments: { text: string; start: number; duration: number }[] = [];

  // Try json3 format first
  try {
    const capRes = await fetch(koTrack.baseUrl + '&fmt=json3');
    const capData = await capRes.json();
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
  } catch { /* fall through to XML */ }

  // Fallback: srv3 XML
  if (segments.length === 0) {
    const xmlRes = await fetch(koTrack.baseUrl + '&fmt=srv3');
    const xml = await xmlRes.text();
    const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const text = m[3]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, ' ').trim();
      if (text) segments.push({ text, start: parseInt(m[1]) / 1000, duration: parseInt(m[2]) / 1000 });
    }
  }

  // Fallback: text format
  if (segments.length === 0) {
    const xmlRes = await fetch(koTrack.baseUrl);
    const xml = await xmlRes.text();
    const textRe = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let m: RegExpExecArray | null;
    while ((m = textRe.exec(xml)) !== null) {
      const text = m[3]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, ' ').trim();
      if (text) segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
    }
  }

  return segments;
}

function parseDuration(d: string): number {
  const parts = d.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AdminPage() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<VideoResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null);
  const [results, setResults] = useState<{ articles: number; error?: string } | null>(null);

  async function searchVideos() {
    setLoading(true);
    setVideos([]);
    setSelectedVideo(null);
    setResults(null);
    setStatus('🔍 JTBC 뉴스 검색 중...');

    try {
      const d = new Date(date + 'T00:00:00');
      const dateKorean = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

      // 여러 쿼리로 검색
      const queries = [
        `JTBC 뉴스룸 풀영상 ${dateKorean}`,
        `JTBC 뉴스 ${dateKorean}`,
        `JTBC 아침& ${dateKorean}`,
      ];

      const allVideos: VideoResult[] = [];
      const seenIds = new Set<string>();

      for (const query of queries) {
        try {
          const res = await fetch('/api/youtube-search?q=' + encodeURIComponent(query));
          const data = await res.json();
          for (const v of data.videos || []) {
            if (!seenIds.has(v.id) && v.channel.includes('JTBC')) {
              seenIds.add(v.id);
              allVideos.push(v);
            }
          }
        } catch { /* continue */ }
      }

      // 길이순 정렬 (긴 것 먼저)
      allVideos.sort((a, b) => b.durationSeconds - a.durationSeconds);

      setVideos(allVideos);

      if (allVideos.length === 0) {
        setStatus('❌ JTBC News 영상을 찾지 못했습니다');
      } else {
        setStatus(`✅ JTBC News 영상 ${allVideos.length}개 발견. 수집할 영상을 선택하세요.`);
      }
    } catch (err) {
      setStatus(`❌ 검색 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function ingestVideo(video: VideoResult) {
    setLoading(true);
    setSelectedVideo(video);
    setResults(null);

    try {
      // Step 1: 자막 추출
      setStatus(`📝 자막 추출 중... (${video.id})`);
      const transcript = await extractTranscript(video.id);

      if (transcript.length === 0) {
        setStatus('❌ 자막이 없습니다');
        setLoading(false);
        return;
      }

      setStatus(`✅ 자막 ${transcript.length}개 세그먼트. 서버로 전송 중...`);

      // Step 2: 서버에 전송
      const cronSecret = prompt('CRON_SECRET 입력:');
      if (!cronSecret) { setStatus('취소됨'); setLoading(false); return; }

      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({
          date,
          youtubeId: video.id,
          videoTitle: video.title,
          durationSeconds: video.durationSeconds,
          transcript,
        }),
      });

      const result = await res.json();
      setResults(result);

      if (result.skipped) {
        setStatus('⏭️ 이미 처리된 영상입니다');
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
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">JTBC 뉴스 수집 관리</h1>

        <div className="bg-white rounded-xl p-6 shadow-sm mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">수집 날짜</label>
          <div className="flex gap-3">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2"
            />
            <button
              onClick={searchVideos}
              disabled={loading}
              className="bg-blue-600 text-white rounded-lg px-6 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading && !selectedVideo ? '검색 중...' : 'JTBC 검색'}
            </button>
          </div>
        </div>

        {/* 검색 결과 — 영상 목록 */}
        {videos.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow-sm mb-4">
            <h2 className="font-semibold mb-3">JTBC News 영상 ({videos.length}개)</h2>
            <div className="space-y-3">
              {videos.map(v => (
                <div
                  key={v.id}
                  className={`border rounded-lg p-3 cursor-pointer transition ${
                    selectedVideo?.id === v.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => !loading && ingestVideo(v)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 mr-3">
                      <div className="text-sm font-medium">{v.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {v.channel} · {formatDuration(v.durationSeconds)}
                      </div>
                    </div>
                    <img
                      src={`https://img.youtube.com/vi/${v.id}/mqdefault.jpg`}
                      alt=""
                      className="w-24 h-14 rounded object-cover flex-shrink-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 상태 */}
        {status && (
          <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
            <div className="text-sm whitespace-pre-wrap">{status}</div>
          </div>
        )}

        {results && (
          <div className="bg-blue-50 rounded-xl p-4 mb-4">
            <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(results, null, 2)}</pre>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center">
          채널명이 &quot;JTBC&quot;인 영상만 표시됩니다. 자막은 브라우저에서 직접 추출합니다.
        </p>
      </div>
    </div>
  );
}

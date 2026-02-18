'use client';

import { useState } from 'react';

export default function AdminPage() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [videoId, setVideoId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [showLocalCmd, setShowLocalCmd] = useState(false);
  const [localVideoId, setLocalVideoId] = useState('');

  function extractVideoId(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    const urlMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (urlMatch) return urlMatch[1];
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
    return trimmed;
  }

  async function handleIngest() {
    setLoading(true);
    setResult(null);
    setShowLocalCmd(false);

    const vid = extractVideoId(videoId);
    const params = new URLSearchParams({ date });
    if (vid) params.set('videoId', vid);

    setStatus(vid
      ? `영상 ${vid} 수집 중...`
      : 'JTBC 뉴스룸 자동 검색 + 수집 중...'
    );

    try {
      const res = await fetch(`/api/auto-ingest?${params.toString()}`);
      const data = await res.json();
      setResult(data);

      if (data.skipped) {
        setStatus(`이미 수집된 영상입니다 (${data.videoId})`);
      } else if (data.articles > 0) {
        setStatus(`완료! ${data.articles}개 기사 수집 / ${data.videoTitle || ''}`);
      } else if (data.error) {
        // Check if it's a geo-restriction / transcript failure
        const isGeoBlock = data.error?.includes('transcript') ||
          data.error?.includes('LOGIN_REQUIRED') ||
          data.error?.includes('UNPLAYABLE') ||
          data.error?.includes('자막') ||
          data.errors?.length > 0;

        if (isGeoBlock) {
          setStatus('서버에서 자막 추출 실패 (지역 제한). 아래 로컬 명령어를 사용해 주세요.');
          setShowLocalCmd(true);
          setLocalVideoId(data.videoId || vid || '');
        } else {
          setStatus(`오류: ${data.error}`);
        }
      }
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  const localCommand = localVideoId
    ? `node scripts/ingest.js ${date} ${localVideoId}`
    : `node scripts/ingest.js ${date}`;

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">JTBC 뉴스룸 수집</h1>

        <div className="bg-white rounded-xl p-6 shadow-sm mb-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">방송 날짜</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              YouTube 영상 ID 또는 URL <span className="text-gray-400">(선택)</span>
            </label>
            <input
              type="text"
              value={videoId}
              onChange={e => setVideoId(e.target.value)}
              placeholder="예: ZToYdGoUQGQ 또는 youtube.com/watch?v=..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              비워두면 자동 검색합니다.
            </p>
          </div>

          <button
            onClick={handleIngest}
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg px-6 py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '수집 중...' : '수집 시작'}
          </button>
        </div>

        {status && (
          <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
            <div className="text-sm whitespace-pre-wrap">{status}</div>
          </div>
        )}

        {showLocalCmd && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm mb-4">
            <p className="text-sm font-medium text-amber-800 mb-2">
              JTBC 영상은 한국 IP에서만 자막 추출이 가능합니다.
            </p>
            <p className="text-xs text-amber-700 mb-3">
              프로젝트 폴더에서 아래 명령어를 실행해 주세요:
            </p>
            <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs relative">
              <code>{localCommand}</code>
              <button
                onClick={() => navigator.clipboard.writeText(localCommand)}
                className="absolute top-2 right-2 text-gray-400 hover:text-white text-xs"
              >
                복사
              </button>
            </div>
            <p className="text-xs text-amber-600 mt-2">
              Node.js가 설치된 한국 IP 컴퓨터에서 실행하세요.
            </p>
          </div>
        )}

        {result && (
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <pre className="text-xs whitespace-pre-wrap text-gray-600">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">로컬 수집 (한국 IP 필요)</p>
          <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs space-y-1">
            <div># 오늘 뉴스 자동 검색 + 수집</div>
            <div>node scripts/ingest.js</div>
            <div className="mt-2"># 특정 날짜</div>
            <div>node scripts/ingest.js {date}</div>
            <div className="mt-2"># 특정 영상 ID</div>
            <div>node scripts/ingest.js {date} VIDEO_ID</div>
          </div>
        </div>
      </div>
    </div>
  );
}

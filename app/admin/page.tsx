'use client';

import { useState } from 'react';

interface FailedResult {
  videoId: string;
  videoTitle: string;
  durationSeconds: number;
  chapters: { title: string; startSeconds: number }[];
  errors: string[];
}

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

  // 수동 자막 입력 관련
  const [failedResult, setFailedResult] = useState<FailedResult | null>(null);
  const [manualTranscript, setManualTranscript] = useState('');
  const [submittingManual, setSubmittingManual] = useState(false);

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
    setFailedResult(null);
    setManualTranscript('');

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
          setStatus('서버에서 자막 추출 실패 (지역 제한)');
          setShowLocalCmd(true);
          setLocalVideoId(data.videoId || vid || '');

          // 메타데이터가 있으면 수동 입력 모드 활성화
          if (data.videoId && data.chapters?.length) {
            setFailedResult({
              videoId: data.videoId,
              videoTitle: data.videoTitle || '',
              durationSeconds: data.durationSeconds || 0,
              chapters: data.chapters,
              errors: data.errors || [],
            });
          }
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

  async function handleManualSubmit() {
    if (!failedResult || !manualTranscript.trim()) return;

    setSubmittingManual(true);
    setStatus('수동 자막 데이터로 수집 중...');

    try {
      // JSON 배열 형태로 파싱
      let transcript: { text: string; start: number; duration: number }[];
      const trimmed = manualTranscript.trim();

      if (trimmed.startsWith('[')) {
        // JSON 배열 형태
        transcript = JSON.parse(trimmed);
      } else {
        // 줄바꿈으로 구분된 일반 텍스트 → 단일 세그먼트로 변환
        const lines = trimmed.split('\n').filter(l => l.trim());
        // 타임스탬프가 있는 형식: [123] 텍스트 또는 00:02:03 텍스트
        const hasTimestamps = lines.some(l => /^\[?\d+[\]:]/.test(l.trim()));

        if (hasTimestamps) {
          transcript = [];
          for (const line of lines) {
            // [초] 텍스트 형식
            const secMatch = line.match(/^\[(\d+)\]\s*(.+)/);
            if (secMatch) {
              transcript.push({ text: secMatch[2].trim(), start: parseInt(secMatch[1]), duration: 5 });
              continue;
            }
            // HH:MM:SS 또는 MM:SS 형식
            const tsMatch = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)/);
            if (tsMatch) {
              const secs = tsMatch[3]
                ? parseInt(tsMatch[1]) * 3600 + parseInt(tsMatch[2]) * 60 + parseInt(tsMatch[3])
                : parseInt(tsMatch[1]) * 60 + parseInt(tsMatch[2]);
              transcript.push({ text: tsMatch[4].trim(), start: secs, duration: 5 });
              continue;
            }
            // 타임스탬프 없는 줄은 스킵하지 않고 이전 항목에 추가
            if (transcript.length > 0) {
              transcript[transcript.length - 1].text += ' ' + line.trim();
            }
          }
        } else {
          // 타임스탬프 없는 일반 텍스트 → 균등 분할
          const totalDuration = failedResult.durationSeconds || 3600;
          const segDuration = totalDuration / lines.length;
          transcript = lines.map((text, i) => ({
            text: text.trim(),
            start: i * segDuration,
            duration: segDuration,
          }));
        }
      }

      if (!transcript.length) {
        setStatus('오류: 자막 데이터를 파싱할 수 없습니다');
        return;
      }

      // /api/ingest로 직접 전송
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          youtubeId: failedResult.videoId,
          videoTitle: failedResult.videoTitle,
          durationSeconds: failedResult.durationSeconds,
          chapters: failedResult.chapters,
          transcript,
        }),
      });

      const data = await res.json();
      setResult(data);

      if (data.articles > 0) {
        setStatus(`완료! ${data.articles}개 기사 수집 (수동 자막)`);
        setFailedResult(null);
        setManualTranscript('');
        setShowLocalCmd(false);
      } else {
        setStatus(`수동 수집 실패: ${data.error || '알 수 없는 오류'}`);
      }
    } catch (err) {
      setStatus(`자막 파싱 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingManual(false);
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

        {/* 자막 추출 실패 시 — 수동 입력 + 로컬 명령어 */}
        {showLocalCmd && (
          <div className="space-y-4 mb-4">
            {/* 수동 자막 입력 */}
            {failedResult && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
                <p className="text-sm font-medium text-blue-800 mb-1">
                  방법 1: 자막 데이터 직접 입력
                </p>
                <p className="text-xs text-blue-600 mb-1">
                  영상: {failedResult.videoTitle || failedResult.videoId} / 챕터 {failedResult.chapters.length}개 감지됨
                </p>
                <p className="text-xs text-blue-500 mb-3">
                  YouTube에서 자막을 복사하여 아래에 붙여넣으세요.
                  JSON 배열, 타임스탬프 텍스트([초] 내용), 또는 일반 텍스트 모두 가능합니다.
                </p>
                <textarea
                  value={manualTranscript}
                  onChange={e => setManualTranscript(e.target.value)}
                  placeholder={'[0] 안녕하세요 JTBC 뉴스룸입니다\n[15] 오늘의 첫 번째 뉴스입니다\n...\n\n또는 JSON:\n[{"text":"안녕하세요","start":0,"duration":5}, ...]'}
                  rows={8}
                  className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs font-mono bg-white resize-y"
                />
                <button
                  onClick={handleManualSubmit}
                  disabled={submittingManual || !manualTranscript.trim()}
                  className="mt-2 w-full bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {submittingManual ? '수집 중...' : '자막 데이터로 수집'}
                </button>
              </div>
            )}

            {/* 로컬 명령어 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-medium text-amber-800 mb-2">
                방법 2: 로컬 스크립트 실행 (한국 IP 필요)
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

            {/* 상세 오류 정보 */}
            {failedResult?.errors && failedResult.errors.length > 0 && (
              <details className="bg-gray-50 rounded-xl p-4 shadow-sm">
                <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                  자막 추출 시도 상세 ({failedResult.errors.length}개 방식 실패)
                </summary>
                <ul className="mt-2 space-y-1">
                  {failedResult.errors.map((err, i) => (
                    <li key={i} className="text-xs text-gray-500 font-mono break-all">
                      {err}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {result && !failedResult && (
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

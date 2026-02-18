'use client';

import { useYouTubePlayer } from '@/lib/youtube';
import type { NewsArticle } from '@/lib/types';
import { formatTime } from '@/lib/types';

interface Props {
  article: NewsArticle;
  onNext: () => void;
}

export default function VideoStep({ article, onNext }: Props) {
  const containerId = 'yt-player';
  const { isReady, isPlaying, isEnded, play, pause, replay } = useYouTubePlayer({
    containerId,
    videoId: article.videoId,
    startTime: article.startTime,
    endTime: article.endTime,
  });

  // 스크립트 문장 분리 (교정본 또는 원본)
  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);


  return (
    <div>
      {/* YouTube 플레이어 */}
      <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4">
        <div id={containerId} className="w-full h-full" />
      </div>

      {/* 컨트롤 */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-xs text-gray-500">
          {formatTime(article.startTime)} — {formatTime(article.endTime)}
        </div>
        <div className="flex gap-2">
          {isEnded ? (
            <button
              onClick={replay}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              다시 보기
            </button>
          ) : (
            <button
              onClick={() => isPlaying ? pause() : play()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              disabled={!isReady}
            >
              {isPlaying ? '일시정지' : '재생'}
            </button>
          )}
        </div>
      </div>

      {/* 스크립트 미리보기 */}
      {sentences.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">스크립트</h3>
          <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
            {sentences.map((sentence, i) => (
              <p key={i}>{sentence}</p>
            ))}
          </div>
        </div>
      )}

      {/* 다음 단계 버튼 */}
      <button
        onClick={onNext}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        스크립트 학습으로 →
      </button>
    </div>
  );
}

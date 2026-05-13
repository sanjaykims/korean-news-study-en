'use client';

import { useState, useRef, useCallback } from 'react';
import { useYouTubePlayer } from '@/lib/youtube';
import type { NewsArticle } from '@/lib/types';
import { formatTime } from '@/lib/types';
import { logEvent } from '@/lib/events';

interface Props {
  article: NewsArticle;
  articleId: string;
  onNext: () => void;
}

export default function VideoStep({ article, articleId, onNext }: Props) {
  const containerId = 'yt-player';
  const { isReady, isPlaying, isEnded, play, pause, replay } = useYouTubePlayer({
    containerId,
    videoId: article.videoId,
    startTime: article.startTime,
    endTime: article.endTime,
  });

  const [replayCount, setReplayCount] = useState(0);
  const playStartRef = useRef<number>(0);
  const totalWatchedRef = useRef<number>(0);

  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);

  const handlePlay = useCallback(() => {
    playStartRef.current = Date.now();
    logEvent('video_play', { currentTime: article.startTime }, articleId);
    play();
  }, [play, article.startTime, articleId]);

  const handlePause = useCallback(() => {
    const watchedMs = Date.now() - playStartRef.current;
    totalWatchedRef.current += watchedMs;
    logEvent('video_pause', { currentTime: 0, watchedMs }, articleId);
    pause();
  }, [pause, articleId]);

  const handleReplay = useCallback(() => {
    const newCount = replayCount + 1;
    setReplayCount(newCount);
    logEvent('video_replay', { replayCount: newCount }, articleId);
    replay();
  }, [replay, replayCount, articleId]);


  return (
    <div>
      <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4">
        <div id={containerId} className="w-full h-full" />
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="text-xs text-gray-500">
          {formatTime(article.startTime)} — {formatTime(article.endTime)}
        </div>
        <div className="flex gap-2">
          {isEnded ? (
            <button
              onClick={handleReplay}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              Replay
            </button>
          ) : (
            <button
              onClick={() => isPlaying ? handlePause() : handlePlay()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              disabled={!isReady}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          )}
        </div>
      </div>

      {sentences.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Script</h3>
          <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
            {sentences.map((sentence, i) => (
              <p key={i}>{sentence}</p>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Go to Script Study &rarr;
      </button>
    </div>
  );
}

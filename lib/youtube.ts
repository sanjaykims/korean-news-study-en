'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface UseYouTubePlayerOptions {
  containerId: string;
  videoId: string;
  startTime: number;
  endTime: number;
  hidden?: boolean;
  onReady?: () => void;
  onEnd?: () => void;
}

interface UseYouTubePlayerReturn {
  play: (seekTo?: number) => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  isReady: boolean;
  isPlaying: boolean;
  isEnded: boolean;
  replay: () => void;
}

// YouTube IFrame API 스크립트 로드 (한 번만)
let ytApiLoading = false;
let ytApiLoaded = false;
const ytApiCallbacks: (() => void)[] = [];

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiLoaded && window.YT?.Player) {
      resolve();
      return;
    }
    ytApiCallbacks.push(resolve);
    if (ytApiLoading) return;
    ytApiLoading = true;

    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      prevCallback?.();
      ytApiCallbacks.forEach((cb) => cb());
      ytApiCallbacks.length = 0;
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
}

export function useYouTubePlayer(options: UseYouTubePlayerOptions): UseYouTubePlayerReturn {
  const { containerId, videoId, startTime, endTime, hidden, onReady, onEnd } = options;
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // 자동 정지 체크
  const startAutoStop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!playerRef.current || !mountedRef.current) return;
      try {
        const currentTime = playerRef.current.getCurrentTime();
        if (currentTime >= endTime) {
          playerRef.current.pauseVideo();
          if (mountedRef.current) {
            setIsPlaying(false);
            setIsEnded(true);
            onEnd?.();
          }
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        // player might be destroyed
      }
    }, 300);
  }, [endTime, onEnd]);

  useEffect(() => {
    mountedRef.current = true;
    let player: any = null;

    const init = async () => {
      await loadYouTubeApi();
      if (!mountedRef.current) return;

      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = '';

      player = new window.YT.Player(containerId, {
        height: hidden ? '0' : '100%',
        width: hidden ? '0' : '100%',
        videoId,
        playerVars: {
          start: Math.floor(startTime),
          end: Math.ceil(endTime),
          modestbranding: 1,
          rel: 0,
          ...(hidden ? { controls: 0, disablekb: 1 } : {}),
        },
        events: {
          onReady: () => {
            if (!mountedRef.current) return;
            playerRef.current = player;
            setIsReady(true);
            onReady?.();
          },
          onStateChange: (event: any) => {
            if (!mountedRef.current) return;
            if (event.data === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setIsEnded(false);
              startAutoStop();
            } else if (
              event.data === window.YT.PlayerState.PAUSED ||
              event.data === window.YT.PlayerState.ENDED
            ) {
              setIsPlaying(false);
              if (intervalRef.current) clearInterval(intervalRef.current);
            }
          },
        },
      });
    };

    init();

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      try { player?.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [containerId, videoId, startTime]);

  const play = useCallback((seekToTime?: number) => {
    if (!playerRef.current) return;
    if (seekToTime !== undefined) {
      playerRef.current.seekTo(seekToTime, true);
    }
    playerRef.current.playVideo();
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
  }, []);

  const getCurrentTime = useCallback((): number => {
    try { return playerRef.current?.getCurrentTime() ?? 0; } catch { return 0; }
  }, []);

  const replay = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(startTime, true);
    playerRef.current.playVideo();
    setIsEnded(false);
  }, [startTime]);

  return { play, pause, seekTo, getCurrentTime, isReady, isPlaying, isEnded, replay };
}

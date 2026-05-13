'use client';

import { useState, useRef, useCallback } from 'react';
import type { NewsArticle, ShadowingResult } from '@/lib/types';
import { logEvent } from '@/lib/events';

interface Props {
  article: NewsArticle;
  articleId: string;
  onComplete: (results: ShadowingResult[]) => void;
}

export default function ShadowingStep({ article, articleId, onComplete }: Props) {
  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [results, setResults] = useState<ShadowingResult[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [showTip, setShowTip] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rerecordCountRef = useRef(0);
  const recordingStartRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setAudioUrl(null);
      recordingStartRef.current = Date.now();
    } catch {
      alert('Microphone access is required.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      const recordingDurationMs = Date.now() - recordingStartRef.current;
      logEvent('shadowing_record', {
        sentenceIndex: currentIndex,
        sentence: sentences[currentIndex],
        recordingDurationMs,
        rerecordCount: rerecordCountRef.current,
      }, articleId);
    }
  }, [isRecording, currentIndex, sentences, articleId]);

  const handleScore = (score: number) => {
    const result: ShadowingResult = {
      sentenceIndex: currentIndex,
      sentence: sentences[currentIndex],
      score,
    };

    logEvent('shadowing_score', {
      sentenceIndex: currentIndex,
      sentence: sentences[currentIndex],
      score,
    }, articleId);

    const newResults = [...results, result];
    setResults(newResults);

    if (currentIndex + 1 < sentences.length) {
      setCurrentIndex(prev => prev + 1);
      setAudioUrl(null);
      rerecordCountRef.current = 0;
    } else {
      setIsDone(true);
      onComplete(newResults);

      const avgScore = Math.round(newResults.reduce((sum, r) => sum + r.score, 0) / newResults.length);
      const lowScoreCount = newResults.filter(r => r.score <= 2).length;
      logEvent('shadowing_complete', {
        avgScore,
        totalSentences: newResults.length,
        lowScoreCount,
        sentenceScores: newResults.map(r => ({ index: r.sentenceIndex, score: r.score })),
      }, articleId);
    }
  };

  const finishEarly = useCallback(() => {
    if (results.length === 0) {
      setIsDone(true);
      onComplete([]);
      return;
    }
    setIsDone(true);
    onComplete(results);

    const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);
    const lowScoreCount = results.filter(r => r.score <= 2).length;
    logEvent('shadowing_complete', {
      avgScore,
      totalSentences: results.length,
      skippedSentences: sentences.length - results.length,
      lowScoreCount,
      endedEarly: true,
      sentenceScores: results.map(r => ({ index: r.sentenceIndex, score: r.score })),
    }, articleId);
  }, [results, sentences.length, articleId, onComplete]);

  if (sentences.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>No script content available</p>
      </div>
    );
  }

  if (isDone) {
    const completedCount = results.length;
    const avgScore = completedCount > 0
      ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / completedCount)
      : 0;
    const lowScores = results.filter(r => r.score <= 2);

    return (
      <div className="py-6">
        <div className="text-center mb-8">
          <div className="text-5xl font-bold text-gray-900 mb-2">
            {completedCount === 0 ? '—' : avgScore >= 4 ? 'A' : avgScore >= 3 ? 'B' : avgScore >= 2 ? 'C' : 'D'}
          </div>
          <p className="text-gray-500">{completedCount > 0 ? `Average ${avgScore}/5` : 'No practice'}</p>
          <p className="text-sm text-gray-400 mt-1">Completed {completedCount}/{sentences.length} sentences</p>
        </div>

        <div className="space-y-2 mb-6">
          {results.map((r, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                r.score >= 4 ? 'bg-green-50' : r.score >= 3 ? 'bg-yellow-50' : 'bg-red-50'
              }`}
            >
              <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                r.score >= 4 ? 'bg-green-200 text-green-800' :
                r.score >= 3 ? 'bg-yellow-200 text-yellow-800' :
                'bg-red-200 text-red-800'
              }`}>
                {r.score}
              </span>
              <p className="text-gray-700 leading-relaxed">{r.sentence}</p>
            </div>
          ))}
        </div>

        {lowScores.length > 0 && (
          <div className="bg-orange-50 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-orange-700 mb-1">
              Saved to sentence bank ({lowScores.length})
            </h3>
            <p className="text-xs text-orange-600">
              Low-scoring sentences added to review list
            </p>
          </div>
        )}

        <div className="text-center">
          <p className="text-sm text-gray-500">Today&apos;s study is complete!</p>
        </div>
      </div>
    );
  }

  const sentence = sentences[currentIndex];

  return (
    <div>
      {showTip && currentIndex === 0 && (
        <div className="bg-blue-50 rounded-lg p-3 mb-4 flex items-start gap-2">
          <span className="text-blue-500 shrink-0 mt-0.5">i</span>
          <div className="text-xs text-blue-700">
            <p className="font-medium mb-1">How to Shadow</p>
            <p>Read the sentence &rarr; Tap record &rarr; Rate your pronunciation</p>
          </div>
          <button onClick={() => setShowTip(false)} className="text-blue-400 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / sentences.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 shrink-0">{currentIndex + 1}/{sentences.length}</span>
        <button
          onClick={finishEarly}
          className="shrink-0 text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          End Practice
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <p className="text-lg text-gray-900 leading-relaxed text-center">
          {sentence}
        </p>
      </div>

      <div className="flex justify-center mb-6">
        {!isRecording && !audioUrl && (
          <button
            onClick={startRecording}
            className="w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors shadow-lg"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          </button>
        )}

        {isRecording && (
          <button
            onClick={stopRecording}
            className="w-16 h-16 bg-gray-800 hover:bg-gray-900 text-white rounded-full flex items-center justify-center transition-colors shadow-lg animate-pulse"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}
      </div>

      {isRecording && (
        <p className="text-center text-sm text-red-500 mb-4">Recording... Tap stop when done</p>
      )}

      {audioUrl && (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">My Recording</p>
            <audio controls src={audioUrl} className="w-full" />
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-3 text-center">Rate your pronunciation</p>
            <div className="flex gap-2 justify-center">
              {[1, 2, 3, 4, 5].map(score => (
                <button
                  key={score}
                  onClick={() => handleScore(score)}
                  className={`w-12 h-12 rounded-lg border-2 font-bold text-sm transition-all ${
                    score >= 4
                      ? 'border-green-300 text-green-700 hover:bg-green-50'
                      : score >= 3
                      ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50'
                      : 'border-red-300 text-red-700 hover:bg-red-50'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
              <span>Poor</span>
              <span>Perfect</span>
            </div>
          </div>

          <button
            onClick={() => { setAudioUrl(null); rerecordCountRef.current += 1; }}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Re-record
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useCallback } from 'react';
import type { NewsArticle, ShadowingResult } from '@/lib/types';

interface Props {
  article: NewsArticle;
  onComplete: (results: ShadowingResult[]) => void;
}

export default function ShadowingStep({ article, onComplete }: Props) {
  // 스크립트를 문장 단위로 분리
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
    } catch {
      alert('需要麦克风访问权限。');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const handleScore = (score: number) => {
    const result: ShadowingResult = {
      sentenceIndex: currentIndex,
      sentence: sentences[currentIndex],
      score,
    };

    const newResults = [...results, result];
    setResults(newResults);

    if (currentIndex + 1 < sentences.length) {
      setCurrentIndex(prev => prev + 1);
      setAudioUrl(null);
    } else {
      setIsDone(true);
      onComplete(newResults);
    }
  };

  if (sentences.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>暂无脚本内容</p>
      </div>
    );
  }

  if (isDone) {
    const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);
    const lowScores = results.filter(r => r.score <= 2);

    return (
      <div className="py-6">
        {/* 종합 결과 */}
        <div className="text-center mb-8">
          <div className="text-5xl font-bold text-gray-900 mb-2">
            {avgScore >= 4 ? 'A' : avgScore >= 3 ? 'B' : avgScore >= 2 ? 'C' : 'D'}
          </div>
          <p className="text-gray-500">平均 {avgScore}/5分</p>
          <p className="text-sm text-gray-400 mt-1">完成 {sentences.length} 个句子</p>
        </div>

        {/* 문장별 결과 */}
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

        {/* 낮은 점수 문장 → 문장 은행 */}
        {lowScores.length > 0 && (
          <div className="bg-orange-50 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-orange-700 mb-1">
              已保存到句子库（{lowScores.length}个）
            </h3>
            <p className="text-xs text-orange-600">
              低分句子已添加到复习列表
            </p>
          </div>
        )}

        <div className="text-center">
          <p className="text-sm text-gray-500">今天的学习已完成！</p>
        </div>
      </div>
    );
  }

  const sentence = sentences[currentIndex];

  return (
    <div>
      {/* 팁 (첫 번째만) */}
      {showTip && currentIndex === 0 && (
        <div className="bg-blue-50 rounded-lg p-3 mb-4 flex items-start gap-2">
          <span className="text-blue-500 shrink-0 mt-0.5">i</span>
          <div className="text-xs text-blue-700">
            <p className="font-medium mb-1">跟读方法</p>
            <p>阅读句子 → 点击录音按钮跟读 → 自我评价发音</p>
          </div>
          <button onClick={() => setShowTip(false)} className="text-blue-400 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* 진행 바 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / sentences.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{currentIndex + 1}/{sentences.length}</span>
      </div>

      {/* 현재 문장 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <p className="text-lg text-gray-900 leading-relaxed text-center">
          {sentence}
        </p>
      </div>

      {/* 녹음 컨트롤 */}
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

      {/* 녹음 상태 */}
      {isRecording && (
        <p className="text-center text-sm text-red-500 mb-4">录音中...完成后请点击停止按钮</p>
      )}

      {/* 재생 + 자가 평가 */}
      {audioUrl && (
        <div className="space-y-4">
          {/* 내 녹음 재생 */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">我的录音</p>
            <audio controls src={audioUrl} className="w-full" />
          </div>

          {/* 자가 평가 */}
          <div>
            <p className="text-sm text-gray-600 mb-3 text-center">请给自己的发音打分</p>
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
              <span>差</span>
              <span>完美</span>
            </div>
          </div>

          {/* 다시 녹음 */}
          <button
            onClick={() => { setAudioUrl(null); }}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            重新录音
          </button>
        </div>
      )}
    </div>
  );
}

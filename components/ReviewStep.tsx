'use client';

import { useState, useEffect } from 'react';

interface ReviewWord {
  id: string;
  word: string;
  hanja?: string;
  chinese?: string;
  meaning?: string;
  mastery_level: number;
  review_count: number;
}

interface Props {
  onDone: () => void;
}

export default function ReviewStep({ onDone }: Props) {
  const [words, setWords] = useState<ReviewWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [results, setResults] = useState<{ word: string; remembered: boolean }[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch('/api/review')
      .then(res => res.json())
      .then(data => {
        setWords(data.words || []);
        if (!data.words || data.words.length === 0) {
          setDone(true);
        }
      })
      .catch(() => setDone(true))
      .finally(() => setLoading(false));
  }, []);

  const handleResult = (remembered: boolean) => {
    const word = words[currentIndex];
    setResults(prev => [...prev, { word: word.word, remembered }]);

    if (currentIndex + 1 < words.length) {
      setCurrentIndex(prev => prev + 1);
      setShowAnswer(false);
    } else {
      setDone(true);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (done && words.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-gray-500 mb-2">暂无已保存的单词</p>
        <p className="text-sm text-gray-400 mb-6">请在新闻中选择单词进行学习</p>
        <button
          onClick={onDone}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          进入今日新闻 →
        </button>
      </div>
    );
  }

  if (done) {
    const remembered = results.filter(r => r.remembered).length;
    return (
      <div className="text-center py-10">
        <div className="text-4xl font-bold text-gray-900 mb-2">
          {remembered}/{results.length}
        </div>
        <p className="text-gray-500 mb-6">记住的单词</p>

        <div className="space-y-2 mb-6 text-left max-w-xs mx-auto">
          {results.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm p-2 rounded ${r.remembered ? 'bg-green-50' : 'bg-red-50'}`}>
              <span className={r.remembered ? 'text-green-600' : 'text-red-600'}>
                {r.remembered ? '○' : '×'}
              </span>
              <span className="text-gray-700">{r.word}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onDone}
          className="w-full max-w-xs py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          进入今日新闻 →
        </button>
      </div>
    );
  }

  // 현재 단어
  const word = words[currentIndex];

  return (
    <div className="max-w-sm mx-auto">
      <h2 className="text-lg font-bold text-gray-900 mb-1 text-center">复习</h2>
      <p className="text-xs text-gray-500 mb-6 text-center">回忆之前学过的单词</p>

      {/* 진행 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{currentIndex + 1}/{words.length}</span>
      </div>

      {/* 힌트 (중국어) */}
      <div className="bg-white rounded-lg border border-gray-200 p-8 mb-6 text-center">
        <p className="text-sm text-gray-500 mb-2">对应的韩语单词是？</p>
        <p className="text-3xl font-bold text-gray-900">
          {word.chinese || word.meaning || '—'}
        </p>
        {word.hanja && (
          <p className="text-sm text-red-500 mt-2">{word.hanja}</p>
        )}
      </div>

      {/* 답 보기 / 결과 */}
      {!showAnswer ? (
        <button
          onClick={() => setShowAnswer(true)}
          className="w-full py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
        >
          查看答案
        </button>
      ) : (
        <div>
          <div className="bg-blue-50 rounded-lg p-4 mb-4 text-center">
            <p className="text-2xl font-bold text-blue-800">{word.word}</p>
            {word.meaning && <p className="text-sm text-gray-600 mt-1">{word.meaning}</p>}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleResult(false)}
              className="flex-1 py-3 bg-red-50 text-red-700 rounded-lg font-medium hover:bg-red-100 border border-red-200"
            >
              不记得
            </button>
            <button
              onClick={() => handleResult(true)}
              className="flex-1 py-3 bg-green-50 text-green-700 rounded-lg font-medium hover:bg-green-100 border border-green-200"
            >
              记住了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

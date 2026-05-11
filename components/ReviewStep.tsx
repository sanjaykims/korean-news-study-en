'use client';

import { useState, useEffect, useCallback } from 'react';

interface ReviewWord {
  id: string;
  word: string;
  hanja?: string;
  chinese?: string;
  meaning?: string;
  mastery_level: number;
  review_count: number;
  word_origin?: string;
}

interface Props {
  onDone: () => void;
}

const MASTERY_LABELS = ['新词', '初识', '熟悉', '掌握', '巩固', '精通'];
const MASTERY_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
const SRS_INTERVALS = ['立即', '1天', '3天', '7天', '14天', '30天'];

export default function ReviewStep({ onDone }: Props) {
  const [words, setWords] = useState<ReviewWord[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [results, setResults] = useState<{ wordId: string; word: string; remembered: boolean; oldMastery: number }[]>([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/review')
      .then(res => res.json())
      .then(data => {
        setWords(data.words || []);
        setDueCount(data.dueCount || 0);
        if (!data.words || data.words.length === 0) setDone(true);
      })
      .catch(() => setDone(true))
      .finally(() => setLoading(false));
  }, []);

  const submitResults = useCallback(async (finalResults: typeof results) => {
    if (finalResults.length === 0) return;
    setSubmitting(true);
    try {
      await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: finalResults.map(r => ({
            wordId: r.wordId,
            remembered: r.remembered,
          })),
        }),
      });
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleResult = (remembered: boolean) => {
    const word = words[currentIndex];
    const newResult = {
      wordId: word.id,
      word: word.word,
      remembered,
      oldMastery: word.mastery_level || 0,
    };
    const newResults = [...results, newResult];
    setResults(newResults);

    if (currentIndex + 1 < words.length) {
      setCurrentIndex(prev => prev + 1);
      setShowAnswer(false);
    } else {
      setDone(true);
      submitResults(newResults);
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
        <div className="text-4xl mb-3">🎉</div>
        <p className="text-gray-700 font-semibold mb-1">没有待复习的单词！</p>
        <p className="text-sm text-gray-400 mb-6">请在新闻中选择单词，或者等待SRS安排下次复习</p>
        <button onClick={onDone} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm">
          进入今日新闻 →
        </button>
      </div>
    );
  }

  if (done) {
    const remembered = results.filter(r => r.remembered).length;
    const remaining = dueCount - words.length;
    return (
      <div className="text-center py-8">
        <div className="text-5xl font-bold text-gray-900 mb-1">
          {remembered}<span className="text-xl text-gray-400 font-normal">/{results.length}</span>
        </div>
        <p className="text-gray-500 mb-1">本轮记住的单词</p>
        {remaining > 0 && (
          <p className="text-xs text-amber-600 mb-4">还有 {remaining} 个单词待复习</p>
        )}
        {submitting && <p className="text-xs text-gray-400 mb-4">正在保存结果…</p>}

        <div className="space-y-1.5 mb-6 text-left max-w-sm mx-auto">
          {results.map((r, i) => {
            const newMastery = r.remembered
              ? Math.min(5, r.oldMastery + 1)
              : Math.max(0, r.oldMastery - 1);
            return (
              <div key={i} className={`flex items-center gap-2 text-sm p-2.5 rounded-lg ${r.remembered ? 'bg-green-50' : 'bg-red-50'}`}>
                <span className={`text-base ${r.remembered ? 'text-green-600' : 'text-red-500'}`}>
                  {r.remembered ? '○' : '×'}
                </span>
                <span className="text-gray-800 flex-1 font-medium">{r.word}</span>
                <span className="text-[10px] text-gray-400">
                  {MASTERY_LABELS[r.oldMastery]} → {MASTERY_LABELS[newMastery]}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{
                    backgroundColor: `${MASTERY_COLORS[newMastery]}20`,
                    color: MASTERY_COLORS[newMastery],
                  }}
                >
                  {SRS_INTERVALS[newMastery]}后
                </span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onDone}
          className="w-full max-w-sm py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          进入今日新闻 →
        </button>
      </div>
    );
  }

  const word = words[currentIndex];
  const currentMastery = word.mastery_level || 0;

  return (
    <div className="max-w-sm mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900">SRS 复习</h2>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
          待复习 {dueCount}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-5">间隔重复 · 根据记忆强度安排复习</p>

      {/* Progress */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 font-mono">{currentIndex + 1}/{words.length}</span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-8 mb-4 text-center shadow-sm">
        <p className="text-sm text-gray-400 mb-1">对应的韩语单词是？</p>
        <p className="text-3xl font-bold text-gray-900 mb-2">
          {word.chinese || word.meaning || '—'}
        </p>
        {word.hanja && (
          <p className="text-sm text-red-400">{word.hanja}</p>
        )}
        {/* Mastery badge */}
        <div className="mt-4 flex items-center justify-center gap-2">
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{
              backgroundColor: `${MASTERY_COLORS[currentMastery]}15`,
              color: MASTERY_COLORS[currentMastery],
            }}
          >
            {MASTERY_LABELS[currentMastery]}
          </span>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-400">已复习 {word.review_count} 次</span>
          {word.word_origin && (
            <>
              <span className="text-[10px] text-gray-400">·</span>
              <span className="text-[10px] text-gray-400">{word.word_origin}</span>
            </>
          )}
        </div>
      </div>

      {!showAnswer ? (
        <button
          onClick={() => setShowAnswer(true)}
          className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
        >
          查看答案
        </button>
      ) : (
        <div>
          <div className="bg-blue-50 rounded-xl p-5 mb-4 text-center border border-blue-100">
            <p className="text-2xl font-bold text-blue-800">{word.word}</p>
            {word.meaning && <p className="text-sm text-gray-600 mt-1">{word.meaning}</p>}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleResult(false)}
              className="flex-1 py-3 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 border border-red-200 transition-colors"
            >
              <span className="block text-base">不记得</span>
              <span className="block text-[10px] text-red-400 mt-0.5">
                → {MASTERY_LABELS[Math.max(0, currentMastery - 1)]} ({SRS_INTERVALS[Math.max(0, currentMastery - 1)]}后)
              </span>
            </button>
            <button
              onClick={() => handleResult(true)}
              className="flex-1 py-3 bg-green-50 text-green-700 rounded-xl font-medium hover:bg-green-100 border border-green-200 transition-colors"
            >
              <span className="block text-base">记住了</span>
              <span className="block text-[10px] text-green-500 mt-0.5">
                → {MASTERY_LABELS[Math.min(5, currentMastery + 1)]} ({SRS_INTERVALS[Math.min(5, currentMastery + 1)]}后)
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

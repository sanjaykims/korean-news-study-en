'use client';

import { useState, useEffect } from 'react';
import type { NewsArticle, SelectedItem, GrammarPattern } from '@/lib/types';

interface Props {
  article: NewsArticle;
  selectedWords: SelectedItem[];
  onSelectWord: (item: SelectedItem) => void;
  onNext: () => void;
}

export default function ScriptStep({ article, selectedWords, onSelectWord, onNext }: Props) {
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [popup, setPopup] = useState<{
    text: string;
    hanja?: string;
    chinese?: string;
    meaning?: string;
    isFalseFriend?: boolean;
    falseFriendNote?: string;
    type: 'word' | 'phrase' | 'sentence';
    x: number;
    y: number;
  } | null>(null);

  // 문법 패턴
  const [grammarPatterns, setGrammarPatterns] = useState<(GrammarPattern & { sentenceIndex: number })[]>([]);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [expandedGrammar, setExpandedGrammar] = useState<number | null>(null);

  // 교정된 스크립트 또는 원본
  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);

  // 문법 패턴 자동 분석
  useEffect(() => {
    if (!script || grammarPatterns.length > 0) return;
    setGrammarLoading(true);
    fetch('/api/grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })
      .then(res => res.json())
      .then(data => setGrammarPatterns(data.patterns || []))
      .catch(() => {})
      .finally(() => setGrammarLoading(false));
  }, [script, grammarPatterns.length]);

  // 문장별 문법 패턴 매핑
  const patternsForSentence = (si: number) =>
    grammarPatterns.filter(p => p.sentenceIndex === si);

  // 단어 클릭 처리
  const handleWordClick = async (word: string, event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();

    setPopup({
      text: word,
      type: 'word',
      x: rect.left,
      y: rect.bottom + 8,
    });

    setAnalysisLoading(true);
    try {
      const res = await fetch('/api/analyze-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      if (res.ok) {
        const data = await res.json();
        setPopup(prev => prev ? {
          ...prev,
          hanja: data.hanja || undefined,
          chinese: data.chinese || undefined,
          meaning: data.meaning || undefined,
          isFalseFriend: data.isFalseFriend || false,
          falseFriendNote: data.falseFriendNote || undefined,
        } : null);
      }
    } catch {
      // 분석 실패
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleAddWord = () => {
    if (popup) {
      onSelectWord({
        text: popup.text,
        hanja: popup.hanja,
        chinese: popup.chinese,
        meaning: popup.meaning,
        type: popup.type,
      });
      setPopup(null);
    }
  };

  const handleBackgroundClick = () => {
    setPopup(null);
  };

  return (
    <div onClick={handleBackgroundClick}>
      {/* 문법 패턴 로딩 */}
      {grammarLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
          <div className="w-3 h-3 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
          문법 패턴 분석 중...
        </div>
      )}

      {/* 스크립트 본문 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="space-y-4">
          {sentences.map((sentence, si) => {
            const patterns = patternsForSentence(si);
            return (
              <div key={si}>
                {/* 문장 */}
                <div className="leading-relaxed">
                  {sentence.split(/(\s+)/).map((token, ti) => {
                    if (/^\s+$/.test(token)) return <span key={ti}> </span>;
                    const isKorean = /[가-힣]/.test(token);
                    const cleanToken = token.replace(/[.,!?]/g, '');
                    const isSelected = selectedWords.some(w => w.text === cleanToken);
                    return (
                      <span
                        key={ti}
                        onClick={(e) => {
                          if (isKorean) {
                            e.stopPropagation();
                            handleWordClick(cleanToken, e);
                          }
                        }}
                        className={`
                          ${isKorean ? 'cursor-pointer hover:bg-blue-100 rounded px-0.5 transition-colors' : ''}
                          ${isSelected ? 'bg-blue-200 rounded px-0.5' : ''}
                        `}
                      >
                        {token}
                      </span>
                    );
                  })}
                </div>

                {/* 문법 패턴 배지 */}
                {patterns.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {patterns.map((p, pi) => (
                      <button
                        key={pi}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedGrammar(expandedGrammar === si * 100 + pi ? null : si * 100 + pi);
                        }}
                        className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full hover:bg-purple-200 transition-colors"
                      >
                        {p.pattern}
                      </button>
                    ))}
                  </div>
                )}

                {/* 문법 패턴 확장 */}
                {patterns.map((p, pi) =>
                  expandedGrammar === si * 100 + pi ? (
                    <div
                      key={`exp-${pi}`}
                      className="mt-2 bg-purple-50 rounded-lg p-3 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="font-semibold text-purple-800">{p.pattern}</p>
                      <p className="text-gray-700 mt-1">{p.meaning}</p>
                      <p className="text-gray-500 mt-0.5">{p.chineseMeaning}</p>
                      {p.example && (
                        <p className="text-xs text-gray-400 mt-1 italic">&ldquo;{p.example}&rdquo;</p>
                      )}
                    </div>
                  ) : null
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 팝업 */}
      {popup && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50 min-w-[220px] max-w-[300px]"
          style={{ left: Math.min(popup.x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 320), top: popup.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-lg font-bold text-gray-900 mb-1">{popup.text}</p>

          {analysisLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              분석 중...
            </div>
          ) : (
            <>
              {popup.hanja && (
                <p className="text-sm text-gray-600">
                  <span className="text-red-600 font-medium text-base">{popup.hanja}</span>
                  {popup.chinese && <span className="ml-2 text-gray-500">({popup.chinese})</span>}
                </p>
              )}
              {!popup.hanja && popup.chinese && (
                <p className="text-sm text-gray-600">
                  中文: <span className="font-medium">{popup.chinese}</span>
                </p>
              )}
              {popup.meaning && (
                <p className="text-sm text-gray-700 mt-1">{popup.meaning}</p>
              )}
              {/* False friend 경고 */}
              {popup.isFalseFriend && popup.falseFriendNote && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded p-2">
                  <p className="text-xs font-semibold text-orange-700">주의: 한중 의미 차이</p>
                  <p className="text-xs text-orange-600 mt-0.5">{popup.falseFriendNote}</p>
                </div>
              )}
            </>
          )}

          <button
            onClick={handleAddWord}
            className="mt-3 w-full py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            내 단어장에 추가
          </button>
        </div>
      )}

      {/* 선택한 단어 목록 */}
      {selectedWords.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-blue-700 mb-2">
            선택한 단어 ({selectedWords.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {selectedWords.map((item, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md text-sm border border-blue-200"
              >
                {item.text}
                {item.hanja && <span className="text-red-500 text-xs">{item.hanja}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 다음 단계 */}
      <button
        onClick={onNext}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        퀴즈로 → ({selectedWords.length}개 단어)
      </button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { NewsArticle, SelectedItem, GrammarPattern } from '@/lib/types';

interface Props {
  article: NewsArticle;
  selectedWords: SelectedItem[];
  onSelectWord: (item: SelectedItem) => void;
  onNext: () => void;
  onGrammarLoaded?: (patterns: GrammarPattern[]) => void;
  initialGrammarPatterns?: GrammarPattern[];
  selectedGrammar: GrammarPattern[];
  onToggleGrammar: (pattern: GrammarPattern) => void;
}

export default function ScriptStep({
  article, selectedWords, onSelectWord, onNext,
  onGrammarLoaded, initialGrammarPatterns,
  selectedGrammar, onToggleGrammar,
}: Props) {
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

  // 문법 패턴 — restore from parent if previously loaded
  const [grammarPatterns, setGrammarPatterns] = useState<(GrammarPattern & { sentenceIndex: number })[]>(
    () => (initialGrammarPatterns as (GrammarPattern & { sentenceIndex: number })[]) || []
  );
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [expandedGrammar, setExpandedGrammar] = useState<number | null>(null);

  // 교정된 스크립트 또는 원본
  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);

  // 문법 패턴 분석 — 사용자가 버튼 클릭 시에만 호출
  const analyzeGrammar = () => {
    if (!script || grammarPatterns.length > 0 || grammarLoading) return;
    setGrammarLoading(true);
    fetch('/api/grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })
      .then(res => res.json())
      .then(data => {
        const patterns = data.patterns || [];
        setGrammarPatterns(patterns);
        onGrammarLoaded?.(patterns);
      })
      .catch(() => {})
      .finally(() => setGrammarLoading(false));
  };

  // 문장별 문법 패턴 매핑 — 패턴 텍스트로 실제 포함 문장 찾기
  const patternToSentence = (p: GrammarPattern & { sentenceIndex: number }): number => {
    const cleanPattern = p.pattern.replace(/^[-~]/, '');
    for (let i = 0; i < sentences.length; i++) {
      if (cleanPattern && sentences[i].includes(cleanPattern)) return i;
    }
    if (p.example) {
      const cleanExample = p.example.replace(/[""'']/g, '').trim();
      for (let i = 0; i < sentences.length; i++) {
        if (cleanExample && sentences[i].includes(cleanExample)) return i;
      }
    }
    return p.sentenceIndex;
  };

  const patternsForSentence = (si: number) =>
    grammarPatterns.filter(p => patternToSentence(p) === si);

  // Find anchor token index for inline badge placement
  const findPatternAnchor = (pattern: GrammarPattern, tokens: string[]): number => {
    const cleaned = pattern.pattern
      .replace(/^[~\-]+/, '')
      .replace(/\([^)]*\)/g, '')  // strip (으), (이), (서) etc.
      .replace(/[/]/g, '')        // strip slashes like ㄴ/은
      .trim();

    const words = cleaned.split(/\s+/).filter(w => /[가-힣]/.test(w));
    if (words.length === 0) return -1;

    // Try from last word to first — last word is most specific
    for (let w = words.length - 1; w >= 0; w--) {
      const anchor = words[w].replace(/[^가-힣]/g, '');
      if (!anchor) continue;

      for (let i = 0; i < tokens.length; i++) {
        const cleanToken = tokens[i].replace(/[.,!?""'']/g, '');
        if (!cleanToken) continue;
        if (cleanToken.includes(anchor) || (anchor.length >= 2 && anchor.includes(cleanToken))) {
          return i;
        }
      }
    }
    return -1;
  };

  // 단어 클릭 처리
  const handleWordClick = async (word: string, event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setPopup({ text: word, type: 'word', x: rect.left, y: rect.bottom + 8 });

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
      {/* 语法分析按钮 */}
      {grammarPatterns.length === 0 && (
        <div className="mb-3">
          <button
            onClick={(e) => { e.stopPropagation(); analyzeGrammar(); }}
            disabled={grammarLoading}
            className="flex items-center gap-2 text-xs px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {grammarLoading ? (
              <>
                <div className="w-3 h-3 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                语法分析中...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                分析语法结构
              </>
            )}
          </button>
        </div>
      )}

      {/* 스크립트 본문 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="space-y-4">
          {sentences.map((sentence, si) => {
            const patterns = patternsForSentence(si);
            const tokens = sentence.split(/(\s+)/);

            // Build anchor map: token index -> pattern index
            const anchorMap = new Map<number, number>();
            patterns.forEach((p, pi) => {
              const idx = findPatternAnchor(p, tokens);
              if (idx >= 0 && !anchorMap.has(idx)) {
                anchorMap.set(idx, pi);
              }
            });

            // Patterns that couldn't be anchored to a token
            const anchoredPis = new Set(anchorMap.values());
            const unanchoredPatterns = patterns.filter((_, pi) => !anchoredPis.has(pi));

            return (
              <div key={si}>
                {/* 문장 with inline grammar badges */}
                <div className="leading-relaxed" style={anchorMap.size > 0 ? { lineHeight: '2.6' } : undefined}>
                  {tokens.map((token, ti) => {
                    if (/^\s+$/.test(token)) return <span key={ti}> </span>;

                    const cleanToken = token.replace(/[.,!?]/g, '');
                    const isKorean = /[가-힣]/.test(token);
                    const isWordSelected = selectedWords.some(w => w.text === cleanToken);

                    const wordEl = (
                      <span
                        onClick={(e) => {
                          if (isKorean) { e.stopPropagation(); handleWordClick(cleanToken, e); }
                        }}
                        className={`
                          ${isKorean ? 'cursor-pointer hover:bg-blue-100 rounded px-0.5 transition-colors' : ''}
                          ${isWordSelected ? 'bg-blue-200 rounded px-0.5' : ''}
                        `}
                      >
                        {token}
                      </span>
                    );

                    const pi = anchorMap.get(ti);
                    if (pi !== undefined) {
                      const p = patterns[pi];
                      const isGrammarSelected = selectedGrammar.some(g => g.pattern === p.pattern);
                      return (
                        <span key={ti} className="inline-flex flex-col items-center mx-0.5" style={{ verticalAlign: 'top' }}>
                          {wordEl}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedGrammar(expandedGrammar === si * 100 + pi ? null : si * 100 + pi);
                            }}
                            className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                              isGrammarSelected
                                ? 'bg-purple-300 text-purple-900 ring-1 ring-purple-500'
                                : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            }`}
                          >
                            {p.pattern}
                          </button>
                        </span>
                      );
                    }

                    return <span key={ti}>{wordEl}</span>;
                  })}
                </div>

                {/* Unanchored pattern badges (fallback) */}
                {unanchoredPatterns.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 ml-4">
                    {unanchoredPatterns.map((p) => {
                      const actualPi = patterns.indexOf(p);
                      const isGrammarSelected = selectedGrammar.some(g => g.pattern === p.pattern);
                      return (
                        <button
                          key={actualPi}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedGrammar(expandedGrammar === si * 100 + actualPi ? null : si * 100 + actualPi);
                          }}
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                            isGrammarSelected
                              ? 'bg-purple-300 text-purple-900 ring-1 ring-purple-500'
                              : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                          }`}
                        >
                          {p.pattern}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 문법 패턴 확장 — with quiz toggle */}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleGrammar(p);
                        }}
                        className={`mt-2 text-xs px-3 py-1 rounded-full transition-colors ${
                          selectedGrammar.some(g => g.pattern === p.pattern)
                            ? 'bg-purple-600 text-white'
                            : 'bg-white border border-purple-300 text-purple-700 hover:bg-purple-100'
                        }`}
                      >
                        {selectedGrammar.some(g => g.pattern === p.pattern) ? '已添加到测验 ✓' : '添加到测验'}
                      </button>
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
              分析中...
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
              {popup.isFalseFriend && popup.falseFriendNote && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded p-2">
                  <p className="text-xs font-semibold text-orange-700">注意：中韩含义差异</p>
                  <p className="text-xs text-orange-600 mt-0.5">{popup.falseFriendNote}</p>
                </div>
              )}
            </>
          )}

          <button
            onClick={handleAddWord}
            className="mt-3 w-full py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            添加到生词本
          </button>
        </div>
      )}

      {/* 선택한 단어 목록 */}
      {selectedWords.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-blue-700 mb-2">
            已选单词 ({selectedWords.length})
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

      {/* 선택한 문법 목록 */}
      {selectedGrammar.length > 0 && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-purple-700 mb-2">
            已选语法 ({selectedGrammar.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {selectedGrammar.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md text-sm border border-purple-200"
              >
                {p.pattern}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleGrammar(p); }}
                  className="text-purple-400 hover:text-purple-600 ml-0.5"
                >
                  ×
                </button>
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
        进入测验 →（{selectedWords.length}个单词{selectedGrammar.length > 0 ? `，${selectedGrammar.length}个语法` : ''}）
      </button>
    </div>
  );
}

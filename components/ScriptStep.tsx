'use client';

import { useState, useRef, useEffect } from 'react';
import type { NewsArticle, SelectedItem, GrammarPattern, WordOrigin, StudyLevel } from '@/lib/types';
import { logEvent } from '@/lib/events';

const LEVEL_LABELS: Record<StudyLevel, { label: string; ko: string; color: string }> = {
  original: { label: 'Original', ko: '원문', color: 'bg-gray-800 text-white' },
  beginner: { label: 'Beginner', ko: '초급', color: 'bg-green-500 text-white' },
  intermediate: { label: 'Intermediate', ko: '중급', color: 'bg-yellow-500 text-white' },
  advanced: { label: 'Advanced', ko: '고급', color: 'bg-red-500 text-white' },
};

interface Props {
  article: NewsArticle;
  articleId: string;
  selectedWords: SelectedItem[];
  onSelectWord: (item: SelectedItem) => void;
  onNext: () => void;
  onGrammarLoaded?: (patterns: GrammarPattern[]) => void;
  initialGrammarPatterns?: GrammarPattern[];
  selectedGrammar: GrammarPattern[];
  onToggleGrammar: (pattern: GrammarPattern) => void;
}

export default function ScriptStep({
  article, articleId, selectedWords, onSelectWord, onNext,
  onGrammarLoaded, initialGrammarPatterns,
  selectedGrammar, onToggleGrammar,
}: Props) {
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [popup, setPopup] = useState<{
    text: string;
    hanja?: string;
    chinese?: string;
    meaning?: string;
    wordOrigin?: WordOrigin;
    isFalseFriend?: boolean;
    falseFriendNote?: string;
    type: 'word' | 'phrase' | 'sentence';
    x: number;
    y: number;
  } | null>(null);

  const visibleSentenceRef = useRef<number>(0);
  const sentenceStartRef = useRef<number>(Date.now());

  const [grammarPatterns, setGrammarPatterns] = useState<(GrammarPattern & { sentenceIndex: number })[]>(
    () => (initialGrammarPatterns as (GrammarPattern & { sentenceIndex: number })[]) || []
  );
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [expandedGrammar, setExpandedGrammar] = useState<number | null>(null);

  const [level, setLevel] = useState<StudyLevel>(() => {
    if (article.rewrites?.intermediate) return 'intermediate';
    return 'original';
  });
  const [rewrites, setRewrites] = useState(article.rewrites || {});
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);

  const originalText = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';

  const script = level === 'original'
    ? originalText
    : (rewrites[level] || originalText);

  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);

  const handleLevelChange = async (newLevel: StudyLevel) => {
    setLevel(newLevel);
    setRewriteError(null);
    logEvent('level_toggle', { from: level, to: newLevel }, articleId);

    if (newLevel === 'original') return;
    if (rewrites[newLevel]) return;

    setRewriteLoading(true);
    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (data.rewrites) {
        setRewrites(data.rewrites);
      } else {
        setRewriteError(data.error || 'Rewrite failed');
      }
    } catch {
      setRewriteError('Network error');
    } finally {
      setRewriteLoading(false);
    }
  };

  useEffect(() => {
    setPopup(null);
    setGrammarPatterns([]);
    visibleSentenceRef.current = 0;
    sentenceStartRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const analyzeGrammar = () => {
    if (!script || grammarPatterns.length > 0 || grammarLoading) return;
    setGrammarLoading(true);
    logEvent('grammar_analyze', { sentenceCount: sentences.length }, articleId);
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

  const findPatternAnchor = (pattern: GrammarPattern, tokens: string[]): number => {
    const cleaned = pattern.pattern
      .replace(/^[~\-]+/, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[/]/g, '')
      .trim();

    const words = cleaned.split(/\s+/).filter(w => /[가-힣]/.test(w));
    if (words.length === 0) return -1;

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

  const logSentenceReadTime = (newSentenceIndex: number) => {
    if (newSentenceIndex !== visibleSentenceRef.current) {
      const durationMs = Date.now() - sentenceStartRef.current;
      const prevSentence = sentences[visibleSentenceRef.current] || '';
      const wordCount = prevSentence.split(/\s+/).filter(Boolean).length;
      const hanjaWordCount = prevSentence.split(/\s+/).filter(w => /^[가-힣]{2,}$/.test(w)).length;
      logEvent('sentence_read_time', {
        sentenceIndex: visibleSentenceRef.current,
        text: prevSentence.slice(0, 100),
        durationMs,
        wordCount,
        hanjaWordCount,
      }, articleId);
      visibleSentenceRef.current = newSentenceIndex;
      sentenceStartRef.current = Date.now();
    }
  };

  const handleWordClick = async (word: string, event: React.MouseEvent, sentenceIndex?: number) => {
    if (sentenceIndex !== undefined) logSentenceReadTime(sentenceIndex);
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
          wordOrigin: data.wordOrigin || undefined,
          isFalseFriend: data.isFalseFriend || false,
          falseFriendNote: data.falseFriendNote || undefined,
        } : null);

        logEvent('word_click', {
          word,
          wordOrigin: data.wordOrigin || null,
          hanja: data.hanja || null,
          chinese: data.chinese || null,
          isFalseFriend: data.isFalseFriend || false,
          falseFriendNote: data.falseFriendNote || null,
        }, articleId);

        if (data.isFalseFriend) {
          logEvent('false_friend_seen', {
            word,
            hanja: data.hanja || null,
            koreanMeaning: data.meaning || null,
            chineseMeaning: data.chinese || null,
            falseFriendNote: data.falseFriendNote || null,
          }, articleId);
        }
      }
    } catch {
      // analysis failed
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
        wordOrigin: popup.wordOrigin,
        type: popup.type,
      });
      logEvent('word_select', {
        word: popup.text,
        wordOrigin: popup.wordOrigin || null,
        chinese: popup.chinese || null,
      }, articleId);
      setPopup(null);
    }
  };

  const handleBackgroundClick = () => {
    setPopup(null);
  };

  return (
    <div onClick={handleBackgroundClick}>
      {/* Level switcher */}
      <div className="mb-3 flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {(['original', 'beginner', 'intermediate', 'advanced'] as StudyLevel[]).map((lv) => {
          const isActive = lv === level;
          const isAvailable = lv === 'original' || !!rewrites[lv];
          return (
            <button
              key={lv}
              onClick={(e) => { e.stopPropagation(); handleLevelChange(lv); }}
              disabled={rewriteLoading}
              className={`flex-1 text-xs py-1.5 rounded-md transition-all font-medium ${
                isActive
                  ? LEVEL_LABELS[lv].color + ' shadow-sm'
                  : 'text-gray-600 hover:bg-white'
              }`}
              title={isAvailable ? '' : 'Click to generate'}
            >
              {LEVEL_LABELS[lv].label}
              {!isAvailable && (
                <span className="ml-1 opacity-50">✨</span>
              )}
            </button>
          );
        })}
      </div>

      {rewriteLoading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-md">
          <div className="w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          AI is rewriting the news for you... (~10 sec)
        </div>
      )}

      {rewriteError && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
          {rewriteError}
        </div>
      )}

      {/* Grammar analysis button */}
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
                Analyzing grammar...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Analyze Grammar
              </>
            )}
          </button>
        </div>
      )}

      {/* Script body */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="space-y-4">
          {sentences.map((sentence, si) => {
            const patterns = patternsForSentence(si);
            const tokens = sentence.split(/(\s+)/);

            const anchorMap = new Map<number, number>();
            patterns.forEach((p, pi) => {
              const idx = findPatternAnchor(p, tokens);
              if (idx >= 0 && !anchorMap.has(idx)) {
                anchorMap.set(idx, pi);
              }
            });

            const anchoredPis = new Set(anchorMap.values());
            const unanchoredPatterns = patterns.filter((_, pi) => !anchoredPis.has(pi));

            return (
              <div key={si}>
                <div className="leading-relaxed" style={anchorMap.size > 0 ? { lineHeight: '2.6' } : undefined}>
                  {tokens.map((token, ti) => {
                    if (/^\s+$/.test(token)) return <span key={ti}> </span>;

                    const cleanToken = token.replace(/[.,!?]/g, '');
                    const isKorean = /[가-힣]/.test(token);
                    const isWordSelected = selectedWords.some(w => w.text === cleanToken);

                    const wordEl = (
                      <span
                        onClick={(e) => {
                          if (isKorean) { e.stopPropagation(); handleWordClick(cleanToken, e, si); }
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
                          logEvent('grammar_select', {
                            pattern: p.pattern,
                            chineseMeaning: p.chineseMeaning,
                            difficultyForChinese: p.difficultyForChinese || null,
                          }, articleId);
                        }}
                        className={`mt-2 text-xs px-3 py-1 rounded-full transition-colors ${
                          selectedGrammar.some(g => g.pattern === p.pattern)
                            ? 'bg-purple-600 text-white'
                            : 'bg-white border border-purple-300 text-purple-700 hover:bg-purple-100'
                        }`}
                      >
                        {selectedGrammar.some(g => g.pattern === p.pattern) ? 'Added to Quiz ✓' : 'Add to Quiz'}
                      </button>
                    </div>
                  ) : null
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Word popup */}
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
              Analyzing...
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
                  Translation: <span className="font-medium">{popup.chinese}</span>
                </p>
              )}
              {popup.meaning && (
                <p className="text-sm text-gray-700 mt-1">{popup.meaning}</p>
              )}
              {popup.isFalseFriend && popup.falseFriendNote && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded p-2">
                  <p className="text-xs font-semibold text-orange-700">Note: False friend (meaning differs)</p>
                  <p className="text-xs text-orange-600 mt-0.5">{popup.falseFriendNote}</p>
                </div>
              )}
            </>
          )}

          <button
            onClick={handleAddWord}
            className="mt-3 w-full py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            Add to Vocabulary
          </button>
        </div>
      )}

      {/* Selected words */}
      {selectedWords.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-blue-700 mb-2">
            Selected Words ({selectedWords.length})
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

      {/* Selected grammar */}
      {selectedGrammar.length > 0 && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-purple-700 mb-2">
            Selected Grammar ({selectedGrammar.length})
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

      {/* Next step */}
      <button
        onClick={onNext}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Go to Quiz &rarr; ({selectedWords.length} word{selectedWords.length !== 1 ? 's' : ''}{selectedGrammar.length > 0 ? `, ${selectedGrammar.length} grammar` : ''})
      </button>
    </div>
  );
}

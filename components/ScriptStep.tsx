'use client';

import { useState } from 'react';
import type { NewsArticle, SelectedItem } from '@/lib/types';

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
    type: 'word' | 'phrase' | 'sentence';
    x: number;
    y: number;
  } | null>(null);

  // 교정된 스크립트 또는 원본
  const script = article.proofreadScript || article.transcriptSegments?.map(s => s.text).join(' ') || '';
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);

  // 단어 클릭 처리
  const handleWordClick = async (word: string, event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();

    setPopup({
      text: word,
      type: 'word',
      x: rect.left,
      y: rect.bottom + 8,
    });

    // Claude API로 한자어 분석 요청
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
        } : null);
      }
    } catch {
      // 분석 실패 시 기본 정보만 표시
    } finally {
      setAnalysisLoading(false);
    }
  };

  // 팝업에서 단어 선택
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

  // 배경 클릭 시 팝업 닫기
  const handleBackgroundClick = () => {
    setPopup(null);
  };

  return (
    <div onClick={handleBackgroundClick}>
      {/* 스크립트 본문 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="space-y-4">
          {sentences.map((sentence, si) => (
            <div key={si} className="leading-relaxed">
              {sentence.split(/(\s+)/).map((token, ti) => {
                if (/^\s+$/.test(token)) return <span key={ti}> </span>;
                // 한글 단어만 클릭 가능
                const isKorean = /[가-힣]/.test(token);
                const isSelected = selectedWords.some(w => w.text === token);
                return (
                  <span
                    key={ti}
                    onClick={(e) => {
                      if (isKorean) {
                        e.stopPropagation();
                        handleWordClick(token.replace(/[.,!?]/g, ''), e);
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
          ))}
        </div>
      </div>

      {/* 팝업 */}
      {popup && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-50 min-w-[200px]"
          style={{ left: Math.min(popup.x, window.innerWidth - 220), top: popup.y }}
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
                  <span className="text-red-600 font-medium">{popup.hanja}</span>
                  {popup.chinese && <span className="ml-2 text-gray-500">({popup.chinese})</span>}
                </p>
              )}
              {popup.meaning && (
                <p className="text-sm text-gray-700 mt-1">{popup.meaning}</p>
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

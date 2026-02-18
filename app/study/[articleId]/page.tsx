'use client';

import { useState, useEffect } from 'react';
import type { NewsArticle, StudyStep } from '@/lib/types';
import VideoStep from '@/components/VideoStep';
import ScriptStep from '@/components/ScriptStep';
import type { SelectedItem } from '@/lib/types';

const STEPS: { key: StudyStep; label: string; num: number }[] = [
  { key: 'video', label: '영상 시청', num: 2 },
  { key: 'script', label: '스크립트 학습', num: 3 },
  { key: 'quiz', label: '퀴즈', num: 4 },
  { key: 'shadowing', label: '쉐도잉', num: 5 },
];

export default function StudyPage({ params }: { params: { articleId: string } }) {
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<StudyStep>('video');
  const [selectedWords, setSelectedWords] = useState<SelectedItem[]>([]);

  useEffect(() => {
    async function fetchArticle() {
      try {
        const res = await fetch(`/api/articles/${params.articleId}`);
        if (!res.ok) throw new Error('Article not found');
        const data = await res.json();
        setArticle(data.article);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchArticle();
  }, [params.articleId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          {error || 'Article not found'}
        </div>
        <a href="/" className="text-blue-600 text-sm mt-4 inline-block">
          ← 목록으로 돌아가기
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/" className="text-gray-400 hover:text-gray-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </a>
        <div>
          <h1 className="text-lg font-bold text-gray-900">{article.title}</h1>
          <p className="text-xs text-gray-500">{article.reporter} 기자</p>
        </div>
      </div>

      {/* 단계 탭 */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {STEPS.map((step) => (
          <button
            key={step.key}
            onClick={() => setCurrentStep(step.key)}
            className={`flex-1 text-xs py-2 rounded-md transition-all ${
              currentStep === step.key
                ? 'bg-white text-blue-700 font-semibold shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {step.label}
          </button>
        ))}
      </div>

      {/* 단계별 컨텐츠 */}
      {currentStep === 'video' && (
        <VideoStep
          article={article}
          onNext={() => setCurrentStep('script')}
        />
      )}

      {currentStep === 'script' && (
        <ScriptStep
          article={article}
          selectedWords={selectedWords}
          onSelectWord={(item) => {
            setSelectedWords(prev => {
              const exists = prev.some(w => w.text === item.text && w.type === item.type);
              if (exists) return prev;
              return [...prev, item];
            });
          }}
          onNext={() => setCurrentStep('quiz')}
        />
      )}

      {currentStep === 'quiz' && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">퀴즈 (준비 중)</p>
          <p className="text-sm">선택한 단어 {selectedWords.length}개로 퀴즈를 생성합니다</p>
          <button
            onClick={() => setCurrentStep('shadowing')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
          >
            다음: 쉐도잉
          </button>
        </div>
      )}

      {currentStep === 'shadowing' && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">쉐도잉 + 발음 체크 (준비 중)</p>
          <p className="text-sm">문장별 따라 읽기 + 발음 평가</p>
        </div>
      )}
    </div>
  );
}

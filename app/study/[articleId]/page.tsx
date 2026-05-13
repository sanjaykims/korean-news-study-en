'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NewsArticle, StudyStep, SelectedItem, ShadowingResult, GrammarPattern } from '@/lib/types';
import { logEvent, resetSession } from '@/lib/events';
import VideoStep from '@/components/VideoStep';
import ScriptStep from '@/components/ScriptStep';
import QuizStep from '@/components/QuizStep';
import ShadowingStep from '@/components/ShadowingStep';
import ReportButton from '@/components/ReportButton';

const STEPS: { key: StudyStep; label: string }[] = [
  { key: 'video', label: 'Watch' },
  { key: 'script', label: 'Script' },
  { key: 'quiz', label: 'Quiz' },
  { key: 'shadowing', label: 'Shadowing' },
];

export default function StudyPage({ params }: { params: { articleId: string } }) {
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<StudyStep>('video');
  const [selectedWords, setSelectedWords] = useState<SelectedItem[]>([]);
  const [grammarPatterns, setGrammarPatterns] = useState<GrammarPattern[]>([]);
  const [selectedGrammar, setSelectedGrammar] = useState<GrammarPattern[]>([]);

  const sessionStartRef = useRef<number>(Date.now());
  const stageStartRef = useRef<number>(Date.now());
  const completedStagesRef = useRef<string[]>([]);
  const sessionLoggedRef = useRef(false);

  const handleToggleGrammar = (pattern: GrammarPattern) => {
    setSelectedGrammar(prev => {
      const exists = prev.some(p => p.pattern === pattern.pattern);
      if (exists) return prev.filter(p => p.pattern !== pattern.pattern);
      return [...prev, pattern];
    });
  };

  const changeStep = useCallback((newStep: StudyStep) => {
    const stageDuration = Date.now() - stageStartRef.current;
    if (!completedStagesRef.current.includes(currentStep)) {
      completedStagesRef.current.push(currentStep);
    }
    logEvent('stage_complete', { stage: currentStep, durationMs: stageDuration }, params.articleId);

    stageStartRef.current = Date.now();
    logEvent('stage_enter', { stage: newStep }, params.articleId);

    setCurrentStep(newStep);
  }, [currentStep, params.articleId]);

  useEffect(() => {
    async function fetchArticle() {
      try {
        const res = await fetch(`/api/articles/${params.articleId}`);
        if (!res.ok) throw new Error('Article not found');
        const data = await res.json();
        setArticle(data.article);

        resetSession();
        sessionStartRef.current = Date.now();
        sessionLoggedRef.current = false;
        logEvent('session_start', {
          articleTitle: data.article.title,
          topic: data.article.topic,
          articleDate: data.article.newsDate,
        }, params.articleId);
        logEvent('stage_enter', { stage: 'video' }, params.articleId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchArticle();
  }, [params.articleId]);

  useEffect(() => {
    const completedStages = completedStagesRef.current;
    return () => {
      if (!sessionLoggedRef.current && !loading) {
        sessionLoggedRef.current = true;
        const totalTimeMs = Date.now() - sessionStartRef.current;
        logEvent('session_complete', {
          stagesCompleted: completedStages,
          totalTimeMs,
          completedAllStages: completedStages.length >= 4,
        }, params.articleId);
      }
    };
  }, [params.articleId, loading]);

  const handleWrongAnswers = async (wrongWords: string[]) => {
    try {
      await fetch('/api/sentence-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: wrongWords.map(w => ({
            sentence: w,
            source: 'quiz',
            sourceArticleId: params.articleId,
          })),
        }),
      });
    } catch {
      // ignore
    }
  };

  const handleShadowingComplete = async (results: ShadowingResult[]) => {
    const lowScores = results.filter(r => r.score <= 2);
    if (lowScores.length === 0) return;

    try {
      await fetch('/api/sentence-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lowScores.map(r => ({
            sentence: r.sentence,
            source: 'shadowing',
            score: r.score,
            sourceArticleId: params.articleId,
          })),
        }),
      });
    } catch {
      // ignore
    }

    if (selectedWords.length > 0) {
      try {
        await fetch('/api/vocabulary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            words: selectedWords.map(w => ({
              word: w.text,
              hanja: w.hanja,
              chinese: w.chinese,
              meaning: w.meaning,
              wordOrigin: w.wordOrigin,
              sourceArticleId: params.articleId,
            })),
          }),
        });
      } catch {
        // ignore
      }
    }
  };

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
          &larr; Back to list
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <a href="/" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-gray-900 truncate">{article.title}</h1>
          <p className="text-xs text-gray-500">{article.reporter ? `Reporter: ${article.reporter}` : ''}</p>
        </div>
        <ReportButton article={article} articleId={params.articleId} selectedWords={selectedWords} />
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {STEPS.map((step) => (
          <button
            key={step.key}
            onClick={() => changeStep(step.key)}
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

      {currentStep === 'video' && (
        <VideoStep
          article={article}
          articleId={params.articleId}
          onNext={() => changeStep('script')}
        />
      )}

      {currentStep === 'script' && (
        <ScriptStep
          article={article}
          articleId={params.articleId}
          selectedWords={selectedWords}
          onSelectWord={(item) => {
            setSelectedWords(prev => {
              const exists = prev.some(w => w.text === item.text && w.type === item.type);
              if (exists) return prev;
              return [...prev, item];
            });
          }}
          onNext={() => changeStep('quiz')}
          onGrammarLoaded={(patterns) => setGrammarPatterns(patterns)}
          initialGrammarPatterns={grammarPatterns}
          selectedGrammar={selectedGrammar}
          onToggleGrammar={handleToggleGrammar}
        />
      )}

      {currentStep === 'quiz' && (
        <QuizStep
          articleId={params.articleId}
          selectedWords={selectedWords}
          grammarPatterns={selectedGrammar}
          onNext={() => changeStep('shadowing')}
          onWrongAnswers={handleWrongAnswers}
        />
      )}

      {currentStep === 'shadowing' && (
        <ShadowingStep
          article={article}
          articleId={params.articleId}
          onComplete={handleShadowingComplete}
        />
      )}
    </div>
  );
}

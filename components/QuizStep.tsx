'use client';

import { useState, useEffect } from 'react';
import type { SelectedItem } from '@/lib/types';

interface QuizQuestion {
  id: number;
  koreanText: string;
  correctAnswer: string;
  options: string[];
  type: 'chinese_to_korean' | 'korean_to_chinese';
}

interface Props {
  selectedWords: SelectedItem[];
  onNext: () => void;
  onWrongAnswers: (sentences: string[]) => void;
}

export default function QuizStep({ selectedWords, onNext, onWrongAnswers }: Props) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<{ correct: boolean; question: QuizQuestion }[]>([]);
  const [quizDone, setQuizDone] = useState(false);

  useEffect(() => {
    async function generateQuiz() {
      try {
        const res = await fetch('/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: selectedWords }),
        });
        const data = await res.json();
        setQuestions(data.questions || []);
      } catch {
        // 퀴즈 생성 실패 시 빈 배열
      } finally {
        setLoading(false);
      }
    }
    if (selectedWords.length > 0) {
      generateQuiz();
    } else {
      setLoading(false);
    }
  }, [selectedWords]);

  const handleSelect = (option: string) => {
    if (showResult) return;
    setSelectedOption(option);
    setShowResult(true);

    const question = questions[currentIndex];
    const correct = option === question.correctAnswer;
    setResults(prev => [...prev, { correct, question }]);
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowResult(false);
    } else {
      setQuizDone(true);
      // 틀린 답 → sentence bank
      const wrongWords = results
        .filter(r => !r.correct)
        .map(r => r.question.koreanText);
      if (wrongWords.length > 0) {
        onWrongAnswers(wrongWords);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-sm text-gray-500">퀴즈를 생성하고 있습니다...</p>
      </div>
    );
  }

  if (selectedWords.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">선택한 단어가 없습니다</p>
        <p className="text-sm text-gray-400 mb-6">스크립트 학습에서 단어를 선택해 주세요</p>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          쉐도잉으로 건너뛰기
        </button>
      </div>
    );
  }

  if (quizDone) {
    const correctCount = results.filter(r => r.correct).length;
    const total = results.length;
    const percentage = Math.round((correctCount / total) * 100);

    return (
      <div className="text-center py-10">
        {/* 점수 */}
        <div className="mb-8">
          <div className="text-5xl font-bold text-gray-900 mb-2">{percentage}%</div>
          <p className="text-gray-500">{correctCount} / {total} 정답</p>
        </div>

        {/* 틀린 문제 목록 */}
        {results.some(r => !r.correct) && (
          <div className="bg-red-50 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-red-700 mb-2">틀린 단어 (문장 은행에 저장됨)</h3>
            <div className="space-y-2">
              {results.filter(r => !r.correct).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-900 font-medium">{r.question.koreanText}</span>
                  <span className="text-gray-500">{r.question.correctAnswer}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 맞은 문제 */}
        {results.some(r => r.correct) && (
          <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-green-700 mb-2">맞은 단어</h3>
            <div className="flex flex-wrap gap-2">
              {results.filter(r => r.correct).map((r, i) => (
                <span key={i} className="px-2 py-1 bg-white rounded text-sm border border-green-200">
                  {r.question.koreanText}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onNext}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          쉐도잉으로 →
        </button>
      </div>
    );
  }

  // 현재 문제
  const question = questions[currentIndex];
  if (!question) return null;

  return (
    <div>
      {/* 진행 바 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{currentIndex + 1}/{questions.length}</span>
      </div>

      {/* 문제 유형 표시 */}
      <div className="mb-4">
        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
          {question.type === 'chinese_to_korean' ? '中文 → 한국어' : '한국어 → 中文'}
        </span>
      </div>

      {/* 문제 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 text-center">
        <p className="text-2xl font-bold text-gray-900">
          {question.type === 'chinese_to_korean' ? question.correctAnswer : question.koreanText}
        </p>
        {question.type === 'chinese_to_korean' && (
          <p className="text-sm text-gray-500 mt-2">이 뜻의 한국어 단어는?</p>
        )}
        {question.type === 'korean_to_chinese' && (
          <p className="text-sm text-gray-500 mt-2">이 단어의 뜻은?</p>
        )}
      </div>

      {/* 선택지 */}
      <div className="space-y-3 mb-6">
        {question.options.map((option, i) => {
          let className = 'w-full text-left px-4 py-3 rounded-lg border text-sm transition-all ';

          if (!showResult) {
            className += 'border-gray-200 hover:border-blue-300 hover:bg-blue-50';
          } else if (option === question.correctAnswer) {
            className += 'border-green-400 bg-green-50 text-green-800';
          } else if (option === selectedOption && option !== question.correctAnswer) {
            className += 'border-red-400 bg-red-50 text-red-800';
          } else {
            className += 'border-gray-200 text-gray-400';
          }

          return (
            <button
              key={i}
              onClick={() => handleSelect(option)}
              className={className}
              disabled={showResult}
            >
              {option}
            </button>
          );
        })}
      </div>

      {/* 다음 버튼 */}
      {showResult && (
        <button
          onClick={handleNextQuestion}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          {currentIndex + 1 < questions.length ? '다음 문제' : '결과 보기'}
        </button>
      )}
    </div>
  );
}

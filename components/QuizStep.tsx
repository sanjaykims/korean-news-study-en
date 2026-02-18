'use client';

import { useState, useEffect, useMemo } from 'react';
import type { SelectedItem, GrammarPattern } from '@/lib/types';

interface QuizQuestion {
  id: number;
  type: 'chinese_to_korean' | 'korean_to_chinese' | 'grammar_to_chinese' | 'chinese_to_grammar';
  prompt: string;        // What to display as the question
  correctAnswer: string; // The correct option
  options: string[];     // All 4 options
  // Legacy fields (backward compat)
  koreanText?: string;
}

interface Props {
  selectedWords: SelectedItem[];
  grammarPatterns: GrammarPattern[];
  onNext: () => void;
  onWrongAnswers: (sentences: string[]) => void;
}

// Shuffle array (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate grammar quiz questions client-side
function generateGrammarQuestions(patterns: GrammarPattern[]): QuizQuestion[] {
  if (patterns.length < 2) return [];

  const questions: QuizQuestion[] = [];
  const uniquePatterns = patterns.filter((p, i, arr) =>
    arr.findIndex(x => x.pattern === p.pattern) === i
  );

  uniquePatterns.forEach((p, idx) => {
    // Type 1: Show grammar pattern → pick correct Chinese meaning
    if (uniquePatterns.length >= 2) {
      const wrongOptions = shuffle(
        uniquePatterns.filter(x => x.pattern !== p.pattern)
      ).slice(0, 3).map(x => x.chineseMeaning);

      const options = shuffle([p.chineseMeaning, ...wrongOptions]);
      questions.push({
        id: 1000 + idx * 2,
        type: 'grammar_to_chinese',
        prompt: p.pattern,
        correctAnswer: p.chineseMeaning,
        options,
      });
    }

    // Type 2: Show Chinese meaning → pick correct grammar pattern
    if (uniquePatterns.length >= 2) {
      const wrongOptions = shuffle(
        uniquePatterns.filter(x => x.pattern !== p.pattern)
      ).slice(0, 3).map(x => x.pattern);

      const options = shuffle([p.pattern, ...wrongOptions]);
      questions.push({
        id: 1000 + idx * 2 + 1,
        type: 'chinese_to_grammar',
        prompt: p.chineseMeaning,
        correctAnswer: p.pattern,
        options,
      });
    }
  });

  return shuffle(questions);
}

const TYPE_LABELS: Record<string, string> = {
  'chinese_to_korean': '中文 → 韩语',
  'korean_to_chinese': '韩语 → 中文',
  'grammar_to_chinese': '语法 → 中文',
  'chinese_to_grammar': '中文 → 语法',
};

const HINT_TEXT: Record<string, string> = {
  'chinese_to_korean': '对应的韩语单词是？',
  'korean_to_chinese': '这个单词的中文意思是？',
  'grammar_to_chinese': '这个语法的中文意思是？',
  'chinese_to_grammar': '对应的韩语语法是？',
};

export default function QuizStep({ selectedWords, grammarPatterns, onNext, onWrongAnswers }: Props) {
  const [vocabQuestions, setVocabQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<{ correct: boolean; question: QuizQuestion }[]>([]);
  const [quizDone, setQuizDone] = useState(false);

  // Generate grammar questions client-side
  const grammarQuestions = useMemo(
    () => generateGrammarQuestions(grammarPatterns),
    [grammarPatterns]
  );

  useEffect(() => {
    async function generateQuiz() {
      try {
        const res = await fetch('/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: selectedWords }),
        });
        const data = await res.json();
        if (data.questions) {
          // Normalize: ensure all questions have 'prompt' field
          const normalized = data.questions.map((q: QuizQuestion) => ({
            ...q,
            prompt: q.prompt || q.koreanText || '',
          }));
          setVocabQuestions(normalized);
        }
      } catch {
        // fallback
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

  // Combine vocab + grammar questions
  const questions = useMemo(() => {
    return [...vocabQuestions, ...grammarQuestions];
  }, [vocabQuestions, grammarQuestions]);

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
      const wrongWords = results
        .filter(r => !r.correct)
        .map(r => r.question.prompt);
      if (wrongWords.length > 0) {
        onWrongAnswers(wrongWords);
      }
    }
  };

  const hasContent = selectedWords.length > 0 || grammarPatterns.length >= 2;

  if (loading && selectedWords.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-sm text-gray-500">正在生成测验题...</p>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">未选择任何单词</p>
        <p className="text-sm text-gray-400 mb-6">请先在脚本学习中选择单词</p>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          跳过，进入跟读
        </button>
      </div>
    );
  }

  if (quizDone) {
    const correctCount = results.filter(r => r.correct).length;
    const total = results.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    const wrongVocab = results.filter(r => !r.correct && (r.question.type === 'chinese_to_korean' || r.question.type === 'korean_to_chinese'));
    const wrongGrammar = results.filter(r => !r.correct && (r.question.type === 'grammar_to_chinese' || r.question.type === 'chinese_to_grammar'));
    const correctResults = results.filter(r => r.correct);

    return (
      <div className="text-center py-10">
        <div className="mb-8">
          <div className="text-5xl font-bold text-gray-900 mb-2">{percentage}%</div>
          <p className="text-gray-500">{correctCount} / {total} 正确</p>
        </div>

        {wrongVocab.length > 0 && (
          <div className="bg-red-50 rounded-lg p-4 mb-4 text-left">
            <h3 className="text-sm font-semibold text-red-700 mb-2">错误单词（已保存到句子库）</h3>
            <div className="space-y-2">
              {wrongVocab.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-900 font-medium">{r.question.prompt}</span>
                  <span className="text-gray-500">{r.question.correctAnswer}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {wrongGrammar.length > 0 && (
          <div className="bg-orange-50 rounded-lg p-4 mb-4 text-left">
            <h3 className="text-sm font-semibold text-orange-700 mb-2">错误语法</h3>
            <div className="space-y-2">
              {wrongGrammar.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-900 font-medium">{r.question.prompt}</span>
                  <span className="text-gray-500">{r.question.correctAnswer}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {correctResults.length > 0 && (
          <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-green-700 mb-2">正确</h3>
            <div className="flex flex-wrap gap-2">
              {correctResults.map((r, i) => (
                <span key={i} className="px-2 py-1 bg-white rounded text-sm border border-green-200">
                  {r.question.prompt}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onNext}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          进入跟读 →
        </button>
      </div>
    );
  }

  // Current question
  const question = questions[currentIndex];
  if (!question) return null;

  const isGrammarType = question.type === 'grammar_to_chinese' || question.type === 'chinese_to_grammar';

  return (
    <div>
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{currentIndex + 1}/{questions.length}</span>
      </div>

      {/* Question type badge */}
      <div className="mb-4">
        <span className={`text-xs px-2 py-1 rounded-full ${
          isGrammarType
            ? 'bg-purple-100 text-purple-700'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {TYPE_LABELS[question.type] || question.type}
        </span>
      </div>

      {/* Question prompt */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 text-center">
        <p className={`font-bold text-gray-900 ${isGrammarType ? 'text-xl' : 'text-2xl'}`}>
          {question.prompt}
        </p>
        <p className="text-sm text-gray-500 mt-2">{HINT_TEXT[question.type] || ''}</p>
      </div>

      {/* Options */}
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

      {/* Next button */}
      {showResult && (
        <button
          onClick={handleNextQuestion}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          {currentIndex + 1 < questions.length ? '下一题' : '查看结果'}
        </button>
      )}
    </div>
  );
}

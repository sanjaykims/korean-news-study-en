'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { SelectedItem, GrammarPattern } from '@/lib/types';
import { logEvent } from '@/lib/events';

interface QuizQuestion {
  id: number;
  type: 'chinese_to_korean' | 'korean_to_chinese' | 'grammar_to_chinese' | 'chinese_to_grammar';
  prompt: string;
  correctAnswer: string;
  options: string[];
  wordOrigin?: string;
  koreanText?: string;
}

interface Props {
  articleId: string;
  selectedWords: SelectedItem[];
  grammarPatterns: GrammarPattern[];
  onNext: () => void;
  onWrongAnswers: (sentences: string[]) => void;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateGrammarQuestions(patterns: GrammarPattern[]): QuizQuestion[] {
  if (patterns.length < 2) return [];

  const questions: QuizQuestion[] = [];
  const uniquePatterns = patterns.filter((p, i, arr) =>
    arr.findIndex(x => x.pattern === p.pattern) === i
  );

  uniquePatterns.forEach((p, idx) => {
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
  'chinese_to_korean': 'English → Korean',
  'korean_to_chinese': 'Korean → English',
  'grammar_to_chinese': 'Grammar → English',
  'chinese_to_grammar': 'English → Grammar',
};

const HINT_TEXT: Record<string, string> = {
  'chinese_to_korean': 'What is the Korean word?',
  'korean_to_chinese': 'What does this word mean?',
  'grammar_to_chinese': 'What does this grammar pattern mean?',
  'chinese_to_grammar': 'Which grammar pattern matches?',
};

export default function QuizStep({ articleId, selectedWords, grammarPatterns, onNext, onWrongAnswers }: Props) {
  const [vocabQuestions, setVocabQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<{ correct: boolean; question: QuizQuestion }[]>([]);
  const [quizDone, setQuizDone] = useState(false);
  const questionStartRef = useRef<number>(Date.now());

  const grammarQuestions = useMemo(
    () => generateGrammarQuestions(grammarPatterns),
    [grammarPatterns]
  );

  const wordOriginMap = useMemo(() => {
    const map: Record<string, string> = {};
    selectedWords.forEach(w => {
      if (w.wordOrigin) map[w.text] = w.wordOrigin;
    });
    return map;
  }, [selectedWords]);

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
          const normalized = data.questions.map((q: QuizQuestion) => {
            const prompt = q.prompt || q.koreanText || '';
            return {
              ...q,
              prompt,
              wordOrigin: wordOriginMap[prompt] || null,
            };
          });
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
  }, [selectedWords, wordOriginMap]);

  const questions = useMemo(() => {
    return [...vocabQuestions, ...grammarQuestions];
  }, [vocabQuestions, grammarQuestions]);

  const handleSelect = (option: string) => {
    if (showResult) return;
    setSelectedOption(option);
    setShowResult(true);

    const question = questions[currentIndex];
    const correct = option === question.correctAnswer;
    const timeMs = Date.now() - questionStartRef.current;
    setResults(prev => [...prev, { correct, question }]);

    logEvent('quiz_answer', {
      questionId: question.id,
      questionType: question.type,
      correct,
      prompt: question.prompt,
      selectedOption: option,
      correctAnswer: question.correctAnswer,
      allOptions: question.options,
      wordOrigin: question.wordOrigin || null,
      timeMs,
    }, articleId);
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowResult(false);
      questionStartRef.current = Date.now();
    } else {
      setQuizDone(true);
      const wrongWords = results
        .filter(r => !r.correct)
        .map(r => r.question.prompt);
      if (wrongWords.length > 0) {
        onWrongAnswers(wrongWords);
      }

      const allResults = results;
      const correct = allResults.filter(r => r.correct).length;
      const total = allResults.length;
      const hanjaResults = allResults.filter(r => r.question.wordOrigin === '한자어');
      const goyuResults = allResults.filter(r => r.question.wordOrigin === '고유어');
      const grammarResults = allResults.filter(r =>
        r.question.type === 'grammar_to_chinese' || r.question.type === 'chinese_to_grammar'
      );

      logEvent('quiz_complete', {
        correct,
        total,
        percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
        hanjaCorrect: hanjaResults.filter(r => r.correct).length,
        hanjaTotal: hanjaResults.length,
        goyuCorrect: goyuResults.filter(r => r.correct).length,
        goyuTotal: goyuResults.length,
        grammarCorrect: grammarResults.filter(r => r.correct).length,
        grammarTotal: grammarResults.length,
      }, articleId);
    }
  };

  const hasContent = selectedWords.length > 0 || grammarPatterns.length >= 2;

  if (loading && selectedWords.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-sm text-gray-500">Generating quiz questions...</p>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">No words selected</p>
        <p className="text-sm text-gray-400 mb-6">Select words in the script step first</p>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          Skip to Shadowing
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
          <p className="text-gray-500">{correctCount} / {total} correct</p>
        </div>

        {wrongVocab.length > 0 && (
          <div className="bg-red-50 rounded-lg p-4 mb-4 text-left">
            <h3 className="text-sm font-semibold text-red-700 mb-2">Wrong Words (saved to review)</h3>
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
            <h3 className="text-sm font-semibold text-orange-700 mb-2">Wrong Grammar</h3>
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
            <h3 className="text-sm font-semibold text-green-700 mb-2">Correct</h3>
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
          Go to Shadowing &rarr;
        </button>
      </div>
    );
  }

  const question = questions[currentIndex];
  if (!question) return null;

  const isGrammarType = question.type === 'grammar_to_chinese' || question.type === 'chinese_to_grammar';

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{currentIndex + 1}/{questions.length}</span>
      </div>

      <div className="mb-4">
        <span className={`text-xs px-2 py-1 rounded-full ${
          isGrammarType
            ? 'bg-purple-100 text-purple-700'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {TYPE_LABELS[question.type] || question.type}
        </span>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 text-center">
        <p className={`font-bold text-gray-900 ${isGrammarType ? 'text-xl' : 'text-2xl'}`}>
          {question.prompt}
        </p>
        <p className="text-sm text-gray-500 mt-2">{HINT_TEXT[question.type] || ''}</p>
      </div>

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

      {showResult && (
        <button
          onClick={handleNextQuestion}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          {currentIndex + 1 < questions.length ? 'Next Question' : 'View Results'}
        </button>
      )}
    </div>
  );
}

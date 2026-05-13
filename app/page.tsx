'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatTime, TOPIC_COLORS } from '@/lib/types';
import type { ArticleListItem } from '@/lib/types';
import ReviewStep from '@/components/ReviewStep';

type PageView = 'articles' | 'review';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Home() {
  const [view, setView] = useState<PageView>('articles');
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());

  useEffect(() => {
    async function fetchDates() {
      try {
        const res = await fetch('/api/dates');
        if (!res.ok) return;
        const data = await res.json();
        const dates: string[] = data.dates || [];
        setAvailableDates(new Set(dates));
        if (dates.length > 0 && !selectedDate) {
          setSelectedDate(dates[0]);
        }
      } catch {
        // ignored
      }
    }
    fetchDates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchArticles = useCallback(async (date: string) => {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles?date=${date}`);
      if (!res.ok) throw new Error('Failed to fetch articles');
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchArticles(selectedDate);
    }
  }, [selectedDate, fetchArticles]);

  const formatDateEnglish = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const generateCalendar = (month: Date) => {
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDay = new Date(year, m, 1).getDay();
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = new Array(firstDay).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      week.push(day);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  };

  const getDateStr = (day: number) => {
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const prevMonth = () => {
    setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const calendarMonthLabel = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  const weeks = generateCalendar(calendarMonth);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  if (view === 'review') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SRS Review</h1>
            <p className="text-sm text-gray-500 mt-1">Spaced Repetition System</p>
          </div>
          <button
            onClick={() => setView('articles')}
            className="text-sm px-4 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium"
          >
            &larr; Back to News
          </button>
        </header>
        <ReviewStep onDone={() => setView('articles')} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">JTBC News Study</h1>
          <p className="text-sm text-gray-500 mt-1">Learn Korean through news</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/stats"
            className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium"
          >
            Stats
          </a>
          <button
            onClick={() => setView('review')}
            className="text-sm px-3 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-medium"
          >
            SRS Review
          </button>
        </div>
      </header>

      {/* Calendar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-800">{calendarMonthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {DAY_LABELS.map((label) => (
            <div key={label} className="text-center text-xs text-gray-400 py-1 font-medium">
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              if (day === null) {
                return <div key={di} className="p-1" />;
              }
              const dateStr = getDateStr(day);
              const hasContent = availableDates.has(dateStr);
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === todayStr;

              return (
                <button
                  key={di}
                  onClick={() => hasContent && handleDateSelect(dateStr)}
                  disabled={!hasContent}
                  className={`
                    relative p-1 flex flex-col items-center justify-center rounded-lg text-sm transition-all
                    ${isSelected
                      ? 'bg-blue-600 text-white font-bold'
                      : hasContent
                        ? 'text-gray-900 hover:bg-blue-50 font-medium cursor-pointer'
                        : 'text-gray-300 cursor-default'
                    }
                    ${isToday && !isSelected ? 'ring-2 ring-blue-300 ring-inset' : ''}
                  `}
                >
                  <span className="leading-7">{day}</span>
                  {hasContent && !isSelected && (
                    <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-500" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedDate && (
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            {formatDateEnglish(selectedDate)} Broadcast
          </h2>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          {error}
        </div>
      )}

      {!loading && !error && articles.length === 0 && selectedDate && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No news for this date</p>
          <p className="text-sm">Select a marked date on the calendar</p>
        </div>
      )}

      {!loading && !selectedDate && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No news content yet</p>
          <p className="text-sm">Auto-collected daily at 11 PM KST</p>
        </div>
      )}

      <div className="space-y-3">
        {articles.map((article) => {
          const durationSec = Math.round(article.endTime - article.startTime);
          const mins = Math.floor(durationSec / 60);
          const secs = durationSec % 60;
          return (
            <a
              key={article.id}
              href={`/study/${article.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0">
                  {formatTime(article.startTime)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TOPIC_COLORS[article.topic] || 'bg-gray-100 text-gray-600'}`}>
                      {article.topic}
                    </span>
                    <span className="text-xs text-gray-400">{article.reporter ? `Reporter: ${article.reporter}` : ''}</span>
                  </div>

                  <h3 className="text-sm font-medium text-gray-900 leading-snug">
                    {article.title}
                  </h3>

                  <p className="text-xs text-gray-400 mt-1">
                    {mins}m {secs}s
                  </p>
                </div>

                <div className="text-gray-300 mt-1 shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

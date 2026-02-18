'use client';

import { useState, useEffect } from 'react';
import { formatTime, TOPIC_COLORS } from '@/lib/types';
import type { ArticleListItem } from '@/lib/types';
import ReviewStep from '@/components/ReviewStep';

type PageView = 'review' | 'articles';

export default function Home() {
  const [view, setView] = useState<PageView>('review');
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newsDate, setNewsDate] = useState<string>('');

  useEffect(() => {
    async function fetchArticles() {
      try {
        const res = await fetch('/api/articles');
        if (!res.ok) throw new Error('Failed to fetch articles');
        const data = await res.json();
        setArticles(data.articles || []);
        if (data.articles?.length > 0) {
          setNewsDate(data.articles[0].newsDate);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchArticles();
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  // Step 0: 복습
  if (view === 'review') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">JTBC 新闻学习</h1>
          <p className="text-sm text-gray-500 mt-1">通过新闻学韩语</p>
        </header>

        <ReviewStep onDone={() => setView('articles')} />
      </div>
    );
  }

  // Step 1: 今日新闻列表
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* 头部 */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">JTBC 新闻学习</h1>
        <p className="text-sm text-gray-500 mt-1">通过新闻学韩语</p>
      </header>

      {/* 날짜 */}
      {newsDate && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800">
            {formatDate(newsDate)} 新闻联播
          </h2>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* 기사 없음 */}
      {!loading && !error && articles.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">暂无新闻内容</p>
          <p className="text-sm">每晚11点(韩国时间)自动采集</p>
        </div>
      )}

      {/* 기사 목록 */}
      <div className="space-y-3">
        {articles.map((article) => (
          <a
            key={article.id}
            href={`/study/${article.id}`}
            className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start gap-3">
              {/* 타임스탬프 */}
              <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0">
                {formatTime(article.startTime)}
              </div>

              <div className="flex-1 min-w-0">
                {/* 토픽 배지 + 기자 */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TOPIC_COLORS[article.topic] || 'bg-gray-100 text-gray-600'}`}>
                    {article.topic}
                  </span>
                  <span className="text-xs text-gray-400">{article.reporter ? `记者 ${article.reporter}` : ''}</span>
                </div>

                {/* 제목 */}
                <h3 className="text-sm font-medium text-gray-900 leading-snug">
                  {article.title}
                </h3>

                {/* 길이 표시 */}
                <p className="text-xs text-gray-400 mt-1">
                  {Math.round((article.endTime - article.startTime) / 60)}分{Math.round((article.endTime - article.startTime) % 60)}秒
                </p>
              </div>

              {/* 화살표 */}
              <div className="text-gray-300 mt-1 shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

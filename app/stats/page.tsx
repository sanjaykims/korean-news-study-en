'use client';

import { useState, useEffect } from 'react';

interface StatsData {
  totalWords: number;
  totalArticles: number;
  totalBroadcasts: number;
  studyDays: number;
  streak: number;
  masteryDist: number[];
  originDist: Record<string, number>;
  last30: { date: string; sessions: number }[];
  weakest: { word: string; mastery: number; reviews: number }[];
  dueCount: number;
  totalReports: number;
}

const MASTERY_LABELS = ['新词', '初识', '熟悉', '掌握', '巩固', '精通'];
const MASTERY_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
const ORIGIN_COLORS: Record<string, string> = {
  '한자어': '#3b82f6',
  '고유어': '#22c55e',
  '외래어': '#f59e0b',
  '혼종어': '#a855f7',
  '미분류': '#6b7280',
};

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-red-500">统计数据加载失败</p>
        <a href="/" className="text-blue-600 text-sm mt-4 inline-block">← 返回首页</a>
      </div>
    );
  }

  const maxSessions = Math.max(1, ...stats.last30.map(d => d.sessions));
  const totalOrigin = Object.values(stats.originDist).reduce((a, b) => a + b, 0) || 1;
  const totalMastery = stats.masteryDist.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">学习统计</h1>
          <p className="text-sm text-gray-500 mt-1">Learning Statistics</p>
        </div>
        <a href="/" className="text-sm px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium">
          ← 首页
        </a>
      </header>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <MetricCard value={stats.totalWords} label="已学单词" sub="Total Words" color="text-blue-600" />
        <MetricCard value={stats.streak} label="连续学习天数" sub="Day Streak" color="text-amber-600" />
        <MetricCard value={stats.studyDays} label="学习天数" sub="Study Days" color="text-green-600" />
        <MetricCard value={stats.dueCount} label="待复习" sub="Due for Review" color="text-red-500" />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <a href="/" className="block bg-white rounded-xl border border-gray-200 p-4 text-center hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="text-2xl font-bold text-gray-900">{stats.totalBroadcasts}</div>
          <div className="text-xs text-gray-500 mt-1">收录节目 Broadcasts</div>
        </a>
        <a href="/" className="block bg-white rounded-xl border border-gray-200 p-4 text-center hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="text-2xl font-bold text-gray-900">{stats.totalArticles}</div>
          <div className="text-xs text-gray-500 mt-1">新闻条目 Articles</div>
        </a>
      </div>

      {/* Activity Heatbar - Last 30 Days */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">最近30天学习活动</h2>
        <div className="flex items-end gap-[3px] h-20">
          {stats.last30.map((d) => {
            const h = d.sessions > 0 ? Math.max(8, (d.sessions / maxSessions) * 100) : 0;
            const day = new Date(d.date + 'T00:00:00').getDate();
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.sessions} sessions`}>
                {d.sessions > 0 && (
                  <div
                    className="w-full rounded-sm bg-blue-500 transition-all"
                    style={{
                      height: `${h}%`,
                      opacity: 0.4 + (d.sessions / maxSessions) * 0.6,
                    }}
                  />
                )}
                {d.sessions === 0 && (
                  <div className="w-full h-1 rounded-sm bg-gray-100" />
                )}
                {(day === 1 || day === 10 || day === 20) && (
                  <span className="text-[9px] text-gray-400 mt-1">{day}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-gray-400">
          <span>{stats.last30[0]?.date.slice(5)}</span>
          <span>{stats.last30[stats.last30.length - 1]?.date.slice(5)}</span>
        </div>
      </section>

      {/* Mastery Distribution */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          掌握程度分布
          <span className="text-xs text-gray-400 font-normal ml-2">Mastery</span>
        </h2>
        <div className="space-y-2">
          {stats.masteryDist.map((count, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10 shrink-0">{MASTERY_LABELS[i]}</span>
              <div className="flex-1 h-6 bg-gray-50 rounded-full overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(count > 0 ? 3 : 0, (count / totalMastery) * 100)}%`,
                    backgroundColor: MASTERY_COLORS[i],
                    opacity: 0.8,
                  }}
                />
                {count > 0 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-600">
                    {count}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Word Origin Distribution */}
      {Object.keys(stats.originDist).length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            词汇来源分布
            <span className="text-xs text-gray-400 font-normal ml-2">Word Origin</span>
          </h2>
          {/* Stacked bar */}
          <div className="h-8 rounded-full overflow-hidden flex mb-3">
            {Object.entries(stats.originDist)
              .sort((a, b) => b[1] - a[1])
              .map(([origin, count]) => (
                <div
                  key={origin}
                  className="h-full flex items-center justify-center"
                  style={{
                    width: `${(count / totalOrigin) * 100}%`,
                    backgroundColor: ORIGIN_COLORS[origin] || '#6b7280',
                    opacity: 0.75,
                    minWidth: count > 0 ? '20px' : 0,
                  }}
                  title={`${origin}: ${count}`}
                >
                  {(count / totalOrigin) > 0.08 && (
                    <span className="text-[10px] text-white font-bold">{count}</span>
                  )}
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.originDist)
              .sort((a, b) => b[1] - a[1])
              .map(([origin, count]) => (
                <div key={origin} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: ORIGIN_COLORS[origin] || '#6b7280' }}
                  />
                  <span className="text-xs text-gray-600">{origin} ({count})</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Weakest Words */}
      {stats.weakest.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            最薄弱的单词
            <span className="text-xs text-gray-400 font-normal ml-2">Weakest</span>
          </h2>
          <div className="space-y-1.5">
            {stats.weakest.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg bg-gray-50">
                <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
                <span className="font-medium text-gray-900 flex-1">{w.word}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{
                  backgroundColor: `${MASTERY_COLORS[w.mastery]}20`,
                  color: MASTERY_COLORS[w.mastery],
                }}>
                  {MASTERY_LABELS[w.mastery]}
                </span>
                <span className="text-xs text-gray-400">{w.reviews}次</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SRS Review CTA */}
      {stats.dueCount > 0 && (
        <a
          href="/?view=review"
          className="block w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-center rounded-xl font-semibold transition-colors"
        >
          开始复习 · {stats.dueCount}个待复习单词
        </a>
      )}
    </div>
  );
}

function MetricCard({ value, label, sub, color }: { value: number; label: string; sub: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-700 mt-1 font-medium">{label}</div>
      <div className="text-[10px] text-gray-400">{sub}</div>
    </div>
  );
}

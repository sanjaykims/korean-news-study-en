'use client';

import { useRef, useState } from 'react';
import type { NewsArticle, SelectedItem } from '@/lib/types';
import { logEvent } from '@/lib/events';

interface Props {
  article: NewsArticle;
  articleId: string;
  selectedWords: SelectedItem[];
}

// 보고서 버튼 — PDF 생성 (jspdf + html2canvas)
// 출력 내용:
//   1) 헤더: 뉴스 날짜, 제목, 토픽 카테고리
//   2) 전체 스크립트 (proofreadScript 우선, 없으면 세그먼트 결합)
//   3) 선택 단어 목록 (한국어 ↔ 중국어 병기)
//   4) 보고서 생성 시각 (로컬 타임존)
// 학습 이벤트로 'report_generated' 기록 (user_id='yaofang', 타임스탬프는 DB created_at)
export default function ReportButton({ article, articleId, selectedWords }: Props) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  const fullScript =
    article.proofreadScript?.trim() ||
    (article.transcriptSegments || []).map((s) => s.text).join(' ') ||
    '(전사본 없음)';

  const now = new Date();
  const generatedAtLocal = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  async function generatePdf() {
    if (!reportRef.current || generating) return;
    setGenerating(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      const node = reportRef.current;
      // 화면 밖에 있던 DOM을 잠시 보이게 하여 정확한 크기로 캡처
      node.style.left = '0';
      node.style.top = '0';
      node.style.visibility = 'visible';

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      node.style.left = '-9999px';
      node.style.visibility = 'hidden';

      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      // A4 사이즈 mm 기준
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();
      const marginMm = 10;
      const usableWidthMm = pageWidthMm - marginMm * 2;

      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const fullImgHeightMm = (imgHeightPx * usableWidthMm) / imgWidthPx;

      let heightLeftMm = fullImgHeightMm;
      let positionMm = marginMm;

      pdf.addImage(imgData, 'JPEG', marginMm, positionMm, usableWidthMm, fullImgHeightMm);
      heightLeftMm -= pageHeightMm - marginMm * 2;

      while (heightLeftMm > 0) {
        positionMm = marginMm - (fullImgHeightMm - heightLeftMm);
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', marginMm, positionMm, usableWidthMm, fullImgHeightMm);
        heightLeftMm -= pageHeightMm - marginMm * 2;
      }

      const safeTitle = article.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      const fileName = `야오팡-${article.newsDate}-${safeTitle}.pdf`;
      pdf.save(fileName);

      // 누가/언제 보고서를 만들었는지 기록 (DB created_at + user_id='yaofang')
      logEvent(
        'report_generated',
        {
          articleTitle: article.title,
          articleDate: article.newsDate,
          topic: article.topic,
          selectedWordCount: selectedWords.length,
          generatedAtLocal,
          fileName,
        },
        articleId,
      );
    } catch (e) {
      console.error('[report] PDF 생성 실패', e);
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={generatePdf}
        disabled={generating}
        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-semibold transition-colors"
        title="生成学习报告 (PDF)"
      >
        {generating ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <span>生成中…</span>
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>报告 PDF</span>
          </>
        )}
      </button>

      {/* PDF 렌더링 대상 — 화면 밖에 위치, html2canvas로 캡처 */}
      <div
        ref={reportRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '794px', // ≒ A4 96dpi
          padding: '40px',
          background: '#ffffff',
          color: '#111111',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK KR", "Noto Sans CJK SC", system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: 1.6,
          visibility: 'hidden',
          zIndex: -1,
        }}
        aria-hidden="true"
      >
        <div style={{ borderBottom: '2px solid #111', paddingBottom: '12px', marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#666', letterSpacing: '0.05em', marginBottom: '4px' }}>
            야오팡 · JTBC 뉴스 학습 보고서
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 700, color: '#111' }}>
            {article.title}
          </h1>
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#444' }}>
            <span>📅 방송일 · {article.newsDate}</span>
            {article.topic && <span>🏷 카테고리 · {article.topic}</span>}
            {article.reporter && <span>🎙 기자 · {article.reporter}</span>}
          </div>
        </div>

        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#1d4ed8', marginBottom: '8px', borderLeft: '4px solid #1d4ed8', paddingLeft: '8px' }}>
            1. 전체 스크립트 (全文)
          </h2>
          <p style={{ whiteSpace: 'pre-wrap', textAlign: 'justify', margin: 0, color: '#222' }}>
            {fullScript}
          </p>
        </section>

        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#059669', marginBottom: '8px', borderLeft: '4px solid #059669', paddingLeft: '8px' }}>
            2. 단어장 (词汇表) · {selectedWords.length}
          </h2>
          {selectedWords.length === 0 ? (
            <p style={{ color: '#888', fontStyle: 'italic', margin: 0 }}>选择的单词没有 (선택한 단어 없음)</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ddd', width: '8%' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ddd', width: '24%' }}>한국어</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ddd', width: '20%' }}>한자</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ddd', width: '20%' }}>中文</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ddd', width: '28%' }}>의미 / 含义</th>
                </tr>
              </thead>
              <tbody>
                {selectedWords.map((w, i) => (
                  <tr key={`${w.text}-${i}`}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', color: '#888' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontWeight: 600, color: '#111' }}>{w.text}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', color: '#666' }}>{w.hanja || '—'}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', color: '#059669', fontWeight: 600 }}>{w.chinese || '—'}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', color: '#444' }}>{w.meaning || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div style={{ marginTop: '32px', paddingTop: '12px', borderTop: '1px solid #ddd', fontSize: '11px', color: '#888', display: 'flex', justifyContent: 'space-between' }}>
          <span>报告生成时间 · {generatedAtLocal}</span>
          <span>yaofang-news-study.vercel.app</span>
        </div>
      </div>
    </>
  );
}

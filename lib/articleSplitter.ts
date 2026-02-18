// 뉴스 대본 분할기 — JTBC 전용

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface SplitArticle {
  reporter: string;
  content: string;
  startTime: number | null;
  endTime: number | null;
  articleOrder: number;
}

// JTBC 종료 패턴
const JTBC_END_PATTERNS: RegExp[] = [
  /JTBC\s*뉴스룸?\s*,?\s*([가-힣]{2,4})\s*입니다/,
  /JTBC\s*,?\s*([가-힣]{2,4})\s*입니다/,
  /지금까지\s*([가-힣]{2,4})\s*이?었습니다/,
];

// 기사 시작 패턴
const START_PATTERNS = [
  /([가-힣]{2,4})\s*기자가\s*보도합니다/,
  /([가-힣]{2,4})\s*기자가\s*전합니다/,
  /([가-힣]{2,4})\s*기자가\s*취재했습니다/,
  /([가-힣]{2,4})\s*기자가\s*알아봤습니다/,
  /([가-힣]{2,4})\s*기자가\s*전해드립니다/,
  /([가-힣]{2,4})\s*기자의\s*보도입니다/,
  /([가-힣]{2,4})\s*기자입니다/,
];

function findEnd(text: string): { match: RegExpExecArray | null } {
  let best: RegExpExecArray | null = null;

  for (const pattern of JTBC_END_PATTERNS) {
    const m = pattern.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = m;
    }
  }

  // generic fallback
  if (!best) {
    const generic = /([가-힣]{2,4})\s*입니다\s*$/.exec(text);
    if (generic) best = generic;
  }

  return { match: best };
}

function findStart(text: string): { match: RegExpExecArray; reporter: string } | null {
  let best: RegExpExecArray | null = null;
  let bestReporter: string | null = null;

  for (const pattern of START_PATTERNS) {
    const m = pattern.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = m;
      bestReporter = m[1];
    }
  }

  if (!best || !bestReporter) return null;
  return { match: best, reporter: bestReporter };
}

/**
 * JTBC 뉴스 대본을 개별 기사로 분할
 */
export function splitArticles(
  transcript: TranscriptSegment[],
): SplitArticle[] {
  // 모든 세그먼트를 하나의 문자열로 합치면서 charIndex → segmentIndex 매핑
  let full = '';
  const charToSegment: Map<number, number> = new Map();

  for (let idx = 0; idx < transcript.length; idx++) {
    const startPos = full.length;
    full += transcript[idx].text + ' ';
    for (let p = startPos; p < full.length; p++) {
      charToSegment.set(p, idx);
    }
  }

  const articles: SplitArticle[] = [];
  let pos = 0;
  let order = 0;

  while (pos < full.length) {
    const remaining = full.slice(pos);
    const startResult = findStart(remaining);
    if (!startResult) break;

    const reporter = startResult.reporter;
    const articleStartCharPos = pos + startResult.match.index + startResult.match[0].length;

    const afterStart = full.slice(articleStartCharPos);
    const endResult = findEnd(afterStart);

    let articleEndCharPos: number;
    let content: string;

    if (endResult.match) {
      content = afterStart.slice(0, endResult.match.index).trim();
      articleEndCharPos = articleStartCharPos + endResult.match.index + endResult.match[0].length;
    } else {
      const nextStart = findStart(afterStart);
      if (nextStart) {
        articleEndCharPos = articleStartCharPos + nextStart.match.index;
        content = afterStart.slice(0, nextStart.match.index).trim();
      } else {
        content = afterStart.trim();
        articleEndCharPos = full.length;
      }
    }

    // charIndex → 비디오 타임스탬프
    const startSegIdx = charToSegment.get(articleStartCharPos);
    const startTime = startSegIdx !== undefined ? transcript[startSegIdx].start : null;

    let endTime: number | null = null;
    const endSegIdx = charToSegment.get(articleEndCharPos - 1);
    if (endSegIdx !== undefined) {
      endTime = transcript[endSegIdx].start + transcript[endSegIdx].duration;
    }

    // 최소 길이 필터
    if (content && content.length > 50) {
      articles.push({
        reporter,
        content,
        startTime,
        endTime,
        articleOrder: order++,
      });
    }

    pos = articleEndCharPos;
  }

  return articles;
}

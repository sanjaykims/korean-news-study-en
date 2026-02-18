// 뉴스 대본 분할기 — JTBC 전용
// Method 1: 기자 보도 패턴 (standard news format)
// Method 2: 시간 기반 분할 (TOP10, discussion formats)

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

// Method 1: 기자 패턴 기반 분할
function splitByReporterPatterns(transcript: TranscriptSegment[]): SplitArticle[] {
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

    const startSegIdx = charToSegment.get(articleStartCharPos);
    const startTime = startSegIdx !== undefined ? transcript[startSegIdx].start : null;

    let endTime: number | null = null;
    const endSegIdx = charToSegment.get(articleEndCharPos - 1);
    if (endSegIdx !== undefined) {
      endTime = transcript[endSegIdx].start + transcript[endSegIdx].duration;
    }

    if (content && content.length > 50) {
      articles.push({ reporter, content, startTime, endTime, articleOrder: order++ });
    }

    pos = articleEndCharPos;
  }

  return articles;
}

// Method 2: 시간 기반 분할 (3~5분 단위)
// TOP10, 토론, 해설 등 기자 패턴이 없는 포맷용
function splitByTime(transcript: TranscriptSegment[], targetMinutes: number = 4): SplitArticle[] {
  if (transcript.length === 0) return [];

  const totalDuration = transcript[transcript.length - 1].start + transcript[transcript.length - 1].duration;
  const targetDuration = targetMinutes * 60;
  const numArticles = Math.max(1, Math.round(totalDuration / targetDuration));

  const articles: SplitArticle[] = [];
  const segPerArticle = Math.ceil(transcript.length / numArticles);

  for (let i = 0; i < numArticles; i++) {
    const startIdx = i * segPerArticle;
    const endIdx = Math.min((i + 1) * segPerArticle, transcript.length);

    if (startIdx >= transcript.length) break;

    const segs = transcript.slice(startIdx, endIdx);
    const content = segs.map(s => s.text).join(' ').trim();

    // 음악, 빈 세그먼트 등 필터
    const cleanContent = content
      .replace(/\[음악\]/g, '')
      .replace(/>>/g, '')
      .trim();

    if (cleanContent.length > 50) {
      articles.push({
        reporter: `파트 ${i + 1}`,
        content: cleanContent,
        startTime: segs[0].start,
        endTime: segs[segs.length - 1].start + segs[segs.length - 1].duration,
        articleOrder: i,
      });
    }
  }

  return articles;
}

/**
 * JTBC 뉴스 대본을 개별 기사로 분할
 * 기자 패턴이 있으면 패턴 기반, 없으면 시간 기반 분할
 */
export function splitArticles(
  transcript: TranscriptSegment[],
): SplitArticle[] {
  // 먼저 기자 패턴 기반 분할 시도
  const byReporter = splitByReporterPatterns(transcript);
  if (byReporter.length >= 2) {
    return byReporter;
  }

  // Fallback: 시간 기반 분할 (4분 단위)
  return splitByTime(transcript, 4);
}

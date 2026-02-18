// ===== DB Row Types =====

export interface DbNewsVideo {
  id: string;
  youtube_id: string;
  title: string;
  broadcast_date: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  transcript_raw: { text: string; start: number; duration: number }[] | null;
  ingested_at: string;
  created_at: string;
}

export interface DbNewsArticle {
  id: string;
  video_id: string;
  title: string;
  reporter_name: string | null;
  topic: string | null;
  start_time: number;
  end_time: number;
  transcript_original: { text: string; start: number; end: number }[] | null;
  transcript_proofread: string | null;
  article_order: number;
  created_at: string;
}

// ===== Frontend Types =====

export interface NewsArticle {
  id: string;
  title: string;
  reporter: string;
  topic: string;
  videoId: string;
  startTime: number;
  endTime: number;
  newsDate: string;
  thumbnailUrl: string;
  // 원본 전사 세그먼트 (타임스탬프 포함)
  transcriptSegments?: { text: string; start: number; end: number }[];
  // Claude가 교정한 전체 스크립트
  proofreadScript?: string;
}

// 기사 목록 아이템 (홈페이지용)
export interface ArticleListItem {
  id: string;
  title: string;
  reporter: string;
  topic: string;
  startTime: number;
  endTime: number;
  newsDate: string;
}

// 토픽 매핑
export const TOPIC_MAP: Record<string, string> = {
  '정치': 'politics',
  '경제': 'economy',
  '사회': 'society',
  '국제': 'international',
};

export const TOPIC_COLORS: Record<string, string> = {
  '정치': 'bg-red-100 text-red-700',
  '경제': 'bg-green-100 text-green-700',
  '사회': 'bg-blue-100 text-blue-700',
  '국제': 'bg-purple-100 text-purple-700',
};

// 한자어 분석 결과
export interface HanjaWord {
  word: string;
  hanja: string;
  chinese: string;
  meaning: string;
  isFalseFriend: boolean;
  falseFriendNote?: string;
}

// 문법 패턴 (뉴스 특화)
export interface GrammarPattern {
  pattern: string;
  meaning: string;
  chineseMeaning: string;
  example: string;
}

// 스크립트 학습에서 사용자가 선택한 단어/구문
export interface SelectedItem {
  text: string;
  hanja?: string;
  chinese?: string;
  meaning?: string;
  type: 'word' | 'phrase' | 'sentence';
}

// 퀴즈 문제
export interface QuizQuestion {
  koreanText: string;
  correctAnswer: string;
  options: string[];
  type: 'chinese_to_korean' | 'korean_to_chinese' | 'grammar_to_chinese' | 'chinese_to_grammar';
}

// 쉐도잉 결과
export interface ShadowingResult {
  sentenceIndex: number;
  sentence: string;
  score: number;
  feedback?: string;
}

// 문장 은행 (틀린 퀴즈 + 낮은 쉐도잉 점수)
export interface SentenceBankItem {
  id: string;
  sentence: string;
  source: 'quiz' | 'shadowing';
  score?: number;
  createdAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
}

// 스터디 세션
export interface StudySession {
  id: string;
  articleId: string;
  currentStep: StudyStep;
  selectedWords: SelectedItem[];
  quizResults?: { correct: number; total: number };
  shadowingResults?: ShadowingResult[];
  startedAt: string;
  completedAt?: string;
}

// 학습 단계
export type StudyStep =
  | 'video'     // Step 2: 영상 시청
  | 'script'    // Step 3: 스크립트 학습
  | 'quiz'      // Step 4: 퀴즈
  | 'shadowing'; // Step 5: 쉐도잉 + 발음 체크

// 시간 포맷 유틸리티
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

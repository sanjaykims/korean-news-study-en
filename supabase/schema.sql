-- 야오팡 뉴스 스터디 — Supabase Schema
-- JTBC 전용, 한자어 브릿지 학습

-- 뉴스 영상 (JTBC 뉴스룸 풀영상)
CREATE TABLE IF NOT EXISTS news_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  broadcast_date DATE NOT NULL,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  transcript_raw JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_videos_date ON news_videos(broadcast_date DESC);

-- 개별 뉴스 기사
CREATE TABLE IF NOT EXISTS news_articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES news_videos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reporter_name TEXT,
  topic TEXT DEFAULT '사회',
  start_time FLOAT NOT NULL DEFAULT 0,
  end_time FLOAT NOT NULL DEFAULT 0,
  transcript_original JSONB,
  transcript_proofread TEXT,
  article_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_articles_video ON news_articles(video_id);

-- 문장 은행 (틀린 퀴즈 + 낮은 쉐도잉 점수)
CREATE TABLE IF NOT EXISTS sentence_bank (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sentence TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('quiz', 'shadowing')),
  source_article_id UUID REFERENCES news_articles(id),
  score FLOAT,
  review_count INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 학습 세션 기록
CREATE TABLE IF NOT EXISTS study_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES news_articles(id),
  selected_words JSONB DEFAULT '[]',
  quiz_correct INTEGER DEFAULT 0,
  quiz_total INTEGER DEFAULT 0,
  shadowing_results JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_study_sessions_article ON study_sessions(article_id);

-- 어휘 로그 (선택한 단어들 누적)
CREATE TABLE IF NOT EXISTS vocabulary_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  word TEXT NOT NULL,
  hanja TEXT,
  chinese TEXT,
  meaning TEXT,
  source_article_id UUID REFERENCES news_articles(id),
  review_count INTEGER DEFAULT 0,
  mastery_level INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vocabulary_word ON vocabulary_log(word);

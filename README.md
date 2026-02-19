# yaofang-news-study

Chinese→Korean news-based learning app. Learn Korean through daily JTBC TV news broadcasts with Chinese-speaker-optimized vocabulary analysis, grammar patterns, quizzes, and shadowing practice. Content auto-updates daily via Vercel cron. Single-user (Chinese learner).

## Tech Stack

- **Next.js 14** — App Router, TypeScript, Tailwind CSS
- **Supabase** — PostgreSQL database (video/article/vocabulary/analytics storage)
- **Claude API (Sonnet)** — Word analysis, grammar extraction, quiz generation, transcript proofreading
- **YouTube IFrame API** — News video playback with segment control
- **Vercel** — Hosting, serverless functions, edge runtime, cron scheduling

## Getting Started

```bash
git clone https://github.com/<your-user>/yaofang-news-study.git
cd yaofang-news-study
npm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.local.example .env.local
```

Required environment variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (frontend reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (API route writes) |
| `ANTHROPIC_API_KEY` | Claude API for word/grammar/quiz generation |
| `CRON_SECRET` | Vercel cron authentication |
| `FISH_AUDIO_API_KEY` | Fish Audio TTS (optional) |
| `SPEECHSUPER_APP_KEY` | SpeechSuper pronunciation assessment (optional) |
| `SPEECHSUPER_SECRET_KEY` | SpeechSuper secret key (optional) |

Set up the database by running `supabase/schema.sql` against your Supabase project.

Start the dev server:

```bash
npm run dev      # localhost:3000
npm run build    # Production build
npm run lint     # ESLint + TypeScript checking
```

## Project Structure

```
app/
├── page.tsx                        # Homepage: article list by date + vocabulary review
├── admin/page.tsx                  # Admin: ingest management
├── study/[articleId]/page.tsx      # 4-step study flow orchestrator
└── api/                            # API routes (see below)
components/
├── VideoStep.tsx                   # Step 1: video playback + analytics
├── ScriptStep.tsx                  # Step 2: script reading + word/grammar interaction
├── QuizStep.tsx                    # Step 3: quiz with distractor analysis
├── ShadowingStep.tsx               # Step 4: record + self-evaluate + rerecord tracking
└── ReviewStep.tsx                  # Review stage
lib/
├── types.ts                        # TypeScript interfaces (NewsArticle, GrammarPattern, etc.)
├── events.ts                       # Fire-and-forget analytics via logEvent()
├── supabase.ts                     # Supabase clients (anon + service role)
├── youtube.ts                      # useYouTubePlayer hook
├── youtubeTranscript.ts            # Multi-method transcript extraction
└── articleSplitter.ts              # News article boundary detection
scripts/
└── ingest.js                       # Local ingestion script (requires Korean IP)
supabase/
└── schema.sql                      # Database schema
```

Path alias: `@/*` maps to project root (configured in `tsconfig.json`).

## Study Flow

Each news article follows a 4-step learning cycle:

1. **观看视频 (VideoStep)** — Watch the original news clip via YouTube embed with start/end time boundaries
2. **脚本学习 (ScriptStep)** — Read the transcript, tap words for hanja/Chinese analysis, explore grammar patterns
3. **测验 (QuizStep)** — 4-option multiple choice quiz on selected vocabulary and grammar (bidirectional Chinese↔Korean)
4. **跟读 (ShadowingStep)** — Shadow each sentence, record yourself, self-rate pronunciation

The homepage lists articles by date and includes a vocabulary review section with mastery-ranked words.

## API Routes

### Content Ingestion

| Route | Description |
|---|---|
| `POST /api/ingest` | Manual ingestion of a specific video |
| `GET /api/auto-ingest` | Daily cron-triggered ingestion (14:00 UTC). Edge runtime on Seoul/Tokyo PoP |
| `GET /api/yt-proxy` | YouTube transcript proxy. Edge runtime for geo-bypass |
| `GET /api/youtube-search` | YouTube search helper |

### Claude-Powered

| Route | Description |
|---|---|
| `POST /api/analyze-word` | Word analysis: hanja, Chinese mapping, word origin (`한자어`/`고유어`/`외래어`/`혼종어`) |
| `POST /api/grammar` | Grammar pattern detection with `difficultyForChinese` rating |
| `POST /api/quiz` | Bidirectional Chinese↔Korean quiz question generation |

### Data Persistence

| Route | Description |
|---|---|
| `POST /api/vocabulary` | Save selected words (deduplicates by word) |
| `POST /api/sentence-bank` | Save wrong quiz answers + low shadowing scores |
| `POST /api/events` | Learning analytics event ingestion |

### Reads

| Route | Description |
|---|---|
| `GET /api/articles` | List articles by date |
| `GET /api/articles/[id]` | Single article detail |
| `GET /api/review` | Mastery-ranked vocabulary for review |

## Database Schema

Supabase PostgreSQL. Schema defined in `supabase/schema.sql`.

| Table | Description |
|---|---|
| `news_videos` | JTBC broadcast metadata: YouTube ID, title, date, duration, `transcript_raw` (JSONB timestamped segments) |
| `news_articles` | Individual articles split from broadcasts: title, reporter, topic, start/end time boundaries, proofread transcript |
| `vocabulary_log` | Personal vocabulary with SRS: word, hanja, Chinese mapping, mastery level, review count |
| `sentence_bank` | Wrong quiz answers + low shadowing scores, with source tracking (`quiz` or `shadowing`) |
| `study_sessions` | Per-article session records: selected words, quiz scores, shadowing results |
| `learning_events` | All analytics events as JSONB payloads (see Learning Analytics below) |

## Learning Analytics

All user interactions are captured in the `learning_events` table. Single user (`user_id = 'yaofang'`), no auth overhead.

### Event Types

| Event | When | Key Payload Fields |
|---|---|---|
| `session_start` | Opens article | `articleTitle`, `topic`, `articleDate` |
| `session_complete` | Leaves article | `stagesCompleted[]`, `totalTimeMs` |
| `stage_enter` / `stage_complete` | Step transitions | `stage`, `durationMs` |
| `video_play` / `video_pause` | Video controls | `currentTime`, `watchedMs` |
| `video_replay` | Replays video | `replayCount` |
| `word_click` | Taps word in script | `word`, `wordOrigin`, `hanja`, `isFalseFriend` |
| `word_select` | Adds to study list | `word`, `wordOrigin`, `chinese` |
| `false_friend_seen` | False friend popup | `word`, `koreanMeaning`, `chineseMeaning` |
| `sentence_read_time` | Moves between sentences | `sentenceIndex`, `durationMs`, `wordCount` |
| `grammar_analyze` | Clicks grammar button | `sentenceCount` |
| `grammar_select` | Toggles grammar pattern | `pattern`, `difficultyForChinese` |
| `quiz_answer` | Selects quiz option | `questionType`, `correct`, `selectedOption`, `allOptions`, `wordOrigin`, `timeMs` |
| `quiz_complete` | Finishes quiz | `hanjaCorrect/Total`, `goyuCorrect/Total`, `grammarCorrect/Total` |
| `shadowing_record` | Records a sentence | `sentenceIndex`, `recordingDurationMs`, `rerecordCount` |
| `shadowing_score` | Self-rates pronunciation | `sentenceIndex`, `score` |
| `shadowing_complete` | All sentences done | `avgScore`, `lowScoreCount`, `sentenceScores[]` |

### Chinese-Learner-Specific Fields

- **`wordOrigin`** — Every word tagged as `한자어` (Sino-Korean), `고유어` (native Korean), `외래어` (loanword), or `혼종어` (hybrid). Enables quiz accuracy analysis by word origin.
- **`difficultyForChinese`** — Grammar patterns rated `high`/`medium`/`low` for Chinese speakers (particles and conjugation = high, Sino-Korean structures = low).
- **`isFalseFriend`** — Words using same hanja but different meaning in Chinese vs Korean.
- **`rerecordCount`** — How many times the user re-records before moving on (pronunciation struggle indicator).

### Example Analytics Queries

```sql
-- Quiz accuracy by word origin (the core Chinese-learner metric)
SELECT payload->>'wordOrigin',
       AVG(CASE WHEN (payload->>'correct')::boolean THEN 1 ELSE 0 END) as accuracy
FROM learning_events WHERE event_type = 'quiz_answer'
GROUP BY 1;

-- False friend failure rate
SELECT payload->>'word', COUNT(*) as encounters
FROM learning_events
WHERE event_type = 'false_friend_seen'
GROUP BY 1 ORDER BY 2 DESC;

-- Stage drop-off funnel
SELECT payload->>'stage', COUNT(DISTINCT session_id)
FROM learning_events WHERE event_type = 'stage_enter'
GROUP BY 1;

-- Most-clicked words
SELECT payload->>'word', payload->>'wordOrigin', COUNT(*) as clicks
FROM learning_events WHERE event_type = 'word_click'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30;

-- Shadowing struggle spots
SELECT payload->>'sentence', AVG((payload->>'rerecordCount')::int) as avg_retries
FROM learning_events WHERE event_type = 'shadowing_record'
GROUP BY 1 HAVING AVG((payload->>'rerecordCount')::int) > 2
ORDER BY 2 DESC;
```

## Deployment

### Vercel

The app deploys to Vercel. Configuration in `vercel.json`:

- **Daily cron** — `/api/auto-ingest` runs at 14:00 UTC every day to fetch that day's JTBC newsroom broadcast
- **Extended timeout** — Ingest routes have `maxDuration: 300` (5 minutes) for transcript extraction and Claude processing
- **Edge runtime** — `yt-proxy` and `auto-ingest` routes use edge runtime to run on Seoul/Tokyo PoPs, bypassing YouTube geo-restrictions from US servers

### Local Ingest

For manual ingestion (must run from a Korean IP to access YouTube transcripts):

```bash
node scripts/ingest.js                        # Today's date, auto-search JTBC
node scripts/ingest.js 2026-02-17             # Specific date
node scripts/ingest.js 2026-02-17 ZToYdGoUQGQ # Specific YouTube video ID
```

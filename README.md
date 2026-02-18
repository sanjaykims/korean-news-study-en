# yaofang-news-study

Chinese→Korean news-based learning app. Learn Korean through authentic JTBC TV news broadcasts with Chinese-speaker-optimized vocabulary analysis, grammar patterns, quizzes, and shadowing.

## Learning Flow

1. **观看视频** — Watch the original news clip (YouTube embed with start/end boundaries)
2. **脚本学习** — Read the script, tap words for hanja/Chinese analysis, analyze grammar patterns
3. **测验** — Quiz on selected vocabulary + grammar (4-option multiple choice, both directions)
4. **跟读** — Shadow each sentence, record yourself, self-rate pronunciation

## Tech Stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **Supabase** (PostgreSQL + Auth + Storage)
- **Claude API** (word analysis, grammar extraction, quiz generation, transcript proofreading)
- **YouTube IFrame API** (news video playback with segment control)
- **Vercel** (hosting, serverless API routes)

## Project Structure

```
app/
├── page.tsx                        # Homepage: article list by date
├── admin/page.tsx                  # Admin: ingest management
├── study/[articleId]/page.tsx      # 4-step study flow
└── api/
    ├── articles/                   # GET article list + detail
    ├── analyze-word/route.ts       # Claude: word analysis (hanja, Chinese, wordOrigin)
    ├── grammar/route.ts            # Claude: grammar pattern detection (difficultyForChinese)
    ├── quiz/route.ts               # Claude: quiz question generation
    ├── vocabulary/route.ts         # Save words to vocabulary_log
    ├── sentence-bank/route.ts      # Save wrong answers / low-score sentences
    ├── events/route.ts             # Learning analytics event ingestion
    ├── auto-ingest/route.ts        # JTBC 뉴스룸 auto-ingestion
    ├── ingest/route.ts             # Manual multi-broadcaster ingestion
    ├── youtube-search/route.ts     # YouTube search helper
    └── yt-proxy/route.ts           # YouTube transcript proxy (edge)
components/
├── VideoStep.tsx                   # Video playback + analytics
├── ScriptStep.tsx                  # Script reading + word/grammar interaction
├── QuizStep.tsx                    # Quiz with distractor analysis
├── ShadowingStep.tsx               # Record + self-evaluate + rerecord tracking
└── ReviewStep.tsx                  # Review stage
lib/
├── types.ts                        # TypeScript interfaces (NewsArticle, GrammarPattern, etc.)
├── events.ts                       # Learning analytics: logEvent() + session management
├── supabase.ts                     # Supabase client (anon + admin)
├── youtube.ts                      # useYouTubePlayer hook
├── youtubeTranscript.ts            # Multi-method transcript extraction
└── articleSplitter.ts              # News article boundary detection
```

## Learning Analytics

All user interactions are captured in a `learning_events` table for Chinese→Korean service planning. Single user (`user_id = 'yaofang'`), no auth overhead.

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
- **`rerecordCount`** — How many times user re-records before moving on (pronunciation struggle indicator).

### Key Analytics Queries

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

## Database

Supabase PostgreSQL. Key tables:

- `news_videos` — YouTube video metadata
- `news_articles` — Individual articles split from broadcasts
- `vocabulary_log` — Personal vocabulary with SRS (includes `user_id`, `word_origin`)
- `sentence_bank` — Wrong quiz answers + low shadowing scores (includes `user_id`)
- `learning_events` — All analytics events (JSONB payloads, indexed by type/article/session/time)

Migration SQL for the analytics table is in `supabase/schema.sql` (korean-news-learning repo).

## Development

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # Lint TypeScript
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...          # Claude API
NEXT_PUBLIC_SUPABASE_URL=...          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=...         # Supabase service role (server-side)
```

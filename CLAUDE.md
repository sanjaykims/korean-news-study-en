# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Korean learning platform (English UI) using JTBC newsroom material, daily automatic update. Global audience — all UI and explanations in English.

This is the **English version** — forked from the Chinese version (`yaofang-news-study`). The Chinese version targets Chinese native speakers with hanja bridge features; this version targets global English-speaking Korean learners.

## Commands

```bash
npm run dev      # Start dev server on localhost:3000
npm run build    # Production build
npm run lint     # ESLint + TypeScript checking
npm run start    # Start production server
```

Local ingest script (must run from a Korean IP to bypass YouTube geo-restrictions):
```bash
node scripts/ingest.js                        # Today's date, auto-search JTBC
node scripts/ingest.js 2026-02-17             # Specific date
node scripts/ingest.js 2026-02-17 ZToYdGoUQGQ # Specific YouTube video ID
```

## Architecture

**Stack:** Next.js 14 (App Router, TypeScript), Supabase (PostgreSQL), Claude API (Sonnet), Tailwind CSS, Vercel

### Study Flow (4-step per article)

`VideoStep` → `ScriptStep` → `QuizStep` → `ShadowingStep`

Each step is a React component in `components/`. The study page (`app/study/[articleId]/page.tsx`) orchestrates them. The homepage (`app/page.tsx`) lists articles by date and includes vocabulary review.

### API Routes (`app/api/`)

- **Content ingestion:** `ingest/` (manual POST), `auto-ingest/` (Vercel cron at 14:00 UTC), `yt-proxy/` (edge runtime, Seoul/Tokyo PoP for YouTube geo-bypass)
- **Claude-powered:** `analyze-word/` (hanja + English meaning + word origin), `grammar/` (pattern detection with English explanations), `quiz/` (bidirectional English↔Korean generation), `rewrite/` (multi-level news rewrites)
- **Data persistence:** `vocabulary/` (save selected words, dedup by word), `sentence-bank/` (wrong quiz answers + low shadowing scores), `events/` (analytics ingestion)
- **Reads:** `articles/` (list by date), `articles/[id]/` (single article), `review/` (mastery-ranked vocabulary), `stats/` (learning statistics)

### Data Model (Supabase)

Schema in `supabase/schema.sql`. Key tables:
- `news_videos` — broadcast metadata + `transcript_raw` (JSONB timestamped segments)
- `news_articles` — individual articles split from broadcasts (start/end time boundaries)
- `vocabulary_log` — SRS tracking with `word_origin` and `mastery_level`
- `sentence_bank` — wrong quiz answers + low shadowing scores
- `learning_events` — all analytics events (JSONB payloads)

### Key Libraries (`lib/`)

- `supabase.ts` — two clients: `getSupabaseClient()` (anon, frontend reads) and `getSupabaseAdmin()` (service role, API route writes)
- `types.ts` — all TypeScript interfaces. `WordOrigin` type (`한자어|고유어|외래어|혼종어`) is central to analytics
- `events.ts` — fire-and-forget analytics logger via `logEvent()`. Never blocks UI, silent on failure
- `youtubeTranscript.ts` — multi-method transcript extraction (npm package → Android Innertube → watch page scraping)
- `articleSplitter.ts` — splits full broadcast into individual news articles (reporter pattern + time fallback)

### Path Alias

`@/*` maps to project root (configured in `tsconfig.json`).

## Important Patterns

- **All UI text is in English** — this is the global version
- **Edge runtime** is used for `yt-proxy` and `auto-ingest` routes to run on Cloudflare Seoul/Tokyo PoPs, bypassing US YouTube geo-restrictions
- **Vercel cron** triggers `/api/auto-ingest` daily; authenticated via `CRON_SECRET` header
- **Analytics are fire-and-forget** — `logEvent()` uses `fetch()` without awaiting; never block the study UX
- **Word origin fields** (`wordOrigin`, `isFalseFriend`) still use Korean category names internally (한자어/고유어/외래어/혼종어) for DB compatibility with the Chinese version
- **API prompts generate English content** — analyze-word returns English meanings, quiz generates English↔Korean questions, grammar explanations are in English

## Environment Variables

See `.env.local.example`. Required for development:
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase public access
- `SUPABASE_SERVICE_ROLE_KEY` — server-side writes (API routes only)
- `ANTHROPIC_API_KEY` — Claude API for word/grammar/quiz generation
- `CRON_SECRET` — Vercel cron authentication

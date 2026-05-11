# JTBC Transcript Proxy (Cloudflare Worker)

This worker proxies YouTube transcript extraction so the main app
(running on Vercel/US) can ingest JTBC 뉴스룸 videos without
geo-restrictions.

## Deploy

```bash
# Install Wrangler CLI (one-time)
npm install -g wrangler

# Authenticate
wrangler login

# Deploy
cd cloudflare-worker
wrangler deploy
```

After deploy you'll get a URL like:
`https://jtbc-transcript-proxy.<your-account>.workers.dev`

## Connect to Vercel

1. Go to your Vercel project → Settings → Environment Variables
2. Add: `TRANSCRIPT_PROXY_URL` = the worker URL above
3. Redeploy

## Test

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"videoId":"ZToYdGoUQGQ"}'
```

Should return JSON with `transcript`, `chapters`, `title`, `durationSeconds`.

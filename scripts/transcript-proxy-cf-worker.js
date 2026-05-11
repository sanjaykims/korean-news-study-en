/**
 * Cloudflare Worker — JTBC transcript proxy (via Supadata)
 *
 * Primary: Supadata API for transcript extraction (paid third-party, reliable).
 * Fallback: Direct YouTube scraping (kept for safety; usually fails now due to PO tokens).
 * Metadata (title, duration, chapters) still extracted from YouTube watch page.
 *
 * Setup:
 *   1. Sign up at https://supadata.ai and copy your API key
 *   2. In Cloudflare dashboard → Workers → this worker → Settings → Variables
 *      Add encrypted secret: SUPADATA_API_KEY = sd_...
 *   3. Set env var in Vercel: TRANSCRIPT_PROXY_URL=https://<worker>.workers.dev
 *
 * Update worker code:
 *   - Browser: paste this file into the worker editor in Cloudflare dashboard
 *   - CLI: wrangler deploy scripts/transcript-proxy-cf-worker.js --name <worker-name>
 *
 * API:
 *   POST / with JSON body: { videoId: "L9sS-d-h81U" }
 *   Returns: { transcript: [...], title, durationSeconds, description, chapters, method, errors }
 */

const COOKIE = 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB';
const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function cleanText(raw) {
  return raw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, ' ').trim();
}

function parseCaptionXml(xml) {
  const segments = [];
  const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRe.exec(xml)) !== null) {
    const text = cleanText(m[3]);
    if (text) segments.push({ text, start: parseInt(m[1]) / 1000, duration: parseInt(m[2]) / 1000 });
  }
  if (segments.length > 0) return segments;
  const tRe = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((m = tRe.exec(xml)) !== null) {
    const text = cleanText(m[3]);
    if (text) segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
  }
  return segments;
}

function parseJson3(body) {
  try {
    const json = JSON.parse(body);
    return (json?.events || []).filter(ev => ev.segs).map(ev => ({
      text: ev.segs.map(s => s.utf8 || '').join('').trim(),
      start: (ev.tStartMs || 0) / 1000,
      duration: (ev.dDurationMs || 0) / 1000,
    })).filter(s => s.text);
  } catch { return []; }
}

function parseChapters(description) {
  const chapters = [];
  for (const line of description.split('\n')) {
    const m = line.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})\s+(.+)/);
    if (m) {
      const hours = m[1] ? parseInt(m[1]) : 0;
      chapters.push({ title: m[4].trim(), startSeconds: hours * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) });
    }
  }
  return chapters;
}

async function ytPost(path, body, ua = ANDROID_UA) {
  const res = await fetch('https://www.youtube.com' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'Cookie': COOKIE, 'Origin': 'https://www.youtube.com', 'Referer': 'https://www.youtube.com/' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ytGet(url, ua = BROWSER_UA) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'Cookie': COOKIE, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  return res.text();
}

async function tryFetchCaptions(tracks, ua) {
  const ko = tracks.find(t => t.languageCode === 'ko') || tracks[0];
  for (const fmt of ['srv3', 'json3', '']) {
    const url = fmt ? ko.baseUrl + (ko.baseUrl.includes('fmt=') ? '' : '&fmt=' + fmt) : ko.baseUrl;
    try {
      const body = await ytGet(url, ua);
      if (body && body.length > 100) {
        const segs = fmt === 'json3' ? parseJson3(body) : parseCaptionXml(body);
        if (segs.length > 0) return segs;
      }
    } catch { /* next */ }
  }
  return null;
}

async function extractMetadata(videoId) {
  // Get title, duration, chapters from YouTube watch page (still works for metadata).
  const errors = [];
  let title = '', durationSeconds = 0, description = '', chapters = [];

  try {
    const html = await ytGet('https://www.youtube.com/watch?v=' + videoId + '&bpctr=9999999999&has_verified=1&hl=ko&gl=KR');
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var|<\/script)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const d = data?.videoDetails || {};
      title = d.title || '';
      durationSeconds = parseInt(d.lengthSeconds || '0');
      description = d.shortDescription || '';
      chapters = parseChapters(description);
    } else {
      errors.push('META_WATCH: no ytInitialPlayerResponse');
    }
  } catch (e) { errors.push('META_WATCH: ' + e.message); }

  // Fallback: ANDROID client for metadata
  if (!title || !durationSeconds) {
    try {
      const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
        context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
        videoId, contentCheckOk: true, racyCheckOk: true,
      }, ANDROID_UA);
      const d = data?.videoDetails || {};
      if (!title) title = d.title || '';
      if (!durationSeconds) durationSeconds = parseInt(d.lengthSeconds || '0');
      if (!description) { description = d.shortDescription || ''; chapters = parseChapters(description); }
    } catch (e) { errors.push('META_ANDROID: ' + e.message); }
  }

  return { title, durationSeconds, description, chapters, errors };
}

async function fetchFromSupadata(videoId, apiKey) {
  // Supadata: GET /v1/transcript?url=...
  // Returns 200 with content (immediate) or 202 with jobId (async polling).
  const url = `https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=ko`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  let data;
  try { data = await res.json(); } catch { data = null; }

  if (!data) throw new Error(`Supadata returned non-JSON (HTTP ${res.status})`);
  if (data.error) throw new Error(`Supadata error: ${data.error} (${data.message || ''})`);

  // Async flow: poll job
  if (res.status === 202 && data.jobId) {
    return await pollSupadataJob(data.jobId, apiKey);
  }

  return data;
}

async function pollSupadataJob(jobId, apiKey) {
  const url = `https://api.supadata.ai/v1/transcript/${jobId}`;
  // Up to ~90s of polling (CF Worker has 30s CPU but unlimited wall clock for free tier).
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    const data = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(`Supadata job failed: ${data.error || 'unknown'}`);
  }
  throw new Error('Supadata job timeout after 90s');
}

function supadataToSegments(data) {
  // Supadata content format: array of { text, offset (ms), duration (ms), lang }
  if (!Array.isArray(data?.content)) return [];
  return data.content
    .map(c => ({
      text: (c.text || '').trim(),
      start: (c.offset || 0) / 1000,
      duration: (c.duration || 0) / 1000,
    }))
    .filter(s => s.text);
}

async function extractTranscript(videoId, env) {
  const errors = [];

  // Get metadata from YouTube watch page (still works)
  const meta = await extractMetadata(videoId);
  const { title, durationSeconds, description, chapters } = meta;
  errors.push(...meta.errors);

  // PRIMARY: Supadata API
  if (env?.SUPADATA_API_KEY) {
    try {
      const data = await fetchFromSupadata(videoId, env.SUPADATA_API_KEY);
      const segs = supadataToSegments(data);
      if (segs.length > 0) {
        return { transcript: segs, title, durationSeconds, description, chapters, method: 'SUPADATA', errors };
      }
      errors.push('SUPADATA: returned 0 segments');
    } catch (e) { errors.push('SUPADATA: ' + e.message); }
  } else {
    errors.push('SUPADATA: no API key configured');
  }

  // FALLBACK METHODS (kept in case Supadata fails)
  // Method: Watch page captions
  try {
    const html = await ytGet('https://www.youtube.com/watch?v=' + videoId + '&bpctr=9999999999&has_verified=1&hl=ko&gl=KR');
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var|<\/script)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const segs = await tryFetchCaptions(tracks, BROWSER_UA);
        if (segs) return { transcript: segs, title, durationSeconds, description, chapters, method: 'WATCH_PAGE', errors };
        errors.push('WATCH: captions found but all formats empty');
      } else {
        errors.push('WATCH: playability=' + (data?.playabilityStatus?.status) + ', no tracks');
      }
    }
  } catch (e) { errors.push('WATCH: ' + e.message); }

  // Method: Direct timedtext API
  try {
    for (const kind of ['asr', '']) {
      for (const fmt of ['srv3', 'json3']) {
        const params = new URLSearchParams({ v: videoId, lang: 'ko', fmt });
        if (kind) params.set('kind', kind);
        const body = await ytGet('https://www.youtube.com/api/timedtext?' + params.toString());
        if (body && body.length > 100) {
          const segs = fmt === 'json3' ? parseJson3(body) : parseCaptionXml(body);
          if (segs.length > 0) return { transcript: segs, title, durationSeconds, description, chapters, method: 'TIMEDTEXT', errors };
        }
      }
    }
    errors.push('TIMEDTEXT: all requests empty');
  } catch (e) { errors.push('TIMEDTEXT: ' + e.message); }

  return { transcript: [], title, durationSeconds, description, chapters, method: 'NONE', errors };
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'POST required' }, { status: 405 });
    }

    try {
      const { videoId } = await request.json();
      if (!videoId) return Response.json({ error: 'videoId required' }, { status: 400 });

      const result = await extractTranscript(videoId, env);
      return Response.json(result, {
        status: result.transcript.length > 0 ? 200 : 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  },
};

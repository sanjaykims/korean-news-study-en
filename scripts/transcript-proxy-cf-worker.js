/**
 * Cloudflare Worker — Korean YouTube transcript proxy
 *
 * Deploy this to Cloudflare Workers (free tier: 100k req/day).
 * It runs on Cloudflare's Korean PoP which has different IPs
 * from Vercel, bypassing YouTube's geo-restriction.
 *
 * Setup:
 *   1. Install wrangler: npm i -g wrangler
 *   2. Login: wrangler login
 *   3. Deploy: wrangler deploy scripts/transcript-proxy-cf-worker.js --name yt-transcript-kr --compatibility-date 2024-01-01
 *   4. Set env var in Vercel: TRANSCRIPT_PROXY_URL=https://yt-transcript-kr.<your-subdomain>.workers.dev
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

async function extractTranscript(videoId) {
  const errors = [];
  let title = '', durationSeconds = 0, description = '', chapters = [];

  // Method 1: Watch page scraping
  try {
    const html = await ytGet('https://www.youtube.com/watch?v=' + videoId + '&bpctr=9999999999&has_verified=1&hl=ko&gl=KR');
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var|<\/script)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const d = data?.videoDetails || {};
      title = d.title || ''; durationSeconds = parseInt(d.lengthSeconds || '0');
      description = d.shortDescription || ''; chapters = parseChapters(description);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const segs = await tryFetchCaptions(tracks, BROWSER_UA);
        if (segs) return { transcript: segs, title, durationSeconds, description, chapters, method: 'WATCH_PAGE', errors };
        errors.push('WATCH: captions found but all formats empty');
      } else {
        errors.push('WATCH: playability=' + (data?.playabilityStatus?.status) + ', no tracks');
      }
    } else {
      errors.push('WATCH: no ytInitialPlayerResponse (len=' + html.length + ')');
    }
  } catch (e) { errors.push('WATCH: ' + e.message); }

  // Method 2: ANDROID client
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, ANDROID_UA);
    if (!title) { const d = data?.videoDetails || {}; title = d.title || ''; durationSeconds = parseInt(d.lengthSeconds || '0'); description = d.shortDescription || ''; chapters = parseChapters(description); }
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const segs = await tryFetchCaptions(tracks, ANDROID_UA);
      if (segs) return { transcript: segs, title, durationSeconds, description, chapters, method: 'ANDROID', errors };
      errors.push('ANDROID: tracks found but empty');
    } else {
      errors.push('ANDROID: playability=' + (data?.playabilityStatus?.status));
    }
  } catch (e) { errors.push('ANDROID: ' + e.message); }

  // Method 3: WEB client
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, BROWSER_UA);
    if (!title) { const d = data?.videoDetails || {}; title = d.title || ''; durationSeconds = parseInt(d.lengthSeconds || '0'); description = d.shortDescription || ''; chapters = parseChapters(description); }
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const segs = await tryFetchCaptions(tracks, BROWSER_UA);
      if (segs) return { transcript: segs, title, durationSeconds, description, chapters, method: 'WEB', errors };
      errors.push('WEB: tracks found but empty');
    } else {
      errors.push('WEB: playability=' + (data?.playabilityStatus?.status));
    }
  } catch (e) { errors.push('WEB: ' + e.message); }

  // Method 4: Direct timedtext API
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
  async fetch(request) {
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

      const result = await extractTranscript(videoId);
      return Response.json(result, {
        status: result.transcript.length > 0 ? 200 : 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  },
};

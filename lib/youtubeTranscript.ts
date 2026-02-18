// YouTube 자막 추출 — 다중 방식 (Vercel 서버 환경 호환)
// Method 1: youtube-transcript package (most reliable from servers)
// Method 2: ANDROID Innertube (Android UA)
// Method 3: Watch page scraping + signed caption URL

import https from 'https';
import { YoutubeTranscript } from 'youtube-transcript';

interface HttpResponse {
  body: string;
  statusCode: number;
}

const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US; sdk_gphone_x86_64 Build/RSR1.210722.013)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const YT_CONSENT_COOKIE = 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB';

function httpsPost(hostname: string, path: string, body: object, userAgent: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': userAgent,
        'Cookie': YT_CONSENT_COOKIE,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
    }, res => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => resolve({ body: d, statusCode: res.statusCode || 0 }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url: string, userAgent: string = BROWSER_UA): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Cookie': YT_CONSENT_COOKIE,
      },
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, userAgent).then(resolve).catch(reject);
        return;
      }
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => resolve({ body: d, statusCode: res.statusCode || 0 }));
    }).on('error', reject);
  });
}

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let m: RegExpExecArray | null;

  // Format 3 (ASR): <p t="ms" d="ms">text with <s> tags</p>
  const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  while ((m = pRe.exec(xml)) !== null) {
    const text = cleanCaptionText(m[3]);
    if (text) {
      segments.push({
        text,
        start: parseInt(m[1]) / 1000,
        duration: parseInt(m[2]) / 1000,
      });
    }
  }

  // Fallback: <text start="" dur=""> format
  if (segments.length === 0) {
    const textRe = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    while ((m = textRe.exec(xml)) !== null) {
      const text = cleanCaptionText(m[3]);
      if (text) {
        segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
      }
    }
  }

  return segments;
}

// Method 1: ANDROID Innertube client (proper Android UA)
async function tryAndroidClient(videoId: string): Promise<TranscriptSegment[]> {
  const playerRes = await httpsPost('www.youtube.com', '/youtubei/v1/player?prettyPrint=false', {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.09.37',
        androidSdkVersion: 30,
        hl: 'ko',
        gl: 'KR',
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  }, ANDROID_UA);

  const playerData = JSON.parse(playerRes.body);
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('ANDROID: no caption tracks');

  const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
  if (!koTrack) throw new Error('ANDROID: no Korean track');

  // Ensure fmt=srv3 for ASR captions
  const capUrl = koTrack.baseUrl.includes('fmt=') ? koTrack.baseUrl : koTrack.baseUrl + '&fmt=srv3';
  const capRes = await httpsGet(capUrl, ANDROID_UA);
  if (!capRes.body || capRes.body.length < 100) throw new Error('ANDROID: empty caption response');

  return parseCaptionXml(capRes.body);
}

// Method 2: Watch page HTML scraping → extract ytInitialPlayerResponse → caption URL
async function tryWatchPageScraping(videoId: string): Promise<TranscriptSegment[]> {
  const watchRes = await httpsGet('https://www.youtube.com/watch?v=' + videoId, BROWSER_UA);
  if (!watchRes.body) throw new Error('WATCH: empty page');

  const match = watchRes.body.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
  if (!match) throw new Error('WATCH: no ytInitialPlayerResponse');

  const data = JSON.parse(match[1]);
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('WATCH: no caption tracks');

  const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
  if (!koTrack) throw new Error('WATCH: no Korean track');

  // Try multiple user-agents and formats
  const attempts: { ua: string; fmt: string }[] = [
    { ua: ANDROID_UA, fmt: 'srv3' },
    { ua: ANDROID_UA, fmt: '' },
    { ua: BROWSER_UA, fmt: 'srv3' },
    { ua: BROWSER_UA, fmt: 'json3' },
    { ua: BROWSER_UA, fmt: '' },
  ];

  for (const { ua, fmt } of attempts) {
    const url = fmt ? koTrack.baseUrl + '&fmt=' + fmt : koTrack.baseUrl;
    const capRes = await httpsGet(url, ua);
    if (capRes.body && capRes.body.length > 100) {
      // json3 format needs different parsing
      if (fmt === 'json3') {
        try {
          const json = JSON.parse(capRes.body);
          const events = json?.events || [];
          const segments: TranscriptSegment[] = [];
          for (const ev of events) {
            if (ev.segs) {
              const text = ev.segs.map((s: { utf8: string }) => s.utf8 || '').join('').trim();
              if (text) {
                segments.push({
                  text,
                  start: (ev.tStartMs || 0) / 1000,
                  duration: (ev.dDurationMs || 0) / 1000,
                });
              }
            }
          }
          if (segments.length > 0) return segments;
        } catch { /* try next */ }
      } else {
        const segments = parseCaptionXml(capRes.body);
        if (segments.length > 0) return segments;
      }
    }
  }

  throw new Error('WATCH: all caption fetch attempts returned empty');
}

/**
 * YouTube 한국어 자막 추출 — 다중 fallback
 * Vercel serverless 환경에서도 동작하도록 여러 방식 시도
 */
export async function getTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const errors: string[] = [];

  // Method 1: youtube-transcript package (most reliable from servers)
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ko' });
    if (items.length > 0) {
      const segments = items.map(item => ({
        text: item.text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(),
        start: item.offset / 1000,
        duration: item.duration / 1000,
      })).filter(s => s.text);
      console.log(`[transcript] youtube-transcript 성공: ${segments.length}개 세그먼트`);
      return segments;
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    console.log(`[transcript] youtube-transcript 실패: ${errors[errors.length - 1]}`);
  }

  // Method 2: ANDROID Innertube
  try {
    const segments = await tryAndroidClient(videoId);
    if (segments.length > 0) {
      console.log(`[transcript] ANDROID 성공: ${segments.length}개 세그먼트`);
      return segments;
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    console.log(`[transcript] ANDROID 실패: ${errors[errors.length - 1]}`);
  }

  // Method 3: Watch page scraping
  try {
    const segments = await tryWatchPageScraping(videoId);
    if (segments.length > 0) {
      console.log(`[transcript] WATCH 성공: ${segments.length}개 세그먼트`);
      return segments;
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    console.log(`[transcript] WATCH 실패: ${errors[errors.length - 1]}`);
  }

  throw new Error(`모든 자막 추출 방식 실패: ${errors.join(' | ')}`);
}

function cleanCaptionText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}

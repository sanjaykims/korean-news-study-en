// YouTube 자막 추출 — Innertube ANDROID 클라이언트 사용
// (자동 생성 자막 ASR 접근 가능)

import https from 'https';

interface HttpResponse {
  body: string;
  statusCode: number;
}

function httpsPost(hostname: string, path: string, body: object): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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

function httpsGet(url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location).then(resolve).catch(reject);
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

/**
 * YouTube Innertube API를 통해 한국어 자막 추출
 * ANDROID 클라이언트로 자동 생성 자막(ASR) 접근
 */
export async function getTranscript(videoId: string): Promise<TranscriptSegment[]> {
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
  });

  const playerData = JSON.parse(playerRes.body);
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('No caption tracks found');

  const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
  if (!koTrack) throw new Error('No Korean caption track');

  const capRes = await httpsGet(koTrack.baseUrl);
  if (!capRes.body) throw new Error('Empty caption response');

  const segments: TranscriptSegment[] = [];

  // Format 3 (ASR): <p t="ms" d="ms">text with <s> tags</p>
  const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(capRes.body)) !== null) {
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
    while ((m = textRe.exec(capRes.body)) !== null) {
      const text = cleanCaptionText(m[3]);
      if (text) {
        segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
      }
    }
  }

  return segments;
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

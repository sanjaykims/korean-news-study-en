import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

export const preferredRegion = 'icn1'; // Seoul

const COOKIE = 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB';

function post(hostname: string, path: string, body: object, ua: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': ua,
        'Cookie': COOKIE,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
    }, res => { let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': COOKIE,
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('v') || 'ZToYdGoUQGQ';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = { videoId, region: process.env.VERCEL_REGION || 'unknown' };

  // Method A: ANDROID player
  try {
    const body = await post('www.youtube.com', '/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, 'com.google.android.youtube/19.09.37 (Linux; U; Android 11)');
    const data = JSON.parse(body);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.android = {
      hasCaptions: !!tracks?.length,
      trackCount: tracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason?.substring(0, 100),
    };
    if (tracks?.[0]) {
      results.android.firstTrackUrl = tracks[0].baseUrl?.substring(0, 100);
      // Try fetching the caption
      const capUrl = tracks[0].baseUrl + (tracks[0].baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const capBody = await get(capUrl);
      results.android.captionLength = capBody.length;
      results.android.captionPreview = capBody.substring(0, 200);
    }
  } catch (e) { results.android = { error: (e as Error).message }; }

  // Method B: WEB player
  try {
    const body = await post('www.youtube.com', '/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    const data = JSON.parse(body);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.web = {
      hasCaptions: !!tracks?.length,
      trackCount: tracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
    };
    if (tracks?.[0]) {
      results.web.firstTrackUrl = tracks[0].baseUrl?.substring(0, 100);
      const capUrl = tracks[0].baseUrl + (tracks[0].baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const capBody = await get(capUrl);
      results.web.captionLength = capBody.length;
    }
  } catch (e) { results.web = { error: (e as Error).message }; }

  // Method C: Watch page
  try {
    const html = await get('https://www.youtube.com/watch?v=' + videoId);
    results.watchPage = { htmlLength: html.length };
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      results.watchPage.hasCaptions = !!tracks?.length;
      results.watchPage.trackCount = tracks?.length || 0;
      if (tracks?.[0]) {
        results.watchPage.firstTrackLang = tracks[0].languageCode;
      }
    } else {
      results.watchPage.noPlayerResponse = true;
      results.watchPage.hasConsent = html.includes('consent');
    }
  } catch (e) { results.watchPage = { error: (e as Error).message }; }

  // Method D: TVHTML5_SIMPLY_EMBEDDED_PLAYER client
  try {
    const body = await post('www.youtube.com', '/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, 'Mozilla/5.0');
    const data = JSON.parse(body);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.tvEmbed = {
      hasCaptions: !!tracks?.length,
      trackCount: tracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
    };
    if (tracks?.[0]) {
      const capUrl = tracks[0].baseUrl + (tracks[0].baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const capBody = await get(capUrl);
      results.tvEmbed.captionLength = capBody.length;
      results.tvEmbed.captionPreview = capBody.substring(0, 200);
    }
  } catch (e) { results.tvEmbed = { error: (e as Error).message }; }

  return NextResponse.json(results);
}

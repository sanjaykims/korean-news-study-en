import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US; sdk_gphone_x86_64 Build/RSR1.210722.013)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpsPost(hostname: string, path: string, body: object, userAgent: string): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': userAgent } }, res => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => resolve({ body: d, statusCode: res.statusCode || 0 }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url: string, userAgent: string): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'ko-KR,ko;q=0.9' } }, res => {
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

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('v') || 'Sjcjexnh_Nc';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = { videoId };

  // Test 1: ANDROID Innertube
  try {
    const res = await httpsPost('www.youtube.com', '/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, ANDROID_UA);

    const data = JSON.parse(res.body);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.android = {
      status: res.statusCode,
      playability: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason,
      trackCount: tracks?.length || 0,
      tracks: tracks?.map((t: { languageCode: string; kind: string }) => ({ lang: t.languageCode, kind: t.kind })),
    };

    if (tracks?.length) {
      const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
      if (koTrack) {
        const capUrl = koTrack.baseUrl.includes('fmt=') ? koTrack.baseUrl : koTrack.baseUrl + '&fmt=srv3';
        const capRes = await httpsGet(capUrl, ANDROID_UA);
        results.android.captionStatus = capRes.statusCode;
        results.android.captionLength = capRes.body.length;
        results.android.captionSample = capRes.body.substring(0, 200);
      }
    }
  } catch (e) {
    results.android = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test 2: Watch page scraping
  try {
    const watchRes = await httpsGet('https://www.youtube.com/watch?v=' + videoId, BROWSER_UA);
    results.watchPage = {
      status: watchRes.statusCode,
      pageLength: watchRes.body.length,
    };

    const match = watchRes.body.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      results.watchPage.playability = data?.playabilityStatus?.status;
      results.watchPage.trackCount = tracks?.length || 0;

      if (tracks?.length) {
        const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
        if (koTrack) {
          // Try with Android UA + srv3
          const capRes = await httpsGet(koTrack.baseUrl + '&fmt=srv3', ANDROID_UA);
          results.watchPage.androidCapLength = capRes.body.length;

          // Try with Browser UA
          const capRes2 = await httpsGet(koTrack.baseUrl + '&fmt=srv3', BROWSER_UA);
          results.watchPage.browserCapLength = capRes2.body.length;

          // Try json3
          const capRes3 = await httpsGet(koTrack.baseUrl + '&fmt=json3', BROWSER_UA);
          results.watchPage.json3Length = capRes3.body.length;
          if (capRes3.body.length > 0) {
            results.watchPage.json3Sample = capRes3.body.substring(0, 200);
          }

          // Try without fmt
          const capRes4 = await httpsGet(koTrack.baseUrl, BROWSER_UA);
          results.watchPage.noFmtLength = capRes4.body.length;
          if (capRes4.body.length > 0) {
            results.watchPage.noFmtSample = capRes4.body.substring(0, 200);
          }
        }
      }
    } else {
      results.watchPage.hasPlayerResponse = false;
    }
  } catch (e) {
    results.watchPage = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test 3: Native fetch (Node 18+)
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
        videoId, contentCheckOk: true, racyCheckOk: true,
      }),
    });
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.nativeFetch = {
      status: res.status,
      playability: data?.playabilityStatus?.status,
      trackCount: tracks?.length || 0,
    };

    if (tracks?.length) {
      const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
      if (koTrack) {
        const capUrl = koTrack.baseUrl.includes('fmt=') ? koTrack.baseUrl : koTrack.baseUrl + '&fmt=srv3';
        const capRes = await fetch(capUrl, { headers: { 'User-Agent': ANDROID_UA } });
        const capText = await capRes.text();
        results.nativeFetch.captionLength = capText.length;
        results.nativeFetch.captionSample = capText.substring(0, 200);
      }
    }
  } catch (e) {
    results.nativeFetch = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}

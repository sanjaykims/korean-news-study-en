import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US; sdk_gphone_x86_64 Build/RSR1.210722.013)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('v') || 'Sjcjexnh_Nc';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = { videoId, runtime: 'edge' };

  // Test 1: ANDROID client with native fetch
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
    results.android = {
      status: res.status,
      playability: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason,
      trackCount: tracks?.length || 0,
    };

    if (tracks?.length) {
      const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
      if (koTrack) {
        const capUrl = koTrack.baseUrl.includes('fmt=') ? koTrack.baseUrl : koTrack.baseUrl + '&fmt=srv3';
        const capRes = await fetch(capUrl, { headers: { 'User-Agent': ANDROID_UA } });
        const capText = await capRes.text();
        results.android.captionLength = capText.length;
        results.android.captionSample = capText.substring(0, 200);
      }
    }
  } catch (e) {
    results.android = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test 2: Watch page + extract player response
  try {
    const watchRes = await fetch('https://www.youtube.com/watch?v=' + videoId, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    const html = await watchRes.text();
    results.watchPage = { status: watchRes.status, pageLength: html.length };

    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      results.watchPage.playability = data?.playabilityStatus?.status;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      results.watchPage.trackCount = tracks?.length || 0;

      if (tracks?.length) {
        const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
        if (koTrack) {
          const capRes = await fetch(koTrack.baseUrl + '&fmt=srv3', { headers: { 'User-Agent': ANDROID_UA } });
          const capText = await capRes.text();
          results.watchPage.captionLength = capText.length;
        }
      }
    }
  } catch (e) {
    results.watchPage = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test 3: WEB client with YouTube's internal API key
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
        videoId, contentCheckOk: true, racyCheckOk: true,
      }),
    });
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    results.webClient = {
      status: res.status,
      playability: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason,
      trackCount: tracks?.length || 0,
    };
    if (tracks?.length) {
      const koTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ko');
      if (koTrack) {
        const capRes = await fetch(koTrack.baseUrl + '&fmt=srv3', { headers: { 'User-Agent': BROWSER_UA } });
        const capText = await capRes.text();
        results.webClient.captionLength = capText.length;
      }
    }
  } catch (e) {
    results.webClient = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}

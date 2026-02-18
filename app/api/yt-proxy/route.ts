// Edge function proxy for YouTube API — runs on Cloudflare PoP (Seoul/Tokyo)
// Bypasses geo-restriction that blocks Node.js serverless functions (US iad1)
export const runtime = 'edge';
export const preferredRegion = ['icn1', 'hnd1']; // Seoul, Tokyo

const COOKIE = 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB';
const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IOS_UA = 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJSON = any;

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

function parseCaptionXml(xml: string): { text: string; start: number; duration: number }[] {
  const segments: { text: string; start: number; duration: number }[] = [];

  // srv3 format: <p t="ms" d="ms">...</p>
  const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const text = cleanCaptionText(m[3]);
    if (text) segments.push({ text, start: parseInt(m[1]) / 1000, duration: parseInt(m[2]) / 1000 });
  }
  if (segments.length > 0) return segments;

  // Fallback: <text start="" dur="">...</text>
  const tRe = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((m = tRe.exec(xml)) !== null) {
    const text = cleanCaptionText(m[3]);
    if (text) segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
  }
  return segments;
}

function parseJson3Captions(body: string): { text: string; start: number; duration: number }[] {
  try {
    const json = JSON.parse(body);
    const events = json?.events || [];
    const segments: { text: string; start: number; duration: number }[] = [];
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
    return segments;
  } catch {
    return [];
  }
}

async function ytPost(path: string, body: object, ua: string = ANDROID_UA): Promise<AnyJSON> {
  const res = await fetch('https://www.youtube.com' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'Cookie': COOKIE,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ytGet(url: string, ua: string = BROWSER_UA): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Cookie': COOKIE,
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  return res.text();
}

function parseChapters(description: string): { title: string; startSeconds: number }[] {
  const chapters: { title: string; startSeconds: number }[] = [];
  for (const line of description.split('\n')) {
    const match = line.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})\s+(.+)/);
    if (match) {
      const hours = match[1] ? parseInt(match[1]) : 0;
      chapters.push({ title: match[4].trim(), startSeconds: hours * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) });
    }
  }
  return chapters;
}

// Try multiple YouTube API clients to extract captions
async function extractTranscript(videoId: string): Promise<{
  transcript: { text: string; start: number; duration: number }[];
  title: string;
  durationSeconds: number;
  description: string;
  chapters: { title: string; startSeconds: number }[];
  method: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let title = '';
  let durationSeconds = 0;
  let description = '';
  let chapters: { title: string; startSeconds: number }[] = [];

  // Method 1: Watch page scraping — most reliable for geo-restricted content
  try {
    const html = await ytGet('https://www.youtube.com/watch?v=' + videoId, BROWSER_UA);
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
        // Try multiple formats
        for (const fmt of ['srv3', 'json3', '']) {
          const capUrl = fmt ? koTrack.baseUrl + '&fmt=' + fmt : koTrack.baseUrl;
          const capBody = await ytGet(capUrl, BROWSER_UA);
          if (capBody && capBody.length > 100) {
            const segments = fmt === 'json3' ? parseJson3Captions(capBody) : parseCaptionXml(capBody);
            if (segments.length > 0) {
              return { transcript: segments, title, durationSeconds, description, chapters, method: 'WATCH_PAGE', errors };
            }
          }
        }
        errors.push('WATCH: captions found but all formats returned empty');
      } else {
        errors.push(`WATCH: playability=${data?.playabilityStatus?.status}, no caption tracks`);
      }
    } else {
      // Check if it's a consent redirect or error page
      const hasConsent = html.includes('consent.youtube.com') || html.includes('CONSENT');
      errors.push(`WATCH: no ytInitialPlayerResponse (consent=${hasConsent}, len=${html.length})`);
    }
  } catch (e) {
    errors.push(`WATCH: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Method 2: TVHTML5_SIMPLY_EMBEDDED_PLAYER — embedded player client (less restricted)
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: {
        client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'ko', gl: 'KR' },
        thirdParty: { embedUrl: 'https://www.google.com' },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }, BROWSER_UA);

    const details = data?.videoDetails || {};
    if (!title) {
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
      const capUrl = koTrack.baseUrl + (koTrack.baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const xml = await ytGet(capUrl, BROWSER_UA);
      const segments = parseCaptionXml(xml);
      if (segments.length > 0) {
        return { transcript: segments, title, durationSeconds, description, chapters, method: 'TV_EMBEDDED', errors };
      }
      errors.push('TV_EMBEDDED: captions found but parsing returned empty');
    } else {
      errors.push(`TV_EMBEDDED: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`TV_EMBEDDED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Method 3: WEB client
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }, BROWSER_UA);

    if (!title) {
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
      const capUrl = koTrack.baseUrl + (koTrack.baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const xml = await ytGet(capUrl, BROWSER_UA);
      const segments = parseCaptionXml(xml);
      if (segments.length > 0) {
        return { transcript: segments, title, durationSeconds, description, chapters, method: 'WEB', errors };
      }
      errors.push('WEB: captions found but parsing returned empty');
    } else {
      errors.push(`WEB: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`WEB: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Method 4: ANDROID client
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    });

    if (!title) {
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
      const capUrl = koTrack.baseUrl + (koTrack.baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const xml = await ytGet(capUrl, ANDROID_UA);
      const segments = parseCaptionXml(xml);
      if (segments.length > 0) {
        return { transcript: segments, title, durationSeconds, description, chapters, method: 'ANDROID', errors };
      }
      errors.push('ANDROID: captions found but parsing returned empty');
    } else {
      errors.push(`ANDROID: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`ANDROID: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Method 5: IOS client
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'ko', gl: 'KR' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }, IOS_UA);

    if (!title) {
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
      const capUrl = koTrack.baseUrl + (koTrack.baseUrl.includes('fmt=') ? '' : '&fmt=srv3');
      const xml = await ytGet(capUrl, IOS_UA);
      const segments = parseCaptionXml(xml);
      if (segments.length > 0) {
        return { transcript: segments, title, durationSeconds, description, chapters, method: 'IOS', errors };
      }
      errors.push('IOS: captions found but parsing returned empty');
    } else {
      errors.push(`IOS: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`IOS: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { transcript: [], title, durationSeconds, description, chapters, method: 'NONE', errors };
}

export async function POST(request: Request) {
  const body = await request.json() as { action: string; videoId?: string; channelId?: string; dateStr?: string; maxPages?: number; params?: Record<string, unknown> };
  const { action, videoId } = body;

  // ─── ACTION: transcript ───
  if (action === 'transcript' && videoId) {
    const result = await extractTranscript(videoId);

    if (result.transcript.length === 0) {
      return Response.json({
        error: `All transcript methods failed`,
        errors: result.errors,
        title: result.title,
        durationSeconds: result.durationSeconds,
        chapters: result.chapters,
      }, { status: 404 });
    }

    return Response.json({
      title: result.title,
      durationSeconds: result.durationSeconds,
      description: result.description,
      chapters: result.chapters,
      transcript: result.transcript,
      method: result.method,
      errors: result.errors,
    });
  }

  // ─── ACTION: browse ───
  if (action === 'browse') {
    const channelId = body.channelId || 'UCsU-I-vHLiaMfV_ceaYz5rQ';
    const dateStr = body.dateStr || '';
    const maxPages = body.maxPages || 5;

    try {
      const candidates: { id: string; title: string; durationSeconds: number }[] = [];
      let continuation: string | null = null;

      for (let page = 0; page < maxPages; page++) {
        let data: AnyJSON;

        if (page === 0) {
          data = await ytPost('/youtubei/v1/browse?prettyPrint=false', {
            context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
            browseId: channelId,
            params: 'EgZ2aWRlb3PyBgQKAjoA',
          }, BROWSER_UA);
        } else if (continuation) {
          data = await ytPost('/youtubei/v1/browse?prettyPrint=false', {
            context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
            continuation,
          }, BROWSER_UA);
        } else {
          break;
        }

        let gridItems: AnyJSON[] = [];
        continuation = null;

        const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
        if (tabs) {
          for (const tab of tabs) {
            const items = tab?.tabRenderer?.content?.richGridRenderer?.contents;
            if (items) { gridItems = items; break; }
          }
        } else {
          const actions = data?.onResponseReceivedActions;
          if (actions) {
            for (const act of actions) {
              const items = act?.appendContinuationItemsAction?.continuationItems;
              if (items) { gridItems = items; break; }
            }
          }
        }

        for (const gi of gridItems) {
          const video = gi?.richItemRenderer?.content?.videoRenderer;
          if (video) {
            const id = video.videoId as string;
            const vtitle = video.title?.runs?.map((r: AnyJSON) => r.text).join('') || '';
            const durText = video.lengthText?.simpleText || '';
            const parts = durText.split(':').map(Number);
            let secs = 0;
            if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else if (parts.length === 2) secs = parts[0] * 60 + parts[1];

            if (vtitle.includes('뉴스룸') && secs >= 600 && vtitle.includes(dateStr)) {
              candidates.push({ id, title: vtitle, durationSeconds: secs });
            }
          }
          const cont = gi?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (cont) continuation = cont;
        }

        if (candidates.length > 0) break;
        if (!continuation) break;
      }

      candidates.sort((a, b) => b.durationSeconds - a.durationSeconds);
      return Response.json({ candidates });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err), candidates: [] }, { status: 500 });
    }
  }

  // ─── ACTION: player ───
  if (action === 'player' && videoId) {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }, BROWSER_UA);

    const details = data?.videoDetails || {};
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    return Response.json({
      playabilityStatus: data?.playabilityStatus?.status,
      title: details.title,
      durationSeconds: parseInt(details.lengthSeconds || '0'),
      description: details.shortDescription || '',
      captionTracks: tracks.map((t: AnyJSON) => ({ lang: t.languageCode, url: t.baseUrl })),
    });
  }

  // ─── ACTION: captions ───
  if (action === 'captions') {
    const url = (body.params as { url?: string })?.url;
    if (!url) return Response.json({ error: 'Missing url' }, { status: 400 });

    const capUrl = url + (url.includes('fmt=') ? '' : '&fmt=srv3');
    const xml = await ytGet(capUrl);
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

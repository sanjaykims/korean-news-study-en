// Edge function proxy for YouTube API — runs on Cloudflare PoP (Seoul/Tokyo)
// Bypasses geo-restriction that blocks Node.js serverless functions (US iad1)
export const runtime = 'edge';
export const preferredRegion = ['icn1', 'hnd1']; // Seoul, Tokyo

const COOKIE = 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB';
const ANDROID_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IOS_UA = 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)';
const MWEB_UA = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

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

// Build protobuf params for get_transcript API
function encodeTranscriptParams(videoId: string): string {
  const enc = new TextEncoder();
  const vidBytes = enc.encode(videoId);
  // Protobuf: field 1 (message) { field 1 (string) = videoId }
  const inner = new Uint8Array(2 + vidBytes.length);
  inner[0] = 0x0a; // field 1, wire type 2 (length-delimited)
  inner[1] = vidBytes.length;
  inner.set(vidBytes, 2);
  const outer = new Uint8Array(2 + inner.length);
  outer[0] = 0x0a; // field 1, wire type 2
  outer[1] = inner.length;
  outer.set(inner, 2);
  return btoa(Array.from(outer, b => String.fromCharCode(b)).join(''));
}

// Parse get_transcript response into segments
function parseTranscriptResponse(data: AnyJSON): { text: string; start: number; duration: number }[] {
  const segments: { text: string; start: number; duration: number }[] = [];
  try {
    const body = data?.actions?.[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;
    if (!body) return segments;
    for (const item of body) {
      const seg = item?.transcriptSegmentRenderer;
      if (seg) {
        const text = seg.snippet?.runs?.map((r: AnyJSON) => r.text || '').join('').trim() || '';
        const startMs = parseInt(seg.startMs || '0');
        const endMs = parseInt(seg.endMs || '0');
        if (text) {
          segments.push({ text, start: startMs / 1000, duration: (endMs - startMs) / 1000 });
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return segments;
}

// Helper: try fetching captions from a player response that has caption tracks
async function tryFetchCaptions(
  tracks: AnyJSON[],
  ua: string,
  errors: string[],
  methodName: string,
): Promise<{ text: string; start: number; duration: number }[] | null> {
  const koTrack = tracks.find((t: AnyJSON) => t.languageCode === 'ko') || tracks[0];
  // Try multiple formats
  for (const fmt of ['srv3', 'json3', '']) {
    const capUrl = fmt
      ? koTrack.baseUrl + (koTrack.baseUrl.includes('fmt=') ? '' : '&fmt=' + fmt)
      : koTrack.baseUrl;
    try {
      const capBody = await ytGet(capUrl, ua);
      if (capBody && capBody.length > 100) {
        const segments = fmt === 'json3' ? parseJson3Captions(capBody) : parseCaptionXml(capBody);
        if (segments.length > 0) return segments;
      }
    } catch { /* try next format */ }
  }
  errors.push(`${methodName}: captions found but all formats returned empty`);
  return null;
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

  // ─── Method 1: Direct timedtext API ───
  // Simplest approach — direct URL, might bypass player-level geo-restriction
  try {
    for (const kind of ['asr', '']) {
      for (const fmt of ['srv3', 'json3', 'vtt']) {
        const params = new URLSearchParams({ v: videoId, lang: 'ko', fmt });
        if (kind) params.set('kind', kind);
        const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
        const body = await ytGet(url, BROWSER_UA);
        if (body && body.length > 100) {
          const segments = fmt === 'json3' ? parseJson3Captions(body) : parseCaptionXml(body);
          if (segments.length > 0) {
            // We got captions but no metadata yet — fetch metadata separately
            try {
              const playerData = await ytPost('/youtubei/v1/player?prettyPrint=false', {
                context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
                videoId, contentCheckOk: true, racyCheckOk: true,
              }, BROWSER_UA);
              const details = playerData?.videoDetails || {};
              title = details.title || '';
              durationSeconds = parseInt(details.lengthSeconds || '0');
              description = details.shortDescription || '';
              chapters = parseChapters(description);
            } catch { /* metadata optional */ }
            return { transcript: segments, title, durationSeconds, description, chapters, method: 'TIMEDTEXT', errors };
          }
        }
      }
    }
    errors.push('TIMEDTEXT: all direct timedtext requests returned empty');
  } catch (e) {
    errors.push(`TIMEDTEXT: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 2: Innertube get_transcript ───
  // Different from player API — uses YouTube's transcript panel endpoint
  try {
    const params = encodeTranscriptParams(videoId);
    const data = await ytPost('/youtubei/v1/get_transcript?prettyPrint=false', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      params,
    }, BROWSER_UA);
    const segments = parseTranscriptResponse(data);
    if (segments.length > 0) {
      // Get metadata
      try {
        const playerData = await ytPost('/youtubei/v1/player?prettyPrint=false', {
          context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
          videoId, contentCheckOk: true, racyCheckOk: true,
        }, BROWSER_UA);
        const details = playerData?.videoDetails || {};
        title = details.title || '';
        durationSeconds = parseInt(details.lengthSeconds || '0');
        description = details.shortDescription || '';
        chapters = parseChapters(description);
      } catch { /* metadata optional */ }
      return { transcript: segments, title, durationSeconds, description, chapters, method: 'GET_TRANSCRIPT', errors };
    }
    const errDetail = data?.error?.message || JSON.stringify(data).substring(0, 120);
    errors.push(`GET_TRANSCRIPT: no segments (${errDetail})`);
  } catch (e) {
    errors.push(`GET_TRANSCRIPT: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 3: Watch page scraping (with bypass params) ───
  try {
    const html = await ytGet(
      `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1&hl=ko&gl=KR`,
      BROWSER_UA,
    );
    // Use a greedy approach to find the full JSON — match until };\n or };var
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var|<\/script)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const result = await tryFetchCaptions(tracks, BROWSER_UA, errors, 'WATCH');
        if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'WATCH_PAGE', errors };
      } else {
        errors.push(`WATCH: playability=${data?.playabilityStatus?.status}, no caption tracks`);
      }
    } else {
      const hasConsent = html.includes('consent.youtube.com') || html.includes('CONSENT');
      errors.push(`WATCH: no ytInitialPlayerResponse (consent=${hasConsent}, len=${html.length})`);
    }
  } catch (e) {
    errors.push(`WATCH: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 4: Embed page ───
  // Embedded player has different geo-restriction rules than watch page
  try {
    const html = await ytGet(`https://www.youtube.com/embed/${videoId}?hl=ko&gl=KR`, BROWSER_UA);
    // Embed page stores config in ytInitialPlayerResponse or ytcfg
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;/)
      || html.match(/"embedded_player_response":"((?:\\.|[^"])+)"/);
    if (match) {
      let jsonStr = match[1];
      // Handle escaped JSON from embedded_player_response
      if (jsonStr.includes('\\')) {
        jsonStr = JSON.parse('"' + jsonStr + '"');
      }
      const data = JSON.parse(jsonStr);
      const details = data?.videoDetails || {};
      if (!title) {
        title = details.title || '';
        durationSeconds = parseInt(details.lengthSeconds || '0');
        description = details.shortDescription || '';
        chapters = parseChapters(description);
      }

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const result = await tryFetchCaptions(tracks, BROWSER_UA, errors, 'EMBED');
        if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'EMBED', errors };
      } else {
        errors.push(`EMBED: playability=${data?.playabilityStatus?.status}, no caption tracks`);
      }
    } else {
      errors.push(`EMBED: no player response found (len=${html.length})`);
    }
  } catch (e) {
    errors.push(`EMBED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 5: TVHTML5_SIMPLY_EMBEDDED_PLAYER ───
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
      const result = await tryFetchCaptions(tracks, BROWSER_UA, errors, 'TV_EMBEDDED');
      if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'TV_EMBEDDED', errors };
    } else {
      errors.push(`TV_EMBEDDED: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`TV_EMBEDDED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 6: WEB client ───
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
      const result = await tryFetchCaptions(tracks, BROWSER_UA, errors, 'WEB');
      if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'WEB', errors };
    } else {
      errors.push(`WEB: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`WEB: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 7: MWEB client (mobile web) ───
  try {
    const data = await ytPost('/youtubei/v1/player?prettyPrint=false', {
      context: { client: { clientName: 'MWEB', clientVersion: '2.20260101.00.00', hl: 'ko', gl: 'KR' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }, MWEB_UA);

    if (!title) {
      const details = data?.videoDetails || {};
      title = details.title || '';
      durationSeconds = parseInt(details.lengthSeconds || '0');
      description = details.shortDescription || '';
      chapters = parseChapters(description);
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const result = await tryFetchCaptions(tracks, MWEB_UA, errors, 'MWEB');
      if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'MWEB', errors };
    } else {
      errors.push(`MWEB: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`MWEB: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 8: ANDROID client ───
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
      const result = await tryFetchCaptions(tracks, ANDROID_UA, errors, 'ANDROID');
      if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'ANDROID', errors };
    } else {
      errors.push(`ANDROID: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`ANDROID: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 9: IOS client ───
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
      const result = await tryFetchCaptions(tracks, IOS_UA, errors, 'IOS');
      if (result) return { transcript: result, title, durationSeconds, description, chapters, method: 'IOS', errors };
    } else {
      errors.push(`IOS: playability=${data?.playabilityStatus?.status}, reason=${(data?.playabilityStatus?.reason || '').substring(0, 80)}`);
    }
  } catch (e) {
    errors.push(`IOS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Method 10: Third-party Invidious instances ───
  // Try public Invidious instances that may have Korean server access
  const invidiousInstances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://invidious.privacyredirect.com',
  ];
  for (const instance of invidiousInstances) {
    try {
      const res = await fetch(`${instance}/api/v1/captions/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA },
      });
      if (!res.ok) continue;
      const captionList = await res.json() as { captions: { label: string; language_code: string; url: string }[] };
      const koCaption = captionList.captions?.find(c => c.language_code === 'ko')
        || captionList.captions?.find(c => c.language_code.startsWith('ko'));
      if (koCaption) {
        // Fetch the actual caption content
        const capUrl = koCaption.url.startsWith('http') ? koCaption.url : instance + koCaption.url;
        const capRes = await fetch(capUrl + (capUrl.includes('fmt=') ? '' : '&fmt=srv3'), {
          headers: { 'User-Agent': BROWSER_UA },
        });
        const capBody = await capRes.text();
        if (capBody && capBody.length > 100) {
          const segments = parseCaptionXml(capBody);
          if (segments.length > 0) {
            return { transcript: segments, title, durationSeconds, description, chapters, method: `INVIDIOUS(${new URL(instance).hostname})`, errors };
          }
        }
      }
    } catch (e) {
      errors.push(`INVIDIOUS(${new URL(instance).hostname}): ${e instanceof Error ? e.message : String(e)}`);
    }
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

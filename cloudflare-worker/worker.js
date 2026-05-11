/**
 * Cloudflare Worker — JTBC transcript proxy
 *
 * Deploy to a region close to Korea (smart placement → APAC).
 * Set TRANSCRIPT_PROXY_URL on Vercel to this worker's URL.
 *
 * Contract:
 *   POST { videoId } → { transcript, chapters, title, durationSeconds, method, error?, errors? }
 */

const ANDROID_UA = "com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US; sdk_gphone_x86_64 Build/RSR1.210722.013)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COOKIE = "CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB";

function cleanText(raw) {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, " ")
    .trim();
}

function parseCaptionXml(xml) {
  const segments = [];
  // srv3 format
  const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRe.exec(xml)) !== null) {
    const text = cleanText(m[3]);
    if (text) segments.push({ text, start: parseInt(m[1]) / 1000, duration: parseInt(m[2]) / 1000 });
  }
  if (segments.length > 0) return segments;
  // text format
  const tRe = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((m = tRe.exec(xml)) !== null) {
    const text = cleanText(m[3]);
    if (text) segments.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) });
  }
  return segments;
}

async function fetchJSON(url, body, ua) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ua || BROWSER_UA,
      "Cookie": COOKIE,
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function fetchText(url, ua) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": ua || BROWSER_UA,
      "Cookie": COOKIE,
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  return res.text();
}

async function getVideoInfo(videoId) {
  const data = await fetchJSON(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "ko", gl: "KR" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }
  );

  const title = data?.videoDetails?.title || "";
  const durationSeconds = parseInt(data?.videoDetails?.lengthSeconds || "0");
  const description = data?.videoDetails?.shortDescription || "";

  const chapters = [];
  for (const line of description.split("\n")) {
    const m = line.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})\s+(.+)/);
    if (m) {
      const hours = m[1] ? parseInt(m[1]) : 0;
      chapters.push({
        title: m[4].trim(),
        startSeconds: hours * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]),
      });
    }
  }

  return { title, durationSeconds, chapters };
}

async function getTranscript(videoId) {
  const errors = [];

  // Method 1: ANDROID player
  try {
    const data = await fetchJSON(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        context: {
          client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "ko", gl: "KR" },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
      ANDROID_UA
    );
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const ko = tracks.find((t) => t.languageCode === "ko") || tracks[0];
      const capUrl = ko.baseUrl + (ko.baseUrl.includes("fmt=") ? "" : "&fmt=srv3");
      const capBody = await fetchText(capUrl, ANDROID_UA);
      const segs = parseCaptionXml(capBody);
      if (segs.length > 0) return { transcript: segs, method: "android" };
      errors.push("ANDROID: parsed 0 segments");
    } else {
      errors.push(`ANDROID: no captionTracks (playability=${data?.playabilityStatus?.status})`);
    }
  } catch (e) {
    errors.push(`ANDROID: ${e.message}`);
  }

  // Method 2: Watch page scrape
  try {
    const html = await fetchText("https://www.youtube.com/watch?v=" + videoId);
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const ko = tracks.find((t) => t.languageCode === "ko") || tracks[0];
        const capUrl = ko.baseUrl + "&fmt=srv3";
        const capBody = await fetchText(capUrl);
        const segs = parseCaptionXml(capBody);
        if (segs.length > 0) return { transcript: segs, method: "watch" };
        errors.push("WATCH: parsed 0 segments");
      } else {
        errors.push("WATCH: no captionTracks");
      }
    } else {
      errors.push("WATCH: no ytInitialPlayerResponse");
    }
  } catch (e) {
    errors.push(`WATCH: ${e.message}`);
  }

  return { transcript: [], errors };
}

export default {
  async fetch(request) {
    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, message: "JTBC transcript proxy" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { videoId } = body;
    if (!videoId) {
      return new Response(JSON.stringify({ error: "videoId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const [info, transcriptResult] = await Promise.all([
        getVideoInfo(videoId),
        getTranscript(videoId),
      ]);

      return new Response(
        JSON.stringify({
          videoId,
          title: info.title,
          durationSeconds: info.durationSeconds,
          chapters: info.chapters,
          transcript: transcriptResult.transcript,
          method: transcriptResult.method,
          errors: transcriptResult.errors,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message, videoId }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};

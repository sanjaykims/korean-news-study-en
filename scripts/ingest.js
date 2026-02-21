#!/usr/bin/env node
/**
 * Local ingestion script — runs from YOUR machine (Korean IP)
 * Extracts transcript locally, then uploads to Vercel server.
 *
 * Usage:
 *   node scripts/ingest.js                    # today's date, auto-search
 *   node scripts/ingest.js 2026-02-17         # specific date, auto-search
 *   node scripts/ingest.js 2026-02-17 ZToYdGoUQGQ  # specific video
 */

const https = require("https");

const SITE = "yaofang-news-study.vercel.app";
const COOKIE = "CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB";
const ANDROID_UA = "com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US; sdk_gphone_x86_64 Build/RSR1.210722.013)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function post(hostname, path, body, ua) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": ua || BROWSER_UA,
        "Cookie": COOKIE,
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
      },
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d)); });
    req.on("error", reject); req.write(data); req.end();
  });
}

function get(url, ua) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { "User-Agent": ua || BROWSER_UA, "Cookie": COOKIE, "Accept-Language": "ko-KR,ko;q=0.9" },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location, ua).then(resolve).catch(reject); return;
      }
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

function postToSite(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: SITE, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d))); });
    req.on("error", reject); req.write(data); req.end();
  });
}

function cleanText(raw) {
  return raw.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
}

function parseDuration(dur) {
  const parts = dur.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(dur) || 0;
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

// Search YouTube for JTBC 뉴스룸 video matching a date
async function searchJTBCVideo(dateStr, fullDate) {
  // YouTube search is faster and more accurate than channel browse for specific dates
  const queries = [
    `JTBC 뉴스룸 다시보기 ${dateStr}`,
    `JTBC 뉴스룸 ${fullDate}`,
  ];

  for (const query of queries) {
    console.log(`  Searching: "${query}"...`);
    try {
      const body = await post("www.youtube.com", "/youtubei/v1/search?prettyPrint=false", {
        context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "ko", gl: "KR" } },
        query,
      });
      const data = JSON.parse(body);
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
      if (!contents) continue;

      const candidates = [];
      for (const sec of contents) {
        const items = sec?.itemSectionRenderer?.contents;
        if (!items) continue;
        for (const item of items) {
          const video = item?.videoRenderer;
          if (video) {
            const id = video.videoId;
            const title = (video.title?.runs || []).map(r => r.text).join("");
            const dur = video.lengthText?.simpleText || "";
            const secs = parseDuration(dur);

            // Must be JTBC 뉴스룸, 10+ min, and contain the date
            if (title.includes("뉴스룸") && secs >= 600 &&
                (title.includes("JTBC") || title.includes("제이티비씨")) &&
                title.includes(dateStr)) {
              console.log(`  Found: "${title}" (${Math.floor(secs / 60)}m) [${id}]`);
              candidates.push({ id, title, durationSeconds: secs });
            }
          }
        }
      }

      if (candidates.length > 0) {
        // Return the longest one (full broadcast)
        candidates.sort((a, b) => b.durationSeconds - a.durationSeconds);
        return candidates[0];
      }
    } catch (e) {
      console.log(`  Search failed: ${e.message}`);
    }
  }

  return null;
}

async function getTranscript(videoId) {
  // Method 1: ANDROID player
  console.log("  Trying ANDROID player...");
  try {
    const body = await post("www.youtube.com", "/youtubei/v1/player?prettyPrint=false", {
      context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "ko", gl: "KR" } },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }, ANDROID_UA);
    const data = JSON.parse(body);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length) {
      const ko = tracks.find(t => t.languageCode === "ko") || tracks[0];
      const capUrl = ko.baseUrl + (ko.baseUrl.includes("fmt=") ? "" : "&fmt=srv3");
      const capBody = await get(capUrl, ANDROID_UA);
      const segs = parseCaptionXml(capBody);
      if (segs.length > 0) { console.log(`  ANDROID: ${segs.length} segments`); return segs; }
    }
  } catch (e) { console.log("  ANDROID failed:", e.message); }

  // Method 2: Watch page
  console.log("  Trying watch page...");
  try {
    const html = await get("https://www.youtube.com/watch?v=" + videoId);
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        const ko = tracks.find(t => t.languageCode === "ko") || tracks[0];
        const capUrl = ko.baseUrl + "&fmt=srv3";
        const capBody = await get(capUrl);
        const segs = parseCaptionXml(capBody);
        if (segs.length > 0) { console.log(`  Watch page: ${segs.length} segments`); return segs; }
      }
    }
  } catch (e) { console.log("  Watch page failed:", e.message); }

  throw new Error("Transcript extraction failed");
}

async function getVideoInfo(videoId) {
  const body = await post("www.youtube.com", "/youtubei/v1/player?prettyPrint=false", {
    context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "ko", gl: "KR" } },
    videoId, contentCheckOk: true, racyCheckOk: true,
  });
  const data = JSON.parse(body);
  const title = data?.videoDetails?.title || "";
  const durationSeconds = parseInt(data?.videoDetails?.lengthSeconds || "0");
  const description = data?.videoDetails?.shortDescription || "";

  const chapters = [];
  for (const line of description.split("\n")) {
    const m = line.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})\s+(.+)/);
    if (m) {
      const hours = m[1] ? parseInt(m[1]) : 0;
      chapters.push({ title: m[4].trim(), startSeconds: hours * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) });
    }
  }

  return { title, durationSeconds, chapters };
}

async function main() {
  let date = process.argv[2];
  let videoId = process.argv[3];

  // Default: today's date in KST
  if (!date) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    date = kst.toISOString().split("T")[0];
    console.log(`No date specified, using today (KST): ${date}`);
  }

  // Auto-search if no video ID provided
  if (!videoId) {
    const d = new Date(date + "T00:00:00");
    const yy = String(d.getFullYear()).slice(2);
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    const dateStr = `${yy}.${String(m).padStart(2, "0")}.${String(dd).padStart(2, "0")}`;

    // Also try "2026년 2월 17일" format
    const fullDate = `${d.getFullYear()}년 ${m}월 ${dd}일`;
    console.log(`Searching for JTBC 뉴스룸 (${dateStr} / ${fullDate})...`);

    const found = await searchJTBCVideo(dateStr, fullDate);
    if (!found) {
      console.log(`\nERROR: Could not find JTBC 뉴스룸 for ${date}`);
      console.log("Tip: Try passing the video ID directly:");
      console.log(`  node scripts/ingest.js ${date} <videoId>`);
      process.exit(1);
    }
    videoId = found.id;
    console.log(`\nAuto-selected: "${found.title}" [${videoId}]`);
  }

  console.log(`\nIngesting ${videoId} for ${date}...`);

  // Step 1: Get video info + chapters
  console.log("Getting video info...");
  const { title, durationSeconds, chapters } = await getVideoInfo(videoId);
  console.log(`  Title: ${title}`);
  console.log(`  Duration: ${durationSeconds}s, Chapters: ${chapters.length}`);

  if (chapters.length === 0) {
    console.log("ERROR: No chapters found in video description.");
    process.exit(1);
  }

  // Step 2: Extract transcript locally
  console.log("Extracting transcript (local)...");
  const transcript = await getTranscript(videoId);
  console.log(`  Got ${transcript.length} transcript segments`);

  // Step 3: Send to server
  console.log(`Sending to ${SITE}...`);
  const result = await postToSite("/api/ingest", {
    date,
    youtubeId: videoId,
    videoTitle: title,
    durationSeconds,
    chapters,
    transcript,
  });

  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.skipped) {
    console.log(`\nAlready ingested (${videoId}).`);
  } else if (result.articles > 0) {
    console.log(`\nDone! ${result.articles} articles ingested.`);
  } else if (result.error) {
    console.log(`\nError: ${result.error}`);
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });

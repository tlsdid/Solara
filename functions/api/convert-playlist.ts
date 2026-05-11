const API_ENDPOINTS = [
  "https://music-api.gdstudio.xyz/api.php",
  "https://music.gdstudio.xyz/api.php",
];

const SOLARA_VERSION = 1;
const FETCH_TIMEOUT_MS = 7000;
const SEARCH_CONCURRENCY = 4;
const GD_VERSION = "2025.11.4";

type SourceMode = "auto" | "netease" | "qq" | "kuwo";

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const inputUrl = String(body.url || "").trim();
    const mode = normalizeMode(String(body.mode || "auto"));
    const count = clampInteger(Number.parseInt(String(body.count || "10"), 10), 1, 30, 10);
    const limit = clampInteger(Number.parseInt(String(body.limit || "50"), 10), 1, 200, 50);

    if (!inputUrl) {
      return jsonResponse({ ok: false, error: "请输入歌单链接" }, 400);
    }

    const sourceMode = mode === "auto" ? detectModeFromUrl(inputUrl) : mode;
    const rawItems = await fetchPlaylistFromUrl(inputUrl);
    const tracks = extractTracks(rawItems).slice(0, limit);

    if (tracks.length === 0) {
      return jsonResponse({ ok: false, error: "没有识别到歌曲。请确认粘贴的是完整歌单链接。" }, 400);
    }

    const results = await convertTracksInBatches(tracks, sourceMode, count);
    const converted = results.flatMap((item) => item.converted ? [item.converted] : []);
    const missing = results.flatMap((item) => item.missing ? [item.missing] : []);

    const stamp = timestamp();
    const payload = {
      meta: {
        app: "Solara",
        version: SOLARA_VERSION,
        exportedAt: new Date().toISOString(),
        itemCount: converted.length,
        sourceMode,
        outputSource: sourceMode === "qq" ? "kuwo" : sourceMode,
        missingCount: missing.length,
        inputUrl,
      },
      items: converted,
    };

    return jsonResponse({
      ok: true,
      payload,
      missing: { missing },
      filenames: {
        playlist: `solara-playlist-${sourceMode}-to-${sourceMode === "qq" ? "kuwo" : sourceMode}-${stamp}.json`,
        missing: `solara-playlist-${sourceMode}-to-${sourceMode === "qq" ? "kuwo" : sourceMode}-${stamp}-not-found.json`,
      },
      summary: {
        total: tracks.length,
        converted: converted.length,
        missing: missing.length,
        sourceMode,
      },
      warning: converted.length === 0
        ? "没有成功转换任何歌曲。Solara JSON 为空，请下载未匹配报告查看原因。"
        : "",
    });
  } catch (error: any) {
    return jsonResponse({
      ok: false,
      error: error?.message || "转换失败",
    }, 500);
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders() });
};

async function convertTracksInBatches(tracks: any[], sourceMode: Exclude<SourceMode, "auto">, count: number) {
  const output: any[] = new Array(tracks.length);

  for (let start = 0; start < tracks.length; start += SEARCH_CONCURRENCY) {
    const batch = tracks.slice(start, start + SEARCH_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map((rawTrack, offset) => convertOneTrack(rawTrack, start + offset, sourceMode, count)),
    );

    batchResults.forEach((item, offset) => {
      output[start + offset] = item;
    });
  }

  return output;
}

async function convertOneTrack(rawTrack: any, index: number, sourceMode: Exclude<SourceMode, "auto">, count: number) {
  const track = normalizeTrack(rawTrack);

  if (!track.name) {
    return {
      missing: {
        index: index + 1,
        reason: "missing song name",
        raw: rawTrack,
      },
    };
  }

  if (sourceMode === "netease" && track.id && isLikelyNumericId(track.id)) {
    return {
      converted: toSolaraSong({
        id: track.id,
        name: track.name,
        artist: track.artist,
        album: track.album,
        pic_id: track.picId,
        url_id: track.id,
        lyric_id: track.id,
        source: "netease",
      }),
    };
  }

  const targetSource = sourceMode === "qq" ? "kuwo" : sourceMode;
  const keywords = buildSearchKeywords(track);
  const tried: any[] = [];
  let best: { song: any; score: number; keyword: string; resultCount: number } | null = null;

  for (const keyword of keywords) {
    try {
      const results = await searchMusic(keyword, targetSource, count);
      const match = pickBestMatch(track, results, keyword);

      tried.push({
        source: targetSource,
        keyword,
        resultCount: results.length,
        bestScore: match?.score || 0,
        sample: results.slice(0, 2).map((item: any) => ({
          id: item?.id,
          name: item?.name,
          artist: item?.artist,
          source: item?.source,
        })),
      });

      if (match && (!best || match.score > best.score)) {
        best = {
          song: match.song,
          score: match.score,
          keyword,
          resultCount: results.length,
        };
      }

      if (best && best.score >= 60) {
        break;
      }
    } catch (error: any) {
      tried.push({
        source: targetSource,
        keyword,
        error: error?.message || String(error),
      });
    }
  }

  if (best && best.score >= 35) {
    return {
      converted: toSolaraSong({ ...best.song, source: targetSource }),
    };
  }

  return {
    missing: {
      index: index + 1,
      reason: tried.some((item) => item.error) ? "search failed or no reliable kuwo match" : "not found on kuwo",
      tried,
      name: track.name,
      artist: track.artist,
      album: track.album,
      raw: rawTrack,
    },
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function normalizeMode(value: string): SourceMode {
  const normalized = value.trim().toLowerCase();

  if (normalized === "auto") return "auto";
  if (normalized === "qq" || normalized === "tencent") return "qq";
  if (normalized === "netease" || normalized === "163") return "netease";
  if (normalized === "kuwo") return "kuwo";

  throw new Error(`不支持的来源：${value}`);
}

function detectModeFromUrl(url: string): Exclude<SourceMode, "auto"> {
  if (isQqMusicUrl(url)) return "qq";
  if (/kuwo|kuwo\.cn/i.test(url)) return "kuwo";
  return "netease";
}

async function fetchPlaylistFromUrl(url: string) {
  if (isQqMusicUrl(url)) {
    return fetchQqPlaylistFromUrl(url);
  }

  return fetchNetEasePlaylistFromUrl(url);
}

function isQqMusicUrl(url: string) {
  return /(^|\/\/|\.)(y|i2?)\.qq\.com/i.test(url);
}

async function fetchQqPlaylistFromUrl(url: string) {
  const playlistId = extractQqPlaylistId(url);

  if (!playlistId) {
    throw new Error(`无法从 QQ 音乐链接中识别歌单 ID：${url}`);
  }

  const params = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    disstid: playlistId,
    format: "json",
    g_tk: "5381",
    loginUin: "0",
    hostUin: "0",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0",
  });

  const data = await fetchJsonWithTimeout(
    `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${params.toString()}`,
    { headers: qqMusicHeaders() },
    FETCH_TIMEOUT_MS,
  );

  const playlist = data?.cdlist?.[0];

  if (!playlist || !Array.isArray(playlist.songlist)) {
    throw new Error(`QQ 音乐歌单返回异常：${JSON.stringify(data).slice(0, 180)}`);
  }

  return playlist.songlist;
}

function extractQqPlaylistId(url: string) {
  const text = url.trim();

  const query = text.match(/[?&](?:id|disstid)=([0-9]+)/);
  if (query) return query[1];

  const ryqq = text.match(/\/ryqq\/playlist\/([0-9]+)/);
  if (ryqq) return ryqq[1];

  const pathMatch = text.match(/\/playlist\/([0-9]+)/);
  if (pathMatch) return pathMatch[1];

  const encoded = text.match(/playlist%2F([0-9]+)/i);
  if (encoded) return encoded[1];

  const direct = text.match(/^[0-9]+$/);
  return direct ? direct[0] : "";
}

function qqMusicHeaders() {
  return {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://y.qq.com/",
    "Origin": "https://y.qq.com",
  };
}

async function fetchNetEasePlaylistFromUrl(url: string) {
  const playlistId = extractNetEasePlaylistId(url);

  if (!playlistId) {
    throw new Error(`无法从网易云链接中识别歌单 ID：${url}`);
  }

  const playlist = await fetchNetEasePlaylist(playlistId);
  const trackIds = Array.isArray(playlist.trackIds)
    ? playlist.trackIds.map((item: any) => item && item.id).filter(Boolean)
    : [];

  if (trackIds.length === 0) {
    return Array.isArray(playlist.tracks) ? playlist.tracks : [];
  }

  const tracks: any[] = [];
  const batchSize = 200;

  for (let index = 0; index < trackIds.length; index += batchSize) {
    const batch = trackIds.slice(index, index + batchSize);
    const details = await fetchNetEaseSongDetails(batch);
    tracks.push(...details);
  }

  return tracks;
}

function extractNetEasePlaylistId(url: string) {
  const text = url.trim();

  const direct = text.match(/(?:playlist\?id=|[?&]id=)([0-9]+)/);
  if (direct) return direct[1];

  const path = text.match(/\/playlist\/([0-9]+)/);
  if (path) return path[1];

  const numeric = text.match(/^[0-9]+$/);
  return numeric ? numeric[0] : "";
}

async function fetchNetEasePlaylist(id: string) {
  const text = await fetchTextWithTimeout(
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}`,
    { headers: netEaseHeaders() },
    FETCH_TIMEOUT_MS,
  );

  const data = parseNetEaseJson(text);

  if (!data || data.code !== 200 || !data.playlist) {
    throw new Error(`网易云歌单返回异常：${JSON.stringify(data).slice(0, 180)}`);
  }

  return data.playlist;
}

async function fetchNetEaseSongDetails(ids: any[]) {
  const text = await fetchTextWithTimeout(
    `https://music.163.com/api/song/detail?ids=[${ids.join(",")}]`,
    { headers: netEaseHeaders() },
    FETCH_TIMEOUT_MS,
  );

  const data = parseNetEaseJson(text);
  return Array.isArray(data.songs) ? data.songs : [];
}

function parseNetEaseJson(text: string) {
  const protectedText = text.replace(
    /("(?:id|pic|picId|picid|albumId|copyrightId|commentThreadId|trackNumberUpdateTime|subscribedCount|playCount|shareCount|commentCount)"\s*:\s*)(-?\d{16,})/g,
    '$1"$2"',
  );

  return JSON.parse(protectedText);
}

function netEaseHeaders() {
  return {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://music.163.com/",
  };
}

function extractTracks(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of ["items", "songs", "tracks", "playlist", "data", "list"]) {
    const value = payload[key];

    if (Array.isArray(value)) return value;

    if (value && typeof value === "object") {
      const nested = extractTracks(value);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function normalizeTrack(raw: any) {
  const name = firstString(raw?.name, raw?.songname, raw?.songName, raw?.title, raw?.song_title);
  const id = firstString(raw?.id, raw?.songid, raw?.songmid, raw?.mid, raw?.musicId);
  const album = normalizeAlbum(raw?.album, raw?.albumname, raw?.albumName, raw?.al);
  const artist = normalizeArtists(raw?.artist, raw?.artists, raw?.singer, raw?.singers, raw?.ar);
  const picId = firstString(
    raw?.pic_id,
    raw?.picId_str,
    raw?.pic_id_str,
    raw?.pic_str,
    raw?.album?.picId_str,
    raw?.album?.pic_id_str,
    raw?.album?.pic_str,
    raw?.album?.picId,
    raw?.album?.pic,
    raw?.al?.picId_str,
    raw?.al?.pic_id_str,
    raw?.al?.pic_str,
    raw?.al?.picId,
    raw?.al?.pic,
    raw?.picId,
    raw?.pic,
  );

  return { id, name, artist, album, picId };
}

function firstString(...values: any[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return String(value);
  }

  return "";
}

function normalizeAlbum(...values: any[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();

    if (value && typeof value === "object") {
      const name = firstString(value.name, value.title, value.albumname);
      if (name) return name;
    }
  }

  return "";
}

function normalizeArtists(...values: any[]): string[] {
  for (const value of values) {
    const artists = artistsFromValue(value);
    if (artists.length > 0) return artists;
  }

  return [];
}

function artistsFromValue(value: any): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(artistsFromValue).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/\s*[/,、&]\s*/).map((item) => item.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    const name = firstString(value.name, value.title, value.singername, value.singerName);
    return name ? [name] : [];
  }

  return [];
}

function isLikelyNumericId(value: any) {
  return /^[0-9]+$/.test(String(value));
}

function buildSearchKeywords(track: any) {
  const name = firstString(track.name);
  const artist = firstString(track.artist?.[0]);
  const cleanName = removeBracketText(name);

  return Array.from(new Set([
    [name, artist].filter(Boolean).join(" "),
    [cleanName, artist].filter(Boolean).join(" "),
    name,
    cleanName,
  ].map((item) => item.trim()).filter(Boolean)));
}

async function searchMusic(keyword: string, source: string, count: number) {
  const attempts = buildSearchRequests(keyword, source, count);
  let lastError: any = null;

  for (const attempt of attempts) {
    try {
      const text = await fetchTextWithTimeout(attempt.url, attempt.init, FETCH_TIMEOUT_MS);
      const data = parseApiResponse(text);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.result)) return data.result;
      return [];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("search failed");
}

function buildSearchRequests(keyword: string, source: string, count: number) {
  const baseParams = {
    types: "search",
    source,
    name: keyword,
    count: String(count),
    pages: "1",
  };

  const randomS = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const requests: Array<{ url: string; init: RequestInit }> = [];

  for (const endpoint of API_ENDPOINTS) {
    const endpointHost = safeHostname(endpoint);
    const signedS = yieldSignature(keyword, endpointHost);

    const getParams = new URLSearchParams({
      ...baseParams,
      s: randomS,
    });

    requests.push({
      url: `${endpoint}?${getParams.toString()}`,
      init: {
        method: "GET",
        headers: { Accept: "application/json,text/plain,*/*" },
      },
    });

    const callback = yieldCallback();
    const jsonpGetParams = new URLSearchParams({
      ...baseParams,
      callback,
      _: String(Date.now()),
      s: signedS,
    });

    requests.push({
      url: `${endpoint}?${jsonpGetParams.toString()}`,
      init: {
        method: "GET",
        headers: { Accept: "*/*" },
      },
    });

    const callback2 = yieldCallback();
    const body = new URLSearchParams({
      ...baseParams,
      s: signedS,
    });

    requests.push({
      url: `${endpoint}?callback=${encodeURIComponent(callback2)}`,
      init: {
        method: "POST",
        headers: {
          "Accept": "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0",
        },
        body: body.toString(),
      },
    });
  }

  return requests;
}

function parseApiResponse(text: string) {
  const raw = text.trim();

  if (raw.startsWith("[") || raw.startsWith("{")) {
    return JSON.parse(raw);
  }

  const start = raw.indexOf("(");
  const end = raw.lastIndexOf(")");

  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(raw.slice(start + 1, end));
  }

  throw new Error(`API 返回不是 JSON/JSONP：${raw.slice(0, 100)}`);
}

function yieldCallback() {
  const digits = Array.from({ length: 21 }, () => Math.floor(Math.random() * 10)).join("");
  return `jQuery${digits}_${Date.now()}`;
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "music.gdstudio.xyz";
  }
}

function yieldSignature(idValue: string, hostname: string) {
  const ts9 = String(Date.now()).slice(0, 9);
  const versionPadded = GD_VERSION.split(".").map((part) => part.length === 1 ? `0${part}` : part).join("");
  const src = `${hostname}|${versionPadded}|${ts9}|${encodeURIComponent(String(idValue))}`;
  return md5(src).slice(-8).toUpperCase();
}

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS) {
  const text = await fetchTextWithTimeout(url, init, ms);
  return JSON.parse(text);
}

async function fetchTextWithTimeout(url: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), ms);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function pickBestMatch(track: any, results: any[], keyword = "") {
  const scored = results
    .map((song) => ({ song, score: scoreMatch(track, song, keyword) }))
    .filter((entry) => entry.score >= 25)
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function scoreMatch(track: any, song: any, keyword = "") {
  const wantedName = normalizeText(track.name);
  const wantedNameClean = normalizeText(removeBracketText(track.name));
  const foundName = normalizeText(song.name);

  if (!foundName || (!wantedName && !wantedNameClean)) return 0;

  let score = 0;

  if (wantedName && wantedName === foundName) {
    score += 75;
  } else if (wantedNameClean && wantedNameClean === foundName) {
    score += 70;
  } else if (wantedName && (wantedName.includes(foundName) || foundName.includes(wantedName))) {
    score += 50;
  } else if (wantedNameClean && (wantedNameClean.includes(foundName) || foundName.includes(wantedNameClean))) {
    score += 48;
  } else if (keyword && normalizeText(keyword).includes(foundName)) {
    score += 38;
  }

  const wantedArtists = track.artist.map(normalizeText).filter(Boolean);
  const foundArtists = normalizeArtists(song.artist, song.artists, song.singer).map(normalizeText).filter(Boolean);

  if (wantedArtists.length === 0 || foundArtists.length === 0) {
    score += 8;
  } else if (wantedArtists.some((wanted: string) => foundArtists.some((found: string) => wanted === found || wanted.includes(found) || found.includes(wanted)))) {
    score += 30;
  }

  const wantedAlbum = normalizeText(track.album);
  const foundAlbum = normalizeText(normalizeAlbum(song.album));

  if (wantedAlbum && foundAlbum && (wantedAlbum === foundAlbum || wantedAlbum.includes(foundAlbum) || foundAlbum.includes(wantedAlbum))) {
    score += 8;
  }

  return score;
}

function removeBracketText(value: any) {
  return String(value || "").replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, "").trim();
}

function normalizeText(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toSolaraSong(song: any) {
  const id = firstString(song.id, song.url_id, song.lyric_id);

  return {
    id,
    name: firstString(song.name),
    artist: normalizeArtists(song.artist, song.artists, song.singer),
    album: normalizeAlbum(song.album),
    pic_id: firstString(song.pic_id, song.picId, song.pic, id),
    url_id: firstString(song.url_id, id),
    lyric_id: firstString(song.lyric_id, id),
    source: "kuwo",
  };
}

function timestamp() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/* Minimal MD5 implementation for GDStudio signed requests */
function md5(input: string) {
  function rotateLeft(value: number, shift: number) {
    return (value << shift) | (value >>> (32 - shift));
  }

  function addUnsigned(x: number, y: number) {
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const result = (x & 0x3fffffff) + (y & 0x3fffffff);

    if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (result & 0x40000000) return result ^ 0xc0000000 ^ x8 ^ y8;
      return result ^ 0x40000000 ^ x8 ^ y8;
    }

    return result ^ x8 ^ y8;
  }

  function f(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function g(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function h(x: number, y: number, z: number) { return x ^ y ^ z; }
  function i(x: number, y: number, z: number) { return y ^ (x | ~z); }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function gg(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function hh(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function ii(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(str: string) {
    const wordArray: number[] = [];
    const utf8 = unescape(encodeURIComponent(str));
    const messageLength = utf8.length;
    const numberOfWordsTemp1 = messageLength + 8;
    const numberOfWordsTemp2 = (numberOfWordsTemp1 - (numberOfWordsTemp1 % 64)) / 64;
    const numberOfWords = (numberOfWordsTemp2 + 1) * 16;

    for (let j = 0; j < numberOfWords; j += 1) wordArray[j] = 0;

    let byteCount = 0;

    while (byteCount < messageLength) {
      const wordCount = (byteCount - (byteCount % 4)) / 4;
      const bytePosition = (byteCount % 4) * 8;
      wordArray[wordCount] = wordArray[wordCount] | (utf8.charCodeAt(byteCount) << bytePosition);
      byteCount += 1;
    }

    const wordCount = (byteCount - (byteCount % 4)) / 4;
    const bytePosition = (byteCount % 4) * 8;
    wordArray[wordCount] = wordArray[wordCount] | (0x80 << bytePosition);
    wordArray[numberOfWords - 2] = messageLength << 3;
    wordArray[numberOfWords - 1] = messageLength >>> 29;

    return wordArray;
  }

  function wordToHex(value: number) {
    let output = "";
    for (let count = 0; count <= 3; count += 1) {
      const byte = (value >>> (count * 8)) & 255;
      output += `0${byte.toString(16)}`.slice(-2);
    }
    return output;
  }

  const x = convertToWordArray(input);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let k = 0; k < x.length; k += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;

    a = ff(a, b, c, d, x[k + 0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[k + 2], 17, 0x242070db);
    b = ff(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[k + 5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[k + 6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[k + 8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[k + 12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[k + 13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[k + 14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[k + 15], 22, 0x49b40821);

    a = gg(a, b, c, d, x[k + 1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[k + 6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[k + 11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[k + 5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[k + 10], 9, 0x02441453);
    c = gg(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[k + 14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[k + 7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

    a = hh(a, b, c, d, x[k + 5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[k + 8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[k + 1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[k + 2], 23, 0xc4ac5665);

    a = ii(a, b, c, d, x[k + 0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[k + 7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[k + 14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[k + 12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[k + 10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[k + 6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[k + 4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[k + 11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[k + 9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

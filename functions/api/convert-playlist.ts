const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";
const SOLARA_VERSION = 1;
const FETCH_TIMEOUT_MS = 8000;
const SEARCH_CONCURRENCY = 5;

type SourceMode = "auto" | "netease" | "qq" | "kuwo" | "tencent";

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const inputUrl = String(body.url || "").trim();
    const mode = normalizeMode(String(body.mode || "auto"));
    const count = clampInteger(Number.parseInt(String(body.count || "10"), 10), 1, 30, 10);
    const limit = clampInteger(Number.parseInt(String(body.limit || "50"), 10), 1, 300, 50);

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
        playlist: `solara-playlist-${sourceMode}-${stamp}.json`,
        missing: `solara-playlist-${sourceMode}-${stamp}-not-found.json`,
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

  if (sourceMode === "qq" || sourceMode === "tencent") {
    const directQqSong = qqTrackToSolaraSong(rawTrack, track);

    if (directQqSong) {
      return { converted: directQqSong };
    }

    return {
      missing: {
        index: index + 1,
        reason: "QQ songmid missing",
        name: track.name,
        artist: track.artist,
        album: track.album,
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

  const keywords = buildSearchKeywords(track);
  const tried: any[] = [];

  for (const keyword of keywords) {
    try {
      const results = await searchMusic(keyword, sourceMode, count);
      const match = pickBestMatch(track, results, keyword);

      tried.push({
        source: sourceMode,
        keyword,
        resultCount: results.length,
        bestScore: match?.score || 0,
        sample: results.slice(0, 2).map((item: any) => ({
          name: item?.name,
          artist: item?.artist,
          source: item?.source,
        })),
      });

      if (match && match.score >= 40) {
        return {
          converted: toSolaraSong({ ...match.song, source: match.song.source || sourceMode }),
        };
      }
    } catch (error: any) {
      tried.push({
        source: sourceMode,
        keyword,
        error: error?.message || String(error),
      });
    }
  }

  return {
    missing: {
      index: index + 1,
      reason: tried.some((item) => item.error) ? "search failed or timed out" : "not found",
      tried,
      name: track.name,
      artist: track.artist,
      album: track.album,
      raw: rawTrack,
    },
  };
}

function qqTrackToSolaraSong(raw: any, track: any) {
  const songMid = firstString(
    raw?.songmid,
    raw?.mid,
    raw?.strMediaMid,
    raw?.media_mid,
    raw?.file?.media_mid,
    raw?.id,
  );

  if (!songMid) {
    return null;
  }

  const albumMid = firstString(
    raw?.albummid,
    raw?.album?.mid,
    raw?.album?.pmid,
    raw?.album?.id,
  );

  return {
    id: songMid,
    name: track.name,
    artist: track.artist,
    album: track.album,
    pic_id: albumMid || track.picId || songMid,
    url_id: songMid,
    lyric_id: songMid,
    source: "tencent",
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
    raw?.albummid,
    raw?.album?.mid,
    raw?.album?.pmid,
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
    cleanName,
  ].map((item) => item.trim()).filter(Boolean)));
}

async function searchMusic(keyword: string, source: string, count: number) {
  const signature = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    types: "search",
    source,
    name: keyword,
    count: String(count),
    pages: "1",
    s: signature,
  });

  const data = await fetchJsonWithTimeout(
    `${API_BASE_URL}?${params.toString()}`,
    { headers: { Accept: "application/json" } },
    FETCH_TIMEOUT_MS,
  );

  return Array.isArray(data) ? data : [];
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
    .filter((entry) => entry.score >= 35)
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
    source: firstString(song.source, "netease"),
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

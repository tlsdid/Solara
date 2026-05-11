const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";
const SOLARA_VERSION = 1;

type SourceMode = "auto" | "netease" | "qq" | "kuwo";

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const body = (await request.json()) as any;
    const inputUrl = String(body.url || "").trim();
    const mode = normalizeMode(body.mode || "auto");
    const count = clampInteger(Number.parseInt(String(body.count || "10"), 10), 1, 30, 10);
    const limit = clampInteger(Number.parseInt(String(body.limit || "120"), 10), 1, 300, 120);

    if (!inputUrl) {
      return jsonResponse({ ok: false, error: "请输入歌单链接" }, 400);
    }

    const sourceMode = mode === "auto" ? detectModeFromUrl(inputUrl) : mode;
    const rawItems = await fetchPlaylistFromUrl(inputUrl);
    const tracks = extractTracks(rawItems).slice(0, limit);

    if (tracks.length === 0) {
      return jsonResponse({ ok: false, error: "没有识别到歌曲" }, 400);
    }

    const converted: any[] = [];
    const missing: any[] = [];

    for (let index = 0; index < tracks.length; index += 1) {
      const rawTrack = tracks[index];
      const track = normalizeTrack(rawTrack);

      if (!track.name) {
        missing.push({
          index: index + 1,
          reason: "missing song name",
          raw: rawTrack,
        });
        continue;
      }

      if (sourceMode === "netease" && track.id && isLikelyNumericId(track.id)) {
        converted.push(toSolaraSong({
          id: track.id,
          name: track.name,
          artist: track.artist,
          album: track.album,
          pic_id: track.picId,
          source: "netease",
        }));
        continue;
      }

      const searchSource = sourceMode === "qq" ? "kuwo" : sourceMode;
      const keyword = buildSearchKeyword(track);

      let results: any[] = [];

      try {
        results = await searchMusic(keyword, searchSource, count);
      } catch (error: any) {
        missing.push({
          index: index + 1,
          reason: `search failed on ${searchSource}: ${error?.message || String(error)}`,
          keyword,
          name: track.name,
          artist: track.artist,
          album: track.album,
          raw: rawTrack,
        });
        continue;
      }

      const match = pickBestMatch(track, results);

      if (!match) {
        missing.push({
          index: index + 1,
          reason: `not found on ${searchSource}`,
          keyword,
          name: track.name,
          artist: track.artist,
          album: track.album,
          raw: rawTrack,
        });
        continue;
      }

      converted.push(toSolaraSong({ ...match, source: searchSource }));
    }

    if (converted.length === 0) {
      return jsonResponse({
        ok: false,
        error: "没有成功转换任何歌曲。请下载未匹配报告或改用其他来源。",
        missing: { missing },
        summary: {
          total: tracks.length,
          converted: converted.length,
          missing: missing.length,
          sourceMode,
        },
      }, 422);
    }

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

    const stamp = timestamp();

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
    });
  } catch (error: any) {
    return jsonResponse({
      ok: false,
      error: error?.message || "转换失败",
    }, 500);
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
};

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
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "auto") return "auto";
  if (normalized === "qq" || normalized === "tencent") return "qq";
  if (normalized === "netease" || normalized === "163") return "netease";
  if (normalized === "kuwo") return "kuwo";

  throw new Error(`不支持的来源：${value}`);
}

function detectModeFromUrl(url: string): Exclude<SourceMode, "auto"> {
  if (isQqMusicUrl(url)) return "qq";
  if (/kuwo|kwai|kuwo\.cn/i.test(url)) return "kuwo";
  return "netease";
}

async function fetchPlaylistFromUrl(url: string) {
  if (isQqMusicUrl(url)) {
    return fetchQqPlaylistFromUrl(url);
  }

  return fetchNetEasePlaylistFromUrl(url);
}

function isQqMusicUrl(url: string) {
  return /(^|\/\/|\.)(y|i2?)\.qq\.com/i.test(String(url || ""));
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

  const response = await fetch(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${params.toString()}`, {
    headers: qqMusicHeaders(),
  });

  if (!response.ok) {
    throw new Error(`QQ 音乐歌单请求失败：${response.status}`);
  }

  const data = await response.json();
  const playlist = data?.cdlist?.[0];

  if (!playlist || !Array.isArray(playlist.songlist)) {
    throw new Error("QQ 音乐歌单返回异常");
  }

  return playlist.songlist;
}

function extractQqPlaylistId(url: string) {
  const text = String(url || "").trim();
  const query = text.match(/[?&]id=(\d+)/);
  if (query) return query[1];

  const pathMatch = text.match(/\/playlist\/(\d+)/);
  if (pathMatch) return pathMatch[1];

  const numericPath = text.match(/\/(\d+)(?:[/?#]|$)/);
  if (numericPath) return numericPath[1];

  const direct = text.match(/^\d+$/);
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
  const text = String(url || "").trim();
  const direct = text.match(/(?:playlist\?id=|[?&]id=)(\d+)/);
  if (direct) return direct[1];

  const numericPath = text.match(/\/playlist\/(\d+)/);
  if (numericPath) return numericPath[1];

  const numeric = text.match(/^\d+$/);
  return numeric ? numeric[0] : "";
}

async function fetchNetEasePlaylist(id: string) {
  const response = await fetch(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}`, {
    headers: netEaseHeaders(),
  });

  if (!response.ok) {
    throw new Error(`网易云歌单请求失败：${response.status}`);
  }

  const data = parseNetEaseJson(await response.text());

  if (!data || data.code !== 200 || !data.playlist) {
    throw new Error("网易云歌单返回异常");
  }

  return data.playlist;
}

async function fetchNetEaseSongDetails(ids: any[]) {
  const response = await fetch(`https://music.163.com/api/song/detail?ids=[${ids.join(",")}]`, {
    headers: netEaseHeaders(),
  });

  if (!response.ok) {
    throw new Error(`网易云歌曲详情请求失败：${response.status}`);
  }

  const data = parseNetEaseJson(await response.text());
  return Array.isArray(data.songs) ? data.songs : [];
}

function parseNetEaseJson(text: string) {
  const protectedText = String(text).replace(
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
  return /^\d+$/.test(String(value));
}

function buildSearchKeyword(track: any) {
  return [track.name, track.artist?.[0] || ""].filter(Boolean).join(" ");
}

async function searchMusic(keyword: string, source: string, count: number) {
  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const signature = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const params = new URLSearchParams({
        types: "search",
        source,
        name: keyword,
        count: String(count),
        pages: "1",
        s: signature,
      });

      const response = await fetch(`${API_BASE_URL}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`搜索失败：${keyword}，HTTP ${response.status}`);
      }

      const data = await response.json();
      await delay(80);

      return Array.isArray(data) ? data : [];
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(300 * attempt);
      }
    }
  }

  throw lastError || new Error(`搜索失败：${keyword}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestMatch(track: any, results: any[]) {
  const scored = results
    .map((song) => ({ song, score: scoreMatch(track, song) }))
    .filter((entry) => entry.score >= 60)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.song || null;
}

function scoreMatch(track: any, song: any) {
  const wantedName = normalizeText(track.name);
  const foundName = normalizeText(song.name);

  if (!wantedName || !foundName) return 0;

  let score = 0;

  if (wantedName === foundName) {
    score += 70;
  } else if (wantedName.includes(foundName) || foundName.includes(wantedName)) {
    score += 45;
  }

  const wantedArtists = track.artist.map(normalizeText).filter(Boolean);
  const foundArtists = normalizeArtists(song.artist, song.artists, song.singer).map(normalizeText).filter(Boolean);

  if (wantedArtists.length === 0 || foundArtists.length === 0) {
    score += 10;
  } else if (wantedArtists.some((wanted: string) => foundArtists.some((found: string) => wanted === found || wanted.includes(found) || found.includes(wanted)))) {
    score += 30;
  }

  const wantedAlbum = normalizeText(track.album);
  const foundAlbum = normalizeText(normalizeAlbum(song.album));

  if (wantedAlbum && foundAlbum && (wantedAlbum === foundAlbum || wantedAlbum.includes(foundAlbum) || foundAlbum.includes(wantedAlbum))) {
    score += 10;
  }

  return score;
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

#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";
const SOLARA_VERSION = 1;

const args = parseArgs(process.argv.slice(2));

if ((!args.input && !args.url) || args.help) {
    printUsage();
    process.exit(args.help ? 0 : 1);
}

const mode = normalizeMode(args.mode || args.source || "qq");
const inputPath = args.input ? path.resolve(args.input) : "";
const outputPath = path.resolve(args.output || defaultOutputPath(mode));
const missingPath = path.resolve(args.missing || defaultMissingPath(mode));
const count = clampInteger(Number.parseInt(args.count || "10", 10), 1, 30, 10);

const rawItems = args.url
    ? await fetchPlaylistFromUrl(args.url)
    : parseInput(await fs.readFile(inputPath, "utf8"), inputPath);
const tracks = extractTracks(rawItems);

if (tracks.length === 0) {
    throw new Error("No songs found in input file.");
}

const converted = [];
const missing = [];

for (let index = 0; index < tracks.length; index += 1) {
    const rawTrack = tracks[index];
    const track = normalizeTrack(rawTrack);
    const displayIndex = `${index + 1}/${tracks.length}`;

    if (!track.name) {
        missing.push({ index: index + 1, reason: "missing song name", raw: rawTrack });
        console.log(`[${displayIndex}] skipped: missing song name`);
        continue;
    }

    if (mode === "netease" && track.id && isLikelyNumericId(track.id)) {
        converted.push(toSolaraSong({
            id: track.id,
            name: track.name,
            artist: track.artist,
            album: track.album,
            pic_id: track.picId,
            source: "netease",
        }));
        console.log(`[${displayIndex}] netease direct: ${track.name}`);
        continue;
    }

    const searchSource = mode === "qq" ? "kuwo" : mode;
    const keyword = buildSearchKeyword(track);
    const results = await searchMusic(keyword, searchSource, count);
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
        console.log(`[${displayIndex}] not found on ${searchSource}: ${keyword}`);
        continue;
    }

    converted.push(toSolaraSong({ ...match, source: searchSource }));
    console.log(`[${displayIndex}] matched ${searchSource}: ${track.name} -> ${match.name}`);
}

const payload = {
    meta: {
        app: "Solara",
        version: SOLARA_VERSION,
        exportedAt: new Date().toISOString(),
        itemCount: converted.length,
        sourceMode: mode,
        missingCount: missing.length,
    },
    items: converted,
};

await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await fs.writeFile(missingPath, `${JSON.stringify({ missing }, null, 2)}\n`, "utf8");

console.log("");
console.log(`Done. Converted: ${converted.length}; not found: ${missing.length}`);
console.log(`Solara playlist: ${outputPath}`);
console.log(`Not found report: ${missingPath}`);

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            parsed.help = true;
            continue;
        }
        if (!arg.startsWith("--")) {
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            parsed[key] = "true";
            continue;
        }
        parsed[key] = next;
        i += 1;
    }
    return parsed;
}

function printUsage() {
    console.log([
        "Usage:",
        "  node tools/convert-playlist-to-solara.mjs --input playlist.json --mode qq",
        "  node tools/convert-playlist-to-solara.mjs --url https://music.163.com/playlist?id=123 --mode netease",
        "",
        "Options:",
        "  --mode qq       Search every input song on Kuwo and output source=kuwo.",
        "  --mode netease  Use NetEase IDs directly when present, otherwise search NetEase.",
        "  --mode kuwo     Search every input song on Kuwo.",
        "  --output path   Solara JSON output path.",
        "  --missing path  Not-found report path.",
    ].join("\n"));
}

function normalizeMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "qq" || normalized === "tencent") return "qq";
    if (normalized === "netease" || normalized === "163") return "netease";
    if (normalized === "kuwo") return "kuwo";
    throw new Error(`Unsupported mode: ${value}`);
}

async function fetchPlaylistFromUrl(url) {
    if (isQqMusicUrl(url)) {
        return fetchQqPlaylistFromUrl(url);
    }

    return fetchNetEasePlaylistFromUrl(url);
}

async function fetchNetEasePlaylistFromUrl(url) {
    const playlistId = extractNetEasePlaylistId(url);
    if (!playlistId) {
        throw new Error(`Could not find a NetEase playlist id in URL: ${url}`);
    }
    const playlist = await fetchNetEasePlaylist(playlistId);
    const trackIds = Array.isArray(playlist.trackIds)
        ? playlist.trackIds.map((item) => item && item.id).filter(Boolean)
        : [];

    if (trackIds.length === 0) {
        return Array.isArray(playlist.tracks) ? playlist.tracks : [];
    }

    const tracks = [];
    const batchSize = 200;
    for (let index = 0; index < trackIds.length; index += batchSize) {
        const batch = trackIds.slice(index, index + batchSize);
        const details = await fetchNetEaseSongDetails(batch);
        tracks.push(...details);
        console.log(`Fetched NetEase details: ${Math.min(index + batch.length, trackIds.length)}/${trackIds.length}`);
    }

    return tracks;
}

function isQqMusicUrl(url) {
    return /(^|\/\/|\.)(y|i2?)\.qq\.com/i.test(String(url || ""));
}

async function fetchQqPlaylistFromUrl(url) {
    const playlistId = extractQqPlaylistId(url);
    if (!playlistId) {
        throw new Error(`Could not find a QQ Music playlist id in URL: ${url}`);
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
        throw new Error(`QQ Music playlist request failed (${response.status})`);
    }

    const data = await response.json();
    const playlist = data?.cdlist?.[0];
    if (!playlist || !Array.isArray(playlist.songlist)) {
        throw new Error(`QQ Music playlist request returned an invalid response: ${JSON.stringify(data).slice(0, 160)}`);
    }

    console.log(`Recognized QQ Music playlist: ${playlist.dissname || playlistId}`);
    console.log(`Track count: ${playlist.songnum || playlist.songlist.length}`);
    return playlist.songlist;
}

function extractQqPlaylistId(url) {
    const text = String(url || "").trim();
    const query = text.match(/[?&]id=(\d+)/);
    if (query) return query[1];
    const pathMatch = text.match(/\/playlist\/(\d+)/);
    if (pathMatch) return pathMatch[1];
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

function extractNetEasePlaylistId(url) {
    const text = String(url || "").trim();
    const direct = text.match(/(?:playlist\?id=|[?&]id=)(\d+)/);
    if (direct) return direct[1];
    const numeric = text.match(/^\d+$/);
    return numeric ? numeric[0] : "";
}

async function fetchNetEasePlaylist(id) {
    const response = await fetch(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}`, {
        headers: netEaseHeaders(),
    });
    if (!response.ok) {
        throw new Error(`NetEase playlist request failed (${response.status})`);
    }
    const data = await response.json();
    if (!data || data.code !== 200 || !data.playlist) {
        throw new Error(`NetEase playlist request returned an invalid response: ${JSON.stringify(data).slice(0, 160)}`);
    }
    console.log(`Recognized NetEase playlist: ${data.playlist.name || id}`);
    console.log(`Track count: ${data.playlist.trackCount || "unknown"}; available IDs: ${data.playlist.trackIds?.length || 0}`);
    return data.playlist;
}

async function fetchNetEaseSongDetails(ids) {
    const response = await fetch(`https://music.163.com/api/song/detail?ids=[${ids.join(",")}]`, {
        headers: netEaseHeaders(),
    });
    if (!response.ok) {
        throw new Error(`NetEase song detail request failed (${response.status})`);
    }
    const data = await response.json();
    return Array.isArray(data.songs) ? data.songs : [];
}

function netEaseHeaders() {
    return {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://music.163.com/",
    };
}

function defaultOutputPath(mode) {
    return `solara-playlist-${mode}-${timestamp()}.json`;
}

function defaultMissingPath(mode) {
    return `solara-playlist-${mode}-${timestamp()}-not-found.json`;
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

function clampInteger(value, min, max, fallback) {
    if (!Number.isInteger(value)) return fallback;
    return Math.min(Math.max(value, min), max);
}

function parseInput(text, filename) {
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (filename.toLowerCase().endsWith(".csv")) {
        return parseCsv(trimmed);
    }

    return JSON.parse(trimmed);
}

function parseCsv(text) {
    const rows = text.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
    const headers = rows.shift()?.map((header) => header.trim()) || [];
    return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function parseCsvRow(row) {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < row.length; i += 1) {
        const char = row[i];
        if (char === '"' && row[i + 1] === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            cells.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

function extractTracks(payload) {
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

function normalizeTrack(raw) {
    const name = firstString(raw.name, raw.songname, raw.songName, raw.title, raw.song_title);
    const id = firstString(raw.id, raw.songid, raw.songmid, raw.mid, raw.musicId);
    const album = normalizeAlbum(raw.album, raw.albumname, raw.albumName, raw.al);
    const artist = normalizeArtists(raw.artist, raw.artists, raw.singer, raw.singers, raw.ar);
    const picId = firstString(raw.pic_id, raw.picId, raw.pic, raw.album?.picId, raw.album?.pic, raw.al?.pic_str, raw.al?.pic);
    return { id, name, artist, album, picId };
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
}

function normalizeAlbum(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value && typeof value === "object") {
            const name = firstString(value.name, value.title, value.albumname);
            if (name) return name;
        }
    }
    return "";
}

function normalizeArtists(...values) {
    for (const value of values) {
        const artists = artistsFromValue(value);
        if (artists.length > 0) return artists;
    }
    return [];
}

function artistsFromValue(value) {
    if (Array.isArray(value)) {
        return value.flatMap(artistsFromValue).filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(/\s*[/,、&]\s*/).map((item) => item.trim()).filter(Boolean);
    }
    if (value && typeof value === "object") {
        const name = firstString(value.name, value.title, value.singername);
        return name ? [name] : [];
    }
    return [];
}

function isLikelyNumericId(value) {
    return /^\d+$/.test(String(value));
}

function buildSearchKeyword(track) {
    return [track.name, track.artist[0] || ""].filter(Boolean).join(" ");
}

async function searchMusic(keyword, source, count) {
    let lastError = null;
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
                throw new Error(`Search failed (${response.status}) for ${keyword}`);
            }
            const data = await response.json();
            await delay(120);
            return Array.isArray(data) ? data : [];
        } catch (error) {
            lastError = error;
            if (attempt < 3) {
                await delay(600 * attempt);
            }
        }
    }
    throw lastError;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestMatch(track, results) {
    const scored = results
        .map((song) => ({ song, score: scoreMatch(track, song) }))
        .filter((entry) => entry.score >= 60)
        .sort((a, b) => b.score - a.score);

    return scored[0]?.song || null;
}

function scoreMatch(track, song) {
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
    } else if (wantedArtists.some((wanted) => foundArtists.some((found) => wanted === found || wanted.includes(found) || found.includes(wanted)))) {
        score += 30;
    }

    const wantedAlbum = normalizeText(track.album);
    const foundAlbum = normalizeText(normalizeAlbum(song.album));
    if (wantedAlbum && foundAlbum && (wantedAlbum === foundAlbum || wantedAlbum.includes(foundAlbum) || foundAlbum.includes(wantedAlbum))) {
        score += 10;
    }

    return score;
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toSolaraSong(song) {
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

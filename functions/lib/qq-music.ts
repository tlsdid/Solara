import { sendAudioDownload } from "./audio-download.ts";

const QQ_ORIGIN = "https://y.qq.com/";
const XINGHAI_API = "https://yy.zddyr.top/lx/api/";
const XINGHAI_HEADERS = {
  "User-Agent": "lx-music",
  "X-Client": "XingHaiMusicSource/v3.2.18 (unknown)",
};
let deviceId: string | undefined;
let session: { token: string; expires: number } | undefined;
async function requestJson(url: string, headers: HeadersInit, timeout = 8000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

async function getToken(): Promise<string> {
  if (session && session.expires > Date.now()) return session.token;
  deviceId ??= `lx-online-${crypto.randomUUID().slice(0, 8)}`;
  const body = await requestJson(
    `${XINGHAI_API}token.php?${new URLSearchParams({ device_id: deviceId })}`,
    XINGHAI_HEADERS,
  );
  const token = body.data?.token;
  if (typeof token !== "string" || !token) throw new Error("星海未返回令牌");
  session = { token, expires: Date.now() + 4 * 60 * 1000 };
  return token;
}

async function searchQqMusic(keyword: string, page: number, count: number) {
  const headers = { Referer: QQ_ORIGIN, "User-Agent": "Mozilla/5.0" };
  const query = new URLSearchParams({
    w: keyword, p: String(page), n: String(count), format: "json",
    inCharset: "utf-8", outCharset: "utf-8", cr: "1",
  });

  let songs;
  try {
    const data = await requestJson(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${query}`, headers, 4000,
    );
    songs = data.data?.song?.list;
    if (data.code !== 0 || !Array.isArray(songs)) throw new Error("QQ 音乐搜索返回异常");
  } catch {
    const payload = {
      req: {
        module: "music.search.SearchCgiService",
        method: "DoSearchForQQMusicDesktop",
        param: { query: keyword, search_type: 0, page_num: page, num_per_page: count },
      },
    };
    const data = await requestJson(
      `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({ data: JSON.stringify(payload) })}`,
      headers, 6000,
    );
    songs = data.req?.data?.body?.song?.list;
    if (!Array.isArray(songs)) throw new Error("QQ 音乐搜索暂不可用");
  }

  return songs.flatMap((song) => {
    const id = song.songmid || song.mid;
    const name = song.songname || song.title || song.name;
    if (!id || !name) return [];
    return [{
      id, name,
      artist: (song.singer || []).map((artist: { name: string }) => artist.name),
      album: song.albumname || song.album?.name || "",
      pic_id: song.albummid || song.album?.mid || "",
      url_id: id,
      lyric_id: id,
      source: "tencent",
    }];
  });
}

export function qqAlbumCover(mid: string): string {
  return /^[A-Za-z0-9]{10,24}$/.test(mid)
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`
    : "";
}

async function getXinghaiPlayback(query: URLSearchParams) {
  const playbackUrl = `${XINGHAI_API}?${query}`;
  const token = await getToken();
  let data;
  try {
    data = await requestJson(playbackUrl, { ...XINGHAI_HEADERS, "X-Token": token });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Upstream HTTP 403") throw error;
    if (session?.token === token) session = undefined;
    data = await requestJson(playbackUrl, { ...XINGHAI_HEADERS, "X-Token": await getToken() });
  }
  if (data.code !== 200 || typeof data.url !== "string" || !/^https?:\/\//.test(data.url)) return null;
  const audioUrl = new URL(data.url);
  audioUrl.protocol = "https:";
  return audioUrl.toString();
}

async function getQqBackupUrl(mid: string) {
  const query = new URLSearchParams({ mid, type: "json" });
  const data = await requestJson(
    `https://api.xunhuisi.store/API/QQMusic/Song.php?${query}`,
    { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, 5000,
  );
  if (Number(data.code) !== 200 || typeof data.music_url !== "string") return null;
  const url = new URL(data.music_url);
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)qqmusic\.qq\.com$/i.test(url.hostname)) return null;
  url.protocol = "https:";
  return url.toString();
}

export async function handleQqMusic(params: URLSearchParams): Promise<Response> {
  const type = params.get("types");
  const id = params.get("id") || "";
  try {
    if (type === "search") {
      const keyword = params.get("name")?.trim();
      if (!keyword) return Response.json([], { status: 400 });
      const page = Math.max(1, Number.parseInt(params.get("pages") || "1", 10) || 1);
      const count = Math.min(50, Math.max(1, Number.parseInt(params.get("count") || "20", 10) || 20));
      return Response.json(await searchQqMusic(keyword, page, count));
    }

    if (type === "pic" || type === "pic-image") {
      const cover = qqAlbumCover(id);
      if (!cover) return Response.json({ error: "无效的 QQ 音乐专辑 MID" }, { status: 400 });
      if (type === "pic") {
        const query = new URLSearchParams({ types: "pic-image", source: "tencent", id });
        return Response.json({ url: `/proxy?${query}`, paletteUrl: cover });
      }

      const image = await fetch(cover, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!image.ok || image.headers.get("Content-Type")?.split(";")[0] !== "image/jpeg") {
        return Response.json({ error: "QQ 音乐封面不可用" }, { status: 502 });
      }
      return new Response(image.body, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
      });
    }
    if (!/^[A-Za-z0-9]{10,24}$/.test(id)) {
      return Response.json({ error: "无效的 QQ 音乐 MID" }, { status: 400 });
    }
    if (type === "lyric") {
      const query = new URLSearchParams({ songmid: id, format: "json", nobase64: "1" });
      const data = await requestJson(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`,
        { Referer: QQ_ORIGIN, "User-Agent": "Mozilla/5.0" },
      );
      return Response.json({ lyric: data.lyric || "", tlyric: data.trans || "" });
    }
    if (type === "url" || type === "download") {
      const quality = { "128": "128k", "192": "320k", "320": "320k", "999": "flac", "740": "flac" }[
        (params.get("br") || "320") as "128" | "192" | "320" | "999" | "740"
      ] || "320k";
      const query = new URLSearchParams({
        source: "qq", songmid: id, quality,
        name: params.get("name") || "", singer: params.get("singer") || "",
        albumName: params.get("album") || "", interval: "",
      });
      const qualities = quality === "flac" ? ["flac", "320k", "128k"]
        : quality === "320k" ? ["320k", "128k"] : ["128k"];
      for (const candidate of qualities) {
        query.set("quality", candidate);
        try {
          const url = await getXinghaiPlayback(query);
          if (url) {
            if (type === "download") {
              const download = await sendAudioDownload(url, params, candidate === "flac" ? "flac" : "mp3", "qq");
              if (download.ok) return download;
              await download.body?.cancel();
              continue;
            }
            return Response.json({ url, quality: candidate, fallback: candidate !== quality });
          }
        } catch {
          break;
        }
      }

      let backupUrl;
      try {
        backupUrl = await getQqBackupUrl(id);
      } catch {
        backupUrl = null;
      }
      if (backupUrl) {
        if (type === "download") return sendAudioDownload(backupUrl, params, "m4a", "qq");
        return Response.json({ url: backupUrl, format: "m4a", fallback: true });
      }
      return Response.json({ error: "QQ 音乐播放线路暂不可用，请试试其他歌曲" }, { status: 503 });
    }
    return Response.json({ error: "不支持的 QQ 音乐请求" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "QQ 音乐请求失败" }, { status: 502 });
  }
}

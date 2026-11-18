const QQ_ORIGIN = "https://y.qq.com/";
const XINGHAI_API = "https://yy.zddyr.top/lx/api/";
const XINGHAI_HEADERS = {
  "User-Agent": "lx-music",
  "X-Client": "XingHaiMusicSource/v3.2.18 (unknown)",
};
const deviceId = `lx-online-${crypto.randomUUID().slice(0, 8)}`;
let session: { token: string; expires: number } | undefined;
async function requestJson(url: string, headers: HeadersInit) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

async function getToken(): Promise<string> {
  if (session && session.expires > Date.now()) return session.token;
  const body = await requestJson(
    `${XINGHAI_API}token.php?${new URLSearchParams({ device_id: deviceId })}`,
    XINGHAI_HEADERS,
  );
  const token = body.data?.token;
  if (typeof token !== "string" || !token) throw new Error("星海未返回令牌");
  session = { token, expires: Date.now() + 4 * 60 * 1000 };
  return token;
}

export function qqAlbumCover(mid: string): string {
  return /^[A-Za-z0-9]{10,24}$/.test(mid)
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`
    : "";
}

export async function handleQqMusic(params: URLSearchParams): Promise<Response> {
  const type = params.get("types");
  const id = params.get("id") || "";
  try {
    if (type === "search") {
      const keyword = params.get("name")?.trim();
      if (!keyword) return Response.json([], { status: 400 });
      const payload = {
        req: {
          module: "music.search.SearchCgiService",
          method: "DoSearchForQQMusicDesktop",
          param: {
            query: keyword,
            search_type: 0,
            page_num: Math.max(1, Number.parseInt(params.get("pages") || "1", 10) || 1),
            num_per_page: Math.min(50, Math.max(1, Number.parseInt(params.get("count") || "20", 10) || 20)),
          },
        },
      };
      const data = await requestJson(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({ data: JSON.stringify(payload) })}`,
        { Referer: QQ_ORIGIN, "User-Agent": "Mozilla/5.0" },
      );
      const songs = data.req?.data?.body?.song?.list;
      if (!Array.isArray(songs)) throw new Error("QQ 音乐搜索返回异常");
      return Response.json(songs.filter((song) => song.mid).map((song) => ({
        id: song.mid,
        name: song.title || song.name,
        artist: (song.singer || []).map((artist: { name: string }) => artist.name),
        album: song.album?.name || "",
        pic_id: song.album?.mid || "",
        url_id: song.mid,
        lyric_id: song.mid,
        source: "tencent",
      })));
    }

    if (type === "pic") return Response.json({ url: qqAlbumCover(id) });
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
    if (type === "url") {
      const quality = { "128": "128k", "192": "320k", "320": "320k", "999": "flac", "740": "flac" }[
        (params.get("br") || "320") as "128" | "192" | "320" | "999" | "740"
      ] || "320k";
      const query = new URLSearchParams({
        source: "qq", songmid: id, quality,
        name: params.get("name") || "", singer: params.get("singer") || "",
        albumName: params.get("album") || "", interval: "",
      });
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
      if (data.code !== 200 || typeof data.url !== "string" || !/^https?:\/\//.test(data.url)) {
        throw new Error("星海未返回可用的 QQ 音乐地址");
      }
      const audioUrl = new URL(data.url);
      if (audioUrl.protocol === "http:") audioUrl.protocol = "https:";
      return Response.json({ url: audioUrl.toString() });
    }
    return Response.json({ error: "不支持的 QQ 音乐请求" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "QQ 音乐请求失败" }, { status: 502 });
  }
}

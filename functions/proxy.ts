import { sendAudioDownload } from "./lib/audio-download.ts";
import { handleQqMusic } from "./lib/qq-music.ts";

const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";
const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function proxyApiRequest(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(API_BASE_URL);
  url.searchParams.forEach((value, key) => {
    if (key === "target" || key === "callback") {
      return;
    }
    apiUrl.searchParams.set(key, value);
  });

  if (!apiUrl.searchParams.has("types")) {
    return new Response("Missing types", { status: 400 });
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function downloadNetEase(params: URLSearchParams) {
  const id = params.get("id") || "";
  if (!/^\d{1,20}$/.test(id)) {
    return Response.json({ error: "无效的网易云歌曲 ID" }, { status: 400 });
  }
  const quality = params.get("br") || "320";
  const query = new URLSearchParams({ types: "url", source: "netease", id, br: quality });
  try {
    const response = await fetch(`${API_BASE_URL}?${query}`, {
      headers: { "User-Agent": "Meting/1.5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("网易云音源暂不可用");
    const data = await response.json() as { url?: string };
    if (typeof data.url !== "string" || !data.url) throw new Error("网易云音源未返回下载地址");
    const audioUrl = new URL(data.url);
    if (audioUrl.protocol === "http:") audioUrl.protocol = "https:";
    const extension = /\.(mp3|flac|ape|m4a|aac)$/i.exec(audioUrl.pathname)?.[1].toLowerCase() || "mp3";
    return await sendAudioDownload(audioUrl.toString(), params, extension, "netease");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "网易云下载失败" }, { status: 502 });
  }
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  if (source === "tencent" || source === "qq") {
    return handleQqMusic(url.searchParams);
  }
  if (source === "netease" && url.searchParams.get("types") === "download") {
    return downloadNetEase(url.searchParams);
  }
  if (source === "kuwo") {
    return Response.json({ error: "酷我音乐源已移除" }, { status: 410 });
  }

  return proxyApiRequest(url, request);
}

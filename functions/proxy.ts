const API_BASE_URLS: Record<string, string[]> = {
  netease: [
    "https://music-api.gdstudio.xyz/api.php",
    "https://music.gdstudio.xyz/api.php",
  ],
  kuwo: [
    "https://music-api.gdstudio.xyz/api.php",
    "https://music.gdstudio.xyz/api.php",
  ],
  tencent: [
    "https://music-api.gdstudio.xyz/api.php",
    "https://music.gdstudio.xyz/api.php",
  ],
  kugou: [
    "https://music-api-cn.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  migu: [
    "https://music-api-cn.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  ximalaya: [
    "https://music-api-cn.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  joox: [
    "https://music-api-hk.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  qobuz: [
    "https://music-api-us.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  ytmusic: [
    "https://music-api-us.gdstudio.xyz/api.php",
    "https://music-api.gdstudio.xyz/api.php",
  ],
  default: [
    "https://music-api.gdstudio.xyz/api.php",
  ],
};

const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
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

function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "http:";
    return parsed;
  } catch {
    return null;
  }
}

async function proxyKuwoAudio(targetUrl: string, request: Request): Promise<Response> {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }

  const init: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Referer": "https://www.kuwo.cn/",
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyApiRequest(url: URL, request: Request): Promise<Response> {
  const source = url.searchParams.get("source") || "default";
  const apiBases = API_BASE_URLS[source] || API_BASE_URLS.default;

  let lastError = "";

  for (const base of apiBases) {
    try {
      const apiUrl = new URL(base);

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
          "Accept": "application/json,text/plain,*/*",
        },
      });

      if (!upstream.ok) {
        lastError = `${base} returned ${upstream.status}`;
        continue;
      }

      const text = await upstream.text();

      if (!text || text.trim().length === 0) {
        lastError = `${base} returned empty response`;
        continue;
      }

      const headers = createCorsHeaders(upstream.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("X-Solara-Upstream", base);

      return new Response(text, {
        status: 200,
        headers,
      });
    } catch (error: any) {
      lastError = `${base} failed: ${error?.message || String(error)}`;
      continue;
    }
  }

  return new Response(
    JSON.stringify({
      error: "All upstream music APIs failed",
      detail: lastError,
      source,
    }),
    {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (target) {
    return proxyKuwoAudio(target, request);
  }

  return proxyApiRequest(url, request);
}

export async function sendAudioDownload(audioUrl: string, params: URLSearchParams, format: string, provider: "qq" | "netease") {
  const url = new URL(audioUrl);
  const audioHost = provider === "qq" ? /(^|\.)qqmusic\.qq\.com$/i : /(^|\.)music\.126\.net$/i;
  if (url.protocol !== "https:" || url.port || url.username || url.password || !audioHost.test(url.hostname)) {
    return Response.json({ error: "音源未提供可下载的音频" }, { status: 502 });
  }
  const upstream = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers: {
      Range: "bytes=0-",
      Referer: provider === "qq" ? "https://y.qq.com/" : "https://music.163.com/",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const contentType = upstream.headers.get("Content-Type")?.split(";")[0] || "";
  const range = /^bytes 0-(\d+)\/(\d+)$/.exec(upstream.headers.get("Content-Range") || "");
  const fullAudio = upstream.status === 200 ||
    (upstream.status === 206 && range && Number(range[1]) + 1 === Number(range[2]));
  if (!fullAudio || !/^(audio\/|application\/(octet-stream|ogg)$)/i.test(contentType) || !upstream.body) {
    await upstream.body?.cancel();
    return Response.json({ error: "下载音频失败，请稍后重试", upstreamStatus: upstream.status, contentType }, { status: 502 });
  }

  const extensionFromPath = /\.(mp3|flac|ape|m4a|aac)$/i.exec(url.pathname)?.[1].toLowerCase();
  const extension = extensionFromPath || ({
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
    "audio/flac": "flac", "audio/x-flac": "flac", "audio/ape": "ape", "audio/x-ape": "ape",
  } as Record<string, string>)[contentType] || format;
  const name = [params.get("name"), params.get("singer")].filter(Boolean).join(" - ") || "Solara";
  const filename = `${name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").trim().slice(0, 160).toWellFormed()}.${extension}`;
  const encodedName = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  const headers = new Headers({
    "Content-Type": extension === "flac" ? "audio/flac" : contentType,
    "Content-Disposition": `attachment; filename="Solara.${extension}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("Content-Length");
  if (length && !upstream.headers.get("Content-Encoding")) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}


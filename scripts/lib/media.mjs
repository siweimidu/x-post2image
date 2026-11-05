import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TWITTER_IMAGE_HOST_RE = /^https?:\/\/(?:pbs\.twimg\.com|video\.twimg\.com|ton\.twitter\.com)\//i;

export function proxyImageUrl(url) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
}

function keyFor(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

function guessContentType(url) {
  if (/\.png(?:\?|$)/i.test(url)) return "image/png";
  if (/\.webp(?:\?|$)/i.test(url)) return "image/webp";
  if (/\.gif(?:\?|$)/i.test(url)) return "image/gif";
  return "image/jpeg";
}

async function readCached(cacheDir, key) {
  if (!cacheDir) return null;
  try {
    const meta = JSON.parse(await readFile(path.join(cacheDir, "media", `${key}.json`), "utf8"));
    const bytes = await readFile(path.join(cacheDir, "media", `${key}.bin`));
    return {
      contentType: meta?.contentType || "image/jpeg",
      dataUrl: `data:${meta?.contentType || "image/jpeg"};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

async function writeCached(cacheDir, key, contentType, bytes) {
  if (!cacheDir) return;
  try {
    const dir = path.join(cacheDir, "media");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify({ contentType }), "utf8");
    await writeFile(path.join(dir, `${key}.bin`), bytes);
  } catch {
    // best effort
  }
}

async function fetchBytes(url, { timeout, fetchImpl, headers = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36",
        accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("empty response");
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
    return { bytes: buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download avatars and post media into data URLs so the card renders even when
 * the browser cannot reach pbs.twimg.com directly. In restricted networks the
 * wsrv.nl image proxy is used as a fallback. Results are cached by URL hash.
 */
export async function embedMedia(tweet, options = {}) {
  const {
    cacheDir = null,
    offline = false,
    timeout = 20_000,
    fetchImpl = fetch,
    includeMedia = true,
    useProxy = true,
  } = options;

  const result = JSON.parse(JSON.stringify(tweet));
  const memo = new Map();

  async function localize(url) {
    if (!url || typeof url !== "string" || url.startsWith("data:")) return url;
    if (memo.has(url)) return memo.get(url);
    const key = keyFor(url);
    const cached = await readCached(cacheDir, key);
    if (cached) {
      memo.set(url, cached.dataUrl);
      return cached.dataUrl;
    }
    if (offline) {
      memo.set(url, null);
      return null;
    }

    const candidates = [];
    if (useProxy && TWITTER_IMAGE_HOST_RE.test(url)) {
      // In networks where pbs.twimg.com is blocked, the proxy answers quickly;
      // try it first so a direct-connection timeout never stalls the render.
      candidates.push(proxyImageUrl(url), url);
    } else {
      candidates.push(url);
      if (useProxy && TWITTER_IMAGE_HOST_RE.test(url)) candidates.push(proxyImageUrl(url));
    }
    for (const candidate of candidates) {
      try {
        const { bytes, contentType } = await fetchBytes(candidate, { timeout, fetchImpl });
        const type = contentType?.startsWith("image/") ? contentType : guessContentType(url);
        await writeCached(cacheDir, key, type, bytes);
        const dataUrl = `data:${type};base64,${bytes.toString("base64")}`;
        memo.set(url, dataUrl);
        return dataUrl;
      } catch {
        // try next candidate
      }
    }
    // Both direct and proxy failed; omit the image rather than showing a
    // broken-image icon in the card.
    memo.set(url, null);
    return null;
  }

  if (result.author?.avatarUrl) {
    result.author.avatarUrl = await localize(result.author.avatarUrl);
  }
  if (includeMedia && Array.isArray(result.media)) {
    result.media = await Promise.all(
      result.media.map(async (item) => ({
        ...item,
        url: await localize(item.url),
      })),
    );
  }
  if (includeMedia && result.quote) {
    if (result.quote.author?.avatarUrl) {
      result.quote.author.avatarUrl = await localize(result.quote.author.avatarUrl);
    }
    if (Array.isArray(result.quote.media)) {
      result.quote.media = await Promise.all(
        result.quote.media.map(async (item) => ({
          ...item,
          url: await localize(item.url),
        })),
      );
    }
  }

  return result;
}

/**
 * Cache an image and return a real local file path (not a data URL). Used by
 * the Pillow insight renderer, which expects an avatar file on disk.
 */
export async function cacheImageFile(url, options = {}) {
  const {
    cacheDir = null,
    timeout = 20_000,
    fetchImpl = fetch,
    useProxy = true,
  } = options;
  if (!url || typeof url !== "string" || url.startsWith("data:")) return null;

  const key = keyFor(url);
  if (cacheDir) {
    const binPath = path.join(cacheDir, "media", `${key}.bin`);
    if (existsSync(binPath)) return binPath;
  }

  const candidates = [];
  if (useProxy && TWITTER_IMAGE_HOST_RE.test(url)) {
    candidates.push(proxyImageUrl(url), url);
  } else {
    candidates.push(url);
    if (useProxy && TWITTER_IMAGE_HOST_RE.test(url)) candidates.push(proxyImageUrl(url));
  }

  for (const candidate of candidates) {
    try {
      const { bytes, contentType } = await fetchBytes(candidate, { timeout, fetchImpl });
      const type = contentType?.startsWith("image/") ? contentType : guessContentType(url);
      const extension = type.includes("png")
        ? ".png"
        : type.includes("webp")
          ? ".webp"
          : type.includes("gif")
            ? ".gif"
            : ".jpg";
      const dir = cacheDir ? path.join(cacheDir, "media") : path.join(process.cwd(), ".x-post2image-media");
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${key}${extension}`);
      await writeFile(filePath, bytes);
      if (cacheDir) await writeCached(cacheDir, key, type, bytes);
      return filePath;
    } catch {
      // try next candidate
    }
  }
  return null;
}

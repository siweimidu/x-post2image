import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "m.twitter.com",
]);

export class TweetError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TweetError";
    this.details = details;
  }
}

export async function resolveTweetInput(input, { timeout = 15_000 } = {}) {
  if (!input || typeof input !== "string") {
    throw new TweetError("No X post URL or numeric status id was provided.");
  }
  let raw = input.trim();
  if (/^\d{1,25}$/.test(raw)) {
    return { id: raw, screenName: null, url: `https://x.com/i/status/${raw}` };
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TweetError(`Could not parse "${input}" as a URL.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "t.co") {
    const resolved = await followRedirects(parsed.href, timeout);
    return resolveTweetInput(resolved, { timeout });
  }
  if (!X_HOSTS.has(host)) {
    throw new TweetError(
      `Unsupported host "${parsed.hostname}". Pass an x.com / twitter.com post URL or a numeric status id.`,
    );
  }

  const match = parsed.pathname.match(/\/status(?:es)?\/(\d+)/i);
  if (!match) {
    throw new TweetError("That URL does not contain a /status/<id> segment.");
  }
  const id = match[1];
  const first = parsed.pathname.split("/").filter(Boolean)[0] || "";
  const screenName = first && first !== "i" && first !== "home" ? first : null;
  return { id, screenName, url: `https://x.com/${screenName ?? "i"}/status/${id}` };
}

async function followRedirects(startUrl, timeout) {
  let current = startUrl;
  for (let i = 0; i < 4; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": DEFAULT_UA },
        signal: controller.signal,
      });
      const location = response.headers.get("location");
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      return response.url || current;
    } finally {
      clearTimeout(timer);
    }
  }
  return current;
}

async function fetchJson(url, { timeout = 15_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": DEFAULT_UA,
        accept: "application/json, text/plain, */*",
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new TweetError(`HTTP ${response.status} from ${new URL(url).host}`, {
        status: response.status,
        body: text.slice(0, 200),
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new TweetError(`Non-JSON response from ${new URL(url).host}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function fetchSyndication(id, { lang = "en", timeout = 15_000 } = {}) {
  const url =
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}` +
    `&lang=${encodeURIComponent(lang)}&token=${syndicationToken(id)}`;
  const data = await fetchJson(url, { timeout });
  if (!data || data.__typename !== "Tweet") {
    throw new TweetError(
      data?.__typename === "TweetTombstone"
        ? "This post is unavailable (deleted, protected, or withheld)."
        : "The syndication endpoint returned no tweet.",
    );
  }
  return normalizeSyndication(data);
}

export async function fetchFxTwitter(id, { screenName = null, timeout = 15_000 } = {}) {
  const slug = screenName ? encodeURIComponent(screenName) : "i";
  const url = `https://api.fxtwitter.com/${slug}/status/${encodeURIComponent(id)}`;
  const data = await fetchJson(url, { timeout });
  if (!data || data.code !== 200 || !data.tweet) {
    throw new TweetError(
      data?.tweet?.type === "tombstone"
        ? "This post is unavailable (deleted, protected, or withheld)."
        : `fxTwitter returned ${data?.code ?? "no data"}: ${data?.message ?? "unknown error"}`,
    );
  }
  if (data.tweet.type === "tombstone") {
    throw new TweetError("This post is unavailable (deleted, protected, or withheld).");
  }
  return normalizeFx(data.tweet);
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function bestAvatar(url) {
  if (!isHttpUrl(url)) return null;
  return url.replace(/_(normal|mini|bigger)\.(jpg|jpeg|png|webp)$/i, "_400x400.$2");
}

function normalizeMediaList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rawType = String(item.type || "photo").toLowerCase();
      const type = rawType.includes("gif") ? "gif" : rawType.includes("video") ? "video" : "photo";
      const url = item.thumbnail_url || item.media_url_https || item.url;
      if (!isHttpUrl(url)) return null;
      return {
        type,
        url,
        videoUrl: type === "photo" ? null : item.url || null,
        width: Number(item.width || item.original_info?.width || 0) || null,
        height: Number(item.height || item.original_info?.height || 0) || null,
        alt: String(item.altText || item.alt_text || item.ext_alt_text || "").slice(0, 1000),
      };
    })
    .filter(Boolean);
}

function normalizePoll(poll) {
  if (!poll || typeof poll !== "object") return null;
  const rawOptions = Array.isArray(poll.options)
    ? poll.options
    : Array.isArray(poll.choices)
      ? poll.choices
      : [];
  const options = rawOptions
    .map((option) => {
      if (!option || typeof option !== "object") return null;
      return {
        label: String(option.label ?? option.text ?? ""),
        votes: Number(option.votes ?? option.count ?? 0) || 0,
        percentage: Number(option.percentage ?? option.percent ?? 0) || 0,
      };
    })
    .filter(Boolean);
  if (!options.length) return null;
  const totalVotes =
    Number(poll.total_votes ?? poll.totalVotes ?? poll.votes ?? 0) ||
    options.reduce((sum, option) => sum + option.votes, 0);
  return {
    options,
    totalVotes,
    endsAt: poll.ending_at || poll.ends_at || null,
  };
}

export function normalizeFx(tweet) {
  if (!tweet || typeof tweet !== "object") {
    throw new TweetError("fxTwitter returned an empty tweet object.");
  }
  const author = tweet.author || {};
  const media = normalizeMediaList(tweet.media?.all || tweet.media?.photos || []);
  const quote = tweet.quote ? normalizeFx(tweet.quote) : null;
  return {
    __normalized: true,
    id: String(tweet.id || ""),
    url: tweet.url || `https://x.com/i/status/${tweet.id}`,
    text: String(tweet.text ?? tweet.raw_text?.text ?? ""),
    lang: String(tweet.lang || "en"),
    createdAt: tweet.created_timestamp
      ? new Date(Number(tweet.created_timestamp) * 1000).toISOString()
      : tweet.created_at
        ? new Date(tweet.created_at).toISOString()
        : null,
    author: {
      name: String(author.name || ""),
      screenName: String(author.screen_name || ""),
      avatarUrl: bestAvatar(author.avatar_url || author.profile_image_url_https),
      verified: Boolean(author.verification?.verified ?? author.verified ?? author.is_blue_verified),
      protected: Boolean(author.protected),
    },
    metrics: {
      replies: numberOrNull(tweet.replies),
      reposts: numberOrNull(tweet.retweets),
      likes: numberOrNull(tweet.likes),
      views: numberOrNull(tweet.views),
      quotes: numberOrNull(tweet.quotes),
      bookmarks: numberOrNull(tweet.bookmarks),
    },
    media,
    quote,
    poll: normalizePoll(tweet.poll),
    replyingTo: tweet.replying_to || null,
    possiblySensitive: Boolean(tweet.possibly_sensitive),
    _meta: { source: "fxtwitter", fetchedAt: new Date().toISOString() },
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSyndication(tweet) {
  if (!tweet || typeof tweet !== "object") {
    throw new TweetError("The syndication endpoint returned an empty tweet object.");
  }
  const user = tweet.user || {};
  const media = normalizeMediaList(tweet.mediaDetails || tweet.photos || []);
  const quote = tweet.quoted_tweet ? normalizeSyndication(tweet.quoted_tweet) : null;

  let text = String(tweet.text || "");
  if (Array.isArray(tweet.display_text_range) && tweet.display_text_range.length === 2) {
    text = text.slice(0, tweet.display_text_range[1]);
  }
  for (const link of tweet.entities?.urls || []) {
    if (link?.url && link?.display_url) {
      text = text.split(link.url).join(link.display_url);
    }
  }

  return {
    __normalized: true,
    id: String(tweet.id_str || tweet.id || ""),
    url: `https://x.com/${user.screen_name || "i"}/status/${tweet.id_str || tweet.id}`,
    text,
    lang: String(tweet.lang || "en"),
    createdAt: tweet.created_at ? new Date(tweet.created_at).toISOString() : null,
    author: {
      name: String(user.name || ""),
      screenName: String(user.screen_name || ""),
      avatarUrl: bestAvatar(user.profile_image_url_https),
      verified: Boolean(user.is_blue_verified ?? user.verified),
      protected: Boolean(user.protected),
    },
    metrics: {
      replies: numberOrNull(tweet.conversation_count),
      reposts: numberOrNull(tweet.retweet_count),
      likes: numberOrNull(tweet.favorite_count),
      views: numberOrNull(tweet.view_count),
      quotes: numberOrNull(tweet.quote_count),
      bookmarks: numberOrNull(tweet.bookmark_count),
    },
    media,
    quote,
    poll: normalizePoll(tweet.poll),
    replyingTo: null,
    possiblySensitive: Boolean(tweet.possibly_sensitive),
    _meta: { source: "syndication", fetchedAt: new Date().toISOString() },
  };
}

function mergeTweet(syn, fx, parsed) {
  const base = fx || syn;
  const metrics = {
    replies: firstFinite(fx?.metrics?.replies, syn?.metrics?.replies),
    reposts: firstFinite(fx?.metrics?.reposts, syn?.metrics?.reposts),
    likes: firstFinite(fx?.metrics?.likes, syn?.metrics?.likes),
    views: firstFinite(fx?.metrics?.views, syn?.metrics?.views),
    quotes: firstFinite(fx?.metrics?.quotes, syn?.metrics?.quotes),
    bookmarks: firstFinite(fx?.metrics?.bookmarks, syn?.metrics?.bookmarks),
  };
  const author = {
    name: syn?.author?.name || base.author?.name || "",
    screenName: syn?.author?.screenName || base.author?.screenName || "",
    avatarUrl: syn?.author?.avatarUrl || base.author?.avatarUrl || null,
    verified: Boolean(syn?.author?.verified ?? base.author?.verified),
    protected: Boolean(syn?.author?.protected ?? base.author?.protected),
  };
  return {
    ...base,
    id: parsed.id || base.id,
    url: parsed.url || base.url,
    text: fx?.text || syn?.text || "",
    author,
    media: syn?.media?.length ? syn.media : base.media,
    quote: fx?.quote || syn?.quote || base.quote || null,
    poll: fx?.poll || syn?.poll || base.poll || null,
    metrics,
    createdAt: syn?.createdAt || fx?.createdAt || base.createdAt,
    lang: base.lang || "en",
    _meta: {
      source: [syn ? "syndication" : null, fx ? "fxtwitter" : null].filter(Boolean).join("+") || "unknown",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function firstFinite(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

export function defaultCacheDir() {
  return process.env.X_POST2IMAGE_CACHE || path.join(os.homedir(), ".cache", "x-post2image");
}

async function readCache(id, cacheDir) {
  if (!cacheDir) return null;
  try {
    const raw = await readFile(path.join(cacheDir, `${id}.json`), "utf8");
    const data = JSON.parse(raw);
    if (data?.__normalized) {
      data._meta = { ...(data._meta || {}), cached: true };
      return data;
    }
  } catch {
    // cache miss is normal
  }
  return null;
}

async function writeCache(tweet, cacheDir) {
  if (!cacheDir || !tweet?.id) return;
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, `${tweet.id}.json`), JSON.stringify(tweet, null, 2), "utf8");
  } catch {
    // caching is best effort
  }
}

/**
 * Fetch a tweet from the official syndication endpoint and fxTwitter in
 * parallel, merge the results, and fall back to the on-disk cache.
 */
export async function fetchTweet(parsed, options = {}) {
  const {
    lang = "en",
    timeout = 15_000,
    cacheDir = defaultCacheDir(),
    offline = false,
    verbose = false,
  } = options;

  const errors = [];
  let syn = null;
  let fx = null;

  if (!offline) {
    const results = await Promise.allSettled([
      fetchSyndication(parsed.id, { lang, timeout }),
      fetchFxTwitter(parsed.id, { screenName: parsed.screenName, timeout }),
    ]);
    if (results[0].status === "fulfilled") syn = results[0].value;
    else errors.push(`syndication: ${results[0].reason?.message || results[0].reason}`);
    if (results[1].status === "fulfilled") fx = results[1].value;
    else errors.push(`fxtwitter: ${results[1].reason?.message || results[1].reason}`);
  }

  if (syn || fx) {
    const tweet = mergeTweet(syn, fx, parsed);
    if (verbose) {
      console.error(`[x-post2image] fetched ${tweet.id} via ${tweet._meta.source}`);
    }
    await writeCache(tweet, cacheDir);
    return tweet;
  }

  const cached = await readCache(parsed.id, cacheDir);
  if (cached) {
    if (verbose) console.error(`[x-post2image] using cached data for ${parsed.id}`);
    return {
      ...cached,
      id: parsed.id || cached.id,
      url: parsed.url || cached.url,
      _meta: { ...(cached._meta || {}), cached: true },
    };
  }

  throw new TweetError(
    `Could not fetch post ${parsed.id}. Tried the X syndication endpoint and fxTwitter.`,
    { errors },
  );
}

export async function loadTweetData(fileOrDash) {
  let text;
  if (fileOrDash === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    text = await readFile(fileOrDash, "utf8");
  }
  let json;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new TweetError(`"${fileOrDash}" is not valid JSON.`);
  }
  const tweet = normalizeAny(json);
  tweet._meta = { ...(tweet._meta || {}), source: tweet._meta?.source || "file" };
  return tweet;
}

export function normalizeAny(json) {
  if (!json || typeof json !== "object") {
    throw new TweetError("Tweet data must be a JSON object.");
  }
  if (json.__normalized) return json;
  if (json.tweet) return normalizeFx(json.tweet);
  if (json.__typename === "Tweet") return normalizeSyndication(json);
  throw new TweetError(
    "Unrecognised tweet JSON. Pass a fxTwitter response, a syndication tweet-result, or a normalized x-post2image JSON file.",
  );
}

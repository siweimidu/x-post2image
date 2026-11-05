import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { languageName } from "./format.mjs";

export class TranslationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TranslationError";
    this.details = details;
  }
}

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const TOKEN_RE = /(https?:\/\/[^\s<>"']+|[@#$][\p{L}\p{N}_]{1,40})/gu;

function protectTokens(text) {
  const tokens = [];
  const masked = text.replace(TOKEN_RE, (match) => {
    const index = tokens.push(match) - 1;
    return `X2ITOKEN${index}X`;
  });
  return { masked, tokens };
}

function restoreTokens(text, tokens) {
  return text.replace(/X2ITOKEN\s*(\d+)\s*X/gi, (match, index) => tokens[Number(index)] ?? match);
}

function decodeEntities(text) {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function languageBase(code) {
  return String(code || "").toLowerCase().split("-")[0];
}

function sameLanguage(a, b) {
  if (!a || a === "auto") return false;
  return languageBase(a) === languageBase(b);
}

/**
 * Split text into chunks that respect paragraph breaks and sentence boundaries.
 * MyMemory limits each query to 500 bytes, Google allows much longer queries.
 */
export function chunkText(text, maxChars = 450, maxBytes = 450) {
  const source = String(text ?? "");
  if (!source) return [];
  if (source.length <= maxChars && Buffer.byteLength(source, "utf8") <= maxBytes) return [source];

  const chunks = [];
  let current = "";

  const fits = (value) => value.length <= maxChars && Buffer.byteLength(value, "utf8") <= maxBytes;

  const hardSplit = (value) => {
    let piece = "";
    for (const char of value) {
      if (!fits(piece + char)) {
        if (piece) chunks.push(piece);
        piece = char;
      } else {
        piece += char;
      }
    }
    return piece;
  };

  const paragraphs = source.split(/(\n+)/);
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if (/^\n+$/.test(paragraph)) {
      if (fits(current + paragraph)) current += paragraph;
      else {
        if (current) chunks.push(current);
        current = paragraph;
      }
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?。！？])\s*/u).filter(Boolean);
    for (const sentence of sentences) {
      if (fits(current + sentence)) {
        current += sentence;
      } else {
        if (current) {
          chunks.push(current);
          current = "";
        }
        if (fits(sentence)) {
          current = sentence;
        } else {
          current = hardSplit(sentence);
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function withTimeout(timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function translateWithMyMemory(text, { from, to, timeout, fetchImpl }) {
  const langpair = `${from && from !== "auto" ? languageBase(from) : "en"}|${to}`;
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const timer = withTimeout(timeout);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: timer.signal,
    });
  } finally {
    timer.clear();
  }
  if (!response.ok) {
    throw new TranslationError(`MyMemory HTTP ${response.status}`);
  }
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || typeof translated !== "string") {
    throw new TranslationError("MyMemory returned no translation.");
  }
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(translated)) {
    throw new TranslationError(`MyMemory rejected the request: ${translated.slice(0, 120)}`);
  }
  return decodeEntities(translated);
}

async function translateWithGoogle(text, { from, to, timeout, fetchImpl }) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: from && from !== "auto" ? from : "auto",
    tl: to,
    dt: "t",
    q: text,
  });
  const timer = withTimeout(timeout);
  let response;
  try {
    response = await fetchImpl(`${GOOGLE_ENDPOINT}?${params.toString()}`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: timer.signal,
    });
  } finally {
    timer.clear();
  }
  if (!response.ok) {
    throw new TranslationError(`Google Translate HTTP ${response.status}`);
  }
  const data = await response.json();
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = segments.map((segment) => (Array.isArray(segment) ? segment[0] : "")).join("");
  if (!translated) {
    throw new TranslationError("Google Translate returned no translation.");
  }
  return translated;
}

const PROVIDERS = {
  mymemory: { translate: translateWithMyMemory, maxChars: 450, maxBytes: 450 },
  google: { translate: translateWithGoogle, maxChars: 1800, maxBytes: 4800 },
};

function cacheKey({ provider, from, to, text }) {
  return createHash("sha256").update(`${provider}\0${from}\0${to}\0${text}`).digest("hex");
}

async function readCache(cacheDir, key) {
  if (!cacheDir) return null;
  try {
    const raw = await readFile(path.join(cacheDir, "translations", `${key}.json`), "utf8");
    const data = JSON.parse(raw);
    return typeof data?.text === "string" ? data : null;
  } catch {
    return null;
  }
}

async function writeCache(cacheDir, key, data) {
  if (!cacheDir) return;
  try {
    await mkdir(path.join(cacheDir, "translations"), { recursive: true });
    await writeFile(path.join(cacheDir, "translations", `${key}.json`), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // best effort
  }
}

/**
 * Translate text through a free provider. Provider order for "auto" is
 * MyMemory then Google; either can be forced with --translation-provider.
 */
export async function translateText(
  text,
  {
    from = "auto",
    to = "zh-CN",
    provider = "auto",
    timeout = 20_000,
    cacheDir = null,
    offline = false,
    fetchImpl = fetch,
  } = {},
) {
  const source = String(text ?? "");
  if (!source.trim()) {
    return { text: source, provider: null, from, to, unchanged: true };
  }
  if (sameLanguage(from, to)) {
    return { text: source, provider: null, from, to, unchanged: true };
  }

  const key = cacheKey({ provider, from, to, text: source });
  const cached = await readCache(cacheDir, key);
  if (cached) {
    return { ...cached, from, to, cached: true };
  }
  if (offline) {
    throw new TranslationError(
      `No cached ${from}→${to} translation for this text. Run once with network access or pass --data with translated text.`,
    );
  }

  const order = provider === "auto" ? ["mymemory", "google"] : [provider];
  const errors = [];
  for (const name of order) {
    const config = PROVIDERS[name];
    if (!config) throw new TranslationError(`Unknown translation provider "${name}".`);
    try {
      const { masked, tokens } = protectTokens(source);
      const chunks = chunkText(masked, config.maxChars, config.maxBytes);
      let output = "";
      for (const chunk of chunks) {
        output += await config.translate(chunk, { from, to, timeout, fetchImpl });
      }
      const restored = restoreTokens(output, tokens);
      const result = { text: restored, provider: name, from, to, cached: false };
      await writeCache(cacheDir, key, { ...result, fetchedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      if (provider !== "auto") break;
    }
  }
  throw new TranslationError(
    `Translation ${from}→${to} failed. ${errors.join("; ")}`,
    { errors },
  );
}

/**
 * Translate the user-visible parts of a normalized tweet: body text, quoted
 * post text and poll choice labels. Returns a new tweet object with a
 * `translation` metadata block for the renderer.
 */
export async function translateTweet(tweet, options = {}) {
  const target = options.target || "zh-CN";
  const from = tweet.lang || "auto";
  const bilingual = Boolean(options.bilingual);
  const body = await translateText(tweet.text, {
    from,
    to: target,
    provider: options.provider,
    timeout: options.timeout,
    cacheDir: options.cacheDir,
    offline: options.offline,
    fetchImpl: options.fetchImpl,
  });

  if (body.unchanged) {
    return {
      ...tweet,
      translation: {
        from,
        to: target,
        provider: null,
        changed: false,
        sourceName: languageName(from, target),
        targetName: languageName(target, target),
        originalText: null,
      },
    };
  }

  let quote = tweet.quote || null;
  let originalQuoteText = null;
  if (quote?.text) {
    const quoteTranslation = await translateText(quote.text, {
      from: quote.lang || from,
      to: target,
      provider: options.provider,
      timeout: options.timeout,
      cacheDir: options.cacheDir,
      offline: options.offline,
      fetchImpl: options.fetchImpl,
    });
    originalQuoteText = bilingual ? quote.text : null;
    quote = { ...quote, text: quoteTranslation.text };
  }

  let poll = tweet.poll || null;
  if (poll?.options?.length) {
    const translatedOptions = [];
    for (const option of poll.options) {
      try {
        const result = await translateText(option.label, {
          from,
          to: target,
          provider: options.provider,
          timeout: options.timeout,
          cacheDir: options.cacheDir,
          offline: options.offline,
          fetchImpl: options.fetchImpl,
        });
        translatedOptions.push({ ...option, label: result.text });
      } catch {
        translatedOptions.push(option);
      }
    }
    poll = { ...poll, options: translatedOptions };
  }

  return {
    ...tweet,
    text: body.text,
    quote,
    poll,
    translation: {
      from,
      to: target,
      provider: body.provider,
      changed: true,
      sourceName: languageName(from, target),
      targetName: languageName(target, target),
      originalText: bilingual ? tweet.text : null,
      originalQuoteText,
    },
  };
}

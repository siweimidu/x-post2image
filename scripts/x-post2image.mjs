#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parseCount } from "./lib/format.mjs";
import { renderCardHtml, applyMetricOverrides } from "./lib/render.mjs";
import { embedMedia } from "./lib/media.mjs";
import { cacheImageFile } from "./lib/media.mjs";
import { translateText, translateTweet } from "./lib/translate.mjs";
import { buildArticleCardData, buildLongCardData, buildSpreadCardData, renderArticleCard, renderLongCard, renderSpreadCard } from "./long.mjs";
import {
  defaultCacheDir,
  fetchTweet,
  fetchFxTwitter,
  fetchSyndication,
  loadTweetData,
  resolveTweetInput,
  TweetError,
} from "./lib/tweet.mjs";
import {
  chromeVersion,
  doctorReport,
  findChrome,
  findPlaywright,
  isFontReachable,
  pngSize,
  renderScreenshot,
} from "./lib/screenshot.mjs";

const VERSION = "2.1.5";

const HELP = `x-post2image ${VERSION} — render an X/Twitter post as a PNG card

USAGE
  node scripts/x-post2image.mjs <url-or-id> [options]
  node scripts/x-post2image.mjs <url1> <url2> ... --out-dir <dir>
  node scripts/x-post2image.mjs --data tweet.json --out card.png
  node scripts/x-post2image.mjs --doctor

INPUT
  <url-or-id>            x.com / twitter.com status URL, or a numeric status id
  --data <file|->        Render from saved JSON instead of fetching
                         (fxTwitter response, syndication tweet-result, or
                         a normalized x-post2image JSON file; "-" = stdin)

OUTPUT
  -o, --out <file>       Output PNG path for a single post
      --out-dir <dir>    Output directory (default: current directory)
      --html <file>      Also save the intermediate HTML
      --html-only        Write HTML only, skip PNG rendering
      --json             Print a machine-readable JSON result to stdout
      --keep             Keep temporary browser files

APPEARANCE
  -t, --theme <name>     light | dim | dark              (default: dark)
  -l, --lang <code>      Locale for dates/counts        (default: tweet language)
  -w, --width <px>       Card width in CSS pixels       (default: 600)
  -s, --scale <n>        Pixel density                  (default: 2 = retina)
      --frame <none|card> Rounded card frame            (default: none)
      --radius <px>      Corner radius (implies --frame card)
      --bg <color>       Card background colour
      --page-bg <color>  Page background colour
      --transparent      Transparent page background
      --no-media         Omit media and quoted post
      --no-metrics       Hide date, view count and action bar
      --no-avatar        Hide the author avatar
      --no-webfont       Do not load X's Chirp webfont (faster offline renders)
      --css <file>       Append custom CSS to the card
      --layout <name>    auto | single | tall | spread (auto uses a tall
                         X-article card for long posts; spread = optional
                         two-page article layout)
      --long-threshold <n>  Character count that triggers tall layout (default 360)
      --spread-threshold <px>  Tall-card height that auto-switches to two pages (default 1400)
      --bilingual-threshold <n>  Short translated posts show original + translation (default 700)
      --long-height <px>  Spread card height (default 640/760/900 by text length)
      --title <text>      Optional spread-page title
      --subtitle <text>   Optional spread-page subtitle
      --python <bin>     Python with Pillow for spread rendering (default python)

METRICS (design mockups only — never present edits as real data)
      --replies <n>      Override reply count   (accepts 1.2K, 3万, 2亿)
      --reposts <n>      Override repost count
      --likes <n>        Override like count
      --views <n>        Override view count

TRANSLATION
      --translate <lang> Translate the post into a language (e.g. zh-CN, en, fr)
                         and show a "Translated from ..." note; "auto" uses
                         --lang if set, otherwise zh-CN
      --bilingual        Also show the original text under the translation
      --translation-provider <name>  auto | mymemory | google  (default: auto)

ENGINE
      --engine <name>    auto | playwright | chrome        (default: auto)
      --chrome <path>    Explicit Chrome/Chromium binary
      --timeout <ms>     Per-step timeout                  (default: 60000)
      --cache-dir <dir>  Tweet JSON cache directory
      --no-cache         Disable cache reads and writes
      --offline          Render from cache only
      --verbose          Log fetch details to stderr

OTHER
      --doctor           Check Node, browser, APIs and fonts
      --version          Print version
  -h, --help             Print this help

EXAMPLES
  node scripts/x-post2image.mjs https://x.com/jack/status/20 --out jack.png
  node scripts/x-post2image.mjs 440322224407314432 --theme light --scale 2
  node scripts/x-post2image.mjs https://x.com/TheEllenShow/status/440322224407314432 --translate zh-CN
  node scripts/x-post2image.mjs https://x.com/jack/status/20 --likes 12K --views 2.4M
  node scripts/x-post2image.mjs https://x.com/jack/status/20 --html-only --html card.html
`;

function usageError(message) {
  const error = new Error(message);
  error.isUsage = true;
  return error;
}

function parseArgv(argv) {
  const options = {
    positional: [],
    overrides: {},
    theme: "dark",
    lang: null,
    width: 600,
    scale: 2,
    frame: null,
    radius: null,
    bg: null,
    pageBg: null,
    transparent: false,
    showMedia: true,
    showMetrics: true,
    showAvatar: true,
    noWebfont: false,
    useWebfont: true,
    layout: "auto",
    longThreshold: 360,
    spreadThreshold: 1400,
    bilingualThreshold: 700,
    longHeight: null,
    title: "",
    subtitle: "",
    python: process.env.PYTHON || "python",
    cssFile: null,
    out: null,
    outDir: null,
    html: null,
    htmlOnly: false,
    data: null,
    translate: null,
    bilingual: false,
    translationProvider: "auto",
    json: false,
    keep: false,
    engine: "auto",
    chrome: null,
    timeout: 60_000,
    cacheDir: defaultCacheDir(),
    noCache: false,
    offline: false,
    verbose: false,
    doctor: false,
    help: false,
    version: false,
  };

  const valueOptions = new Map([
    ["-o", "out"],
    ["--out", "out"],
    ["--out-dir", "outDir"],
    ["-t", "theme"],
    ["--theme", "theme"],
    ["-l", "lang"],
    ["--lang", "lang"],
    ["-w", "width"],
    ["--width", "width"],
    ["-s", "scale"],
    ["--scale", "scale"],
    ["--frame", "frame"],
    ["--radius", "radius"],
    ["--bg", "bg"],
    ["--page-bg", "pageBg"],
    ["--css", "cssFile"],
    ["--html", "html"],
    ["--data", "data"],
    ["--translate", "translate"],
    ["--translation-provider", "translationProvider"],
    ["--layout", "layout"],
    ["--long-threshold", "longThreshold"],
    ["--spread-threshold", "spreadThreshold"],
    ["--bilingual-threshold", "bilingualThreshold"],
    ["--long-height", "longHeight"],
    ["--title", "title"],
    ["--subtitle", "subtitle"],
    ["--python", "python"],
    ["--engine", "engine"],
    ["--chrome", "chrome"],
    ["--timeout", "timeout"],
    ["--cache-dir", "cacheDir"],
    ["--replies", "replies"],
    ["--reposts", "reposts"],
    ["--retweets", "reposts"],
    ["--likes", "likes"],
    ["--views", "views"],
  ]);

  const flagOptions = new Map([
    ["--transparent", "transparent"],
    ["--bilingual", "bilingual"],
    ["--no-media", "noMedia"],
    ["--no-metrics", "noMetrics"],
    ["--no-avatar", "noAvatar"],
    ["--no-webfont", "noWebfont"],
    ["--html-only", "htmlOnly"],
    ["--json", "json"],
    ["--keep", "keep"],
    ["--no-cache", "noCache"],
    ["--offline", "offline"],
    ["--verbose", "verbose"],
    ["--doctor", "doctor"],
    ["--help", "help"],
    ["-h", "help"],
    ["--version", "version"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.positional.push(...argv.slice(index + 1));
      break;
    }

    let name = arg;
    let inlineValue = null;
    if (arg.startsWith("--") && arg.includes("=")) {
      const split = arg.indexOf("=");
      name = arg.slice(0, split);
      inlineValue = arg.slice(split + 1);
    }

    if (valueOptions.has(name)) {
      const key = valueOptions.get(name);
      const value = inlineValue !== null ? inlineValue : argv[++index];
      if (value === undefined) throw usageError(`Missing value for ${name}`);
      if (key === "replies" || key === "reposts" || key === "likes" || key === "views") {
        const parsed = parseCount(value);
        if (parsed === null) throw usageError(`Invalid count for ${name}: ${value}`);
        options.overrides[key] = parsed;
      } else {
        options[key] = value;
      }
      continue;
    }

    if (flagOptions.has(name)) {
      if (inlineValue !== null) throw usageError(`${name} does not take a value`);
      const key = flagOptions.get(name);
      if (key === "noMedia") options.showMedia = false;
      else if (key === "noMetrics") options.showMetrics = false;
      else if (key === "noAvatar") options.showAvatar = false;
      else options[key] = true;
      continue;
    }

    if (name.startsWith("-")) {
      throw usageError(`Unknown option: ${name}`);
    }
    options.positional.push(arg);
  }

  options.width = clampInteger(options.width, 320, 1600, "--width");
  options.scale = clampInteger(options.scale, 1, 4, "--scale");
  options.timeout = clampInteger(options.timeout, 5_000, 300_000, "--timeout");
  if (options.radius !== null) options.radius = clampInteger(options.radius, 0, 64, "--radius");
  if (!["light", "dim", "dark"].includes(options.theme)) {
    throw usageError(`--theme must be light, dim or dark (got "${options.theme}")`);
  }
  if (!["auto", "playwright", "chrome"].includes(options.engine)) {
    throw usageError(`--engine must be auto, playwright or chrome (got "${options.engine}")`);
  }
  if (!["auto", "single", "tall", "spread"].includes(options.layout)) {
    throw usageError(`--layout must be auto, single, tall or spread (got "${options.layout}")`);
  }
  options.longThreshold = clampInteger(options.longThreshold, 80, 10_000, "--long-threshold");
  options.spreadThreshold = clampInteger(options.spreadThreshold, 600, 10_000, "--spread-threshold");
  options.bilingualThreshold = clampInteger(options.bilingualThreshold, 80, 10_000, "--bilingual-threshold");
  if (options.frame && !["none", "card"].includes(options.frame)) {
    throw usageError(`--frame must be none or card (got "${options.frame}")`);
  }
  if (!["auto", "mymemory", "google"].includes(options.translationProvider)) {
    throw usageError(
      `--translation-provider must be auto, mymemory or google (got "${options.translationProvider}")`,
    );
  }
  if (options.noCache) options.cacheDir = null;
  return options;
}

function clampInteger(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.round(number) !== number) {
    throw usageError(`${label} must be an integer`);
  }
  if (number < min || number > max) {
    throw usageError(`${label} must be between ${min} and ${max}`);
  }
  return number;
}

function defaultOutputPath(tweet, outDir) {
  return path.resolve(outDir || ".", `x-post-${tweet.id || "card"}.png`);
}

function log(options, message) {
  if (!options.json) console.error(message);
}

async function renderOne(input, options, sharedCss) {
  let tweet;
  if (options.data) {
    tweet = await loadTweetData(options.data);
  } else {
    const parsed = await resolveTweetInput(input, { timeout: options.timeout });
    tweet = await fetchTweet(parsed, {
      lang: options.lang || "en",
      timeout: options.timeout,
      cacheDir: options.cacheDir,
      offline: options.offline,
      verbose: options.verbose,
    });
  }

  if (options.translate) {
    const target = options.translate === "auto" ? options.lang || "zh-CN" : options.translate;
    tweet = await translateTweet(tweet, {
      target,
      bilingual: options.bilingual || Boolean(options.translate),
      provider: options.translationProvider,
      timeout: options.timeout,
      cacheDir: options.cacheDir,
      offline: options.offline,
    });
  }

  tweet = applyMetricOverrides(tweet, options.overrides);
  const originalAvatarUrl = tweet.author?.avatarUrl || "";
  const outputPath = options.out
    ? path.resolve(options.out)
    : defaultOutputPath(tweet, options.outDir);
  const textLength = String(tweet.text || "").length;
  const originalText = String(tweet.translation?.originalText || "");
  const shouldBilingual = Boolean(
    options.layout !== "single" &&
    options.translate &&
    tweet.translation?.changed &&
    originalText &&
    textLength <= options.bilingualThreshold,
  );
  const useLongLayout = options.layout === "spread" || options.layout === "tall" || shouldBilingual || (options.layout === "auto" && textLength >= options.longThreshold);

  if (useLongLayout) {
    if (options.htmlOnly) {
      throw new TweetError("--html-only is only supported for single-page cards; use --layout single.");
    }
    const avatarFile = originalAvatarUrl
      ? originalAvatarUrl.startsWith("http")
        ? (await cacheImageFile(originalAvatarUrl, {
            cacheDir: options.cacheDir,
            timeout: options.timeout,
          })) || ""
        : originalAvatarUrl
      : "";
    const mediaFiles = (
      await Promise.all(
        (tweet.media || [])
          .filter((item) => item.type === "photo" && item.url)
          .slice(0, 4)
          .map((item) => cacheImageFile(item.url, {
            cacheDir: options.cacheDir,
            timeout: options.timeout,
          })),
      )
    ).filter(Boolean);
    if (options.layout === "spread") {
      const spreadData = buildSpreadCardData(tweet, {
        text: tweet.text,
        avatar: avatarFile,
        media: mediaFiles,
        translated: Boolean(tweet.translation?.changed),
      });
      const spreadShot = await renderSpreadCard(spreadData, {
        out: outputPath,
        python: options.python,
        width: 1080,
        scale: 1,
      });
      return {
        ok: true,
        id: tweet.id,
        url: tweet.url,
        author: tweet.author,
        text: tweet.text,
        metrics: tweet.metrics,
        theme: "x-article",
        layout: spreadShot.pages === 3 ? "three-page-x-cards" : "two-page-x-cards",
        out: spreadShot.output,
        html: null,
        width: spreadShot.width,
        height: spreadShot.height,
        engine: "pillow-two-page-card",
        source: tweet._meta?.source || "unknown",
        translation: tweet.translation || null,
        bytes: null,
      };
    }
    const articleData = buildArticleCardData(tweet, {
      text: tweet.text,
      avatar: avatarFile,
      translated: Boolean(tweet.translation?.changed),
      bilingual: shouldBilingual,
      originalText: shouldBilingual ? originalText : "",
      bodySize: shouldBilingual ? 34 : undefined,
      lineHeight: shouldBilingual ? 52 : undefined,
      media: mediaFiles,
    });
    const temporary = `${outputPath}.tall.tmp.png`;
    const articleShot = await renderArticleCard(articleData, {
      out: temporary,
      python: options.python,
      width: 1080,
      scale: 1,
    });
    if (options.layout === "auto" && !shouldBilingual && articleShot.height > options.spreadThreshold) {
      await rm(temporary, { force: true }).catch(() => {});
      const spreadData = buildSpreadCardData(tweet, {
        text: tweet.text,
        avatar: avatarFile,
        media: mediaFiles,
        translated: Boolean(tweet.translation?.changed),
      });
      const spreadShot = await renderSpreadCard(spreadData, {
        out: outputPath,
        python: options.python,
        width: 1080,
        scale: 1,
      });
      return {
        ok: true,
        id: tweet.id,
        url: tweet.url,
        author: tweet.author,
        text: tweet.text,
        metrics: tweet.metrics,
        theme: "x-article",
        layout: spreadShot.pages === 3 ? "three-page-x-cards" : "two-page-x-cards",
        out: spreadShot.output,
        html: null,
        width: spreadShot.width,
        height: spreadShot.height,
        engine: "pillow-two-page-card",
        source: tweet._meta?.source || "unknown",
        translation: tweet.translation || null,
        bytes: null,
      };
    }
    await rm(outputPath, { force: true }).catch(() => {});
    await rename(temporary, outputPath);
    return {
      ok: true,
      id: tweet.id,
      url: tweet.url,
      author: tweet.author,
      text: tweet.text,
      metrics: tweet.metrics,
      theme: "x-article",
      layout: "x-article-tall",
      out: outputPath,
      html: null,
      width: articleShot.width,
      height: articleShot.height,
      engine: "pillow-article-card",
      source: tweet._meta?.source || "unknown",
      translation: tweet.translation || null,
      bytes: null,
    };
  }

  tweet = await embedMedia(tweet, {
    cacheDir: options.cacheDir,
    offline: options.offline,
    timeout: options.timeout,
    includeMedia: options.showMedia,
  });
  const lang = options.lang || tweet.lang || "en";
  const title = `X post by @${tweet.author?.screenName || ""}`;
  const html = renderCardHtml(tweet, {
    theme: options.theme,
    lang,
    width: options.width,
    frame: options.frame || (options.radius !== null ? "card" : "none"),
    radius: options.radius,
    cardBg: options.bg,
    pageBg: options.pageBg,
    transparent: options.transparent,
    showMedia: options.showMedia,
    showMetrics: options.showMetrics,
    showAvatar: options.showAvatar,
    customCss: sharedCss || "",
    title,
    useWebfont: options.useWebfont,
  });

  const htmlPath = options.html ? path.resolve(options.html) : null;

  if (options.htmlOnly) {
    const target = htmlPath || outputPath.replace(/\.png$/i, ".html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html, "utf8");
    return {
      ok: true,
      id: tweet.id,
      url: tweet.url,
      author: tweet.author,
      html: target,
      out: null,
      width: null,
      height: null,
      source: tweet._meta?.source || "unknown",
      translation: tweet.translation || null,
    };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  if (htmlPath) await mkdir(path.dirname(htmlPath), { recursive: true });
  const shot = await renderScreenshot({
    html,
    htmlPath,
    outPath: outputPath,
    width: options.width,
    scale: options.scale,
    transparent: options.transparent,
    chromePath: options.chrome,
    engine: options.engine,
    timeout: options.timeout,
    keepTemp: options.keep,
  });

  return {
    ok: true,
    id: tweet.id,
    url: tweet.url,
    author: tweet.author,
    text: tweet.text,
    metrics: tweet.metrics,
    theme: options.theme,
    out: shot.outPath,
    html: htmlPath,
    width: shot.pixelWidth,
    height: shot.pixelHeight,
    engine: shot.engine,
    source: tweet._meta?.source || "unknown",
    translation: tweet.translation || null,
    bytes: shot.bytes,
  };
}

async function runDoctor(options) {
  const base = doctorReport({ chromePath: options.chrome, cacheDir: options.cacheDir });
  const playwright = await findPlaywright();
  const checks = {
    node: { ok: Number(process.versions.node.split(".")[0]) >= 18, detail: process.version },
    browser: {
      ok: Boolean(base.chrome || playwright),
      detail: base.chrome || (playwright ? `playwright (${playwright.name})` : "not found"),
    },
    playwright: { ok: Boolean(playwright), detail: playwright ? playwright.name : "not installed (optional)" },
    syndication: { ok: false, detail: "checking..." },
    fxtwitter: { ok: false, detail: "checking..." },
    fonts: { ok: false, detail: "checking..." },
    translation: { ok: false, detail: "checking..." },
    cache: { ok: true, detail: options.cacheDir || "disabled" },
  };

  const [syn, fx, font, mymemory, google] = await Promise.allSettled([
    fetchSyndication("20", { timeout: 10_000 }),
    fetchFxTwitter("20", { timeout: 10_000 }),
    fetch("https://abs.twimg.com/fonts/v2/chirp-regular-web.woff2", {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    }),
    translateText("hello", { from: "en", to: "zh-CN", provider: "mymemory", timeout: 10_000 }),
    translateText("hello", { from: "en", to: "zh-CN", provider: "google", timeout: 10_000 }),
  ]);
  checks.syndication = syn.status === "fulfilled"
    ? { ok: true, detail: "OK" }
    : { ok: false, detail: syn.reason?.message || String(syn.reason) };
  checks.fxtwitter = fx.status === "fulfilled"
    ? { ok: true, detail: "OK" }
    : { ok: false, detail: fx.reason?.message || String(fx.reason) };
  checks.fonts = font.status === "fulfilled" && font.value.ok
    ? { ok: true, detail: "OK" }
    : { ok: false, detail: "unreachable (system font fallback will be used)" };
  const mymemoryOk = mymemory.status === "fulfilled";
  const googleOk = google.status === "fulfilled";
  checks.translation = {
    ok: mymemoryOk || googleOk,
    detail: `${mymemoryOk ? "MyMemory OK" : "MyMemory failed"} / ${googleOk ? "Google OK" : "Google unavailable"}`,
  };

  const ready = checks.node.ok && checks.browser.ok && (checks.syndication.ok || checks.fxtwitter.ok);
  if (options.json) {
    console.log(JSON.stringify({ ok: ready, checks, ...base }, null, 2));
  } else {
    console.log(`x-post2image doctor ${VERSION}`);
    console.log(`  Node           ${checks.node.detail}${checks.node.ok ? "" : "  (need >= 18)"}`);
    console.log(`  Platform       ${base.platform}`);
    console.log(`  Chrome         ${checks.browser.detail}${base.chromeVersion ? `  ${base.chromeVersion}` : ""}`);
    console.log(`  Playwright     ${checks.playwright.detail}`);
    console.log(`  Syndication    ${checks.syndication.detail}`);
    console.log(`  fxTwitter      ${checks.fxtwitter.detail}`);
    console.log(`  Chirp fonts    ${checks.fonts.detail}`);
    console.log(`  Translation    ${checks.translation.detail}`);
    console.log(`  Cache          ${checks.cache.detail}`);
    console.log(`Result: ${ready ? "ready" : "not ready"}`);
  }
  return ready ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseArgv(process.argv.slice(2));
  } catch (error) {
    console.error(`x-post2image: ${error.message}\n`);
    console.error(HELP);
    process.exit(2);
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.version) {
    console.log(VERSION);
    return 0;
  }
  if (options.doctor) {
    return runDoctor(options);
  }
  if (options.data) {
    if (!options.positional.length) options.positional.push("-");
    if (options.positional.length > 1) throw usageError("--data can only be used once per invocation");
  }
  if (!options.positional.length) {
    console.error("x-post2image: pass an X post URL, a status id, or --data <file>.\n");
    console.error(HELP);
    return 2;
  }
  if (options.out && options.positional.length > 1) {
    throw usageError("--out can only be used with a single post; use --out-dir for batches");
  }
  if (options.html && options.positional.length > 1) {
    throw usageError("--html can only be used with a single post; use --html-only for batches");
  }
  if (options.data && options.positional.length > 1) {
    throw usageError("--data can only be used with a single post");
  }

  let customCss = "";
  if (options.cssFile) {
    customCss = await readFile(path.resolve(options.cssFile), "utf8");
  }
  options.useWebfont = !options.noWebfont && (await isFontReachable(2500));
  if (options.verbose) {
    console.error(`[x-post2image] Chirp webfont ${options.useWebfont ? "available" : "unavailable; using system font"}`);
  }

  const results = [];
  const failures = [];
  for (const input of options.positional) {
    try {
      if (options.positional.length > 1 && !options.json) console.error(`鈫?${input}`);
      const result = await renderOne(input, options, customCss);
      results.push(result);
      if (!options.json) {
        const size = result.width && result.height ? `${result.width}脳${result.height}` : "html";
        console.log(`鉁?${result.out || result.html}  ${size}  ${result.source}`);
      }
    } catch (error) {
      const message = error instanceof TweetError ? error.message : error.message || String(error);
      failures.push({ input, error: message, details: error.details });
      if (!options.json) console.error(`鉁?${input}: ${message}`);
      if (options.verbose && error.details) console.error(JSON.stringify(error.details, null, 2));
    }
  }

  if (options.json) {
    const payload = {
      ok: failures.length === 0,
      count: results.length,
      results,
      failures,
    };
    if (results.length === 1) {
      Object.assign(payload, results[0]);
    }
    console.log(JSON.stringify(payload, null, 2));
  }

  if (failures.length) {
    if (!options.json) {
      console.error(`\n${failures.length} of ${options.positional.length} post(s) failed.`);
      if (!options.verbose) console.error("Run again with --verbose for details.");
    }
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    console.error(`x-post2image: ${error.message || error}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });


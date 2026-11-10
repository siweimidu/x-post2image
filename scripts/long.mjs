#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { formatCompact, formatDate } from "./lib/format.mjs";
import { cacheImageFile } from "./lib/media.mjs";
import { translateText } from "./lib/translate.mjs";
import { defaultCacheDir, fetchTweet, resolveTweetInput } from "./lib/tweet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function splitParagraphs(text) {
  const paragraphs = String(text || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const source = paragraphs[0] || "";
  return source
    .split(/(?<=[。！？.!?])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstSentence(text, maxLength = 64) {
  const source = String(text || "").trim();
  const sentence = source.split(/(?<=[。！？.!?])\s*/u)[0] || source;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1)}…` : sentence;
}

function blockFor(text) {
  return {
    type: text.length <= 34 && !/[。！？.!?]$/u.test(text) ? "heading" : "paragraph",
    text,
  };
}

export function buildLongCardData(tweet, options = {}) {
  const text = String(options.text || tweet.text || "").trim();
  const paragraphs = splitParagraphs(text);
  const firstParagraph = paragraphs[0] || "";
  const providedTitle = String(options.title || "").trim();
  const title = providedTitle || firstSentence(firstParagraph);
  let subtitle = String(options.subtitle || "").trim();
  const body = [];
  const remainder = firstParagraph.startsWith(title) ? firstParagraph.slice(title.length).trim() : "";
  if (!subtitle && remainder && remainder.length <= 100) {
    subtitle = remainder;
  } else if (remainder) {
    body.push(remainder);
  }
  body.push(...paragraphs.slice(1));
  if (!body.length && text && text !== title) {
    body.push(text.replace(title, "").trim());
  }

  const total = body.reduce((sum, item) => sum + item.length, 0);
  const leftTarget = Math.max(220, total * 0.5);
  const left = [];
  let leftLength = 0;
  const right = [];
  for (const paragraph of body) {
    if (leftLength < leftTarget || left.length === 0) {
      left.push(blockFor(paragraph));
      leftLength += paragraph.length;
    } else {
      right.push(blockFor(paragraph));
    }
  }

  const metrics = tweet.metrics || {};
  const viewsText = formatCompact(metrics.views, "zh-CN");
  const dateText = tweet.createdAt ? formatDate(tweet.createdAt, "zh-CN") : "";
  const metaText = [dateText, viewsText ? `${viewsText} 查看` : ""].filter(Boolean).join(" · ");
  const values = [
    ["互动数据", "评论", formatCompact(metrics.replies, "zh-CN") || "—"],
    ["互动数据", "转发", formatCompact(metrics.reposts, "zh-CN") || "—"],
    ["互动数据", "点赞", formatCompact(metrics.likes, "zh-CN") || "—"],
    ["互动数据", "浏览", formatCompact(metrics.views, "zh-CN") || "—"],
  ];
  const rightBlocks = [...right];
  if (rightBlocks.length === 0 && left.length > 1) {
    rightBlocks.push(left.pop());
  }
  rightBlocks.push({
    type: "heading",
    text: "互动数据",
  });
  rightBlocks.push({
    type: "table",
    headers: ["系列", "衡量指标", "数值"],
    rows: values,
    col_widths: [2, 2, 2],
  });
  if (right.length || left.length) {
    rightBlocks.push({
      type: "callout",
      heading: "记住重要信息",
      text: String(options.remember || right[0]?.text || left[0]?.text || "").slice(0, 60),
    });
  }

  return {
    author: tweet.author?.name || "",
    handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : "",
    avatar: options.avatar || "",
    verified: Boolean(tweet.author?.verified),
    title,
    subtitle,
    left_blocks: left,
    right_blocks: rightBlocks,
    metrics: {
      replies: metrics.replies,
      reposts: metrics.reposts,
      likes: metrics.likes,
      views: metrics.views,
      bookmarks: metrics.bookmarks,
    },
    source: tweet.url || "",
    date: tweet.createdAt ? formatDate(tweet.createdAt, "zh-CN").split(" · ")[1] || "" : "",
    meta_text: metaText,
    views_display: viewsText ? `${viewsText} 查看` : "",
    top_right: "X",
    bottom_right: ["Excerpt", options.translated ? "AI 翻译" : "X Post"],
    title_size: title.length > 38 ? 24 : 27,
    body_size: options.bodySize || (text.length > 1200 ? 13 : text.length > 900 ? 14 : text.length > 650 ? 15 : 16),
    ...(options.extra || {}),
  };
}

function splitCodeSegments(text) {
  const segments = [];
  const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) segments.push({ type: "text", text: text.slice(cursor, match.index) });
    segments.push({ type: "code", language: match[1], text: match[2].replace(/\n$/, "") });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments.filter((segment) => segment.text.trim());
}

function longDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace("T", " ");
}

export function buildArticleCardData(tweet, options = {}) {
  const text = String(options.text || tweet.text || "")
    .trim()
    .replace(/➤/g, "•")
    .replace(/▪/g, "•");
  return {
    author: tweet.author?.name || "",
    handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : "",
    avatar: options.avatar || "",
    verified: Boolean(tweet.author?.verified),
    text,
    segments: splitCodeSegments(text),
    date_display: longDate(tweet.createdAt),
    timezone_label: "UTC+8",
    translation_label: options.translated ? "AI 翻译" : "原文",
    media: options.media || [],
    body_size: options.bodySize || (text.length > 900 ? 30 : 34),
    line_height: options.lineHeight || (text.length > 900 ? 46 : 52),
  };
}

export async function renderArticleCard(data, { out, python = process.env.PYTHON || "python", width = 1080, scale = 1 } = {}) {
  const output = path.resolve(out);
  await mkdir(path.dirname(output), { recursive: true });
  const inputPath = `${output}.input.json`;
  await writeFile(inputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    const result = spawnSync(python, [
      path.join(here, "insight", "render_article_card.py"),
      "--input",
      inputPath,
      "--output",
      output,
      "--width",
      String(width),
      "--scale",
      String(scale),
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`${python} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
    }
    const match = `${result.stdout || ""}`.match(/\{[\s\S]*\}\s*$/);
    if (!match) throw new Error(`Could not parse article-card renderer output: ${result.stdout}`);
    return JSON.parse(match[0]);
  } finally {
    await rm(inputPath, { force: true }).catch(() => {});
  }
}

export function buildSpreadCardData(tweet, options = {}) {
  const text = String(options.text || tweet.text || "")
    .trim()
    .replace(/➤/g, "•")
    .replace(/▪/g, "•");
  return {
    author: tweet.author?.name || "",
    handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : "",
    avatar: options.avatar || "",
    verified: Boolean(tweet.author?.verified),
    text,
    media: options.media || [],
    media_label: options.mediaLabel || "Video preview",
    date_display: longDate(tweet.createdAt),
    timezone_label: "UTC+8",
    translation_label: options.translated ? "AI 翻译" : "原文",
    body_size: options.bodySize || (text.length > 1400 ? 13 : text.length > 700 ? 15 : 17),
    line_height: options.lineHeight || (text.length > 1400 ? 21 : text.length > 700 ? 24 : 27),
  };
}

export async function renderSpreadCard(data, { out, python = process.env.PYTHON || "python", width = 1080, scale = 1 } = {}) {
  const output = path.resolve(out);
  await mkdir(path.dirname(output), { recursive: true });
  const inputPath = `${output}.input.json`;
  await writeFile(inputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    const result = spawnSync(python, [
      path.join(here, "insight", "render_two_page.py"),
      "--input",
      inputPath,
      "--output",
      output,
      "--width",
      String(width),
      "--scale",
      String(scale),
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`${python} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
    }
    const match = `${result.stdout || ""}`.match(/\{[\s\S]*\}\s*$/);
    if (!match) throw new Error(`Could not parse two-page renderer output: ${result.stdout}`);
    return JSON.parse(match[0]);
  } finally {
    await rm(inputPath, { force: true }).catch(() => {});
  }
}

export async function renderLongCard(data, { out, python = process.env.PYTHON || "python", width = 1080, height = 720, scale = 1 } = {}) {
  const output = path.resolve(out);
  await mkdir(path.dirname(output), { recursive: true });
  const inputPath = `${output}.input.json`;
  await writeFile(inputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    const result = spawnSync(python, [
      path.join(here, "insight", "render_long_card.py"),
      "--input",
      inputPath,
      "--output",
      output,
      "--width",
      String(width),
      "--height",
      String(height),
      "--scale",
      String(scale),
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`${python} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
    }
    const match = `${result.stdout || ""}`.match(/\{[\s\S]*\}\s*$/);
    if (!match) throw new Error(`Could not parse long-card renderer output: ${result.stdout}`);
    return JSON.parse(match[0]);
  } finally {
    await rm(inputPath, { force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const options = {
    url: null,
    out: null,
    translate: "zh-CN",
    title: "",
    subtitle: "",
    cacheDir: defaultCacheDir(),
    python: process.env.PYTHON || "python",
    width: 1080,
    height: 0,
    scale: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log("Usage: node scripts/long.mjs <url> --out long.png [--translate zh-CN] [--title ...] [--subtitle ...] [--width 1080] [--height 720] [--scale 2]");
      process.exit(0);
    }
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (!arg.startsWith("--")) {
      options.url = arg;
      continue;
    }
    switch (arg) {
      case "--out": options.out = next(); break;
      case "--translate": options.translate = next(); break;
      case "--title": options.title = next(); break;
      case "--subtitle": options.subtitle = next(); break;
      case "--cache-dir": options.cacheDir = next(); break;
      case "--python": options.python = next(); break;
      case "--width": options.width = Number(next()); break;
      case "--height": options.height = Number(next()); break;
      case "--scale": options.scale = Number(next()); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.url || !options.out) throw new Error("URL and --out are required");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const parsed = await resolveTweetInput(options.url);
  const tweet = await fetchTweet(parsed, { cacheDir: options.cacheDir, timeout: 20_000 });
  let text = tweet.text;
  let translated = false;
  if (options.translate) {
    const result = await translateText(tweet.text, {
      from: tweet.lang || "auto",
      to: options.translate,
      timeout: 30_000,
      cacheDir: options.cacheDir,
    });
    text = result.text;
    translated = !result.unchanged;
  }
  const avatar = tweet.author?.avatarUrl
    ? (await cacheImageFile(tweet.author.avatarUrl, { cacheDir: options.cacheDir, timeout: 20_000 })) || ""
    : "";
  const data = buildLongCardData({ ...tweet, text }, {
    text,
    title: options.title,
    subtitle: options.subtitle,
    avatar,
    translated,
  });
  const height = options.height || (text.length > 1200 ? 1100 : text.length > 800 ? 900 : text.length > 500 ? 800 : 720);
  const meta = await renderLongCard(data, {
    out: options.out,
    python: options.python,
    width: options.width,
    height,
    scale: options.scale,
  });
  console.log(JSON.stringify({ ...meta, source: tweet.url, translated }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`long: ${error.message}`);
    process.exitCode = 1;
  });
}

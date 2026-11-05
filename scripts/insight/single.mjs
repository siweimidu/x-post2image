#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { cacheImageFile } from "../lib/media.mjs";
import { translateText } from "../lib/translate.mjs";
import { defaultCacheDir, fetchTweet, resolveTweetInput } from "../lib/tweet.mjs";
import { writeJson } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    url: null,
    out: null,
    translate: "zh-CN",
    renderMode: "auto",
    bilingualMaxHeight: 1200,
    caption: "",
    dateDisplay: "",
    viewsDisplay: "",
    cacheDir: defaultCacheDir(),
    python: process.env.PYTHON || "python",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log("Usage: node scripts/insight/single.mjs <url> --out card.png [--translate zh-CN] [--render-mode auto] [--bilingual-max-height 1200]");
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
      case "--render-mode": options.renderMode = next(); break;
      case "--bilingual-max-height": options.bilingualMaxHeight = Number(next()); break;
      case "--caption": options.caption = next(); break;
      case "--date-display": options.dateDisplay = next(); break;
      case "--views-display": options.viewsDisplay = next(); break;
      case "--cache-dir": options.cacheDir = next(); break;
      case "--python": options.python = next(); break;
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
  const translated = await translateText(tweet.text, {
    from: tweet.lang || "auto",
    to: options.translate,
    provider: "auto",
    timeout: 30_000,
    cacheDir: options.cacheDir,
  });
  const avatar = tweet.author?.avatarUrl
    ? (await cacheImageFile(tweet.author.avatarUrl, { cacheDir: options.cacheDir, timeout: 20_000 })) || ""
    : "";
  const input = {
    author: tweet.author?.name || "",
    handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : "",
    post: tweet.text || "",
    translation: translated.text,
    avatar,
    avatar_url: tweet.author?.avatarUrl || "",
    date_display: options.dateDisplay || (tweet.createdAt
      ? new Intl.DateTimeFormat(options.translate || "zh-CN", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(new Date(tweet.createdAt))
      : ""),
    views_display: options.viewsDisplay,
    render_mode: options.renderMode,
    bilingual_max_height: options.bilingualMaxHeight,
  };
  const out = path.resolve(options.out);
  await mkdir(path.dirname(out), { recursive: true });
  const inputPath = `${out}.input.json`;
  await writeJson(inputPath, input);
  const result = spawnSync(options.python, [path.join(here, "render_card.py"), "--input", inputPath, "--output", out], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  await rm(inputPath, { force: true }).catch(() => {});
  if (result.status !== 0) throw new Error(`${options.python} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
  const match = `${result.stdout || ""}`.match(/\{[\s\S]*\}\s*$/);
  const meta = match ? JSON.parse(match[0]) : { output: out };
  console.log(JSON.stringify({ ...meta, caption: options.caption, source: tweet.url }, null, 2));
}

main().catch((error) => {
  console.error(`insight single: ${error.message}`);
  process.exitCode = 1;
});

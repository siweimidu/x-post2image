import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { formatCompact, formatDate } from "../lib/format.mjs";
import { cacheImageFile } from "../lib/media.mjs";
import { translateText } from "../lib/translate.mjs";
import { fetchTweet, resolveTweetInput } from "../lib/tweet.mjs";
import { defaultCacheDir } from "../lib/tweet.mjs";
import { appendHistory, textSha256 } from "./lib.mjs";

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    translate: null,
    lang: "zh-CN",
    cacheDir: defaultCacheDir(),
    offline: false,
    limit: 50,
    verbose: false,
    history: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--input":
        options.input = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--translate":
        options.translate = next();
        break;
      case "--lang":
        options.lang = next();
        break;
      case "--cache-dir":
        options.cacheDir = next();
        break;
      case "--history":
        options.history = next();
        break;
      case "--offline":
        options.offline = true;
        break;
      case "--limit":
        options.limit = Number(next());
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--help":
        console.log(`Usage: node scripts/insight/verify.mjs --input urls.json --output candidates.json [options]

Input: JSON array of URLs, or objects with a "url" field. Objects may also carry
score_detail, caption, flags and translation from the agent.

Options:
  --translate <lang>  Translate each post into lang (e.g. zh-CN)
  --lang <code>       Locale for dates/counts (default zh-CN)
  --cache-dir <dir>   Tweet/media cache directory
  --history <file>    Append VERIFIED state records to history.jsonl
  --offline           Use cached tweet JSON/media only
  --limit <n>         Max candidates to verify (default 50)
  --verbose           Log progress to stderr`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.input || !options.output) {
    throw new Error("--input and --output are required");
  }
  return options;
}

function dateOnly(value, locale) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = JSON.parse((await readFile(options.input, "utf8")).replace(/^\uFEFF/, ""));
  const list = Array.isArray(raw) ? raw : raw.urls || raw.candidates || [];
  if (!Array.isArray(list)) throw new Error("Input must be an array, {urls:[]} or {candidates:[]}");
  const candidates = [];
  const errors = [];

  for (const [index, item] of list.slice(0, options.limit).entries()) {
    const input = typeof item === "string" ? { url: item } : item || {};
    try {
      const parsed = await resolveTweetInput(input.url, { timeout: 20_000 });
      const tweet = await fetchTweet(parsed, {
        lang: options.lang,
        timeout: 20_000,
        cacheDir: options.cacheDir,
        offline: options.offline,
        verbose: options.verbose,
      });
      let translation = String(input.translation || "");
      if (!translation && options.translate) {
        const result = await translateText(tweet.text, {
          from: tweet.lang || "auto",
          to: options.translate,
          provider: "auto",
          timeout: 30_000,
          cacheDir: options.cacheDir,
          offline: options.offline,
        });
        translation = result.text;
      }
      let avatarPath = input.avatar || "";
      if (!avatarPath && tweet.author?.avatarUrl) {
        avatarPath = (await cacheImageFile(tweet.author.avatarUrl, {
          cacheDir: options.cacheDir,
          timeout: 20_000,
        })) || "";
      }
      const candidate = {
        id: input.id || `candidate-${index + 1}`,
        url: tweet.url,
        author: tweet.author?.name || "",
        handle: tweet.author?.screenName ? `@${tweet.author.screenName}` : "",
        avatar: avatarPath,
        avatar_url: tweet.author?.avatarUrl || "",
        post: tweet.text || "",
        translation,
        published_at: tweet.createdAt || "",
        date_display: dateOnly(tweet.createdAt, options.lang),
        views_display: tweet.metrics?.views
          ? `${formatCompact(tweet.metrics.views, options.lang)} ${options.lang.startsWith("zh") ? "次查看" : "Views"}`
          : "",
        flags: input.flags || [],
        score_detail: input.score_detail || {},
        caption: input.caption || "",
        render_method: "rearranged-render",
        metrics: tweet.metrics,
        source_lang: tweet.lang || "",
      };
      candidates.push(candidate);
      if (options.history) {
        await appendHistory(options.history, {
          type: "candidate",
          state: "VERIFIED",
          verified_at: new Date().toISOString(),
          url: candidate.url,
          text_sha256: textSha256(candidate.post),
          author: candidate.author,
          handle: candidate.handle,
          translation: candidate.translation,
        });
      }
      console.error(`✓ ${index + 1}/${Math.min(list.length, options.limit)} ${tweet.url}`);
    } catch (error) {
      errors.push({ input: typeof item === "string" ? item : item?.url, error: error.message });
      console.error(`✗ ${typeof item === "string" ? item : item?.url}: ${error.message}`);
    }
  }

  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(
    options.output,
    `${JSON.stringify({ candidates, errors }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ output: options.output, candidates: candidates.length, errors: errors.length }));
}

main().catch((error) => {
  console.error(`verify_candidates: ${error.message}`);
  process.exitCode = 1;
});

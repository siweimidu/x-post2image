import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { cacheImageFile } from "../lib/media.mjs";
import { defaultCacheDir } from "../lib/tweet.mjs";
import {
  appendHistory,
  dateInTimeZone,
  latestRunCompletion,
  makeRunId,
  rankCandidates,
  readHistory,
  readJson,
  writeJson,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const now = new Date();
  const options = {
    input: null,
    history: null,
    outDir: null,
    scheduledFor: null,
    timezone: "Asia/Shanghai",
    minimum: 75,
    limit: 5,
    renderMode: "auto",
    bilingualMaxHeight: 1200,
    cacheDir: defaultCacheDir(),
    now,
    force: false,
    dryRun: false,
    python: process.env.PYTHON || "python",
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
      case "--history":
        options.history = next();
        break;
      case "--out-dir":
        options.outDir = next();
        break;
      case "--scheduled-for":
        options.scheduledFor = next();
        break;
      case "--timezone":
        options.timezone = next();
        break;
      case "--minimum":
        options.minimum = Number(next());
        break;
      case "--limit":
        options.limit = Number(next());
        break;
      case "--render-mode":
        options.renderMode = next();
        break;
      case "--bilingual-max-height":
        options.bilingualMaxHeight = Number(next());
        break;
      case "--cache-dir":
        options.cacheDir = next();
        break;
      case "--now":
        options.now = new Date(next());
        break;
      case "--force":
        options.force = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--python":
        options.python = next();
        break;
      case "--help":
        console.log(`Usage: node scripts/insight/daily.mjs --input candidates.json --history history.jsonl --out-dir out [options]

Options:
  --scheduled-for <iso>        Target time (default: today 12:00 in timezone)
  --timezone <iana>            Default Asia/Shanghai
  --minimum <n>                Minimum score (default 75)
  --limit <n>                  Max selected (default 5)
  --render-mode <mode>         auto | bilingual | translation-only
  --bilingual-max-height <px>  default 1200
  --cache-dir <dir>            Tweet/media cache
  --now <iso>                  Override current time (testing)
  --force                      Run even if a completion exists
  --dry-run                    Print plan without rendering/writing history
  --python <bin>               Python with Pillow (default python)`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.input || !options.history || !options.outDir) {
    throw new Error("--input, --history and --out-dir are required");
  }
  return options;
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
  }
  return result.stdout;
}

async function acquireLock(outDir) {
  await mkdir(outDir, { recursive: true });
  const lock = path.join(outDir, ".x-post2image.lock");
  try {
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
    return lock;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = await stat(lock).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 2 * 60 * 60 * 1000) {
      await unlink(lock).catch(() => {});
      await writeFile(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
      return lock;
    }
    throw new Error(`Another insight run holds ${lock}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = await readJson(options.input);
  const candidates = Array.isArray(input) ? input : input.candidates || [];
  const history = await readHistory(options.history);
  const scheduledFor = options.scheduledFor
    ? new Date(options.scheduledFor)
    : new Date(`${dateInTimeZone(options.now, options.timezone)}T12:00:00+08:00`);
  const date = dateInTimeZone(scheduledFor, options.timezone);

  if (!options.force && scheduledFor > options.now) {
    console.log(JSON.stringify({ ok: true, skipped: "not_due", scheduled_for: scheduledFor.toISOString() }));
    return;
  }
  const previous = latestRunCompletion(history.records, date, options.timezone);
  if (!options.force && previous) {
    const assetsOk = (previous.images || []).every((file) => existsSync(file));
    if (assetsOk) {
      console.log(JSON.stringify({ ok: true, skipped: "already_completed", run_id: previous.run_id }));
      return;
    }
  }

  const ranked = rankCandidates(candidates, {
    historyUrls: history.urls,
    historyHashes: history.hashes,
    minimum: options.minimum,
    limit: options.limit,
  });
  if (!ranked.selection_count) {
    console.error("No candidates passed the quality bar.");
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(options.outDir);
  const runId = makeRunId(options.now, options.timezone);
  const rankedPath = path.join(outDir, "ranked.json");
  await writeJson(rankedPath, ranked);

  // Make sure every selected candidate has a real local avatar before rendering.
  for (const candidate of ranked.selected) {
    if (!candidate.avatar && candidate.avatar_url) {
      candidate.avatar = (await cacheImageFile(candidate.avatar_url, {
        cacheDir: options.cacheDir,
        timeout: 20_000,
      })) || "";
    }
  }
  await writeJson(rankedPath, ranked);

  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, run_id: runId, selected: ranked.selected.map((item) => item.id), out_dir: outDir }));
    return;
  }

  const lock = await acquireLock(outDir);
  try {
    runNode(path.join(here, "render.mjs"), [
      "--input", rankedPath,
      "--out-dir", outDir,
      "--render-mode", options.renderMode,
      "--bilingual-max-height", String(options.bilingualMaxHeight),
      "--cache-dir", options.cacheDir,
      "--python", options.python,
    ]);
    const qaPath = path.join(outDir, "qa.json");
    runNode(path.join(here, "qa.mjs"), [
      "--input", rankedPath,
      "--out-dir", outDir,
      "--output", qaPath,
      "--minimum", String(options.minimum),
    ]);
    const packPath = path.join(outDir, "pack.json");
    runNode(path.join(here, "pack.mjs"), [
      "--input", rankedPath,
      "--out-dir", outDir,
      "--output", packPath,
      "--run-id", runId,
    ]);
    const pack = await readFile(packPath, "utf8");
    const packJson = JSON.parse(pack);
    const images = packJson.pairs.map((pair) => pair.image);

    for (const candidate of ranked.selected) {
      await appendHistory(options.history, {
        type: "selected",
        run_id: runId,
        run_date: date,
        url: candidate.url,
        text_sha256: candidate.text_sha256,
        caption: candidate.caption,
        score: candidate.score,
        state: "READY_FOR_REVIEW",
        source_text: candidate.post,
        translation: candidate.translation,
      });
    }
    const completion = {
      type: "run_completion",
      run_id: runId,
      scheduled_for: scheduledFor.toISOString(),
      actual_run_at: new Date().toISOString(),
      timezone: options.timezone,
      catch_up: Boolean(previous || scheduledFor < options.now),
      selection_count: ranked.selection_count,
      status: "READY_FOR_REVIEW",
      states: ["DISCOVERED", "VERIFIED", "SCORED", "CAPTURED", "TRANSLATED", "READY_FOR_REVIEW"],
      pack: packPath,
      images,
      selected: ranked.selected.map((item) => ({ id: item.id, url: item.url, score: item.score })),
      rejected: ranked.rejected,
    };
    await appendHistory(options.history, completion);
    console.log(JSON.stringify({ ok: true, run_id: runId, selection_count: ranked.selection_count, pack: packPath }));
  } finally {
    await unlink(lock).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`daily: ${error.message}`);
  process.exitCode = 1;
});

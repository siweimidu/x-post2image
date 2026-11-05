import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { captionIssues, readJson, writeJson } from "./lib.mjs";

function parseArgs(argv) {
  const options = { input: null, outDir: null, output: null, runId: null };
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
      case "--out-dir":
        options.outDir = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--run-id":
        options.runId = next();
        break;
      case "--help":
        console.log("Usage: node scripts/insight/pack.mjs --input ranked.json --out-dir out --output pack.json [--run-id id]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.input || !options.outDir || !options.output) {
    throw new Error("--input, --out-dir and --output are required");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = await readJson(options.input);
  const candidates = Array.isArray(data) ? data : data.selected || data.candidates || [];
  const pairs = [];
  const rejected = [];
  for (const candidate of candidates) {
    const id = String(candidate.id || "card").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const image = path.resolve(options.outDir, `${id}.png`);
    const issues = captionIssues(candidate.caption || "");
    if (issues.length) {
      rejected.push({ id: candidate.id, issues });
      continue;
    }
    const bytes = await readFile(image);
    pairs.push({
      id: candidate.id,
      image,
      caption: candidate.caption,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: candidate.url,
      score: candidate.score,
    });
  }
  const pack = {
    run_id: options.runId || `pack-${Date.now()}`,
    created_at: new Date().toISOString(),
    pairs,
    rejected,
  };
  await writeJson(options.output, pack);
  console.log(JSON.stringify({ output: options.output, pairs: pairs.length, rejected: rejected.length }));
  if (rejected.length || !pairs.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`pack: ${error.message}`);
  process.exitCode = 1;
});

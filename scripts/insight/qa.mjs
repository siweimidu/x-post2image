import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { pngSize } from "../lib/screenshot.mjs";
import { captionIssues, readJson, validateScoreDetail, writeJson } from "./lib.mjs";

function parseArgs(argv) {
  const options = { input: null, outDir: null, output: null, minimum: 75 };
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
      case "--minimum":
        options.minimum = Number(next());
        break;
      case "--help":
        console.log("Usage: node scripts/insight/qa.mjs --input ranked.json --out-dir out --output qa.json [--minimum 75]");
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
  const checks = [];
  const failures = [];

  for (const [index, candidate] of candidates.entries()) {
    const id = candidate.id || `candidate-${index + 1}`;
    const issues = [];
    if (!candidate.url) issues.push("missing_url");
    if (!candidate.author) issues.push("missing_author");
    if (!candidate.handle) issues.push("missing_handle");
    if (!candidate.avatar && !candidate.avatar_url) issues.push("missing_real_avatar");
    if (!candidate.post) issues.push("missing_post");
    if (!candidate.translation) issues.push("missing_translation");
    const { total, errors } = validateScoreDetail(candidate.score_detail || {});
    issues.push(...errors);
    if (!errors.length && total < options.minimum) issues.push(`score_below_${options.minimum}`);
    issues.push(...captionIssues(candidate.caption || ""));
    const imagePath = path.join(options.outDir, `${String(id).replace(/[^a-zA-Z0-9._-]+/g, "-")}.png`);
    if (!existsSync(imagePath)) {
      issues.push("missing_rendered_png");
    } else {
      const size = pngSize(imagePath);
      if (!size || size.width < 1000 || size.height < 400) issues.push("invalid_png_dimensions");
      if (statSync(imagePath).size < 10_000) issues.push("png_too_small");
    }
    const record = { id, url: candidate.url, score: total, issues, image: imagePath };
    checks.push(record);
    if (issues.length) failures.push(record);
  }

  const result = {
    ok: failures.length === 0 && checks.length > 0,
    checked: checks.length,
    failed: failures.length,
    checks,
    failures,
  };
  await writeJson(options.output, result);
  console.log(JSON.stringify({ ok: result.ok, checked: result.checked, failed: result.failed, output: options.output }));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`qa: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const commands = {
  search: "insight/search-queries.mjs",
  verify: "insight/verify.mjs",
  single: "insight/single.mjs",
  rank: "insight/rank.mjs",
  render: "insight/render.mjs",
  qa: "insight/qa.mjs",
  pack: "insight/pack.mjs",
  daily: "insight/daily.mjs",
  history: "insight/history.mjs",
  deliver: "insight/delivery/wechat_ilink_delivery.mjs",
  listener: "insight/delivery/wechat_ilink_listener.mjs",
};

const [, , command, ...args] = process.argv;
if (!command || command === "--help" || command === "-h" || command === "help") {
  console.log(`x-post2image insight pipeline

USAGE
  node scripts/insight.mjs <command> [options]

COMMANDS
  search   Print X search URLs for a topic/time window
  verify   Fetch URLs and build candidate JSON (author/avatar/text/translation)
  single   Render one URL directly with the Pillow insight renderer
  rank     Score, deduplicate against history, select top N
  render   Render selected candidates with the Pillow insight renderer
  qa       Run the review-ready checklist
  pack     Build a caption+PNG pack manifest with hashes
  daily    Run the full scheduled/catch-up pipeline and write history
  history  check | add | summary a history.jsonl
  deliver  WeChat iLink private-review delivery (optional)
  listener WeChat iLink background listener (optional)

EXAMPLES
  node scripts/insight.mjs search --topic "habits" --hours 24
  node scripts/insight.mjs verify --input urls.json --output candidates.json --translate zh-CN
  node scripts/insight.mjs rank --input candidates.json --history history.jsonl --output ranked.json
  node scripts/insight.mjs render --input ranked.json --out-dir out
  node scripts/insight.mjs qa --input ranked.json --out-dir out --output qa.json
  node scripts/insight.mjs daily --input candidates.json --history history.jsonl --out-dir out

Run a command with --help for its own options.`);
  process.exit(command ? 0 : 2);
}
const target = commands[command];
if (!target) {
  console.error(`Unknown insight command: ${command}`);
  process.exit(2);
}
const result = spawnSync(process.execPath, [path.join(here, target), ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});
process.exit(result.status ?? 1);

import process from "node:process";

import { appendHistory, readHistory, textSha256 } from "./lib.mjs";

function parseArgs(argv) {
  const command = argv[0];
  const options = { history: null, url: null, text: null, json: null, record: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--history":
        options.history = next();
        break;
      case "--url":
        options.url = next();
        break;
      case "--text":
        options.text = next();
        break;
      case "--json":
        options.json = next();
        break;
      case "--record":
        options.record = next();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!options.history) throw new Error("--history is required");
  if (command === "check") {
    const history = await readHistory(options.history);
    const urlDup = options.url ? history.urls.has(options.url) : false;
    const hashDup = options.text ? history.hashes.has(textSha256(options.text)) : false;
    console.log(JSON.stringify({ duplicate: urlDup || hashDup, duplicate_url: urlDup, duplicate_text: hashDup }));
    return;
  }
  if (command === "add") {
    const payload = JSON.parse(options.json || "{}");
    if (!payload || typeof payload !== "object") throw new Error("--json must be an object");
    await appendHistory(options.history, payload);
    console.log(JSON.stringify({ appended: true, history: options.history }));
    return;
  }
  if (command === "summary") {
    const history = await readHistory(options.history);
    const completions = history.records.filter((record) => record.type === "run_completion");
    console.log(JSON.stringify({
      records: history.records.length,
      unique_urls: history.urls.size,
      unique_texts: history.hashes.size,
      run_completions: completions.length,
      last_run: completions.at(-1) || null,
    }, null, 2));
    return;
  }
  console.error("Usage: node scripts/insight/history.mjs check|add|summary --history <file> [--url ...] [--text ...] [--json ...]");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`history: ${error.message}`);
  process.exitCode = 1;
});

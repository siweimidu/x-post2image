import process from "node:process";

import { rankCandidates, readHistory, readJson, writeJson } from "./lib.mjs";

function parseArgs(argv) {
  const options = {
    input: null,
    history: null,
    output: null,
    minimum: 75,
    limit: 5,
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
      case "--output":
        options.output = next();
        break;
      case "--minimum":
        options.minimum = Number(next());
        break;
      case "--limit":
        options.limit = Number(next());
        break;
      case "--help":
        console.log("Usage: node scripts/insight/rank.mjs --input candidates.json --history history.jsonl --output ranked.json [--minimum 75] [--limit 5]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.input || !options.output) throw new Error("--input and --output are required");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = await readJson(options.input);
  const candidates = Array.isArray(data) ? data : data.candidates || [];
  const history = await readHistory(options.history);
  const result = rankCandidates(candidates, {
    historyUrls: history.urls,
    historyHashes: history.hashes,
    minimum: options.minimum,
    limit: options.limit,
  });
  await writeJson(options.output, result);
  console.log(JSON.stringify({ output: options.output, selection_count: result.selection_count }));
}

main().catch((error) => {
  console.error(`rank: ${error.message}`);
  process.exitCode = 1;
});

import process from "node:process";

function parseArgs(argv) {
  const options = { topic: null, hours: 24, minFaves: null, lang: "en", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--topic":
        options.topic = next();
        break;
      case "--hours":
        options.hours = Number(next());
        break;
      case "--min-faves":
        options.minFaves = Number(next());
        break;
      case "--lang":
        options.lang = next();
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
        console.log(`Usage: node scripts/insight/search-queries.mjs --topic "habits" [--hours 24] [--min-faves 100] [--lang en] [--json]

Prints ready-to-open X search URLs. Open them with a browser/search tool, collect
the status URLs you want, then run:
  node scripts/insight/verify.mjs --input urls.json --output candidates.json --translate zh-CN`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.topic) throw new Error("--topic is required");
  return options;
}

function dateOnly(date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const until = new Date();
  const since = new Date(until.getTime() - options.hours * 60 * 60 * 1000);
  const terms = [
    `${options.topic} since:${dateOnly(since)} until:${dateOnly(until)}`,
    options.minFaves ? `min_faves:${options.minFaves}` : "",
    options.lang ? `lang:${options.lang}` : "",
  ].filter(Boolean);
  const q = encodeURIComponent(terms.join(" "));
  const urls = {
    latest: `https://x.com/search?q=${q}&src=typed_query&f=live`,
    top: `https://x.com/search?q=${q}&src=typed_query&f=top`,
    media: `https://x.com/search?q=${q}&src=typed_query&f=media`,
  };
  if (options.json) {
    console.log(JSON.stringify({ query: terms.join(" "), urls }, null, 2));
  } else {
    console.log(`query: ${terms.join(" ")}`);
    for (const [name, url] of Object.entries(urls)) console.log(`${name}: ${url}`);
    console.log("\nOpen a URL, collect status URLs, then run verify.mjs.");
  }
}

try {
  main();
} catch (error) {
  console.error(`search-queries: ${error.message}`);
  process.exitCode = 1;
}

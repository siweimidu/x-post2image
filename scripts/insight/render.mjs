import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { cacheImageFile } from "../lib/media.mjs";
import { defaultCacheDir } from "../lib/tweet.mjs";
import { readJson, writeJson } from "./lib.mjs";

function parseArgs(argv) {
  const options = {
    input: null,
    outDir: null,
    python: process.env.PYTHON || "python",
    renderMode: "auto",
    bilingualMaxHeight: 1200,
    cacheDir: defaultCacheDir(),
    bodySize: null,
    lineHeight: null,
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
      case "--out-dir":
        options.outDir = next();
        break;
      case "--python":
        options.python = next();
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
      case "--body-size":
        options.bodySize = Number(next());
        break;
      case "--line-height":
        options.lineHeight = Number(next());
        break;
      case "--help":
        console.log("Usage: node scripts/insight/render.mjs --input ranked.json --out-dir out [--render-mode auto|bilingual|translation-only] [--bilingual-max-height 1200]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.input || !options.outDir) throw new Error("--input and --out-dir are required");
  if (!["auto", "bilingual", "translation-only"].includes(options.renderMode)) {
    throw new Error("--render-mode must be auto, bilingual or translation-only");
  }
  return options;
}

function safeName(value) {
  return String(value || "card").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "card";
}

function runPython(python, args) {
  const result = spawnSync(python, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${python} failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
  }
  return `${result.stdout || ""}`.trim();
}

function parseRendererOutput(text) {
  const match = text.match(/\{[\s\S]*\}\s*$/);
  if (!match) throw new Error(`Could not parse renderer output: ${text.slice(-300)}`);
  return JSON.parse(match[0]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = await readJson(options.input);
  const candidates = Array.isArray(data) ? data : data.selected || data.candidates || [];
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("No candidates in input");
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  const rendered = [];
  const failures = [];
  for (const [index, candidate] of candidates.entries()) {
    const id = safeName(candidate.id || `card-${index + 1}`);
    try {
      if (!candidate.translation) throw new Error("missing translation; run verify with --translate or supply a translation");
      let avatar = String(candidate.avatar || "");
      if (!avatar && candidate.avatar_url) {
        avatar = (await cacheImageFile(candidate.avatar_url, {
          cacheDir: options.cacheDir,
          timeout: 20_000,
        })) || "";
      }
      if (!avatar) throw new Error("real author avatar is required (avatar or avatar_url)");
      if (!String(candidate.author || "").trim()) throw new Error("missing author");
      if (!String(candidate.post || "").trim()) throw new Error("missing post");

      const inputPath = path.join(outDir, `.${id}.render-input.json`);
      const outputPath = path.join(outDir, `${id}.png`);
      const payload = {
        author: candidate.author,
        handle: candidate.handle || "",
        post: candidate.post,
        translation: candidate.translation,
        avatar,
        avatar_url: candidate.avatar_url || "",
        date_display: candidate.date_display || "",
        views_display: candidate.views_display || "",
        render_mode: candidate.render_mode || options.renderMode,
        bilingual_max_height: candidate.bilingual_max_height || options.bilingualMaxHeight,
        ...(options.bodySize ? { body_size: options.bodySize } : {}),
        ...(options.lineHeight ? { line_height: options.lineHeight } : {}),
      };
      await writeFile(inputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      let stdout;
      try {
        stdout = runPython(options.python, [
          path.join(path.dirname(fileURLToPath(import.meta.url)), "render_card.py"),
          "--input",
          inputPath,
          "--output",
          outputPath,
        ]);
      } finally {
        await rm(inputPath, { force: true }).catch(() => {});
      }
      const meta = parseRendererOutput(stdout);
      const result = { ...meta, id: candidate.id || id, caption: candidate.caption || "", source: candidate };
      rendered.push(result);
      console.error(`✓ ${outputPath}`);
    } catch (error) {
      failures.push({ id: candidate.id || id, error: error.message });
      console.error(`✗ ${candidate.id || id}: ${error.message}`);
    }
  }

  const manifestPath = path.join(outDir, "render-manifest.json");
  await writeJson(manifestPath, { rendered, failures });
  console.log(JSON.stringify({ manifest: manifestPath, rendered: rendered.length, failures: failures.length }));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`render: ${error.message}`);
  process.exitCode = 1;
});

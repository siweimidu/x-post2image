#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let targetRoot = path.join(os.homedir(), ".agents", "skills");
let force = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--target") targetRoot = args[++index];
  else if (args[index] === "--force") force = true;
  else if (args[index] === "--help") {
    console.log("Usage: node scripts/install-skill.mjs [--target ~/.agents/skills] [--force]");
    process.exit(0);
  } else throw new Error(`Unknown argument: ${args[index]}`);
}
const destination = path.resolve(targetRoot, "x-post2image");
const skip = new Set(["dist", "node_modules", ".git", ".tmp-x-post2image", "__pycache__"]);
if (force) await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(root, destination, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(root, source);
    if (!relative) return true;
    const first = relative.split(path.sep)[0];
    return !skip.has(first) && !first.startsWith("tmp-") && !first.startsWith(".tmp-");
  },
});
console.log(`Installed ${destination}`);

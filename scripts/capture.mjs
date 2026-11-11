#!/usr/bin/env node
// capture.mjs — fast, parallel official-page screenshots.
//
// Why: capturing many "official first-hand" pages (blog / newsroom / model card)
// one-by-one with a browser is slow, and many domains are unreachable from the
// local network. This runs a bounded worker pool: try local headless Chrome
// first, and fall back to a server-side renderer (thum.io, then WordPress
// mshots) so blocked / hanging pages still produce an image.
//
// Usage:
//   node scripts/capture.mjs --out-dir out/pages https://a.com/x https://b.com/y
//   node scripts/capture.mjs --out-dir out/pages --manifest items.json   # [{"name":"01_x","url":"https://…"}]
//   node scripts/capture.mjs --manifest items.json --json --concurrency 8
//
// Options: --out-dir <dir> --manifest <file> --width <px=1440> --height <px=3000>
//          --concurrency <n=6> --timeout <ms=45000> --settle <ms=5000>
//          --no-fallback (skip thum.io/mshots) --chrome <path> --json

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { findChrome } from "./lib/screenshot.mjs";

const VERSION = "1.0.0";

function parseArgs(argv) {
  const o = {
    outDir: null, manifest: null, width: 1440, height: 3000,
    concurrency: 6, timeout: 45000, settle: 5000, fallback: true,
    chrome: null, json: false, urls: [], help: false,
  };
  const val = new Map([["--out-dir","outDir"],["--manifest","manifest"],["--width","width"],["--height","height"],["--concurrency","concurrency"],["--timeout","timeout"],["--settle","settle"],["--chrome","chrome"]]);
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    if (a === "--help" || a === "-h") { o.help = true; continue; }
    if (a === "--json") { o.json = true; continue; }
    if (a === "--no-fallback") { o.fallback = false; continue; }
    let inline = null;
    if (a.startsWith("--") && a.includes("=")) { const s = a.indexOf("="); inline = a.slice(s + 1); a = a.slice(0, s); }
    if (val.has(a)) { const k = val.get(a); o[k] = inline !== null ? inline : argv[++i]; continue; }
    if (a.startsWith("-")) throw new Error(`unknown option: ${a}`);
    o.urls.push(a);
  }
  for (const k of ["width","height","concurrency","timeout","settle"]) o[k] = Number(o[k]);
  o.concurrency = Math.max(1, Math.min(16, o.concurrency || 6));
  return o;
}

const HELP = `capture v${VERSION} — parallel official-page screenshots (local Chrome + server-side fallback)
  --out-dir <dir>      output directory (default: ./captures)
  --manifest <file>    JSON array [{"name","url"}] (or {"items":[...]})
  --width <px>         viewport width   (default 1440)
  --height <px>        viewport height  (default 3000)
  --concurrency <n>    parallel workers (default 6)
  --timeout <ms>       per-page timeout (default 45000)
  --settle <ms>        JS settle budget for local Chrome (default 5000)
  --no-fallback        disable thum.io / mshots server-side fallback
  --chrome <path>      explicit Chrome/Chromium binary
  --json               machine-readable result
Positions: one or more page URLs.`;

function slug(url) {
  try { const u = new URL(url); return (u.hostname + u.pathname).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80); }
  catch { return String(url).replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80); }
}

function isPng(buf) { return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47; }
function pngDims(buf) { if (!isPng(buf) || buf.length < 24) return null; return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }

async function captureLocal(chrome, url, file, { width, height, timeout, settle }) {
  const udd = path.join(os.tmpdir(), "capture_" + Math.random().toString(36).slice(2) + Date.now());
  const args = ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars",
    "--run-all-compositor-stages-before-draw", `--virtual-time-budget=${settle}`,
    `--window-size=${width},${height}`, `--user-data-dir=${udd}`, `--screenshot=${file}`, url];
  await new Promise((resolve) => {
    let done = false;
    const child = spawn(chrome, args, { stdio: "ignore" });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGKILL"); } catch {} resolve(); } }, timeout);
    child.on("exit", () => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
    child.on("error", () => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
  });
  try {
    const st = await stat(file);
    if (st.size > 15000) {
      const d = pngDims(await readFile(file));
      if (!d || d.width >= 500) return { engine: "local-chrome", bytes: st.size, width: d?.width, height: d?.height };
    }
  } catch {}
  return null;
}

async function fetchTo(file, sourceUrl, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(sourceUrl, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 capture.mjs" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPng(buf) || buf.length < 15000) return null;
    await writeFile(file, buf);
    const d = pngDims(buf);
    if (!d || d.width < 500) return null;
    return { engine: sourceUrl.includes("thum.io") ? "thum.io" : "mshots", bytes: buf.length, width: d?.width, height: d?.height };
  } catch { return null; } finally { clearTimeout(t); }
}

async function captureOne(item, opt, chrome) {
  const file = path.join(opt.outDir, `${item.name}.png`);
  if (existsSync(file)) { try { const st = await stat(file); if (st.size > 15000) return { ...item, out: file, engine: "existing", bytes: st.size }; } catch {} }
  let r = null;
  if (chrome) r = await captureLocal(chrome, item.url, file, opt);
  if (!r && opt.fallback) {
    r = await fetchTo(file, `https://image.thum.io/get/width/${opt.width}/crop/${opt.height}/noanimate/${item.url}`, opt.timeout);
    if (!r) r = await fetchTo(file, `https://s.wordpress.com/mshots/v1/${encodeURIComponent(item.url)}?w=${opt.width}&h=${opt.height}`, opt.timeout);
  }
  if (r) return { ...item, out: file, ...r };
  return { ...item, out: null, failed: true };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log(HELP); return 0; }
  opt.outDir = path.resolve(opt.outDir || "captures");
  await mkdir(opt.outDir, { recursive: true });

  let items = opt.urls.map((url) => ({ name: slug(url), url }));
  if (opt.manifest) {
    const raw = JSON.parse(await readFile(opt.manifest, "utf8"));
    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    items = arr.map((it) => (typeof it === "string" ? { name: slug(it), url: it } : { name: it.name || slug(it.url), url: it.url }));
  }
  if (!items.length) { console.error("no URLs. Pass URLs or --manifest."); return 2; }

  const chrome = findChrome(opt.chrome);
  const total = items.length;
  const concurrency = Math.min(opt.concurrency, total);
  if (!opt.json) console.error(`capture: ${total} page(s), concurrency ${concurrency}, chrome=${chrome ? "yes" : "no (fallback only)"}`);

  const results = new Array(total);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor; cursor += 1;
      if (i >= total) return;
      const it = items[i];
      if (!opt.json) console.error(`[start] ${it.name}  ${it.url}`);
      try { results[i] = await captureOne(it, opt, chrome); }
      catch (e) { results[i] = { ...it, out: null, failed: true, error: String(e && e.message ? e.message : e) }; }
      const r = results[i];
      if (!opt.json) console.error(r.out ? `[ok] ${r.name}  ${r.engine}  ${r.width || "?"}x${r.height || "?"}  ${Math.round((r.bytes || 0) / 1024)}KB` : `[fail] ${r.name}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const ok = results.filter((r) => r && r.out && !r.failed);
  const failed = results.filter((r) => !r || r.failed);
  const payload = { ok: failed.length === 0, count: ok.length, total, concurrency, results: ok, failures: failed };
  if (opt.json) console.log(JSON.stringify(payload, null, 2));
  else console.error(`\ndone: ${ok.length}/${total} ok, ${failed.length} failed`);
  return failed.length ? 1 : 0;
}

main().then((c) => { process.exitCode = c ?? 0; }).catch((e) => { console.error(`capture: ${e.message || e}`); process.exitCode = 1; });

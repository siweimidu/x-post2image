import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "x-post2image.mjs");
const temp = mkdtempSync(path.join(os.tmpdir(), "x-post2image-e2e-"));

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
  });
}

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✖ ${name}: ${error.message}`);
  }
}

try {
  const output = path.join(temp, "jack.png");
  const result = run(["20", "--out", output, "--json"]);
  const payload = JSON.parse(result.stdout || "{}");
  check("renders a real post from the public API", () => {
    if (!payload.ok) throw new Error(JSON.stringify(payload.failures || payload));
    if (!existsSync(output)) throw new Error("PNG was not written");
    if (!payload.width || !payload.height) throw new Error("PNG dimensions missing");
    if (statSync(output).size < 10_000) throw new Error("PNG looks too small");
  });

  const rich = path.join(temp, "rich.png");
  const richResult = run(["--data", path.join(root, "test", "fixtures", "rich.json"), "--out", rich, "--json"]);
  const richPayload = JSON.parse(richResult.stdout || "{}");
  check("renders the rich fixture (media + quote + poll)", () => {
    if (!richPayload.ok) throw new Error(JSON.stringify(richPayload.failures || richPayload));
    if (!richPayload.height || richPayload.height < 800) throw new Error("Rich card is unexpectedly short");
  });

  const html = path.join(temp, "card.html");
  const htmlResult = run(["20", "--html-only", "--html", html, "--json"]);
  const htmlPayload = JSON.parse(htmlResult.stdout || "{}");
  check("writes HTML-only output", () => {
    if (!htmlPayload.ok) throw new Error(JSON.stringify(htmlPayload.failures || htmlPayload));
    if (!existsSync(html)) throw new Error("HTML was not written");
  });

  const zh = path.join(temp, "jack-zh.png");
  const zhResult = run(["20", "--out", zh, "--translate", "zh-CN", "--json"]);
  const zhPayload = JSON.parse(zhResult.stdout || "{}");
  check("translates a real post into Chinese", () => {
    if (!zhPayload.ok) throw new Error(JSON.stringify(zhPayload.failures || zhPayload));
    if (!zhPayload.translation?.changed) throw new Error("Translation metadata missing");
    if (!/[\u4e00-\u9fff]/.test(zhPayload.text || "")) throw new Error("Translated text does not contain Chinese");
  });

  const offline = path.join(temp, "jack-zh-offline.png");
  const offlineResult = run(["20", "--out", offline, "--translate", "zh-CN", "--offline", "--json"]);
  const offlinePayload = JSON.parse(offlineResult.stdout || "{}");
  check("re-renders the translated card offline from cache", () => {
    if (!offlinePayload.ok) throw new Error(JSON.stringify(offlinePayload.failures || offlinePayload));
    if (!existsSync(offline)) throw new Error("Offline PNG was not written");
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} e2e check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nE2E checks passed.");
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WINDOWS_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "microsoft-edge-stable",
];

export function findChrome(explicitPath = null) {
  if (explicitPath) {
    return existsSync(explicitPath) ? explicitPath : null;
  }
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.platform === "win32") {
    for (const candidate of WINDOWS_CANDIDATES) {
      if (candidate && existsSync(candidate)) return candidate;
    }
  } else if (process.platform === "darwin") {
    for (const candidate of MAC_CANDIDATES) {
      if (existsSync(candidate)) return candidate;
    }
  } else {
    for (const name of LINUX_NAMES) {
      const result = spawnSync("which", [name], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    }
  }
  return null;
}

export async function findPlaywright() {
  const modules = [];
  if (process.env.X_POST2IMAGE_PLAYWRIGHT) modules.push(process.env.X_POST2IMAGE_PLAYWRIGHT);
  modules.push("playwright", "playwright-core");
  for (const name of modules) {
    try {
      const mod = await import(name);
      if (mod?.chromium) return { name, chromium: mod.chromium };
    } catch {
      // try next
    }
  }
  return null;
}

export function chromeVersion(chromePath) {
  if (!chromePath) return null;
  const result = spawnSync(chromePath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  // Chrome on Windows often prints updater noise instead of a version string.
  return text.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1] || null;
}

export async function isFontReachable(timeout = 2500) {
  try {
    const response = await fetch("https://abs.twimg.com/fonts/v2/chirp-regular-web.woff2", {
      method: "HEAD",
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function pngSize(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 24) return null;
    if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

async function screenshotWithPlaywright({
  htmlPath,
  outPath,
  width,
  scale,
  transparent,
  chromePath,
  timeout,
  playwright,
}) {
  const launchOptions = { headless: true };
  if (chromePath) launchOptions.executablePath = chromePath;
  const browser = await playwright.chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout });
    await page.waitForSelector('body[data-ready="1"]', { timeout });
    const dims = await page.evaluate(() => ({
      width: Number(document.body.dataset.width || 0),
      height: Number(document.body.dataset.height || 0),
    }));
    await page.locator("#card").screenshot({
      path: outPath,
      omitBackground: transparent,
      animations: "disabled",
      scale: "device",
    });
    await context.close();
    return { engine: `playwright (${playwright.name})`, ...dims };
  } finally {
    await browser.close();
  }
}

function runChrome(args, { timeout }) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return result;
}

async function screenshotWithChromeCli({
  htmlPath,
  outPath,
  width,
  scale,
  transparent,
  chromePath,
  timeout,
  profileDir,
}) {
  const fileUrl = pathToFileURL(htmlPath).href;
  const baseArgs = [
    chromePath,
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    `--user-data-dir=${profileDir}`,
    "--virtual-time-budget=8000",
    `--force-device-scale-factor=${scale}`,
  ];
  if (transparent) baseArgs.push("--default-background-color=00000000");

  const withBudget = (budget) =>
    baseArgs.map((arg) =>
      arg.startsWith("--virtual-time-budget=") ? `--virtual-time-budget=${budget}` : arg,
    );

  const measure = (budget) => {
    const dump = runChrome(
      [...withBudget(budget), "--dump-dom", "--window-size=" + width + ",2000", fileUrl],
      { timeout },
    );
    const dom = `${dump.stdout || ""}${dump.stderr || ""}`;
    return dom.match(/X2I_READY\s+(\d+)x(\d+)/);
  };

  let match = measure(8000);
  if (!match) {
    // One retry with a longer virtual-time budget: large media cards can need
    // more time to decode before the inline measurement script runs.
    match = measure(15_000);
  }
  if (!match) {
    throw new Error(
      `Chrome could not measure the card (tried 8s and 15s budgets). Check the HTML with --html and --keep.`,
    );
  }
  const measuredWidth = Number(match[1]);
  const measuredHeight = Number(match[2]);
  const shotHeight = Math.ceil(measuredHeight) + 2;

  const shot = runChrome(
    [
      ...baseArgs,
      "--screenshot=" + outPath,
      `--window-size=${measuredWidth},${shotHeight}`,
      fileUrl,
    ],
    { timeout },
  );
  if (!existsSync(outPath)) {
    throw new Error(
      `Chrome did not write the screenshot. ${(shot.stderr || shot.stdout || "").slice(-400)}`,
    );
  }
  return {
    engine: "chrome-headless",
    width: measuredWidth,
    height: measuredHeight,
    outputHeight: shotHeight,
  };
}

export async function renderScreenshot({
  html,
  htmlPath,
  outPath,
  width,
  scale = 2,
  transparent = false,
  chromePath = null,
  engine = "auto",
  timeout = 60_000,
  keepTemp = false,
}) {
  const resolvedChrome = findChrome(chromePath);
  const playwright = engine === "chrome" ? null : await findPlaywright();
  if (engine === "playwright" && !playwright) {
    throw new Error("Playwright was requested but neither playwright nor playwright-core can be imported.");
  }
  if (!playwright && !resolvedChrome) {
    throw new Error(
      "No browser found. Install Google Chrome/Chromium, or run `npm install playwright` and `npx playwright install chromium`.",
    );
  }

  let tempDir = null;
  let workHtml = htmlPath;
  if (!workHtml) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "x-post2image-"));
    workHtml = path.join(tempDir, "card.html");
  }
  await writeFile(workHtml, html, "utf8");

  const profileDir = tempDir || (await mkdtemp(path.join(os.tmpdir(), "x-post2image-profile-")));
  try {
    let result;
    if (playwright) {
      result = await screenshotWithPlaywright({
        htmlPath: workHtml,
        outPath,
        width,
        scale,
        transparent,
        chromePath: resolvedChrome,
        timeout,
        playwright,
      });
    } else {
      result = await screenshotWithChromeCli({
        htmlPath: workHtml,
        outPath,
        width,
        scale,
        transparent,
        chromePath: resolvedChrome,
        timeout,
        profileDir,
      });
    }
    const size = pngSize(outPath);
    const fileStat = await stat(outPath);
    return {
      ...result,
      outPath,
      bytes: fileStat.size,
      pixelWidth: size?.width ?? null,
      pixelHeight: size?.height ?? null,
      htmlPath: workHtml,
    };
  } finally {
    if (!keepTemp) {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      if (!tempDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function doctorReport({ chromePath = null, cacheDir = null } = {}) {
  const chrome = findChrome(chromePath);
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    chrome: chrome || null,
    chromeVersion: chromeVersion(chrome),
    cacheDir,
  };
}

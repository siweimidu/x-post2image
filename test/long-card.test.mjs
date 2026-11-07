import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildArticleCardData, buildLongCardData } from "../scripts/long.mjs";
import { pngSize } from "../scripts/lib/screenshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON || "python";

test("buildLongCardData keeps title/subtitle and distributes body", () => {
  const tweet = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "long-tweet.json"), "utf8"));
  const data = buildLongCardData(tweet, { text: tweet.text, avatar: "test/fixtures/test-avatar.png", translated: true });
  assert.ok(data.title.length > 0);
  assert.ok(data.left_blocks.length > 0);
  assert.ok(data.right_blocks.some((block) => block.type === "table"));
  assert.equal(data.metrics.likes, 320000);
});

test("Pillow long-card renderer outputs 1080x720 spread", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-long-render-"));
  try {
    const output = path.join(dir, "long.png");
    const result = spawnSync(python, [
      path.join(root, "scripts", "insight", "render_long_card.py"),
      "--input",
      path.join(root, "test", "fixtures", "long-card-demo.json"),
      "--output",
      output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const size = pngSize(output);
    assert.deepEqual(size, { width: 1080, height: 720 });
    const meta = JSON.parse(result.stdout);
    assert.equal(meta.layout, "two-page-spread");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Pillow article renderer outputs a tall X card with code block", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-article-render-"));
  try {
    const tweet = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "long-code-tweet.json"), "utf8"));
    const data = buildArticleCardData(tweet, {
      text: tweet.text,
      avatar: path.join(root, "test", "fixtures", "test-avatar.png"),
      translated: true,
    });
    const input = path.join(dir, "article.json");
    const output = path.join(dir, "article.png");
    await (await import("node:fs/promises")).writeFile(input, JSON.stringify(data), "utf8");
    const result = spawnSync(python, [
      path.join(root, "scripts", "insight", "render_article_card.py"),
      "--input",
      input,
      "--output",
      output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const meta = JSON.parse(result.stdout);
    assert.equal(meta.layout, "x-article-tall");
    const size = pngSize(output);
    assert.equal(size.width, 1080);
    assert.ok(size.height > 600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

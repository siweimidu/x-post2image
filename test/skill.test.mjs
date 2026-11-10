import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("SKILL.md has valid Agent Skills frontmatter", async () => {
  const text = await readFile(path.join(root, "SKILL.md"), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "frontmatter block is missing");
  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert.equal(name, "x-post2image");
  assert.ok(/^[a-z0-9-]+$/.test(name), "name must be lowercase letters, numbers and hyphens");
  assert.ok(description?.startsWith("Use when"), "description should start with 'Use when'");
  assert.ok((description || "").length <= 1024, "description exceeds 1024 characters");
});

test("documented files exist", async () => {
  const required = [
    "scripts/x-post2image.mjs",
    "scripts/long.mjs",
    "scripts/insight/render_long_card.py",
    "scripts/insight/render_article_card.py",
    "scripts/insight/render_two_page.py",
    "scripts/lib/tweet.mjs",
    "scripts/lib/render.mjs",
    "scripts/lib/screenshot.mjs",
    "scripts/lib/format.mjs",
    "scripts/insight.mjs",
    "scripts/insight/render_card.py",
    "scripts/insight/score_candidates.py",
    "scripts/insight/daily.mjs",
    "scripts/insight/delivery/wechat_ilink_delivery.mjs",
    "agents/openai.yaml",
    "requirements.txt",
    "THIRD_PARTY_NOTICES.md",
    "references/upstream-notes.md",
    "references/data-sources.md",
    "references/troubleshooting.md",
    "LICENSE",
    "NOTICE.md",
  ];
  for (const relative of required) {
    const info = await stat(path.join(root, relative));
    assert.ok(info.isFile(), `${relative} is missing`);
  }
});

test("examples referenced by README exist", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const links = [...readme.matchAll(/\]\((examples\/[^)]+)\)/g)].map((match) => match[1]);
  assert.ok(links.length >= 3);
  for (const relative of links) {
    const info = await stat(path.join(root, relative));
    assert.ok(info.isFile(), `${relative} is missing`);
  }
});

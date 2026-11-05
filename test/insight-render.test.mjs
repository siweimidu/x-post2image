import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pngSize } from "../scripts/lib/screenshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON || "python";

function makeAvatar(file) {
  const script = `from PIL import Image, ImageDraw\nimg=Image.new("RGB",(200,200),(30,120,200))\nImageDraw.Draw(img).ellipse((20,20,180,180),fill=(240,200,80))\nimg.save(${JSON.stringify(file)})\n`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("Pillow insight renderer produces bilingual and translation-only cards", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-insight-render-"));
  try {
    const avatar = path.join(dir, "avatar.png");
    makeAvatar(avatar);
    const input = path.join(dir, "input.json");
    await writeFile(input, JSON.stringify({
      author: "James Clear",
      handle: "@JamesClear",
      post: "The wedding is an event, love is a practice.\nThe death of a dream is an event, rebirth is a practice.",
      translation: "婚礼是一次仪式，爱是一种实践。\n梦想的死亡是一次事件，重生是一种实践。",
      avatar,
      date_display: "Apr 17, 2026",
      views_display: "69.9K Views",
      render_mode: "auto",
      bilingual_max_height: 1200,
    }), "utf8");
    const out1 = path.join(dir, "bilingual.png");
    const r1 = spawnSync(python, [path.join(root, "scripts/insight/render_card.py"), "--input", input, "--output", out1], { encoding: "utf8" });
    assert.equal(r1.status, 0, r1.stderr);
    const meta1 = JSON.parse(r1.stdout);
    assert.equal(meta1.content_mode, "bilingual");
    assert.equal(meta1.source_text_visible, true);
    assert.ok(existsSync(out1));
    assert.equal(pngSize(out1).width, 1200);

    const out2 = path.join(dir, "translation-only.png");
    // Use a second input with a tiny threshold to force translation-only mode.
    const input2 = path.join(dir, "input2.json");
    const data = JSON.parse(await readFile(input, "utf8"));
    data.bilingual_max_height = 200;
    await writeFile(input2, JSON.stringify(data), "utf8");
    const r3 = spawnSync(python, [path.join(root, "scripts/insight/render_card.py"), "--input", input2, "--output", out2], { encoding: "utf8" });
    assert.equal(r3.status, 0, r3.stderr);
    const meta2 = JSON.parse(r3.stdout);
    assert.equal(meta2.content_mode, "translation-only");
    assert.equal(meta2.source_text_visible, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

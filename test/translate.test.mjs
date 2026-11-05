import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chunkText, translateText, translateTweet } from "../scripts/lib/translate.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("chunkText keeps short text intact and splits long text", () => {
  assert.deepEqual(chunkText("hello", 450, 450), ["hello"]);
  const long = "A".repeat(1000);
  const chunks = chunkText(long, 450, 450);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(""), long);
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk, "utf8") <= 450);
});

test("translateText restores URLs, mentions and hashtags", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const q = new URL(url).searchParams.get("q");
    return jsonResponse({
      responseData: { translatedText: `翻译 ${q}` },
      responseStatus: 200,
    });
  };
  const result = await translateText("Hello @jack see https://example.com #tag", {
    from: "en",
    to: "zh-CN",
    provider: "mymemory",
    fetchImpl,
  });
  assert.equal(result.provider, "mymemory");
  assert.match(result.text, /@jack/);
  assert.match(result.text, /https:\/\/example\.com/);
  assert.match(result.text, /#tag/);
  assert.equal(calls.length, 1);
});

test("translateText falls back from MyMemory to Google", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("mymemory")) {
      return jsonResponse({ responseData: { translatedText: "MYMEMORY WARNING: quota" } });
    }
    return jsonResponse([[["你好", "hello", null, null]]]);
  };
  const result = await translateText("hello", {
    from: "en",
    to: "zh-CN",
    provider: "auto",
    fetchImpl,
  });
  assert.equal(result.provider, "google");
  assert.equal(result.text, "你好");
});

test("translateTweet translates body, quote and poll labels", async () => {
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams.get("q");
    return jsonResponse({ responseData: { translatedText: `译:${q}` } });
  };
  const tweet = {
    id: "1",
    text: "Hello world",
    lang: "en",
    quote: { text: "Quoted text", lang: "en", author: { name: "Q" }, media: [] },
    poll: { options: [{ label: "Yes", votes: 10, percentage: 100 }], totalVotes: 10 },
  };
  const translated = await translateTweet(tweet, {
    target: "zh-CN",
    provider: "mymemory",
    fetchImpl,
  });
  assert.match(translated.text, /^译:Hello world$/);
  assert.match(translated.quote.text, /^译:Quoted text$/);
  assert.match(translated.poll.options[0].label, /^译:Yes$/);
  assert.equal(translated.translation.provider, "mymemory");
  assert.equal(translated.translation.originalText, null);
});

test("translateText caches results for offline reuse", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-translate-"));
  try {
    const first = await translateText("hello", {
      from: "en",
      to: "zh-CN",
      provider: "mymemory",
      cacheDir: dir,
      fetchImpl: async () => jsonResponse({ responseData: { translatedText: "你好" } }),
    });
    assert.equal(first.text, "你好");
    const second = await translateText("hello", {
      from: "en",
      to: "zh-CN",
      provider: "mymemory",
      cacheDir: dir,
      offline: true,
      fetchImpl: async () => {
        throw new Error("network should not be touched");
      },
    });
    assert.equal(second.text, "你好");
    assert.equal(second.cached, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

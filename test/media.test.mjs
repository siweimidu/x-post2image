import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { embedMedia, proxyImageUrl } from "../scripts/lib/media.mjs";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function imageResponse() {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.length) },
  });
}

const tweet = {
  id: "1",
  text: "hello",
  author: { name: "A", screenName: "a", avatarUrl: "https://pbs.twimg.com/a_normal.jpg" },
  media: [{ type: "photo", url: "https://pbs.twimg.com/media/a.jpg?name=orig", width: 10, height: 10 }],
  quote: null,
};

test("embedMedia prefers the wsrv proxy for pbs hosts and returns data URLs", async () => {
  const calls = [];
  const result = await embedMedia(tweet, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return imageResponse();
    },
  });
  assert.ok(calls[0].startsWith("https://wsrv.nl/?url="));
  assert.match(result.author.avatarUrl, /^data:image\/png;base64,/);
  assert.match(result.media[0].url, /^data:image\/png;base64,/);
});

test("embedMedia caches media and serves it offline", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-media-"));
  try {
    const first = await embedMedia(tweet, {
      cacheDir: dir,
      fetchImpl: async () => imageResponse(),
    });
    assert.match(first.media[0].url, /^data:image\/png/);
    const second = await embedMedia(tweet, {
      cacheDir: dir,
      offline: true,
      fetchImpl: async () => {
        throw new Error("network should not be touched");
      },
    });
    assert.match(second.media[0].url, /^data:image\/png/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("embedMedia drops missing media in offline mode", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "x2i-media-empty-"));
  try {
    const result = await embedMedia(tweet, { cacheDir: dir, offline: true });
    assert.equal(result.media[0].url, null);
    assert.equal(result.author.avatarUrl, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proxyImageUrl encodes the source URL", () => {
  const url = proxyImageUrl("https://pbs.twimg.com/media/a.jpg?name=orig");
  assert.match(url, /^https:\/\/wsrv\.nl\/\?url=/);
  assert.match(url, /pbs\.twimg\.com/);
});

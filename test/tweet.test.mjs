import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeFx,
  normalizeSyndication,
  normalizeAny,
  resolveTweetInput,
} from "../scripts/lib/tweet.mjs";

test("resolveTweetInput accepts the common X URL shapes", async () => {
  assert.deepEqual(await resolveTweetInput("20"), {
    id: "20",
    screenName: null,
    url: "https://x.com/i/status/20",
  });
  assert.equal((await resolveTweetInput("https://x.com/jack/status/20")).id, "20");
  assert.equal((await resolveTweetInput("https://x.com/jack/status/20")).screenName, "jack");
  assert.equal((await resolveTweetInput("https://x.com/i/status/20")).screenName, null);
  assert.equal((await resolveTweetInput("https://twitter.com/jack/status/20?s=20")).id, "20");
  assert.equal((await resolveTweetInput("x.com/jack/status/20")).id, "20");
  await assert.rejects(() => resolveTweetInput("https://example.com/status/20"), /Unsupported host/);
  await assert.rejects(() => resolveTweetInput("https://x.com/jack"), /does not contain/);
});

test("normalizeFx maps author, metrics and media", () => {
  const tweet = normalizeFx({
    id: "1",
    text: "hello",
    lang: "en",
    created_timestamp: 1393815973,
    author: {
      name: "Jack",
      screen_name: "jack",
      avatar_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
      verification: { verified: true },
    },
    replies: 12,
    retweets: 34,
    likes: 56,
    views: 78,
    media: {
      all: [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/a.jpg",
          width: 1200,
          height: 800,
        },
      ],
    },
  });
  assert.equal(tweet.author.name, "Jack");
  assert.equal(tweet.author.verified, true);
  assert.equal(tweet.author.avatarUrl, "https://pbs.twimg.com/profile_images/1/a_400x400.jpg");
  assert.deepEqual(tweet.metrics, {
    replies: 12,
    reposts: 34,
    likes: 56,
    views: 78,
    quotes: null,
    bookmarks: null,
  });
  assert.equal(tweet.media.length, 1);
  assert.equal(tweet.media[0].width, 1200);
});

test("normalizeSyndication strips the media tail and expands t.co links", () => {
  const tweet = normalizeSyndication({
    __typename: "Tweet",
    id_str: "2",
    text: "look https://t.co/abc https://t.co/media",
    display_text_range: [0, 30],
    entities: { urls: [{ url: "https://t.co/abc", display_url: "example.com/page" }] },
    user: { name: "A", screen_name: "a", profile_image_url_https: "https://pbs.twimg.com/a_normal.jpg" },
    conversation_count: 3,
    favorite_count: 4,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  assert.match(tweet.text, /example\.com\/page/);
  assert.doesNotMatch(tweet.text, /t\.co\/media/);
  assert.equal(tweet.metrics.replies, 3);
  assert.equal(tweet.metrics.likes, 4);
});

test("normalizeAny accepts all three supported JSON shapes", () => {
  const normalized = { __normalized: true, id: "9", text: "x" };
  assert.equal(normalizeAny(normalized).id, "9");

  const fx = normalizeAny({ tweet: { id: "10", text: "fx" } });
  assert.equal(fx.id, "10");

  const syn = normalizeAny({ __typename: "Tweet", id_str: "11", text: "syn" });
  assert.equal(syn.id, "11");

  assert.throws(() => normalizeAny({ nope: true }), /Unrecognised tweet JSON/);
});

test("normalizeFx understands fxTwitter polls (choices/ count)", () => {
  const tweet = normalizeFx({
    id: "12",
    text: "poll",
    poll: {
      choices: [
        { label: "Yes", count: 60, percentage: 60 },
        { label: "No", count: 40, percentage: 40 },
      ],
      total_votes: 100,
      ends_at: "2026-11-05T00:00:00.000Z",
    },
  });
  assert.equal(tweet.poll.options.length, 2);
  assert.equal(tweet.poll.options[0].votes, 60);
  assert.equal(tweet.poll.totalVotes, 100);
});

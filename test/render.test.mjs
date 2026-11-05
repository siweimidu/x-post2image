import test from "node:test";
import assert from "node:assert/strict";

import { applyMetricOverrides, renderCardHtml } from "../scripts/lib/render.mjs";

const baseTweet = {
  id: "1",
  url: "https://x.com/tester/status/1",
  text: "Hello <script>alert(1)</script> #tag @friend",
  lang: "en",
  createdAt: "2026-01-01T12:00:00.000Z",
  author: { name: "Tester", screenName: "tester", avatarUrl: null, verified: true },
  metrics: { replies: 1200, reposts: 3400, likes: 56000, views: 789000, quotes: null, bookmarks: null },
  media: [],
  quote: null,
  poll: null,
};

test("renderCardHtml escapes text and adds links", () => {
  const html = renderCardHtml(baseTweet, { theme: "dark" });
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /href="https:\/\/x.com\/search\?q=tag"/);
  assert.match(html, /@friend/);
  assert.match(html, /X2I_READY/);
});

test("renderCardHtml applies theme, width and frames", () => {
  const dark = renderCardHtml(baseTweet, { theme: "dark", width: 500 });
  assert.match(dark, /width:500px/);
  assert.match(dark, /#000000/);
  const light = renderCardHtml(baseTweet, { theme: "light", frame: "card" });
  assert.match(light, /#ffffff/);
  assert.match(light, /border-radius:16px/);
});

test("renderCardHtml renders media, quote and poll", () => {
  const tweet = {
    ...baseTweet,
    media: [
      { type: "photo", url: "https://pbs.twimg.com/media/a.jpg", width: 1200, height: 800 },
      { type: "photo", url: "https://pbs.twimg.com/media/b.jpg", width: 1200, height: 800 },
    ],
    quote: {
      id: "2",
      text: "quoted text",
      lang: "en",
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { name: "Quoted", screenName: "quoted", avatarUrl: null, verified: false },
      media: [],
    },
    poll: {
      options: [
        { label: "Yes", votes: 60, percentage: 60 },
        { label: "No", votes: 40, percentage: 40 },
      ],
      totalVotes: 100,
    },
  };
  const html = renderCardHtml(tweet, { theme: "dark" });
  assert.match(html, /media grid grid-two/);
  assert.match(html, /quote-card/);
  assert.match(html, /poll-option/);
  assert.match(html, /2 photos|pbs\.twimg\.com\/media\/a\.jpg/);
});

test("metrics can be overridden and hidden", () => {
  const overridden = applyMetricOverrides(baseTweet, { likes: 99999, views: 1234567 });
  assert.equal(overridden.metrics.likes, 99999);
  assert.equal(overridden.metrics.views, 1234567);
  assert.equal(baseTweet.metrics.likes, 56000);

  const html = renderCardHtml(overridden, { theme: "dark" });
  assert.match(html, /100K/);
  assert.match(html, /1.2M/);

  const hidden = renderCardHtml(overridden, { theme: "dark", showMetrics: false });
  assert.doesNotMatch(hidden, /class="actions"/);
  assert.doesNotMatch(hidden, /class="tweet-meta"/);
});

test("Chinese locale uses 万/亿 formatting", () => {
  const tweet = { ...baseTweet, metrics: { ...baseTweet.metrics, replies: 12800, reposts: 34500, likes: 56000, views: 789000 }, lang: "zh", text: "你好" };
  const html = renderCardHtml(tweet, { theme: "dark" });
  assert.match(html, /1.3万/);
  assert.match(html, /3.5万/);
  assert.match(html, /5.6万/);
  assert.match(html, /79万/);
});

test("translated cards show a source note and optional original text", () => {
  const tweet = {
    ...baseTweet,
    text: "你好世界",
    translation: {
      from: "en",
      to: "zh-CN",
      provider: "mymemory",
      changed: true,
      sourceName: "英语",
      targetName: "简体中文",
      originalText: "Hello world",
    },
  };
  const html = renderCardHtml(tweet, { theme: "dark" });
  assert.match(html, /翻译自英语/);
  assert.match(html, /class="original-block"/);
  assert.match(html, /Hello world/);
});

test("embedded data URLs are accepted for avatars", () => {
  const tweet = {
    ...baseTweet,
    author: { ...baseTweet.author, avatarUrl: "data:image/png;base64,iVBORw0KGgo=" },
  };
  const html = renderCardHtml(tweet, { theme: "dark" });
  assert.match(html, /<img class="avatar" src="data:image\/png;base64,/);
});



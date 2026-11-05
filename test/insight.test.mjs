import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  captionIssues,
  dateInTimeZone,
  rankCandidates,
  textSha256,
} from "../scripts/insight/lib.mjs";

const good = {
  id: "a",
  url: "https://x.com/a/status/1",
  author: "A",
  handle: "@a",
  avatar_url: "https://pbs.twimg.com/a.jpg",
  post: "Hello world",
  translation: "你好世界",
  caption: "一句中文。\n\n#标签一 #标签二 #标签三",
  score_detail: {
    insight_gain: 27,
    clarity: 18,
    chinese_social_fit: 18,
    source_credibility: 13,
    freshness: 9,
    visual_readability: 5,
  },
};

test("rankCandidates selects high scores and rejects duplicates", () => {
  const duplicate = { ...good, id: "b", score_detail: { ...good.score_detail, insight_gain: 30 } };
  const low = {
    ...good,
    id: "c",
    url: "https://x.com/c/status/3",
    post: "Low",
    score_detail: {
      insight_gain: 10,
      clarity: 10,
      chinese_social_fit: 10,
      source_credibility: 10,
      freshness: 5,
      visual_readability: 5,
    },
  };
  const result = rankCandidates([good, duplicate, low], { minimum: 75, limit: 5 });
  assert.equal(result.selection_count, 1);
  assert.equal(result.selected[0].id, "a");
  assert.ok(result.rejected.some((item) => item.id === "b" && item.reasons.includes("duplicate_url")));
  assert.ok(result.rejected.some((item) => item.id === "c" && item.reasons.includes("score_below_75")));
});

test("rankCandidates uses history URL and text hash", () => {
  const result = rankCandidates([good], {
    historyUrls: new Set([good.url]),
    historyHashes: new Set([textSha256(good.post)]),
  });
  assert.equal(result.selection_count, 0);
  assert.ok(result.rejected[0].reasons.includes("duplicate_url"));
  assert.ok(result.rejected[0].reasons.includes("duplicate_text"));
});

test("captionIssues validates sentence and hashtag counts", () => {
  assert.deepEqual(captionIssues(good.caption), []);
  assert.deepEqual(captionIssues("只有一句没有标签"), ["caption_hashtags_must_be_3_to_5"]);
  assert.ok(captionIssues("一句。两句。三句。\n\n#a #b #c").includes("caption_sentences_must_be_1_or_2"));
});

test("dateInTimeZone handles Shanghai dates", () => {
  assert.equal(dateInTimeZone(new Date("2026-11-04T16:30:00Z"), "Asia/Shanghai"), "2026-11-05");
});

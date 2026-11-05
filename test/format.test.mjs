import test from "node:test";
import assert from "node:assert/strict";

import { formatCompact, formatDate, parseCount } from "../scripts/lib/format.mjs";

test("parseCount handles plain, grouped and compact numbers", () => {
  assert.equal(parseCount("1234"), 1234);
  assert.equal(parseCount("1,234,567"), 1234567);
  assert.equal(parseCount("1.2K"), 1200);
  assert.equal(parseCount("3.4M"), 3400000);
  assert.equal(parseCount("2B"), 2000000000);
  assert.equal(parseCount("3万"), 30000);
  assert.equal(parseCount("2.5亿"), 250000000);
  assert.equal(parseCount("1.5w"), 15000);
  assert.equal(parseCount(""), 0);
  assert.equal(parseCount("no numbers"), null);
});

test("formatCompact matches X style for English", () => {
  assert.equal(formatCompact(0), "");
  assert.equal(formatCompact(999), "999");
  assert.equal(formatCompact(1200), "1.2K");
  assert.equal(formatCompact(15000), "15K");
  assert.equal(formatCompact(1892515), "1.9M");
  assert.equal(formatCompact(2508409), "2.5M");
  assert.equal(formatCompact(2000000000), "2B");
});

test("formatCompact matches X style for Chinese", () => {
  assert.equal(formatCompact(999, "zh-CN"), "999");
  assert.equal(formatCompact(12000, "zh-CN"), "1.2万");
  assert.equal(formatCompact(128000, "zh-CN"), "13万");
  assert.equal(formatCompact(2400000, "zh-CN"), "240万");
  assert.equal(formatCompact(250000000, "zh-CN"), "2.5亿");
});

test("formatDate renders X-like timestamp", () => {
  const date = new Date("2006-03-21T20:50:14.000Z");
  assert.equal(formatDate(date, "en", "UTC"), "8:50 PM · Mar 21, 2006");
  assert.match(formatDate(date, "zh-CN", "Asia/Shanghai"), /2006年3月22日/);
});

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCORE_LIMITS = {
  insight_gain: 30,
  clarity: 20,
  chinese_social_fit: 20,
  source_credibility: 15,
  freshness: 10,
  visual_readability: 5,
};

export const DISALLOWED_FLAGS = new Set([
  "politics",
  "stock_tip",
  "medical_advice",
  "course_sales",
  "unattributed_repost",
  "empty_motivation",
  "unverified",
]);

export function normalizeText(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function textSha256(text) {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}

export async function readJson(file) {
  return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readHistory(file) {
  const urls = new Set();
  const hashes = new Set();
  const records = [];
  if (!file) return { urls, hashes, records };
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { urls, hashes, records };
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      records.push(record);
      const url = record.url || record.source_url;
      const digest = record.text_sha256 || record.source_text_sha256;
      if (url) urls.add(String(url));
      if (digest) hashes.add(String(digest));
    } catch {
      // ignore malformed history lines
    }
  }
  return { urls, hashes, records };
}

export async function appendHistory(file, record) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function validateScoreDetail(detail = {}) {
  const errors = [];
  let total = 0;
  for (const [key, maximum] of Object.entries(SCORE_LIMITS)) {
    const value = detail[key];
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      errors.push(`${key} must be an integer from 0 to ${maximum}`);
    } else {
      total += value;
    }
  }
  return { total, errors };
}

export function rankCandidates(candidates, options = {}) {
  const {
    historyUrls = new Set(),
    historyHashes = new Set(),
    minimum = 75,
    limit = 5,
  } = options;
  const accepted = [];
  const rejected = [];
  const seenUrls = new Set(historyUrls);
  const seenHashes = new Set(historyHashes);

  for (const candidate of candidates) {
    const identifier = String(candidate.id || "unknown");
    const url = String(candidate.url || "").trim();
    const post = String(candidate.post || "").trim();
    const reasons = [];
    if (!url) reasons.push("missing_url");
    if (!post) reasons.push("missing_post");
    if (!String(candidate.avatar || "").trim() && !String(candidate.avatar_url || "").trim()) {
      reasons.push("missing_avatar");
    }
    const digest = post ? textSha256(post) : "";
    if (url && seenUrls.has(url)) reasons.push("duplicate_url");
    if (digest && seenHashes.has(digest)) reasons.push("duplicate_text");
    const flags = new Set(candidate.flags || []);
    for (const flag of [...flags].filter((item) => DISALLOWED_FLAGS.has(item)).sort()) {
      reasons.push(flag);
    }
    const { total, errors } = validateScoreDetail(candidate.score_detail || {});
    reasons.push(...errors);
    if (!errors.length && total < minimum) reasons.push(`score_below_${minimum}`);
    if (reasons.length) {
      rejected.push({ id: identifier, url, reasons });
      continue;
    }
    accepted.push({ ...candidate, score: total, text_sha256: digest });
    if (url) seenUrls.add(url);
    if (digest) seenHashes.add(digest);
  }

  accepted.sort(
    (a, b) =>
      b.score - a.score ||
      (b.score_detail?.insight_gain || 0) - (a.score_detail?.insight_gain || 0) ||
      (b.score_detail?.source_credibility || 0) - (a.score_detail?.source_credibility || 0) ||
      (b.score_detail?.freshness || 0) - (a.score_detail?.freshness || 0),
  );
  const selected = accepted.slice(0, limit);
  for (const candidate of accepted.slice(limit)) {
    rejected.push({ id: candidate.id || "unknown", url: candidate.url, reasons: ["below_top_limit"] });
  }
  return { selected, rejected, selection_count: selected.length, minimum_score: minimum };
}

export function captionIssues(caption) {
  const text = String(caption || "").trim();
  if (!text) return ["missing_caption"];
  const withoutTags = text.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
  const sentences = withoutTags.split(/[。！？.!?]+/u).map((part) => part.trim()).filter(Boolean);
  const hashtags = [...text.matchAll(/#[\p{L}\p{N}_]+/gu)];
  const issues = [];
  if (sentences.length < 1 || sentences.length > 2) issues.push("caption_sentences_must_be_1_or_2");
  if (hashtags.length < 3 || hashtags.length > 5) issues.push("caption_hashtags_must_be_3_to_5");
  if (text.length > 220) issues.push("caption_too_long");
  return issues;
}

export function dateInTimeZone(date = new Date(), timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function makeRunId(date = new Date(), timeZone = "Asia/Shanghai") {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "")
    .replace(/[^\d]/g, "-");
  return `${dateInTimeZone(date, timeZone)}-${stamp.slice(-4) || "run"}`;
}

export function latestRunCompletion(records, date, timeZone = "Asia/Shanghai") {
  const matching = records.filter(
    (record) =>
      record.type === "run_completion" &&
      record.selection_count > 0 &&
      record.scheduled_for &&
      dateInTimeZone(new Date(record.scheduled_for), timeZone) === date,
  );
  return matching.length ? matching[matching.length - 1] : null;
}

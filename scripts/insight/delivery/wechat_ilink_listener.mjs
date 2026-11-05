#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DeliveryError,
  atomicWriteJson,
  baseInfo,
  deliver,
  loadRuntime,
  postJson,
  sendPinnedText,
} from "./wechat_ilink_delivery.mjs";

const EXACT_COMMAND = "发今日素材";
const HELP_REPLY = "未识别指令。请发送“发今日素材”。";
const DEFAULT_CONFIG = "~/.weclaw/x-post2image-delivery.json";
const DEFAULT_HISTORY = "~/Documents/x-post2image/history.jsonl";
const TIME_ZONE = "Asia/Shanghai";

function expandHome(value) {
  if (value === "~") return process.env.HOME;
  if (value.startsWith("~/")) return path.join(process.env.HOME, value.slice(2));
  return value;
}

function absolutePath(value) {
  return path.resolve(expandHome(value));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new DeliveryError("INVALID_ARGUMENT", `unexpected argument: ${key}`);
    }
    const name = key.slice(2).replaceAll("-", "_");
    if (name === "once") {
      options.once = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new DeliveryError("INVALID_ARGUMENT", `missing value for ${key}`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function log(status, details = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    status,
    ...details,
  }));
}

function todayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

function extractText(message) {
  return (message.item_list || [])
    .filter((item) => item.type === 1 && typeof item.text_item?.text === "string")
    .map((item) => item.text_item.text)
    .join("\n")
    .trim();
}

async function saveContext(runtime, message) {
  await atomicWriteJson(absolutePath(runtime.config.context_file), {
    schema_version: 1,
    recipient_sha256: runtime.config.recipient_sha256,
    context_token: message.context_token,
    captured_at: new Date().toISOString(),
  });
}

async function readHistory(historyPath) {
  const text = await fs.readFile(historyPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new DeliveryError(
          "INVALID_HISTORY",
          `history contains invalid JSON at line ${index + 1}`,
        );
      }
    });
}

function selectReadyCandidates(records, runDate) {
  let completionIndex = -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (
      record.run_date === runDate &&
      record.record_type === "run_completion" &&
      record.state === "READY_FOR_REVIEW"
    ) {
      completionIndex = index;
      break;
    }
  }
  if (completionIndex < 0) return [];
  const expectedCount = Number(records[completionIndex].selection_count);
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 5) {
    throw new DeliveryError("INVALID_HISTORY", "run completion has an invalid selection count");
  }
  const selected = new Map();
  for (let index = completionIndex - 1; index >= 0 && selected.size < expectedCount; index -= 1) {
    const record = records[index];
    if (
      record.run_date === runDate &&
      record.state === "READY_FOR_REVIEW" &&
      record.candidate_id &&
      !selected.has(String(record.candidate_id))
    ) {
      selected.set(String(record.candidate_id), record);
    }
  }
  if (selected.size !== expectedCount) {
    throw new DeliveryError("INCOMPLETE_HISTORY", "ready candidate count does not match completion");
  }
  return [...selected.values()].sort(
    (left, right) => Number(left.candidate_id) - Number(right.candidate_id),
  );
}

async function buildManifest(historyPath, queueDirectory, runDate) {
  const manifestPath = path.join(queueDirectory, `${runDate}.json`);
  if (await pathExists(manifestPath)) return manifestPath;
  if (!(await pathExists(historyPath))) return null;
  const records = await readHistory(historyPath);
  const candidates = selectReadyCandidates(records, runDate);
  if (candidates.length === 0) return null;
  const pairs = candidates.map((record) => {
    if (
      typeof record.asset_path !== "string" ||
      typeof record.asset_sha256 !== "string" ||
      typeof record.caption !== "string" ||
      !record.caption.trim() ||
      record.quality_checks?.manual_200_percent_visual_review_completed !== true
    ) {
      throw new DeliveryError(
        "INCOMPLETE_HISTORY",
        `candidate ${record.candidate_id} is missing a final asset, caption, hash, or manual QA`,
      );
    }
    return {
      image: record.asset_path,
      caption: record.caption,
      sha256: record.asset_sha256,
    };
  });
  await atomicWriteJson(manifestPath, {
    run_id: `${runDate}-top-${pairs.length}`,
    pairs,
  });
  return manifestPath;
}

async function acquireLock(lockPath) {
  async function tryOpen() {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  }
  try {
    return await tryOpen();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let stale = false;
  try {
    const pid = Number((await fs.readFile(lockPath, "utf8")).trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      stale = true;
    } else {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error?.code === "ESRCH") stale = true;
      }
    }
  } catch {
    stale = true;
  }
  if (!stale) {
    throw new DeliveryError("ALREADY_RUNNING", "another iLink listener is already running");
  }
  await fs.unlink(lockPath);
  return await tryOpen();
}

async function journalRequest(root, message, action) {
  const pendingDirectory = path.join(root, "pending");
  await ensurePrivateDirectory(pendingDirectory);
  const messageReference = sha256Text(String(message.message_id || message.seq || "unknown"));
  const pendingPath = path.join(pendingDirectory, `${messageReference}.json`);
  if (!(await pathExists(pendingPath))) {
    await atomicWriteJson(pendingPath, {
      schema_version: 1,
      message_reference: messageReference,
      action,
      requested_date: todayInShanghai(),
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }
}

async function archivePending(root, pendingPath, status) {
  const processedDirectory = path.join(root, "processed");
  await ensurePrivateDirectory(processedDirectory);
  const record = JSON.parse(await fs.readFile(pendingPath, "utf8"));
  record.status = status;
  record.processed_at = new Date().toISOString();
  await atomicWriteJson(path.join(processedDirectory, path.basename(pendingPath)), record);
  await fs.unlink(pendingPath);
}

async function scheduleRetry(pendingPath, error) {
  const record = JSON.parse(await fs.readFile(pendingPath, "utf8"));
  record.attempts = Number(record.attempts || 0) + 1;
  const delaySeconds = Math.min(600, 30 * (2 ** Math.min(record.attempts - 1, 5)));
  record.next_attempt_at = new Date(Date.now() + delaySeconds * 1000).toISOString();
  record.last_error_code = error instanceof DeliveryError ? error.code : "UNEXPECTED";
  record.updated_at = new Date().toISOString();
  await atomicWriteJson(pendingPath, record);
}

async function processPending({ root, configPath, historyPath }) {
  const pendingDirectory = path.join(root, "pending");
  const queueDirectory = path.join(root, "queue");
  const receiptsDirectory = path.join(root, "receipts");
  await ensurePrivateDirectory(pendingDirectory);
  await ensurePrivateDirectory(queueDirectory);
  await ensurePrivateDirectory(receiptsDirectory);
  const entries = (await fs.readdir(pendingDirectory))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  for (const entry of entries) {
    const pendingPath = path.join(pendingDirectory, entry);
    const request = JSON.parse(await fs.readFile(pendingPath, "utf8"));
    if (Date.parse(request.next_attempt_at || 0) > Date.now()) continue;
    const runDate = request.requested_date;
    const receiptPath = path.join(receiptsDirectory, `${runDate}.json`);
    try {
      if (request.action === "HELP") {
        await sendPinnedText({
          configPath,
          text: HELP_REPLY,
          clientId: `xic-help-${request.message_reference.slice(0, 24)}`,
          runId: `xic-listener-help-${runDate}`,
        });
        await archivePending(root, pendingPath, "GUIDANCE_SENT");
        log("COMMAND_HANDLED", { result: "GUIDANCE_SENT", run_date: runDate });
        continue;
      }
      if (await pathExists(receiptPath)) {
        await sendPinnedText({
          configPath,
          text: "今日素材已经发送过，为避免重复不会再次发送。",
          clientId: `xic-already-${request.message_reference.slice(0, 24)}`,
          runId: `xic-listener-${runDate}`,
        });
        await archivePending(root, pendingPath, "ALREADY_DELIVERED");
        log("COMMAND_HANDLED", { result: "ALREADY_DELIVERED", run_date: runDate });
        continue;
      }
      const manifestPath = await buildManifest(historyPath, queueDirectory, runDate);
      if (!manifestPath) {
        await sendPinnedText({
          configPath,
          text: "今日素材尚未准备好，请稍后再发送“发今日素材”。",
          clientId: `xic-not-ready-${request.message_reference.slice(0, 24)}`,
          runId: `xic-listener-${runDate}`,
        });
        await archivePending(root, pendingPath, "NOT_READY");
        log("COMMAND_HANDLED", { result: "NOT_READY", run_date: runDate });
        continue;
      }
      const result = await deliver({ config: configPath, manifest: manifestPath });
      await atomicWriteJson(receiptPath, {
        schema_version: 1,
        run_date: runDate,
        status: result.status,
        manifest_sha256: result.manifest_sha256,
        image_messages: result.image_messages,
        caption_messages: result.caption_messages,
        accepted_at: new Date().toISOString(),
      });
      await archivePending(root, pendingPath, "TRANSPORT_ACCEPTED");
      log("COMMAND_HANDLED", {
        result: "TRANSPORT_ACCEPTED",
        run_date: runDate,
        image_messages: result.image_messages,
        caption_messages: result.caption_messages,
      });
    } catch (error) {
      await scheduleRetry(pendingPath, error);
      log("COMMAND_RETRY_SCHEDULED", {
        run_date: runDate,
        code: error instanceof DeliveryError ? error.code : "UNEXPECTED",
      });
    }
  }
}

async function pollOnce({ runtime, root, configPath, historyPath }) {
  const syncPath = absolutePath(runtime.config.sync_file);
  const sync = JSON.parse(await fs.readFile(syncPath, "utf8"));
  const result = await postJson(runtime, "ilink/bot/getupdates", {
    get_updates_buf: sync.get_updates_buf || "",
    base_info: baseInfo(),
  }, 45000);
  const messages = [...(result.msgs || [])].sort(
    (left, right) => Number(left.message_id || left.seq || 0) -
      Number(right.message_id || right.seq || 0),
  );
  let pinnedUpdates = 0;
  let commands = 0;
  let guidance = 0;
  for (const message of messages) {
    if (
      message.from_user_id !== runtime.config.recipient_id ||
      !message.context_token
    ) {
      continue;
    }
    pinnedUpdates += 1;
    await saveContext(runtime, message);
    const text = extractText(message);
    if (text === EXACT_COMMAND) {
      commands += 1;
      await journalRequest(root, message, "DELIVER_TODAY");
    } else if (text) {
      guidance += 1;
      await journalRequest(root, message, "HELP");
    }
  }
  if (result.get_updates_buf) {
    await atomicWriteJson(syncPath, { get_updates_buf: result.get_updates_buf });
  }
  if (pinnedUpdates > 0) {
    log("PINNED_CONTEXT_REFRESHED", {
      pinned_updates: pinnedUpdates,
      commands,
      guidance,
    });
  }
  await processPending({ root, configPath, historyPath });
  return { messages: messages.length, pinnedUpdates, commands, guidance };
}

async function run(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  const historyPath = absolutePath(options.history || DEFAULT_HISTORY);
  const runtime = await loadRuntime(configPath);
  const root = path.dirname(absolutePath(runtime.config.context_file));
  await ensurePrivateDirectory(root);
  const lockPath = path.join(root, "listener.lock");
  const lockHandle = await acquireLock(lockPath);
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  log("LISTENER_STARTED", {
    recipient_fingerprint: runtime.config.recipient_sha256.slice(0, 12),
    exact_command: EXACT_COMMAND,
  });
  try {
    await processPending({ root, configPath, historyPath });
    let failures = 0;
    do {
      try {
        await pollOnce({ runtime, root, configPath, historyPath });
        failures = 0;
      } catch (error) {
        failures += 1;
        const delaySeconds = Math.min(60, 2 ** Math.min(failures, 6));
        log("POLL_RETRY", {
          code: error instanceof DeliveryError ? error.code : "UNEXPECTED",
          delay_seconds: delaySeconds,
        });
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
      if (options.once) break;
    } while (!stopping);
  } finally {
    await lockHandle.close();
    await fs.unlink(lockPath).catch(() => {});
    log("LISTENER_STOPPED");
  }
}

export {
  EXACT_COMMAND,
  HELP_REPLY,
  buildManifest,
  extractText,
  pollOnce,
  processPending,
  run,
  selectReadyCandidates,
  todayInShanghai,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      status: "FATAL",
      code: error instanceof DeliveryError ? error.code : "UNEXPECTED",
      message: error instanceof DeliveryError ? error.message : "unexpected listener failure",
    }));
    process.exitCode = error instanceof DeliveryError ? error.exitCode : 1;
  });
}

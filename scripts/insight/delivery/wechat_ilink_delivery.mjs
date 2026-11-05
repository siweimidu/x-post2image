#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const APP_VERSION = "2.4.6";
const APP_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 6);
const SETUP_COMMAND = "绑定素材助手";
const DEFAULT_CONFIG = "~/.weclaw/x-post2image-delivery.json";
const DEFAULT_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";

class DeliveryError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function absolutePath(value) {
  return path.resolve(expandHome(value));
}

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new DeliveryError("INVALID_ARGUMENT", `unexpected argument: ${key}`);
    }
    const name = key.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new DeliveryError("INVALID_ARGUMENT", `missing value for ${key}`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, name) {
  if (!options[name]) {
    throw new DeliveryError("INVALID_ARGUMENT", `missing --${name.replaceAll("_", "-")}`);
  }
  return options[name];
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, "utf8"));
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new DeliveryError("MISSING_FILE", `${label} is unavailable: ${filePath}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DeliveryError("INVALID_JSON", `${label} is not valid JSON: ${filePath}`);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function requirePrivateFile(filePath, label) {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new DeliveryError("MISSING_FILE", `${label} is unavailable: ${filePath}`);
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new DeliveryError("UNSAFE_FILE", `${label} is not a regular file`);
  }
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new DeliveryError("UNSAFE_PERMISSIONS", `${label} must not be accessible by group or others`);
  }
}

async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

function baseInfo() {
  return {
    channel_version: APP_VERSION,
    bot_agent: "OpenClaw",
  };
}

function requestHeaders(token) {
  const uin = crypto.randomBytes(4).readUInt32BE(0);
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": Buffer.from(String(uin), "utf8").toString("base64"),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": APP_CLIENT_VERSION,
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new DeliveryError("NETWORK_TIMEOUT", "iLink request timed out");
    }
    throw new DeliveryError("NETWORK_ERROR", "iLink request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(runtime, endpoint, body, timeoutMs = 15000) {
  const response = await fetchWithTimeout(
    `${runtime.baseUrl}/${endpoint}`,
    {
      method: "POST",
      headers: requestHeaders(runtime.token),
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new DeliveryError("HTTP_ERROR", `${endpoint} returned HTTP ${response.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new DeliveryError("INVALID_RESPONSE", `${endpoint} returned invalid JSON`);
  }
  if (parsed.ret && parsed.ret !== 0) {
    const error = new DeliveryError(
      "API_RET",
      `${endpoint} returned ret=${parsed.ret} errmsg=${parsed.errmsg || "(none)"}`,
    );
    error.ret = parsed.ret;
    error.errmsg = parsed.errmsg || "";
    throw error;
  }
  return parsed;
}

async function loadRuntime(configPath) {
  await requirePrivateFile(configPath, "delivery config");
  const config = await readJson(configPath, "delivery config");
  if (config.schema_version !== SCHEMA_VERSION) {
    throw new DeliveryError("CONFIG_VERSION", "unsupported delivery config version");
  }
  if (!config.recipient_id?.endsWith("@im.wechat")) {
    throw new DeliveryError("INVALID_RECIPIENT", "configured recipient is not an iLink user");
  }
  if (sha256Text(config.recipient_id) !== config.recipient_sha256) {
    throw new DeliveryError("RECIPIENT_TAMPERED", "configured recipient fingerprint mismatch");
  }
  const credentialsPath = absolutePath(config.credentials_file);
  await requirePrivateFile(credentialsPath, "bot credentials");
  const credentials = await readJson(credentialsPath, "bot credentials");
  if (!credentials.bot_token || !credentials.ilink_bot_id) {
    throw new DeliveryError("INVALID_CREDENTIALS", "bot credentials are incomplete");
  }
  if (credentials.ilink_bot_id !== config.bot_id) {
    throw new DeliveryError("BOT_MISMATCH", "bot credentials do not match the pinned bot");
  }
  return {
    config,
    configPath,
    credentialsPath,
    token: credentials.bot_token,
    baseUrl: (credentials.baseurl || "https://ilinkai.weixin.qq.com").replace(/\/+$/, ""),
  };
}

function buildPinnedConfig({
  configPath,
  credentialsPath,
  syncPath,
  credentials,
  recipientId,
  options,
}) {
  const privateDirectory = path.join(path.dirname(configPath), "x-post2image-delivery");
  const config = {
    schema_version: SCHEMA_VERSION,
    bot_id: credentials.ilink_bot_id,
    recipient_id: recipientId,
    recipient_sha256: sha256Text(recipientId),
    credentials_file: credentialsPath,
    sync_file: syncPath,
    context_file: path.join(privateDirectory, "context.json"),
    state_dir: path.join(privateDirectory, "state"),
    cdn_base_url: options.cdn_base_url || DEFAULT_CDN_BASE,
    inter_message_delay_ms: Number(options.inter_message_delay_ms || 1200),
  };
  if (
    !Number.isInteger(config.inter_message_delay_ms) ||
    config.inter_message_delay_ms < 0 ||
    config.inter_message_delay_ms > 10000
  ) {
    throw new DeliveryError("INVALID_ARGUMENT", "inter-message delay must be 0–10000 ms");
  }
  return config;
}

async function configure(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  const credentialsPath = absolutePath(requireOption(options, "credentials"));
  const syncPath = absolutePath(requireOption(options, "sync"));
  const recipientId = requireOption(options, "recipient");
  if (!recipientId.endsWith("@im.wechat")) {
    throw new DeliveryError("INVALID_RECIPIENT", "recipient must end with @im.wechat");
  }
  await requirePrivateFile(credentialsPath, "bot credentials");
  await requirePrivateFile(syncPath, "sync cursor");
  const credentials = await readJson(credentialsPath, "bot credentials");
  if (!credentials.bot_token || !credentials.ilink_bot_id) {
    throw new DeliveryError("INVALID_CREDENTIALS", "bot credentials are incomplete");
  }
  const config = buildPinnedConfig({
    configPath,
    credentialsPath,
    syncPath,
    credentials,
    recipientId,
    options,
  });
  await atomicWriteJson(configPath, config);
  console.log(JSON.stringify({
    status: "CONFIGURED",
    recipient_fingerprint: config.recipient_sha256.slice(0, 12),
    config: configPath,
  }));
}

function extractText(message) {
  return (message.item_list || [])
    .filter((item) => Number(item.type) === 1 && typeof item.text_item?.text === "string")
    .map((item) => item.text_item.text)
    .join("\n")
    .trim();
}

async function setup(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  if (await pathExists(configPath)) {
    throw new DeliveryError(
      "CONFIG_EXISTS",
      "delivery config already exists; setup refuses to repin the recipient",
    );
  }
  const credentialsPath = absolutePath(requireOption(options, "credentials"));
  await requirePrivateFile(credentialsPath, "bot credentials");
  const credentials = await readJson(credentialsPath, "bot credentials");
  if (!credentials.bot_token || !credentials.ilink_bot_id) {
    throw new DeliveryError("INVALID_CREDENTIALS", "bot credentials are incomplete");
  }
  const derivedSyncPath = credentialsPath.endsWith(".json")
    ? `${credentialsPath.slice(0, -5)}.sync.json`
    : `${credentialsPath}.sync.json`;
  const syncPath = absolutePath(options.sync || derivedSyncPath);
  if (!(await pathExists(syncPath))) {
    await atomicWriteJson(syncPath, { get_updates_buf: "" });
  }
  await requirePrivateFile(syncPath, "sync cursor");
  const sync = await readJson(syncPath, "sync cursor");
  const runtime = {
    token: credentials.bot_token,
    baseUrl: (credentials.baseurl || "https://ilinkai.weixin.qq.com").replace(/\/+$/, ""),
  };
  const result = await postJson(runtime, "ilink/bot/getupdates", {
    get_updates_buf: sync.get_updates_buf || "",
    base_info: baseInfo(),
  }, Number(options.wait_ms || 45000) + 5000);
  const matches = (result.msgs || [])
    .filter((message) =>
      message.from_user_id?.endsWith("@im.wechat") &&
      message.context_token &&
      (!message.to_user_id || message.to_user_id === credentials.ilink_bot_id) &&
      extractText(message) === SETUP_COMMAND,
    )
    .sort((left, right) =>
      Number(right.message_id || right.seq || 0) -
      Number(left.message_id || left.seq || 0)
    );
  const recipients = new Set(matches.map((message) => message.from_user_id));
  if (recipients.size === 0) {
    throw new DeliveryError(
      "NO_SETUP_MESSAGE",
      `no exact “${SETUP_COMMAND}” message was received`,
      23,
    );
  }
  if (recipients.size !== 1) {
    throw new DeliveryError(
      "AMBIGUOUS_SETUP_MESSAGE",
      "setup saw the binding command from more than one user and pinned nobody",
      23,
    );
  }
  const message = matches[0];
  const recipientId = message.from_user_id;
  const config = buildPinnedConfig({
    configPath,
    credentialsPath,
    syncPath,
    credentials,
    recipientId,
    options,
  });
  if (result.get_updates_buf) {
    await atomicWriteJson(syncPath, { get_updates_buf: result.get_updates_buf });
  }
  await atomicWriteJson(absolutePath(config.context_file), {
    schema_version: SCHEMA_VERSION,
    recipient_sha256: config.recipient_sha256,
    context_token: message.context_token,
    captured_at: new Date().toISOString(),
  });
  await atomicWriteJson(configPath, config);
  console.log(JSON.stringify({
    status: "SETUP_COMPLETE",
    recipient_fingerprint: config.recipient_sha256.slice(0, 12),
    config: configPath,
    sync: syncPath,
  }));
}

async function captureContext(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  const runtime = await loadRuntime(configPath);
  const cursorPath = absolutePath(options.cursor_file || runtime.config.sync_file);
  await requirePrivateFile(cursorPath, "sync cursor");
  const cursor = await readJson(cursorPath, "sync cursor");
  const result = await postJson(runtime, "ilink/bot/getupdates", {
    get_updates_buf: cursor.get_updates_buf || "",
    base_info: baseInfo(),
  }, Number(options.wait_ms || 45000) + 5000);
  const matching = (result.msgs || [])
    .filter((message) =>
      message.from_user_id === runtime.config.recipient_id && message.context_token,
    )
    .sort((left, right) => Number(right.message_id || 0) - Number(left.message_id || 0));
  if (matching.length === 0) {
    throw new DeliveryError(
      "NO_FRESH_CONTEXT",
      "no new message from the pinned recipient; ask the user to message the dedicated bot",
      23,
    );
  }
  await atomicWriteJson(absolutePath(runtime.config.context_file), {
    schema_version: SCHEMA_VERSION,
    recipient_sha256: runtime.config.recipient_sha256,
    context_token: matching[0].context_token,
    captured_at: new Date().toISOString(),
  });
  if (!options.cursor_file && result.get_updates_buf) {
    await atomicWriteJson(absolutePath(runtime.config.sync_file), {
      get_updates_buf: result.get_updates_buf,
    });
  }
  console.log(JSON.stringify({
    status: "CONTEXT_CAPTURED",
    recipient_fingerprint: runtime.config.recipient_sha256.slice(0, 12),
    matching_updates: matching.length,
  }));
}

async function loadContext(runtime) {
  const contextPath = absolutePath(runtime.config.context_file);
  await requirePrivateFile(contextPath, "context cache");
  const context = await readJson(contextPath, "context cache");
  if (
    context.schema_version !== SCHEMA_VERSION ||
    context.recipient_sha256 !== runtime.config.recipient_sha256 ||
    !context.context_token
  ) {
    throw new DeliveryError("CONTEXT_MISMATCH", "cached context does not match the pinned recipient", 23);
  }
  return context;
}

async function preflight(runtime) {
  const context = await loadContext(runtime);
  try {
    await postJson(runtime, "ilink/bot/getconfig", {
      ilink_user_id: runtime.config.recipient_id,
      context_token: context.context_token,
      base_info: baseInfo(),
    });
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "API_RET") {
      throw new DeliveryError(
        "CONTEXT_REFRESH_REQUIRED",
        "cached iLink context was rejected; refresh it before sending any material",
        23,
      );
    }
    throw error;
  }
  return context;
}

async function runPreflight(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  const runtime = await loadRuntime(configPath);
  const context = await preflight(runtime);
  console.log(JSON.stringify({
    status: "PREFLIGHT_OK",
    recipient_fingerprint: runtime.config.recipient_sha256.slice(0, 12),
    context_captured_at: context.captured_at,
  }));
}

async function loadManifest(filePath) {
  const manifest = await readJson(filePath, "delivery manifest");
  if (!Array.isArray(manifest.pairs) || manifest.pairs.length < 1 || manifest.pairs.length > 5) {
    throw new DeliveryError("INVALID_MANIFEST", "manifest must contain 1–5 image/caption pairs");
  }
  const pairs = [];
  for (let index = 0; index < manifest.pairs.length; index += 1) {
    const pair = manifest.pairs[index];
    if (typeof pair.image !== "string" || !path.isAbsolute(pair.image)) {
      throw new DeliveryError("INVALID_MANIFEST", `pair ${index + 1} image must be an absolute path`);
    }
    if (path.extname(pair.image).toLowerCase() !== ".png") {
      throw new DeliveryError("INVALID_MANIFEST", `pair ${index + 1} must use a final PNG`);
    }
    if (typeof pair.caption !== "string" || !pair.caption.trim()) {
      throw new DeliveryError("INVALID_MANIFEST", `pair ${index + 1} caption is empty`);
    }
    const image = await fs.readFile(pair.image);
    const imageSha256 = sha256Buffer(image);
    if (pair.sha256 && pair.sha256 !== imageSha256) {
      throw new DeliveryError("HASH_MISMATCH", `pair ${index + 1} image hash mismatch`);
    }
    pairs.push({
      image: pair.image,
      caption: pair.caption,
      sha256: imageSha256,
      bytes: image.length,
    });
  }
  const canonical = JSON.stringify({
    schema_version: SCHEMA_VERSION,
    run_id: manifest.run_id || "",
    pairs: pairs.map((pair) => ({
      image: pair.image,
      caption: pair.caption,
      sha256: pair.sha256,
    })),
  });
  return {
    manifest,
    pairs,
    manifestSha256: sha256Text(canonical),
  };
}

function stableIdentifier(prefix, manifestSha256, index) {
  return `${prefix}-${sha256Text(`${manifestSha256}:${index}:${prefix}`).slice(0, 24)}`;
}

async function loadOrCreateState(runtime, manifestData) {
  const statePath = path.join(
    absolutePath(runtime.config.state_dir),
    `${manifestData.manifestSha256}.json`,
  );
  try {
    await requirePrivateFile(statePath, "delivery state");
    const state = await readJson(statePath, "delivery state");
    if (
      state.manifest_sha256 !== manifestData.manifestSha256 ||
      state.recipient_sha256 !== runtime.config.recipient_sha256
    ) {
      throw new DeliveryError("STATE_MISMATCH", "delivery state does not match manifest or recipient");
    }
    return { state, statePath };
  } catch (error) {
    if (!(error instanceof DeliveryError) || error.code !== "MISSING_FILE") {
      throw error;
    }
  }
  const state = {
    schema_version: SCHEMA_VERSION,
    manifest_sha256: manifestData.manifestSha256,
    recipient_sha256: runtime.config.recipient_sha256,
    run_id: manifestData.manifest.run_id ||
      stableIdentifier("xic-run", manifestData.manifestSha256, 0),
    status: "PENDING",
    pairs: manifestData.pairs.map((pair, index) => ({
      index: index + 1,
      image_sha256: pair.sha256,
      image_status: "PENDING",
      caption_status: "PENDING",
      image_client_id: stableIdentifier("xic-image", manifestData.manifestSha256, index),
      caption_client_id: stableIdentifier("xic-caption", manifestData.manifestSha256, index),
    })),
    updated_at: new Date().toISOString(),
  };
  await atomicWriteJson(statePath, state);
  return { state, statePath };
}

async function uploadImage(runtime, pair) {
  const plaintext = await fs.readFile(pair.image);
  if (sha256Buffer(plaintext) !== pair.sha256) {
    throw new DeliveryError("HASH_CHANGED", "image changed after manifest validation");
  }
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const ciphertextSize = Math.ceil((plaintext.length + 1) / 16) * 16;
  const uploadInfo = await postJson(runtime, "ilink/bot/getuploadurl", {
    filekey,
    media_type: 1,
    to_user_id: runtime.config.recipient_id,
    rawsize: plaintext.length,
    rawfilemd5,
    filesize: ciphertextSize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
    base_info: baseInfo(),
  });
  let uploadUrl = uploadInfo.upload_full_url?.trim();
  if (!uploadUrl) {
    if (!uploadInfo.upload_param) {
      throw new DeliveryError("UPLOAD_URL_MISSING", "iLink did not return a CDN upload URL");
    }
    const query = new URLSearchParams({
      encrypted_query_param: uploadInfo.upload_param,
      filekey,
    });
    uploadUrl = `${runtime.config.cdn_base_url || DEFAULT_CDN_BASE}/upload?${query.toString()}`;
  }
  const cipher = crypto.createCipheriv("aes-128-ecb", aeskey, null);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  let downloadParam;
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchWithTimeout(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: ciphertext,
    }, 30000);
    if (response.ok) {
      downloadParam = response.headers.get("x-encrypted-param");
      if (downloadParam) break;
      failure = new DeliveryError("CDN_RESPONSE", "CDN response omitted x-encrypted-param");
    } else {
      failure = new DeliveryError("CDN_UPLOAD", `CDN upload returned HTTP ${response.status}`);
      if (response.status >= 400 && response.status < 500) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  if (!downloadParam) throw failure;
  return {
    downloadParam,
    aeskeyHex: aeskey.toString("hex"),
    ciphertextSize: ciphertext.length,
  };
}

async function sendMessage(runtime, contextToken, runId, clientId, item) {
  try {
    await postJson(runtime, "ilink/bot/sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: runtime.config.recipient_id,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [item],
        context_token: contextToken,
        run_id: runId,
      },
      base_info: baseInfo(),
    });
  } catch (error) {
    if (
      error instanceof DeliveryError &&
      error.code === "API_RET" &&
      (error.ret === -2 || /prepare failed/i.test(error.errmsg))
    ) {
      throw new DeliveryError(
        "CONTEXT_REFRESH_REQUIRED",
        "iLink rejected media preparation; stop and refresh context before resuming",
        23,
      );
    }
    throw error;
  }
}

async function sendPinnedText({ configPath, text, clientId, runId }) {
  if (typeof text !== "string" || !text.trim()) {
    throw new DeliveryError("INVALID_TEXT", "reply text is empty");
  }
  const runtime = await loadRuntime(absolutePath(configPath || DEFAULT_CONFIG));
  const context = await preflight(runtime);
  await sendMessage(
    runtime,
    context.context_token,
    runId || `xic-listener-${Date.now()}`,
    clientId || `xic-listener-${crypto.randomBytes(12).toString("hex")}`,
    {
      type: 1,
      text_item: { text },
    },
  );
  return {
    status: "TEXT_ACCEPTED",
    recipient_fingerprint: runtime.config.recipient_sha256.slice(0, 12),
  };
}

async function checkpoint(statePath, state) {
  state.updated_at = new Date().toISOString();
  await atomicWriteJson(statePath, state);
}

async function deliver(options) {
  const configPath = absolutePath(options.config || DEFAULT_CONFIG);
  const manifestPath = absolutePath(requireOption(options, "manifest"));
  const runtime = await loadRuntime(configPath);
  const context = await preflight(runtime);
  const manifestData = await loadManifest(manifestPath);
  const { state, statePath } = await loadOrCreateState(runtime, manifestData);
  const delayMs = runtime.config.inter_message_delay_ms;

  for (let index = 0; index < manifestData.pairs.length; index += 1) {
    const pair = manifestData.pairs[index];
    const pairState = state.pairs[index];
    if (pairState.image_sha256 !== pair.sha256) {
      throw new DeliveryError("STATE_MISMATCH", `pair ${index + 1} image state mismatch`);
    }
    if (pairState.image_status !== "ACCEPTED") {
      const uploaded = await uploadImage(runtime, pair);
      await sendMessage(
        runtime,
        context.context_token,
        state.run_id,
        pairState.image_client_id,
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: uploaded.downloadParam,
              aes_key: Buffer.from(uploaded.aeskeyHex, "utf8").toString("base64"),
              encrypt_type: 1,
            },
            mid_size: uploaded.ciphertextSize,
          },
        },
      );
      pairState.image_status = "ACCEPTED";
      await checkpoint(statePath, state);
    }
    if (pairState.caption_status !== "ACCEPTED") {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await sendMessage(
        runtime,
        context.context_token,
        state.run_id,
        pairState.caption_client_id,
        {
          type: 1,
          text_item: { text: pair.caption },
        },
      );
      pairState.caption_status = "ACCEPTED";
      await checkpoint(statePath, state);
    }
    if (delayMs > 0 && index + 1 < manifestData.pairs.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  state.status = "TRANSPORT_ACCEPTED";
  await checkpoint(statePath, state);
  const result = {
    status: "TRANSPORT_ACCEPTED",
    recipient_fingerprint: runtime.config.recipient_sha256.slice(0, 12),
    image_messages: state.pairs.filter((pair) => pair.image_status === "ACCEPTED").length,
    caption_messages: state.pairs.filter((pair) => pair.caption_status === "ACCEPTED").length,
    manifest_sha256: manifestData.manifestSha256,
  };
  console.log(JSON.stringify(result));
  return result;
}

function printUsage() {
  console.log(`Usage:
  wechat_ilink_delivery.mjs setup --credentials FILE [--sync FILE] [--config FILE]
  wechat_ilink_delivery.mjs configure --credentials FILE --sync FILE --recipient ID [--config FILE]
  wechat_ilink_delivery.mjs capture-context [--config FILE] [--cursor-file FILE]
  wechat_ilink_delivery.mjs preflight [--config FILE]
  wechat_ilink_delivery.mjs deliver --manifest FILE [--config FILE]`);
}

export {
  DeliveryError,
  SETUP_COMMAND,
  atomicWriteJson,
  baseInfo,
  captureContext,
  configure,
  deliver,
  loadManifest,
  loadRuntime,
  postJson,
  runPreflight,
  sendPinnedText,
  setup,
};

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "setup":
      await setup(options);
      break;
    case "configure":
      await configure(options);
      break;
    case "capture-context":
      await captureContext(options);
      break;
    case "preflight":
      await runPreflight(options);
      break;
    case "deliver":
      await deliver(options);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      throw new DeliveryError("INVALID_COMMAND", `unknown command: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = error instanceof DeliveryError
      ? {
          status: "ERROR",
          code: error.code,
          message: error.message,
        }
      : {
          status: "ERROR",
          code: "UNEXPECTED",
          message: "unexpected delivery failure",
        };
    console.error(JSON.stringify(safe));
    process.exitCode = error instanceof DeliveryError ? error.exitCode : 1;
  });
}

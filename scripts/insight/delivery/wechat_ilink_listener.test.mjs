import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXACT_COMMAND,
  HELP_REPLY,
  run,
  selectReadyCandidates,
  todayInShanghai,
} from "./wechat_ilink_listener.mjs";

const recipient = "listener-owner@im.wechat";
const botId = "listener-bot@im.bot";
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function startFakeIlink(updates) {
  const messages = [];
  let origin;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/ilink/bot/getupdates") {
      response.end(JSON.stringify({
        ret: 0,
        msgs: updates,
        get_updates_buf: "cursor-after-listener-test",
      }));
      return;
    }
    if (request.url === "/ilink/bot/getconfig") {
      response.end(JSON.stringify({ ret: 0, typing_ticket: "ticket" }));
      return;
    }
    if (request.url === "/ilink/bot/getuploadurl") {
      response.end(JSON.stringify({ ret: 0, upload_full_url: `${origin}/cdn-upload` }));
      return;
    }
    if (request.url === "/cdn-upload") {
      response.setHeader("x-encrypted-param", "download-param");
      response.end();
      return;
    }
    if (request.url === "/ilink/bot/sendmessage") {
      messages.push(JSON.parse(body.toString("utf8")).msg);
      response.end(JSON.stringify({ ret: 0 }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ret: -1 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    messages,
    close: async () => await new Promise((resolve) => server.close(resolve)),
  };
}

async function makeFixture(origin, runDate = todayInShanghai()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xic-listener-test-"));
  const privateRoot = path.join(directory, "private");
  const credentials = path.join(directory, "credentials.json");
  const sync = path.join(directory, "sync.json");
  const config = path.join(directory, "delivery.json");
  const image = path.join(directory, "card.png");
  const history = path.join(directory, "history.jsonl");
  await fs.mkdir(privateRoot, { mode: 0o700 });
  await fs.writeFile(credentials, JSON.stringify({
    bot_token: "test-token",
    ilink_bot_id: botId,
    baseurl: origin,
  }), { mode: 0o600 });
  await fs.writeFile(sync, JSON.stringify({ get_updates_buf: "cursor-before" }), {
    mode: 0o600,
  });
  await fs.writeFile(config, JSON.stringify({
    schema_version: 1,
    bot_id: botId,
    recipient_id: recipient,
    recipient_sha256: sha256(recipient),
    credentials_file: credentials,
    sync_file: sync,
    context_file: path.join(privateRoot, "context.json"),
    state_dir: path.join(privateRoot, "state"),
    cdn_base_url: "https://unused.invalid/c2c",
    inter_message_delay_ms: 0,
  }), { mode: 0o600 });
  await fs.writeFile(image, pngBytes);
  const candidate = {
    run_date: runDate,
    candidate_id: "01",
    state: "READY_FOR_REVIEW",
    caption: "监听器测试配文。\n\n#测试 #安全",
    asset_path: image,
    asset_sha256: sha256(pngBytes),
    quality_checks: {
      manual_200_percent_visual_review_completed: true,
    },
  };
  const completion = {
    run_date: runDate,
    record_type: "run_completion",
    state: "READY_FOR_REVIEW",
    selection_count: 1,
  };
  await fs.writeFile(history, `${JSON.stringify(candidate)}\n${JSON.stringify(completion)}\n`);
  return { directory, privateRoot, config, history, sync };
}

test("selects only the candidates immediately preceding the latest completion", () => {
  const records = [
    { run_date: "2026-07-23", candidate_id: "01", state: "READY_FOR_REVIEW" },
    {
      run_date: "2026-07-23",
      record_type: "run_completion",
      state: "READY_FOR_REVIEW",
      selection_count: 1,
    },
    { run_date: "2026-07-23", candidate_id: "02", state: "READY_FOR_REVIEW" },
    {
      run_date: "2026-07-23",
      record_type: "run_completion",
      state: "READY_FOR_REVIEW",
      selection_count: 1,
    },
  ];
  assert.deepEqual(
    selectReadyCandidates(records, "2026-07-23").map((record) => record.candidate_id),
    ["02"],
  );
});

test("exact pinned command immediately delivers the ready pack and writes a receipt", async (t) => {
  const fake = await startFakeIlink([{
    message_id: 501,
    from_user_id: recipient,
    context_token: "test-fresh-listener-context",
    item_list: [{ type: 1, text_item: { text: EXACT_COMMAND } }],
  }]);
  t.after(fake.close);
  const fixture = await makeFixture(fake.origin);
  t.after(async () => await fs.rm(fixture.directory, { recursive: true, force: true }));

  await run({
    once: true,
    config: fixture.config,
    history: fixture.history,
  });

  assert.deepEqual(fake.messages.map((message) => message.item_list[0].type), [2, 1]);
  assert.ok(fake.messages.every((message) => message.to_user_id === recipient));
  assert.ok(fake.messages.every((message) =>
    message.context_token === "test-fresh-listener-context"
  ));
  const receipt = path.join(fixture.privateRoot, "receipts", `${todayInShanghai()}.json`);
  assert.equal(JSON.parse(await fs.readFile(receipt, "utf8")).status, "TRANSPORT_ACCEPTED");
  assert.equal(
    JSON.parse(await fs.readFile(fixture.sync, "utf8")).get_updates_buf,
    "cursor-after-listener-test",
  );
});

test("an exact command before the first history file gets a not-ready reply", async (t) => {
  const fake = await startFakeIlink([{
    message_id: 551,
    from_user_id: recipient,
    context_token: "test-missing-history-context",
    item_list: [{ type: 1, text_item: { text: EXACT_COMMAND } }],
  }]);
  t.after(fake.close);
  const fixture = await makeFixture(fake.origin);
  t.after(async () => await fs.rm(fixture.directory, { recursive: true, force: true }));
  await fs.unlink(fixture.history);

  await run({
    once: true,
    config: fixture.config,
    history: fixture.history,
  });

  assert.equal(fake.messages.length, 1);
  assert.equal(fake.messages[0].to_user_id, recipient);
  assert.match(fake.messages[0].item_list[0].text_item.text, /尚未准备好/);
});

test("other users stay ignored while pinned non-command text gets safe guidance", async (t) => {
  const fake = await startFakeIlink([
    {
      message_id: 601,
      from_user_id: "someone-else@im.wechat",
      context_token: "test-other-context",
      item_list: [{ type: 1, text_item: { text: EXACT_COMMAND } }],
    },
    {
      message_id: 602,
      from_user_id: recipient,
      context_token: "test-owner-context",
      item_list: [{ type: 1, text_item: { text: "你好" } }],
    },
  ]);
  t.after(fake.close);
  const fixture = await makeFixture(fake.origin);
  t.after(async () => await fs.rm(fixture.directory, { recursive: true, force: true }));

  await run({
    once: true,
    config: fixture.config,
    history: fixture.history,
  });

  assert.equal(fake.messages.length, 1);
  assert.equal(fake.messages[0].to_user_id, recipient);
  assert.equal(fake.messages[0].context_token, "test-owner-context");
  assert.equal(fake.messages[0].item_list[0].type, 1);
  assert.equal(fake.messages[0].item_list[0].text_item.text, HELP_REPLY);
  const pendingDirectory = path.join(fixture.privateRoot, "pending");
  assert.deepEqual(await fs.readdir(pendingDirectory), []);
  const processedDirectory = path.join(fixture.privateRoot, "processed");
  const processed = await fs.readdir(processedDirectory);
  assert.equal(processed.length, 1);
  const record = JSON.parse(
    await fs.readFile(path.join(processedDirectory, processed[0]), "utf8"),
  );
  assert.equal(record.status, "GUIDANCE_SENT");
  assert.equal(record.action, "HELP");
});

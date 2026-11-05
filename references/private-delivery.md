# Private WeChat delivery

Use this step only for a private review destination explicitly configured by the user. It is not social publishing.

## Route selection

1. Prefer `scripts/insight/delivery/wechat_ilink_delivery.mjs` when a dedicated iLink robot review chat is pinned. It is headless, never opens desktop WeChat, and cannot accept a runtime recipient override during delivery.
2. Use `scripts/insight/delivery/wechat_main_window_delivery.sh` only when the user separately configured their File Transfer Assistant and the iLink route is unavailable.
3. Never switch routes during a failed batch. Stop, preserve the checkpoint, and report the exact reason.

## Dedicated iLink robot

The helper keeps its fixed recipient, credential path, context cache, and delivery checkpoints under `~/.weclaw`. The config and context files must be mode `0600`; their parent directory must be mode `0700`. The helper reads tokens internally and never prints them.

When `scripts/insight/delivery/wechat_ilink_listener.mjs` is installed as a user `launchd` service, it long-polls without opening a window. It accepts only the exact text `发今日素材` from the pinned recipient. It ignores the same text from every other user. Other nonempty text from the pinned recipient is not treated as a delivery command; instead, the listener replies with the exact usage prompt. Before advancing the iLink sync cursor, it durably journals both delivery commands and guidance replies so a process crash cannot lose either action.

For the requested Shanghai calendar date, the listener selects the candidates immediately preceding the latest matching `run_completion` record in private history. It requires `READY_FOR_REVIEW`, the final absolute PNG path and SHA-256, a nonempty caption, completed manual 200% QA, and a matching selection count. It then builds a private manifest and uses the normal preflight and checkpointed delivery path.

If the pack is not ready, reply only that it is not ready and require a later command. If a private receipt already exists for the date, reply that it was already sent and do not resend. A transport error keeps the durable command pending with bounded exponential backoff.

### One-time installation

Use [WeClaw](https://github.com/fastclaw-ai/weclaw) only to perform the QR login and create a dedicated bot credential:

```bash
go install github.com/fastclaw-ai/weclaw@latest
weclaw login
```

Do not run `weclaw start` for the same bot. WeClaw and this listener both consume the iLink long-poll cursor, so running them together can make one process miss a command.

Find the newly created credential under `~/.weclaw/accounts/`. If more than one account exists, require the user to choose the intended dedicated bot. Start secure binding:

```bash
node scripts/insight/delivery/wechat_ilink_delivery.mjs setup \
  --credentials /absolute/path/to/account.json
```

While `setup` is waiting, send the exact text `绑定素材助手` from the user's phone to that dedicated bot. The helper creates the sync cursor when needed, accepts only that exact binding text, requires one unique sender, pins the sender fingerprint, saves the fresh context, and refuses to overwrite an existing delivery config.

Verify the saved context without sending a message:

```bash
node scripts/insight/delivery/wechat_ilink_delivery.mjs preflight
```

Install the macOS background listener after choosing the stable private history path used by the daily automation:

```bash
mkdir -p "$HOME/Documents/x-post2image"
scripts/insight/delivery/wechat_ilink_listener_service.sh install \
  --history "$HOME/Documents/x-post2image/history.jsonl"

scripts/insight/delivery/wechat_ilink_listener_service.sh status
```

The installer performs a zero-message preflight, writes a private per-user `launchd` plist, starts it immediately, and keeps it running across login. It stores only absolute program, config, history, and log paths in the plist; it never stores credentials, tokens, a recipient ID, or message content there.

To remove the service while keeping private credentials and logs:

```bash
scripts/insight/delivery/wechat_ilink_listener_service.sh uninstall
```

For an already managed account, advanced manual pinning remains available:

```bash
node scripts/insight/delivery/wechat_ilink_delivery.mjs configure \
  --credentials /absolute/path/to/account.json \
  --sync /absolute/path/to/account.sync.json \
  --recipient 'fixed-user-id@im.wechat'
```

If preflight exits with code `23`, ask the pinned user to send one character to the dedicated robot, run `capture-context`, and repeat preflight. Do not start a batch with missing, empty, mismatched, or rejected context. Context refresh requires an inbound user message; never imitate one, use another recipient, or fall back to context-free sending.

Prepare a private manifest outside the public deliverable folder:

```json
{
  "run_id": "2026-07-23-top-5",
  "pairs": [
    {
      "image": "/absolute/path/to/final-card.png",
      "caption": "独立配文。\\n\\n#标签一 #标签二 #标签三",
      "sha256": "expected-final-png-sha256"
    }
  ]
}
```

Deliver:

```bash
node scripts/insight/delivery/wechat_ilink_delivery.mjs deliver \
  --manifest /absolute/path/to/private-delivery-manifest.json
```

The helper validates 1–5 final PNGs and their hashes, preflights context before the first upload, sends image then caption, and checkpoints every accepted message. Stable client IDs make a resumed attempt reuse the same message identity; an accepted image is never intentionally resent when only its caption remains. Stop immediately on the first error. Never convert a rejected image, send a file attachment, or retry blindly.

`TRANSPORT_ACCEPTED` means iLink accepted every image and caption. Ask the user to confirm that the complete set is visible before recording `DELIVERED_FOR_REVIEW`.

The macOS service label is `com.x-post2image.wechat-listener`. Inspect it without sending:

```bash
scripts/insight/delivery/wechat_ilink_listener_service.sh status
```

## File Transfer Assistant fallback

1. Confirm that WeChat is already signed in. Never quit, restart, log out, switch accounts, or choose `仅传输文件`.
2. Run `scripts/insight/delivery/wechat_main_window_delivery.sh --dry-run`. Do not open a detached `文件传输助手` window.
3. The helper requires exactly one visible File Transfer Assistant row, a verified green selected state, high-confidence OCR of the cropped chat header, two consecutive matching frames, and the same frontmost WeChat window before every send. Physical mouse or keyboard input during verification aborts.
4. Obtain any required just-in-time computer-control confirmation.
5. Send each final PNG as an image, followed immediately by its matching plain-text caption. Never send a TXT file.
6. Stop without sending when any destination, header, preview, pasted text, foreground-window, or emptied-input check fails. Do not guess or use unverified coordinates.

Deliver one verified pair:

```bash
scripts/insight/delivery/wechat_main_window_delivery.sh \
  --image /absolute/path/to/card.png \
  --caption-file /absolute/path/to/caption.txt
```

Never open a Xiaohongshu, Douyin, or other publishing page during private delivery.

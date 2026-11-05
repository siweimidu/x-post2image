# Scheduling and resumable daily runs

`scripts/insight/daily.mjs` is the deterministic daily task. It expects a
candidate file that already contains `score_detail`, `translation` and `caption`
(usually produced by `verify.mjs` plus the agent's scoring/caption pass):

```bash
node scripts/insight/daily.mjs \
  --input candidates.json \
  --history ~/Documents/x-post2image/history.jsonl \
  --out-dir ~/Documents/x-post2image/2026-11-05 \
  --scheduled-for 2026-11-05T12:00:00+08:00 \
  --timezone Asia/Shanghai
```

It writes `ranked.json`, renders each selected post with the Pillow insight
renderer, runs `qa.mjs`, writes `pack.json`, and appends `selected` and
`run_completion` records to the history JSONL. A lock file prevents overlapping
runs, and an existing completion with intact images makes a re-run a no-op.

## Scheduled execution

Use the host's scheduler, not a long-running skill process:

- **Windows Task Scheduler**: action `node.exe`, arguments
  `scripts/insight/daily.mjs --input ... --history ... --out-dir ...`,
  trigger daily at 12:00, "Run task as soon as possible after a scheduled start
  is missed" enabled.
- **macOS launchd**: `StartCalendarInterval` at 12:00 with `RunAtLoad`; the
  script itself handles the catch-up decision.
- **Linux cron**: `0 12 * * * cd /path/to/skill && node scripts/insight/daily.mjs ...`

If the scheduled time has passed and no matching `run_completion` exists,
`daily.mjs` runs immediately with `catch_up: true` when the scheduler starts it.
If the scheduled time has not arrived, it exits without doing work.

## State model

`DISCOVERED → VERIFIED → SCORED → CAPTURED → TRANSLATED → READY_FOR_REVIEW
[→ TRANSPORT_ACCEPTED → DELIVERED_FOR_REVIEW]`

Unusable candidates end in `REJECTED`; rendering failures end in `FAILED` with a
reason. Private delivery is separate from publishing; the default stops at
`READY_FOR_REVIEW`.

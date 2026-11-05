# Discovery workflow (X search → candidate URLs)

The skill does not ship an authenticated X search scraper: X's keyword search is
gated and changes frequently. Discovery is an agent/browser step; the CLI takes
the resulting URLs and does the deterministic verification.

## 1. Build search queries

```bash
node scripts/insight/search-queries.mjs --topic "habits" --hours 24 --min-faves 100 --lang en
```

It prints three ready-to-open X search URLs (latest / top / media), for example:

```
https://x.com/search?q=habits%20since%3A2026-11-04%20until%3A2026-11-05%20min_faves%3A100%20lang%3Aen&f=live
```

Recommended topic families for creator content: wealth, money, life, goals,
systems, habits, attention, freedom, purpose, long-term thinking.

## 2. Collect URLs

Use a browser/search tool with a logged-in or public X session, open the search
URL, and collect status URLs into `urls.json`:

```json
[
  "https://x.com/JamesClear/status/2045205241885323635",
  "https://x.com/another/status/1234567890"
]
```

If the agent has `agent-reach` or another X reader, it can use that; the skill
only requires the final list of canonical post URLs.

## 3. Verify and normalize

```bash
node scripts/insight/verify.mjs \
  --input urls.json \
  --output candidates.json \
  --translate zh-CN
```

This fetches each post through the same public sources as the renderer, records
author/handle/avatar/exact text/date/views, optionally translates the body, and
writes one candidate object per URL. Failed URLs are reported in `errors`.

## 4. Discovery ladder

1. Search the last 24 hours.
2. If fewer than 5 candidates score at least 75, expand to 72 hours.
3. If still short, use unused evergreen posts from the topic list.
4. Return fewer than 5 rather than lowering the quality bar.

## Exclusions

Reject: political controversy/rage bait, stock tips, medical advice, course
sales, unattributed reposts, pure motivational filler, and content whose URL or
normalized text hash is already in `history.jsonl`.

---
name: x-post2image
description: Use when the user wants an X/Twitter post turned into an image — "tweet screenshot", "save this tweet as a PNG", "把推文做成图片/截图/长图/卡片", "post card for a slide", "archive this X post", "translate this tweet / 翻译这条推文" — or needs a source-audited content pipeline that discovers, verifies, scores, deduplicates, translates, typesets, captions and privately delivers X posts. Renders any public x.com / twitter.com status URL into a high-resolution PNG, with automatic two-page spread layout for long posts, through one self-contained Node CLI; includes an optional Pillow insight-card pipeline with adaptive bilingual layout and WeChat review delivery.
license: MIT
metadata:
  version: "2.1.0"
  upstream: "https://github.com/Yunshiro/x-post2image"
  upstream_insight: "https://github.com/ljunnan24-hash/x-insight-cards"
  compatibility: "Node.js >= 18; Chrome/Chromium or Playwright; Python 3.10+ + Pillow for insight rendering"
---

# x-post2image

Turn a public X/Twitter post into a clean, high-resolution PNG that looks like X's own post card — no Chrome extension, no X login, no browser-window screenshot.

**Core principle:** fetch the post's public JSON, render an X-style HTML card locally, and screenshot only that card. The output is deterministic and retina-sharp (1200 px wide by default), and any agent that can run a command can use it.

## Quick start

Run from this skill's directory (or use the absolute path to the script):

```bash
node scripts/x-post2image.mjs "https://x.com/jack/status/20" --out jack.png
```

Success prints a line like `✓ jack.png 1200×326 syndication+fxtwitter` and exits 0. The PNG is ready to attach, paste into a slide, or archive.

If the script lives elsewhere, substitute its full path:

```bash
node "/path/to/x-post2image/scripts/x-post2image.mjs" "<url>" --out "<output.png>"
```

## Agent workflow

1. **Resolve the input.** Accept a full `x.com` / `twitter.com` status URL, a `mobile.twitter.com` URL, a `t.co` short link, or a bare numeric status id.
2. **Choose a theme.** `dark` is the default and matches X's dark mode. Use `light` for documents and white slide decks, `dim` for X's dim-blue theme.
3. **Translate when asked.** If the user says "翻译 / translate" without naming a language, use `--translate zh-CN`. Add `--bilingual` when they want to see the original too.
4. **Run the CLI with `--json`.** Parse the JSON result instead of guessing the output path. Always write the PNG into the user's working directory (`--out ./out/card.png`), not into the installed skill folder — installed skills are often read-only.
5. **Verify before claiming success.** Check that the returned `out` file exists and has non-zero `width`/`height`. If the command failed, read `failures[].error` and follow the troubleshooting section — do not fabricate a result.
6. **Present the image.** Link or attach the PNG path. You may quote `author.name`, `text`, and the pixel size from the JSON, but never invent post content or metrics.

Minimal JSON-producing call:

```bash
node scripts/x-post2image.mjs "https://x.com/jack/status/20" --out jack.png --json
```

The result contains `ok`, `id`, `url`, `author`, `text`, `metrics`, `theme`, `translation`, `out`, `width`, `height`, `engine`, `source`, and `bytes`.

## Common tasks

| Task | Command |
|---|---|
| Dark card, default size | `node scripts/x-post2image.mjs <url> --out card.png` |
| Light card for a document | `node scripts/x-post2image.mjs <url> --out card.png --theme light` |
| Render by bare status id | `node scripts/x-post2image.mjs 440322224407314432 --out card.png` |
| Edit counts for a mockup | `node scripts/x-post2image.mjs <url> --likes 12K --reposts 3.4K --views 2.4M` |
| Chinese date/number formatting | `node scripts/x-post2image.mjs <url> --lang zh-CN` |
| Translate the post to Chinese | `node scripts/x-post2image.mjs <url> --translate zh-CN` |
| Show translation + original | `node scripts/x-post2image.mjs <url> --translate zh-CN --bilingual` |
| Smaller card, 1× pixels | `node scripts/x-post2image.mjs <url> --width 500 --scale 1` |
| Rounded card on transparent background | `node scripts/x-post2image.mjs <url> --frame card --transparent` |
| Long post → two-page spread | `node scripts/x-post2image.mjs <url> --layout spread --out long.png` |
| Force single page | `node scripts/x-post2image.mjs <url> --layout single` |
| Batch several posts | `node scripts/x-post2image.mjs <url1> <url2> --out-dir out/` |
| HTML only (no PNG) | `node scripts/x-post2image.mjs <url> --html-only --html card.html` |
| Check the machine | `node scripts/x-post2image.mjs --doctor` |

## Long posts: two-page spread

When a post reaches `--long-threshold` characters (default 360), `--layout auto` switches from the normal single X card to a **two-page article spread** (1080 px wide) modeled on the supplied reference: a white paper card on a grey desk, left editorial page and right excerpt page, optional metrics table and callout. The spread uses the real author avatar (no initials placeholder when a real avatar is obtainable), a small X mark, a subtle page seam, an X-style action row, and a source/date footer. It is rendered by the deterministic Pillow renderer (`scripts/insight/render_long_card.py`), with text wrapped to stay inside the card.

Use `--layout spread` to force it on a shorter post, `--layout single` to force the normal card, and `--long-height`/`--title`/`--subtitle` to control the spread. `--html-only` is not supported for spread cards.

## Two modes

1. **Native card renderer** (`scripts/x-post2image.mjs`): one post → one X-native PNG. Best for a single tweet, media-rich posts, themes, metrics editing, batch rendering or HTML output.
2. **Insight content pipeline** (`scripts/insight.mjs`): a creator workflow modeled on x-insight-cards — discover candidates, verify sources, score, deduplicate against history, translate, render an adaptive bilingual white card, write captions, QA and optionally deliver a private review pack to WeChat.

## Insight pipeline

The insight renderer is a deterministic Pillow layout, not a browser screenshot. It enforces a real author avatar, 1200 px card width, adaptive bilingual mode (when estimated bilingual height ≤ 1200 px) or translation-only mode with a `译自英文原帖` label. Chinese text uses native Simplified Chinese punctuation and CJK line-breaking rules. Fonts can be overridden with `XIC_LATIN_FONT`, `XIC_CJK_FONT`, `XIC_LATIN_BOLD_FONT` and their `_INDEX` variables.

Prerequisites: Python 3.10+ with Pillow:

```bash
python -m pip install -r requirements.txt
```

If your Python executable is `python3`, add `--python python3` to render/daily commands. On Linux, install a CJK font (`fonts-noto-cjk`) or set `XIC_CJK_FONT`/`XIC_CJK_INDEX` to a local font.

Typical flow:

```bash
# Single post → one adaptive insight card (no scoring needed)
node scripts/insight.mjs single "https://x.com/jack/status/20" \
  --out insight.png --translate zh-CN

# 1. Print X search URLs for a topic; open them with a browser/search tool
node scripts/insight.mjs search --topic "habits" --hours 24 --min-faves 100

# 2. Put the collected status URLs in urls.json, then verify + translate
node scripts/insight.mjs verify \
  --input urls.json --output candidates.json --translate zh-CN

# 3. The agent fills score_detail (0-30/20/20/15/10/5) and a 1-2 sentence caption
#    in candidates.json. Then rank with 75-point threshold and URL/text-hash dedupe:
node scripts/insight.mjs rank \
  --input candidates.json --history history.jsonl --output ranked.json

# 4. Render, QA and build a caption+PNG pack
node scripts/insight.mjs render --input ranked.json --out-dir out --render-mode auto
node scripts/insight.mjs qa --input ranked.json --out-dir out --output out/qa.json
node scripts/insight.mjs pack --input ranked.json --out-dir out --output out/pack.json

# 5. Full daily cycle (rank → render → QA → pack → history)
node scripts/insight.mjs daily \
  --input candidates.json --history history.jsonl --out-dir out \
  --scheduled-for 2026-11-05T12:00:00+08:00
```

The scoring rubric is 100 points: insight gain 30, clarity 20, Chinese social fit 20, source credibility 15, freshness 10, visual readability 5. Anything below 75 is rejected; never pad to five. History deduplicates by canonical URL and normalized text SHA-256.

Discovery is an agent/browser step: X keyword search is not exposed as a reliable public API. `search-queries.mjs` builds the search URLs; `verify.mjs` does the deterministic URL/author/avatar/text/date/views verification.

See `references/insight-discovery.md`, `insight-caption.md`, `insight-scheduling.md`, `insight-qa.md`, `insight-typography.md`, `insight-scoring.md` and `insight-candidate-schema.md`.

### WeChat private review delivery

`scripts/insight/delivery/` contains the optional iLink bot delivery and listener (headless, pinned recipient, checkpointed, exact command `发今日素材`) plus the macOS File Transfer Assistant fallback. It never publishes to Douyin/Xiaohongshu; the default stops at `READY_FOR_REVIEW`. See `references/private-delivery.md`. This is a private review transport, not a social-platform publisher.

## Options

| Option | Meaning | Default |
|---|---|---|
| `-o, --out <file>` | Output PNG path (single post) | `x-post-<id>.png` |
| `--out-dir <dir>` | Directory for batch output | current directory |
| `-t, --theme <name>` | `light` / `dim` / `dark` | `dark` |
| `-l, --lang <code>` | Locale for dates and counts | the post's language |
| `-w, --width <px>` | Card width in CSS pixels | `600` |
| `-s, --scale <n>` | Pixel density (2 = retina) | `2` |
| `--frame <none\|card>` | Rounded 1 px card frame | `none` |
| `--radius <px>` | Corner radius; implies a card frame | — |
| `--bg <color>` | Card background colour | theme colour |
| `--page-bg <color>` | Background outside the card | card colour |
| `--transparent` | Transparent page background | off |
| `--no-media` | Omit photos, videos and quoted post | off |
| `--no-metrics` | Hide date, views and action bar | off |
| `--no-avatar` | Hide the author avatar | off |
| `--no-webfont` | Skip X's Chirp webfont (fast offline renders) | auto |
| `--layout <name>` | `auto` / `single` / `spread` | `auto` |
| `--long-threshold <n>` | Character count that triggers spread | `360` |
| `--long-height <px>` | Spread height; auto if omitted | 640/760/900 |
| `--title <text>` / `--subtitle <text>` | Spread headings | derived from post |
| `--python <bin>` | Python with Pillow for spread | `python` |
| `--css <file>` | Append custom CSS | — |
| `--translate <lang>` | Translate body, quote and poll text into `lang` (`auto` = `--lang` or zh-CN) | off |
| `--bilingual` | Show the original text under the translation | off |
| `--translation-provider <name>` | `auto` / `mymemory` / `google` | `auto` |
| `--replies <n>` | Override reply count (accepts `1.2K`, `3万`) | real value |
| `--reposts <n>` | Override repost count | real value |
| `--likes <n>` | Override like count | real value |
| `--views <n>` | Override view count | real value |
| `--html <file>` | Also save the intermediate HTML | — |
| `--html-only` | Write HTML without rendering a PNG | off |
| `--data <file\|->` | Render from saved JSON instead of fetching | — |
| `--engine <name>` | `auto` / `playwright` / `chrome` | `auto` |
| `--chrome <path>` | Explicit Chrome/Chromium binary | auto-detected |
| `--timeout <ms>` | Per-step timeout | `60000` |
| `--no-cache` | Disable the tweet JSON cache | off |
| `--offline` | Use cached JSON only | off |
| `--json` | Machine-readable result on stdout | off |
| `--verbose` | Extra diagnostics on stderr | off |

Run `--help` for the complete list.

## How it works

1. **Data.** The CLI requests the public X syndication endpoint and `api.fxtwitter.com` in parallel, then merges the results. Syndication supplies the official author/media/text shape; fxTwitter supplies repost counts, view counts and quote/poll details. Either source alone is enough; the cache is used if both are unreachable.
2. **Media.** Avatars and photos are downloaded as data URLs before rendering (direct first, then the `wsrv.nl` image proxy for `pbs.twimg.com` hosts), so the final screenshot does not depend on the browser reaching X's CDN. Images are cached under `~/.cache/x-post2image/media/`.
3. **Translate (optional).** `--translate` calls MyMemory (then Google as a fallback), protects URLs/mentions/hashtags with placeholders, and adds a "Translated from …" note. The result is cached so the same card can be re-rendered offline.
4. **Render.** `scripts/lib/render.mjs` builds a self-contained HTML card using X's dark/dim/light colour tokens, Chirp webfonts from `abs.twimg.com` (system-font fallback if offline), X-style inline SVG icons, media grids, quote cards and polls.
5. **Screenshot.** `scripts/lib/screenshot.mjs` uses Playwright if it is importable; otherwise it drives a local Chrome/Chromium in headless mode with a two-pass measure-then-capture flow. No npm dependencies are required for the default path.

The upstream project is a Chrome MV3 extension that clones the live tweet DOM inside the page. This skill keeps the same visual concept but moves the work into a portable CLI so agents on any host can use it. See `references/upstream-notes.md` for the mapping.

## Network and offline

A first render of a new post needs internet access: the tweet JSON comes from public APIs, avatars/photos from X's image CDN, and translation from a translation service. The CLI caches all three under `~/.cache/x-post2image/`.

After one successful render, `--offline` re-renders from cache: tweet JSON, embedded media, and translation results. Cards whose media was cached render fully; text-only cards always do. Missing cached media is omitted, and Chirp falls back to the system font.

If X's image CDN is blocked (common on mainland China networks), the CLI automatically tries `wsrv.nl` as an image proxy. If that also fails, the card still renders but omits those images.

## Failure handling

| Symptom | Action |
|---|---|
| `No browser found` | Install Chrome/Chromium, or run `npm install playwright && npx playwright install chromium`, then retry with `--engine playwright`. |
| Both data sources fail | Retry once with `--verbose`. If it still fails, save JSON from `https://api.fxtwitter.com/<user>/status/<id>` and pass it with `--data file.json`. Do not invent a card. |
| `This post is unavailable` | The post is deleted, protected, age-restricted or withheld. Report that to the user. |
| Translation fails | Retry with `--translation-provider mymemory`, or with network/proxy access. Do not show the original as if it were translated. |
| Text or images look wrong | Check `--theme`, `--lang`, and whether the post is a video (the card uses its poster frame). |
| Need to reproduce later | Keep the `--data` JSON or the `--html` output. |

Start with `node scripts/x-post2image.mjs --doctor` whenever the environment is unknown.

## Boundaries and ethics

- **Public posts only.** Protected accounts need authentication, which this skill intentionally does not handle.
- **Rendering, not a live screenshot.** It is a faithful re-creation of X's card style; X may change its fonts or layout later.
- **Video and GIF** render as their poster frame with a play badge; audio and animation are not captured.
- **Machine translation is approximate.** The card shows a "Translated from …" note; check names, legal terms and quoted speech before publishing.
- **Edited metrics are mockup data.** Only override counts when the user explicitly asks; say in the reply that the numbers were edited. Never present edited numbers as real engagement data.
- **Copyright stays with the author.** Keep the author attribution visible. Do not use the output to impersonate, deceive, or strip attribution.
- Not affiliated with X Corp. The upstream project is MIT-licensed; see `NOTICE.md`.

## Files

| Path | Purpose |
|---|---|
| `scripts/x-post2image.mjs` | CLI entry point |
| `scripts/long.mjs` | Long-post two-page spread builder/renderer |
| `scripts/lib/tweet.mjs` | URL parsing, fetching, normalization, cache |
| `scripts/lib/render.mjs` | X-style HTML/CSS card renderer |
| `scripts/lib/screenshot.mjs` | Playwright/Chrome screenshot engines |
| `scripts/lib/media.mjs` | Avatar/photo download, proxy fallback and cache |
| `scripts/lib/translate.mjs` | MyMemory/Google translation and cache |
| `scripts/lib/format.mjs` | X-style compact numbers and dates |
| `scripts/insight.mjs` | Insight pipeline router (search/verify/rank/render/qa/pack/daily/history) |
| `scripts/insight/render_long_card.py` | Journal/article two-page spread renderer |
| `scripts/insight/render_card.py` | Adaptive bilingual insight-card renderer |
| `scripts/insight/` | Candidate verification, scoring, Pillow renderer, QA, history, scheduling |
| `scripts/insight/delivery/` | Optional WeChat iLink / File Transfer Assistant delivery |
| `references/insight-*.md` | Discovery, scoring, typography, caption, scheduling and QA rules |
| `references/private-delivery.md` | Private WeChat review delivery setup |
| `references/upstream-notes.md` | How this maps to the original extension |
| `references/data-sources.md` | JSON sources and normalized schema |
| `references/troubleshooting.md` | Deeper diagnostics |
| `test/` | Unit and end-to-end tests |

## Installing into an agent

Copy the whole `x-post2image/` folder into the host's skills directory:

- **Claude Code:** `~/.claude/skills/x-post2image/`
- **Codex, Gemini CLI, DSH, other Agent Skills hosts:** `~/.agents/skills/x-post2image/`
- **Project-local:** `<project>/.claude/skills/` or `<project>/.agents/skills/`

Or install with the bundled helper:

```bash
node scripts/install-skill.mjs --target ~/.agents/skills
```

The skill has no build step. Node.js 18+ and a Chrome/Chromium binary are the only runtime requirements for the native card renderer; Playwright is optional. The insight pipeline additionally requires Python 3.10+ with Pillow (`python -m pip install -r requirements.txt`).

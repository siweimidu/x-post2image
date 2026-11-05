# Troubleshooting

## First step: run the doctor

```bash
node scripts/x-post2image.mjs --doctor
```

It checks Node (>= 18), Chrome/Chromium, optional Playwright, the two JSON
sources, the Chirp font host, and the cache directory. `Result: ready` means the
render path should work.

## "No browser found"

The renderer needs one of:

1. **Local Chrome / Chromium / Edge** — install it and let auto-detection find it.
   - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
   - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Linux: `google-chrome`, `chromium`, or `chromium-browser` on `PATH`
2. **Playwright** — `npm install playwright && npx playwright install chromium`
   then add `--engine playwright`.
3. **Explicit binary** — `--chrome "C:\path\to\chrome.exe"`.

`CHROME_PATH` in the environment also works.

## "Could not measure the card" (Chrome CLI path)

This usually means Chrome could not run the inline measurement script. Try:

- `--engine playwright` (if available) — Playwright waits for fonts and images
  more reliably.
- Check that the HTML file is valid: rerun with `--html out.html` and open it in
  Chrome.
- On a locked-down machine, Chrome may need `--no-sandbox`; the skill does not
  pass that by default for safety. If your environment requires it, use
  Playwright instead.

## APIs fail

`--verbose` prints the underlying HTTP error for each source.

- HTTP 404 / tombstone: the post is deleted, protected, age-restricted, or
  withheld. Report it; do not fabricate a card.
- Timeout / connection reset: retry once. If it persists, open
  `https://api.fxtwitter.com/<user>/status/<id>` in a browser, save the JSON,
  and render with `--data tweet.json`.
- Corporate proxy: set `HTTPS_PROXY` / `HTTP_PROXY`; Node's fetch honours them in
  current versions. If not, use a saved JSON file.

## Text is clipped or a line looks wrong

- Increase width: `--width 700`.
- Use `--lang zh-CN` for Chinese number formatting (万/亿) and dates.
- Very tall images are cropped to X's 510 px media height by design; use
  `--no-media` and link the original post if the full image matters.
- Long unbroken URLs wrap because the card uses `overflow-wrap:anywhere`.

## Translation fails

`--translate zh-CN` tries MyMemory first and Google second. Common causes:

- **MyMemory quota**: the free tier is small. Wait, use `--translation-provider
  google` if Google is reachable, or pre-translate the text and pass a normalized
  JSON through `--data`.
- **Both providers blocked**: mainland networks can reach MyMemory but not
  Google; other networks may be the reverse. Check with `--doctor`, which probes
  both.
- **Offline**: translation is served from `~/.cache/x-post2image/translations/`.
  If the exact text + target language was never translated, `--offline` fails on
  purpose instead of silently showing the original.

## Images blank when pbs.twimg.com is blocked

The renderer downloads images in Node and embeds them as data URLs. For Twitter
image hosts it tries `https://wsrv.nl/?url=...` first. If both the direct host and
the proxy are unreachable, the card still renders but omits those images (an
avatar falls back to an initial). Try again later, use a VPN/proxy, or render
text-only with `--no-media`.

## Fonts

Chirp is loaded from `https://abs.twimg.com/fonts/v2/`. If the host is blocked,
the card falls back to the system UI font; layout still works. The `--doctor`
output shows whether the font host is reachable. No local font installation is
required.

## Transparent background

`--transparent` requires a renderer that supports alpha. The Chrome CLI path
passes `--default-background-color=00000000`; Playwright uses `omitBackground`.
Use `--frame card` to round the card itself. Some image viewers show transparency
as white — verify the alpha channel if it matters.

## Batch behaviour

- Multiple positional URLs + `--out-dir <dir>` works.
- `--out` and `--html` are single-post-only; use `--out-dir` and per-post defaults
  for batches.
- One failed post does not abort the rest; the exit code is 1 if any failed.

## Node version

Node 18+ is required for global `fetch`. Check with `node --version`. If you use
an older Node, install a current LTS or run via a project that provides one.

## Still stuck

Collect:

```bash
node scripts/x-post2image.mjs --doctor --json
node scripts/x-post2image.mjs "<url>" --verbose --keep --html debug.html
```

The `--keep` flag preserves the temporary HTML/profile directory printed in the
error output. The HTML file alone is usually enough to see whether the problem is
data or rendering.

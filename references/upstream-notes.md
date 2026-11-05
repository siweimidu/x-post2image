# Upstream notes: x-post2image extension → Agent Skill

Upstream: <https://github.com/Yunshiro/x-post2image> (MIT)

## What the original extension does

| Piece | Upstream file | Behaviour |
|---|---|---|
| Share-menu injection | `src/content/share-menu.ts` | Watches X's share menu, prepends "Copy as screenshot", remembers the tweet article that owns the menu. |
| Tweet lookup | `src/content/x-dom.ts` | Finds `article[data-testid="tweet"]`, the share button, the menu, "show more" and status id. |
| Clone and clean | `src/content/clone-tweet.ts` | Clones the article, removes share/caret/Grok controls and third-party velocity badges, sets the background colour. |
| Media inlining | `src/content/media.ts` | Asks the background worker to fetch images as data URLs so `html-to-image` can rasterize without CORS failures. |
| Rasterize | `src/content/capture.ts` | `html-to-image` `toBlob` at `pixelRatio: 2`, copies to clipboard or downloads. |
| Metrics | `src/content/metrics.ts` | Reads reply/repost/like/view counts from the action bar and analytics links; writes edits back into the clone. |
| Theme | `src/content/theme.ts` | Samples the page background and picks light/dim/dark. |
| i18n | `src/content/i18n.ts` | English + Chinese labels. |

The extension is excellent at preserving the exact current X rendering because it
copies the live DOM. Its cost is that it only works inside a logged-in Chrome
with the extension loaded and a human clicking the share menu.

## What this skill changes

| Concern | Extension | This skill |
|---|---|---|
| Trigger | Human clicks share menu | Any agent runs a CLI |
| Input | Currently open tweet | URL / status id / saved JSON |
| Data | Live DOM | Public syndication + fxTwitter JSON |
| Render | Clone real DOM, `html-to-image` | Re-create card in HTML/CSS, screenshot the card |
| Login | Needs an X session | Not required for public posts |
| Output | Clipboard / download | PNG file + optional HTML |
| Themes | Sampled from page | Explicit `--theme` |
| Metrics | Read + edit in the clone | Real values by default, optional CLI overrides |

The visual language is deliberately kept: same dark/dim/light tokens, 40 px avatar,
15 px author line, 17 px body text, 16 px media radius, and reply/repost/like/
bookmark/share action row.

## Original design tokens reused

From `src/content.css`:

- Dark: text `#e7e9ea`, muted `#71767b`, card `#16181c`, line `#2f3336`, accent `#1d9bf0`
- Dim: text `#f7f9f9`, muted `#8b98a5`, card `#192734`, line `#38444d`, input `#15202b`
- Light: text `#0f1419`, muted `#536471`, card `#ffffff`, line `#eff3f4`

The skill uses `#000000` as dark card background (X's current web dark theme) and
`#15202b` as dim card background; the upstream dialog tokens are tuned for the
extension's modal surface, not the tweet card itself.

## Useful selectors (if you ever add a live-DOM mode)

```js
article[data-testid="tweet"]
article[itemtype="https://schema.org/SocialMediaPosting"]
[data-testid="share"]
[role="menu"], [data-testid="Dropdown"], [data-slot="xds-menu-content"]
[data-testid="tweet-text-show-more-link"]
[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]
a[href*="/analytics"], a[href*="/retweets"], a[href*="/likes"]
```

X changes its DOM periodically. The extension's selector list is the best
starting point if a future version adds an optional "capture live page" mode.

## Translation is new in this skill

The upstream extension never translated posts. This skill adds `--translate`
because agents can call a translation API more reliably than they can click
X's own "Translate post" menu item (which depends on X's session, locale and
undocumented GraphQL behavior). The card carries an explicit "Translated from …"
line so a translated rendering is never mistaken for the original text.


# Data sources and normalized schema

The skill uses two public JSON sources in parallel and merges them. No API key is
required. Both are best-effort community/public endpoints; if X or the community
service changes, the other source can still produce a card.

## 1. X syndication (official public embed endpoint)

```
GET https://cdn.syndication.twimg.com/tweet-result?id=<status_id>&lang=<lang>&token=<token>
```

`token` is derived from the status id the same way X's embed widget does:

```js
const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
```

Useful fields:

- `text`, `display_text_range`, `entities.urls`
- `created_at`, `lang`, `id_str`
- `user.name`, `user.screen_name`, `user.profile_image_url_https`, `user.is_blue_verified`
- `conversation_count` → replies
- `favorite_count` → likes
- `mediaDetails[]` / `photos[]` → `media_url_https`, `original_info.width/height`, `type`
- `quoted_tweet` → nested tweet object

The endpoint does not reliably expose repost counts, view counts, or polls, which
is why the skill also asks fxTwitter.

## 2. fxTwitter (community API)

```
GET https://api.fxtwitter.com/<screen_name>/status/<status_id>
GET https://api.fxtwitter.com/i/status/<status_id>
```

Useful fields:

- `tweet.text`, `tweet.lang`, `tweet.created_timestamp`, `tweet.created_at`
- `tweet.author.name`, `screen_name`, `avatar_url`, `verification.verified`
- `tweet.replies`, `retweets`, `likes`, `views`, `quotes`, `bookmarks`
- `tweet.media.all[]` → `type`, `url`, `thumbnail_url`, `width`, `height`, `altText`
- `tweet.quote` → nested tweet object
- `tweet.poll` → options / votes
- `tweet.replying_to`, `possibly_sensitive`

fxTwitter is independent of X Corp. Treat it as a convenience mirror, not as an
authoritative source. If it is down, syndication still yields a usable card
(without reposts/views).

## Normalized schema

`scripts/lib/tweet.mjs` produces one shape regardless of source:

```json
{
  "__normalized": true,
  "id": "20",
  "url": "https://x.com/jack/status/20",
  "text": "just setting up my twttr",
  "lang": "en",
  "createdAt": "2006-03-21T20:50:14.000Z",
  "author": {
    "name": "jack",
    "screenName": "jack",
    "avatarUrl": "https://pbs.twimg.com/profile_images/..._400x400.jpg",
    "verified": true,
    "protected": false
  },
  "metrics": {
    "replies": 19000,
    "reposts": 126000,
    "likes": 322000,
    "views": null,
    "quotes": null,
    "bookmarks": null
  },
  "media": [
    {
      "type": "photo",
      "url": "https://pbs.twimg.com/media/....jpg",
      "videoUrl": null,
      "width": 1920,
      "height": 1080,
      "alt": ""
    }
  ],
  "quote": null,
  "poll": null,
  "replyingTo": null,
  "possiblySensitive": false,
  "_meta": { "source": "syndication+fxtwitter", "fetchedAt": "..." }
}
```

`type` is one of `photo`, `video`, `gif`. For video/gif, `url` is the poster
image and `videoUrl` is the playable media URL (not downloaded by this skill).

## Cache

Merged results are cached as JSON at `~/.cache/x-post2image/<id>.json` (override
with `--cache-dir`, disable with `--no-cache`). `--offline` reads only the cache.
This makes repeated renders and offline re-renders reproducible.

## Using saved JSON

Any of these is accepted by `--data`:

1. A normalized object (above, with `__normalized: true`)
2. A raw fxTwitter response (`{ "tweet": { ... } }`)
3. A raw syndication tweet-result (`{ "__typename": "Tweet", ... }`)

`--data -` reads from stdin. This is the recommended fallback when an API is
temporarily unavailable or when a post must be rendered identically later.

## Media embedding and cache

Avatars, photos and video posters are downloaded before the browser screenshot
and converted to `data:` URLs. The fetch order is:

1. direct URL (for non-Twitter hosts);
2. `https://wsrv.nl/?url=<encoded>` for `pbs.twimg.com` / `video.twimg.com` /
   `ton.twitter.com` hosts;
3. if both fail, the image is omitted (an avatar falls back to an initial).

Bytes are cached under `~/.cache/x-post2image/media/` as `<hash>.bin` +
`<hash>.json`. `--offline` uses this cache and drops media that was never cached.
This is also why `--html-only` output is self-contained for previously rendered
posts.

## Translation sources

`--translate <lang>` uses:

1. **MyMemory** — `https://api.mymemory.translated.net/get?q=...&langpair=en|zh-CN`
   (no key, 500-byte query limit, chunked automatically).
2. **Google Translate gtx** — `https://translate.googleapis.com/translate_a/single`
   (no key, used as fallback when reachable).

URLs, `@mentions` and `#hashtags` are replaced with `X2ITOKEN<n>X` placeholders
before translation and restored afterwards. The result is cached under
`~/.cache/x-post2image/translations/`. Machine translation is approximate; the
card always carries a "Translated from …" note when the text changed.

If both providers are blocked, the CLI fails with a clear error instead of
silently returning the original text. Use `--data` with pre-translated `text`
if you need a manual/LLM translation.

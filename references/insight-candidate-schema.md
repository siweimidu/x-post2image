# Candidate data schema

`score_candidates.py` accepts either a JSON array or `{ "candidates": [...] }`.

Required fields:

```json
{
  "id": "candidate-01",
  "url": "https://x.com/example/status/123",
  "author": "Example Author",
  "handle": "@example",
  "avatar_url": "https://pbs.twimg.com/profile_images/.../avatar_200x200.jpg",
  "post": "Exact English text",
  "translation": "忠实的中文翻译",
  "score_detail": {
    "insight_gain": 27,
    "clarity": 18,
    "chinese_social_fit": 18,
    "source_credibility": 13,
    "freshness": 9,
    "visual_readability": 5
  }
}
```

Avatar requirement:

- `avatar_url`: Verified HTTPS X profile-image URL, normally hosted on `pbs.twimg.com`; required unless `avatar` supplies a verified local copy of the same real profile image.
- `avatar`: Verified local author-avatar path. This is an alternative to `avatar_url`, not a placeholder mechanism.
- Initials, generated portraits, generic icons, and silent avatar omission are invalid.

Optional fields:

- `published_at`: ISO 8601 timestamp.
- `date_display`: Human-readable date for the card.
- `views_display`: Human-readable view count.
- `caption`: One or two Chinese sentences plus hashtags.
- `flags`: Array of exclusion flags.
- `render_method`: `native-screenshot` or `rearranged-render`.
- `render_mode`: `auto` (default), `bilingual`, or `translation-only`. Daily runs must use `auto`; explicit modes are for controlled regeneration and tests.
- `bilingual_max_height`: Positive pixel threshold for `auto`; defaults to `1200` on the fixed 1200 px-wide card.

Renderer output metadata includes `content_mode`, `source_text_visible`, `bilingual_height_estimate`, and `bilingual_max_height`; persist these in private history.

History is JSONL. The scorer reads `url` or `source_url` and `text_sha256` or `source_text_sha256` for deduplication.

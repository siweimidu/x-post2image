# Review-ready checklist

## Source

- URL resolves to the intended post.
- Author, handle, English text, and date are verified.
- Views are accurate when displayed.
- URL and normalized text hash are not already in history.

## Content

- Score is at least 75 and component scores are recorded.
- No politics, stock tips, medical advice, funnels, unattributed reposts, or empty motivation.
- Translation preserves meaning, paragraphs, quotes, dashes, parentheses, and tone.
- Caption is one or two sentences, does not copy the translation, and has 3–5 tags.

## Image

- Card contains the verified real author avatar, name, handle, date, optional views, and the display-mode-specific body: bilingual when the estimated bilingual height is at most 1200 px; `译自英文原帖` plus Chinese only when it exceeds 1200 px.
- Initials, generated portraits, generic placeholders, broken images, and an avatar belonging to a different account all fail review.
- In bilingual mode, English is unchanged and Chinese matches its visual level. In translation-only mode, no English body remains and Chinese uses the same established X-style body metrics rather than smaller type.
- `content_mode`, `bilingual_height_estimate`, and the 1200 px threshold are recorded and agree with the rendered card.
- Chinese punctuation uses native Simplified Chinese horizontal forms.
- No punctuation fallback, manual corner forcing, clipping, stretching, or orphaned final characters.
- No poster background, title, rating, commentary, hashtags, or AI decoration inside the card.

## Safety

- No credentials, cookies, tokens, private paths, or private logs appear in public outputs, history records, or model-visible diagnostics. Keep the local delivery config, context cache, checkpoint, and absolute-path manifest private.
- Reconstructed cards are labeled `rearranged-render` in the private record.
- Output reaches `READY_FOR_REVIEW` before any private delivery.
- A robot delivery manifest is private, uses absolute paths plus final PNG hashes, and never contains credentials, tokens, or an editable recipient.
- Robot context preflight succeeds before the first media upload; a context failure produces zero material messages.
- A background listener triggers only on exact text from the pinned recipient, journals before advancing the sync cursor, and refuses to resend a date with an existing private receipt.
- When private delivery is configured, the pinned destination and every checkpoint follow `private-delivery.md`; otherwise the run stops at `READY_FOR_REVIEW`.
- Record `DELIVERED_FOR_REVIEW` only after transport acceptance and user confirmation that the complete set is visible.

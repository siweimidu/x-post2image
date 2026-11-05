# NOTICE

This skill is an agent-oriented derivative of **x-post2image** by Yunshiro:

- Upstream: https://github.com/Yunshiro/x-post2image
- Upstream license: MIT (Copyright (c) 2026 x-post2image contributors)

The upstream project is a Chrome MV3 extension that inserts a "Copy as screenshot"
item into X's share menu, clones the live tweet DOM, and rasterizes it with
`html-to-image`.

This skill is a new implementation: it fetches public post JSON, re-creates the
card in local HTML/CSS, and screenshots it with headless Chrome or Playwright.
The compact-number formatting rules and the four editable metrics
(replies / reposts / likes / views) are intentionally modelled on the upstream
extension. The upstream MIT license and copyright notice are reproduced in
`LICENSE`.

## Additional upstream: x-insight-cards

The optional insight pipeline (candidate verification, 100-point scoring,
deduplication/history, adaptive bilingual Pillow renderer, CJK typography rules,
daily state machine and WeChat iLink delivery) is adapted from **x-insight-cards**
by ljunnan24-hash:

- Upstream: https://github.com/ljunnan24-hash/x-insight-cards
- Upstream license: MIT (see the upstream repository's LICENSE)
- Adapted files: `scripts/insight/render_card.py`, `scripts/insight/score_candidates.py`,
  `scripts/insight/delivery/*`, and the `references/insight-*.md` /
  `references/private-delivery.md` documents.

The adaptation renames the tool identity to x-post2image, adds a Node CLI/wrapper
layer, and keeps the upstream safety rules: public read-only sources, pinned
private recipient only, and no automatic publishing.

Not affiliated with X Corp. "X" and "Twitter" are trademarks of their respective
owners. Post text and media remain the property of their authors.

The Chirp font files are loaded at render time from `abs.twimg.com` and are not
redistributed with this skill; if the host is unreachable the renderer falls back
to the system UI font.

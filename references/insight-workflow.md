# Daily curation workflow

## Scheduled-run recovery

The daily schedule is a target time, not permission to silently skip a day. On every local login and after network connectivity becomes available, a lightweight OS-level checker must inspect the Shanghai calendar date and the private history/output paths. It must not depend on the Codex desktop app being opened.

- If the scheduled time has not arrived, exit without running curation.
- If a matching `run_completion` with `selection_count > 0` and its final `READY_FOR_REVIEW` PNG assets exist, exit without running again.
- If the scheduled time has passed and either condition is missing, start one serialized catch-up run immediately. Prevent overlapping runs with a lock.
- Record `scheduled_for`, `actual_run_at`, and a `catch_up` object explaining why the run started late in the final `run_completion` record.
- Retry only when the public network check succeeds. Never turn a network failure into a fabricated completion.
- A catch-up run follows the same source, deduplication, scoring, rendering, QA, and output rules as an on-time run. It prepares materials only: it must not open WeChat, send a message, upload, draft, or publish.

On macOS, use a per-user `launchd` agent with `RunAtLoad` and a short `StartInterval` for the checker. Other operating systems should use an equivalent per-user service or scheduler.

## Discovery ladder

1. Search the last 24 hours.
2. If fewer than five verified candidates score at least 75, expand to 72 hours.
3. If still short, use unused evergreen posts.
4. Return fewer than five rather than lowering the quality bar.

Recommended topics: wealth, money, life, dreams, goals, systems, habits, attention, freedom, purpose, and long-term thinking.

## Source verification

For every candidate, record:

- Canonical post URL.
- Author display name and handle.
- Verified real author profile avatar URL from X or an equally authoritative public representation.
- Exact English text and paragraph structure.
- Published date/time and source timezone when available.
- View count only when it affects ranking or is shown on the card.
- Capture method: `native-screenshot` or `rearranged-render`.

The avatar must be the author's real current profile image. Do not replace it with initials, generated art, or a generic placeholder. If the avatar cannot be verified or loaded, retry an authoritative public source or reject/fail the candidate instead of marking the card review-ready.

Use the native X page when available. Public oEmbed or another public read-only representation is an acceptable fallback. Never present a reconstructed card as a native screenshot.

## Exclusions

Reject:

- Political controversy or rage bait.
- Financial/stock recommendations.
- Medical or therapeutic advice.
- Course sales, funnels, or disguised promotion.
- Reposts without a traceable original source.
- Pure emotional encouragement with no transferable idea.
- Content already present in history by URL or text hash.

## Translation

- Preserve meaning, stance, paragraph breaks, quotation marks, dashes, parentheses, and rhetorical tone.
- Prefer natural Simplified Chinese over literal word order.
- Keep author names and product names accurate.
- Do not add interpretation inside the translation.

## English-source display mode

- Use deterministic layout, not AI image generation, for reconstructed cards.
- At a fixed 1200 px card width, calculate the height the complete bilingual card would require before drawing it.
- If the estimated bilingual height is at most 1200 px, render the verified English source followed by `翻译自英语` and the Chinese translation.
- If the estimate exceeds 1200 px, omit the English body and render only `译自英文原帖` plus the faithful Chinese translation. Keep the real avatar, author, handle, date, and optional views.
- Do not reduce the established body size, weight, or line height merely to stay under the threshold.
- Record `content_mode`, `bilingual_height_estimate`, and `bilingual_max_height` in private history. The source URL, exact English text, and text hash remain auditable even when the English body is not displayed.

## Caption

- Prefer one sentence; allow two only when needed.
- Restate the insight more simply or add one tightly related angle.
- Do not copy or line-by-line summarize the card translation.
- Add 3–5 useful hashtags on a new line.
- Avoid promises of reach, income, or guaranteed outcomes.

## State model

Use this monotonic state model when logging a run:

`DISCOVERED → VERIFIED → SCORED → CAPTURED → TRANSLATED → READY_FOR_REVIEW [→ TRANSPORT_ACCEPTED → DELIVERED_FOR_REVIEW]`

Send unusable candidates to `REJECTED`; rendering failures go to `FAILED` with a reason.
`TRANSPORT_ACCEPTED` means the private transport accepted every image and caption. `DELIVERED_FOR_REVIEW` is optional and requires user confirmation that the complete pack is visible in the pinned private review chat. Neither state means uploaded, drafted, or published on a content platform.

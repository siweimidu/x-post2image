# Chinese typography rules

## Visual hierarchy

- Preserve the English post's existing font, size, weight, line height, and color. English is the fixed visual reference.
- Match Chinese to the English text's perceived face size, stroke darkness, line height, and color. Never change English to accommodate Chinese.
- When a long English post uses translation-only mode, retain the same Chinese face size, stroke darkness, and line height that its bilingual translation would use; do not shrink it to preserve the English body.
- A shared nominal point size does not prove a visual match. Inspect rendered ink at 200%.
- For regular X-style text on macOS, prefer PingFang SC Regular. Avoid a visibly lighter or heavier substitute.

## Simplified Chinese punctuation

For Mainland Simplified Chinese horizontal layout:

- Use native full-width Chinese punctuation.
- Pause/stop marks such as `、，；：。？！` sit toward the lower-left of their character frame.
- Quotation marks, parentheses, and book-title marks keep their paired native forms.
- Em dashes and ellipses are centered in the character face and span the appropriate width.
- Do not force all punctuation to one corner with per-character offsets.
- Do not allow punctuation glyphs to fall back to a different font.

## Line breaking

- Break on meaning, not equal character counts.
- Do not begin a line with closing punctuation.
- Do not end a line with an opening quote or bracket.
- Avoid leaving one or two isolated characters on the final line.
- Preserve intentional blank lines and paragraph structure.

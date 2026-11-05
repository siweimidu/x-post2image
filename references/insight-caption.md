# Caption generation

The caption is written by the agent (the same model that reads the post), not by
a fixed template. The CLI validates it before a pack can become
`READY_FOR_REVIEW`.

## Prompt contract

Given the verified post, its faithful Chinese translation, and the platform
(Douyin or Xiaohongshu), write:

- one Chinese sentence; allow two only when the idea needs a second clause;
- restate the insight more simply, or add one tightly related angle;
- do not copy or line-by-line summarize the card translation;
- end with 3–5 relevant hashtags on a new line;
- no promises of reach, income, or guaranteed outcomes.

Return only the caption text, then pass it to the candidate object:

```json
{
  "caption": "把目标变成系统，比把目标喊得更大声更有用。\n\n#个人成长 #习惯 #长期主义"
}
```

## Validation

```bash
node scripts/insight/qa.mjs --input ranked.json --out-dir out --output qa.json
```

`qa.mjs` rejects captions with zero or more than two sentences, fewer than three
or more than five hashtags, or more than 220 characters.

#!/usr/bin/env python3
"""Validate, deduplicate, rank, and select scored X post candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


SCORE_LIMITS = {
    "insight_gain": 30,
    "clarity": 20,
    "chinese_social_fit": 20,
    "source_credibility": 15,
    "freshness": 10,
    "visual_readability": 5,
}
DISALLOWED_FLAGS = {
    "politics",
    "stock_tip",
    "medical_advice",
    "course_sales",
    "unattributed_repost",
    "empty_motivation",
    "unverified",
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).casefold()


def text_hash(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def load_json(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict):
        data = data.get("candidates", [])
    if not isinstance(data, list):
        raise ValueError("Input must be a JSON array or an object with a candidates array")
    return data


def load_history(path: Path | None) -> tuple[set[str], set[str]]:
    urls: set[str] = set()
    hashes: set[str] = set()
    if not path or not path.exists():
        return urls, hashes
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        url = record.get("url") or record.get("source_url")
        digest = record.get("text_sha256") or record.get("source_text_sha256")
        if url:
            urls.add(str(url))
        if digest:
            hashes.add(str(digest))
    return urls, hashes


def validate_score(detail: dict) -> tuple[int, list[str]]:
    errors: list[str] = []
    total = 0
    for key, maximum in SCORE_LIMITS.items():
        value = detail.get(key)
        if not isinstance(value, int) or not 0 <= value <= maximum:
            errors.append(f"{key} must be an integer from 0 to {maximum}")
        else:
            total += value
    return total, errors


def rank_candidates(
    candidates: list[dict],
    history_urls: set[str],
    history_hashes: set[str],
    minimum: int,
    limit: int,
) -> dict:
    accepted: list[dict] = []
    rejected: list[dict] = []
    seen_urls = set(history_urls)
    seen_hashes = set(history_hashes)

    for candidate in candidates:
        identifier = str(candidate.get("id", "unknown"))
        url = str(candidate.get("url", "")).strip()
        post = str(candidate.get("post", "")).strip()
        reasons: list[str] = []
        if not url:
            reasons.append("missing_url")
        if not post:
            reasons.append("missing_post")
        if not str(candidate.get("avatar", "")).strip() and not str(
            candidate.get("avatar_url", "")
        ).strip():
            reasons.append("missing_avatar")
        digest = text_hash(post) if post else ""
        if url in seen_urls:
            reasons.append("duplicate_url")
        if digest and digest in seen_hashes:
            reasons.append("duplicate_text")
        flags = set(candidate.get("flags", []))
        reasons.extend(sorted(flags & DISALLOWED_FLAGS))
        total, score_errors = validate_score(candidate.get("score_detail", {}))
        reasons.extend(score_errors)
        if not score_errors and total < minimum:
            reasons.append(f"score_below_{minimum}")
        if reasons:
            rejected.append({"id": identifier, "url": url, "reasons": reasons})
            continue
        enriched = dict(candidate)
        enriched["score"] = total
        enriched["text_sha256"] = digest
        accepted.append(enriched)
        seen_urls.add(url)
        seen_hashes.add(digest)

    accepted.sort(
        key=lambda item: (
            item["score"],
            item["score_detail"]["insight_gain"],
            item["score_detail"]["source_credibility"],
            item["score_detail"]["freshness"],
        ),
        reverse=True,
    )
    selected = accepted[:limit]
    for candidate in accepted[limit:]:
        rejected.append(
            {"id": candidate.get("id", "unknown"), "url": candidate["url"], "reasons": ["below_top_limit"]}
        )
    return {
        "selected": selected,
        "rejected": rejected,
        "selection_count": len(selected),
        "minimum_score": minimum,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--minimum", type=int, default=75)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    history_urls, history_hashes = load_history(args.history)
    result = rank_candidates(load_json(args.input), history_urls, history_hashes, args.minimum, args.limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selection_count": result["selection_count"]}))


if __name__ == "__main__":
    main()

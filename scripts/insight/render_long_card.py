#!/usr/bin/env python3
"""Render a long X post as a two-page article spread (1080x720 by default).

The design is deliberately a document/article card rather than a tweet
screenshot: a white paper card on a grey desk, a left editorial page and a
right excerpt page with optional table. It is used automatically when a post is
long enough for the normal single-page card to become unreadable.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from render_card import find_fonts, load_font, rebalance_cjk, wrap_words


PAPER = (255, 255, 255)
DESK = (255, 255, 255)
INK = (15, 20, 25)
MUTED = (83, 100, 113)
LINE = (239, 243, 244)
TABLE_HEAD = (247, 249, 249)
TABLE_BORDER = (207, 217, 222)


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def wrap_cjk_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    """Wrap Chinese by character but keep Latin words and product names intact."""
    if not has_cjk(text):
        return wrap_words(draw, text, font, max_width)
    tokens: list[str] = []
    last = 0
    for match in re.finditer(r"[A-Za-z0-9@#&%+._-]+|[\u3400-\u9fff]|[^\s]", text):
        gap = text[last : match.start()]
        if gap and not gap.strip() and tokens and not tokens[-1].isspace():
            tokens.append(" ")
        tokens.append(match.group())
        last = match.end()
    lines: list[str] = []
    current = ""
    for token in tokens:
        candidate = current + token
        if not current or draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current.rstrip())
            current = "" if token == " " else token
    if current.strip():
        lines.append(current.rstrip())
    return rebalance_cjk([line for line in lines if line.strip()])


def cjk_bold(cjk_spec: tuple[str, int]) -> tuple[str, int]:
    path, index = cjk_spec
    env = os.environ.get("XIC_CJK_BOLD_FONT")
    if env and Path(env).exists():
        return env, int(os.environ.get("XIC_CJK_BOLD_INDEX", "0"))
    lower = path.lower()
    if lower.endswith("msyh.ttc"):
        bold = path[:-8] + "msyhbd.ttc"
        if Path(bold).exists():
            return bold, index
    if lower.endswith("notosanscjk-regular.ttc"):
        bold = path.replace("Regular", "Bold")
        if Path(bold).exists():
            return bold, index
    return cjk_spec


def draw_blocks(
    draw: ImageDraw.ImageDraw,
    blocks: list[dict],
    *,
    x: int,
    y: int,
    width: int,
    body_font,
    heading_font,
    bold_font,
    line_height: int,
    bottom: int,
    scale: int,
) -> int:
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        kind = block.get("type", "paragraph")
        if kind == "spacer":
            y += int(block.get("height", 12) * scale)
            continue
        text = str(block.get("text", "")).strip()
        if kind == "heading":
            if y + 28 * scale > bottom:
                break
            y += int(8 * scale)
            lines = wrap_cjk_text(draw, text, heading_font, width)
            for line in lines:
                draw.text((x, y), line, font=heading_font, fill=INK)
                y += int(27 * scale)
                if y > bottom:
                    return y
            y += int(4 * scale)
            continue
        if kind == "table":
            y = draw_table(draw, block, x, y, width, body_font, bold_font, scale, bottom)
            continue
        if kind == "callout":
            y = draw_callout(draw, block, x, y, width, body_font, heading_font, scale, bottom)
            continue
        if not text:
            continue
        lines = wrap_cjk_text(draw, text, body_font, width)
        for line in lines:
            if y + line_height > bottom:
                return y
            draw.text((x, y), line, font=body_font, fill=INK)
            y += line_height
        y += int(9 * scale)
    return y


def draw_callout(
    draw: ImageDraw.ImageDraw,
    block: dict,
    x: int,
    y: int,
    width: int,
    body_font,
    heading_font,
    scale: int,
    bottom: int,
) -> int:
    heading = str(block.get("heading", "")).strip()
    text = str(block.get("text", "")).strip()
    pad = int(16 * scale)
    inner_width = width - pad * 2
    heading_lines = wrap_cjk_text(draw, heading, heading_font, inner_width) if heading else []
    body_lines = wrap_cjk_text(draw, text, body_font, inner_width) if text else []
    height = pad * 2 + len(heading_lines) * int(26 * scale) + len(body_lines) * int(28 * scale) + int(6 * scale)
    if y + height > bottom:
        return y
    draw.rounded_rectangle((x, y, x + width, y + height), radius=int(12 * scale), fill=(247, 249, 252), outline=TABLE_BORDER, width=max(1, int(scale)))
    draw.rectangle((x, y + int(10 * scale), x + int(3 * scale), y + height - int(10 * scale)), fill=(29, 155, 240))
    cy = y + pad
    for line in heading_lines:
        draw.text((x + pad, cy), line, font=heading_font, fill=INK)
        cy += int(26 * scale)
    for line in body_lines:
        draw.text((x + pad, cy), line, font=body_font, fill=INK)
        cy += int(28 * scale)
    return y + height + int(10 * scale)


def draw_table(
    draw: ImageDraw.ImageDraw,
    block: dict,
    x: int,
    y: int,
    width: int,
    body_font,
    bold_font,
    scale: int,
    bottom: int,
) -> int:
    headers = [str(value) for value in block.get("headers", [])]
    rows = block.get("rows", [])
    if not headers or not rows:
        return y
    col_widths = block.get("col_widths")
    if not isinstance(col_widths, list) or len(col_widths) != len(headers):
        col_widths = [width // len(headers)] * len(headers)
        col_widths[-1] = width - sum(col_widths[:-1])
    else:
        total = sum(col_widths)
        col_widths = [int(width * value / total) for value in col_widths]
        col_widths[-1] = width - sum(col_widths[:-1])
    header_h = int(42 * scale)
    row_h = int(42 * scale)
    if y + header_h + row_h > bottom:
        return y
    # Header
    draw.rectangle((x, y, x + width, y + header_h), fill=TABLE_HEAD, outline=TABLE_BORDER)
    cx = x
    for index, header in enumerate(headers):
        draw.rectangle((cx, y, cx + col_widths[index], y + header_h), outline=TABLE_BORDER)
        lines = wrap_cjk_text(draw, header, bold_font, col_widths[index] - int(20 * scale))
        ty = y + (header_h - len(lines) * int(22 * scale)) // 2
        for line in lines[:1]:
            draw.text((cx + int(10 * scale), ty), line, font=bold_font, fill=INK)
        cx += col_widths[index]
    y += header_h
    for row in rows:
        if y + row_h > bottom:
            break
        cx = x
        for index, value in enumerate(list(row)[: len(headers)]):
            draw.rectangle((cx, y, cx + col_widths[index], y + row_h), outline=TABLE_BORDER)
            lines = wrap_cjk_text(draw, str(value), body_font, col_widths[index] - int(20 * scale))
            ty = y + (row_h - len(lines) * int(22 * scale)) // 2
            for line in lines[:1]:
                draw.text((cx + int(10 * scale), ty), line, font=body_font, fill=INK)
            cx += col_widths[index]
        y += row_h
    return y + int(8 * scale)


def avatar_image(avatar_path: str | None, name: str, size: int, bold_font, scale: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    if avatar_path and Path(avatar_path).exists():
        source = Image.open(avatar_path).convert("RGB")
        from PIL import ImageOps
        source = ImageOps.fit(source, (size, size), method=Image.Resampling.LANCZOS)
        output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        output.paste(source, (0, 0), mask)
        return output
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(output)
    draw.ellipse((0, 0, size - 1, size - 1), fill=(120, 155, 220))
    initial = (name.strip()[:1] or "?").upper()
    bbox = draw.textbbox((0, 0), initial, font=bold_font)
    draw.text(
        ((size - (bbox[2] - bbox[0])) / 2, (size - (bbox[3] - bbox[1])) / 2 - 2 * scale),
        initial,
        font=bold_font,
        fill=(255, 255, 255),
    )
    return output


def draw_verified_badge(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    """Small X-style blue verified mark."""
    draw.ellipse((x, y, x + size, y + size), fill=(29, 155, 240))
    draw.line(
        (x + size * 0.28, y + size * 0.52, x + size * 0.44, y + size * 0.68),
        fill=(255, 255, 255),
        width=max(2, size // 7),
    )
    draw.line(
        (x + size * 0.44, y + size * 0.68, x + size * 0.74, y + size * 0.32),
        fill=(255, 255, 255),
        width=max(2, size // 7),
    )


def draw_more_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, scale: int) -> None:
    radius = max(1, int(2 * scale))
    for offset in (0, int(size * 0.36), int(size * 0.72)):
        draw.ellipse((x + offset, y, x + offset + radius * 2, y + radius * 2), fill=MUTED)


def compact_count(value) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return ""
    if number <= 0:
        return ""
    if number >= 100000000:
        return f"{number / 100000000:.1f}".rstrip("0").rstrip(".") + "亿"
    if number >= 10000:
        return f"{number / 10000:.1f}".rstrip("0").rstrip(".") + "万"
    return str(int(number))


def action_count(value) -> str:
    try:
        number = int(float(value or 0))
    except (TypeError, ValueError):
        return ""
    if number <= 0:
        return ""
    if number < 10000:
        return f"{number:,}"
    return compact_count(number)


def draw_action_icon(draw: ImageDraw.ImageDraw, kind: str, x: int, y: int, size: int, scale: int) -> None:
    width = max(1, int(1.6 * scale))
    if kind == "reply":
        draw.rounded_rectangle((x, y, x + int(size * 0.8), y + int(size * 0.62)), radius=int(3 * scale), outline=MUTED, width=width)
        draw.polygon([(x + int(size * 0.22), y + int(size * 0.62)), (x + int(size * 0.1), y + int(size * 0.9)), (x + int(size * 0.4), y + int(size * 0.62))], fill=MUTED)
    elif kind == "repost":
        draw.line((x + int(size * 0.18), y + int(size * 0.25), x + int(size * 0.8), y + int(size * 0.25)), fill=MUTED, width=width)
        draw.polygon([(x + int(size * 0.78), y + int(size * 0.25)), (x + int(size * 0.6), y + int(size * 0.1)), (x + int(size * 0.6), y + int(size * 0.4))], fill=MUTED)
        draw.line((x + int(size * 0.2), y + int(size * 0.75), x + int(size * 0.82), y + int(size * 0.75)), fill=MUTED, width=width)
        draw.polygon([(x + int(size * 0.22), y + int(size * 0.75)), (x + int(size * 0.4), y + int(size * 0.6)), (x + int(size * 0.4), y + int(size * 0.9))], fill=MUTED)
    elif kind == "like":
        points = [
            (x + size * 0.5, y + size * 0.9),
            (x + size * 0.12, y + size * 0.52),
            (x + size * 0.2, y + size * 0.18),
            (x + size * 0.5, y + size * 0.32),
            (x + size * 0.8, y + size * 0.18),
            (x + size * 0.88, y + size * 0.52),
        ]
        draw.polygon([(int(px), int(py)) for px, py in points], outline=MUTED, width=width)
    elif kind == "bookmark":
        draw.polygon([
            (x + int(size * 0.16), y + int(size * 0.1)),
            (x + int(size * 0.84), y + int(size * 0.1)),
            (x + int(size * 0.84), y + int(size * 0.9)),
            (x + int(size * 0.5), y + int(size * 0.65)),
            (x + int(size * 0.16), y + int(size * 0.9)),
        ], outline=MUTED, width=width)
    elif kind == "share":
        draw.line((x + int(size * 0.2), y + int(size * 0.85), x + int(size * 0.2), y + int(size * 0.7)), fill=MUTED, width=width)
        draw.line((x + int(size * 0.2), y + int(size * 0.7), x + int(size * 0.8), y + int(size * 0.2)), fill=MUTED, width=width)
        draw.polygon([(x + int(size * 0.8), y + int(size * 0.2)), (x + int(size * 0.55), y + int(size * 0.2)), (x + int(size * 0.8), y + int(size * 0.48))], fill=MUTED)


def draw_action_bar(
    draw: ImageDraw.ImageDraw,
    metrics: dict,
    x: int,
    y: int,
    width: int,
    scale: int,
    font,
    icon_font,
) -> None:
    items = [
        ("reply", action_count(metrics.get("replies"))),
        ("repost", action_count(metrics.get("reposts"))),
        ("like", action_count(metrics.get("likes"))),
        ("bookmark", action_count(metrics.get("bookmarks"))),
        ("share", ""),
    ]
    step = width / len(items)
    for index, (kind, count) in enumerate(items):
        ix = int(x + index * step)
        draw_action_icon(draw, kind, ix, y, int(16 * scale), scale)
        if count:
            draw.text((ix + int(19 * scale), y + int(2 * scale)), count, font=font, fill=MUTED)


def render_long_card(data: dict, output_path: Path, *, width: int = 1080, height: int = 720, scale: int = 1) -> dict:
    scale = max(1, min(3, int(scale)))
    W, H = width * scale, height * scale
    image = Image.new("RGB", (W, H), DESK)
    draw = ImageDraw.Draw(image)
    # X-style white canvas with a hairline page seam, not a paper mockup.
    draw.line((int(540 * scale), int(24 * scale), int(540 * scale), H - int(24 * scale)), fill=LINE, width=1)

    latin_regular, latin_bold, cjk_regular = find_fonts()
    cjk_bold_spec = cjk_bold(cjk_regular)
    body_size = int(data.get("body_size", 16) * scale)
    title_size = int(data.get("title_size", 25) * scale)
    heading_size = int(18 * scale)
    name_size = int(15 * scale)
    meta_size = int(15 * scale)
    body_font = load_font(cjk_regular, body_size)
    title_font = load_font(cjk_bold_spec, title_size)
    heading_font = load_font(cjk_bold_spec, heading_size)
    table_header_font = load_font(cjk_bold_spec, int(14 * scale))
    name_font = load_font(cjk_regular if has_cjk(str(data.get("author", ""))) else latin_bold, name_size)
    meta_font = load_font(cjk_regular, meta_size)
    line_height = int(27 * scale)
    action_font = load_font(cjk_regular, int(13 * scale))
    action_icon_font = load_font(latin_regular, int(18 * scale))

    left_x = int(48 * scale)
    left_width = int(464 * scale)
    right_x = int(562 * scale)
    right_width = int(464 * scale)

    # X tweet header: real avatar, name, verified badge, handle, more dots.
    avatar = avatar_image(data.get("avatar"), str(data.get("author", "")), int(40 * scale), name_font, scale)
    image.paste(avatar, (left_x, int(34 * scale)), avatar)
    draw.text((int(98 * scale), int(39 * scale)), str(data.get("author", "")), font=name_font, fill=INK)
    if data.get("verified"):
        draw_verified_badge(
            draw,
            int(98 * scale) + int(draw.textlength(str(data.get("author", "")), font=name_font)) + int(5 * scale),
            int(41 * scale),
            int(14 * scale),
        )
    draw.text(
        (int(98 * scale), int(60 * scale)),
        str(data.get("handle", "")),
        font=load_font(cjk_regular if has_cjk(str(data.get("handle", ""))) else latin_regular, int(14 * scale)),
        fill=MUTED,
    )
    draw_more_icon(draw, W - int(64 * scale), int(43 * scale), int(18 * scale), scale)

    # Left page title and subtitle.
    title = str(data.get("title", "")).strip()
    y = int(103 * scale)
    if title:
        title_lines = wrap_cjk_text(draw, title, title_font, left_width)
        for line in title_lines[:2]:
            draw.text((left_x, y), line, font=title_font, fill=INK)
            y += int(37 * scale)
        y += int(4 * scale)
    subtitle = str(data.get("subtitle", "")).strip()
    if subtitle:
        subtitle_font = load_font(cjk_regular if has_cjk(subtitle) else latin_regular, int(16 * scale))
        subtitle_lines = wrap_cjk_text(draw, subtitle, subtitle_font, left_width)
        for line in subtitle_lines[:3]:
            draw.text((left_x, y), line, font=subtitle_font, fill=MUTED)
            y += int(25 * scale)
        y += int(10 * scale)
    y = draw_blocks(
        draw,
        data.get("left_blocks", []),
        x=left_x,
        y=y,
        width=left_width,
        body_font=body_font,
        heading_font=heading_font,
        bold_font=table_header_font,
        line_height=line_height,
        bottom=int((height - 175) * scale),
        scale=scale,
    )

    # Right page.
    draw_blocks(
        draw,
        data.get("right_blocks", []),
        x=right_x,
        y=int(56 * scale),
        width=right_width,
        body_font=body_font,
        heading_font=heading_font,
        bold_font=table_header_font,
        line_height=line_height,
        bottom=int((height - 175) * scale),
        scale=scale,
    )

    # X-style meta line and action bar across the full card width.
    action_y = H - int(92 * scale)
    draw.line((left_x, action_y - int(28 * scale), W - int(48 * scale), action_y - int(28 * scale)), fill=LINE, width=1)
    meta_text = str(data.get("meta_text", "")).strip()
    if not meta_text:
        meta_text = "  ·  ".join(part for part in [str(data.get("date", "")).strip(), str(data.get("views_display", "")).strip()] if part)
    if meta_text:
        draw.text((left_x, action_y - int(25 * scale)), meta_text, font=meta_font, fill=MUTED)
    if data.get("show_actions", True):
        draw_action_bar(
            draw,
            data.get("metrics", {}),
            left_x,
            action_y,
            W - int(96 * scale),
            scale,
            action_font,
            action_icon_font,
        )

    # Tiny attribution footer, below the action row.
    footer_font = load_font(latin_regular, int(8 * scale))
    source = str(data.get("source", "")).strip()
    if source:
        draw.text((left_x, H - int(30 * scale)), source, font=footer_font, fill=(122, 132, 147))
    labels = data.get("bottom_right", [])
    if isinstance(labels, str):
        labels = [labels]
    for index, label in enumerate(labels[:2]):
        label_font = load_font(cjk_regular if has_cjk(str(label)) else latin_regular, int(8 * scale))
        draw.text(
            (W - int(48 * scale) - draw.textlength(str(label), font=label_font), H - int(42 * scale) + index * int(14 * scale)),
            str(label),
            font=label_font,
            fill=(122, 132, 147),
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return {
        "output": str(output_path),
        "width": W,
        "height": H,
        "layout": "two-page-spread",
        "title": title,
        "left_blocks": len(data.get("left_blocks", [])),
        "right_blocks": len(data.get("right_blocks", [])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Long-card JSON")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--scale", type=int, default=1)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8-sig"))
    print(json.dumps(render_long_card(data, args.output, width=args.width, height=args.height, scale=args.scale), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

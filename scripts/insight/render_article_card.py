#!/usr/bin/env python3
"""Render a long X post as a tall, X-official-style article card.

This is the default long-post layout: one white rounded card on the X grey
background, a large real-avatar header, X wordmark, body text with optional
fenced code blocks, and a date/timezone footer with an AI-translation label.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from render_long_card import avatar_image, draw_verified_badge, find_fonts, load_font, wrap_cjk_text


BG = (237, 240, 242)
PAPER = (255, 255, 255)
INK = (15, 20, 25)
MUTED = (83, 100, 113)
CODE_BG = (247, 248, 250)
CODE_MUTED = (102, 112, 125)
CODE_STRING = (42, 100, 170)
CODE_COMMENT = (120, 132, 145)
CODE_KEYWORD = (126, 70, 170)


def find_mono_font() -> tuple[str, int]:
    candidates = [
        (os.environ.get("XIC_MONO_FONT", ""), int(os.environ.get("XIC_MONO_INDEX", "0"))),
        ("C:/Windows/Fonts/consola.ttf", 0),
        ("C:/Windows/Fonts/CascadiaMono.ttf", 0),
        ("/System/Library/Fonts/SFNSMono.ttf", 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 0),
    ]
    for path, index in candidates:
        if path and Path(path).exists():
            return path, index
    # Fall back to the regular font rather than crash.
    return find_fonts()[0]


def draw_media(image: Image.Image, paths: list[str], x: int, y: int, width: int, scale: int) -> int:
    max_height = int(900 * scale)
    for file_path in paths:
        try:
            photo = Image.open(file_path).convert("RGB")
        except Exception:
            continue
        ratio = photo.width / max(1, photo.height)
        draw_width = width
        draw_height = int(draw_width / ratio)
        if draw_height > max_height:
            draw_height = max_height
            draw_width = int(draw_height * ratio)
        photo = photo.resize((draw_width, draw_height), Image.Resampling.LANCZOS)
        mask = Image.new("L", (draw_width, draw_height), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, draw_width, draw_height), radius=int(16 * scale), fill=255)
        image.paste(photo, (x, y), mask)
        y += draw_height + int(22 * scale)
    return y


def draw_x_logo(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    """Draw the official X wordmark path instead of a generic letter X."""
    def p(px: float, py: float) -> tuple[int, int]:
        return int(x + px * size / 24), int(y + py * size / 24)

    outer = [
        p(18.244, 2.25), p(21.552, 2.25), p(14.325, 10.51), p(22.827, 21.75),
        p(16.17, 21.75), p(10.956, 14.933), p(4.99, 21.75), p(1.68, 21.75),
        p(9.41, 12.915), p(1.254, 2.25), p(8.08, 2.25), p(12.793, 8.481),
    ]
    hole = [p(17.083, 19.77), p(18.916, 19.77), p(7.084, 4.126), p(5.117, 4.126)]
    draw.polygon(outer, fill=(15, 20, 25))
    draw.polygon(hole, fill=(255, 255, 255))


def split_segments(text: str) -> list[dict]:
    segments: list[dict] = []
    pattern = re.compile(r"```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```", re.MULTILINE)
    cursor = 0
    for match in pattern.finditer(text):
        if match.start() > cursor:
            segments.append({"type": "text", "text": text[cursor:match.start()]})
        segments.append({"type": "code", "language": match.group(1), "text": match.group(2).rstrip("\n")})
        cursor = match.end()
    if cursor < len(text):
        segments.append({"type": "text", "text": text[cursor:]})
    return [segment for segment in segments if segment.get("text", "").strip()]


def text_height(draw, text: str, font, width: int, line_height: int, paragraph_gap: int) -> int:
    paragraphs = text.split("\n")
    total = 0
    for index, paragraph in enumerate(paragraphs):
        if paragraph:
            total += len(wrap_cjk_text(draw, paragraph, font, width)) * line_height
        elif 0 < index < len(paragraphs) - 1:
            total += paragraph_gap
    return total


def draw_code_block(draw, code: str, x: int, y: int, width: int, font, scale: int) -> int:
    lines = code.split("\n")
    pad = int(20 * scale)
    line_height = int(26 * scale)
    block_height = pad * 2 + max(1, len(lines)) * line_height
    draw.rounded_rectangle((x, y, x + width, y + block_height), radius=int(12 * scale), fill=CODE_BG)
    cy = y + pad
    for line in lines:
        draw.text((x + pad, cy), line, font=font, fill=CODE_MUTED)
        cy += line_height
    return y + block_height


def draw_body(draw, segments: list[dict], x: int, y: int, width: int, *, body_font, code_font, line_height: int, code_line: int, scale: int) -> int:
    paragraph_gap = int(18 * scale)
    for segment in segments:
        if segment["type"] == "code":
            y += int(12 * scale)
            y = draw_code_block(draw, segment["text"], x, y, width, code_font, scale)
            y += int(18 * scale)
            continue
        text = segment["text"].strip("\n")
        paragraphs = text.split("\n")
        color = MUTED if segment.get("type") == "translation" else INK
        for index, paragraph in enumerate(paragraphs):
            if paragraph:
                for line in wrap_cjk_text(draw, paragraph, body_font, width):
                    draw.text((x, y), line, font=body_font, fill=color)
                    y += line_height
            elif 0 < index < len(paragraphs) - 1:
                y += paragraph_gap
        y += paragraph_gap
    return y


def render_article_card(data: dict, output_path: Path, *, width: int = 1080, scale: int = 1) -> dict:
    scale = max(1, min(3, int(scale)))
    W = width * scale
    margin = int(40 * scale)
    x = int(88 * scale)
    content_width = W - x * 2
    body_size = int(data.get("body_size", 34) * scale)
    line_height = int(data.get("line_height", 52) * scale)
    code_size = int(data.get("code_size", 16) * scale)
    code_line = int(data.get("code_line_height", 26) * scale)
    footer_h = int(110 * scale)
    body_y = int(210 * scale)

    latin_regular, latin_bold, cjk_regular = find_fonts()
    body_font = load_font(cjk_regular, body_size)
    name_font = load_font(cjk_regular if any("\u3400" <= char <= "\u9fff" for char in str(data.get("author", ""))) else latin_bold, int(32 * scale))
    handle_font = load_font(cjk_regular, int(24 * scale))
    date_font = load_font(cjk_regular, int(24 * scale))
    label_font = load_font(cjk_regular, int(20 * scale))
    brand_font = load_font(latin_bold, int(44 * scale))
    mono_spec = find_mono_font()
    code_font = load_font(mono_spec, code_size)

    segments = data.get("segments")
    if not segments:
        segments = split_segments(str(data.get("text", "")))
    media_paths = [str(item) for item in data.get("media", []) if item and Path(str(item)).exists()]
    scratch = ImageDraw.Draw(Image.new("RGB", (W, 2000), "white"))
    body_height = 0
    for segment in segments:
        if segment["type"] == "code":
            body_height += int(12 * scale) + int(20 * scale) * 2 + max(1, len(segment["text"].split("\n"))) * code_line + int(18 * scale)
        else:
            body_height += text_height(scratch, segment["text"].strip("\n"), body_font, content_width, line_height, int(18 * scale)) + int(18 * scale)
    media_height = 0
    for file_path in media_paths:
        try:
            probe = Image.open(file_path)
            ratio = probe.width / max(1, probe.height)
            media_height += int(content_width / ratio) + int(22 * scale)
        except Exception:
            pass
    H = max(int(600 * scale), body_y + body_height + media_height + footer_h + int(60 * scale))
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((margin, margin, W - margin, H - margin), radius=int(24 * scale), fill=PAPER)

    # Header
    avatar = avatar_image(data.get("avatar"), str(data.get("author", "")), int(80 * scale), name_font, scale)
    image.paste(avatar, (x, int(84 * scale)), avatar)
    name_x = int(188 * scale)
    draw.text((name_x, int(90 * scale)), str(data.get("author", "")), font=name_font, fill=INK)
    if data.get("verified"):
        draw_verified_badge(
            draw,
            name_x + int(draw.textlength(str(data.get("author", "")), font=name_font)) + int(8 * scale),
            int(94 * scale),
            int(24 * scale),
        )
    draw.text((name_x, int(136 * scale)), str(data.get("handle", "")), font=handle_font, fill=MUTED)
    draw_x_logo(draw, W - int(128 * scale), int(82 * scale), int(44 * scale))

    # Body
    y = draw_body(
        draw,
        segments,
        x,
        body_y,
        content_width,
        body_font=body_font,
        code_font=code_font,
        line_height=line_height,
        code_line=code_line,
        scale=scale,
    )
    if media_paths:
        y = draw_media(image, media_paths, x, y + int(4 * scale), content_width, scale)

    # Footer
    footer_y = H - int(88 * scale)
    date_text = str(data.get("date_display", "")).strip()
    if not date_text and data.get("date"):
        date_text = str(data["date"])
    date_bbox = draw.textbbox((0, 0), date_text, font=date_font)
    date_height = date_bbox[3] - date_bbox[1]
    center_y = footer_y + date_height / 2
    draw.text((x, center_y), date_text, font=date_font, fill=MUTED, anchor="lm")
    if data.get("timezone_label"):
        date_width = draw.textlength(date_text, font=date_font)
        pill_x = x + int(date_width) + int(18 * scale)
        timezone = str(data["timezone_label"])
        label_bbox = draw.textbbox((0, 0), timezone, font=label_font)
        label_height = label_bbox[3] - label_bbox[1]
        pill_w = int(draw.textlength(timezone, font=label_font)) + int(20 * scale)
        pill_top = center_y - label_height / 2 - int(4 * scale)
        pill_bottom = center_y + label_height / 2 + int(4 * scale)
        draw.rounded_rectangle((pill_x, pill_top, pill_x + pill_w, pill_bottom), radius=int(7 * scale), outline=(207, 217, 222), width=max(1, int(scale)))
        draw.text((pill_x + int(10 * scale), center_y), timezone, font=label_font, fill=MUTED, anchor="lm")
    label = str(data.get("translation_label", "AI 翻译")).strip()
    draw.text((W - x - draw.textlength(label, font=label_font), center_y), label, font=label_font, fill=MUTED, anchor="lm")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return {
        "output": str(output_path),
        "width": W,
        "height": H,
        "layout": "x-article-tall",
        "segments": len(segments),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--scale", type=int, default=1)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8-sig"))
    print(json.dumps(render_article_card(data, args.output, width=args.width, scale=args.scale), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

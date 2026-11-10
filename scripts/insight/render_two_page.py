#!/usr/bin/env python3
"""Render a long X post as two side-by-side X-official cards (the reference layout)."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from render_article_card import draw_x_logo, draw_verified_badge, find_fonts, load_font, wrap_cjk_text
from render_long_card import avatar_image


BG = (237, 240, 242)
PAPER = (255, 255, 255)
INK = (15, 20, 25)
MUTED = (83, 100, 113)
LINE = (239, 243, 244)


def split_text(text: str, ratio: float) -> tuple[str, str]:
    """Split whole paragraphs first, never in the middle of a sentence."""
    source = text.strip()
    if len(source) < 2:
        return source, ""
    target = max(1, int(len(source) * ratio))
    paragraphs = [part.strip() for part in source.split("\n\n") if part.strip()]
    if len(paragraphs) > 1:
        left: list[str] = []
        size = 0
        for paragraph in paragraphs:
            if left and size + len(paragraph) > target:
                break
            left.append(paragraph)
            size += len(paragraph) + 2
        if left and len(left) < len(paragraphs):
            return "\n\n".join(left), "\n\n".join(paragraphs[len(left):])
    # One giant paragraph: split at sentence boundaries near the target.
    cut = target
    for punct in "。！？.!?":
        candidate = source.rfind(punct, 0, target)
        if candidate > cut * 0.45:
            cut = candidate + 1
            break
    return source[:cut].strip(), source[cut:].strip()


def wrap_paragraphs(draw, text: str, font, width: int, line_height: int) -> tuple[list[str], int]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if paragraph.strip():
            lines.extend(wrap_cjk_text(draw, paragraph, font, width))
        else:
            lines.append("")
    return lines, max(0, len(lines)) * line_height


def page_header(image, draw, data, x, y, width, scale):
    latin_regular, latin_bold, cjk_regular = find_fonts()
    name_font = load_font(cjk_regular if any("\u3400" <= char <= "\u9fff" for char in str(data.get("author", ""))) else latin_bold, int(16 * scale))
    handle_font = load_font(cjk_regular, int(14 * scale))
    avatar = avatar_image(data.get("avatar"), str(data.get("author", "")), int(40 * scale), name_font, scale)
    image.paste(avatar, (x + int(20 * scale), y), avatar)
    name_x = x + int(70 * scale)
    draw.text((name_x, y + int(2 * scale)), str(data.get("author", "")), font=name_font, fill=INK)
    if data.get("verified"):
        draw_verified_badge(draw, name_x + int(draw.textlength(str(data.get("author", "")), font=name_font)) + int(4 * scale), y + int(4 * scale), int(12 * scale))
    draw.text((name_x, y + int(22 * scale)), str(data.get("handle", "")), font=handle_font, fill=MUTED)
    draw_x_logo(draw, x + width - int(44 * scale), y + int(1 * scale), int(24 * scale))


def render_two_page(data: dict, output_path: Path, *, width: int = 1080, scale: int = 1) -> dict:
    scale = max(1, min(3, int(scale)))
    W = width * scale
    margin = int(24 * scale)
    gap = int(16 * scale)
    card_w = (W - margin * 2 - gap) // 2
    body_pad = int(20 * scale)
    body_x = margin + body_pad
    body_w = card_w - body_pad * 2
    header_h = int(96 * scale)
    footer_h = int(52 * scale)

    text = str(data.get("text", "")).strip()
    body_size = int(data.get("body_size", 17 if len(text) <= 700 else 15 if len(text) <= 1400 else 13) * scale)
    line_height = int(data.get("line_height", 27 if len(text) <= 700 else 24 if len(text) <= 1400 else 21) * scale)
    latin_regular, latin_bold, cjk_regular = find_fonts()
    body_font = load_font(cjk_regular, body_size)
    scratch = ImageDraw.Draw(Image.new("RGB", (W, 100), "white"))

    left_text, right_text = split_text(text, 0.35 if data.get("media") else 0.5)
    left_lines, left_h = wrap_paragraphs(scratch, left_text, body_font, body_w, line_height)
    right_lines, right_h = wrap_paragraphs(scratch, right_text, body_font, body_w, line_height)

    media_height = 0
    media_paths = [str(item) for item in data.get("media", []) if item and Path(str(item)).exists()]
    for file_path in media_paths:
        try:
            probe = Image.open(file_path)
            ratio = probe.width / max(1, probe.height)
            media_height += min(int(body_w / ratio), int(320 * scale)) + int(18 * scale)
        except Exception:
            pass

    page_h = max(int(420 * scale), header_h + max(left_h + media_height, right_h) + footer_h + int(30 * scale))
    image = Image.new("RGB", (W, page_h), BG)
    draw = ImageDraw.Draw(image)

    for page_index in range(2):
        px = margin + page_index * (card_w + gap)
        draw.rounded_rectangle((px, margin, px + card_w, page_h - margin), radius=int(16 * scale), fill=PAPER)
        page_header(image, draw, data, px, int(34 * scale), card_w, scale)
        lines = left_lines if page_index == 0 else right_lines
        y = int(104 * scale)
        for line in lines:
            if line:
                draw.text((body_x + page_index * (card_w + gap), y), line, font=body_font, fill=INK)
            y += line_height
        if page_index == 0 and media_paths:
            my = y + int(6 * scale)
            for file_path in media_paths:
                try:
                    photo = Image.open(file_path).convert("RGB")
                except Exception:
                    continue
                ratio = photo.width / max(1, photo.height)
                dw = body_w
                dh = int(dw / ratio)
                if dh > int(320 * scale):
                    dh = int(320 * scale)
                    dw = int(dh * ratio)
                photo = photo.resize((dw, dh), Image.Resampling.LANCZOS)
                mask = Image.new("L", (dw, dh), 0)
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, dw, dh), radius=int(10 * scale), fill=255)
                image.paste(photo, (body_x, my), mask)
                my += dh + int(16 * scale)
            label = str(data.get("media_label", "Video preview"))
            draw.text((body_x, min(page_h - margin - int(34 * scale), my + int(2 * scale))), label, font=load_font(latin_regular, int(9 * scale)), fill=(122, 132, 147))

    # Footer left page: date + timezone; right page: AI translation label.
    date_text = str(data.get("date_display", "")).strip()
    timezone = str(data.get("timezone_label", "")).strip()
    label = str(data.get("translation_label", "AI 翻译")).strip()
    date_font = load_font(cjk_regular, int(10 * scale))
    label_font = load_font(cjk_regular, int(10 * scale))
    foot_y = page_h - margin - int(34 * scale)
    draw.text((margin + body_pad, foot_y), date_text, font=date_font, fill=MUTED)
    if timezone:
        date_w = draw.textlength(date_text, font=date_font)
        pill_x = margin + body_pad + int(date_w) + int(12 * scale)
        pill_w = int(draw.textlength(timezone, font=label_font)) + int(14 * scale)
        draw.rounded_rectangle((pill_x, foot_y - int(3 * scale), pill_x + pill_w, foot_y + int(12 * scale)), radius=int(5 * scale), outline=(207, 217, 222), width=max(1, int(scale)))
        draw.text((pill_x + int(7 * scale), foot_y), timezone, font=label_font, fill=MUTED)
    draw.text((W - margin - body_pad - draw.textlength(label, font=label_font), foot_y), label, font=label_font, fill=MUTED)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return {"output": str(output_path), "width": W, "height": page_h, "layout": "two-page-x-cards", "left_lines": len(left_lines), "right_lines": len(right_lines)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--scale", type=int, default=1)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8-sig"))
    print(json.dumps(render_two_page(data, args.output, width=args.width, scale=args.scale), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

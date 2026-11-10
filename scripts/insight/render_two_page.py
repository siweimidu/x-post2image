#!/usr/bin/env python3
"""Render a long X post as 2-3 side-by-side X-official cards.

Reading order is left-to-right: the leftmost card is the first part of the
post, later parts continue to the right, and the rightmost card carries the
post's images/charts. The card height is capped at 687 px; when content no
longer fits two cards, the renderer grows horizontally to three cards.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from render_article_card import draw_verified_badge, draw_x_logo, find_fonts, load_font, wrap_cjk_text
from render_long_card import avatar_image

BG = (237, 240, 242)
PAPER = (255, 255, 255)
INK = (15, 20, 25)
MUTED = (83, 100, 113)
PAGE_MARGIN = 24
PAGE_GAP = 16
CARD_WIDTH = 508
PAGE_HEIGHT = 687
BODY_TOP = 104
FOOTER_TOP = PAGE_HEIGHT - PAGE_MARGIN - 34


def split_paragraphs(text: str, count: int, weights: list[float]) -> list[str]:
    """Return chunks in left-to-right reading order: first part first, later parts last."""
    source = text.strip()
    if count == 1:
        return [source]

    def tail_at_sentence(fraction: float) -> tuple[str, str]:
        target = max(1, int(len(source) * fraction))
        cut = max(1, len(source) - target)
        # Move the boundary to the next sentence/paragraph ending so no sentence is cut.
        for marker in ("\n\n", "。", "！", "？", ". ", "! ", "? "):
            found = source.find(marker, cut)
            if 0 <= found < cut + max(80, target // 3):
                cut = found + len(marker)
                break
        return source[:cut].strip(), source[cut:].strip()

    if count == 2:
        left_fraction = weights[-1] if weights else 0.4
        right, left = tail_at_sentence(left_fraction)
        return [right, left]
    # Three cards: left = first, middle = second, right = short later tail + media.
    left_fraction = weights[-1] if weights else 0.12
    right_and_middle, left = tail_at_sentence(left_fraction)
    middle_start = max(1, int(len(right_and_middle) * 0.5))
    cut = right_and_middle.find("\n\n", middle_start)
    if cut < 0:
        cut = middle_start
    right = right_and_middle[:cut].strip()
    middle = right_and_middle[cut:].strip()
    return [right, middle, left]


def measure(draw, text: str, font, width: int, line_height: int) -> int:
    lines = 0
    for paragraph in text.split("\n"):
        if paragraph.strip():
            lines += len(wrap_cjk_text(draw, paragraph, font, width))
        else:
            lines += 1
    return lines * line_height


def draw_text_lines(draw, text: str, font, x: int, y: int, width: int, line_height: int) -> int:
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            y += line_height
            continue
        for line in wrap_cjk_text(draw, paragraph, font, width):
            draw.text((x, y), line, font=font, fill=INK)
            y += line_height
    return y


def choose_layout(text: str, has_media: bool, body_width: int, body_height: int):
    scratch = ImageDraw.Draw(Image.new("RGB", (1080, 100), "white"))
    for pages in (2, 3):
        for body_size in (17, 16, 15, 14, 13, 12, 11):
            line_height = int(body_size * 1.55)
            font = load_font(find_fonts()[2], body_size)
            weights = [0.45, 0.45, 0.1] if pages == 3 else [0.6, 0.4]
            chunks = split_paragraphs(text, pages, weights)
            heights = [measure(scratch, chunk, font, body_width, line_height) for chunk in chunks]
            # rightmost page holds the last chunk and may carry media
            last_capacity = body_height - (300 if has_media else 0)
            if heights[-1] > last_capacity:
                continue
            if any(height > body_height for height in heights[:-1]):
                continue
            return pages, body_size, line_height, chunks, heights
    # Last resort: three pages at tiny text.
    return 3, 10, 16, split_paragraphs(text, 3, [0.45, 0.45, 0.1]), [0, 0, 0]


def render_two_page(data: dict, output_path: Path, *, width: int = 1080, scale: int = 1) -> dict:
    scale = max(1, min(3, int(scale)))
    # width is the reference two-page width; 3 pages expand horizontally.
    margin = int(PAGE_MARGIN * scale)
    gap = int(PAGE_GAP * scale)
    card_w = int(CARD_WIDTH * scale)
    page_h = int(PAGE_HEIGHT * scale)
    body_pad = int(20 * scale)
    body_w = card_w - body_pad * 2
    body_height = int((PAGE_HEIGHT - PAGE_MARGIN * 2 - 100 - 40) * scale)
    text = str(data.get("text", "")).strip()
    media_paths = [str(item) for item in data.get("media", []) if item and Path(str(item)).exists()]
    pages, body_size, line_height, chunks, heights = choose_layout(text, bool(media_paths), body_w, body_height)
    W = margin * 2 + pages * card_w + (pages - 1) * gap
    image = Image.new("RGB", (W, page_h), BG)
    draw = ImageDraw.Draw(image)
    latin_regular, latin_bold, cjk_regular = find_fonts()
    body_font = load_font(cjk_regular, body_size * scale)
    name_font = load_font(cjk_regular if any("\u3400" <= char <= "\u9fff" for char in str(data.get("author", ""))) else latin_bold, int(16 * scale))
    handle_font = load_font(cjk_regular, int(14 * scale))
    date_font = load_font(cjk_regular, int(10 * scale))

    # Content order is left-to-right; the last chunk sits on the right page.
    visual_chunks = chunks
    for page_index in range(pages):
        px = margin + page_index * (card_w + gap)
        draw.rounded_rectangle((px, margin, px + card_w, page_h - margin), radius=int(16 * scale), fill=PAPER)
        # Header on every page.
        avatar = avatar_image(data.get("avatar"), str(data.get("author", "")), int(40 * scale), name_font, scale)
        image.paste(avatar, (px + body_pad, int(34 * scale)), avatar)
        name_x = px + body_pad + int(50 * scale)
        draw.text((name_x, int(36 * scale)), str(data.get("author", "")), font=name_font, fill=INK)
        if data.get("verified"):
            draw_verified_badge(draw, name_x + int(draw.textlength(str(data.get("author", "")), font=name_font)) + int(4 * scale), int(38 * scale), int(12 * scale))
        draw.text((name_x, int(57 * scale)), str(data.get("handle", "")), font=handle_font, fill=MUTED)
        draw_x_logo(draw, px + card_w - int(44 * scale), int(35 * scale), int(24 * scale))

        y = draw_text_lines(draw, visual_chunks[page_index], body_font, px + body_pad, int(BODY_TOP * scale), body_w, line_height * scale)
        # Post images belong on the rightmost (last) page.
        if page_index == pages - 1 and media_paths:
            my = y + int(8 * scale)
            footer_limit = FOOTER_TOP * scale - int(20 * scale)
            for file_path in media_paths:
                try:
                    photo = Image.open(file_path).convert("RGB")
                except Exception:
                    continue
                remaining = footer_limit - my
                if remaining < int(80 * scale):
                    break
                ratio = photo.width / max(1, photo.height)
                dw = body_w
                dh = int(dw / ratio)
                max_dh = min(int(300 * scale), remaining)
                if dh > max_dh:
                    dh = max_dh
                    dw = int(dh * ratio)
                if dh < int(60 * scale):
                    break
                photo = photo.resize((dw, dh), Image.Resampling.LANCZOS)
                mask = Image.new("L", (dw, dh), 0)
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, dw, dh), radius=int(10 * scale), fill=255)
                image.paste(photo, (px + body_pad, my), mask)
                my += dh + int(8 * scale)
            if my < footer_limit:
                draw.text((px + body_pad, my), str(data.get("media_label", "Video preview")), font=load_font(latin_regular, int(9 * scale)), fill=(122, 132, 147))

    # Footer: leftmost page gets date/timezone, rightmost gets AI label.
    date_text = str(data.get("date_display", "")).strip()
    timezone = str(data.get("timezone_label", "")).strip()
    label = str(data.get("translation_label", "AI 翻译")).strip()
    left_x = margin + body_pad
    date_bbox = draw.textbbox((0, 0), date_text, font=date_font)
    date_height = date_bbox[3] - date_bbox[1]
    center_y = FOOTER_TOP * scale + date_height / 2
    draw.text((left_x, center_y), date_text, font=date_font, fill=MUTED, anchor="lm")
    if timezone:
        date_w = draw.textlength(date_text, font=date_font)
        pill_x = left_x + int(date_w) + int(12 * scale)
        label_bbox = draw.textbbox((0, 0), timezone, font=date_font)
        label_height = label_bbox[3] - label_bbox[1]
        pill_w = int(draw.textlength(timezone, font=date_font)) + int(14 * scale)
        draw.rounded_rectangle((pill_x, center_y - label_height / 2 - int(3 * scale), pill_x + pill_w, center_y + label_height / 2 + int(3 * scale)), radius=int(5 * scale), outline=(207, 217, 222), width=max(1, int(scale)))
        draw.text((pill_x + int(7 * scale), center_y), timezone, font=date_font, fill=MUTED, anchor="lm")
    right_x = W - margin - card_w + body_pad
    draw.text((right_x + card_w - body_pad * 2 - draw.textlength(label, font=date_font), center_y), label, font=date_font, fill=MUTED, anchor="lm")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return {"output": str(output_path), "width": W, "height": page_h, "layout": "multi-page-x-cards", "pages": pages, "body_size": body_size}


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

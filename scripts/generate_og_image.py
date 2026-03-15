#!/usr/bin/env python3
"""
scripts/generate_og_image.py
Generate static/assets/og-image.png for social sharing (1200x630px).
Run once: python scripts/generate_og_image.py
Replaces Phase 4's basic placeholder with a polished branded image.
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

W, H = 1200, 630
BG   = "#0a0e17"
GOLD = "#D4A843"
TEXT = "#E2E8F0"
DIM  = "#94A3B8"


def load_font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except (IOError, OSError):
        return None


def main():
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    font_xl = load_font(font_paths[0], 96) or load_font(font_paths[2], 96)
    font_lg = load_font(font_paths[1], 42) or load_font(font_paths[3], 42)
    font_md = load_font(font_paths[1], 28) or load_font(font_paths[3], 28)

    draw.text((80, 160), "Arivu", fill=GOLD, font=font_xl)
    draw.text((80, 285), "அறிவு — knowledge / wisdom", fill=DIM, font=font_md)
    draw.text((80, 360), "Trace the intellectual ancestry", fill=TEXT, font=font_lg)
    draw.text((80, 415), "of any research paper.", fill=TEXT, font=font_lg)

    import random
    rng = random.Random(42)
    for _ in range(40):
        x = rng.randint(750, 1150)
        y = rng.randint(60, 560)
        r = rng.randint(1, 4)
        draw.ellipse([x-r, y-r, x+r, y+r], fill=GOLD)

    draw.text((80, 570), "arivu.app", fill=DIM, font=font_md)

    out = pathlib.Path("static/assets/og-image.png")
    img.save(out, optimize=True, quality=95)
    size_kb = out.stat().st_size // 1024
    print(f"Generated {out} ({size_kb}KB, {W}x{H}px)")


if __name__ == "__main__":
    main()

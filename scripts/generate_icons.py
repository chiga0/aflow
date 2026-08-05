#!/usr/bin/env python3
"""Derive the full PWA/favicon icon set from a master logo image.

Pipeline:
  1. sample background color from the master's corners
  2. extract the glyph via color-diff mask, crop to its bbox
  3. re-center the glyph and scale it to ~66% of the canvas
     (bold enough on a phone home screen, still inside the 80% maskable safe zone)
  4. emit every size used by web/public (and web/dist when it exists)

Usage:
  python3 scripts/generate_icons.py <master.png> [--occupancy 0.66] [--apply]
"""
import argparse
import os
import shutil
import numpy as np
from PIL import Image

SIZES = {
    "icon-512.png": 512,
    "icon-maskable-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "favicon-48.png": 48,
    "favicon-32.png": 32,
    "favicon-16.png": 16,
}
# in-app logos sit on the dark UI -> transparent glyph, no light plate.
# (icon-*/apple-touch-icon/favicons keep the plate: home screens want a full tile.)
TRANSPARENT_SIZES = {
    "logo.png": 256,
    "logo-128.png": 128,
    "logo-64.png": 64,
}

def load_glyph(master_path):
    """Return (glyph_rgba_image, bg_color) cropped to the glyph bbox."""
    im = Image.open(master_path).convert("RGBA")
    a = np.array(im)
    corners = np.stack([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]])[:, :3]
    bg = np.median(corners, axis=0).astype(np.uint8)
    diff = np.abs(a[:, :, :3].astype(int) - bg.astype(int)).sum(axis=2)
    mask = diff > 30
    ys, xs = np.nonzero(mask)
    # knock the plate out: soft alpha ramp keeps anti-aliased edges smooth
    alpha = np.clip((diff.astype(float) - 30) / 50 * 255, 0, 255).astype(np.uint8)
    a[:, :, 3] = alpha
    im = Image.fromarray(a)
    glyph = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return glyph, tuple(int(c) for c in bg)

def render(glyph, bg, size, occupancy, transparent=False):
    s = int(size)
    canvas = Image.new(
        "RGBA", (s, s),
        (0, 0, 0, 0) if transparent else (bg if len(bg) == 4 else (*bg, 255)),
    )
    gw, gh = glyph.size
    scale = (occupancy * s) / max(gw, gh)
    nw, nh = max(1, round(gw * scale)), max(1, round(gh * scale))
    g = glyph.resize((nw, nh), Image.LANCZOS)
    canvas.paste(g, ((s - nw) // 2, (s - nh) // 2), g)
    return canvas

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master", help="path to the master logo png")
    ap.add_argument("--occupancy", type=float, default=0.66)
    ap.add_argument("--bg", default=None, help="plate hex color override, e.g. #09090b")
    ap.add_argument("--apply", action="store_true", help="write into web/public (+ web/dist if present)")
    ap.add_argument("--out", default="/tmp/icon-preview", help="preview dir when not --apply")
    args = ap.parse_args()

    glyph, bg = load_glyph(args.master)
    if args.bg:
        h = args.bg.lstrip("#")
        bg = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    print(f"master glyph={glyph.size} plate={bg} occupancy-> {args.occupancy}")

    if not args.apply:
        os.makedirs(args.out, exist_ok=True)
        for s in (512, 180, 64, 32, 16):
            render(glyph, bg, s, args.occupancy).save(f"{args.out}/icon-{s}.png")
        print("preview written to", args.out)
        return

    root = os.path.join(os.path.dirname(__file__), "..", "web")
    for dest in ("public", "dist"):
        d = os.path.join(root, dest)
        if not os.path.isdir(d):
            continue
        for name, s in SIZES.items():
            render(glyph, bg, s, args.occupancy).save(os.path.join(d, name))
        for name, s in TRANSPARENT_SIZES.items():
            render(glyph, bg, s, args.occupancy, transparent=True).save(os.path.join(d, name))
        render(glyph, bg, 16, args.occupancy).save(
            os.path.join(d, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)]
        )
        print("icons written to", d)

    # archive a transparent 1024 master as the brand source of truth
    doc_dir = os.path.join(root, "..", "docs", "assets")
    os.makedirs(doc_dir, exist_ok=True)
    tw, th = glyph.size
    scale = 1024 * 0.8 / max(tw, th)
    g = glyph.resize((round(tw * scale), round(th * scale)), Image.LANCZOS)
    master = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    master.paste(g, ((1024 - g.size[0]) // 2, (1024 - g.size[1]) // 2), g)
    master.save(os.path.join(doc_dir, "logo-master.png"))
    print("archived docs/assets/logo-master.png (transparent 1024)")

if __name__ == "__main__":
    main()

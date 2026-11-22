"""Packs the OpenPixel pixel icons (Lucide redrawn as 32×32 pixel art) for the website.

Usage: python3 -I web/scripts/icons/build.py "<folder of the icon set>"

The folder is the one OpenPixel exported: index.json, png/<icon>.png, files/<category>.openpixel and
LICENSE-lucide.txt (Lucide's licence, which the set's own licence carries as the notice for the original shapes).

Every icon has three colours: the stroke, a one-pixel outline around it (the stroke grown by one
pixel up, down, left and right) and a shadow (stroke and outline moved one pixel down and to the right). Because the
outline and the shadow follow from the stroke, only the stroke is stored, and the page draws all three in any colour.
The script checks that rule on every icon and stops if one breaks it.

Writes:
  web/public/icons/pixel-icons.json      every icon: name, categories, search words and its stroke (32 rows of 32 bits)
  web/public/icons/LICENSE.txt           the set's licence: MIT, OpenPixel's, with Lucide's notice at the end
  web/public/icons/openpixel-pixel-icons.zip   the whole set: PNG, SVG, the .openpixel files and the licence
  web/src/lib/pixel-icons.ts             counts, categories and the icons the /icons landing page shows
"""
import base64
import io
import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image

N = 32
LUCIDE_VERSION = "1.77"
COLORS = {"stroke": "#ffffff", "outline": "#000000", "shadow": "#4b4b55"}

TITLES = {
    "ai": "AI",
    "food-beverage": "Food & beverage",
    "letters-digits": "Letters & digits",
}

# The icons on the landing page, in this order: a spread across the categories that reads well at a glance.
FEATURED = [
    "house", "search", "heart", "star", "settings", "user", "mail", "camera",
    "disc-3", "gamepad-2", "rocket", "sun", "cloud-rain", "zap", "bell", "lock",
    "map-pin", "calendar", "clock", "folder", "file-text", "image", "pencil", "trash",
    "download", "upload", "share-2", "bookmark", "flag", "gift", "shopping-cart", "coffee",
    "pizza", "apple", "cat", "dog", "fish", "bird", "leaf", "flower",
    "car", "bike", "plane", "ship", "train-front", "bus", "compass", "globe",
    "code", "terminal", "cpu", "database", "wifi", "bluetooth", "battery", "smartphone",
    "laptop", "monitor", "headphones", "mic", "video", "film", "palette", "brush",
    "sword", "shield", "crown", "skull", "ghost", "dice-5", "puzzle", "trophy",
]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # web/


LICENSE = """OpenPixel Pixel Icons
https://openpixel.dev/icons

MIT License

Copyright (c) 2026 OpenPixel contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

================================================================================

Original shapes

The pixel icons are redrawn from the icons of Lucide {version} (https://lucide.dev).
Lucide's licence, below, covers those original shapes and has to stay with the
icons, as it does in this file.

{lucide}"""


def title(cat):
    return TITLES.get(cat, cat.replace("-", " ").capitalize())


def shift(m, dy, dx):
    out = np.zeros_like(m)
    out[max(dy, 0):N + min(dy, 0), max(dx, 0):N + min(dx, 0)] = m[max(-dy, 0):N + min(-dy, 0), max(-dx, 0):N + min(-dx, 0)]
    return out


def layers(stroke):
    grown = stroke | shift(stroke, 1, 0) | shift(stroke, -1, 0) | shift(stroke, 0, 1) | shift(stroke, 0, -1)
    outline = grown & ~stroke
    shadow = shift(stroke | outline, 1, 1) & ~(stroke | outline)
    return outline, shadow


def read_icon(path):
    a = np.array(Image.open(path).convert("RGBA"))
    if a.shape[:2] != (N, N):
        raise SystemExit(f"{path}: not {N}×{N}")
    seen = a[..., 3] > 0
    def is_(hexc):
        rgb = [int(hexc[i:i + 2], 16) for i in (1, 3, 5)]
        return seen & (a[..., :3] == rgb).all(-1)
    stroke, outline, shadow = is_(COLORS["stroke"]), is_(COLORS["outline"]), is_(COLORS["shadow"])
    if (seen & ~(stroke | outline | shadow)).any():
        raise SystemExit(f"{path}: has a colour other than stroke, outline and shadow")
    want_outline, want_shadow = layers(stroke)
    if not (want_outline == outline).all() or not (want_shadow == shadow).all():
        raise SystemExit(f"{path}: outline or shadow doesn't follow from the stroke")
    return stroke


def pack(stroke):
    """32 rows, each a big-endian 32-bit number with the leftmost pixel in the highest bit."""
    return base64.b64encode(np.packbits(stroke.astype(np.uint8), axis=1).tobytes()).decode()


def runs_path(m):
    """An SVG path of the pixels in m, one rectangle per horizontal run (the page builds the same paths)."""
    d = []
    for y in range(N):
        x = 0
        while x < N:
            if m[y, x]:
                s = x
                while x < N and m[y, x]:
                    x += 1
                d.append(f"M{s} {y}h{x - s}v1h{s - x}z")
            else:
                x += 1
    return "".join(d)


def svg(stroke):
    outline, shadow = layers(stroke)
    parts = [
        f'<path fill="{COLORS[name]}" d="{runs_path(m)}"/>'
        for name, m in (("shadow", shadow), ("outline", outline), ("stroke", stroke))
        if m.any()
    ]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{N}" height="{N}" viewBox="0 0 {N} {N}" '
        f'shape-rendering="crispEdges">{"".join(parts)}</svg>\n'
    )


def clean_tags(tags):
    words = []
    for t in tags:
        if t.startswith("$"):
            t = t.split(":", 1)[-1]
        t = t.replace("-", " ").strip()
        if t and t not in words:
            words.append(t)
    return words


def main(src):
    index = json.load(open(os.path.join(src, "index.json")))
    names = sorted(index)
    cats = sorted({c for v in index.values() for c in v["all_categories"]})
    cat_id = {c: i for i, c in enumerate(cats)}
    counts = {c: 0 for c in cats}

    icons, strokes = [], {}
    for name in names:
        info = index[name]
        stroke = read_icon(os.path.join(src, "png", f"{name}.png"))
        strokes[name] = stroke
        for c in info["all_categories"]:
            counts[c] += 1
        icons.append([name, [cat_id[c] for c in info["all_categories"]], " ".join(clean_tags(info["tags"])), pack(stroke)])

    public = os.path.join(ROOT, "public", "icons")
    os.makedirs(public, exist_ok=True)
    data = {
        "version": 1,
        "size": N,
        "lucide": LUCIDE_VERSION,
        "colors": COLORS,
        "categories": [[c, title(c)] for c in cats],
        "icons": icons,
    }
    with open(os.path.join(public, "pixel-icons.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    lucide = open(os.path.join(src, "LICENSE-lucide.txt")).read().strip() + "\n"
    licence = LICENSE.replace("{version}", LUCIDE_VERSION).replace("{lucide}", lucide)
    with open(os.path.join(public, "LICENSE.txt"), "w") as f:
        f.write(licence)
    old = os.path.join(public, "LICENSE-lucide.txt")
    if os.path.exists(old):
        os.remove(old)

    # The whole set as one download. Fixed timestamps, so the same icons always give the same file.
    readme = (
        "OpenPixel Pixel Icons\n=====================\n\n"
        f"{len(names)} icons from Lucide {LUCIDE_VERSION}, redrawn as {N}x{N} pixel art: a white 2px stroke, a 1px black\n"
        "outline and a #4b4b55 shadow one pixel down and to the right.\n\n"
        "png/        every icon as a 32x32 PNG (scale it up with nearest-neighbour)\n"
        "svg/        every icon as an SVG of whole pixels\n"
        "openpixel/  one OpenPixel file per category, one layer per icon\n\n"
        "Change the colours and size, and copy or download single icons, at https://openpixel.dev/icons/library\n\n"
        "MIT licence: see LICENSE.txt, which also carries the notice for the Lucide icons they are redrawn from.\n"
    )
    stamp = (2026, 1, 1, 0, 0, 0)
    def add(z, path, data_bytes):
        z.writestr(zipfile.ZipInfo(path, stamp), data_bytes, compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(os.path.join(public, "openpixel-pixel-icons.zip"), "w") as z:
        add(z, "README.txt", readme)
        add(z, "LICENSE.txt", licence)
        for name in names:
            add(z, f"png/{name}.png", open(os.path.join(src, "png", f"{name}.png"), "rb").read())
            add(z, f"svg/{name}.svg", svg(strokes[name]))
        for f in sorted(os.listdir(os.path.join(src, "files"))):
            if f.endswith(".openpixel"):
                add(z, f"openpixel/{f}", open(os.path.join(src, "files", f), "rb").read())

    missing = [n for n in FEATURED if n not in index]
    if missing:
        raise SystemExit(f"featured icons not in the set: {', '.join(missing)}")
    lib = os.path.join(ROOT, "src", "lib", "pixel-icons.ts")
    with open(lib, "w") as f:
        f.write("// Generated by web/scripts/icons/build.py from the OpenPixel pixel icon set. Don't edit by hand.\n\n")
        f.write(f"export const ICON_COUNT = {len(names)};\n")
        f.write(f"export const ICON_SIZE = {N};\n")
        f.write(f'export const LUCIDE_VERSION = "{LUCIDE_VERSION}";\n')
        f.write(f"export const DEFAULT_COLORS = {json.dumps(COLORS)} as const;\n\n")
        f.write("/** Every category with its number of icons (an icon can be in several). */\n")
        f.write("export const ICON_CATEGORIES: { id: string; title: string; count: number }[] = ")
        f.write(json.dumps([{"id": c, "title": title(c), "count": counts[c]} for c in cats], indent=2))
        f.write(";\n\n/** The icons on the /icons landing page: name and stroke, packed as in public/icons/pixel-icons.json. */\n")
        f.write("export const FEATURED_ICONS: [name: string, stroke: string][] = ")
        f.write(json.dumps([[n, pack(strokes[n])] for n in FEATURED], indent=2))
        f.write(";\n")

    size = os.path.getsize(os.path.join(public, "pixel-icons.json"))
    zsize = os.path.getsize(os.path.join(public, "openpixel-pixel-icons.zip"))
    print(f"{len(names)} icons in {len(cats)} categories; pixel-icons.json {size // 1024} KB, zip {zsize // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])

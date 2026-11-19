#!/usr/bin/env python3
"""Draws the Explore page's "nothing found" character with OpenPixel: a slime sweeping a magnifying glass.

    OPENPIXEL=<OpenPixel 1.1.0+> python3 web/scripts/explore/search_buddy.py

Writes web/public/explore/search/buddy.png (a 1× sprite sheet, frames side by side) and prints the frame layout.
"""
import os
import sys

import common
import op

W = H = 32
LEG = {
    "o": "#1d1a2b",  # outline
    "d": "#2b5e3f",  # body shadow
    "g": "#45914a",  # body
    "l": "#7cc95c",  # body light
    "h": "#c8f08a",  # highlight
    "w": "#f4f1e8",  # eye white
    "k": "#1d1a2b",  # pupil
    "r": "#5a6988",  # glass rim shadow
    "R": "#a9b6cc",  # glass rim
    "c": "#7fd0e6",  # lens
    "C": "#c9f1fb",  # lens glint
    "b": "#6b3f2a",  # handle
    "x": "#ff4a1c",  # handle band (OpenPixel orange)
}

# A clean 11-pixel ring: even runs, corners touching diagonally.
LENS = [
    "...#####...",
    "..#:::::#..",
    ".#:::::::#.",
    "#:::::::::#",
    "#:::::::::#",
    "#:::::::::#",
    "#:::::::::#",
    "#:::::::::#",
    ".#:::::::#.",
    "..#:::::#..",
    "...#####...",
]

# The glass sweeps across the face and back; through the lens one eye looks big.
SWEEP = [10, 13, 17, 20, 17, 13]
DUR = [300, 90, 90, 300, 90, 90]


def frame(gx):
    g = [["." for _ in range(W)] for _ in range(H)]
    cx, cy, rx, ry = 15.5, 21.5, 11.5, 7.5
    # Body: a squat dome, shaded from the top-left.
    for y in range(H):
        for x in range(W):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            if y > 27 or nx * nx + ny * ny > 1:
                continue
            light = -0.6 * nx - 0.8 * ny
            g[y][x] = "h" if light > 0.8 else "l" if light > 0.25 else "g" if light > -0.45 else "d"
    for x in range(1, W - 1):  # flat base in shadow
        if g[27][x] != ".":
            g[27][x] = "d"
    look = 1 if gx >= 15 else 0
    for ex in (11, 18):  # eyes: 2×3 whites, pupils toward the glass
        for y in range(19, 22):
            for x in range(ex, ex + 2):
                g[y][x] = "w"
        g[20][ex + look] = g[21][ex + look] = "k"
    # The glass: rim, lens, a glint, and a magnified eye inside.
    gy = 17
    for j, row in enumerate(LENS):
        for i, ch in enumerate(row):
            x, y = gx - 5 + i, gy - 5 + j
            if ch == ":":
                g[y][x] = "c"
            elif ch == "#":
                g[y][x] = "R" if (x - gx) + (y - gy) < 0 else "r"
    g[gy - 3][gx - 2] = g[gy - 2][gx - 3] = g[gy - 3][gx - 1] = "C"
    for y in range(gy - 1, gy + 3):
        for x in range(gx - 1, gx + 3):
            g[y][x] = "w"
    for x, y in ((gx - 1, gy - 1), (gx + 2, gy - 1), (gx - 1, gy + 2), (gx + 2, gy + 2)):
        g[y][x] = "c"  # round the big eye's corners
    for y in (gy, gy + 1):
        for x in (gx + look - 1, gx + look):
            g[y][x] = "k"
    for i in range(1, 5):  # handle down to the bottom-right, orange band first
        x, y = gx + 3 + i, gy + 3 + i
        g[y][x] = g[y][x + 1] = "x" if i == 1 else "b"
    # Outline every empty pixel next to a filled one.
    out = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x] == "." and any(0 <= y + dy < H and 0 <= x + dx < W and g[y + dy][x + dx] != "."
                                      for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0))):
                out[y][x] = "o"
    return ["".join(r) for r in out]


def main():
    a = op.Agent()
    a.call("pixel_art_guide", topic="animation")
    a.call("new_sprite", width=W, height=H, name="search-buddy")
    for i, dx in enumerate(SWEEP):
        if i:
            a.call("add_frame")
        a.call("paint_slice", rows=frame(dx), legend=LEG)
        a.call("set_frame_duration", duration_ms=DUR[i])
    report, pics = common.review(a, "search-buddy")
    print(common.summary(report))
    print("pictures:", " ".join(pics))
    if "--draft" in sys.argv:
        return
    out = os.path.join(common.PUBLIC, "search")
    os.makedirs(out, exist_ok=True)
    a.call("save_model", path=os.path.join(common.SOURCES, "search-buddy.openpixel"))
    print(a.call("export_sheet", path=os.path.join(out, "buddy.png"), scale=1))


if __name__ == "__main__":
    main()

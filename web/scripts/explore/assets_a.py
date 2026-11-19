#!/usr/bin/env python3
"""Explore page, Assets collection (set A): sword, potion, chest, coin, heart, staff, gem, shield.

Drawn with OpenPixel's v1.1.0 agent harness over MCP. Each asset is a function; the sprites are built as grids of
hex colours in Python (shapes, mirroring, shading by form), painted with paint_slice, reviewed with review_model and
published with common.Collection.

    OPENPIXEL=… python3 assets_a.py            all assets (writes the full manifest)
    OPENPIXEL=… python3 assets_a.py item-coin  just one (for iterating)
"""
import math
import sys

import common
import op

col = common.Collection("assets_a", "assets")

BRAND = "#ff4a1c"  # OpenPixel orange: the personal touch in every piece


# ---------------------------------------------------------------- grid helpers

class Grid:
    """A sprite as a grid of hex colours (None = empty), with the material of each pixel for outlines."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = [[None] * w for _ in range(h)]
        self.m = [[None] * w for _ in range(h)]

    def copy(self):
        g = Grid(self.w, self.h)
        g.c = [r[:] for r in self.c]
        g.m = [r[:] for r in self.m]
        return g

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def set(self, x, y, color, mat=None):
        if self.inside(x, y):
            self.c[y][x] = color
            if mat is not None or color is None:
                self.m[y][x] = mat

    def get(self, x, y):
        return self.c[y][x] if self.inside(x, y) else None

    def outline(self, colors, default):
        """Gives every empty pixel next to (4-neighbours) a filled one the outline colour of that pixel's material."""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.c[y][x] is not None:
                    continue
                mats = [self.m[y + dy][x + dx] for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1))
                        if self.inside(x + dx, y + dy) and self.c[y + dy][x + dx] is not None]
                if mats:
                    # The darkest-looking material wins ties: first listed in `colors` order.
                    pick = next((colors[k] for k in colors if k in mats), default)
                    add.append((x, y, pick))
        for x, y, c in add:
            self.set(x, y, c, "outline")

    def mirror_x(self, keep="left"):
        for y in range(self.h):
            for x in range(self.w // 2):
                a, b = x, self.w - 1 - x
                if keep == "left":
                    self.c[y][b], self.m[y][b] = self.c[y][a], self.m[y][a]
                else:
                    self.c[y][a], self.m[y][a] = self.c[y][b], self.m[y][b]

    def rows(self):
        """paint_slice rows and legend."""
        legend, chars = {}, iter("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~")
        back = {}
        out = []
        for r in self.c:
            s = ""
            for v in r:
                if v is None:
                    s += "."
                else:
                    if v not in back:
                        ch = next(chars)
                        back[v] = ch
                        legend[ch] = v
                    s += back[v]
            out.append(s)
        return out, legend

    def ascii(self):
        rows, legend = self.rows()
        return "\n".join(rows) + "\n" + " ".join(f"{k}={v}" for k, v in legend.items())


def paint(a, g, frame=None):
    rows, legend = g.rows()
    args = dict(rows=rows, legend=legend, axis="z", index=0)
    if frame is not None:
        args["frame"] = frame
    a.call("paint_slice", **args)


def frames(a, grids, durations):
    """Paints one grid per frame (frame 0 must already exist) and sets each frame's duration."""
    for i, g in enumerate(grids):
        if i > 0:
            a.call("add_frame", copy=False)
        paint(a, g, frame=i)
    for i, ms in enumerate(durations):
        a.call("set_frame_duration", frame=i, duration_ms=ms)


def check(a, slug, frame=None):
    report, pics = common.review(a, slug if frame is None else f"{slug}-f{frame}", frame)
    print(slug, common.summary(report))
    print("  pictures:", *pics)
    return report


# ---------------------------------------------------------------- 1. Iron Sword (32×32 still)

def sword(a):
    S = ["#2b2f52", "#56648a", "#97a6c0", "#d4dde8", "#f6fbff"]  # steel, darkest first
    G = ["#6e2f22", "#b0602c", "#e6a33e", "#ffe08a"]               # gold
    L = ["#4a2430", "#7a4038", "#a5634a"]                          # leather
    O = ["#9e2418", BRAND, "#ffb27a"]                              # orange gem
    g = Grid(32, 32)
    kc = 31.5  # centre line: x + row = 31.5 (the sword runs from bottom-left to top-right)
    for y in range(32):
        for x in range(32):
            k, d = x + y, x - y  # k: across the sword (grows toward bottom-right), d: along it (toward the tip)
            off = k - kc
            if -5 <= d <= 23:  # blade: lit edge, light, mid, dark edge; tapering to the tip
                hw = 2.0 if d <= 18 else (1.0 if d <= 21 else 0.6)
                if abs(off) <= hw:
                    shade = {-1.5: 4, -0.5: 3, 0.5: 2, 1.5: 1}[off]
                    if d >= 19:
                        shade = 3 if off < 0 else 2
                    g.set(x, y, S[shade], "steel")
            if 20 <= y <= 24 and k in (31, 32) and d <= -9:  # grip: leather with wrap lines
                c = L[2] if k == 31 else L[1]
                if y % 2 == 0:
                    c = L[1] if k == 31 else L[0]
                g.set(x, y, c, "leather")
    # cross guard: a chunky bar across the blade, three pixels per row, lit toward the top-left end
    for y in range(14, 25):
        cx = y - 7
        span = (cx, cx + 1) if y in (14, 24) else (cx - 1, cx, cx + 1)
        for i, x in enumerate(span):
            side = x - cx  # +1: upper-right face (catches light), -1: lower-left face
            shade = 2 + (1 if side > 0 else (-1 if side < 0 else 0))
            if y <= 16:
                shade += 1
            if y >= 22:
                shade -= 1
            g.set(x, y, G[max(0, min(3, shade))], "gold")
    # pommel: a round gold knob holding an orange gem
    knob = [".GG.",
            "GoOG",
            "GOrB",
            ".BB."]
    for j, row in enumerate(knob):
        for i, ch in enumerate(row):
            c = {"G": G[2], "B": G[1], "o": O[2], "O": O[1], "r": O[0]}.get(ch)
            if c:
                g.set(4 + i, 25 + j, c, "gold")
    g.set(5, 25, G[3], "gold")
    g.set(26, 5, S[4], "steel")  # glint near the tip
    g.outline({"steel": "#171a33", "gold": "#2a1220", "leather": "#2a1220"}, "#171a33")
    return g


def make_sword(a):
    a.call("new_sprite", width=32, height=32, name="Iron Sword")
    paint(a, sword(a))
    a.call("pixel_perfect")
    return "item-sword", "Iron Sword", "sprite"


# ---------------------------------------------------------------- 2. Health Potion (24×24, bubbling, 6 frames)

def potion(i):
    R = ["#4a0d2c", "#8e1a3c", "#d0344a", "#ff7563", "#ffc6a8"]  # red liquid, darkest first
    GL = ["#4f6a8c", "#8fb6cf", "#d6eef7"]                        # glass
    CK = ["#5a3424", "#8c5a38", "#bf8a58"]                        # cork
    OR = ["#a3271a", BRAND, "#ff9a66"]                            # ribbon
    g = Grid(24, 24)
    cx, cy, r = 11.5, 15.0, 6.6
    surface = 12
    for y in range(24):
        for x in range(24):
            nx, ny = (x - cx) / r, (y - cy) / r
            if math.hypot(nx, ny) <= 1.0:
                if y < surface:
                    c = GL[0] if nx > 0.45 else GL[1]
                    g.set(x, y, c, "glass")
                else:
                    lit = -0.7 * nx - 0.7 * ny
                    if y == surface:
                        c = R[3] if nx < 0.5 else R[2]
                    elif lit > 0.35:
                        c = R[3]
                    elif lit > -0.25:
                        c = R[2]
                    elif lit > -0.6:
                        c = R[1]
                    else:
                        c = R[0]
                    g.set(x, y, c, "liquid")
    # neck and rim
    for y in range(6, 10):
        for x in range(10, 14):
            g.set(x, y, GL[0] if x == 13 else GL[1], "glass")
    for x in range(9, 15):
        g.set(x, 5, GL[2] if x < 13 else GL[1], "glass")
    # cork
    for y in range(2, 5):
        for x in range(10, 14):
            g.set(x, y, CK[2] if y == 2 else (CK[0] if x == 13 else CK[1]), "cork")
    g.set(10, 2, CK[2], "cork")
    # orange ribbon tied around the neck, with a little bow on the right
    for x in range(9, 15):
        g.set(x, 7, OR[2] if x == 10 else (OR[0] if x >= 13 else OR[1]), "ribbon")
    g.set(14, 8, OR[0], "ribbon")
    # glass highlights (top-left)
    for (x, y) in ((7, 12), (7, 13), (7, 14), (8, 11), (11, 6), (11, 8)):
        g.set(x, y, GL[2], "glass")
    g.set(8, 10, GL[2], "glass")
    # bubbles rising: each follows the same path, offset by 2 frames
    path = [(20, 1), (18, 1), (16, 2), (15, 2), (13, 1), (12, 0)]  # (row, size); size 0 = pops at the surface
    for b, (bx, phase) in enumerate(((9, 0), (14, 2), (11, 4))):
        row, size = path[(i + phase) % 6]
        x = bx + (1 if (i + phase) % 6 in (2, 3) else 0)
        if size == 0:
            g.set(x, surface, R[4], "liquid")
            g.set(x - 1, surface - 1, R[4], "liquid")
            g.set(x + 1, surface - 1, R[4], "liquid")
        elif size == 1:
            g.set(x, row, R[4], "liquid")
        else:
            g.set(x, row, R[4], "liquid")
            g.set(x + 1, row, R[3], "liquid")
            g.set(x, row + 1, R[3], "liquid")
    g.outline({"cork": "#24131f", "ribbon": "#24131f", "glass": "#1e1a33", "liquid": "#1e1a33"}, "#1e1a33")
    return g


def make_potion(a):
    a.call("new_sprite", width=24, height=24, name="Health Potion")
    frames(a, [potion(i) for i in range(6)], [130, 100, 100, 110, 100, 140])
    return "item-potion", "Health Potion", "animation"


# ---------------------------------------------------------------- 3. Treasure Chest (voxel, 22×18×16)

def make_chest(a):
    W = ["#3d1f1a", "#6b3a26", "#9c5a34", "#c98a4e"]   # wood
    I = ["#25233a", "#4a4a66", "#7d7f9e", "#b8bccf"]   # iron
    G = ["#8a4a1e", "#e6a33e", "#ffe08a"]              # gold
    SX, SY, SZ = 22, 18, 17
    a.call("new_model", size_x=SX, size_y=SY, size_z=SZ, name="Treasure Chest")

    def lid_top(z):
        t = (z - 7.5) / 6.5
        return 9 + round(5.2 * math.sqrt(max(0.0, 1 - t * t)))

    def wood(z, y):
        if not 2 <= z <= 13:
            return False
        return y <= 8 or y <= lid_top(z)

    def wood_colour(z, y):
        if y == 8:
            return "s"                      # the dark seam where the lid closes
        if y <= 8 and y in (3, 6):
            return "p"                      # plank seams on the body
        if y > 8 and z in (5, 10):
            return "p"                      # plank seams along the lid
        if y > 8 and y == lid_top(z):
            return "h"                      # the lit top of the lid
        return "w"

    def band(z, y):
        if y > SY - 2:
            return False
        return any(wood(z + dz, y + dy) for dz, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)))

    def profile(fn, colour):
        rows = []
        for y in range(SY - 1, -1, -1):
            rows.append("".join(colour(z, y) if fn(z, y) else "." for z in range(SZ)))
        return rows

    legend = {"w": W[2], "p": W[1], "s": W[0], "h": W[3], "i": I[2], "j": I[1], "k": I[3]}
    a.call("paint_slice", axis="x", index=2, depth=18, rows=profile(wood, wood_colour), legend=legend)

    def band_colour(z, y):
        if y == 8 or y == 9:
            return "j"
        top = max(yy for yy in range(SY) if band(z, yy))
        return "k" if y == top else "i"

    for x0 in (4, 15):
        a.call("paint_slice", axis="x", index=x0, depth=3, rows=profile(band, band_colour), legend=legend)
    # rivets on the bands, front face
    a.call("set_voxels", voxels=[[x, y, 14, I[3]] for x in (5, 16) for y in (2, 5)])
    # lock plate on the body, a gold hasp hanging from the lid with an orange gem set in it
    vox = []
    for x in range(8, 14):
        for y in range(2, 8):
            edge = x in (8, 13) or y in (2, 7)
            vox.append([x, y, 14, G[0] if edge and y == 2 else (G[1] if edge else G[2])])
    vox += [[10, 5, 14, I[0]], [11, 5, 14, I[0]], [10, 4, 14, I[0]], [11, 4, 14, I[1]]]
    for x in range(9, 13):
        for y in range(9, 13):
            edge = x in (9, 12) or y in (9, 12)
            vox.append([x, y, 14, G[1] if edge else G[2]])
    vox += [[10, 10, 15, "#ff9a66"], [11, 10, 15, BRAND], [10, 11, 15, BRAND], [11, 11, 15, "#a3271a"]]
    a.call("set_voxels", voxels=vox)
    # a dark plinth along the bottom
    a.call("fill_box", **{"from": [2, 0, 2], "to": [19, 0, 13], "color": W[0], "mode": "paint"})
    return "item-chest", "Treasure Chest", "voxel"


# ---------------------------------------------------------------- 4. Spinning Coin (16×16, 8 frames)

COIN = ["#7a3b1c", "#c4702a", "#f0b03c", "#ffe58a", "#fffbe6"]  # gold, darkest first
COIN_OUT = "#2a1220"


def _rows_mask(widths, top):
    """A shape centred on x = 8 from a list of row widths starting at row `top`."""
    return {(x, top + j) for j, w in enumerate(widths) for x in range(8 - w // 2, 8 + w // 2)}


def coin(i):
    # (coin widths, face widths, side showing the coin's thickness, sparkle) per frame of one spin
    W14 = [6, 10, 12, 12, 14, 14, 14, 14, 14, 14, 12, 12, 10, 6]
    F14 = [4, 8, 10, 10, 10, 10, 10, 10, 8, 4]
    W10 = [4, 6, 8, 8, 10, 10, 10, 10, 10, 10, 8, 8, 6, 4]
    F10 = [2, 4, 6, 6, 6, 6, 6, 6, 4, 2]
    W6 = [2, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 2]
    F6 = [0, 2, 2, 2, 2, 2, 2, 2, 2, 0]
    spec = [(W14, F14, 0, 1), (W14, F14, 0, 2), (W10, F10, 1, 0), (W6, F6, 1, 0), (None, None, 0, 0),
            (W6, F6, -1, 0), (W10, F10, -1, 0), (W14, F14, 0, 0)][i]
    cw, fw, side, sparkle = spec
    C = COIN
    g = Grid(16, 16)
    if cw is None:
        # edge on: a thin upright bar with a reeded edge
        for y in range(2, 14):
            g.set(7, y, C[3] if y < 6 else C[2], "gold")
            g.set(8, y, C[1] if y < 10 else C[0], "gold")
        g.outline({"gold": COIN_OUT}, COIN_OUT)
        return g
    coin_m = _rows_mask(cw, 1)
    face_m = _rows_mask(fw, 3)
    inner = {p for p in coin_m if all((p[0] + dx, p[1] + dy) in coin_m
                                      for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    for (x, y) in coin_m:
        if (x, y) not in inner:
            g.set(x, y, COIN_OUT, "outline")
        elif (x, y) in face_m:
            edge = fw is not F6 and any((x + dx, y + dy) not in face_m
                                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            s = x + y
            if edge and s < 15:
                c = C[1]          # the raised rim shades the face at the top-left
            elif edge and s > 15:
                c = C[3]          # and the face catches light at the bottom-right
            else:
                c = C[3] if fw is F6 and y < 7 else C[2]
            g.set(x, y, c, "gold")
        else:
            s = x + y
            c = C[3] if s < 14 else (C[2] if s < 18 else C[1])
            g.set(x, y, c, "gold")
    if side:
        for y in range(16):
            xs = [x for x in range(16) if (x, y) in inner]
            if xs:
                x = max(xs) if side > 0 else min(xs)
                g.set(x, y, C[0] if side > 0 else C[1], "gold")
    # the OpenPixel mark: one orange pixel, embossed
    if fw is F14:
        for (x, y, c) in ((7, 7, "#ff9a66"), (8, 7, BRAND), (7, 8, BRAND), (8, 8, "#a3271a")):
            g.set(x, y, c, "gold")
    elif fw is F10:
        g.set(7, 7, BRAND, "gold")
        g.set(8, 7, BRAND, "gold")
        g.set(7, 8, "#a3271a", "gold")
        g.set(8, 8, "#a3271a", "gold")
    if sparkle:
        sx, sy = 12, 3
        g.set(sx, sy, C[4], "spark")
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            g.set(sx + dx, sy + dy, C[3] if sparkle == 1 else C[4], "spark")
            if sparkle == 2:
                g.set(sx + 2 * dx, sy + 2 * dy, C[3], "spark")
    return g


def make_coin(a):
    a.call("new_sprite", width=16, height=16, name="Spinning Coin")
    frames(a, [coin(i) for i in range(8)], [140, 110, 70, 60, 60, 60, 70, 90])
    a.call("pixel_perfect", all_frames=True)
    return "item-coin", "Spinning Coin", "animation"


# ---------------------------------------------------------------- 5. Heart (16×16, pulse, 4 frames)

HEART_HALVES = {  # left halves of the filled heart (no outline); mirrored onto the right
    "small": [".XX.", "XXXX", "XXXX", ".XXX", "..XX", "...X"],
    "normal": [".XXX.", "XXXXX", "XXXXX", "XXXXX", ".XXXX", "..XXX", "...XX", "....X"],
    "big": [".XXXX.", "XXXXXX", "XXXXXX", "XXXXXX", "XXXXXX", ".XXXXX", "..XXXX", "...XXX", "....XX", ".....X"],
}


def heart(size, twinkle=False):
    H = ["#5c1033", "#b8203f", BRAND, "#ff9a66", "#fff0dc"]  # crimson to warm highlight
    half = HEART_HALVES[size]
    hw, hh = len(half[0]), len(half)
    top = 8 - (hh + 1) // 2
    g = Grid(16, 16)
    cells = set()
    for j, row in enumerate(half):
        for i, ch in enumerate(row):
            if ch == "X":
                cells.add((8 - hw + i, top + j))
                cells.add((7 + hw - i, top + j))
    H = ["#5c1033", "#a81d3f", "#e0303f", BRAND, "#ffb27a", "#fff0dc"]
    for (x, y) in cells:
        nx = (x + 0.5 - 8) / hw
        ny = (y - top) / hh
        out = lambda dx, dy: (x + dx, y + dy) not in cells
        c = H[2]
        # core shadow: the bottom-right side, two pixels deep
        if out(1, 1) or out(1, 0) and nx > 0 or out(0, 1):
            c = H[1]
        if (out(2, 2) or out(2, 1) and out(1, 2)) and nx > -0.3 and c == H[2]:
            c = H[1]
        if (out(1, 1) and (out(1, 0) or out(0, 1))) and nx > 0.1:
            c = H[0]
        # light: the upper-left of each lobe
        if ny < 0.5 and nx < -0.15 and c == H[2]:
            c = H[3]
        if ny < 0.35 and 0.2 < nx < 0.75 and c == H[2]:
            c = H[3]
        g.set(x, y, c, "heart")
    # shine on the left lobe
    sx, sy = 8 - hw + 1, top + 1
    g.set(sx, sy, H[5], "heart")
    if size != "small":
        g.set(sx + 1, sy, H[4], "heart")
        g.set(sx, sy + 1, H[4], "heart")
    g.outline({"heart": "#2a0d1e"}, "#2a0d1e")
    if twinkle:
        tx, ty = 12, 2
        g.set(tx, ty, H[5], "spark")
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            g.set(tx + dx, ty + dy, H[4], "spark")
    return g


def make_heart(a):
    a.call("new_sprite", width=16, height=16, name="Heart")
    frames(a, [heart("normal"), heart("big"), heart("normal", twinkle=True), heart("small")], [320, 90, 90, 120])
    return "item-heart", "Heart", "animation"


# ---------------------------------------------------------------- 6. Magic Staff (32×32 still)

def staff():
    WD = ["#3e2220", "#6e3f2b", "#a06838", "#cf9858"]          # wood
    OR = ["#8a1f17", "#c9361b", BRAND, "#ff9a66", "#ffe2c4"]  # the orb
    CL = ["#2b2f52", "#45507a", "#6d7fae"]                     # cloth wrap
    GD = ["#8a4a1e", "#e6a33e", "#ffe08a"]                     # gold ring
    g = Grid(32, 32)
    # shaft: two pixels per row along x + y = 31.5, from the foot (bottom-left) up to the orb
    for y in range(13, 28):
        for k in (31, 32):
            x = k - y
            c = WD[2] if k == 31 else WD[1]
            mat = "wood"
            if 19 <= y <= 22:  # cloth grip wrap, with darker turns
                c = CL[2] if k == 31 else CL[1]
                if y % 2 == 0:
                    c = CL[1] if k == 31 else CL[0]
                mat = "cloth"
            if y in (14, 15):
                c = GD[2] if k == 31 else GD[1]
                mat = "gold"
            if y >= 26:
                c = GD[1] if k == 31 else GD[0]
                mat = "gold"
            g.set(x, y, c, mat)
    # the claw: two wooden prongs curling around the orb
    prong_a = [(18, 12), (17, 11), (17, 10), (17, 9), (17, 8), (18, 7), (18, 6), (19, 5), (20, 4), (21, 4)]
    prong_b = [(19, 13), (20, 14), (21, 14), (22, 14), (23, 14), (24, 13), (25, 13), (26, 12), (27, 11), (27, 10)]
    for (x, y) in prong_a:
        g.set(x, y, WD[3] if y < 9 else WD[2], "wood")
    for (x, y) in prong_b:
        g.set(x, y, WD[1] if x > 22 else WD[2], "wood")
    g.set(18, 13, WD[2], "wood")
    # the orb, lit from the top-left, glowing
    cx, cy, r = 22.5, 9.0, 3.9
    for y in range(3, 15):
        for x in range(17, 29):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r and g.get(x, y) is None:
                nx, ny = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
                lit = -0.6 * nx - 0.8 * ny
                c = OR[3] if lit > 0.45 else (OR[2] if lit > -0.35 else OR[1])
                if lit < -0.75:
                    c = OR[0]
                g.set(x, y, c, "orb")
    g.set(21, 7, OR[4], "orb")
    g.set(22, 7, OR[3], "orb")
    g.set(21, 8, OR[3], "orb")
    g.outline({"orb": "#3d0f14"}, "#1f1018")
    # magic sparkles drifting off the orb
    for (sx, sy) in ((28, 4), (14, 5)):
        g.set(sx, sy, OR[4], "spark")
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            g.set(sx + dx, sy + dy, OR[3], "spark")
    return g


def make_staff(a):
    a.call("new_sprite", width=32, height=32, name="Magic Staff")
    paint(a, staff())
    return "item-staff", "Magic Staff", "sprite"


# ---------------------------------------------------------------- 7. Crystal Gem (24×24, glint, 6 frames)

GEM = ["#14274e", "#1b5a85", "#2aa0c0", "#73e2df", "#e9fff9"]  # deep to light aqua


def gem(i):
    C = GEM
    g = Grid(24, 24)
    crown = ["....tWWTTTTl....",   # x = 4..19, rows 5..9: table on top, lit bezel left, shaded bezel right
             "...ttWTTTTTlm...",
             "..tttllllllmmm..",
             ".ttttllllllmmmm.",
             "TTTTTTTTllllllll"]
    pick = {"W": C[4], "T": C[3], "t": C[3], "l": C[2], "m": C[1]}
    cells = {}
    for j, row in enumerate(crown):
        for i2, ch in enumerate(row):
            if ch != ".":
                cells[(4 + i2, 5 + j)] = pick[ch]
    for y in range(10, 18):
        half = 8 - (y - 10)  # 45° sides down to the point
        x0, x1 = 12 - half, 11 + half
        for x in range(x0, x1 + 1):
            rel = (x + 0.5 - 12) / max(half, 1)
            if rel < -0.55:
                c = C[2]
            elif rel < 0:
                c = C[3] if y < 14 else C[2]
            elif rel < 0.5:
                c = C[1]
            else:
                c = C[0] if y > 11 else C[1]
            cells[(x, y)] = c
    # a little fire inside: OpenPixel orange flashing deep in the stone
    for (x, y, c) in ((12, 12, "#ff9a66"), (13, 12, BRAND), (12, 13, BRAND), (13, 13, "#c9361b")):
        cells[(x, y)] = c
    # the glint: a bright diagonal band sweeping across (frames 1-3)
    sweep = {1: 12, 2: 18, 3: 24}.get(i)
    lighter = {C[0]: C[1], C[1]: C[2], C[2]: C[3], C[3]: C[4], C[4]: C[4]}
    for (x, y), c in cells.items():
        if sweep is not None and sweep <= x + y <= sweep + 1:
            c = lighter.get(c, c)
            if sweep <= x + y <= sweep:
                c = lighter.get(c, c)
        g.set(x, y, c, "gem")
    g.outline({"gem": "#0b1430"}, "#0b1430")
    # the sparkle on the table corner (frames 3-5)
    star = {3: 1, 4: 2, 5: 1}.get(i)
    if star:
        sx, sy = 9, 4
        g.set(sx, sy, C[4], "spark")
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            g.set(sx + dx, sy + dy, C[4] if star == 2 else C[3], "spark")
            if star == 2:
                g.set(sx + 2 * dx, sy + 2 * dy, C[3], "spark")
    if i == 5:
        g.set(19, 7, C[4], "spark")
    return g


def make_gem(a):
    a.call("new_sprite", width=24, height=24, name="Crystal Gem")
    frames(a, [gem(i) for i in range(6)], [450, 70, 70, 80, 120, 110])
    return "item-gem", "Crystal Gem", "animation"


# ---------------------------------------------------------------- 8. Knight Shield (32×32 still)

def shield():
    ST = ["#2b2f52", "#56648a", "#97a6c0", "#d4dde8", "#f6fbff"]  # steel rim
    NV = ["#18204a", "#24336b", "#34498c"]                          # navy field
    OR = ["#9e2418", "#d23a1a", BRAND, "#ff9a66"]                   # orange chevron
    GD = ["#8a4a1e", "#e6a33e", "#ffe08a"]                          # gold
    g = Grid(32, 32)
    # half-widths per row: straight sides, then curving in to the point
    half = {}
    for y in range(4, 29):
        if y <= 15:
            h = 10
        else:
            t = (y - 15) / 13.5
            h = 10 * max(0.0, 1 - t) ** 0.6
        half[y] = max(1, int(round(h)))
    half[4] = 9  # rounded top corners
    shape = {(x, y) for y, h in half.items() for x in range(16 - h, 16 + h)}

    def depth(x, y):  # distance (in pixels) to the outside, up to 3
        for d in range(1, 4):
            if any((x + dx, y + dy) not in shape for dx in range(-d, d + 1) for dy in range(-d, d + 1)):
                return d
        return 4

    for (x, y) in shape:
        d = depth(x, y)
        nx = (x + 0.5 - 16) / 10
        if d <= 2:  # the steel rim, lit at the top-left
            s = x + y
            c = ST[3] if s < 26 else (ST[2] if s < 38 else ST[1])
            if d == 2 and s >= 26:
                c = ST[2] if s < 38 else ST[1]
            if d == 1 and (x, y) == (7, 5):
                c = ST[4]
            g.set(x, y, c, "steel")
            continue
        t = y - (10 + 1.0 * abs(x + 0.5 - 16))
        if 0 <= t < 5:  # the chevron
            c = OR[3] if (nx < -0.3 and t < 1.5) else (OR[2] if nx < 0.15 else OR[1])
            if t >= 4 and nx > 0:
                c = OR[0]
            g.set(x, y, c, "orange")
        else:
            c = NV[2] if nx < -0.35 else (NV[1] if nx < 0.45 else NV[0])
            if y > 22 and nx > -0.1:
                c = NV[0]
            g.set(x, y, c, "navy")
    # the OpenPixel mark in gold above the chevron
    for (x, y, c) in ((15, 6, GD[2]), (16, 6, GD[1]), (15, 7, GD[1]), (16, 7, GD[0])):
        g.set(x, y, c, "gold")
    # rivets on the rim
    for (x, y) in ((8, 6), (23, 6), (7, 13), (24, 13), (15, 26)):
        g.set(x, y, GD[2] if x < 16 else GD[1], "gold")
    g.outline({"steel": "#0b0d1f"}, "#0b0d1f")
    return g


def make_shield(a):
    a.call("new_sprite", width=32, height=32, name="Knight Shield")
    paint(a, shield())
    return "item-shield", "Knight Shield", "sprite"


# ---------------------------------------------------------------- registry

ASSETS = {
    "item-sword": make_sword,
    "item-potion": make_potion,
    "item-chest": make_chest,
    "item-coin": make_coin,
    "item-heart": make_heart,
    "item-staff": make_staff,
    "item-gem": make_gem,
    "item-shield": make_shield,
}


def main(args):
    preview = "--preview" in args
    slugs = [s for s in args if not s.startswith("--")] or list(ASSETS)
    a = op.Agent()
    for slug in slugs:
        result = ASSETS[slug](a)
        s, title, kind = result
        check(a, s)
        if not preview:
            col.publish(a, s, title, kind)
    a.close()


if __name__ == "__main__":
    main(sys.argv[1:])

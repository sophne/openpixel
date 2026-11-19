#!/usr/bin/env python3
"""Explore page, Assets collection (part B): bomb, golden key, red mushroom, torch, spellbook, bow & arrow,
barrel and ramen bowl. Drawn with OpenPixel's v1.1.0 agent harness over MCP.

    OPENPIXEL=…/OpenPixel python3 assets_b.py            (all assets; writes manifest/assets_b.json)
    OPENPIXEL=…/OpenPixel python3 assets_b.py item-bomb  (just one, to iterate)

Each piece carries a small touch of OpenPixel orange (#FF4A1C).
"""
import json
import math
import sys

import common
import op

BRAND = "#ff4a1c"

# Hue-shifted ramps, darkest first (made with make_color_ramp base=…, see ramps() below).
RAMPS = {
    "bomb": ["#0f0e1f", "#232342", "#3d4566", "#6d809e", "#a7c3d6"],
    "metal": ["#1f2136", "#626d8a", "#a8bcd1", "#dff5ff"],
    "gold": ["#43180b", "#924f1b", "#e0a030", "#f2da5f", "#fff691"],
    "wood": ["#2e0c0d", "#642a1e", "#9a5a34", "#cea164", "#ffeaa2"],
    "flame": ["#4d0e06", "#c44b14", "#ffa13e", "#ffdb82"],
    "red": ["#3c0b22", "#821c38", "#c8323c", "#e87361", "#ffb996"],
    "cream": ["#46362b", "#b2a187", "#f1eace", "#fffde7"],
    "purple": ["#130d29", "#38215a", "#6a3a8a", "#ae69bf", "#f5a7f5"],
    "leather": ["#250c09", "#5e311e", "#9e7246", "#e7ce94"],
    "broth": ["#3e190d", "#9f5c29", "#e2af57", "#ffee9a"],
    "noodle": ["#483620", "#f0d890", "#fffac7"],
    "bowl": ["#3a0915", "#931c22", "#d85d47", "#ffb790"],
    "steam": ["#2d3244", "#c8d4e4", "#eef9ff"],
    "green": ["#0e2917", "#3e8948", "#aff4aa"],
    "pink": ["#481f30", "#f08aa0", "#ffc3c4"],
}

col = common.Collection("assets_b", "assets")


# ---------------------------------------------------------------- tiny raster helpers

class Grid:
    """A text canvas: one character per pixel, '.' is empty."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [["." for _ in range(w)] for _ in range(h)]

    def put(self, x, y, ch):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = ch

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.g[y][x]
        return "."

    def stamp(self, x0, y0, rows, transparent="."):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch != transparent:
                    self.put(x0 + dx, y0 + dy, ch)

    def rows(self):
        return ["".join(r) for r in self.g]

    def copy(self):
        n = Grid(self.w, self.h)
        n.g = [r[:] for r in self.g]
        return n


def paint(a, grid, legend, frame=None):
    args = dict(rows=grid.rows(), legend=legend, axis="z", index=0)
    if frame is not None:
        args["frame"] = frame
    a.call("paint_slice", **args)


def check(a, slug, frame=None):
    report, pics = common.review(a, slug, frame)
    print(slug, json.dumps(common.summary(report)), pics)
    return report


def shade_sphere(grid, cx, cy, r, chars, light=(-0.55, -0.65, 0.55), bands=(0.18, 0.45, 0.78), test=None):
    """Fills a disc with form shading from a top-left light. chars: darkest→lightest (len(bands)+1)."""
    lx, ly, lz = light
    n = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / n, ly / n, lz / n
    for y in range(grid.h):
        for x in range(grid.w):
            dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
            d2 = dx * dx + dy * dy
            if d2 > 1 or (test and not test(x, y)):
                continue
            nz = math.sqrt(1 - d2)
            i = dx * lx + dy * ly + nz * lz
            k = sum(1 for b in bands if i > b)
            grid.put(x, y, chars[k])


def outline(grid, ch, inside=None):
    """Puts `ch` on every empty pixel next (4-way) to a filled one."""
    pts = []
    for y in range(grid.h):
        for x in range(grid.w):
            if grid.get(x, y) != ".":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                c = grid.get(x + dx, y + dy)
                if c != "." and (inside is None or c in inside):
                    pts.append((x, y))
                    break
    for x, y in pts:
        grid.put(x, y, ch)


def start(a, w, h, name):
    a.call("new_sprite", width=w, height=h, name=name)


# ---------------------------------------------------------------- 1. bomb

def star(cx, cy, size):
    """Spark shapes around (cx, cy): size 0 small plus, 1 plus, 2 cross, 3 big star."""
    y, Y, O, R = "y", "Y", "O", "R"
    pts = [(cx, cy, y)]
    if size == 0:
        pts += [(cx + 1, cy, Y), (cx, cy - 1, Y), (cx - 1, cy, O), (cx, cy + 1, O)]
    elif size == 1:
        pts += [(cx + 1, cy, Y), (cx, cy - 1, Y), (cx - 1, cy, Y), (cx, cy + 1, Y),
                (cx + 2, cy, O), (cx, cy - 2, O), (cx, cy + 2, R)]
    elif size == 2:
        pts += [(cx + 1, cy - 1, Y), (cx - 1, cy - 1, Y), (cx + 1, cy + 1, Y), (cx - 1, cy + 1, O),
                (cx + 2, cy - 2, R), (cx + 2, cy + 2, R), (cx, cy - 1, O), (cx + 1, cy, O)]
    else:
        pts += [(cx + 1, cy, Y), (cx, cy - 1, Y), (cx - 1, cy, Y), (cx, cy + 1, Y),
                (cx + 2, cy, O), (cx, cy - 2, O), (cx, cy + 2, O),
                (cx + 1, cy - 1, O), (cx + 1, cy + 1, R), (cx - 1, cy - 1, R), (cx + 3, cy, R), (cx - 1, cy + 1, R)]
    return pts


def bomb(a):
    B = RAMPS["bomb"]
    W = RAMPS["wood"]
    F = RAMPS["flame"]
    legend = {"o": B[0], "1": B[1], "2": B[2], "3": B[3], "4": B[4], "N": "#eef9ff",
              "f": W[3], "g": W[1], "y": "#fff691", "Y": F[3], "O": F[2], "R": BRAND}
    base = Grid(24, 24)
    # body: a ball shaded from the top-left
    shade_sphere(base, 10.5, 15.2, 7.1, "1223", bands=(0.05, 0.42, 0.8))
    # specular glint and a little reflected light on the shadow side
    base.stamp(6, 11, ["44", "4."])
    base.put(8, 10, "3")
    for x, y in ((15, 19), (16, 18), (14, 20)):
        base.put(x, y, "2")
    # iron cap on top
    base.stamp(8, 6, [".ooooo.",
                      "o23N32o",
                      "o23332o",
                      "oo222oo"])
    outline(base, "o")
    # fuse: a twisted cord curling up and to the right
    for x, y, c in ((11, 5, "f"), (12, 4, "f"), (13, 4, "f"), (12, 5, "g"), (14, 3, "f"), (14, 4, "g"),
                    (15, 3, "f")):
        base.put(x, y, c)
    sizes = [0, 1, 3, 2, 1]
    durations = [110, 70, 60, 70, 90]
    start(a, 24, 24, "Bomb")
    for i, size in enumerate(sizes):
        g = base.copy()
        for x, y, c in star(16, 3 if size < 3 else 3, size):
            if (x, y) not in ((15, 3), (14, 3)) or size >= 1:
                g.put(x, y, c)
        if i:
            a.call("add_frame", copy=False)
        paint(a, g, legend)
        a.call("set_frame_duration", duration_ms=durations[i])
    return "Bomb", "animation"


# ---------------------------------------------------------------- shading helpers for flat props

def mask_from(fn, w, h, ss=3):
    """Pixels whose area is mostly inside fn(x, y) (supersampled ss×ss)."""
    m = set()
    for y in range(h):
        for x in range(w):
            hit = sum(fn(x + (i + 0.5) / ss, y + (j + 0.5) / ss) for i in range(ss) for j in range(ss))
            if hit * 2 > ss * ss:
                m.add((x, y))
    return m


def bevel(grid, mask, mid, light, dark, lightest=None):
    """Form shading for flat metal/wood: edges facing the top-left light are light, those facing away dark."""
    for (x, y) in mask:
        up_left = ((x - 1, y) not in mask) + ((x, y - 1) not in mask)
        down_right = ((x + 1, y) not in mask) + ((x, y + 1) not in mask)
        c = mid
        if up_left > down_right:
            c = light
            if lightest and up_left == 2:
                c = lightest
        elif down_right > up_left:
            c = dark
        grid.put(x, y, c)


# ---------------------------------------------------------------- 2. golden key

def key(a):
    G = RAMPS["gold"]
    R = RAMPS["red"]
    legend = {"o": G[0], "1": G[1], "2": G[2], "3": G[3], "4": G[4], "R": BRAND, "r": R[1], "w": "#fff4e0"}
    W = H = 24
    g = Grid(W, H)
    # the bow: a ring lit from the top-left (outer rim lit up-left, inner rim lit on the far side of the hole)
    cx = cy = 6.5
    ro, ri = 4.7, 2.0
    for y in range(H):
        for x in range(W):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            if ri < d <= ro:
                facing = -(dx + dy) / max(d, 0.01)        # >0: outer surface faces the light
                if d < (ro + ri) / 2:
                    facing = -facing                      # inner surface faces the other way
                c = "3" if facing > 0.2 else "2" if facing > -0.55 else "1"
                g.put(x, y, c)
    # the shaft: a 2-pixel diagonal, upper edge lit
    for k in range(9, 21):
        g.put(k + 1, k, "3")
        g.put(k, k, "2")
    # teeth (down-left of the shaft) and the collar (across it)
    for base, length in ((15, 3), (18, 3)):
        for j in range(1, length + 1):
            g.put(base - j, base + j, "3")
            g.put(base - j + 1, base + j, "1")
    # the collar: a little diamond-shaped boss across the shaft, with an orange gem set in it
    g.stamp(9, 9, ["...3.",
                   "..343",
                   ".3wR2",
                   ".2Rr1",
                   "..21.",
                   ])
    g.stamp(3, 3, ["44", "4."])  # glint on the bow
    for k in (14, 17):          # glints along the shaft
        g.put(k + 1, k, "4")
    outline(g, "o")
    start(a, W, H, "Golden Key")
    paint(a, g, legend)
    return "Golden Key", "sprite"


# ---------------------------------------------------------------- voxel helpers

def send_voxels(a, vox):
    """vox: {(x, y, z): hex}. Sent in chunks with set_voxels."""
    items = [[x, y, z, c] for (x, y, z), c in vox.items()]
    for i in range(0, len(items), 1500):
        a.call("set_voxels", voxels=items[i:i + 1500])


LIGHT3 = (-0.45, 0.75, 0.5)        # from the top, front-left (the side the iso view shows lit)


def lit(nx, ny, nz):
    lx, ly, lz = LIGHT3
    n = math.sqrt(lx * lx + ly * ly + lz * lz)
    m = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return (nx * lx + ny * ly + nz * lz) / (n * m)


def pick(ramp, t):
    """t in 0..1 → a colour of the ramp (darkest first)."""
    return ramp[max(0, min(len(ramp) - 1, int(t * len(ramp))))]


# ---------------------------------------------------------------- 3. red mushroom

def mushroom(a):
    R = RAMPS["red"]
    C = RAMPS["cream"]
    W = RAMPS["wood"]
    grass = ["#193c3e", "#265c42", "#3e8948", "#63c74d"]
    N = 18
    c = 9.0
    vox = {}
    # a round tuft of ground: dirt below, grass on top
    for x in range(N):
        for z in range(N):
            d = math.hypot(x + 0.5 - c, z + 0.5 - c)
            if d <= 7.6:
                vox[(x, 0, z)] = W[1] if d > 6.8 else W[2]
                g = grass[2] if (x * 7 + z * 13) % 5 else grass[3]
                if d > 6.6:
                    g = grass[1]
                vox[(x, 1, z)] = g
    for x, z in ((3, 6), (4, 12), (13, 4), (6, 14), (14, 12)):      # grass tufts
        vox[(x, 2, z)] = grass[3]
    # stem: a slightly bulging cylinder, shadowed under the cap
    for y in range(2, 11):
        r = 2.7 if y < 4 else 2.4
        for x in range(N):
            for z in range(N):
                dx, dz = x + 0.5 - c, z + 0.5 - c
                if math.hypot(dx, dz) <= r:
                    t = (lit(dx, 0, dz) + 1) / 2
                    if y >= 9:
                        t *= 0.45
                    vox[(x, y, z)] = pick(C[1:], t)
    # the skirt (ring) around the stem
    for x in range(N):
        for z in range(N):
            dx, dz = x + 0.5 - c, z + 0.5 - c
            if 2.4 < math.hypot(dx, dz) <= 3.5:
                vox[(x, 7, z)] = C[2] if lit(dx, 0.3, dz) > 0 else C[1]
    # cap: a squashed dome, red with cream spots, gills underneath
    spots = [(-0.6, 0.55, 0.55), (0.45, 0.6, 0.65), (0.8, 0.45, -0.35), (-0.15, 0.98, 0.1),
             (-0.8, 0.4, -0.45), (0.3, 0.75, -0.6), (0.0, 0.35, 0.95), (0.95, 0.3, 0.2), (-0.95, 0.3, 0.1)]
    spots = [tuple(v / math.sqrt(sum(q * q for q in s)) for v in s) for s in spots]
    cy, rx, ry = 10.0, 7.4, 6.0
    for y in range(10, 17):
        for x in range(N):
            for z in range(N):
                dx, dy, dz = (x + 0.5 - c) / rx, (y + 0.5 - cy) / ry, (z + 0.5 - c) / rx
                if dx * dx + dy * dy + dz * dz > 1:
                    continue
                nl = math.sqrt(dx * dx + dy * dy + dz * dz) or 1
                n = (dx / nl, dy / nl, dz / nl)
                li = lit(*n)
                col = R[1] if li < -0.1 else R[2] if li < 0.68 else R[3]
                if li > 0.93:
                    col = R[4]
                if y == 10:
                    col = C[1] if math.hypot(x + 0.5 - c, z + 0.5 - c) < 6.4 else R[1]
                elif any(sum(p * q for p, q in zip(n, s)) > 0.972 for s in spots):
                    col = C[3] if lit(*n) > 0.35 else C[2]
                vox[(x, y, z)] = col
    # a baby mushroom with an orange cap
    vox[(14, 2, 13)] = C[2]
    vox[(14, 3, 13)] = C[2]
    for x in (13, 14, 15):
        for z in (12, 13, 14):
            vox[(x, 4, z)] = BRAND if (x, z) != (13, 12) else "#ff8a4c"
    vox[(14, 5, 13)] = "#ff8a4c"
    a.call("new_model", size_x=N, size_y=N, size_z=N, name="Red Mushroom")
    send_voxels(a, vox)
    return "Red Mushroom", "voxel"


# ---------------------------------------------------------------- 4. torch

def flame(grid, cx, base, h, half, lean, wob, phase, chars="yYOR"):
    """A teardrop flame standing on row `base`, `h` rows tall, leaning `lean` pixels at the tip.
    Rows are bands of heat: white-yellow core at the bottom middle, orange body, an orange-red rim."""
    core, inner, mid, edge = chars
    cells = {}
    for r in range(base, base - h - 1, -1):
        t = (base - r) / h
        w = half * math.sin(math.pi * min(1.0, 0.27 + t * 0.73)) + 0.3
        c = cx + lean * t ** 1.6 + wob * math.sin(phase + t * 5.5) * t
        for x in range(grid.w):
            d = abs(x + 0.5 - c) / w
            if d <= 1:
                cells[(x, r)] = (d, t)
    for (x, r), (d, t) in cells.items():
        rim = (x - 1, r) not in cells or (x + 1, r) not in cells or (x, r - 1) not in cells
        if rim and r != base:
            ch = edge
        elif d < 0.45 and t < 0.4:
            ch = core
        elif d < 0.7 and t < 0.62:
            ch = inner
        else:
            ch = mid
        grid.put(x, r, ch)


def torch(a):
    Wd = RAMPS["wood"]
    B = RAMPS["bomb"]
    F = RAMPS["flame"]
    legend = {"o": Wd[0], "1": Wd[1], "2": Wd[2], "3": Wd[3],
              "k": B[0], "m": B[1], "n": B[2], "N": B[3], "M": B[4],
              "y": "#fff691", "Y": F[3], "O": F[2], "R": BRAND, "r": F[1]}
    base = Grid(16, 32)
    # the handle: a tapered stick lit from the left, with two leather wraps
    for y in range(16, 30):
        x0, x1 = (6, 9) if y < 27 else (7, 9) if y < 29 else (7, 8)
        for x in range(x0, x1 + 1):
            c = "3" if x == x0 else "1" if x == x1 else "2"
            base.put(x, y, c)
    for y in (18, 23):                                 # iron bands
        for x in range(6, 10):
            base.put(x, y, "N" if x == 6 else "n" if x < 9 else "m")
    for x, y in ((7, 26), (8, 20), (8, 21)):          # grain
        base.put(x, y, "1")
    # the iron cup
    base.stamp(4, 12, ["MNNNNNNn",
                       "Nnnnnnnm",
                       ".Nnnnnm.",
                       "..nnmm.."])
    # glowing coals in the cup
    for x, c in zip(range(5, 11), "rOOOOr"):
        base.put(x, 12, c)
    outline(base, "o")
    for y in range(11, 16):          # iron gets an iron-dark outline
        for x in range(16):
            if base.get(x, y) == "o":
                base.put(x, y, "k")
    frames = [  # (height, half width, lean, wobble, phase)
        (9, 3.0, 0.0, 0.6, 0.0),
        (10, 3.1, 0.8, 0.5, 1.0),
        (8, 3.2, 1.2, 0.4, 2.1),
        (10, 2.9, 0.2, 0.7, 3.2),
        (9, 3.1, -0.9, 0.5, 4.2),
        (8, 3.0, -0.5, 0.6, 5.3),
    ]
    sparks = [(), ((10, 2, "Y"),), ((11, 1, "R"),), (), ((4, 3, "O"),), ((4, 1, "R"),)]
    start(a, 16, 32, "Torch")
    for i, (h, half, lean, wob, ph) in enumerate(frames):
        g = base.copy()
        flame(g, 8.0, 11, h, half, lean, wob, ph)
        for x, y, c in sparks[i]:
            g.put(x, y, c)
        if i:
            a.call("add_frame", copy=False)
        paint(a, g, legend)
        a.call("set_frame_duration", duration_ms=(90, 80, 100, 80, 90, 100)[i])
    return "Torch", "animation"


# ---------------------------------------------------------------- 5. spellbook

def spellbook(a):
    P = RAMPS["purple"]
    G = RAMPS["gold"]
    C = RAMPS["cream"]
    Rr = RAMPS["red"]
    legend = {"o": P[0], "1": P[1], "2": P[2], "3": P[3], "4": P[4],
              "g": G[1], "G": G[2], "h": G[3], "H": G[4], "q": G[0],
              "c": C[1], "C": C[2], "W": C[3],
              "R": BRAND, "r": Rr[1], "b": Rr[2]}
    g = Grid(32, 32)
    X0, Y0, X1, Y1 = 4, 3, 22, 25          # the front cover
    # back cover and the block of pages, seen past the cover's right and bottom edges
    for x in range(X0 + 3, X1 + 4):
        for y in range(Y0 + 3, Y1 + 4):
            g.put(x, y, "1")
    for i, ch in ((2, "c"), (1, "C")):
        for x in range(X0 + i, X1 + i + 1):
            for y in range(Y0 + i, Y1 + i + 1):
                g.put(x, y, ch)
    for y in range(Y0 + 4, Y1 + 2, 3):     # page lines on the side
        g.put(X1 + 2, y, "W")
    for x in range(X0 + 4, X1 + 2, 4):     # and along the bottom
        g.put(x, Y1 + 1, "W")
    # front cover: purple leather lit from the top-left, spine on the left
    for x in range(X0, X1 + 1):
        for y in range(Y0, Y1 + 1):
            c = "2"
            if y == Y0 or x == X0 + 3:
                c = "3"
            if x == X1 or y == Y1:
                c = "1"
            if x < X0 + 3:
                c = "3" if x == X0 else "2" if x == X0 + 1 else "1"
            g.put(x, y, c)
    for y in (Y0 + 3, Y1 - 3):             # gold bands on the spine
        for x in range(X0, X0 + 3):
            g.put(x, y, "h" if x == X0 else "G")
    # embossed frame
    for x in range(X0 + 5, X1 - 1):
        g.put(x, Y0 + 2, "1")
        g.put(x, Y1 - 2, "3")
    for y in range(Y0 + 2, Y1 - 1):
        g.put(X0 + 5, y, "1")
        g.put(X1 - 2, y, "3")
    # gold corner caps on the open side
    g.stamp(X1 - 3, Y0, ["hhhh", ".hGG", "..GG", "...g"])
    g.stamp(X1 - 3, Y1 - 3, ["...G", "..GG", ".GGg", "Gggg"])
    # the emblem: a gold ring with an orange gem, four studs at the compass points
    g.stamp(9, 9, ["....h....",
                   "..hhhGG..",
                   ".h.....g.",
                   ".h.....g.",
                   "hh.....gg",
                   ".G.....g.",
                   ".G.....g.",
                   "..GGggg..",
                   "....g...."])
    g.stamp(11, 11, [".WR.",
                     "WRRR",
                     "RRRr",
                     ".Rr."])
    # clasp across the pages
    g.stamp(X1 - 1, 12, ["gGGGg",
                         "GhhHG",
                         "gGGGg"])
    # bookmark ribbon
    g.stamp(8, Y1 + 2, ["bR", "bR", "b.R"])
    outline(g, "o")
    start(a, 32, 32, "Spellbook")
    paint(a, g, legend)
    return "Spellbook", "sprite"


# ---------------------------------------------------------------- 6. bow & arrow

def in_triangle(p, a, b, c):
    def side(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def bow(a):
    Wd = RAMPS["wood"]
    B = RAMPS["bomb"]
    L = RAMPS["leather"]
    G = RAMPS["gold"]
    C = RAMPS["cream"]
    legend = {"o": Wd[0], "1": Wd[1], "2": Wd[2], "3": Wd[3], "4": Wd[4],
              "k": B[0], "m": B[2], "n": B[3], "N": B[4],
              "v": B[1], "V": B[2], "W": B[3],
              "h": G[3],
              "s": C[2],
              "R": BRAND, "P": "#ff8a4c", "r": RAMPS["flame"][1]}
    N = 32
    g = Grid(N, N)
    s1, s2 = (4.5, 26.5), (26.5, 4.5)      # string ends (bow tips)
    ctrl = (24.5, 24.5)                     # pulls the limbs into an arc bulging to the bottom-right

    def bez(t):
        u = 1 - t
        return (u * u * s1[0] + 2 * u * t * ctrl[0] + t * t * s2[0],
                u * u * s1[1] + 2 * u * t * ctrl[1] + t * t * s2[1])

    limb = {}
    for i in range(401):
        t = i / 400
        x, y = bez(t)
        thick = 0.6 + 1.0 * math.sin(math.pi * t) ** 1.5      # thick at the grip, thin at the tips
        for yy in range(N):
            for xx in range(N):
                px, py = xx + 0.5 - x, yy + 0.5 - y
                d = math.hypot(px, py)
                if d <= thick:
                    side = (px + py) / math.sqrt(2)              # >0: the outer (bottom-right) side
                    if (xx, yy) not in limb or d < limb[(xx, yy)][0]:
                        limb[(xx, yy)] = (d, side, thick)
    for (x, y), (d, side, thick) in limb.items():
        g.put(x, y, "3" if side < -0.25 else "1" if side > 0.45 else "2")
    # leather grip at the middle of the bow
    gx, gy = bez(0.5)
    for (x, y), (d, side, thick) in limb.items():
        if abs((x - y) - (gx - gy)) <= 2.6:
            g.put(x, y, "W" if side < -0.25 else "V" if side < 0.45 else "v")
    # gold caps on the tips
    for t in (0.0, 1.0):
        x, y = bez(t)
        g.put(int(x), int(y), "h")
    # the arrow: shaft along the other diagonal, steel head bottom-right, orange fletching top-left
    for k in range(7, 23):
        g.put(k, k, "3" if k % 5 else "2")
    head = mask_from(lambda x, y: in_triangle((x, y), (27.6, 27.6), (21.2, 25.0), (25.0, 21.2)), N, N, 4)
    for (x, y) in head:
        g.put(x, y, "n" if x < y else "m" if x > y else "N")
    # fletching: two swept-back vanes, the left one catching the light
    for x in range(N):
        for y in range(N):
            v, u = x - y, (x + y) / 2
            av = abs(v)
            lo, hi = {1: (5.5, 10.0), 2: (5.0, 9.0), 3: (5.0, 7.5)}.get(av, (99, 0))
            if lo <= u <= hi:
                if av == 3 or u <= lo + 0.5:
                    c = "r"
                else:
                    c = "P" if v < 0 else "R"
                g.put(x, y, c)
    for k in range(5, 11):
        g.put(k, k, "3")
    g.put(4, 4, "k")
    g.put(5, 5, "k")
    outline(g, "o")
    # the string, drawn last: a thin light line with no outline
    for x in range(5, 27):
        y = 31 - x
        if g.get(x, y) in ("o", "."):
            g.put(x, y, "s")
    start(a, N, N, "Bow & Arrow")
    paint(a, g, legend)
    return "Bow & Arrow", "sprite"


# ---------------------------------------------------------------- 7. barrel

def barrel(a):
    Wd = RAMPS["wood"]
    B = RAMPS["bomb"]
    N, H = 16, 18
    c = 8.0
    top = 15                       # the rim; the lid sits one voxel lower
    vox = {}
    staves = 14
    for y in range(0, top + 1):
        r = 5.0 + 1.2 * math.sin(math.pi * (y + 0.5) / (top + 1))       # bulging belly
        for x in range(N):
            for z in range(N):
                dx, dz = x + 0.5 - c, z + 0.5 - c
                d = math.hypot(dx, dz)
                if d > r:
                    continue
                inner = d < r - 1.2
                if y >= top - 1 and inner:
                    if y == top:
                        continue                                    # hollow above the lid
                    # the lid: planks running along x, a seam every 3 voxels
                    vox[(x, y, z)] = Wd[1] if z % 4 == 1 else Wd[3] if (z // 4) % 2 == 0 else Wd[2]
                    continue
                ang = math.atan2(dz, dx)
                k = (ang + math.pi) / (2 * math.pi) * staves
                seam = abs(k - round(k)) < 0.12
                li = lit(dx / d if d else 0, 0.15, dz / d if d else 0)
                col = Wd[1] if li < -0.2 else Wd[2] if li < 0.45 else Wd[3]
                if seam and not inner:
                    col = Wd[1] if li > -0.2 else Wd[0]
                if int(k) % 3 == 1 and not seam and li > 0.1:
                    col = Wd[2]                                     # one stave in three a little darker
                if y == top:
                    col = Wd[3] if li > -0.3 else Wd[2]             # the rim catches the light
                vox[(x, y, z)] = col
    # iron hoops, standing one voxel proud of the staves
    for y in (2, 3, 12, 13):
        r = 5.0 + 1.2 * math.sin(math.pi * (y + 0.5) / (top + 1)) + 0.8
        for x in range(N):
            for z in range(N):
                dx, dz = x + 0.5 - c, z + 0.5 - c
                d = math.hypot(dx, dz)
                if r - 1.6 < d <= r:
                    li = lit(dx / d, 0.2, dz / d)
                    vox[(x, y, z)] = B[1] if li < -0.2 else B[2] if li < 0.5 else B[3]
                    if y in (3, 12) and li > 0.75:
                        vox[(x, y, z)] = B[4]
    # an orange painted diamond on the front stave (the maker's mark)
    zf = max(z for (x, y, z) in vox if x == 8 and y == 8)
    for dy, xs in ((10, [8]), (9, [7, 8, 9]), (8, [6, 7, 8, 9, 10]), (7, [7, 8, 9]), (6, [8])):
        for x in xs:
            zz = max(z for (xx, yy, z) in vox if xx == x and yy == dy)
            vox[(x, dy, zz)] = BRAND if (dy, x) not in ((8, 6), (8, 10)) else "#c44b14"
    a.call("new_model", size_x=N, size_y=H, size_z=N, name="Barrel")
    send_voxels(a, vox)
    return "Barrel", "voxel"


# ---------------------------------------------------------------- 8. ramen bowl

def ramen(a):
    Bw = RAMPS["bowl"]
    Br = RAMPS["broth"]
    No = RAMPS["noodle"]
    C = RAMPS["cream"]
    St = RAMPS["steam"]
    Pk = RAMPS["pink"]
    F = RAMPS["flame"]
    legend = {"o": Bw[0], "1": Bw[1], "2": Bw[2], "3": Bw[3], "R": BRAND,
              "b": Br[1], "B": Br[2],
              "n": No[1],
              "c": C[1], "W": C[3],
              "s": St[1],
              "p": Pk[1],
              "y": F[2],
              "G": "#63c74d",
              "k": "#193c3e", "K": "#0e2917"}
    N = 32
    cx, cy = 15.5, 14.5
    g = Grid(N, N)

    def inside(x, y, rx, ry):
        return ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1

    # chopsticks (lacquered orange), leaning out of the bowl to the top-right; drawn first, behind
    for k in range(0, 8):
        g.put(21 + k, 12 - k, "R")
        g.put(22 + k, 12 - k, "1")
    # bowl body: round, deep red, lit from the top-left
    for y in range(int(cy), 28):
        t = (y + 0.5 - cy) / 12.5
        if t > 1:
            continue
        w = 13.5 * math.sqrt(max(0.0, 1 - t * t))
        for x in range(N):
            dx = (x + 0.5 - cx) / max(w, 0.1)
            if abs(dx) > 1:
                continue
            li = -0.9 * dx - 0.35 * t
            g.put(x, y, "3" if li > 0.6 else "2" if li > -0.4 else "1")
    for y in (21, 22):                      # an orange band around the bowl
        for x in range(N):
            if g.get(x, y) in ("2", "3"):
                g.put(x, y, "R")
            elif g.get(x, y) == "1":
                g.put(x, y, "2")
    for x in range(11, 21):                 # foot
        g.put(x, 27, "2" if x < 14 else "1")
    # rim: a 1-pixel cream lip around the broth
    for y in range(N):
        for x in range(N):
            if inside(x, y, 13.5, 4.6):
                g.put(x, y, "W" if x + 0.5 < cx + 5 else "c")
            if inside(x, y, 12.4, 3.6):
                g.put(x, y, "b" if y + 0.5 < cy - 1.6 else "B")
    # noodles: a mound of wavy strands in the middle
    for x in range(8, 24):
        for row, ph in ((15, 0.0), (16, 1.7), (17, 3.1)):
            y = row + (1 if math.sin(x * 1.1 + ph) > 0.35 else 0)
            if row == 17 and not (10 <= x <= 21):
                continue
            if g.get(x, y) in ("b", "B"):
                g.put(x, y, "n" if (x + row) % 4 else "W")
    # nori sheet standing up at the back left
    g.stamp(6, 6, ["kkkK",
                   "kkkK",
                   "kkkK",
                   "kGkK",
                   "kkkK",
                   "kkKK",
                   "kkK."])
    # half an egg at the front left, narutomaki at the back, chashu at the front right
    g.stamp(4, 14, [".WWW.",
                    "WWyyW",
                    "WyyyW",
                    ".WWc."])
    g.stamp(13, 10, [".WWW.",
                     "WpppW",
                     "WpWpc",
                     ".Wcc."])
    g.stamp(21, 14, [".33p.",
                     "3p33p",
                     ".2p2."])
    for x, y in ((11, 12), (12, 12), (19, 12), (18, 18), (19, 18), (10, 17)):   # spring onion
        if g.get(x, y) in ("b", "B", "n"):
            g.put(x, y, "G")
    outline(g, "o")
    # steam: three wisps sliding up an S-shaped path; period 6 frames so the loop is seamless
    wisps = [(11.0, 0.0, 0), (16.5, 2.2, 2), (21.0, 4.1, 4)]     # x, wiggle phase, frame offset
    start(a, N, N, "Ramen Bowl")
    for f in range(6):
        fr = g.copy()
        for x0, ph, off in wisps:
            ff = (f + off) % 6
            for seg_bottom in (10 - ff, 16 - ff):
                for y in range(seg_bottom - 4, seg_bottom + 1):
                    if not 1 <= y <= 10:
                        continue
                    x = int(round(x0 + 1.4 * math.sin(y * 0.75 + ph)))
                    if fr.get(x, y) == ".":
                        fr.put(x, y, "s" if y <= 3 else "W")
        if f:
            a.call("add_frame", copy=False)
        paint(a, fr, legend)
        a.call("set_frame_duration", duration_ms=120)
    return "Ramen Bowl", "animation"


ASSETS = {
    "item-bomb": bomb,
    "item-key": key,
    "item-mushroom": mushroom,
    "item-torch": torch,
    "item-spellbook": spellbook,
    "item-bow": bow,
    "item-barrel": barrel,
    "item-ramen": ramen,
}


def main(slugs):
    a = op.Agent()
    a.call("pixel_art_guide", topic="all")
    review_only = "--review" in slugs
    slugs = [s for s in slugs if not s.startswith("--")] or list(ASSETS)
    for slug in slugs:
        title, kind = ASSETS[slug](a)
        if review_only:
            info = a.call("get_model_info")
            for f in range(len(info["frames"])) if kind == "animation" else [None]:
                check(a, f"{slug}-f{f}" if f is not None else slug, f)
                if kind == "animation":
                    break
        else:
            col.publish(a, slug, title, kind)
    a.close()


if __name__ == "__main__":
    main(sys.argv[1:])

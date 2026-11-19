#!/usr/bin/env python3
"""Explore page, Characters set A: drawn with OpenPixel (v1.1.0 harness) over MCP.

    OPENPIXEL=…/OpenPixel python3 characters_a.py [slug …]

Every sprite is described as text rows. Symmetric bodies are drawn as a left half and mirrored, then the light
(top-left) is applied by darkening the right side, and props (weapons, shields, capes) are laid on top.
Each piece carries one detail in OpenPixel orange #FF4A1C.
"""
import sys

import common
import op

W = 32
ORANGE = "#ff4a1c"


# ---------------------------------------------------------------- row helpers

def blank(w=W, h=W):
    return [["."] * w for _ in range(h)]


def mirror(halves, w=W):
    """Full rows from left halves (each w/2 wide): the right half is the left half flipped."""
    out = []
    for h in halves:
        h = h.ljust(w // 2, ".")[: w // 2]
        out.append(list(h + h[::-1]))
    return out


def put(g, x, y, block):
    """Lays text rows on the grid at (x, y); '.' leaves the cell as it is, ' ' clears it."""
    for j, row in enumerate(block):
        for i, ch in enumerate(row):
            yy, xx = y + j, x + i
            if ch == "." or not (0 <= yy < len(g) and 0 <= xx < len(g[0])):
                continue
            g[yy][xx] = "." if ch == " " else ch


def remap(g, mapping, x0=0, x1=None, y0=0, y1=None):
    """Recolours characters inside a box (used to put the right side of a form in shadow)."""
    x1 = len(g[0]) if x1 is None else x1
    y1 = len(g) if y1 is None else y1
    for y in range(y0, y1):
        for x in range(x0, x1):
            if g[y][x] in mapping:
                g[y][x] = mapping[g[y][x]]


def shift_rows(g, y0, y1, dy):
    """Moves rows y0..y1-1 down by dy (rows above y0+dy are cleared)."""
    rows = [r[:] for r in g]
    for y in range(y0, y1):
        g[y] = ["."] * len(g[0])
    for y in range(y0, y1):
        t = y + dy
        if 0 <= t < len(g):
            for x, ch in enumerate(rows[y]):
                if ch != ".":
                    g[t][x] = ch
    return g


def text(g):
    return ["".join(r) for r in g]


def ramp(a, base, steps=5, hue_shift=None):
    args = {"base": base, "steps": steps}
    if hue_shift is not None:
        args["hue_shift"] = hue_shift
    return a.call("make_color_ramp", **args)["colors"]


def paint(a, g, legend, frame=None):
    args = {"rows": text(g), "legend": legend, "axis": "z", "index": 0}
    if frame is not None:
        args["frame"] = frame
    a.call("paint_slice", **args)


def frames(a, grids, legend, durations):
    """Paints one grid per frame and sets each frame's duration."""
    for i, g in enumerate(grids):
        if i > 0:
            a.call("add_frame", copy=False)
        paint(a, g, legend, frame=i)
        a.call("set_frame_duration", frame=i, duration_ms=durations[i])


# ---------------------------------------------------------------- 1. Knight

def knight(a, col):
    a.call("new_sprite", width=32, height=32, name="Knight")
    steel = ramp(a, "#5f7194")          # dark → light
    blue = ramp(a, "#2f5fb3", 4)
    gold = ramp(a, "#e8b048", 4)
    plume = ramp(a, ORANGE, 4)
    L = {
        "O": steel[0], "k": "#2b2f4f", "1": steel[1], "2": steel[2], "3": steel[3], "4": steel[4],
        "b": blue[1], "B": blue[2], "c": blue[3],
        "G": gold[1], "g": gold[2], "h": gold[2],
        "r": plume[1], "R": plume[2], "y": plume[3],
        "w": "#4f201c", "W": "#7a4632", "e": plume[3],
    }
    halves = [
        "................",
        "................",
        "................",
        "................",
        "...........OOOOO",
        ".........OO34444",
        "........O3444444",
        "........O3344444",
        ".......O23333333",
        ".......O22333333",
        ".......O1kkkkkkk",
        ".......O1kkkkekk",
        ".......O12222222",
        ".......O1222k2k2",
        "........O1122222",
        ".........OO11111",
        "......OOOO1OOkkk",
        ".....O3443OOBBBB",
        ".....O3433O1cBBB",
        ".....O2332O1cBBB",
        "......O22OO1BBBB",
        "......O2O.O1BBBB",
        "......O2O.OWWWWg",
        "......O1O.OwWWWw",
        "..........O1bBBB",
        "..........O1bbBB",
        "..........O122O.",
        "..........O123O.",
        ".........OO123O.",
        ".........O11222O",
        ".........OOOOOOO",
        "................",
    ]
    plume_a = [
        "...OOOO...",
        ".OOyyRROO.",
        "OyyRRRRrrO",
        "OyRRRRrrrO",
    ]
    plume_b = [
        "..OOOO....",
        ".OyyRRROO.",
        "OyRRRRRrrO",
        "OyRRRRrrrO",
    ]
    emblem = [
        ".O.",
        "OgO",
        ".O.",
    ]
    sword = [
        "..O.",
        ".O4O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        ".O43O",
        "OOOOOO",
        "OhggGO",
        "OO33OO",
        ".O32O.",
        ".OOgO.",
        "..OO..",
    ]
    shield = [
        "OOOOOOOOOO",
        "O34444432O",
        "O3cBBgBBkO",
        "O3BBBgBbkO",
        "O3gggggGkO",
        "O3BBBgBbkO",
        ".O3BBgbkO.",
        ".O3BBgbkO.",
        "..O3BGkO..",
        "..O3bbkO..",
        "...O2kO...",
        "....OO....",
    ]

    def frame(dy, pl):
        g = mirror(halves)
        # light from the top-left: the right side of the helmet, armour and legs sits in shadow
        remap(g, {"4": "3", "3": "2", "2": "1", "c": "B", "B": "b"}, x0=19)
        remap(g, {"4": "3"}, x0=16)
        if dy:
            shift_rows(g, 0, 26, dy)
        put(g, 11, 1 + dy, pl)
        put(g, 15, 18 + dy, ["gg", "GG"])
        put(g, 2, 7 + dy, sword)
        put(g, 20, 16 + dy, shield)
        return g

    frames(a, [frame(0, plume_a), frame(1, plume_a), frame(1, plume_b), frame(0, plume_b)], L, [260, 140, 260, 140])
    a.call("pixel_perfect", all_frames=True)
    return "char-knight", "Knight", "animation"


# ---------------------------------------------------------------- 2. Wizard

def wizard(a, col):
    a.call("new_sprite", width=32, height=32, name="Wizard")
    robe = ramp(a, "#6a3fa0", 5)
    beard = ramp(a, "#d8d0b8", 5)
    skin = ramp(a, "#e0a27a", 5)
    wood = ramp(a, "#7a4632", 3)
    orb = ramp(a, ORANGE, 4)
    L = {
        "O": "#17152c", "p": robe[1], "P": robe[2], "q": robe[3],
        "w": beard[1], "W": beard[2], "x": beard[3],
        "s": skin[1], "S": skin[2], "e": "#17152c", "n": skin[1],
        "G": "#975a29", "g": "#e8b048",
        "t": wood[0], "T": wood[1], "u": "#e8b048",
        "r": orb[1], "R": orb[2], "y": orb[3], "z": beard[3],
        "k": "#242231",
    }
    halves = [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "........OOOOOOOO",
        "....OOOOqqPPPPPP",
        "...OqqqPPPPPPPPP",
        "....OOOOOOOOOOOO",
        "........OsssssSS",
        "........OSSeSSSS",
        "........OwSSSSnn",
        ".......OwwWWWWWW",
        "......OPOwxWWWWW",
        ".....OqPPOwxWWWW",
        ".....OqPPPOwxWWW",
        "....OqPPPPPOwWWW",
        "....OqPPPPPPOwWW",
        "....OqPPPPPPPOwW",
        "...OqPPPPPPPPPOw",
        "...OqPPPPPPPPPPg",
        "...OqPPPPPPPPPPg",
        "..OqPPPPPPPPPPPg",
        "..OqPPPPPPPPPPPg",
        "..OgggggggggggGG",
        "..OOOOOOOOOOOOOO",
        "........OttTO...",
        "................",
    ]
    hat = [
        "............OOO",
        "...........OPpO",
        "..........OqPpO",
        ".........OqPPpO",
        "........OqPPPpO",
        ".......OqPPPPpO",
        "......OqPPPPPPpO",
        ".....OggggRRgggGO",
    ]
    staff = [
        ".OO.",
        "OttO",
        "OTtO",
        "OTtO",
    ]
    hand = [
        "OOO",
        "SSO",
        "sSO",
        "OO.",
    ]
    # the orb at the head of the staff, and the glow around it, per frame (radius of the halo, sparkles)
    orb_core = [
        ".OOOO.",
        "OyRRrO",
        "OyRRrO",
        "ORRrrO",
        ".OOOO.",
    ]
    orb_hot = [
        ".OOOO.",
        "OzyyRO",
        "OyyRRO",
        "ORRRrO",
        ".OOOO.",
    ]
    sparks = [
        [],
        [(23, 3, "y")],
        [(22, 2, "y"), (30, 9, "R")],
        [(21, 1, "z"), (29, 10, "y"), (24, 9, "R")],
        [(30, 1, "y"), (22, 8, "y")],
        [(24, 5, "R")],
    ]
    glow = [0, 1, 2, 2, 1, 0]

    def frame(i):
        g = mirror(halves)
        remap(g, {"q": "P"}, x0=16)
        remap(g, {"W": "w", "x": "W", "S": "s"}, x0=20)
        remap(g, {"P": "p"}, x0=22)
        put(g, 7, 1, hat)
        # staff from the orb down to the ground, held in the right hand
        for y in range(8, 30):
            g[y][26] = "O"
            g[y][27] = "T" if y % 6 else "u"
            g[y][28] = "t"
            g[y][29] = "O"
        put(g, 24, 17, hand)
        put(g, 25, 3, orb_hot if glow[i] else orb_core)
        if glow[i] == 2:
            for x, y in [(24, 3), (31 - 1, 3), (24, 7), (30, 7)]:
                if g[y][x] == ".":
                    g[y][x] = "r"
        for x, y, c in sparks[i]:
            if 0 <= y < 32 and 0 <= x < 31 and g[y][x] == ".":
                g[y][x] = c
        return g

    frames(a, [frame(i) for i in range(6)], L, [180, 110, 110, 160, 110, 110])
    a.call("pixel_perfect", all_frames=True)
    return "char-wizard", "Wizard", "animation"


# ---------------------------------------------------------------- 3. Slime

def blob(w, h, lift, size=24, ground=21, cx=12.0, p=2.2):
    """A shaded jelly dome: shape and light (top-left) worked out per pixel."""
    g = blank(size, size)
    bottom = ground - lift
    inside = set()
    for y in range(size):
        t = (bottom + 1 - (y + 0.5)) / h
        if not 0 <= t <= 1:
            continue
        hw = (w / 2) * (1 - t ** p) ** (1 / p)
        for x in range(size):
            if abs(x + 0.5 - cx) <= hw:
                inside.add((x, y))
    for (x, y) in inside:
        u = (x + 0.5 - cx) / (w / 2)
        t = (bottom + 1 - (y + 0.5)) / h
        r2 = u * u + t * t
        if r2 > 1:
            u, t, nz = u / r2 ** 0.5, t / r2 ** 0.5, 0.0
        else:
            nz = (1 - r2) ** 0.5
        light = -0.5 * u + 0.5 * t + 0.7 * nz
        edge = any((x + dx, y + dy) not in inside for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            g[y][x] = "O" if (y == bottom or u > -0.2 or t < 0.35) else "s"
        elif light > 0.93:
            g[y][x] = "L"
        elif light > 0.55:
            g[y][x] = "M"
        else:
            g[y][x] = "s"
    # a glossy highlight up on the lit side
    hx, hy = int(cx - w * 0.26), int(bottom - h * 0.72)
    for x, y in ((hx, hy), (hx + 1, hy), (hx, hy + 1)):
        if (x, y) in inside and g[y][x] != "O":
            g[y][x] = "H"
    # face
    ey = int(round(bottom - h * 0.42))
    for ex in (int(cx - w * 0.2), int(cx + w * 0.16)):
        for y in (ey - 1, ey):
            if (ex, y) in inside:
                g[y][ex] = "O"
    my = ey + 2
    if my < bottom:
        g[my][int(cx) - 1] = "s"
        g[my][int(cx)] = "s"
    # a little orange sprout on its head
    top = min(y for (_, y) in inside)
    sx = int(cx)
    for x, y, c in ((sx, top - 1, "r"), (sx, top - 2, "R"), (sx + 1, top - 2, "R"), (sx + 1, top - 3, "y")):
        g[y][x] = c
    # its shadow on the ground, smaller the higher it jumps
    sw = max(4, int(w * (0.9 - lift * 0.08)))
    for x in range(int(cx - sw / 2), int(cx + sw / 2)):
        if g[ground + 1][x] == ".":
            g[ground + 1][x] = "d"
    return g


def slime(a, col):
    a.call("new_sprite", width=24, height=24, name="Slime")
    green = ramp(a, "#3e8948", 5)
    orange = ramp(a, ORANGE, 4)
    L = {"O": green[0], "s": green[1], "M": green[2], "L": green[3], "H": green[4],
         "r": orange[1], "R": orange[2], "y": orange[3], "d": "#2a2838"}
    poses = [  # (width, height, lift)
        (16, 11, 0),   # rest
        (19, 8, 0),    # squash: about to jump
        (12, 15, 2),   # stretch: take-off
        (14, 13, 6),   # top of the jump
        (12, 15, 2),   # falling
        (20, 8, 0),    # landing splat
    ]
    poses[4] = (13, 14, 2)
    frames(a, [blob(*p) for p in poses], L, [220, 90, 70, 140, 70, 110])
    a.call("pixel_perfect", all_frames=True)
    a.call("set_active", frame=0)
    return "char-slime", "Slime", "animation"


# ---------------------------------------------------------------- 4. Skeleton

def skeleton(a, col):
    a.call("new_sprite", width=32, height=32, name="Skeleton")
    bone = ramp(a, "#d8d0b8", 5)
    steel = ramp(a, "#8a96b0", 4)
    L = {
        "O": "#1c1a26", "k": "#1c1a26", "e": ORANGE,
        "d": bone[1], "B": bone[2], "b": bone[3], "H": bone[4],
        "a": steel[2], "A": steel[1], "u": "#9a4a2a", "G": "#7a4632", "g": "#b18660",
    }
    body = [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "..............Ob",
        "..........OOOOOb",
        "........OObbbbbb",
        ".......ObbOOOOOb",
        ".......ObOObbbOb",
        ".......ObOOOOOOb",
        ".......ObOObbbOb",
        ".......ObOOOOOOb",
        ".......ObO.OObOb",
        ".......ObO..OOOb",
        ".......ObO.OObbb",
        "......ObbbOObbBB",
        "......OOOOO.ObOO",
        "............ObO.",
        "..........ObbbO.",
        "................",
    ]
    skull = [
        "....OOOOOOOO....",
        "..OObbbbbbbbOO..",
        ".ObbHHbbbbbbbbO.",
        ".ObHbbbbbbbbbBO.",
        "ObbbbbbbbbbbbBBO",
        "ObbOOObbbbOOObdO",
        "ObOkkkObbOkkkOdO",
        "ObOkekObbOkekOdO",
        "ObbOOObOObOOOBdO",
        ".ObbbbOkkOBBBdO.",
        ".ObbbbbOObBBBdO.",
        "..OObBdBdBdBOO..",
        "...OOOOOOOOOO...",
    ]
    sword = [
        ".OO.",
        "OaAO",
        "OaAO",
        "OaAO",
        "OauO",
        "OaAO",
        "OaAO",
        "OuAO",
        "OaAO",
        "OaAO",
    ]
    g = mirror(body)
    remap(g, {"b": "B", "B": "d"}, x0=17)
    put(g, 8, 3, skull)
    remap(g, {"b": "B"}, x0=19, y0=3, y1=16)
    remap(g, {"B": "d"}, x0=21, y0=3, y1=16)
    g[11][21] = "B"
    put(g, 22, 15, sword)
    put(g, 20, 25, ["OOOOOOO", "OgGGGGO", "OOObbOO"])
    put(g, 22, 28, [".OGO", "..O."])
    paint(a, g, L)
    a.call("pixel_perfect")
    a.call("pixel_perfect")
    return "char-skeleton", "Skeleton", "sprite"


# ---------------------------------------------------------------- 5. Pirate Captain

def pirate(a, col):
    a.call("new_sprite", width=32, height=32, name="Pirate Captain")
    coat = ramp(a, "#c03030", 5)
    hat = ramp(a, "#3a3a48", 5)
    skin = ramp(a, "#e0a27a", 5)
    gold = ramp(a, "#e8b048", 4)
    feather = ramp(a, ORANGE, 4)
    L = {
        "O": "#17121e",
        "c": coat[1], "C": coat[2], "l": coat[3],
        "d": hat[1], "H": hat[2], "h": hat[3],
        "s": skin[1], "S": skin[2], "k": "#17121e",
        "G": "#7a4632", "g": gold[2],
        "b": "#4a1f1c", "B": "#7a4632",
        "w": "#d8d0b8",
        "K": hat[1], "t": "#4a1f1c", "T": "#7a4632",
        "r": coat[2], "R": feather[2], "y": feather[3],
        "m": "#9aa4b8", "M": hat[2],
    }
    body = [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "..........OsssSS",
        "..........OSSkSS",
        ".........OSSSSSS",
        "..........OSSSSs",
        "..........ObSbbb",
        "........OOObbBbb",
        ".......OlCOObbbb",
        "......OlCCCOObbB",
        ".....OlCCCCCOObw",
        ".....OlCCCCCgOww",
        ".....OlCCCCCCOww",
        ".....OKKKKKKKKKg",
        ".....OlCCCCCCOww",
        ".....OlCCCCCgOww",
        "......OlCCCCCOOw",
        "......OlCCCCCCOO",
        "......OggggggggO",
        "..........OKKO..",
        "..........OKKO..",
        ".........OKKKO..",
        ".........OOOOO..",
        "................",
    ]
    tricorn = [
        ".......OOOOOO.......",
        "......OhHHHHHO......",
        ".OO..OhHHHHHHHO..OO.",
        "OhhOOhHHHHHHHHHOOddO",
        "OhHHhHHHHHHHHHHHdddO",
        "OhggggggggggggggggdO",
        ".OHHHHHHHHHHHHHHHdO.",
        "..OOOOOOOOOOOOOOOO..",
    ]
    plume = [
        ".OO..",
        "OyRO.",
        "OyRrO",
        ".OyRO",
        "..OO.",
    ]
    arm_l = [
        "OO.",
        "lCO",
        "lCO",
        "lCO",
        "CcO",
        "gGO",
        "SsO",
        "OO.",
    ]
    cutlass = [
        "........O",
        ".......OmO",
        "......OmMO",
        ".....OmMO.",
        "....OmMO..",
        "...OmMO...",
        "OOOmMO....",
        "OgGgO.....",
        ".OGO......",
        ".OSO......",
        ".OO.......",
    ]
    g = mirror(body)
    remap(g, {"l": "C"}, x0=16)
    remap(g, {"C": "c", "S": "s", "B": "b"}, x0=20)
    # the eye patch and its strap
    for x, y in [(17, 11), (18, 11), (19, 11), (18, 12), (17, 12), (16, 10), (15, 10), (14, 10), (20, 10)]:
        g[y][x] = "k"
    # peg leg (right) instead of a boot
    for y in range(27, 31):
        for x in range(17, 23):
            g[y][x] = "."
    for y, row in zip(range(27, 31), ["OtTO", "OtTO", ".OTO", ".OO."]):
        for i, ch in enumerate(row):
            if ch != ".":
                g[y][18 + i] = ch
    put(g, 6, 2, tricorn)
    put(g, 3, 1, plume)
    put(g, 3, 16, arm_l)
    put(g, 26, 16, ["OO.", "COO", "cCO", "cCO", "ccO", "GGO", "ssO", "OO."])
    put(g, 1, 15, cutlass)
    paint(a, g, L)
    a.call("pixel_perfect")
    return "char-pirate", "Pirate Captain", "sprite"


# ---------------------------------------------------------------- 6. Ninja (run cycle from a posed skeleton)

def limb(cells, p0, p1, ch, width=2):
    """A thick line from p0 to p1 into cells {(x, y): ch}."""
    (x0, y0), (x1, y1) = p0, p1
    n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(n + 1):
        t = i / n
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for ox in range(width):
            for oy in range(width):
                cells[(int(round(x - (width - 1) / 2 + ox)), int(round(y - (width - 1) / 2 + oy)))] = ch


def disc(cells, cx, cy, r, ch):
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                cells[(x, y)] = ch


def outlined(layers, size=32, light=None):
    """Stacks shape layers (later ones in front), lights each shape's top-left edge and outlines everything."""
    g = blank(size, size)
    for cells, base, lit in layers:
        for (x, y), ch in cells.items():
            if not (0 <= x < size and 0 <= y < size):
                continue
            c = ch
            if ch == base and lit and ((x - 1, y) not in cells or (x, y - 1) not in cells) and \
                    ((x + 1, y) in cells and (x, y + 1) in cells):
                c = lit
            g[y][x] = c
    ol = [(x, y) for y in range(size) for x in range(size) if g[y][x] == "." and any(
        0 <= x + dx < size and 0 <= y + dy < size and g[y + dy][x + dx] not in ".O"
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for x, y in ol:
        g[y][x] = "O"
    return g


def ninja(a, col):
    a.call("new_sprite", width=32, height=32, name="Ninja")
    suit = ramp(a, "#3b4466", 5)
    band = ramp(a, ORANGE, 4)
    skin = ramp(a, "#e0a27a", 5)
    L = {"O": "#0e0d18", "f": suit[1], "n": suit[2], "N": suit[3], "h": suit[4], "k": suit[1],
         "s": skin[2], "e": "#0e0d18", "r": band[1], "R": band[2], "y": band[3],
         "t": "#4f201c", "T": "#975a29", "m": "#c8d4e4"}
    legs = [  # near leg (knee, foot) relative to the hip, one per frame
        ((4, 4), (7, 9)),
        ((3, 4), (2, 9)),
        ((0, 5), (-4, 8)),
        ((-2, 4), (-6, 5)),
        ((2, 3), (-1, 6)),
        ((5, 2), (6, 7)),
    ]
    arms = [  # arm (elbow, hand) relative to the shoulder
        ((3, 3), (6, 1)),
        ((2, 4), (5, 3)),
        ((0, 4), (2, 6)),
        ((-3, 3), (-5, 5)),
        ((-2, 4), (-3, 7)),
        ((0, 4), (2, 6)),
    ]
    bob = [0, 1, 0, 0, 1, 0]
    tails = [
        [(13, 8), (12, 8), (11, 9), (10, 9), (9, 9), (8, 10)],
        [(13, 8), (12, 9), (11, 9), (10, 10), (9, 10), (8, 10)],
        [(13, 8), (12, 8), (11, 8), (10, 9), (9, 9), (8, 9)],
        [(13, 8), (12, 8), (11, 9), (10, 9), (9, 10), (8, 10)],
        [(13, 8), (12, 9), (11, 9), (10, 9), (9, 10), (8, 11)],
        [(13, 8), (12, 8), (11, 8), (10, 9), (9, 9), (8, 10)],
    ]

    def frame(i):
        b = bob[i]
        hip, sh = (14.5, 19.5 + b), (16.5, 13.5 + b)
        hx, hy = 19.0, 9.5 + b
        far_leg, near_leg, far_arm, near_arm, back, torso, head, front = {}, {}, {}, {}, {}, {}, {}, {}
        for cells, (knee, foot), ch in ((far_leg, legs[(i + 3) % 6], "f"), (near_leg, legs[i], "N")):
            k = (hip[0] + knee[0], hip[1] + knee[1])
            f = (hip[0] + foot[0], hip[1] + foot[1])
            limb(cells, hip, k, ch)
            limb(cells, k, f, ch)
            limb(cells, f, (f[0] + 1.5, f[1]), ch)
        for cells, (elbow, hand), ch in ((far_arm, arms[i], "f"), (near_arm, arms[(i + 3) % 6], "N")):
            e = (sh[0] + elbow[0], sh[1] + elbow[1])
            h = (sh[0] + hand[0], sh[1] + hand[1])
            limb(cells, sh, e, ch)
            limb(cells, e, h, ch)
        # katana on the back, its hilt over the shoulder
        limb(back, (11.5, 9.5 + b), (18.5, 19.5 + b), "t", 1)
        limb(back, (11.5, 9.5 + b), (12.5, 10.5 + b), "T", 1)
        limb(torso, sh, hip, "n", 5)
        disc(head, hx, hy, 4.4, "n")
        # a dark sash tied at the waist
        limb(torso, (hip[0] - 2, hip[1] - 1), (hip[0] + 2, hip[1] - 1), "k", 1)
        g = outlined([(far_arm, "f", None), (far_leg, "f", None), (back, "t", None), (torso, "n", "N"),
                      (head, "n", "N"), (near_leg, "N", "h"), (near_arm, "N", "h")])
        # mask opening and eye (facing right), headband with fluttering tails
        ey = int(hy)
        for x in range(int(hx), int(hx) + 4):
            if g[ey][x] not in ".O":
                g[ey][x] = "s"
        g[ey][int(hx) + 2] = "e"
        for x in range(int(hx) - 4, int(hx) + 4):
            if g[ey - 2][x] not in ".O":
                g[ey - 2][x] = "R" if x < int(hx) + 2 else "y"
        for j, (x, y) in enumerate(tails[i]):
            g[y + b][x] = "R" if j < 4 else "r"
            if g[y + b - 1][x] == ".":
                g[y + b - 1][x] = "O"
            if g[y + b + 1][x] == ".":
                g[y + b + 1][x] = "O"
        return g

    frames(a, [frame(i) for i in range(6)], L, [110, 80, 80, 110, 80, 80])
    a.call("pixel_perfect", all_frames=True)
    a.call("pixel_perfect", all_frames=True)
    return "char-ninja", "Ninja", "animation"


# ---------------------------------------------------------------- 8. Ghost

def ghost_frame(i, size=24):
    dy = [0, 1, 2, 1][i]
    cx, cy, r = 12.0, 8.5 + dy, 7.2
    g = blank(size, size)
    inside = set()
    for y in range(size):
        for x in range(size):
            u = (x + 0.5 - cx) / r
            if y + 0.5 <= cy:
                ok = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r
            else:
                hem = int(cy + 8) + [0, 1, 2, 1][(x + i) % 4]
                ok = abs(u) <= 1 and y <= hem
            if ok:
                inside.add((x, y))
    for (x, y) in inside:
        u = (x + 0.5 - cx) / r
        v = max(0.0, (cy - (y + 0.5)) / r)
        nz = max(0.0, 1 - u * u - v * v) ** 0.5
        light = -0.5 * u + 0.45 * v + 0.75 * nz - 0.025 * max(0, y - cy)
        edge = any((x + dx, y + dy2) not in inside for dx, dy2 in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            g[y][x] = "O"
        elif light > 0.86:
            g[y][x] = "L"
        elif light > 0.6:
            g[y][x] = "M"
        elif light > 0.32:
            g[y][x] = "S"
        else:
            g[y][x] = "D"
    ey = int(cy)
    for ex in (8, 14):
        for yy in (ey - 1, ey, ey + 1):
            g[yy][ex] = "e"
            g[yy][ex + 1] = "e"
        g[ey - 1][ex] = "L"
    g[ey + 3][11] = "e"
    g[ey + 3][12] = "e"
    g[ey + 2][7] = "p"
    g[ey + 2][16] = "p"
    # a little arm holding an orange candle flame
    ay = ey + 4
    put(g, 18, ay - 4, [
        "..y.",
        ".yRO",
        "OrRO",
        ".OwO",
        "OSwO",
        "OOOO",
    ] if i % 2 == 0 else [
        ".y..",
        ".RyO",
        "OrRO",
        ".OwO",
        "OSwO",
        "OOOO",
    ])
    return g


def ghost(a, col):
    a.call("new_sprite", width=24, height=24, name="Ghost")
    pale = ramp(a, "#b8c8e0", 5)
    flame = ramp(a, ORANGE, 4)
    L = {"O": pale[0], "D": pale[1], "S": pale[2], "M": pale[3], "L": pale[4], "e": pale[0],
         "p": "#f2aac0", "r": flame[1], "R": flame[2], "y": flame[3], "w": "#eeecd3", "d": "#2a2838"}
    frames(a, [ghost_frame(i) for i in range(4)], L, [240, 160, 240, 160])
    a.call("pixel_perfect", all_frames=True)
    return "char-ghost", "Ghost", "animation"


# ---------------------------------------------------------------- 7. Astronaut (voxels)

def astronaut(a, col):
    sx, sy, sz = 20, 28, 14
    a.call("new_model", size_x=sx + 2, size_y=sy + 1, size_z=sz + 2, name="Astronaut")
    suit = ramp(a, "#dfe3ee", 5)
    grey = ramp(a, "#7d8496", 4)
    visor = ramp(a, "#2f4f9a", 5)
    orange = ramp(a, ORANGE, 4)
    V = {}

    def box(x0, y0, z0, x1, y1, z1, c, round_=False):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if round_:
                        ex = x in (x0, x1)
                        ez = z in (z0, z1)
                        if ex and ez:
                            continue
                    V[(x, y, z)] = c

    def sphere(cx, cy, cz, r, c, cond=None):
        for x in range(sx):
            for y in range(sy):
                for z in range(sz):
                    if (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r and (cond is None or cond(x, y, z)):
                        V[(x, y, z)] = c

    # boots and legs
    for x0 in (5, 11):
        box(x0, 0, 4, x0 + 3, 2, 10, "boot", True)
        box(x0, 3, 5, x0 + 3, 7, 9, "suit", True)
        box(x0, 3, 5, x0 + 3, 3, 9, "suitS", True)
    # torso, belt and backpack
    box(4, 8, 3, 15, 15, 10, "suit", True)
    box(4, 8, 3, 15, 8, 10, "grey", True)
    box(5, 9, 0, 14, 16, 2, "pack", True)
    box(5, 12, 0, 14, 12, 0, "orange")
    # chest panel with buttons
    box(7, 10, 11, 12, 13, 11, "grey")
    V[(8, 12, 11)] = "orange"
    V[(9, 12, 11)] = "orangeL"
    V[(11, 12, 11)] = "visorL"
    V[(8, 11, 11)] = "visor"
    V[(10, 11, 11)] = "visor"
    V[(11, 11, 11)] = "visor"
    # arms and gloves
    for x0 in (1, 16):
        box(x0, 9, 5, x0 + 2, 15, 8, "suit", True)
        box(x0, 7, 5, x0 + 2, 8, 8, "grey", True)
        box(x0, 9, 5, x0 + 2, 9, 8, "orange", True)
    # helmet with a visor on the front
    sphere(9.5, 20.0, 6.5, 6.4, "suit")
    sphere(9.5, 20.0, 6.5, 6.4, "visor",
           lambda x, y, z: z >= 9 and 16 <= y <= 22 and 4 <= x <= 15)
    for (x, y, z), c in list(V.items()):
        if c == "visor" and (x + y in (26, 27) or (x, y) in ((12, 17), (13, 17))):
            V[(x, y, z)] = "visorL"
    # helmet rim
    for x in range(sx):
        for z in range(sz):
            if (x, 14, z) in V or (x, 15, z) in V:
                pass
    box(5, 14, 2, 14, 14, 11, "grey", True)
    # antenna with an orange light
    for y in range(24, 27):
        V[(5, y, 6)] = "grey"
    V[(5, 27, 6)] = "orange"

    pal = {"suit": suit[3], "suitS": suit[2], "boot": grey[1], "grey": grey[2], "pack": suit[2],
           "visor": visor[2], "visorL": visor[4], "orange": orange[2], "orangeL": orange[3]}
    # light from above: the suit darkens a step on the lowest rows
    by_color = {}
    for (x, y, z), c in V.items():
        if c == "suit" and y < 6:
            c = "suitS"
        by_color.setdefault(pal[c], []).append([x + 1, y, z + 1])
    for color, cells in by_color.items():
        a.call("set_voxels", voxels=cells, color=color)
    return "char-astronaut", "Astronaut", "voxel"


ASSETS = {
    "char-knight": knight,
    "char-wizard": wizard,
    "char-slime": slime,
    "char-skeleton": skeleton,
    "char-pirate": pirate,
    "char-ninja": ninja,
    "char-astronaut": astronaut,
    "char-ghost": ghost,
}


def main(argv):
    a = op.Agent()
    col = common.Collection("characters_a", "characters")
    if not argv or "--guide" in argv:
        a.call("pixel_art_guide", topic="all")
    wanted = [s for s in argv if not s.startswith("--")] or list(ASSETS)
    preview = "--preview" in argv
    for slug in wanted:
        s, title, kind = ASSETS[slug](a, col)
        if preview:
            report, pics = common.review(a, slug)
            print(slug, common.summary(report))
            print("\n".join(pics))
        else:
            col.publish(a, s, title, kind)
    a.close()


if __name__ == "__main__":
    main(sys.argv[1:])

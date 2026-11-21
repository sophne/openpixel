#!/usr/bin/env python3
"""Draws the website's pixel art with OpenPixel itself: the feature pictures ("The pixel tools you expect." and the
compare pages) and the examples (the "Start from a sentence" tabs, the Review loop card, the closing band), in the same style as
the app's empty states: 32×32 animated sprites in the app's grays and accent orange, lit from the top left, a dark
outline, 12 frames of equal length. The palette, outline and helpers are the empty states' own
(app/tools/make-empty-states.py), so the two sets stay one family.

    python3 web/scripts/make-feature-art.py               # draw, review and export with OpenPixel
    python3 web/scripts/make-feature-art.py --preview DIR # contact sheets only (no OpenPixel), to look at drawings

Writes web/public/art/features/<name>.png (1× sprite sheets), their .openpixel sources in web/artwork/features/, and
web/src/lib/feature-art.ts (sizes and frame counts for the <Sprite> component).
"""
import importlib.util
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("empty_states", os.path.join(ROOT, "app", "tools", "make-empty-states.py"))
es = importlib.util.module_from_spec(spec)
spec.loader.exec_module(es)
W, H, LEG, FRAME_MS = es.W, es.H, es.LEG, es.FRAME_MS
blank, outline, rect, rows = es.blank, es.outline, es.rect, es.rows

OUT = os.path.join(ROOT, "web", "public", "art", "features")
SRC = os.path.join(ROOT, "web", "artwork", "features")
MANIFEST = os.path.join(ROOT, "web", "src", "lib", "feature-art.ts")


def put(g, x, y, ch):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = ch


def poly(g, pts, ch):
    """Fills a polygon, testing each pixel's centre (even-odd)."""
    ys = [p[1] for p in pts]
    for y in range(max(0, int(min(ys))), min(H, int(max(ys)) + 1)):
        for x in range(W):
            px, py, inside = x + 0.5, y + 0.5, False
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                if (y1 > py) != (y2 > py) and px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
            if inside:
                g[y][x] = ch


def disc(g, cx, cy, r, ch):
    for y in range(H):
        for x in range(W):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                g[y][x] = ch


def cube(g, cx, cy, n, top="c", left="3", right="2", h=None, lit="d"):
    """A 2:1 isometric cube: top face a diamond 4n wide and 2n tall around (cx, cy), sides h tall (default 2n).
    Light from the top left: the top face's upper-left edge in `lit`."""
    h = 2 * n if h is None else h
    poly(g, [(cx - 2 * n, cy), (cx, cy + n), (cx, cy + n + h), (cx - 2 * n, cy + h)], left)
    poly(g, [(cx, cy + n), (cx + 2 * n, cy), (cx + 2 * n, cy + h), (cx, cy + n + h)], right)
    poly(g, [(cx, cy - n), (cx + 2 * n, cy), (cx, cy + n), (cx - 2 * n, cy)], top)
    if lit:  # the upper-left edge of the top face catches the light
        for i in range(int(2 * n)):
            x, y = int(cx - 2 * n) + i, int(cy - (i + 1) // 2)
            if 0 <= y < H and 0 <= x < W and g[y][x] == top:
                g[y][x] = lit


# ---------------------------------------------------------------- native: a window opens, a bolt strikes in it
BOLT = [".....cc.", "....cc..", "...cc...", "..cc....", ".cccccc.", "....cc..", "...cc...", "..cc....", ".cc.....", ".c......"]


def native_frame(state):
    g = blank()
    rect(g, 4, 6, 27, 25, "1")               # window body
    rect(g, 4, 6, 27, 9, "3")                # title bar
    rect(g, 4, 6, 27, 6, "4")                # its lit top edge
    for x in (7, 10, 13):                    # window buttons
        put(g, x, 8, "2"); put(g, x + 1, 8, "2")
    if state == "flash":
        rect(g, 5, 10, 26, 24, "2")
    if state in ("flash", "on", "glow", "dim"):
        for j, row in enumerate(BOLT):
            for i, ch in enumerate(row):
                if ch == "c":
                    left = i == 0 or row[i - 1] != "c"
                    put(g, 12 + i, 12 + j, "b" if state == "dim" else ("d" if left else "c"))
        if state == "glow":                  # a spark either side of the strike
            for x, y in ((10, 13), (21, 15), (9, 19)):
                put(g, x, y, "d")
    return rows(outline(g))


def native():
    seq = ["off", "off", "off", "flash", "on", "glow", "on", "on", "glow", "on", "dim", "off"]
    return [native_frame(s) for s in seq]


# ---------------------------------------------------------------- layers: three sheets, the top one lifts and settles
def sheet(g, cx, cy, top, side, lit):
    poly(g, [(cx - 11, cy + 2), (cx, cy + 7), (cx + 11, cy + 2), (cx + 11, cy + 4), (cx, cy + 9), (cx - 11, cy + 4)], side)
    poly(g, [(cx, cy - 3), (cx + 11, cy + 2), (cx, cy + 7), (cx - 11, cy + 2)], top)
    for i in range(11):
        put(g, cx - 11 + i, cy + 2 - (i + 1) // 2, lit)


def layers_frame(lift):
    g = blank()
    sheet(g, 16, 21, "2", "1", "3")
    sheet(g, 16, 15 - lift // 2, "3", "2", "4")
    sheet(g, 16, 9 - lift, "c", "b", "d")
    return rows(outline(g))


def layers():
    return [layers_frame(l) for l in [0, 0, 0, 1, 2, 3, 3, 3, 2, 1, 0, 0]]


# ---------------------------------------------------------------- onion: a bouncing ball and its two last frames
HEIGHTS = [22, 19, 16, 14, 13, 13, 14, 16, 19, 22, 23, 22]


def ball(g, cy, body, light, shade, squash=False):
    if squash:
        poly(g, [(11, cy + 1), (21, cy + 1), (21, cy + 5), (11, cy + 5)], body)
        rect(g, 12, cy + 1, 15, cy + 1, light)
        return
    disc(g, 16, cy, 4.6, body)
    if light:
        for x, y in ((14, cy - 3), (13, cy - 2), (14, cy - 2), (13, cy - 1)):
            put(g, x, y, light)
    if shade:
        for x, y in ((19, cy + 2), (18, cy + 3), (19, cy + 3), (17, cy + 4)):
            put(g, x, y, shade)


def onion_frame(i):
    g = blank()
    rect(g, 6, 28, 25, 28, "2")                          # the ground
    y = HEIGHTS[i]
    span = 3 + (y - 13) // 3                             # the shadow grows as the ball comes down
    rect(g, 16 - span, 27, 15 + span, 27, "1")
    for back, ch in ((2, "2"), (1, "3")):                # onion skin: the two frames before, fainter
        yb = HEIGHTS[(i - back) % len(HEIGHTS)]
        if abs(yb - y) >= 2:
            ball(g, yb, ch, None, None)
    ball(g, y, "c", "d", "b", squash=(y == 23))
    return rows(outline(g))


def onion():
    return [onion_frame(i) for i in range(12)]


# ---------------------------------------------------------------- mirror: half a heart drawn, the other half follows
HEART = ["..XXXX....XXXX..", ".XXXXXX..XXXXXX.", "XXXXXXXXXXXXXXXX", "XXXXXXXXXXXXXXXX", "XXXXXXXXXXXXXXXX",
         ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..", "...XXXXXXXXXX...", "....XXXXXXXX....", ".....XXXXXX.....",
         "......XXXX......", ".......XX......."]


def mirror_frame(shown):
    g = blank()
    for y in range(3, 29, 3):                            # the mirror axis, dashed
        put(g, 15, y, "3"); put(g, 16, y, "3"); put(g, 15, y + 1, "3"); put(g, 16, y + 1, "3")
    for j, row in enumerate(HEART[:shown]):
        for i, ch in enumerate(row):
            if ch == "X":
                put(g, 8 + i, 9 + j, "c")
    for x, y in ((10, 10), (11, 10), (10, 11), (21, 10), (20, 10), (21, 11)):   # highlights, mirrored too
        if y - 9 < shown:
            put(g, x, y, "d")
    for j in range(max(0, shown - 3), shown):            # shading on the lower edge
        row = HEART[j]
        last = row.rfind("X")
        if j >= 5:
            put(g, 8 + row.find("X"), 9 + j, "b"); put(g, 8 + last, 9 + j, "b")
    if 0 < shown < len(HEART):                           # the brush and its mirrored twin
        row = HEART[shown - 1]
        put(g, 8 + row.find("X") - 1, 9 + shown - 1, "5")
        put(g, 8 + row.rfind("X") + 1, 9 + shown - 1, "5")
    return rows(outline(g))


def mirror():
    return [mirror_frame(n) for n in [0, 2, 3, 5, 6, 8, 9, 11, 12, 12, 12, 12]]


# ---------------------------------------------------------------- palettes: swatches, the selection moving through them
SWATCHES = ["a", "b", "c", "d", "1", "2", "3", "4"]


def palettes_frame(sel):
    g = blank()
    rect(g, 3, 8, 28, 24, "2")                           # the panel
    rect(g, 3, 8, 28, 8, "3")
    for k, ch in enumerate(SWATCHES):
        x, y = 6 + (k % 4) * 6, 11 + (k // 4) * 7
        if k == sel:
            rect(g, x - 1, y - 1, x + 4, y + 4, "5")     # the picked colour's ring
        rect(g, x, y, x + 3, y + 3, ch)
    return rows(outline(g))


def palettes():
    return [palettes_frame(s) for s in [0, 0, 1, 2, 3, 3, 7, 7, 6, 5, 4, 4]]


# ---------------------------------------------------------------- iso: a 2:1 cube floating over its shadow
def iso_frame(bob):
    g = blank()
    rect(g, 10, 27, 21, 27, "1")
    rect(g, 12, 28, 19, 28, "1")
    cube(g, 16, 10 - bob, 4, top="c", left="3", right="2", h=9, lit="d")
    return rows(outline(g))


def iso():
    return [iso_frame(b) for b in [0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0]]


# ---------------------------------------------------------------- sheets: a 2×2 sprite sheet, the playhead stepping
POSES = [(7, 4), (9, 3), (6, 5), (8, 4)]  # (width, height) of a small slime in each cell


def sheets_frame(cell):
    g = blank()
    rect(g, 4, 4, 27, 27, "4")                           # the sheet
    rect(g, 4, 4, 27, 4, "5")
    rect(g, 4, 5, 4, 27, "5")
    rect(g, 15, 5, 16, 27, "3"); rect(g, 5, 15, 27, 16, "3")   # its grid
    for k, (w, h) in enumerate(POSES):
        ox, oy = 5 + (k % 2) * 12, 5 + (k // 2) * 12
        base = oy + 9
        x0, x1 = ox + 5 - w // 2, ox + 5 - w // 2 + w - 1
        rect(g, x0, base - h, x1, base, "c")
        put(g, x0, base - h, "4"); put(g, x1, base - h, "4")       # rounded top corners: a slime, not a box
        put(g, x0 + 1, base - h, "d"); put(g, x0, base - h + 1, "d")
        put(g, x1, base, "b"); put(g, x1, base - 1, "b")
        put(g, ox + 4, base - h + 1, "o"); put(g, ox + 7, base - h + 1, "o")   # eyes
    ox, oy = 5 + (cell % 2) * 12, 5 + (cell // 2) * 12
    for x in range(ox - 1, ox + 11):                     # the playhead: the frame being shown
        put(g, x, oy - 1, "b"); put(g, x, oy + 10, "b")
    for y in range(oy - 1, oy + 11):
        put(g, ox - 1, y, "b"); put(g, ox + 10, y, "b")
    return rows(outline(g))


def sheets():
    return [sheets_frame(c) for c in [0, 0, 0, 1, 1, 1, 3, 3, 3, 2, 2, 2]]


# ---------------------------------------------------------------- gif: a play button and a loop arrow going round
def gif_frame(step):
    g = blank()
    for a in range(48):                                  # the loop, faint
        t = a / 48 * 2 * math.pi
        put(g, round(16 + 11 * math.cos(t) - 0.5), round(16 + 11 * math.sin(t) - 0.5), "2")
    for k in range(9):                                   # the bright arc, chasing round
        t = (step / 12 - k / 48) * 2 * math.pi
        put(g, round(16 + 11 * math.cos(t) - 0.5), round(16 + 11 * math.sin(t) - 0.5), "4" if k else "5")
    poly(g, [(12, 9), (23, 16), (12, 23)], "c")          # play
    for y in range(10, 22):
        put(g, 12, y, "d")
    for x, y in ((21, 16), (20, 17), (19, 18)):
        put(g, x, y, "b")
    return rows(outline(g))


def gif():
    return [gif_frame(s) for s in range(12)]


# ---------------------------------------------------------------- vox: a voxel stack, one orange voxel dropping on
def vox_frame(drop):
    g = blank()
    # back to front; tops alternate like a checkerboard so each voxel reads on its own
    for (cx, cy), top in (((16, 17), "5"), ((11, 19.5), "3"), ((21, 19.5), "3"), ((16, 22), "5")):
        cube(g, cx, cy, 2.5, top=top, left="3" if top == "5" else "2", right="2" if top == "5" else "1", h=5,
             lit="5" if top == "5" else "4")
    if drop is not None:
        cube(g, 16, 12 - drop, 2.5, top="c", left="b", right="a", h=5, lit="d")
    return rows(outline(g))


def vox():
    return [vox_frame(d) for d in [None, None, 10, 6, 2, 0, -1, 0, 0, 0, 0, 0]]


# ---------------------------------------------------------------- import: a picture drops into the canvas
def import_frame(drop, landed):
    g = blank()
    zone = "c" if landed else "3"                        # the drop zone, lit when the picture lands
    for x in range(4, 28, 2):
        put(g, x, 9, zone); put(g, x, 28, zone)
    for y in range(9, 29, 2):
        put(g, 4, y, zone); put(g, 27, y, zone)
    top = 12 - drop
    rect(g, 7, top, 24, top + 13, "3")                   # the picture
    rect(g, 7, top, 24, top, "4")
    rect(g, 8, top + 1, 23, top + 8, "2")
    disc(g, 19, top + 4, 2.4, "c")
    put(g, 18, top + 3, "d")
    poly(g, [(8, top + 10), (13, top + 5), (17, top + 9), (20, top + 7), (24, top + 10), (24, top + 13), (8, top + 13)], "4")
    rect(g, 8, top + 12, 23, top + 12, "1")
    return rows(outline(g))


def import_():
    seq = [(10, 0), (10, 0), (8, 0), (5, 0), (2, 0), (0, 1), (-1, 1), (0, 1), (0, 1), (0, 1), (0, 0), (0, 0)]
    return [import_frame(d, l) for d, l in seq]


# ---------------------------------------------------------------- make3d: a flat orange tile extrudes into a cube
def make3d_frame(h):
    g = blank()
    rect(g, 9, 28, 22, 28, "1")
    cube(g, 16, 21 - h, 5, top="c", left="b", right="a", h=max(h, 1), lit="d")
    return rows(outline(g))


def make3d():
    return [make3d_frame(h) for h in [0, 0, 0, 2, 4, 6, 8, 9, 9, 9, 9, 4]]


# ---------------------------------------------------------------- agent: a sparkle draws a heart on a canvas
SPARK_BIG = ["....c....", "....c....", "...ccc...", "..ccdcc..", "cccdddccc", "..ccdcc..", "...ccc...", "....c....", "....c...."]
SPARK_SMALL = ["...c...", "...c...", "..cdc..", "ccdddcc", "..cdc..", "...c...", "...c..."]
SMALL_HEART = [".cc.cc.", "ccccccc", "ccccccc", ".ccccc.", "..ccc..", "...c..."]


def sparkle(g, cx, cy, big):
    shape = SPARK_BIG if big else SPARK_SMALL
    r = len(shape) // 2
    for j, row in enumerate(shape):
        for i, ch in enumerate(row):
            if ch != ".":
                put(g, cx - r + i, cy - r + j, ch)


def agent_frame(n):
    g = blank()
    rect(g, 4, 12, 21, 27, "4")                          # the canvas
    rect(g, 4, 12, 21, 12, "5")
    for j, row in enumerate(SMALL_HEART[:n]):
        for i, ch in enumerate(row):
            if ch == "c":
                put(g, 9 + i, 16 + j, "d" if (i, j) in ((1, 0), (0, 1)) else "c")
    sparkle(g, 24, 7, n % 2 == 0)                        # the agent, twinkling as it draws
    return rows(outline(g))


def agent():
    return [agent_frame(n) for n in [0, 1, 1, 2, 3, 4, 5, 6, 6, 6, 6, 6]]


# ---------------------------------------------------------------- voxagent: a sparkle building a voxel stack
def voxagent_frame(n):
    g = blank()
    spots = [(13, 20.5, "5"), (19, 20.5, "3"), (16, 22, "5"), (16, 16, "c")]
    for i, (cx, cy, top) in enumerate(spots[:n]):
        if top == "c":
            cube(g, cx, cy, 2.5, top="c", left="b", right="a", h=5, lit="d")
        else:
            cube(g, cx, cy, 2.5, top=top, left="3" if top == "5" else "2", right="2" if top == "5" else "1", h=5,
                 lit="5" if top == "5" else "4")
    sparkle(g, 24, 7, n % 2 == 1)
    return rows(outline(g))


def voxagent():
    return [voxagent_frame(n) for n in [1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 1]]


# ================================================================ examples: what people make, in the same style
# The home page's "Start from a sentence" tabs, the Review loop card and the closing band show these. Stills are one
# frame; animations run at their own speed (MS).

def stamp(g, x0, y0, art, colours):
    for j, row in enumerate(art):
        for i, ch in enumerate(row):
            if ch in colours:
                put(g, x0 + i, y0 + j, colours[ch])


def shadow(g, x0, x1, y=29):
    rect(g, x0, y, x1, y, "1")


# ---------------------------------------------------------------- chest: a treasure chest, banded, an orange lock
def chest():
    g = blank()
    rect(g, 7, 8, 24, 8, "3")                            # the lid's rounded top
    rect(g, 6, 9, 25, 14, "3")
    rect(g, 7, 8, 16, 9, "4")                            # light on the lid, top left
    rect(g, 6, 14, 25, 14, "2")
    rect(g, 6, 15, 25, 26, "2")                          # the body
    rect(g, 6, 15, 25, 15, "1")                          # the shadow under the lid
    rect(g, 24, 16, 25, 26, "1")                         # the body's shaded side
    for x in (9, 21):                                    # metal bands
        rect(g, x, 8, x + 1, 26, "4")
        put(g, x, 8, "5"); put(g, x, 16, "5")
        rect(g, x, 15, x + 1, 15, "3")
    rect(g, 14, 12, 17, 18, "c")                         # the lock
    rect(g, 14, 12, 16, 12, "d"); put(g, 14, 13, "d")
    rect(g, 17, 13, 17, 18, "b")
    put(g, 15, 15, "a"); put(g, 15, 16, "a")
    shadow(g, 8, 23, 28)
    return [rows(outline(g))]


# ---------------------------------------------------------------- person: someone waving hello
PERSON = [
    "......hhhh......",
    ".....hhhhhh.....",
    "....hhhhhhhh....",
    "....hffffffh....",
    "....ffFffFff....",
    "....ffffffff....",
    ".....ffffff.....",
    "......ffff......",
]


def person():
    g = blank()
    stamp(g, 8, 4, PERSON, {"h": "2", "f": "4", "F": "1"})
    put(g, 13, 5, "3"); put(g, 14, 5, "3")               # light in the hair
    put(g, 12, 7, "5"); put(g, 12, 8, "5")               # light on the cheek
    rect(g, 12, 12, 19, 20, "c")                         # the shirt
    rect(g, 12, 12, 13, 20, "d")
    rect(g, 19, 13, 19, 20, "b")
    rect(g, 20, 9, 21, 14, "c")                          # the waving arm, up
    rect(g, 21, 9, 21, 14, "b")
    rect(g, 20, 6, 21, 8, "4")                           # its hand
    rect(g, 10, 13, 11, 19, "c")                         # the other arm, down
    put(g, 10, 13, "d")
    rect(g, 10, 20, 11, 21, "4")
    rect(g, 13, 21, 15, 26, "2")                         # legs
    rect(g, 16, 21, 18, 26, "2")
    rect(g, 15, 21, 16, 26, "1")
    rect(g, 12, 27, 15, 27, "1"); rect(g, 16, 27, 19, 27, "1")   # shoes
    shadow(g, 11, 20, 29)
    return [rows(outline(g))]


# ---------------------------------------------------------------- appletree: a round tree with orange apples
def appletree():
    g = blank()
    rect(g, 14, 18, 17, 27, "2")                         # the trunk
    rect(g, 14, 18, 14, 27, "3")
    rect(g, 17, 18, 17, 27, "1")
    put(g, 13, 27, "2"); put(g, 18, 27, "2")             # roots
    for cx, cy, r in ((16, 11, 8.2), (9.5, 14, 5.4), (22.5, 14, 5.4)):
        disc(g, cx, cy, r, "2")
    for cx, cy, r in ((15, 10, 7), (9, 13, 4.2), (21.5, 12.5, 4.2)):
        disc(g, cx, cy, r, "3")
    disc(g, 12.5, 7.5, 3.2, "4")
    put(g, 11, 6, "5"); put(g, 12, 6, "5")
    for x, y in ((10, 12), (19, 9), (21, 16), (13, 16), (16, 13)):
        rect(g, x, y, x + 1, y + 1, "c"); put(g, x, y, "d"); put(g, x + 1, y + 1, "b")
    shadow(g, 9, 22, 28)
    return [rows(outline(g))]


# ---------------------------------------------------------------- voxtree: the tree as voxels (iso), and its front/side
def voxtree_iso():
    g = blank()
    cube(g, 16, 25, 5, top="3", left="2", right="1", h=1, lit="4")          # the grass block
    cube(g, 16, 20, 1.5, top="2", left="2", right="1", h=5, lit=None)       # the trunk
    cube(g, 16, 9, 4, top="4", left="3", right="2", h=7, lit="5")           # the canopy
    cube(g, 16, 4, 2.5, top="4", left="3", right="2", h=4, lit="5")
    for x, y in ((10, 14), (20, 16), (13, 9)):                              # apples
        rect(g, x, y, x + 1, y + 1, "c"); put(g, x, y, "d")
    return rows(outline(g))


def voxtree_flat(side):
    g = blank()
    rect(g, 6, 27, 25, 28, "2"); rect(g, 6, 27, 25, 27, "3")                # the grass block
    rect(g, 14, 21, 17, 26, "2"); rect(g, 17, 21, 17, 26, "1")              # the trunk
    face, lit = ("2", "3") if side else ("3", "4")
    rect(g, 8, 11, 23, 20, face); rect(g, 8, 11, 23, 11, lit)               # the canopy
    rect(g, 11, 5, 20, 10, face); rect(g, 11, 5, 20, 5, lit)
    for x, y in (((10, 14), (19, 17), (14, 7)) if not side else ((12, 17), (20, 13), (17, 7))):
        rect(g, x, y, x + 1, y + 1, "c"); put(g, x, y, "d")
    return rows(outline(g))


def voxtree():
    return [voxtree_iso()]


def treeviews():
    """The Review loop card: front, isometric and side, as review_model renders them."""
    return [voxtree_flat(False), voxtree_iso(), voxtree_flat(True)]


# ---------------------------------------------------------------- mushroom: a voxel mushroom house
def mushroom():
    g = blank()
    cube(g, 16, 25, 5, top="3", left="2", right="1", h=1, lit="4")          # the ground
    cube(g, 16, 17, 3, top="5", left="4", right="3", h=8, lit=None)         # the stem
    rect(g, 12, 22, 13, 25, "1")                                            # the door
    rect(g, 19, 20, 20, 21, "c"); put(g, 19, 20, "d")                       # a lit window
    cube(g, 16, 9, 6, top="c", left="b", right="a", h=4, lit="d")           # the cap
    for x, y in ((12, 8), (19, 6), (17, 11)):                               # spots
        rect(g, x, y, x + 1, y, "5")
    rect(g, 7, 13, 8, 13, "d"); rect(g, 24, 13, 25, 13, "c")
    return [rows(outline(g))]


# ---------------------------------------------------------------- chest3d: the chest as a voxel model
def chest3d():
    g = blank()
    cx, cy, n, h = 16, 13, 5, 9
    cube(g, cx, cy, n, top="3", left="2", right="1", h=h, lit="4")
    x0 = cx - 2 * n

    def edge(x):                         # where a face's top edge is at column x
        return cy + (x - x0) // 2 if x <= cx else cy + n - (x - cx) // 2

    for x in range(x0, x0 + 4 * n + 1):  # the lid's seam
        put(g, x, edge(x) + 3, "1" if x <= cx else "o")
    for bx in (x0 + 2, cx - 3, cx + 2, cx + 7):          # metal bands
        for y in range(edge(bx), edge(bx) + h + 1):
            if g[y][bx] not in ".":
                put(g, bx, y, "4" if bx <= cx else "3")
    for t in range(0, 2 * n):                            # the bands across the lid
        for bx in (x0 + 2, cx - 3):
            x, y = bx + 2 * t, edge(bx) - t
            for xx in (x, x + 1):
                if 0 <= y < H and 0 <= xx < W and g[y][xx] == "3":
                    g[y][xx] = "4"
    rect(g, 10, 18, 12, 21, "c"); put(g, 10, 18, "d"); put(g, 11, 18, "d"); rect(g, 12, 19, 12, 21, "b")
    put(g, 11, 20, "a")
    return [rows(outline(g))]


# ---------------------------------------------------------------- slime: an orange slime bouncing
def slime_frame(w, h, lift):
    g = blank()
    base = 26 - lift
    sw = max(3, w // 2 - lift // 2)
    shadow(g, 16 - sw, 15 + sw, 28)
    for y in range(H):
        for x in range(W):
            dx, dy = (x + 0.5 - 16) / (w / 2), (y + 0.5 - base) / h
            if y <= base and dx * dx + dy * dy <= 1:
                g[y][x] = "c"
                if dx > 0.45 and dy > -0.5 or dy > -0.18:
                    g[y][x] = "b"
    top = base - h + 1
    rect(g, 16 - w // 4 - 1, top + 2, 16 - w // 4, top + 2, "d")    # light, top left
    put(g, 16 - w // 4 - 2, top + 3, "d")
    ey = base - max(3, h // 2)
    for ex in (14, 18):                                              # eyes
        put(g, ex, ey, "1"); put(g, ex, ey + 1, "1")
    return rows(outline(g))


def slime():
    seq = [(22, 8, 0), (20, 10, 0), (16, 13, 2), (14, 15, 5), (14, 15, 7), (15, 14, 8),
           (14, 15, 7), (14, 15, 5), (16, 13, 2), (22, 8, 0), (20, 10, 0), (18, 11, 0)]
    return [slime_frame(*f) for f in seq]


# ---------------------------------------------------------------- coin: a coin spinning
def coin_frame(a, glint):
    g = blank()
    shadow(g, 12, 19, 28)
    for y in range(H):
        for x in range(W):
            dx, dy = (x + 0.5 - 16) / max(a, 0.6), (y + 0.5 - 15) / 10
            if dx * dx + dy * dy <= 1:
                g[y][x] = "b"
                ix, iy = (x + 0.5 - 16) / max(a - 1.6, 0.3), (y + 0.5 - 15) / 8.4
                if a > 2 and ix * ix + iy * iy <= 1:
                    g[y][x] = "c"
                    if ix < -0.35 and iy < 0.4:
                        g[y][x] = "d"
    if a >= 5:                                           # the mark on its face
        rect(g, 15, 10, 16, 19, "b"); rect(g, 15, 10, 15, 19, "a")
    elif a <= 2:
        rect(g, 15, 6, 16, 23, "c"); rect(g, 15, 6, 15, 23, "d")
    if glint:
        put(g, 11, 9, "5"); put(g, 12, 8, "5"); put(g, 10, 8, "d"); put(g, 11, 7, "d")
    return rows(outline(g))


def coin():
    return [coin_frame(a, i == 0) for i, a in enumerate([8, 7, 4.5, 1.5, 4.5, 7, 8, 8])]


# ---------------------------------------------------------------- campfire: flames flickering over crossed logs
FLAME = [2, 4, 6, 9, 11, 13, 14, 12, 10, 8, 6, 4, 2]    # x = 10..22
WOBBLE = [[0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0], [1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1],
          [0, -1, 1, 0, -1, 1, 1, -1, 0, 1, -1, 0, 0], [-1, 0, 0, 1, 1, 0, -1, 1, 0, 0, 1, 0, -1]]


def campfire_frame(i):
    g = blank()
    w = WOBBLE[i % 4]
    lean = (0, 1, 0, -1)[i % 4]
    for k, hgt in enumerate(FLAME):
        x, top = 10 + k + (lean if hgt > 9 else 0), 23 - hgt - w[k]
        for y in range(top, 24):
            put(g, x, y, "c")
        put(g, x, top, "b")
        inner = int(hgt * 0.55) - (w[k] > 0)
        if 3 <= k <= 9:
            for y in range(23 - inner, 24):
                put(g, x, y, "d")
        if 5 <= k <= 7:
            for y in range(23 - inner // 2, 24):
                put(g, x, y, "5")
    if i % 3 == 1:                                       # an ember rising
        put(g, 13 + i % 5, 6 - i % 2, "d")
    poly(g, [(7, 22), (9, 21), (25, 26), (23, 27)], "2")  # crossed logs
    poly(g, [(23, 21), (25, 22), (9, 27), (7, 26)], "3")
    put(g, 7, 22, "4"); put(g, 24, 21, "4")
    for x, y in ((5, 26), (26, 26)):                     # stones
        rect(g, x, y, x + 1, y + 1, "4"); put(g, x + 1, y + 1, "3")
    shadow(g, 6, 25, 29)
    return rows(outline(g))


def campfire():
    return [campfire_frame(i) for i in range(12)]


# ---------------------------------------------------------------- sword: a sword, point up and to the right
def sword():
    g = blank()
    for i in range(14):                                  # the blade, along the diagonal
        x, y = 25 - i, 5 + i
        put(g, x, y, "4"); put(g, x - 1, y, "5"); put(g, x, y + 1, "3")
    put(g, 26, 4, "4")                                   # the point
    for i in range(-3, 4):                               # the guard, across the blade
        put(g, 11 + i, 18 + i, "c"); put(g, 12 + i, 18 + i, "b")
    put(g, 8, 15, "d")
    for i in range(4):                                   # the grip
        put(g, 9 - i, 21 + i, "2"); put(g, 10 - i, 21 + i, "1")
    rect(g, 4, 25, 5, 26, "c"); put(g, 4, 25, "d")       # the pommel
    shadow(g, 7, 24, 29)
    return [rows(outline(g))]


# ---------------------------------------------------------------- potion: a round flask of orange potion
def potion():
    g = blank()
    disc(g, 16, 19.5, 7.6, "3")                          # the glass
    for y in range(H):
        for x in range(W):
            dx, dy = x + 0.5 - 16, y + 0.5 - 19.5
            if dx * dx + dy * dy <= 6.2 * 6.2:
                g[y][x] = ("d" if y == 18 else "b" if dx + dy > 5 else "c") if y >= 18 else "2"
    rect(g, 14, 8, 17, 12, "3"); rect(g, 15, 9, 16, 12, "2")   # the neck
    rect(g, 13, 7, 18, 8, "4")                            # its lip
    rect(g, 14, 4, 17, 6, "2"); rect(g, 14, 4, 15, 4, "3")      # the cork
    put(g, 11, 15, "5"); put(g, 11, 16, "5"); put(g, 12, 14, "5")   # glint
    shadow(g, 10, 21, 29)
    return [rows(outline(g))]


# ---------------------------------------------------------------- house: a voxel house with a stepped orange roof
def house():
    g = blank()
    cube(g, 16, 25, 5.5, top="3", left="2", right="1", h=1, lit="4")        # the ground
    cube(g, 16, 17, 4, top="4", left="4", right="3", h=7, lit=None)         # the walls
    rect(g, 11, 20, 12, 24, "1")                                            # the door
    rect(g, 19, 19, 21, 20, "c"); put(g, 19, 19, "d")                       # a lit window
    cube(g, 16, 13, 4.5, top="c", left="b", right="a", h=2, lit="d")        # the roof, in steps
    cube(g, 16, 10, 3, top="c", left="b", right="a", h=2, lit="d")
    cube(g, 16, 7, 1.5, top="c", left="b", right="a", h=2, lit="d")
    cube(g, 21, 6, 1, top="3", left="3", right="2", h=4, lit=None)          # the chimney
    return [rows(outline(g))]


# ---------------------------------------------------------------- crystal: orange crystals growing from a rock
def crystal():
    g = blank()
    cube(g, 16, 21, 5, top="3", left="2", right="1", h=4, lit="4")          # the rock
    for cx, cy, h in ((12, 13, 8), (20, 14, 6), (16, 8, 11)):               # shards, back to front
        cube(g, cx, cy, 1.5, top="d", left="c", right="b", h=h, lit=None)
    cube(g, 13, 19, 1, top="d", left="c", right="b", h=3, lit=None)
    put(g, 15, 9, "5"); put(g, 11, 14, "5")
    return [rows(outline(g))]


# ---------------------------------------------------------------- heart: a heart beating
def heart_frame(size):
    g = blank()
    shadow(g, 16 - size // 2, 15 + size // 2, 28)
    for y in range(H):
        for x in range(W):
            u, v = (x + 0.5 - 16) / size * 1.25, -(y + 0.5 - 15) / size * 1.25 + 0.2
            if (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0:
                g[y][x] = "b" if u + (-v) * 0.8 > 0.55 else "c"
    rect(g, 16 - size // 2 + 1, 15 - size // 3 - 1, 16 - size // 2 + 2, 15 - size // 3 - 1, "d")
    put(g, 16 - size // 2 + 1, 15 - size // 3, "d")
    return rows(outline(g))


def heart():
    return [heart_frame(s) for s in [10, 12, 11, 12, 10, 10, 10, 10, 10, 10, 10, 10]]


# ---------------------------------------------------------------- ghost: a ghost floating up and down
def ghost_frame(i):
    g = blank()
    bob = round(2 * math.sin(i / 12 * 2 * math.pi))
    top = 7 - bob
    sw = 6 + bob // 2
    shadow(g, 16 - sw, 15 + sw, 29)
    disc(g, 16, top + 7, 7.5, "5")                       # the head
    rect(g, 9, top + 7, 23, top + 16, "5")               # the body
    for x in range(9, 24):                               # the wavy hem, moving along
        if (x + i) % 4 < 2:
            put(g, x, top + 17, "5")
    for x in range(19, 24):                              # shade on the right
        for y in range(top + 2, top + 18):
            if g[y][x] == "5" and (x > 21 or y > top + 12):
                g[y][x] = "4"
    rect(g, 13, top + 6, 13, top + 8, "1"); rect(g, 18, top + 6, 18, top + 8, "1")   # eyes
    put(g, 12, top + 10, "c"); put(g, 19, top + 10, "c")                             # cheeks
    return rows(outline(g))


def ghost():
    return [ghost_frame(i) for i in range(12)]


MS = {"slime": 110, "coin": 120, "campfire": 150, "heart": 110, "ghost": 150}


ART = {"native": native, "layers": layers, "onion": onion, "mirror": mirror, "palettes": palettes,
       "iso": iso, "sheets": sheets, "gif": gif, "vox": vox,
       "import": import_, "make3d": make3d, "agent": agent, "voxagent": voxagent,
       "chest": chest, "person": person, "appletree": appletree, "voxtree": voxtree, "mushroom": mushroom,
       "chest3d": chest3d, "slime": slime, "coin": coin, "campfire": campfire, "treeviews": treeviews,
       "sword": sword, "potion": potion, "house": house, "crystal": crystal, "heart": heart, "ghost": ghost}


def preview(out):
    """Contact sheets drawn straight from the rows (no OpenPixel), 8× — for looking at the drawings."""
    from PIL import Image
    os.makedirs(out, exist_ok=True)
    pal = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in LEG.items()}
    for name, fn in ART.items():
        frames = fn()
        img = Image.new("RGB", (W * len(frames), H), (30, 30, 32))
        for f, fr in enumerate(frames):
            for y, row in enumerate(fr):
                for x, ch in enumerate(row):
                    if ch in pal:
                        img.putpixel((f * W + x, y), pal[ch])
        img.resize((img.width * 6, img.height * 6), Image.NEAREST).save(os.path.join(out, f"{name}.png"))
    print("previews in", out)


def drawn_box(frames):
    """Where the drawn pixels are, across these frames: [x, y, width, height] (the Showcase sizes pictures by it)."""
    pts = [(x, y) for f in frames for y, row in enumerate(f) for x, ch in enumerate(row) if ch != "."]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]


def main():
    if "--preview" in sys.argv:
        preview(sys.argv[sys.argv.index("--preview") + 1])
        return
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SRC, exist_ok=True)
    a = es.Agent()
    a.call("pixel_art_guide", topic="animation")
    entries = {}
    for name, fn in ART.items():
        frames = fn()
        a.call("new_sprite", width=W, height=H, name=f"feature-{name}", palette="none")
        for i, f in enumerate(frames):
            if i:
                a.call("add_frame")
            a.call("paint_slice", rows=f, legend=LEG)
            a.call("set_frame_duration", duration_ms=MS.get(name, FRAME_MS))
        review = a.call("review_model", frame=0)
        score = review.get("score", {}).get("total", "?") if isinstance(review, dict) else "?"
        print(f"{name}: {len(frames)} frames, review {score}/100")
        a.call("save_model", path=os.path.join(SRC, f"{name}.openpixel"))
        a.call("export_sheet", path=os.path.join(OUT, f"{name}.png"), scale=1)
        boxes = [drawn_box([f]) for f in frames]
        entries[name] = {"src": f"/art/features/{name}.png", "w": W, "h": H, "frames": len(frames),
                         "ms": MS.get(name, FRAME_MS), "axis": "x", "box": drawn_box(frames)}
        if len(frames) > 1:
            entries[name]["boxes"] = boxes
    a.close()
    with open(MANIFEST, "w") as fh:
        fh.write("// Generated by web/scripts/make-feature-art.py: drawn and exported by OpenPixel, in the app's empty-state style.\n")
        fh.write('import type { Art } from "./art";\n\n')
        fh.write("export const featureArt = " + json.dumps(entries, indent=2) + " satisfies Record<string, Art>;\n")
    print("wrote", MANIFEST)


if __name__ == "__main__":
    main()

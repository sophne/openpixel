#!/usr/bin/env python3
"""Draws the hero scene, "Temple of Athena", with OpenPixel and takes the editor screenshot used on the home page.

A 256×160 sprite in layers: a ruined Doric temple above the Aegean, Pegasus in the sky, Athena with her spear,
shield and aegis, her owl on a broken column, and a hoplite climbing the path. The palette comes from a sunlit
Mediterranean illustration: peach marble, deep-to-pale Aegean blues, sage and pine greens, lavender.

    python3 web/scripts/make-hero.py            preview only (a scratch PNG, path printed)
    python3 web/scripts/make-hero.py --write    draw it in OpenPixel, save the .openpixel and retake public/editor.png
    python3 web/scripts/make-hero.py --shot     only retake public/editor.png from the saved .openpixel (after UI changes)
"""
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP = os.path.join(ROOT, "app", "OpenPixel.app", "Contents", "MacOS", "OpenPixel")
if not os.path.exists(APP):
    APP = "/Applications/OpenPixel.app/Contents/MacOS/OpenPixel"
SOURCE = os.path.join(ROOT, "web", "scripts", "temple-of-athena.openpixel")
SHOT = os.path.join(ROOT, "web", "public", "editor.png")

W, H = 256, 160
HORIZON = 82

# ---------------------------------------------------------------- palette

P = {
    # sky, top to horizon
    "sky0": "#2a82bd", "sky1": "#3893cb", "sky2": "#4ea5d5", "sky3": "#6cb9dc", "sky4": "#90cbe1", "sky5": "#b6dde6",
    # clouds, lit to shaded
    "cl0": "#fffaf3", "cl1": "#fcebdc", "cl2": "#f1d3c0", "cl3": "#d9b8a8", "cl4": "#b7a0a3",
    # far hills and the island
    "far0": "#6f93ae", "far1": "#88a7bd", "far2": "#a7bfcc", "isle0": "#6f7a52", "isle1": "#8f9363", "isle2": "#c9a27c",
    "isle3": "#e6c09a",
    # sea
    "sea0": "#13507f", "sea1": "#19659c", "sea2": "#2079b2", "sea3": "#2f90c4", "sea4": "#72c0dc", "foam": "#e8f6f7",
    # marble, light to dark
    "m0": "#fff3e6", "m1": "#fde0c4", "m2": "#f6c7a2", "m3": "#e5aa84", "m4": "#c48663", "m5": "#93604a", "m6": "#6a4238",
    # ground
    "sand0": "#f7d5ad", "sand1": "#eab68a", "sand2": "#d29a6e", "sand3": "#b07a55",
    # greens
    "g0": "#1f2c1c", "g1": "#2f4627", "g2": "#466534", "g3": "#6c8840", "g4": "#9cab57", "g5": "#c8c47a",
    "bark0": "#4c2e26", "bark1": "#7a4b37",
    # flowers
    "lav0": "#6a5ba8", "lav1": "#9686d6", "lav2": "#c3b6f0", "poppy": "#d9432f",
    # figures
    "ink": "#2e1f22", "gold0": "#9a6522", "gold1": "#c98a2e", "gold2": "#e9b54c", "gold3": "#fbe08a",
    "red0": "#7e2121", "red1": "#b2322a", "red2": "#d9553b",
    "skin0": "#a8674a", "skin1": "#d4916a", "skin2": "#f0b78f", "hair0": "#3e2420", "hair1": "#6b3d2a",
    "cloth0": "#ffffff", "cloth1": "#efe3da", "cloth2": "#d4c1b6", "cloth3": "#a99088",
    "steel0": "#8796a3", "steel1": "#c9d4dc", "wing0": "#ffffff", "wing1": "#e3edf3", "wing2": "#b9cad8",
    "wing3": "#8c9fb2", "lips": "#b5544a", "white": "#ffffff",
}


class Layer:
    def __init__(self, name):
        self.name = name
        self.px = [[None] * W for _ in range(H)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = P.get(c, c) if c else None

    def get(self, x, y):
        x, y = int(x), int(y)
        return self.px[y][x] if 0 <= x < W and 0 <= y < H else None

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def sprite(self, x0, y0, rows, legend):
        for y, line in enumerate(rows):
            for x, ch in enumerate(line):
                if ch not in ". ":
                    self.set(x0 + x, y0 + y, legend[ch])


BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bayer(x, y, t):
    """True when an ordered dither at level t (0..1) puts the second colour here."""
    return BAYER[int(y) % 4][int(x) % 4] < t * 16


def ramp(x, y, v, keys):
    """Picks from `keys` (dark to light) for a value v in 0..1, dithering between neighbouring steps."""
    v = max(0.0, min(0.9999, v)) * (len(keys) - 1)
    i, f = int(v), v - int(v)
    return keys[min(i + 1, len(keys) - 1)] if bayer(x, y, f) else keys[i]


# ---------------------------------------------------------------- sky, clouds, far hills, sea

def sky(L):
    keys = ["sky5", "sky4", "sky3", "sky2", "sky1", "sky0"]
    for y in range(0, HORIZON + 2):
        t = 1 - (y / HORIZON) ** 0.85
        for x in range(W):
            L.set(x, y, ramp(x, y, t, keys))


def cloud(L, cx, cy, puffs, flat):
    """A cumulus: overlapping puffs lit from the top left, flat and shaded underneath."""
    shade = {}
    for x in range(W):
        for y in range(0, flat + 1):
            best = None
            for px_, py_, r in puffs:
                dx, dy = x + 0.5 - (cx + px_), y + 0.5 - (cy + py_)
                d = math.hypot(dx, dy * 1.1)
                if d <= r:
                    nx, ny = dx / r, dy / r
                    nz = math.sqrt(max(0, 1 - min(1, nx * nx + ny * ny)))
                    light = -0.45 * nx - 0.6 * ny + 0.65 * nz
                    best = light if best is None else max(best, light)
            if best is not None:
                low = (y - (flat - 7)) / 7 if y > flat - 7 else 0
                shade[(x, y)] = best - 0.55 * low
    for (x, y), v in shade.items():
        L.set(x, y, ramp(x, y, (v + 0.35) / 1.25, ["cl4", "cl3", "cl2", "cl1", "cl0"]))


def clouds(L):
    cloud(L, 70, 52, [(-34, 6, 9), (-24, -1, 12), (-10, -8, 15), (6, -11, 16), (20, -5, 13), (32, 2, 10),
                      (-16, 4, 11), (12, 4, 11), (26, 6, 8), (-2, 0, 13)], 64)
    cloud(L, 186, 64, [(-14, 2, 6), (-6, -3, 9), (4, -2, 8), (13, 2, 6)], 70)
    cloud(L, 236, 40, [(-6, 0, 4), (1, -2, 5), (7, 1, 3)], 42)


def gulls(L):
    for x, y in [(128, 74), (137, 70), (147, 75)]:
        for dx, dy in [(-2, -1), (-1, 0), (1, 0), (2, -1)]:
            L.set(x + dx, y + dy, "far0")


def far(L):
    # Two blue ridges far away, then an island with a sunlit cliff.
    for x in range(W):
        r1 = HORIZON - 7 - 4 * math.sin(x / 17) - 2 * math.sin(x / 6.1 + 1.3)
        r2 = HORIZON - 3 - 2.5 * math.sin(x / 9 + 2) - 1.5 * math.sin(x / 3.7)
        for y in range(int(r1), HORIZON):
            L.set(x, y, "far2" if y < r1 + 1 else "far1")
        for y in range(int(r2), HORIZON):
            L.set(x, y, "far1" if y < r2 + 1 else "far0")
    for x in range(14, 116):
        t = (x - 14) / 102
        top = HORIZON - 1 - 10 * (math.sin(t * math.pi) ** 0.6) * (1 - 0.25 * math.sin(t * 9))
        for y in range(int(top), HORIZON + 1):
            depth = y - top
            cliff = x > 88 and depth > 2
            if cliff:
                c = "isle3" if (x + y) % 9 == 0 else "isle2" if x < 104 else "isle1"
            else:
                c = "isle1" if depth < 1.5 else ramp(x, y, 0.4 + 0.3 * math.sin(x / 5), ["isle0", "isle1"])
            L.set(x, y, c)
    # A white-sailed ship far out.
    L.sprite(142, HORIZON + 3, ["...w..", "..ww..", ".www..", "wwwk..", "kkkkkk"], {"w": "cl0", "k": "bark0"})


def sea(L):
    random.seed(11)
    for y in range(HORIZON, 124):
        t = (y - HORIZON) / (124 - HORIZON)
        for x in range(W):
            L.set(x, y, ramp(x, y, 0.15 + 0.8 * t, ["sea0", "sea1", "sea2", "sea3"]))
    # Wave strokes: short, longer near the shore, and a band of glitter under the sun (upper left).
    for _ in range(260):
        y = random.randrange(HORIZON + 1, 122)
        t = (y - HORIZON) / 40
        x = random.randrange(W)
        n = int(2 + t * 6 * random.random())
        c = "sea4" if t > 0.3 or random.random() < 0.3 else "sea2"
        for i in range(n):
            L.set(x + i, y, c)
    for _ in range(40):
        x = int(random.gauss(70, 30))
        y = random.randrange(HORIZON + 2, 110)
        L.set(x, y, "foam")
        L.set(x + 1, y, "sea4")


# ---------------------------------------------------------------- temple

COL_SHADE = ["m5", "m3", "m2", "m1", "m0", "m0", "m1", "m0", "m1", "m2", "m2", "m3", "m3", "m4"]


def column(L, cx, top, base, broken_at=None):
    """A fluted Doric column with entasis: shaft from `top` to `base`, echinus and abacus on top, centred on cx."""
    shaft_top = top + 7
    stop = broken_at if broken_at else shaft_top
    for y in range(stop, base):
        t = (y - shaft_top) / (base - shaft_top)
        half = 6 + 1.2 * t + 0.5 * math.sin(t * math.pi)  # wider at the foot, with a slight swell
        x0, x1 = round(cx - half), round(cx + half)
        n = x1 - x0 + 1
        for i in range(n):
            c = COL_SHADE[min(len(COL_SHADE) - 1, int(i / n * len(COL_SHADE)))]
            # Flutes: every other pixel is a groove, darker one step.
            if 2 <= i <= n - 3 and i % 2 == 1:
                c = {"m0": "m1", "m1": "m2", "m2": "m3", "m3": "m4"}.get(c, c)
            L.set(x0 + i, y, c)
    # Weathering: a few hairline cracks.
    random.seed(cx)
    for _ in range(2):
        x, y = cx + random.randint(-4, 3), random.randint(max(stop, top + 12), base - 6)
        for k in range(random.randint(3, 6)):
            L.set(x + (k // 2) * random.choice((0, 1)), y + k, "m4")
    if broken_at:
        rnd = random.Random(cx * 7)
        for i in range(-7, 8):
            d = rnd.randint(0, 4) + (2 if i > 2 else 0)
            for y in range(broken_at, broken_at + d):
                L.set(cx + i, y, None)
            L.set(cx + i, broken_at + d, "m0" if i < 3 else "m1")
            L.set(cx + i, broken_at + d + 1, "m2" if i < 3 else "m3")
    else:
        # Annulets, echinus (a cushion that widens upwards), abacus (a square slab).
        for i in range(-6, 7):
            L.set(cx + i, shaft_top - 1, "m3" if i > 2 else "m2")
        for k, half in enumerate([7, 8, 9]):
            y = shaft_top - 2 - k
            for i in range(-half, half + 1):
                L.set(cx + i, y, "m0" if i < -2 and k > 0 else "m1" if i < 4 else "m3")
            L.set(cx + half, y, "m4")
        L.rect(cx - 10, top, cx + 10, top + 2, "m1")
        for i in range(-10, 11):
            L.set(cx + i, top, "m0")
            L.set(cx + i, top + 2, "m3")
        L.set(cx + 10, top + 1, "m4")
    # Base course under the column and its shadow to the right.
    for i in range(-8, 9):
        L.set(cx + i, base, "m1" if i < 5 else "m3")
    for y in range(base - 1, base + 1):
        for i in range(8, 13):
            L.set(cx + i, y + 1, "m3")


def courses(L, x0, y0, x1, y1, joint, offset=0, light="m0", tones=("m1", "m2", "m2", "m3"), course=4, chip=True):
    """Squared ashlar: each course lit on top and shaded under, joints staggered from course to course."""
    for y in range(y0, y1 + 1):
        k = (y - y0) // course
        ry = (y - y0) % course
        for x in range(x0, x1 + 1):
            c = light if ry == 0 else tones[min(ry, len(tones) - 1)]
            if (x - x0 + offset + k * (joint // 2)) % joint == 0 and ry != 0:
                c = "m4"
            L.set(x, y, c)
    if chip:
        rnd = random.Random(x0 * 31 + y0)
        for _ in range((x1 - x0) // 14):
            x, y = rnd.randint(x0, x1), y0 + rnd.randrange(0, y1 - y0 + 1, course)
            L.set(x, y, "m2")
            L.set(x + 1, y, "m3")


def temple(L):
    base = 106  # top of the stylobate
    # The cella wall behind the columns, in shade, broken off along its top.
    rnd = random.Random(3)
    for x in range(150, 256):
        top = 74 + int(6 * math.sin(x / 9)) + rnd.randint(0, 3)
        for y in range(top, base):
            row = (y - 70) // 5
            ry = (y - 70) % 5
            c = "m3" if ry == 0 else "m4"
            if (x + row * 6) % 12 == 0 and ry:
                c = "m5"
            L.set(x, y, c)
        L.set(x, top, "m2")
    # Crepidoma: stylobate and two steps below, stepping down to the left.
    courses(L, 136, base, 255, base + 5, joint=19, course=6, tones=("m1", "m1", "m2", "m2", "m3", "m4"))
    courses(L, 128, base + 6, 255, base + 11, joint=17, offset=8, course=6, tones=("m1", "m1", "m2", "m2", "m3", "m4"))
    courses(L, 120, base + 12, 255, base + 17, joint=15, offset=3, course=6, tones=("m1", "m1", "m2", "m2", "m3", "m4"))
    for x in range(120, 256):
        L.set(x, base + 18, "m5")
    # Columns: one broken, four still carrying the entablature.
    column(L, 154, 34, base, broken_at=70)
    for cx in (178, 202, 226, 250):
        column(L, cx, 34, base)
    # Entablature: architrave, frieze with triglyphs and metopes, cornice.
    x0 = 166
    L.rect(x0, 25, 255, 33, "m1")
    for x in range(x0, 256):
        L.set(x, 25, "m0")
        L.set(x, 32, "m2")
        L.set(x, 33, "m4")
    for x in range(x0, 256):  # taenia with guttae under each triglyph
        L.set(x, 24, "m3")
    L.rect(x0, 14, 255, 23, "m2")
    for tx in range(172, 256, 12):
        L.rect(tx, 14, tx + 5, 23, "m3")
        for gx in (tx + 1, tx + 3):
            L.rect(gx, 15, gx, 22, "m4")
        L.rect(tx, 25, tx + 5, 25, "m3")
        for gx in range(tx, tx + 6, 2):
            L.set(gx, 26, "m4")
    for x in range(x0, 256):
        L.set(x, 14, "m3")
    L.rect(x0 - 2, 10, 255, 13, "m0")
    for x in range(x0 - 2, 256):
        L.set(x, 12, "m1")
        L.set(x, 13, "m4")
    # Pediment: raking cornice and a shaded tympanum, broken off on the left.
    for y in range(0, 10):
        xl = 196 + int((9 - y) * 3.2)
        for x in range(xl, 256):
            L.set(x, y, "m3" if x > xl + 3 else "m1")
        L.set(xl, y, "m0")
        L.set(xl + 1, y, "m0")
    # Broken ends: the entablature stops raggedly over the gap.
    rnd = random.Random(9)
    for y in range(10, 34):
        for x in range(x0 - 2, x0 + rnd.randint(1, 5)):
            L.set(x, y, None)
    # Moss in the joints at the foot of the steps.
    for _ in range(26):
        x, y = rnd.randint(122, 255), rnd.choice((base + 5, base + 11, base + 17))
        L.set(x, y, "g3")


def stump_ruin(L):
    # A broken column on its plinth at the left, and a fallen capital in the grass.
    courses(L, 22, 104, 54, 109, joint=11, course=6, tones=("m1", "m1", "m2", "m2", "m3", "m4"))
    courses(L, 14, 110, 62, 117, joint=12, offset=4, course=8, tones=("m1", "m1", "m2", "m2", "m2", "m3", "m3", "m4"))
    column(L, 38, 58, 104, broken_at=60)
    # Fallen capital: an abacus slab with the echinus under it, lying on its side.
    L.rect(92, 124, 113, 127, "m1")
    for x in range(92, 114):
        L.set(x, 124, "m0")
        L.set(x, 127, "m3")
    for k, (a, b) in enumerate([(94, 111), (96, 109), (98, 107)]):
        for x in range(a, b + 1):
            L.set(x, 128 + k, "m2" if x < 106 else "m3")
    for x in range(92, 116):
        L.set(x, 131, "sand3")


# ---------------------------------------------------------------- land and plants

def path_center(y):
    t = (y - 118) / (H - 118)
    return 140 - 48 * t + 10 * math.sin(t * 4)


def ground(L):
    rnd = random.Random(5)
    for x in range(W):
        top = 118 - 6 * math.sin(x / 26) - (2 if x < 70 else 0)
        if x >= 118:
            top = min(top, 124)  # the hill meets the lowest step
        for y in range(int(top), H):
            n = (math.sin(x * 0.53 + y * 1.1) + math.sin(x * 0.17 - y * 0.37) + math.sin(x * 0.9 - y * 0.2)) / 3
            L.set(x, y, ramp(x, y, 0.55 + 0.6 * n, ["sand3", "sand2", "sand1", "sand0"]))
        # Shadow line where the hill drops behind the ground.
        L.set(x, int(top), "sand1")
    # The path, worn lighter, edged with darker sand and pebbles.
    for y in range(118, H):
        cx = path_center(y)
        hw = 5 + (y - 118) * 0.55
        for x in range(int(cx - hw), int(cx + hw) + 1):
            edge = abs(x - cx) > hw - 1.5
            L.set(x, y, "sand2" if edge else ramp(x, y, 0.75 + 0.2 * math.sin(x * 0.3 + y), ["sand1", "sand0"]))
    for _ in range(40):
        y = rnd.randint(120, H - 1)
        x = int(path_center(y) + rnd.uniform(-1, 1) * (5 + (y - 118) * 0.5))
        L.set(x, y, "m1")
        L.set(x, y + 1, "sand3")


def tuft(L, x, y, rnd, tall=5):
    for b in range(rnd.randint(3, 6)):
        h = rnd.randint(2, tall)
        lean = rnd.choice((-1, 0, 0, 1))
        for k in range(h):
            L.set(x + b - 2 + (lean if k > h // 2 else 0), y - k, "g4" if k > h - 2 else "g3" if k > 1 else "g2")


def grass(L):
    rnd = random.Random(8)
    for _ in range(170):
        y = rnd.randint(116, H - 1)
        x = rnd.randint(0, W - 1)
        if abs(x - path_center(y)) < 6 + (y - 118) * 0.55 + 3:
            continue
        tuft(L, x, y, rnd, tall=4 + (y - 116) // 10)
    for _ in range(26):  # poppies
        y = rnd.randint(122, H - 2)
        x = rnd.randint(0, W - 1)
        if abs(x - path_center(y)) < 10 + (y - 118) * 0.55:
            continue
        L.set(x, y, "poppy")
        L.set(x + 1, y, "red2")
        L.set(x, y + 1, "g2")


def bush(L, cx, cy, rx, ry, seed=0):
    rnd = random.Random(seed)
    for y in range(int(cy - ry) - 2, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 2, int(cx + rx) + 2):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            wob = 0.16 * math.sin(x * 1.3 + seed) * math.cos(y * 1.1)
            if dx * dx + dy * dy <= 1 + wob:
                nz = math.sqrt(max(0, 1 - min(1, dx * dx + dy * dy)))
                light = -0.5 * dx - 0.7 * dy + 0.5 * nz + rnd.uniform(-0.25, 0.25)
                L.set(x, y, ramp(x, y, (light + 0.6) / 1.6, ["g1", "g2", "g3", "g4", "g5"]))


def cypress(L, x, top, base):
    for y in range(top, base):
        t = (y - top) / (base - top)
        hw = 1 + 4.5 * math.sin(min(1, t * 1.2) * math.pi / 2)
        for i in range(int(x - hw), int(x + hw) + 1):
            u = (i - (x - hw)) / (2 * hw + 0.01)
            v = 1 - u + 0.25 * math.sin(y * 0.9 + i)
            L.set(i, y, ramp(i, y, v * 0.8, ["g0", "g1", "g2", "g3"]))


def pine(L):
    """A stone pine leaning in from the top left: a bare, bending trunk and flat canopy pads."""
    for i in range(70):
        t = i / 69
        x = -3 + 30 * t + 5 * math.sin(t * 3.2)
        y = 86 - 76 * t
        for k in (-2, -1, 0, 1, 2):
            c = "bark1" if k < 0 else "bark0" if k < 2 else "m6"
            if (i + k) % 7 == 0:
                c = "m5"
            L.set(x + k, y, c)
    for (ax, ay), (bx, by) in [((14, 40), (4, 34)), ((20, 28), (36, 22)), ((24, 18), (12, 10))]:
        for k in range(12):
            t = k / 11
            L.set(ax + (bx - ax) * t, ay + (by - ay) * t, "bark0")
            L.set(ax + (bx - ax) * t, ay + (by - ay) * t - 1, "bark1")
    pads = [(42, 12, 20, 6), (14, 14, 14, 5), (66, 6, 14, 4), (24, 3, 18, 4), (50, 22, 10, 3), (4, 30, 10, 4),
            (34, 34, 9, 3)]
    rnd = random.Random(4)
    for cx, cy, rx, ry in pads:
        for y in range(int(cy - ry) - 2, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 2, int(cx + rx) + 2):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 + 0.22 * math.sin(x * 1.9 + y * 0.7):
                    v = 0.55 - 0.55 * dy - 0.15 * dx + rnd.uniform(-0.2, 0.2)
                    L.set(x, y, ramp(x, y, v, ["g0", "g1", "g2", "g3", "g4"]))


def lavender(L, x0, y0, n, seed):
    rnd = random.Random(seed)
    for _ in range(n):
        x = x0 + rnd.randint(-12, 12)
        y = y0 + rnd.randint(-2, 3)
        h = rnd.randint(7, 13)
        lean = rnd.choice((-1, 0, 1))
        for k in range(h):
            xx = x + (lean if k > h * 0.6 else 0)
            if k < h - 4:
                L.set(xx, y - k, "g3" if k % 3 else "g2")
            else:
                L.set(xx, y - k, "lav2" if k == h - 1 else "lav1" if (k + x) % 2 else "lav0")
                if k < h - 1 and rnd.random() < 0.5:
                    L.set(xx + rnd.choice((-1, 1)), y - k, "lav0")
    for k in range(-14, 15):  # leafy base
        L.set(x0 + k, y0 + 3, "g2" if k % 3 else "g3")


def fallen_blocks(L):
    for x0, y0, w, h in [(196, 136, 34, 12), (230, 128, 26, 20), (214, 148, 42, 12), (170, 150, 30, 10)]:
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if y < y0 + 3:
                    c = "m0" if y == y0 else "m1"
                elif x > x0 + w - 4:
                    c = "m4"
                else:
                    c = ramp(x, y, 0.6 - (y - y0) / h * 0.5, ["m3", "m2", "m1"])
                if y == y0 + h - 1:
                    c = "m5"
                L.set(x, y, c)
        L.set(x0, y0, None)
        L.set(x0 + w - 1, y0, None)


# ---------------------------------------------------------------- figures

class Figure:
    """A small local canvas for a character: shapes drawn back to front, then an ink outline around it all."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = {}

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[(x, y)] = c

    def disc(self, cx, cy, r, tone, ry=None):
        ry = ry or r
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1:
                    self.set(x, y, tone(x, y, dx, dy))

    def capsule(self, ax, ay, bx, by, ra, rb, tone):
        lo_x, hi_x = int(min(ax, bx) - max(ra, rb)) - 1, int(max(ax, bx) + max(ra, rb)) + 2
        lo_y, hi_y = int(min(ay, by) - max(ra, rb)) - 1, int(max(ay, by) + max(ra, rb)) + 2
        vx, vy = bx - ax, by - ay
        ll = vx * vx + vy * vy or 1
        for y in range(lo_y, hi_y):
            for x in range(lo_x, hi_x):
                px_, py_ = x + 0.5 - ax, y + 0.5 - ay
                t = max(0, min(1, (px_ * vx + py_ * vy) / ll))
                d = math.hypot(px_ - vx * t, py_ - vy * t)
                r = ra + (rb - ra) * t
                if d <= r:
                    # Side of the limb facing up-left is lit.
                    nx, ny = (px_ - vx * t) / r, (py_ - vy * t) / r
                    self.set(x, y, tone(x, y, nx, ny))

    def rows(self, x0, y0, art, legend):
        for y, line in enumerate(art):
            for x, ch in enumerate(line):
                if ch not in ". ":
                    self.set(x0 + x, y0 + y, legend[ch])

    def outline(self, ink="ink", skip=()):
        add = {}
        for (x, y), c in self.c.items():
            if c in skip:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in self.c and 0 <= n[0] < self.w and 0 <= n[1] < self.h:
                    add[n] = ink
        self.c.update(add)

    def paste(self, L, x0, y0):
        for (x, y), c in self.c.items():
            L.set(x0 + x, y0 + y, c)


def lit(keys, bias=0.0):
    """A tone function: lighter towards the upper left of a shape."""
    def tone(x, y, nx, ny):
        v = 0.5 - 0.45 * nx - 0.55 * ny + bias
        return ramp(x, y, v, keys)
    return tone


ATHENA_HEAD = [
    "......rr......",
    ".....rRrr.....",
    "....rRRrrr....",
    "....rRRrrr....",
    "....kRRrrk....",
    "...kgGyyGgk...",
    "..kgGyyGGGgk..",
    "..kgkkGGkkgk..",
    "..kgGGGGGGgk..",
    "..kyyyyyyyyk..",
    ".kHhsssssshHk.",
    ".kHsessesshHk.",
    ".kHssssSsshHk.",
    ".kHhssllsshHk.",
    ".kHhhssssShHk.",
    ".kHhhkSSkhhHk.",
]
HEAD_KEY = {"r": "red1", "R": "red0", "k": "ink", "g": "gold0", "G": "gold2", "y": "gold3", "h": "hair0",
            "H": "hair1", "s": "skin2", "S": "skin1", "e": "ink", "l": "lips"}


def athena():
    f = Figure(34, 50)
    cx = 17
    # Spear in her right hand (on our left): a long ash shaft with a leaf-shaped steel point.
    for y in range(4, 50):
        f.set(5, y, "bark1" if y % 6 else "bark0")
    for y, half in enumerate([0, 1, 1, 1, 1, 0]):
        for i in range(-half, half + 1):
            f.set(5 + i, y, "steel1" if i <= 0 else "steel0")
    # Hair falling behind the shoulders.
    for y in range(16, 26):
        for i in (-7, -6, 6, 7):
            f.set(cx + i, y, "hair1" if i < 0 else "hair0")
    # Peplos: a long dress flaring to the hem, folds falling from the belt.
    for y in range(18, 47):
        t = (y - 18) / 28
        half = 6 + 4 * t
        for x in range(int(cx - half), int(cx + half) + 1):
            u = (x - (cx - half)) / (2 * half)
            v = 0.85 - 0.75 * u
            if y > 27:
                fold = math.sin((x - cx) * 1.25 + (y - 27) * 0.06)
                v += 0.35 * fold
            f.set(x, y, ramp(x, y, v, ["cloth3", "cloth2", "cloth1", "cloth0"]))
    for x in range(cx - 8, cx + 9):  # the overfold's hem and the belt
        f.set(x, 33, "cloth2" if x < cx + 4 else "cloth3")
    for x in range(cx - 6, cx + 7):
        f.set(x, 27, "gold2" if x < cx + 2 else "gold1")
    # Aegis: a cape of golden scales over the shoulders, the Gorgon's face at its centre, snakes at its edge.
    for y in range(16, 26):
        half = 8 - max(0, y - 21) * 1.6
        for x in range(int(cx - half), int(cx + half) + 1):
            scale = (x + (y % 2)) % 2 == 0
            f.set(x, y, ("gold3" if scale else "gold2") if x < cx else ("gold2" if scale else "gold1"))
    for x in range(cx - 8, cx + 9, 2):
        f.set(x, 26 - abs(x - cx) // 3, "g2")
    f.rows(cx - 2, 19, [".sss.", "seses", "sSsSs", ".srs."], {"s": "skin2", "e": "ink", "S": "skin1", "r": "red1"})
    # Arms: the right reaches out to the spear, the left rests on the shield rim.
    f.capsule(cx - 7, 19, 7, 25, 2, 1.5, lit(["skin0", "skin1", "skin2"]))
    f.disc(6, 25, 1.6, lambda x, y, nx, ny: "skin1")
    f.capsule(cx + 7, 19, cx + 10, 30, 2, 1.5, lit(["skin0", "skin1", "skin2"]))
    # Feet in sandals under the hem.
    for x in (cx - 3, cx - 2, cx + 2, cx + 3):
        f.set(x, 47, "skin1")
    f.set(cx - 4, 47, "bark0")
    f.set(cx + 4, 47, "bark0")
    # Shield resting on the ground at her left: bronze rim, polished face, the owl's eye at its centre.
    def shield(x, y, nx, ny):
        d = math.hypot(nx, ny)
        if d > 0.82:
            return ramp(x, y, 0.5 - 0.6 * nx - 0.6 * ny, ["gold0", "gold1", "gold2", "gold3"])
        if d < 0.3:
            return "red1" if d > 0.16 else "gold3"
        return ramp(x, y, 0.45 - 0.7 * nx - 0.7 * ny, ["gold0", "gold1", "gold2"])
    f.disc(cx + 11, 37, 8.5, shield)
    f.rows(cx - 7, 0, ATHENA_HEAD, HEAD_KEY)
    f.outline(skip=("steel0", "steel1", "bark0", "bark1"))
    return f


HOPLITE_HEAD = [
    "..rrrrrr.........",
    ".rRRrrrrrr.......",
    "rRRRRrrrrrr......",
    "RR...kkkkrrr.....",
    ".....kgGGyyGk....",
    "....kgGGGyyyGk...",
    "....kgGGGGGGGGk..",
    "....kggGGGkkkGk..",
    "....kggGGkkeekk..",
    "....kgggGGGkGGk..",
    ".....kgggGGkGk...",
    ".....kgggGkhhk...",
    "......kggkhhk....",
    ".......kkkhk.....",
]
HOP_KEY = {"r": "red1", "R": "red0", "k": "ink", "g": "gold0", "G": "gold1", "y": "gold3", "e": "skin1",
           "h": "hair0"}


def hoplite():
    f = Figure(40, 48)
    # Spear held upright in the far hand.
    for y in range(4, 48):
        f.set(33 + (48 - y) // 16, y, "bark1" if y % 5 else "bark0")
    for y, half in enumerate([0, 1, 1, 1, 0]):
        for i in range(-half, half + 1):
            f.set(36 + i, y, "steel1" if i <= 0 else "steel0")
    # Red cloak streaming back from the shoulders.
    for y in range(14, 38):
        t = (y - 14) / 24
        x0 = 12 - 9 * t - 2 * math.sin(t * 6)
        for x in range(int(x0), 20):
            f.set(x, y, ramp(x, y, 0.75 - 0.6 * t + 0.25 * math.sin(x * 0.8), ["red0", "red1", "red2"]))
    # Legs: the far leg pushes off behind, the near leg steps forward; bronze greaves on the shins.
    shin = lit(["gold0", "gold1", "gold2", "gold3"])
    thigh = lit(["skin0", "skin1", "skin2"])
    f.capsule(19, 33, 15, 39, 2.2, 1.8, lit(["skin0", "skin1"], -0.2))
    f.capsule(15, 39, 12, 45, 1.8, 1.6, lit(["gold0", "gold1"], -0.2))
    f.capsule(21, 33, 25, 39, 2.2, 1.8, thigh)
    f.capsule(25, 39, 26, 45, 1.8, 1.6, shin)
    for x in range(10, 15):
        f.set(x, 46, "bark0")
    for x in range(25, 30):
        f.set(x, 46, "bark0")
    # Chiton skirt with linen strips (pteruges).
    for y in range(29, 34):
        for x in range(15, 27):
            f.set(x, y, "cloth1" if (x + (y > 31)) % 3 else "cloth3" if y > 31 else "red1")
    # The far hand on the spear.
    f.disc(33, 25, 1.8, lambda x, y, nx, ny: "skin1" if nx > -0.2 else "skin2")
    # The aspis: a big round shield on the near arm, bronze, with a lambda in red.
    def aspis(x, y, nx, ny):
        d = math.hypot(nx, ny)
        if d > 0.86:
            return ramp(x, y, 0.5 - 0.6 * nx - 0.6 * ny, ["gold0", "gold1", "gold2", "gold3"])
        v = 0.42 - 0.7 * nx - 0.65 * ny
        if -0.75 < nx < -0.2 and -0.75 < ny < -0.25 and (nx + ny) < -0.9:
            v += 0.5  # a polished highlight
        return ramp(x, y, v, ["gold0", "gold1", "gold2", "gold3"])
    f.disc(20, 22, 10.5, aspis)
    for k in range(7):
        f.set(20 - k * 0.6, 18 + k, "red0")
        f.set(20 + k * 0.6, 18 + k, "red0")
        f.set(21 - k * 0.6, 18 + k, "red1")
    f.rows(13, 0, HOPLITE_HEAD, HOP_KEY)
    f.outline(skip=("steel0", "steel1", "bark0", "bark1"))
    return f


OWL = [
    "..k.......k..",
    ".kok.....kok.",
    ".koOkkkkkOok.",
    "koOOOOOOOOOok",
    "kOyyOOOOOyyOk",
    "kyekyOOOyekyk",
    "kyyyOOgOOyyyk",
    "kOOOOOgOOOOOk",
    ".koOcOcOcOok.",
    ".koOOcOcOOok.",
    ".kooOcOcOook.",
    "..kooOOOook..",
    "..kgk...kgk..",
]
OWL_KEY = {"k": "ink", "o": "bark0", "O": "bark1", "y": "gold3", "e": "ink", "g": "gold1", "c": "m2"}


def inside(poly, x, y):
    """Point in polygon (even-odd)."""
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def pegasus():
    """Built from a horse's anatomy: barrel, chest, rump, arched neck, head; legs in a gallop; a raised wing."""
    f = Figure(76, 50)
    coat = lambda bias=0.0: lit(["wing3", "wing2", "wing1", "wing0", "wing0"], bias)
    ox, oy = 4, 7
    # Far legs first, in shade.
    far = lit(["wing3", "wing2"], -0.3)
    f.capsule(ox + 22, oy + 27, ox + 15, oy + 32, 2.6, 1.8, far)
    f.capsule(ox + 15, oy + 32, ox + 8, oy + 35, 1.8, 1.4, far)
    f.capsule(ox + 47, oy + 27, ox + 52, oy + 32, 2.4, 1.6, far)
    f.capsule(ox + 52, oy + 32, ox + 49, oy + 37, 1.6, 1.3, far)
    # Tail: one plume of golden hair, widening as it streams back, with strands drawn inside and a ragged end.
    rnd = random.Random(2)
    ends = {}
    for i in range(48):
        t = i / 47
        x = ox + 15 - 17 * t
        top = oy + 19 - 1.5 * t + 1.4 * math.sin(t * 5)
        bot = oy + 22 + 6 * t + 1.4 * math.sin(t * 5 + 0.6)
        for y in range(int(top), int(bot) + 1):
            if t > 0.78 and rnd.random() < (t - 0.78) * 3:
                continue
            band = (y - top) / max(1, bot - top)
            c = "gold3" if band < 0.3 else "gold2" if band < 0.75 else "gold1"
            if (y + int(t * 6)) % 3 == 0 and t > 0.15:
                c = "gold1" if c != "gold1" else "gold0"
            f.set(x, y, c)
    # Body: rump, barrel, chest.
    f.disc(ox + 21, oy + 22, 7.5, coat(), 7)
    f.disc(ox + 33, oy + 23, 12, coat(), 7)
    f.disc(ox + 45, oy + 21, 7, coat(0.05), 7.5)
    # Neck arching up to the head.
    f.capsule(ox + 47, oy + 19, ox + 56, oy + 8, 6, 4, coat(0.1))
    f.capsule(ox + 56, oy + 7, ox + 64, oy + 12, 4.2, 2.6, coat(0.15))
    f.set(ox + 63, oy + 13, "wing3")
    f.set(ox + 61, oy + 8, "ink")            # eye
    f.set(ox + 61, oy + 9, "ink")
    f.set(ox + 66, oy + 13, "wing3")         # nostril
    for e in [(54, 1), (55, 0), (55, 2), (56, 1), (56, 2), (57, 2)]:  # ear
        f.set(ox + e[0], oy + e[1], "wing1")
    # Mane along the crest of the neck.
    for i in range(14):
        t = i / 13
        x, y = ox + 48 + 8 * t, oy + 13 - 10 * t
        f.set(x - 1, y, "gold3")
        f.set(x - 2, y + 1, "gold2")
        f.set(x - 3, y + 2, "gold1")
    # Near legs: hind leg reaching back, foreleg tucked under the chest; golden hooves.
    near = coat(-0.05)
    f.capsule(ox + 20, oy + 26, ox + 13, oy + 31, 3, 2, near)
    f.capsule(ox + 13, oy + 31, ox + 4, oy + 34, 2, 1.5, near)
    f.capsule(ox + 46, oy + 26, ox + 53, oy + 30, 2.6, 1.8, near)
    f.capsule(ox + 53, oy + 30, ox + 50, oy + 35, 1.8, 1.4, near)
    for hx, hy in [(3, 34), (3, 35), (4, 35), (50, 36), (51, 36), (8, 36), (7, 36), (49, 38), (48, 38)]:
        f.set(ox + hx, oy + hy, "gold1")
    # The wing, raised above the back: a leading edge arching up from the shoulder to the tip, and a trailing
    # edge of long flight feathers whose tips make a scalloped line back to the body.
    sx, sy = ox + 38, oy + 17
    lead = [(sx, sy), (sx - 3, sy - 8), (sx - 7, sy - 14), (sx - 13, sy - 19), (sx - 21, sy - 22), (sx - 30, sy - 23)]
    feathers = 9
    trail = []
    for k in range(feathers + 1):
        t = k / feathers
        # From the wing tip back towards the body, each feather tip a little lower than the last.
        bx = (sx - 30) + 20 * t
        by = (sy - 20) + 19 * t ** 0.8
        trail.append((bx, by))
        if k < feathers:
            trail.append((bx + 1.3, by - 2.2))  # the notch between two feather tips
    poly = lead + trail  # tip first along the trailing edge, back towards the body
    for y in range(0, 46):
        for x in range(0, 76):
            if inside(poly, x + 0.5, y + 0.5):
                # Coverts near the leading edge are lit; flight feathers below in soft shade.
                d_lead = min(math.hypot(x - lx, y - ly) for lx, ly in lead)
                v = 0.95 - d_lead / 9
                f.set(x, y, ramp(x, y, v, ["wing2", "wing1", "wing0", "wing0"]))
    # Feather shafts: lines from each notch up towards the leading edge.
    for k in range(feathers):
        nx_, ny_ = trail[2 * k + 1]
        lx, ly = lead[min(len(lead) - 1, len(lead) - 1 - int(k / feathers * (len(lead) - 1)))]
        for i in range(1, 8):
            t = i / 10
            f.set(nx_ + (lx - nx_) * t, ny_ + (ly - ny_) * t, "wing2")
    # A row of covert edges across the wing.
    for i in range(30):
        t = i / 29
        x = sx - 4 - 24 * t
        y = sy - 7 - 14 * t
        f.set(x, y + 3, "wing2" if i % 3 else "wing1")
    f.outline()
    return f


def figures(L):
    pegasus().paste(L, 88, 1)
    athena().paste(L, 196, 57)       # on the stylobate between two columns
    f = Figure(13, 13)
    f.rows(0, 0, OWL, OWL_KEY)
    f.paste(L, 32, 47)              # on the broken column at the left
    hoplite().paste(L, 92, 106)     # climbing the path


# ---------------------------------------------------------------- build

def build():
    layers = [Layer("Sky"), Layer("Sea"), Layer("Back plants"), Layer("Temple"), Layer("Ground"),
              Layer("Front plants"), Layer("Figures")]
    sky_, sea_, back, tem, gro, front, fig = layers
    sky(sky_)
    clouds(sky_)
    gulls(sky_)
    far(sea_)
    sea(sea_)
    cypress(back, 196, 44, 106)
    cypress(back, 214, 54, 106)
    bush(back, 112, 112, 16, 8, 1)
    bush(back, 132, 108, 10, 7, 2)
    bush(back, 70, 108, 12, 7, 3)
    pine(back)
    temple(tem)
    stump_ruin(tem)
    ground(gro)
    grass(gro)
    bush(front, 246, 120, 14, 9, 4)
    bush(front, 6, 134, 14, 12, 5)
    fallen_blocks(front)
    lavender(front, 30, 152, 34, 1)
    lavender(front, 138, 157, 24, 2)
    lavender(front, 186, 140, 12, 3)
    figures(fig)
    return layers


def flatten(layers):
    from PIL import Image
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for L in layers:
        for y in range(H):
            for x in range(W):
                c = L.px[y][x]
                if c:
                    im.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return im


class Agent:
    """A minimal MCP client over stdio, like make-art.py."""

    def __init__(self):
        self.p = subprocess.Popen([APP, "--mcp", "--headless"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.n = 0
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "openpixel-website", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")

    def rpc(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
        self.p.stdin.flush()
        reply = json.loads(self.p.stdout.readline())
        if "error" in reply:
            raise RuntimeError(f"{method}: {reply['error']}")
        return reply["result"]

    def call(self, tool, **args):
        r = self.rpc("tools/call", {"name": tool, "arguments": args})
        text = next((c["text"] for c in r["content"] if c["type"] == "text"), "{}")
        if r.get("isError"):
            raise RuntimeError(f"{tool}: {text}")
        return text

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+-=?@^_~"


def draw_in_openpixel(layers):
    agent = Agent()
    agent.call("new_sprite", width=W, height=H, name="Temple of Athena")
    agent.call("set_palette", colors=list(dict.fromkeys(P.values())))
    for i, L in enumerate(layers):
        if i == 0:
            agent.call("set_layer", layer=0, name=L.name)
        else:
            agent.call("add_layer", name=L.name)
        used = sorted({c for row in L.px for c in row if c})
        legend = {CHARS[k]: c for k, c in enumerate(used)}
        back = {c: ch for ch, c in legend.items()}
        rows = ["".join(back[c] if c else "." for c in row) for row in L.px]
        # Bands of rows keep each call small; '.' leaves cells empty on this layer.
        for y0 in range(0, H, 32):
            agent.call("paint_slice", axis="z", index=0, rows=rows[y0:y0 + 32], legend=legend, offset=[0, y0],
                       layer=L.name, mode="merge")
    agent.call("set_active", layer=len(layers) - 1)
    agent.call("save_model", path=SOURCE)
    agent.close()


def screenshot(source, out, name):
    """The editor showing `source`, as `out` (a 2880×1710 PNG of a 1440×855 window). The app shows the file's own
    name in its tab and sidebar, so it opens a copy called `name`. --screenshot starts from the app's defaults and
    leaves the person's Recents alone."""
    with tempfile.TemporaryDirectory() as d:
        copy = os.path.join(d, name + ".openpixel")
        shutil.copyfile(source, copy)
        r = subprocess.run([APP, "--screenshot", out, copy], capture_output=True, text=True, timeout=120)
    print(r.stderr.strip()[-400:])
    try:  # an opaque picture needs no alpha channel: a smaller file for the website
        from PIL import Image
        Image.open(out).convert("RGB").save(out, optimize=True)
    except ImportError:
        pass
    print("wrote", out)


def main():
    if "--shot" in sys.argv:
        screenshot(SOURCE, SHOT, "Temple of Athena")
        return
    layers = build()
    if "--write" not in sys.argv:
        out = os.path.join(os.environ.get("TMPDIR", "/tmp"), "temple-preview.png")
        im = flatten(layers)
        im.resize((W * 4, H * 4), 0).save(out)
        print(out)
        return
    draw_in_openpixel(layers)
    print("saved", SOURCE)
    screenshot(SOURCE, SHOT, "Temple of Athena")


if __name__ == "__main__":
    main()

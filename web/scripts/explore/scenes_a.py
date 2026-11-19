#!/usr/bin/env python3
"""Explore page, Scenes collection (set A): drawn with OpenPixel over MCP.

    OPENPIXEL=…/OpenPixel REVIEW_DIR=… python3 scenes_a.py [slug …]

Each scene is built as rows of pixels in Python (layered skies, noise ridgelines, stamped trees and buildings,
per-frame particles), with the focal details placed by hand, then sent to OpenPixel with paint_slice, reviewed
with review_model and exported by common.Collection.publish(). Voxel dioramas are sent layer by layer.
"""
import math
import random
import sys

import common
import op

COL = common.Collection("scenes_a", "scenes")
BRAND = "#ff4a1c"

# ---------------------------------------------------------------- 2D canvas

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-/:;<=>?@[]^_{|}~"


class Canvas:
    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.px = [[fill] * w for _ in range(h)]

    def copy(self):
        c = Canvas(self.w, self.h)
        c.px = [r[:] for r in self.px]
        return c

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h and c is not None:
            self.px[y][x] = c

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def rect(self, x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(self.h, y1 + 1)):
            for x in range(max(0, x0), min(self.w, x1 + 1)):
                self.px[y][x] = c

    def hline(self, x0, x1, y, c):
        self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, y0, x, y1, c)

    def ellipse(self, cx, cy, rx, ry, c, only=None):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x - cx) / (rx + .5)) ** 2 + ((y - cy) / (ry + .5)) ** 2 <= 1:
                    if only is None or only(x, y):
                        self.set(x, y, c)

    def disc(self, cx, cy, r, c):
        self.ellipse(cx, cy, r, r, c)

    def line(self, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def poly(self, pts, c):
        ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(self.h, int(max(ys)) + 1)):
            xs = []
            n = len(pts)
            for i in range(n):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
                if (y0 <= y + .5 < y1) or (y1 <= y + .5 < y0):
                    xs.append(x0 + (y + .5 - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(math.ceil(xs[i] - .5)), int(math.floor(xs[i + 1] - .5)) + 1):
                    self.set(x, y, c)

    def stamp(self, rows, legend, x0, y0, flip=False):
        for j, r in enumerate(rows):
            if flip:
                r = r[::-1]
            for i, ch in enumerate(r):
                if ch in legend:
                    self.set(x0 + i, y0 + j, legend[ch])

    def recolor(self, fn):
        for y in range(self.h):
            for x in range(self.w):
                self.px[y][x] = fn(x, y, self.px[y][x])

    def colors(self):
        return {c for r in self.px for c in r if c}


def to_slice(cv):
    cols = sorted(cv.colors())
    assert len(cols) <= len(CHARS), f"too many colours: {len(cols)}"
    key = {c: CHARS[i] for i, c in enumerate(cols)}
    rows = ["".join(key[c] if c else "." for c in r) for r in cv.px]
    return rows, {v: k for k, v in key.items()}


def rgb(c):
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


def cdist(a, b):
    """OpenPixel's weighted RGB distance; under 900 counts as near-identical."""
    (r1, g1, b1), (r2, g2, b2) = rgb(a), rgb(b)
    return 3 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 2 * (b1 - b2) ** 2


def tidy(frames, limit=46, near=1000, keep=()):
    """Merges near-identical colours (into the more used one) and then the closest pairs until at most `limit`
    colours remain, across all frames. Colours in `keep` are never merged away."""
    count = {}
    for cv in frames:
        for r in cv.px:
            for c in r:
                if c:
                    count[c] = count.get(c, 0) + 1
    remap = {c: c for c in count}
    cols = list(count)
    while True:
        best = None
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                d = cdist(cols[i], cols[j])
                if best is None or d < best[0]:
                    best = (d, cols[i], cols[j])
        if not best or (best[0] >= near and len(cols) <= limit):
            break
        _, x, y = best
        if x in keep and y in keep:
            near = min(near, best[0])  # can't merge two kept colours; stop at this distance
            if len(cols) <= limit:
                break
        lose, win = (x, y) if (count[x] < count[y] and x not in keep) or y in keep else (y, x)
        if lose in keep:
            lose, win = win, lose
        count[win] += count.pop(lose)
        cols.remove(lose)
        for k, v in remap.items():
            if v == lose:
                remap[k] = win
    for cv in frames:
        cv.px = [[remap[c] if c else c for c in r] for r in cv.px]
    return len(cols)


def send_frames(a, frames, durations, keep=(), clean=True):
    """New sprite with one frame per canvas; durations is one ms value per frame (or a single int)."""
    n = tidy(frames, keep=keep)
    print(f"  {n} colours")
    w, h = frames[0].w, frames[0].h
    a.call("new_sprite", width=w, height=h)
    if isinstance(durations, int):
        durations = [durations] * len(frames)
    for i, cv in enumerate(frames):
        if i:
            a.call("add_frame", copy=False)
        rows, legend = to_slice(cv)
        a.call("paint_slice", rows=rows, legend=legend, frame=i)
        a.call("set_frame_duration", frame=i, duration_ms=durations[i])
    if clean:
        a.call("pixel_perfect", all_frames=True)
    a.call("set_active", frame=0)


def bayer(x, y):
    return (BAYER[y % 4][x % 4] + .5) / 16


def ramp_pick(ramp, t, x, y, soft=.3):
    """Colour from `ramp` at t (0..1). Bands are solid with a short ordered-dither seam between them."""
    t = min(max(t, 0), 1) * (len(ramp) - 1)
    i = int(t)
    if i >= len(ramp) - 1:
        return ramp[-1]
    f = t - i
    f = min(max((f - .5) / soft + .5, 0), 1)
    return ramp[i + 1] if f > bayer(x, y) else ramp[i]


def noise1(seed, n, step, octaves=3):
    """Smooth 1D value noise in about -1..1, n samples."""
    out = [0.0] * n
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        r = random.Random(seed * 131 + o)
        s = max(1, step / (2 ** o))
        pts = [r.uniform(-1, 1) for _ in range(int(n / s) + 3)]
        for x in range(n):
            u = x / s
            i = int(u)
            f = u - i
            f = (1 - math.cos(f * math.pi)) / 2
            out[x] += amp * (pts[i] * (1 - f) + pts[i + 1] * f)
        tot += amp
        amp *= .5
    return [v / tot for v in out]


def h(seed, *k):
    """Deterministic hash to 0..1."""
    return random.Random(hash((seed,) + k) & 0xffffffff).random()


# ---------------------------------------------------------------- shared stamps

def pine(cv, x, base, height, dark, light=None, snow=None, rng=None):
    """A layered pine tree silhouette, apex at (x, base-height). Light side on the left."""
    rng = rng or random.Random(x * 7 + base)
    top = base - height
    for y in range(top, base + 1):
        k = (y - top) / max(1, height)
        tier = (y - top) % 4
        half = int(k * height * .32 + (tier * .6) + .5)
        for dx in range(-half, half + 1):
            c = dark
            if light and dx < 0 and (dx == -half or (tier == 3 and dx > -half + 1 and dx < -1)):
                c = light
            if snow and tier == 0 and dx <= 0 and dx >= -half and y > top + 1:
                c = snow
            cv.set(x + dx, y, c)
    cv.vline(x, base, base + 1, dark)


def fir(cv, x, base, height, dark, mid, light, snow=None, trunk="#3b2026"):
    """A full fir tree: stacked tiers that widen downward, lit from the left; snow sits on each tier's shelf."""
    top = base - height
    canopy = height - 3
    n = max(3, canopy // 6)
    th = canopy / n
    tiers = []
    for t in range(n):
        y0 = top + int(t * th * .78)
        y1 = top + int((t + 1) * th)
        wmax = 1.5 + (t + 1) / n * height * .3
        tiers.append((y0, y1, wmax))
    for (y0, y1, wmax) in tiers:
        for y in range(y0, y1 + 1):
            k = (y - y0) / max(1, y1 - y0)
            half = int(.5 + wmax * k)
            for dx in range(-half, half + 1):
                c = mid if dx < -half // 3 else dark
                if dx <= -half + 1 and k > .2:
                    c = light
                if y == y1 and abs(dx) == half and half > 2:
                    continue
                cv.set(x + dx, y, c)
        if snow:  # the shelf: the upper-left edge of the tier and its first row
            for y in range(y0, y1):
                k = (y - y0) / max(1, y1 - y0)
                half = int(.5 + wmax * k)
                for dx in range(-half, -half + 2 + (1 if k > .5 else 0)):
                    if dx <= 0:
                        cv.set(x + dx, y, snow)
            cv.set(x, y0, snow)
    cv.rect(x - 1, base - 2, x, base + 1, trunk)


# ---------------------------------------------------------------- 1. Snowy Cabin

def scene_cabin(a):
    W, H, N = 192, 108, 8
    sky = ["#0a0d22", "#11163a", "#19204f", "#222b62", "#2c3672"]
    bg = Canvas(W, H)
    for y in range(H):
        for x in range(W):
            bg.px[y][x] = ramp_pick(sky, (y / 70) ** 1.25, x, y)
    # moon with a soft glow, top left
    mx, my = 38, 22
    bg.ellipse(mx, my, 13, 13, "#2f3b7a", only=lambda x, y: bayer(x, y) < .5 or (x - mx) ** 2 + (y - my) ** 2 < 110)
    bg.disc(mx, my, 8, "#e9e2c4")
    bg.ellipse(mx + 2, my + 1, 7, 7, "#fbf5dc", only=lambda x, y: (x - mx + 3) ** 2 + (y - my + 3) ** 2 < 40)
    for cx, cy, r in ((mx + 2, my + 3, 1.6), (mx - 3, my - 2, 1), (mx + 4, my - 3, .8)):
        bg.ellipse(cx, cy, r, r, "#cfc7a6")
    rng = random.Random(3)
    stars = []
    for _ in range(70):
        x, y = rng.randrange(2, W - 2), rng.randrange(1, 56)
        if (x - mx) ** 2 + (y - my) ** 2 < 260:
            continue
        stars.append((x, y, rng.random()))
        bg.set(x, y, "#7d88c4" if rng.random() < .6 else "#c9d1f2")
    # far mountains: cool, light, snowy
    far = noise1(11, W, 46)
    for x in range(W):
        top = int(58 - far[x] * 6 - 14 * math.exp(-((x - 62) / 20) ** 2) - 10 * math.exp(-((x - 172) / 18) ** 2))
        for y in range(top, H):
            snow = y < top + 2 + int(abs(far[(x * 3) % W]) * 3) + (5 if top < 50 else 0)
            lit = far[min(W - 1, x + 1)] <= far[x]
            bg.px[y][x] = ("#8592c9" if lit else "#6875ad") if snow else ("#3d4a86" if lit else "#344079")
    # mid hill with pines
    mid = noise1(12, W, 30)
    hill = [int(70 - mid[x] * 4) for x in range(W)]
    for x in range(W):
        for y in range(hill[x], H):
            bg.px[y][x] = "#1d2754" if y > hill[x] else "#3a4785"
    r2 = random.Random(5)
    x = 2
    while x < W:
        pine(bg, x, hill[x] + 1, r2.randint(7, 15), "#161f47", "#26316a", "#5d6aa6", r2)
        x += r2.randint(4, 9)
    # foreground snow field
    gnd = [int(82 + 3 * math.sin(x / 23) + 2 * math.sin(x / 9 + 1)) for x in range(W)]
    snow = ["#dbe3f6", "#b4c0e3", "#8b98cc", "#66729f"]
    for x in range(W):
        for y in range(gnd[x], H):
            d = y - gnd[x]
            t = .0 if d < 2 else .32 + (y - 82) / 60
            t += .12 * math.sin(x / 13 + y / 5) * (d > 3)
            bg.px[y][x] = ramp_pick(snow, t, x, y, soft=.25)
    # snow drifts: soft highlight ridges
    for k, (x0, x1, y0) in enumerate(((4, 60, 96), (30, 100, 103), (150, 190, 98))):
        for x in range(x0, x1):
            yy = y0 + int(2 * math.sin((x - x0) / (x1 - x0) * math.pi * 2 + k))
            bg.set(x, yy, "#dbe3f6")
            bg.set(x, yy + 1, "#b4c0e3")

    # big snowy pine at left, the frame for the cabin
    big = Canvas(W, H)
    fir(big, 92, 86, 38, "#0f1a3e", "#1b2a5c", "#2b3d78", "#d6def4", trunk="#2a1820")
    fir(big, 76, 88, 24, "#0f1a3e", "#1b2a5c", "#2b3d78", "#d6def4", trunk="#2a1820")
    for y in range(H):
        for x in range(W):
            if big.px[y][x]:
                bg.px[y][x] = big.px[y][x]
    # cabin
    cx0, cx1, wall_top, wall_bot = 112, 151, 63, 84
    logs = ["#3b2026", "#6a3c31", "#8d5a3f", "#b07c55"]
    for y in range(wall_top, wall_bot + 1):
        k = (y - wall_top) % 4
        for x in range(cx0, cx1 + 1):
            c = logs[3] if k == 0 else logs[2] if k == 1 else logs[1] if k == 2 else logs[0]
            if x > cx1 - 4 and k in (1, 2):
                c = logs[1]
            bg.px[y][x] = c
    for y in range(wall_top, wall_bot + 1, 4):  # log ends at the corners
        for ex in (cx0 - 2, cx1 + 1):
            bg.rect(ex, y, ex + 1, y + 2, logs[2])
            bg.set(ex, y, logs[3])
            bg.set(ex + 1, y + 2, logs[0])
    # roof: dark eaves, then a thick snow cap with icicles
    apex = (131.5, 44)
    bg.poly([(cx0 - 6, wall_top + 1), apex, (cx1 + 6, wall_top + 1)], "#2a1820")
    bg.poly([(cx0 - 3, wall_top), (apex[0], apex[1] + 4), (cx1 + 3, wall_top)], "#7a4a38")
    for y in range(int(apex[1]) + 5, wall_top):  # gable boards
        for x in range(cx0, cx1 + 1):
            if bg.px[y][x] == "#7a4a38" and (x - cx0) % 5 == 0:
                bg.px[y][x] = "#5a3429"
    roof_snow = ["#f2f5ff", "#cdd6f2", "#9eabd9"]
    for y in range(int(apex[1]) - 2, wall_top + 2):
        for x in range(cx0 - 8, cx1 + 9):
            u = abs(x - apex[0])
            edge = (y - apex[1] + 2) * 1.05
            if edge - 4 <= u <= edge + 1:
                bg.set(x, y, roof_snow[0] if x < apex[0] else roof_snow[1] if u > edge - 3 else roof_snow[2])
    for i, x in enumerate(range(cx0 - 5, cx1 + 6, 3)):  # icicles + lumpy bottom edge
        ln = 1 + (i * 5 % 3)
        for d in range(ln):
            bg.set(x, wall_top + 2 + d, "#b9c6ee" if d else "#e6ecff")
    # round attic window, glowing
    bg.disc(131, 54, 2.2, "#3b2026")
    bg.disc(131, 54, 1.4, "#ffd47a")
    bg.set(130, 53, "#fff1c2")
    # chimney
    for y in range(41, 58):
        for x in range(141, 147):
            stone = ((x - 141) // 3 + (y - 41) // 2) % 2
            bg.px[y][x] = "#6a6684" if stone else "#55516f"
            if (y - 41) % 2 == 1:
                bg.px[y][x] = "#3c3a55"
            if x == 141:
                bg.px[y][x] = "#7c7899"
    bg.rect(140, 39, 147, 40, "#f2f5ff")
    bg.hline(141, 147, 41, "#cdd6f2")
    # door with a brand-orange wreath bow
    dx0, dx1, dy0 = 128, 135, 72
    bg.rect(dx0 - 1, dy0 - 1, dx1 + 1, wall_bot, "#2a1820")
    bg.rect(dx0, dy0, dx1, wall_bot, "#5a3429")
    for x in range(dx0, dx1 + 1, 3):
        bg.vline(x, dy0, wall_bot, "#4a2a24")
    bg.set(dx1 - 1, 79, "#e0b35a")
    wreath = [(dx0 + 2, dy0 + 2), (dx0 + 3, dy0 + 1), (dx0 + 4, dy0 + 1), (dx0 + 5, dy0 + 2), (dx0 + 5, dy0 + 3),
              (dx0 + 4, dy0 + 4), (dx0 + 3, dy0 + 4), (dx0 + 2, dy0 + 3)]
    for p in wreath:
        bg.set(*p, "#2f7a45")
    bg.set(dx0 + 2, dy0 + 2, "#4fa65b")
    bg.set(dx0 + 3, dy0 + 5, BRAND)
    bg.set(dx0 + 4, dy0 + 5, BRAND)
    # windows: warm light, frame and cross
    for wx in (116, 141):
        bg.rect(wx - 1, 69, wx + 7, 76, "#2a1820")
        for y in range(70, 76):
            for x in range(wx, wx + 7):
                bg.px[y][x] = "#ffe9a8" if (x - wx) + (y - 70) < 4 else "#ffc861" if (x - wx) + (y - 70) < 8 else "#f29a3c"
        bg.vline(wx + 3, 70, 75, "#4a2a24")
        bg.hline(wx, wx + 6, 72, "#4a2a24")
        bg.hline(wx - 2, wx + 8, 77, "#e6ecff")  # snowy sill
        for x in range(wx - 2, wx + 9):  # warm spill on the logs around
            for y in (68, 77 + 1):
                if bg.get(x, y) in (logs[2], logs[3]):
                    bg.set(x, y, "#c98a55")
        # warm light on the snow in front
        for y in range(87, 95):
            spread = (y - 87) // 2 + 1
            for x in range(wx - spread, wx + 7 + spread):
                edge = min(x - (wx - spread), wx + 6 + spread - x)
                if bg.get(x, y) in snow and bayer(x, y) < .85 - (y - 87) * .1 - (.3 if edge < 2 else 0):
                    bg.set(x, y, "#d9c8a6")
    # snow banked along the wall bottom
    for x in range(cx0 - 3, cx1 + 4):
        top = wall_bot - 1 + int(abs(math.sin(x / 3)) * 2)
        for y in range(top, wall_bot + 3):
            bg.set(x, y, snow[0] if y == top else snow[1])
    # path of footprints to the door, and a brand-orange sled
    for i, (px, py) in enumerate(((128, 88), (126, 92), (129, 96), (126, 100), (128, 104))):
        bg.set(px, py, "#8b98cc")
        bg.set(px + 1, py, "#a6b2dc")
    man = [
        ".....kkk......",
        "....kkkkk.....",
        "....hhhhh.....",
        "...wwwwwss....",
        "..wwWwwwwss...",
        "..wweweess....",
        "..wwwwnnss....",
        "...OOOOOOoo...",
        "..wwOOoOws.o..",
        ".wwwwwoswwss.O",
        "twwwWwwwwwsss.",
        ".wwwwwkwwwsss.",
        ".wwwwwwwwwsss.",
        ".wwwwwkwwwsss.",
        "..wwwwwwwsss..",
        ".wwwwwwwwwsss.",
        "wwwWwwwwwwssss",
        "wwwwwwwwwwssss",
        "wwwwwwwwwssss.",
        ".swwwwwwsssss.",
        "..ssssssssss..",
    ]
    bg.stamp(man, {"k": "#1c1830", "h": "#3b3757", "w": "#e8eeff", "W": "#ffffff", "s": "#a9b5e0",
                   "e": "#1c1830", "n": "#f77622", "O": BRAND, "o": "#b8301a", "t": "#4a2a24"}, 44, 78)
    bg.line(44, 88, 40, 84, "#4a2a24")
    bg.line(57, 89, 61, 85, "#4a2a24")
    # fence posts at right
    for fx in (160, 168, 176, 184):
        y0 = gnd[fx] - 7
        bg.rect(fx, y0, fx + 1, gnd[fx] + 1, "#4a2a24")
        bg.set(fx, y0, "#e6ecff")
        bg.set(fx + 1, y0, "#e6ecff")
        bg.set(fx, y0 + 1, "#7a4a38")
    for x in range(160, 186):
        y = gnd[x] - 5
        if bg.get(x, y) not in ("#4a2a24", "#7a4a38"):
            bg.set(x, y, "#5a3429")
            bg.set(x, y - 1, "#cdd6f2")

    frames = []
    twinkle = random.Random(21)
    tw = [s for s in stars if s[2] > .7]
    for f in range(N):
        cv = bg.copy()
        for (x, y, _) in tw:
            ph = (int(x * 7 + y * 3) + f) % N
            if ph < 2:
                cv.set(x, y, "#ffffff")
                if ph == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        cv.set(x + dx, y + dy, "#5b67a8")
        # smoke: puffs ride a path upward; 8 frames move one puff spacing, so the loop is seamless
        for k in range(9):
            s = k * 5 + f * 5 / N  # distance along the path; N frames move one puff spacing, so it loops
            if s > 40:
                continue
            px = 144 - s * .45 + math.sin(s / 5) * 1.6
            py = 37 - s * .75
            r = 1.2 + s / 14
            col = "#9298c0" if s < 14 else "#6b739f" if s < 28 else "#465082"
            lit = "#b4b8d8" if s < 14 else "#8a90b8" if s < 28 else "#58629a"
            cv.ellipse(px, py, r + .5, r, col)
            cv.ellipse(px - .6, py - .6, r * .55, r * .5, lit)
        # snow, three depth layers; each layer's pattern repeats every N*speed rows, so it loops
        for layer, (speed, count, col, size) in enumerate(((2, 22, "#7f8bc4", 1), (3, 18, "#c3cced", 1),
                                                           (4, 10, "#f4f7ff", 2))):
            period = N * speed
            lr = random.Random(100 + layer)
            seeds = [(lr.randrange(W), lr.randrange(period)) for _ in range(count)]
            for sx, sy in seeds:
                for rep in range(-1, H // period + 2):
                    y = sy + rep * period + f * speed
                    x = sx + round(1.2 * math.sin(2 * math.pi * y / period + sx))
                    if size == 2:
                        cv.set(x, y, col)
                        cv.set(x + 1, y, "#c3cced")
                        cv.set(x, y + 1, "#c3cced")
                    else:
                        cv.set(x, y, col)
        frames.append(cv)
    send_frames(a, frames, 120)


# ---------------------------------------------------------------- 2. Sunset Beach

def bezier(p0, p1, p2, t):
    return ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])


def palm(cv, base, ctrl, crown, dark, rim, ring, frond, frond_lit, sway=0.0, thick=(4, 2), coco="#3a1a2a"):
    """A palm: a curved, ringed trunk and drooping feathery fronds. `sway` bends the frond tips (animation)."""
    steps = 80
    for i in range(steps + 1):
        t = i / steps
        x, y = bezier(base, ctrl, crown, t)
        w = thick[0] + (thick[1] - thick[0]) * t
        for dx in range(int(-w / 2), int(w / 2) + 1):
            cv.set(x + dx, y, dark)
        cv.set(x + int(-w / 2), y, rim)
        if int(t * 60) % 4 == 0:
            for dx in range(int(-w / 2) + 1, int(w / 2) + 1):
                cv.set(x + dx, y, ring)
    cx, cy = crown
    for k, (ang, length, droop) in enumerate(((200, 22, 10), (160, 20, 12), (235, 16, 6), (305, 15, 6), (340, 20, 12),
                                              (20, 22, 11), (270, 9, 2), (120, 15, 9))):
        a = math.radians(ang)
        dx, dy = math.cos(a), -math.sin(a)
        prev = None
        for i in range(length + 1):
            t = i / length
            x = cx + dx * length * t
            y = cy + dy * length * t * .6 + droop * t * t + sway * t * t * (1 if dx > 0 else -1) * .5
            cv.set(x, y, frond)
            if i > 2:  # leaflets hang from the rib
                ln = int(1 + 3 * math.sin(t * math.pi))
                for j in range(1, ln + 1):
                    cv.set(x - dx * j * .5, y + j, frond)
                cv.set(x, y - 1, frond_lit if dy < .3 else frond)
            prev = (x, y)
    for (ox, oy) in ((-1, 2), (1, 2), (0, 3)):
        cv.set(cx + ox, cy + oy, coco)


def scene_beach(a):
    W, H, N = 192, 108, 8
    hz = 60
    sky = ["#291a49", "#46225f", "#73296b", "#a83a6a", "#da5a5c", "#f2864f", "#f9b45e"]
    sea = ["#a14f7c", "#7a3d74", "#58316b", "#3d2a62", "#2b2557"]
    sand = ["#f2b47c", "#d68d63", "#ab6650", "#753f47"]
    bg = Canvas(W, H)
    for y in range(hz):
        for x in range(W):
            bg.px[y][x] = ramp_pick(sky, (y / hz) ** .85, x, y, soft=.35)
    # sun, sitting on the horizon, with retro slits across its lower half
    sx, sy, sr = 64, hz, 18
    bg.ellipse(sx, sy, sr + 5, sr + 5, "#fbc66a", only=lambda x, y: y < hz and bayer(x, y) < .45)
    for y in range(sy - sr, hz):
        for x in range(sx - sr - 1, sx + sr + 2):
            if (x - sx) ** 2 + (y - sy) ** 2 <= (sr + .5) ** 2:
                k = (y - (sy - sr)) / sr
                bg.set(x, y, "#fff2b8" if k < .25 else "#ffd877" if k < .55 else "#ffab4c" if k < .8 else BRAND)
    for y, th in ((48, 1), (52, 1), (55, 2), (58, 2)):
        for x in range(sx - sr - 1, sx + sr + 2):
            for yy in range(y, y + th):
                if (x - sx) ** 2 + (yy - sy) ** 2 <= (sr + .5) ** 2:
                    bg.set(x, yy, ramp_pick(sky, (yy / hz) ** .85, x, yy, soft=.35))
    # long clouds, lit from below by the sun
    for (cx, cy, w, hgt) in ((140, 20, 34, 2), (162, 27, 22, 1.5), (26, 33, 26, 2), (112, 40, 20, 1.5), (176, 43, 14, 1)):
        bg.ellipse(cx, cy, w, hgt, "#5d2a60")
        bg.ellipse(cx - 2, cy + 1, w - 3, max(.6, hgt - 1), "#f08a5c", only=lambda x, y, cy=cy: y > cy)
        bg.ellipse(cx + 3, cy - 1, w * .5, .6, "#7c3570")
    # sea base with depth ramp
    for y in range(hz, H):
        for x in range(W):
            bg.px[y][x] = ramp_pick(sea, (y - hz) / 24, x, y, soft=.4)
    bg.hline(0, W - 1, hz, "#d86a74")
    # far sailboat with a brand-orange sail
    bg.stamp(["..O...", "..OO..", "..OOo.", "..OOoo", "dddddd", ".dddd."], {"O": BRAND, "o": "#ffb07a", "d": "#2b1a3a"},
             150, hz - 5)
    # beach: wet band + dry sand with ripples
    shore = [83 + int(1.5 * math.sin(x / 17)) for x in range(W)]
    for x in range(W):
        for y in range(shore[x], H):
            d = y - shore[x]
            t = .1 + d / 30 + .25 * max(0, (x - 120) / 70)
            bg.px[y][x] = ramp_pick(sand, t, x, y, soft=.3)
    for k in range(4):
        y0 = 91 + k * 4
        for x in range(4 + k * 9 % 30, W - 10, 1):
            yy = y0 + int(1.2 * math.sin(x / 9 + k))
            if bg.get(x, yy) in sand[1:] and (x // 13 + k) % 3 == 0:
                bg.set(x, yy, sand[min(3, sand.index(bg.get(x, yy)) + 1)])
    # umbrella + towel, the brand touch on the beach
    ux, uy = 118, 91
    bg.ellipse(ux + 6, 104, 12, 2, sand[2])
    bg.line(ux + 1, uy, ux + 3, 105, "#4a2a32")
    for y in range(uy - 6, uy + 1):
        for x in range(ux - 13, ux + 14):
            if ((x - ux) / 13.5) ** 2 + ((y - uy) / 6.5) ** 2 <= 1:
                stripe = int((math.atan2(y - uy - 3, x - ux) + math.pi) / math.pi * 7) % 2
                lit = x < ux - 4
                bg.set(x, y, (BRAND if lit else "#d2381a") if stripe else ("#fff0dc" if lit else "#e8c9b0"))
    for x in range(ux - 13, ux + 14, 3):
        bg.set(x + 1, uy + 1, "#d2381a")
    bg.rect(ux - 26, 99, ux - 12, 104, "#2a8f9a")
    bg.hline(ux - 26, ux - 12, 100, "#e8f4ee")
    bg.hline(ux - 26, ux - 12, 103, "#1d6a78")
    bg.hline(ux - 26, ux - 12, 105, sand[3])
    # left palm (cropped) and the hero palm at right
    pal = dict(dark="#2a1530", rim="#c25a4a", ring="#1d0e24", frond="#26122c", frond_lit="#6a2b4a")

    frames = []
    for f in range(N):
        cv = bg.copy()
        ph = 2 * math.pi * f / N
        # moving swells: each row's dash pattern scrolls one full period over the loop
        for y in range(hz + 2, 82, 3):
            depth = (y - hz) / 22
            v = 1 + int(depth * 3)
            period = N * v
            for x in range(W):
                u = (x + f * v + y * 7) % period
                if u < 2 + int(depth * 4):
                    cv.set(x, y, "#c46888" if depth < .5 else "#7a4d8e")
        # the sun's reflection: shimmering gold dashes under the sun
        for y in range(hz + 1, 82):
            half = 15 - (y - hz) * .3
            r = random.Random(y * 31 + f)
            x = sx - half + r.random() * 4
            while x < sx + half:
                ln = r.randint(2, 6)
                col = "#ffd877" if y < hz + 8 else "#ffab4c" if y < hz + 15 else "#e8673e"
                if r.random() < .7:
                    cv.hline(int(x), int(x + ln), y, col)
                x += ln + r.randint(2, 5)
        # glints that blink
        for gx, gy, g0 in ((40, 66, 0), (92, 64, 3), (120, 72, 5), (24, 76, 2), (78, 79, 6), (140, 70, 1)):
            if (f - g0) % N < 2:
                cv.set(gx, gy, "#fff2b8")
                if (f - g0) % N == 0:
                    for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        cv.set(gx + d[0], gy + d[1], "#ffab4c")
        # the shore wash: foam runs up and back
        reach = 2.5 * math.sin(ph)
        for x in range(W):
            fy = shore[x] + int(round(reach + .8 * math.sin(x / 7 + ph)))
            for y in range(shore[x] - 1, fy + 1):
                cv.set(x, y, "#3d2a62" if y < fy - 1 else "#9a6a9a")
            cv.set(x, fy, "#f6d6d8")
            cv.set(x, fy - 1, "#e8a8b8" if (x + f) % 5 else "#f6d6d8")
            for y in range(fy + 1, fy + 3):  # wet sand gleam behind the foam
                if cv.get(x, y) in sand:
                    cv.set(x, y, "#b06058")
        sway = 1.2 * math.sin(ph)
        palm(cv, (176, 107), (184, 72), (156, 42), sway=sway, **pal)
        palm(cv, (6, 107), (2, 80), (14, 58), sway=-sway * .7, thick=(3, 2), **pal)
        # gulls flapping
        for i, (bx, by) in enumerate(((100, 24), (108, 19), (94, 17))):
            up = (f + i * 3) % 4 < 2
            shape = ["x...x", ".x.x.", "..x.."] if up else [".....", "xx.xx", "..x.."]
            cv.stamp(shape, {"x": "#2b1a3a"}, bx, by)
        frames.append(cv)
    send_frames(a, frames, 130)


# ---------------------------------------------------------------- 3. Torchlit Dungeon

def scene_dungeon(a):
    W, H, N = 160, 90, 6
    floor_y = 66
    brick = ["#100c1a", "#1d172b", "#2c2540", "#43374c", "#634a4e", "#8d6655", "#b8875e"]
    stone = ["#0e0b16", "#1a1626", "#292337", "#3d3546", "#5a4a4e", "#816452", "#a88160"]
    torches = [(50, 40), (110, 40)]
    flick = [[1.0, .9, 1.06, .95, 1.03, .88], [.95, 1.05, .9, 1.02, .93, 1.06]]

    def light(x, y, f):
        L = .06
        for i, (tx, ty) in enumerate(torches):
            d2 = (x - tx) ** 2 + ((y - ty) * 1.15) ** 2
            L += .95 * flick[i][f] / (1 + d2 / (27 * flick[i][f]) ** 2)
        return min(L, 1)

    def lvl(ramp, L, x, y, bias=0, soft=.02):
        t = min(max(L + bias, 0), 1)
        return ramp_pick(ramp, t, x, y, soft=soft)

    r = random.Random(4)
    bricks = {}
    for row in range(0, floor_y // 6 + 1):
        off = 7 if row % 2 else 0
        for col in range(-1, W // 14 + 2):
            bricks[(row, col)] = (r.choice((0, 0, 0, -.06, -.12, .04)), r.random() < .12)
    arch_c, arch_r = (80, 40), 15

    def in_arch(x, y, rr):
        return (abs(x - arch_c[0]) <= rr and y >= arch_c[1]) or (x - arch_c[0]) ** 2 + (y - arch_c[1]) ** 2 <= rr * rr

    frames = []
    for f in range(N):
        cv = Canvas(W, H)
        # back wall bricks
        for y in range(floor_y):
            for x in range(W):
                row = y // 6
                off = 7 if row % 2 else 0
                col = (x + off) // 14
                bx, by = (x + off) % 14, y % 6
                jit, mossy = bricks[(row, col)]
                L = light(col * 14 - off + 7, row * 6 + 3, f) + jit  # one light level per brick: clean steps
                if by == 5 or bx == 13:
                    c = lvl(brick, L, x, y, -.22)
                elif by == 0 or bx == 0:
                    c = lvl(brick, L, x, y, .12)
                elif by == 4 or bx == 12:
                    c = lvl(brick, L, x, y, -.08)
                else:
                    c = lvl(brick, L, x, y)
                if mossy and by == 4 and 2 < bx < 9 and y > 44:
                    c = "#2f4a36" if L < .4 else "#4d6b45"
                cv.px[y][x] = c
        # arch: dark passage with steps going down, ringed by big stones
        for y in range(arch_c[1] - arch_r - 5, floor_y):
            for x in range(arch_c[0] - arch_r - 5, arch_c[0] + arch_r + 6):
                if in_arch(x, y, arch_r):
                    depth = (y - (arch_c[1] - arch_r)) / (floor_y - arch_c[1] + arch_r)
                    c = "#08060e"
                    sy = y - 50
                    if sy >= 0 and sy % 4 == 0 and abs(x - arch_c[0]) < arch_r - 1 - (3 - sy // 4):
                        c = "#1f1a2c" if sy % 8 == 0 else "#171320"
                    elif sy > 0 and sy % 4 in (1, 2) and abs(x - arch_c[0]) < arch_r - 2:
                        c = "#100c18"
                    cv.px[y][x] = c
                elif in_arch(x, y, arch_r + 4):
                    ang = math.atan2(y - arch_c[1], x - arch_c[0])
                    seg = int((ang + math.pi) / (math.pi / 7)) if y < arch_c[1] else (y - arch_c[1]) // 6 + 100
                    edge = y < arch_c[1] and abs(((ang + math.pi) / (math.pi / 7)) % 1 - .0) < .1
                    seam = (y >= arch_c[1] and (y - arch_c[1]) % 6 == 5)
                    L = light(x, y, f) + .08
                    c = lvl(stone, L, x, y, -.25 if (edge or seam) else 0)
                    inner = in_arch(x, y, arch_r + 1)
                    if inner:
                        c = lvl(stone, L, x, y, -.3)
                    cv.px[y][x] = c
        # floor flagstones in perspective
        vx, vy = 80, 26
        lines = [floor_y, 69, 73, 78, 84, 91]
        for y in range(floor_y, H):
            band = max(i for i, ly in enumerate(lines) if ly <= y)
            for x in range(W):
                u = (x - vx) / (y - vy) * 22
                seam_v = abs(u - round(u / 9 + (band % 2) * .5 - (band % 2) * .5) * 9) < 22 / (y - vy) * .9
                seam_h = y in lines
                L = light(x, y - 14, f) * 1.05
                c = lvl(stone, L, x, y, -.2 if (seam_v or seam_h) else (.08 if y - 1 in lines else 0), soft=.3)
                cv.px[y][x] = c
        # a puddle reflecting the warm light
        cv.ellipse(86, 80, 13, 2, "#2c2538")
        cv.hline(77, 93, 81, "#3d3546")
        cv.hline(78, 90, 79, "#1d1828")
        for i, (tx, _) in enumerate(torches):  # the torches' wobbling reflections
            rx = 80 + (tx - 80) // 6
            w = 1 + (f + i) % 2
            cv.hline(rx - w, rx + w, 80, "#ff9a3c")
            cv.set(rx + (f % 3) - 1, 81, BRAND)
        # chains hanging from the ceiling
        for cx0, ln in ((24, 18), (136, 24)):
            for i in range(ln):
                cc = lvl(["#1a1626", "#3a3448", "#6a6278", "#9a92a8"], light(cx0, i, f) * 1.2, cx0, i)
                if i % 3 == 1:
                    cv.set(cx0 - 1, i, cc)
                    cv.set(cx0 + 1, i, cc)
                else:
                    cv.set(cx0, i, cc)
            cv.stamp([".x.x.", "x...x", ".x.x."], {"x": "#6a6278"}, cx0 - 2, ln)
        # cobwebs in the top corners
        web = "#6a6078"
        for sx0, dx in ((0, 1), (W - 1, -1)):
            for (ex, ey) in ((10, 0), (8, 5), (4, 8), (0, 10)):
                cv.line(sx0, 0, sx0 + dx * ex, ey, web)
            for rr in (4, 8):
                for t in range(0, 91, 6):
                    a_ = math.radians(t)
                    cv.set(sx0 + dx * round(rr * math.cos(a_)), round(rr * math.sin(a_) * .9), web)
        # skull and bones by the wall
        skull = ["..bbbb..", ".bwwwwb.", "bwwwwwwb", "bwkwwkwb", "bwkwwkwb", ".bwwwwb.", "..wkwk..", "..bbbb.."]
        cv.stamp(skull, {"b": "#5a5060", "w": "#d8cdb8", "k": "#1a1426"}, 128, 62)
        cv.line(118, 69, 126, 67, "#bfb39e")
        cv.set(117, 69, "#d8cdb8")
        cv.set(127, 67, "#d8cdb8")
        # torches: bracket, handle and a living flame
        shapes = [
            ["....o....", "...oo....", "...ooo...", "..oOOo...", "..oOYOo..", ".ooOYYOo.", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
            [".....o...", "....oo...", "...ooo...", "...oOOo..", "..oOYOo..", "..oOYYOo.", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
            ["...o.....", "...oo....", "..oOo....", "..oOOo...", ".ooOYOo..", ".oOYYOo..", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
            ["....o....", "....o....", "...ooo...", "...oOo...", "..oOYOo..", "..oOYYOo.", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
            [".....o...", "....oo...", "...oOo...", "..ooOOo..", "..oOYOo..", ".ooOYYOo.", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
            ["...o.....", "...oo....", "...ooo...", "..oOOo...", "..oOYOoo.", ".oOYYYOo.", ".oOYWYOo.", "..oOYOo..", "...ooo..."],
        ]
        for i, (tx, ty) in enumerate(torches):
            cv.ellipse(tx, ty - 3, 9, 9, "#c47a4e", only=lambda x, y: bayer(x, y) < .22 and cv.get(x, y) in brick[3:])
            cv.rect(tx - 3, ty + 6, tx + 3, ty + 6, "#3a3448")
            cv.set(tx - 3, ty + 5, "#3a3448")
            cv.set(tx + 3, ty + 5, "#3a3448")
            cv.rect(tx - 1, ty + 7, tx + 1, ty + 8, "#3a3448")
            cv.rect(tx - 1, ty + 1, tx + 1, ty + 5, "#6a4230")
            cv.vline(tx - 1, ty + 1, ty + 5, "#9a6440")
            cv.rect(tx - 2, ty, tx + 2, ty + 1, "#2a2030")
            cv.stamp(shapes[(f + i * 3) % N], {"o": BRAND, "O": "#ff9a3c", "Y": "#ffd27a", "W": "#fff4c8"},
                     tx - 4, ty - 9)
            # embers rise one spacing over the loop
            for k in range(3):
                d = k * 6 + f
                ex = tx + round(math.sin(d / 3 + i) * 2)
                ey = ty - 11 - d
                if d < 15:
                    cv.set(ex, ey, "#ffd27a" if d < 7 else "#ff9a3c")
        frames.append(cv)
    send_frames(a, frames, [140, 110, 150, 120, 130, 110])


# ---------------------------------------------------------------- 4. Neon Rooftop

FONT = {  # 4×5 pixel letters
    "O": [".##.", "#..#", "#..#", "#..#", ".##."], "P": ["###.", "#..#", "###.", "#...", "#..."],
    "E": ["####", "#...", "###.", "#...", "####"], "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
}


def scene_neon(a):
    W, H, N = 192, 108, 8
    sky = ["#0c0922", "#171037", "#25144c", "#3c1a5e", "#5e2170", "#86307a"]
    bg = Canvas(W, H)
    for y in range(H):
        for x in range(W):
            bg.px[y][x] = ramp_pick(sky, (y / 78) ** 1.3, x, y, soft=.35)
    r = random.Random(8)
    for _ in range(28):
        bg.set(r.randrange(W), r.randrange(30), "#8a7ab8" if r.random() < .7 else "#d8d0f0")
    # crescent moon
    bg.ellipse(150, 16, 7, 7, "#efe2f4", only=lambda x, y: (x - 153.5) ** 2 + (y - 13.5) ** 2 > 40)
    bg.ellipse(150, 16, 7, 7, "#b8a8d8", only=lambda x, y: (x - 153.5) ** 2 + (y - 13.5) ** 2 > 40
               and (x - 152.5) ** 2 + (y - 14.5) ** 2 <= 52)
    # far skyline: hazy, light, few windows
    x = -3
    while x < W:
        w, top = r.randint(7, 15), r.randint(42, 62)
        for yy in range(top, H):
            for xx in range(x, x + w):
                bg.set(xx, yy, "#3b2a6c")
        if r.random() < .35:
            bg.vline(x + w // 2, top - r.randint(3, 8), top, "#3b2a6c")
        for yy in range(top + 3, 84, 4):
            for xx in range(x + 2, x + w - 1, 3):
                if r.random() < .25:
                    bg.set(xx, yy, "#6c4f9c")
        x += w + r.randint(0, 2)
    # haze band between layers
    for y in range(60, 78):
        for x in range(W):
            if bayer(x, y) < (y - 60) / 40 and bg.get(x, y) == "#3b2a6c":
                bg.set(x, y, "#5a3a80")
    # mid skyline: darker, taller, with window grids (blinking set later)
    mids, wins = [], []
    x = 2
    while x < 150:
        w, top = r.randint(12, 22), r.randint(24, 50)
        mids.append((x, w, top))
        for yy in range(top, H):
            for xx in range(x, x + w):
                bg.set(xx, yy, "#1f1645")
        bg.vline(x, top, H - 1, "#2c2058")  # lit left edge
        bg.hline(x, x + w - 1, top, "#2c2058")
        if r.random() < .5:  # rooftop step
            bg.rect(x + 2, top - 3, x + w - 4, top - 1, "#1f1645")
            bg.hline(x + 2, x + w - 4, top - 3, "#2c2058")
        for yy in range(top + 3, 88, 3):
            for xx in range(x + 2, x + w - 2, 3):
                if r.random() < .55:
                    wins.append((xx, yy, r.choice(("#ffcf6e", "#ffcf6e", "#5ce6f0", "#ff6ab4")), r.random()))
        x += w + r.randint(1, 4)
    sky_bg, bg = bg, Canvas(W, H)  # everything below goes on the foreground layer, over the blinking windows
    bg.rect(156, 22, W - 1, H - 1, "#140d2c")
    bg.vline(156, 22, H - 1, "#3a2766")
    bg.hline(156, W - 1, 22, "#3a2766")
    for yy in range(28, 86, 6):
        for xx in range(162, W - 2, 7):
            bg.rect(xx, yy, xx + 3, yy + 3, "#221846")
            bg.hline(xx, xx + 3, yy, "#2c2058")
    # rooftop: parapet and tar floor
    for x in range(W):
        bg.px[88][x] = "#6a4a8a"
        for y in range(89, 93):
            bg.px[y][x] = "#3a2a58" if y < 91 else "#2a1e46"
        for y in range(93, H):
            bg.px[y][x] = ramp_pick(["#1c1434", "#140e28", "#0e0a1e"], (y - 93) / 15, x, y, soft=.4)
    for x in range(0, W, 12):  # parapet seams
        bg.vline(x, 89, 92, "#2a1e46")
    # water tower, rim-lit by the city
    tx = 18
    for lx in (tx + 2, tx + 9, tx + 16):
        bg.vline(lx, 66, 88, "#120c24")
    bg.line(tx + 2, 70, tx + 16, 84, "#120c24")
    bg.line(tx + 16, 70, tx + 2, 84, "#120c24")
    bg.rect(tx - 1, 44, tx + 19, 66, "#30192e")
    for xx in range(tx - 1, tx + 20, 3):
        bg.vline(xx, 45, 66, "#221222")
    for yy in (48, 57, 64):
        bg.hline(tx - 1, tx + 19, yy, "#4a2a44")
    bg.vline(tx - 1, 44, 66, "#4a2a44")
    bg.vline(tx + 19, 44, 66, "#c23a8a")
    bg.vline(tx + 18, 44, 66, "#6a2a6a")
    bg.poly([(tx - 3, 45), (tx + 9, 35), (tx + 22, 45)], "#221222")
    bg.line(tx + 9, 35, tx + 22, 45, "#c23a8a")
    # antenna mast
    bg.vline(132, 56, 88, "#2a1e46")
    for yy in (62, 70, 78):
        bg.hline(130, 134, yy, "#2a1e46")

    fg = bg
    # a puddle on the roof
    fg.ellipse(124, 100, 18, 2.5, "#22183e")
    frames = []
    for f in range(N):
        cv = sky_bg.copy()
        for (xx, yy, col, ph) in wins:
            on = ph > .12 or (int(ph * 100) + f) % 4 < 2
            if ph < .04:
                on = (f + int(ph * 400)) % N < 4
            if on:
                cv.set(xx, yy, col)
                cv.set(xx, yy + 1, {"#ffcf6e": "#c98a4a", "#5ce6f0": "#2a9ab0", "#ff6ab4": "#b03a80"}[col])
        for y in range(H):
            for x in range(W):
                if fg.px[y][x]:
                    cv.px[y][x] = fg.px[y][x]
        # blinking aircraft lights on the tall roofs and the mast
        for i, (x0, w, top) in enumerate(mids[:6]):
            if (f + i) % 4 == 0:
                cv.set(x0 + w // 2, top - 4 if cv.get(x0 + w // 2, top - 4) != "#1f1645" else top - 1, "#ff3a4a")
        if f % 2 == 0:
            cv.set(132, 55, "#ff3a4a")
            cv.set(131, 55, "#8a1a3a")
            cv.set(133, 55, "#8a1a3a")
        # marquee sign: a chase of bulbs around a cyan frame
        sx0, sy0, sx1, sy1 = 164, 32, 176, 74
        cv.rect(sx0, sy0, sx1, sy1, "#0e0820")
        per = []
        for x in range(sx0, sx1 + 1):
            per.append((x, sy0))
        for y in range(sy0 + 1, sy1 + 1):
            per.append((sx1, y))
        for x in range(sx1 - 1, sx0 - 1, -1):
            per.append((x, sy1))
        for y in range(sy1 - 1, sy0, -1):
            per.append((sx0, y))
        for i, (px_, py_) in enumerate(per):
            cv.set(px_, py_, "#5ce6f0" if (i + f) % 4 == 0 else "#1e5a78")
        for k, yy in enumerate(range(sy0 + 4, sy1 - 3, 7)):  # glowing bars inside, lighting up in turn
            col = "#ff6ab4" if (k + f // 2) % 3 else "#ffd0ea"
            cv.rect(sx0 + 3, yy, sx1 - 3, yy + 3, "#3a1040")
            cv.rect(sx0 + 4, yy + 1, sx1 - 4, yy + 2, col)
        # the OPEN sign in brand orange, hanging off the near building
        ox, oy, bw = 108, 38, 45
        cv.hline(ox + bw, 156, oy + 3, "#3a2766")
        cv.hline(ox + bw, 156, oy + 11, "#3a2766")
        cv.rect(ox, oy, ox + bw, oy + 14, "#1a0a14")
        lit = f != 5
        glow = "#7a2410" if lit else "#3a1410"
        for (x0, y0, x1, y1) in ((ox, oy, ox + bw, oy), (ox, oy + 14, ox + bw, oy + 14), (ox, oy, ox, oy + 14),
                                 (ox + bw, oy, ox + bw, oy + 14)):
            cv.rect(x0, y0, x1, y1, glow)
        for i, ch in enumerate("OPEN"):
            on = lit and not (ch == "N" and f in (2, 3))
            for j, row in enumerate(FONT[ch]):
                for k, c in enumerate(row):
                    if c == "#":
                        x0, y0 = ox + 4 + i * 10 + k * 2, oy + 3 + j * 2
                        cv.rect(x0, y0, x0 + 1, y0 + 1, BRAND if on else "#5a2014")
                        if on:
                            cv.set(x0, y0, "#ffb08a")
        if lit:  # orange spill on the parapet and its reflection in the puddle
            for x in range(ox - 4, ox + bw + 5):
                if bayer(x, 88) < .7:
                    cv.set(x, 88, "#d86a5a")
            for x in range(ox + 6, ox + bw - 6):
                if (x + f) % 3:
                    cv.set(x + 4, 100, BRAND if (x // 4) % 2 else "#7a2410")
        # cat on the ledge, tail swishing, eyes blinking
        cx_ = 74
        cat = [".k...k..", ".kk.kk..", ".kkkkk..", ".kEkEk..", ".kkkkk..", "..kkkk..", ".kkkkkk.",
               "kkkkkkkk", "kkkkkkkk", "kkkkkkkk", ".kk..kk."]
        eye = "#ffd27a" if f != 6 else "#0c0818"
        cv.stamp(cat, {"k": "#0c0818", "E": eye}, cx_, 77)
        tail_x = [1, 2, 2, 1, 0, -1, -1, 0][f]
        for i in range(6):
            cv.set(cx_ + 8 + (tail_x if i > 2 else 0) * (i - 2) // 2, 85 + i, "#0c0818")
        for (rx, ry) in ((cx_ + 1, 77), (cx_ + 6, 80), (cx_ + 7, 83), (cx_ + 7, 85), (cx_ + 7, 86)):
            cv.set(rx, ry, "#8a2a7a")  # rim light from the city
        # AC unit with a turning fan
        ax, ay = 98, 79
        cv.rect(ax, ay, ax + 16, ay + 9, "#3a2a58")
        cv.hline(ax, ax + 16, ay, "#6a4a8a")
        cv.rect(ax + 2, ay + 2, ax + 8, ay + 8, "#160f2c")
        blades = [((0, -2), (0, 2), (-2, 0), (2, 0)), ((-1, -1), (1, 1), (-1, 1), (1, -1))][f % 2]
        for bx_, by_ in blades:
            cv.line(ax + 5, ay + 5, ax + 5 + bx_, ay + 5 + by_, "#8a7ab8")
        for yy in range(ay + 2, ay + 9, 2):
            cv.hline(ax + 10, ax + 14, yy, "#2a1e46")
        frames.append(cv)
    send_frames(a, frames, 150)


# ---------------------------------------------------------------- 5. Mountain Lake

def mix(c1, c2, t):
    a, b = rgb(c1), rgb(c2)
    return "#%02x%02x%02x" % tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def mountains(cv, peaks, seed, rock_lit, rock_shade, snow_lit, snow_shade, snow_depth, base_y, gully=None):
    """Draws a ridge of peaks [(x, top_y, slope)], lit from the left: each peak's shadow side starts at a spine that
    runs down and to the right. Jagged snow caps, and short gullies on the lit faces."""
    W = cv.w
    nz = noise1(seed, W, 9, 2)
    nz2 = noise1(seed + 1, W, 4, 1)
    tops = [cv.h] * W
    owner = [None] * W
    for x in range(W):
        for (px, py, sl) in peaks:
            y = py + abs(x - px) * sl * (1 + .25 * nz[x]) + 2 * nz2[x]
            if y < tops[x]:
                tops[x], owner[x] = y, (px, py, sl)
    for x in range(W):
        if owner[x] is None or tops[x] > base_y:
            continue
        px, py, sl = owner[x]
        top = int(tops[x])
        for y in range(top, base_y + 1):
            spine = px + (y - py) * .45 + 1.5 * nz2[(y * 5) % W]
            lit = x < spine
            sline = py + snow_depth + 4 * nz[(x * 3) % W] + 3 * nz2[x] - (y - py) * 0
            snow = y < sline and (y - top) < snow_depth + 4
            if snow:
                c = snow_lit if lit else snow_shade
            else:
                c = rock_lit if lit else rock_shade
            cv.set(x, y, c)
    if gully:
        r = random.Random(seed)
        for (px, py, sl) in peaks:
            for k in range(5):
                gx = px - r.randint(4, 22)
                gy = py + abs(gx - px) * sl + r.randint(3, 6)
                ln = r.randint(5, 13)
                for t in range(ln):
                    x, y = int(gx + t * .45), int(gy + t)
                    c = cv.get(x, y)
                    if c in (rock_lit,):
                        cv.set(x, y, gully)
                    elif c == snow_lit:
                        cv.set(x, y, snow_shade)
            for k in range(3):  # lighter ribs on the shadow side
                gx = px + r.randint(4, 18)
                gy = py + abs(gx - px) * sl + r.randint(2, 5)
                for t in range(r.randint(4, 9)):
                    x, y = int(gx - t * .3), int(gy + t)
                    if cv.get(x, y) == rock_shade:
                        cv.set(x, y, rock_lit)


def scene_lake(a):
    W, H = 256, 144
    wl = 96  # water line
    sky = ["#2b3a6c", "#3f5088", "#6670a6", "#a08bb0", "#dc9ea8", "#f4c29c", "#f9dcb0"]
    cv = Canvas(W, H)
    for y in range(wl):
        for x in range(W):
            cv.px[y][x] = ramp_pick(sky, (y / 84) ** 1.15 + .02 * math.sin(x / 13 + y / 3), x, y, soft=.3)
    # dawn glow behind the saddle between the peaks
    cv.ellipse(150, 70, 30, 16, "#fbe8c0", only=lambda x, y: bayer(x, y) < .55 - ((x - 150) ** 2 / 900 + (y - 70) ** 2 / 256) * .55)
    cv.ellipse(150, 72, 9, 5, "#fff4d8")
    # clouds lit from below
    for (cx, cy, w, hh) in ((40, 22, 26, 3), (66, 18, 14, 2), (204, 30, 30, 3), (180, 24, 12, 2), (120, 40, 18, 2)):
        cv.ellipse(cx, cy, w, hh, "#8a82b2")
        cv.ellipse(cx + 2, cy + 1, w - 4, hh - 1, "#f2b2ae", only=lambda x, y, cy=cy: y >= cy)
        cv.ellipse(cx - 4, cy - 1, w * .4, .7, "#a89cc4")
    # far range, hazy
    mountains(cv, [(30, 52, .55), (110, 48, .6), (190, 50, .5), (250, 46, .6)], 31,
              "#a6a0c8", "#8a88b8", "#f0e2ec", "#c8c4e2", 5, wl)
    # main range: two big peaks with the dawn on their left faces
    mountains(cv, [(72, 20, .95), (182, 28, .85), (128, 50, .9), (238, 44, .8)], 32,
              "#7a72a6", "#4f5288", "#ffe8e2", "#b6bce4", 14, wl, gully="#3e4276")
    # forested foothills
    hills = noise1(33, W, 40)
    hy = [int(84 - hills[x] * 6) for x in range(W)]
    for x in range(W):
        for y in range(hy[x], wl):
            cv.px[y][x] = "#2e4060" if y > hy[x] else "#3e5474"
    r = random.Random(6)
    for layer, (ybase, dark, lit) in enumerate(((None, "#24364c", "#34506a"), (wl + 1, "#17283a", "#2a4a52"))):
        x = r.randint(0, 3)
        while x < W:
            base = (hy[min(W - 1, x)] + 3) if ybase is None else ybase
            ht = r.randint(5, 9) if ybase is None else r.randint(9, 17)
            if ybase is None or not (96 < x < 140):
                pine(cv, x, base, ht, dark, lit, None, r)
            x += r.randint(3, 6) if ybase is None else r.randint(4, 8)
    # mist over the water line
    for x in range(W):  # a thin mist on the water line
        if math.sin(x / 9) + math.sin(x / 23) > -.4:
            cv.set(x, wl - 1, "#8e96c0")
    # reflection: the scene above, mirrored, cooler and darker, broken by ripples
    deep = "#22305a"
    ref = {}
    for y in range(wl, H):
        src = 2 * wl - y - 1
        rr = random.Random(y)
        shift = rr.choice((0, 0, 0, 1, -1)) if y > wl + 2 else 0
        k = min(1, .38 + (y - wl) / 90)
        for x in range(W):
            c = cv.get(min(W - 1, max(0, x + shift)), src) or deep
            if c not in ref:
                ref[c] = {}
            key = round(k * 4) / 4
            if key not in ref[c]:
                ref[c][key] = mix(c, deep, key)
            cv.px[y][x] = ref[c][key]
    r = random.Random(12)
    for _ in range(60):  # light ripple lines
        y = r.randint(wl + 2, H - 22)
        x = r.randint(0, W - 10)
        ln = r.randint(3, 12) - (y - wl) // 12
        cv.hline(x, x + max(2, ln), y, "#8a96c8" if y < wl + 20 else "#5d6ca0")
    cv.hline(0, W - 1, wl, "#a9a8d0")
    # foreground shore at the bottom left: rocks and grass
    shore = [int(128 + 9 * math.exp(-(x / 70) ** 2) * -1 + (x / 10) * .0 + 4 * math.sin(x / 13)) for x in range(W)]
    for x in range(0, 110):
        top = int(126 + (x / 110) ** 2 * 22 + 2 * math.sin(x / 7))
        for y in range(top, H):
            t = (y - top) / 14
            cv.set(x, y, "#3a5a3a" if y == top else ramp_pick(["#2e4a34", "#203626", "#16261c"], t, x, y))
        if x % 3 == 0 and top < H:
            cv.vline(x, top - 2, top, "#4f7a46" if x % 2 else "#3a5a3a")
    for (rx, ry, rw, rh) in ((22, 128, 9, 5), (40, 133, 6, 4), (8, 136, 7, 4), (64, 138, 8, 4)):
        cv.ellipse(rx, ry, rw, rh, "#4a4c5e")
        cv.ellipse(rx - 2, ry - 1, rw - 3, rh - 2, "#727488")
        cv.hline(rx - rw + 2, rx + rw - 2, ry + rh, "#2a2c3a")
    # a pier from the right and a brand-orange canoe moored in front of it: the focal point
    dy = 116
    for x in range(178, W):
        cv.set(x, dy, "#c49468")
        for y in range(dy + 1, dy + 3):
            cv.set(x, y, "#8a6448" if (x - 178) % 5 else "#6a4a36")
        cv.set(x, dy + 3, "#4a3226")
    for x in range(180, W, 10):  # posts, and their reflections
        cv.rect(x, dy + 4, x + 1, dy + 11, "#3a2820")
        cv.set(x, dy + 4, "#5e4232")
        for y in range(dy + 12, dy + 18, 2):
            cv.hline(x, x + 1, y, "#2a3050")
    cv.rect(178, dy - 5, 179, dy, "#6a4a36")
    canoe = [
        "...........oooooooooooooooooo.........",
        ".OO...ooOOOOOOOOOOOOOOOOOOOOOOOOoo...OO",
        "..OOOOOOOOyOOOOOOOOOOOOOOOOOyOOOOOOOOO.",
        "...rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr..",
        ".....rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr....",
        ".......dddddddddddddddddddddddddd......",
    ]
    cx0, cy0 = 136, 121
    cv.stamp(canoe, {"o": "#ffb08a", "O": BRAND, "r": "#c2341a", "y": "#ffd27a", "d": "#6a1a1c"}, cx0, cy0)
    cv.line(cx0 + 16, cy0 - 3, cx0 + 24, cy0 + 2, "#b08458")  # a paddle resting across
    cv.rect(cx0 + 14, cy0 - 4, cx0 + 15, cy0 - 3, "#d0a070")
    for x in range(cx0 + 4, cx0 + 34):  # reflection
        if (x // 2) % 2 == 0:
            cv.set(x, cy0 + 7, "#a83a3a")
        if (x // 3) % 2 == 0 and cx0 + 8 < x < cx0 + 30:
            cv.set(x, cy0 + 9, "#6a3048")
    cv.line(cx0 + 37, cy0 + 1, 178, dy + 1, "#d8c4a0")  # mooring rope
    send_frames(a, [cv], 1000)


# ---------------------------------------------------------------- 6. Desert Oasis

def scene_oasis(a):
    W, H = 192, 108
    hz = 58
    sky = ["#2c62ae", "#3f80c4", "#64a2d6", "#96c4e0", "#cde0dc", "#f1e6c6"]
    cv = Canvas(W, H)
    for y in range(hz + 4):
        for x in range(W):
            cv.px[y][x] = ramp_pick(sky, (y / (hz + 2)) ** 1.1 + .02 * math.sin(x / 11 + y / 3), x, y, soft=.3)
    # sun, top left
    cv.disc(30, 15, 10, "#cde0dc")
    cv.disc(30, 15, 8.5, "#eef0dc")
    cv.disc(30, 15, 7, "#fff8de")
    cv.disc(29, 14, 5, "#ffffff")
    for (cx, cy, w) in ((92, 14, 20), (108, 11, 10), (156, 22, 16), (70, 30, 10)):
        cv.ellipse(cx, cy, w, 1.6, "#f4f6f2")
        cv.ellipse(cx + 3, cy + 1, w - 5, .6, "#c4d6e6")
    # far mesas
    for (x0, x1, top) in ((122, 140, 47), (146, 152, 51), (10, 24, 51), (178, 196, 48)):
        for x in range(x0 - 6, x1 + 7):
            slope = max(0, x0 - x, x - x1)
            y0 = top + (0 if slope == 0 else 3 + slope)  # cliff, then a talus slope
            for y in range(y0, hz + 2):
                cv.set(x, y, "#dcb2a0" if x < x0 + (x1 - x0) // 3 or x < x0 else "#c8a096")
        cv.hline(x0, x1, top, "#ead0bc")
        cv.hline(x0 + 1, x1 - 1, top + 3, "#c8a096")
    # three dune layers, near ones warmer and stronger; gentle lit windward slopes and shadowed slip faces
    layers = [
        (hz + 1, 7, 40, 41, ("#ecc496", "#d29e7e")),
        (hz + 9, 9, 52, 42, ("#f2c682", "#cf8c5c")),
        (hz + 26, 11, 70, 43, ("#f8d08a", "#c47a4c")),
    ]
    tops = []
    for (base, amp, period, seed, (lit, shade)) in layers:
        off = random.Random(seed).uniform(0, period)
        top = []
        for x in range(W):
            u = ((x + off) % period) / period  # sawtooth: slow rise then a steep drop
            prof = u / .78 if u < .78 else (1 - u) / .22
            prof = prof ** 1.3
            top.append(base - amp * prof + 2 * math.sin(x / 17 + seed))
        tops.append(top)
        for x in range(W):
            t0 = int(top[x])
            u = ((x + off) % period) / period
            slip = u > .78
            for y in range(t0, H):
                cv.set(x, y, shade if slip and y <= base + 2 + (u - .78) * 8 else lit)
            cv.set(x, t0, shade if slip else "#fbe2b0")
    # ripples on the near dunes
    for k in range(8):
        y0 = 92 + k * 2
        for x in range(W):
            yy = int(y0 + 2 * math.sin(x / 8 + k * 1.7))
            if yy > tops[2][x] + 3 and (x // 6 + k) % 3 == 0:
                cv.set(x, yy, "#dca06a" if cv.get(x, yy) == "#f8d08a" else "#a8623e")
    # the oasis: grass, a pool reflecting the sky and the palms
    px0, py0 = 104, 80
    cv.ellipse(px0, py0 + 1, 34, 8, "#3e8948")
    cv.ellipse(px0 - 2, py0, 31, 6.5, "#b88a5a")
    pool = lambda x, y: ((x - px0) / 27.5) ** 2 + ((y - py0) / 5) ** 2 <= 1
    palms = Canvas(W, H)
    pal = dict(dark="#5a3626", rim="#b07a4a", ring="#3a2018", frond="#2e7a3a", frond_lit="#7ac850", coco="#8a5a2a")
    palm(palms, (84, 80), (78, 60), (88, 42), sway=1, **pal)
    palm(palms, (124, 79), (132, 62), (122, 48), sway=-1, thick=(3, 2), **pal)
    palm(palms, (140, 82), (150, 70), (150, 58), sway=0, thick=(3, 2), **pal)
    for y in range(py0 - 6, py0 + 7):
        for x in range(px0 - 30, px0 + 31):
            if pool(x, y):
                k = (y - (py0 - 5)) / 10
                c = "#9ae0e2" if k < .15 else "#3cb8bc" if k < .55 else "#1f8a98"
                my = 2 * (py0 - 5) - y  # mirror line at the pool's far edge
                if palms.get(x, my + 6) and k > .1:
                    c = "#176a7a"
                cv.set(x, y, c)
    for x in range(px0 - 22, px0 + 20, 7):  # glints
        cv.hline(x, x + 2, py0 + 1 + (x % 3), "#c8f4f0")
    # grass clumps and reeds
    r = random.Random(14)
    for _ in range(26):
        ang = r.uniform(0, 2 * math.pi)
        gx = px0 + math.cos(ang) * r.uniform(29, 36)
        gy = py0 + 1 + math.sin(ang) * r.uniform(6.5, 9)
        for d in range(-1, 2):
            cv.vline(int(gx + d), int(gy - 1 - (d == 0) * 2), int(gy), "#63c74d" if d < 0 else "#2f7a3a")
    for y in range(H):
        for x in range(W):
            if palms.px[y][x]:
                cv.px[y][x] = palms.px[y][x]
    # brand-orange striped tent beside the pool
    tx, ty = 46, 82
    for y in range(ty - 12, ty + 1):
        half = (y - (ty - 12)) * 1.15
        for x in range(int(tx - half), int(tx + half) + 1):
            stripe = int((x - tx) / max(1, half) * 3 + 3) % 2
            lit = x < tx
            cv.set(x, y, (BRAND if lit else "#c2341a") if stripe else ("#fff0dc" if lit else "#e2c4a8"))
    cv.poly([(tx - 1, ty), (tx + 2, ty - 7), (tx + 6, ty)], "#5a1e18")
    cv.vline(tx, ty - 14, ty - 12, "#5a3626")
    cv.stamp(["OOO", "OO.", "O.."], {"O": BRAND}, tx + 1, ty - 15)
    cv.ellipse(tx + 3, ty + 1, 15, 1.4, "#c47a4c", only=lambda x, y: cv.get(x, y) in ("#f8d08a", "#f2c682"))
    # a trail of footprints from the bottom of the frame to the tent
    for i in range(11):
        t = i / 10
        fx = 30 + 14 * math.sin(t * 2.4) + t * 18
        fy = 106 - t * 22
        side = 1 if i % 2 else -1
        cv.hline(int(fx + side), int(fx + side + 1), int(fy), "#cf9a62")
    # rocks half buried in the near dune
    for (rx, ry) in ((168, 98), (176, 101), (12, 92)):
        cv.ellipse(rx, ry, 4, 2, "#a8705a")
        cv.ellipse(rx - 1, ry - 1, 2.5, 1, "#d09a78")
        cv.hline(rx - 3, rx + 4, ry + 2, "#c47a4c")
    send_frames(a, [cv], 1000)


# ---------------------------------------------------------------- voxel helpers

class Vox:
    def __init__(self, sx, sy, sz):
        self.s = (sx, sy, sz)
        self.v = {}

    off = (0, 0, 0)  # added to every coordinate (a margin around a diorama)

    def set(self, x, y, z, c):
        x, y, z = int(round(x)) + self.off[0], int(round(y)) + self.off[1], int(round(z)) + self.off[2]
        if 0 <= x < self.s[0] and 0 <= y < self.s[1] and 0 <= z < self.s[2]:
            if c is None:
                self.v.pop((x, y, z), None)
            else:
                self.v[(x, y, z)] = c

    def get(self, x, y, z):
        return self.v.get((int(x) + self.off[0], int(y) + self.off[1], int(z) + self.off[2]))

    def box(self, x0, y0, z0, x1, y1, z1, c):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.set(x, y, z, c)

    def sphere(self, cx, cy, cz, r, c, ry=None):
        ry = ry or r
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
                for z in range(int(cz - r) - 1, int(cz + r) + 2):
                    if ((x - cx) / (r + .4)) ** 2 + ((y - cy) / (ry + .4)) ** 2 + ((z - cz) / (r + .4)) ** 2 <= 1:
                        self.set(x, y, z, c(x, y, z) if callable(c) else c)

    def send(self, a, name):
        sx, sy, sz = self.s
        a.call("new_model", size_x=sx, size_y=sy, size_z=sz, name=name)
        cols = sorted(set(self.v.values()))
        assert len(cols) <= len(CHARS)
        key = {c: CHARS[i] for i, c in enumerate(cols)}
        print(f"  {len(cols)} colours, {len(self.v)} voxels")
        for y in range(sy):
            rows = []
            for z in range(sz):
                rows.append("".join(key[self.v[(x, y, z)]] if (x, y, z) in self.v else "." for x in range(sx)))
            used = {ch for r in rows for ch in r if ch != "."}
            if not used:
                continue
            legend = {key[c]: c for c in cols if key[c] in used}
            a.call("paint_slice", axis="y", index=y, rows=rows, legend=legend)


# ---------------------------------------------------------------- 7. Floating Island

def scene_island(a):
    S = 42
    m = Vox(S, S, S)
    cx, cz, top = 20, 20, 24
    nz = noise1(71, 64, 8, 2)
    rng = random.Random(7)

    def radius(ang):
        return 14.5 + 2.2 * nz[int((ang + math.pi) / (2 * math.pi) * 63)]

    rock = ["#33324c", "#4a4866", "#636184", "#7d7b9c"]
    for x in range(S):
        for z in range(S):
            dx, dz = x - cx, z - cz
            d = math.hypot(dx, dz)
            R = radius(math.atan2(dz, dx))
            if d > R:
                continue
            # depth of the underside here: a cone with lumps, deepest in the middle
            depth = int(3 + (1 - (d / R) ** 1.6) * 19 + 2 * nz[(x * 7 + z * 3) % 64])
            for y in range(top - depth, top + 1):
                k = top - y
                if k == 0:
                    c = "#5ab84a" if (x * 3 + z * 5 + rng.randint(0, 2)) % 5 else "#78d058"
                elif k == 1:
                    c = "#3e8948"
                elif k <= 3:
                    c = "#8a5a3a" if (x + z + y) % 4 else "#6b3e2e"
                else:
                    t = (k - 4) / 18
                    band = 3 - min(3, int(t * 3.2 + ((x + y * 2 + z) % 3) * .25))
                    c = rock[max(0, band - (1 if d > R - 1.5 else 0))]
                m.set(x, y, z, c)
            if d > R - 1.2 and rng.random() < .25:  # grass drips over the rim
                m.set(x, top - 1, z, "#4fa04a")
                if rng.random() < .4:
                    m.set(x, top - 2, z, "#3e8948")
    # hanging roots and stalactite tips under the rock
    for _ in range(14):
        ang = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(3, 10)
        x, z = round(cx + math.cos(ang) * rr), round(cz + math.sin(ang) * rr)
        y = min((yy for (xx, yy, zz) in m.v if xx == x and zz == z), default=None)
        if y is None:
            continue
        for k in range(1, rng.randint(2, 4)):
            m.set(x, y - k, z, rock[0])
    # pond near the east rim with a waterfall spilling off the edge into the sky
    for x in range(26, 33):
        for z in range(15, 21):
            if ((x - 29.5) / 3.6) ** 2 + ((z - 18) / 3.2) ** 2 <= 1:
                m.set(x, top, z, "#3ab0e0" if (x + z) % 3 else "#7ad8f0")
                m.set(x, top - 1, z, "#2a7ab8")
    for x in range(32, 36):
        for z in range(17, 20):
            m.set(x, top, z, "#3ab0e0")
            m.set(x, top - 1, z, "#2a7ab8")
    for y in range(0, top + 1):
        for z in range(17, 20):
            foam = (y + z) % 4 == 0
            m.set(36, y, z, "#e8f8ff" if foam else "#5ad0f0" if z != 19 else "#3ab0e0")
            if y < top - 2:
                m.set(37, y, z, "#5ad0f0" if (y + z) % 3 else "#3ab0e0") if y < 6 else None
    for z in range(15, 22):  # spray where it falls away
        for x in range(34, 40):
            if ((x - 36.5) / 3) ** 2 + ((z - 18) / 3.4) ** 2 <= 1:
                m.set(x, 0, z, "#e8f8ff" if (x + z) % 2 else "#b8ecff")
    # tree with brand-orange fruit
    tx, tz = 11, 13
    m.box(tx, top + 1, tz, tx + 1, top + 7, tz + 1, "#6a3e2a")
    m.set(tx, top + 1, tz + 2, "#6a3e2a")
    m.set(tx - 1, top + 1, tz, "#6a3e2a")
    leaves = lambda x, y, z: ("#9de64e" if y > top + 12 and (x + z) % 2 else "#63c74d" if y > top + 9 else
                              "#3e8948" if y > top + 7 else "#265c42")
    for (ox, oy, oz, r) in ((0.5, 11, 0.5, 5), (-3, 9, 3, 3.5), (3.5, 9, -2, 3.5), (2, 13, 2, 3)):
        m.sphere(tx + ox, top + oy, tz + oz, r, leaves)
    surface = [p for p, c in m.v.items() if c in ("#63c74d", "#3e8948") and p[1] > top + 7 and
               any((p[0] + d[0], p[1], p[2] + d[1]) not in m.v for d in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for p in random.Random(3).sample(sorted(surface), 7):  # fruit on the outside of the canopy
        m.set(*p, BRAND)
    # cottage: timber walls, glowing window, brand-orange roof
    hx0, hx1, hz0, hz1 = 17, 24, 22, 28
    for x in range(hx0, hx1 + 1):
        for z in range(hz0, hz1 + 1):
            for y in range(top + 1, top + 6):
                if x in (hx0, hx1) or z in (hz0, hz1):
                    frame = x in (hx0, hx1) and z in (hz0, hz1) or y == top + 1 or y == top + 5
                    m.set(x, y, z, "#7a4a32" if frame else "#ecdcbc")
    for y in range(top + 1, top + 4):
        m.set(20, y, hz1, "#5a3428")
        m.set(21, y, hz1, "#5a3428")
    m.set(21, top + 2, hz1, "#e0b35a")
    for (x, z) in ((hx0, 25), (hx1, 25)):
        m.set(x, top + 3, z, "#ffd27a")
        m.set(x, top + 3, z - 1, "#ffd27a")
    for k in range(0, 5):  # pitched roof, ridge along z
        y = top + 6 + k
        for z in range(hz0 - 1, hz1 + 2):
            for x in (hx0 - 1 + k, hx1 + 1 - k):
                m.set(x, y, z, BRAND if x <= 20 else "#c2341a")
            if hx0 - 1 + k >= hx1 + 1 - k - 1:
                for x in range(hx0 - 1 + k, hx1 + 2 - k):
                    m.set(x, y, z, BRAND)
        for z in (hz0, hz1):  # gables
            for x in range(hx0 + k, hx1 + 1 - k):
                m.set(x, y, z, "#ecdcbc")
    m.box(23, top + 9, 24, 23, top + 11, 24, "#636184")  # chimney
    # stepping stones and flowers
    for (x, z) in ((20, 31), (19, 33), (17, 30), (15, 27), (13, 24), (12, 20), (12, 17)):
        if m.get(x, top, z):
            m.set(x, top, z, "#c8c4d8")
    for _ in range(18):
        x, z = rng.randint(6, 33), rng.randint(6, 33)
        if m.get(x, top, z) in ("#5ab84a", "#78d058") and not m.get(x, top + 1, z):
            m.set(x, top + 1, z, rng.choice(("#f6757a", "#fee761", "#ffffff", "#c060e0")))
    m.send(a, "Floating Island")


# ---------------------------------------------------------------- 8. Campfire Clearing

def scene_camp(a):
    SX, SY, SZ = 36, 28, 36
    m = Vox(SX + 2, SY, SZ + 2)
    m.off = (1, 0, 1)
    rng = random.Random(9)
    g = 3  # ground top
    cx, cz = 18, 19
    for x in range(SX):
        for z in range(SZ):
            # rounded corners on the ground tile
            if min(x, SX - 1 - x) + min(z, SZ - 1 - z) < 2:
                continue
            for y in range(g + 1):
                if y < g - 1:
                    c = "#5a3428" if (x + z + y) % 3 else "#6b3e2e"
                elif y == g - 1:
                    c = "#8a5a3a"
                else:
                    d = math.hypot(x - cx, z - cz)
                    if d < 7.5 + rng.random() * 1.2:
                        c = "#b08a5a" if (x * 3 + z) % 4 else "#9a7448"
                    else:
                        c = "#5ab84a" if (x * 5 + z * 3) % 7 else "#4a9a44"
                        if rng.random() < .08:
                            c = "#78d058"
                m.set(x, y, z, c)
    # tufts of grass on the edges of the clearing and around
    for _ in range(40):
        x, z = rng.randint(1, SX - 2), rng.randint(1, SZ - 2)
        if m.get(x, g, z) in ("#5ab84a", "#4a9a44", "#78d058"):
            m.set(x, g + 1, z, "#3e8948" if rng.random() < .6 else "#63c74d")
    # stone ring, logs and the fire
    for k in range(12):
        ang = k / 12 * 2 * math.pi
        x, z = cx + math.cos(ang) * 3.6, cz + math.sin(ang) * 3.6
        m.set(x, g + 1, z, "#8a8aa0" if k % 3 else "#6a6a80")
        if k % 4 == 0:
            m.set(x, g + 2, z, "#a8a8bc")
    for t in range(-2, 3):
        m.set(cx + t, g + 1, cz + t, "#5a3428")
        m.set(cx + t, g + 1, cz - t, "#6a3e2a")
    m.set(cx, g + 1, cz, "#c2341a")
    flame = [(2.6, BRAND), (2.4, BRAND), (2.0, "#ff9a3c"), (1.7, "#ff9a3c"), (1.3, "#ffb83c"), (1.0, "#ffd86a"),
             (.6, "#fff0a0")]
    for i, (r, col) in enumerate(flame):
        y = g + 2 + i
        for x in range(cx - 3, cx + 4):
            for z in range(cz - 3, cz + 4):
                d = math.hypot(x - cx - .3 * (i > 2), z - cz)
                if d <= r:
                    inner = d < r - 1
                    m.set(x, y, z, flame[min(len(flame) - 1, i + 2)][1] if inner else col)
    m.set(cx, g + 9, cz, BRAND)
    m.set(cx - 1, g + 8, cz, BRAND)
    # log benches
    for x in range(11, 25):
        for (dy, dz) in ((0, 0), (1, 0), (0, 1), (1, 1)):
            m.set(x, g + 1 + dy, 9 + dz, "#6a3e2a" if dy == 0 else "#8a5a3a")
    for (x, z) in ((11, 9), (11, 10), (24, 9), (24, 10)):
        for dy in (0, 1):
            m.set(x, g + 1 + dy, z, "#c49a6a")
    for z in range(13, 27):
        for (dy, dx) in ((0, 0), (1, 0), (0, 1), (1, 1)):
            m.set(28 + dx, g + 1 + dy, z, "#6a3e2a" if dy == 0 else "#8a5a3a")
    for (x, z) in ((28, 13), (29, 13), (28, 26), (29, 26)):
        for dy in (0, 1):
            m.set(x, g + 1 + dy, z, "#c49a6a")
    # a lantern on the bench
    m.set(28, g + 3, 22, "#3a3448")
    m.set(28, g + 4, 22, "#ffd27a")
    m.set(28, g + 5, 22, "#3a3448")
    # A-frame tent, ridge along z, opening facing the fire
    for z in range(4, 13):
        for k in range(8):
            y = g + 1 + k
            half = 6 - k * .8
            for x in range(int(round(9 - half)), int(round(9 + half)) + 1):
                edge = abs(x - 9) >= half - 1
                if z in (4, 12) or edge:
                    m.set(x, y, z, ("#2a8f9a" if x <= 9 else "#1d6a78") if edge or z == 4 else "#e8dcc0")
    for k in range(5):  # the door flap opening
        for x in range(9 - (4 - k) // 2, 10 + (4 - k) // 2):
            if k < 5:
                m.set(x, g + 1 + k, 12, "#16303a")
    m.set(9, g + 1, 13, "#e8dcc0")
    m.box(9, g + 9, 4, 9, g + 11, 4, "#5a3428")  # pole and a brand-orange pennant
    m.set(9, g + 11, 3, BRAND)
    m.set(9, g + 10, 3, BRAND)
    m.set(9, g + 11, 2, BRAND)
    # firewood stack by the tent
    for y in range(2):
        for z in range(15, 19):
            for x in (3, 4, 5):
                if not (y == 1 and x == 5):
                    m.set(x, g + 1 + y, z, "#8a5a3a" if (x + y) % 2 else "#c49a6a")
    # trees: two firs and a round one
    def fir3(x0, z0, h):
        m.box(x0, g + 1, z0, x0 + 1, g + 3, z0 + 1, "#5a3428")
        for k in range(h):
            y = g + 4 + k
            tier = k % 4
            r = (h - k) * .3 + 1.3 - tier * .3
            for x in range(int(x0 - r) - 1, int(x0 + r) + 3):
                for z in range(int(z0 - r) - 1, int(z0 + r) + 3):
                    if math.hypot(x - x0 - .5, z - z0 - .5) <= r:
                        lit = (x - x0) + (z0 - z) < 0 or tier == 0
                        m.set(x, y, z, "#3e8948" if lit else "#265c42")
        m.set(x0, g + 4 + h, z0, "#63c74d")

    fir3(28, 7, 18)
    fir3(5, 28, 14)
    m.box(31, g + 1, 31, 31, g + 4, 31, "#5a3428")
    m.sphere(31, g + 7, 31, 3.2, lambda x, y, z: "#78d058" if y > g + 8 else "#4a9a44" if y > g + 6 else "#2f7a3a")
    # red mushrooms and pebbles
    for (x, z) in ((25, 31), (26, 32), (6, 23)):
        m.set(x, g + 1, z, "#e8dcc0")
        m.set(x, g + 2, z, "#e43b44")
    for _ in range(10):
        x, z = rng.randint(2, SX - 3), rng.randint(2, SZ - 3)
        if m.get(x, g, z) and not m.get(x, g + 1, z):
            m.set(x, g + 1, z, "#9a9ab0")
    m.send(a, "Campfire Clearing")


SCENES = {
    "scene-cabin": ("Snowy Cabin", "animation", scene_cabin),
    "scene-beach": ("Sunset Beach", "animation", scene_beach),
    "scene-dungeon": ("Torchlit Dungeon", "animation", scene_dungeon),
    "scene-neon": ("Neon Rooftop", "animation", scene_neon),
    "scene-lake": ("Mountain Lake", "sprite", scene_lake),
    "scene-oasis": ("Desert Oasis", "sprite", scene_oasis),
    "scene-island": ("Floating Island", "voxel", scene_island),
    "scene-camp": ("Campfire Clearing", "voxel", scene_camp),
}


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    draft = "--draft" in sys.argv  # review only, no exports
    want = args or list(SCENES)
    a = op.Agent()
    a.call("pixel_art_guide", topic="all")
    for slug in want:
        title, kind, fn = SCENES[slug]
        fn(a)
        if draft:
            rep, pics = common.review(a, slug)
            print(slug, common.summary(rep), pics)
            continue
        COL.publish(a, slug, title, kind)
    a.close()


if __name__ == "__main__":
    main()

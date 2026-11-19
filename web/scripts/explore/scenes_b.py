#!/usr/bin/env python3
"""Explore page, Scenes (set B): eight 192×108 scenes and one voxel diorama, drawn with OpenPixel over MCP.

Each scene is composed in Python on a small canvas (layered skies with staggered, dithered band edges, ridgelines from
smoothed noise, shaded spheres, stamped details, per-frame particles on a looping lattice), with colour ramps from
OpenPixel's make_color_ramp, then painted into OpenPixel with paint_slice, reviewed with review_model and exported.

    python3 scenes_b.py                 every scene (writes manifest/scenes_b.json)
    python3 scenes_b.py scene-space     just the slugs given
"""
import math
import random
import sys

import common
import op

W, H = 192, 108
BRAND = "#ff4a1c"
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+-=?@^~<>()[]{}/|:;,_'\"`"

col = common.Collection("scenes_b", "scenes")

# ---------------------------------------------------------------- helpers

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def bayer(x, y):
    return (BAYER[y & 3][x & 3] + 0.5) / 16


def dith(x, y, t):
    """True on a fraction t of pixels, in an ordered (Bayer) pattern."""
    return t > bayer(x, y)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgbhex(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(v)))) for v in c)


def mix(a, b, t):
    a, b = hexrgb(a), hexrgb(b)
    return rgbhex([a[i] + (b[i] - a[i]) * t for i in range(3)])


class Noise:
    """Smooth 1D value noise (fractal)."""

    def __init__(self, seed):
        r = random.Random(seed)
        self.v = [r.random() for _ in range(1024)]

    def __call__(self, x, scale=16.0, octaves=3):
        total, amp, norm, f = 0.0, 1.0, 0.0, 1.0 / scale
        for o in range(octaves):
            p = x * f + o * 37.1
            i = math.floor(p)
            t = p - i
            t = t * t * (3 - 2 * t)
            a, b = self.v[i % 1024], self.v[(i + 1) % 1024]
            total += (a + (b - a) * t) * amp
            norm += amp
            amp *= 0.5
            f *= 2
        return total / norm


def noise2(x, y, seed=0, scale=8.0):
    """Cheap smooth 2D value noise in 0..1."""
    def h(ix, iy):
        n = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) & 0xFFFFFFFF
        n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0
    fx, fy = x / scale, y / scale
    ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * tx
    b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * tx
    return a + (b - a) * ty


class Canvas:
    def __init__(self, w=W, h=H, fill=None):
        self.w, self.h = w, h
        self.p = [[fill] * w for _ in range(h)]

    def copy(self):
        c = Canvas(self.w, self.h)
        c.p = [r[:] for r in self.p]
        return c

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def set(self, x, y, c):
        x, y = int(x), int(y)
        if c and self.inside(x, y):
            self.p[y][x] = c

    def get(self, x, y):
        x, y = int(x), int(y)
        return self.p[y][x] if self.inside(x, y) else None

    def rect(self, x0, y0, x1, y1, c):
        """Inclusive rectangle."""
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def hline(self, x0, x1, y, c):
        self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, y0, x, y1, c)

    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        """A clean 1-pixel line (Bresenham)."""
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

    def stamp(self, x, y, rows, legend, flip=False):
        for j, row in enumerate(rows):
            row = row[::-1] if flip else row
            for i, ch in enumerate(row):
                if ch in legend:
                    self.set(x + i, y + j, legend[ch])

    def remap(self, x0, y0, x1, y1, fn):
        for y in range(max(0, int(y0)), min(self.h, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(self.w, int(x1) + 1)):
                c = self.p[y][x]
                n = fn(x, y, c)
                if n:
                    self.p[y][x] = n

    def colors(self):
        return {c for r in self.p for c in r if c}


def bands(cv, y0, y1, ramp, jitter=None, edge=0.35, x0=0, x1=None):
    """Horizontal colour bands from ramp[0] (top) to ramp[-1] (bottom), with edges that stagger (noise) and dither."""
    x1 = cv.w - 1 if x1 is None else x1
    n = len(ramp)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            t = (y - y0) / max(1, y1 - y0) * (n - 1)
            if jitter:
                t += (jitter(x) - 0.5) * 0.9
            t = max(0, min(n - 1 - 1e-6, t))
            i = int(t)
            f = t - i
            if f > 1 - edge and dith(x, y, (f - (1 - edge)) / edge * 0.75):
                i += 1
            cv.set(x, y, ramp[min(n - 1, i)])


def ridge(cv, noise, base, amp, c, scale=24.0, octaves=3, y_max=None, x0=0, x1=None, shade=None):
    """Fills everything below a noisy ridgeline. Returns the heights."""
    x1 = cv.w - 1 if x1 is None else x1
    y_max = cv.h - 1 if y_max is None else y_max
    tops = {}
    for x in range(x0, x1 + 1):
        top = int(base - noise(x, scale, octaves) * amp)
        tops[x] = top
        for y in range(top, y_max + 1):
            cv.set(x, y, c)
        if shade:
            shade(x, top)
    return tops


def sphere_light(dx, dy, light=(-0.55, -0.62, 0.56)):
    nz = math.sqrt(max(0.0, 1 - dx * dx - dy * dy))
    lx, ly, lz = light
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    return (dx * lx + dy * ly + nz * lz) / ln


def lattice(seed, px, py, n, w=W, h=H, pad=8):
    """Points of a pattern repeating every (px, py): moving every point by exactly (px, py) over an animation's frames
    lands on the same picture, so particle loops are seamless."""
    r = random.Random(seed)
    cell = [(r.random() * px, r.random() * py, r.random()) for _ in range(n)]
    pts = []
    for ty in range(-2, h // py + 3):
        for tx in range(-2, w // px + 3):
            for (x, y, k) in cell:
                pts.append((x + tx * px, y + ty * py, k))
    return pts


def ramp(a, base, steps=5, hue_shift=None):
    args = {"base": base, "steps": steps}
    if hue_shift is not None:
        args["hue_shift"] = hue_shift
    return a.call("make_color_ramp", **args)["colors"]


def push(a, frames, ms):
    """Paints canvases into the open sprite as animation frames."""
    cols = sorted(set().union(*(f.colors() for f in frames)))
    assert len(cols) <= len(CHARS), len(cols)
    print("  closest colour pairs:", near_pairs(frames, 6))
    legend = {CHARS[i]: c for i, c in enumerate(cols)}
    inv = {c: k for k, c in legend.items()}
    for i, f in enumerate(frames):
        if i > 0:
            a.call("add_frame", copy=False)
        rows = ["".join(inv[c] if c else "." for c in r) for r in f.p]
        a.call("paint_slice", rows=rows, legend=legend, frame=i)
        d = ms[i] if isinstance(ms, (list, tuple)) else ms
        if len(frames) > 1:
            a.call("set_frame_duration", frame=i, duration_ms=d)
    return len(cols)


def near_pairs(frames, limit=12):
    """Colour pairs used in the frames that are close (to spot the review's 'almost identical colours')."""
    cols = sorted(set().union(*(f.colors() for f in frames)))
    out = []
    for i, p in enumerate(cols):
        for q in cols[i + 1:]:
            a, b = hexrgb(p), hexrgb(q)
            d = 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2
            out.append((d, p, q))
    return sorted(out)[:limit]


def start(a, name):
    a.call("new_sprite", width=W, height=H, name=name)


def check(a, slug, frames=(0,)):
    for f in frames:
        rep, paths = common.review(a, f"{slug}-f{f}", frame=f)
        print(slug, "frame", f, common.summary(rep))
        print("  pictures:", paths)


# ---------------------------------------------------------------- 1. ringed planet


def scene_space(a):
    slug = "scene-space"
    start(a, "Ringed Planet")
    sky = ramp(a, "#1b1f4a", 4, 10)           # deep space, darkest first
    neb = ramp(a, "#4b2f72", 4, 14)           # violet nebula
    tea = ramp(a, "#2f7f8f", 3, 12)           # teal nebula edge
    sand = ramp(a, "#d49a5e", 5, 12)          # planet bands, warm
    rust = ramp(a, "#a8503a", 4, 12)          # planet bands, rust
    ring = ramp(a, "#c9b08a", 4, 8)
    moon = ramp(a, "#8a8fb0", 4, 10)
    star_w, star_b = sand[4], "#9fb6e8"

    base = Canvas()
    nz = Noise(11)
    bands(base, 0, H - 1, [sky[0], sky[0], sky[1], sky[1]], jitter=lambda x: nz(x, 20, 2))
    # nebula: a soft diagonal band of glowing gas from the bottom left up behind the planet, in dithered levels
    for y in range(H):
        for x in range(W):
            # distance from the band's centre line (bottom-left to top-right)
            d = ((x - 20) * 0.42 + (y - 100) * 0.9) / 30.0
            v = math.exp(-d * d) * (0.45 + 0.75 * noise2(x, y, 3, 16)) + (noise2(x, y, 8, 5) - 0.5) * 0.18
            if v > 0.86:
                c = neb[2]
            elif v > 0.66:
                c = neb[1] if not (v > 0.80 and dith(x, y, 0.5)) else neb[2]
            elif v > 0.48:
                c = sky[2] if not (v > 0.60 and dith(x, y, 0.5)) else neb[1]
            elif v > 0.36 and dith(x, y, (v - 0.36) / 0.12 * 0.7):
                c = sky[2]
            else:
                c = None
            # a few faint teal glints where a second noise peaks inside the brightest gas
            if c and v > 0.72 and noise2(x, y, 21, 7) > 0.70 and dith(x, y, 0.5):
                c = tea[1]
            if c:
                base.set(x, y, c)

    # stars (fixed field; some twinkle)
    r = random.Random(5)
    stars = []
    for _ in range(95):
        stars.append((r.randrange(W), r.randrange(H), r.random(), r.randrange(8)))
    big = [(18, 14), (64, 9), (170, 20), (40, 70), (184, 86), (96, 98), (150, 6), (8, 44)]

    cx, cy, R = 122, 58, 25
    tilt = math.radians(-14)
    rx, ry = 50.0, 11.0

    def ring_at(x, y):
        """(on ring, front half, radius 0..1) for ring pixel coordinates."""
        u, v = x + 0.5 - cx, y + 0.5 - cy
        ru = u * math.cos(tilt) - v * math.sin(tilt)
        rv = u * math.sin(tilt) + v * math.cos(tilt)
        q = math.sqrt((ru / rx) ** 2 + (rv / ry) ** 2)
        return q, rv > 0

    def draw_ring(cv, front):
        for y in range(cy - 30, cy + 30):
            for x in range(cx - 58, cx + 58):
                q, fr = ring_at(x, y)
                if fr != front or not (0.62 <= q <= 1.0):
                    continue
                if 0.80 <= q < 0.84:          # Cassini-style gap
                    continue
                if q > 0.93:
                    c = ring[1]
                elif q > 0.84:
                    c = ring[2]
                elif q > 0.72:
                    c = ring[3] if (not front or x < cx + 10) else ring[2]
                else:
                    c = ring[1]
                # the planet's shadow falls on the far side of the ring (light comes from the top-left)
                if not front and x > cx + 4 and (x - cx) ** 2 + (y - cy + 3) ** 2 < (R + 3) ** 2:
                    c = ring[0]
                cv.set(x, y, c)

    def draw_planet(cv):
        for y in range(cy - R - 1, cy + R + 2):
            for x in range(cx - R - 1, cx + R + 2):
                dx, dy = (x + 0.5 - cx) / R, (y + 0.5 - cy) / R
                if dx * dx + dy * dy > 1:
                    continue
                l = sphere_light(dx, dy)
                # latitude bands, bent by the planet's curvature and tilted with the ring
                lat = dy * math.cos(tilt) + dx * math.sin(tilt) * 0.9
                b = math.floor((lat + 1) * 4.2 + noise2(x, y, 4, 5) * 0.7)
                pal = rust if b % 3 == 1 else sand
                t = (l + 0.35) / 1.25
                i = 0 if t < 0.12 else 1 if t < 0.38 else 2 if t < 0.66 else 3 if t < 0.86 else 4
                if pal is rust:
                    i = min(3, i)
                # soften terminator steps with a dither
                if 0.10 < t < 0.16 and dith(x, y, 0.5):
                    i = 1
                cv.set(x, y, pal[i])
        # the ring's shadow on the planet body: a thin dark arc just below the ring plane
        for x in range(cx - R, cx + R + 1):
            for y in range(cy - R, cy + R + 1):
                dx, dy = (x + 0.5 - cx) / R, (y + 0.5 - cy) / R
                if dx * dx + dy * dy > 0.96:
                    continue
                u, v = x + 0.5 - cx, y + 0.5 - cy
                rv = u * math.sin(tilt) + v * math.cos(tilt)
                if 3.5 < rv < 6.0:
                    c = cv.get(x, y)
                    cv.set(x, y, rust[0] if c in (sand[0], sand[1], rust[0], rust[1]) else rust[1])

    # small moon, upper left of the planet
    def draw_moon(cv):
        mx, my, mr = 62, 30, 6
        for y in range(my - mr - 1, my + mr + 2):
            for x in range(mx - mr - 1, mx + mr + 2):
                dx, dy = (x + 0.5 - mx) / mr, (y + 0.5 - my) / mr
                if dx * dx + dy * dy > 1:
                    continue
                l = sphere_light(dx, dy)
                i = 0 if l < -0.1 else 1 if l < 0.35 else 2 if l < 0.75 else 3
                cv.set(x, y, moon[i])
        cv.set(60, 31, moon[1]); cv.set(64, 27, moon[1]); cv.set(63, 33, moon[0])

    frames = []
    comet_path = [(-6 + f * 46, 5 + f * 4) for f in range(5)] + [None] * 3
    for f in range(8):
        cv = base.copy()
        for (x, y, k, ph) in stars:
            if cv.get(x, y) not in (sky[0], sky[1], sky[2], neb[1]):
                continue
            tw = (f + ph) % 8
            if k > 0.85:
                cv.set(x, y, star_w if tw not in (3, 4) else star_b)
            elif k > 0.5:
                if tw != 5:
                    cv.set(x, y, star_b)
            else:
                if tw in (0, 1, 2, 6):
                    cv.set(x, y, sky[3])
        for i, (x, y) in enumerate(big):
            phase = (f + i * 3) % 8
            cv.set(x, y, star_w)
            if phase in (0, 1, 7):            # sparkle cross on its bright frames
                for (ox, oy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    cv.set(x + ox, y + oy, star_b)
            if phase == 0:
                for (ox, oy) in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                    cv.set(x + ox, y + oy, sky[3])
        draw_moon(cv)
        draw_ring(cv, False)
        draw_planet(cv)
        draw_ring(cv, True)
        # a comet streaks across the top: white head, tail in the brand orange fading to violet
        if comet_path[f]:
            hx, hy = comet_path[f]
            ux, uy = 46 / math.hypot(46, 4), 4 / math.hypot(46, 4)
            for d in range(1, 30):
                tx, ty = hx - ux * d, hy - uy * d
                if d <= 3:
                    c = sand[4]
                elif d <= 9:
                    c = BRAND
                elif d <= 16:
                    c = rust[1]
                elif d <= 24:
                    c = neb[2] if dith(int(tx), int(ty), 0.75) else None
                else:
                    c = neb[1] if dith(int(tx), int(ty), 0.5) else None
                cv.set(tx, ty, c)
                if 3 < d < 12:
                    cv.set(tx, ty + 1, rust[1] if d > 7 else BRAND)
            cv.set(hx, hy, "#ffffff"); cv.set(hx + 1, hy, star_w); cv.set(hx, hy + 1, star_w)
            cv.set(hx, hy - 1, star_b)
        frames.append(cv)
    n = push(a, frames, [80, 80, 80, 80, 80, 260, 260, 260])
    print(slug, "colours:", n)
    return slug, "Ringed Planet", "animation"



# ---------------------------------------------------------------- shared shapes


def shaded_ellipse(cv, cx, cy, rx, ry, shades, light=(-0.55, -0.62, 0.56), cut=None):
    """An ellipse shaded as a dome lit from the top-left; shades darkest first. cut(x, y) -> skip pixel."""
    n = len(shades)
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            if dx * dx + dy * dy > 1 or (cut and cut(x, y)):
                continue
            l = (sphere_light(dx, dy, light) + 0.45) / 1.45
            cv.set(x, y, shades[max(0, min(n - 1, int(l * n)))])


def branch_coral(cv, x, y, height, shades, seed, tip=None):
    """A branching coral growing up from (x, y): 2-pixel trunks lit on the left, 1-pixel twigs with light tips."""
    r = random.Random(seed)

    def grow(x, y, h, thick, lean):
        fx = float(x)
        for i in range(h):
            fx += lean + (r.random() - 0.5) * 0.5
            xi, yi = int(round(fx)), y - i
            if thick > 1:
                cv.set(xi, yi, shades[2])
                cv.set(xi + 1, yi, shades[1])
            else:
                cv.set(xi, yi, shades[2] if i < h - 1 else (tip or shades[3]))
            if i > 2 and h - i > 3 and r.random() < 0.18:
                grow(xi + (1 if lean > 0 else 0), yi, max(3, int((h - i) * 0.7)), 1, -lean * 1.2 + (r.random() - 0.5) * 0.5)
        if thick > 1:
            cv.set(int(round(fx)), y - h, tip or shades[3])

    grow(x, y, height, 2, (r.random() - 0.5) * 0.2)
    grow(x - 1, y - 2, int(height * 0.7), 1, -0.45)
    grow(x + 2, y - 3, int(height * 0.75), 1, 0.45)


def blob(parts):
    """A mask (set of (x, y)) from a union of ellipses (cx, cy, rx, ry)."""
    m = set()
    for (cx, cy, rx, ry) in parts:
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    m.add((x, y))
    return m


def shade_mask(cv, mask, shades, seed=0, reach=10, rim=True, tex=0.25, light=(-1, -1)):
    """Shades a solid form by where each pixel sits between its lit side (toward the light, top-left by default) and
    its shadow side: a ramp across the form, not rings along the outline. shades: darkest first."""
    n = len(shades)
    lx, ly = light
    for (x, y) in mask:
        dl = 0
        while dl < reach and (x + lx * (dl + 1), y + ly * (dl + 1)) in mask:
            dl += 1
        ds = 0
        while ds < reach and (x - lx * (ds + 1), y - ly * (ds + 1)) in mask:
            ds += 1
        t = ds / max(1, dl + ds)            # 1 = on the lit edge, 0 = on the shadow edge
        t += (noise2(x, y, seed, 4) - 0.5) * tex * 2
        i = int(max(0, min(0.999, t)) * (n - 1) + 0.5)
        if rim and dl == 0:
            i = n - 1
        cv.set(x, y, shades[max(0, min(n - 1, i))])


# ---------------------------------------------------------------- 2. coral reef


def scene_reef(a):
    slug = "scene-reef"
    start(a, "Coral Reef")
    wat = ramp(a, "#1d6f9e", 5, 10)       # water, darkest first
    sand = ramp(a, "#d2b07a", 4, 10)
    rock = ramp(a, "#3f4f72", 4, 12)
    pink = ramp(a, "#e0607e", 4, 12)
    gold = ramp(a, "#e8a53c", 4, 12)
    fan = ramp(a, "#9354b8", 3, 12)
    kelp = ramp(a, "#4f9a4a", 4, 14)
    org = ["#7a1e14", "#c0331a", BRAND, "#ffb27a"]
    foam = "#e8fbff"
    lighter = {wat[i]: wat[i + 1] for i in range(4)}
    rock[0] = wat[0]                      # merge near-identical darks
    gold[0] = sand[0]

    base = Canvas()
    bands(base, 0, H - 1, [wat[3], wat[2], wat[2], wat[1], wat[1], wat[0]], jitter=lambda x: Noise(31)(x, 30, 1))
    # far reef silhouettes: the farther, the closer to the water's colour
    ridge(base, Noise(32), 70, 10, wat[1], scale=7, octaves=2)
    ridge(base, Noise(33), 86, 12, wat[0], scale=9, octaves=2)
    # seabed: sand with soft ripple dashes and pebbles
    tops = ridge(base, Noise(34), 98, 6, sand[1], scale=40, octaves=2)
    n2 = Noise(35)
    for x in range(W):
        base.set(x, tops[x], sand[2])
        for y in range(tops[x] + 2, H, 3):
            if math.sin(x * 0.32 + n2(x, 12, 2) * 9 + y * 1.1) > 0.8:
                base.set(x, y, sand[2])
                base.set(x, y + 1, sand[0])
    # rocks: irregular, form-shaded masses
    left = blob([(30, 96, 24, 13), (14, 92, 12, 12), (48, 100, 16, 9), (36, 88, 12, 8)])
    right = blob([(164, 96, 22, 12), (182, 88, 13, 16), (146, 101, 12, 8), (172, 84, 9, 7)])
    shade_mask(base, left, rock, 5)
    shade_mask(base, right, rock, 6)
    # brain corals on the rocks
    def brain(cx, cy, rx, ry):
        m = {(x, y) for (x, y) in blob([(cx, cy, rx, ry)]) if y <= cy + 1}
        shade_mask(base, m, gold, 9, reach=6, tex=0.1)
        for (x, y) in m:
            if math.sin(x * 1.1 + math.sin(y * 0.9) * 2.4) > 0.78 and (x - 1, y - 1) in m:
                base.set(x, y, gold[1])
    brain(150, 86, 9, 6)
    brain(36, 81, 8, 5)
    # tube sponges, purple, on the left rock
    for (tx, ty, th) in ((54, 92, 14), (59, 94, 10), (49, 94, 8)):
        base.rect(tx, ty - th, tx + 3, ty, fan[1])
        base.vline(tx, ty - th, ty, fan[2])
        base.vline(tx + 3, ty - th, ty, fan[0])
        base.hline(tx, tx + 3, ty - th, fan[2])
        base.hline(tx + 1, tx + 2, ty - th, rock[0])
    # sea fan
    fx, fy = 14, 82
    for k in range(9):
        ang = math.radians(-160 + k * 17.5)
        ln = 19 + (k % 3) * 2
        base.line(fx, fy, fx + math.cos(ang) * ln, fy + math.sin(ang) * ln * 0.95, fan[1] if k % 2 else fan[2])
    for rr in (8, 13, 18):
        for k in range(48):
            ang = math.radians(-160 + k * 3)
            base.set(fx + math.cos(ang) * rr, fy + math.sin(ang) * rr * 0.95, fan[1])
    # branching corals, the focal cluster in the brand orange
    branch_coral(base, 68, 96, 15, pink, 1)
    branch_coral(base, 76, 98, 10, pink, 2)
    branch_coral(base, 128, 99, 13, pink, 4)
    branch_coral(base, 176, 79, 17, org, 7, tip=org[3])
    branch_coral(base, 186, 78, 12, org, 8, tip=org[3])
    branch_coral(base, 166, 82, 10, org, 9, tip=org[3])
    # a starfish on the sand
    base.stamp(100, 100, ["..o..", ".ooo.", "ooooo", ".o.o.", "o...o"], {"o": gold[2]})
    base.set(102, 102, gold[3])

    rays = [(14, 9), (58, 6), (100, 11), (146, 7)]
    kelps = [(86, 99, 62, 0.0), (95, 100, 50, 1.7), (110, 98, 70, 3.1), (4, 104, 46, 0.9)]
    bub = lattice(41, 20, 32, 3)
    zones = [(98, 106), (170, 180), (52, 60)]

    frames = []
    for f in range(8):
        ph = f / 8 * 2 * math.pi
        cv = base.copy()
        # light rays: slanted shafts of lighter water, dithered, fading with depth, swaying a little
        for (rx0, wdt) in rays:
            sway = math.sin(ph + rx0) * 1.5
            for y in range(0, 84):
                fade = 1 - y / 84
                x0 = rx0 + y * 0.35 + sway
                for x in range(int(x0), int(x0 + wdt)):
                    c = cv.get(x, y)
                    core = x - x0 > 1 and x0 + wdt - x > 2
                    if c in lighter and dith(x, y, fade * (0.85 if core else 0.4)):
                        cv.set(x, y, lighter[c])
        # surface shimmer
        for x in range(W):
            if math.sin(x * 0.45 + ph) + math.sin(x * 0.17 - ph * 2) > 0.9:
                cv.set(x, 0, foam)
            elif math.sin(x * 0.3 - ph) > 0.6:
                cv.set(x, 1, wat[4])
        # kelp, three pixels wide, lit on the left, swaying with the current; broad blades
        for (kx, ky, kh, kp) in kelps:
            for i in range(kh):
                y = ky - i
                off = math.sin(ph + kp + i * 0.08) * (i / kh) * 4
                x = int(round(kx + off))
                cv.set(x - 1, y, kelp[2]); cv.set(x, y, kelp[1]); cv.set(x + 1, y, kelp[0])
                if i % 8 == 4 and i < kh - 3:
                    side = 1 if (i // 8) % 2 else -1
                    for j in range(5):
                        bx = x + side * (2 + j)
                        cv.set(bx, y - j // 2, kelp[2] if j < 4 else kelp[3])
                        cv.set(bx, y - j // 2 + 1, kelp[1])
            tx = int(round(kx + math.sin(ph + kp + kh * 0.08) * 4))
            cv.set(tx, ky - kh, kelp[3])
        # an anemone on the right rock: tentacles sway, their tips catch the light
        for k in range(9):
            bx = 140 + k * 2
            sw = math.sin(ph + k * 0.7)
            for j in range(6):
                x = bx + int(round(sw * j / 3))
                cv.set(x, 90 - j, pink[2] if j < 5 else pink[3])
        cv.hline(139, 157, 91, pink[1])
        cv.hline(140, 156, 92, pink[0])
        # bubbles rise 4 px a frame over a 32-px repeat, so the loop is seamless
        for (bx, by, k) in bub:
            x = int(bx)
            if not any(z0 <= x <= z1 for z0, z1 in zones):
                continue
            y = int(by - f * 4)
            if not 6 <= y <= 88:
                continue
            x += int(math.sin(y * 0.4) * 1.5)
            if k > 0.6:
                cv.set(x, y, foam); cv.set(x + 1, y, wat[4]); cv.set(x, y + 1, wat[4]); cv.set(x + 1, y + 1, wat[3])
            else:
                cv.set(x, y, wat[4])
        # the fish: brand-orange body, cream bands with dark edges, flapping tail, gentle bob
        fx = 112
        fy = 40 + [0, 0, 1, 1, 1, 0, 0, 0][f]
        body = ["....KKKKK.......",
                "..KKOOWKOKK.....",
                ".KOOOOWKOOOKK...",
                "KeOOOOWKOOOOOK..",
                "KOOOOOWKOOOOOK..",
                "KOOOOOWKOOOOOK..",
                ".KoOOOWKOOOoK...",
                "..KKooWKooKK....",
                "....KKKKKK......"]
        cv.stamp(fx, fy, body, {"K": org[0], "O": BRAND, "o": org[1], "W": "#fff2d8", "e": wat[0]})
        tail = [["K..", "KOK", "KOOK", "KOOK", "KOK", "K.."],
                ["...", "KK.", "KOK", "KOK", "KK.", "..."]][f % 2]
        cv.stamp(fx + 13, fy + 1, tail, {"K": org[0], "O": org[1]})
        cv.set(fx + 3, fy + 2, "#ffd9b8")
        # fins
        cv.set(fx + 7, fy - 1, org[1]); cv.set(fx + 8, fy - 1, org[1])
        # a far school of small fish, dark against the water, nudging forward
        for (sx, sy) in ((40, 30), (46, 27), (49, 33), (55, 29), (36, 35), (60, 34), (64, 28)):
            sx -= (f % 4 > 1)
            cv.set(sx, sy, wat[0]); cv.set(sx + 1, sy, wat[0]); cv.set(sx + 2, sy, wat[1]); cv.set(sx + 3, sy - 1 + (f % 2), wat[1])
        frames.append(cv)
    n = push(a, frames, 130)
    print(slug, "colours:", n)
    return slug, "Coral Reef", "animation"


# ---------------------------------------------------------------- 3. blossom shrine


def canopy(cv, parts, shades, seed, speckle=None, clump=(4, 8), density=0.05):
    """A tree canopy as many round clumps, each lit from the top-left, drawn top to bottom so lower clumps overlap
    upper ones; clumps toward the top-left of the canopy come out a shade lighter. shades: darkest first."""
    r = random.Random(seed)
    m = blob(parts)
    xs = [x for x, _ in m]
    ys = [y for _, y in m]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pts = sorted(m)
    blobs = [(cx, cy, r.uniform(*clump)) for (cx, cy) in r.sample(pts, max(6, int(len(pts) * density)))]
    blobs.sort(key=lambda b: b[1])
    n = len(shades)
    # fill the mass first in the middle shade so no gaps show between clumps
    for (x, y) in m:
        cv.set(x, y, shades[1])
    for (cx, cy, rr) in blobs:
        g = ((cx - x0) / max(1, x1 - x0) + (cy - y0) / max(1, y1 - y0)) / 2   # 0 top-left .. 1 bottom-right
        for y in range(int(cy - rr) - 1, int(cy + rr) + 2):
            for x in range(int(cx - rr) - 1, int(cx + rr) + 2):
                dx, dy = (x + 0.5 - cx) / rr, (y + 0.5 - cy) / rr
                if dx * dx + dy * dy > 1:
                    continue
                l = (sphere_light(dx, dy) + 0.5) / 1.5 - g * 0.45 + 0.1
                i = int(max(0, min(0.999, l)) * (n - 1) + 0.5)
                cv.set(x, y, shades[i])
    if speckle:
        for (x, y) in m:
            if r.random() < 0.025 and cv.get(x, y) in shades[2:]:
                cv.set(x, y, speckle)
    return m


def trunk(cv, pts, width, shades):
    """A trunk/branch along points, `width` pixels thick, lit on the left."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i / steps
            y = y0 + (y1 - y0) * i / steps
            wv = width if isinstance(width, (int, float)) else width(y)
            for k in range(int(wv)):
                c = shades[2] if k == 0 else shades[0] if k == int(wv) - 1 else shades[1]
                cv.set(x + k - int(wv) // 2, y, c)


def scene_shrine(a):
    slug = "scene-shrine"
    start(a, "Blossom Shrine")
    skyc = ["#56619e", "#7c7cb8", "#a98cc0", "#d9a2b8", "#f4bfa8", "#ffdcb4"]
    far = ramp(a, "#8f8cc0", 3, 8)
    mid = ramp(a, "#4c5488", 3, 10)
    pine = ramp(a, "#33506a", 3, 10)
    bloom = ramp(a, "#ec9ab4", 5, 10)
    bark = ramp(a, "#5a3a3c", 3, 12)
    red = ramp(a, "#d2402c", 4, 10)
    stone = ramp(a, "#a7a2a6", 4, 10)
    grass = ramp(a, "#6a9458", 4, 14)
    sun = "#fff1d4"

    base = Canvas()
    bands(base, 0, 66, skyc, jitter=lambda x: Noise(61)(x, 26, 2))
    # the low sun, with a dithered glow
    for y in range(10, 60):
        for x in range(70, 124):
            d = math.hypot(x + 0.5 - 96, y + 0.5 - 31)
            if d < 7:
                base.set(x, y, sun)
            elif d < 10 and dith(x, y, 0.5):
                base.set(x, y, sun)
            elif d < 16 and dith(x, y, 0.25) and base.get(x, y) in skyc[3:]:
                base.set(x, y, skyc[5])
    # thin clouds across the sun
    for (cx, cy, ln) in ((40, 22, 30), (120, 16, 40), (150, 34, 26), (88, 46, 22)):
        for i in range(ln):
            base.set(cx + i, cy, skyc[5] if i % 9 else skyc[4])
            if 3 < i < ln - 4:
                base.set(cx + i + 2, cy + 1, skyc[4])
    # mountains: far (pale), mid, then a dark pine ridge
    ridge(base, Noise(62), 62, 22, far[1], scale=26, octaves=3, y_max=80)
    ridge(base, Noise(63), 68, 12, mid[1], scale=18, octaves=3, y_max=84)
    tops = ridge(base, Noise(64), 73, 5, pine[1], scale=5, octaves=2, y_max=86)
    for x in range(W):                     # pointed pine tips along the ridge
        if x % 5 == 2:
            for k in range(1, 4):
                base.set(x, tops[x] - k, pine[1])
                if k < 3:
                    base.set(x - 1, tops[x] - k + 1, pine[1]); base.set(x + 1, tops[x] - k + 1, pine[1])
    # terrace and slopes
    for x in range(W):
        top = 78 + int(abs(x - 96) ** 1.5 / 140)
        for y in range(top, H):
            base.set(x, y, grass[1] if y > top else grass[3])
            if y > top and noise2(x, y, 65, 7) + (1 - (y - top) / 30) * 0.25 > 0.66:
                base.set(x, y, grass[2])
    base.hline(54, 138, 78, stone[3])
    base.rect(54, 79, 138, 80, stone[1])
    # stone steps down to the bottom edge, widening
    for k, y in enumerate(range(81, H, 4)):
        hw = 16 + k * 3
        base.rect(96 - hw, y, 96 + hw, y + 1, stone[2])
        base.rect(96 - hw, y + 2, 96 + hw, y + 3, stone[1])
        base.hline(96 - hw, 96 + hw, y, stone[3])
        base.set(96 - hw, y + 2, stone[0]); base.set(96 + hw, y + 2, stone[0])
        base.set(96 - hw, y + 3, stone[0]); base.set(96 + hw, y + 3, stone[0])
    # the gate: two pillars, a lower beam, and a top beam with upturned ends
    for px in (79, 110):
        base.rect(px, 47, px + 3, 78, red[2])
        base.vline(px, 47, 78, red[3])
        base.vline(px + 3, 47, 78, red[1])
        base.rect(px - 1, 75, px + 4, 78, bark[0])        # dark footings
        base.hline(px - 1, px + 4, 75, bark[1])
    base.rect(74, 52, 118, 54, red[2]); base.hline(74, 118, 52, red[3]); base.hline(74, 118, 54, red[1])
    base.rect(70, 42, 122, 44, red[2]); base.hline(70, 122, 42, red[3]); base.hline(71, 121, 44, red[1])
    base.rect(68, 39, 124, 41, bark[0]); base.hline(69, 123, 39, bark[1])
    for (x, y) in ((66, 37), (67, 38), (125, 38), (126, 37)):
        base.set(x, y, bark[0])
    base.rect(93, 45, 99, 51, bark[0]); base.rect(94, 46, 98, 50, red[0])      # name plaque, gold marks
    base.set(96, 47, "#e8b34a"); base.set(96, 49, "#e8b34a")
    # stone lanterns either side, their windows lit in the brand orange
    for lx in (58, 128):
        base.rect(lx + 2, 70, lx + 4, 77, stone[1]); base.vline(lx + 2, 70, 77, stone[2])
        base.rect(lx, 64, lx + 6, 69, stone[2]); base.rect(lx + 2, 65, lx + 4, 67, BRAND)
        base.set(lx + 3, 66, "#ffd08a")
        base.rect(lx - 1, 62, lx + 7, 63, stone[3]); base.rect(lx + 2, 60, lx + 4, 61, stone[2])
        base.hline(lx - 1, lx + 7, 69, stone[0])
    # cherry trees framing the gate
    trunk(base, [(18, 108), (20, 92), (26, 76), (34, 58), (38, 44)], lambda y: 8 if y > 92 else 6 if y > 72 else 4, bark)
    trunk(base, [(30, 64), (48, 52), (58, 44)], 2, bark)
    trunk(base, [(176, 108), (174, 90), (166, 72), (158, 54), (154, 40)], lambda y: 8 if y > 92 else 6 if y > 72 else 4, bark)
    trunk(base, [(164, 66), (146, 54), (138, 48)], 2, bark)
    canopy(base, [(30, 26, 30, 18), (10, 36, 12, 10), (54, 40, 16, 10), (44, 14, 18, 12), (12, 12, 16, 12)], bloom, 66, speckle=sun)
    canopy(base, [(164, 24, 30, 18), (186, 38, 14, 12), (140, 38, 16, 10), (150, 12, 18, 12), (184, 10, 14, 12)], bloom, 67, speckle=sun)
    # fallen petals on the grass and steps
    r = random.Random(68)
    for _ in range(90):
        x, y = r.randrange(W), r.randrange(80, H)
        if base.get(x, y) in grass + stone[1:]:
            base.set(x, y, bloom[3] if r.random() < 0.6 else bloom[2])

    petals = lattice(69, 28, 24, 4)
    frames = []
    for f in range(8):
        ph = f / 8 * 2 * math.pi
        cv = base.copy()
        for (px, py, k) in petals:
            y = int(py + f * 3)
            x = int(px + math.sin(ph + k * 6.28) * 2.5)
            if not 0 <= y < H:
                continue
            c = bloom[4] if k > 0.5 else bloom[3]
            cv.set(x, y, c)
            if (f + int(k * 8)) % 4 < 2:      # the petal flutters: wide, then edge-on
                cv.set(x + 1, y, bloom[2])
        frames.append(cv)
    n = push(a, frames, 140)
    print(slug, "colours:", n)
    return slug, "Blossom Shrine", "animation"


# ---------------------------------------------------------------- 4. rainy café

FONT = {"C": ["###", "#..", "#..", "#..", "###"], "A": [".#.", "#.#", "###", "#.#", "#.#"],
        "F": ["###", "#..", "##.", "#..", "#.."], "E": ["###", "#..", "##.", "#..", "###"],
        "O": ["###", "#.#", "#.#", "#.#", "###"], "P": ["###", "#.#", "###", "#..", "#.."],
        "N": ["#.#", "###", "###", "#.#", "#.#"]}


def text(cv, x, y, word, c):
    for ch in word:
        cv.stamp(x, y, FONT[ch], {"#": c})
        x += 4


def scene_rain(a):
    slug = "scene-rain"
    start(a, "Rainy Café")
    night = ramp(a, "#2a2650", 4, 10)
    haze = ramp(a, "#4a3f6e", 3, 10)
    brick = ramp(a, "#6a3640", 4, 10)
    teal = ramp(a, "#2f5a5a", 4, 12)
    warm = ramp(a, "#f0a040", 4, 12)        # window light
    road = ramp(a, "#2b2a3e", 3, 8)
    cream = "#ffe9c4"
    rainc, rainb = "#8fa0c8", "#c8d4f0"
    lamp = cream
    teal[0] = night[0]
    road[0] = night[0]

    base = Canvas()
    bands(base, 0, 70, [night[0], night[1], night[1], haze[0]], jitter=lambda x: Noise(71)(x, 24, 2))
    # far city: hazy blocks with a few dim windows
    r = random.Random(72)
    x = 0
    while x < W:
        w, h = r.randint(10, 22), r.randint(18, 46)
        base.rect(x, 70 - h, x + w - 1, 86, haze[1])
        for wy in range(70 - h + 4, 82, 5):
            for wx in range(x + 2, x + w - 2, 4):
                if r.random() < 0.25:
                    base.set(wx, wy, warm[0]); base.set(wx + 1, wy, warm[0])
        x += w + r.randint(0, 3)
    # left building: brick, with a lit upstairs window
    base.rect(0, 16, 46, 88, brick[1])
    for y in range(18, 88, 3):
        off = 0 if (y // 3) % 2 else 3
        for bx in range(off, 46, 6):
            base.set(bx, y, brick[0])
        base.hline(0, 45, y + 2, brick[0]) if y % 9 == 0 else None
    base.vline(46, 16, 88, brick[0])
    base.rect(0, 14, 47, 16, brick[2]); base.hline(0, 47, 14, brick[3])
    base.rect(14, 30, 28, 46, night[0]); base.rect(15, 31, 27, 45, warm[1]); base.rect(16, 32, 26, 44, warm[2])
    base.vline(21, 31, 45, brick[0]); base.hline(15, 27, 38, brick[0])
    base.hline(13, 29, 47, brick[3])
    # right building
    base.rect(146, 8, 191, 88, night[1])
    for wy in (16, 34, 52):
        for wx in (154, 170, 184):
            base.rect(wx, wy, wx + 6, wy + 10, night[0])
            if (wx + wy) % 3 == 0:
                base.rect(wx + 1, wy + 1, wx + 5, wy + 9, warm[0]); base.rect(wx + 1, wy + 6, wx + 5, wy + 9, warm[1])
    base.vline(146, 8, 88, night[0])
    # the café front
    base.rect(50, 26, 142, 88, teal[1])
    base.vline(50, 26, 88, teal[2]); base.vline(142, 26, 88, teal[0])
    base.rect(48, 22, 144, 26, teal[0]); base.hline(48, 144, 22, teal[2])
    # sign board
    base.rect(76, 29, 116, 37, teal[0]); base.rect(77, 30, 115, 36, night[0])
    text(base, 83, 31, "CAFE", cream)
    text(base, 101, 31, "OP", BRAND)
    # awning: brand-orange and cream stripes with a scalloped edge and a shadowed underside
    for y in range(40, 47):
        for x in range(54, 139):
            stripe = ((x - 54) // 5) % 2
            c = BRAND if stripe == 0 else cream
            if y >= 45:
                c = "#a8321a" if stripe == 0 else "#d8b890"
            base.set(x, y, c)
    for x in range(54, 139):
        if (x - 54) % 5 in (1, 2, 3):
            base.set(x, 47, "#a8321a" if ((x - 54) // 5) % 2 == 0 else "#d8b890")
    base.hline(53, 139, 39, "#7a1e14")
    # the window, warm inside: lamps, counter, a customer's silhouette, plants
    base.rect(56, 51, 116, 83, teal[0])
    base.rect(58, 53, 114, 81, warm[2])
    for y in range(53, 82):                   # brighter at the top where the lamps hang
        for x in range(58, 115):
            if y < 62 or (y < 66 and dith(x, y, 0.5)):
                base.set(x, y, warm[3])
    for lx in (68, 86, 104):
        base.vline(lx, 53, 57, teal[0])
        base.rect(lx - 2, 58, lx + 2, 59, teal[0]); base.hline(lx - 1, lx + 1, 60, lamp)
    base.rect(58, 72, 114, 81, warm[1]); base.hline(58, 114, 72, warm[0])   # counter
    base.rect(60, 66, 62, 71, warm[0]); base.rect(59, 64, 63, 66, "#4f8a4a")   # potted plant
    base.set(60, 63, "#4f8a4a"); base.set(62, 63, "#4f8a4a")
    # a customer at the counter, in silhouette, with a steaming cup
    base.disc(94.5, 59.5, 3, teal[0])
    for y in range(63, 72):
        hw = 3 if y == 63 else 4 if y == 64 else 5
        base.hline(95 - hw, 94 + hw, y, teal[0])
    base.rect(99, 68, 101, 71, cream)
    base.vline(86, 53, 81, teal[0])           # mullion
    base.hline(58, 114, 66, teal[0]) if False else None
    base.hline(55, 117, 84, teal[2])          # sill
    # door
    base.rect(122, 52, 136, 86, teal[0])
    base.rect(124, 54, 134, 70, warm[1]); base.rect(125, 55, 133, 62, warm[2])
    base.rect(124, 72, 134, 85, teal[1]); base.set(132, 78, warm[3])
    # sidewalk, curb, wet road
    base.rect(0, 88, W - 1, 94, road[1])
    for x in range(0, W, 12):
        base.vline(x, 89, 94, road[0])
    base.hline(0, W - 1, 88, haze[1])
    for x in range(50, 143):                 # the window's light spills onto the wet pavement
        for y in range(89, 95):
            if dith(x, y, 0.5 - (y - 89) * 0.07) and base.get(x, y) == road[1]:
                base.set(x, y, warm[0])
    base.rect(0, 95, W - 1, 96, haze[1])
    base.rect(0, 97, W - 1, H - 1, road[0])
    # reflections of the window and the lamp in the wet road: broken vertical streaks
    for x in range(56, 118):
        for y in range(97, H):
            if (x * 7 + y * 3) % 5 < 3 and dith(x, y, 0.55 - (y - 97) * 0.03):
                base.set(x, y, warm[1] if 60 < x < 112 else warm[0])
    for x in range(30, 40):
        for y in range(97, H):
            if dith(x, y, 0.4) and (x + y) % 3:
                base.set(x, y, warm[2] if 33 < x < 37 else warm[0])
    # street lamp
    base.rect(33, 30, 35, 94, night[0]); base.vline(33, 30, 94, haze[2])
    base.rect(31, 92, 37, 94, night[0])
    base.rect(29, 22, 39, 24, night[0]); base.rect(30, 25, 38, 29, lamp); base.hline(30, 38, 29, warm[3])
    base.hline(31, 37, 21, night[0]); base.set(34, 20, night[0])
    for y in range(14, 46):
        for x in range(18, 52):
            d = math.hypot(x - 34, (y - 28) * 1.2)
            c = base.get(x, y)
            if 6 < d < 10 and c not in (night[0], lamp) and dith(x, y, 0.3 * (1 - (d - 6) / 4)):
                base.set(x, y, warm[2])
    # a black cat sheltering under the awning
    cat = ["K...K..",
           "KK.KK..",
           "KeKeK..",
           "KKKKK..",
           ".KKKK.K",
           ".KKKKK.",
           ".KKKK..",
           ".K.K..."]
    base.stamp(118, 81, cat, {"K": night[0], "e": "#ffd23a"})
    # puddles
    puddles = [(70, 101, 12, 3), (150, 104, 14, 3), (20, 99, 8, 2)]
    for (px, py, rx, ry) in puddles:
        base.ellipse(px, py, rx, ry, road[1])
        base.hline(px - rx + 3, px - 2, py - 1, haze[2])

    rain = lattice(73, 24, 48, 6)
    frames = []
    for f in range(6):
        cv = base.copy()
        # ripples grow in each puddle, one ring per frame, out of phase
        for k, (px, py, rx, ry) in enumerate(puddles):
            rr = ((f + k * 2) % 6) / 5
            if rr > 0:
                for t in range(0, 360, 8):
                    x = px + math.cos(math.radians(t)) * rx * rr * 0.8
                    y = py + math.sin(math.radians(t)) * ry * rr * 0.8
                    cv.set(x, y, rainb if rr < 0.6 else rainc)
        # rain: slanted 4-px streaks falling 8 px a frame; the pattern repeats every 48 px, so 6 frames loop
        for (rx0, ry0, k) in rain:
            x0, y0 = rx0 + f * 4, ry0 + f * 8
            for j in range(4 if k > 0.3 else 3):
                x, y = int(x0 + j / 2), int(y0 + j)
                c = cv.get(x, y)
                if c is None:
                    continue
                bright = c in (warm[2], warm[3], lamp)
                cv.set(x, y, rainb if bright or j == 3 else rainc)
        # splashes on the pavement and road, different each frame
        rs = random.Random(80 + f)
        for _ in range(10):
            x, y = rs.randrange(4, W - 4), rs.choice([89, 90, 92, 98, 100, 103, 106])
            cv.set(x - 1, y - 1, rainc); cv.set(x + 1, y - 1, rainc); cv.set(x, y, rainb)
        frames.append(cv)
    n = push(a, frames, 90)
    print(slug, "colours:", n)
    return slug, "Rainy Café", "animation"


# ---------------------------------------------------------------- 5. volcano island


def palm(cv, x, y, h, lean, trunkc, leaf, seed):
    """A palm: a segmented curved trunk and drooping fronds, lit from the left."""
    r = random.Random(seed)
    pts = []
    for i in range(h):
        t = i / h
        px = x + lean * t * t * h * 0.5
        pts.append((px, y - i))
        cv.set(px, y - i, trunkc[1] if i % 3 else trunkc[0])
        cv.set(px + 1, y - i, trunkc[0])
    tx, ty = pts[-1]
    for k, ang in enumerate((-170, -140, -110, -70, -40, -10, 200)):
        ln = r.randint(9, 13)
        a0 = math.radians(ang)
        for j in range(ln):
            droop = (j / ln) ** 2 * 6
            fx = tx + math.cos(a0) * j
            fy = ty + math.sin(a0) * j * 0.6 + droop
            cv.set(fx, fy, leaf[1] if j < ln - 2 else leaf[0])
            if j % 2 == 0 and 1 < j < ln - 1:
                cv.set(fx, fy + 1, leaf[0])
            if j < ln - 3 and math.cos(a0) < 0:
                cv.set(fx, fy - 1, leaf[2])
    cv.set(tx, ty, leaf[2]); cv.set(tx + 1, ty + 1, trunkc[0])


def scene_volcano(a):
    slug = "scene-volcano"
    start(a, "Volcano Island")
    skyc = ["#2b1d4f", "#5a2a6a", "#9a3a6a", "#d85a5a", "#f28a4a", "#ffc070"]
    rockr = ramp(a, "#4a3448", 4, 12)
    smoke = ramp(a, "#7a6a88", 4, 10)
    jung = ramp(a, "#2f5a3e", 4, 14)
    sand = ramp(a, "#d8a070", 3, 10)
    sea = ramp(a, "#3a3a78", 4, 12)
    lava = ["#7a1e14", BRAND, "#ffa040", "#fff0a0"]
    trunkc = ramp(a, "#7a4a3a", 2, 10)
    sun = "#fff4c8"
    rockr[0] = sea[0]

    cv = Canvas()
    hz = 64
    bands(cv, 0, hz, skyc, jitter=lambda x: Noise(81)(x, 30, 2), edge=0.4)
    # setting sun
    for y in range(hz - 16, hz + 1):
        for x in range(40, 80):
            d = math.hypot(x + 0.5 - 58, y + 0.5 - hz)
            if d < 11:
                cv.set(x, y, sun if d < 9 else skyc[5])
    # long cloud streaks, lit underneath by the sun
    for (cx, cy, ln) in ((8, 40, 46), (30, 46, 30), (100, 34, 54), (6, 22, 36), (150, 50, 30)):
        cv.hline(cx, cx + ln, cy, skyc[2])
        cv.hline(cx + 4, cx + ln - 6, cy - 1, skyc[2])
        cv.hline(cx + 2, cx + ln - 3, cy + 1, skyc[4] if cy > 30 else skyc[3])
    # far islands on the horizon
    ridge(cv, Noise(82), hz, 6, skyc[1], scale=10, octaves=2, x0=0, x1=40, y_max=hz)
    ridge(cv, Noise(83), hz, 4, skyc[1], scale=8, octaves=2, x0=74, x1=96, y_max=hz)
    # the volcano: a cone with a broken top, form-shaded by the low sun from the left
    cone = set()
    nzv = Noise(84)
    for x in range(86, W):
        dx = abs(x - 144)
        top = 20 + dx * 0.78 + (nzv(x, 6, 2) - 0.5) * 6
        if dx < 9:
            top = 22 + (9 - dx) * 0.4               # the crater notch
        for y in range(int(top), hz + 4):
            cone.add((x, y))
    shade_mask(cv, cone, rockr, 85, reach=26, tex=0.2, light=(-1, 0))
    # ridges/gullies down the slopes
    for gx in (118, 132, 156, 170):
        for y in range(30, hz):
            x = gx + (gx - 144) * (y - 30) / 60 + math.sin(y * 0.3 + gx) * 1.2
            if (int(x), y) in cone:
                cv.set(x, y, rockr[0] if gx > 144 else rockr[1])
    # the crater glow and lava rivers
    cv.hline(137, 151, 23, lava[1]); cv.hline(139, 149, 24, lava[2]); cv.hline(141, 147, 22, lava[3])
    for (sx, drift, ln) in ((140, -0.55, 30), (149, 0.45, 36), (145, 0.08, 22)):
        x = sx
        for i in range(ln):
            y = 25 + i
            x += drift + math.sin(i * 0.5 + sx) * 0.6
            if (int(x), y) not in cone:
                break
            cv.set(x, y, lava[1])
            cv.set(x + 1, y, lava[2] if i < ln * 0.6 else lava[1])
            if i < 8:
                cv.set(x + 1, y, lava[3])
            cv.set(x - 1, y, lava[0])
    # smoke plume drifting right: clumps, darker underneath
    canopy(cv, [(148, 14, 10, 7), (162, 9, 13, 7), (180, 6, 14, 7), (140, 8, 7, 5)], smoke, 86, clump=(3, 6))
    # sea: bands darkening toward the viewer, reflections of the sun and the lava, sparkles
    bands(cv, hz + 1, H - 1, [skyc[2], sea[2], sea[1], sea[1], sea[0]], jitter=lambda x: Noise(89)(x, 14, 2))
    r = random.Random(90)
    for y in range(hz + 1, H):
        depth = (y - hz) / (H - hz)
        # the sun's glitter column
        half = 6 + depth * 10
        for x in range(int(58 - half), int(58 + half)):
            if r.random() < 0.42 - depth * 0.3 - abs(x - 58) / half * 0.2 and y % 2 == 0:
                cv.set(x, y, sun if r.random() < 0.4 else skyc[5])
        # lava glow, under the volcano
        if y > hz + 8:
            for x in range(132, 158):
                if r.random() < 0.16 - depth * 0.1 and y % 2 == 1:
                    cv.set(x, y, lava[1] if r.random() < 0.6 else lava[2])
        # wave dashes
        for _ in range(3 if depth < 0.5 else 2):
            x = r.randrange(W)
            ln = r.randint(3, 7)
            cv.hline(x, x + ln, y, skyc[3] if depth < 0.4 else sea[2] if depth > 0.7 else sea[3])
    # island: jungle at the foot, beach in front, palms
    jmask = set()
    for x in range(64, W):
        top = hz - 4 - Noise(87)(x, 5, 2) * 6 - (8 if x < 100 else 0) * max(0, (100 - x) / 36)
        for y in range(int(top), hz + 6):
            jmask.add((x, y))
    canopy(cv, [(86, hz - 1, 22, 4), (130, hz, 46, 3), (180, hz, 16, 3)], jung, 88, clump=(2, 4), density=0.12)
    # beach where the island meets the sea, a thin line of surf below it
    for x in range(62, W):
        cv.set(x, hz + 3, sand[2])
        cv.set(x, hz + 4, sand[1])
        cv.set(x, hz + 5, sun if (x // 3) % 3 == 0 else sand[0])
    palm(cv, 72, hz + 3, 18, -1.2, trunkc, jung, 1)
    palm(cv, 84, hz + 3, 22, -0.6, trunkc, jung, 2)
    palm(cv, 96, hz + 3, 15, 0.8, trunkc, jung, 3)
    n = push(a, [cv], 0)
    print(slug, "colours:", n)
    return slug, "Volcano Island", "sprite"


# ---------------------------------------------------------------- 6. autumn path


def scene_autumn(a):
    slug = "scene-autumn"
    start(a, "Autumn Path")
    skyc = ["#6aa0d8", "#8cbce0", "#b4d4e4", "#e8e0c8"]
    hazec = ramp(a, "#c8a088", 3, 8)          # far trees, pale and cool-warm
    amber = ramp(a, "#e09a3a", 5, 12)         # mid trees
    redl = ramp(a, "#c8482c", 5, 12)          # near trees
    bark = ramp(a, "#4e3632", 3, 12)
    meadow = ramp(a, "#b0a050", 4, 14)
    dirt = ramp(a, "#a87850", 4, 10)
    wood = ramp(a, "#8a5a3a", 3, 10)
    cloud = "#f8f4ec"
    wood[1] = dirt[1]
    for rp in (redl, amber, dirt, wood, hazec):   # one shared darkest umber instead of six near-identical ones
        rp[0] = bark[0]

    cv = Canvas()
    hz = 62
    bands(cv, 0, hz, skyc, jitter=lambda x: Noise(91)(x, 26, 2))
    for (cx, cy) in ((70, 14), (120, 22), (100, 8)):
        canopy(cv, [(cx, cy, 14, 4), (cx + 10, cy - 2, 8, 4)], [skyc[2], skyc[3], cloud], 92 + cx, clump=(3, 5))
    # far tree line, pale with distance
    canopy(cv, [(x, hz - 6 - (x % 23) % 7, 12, 8) for x in range(0, W + 12, 14)], hazec, 93, clump=(3, 5), density=0.08)
    # meadow
    bands(cv, hz - 2, H - 1, [meadow[2], meadow[2], meadow[1], meadow[1], meadow[1]], jitter=lambda x: Noise(94)(x, 18, 2))
    rt = random.Random(95)
    for _ in range(260):                      # grass tufts: short darker strokes, bigger toward the viewer
        x, y = rt.randrange(W), rt.randrange(hz + 2, H)
        c = cv.get(x, y)
        if c in meadow[1:]:
            d = meadow[meadow.index(c) - 1]
            cv.set(x, y, d)
            if y > hz + 20:
                cv.set(x, y - 1, d)
                cv.set(x + 1, y, d) if rt.random() < 0.5 else None
    # soft shade under the big trees
    for (sx, sy, rx, ry) in ((14, 100, 30, 6), (180, 100, 30, 6)):
        for (x, y) in blob([(sx, sy, rx, ry)]):
            if cv.get(x, y) in meadow[1:] and dith(x, y, 0.5):
                cv.set(x, y, meadow[0])
    # mid trees, amber
    for (tx, h) in ((58, 26), (82, 20), (128, 22), (148, 28)):
        trunk(cv, [(tx, hz + 4), (tx, hz + 4 - h)], 2, bark)
    for (tx, h) in ((58, 26), (82, 20), (128, 22), (148, 28)):
        canopy(cv, [(tx, hz - h + 2, 11, 10), (tx - 6, hz - h + 8, 7, 6), (tx + 6, hz - h + 8, 7, 6)], amber, 96 + tx,
               clump=(3, 6), density=0.07, speckle=amber[4])
    # the path: a dirt road winding up to the trees, wide in front, narrowing to the horizon
    path = {}
    for y in range(hz + 2, H):
        t = (y - hz - 2) / (H - hz - 3)
        c = 102 + math.sin(t * 3.4 + 0.6) * 18 * t - 10 * t
        w = 2 + t ** 1.5 * 42
        path[y] = (c - w, c + w)
        for x in range(int(c - w), int(c + w) + 1):
            e = min(x - (c - w), (c + w) - x)
            col = dirt[2] if e > 2 else dirt[1]
            # wheel ruts
            if t > 0.25 and abs(abs(x - c) - w * 0.45) < 0.8 + t:
                col = dirt[1]
            if noise2(x, y, 97, 3) > 0.75:
                col = dirt[3]
            cv.set(x, y, col)
        cv.set(c - w - 1, y, dirt[0]); cv.set(c + w + 1, y, meadow[0])
    # light: dithered sunbeams from the top left across the scene
    lit = {skyc[1]: skyc[2], meadow[1]: meadow[2], meadow[2]: meadow[3], dirt[2]: dirt[3], hazec[1]: hazec[2]}
    for y in range(0, H):
        for x in range(W):
            b = (x - y * 0.8) % 46
            if b < 7 and cv.get(x, y) in lit and dith(x, y, 0.3 * (1 - y / H)):
                cv.set(x, y, lit[cv.get(x, y)])
    # fence along the left of the path
    for k in range(7):
        y = hz + 6 + int(k ** 1.45 * 3)
        if y >= H:
            break
        x0 = int(path[min(H - 1, y)][0]) - 4 - k * 2
        hgt = 3 + k
        cv.vline(x0, y - hgt, y, wood[1]); cv.set(x0, y - hgt, wood[2])
        cv.vline(x0 + 1, y - hgt, y, wood[0])
        if k:
            px, py, ph = prev
            cv.line(px + 1, py - ph + 1, x0, y - hgt + 1, wood[1])
            cv.line(px + 1, py - ph // 2, x0, y - hgt // 2, wood[0])
        prev = (x0, y, hgt)
    # pumpkins by the path, the near one in the brand orange
    def pumpkin(x, y, rx, body):
        shaded_ellipse(cv, x, y, rx, rx * 0.72, body)
        for dx in (-rx // 2, rx // 2):
            cv.vline(x + dx, y - rx * 0.5, y + rx * 0.5, body[1])
        cv.rect(x, y - rx * 0.72 - 2, x, y - rx * 0.72 - 1, "#4e6a30"); cv.set(x + 1, y - rx * 0.72 - 2, "#4e6a30")
    pumpkin(150, 98, 6, [redl[0], redl[1], BRAND, "#ffb27a"])
    pumpkin(162, 101, 4, [redl[0], redl[1], amber[2], amber[3]])
    pumpkin(132, 76, 3, [redl[0], redl[1], amber[2], amber[3]])
    # near trees framing both sides, red-orange
    trunk(cv, [(10, H), (12, 80), (8, 50), (14, 20)], lambda y: 10 if y > 90 else 8 if y > 60 else 6, bark)
    trunk(cv, [(12, 62), (30, 44)], 3, bark)
    trunk(cv, [(184, H), (180, 84), (186, 50), (178, 22)], lambda y: 10 if y > 90 else 8 if y > 60 else 6, bark)
    trunk(cv, [(182, 66), (164, 46)], 3, bark)
    canopy(cv, [(16, 14, 26, 18), (40, 32, 14, 10), (4, 40, 10, 10), (34, 4, 20, 10)], redl, 98, clump=(4, 8),
           speckle=amber[4])
    canopy(cv, [(176, 12, 26, 18), (156, 30, 14, 10), (190, 40, 10, 10), (156, 4, 20, 10)], redl, 99, clump=(4, 8),
           speckle=amber[4])
    # fallen leaves on the meadow and the path, and a few in the air
    r = random.Random(100)
    leafc = [redl[2], redl[3], amber[2], amber[3], BRAND]
    for _ in range(170):
        x, y = r.randrange(W), r.randrange(hz + 4, H)
        if cv.get(x, y) in meadow + dirt:
            c = r.choice(leafc)
            cv.set(x, y, c)
            if r.random() < 0.4:
                cv.set(x + 1, y, c)
    for (x, y) in ((60, 30), (96, 44), (120, 36), (138, 54), (76, 50), (110, 20)):
        cv.set(x, y, redl[3]); cv.set(x + 1, y + 1, redl[2])
    n = push(a, [cv], 0)
    print(slug, "colours:", n)
    return slug, "Autumn Path", "sprite"


# ---------------------------------------------------------------- 7. lighthouse


def scene_lighthouse(a):
    slug = "scene-lighthouse"
    start(a, "Lighthouse")
    night = ramp(a, "#26305e", 5, 10)
    sea = ramp(a, "#1c3458", 4, 10)
    rock = ramp(a, "#2c2c46", 4, 12)
    grass = ramp(a, "#2e5446", 3, 12)
    cream = ramp(a, "#d8d0c0", 3, 8)
    stripe = ["#7a1e14", "#c0331a", BRAND]
    glow = ["#f0a040", "#ffd27a", "#fff6d0"]
    moonc = glow[2]
    for rp in (sea, rock, grass):            # one shared darkest night colour
        rp[0] = night[0]
    sea[3] = night[4]
    sea[1] = night[1]
    beam = [rock[2], rock[3], cream[2]]     # the beam reuses the cliff's light shades
    lighter = {}
    for rp in (night, sea):
        for i in range(len(rp) - 1):
            lighter[rp[i]] = rp[i + 1]
    lighter[night[-1]] = glow[2]

    base = Canvas()
    hz = 72
    bands(base, 0, hz, [night[0], night[1], night[1], night[2], night[3]], jitter=lambda x: Noise(101)(x, 22, 2))
    r = random.Random(102)
    stars = [(r.randrange(W), r.randrange(hz - 8), r.random()) for _ in range(70)]
    # crescent moon with a dithered halo
    for y in range(4, 40):
        for x in range(14, 60):
            d = math.hypot(x + 0.5 - 36, y + 0.5 - 20)
            if d < 7 and math.hypot(x + 0.5 - 39, y + 0.5 - 18) > 6:
                base.set(x, y, moonc)
            elif 9 < d < 13 and dith(x, y, 0.2) and base.get(x, y) in night:
                base.set(x, y, lighter[base.get(x, y)])
    # dark cloud wisps
    for (cx, cy, ln) in ((60, 30, 40), (4, 48, 34), (90, 52, 30)):
        base.hline(cx, cx + ln, cy, night[0]); base.hline(cx + 4, cx + ln - 6, cy - 1, night[0])
        base.hline(cx + 3, cx + ln - 2, cy + 1, night[2])
    # far headland, low and cool
    ridge(base, Noise(103), hz, 6, night[1], scale=10, octaves=2, x0=0, x1=60, y_max=hz)
    # the cliff: form-shaded rock lit by the moon from the left, grass on top
    cliff = set()
    nzc = Noise(104)
    for x in range(100, W):
        top = 56 + max(0, (124 - x)) * 2.0 + (nzc(x, 5, 3) - 0.5) * (10 if x < 124 else 4)
        for y in range(int(top), H):
            cliff.add((x, y))
    shade_mask(base, cliff, rock, 105, reach=22, tex=0.25)
    for x in range(100, W):
        ys = [y for (xx, y) in cliff if xx == x]
        if not ys:
            continue
        t = min(ys)
        base.set(x, t, grass[2]); base.set(x, t + 1, grass[1]); base.set(x, t + 2, grass[0] if x % 3 else grass[1])
        if x % 7 == 0:
            base.set(x, t + 3, grass[0])
    # rock strata cracks
    for (x0, y0, x1, y1) in ((114, 80, 128, 86), (140, 90, 160, 94), (170, 70, 186, 76), (124, 98, 140, 104)):
        base.line(x0, y0, x1, y1, rock[0])
    # keeper's cottage
    base.rect(166, 46, 184, 56, cream[1]); base.vline(166, 46, 56, cream[2]); base.vline(184, 46, 56, cream[0])
    for k in range(6):
        base.hline(164 + k, 186 - k, 45 - k, stripe[1] if k < 5 else stripe[0])
    base.hline(164, 186, 45, stripe[0])
    base.rect(170, 49, 174, 53, glow[0]); base.rect(171, 50, 173, 52, glow[1]); base.vline(172, 49, 53, cream[0])
    base.rect(178, 50, 181, 56, rock[0])
    # the lighthouse: a tapering tower in brand-orange and cream bands, lit from the left
    lx, ly_top, ly_bot = 146, 20, 56
    for y in range(ly_top, ly_bot + 1):
        hw = 4 + (y - ly_top) * 2.5 / (ly_bot - ly_top)
        band = ((y - ly_top) // 6) % 2
        ramp_ = stripe if band == 0 else cream
        for x in range(int(lx - hw), int(lx + hw) + 1):
            t = (x - (lx - hw)) / (2 * hw)
            i = 2 if t < 0.35 else 1 if t < 0.75 else 0
            base.set(x, y, ramp_[i])
    base.rect(143, 44, 145, 50, night[0]); base.set(144, 45, glow[0])          # door/window
    base.rect(145, 30, 147, 33, night[0])
    # gallery, lantern room, dome
    base.hline(139, 153, 19, rock[0]); base.hline(139, 153, 18, cream[1])
    for x in range(140, 153, 2):
        base.set(x, 17, rock[0])
    base.hline(139, 153, 16, rock[0])
    base.rect(142, 10, 150, 15, glow[1]); base.rect(144, 11, 148, 14, glow[2])
    base.vline(142, 10, 15, rock[0]); base.vline(150, 10, 15, rock[0]); base.vline(146, 10, 15, glow[0])
    for k in range(4):
        base.hline(142 + k, 150 - k, 9 - k, stripe[1] if k else stripe[0])
    base.set(146, 5, rock[0]); base.set(146, 4, rock[0])
    # rocks at the cliff foot
    for (cx, cy, rx, ry) in ((104, 100, 7, 5), (94, 104, 5, 4), (112, 106, 9, 4)):
        shade_mask(base, blob([(cx, cy, rx, ry)]), rock, cx, reach=6, tex=0.2)

    lamp = (146, 12)
    frames = []
    for f in range(8):
        cv = base.copy()
        th = f / 8 * 2 * math.pi
        # sea: bands, wave dashes drifting 4 px a frame (repeating every 32 px), moon glitter
        for y in range(hz + 1, H):
            depth = (y - hz) / (H - hz)
            for x in range(W):
                if (x, y) in cliff:
                    continue
                c = sea[2] if depth < 0.15 else sea[1] if depth < 0.55 else sea[0]
                if 0.12 < depth < 0.18 and dith(x, y, 0.5):
                    c = sea[1]
                if 0.5 < depth < 0.6 and dith(x, y, 0.5):
                    c = sea[0]
                period = 32
                u = (x + f * 4 + (y * 13) % period) % period
                if u < 3 + depth * 4 and (y % 3 == 0):
                    c = sea[3] if depth < 0.5 else sea[2]
                cv.set(x, y, c)
            # moon glitter column
            half = 4 + depth * 8
            if y % 2 == 0:
                rg = random.Random(y * 31 + f)
                for _ in range(2):
                    x = int(36 + (rg.random() - 0.5) * 2 * half)
                    ln = rg.randint(1, 3)
                    cv.hline(x, x + ln, y, moonc if depth < 0.35 else sea[3])
        # foam at the rocks, breathing
        for (x, y) in ((97, 101), (99, 103), (90, 105), (88, 106), (102, 104), (108, 107), (118, 108)):
            if (f + x) % 4 < 2:
                cv.set(x, y, cream[2])
            if (f + x) % 4 == 1:
                cv.set(x - 1, y + 1, cream[1])
        # stars
        for (x, y, k) in stars:
            if (x, y) not in cliff and cv.get(x, y) in night[:3]:
                if k > 0.8 or (k > 0.4 and (f + int(k * 10)) % 4):
                    cv.set(x, y, night[4] if k < 0.9 else moonc)
        # the beam: turns around the tower; long to the sides, a bright flare when facing us, hidden when facing away
        side, toward = math.cos(th), math.sin(th)
        L = side * 120
        if toward > -0.9:
            strength = 0.75 + 0.25 * toward
            n = int(abs(L))
            for i in range(4, n):
                hw = 1.5 + i * 0.13
                x = lamp[0] + (i if L > 0 else -i)
                fade = strength * (1 - i / max(1, n) * 0.5)
                for dy in range(-int(hw), int(hw) + 1):
                    y = int(lamp[1] + dy + i * 0.05)
                    c = cv.get(x, y)
                    if c not in lighter and c not in beam:
                        continue
                    core = abs(dy) < hw * 0.4
                    if dith(int(x), y, fade * (1 if core else 0.6)):
                        cv.set(x, y, beam[2] if core and fade > 0.75 else beam[1] if core or fade > 0.6 else beam[0])
        flare = max(0.0, toward)
        if flare > 0.3:
            rr = 3 + flare * 6
            for y in range(lamp[1] - 12, lamp[1] + 12):
                for x in range(lamp[0] - 14, lamp[0] + 14):
                    d = math.hypot(x - lamp[0], (y - lamp[1]) * 1.3)
                    c = cv.get(x, y)
                    if d < rr and c in lighter and dith(x, y, (1 - d / rr) * 0.9):
                        cv.set(x, y, lighter[c])
            cv.hline(lamp[0] - int(rr) - 3, lamp[0] + int(rr) + 3, lamp[1], glow[2])
            cv.vline(lamp[0], lamp[1] - int(rr / 1.3) - 2, lamp[1] + int(rr / 1.3) + 2, glow[2])
        # the lamp itself, brightest when facing us
        cv.rect(144, 11, 148, 14, glow[2] if toward > -0.3 else glow[1])
        # its reflection on the sea, a broken streak below the beam's side
        if abs(side) > 0.5 and toward > -0.9:
            rx = lamp[0] + int(L * 0.5)
            for y in range(hz + 2, H, 2):
                for k in range(-3, 4):
                    x = rx + k + ((y * 7) % 5) - 2
                    if (x, y) not in cliff and (x + y + f) % 3 == 0:
                        cv.set(x, y, sea[3])
        frames.append(cv)
    n = push(a, frames, 120)
    print(slug, "colours:", n)
    return slug, "Lighthouse", "animation"


# ---------------------------------------------------------------- 8. voxel cottage


def scene_cottage(a):
    slug = "scene-cottage"
    SX, SY, SZ = 36, 32, 36
    a.call("new_model", size_x=SX + 2, size_y=SY, size_z=SZ + 2, name="Voxel Cottage")   # a 1-voxel margin
    grass = ramp(a, "#5f9a48", 4, 14)
    dirt = ramp(a, "#7a5038", 3, 10)
    stone = ramp(a, "#8a8a96", 3, 10)
    plaster = ramp(a, "#e8dcc4", 3, 8)
    beam = ramp(a, "#5a3a2c", 2, 10)
    roof = ramp(a, "#b04a32", 3, 12)
    leaf = ramp(a, "#3f7a3a", 3, 14)
    glass = "#ffd27a"
    v = {}
    r = random.Random(110)

    def put(x, y, z, c):
        if 0 <= x < SX and 0 <= y < SY and 0 <= z < SZ:
            v[(x, y, z)] = c

    # ground tile: two dirt layers and a grass top with mottled shades
    for x in range(SX):
        for z in range(SZ):
            put(x, 0, z, dirt[0]); put(x, 1, z, dirt[1])
            n = noise2(x, z, 111, 4)
            put(x, 2, z, grass[3] if n > 0.78 else grass[1] if n < 0.35 else grass[2])
    # stepping-stone path from the front edge to the door
    for z in range(22, SZ):
        for x in range(16, 20):
            if (x + z) % 5 != 0:
                put(x, 2, z, stone[2] if (x * 3 + z) % 4 else stone[1])
    # the cottage: stone footing, plaster walls, timber frame
    x0, x1, z0, z1 = 9, 26, 8, 21
    for y in range(3, 12):
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                if x in (x0, x1) or z in (z0, z1):
                    c = plaster[1] if (x + y * 3 + z) % 7 else plaster[2]
                    if y == 3:
                        c = stone[1] if (x + z) % 3 else stone[0]
                    elif (x in (x0, x1) and z in (z0, z1)) or y in (7, 11):
                        c = beam[0]
                    elif x in (x0 + 6, x1 - 6) and z in (z0, z1) or z in (z0 + 6, z1 - 6) and x in (x0, x1):
                        c = beam[1]
                    put(x, y, z, c)
    # gable ends filled up to the ridge
    for k in range(0, 8):
        y = 12 + k
        for z in range(z0 + k + 1, z1 - k):
            for x in (x0, x1):
                put(x, y, z, plaster[1] if k < 6 else beam[0])
    # roof: two sloping planes along x, with an overhang, tile rows alternating shades
    for k in range(0, 9):
        y = 11 + k
        for x in range(x0 - 2, x1 + 3):
            for z in (z0 - 2 + k, z1 + 2 - k):
                if z0 - 2 + k > z1 + 2 - k:
                    continue
                c = roof[1] if k % 2 else roof[2]
                if x in (x0 - 2, x1 + 2):
                    c = roof[0]
                put(x, y, z, c)
        if z0 - 2 + k >= z1 + 2 - k - 1:
            for x in range(x0 - 2, x1 + 3):
                for z in range(z0 - 2 + k, z1 + 3 - k):
                    put(x, y, z, roof[0])
    # chimney
    for y in range(14, 24):
        for x in (21, 22, 23):
            for z in (11, 12, 13):
                put(x, y, z, stone[2] if (x + y + z) % 3 else stone[1])
    put(22, 23, 12, stone[0])
    for x in (20, 24):
        for z in range(10, 15):
            put(x, 23, z, stone[0])
    for z in (10, 14):
        for x in range(20, 25):
            put(x, 23, z, stone[0])
    # door in the brand orange, with a step, and warm windows with sills
    for y in range(4, 10):
        for x in range(16, 20):
            put(x, y, z1, BRAND if y < 9 else beam[0])
    put(19, 6, z1 + 1, "#ffd27a")                       # knob
    for x in range(15, 21):
        put(x, 3, z1 + 1, stone[2])
    for (wx, wz, face) in ((11, z1, "z"), (22, z1, "z"), (x0, 13, "x"), (x1, 15, "x")):
        for y in range(6, 10):
            for k in range(3):
                x, z = (wx + k, wz) if face == "z" else (wx, wz + k)
                put(x, y, z, glass if y < 9 and k != 1 else beam[0])
        for k in range(-1, 4):                          # sill / flower box
            x, z = (wx + k, wz + 1) if face == "z" else (wx + (1 if wx == x1 else -1), wz + k)
            put(x, 5, z, beam[1])
            if face == "z" and k in (0, 2):
                put(x, 6, z, "#e86a8a" if k == 0 else "#ffe060")
    # fence around the plot, open at the path
    for i in range(1, SX - 1):
        for (x, z) in ((i, 1), (i, SZ - 2), (1, i), (SX - 2, i)):
            if z == SZ - 2 and 15 <= x <= 20:
                continue
            post = (x + z) % 4 == 1 or (x, z) in ((1, 1), (1, SZ - 2), (SX - 2, 1), (SX - 2, SZ - 2))
            if post:
                for y in range(3, 7):
                    put(x, y, z, beam[1])
                put(x, 7, z, beam[0])
            put(x, 5, z, plaster[0])
    # vegetable garden, front right: soil rows with leafy crops and orange tips
    for x in range(24, 33):
        for z in range(25, 33):
            put(x, 2, z, dirt[1] if (z % 2) else dirt[2])
            if z % 2 == 0 and x % 2 == 0:
                put(x, 3, z, leaf[2]); put(x, 4, z, leaf[1] if (x + z) % 4 else BRAND)
    # flowers along the front left
    for x in range(4, 14, 2):
        for z in (25, 28):
            put(x, 3, z, leaf[1]); put(x, 4, z, r.choice(["#e86a8a", "#ffe060", "#b07ae8", BRAND]))
    # a round tree at the back left
    for y in range(3, 12):
        put(5, y, 6, beam[1]); put(6, y, 6, beam[0] if y < 10 else beam[1])
    for x in range(0, 13):
        for y in range(8, 20):
            for z in range(0, 13):
                d = ((x - 5.5) / 5.5) ** 2 + ((y - 14) / 5.5) ** 2 + ((z - 6) / 5.5) ** 2
                if d <= 1 and noise2(x * 3 + z, y * 3, 112, 3) > 0.2:
                    c = leaf[2] if (y > 15 and x < 7) else leaf[1] if d < 0.7 else leaf[0]
                    if y > 17:
                        c = leaf[2]
                    put(x, y, z, c)
    # a barrel by the door
    for y in range(3, 7):
        for (bx, bz) in ((22, 23), (23, 23), (22, 24), (23, 24)):
            put(bx, y, bz, beam[1] if y in (3, 6) else dirt[2])
    vox = [[x + 1, y, z + 1, c] for (x, y, z), c in v.items()]
    for i in range(0, len(vox), 2500):
        a.call("set_voxels", voxels=vox[i:i + 2500])
    print(slug, "voxels:", len(vox))
    return slug, "Voxel Cottage", "voxel"

SCENES = {
    "scene-space": scene_space,
    "scene-reef": scene_reef,
    "scene-shrine": scene_shrine,
    "scene-rain": scene_rain,
    "scene-volcano": scene_volcano,
    "scene-autumn": scene_autumn,
    "scene-lighthouse": scene_lighthouse,
    "scene-cottage": scene_cottage,
}


def main():
    want = sys.argv[1:] or list(SCENES)
    a = op.Agent()
    a.call("pixel_art_guide", topic="all")
    for slug in want:
        s, title, kind = SCENES[slug](a)
        if "--check" in sys.argv:
            continue
        col.publish(a, s, title, kind)
    a.close()


if __name__ == "__main__":
    main()

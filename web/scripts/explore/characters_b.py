#!/usr/bin/env python3
"""Explore page, Characters (set B): fox ranger, black cat, frog knight, baby dragon, robot buddy, mushroom folk,
viking and a witch on a broom, drawn with OpenPixel's v1.1.0 agent harness over MCP.

    OPENPIXEL=…/OpenPixel REVIEW_DIR=… python3 characters_b.py [slug …]

The 2D sprites are built from simple forms (ellipses, boxes, wedges) shaded by how each pixel faces a top-left
light, using the hue-shifted ramps make_color_ramp returns, then outlined with a selective outline (each outline
pixel is the darkest shade of the material inside it). Small details (eyes, buckles, sparkles) are set by hand.
The voxel models are built from boxes and spheres and shaded per voxel. Each piece carries one small detail in
OpenPixel's brand orange #ff4a1c.
"""
import math
import sys

import common
import op

SCRIPT, COLLECTION = "characters_b", "characters"
LIGHT = (-0.62, -0.78)  # top-left, normalised

# ---------------------------------------------------------------- ramps (from make_color_ramp, 5 steps, darkest first)

RAMPS = {
    "fox": ["#410c0a", "#8c3519", "#d8782c", "#eeba5b", "#ffed8f"],
    "cream": ["#473028", "#997d64", "#ecd8b0", "#f7f0c6", "#fffcdb"],
    "green": ["#0e291c", "#235935", "#3e8948", "#73be6e", "#bef4aa"],
    "leather": ["#290d0d", "#5a2c21", "#8a5a3a", "#bf9d69", "#f5e5a7"],
    "cat": ["#0d0c1a", "#211f37", "#3c3654", "#76668d", "#b7a0c7"],
    "catb": ["#0d0c1a", "#211f37", "#3c3654", "#76668d", "#b7a0c7"],
    "frog": ["#113413", "#33702a", "#6aac4a", "#aedc7b", "#e9ffaf"],
    "steel": ["#1f1f36", "#4f5675", "#8b9bb4", "#b8cfdf", "#dff8ff"],
    "dragon": ["#181437", "#483378", "#8a5ab8", "#c788e1", "#f9b7ff"],
    "red": ["#3c0d20", "#822235", "#c83c3c", "#e8836a", "#ffc49d"],
    "skin": ["#431a19", "#925240", "#e0a070", "#f2cf94", "#fff3b9"],
    "ginger": ["#3a0b0e", "#7d281b", "#c06030", "#e4a660", "#ffe396"],
    "blue": ["#0f0d2e", "#212a64", "#3a5a9a", "#6ba0ce", "#a8e8ff"],
    "purple": ["#0f0d29", "#2c215a", "#5a3a8a", "#9d69bf", "#e5a7f5"],
    "wood": ["#2e100d", "#643521", "#9a6a3a", "#ceb06b", "#fff6a8"],
    "brand": ["#4d0614", "#a61010", "#ff4a1c", "#ff964f", "#ffcd82"],
    "gold": ["#461c0b", "#97591b", "#e8b030", "#f5e55e", "#fff690"],
    "ivory": ["#46362d", "#978672", "#e8e0c8", "#f5f3db", "#fffdec"],
    "lime": ["#21410d", "#618c20", "#b8d838", "#eeee66", "#fff697"],
}
INK = "#1a1428"  # eyes and pupils
RAMPS["dark"] = [INK] * 5


# ---------------------------------------------------------------- a tiny form-shaded canvas


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.col = [[None] * w for _ in range(h)]
        self.mat = [[None] * w for _ in range(h)]

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def put(self, x, y, color, mat=None):
        x, y = int(x), int(y)
        if self.inside(x, y):
            self.col[y][x] = color
            self.mat[y][x] = mat if mat is not None else self.mat[y][x] or "_detail"

    def get(self, x, y):
        return self.col[y][x] if self.inside(x, y) else None

    def erase(self, x, y):
        if self.inside(x, y):
            self.col[y][x] = None
            self.mat[y][x] = None

    def shade(self, mat, v, bias=0.0, hi=True):
        """Ramp colour for a surface facing the light by v (-1 away … 1 toward)."""
        r = RAMPS[mat]
        v += bias
        if hi and v > 0.82:
            return r[4]
        if v > 0.34:
            return r[3]
        if v > -0.38:
            return r[2]
        return r[1]

    def fill(self, test, normal, mat, bias=0.0, hi=True, flat=None):
        for y in range(self.h):
            for x in range(self.w):
                if test(x + 0.5, y + 0.5):
                    if flat is not None:
                        c = RAMPS[mat][flat]
                    else:
                        nx, ny = normal(x + 0.5, y + 0.5)
                        c = self.shade(mat, nx * LIGHT[0] + ny * LIGHT[1], bias, hi)
                    self.put(x, y, c, mat)

    def ellipse(self, cx, cy, rx, ry, mat, bias=0.0, hi=True, flat=None, clip=None):
        def test(x, y):
            ok = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0
            return ok and (clip is None or clip(x, y))

        def normal(x, y):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            return nx, ny

        self.fill(test, normal, mat, bias, hi, flat)

    def box(self, x0, y0, x1, y1, mat, bias=0.0, hi=False, flat=None, round_x=True):
        """Inclusive box shaded like a vertical cylinder (lit on the left), or flat."""
        cx, w = (x0 + x1 + 1) / 2, max(1, (x1 - x0 + 1) / 2)
        cy, h = (y0 + y1 + 1) / 2, max(1, (y1 - y0 + 1) / 2)

        def test(x, y):
            return x0 <= x - 0.5 <= x1 and y0 <= y - 0.5 <= y1

        def normal(x, y):
            return ((x - cx) / w, 0.35 * (y - cy) / h) if round_x else (0.3 * (x - cx) / w, (y - cy) / h)

        self.fill(test, normal, mat, bias, hi, flat)

    def poly(self, pts, mat, bias=0.0, hi=False, flat=None, normal=None):
        """Filled polygon (even-odd), shaded by distance from its centroid unless a normal is given."""
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        span = max(max(abs(p[0] - cx), abs(p[1] - cy)) for p in pts) or 1

        def test(x, y):
            inside = False
            j = len(pts) - 1
            for i in range(len(pts)):
                xi, yi = pts[i]
                xj, yj = pts[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
            return inside

        self.fill(test, normal or (lambda x, y: ((x - cx) / span, (y - cy) / span)), mat, bias, hi, flat)

    def line(self, pts, color, mat=None):
        """Pixel line through points (Bresenham), for straps, stems and handles."""
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
            dx, dy = abs(x1 - x0), -abs(y1 - y0)
            sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
            err = dx + dy
            while True:
                self.put(x0, y0, color, mat)
                if x0 == x1 and y0 == y1:
                    break
                e2 = 2 * err
                if e2 >= dy:
                    err += dy
                    x0 += sx
                if e2 <= dx:
                    err += dx
                    y0 += sy

    def outline(self, lit_side=True):
        """Selective outline: every empty cell touching the sprite (4-neighbours) takes the darkest shade of the
        material it touches; on the lit side (above and left of the shape) one step lighter."""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.col[y][x] is not None:
                    continue
                touch = []
                for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1)):  # below, right first: the shape is there
                    m = self.mat[y + dy][x + dx] if self.inside(x + dx, y + dy) else None
                    if m is not None:
                        touch.append((dx, dy, m))
                if not touch:
                    continue
                real = [t for t in touch if t[2] in RAMPS]
                if not real:  # only touches a detail pixel: use the material around that detail
                    ddx, ddy, _ = touch[0]
                    for ex in (-1, 0, 1):
                        for ey in (-1, 0, 1):
                            qx, qy = x + ddx + ex, y + ddy + ey
                            if self.inside(qx, qy) and self.mat[qy][qx] in RAMPS:
                                real = [(ddx, ddy, self.mat[qy][qx])]
                dx, dy, m = (real or touch)[0]
                ramp = RAMPS.get(m)
                if ramp is None:
                    c = INK
                elif lit_side and all(t[:2] in ((0, 1), (1, 0)) for t in touch) and m not in ("cat", "catb"):
                    c = ramp[1] if _lum(ramp[1]) < 0.42 else ramp[0]
                else:
                    c = ramp[0]
                add.append((x, y, c, m))
        for x, y, c, m in add:
            self.col[y][x] = c
            self.mat[y][x] = "_outline"
        self.fill_elbows()

    def fill_elbows(self):
        """An outline pixel in a concave corner (outline on one horizontal and one vertical side, the shape on the
        other two) makes an L-shaped double; fill it with the shape colour instead."""
        out = lambda x, y: self.inside(x, y) and self.mat[y][x] == "_outline"
        shape = lambda x, y: self.inside(x, y) and self.mat[y][x] not in (None, "_outline")
        for y in range(self.h):
            for x in range(self.w):
                if self.mat[y][x] != "_outline":
                    continue
                for hx in (-1, 1):
                    for vy in (-1, 1):
                        if out(x + hx, y) and out(x, y + vy) and shape(x - hx, y) and shape(x, y - vy) \
                                and self.col[y][x + hx] == self.col[y][x] == self.col[y + vy][x]:
                            self.col[y][x] = self.col[y - vy][x]
                            self.mat[y][x] = self.mat[y - vy][x]

    def perfect(self, colors, passes=2):
        """Pixel-perfect pass for 1-pixel lines of the given colours: an L-corner pixel (same colour to one side
        and above/below, but not on the diagonal between them) takes the colour of the cells on its other sides."""
        colors = set(colors)
        for _ in range(passes):
            for y in range(self.h):
                for x in range(self.w):
                    c = self.col[y][x]
                    if c not in colors:
                        continue
                    same = lambda dx, dy: self.inside(x + dx, y + dy) and self.col[y + dy][x + dx] == c
                    n4 = sum(same(dx, dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                    if n4 != 2:
                        continue
                    for hx in (-1, 1):
                        for vy in (-1, 1):
                            if same(hx, 0) and same(0, vy) and not same(hx, vy):
                                ox, oy = x - hx, y - vy
                                cands = [(ox, y), (x, oy)]
                                fill = [(self.col[cy][cx], self.mat[cy][cx]) for cx, cy in cands
                                        if self.inside(cx, cy) and self.col[cy][cx] not in (None, c)]
                                if len(fill) == 2:
                                    self.col[y][x], self.mat[y][x] = fill[0]
                                elif not fill and all(not self.inside(cx, cy) or self.col[cy][cx] is None
                                                      for cx, cy in cands):
                                    self.erase(x, y)

    def perfect_all(self, passes=2):
        """perfect() over every colour except detail pixels (eyes, glints)."""
        cols = {self.col[y][x] for y in range(self.h) for x in range(self.w)
                if self.col[y][x] and self.mat[y][x] != "_detail"}
        detail = {self.col[y][x] for y in range(self.h) for x in range(self.w) if self.mat[y][x] == "_detail"}
        self.perfect(cols - detail, passes)

    def recolor(self, mapping):
        for y in range(self.h):
            for x in range(self.w):
                if self.col[y][x] in mapping:
                    self.col[y][x] = mapping[self.col[y][x]]

    def inner_line(self, front, back):
        """Darkens `back` pixels that touch `front` pixels from below/right, so overlapping parts separate."""
        hits = []
        for y in range(self.h):
            for x in range(self.w):
                if self.mat[y][x] != back:
                    continue
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    if self.inside(x + dx, y + dy) and self.mat[y + dy][x + dx] == front:
                        hits.append((x, y))
                        break
        for x, y in hits:
            self.col[y][x] = RAMPS[back][1]

    def clean_singles(self, keep=()):
        """Recolours lone pixels whose colour no neighbour shares, unless it's a detail colour in `keep`."""
        for y in range(self.h):
            for x in range(self.w):
                c = self.col[y][x]
                if c is None or c in keep or self.mat[y][x] in ("_outline", "_detail"):
                    continue
                n = [self.col[y + dy][x + dx] for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))
                     if self.inside(x + dx, y + dy)]
                same_mat = [self.col[y + dy][x + dx] for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))
                            if self.inside(x + dx, y + dy) and self.mat[y + dy][x + dx] == self.mat[y][x]]
                if c not in n and same_mat:
                    self.col[y][x] = max(set(same_mat), key=same_mat.count)

    def mirror_x(self, axis):
        """Copies the left half onto the right half around column `axis` (the centre line between pixels)."""
        for y in range(self.h):
            for x in range(self.w):
                xm = int(2 * axis - x - 1)
                if x < axis and self.inside(xm, y):
                    self.col[y][xm] = self.col[y][x]
                    self.mat[y][xm] = self.mat[y][x]

    def paint(self, a, frame=0):
        colors = sorted({c for row in self.col for c in row if c})
        keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,<>/?|~"
        legend = {keys[i]: c for i, c in enumerate(colors)}
        back = {c: k for k, c in legend.items()}
        rows = ["".join(back[c] if c else "." for c in row) for row in self.col]
        a.call("paint_slice", rows=rows, legend=legend, frame=frame)


def _lum(hexc):
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.299 * r + 0.587 * g + 0.114 * b


def animate(a, frames, durations):
    """Paints canvases as frames 0..n-1 and sets their durations."""
    for i, cv in enumerate(frames):
        if i > 0:
            a.call("add_frame", copy=False)
        cv.paint(a, frame=i)
    for i, d in enumerate(durations):
        a.call("set_frame_duration", frame=i, duration_ms=d)


def start_sprite(a, w, h, name, ramps):
    a.call("new_sprite", width=w, height=h, name=name)
    for m in ramps:  # the material ramps, built with the harness's hue-shifted ramp maker
        got = a.call("make_color_ramp", base=RAMPS[m][2], steps=5)["colors"]
        assert got == RAMPS[m], (m, got)


# ---------------------------------------------------------------- 7. viking


def draw_viking():
    cv = Canvas(32, 32)
    c = 15.5  # centre line (between columns 15 and 16)
    sym = lambda fn: (fn(lambda x: x), fn(lambda x: 2 * c - x))
    # boots and legs
    cv.box(10, 25, 13, 28, "leather", flat=2)
    cv.box(18, 25, 21, 28, "leather", flat=1)
    cv.box(9, 28, 13, 29, "leather", flat=1)
    cv.box(18, 28, 22, 29, "leather", flat=1)
    # fur cape on the shoulders, blue tunic
    cv.ellipse(c, 17, 9.4, 4.2, "cream", hi=False)
    cv.poly([(8, 17), (23, 17), (24, 26), (7, 26)], "blue", hi=False, normal=lambda x, y: ((x - c) / 8, (y - 21) / 9))
    for x in range(7, 25):
        if cv.mat[23][x] == "blue":
            cv.put(x, 23, RAMPS["leather"][1], "leather")
    cv.box(15, 23, 16, 23, "gold", flat=3)
    # arms and fists
    cv.box(5, 18, 7, 22, "blue", bias=0.2)
    cv.box(24, 18, 26, 22, "blue", bias=-0.3)
    cv.ellipse(6, 23.5, 1.8, 1.6, "skin", hi=False)
    cv.ellipse(25, 23.5, 1.8, 1.6, "skin", bias=-0.2, hi=False)
    # face
    cv.ellipse(c, 11.5, 5.6, 4.6, "skin", hi=False)
    # beard: a big ginger triangle with two braids
    cv.poly([(9, 12), (22, 12), (19.5, 21), (15.5, 23), (11.5, 21)], "ginger", hi=False,
            normal=lambda x, y: ((x - c) / 7, (y - 15) / 9))
    for bx in (12, 19):
        cv.box(bx, 20, bx, 22, "ginger", flat=2)
        cv.put(bx, 21, RAMPS["ginger"][1], "ginger")
        cv.box(bx, 23, bx, 23, "brand", flat=2)
    # moustache
    for x in range(11, 21):
        cv.put(x, 13, RAMPS["ginger"][3] if x < 16 else RAMPS["ginger"][2], "ginger")
    cv.put(10, 14, RAMPS["ginger"][2], "ginger"); cv.put(21, 14, RAMPS["ginger"][1], "ginger")
    # eyes and nose
    for ex in (13, 18):
        cv.put(ex, 10, INK, "_detail"); cv.put(ex, 11, INK, "_detail")
    cv.put(15, 11, RAMPS["skin"][1], "skin"); cv.put(16, 11, RAMPS["skin"][1], "skin")
    cv.put(15, 12, RAMPS["skin"][3], "skin"); cv.put(16, 12, RAMPS["skin"][2], "skin")
    cv.put(12, 12, RAMPS["red"][3], "_detail"); cv.put(19, 12, RAMPS["red"][3], "_detail")
    # helmet with a nose guard and curled horns
    cv.ellipse(c, 8, 6.4, 5, "steel", hi=False, clip=lambda x, y: y < 9.2)
    cv.box(9, 8, 22, 8, "steel", flat=1)
    for x in range(10, 22, 3):
        cv.put(x, 8, RAMPS["steel"][3], "steel")
    cv.box(15, 9, 16, 10, "steel", flat=2)
    cv.poly([(10, 8), (6, 7.5), (3.5, 5), (3, 1.5), (5.5, 3.5), (8, 4.5), (10.5, 5)], "ivory", hi=False,
            normal=lambda x, y: (-0.6, -0.6))
    cv.poly([(21, 8), (25, 7.5), (27.5, 5), (28, 1.5), (25.5, 3.5), (23, 4.5), (20.5, 5)], "ivory", hi=False,
            normal=lambda x, y: (0.5, 0.2))
    # axe in the right fist: wooden haft and a steel blade
    cv.line([(26, 28), (26, 12)], RAMPS["wood"][2], "wood")
    cv.line([(27, 28), (27, 12)], RAMPS["wood"][1], "wood")
    cv.poly([(26, 11), (29.5, 9), (30.5, 13), (29.5, 17), (26, 15)], "steel", hi=False,
            normal=lambda x, y: ((x - 28) / 3, (y - 12) / 5))
    cv.ellipse(25, 23.5, 1.8, 1.6, "skin", bias=-0.2, hi=False)
    cv.perfect_all()
    cv.clean_singles(keep=(INK, RAMPS["red"][3], RAMPS["gold"][3], RAMPS["steel"][3]))
    cv.outline(lit_side=False)
    cv.perfect([RAMPS[m][0] for m in RAMPS if m not in ("dark",)])
    # a tight palette: fur shares the horn ramp, browns share one dark, two outline colours
    warm, cool = RAMPS["leather"][0], RAMPS["steel"][0]
    m = {RAMPS["cream"][i]: RAMPS["ivory"][max(2, i)] for i in range(1, 5)}
    m.update({RAMPS["gold"][3]: RAMPS["steel"][3], RAMPS["red"][3]: RAMPS["skin"][3], INK: cool,
              RAMPS["skin"][1]: RAMPS["ginger"][1], RAMPS["leather"][1]: RAMPS["ginger"][1],
              RAMPS["wood"][1]: RAMPS["ginger"][1], RAMPS["wood"][2]: RAMPS["leather"][2],
              RAMPS["blue"][3]: RAMPS["blue"][2], RAMPS["ivory"][1]: RAMPS["ivory"][2],
              RAMPS["steel"][4]: RAMPS["steel"][3], RAMPS["skin"][4]: RAMPS["skin"][3],
              RAMPS["ginger"][3]: RAMPS["skin"][2]})
    for k in ("skin", "ginger", "ivory", "leather", "cream", "wood", "brand", "gold", "red"):
        m[RAMPS[k][0]] = warm
    m[RAMPS["blue"][0]] = cool
    cv.recolor(m)
    for x, y in ((9, 7), (8, 7), (9, 6), (22, 7), (23, 7), (22, 6)):  # darker horn roots where they meet the helm
        if cv.mat[y][x] == "ivory":
            cv.put(x, y, RAMPS["ivory"][2], "ivory")
    cv.perfect_all()
    return cv


def viking(a, col):
    start_sprite(a, 32, 32, "Viking", ["skin", "ginger", "steel", "ivory", "blue", "leather", "cream", "wood", "brand"])
    draw_viking().paint(a)
    return "char-viking", "Viking", "sprite"


# ---------------------------------------------------------------- 8. witch on a broom (flying)

WITCH_BOB = [0, -1, -1, 0, 1, 1]


def draw_witch(t):
    cv = Canvas(48, 32)
    oy = WITCH_BOB[t] + 2
    ph = t * math.pi / 3  # flutter phase
    Y = lambda pts: [(x, y + oy) for x, y in pts]
    wave = lambda x, amp=1.2: amp * math.sin(ph + x * 0.55)
    # cape billowing back behind her
    cape = [(23, 10), (17, 11 + wave(17)), (12, 13 + wave(12)), (10, 16 + wave(10, 1.5)), (13, 17), (16, 18 + wave(16)),
            (20, 18), (24, 16)]
    cv.poly(Y(cape), "cat", flat=1)
    for x, y in cape[1:4]:  # the cape's lit upper fold
        cv.put(x + 1, y + oy + 1, RAMPS["cat"][2], "cat")
    # broom: bristles at the back, a long haft
    cv.poly(Y([(4, 17), (13, 19), (13, 24), (4, 26), (6, 21.5)]), "gold", hi=False,
            normal=lambda x, y: (-0.3, (y - 21 - oy) / 4))
    for x in range(5, 13, 2):
        cv.line(Y([(x, 21), (x + 2, 21)]), RAMPS["gold"][1], "gold")
    cv.line(Y([(13, 20), (13, 23)]), RAMPS["wood"][1], "wood")
    cv.line(Y([(14, 21), (44, 19)]), RAMPS["wood"][3], "wood")
    cv.line(Y([(14, 22), (44, 20)]), RAMPS["wood"][1], "wood")
    # legs dangling with dark boots
    for lx, sh in ((24, 2), (27, 1)):
        cv.line(Y([(lx, 21), (lx - 2, 25)]), RAMPS["cat"][sh + 1], "cat")
        cv.line(Y([(lx + 1, 21), (lx - 1, 25)]), RAMPS["cat"][sh], "cat")
        cv.box(lx - 4, 25 + oy, lx - 1, 26 + oy, "cat", flat=sh)
    # dress: torso and a skirt draped over the broom
    cv.poly(Y([(20, 17), (30, 17), (29, 23), (25, 24.5), (21, 23)]), "purple", bias=0.15, hi=False,
            normal=lambda x, y: ((x - 25) / 6, (y - 20 - oy) / 6))
    cv.ellipse(25, 14.5 + oy, 3.4, 4.2, "purple", bias=0.25, hi=False)
    # arm reaching forward to the haft
    cv.line(Y([(26, 13), (30, 17), (31, 18)]), RAMPS["purple"][2], "purple")
    cv.line(Y([(26, 14), (30, 18)]), RAMPS["purple"][1], "purple")
    cv.box(31, 18 + oy, 32, 19 + oy, "skin", flat=2)
    # brand-orange scarf trailing in the wind
    tail = [(24, 11), (20, 11 + wave(20)), (16, 11 + wave(16)), (13, 10 + wave(13, 1.6))]
    cv.line(Y(tail), RAMPS["brand"][2], "brand")
    cv.line(Y([(x, y + 1) for x, y in tail[:-1]]), RAMPS["brand"][1], "brand")
    cv.box(23, 11 + oy, 27, 12 + oy, "brand", flat=2)
    cv.put(23, 12 + oy, RAMPS["brand"][1], "brand"); cv.put(27, 12 + oy, RAMPS["brand"][1], "brand")
    # hair flowing back, face looking ahead
    cv.ellipse(23.5, 9.2 + oy, 3, 3.2, "cat", flat=3)
    cv.line(Y([(21, 9), (19, 10 + wave(19, 0.8)), (18, 11 + wave(18, 0.8))]), RAMPS["cat"][3], "cat")
    cv.ellipse(26.5, 8.5 + oy, 2.9, 2.9, "skin", hi=False)
    cv.put(29, 9 + oy, RAMPS["skin"][2], "skin"); cv.put(30, 9 + oy, RAMPS["skin"][1], "skin")  # nose
    cv.put(27, 8 + oy, INK, "_detail")
    cv.put(28, 10 + oy, RAMPS["red"][3], "_detail")
    # pointy hat with a wide brim; its tip bends back and bobs
    tipy = 0.5 + (0.6 if t in (1, 2) else 0)
    cv.poly(Y([(21, 6), (28, 6), (26, 3), (23, 1), (18.5, tipy - oy + 2.5), (21.5, 3)]), "purple", hi=False,
            normal=lambda x, y: ((x - 24) / 5, (y - 3 - oy) / 4))
    cv.line(Y([(19, 6), (31, 6)]), RAMPS["purple"][1], "purple")
    cv.line(Y([(20, 5), (28, 5)]), RAMPS["gold"][2], "gold")  # hat band
    cv.perfect_all()
    cv.clean_singles(keep=(INK, RAMPS["red"][3], RAMPS["gold"][3], RAMPS["gold"][2]))
    cv.outline(lit_side=False)
    cv.perfect([RAMPS[m][0] for m in RAMPS if m != "dark"])
    warm, cool = RAMPS["wood"][0], RAMPS["purple"][0]
    m = {RAMPS[k][0]: warm for k in ("skin", "wood", "gold", "brand", "red")}
    m.update({RAMPS[k][0]: cool for k in ("cat", "blue")})
    m.update({INK: cool, RAMPS["red"][3]: RAMPS["skin"][1]})
    cv.recolor(m)
    cv.perfect_all(passes=3)
    return cv


def witch(a, col):
    start_sprite(a, 48, 32, "Witch on a Broom", ["purple", "skin", "cat", "wood", "gold", "brand", "blue"])
    animate(a, [draw_witch(t) for t in range(6)], [150, 90, 90, 150, 90, 90])
    return "char-witch", "Witch on a Broom", "animation"


# ---------------------------------------------------------------- voxel helpers


class Vox:
    """A voxel dict {(x, y, z): (material, shade level)}; shade() lightens tops and darkens undersides, then
    send() paints it with set_voxels, one call per batch."""

    def __init__(self, sx, sy, sz):
        self.size = (sx, sy, sz)
        self.v = {}

    def put(self, x, y, z, mat, lvl=2):
        x, y, z = int(x), int(y), int(z)
        if 0 <= x < self.size[0] and 0 <= y < self.size[1] and 0 <= z < self.size[2]:
            self.v[(x, y, z)] = (mat, lvl)

    def erase(self, x, y, z):
        self.v.pop((int(x), int(y), int(z)), None)

    def box(self, x0, y0, z0, x1, y1, z1, mat, lvl=2):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.put(x, y, z, mat, lvl)

    def ellipsoid(self, cx, cy, cz, rx, ry, rz, mat, lvl=2, test=None):
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            for y in range(int(cy - ry - 1), int(cy + ry + 2)):
                for z in range(int(cz - rz - 1), int(cz + rz + 2)):
                    px, py, pz = x + 0.5, y + 0.5, z + 0.5
                    if ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 + ((pz - cz) / rz) ** 2 <= 1 and \
                            (test is None or test(x, y, z)):
                        self.put(x, y, z, mat, lvl)

    def cylinder(self, cx, cz, y0, y1, r, mat, lvl=2, rz=None):
        rz = rz or r
        for y in range(y0, y1 + 1):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                for z in range(int(cz - rz - 1), int(cz + rz + 2)):
                    if ((x + 0.5 - cx) / r) ** 2 + ((z + 0.5 - cz) / rz) ** 2 <= 1:
                        self.put(x, y, z, mat, lvl)

    def shade(self, skip=()):
        out = {}
        for (x, y, z), (m, l) in self.v.items():
            if m in skip:
                out[(x, y, z)] = (m, l)
                continue
            up = (x, y + 1, z) in self.v
            down = (x, y - 1, z) in self.v
            lit = (x - 1, y, z) not in self.v or (x, y, z + 1) not in self.v
            if not up:
                l2 = l + 1
            elif not down and y > 0:
                l2 = l - 1
            else:
                l2 = l
            if not up and lit and l2 < 3:
                l2 += 0
            out[(x, y, z)] = (m, max(1, min(4, l2)))
        self.v = out

    def send(self, a):
        items = [[x, y, z, RAMPS[m][l]] for (x, y, z), (m, l) in sorted(self.v.items())]
        for i in range(0, len(items), 1500):
            a.call("set_voxels", voxels=items[i:i + 1500])


# ---------------------------------------------------------------- 5. robot buddy (voxel)


def robot(a, col):
    sx, sy, sz = 20, 27, 16
    a.call("new_model", size_x=sx, size_y=sy, size_z=sz, name="Robot Buddy")
    for m in ("steel", "blue", "brand"):
        a.call("make_color_ramp", base=RAMPS[m][2], steps=5)
    v = Vox(sx, sy, sz)
    # feet and legs
    for x0 in (5, 11):
        v.box(x0, 0, 4, x0 + 3, 1, 11, "steel", 1)
        v.box(x0 + 1, 2, 6, x0 + 2, 4, 9, "steel", 1)
    # body: a rounded box with a chest screen
    v.box(4, 5, 4, 15, 12, 11, "steel", 2)
    for x, z in ((4, 4), (15, 4), (4, 11), (15, 11)):
        for y in (5, 12):
            v.erase(x, y, z)
    v.box(6, 7, 12, 13, 10, 12, "blue", 1)  # screen bezel sticks out one voxel
    v.box(7, 8, 12, 12, 9, 12, "blue", 0 + 1)
    for x, y in ((8, 9), (9, 9), (10, 9), (11, 9), (9, 8), (10, 8)):  # a little brand-orange heart
        v.put(x, y, 12, "brand", 2)
    v.put(8, 10, 12, "brand", 2); v.put(11, 10, 12, "brand", 2)
    # arms with round hands
    for x0 in (2, 16):
        v.box(x0, 7, 6, x0 + 1, 11, 9, "steel", 2)
        v.ellipsoid(x0 + 1, 6, 7.5, 1.6, 1.6, 1.6, "steel", 1)
    # neck
    v.box(8, 13, 6, 11, 13, 9, "steel", 1)
    # head: big rounded box with a dark visor and glowing eyes
    v.box(3, 14, 3, 16, 21, 12, "steel", 2)
    for x in (3, 16):
        for z in (3, 12):
            for y in (14, 21):
                v.erase(x, y, z)
            v.erase(x, 21, z)
    for x in range(3, 17):
        v.erase(x, 21, 3); v.erase(x, 21, 12)
    for z in range(3, 13):
        v.erase(3, 21, z); v.erase(16, 21, z)
    v.box(5, 15, 13, 14, 20, 13, "blue", 1)
    v.box(6, 16, 13, 13, 19, 13, "blue", 0 + 1)
    for ex in (7, 11):
        v.box(ex, 17, 13, ex + 1, 18, 13, "blue", 4)
    v.box(9, 16, 13, 10, 16, 13, "blue", 3)
    # ear bolts and antenna with a brand-orange tip
    for x in (2, 17):
        v.box(x, 16, 6, x, 18, 9, "steel", 1)
    v.box(9, 22, 7, 10, 23, 8, "steel", 1)
    v.ellipsoid(10, 24.5, 8, 1.5, 1.5, 1.5, "brand", 2)
    v.shade(skip=("blue", "brand"))
    v.send(a)
    return "char-robot", "Robot Buddy", "voxel"


# ---------------------------------------------------------------- 6. mushroom folk (voxel)


def mushroom(a, col):
    sx, sy, sz = 20, 22, 20
    a.call("new_model", size_x=sx, size_y=sy, size_z=sz, name="Mushroom Folk")
    for m in ("red", "cream", "ivory", "brand"):
        a.call("make_color_ramp", base=RAMPS[m][2], steps=5)
    v = Vox(sx, sy, sz)
    cx, cz = 10, 10
    # little feet and a stubby body (the stem)
    for fx in (7.5, 12.5):
        v.ellipsoid(fx, 0.8, cz + 1, 1.8, 1.4, 2.4, "cream", 1)
    v.cylinder(cx, cz, 1, 11, 4.6, "cream", 2)
    # arms
    for x0 in (4, 15):
        v.box(x0, 5, cz - 1, x0 + 1, 6, cz, "cream", 2)
    # brand-orange scarf with a tail hanging at the front-right
    v.cylinder(cx, cz, 10, 10, 5.2, "brand", 2)
    v.box(12, 7, 14, 13, 9, 14, "brand", 2)
    v.shade(skip=("brand",))
    # cap: a dome with gills underneath, shaded by hand (rim darker, crown lit toward the top-left)
    cap = Vox(sx, sy, sz)
    cap.ellipsoid(cx, 12.5, cz, 9, 8, 9, "red", 2, test=lambda x, y, z: y >= 13)
    for (x, y, z) in list(cap.v):
        lit = (x - cx) * -0.5 + (z - cz) * 0.3 + (y - 13) * 1.0
        cap.v[(x, y, z)] = ("red", 1 if y <= 13 else 3 if lit > 6.5 else 2)
    # white spots: round patches on the cap's surface
    surface = [p for p in cap.v if any((p[0] + d[0], p[1] + d[1], p[2] + d[2]) not in cap.v
                                         for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, -1)))]
    for spot in ((10, 20.5, 10), (4.5, 17, 14), (14.5, 18, 14.5), (16.5, 16, 8), (6, 18.5, 4.5), (10, 15.5, 18.5),
                 (2.5, 15, 8)):
        for p in surface:
            if sum((p[i] + 0.5 - spot[i]) ** 2 for i in range(3)) <= 2.6:
                cap.v[p] = ("ivory", 3)
    v.v.update(cap.v)
    v.cylinder(cx, cz, 12, 12, 8.4, "cream", 1)
    # face on the front of the stem
    def front(x, y):
        return max(z for (xx, yy, z) in v.v if xx == x and yy == y)
    for ex in (8, 11):
        for y in (6, 7):
            v.v[(ex, y, front(ex, y))] = ("dark", 0)
    v.v[(7, 5, front(7, 5))] = ("red", 3)
    v.v[(12, 5, front(12, 5))] = ("red", 3)
    v.v[(9, 4, front(9, 4))] = ("red", 1)
    v.v[(10, 4, front(10, 4))] = ("red", 1)
    v.send(a)
    return "char-mushroom", "Mushroom Folk", "voxel"


# ---------------------------------------------------------------- 1. fox ranger (idle, tail sway)


def draw_fox(t):
    """t: 0..3, tail sway phase and a 1-pixel breath."""
    cv = Canvas(32, 32)
    breath = 1 if t in (1, 2) else 0
    sway = [0, 1, 2, 1][t]
    # tail (behind the body): a plume rising to the right with a cream tip that sways
    cv.ellipse(22.5 + sway * 0.5, 22, 4.6, 6.4, "fox", bias=-0.05, hi=False)
    cv.ellipse(24.5 + sway, 16.2, 3.1, 2.9, "cream", bias=0.45, hi=False)
    # legs and boots
    cv.box(10, 25, 12, 29, "leather", flat=2)
    cv.box(14, 25, 16, 29, "leather", flat=2)
    cv.box(9, 28, 12, 29, "leather", flat=1)
    cv.box(14, 28, 17, 29, "leather", flat=1)
    # body: green ranger cloak
    cv.poly([(9.5, 15 + breath), (18.5, 15 + breath), (20, 27), (8, 27)], "green", hi=False,
            normal=lambda x, y: ((x - 14) / 6.5, (y - 20) / 10))
    # cloak opening, belt and buckle
    for y in range(18 + breath, 24):
        cv.put(14, y, RAMPS["green"][1], "green")
    for x in range(8, 21):
        if cv.mat[24][x] == "green":
            cv.put(x, 24, RAMPS["leather"][1], "leather")
    cv.put(14, 24, RAMPS["cream"][3], "_detail")
    # paws peeking out of the cloak
    for x, c in ((8, 3), (9, 2), (19, 2), (20, 1)):
        cv.put(x, 22, RAMPS["cream"][c] if c < 3 else RAMPS["cream"][2], "cream")
        cv.put(x, 23, RAMPS["cream"][1] if x > 14 else RAMPS["cream"][2], "cream")
    # head
    hy = 10 + breath
    cv.poly([(6.5, hy - 1), (8.5, hy - 8.5), (12, hy - 3)], "fox", normal=lambda x, y: (-0.6, -0.6))
    cv.poly([(16, hy - 3), (19.5, hy - 8.5), (21.5, hy - 1)], "fox", normal=lambda x, y: (0.5, 0.0))
    cv.poly([(8.4, hy - 2.5), (8.9, hy - 6), (10.6, hy - 3)], "fox", flat=1)
    cv.poly([(17.4, hy - 3), (19.1, hy - 6), (19.6, hy - 2.5)], "fox", flat=1)
    cv.ellipse(14, hy, 7.6, 5.6, "fox", bias=-0.12, hi=False)
    # muzzle and cheek tufts
    cv.ellipse(14, hy + 3.3, 3.5, 2.3, "cream", bias=0.25, hi=False)
    cv.poly([(6.4, hy + 1), (9.5, hy + 1.5), (9.5, hy + 4.6), (7.5, hy + 3.4)], "cream", flat=3)
    cv.poly([(18.5, hy + 1.5), (21.6, hy + 1), (20.5, hy + 3.4), (18.5, hy + 4.6)], "cream", flat=2)
    # eyes with a glint, nose, mouth
    ink = RAMPS["fox"][0]
    for ex in (10, 17):
        cv.put(ex, hy, ink); cv.put(ex + 1, hy, ink)
        cv.put(ex, hy + 1, ink); cv.put(ex + 1, hy + 1, ink)
        cv.put(ex, hy, RAMPS["cream"][3], "_detail")
    cv.put(13, hy + 2, ink); cv.put(14, hy + 2, ink)
    cv.put(14, hy + 3, RAMPS["cream"][1], "cream")
    # hood bunched around the neck, clasped with a brand-orange feather
    for x in range(9, 20):
        cv.put(x, 15 + breath, RAMPS["green"][3] if x < 14 else RAMPS["green"][2], "green")
    cv.put(15, 16 + breath, RAMPS["brand"][2], "brand")
    cv.put(16, 16 + breath, RAMPS["brand"][2], "brand")
    cv.put(16, 17 + breath, RAMPS["brand"][2], "brand")
    cv.put(17, 17 + breath, RAMPS["brand"][2], "brand")
    cv.clean_singles(keep=(RAMPS["fox"][0], RAMPS["cream"][3]))
    cv.outline()
    return cv


def fox(a, col):
    start_sprite(a, 32, 32, "Fox Ranger", ["fox", "cream", "green", "leather", "brand"])
    animate(a, [draw_fox(t) for t in range(4)], [260, 140, 260, 140])
    return "char-fox", "Fox Ranger", "animation"


# ---------------------------------------------------------------- 2. black cat (sitting, tail flick, blink)

CAT_TIPS = [(21, 15), (21, 13), (20, 11), (21, 12), (21, 14), (21, 16)]


def draw_cat(t):
    cv = Canvas(24, 24)
    tip = CAT_TIPS[t]
    blink = t == 3
    # tail: wraps along the ground at the right and flicks up at the tip
    path = [(14, 20), (18, 20), (20, 19), (21, 18), tip]
    for dx, dy, c in ((0, 1, 1), (-1, 0, 2), (0, 0, 2), (0, -1, 2)):
        cv.line([(x + dx, y + dy) for x, y in path], RAMPS["cat"][c], "cat")
    cv.line([(tip[0] - 1, tip[1]), (tip[0] - 1, tip[1] + 2)], RAMPS["cat"][3], "cat")
    # body, then the haunch in front of it (separated by a darker crease)
    cv.ellipse(11, 16.5, 5.4, 5.6, "cat", bias=-0.42, hi=False, clip=lambda x, y: y < 22)
    cv.ellipse(13.8, 18.2, 4.0, 3.8, "catb", bias=-0.28, hi=False, clip=lambda x, y: y < 22)
    cv.inner_line("catb", "cat")
    # chest tuft
    cv.ellipse(10.5, 14.6, 1.3, 1.9, "cat", flat=3)
    # front paws
    for x0 in (8, 11):
        cv.box(x0, 20, x0 + 1, 21, "cat", flat=2)
        cv.put(x0, 20, RAMPS["cat"][3], "cat")
    # head and ears
    cv.poly([(6, 7), (7, 1.5), (10.2, 4.6)], "cat", normal=lambda x, y: (-0.4, -0.4))
    cv.poly([(11.8, 4.6), (15, 1.5), (16, 7)], "cat", normal=lambda x, y: (0.6, 0.1))
    cv.ellipse(11, 8.3, 5.4, 4.6, "cat", bias=-0.38, hi=False)
    for y in (8, 9):
        cv.put(10, y, RAMPS["cat"][2], "cat"); cv.put(11, y, RAMPS["cat"][2], "cat")
    cv.put(7, 3, RAMPS["red"][1], "red"); cv.put(7, 4, RAMPS["red"][1], "red")
    cv.put(14, 3, RAMPS["red"][1], "red"); cv.put(14, 4, RAMPS["red"][1], "red")
    # eyes (lime with a slit pupil) or closed lids
    for ex in (7, 12):
        if blink:
            for x in range(ex, ex + 3):
                cv.put(x, 9, RAMPS["cat"][3], "_detail")
        else:
            for y in (8, 9):
                cv.put(ex, y, RAMPS["lime"][3], "_detail")
                cv.put(ex + 1, y, INK, "_detail")
                cv.put(ex + 2, y, RAMPS["lime"][2], "_detail")
    # nose
    cv.put(10, 10, RAMPS["red"][3], "_detail"); cv.put(11, 10, RAMPS["red"][3], "_detail")
    # brand-orange collar with a gold bell
    for x in range(7, 15):
        cv.put(x, 12, RAMPS["brand"][2] if x < 12 else RAMPS["brand"][1], "brand")
    cv.put(10, 13, RAMPS["gold"][2], "gold"); cv.put(11, 13, RAMPS["gold"][1], "gold")
    cv.clean_singles(keep=(INK, RAMPS["red"][3], RAMPS["red"][1], RAMPS["gold"][2], RAMPS["gold"][1], RAMPS["cat"][3]))
    cv.outline()
    for x, y in ((12, 13), (13, 13), (14, 13), (15, 13), (12, 14), (15, 14)):  # soften shadow seams
        if cv.mat[y][x] == "cat":
            cv.put(x, y, RAMPS["cat"][2], "cat")
    cv.put(6, 10, RAMPS["cat"][1], "cat"); cv.put(7, 10, RAMPS["cat"][1], "cat")
    for x in (7, 14):  # the collar sticks out under the jaw: keep the jaw's outline there
        if cv.mat[11][x] == "_outline":
            cv.put(x, 11, RAMPS["cat"][0], "_outline")
    return cv


def cat(a, col):
    start_sprite(a, 24, 24, "Black Cat", ["cat", "lime", "brand", "gold", "red"])
    animate(a, [draw_cat(t) for t in range(6)], [420, 90, 160, 120, 90, 300])
    return "char-cat", "Black Cat", "animation"


# ---------------------------------------------------------------- 3. frog knight


def draw_frog():
    cv = Canvas(32, 32)
    # sword (behind the hand): blade rising up-right
    cv.line([(23, 19), (28, 6)], RAMPS["steel"][3], "steel")
    cv.line([(24, 19), (29, 6)], RAMPS["steel"][2], "steel")
    cv.line([(21, 19), (25, 21)], RAMPS["gold"][2], "gold")  # crossguard
    # legs and big feet
    cv.ellipse(11.5, 27, 2.6, 2.6, "frog", hi=False)
    cv.ellipse(18.5, 27, 2.6, 2.6, "frog", bias=-0.2, hi=False)
    cv.box(7, 28, 12, 29, "frog", flat=2)
    cv.box(18, 28, 23, 29, "frog", flat=1)
    for x in (7, 9, 18, 20):
        cv.put(x, 28, RAMPS["frog"][3] if x < 15 else RAMPS["frog"][2], "frog")
    # body: steel breastplate over a pale belly
    cv.ellipse(15, 21.5, 6.4, 5.2, "steel", hi=False)
    cv.box(10, 24, 20, 24, "wood", flat=1)
    cv.put(15, 24, RAMPS["gold"][2], "_detail")
    cv.line([(15, 18), (15, 22)], RAMPS["steel"][1], "steel")
    # arms
    cv.ellipse(23, 19.5, 2, 2, "frog", bias=-0.1, hi=False)
    # shield on the left arm: wood with a steel rim and a gold boss
    cv.ellipse(7.5, 21, 4.6, 5.2, "steel", flat=2)
    cv.ellipse(7.5, 21, 3.5, 4.1, "wood", bias=-0.3, hi=False)
    for y in range(cv.h):
        for x in range(cv.w):
            if cv.col[y][x] == RAMPS["wood"][3]:
                cv.col[y][x] = RAMPS["wood"][2]
    cv.box(7, 20, 8, 21, "gold", flat=2)
    # head with bulging eyes
    cv.ellipse(15, 11.5, 9.4, 5.6, "frog", hi=False)
    for ex in (9.5, 20.5):
        cv.ellipse(ex, 6.8, 3.4, 3.2, "frog", hi=False)
    for ex in (8, 19):
        cv.box(ex, 5, ex + 2, 7, "ivory", flat=3)
        for px, py in ((ex + 1, 6), (ex + 2, 6), (ex + 1, 7), (ex + 2, 7)):
            cv.put(px, py, RAMPS["frog"][0], "_detail")
    # wide smile and blush
    cv.line([(10, 13), (11, 14), (19, 14), (20, 13)], RAMPS["frog"][0], "_detail")
    cv.put(8, 13, RAMPS["red"][3], "_detail"); cv.put(22, 13, RAMPS["red"][3], "_detail")
    cv.ellipse(15, 15.6, 5, 1.5, "frog", flat=3, clip=lambda x, y: y > 15)
    # little steel helm between the eyes with a brand-orange plume
    cv.poly([(12.5, 7.5), (13.5, 3.5), (16.5, 3.5), (17.5, 7.5)], "steel", hi=False,
            normal=lambda x, y: ((x - 15) / 3, (y - 6) / 4))
    cv.line([(13, 7), (17, 7)], RAMPS["steel"][1], "steel")
    for x, y, c in ((14, 3, 2), (15, 3, 2), (16, 3, 1), (13, 2, 2), (14, 2, 2), (15, 2, 2), (16, 2, 1), (17, 3, 1)):
        cv.put(x, y, RAMPS["brand"][c], "brand")
    cv.perfect([RAMPS["steel"][2], RAMPS["steel"][3]])
    cv.clean_singles(keep=(RAMPS["frog"][0], RAMPS["red"][3], RAMPS["gold"][2]))
    cv.outline(lit_side=False)
    cv.perfect([RAMPS[m][0] for m in ("frog", "steel", "wood", "gold", "brand")])
    cv.recolor({RAMPS["wood"][0]: RAMPS["steel"][0], RAMPS["gold"][0]: RAMPS["steel"][0]})
    cv.perfect([RAMPS["frog"][1], RAMPS["frog"][2], RAMPS["steel"][0], RAMPS["steel"][1]])
    cv.put(20, 17, RAMPS["frog"][0], "_outline")  # close the notch between chin, arm and armour
    cv.erase(15, 28)
    return cv


def frog(a, col):
    start_sprite(a, 32, 32, "Frog Knight", ["frog", "steel", "wood", "gold", "brand", "ivory"])
    draw_frog().paint(a)
    return "char-frog", "Frog Knight", "sprite"


# ---------------------------------------------------------------- 4. baby dragon (hovering, wing flap)

WINGS = {  # membrane polygon from the shoulder at (17, 13), and the finger bones fanning out from it
    "up": ([(17, 14), (15, 1), (12, 2), (9, 5), (8, 9), (11, 10), (12, 13)], [(15, 1), (9, 5), (8, 9)]),
    "mid": ([(17, 14), (8, 5), (5, 8), (4, 12), (8, 12), (10, 15), (13, 15)], [(8, 5), (4, 9), (5, 12)]),
    "down": ([(16, 13), (10, 25), (12.5, 23.5), (14, 25.5), (15.5, 22), (17.5, 21.5), (18, 16)], [(10, 25), (14, 25)]),
    "low": ([(16, 13), (8, 23), (10.5, 22.5), (11.5, 25), (14, 21.5), (16.5, 21), (17.5, 16)], [(8, 23), (11, 24)]),
}
DRAGON_FRAMES = [("up", 1), ("mid", 0), ("down", -1), ("low", -1), ("mid", 0), ("up", 0)]


def draw_dragon(t):
    cv = Canvas(40, 32)
    pose, bob = DRAGON_FRAMES[t]
    oy = 2 + bob  # everything sits 2 rows lower so the up-wing clears the top edge
    Y = lambda pts: [(x, y + oy) for x, y in pts]
    near, bones = WINGS[pose]
    # far wing peeking out behind the back, darker
    cv.poly([(x + 5, max(2, y + oy - 2)) for x, y in near], "dragon", flat=1)
    # tail sweeping back and down, ending in a brand-orange spade
    tail = Y([(13, 20), (9, 22), (6, 22), (4, 20), (3, 18)])
    for dx, dy, c in ((0, 0, 2), (0, 1, 1), (1, 1, 1)):
        cv.line([(x + dx, y + dy) for x, y in tail], RAMPS["dragon"][c], "dragon")
    cv.poly(Y([(4.5, 19), (2, 16.5), (4.5, 13.5), (7, 16.5)]), "brand", hi=False, normal=lambda x, y: (-0.6, -0.4))
    # legs dangling
    for x0, sh in ((14, 1), (21, 2)):
        cv.box(x0, 22 + oy, x0 + 1, 24 + oy, "dragon", flat=sh)
        cv.put(x0 + 2, 24 + oy, RAMPS["dragon"][sh], "dragon")
    # body and belly
    cv.ellipse(18.5, 18 + oy, 7, 5.6, "dragon", bias=-0.05, hi=False)
    cv.ellipse(20.8, 19.3 + oy, 3.6, 3.8, "cream", bias=0.2, hi=False, clip=lambda x, y: x > 18)
    for x in range(19, 25):
        if cv.mat[19 + oy][x] == "cream":
            cv.put(x, 19 + oy, RAMPS["cream"][2], "cream")
    # neck and head
    cv.ellipse(23.5, 13.5 + oy, 3.2, 4, "dragon", hi=False)
    cv.poly(Y([(23, 7), (21, 2.5), (25, 6.5)]), "ivory", hi=False, normal=lambda x, y: (-0.6, -0.6))
    cv.poly(Y([(26.5, 6.5), (26.5, 1.5), (29, 6)]), "ivory", hi=False, normal=lambda x, y: (0.2, -0.6))
    cv.ellipse(27.5, 10.5 + oy, 5.6, 4.6, "dragon", hi=False)
    cv.ellipse(32.5, 12.6 + oy, 3.8, 2.8, "dragon", bias=0.05, hi=False)
    # big eye with a glint, nostril, little smile
    for x, y in ((28, 9), (29, 9), (28, 10), (29, 10)):
        cv.put(x, y + oy, RAMPS["dragon"][0], "_detail")
    cv.put(28, 9 + oy, RAMPS["ivory"][3], "_detail")
    cv.put(34, 11 + oy, RAMPS["dragon"][0], "_detail")
    for x in (31, 32, 33):
        cv.put(x, 14 + oy, RAMPS["dragon"][1], "_detail")
    cv.put(30, 13 + oy, RAMPS["dragon"][1], "_detail")
    cv.put(25, 12 + oy, RAMPS["red"][3], "_detail")
    # near wing: membrane with darker finger bones
    cv.poly(Y(near), "dragon", bias=0.95, hi=True)
    cv.perfect([RAMPS["dragon"][1], RAMPS["dragon"][2], RAMPS["dragon"][3]])
    for tip in bones:
        cv.line(Y([(17, 13.6), tip]), RAMPS["dragon"][1], "dragon")
    cv.perfect(RAMPS["dragon"][1:] + RAMPS["cream"][1:])
    cv.clean_singles(keep=(RAMPS["ivory"][3], RAMPS["dragon"][0], RAMPS["red"][3]))
    cv.outline(lit_side=False)
    cv.perfect([RAMPS[m][0] for m in ("dragon", "ivory", "cream", "brand")])
    cv.recolor({RAMPS["ivory"][0]: RAMPS["cream"][0]})
    cv.perfect_all(passes=3)
    return cv


def dragon(a, col):
    start_sprite(a, 40, 32, "Baby Dragon", ["dragon", "cream", "ivory", "brand", "red"])
    animate(a, [draw_dragon(t) for t in range(6)], [150, 90, 120, 150, 90, 120])
    return "char-dragon", "Baby Dragon", "animation"


ASSETS = {"char-fox": fox, "char-cat": cat, "char-frog": frog, "char-dragon": dragon, "char-robot": robot, "char-mushroom": mushroom, "char-viking": viking, "char-witch": witch}


def main(slugs):
    col = common.Collection(SCRIPT, COLLECTION)
    a = op.Agent()
    for slug, fn in ASSETS.items():
        if slugs and slug not in slugs:
            continue
        s, title, kind = fn(a, col)
        if "--review" in sys.argv:
            rep, paths = common.review(a, s)
            print(s, common.summary(rep), paths)
            continue
        col.publish(a, s, title, kind)
    a.close()


if __name__ == "__main__":
    main([s for s in sys.argv[1:] if not s.startswith("--")])

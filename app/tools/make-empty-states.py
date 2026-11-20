#!/usr/bin/env python3
"""Draws the app's empty-state pictures with OpenPixel itself, over MCP, in the accent orange and grays only.

    python3 app/tools/make-empty-states.py            # uses app/OpenPixel.app (the newest local build)
    OPENPIXEL=/path/to/OpenPixel python3 app/tools/make-empty-states.py

Four 32×32 animated sprites, each written as a 1× sprite sheet (frames side by side) to app/web/empty/<name>.png and
as its .openpixel source to app/assets/empty/<name>.openpixel:

  search   nothing found: the website's search buddy (a slime sweeping a magnifying glass), in grays and orange
  archive  empty archive: the box's lid lifts, an orange spark drifts up out of the empty box
  folder   empty folder: the front opens and an orange speck floats out of the empty folder
  files    no files yet: a blank canvas where an orange pixel cursor draws a tiny heart, then starts over

Every frame lasts the same time (the page animates the sheet in equal steps); slow parts repeat frames.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP = os.environ.get("OPENPIXEL") or os.path.join(ROOT, "app", "OpenPixel.app", "Contents", "MacOS", "OpenPixel")
OUT = os.path.join(ROOT, "app", "web", "empty")
SRC = os.path.join(ROOT, "app", "assets", "empty")
W = H = 32
FRAME_MS = 280  # one step; the page uses the same length per frame

# Accent and grays only (the app's orange #ff4a1c and its ramp, a neutral gray ramp).
LEG = {
    "o": "#141416",  # outline
    "1": "#2c2c31",  # gray, darkest
    "2": "#4a4a51",
    "3": "#73737b",
    "4": "#a3a3ab",
    "5": "#d9d9df",  # gray, lightest
    "a": "#8f2508",  # accent, dark
    "b": "#d6390c",
    "c": "#ff4a1c",  # accent (the app's orange)
    "d": "#ff9a78",  # accent, light
}


class Agent:
    """A tiny MCP client for OpenPixel's headless server."""

    def __init__(self):
        self.p = subprocess.Popen([APP, "--mcp", "--headless"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.n = 0
        info = self.rpc("initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "openpixel-empty-states", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        print("OpenPixel", info.get("serverInfo", {}).get("version", "?"), "at", APP)

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
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


def blank():
    return [["." for _ in range(W)] for _ in range(H)]


def outline(g):
    """Every empty pixel next to a filled one becomes outline."""
    out = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x] == "." and any(0 <= y + dy < H and 0 <= x + dx < W and g[y + dy][x + dx] not in ".o"
                                      for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0))):
                out[y][x] = "o"
    return out


def rect(g, x0, y0, x1, y1, ch):
    for y in range(max(0, y0), min(H, y1 + 1)):
        for x in range(max(0, x0), min(W, x1 + 1)):
            g[y][x] = ch


def rows(g):
    return ["".join(r) for r in g]


# ---------------------------------------------------------------- search: the website's buddy, in grays and orange
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


def search_frame(gx):
    g = blank()
    cx, cy, rx, ry = 15.5, 21.5, 11.5, 7.5
    for y in range(H):  # body: a squat dome, lit from the top-left
        for x in range(W):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            if y > 27 or nx * nx + ny * ny > 1:
                continue
            light = -0.6 * nx - 0.8 * ny
            g[y][x] = "4" if light > 0.8 else "3" if light > 0.25 else "2" if light > -0.45 else "1"
    for x in range(1, W - 1):
        if g[27][x] != ".":
            g[27][x] = "1"
    look = 1 if gx >= 15 else 0
    for ex in (11, 18):  # eyes, pupils toward the glass
        for y in range(19, 22):
            for x in range(ex, ex + 2):
                g[y][x] = "5"
        g[20][ex + look] = g[21][ex + look] = "o"
    gy = 17  # the glass: rim, lens, glint and a magnified eye
    for j, row in enumerate(LENS):
        for i, ch in enumerate(row):
            x, y = gx - 5 + i, gy - 5 + j
            if ch == ":":
                g[y][x] = "2"
            elif ch == "#":
                g[y][x] = "d" if (x - gx) + (y - gy) < 0 else "b"  # the rim in orange: the glass is the hero
    g[gy - 3][gx - 2] = g[gy - 2][gx - 3] = g[gy - 3][gx - 1] = "4"
    for y in range(gy - 1, gy + 3):
        for x in range(gx - 1, gx + 3):
            g[y][x] = "5"
    for x, y in ((gx - 1, gy - 1), (gx + 2, gy - 1), (gx - 1, gy + 2), (gx + 2, gy + 2)):
        g[y][x] = "2"
    for y in (gy, gy + 1):
        for x in (gx + look - 1, gx + look):
            g[y][x] = "o"
    for i in range(1, 5):  # the handle in orange, a light band first
        x, y = gx + 3 + i, gy + 3 + i
        g[y][x] = g[y][x + 1] = "d" if i == 1 else "c" if i < 4 else "b"
    return rows(outline(g))


def search():
    # slow sweep: rests at each side, glides between
    path = [10, 10, 10, 12, 15, 18, 20, 20, 20, 18, 15, 12]
    return [search_frame(x) for x in path]


# ---------------------------------------------------------------- archive: the lid lifts, a spark drifts out
def archive_frame(lift, spark):
    g = blank()
    # box body
    rect(g, 6, 15, 25, 26, "3")
    rect(g, 6, 15, 6, 26, "4")       # lit left edge
    rect(g, 25, 15, 25, 26, "2")     # shaded right edge
    rect(g, 6, 26, 25, 26, "2")      # base
    rect(g, 13, 18, 18, 19, "1")     # the slot / handle
    rect(g, 13, 18, 18, 18, "o")
    if lift:
        rect(g, 7, 15, 24, 15 + min(lift, 2) - 1, "1")  # dark, empty inside shows under the lid
    # lid: wider, on top, lifted by `lift`
    top = 11 - lift
    rect(g, 4, top, 27, top + 3, "4")
    rect(g, 4, top, 27, top, "5")
    rect(g, 4, top + 3, 27, top + 3, "3")
    if spark:
        sx, sy, size = spark
        if size == 2:
            g[sy][sx] = "d"
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                g[sy + dy][sx + dx] = "c"
        else:
            g[sy][sx] = "c"
    return rows(outline(g))


def archive():
    lifts = [0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 2, 1]
    sparks = [None, None, None, None, None, (16, 9, 1), (16, 7, 2), (17, 5, 2), (17, 3, 1), None, None, None]
    return [archive_frame(l, s) for l, s in zip(lifts, sparks)]


# ---------------------------------------------------------------- folder: the front opens, a speck floats out
def folder_frame(open_by, speck):
    g = blank()
    # back of the folder with its tab
    rect(g, 5, 9, 13, 11, "3")
    rect(g, 5, 9, 13, 9, "4")
    rect(g, 5, 11, 26, 25, "2")
    rect(g, 7, 13, 24, 23, "1")      # empty inside
    # front: drops open by `open_by` rows from the top
    top = 14 + open_by
    rect(g, 5, top, 26, 25, "3")
    rect(g, 5, top, 26, top, "5")
    rect(g, 5, top + 1, 5, 25, "4")
    rect(g, 26, top + 1, 26, 25, "2")
    rect(g, 5, 25, 26, 25, "2")
    if speck:
        sx, sy = speck
        g[sy][sx] = "c"
        if sy + 1 < top:
            g[sy + 1][sx] = "b"
    return rows(outline(g))


def folder():
    opens = [0, 0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1]
    specks = [None, None, None, None, None, (15, 15), (16, 12), (16, 9), (17, 6), None, None, None]
    return [folder_frame(o, s) for o, s in zip(opens, specks)]


# ---------------------------------------------------------------- files: a pixel cursor draws a tiny heart
HEART = [(13, 13), (14, 12), (15, 13), (16, 13), (17, 12), (18, 13), (13, 14), (18, 14), (14, 15), (17, 15), (15, 16), (16, 16)]


def files_frame(drawn, cursor):
    g = blank()
    # a sheet with a folded corner
    rect(g, 7, 5, 24, 27, "4")
    rect(g, 7, 5, 7, 27, "5")
    rect(g, 24, 5, 24, 27, "3")
    rect(g, 7, 27, 24, 27, "3")
    for y in range(5, 10):            # folded top-right corner
        for x in range(24 - (9 - y), 25):
            g[y][x] = "."
    for i in range(5):
        g[5 + i][19 + i] = "3"
        for x in range(19, 19 + i):
            g[5 + i][x] = "3" if x < 19 + i else g[5 + i][x]
    rect(g, 19, 9, 23, 9, "3")
    for y in range(10, 26, 3):        # faint canvas grid
        for x in range(9, 23):
            if g[y][x] == "4":
                g[y][x] = "3" if x % 3 == 0 else "4"
    for x, y in HEART[:drawn]:
        g[y][x] = "c"
    if drawn >= 4:
        g[12][14] = "d"               # a highlight once the heart has a top
    if cursor:
        cx, cy = cursor
        g[cy][cx] = "o"
        g[cy + 1][cx] = g[cy][cx + 1] = "o"
    return rows(outline(g))


def files():
    frames = [files_frame(0, None), files_frame(0, (13, 13))]
    for n in range(1, len(HEART) + 1, 2):
        nxt = HEART[min(n + 1, len(HEART) - 1)]
        frames.append(files_frame(n + 1, (nxt[0] + 1, nxt[1] + 1)))
    frames += [files_frame(len(HEART), None)] * 4  # admire it
    return frames


ART = {"search": search, "archive": archive, "folder": folder, "files": files}


def main():
    names = [n for n in sys.argv[1:] if n in ART] or list(ART)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SRC, exist_ok=True)
    a = Agent()
    a.call("pixel_art_guide", topic="animation")
    sizes = {}
    for name in names:
        frames = ART[name]()
        a.call("new_sprite", width=W, height=H, name=f"empty-{name}", palette="none")
        for i, f in enumerate(frames):
            if i:
                a.call("add_frame")
            a.call("paint_slice", rows=f, legend=LEG)
            a.call("set_frame_duration", duration_ms=FRAME_MS)
        review = a.call("review_model", frame=0)
        issues = review.get("issues", []) if isinstance(review, dict) else []
        print(f"{name}: {len(frames)} frames; review: {review.get('score', {}).get('total', '?') if isinstance(review, dict) else '?'}/100;",
              "; ".join(issues[:4]) or "no issues")
        a.call("save_model", path=os.path.join(SRC, f"{name}.openpixel"))
        res = a.call("export_sheet", path=os.path.join(OUT, f"{name}.png"), scale=1)
        sizes[name] = {"frames": len(frames), "layout": res}
    a.close()
    print(json.dumps(sizes, indent=1)[:2000])


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Draws the website's pixel art with OpenPixel itself.

Starts `OpenPixel --mcp --headless` and talks MCP to it, exactly like an AI agent would: new_sprite, paint_slice,
add_frame, extrude_to_3d, draw_sphere, export_sheet… The sprites are described below as text rows (some drawn by
hand, some generated), and every picture on the site is exported by OpenPixel.

    python3 web/scripts/make-art.py            (build the app first: cd app && make)

Writes web/public/art/*.png and web/src/lib/art.ts (frame counts and sizes for the <Sprite> component).
"""
import json
import math
import re
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP = os.path.join(ROOT, "app", "OpenPixel.app", "Contents", "MacOS", "OpenPixel")
if not os.path.exists(APP):
    APP = "/Applications/OpenPixel.app/Contents/MacOS/OpenPixel"
OUT = os.path.join(ROOT, "web", "public", "art")
MANIFEST = os.path.join(ROOT, "web", "src", "lib", "art.ts")
CHEST = os.path.join(ROOT, "web", "scripts", "treasure-chest.openpixel")


class Agent:
    """A minimal MCP client over stdio."""

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
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


# ---------------------------------------------------------------- palette (Endesga 32 + the OpenPixel orange)

C = {
    "ink": "#181425", "navy": "#262b44", "slate": "#3a4466", "steel": "#5a6988", "fog": "#8b9bb4", "mist": "#c0cbdc",
    "white": "#ffffff", "pine": "#193c3e", "forest": "#265c42", "leaf": "#3e8948", "grass": "#63c74d",
    "rust": "#be4a2f", "orange": "#f77622", "gold": "#feae34", "sun": "#fee761", "bark": "#733e39",
    "wood": "#b86f50", "sand": "#e4a672", "plum": "#3e2731", "red": "#e43b44", "wine": "#a22633",
    "pink": "#f6757a", "sky": "#0099db", "cyan": "#2ce8f5", "deep": "#124e89", "accent": "#ff4a1c",
    "ember": "#733e39",
}


def grid(w, h):
    return [["." for _ in range(w)] for _ in range(h)]


def rows(g):
    return ["".join(r) for r in g]


def outline(g, key="o"):
    """Turns the edge pixels of every shape into outline pixels."""
    h, w = len(g), len(g[0])
    edge = []
    for y in range(h):
        for x in range(w):
            if g[y][x] == ".":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h) or g[ny][nx] == ".":
                    edge.append((x, y))
                    break
    for x, y in edge:
        g[y][x] = key
    return g


# ---------------------------------------------------------------- sprites

def slime_frames():
    """A bouncing slime: squash, stretch, jump, land."""
    legend = {"o": C["pine"], "d": C["forest"], "g": C["leaf"], "l": C["grass"], "h": "#a6e15a", "k": C["ink"], "w": C["white"]}
    poses = [(14, 9, 0), (16, 7, 0), (12, 11, 1), (11, 12, 4), (12, 11, 2), (16, 7, 0)]
    frames = []
    for w, h, lift in poses:
        g = grid(20, 20)
        base, cx = 19 - lift, 9.5
        for y in range(base - h + 1, base + 1):
            up = (base - y + 0.5) / h
            hw = (w / 2) * max(0.0, 1 - up ** 2.4) ** (1 / 2.4)
            for x in range(20):
                if abs(x + 0.5 - cx) <= hw:
                    t = (x + 0.5 - (cx - hw)) / max(1, 2 * hw)
                    g[y][x] = "l" if (t < 0.35 and up > 0.55) else ("d" if (t > 0.78 or up < 0.18) else "g")
        outline(g)
        top = base - h + 1
        # Shine and eyes
        if top + 2 <= base:
            g[top + 2][int(cx - w * 0.22)] = "h"
            g[top + 2][int(cx - w * 0.22) + 1] = "h"
        ey = base - int(h * 0.45)
        for ex in (int(cx - w * 0.2), int(cx + w * 0.2) - 1):
            g[ey][ex] = "w"
            g[ey + 1][ex] = "k"
        frames.append(rows(g))
    return 20, 20, legend, frames, 110


def coin_frames():
    """A spinning gold coin."""
    legend = {"o": C["plum"], "r": C["orange"], "f": C["gold"], "s": C["sun"], "e": C["rust"]}
    frames = []
    for i in range(8):
        a = i / 8 * math.pi
        w = max(2, round(14 * abs(math.cos(a))))
        g = grid(16, 16)
        for y in range(1, 15):
            dy = (y + 0.5 - 8) / 7
            hw = (w / 2) * math.sqrt(max(0, 1 - dy * dy))
            for x in range(16):
                dx = x + 0.5 - 8
                if abs(dx) <= max(0.6, hw):
                    inner = abs(dx) < hw - 1.6 and abs(dy) < 0.72
                    g[y][x] = "f" if inner else "r"
                    if inner and dx < -hw * 0.3 and dy < 0.1:
                        g[y][x] = "s"
        if w > 3:
            outline(g)
        else:  # edge-on: a thin bright rim with dark caps
            g[1][7] = g[1][8] = g[14][7] = g[14][8] = "o"
        if w >= 8:  # the engraved mark
            for y in range(5, 11):
                g[y][8 if w > 10 else 8] = "e"
        frames.append(rows(g))
    return 16, 16, legend, frames, 80


def campfire_frames():
    legend = {"o": C["plum"], "b": C["bark"], "w": C["wood"], "y": C["sun"], "g": C["gold"], "r": C["orange"], "t": C["red"], "s": C["fog"]}
    logs = [
        "....................",
        "..oo............oo..",
        ".owwoo........oowwo.",
        ".obwwwoooooooowwwbo.",
        "..oobbwwwwwwwwbboo..",
        "....oooooooooooo....",
    ]
    heights = [[4, 7, 10, 12, 13, 11, 8, 5], [5, 8, 12, 11, 13, 12, 7, 4], [3, 8, 11, 13, 12, 10, 9, 5], [5, 7, 10, 12, 14, 11, 7, 4]]
    frames = []
    for f, hs in enumerate(heights):
        g = grid(20, 20)
        for i, h in enumerate(hs):
            x = 6 + i
            for k in range(h):
                y = 15 - k
                frac = k / h
                core = 2 <= i <= 5 and frac < 0.55
                g[y][x] = "y" if core and frac < 0.35 else ("g" if core else ("r" if frac < 0.8 else "t"))
        # A spark that drifts up
        sx, sy = (5 + f * 3) % 14 + 3, 3 - (f % 2)
        g[sy][sx] = "g"
        for r, line in enumerate(logs):
            for x, ch in enumerate(line):
                if ch != ".":
                    g[14 + r][x] = ch
        frames.append(rows(g))
    return 20, 20, legend, frames, 120


ROBOT = [
    "........aa........",
    "........oo........",
    "...oooooooooooo...",
    "..ollllllllllllo..",
    "..olssssssssssdo..",
    "..olseessseessdo..",
    "..olseessseessdo..",
    "..olssssssssssdo..",
    "..olsssmmmmsssdo..",
    "..olssssssssssdo..",
    "..oddddddddddddo..",
    "...oooooooooooo...",
    "......olllld......",
    ".....olllllldo....",
    ".....oddddddddo...",
    "......oooooooo....",
]


def robot_frames():
    """The agent: a little robot that blinks and pings its antenna. Only its 3D version is on the site."""
    legend = {"o": C["navy"], "l": C["mist"], "d": C["fog"], "s": C["ink"], "e": C["cyan"], "m": C["sky"], "a": C["accent"], "q": C["bark"]}
    frames = []
    for lift, antenna, blink in [(0, "a", False), (1, "q", False), (1, "a", False), (0, "q", True)]:
        g = grid(18, 18)
        for y, line in enumerate(ROBOT):
            line = line.replace("a", antenna)
            if blink and y in (5, 6):
                line = line.replace("e", "s" if y == 5 else "m")
            for x, ch in enumerate(line):
                if ch != ".":
                    g[y + 1 + lift][x] = ch
        frames.append(rows(g))
    return 18, 18, legend, frames, 180


# A person, drawn as a left half and mirrored so both sides match. Columns 0-8 are the left half; x = 8.5 is the middle.
HUMAN_HALF = [
    ".....oooo",
    "....oHHhh",
    "...oHhhhh",
    "...ohhhss",
    "...ohssss",
    "...ossess",
    "...oscess",
    "...ossssm",
    "....ossss",
    "..ottttss",
    ".ottttttt",
    ".otottttt",
    ".otottttt",
    ".osoppppp",
    "...oppppo",
    "...oppppo",
    "...obbbbo",
    "...oooooo",
]


def ring(g, cells):
    """Outlines a shape drawn on top: every empty neighbour of its cells becomes outline."""
    h, w = len(g), len(g[0])
    for x, y in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and g[ny][nx] == ".":
                g[ny][nx] = "o"


def human_frames():
    """A person in an orange shirt who raises a hand and waves."""
    legend = {"o": C["ink"], "h": C["bark"], "H": C["wood"], "s": C["sand"], "e": C["ink"], "c": C["pink"],
              "m": C["wine"], "t": C["accent"], "T": C["rust"], "p": C["slate"], "b": C["plum"]}
    base = []
    for half in HUMAN_HALF:
        line = list(half + half[::-1].replace("H", "h"))
        # Shade the shirt's right edge: light comes from the top left.
        for x in range(len(line) - 1, 8, -1):
            if line[x] not in ".o":
                if line[x] == "t":
                    line[x] = "T"
                break
        base.append("".join(line))
    ox, oy = 3, 1  # the 18×18 figure is centred on the 24×20 canvas, with room on the right for the waving hand

    def figure(blink=False):
        g = grid(24, 20)
        for y, line in enumerate(base):
            for x, ch in enumerate(line):
                if ch != ".":
                    g[y + oy][x + ox] = ch
        if blink:  # eyes are two pixels tall; closing them leaves the lower one
            g[5 + oy][6 + ox] = g[5 + oy][11 + ox] = "s"
        return g

    def raise_arm(g, hand_x):
        """Lifts the right arm (seen from the front): the hanging arm goes, a two-pixel arm up to the hand appears."""
        for y in (11, 12, 13):
            g[y + oy][15 + ox] = g[y + oy][16 + ox] = "."
            g[y + oy][14 + ox] = "o"
        g[14 + oy][15 + ox] = g[14 + oy][16 + ox] = "."
        sleeve = [(16, 10), (16, 9), (17, 9), (17, 8), (18, 8), (17, 7), (18, 7), (17, 6), (18, 6)]
        hand = [(hand_x, 4), (hand_x + 1, 4), (hand_x, 5), (hand_x + 1, 5)]
        cells = []
        for (x, y), ch in [(c, "t") for c in sleeve] + [(c, "s") for c in hand]:
            g[y + oy][x + ox] = ch
            cells.append((x + ox, y + oy))
        g[6 + oy][18 + ox] = g[7 + oy][18 + ox] = "T"
        ring(g, cells)
        return g

    frames = [
        figure(),
        raise_arm(figure(), 17),
        raise_arm(figure(), 18),
        raise_arm(figure(blink=True), 17),
    ]
    return 24, 20, legend, [rows(g) for g in frames], 200


def tree_frames():
    """A round tree whose crown sways in the wind while a leaf drifts down."""
    legend = {"o": C["pine"], "k": C["ink"], "d": C["forest"], "g": C["leaf"], "l": C["grass"], "h": "#a6e15a",
              "b": C["bark"], "w": C["wood"], "f": C["red"], "y": C["sun"]}
    W, H = 20, 22
    blobs = [(10, 8, 7.2), (5.5, 10.5, 4.2), (14.5, 10.5, 4.2), (7.5, 5, 4.3), (12.5, 5.5, 4.3), (10, 3.2, 3.6)]
    sway = [0, 1, 0, -1]
    leaf = [(15, 13), (16, 15), (15, 17), (16, 19)]
    frames = []
    for f in range(4):
        g = grid(W, H)
        # Crown: overlapping circles; the top leans further than the bottom.
        crown = {}
        for y in range(H):
            lean = sway[f] * max(0.0, (11 - y) / 9)
            for x in range(W):
                for cx, cy, r in blobs:
                    d = math.hypot(x + 0.5 - (cx + lean), y + 0.5 - cy)
                    if d <= r:
                        # Light from the top left: brighter where the blob faces up-left.
                        nx, ny = (x + 0.5 - (cx + lean)) / r, (y + 0.5 - cy) / r
                        light = -0.7 * nx - 0.7 * ny
                        tone = "h" if light > 0.62 and d > r * 0.45 else "l" if light > 0.2 else "g" if light > -0.35 else "d"
                        crown[(x, y)] = tone  # blobs are listed back to front, so later ones cover earlier ones
        for (x, y), tone in crown.items():
            if y < 15:
                g[y][x] = tone
        # Two apples and the outline.
        for ax, ay in ((6, 11), (13, 8)):
            ax += round(sway[f] * max(0.0, (11 - ay) / 9))
            if g[ay][ax] != ".":
                g[ay][ax] = "f"
        outline(g)
        # Trunk and roots, then a strip of grass; drawn after the outline so they keep their colours.
        for y in range(15, 20):
            g[y][8], g[y][9], g[y][10], g[y][11] = "o", "w", "b", "o"
        g[19][7] = g[19][12] = "o"
        for x in range(4, 16):
            g[20][x] = "l" if x in (6, 9, 13) else "g"
            g[21][x] = "o"
        g[20][4] = g[20][15] = "o"
        lx, ly = leaf[f]
        if g[ly][lx] == ".":
            g[ly][lx] = "l"
        frames.append(rows(g))
    return W, H, legend, frames, 220


def draw_sprite(agent, name, spec):
    w, h, legend, frames, ms = spec
    agent.call("new_sprite", width=w, height=h, name=name)
    for i, f in enumerate(frames):
        if i > 0:
            agent.call("add_frame", copy=False)
        agent.call("paint_slice", axis="z", index=0, rows=f, legend=legend, frame=i)
    agent.call("set_frame_duration", duration_ms=ms, all_frames=True)
    path = os.path.join(OUT, f"{name}.png")
    sheet = agent.call("export_sheet", path=path, views=["front"], scale=1)
    agent.call("review_model")  # what an agent does after each step; the result is not saved
    return {"src": f"/art/{name}.png", "w": w, "h": h, "frames": len(frames), "ms": ms, "axis": "x", "sheet": sheet}


# ---------------------------------------------------------------- voxel models

def tree_island(agent):
    agent.call("new_model", size_x=24, size_y=28, size_z=24, name="Tree island")
    agent.call("fill_box", **{"from": [2, 0, 2], "to": [21, 2, 21], "color": C["bark"]})
    agent.call("fill_box", **{"from": [2, 1, 2], "to": [21, 2, 21], "color": C["wood"]})
    agent.call("fill_box", **{"from": [2, 3, 2], "to": [21, 3, 21], "color": C["grass"]})
    agent.call("fill_box", **{"from": [4, 0, 4], "to": [19, 0, 19], "color": C["plum"]})
    agent.call("draw_cylinder", base=[11.5, 4, 11.5], radius=1.6, length=10, color=C["bark"])
    agent.call("draw_sphere", center=[11.5, 15, 11.5], radius=6, color=C["leaf"])
    agent.call("draw_sphere", center=[8.5, 17, 10.5], radius=4, color=C["grass"])
    agent.call("draw_sphere", center=[14.5, 18, 13.5], radius=4, color=C["grass"])
    agent.call("draw_sphere", center=[11.5, 20, 11.5], radius=3.5, color="#a6e15a")
    agent.call("draw_sphere", center=[11.5, 12, 11.5], radius=[6, 2, 6], color=C["forest"])
    flowers = [[5, 4, 6, C["red"]], [17, 4, 5, C["sun"]], [6, 4, 17, C["sun"]], [18, 4, 16, C["red"]], [15, 4, 19, "#ffffff"]]
    agent.call("set_voxels", voxels=flowers)
    agent.call("set_voxels", voxels=[[3, 4, 13, C["fog"]], [4, 4, 13, C["mist"]], [3, 4, 14, C["fog"]]])


def mushroom_house(agent):
    agent.call("new_model", size_x=22, size_y=24, size_z=22, name="Mushroom house")
    agent.call("draw_cylinder", base=[10.5, 0, 10.5], radius=10, length=1, color=C["grass"])
    agent.call("draw_cylinder", base=[10.5, 1, 10.5], radius=5, length=9, color=C["sand"])
    agent.call("fill_box", **{"from": [9, 1, 15], "to": [12, 5, 15], "color": C["bark"]})
    agent.call("set_voxels", voxels=[[11, 3, 15, C["gold"]], [6, 6, 13, C["sun"]], [15, 6, 13, C["sun"]]])
    agent.call("draw_sphere", center=[10.5, 13, 10.5], radius=[10, 6, 10], color=C["red"])
    agent.call("draw_sphere", center=[10.5, 10.5, 10.5], radius=[9, 2, 9], color=C["wine"])
    # White spots sit just on the cap's upper surface.
    spots = []
    for k in range(18):
        a = k * 2.399
        t = 0.18 + (k % 5) * 0.13          # 0 = top of the cap, 1 = its rim
        x = 10.5 + math.cos(a) * 10.2 * math.sin(t * math.pi / 2)
        z = 10.5 + math.sin(a) * 10.2 * math.sin(t * math.pi / 2)
        y = 13 + 6.2 * math.cos(t * math.pi / 2)
        for dx in (0, 1):
            spots.append([int(x) + dx, int(y), int(z), "#ffffff"])
    agent.call("set_voxels", voxels=spots)
    agent.call("draw_cylinder", base=[16.5, 1, 4.5], radius=1, length=2, color=C["sand"])
    agent.call("draw_sphere", center=[16.5, 3.5, 4.5], radius=[2, 1, 2], color=C["red"])


def turntable(agent, name, scale=4):
    path = os.path.join(OUT, f"{name}.png")
    sheet = agent.call("export_sheet", path=path, views=["turnaround8"], scale=scale)
    still = os.path.join(OUT, f"{name}-iso.png")
    agent.call("export_png", path=still, view="iso", scale=scale * 2)
    return {"src": f"/art/{name}.png", "still": f"/art/{name}-iso.png", "frames": 8, "ms": 220, "axis": "x", "sheet": sheet}


SPRITES = {"slime": slime_frames, "coin": coin_frames, "campfire": campfire_frames, "human": human_frames,
           "oak": tree_frames}


def read_manifest():
    text = open(MANIFEST).read()
    body = text.split("export const art = ", 1)[1].rsplit(" satisfies", 1)[0]
    return json.loads(body)


def add_boxes(art):
    """Records where each picture's pixels are, so pages can size art by what is drawn rather than by its canvas:
    `box` is [x, y, width, height] within one cell across all frames, and `boxes` the same for each frame."""
    from PIL import Image
    for a in art.values():
        im = Image.open(os.path.join(ROOT, "web", "public", a["src"].lstrip("/"))).convert("RGBA")
        boxes = []
        for f in range(a["frames"]):
            x, y = (f * a["w"], 0) if a["axis"] == "x" else (0, f * a["h"])
            b = im.crop((x, y, x + a["w"], y + a["h"])).getbbox()
            if b:
                boxes.append(b)
        x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        a["box"] = [x0, y0, x1 - x0, y1 - y0]
        if len(boxes) > 1:  # each frame on its own too, for pages that show one frame as a still
            a["boxes"] = [[b[0], b[1], b[2] - b[0], b[3] - b[1]] for b in boxes]


ART_TYPE = """export type Art = {
  src: string;
  still?: string;
  w: number;
  h: number;
  frames: number;
  ms: number;
  axis: "x" | "y";
  /** Where the drawn pixels are within one cell, across all frames: [x, y, width, height]. */
  box: [number, number, number, number];
  /** The same for each frame, when there is more than one. */
  boxes?: [number, number, number, number][];
};
"""


def write_manifest(art):
    add_boxes(art)
    with open(MANIFEST, "w") as f:
        f.write("// Generated by web/scripts/make-art.py: every picture was drawn and exported by OpenPixel.\n")
        f.write(ART_TYPE + "\n")
        body = json.dumps(art, indent=2)
        body = re.sub(r"\[\s+([\d,\s]+?)\s+\]", lambda m: "[" + ", ".join(m.group(1).split()).replace(",,", ",") + "]", body)
        body = re.sub(r"\[\s+((?:\[[\d, ]+\],?\s*)+)\]", lambda m: "[" + ", ".join(re.findall(r"\[[\d, ]+\]", m.group(1))) + "]", body)
        f.write("export const art = " + body + " satisfies Record<string, Art>;\n")
    print("wrote", MANIFEST)


def main():
    if not os.path.exists(APP):
        sys.exit("Build the app first: cd app && make")
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    if only:
        # `make-art.py human oak` redraws just those sprites and keeps every other entry as it is.
        art = read_manifest()
        agent = Agent()
        for name in only:
            art[name] = draw_sprite(agent, name, SPRITES[name]())
            art[name].pop("sheet", None)
            print("drew", name)
        agent.close()
        write_manifest(art)
        return
    agent = Agent()
    art = {}
    for name, make in SPRITES.items():
        art[name] = draw_sprite(agent, name, make())
        print("drew", name)

    # The treasure chest: the 2D sprite, then Make 3D.
    agent.call("open_model", path=CHEST)
    agent.call("export_png", path=os.path.join(OUT, "chest.png"), view="front", scale=1)
    art["chest"] = {"src": "/art/chest.png", "w": 32, "h": 32, "frames": 1, "ms": 0, "axis": "x"}
    agent.call("extrude_to_3d", depth=6)
    art["chest3d"] = turntable(agent, "chest3d", scale=3)
    print("drew chest")

    # The robot, made 3D the same way.
    agent.call("new_sprite", width=18, height=18, name="robot")
    agent.call("paint_slice", axis="z", index=0, rows=robot_frames()[3][0], legend=robot_frames()[2])
    agent.call("extrude_to_3d", depth=8)
    art["robot3d"] = turntable(agent, "robot3d", scale=4)
    print("drew robot3d")

    tree_island(agent)
    art["tree"] = turntable(agent, "tree", scale=4)
    print("drew tree")
    mushroom_house(agent)
    art["mushroom"] = turntable(agent, "mushroom", scale=4)
    print("drew mushroom")
    agent.close()

    # Cell sizes come from the exported sheets.
    try:
        from PIL import Image
    except ImportError:
        Image = None
    for name, a in art.items():
        path = os.path.join(ROOT, "web", "public", a["src"].lstrip("/"))
        if Image:
            iw, ih = Image.open(path).size
            if a["axis"] == "x":
                a["w"], a["h"] = iw // a["frames"], ih
            else:
                a["w"], a["h"] = iw, ih // a["frames"]
        a.pop("sheet", None)

    write_manifest(art)


if __name__ == "__main__":
    main()

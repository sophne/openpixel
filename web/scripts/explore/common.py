"""Shared helpers for the Explore art scripts: review pictures and one consistent set of exports per asset.

Every collection script draws with OpenPixel over MCP (op.Agent), then calls publish(), which:
  - runs review_model and keeps its issues in the manifest,
  - exports the files the Explore page offers for download,
  - saves the .openpixel source to web/artwork/explore/,
  - records the entry in web/scripts/explore/manifest/<script>.json.

Kinds and what they produce (all in web/public/explore/):
  sprite     a still 2D sprite      display: <slug>.png (1×)          downloads: png, html
  animation  a 2D sprite, 2+ frames display: <slug>.gif (upscaled)    downloads: png (sheet, 1×), gif, html
  voxel      a 3D voxel model       display: <slug>-view.png (iso render that fits the card)
                                                                      downloads: png, gif (turntable), html, vox
"""
import base64
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PUBLIC = os.path.join(ROOT, "web", "public", "explore")
SOURCES = os.path.join(ROOT, "web", "artwork", "explore")
MANIFESTS = os.path.join(HERE, "manifest")
REVIEWS = os.environ.get("REVIEW_DIR") or os.path.join(HERE, ".review")

for d in (PUBLIC, SOURCES, MANIFESTS, REVIEWS):
    os.makedirs(d, exist_ok=True)


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def gif_size(path):
    with open(path, "rb") as f:
        head = f.read(10)
    return struct.unpack("<HH", head[6:10])


def review(a, name, frame=None):
    """Runs review_model, saves its pictures as <REVIEW_DIR>/<name>-<n>.png and returns (report, picture paths).
    Look at the pictures (Read them) and fix what the report lists before publishing."""
    args = {} if frame is None else {"frame": frame}
    r = a.call_raw("review_model", **args)
    text = next((c["text"] for c in r["content"] if c["type"] == "text"), "{}")
    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        report = {"raw": text}
    paths = []
    for i, c in enumerate(c for c in r["content"] if c["type"] == "image"):
        p = os.path.join(REVIEWS, f"{name}-{i + 1}.png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(c["data"]))
        paths.append(p)
    return report, paths


def summary(report):
    """The parts of a review report worth printing."""
    keep = ("issues", "tips", "pixel_art", "parts", "size", "bounds")
    return {k: report[k] for k in keep if k in report}


# The art area of an Explore card in CSS pixels (BOX in src/components/ExploreBrowser.tsx).
VIEW_BOX = {"small": (208, 176), "wide": (520, 292)}


def _scale(longest, target, lo, hi):
    return max(lo, min(hi, target // max(1, longest)))


class Collection:
    """Collects the entries one script publishes and writes its manifest."""

    def __init__(self, script, collection):
        assert collection in ("characters", "scenes", "assets")
        self.script, self.collection, self.entries = script, collection, []

    def publish(self, a, slug, title, kind, voxel_view="iso", voxel_scale=None, gif_scale=None, gif_view="iso"):
        assert kind in ("sprite", "animation", "voxel"), kind
        info = a.call("get_model_info")
        sx, sy, sz = info["size"]
        frames = len(info["frames"])
        report, _ = review(a, slug)
        out = lambda ext: os.path.join(PUBLIC, f"{slug}{ext}")
        url = lambda ext: f"/explore/{slug}{ext}"
        a.call("save_model", path=os.path.join(SOURCES, f"{slug}.openpixel"))
        e = {"slug": slug, "title": title, "collection": self.collection, "kind": kind,
             "size": [sx, sy, sz], "frames": frames, "issues": report.get("issues", [])}
        if kind == "sprite":
            a.call("export_png", path=out(".png"), scale=1)
            a.call("export_html", path=out(".html"), zoom=_scale(max(sx, sy), 512, 2, 16))
            e["display"] = url(".png")
            e["downloads"] = {"png": url(".png"), "html": url(".html")}
        elif kind == "animation":
            assert frames > 1, f"{slug}: an animation needs 2+ frames"
            s = gif_scale or _scale(max(sx, sy), 512, 2, 16)
            a.call("export_sheet", path=out(".png"), scale=1)
            a.call("export_gif", path=out(".gif"), scale=s, kind="animation")
            a.call("export_html", path=out(".html"), kind="animation", zoom=s)
            e["display"] = url(".gif")
            e["downloads"] = {"png": url(".png"), "gif": url(".gif"), "html": url(".html")}
            e["frame_durations_ms"] = [f["duration_ms"] for f in info["frames"]]
        else:
            s = voxel_scale or _scale(max(sx, sy, sz), 224, 3, 12)
            a.call("export_png", path=out(".png"), view=voxel_view, scale=s)
            a.call("export_gif", path=out(".gif"), kind="turntable", scale=s, steps=16)
            a.call("export_html", path=out(".html"), kind="turntable", steps=8)
            a.call("export_vox", path=out(".vox"))
            # The page shows a separate render at the largest scale that fits its card as is: a render can't be
            # shrunk on the page without dropping pixels. The PNG download stays large.
            box = VIEW_BOX["wide" if self.collection == "scenes" else "small"]
            for v in range(s, 1, -1):
                a.call("export_png", path=out("-view.png"), view=voxel_view, scale=v)
                w, h = png_size(out("-view.png"))
                if w <= box[0] and h <= box[1]:
                    break
            e["display"] = url("-view.png")
            e["display_scale"] = 1
            e["downloads"] = {"png": url(".png"), "gif": url(".gif"), "html": url(".html"), "vox": url(".vox")}
        disp = os.path.join(ROOT, "web", "public") + e["display"]
        e["display_size"] = list(gif_size(disp) if disp.endswith(".gif") else png_size(disp))
        self.entries = [x for x in self.entries if x["slug"] != slug] + [e]
        self.write()
        print(f"published {slug} ({kind}, {sx}×{sy}×{sz}, {frames} frame(s)) issues={e['issues']}")
        return e

    def write(self):
        with open(os.path.join(MANIFESTS, f"{self.script}.json"), "w") as f:
            json.dump(self.entries, f, indent=2, ensure_ascii=False)

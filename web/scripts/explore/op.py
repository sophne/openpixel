"""Tiny MCP client for OpenPixel (headless), shared by the Explore art scripts.

Starts the native `openpixel` program: the one at $OPENPIXEL if set, else this repository's build
(core/target/release/openpixel), else the installed app's (see ../find_openpixel.py). It refuses a program without
the agent harness the Explore art is made with (pixel_art_guide, colour ramps, sprite checks).
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import find_openpixel  # noqa: E402

ROOT = find_openpixel.ROOT
APP = find_openpixel.program()

# Tools the Explore art needs; an older OpenPixel doesn't have them all.
NEEDS = ("pixel_art_guide", "make_color_ramp", "review_model")


class Agent:
    def __init__(self):
        self.p = subprocess.Popen([find_openpixel.require(APP), "--mcp", "--headless"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.n = 0
        self.info = self.rpc("initialize", {"protocolVersion": "2025-06-18",
                                            "clientInfo": {"name": "openpixel-explore", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        version = self.info.get("serverInfo", {}).get("version", "?")
        tools = {t["name"] for t in self.rpc("tools/list", {}).get("tools", [])}
        missing = [t for t in NEEDS if t not in tools]
        if missing:
            self.close()
            raise SystemExit(f"{APP} is OpenPixel {version} and lacks {', '.join(missing)}: the Explore art needs a "
                             "newer one. Set OPENPIXEL.")

    def rpc(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
        self.p.stdin.flush()
        reply = json.loads(self.p.stdout.readline())
        if "error" in reply:
            raise RuntimeError(f"{method}: {reply['error']}")
        return reply["result"]

    def call_raw(self, tool, **args):
        return self.rpc("tools/call", {"name": tool, "arguments": args})

    def call(self, tool, **args):
        r = self.call_raw(tool, **args)
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

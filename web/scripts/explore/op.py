"""Tiny MCP client for OpenPixel (headless), shared by the Explore art scripts.

Uses the OpenPixel at $OPENPIXEL if set, else app/OpenPixel.app, else /Applications, and refuses anything older than
1.1.0: the Explore art is made with the 1.1.0 agent harness (pixel_art_guide, colour ramps, sprite checks).
"""
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
APP = os.environ.get("OPENPIXEL") or os.path.join(ROOT, "app", "OpenPixel.app", "Contents", "MacOS", "OpenPixel")
if not os.path.exists(APP):
    APP = "/Applications/OpenPixel.app/Contents/MacOS/OpenPixel"


MIN_VERSION = (1, 1, 0)


class Agent:
    def __init__(self):
        self.p = subprocess.Popen([APP, "--mcp", "--headless"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.n = 0
        self.info = self.rpc("initialize", {"protocolVersion": "2025-06-18",
                                            "clientInfo": {"name": "openpixel-explore", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        version = self.info.get("serverInfo", {}).get("version", "0")
        if tuple(int(x) for x in version.split(".")[:3]) < MIN_VERSION:
            self.close()
            raise SystemExit(f"{APP} is OpenPixel {version}; the Explore art needs 1.1.0 or newer. Set OPENPIXEL.")

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

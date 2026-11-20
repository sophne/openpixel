#!/usr/bin/env python3
"""Takes public/editor-3d.png: the editor in 3D with the voxel Mushroom house (the model web/scripts/make-art.py
draws, saved as mushroom-house.openpixel). Uses the same screenshot as make-hero.py.

    python3 web/scripts/make-shot-3d.py            retake the picture from the saved model
    python3 web/scripts/make-shot-3d.py --model    rebuild the model with make-art.py's steps first
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SOURCE = os.path.join(HERE, "mushroom-house.openpixel")
SHOT = os.path.join(ROOT, "web", "public", "editor-3d.png")


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if "--model" in sys.argv:
        art = load("make_art", "make-art.py")
        agent = art.Agent()
        try:
            art.mushroom_house(agent)
            agent.call("save_model", path=SOURCE)
            print("saved", SOURCE)
        finally:
            agent.close()
    load("make_hero", "make-hero.py").screenshot(SOURCE, SHOT, "Mushroom house")


if __name__ == "__main__":
    main()

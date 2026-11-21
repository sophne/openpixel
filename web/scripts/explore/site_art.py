#!/usr/bin/env python3
"""Explore page, OpenPixel Assets collection: the pixel art drawn for the website itself, in the app's empty-state style
(grays and the accent orange). web/scripts/make-feature-art.py draws and saves them to web/artwork/features/; this
opens each source with OpenPixel and publishes it like every other Explore piece (review, downloads, manifest).

    python3 web/scripts/make-feature-art.py         # first, if the art changed
    OPENPIXEL=… python3 site_art.py                 # then this, then build.py
"""
import os

import common
import op

col = common.Collection("site_art", "site")
ART = os.path.join(common.ROOT, "web", "artwork", "features")

# Source name, Explore slug, title. Order: the examples first, then the feature pictures.
PIECES = [
    ("chest", "site-chest", "Treasure Chest"),
    ("person", "site-person", "Waving Person"),
    ("appletree", "site-appletree", "Apple Tree"),
    ("voxtree", "site-voxtree", "Voxel Tree"),
    ("mushroom", "site-mushroom", "Mushroom House"),
    ("chest3d", "site-chest3d", "Voxel Chest"),
    ("slime", "site-slime", "Bouncing Slime"),
    ("coin", "site-coin", "Spinning Coin"),
    ("campfire", "site-campfire", "Campfire"),
    ("sword", "site-sword", "Sword"),
    ("potion", "site-potion", "Potion"),
    ("house", "site-house", "Voxel House"),
    ("crystal", "site-crystal", "Crystals"),
    ("heart", "site-heart", "Beating Heart"),
    ("ghost", "site-ghost", "Floating Ghost"),
    ("native", "site-native", "Lightning Window"),
    ("layers", "site-layers", "Layers"),
    ("onion", "site-onion", "Onion Skin"),
    ("mirror", "site-mirror", "Mirror Heart"),
    ("palettes", "site-palettes", "Palette"),
    ("iso", "site-iso", "Floating Cube"),
    ("sheets", "site-sheets", "Sprite Sheet"),
    ("gif", "site-gif", "Loop"),
    ("vox", "site-vox", "Voxel Stack"),
    ("import", "site-import", "Picture Drop"),
    ("make3d", "site-make3d", "Rising Cube"),
    ("agent", "site-agent", "Agent Sparkle"),
    ("voxagent", "site-voxagent", "Voxel Builder"),
]


def main():
    a = op.Agent()
    for name, slug, title in PIECES:
        a.call("open_model", path=os.path.join(ART, f"{name}.openpixel"))
        frames = len(a.call("get_model_info")["frames"])
        col.publish(a, slug, title, "animation" if frames > 1 else "sprite", gif_scale=12)
    a.close()


if __name__ == "__main__":
    main()

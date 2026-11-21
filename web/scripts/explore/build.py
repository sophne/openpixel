#!/usr/bin/env python3
"""Merges the manifests the Explore art scripts wrote into web/src/lib/explore.ts.

    python3 web/scripts/explore/build.py

Run it after the art scripts (characters_*.py, scenes_*.py, assets_*.py). Each entry gets `px`, the size of its
display picture in art pixels, and `scale`, how many picture pixels make one art pixel, so the page can show every
picture at a whole-number zoom.
"""
import glob
import json
import os

import common

# What each piece shows, beyond its title: the semantic search on the page matches queries against these words.
KEYWORDS = {
    "char-knight": "armored medieval warrior with sword and shield, hero, soldier, fantasy fighter, castle guard",
    "char-wizard": "old mage casting a spell with a magic staff, sorcerer, robe, arcane, fantasy",
    "char-slime": "cute green jelly blob monster that bounces, goo, enemy",
    "char-skeleton": "undead bones warrior, spooky, halloween, graveyard, skull",
    "char-pirate": "sailor with hat, sea, ship, treasure, buccaneer",
    "char-ninja": "stealthy assassin running, shadow warrior, japan, martial arts",
    "char-astronaut": "space explorer in a suit and helmet, cosmonaut, rocket, moon",
    "char-ghost": "floating spooky spirit, haunted, halloween, phantom",
    "char-fox": "cute animal archer adventurer in the forest, woodland",
    "char-cat": "cute pet kitten sitting, animal, halloween",
    "char-frog": "amphibian warrior, pond, cute animal hero",
    "char-dragon": "cute flying reptile with wings, breathes fire, fantasy creature",
    "char-robot": "friendly machine android, mech, technology, sci-fi",
    "char-mushroom": "little fungus creature, forest, cute",
    "char-viking": "norse warrior with horned helmet and axe, beard",
    "char-witch": "flying sorceress, magic, halloween, night",
    "scene-cabin": "winter night, log house in the snow, cozy, falling snowflakes, cold",
    "scene-beach": "ocean waves, sand, sea shore, summer, tropical evening",
    "scene-dungeon": "dark stone corridor underground, castle cellar, torches",
    "scene-neon": "cyberpunk night city skyline, buildings, lights, urban",
    "scene-lake": "dawn, peaks reflected in calm water, nature, landscape",
    "scene-oasis": "sand dunes, palm trees, pool of water, hot sun",
    "scene-island": "sky island with a tree and waterfall, fantasy, clouds",
    "scene-camp": "camping in the woods, tent, fire, logs, trees",
    "scene-space": "outer space, stars, galaxy, comet, cosmos",
    "scene-reef": "underwater ocean, fish, bubbles, sea life, kelp",
    "scene-shrine": "japanese cherry blossom temple gate, sakura, spring",
    "scene-rain": "night street in the rain, coffee shop, city, puddles",
    "scene-volcano": "erupting lava mountain, sea, fire, tropical",
    "scene-autumn": "fall forest trail, orange leaves, trees, woods",
    "scene-lighthouse": "tower on a cliff at night, sea, beam of light, coast",
    "scene-cottage": "small house with garden and fence, village, home",
    "item-sword": "weapon, blade, steel, medieval",
    "item-potion": "red bottle of magic liquid, flask, elixir, healing",
    "item-chest": "wooden box full of loot, gold, reward",
    "item-coin": "gold money, currency, treasure",
    "item-heart": "health, life, love",
    "item-staff": "wizard wand, weapon, spell",
    "item-gem": "jewel, diamond, precious stone, treasure",
    "item-shield": "armor, defense, medieval",
    "item-bomb": "explosive with a lit fuse, dynamite, blast",
    "item-key": "unlock door, lock",
    "item-mushroom": "toadstool, fungus, forest, power-up",
    "item-torch": "fire, flame, light, burning",
    "item-spellbook": "magic tome, book, grimoire",
    "item-bow": "archery weapon, ranged, hunting",
    "item-barrel": "wooden cask, keg, container",
    "item-ramen": "noodle soup, food, japanese, hot meal",
    "site-chest": "treasure box with an orange lock, loot, gray and orange, openpixel style",
    "site-person": "character waving hello, greeting, person in an orange shirt",
    "site-appletree": "round tree with orange apples, fruit, nature",
    "site-voxtree": "isometric tree on a grass block, cubes, 3d",
    "site-mushroom": "isometric toadstool house with an orange cap, door and window, cottage",
    "site-chest3d": "isometric treasure box, cubes, loot, 3d",
    "site-slime": "orange jelly blob bouncing, squash and stretch, cute monster",
    "site-coin": "orange coin spinning, money, gold, collectible",
    "site-campfire": "fire burning on crossed logs, flames, camping, embers",
    "site-sword": "blade with an orange guard and pommel, weapon, steel",
    "site-potion": "round glass flask of orange liquid with a cork, elixir, magic drink",
    "site-house": "isometric cottage with a stepped orange roof, chimney, lit window, home",
    "site-crystal": "orange gem shards growing from a gray rock, isometric, mineral, treasure",
    "site-heart": "orange heart beating, pulse, health, love, life",
    "site-ghost": "white spooky spirit floating up and down, halloween, cute phantom",
    "site-native": "app window with a lightning bolt, fast, speed, power",
    "site-layers": "three stacked sheets, the top one lifting, stack, levels",
    "site-onion": "bouncing ball with faint earlier frames, motion trail, animation",
    "site-mirror": "heart drawn on both sides of a mirror line, symmetry, love",
    "site-palettes": "colour swatches with a moving selection, paint, colors",
    "site-iso": "isometric cube floating over its shadow, box, 3d",
    "site-sheets": "grid of frames lighting up in turn, tiles, animation strip",
    "site-gif": "play button inside a looping arrow, repeat, video",
    "site-vox": "cube dropping onto a stack of cubes, blocks, building",
    "site-import": "picture dropping into a frame, photo, image, upload",
    "site-make3d": "flat tile rising into a cube, extrude, 3d",
    "site-agent": "sparkle drawing a heart on a canvas, ai, magic, star",
    "site-voxagent": "sparkle building a stack of cubes, ai, magic, blocks",
}

ORDER = ["characters", "assets", "scenes", "site"]
TITLES = {"characters": "Characters", "scenes": "Scenes", "assets": "Assets", "site": "OpenPixel Assets"}

entries = []
for path in sorted(glob.glob(os.path.join(common.MANIFESTS, "*.json"))):
    if os.path.basename(path).startswith("_"):
        continue
    with open(path) as f:
        entries += json.load(f)

seen = set()
out = []
for e in entries:
    assert e["slug"] not in seen, f"duplicate slug {e['slug']}"
    seen.add(e["slug"])
    missing = [u for u in [e["display"], *e["downloads"].values()]
               if not os.path.exists(os.path.join(common.ROOT, "web", "public") + u)]
    if missing:
        # An art script may still be exporting this one: leave it out until its files are all there.
        print(f"skipping {e['slug']}: missing {', '.join(missing)}")
        continue
    sx, sy, sz = e["size"]
    dw, dh = e["display_size"]
    if "display_scale" in e:
        s = e["display_scale"]
    else:
        s = max(1, round(dw / sx))
    out.append({
        "slug": e["slug"],
        "title": e["title"],
        "keywords": KEYWORDS.get(e["slug"], ""),
        "collection": e["collection"],
        "kind": e["kind"],
        "src": e["display"],
        "w": dw,
        "h": dh,
        "scale": s,
        "downloads": e["downloads"],
    })

out.sort(key=lambda e: ORDER.index(e["collection"]))
collections = [{"id": c, "title": TITLES[c], "items": [e for e in out if e["collection"] == c]} for c in ORDER]

ts = """// Generated by web/scripts/explore/build.py from the art the Explore scripts drew with OpenPixel. Don't edit by hand.

export type ExploreKind = "sprite" | "animation" | "voxel";
export type ExploreFormat = "png" | "gif" | "html" | "vox";

export type ExploreItem = {
  slug: string;
  title: string;
  /** Words describing the piece, for the semantic search. */
  keywords: string;
  collection: "characters" | "scenes" | "assets" | "site";
  /** sprite: a still 2D picture; animation: an animated GIF; voxel: an isometric render of a 3D model. */
  kind: ExploreKind;
  /** The picture shown on the page, and its size in picture pixels. */
  src: string;
  w: number;
  h: number;
  /** Picture pixels per art pixel (1 for 1× sprites; the export zoom for GIFs and voxel renders). */
  scale: number;
  downloads: Partial<Record<ExploreFormat, string>>;
};

export type ExploreCollection = { id: ExploreItem["collection"]; title: string; items: ExploreItem[] };

export const collections: ExploreCollection[] = """ + json.dumps(collections, indent=2, ensure_ascii=False) + ";\n"

with open(os.path.join(common.ROOT, "web", "src", "lib", "explore.ts"), "w") as f:
    f.write(ts)
print({c["id"]: len(c["items"]) for c in collections})

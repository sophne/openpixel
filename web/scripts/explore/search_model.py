#!/usr/bin/env python3
"""Packs a small embedding model for the Explore page's semantic search, served from this site (no outside requests).

    python3 web/scripts/explore/search_model.py      (needs: pip install huggingface_hub safetensors numpy)

The model is minishlab/potion-base-4M (MIT), a model2vec static model: a sentence's vector is the mean of its
WordPiece tokens' vectors, so the browser only needs the vocabulary and one table, no neural-network runtime.
Writes web/public/explore/search/:
  vocab.txt   one token per line, row i of the table
  vectors.bin int8 table, rows × dims, then one float32 scale per row (little-endian)
  meta.json   {"rows", "dims", "model"}
  LICENSE.txt the model's MIT licence, which must travel with every copy
Tokens no English query can produce (unused slots, non-Latin scripts) are left out to keep it small.
"""
import json
import os
import re

import numpy as np
from huggingface_hub import snapshot_download
from safetensors.numpy import load_file

import common

MODEL = "minishlab/potion-base-4M"
LICENSE = """potion-base-4M (https://huggingface.co/minishlab/potion-base-4M), a Model2Vec model by MinishLab.
vocab.txt and vectors.bin here are a packed copy of it, made by web/scripts/explore/search_model.py.

MIT License

Copyright (c) 2024 Thomas van Dongen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
OUT = os.path.join(common.PUBLIC, "search")
os.makedirs(OUT, exist_ok=True)

path = snapshot_download(MODEL, allow_patterns=["model.safetensors", "vocab.txt"])
table = next(iter(load_file(os.path.join(path, "model.safetensors")).values())).astype(np.float32)
with open(os.path.join(path, "vocab.txt"), encoding="utf-8") as f:
    vocab = f.read().split("\n")[: table.shape[0]]

keep = [i for i, t in enumerate(vocab) if re.fullmatch(r"(##)?[a-z0-9]+", t)]
rows = table[keep]
scale = np.abs(rows).max(axis=1) / 127
scale[scale == 0] = 1
q = np.clip(np.round(rows / scale[:, None]), -127, 127).astype(np.int8)

with open(os.path.join(OUT, "vocab.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(vocab[i] for i in keep))
with open(os.path.join(OUT, "vectors.bin"), "wb") as f:
    f.write(q.tobytes())
    f.write(scale.astype("<f4").tobytes())
with open(os.path.join(OUT, "LICENSE.txt"), "w") as f:
    f.write(LICENSE)
with open(os.path.join(OUT, "meta.json"), "w") as f:
    json.dump({"rows": len(keep), "dims": int(rows.shape[1]), "model": MODEL}, f)
print(f"{len(keep)} of {len(vocab)} tokens, {rows.shape[1]} dims")

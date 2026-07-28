#!/usr/bin/env python3
"""Measure real material photographs and emit data/materials.csv.

The renderer has no texture sampler yet (that is a separate increment), but the
*look* of a surface is mostly its colour statistics, and those we can harvest
today: mean albedo and per-channel variance measured off real 2K photographs, used
to drive the procedural grain already shipping in `shaders/cube.frag`.

So instead of hand-guessed cell colours — the world was still using the maze demo's
"rock / grass / water / sand" palette — every surface gets a **measured** albedo and
a measured busy-ness that sets how strong its grain should be. Rust is genuinely
mottled; rubber tiles are genuinely flat; the numbers say so rather than a guess.

    python tools/measure_materials.py [--pack <dir>]

Colour space matters and is the easy thing to get wrong: source JPGs are sRGB-
encoded, the shader works in LINEAR and encodes at the very end (render.md), so the
mean MUST be taken after linearising. Averaging sRGB values gives a systematically
too-bright answer — for a mid-grey the error is about 2x.

Provenance is recorded per row. The pack is Poly Haven, CC0, with an in-tree
manifest declaring per-asset source URLs; nothing is copied into this repository —
only the measured numbers, which are facts about the images rather than the images.
"""

import argparse
import csv
import json
import os
import sys

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.stderr.write("measure_materials: needs Pillow and numpy "
                     "(pip install pillow numpy)\n")
    sys.exit(2)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_CSV = os.path.join(REPO, "data", "materials.csv")

# Default pack location on this machine. Deliberately a default and not a
# hard-coded requirement: the emitted CSV is committed, so nobody else needs the
# pack present to build.
DEFAULT_PACK = os.path.join(
    "C:", os.sep, "hades", "Hecton8", "Assets", "_Project", "Art", "TEXTURES",
    "Generated", "ExternalPBR_20260607", "PolyHaven")

SAMPLE = 256   # downsample before measuring; statistics converge long before 2K


def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def measure(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im.resize((SAMPLE, SAMPLE), Image.BILINEAR),
                   dtype=np.float32) / 255.0
    lin = srgb_to_linear(a).reshape(-1, 3)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return {
        "w": im.width, "h": im.height,
        "mean": lin.mean(0),
        "lum_std": float(lum.std()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default=DEFAULT_PACK)
    args = ap.parse_args()

    if not os.path.isdir(args.pack):
        sys.stderr.write("measure_materials: pack not found: %s\n"
                         "The committed data/materials.csv already carries the "
                         "measurements; you only need the pack to re-measure.\n"
                         % args.pack)
        sys.exit(1)

    manifest = {}
    mpath = os.path.join(args.pack, "PolyHavenExternalPBR_Manifest.json")
    if os.path.isfile(mpath):
        with open(mpath, encoding="utf-8") as fh:
            m = json.load(fh)
        for a in m.get("assets", []):
            manifest[a["id"]] = a
        licence = m.get("license", "UNKNOWN")
        provider = m.get("sourceProvider", "UNKNOWN")
    else:
        sys.stderr.write("measure_materials: no manifest — provenance would be "
                         "unverifiable, refusing. Do not harvest what you cannot "
                         "attribute.\n")
        sys.exit(1)

    rows = []
    for name in sorted(os.listdir(args.pack)):
        d = os.path.join(args.pack, name)
        if not os.path.isdir(d):
            continue
        base = [f for f in os.listdir(d)
                if "BaseColor" in f and f.lower().endswith((".jpg", ".png"))]
        if not base:
            continue
        st = measure(os.path.join(d, base[0]))
        info = manifest.get(name, {})
        rows.append({
            "id": name,
            "provider": provider,
            "license": info.get("license", licence),
            "source": info.get("source", ""),
            "src_w": st["w"],
            "src_h": st["h"],
            # Linear albedo. Four decimals is well inside 8-bit quantisation.
            "lin_r": round(float(st["mean"][0]), 4),
            "lin_g": round(float(st["mean"][1]), 4),
            "lin_b": round(float(st["mean"][2]), 4),
            # Luminance standard deviation = how mottled the material is. This is
            # what drives per-material grain strength in the shader.
            "lum_std": round(st["lum_std"], 4),
            "role": info.get("role", ""),
        })

    if not rows:
        sys.stderr.write("measure_materials: no BaseColor images found\n")
        sys.exit(1)

    with open(OUT_CSV, "w", encoding="utf-8", newline="\n") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    sys.stderr.write("measure_materials: measured %d materials (%s, %s) -> %s\n"
                     % (len(rows), provider, licence, OUT_CSV))


if __name__ == "__main__":
    main()

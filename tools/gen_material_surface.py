#!/usr/bin/env python3
"""Generate shaders/material_surface.glsl from data/materials.csv.

Fourth generated table in the tree, same contract as gen_item_table.py /
gen_mob_table.py / gen_weapon_table.py: the CSV is the truth, the generated file is
committed so the build needs no Python, an unknown token is a hard error, and the
`source_rules` ctest compares the CSV's row count against the count this generator
declares. Registered in tools/check_source_rules.cmake in the same change as this
file, not afterwards.

    python tools/gen_material_surface.py

WHAT THIS FIXES
---------------
data/materials.csv has carried a measured `lum_std` per material since the harvest,
and nothing in the renderer read it. cube_pass.cpp consumed the mean colour and
cube.frag applied ONE generic two-octave noise to every surface, so a rusted plate,
dirty plaster and varnished parquet differed only in average colour. The measured
character of each surface sat unused in a CSV.

WHY IT EMITS GLSL AND NOT C++
-----------------------------
The only consumer is shaders/cube.frag. Nothing on the CPU needs a material's
surface character — cube_pass already knows the material id and now forwards it.
Emitting a C++ header as well would create two copies of one table with nothing
enforcing agreement, which is exactly the drift the other three generators exist to
prevent. One table, generated, #included by the shader.

THE MEASUREMENT, AND WHAT IT IS NOT
-----------------------------------
`lum_std` is the standard deviation of LINEAR luminance over a 256x256 resample of
the source photograph (tools/measure_materials.py). It is an ABSOLUTE dispersion, so
it cannot be used as a brightness-modulation amplitude directly: rubber_tiles has
lum_std 0.0011 against a mean luminance of 0.0152, and corrugated_iron has 0.0287
against a mean of 0.4376 — the second number is 26x larger and describes the FLATTER
surface. What drives a multiplicative brightness field is the coefficient of
variation, std/mean, and that reverses the order: 0.072 for the rubber, 0.066 for the
corrugated iron.

The shader modulates albedo by exp(sigma*n - sigma^2/2) where n is a zero-mean,
unit-variance procedural field. That form is chosen for three properties:

  * it is strictly positive, so no clamp is needed and no amount of variation can
    lift a fogged pixel off black (cube.frag's f(0) == 0 requirement),
  * the -sigma^2/2 term makes it mean-preserving, so the MEASURED mean albedo in
    cube_pass.cpp kMaterial survives untouched,
  * for a lognormal, CV = sqrt(exp(sigma^2) - 1), so sigma = sqrt(ln(1 + CV^2))
    reproduces the measured coefficient of variation exactly rather than
    approximately. Using sigma = CV directly would run 5% hot at the rust end.

What is NOT measured, and is authored per family instead: the DEPTH of a seam, grout
line, plank joint or tread valley. The CSV holds colour statistics of a flat-lit
photograph and no depth information at all, so a groove's darkness cannot be derived
from it. Those constants live in cube.frag and are labelled there.
"""

import csv
import math
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "materials.csv")
OUT_PATH = os.path.join(REPO, "shaders", "material_surface.glsl")

# Must equal kMatCount in src/world/materials.h. Not imported — this is a generator,
# not a compiler — so it is asserted against the row count below and the generated
# GLSL carries a matching array length.
MAT_COUNT = 16

# Structure families. Must match the kFam* constants in shaders/cube.frag.
FAM = {
    "generic": 0,   # two-octave grain + 2 m panel seam — the pre-existing look
    "plaster": 1,   # fine mottle + broad damp/dirt staining + panel seam
    "plank": 2,     # directional boards, staggered butt joints, along-grain streaks
    "tile": 3,      # square grid, recessed grout, per-tile shade jitter
    "ribbed": 4,    # corrugation / shutter slats, lit crest and dark trough
    "tread": 5,     # regular raised lozenges on a staggered lattice
    "rust": 6,      # large irregular patches with fine pitting inside them
    "rubble": 7,    # irregular chunk plateaus with dark cracks between
    "smooth": 8,    # near-flat painted plate, no seams (gameplay markers)
}

# One row per material id in src/world/materials.h, in id order.
#
#   (id, name, family, csv_id, authored_cv, note)
#
# csv_id is the data/materials.csv row the amplitude is MEASURED from, or None when
# the pack has no photograph of this material — the honest split materials.h already
# records: the Poly Haven set is a deep-sea game's metal library and contains no
# plaster, parquet, wallpaper or linoleum. authored_cv is used only when csv_id is
# None, and every authored number carries its reason.
#
# `pitch` is the family's primary structural frequency in CYCLES PER CELL (one cell
# is kCellSize = 2 m), so 20 means a 10 cm feature. It is authored, not measured: it
# is a length, and the CSV measured colour.
MATERIALS = [
    (0, "air / body sentinel", "generic", None, 0.0, 0.0,
     "never drawn by the world pass; body.vert writes this id so bodies keep the "
     "pre-existing look exactly"),
    (1, "concrete (maze)", "generic", None, 0.0, 0.0,
     "maze test bed — left on the legacy path so app/worldgen.cpp renders as it did"),
    (2, "soil (maze)", "generic", None, 0.0, 0.0, "maze test bed"),
    (3, "water marker (maze)", "generic", None, 0.0, 0.0, "maze test bed"),
    (4, "tan slab (maze)", "generic", None, 0.0, 0.0, "maze test bed"),
    (5, "extraction pad", "smooth", None, 0.03, 0.0,
     "the bank must stay unmistakable (materials.h) — a painted plate, no seams, "
     "almost no mottle, so the emerald reads as signage and not as a surface"),
    (6, "unused", "generic", None, 0.0, 0.0, "no generator writes this id"),
    (7, "nav / hub pad", "smooth", None, 0.03, 0.0, "as the extraction pad"),
    (8, "plaster", "plaster", None, 0.13, 0.7,
     "AUTHORED: the pack has no plaster photograph. Dirty whitewash over precast "
     "panel — clearly mottled, not blotchy. Broad stain blobs at 0.7 cycles/cell "
     "(~2.9 m) give one apartment a different wall from the next"),
    (9, "parquet", "plank", None, 0.11, 20.0,
     "AUTHORED: the pack has no wood photograph. Varnish is even within a board; "
     "the visible variation is board-to-board tone, which the plank family puts in "
     "structure rather than in noise. 20 cycles/cell = 10 cm boards"),
    (10, "shop shutter", "ribbed", "painted_metal_shutter", None, 28.0,
     "roller-shutter slats, 28 cycles/cell = 7 cm"),
    (11, "lino", "tile", "rubber_tiles", None, 4.0,
     "the CSV role for this row is literally 'smooth dark waterproof rubber with "
     "seams' — the seams are the character, the mottle is nearly nil. 50 cm tiles"),
    (12, "factory wall", "ribbed", "factory_wall", None, 13.0,
     "green corrugated factory metal. Coarser corrugation than a shutter, 15 cm, "
     "which is what keeps it distinguishable from id 10 beyond its colour"),
    (13, "tread plate", "tread", "metal_grate_rusty", None, 8.0,
     "walkway grate. 8 cycles/cell = 25 cm studs, coarser than the ~3 cm of real "
     "chequer plate: at the range the headlamp lights, real pitch is sub-pixel mush"),
    (14, "rust", "rust", "rusty_metal_03", None, 1.3,
     "render.md: real rust has long-range spatial correlation that FBM reproduces "
     "badly, so the patches come from a THRESHOLDED low-frequency field, not from "
     "another octave. 1.3 cycles/cell = ~1.5 m patches"),
    (15, "rubble", "rubble", "rusty_corrugated_iron", None, 6.0,
     "measured amplitude is a hair above rust (0.4437 vs 0.4411 CV) so amplitude "
     "alone cannot separate the two Derelict surfaces — the family does it: chunk "
     "plateaus at 33 cm read as debris where rust reads as staining"),
]

# Rec. 709 luminance, matching tools/measure_materials.py.
LUM = (0.2126, 0.7152, 0.0722)


def die(msg):
    sys.stderr.write("gen_material_surface: %s\n" % msg)
    sys.exit(1)


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    by_id = {r["id"]: r for r in rows}
    if len(by_id) != len(rows):
        die("duplicate id in %s" % CSV_PATH)

    if len(MATERIALS) != MAT_COUNT:
        die("MATERIALS has %d entries but MAT_COUNT is %d — it must carry one row "
            "per id in src/world/materials.h" % (len(MATERIALS), MAT_COUNT))
    for i, m in enumerate(MATERIALS):
        if m[0] != i:
            die("MATERIALS is not in id order: entry %d declares id %d" % (i, m[0]))

    out = []
    for mid, name, fam, csv_id, authored, pitch, note in MATERIALS:
        if fam not in FAM:
            die("material %d (%s) has unknown family %r" % (mid, name, fam))
        if csv_id is not None:
            r = by_id.get(csv_id)
            if r is None:
                die("material %d (%s) is measured from %r, which is not a row in "
                    "%s — a re-harvest renamed or dropped it, and the amplitude "
                    "would have silently fallen back to a guess"
                    % (mid, name, csv_id, CSV_PATH))
            lin = [float(r["lin_r"]), float(r["lin_g"]), float(r["lin_b"])]
            mean = sum(c * w for c, w in zip(lin, LUM))
            if mean <= 0.0:
                die("material %d (%s): source row %r has non-positive mean "
                    "luminance" % (mid, name, csv_id))
            cv = float(r["lum_std"]) / mean
            src = csv_id
        else:
            cv = authored
            src = "authored"
        # Lognormal sigma that reproduces this coefficient of variation exactly.
        sigma = math.sqrt(math.log(1.0 + cv * cv))
        if not (0.0 <= sigma < 1.0):
            die("material %d (%s): sigma %.4f outside [0, 1) — a CV that large "
                "would swing albedo by more than the lighting does" % (mid, name, sigma))
        out.append({
            "id": mid, "name": name, "fam": fam, "src": src,
            "cv": cv, "sigma": sigma, "pitch": pitch, "note": note,
        })

    measured = sum(1 for m in out if m["src"] != "authored")

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("// Rows read from data/materials.csv. The `source_rules` ctest "
                 "compares this\n// against the CSV's data-row count, which is what "
                 "catches a re-harvest that\n// nobody regenerated against.\n")
        fh.write("//\n")
        fh.write("// NOTE this is NOT the material count. It happens to equal 16 "
                 "today because the\n// pack has 16 photographs and materials.h has "
                 "16 ids; they are unrelated\n// numbers and only 6 of the 16 rows "
                 "are consumed. Do not \"simplify\" the gate to\n// compare against "
                 "the array length instead.\n")
        fh.write("const uint kMaterialCsvRows = %du;\n\n" % len(rows))

        fh.write("// Family per material id — see the kFam* constants in cube.frag.\n")
        for m in out:
            fh.write("//  %2d %-20s %-8s %-24s CV %.4f\n"
                     % (m["id"], m["name"], m["fam"], m["src"], m["cv"]))
            for line in wrap_note(m["note"]):
                fh.write("//     %s\n" % line)
        fh.write("// Table length. cube.frag clamps the incoming material id against\n"
                 "// this, so a five-bit id the CPU should never emit cannot index\n"
                 "// past the arrays — an out-of-range const-array read is undefined\n"
                 "// in GLSL, which on an untestable driver means anything at all.\n")
        fh.write("const uint kMatSurfaceCount = %du;\n\n" % MAT_COUNT)

        fh.write("const uint kMatFamily[%d] = uint[%d](\n" % (MAT_COUNT, MAT_COUNT))
        fh.write(elements(out, ["%du" % FAM[m["fam"]] for m in out]))
        fh.write(");\n\n")

        fh.write("// x = lognormal sigma reproducing the measured luminance CV,\n"
                 "// y = the family's structural pitch in cycles per 2 m cell.\n")
        fh.write("const vec2 kMatSurface[%d] = vec2[%d](\n" % (MAT_COUNT, MAT_COUNT))
        fh.write(elements(out, ["vec2(%.5f, %6.2f)" % (m["sigma"], m["pitch"])
                                for m in out]))
        fh.write(");\n")

    sys.stderr.write(
        "gen_material_surface: %d CSV rows -> %d materials (%d measured, "
        "%d authored) -> %s\n"
        % (len(rows), MAT_COUNT, measured, MAT_COUNT - measured, OUT_PATH))


def elements(out, values):
    """One array element per line, comma BEFORE the trailing comment.

    A GLSL array constructor takes no trailing comma, and a comment placed before
    the comma swallows it — which is what the first version of this function did,
    producing a file glslc rejects. Kept as a function so there is one place to get
    it right.
    """
    w = max(len(v) for v in values)
    lines = []
    for i, (m, v) in enumerate(zip(out, values)):
        sep = "," if i + 1 < len(values) else " "
        lines.append("    %-*s%s  // %2d %s" % (w, v, sep, m["id"], m["name"]))
    return "\n".join(lines) + "\n"


def wrap_note(note, width=68):
    words, line, lines = note.split(), "", []
    for w in words:
        if line and len(line) + 1 + len(w) > width:
            lines.append(line)
            line = w
        else:
            line = w if not line else line + " " + w
    if line:
        lines.append(line)
    return lines


HEADER = """// GENERATED by tools/gen_material_surface.py from data/materials.csv — do not
// hand-edit. Edit the CSV (or the authored rows in the generator) and re-run it;
// the `source_rules` ctest fails on drift.
//
// Included by shaders/cube.frag, which is shared by the world pass and the body
// pass. Nothing on the CPU reads this table.
//
// sigma is the lognormal width that reproduces each material's MEASURED luminance
// coefficient of variation (lum_std / mean luminance, both linear) through
// exp(sigma*n - sigma*sigma/2) — strictly positive, mean-preserving, and calibrated
// rather than tuned. See the generator's docstring for why the raw lum_std cannot be
// used as an amplitude and why the seam depths are authored instead of measured.

"""

if __name__ == "__main__":
    main()

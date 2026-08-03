#!/usr/bin/env python3
"""Generate src/game/prop_table.h + prop_table.cpp from data/props.csv.

Sibling of gen_status_table.py / gen_weapon_table.py. CSV is the truth; the
generated files are committed so the build needs no Python. Unknown tokens are
hard errors, never silent defaults.

    python tools/gen_prop_table.py

WHY THIS TABLE EXISTS. seed_wall_interactables / seed_ceiling_lights / padic
stair lamps hardcode PropShape ordinals, emissive, matId and RGB in .cpp.
That violates jirnyak.md data-driven content rules (same as items/mobs). One
row per authored prop id; spawn sites look up by PropId / string id hash and
never embed shape/emissive literals.

shape is the PropShape ordinal from render/prop_mesh.h (0..28). game never
includes render headers — the ordinal is a plain uint8 shared contract.
fall_mode / interact are enum token names matching prop_system.h.
color_*_e3 are fixed-point RGB x1000 (0..2000) so the table stays integral.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPS_CSV = os.path.join(REPO, "data", "props.csv")
OUT_H = os.path.join(REPO, "src", "game", "prop_table.h")
OUT_CPP = os.path.join(REPO, "src", "game", "prop_table.cpp")

# Must stay in lockstep with enum class PropShape in render/prop_mesh.h.
VALID_SHAPES = {
    "Box": 0, "CylinderX": 1, "CylinderY": 2, "CylinderZ": 3,
}
SHAPE_MAX = 3

FALL_MODES = {"SimpleFall": 0, "RagdollRoll": 1, "GpuHandoff": 2}

# The interact ordinals come from data/interactables.csv (the generated
# InteractKind enum) — a prop names an interactive by its cpp_name and this
# generator refuses a name the table does not carry. "None" = 255.
def _load_interacts():
    import csv as _csv
    path = os.path.join(REPO, "data", "interactables.csv")
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(_csv.DictReader(fh))
    m = {r["cpp_name"].strip(): i for i, r in enumerate(rows)}
    m["None"] = 255
    return m

INTERACTS = _load_interacts()


def die(msg):
    sys.stderr.write("gen_prop_table: %s\n" % msg)
    sys.exit(1)


def num(row, col, lo, hi):
    text = (row.get(col) or "").strip()
    try:
        v = int(text)
    except ValueError:
        die("%r: %s = %r not an int" % (row.get("id"), col, text))
    if not (lo <= v <= hi):
        die("%r: %s = %r out of [%d, %d]" % (row.get("id"), col, text, lo, hi))
    return v


def parse_shape(row):
    text = (row.get("shape") or "").strip()
    if not text:
        die("%r: empty shape" % row.get("id"))
    if text.isdigit() or (text.startswith("-") and text[1:].isdigit()):
        v = int(text)
        if not (0 <= v <= SHAPE_MAX):
            die("%r: shape ordinal %d out of [0, %d]" % (row.get("id"), v, SHAPE_MAX))
        return v
    if text not in VALID_SHAPES:
        die("%r: unknown shape token %r" % (row.get("id"), text))
    return VALID_SHAPES[text]


def camel(sid):
    parts = [p for p in sid.replace("-", "_").split("_") if p]
    if not parts:
        die("empty id")
    return "".join(p[:1].upper() + p[1:] for p in parts)


def main():
    with open(PROPS_CSV, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        die("props.csv has no data rows")

    seen = set()
    defs = []
    names = []
    enum_lines = []
    for i, r in enumerate(rows):
        sid = (r.get("id") or "").strip()
        if not sid:
            die("row %d has empty id" % i)
        if sid in seen:
            die("duplicate id %r" % sid)
        seen.add(sid)
        name = (r.get("name") or "").strip()
        if not name:
            die("%r has empty display name" % sid)

        fall = (r.get("fall_mode") or "").strip()
        if fall not in FALL_MODES:
            die("%r: unknown fall_mode %r (want %s)"
                % (sid, fall, ", ".join(sorted(FALL_MODES))))
        interact = (r.get("interact") or "").strip()
        if interact not in INTERACTS:
            die("%r: unknown interact %r (want %s)"
                % (sid, interact, ", ".join(sorted(INTERACTS))))

        shape = parse_shape(r)
        emissive = num(r, "emissive", 0, 255)
        mat_id = num(r, "mat_id", 0, 255)
        cr = num(r, "color_r_e3", 0, 2000)
        cg = num(r, "color_g_e3", 0, 2000)
        cb = num(r, "color_b_e3", 0, 2000)
        reach = num(r, "reach_mm", 0, 10000)

        enum_name = camel(sid)
        enum_lines.append("    %s = %d," % (enum_name, i))
        names.append((sid, name))
        massG = int(round(float(r.get("mass_kg") or "10") * 1000.0))
        sizes = tuple(int(round(float(r.get(c) or "1.0") * 1000.0))
                      for c in ("size_x_m", "size_y_m", "size_z_m"))
        for v in sizes:
            if not (0 < v <= 65535):
                die("row %d: size out of range" % i)
        if not (0 < massG <= 65535):
            die("row %d: mass_kg %r out of range" % (i, r.get("mass_kg")))
        # Layout: 6 uint8 (shape..mat + pad) then massG + 4 colour/reach uint16.
        defs.append(
            "    // [%d] %s\n"
            "    PropDef{ %d, %d, %d, %d, %d, 0, %d, %d, %d, %d, %d, %d, %d, %d }," % (
                i, sid,
                shape,
                FALL_MODES[fall],
                INTERACTS[interact],
                emissive,
                mat_id,
                massG,
                cr, cg, cb,
                reach,
                sizes[0], sizes[1], sizes[2]))

    count = len(rows)

    with open(OUT_H, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER_H % count)
        fh.write("enum class PropId : std::uint16_t {\n")
        for line in enum_lines:
            fh.write(line + "\n")
        fh.write("};\n\n")
        fh.write(BODY_H)
        fh.write("} // namespace giga::game\n")

    with open(OUT_CPP, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER_CPP)
        fh.write("const std::array<PropDef, kPropCount> kPropTable = {{\n")
        fh.write("\n".join(defs))
        fh.write("\n}};\n\n")
        fh.write("// Display names. Cyrillic; suites assert non-empty / lead bytes.\n")
        fh.write("const std::array<const char*, kPropCount> kPropNames = {{\n")
        for sid, name in names:
            # Escape backslash and quote in name.
            esc = name.replace("\\", "\\\\").replace('"', '\\"')
            fh.write('    "%s",  // %s\n' % (esc, sid))
        fh.write("}};\n\n")
        fh.write("const std::array<const char*, kPropCount> kPropIds = {{\n")
        for sid, _name in names:
            fh.write('    "%s",\n' % sid)
        fh.write("}};\n\n")
        fh.write(FOOTER_CPP)

    sys.stderr.write("gen_prop_table: wrote %d prop rows to %s + %s\n"
                     % (count, OUT_H, OUT_CPP))


HEADER_H = """// GENERATED by tools/gen_prop_table.py from data/props.csv — do not
// hand-edit kPropCount or the PropId enum. Edit the CSV and re-run the generator.
// Hand-maintained helpers below the GENERATED marker are allowed only if the
// generator is updated to emit them; today the whole header is generated.
#pragma once

#include <array>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/math.h"

namespace giga::game {

inline constexpr std::size_t kPropCount = %d;

// Row order is data/props.csv row order and is load-bearing: a PropId is an
// index into the generated table. Append only — never reorder or insert.
"""

BODY_H = """// POD row. shape is the PropShape ordinal (render/prop_mesh.h); game never
// includes render headers. fallMode / interactKind are ordinals matching
// PropFallMode and Interactable::Kind in prop_system.h (255 = no interact).
// color*E3 are RGB x1000 (1000 = 1.0). reachMm is Interactable.reachM * 1000.
// Layout is explicit: 6 x uint8 then 9 x uint16 = 24 bytes (no hidden padding).
struct PropDef {
    std::uint8_t  shape;         // 0  PropShape ordinal
    std::uint8_t  fallMode;      // 1  PropFallMode ordinal
    std::uint8_t  interactKind;  // 2  Interactable::Kind or 255
    std::uint8_t  emissive;      // 3  0..255 PropPass emissive
    std::uint8_t  matId;         // 4
    std::uint8_t  pad0_ = 0;     // 5
    std::uint16_t massG;         // 6  universal mass, grams ([ecs] Mass)
    std::uint16_t colorRE3;      // 8  RGB x1000
    std::uint16_t colorGE3;      // 10
    std::uint16_t colorBE3;      // 12
    std::uint16_t reachMm;       // 14 Interactable reach in millimetres
    std::uint16_t sizeXMm;       // 16 authored mesh size, millimetres — the
    std::uint16_t sizeYMm;       // 18 unit shape is scaled to exactly this,
    std::uint16_t sizeZMm;       // 20 so a bulb is a bulb and not a 1 m drum
    std::uint16_t pad1_ = 0;     // 22
};
static_assert(sizeof(PropDef) == 24, "PropDef must stay a tight 24-byte row");
static_assert(std::is_trivially_copyable_v<PropDef>);


// Generated from data/props.csv by tools/gen_prop_table.py.
extern const std::array<PropDef, kPropCount> kPropTable;
extern const std::array<const char*, kPropCount> kPropNames;
extern const std::array<const char*, kPropCount> kPropIds;

inline bool prop_valid(PropId id) {
    return static_cast<std::size_t>(id) < kPropCount;
}

inline const PropDef& prop_def(PropId id) {
    return kPropTable[static_cast<std::size_t>(id)];
}

inline const char* prop_name(PropId id) {
    return prop_valid(id) ? kPropNames[static_cast<std::size_t>(id)] : "";
}

inline const char* prop_id_str(PropId id) {
    return prop_valid(id) ? kPropIds[static_cast<std::size_t>(id)] : "";
}

// O(n) string lookup for tools/console — never call in the hot tick.
// Returns kPropCount-sized invalid sentinel when missing (check prop_valid).
inline PropId prop_id_by_string(const char* id) {
    if (!id || !*id) return static_cast<PropId>(kPropCount);
    for (std::size_t i = 0; i < kPropCount; ++i) {
        if (std::strcmp(kPropIds[i], id) == 0)
            return static_cast<PropId>(i);
    }
    return static_cast<PropId>(kPropCount);
}

// Color as vec3 in 0..2 range (e3 / 1000).
inline vec3 prop_color(const PropDef& d) {
    return vec3{
        static_cast<float>(d.colorRE3) * 0.001f,
        static_cast<float>(d.colorGE3) * 0.001f,
        static_cast<float>(d.colorBE3) * 0.001f,
    };
}

inline vec3 prop_color(PropId id) {
    return prop_color(prop_def(id));
}
"""

HEADER_CPP = """// GENERATED by tools/gen_prop_table.py from data/props.csv — do not
// hand-edit. Edit the CSV and re-run the generator.
#include "game/prop_table.h"

namespace giga::game {

"""

FOOTER_CPP = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()

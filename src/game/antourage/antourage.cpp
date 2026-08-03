// The two seed modules: SOLID wall pipes and GHOST hanging wires.
//
// Both read the finished grid as pure CONTEXT — no knowledge of which floor
// module built it. A pipe run is "a long straight strip of air hugging a wall
// under a ceiling"; a wire is "two ceiling anchors a few cells apart over open
// air". Any geometry that offers those shapes grows the dressing; one that
// does not, does not — that is the whole contract.
#include "game/antourage/antourage.h"

#include <cmath>

#include "core/rng.h"
#include "world/macro_grid.h"
#include "world/materials.h"
#include "world/world.h"

namespace giga::game {

namespace {

std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// --- Pipe walker -------------------------------------------------------------
// A 3D "tubes screensaver" walker over the grid: it starts on a ceiling-hugged
// air cell, runs straight, and turns — sideways along the ceiling or DOWN/UP a
// wall — emitting one PipeLeg per straight stretch and a PipeJoint per elbow.
// PURE MESH: nothing is written into the grid (the law in antourage.h). Each
// leg records the SOLID cells it hugs as its anchors; carve those and the leg
// dies with them.
constexpr int kPipeWalks = 16000;    // walker starts drawn per floor (~15% land)
constexpr int kPipeMaxSteps = 96;    // cells one walker may visit
constexpr int kPipeMinLeg = 3;       // shorter stretches are dropped
constexpr int kPipeTurnPct = 18;     // per-step chance to turn

// Can the walker OCCUPY (x,y,z) moving horizontally? Air, ceiling above, air
// below (headroom guard — see the duct height note above).
bool horiz_ok(const MacroGrid& g, int x, int y, int z) {
    return g.cell(x, y, z) == kCellAir && g.cell(x, y, z + 1) != kCellAir &&
           g.cell(x, y, z - 1) == kCellAir;
}
// Vertically the walker hugs a wall: air with a solid neighbour on (wx, wy).
bool vert_ok(const MacroGrid& g, int x, int y, int z, int wx, int wy) {
    return g.cell(x, y, z) == kCellAir && g.cell(x + wx, y + wy, z) != kCellAir;
}

// The REAL under-face of the ceiling over air cell (x,y,z), world metres.
// The sandwich slabs are partially carved from below (lintel strips keep only
// their top layers), so the cell plane is NOT where matter starts — hanging
// anything from the plane reads as hanging from air.
float ceiling_face_m(const MacroGrid& g, int x, int y, int z, bool centreOnly) {
    const int cz = wrap_macro(z + 1);
    const SubMask& m = g.mask(x, y, cz);
    const int sz = centreOnly ? m.lowest_layer_centre() : m.lowest_layer();
    if (sz < 0) return -1.0f;
    return static_cast<float>(cz) * kCellSize +
           static_cast<float>(sz) * (kCellSize / 8.0f);
}

// The axis line a direction runs on inside a cell, world units. Horizontal
// axes get their height from the LEG emitter (real ceiling faces); this
// returns the tangent coordinates plus a placeholder height.
vec3 duct_axis_point(int x, int y, int z, int axis, int wx, int wy) {
    const float cx = static_cast<float>(x) * kCellSize;
    const float cy = static_cast<float>(y) * kCellSize;
    const float cz = static_cast<float>(z) * kCellSize;
    if (axis == 0) return {cx + 1.0f, cy + 1.0f, cz + 1.75f};
    if (axis == 1) return {cx + 1.0f, cy + 1.0f, cz + 1.75f};
    return {cx + (wx > 0 ? 1.75f : wx < 0 ? 0.25f : 1.0f),
            cy + (wy > 0 ? 1.75f : wy < 0 ? 0.25f : 1.0f), cz + 1.0f};
}

struct WalkCell { int x, y, z; };

// The SOLID cell a walk cell hangs from: the ceiling above a horizontal step,
// the hugged wall beside a vertical one. This is the anchor the LIVE-grid
// aliveness probe checks.
WalkCell hug_cell(const WalkCell& c, int axis, int wx, int wy) {
    if (axis == 2) return {wrap_macro(c.x + wx), wrap_macro(c.y + wy), c.z};
    return {c.x, c.y, wrap_macro(c.z + 1)};
}

// Emit one straight run as UNIVERSAL instances ([antourage.h]). Ends that were
// stopped by SOLID matter extend half a cell into it — a pipe terminates in a
// wall, never hanging cut in mid-air ("кусочность", owner's screenshots).
void emit_leg(const MacroGrid& g, AntourageBake& out,
              const std::vector<WalkCell>& cells, int axis, int wx, int wy,
              int sign, bool stopSolid) {
    if (static_cast<int>(cells.size()) < kPipeMinLeg) return;
    const WalkCell f = hug_cell(cells.front(), axis, wx, wy);
    const WalkCell l = hug_cell(cells.back(), axis, wx, wy);
    vec3 a = duct_axis_point(cells.front().x, cells.front().y, cells.front().z,
                             axis, wx, wy);
    vec3 b = duct_axis_point(cells.back().x, cells.back().y, cells.back().z,
                             axis, wx, wy);
    if (axis != 2) {
        // Horizontal legs hang from the REAL ceiling under-face: the lowest
        // face met along the run, so the pipe never pierces a lower lintel.
        float face = 1e9f;
        for (const WalkCell& c : cells) {
            const float fm = ceiling_face_m(g, c.x, c.y, c.z, false);
            if (fm >= 0.0f && fm < face) face = fm;
        }
        if (face > 1e8f)
            face = (static_cast<float>(cells.front().z) + 1.0f) * kCellSize;
        const float axisZ = face - kPipeRadius - 0.04f;
        a.z = axisZ;
        b.z = axisZ;
    }
    // Extend the ends into whatever solid stops them.
    vec3 dir{0, 0, 0};
    if (axis == 0) dir.x = static_cast<float>(sign);
    else if (axis == 1) dir.y = static_cast<float>(sign);
    else dir.z = static_cast<float>(sign);
    const WalkCell& fc = cells.front();
    const int bx = wrap_macro(fc.x - (axis == 0 ? sign : 0));
    const int by = wrap_macro(fc.y - (axis == 1 ? sign : 0));
    const int bz = wrap_macro(fc.z - (axis == 2 ? sign : 0));
    if (g.cell(bx, by, bz) != kCellAir) a = a - dir * 1.0f;
    if (stopSolid) b = b + dir * 1.0f;

    AntourageInstance inst{};
    inst.pos = (a + b) * 0.5f;
    const float len = axis == 0   ? std::fabs(b.x - a.x)
                      : axis == 1 ? std::fabs(b.y - a.y)
                                  : std::fabs(b.z - a.z);
    const float d = 2.0f * kPipeRadius;
    inst.scale = axis == 0   ? vec3{len + d, d, d}
                 : axis == 1 ? vec3{d, len + d, d}
                             : vec3{d, d, len + d};
    inst.shape = static_cast<std::uint8_t>(
        axis == 0 ? kShapeCylinderX : axis == 1 ? kShapeCylinderY
                                                : kShapeCylinderZ);
    inst.matId = static_cast<std::uint8_t>(kMatPipeMetal);
    inst.ax0 = static_cast<std::uint8_t>(f.x);
    inst.ay0 = static_cast<std::uint8_t>(f.y);
    inst.az0 = static_cast<std::uint8_t>(f.z);
    inst.ax1 = static_cast<std::uint8_t>(l.x);
    inst.ay1 = static_cast<std::uint8_t>(l.y);
    inst.az1 = static_cast<std::uint8_t>(l.z);
    out.instances.push_back(inst);
    // Long straight runs become a BUNDLE: a second parallel main under the
    // first — the industrial "магистраль" read that single tubes never give.
    if (axis != 2 && static_cast<int>(cells.size()) >= 10) {
        AntourageInstance twin = inst;
        twin.pos.z -= 2.4f * kPipeRadius;
        out.instances.push_back(twin);
    }
}

void bake_pipes(const World& w, std::uint32_t fseed, AntourageBake& out) {
    const MacroGrid& g = w.grid();
    for (int walk = 0; walk < kPipeWalks; ++walk) {
        std::uint32_t h = mix(fseed ^ (static_cast<std::uint32_t>(walk) *
                                       0x9E3779B9u));
        int x = static_cast<int>(h & 127u);
        int y = static_cast<int>((h >> 7) & 127u);
        int z = static_cast<int>((h >> 14) & 127u);
        // Start on a ceiling-hugged cell heading along a random horizontal.
        if (!horiz_ok(g, x, y, z)) continue;
        int axis = (h >> 21) & 1u;                 // 0 = X, 1 = Y
        int sign = ((h >> 22) & 1u) ? 1 : -1;
        int wx = 0, wy = 0;                        // vertical wall hug, unset
        bool stopSolid = false;
        std::vector<WalkCell> leg;
        for (int step = 0; step < kPipeMaxSteps; ++step) {
            const bool ok = axis == 2 ? vert_ok(g, x, y, z, wx, wy)
                                      : horiz_ok(g, x, y, z);
            if (!ok) {
                // A run stopped by SOLID matter terminates INSIDE it.
                stopSolid = g.cell(x, y, z) != kCellAir;
                break;
            }
            ++out.pipeCells;
            leg.push_back({x, y, z});
            h = mix(h ^ 0xA24BAED1u);
            // Turn? Only after a leg has real length, and only into a legal
            // first cell of the new direction.
            const bool wantTurn = static_cast<int>(leg.size()) >= kPipeMinLeg &&
                                  static_cast<int>(h % 100u) < kPipeTurnPct;
            if (wantTurn) {
                // HALF the turns go vertical — the up/down branching the
                // screensaver look lives on (was a flat 1/3 and read as none).
                const int pick = static_cast<int>((h >> 8) % 4u);
                const int newAxis = pick < 2 ? 2 : (pick == 2 ? 0 : 1);
                const int newSign = ((h >> 10) & 1u) ? 1 : -1;
                int nwx = 0, nwy = 0;
                bool can = false;
                if (newAxis == 2) {
                    // Descend/ascend hugging the wall the horizontal leg ran
                    // beside — probe both sides across the travel axis.
                    const int px = axis == 0 ? 0 : 1;
                    for (int s = -1; s <= 1 && !can; s += 2) {
                        nwx = px ? s : 0;
                        nwy = px ? 0 : s;
                        can = vert_ok(g, x, y, z + newSign, nwx, nwy);
                    }
                } else if (newAxis != axis) {
                    can = horiz_ok(g, x + (newAxis == 0 ? newSign : 0),
                                   y + (newAxis == 1 ? newSign : 0), z);
                }
                if (can) {
                    emit_leg(g, out, leg, axis, wx, wy, sign, false);
                    // The flanged elbow: a universal Box instance.
                    AntourageInstance j{};
                    j.pos = duct_axis_point(x, y, z, axis, wx, wy);
                    if (axis != 2) {
                        const float fm = ceiling_face_m(g, x, y, z, false);
                        if (fm >= 0.0f) j.pos.z = fm - kPipeRadius - 0.04f;
                    }
                    const float jd = 1.7f * kPipeRadius;
                    j.scale = vec3{jd, jd, jd};
                    j.shape = kShapeBox;
                    j.matId = static_cast<std::uint8_t>(kMatPipeMetal);
                    const WalkCell jh = hug_cell({x, y, z}, axis, wx, wy);
                    j.ax0 = j.ax1 = static_cast<std::uint8_t>(jh.x);
                    j.ay0 = j.ay1 = static_cast<std::uint8_t>(jh.y);
                    j.az0 = j.az1 = static_cast<std::uint8_t>(jh.z);
                    out.instances.push_back(j);
                    leg.clear();
                    leg.push_back({x, y, z});
                    axis = newAxis;
                    sign = newSign;
                    wx = nwx;
                    wy = nwy;
                }
            }
            x += axis == 0 ? sign : 0;
            y += axis == 1 ? sign : 0;
            z += axis == 2 ? sign : 0;
            x = wrap_macro(x); y = wrap_macro(y); z = wrap_macro(z);
        }
        emit_leg(g, out, leg, axis, wx, wy, sign, stopSolid);
    }
}

// --- GHOST: hanging wires ---------------------------------------------------
// Anchors: two AIR cells with solid ceilings, kWireSpanMin..Max cells apart on
// one axis, clear air between them at anchor height. The rest pose is a
// catenary-ish parabola sagging along -gravity; the GPU verlet backend takes it
// from there. ~1.2 cm copper-cored cable: mass from length, not authored.
constexpr int kWireSpanMin = 3;
constexpr int kWireSpanMax = 7;
constexpr int kWireTriesPerRoomish = 12000; // draws over the whole floor
constexpr float kWireKgPerMetre = 0.35f;

void bake_wires(const World& w, std::uint32_t fseed, AntourageBake& out) {
    const MacroGrid& g = w.grid();
    // Air under a ceiling AND over more air: wires belong over walkable
    // space, not inside the one-cell crevices the attic hole-punch leaves.
    auto ceilinged_air = [&](int x, int y, int z) {
        return g.cell(x, y, z) == kCellAir && g.cell(x, y, z + 1) != kCellAir &&
               g.cell(x, y, z - 1) == kCellAir;
    };
    for (int t = 0; t < kWireTriesPerRoomish; ++t) {
        const std::uint32_t h = mix(fseed ^ (static_cast<std::uint32_t>(t) *
                                             0x9E3779B9u));
        const int x = static_cast<int>(h & 127u);
        const int y = static_cast<int>((h >> 7) & 127u);
        const int z = static_cast<int>((h >> 14) & 127u);
        const int span = kWireSpanMin +
                         static_cast<int>((h >> 21) %
                                          (kWireSpanMax - kWireSpanMin + 1u));
        const bool alongX = (h >> 27) & 1u;
        const int dx = alongX ? 1 : 0, dy = alongX ? 0 : 1;
        if (!ceilinged_air(x, y, z)) continue;
        if (!ceilinged_air(x + dx * span, y + dy * span, z)) continue;
        bool clear = true;
        for (int u = 1; u < span && clear; ++u)
            clear = g.cell(x + dx * u, y + dy * u, z) == kCellAir;
        if (!clear) continue;

        // Anchor to the REAL ceiling under-face at each end — the sandwich is
        // partially carved from below, and an end pinned on the cell plane
        // hangs from visible air. A holed centre column rejects the spot.
        const float face0 = ceiling_face_m(g, x, y, z, true);
        const float face1 =
            ceiling_face_m(g, x + dx * span, y + dy * span, z, true);
        if (face0 < 0.0f || face1 < 0.0f) continue;

        WireChain c{};
        c.ax0 = static_cast<std::uint8_t>(wrap_macro(x));
        c.ay0 = static_cast<std::uint8_t>(wrap_macro(y));
        c.az0 = static_cast<std::uint8_t>(wrap_macro(z + 1));
        c.ax1 = static_cast<std::uint8_t>(wrap_macro(x + dx * span));
        c.ay1 = static_cast<std::uint8_t>(wrap_macro(y + dy * span));
        c.az1 = c.az0;
        const vec3 a{(static_cast<float>(x) + 0.5f) * kCellSize,
                     (static_cast<float>(y) + 0.5f) * kCellSize,
                     face0 + 0.12f};
        const vec3 b{(static_cast<float>(x + dx * span) + 0.5f) * kCellSize,
                     (static_cast<float>(y + dy * span) + 0.5f) * kCellSize,
                     face1 + 0.12f};
        const float spanM = static_cast<float>(span) * kCellSize;
        const float sag = 0.15f * spanM;    // gentle catenary; verlet keeps it
        for (int i = 0; i < kWirePoints; ++i) {
            const float s = static_cast<float>(i) /
                            static_cast<float>(kWirePoints - 1);
            vec3 p = a + (b - a) * s;
            p.z -= sag * 4.0f * s * (1.0f - s);   // parabola ≈ catenary
            c.p[i] = p;
        }
        c.restLen = spanM * 1.02f / static_cast<float>(kWirePoints - 1);
        c.massKg = spanM * kWireKgPerMetre;
        out.wires.push_back(c);
    }
}

} // namespace

void bake_antourage(const World& w, int number, unsigned seed,
                    AntourageBake& out) {
    // v1 is written against a +-Z gravity frame (the sole registered geometry
    // module's). Any other regime skips gracefully rather than dressing a world
    // sideways — the first non-Z module generalises these two walkers the same
    // way floor_cell did for placement.
    const GravityRegime r = w.gravity().regime;
    if (r != GravityRegime::NegZ && r != GravityRegime::PosZ) return;
    const std::uint32_t fseed =
        giga::hash_u32(static_cast<std::uint32_t>(seed) ^
                       (static_cast<std::uint32_t>(number) * 0xA24BAED1u));
    bake_pipes(w, fseed, out);
    bake_wires(w, mix(fseed ^ 0x5A303B0Du), out);
}

} // namespace giga::game

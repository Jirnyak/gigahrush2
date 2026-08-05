// The three seed modules: wall PIPES, hanging WIRES, hanging CLOTH.
//
// All three read the finished grid as pure CONTEXT — no knowledge of which floor
// module built it. A pipe run is "a long straight strip of air hugging a wall
// under a ceiling"; a wire is "two ceiling anchors a few cells apart over open
// air". Any geometry that offers those shapes grows the dressing; one that
// does not, does not — that is the whole contract.
//
// "Ceiling" is a FRAME word, not a Z word: every rule below is written against
// the declared GravityFrame ([world/gravity.h]), so the same walkers dress a
// floor pulled sideways and a floor with no gravity at all. Geometry is a frame
// question and always answerable; only the wire's SAG is a force.
#include "game/antourage/antourage.h"

#include <cmath>

#include "core/rng.h"
#include "sim/physics.h"   // aabb_overlaps_solid — the solver's own predicate
#include "world/macro_grid.h"
#include "world/materials.h"
#include "world/world.h"

namespace giga::game {

namespace {


// --- Speaking in AXES, never in letters --------------------------------------
// The isotropy law ([world/gravity.h]): x, y and z are equal citizens on the
// torus and gravity is the only asymmetry — so every module below indexes axes
// through the DECLARED GravityFrame. `f.axis` is "vertical", `f.tanA`/`f.tanB`
// are the two "horizontals", `f.upSign` says which way up is, and nothing in
// this file spells `z + 1` for "the ceiling".

struct WalkCell { int x, y, z; };

int cell_axis(const WalkCell& c, int axis) {
    return axis == 0 ? c.x : axis == 1 ? c.y : c.z;
}
// One WRAPPED step along a world axis: the torus wraps all three, so no caller
// keeps an out-of-range coordinate around.
WalkCell stepped(const WalkCell& c, int axis, int d) {
    WalkCell r = c;
    if (axis == 0) r.x = wrap_macro(r.x + d);
    else if (axis == 1) r.y = wrap_macro(r.y + d);
    else r.z = wrap_macro(r.z + d);
    return r;
}
// The same step WITHOUT wrapping, for a SPAN: the far end of a wire or a sheet
// must stay adjacent to the near end in world units (the nearest toroidal
// image). Wrap it and the mesh becomes a ~250 m ghost across the seam — the bug
// emit_leg() splits legs to avoid. Cell reads wrap themselves; only the stored
// anchor bytes need wrap_all().
WalkCell offset(const WalkCell& c, int axis, int d) {
    WalkCell r = c;
    if (axis == 0) r.x += d;
    else if (axis == 1) r.y += d;
    else r.z += d;
    return r;
}
WalkCell wrap_all(const WalkCell& c) {
    return {wrap_macro(c.x), wrap_macro(c.y), wrap_macro(c.z)};
}
float vec_axis(const vec3& v, int axis) {
    return axis == 0 ? v.x : axis == 1 ? v.y : v.z;
}
void vec_set(vec3& v, int axis, float s) {
    if (axis == 0) v.x = s;
    else if (axis == 1) v.y = s;
    else v.z = s;
}
void vec_add(vec3& v, int axis, float s) { vec_set(v, axis, vec_axis(v, axis) + s); }

// The wall a run ALONG gravity hugs: a tangent axis and which side of it.
// axis < 0 means "no wall" — a vertical run with nothing to hug is not a run.
struct Wall { int axis = -1; int sign = 0; };

bool is_air(const MacroGrid& g, const WalkCell& c) {
    return g.cell(c.x, c.y, c.z) == kCellAir;
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

// Can the walker OCCUPY this cell running TANGENT to gravity? Air, ceiling on
// the UP side, air on the DOWN side (headroom guard — see the duct height note
// above).
bool hug_ok(const MacroGrid& g, const GravityFrame& f, const WalkCell& c) {
    return is_air(g, c) && !is_air(g, stepped(c, f.axis, f.upSign)) &&
           is_air(g, stepped(c, f.axis, -f.upSign));
}
// Running ALONG gravity the walker hugs a wall: air with a solid neighbour
// across a tangent step.
bool wall_ok(const MacroGrid& g, const WalkCell& c, const Wall& w) {
    return w.axis >= 0 && is_air(g, c) && !is_air(g, stepped(c, w.axis, w.sign));
}

// The REAL face of the ceiling over air cell `c`, as a coordinate along the
// frame's axis in world metres. The sandwich slabs are partially carved from
// the air side (lintel strips keep only their far layers), so the cell plane is
// NOT where matter starts — hanging anything from the plane reads as hanging
// from air. WHICH face that is comes from the frame, not from Z
// ([macro_grid.h] face_layer).
float ceiling_face(const MacroGrid& g, const GravityFrame& f, const WalkCell& c,
                   bool centreOnly) {
    const WalkCell cc = stepped(c, f.axis, f.upSign);
    const int s =
        g.mask(cc.x, cc.y, cc.z).face_layer(f.axis, -f.upSign, centreOnly);
    if (s < 0) return -1.0f;
    // The boundary of that sub-layer on the AIR side of the ceiling.
    const int edge = f.upSign > 0 ? s : s + 1;
    return static_cast<float>(cell_axis(cc, f.axis)) * kCellSize +
           static_cast<float>(edge) * (kCellSize / static_cast<float>(kSubDim));
}

// Faces compare in the FRAME's terms: the smaller key is the one further DOWN,
// whichever way down happens to point.
float down_key(const GravityFrame& f, float coord) {
    return coord * static_cast<float>(f.upSign);
}

// The axis line a direction runs on inside a cell, world units. Tangent runs
// get their height from the LEG emitter (real ceiling faces); this returns the
// cell centre plus a placeholder height near the ceiling.
vec3 duct_axis_point(const GravityFrame& f, const WalkCell& c, int axis,
                     const Wall& wall) {
    vec3 p{static_cast<float>(c.x) * kCellSize + 1.0f,
           static_cast<float>(c.y) * kCellSize + 1.0f,
           static_cast<float>(c.z) * kCellSize + 1.0f};
    if (axis == f.axis) {
        // A vertical run rides the wall it hugs.
        if (wall.axis >= 0)
            vec_add(p, wall.axis, 0.75f * static_cast<float>(wall.sign));
    } else {
        vec_add(p, f.axis, 0.75f * static_cast<float>(f.upSign));
    }
    return p;
}

// The SOLID cell a walk cell hangs from: the ceiling on the up side of a
// tangent step, the hugged wall beside a vertical one. This is the anchor the
// LIVE-grid aliveness probe checks.
WalkCell hug_cell(const GravityFrame& f, const WalkCell& c, int axis,
                  const Wall& wall) {
    if (axis == f.axis) return stepped(c, wall.axis, wall.sign);
    return stepped(c, f.axis, f.upSign);
}

// The axis and the direction (from the ANCHOR toward the pipe) that a run of
// `axis` hugs. One byte of it is stored on the instance so the aliveness probe
// can ask about the very column the leg hugs — the same rule chains and sheets
// live by ([antourage.h] face).
int hug_axis(const GravityFrame& f, int axis, const Wall& wall) {
    return axis == f.axis ? wall.axis : f.axis;
}
int hug_dir(const GravityFrame& f, int axis, const Wall& wall) {
    return axis == f.axis ? -wall.sign : -f.upSign;
}

// Does the cell this walk cell hugs still carry matter IN THE COLUMN the pipe
// touches, and where is its face? Returns the face coordinate along the hug
// axis in world metres, or -1 when the column is empty — a leg has no business
// existing over a cell it cannot actually touch ("трубы висят в воздухе",
// owner 2026-08-05: the old code fell back to the cell PLANE and drew a pipe
// hugging nothing).
float hug_face(const MacroGrid& g, const GravityFrame& f, const WalkCell& c,
               int axis, const Wall& wall) {
    const int ha = hug_axis(f, axis, wall);
    if (ha < 0) return -1.0f;
    const int hd = hug_dir(f, axis, wall);
    const WalkCell anchor = hug_cell(f, c, axis, wall);
    const int s = g.mask(anchor.x, anchor.y, anchor.z).face_layer(ha, hd, true);
    if (s < 0) return -1.0f;
    const int edge = hd < 0 ? s : s + 1;
    return static_cast<float>(cell_axis(anchor, ha)) * kCellSize +
           static_cast<float>(edge) * (kCellSize / static_cast<float>(kSubDim));
}

// Emit one straight run as UNIVERSAL instances ([antourage.h]). Ends that were
// stopped by SOLID matter extend half a cell into it — a pipe terminates in a
// wall, never hanging cut in mid-air ("кусочность", owner's screenshots).
// PRECONDITION: `cells` never crosses the torus seam — emit_leg() splits first.
void emit_leg_run(const MacroGrid& g, const GravityFrame& f, AntourageBake& out,
                  const std::vector<WalkCell>& cells, int axis,
                  const Wall& wall, int sign, bool stopSolid) {
    if (static_cast<int>(cells.size()) < kPipeMinLeg) return;
    const WalkCell a0 = hug_cell(f, cells.front(), axis, wall);
    const WalkCell a1 = hug_cell(f, cells.back(), axis, wall);
    vec3 a = duct_axis_point(f, cells.front(), axis, wall);
    vec3 b = duct_axis_point(f, cells.back(), axis, wall);
    // EVERY leg — tangent or vertical — is seated on the REAL face of the matter
    // it hugs, offset by its own radius. The face furthest from that matter
    // along the run wins, so a pipe never pierces a lower lintel or a closer
    // wall. No fallback to the cell plane: emit_leg() has already split the run
    // at any cell whose column is empty, so a face exists for every cell here.
    const int ha = hug_axis(f, axis, wall);
    const int hd = hug_dir(f, axis, wall);
    if (ha >= 0) {
        float face = 0.0f;
        float best = 1e9f;
        for (const WalkCell& c : cells) {
            const float fm = hug_face(g, f, c, axis, wall);
            if (fm < 0.0f) continue;
            const float key = fm * static_cast<float>(-hd);
            if (key < best) {
                best = key;
                face = fm;
            }
        }
        if (best > 1e8f) return;  // nothing to hug: not a leg
        const float d = static_cast<float>(hd);
        vec_set(a, ha, face + d * kPipeRadius + d * 0.04f);
        vec_set(b, ha, face + d * kPipeRadius + d * 0.04f);
    }
    // Extend the ends into whatever solid stops them.
    vec3 dir{0, 0, 0};
    vec_set(dir, axis, static_cast<float>(sign));
    const WalkCell back = stepped(cells.front(), axis, -sign);
    if (!is_air(g, back)) a = a - dir * 1.0f;
    if (stopSolid) b = b + dir * 1.0f;

    AntourageInstance inst{};
    inst.pos = (a + b) * 0.5f;
    const float len = std::fabs(vec_axis(b, axis) - vec_axis(a, axis));
    const float d = 2.0f * kPipeRadius;
    inst.scale = vec3{d, d, d};
    vec_set(inst.scale, axis, len + d);
    // The shape catalog is spelled in WORLD axes, so a sideways frame's runs
    // pick their cylinder here with no extra rule.
    inst.shape = static_cast<std::uint8_t>(
        axis == 0 ? kShapeCylinderX : axis == 1 ? kShapeCylinderY
                                                : kShapeCylinderZ);
    inst.matId = static_cast<std::uint8_t>(kMatPipeMetal);
    inst.face = antourage_face_pack(ha, hd);
    inst.ax0 = static_cast<std::uint8_t>(a0.x);
    inst.ay0 = static_cast<std::uint8_t>(a0.y);
    inst.az0 = static_cast<std::uint8_t>(a0.z);
    inst.ax1 = static_cast<std::uint8_t>(a1.x);
    inst.ay1 = static_cast<std::uint8_t>(a1.y);
    inst.az1 = static_cast<std::uint8_t>(a1.z);
    out.instances.push_back(inst);
    // Long straight runs become a BUNDLE: a second parallel main under the
    // first — the industrial "магистраль" read that single tubes never give.
    if (axis != f.axis && static_cast<int>(cells.size()) >= 10) {
        AntourageInstance twin = inst;
        vec_add(twin.pos, f.axis,
                -static_cast<float>(f.upSign) * (2.4f * kPipeRadius));
        out.instances.push_back(twin);
    }
}

// A leg whose wrapped indices cross the torus seam must be SPLIT there: one
// instance renders at exactly one toroidal image, and a wrapped span fed to
// duct_axis_point as-is produced ~250 m ghost beams whose midpoint sat far
// from their geometry — the pipes that popped in and out with the camera.
void emit_leg(const MacroGrid& g, const GravityFrame& f, AntourageBake& out,
              const std::vector<WalkCell>& cells, int axis, const Wall& wall,
              int sign, bool stopSolid) {
    // A run is a maximal stretch of cells that (1) does not cross the torus seam
    // and (2) every one of which has real matter in the column the pipe hugs.
    // A faceless cell is not merely a boundary — it is DROPPED, or the next run
    // would anchor to a column that is not there.
    std::vector<WalkCell> run;
    for (std::size_t i = 0; i <= cells.size(); ++i) {
        bool flush = i == cells.size();
        bool keep = false;
        if (!flush) {
            keep = hug_face(g, f, cells[i], axis, wall) >= 0.0f;
            if (!keep) flush = true;
            else if (!run.empty()) {
                // A +-1 step that reads as -+(kMacroDim-1) is the seam.
                const int d = cell_axis(cells[i], axis) - cell_axis(run.back(), axis);
                if (d != sign) flush = true;
            }
        }
        if (flush && !run.empty()) {
            // Only the TRUE final end keeps the caller's stop-into-solid
            // extension; a cut end continues elsewhere (or nowhere).
            const bool finalEnd = i == cells.size() && run.size() == cells.size();
            emit_leg_run(g, f, out, run, axis, wall, sign,
                         finalEnd ? stopSolid : false);
            run.clear();
        }
        if (!flush || keep) {
            if (keep) run.push_back(cells[i]);
        }
    }
}

void bake_pipes(const World& w, const GravityFrame& f, std::uint32_t fseed,
                int walks, AntourageBake& out) {
    const MacroGrid& g = w.grid();
    for (int walk = 0; walk < walks; ++walk) {
        std::uint32_t h = hash_u32(fseed ^ (static_cast<std::uint32_t>(walk) *
                                       0x9E3779B9u));
        WalkCell c{static_cast<int>(h & 127u), static_cast<int>((h >> 7) & 127u),
                   static_cast<int>((h >> 14) & 127u)};
        // Start on a ceiling-hugged cell heading along a random tangent axis.
        if (!hug_ok(g, f, c)) continue;
        int axis = ((h >> 21) & 1u) ? f.tanB : f.tanA;
        int sign = ((h >> 22) & 1u) ? 1 : -1;
        Wall wall{};                               // vertical wall hug, unset
        bool stopSolid = false;
        std::vector<WalkCell> leg;
        // An elbow Box may only exist BETWEEN two emitted legs. It is held
        // pending until the following leg proves real; pushing it eagerly left
        // a lone 0.5 m cube in the air whenever the new leg died under
        // kPipeMinLeg (near-certain for 2-cell wall drops).
        AntourageInstance pendingJoint{};
        bool havePendingJoint = false;
        auto emit_leg_checked = [&](const std::vector<WalkCell>& cells,
                                    int axis_, const Wall& wall_, int sign_,
                                    bool stop) {
            const std::size_t before = out.instances.size();
            emit_leg(g, f, out, cells, axis_, wall_, sign_, stop);
            const bool emitted = out.instances.size() > before;
            if (emitted && havePendingJoint)
                out.instances.push_back(pendingJoint);
            havePendingJoint = false;
            return emitted;
        };
        for (int step = 0; step < kPipeMaxSteps; ++step) {
            const bool ok = axis == f.axis ? wall_ok(g, c, wall)
                                           : hug_ok(g, f, c);
            if (!ok) {
                // A run stopped by SOLID matter terminates INSIDE it.
                stopSolid = !is_air(g, c);
                break;
            }
            ++out.pipeCells;
            leg.push_back(c);
            h = hash_u32(h ^ 0xA24BAED1u);
            // Turn? Only after a leg has real length, and only into a legal
            // first cell of the new direction.
            const bool wantTurn = static_cast<int>(leg.size()) >= kPipeMinLeg &&
                                  static_cast<int>(h % 100u) < kPipeTurnPct;
            if (wantTurn) {
                // HALF the turns go vertical — the up/down branching the
                // screensaver look lives on (was a flat 1/3 and read as none).
                const int pick = static_cast<int>((h >> 8) % 4u);
                const int newAxis =
                    pick < 2 ? f.axis : (pick == 2 ? f.tanA : f.tanB);
                const int newSign = ((h >> 10) & 1u) ? 1 : -1;
                Wall nwall{};
                bool can = false;
                // A turn must be legal at the CORNER CELL as well as at the cell
                // after it: the corner becomes the first cell of the new leg, and
                // its ANCHOR is recorded from the new direction. Probing only the
                // next cell let a leg start where there was nothing to hug — a
                // piece born with an anchor in the air, which the aliveness probe
                // reads as dead and never draws. Invisible in a -Z world (those
                // legs happened to fall under kPipeMinLeg and vanish); the first
                // sideways frame put it on the test's first run.
                if (newAxis == f.axis) {
                    // Descend/ascend hugging the wall the tangent leg ran
                    // beside — the OTHER tangent axis, probed on both sides.
                    nwall.axis = axis == f.tanA ? f.tanB : f.tanA;
                    for (int s = -1; s <= 1 && !can; s += 2) {
                        nwall.sign = s;
                        can = wall_ok(g, c, nwall) &&
                              wall_ok(g, stepped(c, f.axis, newSign), nwall);
                    }
                } else if (newAxis != axis) {
                    can = hug_ok(g, f, c) &&
                          hug_ok(g, f, stepped(c, newAxis, newSign));
                }
                if (can) {
                    const bool prevEmitted =
                        emit_leg_checked(leg, axis, wall, sign, false);
                    // The flanged elbow: a universal Box instance.
                    AntourageInstance j{};
                    j.pos = duct_axis_point(f, c, axis, wall);
                    if (axis != f.axis) {
                        const float fm = ceiling_face(g, f, c, false);
                        const float u = static_cast<float>(f.upSign);
                        if (fm >= 0.0f)
                            vec_set(j.pos, f.axis, fm - u * kPipeRadius - u * 0.04f);
                    }
                    const float jd = 1.7f * kPipeRadius;
                    j.scale = vec3{jd, jd, jd};
                    j.shape = kShapeBox;
                    j.matId = static_cast<std::uint8_t>(kMatPipeMetal);
                    const WalkCell jh = hug_cell(f, c, axis, wall);
                    j.ax0 = j.ax1 = static_cast<std::uint8_t>(jh.x);
                    j.ay0 = j.ay1 = static_cast<std::uint8_t>(jh.y);
                    j.az0 = j.az1 = static_cast<std::uint8_t>(jh.z);
                    if (prevEmitted) {
                        pendingJoint = j;
                        havePendingJoint = true;
                    }
                    leg.clear();
                    leg.push_back(c);
                    axis = newAxis;
                    sign = newSign;
                    wall = nwall;
                }
            }
            c = stepped(c, axis, sign);
        }
        emit_leg_checked(leg, axis, wall, sign, stopSolid);
    }
}

// --- GHOST: hanging wires ---------------------------------------------------
// Anchors: two AIR cells with solid ceilings, kWireSpanMin..Max cells apart on
// one tangent axis, clear air between them at anchor height. The rest pose is a
// catenary-ish parabola sagging along gravity; the GPU verlet backend takes it
// from there. ~1.2 cm copper-cored cable: mass from length, not authored.
constexpr int kWireSpanMin = 3;
constexpr int kWireSpanMax = 7;
constexpr int kWireTriesPerRoomish = 12000; // draws over the whole floor
constexpr float kWireKgPerMetre = 0.35f;

// The world point a chain or a sheet is pinned at: the cell's tangent centre,
// lifted off the real ceiling face by `lift` INTO the matter, so the visible
// span starts exactly at the face.
vec3 anchor_point(const GravityFrame& f, const WalkCell& c, float face,
                  float lift) {
    vec3 p{};
    vec_set(p, f.tanA,
            (static_cast<float>(cell_axis(c, f.tanA)) + 0.5f) * kCellSize);
    vec_set(p, f.tanB,
            (static_cast<float>(cell_axis(c, f.tanB)) + 0.5f) * kCellSize);
    vec_set(p, f.axis, face + static_cast<float>(f.upSign) * lift);
    return p;
}

void bake_wires(const World& w, const GravityFrame& f, std::uint32_t fseed,
                int tries, AntourageBake& out) {
    const MacroGrid& g = w.grid();
    // Air under a ceiling AND over more air (hug_ok): wires belong over walkable
    // space, not inside the one-cell crevices the attic hole-punch leaves.
    for (int t = 0; t < tries; ++t) {
        const std::uint32_t h = hash_u32(fseed ^ (static_cast<std::uint32_t>(t) *
                                             0x9E3779B9u));
        const WalkCell c0{static_cast<int>(h & 127u),
                          static_cast<int>((h >> 7) & 127u),
                          static_cast<int>((h >> 14) & 127u)};
        const int span = kWireSpanMin +
                         static_cast<int>((h >> 21) %
                                          (kWireSpanMax - kWireSpanMin + 1u));
        const int spanAxis = ((h >> 27) & 1u) ? f.tanA : f.tanB;
        const WalkCell c1 = offset(c0, spanAxis, span); // unwrapped: see offset()
        if (!hug_ok(g, f, c0)) continue;
        if (!hug_ok(g, f, c1)) continue;
        bool clear = true;
        for (int u = 1; u < span && clear; ++u)
            clear = is_air(g, offset(c0, spanAxis, u));
        if (!clear) continue;

        // Anchor to the REAL ceiling face at each end — the sandwich is
        // partially carved from the air side, and an end pinned on the cell
        // plane hangs from visible air. A holed centre column rejects the spot.
        const float face0 = ceiling_face(g, f, c0, true);
        const float face1 = ceiling_face(g, f, c1, true);
        if (face0 < 0.0f || face1 < 0.0f) continue;

        const WalkCell h0 = wrap_all(stepped(c0, f.axis, f.upSign));
        const WalkCell h1 = wrap_all(stepped(c1, f.axis, f.upSign));
        WireChain c{};
        c.ax0 = static_cast<std::uint8_t>(h0.x);
        c.ay0 = static_cast<std::uint8_t>(h0.y);
        c.az0 = static_cast<std::uint8_t>(h0.z);
        c.ax1 = static_cast<std::uint8_t>(h1.x);
        c.ay1 = static_cast<std::uint8_t>(h1.y);
        c.az1 = static_cast<std::uint8_t>(h1.z);
        const vec3 a = anchor_point(f, c0, face0, 0.12f);
        const vec3 b = anchor_point(f, c1, face1, 0.12f);
        const float spanM = static_cast<float>(span) * kCellSize;
        // Sag is the one thing here that is a FORCE, not a shape: a cable of
        // given slack takes the same catenary under any pull, and under NO pull
        // takes none at all — it hangs straight, and its rest length is the
        // segment itself so the verlet has nothing to buckle ([gravity.md]).
        const float sag = f.pull ? 0.15f * spanM : 0.0f;
        const float up = static_cast<float>(f.upSign);
        for (int i = 0; i < kWirePoints; ++i) {
            const float s = static_cast<float>(i) /
                            static_cast<float>(kWirePoints - 1);
            vec3 p = a + (b - a) * s;
            // parabola ≈ catenary
            vec_add(p, f.axis, -up * (sag * 4.0f * s * (1.0f - s)));
            c.p[i] = p;
        }
        c.restLen = (f.pull ? spanM * 1.02f : spanM) /
                    static_cast<float>(kWirePoints - 1);
        c.massKg = spanM * kWireKgPerMetre;
        c.face = antourage_face_pack(f.axis, -f.upSign);
        c.matId = static_cast<std::uint8_t>(kMatPipeMetal); // cable sheath
        out.wires.push_back(c);
    }
}

// --- CLOTH module: hanging curtains/tarps -----------------------------------
// The 2D-sheet primitive's first author ([antourage.h] ClothSheet): a strip of
// canvas hung from the real ceiling under-face, top row pinned, everything
// else swinging — pushed through by every body on the floor. The candidate
// test mirrors bake_wires (ceilinged air over clear air) plus headroom below,
// so a curtain hangs across walkable space, never inside an attic crevice.
constexpr int kClothTries = 6000;       // draws over the whole floor
constexpr float kClothWidthM = 1.8f;    // across, metres
constexpr float kClothDropM = 1.6f;     // hang, metres

void bake_cloths(const World& w, const GravityFrame& f, std::uint32_t fseed,
                 int tries, AntourageBake& out) {
    const MacroGrid& g = w.grid();
    for (int t = 0; t < tries; ++t) {
        const std::uint32_t h = hash_u32(fseed ^ (static_cast<std::uint32_t>(t) *
                                             0x9E3779B9u));
        const WalkCell c0{static_cast<int>(h & 127u),
                          static_cast<int>((h >> 7) & 127u),
                          static_cast<int>((h >> 14) & 127u)};
        const int spanAxis = ((h >> 27) & 1u) ? f.tanA : f.tanB;
        const WalkCell c1 = offset(c0, spanAxis, 1); // unwrapped: see offset()
        // Density roll: curtains are an accent, not a jungle — wires own the
        // ceilings, a sheet appears roughly once per eight candidate spots.
        if (((h >> 21) & 7u) != 0u) continue;
        // Both top-corner cells and the span between them under real ceiling.
        if (!hug_ok(g, f, c0)) continue;
        if (!hug_ok(g, f, c1)) continue;
        const float face0 = ceiling_face(g, f, c0, true);
        const float face1 = ceiling_face(g, f, c1, true);
        if (face0 < 0.0f || face1 < 0.0f) continue;

        const WalkCell h0 = wrap_all(stepped(c0, f.axis, f.upSign));
        const WalkCell h1 = wrap_all(stepped(c1, f.axis, f.upSign));
        ClothSheet s{};
        s.ax0 = static_cast<std::uint8_t>(h0.x);
        s.ay0 = static_cast<std::uint8_t>(h0.y);
        s.az0 = static_cast<std::uint8_t>(h0.z);
        s.ax1 = static_cast<std::uint8_t>(h1.x);
        s.ay1 = static_cast<std::uint8_t>(h1.y);
        s.az1 = static_cast<std::uint8_t>(h1.z);
        // Top edge: centred between the two cells, sunk to whichever real face
        // is further DOWN so no corner pins into air.
        const float up = static_cast<float>(f.upSign);
        const float face = down_key(f, face0) < down_key(f, face1) ? face0 : face1;
        vec3 mid = anchor_point(f, c0, face, 0.10f);
        vec_add(mid, spanAxis, 0.5f * kCellSize);
        vec3 across{};
        vec_set(across, spanAxis, 1.0f);
        s.restX = kClothWidthM / static_cast<float>(kClothW - 1);
        s.restY = kClothDropM / static_cast<float>(kClothH - 1);
        // The sheet's DROP is shape, not force: a curtain keeps the plane it was
        // hung in even with no pull (only the wire's sag is a force, above).
        for (int r = 0; r < kClothH; ++r)
            for (int c = 0; c < kClothW; ++c) {
                const float t01 = static_cast<float>(c) /
                                      static_cast<float>(kClothW - 1) -
                                  0.5f;
                vec3 p = mid + across * (t01 * kClothWidthM);
                vec_add(p, f.axis, -up * (static_cast<float>(r) * s.restY));
                s.p[r * kClothW + c] = p;
            }
        s.pinMask = 0xFFu; // the top row
        // Canvas has no material row of its own yet; plaster's dusty beige is
        // the closest honest tint for the shreds. One CSV line from real.
        s.face = antourage_face_pack(f.axis, -f.upSign);
        s.matId = static_cast<std::uint8_t>(kMatPlaster);
        out.cloths.push_back(s);
    }
}

} // namespace

void bake_antourage(const World& w, int number, unsigned seed,
                    AntourageBake& out) {
    // ISOTROPY ([gravity.md]): the walkers speak the DECLARED frame, so this
    // dresses every regime — an axis regime hangs its pipes off the ceiling that
    // regime names, and Zero, which names no axis, gets all six faces instead of
    // a decreed one (owner, 2026-08-04). Silence is not an option any more.
    GravityFrame frames[kMaxGravityFrames];
    const int n = gravity_frames(w.gravity(), frames);
    const std::uint32_t fseed =
        giga::hash_u32(static_cast<std::uint32_t>(seed) ^
                       (static_cast<std::uint32_t>(number) * 0xA24BAED1u));
    for (int i = 0; i < n; ++i) {
        const GravityFrame& f = frames[i];
        // The walker budget is per FLOOR, not per frame: a zero-g floor spreads
        // the SAME dressing over six faces instead of one, so the GPU ceilings
        // ([antourage.md]) hold whatever the regime is. Frame 0 keeps the floor's
        // own seed, which is what makes a one-frame regime bit-for-bit the bake
        // this file has always produced.
        const std::uint32_t fs =
            i == 0 ? fseed
                   : hash_u32(fseed ^ static_cast<std::uint32_t>(i) * 0x2545F491u);
        bake_pipes(w, f, fs, kPipeWalks / n, out);
        bake_wires(w, f, hash_u32(fs ^ 0x5A303B0Du), kWireTriesPerRoomish / n, out);
        bake_cloths(w, f, hash_u32(fs ^ 0x7C0FFEE1u), kClothTries / n, out);
    }
}

// --- A SEVERED PIECE, FALLING -----------------------------------------------

void antourage_detach_step(const World& w, std::vector<DetachedPiece>& pieces,
                           float dt) {
    if (pieces.empty() || dt <= 0.0f) return;
    for (std::size_t i = 0; i < pieces.size();) {
        DetachedPiece& d = pieces[i];
        d.life -= dt;
        if (d.life <= 0.0f) {           // spent: swap-erase keeps the array dense
            d = pieces.back();
            pieces.pop_back();
            continue;
        }
        d.vel = d.vel + w.gravity().at(d.pos) * dt;
        // Half-extents of the piece's own box. The collision predicate is the
        // SOLVER's (`aabb_overlaps_solid`), so a pipe rests on exactly the
        // surface a body would stand on — one truth, not a second copy.
        const vec3 half = d.scale * 0.5f;
        bool grounded = false;
        for (int a = 0; a < 3; ++a) {
            vec3 next = d.pos;
            vec_add(next, a, vec_axis(d.vel, a) * dt);
            if (!aabb_overlaps_solid(w, next, half)) {
                d.pos = next;
                continue;
            }
            // Blocked on this axis: kill that component and scrub the tumble.
            // A little restitution reads as metal clanging off concrete rather
            // than a box glued mid-air.
            vec_set(d.vel, a, vec_axis(d.vel, a) * -0.18f);
            grounded = true;
        }
        if (grounded) {
            d.vel = d.vel * 0.6f;
            d.spin *= 0.5f;
        }
        d.yaw += d.spin * dt;
        ++i;
    }
}

// --- DESTRUCTION ------------------------------------------------------------

// Did the matter this end was pinned TO go away? A cell is 2 m and a carve works
// in 0.25 m sub-voxels, so "the cell is air" is far too coarse a question: it
// only becomes true once all 512 sub-voxels are gone, and a player-sized hole
// punched exactly where the wire hangs left it dangling from a cell that was
// still 90% full (owner, live play 2026-08-05). So ask what the BAKE asked when
// it chose the spot — is there still matter in the attachment column of the face
// it hangs off ([macro_grid.h] face_layer, centre 2x2). Same question, same
// answer, and the thing lets go exactly when the matter it hung from does.
static bool anchor_gone(const MacroGrid& g, int x, int y, int z,
                        std::uint8_t face) {
    if (g.cell(x, y, z) == kCellAir) return true;
    return g.mask(x, y, z).face_layer(antourage_face_axis(face),
                                      antourage_face_dir(face), true) < 0;
}


bool antourage_alive(const MacroGrid& g, const AntourageInstance& it) {
    // BOTH ends, and each by the SUB-VOXEL column it hugs (anchor_gone below):
    // a pipe with one end in the void is not a pipe, and a pipe whose wall was
    // shot out where it clamps is not hanging on anything either.
    return !anchor_gone(g, it.ax0, it.ay0, it.az0, it.face) &&
           !anchor_gone(g, it.ax1, it.ay1, it.az1, it.face);
}
std::uint8_t wire_live_pins(const MacroGrid& g, const WireChain& c) {
    std::uint8_t m = c.pinMask;
    if (anchor_gone(g, c.ax0, c.ay0, c.az0, c.face)) m &= ~std::uint8_t{1u};
    if (anchor_gone(g, c.ax1, c.ay1, c.az1, c.face))
        m &= static_cast<std::uint8_t>(~(1u << (kWirePoints - 1)));
    return m;
}

std::uint32_t cloth_live_pins(const MacroGrid& g, const ClothSheet& s) {
    std::uint32_t m = s.pinMask;
    // The top row splits between the two corner cells it hangs from.
    constexpr std::uint32_t kLeft = (1u << (kClothW / 2)) - 1u;      // 0x0F
    constexpr std::uint32_t kRight = ((1u << kClothW) - 1u) & ~kLeft; // 0xF0
    if (anchor_gone(g, s.ax0, s.ay0, s.az0, s.face)) m &= ~kLeft;
    if (anchor_gone(g, s.ax1, s.ay1, s.az1, s.face)) m &= ~kRight;
    return m;
}

bool antourage_alive(const MacroGrid& g, const WireChain& c) {
    return wire_live_pins(g, c) != 0u;
}
bool antourage_alive(const MacroGrid& g, const ClothSheet& s) {
    return cloth_live_pins(g, s) != 0u;
}

namespace {

// Was this cell emptied by the op that produced `dirty`? The dirty list is
// small (the cells one blast touched) and the AIR test comes first, so the
// scan runs only for the handful of anchors that are gone at all — no set to
// build, no allocation on a path a shotgun can hit several times per tick.
bool cell_died(const MacroGrid& g, const std::uint32_t* dirty, std::size_t n,
               int x, int y, int z) {
    if (g.cell(x, y, z) != kCellAir) return false;
    const std::uint32_t key = static_cast<std::uint32_t>(macro_index(x, y, z));
    for (std::size_t i = 0; i < n; ++i)
        if (dirty[i] == key) return true;
    return false;
}

// The chain/sheet twin of cell_died: the anchor is GONE now (sub-voxel aware,
// anchor_gone above) and the cell it lived in is in this op's dirty list, so it
// was this carve that took it. The dirty list names cells whose MASK changed, so
// a partial carve of a still-solid cell is in it — which is exactly the case the
// cell-level test used to miss.
bool anchor_died(const MacroGrid& g, const std::uint32_t* dirty, std::size_t n,
                 int x, int y, int z, std::uint8_t face) {
    if (!anchor_gone(g, x, y, z, face)) return false;
    const std::uint32_t key = static_cast<std::uint32_t>(macro_index(x, y, z));
    for (std::size_t i = 0; i < n; ++i)
        if (dirty[i] == key) return true;
    return false;
}

// Did the piece hanging between these two anchors die on THIS op? It must be
// dead now AND have been alive before: every anchor is either still solid or
// was severed by this very carve, and at least one was severed. Without the
// second half a piece killed an hour ago would shed debris again every time a
// carve grazed its other anchor.
bool pair_died(const MacroGrid& g, const std::uint32_t* dirty, std::size_t n,
               int x0, int y0, int z0, int x1, int y1, int z1) {
    const bool d0 = cell_died(g, dirty, n, x0, y0, z0);
    const bool d1 = cell_died(g, dirty, n, x1, y1, z1);
    if (!d0 && !d1) return false;
    if (!d0 && g.cell(x0, y0, z0) == kCellAir) return false; // already dead
    if (!d1 && g.cell(x1, y1, z1) == kCellAir) return false;
    return true;
}

} // namespace

std::uint32_t antourage_carve_step(const World& w, const AntourageBake& bake,
                                   const std::uint32_t* dirtyCells,
                                   std::size_t dirtyCount,
                                   ParticleBurstQueue& bursts,
                                   std::uint32_t seed,
                                   std::vector<DetachedPiece>* fell) {
    if (dirtyCells == nullptr || dirtyCount == 0) return 0;
    const MacroGrid& g = w.grid();
    // Debris falls along gravity — the VECTOR at the piece, not a regime branch:
    // a regional field tips the burst the way it tips a body, and in zero-g the
    // shards drift from where they were cut instead of down a decreed axis.
    auto fall = [&](vec3 at) { return normalize(w.gravity().at(at)) * 0.4f; };
    std::uint32_t dead = 0;
    for (std::size_t i = 0; i < bake.instances.size(); ++i) {
        const AntourageInstance& it = bake.instances[i];
        if (!pair_died(g, dirtyCells, dirtyCount, it.ax0, it.ay0, it.az0,
                       it.ax1, it.ay1, it.az1))
            continue;
        ++dead;
        bursts.push(it.pos, fall(it.pos), ParticleKind::Debris, 4, it.matId,
                    seed ^ static_cast<std::uint32_t>(i) * 0x9E3779B9u);
        // ...and the leg itself does not blink out: it drops, tumbles and lies
        // there for as long as a severed chain does ([antourage.h] FallClock).
        if (fell != nullptr) {
            const std::uint32_t h =
                hash_u32(seed ^ static_cast<std::uint32_t>(i) * 0x27220A95u);
            DetachedPiece d{};
            d.pos = it.pos;
            d.scale = it.scale;
            // A nudge off the wall it hugged, so it visibly lets go instead of
            // sliding straight down the surface, plus a lazy tumble.
            d.vel = normalize(fall(it.pos)) * 0.6f;
            vec_add(d.vel, antourage_face_axis(it.face),
                    static_cast<float>(antourage_face_dir(it.face)) * 0.45f);
            d.yaw = it.yaw;
            d.spin = (static_cast<float>(h & 255u) / 255.0f - 0.5f) * 2.4f;
            d.life = kAntourageFallSec;
            d.shape = it.shape;
            d.matId = it.matId;
            fell->push_back(d);
        }
    }
    // A chain or a sheet dies only when the LAST thing holding it lets go: cut
    // one end and it dangles (wire_live_pins). So the test is "an anchor was
    // severed by this op AND nothing is pinned any more".
    for (std::size_t i = 0; i < bake.wires.size(); ++i) {
        const WireChain& c = bake.wires[i];
        const bool cut =
            anchor_died(g, dirtyCells, dirtyCount, c.ax0, c.ay0, c.az0, c.face) ||
            anchor_died(g, dirtyCells, dirtyCount, c.ax1, c.ay1, c.az1, c.face);
        if (!cut || antourage_alive(g, c)) continue;
        ++dead;
        const vec3 mid = c.p[kWirePoints / 2];
        bursts.push(mid, fall(mid), ParticleKind::Debris, 3,
                    c.matId, seed ^ 0x5A303B0Du ^
                                 static_cast<std::uint32_t>(i) * 0x9E3779B9u);
    }
    for (std::size_t i = 0; i < bake.cloths.size(); ++i) {
        const ClothSheet& s = bake.cloths[i];
        const bool cut =
            anchor_died(g, dirtyCells, dirtyCount, s.ax0, s.ay0, s.az0, s.face) ||
            anchor_died(g, dirtyCells, dirtyCount, s.ax1, s.ay1, s.az1, s.face);
        if (!cut || antourage_alive(g, s)) continue;
        ++dead;
        // Canvas tears into dust, not chunks.
        const vec3 mid = s.p[kClothPoints / 2];
        bursts.push(mid, fall(mid), ParticleKind::Dust, 4, s.matId,
                    seed ^ 0x7C0FFEE1u ^
                        static_cast<std::uint32_t>(i) * 0x9E3779B9u);
    }
    return dead;
}

} // namespace giga::game

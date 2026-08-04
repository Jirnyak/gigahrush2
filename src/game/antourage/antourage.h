// ANTOURAGE — baked decoration modules (owner's design, 2026-08-02).
//
// After a floor module builds its voxel geometry, antourage modules run over
// the finished grid — each a self-contained generator ("генератор проги внутри
// проги") that reads the WORLD CONTEXT (cells, sub-voxels, gravity regime,
// seed) and bakes dressing: pipes along walls, hanging wires, radiators,
// stalactites.
//
// THE LAW (owner, 2026-08-02, refined twice): the grid is only the ANCHOR.
// An antourage object is a cheap procedural MESH — any size, including smaller
// than a sub-voxel — anchored to REAL world voxels (the wall or ceiling it
// hugs), which are visible as THEMSELVES. Antourage never writes voxels: a
// voxel that "exists but is invisible" is a contradiction — invisible means
// air. If a module wants solid matter, it writes ordinary VISIBLE world
// geometry like the floor generator does, and that is a different job.
//
// Destruction needs no machinery: every emitted piece records the solid cells
// it hangs from, and the consumer checks them against the LIVE grid — carve
// the anchor away and the piece stops being drawn (+ debris, later).
//
// Determinism: bake_antourage is a pure function of (grid contents, number,
// seed) — a recycled World re-bakes bit-for-bit, nothing is persisted.
// Pure game-layer + core: no SDL/Vulkan, headless-testable.
#pragma once

#include <cstdint>
#include <vector>

#include "core/math.h"
#include "game/particles.h" // the debris a severed piece owes the world

namespace giga {
class World;
class MacroGrid;
}

namespace giga::game {

// One hanging wire: a verlet chain between two ceiling anchors. Points are the
// REST pose (catenary sag along gravity); the GPU backend integrates live
// points from this and the bodies that brush them. The same parameterization
// (points + rest lengths + masses) is the CPU gameplay-ragdoll format — one
// chain math, two backends (owner's decision, 2026-08-02).
inline constexpr int kWirePoints = 8;
struct WireChain {
    vec3 p[kWirePoints];       // rest pose, world units
    float restLen = 0.0f;      // segment rest length (uniform per chain)
    float massKg = 0.0f;       // whole-chain mass (materials density * volume)
    // The two anchor CELLS. If either is carved to air the chain is dead —
    // checked against the live grid by the consumer, never cached.
    std::uint8_t ax0, ay0, az0;
    std::uint8_t ax1, ay1, az1;
    // Which of the 8 points are PINNED (bit i = point i). 0x81 = both ends —
    // a hanging wire. 0x01 = top end only — a strip curtain that swings free
    // and is pushed aside by whoever walks through (the GPU verlet already
    // does the pushing; this mask is all a designer needs to set).
    std::uint8_t pinMask = 0x81;
    // Material row the chain is made of ([world/materials.h]). The draw is a
    // plain line today; this is what tints the DEBRIS when a carve severs it,
    // so the shred matches the thing that shredded — data, not a constant in
    // the destruction path.
    std::uint8_t matId = 0;
};

// The THIRD universal primitive (owner's decision, 2026-08-03): a 2D verlet
// SHEET — curtain, tarp, flag, web membrane. Same chain math as WireChain,
// constraints along two axes; the GPU backend integrates it and every body on
// the floor pushes through it (nobody is special — the player is an NPC with
// a camera). Fixed grid so the GPU struct is fixed-size: kClothW x kClothH
// points, row-major, row 0 = the TOP row (pinned by default).
inline constexpr int kClothW = 8;
inline constexpr int kClothH = 4;
inline constexpr int kClothPoints = kClothW * kClothH; // 32 — one pin bit each
struct ClothSheet {
    vec3 p[kClothPoints];    // rest pose, world units, row-major from the top
    float restX = 0.0f;      // horizontal neighbour rest length
    float restY = 0.0f;      // vertical neighbour rest length
    // The two anchor CELLS (the ceiling cells over the top corners). Either
    // carved to air -> the sheet is dead; probed against the LIVE grid.
    std::uint8_t ax0, ay0, az0;
    std::uint8_t ax1, ay1, az1;
    // Bit i pins point i. Default: the whole top row hangs, the rest swings.
    std::uint32_t pinMask = 0xFFu;
    std::uint8_t matId = 0; // debris tint, as on WireChain
};

// THE UNIVERSAL PRIMITIVE (owner's contract, 2026-08-03): a module emits
// INSTANCES — shape + transform + material + anchor cells — and the core
// renders them without knowing what they depict. Pipes, radiators, bas-relief,
// stalagmites: all the same row; a designer's module is one function
// (world context, seed) -> primitives, and the CORE IS NEVER TOUCHED AGAIN.
//
// `shape` is the render catalog ordinal (kShape* below; the catalog grows
// without changing this struct). `color` of (0,0,0) means "use the material
// table's albedo for matId". Aliveness: drawn while BOTH anchor cells are
// solid in the LIVE grid — carve them away and the piece vanishes. Point
// pieces set both anchors to one cell.
struct AntourageInstance {
    vec3 pos;                     // world centre
    vec3 scale;                   // metres per axis (unit shapes span +-0.5)
    vec3 color{0.0f, 0.0f, 0.0f}; // 0,0,0 = material albedo
    float yaw = 0.0f;             // Z-axis yaw
    std::uint8_t shape = 0;
    std::uint8_t matId = 0;
    std::uint8_t emissive = 0;
    std::uint8_t pad_ = 0;
    std::uint8_t ax0, ay0, az0;   // anchor cells for the LIVE-grid probe
    std::uint8_t ax1, ay1, az1;
    std::uint8_t pad2_ = 0, pad3_ = 0;
};

// Everything one floor's antourage bake produced. Owned per resident floor
// (like FloorNav) and freed on eviction. PURE primitive/anchor data — the
// bake never mutates the grid. Chains are the second universal primitive
// (verlet ropes: wires, hoses, hanging chains); instances are everything
// rigid.
struct AntourageBake {
    std::vector<AntourageInstance> instances;
    std::vector<WireChain> wires;
    std::vector<ClothSheet> cloths;
    std::uint32_t pipeCells = 0;   // cells the pipe walker traversed (stats)
};

// Render catalog ordinals (render/prop_mesh.h PropShape), mirrored so game
// modules never include render/. suite_props pins the catalog — drift is a
// red test, not a silent misdraw.
inline constexpr std::uint8_t kShapeBox = 0;
inline constexpr std::uint8_t kShapeCylinderX = 1;
inline constexpr std::uint8_t kShapeCylinderY = 2;
inline constexpr std::uint8_t kShapeCylinderZ = 3;

// Pipe mesh radius. Purely visual — antourage carries no collision.
inline constexpr float kPipeRadius = 0.30f;

// Run every registered antourage module over the built floor. READS the grid,
// never writes it; fills `out` with mesh/anchor data. Call after the floor
// module's geometry (any time before first render).
void bake_antourage(const World& w, int number, unsigned seed,
                    AntourageBake& out);

// --- DESTRUCTION ------------------------------------------------------------
// Aliveness is a PROBE, never a cached flag (the law at the top of this file):
// a piece is drawn while both its anchor cells are solid in the LIVE grid.
// These are the one place a consumer asks the question, so the rule cannot
// drift between the instance path, the wire pass and the cloth pass.
bool antourage_alive(const MacroGrid& g, const AntourageInstance& it);
bool antourage_alive(const MacroGrid& g, const WireChain& c);
bool antourage_alive(const MacroGrid& g, const ClothSheet& s);

// The carve's edge detector, and the antourage twin of anchor_validate_step
// ([game/prop_system.h] — ECS props detach the same way on the same input).
//
// A carve only ever turns solid into air, so the op's `dirtyCells` name
// EXACTLY the pieces that died on THIS op: an anchor that is now air and sat
// in the dirty set was severed a moment ago. No bookkeeping, no dead-flag to
// keep in sync with a reload — pass a carve's dirty list, get its casualties.
//
// Every casualty pushes one debris burst into the shared particle queue
// ([game/particles.h]), tinted by the piece's own material. Returns how many
// pieces died, so the caller knows it owes a GPU re-pack (the severed pipe is
// still in the instance list the renderer uploaded last time).
std::uint32_t antourage_carve_step(const World& w, const AntourageBake& bake,
                                   const std::uint32_t* dirtyCells,
                                   std::size_t dirtyCount,
                                   ParticleBurstQueue& bursts,
                                   std::uint32_t seed);

} // namespace giga::game

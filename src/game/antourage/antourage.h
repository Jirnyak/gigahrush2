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

namespace giga {
class World;
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

} // namespace giga::game

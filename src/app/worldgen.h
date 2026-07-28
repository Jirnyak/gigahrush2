// Demo world generation. Not part of the engine contract — just enough world to
// prove the core (macro grid, sub-voxels, fields, fluid, toroidal physics)
// renders and is walkable. A real game replaces this with its own generators.
#pragma once

namespace giga {
class World;
}

namespace giga {

// Which demo world to build.
enum class WorldGenMode {
    // A fully-connected 3D labyrinth: recursive-backtracker maze over a 64^3
    // room lattice, wrapped on all axes (kept as an isotropy test bed).
    Maze,
    // A toroidal stack of khrushchevka floors: 2D apartment plans extruded to a
    // fixed height and stacked along Z. Slabs, interior walls, doorways and a
    // few vertical stairwell shafts. Because Z wraps, the top floor's ceiling is
    // floor 0's slab — the stack has no top or bottom.
    FloorStack,
};

// Build `mode` into `world`'s macro grid. Deterministic given `seed`.
void generate_demo_world(World& world, unsigned seed = 1337u,
                         WorldGenMode mode = WorldGenMode::FloorStack);

} // namespace giga

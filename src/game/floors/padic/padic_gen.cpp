#include "game/floors/padic/padic.h"

#include "world/materials.h"
#include "world/lattice.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

void generate_padic_floor(World& world, int number, const FloorSpec& spec, unsigned seed) {
    MacroGrid& g = world.grid();
    constexpr CellType kSlab = kMatAcidPool;
    constexpr CellType kHubPad = kMatHubPad;

    // 0. Clear to air
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                g.clear_cell(x, y, z);
            }
        }
    }

    // 1. Padic Geometry Iteration 1:
    // Split the 128x128x128 torus into tiers. Each tier is 4 blocks high.
    // The slab of each tier is 1/8 of a block thick in Z.
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (z % 4 == 0) {
                    // This is the floor (slab) of the tier.
                    g.fill_cell(x, y, z, kSlab);
                    
                    // Make it 1/8 block thick in Z (only sz = 0 is solid)
                    auto& mask = g.mask(x, y, z);
                    mask.clear_all();
                    for (int sy = 0; sy < kSubDim; ++sy) {
                        for (int sx = 0; sx < kSubDim; ++sx) {
                            mask.set(sub_bit(sx, sy, 0));
                        }
                    }
                }
            }
        }
    }

    // 2. Mandatory Fast-Travel / Navigation Lattice
    // Ported from floor_gen.cpp: MUST exist so elevators work.
    constexpr int kShaftR = 1;
    constexpr int kLobbyR = 3;
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx);
            const int cy = lattice_coord(ny);
            
            // Clear shaft column
            for (int z = 0; z < kMacroDim; ++z) {
                for (int dy = -kShaftR; dy <= kShaftR; ++dy) {
                    for (int dx = -kShaftR; dx <= kShaftR; ++dx) {
                        g.clear_cell(wrap_macro(cx + dx), wrap_macro(cy + dy), z);
                    }
                }
            }
            
            // Clear lobbies (assuming storeys every 16 cells for the padic placeholder)
            for (int f = 0; f < kMacroDim / 16; ++f) {
                const int base = f * 16;
                for (int z = base + 1; z < base + 16; ++z) {
                    for (int dy = -kLobbyR; dy <= kLobbyR; ++dy) {
                        for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                            g.clear_cell(wrap_macro(cx + dx), wrap_macro(cy + dy), z);
                        }
                    }
                }
            }
            
            // Hub pads
            for (int nz = 0; nz < kLatticeDim; ++nz) {
                const int z0 = lattice_coord(nz);
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy) {
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx);
                        const int y = wrap_macro(cy + dy);
                        if (g.cell(x, y, z0) != kCellAir) {
                            g.set_cell(x, y, z0, kHubPad);
                        }
                    }
                }
            }
            
            // Extraction pad
            if (number == 0) {
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy) {
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx);
                        const int y = wrap_macro(cy + dy);
                        if (g.cell(x, y, 0) != kCellAir) {
                            g.set_cell(x, y, 0, kMatExtract);
                        }
                    }
                }
            }
            
            // Elevator column posts
            for (int sy = -1; sy <= 1; sy += 2) {
                for (int sx = -1; sx <= 1; sx += 2) {
                    for (int z = 0; z < kMacroDim; ++z) {
                        g.fill_cell(wrap_macro(cx + sx * 2), wrap_macro(cy + sy * 2), z, kHubPad);
                    }
                }
            }
        }
    }

    (void)spec.population; // ignored
    (void)seed; // Will be used in actual generation
}

} // namespace giga::game

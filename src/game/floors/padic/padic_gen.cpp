#include "game/floors/padic/padic.h"

#include "world/materials.h"
#include "world/lattice.h"
#include "world/types.h"
#include "world/world.h"
#include "game/floor_gen.h"
#include <vector>

namespace giga::game {

namespace {

void set_subvoxel(MacroGrid& g, int cx, int cy, int cz, int sx, int sy, int sz, CellType mat) {
    int mx = wrap_macro(cx + sx / 8);
    int my = wrap_macro(cy + sy / 8);
    int mz = cz + sz / 8;
    if (mz >= kMacroDim) return;
    
    int sub_x = sx % 8;
    int sub_y = sy % 8;
    int sub_z = sz % 8;
    
    if (g.cell(mx, my, mz) == kCellAir) {
        g.set_cell(mx, my, mz, mat);
        g.mask(mx, my, mz).clear_all();
    }
    // We force the material to the last written one
    g.set_cell(mx, my, mz, mat);
    g.mask(mx, my, mz).set(sub_bit(sub_x, sub_y, sub_z));
}

void clear_macro_block(MacroGrid& g, int cx, int cy, int cz, int w, int h, int d) {
    for (int dz = 0; dz < d; ++dz) {
        for (int dy = 0; dy < h; ++dy) {
            for (int dx = 0; dx < w; ++dx) {
                g.clear_cell(wrap_macro(cx + dx), wrap_macro(cy + dy), cz + dz);
            }
        }
    }
}

void draw_stairwell(MacroGrid& g, int cx, int cy, int base_z) {
    // Clear 4x4x3 macro blocks
    clear_macro_block(g, cx, cy, base_z, 4, 4, 3);
    
    for (int step = 0; step < 24; ++step) {
        int step_len = (step == 11 || step == 23) ? 10 : 2;
        int step_sx = (step < 12) ? (step < 11 ? step * 2 : 22) : (step < 23 ? 20 - (step - 12) * 2 : 0);
        int sy_start = (step < 12) ? 0 : 16;
        int sy_end = (step < 12) ? 15 : 31;
        
        for (int i = 0; i < step_len; ++i) {
            for (int sy = sy_start; sy <= sy_end; ++sy) {
                for (int fill_sz = 0; fill_sz <= step; ++fill_sz) {
                    set_subvoxel(g, cx, cy, base_z, step_sx + i, sy, fill_sz, kMatTread);
                }
            }
        }
    }
}

struct Room {
    int x, y, w, h;
};

void split_room(int x, int y, int w, int h, std::uint32_t& rng, std::vector<Room>& out_rooms) {
    if (w <= 16 || h <= 16) {
        out_rooms.push_back({x, y, w, h});
        return;
    }
    
    // Split alternating
    if (w > h) {
        int split_x = x + 3 + ((rng = rng * 1664525 + 1013904223) % (w - 5));
        split_room(x, y, split_x - x, h, rng, out_rooms);
        split_room(split_x, y, x + w - split_x, h, rng, out_rooms);
    } else {
        int split_y = y + 3 + ((rng = rng * 1664525 + 1013904223) % (h - 5));
        split_room(x, y, w, split_y - y, rng, out_rooms);
        split_room(x, split_y, w, y + h - split_y, rng, out_rooms);
    }
}


template <class Fn>
void for_each_padic_doorway(unsigned seed, int number, Fn&& fn) {
    std::uint32_t rng = seed ^ 0x7AD1C;
    for (int z = 0; z < kMacroDim; z += 3) {
        std::vector<Room> rooms;
        split_room(0, 0, 128, 60, rng, rooms);
        split_room(0, 68, 128, 128 - 68, rng, rooms);
        
        for (const auto& r : rooms) {
            fn(wrap_macro(r.x + r.w / 2), wrap_macro(r.y), z, 2, 1);
            fn(wrap_macro(r.x + r.w / 2), wrap_macro(r.y + r.h - 1), z, 2, 1);
            fn(wrap_macro(r.x), wrap_macro(r.y + r.h / 2), z, 2, 0);
            fn(wrap_macro(r.x + r.w - 1), wrap_macro(r.y + r.h / 2), z, 2, 0);
        }
    }
}
void draw_thin_wall_x(MacroGrid& g, int mx, int my, int base_z, int length) {
    for (int l = 0; l < length; ++l) {
        int x = wrap_macro(mx + l);
        int y = wrap_macro(my);
        // Draw a wall along X, let's say at sy = 3..4 (2 sub-voxels thick)
        for (int z = 0; z < 3; ++z) {
            int mz = base_z + z;
            if (mz >= kMacroDim) continue;
            for (int sz = 0; sz < 8; ++sz) {
                for (int sx = 0; sx < 8; ++sx) {
                    for (int sy = 3; sy <= 4; ++sy) {
                        // Skip if it's the door
                        if (l == length / 2 && sz < 6 && z < 2) continue; // simple door in the middle
                        set_subvoxel(g, x, y, mz, sx, sy, sz, kMatPlaster);
                    }
                }
            }
        }
    }
}

void draw_thin_wall_y(MacroGrid& g, int mx, int my, int base_z, int length) {
    for (int l = 0; l < length; ++l) {
        int x = wrap_macro(mx);
        int y = wrap_macro(my + l);
        for (int z = 0; z < 3; ++z) {
            int mz = base_z + z;
            if (mz >= kMacroDim) continue;
            for (int sz = 0; sz < 8; ++sz) {
                for (int sx = 3; sx <= 4; ++sx) {
                    for (int sy = 0; sy < 8; ++sy) {
                        if (l == length / 2 && sz < 6 && z < 2) continue; // simple door
                        set_subvoxel(g, x, y, mz, sx, sy, sz, kMatPlaster);
                    }
                }
            }
        }
    }
}

} // namespace

void generate_padic_floor(World& world, int number, const FloorSpec& spec, unsigned seed) {
    MacroGrid& g = world.grid();
    std::uint32_t rng = seed ^ 0x7AD1C;

    // 0. Clear to air
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                g.clear_cell(x, y, z);
            }
        }
    }

    // 1. Tiers and Floor Slabs (3 macro blocks spacing)
    for (int z = 0; z < kMacroDim; z += 3) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                // Procedural holes (grates)
                bool is_grate = false;
                // Grate pattern in the corridor
                if (y >= 60 && y < 68 && x % 16 > 12) {
                    is_grate = true;
                }
                
                g.fill_cell(x, y, z, is_grate ? kMatElectricGrate : kMatParquet);
                auto& mask = g.mask(x, y, z);
                mask.clear_all();
                
                for (int sy = 0; sy < kSubDim; ++sy) {
                    for (int sx = 0; sx < kSubDim; ++sx) {
                        if (is_grate) {
                            if ((sx + sy) % 2 == 0) mask.set(sub_bit(sx, sy, 0));
                        } else {
                            mask.set(sub_bit(sx, sy, 0));
                        }
                    }
                }
            }
        }
        
        // 2. Main Corridor & Apartment Layout
        std::vector<Room> rooms;
        // North block
        split_room(0, 0, 128, 60, rng, rooms);
        // South block
        split_room(0, 68, 128, 128 - 68, rng, rooms);
        
        for (const auto& r : rooms) {
            // Draw walls around the room
            draw_thin_wall_x(g, r.x, r.y, z, r.w);
            draw_thin_wall_x(g, r.x, r.y + r.h - 1, z, r.w);
            draw_thin_wall_y(g, r.x, r.y, z, r.h);
            draw_thin_wall_y(g, r.x + r.w - 1, r.y, z, r.h);
        }
        
        // 3. Stairwells along the corridor
        for (int sx = 16; sx < 128; sx += 32) {
            draw_stairwell(g, sx, 64 - 2, z); // 4x4 stairwell centered on Y=64
        }
    }

    // 4. Mandatory Fast-Travel / Navigation Lattice
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
            
            // Clear lobbies 
            for (int base = 0; base < kMacroDim; base += 3) {
                for (int z = base + 1; z < base + 3; ++z) {
                    if (z >= kMacroDim) continue;
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
                            g.set_cell(x, y, z0, kMatHubPad);
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
                        g.fill_cell(wrap_macro(cx + sx * 2), wrap_macro(cy + sy * 2), z, kMatHubPad);
                    }
                }
            }
        }
    }

    (void)spec.population;
}


std::uint32_t padic_doorways(int number, unsigned seed, std::vector<Doorway>& out) {
    std::uint32_t n = 0;
    for_each_padic_doorway(seed, number, [&](int cx, int cy, int cz, int h, int axis) {
        out.push_back(Doorway{
            static_cast<std::uint8_t>(cx),
            static_cast<std::uint8_t>(cy),
            static_cast<std::uint8_t>(cz),
            static_cast<std::uint8_t>(h),
            static_cast<std::uint8_t>(axis)
        });
        ++n;
    });
    return n;
}

} // namespace giga::game

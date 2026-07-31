import re

with open('src/game/floors/padic/padic_gen.cpp', 'r') as f:
    content = f.read()

# 1. Insert for_each_padic_doorway after split_room
insert_idx = content.find("void draw_thin_wall_x")

doorway_func = """
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
"""
content = content[:insert_idx] + doorway_func + content[insert_idx:]

# 2. Add padic_doorways implementation at the end of the file
doorways_impl = """
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
"""

content += doorways_impl

# Note: In padic_gen.cpp `#include "game/floor_gen.h"` must be added if not present to use Doorway type.
# Let's add it near the top.
include_idx = content.find("#include <vector>")
content = content[:include_idx] + "#include \"game/floor_gen.h\"\n" + content[include_idx:]


with open('src/game/floors/padic/padic_gen.cpp', 'w') as f:
    f.write(content)

// tools/xray_map.cpp
// Universal X-Ray Map & Architectural Blueprint Generator for GigaHrush 2.
//
// Supports 7 visualization modes:
//   1. struct: Sub-voxel (0.25m) geometry slice or volumetric density blueprint
//   2. zones:  Semantic room zoning (Corridors, Living, Kitchen, Bath, Social, HQ, etc.)
//   3. pop:    NPC population heatmap & discrete intent/faction markers
//   4. nav:    Geodesic distance field & flow vector lines to elevator hubs
//   5. danger: Perimeter radiation (1500-5000 uSv/h), Veretar toxicity & Samosbor gradient
//   6. props:  Light fixtures, doors (open/shut/locked), workbenches, terminals, crates

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "core/math.h"
#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"
#include "game/door.h"
#include "game/elevator.h"
#include "game/embody.h"
#include "game/faction.h"
#include "game/fast_travel.h"
#include "game/floor_catalog.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/interact_table.h"
#include "game/macro_sim.h"
#include "game/mob_table.h"
#include "game/needs.h"
#include "game/npc_pool.h"
#include "game/prop_system.h"
#include "game/role.h"
#include "game/room_zone.h"
#include "game/samosbor.h"
#include "world/destruct.h"
#include "world/gravity.h"
#include "world/lattice.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"
#include "world/types.h"
#include "world/world.h"

using namespace giga;
using namespace giga::game;

namespace {

// Тот же посев, что в main.cpp: один этаж — один сид, вариация по номеру.
std::uint32_t floor_seed_like_main(int floorNumber) {
    return 1337u ^ (static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u);
}

// ---------------------------------------------------------------------------
// 5x7 ASCII Bitmap Font Table (ASCII 32 ' ' .. 127 '~')
// ---------------------------------------------------------------------------
static const std::uint8_t kFont5x7[96][5] = {
    {0x00, 0x00, 0x00, 0x00, 0x00}, // 32 ' '
    {0x00, 0x00, 0x5F, 0x00, 0x00}, // 33 '!'
    {0x00, 0x07, 0x00, 0x07, 0x00}, // 34 '"'
    {0x14, 0x7F, 0x14, 0x7F, 0x14}, // 35 '#'
    {0x24, 0x2A, 0x7F, 0x2A, 0x12}, // 36 '$'
    {0x23, 0x13, 0x08, 0x64, 0x62}, // 37 '%'
    {0x36, 0x49, 0x55, 0x22, 0x50}, // 38 '&'
    {0x00, 0x05, 0x03, 0x00, 0x00}, // 39 '''
    {0x00, 0x1C, 0x22, 0x41, 0x00}, // 40 '('
    {0x00, 0x41, 0x22, 0x1C, 0x00}, // 41 ')'
    {0x14, 0x08, 0x3E, 0x08, 0x14}, // 42 '*'
    {0x08, 0x08, 0x3E, 0x08, 0x08}, // 43 '+'
    {0x00, 0x50, 0x30, 0x00, 0x00}, // 44 ','
    {0x08, 0x08, 0x08, 0x08, 0x08}, // 45 '-'
    {0x00, 0x60, 0x60, 0x00, 0x00}, // 46 '.'
    {0x20, 0x10, 0x08, 0x04, 0x02}, // 47 '/'
    {0x3E, 0x51, 0x49, 0x45, 0x3E}, // 48 '0'
    {0x00, 0x42, 0x7F, 0x40, 0x00}, // 49 '1'
    {0x42, 0x61, 0x51, 0x49, 0x46}, // 50 '2'
    {0x21, 0x41, 0x45, 0x4B, 0x31}, // 51 '3'
    {0x18, 0x14, 0x12, 0x7F, 0x10}, // 52 '4'
    {0x27, 0x45, 0x45, 0x45, 0x39}, // 53 '5'
    {0x3C, 0x4A, 0x49, 0x49, 0x30}, // 54 '6'
    {0x01, 0x71, 0x09, 0x05, 0x03}, // 55 '7'
    {0x36, 0x49, 0x49, 0x49, 0x36}, // 56 '8'
    {0x06, 0x49, 0x49, 0x29, 0x1E}, // 57 '9'
    {0x00, 0x36, 0x36, 0x00, 0x00}, // 58 ':'
    {0x00, 0x56, 0x36, 0x00, 0x00}, // 59 ';'
    {0x08, 0x14, 0x22, 0x41, 0x00}, // 60 '<'
    {0x14, 0x14, 0x14, 0x14, 0x14}, // 61 '='
    {0x00, 0x41, 0x22, 0x14, 0x08}, // 62 '>'
    {0x02, 0x01, 0x51, 0x09, 0x06}, // 63 '?'
    {0x32, 0x49, 0x79, 0x41, 0x3E}, // 64 '@'
    {0x7E, 0x11, 0x11, 0x11, 0x7E}, // 65 'A'
    {0x7F, 0x49, 0x49, 0x49, 0x36}, // 66 'B'
    {0x3E, 0x41, 0x41, 0x41, 0x22}, // 67 'C'
    {0x7F, 0x41, 0x41, 0x22, 0x1C}, // 68 'D'
    {0x7F, 0x49, 0x49, 0x49, 0x41}, // 69 'E'
    {0x7F, 0x09, 0x09, 0x09, 0x01}, // 70 'F'
    {0x3E, 0x41, 0x49, 0x49, 0x7A}, // 71 'G'
    {0x7F, 0x08, 0x08, 0x08, 0x7F}, // 72 'H'
    {0x00, 0x41, 0x7F, 0x41, 0x00}, // 73 'I'
    {0x20, 0x40, 0x41, 0x3F, 0x01}, // 74 'J'
    {0x7F, 0x08, 0x14, 0x22, 0x41}, // 75 'K'
    {0x7F, 0x40, 0x40, 0x40, 0x40}, // 76 'L'
    {0x7F, 0x02, 0x0C, 0x02, 0x7F}, // 77 'M'
    {0x7F, 0x04, 0x08, 0x10, 0x7F}, // 78 'N'
    {0x3E, 0x41, 0x41, 0x41, 0x3E}, // 79 'O'
    {0x7F, 0x09, 0x09, 0x09, 0x06}, // 80 'P'
    {0x3E, 0x41, 0x51, 0x21, 0x5E}, // 81 'Q'
    {0x7F, 0x09, 0x19, 0x29, 0x46}, // 82 'R'
    {0x46, 0x49, 0x49, 0x49, 0x31}, // 83 'S'
    {0x01, 0x01, 0x7F, 0x01, 0x01}, // 84 'T'
    {0x3F, 0x40, 0x40, 0x40, 0x3F}, // 85 'U'
    {0x1F, 0x20, 0x40, 0x20, 0x1F}, // 86 'V'
    {0x3F, 0x40, 0x38, 0x40, 0x3F}, // 87 'W'
    {0x63, 0x14, 0x08, 0x14, 0x63}, // 88 'X'
    {0x07, 0x08, 0x70, 0x08, 0x07}, // 89 'Y'
    {0x61, 0x51, 0x49, 0x45, 0x43}, // 90 'Z'
    {0x00, 0x7F, 0x41, 0x41, 0x00}, // 91 '['
    {0x02, 0x04, 0x08, 0x10, 0x20}, // 92 '\'
    {0x00, 0x41, 0x41, 0x7F, 0x00}, // 93 ']'
    {0x04, 0x02, 0x01, 0x02, 0x04}, // 94 '^'
    {0x40, 0x40, 0x40, 0x40, 0x40}, // 95 '_'
    {0x00, 0x01, 0x02, 0x04, 0x00}, // 96 '`'
    {0x20, 0x54, 0x54, 0x54, 0x78}, // 97 'a'
    {0x7F, 0x48, 0x44, 0x44, 0x38}, // 98 'b'
    {0x38, 0x44, 0x44, 0x44, 0x20}, // 99 'c'
    {0x38, 0x44, 0x44, 0x48, 0x7F}, // 100 'd'
    {0x38, 0x54, 0x54, 0x54, 0x18}, // 101 'e'
    {0x08, 0x7E, 0x09, 0x01, 0x02}, // 102 'f'
    {0x0C, 0x52, 0x52, 0x52, 0x3E}, // 103 'g'
    {0x7F, 0x08, 0x04, 0x04, 0x78}, // 104 'h'
    {0x00, 0x44, 0x7D, 0x40, 0x00}, // 105 'i'
    {0x20, 0x40, 0x44, 0x3D, 0x00}, // 106 'j'
    {0x7F, 0x10, 0x28, 0x44, 0x00}, // 107 'k'
    {0x00, 0x41, 0x7F, 0x40, 0x00}, // 108 'l'
    {0x7C, 0x04, 0x18, 0x04, 0x78}, // 109 'm'
    {0x7C, 0x08, 0x04, 0x04, 0x78}, // 110 'n'
    {0x38, 0x44, 0x44, 0x44, 0x38}, // 111 'o'
    {0x7C, 0x14, 0x14, 0x14, 0x08}, // 112 'p'
    {0x08, 0x14, 0x14, 0x18, 0x7C}, // 113 'q'
    {0x7C, 0x08, 0x04, 0x04, 0x08}, // 114 'r'
    {0x48, 0x54, 0x54, 0x54, 0x20}, // 115 's'
    {0x04, 0x3F, 0x44, 0x40, 0x20}, // 116 't'
    {0x3C, 0x40, 0x40, 0x20, 0x7C}, // 117 'u'
    {0x1C, 0x20, 0x40, 0x20, 0x1C}, // 118 'v'
    {0x3C, 0x40, 0x30, 0x40, 0x3C}, // 119 'w'
    {0x44, 0x28, 0x10, 0x28, 0x44}, // 120 'x'
    {0x0C, 0x50, 0x50, 0x50, 0x3C}, // 121 'y'
    {0x44, 0x64, 0x54, 0x4C, 0x44}, // 122 'z'
    {0x00, 0x08, 0x36, 0x41, 0x00}, // 123 '{'
    {0x00, 0x00, 0x7F, 0x00, 0x00}, // 124 '|'
    {0x00, 0x41, 0x36, 0x08, 0x00}, // 125 '}'
    {0x08, 0x08, 0x2A, 0x1C, 0x08}, // 126 '~'
    {0x7F, 0x7F, 0x7F, 0x7F, 0x7F}, // 127 block
};

// ---------------------------------------------------------------------------
// Image Canvas & Raster Operations
// ---------------------------------------------------------------------------
struct Image {
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::vector<std::uint8_t> rgb;

    void init(std::uint32_t w, std::uint32_t h,
              std::uint8_t r = 3, std::uint8_t g = 7, std::uint8_t b = 10) {
        width = w;
        height = h;
        rgb.assign(static_cast<std::size_t>(w) * h * 3, 0);
        for (std::size_t i = 0; i < static_cast<std::size_t>(w) * h; ++i) {
            rgb[i * 3 + 0] = r;
            rgb[i * 3 + 1] = g;
            rgb[i * 3 + 2] = b;
        }
    }

    void set_pixel(int x, int y, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        if (x < 0 || x >= static_cast<int>(width) || y < 0 || y >= static_cast<int>(height)) return;
        std::size_t idx = (static_cast<std::size_t>(y) * width + static_cast<std::size_t>(x)) * 3;
        rgb[idx + 0] = r;
        rgb[idx + 1] = g;
        rgb[idx + 2] = b;
    }

    void blend_pixel(int x, int y, std::uint8_t r, std::uint8_t g, std::uint8_t b, float alpha) {
        if (x < 0 || x >= static_cast<int>(width) || y < 0 || y >= static_cast<int>(height)) return;
        alpha = std::clamp(alpha, 0.0f, 1.0f);
        std::size_t idx = (static_cast<std::size_t>(y) * width + static_cast<std::size_t>(x)) * 3;
        rgb[idx + 0] = static_cast<std::uint8_t>(rgb[idx + 0] * (1.0f - alpha) + r * alpha);
        rgb[idx + 1] = static_cast<std::uint8_t>(rgb[idx + 1] * (1.0f - alpha) + g * alpha);
        rgb[idx + 2] = static_cast<std::uint8_t>(rgb[idx + 2] * (1.0f - alpha) + b * alpha);
    }

    void draw_line(int x0, int y0, int x1, int y1,
                   std::uint8_t r, std::uint8_t g, std::uint8_t b, float alpha = 1.0f) {
        int dx = std::abs(x1 - x0);
        int sx = x0 < x1 ? 1 : -1;
        int dy = -std::abs(y1 - y0);
        int sy = y0 < y1 ? 1 : -1;
        int err = dx + dy;
        while (true) {
            if (alpha >= 0.999f) set_pixel(x0, y0, r, g, b);
            else blend_pixel(x0, y0, r, g, b, alpha);
            if (x0 == x1 && y0 == y1) break;
            int e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
    }

    void draw_rect(int x, int y, int w, int h,
                   std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        draw_line(x, y, x + w - 1, y, r, g, b);
        draw_line(x + w - 1, y, x + w - 1, y + h - 1, r, g, b);
        draw_line(x + w - 1, y + h - 1, x, y + h - 1, r, g, b);
        draw_line(x, y + h - 1, x, y, r, g, b);
    }

    void fill_rect(int x, int y, int w, int h,
                   std::uint8_t r, std::uint8_t g, std::uint8_t b, float alpha = 1.0f) {
        for (int py = y; py < y + h; ++py) {
            for (int px = x; px < x + w; ++px) {
                if (alpha >= 0.999f) set_pixel(px, py, r, g, b);
                else blend_pixel(px, py, r, g, b, alpha);
            }
        }
    }

    void draw_circle(int cx, int cy, int radius,
                     std::uint8_t r, std::uint8_t g, std::uint8_t b, float alpha = 1.0f) {
        int x = 0, y = radius;
        int d = 3 - 2 * radius;
        auto plot = [&](int px, int py) {
            if (alpha >= 0.999f) set_pixel(px, py, r, g, b);
            else blend_pixel(px, py, r, g, b, alpha);
        };
        while (y >= x) {
            plot(cx + x, cy + y); plot(cx - x, cy + y);
            plot(cx + x, cy - y); plot(cx - x, cy - y);
            plot(cx + y, cy + x); plot(cx - y, cy + x);
            plot(cx + y, cy - x); plot(cx - y, cy - x);
            if (d < 0) d = d + 4 * x + 6;
            else { d = d + 4 * (x - y) + 10; --y; }
            ++x;
        }
    }

    void fill_circle(int cx, int cy, int radius,
                     std::uint8_t r, std::uint8_t g, std::uint8_t b, float alpha = 1.0f) {
        for (int dy = -radius; dy <= radius; ++dy) {
            for (int dx = -radius; dx <= radius; ++dx) {
                if (dx * dx + dy * dy <= radius * radius) {
                    if (alpha >= 0.999f) set_pixel(cx + dx, cy + dy, r, g, b);
                    else blend_pixel(cx + dx, cy + dy, r, g, b, alpha);
                }
            }
        }
    }

    void draw_char(int px, int py, char c,
                   std::uint8_t r, std::uint8_t g, std::uint8_t b, int scale = 1) {
        if (c < 32 || c > 127) c = '?';
        int idx = c - 32;
        for (int col = 0; col < 5; ++col) {
            std::uint8_t line = kFont5x7[idx][col];
            for (int row = 0; row < 7; ++row) {
                if ((line >> row) & 1) {
                    for (int sy = 0; sy < scale; ++sy) {
                        for (int sx = 0; sx < scale; ++sx) {
                            set_pixel(px + col * scale + sx, py + row * scale + sy, r, g, b);
                        }
                    }
                }
            }
        }
    }

    void draw_string(int px, int py, const char* str,
                     std::uint8_t r, std::uint8_t g, std::uint8_t b, int scale = 1) {
        if (!str) return;
        int curX = px;
        for (; *str; ++str) {
            if (*str == '\n') {
                py += 8 * scale;
                curX = px;
                continue;
            }
            draw_char(curX, py, *str, r, g, b, scale);
            curX += 6 * scale;
        }
    }
};

// ---------------------------------------------------------------------------
// Hand-written PNG Writer (CRC32, Stored Deflate, IHDR, IDAT, IEND)
// Matches src/render/screenshot.cpp
// ---------------------------------------------------------------------------
std::uint32_t crc32_of(const std::uint8_t* p, std::size_t n, std::uint32_t crc) {
    crc = ~crc;
    for (std::size_t i = 0; i < n; ++i) {
        crc ^= p[i];
        for (int k = 0; k < 8; ++k)
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

void be32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    out.push_back(static_cast<std::uint8_t>(v >> 24));
    out.push_back(static_cast<std::uint8_t>(v >> 16));
    out.push_back(static_cast<std::uint8_t>(v >> 8));
    out.push_back(static_cast<std::uint8_t>(v));
}

void chunk(std::vector<std::uint8_t>& out, const char tag[5],
           const std::vector<std::uint8_t>& body) {
    be32(out, static_cast<std::uint32_t>(body.size()));
    const std::size_t crcFrom = out.size();
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(tag[i]));
    out.insert(out.end(), body.begin(), body.end());
    const std::uint32_t crc =
        crc32_of(out.data() + crcFrom, out.size() - crcFrom, 0);
    be32(out, crc);
}

std::vector<std::uint8_t> zlib_stored(const std::vector<std::uint8_t>& raw) {
    std::vector<std::uint8_t> z;
    z.push_back(0x78);   // CMF
    z.push_back(0x01);   // FLG
    std::size_t off = 0;
    while (off < raw.size()) {
        const std::size_t n =
            raw.size() - off > 65535u ? 65535u : raw.size() - off;
        const bool last = (off + n) >= raw.size();
        z.push_back(last ? 1u : 0u);
        z.push_back(static_cast<std::uint8_t>(n & 0xFF));
        z.push_back(static_cast<std::uint8_t>(n >> 8));
        const std::uint16_t inv = static_cast<std::uint16_t>(~n);
        z.push_back(static_cast<std::uint8_t>(inv & 0xFF));
        z.push_back(static_cast<std::uint8_t>(inv >> 8));
        z.insert(z.end(), raw.begin() + static_cast<std::ptrdiff_t>(off),
                 raw.begin() + static_cast<std::ptrdiff_t>(off + n));
        off += n;
    }
    std::uint32_t a = 1, b = 0;
    for (std::uint8_t v : raw) {
        a = (a + v) % 65521u;
        b = (b + a) % 65521u;
    }
    be32(z, (b << 16) | a);
    return z;
}

bool write_png(const char* path, std::uint32_t w, std::uint32_t h,
               const std::vector<std::uint8_t>& rgb) {
    std::vector<std::uint8_t> raw;
    raw.reserve(static_cast<std::size_t>(h) * (1 + 3 * w));
    for (std::uint32_t y = 0; y < h; ++y) {
        raw.push_back(0); // None filter
        const std::size_t row = static_cast<std::size_t>(y) * w * 3;
        raw.insert(raw.end(), rgb.begin() + static_cast<std::ptrdiff_t>(row),
                   rgb.begin() + static_cast<std::ptrdiff_t>(row + w * 3));
    }

    std::vector<std::uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<std::uint8_t> ihdr;
    be32(ihdr, w);
    be32(ihdr, h);
    ihdr.push_back(8);   // bit depth
    ihdr.push_back(2);   // truecolour RGB
    ihdr.push_back(0);   // deflate
    ihdr.push_back(0);   // no filter
    ihdr.push_back(0);   // no interlace
    chunk(png, "IHDR", ihdr);
    chunk(png, "IDAT", zlib_stored(raw));
    chunk(png, "IEND", {});

    std::FILE* fh = std::fopen(path, "wb");
    if (!fh) return false;
    const std::size_t wrote = std::fwrite(png.data(), 1, png.size(), fh);
    std::fclose(fh);
    return wrote == png.size();
}

// ---------------------------------------------------------------------------
// Tool Options
// ---------------------------------------------------------------------------
struct ToolOptions {
    int floor = 0;
    int sliceZ = -1; // -1 = volumetric / auto
    bool xray = false;
    bool pop = false;
    std::string out = "xray_map.png";
    std::uint32_t width = 1024;
    std::uint32_t height = 1024;
    std::string mode = "struct";
    bool allModes = false;
};

// ---------------------------------------------------------------------------
// Engine World Context
// ---------------------------------------------------------------------------
struct WorldContext {
    LevelStack stack;
    FloorCatalog catalog;
    FloorRegistry registry;
    FloorStreamer streamer;
    NpcPool pool;
    MacroSim macroSim;
    Registry ecs;
    DoorSet doors;
    int loadedFloor = 0;
    LayerId loadedLayer = kInvalidLayer;
    Entity playerEntity = entt::null;
    NpcId playerId = kInvalidNpc;

    void init() {
        build_default_floor_catalog(catalog);
        struct DemoFloor { int number; FloorKind kind; };
        constexpr DemoFloor kDemoFloors[] = {
            {0, FloorKind::Residential},
            {1, FloorKind::Commercial},
            {2, FloorKind::Industrial},
            {-8, FloorKind::Derelict},
            {-14, FloorKind::Industrial},
            {-26, FloorKind::Derelict},
            {-36, FloorKind::Industrial},
            {-50, FloorKind::Derelict},
            {14, FloorKind::Commercial},
            {30, FloorKind::Residential},
        };
        for (const DemoFloor& f : kDemoFloors) {
            catalog.claim(f.number, {"demo", f.kind});
        }

        streamer.init(stack, /*keepRadius=*/0);

        for (int f = kMinFloor; f <= kMaxFloor; ++f) {
            const FloorDef* def = catalog.claimed(f);
            if (!def) continue;
            std::uint32_t fseed = floor_seed_like_main(f);
            streamer.add_module(registry, f, def->kind, fseed);
        }

        macroSim.init();
        macroSim.set_floors_from(registry);

        pool.init();
        pool.set_recycling(true);

        streamer.seed_all_modules(pool);
    }

    bool load_floor(int floorNum) {
        if (registry.module_at(floorNum) == kInvalidModule) {
            const FloorDef& def = catalog.resolve(floorNum);
            std::uint32_t fseed = floor_seed_like_main(floorNum);
            streamer.add_module(registry, floorNum, def.kind, fseed);
            macroSim.set_floors_from(registry);
        }

        playerId = kInvalidNpc;
        LoadResult res = streamer.ensure_loaded(stack, registry, ecs, pool, floorNum, playerId);
        if (res.layer == kInvalidLayer) return false;

        loadedFloor = floorNum;
        loadedLayer = res.layer;
        playerEntity = res.player;

        // Build doors and props
        const FloorSpec& spec = floor_spec(catalog.resolve(floorNum).kind);
        std::uint32_t fseed = streamer.floor_seed_of(registry, floorNum);
        doors = DoorSet{};
        door_build(stack.layer(loadedLayer), doors, floorNum, spec, fseed);

        EventBus dummyBus;
        dummyBus.init();
        seed_wall_interactables(ecs, stack.layer(loadedLayer), loadedLayer, fseed);
        seed_ceiling_lights(ecs, stack.layer(loadedLayer), loadedLayer, fseed);
        seed_room_furniture(ecs, stack.layer(loadedLayer), loadedLayer, spec.kind, floorNum);

        return true;
    }
};

// ---------------------------------------------------------------------------
// Header & Legend Overlay Helpers
// ---------------------------------------------------------------------------
void draw_hud_header(Image& img, int floorNum, const char* modeName,
                     FloorKind kind, std::uint32_t popCount) {
    // Dark translucent top bar
    img.fill_rect(0, 0, img.width, 34, 3, 7, 10, 0.85f);
    img.draw_line(0, 34, img.width - 1, 34, 44, 122, 158, 0.8f);

    char title[256];
    std::snprintf(title, sizeof(title),
                  "GIGAHRUSH 2 // X-RAY BLUEPRINT // FLOOR %+d [%s] // MODE: %s",
                  floorNum, floor_spec(kind).name, modeName);
    img.draw_string(14, 8, title, 92, 214, 255, 1);

    char subtitle[256];
    std::snprintf(subtitle, sizeof(subtitle),
                  "TORUS: 256m x 256m x 256m (128^3, wrap all axes) | POPULATION: %u",
                  popCount);
    img.draw_string(14, 20, subtitle, 176, 190, 197, 1);

    // Scale bar in bottom right
    int sbX = static_cast<int>(img.width) - 160;
    int sbY = static_cast<int>(img.height) - 24;
    img.fill_rect(sbX - 8, sbY - 8, 156, 22, 3, 7, 10, 0.85f);
    img.draw_rect(sbX - 8, sbY - 8, 156, 22, 44, 122, 158);
    img.draw_line(sbX, sbY + 6, sbX + 64, sbY + 6, 92, 214, 255);
    img.draw_line(sbX, sbY + 2, sbX, sbY + 10, 92, 214, 255);
    img.draw_line(sbX + 64, sbY + 2, sbX + 64, sbY + 10, 92, 214, 255);
    img.draw_string(sbX + 72, sbY + 2, "128m (64c)", 255, 255, 255, 1);
}

// ---------------------------------------------------------------------------
// Mode 1: Structural Blueprint (Sub-voxel / Density)
// ---------------------------------------------------------------------------
void render_mode_struct(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    const World& world = ctx.stack.layer(ctx.loadedLayer);
    const MacroGrid& grid = world.grid();

    // Map 512x512 macro cells into img.width x img.height
    for (std::uint32_t py = 0; py < img.height; ++py) {
        int cy = static_cast<int>((static_cast<std::uint64_t>(py) * kMacroDim) / img.height);
        for (std::uint32_t px = 0; px < img.width; ++px) {
            int cx = static_cast<int>((static_cast<std::uint64_t>(px) * kMacroDim) / img.width);

            if (opt.sliceZ >= 0 && opt.sliceZ < kMacroDim) {
                // Exact 2D Z-slice
                const SubMask& sm = grid.mask(cx, cy, opt.sliceZ);
                if (sm.empty()) {
                    // Corridors / Walkable floor
                    img.set_pixel(px, py, 14, 35, 51); // #0E2333
                } else if (sm.full()) {
                    // Solid concrete wall
                    img.set_pixel(px, py, 44, 122, 158); // #2C7A9E
                } else {
                    // Partial / thin partition / stairs
                    int solidBits = 0;
                    for (int b = 0; b < kSubVoxels; ++b) if (sm.test(b)) ++solidBits;
                    if (solidBits > 256) img.set_pixel(px, py, 92, 214, 255); // #5CD6FF
                    else if (solidBits > 64) img.set_pixel(px, py, 58, 150, 189); // #3A96BD
                    else img.set_pixel(px, py, 142, 36, 170); // #8E24AA (Stairs)
                }
            } else {
                // Top-down Volumetric X-Ray composite
                int solidCount = 0;
                for (int z = 0; z < kMacroDim; ++z) {
                    const SubMask& sm = grid.mask(cx, cy, z);
                    for (int w = 0; w < static_cast<int>(kSubMaskWords); ++w) {
                        std::uint64_t word = sm.words[w];
                        while (word) {
                            solidCount += (word & 1u);
                            word >>= 1;
                        }
                    }
                }

                if (solidCount == 0) {
                    // Open shaft / void
                    img.set_pixel(px, py, 3, 7, 10);
                } else if (solidCount < 1024) {
                    // Open corridor with floor slab
                    float t = static_cast<float>(solidCount) / 1024.0f;
                    std::uint8_t r = static_cast<std::uint8_t>(14 + t * 20);
                    std::uint8_t g = static_cast<std::uint8_t>(35 + t * 40);
                    std::uint8_t b = static_cast<std::uint8_t>(51 + t * 60);
                    img.set_pixel(px, py, r, g, b);
                } else {
                    // Dense structural wall
                    float t = std::clamp((solidCount - 1024.0f) / 4096.0f, 0.0f, 1.0f);
                    std::uint8_t r = static_cast<std::uint8_t>(44 + t * (92 - 44));
                    std::uint8_t g = static_cast<std::uint8_t>(122 + t * (214 - 122));
                    std::uint8_t b = static_cast<std::uint8_t>(158 + t * (255 - 158));
                    img.set_pixel(px, py, r, g, b);
                }
            }
        }
    }

    // Overlay 16 Elevator Lattice Hubs (4x4)
    for (int iy = 0; iy < kLatticeDim; ++iy) {
        for (int ix = 0; ix < kLatticeDim; ++ix) {
            int hx = lattice_coord(ix);
            int hy = lattice_coord(iy);

            int px = static_cast<int>((static_cast<std::int64_t>(hx) * img.width) / kMacroDim);
            int py = static_cast<int>((static_cast<std::int64_t>(hy) * img.height) / kMacroDim);
            int rLobby = static_cast<int>((static_cast<std::int64_t>(kFastLobbyR) * img.width) / kMacroDim);
            int rShaft = static_cast<int>((static_cast<std::int64_t>(kFastShaftR) * img.width) / kMacroDim);
            if (rShaft < 2) rShaft = 2;
            if (rLobby < 4) rLobby = 4;

            // 7x7 Lobby area
            img.fill_rect(px - rLobby, py - rLobby, 2 * rLobby + 1, 2 * rLobby + 1, 255, 179, 0, 0.25f);
            img.draw_rect(px - rLobby, py - rLobby, 2 * rLobby + 1, 2 * rLobby + 1, 255, 224, 130);

            // 3x3 Elevator Shaft (Amber #FFB300)
            img.fill_rect(px - rShaft, py - rShaft, 2 * rShaft + 1, 2 * rShaft + 1, 255, 179, 0, 0.85f);
            img.draw_rect(px - rShaft, py - rShaft, 2 * rShaft + 1, 2 * rShaft + 1, 255, 255, 255);

            // 1x1 Fast-Travel Pad (Emerald green #00E676)
            img.fill_circle(px, py, 2, 0, 230, 118, 1.0f);
        }
    }

    // Overlay Doors (Yellow #FFFF00)
    for (const Door& d : ctx.doors.doors) {
        int px = static_cast<int>((static_cast<std::int64_t>(d.cx) * img.width) / kMacroDim);
        int py = static_cast<int>((static_cast<std::int64_t>(d.cy) * img.height) / kMacroDim);
        int len = static_cast<int>((2 * img.width) / kMacroDim);
        if (len < 2) len = 2;
        if (d.axis == 0) {
            img.draw_line(px, py - len, px, py + len, 255, 255, 0, 1.0f);
        } else {
            img.draw_line(px - len, py, px + len, py, 255, 255, 0, 1.0f);
        }
    }

    // Overlay NPCs if requested
    if (opt.pop) {
        const auto& crowd = ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor));
        for (NpcId id : crowd) {
            if (!ctx.pool.valid(id) || !ctx.pool.alive(id)) continue;
            int cx = ctx.pool.cx(id);
            int cy = ctx.pool.cy(id);
            int px = static_cast<int>((static_cast<std::int64_t>(cx) * img.width) / kMacroDim);
            int py = static_cast<int>((static_cast<std::int64_t>(cy) * img.height) / kMacroDim);

            // Magenta for wanderers, cyan for settled residents
            std::uint8_t roleId = ctx.pool.role(id);
            if (roleId == static_cast<std::uint8_t>(RoleId::Resident)) {
                img.fill_circle(px, py, 3, 0, 229, 255, 0.9f); // #00E5FF
            } else {
                img.fill_circle(px, py, 3, 255, 23, 68, 0.9f); // #FF1744
            }
        }
    }

    draw_hud_header(img, ctx.loadedFloor, "STRUCTURAL BLUEPRINT",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor)).size()));
}

// ---------------------------------------------------------------------------
// Mode 2: Semantic Room Zoning
// ---------------------------------------------------------------------------
void render_mode_zones(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    const World& world = ctx.stack.layer(ctx.loadedLayer);
    const MacroGrid& grid = world.grid();
    FloorKind kind = ctx.catalog.resolve(ctx.loadedFloor).kind;

    for (std::uint32_t py = 0; py < img.height; ++py) {
        int cy = static_cast<int>((static_cast<std::uint64_t>(py) * kMacroDim) / img.height);
        for (std::uint32_t px = 0; px < img.width; ++px) {
            int cx = static_cast<int>((static_cast<std::uint64_t>(px) * kMacroDim) / img.width);

            // Check if cell is solid structural wall
            const SubMask& sm = grid.mask(cx, cy, 2);
            if (sm.full()) {
                img.set_pixel(px, py, 10, 16, 20); // Dark structural boundary
                continue;
            }

            std::uint16_t rbit = room_bit_at(kind, ctx.loadedFloor, cx, cy);
            if (rbit == 0 || rbit == room_bit(RoomBit::Corridor)) {
                // Corridor
                img.set_pixel(px, py, 21, 101, 192); // Deep Blue #1565C0
            } else if (rbit == room_bit(RoomBit::Living)) {
                img.set_pixel(px, py, 141, 110, 99); // Warm Slate/Brown #8D6E63
            } else if (rbit == room_bit(RoomBit::Kitchen)) {
                img.set_pixel(px, py, 239, 108, 0); // Orange #EF6C00
            } else if (rbit == room_bit(RoomBit::Bathroom)) {
                img.set_pixel(px, py, 0, 137, 123); // Teal #00897B
            } else if (rbit == room_bit(RoomBit::Common)) {
                img.set_pixel(px, py, 255, 160, 0); // Amber Gold #FFA000
            } else if (rbit == room_bit(RoomBit::Office)) {
                img.set_pixel(px, py, 57, 73, 171); // Indigo #3949AB
            } else if (rbit == room_bit(RoomBit::Medical)) {
                img.set_pixel(px, py, 0, 229, 255); // Cyan #00E5FF
            } else if (rbit == room_bit(RoomBit::Production)) {
                img.set_pixel(px, py, 216, 67, 21); // Rust #D84315
            } else if (rbit == room_bit(RoomBit::Storage)) {
                img.set_pixel(px, py, 69, 90, 100); // Steel #455A64
            } else if (rbit == room_bit(RoomBit::Smoking)) {
                img.set_pixel(px, py, 123, 31, 162); // Purple #7B1FA2
            } else if (rbit == room_bit(RoomBit::Hq)) {
                img.set_pixel(px, py, 194, 24, 91); // Crimson #C2185B
            } else {
                img.set_pixel(px, py, 14, 35, 51);
            }
        }
    }

    // Elevator Hubs
    for (int iy = 0; iy < kLatticeDim; ++iy) {
        for (int ix = 0; ix < kLatticeDim; ++ix) {
            int hx = lattice_coord(ix);
            int hy = lattice_coord(iy);
            int px = static_cast<int>((static_cast<std::int64_t>(hx) * img.width) / kMacroDim);
            int py = static_cast<int>((static_cast<std::int64_t>(hy) * img.height) / kMacroDim);
            int rLobby = static_cast<int>((static_cast<std::int64_t>(kFastLobbyR) * img.width) / kMacroDim);
            if (rLobby < 4) rLobby = 4;
            img.fill_rect(px - rLobby, py - rLobby, 2 * rLobby + 1, 2 * rLobby + 1, 255, 179, 0, 0.9f);
            img.fill_circle(px, py, 3, 0, 230, 118, 1.0f);
        }
    }

    // Zoning Legend Box (Bottom Left)
    int legX = 14, legY = static_cast<int>(img.height) - 110;
    img.fill_rect(legX, legY, 320, 100, 3, 7, 10, 0.85f);
    img.draw_rect(legX, legY, 320, 100, 44, 122, 158);
    img.draw_string(legX + 8, legY + 6, "ZONING TAXONOMY:", 92, 214, 255, 1);

    auto draw_key = [&](int kx, int ky, const char* name, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        img.fill_rect(kx, ky, 10, 10, r, g, b);
        img.draw_rect(kx, ky, 10, 10, 255, 255, 255);
        img.draw_string(kx + 14, ky + 1, name, 220, 220, 220, 1);
    };

    draw_key(legX + 8, legY + 20, "Corridor", 21, 101, 192);
    draw_key(legX + 85, legY + 20, "Living", 141, 110, 99);
    draw_key(legX + 160, legY + 20, "Kitchen", 239, 108, 0);
    draw_key(legX + 240, legY + 20, "Bathroom", 0, 137, 123);

    draw_key(legX + 8, legY + 36, "Common", 255, 160, 0);
    draw_key(legX + 85, legY + 36, "Office", 57, 73, 171);
    draw_key(legX + 160, legY + 36, "Medical", 0, 229, 255);
    draw_key(legX + 240, legY + 36, "Production", 216, 67, 21);

    draw_key(legX + 8, legY + 52, "Storage", 69, 90, 100);
    draw_key(legX + 85, legY + 52, "Smoking", 123, 31, 162);
    draw_key(legX + 160, legY + 52, "HQ", 194, 24, 91);
    draw_key(legX + 240, legY + 52, "Elevator", 255, 179, 0);

    draw_hud_header(img, ctx.loadedFloor, "SEMANTIC ROOM ZONING",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor)).size()));
}

// ---------------------------------------------------------------------------
// Mode 3: Demographics & Heatmap
// ---------------------------------------------------------------------------
void render_mode_pop(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    // 1. Structural base
    render_mode_struct(img, ctx, opt);

    // 2. Compute 2D Population Density Grid
    std::vector<float> density(static_cast<std::size_t>(kMacroDim) * kMacroDim, 0.0f);
    const auto& crowd = ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor));

    constexpr int kRadius = 12;
    for (NpcId id : crowd) {
        if (!ctx.pool.valid(id) || !ctx.pool.alive(id)) continue;
        int ncx = ctx.pool.cx(id);
        int ncy = ctx.pool.cy(id);

        for (int dy = -kRadius; dy <= kRadius; ++dy) {
            int cy = wrapi(ncy + dy, kMacroDim);
            for (int dx = -kRadius; dx <= kRadius; ++dx) {
                int cx = wrapi(ncx + dx, kMacroDim);
                float dist2 = static_cast<float>(dx * dx + dy * dy);
                if (dist2 <= kRadius * kRadius) {
                    float w = std::exp(-dist2 / (2.0f * 4.0f * 4.0f));
                    density[static_cast<std::size_t>(cy) * kMacroDim + cx] += w;
                }
            }
        }
    }

    // Normalize density
    float maxD = 0.001f;
    for (float d : density) if (d > maxD) maxD = d;

    // Blend Heatmap over blueprint
    for (std::uint32_t py = 0; py < img.height; ++py) {
        int cy = static_cast<int>((static_cast<std::uint64_t>(py) * kMacroDim) / img.height);
        for (std::uint32_t px = 0; px < img.width; ++px) {
            int cx = static_cast<int>((static_cast<std::uint64_t>(px) * kMacroDim) / img.width);
            float norm = density[static_cast<std::size_t>(cy) * kMacroDim + cx] / maxD;
            if (norm > 0.05f) {
                // Color ramp: Purple -> Teal -> Yellow -> Red -> White
                std::uint8_t hr = 0, hg = 0, hb = 0;
                if (norm < 0.25f) {
                    float t = norm / 0.25f;
                    hr = static_cast<std::uint8_t>(49 * t);
                    hg = static_cast<std::uint8_t>(27 * t);
                    hb = static_cast<std::uint8_t>(146 * t);
                } else if (norm < 0.5f) {
                    float t = (norm - 0.25f) / 0.25f;
                    hr = static_cast<std::uint8_t>(49 + (0 - 49) * t);
                    hg = static_cast<std::uint8_t>(27 + (191 - 27) * t);
                    hb = static_cast<std::uint8_t>(146 + (165 - 146) * t);
                } else if (norm < 0.75f) {
                    float t = (norm - 0.5f) / 0.25f;
                    hr = static_cast<std::uint8_t>(0 + (255 - 0) * t);
                    hg = static_cast<std::uint8_t>(191 + (214 - 191) * t);
                    hb = static_cast<std::uint8_t>(165 + (0 - 165) * t);
                } else {
                    float t = (norm - 0.75f) / 0.25f;
                    hr = static_cast<std::uint8_t>(255);
                    hg = static_cast<std::uint8_t>(214 * (1.0f - t));
                    hb = static_cast<std::uint8_t>(0 + 255 * t);
                }
                img.blend_pixel(px, py, hr, hg, hb, norm * 0.7f);
            }
        }
    }

    // 3. Discrete NPC markers colored by Role / Intent
    for (NpcId id : crowd) {
        if (!ctx.pool.valid(id) || !ctx.pool.alive(id)) continue;
        int ncx = ctx.pool.cx(id);
        int ncy = ctx.pool.cy(id);
        int px = static_cast<int>((static_cast<std::int64_t>(ncx) * img.width) / kMacroDim);
        int py = static_cast<int>((static_cast<std::int64_t>(ncy) * img.height) / kMacroDim);

        std::uint8_t rId = ctx.pool.role(id);
        std::uint8_t nr = 0, ng = 229, nb = 255;
        if (rId == static_cast<std::uint8_t>(RoleId::Duty)) {
            nr = 255; ng = 234; nb = 0; // Patrol Yellow #FFEA00
        } else if (rId == static_cast<std::uint8_t>(RoleId::Medic)) {
            nr = 0; ng = 229; nb = 255; // Medic Cyan #00E5FF
        } else if (rId == static_cast<std::uint8_t>(RoleId::Looter)) {
            nr = 255; ng = 145; nb = 0; // Looter Orange #FF9100
        } else if (rId == static_cast<std::uint8_t>(RoleId::Cultist)) {
            nr = 213; ng = 0; nb = 249; // Cultist Violet #D500F9
        } else {
            nr = 74; ng = 190; nb = 145; // Citizen Green-Teal #4ABE91
        }

        img.fill_circle(px, py, 4, nr, ng, nb, 1.0f);
        img.draw_circle(px, py, 4, 255, 255, 255, 0.8f);
    }

    // 4. Demographic stats box
    int legX = 14, legY = static_cast<int>(img.height) - 90;
    img.fill_rect(legX, legY, 320, 80, 3, 7, 10, 0.85f);
    img.draw_rect(legX, legY, 320, 80, 44, 122, 158);
    img.draw_string(legX + 8, legY + 6, "DEMOGRAPHIC ROLES (AI INTENTS):", 92, 214, 255, 1);

    auto draw_dot = [&](int kx, int ky, const char* name, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        img.fill_circle(kx + 4, ky + 4, 3, r, g, b);
        img.draw_string(kx + 12, ky + 1, name, 220, 220, 220, 1);
    };

    draw_dot(legX + 8, legY + 22, "Resident (Wander/Rest)", 74, 190, 145);
    draw_dot(legX + 160, legY + 22, "Duty (Patrol)", 255, 234, 0);
    draw_dot(legX + 8, legY + 38, "Medic (Care)", 0, 229, 255);
    draw_dot(legX + 160, legY + 38, "Looter (Scavenge)", 255, 145, 0);
    draw_dot(legX + 8, legY + 54, "Cultist (Social)", 213, 0, 249);

    draw_hud_header(img, ctx.loadedFloor, "DEMOGRAPHICS & POPULATION HEATMAP",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(crowd.size()));
}

// ---------------------------------------------------------------------------
// Mode 4: Navigation Distance Field & Flow Vectors
// ---------------------------------------------------------------------------
void render_mode_nav(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    const World& world = ctx.stack.layer(ctx.loadedLayer);
    const MacroGrid& grid = world.grid();

    // Compute 2D Geodesic Distance Field from the 16 Elevator Lattice Hubs
    std::vector<std::uint16_t> distField(static_cast<std::size_t>(kMacroDim) * kMacroDim, 0xFFFFu);
    std::vector<int> qx, qy;
    qx.reserve(kMacroDim * kMacroDim);
    qy.reserve(kMacroDim * kMacroDim);

    // Seed with 16 lattice hub centers
    for (int iy = 0; iy < kLatticeDim; ++iy) {
        for (int ix = 0; ix < kLatticeDim; ++ix) {
            int hx = lattice_coord(ix);
            int hy = lattice_coord(iy);
            std::size_t idx = static_cast<std::size_t>(hy) * kMacroDim + hx;
            distField[idx] = 0;
            qx.push_back(hx);
            qy.push_back(hy);
        }
    }

    // 2D BFS over open cells
    std::size_t head = 0;
    constexpr int kDirs[4][2] = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
    while (head < qx.size()) {
        int cx = qx[head];
        int cy = qy[head];
        std::uint16_t curD = distField[static_cast<std::size_t>(cy) * kMacroDim + cx];
        ++head;

        for (int d = 0; d < 4; ++d) {
            int nx = wrapi(cx + kDirs[d][0], kMacroDim);
            int ny = wrapi(cy + kDirs[d][1], kMacroDim);
            std::size_t nidx = static_cast<std::size_t>(ny) * kMacroDim + nx;
            if (distField[nidx] == 0xFFFFu) {
                // Check if walkable in macro grid
                if (!grid.mask(nx, ny, 2).full()) {
                    distField[nidx] = curD + 1;
                    qx.push_back(nx);
                    qy.push_back(ny);
                }
            }
        }
    }

    // Render distance field
    for (std::uint32_t py = 0; py < img.height; ++py) {
        int cy = static_cast<int>((static_cast<std::uint64_t>(py) * kMacroDim) / img.height);
        for (std::uint32_t px = 0; px < img.width; ++px) {
            int cx = static_cast<int>((static_cast<std::uint64_t>(px) * kMacroDim) / img.width);
            std::uint16_t d = distField[static_cast<std::size_t>(cy) * kMacroDim + cx];

            if (d == 0xFFFFu) {
                img.set_pixel(px, py, 3, 7, 10);
            } else {
                float norm = std::clamp(static_cast<float>(d) / 96.0f, 0.0f, 1.0f);
                std::uint8_t r = 0, g = 0, b = 0;
                if (norm < 0.2f) {
                    r = 0; g = 229; b = 255; // Bright Cyan
                } else if (norm < 0.4f) {
                    r = 0; g = 230; b = 118; // Emerald Green
                } else if (norm < 0.6f) {
                    r = 255; g = 234; b = 0; // Yellow
                } else if (norm < 0.8f) {
                    r = 255; g = 145; b = 0; // Orange
                } else {
                    r = 255; g = 23; b = 68;  // Red
                }
                img.set_pixel(px, py, r, g, b);
            }
        }
    }

    // Draw flow direction arrows every 32 pixels
    constexpr int kStep = 32;
    for (std::uint32_t py = kStep / 2; py < img.height; py += kStep) {
        int cy = static_cast<int>((static_cast<std::uint64_t>(py) * kMacroDim) / img.height);
        for (std::uint32_t px = kStep / 2; px < img.width; px += kStep) {
            int cx = static_cast<int>((static_cast<std::uint64_t>(px) * kMacroDim) / img.width);
            std::uint16_t curD = distField[static_cast<std::size_t>(cy) * kMacroDim + cx];
            if (curD == 0xFFFFu || curD == 0) continue;

            int bestNx = cx, bestNy = cy;
            std::uint16_t minD = curD;
            for (int d = 0; d < 4; ++d) {
                int nx = wrapi(cx + kDirs[d][0], kMacroDim);
                int ny = wrapi(cy + kDirs[d][1], kMacroDim);
                std::uint16_t nd = distField[static_cast<std::size_t>(ny) * kMacroDim + nx];
                if (nd < minD) { minD = nd; bestNx = nx; bestNy = ny; }
            }

            int dx = wrap_delta(cx, bestNx, kMacroDim);
            int dy = wrap_delta(cy, bestNy, kMacroDim);
            int len = 8;
            img.draw_line(px, py, px + dx * len, py + dy * len, 255, 255, 255, 0.9f);
        }
    }

    // Overlay 16 Elevator Lattice Hubs
    for (int iy = 0; iy < kLatticeDim; ++iy) {
        for (int ix = 0; ix < kLatticeDim; ++ix) {
            int hx = lattice_coord(ix);
            int hy = lattice_coord(iy);
            int px = static_cast<int>((static_cast<std::int64_t>(hx) * img.width) / kMacroDim);
            int py = static_cast<int>((static_cast<std::int64_t>(hy) * img.height) / kMacroDim);
            img.fill_circle(px, py, 6, 255, 179, 0, 1.0f);
            img.draw_circle(px, py, 10, 255, 255, 255, 0.8f);
        }
    }

    draw_hud_header(img, ctx.loadedFloor, "NAVIGATION DISTANCE FIELD & FLOW",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor)).size()));
}

// ---------------------------------------------------------------------------
// Mode 5: Danger, Radiation & Perimeter Hazards
// ---------------------------------------------------------------------------
void render_mode_danger(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    // 1. Base structure
    render_mode_struct(img, ctx, opt);

    // 2. Depth Samosbor threat
    float duty = samosbor_duty01(ctx.loadedFloor);
    for (std::uint32_t py = 0; py < img.height; ++py) {
        for (std::uint32_t px = 0; px < img.width; ++px) {
            // Ambient Samosbor purple haze
            img.blend_pixel(px, py, 74, 20, 140, duty * 0.4f);
        }
    }

    // Тор: периметра НЕТ — мир замкнут по всем осям, «радиационное кольцо
    // на краю карты» форка вместе с центром (256,256) удалено как идеология
    // мира-блинчика. Опасность здесь — самосбор и газ, не край света.
    // Hazard legend
    int legX = 14, legY = static_cast<int>(img.height) - 100;
    img.fill_rect(legX, legY, 340, 90, 3, 7, 10, 0.85f);
    img.draw_rect(legX, legY, 340, 90, 255, 23, 68);
    img.draw_string(legX + 8, legY + 6, "HAZARD & RADIATION PROFILE:", 255, 23, 68, 1);

    char samBuf[128];
    std::snprintf(samBuf, sizeof(samBuf),
                  "Samosbor Duty Cycle: %.1f%% (floor %+d)",
                  duty * 100.0f, ctx.loadedFloor);
    img.draw_string(legX + 8, legY + 24, samBuf, 213, 0, 249, 1);

    img.draw_string(legX + 8, legY + 40, "Gas Field: toxic shaft seed (kGasField)", 255, 234, 0, 1);
    img.draw_string(legX + 8, legY + 56, "Torus: no perimeter, no edge radiation", 92, 214, 255, 1);

    draw_hud_header(img, ctx.loadedFloor, "DANGER & HAZARD MAP",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor)).size()));
}

// ---------------------------------------------------------------------------
// Mode 6: Props & Engineering Facilities
// ---------------------------------------------------------------------------
void render_mode_props(Image& img, WorldContext& ctx, const ToolOptions& opt) {
    // 1. Structural base
    render_mode_struct(img, ctx, opt);

    // 2. Iterate ECS props and interactables
    for (auto e : ctx.ecs.view<const Transform, const Interactable>()) {
        const Transform& tr = ctx.ecs.get<const Transform>(e);
        if (tr.layer != ctx.loadedLayer) continue;
        const Interactable& ia = ctx.ecs.get<const Interactable>(e);

        int px = static_cast<int>((tr.pos.x / kWorldExtent) * img.width);
        int py = static_cast<int>((tr.pos.y / kWorldExtent) * img.height);

        switch (ia.kind) {
            case InteractKind::LightBulb:
                // Yellow Lamp glow
                img.fill_circle(px, py, 6, 255, 245, 157, 0.4f);
                img.fill_circle(px, py, 2, 255, 255, 0, 1.0f);
                break;
            case InteractKind::Terminal:
                // CRT Green Terminal
                img.fill_rect(px - 3, py - 3, 7, 7, 0, 230, 118, 0.9f);
                img.draw_rect(px - 3, py - 3, 7, 7, 255, 255, 255);
                break;
            case InteractKind::ElectricalShield:
                // Orange Shield
                img.fill_rect(px - 3, py - 3, 7, 7, 255, 109, 0, 0.9f);
                break;
            case InteractKind::Loot:
            case InteractKind::Corpse:
                // Loot Crate
                img.fill_rect(px - 2, py - 2, 5, 5, 255, 152, 0, 0.9f);
                break;
            default: break;
        }
    }

    // Props legend
    int legX = 14, legY = static_cast<int>(img.height) - 90;
    img.fill_rect(legX, legY, 320, 80, 3, 7, 10, 0.85f);
    img.draw_rect(legX, legY, 320, 80, 44, 122, 158);
    img.draw_string(legX + 8, legY + 6, "ENGINEERING FACILITIES & PROPS:", 92, 214, 255, 1);

    auto draw_prop_key = [&](int kx, int ky, const char* name, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        img.fill_rect(kx, ky, 8, 8, r, g, b);
        img.draw_string(kx + 12, ky + 1, name, 220, 220, 220, 1);
    };

    draw_prop_key(legX + 8, legY + 22, "Terminal (Locks)", 0, 230, 118);
    draw_prop_key(legX + 160, legY + 22, "Power Shield", 255, 109, 0);
    draw_prop_key(legX + 8, legY + 38, "Light Fixture", 255, 255, 0);
    draw_prop_key(legX + 160, legY + 38, "Loot / Corpse", 255, 152, 0);

    draw_hud_header(img, ctx.loadedFloor, "ENGINEERING & PROPS MAP",
                    ctx.catalog.resolve(ctx.loadedFloor).kind,
                    static_cast<std::uint32_t>(ctx.pool.floor_bucket(static_cast<std::int16_t>(ctx.loadedFloor)).size()));
}

} // namespace

// ---------------------------------------------------------------------------
// Main Tool Entry Point
// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    ToolOptions opt;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--floor" && i + 1 < argc) {
            opt.floor = std::atoi(argv[++i]);
        } else if (a == "--slice-z" && i + 1 < argc) {
            opt.sliceZ = std::atoi(argv[++i]);
        } else if (a == "--xray") {
            opt.xray = true;
        } else if (a == "--pop") {
            opt.pop = true;
        } else if (a == "--out" && i + 1 < argc) {
            opt.out = argv[++i];
        } else if (a == "--width" && i + 1 < argc) {
            opt.width = static_cast<std::uint32_t>(std::atoi(argv[++i]));
        } else if (a == "--height" && i + 1 < argc) {
            opt.height = static_cast<std::uint32_t>(std::atoi(argv[++i]));
        } else if (a == "--mode" && i + 1 < argc) {
            opt.mode = argv[++i];
        } else if (a == "--all-modes") {
            opt.allModes = true;
        }
    }

    std::fprintf(stderr, "=== GigaHrush 2 X-Ray Map Tool ===\n");
    std::fprintf(stderr, "Target floor: %+d, Mode: %s, Resolution: %ux%u\n",
                 opt.floor, opt.allModes ? "ALL (7 modes)" : opt.mode.c_str(),
                 opt.width, opt.height);

    WorldContext ctx;
    ctx.init();

    if (!ctx.load_floor(opt.floor)) {
        std::fprintf(stderr, "error: failed to generate/load floor %d\n", opt.floor);
        return 1;
    }

    auto render_and_save = [&](const std::string& mode, const std::string& outPath) {
        Image img;
        img.init(opt.width, opt.height);

        if (mode == "struct") render_mode_struct(img, ctx, opt);
        else if (mode == "zones") render_mode_zones(img, ctx, opt);
        else if (mode == "pop") render_mode_pop(img, ctx, opt);
        else if (mode == "nav") render_mode_nav(img, ctx, opt);
        else if (mode == "danger") render_mode_danger(img, ctx, opt);
        else if (mode == "props") render_mode_props(img, ctx, opt);
        else render_mode_struct(img, ctx, opt);

        if (write_png(outPath.c_str(), img.width, img.height, img.rgb)) {
            std::fprintf(stderr, "[xray_map] Wrote map (%s) -> %s (%ux%u)\n",
                         mode.c_str(), outPath.c_str(), img.width, img.height);
        } else {
            std::fprintf(stderr, "error: failed to write PNG to %s\n", outPath.c_str());
        }
    };

    if (opt.allModes) {
        // Strip extension if present
        std::string base = opt.out;
        if (base.size() > 4 && base.substr(base.size() - 4) == ".png") {
            base = base.substr(0, base.size() - 4);
        }
        render_and_save("struct", base + "_struct.png");
        render_and_save("zones",  base + "_zones.png");
        render_and_save("pop",    base + "_pop.png");
        render_and_save("nav",    base + "_nav.png");
        render_and_save("danger", base + "_danger.png");
        render_and_save("props",  base + "_props.png");
    } else {
        render_and_save(opt.mode, opt.out);
    }

    return 0;
}

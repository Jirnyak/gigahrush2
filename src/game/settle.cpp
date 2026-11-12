#include "game/settle.h"

#include <algorithm>

#include "core/rng.h"
#include "ecs/components.h" // Transform
#include "game/embody.h"    // embody, body_half_height, kBodyHalfWidth
#include "sim/physics.h" // stand_probe / stand_centre — один предикат стояния
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/types.h" // wrap_macro, macro_index, kMacroCells
#include "world/world.h"

namespace giga::game {

bool stand_point_in_cell(const World& world, vec3 half, int cx, int cy, int cz,
                         vec3& centreOut) {
    const int wx = wrap_macro(cx), wy = wrap_macro(cy), wz = wrap_macro(cz);
    const vec3 c{(static_cast<float>(wx) + 0.5f) * kCellSize,
                 (static_cast<float>(wy) + 0.5f) * kCellSize,
                 (static_cast<float>(wz) + 0.5f) * kCellSize};
    const MacroGrid& g = world.grid();
    const CellStep d = regime_down(world.gravity().regime);
    if (d.x == 0 && d.y == 0 && d.z == 0) {
        // Низа нет: стоять можно в любом свободном объёме, опора не нужна.
        if (aabb_overlaps_solid(world, c, half)) return false;
        centreOut = c;
        return true;
    }
    // ДЕШЁВЫЙ ОТСЕВ, и он ТОЧНЫЙ, а не эвристика: плита подошвы шириной в
    // тело лежит целиком в плане своей клетки, значит опорой может быть
    // только материя самой клетки или клетки под ней. Обе пусты — стоять не
    // на чем; своя забита целиком — стоять негде. Девять клеток из десяти на
    // открытой геометрии отсеиваются здесь двумя чтениями масок.
    const SubMask& own = g.mask(wx, wy, wz);
    if (own.full()) return false;
    if (own.empty() && g.mask(wx + d.x, wy + d.y, wz + d.z).empty())
        return false;

    const vec3 up{static_cast<float>(-d.x), static_cast<float>(-d.y),
                  static_cast<float>(-d.z)};
    const vec3 bottom = c + up * (-kCellSize * 0.5f); // низ клетки по фрейму
    for (int k = 0; k < kSubDim; ++k) {
        const vec3 foot = bottom + up * (static_cast<float>(k) * kVoxelSize);
        const vec3 centre = stand_centre(world, foot, half);
        const StandProbe p = stand_probe(world, centre, half);
        if (p.fits && p.supported) {
            centreOut = centre;
            return true;
        }
    }
    return false;
}

void settle_begin(Settlement& s, const World& world, const FloorRooms& rooms) {
    s = Settlement{};
    s.world = &world;
    s.rooms = &rooms;
    s.boxEnd.reserve(rooms.boxes.size());
    std::uint32_t acc = 0;
    for (const RoomBox& b : rooms.boxes) {
        acc += static_cast<std::uint32_t>(b.sx) * b.sy * b.sz;
        s.boxEnd.push_back(acc);
    }
    s.total = acc;
    s.taken.assign(kMacroCells / 64, 0);
}

namespace {

// Шаг обхода тора в режиме «просто где-то». Нечётный, значит по модулю
// степени двойки (kMacroCells = 2^21) это полный цикл — каждая клетка
// посещается ровно раз; золотое сечение разбрасывает соседние пробы по всему
// объёму вместо того, чтобы идти строкой вдоль X.
constexpr std::uint32_t kScatterStride = 0x9E3779B1u;
static_assert((kMacroCells & (kMacroCells - 1)) == 0,
              "полный цикл нечётного шага держится на степени двойки");
static_assert(kMacroCells % 64 == 0, "битсет занятости — целые слова");

// Клетка места номер `k` в пространстве зон.
void zone_cell(const Settlement& s, std::uint32_t k, int& cx, int& cy, int& cz) {
    const std::size_t b = static_cast<std::size_t>(
        std::upper_bound(s.boxEnd.begin(), s.boxEnd.end(), k) -
        s.boxEnd.begin());
    const RoomBox& box = s.rooms->boxes[b];
    const std::uint32_t local = k - (b == 0 ? 0u : s.boxEnd[b - 1]);
    const std::uint32_t dx = local % box.sx;
    const std::uint32_t dy = (local / box.sx) % box.sy;
    const std::uint32_t dz = local / (static_cast<std::uint32_t>(box.sx) * box.sy);
    cx = wrap_macro(box.x + static_cast<int>(dx));
    cy = wrap_macro(box.y + static_cast<int>(dy));
    cz = wrap_macro(box.z + static_cast<int>(dz));
}

} // namespace

bool settle_spot(Settlement& s, std::uint32_t key, vec3 half, vec3& centreOut) {
    const bool anywhere = s.total == 0;
    const std::uint32_t space =
        anywhere ? static_cast<std::uint32_t>(kMacroCells) : s.total;
    const std::uint32_t start = hash_u32(key) % space;
    const std::uint32_t limit = std::min(kSettleProbeCells, space);
    for (std::uint32_t i = 0; i < limit; ++i) {
        int cx = 0, cy = 0, cz = 0;
        if (anywhere) {
            const std::uint32_t ci = (start + i * kScatterStride) % space;
            cx = static_cast<int>(ci % kMacroDim);
            cy = static_cast<int>((ci / kMacroDim) % kMacroDim);
            cz = static_cast<int>(ci / (kMacroDim * kMacroDim));
        } else {
            zone_cell(s, (start + i) % space, cx, cy, cz);
        }
        ++s.probes;
        const std::size_t ci = macro_index(cx, cy, cz);
        std::uint64_t& word = s.taken[ci >> 6];
        const std::uint64_t bit = 1ull << (ci & 63);
        if (word & bit) continue;
        if (!stand_point_in_cell(*s.world, half, cx, cy, cz, centreOut))
            continue;
        word |= bit;
        ++s.settled;
        return true;
    }
    ++s.homeless;
    return false;
}

Entity embody_settled(Registry& reg, NpcPool& pool, NpcId id, LayerId layer,
                      Settlement& s, std::uint32_t floorSeed, bool asPlayer) {
    if (!pool.valid(id)) return entt::null;
    // Габарит — тот же, что поставит `embody` ([embody.cpp]): рост записи.
    const vec3 half{kBodyHalfWidth, kBodyHalfWidth,
                    body_half_height(pool.height_mm(id))};
    const std::uint32_t key =
        static_cast<std::uint32_t>(id) * 0x9E3779B9u ^ floorSeed;
    vec3 centre{};
    if (!settle_spot(s, key, half, centre)) return entt::null;
    const Entity e = asPlayer ? embody_as_player(reg, pool, id, layer)
                              : embody(reg, pool, id, layer);
    if (e == entt::null) return e;
    reg.get<Transform>(e).pos = centre;
    return e;
}

} // namespace giga::game

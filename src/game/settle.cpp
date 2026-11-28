#include "game/settle.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdlib>

#include "core/rng.h"
#include "ecs/components.h" // Transform
#include "game/embody.h"    // embody, body_half_height, kBodyHalfWidth
#include "game/floor_gen.h" // floor_standable
#include "game/prop_system.h" // anchor_from_surface
#include "sim/physics.h" // stand_probe / stand_centre — один предикат стояния
#include "world/anchor.h"
#include "world/clearance.h"
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/surface.h"
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

namespace {

constexpr int kMinStandSupportCols = 16;
constexpr std::uint32_t kIdealLookahead = 16u;
constexpr std::uint32_t kMaxMaskSkipsMult = 8u;

int layer_solid_columns(const SubMask& m, int axis, int layer) {
    if (axis == 2) return std::popcount(m.words[layer]);
    int cols = 0;
    for (int v = 0; v < kSubDim; ++v)
        for (int u = 0; u < kSubDim; ++u) {
            const int bit =
                axis == 0 ? sub_bit(layer, u, v) : sub_bit(u, layer, v);
            if (m.test(bit)) ++cols;
        }
    return cols;
}

bool sub_cell_clear_at(const MacroGrid& g, int x, int y, int z, int axis,
                       int layer, int u, int v) {
    const SubMask& m = g.mask(x, y, z);
    const int bit = axis == 0   ? sub_bit(layer, u, v)
                    : axis == 1 ? sub_bit(u, layer, v)
                                : sub_bit(u, v, layer);
    return !m.test(bit);
}

bool has_stand_headroom(const MacroGrid& grid, const GravityFrame& gf,
                        int wx, int wy, int wz, int kFromFloor) {
    constexpr int kHeadHeightSub = 6; // >= 1.5 м, тело 1.75 м = 7 субвокселей
    const CellStep d = regime_down(
        gf.axis == 0 ? (gf.upSign > 0 ? GravityRegime::NegX : GravityRegime::PosX)
        : gf.axis == 1 ? (gf.upSign > 0 ? GravityRegime::NegY : GravityRegime::PosY)
                       : (gf.upSign > 0 ? GravityRegime::NegZ : GravityRegime::PosZ));
    const int ax = wrap_macro(wx - d.x), ay = wrap_macro(wy - d.y),
              az = wrap_macro(wz - d.z);
    for (int h = 0; h < kHeadHeightSub; ++h) {
        const int pos = kFromFloor + h;
        const bool inOwn = pos < kSubDim;
        const int inCell = inOwn ? pos : (pos - kSubDim);
        const int layer = gf.upSign > 0 ? inCell : (kSubDim - 1 - inCell);
        const int cx = inOwn ? wx : ax;
        const int cy = inOwn ? wy : ay;
        const int cz = inOwn ? wz : az;
        for (int v = 3; v <= 4; ++v)
            for (int u = 3; u <= 4; ++u)
                if (!sub_cell_clear_at(grid, cx, cy, cz, gf.axis, layer, u, v))
                    return false;
    }
    return true;
}

SubVoxelAnchor make_fallback_anchor(int wx, int wy, int wz, int axis,
                                    int upSign, int supLayer) {
    SubVoxelAnchor a{};
    a.cx = wx;
    a.cy = wy;
    a.cz = wz;
    a.face = anchor_face_pack(axis, upSign);
    a.subX = static_cast<std::uint8_t>(axis == 0 ? supLayer : 4);
    a.subY = static_cast<std::uint8_t>(axis == 1 ? supLayer : 4);
    a.subZ = static_cast<std::uint8_t>(axis == 2 ? supLayer : 4);
    return a;
}

// Шаг обхода тора в режиме «просто где-то». Нечётный, значит по модулю
// степени двойки (kMacroCells = 2^21) это полный цикл — каждая клетка
// посещается ровно раз; золотое сечение разбрасывает соседние пробы по всему
// объёму вместо того, чтобы идти строкой вдоль X.
constexpr std::uint32_t kScatterStride = 0x9E3779B1u;
static_assert((kMacroCells & (kMacroCells - 1)) == 0,
              "полный цикл нечётного шага держится на степени двойки");
static_assert(kMacroCells % 64 == 0, "битсет занятости — целые слова");

// Клетка номер `k` в массиве боксов `boxes[boxIdx]` (или напрямую, если `boxIdx == nullptr`).
void span_cell(const FloorRooms& rooms, const std::uint32_t* boxIdx,
               const std::vector<std::uint32_t>& cellEnd, std::uint32_t k,
               int& cx, int& cy, int& cz) {
    const std::size_t pos = static_cast<std::size_t>(
        std::upper_bound(cellEnd.begin(), cellEnd.end(), k) - cellEnd.begin());
    const std::uint32_t bi = boxIdx != nullptr ? boxIdx[pos]
                                               : static_cast<std::uint32_t>(pos);
    const RoomBox& box = rooms.boxes[bi];
    const std::uint32_t local = k - (pos == 0 ? 0u : cellEnd[pos - 1]);
    const std::uint32_t dx = local % box.sx;
    const std::uint32_t dy = (local / box.sx) % box.sy;
    const std::uint32_t dz =
        local / (static_cast<std::uint32_t>(box.sx) * box.sy);
    cx = wrap_macro(box.x + static_cast<int>(dx));
    cy = wrap_macro(box.y + static_cast<int>(dy));
    cz = wrap_macro(box.z + static_cast<int>(dz));
}

} // namespace

bool cell_has_exit_clearance(const MacroGrid& grid, GravityRegime regime,
                             int cx, int cy, int cz) {
    const int wx = wrap_macro(cx), wy = wrap_macro(cy), wz = wrap_macro(cz);
    const GravityFrame gf = regime_frame(regime);
    for (int a = 0; a < 3; ++a) {
        if (gf.pull && a == gf.axis) continue;
        if (face_clearance_at(grid, wx, wy, wz, a) >= kBodyClearanceSub)
            return true;
        const int nx = wrap_macro(wx - (a == 0 ? 1 : 0));
        const int ny = wrap_macro(wy - (a == 1 ? 1 : 0));
        const int nz = wrap_macro(wz - (a == 2 ? 1 : 0));
        if (face_clearance_at(grid, nx, ny, nz, a) >= kBodyClearanceSub)
            return true;
    }
    return false;
}

bool cell_standable_on_grid(const MacroGrid& grid, GravityRegime regime,
                            int cx, int cy, int cz) {
    const int wx = wrap_macro(cx), wy = wrap_macro(cy), wz = wrap_macro(cz);
    const SubMask& own = grid.mask(wx, wy, wz);
    if (own.full()) return false;
    const GravityFrame gf = regime_frame(regime);
    if (!cell_has_exit_clearance(grid, regime, wx, wy, wz)) return false;
    if (!gf.pull) return true; // невесомость: опора не нужна

    const CellStep d = regime_down(regime);
    const int sx = wrap_macro(wx + d.x), sy = wrap_macro(wy + d.y),
              sz = wrap_macro(wz + d.z);
    const SubMask& below = grid.mask(sx, sy, sz);
    if (own.empty() && below.empty()) return false;

    const std::uint8_t upFace = anchor_face_pack(gf.axis, gf.upSign);
    const int belowTop = gf.upSign > 0 ? (kSubDim - 1) : 0;
    if (layer_solid_columns(below, gf.axis, belowTop) >= kMinStandSupportCols &&
        surface_face_at(grid, sx, sy, sz, upFace).columns >= kMinStandSupportCols &&
        has_stand_headroom(grid, gf, wx, wy, wz, 0)) {
        return true;
    }
    if (!own.empty()) {
        for (int k = 1; k < kSubDim; ++k) {
            const int supLayer = gf.upSign > 0 ? (k - 1) : (kSubDim - k);
            if (layer_solid_columns(own, gf.axis, supLayer) >= kMinStandSupportCols &&
                has_stand_headroom(grid, gf, wx, wy, wz, k)) {
                return true;
            }
        }
    }
    return false;
}

int cell_stand_slot_eval(const World& world, vec3 half, int cx, int cy, int cz,
                         SubVoxelAnchor& anchorOut, vec3& centreOut) {
    const int wx = wrap_macro(cx), wy = wrap_macro(cy), wz = wrap_macro(cz);
    if (!stand_point_in_cell(world, half, wx, wy, wz, centreOut)) return 0;
    const GravityRegime reg = world.gravity().regime;
    const MacroGrid& grid = world.grid();
    if (!cell_has_exit_clearance(grid, reg, wx, wy, wz)) return 0;

    const GravityFrame gf = regime_frame(reg);
    if (!gf.pull) {
        anchorOut = SubVoxelAnchor{wx, wy, wz, 4, 4, 4, 0};
        return 2;
    }

    const float cCoord = gf.axis == 0   ? centreOut.x
                         : gf.axis == 1 ? centreOut.y
                                        : centreOut.z;
    const float hAxis =
        gf.axis == 0 ? half.x : (gf.axis == 1 ? half.y : half.z);
    const int cellW = gf.axis == 0 ? wx : (gf.axis == 1 ? wy : wz);
    const float footAxis = cCoord - static_cast<float>(gf.upSign) * hAxis;
    const float floorEdge =
        static_cast<float>(cellW + (gf.upSign > 0 ? 0 : 1)) * kCellSize;
    const float relM = (footAxis - floorEdge) * static_cast<float>(gf.upSign);
    int kSub = static_cast<int>(std::lround(relM / kVoxelSize));
    if (kSub < 0) kSub = 0;
    if (kSub >= kSubDim) kSub = kSubDim - 1;

    const std::uint8_t upFace = anchor_face_pack(gf.axis, gf.upSign);
    if (kSub == 0) {
        const CellStep d = regime_down(reg);
        const int sx = wrap_macro(wx + d.x), sy = wrap_macro(wy + d.y),
                  sz = wrap_macro(wz + d.z);
        const int topLayer = gf.upSign > 0 ? (kSubDim - 1) : 0;
        const int topCols =
            layer_solid_columns(grid.mask(sx, sy, sz), gf.axis, topLayer);
        if (topCols < kMinStandSupportCols) return 0;
        const SurfaceFace sf = surface_face_at(grid, sx, sy, sz, upFace);
        if (sf.columns < kMinStandSupportCols) return 0;
        anchorOut = anchor_from_surface(sf);
        const bool ideal =
            floor_standable(world, wx, wy, wz) && anchor_alive(world, anchorOut);
        return ideal ? 2 : 1;
    }

    const int supLayer = gf.upSign > 0 ? (kSub - 1) : (kSubDim - kSub);
    if (layer_solid_columns(grid.mask(wx, wy, wz), gf.axis, supLayer) <
        kMinStandSupportCols)
        return 0;
    const SurfaceFace sf = surface_face_at(grid, wx, wy, wz, upFace);
    anchorOut = sf.columns > 0
                    ? anchor_from_surface(sf)
                    : make_fallback_anchor(wx, wy, wz, gf.axis, gf.upSign, supLayer);
    return 1;
}

bool room_box_pick_anchor(const FloorRooms& fr, const World& world, RoomId id,
                          std::size_t boxIndex, RoomTargetAnchor& out) {
    out = RoomTargetAnchor{};
    if (boxIndex >= fr.boxes.size() || id == kNoRoom) return false;
    const RoomBox& box = fr.boxes[boxIndex];
    if (box.sx == 0 || box.sy == 0 || box.sz == 0) return false;

    const vec3 kStdHalf{kBodyHalfWidth, kBodyHalfWidth, body_half_height(1750)};
    const GravityRegime reg = world.gravity().regime;
    const GravityFrame gf = regime_frame(reg);
    const MacroGrid& grid = world.grid();
    const CellStep down = regime_down(reg);

    const int midDx = box.sx / 2;
    const int midDy = box.sy / 2;
    const int midDz = gf.pull
                          ? (gf.axis == 2 ? (gf.upSign > 0 ? 0 : box.sz - 1)
                                          : box.sz / 2)
                          : box.sz / 2;
    const int floorDx =
        (gf.pull && gf.axis == 0) ? (gf.upSign > 0 ? 0 : box.sx - 1) : midDx;
    const int floorDy =
        (gf.pull && gf.axis == 1) ? (gf.upSign > 0 ? 0 : box.sy - 1) : midDy;
    const int floorDz = midDz;

    // Быстрый путь: центральная клетка на полу бокса (в 80-90% комнат это сразу Grade 2).
    {
        const int wx = wrap_macro(box.x + floorDx);
        const int wy = wrap_macro(box.y + floorDy);
        const int wz = wrap_macro(box.z + floorDz);
        if (room_at(fr, wx, wy, wz) == id) {
            SubVoxelAnchor anc{};
            vec3 dummy{};
            if (cell_stand_slot_eval(world, kStdHalf, wx, wy, wz, anc, dummy) == 2) {
                out.support = anc;
                out.cx = static_cast<std::uint8_t>(wx);
                out.cy = static_cast<std::uint8_t>(wy);
                out.cz = static_cast<std::uint8_t>(wz);
                out.valid = 1;
                return true;
            }
        }
    }

    int bestGrade = 0;
    int bestDist = 0x7FFFFFFF;
    int bestX = 0, bestY = 0, bestZ = 0;
    SubVoxelAnchor bestAnc{};
    for (int dz = 0; dz < box.sz; ++dz)
        for (int dy = 0; dy < box.sy; ++dy)
            for (int dx = 0; dx < box.sx; ++dx) {
                const int wx = wrap_macro(box.x + dx);
                const int wy = wrap_macro(box.y + dy);
                const int wz = wrap_macro(box.z + dz);
                if (room_at(fr, wx, wy, wz) != id) continue;
                const SubMask& own = grid.mask(wx, wy, wz);
                if (own.full()) continue;
                if (gf.pull && own.empty() &&
                    grid.mask(wx + down.x, wy + down.y, wz + down.z).empty())
                    continue;

                const int dist = std::abs(dx - floorDx) +
                                 std::abs(dy - floorDy) +
                                 std::abs(dz - floorDz);
                SubVoxelAnchor anc{};
                vec3 dummy{};
                const int grade =
                    cell_stand_slot_eval(world, kStdHalf, wx, wy, wz, anc, dummy);
                if (grade == 0) continue;
                if (grade > bestGrade ||
                    (grade == bestGrade && dist < bestDist)) {
                    bestGrade = grade;
                    bestDist = dist;
                    bestX = wx;
                    bestY = wy;
                    bestZ = wz;
                    bestAnc = anc;
                }
            }
    if (bestGrade == 0) return false;
    out.support = bestAnc;
    out.cx = static_cast<std::uint8_t>(bestX);
    out.cy = static_cast<std::uint8_t>(bestY);
    out.cz = static_cast<std::uint8_t>(bestZ);
    out.valid = 1;
    return true;
}

void rooms_bake_anchors(FloorRooms& fr, const World& world) {
    fr.boxAnchors.assign(fr.boxes.size(), RoomTargetAnchor{});
    for (std::size_t ri = 0; ri < fr.features.size(); ++ri) {
        const RoomId id = static_cast<RoomId>(ri + 1);
        const RoomFeature& rf = fr.features[ri];
        for (std::uint32_t b = 0; b < rf.boxCount; ++b) {
            const std::size_t bi = static_cast<std::size_t>(rf.boxFirst) + b;
            if (bi >= fr.boxes.size()) break;
            (void)room_box_pick_anchor(fr, world, id, bi, fr.boxAnchors[bi]);
        }
    }
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
    const std::size_t roomCount = rooms.features.size();
    for (std::size_t ri = 0; ri < roomCount; ++ri) {
        const RoomFeature& rf = rooms.features[ri];
        const std::uint16_t owner =
            ri < rooms.records.size() ? rooms.records[ri].owner : 0u;
        const std::size_t bucket =
            owner <= kFactionCount ? static_cast<std::size_t>(owner) : 0u;
        FactionSpan& sp = s.byOwner[bucket];
        for (std::uint32_t b = 0; b < rf.boxCount; ++b) {
            const std::uint32_t bi = rf.boxFirst + b;
            if (bi >= rooms.boxes.size()) break;
            const RoomBox& box = rooms.boxes[bi];
            const std::uint32_t vol =
                static_cast<std::uint32_t>(box.sx) * box.sy * box.sz;
            if (vol == 0) continue;
            sp.boxIdx.push_back(bi);
            sp.total += vol;
            sp.cellEnd.push_back(sp.total);
        }
    }
    s.total = acc;
    s.taken.assign(kMacroCells / 64, 0);
}

namespace {

void commit_slot(Settlement& s, std::size_t ci, int cx, int cy, int cz,
                 std::uint16_t faction, int grade, const vec3& centre,
                 vec3& centreOut) {
    s.taken[ci >> 6] |= (1ull << (ci & 63));
    centreOut = centre;
    ++s.settled;
    if (grade >= 2) ++s.settledFloorStandable;
    ++s.settledSubSupport;
    const RoomId rid =
        s.rooms != nullptr ? room_at(*s.rooms, cx, cy, cz) : kNoRoom;
    const bool hasRoom = rid != kNoRoom && rid <= s.rooms->size();
    const std::uint16_t owner = hasRoom ? s.rooms->room_owner(rid) : 0u;
    if (faction < kFactionCount && hasRoom) {
        if (owner == static_cast<std::uint16_t>(faction + 1u))
            ++s.settledOwnOwner;
        else if (owner == 0u)
            ++s.settledNeutral;
        else
            ++s.settledOtherOwner;
    } else {
        ++s.settledNeutral;
    }
}

bool probe_span(Settlement& s, bool anywhere, const std::uint32_t* boxIdx,
                const std::vector<std::uint32_t>& cellEnd, std::uint32_t space,
                std::uint16_t expectedOwner, bool checkOwner,
                std::uint16_t faction, std::uint32_t key, vec3 half,
                std::uint32_t& evalBudget, vec3& centreOut) {
    if (space == 0 || evalBudget == 0) return false;
    const MacroGrid& grid = s.world->grid();
    const CellStep down = regime_down(s.world->gravity().regime);
    const bool hasPull = (down.x != 0 || down.y != 0 || down.z != 0);
    const std::uint32_t start = hash_u32(key) % space;
    const std::uint32_t visitCap =
        anywhere ? std::min(evalBudget, space)
                 : std::min(space, evalBudget * kMaxMaskSkipsMult);

    bool hasFallback = false;
    std::size_t fbCi = 0;
    int fbX = 0, fbY = 0, fbZ = 0;
    vec3 fbCentre{};
    std::uint32_t lookaheadAfterFb = 0;

    for (std::uint32_t i = 0; i < visitCap && evalBudget > 0; ++i) {
        int cx = 0, cy = 0, cz = 0;
        if (anywhere) {
            const std::uint32_t ci = (start + i * kScatterStride) % space;
            cx = static_cast<int>(ci % kMacroDim);
            cy = static_cast<int>((ci / kMacroDim) % kMacroDim);
            cz = static_cast<int>(ci / (kMacroDim * kMacroDim));
        } else {
            span_cell(*s.rooms, boxIdx, cellEnd, (start + i) % space, cx, cy, cz);
        }
        ++s.probes;
        const std::size_t ci = macro_index(cx, cy, cz);
        if (s.taken[ci >> 6] & (1ull << (ci & 63))) continue;

        if (!anywhere && checkOwner && s.rooms != nullptr) {
            const RoomId rid = room_at(*s.rooms, cx, cy, cz);
            if (rid == kNoRoom || rid > s.rooms->size() ||
                s.rooms->room_owner(rid) != expectedOwner)
                continue;
        }

        const SubMask& own = grid.mask(cx, cy, cz);
        if (own.full() ||
            (hasPull && own.empty() &&
             grid.mask(cx + down.x, cy + down.y, cz + down.z).empty())) {
            if (hasFallback && ++lookaheadAfterFb >= kIdealLookahead) break;
            continue;
        }

        --evalBudget;
        SubVoxelAnchor anc{};
        vec3 centre{};
        const int grade =
            cell_stand_slot_eval(*s.world, half, cx, cy, cz, anc, centre);
        if (grade >= 2) {
            commit_slot(s, ci, cx, cy, cz, faction, grade, centre, centreOut);
            return true;
        }
        if (grade == 1 && !hasFallback) {
            hasFallback = true;
            fbCi = ci;
            fbX = cx;
            fbY = cy;
            fbZ = cz;
            fbCentre = centre;
        }
        if (hasFallback && ++lookaheadAfterFb >= kIdealLookahead) break;
    }

    if (hasFallback) {
        commit_slot(s, fbCi, fbX, fbY, fbZ, faction, 1, fbCentre, centreOut);
        return true;
    }
    return false;
}

} // namespace

bool settle_spot(Settlement& s, std::uint32_t key, vec3 half,
                 std::uint16_t faction, vec3& centreOut) {
    const bool anywhere = s.total == 0;
    std::uint32_t budget = kSettleProbeCells;
    if (anywhere) {
        if (probe_span(s, true, nullptr, s.boxEnd,
                       static_cast<std::uint32_t>(kMacroCells), 0u, false,
                       faction, key, half, budget, centreOut))
            return true;
        ++s.homeless;
        return false;
    }
    if (faction < kFactionCount) {
        const std::uint16_t ownOwner = static_cast<std::uint16_t>(faction + 1u);
        const FactionSpan& ownSpan = s.byOwner[ownOwner];
        if (ownSpan.total > 0) {
            std::uint32_t ownBudget = budget;
            if (probe_span(s, false, ownSpan.boxIdx.data(), ownSpan.cellEnd,
                           ownSpan.total, ownOwner, true, faction, key, half,
                           ownBudget, centreOut))
                return true;
            budget = kSettleProbeCells;
        }
        const FactionSpan& neuSpan = s.byOwner[0];
        if (neuSpan.total > 0 &&
            probe_span(s, false, neuSpan.boxIdx.data(), neuSpan.cellEnd,
                       neuSpan.total, 0u, true, faction, key ^ 0x4E455554u,
                       half, budget, centreOut))
            return true;
        for (std::size_t step = 0; step < kFactionCount; ++step) {
            const std::size_t ob = 1u + ((faction + 1u + step) % kFactionCount);
            if (ob == ownOwner) continue;
            const FactionSpan& sp = s.byOwner[ob];
            if (sp.total == 0) continue;
            if (probe_span(s, false, sp.boxIdx.data(), sp.cellEnd, sp.total,
                           static_cast<std::uint16_t>(ob), true, faction,
                           key ^ static_cast<std::uint32_t>(ob * 0x9E3779B9u),
                           half, budget, centreOut))
                return true;
        }
        ++s.homeless;
        return false;
    }
    if (probe_span(s, false, nullptr, s.boxEnd, s.total, 0u, false, faction,
                   key, half, budget, centreOut))
        return true;
    ++s.homeless;
    return false;
}

bool settle_spot(Settlement& s, std::uint32_t key, vec3 half, vec3& centreOut) {
    return settle_spot(s, key, half, kNoFaction, centreOut);
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
    if (!settle_spot(s, key, half, pool.faction(id), centre)) return entt::null;
    const Entity e = asPlayer ? embody_as_player(reg, pool, id, layer)
                              : embody(reg, pool, id, layer);
    if (e == entt::null) return e;
    reg.get<Transform>(e).pos = centre;
    return e;
}

} // namespace giga::game

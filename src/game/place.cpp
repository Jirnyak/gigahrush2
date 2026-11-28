// Выбор места и ход к нему. Законы и выводы — в place.h.

#include "game/place.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <span>
#include <vector>

#include "core/math.h"        // vec3
#include "core/rng.h"         // rand01 — стаггер пере-выбора
#include "core/wrap.h"        // wrap_delta / wrap_macro — тор по всем трём осям
#include "ecs/components.h"   // Transform, Velocity
#include "game/combat.h"      // Dead, Corpse — труп не занимает вместимость комнаты
#include "game/embody.h"      // NpcRef
#include "game/action_table.h" // kVerbAction — в сумму сумки идут глаголы деяния
#include "game/guide.h"       // ВЕДЕНИЕ ОДНОЙ ДВЕРЬЮ: фрейм, шаг к зоне, запись, стоп
#include "game/item_table.h"  // kItemVerbs — что предмет утоляет
#include "game/loot.h"        // Pickup — лежащие на полу пикапы не утоляются serve
#include "game/needs.h"       // needs_row_for — ОДНА строка нужд на всех решателей
#include "game/prop_system.h" // anchor_from_surface — якорь от SurfaceFace
#include "game/room_supply.h" // room_at_pos — клетка пикапа для согласования с serve
#include "game/serve.h"       // деяние нужды на месте (S24) — политика там
#include "game/settle.h"      // cell_standable_on_grid, RoomTargetAnchor
#include "world/gravity.h"    // GravityFrame / steer_frame_of — плоскость ходьбы
#include "world/macro_grid.h" // MacroGrid — проверка твёрдой плиты при выборе цели
#include "world/surface.h"    // surface_face_at — обновление якоря после карва
#include "world/types.h"      // kCellSize, kMacroDim, wrap_macro

namespace giga::game {

static_assert(kVerbNeedFood == NeedFood && kVerbNeedWater == NeedWater &&
                  kVerbNeedSleep == NeedSleep && kVerbNeedPee == NeedPee &&
                  kVerbNeedPoo == NeedPoo,
              "kVerbNeed* bit masks must match NeedBit in needs.h");
static_assert(kRoomBodiesPerCell ==
                  (kSubDim / kBodyClearanceSub) * (kSubDim / kBodyClearanceSub),
              "kRoomBodiesPerCell must match ceil(body_width / subvoxel) grid");

namespace {

// Σ спрос·вектор, делённая на тысячу ОДИН раз — на сумме. i64 в накопителе:
// `supply` у богатой комнаты — рубли (i32), и тысяча таких слагаемых i32
// переполнила бы i32, а i64 не переполнит (1000 · 2^31 ≈ 2.1·10^12).
std::int32_t dot_e3(const DemandE3 demand[kVerbCount], const std::int32_t* v) {
    std::int64_t acc = 0;
    for (std::size_t i = 0; i < kVerbCount; ++i)
        acc += static_cast<std::int64_t>(demand[i]) * static_cast<std::int64_t>(v[i]);
    return static_cast<std::int32_t>(acc / kDemandFull);
}

// Тороидальная манхэттенская дистанция в клетках. ТРИ оси через `wrap_delta` —
// неполную тройку (две через заворот, третью голым вычитанием) ловит Rule 8
// прибора `check_source_rules`, и ловит по делу.
int cell_dist_l1(int ax, int ay, int az, int bx, int by, int bz) {
    return std::abs(wrap_delta(ax, bx, kMacroDim)) +
           std::abs(wrap_delta(ay, by, kMacroDim)) +
           std::abs(wrap_delta(az, bz, kMacroDim));
}

std::int32_t place_interest_adj(std::span<const std::int16_t, kVerbCount> decl,
                                std::span<const std::int32_t, kVerbCount> sup,
                                const DemandE3 demand[kVerbCount],
                                VerbId* topVerb) {
    std::int64_t acc = 0;
    std::int64_t top = 0;
    VerbId topV = static_cast<VerbId>(kVerbCount);
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        // ПРЕДЛОЖЕНИЕ = объявлено + оснащение/запас, одним вектором (S12.4:
        // «K чисел на комнату — всё предложение целиком»). Пикапы на полу в нём
        // остаются: решение жителя стоит на `place_offer` с ними, и «разойтись с
        // place_interest ему нельзя» (serve.cpp, закон 2026-11-14).
        const std::int64_t offer =
            static_cast<std::int64_t>(decl[v]) + static_cast<std::int64_t>(sup[v]);
        const std::int64_t term = static_cast<std::int64_t>(demand[v]) * offer;
        acc += term;
        if (term > top) {
            top = term;
            topV = static_cast<VerbId>(v);
        }
    }
    if (topVerb != nullptr) *topVerb = topV;
    return static_cast<std::int32_t>(acc / kDemandFull);
}

// Целевая клетка внутри комнаты для наводки и прибытия place_errand_step:
// избегает точек внутри сплошной твёрдой плиты (grid->mask.full()) или в
// несвязанной высоте бокса, предпочитая ближайшую клетку, принадлежащую
// roomId и входящую в её ZonePartition.
int errand_target_cell(FloorRooms& fr, RoomId roomId,
                       const ZoneNav* zones, const MacroGrid* grid,
                       const GravityField* gravity,
                       int cx, int cy, int cz, int& tx, int& ty, int& tz) {
    if (roomId == kNoRoom || roomId > fr.features.size()) return -1;
    const int fallback = place_target_cell(fr, roomId, cx, cy, cz, tx, ty, tz);
    const GravityRegime reg =
        gravity != nullptr ? gravity->regime : GravityRegime::NegZ;
    auto cell_ok = [&](int ox, int oy, int oz, bool needZone, bool needStand) {
        if (room_at(fr, ox, oy, oz) != roomId) return false;
        if (grid != nullptr && grid->mask(ox, oy, oz).full()) return false;
        if (needStand && grid != nullptr &&
            !cell_standable_on_grid(*grid, reg, ox, oy, oz))
            return false;
        if (needZone && zones != nullptr && zones->part.built() &&
            zones->part.cell(ox, oy, oz) != roomId)
            return false;
        return true;
    };
    const bool hasZones = zones != nullptr && zones->part.built();
    if (fallback >= 0 && cell_ok(tx, ty, tz, hasZones, grid != nullptr))
        return fallback;

    const RoomFeature& rf = fr.features[roomId - 1];
    int bestDist = -1;
    int bx = tx, by = ty, bz = tz;
    std::size_t bestBi = fr.boxes.size();
    for (int pass = 0; pass < 2 && bestDist < 0; ++pass) {
        const bool needStand = (grid != nullptr);
        const bool needZone = (pass == 0);
        if (needZone && !hasZones) continue;
        for (std::uint32_t b = 0; b < rf.boxCount; ++b) {
            const std::size_t bi = static_cast<std::size_t>(rf.boxFirst) + b;
            if (bi >= fr.boxes.size()) break;
            const RoomBox& box = fr.boxes[bi];
            for (int dz = 0; dz < box.sz; ++dz)
                for (int dy = 0; dy < box.sy; ++dy)
                    for (int dx = 0; dx < box.sx; ++dx) {
                        const int ox = wrap_macro(box.x + dx);
                        const int oy = wrap_macro(box.y + dy);
                        const int oz = wrap_macro(box.z + dz);
                        if (!cell_ok(ox, oy, oz, needZone, needStand)) continue;
                        const int d = cell_dist_l1(cx, cy, cz, ox, oy, oz);
                        if (bestDist < 0 || d < bestDist) {
                            bestDist = d;
                            bx = ox;
                            by = oy;
                            bz = oz;
                            bestBi = bi;
                        }
                    }
        }
    }
    if (bestDist >= 0) {
        tx = bx;
        ty = by;
        tz = bz;
        if (grid != nullptr && !fr.boxAnchors.empty() &&
            fr.boxAnchors.size() == fr.boxes.size() &&
            bestBi < fr.boxAnchors.size()) {
            RoomTargetAnchor& a = fr.boxAnchors[bestBi];
            a.cx = static_cast<std::uint8_t>(bx);
            a.cy = static_cast<std::uint8_t>(by);
            a.cz = static_cast<std::uint8_t>(bz);
            a.valid = 1u;
            const GravityFrame gf = regime_frame(reg);
            if (gf.pull) {
                const CellStep step = regime_down(reg);
                const SurfaceFace sf = surface_face_at(
                    *grid, wrap_macro(bx + step.x), wrap_macro(by + step.y),
                    wrap_macro(bz + step.z), anchor_face_pack(gf.axis, gf.upSign));
                if (sf.columns > 0) a.support = anchor_from_surface(sf);
            }
        }
        return bestDist;
    }
    if (grid != nullptr && !fr.boxAnchors.empty() &&
        fr.boxAnchors.size() == fr.boxes.size()) {
        for (std::uint32_t b = 0; b < rf.boxCount; ++b) {
            const std::size_t bi = static_cast<std::size_t>(rf.boxFirst) + b;
            if (bi >= fr.boxAnchors.size()) break;
            fr.boxAnchors[bi].valid = 0;
        }
    }
    return -1;
}

} // namespace

// ---------------------------------------------------------------------------
// СПРОС
// ---------------------------------------------------------------------------

void demand_from_needs_table(const Needs& n, std::size_t verbCount,
                             const std::uint8_t* needMask,
                             const std::uint16_t* weightE3,
                             const std::int16_t* floorE3,
                             const VerbId* patienceSource, DemandE3* out) {
    if (out == nullptr || verbCount == 0) return;
    // Кривые — `needs_low_pressure`/`needs_high_pressure` из [game/needs.h], то
    // есть РОВНО те, которыми интент-арбитр судит те же самые бары. Одна
    // величина — одна кривая (см. довод о §64 в шапке needs.h), и КОЛЕНО у
    // каждой приходит из терпения СВОЕЙ строки (S13.5).
    for (std::size_t v = 0; v < verbCount; ++v) {
        const std::uint8_t mask = needMask != nullptr ? needMask[v] : 0u;
        float p = 0.0f;
        if (mask != 0u) {
            const VerbId pvid = patienceSource != nullptr
                                    ? patienceSource[v]
                                    : static_cast<VerbId>(v);
            if (mask & NeedFood) {
                const float f = needs_low_pressure(pvid, n.food);
                if (f > p) p = f;
            }
            if (mask & NeedWater) {
                const float w = needs_low_pressure(pvid, n.water);
                if (w > p) p = w;
            }
            if (mask & NeedSleep) {
                const float s = needs_low_pressure(pvid, n.sleep);
                if (s > p) p = s;
            }
            if (mask & NeedPee) {
                const float u = needs_high_pressure(pvid, n.pee);
                if (u > p) p = u;
            }
            if (mask & NeedPoo) {
                const float o = needs_high_pressure(pvid, n.poo);
                if (o > p) p = o;
            }
        }
        const float wScale = weightE3 != nullptr
                                 ? static_cast<float>(weightE3[v]) * 0.001f
                                 : 0.0f;
        const DemandE3 byNeed = static_cast<DemandE3>(std::lround(
            giga::clamp01(p * wScale) * static_cast<float>(kDemandFull)));
        const DemandE3 base = floorE3 != nullptr ? floorE3[v] : DemandE3{0};
        out[v] = byNeed > base ? byNeed : base;
    }
}

void demand_from_needs(const Needs& n, DemandE3 out[kVerbCount]) {
    demand_from_needs_table(n, kVerbCount, kVerbNeedMask, kVerbDemandWeightE3,
                            kVerbDemandFloorE3, nullptr, out);
}

void demand_add_health(float hp, float maxHp, DemandE3 out[kVerbCount]) {
    const float wScale =
        static_cast<float>(kVerbDemandWeightE3[kVerbHeal]) * 0.001f;
    const float p = needs_health_pressure(hp, maxHp) * wScale;
    const std::int32_t add = static_cast<std::int32_t>(
        std::lround(giga::clamp01(p) * static_cast<float>(kDemandFull)));
    const std::int32_t sum = static_cast<std::int32_t>(out[kVerbHeal]) + add;
    out[kVerbHeal] = static_cast<DemandE3>(sum > kDemandFull ? kDemandFull : sum);
}

// ---------------------------------------------------------------------------
// ОДНА СУММА
// ---------------------------------------------------------------------------

std::int32_t place_interest(const FloorRooms& fr, RoomId id,
                            const DemandE3 demand[kVerbCount],
                            VerbId* topVerb) {
    return place_interest_adj(fr.room_declared(id), fr.room_supply(id), demand,
                              topVerb);
}

std::int32_t place_interest(const Room& r, const DemandE3 demand[kVerbCount],
                            VerbId* topVerb) {
    return place_interest_adj(r.declared, r.supply, demand, topVerb);
}

int place_target_cell(const FloorRooms& fr, RoomId id, int cx, int cy, int cz,
                      int& tx, int& ty, int& tz) {
    if (id == kNoRoom || id > fr.features.size()) return -1;
    const RoomFeature& f = fr.features[id - 1];
    if (f.boxCount == 0) return -1;
    const bool useAnchors =
        !fr.boxAnchors.empty() && fr.boxAnchors.size() == fr.boxes.size();
    int best = -1;
    for (std::uint32_t b = 0; b < f.boxCount; ++b) {
        const std::size_t bi = static_cast<std::size_t>(f.boxFirst) + b;
        if (bi >= fr.boxes.size()) break;
        int ox = 0, oy = 0, oz = 0;
        if (useAnchors) {
            const RoomTargetAnchor& anc = fr.boxAnchors[bi];
            if (!anc.valid) continue;
            ox = anc.cx;
            oy = anc.cy;
            oz = anc.cz;
        } else {
            const RoomBox& box = fr.boxes[bi];
            ox = wrap_macro(box.x + box.sx / 2);
            oy = wrap_macro(box.y + box.sy / 2);
            oz = wrap_macro(box.z + box.sz / 2); // без якорей — центр бокса (без Z-up)
        }
        const int d = cell_dist_l1(cx, cy, cz, ox, oy, oz);
        if (best < 0 || d < best) {
            best = d;
            tx = ox;
            ty = oy;
            tz = oz;
        }
    }
    return best;
}

int place_target_cell(const FloorRooms& fr, const Room& r, int cx, int cy, int cz,
                      int& tx, int& ty, int& tz) {
    if (r.boxCount == 0) return -1;
    const bool useAnchors =
        !fr.boxAnchors.empty() && fr.boxAnchors.size() == fr.boxes.size();
    int best = -1;
    for (std::uint32_t b = 0; b < r.boxCount; ++b) {
        const std::size_t bi = static_cast<std::size_t>(r.boxFirst) + b;
        if (bi >= fr.boxes.size()) break; // пул боксов короче заявки — не UB
        int ox = 0, oy = 0, oz = 0;
        if (useAnchors) {
            const RoomTargetAnchor& anc = fr.boxAnchors[bi];
            if (!anc.valid) continue;
            ox = anc.cx;
            oy = anc.cy;
            oz = anc.cz;
        } else {
            const RoomBox& box = fr.boxes[bi];
            ox = wrap_macro(box.x + box.sx / 2);
            oy = wrap_macro(box.y + box.sy / 2);
            oz = wrap_macro(box.z + box.sz / 2); // без якорей — центр бокса (без Z-up)
        }
        const int d = cell_dist_l1(cx, cy, cz, ox, oy, oz);
        if (best < 0 || d < best) {
            best = d;
            tx = ox;
            ty = oy;
            tz = oz;
        }
    }
    return best;
}

std::int32_t place_crowd_cost(const FloorRooms& fr, RoomId id,
                              int cx, int cy, int cz) {
    if (id == kNoRoom || id > fr.records.size()) return 0;
    const std::uint16_t occ = room_occupants(fr, id);
    if (occ == 0) return 0;
    const bool isHere = room_at(fr, cx, cy, cz) == id;
    const std::uint32_t others =
        isHere ? static_cast<std::uint32_t>(occ - 1u)
               : static_cast<std::uint32_t>(occ);
    const std::uint32_t cap = fr.room_capacity(id);
    if (cap == 0 || others < cap) return 0;
    const std::uint32_t excess = (others - cap) + 1u;
    return static_cast<std::int32_t>(excess) * kRoomCrowdCostPerExtra;
}

std::int32_t place_crowd_cost(const FloorRooms& fr, const Room& r,
                              int cx, int cy, int cz) {
    // Фасад Room передан по значению — найти RoomId из указателя нельзя,
    // поиск живого переполнения всегда идёт через overload по RoomId.
    (void)fr;
    (void)r;
    (void)cx;
    (void)cy;
    (void)cz;
    return 0;
}

void rooms_occupants_rebuild(FloorRooms& fr, const Registry& reg,
                             LayerId layer) {
    rooms_occupants_clear(fr);
    if (fr.empty()) return;
    auto view = reg.view<const NpcRef, const Transform>();
    for (auto e : view) {
        if (reg.any_of<Dead, Corpse>(e)) continue;
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const RoomId at = room_at(fr, cell_of_metres(tr.pos.x),
                                  cell_of_metres(tr.pos.y),
                                  cell_of_metres(tr.pos.z));
        if (at != kNoRoom) room_occupant_add(fr, at, +1);
        const ErrandPlan* plan = reg.try_get<ErrandPlan>(e);
        if (plan != nullptr && plan->room != kNoRoom && plan->room != at)
            room_occupant_add(fr, plan->room, +1);
    }
}

std::int32_t place_cost(const FloorRooms& fr, RoomId id, int cx, int cy, int cz) {
    int tx = 0, ty = 0, tz = 0;
    const int cells = place_target_cell(fr, id, cx, cy, cz, tx, ty, tz);
    if (cells < 0) return 0;
    return cells * kPlacePathCostPerCell + place_crowd_cost(fr, id, cx, cy, cz);
}

std::int32_t place_cost(const FloorRooms& fr, const Room& r, int cx, int cy, int cz) {
    int tx = 0, ty = 0, tz = 0;
    const int cells = place_target_cell(fr, r, cx, cy, cz, tx, ty, tz);
    if (cells < 0) return 0;
    // ЕДИНСТВЕННОЕ МЕСТО, КУДА ПРИХОДЯТ БУДУЩИЕ ИЗДЕРЖКИ (решение владельца
    // 2026-10-01): путь, толпа при переполнении (У1.7), в будущем территория
    // и опасность. Скорер не трогается.
    return cells * kPlacePathCostPerCell + place_crowd_cost(fr, r, cx, cy, cz);
}

void carried_offer(const Inventory& inv, std::int32_t out[kVerbCount]) {
    for (std::size_t v = 0; v < kVerbCount; ++v) out[v] = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& sl = inv.slots[i];
        if (sl.item == kInvalidItem || sl.count == 0 || !item_valid(sl.item))
            continue;
        for (std::size_t v = 0; v < kVerbCount; ++v) {
            if (kVerbAction[v] >= kActionCount) continue; // не деянием — не в сумму
            const std::int32_t amt = kItemVerbs[sl.item - 1][v];
            if (amt > out[v]) out[v] = amt;
        }
    }
}

namespace {

PlacePick place_pick_impl(const FloorRooms& fr, const DemandE3 demand[kVerbCount],
                          int cx, int cy, int cz, const std::int32_t* carried) {
    PlacePick out;
    if (fr.empty() || fr.bins.empty() || fr.binCeil.empty()) return out;

    // ТОЧКА ПОД НОГАМИ — КАНДИДАТ ВСЕГДА, и её путь нулевой. Коридор даёт ноль:
    // то, через что идут, не предлагает ничего (S12.1) — кроме того, что тело
    // несёт с собой: своя сумка едет с телом и прибавляется к месту под ногами
    // (2026-11-14), а не к далёким комнатам.
    std::int32_t best = carried != nullptr ? dot_e3(demand, carried) : 0;
    std::int32_t bestCost = 0;
    VerbId bestVerb = static_cast<VerbId>(kVerbCount);
    const RoomId hereId = room_at(fr, cx, cy, cz);
    if (hereId != kNoRoom && hereId <= fr.features.size()) {
        VerbId hereVerb = static_cast<VerbId>(kVerbCount);
        const std::int32_t hereNet =
            place_interest_adj(fr.room_declared(hereId), fr.room_supply(hereId),
                               demand, &hereVerb) -
            place_crowd_cost(fr, hereId, cx, cy, cz);
        if (hereNet > 0) {
            best += hereNet;
            bestVerb = hereVerb;
        }
    }

    // РАДИУС ВЫВОДИТСЯ: глобальная верхняя грань интереса — храповик `maxOffer`
    // (max по комнатам, только растёт), значит ни одна комната тора не даст
    // больше. Не обгоняет место под ногами — искать нечего вовсе.
    const std::int32_t top = dot_e3(demand, fr.maxOffer);
    if (top <= best) return out;

    const int bx = cx >> kRoomBinShift;
    const int by = cy >> kRoomBinShift;
    const int bz = cz >> kRoomBinShift;

    for (int r = 0; r <= kRoomBinDim / 2; ++r) {
        const std::int32_t lower =
            r > 1 ? static_cast<std::int32_t>(r - 1) * kRoomBinEdge : 0;
        if (top - lower <= best) break;

        for (int dz = -r; dz <= r; ++dz)
            for (int dy = -r; dy <= r; ++dy)
                for (int dx = -r; dx <= r; ++dx) {
                    if (std::abs(dx) != r && std::abs(dy) != r && std::abs(dz) != r)
                        continue;
                    const std::size_t bi = room_bin_index(bx + dx, by + dy, bz + dz);
                    ++out.bins;
                    const std::int32_t ceilBound =
                        dot_e3(demand, &fr.binCeil[bi * kVerbCount]);
                    if (ceilBound - lower <= best) continue;
                    for (const RoomId id : fr.bins[bi]) {
                        if (id == kNoRoom || id > fr.features.size()) continue;
                        if (!fr.boxAnchors.empty() &&
                            fr.boxAnchors.size() == fr.boxes.size()) {
                            int ax = 0, ay = 0, az = 0;
                            if (place_target_cell(fr, id, cx, cy, cz, ax, ay, az) < 0)
                                continue;
                        }
                        ++out.judged;
                        const std::int32_t cost = place_cost(fr, id, cx, cy, cz);
                        VerbId candVerb = static_cast<VerbId>(kVerbCount);
                        const std::int32_t score =
                            place_interest_adj(fr.room_declared(id),
                                               fr.room_supply(id), demand,
                                               &candVerb) -
                            cost;
                        const bool better =
                            score > best ||
                            (score == best && out.room != kNoRoom && cost < bestCost) ||
                            (score == best && out.room != kNoRoom && cost == bestCost &&
                             id < out.room);
                        if (!better) continue;
                        best = score;
                        bestCost = cost;
                        bestVerb = candVerb;
                        out.room = id;
                    }
                }
    }
    out.score = best;
    out.cost = out.room == kNoRoom ? 0 : bestCost;
    // Ярлык осмыслен ровно тогда, когда есть пара: без комнаты не выиграл
    // никто, и называть глагол места под ногами было бы ложью о решении.
    out.verb = out.room == kNoRoom ? static_cast<VerbId>(kVerbCount) : bestVerb;
    return out;
}

} // namespace

PlacePick place_pick(const FloorRooms& fr, const DemandE3 demand[kVerbCount],
                     int cx, int cy, int cz, const std::int32_t* carried) {
    return place_pick_impl(fr, demand, cx, cy, cz, carried);
}

// ---------------------------------------------------------------------------
// ХОД К ВЫБРАННОМУ МЕСТУ
// ---------------------------------------------------------------------------

PlaceTick place_errand_step(Registry& reg, NpcPool& pool, FloorRooms& fr,
                            LayerId layer, double now, std::uint64_t tick,
                            const GravityField* gravity, const ZoneNav* zones,
                            ServeTick* serve, EventBus* bus,
                            const MacroGrid* grid) {
    PlaceTick out;
    // Телеметрия деяния опциональна у вызывающего, но не внутри: ветки «если
    // счётчик дали» размножили бы условия по всему проходу.
    ServeTick serveSink;
    ServeTick& srv = serve != nullptr ? *serve : serveSink;
    // Непостроенный нав — no-op, не UB: тот же контракт, которым живут
    // `wander_step` и `ai_patrol_step`. Пока бейк в полёте тела ходят вандером,
    // как всегда. До 2026-10-12 этой проверкой был `fine.flow.empty()` —
    // решётка; теперь единственный нав ходьбы это зоны, и ветки «без зон»
    // больше нет (§88/F.2 шаг 3).
    if (zones == nullptr || !zones->built()) return out;
    if (fr.roomAt.empty() || fr.empty()) return out;

    // ПУЛЫ ПРОГРЕТЫ ДО ОТКРЫТИЯ ВИДА, и это не оптимизация, а снятие класса
    // UB. Внутри обхода проход СОЗДАЁТ компоненты (`ErrandPlan` лениво,
    // `Acting` — деяние) и может позвать `apply_damage` (цена сомнительной
    // еды), а тот крепит `Dead`. РОЖДЕНИЕ НОВОГО ПУЛА растит контейнер пулов
    // реестра и дангл'ит указатели, которые держит ЖИВОЙ вид, — дословно тот
    // дефект, ради которого `mob_attack_step` разрезан на две фазы
    // ([game/combat.cpp]). Существующий пул от вставки элемента не переезжает,
    // поэтому достаточно, чтобы к моменту открытия вида все три пула уже БЫЛИ.
    //
    // Шапка ниже утверждала обратное («эмплейс компоненты, которой вид не
    // обходит, итерацию не ломает») — утверждение верно для ЭЛЕМЕНТА и неверно
    // для ПЕРВОГО элемента нового рода; аудит это и нашёл.
    (void)reg.storage<ErrandPlan>();
    (void)reg.storage<Acting>();
    (void)reg.storage<Dead>();
    steer_pool_warm(reg);  // четвёртый пул — заявка ведения ([game/guide.h])
    // Учёт занятости комнат (У1.7): перед выбором пересчитываем стоящих в
    // комнатах и уже направленных к ним тел, а по ходу цикла добираем бронь.
    rooms_occupants_rebuild(fr, reg, layer);

    // Фрейм гравитации — свойство мира, не тела, и спрашивается ОДНОЙ ДВЕРЬЮ
    // ([world/gravity.h] `steer_frame_of`): здесь стояла дословная копия того
    // же разрешения режима и та же лямбда `tangent`, что в трёх других
    // проходах ведения. null держит NegZ побитово (тесты), Custom разрешается
    // вектором.
    const GravityFrame gf = steer_frame_of(gravity);
    // Земля под сторожа края — та же, что возьмёт писатель ([game/guide.h]).
    const SteerGround ground = steer_ground_of(grid, gravity);
    // ДЕРЖАТЬ НА МЕСТЕ (S24): забрать токен и обнулить скорость В ПЛОСКОСТИ
    // ХОДЬБЫ — ось гравитации не трогаем, её владелец физика. Владеемый ноль
    // здесь законен и необходим: «замирающий NPC есть дефект» (S13.2) сказано
    // про тело БЕЗ решения, а это тело решение как раз ИСПОЛНЯЕТ. Не обнулить
    // — и `wander_step`, пропустив тело по токену, оставит ему прежнюю
    // скорость, то есть деяние свершится на ходу.
    // ДЕРЖАТЬ НА МЕСТЕ — ЭТО ЦЕЛЬ `Hold`, а не отсутствие цели. Прежде это
    // был забор СВОЕГО токена плюс обнуление скорости своей рукой; довод
    // остался тот же (S13.2 «замирающий NPC есть дефект» сказано про тело БЕЗ
    // решения, а это тело решение ИСПОЛНЯЕТ), а второго писателя больше нет.
    const auto hold_still = [&reg, tick](Entity e) {
        steer_claim(reg, e, tick, SteerRank::Errand, target_hold());
    };

    auto view = reg.view<const AiBrain, const NpcRef, const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // РАЗВИЛКА МОЗГОВ (S13.7a): проход обслуживает ЖИТЕЛЕЙ. Формулировка
        // положительная, а не «это не игрок и не моб» — отрицательная
        // рассыпается при добавлении прохода, и однажды рассыпалась
        // (`ai_equip_step` снимал фонарь из руки игрока, bugs.md Б1).
        if (decider_of(reg, e) != Decider::Resident) continue;
        // ТЕЛО ЗАЯВЛЕНО КЕМ-ТО СИЛЬНЕЕ — это бегство (`Flee`) или наряд
        // (`Patrol`), ровно те двое, что были токеном `Ai`. Угроза и наряд
        // старше дела; не вмешиваемся.
        //
        // ВОПРОС ЗАДАЁТСЯ ДО ВСЕЙ РАБОТЫ, а не перед записью скорости, и это
        // не вкус: ниже проход ОТКРЫВАЕТ ОКНО ДЕЯНИЯ и ИЗЫМАЕТ предмет из
        // ящика. Заявитель, проигравший по рангу уже после этого, ел бы на
        // ходу — тот самый дефект, под который и построен `hold_still`.
        //
        // Открытое ДЕЯНИЕ такого тела уже сорвано: обрыв «тело ушло от дела»
        // делает поллер `serve_step` ([game/serve.h], закон 5), который стоит в
        // тике ПЕРЕД этим проходом. До 2026-11-14 рвали здесь — и поэтому окна
        // носителя камеры не рвал и не опрашивал никто: этот проход
        // обслуживает только жителей.
        if (steer_claimed_by_stronger(reg, e, SteerRank::Errand, tick))
            continue;

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        ++out.considered;

        // Ленивое навешивание — правило `PlayerMelee`/`PatrolPlan`: эмплейс
        // компоненты, которой вид не обходит, итерацию не ломает.
        if (!reg.all_of<ErrandPlan>(e)) reg.emplace<ErrandPlan>(e);
        ErrandPlan& plan = reg.get<ErrandPlan>(e);

        // ОДНА ДВЕРЬ «метры → клетка тора» (`cell_of_metres@world/types.h`):
        // здесь эта свёртка была выписана в строку трижды, а у комнаты предмета
        // (`room_at_pos`) — ЧЕТВЁРТЫЙ раз и с усечением к нулю вместо `floor`,
        // то есть решение и мир расходились на шве тора.
        const int cx = cell_of_metres(tr.pos.x);
        const int cy = cell_of_metres(tr.pos.y);
        const int cz = cell_of_metres(tr.pos.z);

        const std::uint32_t idSeed = identity_seed(id);
        const auto stagger = [&]() {
            return static_cast<float>(
                now + static_cast<double>(kRethinkBaseSec) +
                static_cast<double>(rand01(channel_seed(idSeed, kPlaceRepickChannel))) *
                    static_cast<double>(kRethinkSpreadSec));
        };

        // Цель могла исчезнуть вместе с этажом: комнаты пересоздаются на каждом
        // входе (закон 2 room.h), а компонента живёт с телом.
        bool goalValid =
            (plan.room != kNoRoom && plan.room <= fr.features.size());
        if (plan.room != kNoRoom && !goalValid) {
            plan.room = kNoRoom;
            plan.verb = static_cast<VerbId>(kVerbCount);
        }

        int tx = 0, ty = 0, tz = 0;
        bool haveTarget = false;
        if (plan.room != kNoRoom && goalValid) {
            haveTarget =
                errand_target_cell(fr, plan.room, zones, grid, gravity,
                                   cx, cy, cz, tx, ty, tz) >= 0;
            // ПРИБЫЛ = ВНУТРИ БОКСА (S13.3) или в целевой клетке (перекрытие —
            // `overlapCells` бывает непустым). ТРЕТЬЕ УСЛОВИЕ — ЗОНА РАЗБИВКИ
            // (§88/E). С навом по зонам цель ЕСТЬ зона, и дошёл тот, кто в ней
            // стоит. Разбивка шире объявленного бокса (она впитала коридор между
            // комнатами), и это не поблажка: предложение и глаголы живут НА ЗОНЕ,
            // а тело внутри зоны их и получает. Без этого условия поле вело бы
            // тело до границы зоны, а прибытие ждало бы объявленных клеток — то
            // есть последнюю ногу пришлось бы идти вслепую, ровно как с остатком
            // якоря у решётки. (Волна 2026-11-28 сняла условие и вела последнюю
            // ногу прямым пеленгом — возвращено решением владельца.)
            if (room_at(fr, cx, cy, cz) == plan.room ||
                zone_of_body(*zones, cx, cy, cz) == plan.room ||
                (haveTarget && cx == tx && cy == ty && cz == tz)) {
                ++out.arrived;
                if (plan.room != room_at(fr, cx, cy, cz))
                    room_occupant_add(fr, plan.room, -1);
                plan.room = kNoRoom;
                plan.verb = static_cast<VerbId>(kVerbCount);
                plan.nextPickAt = stagger();
                goalValid = false;
                // Дошёл — цель снята, и тело падает в ветку «сумма сказала
                // оставайся» НИЖЕ, то есть прибытие и есть вход в деяние
                // (S24). Своей ветки у прибытия нет СОЗНАТЕЛЬНО: деяние
                // вешается на СОСТОЯНИЕ «стою там, где предлагают», а не на
                // событие прихода, — замер показал, что 375 тел из 379 стоят
                // в коридорах и никуда не идут, то есть событие прихода
                // обслуживало бы четыре тела из трёхсот семидесяти девяти.
            } else if (!haveTarget) {
                ++out.unreachable;
                room_occupant_add(fr, plan.room, -1);
                plan.room = kNoRoom;
                plan.verb = static_cast<VerbId>(kVerbCount);
                plan.nextPickAt = stagger();
                ++out.idle;
                continue;
            }
        }

        // ВЫБОР — ПО СОБЫТИЮ: только когда цели нет и стаггер истёк.
        if (plan.room == kNoRoom) {
            if (serve_holding(reg, e, tick)) {
                hold_still(e);
                ++out.serving;
                continue;
            }
            if (now >= static_cast<double>(plan.nextPickAt)) {
                const Needs row = needs_row_for(pool, id);
                DemandE3 demand[kVerbCount];
                demand_from_needs(row, demand);
                demand_add_health(static_cast<float>(pool.hp(id)),
                                  static_cast<float>(pool.max_hp(id)), demand);
                std::int32_t carried[kVerbCount];
                carried_offer(pool.inventory(id), carried);
                const PlacePick pick = place_pick_impl(fr, demand, cx, cy, cz, carried);
                out.judged += pick.judged;
                out.bins += pick.bins;
                plan.nextPickAt = stagger();
                if (pick.room != kNoRoom) {
                    plan.room = pick.room;
                    plan.verb = pick.verb;  // ярлык пары — ЗАЧЕМ тело идёт
                    ++plan.picks;
                    ++out.picked;
                    goalValid = (plan.room <= fr.features.size());
                    if (pick.room != room_at(fr, cx, cy, cz))
                        room_occupant_add(fr, pick.room, +1);
                }
            }
            if (plan.room == kNoRoom) {
                if (serve_begin(ServeCtx{reg, pool, fr, bus, tick}, e, id,
                                tr.pos, srv)) {
                    hold_still(e);
                    ++out.serving;
                    continue;
                }
                ++out.idle;
                continue;
            }
        }
        if (!goalValid) {
            ++out.idle;
            continue;
        }
        if (plan.verb < kVerbCount) ++out.byVerb[plan.verb];

        const RoomId myZone = zone_of_body(*zones, cx, cy, cz);
        if (myZone == kNoRoom) {
            // Тело стоит там, где по карте путей стоять нельзя (нет
            // касания): вести его некуда, отдаём вандеру.
            ++out.offnav;
            ++out.idle;
            continue;
        }
        // КУДА ШАГНУТЬ — ОДНОЙ ДВЕРЬЮ ([game/guide.h] `steer_to_zone`): два
        // чтения нава, прицел в ЦЕНТР следующей клетки, нормировка. Эти
        // тридцать строк стояли побайтово одинаково здесь, в `wander.cpp` и в
        // `ai.cpp`.
        const AABB* box = reg.try_get<AABB>(e);
        const vec3 half = box != nullptr ? box->half : vec3{0.4f, 0.4f, 0.4f};
        const SteerStep st = steer_to_zone(
            *zones, gf, ground, tr.pos, half, cx, cy, cz, myZone, plan.room);
        // Прибор прогресса: расстояние в ЗОНАХ до цели. Σ по ведомым телам
        // падает ⟺ ходок доходит.
        const std::uint16_t zd = zones->dist.at(
            static_cast<std::uint32_t>(myZone) - 1u,
            static_cast<std::uint32_t>(plan.room) - 1u);
        if (zd != kZoneUnreachable) {
            out.zoneDistSum += zd;
            ++out.zoneDistBodies;
        }
        if (st.fail == SteerFail::NoRoute || st.fail == SteerFail::Edge) {
            // Маршрута нет (разные компоненты связности, или цель в толще) —
            // либо за шагом обрыв, падение с которого ранит (сторож ведения).
            // Цель снимается со стаггером: пере-спрашивать каждый тик значило
            // бы платить ценой запроса за безнадёжное тело каждый кадр.
            if (st.fail == SteerFail::Edge) ++out.edge;
            ++out.unreachable;
            if (plan.room != room_at(fr, cx, cy, cz))
                room_occupant_add(fr, plan.room, -1);
            plan.room = kNoRoom;
            plan.nextPickAt = stagger();
            ++out.idle;
            continue;
        }

        // НАПРАВЛЕНИЕ СЧИТАЕТСЯ ДО ЗАБОРА ТОКЕНА, и порядок здесь не вкусовой:
        // тело, забранное токеном и не получившее скорости, пропускается
        // `wander_step` и не ведётся никем — то есть ЗАМИРАЕТ, а замирающий NPC
        // есть дефект (S13.2). Поймано на себе при посадке проверки
        // проходимости ниже: `continue` стоял после забора.
        if (st.fail == SteerFail::StepUp) {
            // Единственный случай, когда дверь зон отдаёт шаг ВДОЛЬ гравитации:
            // ступенька и есть выход из зоны. Тангенциального пеленга у него
            // ровно ноль, то есть вести этим шагом нечем — тело отдаётся
            // вандеру, а цель ОСТАЁТСЯ (токен не забран). Слепую прямую на цель
            // здесь не берём сознательно: ровно она была остатком якоря у
            // решётки и стоила §88 нуля прибытий.
            ++out.idle;
            continue;
        }
        if (st.fail == SteerFail::NoBearing) {
            // Направления нет (проекция опустошила вектор, или тело стоит в
            // целевой клетке). Владеемый ноль здесь был бы остановкой на ровном
            // месте, поэтому тело отдаётся вандеру, а цель остаётся.
            ++out.idle;
            continue;
        }

        // ЗАБОР ТОКЕНА — только теперь, когда направление ЕСТЬ. Отсюда и до
        // конца тика этот проход — единственный писатель горизонтальной
        // `Velocity` этого тела.
        //
        // Заявка подаётся ТОЛЬКО когда шаг найден, и порядок здесь не
        // вкусовой: заявка на недостижимую цель отняла бы тело у прогулки,
        // которая его ещё провела бы, — то есть тело ЗАМЕРЛО БЫ, а замирающий
        // NPC есть дефект (S13.2). Поймано на себе при посадке проверки
        // проходимости: `continue` стоял после забора токена.
        ++out.walking;
        // ДЕЛО — ЭТО ХОДЬБА, а не бегство: шаг в точности равен шагу вандера
        // (один дом числа — `kWalkSpeedMps@game/guide.h`), поэтому тело,
        // перешедшее с прогулки на дело, меняет НАПРАВЛЕНИЕ, а не походку.
        // Множитель паники остаётся читаемым ровно потому, что обычный шаг
        // обычен. Цель — ЗОНА: шаг по ней найдёт единственный писатель той же
        // дверью, которой проход только что проверил исполнимость.
        steer_claim(reg, e, tick, SteerRank::Errand,
                    target_zone(plan.room, kErrandSpeed));
    }
    return out;
}

} // namespace giga::game

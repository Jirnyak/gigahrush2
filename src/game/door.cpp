#include "game/door.h"

#include <cstdio>

#include "ecs/components.h"    // Transform — «тело в проёме»
#include "game/fast_travel.h"  // лифтовые узлы — механизм-створки
#include "game/floor_gen.h"    // floor_doorways, lift_entrance, floor_room_mask
#include "game/mob_table.h"    // RoomBit — гермо-таксономия (Living/Medical/Hq)
#include "world/destruct.h"    // materialize_sub_page, kSubMaterialName
#include "world/medium.h"      // medium_recount — агрегат клетки после штампа
#include "world/world.h"

namespace giga::game {

namespace {

// Досягаемость актора до проёма, метры. Та же велечина, что жила у прежней
// системы: тело 0.8 м у клетки 2 м — работать дверью можно из соседней.
constexpr float kDoorReachM = 2.6f;

bool body_in_portal(const DoorPortal& p, const Registry& reg, LayerId layer) {
    auto view = reg.view<const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        const int cz = wrap_macro(static_cast<int>(tr.pos.z / kCellSize));
        if (cx != p.cx || cy != p.cy) continue;
        if (cz >= p.cz && cz < p.cz + p.h) return true;
    }
    return false;
}

float portal_dist2(const DoorPortal& p, const vec3& pos) {
    const float px = (static_cast<float>(p.cx) + 0.5f) * kCellSize;
    const float py = (static_cast<float>(p.cy) + 0.5f) * kCellSize;
    const float pz =
        (static_cast<float>(p.cz) + static_cast<float>(p.h) * 0.5f) * kCellSize;
    const float dx = wrap_delta_f(pos.x, px, kWorldExtent);
    const float dy = wrap_delta_f(pos.y, py, kWorldExtent);
    const float dz = wrap_delta_f(pos.z, pz, kWorldExtent);
    return dx * dx + dy * dy + dz * dz;
}

} // namespace

void door_declare(Doors& doors, int number, const FloorSpec& spec,
                  unsigned seed) {
    doors.list.clear();
    for (auto& l : doors.lift) l = kNoPortal;

    std::vector<Doorway> ways;
    floor_doorways(number, spec, seed, ways);
    const int stride = floor_room_stride(spec.kind);
    const int roomsPerAxis = stride > 0 ? kMacroDim / stride : 1;
    constexpr std::uint16_t kHermeticBits =
        static_cast<std::uint16_t>(RoomBit::Living) |
        static_cast<std::uint16_t>(RoomBit::Medical) |
        static_cast<std::uint16_t>(RoomBit::Hq);
    auto hermetic_room = [&](int rx, int ry) {
        return (floor_room_mask(spec.kind, number, rx, ry) & kHermeticBits) !=
               0;
    };

    for (const Doorway& w : ways) {
        DoorPortal p;
        p.cx = w.cx;
        p.cy = w.cy;
        p.cz = w.cz;
        p.h = w.h;
        p.mechanism = 0;
        // Гермополотно квартирного класса — та же таксономия комнат, что
        // выбирала гермодвери раньше: любая из двух смежных комнат
        // Living/Medical/Hq. Неразрушимость — свойством материала (закон 3).
        bool herm = false;
        if (stride > 0) {
            if (w.axis == 0) {
                const int rxR = w.cx / stride;
                const int rxL = (rxR - 1 + roomsPerAxis) % roomsPerAxis;
                const int ry = w.cy / stride;
                herm = hermetic_room(rxL, ry) || hermetic_room(rxR, ry);
            } else {
                const int ryU = w.cy / stride;
                const int ryD = (ryU - 1 + roomsPerAxis) % roomsPerAxis;
                const int rx = w.cx / stride;
                herm = hermetic_room(rx, ryD) || hermetic_room(rx, ryU);
            }
        }
        p.mat = herm ? kMatDoorHermetic : kMatDoorSteel;
        doors.list.push_back(p);
    }

    // Диагностика UX (владелец 2026-08-28 «не вижу табличек»): первые
    // порталы — вслух, чтобы координаты для проверки радиуса были в логе.
    {
        int byCz[8] = {0};
        for (const DoorPortal& q : doors.list)
            if (q.cz < 64) ++byCz[q.cz % 8];
        std::fprintf(stderr,
                     "[door] declared %zu portals; cz%%8 histogram: "
                     "%d %d %d %d %d %d %d %d\n",
                     doors.list.size(), byCz[0], byCz[1], byCz[2], byCz[3],
                     byCz[4], byCz[5], byCz[6], byCz[7]);
    }

    // Лифтовые створки: механизм-порталы на проёмах столбов, той же
    // арифметикой, что штамповала геометрию (lift_entrance). Сталь: щит
    // области и так делает их неприкосновенными, гермо-материал не нужен.
    for (int hub = 0; hub < kFastHubsPerFloor; ++hub) {
        std::uint8_t hcx = 0, hcy = 0;
        fast_hub_cell(hub, hcx, hcy);
        const LiftEntrance e = lift_entrance(spec.kind, number, hub, seed);
        const int dx = e.side == 0 ? 1 : e.side == 1 ? -1 : 0;
        const int dy = e.side == 2 ? 1 : e.side == 3 ? -1 : 0;
        DoorPortal p;
        p.cx = static_cast<std::uint8_t>(wrap_macro(hcx + dx));
        p.cy = static_cast<std::uint8_t>(wrap_macro(hcy + dy));
        p.cz = static_cast<std::uint8_t>(e.h);
        p.h = 1;
        p.mat = kMatDoorSteel;
        p.mechanism = 1;
        doors.lift[hub] = static_cast<std::uint32_t>(doors.list.size());
        doors.list.push_back(p);
    }
}

bool door_closed(const World& w, const DoorPortal& p) {
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    for (int z = p.cz; z < p.cz + p.h; ++z) {
        const std::size_t ci = macro_index(p.cx, p.cy, wrap_macro(z));
        const SubMask& m = w.grid().masks()[ci];
        if (m.empty()) continue;
        // Однородная клетка без страницы: тип и есть материал всей маски.
        const CellType* pg = f ? f->page(ci) : nullptr;
        if (!pg) {
            if (w.grid().types()[ci] == p.mat) return true;
            continue;
        }
        for (int b = 0; b < kSubVoxels; ++b)
            if (m.test(b) && pg[b] == p.mat) return true;
    }
    return false;
}

namespace {

// Закрыть: материя полотна в каждый СВОБОДНЫЙ субвоксель проёма — чужая
// материя (косяки, вода) не трогается, полотно обтекает её честно.
void stamp_portal(World& w, const DoorPortal& p,
                  std::vector<std::uint32_t>& dirty) {
    for (int z = p.cz; z < p.cz + p.h; ++z) {
        const std::size_t ci = macro_index(p.cx, p.cy, wrap_macro(z));
        SubMask& m = w.grid().mask(p.cx, p.cy, z);
        CellType* pg = materialize_sub_page(w, ci);
        bool wrote = false;
        for (int b = 0; b < kSubVoxels; ++b) {
            if (m.test(b)) continue;
            if (pg[b] != kCellAir) continue; // среда стоит — не замуровываем
            m.set(b);
            pg[b] = p.mat;
            wrote = true;
        }
        if (m.full()) w.grid().set_cell(p.cx, p.cy, z, p.mat);
        if (wrote) {
            medium_recount(w, ci, pg);
            dirty.push_back(static_cast<std::uint32_t>(ci));
        }
    }
}

// Открыть: снять ровно СВОИ биты (страница == материал полотна). Выбитое
// карвом полотно чинить нечем — снимается что осталось.
void clear_portal(World& w, const DoorPortal& p,
                  std::vector<std::uint32_t>& dirty) {
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    for (int z = p.cz; z < p.cz + p.h; ++z) {
        const std::size_t ci = macro_index(p.cx, p.cy, wrap_macro(z));
        SubMask& m = w.grid().mask(p.cx, p.cy, z);
        CellType* pg = nullptr;
        if (f && f->page(ci)) {
            pg = materialize_sub_page(w, ci);
        } else if (w.grid().types()[ci] == p.mat) {
            // Однородное полотно без страницы (set_cell при full выше).
            pg = materialize_sub_page(w, ci);
        }
        if (!pg) continue;
        bool wrote = false;
        for (int b = 0; b < kSubVoxels; ++b) {
            if (!m.test(b) || pg[b] != p.mat) continue;
            m.clear(b);
            pg[b] = kCellAir;
            wrote = true;
        }
        if (wrote) {
            if (m.empty()) w.grid().set_cell(p.cx, p.cy, z, kCellAir);
            medium_recount(w, ci, pg);
            dirty.push_back(static_cast<std::uint32_t>(ci));
        }
    }
}

} // namespace

std::uint32_t door_query_near(const Doors& doors, const vec3& pos) {
    std::uint32_t best = kNoPortal;
    float bestD2 = kDoorReachM * kDoorReachM;
    for (std::uint32_t i = 0; i < doors.list.size(); ++i) {
        const DoorPortal& p = doors.list[i];
        if (p.mechanism) continue; // створкой владеет машина, не актор
        const float d2 = portal_dist2(p, pos);
        if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
        }
    }
    return best;
}

std::uint32_t door_toggle_near(World& w, Doors& doors, const Registry& reg,
                               LayerId layer, const vec3& pos,
                               std::vector<std::uint32_t>& dirty) {
    const std::uint32_t id = door_query_near(doors, pos);
    if (id == kNoPortal) return kNoPortal;
    const DoorPortal& p = doors.list[id];
    if (door_closed(w, p)) {
        clear_portal(w, p, dirty);
    } else {
        if (body_in_portal(p, reg, layer)) return kNoPortal; // не замуровываем
        stamp_portal(w, p, dirty);
    }
    return id;
}

bool door_close(World& w, const DoorPortal& p, const Registry& reg,
                LayerId layer, std::vector<std::uint32_t>& dirty) {
    if (body_in_portal(p, reg, layer)) return false;
    stamp_portal(w, p, dirty);
    return true;
}

void door_open(World& w, const DoorPortal& p,
               std::vector<std::uint32_t>& dirty) {
    clear_portal(w, p, dirty);
}

} // namespace giga::game

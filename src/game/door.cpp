#include "game/door.h"

#include <cstdio>

#include "ecs/components.h"    // Transform — «тело в проёме»
#include "game/fast_travel.h"  // лифтовые узлы — механизм-створки
#include "game/floor_gen.h"    // floor_doorways, lift_entrance
#include "game/prop_system.h"  // spawn_prop_from_id — обвес кнопки/панели
#include "world/anchor.h"      // anchor_face_pack — честная грань обвеса
#include "world/destruct.h"    // materialize_sub_page, kSubMaterialName
#include "world/surface.h"     // surface_face_at — точка крепления обвеса
#include "world/medium.h"      // medium_recount — агрегат клетки после штампа
#include "world/world.h"

namespace giga::game {

namespace {

// Досягаемость актора до проёма, метры. Та же велечина, что жила у прежней
// системы: тело 0.8 м у клетки 2 м — работать дверью можно из соседней.
constexpr float kDoorReachM = 2.6f;

// Проём-колонна модуля -> группа: клетки с ПОЛНОЙ формой allow (дверь
// занимает весь проём; решётки и частичные формы модуль объявит теми же
// битами, когда возьмётся). Центр ВЫВЕДЕН из клеток — представитель для
// прицела и дистанций.
MaskGroup column_group(std::uint8_t cx, std::uint8_t cy, std::uint8_t cz,
                       std::uint8_t h, CellType mat, std::uint8_t mechanism) {
    MaskGroup g;
    g.props = kMaskDoor;
    g.mat = mat;
    g.mechanism = mechanism;
    SubMask full;
    for (std::size_t wd = 0; wd < kSubMaskWords; ++wd) full.words[wd] = ~0ull;
    for (int z = cz; z < cz + h; ++z)
        g.cells.push_back(MaskCell{
            static_cast<std::uint32_t>(
                macro_index(cx, cy, wrap_macro(z))),
            full});
    g.centre = vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
                    (static_cast<float>(cy) + 0.5f) * kCellSize,
                    (static_cast<float>(cz) + static_cast<float>(h) * 0.5f) *
                        kCellSize};
    return g;
}

bool body_in_portal(const MaskGroup& g, const Registry& reg, LayerId layer) {
    auto view = reg.view<const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const std::uint32_t ci = static_cast<std::uint32_t>(macro_index(
            wrap_macro(static_cast<int>(tr.pos.x / kCellSize)),
            wrap_macro(static_cast<int>(tr.pos.y / kCellSize)),
            wrap_macro(static_cast<int>(tr.pos.z / kCellSize))));
        for (const MaskCell& mc : g.cells)
            if (mc.ci == ci) return true;
    }
    return false;
}

// Обратная macro_index: координаты клетки из ci (x + y*dim + z*dim²).
void cell_coords(std::uint32_t ci, int& x, int& y, int& z) {
    x = static_cast<int>(ci % kMacroDim);
    y = static_cast<int>((ci / kMacroDim) % kMacroDim);
    z = static_cast<int>(ci / (kMacroDim * kMacroDim));
}

float group_dist2(const MaskGroup& g, const vec3& pos) {
    const float dx = wrap_delta_f(pos.x, g.centre.x, kWorldExtent);
    const float dy = wrap_delta_f(pos.y, g.centre.y, kWorldExtent);
    const float dz = wrap_delta_f(pos.z, g.centre.z, kWorldExtent);
    return dx * dx + dy * dy + dz * dz;
}

} // namespace

void door_declare(Doors& doors, const FloorRooms& rooms, int number,
                  const FloorSpec& spec, unsigned seed) {
    doors.list.clear();
    for (auto& l : doors.lift) l = kNoPortal;

    std::vector<Doorway> ways;
    floor_doorways(number, spec, seed, ways);
    // Гермозона — ТЕГ КОМНАТЫ (CANON S12.1/S13.10: kHermeticRoomMask умер
    // вместе с видом комнаты): проём получает гермополотно, когда любая из
    // двух смежных клеток принадлежит комнате с kRoomTagHermetic. Какие
    // комнаты гермо — решает МОДУЛЬ при объявлении (падик метит квартирные
    // листья), не общая таксономия.
    auto hermetic_side = [&](int cx, int cy, int cz) {
        const Room* r = room_of(rooms, room_at(rooms, cx, cy, cz));
        return r != nullptr && (r->tags & kRoomTagHermetic) != 0;
    };

    for (const Doorway& w : ways) {
        // Стороны проёма поперёк его оси; z — воздух его же яруса.
        const bool herm =
            w.axis == 0 ? (hermetic_side(w.cx - 1, w.cy, w.cz) ||
                           hermetic_side(w.cx + 1, w.cy, w.cz))
                        : (hermetic_side(w.cx, w.cy - 1, w.cz) ||
                           hermetic_side(w.cx, w.cy + 1, w.cz));
        doors.list.push_back(column_group(
            w.cx, w.cy, w.cz, w.h,
            herm ? kMatDoorHermetic : kMatDoorSteel, /*mechanism=*/0));
    }

    // Диагностика UX (владелец 2026-08-28 «не вижу табличек»): гистограмма
    // высот — координаты для проверки радиуса в логе.
    {
        int byCz[8] = {0};
        for (const MaskGroup& q : doors.list) {
            const int cz = static_cast<int>(q.centre.z / kCellSize);
            if (cz < 64) ++byCz[cz % 8];
        }
        std::fprintf(stderr,
                     "[door] declared %zu portals; cz%%8 histogram: "
                     "%d %d %d %d %d %d %d %d\n",
                     doors.list.size(), byCz[0], byCz[1], byCz[2], byCz[3],
                     byCz[4], byCz[5], byCz[6], byCz[7]);
    }

    // Лифтовые створки: механизм-группы на проёмах столбов, той же
    // арифметикой, что штамповала геометрию (lift_entrance). Сталь: щит
    // области и так делает их неприкосновенными, гермо-материал не нужен.
    for (int hub = 0; hub < kFastHubsPerFloor; ++hub) {
        std::uint8_t hcx = 0, hcy = 0;
        fast_hub_cell(hub, hcx, hcy);
        const LiftEntrance e = lift_entrance(spec.kind, number, hub, seed);
        const int dx = e.side == 0 ? 1 : e.side == 1 ? -1 : 0;
        const int dy = e.side == 2 ? 1 : e.side == 3 ? -1 : 0;
        doors.lift[hub] = static_cast<std::uint32_t>(doors.list.size());
        doors.list.push_back(column_group(
            static_cast<std::uint8_t>(wrap_macro(hcx + dx)),
            static_cast<std::uint8_t>(wrap_macro(hcy + dy)),
            static_cast<std::uint8_t>(e.h), /*h=*/1, kMatDoorSteel,
            /*mechanism=*/1));
    }
}

bool door_closed(const World& w, const MaskGroup& g) {
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    for (const MaskCell& mc : g.cells) {
        const SubMask& m = w.grid().masks()[mc.ci];
        if (m.empty()) continue;
        // Однородная клетка без страницы: тип и есть материал всей маски.
        const CellType* pg = f ? f->page(mc.ci) : nullptr;
        if (!pg) {
            if (w.grid().types()[mc.ci] != g.mat) continue;
            for (std::size_t wd = 0; wd < kSubMaskWords; ++wd)
                if (m.words[wd] & mc.allow.words[wd]) return true;
            continue;
        }
        for (int b = 0; b < kSubVoxels; ++b)
            if (mc.allow.test(b) && m.test(b) && pg[b] == g.mat) return true;
    }
    return false;
}

namespace {

// Закрыть: материя полотна в каждый СВОБОДНЫЙ субвоксель ФОРМЫ (allow) —
// чужая материя (косяки, вода) не трогается, полотно обтекает её честно.
void stamp_group(World& w, const MaskGroup& g,
                 std::vector<std::uint32_t>& dirty) {
    for (const MaskCell& mc : g.cells) {
        int cx = 0, cy = 0, cz = 0;
        cell_coords(mc.ci, cx, cy, cz);
        SubMask& m = w.grid().mask(cx, cy, cz);
        CellType* pg = materialize_sub_page(w, mc.ci);
        bool wrote = false;
        for (int b = 0; b < kSubVoxels; ++b) {
            if (!mc.allow.test(b)) continue; // не моя форма — не трогаю
            if (m.test(b)) continue;
            if (pg[b] != kCellAir) continue; // среда стоит — не замуровываем
            m.set(b);
            pg[b] = g.mat;
            wrote = true;
        }
        if (m.full()) w.grid().set_cell(cx, cy, cz, g.mat);
        if (wrote) {
            medium_recount(w, mc.ci, pg);
            dirty.push_back(mc.ci);
        }
    }
}

// Открыть: снять ровно СВОИ биты (форма allow + материал полотна). Выбитое
// карвом полотно чинить нечем — снимается что осталось.
void clear_group(World& w, const MaskGroup& g,
                 std::vector<std::uint32_t>& dirty) {
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    for (const MaskCell& mc : g.cells) {
        int cx = 0, cy = 0, cz = 0;
        cell_coords(mc.ci, cx, cy, cz);
        SubMask& m = w.grid().mask(cx, cy, cz);
        CellType* pg = nullptr;
        if (f && f->page(mc.ci)) {
            pg = materialize_sub_page(w, mc.ci);
        } else if (w.grid().types()[mc.ci] == g.mat) {
            // Однородное полотно без страницы (set_cell при full выше).
            pg = materialize_sub_page(w, mc.ci);
        }
        if (!pg) continue;
        bool wrote = false;
        for (int b = 0; b < kSubVoxels; ++b) {
            if (!mc.allow.test(b)) continue;
            if (!m.test(b) || pg[b] != g.mat) continue;
            m.clear(b);
            pg[b] = kCellAir;
            wrote = true;
        }
        if (wrote) {
            if (m.empty()) w.grid().set_cell(cx, cy, cz, kCellAir);
            medium_recount(w, mc.ci, pg);
            dirty.push_back(mc.ci);
        }
    }
}

} // namespace

std::uint32_t door_query_near(const Doors& doors, const vec3& pos) {
    std::uint32_t best = kNoPortal;
    float bestD2 = kDoorReachM * kDoorReachM;
    for (std::uint32_t i = 0; i < doors.list.size(); ++i) {
        const MaskGroup& g = doors.list[i];
        if (g.mechanism) continue; // створкой владеет машина, не актор
        const float d2 = group_dist2(g, pos);
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
    const MaskGroup& g = doors.list[id];
    if (door_closed(w, g)) {
        clear_group(w, g, dirty);
    } else {
        if (body_in_portal(g, reg, layer)) return kNoPortal; // не замуровываем
        stamp_group(w, g, dirty);
    }
    return id;
}

bool door_close(World& w, const MaskGroup& g, const Registry& reg,
                LayerId layer, std::vector<std::uint32_t>& dirty) {
    if (body_in_portal(g, reg, layer)) return false;
    stamp_group(w, g, dirty);
    return true;
}

void door_open(World& w, const MaskGroup& g,
               std::vector<std::uint32_t>& dirty) {
    clear_group(w, g, dirty);
}

// 5c: обвес лифтовых порталов — кнопка вызова СНАРУЖИ у проёма, панель
// ВНУТРИ кабины (оба — пропы-интеракторы строками CSV), и дефолт створок
// «ЗАКРЫТО, пока не вызвал» (решение владельца: вызов открывает вход —
// «лифт приехал»). Кнопка несёт DoorRef на створку СВОЕГО хаба:
// активация ссылкой (S18), деривация хаба из позиции кнопки умерла.
void dress_lift_portals(Registry& reg, World& w, const Doors& doors,
                        int number, const FloorSpec& spec, unsigned seed,
                        LayerId layer, std::vector<std::uint32_t>& dirty) {
    for (int hub = 0; hub < kFastHubsPerFloor; ++hub) {
        if (doors.lift[hub] == kNoPortal) continue;
        const MaskGroup& p = doors.list[doors.lift[hub]];
        // Створка лифта — группа из одной клетки; координаты — из ci.
        int pcx = 0, pcy = 0, pcz = 0;
        cell_coords(p.cells.front().ci, pcx, pcy, pcz);
        const LiftEntrance le = lift_entrance(spec.kind, number, hub, seed);
        const int ox = le.side == 0 ? 1 : le.side == 1 ? -1 : 0;
        const int oy = le.side == 2 ? 1 : le.side == 3 ? -1 : 0;
        const int jx = oy != 0 ? 1 : 0; // вдоль стены кольца
        const int jy = ox != 0 ? 1 : 0;
        // Грань крепления обвеса ВЫВЕДЕНА из стороны проёма (нормаль от
        // опорной стены к вещи = ±ox/±oy), точка — из примитива
        // поверхностей. Прежний `SubVoxelAnchor a{}` оставлял face=0 (грань
        // X+ независимо от стороны) и субвоксель-константу центра клетки —
        // проба живости сканировала НЕ ТУ колонку (таблица S20.7).
        const auto anchor_on = [&w](int cx, int cy, int cz, int nx, int ny,
                                    SubVoxelAnchor& out) {
            const std::uint8_t face =
                anchor_face_pack(nx != 0 ? 0 : 1, nx + ny);
            const SurfaceFace sf =
                surface_face_at(w.grid(), cx, cy, cz, face);
            if (sf.columns == 0) return false; // опора без открытой грани
            const int axis = anchor_face_axis(face);
            out.cx = sf.cx;
            out.cy = sf.cy;
            out.cz = sf.cz;
            out.subX = axis == 0 ? sf.layer : sf.su;
            out.subY = axis == 1 ? sf.layer : (axis == 0 ? sf.su : sf.sv);
            out.subZ = axis == 2 ? sf.layer : sf.sv;
            out.face = face;
            return true;
        };
        // Кнопка: наружная грань косяка рядом с проёмом.
        {
            SubVoxelAnchor a{};
            if (anchor_on(wrap_macro(pcx + jx), wrap_macro(pcy + jy), pcz,
                          ox, oy, a)) {
                const vec3 bp{
                    (static_cast<float>(wrap_macro(pcx + jx)) + 0.5f +
                     static_cast<float>(ox) * 0.62f) * kCellSize,
                    (static_cast<float>(wrap_macro(pcy + jy)) + 0.5f +
                     static_cast<float>(oy) * 0.62f) * kCellSize,
                    (static_cast<float>(pcz) + 0.6f) * kCellSize};
                const Entity btn = spawn_prop_from_id(
                    reg, w, bp, a, PropId::LiftButton, layer);
                if (btn != entt::null)
                    reg.emplace_or_replace<DoorRef>(btn,
                                                    DoorRef{doors.lift[hub]});
            } else {
                std::fprintf(stderr,
                             "[lift] hub %d: у косяка нет открытой грани — "
                             "кнопка не рождена (дефект геометрии обвеса)\n",
                             hub);
            }
        }
        // Панель: стена кабины напротив проёма (нормаль — В кабину).
        {
            std::uint8_t hcx = 0, hcy = 0;
            fast_hub_cell(hub, hcx, hcy);
            SubVoxelAnchor a{};
            if (anchor_on(wrap_macro(hcx - ox), wrap_macro(hcy - oy), pcz,
                          ox, oy, a)) {
                const vec3 pp{
                    (static_cast<float>(hcx) + 0.5f -
                     static_cast<float>(ox) * 0.42f) * kCellSize,
                    (static_cast<float>(hcy) + 0.5f -
                     static_cast<float>(oy) * 0.42f) * kCellSize,
                    (static_cast<float>(pcz) + 0.65f) * kCellSize};
                spawn_prop_from_id(reg, w, pp, a, PropId::LiftPanel, layer);
            } else {
                std::fprintf(stderr,
                             "[lift] hub %d: у стены кабины нет открытой "
                             "грани — панель не рождена\n",
                             hub);
            }
        }
        // Дефолт: створка закрыта (видима сталью — «где дверь» больше не
        // вопрос); тело в проёме — оставим открытой.
        door_close(w, p, reg, layer, dirty);
    }
}

} // namespace giga::game

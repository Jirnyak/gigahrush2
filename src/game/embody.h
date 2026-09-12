// Embodiment — the one seam between the cold alife population ([npcs.md]) and
// the live ECS ([ecs.md]). The world is NOT built around the player: the alife
// pool exists first, and entering a floor *materializes* that floor's slice of
// records into ECS entities. The player is not special — it is simply one of
// those embodied records that additionally gets a CameraTag + Controller.
//
// This module is pure game-layer logic over NpcPool + Registry: no SDL, no
// Vulkan, so it lives in giga_game and is exercised headless by the tests.
//
// Design decisions (see the design form in project history):
//   * No player singleton. `embody_as_player` just flips the NpcPlayer bit on an
//     ordinary record and hangs a camera on its entity. Switching bodies (or
//     dying into a new one) is: fold the old record back, embody the new one as
//     player — the camera then sits at the NEW body's stature automatically.
//   * Physical stature is data. A record's `height_mm` drives the embodied AABB
//     half-height AND, for the player, the camera eye offset, through one shared
//     helper. A child record embodies short and sees low; a tall one sees high.
//   * Embodiment is reversible. hp/inventory stay canonical in the pool row (the
//     entity shares identity by NpcId, systems read the row), so only transient
//     ECS-owned state — position — folds back. `fold_back` writes the record's
//     macro cell and clears NpcEmbodied, freezing it where it stood.
#pragma once

#include <vector>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "world/types.h" // kVoxelSize — вывод kBodyClearanceSub

namespace giga {
class MacroGrid; // world/macro_grid.h — body_wall_adjacent читает маски законом клиренса
}

namespace giga::game {

// Game-layer component: the alife identity behind an embodied entity. Every
// entity produced by embody() carries one, so systems can read the record
// (faction, relations, stats) and fold_back knows which row to write. The
// player entity is just an NpcRef whose record has the NpcPlayer bit.
struct NpcRef {
    NpcId id = kInvalidNpc;
    // Поколение слота НА МОМЕНТ воплощения (E-2 skeleton-anchor, 2026-08-29;
    // образец — Relationship::pad). Голый id — номер слота, а переработка
    // слотов ВЗВЕДЕНА (main.cpp set_recycling): без поколения сущность,
    // пережившая запись (труп, поздний читатель), молча указывала бы на
    // новорождённого наследника слота. Прежняя защита была аргументом «по
    // графу вызовов» — хрупким по собственному признанию.
    std::uint16_t gen = 0;
};

// Жив ли за ссылкой ТОТ ЖЕ житель: слот валиден И поколение совпадает.
// Единственная честная проверка ссылки через время (S20.3); сравнение
// поколений вручную — дефект.
inline bool npc_ref_current(const NpcPool& pool, const NpcRef& ref) {
    return pool.valid(ref.id) && pool.generation(ref.id) == ref.gen;
}

// World units per macro cell (2 m cells; see worldgen). Kept here so embodiment
// can place a record's macro cell into world-space without pulling in app code.
inline constexpr float kEmbodyCellSize = 2.0f;

// A record shorter than this (mm) is treated as unset and embodied at a default
// adult stature, so a zeroed reserve slot still produces a sane body.
inline constexpr std::uint16_t kDefaultHeightMm = 1800; // 1.8 m

// Полуширина коллайдера тела (embody ставит AABB{kBodyHalfWidth, ..., hh}) —
// плечи взрослого ~0.8 м на полный габарит; в отличие от роста, ширина не
// data-driven (одна на всех), поэтому константа живёт здесь, у шва воплощения.
inline constexpr float kBodyHalfWidth = 0.4f;

// Габарит тела для гранного клиренса ([world/clearance.h], эпик occupancy) —
// ВЫВЕДЕН (S11): полная ширина 2·0.4 м / субвоксель kVoxelSize 0.25 м = 3.2,
// потолок → 4 (тело не худеет от округления). Это `size` всех нав-бейков
// этажа — решение владельца 2026-08-26 «один бейк s=4»: мелкие ходоки идут
// по нему консервативно, крупные — по факту жалоб.
inline constexpr float kBodyWidthSub = 2.0f * kBodyHalfWidth / kVoxelSize;
inline constexpr int kBodyClearanceSub =
    static_cast<int>(kBodyWidthSub) +
    (static_cast<float>(static_cast<int>(kBodyWidthSub)) < kBodyWidthSub ? 1
                                                                         : 0);
static_assert(kBodyClearanceSub == 4, "derivation: ceil(0.8 m / 0.25 m) = 4");

// «Стена рядом с телом»: хотя бы одна из четырёх боковых граней клетки тела
// непроходима для габарита kBodyClearanceSub. ЕДИНСТВЕННАЯ проба стены для
// поведения (WallBias-урон Арматуры в combat, прижимной шаг в wander) — была
// двумя дословными дублями по grid.cell != kCellAir, то есть отвечала ТИПОМ
// КЛЕТКИ на локальный вопрос (§60): лепленая стена в клетке «воздух» была
// невидима, а колонна в дальнем углу клетки читалась как стена вплотную.
// Теперь ответ — закон клиренса ([world/clearance.h]) с тем же габаритом,
// которым тело ходит. Боковые оси x/y — как в прежних дублях (вопрос фрейма
// гравитации у этой пробы прежний, не новый).
bool body_wall_adjacent(const MacroGrid& grid, const vec3& pos);

// Convert a record's stature to the collider half-height (world units). Half of
// the height, since the AABB is expressed as half-extents around Transform::pos.
float body_half_height(std::uint16_t height_mm);

// The BODY's own mass in kg, from stature alone: a BMI-style m = 22 * h^2, so a
// 1.75 m adult is ~67 kg and children scale down by the same law.
//
// Exported because it now has TWO callers — `embody` stamps it at birth, and
// [encumbrance.h] recomputes body+load every few ticks — and a physical law with
// two copies is a law that will be retuned in one of them. Same reason
// `floor_room_stride` is exported rather than duplicated ([floor_gen.h]).
float body_mass_kg(std::uint16_t height_mm);

// The eye height for a body of this stature (world units above Transform::pos).
// Eyes sit a little below the crown; whoever holds the camera sees from here.
float body_eye_height(std::uint16_t height_mm);

// Materialize one alife record into a live ECS entity at its macro cell.
// Maps stature -> AABB; hp/inventory stay canonical in the pool row (the entity
// carries an NpcRef back to it). Sets NpcEmbodied. Returns the created entity;
// returns entt::null if id is invalid.
Entity embody(Registry& reg, NpcPool& pool, NpcId id, LayerId layer);

// Embody `id` and additionally attach a CameraTag (eye offset from stature) and
// a Controller, and set the NpcPlayer bit. This is the ONLY thing that makes a
// record "the player" — there is no separate player object.
Entity embody_as_player(Registry& reg, NpcPool& pool, NpcId id, LayerId layer);

// Fold a live entity's transient state back into its record and de-embody it:
// writes the macro cell (and clears NpcEmbodied / NpcPlayer), then destroys the
// entity. Leaves the record otherwise intact and frozen in the cold pool.
// Гейт поколения (E-2): ссылка не текущая (слот переработан, пока сущность
// жила) → строка НЕ пишется — только уничтожение тела. Прежняя сигнатура с
// голым id писала бы координаты в строку наследника слота.
void fold_back(Registry& reg, NpcPool& pool, const NpcRef& ref, Entity e);

// МОГИЛА ДВЕРЕЙ (приказ владельца 2026-08-28): система дверей вырезана
// целиком — терминальный тумблер замков умер с ней. Новая дверь строится
// с нуля («зарастание» субвокселями) обсуждением с владельцем.

} // namespace giga::game

// Supply комнаты — ОСНАЩЕНИЕ и ЗАПАС из мира (CANON S12.4/S12.5).
//
// Предложение комнаты — шесть слагаемых одного вектора; здесь живут два,
// которые считаются из сущностей:
//   ОСНАЩЕНИЕ — Σ глаголов пропов внутри (kPropVerbs, возможность);
//   ЗАПАС     — Σ глаголов предметов, что ЛЕЖАТ (kItemVerbs, ресурс):
//               контейнеры, трупы (труп = проп с контейнером), пикапы на
//               полу. Носимое агентами НЕ считается — оно принадлежит
//               агенту, а не месту (S12.5).
// СРЕДА, ФОРМА и НАРОД — слагаемые других систем (поля, геометрия, толпа);
// приезжают со своими потребителями, не здесь.
//
// Закон счёта (S12.4): «инкрементально, событием, а не опросом» — предмет
// лёг: += ; взят: −= ; проп поставлен/умер: ±вектор. Полный пересчёт
// rooms_supply_rebuild — инициализация на входе на этаж И оракул
// инкрементального пути (гейт: побитово одинаковый вектор).
//
// Pure game-layer: no SDL/Vulkan. Headless-tested (suite_rooms_object).
#pragma once

#include "ecs/registry.h"
#include "game/prop_table.h" // PropId, kPropVerbs
#include "game/room.h"
#include "world/level_stack.h"

namespace giga::game {

// Вклад предмета в ЗАПАС комнаты: countDelta со знаком (лёг +, взят −).
// room == kNoRoom (коридор) — законный no-op: у прохода запаса нет.
void supply_add_item(FloorRooms& fr, RoomId room, std::uint16_t item,
                     int countDelta);

// Вклад пропа в ОСНАЩЕНИЕ: sign +1 поставлен, −1 умер/детачнулся.
void supply_add_prop(FloorRooms& fr, RoomId room, PropId id, int sign);

// Комната клетки, в которой стоит сущность с позицией pos (клетка 2 м).
RoomId room_at_pos(const FloorRooms& fr, const vec3& pos);

// Полный пересчёт ОСНАЩЕНИЯ и ЗАПАСА обходом сущностей слоя: пропы (PropOf),
// контейнеры и трупы (Container), пикапы (Pickup). Зовётся после
// rooms_declare + сидинга на входе; он же — оракул инкрементального пути.
void rooms_supply_rebuild(FloorRooms& fr, Registry& reg, LayerId layer);

// --- живые хуки швов -------------------------------------------------------
// Комнаты активного этажа живут в reg.ctx() (прецедент AnchorBins,
// prop_system.cpp): швы предметов и пропов не тащат FloorRooms через свои
// сигнатуры, а спрашивают контекст. Голый тестовый Registry без комнат —
// законный случай: хук обязан быть no-op, а не требованием.
FloorRooms* rooms_in_ctx(Registry& reg);

// Предмет лёг (+count) / взят (−count) в точке мира — закон S12.4
// «инкрементально, событием»: следующий голодный видит меньшее «есть».
void supply_item_at(Registry& reg, const vec3& pos, std::uint16_t item,
                    int countDelta);

// Проп поставлен (+1) / умер или detach (−1): оснащение комнаты.
void supply_prop_at(Registry& reg, const vec3& pos, PropId id, int sign);

} // namespace giga::game

// ДВЕРЬ = ЗАРАСТАНИЕ ПРОЁМА НАСТОЯЩЕЙ МАТЕРИЕЙ. Система с нуля,
// редакция владельца 2026-08-28 (прежняя вырезана целиком тем же днём —
// прозрачные полотна, синие рамки, отдельная state-машина).
//
// ТРИ ЗАКОНА, из которых всё остальное следует бесплатно:
//
//   1. Запись двери — только ГДЕ и ЧЕМ. Запись — MaskGroup ([world/mask.h],
//      S18: щит и дверь — два свойства ОДНОГО носителя): клетки с
//      субвоксельной формой allow «эти субвоксели мои» + материал полотна —
//      любой ТВЁРДЫЙ материал таблицы. Дверью становится ЛЮБАЯ форма и
//      толщина (владелец 2026-08-28): проём, решётка в один субвоксель,
//      толстая гермодверь, створки ворот — форма это биты allow, толщина
//      это клетки списка. Клетки называет МОДУЛЬ этажа (floor_doorways;
//      лифт объявляет свою створку тем же списком).
//   2. СОСТОЯНИЯ НЕТ. «Закрыта» — производная от мира: в allow-битах стоят
//      субвоксели её материала. Закрыть = заштамповать материю в
//      маску+страницу (тело в проёме — отказ); открыть = снять биты ровно
//      этого материала. Никакого DoorState, HP, сброса на входе:
//      закрытая при уходе дверь закрыта при возврате — снимок этажа несёт
//      её материю, как любую другую.
//   3. Полотно — НАСТОЯЩАЯ материя. Свет, физика, среды, карв, судья и
//      снимок видят его как стену — «прозрачная дверь» невозможна по
//      построению. Разрушимость естественная: полотно карвится по
//      твёрдости своего материала (kMatDoorSteel — упорным карвом;
//      kMatDoorHermetic — kHardnessUnbreakable, гермодверь неразрушима
//      свойством материи, без спец-флагов; полотно под щит-маской не
//      карвится ею же — тот же носитель, другое свойство).
//
// Активаторы агностичны (игрок == НПЦ, никто не особый): интеракция у
// проёма (door_toggle_near) или МЕХАНИЗМ-владелец (лифт: door_close /
// door_open напрямую; mechanism-группы не показываются в промпте и не
// тоглятся акторами). Нав: премисы all-open больше нет — вызывающий
// дренирует dirty-клетки тоггла тем же швом, что карв (патч битсетов,
// зеркало, среды, антураж).
//
// Группы дверей живут в game::Doors (сейв не возит: перештамповка входом,
// S18); щит-группы — в World::masks(), потому что их спрашивает карв.
// Носитель и законы одни; контейнеры — по потребителю.
//
// Pure game-layer: no SDL/Vulkan. Headless-tested (suite_doors).
#pragma once

#include <cstdint>
#include <vector>

#include "core/math.h"           // vec3
#include "ecs/registry.h"        // Registry
#include "game/floor_spec.h"     // FloorSpec
#include "world/level_stack.h"   // LayerId
#include "world/macro_grid.h"    // CellType, kMacroDim
#include "world/mask.h"          // MaskGroup — единый носитель масок (S18)

namespace giga {
class World;
}

namespace giga::game {

inline constexpr std::uint32_t kNoPortal = 0xFFFFFFFFu;

struct Doors {
    std::vector<MaskGroup> list; // props=kMaskDoor; ГДЕ (cells) и ЧЕМ (mat)
    // Лифтовые створки по хабам [0, kFastHubsPerFloor) — индексы в list.
    std::uint32_t lift[4] = {kNoPortal, kNoPortal, kNoPortal, kNoPortal};
};

// Объявить двери этажа: проёмы модуля (floor_doorways; гермо-комнаты
// Living/Medical/Hq получают гермополотно — та же таксономия, что решала
// раньше) + 4 механизм-створки лифтовых столбов (lift_entrance).
// Только список — мир не трогается: полотна там, где их оставила материя.
void door_declare(Doors& doors, int number, const FloorSpec& spec,
                  unsigned seed);

// «Закрыта» — вопрос к миру (закон 2): в allow-битах группы есть
// субвоксели её материала.
bool door_closed(const World& w, const MaskGroup& g);

// Ближайшая НЕ-механизм группа в досягаемости (для промпта), или kNoPortal.
std::uint32_t door_query_near(const Doors& doors, const vec3& pos);

// Тоггл актором у pos: закрытую открыть, открытую закрыть (отказ, если в
// проёме стоит тело). Механизм-группы пропускаются. dirty дополняется
// изменёнными клетками — вызывающий дренирует их швом карва.
// Возвращает индекс группы или kNoPortal (ничего в досягаемости).
std::uint32_t door_toggle_near(World& w, Doors& doors, const Registry& reg,
                               LayerId layer, const vec3& pos,
                               std::vector<std::uint32_t>& dirty);

// Механизм-API (лифт): прямое закрытие/открытие группы.
// door_close отказывает (false), если в проёме тело.
bool door_close(World& w, const MaskGroup& g, const Registry& reg,
                LayerId layer, std::vector<std::uint32_t>& dirty);
void door_open(World& w, const MaskGroup& g,
               std::vector<std::uint32_t>& dirty);

} // namespace giga::game

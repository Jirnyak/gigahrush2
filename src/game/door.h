// ДВЕРЬ = ЗАРАСТАНИЕ ПРОЁМА НАСТОЯЩЕЙ МАТЕРИЕЙ. Система с нуля,
// редакция владельца 2026-08-28 (прежняя вырезана целиком тем же днём —
// прозрачные полотна, синие рамки, отдельная state-машина).
//
// ТРИ ЗАКОНА, из которых всё остальное следует бесплатно:
//
//   1. Запись двери — только ГДЕ и ЧЕМ. Клетки проёма называет МОДУЛЬ
//      этажа (floor_doorways — план проёмов был и остаётся геометрией;
//      лифт объявляет свою створку тем же списком), материал полотна —
//      любой ТВЁРДЫЙ материал таблицы (решение владельца: «двери могут
//      быть из любых субвокселей любых твёрдых материалов»).
//   2. СОСТОЯНИЯ НЕТ. «Закрыта» — производная от мира: в клетках проёма
//      стоят субвоксели её материала. Закрыть = заштамповать материю в
//      маску+страницу (тело в проёме — отказ); открыть = снять биты ровно
//      этого материала. Никакого DoorState, HP, сброса на входе:
//      закрытая при уходе дверь закрыта при возврате — снимок этажа несёт
//      её материю, как любую другую.
//   3. Полотно — НАСТОЯЩАЯ материя. Свет, физика, среды, карв, судья и
//      снимок видят его как стену — «прозрачная дверь» невозможна по
//      построению. Разрушимость естественная: полотно карвится по
//      твёрдости своего материала (kMatDoorSteel — упорным карвом;
//      kMatDoorHermetic — kHardnessUnbreakable, гермодверь неразрушима
//      свойством материи, без спец-флагов; полотно под щитом области
//      ([world/protect.h]) не карвится маской — тоже без флагов).
//
// Активаторы агностичны (игрок == НПЦ, никто не особый): интеракция E у
// проёма (door_toggle_near) или МЕХАНИЗМ-владелец (лифт: door_close /
// door_open напрямую; mechanism-порталы не показываются в промпте и не
// тоглятся акторами). Нав: премисы all-open больше нет — вызывающий
// дренирует dirty-клетки тоггла тем же швом, что карв (патч битсетов,
// зеркало, среды, антураж).
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

namespace giga {
class World;
}

namespace giga::game {

inline constexpr std::uint32_t kNoPortal = 0xFFFFFFFFu;

// ГДЕ и ЧЕМ — вся запись двери (закона 1-2: состояния нет).
struct DoorPortal {
    std::uint8_t cx = 0;  // нижняя клетка проёма, X
    std::uint8_t cy = 0;  // Y
    std::uint8_t cz = 0;  // Z (нижняя)
    std::uint8_t h = 1;   // высота проёма в клетках
    CellType mat = 0;     // материал полотна (любой твёрдый)
    std::uint8_t mechanism = 0; // владелец-машина: не в промпте, актор не тоглит
};

struct Doors {
    std::vector<DoorPortal> list;
    // Лифтовые створки по хабам [0, kFastHubsPerFloor) — индексы в list.
    std::uint32_t lift[4] = {kNoPortal, kNoPortal, kNoPortal, kNoPortal};
};

// Объявить двери этажа: проёмы модуля (floor_doorways; гермо-комнаты
// Living/Medical/Hq получают гермополотно — та же таксономия, что решала
// раньше) + 4 механизм-створки лифтовых столбов (lift_entrance).
// Только список — мир не трогается: полотна там, где их оставила материя.
void door_declare(Doors& doors, int number, const FloorSpec& spec,
                  unsigned seed);

// «Закрыта» — вопрос к миру (закон 2): в клетках проёма есть субвоксели
// её материала.
bool door_closed(const World& w, const DoorPortal& p);

// Ближайший НЕ-механизм портал в досягаемости (для промпта), или kNoPortal.
std::uint32_t door_query_near(const Doors& doors, const vec3& pos);

// Тоггл актором у pos: закрытую открыть, открытую закрыть (отказ, если в
// проёме стоит тело). Механизм-порталы пропускаются. dirty дополняется
// изменёнными клетками — вызывающий дренирует их швом карва.
// Возвращает индекс портала или kNoPortal (ничего в досягаемости).
std::uint32_t door_toggle_near(World& w, Doors& doors, const Registry& reg,
                               LayerId layer, const vec3& pos,
                               std::vector<std::uint32_t>& dirty);

// Механизм-API (лифт): прямое закрытие/открытие портала.
// door_close отказывает (false), если в проёме тело.
bool door_close(World& w, const DoorPortal& p, const Registry& reg,
                LayerId layer, std::vector<std::uint32_t>& dirty);
void door_open(World& w, const DoorPortal& p,
               std::vector<std::uint32_t>& dirty);

} // namespace giga::game

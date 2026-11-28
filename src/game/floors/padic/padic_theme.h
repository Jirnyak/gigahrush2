// PADIC floor module — theme configuration for floor type differentiation.
//
// Solves floor type collapse (matwej.md §4:288-291, §14:7): Residential, Commercial,
// Industrial, Derelict, and Padic all share the padic procedural geometry engine,
// but their structural dimensions, materials, wall breaches, ceiling heights,
// affordances, and prop dressings are parameterized cleanly via PadicTheme.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable.
#pragma once

#include <cstddef>
#include <cstdint>

#include "game/floor_spec.h"   // FloorKind
#include "game/prop_table.h"    // PropId
#include "game/verb_table.h"    // kVerbCount
#include "world/macro_grid.h"   // CellType

namespace giga::game {

// Число ролей листьев плана падика (соответствует padic_gen.cpp kLeaf*):
// 0: Dwelling (основное жилое помещение / торговый зал / заводской пролёт)
// 1: Toilet (санузел / утилитарная зона)
// 2: Kitchen (кухня / кафе / диспетчерская)
// 3: Strip (подсобные помещения лестничной полосы / склады)
inline constexpr std::size_t kPadicLeafRoles = 4;

struct PadicAffordances {
    std::int16_t d[kPadicLeafRoles][kVerbCount] = {};
};

struct PadicTheme {
    FloorKind kind;
    const char* label;

    // 1. Вертикальный шаг и высоты
    int storeyHeight;       // клеток на ярус: 3 (6 м, дефолт) или 6 (12 м, цех)
    int lastBase;           // Z основания последнего яруса: 123 (при h=3) или 120 (при h=6)

    // 2. 2D-планировка (BSP параметры)
    int corridorWidth;      // ширина коридоров: 2 (стандарт) или 4 (широкие торговые пассажи)
    int aptMinSpan;         // минимальный пролёт секции: 9 (квартира), 14 (галерея), 24 (цех)
    int roomMinSpan;        // минимальный пролёт комнаты: 5 (комната), 8 (магазин), 16 (цех)

    // 3. Палитра материалов (из data/materials.csv)
    CellType matFloorMain;  // основной пол: Parquet, SlabTan, Concrete, Rubble
    CellType matFloorAlt;   // пол мокрых зон / подсобок: Lino, Tread, Rust, Rubble
    CellType matWall;       // материал стен: Plaster, FactoryWall, Concrete, Rust
    CellType matCeiling;    // материал потолка: Plaster, SlabTan, FactoryWall, Rust
    CellType matStair;      // материал лестниц: Concrete, Tread, Rubble
    CellType matGrate;      // материал решёток: Tread

    // 4. Специфика коммерции (Commercial)
    float shopfrontProb;    // вероятность остекления витрин (Glass + ShopShutter) вдоль коридора
    bool wideGalleries;     // флаг расширенных галерей со сквозными проходами

    // 5. Специфика промышленности (Industrial)
    bool highCeilings;      // высокие цеха (12 м) с потолочными балками PipeMetal
    bool gantryCatwalks;    // подвесные мостки над цехами (Tread)
    int pillarSpacing;      // шаг опорных колонн 2x2 субвокселя (0 = нет, 8 = через 8 клеток)

    // 6. Специфика заброшенности (Derelict)
    float holeProb;         // вероятность пробития перекрытия блока (0.40f .. 0.85f)
    int holeMinRadius;      // минимальный радиус субдиска дыры в субвокселях (5 .. 8)
    int holeMaxRadius;      // максимальный радиус субдиска дыры в субвокселях (12 .. 22)
    float wallBreachProb;   // вероятность пролома во внутренних стенах (0.0f .. 0.35f)
    float stairBuryProb;    // вероятность завала лестничного пролёта щебнем (0.125f .. 0.60f)
    bool toxicGasInPits;    // шахтный газ ToxicGas вместо чистой воды в колодцах

    // 7. Объявленные глаголы комнат (Affordances)
    PadicAffordances affordances;

    // 8. Каталог мебели модуля (строки props.csv)
    const PropId* furniture;
    std::size_t furnitureCount;
};

// Чистая функция O(1) маппинга темы по виду этажа.
// Для видов, не использующих padic-геометрию (Blame, Khrushi), возвращает безопасный дефолт.
const PadicTheme& padic_theme_for(FloorKind kind);

} // namespace giga::game

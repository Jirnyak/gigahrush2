// ТЕЛЕСНАЯ ПРОХОДИМОСТЬ — может ли ходячее тело занять клетку.
//
// Выживший из room_zone.h (rooms-object F, 2026-08-28): оракул ортогонален
// комнатам и переехал сюда, когда комнаты стали объектами (game/room.h), а
// flow-поля «по виду комнаты» умерли (S13.4 — вторая навигация). Потребители:
// suite_walkbits (пин оракула) и будущий agent-goals (проверка достижимости
// цели телом).
//
// Планка — то, что нужно ТЕЛУ: центрированный след 4x4 субвокселя, чистый по
// нижним 7 суб-слоям (тело 0.4 м полуширины x ~1.7 м, [game/embody.cpp]).
// Это СТРОЖЕ нава и никогда не слабее: всё, что проходимо здесь, проходимо и
// для нава; обратное было бы багом. Закон — чистая функция ОДНОЙ SubMask,
// поэтому весь этаж — битсет 256 КиБ (build_body_walk_bits), а карв клетки —
// O(1) пере-вывод (patch_body_walk_bit), не рескан окрестности.
//
// Pure game-layer: no SDL/Vulkan. Headless-tested (suite_walkbits).
#pragma once

#include <cstddef>

namespace giga {
class MacroGrid;
struct SubMask;   // world/macro_grid.h — закон = чистая функция маски
struct WalkBits;  // world/walk_bits.h — 256 КиБ битсет тела
}

namespace giga::game {

// CAN A WALKING BODY OCCUPY THIS CELL — контракт, не деталь реализации:
// всё, что спрашивает «почему тело сюда не прошло», обязано задать ТОТ ЖЕ
// вопрос, которым пользуется бейк.
bool room_body_walkable(const MacroGrid& grid, int x, int y, int z);

// Тот же закон в форме чистой функции маски — форма, которую требует
// оракульная машинерия WalkBits: bulk-бейк, O(1)-патч и любая проба обязаны
// спрашивать ОДИН предикат, а не три его написания.
bool room_body_walkable_mask(const SubMask& m);

// Заполнить `out` телесным open-set этажа: по одному
// room_body_walkable_mask на клетку. Предикат живёт ЗДЕСЬ, а не в
// world/walk_bits.h, потому что world не видит game: генерический битсет —
// ниже слоевой черты, телесный закон впрыскивается отсюда.
void build_body_walk_bits(const MacroGrid& grid, WalkBits& out);

// O(1) пере-вывод бита одной клетки из её ЖИВОЙ маски — дренаж карва
// (CarveResult::dirtyCells). Отдельно от nav::patch_walk_bit, потому что
// законы разные: клетка с одним вырезанным вокселем меняет бит нава и не
// трогает этот.
void patch_body_walk_bit(WalkBits& bits, std::size_t cell, const SubMask& m);

} // namespace giga::game

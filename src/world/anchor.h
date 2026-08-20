// Якорь — ГРАНЬ клетки воксельного скелета. Примитив движка (S10: «субвоксели
// и якорение в любую грань»), одна кодировка грани и ОДНА проба живости на
// всех потребителей: антураж (провода/тенты — центр грани), пропы (точка
// крепления), дальше контейнеры через «ящик = проп» (S14). Вторая реализация
// любой из двух вещей — дефект (S11); история вопроса и решения владельца
// 2026-08-20 — markoaudit/plans/anchor-unify.md.
#pragma once
#include <cstdint>

#include "world/macro_grid.h"
#include "world/types.h"

namespace giga {

// face = axis*2 + (dir < 0): шесть честных значений, все оси равноправны (S1).
// `dir` — шаг ОТ ОПОРНОЙ КЛЕТКИ к висящей вещи (нормаль крепления); с этой же
// стороны проба сканирует субвоксели опоры. Кодировка пришла из антуража
// (бывшие antourage_face_pack/axis/dir) и стала общей.
inline constexpr std::uint8_t anchor_face_pack(int axis, int dir) {
    return static_cast<std::uint8_t>(axis * 2 + (dir < 0 ? 1 : 0));
}
inline constexpr int anchor_face_axis(std::uint8_t face) { return face / 2; }
inline constexpr int anchor_face_dir(std::uint8_t face) {
    return (face & 1u) ? -1 : 1;
}

// Точка крепления на грани: субвоксель опоры → (u,v) по тангенциальным осям
// грани. Соответствие осей задано face_layer_window (X-грань → (y,z),
// Y-грань → (x,z), Z-грань → (x,y)) и живёт ТОЛЬКО здесь — потребитель
// передаёт свой субвоксель целиком и не знает раскладки.
struct AnchorUV {
    int u, v;
};
inline constexpr AnchorUV anchor_face_uv(std::uint8_t face, int sx, int sy,
                                         int sz) {
    const int axis = anchor_face_axis(face);
    return axis == 0 ? AnchorUV{sy, sz}
                     : (axis == 1 ? AnchorUV{sx, sz} : AnchorUV{sx, sy});
}

// Жив ли якорь: осталась ли материя в КОЛОНКЕ субвокселей у грани крепления,
// окно 2×2 в точке (u,v). Вопрос задаётся маске, не типу клетки — закон двух
// масштабов S2: «клетка стала воздухом» ≠ «опора исчезла», игрокоразмерная
// дыра ровно под вещью оставляет клетку на 90% полной (владелец, live play
// 2026-08-05). Дефолт (u,v) — центр грани: поведение антуража, проверенное
// владельцем на проводах, бит в бит; пропы передают точку крепления.
inline bool anchor_alive(const MacroGrid& g, int x, int y, int z,
                         std::uint8_t face, int u = kSubDim / 2 - 1,
                         int v = kSubDim / 2 - 1) {
    if (g.cell(x, y, z) == kCellAir) return false;
    return g.mask(x, y, z).face_layer_window(anchor_face_axis(face),
                                             anchor_face_dir(face), u, v) >= 0;
}

} // namespace giga

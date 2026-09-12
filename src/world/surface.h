// ЗАПРОС ПОВЕРХНОСТЕЙ — примитив движка (S10, решение владельца 2026-08-20:
// «сразу сейчас»): «дай субвоксельные грани по оси/знаку, удовлетворяющие
// предикату». До него пять сидеров общего кода охотились за поверхностью
// каждый по-своему (настенные — «заподлицо с границей клетки», потолочные —
// lowest_layer_centre + добор бита, мебель — Z-скан) — пять вторых реализаций
// одного вопроса, и парящий щиток у лепленой стены был прямым следствием.
//
// Гранулярность — (клетка, грань) со сводкой по 64 субвоксельным колонкам:
// сидеру нужна панель НА ГРАНЬ, а не на каждый 25-см столбик; представительная
// колонка, слой поверхности и площадь приходят одной записью, и позиция,
// якорь и проба живости выводятся из неё механически — из ОДНОГО источника.
// Словарь грани и колонковая проба — те же, что у якоря ([world/anchor.h]).
#pragma once
#include <cstdint>

#include "core/wrap.h"
#include "world/anchor.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga {

// Одна экспонированная грань опоры.
struct SurfaceFace {
    int cx = 0, cy = 0, cz = 0; // опорная клетка (в ней материя)
    std::uint8_t face = 0;      // нормаль от опоры к воздуху (anchor_face_pack)
    std::uint8_t su = 0, sv = 0; // представительная колонка: экспонированная,
                                 // ближайшая к центру грани (тангенс-оси как в
                                 // anchor_face_uv: X→(y,z), Y→(x,z), Z→(x,y))
    std::uint8_t layer = 0;     // слой поверхности этой колонки вдоль оси, 0..7
    std::uint8_t columns = 0;   // экспонированных колонок из 64 — площадь грани
};

// Точечный запрос: экспонирована ли грань (клетка, face) и где её реальная
// поверхность. columns == 0 — поверхности нет. Колонка экспонирована, когда в
// ней есть материя И перед её первым твёрдым слоем есть воздух: либо
// поверхность утоплена (воздух своей клетки), либо заподлицо — тогда
// примыкающий субвоксель СОСЕДА обязан быть воздухом (иначе грань внутренняя,
// шов двух твёрдых клеток). Клеточный тип не спрашивается нигде, кроме
// пустого фильтра, — вопрос локальный, отвечают атомы (S2).
inline SurfaceFace surface_face_at(const MacroGrid& g, int cx, int cy, int cz,
                                   std::uint8_t face) {
    SurfaceFace out;
    out.cx = wrap_macro(cx);
    out.cy = wrap_macro(cy);
    out.cz = wrap_macro(cz);
    out.face = face;
    const int axis = anchor_face_axis(face);
    const int dir = anchor_face_dir(face);
    const SubMask& m = g.mask(out.cx, out.cy, out.cz);
    // Сосед с воздушной стороны; mask() врапает координаты сам.
    const SubMask& nm = g.mask(out.cx + (axis == 0 ? dir : 0),
                               out.cy + (axis == 1 ? dir : 0),
                               out.cz + (axis == 2 ? dir : 0));
    const int faceLayer = dir > 0 ? kSubDim - 1 : 0; // крайний слой опоры у грани
    const int nTouch = dir > 0 ? 0 : kSubDim - 1;    // примыкающий слой соседа
    int bestD = 255;
    for (int v = 0; v < kSubDim; ++v) {
        for (int u = 0; u < kSubDim; ++u) {
            int s = -1; // первый твёрдый слой колонки со стороны грани
            for (int i = 0; i < kSubDim; ++i) {
                const int l = dir > 0 ? kSubDim - 1 - i : i;
                const int bit = axis == 0   ? sub_bit(l, u, v)
                                : axis == 1 ? sub_bit(u, l, v)
                                            : sub_bit(u, v, l);
                if (m.test(bit)) {
                    s = l;
                    break;
                }
            }
            if (s < 0) continue; // в колонке нет материи
            if (s == faceLayer) {
                const int nbit = axis == 0   ? sub_bit(nTouch, u, v)
                                 : axis == 1 ? sub_bit(u, nTouch, v)
                                             : sub_bit(u, v, nTouch);
                if (nm.test(nbit)) continue; // запечатано соседом — грань внутренняя
            }
            ++out.columns;
            // Представитель — ближайшая к центру грани экспонированная колонка
            // (центра 3.5 в целых нет; метрика на удвоенных координатах).
            const int du = 2 * u - (kSubDim - 1);
            const int dv = 2 * v - (kSubDim - 1);
            const int d = du * du + dv * dv;
            if (d < bestD) {
                bestD = d;
                out.su = static_cast<std::uint8_t>(u);
                out.sv = static_cast<std::uint8_t>(v);
                out.layer = static_cast<std::uint8_t>(s);
            }
        }
    }
    return out;
}

// Полный обход: все экспонированные грани данной оси/знака по всему тору.
// Бейк-тайм, не тик (S9): 128³ клеток × 64 колонки. Предикат (площадь,
// клиренс, материал) — у потребителя: примитив отвечает на вопрос геометрии
// и не несёт политики расстановки (S10).
template <typename F>
inline void for_each_surface(const MacroGrid& g, int axis, int dir, F&& fn) {
    const std::uint8_t face = anchor_face_pack(axis, dir);
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                if (g.cell(x, y, z) == kCellAir) continue; // маска пуста (S2-кэш)
                const SurfaceFace f = surface_face_at(g, x, y, z, face);
                if (f.columns > 0) fn(f);
            }
}

} // namespace giga

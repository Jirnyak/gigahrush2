// Якорь — ГРАНЬ клетки воксельного скелета. Примитив движка (S10: «субвоксели
// и якорение в любую грань»), одна кодировка грани и ОДНА проба живости на
// всех потребителей: антураж (провода/тенты — центр грани), пропы (точка
// крепления), дальше контейнеры через «ящик = проп» (S14). Вторая реализация
// любой из двух вещей — дефект (S11); история вопроса и решения владельца
// 2026-08-20 — markoaudit/plans/anchor-unify.md.
#pragma once
#include <cstdint>

#include "world/destruct.h" // kSubMaterialName — страница материалов для закона опоры
#include "world/macro_grid.h"
#include "world/material_props.h"
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

// ЕДИНАЯ ЗАПИСЬ ЯКОРЯ (CANON S20.2): опорная клетка + субвоксель точки
// крепления + грань. Живёт рядом с пробой, а не у потребителя: её несут
// пропы (ECS-компонент), ОБА конца антуража (D.1: у колена трубы через
// угол каждый конец — своя грань), мировые линки цепей. Вторая запись
// якоря — дефект (S20.8).
struct SubVoxelAnchor {
    int cx = 0, cy = 0, cz = 0;                // опорная макро-клетка (128³)
    std::uint8_t subX = 0, subY = 0, subZ = 0; // субвоксель точки крепления
    std::uint8_t face = 0; // anchor_face_pack(axis, dir) = axis*2 + (dir<0):
                           // 0=X+ 1=X- 2=Y+ 3=Y- 4=Z+ 5=Z-; dir — шаг ОТ
                           // опоры К вещи (нормаль крепления).
};

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
//
// МАСОЧНЫЙ вариант — уровень кэша: он не видит материалов и потому не знает
// закона опоры S20.5. Законен в чисто-масочных мирах (тесты, миры без
// страниц); боевые потребители обязаны звать World-вариант ниже.
inline bool anchor_alive(const MacroGrid& g, int x, int y, int z,
                         std::uint8_t face, int u = kSubDim / 2 - 1,
                         int v = kSubDim / 2 - 1) {
    if (g.cell(x, y, z) == kCellAir) return false;
    return g.mask(x, y, z).face_layer_window(anchor_face_axis(face),
                                             anchor_face_dir(face), u, v) >= 0;
}

// Та же проба + ЗАКОН ОПОРЫ (CANON S20.5, решение владельца 2026-08-29):
// атом ПОДВИЖНОГО материала (material_bears_load == false — рыхлые двойники,
// материя сред) якорь не держит. Вещь, стоящая на куче рубла, мертва: куча
// уедет автоматом, и висеть на ней нельзя было с самого начала.
// Быстрые пути: клетка-воздух и бесстраничная клетка отвечают как масочный
// вариант (материал клетки один, kMatFlow решает за всю колонку разом);
// спуск в атомы — только у страничных клеток. Раскладка (s,a,b)→субвоксель —
// обратная anchor_face_uv, та же, что в face_layer_window.
inline bool anchor_alive(const World& w, int x, int y, int z,
                         std::uint8_t face, int u = kSubDim / 2 - 1,
                         int v = kSubDim / 2 - 1) {
    const std::size_t ci =
        macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
    const CellType base = w.grid().types()[ci];
    if (base == kCellAir) return false;
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    const CellType* pg = (f && f->paged(ci)) ? f->page(ci) : nullptr;
    const int axis = anchor_face_axis(face);
    const int dir = anchor_face_dir(face);
    if (!pg) {
        if (!material_bears_load(base)) return false; // клетка целиком подвижная
        return w.grid().masks()[ci].face_layer_window(axis, dir, u, v) >= 0;
    }
    const SubMask& m = w.grid().masks()[ci];
    const int u0 = u < 0 ? 0 : (u > kSubDim - 2 ? kSubDim - 2 : u);
    const int v0 = v < 0 ? 0 : (v > kSubDim - 2 ? kSubDim - 2 : v);
    for (int i = 0; i < kSubDim; ++i) {
        const int s = dir > 0 ? kSubDim - 1 - i : i;
        for (int a = u0; a <= u0 + 1; ++a)
            for (int b = v0; b <= v0 + 1; ++b) {
                const int bit = axis == 0   ? sub_bit(s, a, b)
                                : axis == 1 ? sub_bit(a, s, b)
                                            : sub_bit(a, b, s);
                if (!m.test(bit)) continue;
                // Маскированный атом со страничным «воздухом» — легаси-
                // десинк писателя (fill_cell мимо страницы): существование
                // по маске (atom_exists), материал — типом клетки.
                CellType mt = pg[bit];
                if (mt == kCellAir) mt = base;
                if (material_bears_load(mt)) return true;
            }
    }
    return false;
}

// Проба ЗАПИСИ якоря — (u,v) выводится из её субвокселя. Единственная
// форма вопроса для всех носителей записи (пропы, концы антуража, линки).
inline bool anchor_alive(const World& w, const SubVoxelAnchor& a) {
    const AnchorUV uv = anchor_face_uv(a.face, a.subX, a.subY, a.subZ);
    return anchor_alive(w, a.cx, a.cy, a.cz, a.face, uv.u, uv.v);
}

// Якорь В ЦЕНТРЕ грани — дефолт антуража (провода/тенты вешаются к центрам
// клеток; поведение проверено владельцем на проводах бит в бит). Центр =
// (kSubDim/2-1)³ — тот же (u,v), что дефолт колонковой пробы.
inline SubVoxelAnchor anchor_centre(int cx, int cy, int cz,
                                    std::uint8_t face) {
    SubVoxelAnchor a;
    a.cx = cx;
    a.cy = cy;
    a.cz = cz;
    a.subX = a.subY = a.subZ = kSubDim / 2 - 1;
    a.face = face;
    return a;
}

} // namespace giga

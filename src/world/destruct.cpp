#include "world/destruct.h"

#include <bit>     // std::countr_zero — перечисление атомов компонента
#include <cstdio>  // отсечка бюджета суда печатается вслух (S11)

#include <algorithm>
#include <cmath>

#include "world/stain.h" // стейн вырезанного атома чистится вместе с ним

namespace giga {
namespace {

// --- packed sub-voxel keys ---------------------------------------------------
// key = macro cell index (21 bits) << 9 | sub bit (9 bits). Fits 30 bits.
// The 9/511 packing below (and the >>/& splits in unpack_key/key_at) is written
// for kSubDim == 8 and ONLY 8 — types.h calls flipping kSubDim a one-line
// change, and for the masks it is, but not here. Pinned so a flip is a compile
// error at the guilty file instead of a silently corrupted carve. [voxels.md]
static_assert(kSubDim == 8,
              "pack_key/unpack_key/key_at hardcode the 8^3 sub-voxel packing");
inline std::uint32_t pack_key(std::uint32_t ci, std::uint32_t bit) {
    return (ci << 9) | bit;
}

struct SubCoord {
    int cx, cy, cz; // macro cell, canonical range
    int sx, sy, sz; // sub-voxel inside the cell
};

inline SubCoord unpack_key(std::uint32_t key) {
    const std::uint32_t ci = key >> 9, bit = key & 511u;
    SubCoord c;
    c.cx = static_cast<int>(ci & 127u);
    c.cy = static_cast<int>((ci >> 7) & 127u);
    c.cz = static_cast<int>(ci >> 14);
    c.sx = static_cast<int>(bit & 7u);
    c.sy = static_cast<int>((bit >> 3) & 7u);
    c.sz = static_cast<int>(bit >> 6);
    return c;
}

// Key from ABSOLUTE sub-voxel coordinates; wraps on the 1024^3 sub torus with
// a mask (power of two).
inline std::uint32_t key_at(int ax, int ay, int az) {
    ax &= kSubGridMask;
    ay &= kSubGridMask;
    az &= kSubGridMask;
    const std::uint32_t ci = static_cast<std::uint32_t>(
        macro_index(ax >> 3, ay >> 3, az >> 3));
    const std::uint32_t bit =
        static_cast<std::uint32_t>(sub_bit(ax & 7, ay & 7, az & 7));
    return pack_key(ci, bit);
}

inline bool solid_key(const MacroGrid& g, std::uint32_t key) {
    return g.masks()[key >> 9].test(static_cast<int>(key & 511u));
}

inline CellType mat_key(const World& w, const SubField<CellType>* mats,
                        std::uint32_t key) {
    const std::size_t ci = key >> 9;
    const CellType base = w.grid().types()[ci];
    return mats ? mats->at(ci, static_cast<int>(key & 511u), base) : base;
}

// Существует ли материя в этом субвокселе — АГНОСТИЧНО к её виду (владелец
// 2026-08-24: «carve просто удаляет субвоксели»). Три представления атома:
//   * бит маски — твёрдый кэш (бетон, легаси-мир без страниц);
//   * страница — материал субвокселя дословно (вода, газ, смешанные клетки);
//   * однородная клетка материи сред без страницы (вода схлопнулась в
//     CellType) — вся клетка материя, маски у неё нет по канону S16.2.
// Немаскированный атом БЕЗ страницы в масочной клетке — уже вырезанный
// (легаси-кодировка «маска главнее»), материей не считается.
inline bool atom_exists(const World& w, const SubField<CellType>* mats,
                        std::uint32_t key) {
    if (solid_key(w.grid(), key)) return true;
    const std::size_t ci = key >> 9;
    if (mats && mats->paged(ci))
        return mats->page(ci)[key & 511u] != kCellAir;
    return w.grid().masks()[ci].empty() &&
           material_is_medium(w.grid().types()[ci]);
}

// Clear one sub-voxel and keep every invariant: the carved atom becomes air in
// the MATERIAL truth too, and the page is shed only when no matter of any kind
// remains — a carved floor bit must not evaporate the puddle sharing its cell
// (это делал старый drop_page по пустой маске). The touched cell is recorded
// for the caller's dirty marks.
// Возвращает «атом ДЕЙСТВИТЕЛЬНО вырезан»: щитовый отказ — false, и caller
// НЕ числит атом в destroyed (прежде carve_sphere/carve_at пушили ДО
// remove_key — частицы летели из целого бетона, detach_sweep сеял от
// несуществующих дыр, счёт возврата врал; ложь CarveResult, S20.7).
inline bool remove_key(World& w, SubField<CellType>* mats,
                       SubField<StainRGB>* stains, std::uint32_t key,
                       std::vector<std::uint32_t>& dirty) {
    const std::uint32_t ci = key >> 9;
    // ЩИТ ([world/mask.h], S18): защищённый АТОМ не меняется никаким
    // писателем геометрии. Гейт стоит в единственной точке выреза атома —
    // обходных путей у карва нет по построению. Отсев субвоксельный:
    // модуль вправе защитить решётку, не целую клетку.
    if (w.masks().shielded(ci, static_cast<int>(key & 511u))) return false;
    const SubCoord c = unpack_key(key);
    SubMask& m = w.grid().mask(c.cx, c.cy, c.cz);
    m.clear(static_cast<int>(key & 511u));
    dirty.push_back(ci);
    CellType* pg = mats ? mats->page(ci) : nullptr;
    // Раскрыть безстраничную клетку ЧЕСТНО (маска -> тип, дыры -> воздух,
    // однородная материя сред -> её материал): вырезанный атом обязан стать
    // воздухом в материальной истине, а не читаться базой, и дыра сразу
    // проходима для автомата.
    if (!pg && mats) pg = materialize_sub_page(w, ci);
    if (pg) {
        pg[key & 511u] = kCellAir;
        CellType uniform;
        if (m.empty() && mats->collapse_if_uniform(ci, &uniform))
            w.grid().set_cell(c.cx, c.cy, c.cz, uniform);
    } else if (m.empty()) {
        w.grid().set_cell(c.cx, c.cy, c.cz, kCellAir);
    }
    // Краска живёт только на материи: стейн вырезанного атома чистится
    // вместе с ним (раньше висел на несуществующем атоме до опустошения
    // клетки — мелкий долг S20.7).
    if (stains && stains->paged(ci)) stains->page(ci)[key & 511u] = StainRGB{};
    return true;
}

// --- visited set over CarveScratch ------------------------------------------
// Flat open addressing (linear probing) on key+1, with a parallel run id so a
// BFS can tell "my own frontier" from "a region an earlier run already judged
// supported". Grows by doubling; wipes only the slots it used, so reuse across
// carves costs O(previous population), not O(table).
class VisitedSet {
public:
    VisitedSet(CarveScratch& s, std::size_t hint) : s_(s) {
        std::size_t want = 64;
        while (want < hint * 4) want <<= 1;
        if (s_.slots.size() < want) {
            s_.slots.assign(want, 0);
            s_.runs.assign(want, 0);
            s_.used.clear();
        } else {
            for (std::uint32_t i : s_.used) s_.slots[i] = 0;
            s_.used.clear();
        }
        mask_ = static_cast<std::uint32_t>(s_.slots.size() - 1);
    }

    // 1 = newly inserted for `run`; 0 = already present with the SAME run;
    // -1 = present from another run (an already-judged, supported region).
    int probe(std::uint32_t key, std::uint32_t run) {
        if ((s_.used.size() + 1) * 2 > s_.slots.size()) grow();
        const std::uint32_t v = key + 1;
        std::uint32_t i = mix(key) & mask_;
        while (true) {
            const std::uint32_t cur = s_.slots[i];
            if (cur == 0) {
                s_.slots[i] = v;
                s_.runs[i] = run;
                s_.used.push_back(i);
                return 1;
            }
            if (cur == v) return s_.runs[i] == run ? 0 : -1;
            i = (i + 1) & mask_;
        }
    }

    // ОТКАТ ПОМЕТОК ОБОРВАННОГО РАНА (охота 2026-08-28). Пометка значит
    // «этот узел уже осуждён как ОПЁРТЫЙ»; ран, оборванный БЮДЖЕТОМ, такого
    // не доказал — он просто сдался, а его пометки заражали всё, что он
    // успел обойти: следующий сид на реально отвязанную нить видел чужую
    // пометку и вешал кусок навсегда (баг владельца «решётки не падают»).
    // Откатываем ровно слоты, добавленные этим раном (used растёт только
    // на вставке — хвост от mark и есть его след).
    void rollback_run(std::size_t usedMark) {
        while (s_.used.size() > usedMark) {
            const std::uint32_t i = s_.used.back();
            s_.used.pop_back();
            s_.slots[i] = 0;
            s_.runs[i] = 0;
        }
    }
    std::size_t used_mark() const { return s_.used.size(); }

private:
    static std::uint32_t mix(std::uint32_t k) {
        k *= 0x9E3779B9u;
        k ^= k >> 16;
        return k;
    }
    void grow() {
        std::vector<std::uint32_t> keys, runs;
        keys.reserve(s_.used.size());
        runs.reserve(s_.used.size());
        for (std::uint32_t i : s_.used) {
            keys.push_back(s_.slots[i] - 1);
            runs.push_back(s_.runs[i]);
        }
        const std::size_t n = s_.slots.size() * 2;
        s_.slots.assign(n, 0);
        s_.runs.assign(n, 0);
        s_.used.clear();
        mask_ = static_cast<std::uint32_t>(n - 1);
        for (std::size_t j = 0; j < keys.size(); ++j) {
            std::uint32_t i = mix(keys[j]) & mask_;
            while (s_.slots[i]) i = (i + 1) & mask_;
            s_.slots[i] = keys[j] + 1;
            s_.runs[i] = runs[j];
            s_.used.push_back(i);
        }
    }

    CarveScratch& s_;
    std::uint32_t mask_ = 0;
};

const int kDir6[6][3] = {{1, 0, 0},  {-1, 0, 0}, {0, 1, 0},
                         {0, -1, 0}, {0, 0, 1},  {0, 0, -1}};

// === ИЕРАРХИЧЕСКИЙ СУДЬЯ СВЯЗНОСТИ (решение владельца 2026-08-26) ==========
//
// Единица флуда — не атом, а УЗЕЛ: 6-связный компонент атомов ОДНОЙ клетки
// (бит-флуд по 8 словам маски, слово = слой sz). Рёбра между узлами — AND
// граневых слоёв масок соседних клеток: точная атомная смежность через шов
// за O(слов). Клетка здесь — ступень ПОИСКА, ответ дают атомы (оговорка S2).
//
// Прежний атомный флуд с лимитом 512 (= одна клетка) объявлял всё большее
// «слишком большим, чтобы быть оторванным» — балка через шов клеток висла в
// воздухе (скриншот владельца 2026-08-25), а ровно-512-атомная опора,
// наоборот, судилась рыхлой. Узловой бюджет (kDetachNodeBudget, вывод в
// [world/destruct.h]) покрывает куски в ~500 раз больше за сопоставимую
// цену: полная клетка — один узел без флуда вовсе, частичная — десятки
// битовых операций вместо 512 хеш-проб.

constexpr std::uint64_t kSxNo7 = 0x7F7F7F7F7F7F7F7Full; // sx<=6 (перед <<1)
constexpr std::uint64_t kSxNo0 = 0xFEFEFEFEFEFEFEFEull; // sx>=1 (перед >>1)
constexpr std::uint64_t kSx7 = ~kSxNo7;
constexpr std::uint64_t kSx0 = ~kSxNo0;
constexpr std::uint64_t kSy7 = 0xFF00000000000000ull;
constexpr std::uint64_t kSy0 = 0x00000000000000FFull;

// Один шаг роста компонента внутри клетки (на месте; сходится к неподвижной
// точке — рост монотонный). Возвращает «изменилось ли».
inline bool comp_grow(std::uint64_t* b, const std::uint64_t* mask) {
    bool changed = false;
    for (int i = 0; i < 8; ++i) {
        std::uint64_t g = ((b[i] & kSxNo7) << 1) | ((b[i] & kSxNo0) >> 1) |
                          (b[i] << 8) | (b[i] >> 8);
        if (i > 0) g |= b[i - 1];
        if (i < 7) g |= b[i + 1];
        g = (b[i] | g) & mask[i];
        if (g != b[i]) {
            b[i] = g;
            changed = true;
        }
    }
    return changed;
}

// ОПОРНАЯ МАСКА КЛЕТКИ (CANON S20.5 «подвижное — не опора», решение
// владельца 2026-08-29): биты твёрдой НЕПОДВИЖНОЙ материи. Атом подвижного
// материала (рыхлые двойники, материя сред — material_bears_load == false)
// в опорный граф не входит: судья не строит из него узлов и не передаёт
// через него связность. Балка, державшаяся только за кучу рубла, рыхлеет
// одним судом; дальнейшее движение кучи ничего не пересуживает — петля
// «дебрис рождает дебрис» разомкнута по построению. Вывод — из параметров
// строки CSV (S16.2), ни флага, ни ветки по имени материала.
void load_bearing_words(const World& w, const SubField<CellType>* mats,
                        std::uint32_t ci, std::uint64_t out[8]) {
    const SubMask& m = w.grid().masks()[ci];
    const CellType* pg = (mats && mats->paged(ci)) ? mats->page(ci) : nullptr;
    if (!pg) {
        // Бесстраничная клетка однородна: kMatFlow решает за все атомы разом.
        const std::uint64_t keep =
            material_bears_load(w.grid().types()[ci]) ? ~std::uint64_t{0}
                                                      : std::uint64_t{0};
        for (int i = 0; i < 8; ++i) out[i] = m.words[i] & keep;
        return;
    }
    const CellType base = w.grid().types()[ci];
    for (int i = 0; i < 8; ++i) {
        std::uint64_t bits = m.words[i], keep = 0;
        while (bits != 0) {
            const int b = std::countr_zero(bits);
            bits &= bits - 1;
            // Маскированный атом со страничным «воздухом» — легаси-десинк
            // писателя (fill_cell пишет тип+маску мимо страницы): для
            // СУЩЕСТВОВАНИЯ маска главнее (atom_exists), для материала
            // честнее всего тип клетки — так и читаем.
            CellType mt = pg[i * 64 + b];
            if (mt == kCellAir) mt = base;
            if (material_bears_load(mt)) keep |= std::uint64_t{1} << b;
        }
        out[i] = keep;
    }
}

// Сброс кэша разбиений на входе развёртки. Кэш жив до конца обхода И ПРИ
// опорном разбиении S20.5, хотя конверсия теперь меняет то, от чего оно
// зависит (материалы): конверсия снимает ЦЕЛЫЙ максимальный связный
// компонент, значит ни один оставшийся компонент не терял опоры через
// него (иначе был бы его частью), а поздний сид, чей флуд дотекает до
// конвертированных узлов кэшированного разбиения, видит их пометки чужого
// рана и корректно скипается как «уже осуждённое».
void part_cache_reset(CarveScratch& s) {
    if (s.cellSlotKey.size() < 16384) {
        s.cellSlotKey.assign(16384, 0);
        s.cellSlotVal.assign(16384, 0);
        s.cellSlotUsed.clear();
    } else {
        for (std::uint32_t i : s.cellSlotUsed) s.cellSlotKey[i] = 0;
        s.cellSlotUsed.clear();
    }
    s.partFirst.clear();
    s.partCount.clear();
    s.compWords.clear();
}

void part_cache_grow(CarveScratch& s) {
    std::vector<std::uint32_t> keys, vals;
    keys.reserve(s.cellSlotUsed.size());
    vals.reserve(s.cellSlotUsed.size());
    for (std::uint32_t i : s.cellSlotUsed) {
        keys.push_back(s.cellSlotKey[i]);
        vals.push_back(s.cellSlotVal[i]);
    }
    const std::size_t n = s.cellSlotKey.size() * 2;
    s.cellSlotKey.assign(n, 0);
    s.cellSlotVal.assign(n, 0);
    s.cellSlotUsed.clear();
    const std::uint32_t mask = static_cast<std::uint32_t>(n - 1);
    for (std::size_t j = 0; j < keys.size(); ++j) {
        std::uint32_t i = (keys[j] * 0x9E3779B9u) >> 3 & mask;
        while (s.cellSlotKey[i]) i = (i + 1) & mask;
        s.cellSlotKey[i] = keys[j];
        s.cellSlotVal[i] = vals[j];
        s.cellSlotUsed.push_back(i);
    }
}

// Разбиение ОПОРНОЙ маски клетки (load_bearing_words, S20.5) на компоненты,
// с кэшем на развёртку. Возвращает entry-индекс (partFirst/partCount).
// Полная опорная клетка — один компонент без флуда: это интерьер стен и
// плит, самый массовый случай обхода опёртого. Клетка из одного рыхлого
// даёт НОЛЬ компонентов — рыхлое не судится (конверсия идемпотентна) и не
// несёт.
std::uint32_t cell_partition(const World& w, const SubField<CellType>* mats,
                             CarveScratch& s, std::uint32_t ci) {
    if ((s.cellSlotUsed.size() + 1) * 2 > s.cellSlotKey.size())
        part_cache_grow(s);
    const std::uint32_t mask =
        static_cast<std::uint32_t>(s.cellSlotKey.size() - 1);
    std::uint32_t i = ((ci + 1) * 0x9E3779B9u) >> 3 & mask;
    while (true) {
        const std::uint32_t k = s.cellSlotKey[i];
        if (k == ci + 1) return s.cellSlotVal[i];
        if (k == 0) break;
        i = (i + 1) & mask;
    }
    std::uint64_t sw[8];
    load_bearing_words(w, mats, ci, sw);
    bool full = true;
    for (int wi = 0; wi < 8 && full; ++wi) full = sw[wi] == ~std::uint64_t{0};
    const std::uint32_t entry = static_cast<std::uint32_t>(s.partFirst.size());
    const std::uint32_t first =
        static_cast<std::uint32_t>(s.compWords.size() / 8);
    std::uint16_t count = 0;
    if (full) {
        for (int wi = 0; wi < 8; ++wi) s.compWords.push_back(~std::uint64_t{0});
        count = 1;
    } else {
        std::uint64_t rest[8];
        for (int wi = 0; wi < 8; ++wi) rest[wi] = sw[wi];
        std::uint64_t comp[8];
        for (;;) {
            int seedW = -1;
            for (int wi = 0; wi < 8; ++wi)
                if (rest[wi] != 0) {
                    seedW = wi;
                    break;
                }
            if (seedW < 0) break;
            for (int wi = 0; wi < 8; ++wi) comp[wi] = 0;
            comp[seedW] = rest[seedW] & (~rest[seedW] + 1); // низший бит
            while (comp_grow(comp, sw)) {
            }
            for (int wi = 0; wi < 8; ++wi) {
                s.compWords.push_back(comp[wi]);
                rest[wi] &= ~comp[wi];
            }
            ++count;
        }
    }
    s.partFirst.push_back(first);
    s.partCount.push_back(count);
    s.cellSlotKey[i] = ci + 1;
    s.cellSlotVal[i] = entry;
    s.cellSlotUsed.push_back(i);
    return entry;
}

// Узел, содержащий данный НЕСУЩИЙ атом: (cell << 8) | локальный индекс
// компонента (компонентов в клетке <= 256 — шахматка одиночек).
// 0xFFFFFFFF — атом не в опорном множестве: воздух ИЛИ подвижный материал
// (S20.5) — такой сид не судится.
std::uint32_t node_of_atom(const World& w, const SubField<CellType>* mats,
                           CarveScratch& s, std::uint32_t key) {
    const std::uint32_t ci = key >> 9;
    const std::uint32_t bit = key & 511u;
    const std::uint32_t e = cell_partition(w, mats, s, ci);
    const std::uint32_t first = s.partFirst[e];
    const int wi = static_cast<int>(bit >> 6);
    const std::uint64_t b = std::uint64_t{1} << (bit & 63u);
    for (std::uint16_t j = 0; j < s.partCount[e]; ++j)
        if (s.compWords[(first + j) * 8 + static_cast<std::uint32_t>(wi)] & b)
            return (ci << 8) | j;
    return 0xFFFFFFFFu;
}

// Отсечки бюджета — вслух (S11), но с дросселем: удар в опёртую стену —
// штатный путь, кричать каждым карвом нельзя.
std::uint32_t g_detachCapEvents = 0;

// Флуд по узлам. true — компонент собран ЦЕЛИКОМ в бюджете (оторван; узлы
// лежат в s.nodeQueue); false — опёрт: слился с уже осуждённым регионом
// или превысил бюджет («сам дом»). Узлы и рёбра — только по ОПОРНОЙ маске
// (cell_partition, S20.5): связность через подвижный атом не течёт.
// why: 0=loose, 1=сид уже помечен, 2=слился с осуждённым, 3=бюджет
bool flood_nodes(const World& w, const SubField<CellType>* mats,
                 VisitedSet& vis, CarveScratch& s, std::uint32_t seedNode,
                 std::uint32_t run, int* why) {
    auto set_why = [&](int v) { if (why) *why = v; };
    set_why(0);
    s.nodeQueue.clear();
    const std::size_t usedMark = vis.used_mark();
    if (vis.probe(seedNode, run) != 1) { set_why(1); return false; }
    s.nodeQueue.push_back(seedNode);
    std::size_t head = 0;
    while (head < s.nodeQueue.size()) {
        const std::uint32_t node = s.nodeQueue[head++];
        const std::uint32_t ci = node >> 8;
        const std::uint32_t e = cell_partition(w, mats, s, ci);
        // Копия слов компонента: cell_partition соседей ниже растит
        // compWords, указатель внутрь вектора пережил бы реаллокацию.
        std::uint64_t cw[8];
        {
            const std::uint64_t* src =
                &s.compWords[(s.partFirst[e] + (node & 255u)) * 8];
            for (int w = 0; w < 8; ++w) cw[w] = src[w];
        }
        const int cx = static_cast<int>(ci & 127u);
        const int cy = static_cast<int>((ci >> 7) & 127u);
        const int cz = static_cast<int>((ci >> 14) & 127u);
        for (int d = 0; d < 6; ++d) {
            const std::size_t nci =
                macro_index(wrap_macro(cx + kDir6[d][0]),
                            wrap_macro(cy + kDir6[d][1]),
                            wrap_macro(cz + kDir6[d][2]));
            // Сырая маска соседа — только ПРЕДФИЛЬТР (надмножество опорной):
            // решает пересечение с его опорными компонентами ниже.
            const SubMask& nm = w.grid().masks()[nci];
            // Граневой слой компонента, сдвинутый в систему соседа, И его
            // маска: точные атомные пары через шов. kDir6 порядок:
            // +x,-x,+y,-y,+z,-z.
            std::uint64_t nb[8] = {};
            std::uint64_t any = 0;
            switch (d) {
            case 0:
                for (int w = 0; w < 8; ++w)
                    any |= nb[w] = ((cw[w] & kSx7) >> 7) & nm.words[w];
                break;
            case 1:
                for (int w = 0; w < 8; ++w)
                    any |= nb[w] = ((cw[w] & kSx0) << 7) & nm.words[w];
                break;
            case 2:
                for (int w = 0; w < 8; ++w)
                    any |= nb[w] = ((cw[w] & kSy7) >> 56) & nm.words[w];
                break;
            case 3:
                for (int w = 0; w < 8; ++w)
                    any |= nb[w] = ((cw[w] & kSy0) << 56) & nm.words[w];
                break;
            case 4:
                any = nb[0] = cw[7] & nm.words[0];
                break;
            case 5:
                any = nb[7] = cw[0] & nm.words[7];
                break;
            }
            if (any == 0) continue;
            const std::uint32_t ne =
                cell_partition(w, mats, s, static_cast<std::uint32_t>(nci));
            const std::uint32_t nfirst = s.partFirst[ne];
            for (std::uint16_t j = 0; j < s.partCount[ne]; ++j) {
                const std::uint64_t* jw = &s.compWords[(nfirst + j) * 8];
                bool touch = false;
                for (int w = 0; w < 8 && !touch; ++w)
                    touch = (jw[w] & nb[w]) != 0;
                if (!touch) continue;
                const std::uint32_t nk =
                    (static_cast<std::uint32_t>(nci) << 8) | j;
                const int r = vis.probe(nk, run);
                if (r == 0) continue;    // свой фронтир
                if (r < 0) { set_why(2); return false; } // слился с осуждённым
                s.nodeQueue.push_back(nk);
            }
        }
        if (static_cast<std::int32_t>(s.nodeQueue.size()) >
            kDetachNodeBudget) {
            ++g_detachCapEvents;
            if (g_detachCapEvents == 1 || (g_detachCapEvents & 1023u) == 0)
                std::fprintf(stderr,
                             "[detach] бюджет суда: компонент > %d узлов — "
                             "считаю опёртым (отсечек всего: %u)\n",
                             kDetachNodeBudget, g_detachCapEvents);
            set_why(3);
            // Ничего не доказано — пометки этого рана снять (см. rollback_run).
            vis.rollback_run(usedMark);
            return false;
        }
    }
    return true;
}

// Конверсия собранного компонента (все узлы s.nodeQueue) в рыхлого двойника
// НА МЕСТЕ (редакция владельца 2026-08-24): те же атомы меняют строку на
// kMatRubbleOf и дальше падают автоматом; маска стоит — двойник твёрд.
void convert_nodes(World& w, SubField<CellType>* mats, CarveScratch& s,
                   CarveResult& out) {
    for (const std::uint32_t node : s.nodeQueue) {
        const std::uint32_t ci = node >> 8;
        // ЩИТ ([world/mask.h]): защищённые атомы не конвертируются в
        // рыхлого двойника — второй (и последний) писатель геометрии после
        // remove_key. Отсев клеточным кэшем; спуск в биты — только в
        // клетках со щитом (частичный щит: незащищённая половина клетки
        // конвертируется честно). Компонент, цепляющийся за щит, опёрт по
        // построению: щит-биты никогда не пустеют.
        const bool cellShielded = w.masks().shielded_cell(ci);
        const std::uint32_t e = cell_partition(w, mats, s, ci); // кэш-хит
        const std::uint32_t base = (s.partFirst[e] + (node & 255u)) * 8;
        bool wrote = false;
        for (int wi = 0; wi < 8; ++wi) {
            std::uint64_t bits = s.compWords[base + static_cast<std::uint32_t>(wi)];
            while (bits != 0) {
                const int b = std::countr_zero(bits);
                bits &= bits - 1;
                const std::uint32_t bit =
                    static_cast<std::uint32_t>(wi * 64 + b);
                if (cellShielded && w.masks().shielded(ci, static_cast<int>(bit)))
                    continue;
                wrote = true;
                const std::uint32_t k = pack_key(ci, bit);
                const CellType src = mat_key(w, mats, k);
                out.detached.push_back(
                    CarvedVoxel{ci, static_cast<std::uint16_t>(bit), src});
                CellType* pg = materialize_sub_page(w, ci);
                pg[bit] = material_rubble_of(src);
            }
        }
        if (wrote) out.dirtyCells.push_back(ci);
    }
}

// Осудить опорные компоненты вокруг атома (cell,bit): сам атом + 6 соседей.
// Так развёртка карва сеяла всегда (соседи удалённого); тем же сидом идёт
// судья шва автомата (сид = изменённый маской атом, S20.5 «сеять от
// изменения»). Каскада после конверсии НЕ нужно по построению: конверсия
// снимает целый максимальный компонент, и терявший через него опору был бы
// его частью (см. part_cache_reset).
void judge_atom_neighbours(World& w, SubField<CellType>* mats, VisitedSet& vis,
                           CarveScratch& s, CarveResult& out,
                           std::uint32_t& run, std::uint32_t cell,
                           std::uint16_t bit, bool dbg) {
    const SubCoord c = unpack_key(pack_key(cell, bit));
    const int ax = c.cx * kSubDim + c.sx;
    const int ay = c.cy * kSubDim + c.sy;
    const int az = c.cz * kSubDim + c.sz;
    static const int kSelf6[7][3] = {{0, 0, 0},  {1, 0, 0},  {-1, 0, 0},
                                     {0, 1, 0},  {0, -1, 0}, {0, 0, 1},
                                     {0, 0, -1}};
    for (const auto& d : kSelf6) {
        const std::uint32_t nk = key_at(ax + d[0], ay + d[1], az + d[2]);
        // May have gone air already — as part of the carve itself.
        if (!solid_key(w.grid(), nk)) continue;
        const std::uint32_t node = node_of_atom(w, mats, s, nk);
        if (node == 0xFFFFFFFFu) continue; // воздух или подвижный (S20.5)
        ++run;
        int why = 0;
        const bool loose = flood_nodes(w, mats, vis, s, node, run, &why);
        if (dbg)
            std::fprintf(
                stderr,
                "[detach-dbg] seed atom (%d,%d,%d) -> node cell (%u,%u,%u) "
                "comp %u: %s\n",
                ax + d[0], ay + d[1], az + d[2], (node >> 8) % kMacroDim,
                ((node >> 8) / kMacroDim) % kMacroDim,
                (node >> 8) / (kMacroDim * kMacroDim), node & 255u,
                loose ? "LOOSE"
                      : (why == 1   ? "seen-seed"
                         : why == 2 ? "merged-judged"
                                    : "budget"));
        if (!loose) continue;
        convert_nodes(w, mats, s, out);
    }
}

// The detachment sweep: seed the node flood from every solid neighbour of
// every sub-voxel the carve removed; convert each fully-enumerated (loose)
// component in place. Runs AFTER all direct removals so a component severed
// by the joint effect of many removed voxels is judged once, against the
// final geometry. `enabled` <= 0 выключает суд (CarveOp::detachLimit).
void detach_sweep(World& w, SubField<CellType>* mats, std::int32_t enabled,
                  CarveScratch& s, CarveResult& out) {
    if (out.destroyed.empty() || enabled <= 0) return;
    part_cache_reset(s);
    VisitedSet vis(s, static_cast<std::size_t>(kDetachNodeBudget) * 2);
    std::uint32_t run = 0;
    static const bool kDbg = std::getenv("GIGA_DETACH_DBG") != nullptr;
    const std::size_t nSeeds = out.destroyed.size();
    for (std::size_t i = 0; i < nSeeds; ++i)
        judge_atom_neighbours(w, mats, vis, s, out, run, out.destroyed[i].cell,
                              out.destroyed[i].bit, kDbg);
}

// СУДЬЯ СВЯЗНОСТИ ПО КЛЕТКАМ (долг автомата, §60/§61-семья): его ходы
// (крошка уехала, одиночка истаяла) рвут мостики без развёртки отвязки.
// Судит каждый ОПОРНЫЙ компонент изменённой клетки тем же узловым флудом;
// клетка из одного рыхлого даёт 0 компонентов и не судится вовсе (S20.5).
void judge_cells(World& w, SubField<CellType>* mats,
                 const std::uint32_t* cells, std::size_t n, CarveScratch& s,
                 CarveResult& out) {
    if (n == 0) return;
    part_cache_reset(s);
    VisitedSet vis(s, static_cast<std::size_t>(kDetachNodeBudget) * 2 + n * 2);
    std::uint32_t run = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        if (ci >= kMacroCells) continue;
        if (w.grid().masks()[ci].empty()) continue;
        const std::uint32_t e = cell_partition(w, mats, s, ci);
        const std::uint16_t cnt = s.partCount[e];
        for (std::uint16_t j = 0; j < cnt; ++j) {
            ++run;
            if (!flood_nodes(w, mats, vis, s, (ci << 8) | j, run, nullptr))
                continue;
            convert_nodes(w, mats, s, out);
        }
    }
}


void finalize_dirty(CarveResult& out) {
    std::sort(out.dirtyCells.begin(), out.dirtyCells.end());
    out.dirtyCells.erase(
        std::unique(out.dirtyCells.begin(), out.dirtyCells.end()),
        out.dirtyCells.end());
}

} // namespace

std::uint32_t carve_hash(std::uint32_t seed, std::uint32_t cell,
                         std::uint32_t bit) {
    std::uint32_t h = seed * 0x9E3779B9u;
    h ^= cell + 0x7F4A7C15u + (h << 6) + (h >> 2);
    h *= 0x85EBCA6Bu;
    h ^= bit + (h << 6) + (h >> 2);
    h *= 0xC2B2AE35u;
    h ^= h >> 16;
    return h;
}

bool carve_roll(std::uint32_t h, std::uint16_t power, std::uint16_t hardness) {
    if (hardness == kHardnessUnbreakable) return false;
    if (hardness == 0) return true;
    // P(remove) = min(1, power / hardness), decided against a 16-bit slice of
    // the hash. power == hardness makes the inequality unconditionally true.
    return static_cast<std::uint64_t>(h & 0xFFFFu) * hardness <
           (static_cast<std::uint64_t>(power) << 16);
}

// ЗАКОН ЧТЕНИЯ БЕЗСТРАНИЧНОЙ КЛЕТКИ (S16.1, единая выписка — двойники:
// materialize_sub_page ниже, classify [render/voxel_mirror.cpp], settle
// [shaders/medium_sim.comp]): маска ПУСТА — вся клетка её типа (однородная
// материя: вода, схлопнутая collapse'ом); маска НЕПУСТА — немаскированный
// атом ВОЗДУХ. Прежнее «немаскированное читается типом» рождало материю из
// ниоткуда: клетка rubble-завала (тип rubble + частичная маска, генераторная
// кодировка) при пробуждении превращалась в полный куб «грязи» — фидбек
// владельца 2026-08-24, скриншот дыры в полу.
CellType sub_material_at(const World& w, int cx, int cy, int cz, int sx,
                         int sy, int sz) {
    const std::size_t ci =
        macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
    const CellType base = w.grid().types()[ci];
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    if (f && f->paged(ci)) return f->page(ci)[sub_bit(sx, sy, sz)];
    const SubMask& m = w.grid().masks()[ci];
    // Пустая маска = «вся клетка своего типа» ТОЛЬКО для материи сред
    // (вода после collapse); у ТВЁРДОГО типа пустая маска значит ВОЗДУХ —
    // карв выбил последний атом (регрессия «вода не течёт вдоль стен»
    // 2026-08-24 родилась ровно из потери этого гейта: материализация
    // заливала такую клетку 511 фантомными бетонными атомами).
    if (m.empty()) return material_is_medium(base) ? base : kCellAir;
    return m.test(sub_bit(sx, sy, sz)) ? base : kCellAir;
}

CellType* materialize_sub_page(World& w, std::size_t ci) {
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    if (CellType* pg = f.page(ci)) return pg;
    const CellType base = w.grid().types()[ci];
    CellType* pg = f.ensure_page(ci, base);
    const SubMask& m = w.grid().masks()[ci];
    // Закон чтения (двойник sub_material_at): немаскированное — ВОЗДУХ;
    // исключение одно — ПУСТАЯ маска у типа-СРЕДЫ (вода после collapse):
    // вся клетка материей. Пустая маска у ТВЁРДОГО типа = выбитая клетка —
    // чистится в воздух (потеря этого гейта в «упрощении» 2026-08-24 и была
    // регрессией «вода не течёт вдоль стен»: карв последнего атома рождал
    // 511 фантомных бетонных атомов).
    const bool uniformMedium = m.empty() && material_is_medium(base);
    if (!m.full() && !uniformMedium)
        for (int b = 0; b < kSubVoxels; ++b)
            if (!m.test(b)) pg[b] = kCellAir;
    return pg;
}

void set_sub_material(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
                      CellType mat) {
    cx = wrap_macro(cx);
    cy = wrap_macro(cy);
    cz = wrap_macro(cz);
    const std::size_t ci = macro_index(cx, cy, cz);
    const CellType base = w.grid().types()[ci];
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    if (!f.paged(ci) && mat == base &&
        w.grid().masks()[ci].test(sub_bit(sx, sy, sz)))
        return; // масочный атом базы — истина уже такая, страница не нужна
    CellType* pg = materialize_sub_page(w, ci);
    pg[sub_bit(sx, sy, sz)] = mat;
    CellType uniform;
    // If the write left the whole cell one material again, fold it back into
    // the plain per-cell type and shed the page.
    if (f.collapse_if_uniform(ci, &uniform))
        w.grid().set_cell(cx, cy, cz, uniform);
}

std::int32_t carve_sphere(World& w, const CarveOp& op, CarveScratch& scratch,
                          CarveResult& out) {
    out.clear();
    if (op.radius <= 0.0f || op.power == 0) return 0;
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);
    SubField<StainRGB>* stains =
        w.subfields().find<StainRGB>(kStainFieldName);

    // Work in sub-voxel units. The unwrapped distance inside the iteration box
    // is exact as long as the sphere fits inside a half-torus; clamp far below
    // that (a quarter world = 64 m radius) so the box never self-overlaps.
    const float inv = 1.0f / kVoxelSize;
    const float cx = op.x * inv, cy = op.y * inv, cz = op.z * inv;
    const float r =
        std::min(op.radius * inv, static_cast<float>(kSubGridDim) * 0.25f);
    const float r2 = r * r;
    const int lo[3] = {static_cast<int>(std::floor(cx - r)),
                       static_cast<int>(std::floor(cy - r)),
                       static_cast<int>(std::floor(cz - r))};
    const int hi[3] = {static_cast<int>(std::ceil(cx + r)),
                       static_cast<int>(std::ceil(cy + r)),
                       static_cast<int>(std::ceil(cz + r))};

    for (int az = lo[2]; az <= hi[2]; ++az) {
        const float dz = (static_cast<float>(az) + 0.5f) - cz;
        for (int ay = lo[1]; ay <= hi[1]; ++ay) {
            const float dy = (static_cast<float>(ay) + 0.5f) - cy;
            for (int ax = lo[0]; ax <= hi[0]; ++ax) {
                const float dx = (static_cast<float>(ax) + 0.5f) - cx;
                const float d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= r2) continue;
                const std::uint32_t key = key_at(ax, ay, az);
                // АГНОСТИЧНО к виду материи (владелец 2026-08-24): бетон,
                // вода, газ — один ролл, различие только в твёрдости строки.
                if (!atom_exists(w, mats, key)) continue;
                const CellType mat = mat_key(w, mats, key);
                const std::uint16_t hardness = material_hardness(mat);
                if (hardness == kHardnessUnbreakable) continue;
                // Quadratic falloff: full power at the centre, zero at the
                // rim. Stays within uint16 because the scale factor is <= 1.
                const std::uint16_t peff = static_cast<std::uint16_t>(
                    static_cast<float>(op.power) * (r2 - d2) / r2);
                if (peff == 0) continue;
                const std::uint32_t ci = key >> 9;
                if (!carve_roll(carve_hash(op.seed, ci, key & 511u), peff,
                                hardness))
                    continue;
                // Учёт — ПОСЛЕ выреза: щитовый отказ не числится дырой.
                if (!remove_key(w, mats, stains, key, out.dirtyCells))
                    continue;
                out.destroyed.push_back(CarvedVoxel{
                    ci, static_cast<std::uint16_t>(key & 511u), mat});
            }
        }
    }

    detach_sweep(w, mats, op.detachLimit, scratch, out);
    finalize_dirty(out);
    return static_cast<std::int32_t>(out.destroyed.size() +
                                     out.detached.size());
}

std::int32_t detach_scan(World& w, int cx, int cy, int cz, int sx, int sy,
                         int sz, CarveScratch& scratch, CarveResult& out) {
    out.clear();
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);
    const std::uint32_t key =
        key_at(wrap_macro(cx) * kSubDim + sx, wrap_macro(cy) * kSubDim + sy,
               wrap_macro(cz) * kSubDim + sz);
    if (!solid_key(w.grid(), key)) return 0;
    part_cache_reset(scratch);
    VisitedSet vis(scratch, static_cast<std::size_t>(kDetachNodeBudget) * 2);
    const std::uint32_t node = node_of_atom(w, mats, scratch, key);
    if (node == 0xFFFFFFFFu) return 0;
    if (!flood_nodes(w, mats, vis, scratch, node, /*run=*/1, nullptr))
        return 0;
    convert_nodes(w, mats, scratch, out);
    finalize_dirty(out);
    return static_cast<std::int32_t>(out.detached.size());
}

bool carve_at(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
              std::uint16_t power, std::uint32_t seed, CarveScratch& scratch,
              CarveResult& out) {
    out.clear();
    const std::uint32_t ci = static_cast<std::uint32_t>(
        macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz)));
    const std::uint32_t bit =
        static_cast<std::uint32_t>(sub_bit(sx, sy, sz));
    const std::uint32_t key = pack_key(ci, bit);
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);
    SubField<StainRGB>* stains =
        w.subfields().find<StainRGB>(kStainFieldName);
    if (!atom_exists(w, mats, key)) return false;
    const CellType mat = mat_key(w, mats, key);
    if (!carve_roll(carve_hash(seed, ci, bit), power, material_hardness(mat)))
        return false;
    // Учёт — ПОСЛЕ выреза: щитовый отказ не числится дырой (S18/S20.7).
    if (!remove_key(w, mats, stains, key, out.dirtyCells)) return false;
    out.destroyed.push_back(
        CarvedVoxel{ci, static_cast<std::uint16_t>(bit), mat});
    detach_sweep(w, mats, /*enabled=*/1, scratch, out);
    finalize_dirty(out);
    return true;
}

std::int32_t detach_judge_cells(World& w, const std::uint32_t* cells,
                                std::size_t n, CarveScratch& scratch,
                                CarveResult& out) {
    out.destroyed.clear();
    out.detached.clear();
    out.dirtyCells.clear();
    SubField<CellType>* mats =
        w.subfields().find<CellType>(kSubMaterialName);
    judge_cells(w, mats, cells, n, scratch, out);
    finalize_dirty(out);
    return static_cast<std::int32_t>(out.detached.size());
}

void collect_mobile_support_cells(const World& w,
                                  std::vector<std::uint32_t>& out) {
    out.clear();
    const SubField<CellType>* mats =
        w.subfields().find<CellType>(kSubMaterialName);
    // Плоский битсет пометок: клетка + 6 соседей, дубли гасятся даром.
    static_assert(kMacroCells % 64 == 0, "битсет пометок словами");
    std::vector<std::uint64_t> marked(kMacroCells / 64, 0);
    auto mark = [&](int x, int y, int z) {
        const std::size_t ci =
            macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
        marked[ci >> 6] |= std::uint64_t{1} << (ci & 63u);
    };
    for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
        const SubMask& m = w.grid().masks()[ci];
        bool mobile = false;
        if (m.empty()) {
            // Пустая маска = вся клетка типа только у материи сред (закон
            // чтения) — это и есть однородная жидкость/газ.
            mobile = material_is_medium(w.grid().types()[ci]);
        } else if (mats && mats->paged(ci)) {
            const CellType* pg = mats->page(ci);
            for (int wi = 0; wi < 8 && !mobile; ++wi) {
                std::uint64_t bits = m.words[wi];
                while (bits != 0) {
                    const int b = std::countr_zero(bits);
                    bits &= bits - 1;
                    const CellType mt = pg[wi * 64 + b];
                    if (mt != kCellAir && !material_bears_load(mt)) {
                        mobile = true;
                        break;
                    }
                }
            }
        } else {
            mobile = !material_bears_load(w.grid().types()[ci]);
        }
        if (!mobile) continue;
        const int x = static_cast<int>(ci & 127u);
        const int y = static_cast<int>((ci >> 7) & 127u);
        const int z = static_cast<int>(ci >> 14);
        mark(x, y, z);
        mark(x + 1, y, z);
        mark(x - 1, y, z);
        mark(x, y + 1, z);
        mark(x, y - 1, z);
        mark(x, y, z + 1);
        mark(x, y, z - 1);
    }
    for (std::uint32_t wi = 0; wi < kMacroCells / 64; ++wi) {
        std::uint64_t bits = marked[wi];
        while (bits != 0) {
            const int b = std::countr_zero(bits);
            bits &= bits - 1;
            out.push_back(wi * 64 + static_cast<std::uint32_t>(b));
        }
    }
}

} // namespace giga

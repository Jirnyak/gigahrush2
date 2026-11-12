#include "world/floor_awaken.h"

#include <bit> // countr_zero — НЕ __builtin_ctzll: тот ломал сборку под MSVC
#include <chrono>
#include <vector>

#include "core/jobs.h"        // parallel_for — рождение этажа, время бейка
#include "world/destruct.h"   // kSubMaterialName, settle_sub_page
#include "world/gravity.h"    // regime_down — ось низа для аудита маски
#include "world/medium.h"     // medium_digest_* — тот же разбор, что у шва
#include "world/subfield.h"
#include "world/types.h"

namespace giga {

FloorAwakenStats floor_awaken(World& w) {
    const auto t0 = std::chrono::steady_clock::now();
    FloorAwakenStats st;

    SubField<CellType>& mats =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    // Поля создаём ДО параллели: get_or_create трогает реестр полей, и делать
    // это из воркеров значило бы гонку на самом реестре.
    std::uint32_t* lvl = medium_level_field(w).data().data();
    std::uint8_t* mob = medium_mobile_field(w).data().data();
    const std::vector<CellType>& types = w.grid().types();
    const std::vector<SubMask>& masks = w.grid().masks();

    // Однородные страницы копим битсетом, а не списком: слово принадлежит
    // ровно одному воркеру (срез z кратен 64 клеткам), значит запись
    // дизъюнктна и результат бит-идентичен расписанию потоков.
    static_assert(kMacroCells % 64 == 0, "срез z не делит слово");
    std::vector<std::uint64_t> uniformBits(kMacroCells / 64, 0ull);
    std::uint64_t* ub = uniformBits.data();

    constexpr int kSlice = kMacroDim * kMacroDim;
    parallel_for(kMacroDim, [&](int z) {
        const std::size_t lo = static_cast<std::size_t>(z) * kSlice;
        for (std::size_t ci = lo; ci < lo + kSlice; ++ci) {
            const CellType* pg = mats.page(ci);
            if (!pg) {
                const MediumDigest d = medium_digest_uniform(types[ci], masks[ci]);
                lvl[ci] = d.liq | (d.gas << 16);
                mob[ci] = d.mobile ? 1u : 0u;
                continue;
            }
            const MediumDigest d = medium_digest_page(pg);
            lvl[ci] = d.liq | (d.gas << 16);
            mob[ci] = d.mobile ? 1u : 0u;
            // Однородность — тем же единственным проходом по странице, что и
            // агрегаты: второго цикла по 512 атомам здесь быть не должно.
            bool uniform = true;
            for (int b = 1; b < kSubVoxels; ++b)
                if (pg[b] != pg[0]) {
                    uniform = false;
                    break;
                }
            if (uniform) ub[ci >> 6] |= 1ull << (ci & 63u);
        }
    });

    // Счёт страниц и схлопывание — серийно: свободный список SubField один на
    // этаж, и тип клетки правит тот же вызов.
    for (std::size_t ci = 0; ci < kMacroCells; ++ci) {
        if (mats.paged(ci)) ++st.paged;
        if (mob[ci]) ++st.mobile;
    }
    for (std::size_t wi = 0; wi < uniformBits.size(); ++wi) {
        std::uint64_t word = uniformBits[wi];
        while (word) {
            const int b = std::countr_zero(word);
            word &= word - 1;
            if (settle_sub_page(w, (wi << 6) + static_cast<std::size_t>(b)))
                ++st.settled;
        }
    }
    // КОМПАКТ ПУЛА — сразу за схлопыванием, тем же серийным участком:
    // потребители гонят пул по page_count() (верхняя вода), а не по занятым,
    // и без компакта только что освобождённые сотни тысяч слотов (floor 6 —
    // 649k) ехали бы в каждую заливку зеркала и сидели в ОЗУ до смерти
    // слота. Дыры от живого settle душит та же точка: рождение —
    // единственный массовый освободитель, и после него пул плотный
    // (page_count == pages_in_use — гейт аудита страниц).
    mats.compact();

    st.ms = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - t0)
                .count();
    return st;
}

std::size_t settle_uniform_pages(World& w) {
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);
    if (!mats) return 0;
    std::size_t settled = 0;
    // Серийно: путь фонового кодека, не кадра; settle_sub_page правит общий
    // свободный список — тот же довод, что у серийного схлопывания рождения.
    for (std::size_t ci = 0; ci < kMacroCells; ++ci)
        if (mats->paged(ci) && settle_sub_page(w, ci)) ++settled;
    return settled;
}

MaskAuditStats audit_mask_law(const World& w) {
    MaskAuditStats st;
    const SubField<CellType>* mats =
        w.subfields().find<CellType>(kSubMaterialName);
    const std::vector<CellType>& types = w.grid().types();
    const std::vector<SubMask>& masks = w.grid().masks();
    auto solid = [](CellType m) {
        return m != kCellAir && material_phase(m) == MatPhase::Solid;
    };
    const CellStep down = regime_down(w.gravity().regime);
    // Серийно: путь прибора и гейта, не кадра.
    for (std::size_t ci = 0; ci < kMacroCells; ++ci) {
        const int cx = static_cast<int>(ci % kMacroDim);
        const int cy = static_cast<int>((ci / kMacroDim) % kMacroDim);
        const int cz = static_cast<int>(ci / (kMacroDim * kMacroDim));
        const SubMask& mk = masks[ci];
        const CellType* pg = mats ? mats->page(ci) : nullptr;
        std::size_t ghost = 0;
        if (!pg) {
            // Бесстраничная: маскированный атом есть тип клетки.
            if (mk.empty() || solid(types[ci])) continue;
            for (int b = 0; b < kSubVoxels; ++b)
                if (mk.test(b)) ++ghost;
        } else {
            for (int b = 0; b < kSubVoxels; ++b) {
                const CellType m = pg[b];
                const bool bit = mk.test(b);
                const bool s = solid(m);
                if (bit && !s) ++ghost;
                if (!s) continue;
                if (material_is_medium(m)) {
                    ++st.loose;
                    if (!bit) {
                        ++st.loose_unlaid;
                        // Сосед по оси низа: глобальная суб-координата с
                        // заворотом тора.
                        const int gx = (cx * kSubDim + (b % kSubDim) + down.x) &
                                       (kMacroDim * kSubDim - 1);
                        const int gy = (cy * kSubDim +
                                        ((b / kSubDim) % kSubDim) + down.y) &
                                       (kMacroDim * kSubDim - 1);
                        const int gz = (cz * kSubDim +
                                        (b / (kSubDim * kSubDim)) + down.z) &
                                       (kMacroDim * kSubDim - 1);
                        const std::size_t nci = macro_index(
                            gx / kSubDim, gy / kSubDim, gz / kSubDim);
                        const int nb = (gx % kSubDim) +
                                       (gy % kSubDim) * kSubDim +
                                       (gz % kSubDim) * kSubDim * kSubDim;
                        if (masks[nci].test(nb)) ++st.loose_unlaid_supported;
                    }
                } else if (!bit) {
                    ++st.static_unmasked;
                }
            }
        }
        st.ghost_bits += ghost;
        if (ghost != 0) ++st.ghost_cells;
    }
    return st;
}

bool cell_full_static(const World& w, std::uint32_t ci) {
    return w.grid().masks()[ci].full() &&
           !material_is_medium(w.grid().types()[ci]);
}

std::size_t open_frontier_cube(World& w, std::uint32_t ci,
                               std::vector<std::uint32_t>* opened) {
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    const int cx = static_cast<int>(ci % kMacroDim);
    const int cy = static_cast<int>((ci / kMacroDim) % kMacroDim);
    const int cz = static_cast<int>(ci / (kMacroDim * kMacroDim));
    std::size_t pages = 0;
    for (int dz = -kFrontierRadius; dz <= kFrontierRadius; ++dz)
        for (int dy = -kFrontierRadius; dy <= kFrontierRadius; ++dy)
            for (int dx = -kFrontierRadius; dx <= kFrontierRadius; ++dx) {
                const auto ci2 = static_cast<std::uint32_t>(macro_index(
                    wrap_macro(cx + dx), wrap_macro(cy + dy),
                    wrap_macro(cz + dz)));
                if (f.paged(ci2)) continue;
                // Полная СТАТИКА страницы не получает (входа материи нет);
                // полный РЫХЛЫЙ — получает: он поедет целиком.
                if (cell_full_static(w, ci2)) continue;
                materialize_sub_page(w, ci2);
                if (opened) opened->push_back(ci2);
                ++pages;
            }
    return pages;
}

FloorFrontierStats floor_open_frontier(World& w) {
    const auto t0 = std::chrono::steady_clock::now();
    FloorFrontierStats st;
    // Источники — ровно те, кого разбудит будильник этажа ([app] блок смены
    // слоя: клетки с подвижной материей, кроме полной статики), и в том же
    // порядке. Серийно: материализация растит общий пул страниц.
    const std::uint8_t* mob = medium_mobile_data(w);
    if (!mob) return st;
    for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
        if (mob[ci] == 0u || cell_full_static(w, ci)) continue;
        ++st.sources;
        st.pages += open_frontier_cube(w, ci, nullptr);
    }
    st.ms = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - t0)
                .count();
    return st;
}

PageAuditStats audit_sub_pages(const World& w) {
    PageAuditStats st;

    const SubField<CellType>* mats =
        w.subfields().find<CellType>(kSubMaterialName);
    // Поля нет — страниц нет, инвариант держится тривиально. Это НЕ повод
    // молчать в тесте: там проверяется ещё и paged_cells, и ноль страниц на
    // сцене, где их ждут, виден по нему.
    if (!mats) return st;

    st.pages_in_use = mats->pages_in_use();
    st.page_slots = mats->page_count();

    // Серийно и без parallel_for: обход читает только pageOf_ и по одному биту
    // сравнения на страницу, стоит микросекунды на пустом этаже, а параллель
    // здесь дала бы гонку на счётчиках ради выигрыша, которого нет. Аудит —
    // путь гейта и диагностики, не кадра.
    for (std::size_t ci = 0; ci < kMacroCells; ++ci) {
        const CellType* pg = mats->page(ci);
        if (!pg) continue;
        ++st.paged_cells;
        bool uniform = true;
        for (int b = 1; b < kSubVoxels; ++b)
            if (!(pg[b] == pg[0])) {
                uniform = false;
                break;
            }
        // Однородна по паре (материал, бит) — тот же предикат, что у свёртки:
        // однородная страница рыхлого с частичной маской законна (S16.10).
        if (uniform && uniform_mask(w.grid().masks()[ci])) ++st.uniform_paged;
    }

    // Слот занят пулом, но ни одна клетка на него не смотрит и в свободном
    // списке его нет. pages_in_use() == pages_.size() - free_.size(), поэтому
    // разность с числом ссылающихся клеток и есть потерянные слоты. Знак
    // проверяем: обратное неравенство означало бы, что две клетки делят слот —
    // это нарушение другого рода, и его надо увидеть, а не схлопнуть в ноль
    // беззнаковым вычитанием.
    if (st.pages_in_use > st.paged_cells)
        st.orphan_slots = st.pages_in_use - st.paged_cells;
    else if (st.paged_cells > st.pages_in_use)
        // Клеток со страницей БОЛЬШЕ, чем занято слотов — значит слот
        // переиспользован двумя клетками. Считаем нарушением того же счёта:
        // тест обязан покраснеть, а не увидеть ноль.
        st.orphan_slots = st.paged_cells - st.pages_in_use;

    return st;
}

} // namespace giga

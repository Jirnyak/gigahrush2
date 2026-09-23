#include "world/floor_awaken.h"

#include <bit> // countr_zero — НЕ __builtin_ctzll: тот ломал сборку под MSVC
#include <chrono>
#include <vector>

#include "core/jobs.h"        // parallel_for — рождение этажа, время бейка
#include "world/destruct.h"   // kSubMaterialName, settle_sub_page
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

    st.ms = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - t0)
                .count();
    return st;
}

} // namespace giga

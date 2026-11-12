// ДОЛГ ПИСАТЕЛЯ ГЕОМЕТРИИ — СУД НАД ТАБЛИЦЕЙ ([game/geom_writer.h], CANON S20.4).
//
// ЧТО ЭТОТ ФАЙЛ ОБЯЗАН ЗАРАБОТАТЬ, одной фразой: **кто бы ни писал в мир, его
// долг перед производными мира следует из трёх фактов о записи, и ни один
// писатель не может тихо недоплатить.**
//
// ПОЧЕМУ МАТРИЦА ВЫПИСАНА РУКОЙ ВТОРОЙ РАЗ. Долг ВЫВОДИТСЯ функцией
// `geom_debt` из строки писателя, и проверять вывод тем же выводом значило бы
// сверять функцию с собой. Здесь стоит ОЖИДАНИЕ — та самая таблица «писатель ×
// слагаемое», которую канон S20.4 называет законом, — и любое изменение
// строки или правила вывода обязано прийти сюда второй, сознательной правкой.
//
// ЧТО БЫЛО ДО ТАБЛИЦЫ (перепись 2026-11-12): семь хвостов в `app/main.cpp`,
// каждый перечислял долг руками. Расхождения, которые эта матрица закрывает:
//   * дверь не чинила поле излучателей;
//   * кисть не будила тела, не рвала якоря и антураж, не сообщала диффузии;
//   * автомат среды не сообщал диффузии, что куча перекрыла проход;
//   * оба суда оставляли лампой материю, обращённую в осыпь.
//
// ЧЕГО ЭТОТ ФАЙЛ НЕ ВИДИТ, и это названо: что исполнитель (`geometry_changed`
// в `app/main.cpp`) долг действительно ПЛАТИТ. Исполнитель живёт в приложении
// и headless не собирается; его сторожит правило `source_rules` «вызов каждого
// слагаемого долга встречается в main.cpp ровно один раз» — второй хвост
// писателя краснит ctest, не дожидаясь, пока перечни разъедутся снова.
#include <cstddef>
#include <cstdint>

#include "game/geom_writer.h"
#include "game/mask_churn.h"
#include "world/types.h"

// ПЕРЕПИСЬ «ГДЕ МЕНЯЮТСЯ МАСКИ» ([game/mask_churn.h]) — прибор, по которому
// будут менять закон материи, обязан быть судим: три версии причины
// («кольцо тора», «переходный процесс», «возня на месте») он различает
// числами, и каждое из этих чисел проверено на сцене, где ответ известен.
static void test_mask_churn() {
    using namespace giga;
    using namespace giga::game;
    const auto cell = [](int x, int y, int z) {
        return static_cast<std::uint32_t>(macro_index(x, y, z));
    };
    { // КОЛЬЦО: одна колонна, все 128 слоёв оси Z, поток ровный
        MaskChurn c;
        for (int z = 0; z < kMacroDim; ++z) {
            const std::uint32_t ci = cell(10, 20, z);
            mask_churn_add(c, &ci, 1, /*axis=*/2,
                           static_cast<std::uint64_t>(z) * 8u);
        }
        // ...и возня на месте в другой колонне: три клетки, много записей.
        const std::uint32_t spot[3] = {cell(50, 50, 7), cell(50, 50, 8),
                                       cell(50, 50, 9)};
        for (int k = 0; k < 40; ++k)
            mask_churn_add(c, spot, 3, 2, static_cast<std::uint64_t>(k) * 25u);
        const MaskChurnSummary s = mask_churn_summary(c);
        CHECK(s.records == 128u + 120u);
        CHECK(s.cells == 131u);      // разных клеток — без повторов
        CHECK(s.columns == 2u);
        CHECK(s.through == 1u);      // сквозная только первая
        CHECK(s.depthsUsed == 128u);
        CHECK(s.flowFirst + s.flowLast == 248u);
    }
    { // ОСЬ НИЗА — ИЗ ФРЕЙМА: тот же столб клеток вдоль X под осью Z даёт 128
      // колонн по одному слою, а под осью X — одну сквозную колонну
        std::vector<std::uint32_t> line;
        for (int x = 0; x < kMacroDim; ++x) line.push_back(cell(x, 5, 6));
        MaskChurn asZ, asX;
        mask_churn_add(asZ, line.data(), line.size(), 2, 0);
        mask_churn_add(asX, line.data(), line.size(), 0, 0);
        CHECK(mask_churn_summary(asZ).columns == 128u);
        CHECK(mask_churn_summary(asZ).through == 0u);
        CHECK(mask_churn_summary(asZ).depthsUsed == 1u);
        CHECK(mask_churn_summary(asX).columns == 1u);
        CHECK(mask_churn_summary(asX).through == 1u);
        CHECK(mask_churn_summary(asX).depthsUsed == 128u);
    }
    { // ПЕРЕХОДНЫЙ ПРОЦЕСС: поток убывает — вторая половина меньше первой
        MaskChurn c;
        const std::uint32_t ci = cell(1, 2, 3);
        for (int w = 0; w < 8; ++w)
            for (int k = 0; k < 8 - w; ++k)
                mask_churn_add(c, &ci, 1, 2,
                               static_cast<std::uint64_t>(w) * kChurnWindowTicks);
        const MaskChurnSummary s = mask_churn_summary(c);
        CHECK(s.flowFirst == 8u + 7u + 6u + 5u);
        CHECK(s.flowLast == 4u + 3u + 2u + 1u);
        CHECK(s.cells == 1u);
        CHECK(s.through == 0u);
    }
    { // ЗНАК (S16.10): куча стекает — «ушло» убывает, «легло» один раз
        MaskChurn c;
        const std::uint32_t ci = cell(4, 5, 6);
        for (int w = 0; w < 4; ++w) {
            const std::uint64_t t =
                static_cast<std::uint64_t>(w) * kChurnWindowTicks;
            mask_churn_add(c, &ci, 1, 2, t);
            mask_churn_bits(c, w == 0 ? 32u : 0u,
                            static_cast<std::uint32_t>(40 - 10 * w), t);
        }
        mask_churn_bits(c, 0u, 0u, 99u * kChurnWindowTicks); // пусто — не окно
        const MaskChurnSummary s = mask_churn_summary(c);
        CHECK(s.laidFirst == 32u);            // окна 0 и 1
        CHECK(s.laidLast == 0u);              // окна 2 и 3
        CHECK(s.goneFirst == 40u + 30u);
        CHECK(s.goneLast == 20u + 10u);
        CHECK(s.flowFirst == 2u && s.flowLast == 2u); // те же половины
    }
    // Пустая перепись — нули, а не мусор.
    CHECK(mask_churn_summary(MaskChurn{}).records == 0u);
    CHECK(mask_churn_summary(MaskChurn{}).columns == 0u);
}

static void test_geomwriter_all() {
    using namespace giga::game;
    test_mask_churn();

    // ---- 1. МАТРИЦА ДОЛГА ---------------------------------------------------
    struct Want {
        GeomWriter who;
        std::uint16_t debt;
    };
    // Полный долг перед всеми восемью получателями.
    constexpr std::uint16_t kFull = kDebtAll;
    // Конверсия суда: маска стоит, статика стала подвижной.
    constexpr std::uint16_t kJudge = kDebtMirror | kDebtMedium | kDebtEmitters |
                                     kDebtAnchors | kDebtAntourage | kDebtBodies;
    const Want want[] = {
        {GeomWriter::Carve, kFull},
        {GeomWriter::Door, kFull},
        {GeomWriter::Brush, kFull},
        // Автомат: изменение пришло с GPU и двигает только подвижное.
        {GeomWriter::Medium, kDebtRebake | kDebtDiffusion | kDebtBodies},
        {GeomWriter::JudgeEntry, kJudge},
        {GeomWriter::JudgeBig, kJudge},
        // Грязь: ни маска, ни статика не менялись.
        {GeomWriter::Stain, kDebtMirror | kDebtMedium},
    };
    static_assert(sizeof(want) / sizeof(want[0]) == kGeomWriterCount,
                  "у каждого писателя — своя строка ожидания; новый писатель "
                  "без неё не собирается");
    for (const Want& w : want) CHECK(geom_debt(w.who) == w.debt);

    // ---- 2. ЗАКОНЫ ВЫВОДА, каждый — имя мутации -------------------------------
    for (std::size_t i = 0; i < kGeomWriterCount; ++i) {
        const GeomWriterRow& r = kGeomWriterRows[i];
        const std::uint16_t d = geom_debt(r);
        CHECK(r.name != nullptr);
        // ЛЕЧЕНИЕ, РАДИ КОТОРОГО ТАБЛИЦА: сменил маску — разбудил допекание.
        // Мутация: снять `mask` у двери — и свет снова не узнаёт о ней.
        CHECK(((d & kDebtRebake) != 0) == r.mask);
        CHECK(((d & kDebtDiffusion) != 0) == r.mask);
        // Изменение, пришедшее с GPU, зеркалу и автомату сообщать незачем — и
        // ТОЛЬКО оно. Мутация: записать автомату `fromGpu = false`.
        CHECK(((d & (kDebtMirror | kDebtMedium)) != 0) == !r.fromGpu);
        // Теорема S20.5: подвижное — не опора и не излучатель. Якоря, антураж
        // и излучатели должны ТОЛЬКО за статику.
        CHECK(((d & kDebtAnchors) != 0) == r.statics);
        CHECK(((d & kDebtAntourage) != 0) == r.statics);
        CHECK(((d & kDebtEmitters) != 0) == r.statics);
        // Спящее тело будит любая запись, после которой опора могла уйти.
        CHECK(((d & kDebtBodies) != 0) == (r.mask || r.statics));
        // За пределы восьми получателей долг не выходит.
        CHECK((d & ~kDebtAll) == 0);
    }
    // Слагаемых восемь, и у каждого свой бит.
    constexpr std::uint16_t kEvery = kDebtEmitters | kDebtMirror | kDebtMedium |
                                     kDebtDiffusion | kDebtRebake | kDebtAnchors |
                                     kDebtBodies | kDebtAntourage;
    static_assert(kEvery == kDebtAll, "маска «всего долга» разошлась со слагаемыми");
}

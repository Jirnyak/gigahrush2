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

static void test_geomwriter_all() {
    using namespace giga::game;

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

// ДОЛГ ПИСАТЕЛЯ ГЕОМЕТРИИ — ОДНА ТАБЛИЦА, ИЗ КОТОРОЙ ОН ВЫВОДИТСЯ (CANON S20.4).
//
// ЗАКОН. Любая запись в мир обязана рассказать о себе всем, кто держит
// производную от мира: зеркалу на GPU, автомату среды, фоновому допеканию
// (клиренс нава, зоны, видимость света — и поле обзора, когда оно ляжет),
// диффузии, полю излучателей, якорям пропов, антуражу, спящим телам. Канон
// называет это «долг писателя — один и полный».
//
// ЧТО БЫЛО ДО ЭТОГО ФАЙЛА (перепись 2026-11-12, `app/main.cpp`). Долг платился
// СЕМЬЮ хвостами, и каждый перечислял его РУКАМИ: карв, дверь, автомат среды,
// консольная кисть, суд входа, большой суд, грязь. Списки разъехались ровно
// так, как разъезжаются копии:
//   * поколение мира, будящее допекание, поднимали двое из семи — свет не
//     узнавал о двери до ближайшего взрыва (вылечено отдельно: поколение
//     теперь ведёт сам `RebakeScheduler::patch_carved_cells`);
//   * дверь не чинила поле излучателей; кисть не будила тела и не рвала
//     якоря; автомат не сообщал диффузии, что куча перекрыла проход;
//   * суд, обращая светящуюся материю в осыпь, оставлял её лампой;
//   * комментарий дренажа двери сам записал класс дефекта: диффузия была
//     «единственным слоем, пропущенным в этом перечне».
//
// ЛЕЧЕНИЕ — НЕ ВОСЬМОЙ СПИСОК, А ВЫВОД. Писатель называет о своей записи ТРИ
// ФАКТА, и долг из них следует:
//   mask    — менялась ТВЁРДОСТЬ субвокселей (маска клетки);
//   statics — менялась СТАТИЧЕСКАЯ материя: исчезла, появилась или стала
//             подвижной (S20.5: подвижное — не опора и не излучатель);
//   fromGpu — изменение ПРИШЛО с GPU (ридбек автомата): зеркало и автомат его
//             уже знают, сообщать им нечего.
//
//   !fromGpu          ⇒ зеркало, будильник автомата
//   mask              ⇒ допекание, диффузия                (проходимость,
//                                                           видимость и
//                                                           открытость суть
//                                                           функции маски)
//   statics           ⇒ излучатели, якоря, антураж         (держится и светит
//                                                           только статика)
//   mask || statics   ⇒ пробуждение тел                    (опора могла уйти)
//
// Теорема S20.5 («автомат не может осиротить ни якорь, ни антураж») здесь не
// оговорка в коде, а ЗНАЧЕНИЕ СТОЛБЦА: у автомата `statics == false`.
//
// СВОЁ У ПИСАТЕЛЯ ОСТАЁТСЯ СВОИМ: частицы карва, шум взрыва, боевой лог — не
// долг перед производными мира, а собственное следствие события; они стоят у
// вызывающего.
//
// Слой — часть записи (S20.4): долг платится тем производным, которые
// построены для ЭТОГО слоя. Кому что принадлежит, знает исполнитель
// (`geometry_changed` в `app/main.cpp`), а не таблица.
#pragma once

#include <cstddef>
#include <cstdint>

#include "core/table_guard.h"

namespace giga::game {

enum class GeomWriter : std::uint8_t {
    Carve = 0,   // карв: пуля, удар, взрыв, консоль
    Door,        // полотно двери и створка лифта — материя появляется и уходит
    Brush,       // консольная кисть и `GIGA_POUR`: пишет и твёрдое, и текучее
    Medium,      // автомат среды: двигает только подвижную материю
    JudgeEntry,  // суд входа: статик на куче становится осыпью
    JudgeBig,    // большой суд: то же, порциями на тик
    Stain,       // грязь: пятно на странице, материя и маска на месте
    Count
};
inline constexpr std::size_t kGeomWriterCount =
    static_cast<std::size_t>(GeomWriter::Count);

// Слагаемые долга. Бит — ОДИН получатель; порядок бит — порядок уплаты.
enum GeomDebt : std::uint16_t {
    kDebtEmitters = 1u << 0,   // поле излучателей и статик-таблица ламп
    kDebtMirror = 1u << 1,     // зеркало мира на GPU
    kDebtMedium = 1u << 2,     // будильник автомата среды
    kDebtDiffusion = 1u << 3,  // битсет открытости диффузии
    kDebtRebake = 1u << 4,     // фоновое допекание: клиренс, зоны, свет
    kDebtAnchors = 1u << 5,    // якоря пропов
    kDebtBodies = 1u << 6,     // пробуждение спящих тел
    kDebtAntourage = 1u << 7,  // запечённый антураж
};
inline constexpr std::uint16_t kDebtAll = 0x00FFu;

struct GeomWriterRow {
    GeomWriter who;
    const char* name;
    bool mask;
    bool statics;
    bool fromGpu;
};

inline constexpr GeomWriterRow kGeomWriterRows[] = {
    {GeomWriter::Carve, "карв", true, true, false},
    {GeomWriter::Door, "дверь", true, true, false},
    {GeomWriter::Brush, "кисть", true, true, false},
    {GeomWriter::Medium, "автомат", true, false, true},
    {GeomWriter::JudgeEntry, "суд входа", false, true, false},
    {GeomWriter::JudgeBig, "большой суд", false, true, false},
    {GeomWriter::Stain, "грязь", false, false, false},
};
GIGA_TABLE_BY_ENUM(kGeomWriterRows, &GeomWriterRow::who, kGeomWriterCount);

constexpr std::uint16_t geom_debt(const GeomWriterRow& r) {
    std::uint16_t d = 0;
    if (!r.fromGpu) d |= kDebtMirror | kDebtMedium;
    if (r.mask) d |= kDebtRebake | kDebtDiffusion;
    if (r.statics) d |= kDebtEmitters | kDebtAnchors | kDebtAntourage;
    if (r.mask || r.statics) d |= kDebtBodies;
    return d;
}
constexpr std::uint16_t geom_debt(GeomWriter who) {
    return geom_debt(kGeomWriterRows[static_cast<std::size_t>(who)]);
}

// ТЕЛЕМЕТРИЯ ДВЕРИ — «число печатается каждым прогоном» (AGENTS.md). Именно
// её не было, когда автомат среды писал маски почти каждый тик, а долг клеток
// копился без предела: никто не знал, КТО и СКОЛЬКО пишет.
struct GeomWriteStats {
    std::uint64_t calls[kGeomWriterCount] = {};
    std::uint64_t cells[kGeomWriterCount] = {};
    // Записей в слой, который сейчас НЕ активен: их долг перед живыми
    // производными пуст — активация слоя строит их заново с мира как он есть.
    std::uint64_t foreign[kGeomWriterCount] = {};
};

} // namespace giga::game

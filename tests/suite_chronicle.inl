// ЛЕТОПИСЬ (CANON S21, [game/chronicle.h]) — гейты шести её законов.
//
// Что здесь проверяется, и почему именно это:
//
//   1. РОДЫ ИЗ ДАННЫХ, А НЕ ИЗ КОДА. Пять родов памяти обязаны совпасть со
//      строками verbs.csv, у которых ненулевая цена деяния, а остальные
//      пятнадцать — получить ОТКАЗ подшивки. Мутация: припиши `rep_delta`
//      любому мирному глаголу — и число родов здесь поедет (это и есть смысл:
//      новый род памяти = правка CSV).
//   2. ОКНА ВЫВЕДЕНЫ ИЗ ЦЕНЫ И ЛЕСТНИЦЫ S15. Проверяется ПОВЕДЕНИЕМ, а не
//      пересказом формулы: удар, которому 5 минут, забыт, а убийство того же
//      возраста — помнится.
//   3. SEQ РАЗЛИЧАЕТ ОДИН ТИК («взял и сдал в одну единицу времени»).
//   4. ТРИ ЗАПРОСА и ровно три: «рядом», «недавно», «рядом этого рода» —
//      включая отсев чужого этажа и чужой комнаты В ОДНОЙ корзине (коллизия
//      хеша обязана стоить шагов, а не ответа).
//   5. САМО-УСЕЧЕНИЕ: кольцо перекрыло звено — цепь кончилась, и ни один
//      запрос не отвечает по мёртвой памяти. Учёта при этом нет никакого.
//   6. СВЯЗИ НЕ ЕДУТ В СЕЙВ, А ПЕРЕСОБИРАЮТСЯ: ответы до и после круга через
//      `save_facts`/`load_facts` совпадают, хотя `nextInRoom` на провод не
//      попадал ни разу.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/chronicle.h"
#include "game/save.h"   // круг через run.sav: секция фактов v27

namespace chronicle_suite {

using namespace giga;
using namespace giga::game;

// ---- 1. РОДЫ — ИЗ ДАННЫХ --------------------------------------------------
static void test_chronicle_kinds_are_data() {
    // Ровно пять родов помнятся, и это те самые пять строк verbs.csv.
    int remembered = 0;
    for (VerbId v = 0; v < kVerbCount; ++v)
        if (fact_kind_remembered(v)) ++remembered;
    CHECK(remembered == 5);
    CHECK(fact_kind_remembered(kVerbToilet));
    CHECK(fact_kind_remembered(kVerbHeal));
    CHECK(fact_kind_remembered(kVerbStrike));
    CHECK(fact_kind_remembered(kVerbKill));
    CHECK(fact_kind_remembered(kVerbRob));
    // Пятнадцать нулей: «мир этого не помнит» — и это ОТКАЗ, а не молчание.
    Chronicle ch;
    ch.init();
    const VerbId peaceful[5] = {kVerbSleep, kVerbEat, kVerbWork, kVerbWander,
                                kVerbCraft};
    for (VerbId v : peaceful) {
        CHECK(!fact_kind_remembered(v));
        CHECK(!ch.file(100u, v, 1u, kInvalidNpc, 0, 5u));
    }
    CHECK(ch.live() == 0);
    CHECK(ch.filed() == 0);
    // И тот же вызов с ПЛАТНЫМ родом проходит — то есть отказ выше про род, а
    // не про аргументы (обратная полярность той же мутации).
    CHECK(ch.file(100u, kVerbKill, 1u, 2u, 0, 5u));
    CHECK(ch.live() == 1);
}

// ---- 2. ОКНА — ПОВЕДЕНИЕМ -------------------------------------------------
static void test_chronicle_windows_derived() {
    // Цена вдвое больше — память вдвое длиннее: разрядность цены и есть
    // ступень лестницы S15. Проверяем ВЫВОД, не числа.
    CHECK(fact_window_ticks(kVerbKill) == 2 * fact_window_ticks(kVerbToilet));
    CHECK(fact_window_ticks(kVerbToilet) == 2 * fact_window_ticks(kVerbStrike));
    CHECK(fact_window_ticks(kVerbToilet) == kWatchTicks);
    CHECK(fact_window_ticks(kVerbWander) == 0);
    CHECK(kFactWindowMax == fact_window_ticks(kVerbKill));

    // Удар и убийство в одной комнате в один тик; спрашиваем через пять минут
    // (37 500 тиков: больше окна удара 32 768, меньше окна убийства 131 072).
    Chronicle ch;
    ch.init();
    const RoomId room = 42;
    CHECK(ch.file(1000u, kVerbStrike, 1u, 2u, 0, room));
    CHECK(ch.file(1000u, kVerbKill, 1u, 3u, 0, room));
    const std::uint64_t now = 1000u + 37500u;
    CHECK(chronicle_near_kind(ch, 0, room, kVerbStrike, now) == 0);
    CHECK(chronicle_near_kind(ch, 0, room, kVerbKill, now) == 1);
    // «Рядом» видит убийство и НЕ видит удар — то есть у каждого звена цепи
    // работает СВОЁ окно, а не окно головы.
    const Fact* newest = nullptr;
    CHECK(chronicle_near(ch, 0, room, now, &newest) == 1);
    CHECK(newest != nullptr && newest->kind == kVerbKill);
    // В тот же тик помнятся оба — окно не отсекает свежее.
    CHECK(chronicle_near(ch, 0, room, 1000u) == 2);
    // И у мира тот же ответ по роду (запрос «недавно»).
    CHECK(chronicle_recent(ch, kVerbStrike, now) == 0);
    CHECK(chronicle_recent(ch, kVerbKill, now) == 1);
    CHECK(chronicle_recent(ch, kVerbWander, 1000u) == 0); // род без памяти
}

// ---- 3. SEQ ОТДЕЛЬНО ОТ ВРЕМЕНИ ------------------------------------------
static void test_chronicle_seq_orders_one_tick() {
    // «Взял и сдал в одну единицу времени»: два факта одного тика обязаны
    // различаться порядком. Без seq это один и тот же момент, и предикат
    // «сдал ПОСЛЕ того как взял» выразить нечем.
    Chronicle ch;
    ch.init();
    const RoomId room = 7;
    CHECK(ch.file(500u, kVerbRob, 1u, 2u, 0, room));
    CHECK(ch.file(500u, kVerbHeal, 1u, 2u, 0, room));
    CHECK(ch.live() == 2);
    CHECK(ch.nth(0)->tick == ch.nth(1)->tick); // время одно
    CHECK(ch.nth(0)->seq + 1 == ch.nth(1)->seq); // порядок — разный
    // Голова цепи — ПОСЛЕДНИЙ, а не первый с этим тиком.
    const Fact* head = ch.bucket_head(room);
    CHECK(head != nullptr && head->kind == kVerbHeal);
    CHECK(ch.chain_next(*head) != nullptr);
    CHECK(ch.chain_next(*head)->kind == kVerbRob);
    CHECK(ch.chain_next(*ch.chain_next(*head)) == nullptr); // цепь кончилась
}

// ---- 4. ТРИ ЗАПРОСА, И ОТСЕВ ЧУЖОГО --------------------------------------
static void test_chronicle_three_queries() {
    Chronicle ch;
    ch.init();
    const RoomId roomA = 11;
    const RoomId roomB = 12;
    // ОДНА КОРЗИНА, ДВЕ КОМНАТЫ: kBuckets — степень двойки, поэтому
    // roomA и roomA + kBuckets лежат в одной цепи. Это законно (коллизия
    // стоит шагов), но ответ смешиваться НЕ ИМЕЕТ ПРАВА.
    const RoomId roomCollide =
        static_cast<RoomId>(roomA + Chronicle::kBuckets);
    CHECK(Chronicle::bucket_of(roomA) == Chronicle::bucket_of(roomCollide));
    CHECK(roomA != roomCollide);

    CHECK(ch.file(10u, kVerbKill, 1u, 2u, /*floor*/ 0, roomA));
    CHECK(ch.file(11u, kVerbKill, 3u, 4u, /*floor*/ 0, roomCollide));
    CHECK(ch.file(12u, kVerbStrike, 5u, 6u, /*floor*/ 0, roomA));
    CHECK(ch.file(13u, kVerbKill, 7u, 8u, /*floor*/ -3, roomA)); // другой этаж
    CHECK(ch.file(14u, kVerbRob, 9u, kInvalidNpc, /*floor*/ 0, roomB));

    const std::uint64_t now = 20u;
    // «РЯДОМ» — только своя комната своего этажа: два факта (kill + strike).
    CHECK(chronicle_near(ch, 0, roomA, now) == 2);
    CHECK(chronicle_near(ch, 0, roomCollide, now) == 1);  // коллизия не смешала
    CHECK(chronicle_near(ch, -3, roomA, now) == 1);       // чужой этаж — свой счёт
    CHECK(chronicle_near(ch, 0, roomB, now) == 1);
    CHECK(chronicle_near(ch, 0, 999u, now) == 0);         // в комнате без фактов
    // «РЯДОМ ЭТОГО РОДА» — пересечение: в roomA на этаже 0 одно убийство.
    CHECK(chronicle_near_kind(ch, 0, roomA, kVerbKill, now) == 1);
    CHECK(chronicle_near_kind(ch, 0, roomA, kVerbStrike, now) == 1);
    CHECK(chronicle_near_kind(ch, 0, roomA, kVerbRob, now) == 0);
    // «НЕДАВНО» — мир целиком, без оглядки на место: три убийства, где бы ни.
    const Fact* newest = nullptr;
    CHECK(chronicle_recent(ch, kVerbKill, now, &newest) == 3);
    CHECK(newest != nullptr && newest->floor == -3); // свежайшее из трёх
    CHECK(chronicle_recent(ch, kVerbRob, now) == 1);
    CHECK(chronicle_recent(ch, kVerbToilet, now) == 0);

    // Коридор (kNoRoom) — законное место факта, а не причина потерять его.
    CHECK(ch.file(15u, kVerbStrike, 20u, 21u, 0, kNoRoom));
    CHECK(chronicle_near(ch, 0, kNoRoom, now) == 1);
}

// ---- 5. САМО-УСЕЧЕНИЕ -----------------------------------------------------
static void test_chronicle_self_truncates() {
    Chronicle ch;
    ch.init();
    const RoomId room = 3;
    // Переполнить кольцо ровно на одну запись.
    const std::uint32_t over = Chronicle::kCapacity + 1u;
    for (std::uint32_t i = 0; i < over; ++i)
        CHECK(ch.file(1000u, kVerbKill, i, kInvalidNpc, 0, room));
    CHECK(ch.filed() == over);
    CHECK(ch.live() == Chronicle::kCapacity);
    CHECK(ch.forgotten() == 1u);
    // Факт 0 ВЫТЕСНЕН: его seq в кольце уже не живёт, и `at` молчит.
    CHECK(!ch.alive(0u));
    CHECK(ch.at(0u) == nullptr);
    CHECK(ch.alive(1u));
    // Цепь комнаты самоусеклась ровно на вытесненном звене: обход даёт
    // kCapacity звеньев и кончается — ни мёртвой ссылки, ни зацикливания.
    std::uint32_t walked = 0;
    for (const Fact* f = ch.bucket_head(room); f != nullptr;
         f = ch.chain_next(*f)) {
        ++walked;
        CHECK(walked <= Chronicle::kCapacity); // страховка от цикла
    }
    CHECK(walked == Chronicle::kCapacity);
    // И запрос отвечает по живому, а не по забытому.
    CHECK(chronicle_near(ch, 0, room, 1000u) == Chronicle::kCapacity);
    // Голова — самый свежий (subject = последний поданный номер).
    const Fact* head = ch.bucket_head(room);
    CHECK(head != nullptr && head->subject == over - 1u);
}

// ---- 6. СЕЙВ: ЕДУТ ФАКТЫ, ЦЕПИ ПЕРЕСОБИРАЮТСЯ ----------------------------
static void test_chronicle_save_rebuilds_chains() {
    Chronicle ch;
    ch.init();
    const RoomId roomA = 21;
    const RoomId roomB = 22;
    CHECK(ch.file(100u, kVerbKill, 1u, 2u, 0, roomA));
    CHECK(ch.file(150u, kVerbStrike, 3u, 4u, 0, roomB));
    CHECK(ch.file(200u, kVerbRob, 5u, kInvalidNpc, -7, roomA));
    CHECK(ch.file(250u, kVerbHeal, 6u, 7u, 0, roomA));

    std::vector<Fact> wire;
    ch.save_facts(wire);
    CHECK(wire.size() == 4);
    CHECK(wire[0].tick == 100u && wire[3].tick == 250u); // от старого к свежему
    // СВЯЗЕЙ НА ПРОВОДЕ НЕТ: портим их в пачке — и ответы всё равно сходятся,
    // потому что цепи пересобираются, а не читаются. Это и есть мутация,
    // доказывающая закон 5 (обратная полярность: если бы `load_facts` верил
    // звену из файла, обход ушёл бы в мусор и счёт поехал).
    for (Fact& f : wire) f.nextInRoom = 123456u;

    Chronicle back;
    back.init();
    // Загрузка на ЖИВЫЕ часы: пачка перебазируется, возрасты сохраняются.
    const std::uint64_t nowAfterLoad = 1'000'000u;
    CHECK(back.load_facts(wire.data(), wire.size(), nowAfterLoad));
    CHECK(back.live() == 4);
    CHECK(back.filed() == wire.back().seq + 1u);
    // Возрасты точные: самый свежий лёг на now, остальные — на свою разность.
    CHECK(back.bucket_head(roomA)->tick == nowAfterLoad);
    CHECK(back.at(wire[0].seq)->tick == nowAfterLoad - 150u); // 250 − 100
    // Ответы совпадают с теми, что давала живая летопись в свой момент.
    CHECK(chronicle_near(back, 0, roomA, nowAfterLoad) ==
          chronicle_near(ch, 0, roomA, 250u));
    CHECK(chronicle_near(back, -7, roomA, nowAfterLoad) == 1);
    CHECK(chronicle_near(back, 0, roomB, nowAfterLoad) == 1);
    CHECK(chronicle_near_kind(back, 0, roomA, kVerbHeal, nowAfterLoad) == 1);
    CHECK(chronicle_recent(back, kVerbKill, nowAfterLoad) == 1);
    // Цепь roomA пересобрана целиком и в том же порядке: heal → kill (rob той
    // же комнаты лежит на другом ЭТАЖЕ и в цепи стоит между ними).
    const Fact* h = back.bucket_head(roomA);
    CHECK(h != nullptr && h->kind == kVerbHeal);
    CHECK(back.chain_next(*h) != nullptr);
    CHECK(back.chain_next(*h)->kind == kVerbRob);

    // ОТКАЗ ВМЕСТО ПАМЯТИ, В КОТОРОЙ «РАНЬШЕ» ПОЗЖЕ: номера обязаны идти
    // подряд — переставленные отвергаются.
    std::vector<Fact> broken = wire;
    const std::uint32_t s0 = broken[0].seq;
    broken[0].seq = broken[1].seq;
    broken[1].seq = s0;
    Chronicle refused;
    refused.init();
    CHECK(!refused.load_facts(broken.data(), broken.size(), nowAfterLoad));
    CHECK(refused.live() == 0);
    // ...и ДЫРА В НОМЕРАХ тоже: под пропущенным номером лежал бы нетронутый
    // слот кольца, то есть запрос отвечал бы мусором. Возрастание тут
    // соблюдено — отвергается именно дыра (обратная полярность той же
    // проверки: подряд идущая пачка выше загрузилась).
    std::vector<Fact> gapped = wire;
    gapped[2].seq += 100u;
    gapped[3].seq += 100u;
    CHECK(!refused.load_facts(gapped.data(), gapped.size(), nowAfterLoad));
    // Пустая пачка — законная загрузка (новый мир), а не отказ.
    CHECK(refused.load_facts(nullptr, 0, nowAfterLoad));

    // ЧАСТИЧНАЯ ПАЧКА С БОЛЬШИМИ НОМЕРАМИ — тот случай, на котором «сколько
    // мир помнит» и врало бы: сейв длинной сессии несёт десять фактов с
    // номерами от пяти тысяч, и формула `min(next, kCapacity)` отвечала бы
    // «4096», пуская обход «недавно» по нетронутым слотам кольца. Окно
    // [first, next) отвечает «десять».
    std::vector<Fact> late;
    for (std::uint32_t i = 0; i < 10u; ++i)
        late.push_back(Fact{500u + i, 5000u + i, kFactNone, i, kInvalidNpc, 2,
                            static_cast<RoomId>(30u + i), kVerbKill, {}});
    Chronicle resumed;
    resumed.init();
    CHECK(resumed.load_facts(late.data(), late.size(), nowAfterLoad));
    CHECK(resumed.live() == 10u);
    CHECK(resumed.forgotten() == 5000u);
    CHECK(resumed.filed() == 5010u);
    CHECK(!resumed.alive(4999u));          // ниже окна — забыто
    CHECK(resumed.at(4999u) == nullptr);
    CHECK(resumed.alive(5000u));
    // «Недавно» видит РОВНО десять убийств, а не кольцо пустых слотов.
    CHECK(chronicle_recent(resumed, kVerbKill, nowAfterLoad) == 10u);
    CHECK(chronicle_near(resumed, 2, 35u, nowAfterLoad) == 1u);
    // Подшивка продолжает счёт с сохранённого номера, а не с нуля.
    CHECK(resumed.file(nowAfterLoad, kVerbRob, 7u, kInvalidNpc, 2, 35u));
    CHECK(resumed.filed() == 5011u);
    CHECK(chronicle_near(resumed, 2, 35u, nowAfterLoad) == 2u);

    // КРУГ ЧЕРЕЗ RUN.SAV (v27): секция фактов едет и возвращается байт в байт
    // по значащим полям — ширина 25 Б на факт, не sizeof(Fact).
    SaveState out;
    ch.save_facts(out.facts);
    std::vector<std::uint8_t> bytes;
    save_write(out, bytes);
    CHECK(bytes.size() == save_bytes_for(0, 0, out.facts.size()));
    SaveState in;
    SaveError err = SaveError::Count;
    CHECK(save_read(bytes.data(), bytes.size(), in, &err));
    CHECK(err == SaveError::None);
    CHECK(in.facts.size() == out.facts.size());
    for (std::size_t i = 0; i < in.facts.size(); ++i) {
        CHECK(in.facts[i].tick == out.facts[i].tick);
        CHECK(in.facts[i].seq == out.facts[i].seq);
        CHECK(in.facts[i].subject == out.facts[i].subject);
        CHECK(in.facts[i].object == out.facts[i].object);
        CHECK(in.facts[i].floor == out.facts[i].floor);
        CHECK(in.facts[i].room == out.facts[i].room);
        CHECK(in.facts[i].kind == out.facts[i].kind);
    }
    // Сейв, объявивший фактов больше, чем летопись способна помнить,
    // отвергается ДО всякого чтения тела.
    SaveState tooMany;
    tooMany.facts.assign(Chronicle::kCapacity + 1u, Fact{});
    for (std::size_t i = 0; i < tooMany.facts.size(); ++i) {
        tooMany.facts[i].seq = static_cast<std::uint32_t>(i);
        tooMany.facts[i].kind = kVerbKill;
    }
    std::vector<std::uint8_t> big;
    save_write(tooMany, big);
    SaveState nope;
    SaveError bigErr = SaveError::Count;
    CHECK(!save_read(big.data(), big.size(), nope, &bigErr));
    CHECK(bigErr == SaveError::SizeMismatch);
}

// ---- 7. ВИД: СЛОВА ВЫВОДЯТСЯ, А НЕ ХРАНЯТСЯ ------------------------------
static void test_chronicle_line_is_a_view() {
    NpcPool pool;
    pool.init();
    const NpcId a = pool.spawn();
    const NpcId b = pool.spawn();
    pool.faction(a) = static_cast<std::uint16_t>(Faction::Wild);
    pool.faction(b) = static_cast<std::uint16_t>(Faction::Citizens);

    Chronicle ch;
    ch.init();
    CHECK(ch.file(1000u, kVerbKill, a, b, -3, 17u));
    const Fact* f = ch.bucket_head(17u);
    CHECK(f != nullptr);

    char line[160] = {};
    const std::size_t n = fact_line(*f, pool, 1000u + 125u * 42u, line,
                                    sizeof(line));
    CHECK(n > 0);
    CHECK(n < sizeof(line));
    CHECK(line[n] == '\0');
    // Глагол — из verbs.csv (а не литерал здесь), подлежащее — из пула.
    CHECK(std::strstr(line, kVerbNames[kVerbKill]) != nullptr);
    CHECK(std::strstr(line, faction_name(Faction::Wild)) != nullptr);
    CHECK(std::strstr(line, faction_name(Faction::Citizens)) != nullptr);
    CHECK(std::strstr(line, "42") != nullptr); // 42 с назад — возраст из тиков

    // Факт без жертвы — короткая форма, без стрелки.
    CHECK(ch.file(1000u, kVerbToilet, a, kInvalidNpc, -3, 18u));
    const Fact* g = ch.bucket_head(18u);
    CHECK(g != nullptr);
    char line2[160] = {};
    CHECK(fact_line(*g, pool, 1000u, line2, sizeof(line2)) > 0);
    CHECK(std::strstr(line2, "→") == nullptr);
    // Тесный буфер не рвёт ничего и возвращает честную длину.
    char tiny[8] = {};
    const std::size_t m = fact_line(*g, pool, 1000u, tiny, sizeof(tiny));
    CHECK(m == sizeof(tiny) - 1);
    CHECK(tiny[sizeof(tiny) - 1] == '\0');
}

} // namespace chronicle_suite

static void test_chronicle_all() {
    chronicle_suite::test_chronicle_kinds_are_data();
    chronicle_suite::test_chronicle_windows_derived();
    chronicle_suite::test_chronicle_seq_orders_one_tick();
    chronicle_suite::test_chronicle_three_queries();
    chronicle_suite::test_chronicle_self_truncates();
    chronicle_suite::test_chronicle_save_rebuilds_chains();
    chronicle_suite::test_chronicle_line_is_a_view();
}

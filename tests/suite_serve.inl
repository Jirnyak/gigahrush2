// ДЕЯНИЕ НУЖДЫ (CANON S24) — гейт замкнутого цикла.
//
// Что здесь судится и чего НЕ судится. Проводку («проход ведения держит
// занятое тело, своё деяние себя не рвёт, угроза рвёт») судит `suite_place`:
// там живёт `place_errand_step`. Здесь — САМА СИСТЕМА: по какому правилу
// деяние начинается, когда падает эффект, сколько и откуда он берёт, и
// ВЫЖИВАЕТ ЛИ ТОЛПА. Разделение не косметическое: гейт цикла обязан гоняться
// БЕЗ нава и физики, иначе «толпа вымерла» было бы неотличимо от «толпа не
// дошла».
//
// ЧИСЛА — ИЗ ЖИВЫХ ТАБЛИЦ. Длины окон берутся из `kActionDurMs`, величина
// предмета из `kItemVerbs`, строка действия из `kVerbAction`. Рукописное число
// здесь — мина: скажи `actions.csv` питью длину 0, и «эффект упал в конце
// окна» проверяло бы совсем другое утверждение (урок suite_content 2026-11-08).
#pragma once

namespace serve_suite {

using namespace giga;
using namespace giga::game;

inline constexpr LayerId kLayer = 3;

// Комната-куб со ОДНИМ объявленным глаголом. Та же форма, что `declare_cube` в
// suite_place: объявление — чистая функция модуля, и тест говорит с ним через
// ту же дверь `room_declare`, которой говорят этажи.
static RoomId declare_room(FloorRooms& fr, std::uint8_t x, std::uint8_t y,
                           std::uint8_t z, std::size_t verb,
                           std::int16_t amount) {
    std::int16_t declared[kVerbCount] = {};
    if (verb < kVerbCount) declared[verb] = amount;
    const RoomBox box{x, y, z, 2, 2, 1};
    return room_declare(fr, &box, 1, /*tags=*/0, /*owner=*/0, declared);
}

// Центр клетки — ОБРАТНАЯ свёртка к `cell_of_metres@world/types.h`. Своего
// написания здесь нет: третья копия «центра клетки» в дереве была бы ровно тем
// вторым ответом, за который этот сьют и судит соседей.
using place_suite::cell_centre;
static vec3 cell_mid(int cx, int cy, int cz) {
    return vec3{cell_centre(cx), cell_centre(cy), cell_centre(cz)};
}

// Тело с просеянной строкой нужд: все бары полны, давления пусты. Дальше тест
// опускает РОВНО тот бар, который проверяет, — одна нужда за раз, иначе аргмакс
// выберет не то, что мерят.
static Entity make_body(Registry& reg, NpcPool& pool, const vec3& pos,
                        NpcId& idOut) {
    const NpcId id = pool.spawn();
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    const Entity e = embody(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos = pos;
    Needs& n = pool.needs(id);
    n = Needs{};
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = kNeedMax;
    n.seeded = 1;
    idOut = id;
    return e;
}

// --- 1. МОСТ «НУЖДА → ДЕЙСТВИЕ» --------------------------------------------
//
// serve_pick обязан быть ТЕМ ЖЕ произведением, что слагаемые place_interest, и
// отличаться от него РОВНО одним: глаголы без строки деяния не участвуют.
// Мутация «убрать фильтр по kVerbAction» краснит вторую половину: сумма
// назвала бы `store` (её слагаемое больше), а начать деяние «хранить» нечем.
static void test_serve_pick_is_the_same_sum_filtered() {
    FloorRooms fr;
    rooms_reset(fr);
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbStore] = 20; // у `store` строки деяния НЕТ (данные)
    declared[kVerbDrink] = 1;  // у `drink` есть, но предложение мизерное
    const RoomBox box{20, 20, 20, 2, 2, 1};
    const RoomId id = room_declare(fr, &box, 1, 0, 0, declared);
    CHECK(id != kNoRoom);
    const Room* r = room_of(fr, id);
    CHECK(r != nullptr);
    // ПОСЫЛКИ СТЕНДА (не гейты): данные сегодня именно такие.
    CHECK(kVerbAction[kVerbStore] >= kActionCount);
    CHECK(kVerbAction[kVerbDrink] < kActionCount);

    DemandE3 demand[kVerbCount] = {};
    demand[kVerbStore] = 1000;
    demand[kVerbDrink] = 100;
    VerbId sumLabel = static_cast<VerbId>(kVerbCount);
    place_interest(*r, demand, &sumLabel);
    CHECK(sumLabel == kVerbStore); // одна сумма честно называет хранение
    const ServePick p = serve_pick(*r, demand);
    CHECK(p.verb == kVerbDrink);   // ...а деяние берёт то, что ВЫПОЛНИМО
    CHECK(p.offer == 1);
    CHECK(p.term == 100);

    // КОГДА ГЛАГОЛ СУММЫ ВЫПОЛНИМ — ЯРЛЫКИ СОВПАДАЮТ, и это гейт против
    // второго решателя: разойдись они, тело шло бы за одним, а делало другое.
    DemandE3 thirsty[kVerbCount] = {};
    thirsty[kVerbDrink] = 1000;
    thirsty[kVerbStore] = 1;
    VerbId label2 = static_cast<VerbId>(kVerbCount);
    place_interest(*r, thirsty, &label2);
    CHECK(label2 == kVerbDrink);
    CHECK(serve_pick(*r, thirsty).verb == label2);

    // НОЛЬ С ОБЕИХ СТОРОН — «нечего дать», и оба нуля неразличимы для
    // вызывающего намеренно.
    DemandE3 none[kVerbCount] = {};
    CHECK(serve_pick(*r, none).verb >= kVerbCount);
    DemandE3 wantsMissing[kVerbCount] = {};
    wantsMissing[kVerbEat] = 1000; // комната еды не предлагает
    CHECK(serve_pick(*r, wantsMissing).verb >= kVerbCount);
}

// --- 2. НАЧАЛО: ЧЕТЫРЕ ПОЛЯРНОСТИ ------------------------------------------
static void test_serve_begins_on_demand_times_offer() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const RoomId room = declare_room(fr, 20, 20, 20, kVerbDrink, 14);
    CHECK(room != kNoRoom);
    const vec3 inside = cell_mid(21, 21, 20);
    CHECK(room_at_pos(fr, inside) == room);

    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    ServeTick t{};
    const ServeCtx ctx{reg, pool, fr, nullptr, 100u};

    // (а) СЫТОЕ ТЕЛО В ОБЕСПЕЧЕННОЙ КОМНАТЕ НЕ ДЕЛАЕТ НИЧЕГО: предложение
    // есть, спроса нет. Терпение строки (S13.5) — тот самый фильтр.
    CHECK(!serve_begin(ctx, e, id, inside, t));
    CHECK(t.began == 0);
    CHECK(t.nothing == 1);
    CHECK(!reg.all_of<Acting>(e) || !acting_busy(reg.get<Acting>(e),
                                                 ActSlot::Body, 100u));

    // (б) ЖАЖДА + КРАН = ДЕЯНИЕ. Вода опускается НИЖЕ терпения строки
    // (`kVerbPatienceE3[kVerbDrink]`), и порог берётся из таблицы, а не из
    // головы: сдвинь терпение в verbs.csv — стенд поедет за ним.
    // ПОРОГ НЕ ВЫЧИСЛЯЕТСЯ РУКАМИ — он СПРАШИВАЕТСЯ у живой кривой: шкала
    // недостатка (72) и форма рампы живут в [game/needs.h], и копия их
    // арифметики здесь была бы третьим ответом (стояла, снята аудитом).
    const float thirsty = 10.0f;
    CHECK(needs_low_pressure(kVerbDrink, thirsty) > 0.0f);  // ПОСЫЛКА стенда
    CHECK(needs_low_pressure(kVerbDrink, kNeedMax) == 0.0f); // и её отрицание
    pool.needs(id).water = thirsty;
    ServeTick t2{};
    CHECK(serve_begin(ctx, e, id, inside, t2));
    CHECK(t2.began == 1);
    CHECK(t2.byVerb[kVerbDrink] == 1);
    CHECK(reg.all_of<Acting>(e));
    const ActWindow& w = act_slot(reg.get<Acting>(e), ActSlot::Body);
    // ДЛИНА — ИЗ СТРОКИ ДЕЙСТВИЯ, перевод ВВЕРХ одной дверью.
    CHECK(w.action == kVerbAction[kVerbDrink]);
    CHECK(w.durTicks == ms_to_ticks(kActionDurMs[w.action]));
    CHECK(w.applyTicks == w.durTicks); // контакт — КОНЕЦ окна
    CHECK(w.startTick == 100u);

    // (в) ЗАНЯТОСТЬ МОНОТОННА: второе начало на открытом окне отказывает.
    ServeTick t3{};
    CHECK(!serve_begin(ctx, e, id, inside, t3));
    CHECK(t3.began == 0);

    // (в-бис) НЕПРОСЕЯННАЯ СТРОКА НУЖД — НЕ ГОЛОД. Нули (`seeded == 0`) кривые
    // давления читают как «голоден, обезвожен И не спал» ([game/needs.h]),
    // поэтому решатель подставляет прокатанную строку (`needs_row_for`), и
    // деяние ОБЯЗАНО спрашивать ТУ ЖЕ дверь: иначе проход ведения вёл бы тело
    // по одной строке, а деяние кормило бы по другой. Мутация
    // «`pool.needs` вместо `needs_row_for`» краснит здесь: свежая запись
    // мгновенно получила бы деяние.
    NpcId raw = 0;
    const Entity eRaw = make_body(reg, pool, inside, raw);
    pool.needs(raw) = Needs{}; // всё по нулям, seeded == 0
    CHECK(pool.needs(raw).seeded == 0);
    ServeTick t5{};
    CHECK(!serve_begin(ctx, eRaw, raw, inside, t5));
    CHECK(t5.began == 0);
    CHECK(t5.nothing == 1);

    // (г) КОРИДОР: та же жажда, но вне комнат — деяние недоступно ПО МЕСТУ, и
    // прибор называет причину отдельным счётчиком.
    NpcId id2 = 0;
    const vec3 outside = cell_mid(60, 60, 60);
    CHECK(room_at_pos(fr, outside) == kNoRoom);
    const Entity e2 = make_body(reg, pool, outside, id2);
    pool.needs(id2).water = 10.0f;
    ServeTick t4{};
    CHECK(!serve_begin(ctx, e2, id2, outside, t4));
    CHECK(t4.corridor == 1);
    CHECK(t4.nothing == 0);
}

// --- 3. ЭФФЕКТ ПАДАЕТ В КОНЦЕ ОКНА, ОДИН РАЗ -------------------------------
static void test_serve_effect_lands_at_window_end_once() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const std::int16_t offer = 14;
    const RoomId room = declare_room(fr, 30, 30, 30, kVerbDrink, offer);
    const vec3 inside = cell_mid(31, 31, 30);
    CHECK(room_at_pos(fr, inside) == room);

    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    const float start = 20.0f;
    pool.needs(id).water = start;
    const ServeCtx begin{reg, pool, fr, nullptr, 1000u};
    ServeTick t{};
    CHECK(serve_begin(begin, e, id, inside, t));
    const std::uint16_t dur = act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;
    CHECK(dur > 1);

    // ЗА ТИК ДО КОНЦА: тело держат, бар НЕ тронут. Это и есть «деяние есть
    // время», а не мгновенный эффект с косметической задержкой.
    ServeTick mid{};
    CHECK(serve_busy(ServeCtx{reg, pool, fr, nullptr, 1000u + dur - 1}, e, id,
                     inside, kLayer, mid));
    CHECK(mid.holding == 1);
    CHECK(mid.applied == 0);
    CHECK(pool.needs(id).water == start);

    // РОВНО В КОНЕЦ: эффект упал, бар вырос НА ПРЕДЛОЖЕНИЕ КОМНАТЫ, и тело
    // больше не держат — окно закрылось тем же тиком.
    ServeTick land{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, nullptr, 1000u + dur}, e, id,
                      inside, kLayer, land));
    CHECK(land.applied == 1);
    CHECK(land.consumed == 0); // расходуемого в комнате нет — взято у места
    CHECK(land.reliefSum == static_cast<std::int32_t>(offer));
    CHECK(pool.needs(id).water == start + static_cast<float>(offer));
    // ВЫПИТОЕ ВСТАЛО В ОЧЕРЕДЬ ПИЩЕВАРЕНИЯ — иначе у одного и того же деяния
    // было бы два исхода: из ящика с ценой сортира, у крана без неё.
    CHECK(pool.needs(id).pendingPee ==
          static_cast<float>(offer) * kDrinkPeeShare);

    // ОДНОРАЗОВОСТЬ: сколько ни спрашивай после — эффекта больше нет.
    ServeTick again{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, nullptr, 1000u + dur * 3}, e, id,
                      inside, kLayer, again));
    CHECK(again.applied == 0);
    CHECK(pool.needs(id).water == start + static_cast<float>(offer));

    // КЛАМП: «что ЛАНДЕД, а не число на жестянке». Полный бар деяния не
    // получает вовсе (спроса нет), поэтому проверяем сам клок одной дверью.
    Needs full;
    full.water = kNeedMax - 3.0f;
    const SatisfyResult sat = needs_satisfy(full, kVerbDrink, 50.0f);
    CHECK(sat.served);
    CHECK(sat.gained == 3.0f);
    CHECK(full.water == kNeedMax);
    // ...а очередь считается от ЗАЯВЛЕННОЙ величины, не от легшей (дословно
    // оговорка apply_consumable: через тебя оно прошло либо так, либо так).
    CHECK(full.pendingPee == 50.0f * kDrinkPeeShare);
}

// --- 4. ЕДА И СОРТИР: ДВЕ ДРУГИЕ ШКАЛЫ -------------------------------------
static void test_serve_eat_queues_and_toilet_relieves() {
    Needs n;
    n.food = 10.0f;
    const SatisfyResult meal = needs_satisfy(n, kVerbEat, 20.0f);
    CHECK(meal.served);
    CHECK(meal.gained == 20.0f);
    CHECK(n.food == 30.0f);
    CHECK(n.pendingPoo == 20.0f * kFeedPooShare);
    CHECK(n.pendingPee == 20.0f * kFeedPeeShare);

    // СОРТИР — ЕДИНСТВЕННЫЙ ГЛАГОЛ, У КОТОРОГО БАР ПАДАЕТ, и снимает он ОБА
    // давления: одного полного пузыря достаточно, чтобы тело пошло, значит и
    // деяние обязано закрывать оба (ср. max двух давлений в demand_from_needs).
    //
    // ВЕЛИЧИНУ НАЗЫВАЕТ ТЕЛО (CANON S27.1, 2026-11-14): опорожняешься целиком,
    // сколько бы ни предложило место. До этого здесь стояло «20 снято с
    // мочевого из 30», и пол коридора под клавишей P давал больше унитаза.
    Needs p;
    p.pee = 30.0f;
    p.poo = 5.0f;
    const SatisfyResult relief = needs_satisfy(p, kVerbToilet, 20.0f);
    CHECK(relief.served);
    CHECK(p.pee == 0.0f);
    CHECK(p.poo == 0.0f);
    CHECK(relief.gained == 35.0f); // всё: 30 с мочевого + 5 с кишечника
    // ...и предложение места на объём не влияет вовсе: НОЛЬ у места (коридор)
    // даёт то же опорожнение, — это и делает клавишу P той же дверью.
    Needs corridor;
    corridor.pee = 12.0f;
    const SatisfyResult floorRelief = needs_satisfy(corridor, kVerbToilet, 0.0f);
    CHECK(floorRelief.served);
    CHECK(corridor.pee == 0.0f);
    CHECK(floorRelief.gained == 12.0f);
    // ПУСТОЕ ТЕЛО — отказ значением: облегчаться нечем, деяния не будет.
    Needs empty;
    CHECK(!needs_satisfy(empty, kVerbToilet, 50.0f).served);

    // ГЛАГОЛ НЕ ПРО КЛОК — `served == false` ЗНАЧЕНИЕМ, а не тишиной.
    Needs q;
    CHECK(!needs_satisfy(q, kVerbStore, 50.0f).served);
    CHECK(!needs_satisfy(q, kVerbDrink, 0.0f).served); // ноль — тоже не деяние
}

// --- 5. РАСХОДУЕМОЕ РАСХОДУЕТСЯ (S12.5) ------------------------------------
//
// Ящик с хлебом в комнате: тело ест ХЛЕБ, величину называет СТРОКА ПРЕДМЕТА
// (а не комната), хлеб исчезает, запас комнаты падает. Это и есть «следующий
// голодный видит меньшее есть», без которого еда берётся из воздуха.
static void test_serve_consumes_what_lies_in_the_room() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();
    FloorRooms fr;
    rooms_reset(fr);
    const std::int16_t declaredEat = 12;
    const RoomId room = declare_room(fr, 40, 40, 40, kVerbEat, declaredEat);
    const vec3 inside = cell_mid(41, 41, 40);
    CHECK(room_at_pos(fr, inside) == room);

    const ItemId bread = item_by_string("bread");
    CHECK(bread != kInvalidItem);
    const std::int16_t breadEat = kItemVerbs[bread - 1][kVerbEat];
    CHECK(breadEat > 0);
    // РАЗЛИЧИМОСТЬ СТЕНДА: величина хлеба обязана отличаться от объявленного,
    // иначе тест не отличил бы «взял у предмета» от «взял у места».
    // (Вторая проверка здесь была ТАВТОЛОГИЕЙ — `breadEat != declaredEat +
    // breadEat` тождественно `declaredEat != 0`, а это литерал строкой выше.)
    CHECK(breadEat != declaredEat);

    Entity box = reg.create();
    reg.emplace<Transform>(box, inside, kLayer);
    {
        Container c;
        c.inv.slots[0] = ItemSlot{bread, 2, 255, 0};
        reg.emplace<Container>(box, c);
    }
    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    // Запас комнаты — НАСТОЯЩЕЙ дверью пересчёта, не руками.
    rooms_supply_rebuild(fr, reg, kLayer);
    const std::int32_t supplyBefore = room_of(fr, room)->supply[kVerbEat];
    CHECK(supplyBefore == breadEat * 2);

    const float startFood = 10.0f;
    pool.needs(id).food = startFood;
    ServeTick t{};
    const ServeCtx ctx{reg, pool, fr, &bus, 500u};
    CHECK(serve_begin(ctx, e, id, inside, t));
    CHECK(t.byVerb[kVerbEat] == 1);
    const std::uint16_t dur = act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;

    ServeTick land{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, &bus, 500u + dur}, e, id, inside,
                      kLayer, land));
    CHECK(land.applied == 1);
    CHECK(land.consumed == 1);
    // Величина — ИЗ СТРОКИ ПРЕДМЕТА: ни объявленное, ни сумма.
    CHECK(pool.needs(id).food == startFood + static_cast<float>(breadEat));
    // Хлеб исчез, и запас комнаты упал РОВНО на один хлеб.
    CHECK(reg.get<Container>(box).inv.slots[0].count == 1);
    CHECK(room_of(fr, room)->supply[kVerbEat] == supplyBefore - breadEat);
    // Предмет сменил хозяина — факт поехал на шину (её читает свидетель).
    bool transferred = false;
    for (std::size_t i = 0; i < bus.size(); ++i)
        transferred = transferred ||
                      (bus.events()[i].type == EventType::ItemTransferred &&
                       bus.events()[i].c == bread);
    CHECK(transferred);

    // ВТОРАЯ ПОЛЯРНОСТЬ: ящик пуст — то же деяние берёт у МЕСТА, и величина
    // становится объявленной. Один глагол, два источника, разный ответ.
    //
    // ЧАСЫ ИДУТ ТОЛЬКО ВПЕРЁД, и это стенд проверил на себе: второе начало
    // стояло на тике 900 при окне [500, 500+dur), то есть ВНУТРИ первого
    // окна, — и `serve_begin` законно отказал (занятость монотонна). Отсчёт
    // ведётся от КОНЦА предыдущего окна, а не от круглого числа.
    reg.get<Container>(box).inv.slots[0] = ItemSlot{};
    rooms_supply_rebuild(fr, reg, kLayer);
    pool.needs(id).food = startFood;
    const std::uint64_t after = 500u + dur + 50u;
    ServeTick t2{};
    CHECK(serve_begin(ServeCtx{reg, pool, fr, &bus, after}, e, id, inside, t2));
    ServeTick land2{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, &bus, after + dur}, e, id, inside,
                      kLayer, land2));
    CHECK(land2.applied == 1);
    CHECK(land2.consumed == 0);
    CHECK(pool.needs(id).food == startFood + static_cast<float>(declaredEat));
}

// --- 5b. ЧТО ЛЕЖИТ НА ПОЛУ — НЕ ЕДА ДЛЯ ДЕЯНИЯ -----------------------------
//
// Пикап даёт комнате очки (S12.5: запас — это то, что ЛЕЖИТ), но изъять его
// деяние не может: это значило бы уничтожить сущность из живого обхода вида.
// Поэтому его вклад ВЫЧИТАЕТСЯ из величины деяния — иначе одна брошенная банка
// кормила бы этаж вечно. Гейт на НАЙДЕННЫЙ АУДИТОМ дефект: до правки деяние
// выдавало очки пикапа и ни разу его не тратило.
static void test_serve_ignores_loose_loot() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const std::int16_t declaredEat = 12;
    const RoomId room = declare_room(fr, 70, 70, 70, kVerbEat, declaredEat);
    const vec3 inside = cell_mid(71, 71, 70);
    CHECK(room_at_pos(fr, inside) == room);

    const ItemId bread = item_by_string("bread");
    const std::int16_t breadEat = kItemVerbs[bread - 1][kVerbEat];
    CHECK(breadEat > 0);
    Entity loose = reg.create();
    reg.emplace<Transform>(loose, inside, kLayer);
    reg.emplace<Pickup>(loose, Pickup{bread, 3, 255});

    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    rooms_supply_rebuild(fr, reg, kLayer);
    // ПОСЫЛКА: пикап в предложение комнаты ВОШЁЛ — иначе гейт мерил бы
    // отсутствие пикапа, а не отказ деяния от него.
    CHECK(room_of(fr, room)->supply[kVerbEat] == breadEat * 3);

    const float startFood = 5.0f;
    pool.needs(id).food = startFood;
    ServeTick t{};
    CHECK(serve_begin(ServeCtx{reg, pool, fr, nullptr, 10u}, e, id, inside, t));
    const std::uint16_t dur = act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;
    ServeTick land{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, nullptr, 10u + dur}, e, id, inside,
                      kLayer, land));
    CHECK(land.applied == 1);
    CHECK(land.consumed == 0);
    // Дало РОВНО объявленное: три хлеба на полу в счёт не пошли...
    CHECK(pool.needs(id).food == startFood + static_cast<float>(declaredEat));
    // ...и остались лежать все три (деяние их не тронуло).
    CHECK(reg.get<Pickup>(loose).count == 3);
    CHECK(room_of(fr, room)->supply[kVerbEat] == breadEat * 3);
}

// --- 5c. ЦЕНА HP СТАРШЕ ПОДГОНКИ -------------------------------------------
//
// В ящике две еды: рискованная КРУПНЕЕ и чистая помельче. Деяние обязано взять
// ЧИСТУЮ — ключ цены HP первый ([game/needs.h] выписывает довод числами). Без
// этого ключа аргмакс по величине всегда выбирал бы рискованную.
static void test_serve_prefers_free_food_over_risky() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const RoomId room = declare_room(fr, 80, 80, 80, kVerbEat, 1);
    const vec3 inside = cell_mid(81, 81, 80);
    CHECK(room_at_pos(fr, inside) == room);

    // Пара берётся ИЗ ЖИВОЙ ТАБЛИЦЫ: ищем платную еду и чистую, которая
    // СЛАБЕЕ её. Рукописные id были бы миной — строка items.csv может уехать.
    ItemId risky = kInvalidItem, clean = kInvalidItem;
    for (ItemId i = 1; i <= kItemCount; ++i) {
        if (kItemVerbs[i - 1][kVerbEat] <= 0) continue;
        if (consumable_hp_cost(i) > 0) {
            if (risky == kInvalidItem ||
                kItemVerbs[i - 1][kVerbEat] > kItemVerbs[risky - 1][kVerbEat])
                risky = i;
        }
    }
    CHECK(risky != kInvalidItem);
    for (ItemId i = 1; i <= kItemCount; ++i) {
        if (kItemVerbs[i - 1][kVerbEat] <= 0) continue;
        if (consumable_hp_cost(i) != 0) continue;
        if (kItemVerbs[i - 1][kVerbEat] >= kItemVerbs[risky - 1][kVerbEat]) continue;
        if (clean == kInvalidItem ||
            kItemVerbs[i - 1][kVerbEat] > kItemVerbs[clean - 1][kVerbEat])
            clean = i;
    }
    CHECK(clean != kInvalidItem);
    // ПОСЫЛКА СТЕНДА: платная еда действительно КРУПНЕЕ — иначе ключ величины
    // выбрал бы чистую и сам, и гейт проверял бы тавтологию.
    CHECK(kItemVerbs[risky - 1][kVerbEat] > kItemVerbs[clean - 1][kVerbEat]);

    Entity box = reg.create();
    reg.emplace<Transform>(box, inside, kLayer);
    {
        Container c;
        c.inv.slots[0] = ItemSlot{risky, 1, 255, 0};
        c.inv.slots[1] = ItemSlot{clean, 1, 255, 0};
        reg.emplace<Container>(box, c);
    }
    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    rooms_supply_rebuild(fr, reg, kLayer);
    pool.needs(id).food = 1.0f;
    const std::int16_t hpBefore = pool.hp(id);

    ServeTick t{};
    CHECK(serve_begin(ServeCtx{reg, pool, fr, nullptr, 7u}, e, id, inside, t));
    const std::uint16_t dur = act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;
    ServeTick land{};
    CHECK(!serve_busy(ServeCtx{reg, pool, fr, nullptr, 7u + dur}, e, id, inside,
                      kLayer, land));
    CHECK(land.consumed == 1);
    // Съедена ЧИСТАЯ: её слот опустел, рискованная цела, HP не тронуто.
    CHECK(reg.get<Container>(box).inv.slots[1].item == kInvalidItem);
    CHECK(reg.get<Container>(box).inv.slots[0].item == risky);
    CHECK(pool.hp(id) == hpBefore);
    CHECK(pool.needs(id).food == 1.0f + static_cast<float>(
                                            kItemVerbs[clean - 1][kVerbEat]));
}

// --- 6. ТОЛПА НЕ ВЫМИРАЕТ — И ВЫМИРАЕТ БЕЗ ПРЕДЛОЖЕНИЯ ---------------------
//
// ГЛАВНЫЙ ГЕЙТ ЗАХОДА, и он двуполярный по построению: та же толпа, тот же
// клок, та же длина прогона — разница ровно в том, предлагает ли комната
// что-нибудь. Без второй половины первая не значит ничего (толпа могла бы
// выживать потому, что клок слишком медленный).
//
// ПРОГОН В СЕКУНДАХ, А НЕ В КАДРАХ: шаг 0.08 с = РОВНО 10 тиков (125 Гц), и
// обе величины двигаются вместе — иначе окна деяний и клок разъехались бы.
// 1200 с выбраны не на глаз: вода — ПЕРВЫЙ падающий бар (static_assert в
// [game/needs.h]), и самый ПОЗДНИЙ срок смерти от жажды даёт самый щедрый
// бросок: 100 / 0.12 = 833 с до нуля плюс 100 HP при 0.5 HP/с = ещё 200 с,
// то есть 1033 с. Прогон обязан перекрывать этот срок, иначе «никто не умер»
// означало бы только «мы не дождались».
static std::uint32_t run_crowd(bool provisioned, std::uint32_t& servedOut) {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    // Обеспеченная комната объявляет ВСЕ четыре глагола нужд; пустая — ни
    // одного. Числа — политика модуля, и взяты те же, что у хрущей.
    std::int16_t declared[kVerbCount] = {};
    if (provisioned) {
        declared[kVerbSleep] = 30;
        declared[kVerbEat] = 12;
        declared[kVerbDrink] = 14;
        declared[kVerbToilet] = 20;
    }
    const RoomBox box{50, 50, 50, 4, 4, 1};
    const RoomId room = room_declare(fr, &box, 1, 0, 0, declared);
    CHECK(room != kNoRoom);
    const vec3 inside = cell_mid(51, 51, 50);
    CHECK(room_at_pos(fr, inside) == room);

    constexpr int kBodies = 32;
    NpcId ids[kBodies] = {};
    Entity bodies[kBodies] = {};
    for (int i = 0; i < kBodies; ++i) {
        bodies[i] = make_body(reg, pool, inside, ids[i]);
        // Разводим толпу по её суткам НАСТОЯЩИМ клоком — тем же приёмом, что
        // `needs_roll_resident`: состояние тела всегда такое, какое обычный
        // клок мог бы произвести.
        pool.needs(ids[i]) = needs_roll_resident(static_cast<std::uint32_t>(i + 1));
    }

    constexpr float kStep = 0.08f;        // с
    constexpr std::uint64_t kStepTicks = 10u; // РОВНО столько тиков в шаге
    constexpr int kSteps = 15000;         // 1200 с
    std::uint64_t tick = 0;
    ServeTick total{};
    for (int s = 0; s < kSteps; ++s) {
        needs_step(reg, pool, kLayer, kStep);
        for (int i = 0; i < kBodies; ++i) {
            if (pool.hp(ids[i]) <= 0) continue;
            const ServeCtx ctx{reg, pool, fr, nullptr, tick};
            if (serve_busy(ctx, bodies[i], ids[i], inside, kLayer, total))
                continue;
            serve_begin(ctx, bodies[i], ids[i], inside, total);
        }
        tick += kStepTicks;
    }
    // Считаем по HP строки пула, а не по `alive`: `finalize_deaths` стенд не
    // гоняет, и `alive` прочитался бы как «ноль мёртвых в мёртвом доме».
    std::uint32_t dead = 0;
    for (int i = 0; i < kBodies; ++i)
        if (pool.hp(ids[i]) <= 0) ++dead;
    servedOut = total.applied;
    return dead;
}

static void test_serve_crowd_lives_on_offer_and_dies_without_it() {
    std::uint32_t servedRich = 0, servedBare = 0;
    const std::uint32_t deadRich = run_crowd(/*provisioned=*/true, servedRich);
    const std::uint32_t deadBare = run_crowd(/*provisioned=*/false, servedBare);
    // ЦИКЛ ЗАМКНУТ: в обеспеченной комнате за 1200 с не умирает НИ ОДНО тело.
    CHECK(deadRich == 0);
    CHECK(servedRich > 0);
    // ...и это не потому, что клок медленный: та же толпа без предложения
    // вымирает ЦЕЛИКОМ, и деяний у неё НОЛЬ.
    CHECK(deadBare == 32);
    CHECK(servedBare == 0);
}

// ===========================================================================
// ОДНА ДВЕРЬ УТОЛЕНИЯ ДЛЯ ЛЮБОГО ТЕЛА (CANON S27.1, 2026-11-14)
// ===========================================================================
//
// «ИГРОК» ЗДЕСЬ — НАСТОЯЩЕЕ ТЕЛО С `CameraTag` (`embody_as_player`), а не
// голый `embody`: без камеры тело читается жителем (`decider_of`), и мутация
// «поллер только для жителей» выжила бы (Б3 ревью 2026-11-14).
static Entity make_human(Registry& reg, NpcPool& pool, const vec3& pos,
                         NpcId& idOut) {
    const NpcId id = pool.spawn();
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    const Entity e = embody_as_player(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos = pos;
    Needs& n = pool.needs(id);
    n = Needs{};
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = kNeedMax;
    n.seeded = 1;
    idOut = id;
    return e;
}

static std::uint8_t bag_count(const NpcPool& pool, NpcId id, ItemId item) {
    std::uint8_t n = 0;
    const Inventory& inv = pool.inventory(id);
    for (int i = 0; i < kInvSlots; ++i)
        if (inv.slots[i].item == item) n += inv.slots[i].count;
    return n;
}

// --- 9. ЖИТЕЛЬ И ЧЕЛОВЕК — ОДНА ДВЕРЬ, ОДИН ИСХОД ---------------------------
//
// Двое в одной комнате с краном, с одинаковой жаждой. Выбирают по-разному —
// житель одной суммой (`serve_begin`), человек сам (`serve_place_verb`, что
// место даст ему сейчас), — а окно открывает ОДНА дверь, опрашивает ОДИН
// поллер, и исход у них ОДИН: тот же глагол, та же длина окна, тот же прирост
// бара, та же очередь пищеварения.
static void test_serve_one_door_resident_and_human() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const std::int16_t offer = 14;
    const RoomId room = declare_room(fr, 70, 70, 70, kVerbDrink, offer);
    const vec3 inside = cell_mid(71, 71, 70);
    CHECK(room_at_pos(fr, inside) == room);

    NpcId rid = 0, hid = 0;
    const Entity res = make_body(reg, pool, inside, rid);
    const Entity hum = make_human(reg, pool, inside, hid);
    CHECK(decider_of(reg, res) == Decider::Resident); // посылки стенда
    CHECK(decider_of(reg, hum) == Decider::Human);
    const float thirsty = 10.0f;
    pool.needs(rid).water = thirsty;
    pool.needs(hid).water = thirsty;

    constexpr std::uint64_t kT0 = 200u;
    ServeTick t{};
    const ServeCtx ctx{reg, pool, fr, nullptr, kT0};
    CHECK(serve_begin(ctx, res, rid, inside, t));
    const VerbId hv = serve_place_verb(ctx, hid, inside);
    CHECK(hv == kVerbDrink);
    CHECK(serve_start(ctx, hum, hid, inside, hv, kInvalidItem, t) ==
          ServeRefusal::None);
    CHECK(t.began == 2);
    const ActWindow& wr = act_slot(reg.get<Acting>(res), ActSlot::Body);
    const ActWindow& wh = act_slot(reg.get<Acting>(hum), ActSlot::Body);
    CHECK(wr.action == wh.action);
    CHECK(wr.durTicks == wh.durTicks);
    CHECK(wr.item == kInvalidItem && wh.item == kInvalidItem);

    // НЕТ МГНОВЕННОГО ПУТИ: до контактного кадра бар не тронут ни у кого.
    ServeTick mid{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, kT0 + wr.durTicks - 1}, kLayer,
               mid);
    CHECK(mid.holding == 2);
    CHECK(mid.applied == 0);
    CHECK(pool.needs(rid).water == thirsty);
    CHECK(pool.needs(hid).water == thirsty);

    // КОНТАКТ — ОДИН ПОЛЛЕР ДЛЯ ОБОИХ. Мутация «поллер только для жителей»
    // (`decider_of != Resident → continue` в `serve_step`) красит строки
    // человека ниже: его окно истекло бы, а эффект не упал никогда.
    ServeTick land{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, kT0 + wr.durTicks}, kLayer,
               land);
    CHECK(land.applied == 2);
    CHECK(pool.needs(rid).water == thirsty + static_cast<float>(offer));
    CHECK(pool.needs(hid).water == pool.needs(rid).water);
    CHECK(pool.needs(hid).pendingPee == pool.needs(rid).pendingPee);
    CHECK(pool.needs(hid).pendingPee > 0.0f);

    // ...А ВЫБИРАЮТ ОНИ ПО-РАЗНОМУ, и это развилка решателя (S13.7a), а не
    // вторая дверь. Умеренная жажда — ВЫШЕ колена терпения строки: житель её
    // ещё терпит (сумма отвечает «ничего»), а человек решает сам, и F у крана
    // обязан напоить его, а не ответить «не хочется» (Б2 ревью 2026-11-14).
    // Мутация «выбиратель человека по кривой терпения» красит строку человека.
    const float mild = 60.0f;
    CHECK(needs_low_pressure(kVerbDrink, mild) == 0.0f); // посылка: житель терпит
    pool.needs(rid).water = mild;
    pool.needs(hid).water = mild;
    const std::uint64_t kT1 = kT0 + wr.durTicks + 1u;
    ServeTick t2{};
    CHECK(!serve_begin(ServeCtx{reg, pool, fr, nullptr, kT1}, res, rid, inside,
                       t2));
    CHECK(t2.nothing == 1);
    CHECK(serve_place_verb(ServeCtx{reg, pool, fr, nullptr, kT1}, hid, inside) ==
          kVerbDrink);
}

// --- 10. СВОЯ СУМКА: ВЫБРАННЫЙ ПРЕДМЕТ, ВРЕМЯ, ЦЕНА ОДИН РАЗ ---------------
static void test_serve_bag_item_is_the_chosen_one() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();
    FloorRooms fr;
    rooms_reset(fr);
    const vec3 corridor = cell_mid(90, 90, 90); // комнаты нет: сумке она не нужна
    CHECK(room_at_pos(fr, corridor) == kNoRoom);

    const ItemId bread = item_by_string("bread");
    const ItemId ration = item_by_string("liquidator_ration");
    const ItemId risky = item_by_string("experimental_concentrate");
    CHECK(bread != kInvalidItem && ration != kInvalidItem &&
          risky != kInvalidItem);
    // РАЗЛИЧИМОСТЬ СТЕНДА (Б3 ревью): оба бесплатны, а паёк крупнее хлеба —
    // значит любое правило «лучшего» (цена, затем аргмакс) выбрало бы ПАЁК, и
    // съеденный ХЛЕБ доказывает, что окно помнит выбор, а не судит заново.
    CHECK(consumable_hp_cost(bread) == 0 && consumable_hp_cost(ration) == 0);
    CHECK(kItemVerbs[ration - 1][kVerbEat] > kItemVerbs[bread - 1][kVerbEat]);
    CHECK(consumable_hp_cost(risky) > 0);
    CHECK(serve_item_verb(bread) == kVerbEat);

    NpcId hid = 0;
    const Entity hum = make_human(reg, pool, corridor, hid);
    Inventory& inv = pool.inventory(hid);
    inv.slots[0] = ItemSlot{ration, 1, 255, 0};
    inv.slots[1] = ItemSlot{bread, 1, 255, 0};
    inv.slots[2] = ItemSlot{risky, 1, 255, 0};
    const float hungry = 20.0f;
    pool.needs(hid).food = hungry;

    constexpr std::uint64_t kT0 = 50u;
    ServeTick t{};
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT0}, hum, hid, corridor,
                      kVerbEat, bread, t) == ServeRefusal::None);
    const ActWindow& w = act_slot(reg.get<Acting>(hum), ActSlot::Body);
    CHECK(w.item == bread);
    CHECK(w.action == kVerbAction[kVerbEat]); // длина — у глагола (трапеза)
    // До контакта ни бар, ни сумка не тронуты.
    ServeTick mid{};
    serve_step(ServeCtx{reg, pool, fr, &bus, kT0 + w.durTicks - 1}, kLayer, mid);
    CHECK(pool.needs(hid).food == hungry);
    CHECK(bag_count(pool, hid, bread) == 1);
    ServeTick land{};
    serve_step(ServeCtx{reg, pool, fr, &bus, kT0 + w.durTicks}, kLayer, land);
    CHECK(land.applied == 1);
    CHECK(land.bag == 1);
    CHECK(bag_count(pool, hid, bread) == 0);  // съеден ХЛЕБ...
    CHECK(bag_count(pool, hid, ration) == 1); // ...а не паёк
    CHECK(pool.needs(hid).food ==
          hungry + static_cast<float>(kItemVerbs[bread - 1][kVerbEat]));
    CHECK(bus.total_count(EventType::Deed) == 1); // факт съеденного — в шину

    // РИСКОВАННАЯ ЕДА: HP списывается РОВНО ОДИН РАЗ — на контакте, каналом
    // мимо брони. Второе списание жило в приложении и могло убить.
    const std::int16_t hpBefore = pool.hp(hid);
    const std::uint64_t kT1 = kT0 + w.durTicks + 1u;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT1}, hum, hid, corridor,
                      kVerbEat, risky, t) == ServeRefusal::None);
    CHECK(pool.hp(hid) == hpBefore); // открыть окно — не значит съесть
    ServeTick land2{};
    serve_step(ServeCtx{reg, pool, fr, &bus, kT1 + w.durTicks}, kLayer, land2);
    CHECK(land2.bag == 1);
    CHECK(pool.hp(hid) == hpBefore - consumable_hp_cost(risky));

    // ОТКАЗЫ ЗНАЧЕНИЕМ. Предмета нет в сумке:
    const std::uint64_t kT2 = kT1 + w.durTicks + 1u;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT2}, hum, hid, corridor,
                      kVerbEat, bread, t) == ServeRefusal::NoItem);
    // ...сытому есть некуда (паёк остался, а бар полон):
    pool.needs(hid).food = kNeedMax;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT2}, hum, hid, corridor,
                      kVerbEat, ration, t) == ServeRefusal::Full);
    // ...глагол не того предмета — тоже отказ, а не «окно трапезы над бинтом»:
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT2}, hum, hid, corridor,
                      kVerbDrink, ration, t) == ServeRefusal::NoRow);
    // ...аптечкой утолить нельзя: у `heal` нет строки деяния (данные), и
    // кнопки «Использовать» у неё нет — инвентарь спрашивает ту же функцию.
    const ItemId bandage = item_by_string("bandage");
    CHECK(bandage != kInvalidItem);
    CHECK(serve_item_verb(bandage) >= kVerbCount);
    // ...а питьё в коридоре — «здесь нечем»: место не даёт, тело — тоже.
    pool.needs(hid).water = 10.0f;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT2}, hum, hid, corridor,
                      kVerbDrink, kInvalidItem, t) == ServeRefusal::NoPlace);

    // ПРЕДМЕТ УШЁЛ ЗА ВРЕМЯ ОКНА — деяние впустую, без эффекта и без дюпа.
    pool.needs(hid).food = hungry;
    const std::uint64_t kT3 = kT2 + 1u;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT3}, hum, hid, corridor,
                      kVerbEat, ration, t) == ServeRefusal::None);
    pool.inventory(hid).slots[0] = ItemSlot{}; // выбросил посреди трапезы
    ServeTick gone{};
    serve_step(ServeCtx{reg, pool, fr, &bus, kT3 + w.durTicks}, kLayer, gone);
    CHECK(gone.applied == 0);
    CHECK(pool.needs(hid).food == hungry);
}

// --- 11. ТЕЛО УШЛО ОТ ДЕЛА — ОКНО РВЁТСЯ (закон 5) ------------------------
//
// Человека уводит его собственная команда движения, жителя — заявка сильнее
// дела. Одна причина (`leave`), развилка решателя у одного вызывающего.
static void test_serve_leaving_breaks_the_window() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    const RoomId room = declare_room(fr, 80, 80, 80, kVerbDrink, 14);
    const vec3 inside = cell_mid(81, 81, 80);
    CHECK(room_at_pos(fr, inside) == room);
    NpcId rid = 0, hid = 0;
    const Entity res = make_body(reg, pool, inside, rid);
    const Entity hum = make_human(reg, pool, inside, hid);
    pool.needs(rid).water = 10.0f;
    pool.needs(hid).water = 10.0f;
    constexpr std::uint64_t kT0 = 5u;
    ServeTick t{};
    const ServeCtx ctx{reg, pool, fr, nullptr, kT0};
    CHECK(serve_begin(ctx, res, rid, inside, t));
    CHECK(serve_start(ctx, hum, hid, inside, kVerbDrink, kInvalidItem, t) ==
          ServeRefusal::None);
    const std::uint16_t dur = act_slot(reg.get<Acting>(hum), ActSlot::Body).durTicks;

    // ПОРОГ — ТОТ ЖЕ, ЧТО У САМОГО ХОДА (`kWishMinLen`): шорох ниже порога не
    // рвёт, команда «вперёд» — рвёт. Мутация «убрать ветку человека в
    // `body_left`» красит `broke == 1` и бар ниже.
    reg.get<Controller>(hum).wishDir = vec3{kWishMinLen * 0.5f, 0.0f, 0.0f};
    ServeTick still{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, kT0 + 1u}, kLayer, still);
    CHECK(still.broke == 0);
    CHECK(still.holding == 2);
    reg.get<Controller>(hum).wishDir = vec3{1.0f, 0.0f, 0.0f};
    ServeTick walk{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, kT0 + 2u}, kLayer, walk);
    CHECK(walk.broke == 1);   // ушёл человек...
    CHECK(walk.holding == 1); // ...а житель, которого никто не уводил, стоит
    reg.get<Controller>(hum).wishDir = vec3{0.0f, 0.0f, 0.0f};
    ServeTick end{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, kT0 + dur}, kLayer, end);
    CHECK(end.applied == 1);
    CHECK(pool.needs(hid).water == 10.0f); // ушедший не напился
    CHECK(pool.needs(rid).water > 10.0f);
}

// --- 12. НЕОПЛАЧЕННЫЙ КОНТАКТ — ТОЖЕ ЗАНЯТОСТЬ (Б1/Б6 ревью) ---------------
//
// Окно истекло, а его конечный эффект ещё никто не снял (поллер этого тика
// тело не посетил). Такое окно ОТКРЫТО: держит тело, не даёт себя
// перезаписать — и рвётся законной причиной, если тело увели. Мутация
// «`act_open` → `act_busy` в `acting_begin`» красит отказ `Busy` ниже: новое
// окно перезаписало бы старое, и эффект пропал бы молча.
static void test_serve_unpaid_contact_is_still_open() {
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    declare_room(fr, 60, 20, 60, kVerbDrink, 14);
    const vec3 inside = cell_mid(61, 21, 60);
    NpcId id = 0;
    const Entity e = make_body(reg, pool, inside, id);
    pool.needs(id).water = 10.0f;
    constexpr std::uint64_t kT0 = 3u;
    ServeTick t{};
    CHECK(serve_begin(ServeCtx{reg, pool, fr, nullptr, kT0}, e, id, inside, t));
    const std::uint16_t dur = act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;
    const std::uint64_t late = kT0 + dur + 5u; // далеко за концом, опроса не было
    CHECK(!acting_busy(reg.get<Acting>(e), ActSlot::Body, late));
    CHECK(serve_holding(reg, e, late));
    ServeTick again{};
    CHECK(serve_start(ServeCtx{reg, pool, fr, nullptr, late}, e, id, inside,
                      kVerbDrink, kInvalidItem, again) == ServeRefusal::Busy);
    CHECK(!serve_begin(ServeCtx{reg, pool, fr, nullptr, late}, e, id, inside,
                       again));
    CHECK(again.began == 0 && again.nothing == 0 && again.corridor == 0);
    // ПРИЧИНА — «ЗАНЯТ», даже если и пить уже не хочется: занятость старше
    // остальных ответов (человеку, жмущему F посреди трапезы, нужна именно
    // она). Мутация «снять проверку занятости в `serve_start`» отдаёт здесь
    // `Full` — пробы отвечают раньше, чем откажет `acting_begin`.
    {
        const float keep = pool.needs(id).water;
        pool.needs(id).water = kNeedMax;
        CHECK(serve_start(ServeCtx{reg, pool, fr, nullptr, late}, e, id, inside,
                          kVerbDrink, kInvalidItem, again) == ServeRefusal::Busy);
        pool.needs(id).water = keep;
    }
    // ...и долг отдаётся первым же опросом — эффект не потерян.
    ServeTick pay{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, late}, kLayer, pay);
    CHECK(pay.applied == 1);
    CHECK(pool.needs(id).water > 10.0f);
    CHECK(!serve_holding(reg, e, late));

    // ТА ЖЕ ФОРМА, НО ТЕЛО УВЕЛИ: обрыв судит одна дверь (`break_action`),
    // присваивания мимо неё больше нет (S22.7).
    pool.needs(id).water = 10.0f;
    const std::uint64_t kT1 = late + 1u;
    CHECK(serve_begin(ServeCtx{reg, pool, fr, nullptr, kT1}, e, id, inside, t));
    const std::uint64_t late2 = kT1 + dur + 2u;
    CHECK(break_action(reg.get<Acting>(e), ActSlot::Body, kBreakLeave, late2)
              .broken);
    ServeTick after{};
    serve_step(ServeCtx{reg, pool, fr, nullptr, late2}, kLayer, after);
    CHECK(after.applied == 0);
    CHECK(pool.needs(id).water == 10.0f);
}

// --- 13. ОБЛЕГЧЕНИЕ: ВЕЛИЧИНА — ТЕЛО, ЛУЖА — МЕСТО, ФАКТ — ВСЕГДА ---------
static void test_serve_relief_anywhere_puddle_by_place() {
    // МИР С ПОЛОМ: лужа — стейн на твёрдых атомах, без мира её не проверить.
    World w;
    for (int y = 28; y < 36; ++y)
        for (int x = 28; x < 36; ++x) w.grid().fill_cell(x, y, 9, 1);
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();
    FloorRooms fr;
    rooms_reset(fr);
    const RoomId wc = declare_room(fr, 30, 30, 10, kVerbToilet, 20);
    const vec3 inWc = cell_mid(31, 31, 10);
    const vec3 corridor = cell_mid(34, 34, 10);
    CHECK(room_at_pos(fr, inWc) == wc);
    CHECK(room_at_pos(fr, corridor) == kNoRoom);

    NpcId hid = 0;
    const Entity hum = make_human(reg, pool, corridor, hid);
    std::vector<std::uint32_t> dirty;
    // Пустое тело: облегчаться нечем — отказ значением.
    ServeTick t{};
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, 10u, &w, &dirty}, hum, hid,
                      corridor, kVerbToilet, kInvalidItem, t) ==
          ServeRefusal::Full);

    // В КОРИДОРЕ — окно облегчения (клавиша P), опорожнение ЦЕЛИКОМ, лужа и
    // факт в шину (уместность судит свидетель, не дверь).
    pool.needs(hid).pee = 60.0f;
    pool.needs(hid).poo = 30.0f;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, 10u, &w, &dirty}, hum, hid,
                      corridor, kVerbToilet, kInvalidItem, t) ==
          ServeRefusal::None);
    const std::uint16_t dur = act_slot(reg.get<Acting>(hum), ActSlot::Body).durTicks;
    CHECK(dur == ms_to_ticks(kActionDurMs[kVerbAction[kVerbToilet]]));
    ServeTick land{};
    serve_step(ServeCtx{reg, pool, fr, &bus, 10u + dur, &w, &dirty}, kLayer, land);
    CHECK(land.applied == 1);
    CHECK(pool.needs(hid).pee == 0.0f);
    CHECK(pool.needs(hid).poo == 0.0f);
    CHECK(land.puddles == 1);
    CHECK(!dirty.empty());
    CHECK(bus.total_count(EventType::Deed) == 1);

    // В САНУЗЛЕ — то же опорожнение, но лужи НЕТ: место даёт сортир (тот же
    // предикат `room_offers`, которым свидетель зануляет цену).
    dirty.clear();
    reg.get<Transform>(hum).pos = inWc;
    pool.needs(hid).pee = 60.0f;
    const std::uint64_t kT1 = 10u + dur + 1u;
    CHECK(serve_start(ServeCtx{reg, pool, fr, &bus, kT1, &w, &dirty}, hum, hid,
                      inWc, kVerbToilet, kInvalidItem, t) == ServeRefusal::None);
    ServeTick land2{};
    serve_step(ServeCtx{reg, pool, fr, &bus, kT1 + dur, &w, &dirty}, kLayer,
               land2);
    CHECK(land2.applied == 1);
    CHECK(pool.needs(hid).pee == 0.0f);
    CHECK(land2.puddles == 0);
    CHECK(dirty.empty());
    CHECK(bus.total_count(EventType::Deed) == 2);

    // F НА МЕСТЕ НЕ МОЧИТСЯ В КОРИДОРЕ: выбиратель человека берёт только то,
    // что место ПРЕДЛАГАЕТ (жалоба владельца 2026-08-28). В санузле — да.
    pool.needs(hid).pee = 60.0f;
    CHECK(serve_place_verb(ServeCtx{reg, pool, fr, nullptr, 0u}, hid, corridor) >=
          kVerbCount);
    CHECK(serve_place_verb(ServeCtx{reg, pool, fr, nullptr, 0u}, hid, inWc) ==
          kVerbToilet);
    // ...и в КОМНАТЕ, где сортира нет (кухня с краном), — тоже нет: у
    // облегчения величину называет тело, поэтому проба «что ляжет» ответила бы
    // «да» где угодно, и держит здесь именно фильтр «место ПРЕДЛАГАЕТ».
    const RoomId kitchen = declare_room(fr, 40, 30, 10, kVerbDrink, 14);
    const vec3 inKitchen = cell_mid(41, 31, 10);
    CHECK(room_at_pos(fr, inKitchen) == kitchen);
    CHECK(pool.needs(hid).water == kNeedMax); // пить не хочет — пробы нет
    CHECK(serve_place_verb(ServeCtx{reg, pool, fr, nullptr, 0u}, hid,
                           inKitchen) >= kVerbCount);
}

static void test_serve_all() {
    test_serve_pick_is_the_same_sum_filtered();
    test_serve_begins_on_demand_times_offer();
    test_serve_effect_lands_at_window_end_once();
    test_serve_eat_queues_and_toilet_relieves();
    test_serve_consumes_what_lies_in_the_room();
    test_serve_ignores_loose_loot();
    test_serve_prefers_free_food_over_risky();
    test_serve_crowd_lives_on_offer_and_dies_without_it();
    test_serve_one_door_resident_and_human();
    test_serve_bag_item_is_the_chosen_one();
    test_serve_leaving_breaks_the_window();
    test_serve_unpaid_contact_is_still_open();
    test_serve_relief_anywhere_puddle_by_place();
}

} // namespace serve_suite

static void test_serve_all() { serve_suite::test_serve_all(); }

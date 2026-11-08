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
    Needs p;
    p.pee = 30.0f;
    p.poo = 5.0f;
    const SatisfyResult relief = needs_satisfy(p, kVerbToilet, 20.0f);
    CHECK(relief.served);
    CHECK(p.pee == 10.0f);
    CHECK(p.poo == 0.0f);
    CHECK(relief.gained == 25.0f); // 20 снято с мочевого + 5 с кишечника

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

static void test_serve_all() {
    test_serve_pick_is_the_same_sum_filtered();
    test_serve_begins_on_demand_times_offer();
    test_serve_effect_lands_at_window_end_once();
    test_serve_eat_queues_and_toilet_relieves();
    test_serve_consumes_what_lies_in_the_room();
    test_serve_ignores_loose_loot();
    test_serve_prefers_free_food_over_risky();
    test_serve_crowd_lives_on_offer_and_dies_without_it();
}

} // namespace serve_suite

static void test_serve_all() { serve_suite::test_serve_all(); }

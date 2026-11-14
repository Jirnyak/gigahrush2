// Деяние нужды — одна дверь утоления для любого тела. Законы и выводы — в serve.h.

#include "game/serve.h"

#include "ecs/components.h"    // Transform, Controller — комната предмета, ввод человека
#include "game/action.h"       // Acting / acting_begin_ms / acting_take_apply / act_open
#include "game/action_table.h" // kActionVerb / kVerbAction / kActionDurMs
#include "game/ai.h"           // decider_of — развилка решателя (S13.7a), закон 5
#include "game/combat.h"       // apply_damage — цена сомнительной еды
#include "game/container.h"    // Container — ящики И трупы (один держатель)
#include "game/embody.h"       // NpcRef — вид поллера
#include "game/event_bus.h"    // ItemTransferred — предмет сменил хозяина
#include "game/guide.h"        // steer_claimed_by_stronger / SteerRank — закон 5
#include "game/item_table.h"   // kItemVerbs / item_valid
#include "game/loot.h"         // Pickup — предметы на полу (вклад вычитается)
#include "game/needs.h"        // needs_satisfy / apply_consumable / kAttritionChannel
#include "game/room_supply.h"  // room_at_pos / supply_add_item
#include "game/witness.h"      // deed_publish — эффект утоления есть факт (S19)
#include "sim/controller.h"    // kWishMinLen — порог хода, один дом числа

namespace giga::game {

namespace {

// Глагол, который обслуживает открытое окно. kVerbCount = «это не деяние
// нужды» (боевое окно или пустой слот): осмыслен `action` только при
// ненулевой длине ([game/action.h]).
VerbId window_verb(const ActWindow& w) {
    if (w.durTicks == 0 || w.action >= kActionCount)
        return static_cast<VerbId>(kVerbCount);
    return kActionVerb[w.action];
}

// ЧТО ИМЕННО ВЗЯТЬ ИЗ ТОГО, ЧТО ЛЕЖИТ (S12.5). Ответ — ящик и слот в нём;
// пустой `box == entt::null` значит «расходуемого в комнате нет», и тогда
// деяние опирается на возможность места.
//
// ВЫБОР — ДВУХКЛЮЧЕВОЙ. Первый ключ — ЦЕНА HP (`consumable_hp_cost`): даровое
// бьёт платное при любой подгонке, и довод к этому выписан числами в
// [game/needs.h] («платить дефицитным HP за 1–8 очков изобильной еды — задом
// наперёд»; 4 строки из 21 кормящей берут 6 HP). Без этого ключа толпа
// предпочитала бы САМУЮ КРУПНУЮ порцию, то есть ровно рискованную. Второй
// ключ — величина глагола, АРГМАКС, а не «первый найденный»: первый
// подходящий превратил бы порядок хранения в правило мира (S13.9 запрещает
// это буквально).
//
// ПРАВИЛА ВЫБОРА ИЗ СВОЕЙ СУМКИ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ (2026-11-14): предмет
// своей сумки выбирает тот, кто открыл окно (человек — кнопкой «Использовать»),
// и окно его ПОМНИТ (`ActWindow::item`). Снесённый `use_best_for@needs.cpp`
// держал второе правило («наименьшая покрывающая») ради консольных `eat`/
// `drink` — они умерли вместе с ним; третьей копии правила не появилось.
//
// Величина берётся из `kItemVerbs`, то есть из колонки `use_a` строки
// предмета, — та же, которой потом утолит `apply_consumable`, поэтому выбор и
// эффект не могут разъехаться. Ничья уходит МЛАДШЕМУ id предмета, тем же
// законом, которым ничья комнат уходит младшему RoomId.
//
// ОБХОД — ТОЛЬКО КОНТЕЙНЕРЫ (ящики и трупы: один держатель, [container.h]).
// ПИКАПЫ НА ПОЛУ В ДЕЯНИЕ НЕ ВХОДЯТ, и это названное решение, а не упущение:
// изъять пикап целиком значит УНИЧТОЖИТЬ сущность, а уничтожать её из живого
// обхода вида нельзя (`mob_attack_step` разрезан на две фазы ровно поэтому).
// Поэтому вклад пикапов ВЫЧИТАЕТСЯ из величины деяния ниже — иначе лежащий
// хабар давал бы комнате очки, которые деяние выдаёт вечно и ни разу не
// тратит. Долг назван в S24.7.
struct Lying {
    Entity box = entt::null;
    int slot = -1;
    ItemId item = kInvalidItem;
    std::int16_t amount = 0;
    bool free = false; // цена HP == 0
};
Lying best_lying(Registry& reg, const FloorRooms& fr, RoomId room, LayerId layer,
                 VerbId verb) {
    Lying out;
    if (verb >= kVerbCount) return out;
    for (auto [e, c, t] : reg.view<Container, const Transform>().each()) {
        if (t.layer != layer) continue;
        if (room_at_pos(fr, t.pos) != room) continue;
        for (int i = 0; i < kInvSlots; ++i) {
            const ItemSlot& s = c.inv.slots[i];
            if (s.item == kInvalidItem || s.count == 0) continue;
            if (!item_valid(s.item)) continue;
            const std::int16_t amt = kItemVerbs[s.item - 1][verb];
            if (amt <= 0) continue;
            const bool noCost = consumable_hp_cost(s.item) == 0;
            if (out.slot >= 0) {
                // КЛЮЧ 1: класс цены решает безусловно.
                if (noCost != out.free) {
                    if (!noCost) continue;
                } else if (amt < out.amount ||
                           (amt == out.amount && s.item >= out.item)) {
                    continue; // КЛЮЧ 2: величина, ничья — младшему id
                }
            }
            out.box = e;
            out.slot = i;
            out.item = s.item;
            out.amount = amt;
            out.free = noCost;
        }
    }
    return out;
}

// ВКЛАД ЛЕЖАЩЕГО НА ПОЛУ ХАБАРА в предложение комнаты по этому глаголу.
// Вычитается из величины деяния: пикап деянием не изымается (см. выше), а
// значит и платить им нельзя — иначе одна брошенная банка кормила бы этаж.
std::int32_t pickup_offer(Registry& reg, const FloorRooms& fr, RoomId room,
                          LayerId layer, VerbId verb) {
    std::int32_t sum = 0;
    if (verb >= kVerbCount) return sum;
    for (auto [e, p, t] : reg.view<const Pickup, const Transform>().each()) {
        if (t.layer != layer) continue;
        if (p.item == kInvalidItem || !item_valid(p.item)) continue;
        if (room_at_pos(fr, t.pos) != room) continue;
        sum += static_cast<std::int32_t>(kItemVerbs[p.item - 1][verb]) *
               static_cast<std::int32_t>(p.count);
    }
    return sum;
}

// Первый слот своей сумки с ЭТИМ предметом; -1 — предмета нет (выбросил,
// отдал, продал за время окна). Какой из одинаковых слотов — неважно: стек
// одного предмета неразличим, и правила выбора здесь нет по построению.
int bag_slot_of(const Inventory& inv, ItemId item) {
    for (int i = 0; i < kInvSlots; ++i)
        if (inv.slots[i].item == item && inv.slots[i].count > 0) return i;
    return -1;
}

// Предложение места по глаголу — объявлено + запас, ТО ЖЕ число, что у
// `serve_pick` и `place_interest` (S12.4: «K чисел на комнату — всё предложение
// целиком»). nullptr — коридор, ноль.
std::int32_t place_offer(const Room* r, VerbId verb) {
    if (r == nullptr || verb >= kVerbCount) return 0;
    return static_cast<std::int32_t>(r->declared[verb]) + r->supply[verb];
}

// ЛУЖА — `relief_puddle@game/needs.h`: один дом на оба канала облегчения
// (невольный слив клока и осознанное облегчение двери).

// КОНТАКТНЫЙ КАДР: эффект падает ОДИН раз за окно. Считает путь — своя сумка,
// ящик комнаты или возможность места/тела — и публикует факт.
void land_effect(const ServeCtx& ctx, Entity e, NpcId id, const vec3& pos,
                 LayerId layer, VerbId verb, ItemId item, ServeTick& out) {
    Needs& n = ctx.pool.needs(id);

    // (1) ПРЕДМЕТ СВОЕЙ СУМКИ — ровно тот, что выбран при открытии окна.
    // Комната не нужна: хлеб в кармане ест и тот, кто стоит в коридоре.
    if (item != kInvalidItem) {
        Inventory& inv = ctx.pool.inventory(id);
        const int slot = bag_slot_of(inv, item);
        if (slot < 0) return; // предмет ушёл за время окна — деяние впустую
        const ConsumeResult res = apply_consumable(n, item, ctx.pool.hp(id));
        if (!res.used) return;
        if (--inv.slots[slot].count == 0) inv.slots[slot] = ItemSlot{};
        // ЦЕНА СОМНИТЕЛЬНОЙ ЕДЫ — ОДИН РАЗ, одной дверью урона, на канале,
        // которого броня не видит. До 2026-11-14 у носителя камеры она
        // списывалась ДВАЖДЫ: здесь-же-по-смыслу (`use_best_for`) и второй раз в
        // приложении каналом Kinetic, через броню и после пола hp−1 — то есть
        // рискованная еда могла убить.
        if (res.hpCost > 0)
            apply_damage(ctx.reg, ctx.pool, e, res.hpCost, kAttritionChannel,
                         entt::null);
        if (ctx.bus != nullptr) {
            ctx.bus->publish(EventType::ItemTransferred, id, kInvalidNpc, item,
                             ctx.tick);
            deed_publish(*ctx.bus, verb, e, kInvalidNpc, pos, ctx.tick);
        }
        ++out.bag;
        ++out.applied;
        out.reliefSum += static_cast<std::int32_t>(res.food + res.water +
                                                   res.sleep);
        return;
    }

    const RoomId room = room_at_pos(ctx.fr, pos);
    const Room* r = room_of(ctx.fr, room);

    // (2) РАСХОДУЕМОЕ КОМНАТЫ ПЕРВЫМ (закон 3): если в комнате лежит то, чем
    // этот глагол утоляют, тело берёт ЭТО, и величину называет строка предмета.
    if (r != nullptr) {
        const Lying pick = best_lying(ctx.reg, ctx.fr, room, layer, verb);
        if (pick.slot >= 0) {
            const ConsumeResult res =
                apply_consumable(n, pick.item, ctx.pool.hp(id));
            if (res.used) {
                Container& c = ctx.reg.get<Container>(pick.box);
                if (--c.inv.slots[pick.slot].count == 0)
                    c.inv.slots[pick.slot] = ItemSlot{};
                // Запас комнаты падает ТЕМ ЖЕ хуком, которым растёт (S12.4
                // «инкрементально, событием»): следующий голодный видит меньше.
                supply_add_item(ctx.fr, room, pick.item, -1);
                // Цена — та же одна дверь урона, что у предмета своей сумки.
                if (res.hpCost > 0)
                    apply_damage(ctx.reg, ctx.pool, e, res.hpCost,
                                 kAttritionChannel, entt::null);
                if (ctx.bus != nullptr) {
                    ctx.bus->publish(EventType::ItemTransferred, id, kInvalidNpc,
                                     pick.item, ctx.tick);
                    deed_publish(*ctx.bus, verb, e, kInvalidNpc, pos, ctx.tick);
                }
                ++out.consumed;
                ++out.applied;
                out.reliefSum += static_cast<std::int32_t>(res.food + res.water +
                                                           res.sleep);
                return;
            }
            // ВЕЩЬ ВЗЯЛИ, А ОНА НЕ СРАБОТАЛА — деяние впустую, и на
            // возможность места оно НЕ падает: иначе место заплатило бы очками
            // предмета, которого не израсходовало.
            //
            // ПУТЬ СЕГОДНЯ НЕДОСТИЖИМ, И ЭТО ПРОВЕРЕНО МУТАЦИЕЙ (она выжила —
            // значит ветку не трогает ни один гейт, потому что её не достигает
            // ни один вход). Инвариант, который её держит: `kItemVerbs` ВЫВЕДЕН
            // из `use_effect` отображением `USE_VERB@tools/gen_item_table.py`,
            // то есть глагол у предмета есть ровно тогда, когда у него есть
            // эффект; а глаголы, чей эффект `apply_consumable` не применяет
            // (`heal`), строки деяния не имеют и до сюда не доходят. Поэтому
            // здесь СТОИТ ВЕТКА, А НЕ АРИФМЕТИКА.
            return;
        }
    }

    // (3) ВОЗМОЖНОСТЬ МЕСТА ИЛИ ТЕЛА: объявленное + оснащение по этому глаголу.
    // Величина пересчитывается НА КОНТАКТНОМ КАДРЕ, а не запоминается в начале
    // окна: «сколько дало место» есть свойство места в момент деяния.
    //
    // ВЫЧИТАЕТСЯ ВКЛАД ЛЕЖАЩЕГО НА ПОЛУ ХАБАРА: его деяние не изымает (см.
    // `pickup_offer`), а значит и платить им не вправе.
    //
    // ВНЕ КОМНАТЫ ВЕЛИЧИНА НОЛЬ, и `needs_satisfy` отвечает на неё сам: запасу
    // ноль места не даёт ничего (`served == false`), а облегчение величину
    // берёт у ТЕЛА — опорожняешься целиком где застало. Ветки «если сортир»
    // здесь нет: разницу держит клок нужд, единственный, кто знает, какой бар
    // растёт, а какой падает.
    const std::int32_t points =
        r != nullptr
            ? place_offer(r, verb) - pickup_offer(ctx.reg, ctx.fr, room, layer, verb)
            : 0;
    const SatisfyResult sat =
        needs_satisfy(n, verb, static_cast<float>(points > 0 ? points : 0));
    if (!sat.served || sat.gained <= 0.0f) return;
    ++out.applied;
    out.reliefSum += static_cast<std::int32_t>(sat.gained);

    // ЛУЖА — моча вышла не у места, которое даёт сортир. Предикат тот же, что у
    // свидетеля (`room_offers`): лужа и цена судят одно и то же «уместно ли».
    if (sat.relievedPee > 0.0f && !room_offers(r, verb) && ctx.world != nullptr &&
        ctx.stainDirty != nullptr) {
        relief_puddle(*ctx.world, pos,
                      static_cast<std::uint32_t>(ctx.tick) ^
                          static_cast<std::uint32_t>(entt::to_integral(e)),
                      *ctx.stainDirty);
        ++out.puddles;
    }
    // ФАКТ (S19): каждый севший эффект — деяние в шину. Цену судит свидетель
    // по данным глагола (`kVerbRelDelta`/`kVerbRepDelta`): у еды и сна цена
    // ноль, у облегчения вне уместного места — есть. Новая цена = правка CSV,
    // не правка здесь (закон публикации [game/witness.h]).
    if (ctx.bus != nullptr)
        deed_publish(*ctx.bus, verb, e, kInvalidNpc, pos, ctx.tick);
}

// ТЕЛО УШЛО ОТ ДЕЛА? (закон 5) Развилка решателя (S13.7a) — здесь, у
// единственного вызывающего, а не битом на теле: жителя уводит заявка сильнее
// дела (бегство, наряд), человека — его собственная команда движения. Ключ —
// РОД РЕШАТЕЛЯ, а не наличие компонента `Controller`: второй источник правды о
// том, кто человек, рядом с `CameraTag` S13.7a запрещает (ревью 2026-11-14).
bool body_left(const Registry& reg, Entity e, std::uint64_t tick) {
    switch (decider_of(reg, e)) {
        case Decider::Resident:
            return steer_claimed_by_stronger(reg, e, SteerRank::Errand, tick);
        case Decider::Human: {
            const Controller* c = reg.try_get<Controller>(e);
            return c != nullptr && length(c->wishDir) > kWishMinLen;
        }
        case Decider::Monster:
        case Decider::None:
            return false; // окон деяния у них не бывает (нет `NpcRef`/мёртв)
    }
    return false;
}

// Пробный прогон: сколько легло бы, утоли тело этот глагол величиной
// `amount`. На КОПИИ строки — тот же закон, которым сядет эффект, а не второй
// switch «глагол → бар» (ревью 2026-11-14: третья копия этого switch была бы
// ровно тем вторым ответом, за который тут судят).
float would_gain(const Needs& row, VerbId verb, float amount) {
    Needs probe = row;
    const SatisfyResult s = needs_satisfy(probe, verb, amount);
    return s.served ? s.gained : 0.0f;
}

} // namespace

ServePick serve_pick(const Room& r, const DemandE3 demand[kVerbCount]) {
    ServePick out;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        // ЕДИНСТВЕННЫЙ ФИЛЬТР — «у глагола есть строка деяния». Глагола без
        // строки не бывает (S22: «глагол без строки незаконен независимо от
        // того, работает ли он»), и отсекается он ДО арифметики, иначе ярлык
        // называл бы то, чего сделать нельзя.
        if (kVerbAction[v] >= kActionCount) continue;
        const std::int32_t offer = place_offer(&r, static_cast<VerbId>(v));
        const std::int64_t term =
            static_cast<std::int64_t>(demand[v]) * static_cast<std::int64_t>(offer);
        // СТРОГО ПОЛОЖИТЕЛЬНОЕ СЛАГАЕМОЕ И ЕСТЬ ВСЯ ПРОВЕРКА: нулевой спрос,
        // нулевое предложение и любой отрицательный знак (просевший `supply`)
        // дают term <= 0, то есть не обгоняют стартовый ноль `out.term`.
        //
        // ЗДЕСЬ СТОЯЛИ ЕЩЁ ДВЕ ПРОВЕРКИ — `demand[v] <= 0` и `offer <= 0`, — И
        // ИХ СНЯЛА МУТАЦИЯ: обе ВЫЖИЛИ при снятии, то есть были ВТОРЫМ ОТВЕТОМ
        // на тот же вопрос (ровно тот класс, который в этом дереве числится
        // дефектом). Гейт «сытое тело в обеспеченной комнате не делает ничего»
        // держит строгое сравнение, а не они, — и это проверено третьей
        // мутацией: ослабь его до `term < out.term`, и нулевое слагаемое
        // победит.
        if (term <= out.term) continue; // ничья уходит МЛАДШЕМУ глаголу
        out.term = term;
        out.offer = offer;
        out.verb = static_cast<VerbId>(v);
    }
    return out;
}

const char* serve_refusal_text(ServeRefusal r) {
    switch (r) {
        case ServeRefusal::None: return "";
        case ServeRefusal::Busy: return "ЗАНЯТ";
        case ServeRefusal::NoRow: return "ЭТИМ НЕ УТОЛИТЬ";
        case ServeRefusal::NoItem: return "ПРЕДМЕТА НЕТ";
        case ServeRefusal::Full: return "НЕ ХОЧЕТСЯ";
        case ServeRefusal::NoPlace: return "ЗДЕСЬ НЕЧЕМ";
    }
    return "";
}

VerbId serve_item_verb(ItemId item) {
    VerbId best = static_cast<VerbId>(kVerbCount);
    if (!item_valid(item)) return best;
    std::int16_t top = 0;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        if (kVerbAction[v] >= kActionCount) continue; // утолить деянием нельзя
        const std::int16_t amt = kItemVerbs[item - 1][v];
        if (amt <= top) continue; // ничья — младшему глаголу
        top = amt;
        best = static_cast<VerbId>(v);
    }
    return best;
}

ServeRefusal serve_start(const ServeCtx& ctx, Entity e, NpcId id,
                         const vec3& pos, VerbId verb, ItemId item,
                         ServeTick& out) {
    if (verb >= kVerbCount || kVerbAction[verb] >= kActionCount)
        return ServeRefusal::NoRow;
    Acting* act = ctx.reg.try_get<Acting>(e);
    // Занятость МОНОТОННА (S22.1): открытое окно — чужое или своё, идущее или
    // ещё должное эффект — перебить нельзя. Боевое окно именно здесь и
    // отказывает деянию: моб, который замахнулся, не садится есть.
    if (act != nullptr && act_open(act_slot(*act, ActSlot::Body), ctx.tick))
        return ServeRefusal::Busy;

    // СТРОКА НУЖД — ОДНА НА ВСЕХ РЕШАТЕЛЕЙ (`needs_row_for`, [game/needs.h]):
    // проба судит ту же строку, по которой решали «чего я хочу».
    const Needs row = needs_row_for(ctx.pool, id);
    if (item != kInvalidItem) {
        if (bag_slot_of(ctx.pool.inventory(id), item) < 0)
            return ServeRefusal::NoItem;
        // Глагол обязан быть глаголом ЭТОГО предмета: окно открывается строкой
        // глагола, а эффект сядет строкой предмета, — разойдись они, длина
        // была бы от одного, величина от другого.
        if (serve_item_verb(item) != verb) return ServeRefusal::NoRow;
        // «Сытый хлеб не ест» — тем же законом, которым сядет эффект: проба
        // `apply_consumable` на копии. Ноль легшего = отказ (снесённый
        // `use_best_for` отказывал так же: «full; do not burn a ration»).
        Needs probe = row;
        const ConsumeResult res =
            apply_consumable(probe, item, ctx.pool.hp(id));
        if (!res.used || res.food + res.water + res.sleep <= 0.0f)
            return ServeRefusal::Full;
    } else {
        // Пробы ДВЕ, и это два разных вопроса: «есть ли куда расти вообще»
        // (не хочется) и «даст ли место» (здесь нечем). У облегчения вторая
        // проба при нуле места отвечает «да» — величину называет тело.
        if (would_gain(row, verb, kNeedMax) <= 0.0f) return ServeRefusal::Full;
        const Room* r = room_of(ctx.fr, room_at_pos(ctx.fr, pos));
        const std::int32_t offer = place_offer(r, verb);
        if (would_gain(row, verb, static_cast<float>(offer > 0 ? offer : 0)) <=
            0.0f)
            return ServeRefusal::NoPlace;
    }

    const ActionId a = kVerbAction[verb];
    if (act == nullptr) act = &ctx.reg.emplace<Acting>(e);
    // ДЛИНА — ИЗ СТРОКИ ДЕЙСТВИЯ, КОНТАКТ В КОНЦЕ ОКНА: деяние даёт результат
    // тогда, когда СОВЕРШЕНО. Оба числа — одно и то же `dur_ms`, поэтому
    // колонки `apply_ms` в таблице нет (она была бы копией).
    if (!acting_begin_ms(*act, ActSlot::Body, a, kActionDurMs[a],
                         kActionDurMs[a], ctx.tick, item))
        return ServeRefusal::Busy;
    ++out.began;
    ++out.byVerb[verb];
    return ServeRefusal::None;
}

VerbId serve_place_verb(const ServeCtx& ctx, NpcId id, const vec3& pos) {
    VerbId best = static_cast<VerbId>(kVerbCount);
    const Room* r = room_of(ctx.fr, room_at_pos(ctx.fr, pos));
    if (r == nullptr) return best; // коридор: место не даёт ничего
    const Needs row = needs_row_for(ctx.pool, id);
    float top = 0.0f;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        const VerbId verb = static_cast<VerbId>(v);
        if (kVerbAction[v] >= kActionCount) continue;
        const std::int32_t offer = place_offer(r, verb);
        if (offer <= 0) continue; // место этот глагол не ПРЕДЛАГАЕТ
        if (would_gain(row, verb, static_cast<float>(offer)) <= 0.0f) continue;
        // Наибольшая недостача: тот бар, которому больше всего некуда деться.
        const float lack = would_gain(row, verb, kNeedMax);
        if (lack <= top) continue; // ничья — младшему глаголу
        top = lack;
        best = verb;
    }
    return best;
}

bool serve_busy(const ServeCtx& ctx, Entity e, NpcId id, const vec3& pos,
                LayerId layer, ServeTick& out) {
    Acting* act = ctx.reg.try_get<Acting>(e);
    if (act == nullptr) return false;
    ActWindow& w = act_slot(*act, ActSlot::Body);
    const VerbId mine = window_verb(w);
    if (mine >= kVerbCount) return false; // пустой слот или боевое окно
    // КОНТАКТНЫЙ КАДР — КОНЕЦ окна, поэтому опрос стоит ДО вопроса «занят
    // ли»: на последнем тике окна `act_busy` уже ложь, а эффект ещё не упал.
    if (acting_take_apply(*act, ActSlot::Body, ctx.tick))
        land_effect(ctx, e, id, pos, layer, mine, w.item, out);
    if (!act_busy(w, ctx.tick)) return false; // окно закрылось — тело вольно
    ++out.holding;
    return true;
}

bool serve_begin(const ServeCtx& ctx, Entity e, NpcId id, const vec3& pos,
                 ServeTick& out) {
    // Занятость спрашивается ДО счётчиков: занятое тело не «в коридоре» и не
    // «без предложения» — оно занято. Любым окном тела, не только деянием:
    // моб, который замахнулся, не садится есть.
    if (const Acting* act = ctx.reg.try_get<Acting>(e);
        act != nullptr && act_open(act_slot(*act, ActSlot::Body), ctx.tick))
        return false;

    const Room* r = room_of(ctx.fr, room_at_pos(ctx.fr, pos));
    if (r == nullptr) {
        ++out.corridor;
        return false;
    }

    // СТРОКА НУЖД — ОДНА НА ВСЕХ РЕШАТЕЛЕЙ (`needs_row_for`, [game/needs.h]).
    // Здесь стояло чтение пула напрямую плюс отказ при `seeded == 0`, и это
    // был ВТОРОЙ ОТВЕТ: непросеянное тело проход ведения законно отправлял
    // идти (подставив прокатанную строку), а деяние тому же телу молча
    // отказывало — то есть «чего я хочу» и «что я делаю» считались по разным
    // строкам одного тела. Нашёл аудит, а не прогон.
    const Needs row = needs_row_for(ctx.pool, id);
    DemandE3 demand[kVerbCount];
    demand_from_needs(row, demand);
    // Та же пара строк, которой считает спрос проход ведения: один вектор
    // ХОЧУ на тело, иначе «чего я хочу» и «что я делаю» разошлись бы.
    demand_add_health(static_cast<float>(ctx.pool.hp(id)),
                      static_cast<float>(ctx.pool.max_hp(id)), demand);

    const ServePick p = serve_pick(*r, demand);
    if (p.verb >= kVerbCount) {
        ++out.nothing;
        return false;
    }
    // ОКНО ОТКРЫВАЕТ ОДНА ДВЕРЬ — та же, что у человека.
    if (serve_start(ctx, e, id, pos, p.verb, kInvalidItem, out) !=
        ServeRefusal::None) {
        ++out.nothing;
        return false;
    }
    return true;
}

bool serve_holding(const Registry& reg, Entity e, std::uint64_t tick) {
    const Acting* act = reg.try_get<Acting>(e);
    if (act == nullptr) return false;
    const ActWindow& w = act_slot(*act, ActSlot::Body);
    if (window_verb(w) >= kVerbCount) return false;
    return act_open(w, tick);
}

void serve_step(const ServeCtx& ctx, LayerId layer, ServeTick& out) {
    // ПУЛ ПРОГРЕТ ДО ОТКРЫТИЯ ВИДА: контактный кадр зовёт `apply_damage` (цена
    // сомнительной еды), а тот крепит `Dead`. Рождение НОВОГО пула внутри
    // живого вида дангл'ит его указатели — тот же класс, ради которого
    // `place_errand_step` греет пулы, а `mob_attack_step` разрезан на две фазы.
    // Смерть от цены еды невозможна (кламп до hp−1), но правило дерева —
    // греть, а не доказывать.
    (void)ctx.reg.storage<Dead>();
    auto view = ctx.reg.view<Acting, const NpcRef, const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        Acting& act = view.get<Acting>(e);
        ActWindow& w = act_slot(act, ActSlot::Body);
        if (window_verb(w) >= kVerbCount) continue; // не деяние нужды
        const NpcId id = view.get<const NpcRef>(e).id;
        if (!ctx.pool.valid(id)) continue;
        // (1) ТЕЛО УШЛО ОТ ДЕЛА — обрыв СТАРШЕ контакта. Обрыв судит
        // `break_action`, и окно, ещё должное конечный эффект, он тоже рвёт
        // (`act_open`), поэтому уведённое на тике контакта тело не кормится.
        if (body_left(ctx.reg, e, ctx.tick)) {
            if (break_action(act, ActSlot::Body, kBreakLeave, ctx.tick).broken)
                ++out.broke;
            continue;
        }
        // (2)+(3) контакт и «держит ли» — один опрос на тело.
        serve_busy(ctx, e, id, tr.pos, layer, out);
    }
}

} // namespace giga::game

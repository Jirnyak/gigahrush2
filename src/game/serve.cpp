// Деяние нужды на месте. Законы и выводы — в serve.h.

#include "game/serve.h"

#include "ecs/components.h"    // Transform — комната предмета считается по его точке
#include "game/action.h"       // Acting / acting_begin_ms / acting_take_apply
#include "game/action_table.h" // kActionVerb / kVerbAction / kActionDurMs
#include "game/combat.h"       // apply_damage — цена сомнительной еды
#include "game/container.h"    // Container — ящики И трупы (один держатель)
#include "game/event_bus.h"    // ItemTransferred — предмет сменил хозяина
#include "game/item_table.h"   // kItemVerbs / item_valid
#include "game/loot.h"         // Pickup — предметы на полу (вклад вычитается)
#include "game/needs.h"        // needs_satisfy / apply_consumable / kAttritionChannel
#include "game/room_supply.h"  // room_at_pos / supply_add_item

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
// ВЫБОР — ДВУХКЛЮЧЕВОЙ, И ЭТО ТОТ ЖЕ ПОРЯДОК, ЧТО У ИГРОКА. Первый ключ —
// ЦЕНА HP (`consumable_hp_cost`): даровое бьёт платное при любой подгонке, и
// довод к этому выписан числами в [game/needs.h] («платить дефицитным HP за
// 1–8 очков изобильной еды — задом наперёд»; 4 строки из 21 кормящей берут
// 6 HP). Без этого ключа толпа предпочитала бы САМУЮ КРУПНУЮ порцию, то есть
// ровно рискованную. Второй ключ — величина глагола, АРГМАКС, а не «первый
// найденный»: первый подходящий превратил бы порядок хранения в правило мира
// (S13.9 запрещает это буквально).
//
// РАСХОЖДЕНИЕ С `use_best_for` НАЗВАНО ВСЛУХ (приём `loot.cpp`: «один ключ
// здесь, два там — не сводить»): там второй ключ есть ПОДГОНКА под дефицит
// («наименьшая покрывающая, иначе наибольшая»), потому что порция принадлежит
// игроку и тратится из его сумки. Здесь порция лежит в ЧУЖОМ ящике и
// принадлежит месту, а деяние — одно на окно: экономить запас комнаты за счёт
// собственного бара тело не обязано. Сведение этих правил было бы третьей
// копией, а не одной.
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

// КОНТАКТНЫЙ КАДР: эффект падает ОДИН раз за окно. Возвращает, сколько очков
// легло (для прибора), и считает путь — предметом или возможностью места.
void land_effect(const ServeCtx& ctx, Entity e, NpcId id, const vec3& pos,
                 LayerId layer, VerbId verb, ServeTick& out) {
    Needs& n = ctx.pool.needs(id);
    const RoomId room = room_at_pos(ctx.fr, pos);
    const Room* r = room_of(ctx.fr, room);
    if (r == nullptr) return; // тело унесло из комнаты — деяние впустую

    // РАСХОДУЕМОЕ ПЕРВЫМ (закон 3): если в комнате лежит то, чем этот глагол
    // утоляют, тело берёт ЭТО, и величину называет строка предмета.
    const Lying pick = best_lying(ctx.reg, ctx.fr, room, layer, verb);
    if (pick.slot >= 0) {
        const ConsumeResult res = apply_consumable(n, pick.item, ctx.pool.hp(id));
        if (res.used) {
            Container& c = ctx.reg.get<Container>(pick.box);
            if (--c.inv.slots[pick.slot].count == 0)
                c.inv.slots[pick.slot] = ItemSlot{};
            // Запас комнаты падает ТЕМ ЖЕ хуком, которым растёт (S12.4
            // «инкрементально, событием»): следующий голодный видит меньше.
            supply_add_item(ctx.fr, room, pick.item, -1);
            // Цена сомнительной еды идёт через ОДНУ дверь урона, на канале,
            // которого броня не видит, — дословно как у игрока (needs.cpp).
            if (res.hpCost > 0)
                apply_damage(ctx.reg, ctx.pool, e, res.hpCost, kAttritionChannel,
                             entt::null);
            if (ctx.bus != nullptr)
                ctx.bus->publish(EventType::ItemTransferred, id, kInvalidNpc,
                                 pick.item, ctx.tick);
            ++out.consumed;
            ++out.applied;
            out.reliefSum += static_cast<std::int32_t>(res.food + res.water +
                                                       res.sleep);
            return;
        }
        // ВЕЩЬ ВЗЯЛИ, А ОНА НЕ СРАБОТАЛА — деяние впустую, и на возможность
        // места оно НЕ падает: иначе место заплатило бы очками предмета,
        // которого не израсходовало.
        //
        // ПУТЬ СЕГОДНЯ НЕДОСТИЖИМ, И ЭТО ПРОВЕРЕНО МУТАЦИЕЙ (она выжила —
        // значит ветку не трогает ни один гейт, потому что её не достигает ни
        // один вход). Инвариант, который её держит: `kItemVerbs` ВЫВЕДЕН из
        // `use_effect` отображением `USE_VERB@tools/gen_item_table.py`, то
        // есть глагол у предмета есть ровно тогда, когда у него есть эффект;
        // а глаголы, чей эффект `apply_consumable` не применяет (`heal`),
        // строки деяния не имеют и до сюда не доходят. Поэтому здесь СТОИТ
        // ВЕТКА, А НЕ АРИФМЕТИКА: вычитание вклада отказанного предмета было
        // бы мёртвым кодом, который нечем прокрасить.
        return;
    }

    // ВОЗМОЖНОСТЬ МЕСТА: объявленное + оснащение по этому глаголу. Величина
    // пересчитывается НА КОНТАКТНОМ КАДРЕ, а не запоминается в начале окна:
    // «сколько дало место» есть свойство места в момент деяния, и лишнего
    // состояния для этого не нужно.
    //
    // ВЫЧИТАЕТСЯ ВКЛАД ЛЕЖАЩЕГО НА ПОЛУ ХАБАРА: его деяние не изымает (см.
    // `pickup_offer`), а значит и платить им не вправе — иначе одна брошенная
    // банка кормила бы этаж вечно. Остаток и есть нерасходуемая часть
    // предложения: объявленное плюс оснащение.
    const std::int32_t points =
        static_cast<std::int32_t>(r->declared[verb]) + r->supply[verb] -
        pickup_offer(ctx.reg, ctx.fr, room, layer, verb);
    if (points <= 0) return;
    const SatisfyResult sat = needs_satisfy(n, verb, static_cast<float>(points));
    if (!sat.served) return;
    ++out.applied;
    out.reliefSum += static_cast<std::int32_t>(sat.gained);
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
        const std::int32_t offer =
            static_cast<std::int32_t>(r.declared[v]) + r.supply[v];
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
        land_effect(ctx, e, id, pos, layer, mine, out);
    if (!act_busy(w, ctx.tick)) return false; // окно закрылось — тело вольно
    ++out.holding;
    return true;
}

bool serve_begin(const ServeCtx& ctx, Entity e, NpcId id, const vec3& pos,
                 ServeTick& out) {
    Acting* act = ctx.reg.try_get<Acting>(e);
    // Занятость МОНОТОННА (S22.1): открытое окно — чужое или своё — перебить
    // нельзя. Своё сюда и не доедет (его снял `serve_busy`), а боевое именно
    // здесь и отказывает деянию: моб, который замахнулся, не садится есть.
    if (act != nullptr && act_busy(act_slot(*act, ActSlot::Body), ctx.tick))
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
    const ActionId a = kVerbAction[p.verb];
    if (act == nullptr) act = &ctx.reg.emplace<Acting>(e);
    // ДЛИНА — ИЗ СТРОКИ ДЕЙСТВИЯ, КОНТАКТ В КОНЦЕ ОКНА: деяние даёт результат
    // тогда, когда СОВЕРШЕНО. Оба числа — одно и то же `dur_ms`, поэтому
    // колонки `apply_ms` в таблице нет (она была бы копией).
    if (!acting_begin_ms(*act, ActSlot::Body, a, kActionDurMs[a],
                         kActionDurMs[a], ctx.tick))
        return false;
    ++out.began;
    ++out.byVerb[p.verb];
    return true;
}

void serve_break_threat(Registry& reg, Entity e, std::uint64_t tick,
                        ServeTick& out) {
    Acting* act = reg.try_get<Acting>(e);
    if (act == nullptr) return;
    ActWindow& w = act_slot(*act, ActSlot::Body);
    // ПРОВЕРКА «ЭТО МОЁ ОКНО» ЗДЕСЬ НЕСУЩАЯ, а не вторая копия проверок
    // `break_action`: ниже стоит ветка, которая гасит ИСТЁКШЕЕ окно, и для неё
    // нужно знать род окна — боевое гасить нельзя, его хозяин бой.
    if (window_verb(w) >= kVerbCount) return;
    if (break_action(*act, ActSlot::Body, kBreakThreat, tick).broken) {
        ++out.broke;
        return;
    }
    // ИСТЁКШЕЕ, НО НЕ СНЯТОЕ ОКНО — ТОЖЕ ОБРЫВ, и это нашёл аудит, а не
    // прогон. `break_action` по построению отказывает на окне, которое уже
    // кончилось (`act_busy` ложь), а контактный кадр деяния нужды стоит РОВНО
    // в конце: угроза, пришедшая на последнем тике или после него до опроса,
    // оставляла бит `applied` нулём — и эффект падал ПОЗЖЕ, в той комнате, где
    // тело оказалось после бегства, либо впустую в коридоре. Деяние, из
    // которого тело выдернули, кормить не должно (S24, закон 5), поэтому окно
    // гасится здесь: `durTicks = 0` и есть «слот свободен» ([game/action.h]).
    if (w.durTicks != 0 && w.applied == 0 && !act_busy(w, tick)) {
        w.durTicks = 0;
        w.applyTicks = 0;
        ++out.broke;
    }
}

} // namespace giga::game

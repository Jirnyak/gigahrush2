#include "game/conversation.h"

#include <cstring>
#include <iterator>          // std::size — утверждения сортировки по ДЛИНЕ таблицы

#include "core/rng.h"          // hash2 — детерминированный выбор живой реплики
#include "game/dice.h"         // dice_stake_for — the game row prices itself
#include "game/embody.h"       // NpcRef — the player's bag is a pool row too
#include "game/equip.h"        // item_durability — проверка изношенной экипировки
#include "game/faction.h"      // Faction — реплики и ориентировка по фракции
#include "game/needs.h"        // Needs / item_feeds / item_hydrates / пороги
#include "game/ranged_table.h" // ranged_for_item — проверка пустого ствола
#include "game/weapon_table.h" // melee_for_item — проверка наличия оружия

namespace giga::game {

namespace {

// ---------------------------------------------------------------------------
// The option table — [conversation.md] "опция = строка таблицы"
// ---------------------------------------------------------------------------
// Adding an interaction (a game of dice, a recipe lesson, a paid service) is
// one row here: order, label, visibility, activation. The menu is this table
// sorted and filtered; the UI never learns what an option MEANS.

using VisibleFn = bool (*)(const ConvContext&);
using LabelFn = const char* (*)(const ConvContext&);
using ActivateFn = ConvAction (*)(ConvContext&);

struct ConvOptionDef {
    const char* id;
    std::uint16_t order;
    LabelFn label;       // resolved per-context (quest marker)
    VisibleFn visible;   // nullptr = always
    ActivateFn activate;
};

// --- talk -------------------------------------------------------------------
const char* talk_label(const ConvContext&) { return "РАЗГОВОР"; }

ConvAction talk_activate(ConvContext& ctx) {
    ConvAction a;
    a.kind = ConvActionKind::Line;
    if (ctx.pool && ctx.speech && ctx.npc != kInvalidNpc) {
        // The crowd's own voice ([speech.h]): faction bucket, deterministic
        // pick, no-repeat memory. Ambient — the player walked up mid-life, not
        // mid-crisis; the situation resolver is the HUD bark path's job.
        a.line = speech_say(*ctx.speech, ctx.npc, SpeechSituation::Ambient,
                            ctx.pool->faction(ctx.npc), ctx.seed);
    }
    if (!a.line) a.line = "...";
    return a;
}

// --- quest ------------------------------------------------------------------
// Опрос живого состояния собеседника: реальный дефицит в сумке/нуждах/HP/БК
// подсвечивает «ЗАДАНИЕ !» и просит конкретную вещь в торг; при норме —
// честная ориентировка по фракции, этажу, наличке и живой ситуации без
// выдуманного квест-журнала.
enum class UrgentNeed : std::uint8_t {
    None = 0,
    WoundedNoHeal,
    ThirstyNoDrink,
    HungryNoFood,
    GunNoAmmo,
    BrokenGear,
};

struct PartnerProbe {
    bool validAlive = false;
    Faction faction = Faction::Citizens;
    std::int16_t hp = 0;
    std::int16_t maxHp = 0;
    std::int16_t floor = kNoFloorLabel;
    Needs needs{};
    bool hasHeal = false;
    bool hasFood = false;
    bool hasDrink = false;
    bool hasWeapon = false;
    bool hasRangedNoAmmo = false;
    bool hasBroken = false;
    std::int64_t cash = 0;
    UrgentNeed urgent = UrgentNeed::None;
};

bool inventory_has_item(const Inventory& inv, ItemId id) {
    if (id == kInvalidItem) return false;
    for (const ItemSlot& s : inv.slots)
        if (s.item == id && s.count > 0) return true;
    return false;
}

PartnerProbe probe_partner(const ConvContext& ctx) {
    PartnerProbe p;
    if (!ctx.pool || !ctx.pool->valid(ctx.npc) || !ctx.pool->alive(ctx.npc))
        return p;
    p.validAlive = true;
    const NpcPool& pool = *ctx.pool;
    p.faction = static_cast<Faction>(pool.faction(ctx.npc) % kFactionCount);
    p.hp = pool.hp(ctx.npc);
    p.maxHp = pool.max_hp(ctx.npc);
    p.floor = pool.floor(ctx.npc);
    p.needs = pool.needs(ctx.npc);

    const Inventory& inv = pool.inventory(ctx.npc);
    for (const ItemSlot& s : inv.slots) {
        if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item))
            continue;
        const ItemDef& d = item_def(s.item);
        const auto ue = static_cast<UseEffect>(d.useEffect);
        if (ue == UseEffect::Heal || ue == UseEffect::HealPsi) p.hasHeal = true;
        if (item_feeds(s.item)) p.hasFood = true;
        if (item_hydrates(s.item)) p.hasDrink = true;
        if (s.item == kItemRuble) p.cash += s.count;
        if (item_durability(s.item) > 0 && s.condition < 128)
            p.hasBroken = true;

        if (melee_for_item(s.item) != nullptr) p.hasWeapon = true;
        if (const RangedDef* rd = ranged_for_item(s.item)) {
            p.hasWeapon = true;
            if (!ranged_is_thrown(s.item) && rd->ammo != kInvalidItem &&
                !inventory_has_item(inv, rd->ammo)) {
                p.hasRangedNoAmmo = true;
            }
        }
    }

    if (p.maxHp > 0 && p.hp > 0 && p.hp * 2 <= p.maxHp && !p.hasHeal)
        p.urgent = UrgentNeed::WoundedNoHeal;
    else if (p.needs.seeded != 0 && p.needs.water <= kWaterWarnAt && !p.hasDrink)
        p.urgent = UrgentNeed::ThirstyNoDrink;
    else if (p.needs.seeded != 0 && p.needs.food <= kFoodWarnAt && !p.hasFood)
        p.urgent = UrgentNeed::HungryNoFood;
    else if (p.hasRangedNoAmmo)
        p.urgent = UrgentNeed::GunNoAmmo;
    else if (p.hasBroken)
        p.urgent = UrgentNeed::BrokenGear;

    return p;
}

const char* faction_urgent_line(Faction f, UrgentNeed u) {
    const std::size_t fi = static_cast<std::size_t>(f) % kFactionCount;
    switch (u) {
        case UrgentNeed::WoundedNoHeal: {
            static constexpr const char* kLines[kFactionCount] = {
                "Задело сильно, бинта в сумке нет. Если есть медицина — выручай через торг.",
                "Ранен, перевязки нет. Есть бинт или коагулянт — отдай в торге, сочтёмся.",
                "Плоть сечёт, а повязки нет. Подай бинт через торг — и дверь тебя запомнит.",
                "Кровопотеря, а медпакет пуст. Принесёшь бинт или аптечку в торг — оплачу.",
                "Зацепило, перевязаться нечем. Кидай бинт в торг, не тяни.",
            };
            return kLines[fi];
        }
        case UrgentNeed::ThirstyNoDrink: {
            static constexpr const char* kLines[kFactionCount] = {
                "Вода на нуле, а краны сухие. Если есть бутылка — неси в торг.",
                "Фляга сухая, смена длинная. Есть вода — заберу по торгу.",
                "Горло пересохло, воды нет. Поделишься флягой через торг — зачтётся.",
                "Обезвоживание срывает работу. Принесёшь чистой воды в торг — сменяемся.",
                "Воды ни капли. Есть что пить — выкладывай в торг.",
            };
            return kLines[fi];
        }
        case UrgentNeed::HungryNoFood: {
            static constexpr const char* kLines[kFactionCount] = {
                "Пайка кончилась, в сумке шаром покати. Подкинешь еды через торг?",
                "Паёк вышел, а впереди сектор. Скинешь еды в торге — заберу.",
                "Живот пуст, а хлеба у нас не осталось. Принесёшь еды в торг — отблагодарим.",
                "Голод портит расчёт, а провизии нет. Нужна еда через торг.",
                "Жрать нечего. Есть паёк — давай в торг, пока говорю спокойно.",
            };
            return kLines[fi];
        }
        case UrgentNeed::GunNoAmmo: {
            static constexpr const char* kLines[kFactionCount] = {
                "Оружие есть, а зарядить нечем. Попадутся патроны — неси в торг.",
                "Ствол при мне, да патрон вышел. Найдёшь боеприпас под калибр — в торг.",
                "Оружие без патронов молчит. Принесёшь патроны в торг — пойдёт дело.",
                "Оружие разряжено — без патронов это труба. Есть боекомплект в торг?",
                "Ствол сухой, маслин нет. Есть патроны — в торг, разговор короткий.",
            };
            return kLines[fi];
        }
        case UrgentNeed::BrokenGear: {
            static constexpr const char* kLines[kFactionCount] = {
                "Вещи изношены вхлам, до верстака не дошёл. Нужна замена через торг.",
                "Снаряжение битое, держится на честном слове. Нужна замена или починка.",
                "Вещь износилась, трещит по швам. Нужен целый инструмент в торг.",
                "Инструмент изношен сверх допуска. Принесёшь замену в торг — возьму.",
                "Снаряга в труху. Есть что посвежее — давай в торг.",
            };
            return kLines[fi];
        }
        default:
            return nullptr;
    }
}

const char* quest_label(const ConvContext& ctx) {
    return probe_partner(ctx).urgent != UrgentNeed::None ? "ЗАДАНИЕ !"
                                                         : "ЗАДАНИЕ";
}

ConvAction quest_activate(ConvContext& ctx) {
    ConvAction a;
    a.kind = ConvActionKind::Line;

    const PartnerProbe p = probe_partner(ctx);
    if (!p.validAlive) {
        a.line = "Ответа нет.";
        return a;
    }

    if (const char* req = faction_urgent_line(p.faction, p.urgent)) {
        a.line = req;
        return a;
    }

    // Если тело прямо сейчас в бою или спасается от опасности — ему не до
    // раздачи поручений: отдаём живую реплику по ситуации.
    if (ctx.speech && ctx.reg && ctx.npcBody != entt::null &&
        ctx.reg->valid(ctx.npcBody)) {
        const SpeechContext sc =
            speech_context(*ctx.reg, *ctx.pool, ctx.npc, 0);
        const SpeechSituation sit = speech_situation(sc);
        if (sit == SpeechSituation::Combat || sit == SpeechSituation::Fear) {
            if (const char* bark =
                    speech_say(*ctx.speech, ctx.npc, sit,
                               static_cast<std::uint16_t>(p.faction), ctx.seed)) {
                a.line = bark;
                return a;
            }
        }
    }

    if (p.needs.seeded != 0 && p.needs.sleep <= kSleepWarnAt) {
        a.line = "С ног валюсь — сейчас не до подрядов, до койки бы добраться.";
        return a;
    }

    const bool deepFloor = (p.floor != kNoFloorLabel) &&
                           (p.floor <= -14 || p.floor >= 14);
    const std::uint32_t roll = hash2(ctx.npc, ctx.seed);

    switch (p.faction) {
        case Faction::Liquidators:
            if (!p.hasWeapon)
                a.line = "Ствола в сумке нет — без оружия в сектор не сунешься. Есть чем вооружиться — неси в торг.";
            else if (deepFloor)
                a.line = "Сектор на глубине тяжёлый, лишних рук в наряд нет. Держи фильтр при себе и проверяй герму.";
            else if ((roll & 1u) == 0u)
                a.line = "Обход закрыт дежурной сменой, сторонних нарядов нет.";
            else
                a.line = "Лишней работы по линии нет — патроны и аптечки при себе держи.";
            return a;
        case Faction::Scientists:
            if (deepFloor)
                a.line = "На этой отметке замеры идут без перерыва. Подрядов нет, но приборы и расходники берём через торг.";
            else if (p.cash == 0)
                a.line = "Бюджета на подряд нет — карман пуст. Только прямой обмен по торгу.";
            else
                a.line = "Внештатных заявок нет — все пробы закрываем силами лаборатории.";
            return a;
        case Faction::Cultists:
            if (deepFloor)
                a.line = "В глубине трубы поют громче. Поручений чужим нет — кто держит дверь, тот и свой.";
            else
                a.line = "Отдельного послушания сейчас нет. Оставь хлеб у батареи или загляни в торг.";
            return a;
        case Faction::Wild:
            if (!p.hasWeapon)
                a.line = "В руках пусто, работы не дам. Есть ствол или нож на обмен — открывай торг.";
            else if (p.cash == 0)
                a.line = "Платить мне нечем, наёмников не беру. Только натуральный обмен.";
            else
                a.line = "Своих дел хватает, чужих в долю не берём. Есть товар — показывай в торге.";
            return a;
        case Faction::Citizens:
        default:
            if (deepFloor)
                a.line = "На такой глубине поручений нет — каждый сам добирается до гермы.";
            else if (p.cash == 0)
                a.line = "Работы за плату нет — сам на нуле, разве что обмен по бартеру.";
            else
                a.line = "Лишней работы сейчас нет — проверь торг или поспрашивай по этажу.";
            return a;
    }
}

// --- trade ------------------------------------------------------------------
const char* trade_label(const ConvContext&) { return "ТОРГ"; }

ConvAction trade_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Barter;
    return a;
}

// --- teller — КАССА ([economy.h] teller_deposit_cash/teller_withdraw_cash) ---
// Закон владельца: `banked` — это СЧЁТ, и перенос налички туда и обратно есть
// взаимодействие С ТЕЛОМ, а не магия пада. Ряд остался ровно по этой причине:
// пад-банк (проценты, вклады, кредиты) снесён как легаси, а КОШЕЛЁК объявлен
// ядром, и двигает его касса.
//
// ВИДИМОСТЬ СНЯТА, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Прежде ряд гейтился колонкой ролей
// (`RoleId::Duty` — ведомственная касса); колонка снесена вместе с системой
// ролей, и гейт остался бы без источника правды. Выбор был между «кассы нет ни
// у кого» и «касса у любого собеседника»: первое убрало бы из игры единственный
// путь к счёту, второе — честная времянка. Настоящий ответ — ПОСТ агента
// (место работы из agent-goals), и когда он приедет, здесь встанет предикат по
// якорю, а не по архетипу.
const char* teller_label(const ConvContext&) { return "КАССА"; }

ConvAction teller_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Teller;
    return a;
}

// --- dice — the first GAME row, exactly the shape the table promised ---------
// Visible when the dice are AT THE TABLE — either party's pocket counts, one
// set is enough ([conversation.md]). The row prices itself on activation and
// refuses in words rather than greying out: a broke partner has no stake, a
// broke player cannot cover one, and both answers teach the economy.
bool dice_visible(const ConvContext& ctx) {
    return conv_party_holds(ctx, kItemDiceBone);
}

const char* dice_label(const ConvContext&) { return "КОСТИ"; }

ConvAction dice_activate(ConvContext& ctx) {
    ConvAction a;
    if (!ctx.pool || !ctx.reg) return a;
    const std::int32_t stake = dice_stake_for(*ctx.pool, ctx.npc);
    if (stake <= 0) {
        a.kind = ConvActionKind::Line;
        a.line = "Ставить ему нечего — карман пуст.";
        return a;
    }
    NpcId playerId = kInvalidNpc;
    if (const auto* nr = ctx.reg->try_get<NpcRef>(ctx.player))
        if (ctx.pool->valid(nr->id)) playerId = nr->id;
    if (playerId == kInvalidNpc) return a;
    std::int64_t myRub = 0;
    for (const ItemSlot& s : ctx.pool->inventory(playerId).slots)
        if (s.item == kItemRuble && s.count > 0) myRub += s.count;
    if (myRub < stake) {
        a.kind = ConvActionKind::Line;
        a.line = "Тебе нечем крыть его ставку.";
        return a;
    }
    a.kind = ConvActionKind::Dice;
    return a;
}

// --- leave ------------------------------------------------------------------
const char* leave_label(const ConvContext&) { return "УЙТИ"; }

ConvAction leave_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Close;
    return a;
}

// Orders follow the reference's spacing so future rows (games at 100..,
// authored services between) land without renumbering: talk 0, quest 10,
// trade 20, leave 9000.
constexpr ConvOptionDef kConvOptions[] = {
    {"talk", 0, talk_label, nullptr, talk_activate},
    {"quest", 10, quest_label, nullptr, quest_activate},
    {"trade", 20, trade_label, nullptr, trade_activate},
    {"teller", 30, teller_label, nullptr, teller_activate},
    // The games band starts at 100, per the reference's spacing: dice first,
    // durak/domino/checkers land as siblings without renumbering anything.
    {"dice", 100, dice_label, dice_visible, dice_activate},
    {"leave", 9000, leave_label, nullptr, leave_activate},
};

// Authored in order, checked at compile time — conv_options copies, never sorts.
//
// ПРОВЕРКА ИДЁТ ПО ДЛИНЕ ТАБЛИЦЫ, А НЕ ПО ПЕРЕЧИСЛЕННЫМ ИНДЕКСАМ. Прежде здесь
// стояла цепочка `kConvOptions[0].order <= kConvOptions[1].order && ...` на
// фиксированные шесть рядов, и это был отложенный дефект: удали ряд — и
// утверждение читает ЗА КОНЦОМ массива, добавь ряд — и последний ряд не
// проверяется вовсе, молча. Дефект разряжен сносом ролей (ряд `bank` уцелел
// переименованием в `teller`, число рядов не поехало), но ждать второго случая
// незачем. Та же болезнь, что у пина ДЛИНЫ таблицы в переписи VIII/IX: длина
// ловит вставку и удаление, но за собой следить не умеет.
constexpr bool conv_options_sorted() {
    for (std::size_t i = 1; i < std::size(kConvOptions); ++i)
        if (kConvOptions[i - 1].order > kConvOptions[i].order) return false;
    return true;
}
static_assert(conv_options_sorted(),
              "keep kConvOptions sorted by order; the projection relies on it");
// Таблица обязана уехать в меню ЦЕЛИКОМ: кап — это запас, а не отбор.
static_assert(std::size(kConvOptions) <= kConvMaxOptions,
              "kConvMaxOptions must cover the whole table");

bool option_visible(const ConvOptionDef& def, const ConvContext& ctx) {
    return def.visible == nullptr || def.visible(ctx);
}

} // namespace

std::size_t conv_options(const ConvContext& ctx, ConvOption* out,
                         std::size_t cap) {
    // The table is authored in (order, id) order — asserted, not sorted at
    // runtime, so the projection is a filtered copy and nothing allocates.
    std::size_t n = 0;
    for (const ConvOptionDef& def : kConvOptions) {
        if (!option_visible(def, ctx)) continue;
        if (n >= cap) break;
        out[n].id = def.id;
        out[n].label = def.label(ctx);
        out[n].order = def.order;
        ++n;
    }
    return n;
}

ConvAction conv_activate(ConvContext& ctx, const char* id) {
    if (!id) return {};
    for (const ConvOptionDef& def : kConvOptions) {
        if (std::strcmp(def.id, id) != 0) continue;
        // The menu the player saw is the contract: an option that is not
        // visible right now must not act, however it was asked for.
        if (!option_visible(def, ctx)) return {};
        return def.activate(ctx);
    }
    return {};
}

bool conv_party_holds(const ConvContext& ctx, ItemId item) {
    if (!ctx.pool || ctx.npc == kInvalidNpc || !item_valid(item)) return false;
    auto holds = [item](const Inventory& inv) {
        for (const ItemSlot& s : inv.slots)
            if (s.item == item && s.count > 0) return true;
        return false;
    };
    if (holds(ctx.pool->inventory(ctx.npc))) return true;
    // The player's bag is a pool row too ([npcs.md] — the player is a record).
    if (ctx.reg && ctx.reg->valid(ctx.player)) {
        if (const auto* nr = ctx.reg->try_get<NpcRef>(ctx.player)) {
            if (ctx.pool->valid(nr->id) && holds(ctx.pool->inventory(nr->id)))
                return true;
        }
    }
    return false;
}

} // namespace giga::game

// Conversation — the universal NPC interaction menu ([conversation.md]).
//
// What is pinned: the menu is a sorted projection of the option table, activation
// routes to the right ConvAction, a stale/unknown id acts as nothing, and the
// game-affordance gate (conv_party_holds) sees both parties' pool rows. All
// headless: a Registry, a pool, no UI.
//
// МАРКЕР «ЗАДАНИЕ !» СНЕСЁН 2026-11-08 вместе с системой контрактов: он читал
// `ContractBook` из контекста. Строка таблицы `quest` ЖИВЁТ, но безусловно
// отвечает заглушкой — работы для тебя нет.
namespace conversation_detail {

// A minimal world: a pool with a player record + body and a partner record.
struct ConvFixture {
    Registry reg;
    NpcPool pool;
    SpeechMemory speech{};
    NpcId npc = kInvalidNpc;
    NpcId playerId = kInvalidNpc;
    Entity playerBody = entt::null;
    Entity npcBody = entt::null;

    ConvFixture() {
        pool.init();
        playerId = pool.spawn();
        npc = pool.spawn();
        playerBody = reg.create();
        reg.emplace<NpcRef>(playerBody, NpcRef{playerId});
        npcBody = reg.create();
        reg.emplace<NpcRef>(npcBody, NpcRef{npc});
    }

    ConvContext ctx() {
        ConvContext c;
        c.reg = &reg;
        c.pool = &pool;
        c.player = playerBody;
        c.npcBody = npcBody;
        c.npc = npc;
        c.speech = &speech;
        c.seed = 42u;
        return c;
    }
};

} // namespace conversation_detail

static void conversation_menu_is_the_sorted_table() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();
    ConvOption opts[kConvMaxOptions];
    const std::size_t n = conv_options(c, opts, kConvMaxOptions);
    // ПЯТЬ, А НЕ ЧЕТЫРЕ: касса перестала гейтиться (колонка ролей снесена
    // 2026-11-08) и теперь безусловна, как разговор и торг. Ряд `dice` по-
    // прежнему вне этого числа — он просит костей на столе.
    CHECK(n == 5);   // talk, quest, trade, teller, leave
    CHECK(std::strcmp(opts[0].id, "talk") == 0);
    CHECK(std::strcmp(opts[1].id, "quest") == 0);
    CHECK(std::strcmp(opts[2].id, "trade") == 0);
    CHECK(std::strcmp(opts[3].id, "teller") == 0);
    CHECK(std::strcmp(opts[4].id, "leave") == 0);
    for (std::size_t i = 1; i < n; ++i) CHECK(opts[i - 1].order <= opts[i].order);

    // The cap is honoured, not overrun.
    ConvOption two[2];
    CHECK(conv_options(c, two, 2) == 2);
}

// Базовый нейтральный случай: неинициализированный жилец без дефицита
// не выставляет маркер «!» и честно отвечает, что лишней работы нет.
static void conversation_quest_option_is_a_stub() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    ConvOption opts[kConvMaxOptions];
    conv_options(c, opts, kConvMaxOptions);
    CHECK(std::strcmp(opts[1].id, "quest") == 0);
    CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);   // маркера больше нет
    const ConvAction a = conv_activate(c, "quest");
    CHECK(a.kind == ConvActionKind::Line);
    CHECK(a.line != nullptr && std::strstr(a.line, "нет") != nullptr);
}

// Живое состояние собеседника: ранение без медицины, жажда без воды, ствол
// без патронов, различие фракций и безопасная реакция на мёртвого партнёра.
static void conversation_quest_reflects_live_state() {
    using namespace conversation_detail;

    // 1. Ранение ниже 50% без лечения поднимает «ЗАДАНИЕ !», а выдача медицины снимает.
    {
        ConvFixture f;
        f.pool.max_hp(f.npc) = 100;
        f.pool.hp(f.npc) = 30;
        ConvContext c = f.ctx();

        ConvOption opts[kConvMaxOptions];
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ !") == 0);
        const ConvAction a = conv_activate(c, "quest");
        CHECK(a.kind == ConvActionKind::Line);
        CHECK(a.line != nullptr && std::strstr(a.line, "торг") != nullptr);

        ItemId healItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (item_def(i).useEffect == static_cast<std::uint8_t>(UseEffect::Heal)) {
                healItem = i;
                break;
            }
        }
        CHECK(healItem != kInvalidItem);
        CHECK(inventory_give(f.pool.inventory(f.npc), healItem, 1) == 0);
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);
    }

    // 2. Засеянная жажда без питья поднимает «ЗАДАНИЕ !», выдача воды закрывает запрос.
    {
        ConvFixture f;
        f.pool.max_hp(f.npc) = 100;
        f.pool.hp(f.npc) = 100;
        Needs& nd = f.pool.needs(f.npc);
        nd.seeded = 1;
        nd.food = 80.0f;
        nd.water = 2.0f;
        nd.sleep = 80.0f;
        ConvContext c = f.ctx();

        ConvOption opts[kConvMaxOptions];
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ !") == 0);
        const ConvAction a = conv_activate(c, "quest");
        CHECK(a.kind == ConvActionKind::Line && a.line != nullptr);
        CHECK(std::strstr(a.line, "вод") != nullptr ||
              std::strstr(a.line, "Вод") != nullptr ||
              std::strstr(a.line, "фляг") != nullptr ||
              std::strstr(a.line, "Фляг") != nullptr);

        ItemId drinkItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (item_hydrates(i)) { drinkItem = i; break; }
        }
        CHECK(drinkItem != kInvalidItem);
        CHECK(inventory_give(f.pool.inventory(f.npc), drinkItem, 1) == 0);
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);
    }

    // 3. Огнестрел без подходящего боеприпаса поднимает «ЗАДАНИЕ !», выдача патронов снимает.
    {
        ConvFixture f;
        f.pool.max_hp(f.npc) = 100;
        f.pool.hp(f.npc) = 100;
        ItemId gunItem = kInvalidItem;
        ItemId ammoItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            const RangedDef* rd = ranged_for_item(i);
            if (rd && !ranged_is_thrown(i) && rd->ammo != kInvalidItem) {
                gunItem = i;
                ammoItem = rd->ammo;
                break;
            }
        }
        CHECK(gunItem != kInvalidItem);
        CHECK(inventory_give(f.pool.inventory(f.npc), gunItem, 1) == 0);
        ConvContext c = f.ctx();

        ConvOption opts[kConvMaxOptions];
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ !") == 0);
        const ConvAction a = conv_activate(c, "quest");
        CHECK(a.kind == ConvActionKind::Line && a.line != nullptr);
        CHECK(std::strstr(a.line, "патрон") != nullptr ||
              std::strstr(a.line, "боеприпас") != nullptr);

        CHECK(inventory_give(f.pool.inventory(f.npc), ammoItem, 1) == 0);
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);
    }

    // 4. Разные фракции дают осмысленно разные ответы; мёртвый собеседник не падает.
    {
        ConvFixture f;
        f.pool.max_hp(f.npc) = 100;
        f.pool.hp(f.npc) = 100;
        ConvContext c = f.ctx();

        f.pool.faction(f.npc) = static_cast<std::uint16_t>(Faction::Liquidators);
        const ConvAction liq = conv_activate(c, "quest");
        f.pool.faction(f.npc) = static_cast<std::uint16_t>(Faction::Wild);
        const ConvAction wild = conv_activate(c, "quest");
        CHECK(liq.kind == ConvActionKind::Line && liq.line != nullptr &&
              liq.line[0] != '\0');
        CHECK(wild.kind == ConvActionKind::Line && wild.line != nullptr &&
              wild.line[0] != '\0');
        CHECK(std::strcmp(liq.line, wild.line) != 0);

        f.pool.kill(f.npc);
        ConvOption opts[kConvMaxOptions];
        conv_options(c, opts, kConvMaxOptions);
        CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);
        const ConvAction dead = conv_activate(c, "quest");
        CHECK(dead.kind == ConvActionKind::Line && dead.line != nullptr &&
              dead.line[0] != '\0');
    }
}

static void conversation_activation_routes() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    // Talk yields a real line from the speech tables, deterministically.
    const ConvAction talk = conv_activate(c, "talk");
    CHECK(talk.kind == ConvActionKind::Line);
    CHECK(talk.line != nullptr && talk.line[0] != 0);

    CHECK(conv_activate(c, "trade").kind == ConvActionKind::Barter);
    CHECK(conv_activate(c, "leave").kind == ConvActionKind::Close);
    // Unknown / stale ids act as nothing: the menu the player SAW is the
    // contract, and a request from outside it must not reach an activation.
    CHECK(conv_activate(c, "durak").kind == ConvActionKind::None);
    CHECK(conv_activate(c, nullptr).kind == ConvActionKind::None);
}

static void conversation_party_holds_gates_the_games() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    // The gate the future game rows use ([conversation.md]): one set at the
    // table is enough, whoever brought it. Resolved by property, not id.
    ItemId deck = kInvalidItem;
    for (ItemId i = 1; i <= kItemCount; ++i)
        if (std::strcmp(item_name(i), "Колода карт") == 0) { deck = i; break; }
    CHECK(deck != kInvalidItem);

    CHECK(!conv_party_holds(c, deck));                 // nobody has it
    CHECK(inventory_give(f.pool.inventory(f.npc), deck, 1) == 0);
    CHECK(conv_party_holds(c, deck));                  // the partner brought it
    f.pool.inventory(f.npc).clear();
    CHECK(!conv_party_holds(c, deck));
    CHECK(inventory_give(f.pool.inventory(f.playerId), deck, 1) == 0);
    CHECK(conv_party_holds(c, deck));                  // the player brought it
    CHECK(!conv_party_holds(c, kInvalidItem));
}

// КАССА ЕСТЬ У ЛЮБОГО СОБЕСЕДНИКА, и это пин времянки, а не замысла. Прежде
// тест назывался `conversation_bank_is_the_duty_clerks` и проверял ОБЕ стороны
// гейта по колонке ролей: у жителя стойки нет и `conv_activate("bank")` не
// действует, у назначенного `RoleId::Duty` — есть. Колонка ролей снесена
// 2026-11-08, отрицательной стороны у предиката больше не существует, и
// утверждать её было бы ложью. Остаётся то, что наблюдаемо: ряд на месте, стоит
// сразу за торгом, и ведёт в кассу.
static void conversation_teller_is_at_every_partner() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    ConvOption opts[kConvMaxOptions];
    const std::size_t n = conv_options(c, opts, kConvMaxOptions);
    bool seen = false;
    for (std::size_t i = 0; i < n; ++i)
        if (std::strcmp(opts[i].id, "teller") == 0) {
            seen = true;
            CHECK(std::strcmp(opts[i].label, "КАССА") == 0);
            CHECK(i >= 1 && std::strcmp(opts[i - 1].id, "trade") == 0);
        }
    CHECK(seen);
    CHECK(conv_activate(c, "teller").kind == ConvActionKind::Teller);
    // Прежнее имя ряда мертво: старый слуг не должен действовать.
    CHECK(conv_activate(c, "bank").kind == ConvActionKind::None);
}

static void test_conversation_all() {
    conversation_teller_is_at_every_partner();
    conversation_menu_is_the_sorted_table();
    conversation_quest_option_is_a_stub();
    conversation_quest_reflects_live_state();
    conversation_activation_routes();
    conversation_party_holds_gates_the_games();
    std::fprintf(stderr,
                 "[conversation] menu projects the table, quest reflects live "
                 "partner state, routes route, the games' item gate sees both bags\n");
}

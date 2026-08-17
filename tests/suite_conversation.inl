// Conversation — the universal NPC interaction menu ([conversation.md]).
//
// What is pinned: the menu is a sorted projection of the option table, the
// quest marker follows the contract book's live givers by HANDLE, activation
// routes to the right ConvAction, a stale/unknown id acts as nothing, and the
// game-affordance gate (conv_party_holds) sees both parties' pool rows. All
// headless: a Registry, a pool, no UI.
namespace conversation_detail {

// A minimal world: a pool with a player record + body and a partner record.
struct ConvFixture {
    Registry reg;
    NpcPool pool;
    SpeechMemory speech{};
    ContractBook book{};
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
        c.book = &book;
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
    CHECK(n == 4);   // talk, quest, trade, leave — the builtin four
    CHECK(std::strcmp(opts[0].id, "talk") == 0);
    CHECK(std::strcmp(opts[1].id, "quest") == 0);
    CHECK(std::strcmp(opts[2].id, "trade") == 0);
    CHECK(std::strcmp(opts[3].id, "leave") == 0);
    for (std::size_t i = 1; i < n; ++i) CHECK(opts[i - 1].order <= opts[i].order);

    // The cap is honoured, not overrun.
    ConvOption two[2];
    CHECK(conv_options(c, two, 2) == 2);
}

static void conversation_quest_marker_follows_the_giver() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    ConvOption opts[kConvMaxOptions];
    conv_options(c, opts, kConvMaxOptions);
    CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);   // nobody is hiring
    ConvAction a = conv_activate(c, "quest");
    CHECK(a.kind == ConvActionKind::Line);
    CHECK(a.line != nullptr && std::strstr(a.line, "нет") != nullptr);

    // This NPC becomes the giver of a live contract: the marker appears.
    f.book.slot[0].giver = f.pool.handle(f.npc);
    f.book.slot[0].state = static_cast<std::uint8_t>(ContractState::Active);
    conv_options(c, opts, kConvMaxOptions);
    CHECK(std::strstr(opts[1].label, "!") != nullptr);
    a = conv_activate(c, "quest");
    CHECK(a.kind == ConvActionKind::Line);
    CHECK(a.line != nullptr && std::strstr(a.line, "контракт") != nullptr);

    // A HANDLE, not an id: kill the giver and the marker dies with them, even
    // though the raw id still matches — a recycled slot's tenant must not
    // inherit the old tenant's job.
    f.pool.kill(f.npc);
    conv_options(c, opts, kConvMaxOptions);
    CHECK(std::strcmp(opts[1].label, "ЗАДАНИЕ") == 0);
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

static void test_conversation_all() {
    conversation_menu_is_the_sorted_table();
    conversation_quest_marker_follows_the_giver();
    conversation_activation_routes();
    conversation_party_holds_gates_the_games();
    std::fprintf(stderr,
                 "[conversation] menu projects the table, marker follows the "
                 "handle, routes route, the games' item gate sees both bags\n");
}

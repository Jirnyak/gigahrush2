// Dice — the conversation table's first game ([dice.h], [conversation.md]).
//
// What is pinned: the reference's stake formula and winner matrix, the greedy
// packet's three exit conditions, the PHYSICAL settle (the loser pays in coins
// that move between pool rows, clamped to what they hold), surrender's price,
// idempotent settlement, per-seed determinism, and the conversation row's
// item gate + worded refusals.
namespace dice_detail {

inline std::int64_t rub(const Inventory& inv) {
    std::int64_t t = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == kItemRuble && s.count > 0) t += s.count;
    return t;
}

struct DiceFixture {
    NpcPool pool;
    NpcId me = kInvalidNpc, them = kInvalidNpc;
    DiceFixture(std::uint16_t myRub, std::uint16_t theirRub) {
        pool.init();
        me = pool.spawn();
        them = pool.spawn();
        if (myRub) inventory_give(pool.inventory(me), kItemRuble, myRub);
        if (theirRub) inventory_give(pool.inventory(them), kItemRuble, theirRub);
    }
};

} // namespace dice_detail

// --- the stake is a tenth of the PHYSICAL purse ------------------------------
static void dice_stake_formula() {
    using namespace dice_detail;
    // The reference's own test numbers: 107 -> 10, 9 -> 1, 0 -> 0.
    {
        DiceFixture f(1000, 107);
        CHECK(dice_stake_for(f.pool, f.them) == 10);
    }
    {
        DiceFixture f(1000, 9);
        CHECK(dice_stake_for(f.pool, f.them) == 1);
    }
    {
        DiceFixture f(1000, 0);
        CHECK(dice_stake_for(f.pool, f.them) == 0);
        // A broke partner has no game to offer: start refuses.
        DiceGame g;
        CHECK(!dice_start(g, f.pool, f.me, f.them, 7u));
        CHECK(!g.active);
    }
    {
        // ...and a player who cannot COVER the stake is refused too.
        DiceFixture f(5, 1000);
        DiceGame g;
        CHECK(dice_stake_for(f.pool, f.them) == 100);
        CHECK(!dice_start(g, f.pool, f.me, f.them, 7u));
    }
    {
        // Starting moves NO money: the stake settles at the end, not the start.
        DiceFixture f(500, 500);
        DiceGame g;
        CHECK(dice_start(g, f.pool, f.me, f.them, 7u));
        CHECK(rub(f.pool.inventory(f.me)) == 500);
        CHECK(rub(f.pool.inventory(f.them)) == 500);
        CHECK(g.stake == 50);
    }
}

// --- one full deterministic game: roll, hold, greedy packet, settle ----------
static void dice_plays_a_game() {
    using namespace dice_detail;
    DiceFixture f(1000, 1000);
    DiceGame g;
    CHECK(dice_start(g, f.pool, f.me, f.them, 1234u));
    CHECK(g.phase == DicePhase::PlayerTurn);

    // Standing on zero is refused: no free peek at the packet.
    dice_hold(g, f.pool);
    CHECK(g.phase == DicePhase::PlayerTurn && g.npcRolls == 0);

    dice_roll(g, f.pool);
    CHECK(g.playerRolls == 1);
    CHECK(g.playerScore >= 2 && g.playerScore <= 12);
    CHECK(g.lastA >= 1 && g.lastA <= 6 && g.lastB >= 1 && g.lastB <= 6);
    CHECK(g.playerScore == g.lastA + g.lastB);

    const std::int32_t before = g.playerScore;
    dice_hold(g, f.pool);
    CHECK(g.phase == DicePhase::Finished);
    CHECK(g.playerScore == before);        // holding does not roll for you
    CHECK(g.npcRolls >= 1);                // the packet actually played
    CHECK(g.npcRolls <= kDiceNpcRollGuard);
    // The greedy exit: it stopped only past the floor AND not behind (or bust).
    if (g.npcScore <= kDiceTarget && g.npcRolls < kDiceNpcRollGuard) {
        CHECK(g.npcScore >= kDiceNpcHoldFloor);
        CHECK(g.npcScore >= g.playerScore);
    }
    CHECK(g.winner != DiceWinner::None);

    // The loser paid the winner in coins, exactly `paid`, conservation exact.
    const std::int64_t mine = rub(f.pool.inventory(f.me));
    const std::int64_t theirs = rub(f.pool.inventory(f.them));
    CHECK(mine + theirs == 2000);
    if (g.winner == DiceWinner::Player) CHECK(mine == 1000 + g.paid);
    if (g.winner == DiceWinner::Npc) CHECK(mine == 1000 - g.paid);
    if (g.winner == DiceWinner::Draw) CHECK(mine == 1000 && g.paid == 0);
    if (g.winner != DiceWinner::Draw) CHECK(g.paid == g.stake);

    // Settle is idempotent: replaying the verbs moves nothing further.
    dice_hold(g, f.pool);
    dice_roll(g, f.pool);
    dice_surrender(g, f.pool);
    CHECK(rub(f.pool.inventory(f.me)) == mine);

    // Determinism: the same seed replays the same game, roll for roll.
    DiceFixture f2(1000, 1000);
    DiceGame g2;
    CHECK(dice_start(g2, f2.pool, f2.me, f2.them, 1234u));
    dice_roll(g2, f2.pool);
    dice_hold(g2, f2.pool);
    CHECK(g2.playerScore == g.playerScore);
    CHECK(g2.npcScore == g.npcScore);
    CHECK(g2.winner == g.winner);
}

// --- bust ends it on the spot; surrender pays like a loss --------------------
static void dice_bust_and_surrender() {
    using namespace dice_detail;
    {
        // Roll until bust (max 11 rolls: 11 x 2 = 22 > 21 even on snake eyes).
        DiceFixture f(1000, 1000);
        DiceGame g;
        CHECK(dice_start(g, f.pool, f.me, f.them, 99u));
        int rolls = 0;
        while (g.phase == DicePhase::PlayerTurn && rolls < 12) {
            dice_roll(g, f.pool);
            ++rolls;
        }
        CHECK(g.playerScore > kDiceTarget);   // the loop only ends by bust
        CHECK(g.winner == DiceWinner::Npc);
        CHECK(g.npcRolls == 0);               // the partner never lifted the cup
        CHECK(rub(f.pool.inventory(f.me)) == 1000 - g.stake);
    }
    {
        // Esc mid-game is a SURRENDER: the stake leaves, a bad score cannot
        // be walked away from for free.
        DiceFixture f(1000, 1000);
        DiceGame g;
        CHECK(dice_start(g, f.pool, f.me, f.them, 5u));
        dice_roll(g, f.pool);
        dice_surrender(g, f.pool);
        CHECK(g.winner == DiceWinner::Npc);
        CHECK(rub(f.pool.inventory(f.me)) == 1000 - g.stake);
        CHECK(rub(f.pool.inventory(f.them)) == 1000 + g.stake);
    }
}

// --- the loser pays what they physically HOLD --------------------------------
static void dice_settle_is_physical() {
    using namespace dice_detail;
    // The stake froze at start; the loser's purse shrank below it mid-game
    // (here: it was never bigger — stake is theirs, purse is mine). A player
    // holding 3 at a 10-ruble stake pays 3 and stops at zero, never negative —
    // the reference's own clamp, in coins.
    DiceFixture f(100, 1000);
    DiceGame g;
    CHECK(dice_start(g, f.pool, f.me, f.them, 5u));
    CHECK(g.stake == 100);
    // Drain my purse mid-game (spent at the table next door, say).
    f.pool.inventory(f.me).clear();
    inventory_give(f.pool.inventory(f.me), kItemRuble, 3);
    dice_roll(g, f.pool);
    dice_surrender(g, f.pool);
    CHECK(g.winner == DiceWinner::Npc);
    CHECK(g.paid == 3);
    CHECK(rub(f.pool.inventory(f.me)) == 0);
    CHECK(rub(f.pool.inventory(f.them)) == 1003);
}

// --- the conversation row: item gate + worded refusals -----------------------
static void dice_option_gates_on_the_item() {
    using namespace conversation_detail;
    ConvFixture f;
    ConvContext c = f.ctx();

    // No dice at the table: the row is invisible and a stale id acts as None.
    ConvOption opts[kConvMaxOptions];
    std::size_t n = conv_options(c, opts, kConvMaxOptions);
    bool seen = false;
    for (std::size_t i = 0; i < n; ++i)
        if (std::strcmp(opts[i].id, "dice") == 0) seen = true;
    CHECK(!seen);
    CHECK(conv_activate(c, "dice").kind == ConvActionKind::None);

    // The dice land in MY pocket: the row appears — one set is enough,
    // whoever brought it — between trade and leave.
    CHECK(inventory_give(f.pool.inventory(f.playerId), kItemDiceBone, 1) == 0);
    n = conv_options(c, opts, kConvMaxOptions);
    seen = false;
    for (std::size_t i = 0; i < n; ++i)
        if (std::strcmp(opts[i].id, "dice") == 0) {
            seen = true;
            CHECK(i >= 1 && std::strcmp(opts[i - 1].id, "trade") == 0);
        }
    CHECK(seen);

    // A broke partner refuses in words, not in grey.
    ConvAction a = conv_activate(c, "dice");
    CHECK(a.kind == ConvActionKind::Line);
    CHECK(a.line != nullptr && std::strstr(a.line, "пуст") != nullptr);

    // Fund the partner but not me: the refusal flips sides.
    CHECK(inventory_give(f.pool.inventory(f.npc), kItemRuble, 1000) == 0);
    a = conv_activate(c, "dice");
    CHECK(a.kind == ConvActionKind::Line);
    CHECK(a.line != nullptr && std::strstr(a.line, "крыть") != nullptr);

    // Fund me too: the table opens.
    CHECK(inventory_give(f.pool.inventory(f.playerId), kItemRuble, 1000) == 0);
    CHECK(conv_activate(c, "dice").kind == ConvActionKind::Dice);
}

static void test_dice_all() {
    dice_stake_formula();
    dice_plays_a_game();
    dice_bust_and_surrender();
    dice_settle_is_physical();
    dice_option_gates_on_the_item();
    std::fprintf(stderr,
                 "[dice] blackjack-21 holds: stake 10%%, greedy packet, "
                 "physical settle, surrender pays, seeded determinism\n");
}

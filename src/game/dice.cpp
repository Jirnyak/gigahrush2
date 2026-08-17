#include "game/dice.h"

#include "core/rng.h"
#include "game/item_table.h"   // kItemRuble, inventory_give

namespace giga::game {

namespace {

std::int64_t rubles_of(const Inventory& inv) {
    std::int64_t total = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == kItemRuble && s.count > 0) total += s.count;
    return total;
}

// Drain up to `amount` rubles out of `from` into `to`; returns what actually
// crossed. The loser pays what they PHYSICALLY have — the reference clamps the
// transfer to the payer's purse the same way, so a short payer pays short and
// never goes negative. (A receiver with no slot for the coins bounds it too;
// with the payer's own emptied stack in play that is a corner of a corner.)
std::int32_t move_rubles(Inventory& from, Inventory& to, std::int32_t amount) {
    std::int32_t moved = 0;
    for (ItemSlot& s : from.slots) {
        if (moved >= amount) break;
        if (s.item != kItemRuble || s.count == 0) continue;
        const std::int32_t want = amount - moved;
        const std::uint16_t take =
            static_cast<std::uint16_t>(want < s.count ? want : s.count);
        const std::uint16_t unplaced = inventory_give(to, kItemRuble, take,
                                                      s.condition);
        const std::uint16_t landed = static_cast<std::uint16_t>(take - unplaced);
        s.count = static_cast<std::uint16_t>(s.count - landed);
        if (s.count == 0) s = ItemSlot{};
        moved += landed;
        if (unplaced != 0) break;   // receiver full: pay what landed, stop
    }
    return moved;
}

// One die: 1..6 off the game's own stream.
std::uint8_t die(DiceGame& g) {
    g.rng = hash_u32(g.rng ^ 0x9E3779B9u);
    return static_cast<std::uint8_t>(1u + (g.rng % 6u));
}

void settle(DiceGame& g, NpcPool& pool) {
    if (g.settled) return;   // idempotent, like the reference's flag
    g.settled = true;
    g.phase = DicePhase::Finished;
    if (g.winner == DiceWinner::Draw || g.winner == DiceWinner::None) return;
    Inventory& pv = pool.inventory(g.player);
    Inventory& nv = pool.inventory(g.npc);
    if (g.winner == DiceWinner::Player)
        g.paid = move_rubles(nv, pv, g.stake);
    else
        g.paid = move_rubles(pv, nv, g.stake);
}

DiceWinner winner_for(std::int32_t player, std::int32_t npc) {
    const bool pBust = player > kDiceTarget;
    const bool nBust = npc > kDiceTarget;
    if (pBust && nBust) return DiceWinner::Draw;
    if (pBust) return DiceWinner::Npc;
    if (nBust) return DiceWinner::Player;
    if (player == npc) return DiceWinner::Draw;
    return player > npc ? DiceWinner::Player : DiceWinner::Npc;
}

} // namespace

std::int32_t dice_stake_for(const NpcPool& pool, NpcId npc) {
    const std::int64_t money = rubles_of(pool.inventory(npc));
    if (money <= 0) return 0;
    const std::int64_t stake = money / 10;
    return static_cast<std::int32_t>(stake < 1 ? 1 : stake);
}

bool dice_start(DiceGame& g, const NpcPool& pool, NpcId player, NpcId npc,
                std::uint32_t seed) {
    const std::int32_t stake = dice_stake_for(pool, npc);
    if (stake <= 0) return false;                              // partner broke
    if (rubles_of(pool.inventory(player)) < stake) return false;  // you broke
    g = DiceGame{};
    g.npc = npc;
    g.player = player;
    g.stake = stake;
    g.rng = hash_u32(seed ^ 0xD1CEB0E5u);
    g.phase = DicePhase::PlayerTurn;
    g.active = true;
    return true;
}

void dice_roll(DiceGame& g, NpcPool& pool) {
    if (!g.active || g.phase != DicePhase::PlayerTurn) return;
    g.lastA = die(g);
    g.lastB = die(g);
    g.playerScore += g.lastA + g.lastB;
    ++g.playerRolls;
    if (g.playerScore > kDiceTarget) {
        // Bust ends it on the spot: the partner does not even pick the cup up.
        g.winner = DiceWinner::Npc;
        settle(g, pool);
    }
}

void dice_hold(DiceGame& g, NpcPool& pool) {
    if (!g.active || g.phase != DicePhase::PlayerTurn) return;
    if (g.playerScore <= 0) return;   // stand on nothing? roll first
    // The greedy packet: draw to the hold floor AND to beat the player, capped.
    for (int i = 0; i < kDiceNpcRollGuard; ++i) {
        if (g.npcScore > kDiceTarget) break;
        if (g.npcScore >= kDiceNpcHoldFloor && g.npcScore >= g.playerScore)
            break;
        g.npcLastA = die(g);
        g.npcLastB = die(g);
        g.npcScore += g.npcLastA + g.npcLastB;
        ++g.npcRolls;
    }
    g.winner = winner_for(g.playerScore, g.npcScore);
    settle(g, pool);
}

void dice_surrender(DiceGame& g, NpcPool& pool) {
    if (!g.active || g.phase == DicePhase::Finished) return;
    g.winner = DiceWinner::Npc;
    settle(g, pool);
}

} // namespace giga::game

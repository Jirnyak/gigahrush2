// Dice — the conversation table's first GAME row ([conversation.md]).
//
// The reference's rules, ported as rules (dice.ts; the code is ours): blackjack
// on two d6, target 21. The player rolls as many pairs as they dare — the score
// accumulates — then holds; the partner then plays one greedy packet: rolls
// while below 16 or behind the player, hard-capped at 8 rolls. Bust past 21
// loses on the spot; both under 21 → higher score wins; both bust or equal →
// draw, money stays home. Quitting mid-game is a surrender, not an exit: the
// stake is paid, so a bad score cannot be Esc'd away.
//
// THE STAKE IS PHYSICAL. The reference reads `npc.money`; here money is an
// item ([item_table.h] kItemRuble), so the stake is a tenth of the rubles the
// partner actually carries (min 1), the game refuses to start when either side
// cannot cover, and the loser pays in coins that MOVE between the two pool
// rows — the same liquidity law barter runs on ([barter.h] закон 2). A pauper
// simply has no game to offer, and beggaring an NPC at dice leaves them
// beggared at barter too: one pocket, every system.
//
// Randomness is a PER-GAME stream seeded at start, deliberately NOT the world
// seed: the reference keeps gambling off its deterministic seed so a reload
// cannot read the next roll, and the same reasoning holds here — the seed
// comes from the sim tick at the moment the dice hit the table. Tests inject
// their own seed; given one, every roll is reproducible.
//
// Pure game layer, no UI: the panel ([conversation_ui.h]) draws this struct
// and returns keys; main calls the three verbs. Headless-tested in suite_dice.
#pragma once

#include <cstdint>

#include "game/npc_pool.h"

namespace giga::game {

inline constexpr std::int32_t kDiceTarget = 21;
inline constexpr std::int32_t kDiceNpcHoldFloor = 16;  // greedy AI stands here
inline constexpr int kDiceNpcRollGuard = 8;            // hard cap on its turn

enum class DicePhase : std::uint8_t { PlayerTurn = 0, Finished };
enum class DiceWinner : std::uint8_t { None = 0, Player, Npc, Draw };

// One game. POD, lives in main beside the conversation state; one at a time.
struct DiceGame {
    NpcId npc = kInvalidNpc;
    NpcId player = kInvalidNpc;
    std::int32_t stake = 0;
    std::int32_t playerScore = 0;
    std::int32_t npcScore = 0;
    std::uint8_t lastA = 0, lastB = 0;        // player's last pair (0 = none yet)
    std::uint8_t npcLastA = 0, npcLastB = 0;  // partner's last pair
    std::uint8_t playerRolls = 0;
    std::uint8_t npcRolls = 0;
    DicePhase phase = DicePhase::Finished;
    DiceWinner winner = DiceWinner::None;
    std::int32_t paid = 0;       // rubles that actually moved at settle
    std::uint32_t rng = 0;       // per-game stream state
    bool active = false;
    bool settled = false;
};

// The partner's stake: a tenth of their PHYSICAL rubles, min 1, 0 when broke.
std::int32_t dice_stake_for(const NpcPool& pool, NpcId npc);

// Put the dice on the table. False (and no game) when the partner cannot
// stake or the player cannot cover — the conversation option explains which.
bool dice_start(DiceGame& g, const NpcPool& pool, NpcId player, NpcId npc,
                std::uint32_t seed);

// The player throws one pair. Bust settles immediately (partner wins).
void dice_roll(DiceGame& g, NpcPool& pool);

// The player stands; the partner plays its greedy packet and the game settles.
// Refused (no-op) before the first roll: standing on zero is not a game.
void dice_hold(DiceGame& g, NpcPool& pool);

// Walking away mid-game is a loss, and it pays like one.
void dice_surrender(DiceGame& g, NpcPool& pool);

} // namespace giga::game

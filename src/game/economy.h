// The bank — the one thing money could not yet do.
//
// ---------------------------------------------------------------------------
// What was already here, and what the reference adds
// ---------------------------------------------------------------------------
// Read [vendor.h] and [extraction.h] before this file. Between them the build already
// ships a working two-sided economy: `deposit_valuables` turns carried loot into
// `RunLedger::banked` at the pad, `vendor_sell_all` / `vendor_resupply` turn roubles
// back into water and rounds at a 26% round-trip spread, and `item_table.h` prices 446
// items with a depth-gated value cap. That is a complete loop and this file does not
// rebuild any of it.
//
// The reference (`../gigahrush/src/systems/{banking,economy,stock_market,trade,
// production,caravans,gambling,ration_coupons,permits}.ts`, ~215 KB, plus
// `economics.md` and `balance.md`, 1,140 lines, all read) adds nine more systems. What
// is ported HERE is the one with no analogue on this side at all: an account with a
// **term deposit that pays interest** and a **loan that charges it**.
//
// Everything else was examined and deliberately left out. The reasons are recorded
// because a future agent will otherwise port them by default:
//
//   scarcity pricing   The reference's largest economy system: 17 per-floor resource
//     (economy.ts)     stocks, `scarcity x demand x tariff` folded into every quote,
//                      capped at 5x. It is genuinely missing here — every floor prices
//                      water at exactly `int(2 * 1.15) = 2` forever. It is NOT ported
//                      because the only consumer that could pay a moved price is
//                      `vendor_buy_price` / `vendor_sell_price` in vendor.cpp, and a
//                      price function no vendor reads is decoration. It needs a hook
//                      in that file plus the item->resource mapping, which wants the
//                      interned string ids [item_table.h] already defers. Recorded as
//                      the next increment rather than half-built here.
//   stock market       Its own balance doc lists it as a P0 exploit: a 5.5% random
//     (stock_market.ts) move every 45 s, so "no reliable doubling in under 30 real
//                      minutes" already fails in the reference. Nothing in this build
//                      drives quotes — no NPC traders, no production, no caravans — so
//                      a port would be a random walk the player clicks. Refused.
//   production,        Each needs multi-tick per-floor state and a resource flow that
//   caravans           does not exist yet (12 factories / 42 recipes / 6 lanes). They
//                      are downstream of scarcity, not beside it.
//   trade liquidity    Already covered: `kSellPerVisitCap` in [vendor.h] is exactly the
//                      trader-liquidity cap the reference's balance doc lists as its
//                      own missing P0. Porting `trade.ts` would give it two homes.
//   gambling, coupons, Content, not economy structure. `UseEffect::RedeemCoupon`
//   permits            already exists in the item table with no handler, so coupons
//                      are a use-verb increment, not a banking one.
//
// ---------------------------------------------------------------------------
// The premise correction: `banked` is ALREADY safe
// ---------------------------------------------------------------------------
// "A place to put roubles so death does not take everything" describes a gap this
// build does not have. `record_death` ([extraction.h]) adds `at_risk_value(lost)` —
// the value of the dead row's INVENTORY — to `lostToDeath` and never touches
// `banked`. There is no carried-cash concept at all: `vendor_sell_all` credits
// `led.banked` directly and its own comment says so ("there is no cash/account split
// here and inventing one would give value two homes"). So roubles are already
// permanent the instant they exist, and a second wallet added to manufacture a
// death-risk on cash would be exactly the duplicate that comment warns about.
//
// What this bank therefore adds is not safety, it is **cost and yield**:
//
//   * a **term deposit** is strictly LESS liquid than `banked` — `vendor_buy` spends
//     `led.banked` and cannot see the deposit — and pays interest for that. So the
//     decision is "how much can I afford to make unspendable before the next run",
//     which is a real one against a survival clock.
//   * a **loan** is the first way to spend roubles that have not been earned yet, and
//     the first liability in the game. Debt is bank state, not body state, so it
//     survives death by construction — a death with a loan outstanding loses the
//     carried inventory AND still owes. That is the new loss channel, and it is the
//     honest one rather than an invented cash pile.
//
// ---------------------------------------------------------------------------
// Numbers: what is verbatim, what is corrected, what is authored
// ---------------------------------------------------------------------------
// VERBATIM from the reference (`data/banking.ts`, `data/economics.ts`):
//   ledger ring 24 entries        BANKING_LEDGER_CAPACITY
//   interest catch-up cap 24      BANKING_MAX_INTEREST_PERIODS
//   E0 credit limit 500           BANKING_DEFAULT_CREDIT_LIMIT
//   E0 loan:deposit rate 1.5      0.015 / 0.010; here 9 bp / 6 bp, the same ratio
//   the E0..E4 columns            ECONOMY_MONEY_BANDS: lootValueCap 90/450/4000/
//                                 80000/250000, maxLiquidCash 250/2000/25000/250000/
//                                 5000000, ordinaryQuestCap 250/800/8000/45000/250000,
//                                 baseQuestCashRate 35/70/160/420/1200
//   the 5 wealth tiers            economics.md SS7: 0..100 / 100..2000 / 2000..50000 /
//                                 50000..1000000 / 1000000+, cap 5000000
//
// CORRECTED, using the reference's own balance doc against its own code: the shipped
// deposit rate is `1% per 60 game minutes`, and `balance.md` SS11 lists that as a
// **P0** — "Passive finance обгоняет вылазки" — recommending `0.1..0.3% per game day`
// instead. Applying that correction to the shipped 100 bp lands near 1..4 bp per
// period. E0 is authored at **6 bp**, slightly above the window, because integer
// roubles need headroom: at 4 bp a deposit under 2,500 rub earns literally nothing per
// period, and 6 bp puts that dead zone at 1,667 rub — the floor of the reference's own
// E1 band, so "100₽ must remain meaningful at start" holds exactly.
//
// AUTHORED here, and flagged as such because they are not in the reference: the
// per-band gradient. Deposit rates FALL with depth (6/5/4/2/1 bp) and loan rates RISE
// (9/12/18/30/45 bp). The shape is ported — `balance.md` SS3 gives the reference's own
// per-floor bank multipliers, `bank floor 6.5, Ministry 2.4, Maintenance 1.25, Hell
// 0.45`, i.e. the hub bank is the good one and the depths are not — but the five pairs
// of numbers are chosen here. Credit limits likewise: 500 is the reference's, and
// 1,600 keeps its 2x-ordinary-quest-cap relation, after which the multiple is cut
// deliberately (1x, 0.5x, 0.2x) because `balance.md` P0 #4 says a loan must fund one
// sortie and not leverage.
//
// MEASURED consequences, all of them reproduced by `suite_economy` running the real
// integer path rather than a formula, so a retune argues with numbers rather than taste:
//   * E0 deposit doubling time: **1,157 periods = 19.3 real hours** on a 1,000,000
//     principal (integer truncation makes it one period slower than the float
//     `ln 2 / ln(1.0006)` = 1,156). The balance doc's bar is "no reliable doubling in
//     under 30 real minutes" — cleared by 38x. At 1 bp (E4) it is 6,957 periods = 116 h.
//   * E0 compounded yield is 3.65%/hour. On 250,000 rub (the E3 liquid-cash ceiling)
//     that is **9,131 rub/hour** — and this build's measured floor-0 whole-floor income
//     is 7,364 rub ([loot.h]: 5,647 from kills + 1,717 from 24 crates), so clearing the
//     HUB even once every 48 minutes out-earns a quarter-million on deposit, and floor
//     -13's 462,171 out-earns it by 50x per clear. Deposits cannot replace descending.
//     This is the number to move if that ever stops holding.
//   * a `vendor_resupply` at main's shipped budget of 600 rub is the unit a loan is
//     measured in, so E0's 500 funds most of one kit and E4's 50,000 about 83.
//
// ---------------------------------------------------------------------------
// Integer roubles, and the one asymmetry that matters
// ---------------------------------------------------------------------------
// There is no float currency and there will not be one: a float balance drifts across
// a save/load boundary and the whole ledger is integer ([extraction.h] `banked` is
// `int64_t`). Rates are **basis points** and interest is `principal * bp / 10000`.
//
// Deposit interest rounds DOWN, loan interest rounds UP. That is not a rounding
// preference, it closes a hole: at 9 bp a 500-rouble loan accrues `0.45` roubles per
// period, which truncates to **zero** — a permanently interest-free debt, the exact
// money press the deposit/loan spread exists to prevent. Rounding the charge up means
// any outstanding principal costs at least 1 rouble per period. Measured: a 500-rouble
// E0 loan therefore costs 1 rub/period = 60 rub/hour, which is 12%/hour on the
// principal and is punitive on purpose ("Keep loan rate punitive and social",
// balance.md SS5). Small loans are the expensive ones, and that is stated rather than
// hidden.
//
// Deposit interest COMPOUNDS (the reference loops per period and re-reads the grown
// principal); loan interest is SIMPLE (the reference multiplies `principal * rate *
// periods` once). Both ported as-is, which is why `bank_step` is a bounded loop for
// one and a single multiply for the other.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/tick.h"        // kSimHz — the interest period is expressed in sim ticks
#include "game/item_table.h"  // kEconomyBands, kLootValueCap, economy_band

namespace giga::game {

struct RunLedger;   // [extraction.h]; only ever taken by reference here

// ---------------------------------------------------------------------------
// The generated table (data/economy.csv -> tools/gen_economy_table.py)
// ---------------------------------------------------------------------------

inline constexpr std::size_t kWealthTierCount = 5;

// The row count the source_rules gate compares against data/economy.csv. A LITERAL on
// purpose: the gate reads it with a regex, so a computed expression would make the
// drift check silently blind (tools/check_source_rules.cmake Rule 7 fails loudly on a
// missing declaration, but only if the pattern is the one it looks for).
inline constexpr std::size_t kEconomyRows = 10;
static_assert(kEconomyRows == kEconomyBands + kWealthTierCount,
              "data/economy.csv holds both tables; kEconomyRows is their sum and the "
              "gate reads it, so the two halves cannot drift apart unnoticed");

// One depth band's money contract. POD, 28 bytes, no interior padding: the whole table
// is 140 B and is permanently cache-resident like the item and mob tables.
//
// The first four columns are the reference's `EconomyMoneyBandDef` verbatim; only
// `lootCap` currently has a second consumer (`kLootValueCap`, which the generator
// cross-checks). `cashCap` / `questCap` / `questRate` are carried because they are the
// authored contract for the quest and container systems that will price against them
// ([contract.h] pays flat numbers today), and because a band table missing three of
// its five reference columns is a table someone will re-derive by guess.
struct BankTerms {
    std::int32_t lootCap;      //  0  == kLootValueCap[band]
    std::int32_t cashCap;      //  4  reference maxLiquidCash: liquid cash this band expects
    std::int32_t questCap;     //  8  reference ordinaryQuestCap
    std::int32_t questRate;    // 12  reference baseQuestCashRate
    std::int32_t creditLimit;  // 16  before the per-branch seed jitter
    std::uint16_t depositBp;   // 20  basis points per interest period, paid
    std::uint16_t loanBp;      // 22  basis points per interest period, charged
    std::uint8_t floorLo;      // 24  |floor| bracket, inclusive
    std::uint8_t floorHi;      // 25
    std::uint8_t pad_[2];      // 26
};
static_assert(sizeof(BankTerms) == 28, "BankTerms must stay a tight 28-byte row");
static_assert(alignof(BankTerms) == 4);
static_assert(std::is_trivially_copyable_v<BankTerms>);

// A net-worth bracket, in roubles. `hi` is exclusive; the last tier's `hi` is the
// reference's 5,000,000 wealth cap and is informational — `wealth_tier` returns the
// last tier for anything above it, because this build's own floor -26 pays 3.5M for a
// single clear ([loot.h]) and a player past the cap is still a millionaire.
struct WealthTier {
    std::int64_t lo;
    std::int64_t hi;
};
static_assert(sizeof(WealthTier) == 16);
static_assert(std::is_trivially_copyable_v<WealthTier>);

extern const std::array<BankTerms, kEconomyBands> kBankTerms;
extern const std::array<const char*, kEconomyBands> kBandNames;
extern const std::array<WealthTier, kWealthTierCount> kWealthTiers;
extern const std::array<const char*, kWealthTierCount> kWealthTierNames;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// One interest period, in sim ticks. 60 s of real play at kSimHz — expressed in TICKS
// and not seconds because the sim clock is the only monotonic integer clock the bank
// can be deterministic against ([tick.h]: 125 Hz, kSimStepMs exactly 8). The macro
// clock was the other candidate and is wrong for this: it models 7 days per 2 s of
// wall time, so any per-game-day rate would be a 300,000x money press.
inline constexpr std::uint64_t kBankPeriodTicks =
    60ull * static_cast<std::uint64_t>(kSimHz);
static_assert(kBankPeriodTicks == 7500ull);

// Interest periods one `bank_step` may settle. The reference's
// BANKING_MAX_INTEREST_PERIODS, verbatim. It bounds the WORK of a single call (the
// deposit loop compounds per period), not the total interest: `lastInterestTick`
// advances only by what was settled, so a long gap is paid off across several calls.
// That is the reference's behaviour too, and it is what keeps this O(1) on the tick.
inline constexpr std::uint32_t kBankMaxCatchupPeriods = 24u;

// Recent-operation ring. The reference's BANKING_LEDGER_CAPACITY, verbatim, as a fixed
// array rather than a growing vector — this struct has to stay POD so a save can write
// it field by field like every other run struct ([save.h]).
inline constexpr std::size_t kBankLedgerSlots = 24;

// Per-branch credit-limit jitter, in basis points either way. +-20%.
//
// This is what the `seed` argument to `bank_open` is FOR, and it is the one place the
// bank is a function of the seed rather than only of the tick. The reference varies a
// branch's capacity by floor (balance.md SS3: bank floor 6.5, Ministry 2.4, Maintenance
// 1.25, Hell 0.45); this is that idea with the machinery this engine has. It is a pure
// function of (seed, floor), so it never moves per tick — which is deliberate, because
// a limit that wobbles on a timer is a limit the player farms by waiting instead of a
// fact they can learn about a floor.
inline constexpr std::int32_t kBankCreditJitterBp = 2000;

// Ceiling on the deposit principal, in roubles. NOT a balance rule — an overflow
// guard, and it is here rather than as a comment because the alternative is undefined
// behaviour in a multiply. `bank_step` computes `principal * loanBp` in int64; at this
// ceiling and the highest authored rate (45 bp) that is 4.5e13, four orders of
// magnitude below INT64_MAX. A deposit is accepted up to the ceiling and the remainder
// is refused, reported as a partial like `vendor_buy` reports what landed.
inline constexpr std::int64_t kBankMaxPrincipal = 1'000'000'000'000ll;

// ---------------------------------------------------------------------------
// Account state
// ---------------------------------------------------------------------------

// What kind of movement a ledger entry records.
enum class BankOp : std::uint8_t {
    None = 0,
    Deposit,          // banked -> deposit
    Withdraw,         // deposit -> banked
    TakeLoan,         // credit -> banked, principal up
    RepayLoan,        // banked -> debt
    DepositInterest,  // the bank paid you
    LoanInterest,     // the bank charged you
    Count
};

// 12 bytes, no interior padding. `band` is carried because which branch charged you is
// the only thing about a debt that is not reconstructible from the amount.
struct BankEntry {
    std::int32_t amount = 0;   // 0  roubles, always positive
    std::uint32_t tick = 0;    // 4  sim tick, truncated to 32 bits (~397 days at 125 Hz)
    std::uint8_t op = 0;       // 8  BankOp
    std::uint8_t band = 0;     // 9
    std::uint8_t pad_[2]{};    // 10
};
static_assert(sizeof(BankEntry) == 12);
static_assert(alignof(BankEntry) == 4);
static_assert(std::is_trivially_copyable_v<BankEntry>);

// The player's account. POD, fixed size, pointer-free — so the save can write it field
// by field exactly like `RunLedger`, and so a test can digest it byte-meaningfully.
//
// **NOT in `SaveState` yet.** [save.h] is not this file's to edit and adding a struct
// there is a `kSaveVersion` bump, which invalidates every existing save. So today F5/F9
// preserve `banked` and forget the deposit and the debt. That is a real gap, it is
// stated here rather than in a commit message, and this struct is shaped to make the
// fix mechanical: no pointers, no vectors, one size assert.
struct BankAccount {
    std::int64_t deposit = 0;          //  0  locked principal; NOT spendable by the vendor
    std::int64_t loanPrincipal = 0;    //  8
    std::int64_t loanAccrued = 0;      // 16  interest owed on top of the principal
    std::int64_t interestEarned = 0;   // 24  lifetime, for the HUD
    std::int64_t interestPaid = 0;     // 32  lifetime
    std::uint64_t lastInterestTick = 0;// 40  sim tick the last period settled at
    std::int32_t creditLimit = 0;      // 48  this branch's, after the seed jitter. 0 until
                                       //     bank_open runs, so no branch means no loans.
    std::uint32_t entries = 0;         // 52  total ops ever; ring slot = entries % slots
    BankEntry ledger[kBankLedgerSlots]{};  // 56
    std::uint8_t band = 0;             // 344 which BankTerms are in force
    std::uint8_t pad_[7]{};            // 345
};
static_assert(sizeof(BankAccount) == 352,
              "the save format will pin this size; grow it on purpose and bump "
              "kSaveVersion in the same edit");
static_assert(alignof(BankAccount) == 8);
static_assert(std::is_trivially_copyable_v<BankAccount>);

// What one `bank_step` settled. Zero on almost every tick, which is the common case.
struct BankTick {
    std::int32_t earned = 0;    // deposit interest credited
    std::int32_t paid = 0;      // loan interest charged
    std::uint32_t periods = 0;  // how many periods this call settled
};

// ---------------------------------------------------------------------------
// API — every amount is roubles, every return is what ACTUALLY moved
// ---------------------------------------------------------------------------
// Amounts are `int32_t` because one operation is bounded; balances are `int64_t`
// because `RunLedger::banked` is. Every mutator reports what landed rather than a
// bool, following `vendor_buy` and `use_best_heal`: a partial deposit is a real
// outcome and a caller that cannot see the difference will print the wrong number.

// Terms of band `band`. Total: an out-of-range index clamps to the last band rather
// than reading past the array, because the return value is dereferenced immediately.
const BankTerms& bank_terms(std::uint8_t band);
const char* band_name(std::uint8_t band);

// Open (or re-open) the branch on the floor you are standing on. Sets `band` from
// `economy_band(floorZ)` and `creditLimit` from that band's authored limit with the
// per-(seed, floor) jitter above. Touches nothing else — not the balances, not
// `lastInterestTick`.
//
// One hash and two multiplies, and **idempotent for a fixed (floorZ, seed)**, so
// calling it every sim tick is exactly equivalent to calling it on arrival and is the
// recommended wiring. That is not laziness: `src/app/main.cpp` has TWO floor-travel
// sites (the keyboard ride and the `--shot` capture ride) and its own comments record
// what it cost the last time a per-arrival fix patched only one of them.
//
// Re-opening on a worse floor can leave existing debt above the new limit;
// `bank_credit_available` clamps at 0 rather than reporting negative headroom, so the
// player can still repay but cannot borrow more. That is the intended behaviour: you
// took the loan at the good branch, you still owe it at the bad one.
void bank_open(BankAccount& acct, int floorZ, std::uint32_t seed);

// banked -> deposit. Refuses more than `led.banked` holds and more than
// `kBankMaxPrincipal` leaves room for; returns what moved.
std::int32_t bank_deposit(BankAccount& acct, RunLedger& led, std::int32_t amount,
                          std::uint64_t tick);

// deposit -> banked. Returns what moved.
std::int32_t bank_withdraw(BankAccount& acct, RunLedger& led, std::int32_t amount,
                           std::uint64_t tick);

// Borrow against `creditLimit`. The proceeds land in `led.banked`, which is what the
// vendor spends, so a loan is immediately usable as kit. Returns what was lent, capped
// by the remaining credit.
std::int32_t bank_take_loan(BankAccount& acct, RunLedger& led, std::int32_t amount,
                            std::uint64_t tick);

// Pay down the debt from `led.banked`. Accrued interest is cleared before principal —
// the reference's order, and the one that matters, because principal is what accrues.
// Returns what was paid.
std::int32_t bank_repay(BankAccount& acct, RunLedger& led, std::int32_t amount,
                        std::uint64_t tick);

// One-keypress forms, so the app's wiring is one call per key rather than a UI.
std::int32_t bank_deposit_all(BankAccount& acct, RunLedger& led, std::uint64_t tick);
std::int32_t bank_withdraw_all(BankAccount& acct, RunLedger& led, std::uint64_t tick);
std::int32_t bank_borrow_max(BankAccount& acct, RunLedger& led, std::uint64_t tick);
std::int32_t bank_repay_all(BankAccount& acct, RunLedger& led, std::uint64_t tick);

// Settle whatever interest periods have elapsed. Safe and O(1) to call every sim tick:
// it returns immediately unless a full period has passed, and the loop it can enter is
// bounded by `kBankMaxCatchupPeriods`. No allocation, no floating point.
//
// **This is the only function in the file that changes net worth.** Every other
// operation is a transfer. That is the invariant `suite_economy` asserts.
BankTick bank_step(BankAccount& acct, std::uint64_t tick);

// Principal + accrued interest.
std::int64_t bank_debt(const BankAccount& acct);

// How much more can be borrowed right now, never negative.
std::int64_t bank_credit_available(const BankAccount& acct);

// banked + deposit - debt. The number the HUD should show, and the one conserved by
// every operation except `bank_step`.
std::int64_t net_worth(const RunLedger& led, const BankAccount& acct);

// Which wealth tier a net worth falls in. Clamps: below the first tier (a net worth
// dragged negative by debt) reads as tier 0, above the last reads as the last.
std::uint8_t wealth_tier(std::int64_t worth);
const char* wealth_tier_name(std::uint8_t tier);

// The most recent ledger entry, or nullptr when nothing has happened yet.
const BankEntry* bank_last_entry(const BankAccount& acct);
const char* bank_op_name(BankOp op);

// ---------------------------------------------------------------------------
// Dynamic Market Fluctuations & Scarcity Drift
// ---------------------------------------------------------------------------

// Supply & demand indices and combined price multiplier for an item or category.
struct MarketQuote {
    float supplyIndex = 1.0f;     // Supply availability on floor (lower = scarce)
    float demandIndex = 1.0f;     // Demand intensity on floor (higher = desperate)
    float priceMultiplier = 1.0f; // Combined price multiplier against baseline
};

// Restock cycle cadence: 6 game hours (360 sim seconds at 60s/hour).
inline constexpr float kVendorRestockIntervalSec = 360.0f;
inline constexpr std::size_t kVendorMaxStockedItems = 64;

struct VendorStockItem {
    ItemId id = kInvalidItem;
    std::uint16_t count = 0;
    std::uint16_t maxCapacity = 0;
};

struct VendorRestockState {
    float lastRestockSec = 0.0f;
    std::uint32_t restockCycles = 0;
    std::int16_t floorZ = 0;
    std::uint8_t itemCount = 0;
    std::uint8_t initialized = 0;
    VendorStockItem items[kVendorMaxStockedItems]{};
};

struct RpgStats;

// Category price multiplier on floorZ given game clock seconds.
// Ammo & Meds drift significantly higher on deeper floors (higher danger/scarcity).
float market_category_price_mult(ItemCategory cat, int floorZ, float gameClockSec = 0.0f);

// Full market quote (supply, demand, combined multiplier) for an item on floorZ.
MarketQuote market_quote_item(ItemId id, int floorZ, float gameClockSec = 0.0f);

// Dynamic buy price (roubles) reflecting floor depth scarcity, game-clock drift,
// and player reputation.
std::int32_t dynamic_market_buy_price(ItemId id, int floorZ, float gameClockSec = 0.0f,
                                      std::int8_t playerRelation = 0);

// Dynamic sell price (roubles) guaranteeing strict sell < buy no-arbitrage invariant.
std::int32_t dynamic_market_sell_price(ItemId id, std::uint8_t vendorKind, int floorZ,
                                       float gameClockSec = 0.0f,
                                       const RpgStats* rpg = nullptr,
                                       std::int8_t playerRelation = 0);

// Vendor restock lifecycle:
void vendor_restock_init(VendorRestockState& state, int floorZ, float gameClockSec = 0.0f);
bool vendor_restock_step(VendorRestockState& state, int floorZ, float gameClockSec);
std::uint16_t vendor_get_item_stock(const VendorRestockState& state, ItemId id);
std::uint16_t vendor_consume_item_stock(VendorRestockState& state, ItemId id, std::uint16_t count);

} // namespace giga::game

#include "game/economy.h"

#include <algorithm>
#include <cmath>

#include "core/rng.h"          // hash2 — the per-branch credit jitter
#include "game/extraction.h"   // RunLedger: `banked` is the account this bank moves
#include "game/rpg.h"          // int_document_reward_mult_e3
#include "game/vendor.h"       // vendor_stocks_item, kBuyMult, kSellMult, VendorKind

namespace giga::game {

namespace {

// One basis point denominator, in one place. `bp / 10000` appears in four expressions
// below and a literal 10000 in four places is how three of them stay in step and the
// fourth quietly becomes per-mille.
constexpr std::int64_t kBpScale = 10000;

// Clamp an int64 rouble figure into the int32 an amount argument carries. Balances are
// wider than amounts on purpose ([economy.h]), so every "all of it" convenience has to
// narrow somewhere, and doing it here means it is narrowed once.
std::int32_t as_amount(std::int64_t v) {
    if (v <= 0) return 0;
    constexpr std::int64_t kMax = 2147483647ll;
    return static_cast<std::int32_t>(v > kMax ? kMax : v);
}

// Append to the 24-slot ring. `entries` is the lifetime count and never wraps in
// practice (uint32 at one op per keypress), so the newest entry is always
// `(entries - 1) % kBankLedgerSlots` and the ring needs no separate head index.
void push_entry(BankAccount& acct, BankOp op, std::int32_t amount, std::uint64_t tick) {
    if (amount <= 0) return;   // a no-op movement is not history
    BankEntry& e = acct.ledger[acct.entries % kBankLedgerSlots];
    e.amount = amount;
    e.tick = static_cast<std::uint32_t>(tick & 0xFFFFFFFFull);
    e.op = static_cast<std::uint8_t>(op);
    e.band = acct.band;
    e.pad_[0] = 0;
    e.pad_[1] = 0;
    ++acct.entries;
}

} // namespace

const BankTerms& bank_terms(std::uint8_t band) {
    const std::size_t i = static_cast<std::size_t>(band);
    return kBankTerms[i < kEconomyBands ? i : kEconomyBands - 1];
}

const char* band_name(std::uint8_t band) {
    const std::size_t i = static_cast<std::size_t>(band);
    return kBandNames[i < kEconomyBands ? i : kEconomyBands - 1];
}

void bank_open(BankAccount& acct, int floorZ, std::uint32_t seed) {
    acct.band = economy_band(floorZ);
    const BankTerms& t = bank_terms(acct.band);

    // A pure function of (seed, floor): stable for the whole session, so a player can
    // learn that the branch two floors down lends better, and cannot farm it by
    // waiting. `floorZ` is signed and cast modularly on purpose — -13 and +13 are
    // different branches, which is the point of a bidirectional stack.
    const std::uint32_t h = hash2(seed, static_cast<std::uint32_t>(floorZ));
    const std::int64_t span = 2ll * kBankCreditJitterBp + 1ll;   // [-2000, +2000] bp
    const std::int64_t jitter =
        kBpScale - kBankCreditJitterBp + static_cast<std::int64_t>(h % static_cast<std::uint32_t>(span));
    acct.creditLimit =
        static_cast<std::int32_t>(static_cast<std::int64_t>(t.creditLimit) * jitter /
                                 kBpScale);
}

std::int32_t bank_deposit(BankAccount& acct, RunLedger& led, std::int32_t amount,
                          std::uint64_t tick) {
    if (amount <= 0) return 0;
    std::int64_t n = amount;
    if (n > led.banked) n = led.banked;
    const std::int64_t room = kBankMaxPrincipal - acct.deposit;
    if (n > room) n = room;
    if (n <= 0) return 0;
    led.banked -= n;
    acct.deposit += n;
    const std::int32_t moved = static_cast<std::int32_t>(n);
    push_entry(acct, BankOp::Deposit, moved, tick);
    // A deposit opened on a fresh account starts its interest clock HERE and not at
    // tick 0. Without this the first `bank_step` would settle every period since the
    // program began — the reference guards the same case (`if (bank.lastInterestAt <= 0)
    // bank.lastInterestAt = currentMinutes(state)`), and the failure is a free jackpot
    // on the first deposit rather than a crash.
    if (acct.lastInterestTick == 0 && acct.loanPrincipal == 0) acct.lastInterestTick = tick;
    return moved;
}

std::int32_t bank_withdraw(BankAccount& acct, RunLedger& led, std::int32_t amount,
                           std::uint64_t tick) {
    if (amount <= 0) return 0;
    std::int64_t n = amount;
    if (n > acct.deposit) n = acct.deposit;
    if (n <= 0) return 0;
    acct.deposit -= n;
    led.banked += n;
    const std::int32_t moved = static_cast<std::int32_t>(n);
    push_entry(acct, BankOp::Withdraw, moved, tick);
    return moved;
}

std::int32_t bank_take_loan(BankAccount& acct, RunLedger& led, std::int32_t amount,
                            std::uint64_t tick) {
    if (amount <= 0) return 0;
    std::int64_t n = amount;
    const std::int64_t avail = bank_credit_available(acct);
    if (n > avail) n = avail;
    const std::int64_t room = kBankMaxPrincipal - acct.loanPrincipal;
    if (n > room) n = room;
    if (n <= 0) return 0;
    acct.loanPrincipal += n;
    // The proceeds are SPENDABLE, straight into the field the vendor reads. A loan you
    // cannot spend on kit is not leverage, it is a number.
    led.banked += n;
    const std::int32_t moved = static_cast<std::int32_t>(n);
    push_entry(acct, BankOp::TakeLoan, moved, tick);
    if (acct.lastInterestTick == 0 && acct.deposit == 0) acct.lastInterestTick = tick;
    return moved;
}

std::int32_t bank_repay(BankAccount& acct, RunLedger& led, std::int32_t amount,
                        std::uint64_t tick) {
    if (amount <= 0) return 0;
    std::int64_t n = amount;
    const std::int64_t debt = bank_debt(acct);
    if (n > debt) n = debt;
    if (n > led.banked) n = led.banked;
    if (n <= 0) return 0;
    led.banked -= n;
    // Accrued interest first, principal second — the reference's order (`repayLoan`),
    // and the one that matters: only principal accrues, so paying interest first is
    // strictly worse for the player and is therefore what a bank does.
    const std::int64_t onInterest = n < acct.loanAccrued ? n : acct.loanAccrued;
    acct.loanAccrued -= onInterest;
    acct.loanPrincipal -= (n - onInterest);
    const std::int32_t paid = static_cast<std::int32_t>(n);
    push_entry(acct, BankOp::RepayLoan, paid, tick);
    return paid;
}

std::int32_t bank_deposit_all(BankAccount& acct, RunLedger& led, std::uint64_t tick) {
    return bank_deposit(acct, led, as_amount(led.banked), tick);
}

std::int32_t bank_withdraw_all(BankAccount& acct, RunLedger& led, std::uint64_t tick) {
    return bank_withdraw(acct, led, as_amount(acct.deposit), tick);
}

std::int32_t bank_borrow_max(BankAccount& acct, RunLedger& led, std::uint64_t tick) {
    return bank_take_loan(acct, led, as_amount(bank_credit_available(acct)), tick);
}

std::int32_t bank_repay_all(BankAccount& acct, RunLedger& led, std::uint64_t tick) {
    const std::int64_t debt = bank_debt(acct);
    const std::int64_t can = debt < led.banked ? debt : led.banked;
    return bank_repay(acct, led, as_amount(can), tick);
}

BankTick bank_step(BankAccount& acct, std::uint64_t tick) {
    BankTick out{};

    // The clock went backwards. Reachable today: a load restores a run whose tick
    // counter is behind the live one. Re-anchor rather than settling a negative span,
    // which is what the reference does (`if (bank.lastInterestAt > now)`).
    if (tick < acct.lastInterestTick) {
        acct.lastInterestTick = tick;
        return out;
    }
    // Nothing to settle. Re-anchoring here is what stops an idle account from banking
    // up periods it will collect the instant a deposit lands.
    if (acct.deposit <= 0 && acct.loanPrincipal <= 0) {
        acct.lastInterestTick = tick;
        return out;
    }
    const std::uint64_t elapsed = tick - acct.lastInterestTick;
    if (elapsed < kBankPeriodTicks) return out;

    std::uint64_t periods = elapsed / kBankPeriodTicks;
    if (periods > kBankMaxCatchupPeriods) periods = kBankMaxCatchupPeriods;

    const BankTerms& t = bank_terms(acct.band);

    // Deposit interest COMPOUNDS, one period at a time, rounding DOWN. Bounded by
    // kBankMaxCatchupPeriods, so this is 24 iterations worst case and O(1) on the tick.
    std::int64_t earned = 0;
    if (acct.deposit > 0 && t.depositBp > 0) {
        for (std::uint64_t i = 0; i < periods; ++i) {
            const std::int64_t g =
                acct.deposit * static_cast<std::int64_t>(t.depositBp) / kBpScale;
            // The integer dead zone. Below `kBpScale / depositBp` roubles the yield
            // truncates to nothing, and it will still be nothing next period because
            // the principal did not move — so break rather than spin 24 times. This is
            // also the "100 rub stays meaningful" guarantee, as arithmetic: at 6 bp a
            // deposit under 1,667 rub earns exactly zero, forever.
            if (g <= 0) break;
            if (acct.deposit + g > kBankMaxPrincipal) break;   // overflow guard
            acct.deposit += g;
            earned += g;
        }
    }

    // Loan interest is SIMPLE — `principal * rate * periods`, the reference's shape —
    // and rounds UP. See [economy.h]: at 9 bp a 500-rouble debt truncates to zero per
    // period, which would be a permanently free loan and exactly the money press the
    // deposit/loan spread exists to close.
    std::int64_t paid = 0;
    if (acct.loanPrincipal > 0 && t.loanBp > 0) {
        const std::int64_t perPeriod =
            (acct.loanPrincipal * static_cast<std::int64_t>(t.loanBp) + kBpScale - 1) /
            kBpScale;
        paid = perPeriod * static_cast<std::int64_t>(periods);
        acct.loanAccrued += paid;
    }

    // Advance by what was SETTLED, not to `tick`. A long gap is therefore paid off
    // across several calls instead of in one unbounded loop, and no time is lost.
    acct.lastInterestTick += periods * kBankPeriodTicks;

    acct.interestEarned += earned;
    acct.interestPaid += paid;
    out.earned = as_amount(earned);
    out.paid = as_amount(paid);
    out.periods = static_cast<std::uint32_t>(periods);
    if (earned > 0) push_entry(acct, BankOp::DepositInterest, out.earned, tick);
    if (paid > 0) push_entry(acct, BankOp::LoanInterest, out.paid, tick);
    return out;
}

std::int64_t bank_debt(const BankAccount& acct) {
    return acct.loanPrincipal + acct.loanAccrued;
}

std::int64_t bank_credit_available(const BankAccount& acct) {
    const std::int64_t left = static_cast<std::int64_t>(acct.creditLimit) - bank_debt(acct);
    return left > 0 ? left : 0;
}

std::int64_t net_worth(const RunLedger& led, const BankAccount& acct) {
    return led.banked + acct.deposit - bank_debt(acct);
}

std::uint8_t wealth_tier(std::int64_t worth) {
    if (worth < kWealthTiers[0].lo) return 0;
    std::uint8_t tier = 0;
    for (std::size_t i = 0; i < kWealthTierCount; ++i)
        if (worth >= kWealthTiers[i].lo) tier = static_cast<std::uint8_t>(i);
    return tier;
}

const char* wealth_tier_name(std::uint8_t tier) {
    const std::size_t i = static_cast<std::size_t>(tier);
    return kWealthTierNames[i < kWealthTierCount ? i : kWealthTierCount - 1];
}

const BankEntry* bank_last_entry(const BankAccount& acct) {
    if (acct.entries == 0) return nullptr;
    return &acct.ledger[(acct.entries - 1u) % kBankLedgerSlots];
}

const char* bank_op_name(BankOp op) {
    switch (op) {
        case BankOp::Deposit:         return "deposit";
        case BankOp::Withdraw:        return "withdraw";
        case BankOp::TakeLoan:        return "loan";
        case BankOp::RepayLoan:       return "repay";
        case BankOp::DepositInterest: return "interest paid to you";
        case BankOp::LoanInterest:    return "interest charged";
        case BankOp::None:
        case BankOp::Count:
        default:                      return "none";
    }
}

// ---------------------------------------------------------------------------
// Dynamic Market Fluctuations & Scarcity Drift
// ---------------------------------------------------------------------------

float market_category_price_mult(ItemCategory cat, int floorZ, float gameClockSec) {
    const std::uint8_t band = economy_band(floorZ);
    const float b = static_cast<float>(band);

    float baseMult = 1.0f;
    switch (cat) {
        case ItemCategory::Ammo:
            // High danger on deep floors -> ammunition becomes critically scarce and valuable.
            baseMult = 1.0f + 0.35f * b;
            break;
        case ItemCategory::Medicine:
            // Medical supplies and trauma treatments are desperately sought in deep zones.
            baseMult = 1.0f + 0.28f * b;
            break;
        case ItemCategory::Drink:
            baseMult = 1.0f + 0.15f * b;
            break;
        case ItemCategory::Food:
            baseMult = 1.0f + 0.12f * b;
            break;
        case ItemCategory::Misc:
            baseMult = 1.0f + 0.08f * b;
            break;
        case ItemCategory::Tool:
        case ItemCategory::Key:
            baseMult = 1.0f + 0.10f * b;
            break;
        case ItemCategory::Note:
            baseMult = 1.0f + 0.20f * b;
            break;
        default:
            baseMult = 1.0f;
            break;
    }

    // Diurnal / periodic market cycle: subtle +/-8% drift over the 1440-second in-game day.
    float drift = 0.0f;
    if (gameClockSec > 0.0f) {
        constexpr float kTwoPi = 6.283185307f;
        const float phase = (gameClockSec / 1440.0f) * kTwoPi + static_cast<float>(cat) * 1.25f;
        drift = 0.08f * std::sin(phase);
    }

    float mult = baseMult * (1.0f + drift);
    if (mult < 0.4f) mult = 0.4f;
    if (mult > 4.0f) mult = 4.0f;
    return mult;
}

MarketQuote market_quote_item(ItemId id, int floorZ, float gameClockSec) {
    if (!item_valid(id)) {
        return MarketQuote{1.0f, 1.0f, 1.0f};
    }
    const ItemDef& d = item_def(id);
    const auto cat = static_cast<ItemCategory>(d.category);
    const float catMult = market_category_price_mult(cat, floorZ, gameClockSec);

    const std::uint8_t band = economy_band(floorZ);
    const float depthMod = 1.0f + 0.25f * static_cast<float>(band);

    // Rarity factor from spawn weight
    float rarity = 1.5f;
    if (d.spawnWeight > 0) {
        const float w = static_cast<float>(d.spawnWeight);
        rarity = std::clamp(1000.0f / (w + 100.0f), 0.5f, 2.5f);
    }

    float supply = 1.0f;
    float demand = 1.0f;

    if (cat == ItemCategory::Ammo) {
        supply = std::max(0.20f, 1.25f / depthMod);
        demand = 0.90f * depthMod * rarity;
    } else if (cat == ItemCategory::Medicine) {
        supply = std::max(0.25f, 1.20f / depthMod);
        demand = 0.85f * depthMod * rarity;
    } else if (cat == ItemCategory::Food || cat == ItemCategory::Drink) {
        supply = std::max(0.35f, 1.10f / (1.0f + 0.12f * static_cast<float>(band)));
        demand = 0.90f * (1.0f + 0.10f * static_cast<float>(band)) * rarity;
    } else {
        supply = std::max(0.30f, 1.00f / (1.0f + 0.08f * static_cast<float>(band)));
        demand = 1.00f * rarity;
    }

    float priceMult = catMult * (demand / supply);
    if (priceMult < 0.4f) priceMult = 0.4f;
    if (priceMult > 5.0f) priceMult = 5.0f;

    return MarketQuote{supply, demand, priceMult};
}

std::int32_t dynamic_market_buy_price(ItemId id, int floorZ, float gameClockSec,
                                      std::int8_t playerRelation) {
    if (!vendor_stocks_item(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.value <= 0) return 0;

    const MarketQuote quote = market_quote_item(id, floorZ, gameClockSec);
    float mult = kBuyMult * quote.priceMultiplier;

    if (playerRelation > 0) {
        mult -= (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        mult += (static_cast<float>(-playerRelation) * 0.25f / 100.0f);
    }
    if (mult < 0.2f) mult = 0.2f;

    const std::int32_t p = static_cast<std::int32_t>(static_cast<float>(d.value) * mult);
    return p < 1 ? 1 : p;
}

std::int32_t dynamic_market_sell_price(ItemId id, std::uint8_t vendorKind, int floorZ,
                                       float gameClockSec, const RpgStats* rpg,
                                       std::int8_t playerRelation) {
    if (!item_valid(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.value <= 0) return 0;

    const std::size_t vk = vendorKind < static_cast<std::size_t>(VendorKind::Count) ? vendorKind : 0;
    float m = kSellMult[vk];
    const MarketQuote quote = market_quote_item(id, floorZ, gameClockSec);
    m *= quote.priceMultiplier;

    if (playerRelation > 0) {
        m += (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        m -= (static_cast<float>(-playerRelation) * 0.20f / 100.0f);
        if (m < 0.10f) m = 0.10f;
    }
    if (rpg != nullptr && static_cast<ItemCategory>(d.category) == ItemCategory::Note) {
        m *= static_cast<float>(int_document_reward_mult_e3(*rpg)) / 1000.0f;
    }

    // Strict no-arbitrage invariant: sell rate can NEVER exceed buy rate * 0.88
    float buyM = kBuyMult * quote.priceMultiplier;
    if (playerRelation > 0) {
        buyM -= (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        buyM += (static_cast<float>(-playerRelation) * 0.25f / 100.0f);
    }
    const float maxAllowedSellM = buyM * 0.88f;
    if (m > maxAllowedSellM) m = maxAllowedSellM;

    std::int32_t p = static_cast<std::int32_t>(static_cast<float>(d.value) * m);
    if (vendor_stocks_item(id)) {
        const std::int32_t buyP = dynamic_market_buy_price(id, floorZ, gameClockSec, playerRelation);
        if (p >= buyP && buyP > 0) {
            p = buyP - 1;
        }
    }
    return p < 1 ? 0 : p;
}

void vendor_restock_init(VendorRestockState& state, int floorZ, float gameClockSec) {
    state.floorZ = static_cast<std::int16_t>(floorZ);
    state.lastRestockSec = gameClockSec;
    state.restockCycles = 0;
    state.initialized = 1;
    state.itemCount = 0;

    for (std::size_t i = 0; i < kVendorMaxStockedItems; ++i) {
        state.items[i] = VendorStockItem{};
    }

    for (ItemId id = 1; id <= kItemCount; ++id) {
        if (!vendor_stocks_item(id)) continue;
        const ItemDef& d = item_def(id);
        const auto cat = static_cast<ItemCategory>(d.category);

        std::uint16_t cap = d.stackMax;
        if (cat == ItemCategory::Ammo) {
            cap = std::max<std::uint16_t>(cap, 60);
        } else if (cat == ItemCategory::Drink || cat == ItemCategory::Food) {
            cap = std::max<std::uint16_t>(cap, 12);
        } else if (cat == ItemCategory::Medicine) {
            cap = std::max<std::uint16_t>(cap, 6);
        }

        VendorStockItem& entry = state.items[state.itemCount++];
        entry.id = id;
        entry.maxCapacity = cap;
        entry.count = cap;

        if (state.itemCount >= kVendorMaxStockedItems) break;
    }
}

bool vendor_restock_step(VendorRestockState& state, int floorZ, float gameClockSec) {
    if (!state.initialized || state.floorZ != static_cast<std::int16_t>(floorZ)) {
        vendor_restock_init(state, floorZ, gameClockSec);
        return true;
    }
    if (gameClockSec < state.lastRestockSec) {
        state.lastRestockSec = gameClockSec;
        return false;
    }

    const float elapsed = gameClockSec - state.lastRestockSec;
    if (elapsed < kVendorRestockIntervalSec) {
        return false;
    }

    const std::uint32_t cycles = static_cast<std::uint32_t>(elapsed / kVendorRestockIntervalSec);
    state.lastRestockSec += static_cast<float>(cycles) * kVendorRestockIntervalSec;
    state.restockCycles += cycles;

    for (std::uint8_t i = 0; i < state.itemCount; ++i) {
        VendorStockItem& item = state.items[i];
        if (item.id == kInvalidItem || item.maxCapacity == 0) continue;
        const std::uint16_t add = static_cast<std::uint16_t>((item.maxCapacity / 2 + 1) * cycles);
        item.count = std::min<std::uint16_t>(item.maxCapacity, static_cast<std::uint16_t>(item.count + add));
    }
    return true;
}

std::uint16_t vendor_get_item_stock(const VendorRestockState& state, ItemId id) {
    if (!state.initialized || !item_valid(id)) return 0;
    for (std::uint8_t i = 0; i < state.itemCount; ++i) {
        if (state.items[i].id == id) {
            return state.items[i].count;
        }
    }
    return 0;
}

std::uint16_t vendor_consume_item_stock(VendorRestockState& state, ItemId id, std::uint16_t count) {
    if (!state.initialized || !item_valid(id) || count == 0) return 0;
    for (std::uint8_t i = 0; i < state.itemCount; ++i) {
        if (state.items[i].id == id) {
            const std::uint16_t available = state.items[i].count;
            const std::uint16_t consumed = count < available ? count : available;
            state.items[i].count = static_cast<std::uint16_t>(available - consumed);
            return consumed;
        }
    }
    return 0;
}

} // namespace giga::game

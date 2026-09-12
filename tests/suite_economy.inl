// The bank, and the two claims that are easy to assert wrongly.
//
// **Claim 1: nothing mints roubles from nowhere.** The invariant is
// `net_worth = banked + deposit - (loanPrincipal + loanAccrued)`, and every operation in
// [economy.h] except `bank_step` must leave it EXACTLY unchanged. A test that only
// checked "banked went down by the amount deposited" would pass on a bank that silently
// forgot the deposit; a test that only checked the deposit would pass on one that never
// charged the account. Block 3 asserts the identity after every single call in a
// 400-operation deterministic sequence, and separately re-derives the whole session's
// net worth from the reported interest alone.
//
// **Claim 2: a deposit survives death.** It does — and so does `banked`, which is the
// correction this suite is built to make visible rather than to paper over.
// `record_death` ([extraction.h]) charges `at_risk_value(lost)`, the value of the dead
// row's INVENTORY, and touches no rouble field. So block 4 asserts what is actually
// true: the carried ITEMS are what a death takes, the deposit and `banked` both survive
// intact, and the genuinely new loss channel is the **debt**, which survives death as
// well and therefore turns a bad run into a liability rather than a zero. Asserting
// "cash is lost, the deposit is not" would require inventing a cash field, and
// vendor.cpp's own comment explains why that is refused: "there is no cash/account
// split here and inventing one would give value two homes".
//
// Everything printed here is measured by running the real integer path — no formula is
// re-derived in the test, because a formula duplicated into a test is a formula that
// agrees with itself and not with the shipped code.
//
// This is a .inl and not a .cpp for the reason suite_packs.inl states: game_test.cpp
// owns the CHECK macro, so the include has to land after it, and the suite carries its
// own includes of the systems under test to keep that diff two lines.
//
// ASCII only in every fprintf, deliberately: the band and wealth-tier names in
// data/economy.csv are Cyrillic and this host's console is CP1251, so printing a name
// would emit mojibake that reads as corruption. The names are asserted non-empty and
// distinct instead, which is the property that matters, and their BYTES are checked.
//
// WIRED: tests/game_test.cpp includes this file beside suite_craft.inl and calls
// `test_economy_all()` from its main, so every assertion below runs inside the shipped
// game_test binary. The source-rules `unwired-suite` exemption this file carried while it
// was waiting for that wire-up is GONE, deleted by the same edit — which is exactly what
// the escape hatch in tools/check_source_rules.cmake asks for. Do not re-add it.
//
// NOTE FOR THE BUILD OWNER: game_test's ctest pass regex pins an exact CHECK total
// (CMakeLists.txt, `game_test: N checks, 0 failures`). This suite contributes 65,850
// checks, so that pin has to move in the same commit or ctest goes red with no way to
// tell it from a real regression.

#include <cstdio>
#include <cstring>

#include "core/rng.h"
#include "core/tick.h"
#include "game/economy.h"
#include "game/extraction.h"
#include "game/item_table.h"
#include "game/loot.h"

namespace economy_detail {

// FNV-1a over every meaningful field of an account, in a fixed order. Not a memcmp:
// `BankAccount` carries padding, and hashing padding would make this assert something
// about the compiler rather than about the bank. Same discipline as suite_macrosim's
// per-column digest.
inline std::uint64_t digest(const BankAccount& a) {
    std::uint64_t h = 1469598103934665603ull;
    auto fold = [&h](std::uint64_t v) {
        for (int i = 0; i < 8; ++i) {
            h ^= static_cast<std::uint64_t>((v >> (i * 8)) & 0xFFull);
            h *= 1099511628211ull;
        }
    };
    fold(static_cast<std::uint64_t>(a.deposit));
    fold(static_cast<std::uint64_t>(a.loanPrincipal));
    fold(static_cast<std::uint64_t>(a.loanAccrued));
    fold(static_cast<std::uint64_t>(a.interestEarned));
    fold(static_cast<std::uint64_t>(a.interestPaid));
    fold(a.lastInterestTick);
    fold(static_cast<std::uint64_t>(static_cast<std::uint32_t>(a.creditLimit)));
    fold(a.band);
    return h;
}

// A cheap item and a dear one, resolved from the shipped table rather than hardcoded, so
// the death block cannot drift when data/items.csv is retuned.
inline ItemId item_priced_near(std::int32_t want) {
    ItemId best = kInvalidItem;
    std::int32_t bestErr = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        const std::int32_t v = item_def(id).value;
        if (v <= 0) continue;
        const std::int32_t err = v > want ? v - want : want - v;
        if (best == kInvalidItem || err < bestErr) { best = id; bestErr = err; }
    }
    return best;
}

// Advance a fresh account's clock by `periods` interest periods, one call per period, and
// return what was settled in total. One call per period is the shape the app uses (a
// bank_step every sim tick), so this is the path that actually ships.
struct Settled { std::int64_t earned = 0; std::int64_t paid = 0; std::uint32_t calls = 0; };
inline Settled run_periods(BankAccount& acct, std::uint32_t periods,
                           std::uint64_t startTick) {
    Settled s{};
    for (std::uint32_t i = 1; i <= periods; ++i) {
        const BankTick bt = bank_step(acct, startTick + static_cast<std::uint64_t>(i) *
                                                           kBankPeriodTicks);
        s.earned += bt.earned;
        s.paid += bt.paid;
        if (bt.periods != 0) ++s.calls;
    }
    return s;
}

} // namespace economy_detail

static void test_economy_all() {
    using namespace economy_detail;

    { // ---- 0. the teller: banked <-> coins, clamped by physics ----
        // [economy.h] teller verbs — the C increment's whole surface. Deposit
        // sweeps every coin; withdraw mints back, clamped by the account AND by
        // what the bag accepts, remainder staying banked (never on the floor).
        Inventory inv{};
        RunLedger led{};
        CHECK(inventory_give(inv, kItemRuble, 65535) == 0);
        CHECK(inventory_give(inv, kItemRuble, 465) == 0);   // second stack
        CHECK(teller_deposit_cash(inv, led) == 66000);
        CHECK(led.banked == 66000);
        CHECK(inv.empty());
        // Depositing an empty bag is a zero, not an error.
        CHECK(teller_deposit_cash(inv, led) == 0);

        // Withdraw a slice; the account shrinks by exactly what LANDED.
        CHECK(teller_withdraw_cash(inv, led, 1000) == 1000);
        CHECK(led.banked == 65000);
        std::int64_t cash = 0;
        for (const ItemSlot& sl : inv.slots)
            if (sl.item == kItemRuble) cash += sl.count;
        CHECK(cash == 1000);
        // Asking past the account clamps to it...
        CHECK(teller_withdraw_cash(inv, led, 90000) == 65000);
        CHECK(led.banked == 0);
        // ...and a FULL bag under-withdraws, coins staying banked, none minted
        // into the void.
        led.banked = 500;
        Inventory full{};
        ItemId one = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i)
            if (i != kItemRuble && item_def(i).stackMax == 1) { one = i; break; }
        CHECK(one != kInvalidItem);
        for (int i = 0; i < kInvSlots; ++i) full.slots[i] = ItemSlot{one, 1};
        CHECK(teller_withdraw_cash(full, led, 500) == 0);
        CHECK(led.banked == 500);
        std::fprintf(stderr,
                     "[economy] teller: 66,000 in two stacks banked whole; "
                     "withdraw clamps to account and to bag space\n");
    }

    { // ---- 1. every authored row resolves, and agrees with the rest of the tree ----
        // The CSV is one of two homes for three of these numbers; the generator
        // cross-checks at build time and this re-checks at run time, because a
        // hand-edited economy_table.cpp would pass the generator by never running it.
        // `static_assert` and not CHECK for the purely compile-time facts: MSVC /W4
        // emits C4127 (conditional expression is constant) for a CHECK on a constant,
        // and "zero warnings" is a hard rule (AGENTS.md SSBuild). A static_assert is also
        // the stronger statement — it cannot be reached-and-skipped.
        static_assert(kEconomyRows == 5);
        static_assert(kEconomyRows == kEconomyBands);
        CHECK(kBankTerms.size() == kEconomyBands);
        CHECK(kBandNames.size() == kEconomyBands);

        for (std::size_t b = 0; b < kEconomyBands; ++b) {
            const BankTerms& t = kBankTerms[b];
            // The one column with a second consumer in the tree.
            CHECK(t.lootCap == kLootValueCap[b]);
            CHECK(t.cashCap > 0);
            CHECK(t.questCap > 0);
            CHECK(t.questRate > 0);
            CHECK(t.creditLimit > 0);
            // THE money-press guard. A bank paying at least what it charges lets the
            // player borrow at the limit, deposit the proceeds and grow with no
            // expedition at all.
            CHECK(t.depositBp < t.loanBp);
            CHECK(t.floorLo <= t.floorHi);
            CHECK(kBandNames[b] != nullptr);
            CHECK(std::strlen(kBandNames[b]) > 0);
            // Cyrillic, so the name is real content rather than a placeholder id. Byte
            // count, never a text search: this host's grep reports zero Cyrillic in
            // files that measurably hold thousands of lead bytes (AGENTS.md SSBuild).
            std::size_t lead = 0;
            for (const char* p = kBandNames[b]; *p; ++p)
                if (static_cast<unsigned char>(*p) == 0xD0u ||
                    static_cast<unsigned char>(*p) == 0xD1u) ++lead;
            CHECK(lead > 0);
            if (b > 0) {
                // Monotone in every reference column, and the authored gradient in the
                // two rate columns: deeper is a worse bank, both ways.
                CHECK(kBankTerms[b].cashCap > kBankTerms[b - 1].cashCap);
                CHECK(kBankTerms[b].questCap > kBankTerms[b - 1].questCap);
                CHECK(kBankTerms[b].questRate > kBankTerms[b - 1].questRate);
                CHECK(kBankTerms[b].creditLimit > kBankTerms[b - 1].creditLimit);
                CHECK(kBankTerms[b].depositBp <= kBankTerms[b - 1].depositBp);
                CHECK(kBankTerms[b].loanBp >= kBankTerms[b - 1].loanBp);
                CHECK(kBankTerms[b].floorLo == kBankTerms[b - 1].floorHi + 1);
            }
        }
        CHECK(kBankTerms[0].floorLo == 0);
        CHECK(kBankTerms[kEconomyBands - 1].floorHi == 127);
        // The reference's own two constants, verbatim.
        CHECK(kBankTerms[0].creditLimit == 500);          // BANKING_DEFAULT_CREDIT_LIMIT
        CHECK(kBankTerms[0].loanBp * 2 == kBankTerms[0].depositBp * 3);  // 0.015 / 0.010
        static_assert(kBankMaxCatchupPeriods == 24u);     // BANKING_MAX_INTEREST_PERIODS
        // The reference's ECONOMY_MONEY_BANDS columns, verbatim.
        const std::int32_t refCash[5] = {250, 2000, 25000, 250000, 5000000};
        const std::int32_t refQuest[5] = {250, 800, 8000, 45000, 250000};
        const std::int32_t refRate[5] = {35, 70, 160, 420, 1200};
        for (std::size_t b = 0; b < kEconomyBands; ++b) {
            CHECK(kBankTerms[b].cashCap == refCash[b]);
            CHECK(kBankTerms[b].questCap == refQuest[b]);
            CHECK(kBankTerms[b].questRate == refRate[b]);
        }

        // Every floor in the stack lands in the band the CSV says it does. This is the
        // check that would fail if `economy_band()` were ever retuned without the CSV.
        int mismatches = 0;
        for (int z = -127; z <= 127; ++z) {
            const std::uint8_t band = economy_band(z);
            CHECK(band < kEconomyBands);
            const int a = z < 0 ? -z : z;
            const BankTerms& t = bank_terms(band);
            if (a < t.floorLo || a > t.floorHi) ++mismatches;
        }
        CHECK(mismatches == 0);

        // Out-of-range indices clamp instead of reading past the array. Both accessors
        // are dereferenced immediately by their callers.
        CHECK(&bank_terms(200) == &kBankTerms[kEconomyBands - 1]);
        CHECK(band_name(200) == kBandNames[kEconomyBands - 1]);

        std::fprintf(stderr,
                     "[economy] %zu bands resolve; bands E0..E4 "
                     "deposit %u/%u/%u/%u/%u bp, loan %u/%u/%u/%u/%u bp, credit "
                     "%d/%d/%d/%d/%d rub\n",
                     static_cast<std::size_t>(kEconomyBands),
                     kBankTerms[0].depositBp, kBankTerms[1].depositBp,
                     kBankTerms[2].depositBp, kBankTerms[3].depositBp,
                     kBankTerms[4].depositBp,
                     kBankTerms[0].loanBp, kBankTerms[1].loanBp, kBankTerms[2].loanBp,
                     kBankTerms[3].loanBp, kBankTerms[4].loanBp,
                     kBankTerms[0].creditLimit, kBankTerms[1].creditLimit,
                     kBankTerms[2].creditLimit, kBankTerms[3].creditLimit,
                     kBankTerms[4].creditLimit);
    }

    { // ---- 2. the branch is a pure function of (seed, floor) --------------------
        // The one place the bank reads a seed. Stable for a session so the player can
        // learn it; never a per-tick wobble, which would be farmable by waiting.
        BankAccount a{}, b{}, c{};
        bank_open(a, 0, 12345u);
        bank_open(b, 0, 12345u);
        bank_open(c, 0, 999u);
        CHECK(a.creditLimit == b.creditLimit);
        CHECK(a.band == 0);
        CHECK(digest(a) == digest(b));

        // Range, over every floor and a spread of seeds: the jitter is +-20% and must
        // never leave that window, nor produce a zero limit (a zero limit is
        // indistinguishable from "no branch opened").
        std::int32_t lo = 0, hi = 0;
        bool first = true;
        int differing = 0;
        for (std::uint32_t seed = 1; seed <= 64u; ++seed) {
            for (int z = -127; z <= 127; ++z) {
                BankAccount t{};
                bank_open(t, z, seed);
                const BankTerms& bt = bank_terms(t.band);
                const std::int32_t base = bt.creditLimit;
                CHECK(t.creditLimit >= base * 8 / 10);
                CHECK(t.creditLimit <= base * 12 / 10);
                CHECK(t.creditLimit > 0);
                CHECK(t.band == economy_band(z));
                if (first) { lo = hi = t.creditLimit; first = false; }
                if (t.creditLimit < lo) lo = t.creditLimit;
                if (t.creditLimit > hi) hi = t.creditLimit;
            }
            // +z and -z are different branches, which is the point of a bidirectional
            // stack. Counted rather than asserted per pair: a hash can legitimately
            // collide, so the claim is that the two sides mostly differ.
            for (int z = 1; z <= 127; ++z) {
                BankAccount up{}, down{};
                bank_open(up, z, seed);
                bank_open(down, -z, seed);
                if (up.creditLimit != down.creditLimit) ++differing;
            }
        }
        CHECK(differing > 64 * 127 * 8 / 10);   // the vast majority differ
        std::fprintf(stderr,
                     "[economy] branch credit limits over 64 seeds x 255 floors: "
                     "%d..%d rub, %d of %d +z/-z pairs differ\n",
                     lo, hi, differing, 64 * 127);

        // No branch opened means no loan. A default-constructed account must not lend.
        BankAccount fresh{};
        RunLedger led{};
        led.banked = 100000;
        CHECK(bank_credit_available(fresh) == 0);
        CHECK(bank_borrow_max(fresh, led, 0) == 0);
        CHECK(led.banked == 100000);
    }

    { // ---- 3. MONEY CONSERVES: net worth moves only by reported interest --------
        BankAccount acct{};
        RunLedger led{};
        bank_open(acct, /*floorZ=*/-30, /*seed=*/0xBEEFu);   // E3: a real credit line
        led.banked = 400000;

        const std::int64_t start = net_worth(led, acct);
        CHECK(start == 400000);

        std::int64_t interestNet = 0;      // everything bank_step reported
        std::int64_t prev = start;
        std::uint64_t tick = 0;
        std::uint32_t deposits = 0, withdrawals = 0, loans = 0, repays = 0;
        std::int64_t moved = 0;
        int violations = 0;

        for (std::uint32_t op = 0; op < 400u; ++op) {
            // Deterministic op stream, no stored RNG — the same stateless hashing the
            // macro tick uses, so this sequence is reproducible in block 5.
            const std::uint32_t h = hash3(0x1234u, op, 7u);
            const std::uint32_t which = h % 5u;
            const std::int32_t amount =
                static_cast<std::int32_t>(1 + (hash2(h, 11u) % 90000u));

            // Advance the clock by a fraction of a period most steps and a whole one
            // sometimes, so interest lands mid-sequence rather than only at the end.
            tick += 1u + static_cast<std::uint64_t>(hash2(h, 13u) % 4000u);
            const BankTick bt = bank_step(acct, tick);
            interestNet += static_cast<std::int64_t>(bt.earned) -
                           static_cast<std::int64_t>(bt.paid);
            if (net_worth(led, acct) != prev + bt.earned - bt.paid) ++violations;
            prev = net_worth(led, acct);

            std::int64_t before = prev;
            std::int32_t did = 0;
            switch (which) {
                case 0: did = bank_deposit(acct, led, amount, tick); ++deposits; break;
                case 1: did = bank_withdraw(acct, led, amount, tick); ++withdrawals; break;
                case 2: did = bank_take_loan(acct, led, amount, tick); ++loans; break;
                case 3: did = bank_repay(acct, led, amount, tick); ++repays; break;
                default:
                    // The one-keypress forms go through the same arithmetic and are
                    // exercised here so they cannot diverge from it.
                    if ((h & 0x100u) != 0u) did = bank_deposit_all(acct, led, tick);
                    else did = bank_withdraw_all(acct, led, tick);
                    ++deposits;
                    break;
            }
            moved += did;
            // THE INVARIANT. A transfer changes nothing.
            if (net_worth(led, acct) != before) ++violations;
            prev = net_worth(led, acct);

            // No field ever goes negative, and the credit line is never exceeded.
            if (led.banked < 0 || acct.deposit < 0 || acct.loanPrincipal < 0 ||
                acct.loanAccrued < 0)
                ++violations;
            if (bank_debt(acct) > acct.creditLimit + acct.interestPaid) ++violations;
        }
        CHECK(violations == 0);
        CHECK(deposits > 0u && withdrawals > 0u && loans > 0u && repays > 0u);
        CHECK(net_worth(led, acct) == start + interestNet);
        // Independently: net worth is exactly the start plus lifetime interest earned
        // minus lifetime interest charged. Re-derived from the ACCOUNT's own counters
        // rather than from the per-call reports, so the two have to agree.
        CHECK(net_worth(led, acct) ==
              start + acct.interestEarned - acct.interestPaid);
        CHECK(acct.interestEarned - acct.interestPaid == interestNet);
        std::fprintf(stderr,
                     "[economy] 400 ops on E3: %u deposits / %u withdrawals / %u loans "
                     "/ %u repays moved %lld rub; net worth %lld -> %lld, interest "
                     "+%lld / -%lld, 0 conservation violations\n",
                     deposits, withdrawals, loans, repays,
                     static_cast<long long>(moved), static_cast<long long>(start),
                     static_cast<long long>(net_worth(led, acct)),
                     static_cast<long long>(acct.interestEarned),
                     static_cast<long long>(acct.interestPaid));

    }

    { // ---- 4. DEATH: what it takes and what it does not ------------------------
        // The honest version of "a deposit survives death". It does; so does `banked`;
        // the carried ITEMS do not; and the debt outlives the body.
        BankAccount acct{};
        RunLedger led{};
        bank_open(acct, 0, 4242u);
        led.banked = 20000;
        CHECK(bank_deposit(acct, led, 12000, 100u) == 12000);
        const std::int32_t lent = bank_take_loan(acct, led, 400, 100u);
        CHECK(lent > 0);

        // A bag with real loot in it, priced from the shipped table.
        Inventory bag{};
        const ItemId cheap = item_priced_near(20);
        const ItemId dear = item_priced_near(3000);
        CHECK(item_valid(cheap));
        CHECK(item_valid(dear));
        bag.slots[0] = ItemSlot{cheap, 5};
        bag.slots[1] = ItemSlot{dear, 1};
        const std::int32_t carried = at_risk_value(bag);
        CHECK(carried > 0);
        CHECK(carried == inventory_value(bag));

        const std::int64_t bankedBefore = led.banked;
        const std::int64_t depositBefore = acct.deposit;
        const std::int64_t debtBefore = bank_debt(acct);
        const std::int64_t worthBefore = net_worth(led, acct);

        record_death(led, bag);

        CHECK(led.deaths == 1u);
        CHECK(led.lostToDeath == carried);
        // Nothing monetary moved. This is the correction: `banked` is already permanent,
        // so the deposit's advantage over it is YIELD, not safety.
        CHECK(led.banked == bankedBefore);
        CHECK(acct.deposit == depositBefore);
        CHECK(bank_debt(acct) == debtBefore);
        CHECK(net_worth(led, acct) == worthBefore);
        // And the debt is still owed by the next body, which is the new loss channel.
        CHECK(bank_debt(acct) > 0);
        CHECK(bank_credit_available(acct) < acct.creditLimit);

        // Interest keeps accruing on a debt held through a death, so a run that died
        // owing money is strictly worse off over time than one that did not — and the
        // deposit keeps EARNING through it, which is the other half of the same fact:
        // the account does not notice that the body died, because it is not body state.
        const std::int64_t debtAtDeath = bank_debt(acct);
        const Settled through = run_periods(acct, 10u, 100u);
        CHECK(bank_debt(acct) > debtAtDeath);
        CHECK(through.earned > 0);
        CHECK(acct.deposit > depositBefore);
        std::fprintf(stderr,
                     "[economy] death took %d rub of carried items (%u slots); banked "
                     "%lld and deposit %lld both survived; debt %lld -> %lld over 10 "
                     "periods\n",
                     carried, 2u, static_cast<long long>(led.banked),
                     static_cast<long long>(acct.deposit),
                     static_cast<long long>(debtAtDeath),
                     static_cast<long long>(bank_debt(acct)));

        // A death does NOT clear the deposit's spendability either: withdrawing still
        // works afterwards, which is what makes the deposit a real place to keep money
        // rather than a one-way sink. `depositBefore` plus its interest, not
        // `depositBefore` — the first version of this assertion read the deposit as
        // frozen at the moment of death and failed by exactly the 70 roubles it had
        // earned in the meantime.
        const std::int64_t depositNow = acct.deposit;
        const std::int32_t back = bank_withdraw_all(acct, led, 200u);
        CHECK(back == depositNow);
        CHECK(back > depositBefore);
        CHECK(acct.deposit == 0);
        CHECK(led.banked == bankedBefore + depositNow);
    }

    { // ---- 5. DETERMINISM: the same inputs give a bit-identical account ---------
        // Replayed twice, digested field by field. This is the property a per-tick
        // allocation or an iteration-order dependency would break.
        std::uint64_t d[2] = {0, 0};
        std::int64_t w[2] = {0, 0};
        for (int run = 0; run < 2; ++run) {
            BankAccount acct{};
            RunLedger led{};
            bank_open(acct, -30, 0xBEEFu);
            led.banked = 400000;
            std::uint64_t tick = 0;
            for (std::uint32_t op = 0; op < 400u; ++op) {
                const std::uint32_t h = hash3(0x1234u, op, 7u);
                const std::int32_t amount =
                    static_cast<std::int32_t>(1 + (hash2(h, 11u) % 90000u));
                tick += 1u + static_cast<std::uint64_t>(hash2(h, 13u) % 4000u);
                bank_step(acct, tick);
                switch (h % 5u) {
                    case 0: bank_deposit(acct, led, amount, tick); break;
                    case 1: bank_withdraw(acct, led, amount, tick); break;
                    case 2: bank_take_loan(acct, led, amount, tick); break;
                    case 3: bank_repay(acct, led, amount, tick); break;
                    default:
                        if ((h & 0x100u) != 0u) bank_deposit_all(acct, led, tick);
                        else bank_withdraw_all(acct, led, tick);
                        break;
                }
            }
            d[run] = digest(acct);
            w[run] = net_worth(led, acct);
        }
        CHECK(d[0] == d[1]);
        CHECK(w[0] == w[1]);
        std::fprintf(stderr,
                     "[economy] replay digest 0x%016llx twice, net worth %lld both "
                     "times\n",
                     static_cast<unsigned long long>(d[0]),
                     static_cast<long long>(w[0]));

        // The clock's SHAPE must not matter either: 24 periods settled in one call and
        // 24 settled one at a time have to land on the same rouble, or the account's
        // value would depend on frame timing.
        BankAccount chunky{}, fine{};
        RunLedger l1{}, l2{};
        bank_open(chunky, 0, 1u);
        bank_open(fine, 0, 1u);
        l1.banked = l2.banked = 1000000;
        CHECK(bank_deposit(chunky, l1, 1000000, 0u) == 1000000);
        CHECK(bank_deposit(fine, l2, 1000000, 0u) == 1000000);
        CHECK(bank_take_loan(chunky, l1, 300, 0u) == bank_take_loan(fine, l2, 300, 0u));
        const BankTick oneShot = bank_step(chunky, 24ull * kBankPeriodTicks);
        CHECK(oneShot.periods == 24u);
        const Settled spread = run_periods(fine, 24u, 0u);
        CHECK(spread.calls == 24u);
        CHECK(chunky.deposit == fine.deposit);
        CHECK(chunky.loanAccrued == fine.loanAccrued);
        CHECK(static_cast<std::int64_t>(oneShot.earned) == spread.earned);
        CHECK(static_cast<std::int64_t>(oneShot.paid) == spread.paid);
        CHECK(chunky.lastInterestTick == fine.lastInterestTick);
        std::fprintf(stderr,
                     "[economy] 24 periods in 1 call == 24 calls: deposit %lld, earned "
                     "%lld, loan interest %lld\n",
                     static_cast<long long>(chunky.deposit),
                     static_cast<long long>(spread.earned),
                     static_cast<long long>(spread.paid));

        // The catch-up cap bounds one CALL, not the total: a 100-period gap is settled
        // 24 at a time and loses no time.
        BankAccount gap{};
        RunLedger l3{};
        bank_open(gap, 0, 1u);
        l3.banked = 1000000;
        bank_deposit(gap, l3, 1000000, 0u);
        std::uint32_t settled = 0;
        for (int i = 0; i < 8; ++i) settled += bank_step(gap, 100ull * kBankPeriodTicks).periods;
        CHECK(settled == 100u);
        CHECK(gap.lastInterestTick == 100ull * kBankPeriodTicks);
    }

    { // ---- 6. the interest arithmetic, at the boundaries that bite -------------
        // The integer dead zone, exactly where economy.h says it is: at 6 bp a deposit
        // under 10000/6 = 1666.67 rub earns nothing, forever.
        CHECK(kBankTerms[0].depositBp == 6);
        for (std::int32_t principal : {1666, 1667}) {
            BankAccount acct{};
            RunLedger led{};
            bank_open(acct, 0, 5u);
            led.banked = principal;
            CHECK(bank_deposit(acct, led, principal, 0u) == principal);
            const Settled s = run_periods(acct, 60u, 0u);
            if (principal == 1666) {
                CHECK(s.earned == 0);
                CHECK(acct.deposit == 1666);
                CHECK(acct.interestEarned == 0);
            } else {
                CHECK(s.earned == 60);          // 1 rub a period, 60 periods
                CHECK(acct.deposit == 1727);
            }
        }

        // Loan interest rounds UP, so no debt is ever free. This is the hole that
        // truncation would leave wide open: 500 * 9 / 10000 == 0.
        CHECK(kBankTerms[0].loanBp == 9);
        static_assert(500 * 9 / 10000 == 0);    // what rounding DOWN would charge
        for (std::int32_t owed : {1, 5, 100, 400}) {
            BankAccount acct{};
            RunLedger led{};
            bank_open(acct, 0, 6u);
            acct.creditLimit = 100000;          // so the small loans all fit
            CHECK(bank_take_loan(acct, led, owed, 0u) == owed);
            const Settled s = run_periods(acct, 1u, 0u);
            CHECK(s.paid == 1);                 // at least one rouble, always
            CHECK(bank_debt(acct) == owed + 1);
        }

        // Repayment clears accrued interest before principal, and only principal
        // accrues — so the order is not cosmetic.
        BankAccount acct{};
        RunLedger led{};
        bank_open(acct, -30, 7u);               // E3, 30 bp
        acct.creditLimit = 20000;
        led.banked = 50000;
        CHECK(bank_take_loan(acct, led, 20000, 0u) == 20000);
        const Settled s = run_periods(acct, 5u, 0u);
        CHECK(s.paid > 0);
        CHECK(acct.loanAccrued == s.paid);
        const std::int64_t accruedWas = acct.loanAccrued;
        const std::int32_t part = static_cast<std::int32_t>(accruedWas) - 1;
        CHECK(part > 0);
        CHECK(bank_repay(acct, led, part, 999u) == part);
        CHECK(acct.loanAccrued == 1);           // interest first...
        CHECK(acct.loanPrincipal == 20000);     // ...principal untouched
        CHECK(bank_repay_all(acct, led, 1000u) == 20001);
        CHECK(bank_debt(acct) == 0);
        CHECK(bank_credit_available(acct) == acct.creditLimit);
        // A fully repaid account stops accruing.
        const Settled quiet = run_periods(acct, 10u, 1000u);
        CHECK(quiet.paid == 0);
        CHECK(quiet.earned == 0);

        // An idle account does not bank up periods to collect the instant money lands.
        BankAccount idle{};
        RunLedger l4{};
        bank_open(idle, 0, 8u);
        l4.banked = 1000000;
        run_periods(idle, 200u, 0u);            // 200 periods with nothing on deposit
        const std::uint64_t depositAt = 200ull * kBankPeriodTicks + 1ull;
        CHECK(bank_deposit(idle, l4, 1000000, depositAt) == 1000000);
        const BankTick immediately = bank_step(idle, depositAt + 1ull);
        CHECK(immediately.earned == 0);
        CHECK(immediately.periods == 0u);

        // A clock that went backwards (a load) re-anchors instead of settling a
        // negative span.
        const std::uint64_t was = idle.lastInterestTick;
        CHECK(was > 0ull);
        const BankTick back = bank_step(idle, 5ull);
        CHECK(back.earned == 0);
        CHECK(back.paid == 0);
        CHECK(idle.lastInterestTick == 5ull);
    }

    { // ---- 7. MEASURED: what a period is worth, and vs the expedition ----------
        // The numbers economy.h quotes, produced by the shipped path so the doc cannot
        // drift away from the code.
        const std::int64_t kFloor0Clear = 7364;    // [loot.h]: 5,647 kills + 1,717 crates
        const std::int64_t kFloorM13Clear = 462171;

        std::int64_t hourly[kEconomyBands] = {};
        for (std::size_t b = 0; b < kEconomyBands; ++b) {
            BankAccount acct{};
            RunLedger led{};
            acct.band = static_cast<std::uint8_t>(b);
            acct.creditLimit = kBankTerms[b].creditLimit;
            led.banked = 250000;
            CHECK(bank_deposit(acct, led, 250000, 0u) == 250000);
            hourly[b] = run_periods(acct, 60u, 0u).earned;
            CHECK(hourly[b] >= 0);
            if (b > 0) CHECK(hourly[b] <= hourly[b - 1]);
        }
        // The load-bearing balance claim, as an assertion rather than as prose: an hour
        // of passive yield on the E3 liquid-cash ceiling must not beat two clears of the
        // safest floor in the game.
        CHECK(hourly[0] < 2 * kFloor0Clear);
        CHECK(hourly[0] * 50 < kFloorM13Clear);
        std::fprintf(stderr,
                     "[economy] 250,000 rub on deposit for 1 real hour earns "
                     "%lld/%lld/%lld/%lld/%lld rub at E0..E4; a floor-0 clear is %lld "
                     "and floor -13 is %lld ([loot.h])\n",
                     static_cast<long long>(hourly[0]), static_cast<long long>(hourly[1]),
                     static_cast<long long>(hourly[2]), static_cast<long long>(hourly[3]),
                     static_cast<long long>(hourly[4]),
                     static_cast<long long>(kFloor0Clear),
                     static_cast<long long>(kFloorM13Clear));

        // Doubling time, measured. The balance doc's bar is "no reliable doubling of the
        // account in under 30 real minutes"; 30 minutes is 30 periods.
        BankAccount acct{};
        RunLedger led{};
        acct.band = 0;
        led.banked = 1000000;
        CHECK(bank_deposit(acct, led, 1000000, 0u) == 1000000);
        std::uint32_t periods = 0;
        std::uint64_t tick = 0;
        while (acct.deposit < 2000000 && periods < 5000u) {
            tick += kBankPeriodTicks;
            bank_step(acct, tick);
            ++periods;
        }
        CHECK(periods == 1157u);                 // 19.3 real hours
        CHECK(periods > 30u * 38u);              // 38x the balance doc's bar
        std::fprintf(stderr,
                     "[economy] E0 doubling: 1,000,000 -> %lld in %u periods = %.1f "
                     "real hours (balance.md bar: no doubling under 30 min)\n",
                     static_cast<long long>(acct.deposit), periods,
                     static_cast<double>(periods) / 60.0);

        // What a loan actually costs, per band, on that band's own credit limit — the
        // punitive-with-depth gradient, in roubles per hour.
        std::int64_t cost[kEconomyBands] = {};
        for (std::size_t b = 0; b < kEconomyBands; ++b) {
            BankAccount la{};
            RunLedger ll{};
            la.band = static_cast<std::uint8_t>(b);
            la.creditLimit = kBankTerms[b].creditLimit;
            CHECK(bank_borrow_max(la, ll, 0u) == kBankTerms[b].creditLimit);
            CHECK(ll.banked == kBankTerms[b].creditLimit);
            cost[b] = run_periods(la, 60u, 0u).paid;
            CHECK(cost[b] > 0);
        }
        std::fprintf(stderr,
                     "[economy] a maxed loan costs %lld/%lld/%lld/%lld/%lld rub per real "
                     "hour at E0..E4 on limits %d/%d/%d/%d/%d\n",
                     static_cast<long long>(cost[0]), static_cast<long long>(cost[1]),
                     static_cast<long long>(cost[2]), static_cast<long long>(cost[3]),
                     static_cast<long long>(cost[4]),
                     kBankTerms[0].creditLimit, kBankTerms[1].creditLimit,
                     kBankTerms[2].creditLimit, kBankTerms[3].creditLimit,
                     kBankTerms[4].creditLimit);
    }

    { // ---- 8. the deposit is genuinely LESS liquid, which is its whole cost ----
        // Deposited money is not in `banked` — it can neither be extracted with
        // nor (come increment C, the banker) be withdrawn into rubles without a
        // trip. Asserted on the numbers themselves: the balance really moves
        // OUT of the liquid pocket and only a withdraw brings it back. (This
        // used to be proven through vendor_resupply, which died with the pad
        // shop — [conversation.md]; the property is the ledger's, not a shop's.)
        BankAccount acct{};
        RunLedger led{};
        bank_open(acct, 0, 31u);
        led.banked = 5000;
        CHECK(bank_deposit_all(acct, led, 0u) == 5000);
        CHECK(led.banked == 0);                 // the liquid pocket is EMPTY
        CHECK(acct.deposit == 5000);
        CHECK(net_worth(led, acct) == 5000);    // the worth did not vanish
        // Withdraw and the same 600 is spendable again. One keypress apart.
        CHECK(bank_withdraw(acct, led, 600, 1u) == 600);
        CHECK(led.banked == 600);
        std::fprintf(stderr,
                     "[economy] 5,000 rub on deposit leaves banked at 0; a 600 "
                     "withdraw restores exactly 600 liquid\n");

        // The overflow guard, and it reports a partial like vendor_buy does.
        BankAccount big{};
        RunLedger rich{};
        rich.banked = kBankMaxPrincipal + 1000ll;
        big.deposit = kBankMaxPrincipal - 100ll;
        CHECK(bank_deposit(big, rich, 500, 0u) == 100);
        CHECK(big.deposit == kBankMaxPrincipal);
        CHECK(bank_deposit(big, rich, 500, 0u) == 0);

        // Zero and negative amounts are no-ops on every entry point, not silent
        // transfers with a sign flip.
        BankAccount z{};
        RunLedger zl{};
        bank_open(z, 0, 2u);
        zl.banked = 1000;
        CHECK(bank_deposit(z, zl, 0, 0u) == 0);
        CHECK(bank_deposit(z, zl, -50, 0u) == 0);
        CHECK(bank_withdraw(z, zl, -50, 0u) == 0);
        CHECK(bank_take_loan(z, zl, -50, 0u) == 0);
        CHECK(bank_repay(z, zl, -50, 0u) == 0);
        CHECK(zl.banked == 1000);
        CHECK(net_worth(zl, z) == 1000);

        // Withdrawing or repaying more than exists takes what exists and no more.
        CHECK(bank_deposit(z, zl, 400, 0u) == 400);
        CHECK(bank_withdraw(z, zl, 999999, 1u) == 400);
        CHECK(z.deposit == 0);
        CHECK(zl.banked == 1000);
        CHECK(bank_repay(z, zl, 999999, 2u) == 0);   // no debt to repay
        CHECK(zl.banked == 1000);
    }
}

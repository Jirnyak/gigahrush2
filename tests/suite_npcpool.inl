// NpcPool tests — the signed floor label and the column allocation policy. Included
// into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga::game`.
//
// Two things are being pinned, and they are pinned for opposite reasons.
//
// 1. THE FLOOR LABEL IS SIGNED. The building descends: main.cpp's demo stack is
//    {0, 1, 2, -8, -14, -26, -36, -50, 14, 30} and FloorRegistry's legal range is
//    -127..+127. The column was std::uint16_t and floor_stream.cpp cast the module
//    number into it, so every floor below the hub was stored as 65486/65500/65510/
//    65522/65528. Nothing in src/ read pool.floor() back, which is the ONLY reason
//    this never showed up — master_prompt #10 replaces FloorStreamer's fixed
//    [firstId, count) roster with a per-floor bucket index over pool.floor(id), and
//    that reader would have inherited the corruption. A wrap bug with no reader is
//    still a wrap bug; this file gives it the reader.
//
// 2. THE ALLOCATION CHANGE MOVED NO BOOKKEEPING. init() no longer writes 187 B/row of
//    columns nothing reads, so 7 of the 18 SoA columns are now grown lazily. The
//    failure mode that would follow is not a crash — it is a resize that silently
//    drops or shifts rows while count()/alive() keep reporting the right totals. So
//    the checks below deliberately measure the same quantities before and after the
//    lazy columns are touched, and re-read 5,000 records across a growth boundary.
//
// This is a .inl and not a .cpp on purpose: game_test.cpp owns the CHECK macro and the
// counters, so the include has to land AFTER that macro rather than up among the
// ordinary includes.

#include <chrono>
#include <cstdio>
#include <cstring>
#include <vector>

#include "ecs/registry.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/macro_sim.h"   // the wall block below drives the REAL demographic tick
#include "game/npc_pool.h"
#include "game/population.h"
#include "world/level_stack.h"

static void test_npcpool_all() {
    { // ---- the signed floor column round-trips the whole legal range ----
        // The old column was std::uint16_t, so floor -50 was stored as 65536 - 50 =
        // 65486, -36 as 65500, -14 as 65522 and -8 as 65528. FloorRegistry's whole
        // legal range is checked below, not just those four, because the demo stack is
        // data and the next stack will pick different numbers.
        static_assert(kMinFloor == -127 && kMaxFloor == 127,
                      "the range the round-trip below has to cover ([floors.md])");

        NpcPool pool;
        pool.init();
        NpcId id = pool.spawn();

        pool.set_floor(id, -50);
        CHECK(pool.floor(id) == -50);
        pool.set_floor(id, 0);
        CHECK(pool.floor(id) == 0);

        // Every label FloorRegistry will accept, not just the demo stack's. Rolled up
        // into one CHECK so a width regression reports once instead of 255 times.
        bool allRoundTrip = true;
        for (int f = kMinFloor; f <= kMaxFloor; ++f) {
            pool.set_floor(id, static_cast<std::int16_t>(f));
            if (pool.floor(id) != f) allRoundTrip = false;
        }
        CHECK(allRoundTrip);
    }

    { // ---- the seeding path stores a descending floor as a negative number ----
        NpcPool pool;
        pool.init();
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        // -50 is the deepest demo floor and a Derelict, so this is literally the
        // record the shipping stack seeds last.
        const NpcId cand = seed_floor_from_spec(pool, -50, spec, /*seed=*/77u);
        CHECK(cand != kInvalidNpc);
        CHECK(pool.count() == spec.population);

        bool allLabelled = true;
        for (NpcId id = 0; id < pool.count(); ++id)
            if (pool.floor(id) != -50) allLabelled = false;
        CHECK(allLabelled);

        // And the label is not merely non-zero: it must be NEGATIVE, which is the
        // property an unsigned column could never hold.
        CHECK(pool.floor(0) < 0);
    }

    { // ---- FloorStreamer hands the module number through uncast ----
        // The end-to-end path: add_module(-50) -> ensure_loaded -> seed_floor_from_spec
        // -> pool.floor(). This is the call chain that carried the cast.
        Registry ecs;
        NpcPool pool;
        pool.init();
        FloorRegistry reg;
        LevelStack stack;

        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        const ModuleId m =
            stream.add_module(reg, /*number=*/-50, FloorKind::Derelict, /*seed=*/4242u);
        CHECK(m != kInvalidModule);

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, -50, playerId);
        CHECK(r.layer != kInvalidLayer);
        CHECK(pool.count() == floor_spec(FloorKind::Derelict).population);

        bool allNegative = true;
        for (NpcId id = 0; id < pool.count(); ++id)
            if (pool.floor(id) != -50) allNegative = false;
        CHECK(allNegative);
    }

    { // ---- live-row bookkeeping is untouched by the allocation change ----
        NpcPool pool;
        pool.init();
        CHECK(pool.capacity() == kNpcPoolSize);
        CHECK(pool.count() == 0);
        CHECK(pool.alive() == 0);
        CHECK(pool.reserve_remaining() == kNpcPoolSize);

        NpcId ids[5] = {};
        for (int i = 0; i < 5; ++i) ids[static_cast<std::size_t>(i)] = pool.spawn();
        CHECK(ids[0] == 0 && ids[4] == 4);      // the id IS the slot index
        CHECK(pool.count() == 5u);
        CHECK(pool.alive() == 5u);
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 5u);

        pool.kill(ids[2]);
        CHECK(pool.count() == 5u);              // high-water mark never decreases
        CHECK(pool.alive() == 4u);
        CHECK(pool.valid(ids[2]) && !pool.alive(ids[2]));
        // Recycling is OFF by default, so this is still the never-reclaim pool the rest
        // of the tree is written against ([npc_pool.h] "Slot recycling").
        CHECK(!pool.recycling());
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.spawn() == 5u);              // the dead slot is never handed back
        CHECK(pool.count() == 6u);
        CHECK(pool.alive() == 5u);

        // Now touch every lazily-allocated column. None of them participates in the
        // bookkeeping, so all five totals must be bit-identical afterwards.
        const std::uint32_t c = pool.count();
        const std::uint32_t a = pool.alive();
        pool.relations(ids[0])[0].target = 7u;
        pool.relations(ids[0])[0].affinity = -100;
        pool.set_name(ids[0], "Ivan", "Petrov");
        pool.level(ids[0]) = 7;
        pool.attrs(ids[0])[0] = 11;
        CHECK(pool.count() == c);
        CHECK(pool.alive() == a);
        CHECK(pool.reserve_remaining() == kNpcPoolSize - c);
        CHECK(pool.valid(ids[2]) && !pool.alive(ids[2]));
        CHECK(pool.alive(ids[0]));

        // ...and the values landed on the right rows, with neighbours untouched.
        CHECK(pool.relations(ids[0])[0].target == 7u);
        CHECK(pool.relations(ids[0])[0].affinity == -100);
        CHECK(pool.relations(ids[1])[0].target == kInvalidNpc);
        CHECK(std::strcmp(pool.name(ids[0]).data(), "Ivan") == 0);
        CHECK(std::strcmp(pool.surname(ids[0]).data(), "Petrov") == 0);
        CHECK(pool.name(ids[1])[0] == '\0');
        CHECK(pool.level(ids[0]) == 7 && pool.level(ids[1]) == 0);
        CHECK(pool.attrs(ids[0])[0] == 11 && pool.attrs(ids[1])[0] == 0);
    }

    { // ---- an untouched DEMAND column reads blank rather than out of bounds ----
        NpcPool pool;
        pool.init();
        // No spawn and no set_name: name_ / surname_ hold zero bytes. A const accessor
        // cannot materialize a column, so it must hand back the shared blank row —
        // returning row 0 of an empty vector is the bug this guards.
        CHECK(pool.name(0)[0] == '\0');
        CHECK(pool.surname(0)[0] == '\0');
        CHECK(pool.name(kNpcPoolSize - 1u)[0] == '\0');
        CHECK(&pool.name(0) == &kBlankName);      // the fallback, not a real row
        CHECK(&pool.surname(0) == &kBlankName);
    }

    { // ---- LIVE columns survive a geometric resize with every row intact ----
        // kNpcLazyChunk is 4096, so 5,000 records force at least one reallocation.
        // A resize that dropped, shifted or re-zeroed rows is the one regression this
        // lane can introduce, and it is invisible from count()/alive().
        NpcPool pool;
        pool.init();
        constexpr std::uint32_t n = 5000;
        static_assert(n > kNpcLazyChunk, "the run must cross a growth boundary");

        for (std::uint32_t i = 0; i < n; ++i) {
            const NpcId id = pool.spawn();
            pool.age(id) = static_cast<std::uint8_t>(1u + i % 90u);
            pool.sex(id) = (i & 1u) ? SexFemale : SexMale;
            pool.level(id) = static_cast<std::uint8_t>(1u + i % 100u);
            pool.attrs(id)[0] = static_cast<std::uint8_t>(i % 251u);
            pool.attrs(id)[static_cast<std::size_t>(kAttrSlots - 1)] =
                static_cast<std::uint8_t>(i % 97u);
        }
        CHECK(pool.count() == n);
        CHECK(pool.alive() == n);

        bool intact = true;
        for (std::uint32_t i = 0; i < n; ++i) {
            const NpcId id = i;
            if (pool.age(id) != static_cast<std::uint8_t>(1u + i % 90u)) intact = false;
            if (pool.sex(id) != ((i & 1u) ? SexFemale : SexMale)) intact = false;
            if (pool.level(id) != static_cast<std::uint8_t>(1u + i % 100u))
                intact = false;
            if (pool.attrs(id)[0] != static_cast<std::uint8_t>(i % 251u))
                intact = false;
            if (pool.attrs(id)[static_cast<std::size_t>(kAttrSlots - 1)] !=
                static_cast<std::uint8_t>(i % 97u))
                intact = false;
        }
        CHECK(intact);
    }

    { // ---- THE MEASUREMENT: what init() stopped allocating ----
        // The capacity is exactly 2^20, so 1 B of row width == 1.0 MiB of table and
        // every figure here is just a row width.
        constexpr std::size_t kRow = static_cast<std::size_t>(kNpcPoolSize);
        // 621 = the same 18 columns at TODAY'S widths (inv_ went 256 -> 384 when
        // v14 widened the slot count to u16, [inventory.h]) — the comparison is
        // against what eager-everything would cost NOW, not a 2026-07 memory.
        constexpr std::size_t kOldTable = 621u * kRow;   // all 18 columns assign()ed
        constexpr std::size_t kEagerTable = 434u * kRow; // what init() still writes

        NpcPool pool;
        pool.init();
        const std::size_t afterInit = pool.resident_bytes();
        std::printf("  npcpool: init() holds %.1f MiB (was %.1f MiB; %.1f MiB of "
                    "reader-less columns no longer allocated)\n",
                    static_cast<double>(afterInit) / (1024.0 * 1024.0),
                    static_cast<double>(kOldTable) / (1024.0 * 1024.0),
                    static_cast<double>(kOldTable - afterInit) / (1024.0 * 1024.0));
        // A band rather than equality: vector::assign into a fresh vector allocates
        // exactly the requested count on MSVC, libstdc++ and libc++ alike, but an
        // allocator is entitled to round up and that is not what this test is about.
        CHECK(afterInit >= kEagerTable);
        CHECK(afterInit <= kEagerTable + 4u * kRow);
        CHECK(kOldTable - afterInit >= 180u * kRow); // 187 B/row is the paper figure

        // The LIVE columns cost one chunk, not one capacity: 13 B/row x 4096 (11 B when
        // this was written; gen_ added 2 B/row for slot recycling's generation counter).
        const NpcId id = pool.spawn();
        const std::size_t afterSpawn = pool.resident_bytes();
        CHECK(afterSpawn - afterInit >= 32u * 1024u);
        CHECK(afterSpawn - afterInit < 64u * 1024u); // 53,248 B

        // rel_ is the widest column in the table — 128 B/row, 128.0 MiB at capacity —
        // and it holds nothing at all until someone calls relations(). This is the
        // single biggest line item in the lane, so measure the first touch.
        using RelRow = std::array<Relationship, kRelSlots>;
        static_assert(sizeof(RelRow) == 128, "16 x 8 B; the 128 MiB figure needs it");
        pool.relations(id)[0].affinity = 1;
        const std::size_t afterRel = pool.resident_bytes();
        CHECK(afterRel > afterSpawn);
        CHECK(afterRel - afterSpawn >= static_cast<std::size_t>(kNpcLazyChunk) *
                                           sizeof(RelRow)); // 512 KB
        CHECK(afterRel - afterSpawn < 2u * static_cast<std::size_t>(kNpcLazyChunk) *
                                          sizeof(RelRow));
        CHECK(afterRel < kOldTable - 150u * kRow); // still far under the old table
    }

    { // ---- the demo stack's whole population, measured ----
        // 1,930 records is main.cpp's ten-floor stack in full
        // (420+260+150+40+150+40+150+40+260+420); startup is 420 of them, because
        // only floor 0 loads. The point of the number is that it is nowhere near 950k:
        // kNpcActiveTarget is a design target, and the LIVE columns are sized to what
        // actually exists rather than to what the design hopes for.
        NpcPool pool;
        pool.init();
        const std::size_t base = pool.resident_bytes();
        for (int i = 0; i < 1930; ++i) (void)pool.spawn();
        CHECK(pool.count() == 1930u);
        CHECK(pool.alive() == 1930u);
        const std::size_t live = pool.resident_bytes() - base;
        std::printf("  npcpool: 1930-record demo stack adds %u B of LIVE columns "
                    "(13 B/row eager would be 13.0 MiB)\n",
                    static_cast<unsigned>(live));
        CHECK(live < 128u * 1024u); // 53,248 B: still inside the first 4096-row chunk
        CHECK(pool.resident_bytes() < 448u * static_cast<std::size_t>(kNpcPoolSize));
    }

    { // ---- kill() IS IDEMPOTENT: alive() cannot be double-decremented ----
        // The bug: kill() ended in `if (alive_) --alive_;` with no check that the record
        // had been alive, so a second kill on the same id decremented the counter again.
        // Nothing else went wrong — count() stayed a high-water mark, alive(id) stayed
        // false, flags stayed cleared — so the ONLY symptom was alive() drifting below
        // the truth by exactly the number of double-kills, permanently, with the
        // `if (alive_)` clamp bottoming it out at 0 instead of underflowing to 4 billion
        // where somebody would have noticed. Two callers can reach the same corpse:
        // `finalize_deaths` kills the record behind a Dead entity ([combat.cpp]) and the
        // macro sweep kills cold records ([macro_sim.cpp]).
        NpcPool pool;
        pool.init();
        NpcId ids[8] = {};
        for (int i = 0; i < 8; ++i) ids[static_cast<std::size_t>(i)] = pool.spawn();
        CHECK(pool.alive() == 8u);

        pool.kill(ids[3]);
        CHECK(pool.alive() == 7u);
        pool.kill(ids[3]);                       // <-- the old code said 6
        CHECK(pool.alive() == 7u);
        pool.kill(ids[3]);
        pool.kill(ids[3]);
        CHECK(pool.alive() == 7u);
        CHECK(pool.count() == 8u);               // and nothing else moved
        CHECK(!pool.alive(ids[3]));
        CHECK(pool.valid(ids[3]));

        // Killing a never-allocated id is also a no-op (valid() guards it), including one
        // inside the untouched reserve and the kInvalidNpc sentinel itself.
        pool.kill(ids[7] + 1u);
        pool.kill(kNpcPoolSize - 1u);
        pool.kill(kInvalidNpc);
        CHECK(pool.alive() == 7u);
        CHECK(pool.count() == 8u);

        // Quantified: 200 records, 100 of them killed TWICE. The old counter took 200
        // decrements and clamped to 0; the truth is 100. A single double-kill is a
        // 1-person lie, which is why this went unnoticed — at scale it reports an empty
        // building.
        NpcPool big;
        big.init();
        for (std::uint32_t i = 0; i < 200u; ++i) (void)big.spawn();
        for (std::uint32_t i = 0; i < 100u; ++i) {
            big.kill(i);
            big.kill(i);
        }
        CHECK(big.count() == 200u);
        CHECK(big.alive() == 100u);   // old code: 0
        std::uint32_t counted = 0;
        for (NpcId id = 0; id < big.count(); ++id)
            if (big.alive(id)) ++counted;
        CHECK(counted == big.alive()); // the maintained counter equals the scan
    }

    { // ---- a spawn/kill/spawn cycle REUSES the slot, oldest death first ----
        NpcPool pool;
        pool.init();
        pool.set_recycling(true);
        CHECK(pool.recycling());

        NpcId ids[6] = {};
        for (int i = 0; i < 6; ++i) ids[static_cast<std::size_t>(i)] = pool.spawn();
        CHECK(pool.count() == 6u);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.recycled() == 0u);

        // One death, one birth: the SAME slot comes back and the high-water mark does not
        // move. This is the whole point — the tail is finite, the free list is not.
        pool.kill(ids[2]);
        CHECK(pool.free_slots() == 1u);
        CHECK(pool.alive() == 5u);
        const NpcId again = pool.spawn();
        CHECK(again == ids[2]);
        CHECK(pool.count() == 6u);          // NOT 7: no tail slot was consumed
        CHECK(pool.alive() == 6u);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.recycled() == 1u);
        CHECK(pool.alive(again));
        CHECK(pool.floor(again) == kNoFloorLabel);   // a fresh record is on no floor

        // FIFO in KILL ORDER, which is the property determinism rests on: reuse must not
        // depend on an address, a hash or a set iteration, only on the order kill() was
        // called in. Oldest death first also maximizes the window in which a stale
        // reference is still detectable.
        pool.kill(ids[4]);
        pool.kill(ids[0]);
        pool.kill(ids[3]);
        CHECK(pool.free_slots() == 3u);
        CHECK(pool.spawn() == ids[4]);
        CHECK(pool.spawn() == ids[0]);
        CHECK(pool.spawn() == ids[3]);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.count() == 6u);
        CHECK(pool.recycled() == 4u);
        // Queue empty again -> back to bumping the tail.
        CHECK(pool.spawn() == 6u);
        CHECK(pool.count() == 7u);

        // reserve_remaining() counts the queue, because that is the number MacroSim gates
        // births on: a tail-only figure would refuse every birth once the plast ran dry
        // while recycled slots sat unused ([npc_pool.h] reserve_remaining).
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 7u);
        pool.kill(1u);
        pool.kill(5u);
        CHECK(pool.free_slots() == 2u);
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 7u + 2u);

        // Disarming forgets the queue rather than leaving one nothing will drain.
        pool.set_recycling(false);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 7u);
        CHECK(pool.spawn() == 7u);          // tail again, exactly as before this lane
    }

    { // ---- a DOUBLE kill cannot queue one slot twice ----
        // [npc_pool.h] kill() claims this and nothing tested it. Without the NpcAlive
        // guard, `kill(a); kill(a);` pushed `a` twice — and because push_free links
        // through nextFree_[a], the second push pointed that row AT ITSELF, so two
        // consecutive spawn()s both returned `a`: one id, two live records, alive_
        // incremented twice for one slot. That is strictly worse than the wrong HUD
        // number the never-reclaim pool got away with, because the two records then
        // share an inventory, a survival clock and a floor bucket entry.
        NpcPool pool;
        pool.init();
        pool.set_recycling(true);
        const NpcId a = pool.spawn();
        const NpcId b = pool.spawn();
        CHECK(b == 1u);
        CHECK(pool.alive() == 2u);

        pool.kill(a);
        pool.kill(a);
        pool.kill(a);
        CHECK(pool.free_slots() == 1u);      // old code: 3
        CHECK(pool.alive() == 1u);

        // The queue holds exactly ONE slot, so the second birth has to reach the tail.
        const NpcId r0 = pool.spawn();
        const NpcId r1 = pool.spawn();
        CHECK(r0 == a);
        CHECK(r1 != r0);                     // old code: r1 == r0 == a
        CHECK(r1 == 2u);                     // ...the tail, because the queue was empty
        CHECK(pool.count() == 3u);
        CHECK(pool.alive() == 3u);
        CHECK(pool.recycled() == 1u);
        // The standing invariant: a queued slot is a dead slot and is queued once, so the
        // queue can never be longer than the corpse count.
        CHECK(pool.free_slots() <= pool.count() - pool.alive());
    }

    { // ---- ARMING rebuilds the queue from the alive bits ----
        // Disarming drops the queue, so arming has to re-derive it or the two are
        // asymmetric: every death taken before the flag went on would be a slot lost for
        // good, i.e. the never-reclaim wall back under a flag that says it is closed, with
        // reserve_remaining() reporting slots spawn() will never hand out. This is also
        // the "rebuilt from the alive bits" half of the save-format note in [npc_pool.h]
        // "Column allocation policy": with it, a load arms recycling and the free list
        // does not have to travel in the save at all.
        NpcPool pool;
        pool.init();
        CHECK(!pool.recycling());
        for (int i = 0; i < 10; ++i) (void)pool.spawn();
        CHECK(pool.count() == 10u);

        // Four deaths in a deliberately NON-ascending order, while recycling is OFF.
        pool.kill(7u);
        pool.kill(2u);
        pool.kill(9u);
        pool.kill(4u);
        CHECK(pool.alive() == 6u);
        CHECK(pool.free_slots() == 0u);                     // nothing queued: still off
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 10u);

        pool.set_recycling(true);
        CHECK(pool.free_slots() == 4u);                     // all four corpses reclaimed
        CHECK(pool.reserve_remaining() == kNpcPoolSize - 10u + 4u);
        CHECK(pool.alive() == 6u);                          // and nobody was revived
        CHECK(pool.count() == 10u);

        // ASCENDING ID, not the kill order — a rebuild has no kill order to read, and
        // ascending id is the one ordering that is a pure function of the alive bits,
        // which is the same determinism property kill order has.
        CHECK(pool.spawn() == 2u);
        CHECK(pool.spawn() == 4u);
        CHECK(pool.spawn() == 7u);
        CHECK(pool.spawn() == 9u);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.count() == 10u);                         // the tail never moved
        CHECK(pool.alive() == 10u);
        CHECK(pool.recycled() == 4u);

        // Arming an ALREADY-armed pool is a no-op, so a caller may arm defensively.
        // Stated precisely, because it is easy to overclaim: these three lines pass
        // whether or not set_recycling() early-returns, because rebuild_free_list()
        // RESETS the queue before it scans and so re-derives the same set. What they pin
        // is the OBSERVABLE contract (a redundant arm changes nothing); the reset inside
        // rebuild_free_list is what makes that true, and the round trip below is what
        // would catch its loss.
        pool.kill(3u);
        CHECK(pool.free_slots() == 1u);
        pool.set_recycling(true);
        pool.set_recycling(true);
        CHECK(pool.free_slots() == 1u);
        CHECK(pool.spawn() == 3u);
        CHECK(pool.spawn() == 10u);                         // queue empty -> tail
        CHECK(pool.count() == 11u);

        // Round trip: disarm drops the queue, re-arm gets it back. That is exactly the
        // property a save/load pair needs — the rows are the truth, the queue is derived.
        pool.kill(5u);
        pool.kill(1u);
        CHECK(pool.free_slots() == 2u);
        pool.set_recycling(false);
        CHECK(pool.free_slots() == 0u);
        pool.set_recycling(true);
        CHECK(pool.free_slots() == 2u);
        CHECK(pool.spawn() == 1u);          // ascending on rebuild, not the kill order
        CHECK(pool.spawn() == 5u);
        CHECK(pool.free_slots() == 0u);
        CHECK(pool.count() == 11u);
        CHECK(pool.alive() == 11u);
        CHECK(pool.free_slots() <= pool.count() - pool.alive());
    }

    { // ---- a recycled row carries NO stale data, in ANY column ----
        // The failure this blocks is not a crash: it is a corpse's inventory, survival
        // clock, name or relationship edges turning up inside a newborn, and a floor
        // roster still listing the dead man. Every column the pool owns is written here
        // and then checked blank, INCLUDING the lazily-grown ones, because a reset that
        // only covers the EAGER block is the easy version of this bug.
        NpcPool pool;
        pool.init();
        pool.set_recycling(true);
        const NpcId a = pool.spawn();
        const NpcId keep = pool.spawn();      // a neighbour, to prove the blast radius

        pool.faction(a) = 4;
        pool.hp(a) = 77;
        pool.max_hp(a) = 99;
        pool.cx(a) = 11;
        pool.cy(a) = 22;
        pool.cz(a) = 33;
        pool.height_mm(a) = 1870;
        pool.age(a) = 61;
        pool.sex(a) = SexFemale;
        pool.level(a) = 12;
        pool.attrs(a)[0] = 5;
        pool.attrs(a)[static_cast<std::size_t>(kAttrSlots - 1)] = 6;
        pool.set_name(a, "Ivan", "Petrov");
        pool.set_design(a, true);
        pool.set_player(a, true);
        pool.set_embodied(a, true);
        pool.set_floor(a, -50);
        pool.inventory(a).at(0, 0).item = 42;
        pool.inventory(a).at(7, 7).count = 3;
        pool.needs(a).food = 12.5f;
        pool.needs(a).pendingPoo = 9.0f;
        pool.needs(a).seeded = 1;
        pool.relations(a)[0].target = keep;
        pool.relations(a)[0].affinity = -100;
        pool.relations(a)[static_cast<std::size_t>(kRelSlots - 1)].target = 3u;
        // The neighbour gets data too, so "reset the wrong row" is caught as well.
        pool.set_name(keep, "Anna", "Ivanova");
        pool.level(keep) = 7;
        pool.set_floor(keep, -50);
        pool.needs(keep).food = 50.0f;
        pool.relations(keep)[0].target = a;

        CHECK(pool.floor_bucket(-50).size() == 2u);
        pool.kill(a);
        CHECK(pool.floor_bucket(-50).size() == 1u);   // a corpse leaves the roster

        const NpcId reborn = pool.spawn();
        CHECK(reborn == a);
        CHECK(pool.alive(reborn));

        // EAGER columns.
        CHECK(pool.flags(reborn) == static_cast<std::uint8_t>(NpcAlive));
        CHECK(!pool.embodied(reborn));
        CHECK(!pool.is_player(reborn));            // NpcPlayer must not come back
        CHECK(!(pool.flags(reborn) & NpcDesign));  // nor an authored-NPC bit
        CHECK(pool.faction(reborn) == 0);
        CHECK(pool.hp(reborn) == 0 && pool.max_hp(reborn) == 0);
        CHECK(pool.cx(reborn) == 0 && pool.cy(reborn) == 0 && pool.cz(reborn) == 0);
        CHECK(pool.height_mm(reborn) == 0);
        CHECK(pool.inventory(reborn).empty());
        CHECK(pool.inventory(reborn).at(7, 7).count == 0);
        // Needs: blank means `seeded == 0` ("clock never rolled"), NOT a starving body.
        CHECK(pool.needs(reborn).seeded == 0);
        CHECK(pool.needs(reborn).food == 0.0f);
        CHECK(pool.needs(reborn).pendingPoo == 0.0f);
        // LIVE columns.
        CHECK(pool.age(reborn) == 0);
        CHECK(pool.sex(reborn) == SexUnset);
        CHECK(pool.level(reborn) == 0);
        CHECK(pool.attrs(reborn)[0] == 0);
        CHECK(pool.attrs(reborn)[static_cast<std::size_t>(kAttrSlots - 1)] == 0);
        // DEMAND columns. rel_ is the trap: a blank edge is `target == kInvalidNpc`, so a
        // memset row would read as sixteen relationships with NPC 0.
        CHECK(pool.name(reborn)[0] == '\0');
        CHECK(pool.surname(reborn)[0] == '\0');
        CHECK(pool.relations(reborn)[0].target == kInvalidNpc);
        CHECK(pool.relations(reborn)[0].affinity == 0);
        CHECK(pool.relations(reborn)[static_cast<std::size_t>(kRelSlots - 1)].target ==
              kInvalidNpc);
        // Floor membership and the bucket index.
        CHECK(pool.floor(reborn) == kNoFloorLabel);
        CHECK(pool.floor_bucket(-50).size() == 1u);
        CHECK(pool.floor_bucket(-50)[0] == keep);
        // ...and the neighbour was not touched by any of it.
        CHECK(std::strcmp(pool.name(keep).data(), "Anna") == 0);
        CHECK(pool.level(keep) == 7);
        CHECK(pool.needs(keep).food == 50.0f);
        CHECK(pool.relations(keep)[0].target == a);
        CHECK(pool.floor(keep) == -50);

        // The revived record joins a roster cleanly — the index is not left with a stale
        // slot for it, which is the failure mode a direct floor_ write would cause.
        pool.set_floor(reborn, -50);
        CHECK(pool.floor_bucket(-50).size() == 2u);
        pool.set_floor(reborn, 0);
        CHECK(pool.floor_bucket(-50).size() == 1u);
        CHECK(pool.floor_bucket(-50)[0] == keep);
        CHECK(pool.floor_bucket(0).size() == 1u);
    }

    { // ---- a reused id is DISTINGUISHABLE: the generation counter ----
        // Requirement (d): "an id handed out twice must be distinguishable, or dangling
        // references silently address a different creature". Six places in src/ store a
        // bare NpcId across time (Relationship::target, NpcRef::id, Contract::giver,
        // FloorModule::candidate, MacroSim::Journey::id, RelationEdge::id); this is the
        // tool each of them needs, and none of them uses it yet.
        static_assert(kNpcGenBits == 12u, "20 id bits of a 32-bit word leaves 12 spare");
        static_assert(kNpcPoolSize - 1u == kNpcIdMask, "an id fills exactly kNpcPoolBits");

        NpcPool pool;
        pool.init();
        pool.set_recycling(true);
        const NpcId a = pool.spawn();
        const NpcHandle h0 = pool.handle(a);
        CHECK(pool.generation(a) == 0u);
        CHECK(npc_handle_id(h0) == a);
        CHECK(pool.handle_valid(h0));

        // Death alone invalidates the handle, whether or not the slot is ever reused —
        // which is what makes this useful to a quest that never hears about the death.
        pool.kill(a);
        CHECK(!pool.handle_valid(h0));
        CHECK(pool.generation(a) == 1u);

        // Reuse: same id, different handle. A holder of h0 that indexes by id would read
        // the newcomer's row; handle_valid says no.
        const NpcId b = pool.spawn();
        CHECK(b == a);
        const NpcHandle h1 = pool.handle(b);
        CHECK(h1 != h0);
        CHECK(npc_handle_id(h1) == npc_handle_id(h0));   // ...the id really is the same
        CHECK(pool.handle_valid(h1));
        CHECK(!pool.handle_valid(h0));

        // Sentinels and out-of-range.
        CHECK(!pool.handle_valid(kInvalidHandle));
        CHECK(!pool.handle_valid(npc_handle(pool.count(), 0u)));   // past the high-water
        CHECK(npc_handle_gen(kInvalidHandle) == kInvalidGen);

        // The counter survives many cycles and never mints kInvalidGen, which is what
        // stops a live handle from colliding with kInvalidHandle.
        bool everInvalidGen = false;
        bool allDistinct = true;
        bool alwaysSameSlot = true;
        NpcHandle prev = h1;
        for (std::uint32_t i = 0; i < 4200u; ++i) {   // > 4095, so the counter wraps
            pool.kill(a);
            const NpcId r = pool.spawn();
            if (r != a) alwaysSameSlot = false;       // one slot, over and over
            const NpcHandle h = pool.handle(r);
            if (pool.generation(r) == kInvalidGen) everInvalidGen = true;
            if (h == prev) allDistinct = false;       // consecutive reuses differ
            if (h == kInvalidHandle) allDistinct = false;
            prev = h;
        }
        CHECK(alwaysSameSlot);
        CHECK(!everInvalidGen);
        CHECK(allDistinct);
        CHECK(pool.count() == 1u);           // 4,201 records through ONE slot
        CHECK(pool.recycled() == 4201u);
        std::printf("  npcpool: one slot carried %u records; generation now %u "
                    "(kInvalidGen %u is never minted)\n",
                    pool.recycled() + 1u, static_cast<unsigned>(pool.generation(a)),
                    static_cast<unsigned>(kInvalidGen));
    }

    { // ---- population HOLDS across many kill/spawn rounds instead of draining ----
        // Asserted as WORK COUNTS, never as wall clock; the ms figure is printed so a
        // human gets a real number and nothing is asserted about it.
        constexpr std::uint32_t kLive = 1000;
        constexpr std::uint32_t kRounds = 200;
        constexpr std::uint32_t kChurn = 500;   // deaths+births per round
        constexpr std::uint32_t kSpawns = kLive + kRounds * kChurn;  // 101,000

        std::uint32_t recycleCount = 0;
        std::uint32_t recycleReserve = 0;
        double recycleMs = 0.0;
        {
            NpcPool pool;
            pool.init();
            pool.set_recycling(true);
            std::vector<NpcId> live;
            live.reserve(kLive);
            for (std::uint32_t i = 0; i < kLive; ++i) {
                const NpcId id = pool.spawn();
                pool.set_floor(id, 3);
                live.push_back(id);
            }
            bool everExhausted = false;
            bool countHeld = true;
            const auto t0 = std::chrono::steady_clock::now();
            for (std::uint32_t r = 0; r < kRounds; ++r) {
                for (std::uint32_t k = 0; k < kChurn; ++k) {
                    const std::size_t slot = static_cast<std::size_t>((r * kChurn + k) %
                                                                      kLive);
                    pool.kill(live[slot]);
                    const NpcId fresh = pool.spawn();
                    if (fresh == kInvalidNpc) everExhausted = true;
                    else {
                        pool.set_floor(fresh, 3);
                        live[slot] = fresh;
                    }
                }
                if (pool.count() != kLive) countHeld = false;
            }
            const auto t1 = std::chrono::steady_clock::now();
            recycleMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
            CHECK(!everExhausted);
            CHECK(countHeld);                        // the high-water mark never moved
            CHECK(pool.count() == kLive);
            CHECK(pool.alive() == kLive);
            CHECK(pool.recycled() == kRounds * kChurn);
            // Conservation: every record ever created came from the tail or the queue.
            CHECK(pool.count() + pool.recycled() == kSpawns);
            // The roster is exactly the living, after 100,000 splices through the index.
            CHECK(pool.floor_bucket(3).size() == kLive);
            recycleCount = pool.count();
            recycleReserve = pool.reserve_remaining();
            CHECK(recycleReserve == kNpcPoolSize - kLive);
        }

        { // the same script WITHOUT recycling: 100,000 slots of reserve gone for good
            NpcPool pool;
            pool.init();
            std::vector<NpcId> live;
            live.reserve(kLive);
            for (std::uint32_t i = 0; i < kLive; ++i) {
                const NpcId id = pool.spawn();
                pool.set_floor(id, 3);
                live.push_back(id);
            }
            for (std::uint32_t r = 0; r < kRounds; ++r) {
                for (std::uint32_t k = 0; k < kChurn; ++k) {
                    const std::size_t slot = static_cast<std::size_t>((r * kChurn + k) %
                                                                      kLive);
                    pool.kill(live[slot]);
                    live[slot] = pool.spawn();
                    pool.set_floor(live[slot], 3);
                }
            }
            CHECK(pool.count() == kSpawns);          // every birth ate a virgin slot
            CHECK(pool.recycled() == 0u);
            CHECK(pool.alive() == kLive);
            CHECK(pool.reserve_remaining() == kNpcPoolSize - kSpawns);
            // The contrast, in one number: the same 101,000 births cost 1,000 slots with
            // recycling and 101,000 without.
            CHECK(recycleCount * 100u < pool.count());
            CHECK(recycleReserve > pool.reserve_remaining());
            std::printf("  npcpool: %u births through %u live records -> slots used %u "
                        "(recycling) vs %u (never-reclaim); %.2f ms for the recycling "
                        "run\n",
                        kSpawns, kLive, recycleCount, pool.count(), recycleMs);
        }
    }

    { // ---- recycling is BIT-DETERMINISTIC: identical scripts, identical pools ----
        // suite_macrosim.inl folds two independently-built pools into one FNV-1a digest
        // and requires them equal, and every macro decision is `hash(id, tick, salt)` —
        // so a free list whose order depended on anything but the recorded kill order
        // would hand newborns different ids in two identical runs and change the society.
        // Same fold here, over the columns a recycled row has to reset.
        auto digest = [](NpcPool& p) -> std::uint64_t {
            std::uint64_t h = 1469598103934665603ull;
            auto fold = [&h](std::uint64_t v) {
                h ^= v;
                h *= 1099511628211ull;
            };
            fold(p.count());
            fold(p.alive());
            fold(p.recycled());
            fold(p.free_slots());
            fold(p.reserve_remaining());
            for (NpcId id = 0; id < p.count(); ++id) {
                fold(p.flags(id));
                fold(p.generation(id));
                fold(p.faction(id));
                fold(static_cast<std::uint16_t>(p.hp(id)));
                fold(static_cast<std::uint16_t>(p.max_hp(id)));
                fold(static_cast<std::uint16_t>(p.floor(id)));
                fold(p.cx(id));
                fold(p.cy(id));
                fold(p.cz(id));
                fold(p.height_mm(id));
                fold(p.age(id));
                fold(p.sex(id));
                fold(p.level(id));
                for (int s = 0; s < kAttrSlots; ++s)
                    fold(p.attrs(id)[static_cast<std::size_t>(s)]);
                for (int s = 0; s < kInvSlots; ++s) {
                    fold(p.inventory(id).slots[static_cast<std::size_t>(s)].item);
                    fold(p.inventory(id).slots[static_cast<std::size_t>(s)].count);
                }
                fold(p.needs(id).seeded);
                for (int s = 0; s < kRelSlots; ++s) {
                    const std::size_t si = static_cast<std::size_t>(s);
                    fold(p.relations(id)[si].target);
                    fold(static_cast<std::uint16_t>(p.relations(id)[si].affinity));
                }
                fold(static_cast<std::uint8_t>(p.name(id)[0]));
            }
            return h;
        };

        // One script, run against a pool. Everything it writes is derived from the id it
        // was handed, so if reuse ever hands out a different id the digest moves.
        auto run = [](NpcPool& p, bool reverseKills, std::vector<NpcId>& handed) {
            p.init();
            p.set_recycling(true);
            for (std::uint32_t i = 0; i < 2000u; ++i) {
                const NpcId id = p.spawn();
                handed.push_back(id);
                p.faction(id) = static_cast<std::uint16_t>(id % 5u);
                p.hp(id) = static_cast<std::int16_t>(id % 100u);
                p.level(id) = static_cast<std::uint8_t>(id % 30u);
                p.age(id) = static_cast<std::uint8_t>(1u + id % 90u);
                p.attrs(id)[0] = static_cast<std::uint8_t>(id % 251u);
                p.inventory(id).at(0, 0).item = static_cast<std::uint16_t>(id % 33u);
                p.relations(id)[0].target = id ^ 1u;
                p.set_floor(id, static_cast<std::int16_t>(id % 7u));
            }
            // Three interleaved waves of deaths and births, so the queue is non-empty
            // across a bump boundary and reuse order actually matters.
            for (int wave = 0; wave < 3; ++wave) {
                for (std::uint32_t k = 0; k < 400u; ++k) {
                    const std::uint32_t step = 3u * k + static_cast<std::uint32_t>(wave);
                    const std::uint32_t victim = reverseKills ? (1999u - step % 2000u)
                                                              : (step % 2000u);
                    p.kill(victim);
                }
                for (std::uint32_t k = 0; k < 300u; ++k) {
                    const NpcId id = p.spawn();
                    handed.push_back(id);
                    p.faction(id) = static_cast<std::uint16_t>(id % 5u);
                    p.hp(id) = static_cast<std::int16_t>(id % 100u);
                    p.level(id) = static_cast<std::uint8_t>(id % 30u);
                    p.set_floor(id, static_cast<std::int16_t>(id % 7u));
                }
            }
        };

        std::uint64_t dA = 0;
        std::uint64_t dB = 0;
        std::vector<NpcId> handedA;
        std::vector<NpcId> handedB;
        std::vector<NpcId> handedRev;
        { NpcPool a; run(a, false, handedA); dA = digest(a); }
        { NpcPool b; run(b, false, handedB); dB = digest(b); }
        CHECK(dA == dB);
        CHECK(handedA.size() == handedB.size());
        CHECK(handedA == handedB);            // the id SEQUENCE reproduced, not just state
        CHECK(!handedA.empty());

        // ...and the order is load-bearing rather than incidental: kill the same records
        // in the opposite order and the ids handed to the survivors change. If this were
        // equal, the free list would not be honouring kill order at all and the check
        // above would be passing for the wrong reason.
        { NpcPool c; run(c, true, handedRev); (void)digest(c); }
        CHECK(handedRev.size() == handedA.size());
        CHECK(handedRev != handedA);
        std::printf("  npcpool: recycling digest 0x%016llx reproduced exactly over %u "
                    "handed-out ids; reversed kill order diverges\n",
                    static_cast<unsigned long long>(dA),
                    static_cast<unsigned>(handedA.size()));
    }

    { // ---- THE WALL, in miniature: MacroSim births stop dead without recycling ----
        // [macro_sim.h]'s banner models the design size: 950,000 records into 2^20 leaves
        // a 98,576-slot reserve, replacement births drain it by tick 149 (~2.9 simulated
        // years) and the population then decays monotonically 949,666 -> 825,347 with no
        // parameter able to move the wall, because "closing it properly needs slot
        // RECYCLING in NpcPool". This runs the REAL MacroSim against a reserve squeezed
        // down to kRoom slots so the same wall arrives in seconds, and shows recycling
        // closing it. Nothing here is a stub: the only thing that differs between the two
        // runs is `set_recycling`.
        constexpr std::uint32_t kSeeded = 3000;
        constexpr std::uint32_t kRoom = 60;     // reserve slots the demographic pass gets
        constexpr int kTicks = 250;             // 4.8 simulated years at 7 days/tick

        struct Run {
            std::uint32_t alive = 0;
            std::uint32_t count = 0;
            std::uint32_t reuses = 0;
            std::uint32_t births = 0;
            std::uint32_t deaths = 0;
            std::uint32_t blocked = 0;
            std::uint32_t minAlive = 0xFFFFFFFFu;
            bool roseAfterWall = false;   // a population that recovered post-wall
            double ms = 0.0;
        };

        auto sweep = [&](bool recycle) -> Run {
            Run out{};
            NpcPool pool;
            pool.init();
            pool.set_recycling(recycle);
            seed_floor_population(pool, 0, kSeeded, 1234u);

            MacroSim sim;
            sim.init();
            MacroParams p{};   // targetPopulation 0 -> latch the seeded size
            // Squeeze the reserve: room = reserve_remaining() - reserveFloor == kRoom at
            // the start of the run, for both modes, so the ONLY difference is whether
            // deaths give slots back.
            p.reserveFloor = pool.reserve_remaining() - kRoom;

            bool wallHit = false;
            std::uint32_t prevLiving = pool.alive();
            const auto t0 = std::chrono::steady_clock::now();
            for (int t = 0; t < kTicks; ++t) {
                const MacroStats st = sim.step(pool, p);
                out.births += st.births;
                out.deaths += st.deaths;
                out.blocked += st.birthsBlocked;
                if (st.living < out.minAlive) out.minAlive = st.living;
                // Once the plast is gone no birth can ever be granted again, so the
                // population is structurally unable to recover: that is the "decays
                // monotonically, no parameter moves it" claim in [macro_sim.h]'s banner,
                // checked rather than quoted.
                if (wallHit && st.living > prevLiving) out.roseAfterWall = true;
                if (st.birthsBlocked > 0u && st.births == 0u) wallHit = true;
                prevLiving = st.living;
            }
            const auto t1 = std::chrono::steady_clock::now();
            out.ms = std::chrono::duration<double, std::milli>(t1 - t0).count() /
                     static_cast<double>(kTicks);
            out.alive = pool.alive();
            out.count = pool.count();
            out.reuses = pool.recycled();
            // The bookkeeping identities, exactly, in both modes.
            CHECK(pool.alive() == kSeeded + out.births - out.deaths);
            CHECK(pool.count() + pool.recycled() == kSeeded + out.births);
            return out;
        };

        const Run wall = sweep(/*recycle=*/false);
        const Run open = sweep(/*recycle=*/true);

        // WITHOUT recycling: the reserve is a one-way draw, so births stop being granted
        // and the population can only fall.
        CHECK(wall.reuses == 0u);
        CHECK(wall.blocked > 0u);                    // the refusal is real and reported
        CHECK(wall.births <= kRoom);                 // ...and capped by the plast exactly
        CHECK(wall.count == kSeeded + wall.births);  // every birth ate a virgin slot
        CHECK(wall.alive < kSeeded);                 // decay, not a plateau
        CHECK(!wall.roseAfterWall);                  // and it can never come back

        // WITH recycling: deaths refill the queue, so the closed loop keeps replacing and
        // the high-water mark stops growing entirely.
        CHECK(open.blocked == 0u);
        CHECK(open.reuses > 0u);
        CHECK(open.births > wall.births * 3u);       // births kept being granted
        CHECK(open.count <= kSeeded + kRoom);        // the tail barely moved
        // Births past the tail's kRoom slots can only have come from the queue.
        CHECK(open.reuses + kRoom >= open.births);
        CHECK(open.alive > wall.alive);              // strictly more people, same params
        // Stationary, not merely non-empty: the closed loop holds the latched target.
        // 5% is the guard rail, not the claim — the modelled band for this algorithm is
        // a fraction of a percent ([suite_macrosim.inl] block 1 measures +0.00..+0.12%).
        CHECK(open.alive >= kSeeded - kSeeded / 20u);
        CHECK(open.alive <= kSeeded + kSeeded / 20u);
        CHECK(open.minAlive >= kSeeded - kSeeded / 20u);

        std::printf("  npcpool: MacroSim %d ticks, %u seeded, reserve squeezed to %u -> "
                    "never-reclaim: %u alive (%u births, %u blocked, %u slots); "
                    "recycling: %u alive (%u births, 0 blocked, %u slots, %u reuses)\n",
                    kTicks, kSeeded, kRoom, wall.alive, wall.births, wall.blocked,
                    wall.count, open.alive, open.births, open.count, open.reuses);
        std::printf("  npcpool: %.3f ms/macro-step never-reclaim vs %.3f ms/macro-step "
                    "recycling (printed, not asserted)\n", wall.ms, open.ms);
    }
}

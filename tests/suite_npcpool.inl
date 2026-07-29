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

#include <cstdio>
#include <cstring>

#include "ecs/registry.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
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
        constexpr std::size_t kOldTable = 493u * kRow;   // all 18 columns assign()ed
        constexpr std::size_t kEagerTable = 306u * kRow; // what init() still writes

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

        // The LIVE columns cost one chunk, not one capacity: 11 B/row x 4096.
        const NpcId id = pool.spawn();
        const std::size_t afterSpawn = pool.resident_bytes();
        CHECK(afterSpawn - afterInit >= 32u * 1024u);
        CHECK(afterSpawn - afterInit < 64u * 1024u); // 45,056 B

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
                    "(11 B/row eager would be 11.0 MiB)\n",
                    static_cast<unsigned>(live));
        CHECK(live < 128u * 1024u); // 45,056 B: still inside the first 4096-row chunk
        CHECK(pool.resident_bytes() < 320u * static_cast<std::size_t>(kNpcPoolSize));
    }
}

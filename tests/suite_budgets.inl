// Budgets — the first automatic guards on the one resource this project calls
// scarce.
//
// WHY THIS FILE EXISTS. performance.md declares the CPU tick the only scarce
// resource and RAM the one budget that bounds the dense model, and until
// 2026-08-12 **not one ctest asserted a byte or a millisecond**. 235k checks of
// behaviour, zero checks of cost. A footprint can therefore triple without a
// single test going red, which is exactly how 130 MiB of nav and 958 MiB of
// mirror arrived unremarked (Docs/specs/05 §2.4).
//
// TWO RULES OF FORM, and they are what separate a budget from a pin.
//
// 1. EVERY BUDGET PRINTS ITS NUMBER, pass or fail. AGENTS.md §Measure: "print the
//    number every run" — a silent green test denies the next session the trend,
//    and a regression that reads as a number is caught while a regression that
//    reads as a feeling is not. This is the half that pays off even when nothing
//    ever fails.
// 2. THE LIMIT IS A CEILING WITH HEADROOM, NEVER THE CURRENT VALUE. A budget
//    pinned at today's measurement turns every improvement red and trains the
//    next author to retype the number — the precise reflex the audit_findings
//    comment in CMakeLists.txt warns against. Each limit below therefore states
//    what it is protecting against, not what was measured.
//
// WHAT IS DELIBERATELY NOT BUDGETED HERE:
//   * frame time / FPS — render.md already derived the rule: FIFO present makes
//     the frame counter a cap, blind to everything under it, so pinning it pins
//     vsync. It also needs a GPU, and this suite links giga_game only.
//   * the voxel mirror (958 MiB, the single largest allocation in the game) —
//     it lives in src/render and game_test cannot see it. It belongs in a
//     budget suite on the render side; naming it here so the omission is a known
//     gap rather than an oversight.

#include "core/tick.h"
#include "game/floor_gen.h"
#include "game/room_zone.h"
#include "game/npc_pool.h"
#include "game/combat.h"      // CarveProposalQueue
#include "world/nav.h"

#include <chrono>

namespace budgets_test {

// Print measured AND limit, always; assert only the ceiling.
// `unit` keeps the line greppable and self-describing a year from now.
static void check_budget(const char* name, double measured, double limit,
                         const char* unit) {
    std::fprintf(stderr, "[budget] %-22s %12.1f %-4s  limit %12.1f  %s\n", name,
                 measured, unit, limit,
                 measured <= limit ? "ok" : "OVER");
    CHECK(measured <= limit);
}

// --- 1. Navigation: the largest bake in the game ---------------------------
//
// The footprint is ARITHMETIC, not a measurement, and pinning the arithmetic is
// worth more than pinning a malloc: `flow` is node-major over the whole macro
// grid, so it is exactly kNavNodes x kMacroCells bytes and it moves only when
// somebody changes the node count or the grid size. Both are decisions, and this
// is where a decision that costs 128 MiB announces itself.
//
// The limit is 160 MiB against a design of ~130 MiB: room for one more per-cell
// byte-plane (2 MiB) many times over, but not for a doubling of the node count.
static void nav_footprint_is_what_the_header_claims() {
    const std::size_t flowBytes =
        static_cast<std::size_t>(nav::kNodes) * kMacroCells;
    const std::size_t nearestBytes = kMacroCells;
    const std::size_t total = flowBytes + nearestBytes;

    check_budget("nav_flow_bytes", static_cast<double>(flowBytes),
                 136.0 * 1024.0 * 1024.0, "B");
    check_budget("nav_nearest_bytes", static_cast<double>(nearestBytes),
                 4.0 * 1024.0 * 1024.0, "B");
    check_budget("nav_total_bytes", static_cast<double>(total),
                 160.0 * 1024.0 * 1024.0, "B");

    // nav.h states "64 flow fields (128 MiB) plus a 2 MiB nearest-node field".
    // Restating it as an assertion is the point: prose drifts silently, and this
    // file has already been caught carrying three-version-old arithmetic in
    // save.cpp's comments while the asserts beside them were right.
    CHECK(flowBytes == 128u * 1024u * 1024u);
    CHECK(nearestBytes == 2u * 1024u * 1024u);
}

// --- 2. Room zones: the bake that just grew ---------------------------------
//
// Measured for real, because unlike nav this one depends on the floor's room MIX
// intersected with kRoomFieldMask, and that intersection changed on 2026-08-12
// (IntentSocial->Common, IntentWork->Production). Residential went 3 bits -> 4.
//
// The ceiling is 16 MiB. Justification rather than a round number: 2 099 200 B
// per baked bit, and no FloorKind's mix declares more than 6 room kinds
// (floor_gen.cpp), so the true worst case is ~12.6 MiB even if EVERY kind gets an
// affordance row. 16 MiB leaves that headroom and still fails loudly if somebody
// makes the fields per-sub-voxel or adds a second plane per bit.
static void room_zone_footprint() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);

    RoomZones z;
    const auto t0 = std::chrono::steady_clock::now();
    bake_room_zones(w.grid(), FloorKind::Residential, 0, z);
    const auto t1 = std::chrono::steady_clock::now();
    const double bakeMs =
        std::chrono::duration<double, std::milli>(t1 - t0).count();

    CHECK(z.ready());
    check_budget("room_zones_bytes", static_cast<double>(z.resident_bytes()),
                 16.0 * 1024.0 * 1024.0, "B");

    // Per-bit cost, asserted rather than assumed: one dense byte per macro cell
    // plus the room lattice. This is the number Docs/specs/08 §4.1 got wrong by
    // three orders of magnitude (it said the field was the 32x32 lattice), so it
    // is worth an assertion and not a comment.
    int bakedBits = 0;
    for (int b = 0; b < static_cast<int>(kFloorRoomBits); ++b)
        if ((z.baked & static_cast<std::uint16_t>(1u << b)) != 0) ++bakedBits;
    CHECK(bakedBits > 0);
    const std::size_t perBit = z.resident_bytes() / static_cast<std::size_t>(bakedBits);
    CHECK(perBit >= kMacroCells);           // at least the dense byte plane
    CHECK(perBit <= kMacroCells + 65536u);  // and nothing like a second one

    // Bake time is generous ON PURPOSE: this runs on whatever machine ctest runs
    // on, and a tight time bound is a flaky test, which is worse than no test.
    // 4000 ms guards against an accidental O(n^2) or a per-bit walkability pass,
    // not against a slow laptop — measured cost is tens of milliseconds.
    check_budget("room_bake_ms", bakeMs, 4000.0, "ms");
}

// --- 3. The macro population: 2^20 rows is the stated goal -------------------
//
// ARCHITECTURE.md §Манифест p.2 fixes the cold table at ~2^20 rows, and
// npc_pool.h reasons in bytes-per-head. That makes per-head cost the number worth
// guarding: it multiplies by a million, so a column added without thought is a
// megabyte-scale decision made by accident.
//
// The limit is 512 B/head against a measured design in the hundreds. It fails on
// a doubling, not on a field.
static void pool_cost_per_head() {
    // THE POOL HAS TWO COSTS AND THEY BEHAVE DIFFERENTLY, so they get two budgets.
    // `init()` assigns the EAGER columns at the full 2^20 once and never resizes
    // them again (that stability is a documented guarantee, not an accident);
    // spawn() grows the LIVE columns per head, and the DEMAND columns stay at zero
    // until something touches them. A single "bytes per head" number would blur the
    // one that is paid unconditionally into the one that scales with population.
    //
    // Two drafts of this budget were wrong before this one, and both were caught by
    // the PRINTED number rather than by an assert:
    //   * measuring a default-constructed pool reported 0.0 B/head — a budget that
    //     measures nothing and can never exceed its limit, i.e. exactly the vacuous
    //     check this file argues against;
    //   * then spawning without init() segfaulted, because spawn() writes flags_
    //     and floor_, which are the EAGER columns init() allocates.
    NpcPool pool;
    CHECK(pool.capacity() == kNpcPoolSize);
    pool.init();

    const std::size_t eager = pool.resident_bytes();
    CHECK(eager != 0);   // the 0.0 B/head trap, pinned shut
    // The unconditional price of the dense design, at the manifesto's own 2^20.
    // 512 MiB against the ~8 GB budget performance.md sets: this is the largest
    // single CPU-side allocation the game makes, and doubling it must be a decision
    // somebody takes on purpose rather than a column somebody adds in passing.
    check_budget("pool_eager_bytes", static_cast<double>(eager),
                 512.0 * 1024.0 * 1024.0, "B");
    check_budget("pool_eager_bytes_per_row",
                 static_cast<double>(eager) / static_cast<double>(kNpcPoolSize),
                 512.0, "B");

    constexpr std::uint32_t kHeads = 4096u;
    bool allSpawned = true;
    for (std::uint32_t i = 0; i < kHeads; ++i)
        if (pool.spawn() == kInvalidNpc) allSpawned = false;
    CHECK(allSpawned);   // one CHECK, not kHeads of them
    CHECK(pool.count() == kHeads);

    // The MARGINAL cost of a live head — the delta, so the eager block above does
    // not smear across it. This is the number that decides whether the live columns
    // can ever be grown to the full table.
    const std::size_t afterSpawn = pool.resident_bytes();
    CHECK(afterSpawn > eager);
    const double perLive = static_cast<double>(afterSpawn - eager) /
                           static_cast<double>(kHeads);
    check_budget("pool_bytes_per_live_row", perLive, 256.0, "B");
    // Projected, not measured: spawning a million heads in a unit test would cost
    // seconds and allocate the real gigabyte, and the projection catches the same
    // regression, since a per-row cost that doubles doubles this too.
    check_budget("pool_bytes_at_2e20",
                 static_cast<double>(eager) +
                     perLive * static_cast<double>(kNpcPoolSize),
                 1024.0 * 1024.0 * 1024.0, "B");
}

// --- 4. The carve queue: a bounded buffer whose overflow is silent -----------
//
// CarveProposalQueue drops proposals when full and counts the drops. The count
// existing is what commit 9f28a792 fixed; asserting on it is what makes the fix
// load-bearing. An empty queue that has never dropped is the only correct state
// after a reset, and if that stops being true the cause is a reset that forgot a
// field — the exact bug class this project keeps finding.
static void carve_queue_overflow_is_counted_not_silent() {
    CarveProposalQueue q;
    q.clear();
    check_budget("carve_dropped_full", static_cast<double>(q.droppedFull), 0.0, "n");
    check_budget("carve_queued", static_cast<double>(q.count), 0.0, "n");

    // Fill it exactly, then push one more. The budget is not "never drop" — a
    // bounded buffer drops by design — it is "a drop is never SILENT", which is
    // the property commit 9f28a792 added the counters for. Asserting it here is
    // what keeps a future `return false` without an increment from passing.
    for (int i = 0; i < static_cast<int>(kMaxCarveProposals); ++i)
        CHECK(q.push(1.0f, 1.0f, 1.0f, 1.0f, 100u, static_cast<std::uint32_t>(i)));
    CHECK(q.count == kMaxCarveProposals);
    CHECK(!q.push(1.0f, 1.0f, 1.0f, 1.0f, 100u, 0u));
    check_budget("carve_dropped_after_overfill",
                 static_cast<double>(q.droppedFull), 1.0, "n");
    CHECK(q.droppedFull == 1);

    // The other three refusal reasons are counted separately, and separately is
    // the point: "queue full" and "degenerate radius" are different bugs and used
    // to look identical from the outside (a shot that hit a wall and carved
    // nothing). A radius over the cap is CLAMPED rather than refused, so it lands.
    q.clear();
    CHECK(!q.push(1.0f, 1.0f, 1.0f, 0.0f, 100u, 0u));   // zero radius
    CHECK(q.droppedDegenerate == 1);
    CHECK(!q.push(1.0f, 1.0f, 1.0f, 1.0f, 0u, 0u));     // zero power
    CHECK(q.droppedDegenerate == 2);
    CHECK(q.push(1.0f, 1.0f, 1.0f, 99.0f, 100u, 0u));   // over-wide: clamped, kept
    CHECK(q.clampedRadius == 1);
    CHECK(q.droppedFull == 0);
}

}  // namespace budgets_test

static void test_budgets_all() {
    using namespace budgets_test;
    nav_footprint_is_what_the_header_claims();
    room_zone_footprint();
    pool_cost_per_head();
    carve_queue_overflow_is_counted_not_silent();
}

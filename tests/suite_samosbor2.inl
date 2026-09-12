// Samosbor WIRING tests — the fog-spawn budget, the roster unlock, and the ride.
//
// suite_samosbor.inl already pins the clock and the pure predicates. This file exists
// because those predicates had **no call site in src/**: `samosbor_census`,
// `samosbor_threat_target`, `samosbor_threat_headroom`, `samosbor_unsheltered_pressure`,
// `samosbor_allows_kind` and `samosbor_active` were all dead, and
// `samosbor_fog_spawn_allowed` was reachable only from `samosbor_threat_headroom`,
// which was itself unreached. A tested function with no caller is a tested function
// that cannot regress the game, and samosbor.h says of the back-off predicate that
// "its absence is a crash rather than a balance complaint" — a claim nothing could
// have falsified. So the assertions here are deliberately about the SEAM:
//
//   * a census below target spawns, at/above target does not, and the population
//     lands on the target rather than near it;
//   * every head fog puts on the floor is one the next census will count, which is
//     the invariant that makes the loop terminate;
//   * `minSamosbor` gates the roster at count 0 and opens it as the count rises;
//   * a floor ride carries `count` and re-rolls the timer off the depth curve;
//   * the unsheltered damage is still a ONE-SHOT at the seal. That one is a
//     regression guard, not a feature test: modelled as a per-tick DoT, 40 minutes
//     at |z| = 50 bills over a million HP instead of a handful.
//
// This is a .inl and not a .cpp on purpose: game_test.cpp owns the CHECK macro and
// the `using namespace giga::game`, so the include has to land after them. It carries
// its own includes of the systems under test.

#include "core/tick.h"
#include "ecs/components.h"
#include "game/combat.h"    // MobCombat — a fog head without it is invisible to combat
#include "game/floor_gen.h"
#include "game/mob_spawn.h"
#include "game/samosbor.h"
#include "game/wander.h"
#include "world/macro_grid.h"
#include "world/world.h"

namespace samosbor2_detail {

// Mobs stand on the module's ground storey, one cell above the base slab
// (mob_spawn.cpp's kGroundZ). Restated here because the fog spawner's placement is
// only legal on that storey and these tests have to know where to look.
inline const int kTestGroundZ = giga::game::floor_ground_z();

// A samosbor parked in the middle of its Active phase, which is the only phase the
// fog spawner does anything in. Built by hand rather than by stepping a clock
// forward: reaching Active honestly costs 120..180 s of new-game timer plus a 30 s
// warning, and suite_samosbor.inl already proves the walk gets there.
inline giga::game::SamosborState active_state(giga::game::SamosborVariant v,
                                              std::uint16_t count) {
    giga::game::SamosborState st;
    st.phase = static_cast<std::uint8_t>(giga::game::SamosborPhase::Active);
    st.variant = static_cast<std::uint8_t>(v);
    st.activeMs = 60u * 1000u;
    st.phaseMs = 45u * 1000u;
    st.phaseTotalMs = 60u * 1000u;
    st.count = count;
    st.sealed = false;
    return st;
}

// The transition a caller sees on an ordinary mid-phase tick: nothing crossed.
inline giga::game::SamosborTransition quiet_tr() {
    return giga::game::SamosborTransition{};
}

// Toroidal 3-D distance, the same arithmetic samosbor_census uses. Duplicated here
// deliberately — the point of the annulus assertion is to check the production code
// against an independent statement of the rule, not against itself.
inline float torus_dist(const giga::vec3& a, const giga::vec3& b) {
    const float dx = giga::wrap_delta_f(a.x, b.x, giga::kWorldExtent);
    const float dy = giga::wrap_delta_f(a.y, b.y, giga::kWorldExtent);
    const float dz = giga::wrap_delta_f(a.z, b.z, giga::kWorldExtent);
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// A cell centre on the ground storey, which is where an anchor has to sit for the
// fog spawner's z-consistency test to have any legal candidates at all.
inline giga::vec3 ground_pos(int cx, int cy) {
    return giga::vec3{(static_cast<float>(cx) + 0.5f) * giga::kCellSize,
                      (static_cast<float>(cy) + 0.5f) * giga::kCellSize,
                      static_cast<float>(kTestGroundZ) * giga::kCellSize + 0.9f};
}

// How many AIR cells sit in the fog spawner's legal annulus around a cell.
//
// This is a PRECONDITION, not a feature test. Fog arrivals need a standable cell
// between the two census radii, and a floor that happened not to provide one would
// make every spawn assertion below fail for a reason that has nothing to do with the
// budget. Asserting the precondition separately is what turns "spawned == 0" from a
// mystery into a diagnosis.
inline int annulus_air(const giga::World& w, int acx, int acy) {
    int n = 0;
    for (int dy = -giga::game::kThreatOuterRadiusCells;
         dy <= giga::game::kThreatOuterRadiusCells; ++dy)
        for (int dx = -giga::game::kThreatOuterRadiusCells;
             dx <= giga::game::kThreatOuterRadiusCells; ++dx) {
            const int r2 = dx * dx + dy * dy;
            if (r2 < giga::game::kThreatNearRadiusCells *
                         giga::game::kThreatNearRadiusCells)
                continue;
            if (r2 > giga::game::kThreatOuterRadiusCells *
                         giga::game::kThreatOuterRadiusCells)
                continue;
            if (w.grid().cell(acx + dx, acy + dy, kTestGroundZ) == giga::kCellAir) ++n;
        }
    return n;
}

} // namespace samosbor2_detail

static void test_samosbor2_all() {
    using namespace samosbor2_detail;

    { // ---- test_samosbor2_cadence_is_derived_from_the_tick ------------------
        // The fog cadence is written as 2 * kSimHz, not as 250. A literal 250 that
        // does not move when the tick rate does is exactly the drift core/tick.h
        // exists to kill, and the audit test that measured a 1/120 game after the
        // switch to 125 Hz is the precedent.
        static_assert(kFogSpawnPeriodTicks == 250u);
        static_assert(kFogSpawnPeriodTicks == 2u * static_cast<std::uint64_t>(kSimHz));

        // And the integer millisecond step must be EXACTLY kSimDt in ms. At 1/120
        // this difference is 0.333 ms per tick, which is the 4.17% stretch of every
        // authored duration in the game — including every samosbor phase.
        CHECK(std::fabs(static_cast<float>(kSimStepMs) - kSimDt * 1000.0f) < 1e-4f);
        static_assert(kSimStepMs * kSimHz == 1000);
    }

    { // ---- test_samosbor2_ride_preserves_count ------------------------------
        // THE defect this fixes: main.cpp called samosbor_new_game on every floor
        // ride, which zeroed `count` — so MobDef::minSamosbor, a per-run unlock, was
        // pinned at 0 for the whole game and the min_samosbor column of all 69
        // mobs.csv rows was dead data.
        SamosborRng rng{0x5A303B0Du};
        SamosborState st = samosbor_new_game(rng);
        CHECK(st.count == 0);

        // Survive five samosbors, the honest way: the count only moves on cycleEnded.
        st.count = 5;
        st.variant = static_cast<std::uint8_t>(SamosborVariant::Meat);
        st.sealed = true;

        const SamosborState deep = samosbor_enter_floor(st, -50, rng);
        CHECK(deep.count == 5);                 // the ride carries progression
        CHECK(deep.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
        CHECK(!deep.sealed);                    // a fresh cycle, not the old one
        CHECK(!samosbor_active(deep));

        // And the timer came off the DEPTH CURVE, not the new-game timer. At |z| = 50
        // the cooldown is 45..75 s (60 s mean, +/-25% jitter, floored at 45 s), the
        // aftermath is deducted, and the warning is the tail of what is left — so
        // Idle holds 3..33 s. samosbor_new_game would have handed out 90..150 s here,
        // which is 2-3x the calm that floor is ever supposed to give.
        CHECK(deep.phaseMs >= kSamosborMinIdleMs);
        CHECK(deep.phaseMs <= 33u * 1000u);
        CHECK(deep.phaseMs < kSamosborFirstTimerMinMs - kSamosborWarningMs);

        // The surface is the other end of the same curve: a ~30 min cooldown, so the
        // ride there is quiet for 21 minutes at worst.
        const SamosborState surface = samosbor_enter_floor(st, 0, rng);
        CHECK(surface.count == 5);
        CHECK(surface.phaseMs > 21u * 60u * 1000u);
        CHECK(surface.phaseMs > deep.phaseMs * 30u);

        // Every ride, for 64 rides down and back up, carries the count and never
        // re-rolls it. Accumulated into one flag: 64 rides x 3 facts is 192 CHECKs
        // for one bit of information.
        bool carried = true;
        bool inBand = true;
        SamosborState walk = st;
        for (int i = 0; i < 64; ++i) {
            const int z = (i % 2 == 0) ? -50 : 0;
            walk = samosbor_enter_floor(walk, z, rng);
            if (walk.count != 5) carried = false;
            if (walk.phaseMs < kSamosborMinIdleMs) inBand = false;
        }
        CHECK(carried);
        CHECK(inBand);
    }

    { // ---- test_samosbor2_kind_gate_excludes_at_count_zero ------------------
        // SAFEGUARD is the single kind in mobs.csv carrying minSamosbor 7, and it is
        // habitat-legal at ZMinus50 — so it is the sharpest available probe of the
        // gate: it must be refused on a fresh run and admitted on a deep one.
        const MobDef& guard = mob_def(MobKind::Safeguard);
        CHECK(guard.minSamosbor == 7);
        CHECK(!samosbor_allows_kind(guard, 0));
        CHECK(!samosbor_allows_kind(guard, 6));
        CHECK(samosbor_allows_kind(guard, 7));
        CHECK(samosbor_allows_kind(guard, 8));

        // The 99 sentinel means never, within any reachable count.
        CHECK(!samosbor_allows_kind(mob_def(MobKind::Creator), 98));
        CHECK(mob_def(MobKind::Creator).minSamosbor == 99);
    }

    { // ---- test_samosbor2_fog_roster_relaxation -----------------------------
        // The measured shape of the problem, and the reason the roster cannot be a
        // plain filter. At ZMinus50 the habitat roster is 15 kinds and NONE of them
        // passes minSamosbor at count 0 or 1 — so a hard gate produces an empty
        // roster on the floor that is under samosbor 94% of the time. The relaxation
        // lifts the effective count to the roster's own minimum (2 here) and no
        // further.
        //
        // 15 and not 16, and the missing row is worth knowing about: SCULPTURE is
        // habitat-legal at ZMinus50 with minSamosbor 2, but its authored spawn weight
        // of 0.05 stores as spawnWeightX10 = round(0.5) = 0 under the generator's
        // banker's rounding — the same value that means "hand-placed, never rolled".
        // So it is unrollable by every spawner in the tree, spawn_floor_mobs included.
        // Pinned here because a CSV-side count says 16 and the table says 15.
        CHECK(mob_def(MobKind::Sculpture).spawnWeightX10 == 1);
        CHECK(mob_def(MobKind::Sculpture).minSamosbor == 2);

        const FogRoster deep0 = samosbor_fog_roster(-50, 0);
        CHECK(deep0.n == 3u);
        CHECK(deep0.effCount == 2);
        CHECK(deep0.relaxed);
        CHECK(deep0.total > 0u);
        CHECK(deep0.total == deep0.cumWeight[deep0.n - 1u]);

        const FogRoster deep1 = samosbor_fog_roster(-50, 1);
        CHECK(deep1.n == 3u);
        CHECK(deep1.effCount == 2);
        CHECK(deep1.relaxed);

        // At the floor's own minimum the gate stops being relaxed and starts being
        // the gate. Same roster, different reason — which is the point.
        const FogRoster deep2 = samosbor_fog_roster(-50, 2);
        CHECK(deep2.n == 3u);
        CHECK(deep2.effCount == 2);
        CHECK(!deep2.relaxed);

        // And it OPENS with the count. This is minSamosbor being a progression axis
        // rather than a statistic: 2 kinds at the start of a run, all 15 by the
        // seventh survived samosbor.
        CHECK(samosbor_fog_roster(-50, 3).n == 9u);
        CHECK(samosbor_fog_roster(-50, 4).n == 14u);
        CHECK(samosbor_fog_roster(-50, 5).n == 15u);
        CHECK(samosbor_fog_roster(-50, 7).n == 16u);
        CHECK(samosbor_fog_roster(-50, 99).n == 16u);   // the whole habitat roster

        // SAFEGUARD is what closes the loop between the gate and the roster: refused
        // at count 0 even though the relaxation fired, admitted at 7. A relaxation
        // that had simply opened the floodgates would fail this.
        auto roster_has = [](const FogRoster& r, MobKind k) {
            for (std::uint32_t i = 0; i < r.n; ++i)
                if (r.kind[i] == static_cast<std::uint8_t>(k)) return true;
            return false;
        };
        CHECK(!roster_has(deep0, MobKind::Safeguard));
        CHECK(roster_has(samosbor_fog_roster(-50, 7), MobKind::Safeguard));
        // The two kinds a fresh run at ZMinus50 actually gets.
        CHECK(roster_has(deep0, MobKind::Shadow));
        CHECK(roster_has(deep0, MobKind::TonkayaTen));
        // CREATOR is habitat-legal at ZMinus50 and must never appear: spawn weight 0
        // means hand-placed, and the weight filter runs before the unlock.
        CHECK(!roster_has(samosbor_fog_roster(-50, 99), MobKind::Creator));
        CHECK(roster_has(samosbor_fog_roster(-50, 99), MobKind::Sculpture));

        // Monotone in count on every anchor, and never empty on any of them. The
        // monotonicity is what makes the relaxation defensible: it can only ever
        // admit a subset of what a higher count would.
        const int kAnchors[] = {-50, -36, -26, 0, 14, 30};
        bool monotone = true;
        bool neverEmpty = true;
        for (int z : kAnchors) {
            std::uint32_t prev = 0;
            for (int c = 0; c <= 8; ++c) {
                const FogRoster r = samosbor_fog_roster(z, static_cast<std::uint16_t>(c));
                if (r.n < prev) monotone = false;
                if (r.n == 0u) neverEmpty = false;
                prev = r.n;
            }
        }
        CHECK(monotone);
        CHECK(neverEmpty);

        // The other five anchors, at count 0, with their relaxation targets. ZMinus26
        // is the ONE anchor that needs no relaxation, because BETONOED is the single
        // row in mobs.csv with minSamosbor 0 — and it collapses that floor's 41-kind
        // roster to exactly one, which is the "do not make this a floor's only
        // filter" warning in samosbor.h stated as a number.
        const FogRoster mid0 = samosbor_fog_roster(-26, 0);
        CHECK(mid0.n == 1u);
        CHECK(mid0.effCount == 0);
        CHECK(!mid0.relaxed);
        CHECK(roster_has(mid0, MobKind::Betonoed));
        // 41, was 42: the legacy-content purge removed one kind from this band.
        CHECK(samosbor_fog_roster(-26, 99).n == 41u);
        CHECK(samosbor_fog_roster(-36, 0).n == 4u);
        CHECK(samosbor_fog_roster(-36, 99).n == 29u);
        CHECK(samosbor_fog_roster(0, 0).n == 12u);
        CHECK(samosbor_fog_roster(0, 0).effCount == 1);
        CHECK(samosbor_fog_roster(0, 99).n == 42u);
        CHECK(samosbor_fog_roster(14, 0).n == 10u);
        CHECK(samosbor_fog_roster(30, 0).n == 2u);
    }

    { // ---- test_samosbor2_fog_tick_gates ------------------------------------
        // Everything that must make the tick a no-op, so the one call site in
        // main.cpp can be unconditional.
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        generate_floor(w, -50, spec, 11u);
        const std::uint8_t danger = danger_for_hostility(spec.hostility);
        CHECK(danger == 5);                        // Derelict is the high-risk floor
        CHECK(danger >= kFogHighRiskDanger);

        Registry reg;
        const LayerId layer = 0;
        const vec3 anchor = ground_pos(64, 64);    // centre cell, ground storey
        // Precondition: this floor really does offer standable arrival cells in the
        // annulus. 32 placement tries against a 47.8%-of-square geometric filter need
        // a few hundred air cells to be a certainty rather than a coin flip.
        CHECK(annulus_air(w, 64, 64) > 200);

        // 1. Not Active -> nothing, and no census either. The Idle/Warning/Aftermath
        //    phases are 100% of a surface floor's wall clock minus 1.6%.
        SamosborState idle;
        const FogTickReport off =
            samosbor_fog_tick_at(reg, w, idle, quiet_tr(), layer, anchor, -50, danger,
                                 kFogSpawnPeriodTicks);
        CHECK(!off.censused);
        CHECK(off.spawned == 0u);
        CHECK(off.despawned == 0u);

        // 2. Active but off cadence -> nothing, and again no O(n) sweep. This is 249
        //    of every 250 ticks, so it is the branch that actually runs.
        const SamosborState act = active_state(SamosborVariant::Classic, 0);
        const FogTickReport skipped = samosbor_fog_tick_at(
            reg, w, act, quiet_tr(), layer, anchor, -50, danger,
            kFogSpawnPeriodTicks + 1u);
        CHECK(!skipped.censused);
        CHECK(skipped.spawned == 0u);

        // 3. activeBegan forces the sweep onto the exact tick the fog arrives, even
        //    off cadence. Without it the first head lands up to 2 s late, which on a
        //    30 s surface samosbor is a 7% dead window.
        SamosborTransition began;
        began.changed = true;
        began.steps = 1;
        began.activeBegan = true;
        began.to = static_cast<std::uint8_t>(SamosborPhase::Active);
        const FogTickReport forced = samosbor_fog_tick_at(
            reg, w, act, began, layer, anchor, -50, danger,
            kFogSpawnPeriodTicks + 1u);
        CHECK(forced.censused);
        CHECK(forced.target == 7);                 // lerp(3,7,1.0) * classic 1.00
        // 3, not 2: the relaxed ZMinus50 roster gained SCULPTURE once
        // tools/gen_mob_table.py stopped quantizing its 0.05 authored weight to zero.
        // effCount stays 2, because minSamosbor 2 still keeps it out of the EFFECTIVE
        // roster here — the roster grew, the gate did not move.
        CHECK(forced.rosterN == 3);
        CHECK(forced.effCount == 2);
        CHECK(forced.relaxed);

        // 4. An invalid anchor is a no-op rather than a crash, so main.cpp needs no
        //    reg.valid(player) guard around the call.
        const FogTickReport noAnchor =
            samosbor_fog_tick(reg, w, act, began, layer, entt::null, -50, danger,
                              kFogSpawnPeriodTicks);
        CHECK(noAnchor.spawned == 0u);
        CHECK(!noAnchor.censused);
    }

    { // ---- test_samosbor2_below_target_spawns_at_target_does_not ------------
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        generate_floor(w, -50, spec, 11u);
        const std::uint8_t danger = danger_for_hostility(spec.hostility);
        const SamosborState act = active_state(SamosborVariant::Classic, 0);
        const LayerId layer = 0;
        const vec3 anchor = ground_pos(64, 64);
        CHECK(annulus_air(w, 64, 64) > 200);
        const std::uint8_t target = samosbor_threat_target(-50, SamosborVariant::Classic,
                                                           danger >= kFogHighRiskDanger);
        CHECK(target == 7);

        // --- AT the target: a census already holding `target` hostiles inside the
        //     outer radius must not add one more, even though the back-off itself
        //     would still allow it (7 < the high-risk hard max of 10). Demand and
        //     headroom are two separate brakes and this proves demand is wired.
        {
            Registry reg;
            for (int i = 0; i < 7; ++i) {
                Entity e = reg.create();
                Transform tr;
                // 30 m out: inside the 40 m outer radius, outside the 24 m near one,
                // so withinNear stays 0 and the near brake cannot be what refuses.
                tr.pos = vec3{anchor.x + static_cast<float>(i) * 0.1f, anchor.y + 30.0f,
                              anchor.z};
                tr.layer = layer;
                reg.emplace<Transform>(e, tr);
                reg.emplace<MobRef>(e, MobRef{0, 1, 10, 10});
            }
            const FogTickReport full = samosbor_fog_tick_at(
                reg, w, act, quiet_tr(), layer, anchor, -50, danger,
                kFogSpawnPeriodTicks);
            CHECK(full.censused);
            CHECK(full.census.withinOuter == 7);
            CHECK(full.census.withinNear == 0);
            CHECK(full.headroom > 0);          // the back-off would have allowed more
            CHECK(full.wanted == 0);           // demand is what refuses
            CHECK(full.spawned == 0u);
            CHECK(count_layer_fog_mobs(reg, layer) == 0u);
        }

        // --- BELOW the target: three hostiles at 30 m leaves demand 4 and headroom
        //     min(10-3, 4-0) = 4, so the tick spawns.
        {
            Registry reg;
            for (int i = 0; i < 3; ++i) {
                Entity e = reg.create();
                Transform tr;
                tr.pos = vec3{anchor.x + static_cast<float>(i) * 0.1f, anchor.y + 30.0f,
                              anchor.z};
                tr.layer = layer;
                reg.emplace<Transform>(e, tr);
                reg.emplace<MobRef>(e, MobRef{0, 1, 10, 10});
            }
            const FogTickReport open = samosbor_fog_tick_at(
                reg, w, act, quiet_tr(), layer, anchor, -50, danger,
                kFogSpawnPeriodTicks);
            CHECK(open.census.withinOuter == 3);
            CHECK(open.headroom == 4);
            CHECK(open.wanted == 4);
            CHECK(open.spawned > 0u);
            CHECK(open.spawned <= 4u);
            CHECK(count_layer_fog_mobs(reg, layer) == open.spawned);

            // Collected out of the view BEFORE inspecting, not inspected in place:
            // `all_of<WanderTarget>` on a registry that has never held one creates
            // that storage, and wander.cpp documents at length that creating a
            // storage mid-iteration is what dangles a live view.
            std::vector<Entity> fogHeads;
            for (auto e : reg.view<const FogSpawn>()) fogHeads.push_back(e);
            CHECK(static_cast<std::uint32_t>(fogHeads.size()) == open.spawned);

            // Every fog head is a real monster, not a bare Transform: MobCombat is
            // what mob_attack_step views on, and a head without it is a harmless
            // ghost that still renders.
            bool wholeMob = true;
            bool inAnnulus = true;
            bool steered = true;
            for (Entity e : fogHeads) {
                if (!reg.all_of<Transform, Velocity, AABB, Renderable, MobRef,
                                MobCombat>(e))
                    wholeMob = false;
                const MobRef& m = reg.get<const MobRef>(e);
                if (m.pack != 0) wholeMob = false;          // fog arrivals walk alone
                if (m.maxHp <= 0 || m.hp != m.maxHp) wholeMob = false;
                const float d = torus_dist(anchor, reg.get<const Transform>(e).pos);
                // The annulus: never inside the near radius (a monster appearing 5 m
                // away out of nothing is indistinguishable from a bug) and never
                // outside the outer one (or the census could not see it).
                if (d < kThreatNearRadiusM - 0.01f) inAnnulus = false;
                if (d > kThreatOuterRadiusM + 0.01f) inAnnulus = false;
                // A fog mob without a WanderTarget is a statue: wander_step iterates
                // view<Transform, Velocity, WanderTarget> and wander_init otherwise
                // only runs at floor load. Immobile kinds are architecture and are
                // correctly refused a destination.
                if (!has_flag(kMobTable[m.kind].aiFlags, AiFlag::Immobile) &&
                    !reg.all_of<WanderTarget>(e))
                    steered = false;
            }
            CHECK(wholeMob);
            CHECK(inAnnulus);
            CHECK(steered);
            CHECK(open.wandering >= open.spawned);

            // THE TERMINATION INVARIANT. Everything fog put on the floor is inside
            // the bubble the next census sweeps, so the budget cannot be fooled into
            // spawning forever. Break this (spawn at a fixed ground z under a flying
            // player, say) and the loop runs until the 4096-actor pool is gone.
            const ThreatCensus after = samosbor_census(reg, layer, anchor);
            CHECK(static_cast<std::uint32_t>(after.withinOuter) == 3u + open.spawned);

            // Run the cadence forward and the population CONVERGES on the target
            // rather than oscillating around it or climbing past it.
            std::uint32_t maxSeen = after.withinOuter;
            for (std::uint32_t k = 2; k <= 40; ++k) {
                const FogTickReport rep = samosbor_fog_tick_at(
                    reg, w, act, quiet_tr(), layer, anchor, -50, danger,
                    kFogSpawnPeriodTicks * k);
                if (static_cast<std::uint32_t>(rep.census.withinOuter) > maxSeen)
                    maxSeen = rep.census.withinOuter;
            }
            const ThreatCensus settled = samosbor_census(reg, layer, anchor);
            CHECK(settled.withinOuter == target);
            CHECK(maxSeen <= static_cast<std::uint32_t>(target));
            CHECK(count_layer_fog_mobs(reg, layer) ==
                  static_cast<std::uint32_t>(target) - 3u);
            // And once settled it stays settled: the next tick is a pure no-op.
            const FogTickReport quiet = samosbor_fog_tick_at(
                reg, w, act, quiet_tr(), layer, anchor, -50, danger,
                kFogSpawnPeriodTicks * 41u);
            CHECK(quiet.wanted == 0);
            CHECK(quiet.spawned == 0u);
        }
    }

    { // ---- test_samosbor2_fog_population_is_bounded_by_the_phase ------------
        // Fog mobs leave with the fog, and that is a correctness property rather
        // than flavour: the budget is LOCAL, so it stops refusing the moment the
        // player walks 40 m. At the 2 s cadence a 15-minute samosbor at |z| = 50 can
        // add on the order of 1800 heads to a floor whose authored budget is 194, and
        // nothing else in the tree would ever remove them.
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        generate_floor(w, -50, spec, 11u);
        const std::uint8_t danger = danger_for_hostility(spec.hostility);
        const LayerId layer = 0;

        Registry reg;
        rooms_declare(reg.ctx().emplace<FloorRooms>(), -50, spec, 11u);
        // A real floor population underneath, capped, so the despawn has something
        // it must NOT touch.
        const std::uint32_t floorHeads =
            spawn_floor_mobs(reg, w, -50, danger, theme_for_kind(FloorKind::Derelict),
                             layer, /*seed=*/77u, /*cap=*/24u, FloorKind::Derelict);
        CHECK(floorHeads > 0u);
        CHECK(count_layer_fog_mobs(reg, layer) == 0u);

        // Pick the anchor AFTER the floor population, somewhere the floor spawner's
        // dice left room and the geometry offers arrival cells. Without this the test
        // would be measuring where spawn_floor_mobs happened to drop a 16-head pack:
        // 24 heads over a 128^2 floor put ~1.8 of them inside the 40 m bubble on
        // average, but one clustered pack landing there would take the census to or
        // past the target and the fog budget would correctly refuse to spawn — a pass
        // condition failing for the right reason, which is the worst kind of flake.
        vec3 anchor{0.0f, 0.0f, 0.0f};
        bool haveAnchor = false;
        for (int cy = 4; cy < kMacroDim && !haveAnchor; cy += 9)
            for (int cx = 4; cx < kMacroDim && !haveAnchor; cx += 9) {
                const vec3 p = ground_pos(cx, cy);
                if (samosbor_census(reg, layer, p).withinOuter != 0) continue;
                if (annulus_air(w, cx, cy) <= 200) continue;
                anchor = p;
                haveAnchor = true;
            }
        CHECK(haveAnchor);

        const SamosborState act = active_state(SamosborVariant::Classic, 3);
        std::uint32_t added = 0;
        for (std::uint32_t k = 1; k <= 20; ++k)
            added += samosbor_fog_tick_at(reg, w, act, quiet_tr(), layer, anchor, -50,
                                          danger, kFogSpawnPeriodTicks * k)
                         .spawned;
        CHECK(added > 0u);
        CHECK(count_layer_fog_mobs(reg, layer) == added);
        CHECK(count_layer_mobs(reg, layer) == floorHeads + added);

        // activeEnded despawns the fog population and only the fog population.
        SamosborTransition ended;
        ended.changed = true;
        ended.steps = 1;
        ended.activeEnded = true;
        SamosborState after = act;
        after.phase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
        const FogTickReport cleared = samosbor_fog_tick_at(
            reg, w, after, ended, layer, anchor, -50, danger,
            kFogSpawnPeriodTicks * 21u);
        CHECK(cleared.despawned == added);
        CHECK(cleared.spawned == 0u);
        CHECK(count_layer_fog_mobs(reg, layer) == 0u);
        CHECK(count_layer_mobs(reg, layer) == floorHeads);

        // warningBegan is the safety net from the other side: a cycle can only start
        // from an empty fog population, whatever happened to the last one's
        // activeEnded (samosbor_step drops dt past four crossings, a save could be
        // loaded mid-samosbor, a ride re-arms the clock to Idle). Seed a straggler
        // and prove the next warning clears it.
        for (std::uint32_t k = 30; k <= 34; ++k)
            samosbor_fog_tick_at(reg, w, act, quiet_tr(), layer, anchor, -50, danger,
                                 kFogSpawnPeriodTicks * k);
        const std::uint32_t stragglers = count_layer_fog_mobs(reg, layer);
        CHECK(stragglers > 0u);

        SamosborTransition warned;
        warned.changed = true;
        warned.steps = 1;
        warned.warningBegan = true;
        SamosborState warning = act;
        warning.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
        const FogTickReport swept = samosbor_fog_tick_at(
            reg, w, warning, warned, layer, anchor, -50, danger,
            kFogSpawnPeriodTicks * 40u);
        CHECK(swept.despawned == stragglers);
        CHECK(swept.spawned == 0u);
        CHECK(!swept.censused);                     // Warning is not Active
        CHECK(count_layer_fog_mobs(reg, layer) == 0u);
        CHECK(count_layer_mobs(reg, layer) == floorHeads);
    }

    { // ---- test_samosbor2_unsheltered_damage_is_still_one_shot --------------
        // REGRESSION GUARD, and the most expensive mistake available in this file.
        // The reference applies the unsheltered cost exactly once per samosbor, at
        // the seal (`src/systems/samosbor.ts:1136`). balance.md reads like a per-tick
        // drain, and modelling it that way is silent: nothing crashes, the number is
        // simply four orders of magnitude too large.
        //
        // 40 minutes of sim at |z| = 50, where the duty cycle is 93.75% — so a DoT
        // would be billing on ~281,000 of the 300,000 ticks.
        SamosborRng rng{0xA5A5A5A5u};
        SamosborState st = samosbor_new_game(rng);
        std::uint32_t seals = 0;
        std::uint32_t cycles = 0;
        std::int32_t billed = 0;
        const std::uint64_t steps = static_cast<std::uint64_t>(40 * 60) *
                                    static_cast<std::uint64_t>(kSimHz);
        for (std::uint64_t i = 0; i < steps; ++i) {
            const SamosborTransition tr = samosbor_step(
                st, static_cast<std::uint32_t>(kSimStepMs), -50, rng);
            if (tr.sealed) {
                ++seals;
                // The accessor, not the raw constant: one-shot semantics and the
                // number live in the same place, which is what stops a second call
                // site from inventing its own.
                billed += samosbor_unsheltered_pressure(
                              static_cast<SamosborVariant>(st.variant))
                              .hpDamage;
            }
            if (tr.cycleEnded) ++cycles;
        }
        CHECK(cycles >= 1u);
        // One seal per cycle, plus at most the in-progress one.
        CHECK(seals >= cycles);
        CHECK(seals <= cycles + 1u);
        CHECK(billed == static_cast<std::int32_t>(seals) * kSamosborUnshelteredHp);
        // The separation. A DoT over the same 40 minutes bills
        // 0.9375 * 300000 * 4 = 1,125,000 HP.
        CHECK(billed < 100);
        CHECK(billed > 0);
        // The accessor agrees with the constants it fronts, so replacing the raw
        // constant at the call site changed nothing but the number's owner.
        const SamosborPressure p = samosbor_unsheltered_pressure(SamosborVariant::Meat);
        CHECK(p.hpDamage == kSamosborUnshelteredHp);
        CHECK(p.psiDamage == kSamosborUnshelteredPsi);
        CHECK(p.fogRadiusCells == kSamosborFogRadiusCells);
    }
}

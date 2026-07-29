// Behaviour dispatch, wave 2 — measured against a Plain mob in the same arena.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace`. `test_mob_behaviour` already pins wave 1's pure functions; this
// file exists because wave 2's claim is a different KIND of claim. "The function
// returns 1.22" is not evidence that a monster moves differently — the number has to
// survive `wander_step`'s aggro test, its stagger, its precedence between the shared
// flag and the behaviour, and its normalisation. So every block below measures a
// VELOCITY the steering pass actually wrote, and compares it against a `Plain` mob
// placed at the identical cell in the identical arena.
//
// ---------------------------------------------------------------------------
// Why the nav bake is deliberately DEGENERATE here
// ---------------------------------------------------------------------------
// `coarse` is zero-initialised and every flow byte is `kFlowNone`, which is not
// laziness about the 3.7 s bake — it is what makes the control unambiguous. With a
// real bake, a mob that is NOT chasing still gets a flow step, so "did it chase?"
// would have to be inferred from a direction and could be confused with a wander
// step that happens to point at the player. With an unreachable field, a mob that is
// not chasing takes `wander_step`'s `stuck` branch and is written EXACTLY zero. So
// `|v| > 0` means "this mob chose to chase" and nothing else can produce it.
// The real bake is exercised by test_packs_all, which is the right place for it.
//
// Speeds are asserted as a RATIO to the kind's own table speed, never as an absolute
// m/s. The kinds under test move at 0.82 to 3.15 cells/s, so an absolute assertion
// would be a copy of the CSV and would pass unchanged if the multiplier were dropped
// and the row edited. The ratio is the multiplier, which is the thing being claimed.

#include "game/hunt.h"
#include "game/mob_behaviour.h"
#include "game/mob_spawn.h"
#include "game/wander.h"
#include "world/nav.h"

namespace behaviours_detail {

// A mob's own table speed in m/s — the denominator every ratio below divides by.
inline float table_speed(MobKind k) {
    return static_cast<float>(kMobTable[static_cast<std::size_t>(k)].speedMmps) *
           0.001f * kCellSize;
}

inline float flat_speed(const Velocity& v) {
    return std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y);
}

inline bool near_eq(float a, float b, float eps = 1e-3f) {
    return std::fabs(a - b) <= eps;
}

// A mob at `pos` on `layer`, ready for wander_init. Level 1 so nothing is HP-scaled;
// the steering pass reads only kind and pack.
inline Entity spawn_at(Registry& reg, LayerId layer, MobKind k, const vec3& pos) {
    const Entity e = reg.create();
    Transform tr;
    tr.pos = pos;
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{});
    reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(k), 1, 100, 100});
    return e;
}

// Whoever holds the camera. No NpcRef, so wander_step's faction gate is never
// consulted and the mob's decision is purely about distance.
inline Entity spawn_viewer(Registry& reg, LayerId layer, const vec3& pos) {
    const Entity e = reg.create();
    Transform tr;
    tr.pos = pos;
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{});
    reg.emplace<CameraTag>(e, CameraTag{});
    return e;
}

// The first tick of a licensed hunting epoch for `mobId`.
//
// Both edges are required, not just `mob_hunts_npcs == true`: the licence is constant
// across an epoch, so landing on a tick that happens to be true says nothing about
// how many ticks remain, and a window that expires mid-run would make the crowd-prey
// blocks below flaky rather than wrong. A rising edge is the first tick of a full
// kHuntEpochTicks window. Returns 0 if no edge is found, which the caller asserts on.
inline std::uint64_t licensed_epoch_start(std::uint32_t mobId) {
    for (std::uint64_t t = 1; t < kHuntEpochTicks * 4096u; ++t)
        if (!mob_hunts_npcs(mobId, t - 1) && mob_hunts_npcs(mobId, t)) return t;
    return 0;
}

} // namespace behaviours_detail

static void test_behaviours_all() {
    using namespace behaviours_detail;

    const LayerId layer = 0;

    // One arena for every block. A MacroGrid is ~138 MiB of cell types and sub-voxel
    // masks, so building five of them to test five decisions would be the most
    // expensive thing in the suite; the blocks use fresh Registries instead and are
    // laid out so no two of them share a cell or a neighbour.
    MacroGrid grid;
    grid.fill_cell(56, 50, 1, kMatConcrete);   // the ONE wall in the arena

    nav::CoarseGraph coarse{};                 // next[i][j] == 0 for every pair
    nav::FineNav fine;
    fine.flow.assign(kMacroCells, nav::kFlowNone);   // one node's worth; hop is always 0
    CHECK(!fine.flow.empty());                       // or wander_step returns immediately
    CHECK(nav::coarse_next(coarse, 17, 42) == 0);    // the hop every mob will read

    NpcPool pool;
    pool.init();

    // Cells the blocks below rely on. Asserted rather than assumed, because a
    // MacroGrid that ever stopped defaulting to air would silently turn every "in the
    // open" measurement into an "against a wall" one and the ratios would still look
    // plausible.
    CHECK(grid.cell(56, 50, 1) != kCellAir);
    CHECK(grid.cell(55, 50, 1) == kCellAir);   // where the braced mobs stand
    CHECK(grid.cell(54, 50, 1) == kCellAir);
    CHECK(grid.cell(55, 51, 1) == kCellAir);
    CHECK(grid.cell(55, 49, 1) == kCellAir);
    CHECK(grid.cell(50, 55, 1) == kCellAir);   // where the open mobs stand
    CHECK(grid.cell(51, 55, 1) == kCellAir);
    CHECK(grid.cell(49, 55, 1) == kCellAir);
    CHECK(grid.cell(50, 56, 1) == kCellAir);
    CHECK(grid.cell(50, 54, 1) == kCellAir);

    const vec3 viewerAt{100.0f, 100.0f, 3.0f};
    const vec3 bracedAt{110.0f, 100.0f, 3.0f};   // cell 55,50,1 — wall on +x
    const vec3 openAt{100.0f, 110.0f, 3.0f};     // cell 50,55,1 — air on all four

    // Both test cells are 10 m from the viewer along one axis. Axis-aligned on
    // purpose: the chase vector then normalises to exactly 1.0 and the ratios below
    // carry no diagonal rounding, so a 2% multiplier (Панельник's 1.02) is still
    // four orders of magnitude clear of the epsilon.
    CHECK(near_eq(bracedAt.x - viewerAt.x, 10.0f));
    CHECK(near_eq(openAt.y - viewerAt.y, 10.0f));

    // ---- 1. the table and the code agree on who carries what ---------------
    // Every block below names a kind and asserts a behaviour's effect. If the CSV
    // moved a behaviour to another row, those blocks would keep passing while
    // measuring nothing, so the mapping is pinned first.
    {
        const MobDef& rebar = mob_def(MobKind::Rebar);
        CHECK(rebar.behaviour == static_cast<std::uint8_t>(MobBehaviour::DebrisLurker));
        // Арматура carries BOTH, which is the whole reason `MoveMult::claimed` exists.
        CHECK(has_flag(rebar.aiFlags, AiFlag::WallBias));

        const MobDef& panelnik = mob_def(MobKind::Panelnik);
        CHECK(panelnik.behaviour == static_cast<std::uint8_t>(MobBehaviour::WallBrace));
        // ...and Панельник carries NEITHER shared wall flag, so before wave 2 it got
        // exactly x1.0 in both states.
        CHECK(!has_flag(panelnik.aiFlags, AiFlag::WallBias));
        // Its authored reach is the reference's PANELNIK_OPEN_REACH (1.16 cells), not
        // the generic 1.2 that 66 of 69 kinds carry — i.e. the generated row is
        // specifically the UNBRACED state, and the braced 1.75 has nowhere to live
        // until combat can see the grid. Pinned so that finding cannot be lost.
        CHECK(panelnik.meleeReachMm == 1160);
        CHECK(mob_def(MobKind::Sborka).meleeReachMm == 1200);

        const MobDef& carpet = mob_def(MobKind::SporeCarpet);
        CHECK(carpet.behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::LurkingFurniture));
        // Not Immobile: speed 0.82, so it really does appear in wander_step's view and
        // "it did not move" is a decision rather than a missing component.
        CHECK(!has_flag(carpet.aiFlags, AiFlag::Immobile));
        CHECK(carpet.speedMmps == 820);

        // Тварь is a PLAIN kind that carries WallBias — the control that separates
        // "the behaviour took precedence" from "the flag stopped working".
        const MobDef& tvar = mob_def(MobKind::Tvar);
        CHECK(tvar.behaviour == static_cast<std::uint8_t>(MobBehaviour::Plain));
        CHECK(has_flag(tvar.aiFlags, AiFlag::WallBias));

        // The radius kinds, and that they are mobile enough to observe.
        CHECK(mob_def(MobKind::Pechateed).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::DocumentHunter));
        CHECK(mob_def(MobKind::Kontorshchik).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::DocumentScent));
        CHECK(mob_def(MobKind::Protokolnik).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::ProtocolPressure));
        CHECK(mob_def(MobKind::Lishennyy).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::LightFollower));
        CHECK(mob_def(MobKind::PomoynyRoy).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::GarbageSurround));
        CHECK(mob_def(MobKind::Sborka).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::Plain));

        // The three radii that are correct and unobservable, stated as a fact about
        // the DATA rather than as a caveat in a comment: all three sit on speed-0
        // rows, so wander_init skips them and no velocity test can reach them.
        CHECK(has_flag(mob_def(MobKind::KantselyarskiyIdol).aiFlags, AiFlag::Immobile));
        CHECK(has_flag(mob_def(MobKind::Borshchevik).aiFlags, AiFlag::Immobile));
        CHECK(has_flag(mob_def(MobKind::BloodPlant).aiFlags, AiFlag::Immobile));
    }

    // ---- 2. the dead list cannot disagree with the dispatchers --------------
    // This is what "wire behaviour_is_dead" means here: it had no caller outside a
    // test that compared it against a hand-written list of the same four names, so it
    // could not be wrong out loud. Now the declared classification is checked against
    // what the four dispatchers ACTUALLY return, for all 47 enumerators.
    {
        std::size_t answered = 0, dead = 0, neither = 0;
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);

            // "Answered" = at least one function in mob_behaviour.h returns something
            // other than what a Plain mob would get. Measured, not declared.
            const PursuitOffset off = pursuit_offset(b, 42u, 7u, 1.0f, 0.0f);
            const bool steers = (off.x != 0.0f || off.y != 0.0f);
            const bool sees = (behaviour_aggro_radius(b, kAggroRadius) != kAggroRadius);
            const bool freezes = frozen_by_gaze(b, 1.0f, 0.0f, 1.0f, 0.0f);
            const bool paces = behaviour_move_mult(b, true).claimed ||
                               behaviour_move_mult(b, false).claimed;
            const bool hits = behaviour_damage_mult(b, true) != 1.0f ||
                              behaviour_damage_mult(b, false) != 1.0f;
            const bool any = steers || sees || freezes || paces || hits;

            // The declared list must be exactly the measured one. This is the
            // assertion that fails if someone adds a case to a dispatcher and forgets
            // the roadmap, or edits the roadmap without adding the case.
            CHECK(behaviour_is_dispatched(b) == any);
            // ...and nothing on the dead list may be answered by anything.
            if (behaviour_is_dead(b)) CHECK(!any);

            if (behaviour_is_dead(b)) ++dead;
            else if (any) ++answered;
            else ++neither;
        }
        std::fprintf(stderr,
                     "[behaviours] of %zu enumerators: %zu answered, %zu dead, "
                     "%zu authored-and-blocked\n",
                     static_cast<std::size_t>(MobBehaviour::Count), answered, dead,
                     neither);
        // Hard counts, not ">= 1". Wave 1 answered 5 and left 42 reading as Plain;
        // wave 2 answers 15. A future wave that lands a behaviour must move these
        // numbers deliberately rather than drift past them.
        static_assert(static_cast<std::size_t>(MobBehaviour::Count) == 47u);
        CHECK(answered == 15u);
        CHECK(dead == 4u);
        CHECK(neither == 28u);   // 27 blocked, plus Plain itself
        // Plain is not "answered" by anything and is not dead: it IS the default.
        CHECK(!behaviour_is_dispatched(MobBehaviour::Plain));
        CHECK(!behaviour_is_dead(MobBehaviour::Plain));

        // SourceSwarm stays dead for a reason that can now be checked in one line:
        // the reference's only mechanical reader hands it SWARM_DETECT_SQ = 20*20,
        // and MONSTER_DETECT is 20. So a case for it here would return the default by
        // a longer route and make a dead behaviour look implemented.
        CHECK(behaviour_aggro_radius(MobBehaviour::SourceSwarm, kAggroRadius) ==
              kAggroRadius);
        CHECK(behaviour_is_dead(MobBehaviour::SourceSwarm));

        // The eight new radii, exactly. Cheap to assert and the only place the ported
        // constants are compared against anything.
        CHECK(behaviour_aggro_radius(MobBehaviour::LurkingFurniture, 20.0f) == 2.15f);
        CHECK(behaviour_aggro_radius(MobBehaviour::RootedPlant, 20.0f) == 7.5f);
        CHECK(behaviour_aggro_radius(MobBehaviour::RootHive, 20.0f) == 8.25f);
        CHECK(behaviour_aggro_radius(MobBehaviour::GarbageSurround, 20.0f) == 13.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::OfficeField, 20.0f) == 23.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::DocumentHunter, 20.0f) == 24.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::ProtocolPressure, 20.0f) == 26.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::DocumentScent, 20.0f) == 28.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::LightFollower, 20.0f) == 30.0f);
        // Wave 1's two are untouched.
        CHECK(behaviour_aggro_radius(MobBehaviour::DeadEcho, 20.0f) == 7.5f);
        CHECK(behaviour_aggro_radius(MobBehaviour::CloseReveal, 20.0f) == 6.0f);

        // The pace pair, and that a behaviour without one does not claim.
        CHECK(behaviour_move_mult(MobBehaviour::DebrisLurker, true).claimed);
        CHECK(behaviour_move_mult(MobBehaviour::DebrisLurker, true).mult == 1.22f);
        CHECK(behaviour_move_mult(MobBehaviour::DebrisLurker, false).mult == 0.68f);
        CHECK(behaviour_move_mult(MobBehaviour::WallBrace, true).mult == 1.02f);
        CHECK(behaviour_move_mult(MobBehaviour::WallBrace, false).mult == 0.90f);
        CHECK(!behaviour_move_mult(MobBehaviour::Plain, true).claimed);
        CHECK(behaviour_move_mult(MobBehaviour::Plain, true).mult == 1.0f);
        CHECK(behaviour_damage_mult(MobBehaviour::DebrisLurker, true) == 1.25f);
        CHECK(behaviour_damage_mult(MobBehaviour::DebrisLurker, false) == 0.75f);
        CHECK(behaviour_damage_mult(MobBehaviour::Plain, true) == 1.0f);

        // The gate: 5 of 69 kinds, and it is the flag OR the behaviour.
        const std::uint32_t wb = static_cast<std::uint32_t>(AiFlag::WallBias);
        CHECK(wall_query_needed(wb, MobBehaviour::Plain));
        CHECK(wall_query_needed(0u, MobBehaviour::DebrisLurker));
        CHECK(wall_query_needed(0u, MobBehaviour::WallBrace));
        CHECK(!wall_query_needed(0u, MobBehaviour::Plain));
        std::size_t queried = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k)
            if (wall_query_needed(kMobTable[k].aiFlags,
                                  static_cast<MobBehaviour>(kMobTable[k].behaviour)))
                ++queried;
        std::fprintf(stderr, "[behaviours] wall query: %zu of %zu kinds\n", queried,
                     kMobKindCount);
        CHECK(queried == 5u);   // Тварь, Шовник, Арматура, Бетоноед + Панельник
    }

    // ---- 3. WallBrace: Панельник's pace, against Plain at the same cell -----
    {
        Registry reg;
        spawn_viewer(reg, layer, viewerAt);
        const Entity bracedPan = spawn_at(reg, layer, MobKind::Panelnik, bracedAt);
        const Entity openPan = spawn_at(reg, layer, MobKind::Panelnik, openAt);
        const Entity bracedPlain = spawn_at(reg, layer, MobKind::Sborka, bracedAt);
        const Entity openPlain = spawn_at(reg, layer, MobKind::Sborka, openAt);
        CHECK(wander_init(reg, layer, 5u) == 4u);   // the viewer is skipped

        // Exactly kWanderPeriod ticks, so every mob is visited exactly once by the
        // identity-hash stagger and the velocity read below is that single visit.
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, pool, coarse, fine, layer, t);

        const float panSp = table_speed(MobKind::Panelnik);
        const float plainSp = table_speed(MobKind::Sborka);
        const float bracedRatio = flat_speed(reg.get<const Velocity>(bracedPan)) / panSp;
        const float openRatio = flat_speed(reg.get<const Velocity>(openPan)) / panSp;
        const float bracedPlainRatio =
            flat_speed(reg.get<const Velocity>(bracedPlain)) / plainSp;
        const float openPlainRatio =
            flat_speed(reg.get<const Velocity>(openPlain)) / plainSp;
        std::fprintf(stderr,
                     "[behaviours] WallBrace: braced x%.4f open x%.4f | Plain at the "
                     "same two cells x%.4f / x%.4f\n",
                     bracedRatio, openRatio, bracedPlainRatio, openPlainRatio);

        // THE claim: a Панельник moves at 1.02 of its table speed against a wall and
        // 0.90 in the open, where a Plain mob standing in the same two cells moves at
        // exactly 1.0 in both.
        CHECK(near_eq(bracedRatio, kWallBraceSpeed));
        CHECK(near_eq(openRatio, kWallBraceOpenSpeed));
        CHECK(near_eq(bracedPlainRatio, 1.0f));
        CHECK(near_eq(openPlainRatio, 1.0f));
        // And the two states are genuinely apart, which "x1.02" alone would not say if
        // the wall query were stuck returning one answer.
        CHECK(bracedRatio > openRatio * 1.1f);
        // Both are chasing at all — a zero here would make every ratio above 0/sp.
        CHECK(flat_speed(reg.get<const Velocity>(bracedPan)) > 0.0f);
        CHECK(flat_speed(reg.get<const Velocity>(openPan)) > 0.0f);
    }

    // ---- 4. DebrisLurker: precedence over the flag it also carries ----------
    {
        Registry reg;
        spawn_viewer(reg, layer, viewerAt);
        const Entity coverRebar = spawn_at(reg, layer, MobKind::Rebar, bracedAt);
        const Entity openRebar = spawn_at(reg, layer, MobKind::Rebar, openAt);
        // Тварь: Plain behaviour, WallBias flag. Same query, the flag's own numbers.
        const Entity coverTvar = spawn_at(reg, layer, MobKind::Tvar, bracedAt);
        const Entity openTvar = spawn_at(reg, layer, MobKind::Tvar, openAt);
        CHECK(wander_init(reg, layer, 6u) == 4u);

        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, pool, coarse, fine, layer, t);

        const float rSp = table_speed(MobKind::Rebar);
        const float tSp = table_speed(MobKind::Tvar);
        const float coverR = flat_speed(reg.get<const Velocity>(coverRebar)) / rSp;
        const float openR = flat_speed(reg.get<const Velocity>(openRebar)) / rSp;
        const float coverT = flat_speed(reg.get<const Velocity>(coverTvar)) / tSp;
        const float openT = flat_speed(reg.get<const Velocity>(openTvar)) / tSp;
        std::fprintf(stderr,
                     "[behaviours] DebrisLurker: cover x%.4f open x%.4f | WallBias-only "
                     "Plain kind at the same cells x%.4f / x%.4f\n",
                     coverR, openR, coverT, openT);

        // The behaviour's numbers, not the flag's, for a kind that carries both.
        CHECK(near_eq(coverR, kDebrisCoverSpeed));
        CHECK(near_eq(openR, kDebrisOpenSpeed));
        // NOT the product (1.22 * 1.18 = 1.4396) and NOT the flag's value. This is the
        // assertion that catches the mistake the `claimed` flag exists to prevent, and
        // it is worth stating as a separate CHECK because 1.22 and 1.4396 are both
        // plausible-looking numbers in a log line.
        CHECK(!near_eq(coverR, kWallBiasSpeedNear, 0.01f));
        CHECK(!near_eq(coverR, kDebrisCoverSpeed * kWallBiasSpeedNear, 0.01f));
        CHECK(!near_eq(openR, kWallBiasSpeedOpen, 0.01f));
        // ...and the flag path is UNCHANGED for the four kinds that only carry it.
        CHECK(near_eq(coverT, kWallBiasSpeedNear));
        CHECK(near_eq(openT, kWallBiasSpeedOpen));
        // The spread is the point of the kind: 1.22 vs 0.68 is a 1.79x swing on where
        // it is standing, against the flag's 1.28x.
        CHECK(coverR / openR > coverT / openT * 1.3f);
    }

    // ---- 5. LurkingFurniture: the carpet you can walk past ------------------
    {
        Registry reg;
        spawn_viewer(reg, layer, viewerAt);
        // 5 m away: inside every other kind's 20 m and outside the carpet's 2.15 m.
        const vec3 fiveM{105.0f, 100.0f, 3.0f};
        const Entity carpet = spawn_at(reg, layer, MobKind::SporeCarpet, fiveM);
        const Entity plain = spawn_at(reg, layer, MobKind::Sborka, fiveM);
        CHECK(wander_init(reg, layer, 7u) == 2u);

        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, pool, coarse, fine, layer, t);

        const float carpetV = flat_speed(reg.get<const Velocity>(carpet));
        const float plainV = flat_speed(reg.get<const Velocity>(plain));
        std::fprintf(stderr,
                     "[behaviours] LurkingFurniture at 5 m: carpet |v| = %.4f m/s, "
                     "Plain |v| = %.4f m/s\n",
                     carpetV, plainV);
        // The whole mechanic, in two lines: same arena, same cell, same distance.
        CHECK(plainV > 0.0f);
        CHECK(carpetV == 0.0f);
        CHECK(near_eq(plainV / table_speed(MobKind::Sborka), 1.0f));

        // It is a trap, not a statue: step inside 2.15 m and it comes for you. Without
        // this the block would also pass for a carpet that never moves at all.
        reg.get<Transform>(carpet).pos = vec3{101.5f, 100.0f, 3.0f};
        reg.get<Velocity>(carpet).v = vec3{0, 0, 0};
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, pool, coarse, fine, layer, t);
        const float wokenV = flat_speed(reg.get<const Velocity>(carpet));
        std::fprintf(stderr, "[behaviours] ...and at 1.5 m: |v| = %.4f m/s\n", wokenV);
        CHECK(wokenV > 0.0f);
        CHECK(near_eq(wokenV / table_speed(MobKind::SporeCarpet), 1.0f));
    }

    // ---- 6. the prey scan is clamped to the mob's OWN sight radius ----------
    // [hunt.h] rule 1 is "the player outranks the crowd", justified by kHuntRadius (6)
    // never exceeding the smallest behaviour radius. LurkingFurniture's 2.15 is the
    // first value that breaks that, so `wander_step` now clamps the prey scan.
    //
    // Tested with NO camera holder, so the only path that can move a mob is the crowd
    // prey scan and the clamp is isolated from the player-aggro test. A resident sits
    // at 5 m: inside kHuntRadius, outside 2.15. Unclamped, both mobs would take it.
    {
        Registry reg;
        NpcPool crowd;
        crowd.init();
        const NpcId local = crowd.spawn();
        crowd.hp(local) = 100;
        crowd.max_hp(local) = 100;
        crowd.faction(local) = static_cast<std::uint16_t>(Faction::Citizens);
        // The prey gate is `mob_hostile_to`, resolved from the BODY's row. If Citizens
        // ever stopped being prey this block would pass vacuously.
        CHECK(mob_hostile_to(crowd, local));

        Entity resident = reg.create();
        Transform rt;
        rt.pos = vec3{105.0f, 100.0f, 3.0f};
        rt.layer = layer;
        reg.emplace<Transform>(resident, rt);
        reg.emplace<Velocity>(resident, Velocity{});
        reg.emplace<NpcRef>(resident, NpcRef{local});

        const vec3 hunterAt{100.0f, 100.0f, 3.0f};
        const Entity carpet = spawn_at(reg, layer, MobKind::SporeCarpet, hunterAt);
        const Entity plain = spawn_at(reg, layer, MobKind::Sborka, hunterAt);
        CHECK(wander_init(reg, layer, 8u) == 3u);   // the resident wanders too

        const std::uint32_t carpetId =
            static_cast<std::uint32_t>(entt::to_integral(carpet));
        const std::uint32_t plainId =
            static_cast<std::uint32_t>(entt::to_integral(plain));

        // Each mob is measured inside ITS OWN licensed window: only ~1 in kHuntShare
        // (32) holds a licence in any given epoch, so a shared window would measure
        // "unlicensed" and call it "clamped".
        const std::uint64_t plainWindow = licensed_epoch_start(plainId);
        const std::uint64_t carpetWindow = licensed_epoch_start(carpetId);
        CHECK(plainWindow != 0u);
        CHECK(carpetWindow != 0u);
        CHECK(mob_hunts_npcs(plainId, plainWindow + kWanderPeriod - 1));
        CHECK(mob_hunts_npcs(carpetId, carpetWindow + kWanderPeriod - 1));

        reg.get<Velocity>(plain).v = vec3{0, 0, 0};
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, crowd, coarse, fine, layer, plainWindow + t);
        const float plainV = flat_speed(reg.get<const Velocity>(plain));

        reg.get<Velocity>(carpet).v = vec3{0, 0, 0};
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, crowd, coarse, fine, layer, carpetWindow + t);
        const float carpetV = flat_speed(reg.get<const Velocity>(carpet));

        std::fprintf(stderr,
                     "[behaviours] prey clamp, resident at 5 m and no viewer: Plain "
                     "|v| = %.4f m/s, carpet |v| = %.4f m/s (kHuntRadius %.1f, carpet "
                     "radius %.2f)\n",
                     plainV, carpetV, kHuntRadius,
                     behaviour_aggro_radius(MobBehaviour::LurkingFurniture,
                                            kAggroRadius));
        // A Plain mob eats the local. The carpet does not see it, so it does not.
        CHECK(plainV > 0.0f);
        CHECK(carpetV == 0.0f);
        // The clamp is `min`, not a replacement: a kind that sees FURTHER than
        // kHuntRadius must still be limited to kHuntRadius, or predation range would
        // silently become 30 m for Лишенный.
        CHECK(behaviour_aggro_radius(MobBehaviour::LightFollower, kAggroRadius) >
              kHuntRadius);
    }

    // ---- 7. the eight radii, observed through wander_step -------------------
    // Each kind is placed at a distance that its OWN radius covers and the flat 20 m
    // does not (or, for Помойный Рой, the other way round), with a Plain mob at the
    // identical distance as the control. All along +x from the viewer, in cells that
    // share no neighbour with the arena's one wall.
    {
        struct Case {
            MobKind kind;
            float dist;
            bool shouldChase;
            const char* why;
        };
        const Case cases[] = {
            // Notice you EARLIER than 20 m. A Plain mob at the same distance does not.
            {MobKind::Pechateed, 22.0f, true, "DocumentHunter 24 m"},
            {MobKind::Protokolnik, 24.0f, true, "ProtocolPressure 26 m"},
            {MobKind::Kontorshchik, 26.0f, true, "DocumentScent 28 m"},
            {MobKind::Lishennyy, 28.0f, true, "LightFollower 30 m"},
            // Notice you LATER. A Plain mob at 16 m chases; Помойный Рой does not.
            {MobKind::PomoynyRoy, 16.0f, false, "GarbageSurround 13 m"},
        };

        for (const Case& c : cases) {
            Registry reg;
            spawn_viewer(reg, layer, viewerAt);
            const vec3 at{viewerAt.x + c.dist, viewerAt.y, viewerAt.z};
            const Entity subject = spawn_at(reg, layer, c.kind, at);
            const Entity control = spawn_at(reg, layer, MobKind::Sborka, at);
            CHECK(wander_init(reg, layer, 9u) == 2u);

            for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
                wander_step(reg, grid, pool, coarse, fine, layer, t);

            const float sv = flat_speed(reg.get<const Velocity>(subject));
            const float cv = flat_speed(reg.get<const Velocity>(control));
            std::fprintf(stderr,
                         "[behaviours] %-24s at %.0f m: |v| = %.3f, Plain control "
                         "|v| = %.3f\n",
                         c.why, c.dist, sv, cv);
            // The subject and the control must DISAGREE. Asserting only the subject
            // would pass for a change that moved kAggroRadius instead.
            CHECK((sv > 0.0f) == c.shouldChase);
            CHECK((cv > 0.0f) == !c.shouldChase);
        }
    }
}

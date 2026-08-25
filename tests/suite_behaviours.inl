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
    reg.emplace<MobCombat>(e, MobCombat{0, 0});
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

// §60: проба «стена рядом» (WallBias-урон, прижимной шаг) отвечает АТОМАМИ
// через закон клиренса, а не типом клетки. Оба края расхождения со снесённым
// дублем grid.cell != kCellAir испытаны: лепленая панель в «воздушной» клетке
// ВИДНА, колонна в дальней половине типизированной клетки — НЕ стена вплотную.
static void test_wall_probe(MacroGrid& grid) {
    // Клетка (50,50,50) далеко от арены блоков ниже (те живут у (100,110)).
    const vec3 at{101.0f, 101.0f, 101.0f}; // центр клетки (50,50,50)
    CHECK(!body_wall_adjacent(grid, at)); // пустота — стен нет

    // Панель в один субвоксель у ближней грани соседа +x. Тип клетки НЕ
    // ставится — по старому закону она «воздух» и стены не было вовсе.
    for (int sy = 0; sy < kSubDim; ++sy)
        for (int sz = 0; sz < kSubDim; ++sz)
            grid.mask(51, 50, 50).set(sub_bit(0, sy, sz));
    CHECK(body_wall_adjacent(grid, at));
    grid.mask(51, 50, 50).clear_all();

    // Колонна в ДАЛЬНЕЙ половине типизированной клетки-соседа: старый закон
    // читал тип и кричал «стена», хотя до материи 1.5 м и тело проходит.
    grid.set_cell(51, 50, 50, kMatConcrete);
    for (int sy = 0; sy < kSubDim; ++sy)
        for (int sz = 0; sz < kSubDim; ++sz) {
            grid.mask(51, 50, 50).set(sub_bit(6, sy, sz));
            grid.mask(51, 50, 50).set(sub_bit(7, sy, sz));
        }
    CHECK(!body_wall_adjacent(grid, at));
    grid.mask(51, 50, 50).clear_all();
    grid.set_cell(51, 50, 50, kCellAir);
    std::printf("[behaviours] проба стены: панель видна, дальняя колонна — нет\n");
}

static void test_behaviours_all() {
    using namespace behaviours_detail;

    const LayerId layer = 0;

    // One arena for every block. A MacroGrid is ~138 MiB of cell types and sub-voxel
    // masks, so building five of them to test five decisions would be the most
    // expensive thing in the suite; the blocks use fresh Registries instead and are
    // laid out so no two of them share a cell or a neighbour.
    MacroGrid grid;
    grid.fill_cell(56, 50, 1, kMatConcrete);   // the ONE wall in the arena

    test_wall_probe(grid); // прибирает за собой — арена блоков не задета

    nav::CoarseGraph coarse{};                 // next[i][j] == 0 for every pair
    nav::FineNav fine;
    fine.flow.assign(kMacroCells, nav::kFlowNone);   // one node's worth; hop is always 0
    // `nearest` is baked whenever `flow` is ([nav.h] bake_fine) — a hand-built
    // fixture must honour the same invariant or nearest_node() indexes nothing.
    fine.nearest.assign(kMacroCells, nav::kFlowNone);
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

        // Wave 3's four carriers, and that each is mobile enough to observe.
        const MobDef& tresk = mob_def(MobKind::Treskotnik);
        CHECK(tresk.behaviour == static_cast<std::uint8_t>(MobBehaviour::FractureSprint));
        CHECK(!has_flag(tresk.aiFlags, AiFlag::Immobile));
        // Its authored speed is what makes the reference's `max(speed*3.25, 7.5)` floor
        // dead arithmetic — 2.75 * 3.25 = 8.9375 cells/s clears 7.5, so the floor is not
        // ported. Pinned so a CSV retune below 2.31 cells/s surfaces here rather than
        // silently making a Трескотник sprint slower than the reference allows.
        CHECK(tresk.speedMmps == 2750);
        CHECK(static_cast<float>(tresk.speedMmps) * 0.001f * kFractureSprintMult > 7.5f);
        // It also carries no wall flag and is not a wall behaviour, so the burst
        // multiplier and the wall-adjacency pace can never both apply to it.
        CHECK(!has_flag(tresk.aiFlags, AiFlag::WallBias));
        CHECK(!wall_query_needed(tresk.aiFlags,
                                 static_cast<MobBehaviour>(tresk.behaviour)));

        const MobDef& paup = mob_def(MobKind::Paupsina);
        CHECK(paup.behaviour == static_cast<std::uint8_t>(MobBehaviour::WebSpitter));
        CHECK(!has_flag(paup.aiFlags, AiFlag::Immobile));
        // THE reason the standoff matters: the only row of 69 with zero damage, whose
        // shot has a dead zone it was walking straight into. Both halves pinned — a
        // future CSV that gave it damage would change what the behaviour is for.
        CHECK(paup.dmg == 0);
        CHECK(paup.minRangeMm == 3400);          // PAUPSINA_WEB_MIN_RANGE
        CHECK(paup.shotRangeMm == 11500);        // PAUPSINA_WEB_SHOT_RANGE
        // The standoff must sit between the dead zone and the shot range or the kind
        // holds a distance from which it cannot shoot — the one thing that would make
        // 7.25 the wrong number rather than merely a tuned one.
        //
        // A UNIT CAVEAT worth stating exactly once, because it is not this lane's to
        // fix and it changes what these two lines mean. Table ranges are authored in
        // CELLS and combat.cpp converts them through kCellSize (`minRangeMm * 0.001 *
        // kCellSize` = 6.8 m); the ported detect/standoff radii in [mob_behaviour.h] do
        // NOT convert — `kAggroRadius = 20.0f` metres comes straight off the
        // reference's `MONSTER_DETECT = 20` TILES, so every radius in that file is half
        // the authored world distance. The band below is asserted in engine metres,
        // which is the stricter of the two readings: 6.8 < 7.25 < 23.0 holds there, and
        // 3.4 < 7.25 < 11.5 holds in the reference's own units, so the standoff is
        // inside the usable band either way and the caveat cannot silently invalidate
        // it. See the report on kAggroRadius.
        CHECK(kWebStandoff > static_cast<float>(paup.minRangeMm) * 0.001f * kCellSize);
        CHECK(kWebStandoff < static_cast<float>(paup.shotRangeMm) * 0.001f * kCellSize);

        CHECK(mob_def(MobKind::Olgoy).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::MeatWorm));
        CHECK(!has_flag(mob_def(MobKind::Olgoy).aiFlags, AiFlag::Immobile));
        CHECK(mob_def(MobKind::LozhnyyDukh).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::FalsePhase));
        CHECK(!has_flag(mob_def(MobKind::LozhnyyDukh).aiFlags, AiFlag::Immobile));

        // Безэхий, for the facing-damage block. Its 9 damage and 7.5 m sight are what
        // make x1.55-from-behind the entire kind rather than a bonus.
        const MobDef& bez = mob_def(MobKind::Bezekhiy);
        CHECK(bez.behaviour == static_cast<std::uint8_t>(MobBehaviour::DeadEcho));
        CHECK(bez.dmg == 9);

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
            // Wave 3's two. `faces` is probed from BOTH sides because 0.72 and 1.55
            // both differ from 1.0, so either alone would be enough and neither alone
            // would catch a branch that stopped varying.
            const bool faces =
                facing_damage_mult(b, 1.0f, 0.0f, -1.0f, 0.0f) != 1.0f ||
                facing_damage_mult(b, 1.0f, 0.0f, 1.0f, 0.0f) != 1.0f;
            const bool bursts = burst_phase(b, 42u, 0u, 1.0f) != BurstPhase::Idle;
            // Wave 4's three. `reaches` is probed against a base the override must
            // differ from, so it cannot be satisfied by the pass-through branch;
            // `hurts` is probed with hp < maxHp AND hp == maxHp for the same reason
            // `faces` is probed from both sides.
            const bool reaches = behaviour_melee_reach(b, 1200u, true) !=
                                     behaviour_melee_reach(b, 1200u, false);
            const bool soaks = behaviour_incoming_mult(b, true) != 1.0f ||
                               behaviour_incoming_mult(b, false) != 1.0f;
            const bool hurts = behaviour_hurt_move_mult(b, 50, 100) != 1.0f ||
                               behaviour_hurt_move_mult(b, 100, 100) != 1.0f;
            const bool any = steers || sees || freezes || paces || hits || faces ||
                             bursts || reaches || soaks || hurts;

            // The declared list must be exactly the measured one. This is the
            // assertion that fails if someone adds a case to a dispatcher and forgets
            // the roadmap, or edits the roadmap without adding the case.
            CHECK(behaviour_is_dispatched(b) == any);
            // ...and nothing on the dead list may be answered by anything.
            if (behaviour_is_dead(b)) CHECK(!any);

            // "Answered" is not "reaches the player", and this is the assertion that
            // keeps the two from drifting apart silently. Four of the ten hooks above
            // have a caller in src/ today: `behaviour_aggro_radius` (wander_step AND
            // investigate_step), `pursuit_offset`, `frozen_by_gaze` and
            // `behaviour_move_mult` (all wander_step). SIX DO NOT —
            // `behaviour_damage_mult` has had zero callers since wave 2, wave 3's
            // `facing_damage_mult` / `burst_damage_mult` / `burst_speed_mult` join it,
            // and so do wave 4's `behaviour_melee_reach` / `behaviour_incoming_mult` /
            // `behaviour_hurt_move_mult`. combat.cpp applies `wall_bias_damage` and
            // nothing else; wander_step applies the pace pair and nothing else.
            //
            // Wave 3 asserted this as "no behaviour is answered ONLY by an unwired
            // function", which held because every answered enumerator also had a live
            // radius or pace. CrowdShove breaks that: `behaviour_hurt_move_mult` is its
            // only answer. So the assertion becomes a NAMED SET rather than a blanket
            // ban — the honest form, because it still fails the moment a SECOND
            // behaviour lands with no reachable half, and it fails again (loudly, here)
            // the day CrowdShove is wired and stops belonging in the set.
            const bool reachable = steers || sees || freezes || paces;
            const bool unreachableOnly = any && !reachable;
            CHECK(unreachableOnly == (b == MobBehaviour::CrowdShove));

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
        // wave 2 answers 15; wave 3 answers 19; wave 4 answers 20. A future wave that
        // lands a behaviour must move these numbers deliberately rather than drift past
        // them.
        //
        // Wave 4 moves the count by ONE and adds three dispatchers, which is not a
        // contradiction and is the reason this file counts ENUMERATORS rather than
        // functions: two of the three answer for WallBrace, which wave 2 already
        // counted for its pace. Depth does not move this number; breadth does.
        static_assert(static_cast<std::size_t>(MobBehaviour::Count) == 47u);
        CHECK(answered == 20u);
        CHECK(dead == 4u);
        CHECK(neither == 23u);   // 22 blocked, plus Plain itself
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
        // Wave 3's three, which came from the reference's SECOND detect site rather
        // than from `monsterDetectSq` — see the wave 3 note in [mob_behaviour.h].
        CHECK(behaviour_aggro_radius(MobBehaviour::FractureSprint, 20.0f) == 18.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::MeatWorm, 20.0f) == 24.0f);
        CHECK(behaviour_aggro_radius(MobBehaviour::FalsePhase, 20.0f) == 24.0f);
        // FractureSprint SHRINKS, like GarbageSurround did. Asserted as a relation and
        // not just as a value, because "18" alone would still read as correct if
        // kAggroRadius were ever tuned below it and the kind quietly became a
        // long-sighted one.
        CHECK(behaviour_aggro_radius(MobBehaviour::FractureSprint, kAggroRadius) <
              kAggroRadius);

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

        // The DAMAGE claim, wave 4's counterpart to `MoveMult::claimed`. Checked against
        // what `behaviour_damage_mult` actually returns, for all 47, so a case added to
        // one and not the other fails here rather than in the game as a compounded
        // multiplier.
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            const bool varies = behaviour_damage_mult(b, true) != 1.0f ||
                                behaviour_damage_mult(b, false) != 1.0f;
            CHECK(behaviour_claims_damage(b) == varies);
        }
        // THE number the claim exists to prevent, spelled out because 1.25 and 1.5 are
        // both plausible in a log line: Арматура carries DebrisLurker AND the WallBias
        // flag, so a caller that applied both would give it 1.5 in cover where the
        // reference gives 1.25.
        CHECK(near_eq(kDebrisCoverDamage * kWallBiasDamage, 1.5f));
        CHECK(!near_eq(kDebrisCoverDamage, kDebrisCoverDamage * kWallBiasDamage, 0.01f));
        CHECK(behaviour_claims_damage(MobBehaviour::DebrisLurker));
        // ...and the pace and the damage claims agree about WHO claims, which is the
        // invariant that keeps the two precedence rules from diverging: exactly the
        // behaviours that own the pace may own the damage, and DebrisLurker is the one
        // that owns both. WallBrace owns the pace and has no outgoing multiplier at all.
        CHECK(!behaviour_claims_damage(MobBehaviour::WallBrace));
        CHECK(behaviour_move_mult(MobBehaviour::WallBrace, true).claimed);
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            if (!behaviour_claims_damage(b)) continue;
            // A behaviour may not claim the damage without also claiming the pace: the
            // caller reaches both through the same `wall_query_needed` gate, so a
            // damage-only claimant would be queried for a wall it never uses.
            CHECK(behaviour_move_mult(b, true).claimed);
            CHECK(wall_query_needed(0u, b));
        }

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
        //
        // THESE TWO ASSERT A KNOWN DIVERGENCE FROM THE REFERENCE, pinned deliberately
        // rather than left to be rediscovered. `monsterMoveMult` has a TVAR case,
        // `adjacentWall ? 1.12 : 0.96`, and it returns BEFORE the `wallBias` branch — so
        // the reference never hands Тварь the 1.18 / 0.92 measured here. It is not
        // fixable from mob_behaviour.cpp: `wall_bias_speed` takes flags, the override is
        // keyed on the KIND, and Тварь's behaviour column is `Plain`. Spawn weight 6.2,
        // the second-highest row in the catalog. Asserted as the CURRENT behaviour so
        // the day someone routes the kind through here, this fails and points at the
        // reason instead of at a mystery.
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
            // Wave 3. Two more that notice you earlier...
            {MobKind::Olgoy, 22.0f, true, "MeatWorm 24 m"},
            {MobKind::LozhnyyDukh, 22.0f, true, "FalsePhase 24 m"},
            // ...and the one that notices you LATER, which is the wave's headline: at
            // 19 m a Сборка is already coming and a Трескотник is not. It is 19 and not
            // 18.5 because the shrink is 2 m and a test that only just resolves the
            // difference is a test that a float change can flip.
            {MobKind::Treskotnik, 19.0f, false, "FractureSprint 18 m"},
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

    // ---- 8. WebSpitter: the first monster in the tree that BACKS AWAY ---------
    // Measured as a SIGN, not a speed. Every other steer in this file is tangential, so
    // no assertion on |v| could tell a standoff from a fast approach; the claim is that
    // the radial component reverses across 7.25 m, and the control proves the reversal
    // belongs to the behaviour rather than to the distance.
    //
    // Laid out along +y, away from the arena's one wall and its neighbours, so the
    // block shares no cell with the wall-pace blocks above.
    {
        Registry reg;
        spawn_viewer(reg, layer, viewerAt);
        const vec3 nearAt{viewerAt.x, viewerAt.y + 3.0f, viewerAt.z};        // inside
        const vec3 holdAt{viewerAt.x, viewerAt.y + kWebStandoff, viewerAt.z};// exactly on
        const vec3 farAt{viewerAt.x, viewerAt.y + 12.0f, viewerAt.z};        // outside
        const Entity nearWeb = spawn_at(reg, layer, MobKind::Paupsina, nearAt);
        const Entity holdWeb = spawn_at(reg, layer, MobKind::Paupsina, holdAt);
        const Entity farWeb = spawn_at(reg, layer, MobKind::Paupsina, farAt);
        const Entity nearPlain = spawn_at(reg, layer, MobKind::Sborka, nearAt);
        const Entity farPlain = spawn_at(reg, layer, MobKind::Sborka, farAt);
        CHECK(wander_init(reg, layer, 11u) == 5u);

        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            wander_step(reg, grid, pool, coarse, fine, layer, t);

        const vec3 nv = reg.get<const Velocity>(nearWeb).v;
        const vec3 hv = reg.get<const Velocity>(holdWeb).v;
        const vec3 fv = reg.get<const Velocity>(farWeb).v;
        const vec3 npv = reg.get<const Velocity>(nearPlain).v;
        const vec3 fpv = reg.get<const Velocity>(farPlain).v;
        std::fprintf(stderr,
                     "[behaviours] WebSpitter standoff %.2f m: at 3 m v.y = %+.3f, at "
                     "%.2f m v.y = %+.3f, at 12 m v.y = %+.3f | Plain at 3 m %+.3f, at "
                     "12 m %+.3f (+y is away from the viewer)\n",
                     kWebStandoff, nv.y, kWebStandoff, hv.y, fv.y, npv.y, fpv.y);

        // The viewer is at lower y, so v.y > 0 is retreat and v.y < 0 is approach.
        CHECK(nv.y > 0.0f);    // inside the standoff: it backs off
        CHECK(fv.y < 0.0f);    // outside it: it still closes
        // ...and a Plain mob closes from BOTH, so neither sign is a property of the
        // distance. This is the pair that makes the block a measurement of the
        // behaviour rather than of the geometry.
        CHECK(npv.y < 0.0f);
        CHECK(fpv.y < 0.0f);

        // Standing exactly on the standoff, the radial term cancels EXACTLY and the
        // whole speed budget goes tangential — the orbit the header's arithmetic
        // predicts. Exact equality is legitimate here and not luck: 7.25 and the
        // normalised (0, -1) approach are both binary-exact, so ty is 0.0f by
        // construction rather than by rounding.
        const float webSp = table_speed(MobKind::Paupsina);
        CHECK(hv.y == 0.0f);
        CHECK(near_eq(std::fabs(hv.x), webSp));
        // The tangential term is present at every distance, or the "strafing" half of
        // the claim is unproven and the mob merely walks in and out on a line.
        CHECK(std::fabs(nv.x) > 0.0f);
        CHECK(std::fabs(fv.x) > 0.0f);
        // No pace multiplier: WebSpitter claims none, so all three move at the table
        // speed and only their DIRECTION differs from a Plain mob's.
        CHECK(near_eq(flat_speed(reg.get<const Velocity>(nearWeb)), webSp));
        CHECK(near_eq(flat_speed(reg.get<const Velocity>(farWeb)), webSp));
        CHECK(!behaviour_move_mult(MobBehaviour::WebSpitter, true).claimed);

        // Both halves of the offset, at the function level, so a sign flip in either is
        // attributable. dir is the normalised approach; the radial term must oppose it.
        const PursuitOffset even = pursuit_offset(MobBehaviour::WebSpitter, 4u, 0u,
                                                  1.0f, 0.0f);
        const PursuitOffset odd = pursuit_offset(MobBehaviour::WebSpitter, 5u, 0u,
                                                 1.0f, 0.0f);
        CHECK(near_eq(even.x, -kWebStandoff));
        CHECK(near_eq(odd.x, -kWebStandoff));
        // The two id parities take opposite sides, which is what keeps a group from
        // stacking into one orbit lane.
        CHECK(near_eq(even.y, -kWebStrafeSide));
        CHECK(near_eq(odd.y, kWebStrafeSide));
        CHECK(even.y * odd.y < 0.0f);
        // Degenerate approach must not divide by zero, same contract as the flank.
        const PursuitOffset zero = pursuit_offset(MobBehaviour::WebSpitter, 4u, 0u,
                                                  0.0f, 0.0f);
        CHECK(zero.x == 0.0f && zero.y == 0.0f);
    }

    // ---- 9. FractureSprint: a three-timer cycle with no timer ----------------
    // Pure-function block, and the reason is stated rather than assumed: nothing in
    // src/ calls `burst_phase` yet, so there is no velocity to measure. What CAN be
    // proven without a caller is that the cycle is the authored one, that it is
    // deterministic, that carriers are off lockstep, and that it costs a Трескотник
    // ground rather than giving it a free 3.25x.
    {
        CHECK(burst_phase(MobBehaviour::Plain, 7u, 0u, 1.0f) == BurstPhase::Idle);
        // The range gate: at the boundary it winds up, one millimetre past it does not.
        CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, 0u, kFractureRange) !=
              BurstPhase::Idle);
        CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, 0u,
                          kFractureRange + 0.001f) == BurstPhase::Idle);
        // Which means a Трескотник closing from its own 18 m sight is an ordinary
        // monster for the first 10.5 m of it.
        CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, 0u, 18.0f) ==
              BurstPhase::Idle);

        // Walk one full cycle for one identity and count. The counts are compared
        // against the DERIVED tick constants, not against 43/77/168, so a kSimHz change
        // moves both sides together — the failure [wander.h] documents (a duration
        // authored in seconds, stored in ticks, and silently rescaled) cannot land here.
        std::uint64_t win = 0, spr = 0, stag = 0, idle = 0;
        for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t) {
            switch (burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f)) {
                case BurstPhase::Windup:  ++win;  break;
                case BurstPhase::Sprint:  ++spr;  break;
                case BurstPhase::Stagger: ++stag; break;
                case BurstPhase::Idle:    ++idle; break;
            }
        }
        std::fprintf(stderr,
                     "[behaviours] FractureSprint cycle %llu ticks = %.3f s: windup "
                     "%llu, sprint %llu, stagger %llu, idle %llu\n",
                     static_cast<unsigned long long>(kFractureCycleTicks),
                     static_cast<double>(kFractureCycleTicks) /
                         static_cast<double>(kSimHz),
                     static_cast<unsigned long long>(win),
                     static_cast<unsigned long long>(spr),
                     static_cast<unsigned long long>(stag),
                     static_cast<unsigned long long>(idle));
        CHECK(win == kFractureWindupTicks);
        CHECK(spr == kFractureSprintTicks);
        CHECK(stag == kFractureStaggerTicks);
        CHECK(idle == 0u);   // in range, every tick belongs to some phase
        // The cycle is the authored 2.32 s to within the tick quantisation, which at
        // 125 Hz is 8 ms. Asserted as a bound and not as an equality: three
        // truncations cannot land on 2.32 exactly and pretending they do would be the
        // brittle version of this check.
        const float cycleSec =
            static_cast<float>(kFractureCycleTicks) / static_cast<float>(kSimHz);
        const float authored =
            kFractureWindupSec + kFractureSprintSec + kFractureStaggerSec;
        CHECK(std::fabs(cycleSec - authored) < 3.0f / static_cast<float>(kSimHz));

        // Deterministic: the same (id, tick) is the same phase, always. This is the
        // property that lets two systems read the cycle without sharing state.
        for (std::uint64_t t = 0; t < 64u; ++t)
            CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f) ==
                  burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f));
        // ...and periodic, so it cannot drift over a long session.
        CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, 5u, 2.0f) ==
              burst_phase(MobBehaviour::FractureSprint, 7u, 5u + kFractureCycleTicks,
                          2.0f));
        CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, 5u, 2.0f) ==
              burst_phase(MobBehaviour::FractureSprint, 7u,
                          5u + kFractureCycleTicks * 4096u, 2.0f));

        // Off lockstep. Counted over 64 identities on one tick rather than asserted for
        // one pair: a single pair could disagree by luck, and what the mechanic needs is
        // that a PACK does not sprint together. Anything above one phase present is a
        // pass; the count is printed so a hash that degenerated to a constant is
        // visible rather than merely failing.
        std::size_t phaseSeen[4] = {0, 0, 0, 0};
        for (std::uint32_t id = 0; id < 64u; ++id)
            ++phaseSeen[static_cast<std::size_t>(
                burst_phase(MobBehaviour::FractureSprint, id, 500u, 2.0f))];
        std::fprintf(stderr,
                     "[behaviours] ...64 identities on one tick: idle %zu, windup %zu, "
                     "sprint %zu, stagger %zu\n",
                     phaseSeen[0], phaseSeen[1], phaseSeen[2], phaseSeen[3]);
        CHECK(phaseSeen[0] == 0u);   // all in range, so none idle
        CHECK(phaseSeen[1] > 0u);
        CHECK(phaseSeen[2] > 0u);
        CHECK(phaseSeen[3] > 0u);

        // The multipliers, and the fact that the two frozen phases really are zero.
        CHECK(burst_speed_mult(BurstPhase::Idle) == 1.0f);
        CHECK(burst_speed_mult(BurstPhase::Windup) == 0.0f);
        CHECK(burst_speed_mult(BurstPhase::Sprint) == kFractureSprintMult);
        CHECK(burst_speed_mult(BurstPhase::Stagger) == 0.0f);
        CHECK(burst_damage_mult(BurstPhase::Sprint) == kFractureBurstDamage);
        CHECK(burst_damage_mult(BurstPhase::Idle) == 1.0f);
        CHECK(burst_damage_mult(BurstPhase::Windup) == 1.0f);
        CHECK(burst_damage_mult(BurstPhase::Stagger) == 1.0f);

        // THE balance claim, and it is the opposite of what "x3.25" suggests: averaged
        // over the cycle a Трескотник covers LESS ground than it does today, because it
        // spends 73% of the cycle frozen. The kind gets scarier and slower at once,
        // which is the whole design — it is 18 HP and dies to one clean burst.
        float sum = 0.0f;
        for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t)
            sum += burst_speed_mult(
                burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f));
        const float meanMult = sum / static_cast<float>(kFractureCycleTicks);
        std::fprintf(stderr,
                     "[behaviours] ...mean speed over one cycle: x%.4f (frozen %.0f%% "
                     "of it)\n",
                     meanMult,
                     100.0 * static_cast<double>(kFractureWindupTicks +
                                                 kFractureStaggerTicks) /
                         static_cast<double>(kFractureCycleTicks));
        CHECK(meanMult < 1.0f);
        CHECK(meanMult > 0.5f);   // and not so slow that it never arrives
        // Out of range it is exactly unmodified — the 68 other kinds and every
        // approaching Трескотник must be bit-for-bit what they are today.
        CHECK(burst_speed_mult(burst_phase(MobBehaviour::FractureSprint, 7u, 500u,
                                          40.0f)) == 1.0f);
        CHECK(burst_speed_mult(burst_phase(MobBehaviour::Plain, 7u, 500u, 1.0f)) ==
              1.0f);
    }

    // ---- 10. DeadEcho: a facing turned into a stat ---------------------------
    // Pure-function block for the same stated reason as block 9 — combat.cpp applies
    // neither this nor `behaviour_damage_mult`, so there is no damage number to
    // measure. The invariant against `frozen_by_gaze` is the part that could not be
    // written as a comment.
    {
        // Behind the viewer: the delta from viewer to monster opposes the forward.
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, -1.0f, 0.0f) ==
              kDeadEchoBackDamage);
        // In front of it: the weak branch.
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, 1.0f, 0.0f) ==
              kDeadEchoFacedDamage);
        // The threshold is -0.18 and it is inclusive, matching the reference's `<=`.
        // Both sides of it, because an off-by-one-comparison here is invisible at any
        // other angle.
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, kDeadEchoBackDot,
                                 -std::sqrt(1.0f - kDeadEchoBackDot *
                                                       kDeadEchoBackDot)) ==
              kDeadEchoBackDamage);
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f,
                                 kDeadEchoBackDot + 0.01f,
                                 -std::sqrt(1.0f - kDeadEchoBackDot *
                                                       kDeadEchoBackDot)) ==
              kDeadEchoFacedDamage);
        // Standing on top of it counts as FACING it, so being caught never also hands
        // out the bonus. The reference's facingDotTo returns 1 below 0.001 m.
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, 0.0f, 0.0f) ==
              kDeadEchoFacedDamage);
        // Distance is deliberately NOT a term: the multiplier is about facing only, and
        // the 7.5 m radius is what bounds it. A long delta with the same bearing gives
        // the same answer, which is what makes it safe to call from a combat pass that
        // has already decided the monster is in reach.
        CHECK(facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, -40.0f, 0.0f) ==
              kDeadEchoBackDamage);
        // Every other behaviour is untouched, all 47 checked rather than a sample.
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            if (b == MobBehaviour::DeadEcho) continue;
            CHECK(facing_damage_mult(b, 1.0f, 0.0f, -1.0f, 0.0f) == 1.0f);
        }
        // The straddle that makes it the kind's whole design rather than a bonus: one
        // branch above 1.0 and one below, so looking at Безэхий is a real defence and
        // not merely the absence of a buff.
        //
        // `static_assert`, not CHECK, and the reason is a WARNING rather than taste:
        // both operands are `inline constexpr`, so `if (!(...))` inside CHECK is a
        // constant condition and MSVC raises C4127 under the `/W4` that
        // `giga_target_flags` applies to game_test. These two lines were the file's only
        // two warnings on the Windows build; wave 4 would have added five more of the
        // same shape, so the whole class is converted rather than suppressed. A claim
        // about two constants belongs at compile time anyway.
        static_assert(kDeadEchoBackDamage > 1.0f,
                      "back-turned must be a real bonus, not merely no penalty");
        static_assert(kDeadEchoFacedDamage < 1.0f,
                      "facing it must be a real defence, not merely no bonus");

        // THE cross-check. `frozen_by_gaze` and `facing_damage_mult` read the identical
        // two vectors, so a caller that got one convention backwards would still
        // compile and still look plausible. Swept over the full circle: a monster the
        // viewer is looking at (the freeze cone) can NEVER be in the back-turned band,
        // and the two bands cannot overlap for any bearing.
        std::size_t frozenCount = 0, backCount = 0;
        for (int deg = 0; deg < 360; ++deg) {
            const float a = static_cast<float>(deg) * 3.14159265f / 180.0f;
            const float dx = std::cos(a) * 10.0f;   // 10 m out, inside kGazeRange
            const float dy = std::sin(a) * 10.0f;
            const bool frozen = frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f,
                                               dx, dy);
            const bool back = facing_damage_mult(MobBehaviour::DeadEcho, 1.0f, 0.0f, dx,
                                                dy) == kDeadEchoBackDamage;
            CHECK(!(frozen && back));
            if (frozen) ++frozenCount;
            if (back) ++backCount;
        }
        std::fprintf(stderr,
                     "[behaviours] facing bands over 360 bearings: gaze-freeze %zu, "
                     "DeadEcho back-turned %zu, overlap 0\n",
                     frozenCount, backCount);
        // Both bands must be non-empty or the disjointness above is vacuous. The
        // freeze cone is +/-45 deg (91 of 360) and the back band is everything past
        // 100.4 deg (159 of 360); asserted as ranges so the numbers are checked
        // without being copied.
        CHECK(frozenCount > 80u && frozenCount < 100u);
        CHECK(backCount > 140u && backCount < 180u);
    }

    // ---- 11. WallBrace reach: the half of the kind the CSV column is missing --
    // Pure-function block, same stated reason as 9 and 10: combat.cpp computes `reach`
    // from `def.meleeReachMm` directly, so there is no swing to measure until the
    // handoff lands. What CAN be proven is the part a caller cannot get wrong by
    // accident — that the unbraced branch is bit-for-bit the arithmetic combat.cpp
    // already does, and that the braced branch is outside the table's whole range.
    {
        const MobDef& pan = mob_def(MobKind::Panelnik);
        const MobBehaviour wb = MobBehaviour::WallBrace;

        // The OPEN branch must equal what combat.cpp computes today, to the bit. This is
        // the assertion that makes the handoff safe: replacing that line with this call
        // changes nothing for 68 kinds and nothing for an unbraced Панельник.
        const float asCombatDoesIt =
            static_cast<float>(pan.meleeReachMm) * 0.001f * kCellSize;
        CHECK(behaviour_melee_reach(wb, pan.meleeReachMm, false) == asCombatDoesIt);
        // ...and so must every other behaviour, in BOTH wall states — a reach override
        // that leaked onto another enumerator would be a silent buff to a live kind.
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            if (b == wb) continue;
            CHECK(behaviour_melee_reach(b, pan.meleeReachMm, true) == asCombatDoesIt);
            CHECK(behaviour_melee_reach(b, pan.meleeReachMm, false) == asCombatDoesIt);
        }

        const float braced = behaviour_melee_reach(wb, pan.meleeReachMm, true);
        const float open = behaviour_melee_reach(wb, pan.meleeReachMm, false);
        std::fprintf(stderr,
                     "[behaviours] WallBrace reach: braced %.3f m, open %.3f m (x%.4f)\n",
                     braced, open, braced / open);

        // The authored pair, in metres, via kCellSize so a cell-size change moves both.
        CHECK(near_eq(braced, kWallBraceReachCells * kCellSize));
        CHECK(braced > open);
        // 1.75 / 1.16 = 1.5086. Asserted as a ratio, not a difference, because the
        // ratio is the mechanic and it survives a CSV retune of the open half.
        CHECK(near_eq(braced / open, kWallBraceReachCells /
                                         (static_cast<float>(pan.meleeReachMm) * 0.001f),
                      1e-3f));

        // THE claim that makes it a mechanic rather than a number: braced, Панельник
        // out-reaches every row in the table, and unbraced it is beaten by nearly all of
        // them. Both halves are computed by SCANNING kMobTable rather than by copying
        // Тварь's 1.55, so a CSV that authored a longer reach surfaces here.
        std::uint16_t widest = 0;
        std::size_t shorterThanPanelnik = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            if (kMobTable[k].meleeReachMm > widest) widest = kMobTable[k].meleeReachMm;
            if (kMobTable[k].meleeReachMm < pan.meleeReachMm) ++shorterThanPanelnik;
        }
        const float widestM = static_cast<float>(widest) * 0.001f * kCellSize;
        std::fprintf(stderr,
                     "[behaviours] ...widest authored reach %.3f m; %zu of %zu rows are "
                     "SHORTER than an unbraced Панельник\n",
                     widestM, shorterThanPanelnik, kMobKindCount);
        CHECK(braced > widestM);
        // And 1750 really is outside the column's documented 1050..1550, i.e. this could
        // never have been a CSV edit — the row correctly carries the unbraced value.
        CHECK(kWallBraceReachCells * 1000.0f > static_cast<float>(widest));
        // Only Рой (1.05) is shorter, so "shorter than a Сборка" is not rhetoric.
        CHECK(shorterThanPanelnik == 1u);

        // The wall query the two new hooks ride on is ALREADY gated correctly for the
        // combat caller, and this is the assertion behind that claim: switching
        // combat.cpp's `has_flag(def.aiFlags, WallBias)` branch to `wall_query_needed`
        // adds the four cell reads for exactly one kind.
        std::size_t flagOnly = 0, gated = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MobBehaviour b = static_cast<MobBehaviour>(kMobTable[k].behaviour);
            if (has_flag(kMobTable[k].aiFlags, AiFlag::WallBias)) ++flagOnly;
            if (wall_query_needed(kMobTable[k].aiFlags, b)) ++gated;
        }
        std::fprintf(stderr,
                     "[behaviours] ...combat wall query: %zu kinds today, %zu after the "
                     "gate widens\n",
                     flagOnly, gated);
        CHECK(flagOnly == 4u);
        CHECK(gated == 5u);
    }

    // ---- 12. WallBrace armour: the first INCOMING multiplier in the file -----
    {
        const MobBehaviour wb = MobBehaviour::WallBrace;
        CHECK(behaviour_incoming_mult(wb, true) == kWallBraceIncoming);
        CHECK(behaviour_incoming_mult(wb, false) == 1.0f);
        // Armour, not a penalty: the braced value must be BELOW 1 and the open value
        // exactly 1. A sign error here would hand the player's shots a bonus against a
        // braced Панельник, which reads as the mechanic working while inverting it.
        // Compile-time, per the C4127 note in block 10.
        static_assert(kWallBraceIncoming < 1.0f, "braced must REDUCE incoming damage");
        static_assert(kWallBraceIncoming > 0.0f, "braced must not be immunity");
        // No other behaviour has incoming armour — all 47 checked, both wall states.
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            if (b == wb) continue;
            CHECK(behaviour_incoming_mult(b, true) == 1.0f);
            CHECK(behaviour_incoming_mult(b, false) == 1.0f);
        }

        // WHY the integer floor is the caller's and not this function's, asserted rather
        // than asserted-in-a-comment: the reference wraps every use in
        // `Math.max(1, Math.round(dmg * 0.58))`. Truncating a 1-point hit through this
        // multiplier gives ZERO, i.e. a braced Панельник would be immune to chip damage
        // and the swing would be re-queued forever — the same failure combat.cpp already
        // documents for a 0-damage swing (`apply_damage` returns hit == false, the
        // cooldown is never set). So the handoff MUST floor at 1.
        static_assert(static_cast<int>(1.0f * kWallBraceIncoming) == 0,
                      "a 1-point hit truncates to ZERO through this multiplier: the "
                      "caller must floor at 1 or a braced Панельник is chip-immune");
        static_assert(static_cast<int>(2.0f * kWallBraceIncoming) == 1,
                      "and a 2-point hit does not, so the floor binds only at the edge");

        // The braced state is coherent across all three dimensions at once, which is the
        // claim that Панельник is now a complete kind: braced it is faster, longer and
        // tougher; open it is slower, shorter and unarmoured. Asserted together because
        // any one of the three passing alone would still leave a kind that reads wrong.
        CHECK(behaviour_move_mult(wb, true).mult > behaviour_move_mult(wb, false).mult);
        CHECK(behaviour_melee_reach(wb, 1160u, true) >
              behaviour_melee_reach(wb, 1160u, false));
        CHECK(behaviour_incoming_mult(wb, true) < behaviour_incoming_mult(wb, false));
        // ...and that the open state is not a penalty on top of the table row: an
        // unbraced Панельник gets exactly its authored reach and no armour, so the CSV
        // row remains the honest description of the weak half. Written with the SAME
        // arithmetic the function uses rather than as the literal 1.160f — `1160 *
        // 0.001f` and `1.160f` are not the same float, and an exact comparison between
        // them would be testing the rounding of a decimal literal, not the behaviour.
        CHECK(behaviour_melee_reach(wb, 1160u, false) == 1160.0f * 0.001f * kCellSize);
        CHECK(behaviour_incoming_mult(wb, false) == 1.0f);
    }

    // ---- 13. CrowdShove: the mob's own health, which nothing had read --------
    {
        const MobBehaviour cs = MobBehaviour::CrowdShove;
        const MobDef& dikiy = mob_def(MobKind::DikiyMertvyak);
        CHECK(dikiy.behaviour == static_cast<std::uint8_t>(cs));
        // Neither a wall flag nor a wall behaviour, which is what makes the precedence
        // question below structural rather than a tuning accident.
        CHECK(!has_flag(dikiy.aiFlags, AiFlag::WallBias));
        CHECK(!wall_query_needed(dikiy.aiFlags, cs));
        // Fragile and fast — 22 HP at 2.55 cells/s — so "hurt once and it stops
        // committing" is the whole shape of the kind. Pinned because a CSV that gave it
        // 200 HP would make a 4% slow meaningless.
        CHECK(dikiy.hp == 22);
        CHECK(dikiy.packMode == static_cast<std::uint8_t>(MobPackMode::Crowd));

        // Untouched is EXACTLY 1.0, so a fresh Дикий Мертвяк is bit-for-bit what it is
        // today. The reference computes `1 + min(1.2, charge) * 0.18` with charge 0.
        CHECK(behaviour_hurt_move_mult(cs, 22, 22) == 1.0f);
        // One point of damage is enough — the reference's predicate is `hp < startHp`,
        // not a fraction, so there is no threshold to tune and none is invented here.
        CHECK(behaviour_hurt_move_mult(cs, 21, 22) == kCrowdShoveHurtSpeed);
        CHECK(behaviour_hurt_move_mult(cs, 1, 22) == kCrowdShoveHurtSpeed);
        // Compile-time, per the C4127 note in block 10. A hurt runner must be SLOWER;
        // the reference's undamaged branch is `1 + 0 * 0.18`, so 0.96 is the only value
        // here that is not 1.0 and its direction is the whole mechanic.
        static_assert(kCrowdShoveHurtSpeed < 1.0f, "being hurt must cost pace");

        // Degenerate rows return 1.0 rather than dividing, clamping, or inventing a
        // speed-up. A mob with maxHp 0 is a spawn bug ([mob_spawn.h] pins the field
        // order precisely because that bug is possible) and slowing it would hide it.
        CHECK(behaviour_hurt_move_mult(cs, 0, 0) == 1.0f);
        CHECK(behaviour_hurt_move_mult(cs, 10, -5) == 1.0f);
        // Over-healed is not "hurt": hp > maxHp falls through to 1.0.
        CHECK(behaviour_hurt_move_mult(cs, 30, 22) == 1.0f);
        // Dead is still "hurt" — no special case, because a corpse is not this
        // function's problem and a branch for it would be untestable dead code.
        CHECK(behaviour_hurt_move_mult(cs, 0, 22) == kCrowdShoveHurtSpeed);

        // Every other behaviour is untouched at both health states, all 47 checked.
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            if (b == cs) continue;
            CHECK(behaviour_hurt_move_mult(b, 1, 100) == 1.0f);
            CHECK(behaviour_hurt_move_mult(b, 100, 100) == 1.0f);
        }

        // THE precedence assertion, and the reason it is a loop over all 47 rather than
        // one line about Дикий Мертвяк: there are now TWO pace multipliers, and the day a
        // behaviour is authored with both a wall pace and a health pace, a caller that
        // multiplies them would silently produce 1.22 * 0.96 where the reference gives
        // one or the other. No enumerator may answer both.
        std::size_t bothPaces = 0;
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            const bool wallPace = behaviour_move_mult(b, true).claimed ||
                                  behaviour_move_mult(b, false).claimed;
            const bool healthPace = behaviour_hurt_move_mult(b, 1, 100) != 1.0f ||
                                    behaviour_hurt_move_mult(b, 100, 100) != 1.0f;
            if (wallPace && healthPace) ++bothPaces;
        }
        std::fprintf(stderr,
                     "[behaviours] CrowdShove hurt pace x%.4f; %zu enumerators answer "
                     "BOTH a wall pace and a health pace\n",
                     kCrowdShoveHurtSpeed, bothPaces);
        CHECK(bothPaces == 0u);
        // Same question for the BURST pace, because the handoff puts both multiplies on
        // the same `sp` two lines apart: no enumerator may answer both a burst phase and
        // a health pace, or a hurt Трескотник would be 3.25 * 0.96. Swept over a whole
        // cycle so a phase that is only non-neutral for part of it still counts.
        std::size_t burstAndHurt = 0;
        for (std::size_t i = 0; i < static_cast<std::size_t>(MobBehaviour::Count); ++i) {
            const MobBehaviour b = static_cast<MobBehaviour>(i);
            const bool healthPace = behaviour_hurt_move_mult(b, 1, 100) != 1.0f;
            if (!healthPace) continue;
            bool burstPace = false;
            for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t)
                if (burst_speed_mult(burst_phase(b, 42u, t, 1.0f)) != 1.0f)
                    burstPace = true;
            if (burstPace) ++burstAndHurt;
        }
        CHECK(burstAndHurt == 0u);
        // ...and no kind in the table carries a health pace behind the wall gate, which
        // is the same claim measured against the DATA instead of the enum: if it ever
        // does, wander_step would run the four cell reads and then apply the health
        // multiplier on top of the wall one.
        std::size_t gatedHealthKinds = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MobBehaviour b = static_cast<MobBehaviour>(kMobTable[k].behaviour);
            if (!wall_query_needed(kMobTable[k].aiFlags, b)) continue;
            if (behaviour_hurt_move_mult(b, 1, 100) != 1.0f) ++gatedHealthKinds;
        }
        CHECK(gatedHealthKinds == 0u);
    }

    // ---- 14. Combat Integration: WallBrace defender incoming mitigation ------
    {
        Registry reg14;
        NpcPool pool14;
        pool14.init();

        const vec3 bracedPos{111.0f, 101.0f, 3.0f};  // cell 55, 50, 1; wall is at 56, 50, 1
        const vec3 openPos{101.0f, 111.0f, 3.0f};    // cell 50, 55, 1; open air

        const Entity wallPan = spawn_at(reg14, layer, MobKind::Panelnik, bracedPos);
        const Entity openPan = spawn_at(reg14, layer, MobKind::Panelnik, openPos);

        // 10 raw Kinetic damage to braced vs open Panelnik
        DamageResult rBraced = apply_damage(reg14, pool14, wallPan, 10, DamageChannel::Kinetic, entt::null, &grid);
        DamageResult rOpen = apply_damage(reg14, pool14, openPan, 10, DamageChannel::Kinetic, entt::null, &grid);

        // Braced takes round(10 * 0.58) = 6 damage. Open takes 10 damage.
        CHECK(rBraced.applied == 6);
        CHECK(rOpen.applied == 10);
        CHECK(rBraced.applied < rOpen.applied);

        // Edge case: 1 raw damage to braced Panelnik must floor at 1 (not 0)
        const Entity wallPan2 = spawn_at(reg14, layer, MobKind::Panelnik, bracedPos);
        DamageResult rChip = apply_damage(reg14, pool14, wallPan2, 1, DamageChannel::Kinetic, entt::null, &grid);
        CHECK(rChip.applied == 1);
    }

    // ---- 15. Combat Integration: DeadEcho facing damage multiplier ----------
    {
        const vec3 playerPos{100.0f, 100.0f, 3.0f};

        const MobDef& def = kMobTable[static_cast<std::size_t>(MobKind::Bezekhiy)];
        const float baseDmg = static_cast<float>(mob_hp_at_level(def.dmg, 1));
        const std::int16_t expectedBehind = static_cast<std::int16_t>(baseDmg * 1.55f);
        const std::int16_t expectedFacing = static_cast<std::int16_t>(baseDmg * 0.72f);

        // DeadEcho behind player at (98.5, 100, 3)
        {
            Registry regBehind;
            NpcPool poolBehind;
            poolBehind.init();
            EventBus busBehind;
            const Entity pEnt = spawn_viewer(regBehind, layer, playerPos);
            regBehind.get<CameraTag>(pEnt).yaw = 0.0f;
            regBehind.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const vec3 behindPos{98.5f, 100.0f, 3.0f};
            spawn_at(regBehind, layer, MobKind::Bezekhiy, behindPos);

            std::uint32_t swings = mob_attack_step(regBehind, grid, poolBehind, busBehind, layer, 0.008f, 0);
            CHECK(swings == 1u);
            const MobRef& pMob = regBehind.get<MobRef>(pEnt);
            CHECK(1000 - pMob.hp == expectedBehind);
        }

        // DeadEcho in front of player at (101.5, 100, 3)
        {
            Registry regFacing;
            NpcPool poolFacing;
            poolFacing.init();
            EventBus busFacing;
            const Entity pEnt = spawn_viewer(regFacing, layer, playerPos);
            regFacing.get<CameraTag>(pEnt).yaw = 0.0f;
            regFacing.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const vec3 facingPos{101.5f, 100.0f, 3.0f};
            spawn_at(regFacing, layer, MobKind::Bezekhiy, facingPos);

            std::uint32_t swings = mob_attack_step(regFacing, grid, poolFacing, busFacing, layer, 0.008f, 0);
            CHECK(swings == 1u);
            const MobRef& pMob = regFacing.get<MobRef>(pEnt);
            CHECK(1000 - pMob.hp == expectedFacing);
        }

        CHECK(expectedBehind > expectedFacing);
    }

    // ---- 16. Combat Integration: FractureSprint burst damage multiplier -----
    {
        const vec3 playerPos{100.0f, 100.0f, 3.0f};
        const vec3 mobPos{100.8f, 100.0f, 3.0f};

        const MobDef& def = kMobTable[static_cast<std::size_t>(MobKind::Treskotnik)];
        const float baseDmg = static_cast<float>(mob_hp_at_level(def.dmg, 1));
        const std::int16_t expectedSprint = static_cast<std::int16_t>(baseDmg * 1.45f);
        const std::int16_t expectedNormal = static_cast<std::int16_t>(baseDmg * 1.00f);

        // Sprint phase test
        {
            Registry regSprint;
            NpcPool poolSprint;
            poolSprint.init();
            EventBus busSprint;
            const Entity pEnt = spawn_viewer(regSprint, layer, playerPos);
            regSprint.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const Entity tresk = spawn_at(regSprint, layer, MobKind::Treskotnik, mobPos);
            const std::uint32_t mobId = static_cast<std::uint32_t>(entt::to_integral(tresk));

            std::uint64_t sprintTick = 0;
            for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t) {
                if (burst_phase(MobBehaviour::FractureSprint, mobId, t, 1.5f) == BurstPhase::Sprint) {
                    sprintTick = t;
                    break;
                }
            }

            std::uint32_t swings = mob_attack_step(regSprint, grid, poolSprint, busSprint, layer, 0.008f, sprintTick);
            CHECK(swings == 1u);
            const MobRef& pMob = regSprint.get<MobRef>(pEnt);
            CHECK(1000 - pMob.hp == expectedSprint);
        }

        // Stagger phase test (normal 1.0x damage)
        {
            Registry regStagger;
            NpcPool poolStagger;
            poolStagger.init();
            EventBus busStagger;
            const Entity pEnt = spawn_viewer(regStagger, layer, playerPos);
            regStagger.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const Entity tresk = spawn_at(regStagger, layer, MobKind::Treskotnik, mobPos);
            const std::uint32_t mobId = static_cast<std::uint32_t>(entt::to_integral(tresk));

            std::uint64_t staggerTick = 0;
            for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t) {
                if (burst_phase(MobBehaviour::FractureSprint, mobId, t, 1.5f) == BurstPhase::Stagger) {
                    staggerTick = t;
                    break;
                }
            }

            std::uint32_t swings = mob_attack_step(regStagger, grid, poolStagger, busStagger, layer, 0.008f, staggerTick);
            CHECK(swings == 1u);
            const MobRef& pMob = regStagger.get<MobRef>(pEnt);
            CHECK(1000 - pMob.hp == expectedNormal);
        }

        CHECK(expectedSprint > expectedNormal);
    }

    // ---- 17. Combat Integration: DebrisLurker precedence (no double mult) ---
    {
        const MobDef& def = kMobTable[static_cast<std::size_t>(MobKind::Rebar)];
        const float baseDmg = static_cast<float>(mob_hp_at_level(def.dmg, 1));
        const std::int16_t expectedCover = static_cast<std::int16_t>(baseDmg * 1.25f);
        const std::int16_t expectedOpen = static_cast<std::int16_t>(baseDmg * 0.75f);

        // DebrisLurker near wall (cover: 1.25x)
        {
            Registry regCover;
            NpcPool poolCover;
            poolCover.init();
            EventBus busCover;

            const vec3 playerPos{111.0f, 100.0f, 3.0f}; // distance 1.0m from mob
            const Entity pEnt = spawn_viewer(regCover, layer, playerPos);
            regCover.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const vec3 bracedPos{111.0f, 100.8f, 3.0f}; // cell (55, 50, 1), wall at (56, 50, 1)
            spawn_at(regCover, layer, MobKind::Rebar, bracedPos);

            std::uint32_t swings = mob_attack_step(regCover, grid, poolCover, busCover, layer, 0.008f, 0);
            CHECK(swings == 1u);
            const MobRef& pMob = regCover.get<MobRef>(pEnt);
            // 1.25x damage in cover (verifying it is NOT 1.25 * 1.20 = 1.50x!)
            CHECK(1000 - pMob.hp == expectedCover);
        }

        // DebrisLurker in open (open: 0.75x)
        {
            Registry regOpen;
            NpcPool poolOpen;
            poolOpen.init();
            EventBus busOpen;

            const vec3 playerPos{101.0f, 110.0f, 3.0f};
            const Entity pEnt = spawn_viewer(regOpen, layer, playerPos);
            regOpen.emplace<MobRef>(pEnt, MobRef{0, 1, 1000, 1000});

            const vec3 openPos{101.0f, 110.8f, 3.0f};
            spawn_at(regOpen, layer, MobKind::Rebar, openPos);

            std::uint32_t swings = mob_attack_step(regOpen, grid, poolOpen, busOpen, layer, 0.008f, 0);
            CHECK(swings == 1u);
            const MobRef& pMob = regOpen.get<MobRef>(pEnt);
            CHECK(1000 - pMob.hp == expectedOpen);
        }

        CHECK(expectedCover > expectedOpen);
    }

    // ---- 18. MELEEGRID: player_melee_step forwards grid → WallBrace soak ----
    // Section 14 pins apply_damage(..., &grid) directly. That does not prove the
    // live player swing path: player_melee_step had `grid` for wall-chip carves
    // but forgot to pass it into apply_damage, so Панельник braced against a wall
    // soaked bullets (projectile_step) and mob swings (mob_attack_step) but took
    // full fist damage. This block is the path that was broken.
    {
        EventBus bus18;
        const MeleeDef& fist = unarmed_melee();
        CHECK(fist.dmg >= 1);

        // Braced: player at cell 54,50 looking +X; Panelnik at 55,50 (wall at 56,50).
        // Reach bare = 0.5 cell * kCellSize + slack ≈ 1.9 m; 0.8 m gap (2 m misses).
        {
            Registry regB;
            NpcPool poolB;
            poolB.init();
            const Entity self = spawn_viewer(regB, layer, vec3{109.2f, 100.0f, 3.0f});
            regB.get<CameraTag>(self).yaw = 0.0f;   // +X
            regB.get<CameraTag>(self).pitch = 0.0f;
            const Entity pan = spawn_at(regB, layer, MobKind::Panelnik,
                                        vec3{110.0f, 100.0f, 3.0f});
            // High HP so fist never kills; we only care about applied soak.
            regB.get<MobRef>(pan).hp = 500;
            regB.get<MobRef>(pan).maxHp = 500;
            const std::int16_t hp0 = regB.get<MobRef>(pan).hp;
            CHECK(player_melee_step(regB, poolB, bus18, layer, 0.016f,
                                    /*wantsAttack=*/true, /*tick=*/1u,
                                    &grid, /*carves=*/nullptr) == true);
            const std::int16_t applied =
                static_cast<std::int16_t>(hp0 - regB.get<MobRef>(pan).hp);
            // round(fist.dmg * kWallBraceIncoming); same arithmetic as §14.
            const int expect = static_cast<int>(
                static_cast<float>(fist.dmg) * kWallBraceIncoming + 0.5f);
            const int floorExpect = (expect < 1 && fist.dmg > 0) ? 1 : expect;
            CHECK(applied == static_cast<std::int16_t>(floorExpect));
            CHECK(applied < static_cast<std::int16_t>(fist.dmg));
            std::printf("[behaviours] MELEEGRID braced: raw=%u applied=%d "
                        "(expect %d @ x%.2f)\n",
                        static_cast<unsigned>(fist.dmg),
                        static_cast<int>(applied), floorExpect,
                        kWallBraceIncoming);
        }

        // Open: same geometry as §14 open cell — no adjacent wall → full damage.
        {
            Registry regO;
            NpcPool poolO;
            poolO.init();
            // Player south of open pan, looking +Y.
            const Entity self = spawn_viewer(regO, layer, vec3{100.0f, 109.2f, 3.0f});
            regO.get<CameraTag>(self).yaw = 1.5707963f;  // +Y
            regO.get<CameraTag>(self).pitch = 0.0f;
            const Entity pan = spawn_at(regO, layer, MobKind::Panelnik,
                                        vec3{100.0f, 110.0f, 3.0f});
            regO.get<MobRef>(pan).hp = 500;
            regO.get<MobRef>(pan).maxHp = 500;
            const std::int16_t hp0 = regO.get<MobRef>(pan).hp;
            CHECK(player_melee_step(regO, poolO, bus18, layer, 0.016f,
                                    /*wantsAttack=*/true, /*tick=*/1u,
                                    &grid, /*carves=*/nullptr) == true);
            const std::int16_t applied =
                static_cast<std::int16_t>(hp0 - regO.get<MobRef>(pan).hp);
            CHECK(applied == static_cast<std::int16_t>(fist.dmg));
            std::printf("[behaviours] MELEEGRID open: raw=%u applied=%d\n",
                        static_cast<unsigned>(fist.dmg),
                        static_cast<int>(applied));
        }
    }
}

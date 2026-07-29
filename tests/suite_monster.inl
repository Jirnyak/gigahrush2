// Per-kind monster traits — the armour, the fire counterplay, the wet terrain query,
// and the two things this lane deliberately did NOT build.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace`; it carries its own includes of the systems under test.
//
//   tests/game_test.cpp is lead-owned in this lane, so the two-line wire (an #include
//   beside suite_loottable.inl and a test_monster_all() call beside test_loottable_all())
//   is handed off rather than applied. Every block below is written to run; the marker
//   exists so the gate is green in the gap, not because the suite is unfinished.
//
// ---------------------------------------------------------------------------
// WHAT EACH BLOCK IS ALLOWED TO CLAIM
// ---------------------------------------------------------------------------
// The distinction this file is built around, because three of the four mechanics are at
// different distances from the player:
//
//   ARMOUR is measured END TO END. `sync_monster_armour` installs the resist vector on a
//     real entity and the damage is put through `apply_damage` — the single mitigation
//     point the whole of [combat.h] is shaped around. So block 3 asserts a HIT POINT
//     TOTAL, not a multiplier, and the number it asserts is what a player would see.
//   COUNTERPLAY is measured END TO END for the same reason: the floor is computed and
//     then actually applied, so block 4 asserts that a 5-damage torch kills a 62-HP
//     plant in three swings and a 60-damage rifle does not kill it in one.
//   TERRAIN is measured AS FAR AS IT GOES, and that is short. Block 5 drives `pos_wet`
//     against a real settled fluid field and then MEASURES the blocker: every wet cell
//     this engine produces today is half-solid, so nothing can stand in one, so the wet
//     multipliers cannot fire. The block asserts that count is zero rather than
//     asserting a monster moves faster in water, because the second claim would be
//     false. When floor_gen grows an open pool the same assertion flips and says so.
//
// A suite that measured all three the same way would be lying about one of them.

#include "game/combat.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/mob_behaviour.h"
#include "game/mob_spawn.h"
#include "game/mob_table.h"
#include "game/monster_traits.h"
#include "game/npc_pool.h"
#include "sim/fluid.h"
#include "world/field.h"
#include "world/world.h"

namespace monster_detail {

inline int cell_of(float world1d) {
    return wrap_macro(static_cast<int>(std::floor(world1d / kCellSize)));
}

// A bare mob entity carrying only what apply_damage needs: a MobRef for the HP and
// whatever `sync_monster_armour` decides to attach. No Transform, no Velocity — this is
// a damage fixture, not a body, and giving it more would let a steering pass touch it.
inline Entity damage_fixture(Registry& reg, MobKind k) {
    const std::uint16_t hp = mob_def(k).hp;
    const Entity e = reg.create();
    reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(k), 1,
                                  static_cast<std::int16_t>(hp),
                                  static_cast<std::int16_t>(hp)});
    sync_monster_armour(reg, e, static_cast<std::uint8_t>(k));
    return e;
}

inline std::int16_t mob_hp(const Registry& reg, Entity e) {
    return reg.get<const MobRef>(e).hp;
}

// Does this kind's pace depend on WALL adjacency, per [mob_behaviour.h]? The exact
// predicate that file exposes, so block 6 compares like with like instead of
// re-deriving the flag test.
inline bool wall_paced(std::size_t k) {
    const MobDef& d = kMobTable[k];
    return wall_query_needed(d.aiFlags, static_cast<MobBehaviour>(d.behaviour));
}

// Does this kind's pace depend on WATER, per the trait table?
inline bool water_paced(std::size_t k) {
    const std::uint8_t kk = static_cast<std::uint8_t>(k);
    return trait_move_mult(kk, true) != 1.0f || trait_move_mult(kk, false) != 1.0f;
}

inline bool near_eq(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps;
}

} // namespace monster_detail

static void test_monster_all() {
    using namespace monster_detail;

    // -----------------------------------------------------------------------
    // 1. The table's shape, and that every authored row earns its line
    // -----------------------------------------------------------------------
    // The failure this guards is not a crash. It is a CSV row that quietly changes
    // nothing — it costs a line, it counts against kMonsterTraitRows, and every reader
    // returns the default for it, so it reads as content and behaves as absence. The
    // generator rejects that shape at author time; this rejects it in the shipped table,
    // which is the copy that matters.
    {
        CHECK(monster_traits_rows_indexed());
        CHECK(monster_trait_authored_count() == kMonsterTraitRows);
        // Compile-time facts go through static_assert, not CHECK. Putting a constant in
        // `if (!(cond))` earns MSVC C4127 and the tree is built /W4 with warnings treated
        // as errors in review (AGENTS.md), so a CHECK on a sizeof is a build failure.
        static_assert(sizeof(MonsterTraits) == 24u, "row size moved");
        // The resist vector is copied element-wise onto Armour::resist, so the widths must
        // agree. Pinned from the TEST as well as from monster_traits.cpp because a width
        // change would compile there and silently truncate here.
        static_assert(sizeof(MonsterTraits::resist) / sizeof(std::int8_t) ==
                          kDamageChannels,
                      "MonsterTraits::resist width must match the damage channels");

        std::size_t inert = 0, authored = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MonsterTraits& t = kMonsterTraits[k];
            if (t.authored == 0u) continue;
            ++authored;
            const std::uint8_t kk = static_cast<std::uint8_t>(k);
            const bool changesSomething =
                t.resist[0] != 0 || t.resist[1] != 0 || t.resist[2] != 0 ||
                t.resist[3] != 0 || t.resist[4] != 0 ||
                t.terrain != static_cast<std::uint8_t>(TerrainPref::Any) ||
                trait_has_vulnerability(kk) || t.baitMask != 0u ||
                t.wetMoveX100 != kTraitUnit || t.dryMoveX100 != kTraitUnit ||
                t.wetDmgX100 != kTraitUnit || t.dryDmgX100 != kTraitUnit ||
                t.wetIncomingX100 != kTraitUnit || t.wetRegenMilliHps != 0u;
            if (!changesSomething) ++inert;
        }
        std::fprintf(stderr,
                     "[monster] %zu of %zu kinds authored, %zu inert rows, "
                     "table %zu B\n",
                     authored, static_cast<std::size_t>(kMobKindCount), inert,
                     sizeof(MonsterTraits) * kMobKindCount);
        CHECK(inert == 0u);
        CHECK(authored == kMonsterTraitRows);

        // Every unauthored kind must name WHY, and the reason has to be one of the five
        // documented strings — a typo'd sixth would read as an explanation and mean
        // nothing. Counted and printed so the split between "no trait to port" and
        // "blocked on a named missing piece" is a number rather than a claim.
        std::size_t noTrait = 0, viaBehaviour = 0, needLight = 0, needFog = 0,
                    needState = 0, unknownReason = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const char* why =
                monster_traits_unauthored_reason(static_cast<std::uint8_t>(k));
            CHECK(why != nullptr);
            if (kMonsterTraits[k].authored != 0u) {
                CHECK(std::strcmp(why, "authored") == 0);
                continue;
            }
            if (std::strcmp(why, "no trait") == 0) ++noTrait;
            else if (std::strcmp(why, "mob_behaviour") == 0) ++viaBehaviour;
            else if (std::strcmp(why, "needs light") == 0) ++needLight;
            else if (std::strcmp(why, "needs fog") == 0) ++needFog;
            else if (std::strcmp(why, "needs state") == 0) ++needState;
            else ++unknownReason;
        }
        std::fprintf(stderr,
                     "[monster] unauthored 47 = %zu no-trait + %zu mob_behaviour + "
                     "%zu light + %zu fog + %zu state\n",
                     noTrait, viaBehaviour, needLight, needFog, needState);
        CHECK(unknownReason == 0u);
        CHECK(noTrait + viaBehaviour + needLight + needFog + needState ==
              kMobKindCount - kMonsterTraitRows);
    }

    // -----------------------------------------------------------------------
    // 2. An unknown kind answers the DEFAULT ROW, never an out-of-range read
    // -----------------------------------------------------------------------
    // `MobKind::Count` is 69 and the id is a raw u8 on the wire (MobRef::kind, save
    // files, the event bus payload). So 70..255 are all reachable values and every one
    // of them must resolve, not index.
    {
        const MonsterTraits& def = monster_traits_default();
        CHECK(def.authored == 0u);
        CHECK(def.wetMoveX100 == kTraitUnit && def.dryMoveX100 == kTraitUnit);
        CHECK(def.vulnChannel == kNoVulnChannel);
        CHECK(def.baitMask == 0u);
        CHECK(def.terrain == static_cast<std::uint8_t>(TerrainPref::Any));

        for (int bad : {69, 70, 128, 200, 254, 255}) {
            const std::uint8_t k = static_cast<std::uint8_t>(bad);
            // Identity, not equality: an out-of-range kind must get THE default row
            // object, so there is no second copy that could drift from it.
            CHECK(&monster_traits(k) == &def);
            CHECK(near_eq(trait_move_mult(k, true), 1.0f));
            CHECK(near_eq(trait_move_mult(k, false), 1.0f));
            CHECK(near_eq(trait_damage_mult(k, true), 1.0f));
            CHECK(near_eq(trait_incoming_mult(k, true), 1.0f));
            CHECK(near_eq(trait_wet_regen_hps(k), 0.0f));
            CHECK(!trait_has_vulnerability(k));
            CHECK(!trait_allows_wet_spawn(k));
            // A hit on an unknown kind is passed through untouched, at every channel.
            for (std::uint8_t ch = 0; ch < kDamageChannels; ++ch)
                CHECK(trait_counterplay_damage(k, ch, 7, 100) == 7);
            CHECK(!trait_takes_bait_any(k));
        }
        // And installing armour for an unknown kind attaches nothing rather than
        // reading past the table.
        {
            Registry reg;
            const Entity e = reg.create();
            CHECK(!sync_monster_armour(reg, e, 200u));
            CHECK(!reg.all_of<Armour>(e));
            // An invalid entity is refused rather than emplaced onto.
            CHECK(!sync_monster_armour(reg, entt::null, 57u));
        }
    }

    // -----------------------------------------------------------------------
    // 3. ARMOUR: the authored multiplier, measured as hit points off a real mob
    // -----------------------------------------------------------------------
    // Закаленная Арматура is the reference's whole `monster_armor.ts` headline and it
    // had no answer here at all. The claim is not "the table holds 72": it is that a
    // 100-point rifle round takes 28 HP off it and a 100-point shotgun blast takes 68,
    // through `apply_damage`, with no change to `apply_damage`.
    {
        Registry reg;
        NpcPool pool;

        const Entity armoured = damage_fixture(reg, MobKind::ZakalennayaArmatura);
        // Кошмарище (260 hp), NOT Мертвяк (35). `apply_damage` reports the damage HP
        // actually lost, clamped at zero ([combat.h] defect 1), so a 100-point hit on a
        // 35-HP control would report 35 and the comparison would silently be measuring
        // the clamp instead of the armour.
        const Entity control = damage_fixture(reg, MobKind::Nightmare);
        CHECK(reg.all_of<Armour>(armoured));
        // 68 of 69 kinds carry NO component, which is what keeps the miss a miss.
        CHECK(!reg.all_of<Armour>(control));

        const std::int16_t base = mob_hp(reg, armoured);
        const DamageResult weak =
            apply_damage(reg, pool, armoured, 100, DamageChannel::Kinetic, entt::null);
        const std::int16_t afterWeak = mob_hp(reg, armoured);
        const DamageResult heavy =
            apply_damage(reg, pool, armoured, 100, DamageChannel::Buckshot, entt::null);
        const std::int16_t afterHeavy = mob_hp(reg, armoured);

        const DamageResult ctlWeak =
            apply_damage(reg, pool, control, 100, DamageChannel::Kinetic, entt::null);

        std::fprintf(stderr,
                     "[monster] Zakalennaya %d hp: kinetic 100 -> -%d (x%.2f), "
                     "buckshot 100 -> -%d (x%.2f); unarmoured control -%d\n",
                     static_cast<int>(base), static_cast<int>(weak.applied),
                     static_cast<double>(weak.applied) / 100.0,
                     static_cast<int>(heavy.applied),
                     static_cast<double>(heavy.applied) / 100.0,
                     static_cast<int>(ctlWeak.applied));

        // 0.28 and 0.68 verbatim from monster_armor.ts WEAK/HEAVY_DAMAGE_MULT.
        CHECK(weak.applied == 28);
        CHECK(heavy.applied == 68);
        CHECK(weak.blocked == 72 && heavy.blocked == 32);
        CHECK(afterWeak == static_cast<std::int16_t>(base - 28));
        CHECK(afterHeavy == static_cast<std::int16_t>(base - 28 - 68));
        CHECK(ctlWeak.applied == 100);   // the control takes it all

        // Psi is deliberately NOT resisted: a steel plate does not stop a mind. This is
        // the assertion that stops "give the armoured one armour everywhere" from
        // creeping in, because that is what makes a kind unanswerable.
        const Entity psiTarget = damage_fixture(reg, MobKind::ZakalennayaArmatura);
        const DamageResult psi =
            apply_damage(reg, pool, psiTarget, 100, DamageChannel::Psi, entt::null);
        CHECK(psi.applied == 100);

        // Idempotence, and the REMOVAL half. Calling sync twice must not stack, and a
        // body whose kind changes to an unarmoured one must lose the component — the
        // same contract [combat.h]'s sync_armour has for an inventory holder.
        CHECK(sync_monster_armour(reg, armoured, static_cast<std::uint8_t>(
                                                    MobKind::ZakalennayaArmatura)));
        CHECK(reg.get<const Armour>(armoured).resist[0] == 72);
        CHECK(!sync_monster_armour(reg, armoured,
                                   static_cast<std::uint8_t>(MobKind::Nightmare)));
        CHECK(!reg.all_of<Armour>(armoured));

        // Exactly ONE kind in the table carries a resist vector. If a second appears,
        // this line is where the reviewer finds out — and the reason it matters is that
        // every extra one is 1 more of 69 kinds paying a component lookup per hit.
        std::size_t armouredKinds = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MonsterTraits& t = kMonsterTraits[k];
            for (std::size_t c = 0; c < kDamageChannels; ++c)
                if (t.resist[c] != 0) { ++armouredKinds; break; }
        }
        CHECK(armouredKinds == 1u);
    }

    // -----------------------------------------------------------------------
    // 4. COUNTERPLAY: a small fire beats a big bullet, which is the whole point
    // -----------------------------------------------------------------------
    // The inversion is the mechanic. A resist cannot express it — scaling 5 damage by
    // any multiplier keeps it small — so this is the one number in the file that had to
    // be a FLOOR. Measured against the real table HP so a CSV rebalance moves the
    // expectation instead of breaking the test.
    {
        Registry reg;
        NpcPool pool;

        const std::uint8_t plant = static_cast<std::uint8_t>(MobKind::Borshchevik);
        const std::int16_t plantHp =
            static_cast<std::int16_t>(mob_def(MobKind::Borshchevik).hp);
        // ceil(62 * 0.44) = 28.
        const std::int16_t torch = trait_counterplay_damage(
            plant, static_cast<std::uint8_t>(DamageChannel::Fire), 5, plantHp);
        const std::int16_t rifle = trait_counterplay_damage(
            plant, static_cast<std::uint8_t>(DamageChannel::Kinetic), 5, plantHp);
        std::fprintf(stderr,
                     "[monster] Borshchevik %d hp: 5-dmg fire -> %d (floor 44%%), "
                     "5-dmg kinetic -> %d\n",
                     static_cast<int>(plantHp), static_cast<int>(torch),
                     static_cast<int>(rifle));
        CHECK(torch == 28);
        CHECK(rifle == 5);          // the wrong channel is passed through untouched
        // A hit already above the floor is NOT scaled up — the floor is a minimum, not
        // a bonus, or a flamethrower would one-shot a boss.
        CHECK(trait_counterplay_damage(
                  plant, static_cast<std::uint8_t>(DamageChannel::Fire), 900,
                  plantHp) == 900);

        // End to end: three 5-damage fire swings kill it, and one 60-damage kinetic
        // round does not.
        const Entity burned = damage_fixture(reg, MobKind::Borshchevik);
        int swings = 0;
        while (mob_hp(reg, burned) > 0 && swings < 16) {
            const std::int16_t maxHp = reg.get<const MobRef>(burned).maxHp;
            const std::int16_t dmg = trait_counterplay_damage(
                plant, static_cast<std::uint8_t>(DamageChannel::Fire), 5, maxHp);
            apply_damage(reg, pool, burned, dmg, DamageChannel::Fire, entt::null);
            ++swings;
        }
        std::fprintf(stderr, "[monster] 5-dmg torch kills Borshchevik in %d swings\n",
                     swings);
        CHECK(swings == 3);
        CHECK(reg.all_of<Dead>(burned));

        const Entity shot = damage_fixture(reg, MobKind::Borshchevik);
        apply_damage(reg, pool, shot, 60, DamageChannel::Kinetic, entt::null);
        CHECK(!reg.all_of<Dead>(shot));   // 62 hp, so 60 leaves 2

        // The two 100% rows are a GUARANTEED kill from full health, which is what
        // `maxHp + 1` means and why the column is not clamped at 100.
        for (MobKind k : {MobKind::FogShark, MobKind::Swarm}) {
            const Entity e = damage_fixture(reg, k);
            const std::int16_t maxHp = reg.get<const MobRef>(e).maxHp;
            const std::int16_t d = trait_counterplay_damage(
                static_cast<std::uint8_t>(k),
                static_cast<std::uint8_t>(DamageChannel::Fire), 1, maxHp);
            CHECK(d == static_cast<std::int16_t>(maxHp + 1));
            const DamageResult r =
                apply_damage(reg, pool, e, d, DamageChannel::Fire, entt::null);
            CHECK(r.lethal);
            std::fprintf(stderr,
                         "[monster] %s: 1-dmg fire -> %d, kills %d hp outright\n",
                         mob_name(k), static_cast<int>(d), static_cast<int>(maxHp));
        }

        // Exactly four kinds are authored vulnerable, all of them on FIRE.
        std::size_t vulnKinds = 0, nonFire = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            if (!trait_has_vulnerability(static_cast<std::uint8_t>(k))) continue;
            ++vulnKinds;
            if (kMonsterTraits[k].vulnChannel !=
                static_cast<std::uint8_t>(DamageChannel::Fire)) ++nonFire;
        }
        CHECK(vulnKinds == 4u);
        CHECK(nonFire == 0u);
        // The generator's channel map is a hand-written mirror of the DamageChannel
        // enum, so its ordering is pinned from C++ — a reordered enum would otherwise
        // silently make fire counterplay land on buckshot. static_assert, not CHECK: it
        // is a compile-time constant and C4127 would fail the /W4 build.
        static_assert(static_cast<std::uint8_t>(DamageChannel::Fire) == 3u,
                      "gen_monster_traits.py CHANNEL maps FIRE to 3");
        static_assert(static_cast<std::uint8_t>(DamageChannel::Kinetic) == 0u &&
                          static_cast<std::uint8_t>(DamageChannel::Buckshot) == 1u &&
                          static_cast<std::uint8_t>(DamageChannel::Energy) == 2u &&
                          static_cast<std::uint8_t>(DamageChannel::Psi) == 4u,
                      "gen_monster_traits.py CHANNEL mirrors DamageChannel order");
    }

    // -----------------------------------------------------------------------
    // 5. TERRAIN: the query works, and NOTHING CAN STAND IN THE WATER YET
    // -----------------------------------------------------------------------
    // This block exists to keep the wet-terrain columns honest. The multipliers are
    // ported verbatim and `pos_wet` answers correctly against a real settled field —
    // and none of it can reach the player, because every wet cell `floor_gen` produces
    // is half-solid (floor_gen.cpp fills the basin with `geom.slab` and clears the top
    // four sub-mask words). A monster cannot stand in a non-air cell, so it cannot be
    // wet, so `trait_move_mult(k, true)` has no way to be selected.
    //
    // Asserted as a MEASURED ZERO rather than skipped. The day floor_gen seeds an open
    // pool — which [floor_gen.h] already anticipates — this count goes positive and the
    // CHECK below says exactly where to look.
    {
        // The authored ratios, from the reference's monsterMoveMult.
        const std::uint8_t eel = static_cast<std::uint8_t>(MobKind::TubeEel);
        CHECK(near_eq(trait_move_mult(eel, true), 1.45f));
        CHECK(near_eq(trait_move_mult(eel, false), 0.72f));
        CHECK(near_eq(trait_damage_mult(eel, true), 1.18f));
        CHECK(near_eq(trait_damage_mult(eel, false), 0.78f));
        std::fprintf(stderr,
                     "[monster] TubeEel wet/dry pace ratio %.3fx (%.2f / %.2f)\n",
                     static_cast<double>(trait_move_mult(eel, true) /
                                         trait_move_mult(eel, false)),
                     static_cast<double>(trait_move_mult(eel, true)),
                     static_cast<double>(trait_move_mult(eel, false)));

        // Лоточник is the only kind whose ARMOUR is conditional on terrain, which is
        // why it cannot ride the Armour component.
        const std::uint8_t lot = static_cast<std::uint8_t>(MobKind::Lotochnik);
        CHECK(near_eq(trait_incoming_mult(lot, true), 0.58f));
        CHECK(near_eq(trait_incoming_mult(lot, false), 1.0f));
        CHECK(near_eq(trait_wet_regen_hps(lot), 1.35f));
        // Nobody else regenerates, and nobody else has wet armour.
        std::size_t wetArmour = 0, regen = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            if (kMonsterTraits[k].wetIncomingX100 != kTraitUnit) ++wetArmour;
            if (kMonsterTraits[k].wetRegenMilliHps != 0u) ++regen;
        }
        CHECK(wetArmour == 1u && regen == 1u);

        // Exactly the six kinds carrying a wet pace bonus or a dry penalty are the six
        // allowed to spawn in water. Derived, not ported — see TerrainPref.
        std::size_t wetSpawn = 0, wetSpawnWithoutPace = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            if (!trait_allows_wet_spawn(static_cast<std::uint8_t>(k))) continue;
            ++wetSpawn;
            if (!water_paced(k)) ++wetSpawnWithoutPace;
        }
        CHECK(wetSpawn == 6u);
        CHECK(wetSpawnWithoutPace == 0u);

        // A dry world: no fluid field at all, so every query is false and no memory is
        // touched. This is the common case — most floor kinds seed no sumps.
        CHECK(!cell_wet(nullptr, 4, 5, 6));
        CHECK(!pos_wet(nullptr, vec3{10.0f, 10.0f, 10.0f}));

        World w;
        generate_floor(w, -26, floor_spec(FloorKind::Derelict), 4242u);
        for (int i = 0; i < 400; ++i)
            if (fluid_step(w).moved == 0.0f) break;

        const float* wet = fluid_data(w);
        CHECK(wet != nullptr);   // Derelict seeds sumps; if this fails the rest is moot

        int wetCells = 0, wetAndAir = 0;
        const MacroGrid& g = w.grid();
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    if (!cell_wet(wet, x, y, z)) continue;
                    ++wetCells;
                    if (g.cell(x, y, z) == kCellAir) ++wetAndAir;
                }
        std::fprintf(stderr,
                     "[monster] Derelict -26: %d wet cells, %d of them AIR "
                     "(standable). Wet multipliers are unreachable while that is 0.\n",
                     wetCells, wetAndAir);
        // Derelict authors 12 basins of 3x3 = 108 wet cells (floor_gen.cpp kGeom), so a
        // zero here means the sump seeder stopped running, not that the trait table is
        // wrong.
        CHECK(wetCells > 0);
        // THE measured blocker. Not a skip and not a TODO: a number, in the log.
        //
        // If this ever FAILS, read it in the right direction before looking at this
        // lane. Every seeded wet cell is `g.fill_cell(..., geom.slab)` with the top four
        // sub-mask words cleared, and the basin is ringed by solid kerb, so an AIR cell
        // holding liquid means water escaped a sealed basin — the containment failure
        // floor_gen.cpp's own overlap guard exists to prevent. It is also the GOOD
        // failure: an open pool is what makes every wet multiplier in the trait table
        // reachable, and then this assertion is the thing to relax, along with
        // suite_fluidrooms.inl block 4.
        CHECK(wetAndAir == 0);

        // pos_wet agrees with cell_wet on a real cell, including through the wrap. The
        // centre of a wet cell is (c + 0.5) * kCellSize.
        int probed = 0;
        for (int z = 0; z < kMacroDim && probed < 4; ++z)
            for (int y = 0; y < kMacroDim && probed < 4; ++y)
                for (int x = 0; x < kMacroDim && probed < 4; ++x) {
                    if (!cell_wet(wet, x, y, z)) continue;
                    const vec3 c{(static_cast<float>(x) + 0.5f) * kCellSize,
                                 (static_cast<float>(y) + 0.5f) * kCellSize,
                                 (static_cast<float>(z) + 0.5f) * kCellSize};
                    CHECK(pos_wet(wet, c));
                    // One full torus lap away is the same cell.
                    CHECK(pos_wet(wet, vec3{c.x + kWorldExtent, c.y, c.z}));
                    ++probed;
                }
        CHECK(probed == 4);

        // ...and the floor spawner still puts nothing in the water, which is what
        // tests/suite_fluidrooms.inl block 4 already asserts. Restated here because the
        // trait table is what would change it: `trait_allows_wet_spawn` has NO caller in
        // src/, so this number is unchanged by this lane and must stay unchanged until
        // the sealed-basin trap is answered.
        Registry reg;
        const std::uint8_t danger =
            danger_for_hostility(floor_spec(FloorKind::Derelict).hostility);
        const std::uint32_t heads = spawn_floor_mobs(
            reg, w, -26, danger, theme_for_kind(FloorKind::Derelict), /*layer=*/0,
            /*seed=*/77u, /*cap=*/256, FloorKind::Derelict);
        CHECK(heads > 0);
        int inWater = 0;
        for (auto e : reg.view<const MobRef, const Transform>()) {
            const vec3& p = reg.get<const Transform>(e).pos;
            if (cell_wet(wet, cell_of(p.x), cell_of(p.y), cell_of(p.z))) ++inWater;
        }
        std::fprintf(stderr, "[monster] %u heads spawned, %d standing in water\n",
                     heads, inWater);
        CHECK(inWater == 0);
    }

    // -----------------------------------------------------------------------
    // 6. PRECEDENCE: two pace multipliers now exist and must never both bite
    // -----------------------------------------------------------------------
    // [mob_behaviour.h] keys its pace on WALL adjacency; this table keys its pace on
    // WATER. A caller that applies both would give a kind carrying both a silent
    // product — the exact class of bug `MoveMult::claimed` was added to prevent there.
    // The two are disjoint over the shipped data, and this is the assertion that keeps
    // them disjoint rather than the comment that hopes so.
    {
        std::size_t bothPaces = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k)
            if (wall_paced(k) && water_paced(k)) ++bothPaces;
        std::fprintf(stderr,
                     "[monster] %zu kinds carry BOTH a wall pace and a water pace\n",
                     bothPaces);
        CHECK(bothPaces == 0u);

        // The same question for INCOMING damage, and this one is the near-miss.
        // Панельник's wall brace is already `behaviour_incoming_mult(WallBrace, true)`
        // = 0.58 in mob_behaviour.h; giving it a trait resist as well would stack
        // 0.58 x 0.58 = 0.34 and make it 66% resistant to everything. It therefore has
        // NO row in monster_traits.csv, and this is what keeps it that way.
        std::size_t doubleArmoured = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MobBehaviour b = static_cast<MobBehaviour>(kMobTable[k].behaviour);
            const bool behaviourArmour = behaviour_incoming_mult(b, true) != 1.0f;
            if (!behaviourArmour) continue;
            const MonsterTraits& t = kMonsterTraits[k];
            bool traitArmour = t.wetIncomingX100 != kTraitUnit;
            for (std::size_t c = 0; c < kDamageChannels; ++c)
                if (t.resist[c] != 0) traitArmour = true;
            if (traitArmour) ++doubleArmoured;
        }
        CHECK(doubleArmoured == 0u);

        // And Панельник specifically, by name, because it is the one that would have
        // been wrong: mob_behaviour owns its armour, this table owns none of it.
        const MonsterTraits& pan =
            monster_traits(static_cast<std::uint8_t>(MobKind::Panelnik));
        CHECK(pan.authored == 0u);
        CHECK(std::strcmp(monster_traits_unauthored_reason(
                              static_cast<std::uint8_t>(MobKind::Panelnik)),
                          "mob_behaviour") == 0);
        CHECK(near_eq(behaviour_incoming_mult(MobBehaviour::WallBrace, true), 0.58f));
    }

    // -----------------------------------------------------------------------
    // 7. BAIT: the column is DATA, and it settles a 6-kind disagreement
    // -----------------------------------------------------------------------
    // Stated as plainly here as in the header: `trait_takes_bait` has no reader in
    // `src/` and the bait MARKER subsystem is a separate lane. What the column is worth
    // TODAY is that it resolves a defect [mob_behaviour.h] recorded and could not
    // measure — "`foodBait` ... is read by nothing in the reference either. Its bait
    // attraction is gated by a hand-written kind list that DISAGREES with the flag for
    // 6 kinds." That list is what this column is; the disagreement is now a number.
    {
        std::size_t flagKinds = 0, baitKinds = 0, flagOnly = 0, baitOnly = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const bool flag = has_flag(kMobTable[k].aiFlags, AiFlag::FoodBait);
            const bool bait = trait_takes_bait_any(static_cast<std::uint8_t>(k));
            if (flag) ++flagKinds;
            if (bait) ++baitKinds;
            if (flag && !bait) ++flagOnly;
            if (bait && !flag) ++baitOnly;
        }
        std::fprintf(stderr,
                     "[monster] AiFlag::FoodBait %zu kinds vs authored bait list %zu; "
                     "disagree on %zu (%zu flag-only, %zu list-only)\n",
                     flagKinds, baitKinds, flagOnly + baitOnly, flagOnly, baitOnly);
        // The reference's own numbers: 10 carry the flag, 14 are in
        // BAIT_ATTRACTED_MONSTER_KINDS, and the symmetric difference is 6 — one flag
        // carrier the list omits (Мухожук-носитель) and five list members with no flag
        // (Печатеед, Конторщик, Протокольник, Слизневик, Трубный угорь). The three
        // document-hunters are the interesting half: they are baited by PAPER, which is
        // not food, so the flag was never the right predicate for them.
        CHECK(flagKinds == 10u);
        CHECK(baitKinds == 14u);
        CHECK(flagOnly == 1u);
        CHECK(baitOnly == 5u);

        // The class mapping is per-kind and not a blanket "food". A rat swarm takes
        // meat; a Сборка takes starch and sugar and neither takes the other's.
        const std::uint8_t rat = static_cast<std::uint8_t>(MobKind::Krysnozhka);
        const std::uint8_t sbor = static_cast<std::uint8_t>(MobKind::Sborka);
        CHECK(trait_takes_bait(rat, BaitBit::Meat));
        CHECK(!trait_takes_bait(rat, BaitBit::Starch));
        CHECK(trait_takes_bait(sbor, BaitBit::Starch));
        CHECK(!trait_takes_bait(sbor, BaitBit::Meat));
        // Govnyak is the universal bait: the reference's `baitMatchScore` opens with
        // `matched = marker.kind === 'govnyak'`, so every baited kind answers it.
        std::size_t baitedNotGovnyak = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const std::uint8_t kk = static_cast<std::uint8_t>(k);
            if (trait_takes_bait_any(kk) && !trait_takes_bait(kk, BaitBit::Govnyak) &&
                !trait_takes_bait(kk, BaitBit::Document))
                ++baitedNotGovnyak;
        }
        CHECK(baitedNotGovnyak == 0u);
    }
}

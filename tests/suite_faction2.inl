// Faction relations, part two — the half of [faction_relations.h] that had no
// caller, plus the event-bus values that had no producer.
//
// `test_faction_relations` in game_test.cpp already pins the authored matrix and the
// two row functions. This suite exists for a different reason: everything it touches
// was DEAD before 2026-07-29. `hostile`, `add_mutual`, `reset`,
// `reset_player_row_col`, `rel_row` and `kBaseFactionMatrix` had zero readers outside
// that one test, and four of the seven `EventType` values were published by no code
// path at all. So the assertions here are not "does the arithmetic still work" — they
// are "is the mechanic actually reachable from a game tick".
//
// This is a .inl and not a .cpp for the reason suite_samosbor.inl states: game_test
// owns the CHECK macro, so the include has to land after it, and the suite carries
// its own #include of the system under test to keep that diff two lines.

#include "game/faction_relations.h"
#include "game/room.h"     // FloorRooms — контекст свидетеля (S19)
#include "game/witness.h"  // deed_publish/witness_step — потребитель деяний
#include "world/materials.h"
#include "world/world.h"

namespace faction2 {

// The rows, spelled once.
constexpr std::uint8_t kCit = static_cast<std::uint8_t>(Faction::Citizens);
constexpr std::uint8_t kLiq = static_cast<std::uint8_t>(Faction::Liquidators);
constexpr std::uint8_t kCul = static_cast<std::uint8_t>(Faction::Cultists);
constexpr std::uint8_t kWld = static_cast<std::uint8_t>(Faction::Wild);
constexpr std::uint8_t kPly = kFactionPlayerRow;

// A bare layer id, not a pushed LevelStack layer: `faction_feud_step` never reads
// the stack or the grid, so allocating a 128^3 World per case would buy nothing but
// several megabytes and a slower test. Transform::layer is only ever compared.
constexpr LayerId kLayer = 3;

// The unarmed reach every crowd body has today: 0.5 cells x 2 m + the body-size
// slack every melee attack in the game gets. 1.9 m — the two distances below are
// chosen either side of it.
constexpr float kUnarmedReach =
    0.5f * kCellSize + kMeleeReachSlack;

// Put a record on the floor at `pos` with a faction, a health pool, and a body.
Entity make_body(Registry& reg, NpcPool& pool, Faction f, const vec3& pos,
                 std::int16_t hp, NpcId& outId) {
    const NpcId id = pool.spawn();
    pool.faction(id) = static_cast<std::uint16_t>(f);
    pool.hp(id) = hp;
    pool.max_hp(id) = hp;
    Entity e = embody(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos = pos;
    outId = id;
    return e;
}

// The first tick at which `key`'s fight licence goes false -> true, so the whole
// kFeudEpochTicks window lies ahead. Entity ids come from the registry, so a
// licensed tick has to be FOUND rather than chosen — the same idiom suite_hunt.inl
// uses for the hunting licence.
std::uint64_t first_licensed_window(std::uint32_t key) {
    bool prev = npc_seeks_fight(key, 0);
    for (std::uint64_t t = 1; t < kFeudEpochTicks * 4096u; ++t) {
        const bool now = npc_seeks_fight(key, t);
        if (now && !prev) return t;
        prev = now;
    }
    return 0;   // caller CHECKs this
}

// The first tick from which `key` is unlicensed for at least `span` consecutive
// ticks. Scanning for one merely-false tick is not enough: the licence is an
// epoch-level property and the epoch boundary sits at an identity-dependent offset,
// so a false tick can be followed by a licensed epoch on the very next one.
// `span + 1` ticks are verified and `t + 1` is returned, so the caller's window
// [t+1, t+1+span) lies entirely inside the range that was checked. Returning t
// directly would make 0 ambiguous with "not found".
std::uint64_t first_quiet_span(std::uint32_t key, std::uint64_t span) {
    for (std::uint64_t t = 0; t < kFeudEpochTicks * 4096u; t += span) {
        bool all = true;
        for (std::uint64_t k = 0; k <= span && all; ++k)
            if (npc_seeks_fight(key, t + k)) all = false;
        if (all) return t + 1;
    }
    return 0;
}

} // namespace faction2

static void test_faction2_all() {
    using namespace faction2;

    // ---- 1. The predicate, and the row it resolves through -------------------
    //
    // The load-bearing assertion is the LAST group: `bodies_hostile` goes through
    // `rel_row` and not `body_row`, which is the opposite of what `mob_hostile_to`
    // does. Both choices are deliberate and the header spends a paragraph on why, so
    // a test that does not distinguish them would let either one silently become the
    // other.
    {
        NpcPool pool;
        pool.init();
        const FactionRelations base = kBaseFactionMatrix;

        NpcId cit = pool.spawn();
        NpcId liq = pool.spawn();
        NpcId cul = pool.spawn();
        NpcId wld = pool.spawn();
        pool.faction(cit) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.faction(liq) = static_cast<std::uint16_t>(Faction::Liquidators);
        pool.faction(cul) = static_cast<std::uint16_t>(Faction::Cultists);
        pool.faction(wld) = static_cast<std::uint16_t>(Faction::Wild);

        // Wild is at exactly -50 with everyone, and the boundary is inclusive.
        CHECK(bodies_hostile(base, pool, wld, cit));
        CHECK(bodies_hostile(base, pool, wld, cul));
        // The civil bloc walks past each other.
        CHECK(!bodies_hostile(base, pool, cit, liq));
        // The cultists' police-only grudge, ported from the reference.
        CHECK(bodies_hostile(base, pool, cul, liq));
        CHECK(!bodies_hostile(base, pool, cul, cit));

        // Nobody fights themselves, and a dangling id decides nothing. Without the
        // validity guard `rel_row` folds an unknown id onto row 0, so every dead
        // handle in the game would read as a Citizen — i.e. hostile to Wild, a fight
        // started by a record that does not exist.
        CHECK(!bodies_hostile(base, pool, cit, cit));
        CHECK(!bodies_hostile(base, pool, kInvalidNpc, wld));
        CHECK(!bodies_hostile(base, pool, pool.count() + 7u, wld));

        // Now the row choice. A player wearing a CULTIST body:
        //   * diplomatically it is the PLAYER row  -> at(P, Liq) = +25, no fight
        //   * to a monster it is still a cultist   -> kMobVsFaction[Cul] = +50, ignored
        // Both must hold at once, and going through the wrong row breaks exactly one
        // of them, which is why they are asserted together.
        pool.set_player(cul, true);
        CHECK(rel_row(pool, cul) == kPly);
        CHECK(body_row(pool, cul) == kCul);
        CHECK(!bodies_hostile(base, pool, cul, liq));   // was hostile as a cultist
        CHECK(!mob_hostile_to(pool, cul));              // still ignored by monsters
        pool.set_player(cul, false);
        CHECK(bodies_hostile(base, pool, cul, liq));    // and the grudge comes back
    }

    // ---- 2. The licence is pure, SCARCE, and expires in whole windows ---------
    {
        std::uint32_t licensed = 0;
        for (std::uint32_t id = 1; id <= 6000u; ++id)
            if (npc_seeks_fight(id, 500u)) ++licensed;
        // 6000/kFeudShare is the expectation. A hash is not a shuffle, so this is a
        // band — but one tight enough that a gate stuck open or shut fails it.
        const std::uint32_t want = 6000u / kFeudShare;
        CHECK(licensed > want / 2u);
        CHECK(licensed < want * 2u);

        const std::uint64_t start = first_licensed_window(4242u);
        CHECK(start != 0);
        std::uint64_t run = 0;
        while (run < kFeudEpochTicks * 16u && npc_seeks_fight(4242u, start + run))
            ++run;
        // Whole windows, never a fragment: the licence is a function of the epoch
        // alone, so a run beginning on a boundary can only be a multiple of one.
        CHECK(run % kFeudEpochTicks == 0u);
        CHECK(run >= kFeudEpochTicks);
        CHECK(run < kFeudEpochTicks * 16u);            // and it really does expire
    }

    // ---- 3. nearest_faction_foe picks the right body, and skips the rest ------
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const FactionRelations base = kBaseFactionMatrix;

        NpcId wldId = 0, nearId = 0, farId = 0, friendId = 0, deadId = 0,
              awayId = 0;
        const vec3 home{40.0f, 40.0f, 4.0f};
        Entity wld = make_body(reg, pool, Faction::Wild, home, 100, wldId);
        Entity nearest = make_body(reg, pool, Faction::Citizens,
                                   vec3{home.x + 3.0f, home.y, home.z}, 100, nearId);
        make_body(reg, pool, Faction::Citizens,
                  vec3{home.x + 6.0f, home.y, home.z}, 100, farId);
        make_body(reg, pool, Faction::Wild,
                  vec3{home.x + 1.0f, home.y, home.z}, 100, friendId);
        Entity corpse = make_body(reg, pool, Faction::Citizens,
                                  vec3{home.x + 1.5f, home.y, home.z}, 100, deadId);
        Entity away = make_body(reg, pool, Faction::Citizens,
                                vec3{home.x + 0.5f, home.y, home.z}, 100, awayId);
        // Nearest of the lot, but on another floor.
        reg.get<Transform>(away).layer = kLayer + 1u;
        // Nearer than `nearest`, but already scheduled to die.
        reg.emplace<Dead>(corpse, Dead{wld, static_cast<std::uint8_t>(0)});

        FactionFoe foe = nearest_faction_foe(reg, pool, base, kLayer, wld, wldId,
                                             home, kFeudRadius);
        CHECK(foe.e == nearest);
        CHECK(foe.id == nearId);
        // A Wild body is not its own enemy, so the one at 1 m was rejected on the
        // predicate and not on distance.
        CHECK(foe.id != friendId);

        // The radius really bounds it: at 2 m the only bodies in range are the
        // corpse and the friend, and both are excluded.
        FactionFoe none = nearest_faction_foe(reg, pool, base, kLayer, wld, wldId,
                                              home, 2.0f);
        CHECK(none.e == entt::null);
        CHECK(none.id == kInvalidNpc);

        // With the nearest hostile removed, the next one over is taken — the query
        // is a nearest-of-many and not a first-match.
        reg.emplace<Dead>(nearest, Dead{wld, static_cast<std::uint8_t>(0)});
        FactionFoe second = nearest_faction_foe(reg, pool, base, kLayer, wld, wldId,
                                                home, kFeudRadius);
        CHECK(second.id == farId);
    }

    // ---- 4. faction_feud_step: the licence gates it, it steers, it swings,
    //         and it CAN kill the camera holder --------------------------------
    //
    // The target here is the camera holder, which makes every observation
    // unambiguous: the camera holder is excluded from being an AGGRESSOR, so exactly
    // one body in this registry is able to act.
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const FactionRelations base = kBaseFactionMatrix;

        const vec3 home{40.0f, 40.0f, 4.0f};
        const NpcId plyId = pool.spawn();
        pool.faction(plyId) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.hp(plyId) = 100;
        pool.max_hp(plyId) = 100;
        Entity player = embody_as_player(reg, pool, plyId, kLayer);
        reg.get<Transform>(player).pos = home;
        CHECK(rel_row(pool, plyId) == kPly);
        // Wild sits at -50 with the PLAYER row, so this pair is hostile from tick 0
        // and needs no relation drift to get there.
        CHECK(base.hostile(kWld, kPly));

        NpcId wldId = 0;
        Entity wld = make_body(reg, pool, Faction::Wild,
                               vec3{home.x + 1.0f, home.y, home.z}, 100, wldId);
        const std::uint32_t key = static_cast<std::uint32_t>(entt::to_integral(wld));
        // A fact about two constants, so a static_assert and not a CHECK — the same
        // rule test_inventory states about the 8x8 grid. 1 m is inside the 1.9 m
        // unarmed reach; the 5 m used below is outside it.
        static_assert(1.0f < kUnarmedReach && 5.0f > kUnarmedReach,
                      "the two test distances must straddle the unarmed reach");

        // Unlicensed, and its enemy is close enough to touch: not one hit point, not
        // one millimetre of movement. Without this the licence could be decorative
        // and every other assertion below would still pass.
        const std::uint64_t quiet = first_quiet_span(key, kFeudPeriod * 4u);
        CHECK(quiet != 0);
        reg.get<Velocity>(wld).v = vec3{0, 0, 0};
        for (std::uint64_t t = quiet; t < quiet + kFeudPeriod * 4u; ++t)
            faction_feud_step(reg, pool, base, kLayer, t);
        CHECK(pool.hp(plyId) == 100);
        CHECK(reg.get<Velocity>(wld).v.x == 0.0f);

        // Licensed and out of reach: it walks at the player. Parked five metres in
        // -x, so the steer must come out POSITIVE — wrap_delta_f(me, foe) points from
        // the actor to its target, and getting that backwards would send every
        // brawler in the game away from the fight it just picked.
        // 5 m is inside kFeudRadius (8 m) and outside the 1.9 m reach.
        const std::uint64_t open = first_licensed_window(key);
        CHECK(open != 0);
        reg.get<Transform>(wld).pos = vec3{home.x - 5.0f, home.y, home.z};
        for (std::uint64_t t = open; t < open + kFeudPeriod * 2u; ++t)
            faction_feud_step(reg, pool, base, kLayer, t);
        CHECK(reg.get<Velocity>(wld).v.x > 0.0f);      // toward the player, not away
        CHECK(reg.get<Velocity>(wld).v.y == 0.0f);     // the player is straight ahead
        CHECK(pool.hp(plyId) == 100);                  // walking is not hitting

        // Back inside reach. Physics is not running here, so the position is set
        // rather than walked to — the steer above is what proves it would walk.
        // 400 ticks = 50 visits = ~10 swings at the unarmed 5-visit cadence.
        reg.get<Transform>(wld).pos = vec3{home.x + 1.0f, home.y, home.z};
        std::uint32_t hits = 0;
        for (std::uint64_t t = open; t < open + 400u; ++t)
            hits += faction_feud_step(reg, pool, base, kLayer, t);
        CHECK(hits > 0);
        CHECK(pool.hp(plyId) < 100);
        // Standing and fighting, not shoving: in reach the velocity is zeroed, or a
        // brawler would push its victim out of the room it picked the fight in.
        CHECK(reg.get<Velocity>(wld).v.x == 0.0f);

        // The camera holder is NOT protected by the non-lethal floor. Two hit points
        // and a long window: it dies, through the ordinary Dead tag, so
        // finalize_deaths handles it exactly like every other death in the game.
        pool.hp(plyId) = 2;
        for (std::uint64_t t = open; t < open + 400u; ++t)
            faction_feud_step(reg, pool, base, kLayer, t);
        CHECK(pool.hp(plyId) == 0);
        CHECK(reg.all_of<Dead>(player));
    }

    // ---- 4b. The feud walks ITS floor, not the world's XY: under a side
    //          regime the steer lands in the tangent plane and the gravity
    //          axis stays with physics -----------------------------------------
    //
    // Mutation check: revert faction_feud_step to the literal .x/.y writes and
    // the sentinel below is overwritten -> red. Null gravity is pinned NegZ by
    // the whole of section 4 above.
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const FactionRelations base = kBaseFactionMatrix;

        const vec3 home{40.0f, 40.0f, 40.0f};
        const NpcId plyId = pool.spawn();
        pool.faction(plyId) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.hp(plyId) = 100;
        pool.max_hp(plyId) = 100;
        Entity player = embody_as_player(reg, pool, plyId, kLayer);
        reg.get<Transform>(player).pos = home;

        NpcId wldId = 0;
        // Parked 5 m in -y: under PosX gravity the y axis is TANGENT, so this
        // offset is walkable and the steer must come out +y.
        Entity wld = make_body(reg, pool, Faction::Wild,
                               vec3{home.x, home.y - 5.0f, home.z}, 100, wldId);
        const std::uint32_t key = static_cast<std::uint32_t>(entt::to_integral(wld));

        GravityField sideways;
        sideways.regime = GravityRegime::PosX;
        sideways.global = vec3{9.81f, 0.0f, 0.0f};

        const std::uint64_t open = first_licensed_window(key);
        CHECK(open != 0);
        // The sentinel: a walking feud must not touch the gravity axis — falling
        // belongs to physics under PosX exactly as v.z did under NegZ.
        reg.get<Velocity>(wld).v = vec3{0.125f, 0.0f, 0.0f};
        for (std::uint64_t t = open; t < open + kFeudPeriod * 2u; ++t)
            faction_feud_step(reg, pool, base, kLayer, t, &sideways);
        CHECK(reg.get<Velocity>(wld).v.x == 0.125f); // gravity axis untouched
        CHECK(reg.get<Velocity>(wld).v.y > 0.0f);    // toward the player, in plane
        CHECK(reg.get<Velocity>(wld).v.z == 0.0f);   // player is straight ahead
    }

    // ---- 5. ...but a feud can never kill a CROWD body ------------------------
    //
    // This is the rule that makes the feature safe to switch on at all: nothing in
    // the game heals a resident ([needs.h] advances only the camera holder's row), so
    // damage to the crowd is permanent. Asserted as a bottom-out at the EXACT
    // kFeudMinHpPct value rather than as "some damage", because an off-by-one in the
    // clamp is the whole failure mode — and because a floor of 1 HP residents would
    // silently multiply the predation rate [hunt.h] measured.
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const FactionRelations base = kBaseFactionMatrix;

        NpcId wldId = 0, citId = 0, frailId = 0;
        const vec3 home{40.0f, 40.0f, 4.0f};
        Entity wld = make_body(reg, pool, Faction::Wild, home, 100, wldId);
        make_body(reg, pool, Faction::Citizens,
                  vec3{home.x + 1.0f, home.y, home.z}, 100, citId);
        const std::uint32_t key = static_cast<std::uint32_t>(entt::to_integral(wld));
        const std::uint64_t open = first_licensed_window(key);
        CHECK(open != 0);

        // One whole licence window: ~62 swings at the unarmed cadence, i.e. 186
        // damage offered against a 100 HP body.
        for (std::uint64_t t = open; t < open + kFeudEpochTicks; ++t)
            faction_feud_step(reg, pool, base, kLayer, t);
        // Derived from the constant, not spelled as 50: a tuner who moves
        // kFeudMinHpPct should see this pass, and see section 4's lethality assertion
        // keep working, rather than see an unrelated literal fail.
        CHECK(pool.hp(citId) == static_cast<std::int16_t>(100 * kFeudMinHpPct / 100));
        CHECK(pool.alive(citId));
        CHECK(!reg.all_of<Dead>(wld));      // and no corpse anywhere in the pair

        // A body so frail the percentage floor rounds to nothing still cannot be
        // killed: the clamp has an absolute backstop at 1. Max HP 2 -> floor 1, and
        // it is placed NEARER than the citizen so the nearest-foe query picks it.
        make_body(reg, pool, Faction::Citizens,
                  vec3{home.x - 0.5f, home.y, home.z}, 2, frailId);
        for (std::uint64_t t = open; t < open + kFeudEpochTicks; ++t)
            faction_feud_step(reg, pool, base, kLayer, t);
        CHECK(pool.hp(frailId) == 1);
        CHECK(pool.alive(frailId));
    }

    // Two FRIENDLY bodies in the same square metre, over two whole windows, must
    // never exchange a point. The control for everything above: if the predicate were
    // ignored, this is the assertion that fails.
    //
    // Its own scope, not a continuation of the one above: NpcPool::init() commits
    // ~517 MB (493 B x 2^20 rows), so two live at once is a gigabyte for no reason.
    {
        Registry calm;
        NpcPool cpool;
        cpool.init();
        const FactionRelations base = kBaseFactionMatrix;
        const vec3 home{40.0f, 40.0f, 4.0f};
        NpcId a = 0, b = 0;
        make_body(calm, cpool, Faction::Citizens, home, 100, a);
        make_body(calm, cpool, Faction::Liquidators, home, 100, b);
        for (std::uint64_t t = 0; t < kFeudEpochTicks * 2u; ++t)
            faction_feud_step(calm, cpool, base, kLayer, t);
        CHECK(cpool.hp(a) == 100);
        CHECK(cpool.hp(b) == 100);
    }

    // ---- 6. СВИДЕТЕЛЬСТВО (S19): убийство имеет цену, ТОЛЬКО ЗАМЕЧЕННОЕ -----
    //
    // Прежний relations_drain_deaths был всевидящ — матрица гнулась без
    // единого свидетеля (расхождение S19.3, закрыто witness_step): деяние
    // «убить» — строка цены verbs.csv, прогнанная через воспринявших.
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        EventBus bus;
        bus.init();
        World w;              // голый воздух: зрение свидетеля ничем не заперто
        FloorRooms rooms;     // комнат нет: ни уместности, ни репутации места

        FactionRelations rel{};
        rel.reset();
        CHECK(rel.at(kPly, kCit) == 50);

        const vec3 home{40.0f, 40.0f, 4.0f};
        const NpcId pid = pool.spawn();
        pool.faction(pid) = static_cast<std::uint16_t>(Faction::Liquidators);
        pool.hp(pid) = 100;
        pool.max_hp(pid) = 100;
        Entity player = embody_as_player(reg, pool, pid, kLayer);
        reg.get<Transform>(player).pos = home;

        // Свидетель-горожанин в двух метрах: видит (sub_march чист).
        NpcId bystander = 0;
        make_body(reg, pool, Faction::Citizens,
                  vec3{home.x + 2.0f, home.y, home.z}, 100, bystander);
        CHECK(!bodies_hostile(rel, pool, pid, bystander));

        // ЗАМЕЧЕННОЕ убийство горожанина при горожанине: жертва из фракции
        // свидетеля → цена = rel_delta(kill) × victim_mult = −10 × 1.5 = −15.
        {
            NpcId victim = 0;
            Entity v = make_body(reg, pool, Faction::Citizens, home, 100, victim);
            reg.destroy(v);                       // обе половины finalize_deaths
            pool.kill(victim);
            deed_publish(bus, kVerbKill, player, victim, home, 1u);
            const WitnessTick wt =
                witness_step(reg, pool, rel, bus, rooms, w, kLayer, 1u);
            CHECK(wt.deeds == 1);
            CHECK(wt.witnessed == 1);
            CHECK(wt.changes == 1);
            CHECK(rel.at(kPly, kCit) == 35);      // 50 − 15
            CHECK(bus.cycle_count(EventType::RelationChanged) == 1);
            const Event& last = bus.events()[bus.size() - 1];
            CHECK(last.type == EventType::RelationChanged);
            CHECK(last.a == kPly && last.b == kCit);
            CHECK(event_relation(last.c) == 35);
            bus.clear();
        }

        // НЕЗАМЕЧЕННОЕ убийство — НОВЫЙ ЗАКОН: деяние в 60 м (за зрением 25 м
        // и слухом kill 12 м) оставляет труп, но не дипломатию. Идеальное
        // преступление возможно по построению.
        {
            const std::int8_t before = rel.at(kPly, kCit);
            NpcId victim = 0;
            Entity v = make_body(reg, pool, Faction::Citizens, home, 100, victim);
            reg.destroy(v);
            pool.kill(victim);
            deed_publish(bus, kVerbKill, player, victim,
                         vec3{home.x + 60.0f, home.y, home.z}, 2u);
            const WitnessTick wt =
                witness_step(reg, pool, rel, bus, rooms, w, kLayer, 2u);
            CHECK(wt.deeds == 1);
            CHECK(wt.witnessed == 0);
            CHECK(wt.changes == 0);
            CHECK(rel.at(kPly, kCit) == before);
            bus.clear();
        }

        // СТЕНА СКРЫВАЕТ ЗРЕНИЕ (sub_march), а деяние стоит ЗА ПРЕДЕЛОМ
        // СЛУХА (22 м > hear_m(kill)=12 из verbs.csv) — цены нет. Слух с
        // 2026-09-06 прямолинейный (шары вырезаны, problems.md §65): стена
        // сама по себе звук больше не глушит, глушит дистанция.
        {
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    w.grid().fill_cell(15, y, z, kMatConcrete);
            const std::int8_t before = rel.at(kPly, kCit);
            NpcId victim = 0;
            Entity v = make_body(reg, pool, Faction::Citizens, home, 100, victim);
            reg.destroy(v);
            pool.kill(victim);
            // Деяние по ту сторону плоскости-клетки x=15 (деяние в клетке 10,
            // свидетель в клетке 21 — стена ровно между).
            const vec3 far{20.0f, home.y, home.z};
            deed_publish(bus, kVerbKill, player, victim, far, 3u);
            const WitnessTick wt =
                witness_step(reg, pool, rel, bus, rooms, w, kLayer, 3u);
            CHECK(wt.witnessed == 0);
            CHECK(rel.at(kPly, kCit) == before);
            bus.clear();
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    w.grid().clear_cell(15, y, z);
        }

        // Убийство МОНСТРОМ — не дипломатия (актор без NpcRef).
        {
            const std::int8_t before = rel.at(kPly, kCit);
            Entity mob = reg.create();
            NpcId victim = 0;
            Entity v = make_body(reg, pool, Faction::Citizens, home, 100, victim);
            reg.destroy(v);
            pool.kill(victim);
            deed_publish(bus, kVerbKill, mob, victim, home, 4u);
            const WitnessTick wt =
                witness_step(reg, pool, rel, bus, rooms, w, kLayer, 4u);
            CHECK(wt.changes == 0);
            CHECK(rel.at(kPly, kCit) == before);
            bus.clear();
        }

        // Свидетель ИЗ ФРАКЦИИ АКТОРА дипломатию не двигает (свои — прест-
        // упление, не дипломатия); ТРЕТЬЯ фракция братоубийство судит.
        {
            pool.set_player(pid, false);
            CHECK(rel_row(pool, pid) == kLiq);
            const std::int8_t before = rel.at(kLiq, kCit);
            NpcId sameRow = 0;
            Entity v = make_body(reg, pool, Faction::Liquidators, home, 100,
                                 sameRow);
            reg.destroy(v);
            pool.kill(sameRow);
            deed_publish(bus, kVerbKill, player, sameRow, home, 5u);
            const WitnessTick wt =
                witness_step(reg, pool, rel, bus, rooms, w, kLayer, 5u);
            // Горожанин-свидетель судит: жертва НЕ его фракции — базовая
            // цена −10 без множителя жертвы.
            CHECK(wt.changes == 1);
            CHECK(rel.at(kLiq, kCit) == before - 10);
            CHECK(rel.at(kLiq, kLiq) == 100); // диагональ не тронута
            pool.set_player(pid, true);
            bus.clear();
        }

        // Rebirth. The player's row and column go back to authored; the world's
        // own politics do not.
        rel.add_mutual(kCit, kLiq, -70);
        rel.reset_player_row_col();
        CHECK(rel.at(kPly, kCit) == 50);              // forgiven
        CHECK(!bodies_hostile(rel, pool, pid, bystander));
    }

    // ---- 7. Event payloads: the signed slot, and the per-type tally ----------
    {
        // A floor number is signed and the demo stack reaches -50, while the slots
        // are u32. Reading a raw slot straight back gives 4294967246 for floor -50 —
        // not a crash, just a number a HUD prints and nobody questions. C++20
        // mandates two's complement, so the round trip is guaranteed, not merely
        // usual.
        CHECK(event_floor(pack_floor(-50)) == -50);
        CHECK(event_floor(pack_floor(0)) == 0);
        CHECK(event_floor(pack_floor(30)) == 30);
        CHECK(pack_floor(-50) == 4294967246u);        // what the raw slot holds
        CHECK(event_relation(pack_relation(std::int8_t{-128})) == -128);
        CHECK(event_relation(pack_relation(kHostileRelation)) == kHostileRelation);
        CHECK(event_relation(pack_relation(std::int8_t{127})) == 127);

        EventBus bus;
        bus.init();
        CHECK(bus.total_count(EventType::FloorEntered) == 0);

        CHECK(publish_floor_entered(bus, -50, 7u, 1234u, 8u));
        CHECK(publish_npc_migrated(bus, 1234u, 0, -50, 8u));
        CHECK(publish_npc_spawned(bus, 900u, 40u, -50, 8u));
        CHECK(bus.size() == 3);
        CHECK(event_floor(bus.events()[0].a) == -50);
        CHECK(bus.events()[0].b == 7u);               // the LayerId, NOT the label
        CHECK(bus.events()[0].c == 1234u);
        CHECK(event_floor(bus.events()[1].b) == 0);
        CHECK(event_floor(bus.events()[1].c) == -50);
        CHECK(bus.events()[2].a == 900u && bus.events()[2].b == 40u);

        // The tally is what gives a published event a reader at all. `cycle_` dies
        // with the batch; `total_` is the figure worth showing, because a per-cycle
        // count cannot answer "is this producer firing".
        CHECK(bus.cycle_count(EventType::FloorEntered) == 1);
        CHECK(bus.cycle_count(EventType::ItemTransferred) == 0);
        bus.clear();
        CHECK(bus.cycle_count(EventType::FloorEntered) == 0);
        CHECK(bus.total_count(EventType::FloorEntered) == 1);
        CHECK(bus.total_count(EventType::NpcMigrated) == 1);
        CHECK(bus.total_count(EventType::NpcSpawned) == 1);

        // Overflow: a dropped event is counted as a DROP and not as a publish, so
        // total_count + dropped is the number offered and the two never
        // double-count. One CHECK for the fill, not 4096.
        bool allFit = true;
        for (std::size_t i = 0; i < EventBus::kCapacity; ++i)
            if (!bus.publish(EventType::ItemTransferred, 1u, 2u, 3u)) allFit = false;
        CHECK(allFit);
        CHECK(bus.dropped() == 0);
        CHECK(!bus.publish(EventType::ItemTransferred, 1u, 2u, 3u));
        CHECK(!bus.publish(EventType::ItemTransferred, 1u, 2u, 3u));
        CHECK(bus.dropped() == 2);
        CHECK(bus.total_count(EventType::ItemTransferred) == EventBus::kCapacity);
        CHECK(bus.cycle_count(EventType::ItemTransferred) == EventBus::kCapacity);
        bus.clear();
        CHECK(bus.dropped() == 2);                    // since-init, on purpose
    }
}

// ЛАЗАНЬЕ — ИГРОВАЯ ПОЛОВИНА ЗАКОНА (CANON S30, владелец 2026-11-28).
//
// Физическая половина (тело лезет, упёршись; потолок не пускает; три
// гравитации) судится в `test_climb_law@tests/world_test.cpp`. Здесь — то, что
// решает ведение:
//   * дверь шага судит вертикаль по СПОСОБНОСТИ тела: лазающему шаг вверх
//     исполним (`up`), нелазающему — `StepUp`; шаг вниз — не лазанье;
//   * единственный писатель ставит просьбы: шаг вверх — «лезь, пока касаешься»,
//     ведомый шаг — «лезь, если упёрся»;
//   * ДОЗОР ХОДА: ведомое к зоне тело, не сдвинувшееся на меру хода дольше
//     окна, помечено; окно — по способу исполнения (идёт или лезет); ход и
//     смена цели метку снимают;
//   * заявители бросают цель, которую дозор назвал неисполнимой (наряд,
//     прогулка; дело читает тот же предикат той же строкой — `place.cpp`).
#include <cstdint>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"
#include "game/embody.h"
#include "game/guide.h"
#include "game/npc_pool.h"
#include "game/patrol.h"
#include "game/wander.h"
#include "game/zone_nav.h"
#include "sim/physics.h"   // kContactSkin — тело стоит на полу вплотную
#include "world/clearance.h"
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/world.h"

namespace climb_test {

using namespace giga;
using namespace giga::game;

// Три зоны над воздухом: 1 — клетка (20,20,10), 2 — прямо НАД ней, 3 — сбоку от
// 2 по +x. Бейк настоящий (граф, таблица, поле), оракул — пустой мир.
void arm_vertical(ZoneNav& zn) {
    zn = ZoneNav{};
    World air;
    ClearanceField oracle;
    oracle.build(air.grid());
    zn.part.zones = 3u;
    zn.part.at.assign(kMacroCells, kNoRoom);
    zn.part.at[macro_index(20, 20, 10)] = 1u;
    zn.part.at[macro_index(20, 20, 11)] = 2u;
    zn.part.at[macro_index(21, 20, 11)] = 3u;
    zn.part.cells = 3u;
    bake_zone_graph(zn.part, oracle, kBodyClearanceSub, zn.graph);
    bake_zone_dist(zn.graph, zn.dist, /*threads=*/0);
    bake_zone_flow(zn.part, zn.graph, oracle, kBodyClearanceSub,
                   GravityRegime::NegZ, zn.flow);
}

vec3 centre(int x, int y, int z) {
    return vec3{(static_cast<float>(x) + 0.5f) * kCellSize,
                (static_cast<float>(y) + 0.5f) * kCellSize,
                (static_cast<float>(z) + 0.5f) * kCellSize};
}

Entity resident(Registry& reg, NpcPool& pool, const vec3& pos, float climb) {
    const NpcId id = pool.spawn();
    const Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{pos, 0u});
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{vec3{0.4f, 0.4f, 0.9f}});
    reg.emplace<NpcRef>(e, NpcRef{id, pool.generation(id)});
    Climb c;
    c.speed = climb;
    reg.emplace<Climb>(e, c);
    return e;
}

void door_judges_by_ability() {
    ZoneNav zn;
    arm_vertical(zn);
    CHECK(zn.built());
    const vec3 pos = centre(20, 20, 10);
    const vec3 half{0.4f, 0.4f, 0.9f};
    const GravityFrame negZ = steer_frame_of(nullptr);
    const SteerStep no = steer_to_zone(zn, negZ, SteerGround{}, pos, half, 20,
                                       20, 10, 1u, 2u, /*climbs=*/false);
    CHECK(no.fail == SteerFail::StepUp && !no.up);
    const SteerStep yes = steer_to_zone(zn, negZ, SteerGround{}, pos, half, 20,
                                        20, 10, 1u, 2u, /*climbs=*/true);
    CHECK(yes.fail == SteerFail::None && yes.up);
    CHECK(yes.dir.x == 0.0f && yes.dir.y == 0.0f && yes.dir.z == 0.0f);
    // Тот же шаг +z под тягой ВВЕРХ — это шаг ВНИЗ: его исполняет тяга, а не
    // лазанье. Знак берётся у фрейма, а не у буквы оси.
    GravityField posZ;
    posZ.regime = GravityRegime::PosZ;
    posZ.global = vec3{0.0f, 0.0f, 9.81f};
    const GravityFrame upZ = steer_frame_of(&posZ);
    const SteerStep down = steer_to_zone(zn, upZ, SteerGround{}, pos, half, 20,
                                         20, 10, 1u, 2u, /*climbs=*/true);
    CHECK(down.fail == SteerFail::StepUp && !down.up);
}

void writer_asks_to_climb() {
    Registry reg;
    NpcPool pool;
    pool.init();
    ZoneNav zn;
    arm_vertical(zn);
    const Entity climber = resident(reg, pool, centre(20, 20, 10), 0.2f);
    const Entity walker = resident(reg, pool, centre(20, 20, 10), 0.0f);
    const Entity mover = resident(reg, pool, centre(20, 20, 11), 0.2f);
    const std::uint64_t t = 5;
    CHECK(steer_claim(reg, climber, t, SteerRank::Patrol,
                      target_zone(2u, kWalkSpeedMps)));
    CHECK(steer_claim(reg, walker, t, SteerRank::Patrol,
                      target_zone(2u, kWalkSpeedMps)));
    CHECK(steer_claim(reg, mover, t, SteerRank::Walk,
                      target_zone(3u, kWalkSpeedMps)));
    const GuideTick g = guide_step(reg, zn, 0u, t, nullptr, nullptr);
    // Лазающему вертикаль исполнима: держаться и лезть, касательной скорости нет.
    CHECK(g.climbUp == 1u);
    CHECK(reg.get<Climb>(climber).up);
    CHECK(reg.get<Velocity>(climber).v.x == 0.0f);
    // Нелазающему — нет: писатель скорость не пишет, просьбы не ставит.
    CHECK(g.unresolved == 1u);
    CHECK(!reg.get<Climb>(walker).up && !reg.get<Climb>(walker).wants);
    // Ведомому шагом вбок — «лезь, если упёрся», без «вверх».
    CHECK(reg.get<Climb>(mover).wants && !reg.get<Climb>(mover).up);
    CHECK(reg.get<Velocity>(mover).v.x > 0.0f);
}

// Сколько тиков подряд тело стоит, пока дозор не скажет «упёрся».
std::uint64_t ticks_to_stall(float climbSpeed, bool climbing) {
    Registry reg;
    NpcPool pool;
    pool.init();
    ZoneNav zn;
    arm_vertical(zn);
    const Entity e = resident(reg, pool, centre(20, 20, 11), climbSpeed);
    for (std::uint64_t t = 1; t < 4000; ++t) {
        steer_claim(reg, e, t, SteerRank::Walk, target_zone(3u, kWalkSpeedMps));
        reg.get<Climb>(e).climbing = climbing; // отчёт физики — рукой
        (void)guide_step(reg, zn, 0u, t, nullptr, nullptr);
        if (steer_stalled(reg, e, 3u)) return t - 1; // отсчёт начат на тике 1
    }
    return 0;
}

void watch_drops_the_unexecutable() {
    // Окно идущего — мера хода шагом заявки дважды; лезущего — лазаньем.
    const float walkWin = 2.0f * kProgressMetres / kWalkSpeedMps *
                          static_cast<float>(kSimHz);
    const float climbWin =
        2.0f * kProgressMetres / 0.2f * static_cast<float>(kSimHz);
    const std::uint64_t w = ticks_to_stall(0.2f, false);
    CHECK(w == static_cast<std::uint64_t>(walkWin) + 1u);
    const std::uint64_t c = ticks_to_stall(0.2f, true);
    CHECK(c == static_cast<std::uint64_t>(climbWin) + 1u);

    // Ход метку снимает; смена цели — тоже.
    Registry reg;
    NpcPool pool;
    pool.init();
    ZoneNav zn;
    arm_vertical(zn);
    const Entity e = resident(reg, pool, centre(20, 20, 11), 0.0f);
    std::uint64_t t = 1;
    for (; t < 400 && !steer_stalled(reg, e, 3u); ++t) {
        steer_claim(reg, e, t, SteerRank::Walk, target_zone(3u, kWalkSpeedMps));
        (void)guide_step(reg, zn, 0u, t, nullptr, nullptr);
    }
    CHECK(steer_stalled(reg, e, 3u));
    reg.get<Transform>(e).pos.x += 1.1f * kProgressMetres;
    steer_claim(reg, e, t, SteerRank::Walk, target_zone(3u, kWalkSpeedMps));
    (void)guide_step(reg, zn, 0u, t, nullptr, nullptr);
    CHECK(!steer_stalled(reg, e, 3u));
    // Метка про прежнюю цель ответом про новую не считается.
    reg.get<SteerProgress>(e).stalled = true;
    CHECK(!steer_stalled(reg, e, 1u));
}

// Заявитель бросает цель, которую дозор назвал неисполнимой: наряд и прогулка.
void claimants_drop_the_stalled_goal() {
    ZoneNav zn;
    arm_vertical(zn);
    MacroGrid grid;
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const Entity e = resident(reg, pool, centre(20, 20, 11), 0.0f);
        AiBrain brain;
        brain.currentIntent = IntentPatrol;
        reg.emplace<AiBrain>(e, brain);
        PatrolPlan plan;
        plan.zoneTo = 3u;
        reg.emplace<PatrolPlan>(e, plan);
        reg.emplace<SteerProgress>(e, SteerProgress{centre(20, 20, 11), 0u, 3u, true});
        (void)ai_patrol_step(reg, zn, 0u, nullptr, 7u, nullptr);
        CHECK(reg.get<PatrolPlan>(e).zoneTo != 3u);
    }
    // Прогулке грид обязателен (сторож края), поэтому под телом и по ходу — пол:
    // иначе цель снял бы СТОРОЖ, а не дозор, и сцена мерила бы не то. Контроль —
    // та же сцена без метки дозора: цель обязана остаться.
    for (int x = 19; x <= 23; ++x) grid.fill_cell(x, 20, 10, 1);
    for (int stalled = 0; stalled <= 1; ++stalled) {
        Registry reg;
        NpcPool pool;
        pool.init();
        vec3 pos = centre(20, 20, 11);
        pos.z = 11.0f * kCellSize + 0.9f + kContactSkin; // стоит на полу клетки 10
        const Entity e = resident(reg, pool, pos, 0.0f);
        reg.emplace<WanderTarget>(e, WanderTarget{3u, 0u, 0u});
        reg.emplace<SteerProgress>(e, SteerProgress{pos, 0u, 3u, stalled != 0});
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
            (void)wander_step(reg, grid, pool, zn, 0u, t);
        CHECK((reg.get<WanderTarget>(e).zone != 3u) == (stalled != 0));
    }
}

} // namespace climb_test

static void test_climb_all() {
    climb_test::door_judges_by_ability();
    climb_test::writer_asks_to_climb();
    climb_test::watch_drops_the_unexecutable();
    climb_test::claimants_drop_the_stalled_goal();
}

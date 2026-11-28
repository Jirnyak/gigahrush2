// tests/suite_soak.inl
// Детерминированный Level 4.1 Soak-тест (matwej.md §11.4.1):
// 3000 тиков полного headless-цикла (физика, навигация по зонам, Самосбор,
// нужды/смерти, карв, пятна StainRGB, раундтрип floor_file + save на 1500-м тике)
// без единой заглушки. Включается из tests/game_test.cpp.

#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

#include "core/tick.h"
#include "core/wrap.h"
#include "game/combat.h"
#include "game/embody.h"
#include "game/floor_gen.h"
#include "game/guide.h"
#include "game/needs.h"
#include "game/population.h"
#include "game/room.h"
#include "game/samosbor.h"
#include "game/save.h"
#include "game/wander.h"
#include "game/zone_nav.h"
#include "sim/physics.h"
#include "world/clearance.h"
#include "world/destruct.h"
#include "world/floor_awaken.h"
#include "world/level_stack.h"
#include "world/stain.h"

namespace soak_test {

using namespace giga;
using namespace giga::game;

static void check_bodies_finite_and_toroidal(Registry& reg, LayerId layer) {
    auto view = reg.view<const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        CHECK(std::isfinite(tr.pos.x));
        CHECK(std::isfinite(tr.pos.y));
        CHECK(std::isfinite(tr.pos.z));
        CHECK(tr.pos.x >= 0.0f && tr.pos.x < kWorldExtent);
        CHECK(tr.pos.y >= 0.0f && tr.pos.y < kWorldExtent);
        CHECK(tr.pos.z >= 0.0f && tr.pos.z < kWorldExtent);
    }
}

static void run_soak_3000_ticks_with_save_cycle() {
    constexpr int kFloorNumber = 0;
    constexpr std::uint32_t kSeed = 4242u;
    constexpr std::uint64_t kHalfTicks = 1500u;
    constexpr std::uint64_t kTotalTicks = 3000u;

    const FloorSpec spec = floor_spec(FloorKind::Residential);

    auto stack = std::make_unique<LevelStack>();
    const LayerId layer = stack->push_layer();
    World& w = stack->layer(layer);

    floor_declare_rules(w, kFloorNumber, spec, kSeed);
    generate_floor(w, kFloorNumber, spec, kSeed);
    floor_apply_rules(w, kFloorNumber, spec, kSeed);
    (void)floor_awaken(w);
    CHECK(audit_sub_pages(w).violations() == 0u);

    FloorRooms fr;
    rooms_declare(fr, kFloorNumber, spec, kSeed);
    ClearanceField oracle;
    oracle.build(w.grid());
    ZoneNav zn;
    bake_zone_nav(fr, oracle, kBodyClearanceSub, w.gravity().regime, zn,
                  /*threads=*/0);
    CHECK(zn.built());
    CHECK(zn.flow.planes <= kZoneFlowMaxPlanes);
    CHECK(zn.bytes() <= 48u * 1024u * 1024u);

    NpcPool pool;
    pool.init();
    pool.set_recycling(true);
    const NpcId playerCand = seed_floor_from_spec(pool, kFloorNumber, spec, kSeed);
    CHECK(playerCand != kInvalidNpc);

    Registry reg;
    Entity player = entt::null;
    const std::vector<NpcId> bucket = pool.floor_bucket(kFloorNumber);
    CHECK(!bucket.empty());
    for (NpcId id : bucket) {
        if (id == playerCand)
            player = embody_as_player(reg, pool, id, layer);
        else
            (void)embody(reg, pool, id, layer);
    }
    CHECK(player != entt::null);
    CHECK(wander_init(reg, layer) > 0u);

    SamosborRng sRng{kSeed};
    SamosborState sam = samosbor_new_game(sRng);
    EventBus bus;
    CarveScratch scratch;
    CarveResult carveRes;
    std::vector<std::uint32_t> excreted;
    std::vector<std::uint32_t> stainDirty;

    std::uint64_t walkedSum = 0;
    std::uint64_t ledSum = 0;
    std::uint32_t carvedAtoms = 0;

    auto step_range = [&](std::uint64_t fromTick, std::uint64_t toTick,
                          LevelStack& curStack, LayerId curLayer,
                          Registry& curReg, NpcPool& curPool) {
        World& curW = curStack.layer(curLayer);
        for (std::uint64_t tick = fromTick; tick < toTick; ++tick) {
            (void)samosbor_step(sam, static_cast<std::uint32_t>(kSimStepMs),
                                kFloorNumber, sRng);

            const WanderTick wt =
                wander_step(curReg, curW.grid(), curPool, zn, curLayer, tick,
                            &curW.gravity());
            walkedSum += wt.walking;

            const GuideTick gt =
                guide_step(curReg, zn, curLayer, tick, &curW.gravity(),
                           &curW.grid());
            CHECK(gt.bogus == 0u);
            ledSum += gt.led;

            physics_step(curReg, curStack, kSimDt);

            excreted.clear();
            (void)needs_step(curReg, curPool, curLayer, kSimDt, nullptr,
                             static_cast<double>(tick) * kSimDt, &bus, tick,
                             &curW, &excreted, &fr);

            (void)finalize_deaths(curReg, curStack, curPool, bus, tick);

            if ((tick % 600u) == 250u) {
                const int px = 16 + static_cast<int>((tick / 600u) * 8u);
                CarveOp op;
                op.x = (static_cast<float>(px) + 0.5f) * kCellSize;
                op.y = 20.5f * kCellSize;
                op.z = 2.5f * kCellSize;
                op.radius = 1.6f;
                op.power = 0xFFFF;
                op.seed = static_cast<std::uint32_t>(tick + 7u);
                carvedAtoms += static_cast<std::uint32_t>(
                    carve_sphere(curW, op, scratch, carveRes));
                stainDirty.clear();
                (void)stain_splat(curW, vec3{op.x, op.y, op.z},
                                  vec3{0.0f, 0.0f, -1.0f}, 3.0f, 24,
                                  kStainBlood,
                                  static_cast<std::uint32_t>(tick + 13u),
                                  stainDirty);
                (void)settle_uniform_pages(curW);
                CHECK(audit_sub_pages(curW).violations() == 0u);
            }
        }
    };

    step_range(0u, kHalfTicks, *stack, layer, reg, pool);
    check_bodies_finite_and_toroidal(reg, layer);
    CHECK(audit_sub_pages(w).violations() == 0u);

    std::vector<Entity> liveToFold;
    for (auto e : reg.view<const Transform, const NpcRef>()) {
        if (reg.get<const Transform>(e).layer == layer)
            liveToFold.push_back(e);
    }
    for (Entity e : liveToFold) {
        const NpcRef ref = reg.get<const NpcRef>(e);
        fold_back(reg, pool, ref, e);
    }

    (void)settle_uniform_pages(w);
    FloorModuleKey fKey{static_cast<std::uint8_t>(FloorKind::Residential), kSeed,
                        module_gen_version(FloorKind::Residential)};
    std::vector<std::uint8_t> floorBytes;
    floor_file_write(w, kFloorNumber, floorBytes, nullptr, &fKey, nullptr);
    CHECK(!floorBytes.empty());

    SaveState saved;
    saved.samosbor = sam;
    pool.save_rows(saved.poolBlob);
    std::vector<std::uint8_t> runBytes;
    save_write(saved, runBytes);
    CHECK(!runBytes.empty());

    auto stack2 = std::make_unique<LevelStack>();
    const LayerId layer2 = stack2->push_layer();
    World& w2 = stack2->layer(layer2);
    floor_declare_rules(w2, kFloorNumber, spec, kSeed);
    generate_floor(w2, kFloorNumber, spec, kSeed);

    std::int32_t readFloor = -1;
    SaveError fErr = SaveError::None;
    CHECK(floor_file_read(floorBytes.data(), floorBytes.size(), w2, &readFloor,
                          &fErr, &fKey, nullptr));
    CHECK(readFloor == kFloorNumber);
    CHECK(fErr == SaveError::None);
    (void)floor_awaken(w2);
    CHECK(audit_sub_pages(w2).violations() == 0u);

    SaveState loaded;
    SaveError rErr = SaveError::None;
    CHECK(save_read(runBytes.data(), runBytes.size(), loaded, &rErr));
    CHECK(rErr == SaveError::None);

    NpcPool pool2;
    pool2.init();
    pool2.set_recycling(true);
    CHECK(pool2.load_rows(loaded.poolBlob.data(), loaded.poolBlob.size()));
    sam = loaded.samosbor;

    Registry reg2;
    for (NpcId id : pool2.floor_bucket(kFloorNumber)) {
        if (id == playerCand)
            (void)embody_as_player(reg2, pool2, id, layer2);
        else
            (void)embody(reg2, pool2, id, layer2);
    }
    CHECK(wander_init(reg2, layer2) > 0u);

    oracle.build(w2.grid());
    bake_zone_nav(fr, oracle, kBodyClearanceSub, w2.gravity().regime, zn,
                  /*threads=*/0);
    CHECK(zn.built());

    step_range(kHalfTicks, kTotalTicks, *stack2, layer2, reg2, pool2);
    check_bodies_finite_and_toroidal(reg2, layer2);
    (void)settle_uniform_pages(w2);
    CHECK(audit_sub_pages(w2).violations() == 0u);
    CHECK(walkedSum > 0u);
    CHECK(ledSum > 0u);
    (void)carvedAtoms;
}

} // namespace soak_test

void test_soak_all() {
    soak_test::run_soak_3000_ticks_with_save_cycle();
}

// The unified particle pool's GAME half ([game/particles.h] +
// generated particle_table.h): the type table is sane rows, the burst queue is
// a bounded POD ring, and apply_damage is THE blood writer — a landed hit
// proposes a burst, a Psi hit and a null queue propose nothing.
//
// The GPU half (pool sim, voxel collision, billboards) is render-side and
// deliberately untestable headless — same split as wires.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/combat.h"
#include "game/mob_spawn.h"
#include "game/particle_table.h"
#include "game/particles.h"

// Generated table: every row holds usable physics and identity.
static void test_particle_table_rows() {
    // The generated table's length and the enum's Count are two homes for one
    // number; a regenerated table that disagrees with the enum must not link.
    // static_assert and not CHECK: both sides are compile-time constants, so the
    // CHECK was MSVC /W4 C4127 ([jirnyak.md] §12), and this claim guards the
    // bounds of the loop below — failing at compile time beats reading garbage.
    static_assert(kParticleKindCount ==
                      static_cast<std::uint8_t>(ParticleKind::Count),
                  "particle_table.h rows must match ParticleKind::Count");
    for (std::uint8_t i = 0; i < kParticleKindCount; ++i) {
        const ParticleDef& d = kParticleTable[i];
        CHECK(d.id != nullptr && d.id[0] != '\0');
        CHECK(d.lifeS > 0.0f);
        CHECK(d.sizeM > 0.0f);
        CHECK(d.drag > 0.0f && d.drag <= 1.0f);
        CHECK(d.bounce >= 0.0f && d.bounce < 1.0f);
        CHECK(d.gravityMul >= 0.0f);
        CHECK(d.speedMps >= 0.0f);
        // A material-tinted row must not also claim a fixed colour.
        if (d.colorFromMaterial)
            CHECK(d.r == 0.0f && d.g == 0.0f && d.b == 0.0f);
    }
    // The rows every writer names must exist under their authored slugs —
    // renaming a row is an ABI change, this pins it.
    CHECK(std::strcmp(particle_def(ParticleKind::Dust).id, "dust") == 0);
    CHECK(std::strcmp(particle_def(ParticleKind::Blood).id, "blood") == 0);
    CHECK(std::strcmp(particle_def(ParticleKind::Spark).id, "spark") == 0);
    CHECK(std::strcmp(particle_def(ParticleKind::Drip).id, "drip") == 0);
    // Out-of-range lookup degrades to row 0, never reads past the table.
    CHECK(&particle_def(static_cast<ParticleKind>(200)) == &kParticleTable[0]);
}

static void test_particle_queue_ring() {
    ParticleBurstQueue q;
    CHECK(q.count == 0);
    CHECK(q.push(vec3{1, 2, 3}, vec3{0, 0, 1}, ParticleKind::Spark, 5, 7, 42));
    CHECK(q.count == 1);
    CHECK(q.items[0].kind == static_cast<std::uint8_t>(ParticleKind::Spark));
    CHECK(q.items[0].count == 5);
    CHECK(q.items[0].matId == 7);
    CHECK(q.items[0].seed == 42);
    // Refusals: zero particles, out-of-table kind.
    CHECK(!q.push(vec3{}, vec3{}, ParticleKind::Dust, 0, 0, 0));
    CHECK(!q.push(vec3{}, vec3{}, static_cast<ParticleKind>(250), 3, 0, 0));
    CHECK(q.count == 1);
    // Overflow drops, loudly-by-return, never writes past the ring.
    for (std::size_t i = 1; i < kMaxParticleBursts; ++i)
        CHECK(q.push(vec3{}, vec3{0, 0, 1}, ParticleKind::Dust, 1, 0,
                     static_cast<std::uint32_t>(i)));
    CHECK(q.count == kMaxParticleBursts);
    CHECK(!q.push(vec3{}, vec3{0, 0, 1}, ParticleKind::Dust, 1, 0, 999));
    q.clear();
    CHECK(q.count == 0);
}

// apply_damage IS the blood writer: a landed physical hit proposes exactly one
// Blood burst at the victim; Psi proposes nothing; a null queue changes no
// behaviour (the pre-particle path, bit-for-bit).
static void test_particle_blood_from_damage() {
    Registry reg;
    NpcPool pool;
    pool.init();

    Entity mob = reg.create();
    reg.emplace<Transform>(mob, Transform{vec3{10.0f, 10.0f, 4.0f}, 0});
    reg.emplace<MobRef>(mob, MobRef{0, 1, 100, 100});

    ParticleBurstQueue q;
    DamageResult r = apply_damage(reg, pool, mob, 12, DamageChannel::Kinetic,
                                  entt::null, nullptr, &q);
    CHECK(r.hit);
    CHECK(r.applied > 0);
    CHECK(q.count == 1);
    CHECK(q.items[0].kind == static_cast<std::uint8_t>(ParticleKind::Blood));
    CHECK(q.items[0].count >= 2);
    // The burst sits ON the body (chest height above the transform).
    CHECK(q.items[0].pos.x == 10.0f);
    CHECK(q.items[0].pos.z > 4.0f);

    // Psi is mental: damage lands, nothing bleeds.
    q.clear();
    DamageResult rp = apply_damage(reg, pool, mob, 5, DamageChannel::Psi,
                                   entt::null, nullptr, &q);
    CHECK(rp.hit);
    CHECK(q.count == 0);

    // Null queue: the default path still applies damage.
    DamageResult rn =
        apply_damage(reg, pool, mob, 5, DamageChannel::Kinetic, entt::null);
    CHECK(rn.hit);

    // A blocked-to-zero hit (or a dead target) proposes nothing.
    q.clear();
    while (true) {
        DamageResult rk = apply_damage(reg, pool, mob, 50,
                                       DamageChannel::Kinetic, entt::null,
                                       nullptr, &q);
        if (!rk.hit) break; // Dead-tagged now refuses
    }
    const std::uint16_t afterDeath = q.count;
    apply_damage(reg, pool, mob, 50, DamageChannel::Kinetic, entt::null,
                 nullptr, &q);
    CHECK(q.count == afterDeath);
}

static void test_particles_all() {
    test_particle_table_rows();
    test_particle_queue_ring();
    test_particle_blood_from_damage();
}

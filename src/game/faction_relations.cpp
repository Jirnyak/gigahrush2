#include "game/faction_relations.h"
#include "game/faction.h"
#include "world/gravity.h"

#include <cmath>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/ai.h"            // ai_owns_motion — the single-writer guard for Velocity
#include "game/combat.h"        // Dead, apply_damage, entity_health, kMeleeReachSlack
#include "game/embody.h"        // NpcRef
#include "game/weapon_table.h"  // MeleeDef, melee_for_item, unarmed_melee
#include "game/ranged_table.h"  // RangedDef, ranged_for_item, equipped_ranged
#include "game/noise.h"         // NoiseProfile, NoiseSource, noise_publish
#include "world/types.h"        // kCellSize, kWorldExtent

namespace giga::game {

namespace {

// The full faction→row shorthand. Only C and P are referenced (the fallbacks and
// the player-row copy below); L/K/S/W complete the symbolic set that names the
// matrix's rows in one place, so they are kept and marked maybe_unused rather than
// deleted piecemeal. (Clang -Wunused-const-variable flags them; MSVC did not, so
// the build-win-verified merge left them firing on macOS.)
constexpr std::uint8_t C = static_cast<std::uint8_t>(Faction::Citizens);
[[maybe_unused]] constexpr std::uint8_t L = static_cast<std::uint8_t>(Faction::Liquidators);
[[maybe_unused]] constexpr std::uint8_t K = static_cast<std::uint8_t>(Faction::Cultists);
[[maybe_unused]] constexpr std::uint8_t S = static_cast<std::uint8_t>(Faction::Scientists);
[[maybe_unused]] constexpr std::uint8_t W = static_cast<std::uint8_t>(Faction::Wild);
constexpr std::uint8_t P = kFactionPlayerRow;

std::int8_t clamp8(int v) {
    if (v > 127) v = 127;
    if (v < -128) v = -128;
    return static_cast<std::int8_t>(v);
}

#include "core/rng.h"
// Advance speed for a body walking at an enemy, m/s. The same 1.35 an ordinary
// resident walks at (wander.cpp kNpcWalkSpeed, which is file-local there): closing
// on somebody you dislike is walking, not sprinting, and giving a brawler a speed
// bonus would let it outrun the flow-field crowd for no authored reason.
constexpr float kFeudWalkSpeed = 1.35f;

// Below this squared horizontal separation the direction is meaningless and
// normalising it would divide by ~zero. 5 cm.
constexpr float kMinSteerDist2 = 0.0025f;

} // namespace

// Rows/columns in Faction order, then the player.
//
//            Cit   Liq   Cul   Sci   Wild  Player
//   Cit       100   +50     0   +50   -50    +50
//   Liq       +50   100   -50   +50   -50    +25
//   Cul         0   -50   100   -20   -50      0
//   Sci       +50   +50   -20   100   -50    +25
//   Wild      -50   -50   -50   -50   100    -50
//   Player    +50   +25     0   +25   -50    100
//
// Self-relations are +100 and never consulted; they exist so the matrix is square
// and a self-comparison can never read as hostile.
const FactionRelations kBaseFactionMatrix = {{
    /* Cit    */ 100,  50,   0,  50, -50,  50,
    /* Liq    */  50, 100, -50,  50, -50,  25,
    /* Cul    */   0, -50, 100, -20, -50,   0,
    /* Sci    */  50,  50, -20, 100, -50,  25,
    /* Wild   */ -50, -50, -50, -50, 100, -50,
    /* Player */  50,  25,   0,  25, -50, 100,
}};

// Monsters vs each faction. Cultists at +50 are the one society monsters leave
// alone — fiction, not balance. Everyone else is squarely hostile.
const std::int8_t kMobVsFaction[kRelFactionCount] = {
    /* Citizens    */ -80,
    /* Liquidators */ -80,
    /* Cultists    */ +50,
    /* Scientists  */ -80,
    /* Wild        */ -60,
    /* Player      */ -100,
};

std::int8_t FactionRelations::add_mutual(std::uint8_t a, std::uint8_t b, int delta) {
    if (a >= kRelFactionCount || b >= kRelFactionCount) return 0;
    const std::int8_t nv = clamp8(at(a, b) + delta);
    at(a, b) = nv;
    at(b, a) = nv;   // symmetric by construction; there are no one-sided grudges
    return nv;
}

void FactionRelations::reset() { *this = kBaseFactionMatrix; }

void FactionRelations::reset_player_row_col() {
    for (std::uint8_t i = 0; i < kRelFactionCount; ++i) {
        at(P, i) = kBaseFactionMatrix.at(P, i);
        at(i, P) = kBaseFactionMatrix.at(i, P);
    }
}

std::uint8_t rel_row(const NpcPool& pool, NpcId id) {
    // const_cast: NpcPool's accessors are non-const by design (it is an SoA table
    // meant to be written through), but this is genuinely a read.
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    if (p.is_player(id)) return P;
    const std::uint16_t f = p.faction(id);
    return static_cast<std::uint8_t>(f % kFactionCount);
}

std::uint8_t body_row(const NpcPool& pool, NpcId id) {
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    // No is_player() check, deliberately: this is the body's own faction.
    return static_cast<std::uint8_t>(p.faction(id) % kFactionCount);
}

bool mob_hostile_to(const NpcPool& pool, NpcId id) {
    return kMobVsFaction[body_row(pool, id)] <= kHostileRelation;
}

// ===========================================================================
// NPC-vs-NPC hostility
// ===========================================================================

bool bodies_hostile(const FactionRelations& rel, const NpcPool& pool, NpcId a,
                    NpcId b) {
    // Nobody fights themselves, and the matrix's +100 diagonal would say so anyway
    // — but only for two records in the SAME row, so the identity case needs its
    // own line.
    if (a == b) return false;
    // An invalid or dangling id decides nothing. `pool.valid` already rejects
    // kInvalidNpc (0xFFFFFFFF is never below count()), so this one check covers
    // both. Without it `rel_row` would fold a dangling id onto row 0 and every
    // dead handle in the game would read as a Citizen.
    if (!pool.valid(a) || !pool.valid(b)) return false;
    return rel.hostile(rel_row(pool, a), rel_row(pool, b));
}

bool npc_seeks_fight(std::uint32_t bodyId, std::uint64_t tick) {
    // Per-identity phase, so the cohort turns over continuously. Without it every
    // licence on the floor would expire on the same tick and a body whose window
    // opened late would be handed a brawl it cannot finish.
    const std::uint64_t phase =
        static_cast<std::uint64_t>(giga::hash_u32(bodyId ^ 0x7c3ad19fu)) % kFeudEpochTicks;
    const std::uint32_t epoch =
        static_cast<std::uint32_t>((tick + phase) / kFeudEpochTicks);
    // The epoch is mixed BEFORE it is combined, for the reason pack_target_node
    // documents: raw epochs are 0,1,2... and xoring a small counter into an id makes
    // neighbouring epochs and neighbouring ids collide in blocks.
    const std::uint32_t h = giga::hash_u32((bodyId * 0x9e3779b9u) ^ giga::hash_u32(epoch));
    return h % kFeudShare == 0u;
}

FactionFoe nearest_faction_foe(const Registry& reg, const NpcPool& pool,
                               const FactionRelations& rel, LayerId layer,
                               Entity self, NpcId selfId, const vec3& from,
                               float radius) {
    FactionFoe best;
    float bestD2 = radius * radius;

    // Monsters carry no NpcRef ([npcs.md]: they have no macro existence at all), so
    // this view cannot reach one — a feud is between PEOPLE by construction, with no
    // exclusion to write. Same structural argument nearest_prey makes.
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (e == self) continue;
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // A body already scheduled to die is not worth crossing a room for:
        // apply_damage refuses a Dead target, so taking it would leave a brawler
        // standing over a corpse for the rest of its window.
        if (reg.all_of<Dead>(e)) continue;

        const NpcId id = reg.get<const NpcRef>(e).id;
        // One predicate for the whole decision, so the steer, the swing and any
        // future consumer can never disagree about who is an enemy.
        if (!bodies_hostile(rel, pool, selfId, id)) continue;

        const float dx = wrap_delta_f(from.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(from.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(from.z, tr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best.e = e;
        best.id = id;
        best.pos = tr.pos;
    }
    return best;
}

std::uint32_t faction_feud_step(Registry& reg, NpcPool& pool,
                                const FactionRelations& rel, LayerId layer,
                                std::uint64_t tick, const GravityField& gravity) {
    const GravityFrame gf = regime_frame(gravity.regime);
    const std::uint32_t phaseNow = static_cast<std::uint32_t>(tick % kFeudPeriod);
    // The visit counter, not the tick: a body is looked at once per kFeudPeriod, so
    // this is the number of chances it has had, which is what a swing cadence has to
    // be counted in.
    const std::uint64_t visit = tick / kFeudPeriod;

    // Two phases. apply_damage can `emplace<Dead>`, EnTT creates that storage the
    // first time, and creating a storage can reallocate the registry's pool
    // container — dangling the view being iterated. Phase 1 records intent while
    // touching only components already in the view; phase 2 applies it once the view
    // is gone. Same discipline as mob_attack_step / finalize_deaths / pickup_step,
    // and the same reason: the crash only happens when the pool vector is at
    // capacity, so it survives several clean runs and then bites.
    struct Swing {
        Entity attacker;
        Entity target;
        std::int16_t raw;
    };
    // Allocates only on the ticks something actually swings (~1 tick in 6 on a
    // Residential floor, see the budget note below); an empty std::vector does not
    // touch the heap. Same shape mob_attack_step uses.
    std::vector<Swing> queued;

    auto view = reg.view<Transform, Velocity, const NpcRef>();
    for (auto e : view) {
        const Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;
        // The camera holder is steered by input and never becomes an AGGRESSOR — but
        // it is a perfectly good target below, which is the whole point of the
        // player having a matrix row.
        if (reg.all_of<CameraTag>(e)) continue;
        if (reg.all_of<Dead>(e)) continue;
        // THE SINGLE-WRITER GUARD ([ai.h]). This pass writes Velocity for licensed
        // bodies, which makes it a peer of wander_step under the same rule, and [ai.h]
        // named it as the ONE live writer still outside the token. It is inside now.
        //
        // Skipping the STEER is the whole cost: an ai-owned body is not made a feud
        // aggressor this tick. It remains a perfectly good TARGET, exactly as the camera
        // holder above does — the matrix still turns the crowd on it, so diplomacy is
        // unaffected and only the steering is arbitrated.
        //
        // Additive today: no AiBrain means false, ai_init has no caller yet, so this is a
        // null try_get and this pass is bit-for-bit what it was.
        if (ai_owns_motion(reg, e)) continue;

        // Identity-hash stagger: a body's slot is a function of its own id, so the
        // crowd spreads evenly across the period with no scheduling state.
        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (giga::hash_u32(id) % kFeudPeriod != phaseNow) continue;
        // Scarcity of aggressors is THE rate control ([faction_relations.h]
        // kFeudShare). Everything below this line runs for ~6.5 bodies on a 420-body
        // Residential floor, one eighth of them per tick.
        if (!npc_seeks_fight(id, tick)) continue;

        const NpcId selfId = reg.get<const NpcRef>(e).id;
        if (!pool.valid(selfId) || !pool.alive(selfId)) continue;

        // The scan. Read-only and safe inside this live view for the one reason
        // nearest_faction_foe documents: it takes a const Registry and can create no
        // storage. Budget on floor 0: 0.8 licensed bodies per tick x 420 records =
        // ~336 distance tests, against the ~1000 mob_attack_step's prey scan already
        // spends there.
        const FactionFoe foe =
            nearest_faction_foe(reg, pool, rel, layer, e, selfId, tr.pos,
                                kFeudRadius);
        if (foe.e == entt::null) continue;   // nobody to fight; wander keeps steering

        // Ranged weapon evaluation first
        const ItemId gunId = equipped_ranged(pool.inventory(selfId));
        const RangedDef* rdef = ranged_for_item(gunId);

        const MeleeDef* w = melee_for_item(equipped_melee(pool.inventory(selfId)));
        if (!w) w = &unarmed_melee();

        const float dx = wrap_delta_f(tr.pos.x, foe.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(tr.pos.y, foe.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(tr.pos.z, foe.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;

        // If holding a firearm and within range, fire a projectile
        if (rdef) {
            const float effRange = static_cast<float>(rdef->projSpeedMmps) * 0.001f * kCellSize * 0.75f;
            if (d2 <= effRange * effRange) {
                Velocity& vel = view.get<Velocity>(e);
                (&vel.v.x)[gf.tanA] = 0.0f; (&vel.v.x)[gf.tanB] = 0.0f;

                std::uint32_t visitsPerShot = static_cast<std::uint32_t>(rdef->cooldownMs) /
                    (kFeudPeriod * static_cast<std::uint32_t>(kSimStepMs));
                if (visitsPerShot == 0) visitsPerShot = 1;

                const std::uint64_t off = static_cast<std::uint64_t>(giga::hash_u32(id ^ 0x5f1e3a9bu) % visitsPerShot);
                if ((visit + off) % visitsPerShot == 0) {
                    vec3 dir{dx, dy, dz};
                    spawn_projectile_dir(reg, layer, tr.pos, dir, 
                                         static_cast<std::int16_t>(rdef->dmg), 
                                         static_cast<std::uint16_t>(rdef->projSpeedMmps), e, 
                                         100, /*team*/ 0, rdef->channel);
                }
                continue;
            }
        }

        // Melee reach check
        const float reach = static_cast<float>(w->reachMm) * 0.001f * kCellSize + kMeleeReachSlack;
        const bool inReach = d2 <= reach * reach;

        Velocity& vel = view.get<Velocity>(e);
        if (inReach) {
            if (gf.axis != 0) vel.v.x = 0.0f;
            if (gf.axis != 1) vel.v.y = 0.0f;
            if (gf.axis != 2) vel.v.z = 0.0f;
        } else {
            float ox = gf.axis == 0 ? 0.0f : dx;
            float oy = gf.axis == 1 ? 0.0f : dy;
            float oz = gf.axis == 2 ? 0.0f : dz;
            const float len2 = ox * ox + oy * oy + oz * oz;
            if (len2 <= kMinSteerDist2) {
                if (gf.axis != 0) vel.v.x = 0.0f;
                if (gf.axis != 1) vel.v.y = 0.0f;
                if (gf.axis != 2) vel.v.z = 0.0f;
            } else {
                const float inv = 1.0f / std::sqrt(len2);
                if (gf.axis != 0) vel.v.x = ox * inv * kFeudWalkSpeed;
                if (gf.axis != 1) vel.v.y = oy * inv * kFeudWalkSpeed;
                if (gf.axis != 2) vel.v.z = oz * inv * kFeudWalkSpeed;
            }
            continue;   // out of reach
        }

        std::uint32_t visitsPerSwing =
            static_cast<std::uint32_t>(w->cooldownMs) /
            (kFeudPeriod * static_cast<std::uint32_t>(kSimStepMs));
        if (visitsPerSwing == 0) visitsPerSwing = 1;
        const std::uint64_t off =
            static_cast<std::uint64_t>(giga::hash_u32(id ^ 0x5f1e3a9bu) % visitsPerSwing);
        if ((visit + off) % visitsPerSwing != 0) continue;   // between swings

        std::int16_t raw = static_cast<std::int16_t>(w->dmg);

        // Allow unclamped fatal damage ONLY for the named hot war — Liquidators
        // vs Cultists/Wild. This used to test `rel_row(a) != rel_row(b)`, which
        // is true of EVERY feud pair (a feud is cross-faction by construction),
        // so the kFeudMinHpPct clamp below was dead code and Wild beat Citizens
        // to 0 HP — exactly what the clamp exists to forbid (suite_faction2 §
        // "no faction war kills").
        //
        // MERGE NOTE (origin/main 7d243ca): main fixed the same dead guard by
        // removing the exemption entirely ("feud blows never kill"). This
        // branch's resolution is kept — the clamp is live for every pair EXCEPT
        // the named hot war, which is designed lethality, and suite_faction2's
        // floor assertions are pinned against exactly this behaviour.
        const std::uint8_t ra = rel_row(pool, selfId);
        const std::uint8_t rb = rel_row(pool, foe.id);
        constexpr std::uint8_t kLiq = static_cast<std::uint8_t>(Faction::Liquidators);
        constexpr std::uint8_t kCul = static_cast<std::uint8_t>(Faction::Cultists);
        constexpr std::uint8_t kWld = static_cast<std::uint8_t>(Faction::Wild);
        const bool isFatalFeud =
            (ra == kLiq && (rb == kCul || rb == kWld)) ||
            (rb == kLiq && (ra == kCul || ra == kWld));

        if (!reg.all_of<CameraTag>(foe.e) && !isFatalFeud) {
            std::int16_t hp = 0, maxHp = 0;
            if (!entity_health(reg, pool, foe.e, hp, maxHp)) continue;
            std::int16_t floorHp =
                static_cast<std::int16_t>(maxHp * kFeudMinHpPct / 100);
            if (floorHp < 1) floorHp = 1;      // a 1 HP body still cannot be killed
            if (hp <= floorHp) continue;       // already beaten; leave it standing
            if (raw > hp - floorHp) raw = static_cast<std::int16_t>(hp - floorHp);
        }
        if (raw <= 0) continue;


        queued.push_back(Swing{e, foe.e, raw});
    }

    std::uint32_t hits = 0;
    for (const Swing& s : queued) {
        const DamageResult r = apply_damage(reg, pool, s.target, s.raw,
                                            DamageChannel::Kinetic, s.attacker);
        if (r.hit) ++hits;
    }
    return hits;
}

RelationTick relations_drain_deaths(FactionRelations& rel, const Registry& reg,
                                   const NpcPool& pool, EventBus& bus,
                                   std::uint64_t tick) {
    RelationTick out;

    // Snapshot the batch ONCE. The RelationChanged events published below land in
    // the same ring, and re-reading size() each iteration would feed this loop its
    // own output — an unbounded cascade in the worst case. The data pointer is
    // stable across publish ([event_bus.h] events()), so holding it is safe.
    const std::size_t n = bus.size();
    const Event* batch = bus.events();

    for (std::size_t i = 0; i < n; ++i) {
        const Event& ev = batch[i];
        if (ev.type != EventType::NpcDied) continue;
        // `a` is kInvalidNpc when the dead thing had no record, i.e. a monster.
        // A monster's death is not diplomacy.
        const NpcId victim = ev.a;
        if (!pool.valid(victim)) continue;

        // `c` is an ENTITY id, not a pool id ([event_bus.h] NpcDied). entt keeps the
        // version bits inside the integral form, so the cast round-trips and
        // reg.valid() correctly rejects a handle that has since been recycled.
        const Entity killer = static_cast<Entity>(ev.c);
        if (killer == entt::null || !reg.valid(killer)) continue;
        // No NpcRef means a monster (or a projectile's dead owner) did it. Only a
        // person's kill moves the matrix. all_of + get<const T> rather than try_get,
        // matching the const-Registry idiom hunt.cpp's nearest_prey already uses.
        if (!reg.all_of<NpcRef>(killer)) continue;
        const NpcId killerId = reg.get<const NpcRef>(killer).id;
        if (!pool.valid(killerId)) continue;

        ++out.kills;

        const std::uint8_t rowK = rel_row(pool, killerId);
        const std::uint8_t rowV = rel_row(pool, victim);
        // Killing one of your own row is a crime, not a diplomatic incident: there
        // is no pair to bend, and add_mutual on (r, r) would corrupt the +100
        // diagonal the whole matrix relies on for "nobody is hostile to themselves".
        if (rowK == rowV) continue;

        const std::int8_t nv = rel.add_mutual(rowK, rowV, kKillRelationDelta);
        ++out.changes;
        out.lastA = rowK;
        out.lastB = rowV;
        out.lastValue = nv;
        bus.publish(EventType::RelationChanged, rowK, rowV, pack_relation(nv),
                    tick);
    }
    return out;
}

} // namespace giga::game

#include "game/faction_relations.h"

#include <cmath>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/ai.h"            // ai_owns_motion — the single-writer guard for Velocity
#include "game/combat.h"        // Dead, apply_damage, entity_health, kMeleeReachSlack
#include "game/embody.h"        // NpcRef
#include "game/noise.h"         // NoiseProfile, NoiseSource, noise_publish
#include "game/ranged_table.h"  // RangedDef, ranged_for_item, equipped_ranged
#include "game/rumour.h"        // global_rumour_network, seed_rumour
#include "game/weapon_table.h"  // MeleeDef, melee_for_item, unarmed_melee
#include "world/types.h"        // kCellSize, kWorldExtent

namespace giga::game {

namespace {

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
constexpr float kFeudWalkSpeed = 1.35f;
constexpr float kMinSteerDist2 = 0.0025f;

TerritoryWarManager g_territoryWarManager;

inline std::size_t floor_slot_idx(std::int16_t floorZ) {
    int f = static_cast<int>(floorZ);
    if (f < kMinFloor) f = kMinFloor;
    if (f > kMaxFloor) f = kMaxFloor;
    return static_cast<std::size_t>(f - kMinFloor);
}

} // namespace

const char* faction_war_state_name_ru(FactionWarState state) {
    switch (state) {
        case FactionWarState::Peace:
            return "\xd0\x9c\xd0\xb8\xd1\x80"; // Мир
        case FactionWarState::Tension:
            return "\xd0\x9d\xd0\xb0\xd0\xbf\xd1\x80\xd1\x8f\xd0\xb6\xd1\x91\xd0\xbd\xd0\xbd\xd0\xbe\xd1\x81\xd1\x82\xd1\x8c"; // Напряжённость
        case FactionWarState::BorderSkirmish:
            return "\xd0\xa1\xd1\x82\xd1\x8b\xd1\x87\xd0\xba\xd0\xb8"; // Стычки
        case FactionWarState::OpenWar:
            return "\xd0\x92\xd0\xbe\xd0\xb9\xd0\xbd\xd0\xb0"; // Война
        case FactionWarState::Ceasefire:
            return "\xd0\x9f\xd0\xb5\xd1\x80\xd0\xb5\xd0\xbc\xd0\xb8\xd1\x80\xd0\xb8\xd0\xb5"; // Перемирие
        default:
            return "\xd0\x9d\xd0\xb5\xd0\xb8\xd0\xb7\xd0\xb2\xd0\xb5\xd1\x81\xd1\x82\xd0\xbd\xd0\xbe"; // Неизвестно
    }
}

TerritoryWarManager& global_territory_war_manager() {
    return g_territoryWarManager;
}

void TerritoryWarManager::init() {
    floors_.fill(FloorWarRecord{});
    active_.fill(false);
}

FloorWarRecord& TerritoryWarManager::get_or_create(std::int16_t floorZ) {
    const std::size_t idx = floor_slot_idx(floorZ);
    if (!active_[idx]) {
        FloorWarRecord& r = floors_[idx];
        r = FloorWarRecord{};
        r.floorZ = floorZ;
        active_[idx] = true;
    }
    return floors_[idx];
}

const FloorWarRecord* TerritoryWarManager::find(std::int16_t floorZ) const {
    const std::size_t idx = floor_slot_idx(floorZ);
    return active_[idx] ? &floors_[idx] : nullptr;
}

bool TerritoryWarManager::record_casualty(FactionRelations& rel, std::int16_t floorZ,
                                         Faction victimFaction, Faction killerFaction,
                                         std::uint64_t tick, FactionWarState* outNewState) {
    FloorWarRecord& rec = get_or_create(floorZ);
    const std::uint8_t vIdx = static_cast<std::uint8_t>(victimFaction);
    const std::uint8_t kIdx = static_cast<std::uint8_t>(killerFaction);
    if (vIdx >= kFactionCount || kIdx >= kFactionCount || vIdx == kIdx) {
        return false;
    }

    ++rec.casualties[vIdx];
    ++rec.pairwiseCasualties[vIdx][kIdx];
    ++rec.pairwiseCasualties[kIdx][vIdx];
    ++rec.totalCasualties;

    const std::uint32_t pairLoss = rec.pairwiseCasualties[vIdx][kIdx];
    const FactionWarState prevState = rec.warState[vIdx][kIdx];
    FactionWarState newState = prevState;

    // Casualty thresholds for war transitions:
    // 0: Peace/Tension
    // 1-3 casualties: BorderSkirmish
    // 4-15 casualties: OpenWar
    // > 15 casualties: Ceasefire (exhaustion)
    if (pairLoss >= 16) {
        newState = FactionWarState::Ceasefire;
    } else if (pairLoss >= 4) {
        newState = FactionWarState::OpenWar;
    } else if (pairLoss >= 1) {
        newState = FactionWarState::BorderSkirmish;
    }

    rec.warState[vIdx][kIdx] = newState;
    rec.warState[kIdx][vIdx] = newState;

    if (newState == FactionWarState::OpenWar) {
        rec.underContest = true;
        rec.challenger = killerFaction;
        rec.disputeIntensity = 1.0f;
    } else if (newState == FactionWarState::BorderSkirmish) {
        rec.disputeIntensity = 0.5f;
    } else if (newState == FactionWarState::Ceasefire) {
        rec.disputeIntensity = 0.2f;
    }

    if (newState != prevState) {
        rec.lastStateChangeTick = tick;
        if (outNewState) *outNewState = newState;

        // War escalations push relations down
        if (newState == FactionWarState::OpenWar) {
            rel.add_mutual(vIdx, kIdx, -30);
        } else if (newState == FactionWarState::BorderSkirmish) {
            rel.add_mutual(vIdx, kIdx, -15);
        }
        return true;
    }
    return false;
}

bool TerritoryWarManager::is_open_war(std::int16_t floorZ, Faction a, Faction b) const {
    const FloorWarRecord* r = find(floorZ);
    if (!r) return false;
    const std::uint8_t ai = static_cast<std::uint8_t>(a);
    const std::uint8_t bi = static_cast<std::uint8_t>(b);
    if (ai >= kFactionCount || bi >= kFactionCount) return false;
    return r->warState[ai][bi] == FactionWarState::OpenWar;
}

bool TerritoryWarManager::evaluate_territory_shift(const NpcPool& pool, std::int16_t floorZ,
                                                  Faction* outNewDominant) {
    FloorWarRecord& rec = get_or_create(floorZ);
    const Faction currentDominant = dominant_faction(pool, floorZ);
    if (rec.dominant != currentDominant) {
        rec.dominant = currentDominant;
        rec.underContest = false;
        rec.disputeIntensity = 0.0f;
        if (outNewDominant) *outNewDominant = currentDominant;
        return true;
    }
    return false;
}

void TerritoryWarManager::step(std::uint64_t tick, std::uint32_t daysPassed) {
    (void)tick;
    if (daysPassed == 0) return;
    // Ceasefires slowly calm back to Tension after extended time
    for (std::size_t i = 0; i < kFloorSlots; ++i) {
        if (!active_[i]) continue;
        FloorWarRecord& r = floors_[i];
        for (std::uint8_t a = 0; a < kFactionCount; ++a) {
            for (std::uint8_t b = 0; b < kFactionCount; ++b) {
                if (r.warState[a][b] == FactionWarState::Ceasefire && daysPassed >= 14) {
                    r.warState[a][b] = FactionWarState::Tension;
                }
            }
        }
    }
}

// Faction matrix baseline
const FactionRelations kBaseFactionMatrix = {{
    /* Cit    */ 100,  50,   0,  50, -50,  50,
    /* Liq    */  50, 100, -50,  50, -50,  25,
    /* Cul    */   0, -50, 100, -20, -50,   0,
    /* Sci    */  50,  50, -20, 100, -50,  25,
    /* Wild   */ -50, -50, -50, -50, 100, -50,
    /* Player */  50,  25,   0,  25, -50, 100,
}};

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
    at(b, a) = nv;
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
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    if (p.is_player(id)) return P;
    const std::uint16_t f = p.faction(id);
    return static_cast<std::uint8_t>(f % kFactionCount);
}

std::uint8_t body_row(const NpcPool& pool, NpcId id) {
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    return static_cast<std::uint8_t>(p.faction(id) % kFactionCount);
}

bool mob_hostile_to(const NpcPool& pool, NpcId id) {
    return kMobVsFaction[body_row(pool, id)] <= kHostileRelation;
}

bool bodies_hostile(const FactionRelations& rel, const NpcPool& pool, NpcId a,
                    NpcId b) {
    if (a == b) return false;
    if (!pool.valid(a) || !pool.valid(b)) return false;
    return rel.hostile(rel_row(pool, a), rel_row(pool, b));
}

bool npc_seeks_fight(std::uint32_t bodyId, std::uint64_t tick) {
    const std::uint64_t phase =
        static_cast<std::uint64_t>(giga::hash_u32(bodyId ^ 0x7c3ad19fu)) % kFeudEpochTicks;
    const std::uint32_t epoch =
        static_cast<std::uint32_t>((tick + phase) / kFeudEpochTicks);
    const std::uint32_t h = giga::hash_u32((bodyId * 0x9e3779b9u) ^ giga::hash_u32(epoch));
    return h % kFeudShare == 0u;
}

FactionFoe nearest_faction_foe(const Registry& reg, const NpcPool& pool,
                               const FactionRelations& rel, LayerId layer,
                               Entity self, NpcId selfId, const vec3& from,
                               float radius) {
    FactionFoe best;
    float bestD2 = radius * radius;

    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (e == self) continue;
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (reg.all_of<Dead>(e)) continue;

        const NpcId id = reg.get<const NpcRef>(e).id;
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
                                std::uint64_t tick,
                                const GravityField* gravity,
                                AiMemory* mem,
                                double now) {
    GravityRegime feudRegime = GravityRegime::NegZ;
    if (gravity != nullptr) {
        feudRegime = gravity->regime;
        if (feudRegime == GravityRegime::Custom)
            feudRegime = regime_from_vector(gravity->global);
    }
    const GravityFrame gf = regime_frame(feudRegime);
    const std::uint32_t phaseNow = static_cast<std::uint32_t>(tick % kFeudPeriod);
    const std::uint64_t visit = tick / kFeudPeriod;

    struct Swing {
        Entity attacker;
        Entity target;
        std::int16_t raw;
    };
    struct QueuedShot {
        vec3 pos;
        vec3 dir;
        std::int16_t dmg;
        std::uint16_t speed;
        Entity owner;
        std::uint8_t channel;
    };
    std::vector<Swing> queued;
    std::vector<QueuedShot> queuedShots;

    auto view = reg.view<Transform, Velocity, const NpcRef>();
    for (auto e : view) {
        const Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;
        if (reg.all_of<Dead>(e)) continue;
        if (ai_owns_motion(reg, e)) continue;

        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (giga::hash_u32(id) % kFeudPeriod != phaseNow) continue;
        if (!npc_seeks_fight(id, tick)) continue;

        const NpcId selfId = reg.get<const NpcRef>(e).id;
        if (!pool.valid(selfId) || !pool.alive(selfId)) continue;

        const FactionFoe foe =
            nearest_faction_foe(reg, pool, rel, layer, e, selfId, tr.pos,
                                kFeudRadius);
        if (foe.e == entt::null) continue;

        const ItemId gunId = equipped_ranged(pool.inventory(selfId));
        const RangedDef* rdef = ranged_for_item(gunId);

        const MeleeDef* w = melee_for_item(equipped_melee(pool.inventory(selfId)));
        if (!w) w = &unarmed_melee();

        const float dx = wrap_delta_f(tr.pos.x, foe.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(tr.pos.y, foe.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(tr.pos.z, foe.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;

        if (rdef) {
            const float effRange = static_cast<float>(rdef->projSpeedMmps) * 0.001f * kCellSize * 0.75f;
            if (d2 <= effRange * effRange) {
                Velocity& vel = view.get<Velocity>(e);
                if (gf.axis != 0) vel.v.x = 0.0f;
                if (gf.axis != 1) vel.v.y = 0.0f;
                if (gf.axis != 2) vel.v.z = 0.0f;

                std::uint32_t visitsPerShot = static_cast<std::uint32_t>(rdef->cooldownMs) /
                    (kFeudPeriod * static_cast<std::uint32_t>(kSimStepMs));
                if (visitsPerShot == 0) visitsPerShot = 1;

                const std::uint64_t off = static_cast<std::uint64_t>(giga::hash_u32(id ^ 0x5f1e3a9bu) % visitsPerShot);
                if ((visit + off) % visitsPerShot == 0) {
                    queuedShots.push_back(QueuedShot{
                        tr.pos,
                        vec3{dx, dy, dz},
                        static_cast<std::int16_t>(rdef->dmg),
                        static_cast<std::uint16_t>(rdef->projSpeedMmps),
                        e,
                        rdef->channel
                    });
                }
                continue;
            }
        }

        const float reach = static_cast<float>(w->reachMm) * 0.001f * kCellSize + kMeleeReachSlack;
        const bool inReach = d2 <= reach * reach;

        Velocity& vel = view.get<Velocity>(e);
        if (inReach) {
            if (gf.axis != 0) vel.v.x = 0.0f;
            if (gf.axis != 1) vel.v.y = 0.0f;
            if (gf.axis != 2) vel.v.z = 0.0f;
        } else {
            const float ox = gf.axis == 0 ? 0.0f : dx;
            const float oy = gf.axis == 1 ? 0.0f : dy;
            const float oz = gf.axis == 2 ? 0.0f : dz;
            const float len2 = ox * ox + oy * oy + oz * oz;
            if (len2 > kMinSteerDist2) {
                const float inv = 1.0f / std::sqrt(len2);
                if (gf.axis != 0) vel.v.x = ox * inv * kFeudWalkSpeed;
                if (gf.axis != 1) vel.v.y = oy * inv * kFeudWalkSpeed;
                if (gf.axis != 2) vel.v.z = oz * inv * kFeudWalkSpeed;
            }
            continue;
        }

        std::uint32_t visitsPerSwing =
            static_cast<std::uint32_t>(w->cooldownMs) /
            (kFeudPeriod * static_cast<std::uint32_t>(kSimStepMs));
        if (visitsPerSwing == 0) visitsPerSwing = 1;
        const std::uint64_t off =
            static_cast<std::uint64_t>(giga::hash_u32(id ^ 0x5f1e3a9bu) % visitsPerSwing);
        if ((visit + off) % visitsPerSwing != 0) continue;

        std::int16_t raw = static_cast<std::int16_t>(w->dmg);

        const std::uint8_t ra = rel_row(pool, selfId);
        const std::uint8_t rb = rel_row(pool, foe.id);
        constexpr std::uint8_t kLiq = static_cast<std::uint8_t>(Faction::Liquidators);
        constexpr std::uint8_t kCul = static_cast<std::uint8_t>(Faction::Cultists);
        constexpr std::uint8_t kWld = static_cast<std::uint8_t>(Faction::Wild);
        
        // Fatal feud when in active named war or open war state
        const bool isOpenWarOnFloor =
            (ra < kFactionCount && rb < kFactionCount)
                ? global_territory_war_manager().is_open_war(
                      pool.floor(selfId), static_cast<Faction>(ra), static_cast<Faction>(rb))
                : false;

        const bool isFatalFeud =
            isOpenWarOnFloor ||
            (ra == kLiq && (rb == kCul || rb == kWld)) ||
            (rb == kLiq && (ra == kCul || ra == kWld));

        if (!reg.all_of<CameraTag>(foe.e) && !isFatalFeud) {
            std::int16_t hp = 0, maxHp = 0;
            if (!entity_health(reg, pool, foe.e, hp, maxHp)) continue;
            std::int16_t floorHp =
                static_cast<std::int16_t>(maxHp * kFeudMinHpPct / 100);
            if (floorHp < 1) floorHp = 1;
            if (hp <= floorHp) continue;
            if (raw > hp - floorHp) raw = static_cast<std::int16_t>(hp - floorHp);
        }
        if (raw <= 0) continue;

        queued.push_back(Swing{e, foe.e, raw});
    }

    std::uint32_t hits = 0;
    for (const Swing& s : queued) {
        const DamageResult r = apply_damage(reg, pool, s.target, s.raw,
                                            DamageChannel::Kinetic, s.attacker);
        if (r.hit) {
            ++hits;
            if (mem != nullptr && reg.all_of<NpcRef>(s.target) && reg.all_of<NpcRef>(s.attacker)) {
                const NpcId victimId = reg.get<const NpcRef>(s.target).id;
                const NpcId attackerId = reg.get<const NpcRef>(s.attacker).id;
                ai_remember_actor(*mem, victimId, MemFoe, attackerId, 1.0f, now);
            }
        }
    }
    for (const QueuedShot& qs : queuedShots) {
        spawn_projectile_dir(reg, layer, qs.pos, qs.dir, qs.dmg, qs.speed, qs.owner, 100, qs.channel);
    }
    return hits;
}

RelationTick relations_drain_deaths(FactionRelations& rel, const Registry& reg,
                                   const NpcPool& pool, EventBus& bus,
                                   std::uint64_t tick,
                                   std::int16_t currentFloor) {
    RelationTick out;

    const std::size_t n = bus.size();
    const Event* batch = bus.events();

    for (std::size_t i = 0; i < n; ++i) {
        const Event& ev = batch[i];
        if (ev.type != EventType::NpcDied) continue;
        const NpcId victim = ev.a;
        if (!pool.valid(victim)) continue;

        const Entity killer = static_cast<Entity>(ev.c);
        if (killer == entt::null || !reg.valid(killer)) continue;
        if (!reg.all_of<NpcRef>(killer)) continue;
        const NpcId killerId = reg.get<const NpcRef>(killer).id;
        if (!pool.valid(killerId)) continue;

        ++out.kills;

        const std::uint8_t rowK = rel_row(pool, killerId);
        const std::uint8_t rowV = rel_row(pool, victim);

        // Record territorial dispute & casualty in manager
        const std::int16_t victimFloor = pool.floor(victim) != kNoFloorLabel ? pool.floor(victim) : currentFloor;
        const Faction fV = static_cast<Faction>(body_row(pool, victim));
        const Faction fK = static_cast<Faction>(body_row(pool, killerId));

        FactionWarState newState = FactionWarState::Peace;
        if (global_territory_war_manager().record_casualty(rel, victimFloor, fV, fK, tick, &newState)) {
            ++out.warTransitions;
            // Seed war news into rumour network
            const std::uint16_t packedPair = static_cast<std::uint16_t>(
                static_cast<std::uint8_t>(fV) | (static_cast<std::uint8_t>(fK) << 8));
            const FloorWarRecord* fwr = global_territory_war_manager().find(victimFloor);
            const std::int32_t casualties = fwr ? static_cast<std::int32_t>(fwr->totalCasualties) : 1;
            global_rumour_network().seed_rumour(RumourKind::WarNews, victimFloor,
                                               packedPair, casualties, killerId, tick, 95);
        }

        // If player is the killer, seed Atrocity rumour
        if (rowK == kFactionPlayerRow) {
            global_rumour_network().seed_rumour(RumourKind::Atrocity, victimFloor,
                                               static_cast<std::uint16_t>(fV), 1, killerId, tick, 100);
        }

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

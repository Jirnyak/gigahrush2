#include "game/rumour.h"

#include <cstdio>
#include <cstring>

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/faction_relations.h"
#include "game/mob_spawn.h"  // MobRef
#include "game/role.h"       // RoleId
#include "game/samosbor.h"
#include "world/types.h"

namespace giga::game {

namespace {

// Which kinds actually spawned on this layer. Counted from the live registry rather
// than re-derived from the spawn tables, because the point of a threat rumour is that
// it is true of THIS floor as it currently stands — a mob that was killed before you
// arrived should not be gossip.
std::uint16_t sample_live_mob_kind(const Registry& reg, LayerId layer,
                                   std::uint32_t roll, std::uint32_t& countOut) {
    std::uint32_t seen = 0;
    std::uint16_t pick = 0xFFFFu;
    for (auto e : reg.view<const MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        ++seen;
        if (roll % seen == 0) pick = reg.get<const MobRef>(e).kind;
        roll = hash_u32(roll);
    }
    countOut = seen;
    return pick;
}

RumourNetwork g_rumourNetwork;

} // namespace

RumourNetwork& global_rumour_network() {
    return g_rumourNetwork;
}

void RumourNetwork::init() {
    nodes_.fill(RumourNode{});
    count_ = 0;
}

bool RumourNetwork::seed_rumour(RumourKind kind, std::int16_t floorZ, std::uint16_t subject,
                                std::int32_t value, NpcId originNpc, std::uint64_t tick,
                                std::uint8_t initialCredibility) {
    // Check if an identical active rumour exists; if so, refresh it with higher value / credibility
    for (std::size_t i = 0; i < count_; ++i) {
        if (!nodes_[i].active) continue;
        if (nodes_[i].rumour.kind == kind && nodes_[i].rumour.floorZ == floorZ &&
            nodes_[i].rumour.subject == subject) {
            nodes_[i].rumour.value = value;
            nodes_[i].rumour.credibility = initialCredibility;
            nodes_[i].birthTick = tick;
            return true;
        }
    }

    // Find slot
    std::size_t slot = count_;
    if (slot >= kMaxRumourNetworkEvents) {
        // Evict oldest or lowest credibility node
        std::size_t oldest = 0;
        std::uint64_t minTick = UINT64_MAX;
        for (std::size_t i = 0; i < kMaxRumourNetworkEvents; ++i) {
            if (!nodes_[i].active) {
                oldest = i;
                break;
            }
            if (nodes_[i].birthTick < minTick) {
                minTick = nodes_[i].birthTick;
                oldest = i;
            }
        }
        slot = oldest;
    } else {
        ++count_;
    }

    RumourNode& n = nodes_[slot];
    n.rumour.kind = kind;
    n.rumour.floorZ = floorZ;
    n.rumour.subject = subject;
    n.rumour.value = value;
    n.rumour.credibility = initialCredibility;
    n.rumour.hops = 0;
    n.rumour.valid = true;
    n.sourceNpc = originNpc;
    n.birthTick = tick;
    n.diffusionCount = 0;
    n.active = true;
    return true;
}

bool RumourNetwork::share_rumours_between(NpcPool& pool, NpcId speaker, NpcId listener,
                                         std::int16_t affinity, bool isCampfireOrBreak,
                                         std::uint64_t tick) {
    (void)pool;
    if (count_ == 0 || speaker == kInvalidNpc || listener == kInvalidNpc || speaker == listener) {
        return false;
    }

    // Deterministic share probability based on affinity and setting
    const std::uint32_t seed = hash3(speaker, listener, static_cast<std::uint32_t>(tick));
    const std::uint32_t roll = seed % 100u;

    // Campfire/break routines significantly boost transmission (80% vs 35%)
    std::uint32_t threshold = isCampfireOrBreak ? 80u : 35u;
    if (affinity > 25) threshold = (threshold + 15u > 95u) ? 95u : threshold + 15u;
    else if (affinity < -25) threshold = (threshold > 20u) ? threshold - 20u : 5u;

    if (roll >= threshold) return false;

    // Pick most relevant active rumour to diffuse
    std::size_t pickIdx = static_cast<std::size_t>(hash_u32(seed ^ 0x9e3779b9u) % count_);
    if (!nodes_[pickIdx].active) {
        for (std::size_t i = 0; i < count_; ++i) {
            if (nodes_[i].active) {
                pickIdx = i;
                break;
            }
        }
    }
    if (!nodes_[pickIdx].active) return false;

    RumourNode& r = nodes_[pickIdx];
    ++r.diffusionCount;
    if (r.rumour.hops < 255u) ++r.rumour.hops;

    // Credibility decay across hops unless reinforced by high affinity
    if (affinity < 0 && r.rumour.credibility > 10u) {
        r.rumour.credibility -= 5u;
    } else if (affinity > 30 && r.rumour.credibility < 100u) {
        r.rumour.credibility = (r.rumour.credibility + 5u > 100u) ? 100u : r.rumour.credibility + 5u;
    }
    return true;
}

std::uint32_t RumourNetwork::diffuse_step(NpcPool& pool, std::int16_t floorZ,
                                         std::uint64_t tick, std::uint32_t budget) {
    if (count_ == 0) return 0;
    const std::vector<NpcId>& bucket = pool.floor_bucket(floorZ);
    if (bucket.size() < 2) return 0;

    std::uint32_t shared = 0;
    const std::size_t bSize = bucket.size();
    const std::uint32_t steps = budget < bSize ? budget : static_cast<std::uint32_t>(bSize);

    for (std::uint32_t k = 0; k < steps; ++k) {
        const std::uint32_t idxA = hash3(k, static_cast<std::uint32_t>(tick), 0x1234u) % bSize;
        const std::uint32_t idxB = hash3(k, static_cast<std::uint32_t>(tick), 0x5678u) % bSize;
        if (idxA == idxB) continue;

        const NpcId a = bucket[idxA];
        const NpcId b = bucket[idxB];
        if (!pool.valid(a) || !pool.valid(b) || !pool.alive(a) || !pool.alive(b)) continue;

        // Check if co-located in common room or resting
        const bool isBreak = (pool.role(a) == static_cast<std::uint16_t>(RoleId::Resident));
        if (share_rumours_between(pool, a, b, 10, isBreak, tick)) {
            ++shared;
        }
    }
    return shared;
}

std::uint32_t RumourNetwork::diffuse_vertical_step(NpcPool& pool, const std::vector<std::int16_t>& activeFloors,
                                                    std::uint64_t tick, std::uint32_t budget) {
    (void)pool;
    if (count_ == 0 || activeFloors.empty()) return 0;

    std::uint32_t diffusions = 0;
    const std::size_t nNodes = count_ < kMaxRumourNetworkEvents ? count_ : kMaxRumourNetworkEvents;
    const std::uint32_t limit = budget < nNodes ? budget : static_cast<std::uint32_t>(nNodes);

    for (std::uint32_t k = 0; k < limit; ++k) {
        const std::size_t idx = static_cast<std::size_t>(hash3(k, static_cast<std::uint32_t>(tick), 0x9876u) % nNodes);
        if (!nodes_[idx].active || !nodes_[idx].rumour.valid) continue;

        RumourNode& src = nodes_[idx];
        if (src.rumour.credibility <= 15u || src.rumour.hops >= 16u) continue;

        // Propagate vertically to adjacent floors (via active elevator shafts and stairwells)
        const std::int16_t currentFloor = src.rumour.floorZ;
        const std::int16_t adjFloors[2] = {
            static_cast<std::int16_t>(currentFloor + 1),
            static_cast<std::int16_t>(currentFloor - 1)
        };

        for (int d = 0; d < 2; ++d) {
            const std::int16_t targetFloor = adjFloors[d];
            if (targetFloor < -50 || targetFloor > 50) continue;

            // Verify targetFloor exists in activeFloors
            bool floorExists = false;
            for (std::int16_t af : activeFloors) {
                if (af == targetFloor) { floorExists = true; break; }
            }
            if (!floorExists) continue;

            // Deterministic diffusion chance along vertical elevator shafts & stairwells
            const std::uint32_t roll = hash3(static_cast<std::uint32_t>(src.rumour.kind),
                                             static_cast<std::uint32_t>(targetFloor),
                                             static_cast<std::uint32_t>(tick + k)) % 100u;
            if (roll >= 45u) continue;

            const std::uint8_t decayedCredibility = src.rumour.credibility > 12u ? src.rumour.credibility - 10u : 5u;
            const std::uint8_t nextHops = src.rumour.hops + 1u;

            // Check if already present on target floor
            bool exists = false;
            for (std::size_t j = 0; j < count_; ++j) {
                if (!nodes_[j].active) continue;
                if (nodes_[j].rumour.kind == src.rumour.kind &&
                    nodes_[j].rumour.floorZ == targetFloor &&
                    nodes_[j].rumour.subject == src.rumour.subject) {
                    exists = true;
                    // Reinforce if fresh
                    if (decayedCredibility > nodes_[j].rumour.credibility) {
                        nodes_[j].rumour.credibility = decayedCredibility;
                        nodes_[j].rumour.value = src.rumour.value;
                        nodes_[j].birthTick = tick;
                        ++nodes_[j].diffusionCount;
                        ++diffusions;
                    }
                    break;
                }
            }

            if (!exists) {
                if (seed_rumour(src.rumour.kind, targetFloor, src.rumour.subject,
                                src.rumour.value, src.sourceNpc, tick, decayedCredibility)) {
                    for (std::size_t j = 0; j < count_; ++j) {
                        if (nodes_[j].active && nodes_[j].rumour.kind == src.rumour.kind &&
                            nodes_[j].rumour.floorZ == targetFloor &&
                            nodes_[j].rumour.subject == src.rumour.subject) {
                            nodes_[j].rumour.hops = nextHops;
                            break;
                        }
                    }
                    ++diffusions;
                }
            }
        }
    }
    return diffusions;
}

bool RumourNetwork::carry_rumour_migration(NpcPool& pool, NpcId traveler, std::int16_t fromFloor,
                                            std::int16_t toFloor, std::uint64_t tick) {
    if (fromFloor == toFloor || count_ == 0) return false;

    // Traveler carries the top rumour from their origin floor
    const Rumour r = best_rumour_for_npc(pool, traveler, fromFloor);
    if (!r.valid || r.credibility <= 20u) return false;

    const std::uint8_t carriedCredibility = r.credibility > 10u ? r.credibility - 8u : 5u;
    const bool seeded = seed_rumour(r.kind, toFloor, r.subject, r.value, traveler, tick, carriedCredibility);
    if (seeded) {
        for (std::size_t i = 0; i < count_; ++i) {
            if (nodes_[i].active && nodes_[i].rumour.kind == r.kind &&
                nodes_[i].rumour.floorZ == toFloor &&
                nodes_[i].rumour.subject == r.subject) {
                nodes_[i].rumour.hops = r.hops + 1u;
                break;
            }
        }
    }
    return seeded;
}

Rumour RumourNetwork::best_rumour_for_npc(const NpcPool& pool, NpcId id, std::int16_t floorZ) const {
    (void)pool;
    (void)id;
    Rumour best{};
    if (count_ == 0) return best;

    // Preference: Local floor rumors > High-impact events (Samosbor strikes, atrocities, shortages, wars, heroics)
    std::uint32_t bestScore = 0;
    for (std::size_t i = 0; i < count_; ++i) {
        if (!nodes_[i].active || !nodes_[i].rumour.valid) continue;
        const Rumour& r = nodes_[i].rumour;
        std::uint32_t score = r.credibility;
        if (r.floorZ == floorZ) {
            score += 60u;
        } else {
            const int dist = std::abs(static_cast<int>(r.floorZ) - static_cast<int>(floorZ));
            if (dist <= 4) {
                score += static_cast<std::uint32_t>(30 - dist * 6);
            }
        }

        if (r.kind == RumourKind::SamosborStrike) score += 45u;
        else if (r.kind == RumourKind::Atrocity) score += 35u;
        else if (r.kind == RumourKind::VendorShortage) score += 30u;
        else if (r.kind == RumourKind::WarNews) score += 28u;
        else if (r.kind == RumourKind::Heroic) score += 25u;

        if (r.hops > 5u) {
            const std::uint32_t hopPenalty = static_cast<std::uint32_t>(r.hops - 5u) * 3u;
            score = score > hopPenalty ? score - hopPenalty : 1u;
        }

        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    }
    return best;
}

bool RumourNetwork::has_shortage_rumour(std::int16_t floorZ, ItemCategory cat) const {
    for (std::size_t i = 0; i < count_; ++i) {
        if (!nodes_[i].active || !nodes_[i].rumour.valid) continue;
        if (nodes_[i].rumour.kind == RumourKind::VendorShortage &&
            nodes_[i].rumour.floorZ == floorZ &&
            nodes_[i].rumour.subject == static_cast<std::uint16_t>(cat)) {
            return true;
        }
    }
    return false;
}

bool RumourNetwork::has_samosbor_strike_rumour(std::int16_t floorZ) const {
    for (std::size_t i = 0; i < count_; ++i) {
        if (!nodes_[i].active || !nodes_[i].rumour.valid) continue;
        if (nodes_[i].rumour.kind == RumourKind::SamosborStrike &&
            nodes_[i].rumour.floorZ == floorZ) {
            return true;
        }
    }
    return false;
}

void RumourNetwork::prune_stale(std::uint64_t currentTick, std::uint64_t maxAgeTicks) {
    for (std::size_t i = 0; i < count_; ++i) {
        if (nodes_[i].active && (currentTick - nodes_[i].birthTick > maxAgeTicks)) {
            nodes_[i].active = false;
        }
    }
}

const char* item_category_name_ru(ItemCategory cat) {
    switch (cat) {
        case ItemCategory::Ammo:
            // "патроны"
            return "\xd0\xbf\xd0\xb0\xd1\x82\xd1\x80\xd0\xbe\xd0\xbd\xd1\x8b";
        case ItemCategory::Medicine:
            // "медикаменты"
            return "\xd0\xbc\xd0\xb5\xd0\xb4\xd0\xb8\xd0\xba\xd0\xb0\xd0\xbc\xd0\xb5\xd0\xbd\xd1\x82\xd1\x8b";
        case ItemCategory::Drink:
            // "чистая вода"
            return "\xd1\x87\xd0\xb8\xd1\x81\xd1\x82\xd0\xb0\xd1\x8f \xd0\xb2\xd0\xbe\xd0\xb4\xd0\xb0";
        case ItemCategory::Food:
            // "провизия"
            return "\xd0\xbf\xd1\x80\xd0\xbe\xd0\xb2\xd0\xb8\xd0\xb7\xd0\xb8\xd1\x8f";
        case ItemCategory::Tool:
            // "инструменты"
            return "\xd0\xb8\xd0\xbd\xd1\x81\xd1\x82\xd1\x80\xd1\x83\xd0\xbc\xd0\xb5\xd0\xbd\xd1\x82\xd1\x8b";
        case ItemCategory::Note:
            // "документы"
            return "\xd0\xb4\xd0\xbe\xd0\xba\xd1\x83\xd0\xbc\xd0\xb5\xd0\xbd\xd1\x82\xd1\x8b";
        case ItemCategory::Key:
            // "ключи доступа"
            return "\xd0\xba\xd0\xbb\xd1\x8e\xd1\x87\xd0\xb8 \xd0\xb4\xd0\xbe\xd1\x81\xd1\x82\xd1\x83\xd0\xbf\xd0\xb0";
        case ItemCategory::Misc:
        default:
            // "припасы"
            return "\xd0\xbf\xd1\x80\xd0\xb8\xd0\xbf\xd0\xb0\xd1\x81\xd1\x8b";
    }
}

Faction dominant_faction(const NpcPool& pool, int floorNumber) {
    std::uint32_t tally[kFactionCount] = {};
    for (NpcId id : const_cast<NpcPool&>(pool).floor_bucket(
             static_cast<std::int16_t>(floorNumber))) {
        ++tally[body_row(pool, id)];
    }
    std::size_t best = 0;
    for (std::size_t i = 1; i < kFactionCount; ++i)
        if (tally[i] > tally[best]) best = i;
    return static_cast<Faction>(best);
}

NpcId nearest_speaker(const Registry& reg, LayerId layer) {
    Entity ear = entt::null;
    vec3 earPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        ear = e;
        earPos = t.pos;
        break;
    }
    if (ear == entt::null) return kInvalidNpc;

    NpcId best = kInvalidNpc;
    float bestD2 = kOverhearRange * kOverhearRange;
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (e == ear) continue;
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const float dx = wrap_delta_f(earPos.x, t.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(earPos.y, t.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(earPos.z, t.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best = reg.get<const NpcRef>(e).id;
    }
    return best;
}

Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ, const SamosborState& sb,
                  const RumourNetwork* net) {
    Rumour r;
    if (!const_cast<NpcPool&>(pool).valid(speaker)) return r;

    // Warning overrides every speaker
    if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Warning)) {
        r.kind = RumourKind::Imminent;
        r.subject = sb.variant;
        r.value = static_cast<std::int32_t>((sb.phaseMs + 999u) / 1000u);
        r.floorZ = static_cast<std::int16_t>(floorZ);
        r.valid = true;
        return r;
    }

    // Active samosbor overrides fog slot
    if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Active)) {
        const std::uint32_t seed =
            hash_u32(speaker * 0x9e3779b9u ^ static_cast<std::uint32_t>(floorZ * 2654435761u));
        const std::uint32_t pick = seed % 100u;
        if (pick >= 30 && pick < 55) {
            r.kind = RumourKind::Variant;
            r.subject = sb.variant;
            r.value = static_cast<std::int32_t>(sb.count);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        }
    }

    // Check dynamic social network rumours if net is provided
    if (net != nullptr) {
        const Rumour dyn = net->best_rumour_for_npc(pool, speaker, static_cast<std::int16_t>(floorZ));
        if (dyn.valid) {
            const std::uint32_t seed =
                hash_u32(speaker * 0x9e3779b9u ^ static_cast<std::uint32_t>(floorZ * 2654435761u));
            // 30% share for salient dynamic network rumours
            if ((seed % 100u) < 30u) {
                return dyn;
            }
        }
    }

    const std::uint32_t seed =
        hash_u32(speaker * 0x9e3779b9u ^ static_cast<std::uint32_t>(floorZ * 2654435761u));

    const std::uint32_t pick = seed % 100u;
    RumourKind kind;
    if (pick < 30) kind = RumourKind::Threat;
    else if (pick < 55) kind = RumourKind::Fog;
    else if (pick < 75) kind = RumourKind::Wealth;
    else if (pick < 90) kind = RumourKind::Territory;
    else kind = RumourKind::Depth;

    if (kind == RumourKind::Fog) {
        if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Active)) {
            r.kind = RumourKind::Variant;
            r.subject = sb.variant;
            r.value = static_cast<std::int32_t>(sb.count);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        }
        if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Idle) &&
            sb.phaseTotalMs != 0 &&
            sb.phaseMs <= kRumourLullSpeakMs - kSamosborWarningMs) {
            r.kind = RumourKind::Lull;
            r.value = static_cast<std::int32_t>(
                (sb.phaseMs + kSamosborWarningMs + 999u) / 1000u);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        }
        if (sb.count > 0 && (seed & 0x00010000u) != 0u) {
            r.kind = RumourKind::Veteran;
            const FogRoster roster =
                samosbor_fog_roster(floorZ, sb.count);
            r.subject = static_cast<std::uint16_t>(roster.n);
            r.value = static_cast<std::int32_t>(sb.count);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        }
    }

    switch (kind) {
        case RumourKind::Threat: {
            std::uint32_t live = 0;
            const std::uint16_t k =
                sample_live_mob_kind(reg, layer, hash_u32(seed ^ 0x11u), live);
            if (k == 0xFFFFu || live == 0) {
                r.kind = RumourKind::Fog;
                r.value = static_cast<std::int32_t>(
                    samosbor_duty01(floorZ) * 1000.0f);
                r.floorZ = static_cast<std::int16_t>(floorZ);
                r.valid = true;
                return r;
            }
            r.kind = RumourKind::Threat;
            r.subject = k;
            r.value = static_cast<std::int32_t>(live);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        }
        case RumourKind::Fog:
            r.kind = kind;
            r.value = static_cast<std::int32_t>(samosbor_duty01(floorZ) * 1000.0f);
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        case RumourKind::Wealth:
            r.kind = kind;
            r.value = kLootValueCap[economy_band(floorZ)];
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        case RumourKind::Territory:
            r.kind = kind;
            r.subject =
                static_cast<std::uint16_t>(dominant_faction(pool, floorZ));
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
        case RumourKind::Depth:
        default:
            r.kind = RumourKind::Depth;
            r.value = floorZ < 0 ? -34 : 34;
            r.floorZ = static_cast<std::int16_t>(floorZ);
            r.valid = true;
            return r;
    }
}

bool rumour_text(const Rumour& r, char* out, std::size_t cap) {
    if (!r.valid || !out || cap < 160) return false;
    switch (r.kind) {
        case RumourKind::Threat:
            std::snprintf(out, cap,
                          "\xd0\xa2\xd1\x83\xd1\x82 \xd0\xb2\xd0\xbe\xd0\xb4\xd0\xb8"
                          "\xd1\x82\xd1\x81\xd1\x8f %s. \xd0\x98\xd1\x85 %d.",
                          mob_name(static_cast<MobKind>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Fog: {
            const char* how =
                r.value < 100
                    ? "\xd1\x80\xd0\xb5\xd0\xb4\xd0\xba\xd0\xbe"          // rarely
                    : (r.value < 500
                           ? "\xd1\x87\xd0\xb0\xd1\x81\xd1\x82\xd0\xbe"   // often
                           : "\xd0\xbf\xd0\xbe\xd1\x87\xd1\x82\xd0\xb8 "
                             "\xd0\xb2\xd1\x81\xd0\xb5\xd0\xb3\xd0\xb4\xd0\xb0");
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80 \xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c %s "
                          "(%d.%d%%).",
                          how, static_cast<int>(r.value) / 10,
                          static_cast<int>(r.value) % 10);
            return true;
        }
        case RumourKind::Wealth:
            std::snprintf(out, cap,
                          "\xd0\xa5\xd0\xbe\xd1\x80\xd0\xbe\xd1\x88\xd0\xb5\xd0\xb5 "
                          "\xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xb8\xd0\xb4"
                          "\xd1\x91\xd1\x82 \xd0\xb4\xd0\xbe %d \xd1\x80\xd1\x83\xd0"
                          "\xb1.",
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Territory:
            std::snprintf(out, cap,
                          "\xd0\xad\xd1\x82\xd0\xbe\xd1\x82 \xd1\x8d\xd1\x82\xd0\xb0"
                          "\xd0\xb6 \xd0\xb4\xd0\xb5\xd1\x80\xd0\xb6\xd0\xb0\xd1\x82"
                          " %s.",
                          faction_name(static_cast<Faction>(r.subject)));
            return true;
        case RumourKind::Imminent:
            std::snprintf(out, cap,
                          "\xd0\xa7\xd0\xb5\xd1\x80\xd0\xb5\xd0\xb7 %d \xd1\x81 "
                          "\xd1\x81\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80: %s. \xd0\x91\xd0\xb5\xd0\xb3\xd0\xb8 \xd0\xba "
                          "\xd0\xb3\xd0\xb5\xd1\x80\xd0\xbc\xd0\xb5.",
                          static_cast<int>(r.value),
                          samosbor_variant_name_ru(
                              static_cast<SamosborVariant>(r.subject)));
            return true;
        case RumourKind::Variant:
            std::snprintf(out, cap, "\xd0\x98\xd0\xb4\xd1\x91\xd1\x82 %s: %s.",
                          samosbor_variant_name_ru(
                              static_cast<SamosborVariant>(r.subject)),
                          samosbor_variant_effect_ru(
                              static_cast<SamosborVariant>(r.subject)));
            return true;
        case RumourKind::Veteran:
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80\xd0\xbe\xd0\xb2 %d. \xd0\xa2\xd0\xb2\xd0\xb0"
                          "\xd1\x80\xd0\xb5\xd0\xb9 \xd0\xb8\xd0\xb7 \xd1\x82\xd1"
                          "\x83\xd0\xbc\xd0\xb0\xd0\xbd\xd0\xb0 \xd1\x83\xd0\xb6"
                          "\xd0\xb5 %d.",
                          static_cast<int>(r.value), static_cast<int>(r.subject));
            return true;
        case RumourKind::Lull:
            if (r.value < 90)
                std::snprintf(out, cap,
                              "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1"
                              "\xd0\xbe\xd1\x80 \xd1\x87\xd0\xb5\xd1\x80\xd0"
                              "\xb5\xd0\xb7 %d \xd1\x81. \xd0\x98\xd0\xb4\xd0"
                              "\xb8 \xd0\xba \xd0\xb3\xd0\xb5\xd1\x80\xd0\xbc"
                              "\xd0\xb5.",
                              static_cast<int>(r.value));
            else
                std::snprintf(out, cap,
                              "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1"
                              "\xd0\xbe\xd1\x80 \xd1\x87\xd0\xb5\xd1\x80\xd0"
                              "\xb5\xd0\xb7 %d \xd0\xbc\xd0\xb8\xd0\xbd. \xd0"
                              "\x92\xd1\x80\xd0\xb5\xd0\xbc\xd1\x8f \xd0\xb5"
                              "\xd1\x89\xd1\x91 \xd0\xb5\xd1\x81\xd1\x82\xd1"
                              "\x8c.",
                              static_cast<int>((r.value + 59) / 60));
            return true;
        case RumourKind::Heroic:
            // "Слыхал? Чужак перебил тварей (%d шт.) на этаже %d! Сильный боец."
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xbb\xd1\x8b\xd1\x85\xd0\xb0\xd0\xbb? "
                          "\xd0\xa7\xd1\x83\xd0\xb6\xd0\xb0\xd0\xba \xd0\xbf\xd0\xb5"
                          "\xd1\x80\xd0\xb5\xd0\xb1\xd0\xb8\xd0\xbb \xd1\x82\xd0\xb2"
                          "\xd0\xb0\xd1\x80\xd0\xb5\xd0\xb9 (%d \xd1\x88\xd1\x82.) "
                          "\xd0\xbd\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5"
                          " %d! \xd0\xa1\xd0\xb8\xd0\xbb\xd1\x8c\xd0\xbd\xd1\x8b"
                          "\xd0\xb9 \xd0\xb1\xd0\xbe\xd0\xb5\xd1\x86.",
                          static_cast<int>(r.value), static_cast<int>(r.floorZ));
            return true;
        case RumourKind::Atrocity:
            // "Берегись чужака! На этаже %d он вырезал людей из %s (%d чел.). Нелюдь!"
            std::snprintf(out, cap,
                          "\xd0\x91\xd0\xb5\xd1\x80\xd0\xb5\xd0\xb3\xd0\xb8\xd1\x81"
                          "\xd1\x8c \xd1\x87\xd1\x83\xd0\xb6\xd0\xb0\xd0\xba\xd0\xb0"
                          "! \xd0\x9d\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0"
                          "\xb5 %d \xd0\xbe\xd0\xbd \xd0\xb2\xd1\x8b\xd1\x80\xd0\xb5"
                          "\xd0\xb7\xd0\xb0\xd0\xbb \xd0\xbb\xd1\x8e\xd0\xb4\xd0\xb5"
                          "\xd0\xb9 \xd0\xb8\xd0\xb7 %s (%d \xd1\x87\xd0\xb5\xd0\xbb"
                          ".). \xd0\x9d\xd0\xb5\xd0\xbb\xd1\x8e\xd0\xb4\xd1\x8c!",
                          static_cast<int>(r.floorZ),
                          faction_name(static_cast<Faction>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::WarNews:
            // "На этаже %d началась резня между %s и %s! Потерь уже %d чел."
            std::snprintf(out, cap,
                          "\xd0\x9d\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5"
                          " %d \xd0\xbd\xd0\xb0\xd1\x87\xd0\xb0\xd0\xbb\xd0\xb0"
                          "\xd1\x81\xd1\x8c \xd1\x80\xd0\xb5\xd0\xb7\xd0\xbd\xd1\x8f"
                          " \xd0\xbc\xd0\xb5\xd0\xb6\xd0\xb4\xd1\x83 %s \xd0\xb8 %s"
                          "! \xd0\x9f\xd0\xbe\xd1\x82\xd0\xb5\xd1\x80\xd1\x8c "
                          "\xd1\x83\xd0\xb6\xd0\xb5 %d \xd1\x87\xd0\xb5\xd0\xbb.",
                          static_cast<int>(r.floorZ),
                          faction_name(static_cast<Faction>(r.subject & 0xFF)),
                          faction_name(static_cast<Faction>((r.subject >> 8) & 0xFF)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::SamosborStrike:
            // "На этаже %d ударил свирепый самосбор (%s)! Потерь: %d чел. Не суйся туда!"
            std::snprintf(out, cap,
                          "\xd0\x9d\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5"
                          " %d \xd1\x83\xd0\xb4\xd0\xb0\xd1\x80\xd0\xb8\xd0\xbb"
                          " \xd1\x81\xd0\xb2\xd0\xb8\xd1\x80\xd0\xb5\xd0\xbf"
                          "\xd1\x8b\xd0\xb9 \xd1\x81\xd0\xb0\xd0\xbc\xd0\xbe"
                          "\xd1\x81\xd0\xb1\xd0\xbe\xd1\x80 (%s)! \xd0\x9f"
                          "\xd0\xbe\xd1\x82\xd0\xb5\xd1\x80\xd1\x8c: %d \xd1"
                          "\x87\xd0\xb5\xd0\xbb. \xd0\x9d\xd0\xb5 \xd1\x81"
                          "\xd1\x83\xd0\xb9\xd1\x81\xd1\x8f \xd1\x82\xd1\x83"
                          "\xd0\xb4\xd0\xb0!",
                          static_cast<int>(r.floorZ),
                          samosbor_variant_name_ru(static_cast<SamosborVariant>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::VendorShortage:
            // "На этаже %d у торговцев дефицит (%s)! Цены взлетели на %d%%."
            std::snprintf(out, cap,
                          "\xd0\x9d\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5"
                          " %d \xd1\x83 \xd1\x82\xd0\xbe\xd1\x80\xd0\xb3\xd0"
                          "\xbe\xd0\xb2\xd1\x86\xd0\xb5\xd0\xb2 \xd0\xb4\xd0"
                          "\xb5\xd1\x84\xd0\xb8\xd1\x86\xd0\xb8\xd1\x82 (%s)!"
                          " \xd0\xa6\xd0\xb5\xd0\xbd\xd1\x8b \xd0\xb2\xd0\xb7"
                          "\xd0\xbb\xd0\xb5\xd1\x82\xd0\xb5\xd0\xbb\xd0\xb8"
                          " \xd0\xbd\xd0\xb0 %d%%.",
                          static_cast<int>(r.floorZ),
                          item_category_name_ru(static_cast<ItemCategory>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Depth:
        default:
            std::snprintf(out, cap,
                          "\xd0\x93\xd0\xbb\xd1\x83\xd0\xb1\xd0\xb6\xd0\xb5 %d "
                          "\xd0\xbd\xd0\xb5 \xd0\xb2\xd0\xbe\xd0\xb7\xd0\xb2\xd1\x80"
                          "\xd0\xb0\xd1\x89\xd0\xb0\xd1\x8e\xd1\x82\xd1\x81\xd1\x8f.",
                          static_cast<int>(r.value));
            return true;
    }
}

} // namespace giga::game

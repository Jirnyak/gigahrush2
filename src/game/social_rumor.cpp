#include "game/social_rumor.h"

#include "core/wrap.h"

namespace giga::game {

bool rumour_exchange_pair(NpcPool& pool,
                          FactionRelations& relations,
                          NpcId speakerId,
                          NpcId listenerId,
                          std::uint64_t tick) {
    if (speakerId == listenerId) return false;
    if (!pool.valid(speakerId) || !pool.valid(listenerId)) return false;
    if (!pool.alive(speakerId) || !pool.alive(listenerId)) return false;

    // 1. Fetch non-propagated rumors from speaker (propagated == false)
    std::vector<Rumour> shareable = pool.get_shareable_rumors(speakerId);
    if (shareable.empty()) return false;

    // Pick candidate rumor
    const Rumour& candidate = shareable[0];

    // 2. Transfer to listener with propagated = true (enforces 1-level deep limit)
    bool added = pool.receive_propagated_rumor(listenerId, candidate);
    if (!added) return false;

    // 3. Update relation / affinity if delta is non-zero
    if (candidate.affinity_delta != 0) {
        // NPC-level relationship shift
        if (candidate.target_npc != kInvalidNpc && pool.valid(candidate.target_npc)) {
            auto& rels = pool.relations(listenerId);
            bool found = false;
            for (auto& edge : rels) {
                if (edge.target == candidate.target_npc) {
                    int newAff = static_cast<int>(edge.affinity) + candidate.affinity_delta;
                    if (newAff < kRelAffinityMin) newAff = kRelAffinityMin;
                    if (newAff > kRelAffinityMax) newAff = kRelAffinityMax;
                    edge.affinity = static_cast<std::int16_t>(newAff);
                    found = true;
                    break;
                }
            }
            if (!found) {
                for (auto& edge : rels) {
                    if (edge.target == kInvalidNpc) {
                        edge.target = candidate.target_npc;
                        edge.affinity = static_cast<std::int16_t>(candidate.affinity_delta);
                        found = true;
                        break;
                    }
                }
            }
        }
        // Faction-level relationship shift
        if (candidate.target_faction != 0xFF && candidate.target_faction < kRelFactionCount) {
            std::uint8_t listenerFactionRow = rel_row(pool, listenerId);
            relations.add_mutual(listenerFactionRow, candidate.target_faction, candidate.affinity_delta);
        }
    }

    return true;
}

GossipTickResult rumour_exchange_step(const Registry& reg,
                                     NpcPool& pool,
                                     FactionRelations& relations,
                                     LayerId layer,
                                     std::uint64_t tick,
                                     float radius) {
    GossipTickResult result{};

    struct EmbodiedNpc {
        Entity e;
        NpcId id;
        vec3 pos;
    };
    std::vector<EmbodiedNpc> embodied;
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        NpcId id = reg.get<const NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;
        embodied.push_back({e, id, t.pos});
    }

    if (embodied.size() < 2) return result;

    const float r2 = radius * radius;
    for (std::size_t i = 0; i < embodied.size(); ++i) {
        for (std::size_t j = i + 1; j < embodied.size(); ++j) {
            const float dx = wrap_delta_f(embodied[i].pos.x, embodied[j].pos.x, kWorldExtent);
            const float dy = wrap_delta_f(embodied[i].pos.y, embodied[j].pos.y, kWorldExtent);
            const float dz = wrap_delta_f(embodied[i].pos.z, embodied[j].pos.z, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz <= r2) {
                // Try exchange i -> j
                if (rumour_exchange_pair(pool, relations, embodied[i].id, embodied[j].id, tick)) {
                    ++result.exchanges;
                    ++result.rumors_transferred;
                }
                // Try exchange j -> i
                if (rumour_exchange_pair(pool, relations, embodied[j].id, embodied[i].id, tick)) {
                    ++result.exchanges;
                    ++result.rumors_transferred;
                }
            }
        }
    }

    return result;
}

} // namespace giga::game

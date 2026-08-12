#include "game/social.h"
#include "ecs/components.h"
#include "core/math.h"
#include "game/embody.h"
#include <cmath>

namespace giga::game {

SocialTick social_step(Registry& reg, NpcPool& pool, const FactionRelations& rel,
                       AiMemory& mem, SpeechMemory& speechMem, LayerId layer,
                       double now, std::uint64_t tick) {
    SocialTick out;

    auto view = reg.view<const NpcRef, Transform, Velocity, AiBrain, NpcSocial>();

    for (auto e : view) {
        auto& brain = view.get<AiBrain>(e);
        if (brain.currentIntent != IntentId::IntentSocial) {
            continue;
        }

        const auto& npc = view.get<const NpcRef>(e);
        auto& tr = view.get<Transform>(e);
        auto& vel = view.get<Velocity>(e);
        auto& soc = view.get<NpcSocial>(e);

        if (tick < soc.cooldownUntilTick) {
            continue;
        }

        if (soc.partner == kInvalidNpc) {
            float bestDistSq = 36.0f; // 6.0m squared search radius
            NpcId bestPartner = kInvalidNpc;

            for (auto peer : view) {
                if (e == peer) continue;
                
                const auto& peerNpc = view.get<const NpcRef>(peer);
                if (bodies_hostile(rel, pool, npc.id, peerNpc.id)) continue;
                
                auto& peerBrain = view.get<AiBrain>(peer);
                if (peerBrain.currentIntent != IntentId::IntentSocial && peerBrain.currentIntent != IntentId::IntentWander) continue;

                auto& peerSoc = view.get<NpcSocial>(peer);
                if (tick < peerSoc.cooldownUntilTick) continue;

                const auto& peerTr = view.get<Transform>(peer);
                // Check layer if needed? They are all in the same registry for the active floor.
                vec3 d = peerTr.pos - tr.pos;
                float distSq = d.x * d.x + d.y * d.y + d.z * d.z;
                
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestPartner = peerNpc.id;
                }
            }

            if (bestPartner != kInvalidNpc) {
                soc.partner = bestPartner;
                out.pairsFormed++;
            }
        }

        if (soc.partner != kInvalidNpc) {
            if (!pool.valid(soc.partner) || !pool.alive(soc.partner)) {
                soc.partner = kInvalidNpc;
                continue;
            }

            entt::entity partnerEnt = entt::null;
            for (auto peer : view) {
                if (view.get<const NpcRef>(peer).id == soc.partner) {
                    partnerEnt = peer;
                    break;
                }
            }

            if (partnerEnt == entt::null) {
                soc.partner = kInvalidNpc;
                continue;
            }

            const auto& peerTr = view.get<Transform>(partnerEnt);
            vec3 d = peerTr.pos - tr.pos;
            float distSq = d.x * d.x + d.y * d.y; // horizontal only for steering
            
            if (distSq > 4.0f) { // 2.0m radius
                brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
                float dist = std::sqrt(distSq);
                float speed = 2.0f;
                vel.v.x = (d.x / dist) * speed;
                vel.v.y = (d.y / dist) * speed;
            } else {
                brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
                vel.v.x = 0.0f;
                vel.v.y = 0.0f;
                
                if (ai_remember_actor(mem, npc.id, MemoryKind::MemAlly, soc.partner, 1.0f, now)) {
                    out.alliesFormed++;
                }

                auto row = mem.row(soc.partner);
                for (std::size_t i = 0; i < kMemSlots; ++i) {
                    auto trace = row.slot[i];
                    std::uint8_t kind = trace.kind();
                    if (kind == MemoryKind::MemFood || kind == MemoryKind::MemDanger) {
                        std::uint32_t payload = trace.payload();
                        int cx = payload & 0x7F;
                        int cy = (payload >> 7) & 0x7F;
                        int cz = (payload >> 14) & 0x7F;
                        if (ai_remember_cell(mem, npc.id, kind, cx, cy, cz, trace.strength(), now)) {
                            out.cellMemoriesExchanged++;
                        }
                        break; 
                    } else if (kind == MemoryKind::MemFoe || kind == MemoryKind::MemAlly) {
                        if (ai_remember_actor(mem, npc.id, kind, NpcId{trace.payload()}, trace.strength(), now)) {
                            out.cellMemoriesExchanged++; // Counted in the same bucket for now
                        }
                        break;
                    }
                }

                SpeechContext ctx;
                ctx.intent = IntentId::IntentSocial;
                SpeechSituation sit;
                speech_say(speechMem, pool, npc.id, ctx, static_cast<std::uint32_t>(tick), &sit);
                
                soc.cooldownUntilTick = tick + (30 * 125); // 30s cooldown at 125Hz
                soc.partner = kInvalidNpc;
            }
        }
    }

    return out;
}

std::uint32_t social_init(Registry& reg, LayerId layer) {
    std::uint32_t count = 0;
    auto view = reg.view<const NpcRef, const Transform>(entt::exclude<NpcSocial>);
    for (auto e : view) {
        if (view.get<const Transform>(e).layer == layer) {
            reg.emplace<NpcSocial>(e);
            count++;
        }
    }
    return count;
}

} // namespace giga::game

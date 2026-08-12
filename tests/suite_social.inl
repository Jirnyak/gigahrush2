// suite_social.inl
#include "game/social.h"
#include "game/ai.h"
#include "game/speech.h"
#include "game/faction_relations.h"
#include "game/npc_pool.h"
#include "ecs/registry.h"
#include "ecs/components.h"
#include "game/embody.h"

namespace giga {
namespace game {

inline void test_social_gossip() {
    Registry reg;
    NpcPool pool;
    AiMemory mem;
    SpeechMemory speechMem;
    FactionRelations rel;
    
    // 1 & 2: Spawn two NPCs (a and b)
    NpcId a = pool.spawn();
    NpcId b = pool.spawn();
    NpcId foe = pool.spawn();
    
    Entity e_a = embody(reg, pool, a, 3);
    Entity e_b = embody(reg, pool, b, 3);
    
    // Place them at the same position (distance 0)
    reg.get<Transform>(e_a).pos = vec3{0.0f, 0.0f, 0.0f};
    reg.get<Transform>(e_b).pos = vec3{0.0f, 0.0f, 0.0f};
    
    // 3: Assign NpcSocial
    reg.emplace<NpcSocial>(e_a);
    reg.emplace<NpcSocial>(e_b);
    
    // Assign AiBrain intents so b seeks out a
    AiBrain brain_a;
    brain_a.currentIntent = IntentId::IntentWander; // passive
    reg.emplace<AiBrain>(e_a, brain_a);
    
    AiBrain brain_b;
    brain_b.currentIntent = IntentId::IntentSocial; // active
    reg.emplace<AiBrain>(e_b, brain_b);
    
    // 5: Ensure b's memory is empty of foes
    bool b_has_foe_before = false;
    for (int i = 0; i < kMemSlots; ++i) {
        if (mem.row(b).slot[i].kind() == MemoryKind::MemFoe) {
            b_has_foe_before = true;
        }
    }
    CHECK(!b_has_foe_before);
    
    // 4: Insert a MemFoe trace into a's memory using proper actor payload
    ai_remember_actor(mem, a, MemoryKind::MemFoe, foe, 1.0f, 0.0);
    
    // 6: Trigger an interaction
    social_step(reg, pool, rel, mem, speechMem, 3, 1.0, 100);
    
    // 7: Check that b successfully acquired the MemFoe trace via gossip
    bool b_has_foe_after = false;
    for (int i = 0; i < kMemSlots; ++i) {
        if (mem.row(b).slot[i].kind() == MemoryKind::MemFoe && mem.row(b).slot[i].payload() == static_cast<std::uint32_t>(foe)) {
            b_has_foe_after = true;
        }
    }
    CHECK(b_has_foe_after);
}

inline void test_social_all() {
    test_social_gossip();
}

} // namespace game
} // namespace giga

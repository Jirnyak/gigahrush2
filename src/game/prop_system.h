#pragma once
#include <cstdint>
#include "core/math.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "world/world.h"

namespace giga::game {

enum class PropFallMode : std::uint8_t {
    SimpleFall,
    RagdollRoll,
    GpuHandoff
};

struct SubVoxelAnchor {
    int cx = 0, cy = 0, cz = 0;
    std::uint8_t subX = 0, subY = 0, subZ = 0;
    std::uint8_t face = 0;
};

struct Interactable {
    enum class Kind : std::uint8_t { Terminal, ElectricalShield, LightBulb, Corpse, Loot } kind;
    float reachM = 2.5f;
    bool active = true;
};

struct AngularVelocity { vec3 w{0.0f, 0.0f, 0.0f}; };
struct Rotation        { vec3 euler{0.0f, 0.0f, 0.0f}; };

struct DebrisSpawnEvent {
    vec3 pos;
    vec3 impulse;
    vec3 color;
    std::uint32_t meshKind;
};

Entity spawn_prop(Registry& reg, const vec3& worldPos, const SubVoxelAnchor& anchor,
                   Interactable::Kind kind, PropFallMode fallMode, 
                   const vec3& color, std::uint32_t meshKind);

void damage_prop_entity(Registry& reg, Entity prop, const vec3& bulletDir, float bulletForce, EventBus& bus);
void anchor_validate_step(Registry& reg, const World& world, EventBus& bus);
bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind, EventBus& bus);

} // namespace giga::game

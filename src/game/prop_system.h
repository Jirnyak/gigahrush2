#pragma once
#include <cstdint>
#include <vector>
#include <unordered_set>
#include <cmath>
#include "core/math.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "world/world.h"

namespace giga::game {

enum class PropFallMode : std::uint8_t {
    SimpleFall,  // 1. Падение AABB на CPU (тяжелые щитки, терминалы)
    RagdollRoll, // 2. Вращение/кувыркание на CPU (лампы, ведра, стулья)
    GpuHandoff   // 3. Передача в GPU-частицы и мгновенный destroy сущности
};

struct SubVoxelAnchor {
    int cx = 0, cy = 0, cz = 0;                  // Координаты макро-ячейки (128³)
    std::uint8_t subX = 0, subY = 0, subZ = 0;   // Локальный субоксель (0..7)
    std::uint8_t face = 0;                       // Опора: 0=Floor, 1=WallNorth, 2=Ceiling...
};

struct Interactable {
    enum class Kind : std::uint8_t { Terminal, ElectricalShield, LightBulb, Corpse, Loot } kind;
    float reachM = 2.5f;
    bool active = true;
};

// AngularVelocity + Rotation live in ecs/components.h (core) so physics_step
// can integrate them without src/sim including src/game. [jirnyak.md] §18.

struct DebrisSpawnEvent {

    vec3 pos;
    vec3 impulse;
    vec3 color;
    std::uint32_t meshKind;
};

struct PendingDetachedProp {
    Entity entity;
    PropFallMode mode;
    vec3 pos;
    vec3 impulse;
    vec3 color;
    std::uint32_t meshKind;
};

// ── Публичный API ───────────────────────────────────────────────────────────────

Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos, const SubVoxelAnchor& anchor,
                   Interactable::Kind kind, PropFallMode fallMode, 
                   const vec3& color, std::uint32_t meshKind);

bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel, 
                                float projHitRadius, EventBus& bus);

void anchor_validate_step(Registry& reg, const World& world, EventBus& bus, 
                         const std::vector<std::uint64_t>& dirtyCells);

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind, EventBus& bus);

} // namespace giga::game

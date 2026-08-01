#pragma once
#include <cstdint>
#include <vector>
#include <unordered_set>
#include <cmath>
#include "core/math.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "world/world.h"
#include "world/level_stack.h"

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

// Spawn a static anchored prop. `layer` is stamped on Transform so multi-layer
// streamer slots do not leak props across floors. [jirnyak.md] §18.
Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer = 0);

// Destroy every SubVoxelAnchor prop on `layer` (terminals, shields, bulbs…).
// Call before reseeding a recycled LayerId slot — same contract as
// despawn_layer_mobs / refresh_floor_containers. [jirnyak.md] §18.
std::uint32_t clear_layer_props(Registry& reg, LayerId layer);

// Seed Terminal + ElectricalShield Interactables by scanning MacroGrid with the
// same spatial_hash / wall-device rules as gpu::PropPlacer (kSaltWall branch).
// Positions match propPass cosmetics when both use the same seed
// (1337u ^ floor*0x9e3779b9). Returns count successfully spawned.
// [jirnyak.md] §18 — sim must not read propPass.get_terminal_positions().
std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed);

// Collect world positions of active Interactables of `kind` on `layer`.
// Replaces propPass.get_terminal_positions() / get_prop_positions for sim+HUD.
std::uint32_t collect_interactable_positions(const Registry& reg, LayerId layer,
                                             Interactable::Kind kind,
                                             std::vector<vec3>& out);

bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel,
                                float projHitRadius, EventBus& bus);

void anchor_validate_step(Registry& reg, const World& world, EventBus& bus,
                          const std::vector<std::uint64_t>& dirtyCells);

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind,
                        EventBus& bus);

} // namespace giga::game

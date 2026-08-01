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

// Empty filter tags ([jirnyak.md] §18). Static anchored props carry StaticPropTag
// + PropMeshTag; on detach the entity keeps identity and swaps StaticPropTag ->
// DynamicBodyTag so BodyPass/PropPass can filter without recreate.
struct StaticPropTag {};
struct DynamicBodyTag {};
struct PropMeshTag {};

// GPU mesh skin payload for PropPass ([jirnyak.md] §18 — PropPass is a passive
// skin over reg.view<Transform, PropMeshTag>()). shape is the PropShape ordinal
// from render/prop_mesh.h; game never includes render headers — main maps
// shape -> gpu::PropShape when uploading instances.
struct PropMesh {
    std::uint8_t shape     = 0;
    float        yaw       = 0.0f;
    std::uint8_t matId     = 0;
    std::uint8_t emissive  = 0;
    std::uint8_t flags     = 0;
    std::uint8_t animPhase = 0;
};

// Headless POD mirror of gpu::PropInstance for tests / main upload.
// Collect only StaticPropTag entities (detached props go to BodyPass).
struct PropMeshInstance {
    std::uint8_t shape     = 0;
    vec3         origin{0.0f, 0.0f, 0.0f};
    float        yaw       = 0.0f;
    vec3         color{0.8f, 0.8f, 0.8f};
    std::uint8_t matId     = 0;
    std::uint8_t emissive  = 0;
    std::uint8_t flags     = 0;
    std::uint8_t animPhase = 0;
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

// Nearest active Interactable of `kind` on the player's layer, if within reach.
// Zero heap traffic — pure view scan. [jirnyak.md] §18 interaction_step.
struct InteractionHit {
    Entity entity = entt::null;
    vec3 pos{0.0f, 0.0f, 0.0f};
    float distSq = 0.0f;
    bool hit = false;
};

// ── Публичный API ───────────────────────────────────────────────────────────────

// Spawn a static anchored prop. `layer` is stamped on Transform so multi-layer
// streamer slots do not leak props across floors. `meshKind` is the PropShape
// ordinal stored on PropMesh (GPU skin). Optional `yaw`/`emissive`/`matId`/
// `animPhase` fill the rest of the PropPass instance payload.
// [jirnyak.md] §18.
Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer = 0, float yaw = 0.0f,
                  std::uint8_t emissive = 0, std::uint8_t matId = 0,
                  std::uint8_t animPhase = 0, std::uint8_t flags = 0);

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

// Seed LightBulb Interactables from MacroGrid ceiling-lamp rules matching
// gpu::PropPlacer (kSaltLight, lightChancePct=25, solidAbove). Positions match
// BareBulb/FloodLamp cosmetics so lighting/HUD can query ECS instead of
// propPass.get_prop_positions(). [jirnyak.md] §18 Sim→Render invariant.
std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed);

// Collect world positions of active Interactables of `kind` on `layer`.
// Replaces propPass.get_terminal_positions() / get_prop_positions for sim+HUD.
// Prefer interaction_step / find_nearest_interactable in the hot path — this
// helper is for callers that still need a flat list (craft proximity, HUD).
std::uint32_t collect_interactable_positions(const Registry& reg, LayerId layer,
                                             Interactable::Kind kind,
                                             std::vector<vec3>& out);

// Collect StaticPropTag + PropMesh + Transform (+ optional Renderable) into a
// flat instance list for PropPass upload. Detached DynamicBodyTag props are
// excluded (BodyPass owns them). [jirnyak.md] §18 PropPass passive skin.
std::uint32_t collect_static_prop_mesh_instances(const Registry& reg, LayerId layer,
                                                 std::vector<PropMeshInstance>& out);


bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel,
                                float projHitRadius, EventBus& bus);

// Validate SubVoxelAnchor props against MacroGrid after geometry mutation.
// `dirtyCells` is CarveResult::dirtyCells / DoorSet::dirtyCells — flat
// macro_index keys (uint32), NOT a packed xyz64. [jirnyak.md] §18.
void anchor_validate_step(Registry& reg, const World& world, EventBus& bus,
                          const std::vector<std::uint32_t>& dirtyCells);

// Zero-alloc nearest Interactable query for the interact key path.
// Scans reg.view<Transform, Interactable> on the player's Transform.layer.
InteractionHit find_nearest_interactable(const Registry& reg, Entity player,
                                         Interactable::Kind kind, float reachM);

// Convenience: find nearest of `kind` and return true if within reach.
// No std::vector — call from the sim tick freely. [jirnyak.md] §18.
bool interaction_step(Registry& reg, Entity player, Interactable::Kind kind,
                      EventBus& bus, InteractionHit* outHit = nullptr);

// Advance ragdoll spin bookkeeping for DynamicBodyTag props. Angular integration
// itself lives in physics_step; this is the game-side settle / impulse helper.
void prop_ragdoll_step(Registry& reg, float dt);

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind,
                        EventBus& bus);

} // namespace giga::game

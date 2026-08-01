#include "game/prop_system.h"
#include "ecs/components.h"
#include "world/macro_grid.h"
#include "world/materials.h"
#include "world/types.h"
#include "world/world.h"
#include <vector>
#include <unordered_set>
#include <cmath>

namespace giga::game {

constexpr int kMacroDimLocal = 128;
constexpr float kWorldExtentLocal = 256.0f; // 128 * 2.0m

// Must match gpu::PropPlacer kSaltWall so ECS interactables land on the same
// cells as the GPU cosmetic Terminal / ElectricalShield instances.
constexpr std::uint32_t kSaltWall = 0x33333333u;

static inline int wrap_macro_local(int c) {
    return (c % kMacroDimLocal + kMacroDimLocal) % kMacroDimLocal;
}

static inline int wrap_delta_i(int a, int b, int dim) {
    int d = (a - b) % dim;
    if (d > dim / 2) d -= dim;
    if (d < -dim / 2) d += dim;
    return d;
}

static inline float wrap_delta_f_local(float a, float b, float extent) {
    float d = std::fmod(a - b, extent);
    if (d > extent * 0.5f) d -= extent;
    if (d < -extent * 0.5f) d += extent;
    return d;
}

// Same spatial_hash as render/prop_placer.cpp (must stay bit-identical).
static inline std::uint32_t spatial_hash(int x, int y, int z, std::uint32_t seed) {
    std::uint32_t h = static_cast<std::uint32_t>(x) * 73856093u ^
                      static_cast<std::uint32_t>(y) * 19349663u ^
                      static_cast<std::uint32_t>(z) * 83492791u ^ seed;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    return h ^ (h >> 16);
}

static inline bool is_solid_cell(CellType type) {
    return type != kCellAir;
}

// Swap StaticPropTag -> DynamicBodyTag without destroying the entity
// ([jirnyak.md] §18 — PropPass/BodyPass filter, no recreate).
static void mark_dynamic(Registry& reg, Entity prop) {
    if (reg.all_of<StaticPropTag>(prop))
        reg.remove<StaticPropTag>(prop);
    reg.emplace_or_replace<DynamicBodyTag>(prop);
}

static void detach_single_prop(Registry& reg, Entity prop, PropFallMode mode,
                               const vec3& impulse, const vec3& pos, const vec3& color,
                               std::uint32_t meshKind, EventBus& bus)
{
    (void)meshKind;
    (void)color;
    // Always announce detach so render/GPU handoff and tests can observe it
    // ([jirnyak.md] §18 PropDetached — a/b/c = packed world pos).
    bus.publish(EventType::PropDetached,
                static_cast<std::uint32_t>(pos.x),
                static_cast<std::uint32_t>(pos.y),
                static_cast<std::uint32_t>(pos.z));

    if (mode == PropFallMode::GpuHandoff) {
        reg.destroy(prop);
        return;
    }

    // Keep entity identity; drop anchor and flip the static/dynamic tag pair.
    if (reg.all_of<SubVoxelAnchor>(prop))
        reg.remove<SubVoxelAnchor>(prop);
    mark_dynamic(reg, prop);
    reg.emplace_or_replace<GravityAffected>(prop);

    if (mode == PropFallMode::RagdollRoll) {
        // Canonical Velocity{vec3} form (combat.cpp). AngularVelocity/Rotation
        // (core components) are integrated by physics_step each substep.
        reg.emplace_or_replace<Velocity>(prop, Velocity{impulse});
        reg.emplace_or_replace<AngularVelocity>(prop, AngularVelocity{vec3{impulse.z, impulse.x, 2.0f}});
        reg.emplace_or_replace<Rotation>(prop);
    } else {
        reg.emplace_or_replace<Velocity>(prop, Velocity{vec3{0.0f, 0.0f, -0.5f}});
    }

    // BodyPass needs AABB — without it a detached prop is invisible.
    if (!reg.all_of<AABB>(prop))
        reg.emplace<AABB>(prop, AABB{vec3{0.2f, 0.2f, 0.2f}});
}

bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel,
                                float projHitRadius, EventBus& bus)
{
    const float radiusSq = projHitRadius * projHitRadius;
    const int pcx = wrap_macro_local(static_cast<int>(projPos.x / kCellSize));
    const int pcy = wrap_macro_local(static_cast<int>(projPos.y / kCellSize));
    const int pcz = wrap_macro_local(static_cast<int>(projPos.z / kCellSize));

    Entity hitEntity = entt::null;
    PropFallMode hitMode = PropFallMode::SimpleFall;
    vec3 hitPos{0.0f, 0.0f, 0.0f};
    vec3 hitColor{0.8f, 0.8f, 0.8f};

    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& anchor = view.get<SubVoxelAnchor>(entity);

        if (std::abs(wrap_delta_i(anchor.cx, pcx, kMacroDimLocal)) > 1 ||
            std::abs(wrap_delta_i(anchor.cy, pcy, kMacroDimLocal)) > 1 ||
            std::abs(wrap_delta_i(anchor.cz, pcz, kMacroDimLocal)) > 1)
        {
            continue;
        }

        const auto& tr = view.get<Transform>(entity);
        const float dx = wrap_delta_f_local(projPos.x, tr.pos.x, kWorldExtentLocal);
        const float dy = wrap_delta_f_local(projPos.y, tr.pos.y, kWorldExtentLocal);
        const float dz = wrap_delta_f_local(projPos.z, tr.pos.z, kWorldExtentLocal);

        if (dx * dx + dy * dy + dz * dz <= radiusSq) {
            hitEntity = entity;
            hitMode = view.get<PropFallMode>(entity);
            hitPos = tr.pos;
            hitColor = reg.all_of<Renderable>(entity) ? reg.get<Renderable>(entity).color : vec3{0.8f, 0.8f, 0.8f};
            break;
        }
    }

    if (hitEntity != entt::null) {
        vec3 impulse = normalize(projVel) * 3.0f + vec3{0.0f, 1.0f, 0.0f};
        detach_single_prop(reg, hitEntity, hitMode, impulse, hitPos, hitColor, 0, bus);
        return true;
    }
    return false;
}

void anchor_validate_step(Registry& reg, const World& world, EventBus& bus,
                         const std::vector<std::uint32_t>& dirtyCells)
{
    if (dirtyCells.empty()) return;

    // dirtyCells are flat macro_index keys (CarveResult / DoorSet contract).
    static thread_local std::unordered_set<std::uint32_t> dirtySet;
    dirtySet.clear();
    dirtySet.insert(dirtyCells.begin(), dirtyCells.end());

    static thread_local std::vector<PendingDetachedProp> detached;
    detached.clear();

    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& anchor = view.get<SubVoxelAnchor>(entity);

        const int cx = wrap_macro_local(anchor.cx);
        const int cy = wrap_macro_local(anchor.cy);
        const int cz = wrap_macro_local(anchor.cz);
        const std::uint32_t key =
            static_cast<std::uint32_t>(macro_index(cx, cy, cz));

        if (!dirtySet.contains(key)) continue;

        // Anchor support lost when the sub-voxel is no longer solid.
        if (!world.grid().solid(cx, cy, cz, anchor.subX, anchor.subY, anchor.subZ)) {
            const auto& tr = view.get<Transform>(entity);
            vec3 col = reg.all_of<Renderable>(entity)
                           ? reg.get<Renderable>(entity).color
                           : vec3{0.8f, 0.8f, 0.8f};
            detached.push_back({entity, view.get<PropFallMode>(entity), tr.pos,
                                vec3{0.0f, 1.0f, 0.0f}, col, 0});
        }
    }

    for (const auto& item : detached) {
        detach_single_prop(reg, item.entity, item.mode, item.impulse, item.pos,
                           item.color, item.meshKind, bus);
    }
}

Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer)
{
    (void)meshKind;
    int cx = wrap_macro_local(anchor.cx);
    int cy = wrap_macro_local(anchor.cy);
    int cz = wrap_macro_local(anchor.cz);

    if (!world.grid().solid(cx, cy, cz, anchor.subX, anchor.subY, anchor.subZ)) {
        return entt::null;
    }

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, worldPos, layer);
    reg.emplace<SubVoxelAnchor>(prop, SubVoxelAnchor{cx, cy, cz, anchor.subX,
                                                     anchor.subY, anchor.subZ,
                                                     anchor.face});
    reg.emplace<Interactable>(prop, kind, 2.5f, true);
    reg.emplace<PropFallMode>(prop, fallMode);
    reg.emplace<Renderable>(prop, color);
    // Static anchored + mesh-filter tags ([jirnyak.md] §18). Detach swaps
    // StaticPropTag -> DynamicBodyTag without destroying the entity.
    reg.emplace<StaticPropTag>(prop);
    reg.emplace<PropMeshTag>(prop);

    return prop;
}

std::uint32_t clear_layer_props(Registry& reg, LayerId layer) {
    std::vector<Entity> old_;
    // SubVoxelAnchor marks every static prop (terminals, shields, padic bulbs).
    // Detached ragdolls lose the anchor and are left alone — they belong to the
    // live sim, not the floor roster.
    auto view = reg.view<const SubVoxelAnchor, const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer == layer)
            old_.push_back(e);
    }
    for (Entity e : old_) reg.destroy(e);
    return static_cast<std::uint32_t>(old_.size());
}

std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate wall-device branch (wsel bands 15-25 shield,
    // 25-35 terminal). Floor support = solidBelow on Y (same convention as
    // prop_placer). Anchor sub-voxels point into the solid floor cell so
    // spawn_prop's solid() check and anchor_validate_step stay honest.
    for (int z = 0; z < kMacroDimLocal; ++z) {
        for (int y = 0; y < kMacroDimLocal; ++y) {
            for (int x = 0; x < kMacroDimLocal; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType below = grid.cell(x, y - 1, z);
                if (!is_solid_cell(below)) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y, z + 1));
                const bool solidSouth = is_solid_cell(grid.cell(x, y, z - 1));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 100;

                Interactable::Kind kind;
                float yOff;
                vec3 color;
                std::uint8_t face = 1; // wall
                if (wsel >= 15 && wsel < 25) {
                    kind  = Interactable::Kind::ElectricalShield;
                    yOff  = 0.40f;
                    color = {0.18f, 0.20f, 0.22f};
                } else if (wsel >= 25 && wsel < 35) {
                    kind  = Interactable::Kind::Terminal;
                    yOff  = 0.0f;
                    color = {0.32f, 0.35f, 0.38f};
                } else {
                    continue; // radiator / empty — no Interactable
                }

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell + yOff;
                const float wz = static_cast<float>(z) * kCell;

                // Anchor into the solid floor cell under the air cell (Y-1).
                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = wrap_macro_local(y - 1);
                anchor.cz   = z;
                anchor.subX = 4;
                anchor.subY = 7; // top of floor cell
                anchor.subZ = 4;
                anchor.face = face;

                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor, kind,
                                      PropFallMode::SimpleFall, color, 0, layer);
                if (e != entt::null) ++count;
            }
        }
    }
    return count;
}

std::uint32_t collect_interactable_positions(const Registry& reg, LayerId layer,
                                             Interactable::Kind kind,
                                             std::vector<vec3>& out)
{
    std::uint32_t n = 0;
    auto view = reg.view<const Transform, const Interactable>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& ia = view.get<const Interactable>(e);
        if (!ia.active || ia.kind != kind) continue;
        out.push_back(tr.pos);
        ++n;
    }
    return n;
}

InteractionHit find_nearest_interactable(const Registry& reg, Entity player,
                                         Interactable::Kind kind, float reachM)
{
    InteractionHit hit{};
    if (!reg.valid(player) || !reg.all_of<Transform>(player)) return hit;

    const auto& ptr = reg.get<Transform>(player);
    const LayerId layer = ptr.layer;
    const vec3 ppos = ptr.pos;
    const float reachSq = reachM * reachM;
    float best = reachSq;

    auto view = reg.view<const Transform, const Interactable>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& ia = view.get<const Interactable>(e);
        if (!ia.active || ia.kind != kind) continue;

        const float dx = wrap_delta_f_local(ppos.x, tr.pos.x, kWorldExtentLocal);
        const float dy = ppos.y - tr.pos.y;
        const float dz = wrap_delta_f_local(ppos.z, tr.pos.z, kWorldExtentLocal);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) {
            best = d2;
            hit.entity = e;
            hit.pos = tr.pos;
            hit.distSq = d2;
            hit.hit = true;
        }
    }
    return hit;
}

bool interaction_step(Registry& reg, Entity player, Interactable::Kind kind,
                      EventBus& bus, InteractionHit* outHit)
{
    (void)bus;
    const float reach = (reg.valid(player) && reg.all_of<Transform>(player))
                            ? 3.0f
                            : 0.0f;
    InteractionHit hit = find_nearest_interactable(reg, player, kind, reach);
    if (outHit) *outHit = hit;
    return hit.hit;
}

void prop_ragdoll_step(Registry& reg, float dt)
{
    // Angular integration is owned by physics_step (core). This step damps
    // spin on DynamicBodyTag props and drops AngularVelocity once settled
    // ([jirnyak.md] §18 prop_ragdoll). In-air debris damps slowly; grounded
    // debris damps hard so tumbled junk stops spinning after landing.
    constexpr float kAirDamp = 1.5f;   // 1/s exponential rate while airborne
    constexpr float kGroundMul = 0.85f; // per-step multiplier when grounded
    constexpr float kRestW2 = 1e-4f;    // |w|^2 below this -> remove component

    static thread_local std::vector<Entity> settled;
    settled.clear();

    auto view = reg.view<DynamicBodyTag, AngularVelocity>();
    for (auto e : view) {
        auto& ang = view.get<AngularVelocity>(e);

        const bool grounded = reg.all_of<GravityAffected>(e) &&
                              reg.get<GravityAffected>(e).grounded;
        if (grounded) {
            ang.w.x *= kGroundMul;
            ang.w.y *= kGroundMul;
            ang.w.z *= kGroundMul;
        } else {
            // exp(-k*dt) damping — always reduces |w| for dt > 0.
            const float s = std::exp(-kAirDamp * dt);
            ang.w.x *= s;
            ang.w.y *= s;
            ang.w.z *= s;
        }

        const float w2 = ang.w.x * ang.w.x + ang.w.y * ang.w.y + ang.w.z * ang.w.z;
        if (w2 < kRestW2) {
            settled.push_back(e);
        }
    }

    for (Entity e : settled) {
        if (reg.valid(e) && reg.all_of<AngularVelocity>(e))
            reg.remove<AngularVelocity>(e);
    }
}

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind,
                        EventBus& bus) {
    return interaction_step(reg, player, targetKind, bus, nullptr);
}

} // namespace giga::game

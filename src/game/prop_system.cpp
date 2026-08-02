#include "game/prop_system.h"
#include "ecs/components.h"
#include "world/macro_grid.h"
#include "world/materials.h"
#include "world/types.h"
#include "world/world.h"
#include <vector>
#include <unordered_set>
#include <cmath>
#include "core/wrap.h"
#include "core/rng.h"

namespace giga::game {

// Must match gpu::PropPlacer kSaltWall so ECS interactables land on the same
// cells as the GPU cosmetic Terminal / ElectricalShield instances.
constexpr std::uint32_t kSaltWall = 0x33333333u;
// Must match gpu::PropPlacer kSaltLight so ECS LightBulbs land on the
// same cells as BareBulb / FloodLamp GPU cosmetics.
constexpr std::uint32_t kSaltLight = 0x44444444u;
// Must match PropPlacerConfig::lightChancePct.
constexpr std::uint32_t kLightChancePct = 25u;

// PropShape ordinals (render/prop_mesh.h) — game stores as uint8, never includes
// render headers. Keep in lockstep with enum class PropShape.
constexpr std::uint8_t kShapeTerminal         = 19;
constexpr std::uint8_t kShapeFloodLamp        = 21;
constexpr std::uint8_t kShapeElectricalShield = 27;
constexpr std::uint8_t kShapeBareBulb         = 28;

constexpr float kHalfPi = 1.5707963267948966f;
constexpr float kPi     = 3.141592653589793f;



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
    // Resolve skin payload from the live entity when the caller left zeros
    // (anchor_validate / projectile hit historically passed meshKind=0).
    vec3 col = color;
    if ((col.x == 0.0f && col.y == 0.0f && col.z == 0.0f) &&
        reg.all_of<Renderable>(prop)) {
        col = reg.get<Renderable>(prop).color;
    }
    std::uint32_t mk = meshKind;
    if (mk == 0u && reg.all_of<PropMesh>(prop))
        mk = static_cast<std::uint32_t>(reg.get<PropMesh>(prop).shape);

    // Always announce detach so render/GPU handoff and tests can observe it
    // ([jirnyak.md] section 18 PropDetached -- a/b/c = packed world pos).
    bus.publish(EventType::PropDetached,
                static_cast<std::uint32_t>(pos.x),
                static_cast<std::uint32_t>(pos.y),
                static_cast<std::uint32_t>(pos.z));

    if (mode == PropFallMode::GpuHandoff) {
        // Shatter parent into CPU debris chips then destroy it
        // ([jirnyak.md] §18/19 — sim debris on BodyPass, not void / bus POD).
        DebrisSpawnEvent ev{};
        ev.pos = pos;
        ev.impulse = impulse;
        ev.color = col;
        ev.meshKind = mk;
        LayerId layer = 0;
        if (reg.all_of<Transform>(prop))
            layer = reg.get<Transform>(prop).layer;
        spawn_debris_pieces(reg, ev, layer, /*count=*/3);
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

    // BodyPass needs AABB -- without it a detached prop is invisible.
    if (!reg.all_of<AABB>(prop))
        reg.emplace<AABB>(prop, AABB{vec3{0.2f, 0.2f, 0.2f}});
}

bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel,
                                float projHitRadius, EventBus& bus)
{
    const float radiusSq = projHitRadius * projHitRadius;
    const int pcx = wrap_macro(static_cast<int>(projPos.x / kCellSize));
    const int pcy = wrap_macro(static_cast<int>(projPos.y / kCellSize));
    const int pcz = wrap_macro(static_cast<int>(projPos.z / kCellSize));

    Entity hitEntity = entt::null;
    PropFallMode hitMode = PropFallMode::SimpleFall;
    vec3 hitPos{0.0f, 0.0f, 0.0f};
    vec3 hitColor{0.8f, 0.8f, 0.8f};

    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& anchor = view.get<SubVoxelAnchor>(entity);

        if (std::abs(wrap_delta(anchor.cx, pcx, kMacroDim)) > 1 ||
            std::abs(wrap_delta(anchor.cy, pcy, kMacroDim)) > 1 ||
            std::abs(wrap_delta(anchor.cz, pcz, kMacroDim)) > 1)
        {
            continue;
        }

        const auto& tr = view.get<Transform>(entity);
        const float dx = wrap_delta_f(projPos.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(projPos.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(projPos.z, tr.pos.z, kWorldExtent);

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

std::uint32_t anchor_validate_step(Registry& reg, const World& world, EventBus& bus,
                                   const std::vector<std::uint32_t>& dirtyCells)
{
    if (dirtyCells.empty()) return 0;

    // dirtyCells are flat macro_index keys (CarveResult / DoorSet contract).
    static thread_local std::unordered_set<std::uint32_t> dirtySet;
    dirtySet.clear();
    dirtySet.insert(dirtyCells.begin(), dirtyCells.end());

    static thread_local std::vector<PendingDetachedProp> detached;
    detached.clear();

    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& anchor = view.get<SubVoxelAnchor>(entity);

        const int cx = wrap_macro(anchor.cx);
        const int cy = wrap_macro(anchor.cy);
        const int cz = wrap_macro(anchor.cz);
        const std::uint32_t key =
            static_cast<std::uint32_t>(macro_index(cx, cy, cz));

        if (!dirtySet.contains(key)) continue;

        // Anchor support lost when the sub-voxel is no longer solid.
        if (!world.grid().solid(cx, cy, cz, anchor.subX, anchor.subY, anchor.subZ)) {
            const auto& tr = view.get<Transform>(entity);
            vec3 col = reg.all_of<Renderable>(entity)
                           ? reg.get<Renderable>(entity).color
                           : vec3{0.8f, 0.8f, 0.8f};
            std::uint32_t mk = 0;
            if (reg.all_of<PropMesh>(entity))
                mk = static_cast<std::uint32_t>(reg.get<PropMesh>(entity).shape);
            detached.push_back({entity, view.get<PropFallMode>(entity), tr.pos,
                                vec3{0.0f, 1.0f, 0.0f}, col, mk});
        }
    }

    for (const auto& item : detached) {
        detach_single_prop(reg, item.entity, item.mode, item.impulse, item.pos,
                           item.color, item.meshKind, bus);
    }
    return static_cast<std::uint32_t>(detached.size());
}


Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer, float yaw, std::uint8_t emissive,
                  std::uint8_t matId, std::uint8_t animPhase, std::uint8_t flags)
{
    int cx = wrap_macro(anchor.cx);
    int cy = wrap_macro(anchor.cy);
    int cz = wrap_macro(anchor.cz);

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
    // PropMesh carries PropShape ordinal + instance payload for PropPass skin.
    PropMesh mesh{};
    mesh.shape     = static_cast<std::uint8_t>(meshKind);
    mesh.yaw       = yaw;
    mesh.matId     = matId;
    mesh.emissive  = emissive;
    mesh.flags     = flags;
    mesh.animPhase = animPhase;
    reg.emplace<PropMesh>(prop, mesh);

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
    // 25-35 terminal). World is Z-up: floor support = solid cell at z-1.
    // Horizontal walls are X/Y neighbors. Anchor into solid floor so
    // spawn_prop's solid() check and anchor_validate_step stay honest.
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType below = grid.cell(x, y, z - 1);
                if (!is_solid_cell(below)) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y + 1, z));
                const bool solidSouth = is_solid_cell(grid.cell(x, y - 1, z));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = giga::spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 100;

                // Wall yaw matches PropPlacer (west=0, east=pi, south=halfPi, north=3*halfPi).
                float yawVal = 0.0f;
                if (solidWest)        yawVal = 0.0f;
                else if (solidEast)   yawVal = kPi;
                else if (solidSouth)  yawVal = kHalfPi;
                else if (solidNorth)  yawVal = kHalfPi * 3.0f;

                Interactable::Kind kind;
                float zOff;
                vec3 color;
                std::uint8_t shape = 0;
                std::uint8_t matId = 4;
                std::uint8_t face = 1; // wall
                if (wsel >= 15 && wsel < 25) {
                    kind  = Interactable::Kind::ElectricalShield;
                    zOff  = 0.40f;
                    color = {0.18f, 0.20f, 0.22f};
                    shape = kShapeElectricalShield;
                    matId = 4;
                } else if (wsel >= 25 && wsel < 35) {
                    kind  = Interactable::Kind::Terminal;
                    zOff  = 0.0f;
                    color = {0.32f, 0.35f, 0.38f};
                    shape = kShapeTerminal;
                    matId = 3;
                } else {
                    continue; // radiator / empty — no Interactable
                }

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell;
                const float wz = static_cast<float>(z) * kCell + zOff;

                // Anchor into the solid floor cell under the air cell (Z-1).
                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = wrap_macro(z - 1);
                anchor.subX = 4;
                anchor.subY = 4;
                anchor.subZ = 7; // top of floor cell
                anchor.face = face;

                const std::uint8_t anim = static_cast<std::uint8_t>(rngWall & 0xFFu);
                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor, kind,
                                      PropFallMode::SimpleFall, color, shape, layer,
                                      yawVal, /*emissive*/0, matId, anim, /*flags*/0);
                if (e != entt::null) ++count;

            }
        }
    }
    return count;
}


std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate light branch:
    //   solidAbove && (rngLight % 100 < lightChancePct)
    //   origin = {wx, wy, wz + 1.55f}
    // Anchor into the solid ceiling cell (Z+1) so spawn_prop solid() and
    // anchor_validate_step stay honest — lamp falls when ceiling is carved.
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType above = grid.cell(x, y, z + 1);
                if (!is_solid_cell(above)) continue;

                const std::uint32_t rngLight = giga::spatial_hash(x, y, z, seed ^ kSaltLight);
                if ((rngLight % 100u) >= kLightChancePct) continue;

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell;
                const float wz = static_cast<float>(z) * kCell + 1.55f;

                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = wrap_macro(z + 1);
                anchor.subX = 4;
                anchor.subY = 4;
                anchor.subZ = 0; // bottom of ceiling cell
                anchor.face = 2; // ceiling

                // BareBulb vs FloodLamp + yaw/emissive match PropPlacer light branch.
                const std::uint8_t shape =
                    (rngLight & 1u) ? kShapeBareBulb : kShapeFloodLamp;
                const float yaw = static_cast<float>(rngLight % 4u) * kHalfPi;
                const std::uint8_t anim =
                    static_cast<std::uint8_t>(rngLight & 0xFFu);

                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor,
                                      Interactable::Kind::LightBulb,
                                      PropFallMode::RagdollRoll,
                                      vec3{1.00f, 0.78f, 0.45f}, shape, layer,
                                      yaw, /*emissive*/250, /*matId*/0, anim,
                                      /*flags*/0);
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

std::uint32_t collect_static_prop_mesh_instances(const Registry& reg, LayerId layer,
                                                 std::vector<PropMeshInstance>& out)
{
    std::uint32_t n = 0;
    // StaticPropTag filters out detached DynamicBodyTag props (BodyPass owns those).
    auto view = reg.view<const Transform, const PropMesh, const StaticPropTag>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& mesh = view.get<const PropMesh>(e);
        PropMeshInstance inst{};
        inst.shape     = mesh.shape;
        inst.origin    = tr.pos;
        inst.yaw       = mesh.yaw;
        inst.matId     = mesh.matId;
        inst.emissive  = mesh.emissive;
        inst.flags     = mesh.flags;
        inst.animPhase = mesh.animPhase;
        if (reg.all_of<Renderable>(e))
            inst.color = reg.get<Renderable>(e).color;
        out.push_back(inst);
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

        const float dx = wrap_delta_f(ppos.x, tr.pos.x, kWorldExtent);
        const float dy = ppos.y - tr.pos.y;
        const float dz = wrap_delta_f(ppos.z, tr.pos.z, kWorldExtent);
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

std::uint32_t spawn_debris_pieces(Registry& reg, const DebrisSpawnEvent& ev,
                                  LayerId layer, int count)
{
    // Clamp: one chip minimum so callers never get a silent no-op; hard cap
    // keeps a single shatter from flooding BodyPass.
    if (count < 1) count = 1;
    if (count > 8) count = 8;

    // Small chips -- BodyPass AABB skin. half=0.10 m matches roll-drive r floor
    // path in physics_step (r = min half, clamped >= 0.05).
    constexpr float kHalf = 0.10f;
    // Deterministic scatter offsets (no RNG) so tests are bit-stable.
    static constexpr float kOx[8] = {
        0.06f, -0.06f, 0.06f, -0.06f, 0.00f, 0.00f, 0.09f, -0.09f};
    static constexpr float kOy[8] = {
        0.00f, 0.00f, 0.00f, 0.00f, 0.06f, -0.06f, 0.04f, -0.04f};
    static constexpr float kOz[8] = {
        0.06f, 0.06f, -0.06f, -0.06f, 0.04f, 0.04f, 0.00f, 0.00f};

    std::uint32_t n = 0;
    for (int i = 0; i < count; ++i) {
        Entity e = reg.create();
        const vec3 p{ev.pos.x + kOx[i], ev.pos.y + kOy[i], ev.pos.z + kOz[i]};
        reg.emplace<Transform>(e, p, layer);

        // Lateral scatter on the impulse so chips fan out instead of stacking.
        vec3 v = ev.impulse;
        v.x += 0.45f * static_cast<float>((i % 3) - 1);
        v.y += 0.45f * static_cast<float>(((i / 3) % 3) - 1);
        // Guarantee a non-zero kick even if impulse was zero (anchor air detach).
        if (v.x == 0.0f && v.y == 0.0f && v.z == 0.0f)
            v.z = 1.0f;
        reg.emplace<Velocity>(e, Velocity{v});

        // Spin from impulse, same basis as RagdollRoll detach, plus per-chip bias.
        const float fi = static_cast<float>(i);
        vec3 w{ev.impulse.z + fi * 0.7f, ev.impulse.x - fi * 0.5f, 2.0f + fi};
        reg.emplace<AngularVelocity>(e, AngularVelocity{w});
        reg.emplace<Rotation>(e);
        reg.emplace<AABB>(e, AABB{vec3{kHalf, kHalf, kHalf}});
        reg.emplace<GravityAffected>(e);
        reg.emplace<DynamicBodyTag>(e);
        reg.emplace<Renderable>(e, ev.color);

        // Optional mesh skin ordinal for render upload; BodyPass still owns motion.
        if (ev.meshKind != 0u) {
            reg.emplace<PropMeshTag>(e);
            PropMesh mesh{};
            mesh.shape = static_cast<std::uint8_t>(ev.meshKind & 0xFFu);
            reg.emplace<PropMesh>(e, mesh);
        }
        ++n;
    }
    return n;
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

    Entity settled[64];
    int settledCount = 0;

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
            settled[settledCount++] = e;
            if (settledCount == 64) {
                for (int i = 0; i < 64; ++i) {
                    reg.remove<AngularVelocity>(settled[i]);
                }
                settledCount = 0;
            }
        }
    }

    for (int i = 0; i < settledCount; ++i) {
        reg.remove<AngularVelocity>(settled[i]);
    }
}

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind,
                        EventBus& bus) {
    return interaction_step(reg, player, targetKind, bus, nullptr);
}

} // namespace giga::game

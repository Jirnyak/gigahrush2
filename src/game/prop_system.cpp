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

// Salt for wall-device placement rolls (inherited from the purged gpu::PropPlacer
// so historical placements stay put) — ECS interactables land on the same
// cells as the GPU cosmetic Terminal / ElectricalShield instances.
constexpr std::uint32_t kSaltWall = 0x33333333u;
// Salt for ceiling-light placement rolls (same inheritance as kSaltWall above).
constexpr std::uint32_t kSaltLight = 0x44444444u;
// Chance a candidate ceiling cell hosts a bulb, percent.
constexpr std::uint32_t kLightChancePct = 25u;

constexpr float kHalfPi = 1.5707963267948966f;

// Map table ordinals (data/props.csv) onto the live enums. Unknown values
// fall back to safe defaults so a bad CSV row cannot crash the seeder.
static PropFallMode fall_mode_from_u8(std::uint8_t v) {
    switch (v) {
    case 1:  return PropFallMode::RagdollRoll;
    case 2:  return PropFallMode::GpuHandoff;
    default: return PropFallMode::SimpleFall;
    }
}

static Interactable::Kind interact_kind_from_u8(std::uint8_t v) {
    // The ordinal IS the generated table row ([interact_table.h], CSV order).
    // Out-of-range (255 = "None" and any stale byte) clamps to row 0's
    // behaviourless default at the call sites that check `interact != 255`.
    return v < kInteractCount ? static_cast<Interactable::Kind>(v)
                              : Interactable::Kind::Loot;
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
                               std::uint32_t meshKind, EventBus& bus,
                               ParticleBurstQueue* bursts, std::uint32_t seed)
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
        // The mode's whole promise: no CPU debris entity, the SHOW is GPU
        // particles. It used to keep only the first half and vanish silently —
        // the burst below is what makes the name true. Tinted by the prop's own
        // material row, exactly as a severed antourage piece is
        // ([game/antourage] antourage_carve_step).
        if (bursts != nullptr) {
            std::uint16_t matId = 0;
            if (reg.all_of<PropMesh>(prop))
                matId = reg.get<PropMesh>(prop).matId;
            // Burst direction rides the caller's impulse, which callers derive
            // from the layer's gravity vector — this function has no World and
            // must NOT invent an axis of its own ([AGENTS.md]: never assume -Z).
            // Falls back to +Z when the impulse is degenerate — the same last-resort
            // axis the SimpleFall branch below uses, so the two never disagree.
            const float iLen = length(impulse);
            const vec3 dir = iLen > 1e-6f ? impulse * (0.35f / iLen)
                                          : vec3{0.0f, 0.0f, 0.35f};
            bursts->push(pos, dir, ParticleKind::Debris, 6,
                         matId, seed ^ 0xD3B15u);
        }
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
        // SimpleFall: a small shove along the pull. Derived by negating the
        // caller's up-facing impulse instead of hardcoding -Z, for the same
        // reason as the burst above — this function never sees a World.
        const float iLen = length(impulse);
        const vec3 down =
            iLen > 1e-6f ? impulse * (-0.5f / iLen) : vec3{0.0f, 0.0f, -0.5f};
        reg.emplace_or_replace<Velocity>(prop, Velocity{down});
    }

    // BodyPass needs AABB -- without it a detached prop is invisible.
    if (!reg.all_of<AABB>(prop))
        reg.emplace<AABB>(prop, AABB{vec3{0.2f, 0.2f, 0.2f}});
}

bool check_projectile_prop_hits(Registry& reg, const vec3& projPos, const vec3& projVel,
                                float projHitRadius, EventBus& bus,
                                ParticleBurstQueue* bursts, std::uint32_t seed)
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
        vec3 impulse = normalize(projVel) * 3.0f + vec3{0.0f, 0.0f, 1.0f};
        detach_single_prop(reg, hitEntity, hitMode, impulse, hitPos, hitColor, 0,
                           bus, bursts, seed);
        return true;
    }
    return false;
}

std::uint32_t anchor_validate_step(Registry& reg, const World& world, EventBus& bus,
                                   const std::vector<std::uint32_t>& dirtyCells,
                                   ParticleBurstQueue* bursts, std::uint32_t seed)
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
            // The detach kick is a nudge AWAY from the pull, so it is derived from
            // the layer's gravity vector, not the literal +Z it used to be
            // ([AGENTS.md]: never assume -Z). `world` is already in hand here, so
            // there is no excuse for guessing which way is up.
            const vec3 g = world.gravity().at(tr.pos);
            const float gLen = length(g);
            const vec3 up =
                gLen > 1e-6f ? g * (-1.0f / gLen) : vec3{0.0f, 0.0f, 1.0f};
            detached.push_back({entity, view.get<PropFallMode>(entity), tr.pos,
                                up, col, mk});
        }
    }

    for (std::size_t i = 0; i < detached.size(); ++i) {
        const auto& item = detached[i];
        detach_single_prop(reg, item.entity, item.mode, item.impulse, item.pos,
                           item.color, item.meshKind, bus, bursts,
                           seed ^ static_cast<std::uint32_t>(i) * 0x9E3779B9u);
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

Entity spawn_prop_from_id(Registry& reg, const World& world, const vec3& worldPos,
                          const SubVoxelAnchor& anchor, PropId id,
                          LayerId layer, float yaw,
                          std::uint8_t animPhase, std::uint8_t flags)
{
    if (!prop_valid(id)) return entt::null;
    const PropDef& d = prop_def(id);
    Entity e = spawn_prop(reg, world, worldPos, anchor,
                          interact_kind_from_u8(d.interactKind),
                          fall_mode_from_u8(d.fallMode),
                          prop_color(d),
                          d.shape,
                          layer, yaw, d.emissive, d.matId, animPhase, flags);
    if (e == entt::null) return entt::null;
    // Universal mass from the table ([ecs/components.h] Mass): a falling or
    // thrown prop hits with E = m*v^2/2 like everything else in the game.
    reg.emplace_or_replace<Mass>(e, Mass{static_cast<float>(d.massG) * 0.001f});
    // Authored size: the unit shape is scaled to the table's exact metres.
    if (auto* pm = reg.try_get<PropMesh>(e))
        pm->scale = vec3{static_cast<float>(d.sizeXMm) * 0.001f,
                         static_cast<float>(d.sizeYMm) * 0.001f,
                         static_cast<float>(d.sizeZMm) * 0.001f};
    // Table reachMm overrides the spawn_prop default (2.5 m).
    if (reg.all_of<Interactable>(e)) {
        auto& ia = reg.get<Interactable>(e);
        ia.reachM = static_cast<float>(d.reachMm) * 0.001f;
    }
    return e;
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

    // WALL-MOUNTED devices, isotropically ([isotropy-law]): a candidate is ANY
    // air cell beside a wall — no floor-support requirement (the old PropPlacer
    // port demanded solid-below, which on the module geometry confined every
    // shield to one ankle-height row per storey). The device anchors INTO the
    // wall cell it hangs on and sits FLUSH against the wall face, centred in
    // the cell, at panel height.
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y + 1, z));
                const bool solidSouth = is_solid_cell(grid.cell(x, y - 1, z));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = giga::spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 2000;

                // Sparse bands: ~0.35% shields + ~0.2% terminals of eligible
                // wall cells ≈ a dozen devices per storey (the legacy
                // 10%+10% carpeted whole rooms with thousands).
                PropId pid;
                if (wsel < 7) {
                    pid = PropId::ElectricalShield;
                } else if (wsel < 11) {
                    pid = PropId::Terminal;
                } else {
                    continue;
                }
                const PropDef& d = prop_def(pid);
                const float thick = static_cast<float>(d.sizeYMm) * 0.001f;

                // The wall it hangs on: normal direction + flush offset + yaw.
                // Sizes are authored width(X) x thickness(Y) x height(Z) for a
                // yaw-0 panel facing +-Y; X/Y walls rotate a quarter turn.
                int wxd = 0, wyd = 0;
                float yawVal = 0.0f;
                if (solidWest)       { wxd = -1; yawVal = kHalfPi; }
                else if (solidEast)  { wxd = 1;  yawVal = kHalfPi; }
                else if (solidSouth) { wyd = -1; yawVal = 0.0f; }
                else                 { wyd = 1;  yawVal = 0.0f; }

                // Flush: slide the panel centre from the cell centre to the
                // wall face, leaving half its thickness plus a hair of gap.
                const float slide = 1.0f - (0.5f * thick + 0.02f);
                const float wx = (static_cast<float>(x) + 0.5f) * kCell +
                                 static_cast<float>(wxd) * slide;
                const float wy = (static_cast<float>(y) + 0.5f) * kCell +
                                 static_cast<float>(wyd) * slide;
                const float wz = (static_cast<float>(z) + 0.5f) * kCell;

                // Anchor INTO the wall cell: the panel falls when its wall is
                // carved, not when some unrelated floor is.
                SubVoxelAnchor anchor;
                anchor.cx   = static_cast<std::uint8_t>(wrap_macro(x + wxd));
                anchor.cy   = static_cast<std::uint8_t>(wrap_macro(y + wyd));
                anchor.cz   = static_cast<std::uint8_t>(z);
                anchor.subX = static_cast<std::uint8_t>(wxd < 0 ? 7 : wxd > 0 ? 0 : 4);
                anchor.subY = static_cast<std::uint8_t>(wyd < 0 ? 7 : wyd > 0 ? 0 : 4);
                anchor.subZ = 4;
                anchor.face = 1; // wall

                const std::uint8_t anim = static_cast<std::uint8_t>(rngWall & 0xFFu);
                Entity e = spawn_prop_from_id(reg, world, vec3{wx, wy, wz}, anchor,
                                             pid, layer, yawVal, anim, /*flags*/0);
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

                // No lamps in doorway/niche cells: walls on BOTH opposite sides
                // means a lintel slot, and a bulb there floats in the opening.
                const bool nichX = is_solid_cell(grid.cell(x - 1, y, z)) &&
                                   is_solid_cell(grid.cell(x + 1, y, z));
                const bool nichY = is_solid_cell(grid.cell(x, y - 1, z)) &&
                                   is_solid_cell(grid.cell(x, y + 1, z));
                if (nichX || nichY) continue;

                const std::uint32_t rngLight = giga::spatial_hash(x, y, z, seed ^ kSaltLight);
                if ((rngLight % 100u) >= kLightChancePct) continue;

                // Hang from the REAL ceiling under-face: the sandwich is
                // partially carved from below, and the cell-plane form left
                // bulbs floating mid-air. A holed centre column = no lamp.
                const int faceSz =
                    grid.mask(x, y, z + 1).lowest_layer_centre();
                if (faceSz < 0) continue;
                const float faceM = (static_cast<float>(z) + 1.0f) * kCell +
                                    static_cast<float>(faceSz) * (kCell / 8.0f);

                // Cell CENTRE — the corner form hung bulbs on whatever wall
                // shared the corner (the same bug the wall seeder had).
                const float wx = (static_cast<float>(x) + 0.5f) * kCell;
                const float wy = (static_cast<float>(y) + 0.5f) * kCell;
                const float wz = faceM - 0.14f;

                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = wrap_macro(z + 1);
                anchor.subX = 4;
                anchor.subY = 4;
                anchor.subZ = 0; // bottom of ceiling cell
                anchor.face = 2; // ceiling

                // BareBulb vs FloodLamp choice stays procedural; skin from props.csv.
                const PropId pid =
                    (rngLight & 1u) ? PropId::BareBulb : PropId::FloodLamp;
                const float yaw = static_cast<float>(rngLight % 4u) * kHalfPi;
                const std::uint8_t anim =
                    static_cast<std::uint8_t>(rngLight & 0xFFu);

                Entity e = spawn_prop_from_id(reg, world, vec3{wx, wy, wz}, anchor,
                                             pid, layer, yaw, anim, /*flags*/0);
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
        if (const auto* rot = reg.try_get<Rotation>(e)) {
            inst.yaw += rot->euler.z;
        }
        inst.scale     = mesh.scale;
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

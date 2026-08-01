#include "game/prop_system.h"
#include "ecs/components.h"
#include <vector>

namespace giga::game {

static inline int wrap_macro(int c) {
    return (c % 128 + 128) % 128;
}

Entity spawn_prop(Registry& reg, const vec3& worldPos, const SubVoxelAnchor& anchor,
                   Interactable::Kind kind, PropFallMode fallMode, 
                   const vec3& color, std::uint32_t meshKind) {
    SubVoxelAnchor wrappedAnchor = anchor;
    wrappedAnchor.cx = wrap_macro(anchor.cx);
    wrappedAnchor.cy = wrap_macro(anchor.cy);
    wrappedAnchor.cz = wrap_macro(anchor.cz);

    Entity prop = reg.create();
    
    reg.emplace<Transform>(prop, worldPos, 0);
    reg.emplace<SubVoxelAnchor>(prop, wrappedAnchor);
    reg.emplace<Interactable>(prop, kind, 2.5f, true);
    reg.emplace<PropFallMode>(prop, fallMode);
    reg.emplace<Renderable>(prop, color);

    return prop;
}

static void detach_single_prop(Registry& reg, Entity prop, PropFallMode mode, 
                               const vec3& impulse, const vec3& pos, const vec3& color, EventBus& bus) {
    if (mode == PropFallMode::GpuHandoff) {
        bus.publish(DebrisSpawnEvent{pos, impulse, color, 0});
        reg.destroy(prop);
    } 
    else if (mode == PropFallMode::RagdollRoll) {
        reg.remove<SubVoxelAnchor>(prop);
        reg.emplace_or_replace<GravityAffected>(prop);
        reg.emplace_or_replace<Velocity>(prop, impulse);
        reg.emplace_or_replace<AngularVelocity>(prop, vec3{impulse.z, impulse.x, 2.0f});
        reg.emplace_or_replace<Rotation>(prop);
    } 
    else {
        reg.remove<SubVoxelAnchor>(prop);
        reg.emplace_or_replace<GravityAffected>(prop);
        reg.emplace_or_replace<Velocity>(prop, vec3{0.0f, -0.5f, 0.0f});
    }
}

void damage_prop_entity(Registry& reg, Entity prop, const vec3& bulletDir, float bulletForce, EventBus& bus) {
    if (!reg.valid(prop) || !reg.all_of<SubVoxelAnchor>(prop)) return;

    auto mode = reg.get<PropFallMode>(prop);
    auto& tr = reg.get<Transform>(prop);
    vec3 col = reg.all_of<Renderable>(prop) ? reg.get<Renderable>(prop).color : vec3{0.8f, 0.8f, 0.8f};
    vec3 impulse = bulletDir * (bulletForce * 0.1f) + vec3{0.0f, 1.0f, 0.0f};

    detach_single_prop(reg, prop, mode, impulse, tr.pos, col, bus);
}

void anchor_validate_step(Registry& reg, const World& world, EventBus& bus) {
    struct DetachedItem { Entity entity; PropFallMode mode; vec3 pos; vec3 color; };
    static thread_local std::vector<DetachedItem> detached;
    detached.clear();

    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& anchor = view.get<SubVoxelAnchor>(entity);

        if (!world.solid(anchor.cx, anchor.cy, anchor.cz, anchor.subX, anchor.subY, anchor.subZ)) {
            const auto& tr = view.get<Transform>(entity);
            vec3 col = reg.all_of<Renderable>(entity) ? reg.get<Renderable>(entity).color : vec3{0.8f, 0.8f, 0.8f};
            detached.push_back({entity, view.get<PropFallMode>(entity), tr.pos, col});
        }
    }

    for (const auto& item : detached) {
        detach_single_prop(reg, item.entity, item.mode, vec3{0.0f, 1.0f, 0.0f}, item.pos, item.color, bus);
    }
}

bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind, EventBus& bus) {
    if (!reg.valid(player) || !reg.all_of<Transform>(player)) return false;

    const vec3 ppos = reg.get<Transform>(player).pos;
    
    if (targetKind == Interactable::Kind::LightBulb) {
        vec3 bulbPos = ppos + vec3{0.0f, 1.8f, 0.0f};
        
        SubVoxelAnchor anchor;
        anchor.cx = static_cast<int>(bulbPos.x / kCellSize);
        anchor.cy = static_cast<int>(bulbPos.y / kCellSize);
        anchor.cz = static_cast<int>(bulbPos.z / kCellSize);
        anchor.subY = 7;

        spawn_prop(reg, bulbPos, anchor, Interactable::Kind::LightBulb, 
                   PropFallMode::RagdollRoll, vec3{1.0f, 0.95f, 0.7f}, 12);
        
        return true;
    }
    return false;
}

} // namespace giga::game

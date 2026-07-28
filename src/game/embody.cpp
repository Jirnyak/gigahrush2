#include "game/embody.h"

namespace giga::game {

namespace {

// Resolve a record's stature to millimetres, substituting a default adult
// height for an unset/blank (zeroed reserve) record so it still embodies sanely.
std::uint16_t resolved_height_mm(std::uint16_t stored) {
    return stored != 0 ? stored : kDefaultHeightMm;
}

// Body tint for the render skin: one hue per faction (distinct from the world's
// grays/greens/tans so people pop against the building), plus a little
// deterministic per-record jitter so a crowd doesn't look like flat clones. The
// sim never reads this — it is purely how the body pass draws the entity.
vec3 faction_color(std::uint16_t faction, NpcId id) {
    static const vec3 kFactionHue[4] = {
        {0.90f, 0.28f, 0.26f}, // 0 — red
        {0.28f, 0.55f, 0.95f}, // 1 — blue
        {0.95f, 0.80f, 0.22f}, // 2 — amber
        {0.66f, 0.34f, 0.86f}, // 3 — violet
    };
    vec3 c = kFactionHue[faction & 3u];
    std::uint32_t h = id * 0x9e3779b9u;
    h ^= h >> 15;
    float j = (static_cast<float>(h & 0xFFu) / 255.0f - 0.5f) * 0.18f; // +/-0.09
    return vec3{clamp01(c.x + j), clamp01(c.y + j), clamp01(c.z + j)};
}

} // namespace

float body_half_height(std::uint16_t height_mm) {
    return resolved_height_mm(height_mm) * 0.001f * 0.5f;
}

float body_eye_height(std::uint16_t height_mm) {
    // Eyes ~7% below the crown, measured from the body centre (Transform::pos).
    float h = resolved_height_mm(height_mm) * 0.001f;
    return h * 0.5f - h * 0.07f;
}

Entity embody(Registry& reg, NpcPool& pool, NpcId id, LayerId layer) {
    if (!pool.valid(id)) return entt::null;

    Entity e = reg.create();
    reg.emplace<NpcRef>(e, NpcRef{id});

    Transform tr;
    tr.pos = vec3{(static_cast<float>(pool.cx(id)) + 0.5f) * kEmbodyCellSize,
                  (static_cast<float>(pool.cy(id)) + 0.5f) * kEmbodyCellSize,
                  (static_cast<float>(pool.cz(id)) + 0.5f) * kEmbodyCellSize};
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);

    // Stature drives the collider: ~0.4 m half-width, half-height from height.
    float hh = body_half_height(pool.height_mm(id));
    reg.emplace<AABB>(e, AABB{vec3{0.4f, 0.4f, hh}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
    reg.emplace<Jump>(e, Jump{6.5f, false});

    // Render skin: a faction-tinted box the size of the collider. Cosmetic only
    // (the body pass reads it; the sim never does), so the whole embodied crowd
    // is visible out of the box.
    reg.emplace<Renderable>(e, Renderable{faction_color(pool.faction(id), id)});

    pool.set_embodied(id, true);
    return e;
}

Entity embody_as_player(Registry& reg, NpcPool& pool, NpcId id, LayerId layer) {
    Entity e = embody(reg, pool, id, layer);
    if (e == entt::null) return e;

    // The camera sits at THIS body's eye height, so swapping into a shorter or
    // taller record immediately views from its stature.
    CameraTag cam;
    cam.eyeOffset = vec3{0.0f, 0.0f, body_eye_height(pool.height_mm(id))};
    reg.emplace<CameraTag>(e, cam);
    reg.emplace<Controller>(e, Controller{7.0f, {0, 0, 0}, false});

    pool.set_player(id, true);
    return e;
}

void fold_back(Registry& reg, NpcPool& pool, NpcId id, Entity e) {
    if (pool.valid(id) && reg.valid(e)) {
        // Freeze the live state back into the cold record: position -> macro
        // cell (clamped into the 0..255 cell range), then de-embody.
        if (auto* tr = reg.try_get<Transform>(e)) {
            auto to_cell = [](float w) -> std::uint8_t {
                float c = w / kEmbodyCellSize;
                if (c < 0.0f) c = 0.0f;
                if (c > 255.0f) c = 255.0f;
                return static_cast<std::uint8_t>(c);
            };
            pool.cx(id) = to_cell(tr->pos.x);
            pool.cy(id) = to_cell(tr->pos.y);
            pool.cz(id) = to_cell(tr->pos.z);
        }
        pool.set_embodied(id, false);
        pool.set_player(id, false);
    }
    if (reg.valid(e)) reg.destroy(e);
}

} // namespace giga::game

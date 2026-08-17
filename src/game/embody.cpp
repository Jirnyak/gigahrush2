#include "game/embody.h"

#include "game/equip.h"    // Equipped — the empty decision cells on embodiment
#include "game/faction.h"
#include "game/prop_system.h" // Interactable — a living body is a menu ([conversation.md])
#include "game/rpg.h"      // RpgStats, random_rpg
// NOTE: #include "game/ai.h" (AiBrain) goes back here when the utility AI is
// adapted to main mob_table -- see tools/branch_port_pending/README.md

#include "core/wrap.h"

namespace giga::game {

namespace {

// Resolve a record's stature to millimetres, substituting a default adult
// height for an unset/blank (zeroed reserve) record so it still embodies sanely.
std::uint16_t resolved_height_mm(std::uint16_t stored) {
    return stored != 0 ? stored : kDefaultHeightMm;
}

} // namespace

float body_half_height(std::uint16_t height_mm) {
    return resolved_height_mm(height_mm) * 0.001f * 0.5f;
}

float body_mass_kg(std::uint16_t height_mm) {
    const float hm = resolved_height_mm(height_mm) * 0.001f;
    return 22.0f * hm * hm;
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
    // Universal mass from stature ([embody.h] body_mass_kg). Feeds E = m*v^2/2
    // (fall damage) and p = m*v everywhere. This is the BODY only; what it is
    // CARRYING is folded in by `encumbrance_step` ([encumbrance.h]), which is what
    // makes a loaded fall hurt more through the same law rather than a new one.
    reg.emplace<Mass>(e, Mass{body_mass_kg(pool.height_mm(id))});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
    reg.emplace<Jump>(e, Jump{6.5f, false});

    // Render skin: a faction-tinted box the size of the collider. Cosmetic only
    // (the body pass reads it; the sim never does), so the whole embodied crowd
    // is visible out of the box.
    reg.emplace<Renderable>(e, Renderable{faction_color(pool.faction(id), id)});

    // Every living body is an interaction target ([conversation.md]): E opens
    // the option menu — talk, quest, barter, the games to come. The player's
    // own body carries it too (no special case; the finders skip self).
    reg.emplace<Interactable>(
        e, Interactable{Interactable::Kind::Npc,
                        interact_def(InteractKind::Npc).reachM, true});

    // Utility-AI transient state ([ai.md]): 0..100 needs seeded deterministically
    // from the stable id, and an empty hysteresis/stagger brain. Both materialise
    // on embodiment and fold away with the entity, like Transform/Velocity —
    // hp/inventory stay canonical in the pool row ([npcs.md]). The player gets
    // them too (harmless: ai_step skips camera-holders), so a body-swap needs no
    // special case — the new body simply starts with a fresh, seeded set of needs.
    // PARKED, and this one is a design conflict rather than a missing include. The
    // branch attached Needs as an ECS component here and seeded it per entity. main
    // keeps the survival clock in the POOL ROW on purpose: the elevator fold_back ->
    // embody_as_player DESTROYS the player body, so a component would silently reset
    // the clock on every floor change -- a trip clock quietly becoming a floor clock.
    // AiBrain (hysteresis/stagger) is legitimately per-entity and comes back with the
    // adapted utility AI. See tools/branch_port_pending/README.md.

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

    // Character sheet. Rolled from the record's own level, so possessing a
    // level-7 resident gives you a level-7 build rather than a fresh one, and the
    // roll is deterministic in the record id — re-embodying the SAME person after
    // an elevator ride reproduces their exact str/agi/int rather than rerolling a
    // new personality onto them.
    //
    // emplace_or_replace, not emplace: a caller that preserves progression across
    // a body swap (main.cpp does this for the kill tally) overwrites this
    // immediately afterwards, and the body is freshly built here in either case.
    reg.emplace_or_replace<RpgStats>(e, random_rpg(pool.level(id), id));

    // The equip DECISION cells, all empty ([equip.h]): the player decides by
    // hand, so a fresh embodiment fights with fists until `equip` says
    // otherwise. No auto-equip — its absence here is the design, not a gap.
    reg.emplace_or_replace<Equipped>(e, Equipped{});

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

TerminalInteractResult embody_interact_terminal(Registry& reg, World& world, DoorSet& doors,
                                                LayerId layer, const vec3& terminalPos) {
    // Proximity is the caller's job (find_nearest_interactable / interaction_step).
    // This only applies the terminal effect — never invent a hit at playerPos.
    TerminalInteractResult res;
    res.interacted = true;
    res.propPos = terminalPos;
    res.doorsToggled = door_toggle_locks(world, doors, reg, layer);
    res.doorsLocked = (doors.shut > 0);
    return res;
}

} // namespace giga::game

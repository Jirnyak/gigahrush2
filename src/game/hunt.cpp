#include "core/rng.h"
#include "game/hunt.h"

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/combat.h"          // Dead
#include "game/embody.h"          // NpcRef
#include "game/faction_relations.h"
#include "world/types.h"

namespace giga::game {

namespace {


} // namespace

bool mob_hunts_npcs(std::uint32_t mobId, std::uint64_t tick) {
    // Per-identity phase, so the cohort turns over continuously. Without it every
    // licence on the floor would expire on the same tick and a monster whose window
    // opened late would be handed a fight it cannot finish.
    const std::uint64_t phase =
        static_cast<std::uint64_t>(hash_u32(mobId ^ 0x2f6a1c7bu)) % kHuntEpochTicks;
    const std::uint32_t epoch =
        static_cast<std::uint32_t>((tick + phase) / kHuntEpochTicks);
    // The epoch is mixed BEFORE it is combined, for the reason pack_target_node
    // documents: raw epochs are 0,1,2... and xoring a small counter into an id makes
    // neighbouring epochs and neighbouring ids collide in blocks.
    const std::uint32_t h = hash_u32((mobId * 0x9e3779b9u) ^ hash_u32(epoch));
    return h % kHuntShare == 0u;
}

Prey nearest_prey(const Registry& reg, const NpcPool& pool, LayerId layer,
                  const vec3& from, float radius) {
    Prey best;
    float bestD2 = radius * radius;

    // Monsters carry no NpcRef ([npcs.md]: they have no macro existence at all), so
    // this view cannot reach one and there is no monster-on-monster exclusion to
    // write — the same structural argument rumour.cpp's nearest_speaker makes.
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // The camera holder belongs to the caller's own, longer-ranged target rule.
        if (reg.all_of<CameraTag>(e)) continue;
        // A body already scheduled to die is not worth a hunting window: apply_damage
        // refuses a Dead target anyway, so taking it would mean a monster standing
        // over a corpse doing nothing until its licence expired.
        if (reg.all_of<Dead>(e)) continue;

        const NpcId id = reg.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        if (!mob_hostile_to(pool, id)) continue;   // Cultists, by body and not by row

        const float dx = wrap_delta_f(from.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(from.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(from.z, tr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best.e = e;
        best.pos = tr.pos;
    }
    return best;
}

} // namespace giga::game

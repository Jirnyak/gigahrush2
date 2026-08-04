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

void build_spatial_hash(SpatialHash& hash, const Registry& reg, const NpcPool& pool, LayerId layer, std::uint64_t tick) {
    hash.tick = tick;
    hash.layer = layer;
    if (hash.heads.empty()) {
        hash.heads.assign(kMacroCells, entt::null);
    } else {
        for (std::uint32_t c : hash.active_cells) {
            hash.heads[c] = entt::null;
        }
    }
    hash.active_cells.clear();
    hash.nodes.clear();

    for (auto e : reg.view<const NpcRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;
        if (reg.all_of<Dead>(e)) continue;

        const NpcId id = reg.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        if (!mob_hostile_to(pool, id)) continue;

        int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        int cz = wrap_macro(static_cast<int>(tr.pos.z / kCellSize));

        std::uint32_t cellIdx = static_cast<std::uint32_t>(macro_index(cx, cy, cz));
        if (hash.heads[cellIdx] == entt::null) {
            hash.active_cells.push_back(cellIdx);
        }

        std::uint32_t nodeIdx = static_cast<std::uint32_t>(hash.nodes.size());
        hash.nodes.push_back({e, tr.pos, hash.heads[cellIdx]});
        hash.heads[cellIdx] = nodeIdx;
    }
}

Prey nearest_prey(const SpatialHash& hash, const vec3& from, float radius) {
    Prey best;
    float bestD2 = radius * radius;

    int rCells = static_cast<int>(std::ceil(radius / kCellSize));
    int cx0 = static_cast<int>(from.x / kCellSize);
    int cy0 = static_cast<int>(from.y / kCellSize);
    int cz0 = static_cast<int>(from.z / kCellSize);

    for (int dz = -rCells; dz <= rCells; ++dz) {
        for (int dy = -rCells; dy <= rCells; ++dy) {
            for (int dx = -rCells; dx <= rCells; ++dx) {
                int cx = wrap_macro(cx0 + dx);
                int cy = wrap_macro(cy0 + dy);
                int cz = wrap_macro(cz0 + dz);

                std::uint32_t cellIdx = static_cast<std::uint32_t>(macro_index(cx, cy, cz));
                std::uint32_t nodeIdx = hash.heads[cellIdx];
                
                while (nodeIdx != entt::null) {
                    const auto& node = hash.nodes[nodeIdx];
                    
                    const float dpx = wrap_delta_f(from.x, node.pos.x, kWorldExtent);
                    const float dpy = wrap_delta_f(from.y, node.pos.y, kWorldExtent);
                    const float dpz = wrap_delta_f(from.z, node.pos.z, kWorldExtent);
                    const float d2 = dpx * dpx + dpy * dpy + dpz * dpz;
                    
                    if (d2 < bestD2) {
                        bestD2 = d2;
                        best.e = node.e;
                        best.pos = node.pos;
                    }
                    nodeIdx = node.next;
                }
            }
        }
    }
    return best;
}

} // namespace giga::game

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
        hash.heads.assign(kHuntCells, entt::null);
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

        int cx = static_cast<int>(tr.pos.x / kHuntCellSize) & (kHuntGridDim - 1);
        int cy = static_cast<int>(tr.pos.y / kHuntCellSize) & (kHuntGridDim - 1);
        int cz = static_cast<int>(tr.pos.z / kHuntCellSize) & (kHuntGridDim - 1);

        std::uint32_t cellIdx = static_cast<std::uint32_t>(cx + cy * kHuntGridDim + cz * kHuntGridDim * kHuntGridDim);
        if (hash.heads[cellIdx] == entt::null) {
            hash.active_cells.push_back(cellIdx);
        }

        std::uint32_t nodeIdx = static_cast<std::uint32_t>(hash.nodes.size());
        hash.nodes.push_back({e, tr.pos, hash.heads[cellIdx]});
        hash.heads[cellIdx] = nodeIdx;
    }
}

Prey nearest_prey(const SpatialHash& hash, const vec3& from, float radius) {
    int cx = static_cast<int>(from.x / kHuntCellSize) & (kHuntGridDim - 1);
    int cy = static_cast<int>(from.y / kHuntCellSize) & (kHuntGridDim - 1);
    int cz = static_cast<int>(from.z / kHuntCellSize) & (kHuntGridDim - 1);
    int range = static_cast<int>(radius / kHuntCellSize) + 1;

    Prey closest{entt::null, {0,0,0}};
    float minDist2 = radius * radius;

    for (int dz = -range; dz <= range; ++dz) {
        for (int dy = -range; dy <= range; ++dy) {
            for (int dx = -range; dx <= range; ++dx) {
                int nx = (cx + dx) & (kHuntGridDim - 1);
                int ny = (cy + dy) & (kHuntGridDim - 1);
                int nz = (cz + dz) & (kHuntGridDim - 1);
                
                std::uint32_t cellIdx = static_cast<std::uint32_t>(nx + ny * kHuntGridDim + nz * kHuntGridDim * kHuntGridDim);
                std::uint32_t nodeIdx = hash.heads[cellIdx];
                
                while (nodeIdx != entt::null && nodeIdx < hash.nodes.size()) {
                    const auto& node = hash.nodes[nodeIdx];
                    
                    const float dpx = wrap_delta_f(from.x, node.pos.x, kWorldExtent);
                    const float dpy = wrap_delta_f(from.y, node.pos.y, kWorldExtent);
                    const float dpz = wrap_delta_f(from.z, node.pos.z, kWorldExtent);
                    const float d2 = dpx * dpx + dpy * dpy + dpz * dpz;
                    
                    if (d2 < minDist2) {
                        minDist2 = d2;
                        closest.e = node.e;
                        closest.pos = node.pos;
                    }
                    nodeIdx = node.next;
                }
            }
        }
    }
    return closest;
}

} // namespace giga::game

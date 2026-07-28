#include "game/container.h"

#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"   // NpcRef
#include "game/npc_pool.h"
#include "world/lattice.h"
#include "world/materials.h"
#include "world/types.h"

namespace giga::game {

namespace {

std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// Grey-green crate, deliberately unlike the pickup colour and unlike the monster red
// axis. An unopened container must read as "go there" at a distance.
constexpr vec3 kShutColour{0.42f, 0.46f, 0.38f};
// Emptied: much darker, same hue. Same silhouette, obviously spent.
constexpr vec3 kOpenColour{0.16f, 0.18f, 0.15f};

// Which kinds a floor geometry may produce, and their weights. Weapon crates are
// gated to the industrial half because a residential warren full of military crates
// reads as a shooting range rather than as a home.
struct KindWeight { ContainerKind kind; std::uint8_t w; };

const KindWeight kResidential[] = {
    {ContainerKind::PublicBox, 30}, {ContainerKind::RoomStash, 55},
    {ContainerKind::Safe, 15},
};
const KindWeight kIndustrial[] = {
    {ContainerKind::PublicBox, 20}, {ContainerKind::RoomStash, 40},
    {ContainerKind::Safe, 15}, {ContainerKind::WeaponCrate, 25},
};

ContainerKind pick_kind(FloorKind fk, std::uint32_t h) {
    const KindWeight* tab;
    std::size_t n;
    switch (fk) {
        case FloorKind::Industrial:
        case FloorKind::Derelict:
            tab = kIndustrial;
            n = sizeof(kIndustrial) / sizeof(kIndustrial[0]);
            break;
        default:
            tab = kResidential;
            n = sizeof(kResidential) / sizeof(kResidential[0]);
            break;
    }
    std::uint32_t total = 0;
    for (std::size_t i = 0; i < n; ++i) total += tab[i].w;
    std::uint32_t r = h % total;
    for (std::size_t i = 0; i < n; ++i) {
        if (r < tab[i].w) return tab[i].kind;
        r -= tab[i].w;
    }
    return ContainerKind::RoomStash;
}

// A cell a body can stand in, with something solid under it. The second half matters:
// Derelict drops 12% of its slab cells, and a container spawned over a hole falls out
// of the world.
bool standable(const MacroGrid& g, int x, int y, int z) {
    if (g.cell(x, y, z) != kCellAir) return false;
    if (z <= 0) return false;
    return g.cell(x, y, z - 1) != kCellAir;
}

} // namespace

std::uint32_t container_budget(FloorKind kind) {
    // Rooms per axis squared, thinned. A Residential floor at stride 8 has 256 rooms
    // and gets ~40 containers; an Industrial pillar plate at stride 32 has 16 and gets
    // ~6. Scaling on rooms rather than on depth is deliberate: a deeper floor should be
    // RICHER, not fuller, and conflating the two turns the bottom of the building into
    // a supermarket.
    const int stride = floor_room_stride(kind);
    const int rooms = (kMacroDim / stride) * (kMacroDim / stride);
    const std::uint32_t n = static_cast<std::uint32_t>(rooms) / 6u;
    return n < 4u ? 4u : n;
}

Container roll_container(ContainerKind kind, int floorZ, std::uint32_t seed) {
    Container c;
    c.kind = static_cast<std::uint8_t>(kind);

    // THE rule: the floor's band sets the ceiling, the kind takes a fixed share of it.
    // A public box on floor -50 is still a public box.
    const std::int32_t bandCap = kLootValueCap[economy_band(floorZ)];
    const std::int32_t cap =
        bandCap * kContainerCapPct[static_cast<std::size_t>(kind)] / 100;

    // Candidate items: anything that can appear on this floor at all, then filtered to
    // what fits under this container's share. Weighted by the same depth-gated spawn
    // weight the mob-drop path uses, so one item table drives both.
    std::vector<ItemId> pool;
    std::vector<std::uint32_t> cum;
    std::uint32_t total = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        const std::uint32_t w = item_weight_on_floor(id, floorZ, 0);
        if (w == 0) continue;
        const ItemDef& d = item_def(id);
        if (d.value > cap) continue;
        // A weapon crate carries weapons and ammo and nothing else; that is what makes
        // it worth crossing a floor for rather than being a differently-coloured stash.
        if (kind == ContainerKind::WeaponCrate) {
            const auto cat = static_cast<ItemCategory>(d.category);
            if (cat != ItemCategory::Weapon && cat != ItemCategory::Ammo) continue;
        }
        // A public box is survival support, per the reference: consumables only. This
        // is why it stays useful at depth without ever being a jackpot.
        if (kind == ContainerKind::PublicBox) {
            const auto cat = static_cast<ItemCategory>(d.category);
            if (cat != ItemCategory::Food && cat != ItemCategory::Drink &&
                cat != ItemCategory::Medicine && cat != ItemCategory::Ammo)
                continue;
        }
        total += w;
        pool.push_back(id);
        cum.push_back(total);
    }
    if (total == 0) return c;   // nothing legal here; an empty container is honest

    // How many slots this kind fills. A safe holds fewer, better things.
    const std::uint32_t h0 = mix(seed);
    int fill;
    switch (kind) {
        case ContainerKind::PublicBox:   fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::Safe:        fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::WeaponCrate: fill = 2; break;
        default:                         fill = 1 + static_cast<int>(h0 % 3u); break;
    }
    if (fill > kContainerSlots) fill = kContainerSlots;

    for (int i = 0; i < fill; ++i) {
        const std::uint32_t h = mix(seed ^ (static_cast<std::uint32_t>(i + 1) *
                                            0x9e3779b9u));
        const std::uint32_t r = h % total;
        std::size_t lo = 0, hi = cum.size() - 1;
        while (lo < hi) {
            const std::size_t mid = (lo + hi) / 2;
            if (cum[mid] <= r) lo = mid + 1; else hi = mid;
        }
        const ItemId id = pool[lo];
        const std::uint8_t stack = item_def(id).stackMax;
        // Consumables and ammo come in useful numbers; anything else comes as one.
        std::uint32_t n = 1;
        if (stack > 1) n = 1u + ((h >> 8) % (stack < 12u ? stack : 12u));
        c.item[i] = id;
        c.count[i] = static_cast<std::uint8_t>(n);
    }
    return c;
}

std::uint32_t spawn_floor_containers(Registry& reg, const World& world,
                                     int floorNumber, FloorKind kind, LayerId layer,
                                     std::uint32_t seed, std::uint32_t cap) {
    const MacroGrid& g = world.grid();
    const int stride = floor_room_stride(kind);
    const int perAxis = kMacroDim / stride;
    std::uint32_t want = container_budget(kind);
    if (cap && want > cap) want = cap;

    std::uint32_t made = 0;
    for (std::uint32_t i = 0; i < want; ++i) {
        const std::uint32_t h = mix(seed ^ (i * 0x85ebca6bu));
        // A room, then a cell inside it. Room interiors are offset off the lattice
        // lines, which is what keeps containers out of the walls themselves.
        const int rx = static_cast<int>((h % static_cast<std::uint32_t>(perAxis)));
        const int ry = static_cast<int>(((h >> 8) %
                                        static_cast<std::uint32_t>(perAxis)));
        const int ox = 2 + static_cast<int>((h >> 16) %
                                            static_cast<std::uint32_t>(
                                                stride > 4 ? stride - 3 : 1));
        const int oy = 2 + static_cast<int>((h >> 24) %
                                            static_cast<std::uint32_t>(
                                                stride > 4 ? stride - 3 : 1));
        const int cx = wrap_macro(rx * stride + ox);
        const int cy = wrap_macro(ry * stride + oy);

        // Ground storey, and only where a body could actually reach it.
        int cz = 1;
        if (!standable(g, cx, cy, cz)) continue;
        // Never on the extraction pad: the bank is a landmark, and a crate sitting on
        // it makes the one cell the player needs to find harder to read.
        if (g.cell(cx, cy, cz - 1) == kMatExtract) continue;

        Entity e = reg.create();
        Transform tr;
        tr.pos = vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
                      (static_cast<float>(cy) + 0.5f) * kCellSize,
                      static_cast<float>(cz) * kCellSize + kContainerHalf.z};
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<AABB>(e, AABB{kContainerHalf});
        reg.emplace<Renderable>(e, Renderable{kShutColour});
        reg.emplace<Container>(
            e, roll_container(pick_kind(kind, mix(h ^ 0x5bf03635u)), floorNumber,
                              mix(h ^ 0xc2b2ae35u)));
        ++made;
    }
    return made;
}

std::int32_t loot_containers_step(Registry& reg, NpcPool& pool, LayerId layer) {
    // The looter.
    Entity who = entt::null;
    vec3 pos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        who = e;
        pos = t.pos;
        break;
    }
    if (who == entt::null) return 0;
    const NpcRef* nr = reg.try_get<NpcRef>(who);
    if (!nr || !pool.valid(nr->id)) return 0;
    Inventory& inv = pool.inventory(nr->id);

    std::int32_t took = 0;
    // Two-phase is not needed here — nothing is destroyed and no component storage is
    // created — but the container IS mutated through the view, so the view must be over
    // a non-const Container and nothing may be emplaced inside the loop.
    for (auto e : reg.view<Container, const Transform>()) {
        Container& c = reg.get<Container>(e);
        if (c.opened) continue;
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const float dx = wrap_delta_f(pos.x, t.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(pos.y, t.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(pos.z, t.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz > kContainerReach * kContainerReach) continue;

        bool anyMoved = false;
        for (int i = 0; i < kContainerSlots; ++i) {
            if (!item_valid(c.item[i]) || c.count[i] == 0) continue;
            const int slot = inv.first_free();
            if (slot < 0) break;   // full: the rest stays in the box, not deleted
            inv.slots[slot] = ItemSlot{c.item[i], c.count[i]};
            took += item_def(c.item[i]).value * c.count[i];
            c.item[i] = kInvalidItem;
            c.count[i] = 0;
            anyMoved = true;
        }
        // Opened only when it is actually empty. A container left half-full by a full
        // inventory must stay lootable, or the player is punished for carrying things.
        bool empty = true;
        for (int i = 0; i < kContainerSlots; ++i)
            if (item_valid(c.item[i]) && c.count[i]) empty = false;
        if (empty) {
            c.opened = true;
            // Darkened in place rather than destroyed: a container that vanishes tells
            // the player nothing about where they have already been, and remembering
            // that yourself across 256 rooms is not reasonable.
            if (Renderable* r = reg.try_get<Renderable>(e)) r->color = kOpenColour;
        }
        (void)anyMoved;
    }
    return took;
}

} // namespace giga::game

#include "game/container.h"

#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"   // NpcRef
#include "game/floor_gen.h" // floor_room_mask — the crate's contents follow the ROOM
#include "game/npc_pool.h"
#include "sim/fluid.h"     // fluid_at, kFluidMinFlow — a crate does not float
#include "world/lattice.h"
#include "world/materials.h"
#include "world/types.h"
#include "world/world.h"

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

// Candidates for one container: every item that can appear on this floor, in this
// ROOM, under this container kind's share of the band cap. Returns the cumulative
// weight total; `pool`/`cum` are parallel and must come in empty.
//
// Split out of roll_container because it is now called TWICE — see the fallback there.
std::uint32_t build_pool(ContainerKind kind, int floorZ, std::int32_t cap,
                         std::uint16_t roomMask, std::vector<ItemId>& pool,
                         std::vector<std::uint32_t>& cum) {
    std::uint32_t total = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        const std::uint32_t w = item_weight_on_floor(id, floorZ, roomMask);
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
    return total;
}

// Roll one container's contents against a specific ROOM.
//
// **The fallback is the whole difficulty of this function, and it is measured.**
// `item_weight_on_floor` returns 0 when the room mask does not match, and the
// container kind then filters by CATEGORY on top, so the two masks intersect and the
// intersection is empty far more often than either alone. Candidate counts, over
// data/items.csv with the real depth decay and the real per-kind value share:
//
//              PublicBox  RoomStash  Safe  WeaponCrate      (floor 0 / floor -26)
//   unmasked      13/46     112/344  234/355     6/64
//   Corridor       0/0         3/11    8/11      0/1
//   Bathroom       3/8        18/24   23/24      0/0
//   Living         0/1        24/38   34/38      1/3
//   Hq             0/7         9/98   47/101     0/31
//
// A PublicBox in a CORRIDOR has ZERO legal items at every depth — and container.h
// documents a public box as exactly a corridor-and-lobby fixture, so the strict filter
// would empty the one placement the kind exists for. So: try the room, and fall back to
// the floor's whole table when the room has nothing to offer THIS kind. The taxonomy
// shapes what a room holds; it never gets to make a room hold nothing.
Container roll_in_room(ContainerKind kind, int floorZ, std::uint32_t seed,
                       std::uint16_t roomMask) {
    Container c;
    c.kind = static_cast<std::uint8_t>(kind);

    // THE rule: the floor's band sets the ceiling, the kind takes a fixed share of it.
    // A public box on floor -50 is still a public box.
    const std::int32_t bandCap = kLootValueCap[economy_band(floorZ)];
    const std::int32_t cap =
        bandCap * kContainerCapPct[static_cast<std::size_t>(kind)] / 100;

    // Candidate items, weighted by the same depth-gated spawn weight the mob-drop path
    // uses, so one item table drives both.
    std::vector<ItemId> pool;
    std::vector<std::uint32_t> cum;
    std::uint32_t total = build_pool(kind, floorZ, cap, roomMask, pool, cum);
    if (total == 0 && roomMask != 0) {
        pool.clear();
        cum.clear();
        total = build_pool(kind, floorZ, cap, 0, pool, cum);
    }
    if (total == 0) return c;   // nothing legal here; an empty container is honest

    // How many slots this kind fills. A safe holds fewer, better things.
    const std::uint32_t h0 = mix(seed);
    int fill;
    switch (kind) {
        case ContainerKind::PublicBox:   fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::Safe:        fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::WeaponCrate: fill = 3; break;   // ammo + two weapons
        default:                         fill = 1 + static_cast<int>(h0 % 3u); break;
    }
    if (fill > kContainerSlots) fill = kContainerSlots;

    // **A weapon crate reserves its first slot for AMMO, chosen directly rather than
    // rolled.** The weighted roll cannot produce ammo at all: every one of the 17 AMMO
    // rows in items.csv has `spawn_w_milli == 0`, so `item_weight_on_floor` returns 0 and
    // the candidate loop above skips all of them. The crate promised "weapons and ammo"
    // and could only ever deliver weapons — a gun in a box with nothing to load it.
    //
    // Picking the ammo for whatever weapon the crate also holds would be better, and is
    // not possible here: the weapon is rolled below, and a crate whose contents depend on
    // each other stops being a pure function of its seed. So the ammo is the commonest
    // kind, which fits the commonest guns, and the mob-drop path already bundles
    // matched ammo with a dropped weapon ([loot.h drop_weapon_ammo]).
    //
    // Deliberately NOT room-filtered. All 17 ammo rows carry an empty `spawn_rooms`
    // column (they never spawn randomly, so no room was ever authored for them), so a
    // room mask here would refuse every one of them and put the "gun with nothing to
    // load it" bug straight back.
    int firstSlot = 0;
    if (kind == ContainerKind::WeaponCrate) {
        // The CHEAPEST ammo that still fits this crate's value share, not merely the
        // first one found. The share is the same ceiling every other slot obeys
        // ([container.h]), and a forced slot that ignored it would make a weapon crate on
        // floor 0 richer than its band allows — which a test caught immediately, 123
        // times over. A crate whose band cannot afford any ammunition simply gets none.
        ItemId ammo = kInvalidItem;
        std::int32_t cheapest = 0;
        for (ItemId id = 1; id <= kItemCount; ++id) {
            const ItemDef& d = item_def(id);
            if (static_cast<ItemCategory>(d.category) != ItemCategory::Ammo) continue;
            if (d.value <= 0 || d.value > cap) continue;
            if (d.stackMax < 8) continue;              // a useful quantity, not one round
            if (ammo == kInvalidItem || d.value < cheapest) {
                ammo = id;
                cheapest = d.value;
            }
        }
        if (ammo != kInvalidItem) {
            const std::uint8_t st = item_def(ammo).stackMax;
            const std::uint32_t n = 8u + (mix(seed ^ 0xA11A0u) % 16u);
            c.item[0] = ammo;
            c.count[0] = static_cast<std::uint8_t>(n > st ? st : n);
            firstSlot = 1;
        }
    }

    for (int i = firstSlot; i < fill; ++i) {
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

} // namespace

std::uint32_t container_budget(FloorKind kind) {
    // Scaled on the room count, thinned — and then FLOORED, which is the correction
    // that matters.
    //
    // Rooms alone gave a Residential warren (stride 8, 256 rooms) about 40 crates and
    // an Industrial pillar plate (stride 32, 16 rooms) about 6 — and after
    // standability filtering that landed at **3 crates on an entire 128x128 floor**,
    // measured in the running game. Three is not an economy; it is a rounding error
    // the player will never walk into. An open-plan floor has few ROOMS and just as
    // much FLOOR, so the room count is the wrong denominator there.
    //
    // Scaling on rooms rather than on depth stays deliberate: a deeper floor should be
    // RICHER, not fuller, and conflating the two turns the bottom of the building into
    // a supermarket. The floor is a floor, not a depth bonus.
    const int stride = floor_room_stride(kind);
    const int rooms = (kMacroDim / stride) * (kMacroDim / stride);
    std::uint32_t n = static_cast<std::uint32_t>(rooms) / 6u;
    if (n < kContainerFloorMin) n = kContainerFloorMin;
    return n;
}

Container roll_container(ContainerKind kind, int floorZ, std::uint32_t seed) {
    // Room-agnostic entry point, kept exactly as it was for the callers that have no
    // room to name: the tests that pin the value cap, and any future consumer that
    // rolls a crate outside the floor lattice. Mask 0 means "the whole floor table",
    // which is the behaviour every call site had before the taxonomy existed.
    return roll_in_room(kind, floorZ, seed, 0);
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
        // Never in standing water. Today's basins are half-solid cells, so `standable`
        // above already refuses them on TYPE — this states the rule rather than the
        // accident, and it is the half that survives a floor kind seeding an open pool,
        // where the cell would be air over a solid slab and pass every test above. A
        // crate in a kerbed sump is loot the player can see across the room and never
        // reach. One array index: the field is resolved by name once per call.
        if (fluid_at(world, cx, cy, cz) >= kFluidMinFlow) continue;

        // What ROOM this is. The one caller that knows both the geometry kind and the
        // floor label, which is exactly the key floor_room_mask is defined on — so the
        // mob spawner reading the same room gets the same answer without either of them
        // storing it.
        const std::uint16_t roomMask = floor_room_mask(kind, floorNumber, rx, ry);

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
            e, roll_in_room(pick_kind(kind, mix(h ^ 0x5bf03635u)), floorNumber,
                            mix(h ^ 0xc2b2ae35u), roomMask));
        ++made;
    }
    return made;
}

std::int32_t loot_containers_step(Registry& reg, NpcPool& pool, LayerId layer,
                                  NoiseField* noise) {
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
        // The lid. Gated on `anyMoved`, so the pass that empties a crate makes one
        // noise and the ticks that merely find it already empty make none — without
        // that, standing next to an opened box would publish 120 records a second and
        // the whole 64-slot field would be one crate. [noise.h]
        if (noise && anyMoved)
            noise_publish(*noise, layer, t.pos, container_open_noise(),
                          static_cast<std::uint32_t>(entt::to_integral(who)));
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
    }
    return took;
}

} // namespace giga::game

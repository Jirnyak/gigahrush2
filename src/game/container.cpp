#include "game/container.h"

#include <cstdio>
#include <vector>

#include "core/wrap.h"
#include "core/rng.h"
#include "ecs/components.h"
#include "game/embody.h"   // NpcRef
#include "game/floor_gen.h" // floor_cell/floor_standable — гравифрейм размещения
#include "game/npc_pool.h"
#include "game/room_supply.h" // живой хук: взятое покидает запас комнаты
#include "game/prop_system.h"
#include "world/anchor.h"
#include "world/surface.h"
#include "world/medium.h"  // liquid_frac_at — ящик не ставится в воду
#include "world/materials.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

// Цвет неоткрытого ящика переехал в data/props.csv строкой supply_crate
// (B1 эпика one-container: ящик — проп); здесь остался только цвет
// ОПУСТОШЁННОГО — это состояние рантайма, а не строка ассета.
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
// Candidates for one container: every item that can appear on this floor under
// this container kind's share of the band cap. Returns the cumulative weight
// total; `pool`/`cum` are parallel and must come in empty.
std::uint32_t build_pool(ContainerKind kind, int floorZ, std::int32_t cap,
                         std::vector<ItemId>& pool,
                         std::vector<std::uint32_t>& cum) {
    std::uint32_t total = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        const std::uint32_t w = item_weight_on_floor(id, floorZ);
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

// CASH — the LAST slot, and only for the civilian kinds. Money is an ordinary
// item ([item_table.h] kItemRuble), so a box carries it in an ordinary slot:
// that is what lets the search screen and the coming barter policy move it
// with the same inventory_give as everything else, no wallet special case.
//
// The amounts are the reference's own economics rows ([container.h] header):
//   * PublicBox — 0..120 rub at EVERY depth. "Survival support only": the
//     reference keeps public containers low at every tier on purpose, so this
//     one range is flat rather than band-scaled.
//   * RoomStash / Safe — 0..their share of the band cap, the same `cap` the
//     item slots obey, so "deep is richer" prices the cash exactly as it
//     prices the goods. Clamped to one honest u16 stack.
//   * WeaponCrate — none: "ammo and access, not free early military kit".
// The fill loop never reaches slot 3 (fill caps at 3), so the slot is free by
// construction and cash never evicts a rolled item. Called on BOTH exits of
// roll_in_room, because a box whose room offers no legal ITEM (the measured
// corridor PublicBox case) still carries its cash.
void roll_cash(Container& c, ContainerKind kind, std::int32_t cap,
               std::uint32_t seed) {
    if (kind == ContainerKind::WeaponCrate) return;
    const std::uint32_t hc = giga::hash_u32(seed ^ 0xCA5B0117u);
    std::int32_t cash = static_cast<std::int32_t>(
        hc % static_cast<std::uint32_t>(cap + 1));
    if (kind == ContainerKind::PublicBox)
        cash = static_cast<std::int32_t>(hc % 121u);
    if (cash > 65535) cash = 65535;
    if (cash > 0) {
        c.inv.slots[kContainerRollSlots - 1] =
            ItemSlot{kItemRuble, static_cast<std::uint16_t>(cash), 255};
    }
}

// Roll one container's contents off the floor's table (комнатная маска умерла,
// rooms-object F — тематику места дадут модуль и глаголы).
Container roll_in_room(ContainerKind kind, int floorZ, std::uint32_t seed) {
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
    std::uint32_t total = build_pool(kind, floorZ, cap, pool, cum);
    if (total == 0) {           // no legal item here; the cash still rides
        roll_cash(c, kind, cap, seed);
        return c;
    }

    // How many slots this kind fills. A safe holds fewer, better things.
    const std::uint32_t h0 = giga::hash_u32(seed);
    int fill;
    switch (kind) {
        case ContainerKind::PublicBox:   fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::Safe:        fill = 1 + static_cast<int>(h0 % 2u); break;
        case ContainerKind::WeaponCrate: fill = 3; break;   // ammo + two weapons
        default:                         fill = 1 + static_cast<int>(h0 % 3u); break;
    }
    if (fill > kContainerRollSlots) fill = kContainerRollSlots;

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
            const std::uint16_t st = item_def(ammo).stackMax;
            const std::uint32_t n = 8u + (giga::hash_u32(seed ^ 0xA11A0u) % 16u);
            c.inv.slots[0] =
                ItemSlot{ammo, static_cast<std::uint16_t>(n > st ? st : n), 255};
            firstSlot = 1;
        }
    }

    for (int i = firstSlot; i < fill; ++i) {
        const std::uint32_t h = giga::hash_u32(seed ^ (static_cast<std::uint32_t>(i + 1) *
                                                 0x9e3779b9u));
        const std::uint32_t r = h % total;
        std::size_t lo = 0, hi = cum.size() - 1;
        while (lo < hi) {
            const std::size_t mid = (lo + hi) / 2;
            if (cum[mid] <= r) lo = mid + 1; else hi = mid;
        }
        const ItemId id = pool[lo];
        const std::uint16_t stack = item_def(id).stackMax;
        // Consumables and ammo come in useful numbers; anything else comes as one.
        std::uint32_t n = 1;
        if (stack > 1) n = 1u + ((h >> 8) % (stack < 12u ? stack : 12u));
        c.inv.slots[i] = ItemSlot{id, static_cast<std::uint16_t>(n), 255};
    }

    roll_cash(c, kind, cap, seed);
    return c;
}

} // namespace

std::uint32_t container_budget(std::size_t roomCount) {
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
    //
    // Знаменатель — НАСТОЯЩИЕ комнаты модуля (rooms-object F): ~ящик на 16
    // комнат; вызывающий и так капит бюджет (main: 64). Пол kContainerFloorMin
    // держит редкокомнатные этажи (blame: 256 лобби) экономикой, не ошибкой
    // округления.
    std::uint32_t n = static_cast<std::uint32_t>(roomCount / 16u);
    if (n < kContainerFloorMin) n = kContainerFloorMin;
    return n;
}

Container roll_container(ContainerKind kind, int floorZ, std::uint32_t seed) {
    // Room-agnostic entry point, kept exactly as it was for the callers that have no
    // room to name: the tests that pin the value cap, and any future consumer that
    // rolls a crate outside the floor lattice. Mask 0 means "the whole floor table",
    // which is the behaviour every call site had before the taxonomy existed.
    return roll_in_room(kind, floorZ, seed);
}

std::uint32_t spawn_floor_containers(Registry& reg, const World& world,
                                     int floorNumber, FloorKind kind, LayerId layer,
                                     std::uint32_t seed, std::uint32_t cap) {
    const MacroGrid& g = world.grid();
    (void)kind;
    // НАСТОЯЩИЕ комнаты этажа (rooms-object F): ящик селится в объявленной
    // модулем комнате — случайная комната, случайная клетка её бокса; зона
    // несёт и ярус, так что «любой storey» получается из самих комнат.
    const FloorRooms* fr = rooms_in_ctx(reg);
    if (fr == nullptr || fr->list.empty()) {
        std::printf("[crates] floor %d: no declared rooms — spawn skipped\n",
                    floorNumber);
        return 0;
    }
    std::uint32_t want = container_budget(fr->list.size());
    if (cap && want > cap) want = cap;

    std::uint32_t made = 0;
    for (std::uint32_t i = 0; i < want; ++i) {
        const std::uint32_t h = giga::hash_u32(seed ^ (i * 0x85ebca6bu));
        const Room& rm =
            fr->list[h % static_cast<std::uint32_t>(fr->list.size())];
        const RoomBox& bx =
            fr->boxes[rm.boxFirst +
                      giga::hash_u32(h ^ 0x51ED270Bu) % rm.boxCount];
        int cx = 0, cy = 0, cz = 0;
        bool spotFound = false;
        for (std::uint32_t t = 0; t < 6 && !spotFound; ++t) {
            const std::uint32_t hh = giga::hash_u32(h ^ ((t + 1u) * 0x9E3779B9u));
            cx = wrap_macro(bx.x + static_cast<int>(
                                       (hh >> 7) %
                                       static_cast<std::uint32_t>(bx.sx)));
            cy = wrap_macro(bx.y + static_cast<int>(
                                       (hh >> 19) %
                                       static_cast<std::uint32_t>(bx.sy)));
            cz = wrap_macro(bx.z + static_cast<int>(
                                       hh % static_cast<std::uint32_t>(bx.sz)));
            spotFound = floor_standable(world, cx, cy, cz);
        }
        if (!spotFound) continue;
        // Never on the extraction pad: the bank is a landmark, and a crate sitting on
        // it makes the one cell the player needs to find harder to read.
        const CellStep dn = regime_down(world.gravity().regime);
        if (g.cell(cx + dn.x, cy + dn.y, cz + dn.z) == kMatExtract) continue;
        // Never in standing water. Today's basins are half-solid cells, so `standable`
        // above already refuses them on TYPE — this states the rule rather than the
        // accident, and it is the half that survives a floor kind seeding an open pool,
        // where the cell would be air over a solid slab and pass every test above. A
        // crate in a kerbed sump is loot the player can see across the room and never
        // reach. One array index: the field is resolved by name once per call.
        if ((medium_level_at(world,
                             macro_index(wrap_macro(cx), wrap_macro(cy),
                                         wrap_macro(cz))) &
             0xFFFFu) >= kWetQuanta)
            continue;

        // ЯЩИК — ПРОП (S14.1, B1, решение владельца 2026-08-21): спавн
        // проп-системой (строка props.csv supply_crate — скин/AABB/масса из
        // данных) с ЧЕСТНЫМ якорем из примитива поверхностей по опоре из
        // гравифрейма. Прежний ручной emplace-блок нёс якорь В ВОЗДУШНОЙ
        // клетке мимо гейта спавна — мёртвый с рождения (аудит якорного
        // эпика); теперь ящик живёт и умирает по колонке своей опоры, как
        // любой проп. Контейнер остаётся ортогональным компонентом (S14.1).
        const int sx2 = wrap_macro(cx + dn.x);
        const int sy2 = wrap_macro(cy + dn.y);
        const int sz2 = wrap_macro(cz + dn.z);
        const int upAxis = dn.z != 0 ? 2 : (dn.y != 0 ? 1 : 0);
        const std::uint8_t face =
            anchor_face_pack(upAxis, -(dn.x + dn.y + dn.z));
        const SurfaceFace sf = surface_face_at(g, sx2, sy2, sz2, face);
        if (sf.columns == 0) continue; // опора без экспонированной грани
        SubVoxelAnchor anchor;
        anchor.cx = static_cast<std::uint8_t>(sf.cx);
        anchor.cy = static_cast<std::uint8_t>(sf.cy);
        anchor.cz = static_cast<std::uint8_t>(sf.cz);
        anchor.subX = upAxis == 0 ? sf.layer : sf.su;
        anchor.subY = upAxis == 1 ? sf.layer : (upAxis == 0 ? sf.su : sf.sv);
        anchor.subZ = upAxis == 2 ? sf.layer : sf.sv;
        anchor.face = face;
        const vec3 pos{(static_cast<float>(cx) + 0.5f) * kCellSize,
                       (static_cast<float>(cy) + 0.5f) * kCellSize,
                       static_cast<float>(cz) * kCellSize + kContainerHalf.z};
        Entity e = spawn_prop_from_id(reg, world, pos, anchor,
                                      PropId::SupplyCrate, layer);
        if (e == entt::null) continue;
        // «Вид комнаты» мёртв (S12.2, rooms-object F): содержимое катится по
        // этажной таблице; тематику места дадут модуль и глаголы, не вид.
        reg.emplace<Container>(
            e, roll_in_room(pick_kind(kind, giga::hash_u32(h ^ 0x5bf03635u)), floorNumber,
                            giga::hash_u32(h ^ 0xc2b2ae35u)));
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
        for (int i = 0; i < kInvSlots; ++i) {
            ItemSlot& sl = c.inv.slots[i];
            if (!item_valid(sl.item) || sl.count == 0) continue;
            // THE transfer primitive ([item_table.h] inventory_give): stacks
            // top up before fresh slots are spent, the remainder stays in the
            // box, not deleted. Износ едет с предметом (ItemSlot::condition —
            // держатель теперь канонический, B3).
            const std::uint16_t unplaced =
                inventory_give(inv, sl.item, sl.count, sl.condition);
            const std::uint16_t moved =
                static_cast<std::uint16_t>(sl.count - unplaced);
            if (moved == 0) break;  // full: the rest stays in the box
            // Взятое покидает МЕСТО (S12.4/S12.5, живой хук supply): запас
            // комнаты падает, следующий голодный видит меньшее «есть».
            supply_item_at(reg, t.pos, sl.item, -static_cast<int>(moved));
            took += item_def(sl.item).value * moved;
            sl.count = unplaced;
            if (sl.count == 0) sl = ItemSlot{};
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
        for (int i = 0; i < kInvSlots; ++i)
            if (item_valid(c.inv.slots[i].item) && c.inv.slots[i].count)
                empty = false;
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

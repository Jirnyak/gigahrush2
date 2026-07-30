#include "game/door.h"

#include <cmath>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/floor_gen.h"   // Doorway, floor_doorways
#include "game/mob_spawn.h"   // MobRef
#include "game/mob_table.h"
#include "world/materials.h"
#include "world/world.h"

namespace giga::game {

namespace {

// Cell an agent's centre occupies. Same convention as wander.cpp's agent_cell:
// truncation, wrapped, because a body's Transform::pos is already normalized into
// [0, kWorldExtent) by physics_step.
void agent_cell(const vec3& pos, int& cx, int& cy, int& cz) {
    cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    cz = wrap_macro(static_cast<int>(pos.z / kCellSize));
}

// Does entity box (pos, half) overlap the door's leaf column? Toroidal on all
// three axes — physics wraps Z as well, so a door in the top storey is adjacent to
// a body standing on the bottom one.
bool body_in_leaf(const Door& d, const vec3& pos, const vec3& half) {
    const float ccx = (static_cast<float>(d.cx) + 0.5f) * kCellSize;
    const float ccy = (static_cast<float>(d.cy) + 0.5f) * kCellSize;
    const float ccz =
        (static_cast<float>(d.cz) + static_cast<float>(d.h) * 0.5f) * kCellSize;
    const float hz = static_cast<float>(d.h) * 0.5f * kCellSize;
    return std::fabs(wrap_delta_f(ccx, pos.x, kWorldExtent)) <
               kCellSize * 0.5f + half.x &&
           std::fabs(wrap_delta_f(ccy, pos.y, kWorldExtent)) <
               kCellSize * 0.5f + half.y &&
           std::fabs(wrap_delta_f(ccz, pos.z, kWorldExtent)) < hz + half.z;
}

// Is any body standing in this doorway? Read-only over the layer's transforms; a
// keypress-rate query, never a per-tick one.
bool leaf_occupied(const Door& d, const Registry& reg, LayerId layer) {
    for (auto e : reg.view<const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const vec3 half = reg.all_of<AABB>(e) ? reg.get<const AABB>(e).half
                                              : vec3{0.4f, 0.4f, 0.4f};
        if (body_in_leaf(d, tr.pos, half)) return true;
    }
    return false;
}

void fill_leaf(MacroGrid& g, const Door& d) {
    for (int z = 0; z < d.h; ++z)
        g.fill_cell(d.cx, d.cy, d.cz + z, kMatDoor);
}

void clear_leaf(MacroGrid& g, const Door& d) {
    for (int z = 0; z < d.h; ++z) g.clear_cell(d.cx, d.cy, d.cz + z);
}

} // namespace

std::uint32_t door_build(World& world, DoorSet& doors, int number,
                         const FloorSpec& spec, unsigned seed) {
    MacroGrid& g = world.grid();
    doors.doors.clear();
    doors.shut = 0;
    doors.broken = 0;
    doors.frozen = false;
    // Dense index, assign() rather than resize() so a recycled DoorSet is zeroed
    // and cannot inherit the previous floor's door ids — the same reason
    // generate_floor clears to air first.
    doors.index.assign(kMacroCells, 0u);

    std::vector<Doorway> ways;
    floor_doorways(number, spec, seed, ways);

    for (const Doorway& w : ways) {
        const int cx = w.cx, cy = w.cy, cz = w.cz, h = w.h;
        // Jamb offsets: the two wall cells flanking the opening, along the wall
        // line it sits in.
        const int jx = w.axis == 0 ? 0 : 1;
        const int jy = w.axis == 0 ? 1 : 0;

        // Does the finished grid still present this as an architectural opening?
        // The opening must be air and both jambs solid. See door.h on why this is
        // asked of the grid instead of assumed: the lattice lobbies carve through
        // wall lines, and Derelict's gapPct removes 38% of the wall.
        bool ok = true;
        for (int z = cz; z < cz + h && ok; ++z) {
            if (g.cell(cx, cy, z) != kCellAir) ok = false;
            if (g.cell(cx - jx, cy - jy, z) == kCellAir) ok = false;
            if (g.cell(cx + jx, cy + jy, z) == kCellAir) ok = false;
        }
        if (!ok) continue;

        Door d;
        d.cx = static_cast<std::uint8_t>(cx);
        d.cy = static_cast<std::uint8_t>(cy);
        d.cz = static_cast<std::uint8_t>(cz);
        d.h = static_cast<std::uint8_t>(h);
        d.axis = w.axis;
        d.state = static_cast<std::uint8_t>(DoorState::Open);
        d.hp = kDoorHp;

        const std::uint32_t id = static_cast<std::uint32_t>(doors.doors.size());
        doors.doors.push_back(d);
        for (int z = cz; z < cz + h; ++z)
            doors.index[macro_index(wrap_macro(cx), wrap_macro(cy),
                                    wrap_macro(z))] = id + 1u;

        // The frame. Two jambs plus the lintel, recoloured in place over cells that
        // were already solid wall — no solidity changes, so this is invisible to the
        // nav bake and to physics, and it is what makes a doorway findable at range
        // when its door is open. Without it an open door is a hole like any other and
        // the player cannot tell there is anything here to shut.
        for (int z = cz; z < cz + h; ++z) {
            g.set_cell(cx - jx, cy - jy, z, kMatDoor);
            g.set_cell(cx + jx, cy + jy, z, kMatDoor);
        }
        if (g.cell(cx, cy, cz + h) != kCellAir)
            g.set_cell(cx, cy, cz + h, kMatDoor);
    }
    return static_cast<std::uint32_t>(doors.doors.size());
}

bool door_set(World& world, DoorSet& doors, const Registry& reg, LayerId layer,
              std::uint32_t id, bool shut) {
    if (doors.frozen) return false;                       // nav bake reading the grid
    if (id >= doors.doors.size()) return false;
    Door& d = doors.doors[id];
    if (d.state == static_cast<std::uint8_t>(DoorState::Broken)) return false;
    const bool isShut = d.state == static_cast<std::uint8_t>(DoorState::Shut);
    if (isShut == shut) return false;

    if (shut) {
        if (leaf_occupied(d, reg, layer)) return false;   // would seal a body in
        fill_leaf(world.grid(), d);
        d.state = static_cast<std::uint8_t>(DoorState::Shut);
        ++doors.shut;
    } else {
        clear_leaf(world.grid(), d);
        d.state = static_cast<std::uint8_t>(DoorState::Open);
        if (doors.shut) --doors.shut;
    }
    // Contact accounting is per attempt, not cumulative across states: a door you
    // re-open has not been half-pushed by anyone.
    d.forceMs = 0;
    return true;
}

std::uint32_t door_toggle_near(World& world, DoorSet& doors, const Registry& reg,
                               LayerId layer, const vec3& pos) {
    if (doors.frozen || doors.doors.empty()) return kNoDoor;
    int cx, cy, cz;
    agent_cell(pos, cx, cy, cz);

    std::uint32_t best = kNoDoor;
    float bestD2 = kDoorReach * kDoorReach;
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -2; dy <= 2; ++dy)
            for (int dx = -2; dx <= 2; ++dx) {
                const std::uint32_t id = doors.at(cx + dx, cy + dy, cz + dz);
                if (id == kNoDoor) continue;
                const Door& d = doors.doors[id];
                if (d.state == static_cast<std::uint8_t>(DoorState::Broken))
                    continue;
                // True toroidal distance to the leaf's centre, so the reach is a
                // sphere and not the cell box the search walked.
                const float ex = wrap_delta_f(
                    pos.x, (static_cast<float>(d.cx) + 0.5f) * kCellSize,
                    kWorldExtent);
                const float ey = wrap_delta_f(
                    pos.y, (static_cast<float>(d.cy) + 0.5f) * kCellSize,
                    kWorldExtent);
                const float ez = wrap_delta_f(
                    pos.z,
                    (static_cast<float>(d.cz) + static_cast<float>(d.h) * 0.5f) *
                        kCellSize,
                    kWorldExtent);
                const float d2 = ex * ex + ey * ey + ez * ez;
                if (d2 >= bestD2) continue;
                bestD2 = d2;
                best = id;
            }
    if (best == kNoDoor) return kNoDoor;
    const bool wantShut =
        doors.doors[best].state == static_cast<std::uint8_t>(DoorState::Open);
    return door_set(world, doors, reg, layer, best, wantShut) ? best : kNoDoor;
}

std::uint32_t door_shut_all(World& world, DoorSet& doors, const Registry& reg,
                            LayerId layer) {
    std::uint32_t n = 0;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (door_set(world, doors, reg, layer, i, true)) ++n;
    return n;
}

std::uint32_t door_toggle_locks(World& world, DoorSet& doors, const Registry& reg,
                                LayerId layer) {
    std::uint32_t n = 0;
    const bool wantShut = (doors.shut == 0);
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (door_set(world, doors, reg, layer, i, wantShut)) ++n;
    return n;
}

DoorTick door_step(Registry& reg, World& world, DoorSet& doors, LayerId layer,
                   float dt, std::uint64_t tick) {
    DoorTick out;
    // The whole pass costs nothing on the tick where nothing is shut, which is
    // almost every tick. A Broken door is air and cannot be pressed either.
    if (doors.frozen || doors.shut == 0 || dt <= 0.0f) return out;

    MacroGrid& g = world.grid();
    const std::uint32_t now = static_cast<std::uint32_t>(tick);

    // Writes only to Velocity (a component this view already yields) and to `doors`
    // / the grid, which are not ECS pools at all. Nothing here emplaces or destroys,
    // so the view cannot be invalidated mid-iteration — the discipline combat.cpp
    // documents is satisfied by construction rather than by a collect pass.
    auto view = reg.view<Transform, Velocity>();
    for (auto e : view) {
        const Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;
        // The player works a door with a keypress, not by leaning on it.
        if (reg.all_of<CameraTag>(e)) continue;

        int cx, cy, cz;
        agent_cell(tr.pos, cx, cy, cz);

        // Four cardinal neighbours at the body's own z. Adjacency, not velocity —
        // see door.h: physics zeroes the velocity on contact and wander only rewrites
        // it every 8th tick, so a velocity probe would sample intent 1 tick in 8.
        std::uint32_t id = doors.shut_at(cx + 1, cy, cz);
        if (id == kNoDoor) id = doors.shut_at(cx - 1, cy, cz);
        if (id == kNoDoor) id = doors.shut_at(cx, cy + 1, cz);
        if (id == kNoDoor) id = doors.shut_at(cx, cy - 1, cz);
        if (id == kNoDoor) continue;

        Door& d = doors.doors[id];
        ++out.pressing;

        // A monster with an attack hits it. Rate straight off its own table row, so
        // the spread across the roster is authored data and not a door tunable.
        const MobRef* mr = reg.try_get<MobRef>(e);
        if (mr) {
            const MobDef& md = kMobTable[mr->kind];
            if (md.dmg > 0 && md.attackCdMs > 0) {
                const float dps = static_cast<float>(md.dmg) * 1000.0f /
                                  static_cast<float>(md.attackCdMs);
                // Accumulated in uint32 and drained to whole HP immediately, so a
                // 4000 dmg/s outlier (Sculpture) cannot overflow the 16-bit
                // remainder no matter how many of them press the same door.
                std::uint32_t acc =
                    static_cast<std::uint32_t>(d.chipMilli) +
                    static_cast<std::uint32_t>(dps * 1000.0f * dt);
                if (acc >= 1000u) {
                    const int whole = static_cast<int>(acc / 1000u);
                    acc %= 1000u;
                    const int nh = static_cast<int>(d.hp) - whole;
                    d.hp = static_cast<std::int16_t>(nh < -1 ? -1 : nh);
                }
                d.chipMilli = static_cast<std::uint16_t>(acc);
                d.lastTick = now;
                if (d.hp <= 0) {
                    clear_leaf(g, d);
                    d.state = static_cast<std::uint8_t>(DoorState::Broken);
                    if (doors.shut) --doors.shut;
                    ++doors.broken;
                    ++out.broken;
                    out.lastKind = mr->kind;
                }
                continue;
            }
        }

        // Everything else pushes: every resident, and the one monster in the table
        // with no attack at all. This branch is why a shut door can never jam an
        // agent permanently — the flow field routes it here and it gets through.
        if (now - d.lastTick > 1u) d.forceMs = 0;   // contact must be continuous
        d.lastTick = now;
        const std::uint32_t ms =
            static_cast<std::uint32_t>(d.forceMs) +
            static_cast<std::uint32_t>(dt * 1000.0f + 0.5f);
        if (ms >= kDoorForceMs) {
            d.forceMs = 0;
            clear_leaf(g, d);
            d.state = static_cast<std::uint8_t>(DoorState::Open);
            if (doors.shut) --doors.shut;
            ++out.opened;
        } else {
            d.forceMs = static_cast<std::uint16_t>(ms);
        }
    }
    return out;
}

} // namespace giga::game

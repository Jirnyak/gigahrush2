// Fast-travel lattice — discovery-unlock floors + hub boarding ([elevators.md] §24).
//
// Adjacent ±1 rides (ride_elevator / FloorStreamer::travel) stay ride-from-anywhere.
// Fast travel is a SEPARATE mode: teleport to an already-unlocked floor NUMBER, but
// only while standing on a lattice hub cabin (exact XY centre of a 4×4 shaft).
// The same fixed lattice that nav bakes ([lattice.h] / [nav.md]) stamps those cabins
// identically on every floor, so landing on the same hub index is positionally stable.
//
// Unlock policy (elevators.md 2026-07-28):
//   * start floor is pre-unlocked at new game;
//   * a floor joins the network the first time you board a fast cabin on it
//     (and the destination of a successful fast ride is unlocked too);
//   * unlock is a dense bitset over FloorRegistry labels — O(1) test, no maps.
//
// Pure game-layer: no SDL/Vulkan/ImGui. Headless-tested in game_test.
#pragma once

#include <cstdint>

#include "game/floor_registry.h" // kMinFloor, kMaxFloor, kFloorSlots
#include "world/lattice.h"       // kLatticeDim, lattice_coord, lattice_axis_of
#include "world/types.h"         // kMacroDim
#include "core/wrap.h"           // wrapi

namespace giga::game {

// Planar hubs only: jirnyak §24 / elevators.md call for 4×4 fast cabins per floor.
// (The full 4×4×4 = 64 nodes remain the nav coarse graph; boarding is the shaft.)
inline constexpr int kFastHubsPerFloor = kLatticeDim * kLatticeDim; // 16

// True when (cx,cy) is exactly a lattice hub centre — the cabin shaft. Z is the
// walkable storey (arrival z / slab), not a lattice iz, so boarding is XY-only.
inline bool on_fast_hub(int cx, int cy) {
    const int wx = wrapi(cx, kMacroDim);
    const int wy = wrapi(cy, kMacroDim);
    const int ix = lattice_axis_of(wx);
    const int iy = lattice_axis_of(wy);
    return lattice_coord(ix) == wx && lattice_coord(iy) == wy;
}

// Hub index in [0, 16), or -1 when not standing on a cabin.
inline int fast_hub_at(int cx, int cy) {
    if (!on_fast_hub(cx, cy)) return -1;
    const int ix = lattice_axis_of(wrapi(cx, kMacroDim));
    const int iy = lattice_axis_of(wrapi(cy, kMacroDim));
    return iy * kLatticeDim + ix;
}

// Write the macro cell of hub `hub` (0..15) into cx/cy. No-op on a bad index.
inline void fast_hub_cell(int hub, std::uint8_t& cx, std::uint8_t& cy) {
    if (hub < 0 || hub >= kFastHubsPerFloor) return;
    const int ix = hub % kLatticeDim;
    const int iy = hub / kLatticeDim;
    cx = static_cast<std::uint8_t>(lattice_coord(ix));
    cy = static_cast<std::uint8_t>(lattice_coord(iy));
}

// Dense unlock set over every legal floor label. Flat bytes, no heap, no tick work.
struct FastTravelState {
    void reset() {
        for (std::uint8_t& b : bits_) b = 0;
    }

    void unlock(int floor) {
        const int s = slot_of(floor);
        if (s < 0) return;
        bits_[static_cast<std::size_t>(s >> 3)] |=
            static_cast<std::uint8_t>(1u << (s & 7));
    }

    bool unlocked(int floor) const {
        const int s = slot_of(floor);
        if (s < 0) return false;
        return (bits_[static_cast<std::size_t>(s >> 3)] &
                static_cast<std::uint8_t>(1u << (s & 7))) != 0;
    }

    int unlocked_count() const {
        int n = 0;
        for (int f = kMinFloor; f <= kMaxFloor; ++f)
            if (unlocked(f)) ++n;
        return n;
    }

private:
    static constexpr int kBytes = (kFloorSlots + 7) / 8; // 32
    std::uint8_t bits_[kBytes]{};

    static int slot_of(int floor) {
        if (floor < kMinFloor || floor > kMaxFloor) return -1;
        return floor - kMinFloor;
    }
};

// Why a fast-travel attempt was refused. Ok means the gate passed (caller still
// has to run the streamer ride, which may no-op on an unregistered floor).
enum class FastTravelGate : std::uint8_t {
    Ok = 0,
    NotOnHub,   // rider is not on a cabin cell
    Locked,     // destination floor not yet discovered
    NoFloor,    // destination has no registered module
    SameFloor,  // already there
};

// Pure gate: does not mutate state. `hubOut` receives the boarding hub (0..15)
// when the result is Ok; otherwise left untouched.
FastTravelGate fast_travel_gate(const FastTravelState& ft,
                                const FloorRegistry& floors, int fromFloor,
                                int toFloor, int cx, int cy, int* hubOut);

} // namespace giga::game

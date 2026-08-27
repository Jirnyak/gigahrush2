// Fast-travel lattice — discovery-unlock floors + lift-cabin boarding
// ([elevators.md] §24; лифтовая сетка — [markoaudit/plans/elevators-2x2.md]).
//
// Adjacent ±1 rides (ride_elevator / FloorStreamer::travel) stay ride-from-anywhere.
// Fast travel is a SEPARATE mode: teleport to an already-unlocked floor NUMBER, but
// only while standing in a LIFT cabin. Lifts sit on a 2×2 SUBSET of the fixed
// 4×4 lattice — every second node on both axes (решение владельца 2026-08-27:
// 4×4 слишком плотно) — so the same hub index is positionally stable on every
// floor, exactly like the lattice itself ([lattice.h] / [nav.md]).
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

// --- Лифтовая сетка 2×2: подмножество латтиса (elevators-2x2.md) ------------
// Кабины лифтов стоят на каждом ВТОРОМ узле решётки по обеим осям — чётные
// (ix, iy), центры {16, 80}² — 4 лифта на этаж. Нав-граф 4×4 этого не знает и
// знать не должен: для него решётка — Voronoi-разбиение пространства, а есть
// ли в узле лифт — вопрос ЭТОЙ арифметики. Остальные 12 воздушных колонн
// латтиса остаются геометрией (вертикали, водопады) — но кабин в них нет, и
// ни гейт, ни посадка, ни подсказка ELEVATOR их больше не принимают.
inline constexpr int kLiftGridDim = kLatticeDim / 2; // 2
// Выводится из лифтовой сетки, не из всей грани решётки (план, §Дизайн).
inline constexpr int kFastHubsPerFloor = kLiftGridDim * kLiftGridDim; // 4

// Латтис-индекс оси -> лифтовый индекс [0, kLiftGridDim), или -1: нечётный
// узел — лифта нет.
inline constexpr int lift_axis_of(int latticeIx) {
    return (latticeIx & 1) == 0 ? latticeIx / 2 : -1;
}

// True when (cx,cy) is exactly a LIFT node centre — the cabin cell. Z is the
// walkable storey (arrival z / slab), not a lattice iz, so boarding is XY-only.
inline bool on_fast_hub(int cx, int cy) {
    const int wx = wrapi(cx, kMacroDim);
    const int wy = wrapi(cy, kMacroDim);
    const int ix = lattice_axis_of(wx);
    const int iy = lattice_axis_of(wy);
    if (lift_axis_of(ix) < 0 || lift_axis_of(iy) < 0) return false;
    return lattice_coord(ix) == wx && lattice_coord(iy) == wy;
}

// Hub index in [0, kFastHubsPerFloor), or -1 when not standing on a cabin.
inline int fast_hub_at(int cx, int cy) {
    if (!on_fast_hub(cx, cy)) return -1;
    const int lx = lift_axis_of(lattice_axis_of(wrapi(cx, kMacroDim)));
    const int ly = lift_axis_of(lattice_axis_of(wrapi(cy, kMacroDim)));
    return ly * kLiftGridDim + lx;
}

// --- the shaft's actual footprint, and WHY it lives here --------------------
// The generator stamps a 3x3 air column through all 128 z (radius kFastShaftR)
// inside a 7x7 cleared lobby at every storey (radius kFastLobbyR). Those two radii
// used to exist ONLY as locals in padic_gen.cpp, while `on_fast_hub` above accepted
// the single exact centre cell — so the geometry and the gameplay test agreed by
// coincidence at one cell out of nine and disagreed everywhere else.
//
// They live here, and the generator includes this header, because this is the file
// that has to AGREE with the stamped geometry. A second copy is how
// padic_module.cpp ended up shadowing `kLatticeDim` with its own local 4.
inline constexpr int kFastShaftR = 1;   // 3x3 air column, full height
inline constexpr int kFastLobbyR = 3;   // 7x7 cleared lobby at each storey base

// Hub index in [0, kFastHubsPerFloor) when (cx,cy) is anywhere INSIDE a LIFT
// node's shaft column, else -1 — including every non-lift lattice column: an
// odd node's shaft is geometry, not a cabin.
//
// `on_fast_hub` is the exact-centre test and stays exact: it is what the ride
// LANDS you on and what `fast_hub_cell` inverts, so loosening it would make
// "arrived at hub 3" mean nine different cells. This is the other question —
// "is the player standing in the shaft" — and a body is 0.8 m wide in a 6 m column,
// so demanding the centre cell would make the elevator unusable in practice.
// Toroidal: a shaft at cx = 16 is entered from 15 and 17 alike, and cx = 0 is
// adjacent to 127.
inline int fast_hub_near(int cx, int cy) {
    const int wx = wrapi(cx, kMacroDim);
    const int wy = wrapi(cy, kMacroDim);
    const int ix = lattice_axis_of(wx);
    const int iy = lattice_axis_of(wy);
    const int lx = lift_axis_of(ix);
    const int ly = lift_axis_of(iy);
    if (lx < 0 || ly < 0) return -1; // узел без лифта
    const int dx = wrap_delta(lattice_coord(ix), wx, kMacroDim);
    const int dy = wrap_delta(lattice_coord(iy), wy, kMacroDim);
    const int ax = dx < 0 ? -dx : dx;
    const int ay = dy < 0 ? -dy : dy;
    if (ax > kFastShaftR || ay > kFastShaftR) return -1;
    return ly * kLiftGridDim + lx;
}

// Write the macro cell of hub `hub` (0..kFastHubsPerFloor) into cx/cy. No-op
// on a bad index.
inline void fast_hub_cell(int hub, std::uint8_t& cx, std::uint8_t& cy) {
    if (hub < 0 || hub >= kFastHubsPerFloor) return;
    const int ix = (hub % kLiftGridDim) * 2; // лифтовый -> чётный латтис-индекс
    const int iy = (hub / kLiftGridDim) * 2;
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

    // --- persistence seam (save version 10) --------------------------------
    // The set of floors the player has DISCOVERED is progress, and it used to be
    // forgotten on quit: this struct lived as a local in main and appeared nowhere
    // in save.cpp, so every hub found in a session was found again next session
    // ([problems.md] §43). 32 bytes fixes it.
    //
    // Exposed as raw bytes rather than as a floor loop on purpose, and this is the
    // one place in the save where that is the CONSERVATIVE choice: the state is
    // already a dense little bitset with no multi-byte field, so there is no host
    // padding and no byte order to get wrong — the two hazards the field-by-field
    // rule in [save.h] exists to avoid. A loop over 255 floor labels would encode
    // the same 255 bits through 255 branches and could disagree with `slot_of`.
    //
    // `wire_bytes()` is what the save writes; it is `kBytes` and the static_assert
    // in save.cpp pins it, so widening kFloorSlots cannot silently change the
    // format without failing the build.
    static constexpr std::size_t wire_bytes() { return static_cast<std::size_t>(kBytes); }
    const std::uint8_t* raw() const { return bits_; }
    std::uint8_t* raw() { return bits_; }

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
    NotInCabin, // rider is not in a lift cabin (был NotOnHub — умер с сеткой
                // 2×2: «хаб» перестал быть любым узлом решётки, отказ говорит
                // словами кабины; elevators-2x2.md, решение владельца)
    Locked,     // destination floor not yet discovered
    NoFloor,    // destination has no registered module
    SameFloor,  // already there
};

// Pure gate: does not mutate state. `hubOut` receives the boarding hub
// [0, kFastHubsPerFloor) when the result is Ok; otherwise left untouched.
FastTravelGate fast_travel_gate(const FastTravelState& ft,
                                const FloorRegistry& floors, int fromFloor,
                                int toFloor, int cx, int cy, int* hubOut);

} // namespace giga::game

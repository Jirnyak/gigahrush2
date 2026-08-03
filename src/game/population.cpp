#include "game/population.h"

#include "game/floor_gen.h" // floor_ground_z — the module's ground storey

namespace giga::game {

namespace {

// Small deterministic hash -> pseudo-random stream. Same splitmix64 style used
// elsewhere; keeps seeding reproducible without pulling in <random>.
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// Placement lattice. In the floor-MODULE model each layer is its own 128^3
// world (floor_gen.h), so a record's floor number is a LABEL, not a Z band —
// and NO storey is privileged: the torus wraps all three axes, so the height
// coordinate is drawn over the whole axis like the other two. Cold records are
// seeded BLIND (their World may not even exist yet); embodiment resolves each
// body onto the nearest standable cell (floor_stream.cpp, place_body_safely).
//
// Records sit on a 16-cell room lattice at interior offsets {3,6,9,12} — a
// best-effort spread, same idea.
constexpr int kRoomStride = 16;        // placement lattice pitch
constexpr int kRoomsPerAxis = 128 / kRoomStride; // 8
constexpr int kRoomCount = kRoomsPerAxis * kRoomsPerAxis; // 64

// Interior placement offsets within a room (local 1..15 is air; 0 is the wall).
// A 4x4 grid of these gives 16 wall-safe slots per room — enough for the
// densest spec without stacking bodies on one cell.
constexpr int kInteriorOff[4] = {3, 6, 9, 12};
constexpr int kSlotsPerRoom = 16;

// Sample a faction 0..3 from relative weights. Zero total falls back to a flat
// spread so a blank spec still produces a mixed crowd rather than all faction 0.
std::uint16_t sample_faction(const std::uint8_t mix[kFactionCount],
                            std::uint32_t r) {
    std::uint32_t total = 0;
    for (std::size_t f = 0; f < kFactionCount; ++f) total += mix[f];
    if (total == 0)
        return static_cast<std::uint16_t>(r % kFactionCount);
    std::uint32_t pick = r % total;
    std::uint32_t acc = 0;
    for (std::uint16_t f = 0; f < kFactionCount; ++f) {
        acc += mix[f];
        if (pick < acc) return f;
    }
    return static_cast<std::uint16_t>(kFactionCount - 1);
}

} // namespace

std::uint16_t height_for_age(std::uint8_t age, std::uint32_t jitter) {
    // Children grow roughly linearly from ~0.5 m (age 1) to adult by ~18; adults
    // settle around 1.75 m with +/- ~12 cm of deterministic per-record variation.
    constexpr int kAdultAge = 18;
    constexpr int kAdultMm = 1750;
    constexpr int kNewbornMm = 500;
    int base;
    if (age >= kAdultAge) {
        base = kAdultMm;
    } else {
        int a = age < 1 ? 1 : age;
        base = kNewbornMm + (kAdultMm - kNewbornMm) * a / kAdultAge;
    }
    // Variation only for adults; children's spread stays small via the ramp.
    int spread = age >= kAdultAge ? 240 : 60;
    int delta = static_cast<int>(jitter % static_cast<std::uint32_t>(spread)) -
                spread / 2;
    int mm = base + delta;
    if (mm < 300) mm = 300;
    if (mm > 2200) mm = 2200;
    return static_cast<std::uint16_t>(mm);
}

NpcId seed_floor_from_spec(NpcPool& pool, int floor, const FloorSpec& spec,
                           std::uint32_t seed) {
    NpcId first = kInvalidNpc;
    NpcId last = kInvalidNpc;
    std::uint32_t placed = 0;

    // Age window from the spec (guard against an inverted/empty window).
    int ageLo = spec.minAge < 1 ? 1 : spec.minAge;
    int ageHi = spec.maxAge < ageLo ? ageLo : spec.maxAge;
    int ageSpan = ageHi - ageLo + 1;

    for (std::uint32_t i = 0; i < spec.population; ++i) {
        NpcId id = pool.spawn();
        if (id == kInvalidNpc) break; // reserve exhausted
        if (first == kInvalidNpc) first = id;
        last = id;

        std::uint32_t r = mix(seed ^ (i * 0x9e3779b9u));

        // Fill rooms round-robin (even spread), then step through interior slots
        // within each room. Wraps past kSlotsPerRoom only at very high density.
        int room = static_cast<int>(i) % kRoomCount;
        int slot = (static_cast<int>(i) / kRoomCount) % kSlotsPerRoom;
        int rx = room % kRoomsPerAxis;
        int ry = room / kRoomsPerAxis;
        int ox = kInteriorOff[slot % 4];
        int oy = kInteriorOff[slot / 4];
        pool.cx(id) = static_cast<std::uint8_t>(rx * kRoomStride + ox);
        pool.cy(id) = static_cast<std::uint8_t>(ry * kRoomStride + oy);
        pool.cz(id) = static_cast<std::uint8_t>(mix(r ^ 0x51ED270Bu) %
                                                static_cast<std::uint32_t>(kMacroDim));

        // The label is signed end to end: `floor` is an int (FloorRegistry's range is
        // kMinFloor -127 .. kMaxFloor +127) and the column is std::int16_t, so a
        // descending floor round-trips. It used to arrive here as std::uint16_t, i.e.
        // floor -50 already wrecked into 65486 before the store.
        pool.set_floor(id, static_cast<std::int16_t>(floor));
        // Demographics: age from the spec window, sex, height from age.
        std::uint8_t age =
            static_cast<std::uint8_t>(ageLo + static_cast<int>(r % static_cast<std::uint32_t>(ageSpan)));
        pool.age(id) = age;
        pool.sex(id) = (r & 0x100u) ? SexFemale : SexMale;
        pool.height_mm(id) = height_for_age(age, mix(r));

        // Generic attribute block: byte-valued, seeded per slot. No named stats.
        auto& attrs = pool.attrs(id);
        for (int a = 0; a < kAttrSlots; ++a)
            attrs[static_cast<std::size_t>(a)] =
                static_cast<std::uint8_t>(3 + (mix(r + a * 0x1000193u) % 13u)); // 3..15

        pool.level(id) = static_cast<std::uint8_t>(1 + (r % 10u));
        pool.faction(id) = sample_faction(spec.factionMix, mix(r ^ 0x51ed270bu));
        pool.max_hp(id) = 100;
        pool.hp(id) = 100;
        ++placed;
    }

    if (placed == 0) return kInvalidNpc;

    // Choose the middle-ish record as the player candidate, so it lands in an
    // interior room rather than a corner. It becomes "the player" only when
    // embody_as_player() sets the NpcPlayer bit; here we just pick the id.
    NpcId playerId = first + placed / 2;
    if (playerId > last) playerId = last;
    return playerId;
}

NpcId seed_floor_population(NpcPool& pool, int floor, std::uint32_t n,
                            std::uint32_t seed) {
    // A plain count with no floor character: flat faction mix, full adult age
    // range. Everything else routes through the spec-driven path.
    FloorSpec uniform{};
    uniform.kind = FloorKind::Residential;
    uniform.name = "uniform";
    uniform.population = n;
    for (std::size_t f = 0; f < kFactionCount; ++f) uniform.factionMix[f] = 1;
    uniform.hostility = 0.0f;
    uniform.minAge = 1;
    uniform.maxAge = 100;
    return seed_floor_from_spec(pool, floor, uniform, seed);
}

} // namespace giga::game

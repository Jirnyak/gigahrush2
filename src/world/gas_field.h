#pragma once

#include <cstdint>

namespace giga {

// GasCell encodes four distinct gas simulation fields into a single 32-bit word.
// This packing ensures cache locality since reactions read and write multiple
// fields in the same cell (e.g. fire consumes oxy and produces smoke/heat).
struct GasCell {
    std::uint8_t toxic = 0;   // Toxic gas concentration (e.g. spore haze)
    std::uint8_t smoke = 0;   // Smoke concentration (blocks vision)
    std::uint8_t oxy   = 255; // Ambient oxygen. Consumed by fire.
    std::uint8_t heat  = 0;   // Heat/Fire level.
};

static_assert(sizeof(GasCell) == 4, "GasCell must be exactly 4 bytes (one 32-bit word) to match shader layout and avoid padding.");

// The standard field name used to lookup the field in the FieldRegistry.
inline constexpr const char* kGasField = "gas";

} // namespace giga

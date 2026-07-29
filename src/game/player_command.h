// PlayerCommand — the client→server input seam (netcode.md increment #1).
//
// The one payload that crosses UP across the client/server boundary: a client's
// movement + look + button intent for a single tick, shaped like a Source engine
// *usercmd*. It is a flat, trivially-copyable, versioned POD so the future
// `NetworkConnection` (netcode.md) serializes it with a memcpy rather than a graph
// walk — the same dense-data discipline as the rest of the engine.
//
// WHY THIS LIVES IN giga_game, NOT src/input
// ------------------------------------------
// netcode.md rule #1: "the client never mutates authoritative state" — no system
// writes a component the sim reads except THROUGH a PlayerCommand applied on the
// server. So the *application* (`apply_player_command`) is server-side and headless
// (no SDL), which is what lets it be unit-tested in `game_test` with no window —
// the doc's stated win. The SDL input bridge (src/input) only *builds* a command
// from devices and hands it to this apply step; on a `LocalConnection` (today's
// single-player listen server) that happens the same tick, so the feel is
// byte-identical to the old direct-write path.
//
// OWNERSHIP IS PER-COMMAND, NOT GLOBAL (netcode.md rule #4). `apply_player_command`
// takes the avatar entity explicitly; there is no "the player" singleton. N
// sessions each own an embodied entity and each apply their own command — the
// engine already forbids a player singleton (npcs.md), so multi-client needs no
// special case here.
#pragma once
#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"

namespace giga::game {

// Button intents, one bit each. The FULL contract per netcode.md is declared here
// so the POD is the complete seam and later increments only add *producers* — but
// increment #1 populates only Jump + FlyToggle, which is everything the SDL input
// bridge (src/input) owned directly before this. The remaining bits are the game's
// existing intent flags in main.cpp (eat/drink/heal/sell/buy/door/save/load,
// elevator up/down, attack/use/interact); routing those through the command is a
// later increment, so they are reserved rather than wired to keep this change
// additive and behaviour-identical.
enum class Button : std::uint32_t {
    None         = 0,
    Jump         = 1u << 0,
    FlyToggle    = 1u << 1,
    // Reserved (declared, not yet produced) — the game-layer intents main.cpp still
    // owns as its own flags today. Named now so the wire format is stable.
    Attack       = 1u << 2,
    Use          = 1u << 3,
    Interact     = 1u << 4,
    ElevatorUp   = 1u << 5,
    ElevatorDown = 1u << 6,
    Eat          = 1u << 7,
    Drink        = 1u << 8,
    Heal         = 1u << 9,
    Sell         = 1u << 10,
    Buy          = 1u << 11,
    Door         = 1u << 12,
    Save         = 1u << 13,
    Load         = 1u << 14,
};

// Bit helpers, mirroring the AiFlag pattern in mob_table.h (RTTI-free, constexpr).
constexpr std::uint32_t bit(Button b) noexcept {
    return static_cast<std::uint32_t>(b);
}
constexpr bool has_button(std::uint32_t buttons, Button b) noexcept {
    return (buttons & bit(b)) != 0u;
}

// One client's intent for one tick. Trivially-copyable + standard-layout (asserted
// in player_command.cpp) so the wire format is a memcpy.
//
// Look angles are ABSOLUTE (Source's usercmd view angles), not deltas: the client
// owns its running view angle and sends the resolved value; the server assigns it
// and clamps pitch (never trusting the client — server-authoritative clamp). When
// mouselook is off, the client seeds these from the avatar's current camera and
// applies no delta, so `apply_player_command` writes them back unchanged — a no-op,
// which is exactly the old frozen-view behaviour.
struct PlayerCommand {
    static constexpr std::uint16_t kVersion = 1;

    std::uint16_t version = kVersion; // bumped when the layout changes
    std::uint16_t pad_ = 0;           // explicit — keeps the u32s aligned on the wire
    std::uint32_t buttons = 0;        // OR of Button bits
    std::uint32_t clientTick = 0;     // client's tick number, for ordering/acks

    vec3 wishDir{0, 0, 0}; // camera-local move intent (fwd, right, up), each [-1,1]
    float yaw = 0.0f;      // absolute look yaw   (radians, world +Z up)
    float pitch = 0.0f;    // absolute look pitch (radians; server clamps to ~±89°)
};

// Server-side application — the ONLY writer of an avatar's input-driven components
// (Controller.wishDir/fly, CameraTag.yaw/pitch, Jump.wants_jump). Headless: no SDL,
// so it runs and is tested without a window. A no-op if `avatar` is invalid or
// lacks the components (a disconnected/dead session applies to nothing).
//
// `dt` is accepted for symmetry with the *_step systems and reserved for future
// per-tick integration (look accel, analog ramps); unused today.
void apply_player_command(Registry& reg, Entity avatar, const PlayerCommand& cmd,
                          float dt);

} // namespace giga::game

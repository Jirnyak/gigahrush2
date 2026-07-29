#include "game/player_command.h"

#include <algorithm>
#include <type_traits>

#include "ecs/components.h"

namespace giga::game {

// The POD promise is load-bearing: netcode.md rule #5 says everything crossing the
// seam is a flat struct so the future wire format is a memcpy. Assert it at build
// time rather than trusting it — a stray std::string or vtable added later would
// break replication silently, and this catches it at the source.
static_assert(std::is_trivially_copyable_v<PlayerCommand>,
              "PlayerCommand must be memcpy-able for the wire format (netcode.md #5)");
static_assert(std::is_standard_layout_v<PlayerCommand>,
              "PlayerCommand must be standard-layout for a stable wire format");

void apply_player_command(Registry& reg, Entity avatar, const PlayerCommand& cmd,
                          float /*dt*/) {
    // A disconnected/dead/uncontrollable session applies to nothing. The avatar
    // must own BOTH components — the "player is whoever holds CameraTag+Controller"
    // rule (npcs.md), now scoped to one explicit entity instead of the implicit
    // "first in the view" the old input bridge assumed.
    if (!reg.valid(avatar)) return;
    auto* cam = reg.try_get<CameraTag>(avatar);
    auto* ctl = reg.try_get<Controller>(avatar);
    if (!cam || !ctl) return;

    // Look angles are absolute (the client owns its running view angle). The
    // server assigns them and CLAMPS pitch itself — server-authoritative, never
    // trusting the client with an out-of-range value. The limit is the same
    // ~89° the old input bridge enforced, so a genuine mouselook frame lands on
    // the identical clamped value it used to.
    constexpr float kPitchLimit = 1.5533f; // ~89 degrees
    cam->yaw = cmd.yaw;
    cam->pitch = std::clamp(cmd.pitch, -kPitchLimit, kPitchLimit);

    // Fly toggle is an edge the client already debounced (SDL key-down, no
    // repeat) into a single Button bit — so consuming it once here matches the
    // old `if (toggleFlyEdge_) ctl.fly = !ctl.fly`.
    if (has_button(cmd.buttons, Button::FlyToggle)) ctl->fly = !ctl->fly;

    // Movement intent, camera-local, verbatim from the command.
    ctl->wishDir = cmd.wishDir;

    // Jump only bites in walk mode (fly uses wishDir.z), and only if the avatar
    // can jump — same guard as before.
    if (has_button(cmd.buttons, Button::Jump) && !ctl->fly) {
        if (auto* j = reg.try_get<Jump>(avatar)) j->wants_jump = true;
    }
}

} // namespace giga::game

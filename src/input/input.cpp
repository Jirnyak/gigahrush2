#include "input/input.h"

#include <SDL3/SDL.h>

#include "ecs/components.h"
#include "game/player_command.h"

namespace giga {

void InputState::handle_event(const SDL_Event& e) {
    switch (e.type) {
    case SDL_EVENT_MOUSE_MOTION:
        if (mouselook_) {
            mouseDx_ += e.motion.xrel;
            mouseDy_ += e.motion.yrel;
        }
        break;
    case SDL_EVENT_KEY_DOWN:
        if (!e.key.repeat) {
            if (e.key.scancode == SDL_SCANCODE_SPACE) jumpEdge_ = true;
            if (e.key.scancode == SDL_SCANCODE_F) toggleFlyEdge_ = true;
        }
        break;
    default:
        break;
    }
}

game::PlayerCommand InputState::build_command(Registry& reg, Entity avatar) const {
    game::PlayerCommand cmd{};

    // Fly toggle is an edge; the button bit carries it and the server flips the
    // state. But the movement up-axis below depends on the fly state AS OF THIS
    // FRAME (the old code toggled fly first, then read it) — so predict the
    // post-toggle state here for wishDir, exactly reproducing that ordering.
    bool willFly = false;
    if (const auto* ctl = reg.try_get<Controller>(avatar)) willFly = ctl->fly;
    if (toggleFlyEdge_) {
        cmd.buttons |= game::bit(game::Button::FlyToggle);
        willFly = !willFly;
    }

    // Absolute look angles: seed from the avatar's current camera, fold in this
    // frame's mouse delta (only when mouselook is on — otherwise the view is
    // frozen and we send it back unchanged). Screen-down = look down, so both
    // subtract, matching the old bridge. Pitch clamping is the SERVER's job.
    if (const auto* cam = reg.try_get<CameraTag>(avatar)) {
        cmd.yaw = cam->yaw;
        cmd.pitch = cam->pitch;
    }
    if (mouselook_) {
        cmd.yaw -= mouseDx_ * sensitivity_;
        cmd.pitch -= mouseDy_ * sensitivity_;
    }

    // Movement intent, camera-local. Scancodes are layout-independent.
    const bool* ks = SDL_GetKeyboardState(nullptr);
    float fwd = 0.0f, right = 0.0f, up = 0.0f;
    if (ks[SDL_SCANCODE_W]) fwd += 1.0f;
    if (ks[SDL_SCANCODE_S]) fwd -= 1.0f;
    if (ks[SDL_SCANCODE_D]) right += 1.0f;
    if (ks[SDL_SCANCODE_A]) right -= 1.0f;
    if (willFly) {
        if (ks[SDL_SCANCODE_E] || ks[SDL_SCANCODE_SPACE]) up += 1.0f;
        if (ks[SDL_SCANCODE_Q] || ks[SDL_SCANCODE_LCTRL]) up -= 1.0f;
    }
    cmd.wishDir = vec3{fwd, right, up};

    // Jump edge (walk mode only; fly uses wishDir.z). The server re-checks the
    // fly guard, so sending the bit unconditionally is safe and keeps the client
    // dumb — it proposes, the server disposes.
    if (jumpEdge_) cmd.buttons |= game::bit(game::Button::Jump);

    return cmd;
}

void InputState::apply(Registry& reg, float dt) {
    // Select the avatar: the first entity that owns both a camera and a
    // controller. This is the "player is whoever holds CameraTag + Controller"
    // rule; the future GameClient will instead pass its session's owned entity.
    Entity avatar = entt::null;
    auto view = reg.view<CameraTag, Controller>();
    for (auto ent : view) { avatar = ent; break; }

    if (avatar != entt::null) {
        game::PlayerCommand cmd = build_command(reg, avatar);
        game::apply_player_command(reg, avatar, cmd, dt);
    }

    // Clear per-frame edges + deltas (owned here, not in build_command, so a
    // GameClient can build a command per frame without consuming the edges twice).
    mouseDx_ = 0.0f;
    mouseDy_ = 0.0f;
    jumpEdge_ = false;
    toggleFlyEdge_ = false;
}

} // namespace giga

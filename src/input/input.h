// Input -> ECS bridge (client side of the netcode seam).
//
// Translates SDL3 keyboard + relative mouse motion into a `game::PlayerCommand`
// (the client's per-tick intent) and hands it to the server-side
// `apply_player_command`, which is the ONLY writer of the avatar's input-driven
// components (CameraTag yaw/pitch, Controller wishDir/fly, Jump). This is the
// client/server seam from netcode.md increment #1: the bridge PROPOSES a command;
// the server DISPOSES by applying it. On today's in-process listen server the
// apply happens the same tick, so the feel is byte-identical to the old direct
// component write.
//
// Because it drives whatever entity currently owns CameraTag + Controller (never a
// hard-coded player), the avatar is selected, not assumed.
#pragma once

#include "ecs/registry.h"
#include "game/keybind.h"
#include "game/player_command.h"

union SDL_Event;
struct SDL_Gamepad;

namespace giga {

class InputState {
public:
    InputState();
    ~InputState();
    InputState(const InputState&) = delete;
    InputState& operator=(const InputState&) = delete;
    InputState(InputState&&) noexcept;
    InputState& operator=(InputState&&) noexcept;

    // Toggle mouselook (relative mouse). When off, the cursor is free for the
    // ImGui HUD.
    void set_mouselook(bool on) { mouselook_ = on; }
    bool mouselook() const { return mouselook_; }

    // Query if action/attack is held (via gamepad triggers or bumpers)
    bool action_held() const { return gamepadAttackHeld_; }
    bool gamepad_connected() const { return gamepad_ != nullptr; }
    void set_gamepad_look_speed(float s) { gamepadLookSpeed_ = s; }

    // The held movement keys, from the keybinding table ([keybind.h]). The app
    // pushes a fresh set after any rebind; defaults are WASD + E/Q + Space.
    void set_move_binds(const game::MoveBinds& b) { binds_ = b; }

    // Queue a fly-toggle edge for the next command. Called by the app when the
    // `fly` console request fires, so the toggle still crosses the client →
    // server seam as a PlayerCommand button instead of a component write.
    void queue_fly_toggle() { toggleFlyEdge_ = true; }

    // Accumulate a single SDL event (mouse motion, mouse buttons, key edges, gamepad events).
    void handle_event(const SDL_Event& e);

    // Build this tick's command from accumulated device state + the avatar's
    // current view/fly. Look angles are ABSOLUTE (current camera angle folded with
    // this frame's mouse delta and gamepad stick delta), matching a Source usercmd.
    game::PlayerCommand build_command(Registry& reg, Entity avatar) const;

    // Apply accumulated input to the active camera entity: select the avatar
    // (first CameraTag + Controller), build its command, apply it server-side,
    // then clear per-frame deltas/edges. Entry point unchanged from before the
    // seam, so the main loop's call site is untouched.
    void apply(Registry& reg, float dt);

private:
    bool mouselook_ = false;
    float mouseDx_ = 0.0f;
    float mouseDy_ = 0.0f;
    float sensitivity_ = 0.0025f;
    bool jumpEdge_ = false;
    bool toggleFlyEdge_ = false;
    game::MoveBinds binds_{}; // scancodes for the held keys, rebindable

    // Gamepad / VR controller input state
    SDL_Gamepad* gamepad_ = nullptr;
    float gamepadLookSpeed_ = 2.5f; // rad/sec
    float lastDt_ = 1.0f / 60.0f;
    bool gamepadJumpEdge_ = false;
    bool gamepadFlyToggleEdge_ = false;
    bool gamepadAttackHeld_ = false;
};

} // namespace giga

// Input -> ECS bridge.
//
// Translates SDL3 keyboard + relative mouse motion into the CameraTag (yaw /
// pitch) and Controller (wishDir, jump) of the active camera entity. Because it
// writes components rather than driving a hard-coded player, whichever entity
// currently owns those components is the one that moves.
#pragma once

#include "ecs/registry.h"

union SDL_Event;

namespace giga {

class InputState {
public:
    // Toggle mouselook (relative mouse). When off, the cursor is free for the
    // ImGui HUD.
    void set_mouselook(bool on) { mouselook_ = on; }
    bool mouselook() const { return mouselook_; }

    // Accumulate a single SDL event (mouse motion, mouse buttons, key edges).
    void handle_event(const SDL_Event& e);

    // Apply accumulated mouse delta + current keyboard state to the active
    // camera/controller entity, then clear per-frame deltas.
    void apply(Registry& reg, float dt);

private:
    bool mouselook_ = false;
    float mouseDx_ = 0.0f;
    float mouseDy_ = 0.0f;
    float sensitivity_ = 0.0025f;
    bool jumpEdge_ = false;
    bool toggleFlyEdge_ = false;
};

} // namespace giga

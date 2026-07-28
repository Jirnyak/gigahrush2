#include "input/input.h"

#include <algorithm>
#include <cmath>

#include <SDL3/SDL.h>

#include "ecs/components.h"

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

void InputState::apply(Registry& reg, float dt) {
    auto view = reg.view<CameraTag, Controller>();
    for (auto ent : view) {
        auto& cam = view.get<CameraTag>(ent);
        auto& ctl = view.get<Controller>(ent);

        // Mouselook: yaw += dx, pitch -= dy (screen-down = look down).
        if (mouselook_) {
            cam.yaw -= mouseDx_ * sensitivity_;
            cam.pitch -= mouseDy_ * sensitivity_;
            const float lim = 1.5533f; // ~89 degrees
            cam.pitch = std::clamp(cam.pitch, -lim, lim);
        }

        if (toggleFlyEdge_) ctl.fly = !ctl.fly;

        // Keyboard movement intent. Scancodes are layout-independent.
        const bool* ks = SDL_GetKeyboardState(nullptr);
        float fwd = 0.0f, right = 0.0f, up = 0.0f;
        if (ks[SDL_SCANCODE_W]) fwd += 1.0f;
        if (ks[SDL_SCANCODE_S]) fwd -= 1.0f;
        if (ks[SDL_SCANCODE_D]) right += 1.0f;
        if (ks[SDL_SCANCODE_A]) right -= 1.0f;
        if (ctl.fly) {
            if (ks[SDL_SCANCODE_E] || ks[SDL_SCANCODE_SPACE]) up += 1.0f;
            if (ks[SDL_SCANCODE_Q] || ks[SDL_SCANCODE_LCTRL]) up -= 1.0f;
        }
        ctl.wishDir = vec3{fwd, right, up};

        // Jump edge -> Jump component (walk mode only; fly uses wishDir.z).
        if (jumpEdge_ && !ctl.fly) {
            if (auto* j = reg.try_get<Jump>(ent)) j->wants_jump = true;
        }
        break; // only the active camera entity
    }

    // Clear per-frame edges + deltas.
    mouseDx_ = 0.0f;
    mouseDy_ = 0.0f;
    jumpEdge_ = false;
    toggleFlyEdge_ = false;
}

} // namespace giga

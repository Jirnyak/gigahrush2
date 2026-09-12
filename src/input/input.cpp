#include "input/input.h"

#include <SDL3/SDL.h>
#include <cmath>

#include "ecs/components.h"
#include "game/player_command.h"

namespace giga {

InputState::InputState() {
    int count = 0;
    SDL_JoystickID* ids = SDL_GetGamepads(&count);
    if (ids) {
        if (count > 0) {
            gamepad_ = SDL_OpenGamepad(ids[0]);
        }
        SDL_free(ids);
    }
}

InputState::~InputState() {
    if (gamepad_) {
        SDL_CloseGamepad(gamepad_);
        gamepad_ = nullptr;
    }
}

InputState::InputState(InputState&& o) noexcept
    : mouselook_(o.mouselook_),
      mouseDx_(o.mouseDx_),
      mouseDy_(o.mouseDy_),
      sensitivity_(o.sensitivity_),
      jumpEdge_(o.jumpEdge_),
      toggleFlyEdge_(o.toggleFlyEdge_),
      binds_(o.binds_),
      gamepad_(o.gamepad_),
      gamepadLookSpeed_(o.gamepadLookSpeed_),
      lastDt_(o.lastDt_),
      gamepadJumpEdge_(o.gamepadJumpEdge_),
      gamepadFlyToggleEdge_(o.gamepadFlyToggleEdge_),
      gamepadAttackHeld_(o.gamepadAttackHeld_) {
    o.gamepad_ = nullptr;
}

InputState& InputState::operator=(InputState&& o) noexcept {
    if (this != &o) {
        if (gamepad_) SDL_CloseGamepad(gamepad_);
        mouselook_ = o.mouselook_;
        mouseDx_ = o.mouseDx_;
        mouseDy_ = o.mouseDy_;
        sensitivity_ = o.sensitivity_;
        jumpEdge_ = o.jumpEdge_;
        toggleFlyEdge_ = o.toggleFlyEdge_;
        binds_ = o.binds_;
        gamepad_ = o.gamepad_;
        gamepadLookSpeed_ = o.gamepadLookSpeed_;
        lastDt_ = o.lastDt_;
        gamepadJumpEdge_ = o.gamepadJumpEdge_;
        gamepadFlyToggleEdge_ = o.gamepadFlyToggleEdge_;
        gamepadAttackHeld_ = o.gamepadAttackHeld_;
        o.gamepad_ = nullptr;
    }
    return *this;
}

void InputState::handle_event(const SDL_Event& e) {
    switch (e.type) {
    case SDL_EVENT_GAMEPAD_ADDED:
        if (!gamepad_) {
            gamepad_ = SDL_OpenGamepad(e.gdevice.which);
        }
        break;
    case SDL_EVENT_GAMEPAD_REMOVED:
        if (gamepad_ && SDL_GetGamepadID(gamepad_) == e.gdevice.which) {
            SDL_CloseGamepad(gamepad_);
            gamepad_ = nullptr;
        }
        break;
    case SDL_EVENT_GAMEPAD_BUTTON_DOWN:
        if (e.gbutton.button == SDL_GAMEPAD_BUTTON_SOUTH ||
            e.gbutton.button == SDL_GAMEPAD_BUTTON_LEFT_SHOULDER) {
            gamepadJumpEdge_ = true;
        } else if (e.gbutton.button == SDL_GAMEPAD_BUTTON_NORTH ||
                   e.gbutton.button == SDL_GAMEPAD_BUTTON_WEST ||
                   e.gbutton.button == SDL_GAMEPAD_BUTTON_LEFT_STICK) {
            gamepadFlyToggleEdge_ = true;
        } else if (e.gbutton.button == SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER) {
            gamepadAttackHeld_ = true;
        }
        break;
    case SDL_EVENT_GAMEPAD_BUTTON_UP:
        if (e.gbutton.button == SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER) {
            gamepadAttackHeld_ = false;
        }
        break;
    case SDL_EVENT_MOUSE_MOTION:
        if (mouselook_) {
            mouseDx_ += e.motion.xrel;
            mouseDy_ += e.motion.yrel;
        }
        break;
    case SDL_EVENT_KEY_DOWN:
        // Jump is the only key EDGE the bridge still reads itself; every other
        // pressed action goes key -> KeybindTable row -> console command, and
        // fly arrives via queue_fly_toggle() on that path.
        if (mouselook_ && !e.key.repeat) {
            if (static_cast<std::uint16_t>(e.key.scancode) == binds_.jump)
                jumpEdge_ = true;
        }
        break;
    default:
        break;
    }
}

game::PlayerCommand InputState::build_command(Registry& reg, Entity avatar) const {
    game::PlayerCommand cmd{};

    bool willFly = false;
    if (const auto* ctl = reg.try_get<Controller>(avatar)) willFly = ctl->fly;
    if (toggleFlyEdge_ || gamepadFlyToggleEdge_) {
        cmd.buttons |= game::bit(game::Button::FlyToggle);
        willFly = !willFly;
    }

    if (const auto* cam = reg.try_get<CameraTag>(avatar)) {
        cmd.yaw = cam->yaw;
        cmd.pitch = cam->pitch;
    }

    float stickFwd = 0.0f;
    float stickRight = 0.0f;
    float stickUp = 0.0f;
    float stickYawDelta = 0.0f;
    float stickPitchDelta = 0.0f;

    if (gamepad_) {
        constexpr float kStickDeadzone = 0.15f;
        constexpr float kTriggerThreshold = 0.25f;

        auto filter_axis = [](Sint16 raw, float deadzone) -> float {
            float v = static_cast<float>(raw) / (raw < 0 ? 32768.0f : 32767.0f);
            if (std::fabs(v) <= deadzone) return 0.0f;
            float sign = v > 0.0f ? 1.0f : -1.0f;
            return sign * (std::fabs(v) - deadzone) / (1.0f - deadzone);
        };

        Sint16 rawLx = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFTX);
        Sint16 rawLy = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFTY);
        Sint16 rawRx = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHTX);
        Sint16 rawRy = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHTY);
        Sint16 rawLt = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFT_TRIGGER);
        Sint16 rawRt = SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER);

        float lx = filter_axis(rawLx, kStickDeadzone);
        float ly = filter_axis(rawLy, kStickDeadzone);
        float rx = filter_axis(rawRx, kStickDeadzone);
        float ry = filter_axis(rawRy, kStickDeadzone);
        float lt = static_cast<float>(rawLt) / 32767.0f;
        float rt = static_cast<float>(rawRt) / 32767.0f;

        // Left stick: movement. SDL stick up is negative, so forward = -ly.
        stickFwd = -ly;
        stickRight = lx;

        // Right stick: look (yaw and pitch).
        // rx > 0 (stick right) turns view right (decreases yaw).
        // ry < 0 (stick up in SDL) looks up (increases pitch).
        float dt = lastDt_ > 0.0f ? lastDt_ : (1.0f / 60.0f);
        stickYawDelta = rx * gamepadLookSpeed_ * dt;
        stickPitchDelta = ry * gamepadLookSpeed_ * dt;

        bool btnRB = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER);
        bool btnLB = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_LEFT_SHOULDER);
        bool btnDpadUp = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_DPAD_UP);
        bool btnDpadDown = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_DPAD_DOWN);

        // Fly vertical movement
        if (willFly) {
            if (btnRB || btnDpadUp || (rt > kTriggerThreshold)) stickUp += 1.0f;
            if (btnLB || btnDpadDown || (lt > kTriggerThreshold)) stickUp -= 1.0f;
        }

        // Action trigger
        if ((rt > kTriggerThreshold) || btnRB) {
            cmd.buttons |= game::bit(game::Button::Attack);
        }
    }

    // Absolute look angles: seed from the avatar's current camera, fold in mouse delta
    // and gamepad stick rotation (only when mouselook is active).
    if (mouselook_) {
        cmd.yaw -= (mouseDx_ * sensitivity_ + stickYawDelta);
        cmd.pitch -= (mouseDy_ * sensitivity_ + stickPitchDelta);

        const bool* ks = SDL_GetKeyboardState(nullptr);
        float fwd = stickFwd, right = stickRight, up = stickUp;
        if (ks[binds_.fwd]) fwd += 1.0f;
        if (ks[binds_.back]) fwd -= 1.0f;
        if (ks[binds_.right]) right += 1.0f;
        if (ks[binds_.left]) right -= 1.0f;
        if (willFly) {
            if (ks[binds_.up] || ks[binds_.jump]) up += 1.0f;
            if (ks[binds_.down] || ks[binds_.downAlt]) up -= 1.0f;
        }
        cmd.wishDir = vec3{std::clamp(fwd, -1.0f, 1.0f),
                           std::clamp(right, -1.0f, 1.0f),
                           std::clamp(up, -1.0f, 1.0f)};

        if (jumpEdge_ || gamepadJumpEdge_) cmd.buttons |= game::bit(game::Button::Jump);
        if (gamepadAttackHeld_) cmd.buttons |= game::bit(game::Button::Attack);
    }

    return cmd;
}

void InputState::apply(Registry& reg, float dt) {
    lastDt_ = dt;
    Entity avatar = entt::null;
    auto view = reg.view<CameraTag, Controller>();
    for (auto ent : view) { avatar = ent; break; }

    if (avatar != entt::null) {
        game::PlayerCommand cmd = build_command(reg, avatar);
        game::apply_player_command(reg, avatar, cmd, dt);
    }

    // Clear per-frame edges + deltas
    mouseDx_ = 0.0f;
    mouseDy_ = 0.0f;
    jumpEdge_ = false;
    toggleFlyEdge_ = false;
    gamepadJumpEdge_ = false;
    gamepadFlyToggleEdge_ = false;
}

} // namespace giga

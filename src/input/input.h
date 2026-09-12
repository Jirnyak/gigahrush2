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
#include "game/gamepad.h"
#include "game/keybind.h"
#include "game/player_command.h"

union SDL_Event;
struct SDL_Gamepad;

namespace giga {

class InputState {
public:
    // Владеет SDL_Gamepad* — отсюда правило пяти: копия закрыта (две копии
    // закрыли бы одно устройство дважды), перенос отдаёт владение.
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

    // Есть ли подключённый геймпад (строка «поддерживаемые устройства» на
    // странице Стима и ветка худа с подсказками кнопок).
    bool gamepad_connected() const { return gamepad_ != nullptr; }

    // РУКИ с триггеров, раздельно ([two-hands.md]): левый триггер — левая рука
    // (та же, что ЛКМ), правый — правая (ПКМ). Читается приложением и
    // складывается по ИЛИ с мышью, поэтому мышь и геймпад работают вместе.
    // Гейт по mouselook_ здесь тот же, что у осей: пока открыто окно, ввод до
    // боя не доходит — иначе триггер бьёт сквозь инвентарь.
    bool hand_left_held() const {
        return mouselook_ && game::gamepad_fold(gamepadAxes_, false, 0.0f, 0.0f).handL;
    }
    bool hand_right_held() const {
        return mouselook_ && game::gamepad_fold(gamepadAxes_, false, 0.0f, 0.0f).handR;
    }

    // The held movement keys, from the keybinding table ([keybind.h]). The app
    // pushes a fresh set after any rebind; defaults are WASD + E/Q + Space.
    void set_move_binds(const game::MoveBinds& b) { binds_ = b; }

    // Queue a fly-toggle edge for the next command. Called by the app when the
    // `fly` console request fires, so the toggle still crosses the client →
    // server seam as a PlayerCommand button instead of a component write.
    void queue_fly_toggle() { toggleFlyEdge_ = true; }

    // Accumulate a single SDL event (mouse motion, mouse buttons, key edges,
    // подключение/отключение геймпада и его кнопочные эджи).
    void handle_event(const SDL_Event& e);

    // Build this tick's command from accumulated device state + the avatar's
    // current view/fly. Look angles are ABSOLUTE (current camera angle folded with
    // this frame's mouse delta), matching a Source usercmd; the server clamps
    // pitch. Reads SDL keyboard state directly (client-side). Does NOT clear the
    // per-frame accumulators — `apply` owns that. Public so the future GameClient
    // (netcode.md increment #4) can gather → command → send with its own avatar.
    //
    // `dt` — шаг тика. Нужен потому, что взгляд с геймпада есть СКОРОСТЬ
    // (рад/с), в отличие от мышиной дельты, уже накопленной за кадр. Раньше
    // параметра не было, и перенесённый код кэшировал dt прошлого кадра —
    // взгляд отставал на тик и врал на любой смене частоты.
    game::PlayerCommand build_command(Registry& reg, Entity avatar, float dt) const;

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

    // Геймпад. Устройство опрашивается РОВНО ОДИН раз за тик (в `apply`), а
    // не из `build_command`: команда обязана строиться из снятого состояния, а
    // не ходить в железо — иначе будущий GameClient, вызывая build_command
    // сам, читал бы SDL из своего потока.
    SDL_Gamepad* gamepad_ = nullptr;
    game::GamepadAxes gamepadAxes_{};
    float lookSpeed_ = game::kGamepadLookSpeed; // рад/с, вывод в [gamepad.h]

    // Опросить подключённое устройство и нормировать оси. Пусто, если
    // устройства нет — тогда весь слой геймпада даёт строго нулевое намерение.
    game::GamepadAxes poll_gamepad() const;
};

} // namespace giga

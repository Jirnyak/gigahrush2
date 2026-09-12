#include "input/input.h"

#include <SDL3/SDL.h>

#include <algorithm>

#include "ecs/components.h"
#include "game/player_command.h"

namespace giga {

// Открыть ПЕРВЫЙ подключённый геймпад. Первый, а не «все»: аватар один, и
// второй контроллер, молча правящий тем же телом, — это не кооп, а баг.
// Кооп придёт сессиями ([netcode.md]), у каждой своё устройство.
static SDL_Gamepad* open_first_gamepad() {
    int count = 0;
    SDL_JoystickID* ids = SDL_GetGamepads(&count);
    if (!ids) return nullptr;
    SDL_Gamepad* pad = count > 0 ? SDL_OpenGamepad(ids[0]) : nullptr;
    SDL_free(ids);
    return pad;
}

InputState::InputState() : gamepad_(open_first_gamepad()) {}

InputState::~InputState() {
    if (gamepad_) SDL_CloseGamepad(gamepad_);
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
      gamepadAxes_(o.gamepadAxes_),
      lookSpeed_(o.lookSpeed_) {
    o.gamepad_ = nullptr; // владение ушло: чужой деструктор устройство не закроет
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
        gamepadAxes_ = o.gamepadAxes_;
        lookSpeed_ = o.lookSpeed_;
        o.gamepad_ = nullptr;
    }
    return *this;
}

void InputState::handle_event(const SDL_Event& e) {
    switch (e.type) {
    // Горячее подключение. SDL присылает ADDED и на уже воткнутые устройства
    // сразу после SDL_Init, так что конструктор и эта ветка дублируют друг
    // друга сознательно: порядок инициализации приложения на них не влияет.
    case SDL_EVENT_GAMEPAD_ADDED:
        if (!gamepad_) gamepad_ = SDL_OpenGamepad(e.gdevice.which);
        break;
    case SDL_EVENT_GAMEPAD_REMOVED:
        if (gamepad_ && SDL_GetGamepadID(gamepad_) == e.gdevice.which) {
            SDL_CloseGamepad(gamepad_);
            gamepad_ = nullptr;
            gamepadAxes_ = game::GamepadAxes{}; // выдернутый шнур не держит ось
        }
        break;
    // Прыжок — ЭДЖ, ровно как у клавиатуры: кнопка A складывается по ИЛИ с
    // клавишей. Полёт кнопкой НЕ переключается: у клавиатуры его тоже нет
    // (чистка 2026-08-28 сняла дев-строки с клавиш), и заводить на геймпаде
    // то, чего нет на клавиатуре, значит молча отменить то решение.
    case SDL_EVENT_GAMEPAD_BUTTON_DOWN:
        if (mouselook_ && e.gbutton.button == SDL_GAMEPAD_BUTTON_SOUTH)
            jumpEdge_ = true;
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

game::GamepadAxes InputState::poll_gamepad() const {
    game::GamepadAxes ax{};
    if (!gamepad_) return ax;

    // Нормировка Sint16 -> [-1, 1]. Отрицательный предел у оси на единицу
    // шире положительного, поэтому делители РАЗНЫЕ: иначе отклонение до упора
    // влево даёт |v| > 1 и стик врёт ровно на краю, где это заметнее всего.
    auto norm = [](Sint16 raw) {
        return static_cast<float>(raw) / (raw < 0 ? 32768.0f : 32767.0f);
    };
    // Триггер отдаёт только неотрицательную половину диапазона.
    auto trig = [](Sint16 raw) {
        return raw > 0 ? static_cast<float>(raw) / 32767.0f : 0.0f;
    };

    ax.moveX = norm(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFTX));
    ax.moveY = norm(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFTY));
    ax.lookX = norm(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHTX));
    ax.lookY = norm(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHTY));
    ax.triggerL = trig(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_LEFT_TRIGGER));
    ax.triggerR = trig(SDL_GetGamepadAxis(gamepad_, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER));
    ax.ascend = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER) ||
                SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_DPAD_UP);
    ax.descend = SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_LEFT_SHOULDER) ||
                 SDL_GetGamepadButton(gamepad_, SDL_GAMEPAD_BUTTON_DPAD_DOWN);
    return ax;
}

game::PlayerCommand InputState::build_command(Registry& reg, Entity avatar,
                                              float dt) const {
    game::PlayerCommand cmd{};

    // Fly toggle is an edge; the button bit carries it and the server flips the
    // state. But the movement up-axis below depends on the fly state AS OF THIS
    // FRAME (the old code toggled fly first, then read it) — so predict the
    // post-toggle state here for wishDir, exactly reproducing that ordering.
    //
    // БЕЗ гейта на mouselook_ — сознательно. Эдж ставит ровно один путь:
    // консольный запрос `fly` (клавиши по умолчанию у полёта нет). Пока стоял
    // `&& mouselook_`, команда была недостижима по построению: консоль
    // открыта -> mouselook снят -> единственное место, где команду можно
    // НАБРАТЬ, гарантировало, что её эдж будет молча стёрт в apply(). Явный
    // запрос пользователя — не «утечка ввода», которую гейт ловит для осей.
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
    // Геймпад складывается с мышью и клавиатурой, а не подменяет их: держать
    // оба устройства живыми одновременно — единственный способ не заводить
    // «режим геймпада» и не спрашивать игрока, чем он сейчас играет.
    // Считает намерение headless-слой ([game/gamepad.h]) — там же и гейт.
    const game::GamepadIntent pad =
        game::gamepad_fold(gamepadAxes_, willFly, lookSpeed_, dt);

    // Movement intent, camera-local. Scancodes are layout-independent and come
    // from the keybinding table's axis rows ([keybind.h]), not from constants.
    // When mouselook is disabled (e.g. modals, dialogue, trading, looting, crafting,
    // or menus are open), movement intent is strictly zeroed to prevent input bleeding.
    // Гейт один на все устройства: стик и триггер утекают сквозь открытое окно
    // ровно так же, как утекала бы клавиша.
    if (mouselook_) {
        cmd.yaw -= mouseDx_ * sensitivity_ + pad.yawDelta;
        cmd.pitch -= mouseDy_ * sensitivity_ + pad.pitchDelta;

        const bool* ks = SDL_GetKeyboardState(nullptr);
        float fwd = pad.wishDir.x, right = pad.wishDir.y, up = pad.wishDir.z;
        if (ks[binds_.fwd]) fwd += 1.0f;
        if (ks[binds_.back]) fwd -= 1.0f;
        if (ks[binds_.right]) right += 1.0f;
        if (ks[binds_.left]) right -= 1.0f;
        if (willFly) {
            if (ks[binds_.up] || ks[binds_.jump]) up += 1.0f;
            if (ks[binds_.down] || ks[binds_.downAlt]) up -= 1.0f;
        }
        // Кламп нужен ровно из-за сложения устройств: W вместе со стиком
        // вперёд иначе дают 2.0 и удваивают скорость. Контракт wishDir —
        // каждая ось в [-1, 1] ([player_command.h]).
        cmd.wishDir = vec3{std::clamp(fwd, -1.0f, 1.0f),
                           std::clamp(right, -1.0f, 1.0f),
                           std::clamp(up, -1.0f, 1.0f)};

        // Jump edge (walk mode only; fly uses wishDir.z). The server re-checks the
        // fly guard, so sending the bit unconditionally is safe and keeps the client
        // dumb — it proposes, the server disposes.
        if (jumpEdge_) cmd.buttons |= game::bit(game::Button::Jump);
    }

    return cmd;
}

void InputState::apply(Registry& reg, float dt) {
    // Устройство опрашивается РОВНО ЗДЕСЬ, один раз за тик: дальше по кадру
    // и команда, и руки читают снятое состояние, а не железо.
    gamepadAxes_ = poll_gamepad();

    // Select the avatar: the first entity that owns both a camera and a
    // controller. This is the "player is whoever holds CameraTag + Controller"
    // rule; the future GameClient will instead pass its session's owned entity.
    Entity avatar = entt::null;
    auto view = reg.view<CameraTag, Controller>();
    for (auto ent : view) { avatar = ent; break; }

    if (avatar != entt::null) {
        game::PlayerCommand cmd = build_command(reg, avatar, dt);
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

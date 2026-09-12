// Геймпад — headless-слой ([game/gamepad.h]). Включается в game_test.cpp,
// пользуется его CHECK и `using namespace giga::game`.
//
// СМЫСЛ ГЕЙТА. SDL-мост (src/input) в тесты не линкуется, поэтому вся
// арифметика геймпада вынесена в giga_game и пинится здесь. Четыре места, где
// ошибиться легко и заметно только руками на живом устройстве: мёртвая зона,
// знаки осей, вывод угловой скорости и раскладка триггеров по рукам. Каждое
// проверяется В ОБЕ ПОЛЯРНОСТИ: не только «срабатывает, когда надо», но и «не
// срабатывает, когда не надо» — вторая половина и есть та, что ловит чужую
// правку.

#include "game/gamepad.h"

// Шаг сим-тика ([core/tick.h]) — взгляд считается СКОРОСТЬЮ, и dt обязан быть
// тиковым, а не выдуманным 1/60: сим у нас 125 Гц.
#include "core/tick.h"

static void test_gamepad_deadzone_is_renormalised() {
    // Внутри мёртвой зоны — СТРОГО ноль, с обеих сторон. Дрейф центра не
    // обязан толкать тело.
    CHECK(gamepad_deadzone(0.0f, kStickDeadzone) == 0.0f);
    CHECK(gamepad_deadzone(kStickDeadzone * 0.5f, kStickDeadzone) == 0.0f);
    CHECK(gamepad_deadzone(-kStickDeadzone * 0.5f, kStickDeadzone) == 0.0f);
    CHECK(gamepad_deadzone(kStickDeadzone, kStickDeadzone) == 0.0f);
    CHECK(gamepad_deadzone(-kStickDeadzone, kStickDeadzone) == 0.0f);

    // На упоре — ровно ±1, без недобора: иначе на полном стике тело идёт
    // медленнее, чем от клавиши.
    CHECK(std::fabs(gamepad_deadzone(1.0f, kStickDeadzone) - 1.0f) < 1e-5f);
    CHECK(std::fabs(gamepad_deadzone(-1.0f, kStickDeadzone) + 1.0f) < 1e-5f);
    // Перелёт за предел (нормировка Sint16 даёт ровно −1.0, но запас держим)
    // тоже обрезается, а не выносит wishDir за контракт [-1,1].
    CHECK(gamepad_deadzone(1.4f, kStickDeadzone) == 1.0f);
    CHECK(gamepad_deadzone(-1.4f, kStickDeadzone) == -1.0f);

    // ПЕРЕНОРМИРОВКА, ради которой всё и писалось: сразу за порогом выход
    // растёт С НУЛЯ, а не прыгает на величину зоны. Обратная полярность к
    // «наивной» отсечке `if (|v|<=dz) 0 else v`, которая дала бы здесь 0.16.
    const float justOver = gamepad_deadzone(kStickDeadzone + 0.01f, kStickDeadzone);
    CHECK(justOver > 0.0f);
    CHECK(justOver < 0.02f);

    // Середина рабочего хода ложится ровно в середину выхода — линейность.
    const float mid = gamepad_deadzone((1.0f + kStickDeadzone) * 0.5f, kStickDeadzone);
    CHECK(std::fabs(mid - 0.5f) < 1e-5f);
}

static void test_gamepad_no_device_is_silent() {
    // Нет устройства — мост отдаёт пустые оси. Намерение обязано быть
    // СТРОГО нулевым: ни движения, ни поворота, ни рук. Это та проверка,
    // которая ловит «геймпад чуть-чуть ведёт тело у всех, у кого его нет».
    const GamepadAxes idle{};
    const GamepadIntent it = gamepad_fold(idle, /*fly=*/true, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.x == 0.0f);
    CHECK(it.wishDir.y == 0.0f);
    CHECK(it.wishDir.z == 0.0f);
    CHECK(it.yawDelta == 0.0f);
    CHECK(it.pitchDelta == 0.0f);
    CHECK(!it.handL);
    CHECK(!it.handR);
}

static void test_gamepad_stick_signs_match_the_keyboard() {
    // ВПЕРЁД. Железо отдаёт «вверх по стику» ОТРИЦАТЕЛЬНЫМ — перепутанный знак
    // здесь даёт игру, в которой стик вперёд идёт назад.
    GamepadAxes ax{};
    ax.moveY = -1.0f;
    GamepadIntent it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.x > 0.9f);   // wishDir.x — «вперёд» ([player_command.h])
    CHECK(it.wishDir.y == 0.0f);

    // Обратная полярность: стик на себя — назад.
    ax.moveY = 1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.x < -0.9f);

    // ВПРАВО и его обратная полярность.
    ax = GamepadAxes{};
    ax.moveX = 1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.y > 0.9f);
    CHECK(it.wishDir.x == 0.0f);
    ax.moveX = -1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.y < -0.9f);

    // Каждая ось держится в контракте [-1,1] и на диагонали.
    ax.moveX = 1.0f;
    ax.moveY = -1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.x <= 1.0f && it.wishDir.y <= 1.0f);
}

static void test_gamepad_look_is_a_rate_and_matches_the_mouse_sign() {
    // Знак МЫШИНЫЙ: в build_command дельта ВЫЧИТАЕТСЯ из yaw, значит стик
    // вправо обязан дать ПОЛОЖИТЕЛЬНУЮ дельту (yaw уменьшится = поворот
    // вправо). Перепутанный знак — инвертированный взгляд, который игрок
    // почувствует, а тест обязан поймать раньше.
    GamepadAxes ax{};
    ax.lookX = 1.0f;
    GamepadIntent it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.yawDelta > 0.0f);
    CHECK(it.pitchDelta == 0.0f);
    ax.lookX = -1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.yawDelta < 0.0f);

    // Стик ВНИЗ (у железа это +Y) обязан опускать взгляд: дельта
    // положительная, pitch после вычитания уменьшается.
    ax = GamepadAxes{};
    ax.lookY = 1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.pitchDelta > 0.0f);
    ax.lookY = -1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.pitchDelta < 0.0f);

    // ЭТО СКОРОСТЬ, А НЕ ДЕЛЬТА: вдвое больший шаг даёт вдвое больший угол.
    // Пин против возврата закэшированного «1/60» — при нём поворот менялся бы
    // от частоты кадров, а не от времени.
    ax = GamepadAxes{};
    ax.lookX = 1.0f;
    const float a1 = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt).yawDelta;
    const float a2 = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt * 2.0f).yawDelta;
    CHECK(std::fabs(a2 - a1 * 2.0f) < 1e-6f);
    // На упоре за секунду набегает ровно паспортная угловая скорость.
    const float perSec = gamepad_fold(ax, false, kGamepadLookSpeed, 1.0f).yawDelta;
    CHECK(std::fabs(perSec - kGamepadLookSpeed) < 1e-5f);
}

static void test_gamepad_look_speed_is_derived_not_assigned() {
    // ПИН ВЫВОДА, а не числа: ω = v / r, где v — дефолтная скорость ходьбы
    // ([ecs/components.h] Controller::moveSpeed), r — клетка ([world/types.h]
    // kCellSize). Если кто-то впишет сюда «красивое» число руками, эта строка
    // покраснеет; если поедет скорость ходьбы или размер клетки — поедет и
    // взгляд, сам, и строка останется зелёной. Ровно этого требует закон S11.
    CHECK(std::fabs(kGamepadLookSpeed * kCellSize - kRefWalkSpeed) < 1e-6f);
    CHECK(std::fabs(kRefWalkSpeed - giga::Controller{}.moveSpeed) < 1e-6f);
    // Здравый диапазон: медленнее полуоборота в секунду взгляд не годится для
    // боя, быстрее двух оборотов — для прицеливания.
    CHECK(kGamepadLookSpeed > 1.5f && kGamepadLookSpeed < 12.6f);
}

static void test_gamepad_triggers_are_two_separate_hands() {
    // РУКИ РАЗДЕЛЬНЫ ([two-hands.md]). Левый триггер поднимает ЛЕВУЮ руку и
    // НЕ поднимает правую — обратная полярность здесь и есть весь смысл
    // проверки: склейка двух рук в одну кнопку прошла бы «положительный»
    // тест и тихо откатила эпик.
    GamepadAxes ax{};
    ax.triggerL = 1.0f;
    GamepadIntent it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.handL);
    CHECK(!it.handR);

    ax = GamepadAxes{};
    ax.triggerR = 1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.handR);
    CHECK(!it.handL);

    // Обе сразу — обе руки. Пара рук работает парой, а не по очереди.
    ax.triggerL = 1.0f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(it.handL && it.handR);

    // Ниже щелчка — НИ ОДНОЙ: палец, лежащий на триггере, не машет кулаком.
    ax.triggerL = kTriggerThreshold;
    ax.triggerR = kTriggerThreshold * 0.5f;
    it = gamepad_fold(ax, false, kGamepadLookSpeed, kSimDt);
    CHECK(!it.handL);
    CHECK(!it.handR);

    // Триггеры в движение и взгляд НЕ лезут — только руки.
    CHECK(it.wishDir.x == 0.0f && it.wishDir.y == 0.0f && it.wishDir.z == 0.0f);
    CHECK(it.yawDelta == 0.0f && it.pitchDelta == 0.0f);
}

static void test_gamepad_vertical_only_in_flight() {
    // Вертикаль — ТОЛЬКО в полёте. Пешком wishDir.z занят прыжком, и бампер,
    // тихо поднимающий тело по ходьбе, — это левитация без единой ошибки в
    // логе.
    GamepadAxes ax{};
    ax.ascend = true;
    GamepadIntent it = gamepad_fold(ax, /*fly=*/false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.z == 0.0f);
    it = gamepad_fold(ax, /*fly=*/true, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.z > 0.9f);

    ax.ascend = false;
    ax.descend = true;
    it = gamepad_fold(ax, /*fly=*/false, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.z == 0.0f);
    it = gamepad_fold(ax, /*fly=*/true, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.z < -0.9f);

    // Оба разом гасят друг друга, а не складываются в мусор.
    ax.ascend = true;
    it = gamepad_fold(ax, /*fly=*/true, kGamepadLookSpeed, kSimDt);
    CHECK(it.wishDir.z == 0.0f);
}

static void test_gamepad_all() {
    test_gamepad_deadzone_is_renormalised();
    test_gamepad_no_device_is_silent();
    test_gamepad_stick_signs_match_the_keyboard();
    test_gamepad_look_is_a_rate_and_matches_the_mouse_sign();
    test_gamepad_look_speed_is_derived_not_assigned();
    test_gamepad_triggers_are_two_separate_hands();
    test_gamepad_vertical_only_in_flight();
}

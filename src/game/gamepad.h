// Геймпад — устройство-независимый слой (headless, без SDL).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СЛОЙ. SDL живёт в `src/input`, который в тесты не линкуется
// (giga_core/giga_game обязаны быть чисты от платформы — AGENTS.md), поэтому
// всё, что написано внутри `input.cpp`, проверить нечем. А ошибиться в
// геймпаде можно ровно в четырёх местах, и все они — арифметика: мёртвая
// зона, знаки осей, перевод стика в угловую скорость и раскладка триггеров по
// рукам. Эта арифметика вынесена СЮДА и потому пинится game_test'ом без окна —
// тот же приём, что у `apply_player_command` ([player_command.h]): клиент
// снимает устройство, headless-слой считает намерение.
//
// Мост `src/input/input.cpp` после этого делает ровно одно: заполняет
// `GamepadAxes` из SDL и складывает результат `gamepad_fold` в PlayerCommand.
#pragma once

#include "core/math.h"
#include "ecs/components.h"
#include "world/types.h"

namespace giga::game {

// Мёртвая зона стика в долях полного отклонения.
//
// ВЫВОД: не «на глаз», а по паспорту железа. Дрейф центра у стика на эффекте
// Холла и у потенциометрического одинаково нормируется производителями в
// пределах ~10% хода; SDL для той же цели держит собственный порог
// SDL_GAMEPAD_AXIS_MAX/10. Берём 0.15 — на половину шага выше паспортного
// дрейфа, чтобы изношенный стик не толкал тело в стену при отпущенном пальце,
// и заметно ниже 0.25, с которого уже теряется медленная доводка прицела.
inline constexpr float kStickDeadzone = 0.15f;

// Порог триггера, выше которого рука считается зажатой.
//
// ВЫВОД: у аналогового триггера ход делится на «ход вхолостую» и рабочий ход;
// щелчок (break point) у геймпадов лежит около четверти хода. Ставим ровно
// туда: рука замахивается там же, где палец чувствует упор, а не раньше.
inline constexpr float kTriggerThreshold = 0.25f;

// Опорная скорость ходьбы, м/с — дефолт `Controller` ([ecs/components.h]).
// Берётся ДЕФОЛТ, а не живое поле тела: перегруз и жажда скорость режут
// ([encumbrance.h], [needs.h]), но взгляд от этого замедляться не обязан —
// голова не несёт рюкзак.
inline constexpr float kRefWalkSpeed = 6.0f;
static_assert(kRefWalkSpeed == Controller{}.moveSpeed,
              "опора съехала: kRefWalkSpeed обязан совпадать с дефолтом "
              "Controller::moveSpeed — вывод kGamepadLookSpeed стоит на нём");

// Угловая скорость взгляда на упоре стика, рад/с.
//
// ВЫВОД: ω = v / r. Взгляд обязан удерживать точку, мимо которой тело идёт по
// касательной на полной скорости на дистанции одной клетки — ближе тела ничего
// не бывает, клетка и есть минимальный радиус обхода ([world/types.h]
// kCellSize = 2 м). Отсюда 6 / 2 = 3 рад/с: полный оборот за 2.1 с, поворот
// кругом за 1.05 с. Замедлится ходьба или укрупнится клетка — число поедет
// само, руками его трогать нельзя.
inline constexpr float kGamepadLookSpeed = kRefWalkSpeed / kCellSize;

// Снятое за кадр состояние устройства, уже нормированное мостом.
// Знаки осей — КАК ОТДАЁТ ЖЕЛЕЗО (у SDL «вверх» по стику отрицателен); разворот
// в мировое намерение — работа `gamepad_fold`, и она же проверяется тестом.
struct GamepadAxes {
    float moveX = 0.0f;    // левый стик: + вправо,  [-1, 1]
    float moveY = 0.0f;    // левый стик: + ВНИЗ,    [-1, 1]
    float lookX = 0.0f;    // правый стик: + вправо, [-1, 1]
    float lookY = 0.0f;    // правый стик: + ВНИЗ,   [-1, 1]
    float triggerL = 0.0f; // левый триггер,  [0, 1]
    float triggerR = 0.0f; // правый триггер, [0, 1]
    bool ascend = false;   // вертикаль полёта вверх (RB / крестовина вверх)
    bool descend = false;  // вертикаль полёта вниз  (LB / крестовина вниз)
};

// Намерение, снятое с осей за один тик.
struct GamepadIntent {
    vec3 wishDir{0, 0, 0};   // вклад в движение (вперёд, вправо, вверх), каждый [-1, 1]
    float yawDelta = 0.0f;   // радианы за тик, знак МЫШИНЫЙ: вычитается из yaw
    float pitchDelta = 0.0f; // то же для pitch
    bool handL = false;      // левый триггер  -> ЛЕВАЯ рука  (ЛКМ, [two-hands.md])
    bool handR = false;      // правый триггер -> ПРАВАЯ рука (ПКМ)
};

// Мёртвая зона с ПЕРЕНОРМИРОВКОЙ остатка: на границе выход строго ноль и
// дальше растёт с нуля, а не прыжком на `deadzone`. Без перенормировки палец,
// переваливший порог, дёргает тело — классический дефект «стик-ступенька».
constexpr float gamepad_deadzone(float v, float deadzone) {
    const float a = v < 0.0f ? -v : v;
    if (a <= deadzone) return 0.0f;
    const float span = 1.0f - deadzone;
    const float out = (a - deadzone) / (span > 1e-6f ? span : 1e-6f);
    const float clamped = out > 1.0f ? 1.0f : out;
    return v < 0.0f ? -clamped : clamped;
}

// Оси -> намерение. `fly` — состояние полёта НА ЭТОТ ТИК (после возможного
// тоггла), `dt` — шаг тика; взгляд от геймпада есть СКОРОСТЬ и без dt не
// существует, в отличие от мышиной дельты, которая уже накоплена за кадр.
inline GamepadIntent gamepad_fold(const GamepadAxes& ax, bool fly,
                                  float lookSpeed, float dt) {
    GamepadIntent out;

    const float lx = gamepad_deadzone(ax.moveX, kStickDeadzone);
    const float ly = gamepad_deadzone(ax.moveY, kStickDeadzone);
    const float rx = gamepad_deadzone(ax.lookX, kStickDeadzone);
    const float ry = gamepad_deadzone(ax.lookY, kStickDeadzone);

    // Левый стик: движение. Ось Y железа смотрит ВНИЗ, «вперёд» — это -Y.
    out.wishDir.x = -ly;
    out.wishDir.y = lx;

    // Вертикаль — ТОЛЬКО в полёте: пешком её съедает `wishDir.z`, там прыжок
    // ходит отдельной кнопкой ([player_command.h] Button::Jump).
    if (fly) {
        if (ax.ascend) out.wishDir.z += 1.0f;
        if (ax.descend) out.wishDir.z -= 1.0f;
    }

    // Правый стик: взгляд. Знак — мышиный (в build_command дельта ВЫЧИТАЕТСЯ),
    // поэтому стик вправо даёт положительную дельту и уменьшает yaw, а стик
    // вверх (ry < 0) поднимает взгляд. Клампит pitch сервер, не мы.
    out.yawDelta = rx * lookSpeed * dt;
    out.pitchDelta = ry * lookSpeed * dt;

    // Триггеры -> РУКИ, раздельно ([two-hands.md]). Одна кнопка на обе руки —
    // это откат эпика двух рук, поэтому левый идёт в левую, правый в правую и
    // зажать можно обе сразу.
    out.handL = ax.triggerL > kTriggerThreshold;
    out.handR = ax.triggerR > kTriggerThreshold;

    return out;
}

} // namespace giga::game

// Controller system: turns input intent (Controller::wishDir, expressed in the
// camera's local frame) into world-space velocity.
//
// Walk mode (fly == false): the wish drives the velocity component PERPENDICULAR
// to gravity; the physics system owns the component along it (gravity + jump).
// Fly mode: full 6DoF, wish drives all three axes and gravity is ignored by
// leaving it off the entity. This is the same system whether it steers the
// player, an NPC given a Controller, or a debug free-cam.
#pragma once

#include "ecs/registry.h"
#include "world/gravity.h"

namespace giga {

// ЕСТЬ ЛИ У ВВОДА НАМЕРЕНИЕ ДВИГАТЬСЯ: длина `Controller::wishDir`, ниже которой
// `controller_step` намерение не нормирует, то есть тело стоит. Один дом числа:
// его же спрашивает дверь утоления — деяние человека рвётся, когда он ПОШЁЛ
// ([game/serve.h], закон 5), и порог обязан быть тем же, что у самого хода,
// иначе деяние рвалось бы стоящему или не рвалось идущему. Дрожь стика сюда не
// доходит: мёртвая зона геймпада отдаёт точный ноль ([game/gamepad.h]).
inline constexpr float kWishMinLen = 1e-4f;

// Optional `gravity`: names which axis is vertical, so "walk" means the plane
// perpendicular to the pull rather than the XY plane. Null keeps the Z-up frame,
// which is correct under the shipping NegZ regime and wrong under every other.
void controller_step(Registry& reg, float dt,
                     const GravityField* gravity = nullptr);

} // namespace giga

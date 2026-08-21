// Импульсный твердотел — интегратор рагдолл-ядра ([markoaudit/plans/ragdoll.md]).
//
// Одна универсальная модель на все CPU-пропы (решение владельца 2026-08-21):
// полуявный Эйлер + контакт сфера↔субвоксель + sequential impulse с отскоком и
// трением Кулона через точку контакта — качение ВОЗНИКАЕТ из трения (контактная
// точка тормозится, тело раскручивается), а не назначается косметикой.
//
// Масштаб — тысячи тел на активном этаже; главный механизм — сон: тихое тело
// засыпает и стоит ноль, будится записью Velocity извне (взрыв, толчок).
//
// Живёт в ЯДРЕ (src/sim) по той же причине, что physics_step: game-слой
// спавнит и выводит параметры из таблиц, ядро таблиц не знает.
#pragma once

#include "ecs/registry.h"
#include "world/level_stack.h"

namespace giga {

// Advance every awake RigidBody + Transform + Velocity by dt against its layer.
void rigid_body_step(Registry& reg, LevelStack& stack, float dt);

} // namespace giga

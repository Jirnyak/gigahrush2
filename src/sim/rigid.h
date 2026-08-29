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

#include <cmath> // sqrt — комбинация материальной пары

#include "core/math.h"
#include "ecs/components.h" // ContactForm
#include "ecs/registry.h"
#include "world/level_stack.h"

namespace giga {

// Advance every awake RigidBody + Transform + Velocity by dt against its layer.
void rigid_body_step(Registry& reg, LevelStack& stack, float dt);

// ДОЛГ ПИСАТЕЛЯ ГЕОМЕТРИИ (CANON S20.4): спящее тело не проверяет опору —
// его будит тот, кто опору изменил. Без этого труп/ведро/граната, уснувшие
// на плите, зависают в воздухе после её выкарвивания: единственный прочий
// путь пробуждения — запись Velocity извне. Будит спящие тела слоя, чья
// клетка в ±1 от dirty-клеток (тело ≤ клетки опирается на атомы своей или
// смежной клетки). Возвращает число разбуженных.
std::uint32_t rigid_wake_dirty_cells(Registry& reg, LayerId layer,
                                     const std::uint32_t* cells,
                                     std::size_t n);

// Раскладка БОКСА в контактные сферы (фундамент формы: словарь автора — сфера
// и бокс, словарь солвера — только сфера). Радиус выведен, не назначен:
// r = min(half)/2 — сферы сидят внутри бокса заподлицо с гранями, рёбра
// скруглены этим радиусом. 8 углов дают момент и кувырок, 6 центров граней
// держат плоское лежание. Возвращает радиус ограничивающей сферы —
// вызывающий кладёт его в RigidBody.radius (брод-фаза).
float form_from_box(vec3 half, ContactForm& out);

// Сборка твердотела на сущности — ОДИН код на все сайты (стенды консоли,
// детач пропа, труп, загрузка сейва; S11: вторая сборка — дефект). Масса и
// контактные параметры приходят от каллера: game выводит их из таблиц
// (плотность × объём, шкалы от hardness), ядро таблиц не знает. Вешает
// SelfIntegrating — без него physics_step двигал бы тело вторым разом.
void rigid_attach_sphere(Registry& reg, Entity e, float radius, float massKg,
                         float restitution, float friction);
void rigid_attach_box(Registry& reg, Entity e, vec3 half, float massKg,
                      float restitution, float friction);

// Шкалы контактных параметров от твёрдости материала (якорь: бетон = 256).
// Тверже — упруже; тверже — глаже (полированное скользит). Числа крутятся
// глазами владельца — метод эпика.
inline float restitution_from_hardness(float h) {
    return h < 0.0f ? 0.0f : (h > 460.8f ? 0.9f : h / 512.0f);
}
inline float friction_from_hardness(float h) {
    const float mu = 1.0f - h / 1024.0f;
    return mu < 0.2f ? 0.2f : (mu > 0.9f ? 0.9f : mu);
}

// МАТЕРИАЛЬНАЯ ПАРА (инкремент 7): отскок и трение — свойства ПАРЫ, не тела.
// Тело несёт числа СВОЕГО материала (выведены при сборке), контакт сводит их
// с материалом второй стороны — субвокселя под контактом, второго пропа,
// плоти агента. Геометрическое среднее — стандартная аппроксимация
// (Box2D/Bullet): мягкая сторона глушит пару, ноль одной стороны — ноль пары.
inline float pair_restitution(float a, float b) { return std::sqrt(a * b); }
inline float pair_friction(float a, float b) { return std::sqrt(a * b); }

} // namespace giga

// ВЗГЛЯД ТЕЛА — направление, в которое смотрит ЛЮБОЕ тело.
//
// ЗАКОН ВЛАДЕЛЬЦА (CANON S25.7, дословно): «это плохо, это насрал… надо
// почистить, обобщить, потому что ИГРОК НИЧЕМ НЕ ОСОБЕН». До этого файла
// направление взгляда в движке существовало РОВНО У ОДНОГО тела: поле
// `CameraTag::yaw/pitch` ([ecs/components.h]), и оба потребителя конуса
// (`frozen_by_gaze` — заморозка Скульптуры, `facing_damage_mult` — удар в
// спину) спрашивали «смотрит ли ЧЕЛОВЕК», каждый своей копией `cos/sin(yaw)`
// (`wander.cpp`, `combat.cpp`). Для тела без камеры вопрос был НЕВЫРАЗИМ: у
// жителя и моба нет ни кватерниона, ни yaw — только `Transform{pos,layer}` и
// `Velocity{v}`.
//
// ПОЧЕМУ ПОЛЕ, А НЕ ВЫВОД ИЗ СКОРОСТИ. Замер прибором восприятия
// (`--action zrenie`, 2026-11-09): на этаже 6 СТОЯТ 88 % жителей, на падике —
// 100 % мобов. Вывод «тело смотрит туда, куда идёт» не покрывает их вовсе, а
// конус с нулевым направлением даёт `dot = 0 < cos45°`, то есть ПОЛНУЮ
// СЛЕПОТУ большинства толпы. Поэтому направление — величина с памятью:
// стоящее тело держит последнее направление хода.
//
// ОДИН ПИСАТЕЛЬ, И ЭТО НЕ ВЕДЕНИЕ. Первым кандидатом был `guide_step` («кто
// ведёт тело, тот знает, куда оно смотрит»), и субагент-ревизор его опроверг
// ДО посадки: вид ведения — `view<const Steer, const Transform, Velocity>`, то
// есть тело БЕЗ живой заявки в этот тик проход не посещает (а стоящих 88 %), и
// носителя камеры он отсекает ПЕРВЫМ (`Decider::Human → ++foreign`), поэтому
// взгляд игрока в нём невыразим по построению. Писатель здесь — свой проход по
// ВСЕМ телам с тождеством; источник выбирается по РЕШАТЕЛЮ (S13.7a), а не
// ветвлением «если это игрок».
#pragma once

#include <cmath>
#include <cstdint>

#include "core/row_law.h"
#include "core/rng.h"  // hash_u32 — детерминированный взгляд новорождённого
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"     // NpcRef — тождество жителя
#include "game/guide.h"      // kWalkSpeedMps, steer_tangent — плоскость ходьбы
#include "game/mob_spawn.h"  // MobRef — тождество монстра
#include "sim/camera.h"   // camera_forward — ЕДИНСТВЕННАЯ формула взгляда камеры
#include "world/gravity.h"
#include "world/level_stack.h"

namespace giga::game {

// Порог «тело идёт, значит его взгляд сдвинулся» — процент пешей скорости
// (`kWalkSpeedMps`, единственный дом числа 1.35 — [game/guide.h]). Ниже него
// тело стоит, и взгляд ОСТАЁТСЯ прежним: это и есть память направления.
inline constexpr float kLookMovingFrac = 0.01f;

// Направление взгляда, единичный вектор в мировых осях. НЕ угол: угол потребовал
// бы знать, вокруг какой оси его мерить, а «вверх» в этом дереве решает режим
// гравитации ([world/gravity.h]) и он не один.
struct Look {
    vec3 dir{1.0f, 0.0f, 0.0f};
};

// Взгляд новорождённого тела — из ТОЖДЕСТВА, а не из нуля и не из +X для всех.
// Ноль был бы слепотой (dot == 0), а общий +X — молчаливой анизотропией: вся
// толпа смотрела бы в одну сторону, и засада со спины работала бы только с
// одного румба. Хеш даёт детерминированный румб в плоскости ходьбы.
// Румб строится В ОСЯХ ФРЕЙМА, а не в мировых x/y с последующей проекцией:
// проекция круга x/y под боковой гравитацией (`GravityRegime::PosX`) даёт
// ОТРЕЗОК, то есть неединичный вектор, а при угле около нуля — НУЛЕВОЙ, и
// новорождённое тело рождалось бы слепым. Поймано гейтом нового сьюта.
inline vec3 look_birth_dir(const GravityFrame& gf, std::uint32_t seed) {
    const float a = static_cast<float>(hash_u32(seed) & 0xFFFFu) *
                    (6.2831853f / 65536.0f);
    const float ca = std::cos(a), sa = std::sin(a);
    vec3 d{0.0f, 0.0f, 0.0f};
    float* comp[3] = {&d.x, &d.y, &d.z};
    *comp[gf.tanA] = ca;
    *comp[gf.tanB] = sa;
    return d;
}

// Телеметрия прохода — та же форма, что у `GuideTick`: счётчики существуют,
// чтобы «взгляд написан» не было заявлением.
struct LookTick {
    std::uint32_t bodies = 0;  // тел с тождеством на слое
    std::uint32_t born = 0;    // получили взгляд впервые
    std::uint32_t moved = 0;   // взгляд сдвинут ходом
    std::uint32_t held = 0;    // стоят — держат прежний
    std::uint32_t human = 0;   // взгляд из камеры
};

// ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ ВЗГЛЯДА. Стоит в кадре ПОСЛЕ ведения (скорость этого
// тика уже написана) и до восприятия следующего тика: взгляд отстаёт на тик, и
// это марковски честно — величина выводится из состояния, а не из истории.
inline LookTick look_step(Registry& reg, LayerId layer, const GravityFrame& gf) {
    LookTick out{};
    for (auto e : reg.view<const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // Тождество — то же, что у прибора ведения: проп, обломок и снаряд
        // взгляда не имеют, потому что не смотрят.
        const bool human = reg.all_of<CameraTag>(e);
        if (!human && !reg.all_of<NpcRef>(e) && !reg.all_of<MobRef>(e)) continue;
        ++out.bodies;
        Look* look = reg.try_get<Look>(e);
        if (look == nullptr) {
            reg.emplace<Look>(
                e, Look{look_birth_dir(gf, static_cast<std::uint32_t>(
                                               entt::to_integral(e)))});
            ++out.born;
            look = reg.try_get<Look>(e);
            if (look == nullptr) continue;
        }
        if (human) {
            // Решатель `Human` — не исключение, а ВЕТКА: у этого тела есть
            // собственный источник направления, и он старше хода (игрок
            // смотрит, не поворачиваясь телом). Формула одна на движок.
            const CameraTag& cam = reg.get<const CameraTag>(e);
            look->dir = camera_forward(cam.yaw, cam.pitch);
            ++out.human;
            continue;
        }
        const Velocity* vel = reg.try_get<Velocity>(e);
        if (vel == nullptr) { ++out.held; continue; }
        const vec3 tan = steer_tangent(gf, vel->v.x, vel->v.y, vel->v.z);
        const float len = std::sqrt(tan.x * tan.x + tan.y * tan.y +
                                    tan.z * tan.z);
        if (len < kWalkSpeedMps * kLookMovingFrac) { ++out.held; continue; }
        look->dir = vec3{tan.x / len, tan.y / len, tan.z / len};
        ++out.moved;
    }
    return out;
}

// «Тело A смотрит на тело B» — ОДИН примитив над направлением взгляда ЛЮБОГО
// тела, вместо двух копий вопроса «смотрит ли человек». `cosHalf` приходит
// данными: у заморозки это cos45°, у удара в спину — свой порог, и оба
// по-прежнему живут в [game/mob_behaviour.h] как числа поведения.
//
// Пеленг БЕРЁТСЯ ГОТОВЫМ (уже свёрнутым по тору вызывающим): wrap живёт в одном
// месте, и примитив не должен знать про период мира.
inline bool looking_at(const vec3& fwd, float dx, float dy, float dz,
                       float cosHalf) {
    const float d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-6f) return true;  // стою внутри — тот же закон, что у заморозки
    const float f2 = fwd.x * fwd.x + fwd.y * fwd.y + fwd.z * fwd.z;
    if (f2 < 1e-6f) return false;  // взгляда нет — не смотрит
    return (dx * fwd.x + dy * fwd.y + dz * fwd.z) /
               (std::sqrt(d2) * std::sqrt(f2)) >=
           cosHalf;
}

} // namespace giga::game

GIGA_ROW(giga::game::Look);
GIGA_ROW_BYTES(giga::game::Look, 12);

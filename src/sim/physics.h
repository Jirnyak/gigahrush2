// Physics: vector gravity, jump, and swept-AABB collision against the macro
// grid's sub-voxel masks.
//
// The system iterates entities with Transform + Velocity and integrates them
// against the world they live on (via Transform::layer). Collision resolves one
// axis at a time (classic Quake-style sweep) so an entity slides along walls
// and lands cleanly on sub-voxel surfaces. All tunables live on the components
// (AABB half-extents, Jump impulse, GravityAffected scale) — nothing is baked
// into the solver.
#pragma once

#include "ecs/registry.h"
#include "core/tick.h" // kSimDt — кап подшага выведен, не назначен
#include "world/level_stack.h"

namespace giga {

struct PhysicsParams {
    // Substeps keep fast movers from tunneling through thin sub-voxel walls.
    int maxSubsteps = 4;
    // Кап секунд на подшаг = kSimDt (аудит 2026-08-25, К1-14). Прежний
    // литерал 1/120 держался 17-строчным комментарием про «четыре тестовых
    // сайта с dt 1/120», которых в дереве уже НЕТ (tests зовут kSimDt —
    // проза пережила собственную причину и мимикрировала под решение).
    // На живом рейте кап инертен: тик kSimDt == капу, ceil даёт 1 подшаг.
    float maxStep = kSimDt;
};

// Advance all dynamic entities by dt seconds against their layers.
void physics_step(Registry& reg, LevelStack& stack, float dt,
                  const PhysicsParams& params = {});

// True if the AABB centered at `pos` overlaps any solid sub-voxel in `world`.
// Exposed for tests and for gameplay queries (line-of-fire, placement checks).
bool aabb_overlaps_solid(const class World& world, vec3 pos, vec3 half);

// ---------------------------------------------------------------------------
// СТОИТ ЛИ ТЕЛО ЗДЕСЬ — ОДИН ОТВЕТ, НА АТОМАХ, В СИСТЕМЕ ГРАВИТАЦИИ ЭТАЖА
// ---------------------------------------------------------------------------
// До 2026-11-12 на этот вопрос в дереве отвечали семь мест, и два из них
// ставили тела: `floor_standable` (ТИП клетки — врёт в обе стороны там, где
// перегородка есть полоса субвокселей внутри своей клетки, CANON S23 п.5) и
// `probe_cell` расстановки (атомы, но «низ» зашит буквой −Z, а опора НЕ
// требовалась — отсюда 366 тел из 378, рождённых в небе открытой геометрии).
// Здесь — предикат, которым судит сам солвер (`aabb_overlaps_solid`), с осью
// из ФРЕЙМА (`regime_down`): изотропия не знает слова «Z».
//
//   fits      — габарит тела в `centre` свободен от тверди;
//   supported — под подошвой, в плите толщиной в один субвоксель и шириной в
//               тело, есть твердь. У фрейма без низа (Zero/Custom) падать
//               некуда, и вопрос об опоре не задаётся: `supported` истинно.
//
// «Подошва» — грань габарита со стороны низа фрейма. Рост тела сегодня лежит
// по Z у всех (`AABB{w, w, h}`), и предикат этого НЕ исправляет и не прячет:
// он берёт полуразмер вдоль оси низа, какой есть.
struct StandProbe {
    bool fits = false;
    bool supported = false;
};
StandProbe stand_probe(const class World& world, vec3 centre, vec3 half);

// ЗАЗОР КОНТАКТА — скин, на который солвер приподнимает тело над поверхностью,
// чтобы повторный свип прошёл её верх ([physics.cpp] kStepRise = атом + скин).
// Он же — зазор РОЖДЕНИЯ: тело, поставленное подошвой ровно на границу
// субвокселя, из-за округления float может оказаться в тверди на волос, а
// тело в тверди не двигается больше никогда (свип ищет выход из перекрытия и
// не находит). Один дом у числа: расстановка берёт его отсюда.
inline constexpr float kContactSkin = 0.01f;

// Центр тела габарита `half`, СТОЯЩЕГО ПОДОШВОЙ В ТОЧКЕ `foot` (точка лежит на
// поверхности опоры): полуразмер вдоль оси низа плюс зазор контакта — против
// гравитации. У фрейма без низа точка и есть центр.
vec3 stand_centre(const class World& world, vec3 foot, vec3 half);

// ПРОСВЕТ ПОД ПОДОШВОЙ — сколько субвоксельных слоёв воздуха между телом в
// `centre` и первой твердью вдоль низа фрейма. Ноль — тело стоит (тот же слой,
// что `StandProbe::supported`), в том числе там, где низа нет. `kNoSupportSub`
// — тверди под телом нет на всей оси тора: падать ему вечно.
//
// Это ПРИБОР шва воплощения (`[voploshenie]`, game/floor_stream.cpp): «тело
// родилось в воздухе» обязано быть числом, а не впечатлением от игры.
inline constexpr int kNoSupportSub = -1;
int support_gap_sub(const class World& world, vec3 centre, vec3 half);

} // namespace giga

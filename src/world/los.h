// Line of sight — is the straight segment between two points clear of solid cells?
//
// THE FIRST LOS PRIMITIVE IN THE TREE, and it is in `src/world` rather than in
// combat because it is a question about GEOMETRY, not about fighting.
// [mob_behaviour.h] records the cost of not having it: the reference requires a
// clear line of sight before a monster may see you through a wall, "there is no LOS
// system here, so that test is dropped, and the behaviour degrades". That test now
// has something to call.
//
// КЛЕТОЧНЫЙ los_clear/los_blockers СНЕСЁН аудитом 2026-08-26 (§60): его
// «клетка — честная единица заслона» была мимикрией — на лепленом этаже
// полных клеток 0.4%, и предикат почти всегда отвечал «свободно»; все
// потребители (осколки, звук) переведены на субвоксельные ответы, живых
// вызовов не осталось. `sub_march` — субвоксельный:
// он отвечает «где луч ВПЕРВЫЕ коснулся материи», и по канону ([CANON.md] S2 —
// геометрия этажа состоит из субвокселей) на этот вопрос нельзя отвечать
// клеткой: падик-сэндвич держит плиту в двух верхних подслоях, и макро-ответ
// ставил точку попадания в 1.5 м от материи (плейтест 2026-08-19,
// tests/suite_shotsub.inl). Пуля останавливается субвокселем; грената
// по-прежнему скачет по клеточным граням ([combat.cpp] grenade_advance).
//
// **O(cells on the segment), and it must stay off the per-tick path.** [samosbor.h]
// refuses "a raycast per mob per fog tick" by name, and that refusal stands: this is
// for events — a detonation, a decision taken once — not for a sweep over 600
// monsters every tick. If a per-tick consumer ever appears it needs a baked
// visibility field, not this function called more often.
#pragma once

#include "core/math.h"

namespace giga {

class MacroGrid;



// Первый твёрдый СУБВОКСЕЛЬ на отрезке `a`→`b`, тем же Amanatides–Woo, что и
// los_blockers, но по решётке 0.25 м ([world/types.h] kVoxelSize). ЕДИНСТВЕННЫЙ
// субвоксельный марш в дереве ([CANON.md] S11) — потребитель, которому нужен
// «луч до материи» (пуля, будущий hitscan-ствол), обязан звать его, а не
// заводить второй.
//
// Правило концов ПРОТИВОПОЛОЖНО los_clear, и это не случайность: los спрашивает
// «что стоит МЕЖДУ», марш — «где первое КАСАНИЕ». Стартовый субвоксель участвует:
// пуля, рождённая в материи, останавливается ею (axis = -1 — грани входа нет),
// а не проходит сквозь неё бесплатно.
//
// `b` берётся как дан, без поиска ближайшего образа: снарядный интегратор ходит
// в непрерывных координатах prevPos → prevPos + v*dt и оборачивает только финал —
// марш обязан пройти тот же отрезок; тор появляется на запросе к сетке
// (MacroGrid оборачивает все три оси). Сегмент шага короток (v*dt), so is the
// walk — O(субвокселей на отрезке).
struct SubRayHit {
    float t = 0.0f;             // параметр контакта вдоль [a,b], 0..1
    int cx = 0, cy = 0, cz = 0; // макро-клетка попадания (обёрнута)
    int sx = 0, sy = 0, sz = 0; // субвоксель в клетке, 0..kSubDim-1
    int axis = -1;              // ось грани входа: 0=x 1=y 2=z; -1 = старт в тверди
    float sign = 0.0f;          // нормаль грани входа = sign по axis (против хода)
};
bool sub_march(const MacroGrid& grid, const vec3& a, const vec3& b,
               SubRayHit& out);

// Толщина материи вдоль [a,b] в клетках-эквивалентах (солид-субвоксели пути
// / kSubDim, потолок вверх) — градуированный субвоксельный ответ для
// окклюзии звука; та же DDA, что sub_march. Для событий и малых наборов —
// не для тиковых свипов (тот же закон, что у sub_march выше).
int sub_thickness_cells(const MacroGrid& grid, const vec3& a, const vec3& b);

} // namespace giga

// Wander locomotion — ПОСЛЕДНИЙ из трёх проходов ходьбы, переведённый на нав по
// зонам (§88/F.2). Он же был ПЕРВЫМ потребителем решётки 4x4x4, и обе эти роли
// стоит держать рядом: на решётке он не доходил НИ РАЗУ.
//
// ЗАМЕР 30000 КАДРОВ, ЭТАЖ 6, 2026-10-12, нормировка НА ЗАМЕР (не на кадры):
// `errand` (зоны) 3.83 прибытий на 100 замеров, `patrol` (решётка) 0.00,
// `wander` (решётка) 0.00 — при 22.7 ведомых телах на замер у прогулки. Это и
// была цена расхождения №7 реестра, которую эпик знал прозой и не знал числом.
//
// Шаг стоит по-прежнему **O(1) на агента** и по-прежнему без поиска, но читает
// ДВА массива вместо двух ярусов решётки: таблица зон даёт соседку на пути к
// цели, плоскость этой соседки даёт направление шага
// ([game/zone_nav.h] `zone_walk_dir`). Ни A*, ни пути на агенте, ни памяти
// маршрута — ничего, что росло бы с толпой сверх самой толпы.
//
// Cost is further divided by an **identity-hash stagger**: an agent is visited
// once every `kWanderPeriod` ticks, selected by its own entity id, so the per-tick
// cost is O(n / period) and there is *zero* per-agent scheduling state — no
// timers, no queues, no next-update field. That is the trick that lets the crowd
// grow without the tick growing with it.
#pragma once

#include <cstdint>

#include "core/tick.h"
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "game/zone_nav.h"  // ZoneNav — ОДНА дверь «куда шагнуть» (§88/F.2)
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"

namespace giga {
struct GravityField;
}

namespace giga::game {

// ЗОНА, в которую этот агент идёт. Прежде здесь лежал УЗЕЛ РЕШЁТКИ 4x4x4 — один
// из 64 якорей на весь тор, то есть одна клетка из 2 097 152, — и прибытие
// спрашивалось у поля потока ЭТОЙ ТОЧКИ. Замер 30000 кадров (этаж 6, 2026-10-12)
// назвал цену: прибытий у прогулки НОЛЬ при 22.7 ведомых телах на замер. Теперь
// цель — ЗОНА, а прибытие — «стою в ней» (§88/F.2).
//
// ЧЕТЫРЕ БАЙТА, И ЧИСЛО ВЫВЕДЕНО ЗАНОВО, А НЕ ПОДКРУЧЕНО. Пин говорил «вся
// навигация агента — три байта», и у него был смысл: ни пути, ни таймера, ни
// очереди на агенте. Этот смысл ЦЕЛ, а число изменилось, и вот его вывод:
//
//   * цель перестала быть одним из 64 якорей и стала одной из зон этажа — 5700
//     на шестом, 14742 на нулевом. `std::uint8_t` называет 256 штук: зону им не
//     назвать ВООБЩЕ, поэтому `RoomId` (u16) — та же арифметика, которой u16
//     стал `roomAt`;
//   * оба оставшихся байта держат читатели, и каждый куплен ЗАМЕРОМ, а не
//     привычкой: `cooldown` есть стаггер пере-выбора (редакция наряда без него
//     потеряла 40% тиков прогона и уронила ход по делам 3.83 -> 0.90 прибытий
//     на 100 замеров), `pack` есть когезия (пачка, рассыпающаяся на первом
//     прибытии, — это баг, который `pack_target_zone` и закрывает);
//   * 2 + 1 + 1 = 4, и дырки нет: выравнивание u16 — два байта.
//
// ЗАПАСНОГО БАЙТА ЗДЕСЬ НЕ БЫЛО, и это отличие от `PatrolPlan` (4 Б до и после):
// там `nodeFrom` ТОЛЬКО ПИСАЛСЯ — читали его одни тесты, — и, уйдя вместе с
// предметом, сам оплатил расширение цели. Здесь читатель есть у каждого байта,
// платить нечем, и подкрутить пин значило бы лишить его смысла утверждения.
struct WanderTarget {
    RoomId zone = kNoRoom;      // зона-цель; kNoRoom = ноги ещё нет
    std::uint8_t cooldown = 0;  // staggered visits to wait before repathing
    std::uint8_t pack = 0;      // spawn group (MobRef::pack); 0 = walks alone
};
static_assert(sizeof(WanderTarget) == 4,
              "вся навигация агента — четыре байта: зона (u16) и два байта, "
              "купленных замером (стаггер пере-выбора и пачка)");

// Visit each agent once every N ticks. 8 at the 120 Hz sim step means ~15
// steering decisions per agent per second, which is far finer than a walking
// body needs and still costs an eighth of the naive sweep.
inline constexpr std::uint32_t kWanderPeriod = 8;

// Sight-aggro range, metres. Inside this a mob drops navigation and closes on the
// camera holder directly. 20 m is a corridor-and-a-half: far enough that a floor
// feels hunted, near enough that the whole roster does not converge at once. From
// the reference's `MONSTER_DETECT = 20`.
//
// Promoted out of wander.cpp's anonymous namespace because [investigate.h] needs the same
// number to answer "is this mob already coming for you, or is it free to
// investigate a sound". A value two systems must agree on cannot live private to
// one of them — a copied 20.0f is a divergence waiting for one of the two to be
// tuned.
inline constexpr float kAggroRadius = 20.0f;

// Sim ticks a pack holds one shared destination before agreeing on another.
//
// This is the whole cohesion mechanism, and that it is a TIME QUANTUM rather than a
// stored decision is the load-bearing part. Members sit in different stagger slots
// and reach their repath at different moments, so a destination rolled "whenever I
// happened to repath" differs member to member and the pack disperses — which is
// exactly what makes spawn-only grouping a lie: `wander_init` randomises each node
// independently and the nav bake takes ~3.7 s, so a pack looks perfect for the
// length of the bake and scatters the instant the flow fields arrive.
//
// Quantising the tick makes the destination a pure function of (pack, epoch) that
// every member recomputes for itself and all of them get the same answer. No
// leader, no shared mutable state, no message passing, no path — and no write to
// another entity, so it cannot dangle a live view.
//
// 15 s. Lattice nodes are 32 cells = 64 m apart, so that is long enough for a pack
// to cover real ground between decisions, and short enough that a pack aimed at a
// node it cannot reach stands about for 15 s rather than forever.
//
// Derived from kSimHz rather than written as a tick count, because it was a tick
// count — 1800, authored as "15 s at the 120 Hz step" — and when core/tick.h moved
// the sim to 125 Hz the epoch silently became 14.4 s while the comment kept saying
// 15. Nothing failed, which is the problem: a duration authored in seconds and
// stored in ticks is a comment away from a lie on every rate change. Spelling the
// seconds in the expression makes the rate change carry it.
inline constexpr std::uint64_t kPackEpochTicks = 15u * static_cast<std::uint64_t>(kSimHz);

// ПОПЫТОК НА ВЫБОР ЦЕЛИ ЗДЕСЬ НЕТ, и их отсутствие — следствие замера. Первая
// редакция несла `kWanderTries = 8` по образцу наряда: восемь равномерных
// кандидатов среди всех зон этажа, отбраковка дальних. Замер (этаж 0, 13818
// зон, секунда сима) дал 119 попыток, 952 кандидата и НОЛЬ выборов — доля зон в
// пределах двух рёбер есть десятки из десятков тысяч. Выбор переехал на обход
// графа (`zone_pick_near`), который не промахивается по построению, и число
// попыток вместе с ним потеряло смысл. Число, которому нечего ограничивать,
// есть число без происхождения.

// ДАЛЬНОСТЬ НОГИ ПРОГУЛКИ В ЗОНАХ, и она ВЫВЕДЕНА ЗДЕСЬ, а не скопирована у
// наряда. Копировать `kPatrolLegZones = 6` было нельзя: оно выведено из СМЕНЫ
// ПАТРУЛЯ (45 с), а у прогулки квант времени свой, и он лежит в этом же файле.
//
// ВЫВОД. `kPackEpochTicks` = 15 с — столько пачка держит одну цель, и это
// единственная длительность, которую прогулка уже называет своей. Нога, которую
// за этот квант не закрыть, у пачкового тела не закрывается НИКОГДА (цель
// перевыбирается эпохой), а у одиночного кончается ровно тем нулём прибытий,
// который замер уже назвал дважды. 15 с × 1.35 м/с (`kNpcWalkSpeed`) = 20.25 м;
// зона этажа 6 — порядка 5 клеток, то есть 10 м ([game/role.h], замер
// 2026-10-12). Отсюда ДВЕ зоны.
//
// Почему предел вообще нужен, хотя у решётки его не было: 64 узла на весь тор
// сами работали ограничителем дальности — любая случайная цель лежала в
// нескольких прыжках. Зоны крупность убрали, и ограничитель пришлось внести
// явно. Это не «кап на всякий случай», это то, что замер поймал.
inline constexpr std::uint16_t kWanderLegZones = 2;

// МОБ ДАЛЬШЕ ЖИТЕЛЯ — вариант Б решения владельца №2 (2026-10-12), и выбор
// между ним и вариантом А («один предел на всех») решается ЗАМЕРОМ, а не
// вкусом: прогон снимается на обоих, и сравниваются прибытия И вид толпы.
//
// ВЫВОД ЧИСЛА — два независимых довода, и оба дают четвёрку:
//   * ТОТ ЖЕ КВАНТ, ВДВОЕ БОЛЬШЕ ЗЕМЛИ. Медиана `speed_cps` таблицы мобов —
//     1.35 клетки/с (68 строк `data/mobs.csv`), клетка 2 м, то есть 2.70 м/с
//     против 1.35 м/с у жителя: ровно вдвое. 2 × 2 = 4 зоны.
//   * НИЖНЯЯ ГРАНЬ, КОТОРОЙ У ЖИТЕЛЯ НЕТ. Прогулка для моба есть способ НАЙТИ
//     добычу, а видит он на `kAggroRadius` = 20 м = 2 зоны. Нога не длиннее
//     радиуса взгляда означает, что моб всю жизнь ходит внутри уже видимого, и
//     прогулка не приносит ему ничего. 4 > 2 — грань соблюдена.
inline constexpr std::uint16_t kWanderLegZonesMob = 4;

// ЗОНА, в которую пачка `pack` идёт на тике `tick`. Чистая, O(1), без
// состояния. Открыта наружу, чтобы тест утверждал СОГЛАСИЕ пачки, а не выводил
// его из того, где тела оказались. Прежде отдавала узел решётки; хеш ТОТ ЖЕ,
// изменился только модуль — число зон вместо `nav::kNodes`.
//
// ПРЕДЕЛА ДАЛЬНОСТИ У ПАЧКИ НЕТ, И ЭТО НЕ УПУЩЕНИЕ, А ЦЕНА КОГЕЗИИ. Предел
// считается ОТ МОЕЙ ЗОНЫ, а члены пачки стоят в разных зонах: взяв его, два
// члена получили бы РАЗНЫЕ цели, и пачка рассыпалась бы — ровно тот баг, от
// которого вся эта функция и держится. Значит пачковое тело за прогон, как
// правило, НЕ ПРИБЫВАЕТ (эпоха 15 с короче дороги до равномерной цели), и
// честный ответ на это — не прятать, а СЧИТАТЬ: `WanderTick::packed` отделяет
// такие тела, иначе прибор врал бы знаменателем.
RoomId pack_target_zone(std::uint8_t pack, std::uint64_t tick,
                        std::uint32_t zones);

// Give every mob and embodied NPC on `layer` a wander target. Call after a floor
// is populated (embody + mob spawn); entities that already have a target keep it.
// The player is skipped — it holds CameraTag and is steered by input.
//
// НОГА ЗАВОДИТСЯ ЛЕНИВО, И ЭТО СЛЕДСТВИЕ, А НЕ УПРОЩЕНИЕ. Зону цели нельзя
// выкатить до бейка: сколько их на этаже, знает только `ZoneNav`, а бейк в
// полёте на момент заселения (`main.cpp` — «толпа стоит до свапа»). Значит
// первую ногу выбирает ПЕРВЫЙ ПОСЕЩАЮЩИЙ ПРОХОД, а здесь кладётся `kNoRoom` —
// то же правило, которым живёт `PatrolPlan::zoneTo`.
//
// Отсюда и ушёл параметр `seed`: он существовал РОВНО для начального броска
// узла решётки, другого читателя у него не было, а бросок переехал в шаг (там
// он берётся из `id ^ tick`, то есть разный у тел и у волн спавна — ровно то,
// за чем `mob_spawn` подмешивал к семени тик). Мёртвый параметр в этом дереве
// есть дефект, а не запас.
//
// Пачка начального броска не требует и никогда не требовала: её цель —
// производная от (pack, эпоха), и `wander_step` вычисляет её каждый проход.
std::uint32_t wander_init(Registry& reg, LayerId layer);

// One staggered steering pass. Sets horizontal velocity from the baked zone
// fields; gravity and collision are left to physics_step, which runs after.
//
// СТУПЕНЬКУ РАЗРЕШАЕТ ДВЕРЬ, А НЕ ЭТОТ ПРОХОД, и это главное, что изменилось в
// контракте. Прежде здесь стояло правило «агент, которому поле отдало
// ВЕРТИКАЛЬНЫЙ шаг, не идёт никуда»: ходьба не умеет тратить шаг вдоль
// гравитации, лестниц не было, и тело переспрашивало маршрут вместо подъёма —
// то есть толпа ходила только по своему этажу. `zone_walk_dir` смотрит вперёд
// через ступеньки САМА и отдаёт первый шаг В ПЛОСКОСТИ ХОДЬБЫ, поэтому ветки на
// вертикаль у потребителя больше нет; осталась ОДНА — когда ступенька и есть
// выход из зоны, и тогда тело законно стоит (довод дословно у
// `place_errand_step` и `ai_patrol_step`: слепая прямая на цель здесь была
// остатком якоря решётки и стоила §88 нуля прибытий).
// `grid` is read only for the wall-adjacency test, which now serves both
// AiFlag::WallBias and the two behaviours that read the same query with their own
// numbers (DebrisLurker, WallBrace — [mob_behaviour.h]). `wall_query_needed` gates
// it to 5 of the 69 kinds (Тварь, Шовник, Арматура, Бетоноед, Панельник), and only
// for a mob already aggroed and already in its stagger slot — so 4 cell reads for
// roughly 1/8 of those kinds' heads per pass, and zero for the other 64 kinds.
//
// Not applied on the WANDER path, only on the pursuit path, which is a divergence
// from the reference worth knowing: there `monsterMoveMult` scales all monster
// movement. Extending it here would change four kinds' idle pace and would put the
// grid query on every hostile every visit rather than on aggroed ones, so it waits
// for a reason better than symmetry.
// `pool` is read to resolve a body's faction: monsters do not hunt a body they do
// not consider prey ([faction_relations.h] kMobVsFaction). That applies to the
// camera holder and — since monsters now pursue the crowd as well — to every
// resident a hunting monster weighs up. The rate control that keeps this from
// emptying a floor is [hunt.h]; read it before changing what a mob chases.
// ЧТО СДЕЛАЛ ОДИН `wander_step` — словарь `PlaceTick`/`PatrolTick`, чтобы три
// прохода ходьбы были сравнимы одной строкой лога (см. довод у `PatrolTick`).
//
// `considered` считает ПОСЕЩЁННЫХ этим тиком, а не всех в слое: проход ходит
// стаггером (`kWanderPeriod`), и знаменатель, не знающий про стаггер, занижал
// бы долю прибытий ровно в восемь раз. Это тот же класс лжи прибора, за
// который платили в §88 нормировкой на кадры вместо замеров.
struct WanderTick {
    std::uint32_t considered = 0;  // тел, ПОСЕЩЁННЫХ этим тиком (стаггер учтён)
    std::uint32_t walking = 0;     // тел, которым выдана скорость хода
    std::uint32_t arrived = 0;     // целей достигнуто этим тиком
    std::uint32_t repicked = 0;    // новых целей выбрано
    // ИМЕНА СВЕДЕНЫ К СЛОВАРЮ `PatrolTick`/`PlaceTick` (§88/F.2): `stuck`
    // переименован в `unreachable`, добавлены `offnav` и `zdist`. Это не стиль
    // — это условие сравнимости: три прохода ходьбы обязаны отвечать на вопрос
    // «доходит ли ходок» ОДИНАКОВЫМИ именами, иначе перевод третьего нечем
    // сверить с двумя переведёнными.
    std::uint32_t unreachable = 0; // целей брошено: маршрута нет
    std::uint32_t offnav = 0;      // тело вне проходимого множества (нет зоны)
    // СТУПЕНЬКА КОНЧИЛА НОГУ — свой счётчик, а не слагаемое `unreachable`,
    // потому что это ДРУГАЯ причина: маршрут есть, но его первый шаг идёт
    // вдоль гравитации, и ходьба такой шаг потратить не умеет. Сложи их — и
    // прибор перестанет отвечать на вопрос «чего не хватает ходоку»: лечения у
    // этих двух разные (связность графа против подъёма).
    std::uint32_t stepup = 0;
    std::uint32_t chasing = 0;     // тел на прямой погоне (нав не спрашивался)
    // ПАЧКОВЫХ ТЕЛ — отдельно, и это не украшение. У пачки предела дальности
    // нет по построению (довод у `pack_target_zone`), значит её тела прибывают
    // редко, и прибытия, делённые на ВСЕХ ведомых, занижали бы работу
    // одиночного ходока тем сильнее, чем больше на этаже пачек.
    std::uint32_t packed = 0;
    // ПРИБЛИЖАЮТСЯ ЛИ ВООБЩЕ — тот же прибор, которым §88/E отличил «прибытий
    // ноль» от «идут, но медленно». Σ расстояния в ЗОНАХ от тела до его цели,
    // и Σ по ВЕДОМЫМ ОДИНОЧНЫМ телам — ДВА знаменателя, и оба названы замером:
    // тело без хода исказило бы среднее в сторону, которая выглядит успехом, а
    // ПАЧКОВОЕ тело исказило его на самом деле (замер 2026-10-12: zdist 9.47
    // при пределе ноги 2, потому что у пачки предела нет по построению и её
    // цель лежит в 10-30 зонах). Прибор был честен, полон и отвечал на НЕ
    // ЗАДАННЫЙ вопрос — тот же четвёртый класс лжи, что в §87.
    std::uint32_t zoneDistSum = 0;
    std::uint32_t zoneDistBodies = 0;
};

// НАВ ПО ЗОНАМ, И ТОЛЬКО ОН (§88/F.2) — третий и последний потребитель,
// переведённый с решётки 4x4x4. Непостроенный бейк — no-op, как и прежде
// (`fine.flow.empty()` стало `!zones.built()`): толпа стоит до свапа.
WanderTick wander_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                       const ZoneNav& zones, LayerId layer, std::uint64_t tick,
                       const GravityField* gravity = nullptr);

} // namespace giga::game

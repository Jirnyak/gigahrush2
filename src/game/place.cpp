// Выбор места и ход к нему. Законы и выводы — в place.h.

#include "game/place.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "core/math.h"        // vec3
#include "core/rng.h"         // rand01 — стаггер пере-выбора
#include "core/wrap.h"        // wrap_delta / wrap_macro — тор по всем трём осям
#include "ecs/components.h"   // Transform, Velocity
#include "game/embody.h"      // NpcRef
#include "game/needs.h"       // needs_row_for — ОДНА строка нужд на всех решателей
#include "world/gravity.h"    // GravityFrame / regime_frame — плоскость ходьбы
#include "world/nav.h"        // route_step — ОБЪЯВЛЕННАЯ дверь «куда шагнуть»
#include "world/types.h"      // kCellSize, kMacroDim, wrap_macro

namespace giga::game {

namespace {

// Σ спрос·вектор, делённая на тысячу ОДИН раз — на сумме. i64 в накопителе:
// `supply` у богатой комнаты — рубли (i32), и тысяча таких слагаемых i32
// переполнила бы i32, а i64 не переполнит (1000 · 2^31 ≈ 2.1·10^12).
std::int32_t dot_e3(const DemandE3 demand[kVerbCount], const std::int32_t* v) {
    std::int64_t acc = 0;
    for (std::size_t i = 0; i < kVerbCount; ++i)
        acc += static_cast<std::int64_t>(demand[i]) * static_cast<std::int64_t>(v[i]);
    return static_cast<std::int32_t>(acc / kDemandFull);
}

// Тороидальная манхэттенская дистанция в клетках. ТРИ оси через `wrap_delta` —
// неполную тройку (две через заворот, третью голым вычитанием) ловит Rule 8
// прибора `check_source_rules`, и ловит по делу.
int cell_dist_l1(int ax, int ay, int az, int bx, int by, int bz) {
    return std::abs(wrap_delta(ax, bx, kMacroDim)) +
           std::abs(wrap_delta(ay, by, kMacroDim)) +
           std::abs(wrap_delta(az, bz, kMacroDim));
}

} // namespace

// ---------------------------------------------------------------------------
// СПРОС
// ---------------------------------------------------------------------------

void demand_from_needs(const Needs& n, DemandE3 out[kVerbCount]) {
    for (std::size_t v = 0; v < kVerbCount; ++v) out[v] = 0;
    // Кривые — `needs_low_pressure`/`needs_high_pressure` из [game/needs.h], то
    // есть РОВНО те, которыми интент-арбитр судит те же самые бары. Одна
    // величина — одна кривая (см. довод о §64 в шапке needs.h).
    const auto e3 = [](float p) {
        return static_cast<DemandE3>(giga::clamp01(p) * static_cast<float>(kDemandFull));
    };
    out[kVerbSleep] = e3(needs_low_pressure(n.sleep));
    out[kVerbEat] = e3(needs_low_pressure(n.food));
    out[kVerbDrink] = e3(needs_low_pressure(n.water));
    // Сортир — МАКСИМУМ двух давлений, а не сумма: одного полного мочевого
    // достаточно, и складывать их значило бы требовать обоих сразу.
    out[kVerbToilet] = e3(std::max(needs_high_pressure(n.pee),
                                   needs_high_pressure(n.poo)));
    out[kVerbWander] = kDemandWanderFloor; // S13.2: малый, но никогда не ноль
}

void demand_add_health(float hp, float maxHp, DemandE3 out[kVerbCount]) {
    const float p = needs_health_pressure(hp, maxHp);
    const std::int32_t add =
        static_cast<std::int32_t>(giga::clamp01(p) * static_cast<float>(kDemandFull));
    const std::int32_t sum = static_cast<std::int32_t>(out[kVerbHeal]) + add;
    out[kVerbHeal] = static_cast<DemandE3>(sum > kDemandFull ? kDemandFull : sum);
}

// ---------------------------------------------------------------------------
// ОДНА СУММА
// ---------------------------------------------------------------------------

std::int32_t place_interest(const Room& r, const DemandE3 demand[kVerbCount]) {
    std::int64_t acc = 0;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        // ПРЕДЛОЖЕНИЕ = объявлено + оснащение/запас, одним вектором (S12.4:
        // «K чисел на комнату — всё предложение целиком»).
        const std::int64_t offer =
            static_cast<std::int64_t>(r.declared[v]) + static_cast<std::int64_t>(r.supply[v]);
        acc += static_cast<std::int64_t>(demand[v]) * offer;
    }
    return static_cast<std::int32_t>(acc / kDemandFull);
}

int place_target_cell(const FloorRooms& fr, const Room& r, int cx, int cy, int cz,
                      int& tx, int& ty, int& tz) {
    if (r.boxCount == 0) return -1;
    int best = -1;
    for (std::uint32_t b = 0; b < r.boxCount; ++b) {
        const std::size_t bi = static_cast<std::size_t>(r.boxFirst) + b;
        if (bi >= fr.boxes.size()) break; // пул боксов короче заявки — не UB
        const RoomBox& box = fr.boxes[bi];
        const int ox = wrap_macro(box.x + box.sx / 2);
        const int oy = wrap_macro(box.y + box.sy / 2);
        const int oz = wrap_macro(box.z + box.sz / 2);
        const int d = cell_dist_l1(cx, cy, cz, ox, oy, oz);
        if (best < 0 || d < best) {
            best = d;
            tx = ox;
            ty = oy;
            tz = oz;
        }
    }
    return best;
}

std::int32_t place_cost(const FloorRooms& fr, const Room& r, int cx, int cy, int cz) {
    int tx = 0, ty = 0, tz = 0;
    const int cells = place_target_cell(fr, r, cx, cy, cz, tx, ty, tz);
    if (cells < 0) return 0;
    // ЕДИНСТВЕННОЕ МЕСТО, КУДА ПРИХОДЯТ БУДУЩИЕ ИЗДЕРЖКИ (решение владельца
    // 2026-10-01): толпа, чужая территория, опасность — каждая одним
    // слагаемым здесь, когда у неё появится писатель. Скорер не трогается.
    return cells * kPlacePathCostPerCell;
}

PlacePick place_pick(const FloorRooms& fr, const DemandE3 demand[kVerbCount],
                     int cx, int cy, int cz) {
    PlacePick out;
    if (fr.list.empty() || fr.bins.empty() || fr.binCeil.empty()) return out;

    // ТОЧКА ПОД НОГАМИ — КАНДИДАТ ВСЕГДА, и её путь нулевой. Коридор даёт ноль:
    // то, через что идут, не предлагает ничего (S12.1).
    std::int32_t best = 0;
    std::int32_t bestCost = 0;
    if (const Room* here = room_of(fr, room_at(fr, cx, cy, cz)))
        best = place_interest(*here, demand);

    // РАДИУС ВЫВОДИТСЯ: глобальная верхняя грань интереса — храповик `maxOffer`
    // (max по комнатам, только растёт), значит ни одна комната тора не даст
    // больше. Не обгоняет место под ногами — искать нечего вовсе.
    const std::int32_t top = dot_e3(demand, fr.maxOffer);
    if (top <= best) return out;

    const int bx = cx >> kRoomBinShift;
    const int by = cy >> kRoomBinShift;
    const int bz = cz >> kRoomBinShift;

    for (int r = 0; r <= kRoomBinDim / 2; ++r) {
        // НИЖНЯЯ ГРАНЬ ПУТИ до любой клетки бина шелла r: вдоль оси, по которой
        // индексы бинов разошлись на r, расстояние не меньше (r−1) рёбер бина.
        // Для r ∈ {0,1} грань нулевая — соседний бин может касаться вплотную.
        const std::int32_t lower =
            r > 1 ? static_cast<std::int32_t>(r - 1) * kRoomBinEdge : 0;
        // Шеллы идут по возрастанию грани, поэтому первый недотягивающий шелл
        // кончает обход: это и есть «R = maxИнтерес / цена клетки» без деления.
        if (top - lower <= best) break;

        for (int dz = -r; dz <= r; ++dz)
            for (int dy = -r; dy <= r; ++dy)
                for (int dx = -r; dx <= r; ++dx) {
                    // Только оболочка: хотя бы одна координата на краю куба.
                    if (std::abs(dx) != r && std::abs(dy) != r && std::abs(dz) != r)
                        continue;
                    const std::size_t bi = room_bin_index(bx + dx, by + dy, bz + dz);
                    ++out.bins;
                    // ОТСЕЧКА ПОТОЛКОМ: потолок — max предложения по комнатам
                    // бина, значит Σ спрос·потолок — верхняя грань интереса
                    // ЛЮБОЙ его комнаты. Не догоняет лидера — бин пропущен
                    // целиком, и честного кандидата отрезать нельзя.
                    const std::int32_t ceilBound =
                        dot_e3(demand, &fr.binCeil[bi * kVerbCount]);
                    if (ceilBound - lower <= best) continue;
                    for (const RoomId id : fr.bins[bi]) {
                        const Room* cand = room_of(fr, id);
                        if (cand == nullptr) continue;
                        ++out.judged;
                        const std::int32_t cost = place_cost(fr, *cand, cx, cy, cz);
                        const std::int32_t score = place_interest(*cand, demand) - cost;
                        // НИЧЬЮ РЕШАЕТ ФИЗИКА (S13.2): интерес → расстояние →
                        // номер. Строгое `>` по счёту плюс сравнение издержки
                        // значит, что равный счёт забирает БЛИЖАЙШИЙ, а не
                        // первый по памяти; место под ногами с нулевой
                        // издержкой побеждает любую ничью и тело не трогается.
                        const bool better =
                            score > best ||
                            (score == best && out.room != kNoRoom && cost < bestCost) ||
                            (score == best && out.room != kNoRoom && cost == bestCost &&
                             id < out.room);
                        if (!better) continue;
                        best = score;
                        bestCost = cost;
                        out.room = id;
                    }
                }
    }
    out.score = best;
    out.cost = out.room == kNoRoom ? 0 : bestCost;
    return out;
}

// ---------------------------------------------------------------------------
// ХОД К ВЫБРАННОМУ МЕСТУ
// ---------------------------------------------------------------------------

PlaceTick place_errand_step(Registry& reg, NpcPool& pool, const FloorRooms& fr,
                            const nav::CoarseGraph& coarse,
                            const nav::FineNav& fine, LayerId layer, double now,
                            const GravityField* gravity) {
    PlaceTick out;
    // Пустой бейк — no-op, не UB: тот же контракт, которым живут `wander_step`
    // и `ai_patrol_step`. Пока бейк в полёте тела ходят вандером, как всегда.
    if (fine.flow.empty() || fine.nearest.empty()) return out;
    if (fr.roomAt.empty() || fr.list.empty()) return out;

    // Фрейм гравитации — свойство мира, не тела; null держит NegZ побитово
    // (тесты), Custom разрешается вектором. Дословно правило `ai_patrol_step`.
    GravityRegime regime = GravityRegime::NegZ;
    if (gravity != nullptr) {
        regime = gravity->regime;
        if (regime == GravityRegime::Custom) regime = regime_from_vector(gravity->global);
    }
    const GravityFrame gf = regime_frame(regime);
    const auto tangent = [&gf](float x, float y, float z) {
        if (gf.axis == 0) x = 0.0f;
        else if (gf.axis == 1) y = 0.0f;
        else z = 0.0f;
        return vec3{x, y, z};
    };

    auto view = reg.view<AiBrain, const NpcRef, const Transform, Velocity>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // РАЗВИЛКА МОЗГОВ (S13.7a): проход обслуживает ЖИТЕЛЕЙ. Формулировка
        // положительная, а не «это не игрок и не моб» — отрицательная
        // рассыпается при добавлении прохода, и однажды рассыпалась
        // (`ai_equip_step` снимал фонарь из руки игрока, bugs.md Б1).
        if (decider_of(reg, e) != Decider::Resident) continue;
        AiBrain& brain = view.get<AiBrain>(e);
        // Тело уже под токеном — им владеет либо бегство (`ai_step`), либо
        // патруль. Угроза и наряд старше дела; не вмешиваемся.
        if (brain.motion == static_cast<std::uint8_t>(MotionOwner::Ai)) continue;

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        ++out.considered;

        // Ленивое навешивание — правило `PlayerMelee`/`PatrolPlan`: эмплейс
        // компоненты, которой вид не обходит, итерацию не ломает.
        if (!reg.all_of<ErrandPlan>(e)) reg.emplace<ErrandPlan>(e);
        ErrandPlan& plan = reg.get<ErrandPlan>(e);

        const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
        const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
        const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));

        const std::uint32_t idSeed = identity_seed(id);
        const auto stagger = [&]() {
            return static_cast<float>(
                now + static_cast<double>(kRethinkBaseSec) +
                static_cast<double>(rand01(channel_seed(idSeed, kPlaceRepickChannel))) *
                    static_cast<double>(kRethinkSpreadSec));
        };

        // Цель могла исчезнуть вместе с этажом: комнаты пересоздаются на каждом
        // входе (закон 2 room.h), а компонента живёт с телом.
        const Room* goal = room_of(fr, plan.room);
        if (plan.room != kNoRoom && goal == nullptr) plan.room = kNoRoom;

        // ПРИБЫЛ = ВНУТРИ БОКСА (S13.3). Второе условие — на случай клетки,
        // отданной перекрытием соседней комнате (`overlapCells` считается
        // вслух и бывает непустым): без него цель оказалась бы недостижимой
        // ПО ПОСТРОЕНИЮ, а не по геометрии.
        if (plan.room != kNoRoom && goal != nullptr) {
            int tx = 0, ty = 0, tz = 0;
            place_target_cell(fr, *goal, cx, cy, cz, tx, ty, tz);
            if (room_at(fr, cx, cy, cz) == plan.room ||
                (cx == tx && cy == ty && cz == tz)) {
                ++out.arrived;
                plan.room = kNoRoom;
                plan.nextPickAt = stagger();
                // Дошёл — отпускаем тело. Держать его здесь силой нельзя:
                // замирающий NPC есть дефект (S13.2), а деяние на месте
                // (съесть, лечь) придёт расходом запаса (S12.5), не стоянием.
                ++out.idle;
                continue;
            }
        }

        // ВЫБОР — ПО СОБЫТИЮ: только когда цели нет и стаггер истёк.
        if (plan.room == kNoRoom) {
            if (now < static_cast<double>(plan.nextPickAt)) {
                ++out.idle;
                continue;
            }
            const Needs row = needs_row_for(pool, id);
            DemandE3 demand[kVerbCount];
            demand_from_needs(row, demand);
            demand_add_health(static_cast<float>(pool.hp(id)),
                              static_cast<float>(pool.max_hp(id)), demand);
            const PlacePick pick = place_pick(fr, demand, cx, cy, cz);
            out.judged += pick.judged;
            out.bins += pick.bins;
            plan.nextPickAt = stagger();
            if (pick.room == kNoRoom) {
                // Ничто не обгоняет место под ногами — законный ответ, а не
                // неудача: тело гуляет вандером до следующего вопроса.
                ++out.idle;
                continue;
            }
            plan.room = pick.room;
            ++plan.picks;
            ++out.picked;
            goal = room_of(fr, plan.room);
        }
        if (goal == nullptr) {
            ++out.idle;
            continue;
        }

        // КУДА ШАГНУТЬ — ЧЕРЕЗ ОБЪЯВЛЕННУЮ ДВЕРЬ. `route_step` композирует оба
        // запечённых яруса (ближайший якорь цели выбирает поле потока, таблица
        // coarse отвечает о достижимости за O(1)). До 2026-10-01 у неё было
        // НОЛЬ вызовов в проде при двадцати в тестах, а прод композировал те же
        // два яруса руками в шести строках — расхождение №7 реестра.
        int tx = 0, ty = 0, tz = 0;
        if (place_target_cell(fr, *goal, cx, cy, cz, tx, ty, tz) < 0) {
            plan.room = kNoRoom;
            ++out.idle;
            continue;
        }
        const std::uint8_t d =
            nav::route_step(coarse, fine, ivec3{cx, cy, cz}, ivec3{tx, ty, tz});
        if (d == nav::kFlowNone) {
            // Маршрута нет (разные компоненты связности, или цель в толще).
            // Цель снимается со стаггером: пере-спрашивать каждый тик значило
            // бы платить ценой запроса за безнадёжное тело каждый кадр.
            ++out.unreachable;
            plan.room = kNoRoom;
            plan.nextPickAt = stagger();
            ++out.idle;
            continue;
        }

        // НАПРАВЛЕНИЕ СЧИТАЕТСЯ ДО ЗАБОРА ТОКЕНА, и порядок здесь не вкусовой:
        // тело, забранное токеном и не получившее скорости, пропускается
        // `wander_step` и не ведётся никем — то есть ЗАМИРАЕТ, а замирающий NPC
        // есть дефект (S13.2). Поймано на себе при посадке проверки
        // проходимости ниже: `continue` стоял после забора.
        vec3 dir{0.0f, 0.0f, 0.0f};
        if (d < 6 && (d >> 1) != gf.axis) {
            // Шаг в плоскости ходьбы: целимся в ЦЕНТР следующей клетки — то же
            // самоисправляющееся правило, которым идёт патруль.
            const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
            const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
            const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
            dir = tangent(
                wrap_delta_f(tr.pos.x, (static_cast<float>(nx) + 0.5f) * kCellSize, kWorldExtent),
                wrap_delta_f(tr.pos.y, (static_cast<float>(ny) + 0.5f) * kCellSize, kWorldExtent),
                wrap_delta_f(tr.pos.z, (static_cast<float>(nz) + 0.5f) * kCellSize, kWorldExtent));
        } else {
            // ОСТАТОК ЯКОРЯ и шаг ВДОЛЬ гравитации — один и тот же случай:
            // поля потока несут только 64 якоря, поэтому цель, не стоящая на
            // якоре, достигается маршрутом лишь до своего якоря (≤ половины
            // шага решётки), а последнюю ногу идёт сам вызывающий — ровно то,
            // что обещает шапка `route_step`. Ходьба не умеет тратить шаг вдоль
            // гравитации, и ответ у обоих случаев один: прямо на цель, в
            // плоскости ходьбы.
            //
            // ЭТА ВЕТКА — НЕ РЕДКИЙ СЛУЧАЙ, А 85% ОТВЕТОВ, и это ЗАМЕР живого
            // прогона 2026-10-01 (этаж 6, 800 тыс. вызовов маршрута): `+z`
            // дал 637 256 ответов против 143 тыс. горизонтальных на все четыре
            // стороны. Причина НЕ в этом файле и не в выборе цели: поля потока
            // печены над оракулом «тело ВЛЕЗАЕТ в клетку»
            // (`ClearanceField@src/world/clearance.h`), у которого нет понятия
            // ОПОРЫ, поэтому кратчайший путь к якорю идёт ПО ВОЗДУХУ. Ходок за
            // таким путём следовать не может по построению. Долг записан
            // расхождением в [SKELETON.md] VIII.5.
            dir = tangent(
                wrap_delta_f(tr.pos.x, (static_cast<float>(tx) + 0.5f) * kCellSize, kWorldExtent),
                wrap_delta_f(tr.pos.y, (static_cast<float>(ty) + 0.5f) * kCellSize, kWorldExtent),
                wrap_delta_f(tr.pos.z, (static_cast<float>(tz) + 0.5f) * kCellSize, kWorldExtent));
            // И ПОТОМУ ЖЕ ЭТА ВЕТКА НЕ ИМЕЕТ ПРАВА ИДТИ ВСЛЕПУЮ. Прямая на цель
            // не знает стен, и живой прогон показал, чем это кончается: тело
            // прошло четыре клетки и `route_step` вернул `kFlowNone` — оно
            // вышло за пределы ПРОХОДИМОГО МНОЖЕСТВА, где нав его больше не
            // видит. Проверка стоит ОДНА и дешёвая: знает ли нав клетку, в
            // которую тело собирается шагнуть. Не знает — тело отдаётся
            // `wander_step`, который умеет ходить по этому этажу, а цель
            // остаётся на месте и ждёт следующего тика.
            //
            // Почему именно `nearest_node`: это та же карта, по которой
            // `route_step` решает «есть ли маршрут», поэтому проверка и маршрут
            // не могут разойтись в понимании слова «проходимо».
            const float adx = dir.x < 0.0f ? -dir.x : dir.x;
            const float ady = dir.y < 0.0f ? -dir.y : dir.y;
            const float adz = dir.z < 0.0f ? -dir.z : dir.z;
            int nx = cx, ny = cy, nz = cz;
            if (adx >= ady && adx >= adz) nx = wrap_macro(cx + (dir.x < 0.0f ? -1 : 1));
            else if (ady >= adz) ny = wrap_macro(cy + (dir.y < 0.0f ? -1 : 1));
            else nz = wrap_macro(cz + (dir.z < 0.0f ? -1 : 1));
            if (fine.nearest_node(nx, ny, nz) == nav::kFlowNone) {
                ++out.offnav;
                ++out.idle;
                continue; // токен НЕ забран: тело остаётся за вандером
            }
        }

        const float d2 = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
        if (d2 <= kMinFleeGrad2) {
            // Направления нет (проекция опустошила вектор, или тело стоит в
            // целевой клетке). Владеемый ноль здесь был бы остановкой на ровном
            // месте, поэтому тело отдаётся вандеру, а цель остаётся.
            ++out.idle;
            continue;
        }
        dir = dir * (1.0f / std::sqrt(d2));

        // ЗАБОР ТОКЕНА — только теперь, когда направление ЕСТЬ. Отсюда и до
        // конца тика этот проход — единственный писатель горизонтальной
        // `Velocity` этого тела.
        brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
        ++out.walking;
        Velocity& vel = view.get<Velocity>(e);
        // ДЕЛО — ЭТО ХОДЬБА, а не бегство: `kErrandSpeed` в точности равен
        // шагу вандера, поэтому тело, перешедшее с прогулки на дело, меняет
        // НАПРАВЛЕНИЕ, а не походку. Множитель паники остаётся читаемым ровно
        // потому, что обычный шаг обычен.
        if (gf.axis != 0) vel.v.x = dir.x * kErrandSpeed;
        if (gf.axis != 1) vel.v.y = dir.y * kErrandSpeed;
        if (gf.axis != 2) vel.v.z = dir.z * kErrandSpeed;
    }
    return out;
}

} // namespace giga::game

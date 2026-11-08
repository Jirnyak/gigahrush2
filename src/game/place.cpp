// Выбор места и ход к нему. Законы и выводы — в place.h.

#include "game/place.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

#include "core/math.h"        // vec3
#include "core/rng.h"         // rand01 — стаггер пере-выбора
#include "core/wrap.h"        // wrap_delta / wrap_macro — тор по всем трём осям
#include "ecs/components.h"   // Transform, Velocity
#include "game/embody.h"      // NpcRef
#include "game/needs.h"       // needs_row_for — ОДНА строка нужд на всех решателей
#include "game/serve.h"       // деяние нужды на месте (S24) — политика там
#include "world/gravity.h"    // GravityFrame / regime_frame — плоскость ходьбы
#include "world/nav.h"        // nav::kNavDir — словарь шести направлений шага
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
    // величина — одна кривая (см. довод о §64 в шапке needs.h), и КОЛЕНО у
    // каждой приходит из терпения СВОЕЙ строки (S13.5): спрос по глаголу
    // спрашивает именно тот глагол.
    const auto e3 = [](float p) {
        return static_cast<DemandE3>(giga::clamp01(p) * static_cast<float>(kDemandFull));
    };
    out[kVerbSleep] = e3(needs_low_pressure(kVerbSleep, n.sleep));
    out[kVerbEat] = e3(needs_low_pressure(kVerbEat, n.food));
    out[kVerbDrink] = e3(needs_low_pressure(kVerbDrink, n.water));
    // Сортир — МАКСИМУМ двух давлений, а не сумма: одного полного мочевого
    // достаточно, и складывать их значило бы требовать обоих сразу.
    out[kVerbToilet] = e3(std::max(needs_high_pressure(kVerbToilet, n.pee),
                                   needs_high_pressure(kVerbToilet, n.poo)));
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

std::int32_t place_interest(const Room& r, const DemandE3 demand[kVerbCount],
                            VerbId* topVerb) {
    std::int64_t acc = 0;
    std::int64_t top = 0;
    VerbId topV = static_cast<VerbId>(kVerbCount);
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        // ПРЕДЛОЖЕНИЕ = объявлено + оснащение/запас, одним вектором (S12.4:
        // «K чисел на комнату — всё предложение целиком»).
        const std::int64_t offer =
            static_cast<std::int64_t>(r.declared[v]) + static_cast<std::int64_t>(r.supply[v]);
        const std::int64_t term = static_cast<std::int64_t>(demand[v]) * offer;
        acc += term;
        // ЯРЛЫК ПАРЫ — наибольшее слагаемое ЭТОЙ ЖЕ суммы. Строгое `>` отдаёт
        // ничью младшему глаголу, тем же законом, которым ничья комнат уходит
        // младшему id: детерминизм выбора важнее того, какой именно глагол
        // назван, и оба конца ничьи одинаково законны.
        if (term > top) {
            top = term;
            topV = static_cast<VerbId>(v);
        }
    }
    if (topVerb != nullptr) *topVerb = topV;
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
    VerbId bestVerb = static_cast<VerbId>(kVerbCount);
    if (const Room* here = room_of(fr, room_at(fr, cx, cy, cz)))
        best = place_interest(*here, demand, &bestVerb);

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
                        VerbId candVerb = static_cast<VerbId>(kVerbCount);
                        const std::int32_t score =
                            place_interest(*cand, demand, &candVerb) - cost;
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
                        bestVerb = candVerb;
                        out.room = id;
                    }
                }
    }
    out.score = best;
    out.cost = out.room == kNoRoom ? 0 : bestCost;
    // Ярлык осмыслен ровно тогда, когда есть пара: без комнаты не выиграл
    // никто, и называть глагол места под ногами было бы ложью о решении.
    out.verb = out.room == kNoRoom ? static_cast<VerbId>(kVerbCount) : bestVerb;
    return out;
}

// ---------------------------------------------------------------------------
// ХОД К ВЫБРАННОМУ МЕСТУ
// ---------------------------------------------------------------------------

PlaceTick place_errand_step(Registry& reg, NpcPool& pool, FloorRooms& fr,
                            LayerId layer, double now, std::uint64_t tick,
                            const GravityField* gravity, const ZoneNav* zones,
                            ServeTick* serve, EventBus* bus) {
    PlaceTick out;
    // Телеметрия деяния опциональна у вызывающего, но не внутри: ветки «если
    // счётчик дали» размножили бы условия по всему проходу.
    ServeTick serveSink;
    ServeTick& srv = serve != nullptr ? *serve : serveSink;
    // Непостроенный нав — no-op, не UB: тот же контракт, которым живут
    // `wander_step` и `ai_patrol_step`. Пока бейк в полёте тела ходят вандером,
    // как всегда. До 2026-10-12 этой проверкой был `fine.flow.empty()` —
    // решётка; теперь единственный нав ходьбы это зоны, и ветки «без зон»
    // больше нет (§88/F.2 шаг 3).
    if (zones == nullptr || !zones->built()) return out;
    if (fr.roomAt.empty() || fr.list.empty()) return out;

    // ПУЛЫ ПРОГРЕТЫ ДО ОТКРЫТИЯ ВИДА, и это не оптимизация, а снятие класса
    // UB. Внутри обхода проход СОЗДАЁТ компоненты (`ErrandPlan` лениво,
    // `Acting` — деяние) и может позвать `apply_damage` (цена сомнительной
    // еды), а тот крепит `Dead`. РОЖДЕНИЕ НОВОГО ПУЛА растит контейнер пулов
    // реестра и дангл'ит указатели, которые держит ЖИВОЙ вид, — дословно тот
    // дефект, ради которого `mob_attack_step` разрезан на две фазы
    // ([game/combat.cpp]). Существующий пул от вставки элемента не переезжает,
    // поэтому достаточно, чтобы к моменту открытия вида все три пула уже БЫЛИ.
    //
    // Шапка ниже утверждала обратное («эмплейс компоненты, которой вид не
    // обходит, итерацию не ломает») — утверждение верно для ЭЛЕМЕНТА и неверно
    // для ПЕРВОГО элемента нового рода; аудит это и нашёл.
    (void)reg.storage<ErrandPlan>();
    (void)reg.storage<Acting>();
    (void)reg.storage<Dead>();

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
    // ДЕРЖАТЬ НА МЕСТЕ (S24): забрать токен и обнулить скорость В ПЛОСКОСТИ
    // ХОДЬБЫ — ось гравитации не трогаем, её владелец физика. Владеемый ноль
    // здесь законен и необходим: «замирающий NPC есть дефект» (S13.2) сказано
    // про тело БЕЗ решения, а это тело решение как раз ИСПОЛНЯЕТ. Не обнулить
    // — и `wander_step`, пропустив тело по токену, оставит ему прежнюю
    // скорость, то есть деяние свершится на ходу.
    const auto hold_still = [&gf](AiBrain& b, Velocity& vel) {
        b.motion = static_cast<std::uint8_t>(MotionOwner::Errand);
        if (gf.axis != 0) vel.v.x = 0.0f;
        if (gf.axis != 1) vel.v.y = 0.0f;
        if (gf.axis != 2) vel.v.z = 0.0f;
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
        // Тело под ЧУЖИМ токеном — им владеет либо бегство (`ai_step`), либо
        // патруль. Угроза и наряд старше дела; не вмешиваемся.
        //
        // Сравнение именно с `Ai`, а не «не Wander»: `Errand` — СВОЙ токен
        // этого прохода (ведение или деяние), и принять его за угрозу значило
        // бы рвать собственное деяние каждый тик (S24, довод у enum'а).
        if (brain.motion == static_cast<std::uint8_t>(MotionOwner::Ai)) {
            // ...но открытое ДЕЯНИЕ при этом рвётся (S24, закон 5): иначе
            // тело доело бы на бегу — окно закрылось бы само и уронило
            // эффект, пока тело спасается. Боевое окно эта причина не рвёт:
            // `kBreakThreat` в маске боевых строк не стоит.
            serve_break_threat(reg, e, tick, srv);
            continue;
        }

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        ++out.considered;

        // Ленивое навешивание — правило `PlayerMelee`/`PatrolPlan`: эмплейс
        // компоненты, которой вид не обходит, итерацию не ломает.
        if (!reg.all_of<ErrandPlan>(e)) reg.emplace<ErrandPlan>(e);
        ErrandPlan& plan = reg.get<ErrandPlan>(e);

        // ОДНА ДВЕРЬ «метры → клетка тора» (`cell_of_metres@world/types.h`):
        // здесь эта свёртка была выписана в строку трижды, а у комнаты предмета
        // (`room_at_pos`) — ЧЕТВЁРТЫЙ раз и с усечением к нулю вместо `floor`,
        // то есть решение и мир расходились на шве тора.
        const int cx = cell_of_metres(tr.pos.x);
        const int cy = cell_of_metres(tr.pos.y);
        const int cz = cell_of_metres(tr.pos.z);

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
        if (plan.room != kNoRoom && goal == nullptr) {
            plan.room = kNoRoom;
            plan.verb = static_cast<VerbId>(kVerbCount);
        }

        // ПРИБЫЛ = ВНУТРИ БОКСА (S13.3). Второе условие — на случай клетки,
        // отданной перекрытием соседней комнате (`overlapCells` считается
        // вслух и бывает непустым): без него цель оказалась бы недостижимой
        // ПО ПОСТРОЕНИЮ, а не по геометрии.
        if (plan.room != kNoRoom && goal != nullptr) {
            int tx = 0, ty = 0, tz = 0;
            place_target_cell(fr, *goal, cx, cy, cz, tx, ty, tz);
            // ТРЕТЬЕ УСЛОВИЕ — ЗОНА РАЗБИВКИ (§88/E). С навом по зонам цель
            // ЕСТЬ зона, и дошёл тот, кто в ней стоит. Разбивка шире
            // объявленного бокса (она впитала коридор между комнатами), и это
            // не поблажка: предложение и глаголы живут НА ЗОНЕ, а тело внутри
            // зоны их и получает. Без этого условия поле вело бы тело до
            // границы зоны, а прибытие ждало бы объявленных клеток — то есть
            // последнюю ногу пришлось бы идти вслепую, ровно как с остатком
            // якоря у решётки.
            if (room_at(fr, cx, cy, cz) == plan.room ||
                zone_of_body(*zones, cx, cy, cz) == plan.room ||
                (cx == tx && cy == ty && cz == tz)) {
                ++out.arrived;
                plan.room = kNoRoom;
                plan.verb = static_cast<VerbId>(kVerbCount);
                plan.nextPickAt = stagger();
                // Дошёл — цель снята, и тело падает в ветку «сумма сказала
                // оставайся» НИЖЕ, то есть прибытие и есть вход в деяние
                // (S24). Своей ветки у прибытия нет СОЗНАТЕЛЬНО: деяние
                // вешается на СОСТОЯНИЕ «стою там, где предлагают», а не на
                // событие прихода, — замер показал, что 375 тел из 379 стоят
                // в коридорах и никуда не идут, то есть событие прихода
                // обслуживало бы четыре тела из трёхсот семидесяти девяти.
            }
        }

        // ВЫБОР — ПО СОБЫТИЮ: только когда цели нет и стаггер истёк.
        if (plan.room == kNoRoom) {
            // (1) ЗАНЯТ ДЕЯНИЕМ — сумму не спрашиваем вовсе. Порядок не
            // вкусовой: занятость монотонна (S22.1), и если спросить сумму
            // раньше, легшее спать тело получило бы на ближайшем кадансе
            // новую цель и ушло бы досыпать НА ХОДУ, а окно закрылось бы само
            // и уронило эффект по дороге.
            if (serve_busy(ServeCtx{reg, pool, fr, bus, tick}, e, id, tr.pos,
                           layer, srv)) {
                hold_still(brain, view.get<Velocity>(e));
                ++out.serving;
                continue;
            }
            if (now >= static_cast<double>(plan.nextPickAt)) {
                const Needs row = needs_row_for(pool, id);
                DemandE3 demand[kVerbCount];
                demand_from_needs(row, demand);
                demand_add_health(static_cast<float>(pool.hp(id)),
                                  static_cast<float>(pool.max_hp(id)), demand);
                const PlacePick pick = place_pick(fr, demand, cx, cy, cz);
                out.judged += pick.judged;
                out.bins += pick.bins;
                plan.nextPickAt = stagger();
                if (pick.room != kNoRoom) {
                    plan.room = pick.room;
                    plan.verb = pick.verb;  // ярлык пары — ЗАЧЕМ тело идёт
                    ++plan.picks;
                    ++out.picked;
                    goal = room_of(fr, plan.room);
                }
                // Иначе «ничто не обгоняет место под ногами» — законный
                // ответ, а не неудача, и дальше его обслуживает деяние.
            }
            // (3) ДЕЯНИЕ НА МЕСТЕ — ТОЛЬКО ПО ОТВЕТУ СУММЫ (S24, закон 1).
            // Цели нет ⟺ последний ответ суммы был «оставайся», поэтому
            // деяние ей не противоречит; тело с целью сюда не попадает и идёт.
            if (plan.room == kNoRoom) {
                if (serve_begin(ServeCtx{reg, pool, fr, bus, tick}, e, id,
                                tr.pos, srv)) {
                    hold_still(brain, view.get<Velocity>(e));
                    ++out.serving;
                    continue;
                }
                ++out.idle;
                continue;
            }
        }
        if (goal == nullptr) {
            ++out.idle;
            continue;
        }
        if (plan.verb < kVerbCount) ++out.byVerb[plan.verb];

        // КУДА ШАГНУТЬ — НАВ ПО ЗОНАМ, ДВА ЧТЕНИЯ, и ни одной волны (§88/E).
        // Цель — ЗОНА, а не клетка: таблица даёт соседку, плоскость соседки
        // даёт направление. Ступеньку разрешает сама дверь, поэтому ветки на
        // вертикаль здесь нет.
        //
        // Клетки цели этот шаг БОЛЬШЕ НЕ СПРАШИВАЕТ, и это следствие сноса
        // решётки: `route_step` композировал два запечённых яруса и отвечал
        // «шаг к ближайшему ЯКОРЮ цели», поэтому ему нужна была клетка. У зон
        // цель и есть узел графа. Клетку по-прежнему считает ПРИБЫТИЕ выше
        // (третьим условием, на случай клетки, отданной перекрытию).
        //
        // Отказ «у комнаты нет клетки» тоже уехал сюда: его отдаёт сама
        // таблица зон (`kZoneUnreachable` -> `kZoneFlowNone`), и это честнее —
        // прежняя проверка `place_target_cell < 0` считала такое тело `idle`,
        // то есть молча, а теперь оно считается `unreachable` и видно прибору.
        //
        // Зона тела — через дверь с опорой на соседа: клетка центра тела
        // бывает дыркой в разбивке (замер: 26 тел на тик), и это следствие
        // названной неточности клиренса, а не дефект разбивки.
        const RoomId myZone = zone_of_body(*zones, cx, cy, cz);
        if (myZone == kNoRoom) {
            // Тело стоит там, где по карте путей стоять нельзя (нет
            // касания): вести его некуда, отдаём вандеру.
            ++out.offnav;
            ++out.idle;
            continue;
        }
        const std::uint8_t d = zone_walk_dir(*zones, myZone, plan.room, cx, cy,
                                             cz, gf.pull ? gf.axis : -1);
        // Прибор прогресса: расстояние в ЗОНАХ до цели. Σ по ведомым телам
        // падает ⟺ ходок доходит.
        const std::uint16_t zd = zones->dist.at(
            static_cast<std::uint32_t>(myZone) - 1u,
            static_cast<std::uint32_t>(plan.room) - 1u);
        if (zd != kZoneUnreachable) {
            out.zoneDistSum += zd;
            ++out.zoneDistBodies;
        }
        if (d == kZoneFlowNone) {
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
        // `zone_walk_dir` по контракту ([game/zone_nav.h]) отдаёт 0..5 либо
        // `kZoneFlowNone`, а он снят условием выше — поэтому индекс словаря
        // направлений законен по построению, и ветки «не шаг» здесь больше нет.
        vec3 dir{0.0f, 0.0f, 0.0f};
        if ((d >> 1) == gf.axis) {
            // Единственный случай, когда дверь зон отдаёт шаг ВДОЛЬ гравитации:
            // ступенька и есть выход из зоны. Тангенциального пеленга у него
            // ровно ноль, то есть вести этим шагом нечем — тело отдаётся
            // вандеру, а цель ОСТАЁТСЯ (токен не забран). Слепую прямую на цель
            // здесь не берём сознательно: ровно она была остатком якоря у
            // решётки и стоила §88 нуля прибытий.
            ++out.idle;
            continue;
        }
        // ШАГ В ПЛОСКОСТИ ХОДЬБЫ: целимся в ЦЕНТР следующей клетки — то же
        // самоисправляющееся правило, которым идёт патруль.
        //
        // СЛЕПОЙ ПРЯМОЙ НА ЦЕЛЬ ЗДЕСЬ БОЛЬШЕ НЕТ, и это и есть выигрыш сноса.
        // Она стояла второй ветвью и брала 85% ответов — ЗАМЕР живого прогона
        // 2026-10-01 (этаж 6, 800 тыс. вызовов маршрута): `+z` дал 637 256
        // ответов против 143 тыс. горизонтальных на все четыре стороны. Причина
        // была не в выборе цели, а в оракуле: поля потока печены над «тело
        // ВЛЕЗАЕТ в клетку» (`ClearanceField@src/world/clearance.h`), у которого
        // нет понятия ОПОРЫ, поэтому кратчайший путь к якорю шёл ПО ВОЗДУХУ, и
        // ходок за ним следовать не мог по построению. Остаток якоря приходилось
        // идти прямой, прямая не знала стен, и её приходилось страховать
        // проверкой `nearest_node`. Зоны отвечают шагом ПО ПРОХОДИМОЙ грани
        // всегда — ни остатка, ни прямой, ни страховки.
        const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
        const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
        const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
        dir = tangent(
            wrap_delta_f(tr.pos.x, (static_cast<float>(nx) + 0.5f) * kCellSize, kWorldExtent),
            wrap_delta_f(tr.pos.y, (static_cast<float>(ny) + 0.5f) * kCellSize, kWorldExtent),
            wrap_delta_f(tr.pos.z, (static_cast<float>(nz) + 0.5f) * kCellSize, kWorldExtent));

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
        //
        // Токен СВОЙ (`Errand`), а не занятый у бегства: дело — это ходьба, а
        // не паника (S24). Для `wander_step` и `faction_feud_step` разницы
        // нет — их guard спрашивает «не Wander»; разница есть у этого прохода,
        // который по `Ai` узнаёт УГРОЗУ.
        brain.motion = static_cast<std::uint8_t>(MotionOwner::Errand);
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

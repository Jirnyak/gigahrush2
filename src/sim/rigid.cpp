#include "sim/rigid.h"

#include <algorithm>
#include <chrono> // RigidStats — мс фаз последнего тика ([prof] в main.cpp)
#include <cmath>
#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "sim/cell_bins.h" // общий примитив клеточных бинов — ключ и контейнер
#include "sim/drag.h"
#include "sim/presence.h" // пузырь вокруг наблюдателя — ОДИН на дерево (§23)
#include "world/destruct.h" // sub_material_at — материал контактного АТОМА
#include "world/material_props.h" // material_hardness — мат-пара контакта
#include "world/world.h"

namespace giga {

namespace {

int floor_div(float v, float s) {
    return static_cast<int>(std::floor(v / s));
}

// Глубочайший контакт сферы с субвокселями мира (S2: локальный вопрос
// спрашивает атомы). Перебор — только субвоксели, чьи AABB пересекает AABB
// сферы: для r≈0.35 м это ≤4 на ось, десятки битовых проб. Возвращает depth<0,
// если контакта нет. Нормаль — от ближайшей точки бокса к центру сферы; на
// плоском полу ближайшая точка лежит на верхней грани и нормаль честно «вверх»
// без единой ветки по осям — изотропно (S1).
struct SphereContact {
    vec3 n{0.0f, 0.0f, 1.0f};
    float depth = -1.0f;
    CellType mat = 0; // материал клетки контакта — вторая половина мат-пары
};

SphereContact sphere_deepest_contact(const World& world, vec3 pos, float r) {
    SphereContact best;
    int bestCx = 0, bestCy = 0, bestCz = 0;
    int bestSx = 0, bestSy = 0, bestSz = 0;

    const int x0 = floor_div(pos.x - r, kVoxelSize);
    const int x1 = floor_div(pos.x + r, kVoxelSize);
    const int y0 = floor_div(pos.y - r, kVoxelSize);
    const int y1 = floor_div(pos.y + r, kVoxelSize);
    const int z0 = floor_div(pos.z - r, kVoxelSize);
    const int z1 = floor_div(pos.z + r, kVoxelSize);

    const MacroGrid& grid = world.grid();
    const float r2 = r * r;

    for (int vz = z0; vz <= z1; ++vz) {
        const int cz = floor_div(static_cast<float>(vz),
                                 static_cast<float>(kSubDim));
        const int sz = vz - cz * kSubDim;
        for (int vy = y0; vy <= y1; ++vy) {
            const int cy = floor_div(static_cast<float>(vy),
                                     static_cast<float>(kSubDim));
            const int sy = vy - cy * kSubDim;
            for (int vx = x0; vx <= x1; ++vx) {
                const int cx = floor_div(static_cast<float>(vx),
                                         static_cast<float>(kSubDim));
                const int sx = vx - cx * kSubDim;

                const SubMask& mask =
                    grid.mask(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
                if (mask.empty()) continue;
                const std::uint64_t bit =
                    1ULL << (sy * kSubDim + sx);
                if (!(mask.words[sz] & bit)) continue;

                // Ближайшая точка субвоксельного AABB к центру сферы.
                const float bx0 = static_cast<float>(vx) * kVoxelSize;
                const float by0 = static_cast<float>(vy) * kVoxelSize;
                const float bz0 = static_cast<float>(vz) * kVoxelSize;
                const vec3 closest{
                    std::clamp(pos.x, bx0, bx0 + kVoxelSize),
                    std::clamp(pos.y, by0, by0 + kVoxelSize),
                    std::clamp(pos.z, bz0, bz0 + kVoxelSize)};
                const vec3 d = pos - closest;
                const float d2 = dot(d, d);
                if (d2 >= r2) continue;

                const float dist = std::sqrt(d2);
                const float depth = r - dist;
                if (depth <= best.depth) continue;

                if (dist > 1e-5f) {
                    best.n = d * (1.0f / dist);
                } else {
                    // Центр внутри тела вокселя (глубокий спавн/проникание):
                    // толкаем от центра вокселя; если и это ноль — вверх не
                    // выбираем (изотропия), берём от центра клетки мира некуда —
                    // оставляем прежнюю нормаль (следующий подшаг уточнит).
                    const vec3 vc{bx0 + 0.5f * kVoxelSize,
                                  by0 + 0.5f * kVoxelSize,
                                  bz0 + 0.5f * kVoxelSize};
                    const vec3 dc = pos - vc;
                    const float dcl = length(dc);
                    if (dcl > 1e-5f) best.n = dc * (1.0f / dcl);
                }
                best.depth = depth;
                bestCx = wrap_macro(cx);
                bestCy = wrap_macro(cy);
                bestCz = wrap_macro(cz);
                bestSx = sx;
                bestSy = sy;
                bestSz = sz;
            }
        }
    }
    // Материал КОНТАКТНОГО СУБВОКСЕЛЯ, не клетки (закон двух масштабов S2:
    // клеточный тип — кэш, на страничных клетках он врёт про атом; аудит
    // 2026-08-25: точный субвоксель находился и выбрасывался, а твёрдость/
    // трение/отскок каждого тела о мир брались у клетки).
    if (best.depth >= 0.0f)
        best.mat = sub_material_at(world, bestCx, bestCy, bestCz, bestSx,
                                   bestSy, bestSz);
    return best;
}

// Пороги сна и пробуждения — выведены, не назначены (S11):
// kSleepV: 0.05 м/с × тик 8 мс = 0.4 мм за тик — на глаз неподвижно
// (1/600 субвокселя). kSleepAfter: 32 тика = 0.26 с тишины c контактом.
// kWakeV: в 2 раза выше порога сна, чтобы шум записи не будил.
constexpr float kSleepV = 0.05f;
constexpr float kSleepV2 = kSleepV * kSleepV;
constexpr int kSleepAfter = 32;
constexpr float kWakeV2 = (2.0f * kSleepV) * (2.0f * kSleepV);

// Сколько тишины надо, чтобы ПУЗЫРЬ поверил в покой тела. НЕ НОВОЕ ЧИСЛО —
// ровно kSleepAfter: вопрос «сколько тишины достаточно» в этом движке уже имеет
// ответ, и второй ответ был бы вторым словарём (matwej.md §24.4 п.1). От
// предиката сна застывание отличается ОДНИМ: оно не требует КОНТАКТА, потому
// что контакт — это про опору, а не про движение, и именно его не получают
// трупы, лежащие на спящих трупах (§64). Полный вывод и проверка на вершине
// параболы — у поля `quietTicks` в [ecs/components.h].
constexpr int kSuspendQuietTicks = kSleepAfter;

// Порог отскока: ниже этой скорости сближения контакт не отскакивает, а
// оседает — иначе restitution дребезжит на микроконтактах. Выведен от
// гравитации и подшага: свободное падение за 2 подшага ≈ 9.8·0.008 = 0.08 м/с,
// порог на порядок выше, чтобы гасить именно численный шум, а не игровые удары.
constexpr float kBounceMinV = 0.8f;

// Трение качения: Crr твёрдое-по-твёрдому ≈ 0.02–0.05 (справочное значение
// для стали по бетону; крутится глазами владельца — метод эпика).
constexpr float kRollCrr = 0.03f;

// Сверление (spin вокруг нормали контакта): чистый вертикальный волчок не
// тормозится ни Кулоном (v_контакта = 0), ни качением — гасим экспонентой с
// той же постоянной, что качение.
constexpr float kSpinDamp = 3.0f; // 1/с
// ЗДЕСЬ СТОЯЛИ СТИКЦИЯ (`kStictionRate = 20/с`) И ЛЮФТ СУСТАВА
// (`kJointSlop = 1 см`) — СНЕСЕНЫ 2026-09-30 решением владельца, и это
// стоит одного абзаца, потому что обе были «несущими ногами» лечения §64
// от 2026-08-31 и полтора месяца так и числились.
//
// Корень §64 оказался в другом (рагдолл сталкивался сам с собой, §64а), и
// после его закрытия мутации в ноль дали ЗЕЛЁНЫМ всё дерево — ни одна
// проверка их не держала. Дозамер по четырём материалам (µ пары
// 0.346–0.735, весь диапазон таблицы) и наклонам 10–35°:
//   * стикция меняла выбег тихого мяча с 0.058 на 0.039 м и ускоряла
//     засыпание на 0.2 с — и больше ничего, ни на одном материале;
//   * люфт ВРЕДИЛ: остаточная ошибка сустава уснувшей кучи 0.0119 м с ним
//     против 0.0019 м без — в 6 раз грубее, и спящих меньше (147 против
//     156 в самой плотной раскладке), потому что он разрешал суставу быть
//     растянутым и держал трупы слегка расползшимися.
// Решение владельца: «сносим для чистоты; полировать ядро лучше потом,
// когда стабилизируем — будет уже из минимума систем решать, что делать».
//
// Что осталось делать их работу: трение Кулона через точку контакта,
// трение качения (`kRollCrr`) и гашение сверления (`kSpinDamp`) — всё
// выведенное из физики, а не из ощущения. ЧЕГО НЕ ХВАТАЕТ, названо
// числом в §64в: статического трения в этой схеме нет как закона (ящик
// съезжает с 25° при µ 0.671, и порог съезда НЕ двигается с материалом).
// Стикция его не давала тоже — проверено мутацией.

// Линки: итерации sequential impulses на подшаг (цепь из ~8 звеньев сходится
// за столько же проходов — по звену за проход в худшем случае) и
// Baumgarte-подтяжка позиционной ошибки: β·C/h, β=0.2 — стандартная доля,
// при которой подтяжка не накачивает энергию на наших подшагах 2-4 мс.
constexpr int kJointIters = 8;
constexpr float kJointBias = 0.2f;

// Биннинг пар: ключ = (слой, клетка 128³) — близость решается сеткой (S9,
// глобальных все-со-всеми не существует). Запрос соседей корректен, пока
// ограничивающий ДИАМЕТР тела ≤ клетки (2 м): радиус > 1 м может пропустить
// пару — таких пропов в таблице нет, а стендовые боксы обрезаны по 1.5 м
// полугабарита осознанно (стенд, не контент).
//
// Работа идёт по ПРОБЕГАМ (клетка = отрезок отсортированного массива), и
// соседи ищутся раз на КЛЕТКУ С БОДРЫМИ телами, не раз на тело: спящий мир
// не платит за фазу пар вообще (замер 2026-08-21: наивные 27 поисков на
// тело давали 4.5 мс/тик на 4096 бодрых и 0.37 мс на спящих).
// Записи бинов — CellBins ([sim/cell_bins.h]); здесь остаётся только
// НАДСТРОЙКА этого потребителя: пробеги и слияние соседних клеток в пары.
struct BinRun {
    std::uint64_t key;
    std::uint32_t lo, hi; // [lo, hi) в entries соответствующего CellBins
    int cx, cy, cz;       // клетка (wrap), для ключей соседей
    LayerId layer;
    bool awake;           // есть ли бодрое тело (снимок начала тика)
};

// Агент (игрок/NPC — тело свепт-AABB из physics_step) в словаре солвера:
// ДВЕ сферы вдоль длинной оси его AABB, радиус — из тонкой стороны. Вывод,
// не назначение (S11): r = min(half), центры на ±(maxHalf − r) — сферы
// вписаны в бокс заподлицо с торцами. Изотропно: длинная ось — какая есть,
// не «вертикаль».
struct AgentForm {
    vec3 off[2];
    float r;
    float bound; // радиус ограничивающей сферы — брод-фаза
};

AgentForm agent_form(vec3 half) {
    AgentForm f;
    f.r = std::min({half.x, half.y, half.z});
    const float hx = half.x, hy = half.y, hz = half.z;
    vec3 axis{0.0f, 0.0f, 0.0f};
    float longest = hz;
    if (hx >= hy && hx >= hz) { axis = vec3{1.0f, 0.0f, 0.0f}; longest = hx; }
    else if (hy >= hz) { axis = vec3{0.0f, 1.0f, 0.0f}; longest = hy; }
    else { axis = vec3{0.0f, 0.0f, 1.0f}; longest = hz; }
    const float reach = std::max(0.0f, longest - f.r);
    f.off[0] = axis * reach;
    f.off[1] = axis * (-reach);
    f.bound = reach + f.r;
    return f;
}

} // namespace

void rigid_body_step(Registry& reg, LevelStack& stack, float dt) {
    if (dt <= 0.0f) return;

    // Подшаг выведен: терминальная скорость воздуха ~55.5 м/с ([sim/drag.h]),
    // за подшаг тело не должно пролетать самую тонкую стену (1 субвоксель,
    // kVoxelSize = 0.25 м): 0.25 / 55.5 = 4.5 мс → подшаг ≤ 4 мс, тик 8 мс →
    // 2 подшага.
    constexpr float kMaxStep = 0.004f;
    const int steps = std::clamp(
        static_cast<int>(std::ceil(dt / kMaxStep)), 1, 4);
    const float h = dt / static_cast<float>(steps);

    auto view = reg.view<RigidBody, Transform, Velocity>();
    auto links = reg.view<JointLink>();

    // Объявлен ДО лямбд солвера: счётчики пробуждений по источнику стоят в
    // самих точках сброса сна, а не считаются задним числом по сумме.
    RigidStats stats; // замер §59.11 — пишется в reg.ctx() на каждом выходе

    // БУДИТ ДВИЖУЩАЯСЯ СТОРОНА — один предикат на связь И на пару (§64,
    // пара сведена 2026-11-25): тело, чья точка движется не медленнее
    // `kWakeV2` (линейно или вращением на радиусе), может разбудить спящего
    // соседа; почти неподвижное — нет, иначе два тихих тела со сдвинутыми
    // счётчиками будят друг друга по очереди вечно.
    auto moving = [](const RigidBody& rb, const vec3& v) {
        return dot(v, v) >= kWakeV2 ||
               dot(rb.w, rb.w) * rb.radius * rb.radius >= kWakeV2;
    };

    // Решение одного линка импульсом (sequential impulses, тот же словарь,
    // что у контакта). wakePass — на первой итерации подшага спящая сторона
    // будится движущейся: цепь просыпается через связи, а не по волшебству.
    auto solve_link = [&](JointLink& jl, bool wakePass) {
        if (jl.a == entt::null || !reg.valid(jl.a) ||
            !reg.all_of<RigidBody, Transform, Velocity>(jl.a))
            return; // тело умерло — линк вырожден, чистит владелец линка
        auto& ra = reg.get<RigidBody>(jl.a);
        auto& ta = reg.get<Transform>(jl.a);
        auto& va = reg.get<Velocity>(jl.a);
        RigidBody* rbB = nullptr;
        Transform* tb = nullptr;
        Velocity* vb = nullptr;
        if (jl.b != entt::null) {
            if (!reg.valid(jl.b) ||
                !reg.all_of<RigidBody, Transform, Velocity>(jl.b))
                return;
            rbB = &reg.get<RigidBody>(jl.b);
            tb = &reg.get<Transform>(jl.b);
            vb = &reg.get<Velocity>(jl.b);
        }
        if (wakePass) {
            // ЗАСТЫВШИЙ — тоже «спящая сторона» для этого закона, и это не
            // удобство, а §23.1: цепь, у которой один сегмент уже ожил (пнул
            // агент, выкарвили опору, кинули взрывом), обязана ожить целиком —
            // иначе остальные сегменты стоят, пока ожившие тянут, и труп
            // растягивается на глазах. Пузырь ставит бит ПО ЦЕПИ, а снимается
            // он здесь ПО СВЯЗИ — тем же механизмом, которым распространяется
            // пробуждение из сна, и список `liveLinks` пересобирается КАЖДЫЙ
            // ПОДШАГ, поэтому распространение идёт внутри того же тика.
            const bool aAsleep = ra.asleep || ra.suspended;
            const bool bAsleep = rbB ? (rbB->asleep || rbB->suspended) : true;
            if (aAsleep != bAsleep) {
                // Будит ДВИЖУЩАЯСЯ сторона — как проза выше и обещала;
                // код же будил ПРОСТО БОДРОЙ. Почти неподвижный бодрый
                // сосед вечно сбрасывал сон партнёра — сегменты одного
                // трупа копили sleepTicks 4/16/22 и никогда не доходили
                // до 32 все разом (пинг-понг сбросов, §64). Порог — тот
                // же kWakeV2, что у всех пробуждений.
                const RigidBody& mover = aAsleep ? *rbB : ra;
                const vec3& mv = aAsleep ? vb->v : va.v;
                if (moving(mover, mv)) {
                    // `nullptr` у b — МИРОВОЙ ЯКОРЬ, а не тело: будить нечего,
                    // и разыменовать его нельзя. Ровно эта развилка стояла и
                    // до пузыря (`else if (rbB)`), просто теперь поднимать
                    // надо два бита, и повторять развилку дважды не стоит.
                    RigidBody* sleeper = aAsleep ? &ra : rbB;
                    if (sleeper) {
                        if (sleeper->suspended) {
                            sleeper->suspended = false;
                            sleeper->quietTicks = 0;
                            ++stats.unsuspLink;
                        }
                        if (sleeper->asleep) {
                            sleeper->asleep = false;
                            sleeper->sleepTicks = 0;
                        }
                    }
                    ++stats.wokeLink;
                }
            }
        }
        if ((ra.asleep || ra.suspended) &&
            (!rbB || rbB->asleep || rbB->suspended))
            return;

        // Несомое тело КИНЕМАТИЧНО в линке: обратные масса и инерция ноль —
        // импульс его не двигает, но тянет вторую сторону. Так труп волочится
        // за тащимым корнем, а не растаскивает носителя.
        //
        // СПЯЩАЯ (И ЗАСТЫВШАЯ) СТОРОНА, КОТОРУЮ ПРОХОД ПРОБУЖДЕНИЯ ВЫШЕ НЕ
        // РАЗБУДИЛ, — ТОЖЕ НЕПОДВИЖНА (2026-11-25, И1б). До этого импульс
        // сустава делился с ней по её массе, а спящее тело не интегрируется
        // и не свипуется — скорость на нём КОПИЛАСЬ тик за тиком и потом
        // будила его как «запись извне», которой никто не делал. Замер на
        // куче из 16 семичастных трупов: таз стоял неподвижно (z до 0.1 мм),
        // но раз в ~0.3 с засыпал и просыпался, неся во сне w до 0.49 рад/с
        // от бодрого соседа; куча не досыпала 12–14 тел из 112 никогда.
        // Будить спящего — работа прохода пробуждения (движущийся сосед,
        // `kWakeV2`), а не тихий импульс в обход сна.
        const bool aKinematic = reg.all_of<CarriedBy>(jl.a) || ra.asleep ||
                                ra.suspended;
        const bool bKinematic =
            rbB && (reg.all_of<CarriedBy>(jl.b) || rbB->asleep ||
                    rbB->suspended);
        if (aKinematic && (bKinematic || !rbB)) return; // двигать нечего
        const float imA = aKinematic ? 0.0f : ra.invMass;
        const float iiA = aKinematic ? 0.0f : ra.invInertia;
        const float imB = !rbB ? 0.0f : (bKinematic ? 0.0f : rbB->invMass);
        const float iiB = !rbB ? 0.0f : (bKinematic ? 0.0f : rbB->invInertia);

        const vec3 rcA = quat_rotate(ra.q, jl.anchorA);
        const vec3 pa = ta.pos + rcA;
        vec3 rcB{0.0f, 0.0f, 0.0f};
        vec3 pb;
        if (rbB) {
            rcB = quat_rotate(rbB->q, jl.anchorB);
            pb = tb->pos + rcB;
        } else {
            pb = jl.anchorB; // мировой якорь (подвес)
        }
        // Кратчайший вектор ТОРА от a к b — линк через шов не рвётся.
        const vec3 d = wrap_delta3(pa, pb, kWorldExtent);

        // ШАРНИР «ТОЧКА В ТОЧКУ» (CANON S28): нулевая длина покоя значит,
        // что точки якорей обязаны СОВПАСТЬ — сустав тела из частей (плечо,
        // бедро, шея). Связь расстояния тут вырождена: направление d/|d| при
        // совпадении не определено, и прежний путь выходил при dist < 0.1 мм,
        // а поперечную скорость внутри подшага не держал ничем — сустав был
        // резиновым. Точка — ТРИ связи, по одной на ось мира, тем же
        // импульсом; оси равноправны (S1). Ошибку позиции здесь не тянут
        // скоростью — её проецирует `project_point_joint` (вывод там).
        // Верёвка здесь смысла не имеет: тянуть к совпадению и толкать от
        // него — одно и то же.
        if (jl.restLen <= 0.0f) {
            const vec3 axes[3] = {vec3{1.0f, 0.0f, 0.0f},
                                  vec3{0.0f, 1.0f, 0.0f},
                                  vec3{0.0f, 0.0f, 1.0f}};
            for (const vec3& n : axes) {
                const vec3 vpA = va.v + cross(ra.w, rcA);
                const vec3 vpB = rbB ? vb->v + cross(rbB->w, rcB)
                                     : vec3{0.0f, 0.0f, 0.0f};
                const float vRel = dot(vpB - vpA, n);
                const vec3 rxA = cross(rcA, n);
                float k = imA + iiA * dot(rxA, rxA);
                if (rbB) {
                    const vec3 rxB = cross(rcB, n);
                    k += imB + iiB * dot(rxB, rxB);
                }
                if (k < 1e-9f) continue; // обе стороны кинематичны
                // ПОДТЯЖКИ ЗДЕСЬ НЕТ — разделённый импульс (2026-11-25, И1б):
                // ошибку ПОЗИЦИИ шарнира убирает `project_point_joint`
                // позицией, а не скоростью. Вывод — у неё.
                const float j = -vRel / k;
                va.v += n * (-j * imA);
                ra.w += cross(rcA, n * (-j)) * iiA;
                if (rbB) {
                    vb->v += n * (j * imB);
                    rbB->w += cross(rcB, n * j) * iiB;
                }
            }
            return;
        }

        const float dist = length(d);
        if (dist < 1e-4f) return;
        const vec3 dir = d * (1.0f / dist);
        const float C = dist - jl.restLen;
        if (jl.rope && C <= 0.0f) return; // верёвка не толкает

        const vec3 vpA = va.v + cross(ra.w, rcA);
        const vec3 vpB =
            rbB ? vb->v + cross(rbB->w, rcB) : vec3{0.0f, 0.0f, 0.0f};
        const float vRel = dot(vpB - vpA, dir); // >0 — растягивается
        const vec3 rxA = cross(rcA, dir);
        const float kA = imA + iiA * dot(rxA, rxA);
        float kB = 0.0f;
        if (rbB) {
            const vec3 rxB = cross(rcB, dir);
            kB = imB + iiB * dot(rxB, rxB);
        }
        if (kA + kB < 1e-9f) return; // обе стороны кинематичны/мировые
        // Импульс с Baumgarte-подтяжкой позиционной ошибки: β·C/h. Люфта
        // здесь больше нет (см. абзац у констант): сустав стягивается до
        // конца, и остаток уснувшей кучи упал 0.0119 → 0.0019 м.
        const float j = -(vRel + kJointBias * C / h) / (kA + kB);
        // j<0 при растяжении: B тянется к A, A — к B.
        va.v += dir * (-j * imA);
        ra.w += cross(rcA, dir * (-j)) * iiA;
        if (rbB) {
            vb->v += dir * (j * imB);
            rbB->w += cross(rcB, dir * j) * iiB;
        }
    };

    // Пара тел ([markoaudit/plans/ragdoll.md] инкремент 4): брод —
    // ограничивающие сферы через тор, нарроу — пары контактных сфер (словарь
    // солвера один — сфера), разрешение — тот же импульс, что о мир, но
    // двухтеловой. Касание будит спящего (бодрый врезается в кучу — куча
    // оживает) и считается опорой (touchedTick: стопка тел засыпает).
    // ПОЗИЦИОННОЕ ВЫТАЛКИВАНИЕ — ЧЕРЕЗ ТОЧКИ КОНТАКТА, ОДИН ЗАКОН ДЛЯ МИРА И
    // ДЛЯ ПАРЫ (2026-11-25, И1б эпика тел). До этого тело выталкивалось
    // ЦЕЛИКОМ, переносом на глубину: угол, вошедший в пол, поднимал всё тело
    // вместе с противоположным углом — каждый подшаг качания впрыскивал
    // m·g·depth потенциальной энергии, и тонкая часть трупа (рука на двух
    // углах кисти и шарнире плеча) раскачивалась вокруг своей оси вечно.
    // Замер на одиноком 7-частном трупе: с переносом сна нет и через 12 с,
    // через точку контакта — спят все 7 к 6 с. Форма: точку контакта сдвинуть
    // на глубину вдоль нормали, деля сдвиг на перенос и поворот теми же
    // обратными массой и инерцией, что у импульса контакта (k = 1/m +
    // |r×n|²/I, сумма по сторонам), — минимальная поправка, а не выбор.
    // У сферы плечо коллинеарно нормали, поворотная доля ноль, и закон
    // вырождается в прежний перенос по долям обратных масс ТОЧНО.
    // `n` смотрит от A к B; A (если есть) уступает назад, B — вперёд.
    // Сторона без тела (`ra == nullptr`) — мир: неподвижна.
    auto contact_project = [](Transform* ta, RigidBody* ra, const vec3& rcA,
                              Transform* tb, RigidBody* rb, const vec3& rcB,
                              const vec3& n, float depth) {
        const vec3 rxA = cross(rcA, n);
        const vec3 rxB = cross(rcB, n);
        const float kA =
            ra ? ra->invMass + ra->invInertia * dot(rxA, rxA) : 0.0f;
        const float kB =
            rb ? rb->invMass + rb->invInertia * dot(rxB, rxB) : 0.0f;
        const float k = kA + kB;
        if (k < 1e-9f) return;
        const float lam = depth / k;
        if (ra) {
            ta->pos += n * (-lam * ra->invMass);
            ra->q = quat_integrate(ra->q, rxA * (-lam * ra->invInertia), 1.0f);
        }
        if (rb) {
            tb->pos += n * (lam * rb->invMass);
            rb->q = quat_integrate(rb->q, rxB * (lam * rb->invInertia), 1.0f);
        }
    };

    // ШАРНИР ГАСИТ ОТНОСИТЕЛЬНОЕ ВРАЩЕНИЕ ЧАСТЕЙ (2026-11-25, И1б).
    // Точечный сустав по построению не держит вращения вокруг оси через себя
    // («кручение»), и стока энергии у этой степени свободы не было никакого:
    // голова, висящая на шее над полом, крутилась ~4 рад/с вечно (куча из 16
    // семичастных трупов, 5 тел не засыпали никогда; с законом — все 112 к
    // 9.9 с). Сустав — поверхность контакта двух частей, и гасится он ТЕМ ЖЕ
    // законом и ТОЙ ЖЕ постоянной, что сверление в контакте (`kSpinDamp`):
    // второй постоянной вращательного трения в этом движке нет. Момент
    // внутренний — гасится только ОТНОСИТЕЛЬНОЕ вращение, сумма моментов
    // импульса сторон сохраняется. Раз на подшаг, до итераций. Спящая,
    // застывшая и несомая стороны неподвижны (тот же довод, что у импульса).
    // Связь-расстояние (`restLen > 0`, верёвка) не гасится: у неё замера нет.
    auto damp_point_joint = [&](const JointLink& jl) {
        if (jl.restLen > 0.0f || jl.a == entt::null || jl.b == entt::null)
            return;
        if (!reg.valid(jl.a) || !reg.valid(jl.b) ||
            !reg.all_of<RigidBody>(jl.a) || !reg.all_of<RigidBody>(jl.b))
            return;
        auto& ra = reg.get<RigidBody>(jl.a);
        auto& rb = reg.get<RigidBody>(jl.b);
        const float iiA =
            (ra.asleep || ra.suspended || reg.all_of<CarriedBy>(jl.a))
                ? 0.0f
                : ra.invInertia;
        const float iiB =
            (rb.asleep || rb.suspended || reg.all_of<CarriedBy>(jl.b))
                ? 0.0f
                : rb.invInertia;
        if (iiA + iiB < 1e-9f) return;
        const vec3 L = (ra.w - rb.w) *
                       ((1.0f - std::exp(-kSpinDamp * h)) / (iiA + iiB));
        ra.w += L * (-iiA);
        rb.w += L * iiB;
    };

    // ИМПУЛЬС КОНТАКТА — ОДИН ЗАКОН ДЛЯ МИРА И ДЛЯ ПАРЫ, И ДЛЯ ПЕРВОГО
    // РЕШЕНИЯ, И ДЛЯ ПОВТОРНОГО внутри итераций суставов (ниже,
    // `chainContacts`). Обобщённый нормальный импульс (sequential impulses):
    // k = Σ(1/m + |r_c×n|²/I) по сторонам — угловая податливость контакта;
    // затем Кулоново трение ЧЕРЕЗ ТОЧКУ КОНТАКТА (скорость точки — после
    // нормального импульса): тормозя скольжение точки, импульс раскручивает
    // тело — качение возникает из физики. `n` смотрит от A к B; сторона A без
    // тела (`ra == nullptr`) — мир. `e` — отскок, уже решённый вызывающим по
    // скорости удара. До 2026-11-25 закон стоял ДВУМЯ копиями (тело–мир и
    // тело–тело), различавшимися только тем, есть ли у A тело.
    auto contact_impulse = [](vec3* vA, RigidBody* ra, const vec3& rcA,
                              vec3& vB, RigidBody& rb, const vec3& rcB,
                              const vec3& n, float mu, float e) {
        auto rel = [&] {
            const vec3 pB = vB + cross(rb.w, rcB);
            return ra ? pB - (*vA + cross(ra->w, rcA)) : pB;
        };
        auto push = [&](const vec3& dir, float j) {
            if (ra) {
                *vA += dir * (-j * ra->invMass);
                ra->w += cross(rcA, dir * (-j)) * ra->invInertia;
            }
            vB += dir * (j * rb.invMass);
            rb.w += cross(rcB, dir * j) * rb.invInertia;
        };
        auto k_of = [&](const vec3& dir) {
            const vec3 xB = cross(rcB, dir);
            float k = rb.invMass + rb.invInertia * dot(xB, xB);
            if (ra) {
                const vec3 xA = cross(rcA, dir);
                k += ra->invMass + ra->invInertia * dot(xA, xA);
            }
            return k;
        };
        const float vn = dot(rel(), n);
        if (vn >= 0.0f) return;
        const float kn = k_of(n);
        if (kn < 1e-9f) return;
        const float jn = -(1.0f + e) * vn / kn;
        push(n, jn);
        const vec3 vp2 = rel();
        const vec3 vt = vp2 - n * dot(vp2, n);
        const float vtLen = length(vt);
        if (vtLen > 1e-5f) {
            const vec3 t = vt * (1.0f / vtLen);
            const float kt = k_of(t);
            float jt = -vtLen / kt;
            const float jtMax = mu * jn;
            jt = std::clamp(jt, -jtMax, jtMax);
            push(t, jt);
        }
    };

    // КОНТАКТЫ ЧАСТЕЙ ЦЕПИ — РЕШАЮТСЯ ВМЕСТЕ С СУСТАВАМИ (CANON S28, И1б,
    // 2026-11-25). Пока сустав держал ЦЕНТРЫ, плеча у него не было, и порядок
    // «контакт, затем восемь итераций суставов» был безвреден. Шарнир в точке
    // сустава даёт рычаг — и порядок стал войной двух законов об одном
    // положении (класс §64): итерации суставов оставляли скорость,
    // удовлетворяющую суставу и смотрящую В ПОЛ (или в соседний труп),
    // следующий подшаг входил туда, контакт выталкивал позицией, сустав
    // снова растягивался. Замер на одиноком трупе: зазор 2.5–4 мм на всех
    // суставах вечно, сна нет. Лечение — не третий закон, а один
    // Гаусс–Зейдель: контакт, найденный телом цепи на подшаге (с миром или
    // с телом ДРУГОЙ цепи), записывается строкой и решается тем же
    // `contact_impulse` в каждой итерации суставов ПОСЛЕ них — последнее
    // слово за непроникновением. Строка мира — пара без тела A. Тела вне
    // цепей (мяч, ящик) строк не пишут: их контакт и так окончательный.
    struct ChainContact {
        Entity a;      // entt::null — мир
        Entity b;
        vec3 offA;     // центр контактной сферы A в осях A (у мира не нужен)
        float rA;
        vec3 offB;     // центр контактной сферы B в осях B
        float rB;
        vec3 n;        // от A к B
        float mu;
    };
    static thread_local std::vector<ChainContact> chainContacts;

    auto resolve_pair = [&](Entity ea, Entity eb) {
        auto& rbA = view.get<RigidBody>(ea);
        auto& rbB = view.get<RigidBody>(eb);
        // ТЕЛА ОДНОЙ СУСТАВНОЙ ЦЕПИ ДРУГ С ДРУГОМ НЕ СТАЛКИВАЮТСЯ (§64,
        // корень найден замером 2026-09-30). Про их взаимное положение уже
        // есть закон — сустав; контакт был ВТОРЫМ законом о том же, и два
        // закона не согласованы по единицам: контакт разводит ПОЗИЦИЕЙ на
        // полную глубину каждый подшаг, сустав тянет обратно СКОРОСТЬЮ
        // β·C/h = 50·C м/с. Равновесие этой войны — постоянная ошибка
        // сустава, а значит постоянная скорость, а значит тело не затихает
        // НИКОГДА. Замер стенда (куча 64 трупов, 90 с): ошибка сустава
        // 0.1154 м и максимальная скорость 5.240 м/с, спит 19 тел из 256.
        // Предсказание (0.1154 − тогдашний люфт 0.01)·50 = 5.270 —
        // расхождение 1%,
        // то есть скорость трупа объяснялась подтяжкой сустава ЦЕЛИКОМ, без
        // остатка на «настоящее движение». После закона: ошибка 0.0127 м,
        // скорость 0.170 м/с, спит 147 из 256; а там, где трупы лежат не
        // вдавленными друг в друга, — 256 из 256 и solve 0.000 мс.
        if (rbA.chain != 0u && rbA.chain == rbB.chain) return;
        // Обе стороны вне решателя — пара пуста, по какой бы причине каждая из
        // них там ни оказалась. Два ЗАСТЫВШИХ тела не могут столкнуться,
        // потому что ни одно из них не движется; это и есть то, почему
        // застывание законно, а не то, чем оно опасно.
        if ((rbA.asleep || rbA.suspended) && (rbB.asleep || rbB.suspended))
            return;
        auto& trA = view.get<Transform>(ea);
        auto& trB = view.get<Transform>(eb);
        // Образ B у A — кратчайший вектор тора: пары через шов честные.
        const vec3 dAB = wrap_delta3(trA.pos, trB.pos, kWorldExtent);
        const float bound = rbA.radius + rbB.radius;
        if (dot(dAB, dAB) >= bound * bound) return;
        auto& vA = view.get<Velocity>(ea);
        auto& vB = view.get<Velocity>(eb);
        const ContactForm* fA = reg.try_get<ContactForm>(ea);
        const ContactForm* fB = reg.try_get<ContactForm>(eb);
        const int nA = (fA && fA->count) ? fA->count : 1;
        const int nB = (fB && fB->count) ? fB->count : 1;
        for (int i = 0; i < nA; ++i) {
            vec3 offA{0.0f, 0.0f, 0.0f};
            float rA = rbA.radius;
            if (fA && fA->count) {
                offA = quat_rotate(rbA.q, fA->off[i]);
                rA = fA->r[i];
            }
            for (int j = 0; j < nB; ++j) {
                vec3 offB{0.0f, 0.0f, 0.0f};
                float rB = rbB.radius;
                if (fB && fB->count) {
                    offB = quat_rotate(rbB.q, fB->off[j]);
                    rB = fB->r[j];
                }
                const vec3 d = dAB + offB - offA;
                const float rSum = rA + rB;
                const float d2 = dot(d, d);
                if (d2 >= rSum * rSum || d2 < 1e-8f) continue;
                const float dist = std::sqrt(d2);
                const vec3 n = d * (1.0f / dist); // A → B
                const float depth = rSum - dist;

                // КОНТАКТ СНИМАЕТ ЗАСТЫВАНИЕ — это §23.1, а не послабление:
                // бодрое тело, долетевшее до застывшего, в прогоне «радиус ∞»
                // его бы толкнуло, и мир разошёлся бы, если тут промолчать.
                if (rbA.suspended) {
                    rbA.suspended = false; rbA.quietTicks = 0;
                    ++stats.unsuspPair;
                }
                if (rbB.suspended) {
                    rbB.suspended = false; rbB.quietTicks = 0;
                    ++stats.unsuspPair;
                }
                // СПЯЩЕГО БУДИТ ДВИЖУЩИЙСЯ СОСЕД — закон связи (`moving`),
                // сведённый сюда 2026-11-25. До этого пара будила спящего
                // ЛЮБЫМ касанием, и тихое тело, лёгшее на спящее, будило его,
                // засыпало само — и тут же бывало разбужено им же: пинг-понг
                // сбросов, ровно тот, что §64 вылечил у суставов. Замер на
                // куче из 16 семичастных трупов: 5 тихих опёртых тел, стаж
                // сна 2–21 тик из 32 навсегда. Неразбуженный спящий в паре —
                // НЕПОДВИЖНАЯ ОПОРА (сторона без тела в законах ниже): так
                // засыпает стопка, и так поза спящего остаётся бит-в-бит.
                if (rbA.asleep && moving(rbB, vB.v)) {
                    rbA.asleep = false; rbA.sleepTicks = 0; ++stats.wokePair;
                }
                if (rbB.asleep && moving(rbA, vA.v)) {
                    rbB.asleep = false; rbB.sleepTicks = 0; ++stats.wokePair;
                }
                if (rbA.asleep && rbB.asleep) continue;
                rbA.touchedTick = true;
                rbB.touchedTick = true;

                // Позиционное разведение по долям ОБОБЩЁННЫХ обратных масс:
                // тяжёлый стоит, лёгкий уступает — без ветки «кто главнее»;
                // и через точки контакта, а не всем телом (`contact_project`).
                // Плечи до СВОЕЙ точки поверхности. Спящая сторона — мир:
                // законы ждут неподвижную сторону первой, поэтому при спящем
                // B стороны меняются местами, а нормаль — знаком.
                const vec3 rcA = offA + n * rA;
                const vec3 rcB = offB + n * (-rB);
                if (rbA.asleep)
                    contact_project(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    &trB, &rbB, rcB, n, depth);
                else if (rbB.asleep)
                    contact_project(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    &trA, &rbA, rcA, n * -1.0f, depth);
                else
                    contact_project(&trA, &rbA, rcA, &trB, &rbB, rcB, n, depth);
                const vec3 vpA = vA.v + cross(rbA.w, rcA);
                const vec3 vpB = vB.v + cross(rbB.w, rcB);
                const float vn = dot(vpB - vpA, n);
                const float mu = pair_friction(rbA.friction, rbB.friction);
                // Хоть одна сторона — часть цепи: строка едет в итерации
                // суставов (вывод у `chainContacts`), и ДО проверки
                // сближения — расходящуюся сейчас точку сустав развернёт.
                if (rbA.chain != 0u || rbB.chain != 0u)
                    chainContacts.push_back(ChainContact{
                        ea, eb,
                        (fA && fA->count) ? fA->off[i]
                                          : vec3{0.0f, 0.0f, 0.0f},
                        rA,
                        (fB && fB->count) ? fB->off[j]
                                          : vec3{0.0f, 0.0f, 0.0f},
                        rB, n, mu});
                if (vn >= 0.0f) continue;
                if (-vn > 4.0f) {
                    Impact& imA = reg.get_or_emplace<Impact>(ea);
                    if (-vn > imA.speed) imA.speed = -vn;
                    Impact& imB = reg.get_or_emplace<Impact>(eb);
                    if (-vn > imB.speed) imB.speed = -vn;
                }
                // Материальная пара тел (инкремент 7).
                const float e_ =
                    (-vn > kBounceMinV)
                        ? pair_restitution(rbA.restitution, rbB.restitution)
                        : 0.0f;
                if (rbA.asleep)
                    contact_impulse(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    vB.v, rbB, rcB, n, mu, e_);
                else if (rbB.asleep)
                    contact_impulse(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    vA.v, rbA, rcA, n * -1.0f, mu, e_);
                else
                    contact_impulse(&vA.v, &rbA, rcA, vB.v, rbB, rcB, n, mu,
                                    e_);
            }
        }
    };

    // Проп ↔ АГЕНТ (игрок/NPC — свепт-AABB тело из physics_step; S3:
    // RagdollRoll «задевает игрока, может убить», S7: игрок = NPC, особых
    // случаев нет). Агент в словаре солвера — две сферы вдоль длинной оси
    // AABB; массы честные (Mass, дефолт 70 кг — тот же фолбэк, что у драга);
    // вращения у агента нет — ориентацией владеет контроллер. Контакт будит
    // спящий проп (игрок пинает кучу), позиционное разведение выталкивает
    // агента из пропа даже если контроллер перепишет скорость, Impact > 4 м/с
    // идёт в закон урона E=mv²/2 обеих сторон.
    auto resolve_agent = [&](Entity ep, Entity eg) {
        auto& rb = view.get<RigidBody>(ep);
        auto& trP = view.get<Transform>(ep);
        auto& vP = view.get<Velocity>(ep);
        auto& trG = reg.get<Transform>(eg);
        auto& vG = reg.get<Velocity>(eg);
        const AgentForm ag = agent_form(reg.get<AABB>(eg).half);
        const vec3 dPG = wrap_delta3(trP.pos, trG.pos, kWorldExtent);
        const float bound = rb.radius + ag.bound;
        if (dot(dPG, dPG) >= bound * bound) return;
        const float agMass =
            reg.all_of<Mass>(eg) ? reg.get<Mass>(eg).kg : Mass{}.kg;
        const float invMassG = 1.0f / std::max(agMass, 1.0f);
        const ContactForm* form = reg.try_get<ContactForm>(ep);
        const int nSph = (form && form->count) ? form->count : 1;
        for (int i = 0; i < nSph; ++i) {
            vec3 offP{0.0f, 0.0f, 0.0f};
            float rP = rb.radius;
            if (form && form->count) {
                offP = quat_rotate(rb.q, form->off[i]);
                rP = form->r[i];
            }
            for (int j = 0; j < 2; ++j) {
                const vec3 d = dPG + ag.off[j] - offP; // проп → сфера агента
                const float rSum = rP + ag.r;
                const float d2 = dot(d, d);
                if (d2 >= rSum * rSum || d2 < 1e-8f) continue;
                const float dist = std::sqrt(d2);
                const vec3 n = d * (1.0f / dist);
                const float depth = rSum - dist;
                // КОНТАКТ ХОДЯЧЕГО СНИМАЕТ ЗАСТЫВАНИЕ — самое важное место
                // всего F1. NPC ходят по ВСЕМУ этажу независимо от того, где
                // игрок (CANON S16, изотропия; урок ГХ1 `alife.md:536`), а
                // значит жилец, наступивший на застывший труп в сорока метрах
                // за спиной игрока, ОБЯЗАН его сдвинуть. Поэтому застывшие
                // тела остаются в корзинах тел — из ПАРНОЙ фазы они выключены
                // (`BinRun.awake`), из АГЕНТНОЙ нет. Цена названа числом в
                // отчёте: корзины по-прежнему платятся от ВСЕХ тел
                // (rigid.h:30-31), и гейт плоскости поэтому стоит на
                // solve+links, а не на bins.
                if (rb.suspended) {
                    rb.suspended = false; rb.quietTicks = 0;
                    ++stats.unsuspAgent;
                }
                if (rb.asleep) {
                    rb.asleep = false; rb.sleepTicks = 0; ++stats.wokeAgent;
                }
                rb.touchedTick = true;
                const float invSum = rb.invMass + invMassG;
                trP.pos += n * (-depth * (rb.invMass / invSum));
                trG.pos += n * (depth * (invMassG / invSum));
                const vec3 rcP = offP + n * rP;
                const vec3 vpP = vP.v + cross(rb.w, rcP);
                const float vn = dot(vG.v - vpP, n);
                if (vn >= 0.0f) continue;
                if (-vn > 4.0f) {
                    Impact& imP = reg.get_or_emplace<Impact>(ep);
                    if (-vn > imP.speed) imP.speed = -vn;
                    Impact& imG = reg.get_or_emplace<Impact>(eg);
                    if (-vn > imG.speed) imG.speed = -vn;
                }
                // Плоть агента: мягкая (почти не отдаёт) и цепкая. Вывод: у
                // мяса нет упругого звона, а хват — это одежда и кожа.
                constexpr float kFleshRestitution = 0.05f;
                const float e_ =
                    (-vn > kBounceMinV)
                        ? pair_restitution(rb.restitution, kFleshRestitution)
                        : 0.0f;
                const vec3 rxP = cross(rcP, n);
                const float kP = rb.invMass + rb.invInertia * dot(rxP, rxP);
                const float jn = -(1.0f + e_) * vn / (kP + invMassG);
                vP.v += n * (-jn * rb.invMass);
                rb.w += cross(rcP, n * (-jn)) * rb.invInertia;
                vG.v += n * (jn * invMassG);
            }
        }
    };

    // ОСТАТОЧНАЯ ОШИБКА СУСТАВА (§64) — прибор, названный числом. β·C/h при
    // β=0.2 и подшаге 4 мс это 50·C м/с: остаток 1 мм ровно равен порогу сна
    // kSleepV, а остаток 10 см даёт 4.9 м/с вечной дрожи. Свип зовётся на
    // КАЖДОМ выходе, включая ранний «мир спит целиком»: прибор, который при
    // спящем мире печатает ноль вместо факта, врёт молчанием — ровно та
    // форма лжи, что в §82.1 показывала зелёные 8/8 на красном дереве.
    auto link_error_sweep = [&]() {
        for (auto le : links) {
            const JointLink& jl = links.get<JointLink>(le);
            if (jl.a == entt::null || !reg.valid(jl.a) ||
                !reg.all_of<RigidBody, Transform>(jl.a))
                continue;
            const auto& ra = reg.get<RigidBody>(jl.a);
            const vec3 pa =
                reg.get<Transform>(jl.a).pos + quat_rotate(ra.q, jl.anchorA);
            vec3 pb;
            if (jl.b != entt::null) {
                if (!reg.valid(jl.b) || !reg.all_of<RigidBody, Transform>(jl.b))
                    continue;
                const auto& rb2 = reg.get<RigidBody>(jl.b);
                pb = reg.get<Transform>(jl.b).pos +
                     quat_rotate(rb2.q, jl.anchorB);
            } else {
                pb = jl.anchorB;
            }
            const float C =
                length(wrap_delta3(pa, pb, kWorldExtent)) - jl.restLen;
            // Верёвка не толкает — провис не ошибка сустава.
            if (jl.rope && C <= 0.0f) continue;
            const float absC = std::fabs(C);
            // Порог прибора ВЫВЕДЕН из самой подтяжки, а не из люфта
            // (люфта больше нет): β·C/h = kSleepV при C = kSleepV·h/β.
            // То есть считаются суставы, чей остаток САМ ПО СЕБЕ даёт
            // скорость выше порога сна — ровно те, из-за которых тело не
            // затихает. При h = 4 мс это 1 мм.
            const float noisyC = kSleepV * h / kJointBias;
            if (absC > noisyC) ++stats.linksBeyondSlop;
            stats.linkMaxAbsC = std::max(stats.linkMaxAbsC, absC);
        }
    };

    // Пробуждение внешней записью Velocity (взрыв, толчок, пинок пишут её —
    // естественный интерфейс) + сброс тик-аккумуляторов касания и цепи.
    std::uint32_t awakeCount = 0;
    for (auto e : view) {
        ++stats.bodies;
        auto& rb = view.get<RigidBody>(e);
        rb.touchedTick = false;
        rb.chain = 0u; // метка цепи — транзит одного тика, см. ниже
        const vec3& v0 = view.get<Velocity>(e).v;
        const bool pushed = dot(v0, v0) >= kWakeV2;
        // ЗАПИСЬ СКОРОСТИ ИЗВНЕ СНИМАЕТ И ЗАСТЫВАНИЕ. Взрыв в другом конце
        // этажа — событие МИРА, и прогон «радиус ∞» сдвинул бы этот труп;
        // промолчать здесь значило бы развести дайджесты (§23.1).
        if (rb.suspended && pushed) {
            rb.suspended = false;
            rb.quietTicks = 0;
            ++stats.unsuspExtern;
        }
        if (rb.asleep && pushed) {
            rb.asleep = false;
            rb.sleepTicks = 0;
            ++stats.wokeExtern;
        }
        // СТАЖ ТИШИНЫ СПЯЩЕГО НАЧИСЛЯЕТСЯ ЗДЕСЬ, А НЕ В СВИПЕ СНА, И ЭТО
        // ВЫНУЖДЕННОЕ МЕСТО, А НЕ ВКУС.
        //
        // НАЙДЕНО ПИНОМ (`:530`, 2026-11-06), ВТОРОЙ ЗАХОД НА ОДИН И ТОТ ЖЕ
        // КЛАСС. В прошлый раз стаж не копился потому, что свип пропускал
        // спящих; теперь — потому что СВИПА НЕ ПРОИСХОДИТ ВОВСЕ: ранний выход
        // «мир спит целиком и агентов нет» стоит ПЕРЕД свипом и возвращается
        // из функции. На сцене, где все тела спят и возмутителей нет, стаж
        // замирал на том значении, с которым пришёл, — а приходил он нулём,
        // потому что оживление пузырём его обнуляет. Итог тот же, что и в
        // прошлый раз: однажды оживлённая цепь не застывала больше НИКОГДА.
        //
        // УРОК, А НЕ ПРАВКА: счётчик, от которого зависит РЕШЕНИЕ, обязан
        // начисляться на пути, который исполняется ВСЕГДА. Свип сна таким
        // путём не является по построению — он стоит за выходом, и правильно
        // стоит. Проход пробуждения исполняется безусловно, он здесь первый.
        //
        // РАЗДЕЛЕНИЕ ЗАКОННО И ПРОВЕРЯЕМО: бодрым телам стаж по-прежнему
        // считает свип, и он до них ДОХОДИТ всегда, когда они есть, —
        // бодрое тело даёт awakeCount > 0, то есть ранний выход не срабатывает
        // по построению. А когда awakeCount == 0, бодрых тел нет и начислять
        // свипу некому. То есть ни одно тело не остаётся без начисления ни на
        // одном пути исполнения.
        //
        // Спящему верить можно: засыпая, тело обнулило `v` и `w` (свип ниже),
        // поэтому под вопросом не тишина, а только её ДЛИНА. Застывшему не
        // начисляем — он вне решателя, и его стаж обязан стоять, иначе решатель
        // на следующем тике отменил бы сам себя.
        if (rb.asleep && !rb.suspended &&
            rb.quietTicks < static_cast<std::uint8_t>(kSuspendQuietTicks))
            ++rb.quietTicks;
        // «Бодрое» — ни спящее, ни застывшее: оба не входят в решатель, и
        // ранний выход ниже обязан видеть их одинаково.
        if (!rb.asleep && !rb.suspended) ++awakeCount;
    }

    // ПЕРЕНОСКА: кинематический follow раз на тик (носитель интегрируется
    // physics_step'ом раз на тик — чаще нечего догонять). До корзин: несомое
    // не порождает пар и не спит.
    {
        static thread_local std::vector<Entity> orphaned;
        orphaned.clear();
        auto carriedView = reg.view<RigidBody, Transform, Velocity, CarriedBy>();
        for (auto e : carriedView) {
            const auto& cb = carriedView.get<CarriedBy>(e);
            if (cb.carrier == entt::null || !reg.valid(cb.carrier) ||
                !reg.all_of<Transform>(cb.carrier)) {
                orphaned.push_back(e); // носитель умер — тело падает
                continue;
            }
            auto& tr = carriedView.get<Transform>(e);
            auto& rb = carriedView.get<RigidBody>(e);
            auto& vel = carriedView.get<Velocity>(e);
            const auto& ctr = reg.get<Transform>(cb.carrier);
            tr.pos = ctr.pos + cb.offset;
            tr.pos.x = wrapf(tr.pos.x, kWorldExtent);
            tr.pos.y = wrapf(tr.pos.y, kWorldExtent);
            tr.pos.z = wrapf(tr.pos.z, kWorldExtent);
            tr.layer = ctr.layer;
            vel.v = reg.all_of<Velocity>(cb.carrier)
                        ? reg.get<Velocity>(cb.carrier).v
                        : vec3{0.0f, 0.0f, 0.0f};
            rb.w = vec3{0.0f, 0.0f, 0.0f}; // в руках не крутится
            rb.asleep = false; // кинематика жива для линков
            rb.sleepTicks = 0;
            rb.quietTicks = 0; // несомое тело никогда не копит тишину для F2
            // ПОДНЯЛИ В РУКИ — застывание снято, и снято ЗДЕСЬ, а не решателем
            // пузыря: монстр, волокущий труп в сорока метрах от игрока, тащит
            // его по-настоящему (S7: путь переноски один на всех). Тело в
            // руках застыванию не подлежит вовсе — его позицию пишет носитель,
            // а не солвер, и «вынуть из солвера» для него бессмысленно.
            if (rb.suspended) {
                rb.suspended = false;
                ++stats.unsuspCarry;
            }
        }
        for (Entity e : orphaned) reg.remove<CarriedBy>(e);
    }

    // Агенты для фазы проп↔агент. Бодрые пропы обязаны видеть ВСЕХ агентов
    // (летящий шар против стоящего игрока); спящий мир — только движущихся
    // (стоящий агент спящему пропу ничего не сделает, а ходящий — пинает).
    static thread_local std::vector<Entity> agents;
    agents.clear();
    {
        auto agentView = reg.view<Transform, Velocity, AABB, GravityAffected>(
            entt::exclude<RigidBody, NoClip, SelfIntegrating>);
        for (auto e : agentView) {
            const vec3& v = agentView.get<Velocity>(e).v;
            if (awakeCount > 0 || dot(v, v) >= kWakeV2)
                agents.push_back(e);
        }
    }

    stats.agents = static_cast<std::uint32_t>(agents.size());
    stats.links = static_cast<std::uint32_t>(links.size());

    // РАННИЙ ВЫХОД ПЕРЕЕХАЛ НИЖЕ — ПОСЛЕ РЕШАТЕЛЯ ПУЗЫРЯ, и причину надо
    // сказать прямо, потому что это единственное место, где F1 сделал ядро
    // дороже, а не дешевле.
    //
    // Решатель членства ОБЯЗАН бежать каждый тик: иначе гора, застывшая, пока
    // игрок был далеко, не оживёт, когда он вернётся, — а оживить её некому,
    // «игрок подошёл» не входит в шесть путей пробуждения. Значит цепи и
    // запрос присутствия стоят выше выхода.
    //
    // ЧТО ЭТО СТОИТ И ПОЧЕМУ ЭТО НЕ РЕГРЕСС. Выход требует, чтобы агентов НЕ
    // БЫЛО ВОВСЕ, — а комментарий фазы линков ниже уже записал замером, что в
    // игре «игрок в мире есть всегда», то есть эта ветка в живой игре была
    // недостижима и до пузыря. Платят её только headless-прогоны без агентов.
    // Новая цена пола названа числом: union-find O(линков) + бины корней
    // O(цепей) + один торический замер на цепь; на худшем потолке §17.2
    // (7000 трупов = 49 000 тел, 42 000 линков при семи частях, 7000 цепей —
    // число ЦЕПЕЙ от частей не зависит) это сортировка
    // 7000 ключей и 7000 расстояний против 28.8 мс `solve` на ОДНОЙ ТЫСЯЧЕ
    // трупов сегодня. Мерится отдельным слотом `presenceMs` — не на веру.

    // ЦЕПИ: связные компоненты графа суставов, раз на тик. Union-find прямо
    // по полю RigidBody.chain (хранит значение сущности-представителя + 1,
    // ноль — «вне цепей»): отдельного словаря не нужно, а сравнение в
    // resolve_pair стоит одно целое. Цена O(линков) — 1005 линков людного
    // этажа против 9.4 мс фазы решения.
    //
    // Цепь — то, что СВЯЗАНО СУСТАВАМИ, а не «труп»: слова «труп» ядро не
    // знает (S7). Люстра на тросе, сцепка ящиков и рагдолл — один закон.
    auto chain_root = [&](Entity e) {
        std::uint32_t v = static_cast<std::uint32_t>(e);
        for (;;) {
            const std::uint32_t p =
                reg.get<RigidBody>(static_cast<Entity>(v)).chain - 1u;
            if (p == v) return v;
            v = p;
        }
    };
    static thread_local std::vector<Entity> chainNodes;
    chainNodes.clear();
    for (auto le : links) {
        const JointLink& jl = links.get<JointLink>(le);
        if (jl.a == entt::null || jl.b == entt::null) continue; // мировой якорь
        if (!reg.valid(jl.a) || !reg.valid(jl.b)) continue;
        if (!reg.all_of<RigidBody>(jl.a) || !reg.all_of<RigidBody>(jl.b))
            continue;
        auto& ra = reg.get<RigidBody>(jl.a);
        auto& rb = reg.get<RigidBody>(jl.b);
        if (ra.chain == 0u) {
            ra.chain = static_cast<std::uint32_t>(jl.a) + 1u;
            chainNodes.push_back(jl.a);
        }
        if (rb.chain == 0u) {
            rb.chain = static_cast<std::uint32_t>(jl.b) + 1u;
            chainNodes.push_back(jl.b);
        }
        const std::uint32_t rootA = chain_root(jl.a);
        const std::uint32_t rootB = chain_root(jl.b);
        if (rootA != rootB)
            reg.get<RigidBody>(static_cast<Entity>(rootA)).chain = rootB + 1u;
    }
    // Сжатие путей одним проходом: после него метка цепи у всех участников
    // одинакова, и проверка пары — сравнение двух чисел.
    for (Entity e : chainNodes)
        reg.get<RigidBody>(e).chain = chain_root(e) + 1u;

    // ======== РЕШАТЕЛЬ ЧЛЕНСТВА В ПУЗЫРЕ (F1, matwej.md §17.2/§23.7) =======
    //
    // ЕДИНИЦА ЧЛЕНСТВА — ЦЕПЬ, А НЕ ТЕЛО И НЕ «ТРУП». Слова «труп» ядро не
    // знает (S7), и знать не должно: труп — это цепь из частей формы,
    // люстра на тросе — цепь, сцепка ящиков — цепь, и закон у них один. Это
    // же даёт требуемое §17.2 «посегментно на весь труп разом» бесплатно: все
    // сегменты несут ОДНУ метку корня, поэтому ответ пузыря у них один.
    //
    // ОДИНОЧНЫЕ ТЕЛА (chain == 0) В F1 НЕ ЗАСТЫВАЮТ, и это граница заходa, а
    // не забывчивость: кривая цены, из которой выведен N (§17.2), снята на
    // ЦЕПЯХ ТРУПОВ (четырёх-, с 2026-11-26 — семичастных, перемер у
    // регистрации ниже), а мешать в один бюджет штуки с разной ценой —
    // ровно тот дефект, против которого бюджетная форма и заведена. Осевший
    // дебрис и одиночные пропы — F2, со своей регистрацией и своим замером
    // (§23.7); им, в отличие от трупов, штатный сон работает (на 16 трупах
    // спят 89%, потому что опора под ними — мир, а не другой труп).
    const auto statsPresT0 = std::chrono::steady_clock::now();
    {
        // НАБЛЮДАТЕЛЯ НЕТ — ПУЗЫРЯ НЕТ, И НИЧТО НЕ ЗАСТЫВАЕТ. Это закон, а не
        // удобство: застывание оправдано ровно тем, что «игрок туда не
        // смотрит», и когда игрока нет вовсе, оправдания нет ни у одного тела.
        // Ошибка идёт в сторону «заплатить больше», а не «заморозить мир» —
        // тот же выбор, что у перелива бакетов света (S11). Два следствия,
        // оба нужные: кадр до посадки тела на этаж считает физику честно, и
        // headless-прогоны (`world_test`, `game_test`, `e2e_test`), у которых
        // камеры нет вовсе, ведут себя РОВНО как до F1 — иначе пин «цепь
        // уснула на полу» краснел бы не от дефекта, а от того, что в тесте
        // некому смотреть.
        if (presence_center_count() == 0) {
            for (auto e : view) {
                auto& rb = view.get<RigidBody>(e);
                if (!rb.suspended) continue;
                rb.suspended = false;
                rb.quietTicks = 0;
                ++stats.unsuspBubble;
                // `awakeCount` здесь НЕ правится: его пересчитывает общий
                // проход после этого if/else — одна арифметика вместо двух.
            }
        } else {
        // РЕГИСТРАЦИЯ ПОТРЕБИТЕЛЯ — один раз за процесс, здесь, а не в
        // `main.cpp`: бюджет и цена штуки суть свойства ЭТОГО решателя, и
        // носить их через слой приложения значило бы вынести логику наверх.
        //
        // Кэш id проверяется ПОКОЛЕНИЕМ присутствия, а не только «уже ли
        // регистрировались»: `presence_reset()` (тестовая оснастка) обнуляет
        // таблицу, и статик с прежним id стал бы указывать в пустоту —
        // потребитель молча получил бы N = 0, то есть застыло бы ВСЁ. Поймано
        // на себе: сюита присутствия в том же бинарнике зовёт reset.
        static PresenceId ragdollId = kInvalidPresenceId;
        static std::uint32_t ragdollGen = 0xFFFFFFFFu;
        if (ragdollGen != presence_generation()) {
            ragdollGen = presence_generation();
            ragdollId = presence_register({
            "ragdolls:chains",
            PresenceLevel::kFull,   // R = 64 м, старт дымки (§17.2)
            PresenceClass::kFreeze, // не считается вовсе; гейт — дайджест
            // БЮДЖЕТ — РЕШЕНИЕ ВЛАДЕЛЬЦА (§17.3, строка «рагдоллы (пузырь
            // N=128) ≤2 мс»). Оговорка владельца там же: 2 мс выведены из
            // остатка бюджета ПОСЛЕ хода A (`pack` возит только изменённое);
            // не ляжет ход A — число пересчитывается, и пересчитывается ЗДЕСЬ,
            // в одной строке.
            2.0f,
            // ЦЕНА ШТУКИ — ИЗ КРИВОЙ СТЕНДА, и взят КОНСЕРВАТИВНЫЙ конец.
            // Стенд: 64 трупа → 0.54 мс, 256 → 5.8 мс (§17.2, тесная решётка
            // 0.7 м — худшая плотность). Маргинальная цена на этом отрезке
            // (5.8−0.54)/(256−64) = 27.4 мкс/труп, то есть полная цена в точке
            // 128 равна 0.54 + 64×27.4 мкс = 2.29 мс, а СРЕДНЯЯ цена штуки там
            // 2.29/128 = 17.9 мкс. Её и регистрируем: N = 2000/17.9 = 111, и
            // при N = 111 полная цена 0.54 + 47×27.4 мкс = 1.83 мс ≤ 2.0 ✓.
            //
            // §17.2 ОБЪЯВИЛ N = 128 — И ЭТО ОПТИМИСТИЧНЫЙ КОНЕЦ ЕГО ЖЕ ВИЛКИ
            // «1.8–2.3 мс». Беру нижний N, потому что бюджет жёсткий, а вилка
            // широкая.
            //
            // ЗАМЕР РОВНО В ТОЧКЕ 128 СНЯТ 2026-11-06 (rigid_bench 128 60 0.7,
            // load avg 1.75, установившийся хвост t=57..59.5):
            // solve = 2.083..2.156 мс > 2.0 — ИНТЕРПОЛЯЦИЯ ПОДТВЕРЖДЕНА своей
            // консервативной стороной (предсказано 2.29, факт 2.1), 128 в
            // бюджет НЕ влезает, N = 111 остаётся. Локальная маргинальная на
            // отрезке 64..128 = (2.1−0.54)/64 = 24.4 мкс/труп даёт при N=111
            // полную цену ~1.69 мс — запас к бюджету честный. Следующее
            // опровержение — только живой этаж (реальная плотность кучи вместо
            // решётки 0.7 м).
            //
            // ПЕРЕМЕР НА СЕМИЧАСТНОЙ ЦЕПИ 2026-11-26 (И1б, тот же стенд,
            // хвост t=57..59.5): 64 → 0.015 мс, 128 → 0.27, 256 → 0.06 мс —
            // кучи теперь ЗАСЫПАЮТ (448/448, 895/896, 1792/1792), и цена
            // тихой цепи 0.27/128 = 2.1 мкс. Эталон четырёхчастной на том же
            // стенде: 128 → 2.7 мс, спит 185/512. Регистрация НЕ тронута:
            // 17.9 мкс стали консервативны в ~8 раз, а поднимать N — решение
            // о том, сколько трупов живёт полной физикой, а не арифметика.
            // ПИК на падении вырос: 128 трупов разом — 14.3 мс на тик в первые
            // 2 с (четырёхчастная 3.3 мс). Пузырём он не платится — падающая
            // цепь шумна и не застывает при любом N, — это цена массовой
            // гибели, названная числом.
            17.9f,
            "matwej.md §17.2: кривая стенда (решётка 0.7 м, худшая плотность) "
            "64 трупа = 0.54 мс, 256 = 5.8 мс => маргинальная 27.4 мкс/труп, "
            "полная в точке 128 = 2.29 мс, средняя 17.9 мкс. ОПРОВЕРГАЕТСЯ "
            "замером solve при N=111 на живом этаже 6 (там 341 труп и 2.974 мс "
            "sim-кадра БЕЗ пузыря, §3.2)",
            });
        }
        const PresenceId kRagdollPresence = ragdollId;

        // Бины ПРЕДСТАВИТЕЛЕЙ цепей: по одной записи на цепь, позиция — корня.
        // Это не второй пространственный индекс, а второй НАБОР в том же
        // примитиве: `CellBins` ровно для этого и устроен («ОДИН примитив,
        // ПОЛИТИКА у потребителя»), и запрос N ближайших — его же дверь.
        static thread_local CellBins chainBins;
        chainBins.clear();
        for (Entity e : chainNodes) {
            const RigidBody& rb = reg.get<RigidBody>(e);
            // Корень — тот, чья метка указывает на себя. После сжатия путей
            // это ровно одна запись на цепь, без словаря и без дедупа.
            if (rb.chain != static_cast<std::uint32_t>(e) + 1u) continue;
            const Transform& tr = reg.get<Transform>(e);
            chainBins.add(cell_bin_key(tr.layer, cell_coord(tr.pos.x),
                                       cell_coord(tr.pos.y),
                                       cell_coord(tr.pos.z)),
                          e);
        }
        chainBins.build();
        stats.chains = static_cast<std::uint32_t>(chainBins.entries.size());

        static thread_local std::vector<CellBins::Near> nearBuf;
        static thread_local std::vector<Entity> bubbleRoots;
        const std::uint32_t budgetN = presence_budget_n(kRagdollPresence);
        const std::uint32_t outCap =
            presence_forced_infinite()
                ? static_cast<std::uint32_t>(chainBins.entries.size())
                : budgetN;
        nearBuf.resize(outCap);
        const std::uint32_t got =
            outCap == 0
                ? 0u
                : presence_query(kRagdollPresence, chainBins, reg,
                                 nearBuf.data(), outCap);
        stats.chainsInBubble = got;
        bubbleRoots.clear();
        for (std::uint32_t i = 0; i < got; ++i)
            bubbleRoots.push_back(nearBuf[i].e);
        // Присутствие отдаёт выборку по (расстояние, сущность); для проверки
        // членства нужен порядок ПО СУЩНОСТИ — пересортировка копии длиной N,
        // не длиной сцены.
        std::sort(bubbleRoots.begin(), bubbleRoots.end());

        // ---- ТРИ ПРОХОДА: РЕШЕНИЕ, ЕДИНОГЛАСИЕ, ТРАНСЛЯЦИЯ ----------------
        //
        // ПОЧЕМУ ТРИ, А НЕ ОДИН — РАЗБОР СОБСТВЕННОЙ ОШИБКИ, НАЙДЕННОЙ ПИНОМ
        // (`:446`, 2026-11-06). Первая версия решала ПО ТЕЛУ: членство брала у
        // цепи, готовность — у тела, а СОГЛАСОВАНИЕ цепи оставляла на
        // `wakePass` сустава, рассчитывая, что частичное застывание «само
        // залечится тем же механизмом, которым распространяется пробуждение из
        // сна». ЭТО БЫЛО НЕВЕРНО, и причина точная: `wakePass` будит соседа
        // только когда разбуженный ДВИЖЕТСЯ (≥ kWakeV2 = 0.1 м/с), а «ожил, но
        // ещё не поехал» — ровно типовой случай для цепи, которую вынули из
        // решателя в покое. Верёвочный линк вдобавок не передаёт импульс, когда
        // он ослаб (`rope` только тянет), поэтому сегмент, которого пнули
        // В СТОРОНУ соседа, соседу не передаёт НИЧЕГО. Хвост цепи не получал
        // скорости никогда и оставался застывшим НАВСЕГДА: труп, которому
        // агент пнул голову, рвался пополам и больше не собирался.
        //
        // ВЫВОД, КОТОРЫЙ НАДО ЗАПОМНИТЬ: снятие застывания обязано
        // распространяться СТРУКТУРНО, по графу суставов, а не через скорость.
        // Скорость — свойство динамики, членство в цепи — свойство топологии,
        // и первое не является оракулом второго.
        //
        // Проходы делают это за O(членов цепей), без сортировок и без побочных
        // таблиц, потому что КОРЕНЬ союза-поиска — тоже тело, и у него есть
        // транзитный бит `suspendVote` (в байтах выравнивания, бесплатно):
        //   A. РЕШЕНИЕ — только по корням: членство в пузыре И готовность.
        //   B. ЕДИНОГЛАСИЕ — любой НЕготовый член ГАСИТ голос корня. Здесь же
        //      закрываются ВСЕ ШЕСТЬ путей пробуждения разом, без отдельной
        //      ветки на каждый: разбуженное тело имеет quietTicks = 0, то есть
        //      неготово, то есть гасит цепь целиком.
        //   C. ТРАНСЛЯЦИЯ — каждый член (корень включительно) берёт голос
        //      корня. Отсюда «посегментно на весь труп разом» (§17.2)
        //      выполняется буквально, а не на честном слове.
        //
        // ЦЕНА ЛАГА НАЗВАНА ЧИСЛОМ: событие середины тика (контакт агента,
        // карв, импульс) видно проходами СЛЕДУЮЩЕГО тика, то есть хвост стоит
        // ≤ 1 тик = 8 мс при ожившей голове — ≤ 8 мм расхождения при скорости
        // 1 м/с. Это тот же лаг на тик, который код уже признаёт за корзинами
        // («разбуженный парой участвует своими парами со следующего тика»), и
        // он на порядок ниже сантиметра, на котором §17.2 вообще говорит о
        // позе. `wakePass` при этом ОСТАВЛЕН: он срабатывает ВНУТРИ подшага и
        // лаг сокращает, но единственным механизмом больше не является.
        auto is_ready = [&](Entity e, const RigidBody& rb) {
            return rb.quietTicks >=
                       static_cast<std::uint8_t>(kSuspendQuietTicks) &&
                   !reg.all_of<CarriedBy>(e);
        };
        auto root_of = [](const RigidBody& rb) {
            return static_cast<Entity>(rb.chain - 1u);
        };
        for (Entity e : chainNodes) { // A — решение, в ГОЛОС, не в бит
            RigidBody& rb = reg.get<RigidBody>(e);
            if (rb.chain != static_cast<std::uint32_t>(e) + 1u) continue;
            const bool inBubble = std::binary_search(
                bubbleRoots.begin(), bubbleRoots.end(), e);
            rb.suspendVote = !inBubble && is_ready(e, rb);
        }
        for (Entity e : chainNodes) { // B — единогласие
            const RigidBody& rb = reg.get<RigidBody>(e);
            if (rb.chain == static_cast<std::uint32_t>(e) + 1u) continue;
            RigidBody& root = reg.get<RigidBody>(root_of(rb));
            if (!root.suspendVote) continue; // уже погашен — не тратить пробу
            if (!is_ready(e, rb)) root.suspendVote = false;
        }
        // ======== РЕШАТЕЛЬ ЧЛЕНСТВА В ПУЗЫРЕ (F1 + F2, matwej.md §17.2/§23.7) ==
        //
        // F1 (`ragdolls:chains`): единица членства — цепь суставов.
        // F2 (`debris:settled`):  одиночные тела (`chain == 0u`), но ТОЛЬКО
        // осевшие (`quietTicks >= kSuspendQuietTicks && !CarriedBy`): летящий
        // дебрис (класс 3) не замораживается, осевший (класс 1) вынимается из
        // солвера без потерь и коммутирует бит-в-бит.
        for (Entity e : chainNodes) { // C — трансляция голоса в бит
            RigidBody& rb = reg.get<RigidBody>(e);
            const bool want = reg.get<RigidBody>(root_of(rb)).suspendVote;
            if (rb.suspended == want) continue;
            rb.suspended = want;
            if (!want) {
                // ВОЗВРАТ МГНОВЕНЕН, БЕЗ ГИСТЕРЕЗИСА, И ЭТО ЗАКОН, А НЕ
                // НАСТРОЙКА: задержка оживления есть расхождение с прогоном
                // «радиус ∞» ровно на длину задержки (§23.1). Гистерезис стоит
                // на ДРУГОЙ стороне и выводится, а не назначается: оживление
                // обнуляет стаж, поэтому повторное застывание требует снова
                // kSuspendQuietTicks = 32 тика тишины. Отсюда цена дрожания на
                // границе ранга N ОГРАНИЧЕНА одним переходом = 32 тика решения
                // цепи, а при НЕПОДВИЖНОМ наблюдателе переходов нет вовсе:
                // выборка присутствия детерминирована по (расстояние, id).
                rb.quietTicks = 0;
                ++stats.unsuspBubble;
            }
        }

        // ---- F2: ОСЕВШИЙ ДЕБРИС И ОДИНОЧНЫЕ ПРОПЫ (chain == 0u) -----------
        static PresenceId debrisId = kInvalidPresenceId;
        static std::uint32_t debrisGen = 0xFFFFFFFFu;
        if (debrisGen != presence_generation()) {
            debrisGen = presence_generation();
            debrisId = presence_register({
                "debris:settled",
                PresenceLevel::kFull,   // R = 64 м, старт дымки (§23.7)
                PresenceClass::kFreeze, // класс 1: осевший дебрис не двигается
                // Бюджет 0.5 мс; верхняя оценка 2.5 мкс/тело (бины rigid +
                // шаг/сон одиночного тела -> N=200 в радиусе 64 м).
                0.5f,
                2.5f,
                "rigid.cpp — 0.5 ms budget at 2.5 us/item -> N=200 cap",
            });
        }
        const PresenceId kDebrisPresence = debrisId;

        static thread_local CellBins debrisBins;
        debrisBins.clear();
        for (auto e : view) {
            const RigidBody& rb = view.get<RigidBody>(e);
            if (rb.chain != 0u) continue;
            if (reg.all_of<CarriedBy>(e)) continue;
            const Velocity& vel = view.get<Velocity>(e);
            const bool stoppedZero =
                dot(vel.v, vel.v) == 0.0f && dot(rb.w, rb.w) == 0.0f;
            const bool ready =
                rb.asleep ||
                (rb.quietTicks >= static_cast<std::uint8_t>(kSuspendQuietTicks) &&
                 stoppedZero);
            if (!ready) continue;
            const Transform& tr = view.get<Transform>(e);
            debrisBins.add(cell_bin_key(tr.layer, cell_coord(tr.pos.x),
                                        cell_coord(tr.pos.y),
                                        cell_coord(tr.pos.z)),
                           e);
        }
        debrisBins.build();

        static thread_local std::vector<CellBins::Near> debrisNearBuf;
        static thread_local std::vector<Entity> bubbleDebris;
        const std::uint32_t debrisBudgetN = presence_budget_n(kDebrisPresence);
        const std::uint32_t debrisOutCap =
            presence_forced_infinite()
                ? static_cast<std::uint32_t>(debrisBins.entries.size())
                : debrisBudgetN;
        debrisNearBuf.resize(debrisOutCap);
        const std::uint32_t gotDebris =
            debrisOutCap == 0
                ? 0u
                : presence_query(kDebrisPresence, debrisBins, reg,
                                 debrisNearBuf.data(), debrisOutCap);
        bubbleDebris.clear();
        for (std::uint32_t i = 0; i < gotDebris; ++i)
            bubbleDebris.push_back(debrisNearBuf[i].e);
        std::sort(bubbleDebris.begin(), bubbleDebris.end());

        for (auto e : view) {
            RigidBody& rb = view.get<RigidBody>(e);
            if (rb.chain != 0u) continue;
            const Velocity& vel = view.get<Velocity>(e);
            const bool stoppedZero =
                dot(vel.v, vel.v) == 0.0f && dot(rb.w, rb.w) == 0.0f;
            const bool ready =
                !reg.all_of<CarriedBy>(e) &&
                (rb.asleep ||
                 (rb.quietTicks >= static_cast<std::uint8_t>(kSuspendQuietTicks) &&
                  stoppedZero));
            const bool inBubble =
                ready && std::binary_search(bubbleDebris.begin(),
                                            bubbleDebris.end(), e);
            const bool want = ready && !inBubble;
            if (rb.suspended == want) continue;
            rb.suspended = want;
            if (!want) {
                rb.quietTicks = 0;
                ++stats.unsuspBubble;
            }
        }
        } // if (presence_center_count() != 0)
    }
    // ПЕРЕСЧЁТ БОДРЫХ И РАЗЛОЖЕНИЕ ОТКАЗА — ОДНИМ ПРОХОДОМ, ПОСЛЕ решателя.
    // Пересчёт, а не приращения по месту: решение принимается тремя проходами,
    // и вести `awakeCount` инкрементами значило бы держать три согласованные
    // арифметики вместо одной проверяемой. Ранний выход и набор агентов обязаны
    // видеть застывших так же, как спящих, иначе выход не сработает ни на одном
    // тике после того, как пузырь всё застывил.
    //
    // Здесь же считается, ЧТО ИМЕННО отбраковано, и считается ПО ТЕЛУ ровно
    // один раз (§24.4 п.5: предикат обязан печатать, сколько он выкинул).
    // Счётчик, считающий ПРОБЫ вместо ТЕЛ, врал бы тем же способом, каким врал
    // пер-тиковый слот профиля: честное число не на тот вопрос.
    awakeCount = 0;
    for (auto e : view) {
        const auto& rb = view.get<RigidBody>(e);
        if (!rb.suspended) {
            if (rb.quietTicks < static_cast<std::uint8_t>(kSuspendQuietTicks))
                ++stats.notSuspendedNoisy;
            else if (reg.all_of<CarriedBy>(e))
                ++stats.notSuspendedCarried;
            else if (rb.chain == 0u && presence_center_count() == 0)
                ++stats.notSuspendedLoose;
        }
        if (rb.suspended) ++stats.suspended;
        else if (!rb.asleep) ++awakeCount;
    }
    stats.awake = awakeCount;
    stats.presenceMs = std::chrono::duration<float, std::milli>(
                           std::chrono::steady_clock::now() - statsPresT0)
                           .count();

    // Мир спит целиком и агентов-возмутителей нет — решать нечего:
    // установившийся этаж с тысячами пропов стоит один проход пробуждения
    // плюс решатель членства выше (вывод — у переехавшего выхода).
    if (awakeCount == 0 && agents.empty()) {
        link_error_sweep();
        reg.ctx().insert_or_assign(stats);
        return;
    }

    const auto statsBinsT0 = std::chrono::steady_clock::now();

    // Корзины строятся РАЗ НА ТИК (тело проходит ≤0.23 м за подшаг — запрос
    // соседей поглощает дрейф в клетку); живость пары внутри resolve_pair
    // всегда по текущим позициям. Снимок awake — начало тика: разбуженный
    // парой участвует своими парами со следующего тика.
    static thread_local CellBins bodyBins;
    static thread_local std::vector<BinRun> binRuns;
    bodyBins.clear();
    binRuns.clear();
    // ЗАСТЫВШИЕ ОСТАЮТСЯ В КОРЗИНАХ — сознательно, и это цена изотропии.
    // Выкинуть их отсюда было бы дешевле (корзины платятся от ВСЕХ тел,
    // rigid.h:30-31), но тогда их перестала бы видеть АГЕНТНАЯ фаза, которая
    // строится из этих же `binRuns`, — и жилец, идущий по трупу в сорока
    // метрах за спиной игрока, прошёл бы сквозь. Из ПАРНОЙ фазы они выключены
    // ниже, флагом `awake` пробега.
    for (auto e : view) {
        if (reg.all_of<CarriedBy>(e)) continue; // несомое пар не порождает
        const auto& tr = view.get<Transform>(e);
        bodyBins.add(cell_bin_key(tr.layer, cell_coord(tr.pos.x),
                                  cell_coord(tr.pos.y), cell_coord(tr.pos.z)),
                     e);
    }
    bodyBins.build();
    for (std::uint32_t i = 0; i < bodyBins.entries.size();) {
        std::uint32_t j = i;
        bool awake = false;
        while (j < bodyBins.entries.size() &&
               bodyBins.entries[j].key == bodyBins.entries[i].key) {
            const RigidBody& rbj = view.get<RigidBody>(bodyBins.entries[j].e);
            if (!rbj.asleep && !rbj.suspended) awake = true;
            ++j;
        }
        const Entity first = bodyBins.entries[i].e;
        const auto& tr = view.get<Transform>(first);
        binRuns.push_back({bodyBins.entries[i].key, i, j,
                           wrap_macro(cell_coord(tr.pos.x)),
                           wrap_macro(cell_coord(tr.pos.y)),
                           wrap_macro(cell_coord(tr.pos.z)),
                           tr.layer, awake});
        i = j;
    }
    auto find_run = [&](std::uint64_t key) -> std::uint32_t {
        auto it = std::lower_bound(
            binRuns.begin(), binRuns.end(), key,
            [](const BinRun& r, std::uint64_t k) { return r.key < k; });
        if (it == binRuns.end() || it->key != key) return 0xFFFFFFFFu;
        return static_cast<std::uint32_t>(it - binRuns.begin());
    };

    // Пары СОСЕДНИХ клеток — РАЗ НА ТИК, слиянием: macro_index = x + 128y +
    // 128²z, поэтому при фиксированном смещении ключ соседа = ключ + const,
    // и отсортированные ключи сливаются двумя указателями за O(R) на
    // смещение. 13 передних смещений дают каждую неупорядоченную пару клеток
    // ровно один раз; кромка тора — редкий фолбэк на точечный поиск. Наивные
    // 27 поисков НА ТЕЛО стоили 4.5 мс/тик на 4096 бодрых (замер 2026-08-21).
    static thread_local std::vector<std::pair<std::uint32_t, std::uint32_t>>
        runPairs;
    static thread_local std::vector<Entity> liveLinks; // связи с бодрой стороной
    runPairs.clear();
    constexpr int kFwd[13][3] = {
        {1, 0, 0},  {-1, 1, 0}, {0, 1, 0},  {1, 1, 0},
        {-1, -1, 1}, {0, -1, 1}, {1, -1, 1},
        {-1, 0, 1}, {0, 0, 1},  {1, 0, 1},
        {-1, 1, 1}, {0, 1, 1},  {1, 1, 1},
    };
    for (const auto& o : kFwd) {
        const std::int64_t delta =
            o[0] + o[1] * kMacroDim +
            o[2] * static_cast<std::int64_t>(kMacroDim) * kMacroDim;
        std::uint32_t j = 0;
        for (std::uint32_t i = 0; i < binRuns.size(); ++i) {
            const BinRun& X = binRuns[i];
            const bool edge =
                (o[0] == 1 && X.cx == kMacroDim - 1) ||
                (o[0] == -1 && X.cx == 0) ||
                (o[1] == 1 && X.cy == kMacroDim - 1) ||
                (o[1] == -1 && X.cy == 0) ||
                (o[2] == 1 && X.cz == kMacroDim - 1);
            if (edge) {
                const std::uint64_t key = cell_bin_key(
                    X.layer, X.cx + o[0], X.cy + o[1], X.cz + o[2]);
                const std::uint32_t yi = find_run(key);
                if (yi != 0xFFFFFFFFu &&
                    (X.awake || binRuns[yi].awake))
                    runPairs.push_back({i, yi});
                continue;
            }
            const std::uint64_t nkey =
                X.key + static_cast<std::uint64_t>(delta);
            while (j < binRuns.size() && binRuns[j].key < nkey) ++j;
            if (j < binRuns.size() && binRuns[j].key == nkey &&
                (X.awake || binRuns[j].awake))
                runPairs.push_back({i, j});
        }
    }

    // Корзины АГЕНТОВ + пары (клетка пропов × клетка агентов) — тем же
    // слиянием, но по всем 27 смещениям: множества разные, дедуп не нужен.
    static thread_local CellBins agBins;
    static thread_local std::vector<BinRun> agRuns;
    static thread_local std::vector<std::pair<std::uint32_t, std::uint32_t>>
        agentPairs;
    agBins.clear();
    agRuns.clear();
    agentPairs.clear();
    if (!agents.empty()) {
    for (Entity a : agents) {
        const auto& tr = reg.get<Transform>(a);
        agBins.add(cell_bin_key(tr.layer, cell_coord(tr.pos.x),
                                cell_coord(tr.pos.y), cell_coord(tr.pos.z)),
                   a);
    }
    agBins.build();
    for (std::uint32_t i = 0; i < agBins.entries.size();) {
        std::uint32_t j = i;
        while (j < agBins.entries.size() &&
               agBins.entries[j].key == agBins.entries[i].key)
            ++j;
        agRuns.push_back({agBins.entries[i].key, i, j, 0, 0, 0, 0, true});
        i = j;
    }
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                const std::int64_t delta =
                    dx + dy * kMacroDim +
                    dz * static_cast<std::int64_t>(kMacroDim) * kMacroDim;
                std::uint32_t j = 0;
                for (std::uint32_t i = 0; i < binRuns.size(); ++i) {
                    const BinRun& X = binRuns[i];
                    const bool edge =
                        (dx == 1 && X.cx == kMacroDim - 1) ||
                        (dx == -1 && X.cx == 0) ||
                        (dy == 1 && X.cy == kMacroDim - 1) ||
                        (dy == -1 && X.cy == 0) ||
                        (dz == 1 && X.cz == kMacroDim - 1) ||
                        (dz == -1 && X.cz == 0);
                    if (edge) {
                        const std::uint64_t key = cell_bin_key(
                            X.layer, X.cx + dx, X.cy + dy, X.cz + dz);
                        auto it = std::lower_bound(
                            agRuns.begin(), agRuns.end(), key,
                            [](const BinRun& r, std::uint64_t k) {
                                return r.key < k;
                            });
                        if (it != agRuns.end() && it->key == key)
                            agentPairs.push_back(
                                {i, static_cast<std::uint32_t>(
                                        it - agRuns.begin())});
                        continue;
                    }
                    const std::uint64_t nkey =
                        X.key + static_cast<std::uint64_t>(delta);
                    while (j < agRuns.size() && agRuns[j].key < nkey) ++j;
                    if (j < agRuns.size() && agRuns[j].key == nkey)
                        agentPairs.push_back({i, j});
                }
            }
    } // if (!agents.empty())

    stats.binsMs = std::chrono::duration<float, std::milli>(
                       std::chrono::steady_clock::now() - statsBinsT0)
                       .count();
    const auto statsSolveT0 = std::chrono::steady_clock::now();

    // ШАРНИР «ТОЧКА В ТОЧКУ» — ОШИБКА ПОЗИЦИИ ПРОЕЦИРУЕТСЯ ПОЗИЦИЕЙ
    // (разделённый импульс, 2026-11-25, И1б эпика тел). Скоростная подтяжка
    // Баумгарта (β·C/h в импульсе) у шарнира с РЫЧАГОМ оказалась насосом
    // энергии: каждый подшаг ошибка от интегрирования и выталкивания
    // контакта превращалась в скорость, а та — во вращение части вокруг
    // опоры. Замер на одиноком трупе: рука перекатывалась с грани на ребро
    // ±20° с периодом 0.85 с и ПОСТОЯННОЙ амплитудой, сна не было; с
    // нулевой подтяжкой тот же труп засыпал за 4 с, рука ложилась плашмя —
    // но суставы расползались на 5 см. Отсюда форма: скорость сустава
    // решается без подтяжки (импульс выше), а позиционная ошибка снимается
    // сдвигом позиции и поворота — долей `kJointBias` за проход и с ТЕМ ЖЕ
    // знаменателем k, что у импульса (податливость одна, закон один), — и
    // скорости не трогает вовсе: качать нечем. Связь-расстояние
    // (`restLen > 0`: верёвка, штанга люстры) живёт по-прежнему — у неё
    // замера войны нет, и переводить её без замера значило бы чинить
    // работающее (назван нюанс, не залечен).
    // Спящая, застывшая и несомая стороны неподвижны: позиция спящего
    // обязана остаться бит-в-бит (§17.2, §23.6), а несомую ведёт носитель.
    auto project_point_joint = [&](const JointLink& jl) {
        if (jl.restLen > 0.0f) return;
        if (jl.a == entt::null || !reg.valid(jl.a) ||
            !reg.all_of<RigidBody, Transform>(jl.a))
            return;
        auto& ra = reg.get<RigidBody>(jl.a);
        auto& ta = reg.get<Transform>(jl.a);
        RigidBody* rbB = nullptr;
        Transform* tb = nullptr;
        if (jl.b != entt::null) {
            if (!reg.valid(jl.b) || !reg.all_of<RigidBody, Transform>(jl.b))
                return;
            rbB = &reg.get<RigidBody>(jl.b);
            tb = &reg.get<Transform>(jl.b);
        }
        const bool aFixed =
            ra.asleep || ra.suspended || reg.all_of<CarriedBy>(jl.a);
        const bool bFixed = !rbB || rbB->asleep || rbB->suspended ||
                            reg.all_of<CarriedBy>(jl.b);
        if (aFixed && bFixed) return;
        const float imA = aFixed ? 0.0f : ra.invMass;
        const float iiA = aFixed ? 0.0f : ra.invInertia;
        const float imB = bFixed ? 0.0f : rbB->invMass;
        const float iiB = bFixed ? 0.0f : rbB->invInertia;
        const vec3 axes[3] = {vec3{1.0f, 0.0f, 0.0f}, vec3{0.0f, 1.0f, 0.0f},
                              vec3{0.0f, 0.0f, 1.0f}};
        for (const vec3& n : axes) {
            // Плечи и ошибка — заново на каждой оси: проекция двигает тела,
            // и вторая ось обязана видеть сдвиг первой (Гаусс–Зейдель).
            const vec3 rcA = quat_rotate(ra.q, jl.anchorA);
            const vec3 rcB =
                rbB ? quat_rotate(rbB->q, jl.anchorB) : vec3{0.0f, 0.0f, 0.0f};
            const vec3 pa = ta.pos + rcA;
            const vec3 pb = rbB ? tb->pos + rcB : jl.anchorB;
            const float C = dot(wrap_delta3(pa, pb, kWorldExtent), n);
            const vec3 rxA = cross(rcA, n);
            const vec3 rxB = cross(rcB, n);
            const float k = imA + iiA * dot(rxA, rxA) + imB +
                            iiB * dot(rxB, rxB);
            if (k < 1e-9f) continue;
            const float lam = kJointBias * C / k;
            if (imA > 0.0f || iiA > 0.0f) {
                ta.pos += n * (lam * imA);
                ra.q = quat_integrate(ra.q, rxA * (lam * iiA), 1.0f);
            }
            if (rbB && (imB > 0.0f || iiB > 0.0f)) {
                tb->pos += n * (-lam * imB);
                rbB->q = quat_integrate(rbB->q, rxB * (-lam * iiB), 1.0f);
            }
        }
        ta.pos = vec3{wrapf(ta.pos.x, kWorldExtent), wrapf(ta.pos.y, kWorldExtent),
                      wrapf(ta.pos.z, kWorldExtent)};
        if (tb)
            tb->pos = vec3{wrapf(tb->pos.x, kWorldExtent),
                           wrapf(tb->pos.y, kWorldExtent),
                           wrapf(tb->pos.z, kWorldExtent)};
    };


    // Substep-major: тела интегрируются, ПОТОМ линки стягивают пары — иначе
    // констрейнт видел бы позиции разных подшагов у разных тел.
    for (int s = 0; s < steps; ++s) {
        chainContacts.clear();
        for (auto e : view) {
            auto& rb = view.get<RigidBody>(e);
            // ВЫНУТ ИЗ СОЛВЕРА — буквально здесь: ни гравитации, ни драга, ни
            // контактов, ни интегрирования кватерниона. Трансформ и `q`
            // остаются ровно теми, какими были, — отсюда и бит-в-бит равенство
            // позы до входа в пузырь и после выхода (§17.2, §23.6).
            if (rb.asleep || rb.suspended || reg.all_of<CarriedBy>(e)) continue;
            auto& tr = view.get<Transform>(e);
            auto& vel = view.get<Velocity>(e);
            if (!stack.valid(tr.layer)) continue;
            World& w = stack.layer(tr.layer);

            vel.v += w.gravity().at(tr.pos) * h;
            // Тот же квадратичный закон воздуха, что у всех тел ([sim/drag.h]).
            const float mass = 1.0f / std::max(rb.invMass, 1e-6f);
            air_drag_step(vel.v,
                          drag_q(vec3{rb.radius, rb.radius, rb.radius}, mass),
                          h);
            tr.pos += vel.v * h;

            // Набор контактных сфер: ContactForm (бокс и композиции — их
            // сферы жёстко сидят во фрейме тела), без него — вырожденный
            // случай: одна сфера RigidBody.radius в центре (мяч).
            const ContactForm* form = reg.try_get<ContactForm>(e);
            const int nSph = (form && form->count) ? form->count : 1;

            bool contactThisStep = false;
            vec3 contactN{0.0f, 0.0f, 0.0f};

            for (int i = 0; i < nSph; ++i) {
                vec3 off{0.0f, 0.0f, 0.0f};
                float sr = rb.radius;
                if (form && form->count) {
                    off = quat_rotate(rb.q, form->off[i]);
                    sr = form->r[i];
                }
                const SphereContact c =
                    sphere_deepest_contact(w, tr.pos + off, sr);
                if (c.depth < 0.0f) continue;
                rb.touchedTick = true;
                contactThisStep = true;
                contactN = c.n;
                // Позиционное выталкивание — не тонет. Через ТОЧКУ контакта,
                // а не всем телом (вывод у `contact_project`).
                contact_project(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f}, &tr,
                                &rb, off + c.n * (-sr), c.n, c.depth);

                // Плечо контакта от центра тела: r_c = off − n·r. У мяча
                // (off=0) r_c коллинеарно нормали, угловые вклады по n
                // нулевые — формулы ниже вырождаются в инкремент 1 точно.
                const vec3 rc = off + c.n * (-sr);
                const vec3 vp = vel.v + cross(rb.w, rc);
                const float vn = dot(vp, c.n);

                // МАТЕРИАЛЬНАЯ ПАРА (инкремент 7): вторая сторона — материал
                // клетки контакта. Сталь-по-бетону звенит, сталь-по-щебню
                // глохнет — без единой ветки по виду поверхности.
                const float surfH =
                    static_cast<float>(material_hardness(c.mat));
                const float muPair = pair_friction(
                    rb.friction, friction_from_hardness(surfH));
                // Часть цепи — контакт едет в итерации суставов, И ДО
                // проверки сближения: точку, расходящуюся сейчас, импульс
                // сустава может развернуть в пол.
                if (rb.chain != 0u)
                    chainContacts.push_back(ChainContact{
                        entt::null, e, vec3{0.0f, 0.0f, 0.0f}, 0.0f,
                        (form && form->count) ? form->off[i]
                                              : vec3{0.0f, 0.0f, 0.0f},
                        sr, c.n, muPair});
                if (vn >= 0.0f) continue;
                // Импакт-шов — тот же закон, что у свепт-AABB (E = m·v²/2
                // считает потребитель): сближение выше 4 м/с (пол свободной
                // зоны прыжка) публикуется как Impact.
                if (-vn > 4.0f) {
                    Impact& im = reg.get_or_emplace<Impact>(e);
                    if (-vn > im.speed) im.speed = -vn;
                }

                const float ePair = pair_restitution(
                    rb.restitution, restitution_from_hardness(surfH));
                const float e_ = (-vn > kBounceMinV) ? ePair : 0.0f;
                contact_impulse(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                vel.v, rb, rc, c.n, muPair, e_);
            }

            // Качение и сверление — РАЗ на подшаг, не на сферу: у бокса на
            // плоскости контактных сфер четыре, и повтор в цикле давал бы
            // четырёхкратное трение качения.
            if (contactThisStep) {
                // Трение качения: замедление a = Crr·g вдоль движения.
                const float g = length(w.gravity().at(tr.pos));
                const float vLen = length(vel.v);
                if (vLen > 1e-5f) {
                    const float dv = std::min(vLen, kRollCrr * g * h);
                    vel.v += vel.v * (-dv / vLen);
                }
                // Сверление: гасим только компоненту w вдоль нормали.
                const float wn = dot(rb.w, contactN);
                rb.w += contactN * (wn * (std::exp(-kSpinDamp * h) - 1.0f));

            }

            rb.q = quat_integrate(rb.q, rb.w, h);

            tr.pos.x = wrapf(tr.pos.x, kWorldExtent);
            tr.pos.y = wrapf(tr.pos.y, kWorldExtent);
            tr.pos.z = wrapf(tr.pos.z, kWorldExtent);
        }

        // Фаза пар: готовый список пар клеток (построен раз на тик выше) +
        // пары внутри бодрых клеток. Спящая пара внутри resolve_pair — ноль.
        for (const BinRun& X : binRuns) {
            if (!X.awake) continue;
            for (std::uint32_t a = X.lo; a < X.hi; ++a)
                for (std::uint32_t b = a + 1; b < X.hi; ++b)
                    resolve_pair(bodyBins.entries[a].e,
                                 bodyBins.entries[b].e);
        }
        for (const auto& pr : runPairs) {
            const BinRun& X = binRuns[pr.first];
            const BinRun& Y = binRuns[pr.second];
            for (std::uint32_t a = X.lo; a < X.hi; ++a)
                for (std::uint32_t b = Y.lo; b < Y.hi; ++b)
                    resolve_pair(bodyBins.entries[a].e,
                                 bodyBins.entries[b].e);
        }

        // Фаза проп↔агент: готовые пары клеток, обе стороны честные.
        for (const auto& pr : agentPairs) {
            const BinRun& X = binRuns[pr.first];
            const BinRun& A = agRuns[pr.second];
            for (std::uint32_t a = X.lo; a < X.hi; ++a)
                for (std::uint32_t g = A.lo; g < A.hi; ++g)
                    resolve_agent(bodyBins.entries[a].e,
                                  agBins.entries[g].e);
        }

        // ФАЗА ЛИНКОВ — ТОЛЬКО ПО ЖИВЫМ СВЯЗЯМ. Тот же приём, которым фаза
        // пар давно не платит за спящий мир («соседи ищутся раз на КЛЕТКУ С
        // БОДРЫМИ телами, не раз на тело»), и та же причина: kJointIters × 2
        // подшага = 16 проходов по ВСЕМ связям за тик, а `solve_link`
        // выясняет, что обе стороны спят, только внутри — после четырёх
        // ECS-проб. Замер 2026-09-30 на 1000 спящих трупов (4000 тел, 3000
        // связей, один движущийся агент): **solve 1.467 → 0.088 мс**, в 17
        // раз. До этого замера я объявил «спящий мир бесплатен» — он им не
        // был: ранний выход «мир спит целиком» требует, чтобы агентов НЕ
        // БЫЛО, а игрок в мире есть всегда, так что 48 000 вызовов на тик
        // платились за неподвижную гору трупов каждый кадр.
        //
        // Список строится РАЗ НА ПОДШАГ, после фазы пар: разбуженный
        // контактом уже виден здесь, а разбуженный самим `wakePass` войдёт
        // со следующего подшага — та же задержка на подшаг, что у корзин.
        liveLinks.clear();
        for (auto le : links) {
            const JointLink& jl = links.get<JointLink>(le);
            if (jl.a == entt::null || !reg.valid(jl.a) ||
                !reg.all_of<RigidBody>(jl.a))
                continue;
            // ЗАСТЫВШАЯ сторона мертва для связи ровно как спящая — и это
            // главный выигрыш F1 по числу: на 1000 трупах сон берёт 9% тел, а
            // остальные 91% держат свои 3000 связей живыми и платят
            // kJointIters × подшаги = 16 проходов на тик каждая (§64).
            auto link_dead = [&](const RigidBody& r) {
                return r.asleep || r.suspended;
            };
            const bool aAwake = !link_dead(reg.get<RigidBody>(jl.a));
            bool bAwake = false;
            if (jl.b != entt::null) {
                if (!reg.valid(jl.b) || !reg.all_of<RigidBody>(jl.b)) continue;
                bAwake = !link_dead(reg.get<RigidBody>(jl.b));
            }
            // Спящий с МИРОВЫМ якорем тоже мёртв: якорь не движется, а
            // проснуться телу даст разруб опоры (rigid_wake_dirty_cells).
            if (aAwake || bAwake) liveLinks.push_back(le);
        }
        for (Entity le : liveLinks)
            damp_point_joint(links.get<JointLink>(le));
        for (int it = 0; it < kJointIters; ++it) {
            for (Entity le : liveLinks) {
                solve_link(links.get<JointLink>(le), it == 0);
                ++stats.linksSolved;
            }
            // Контакты частей цепи — ТЕМ ЖЕ законом, последними в итерации
            // (вывод у `chainContacts`). Плечо — от текущего поворота: `q`
            // уже проинтегрирован в проходе тела, суставы двигают скорости.
            // Отскока здесь нет: удар решён первым проходом.
            // Спящая/застывшая сторона — неподвижная опора, как в первом
            // решении пары (стороны меняются местами, нормаль — знаком).
            for (const ChainContact& cc : chainContacts) {
                RigidBody& rb = view.get<RigidBody>(cc.b);
                const bool bDyn = !rb.asleep && !rb.suspended;
                const vec3 rcB = quat_rotate(rb.q, cc.offB) + cc.n * (-cc.rB);
                RigidBody* ra = cc.a == entt::null
                                    ? nullptr
                                    : &view.get<RigidBody>(cc.a);
                const bool aDyn = ra && !ra->asleep && !ra->suspended;
                const vec3 rcA = ra ? quat_rotate(ra->q, cc.offA) + cc.n * cc.rA
                                    : vec3{0.0f, 0.0f, 0.0f};
                if (aDyn && bDyn)
                    contact_impulse(&view.get<Velocity>(cc.a).v, ra, rcA,
                                    view.get<Velocity>(cc.b).v, rb, rcB, cc.n,
                                    cc.mu, 0.0f);
                else if (bDyn)
                    contact_impulse(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    view.get<Velocity>(cc.b).v, rb, rcB, cc.n,
                                    cc.mu, 0.0f);
                else if (aDyn)
                    contact_impulse(nullptr, nullptr, vec3{0.0f, 0.0f, 0.0f},
                                    view.get<Velocity>(cc.a).v, *ra, rcA,
                                    cc.n * -1.0f, cc.mu, 0.0f);
            }
        }
        // Позиционная проекция шарниров — после того как скорости решены, тем
        // же числом проходов Гаусса–Зейделя, что у импульса (`kJointIters`):
        // цепь из ~8 звеньев сходится за столько же проходов и позицией.
        // Замер одного прохода против восьми (маятник шарнира, `world_test`):
        // зазор 2.6 против 0.3 мм, рывок поперёк 5.8 против 0.7 мм; суставы
        // кучи из 16 трупов 29 против 1.2 мм; цена на куче — в шуме замера.
        for (int it = 0; it < kJointIters; ++it)
            for (Entity le : liveLinks)
                project_point_joint(links.get<JointLink>(le));
    }

    stats.solveMs = std::chrono::duration<float, std::milli>(
                        std::chrono::steady_clock::now() - statsSolveT0)
                        .count();

    // ОПОРА ПЕРЕДАЁТСЯ ПО СУСТАВУ (2026-11-25, И1б). Контакт ПАРЫ давно
    // считается опорой (`touchedTick` от пары — стопка тел засыпает), а
    // сустав между двумя ТЕЛАМИ есть тот же контакт, только постоянный: рука,
    // лежащая на шарнире плеча, опёрта торсом ровно так же, как ящик на
    // ящике. Без этого часть, касающаяся только своего сустава (голова на
    // шее, конечность, свесившаяся с соседнего трупа), была «висящей» и не
    // засыпала НИКОГДА — замер: куча из 16 семичастных трупов, 6 тихих тел
    // без опоры навсегда, одинокий труп — голова. Опора передаётся от тела,
    // которое касается мира или спит (спящее касалось, когда засыпало), —
    // и до неподвижной точки: цепь не глубже `kJointIters` звеньев, вывод у
    // самой константы. МИРОВОЙ ПОДВЕС опорой не считается — люстра на тросе
    // по-прежнему висит бодрой (довод ниже, у закона сна).
    for (int pass = 0; pass < kJointIters; ++pass) {
        bool spread = false;
        for (Entity le : liveLinks) {
            const JointLink& jl = links.get<JointLink>(le);
            if (jl.a == entt::null || jl.b == entt::null) continue;
            if (!reg.valid(jl.a) || !reg.valid(jl.b) ||
                !reg.all_of<RigidBody>(jl.a) || !reg.all_of<RigidBody>(jl.b))
                continue;
            RigidBody& a = reg.get<RigidBody>(jl.a);
            RigidBody& b = reg.get<RigidBody>(jl.b);
            const bool sa = a.touchedTick || a.asleep;
            const bool sb = b.touchedTick || b.asleep;
            if (sa == sb) continue;
            (sa ? b : a).touchedTick = true;
            spread = true;
        }
        if (!spread) break;
    }

    // Сон: тихая линейка И тихое вращение (|w|·r в тех же единицах м/с), и
    // обязательно ОПОРА в этом тике — контакт с миром, с телом или через
    // сустав (выше) — свободно падающее и ВИСЯЩЕЕ на мировом подвесе тело
    // не засыпает: спящему линк не даёт провиснуть, а разруб не смог бы его
    // разбудить падением.
    for (auto e : view) {
        auto& rb = view.get<RigidBody>(e);
        // Застывшее тело не свипуется: его скорости не менялись, вывод свипа
        // был бы тот же, и главное — `quietTicks` обязан ОСТАТЬСЯ набранным,
        // иначе решатель пузыря на следующем тике сам себя отменил бы.
        // СТАЖ ТИШИНЫ СПЯЩЕГО НАЧИСЛЯЕТСЯ НЕ ЗДЕСЬ, а в проходе пробуждения
        // наверху: этот свип стоит ЗА ранним выходом, то есть на спящей сцене
        // без возмутителей не исполняется вовсе, и начисление отсюда замирало
        // бы ровно там, где застывание и нужно. Полный разбор — у начисления.
        // Бодрым телам стаж считается ниже, и до них свип доходит всегда,
        // когда они есть: бодрое тело не даёт раннему выходу сработать.
        if (rb.asleep || rb.suspended || reg.all_of<CarriedBy>(e)) continue;
        auto& vel = view.get<Velocity>(e);
        const float wr2 = dot(rb.w, rb.w) * rb.radius * rb.radius;
        const float v2 = dot(vel.v, vel.v);
        const bool quiet = v2 < kSleepV2 && wr2 < kSleepV2;
        // СТАЖ ТИШИНЫ БОДРОГО ТЕЛА — БЕЗ ТРЕБОВАНИЯ КОНТАКТА, и это ровно та
        // половина предиката сна, которой трупам не хватает (§64: опора под
        // трупом — другой труп, и он спит, так что пара не решается и
        // `touchedTick` не выставляется никем). Читает решатель пузыря.
        // Насыщение на пороге, а не на 255: счётчику дальше расти незачем, а
        // переполнение байта сбросило бы его в ноль и расстворозило бы
        // застывшую гору каждые 2 секунды.
        if (!quiet) rb.quietTicks = 0;
        else if (rb.quietTicks < static_cast<std::uint8_t>(kSuspendQuietTicks))
            ++rb.quietTicks;
        if (!quiet) {
            if (v2 >= kSleepV2) ++stats.noisyLinear;
            if (wr2 >= kSleepV2) ++stats.noisySpin;
            stats.noisyMaxV = std::max(stats.noisyMaxV, std::sqrt(v2));
        }
        if (quiet && rb.touchedTick) {
            if (++rb.sleepTicks >= kSleepAfter) {
                rb.asleep = true;
                vel.v = vec3{0.0f, 0.0f, 0.0f};
                rb.w = vec3{0.0f, 0.0f, 0.0f};
            }
        } else {
            if (!quiet) ++stats.noisyBodies;
            else ++stats.quietNoTouch;
            rb.sleepTicks = 0;
        }
    }

    link_error_sweep();
    reg.ctx().insert_or_assign(stats);
}

float form_from_box(vec3 half, ContactForm& out) {
    // Радиус контактных сфер ВЫВЕДЕН из тонкой стороны бокса: r = min(half)/2
    // — сфера сидит внутри заподлицо с гранью (офсет = half − r), рёбра
    // скруглены ровно этим радиусом. Тоньше бокс — мельче сферы, форма
    // остаётся честной и для дверного полотна.
    const float r = 0.5f * std::min({half.x, half.y, half.z});
    int n = 0;
    // 8 углов — момент и кувырок.
    for (int sz = -1; sz <= 1; sz += 2)
        for (int sy = -1; sy <= 1; sy += 2)
            for (int sx = -1; sx <= 1; sx += 2) {
                out.off[n] = vec3{static_cast<float>(sx) * (half.x - r),
                                  static_cast<float>(sy) * (half.y - r),
                                  static_cast<float>(sz) * (half.z - r)};
                out.r[n] = r;
                ++n;
            }
    // 6 центров граней — плоское лежание опирается не только на углы, и
    // длинная грань не провисает в субвоксельную щель.
    for (int a = 0; a < 3; ++a)
        for (int s = -1; s <= 1; s += 2) {
            vec3 off{0.0f, 0.0f, 0.0f};
            const float d = static_cast<float>(s);
            if (a == 0) off.x = d * (half.x - r);
            else if (a == 1) off.y = d * (half.y - r);
            else off.z = d * (half.z - r);
            out.off[n] = off;
            out.r[n] = r;
            ++n;
        }
    out.count = static_cast<std::uint8_t>(n);

    float bound = 0.0f;
    for (int i = 0; i < n; ++i)
        bound = std::max(bound, length(out.off[i]) + out.r[i]);
    return bound;
}

void rigid_attach_sphere(Registry& reg, Entity e, float radius, float massKg,
                         float restitution, float friction) {
    const float m = std::max(massKg, 0.001f);
    RigidBody rb;
    rb.radius = radius;
    rb.invMass = 1.0f / m;
    rb.invInertia = 1.0f / (0.4f * m * radius * radius); // сфера: 2/5 m r²
    rb.restitution = restitution;
    rb.friction = friction;
    reg.emplace_or_replace<RigidBody>(e, rb);
    if (reg.all_of<ContactForm>(e)) reg.remove<ContactForm>(e);
    if (!reg.all_of<SelfIntegrating>(e)) reg.emplace<SelfIntegrating>(e);
}

void rigid_attach_box(Registry& reg, Entity e, vec3 half, float massKg,
                      float restitution, float friction) {
    const float m = std::max(massKg, 0.001f);
    ContactForm form;
    const float bound = form_from_box(half, form);
    const float dx = half.x * 2.0f, dy = half.y * 2.0f, dz = half.z * 2.0f;
    RigidBody rb;
    rb.radius = bound; // ограничивающая сфера — брод-фаза
    rb.invMass = 1.0f / m;
    // Скалярная инерция бокса — среднее диагонали тензора:
    // I_avg = m·(dx²+dy²+dz²)/18 (диагональный тензор — инкремент 7).
    rb.invInertia = 18.0f / (m * (dx * dx + dy * dy + dz * dz));
    rb.restitution = restitution;
    rb.friction = friction;
    reg.emplace_or_replace<RigidBody>(e, rb);
    reg.emplace_or_replace<ContactForm>(e, form);
    if (!reg.all_of<SelfIntegrating>(e)) reg.emplace<SelfIntegrating>(e);
}

std::uint32_t rigid_wake_dirty_cells(Registry& reg, LayerId layer,
                                     const std::uint32_t* cells,
                                     std::size_t n) {
    if (cells == nullptr || n == 0) return 0;
    // Обход инвертирован против бинов: спящих тел обычно немного, а
    // dirty-список бывает большим (шов автомата) — дешевле спросить 27
    // соседей каждого спящего у хеш-набора, чем биновать dirty.
    static thread_local std::vector<std::uint32_t> dirtySorted;
    dirtySorted.assign(cells, cells + n);
    std::sort(dirtySorted.begin(), dirtySorted.end());
    auto in_dirty = [&](std::uint32_t key) {
        return std::binary_search(dirtySorted.begin(), dirtySorted.end(), key);
    };
    std::uint32_t woken = 0;
    auto view = reg.view<Transform, RigidBody>();
    for (auto e : view) {
        auto& rb = view.get<RigidBody>(e);
        // ЗАСТЫВШИЕ ТОЖЕ, И ЭТО ТРЕБОВАНИЕ §23.1, А НЕ ВЕЖЛИВОСТЬ. Долг
        // писателя геометрии (S20.4) не знает, почему тело вне решателя: если
        // под застывшим трупом выкарвили плиту, в прогоне «радиус ∞» он бы
        // упал, и мир разошёлся бы на целый труп. Без этой строки застывание
        // перестаёт быть классом 1 и становится багом «труп висит в воздухе» —
        // тем самым, который §10 уже ловил на вращающемся окне пака.
        if (!rb.asleep && !rb.suspended) continue;
        const auto& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;
        const int cx = cell_coord(tr.pos.x);
        const int cy = cell_coord(tr.pos.y);
        const int cz = cell_coord(tr.pos.z);
        bool hit = false;
        for (int dz = -1; dz <= 1 && !hit; ++dz)
            for (int dy = -1; dy <= 1 && !hit; ++dy)
                for (int dx = -1; dx <= 1 && !hit; ++dx)
                    hit = in_dirty(static_cast<std::uint32_t>(macro_index(
                        wrap_macro(cx + dx), wrap_macro(cy + dy),
                        wrap_macro(cz + dz))));
        if (!hit) continue;
        rb.asleep = false;
        rb.sleepTicks = 0;
        rb.suspended = false;
        rb.quietTicks = 0; // стаж тишины сброшен: тело снова обязан проверить мир
        ++woken;
    }
    return woken;
}

void rigid_wake_body(Registry& reg, Entity e) {
    if (e == entt::null || !reg.valid(e) || !reg.all_of<RigidBody>(e)) return;
    RigidBody& rb = reg.get<RigidBody>(e);
    rb.asleep = false;
    rb.sleepTicks = 0;
    rb.suspended = false;
    rb.quietTicks = 0;
}

} // namespace giga

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
// Второй якорь Crr (2026-11-07): мягкое-по-твёрдому. Качение тормозит
// гистерезис деформации, и мера гистерезиса в паре уже есть — restitution
// пары; Crr интерполируется по ней между якорями (см. блок качения).
// Справочник: шина/мягкое тело по грунту 0.1–0.35, берём середину. До этого
// Crr был ОДНИМ числом на все материи, и труп-капсула (e пары 0.16) катился
// как стальной подшипник: выбег 4.9 м с 2 м/с (стенд rest), «каток» глазами
// владельца на этаже 6 (прогон 2026-11-07, ~1250 тел шумят непрерывно).
constexpr float kRollCrrSoft = 0.25f;

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
                const float mwr2 = dot(mover.w, mover.w) * mover.radius *
                                   mover.radius;
                if (dot(mv, mv) >= kWakeV2 || mwr2 >= kWakeV2) {
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
        const bool aKinematic = reg.all_of<CarriedBy>(jl.a);
        const bool bKinematic = rbB && reg.all_of<CarriedBy>(jl.b);
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
                if (rbA.asleep) {
                    rbA.asleep = false; rbA.sleepTicks = 0; ++stats.wokePair;
                }
                if (rbB.asleep) {
                    rbB.asleep = false; rbB.sleepTicks = 0; ++stats.wokePair;
                }
                rbA.touchedTick = true;
                rbB.touchedTick = true;

                // Позиционное разведение по долям обратных масс: тяжёлый
                // стоит, лёгкий уступает — без ветки «кто главнее».
                const float invSum = rbA.invMass + rbB.invMass;
                trA.pos += n * (-depth * (rbA.invMass / invSum));
                trB.pos += n * (depth * (rbB.invMass / invSum));

                // Плечи до СВОЕЙ точки поверхности.
                const vec3 rcA = offA + n * rA;
                const vec3 rcB = offB + n * (-rB);
                const vec3 vpA = vA.v + cross(rbA.w, rcA);
                const vec3 vpB = vB.v + cross(rbB.w, rcB);
                const float vn = dot(vpB - vpA, n);
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
                const vec3 rxA = cross(rcA, n);
                const vec3 rxB = cross(rcB, n);
                const float kA = rbA.invMass + rbA.invInertia * dot(rxA, rxA);
                const float kB = rbB.invMass + rbB.invInertia * dot(rxB, rxB);
                const float jn = -(1.0f + e_) * vn / (kA + kB);
                vA.v += n * (-jn * rbA.invMass);
                rbA.w += cross(rcA, n * (-jn)) * rbA.invInertia;
                vB.v += n * (jn * rbB.invMass);
                rbB.w += cross(rcB, n * jn) * rbB.invInertia;

                const vec3 vp2 = (vB.v + cross(rbB.w, rcB)) -
                                 (vA.v + cross(rbA.w, rcA));
                const vec3 vt = vp2 - n * dot(vp2, n);
                const float vtLen = length(vt);
                if (vtLen > 1e-5f) {
                    const vec3 t = vt * (1.0f / vtLen);
                    const vec3 rtA = cross(rcA, t);
                    const vec3 rtB = cross(rcB, t);
                    const float kt =
                        rbA.invMass + rbA.invInertia * dot(rtA, rtA) +
                        rbB.invMass + rbB.invInertia * dot(rtB, rtB);
                    float jt = -vtLen / kt;
                    const float mu = pair_friction(rbA.friction, rbB.friction);
                    const float jtMax = mu * jn;
                    jt = std::clamp(jt, -jtMax, jtMax);
                    vA.v += t * (-jt * rbA.invMass);
                    rbA.w += cross(rcA, t * (-jt)) * rbA.invInertia;
                    vB.v += t * (jt * rbB.invMass);
                    rbB.w += cross(rcB, t * jt) * rbB.invInertia;
                }
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
            // ПОДНЯЛИ В РУКИ — застывание снято, и снято ЗДЕСЬ, а не решателем
            // пузыря: монстр, волокущий труп в сорока метрах от игрока, тащит
            // его по-настоящему (S7: путь переноски один на всех). Тело в
            // руках застыванию не подлежит вовсе — его позицию пишет носитель,
            // а не солвер, и «вынуть из солвера» для него бессмысленно.
            if (rb.suspended) {
                rb.suspended = false;
                rb.quietTicks = 0;
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
    // (7000 трупов = 28 000 тел, 21 000 линков, 7000 цепей) это сортировка
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
    // знает (S7), и знать не должно: труп — это цепь из четырёх сегментов,
    // люстра на тросе — цепь, сцепка ящиков — цепь, и закон у них один. Это
    // же даёт требуемое §17.2 «посегментно на весь труп разом» бесплатно: все
    // сегменты несут ОДНУ метку корня, поэтому ответ пузыря у них один.
    //
    // ОДИНОЧНЫЕ ТЕЛА (chain == 0) В F1 НЕ ЗАСТЫВАЮТ, и это граница заходa, а
    // не забывчивость: кривая цены, из которой выведен N (§17.2), снята на
    // ЧЕТЫРЁХСЕГМЕНТНЫХ цепях, а мешать в один бюджет штуки с разной ценой —
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
        nearBuf.resize(budgetN);
        const std::uint32_t got =
            budgetN == 0
                ? 0u
                : presence_query(kRagdollPresence, chainBins, reg,
                                 nearBuf.data(), budgetN);
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
        auto& rb = view.get<RigidBody>(e);
        if (rb.chain == 0u) {
            // Вне цепей — вне захода F1 (одиночки едут с F2, со своим замером).
            // Если бит на теле как-то остался — цепь разрубили, пока оно было
            // застывшим, — снимаем: такое тело не оживит уже никакой сустав.
            if (rb.suspended) {
                rb.suspended = false;
                rb.quietTicks = 0;
                ++stats.unsuspBubble;
            }
            ++stats.notSuspendedLoose;
        } else if (!rb.suspended) {
            if (rb.quietTicks < static_cast<std::uint8_t>(kSuspendQuietTicks))
                ++stats.notSuspendedNoisy;
            else if (reg.all_of<CarriedBy>(e))
                ++stats.notSuspendedCarried;
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

    // Substep-major: тела интегрируются, ПОТОМ линки стягивают пары — иначе
    // констрейнт видел бы позиции разных подшагов у разных тел.
    for (int s = 0; s < steps; ++s) {
        for (auto e : view) {
            auto& rb = view.get<RigidBody>(e);
            // ВЫНУТ ИЗ СОЛВЕРА — буквально здесь: ни гравитации, ни драга, ни
            // контактов, ни интегрирования кватерниона. Трансформ и `q`
            // остаются ровно теми, какими были, — отсюда и бит-в-бит равенство
            // позы до входа в пузырь и после выхода (§17.2, §23.6).
            if (rb.asleep || rb.suspended) continue;
            if (reg.all_of<CarriedBy>(e)) continue; // кинематика носителя
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
            // Копилки подшага для качения и стояночного Кулона ниже:
            // суммарный нормальный импульс и худшие (минимальные) µ/e по
            // контактам. Сферы с vn ≥ 0 не вкладываются — у них нет jn.
            float jnSum = 0.0f;
            float muMin = 1.0f;
            float eMin = 0.9f; // верх шкалы restitution_from_hardness

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
                // Позиционное выталкивание всего тела — не тонет.
                tr.pos += c.n * c.depth;

                // Плечо контакта от центра тела: r_c = off − n·r. У мяча
                // (off=0) r_c коллинеарно нормали, угловые вклады по n
                // нулевые — формулы ниже вырождаются в инкремент 1 точно.
                const vec3 rc = off + c.n * (-sr);
                const vec3 vp = vel.v + cross(rb.w, rc);
                const float vn = dot(vp, c.n);
                if (vn >= 0.0f) continue;
                // Импакт-шов — тот же закон, что у свепт-AABB (E = m·v²/2
                // считает потребитель): сближение выше 4 м/с (пол свободной
                // зоны прыжка) публикуется как Impact.
                if (-vn > 4.0f) {
                    Impact& im = reg.get_or_emplace<Impact>(e);
                    if (-vn > im.speed) im.speed = -vn;
                }

                // МАТЕРИАЛЬНАЯ ПАРА (инкремент 7): вторая сторона — материал
                // клетки контакта. Сталь-по-бетону звенит, сталь-по-щебню
                // глохнет — без единой ветки по виду поверхности.
                const float surfH =
                    static_cast<float>(material_hardness(c.mat));
                const float ePair = pair_restitution(
                    rb.restitution, restitution_from_hardness(surfH));
                const float muPair = pair_friction(
                    rb.friction, friction_from_hardness(surfH));

                // Обобщённый нормальный импульс (sequential impulses):
                // k_n = 1/m + |r_c×n|²/I — угловая податливость контакта.
                const vec3 rxn = cross(rc, c.n);
                const float kn =
                    rb.invMass + rb.invInertia * dot(rxn, rxn);
                const float e_ = (-vn > kBounceMinV) ? ePair : 0.0f;
                const float jn = -(1.0f + e_) * vn / kn;
                vel.v += c.n * (jn * rb.invMass);
                rb.w += cross(rc, c.n * jn) * rb.invInertia;
                jnSum += jn;
                if (muPair < muMin) muMin = muPair;
                if (ePair < eMin) eMin = ePair;

                // Кулоново трение ЧЕРЕЗ ТОЧКУ КОНТАКТА (скорость точки —
                // после нормального импульса). Тормозя скольжение точки,
                // импульс раскручивает тело — качение возникает из физики.
                const vec3 vp2 = vel.v + cross(rb.w, rc);
                const vec3 vt = vp2 - c.n * dot(vp2, c.n);
                const float vtLen = length(vt);
                if (vtLen > 1e-5f) {
                    const vec3 t = vt * (1.0f / vtLen);
                    const vec3 rxt = cross(rc, t);
                    const float kt =
                        rb.invMass + rb.invInertia * dot(rxt, rxt);
                    float jt = -vtLen / kt;
                    const float jtMax = muPair * jn;
                    jt = std::clamp(jt, -jtMax, jtMax);
                    vel.v += t * (jt * rb.invMass);
                    rb.w += cross(rc, t * jt) * rb.invInertia;
                }
            }

            // Качение и сверление — РАЗ на подшаг, не на сферу: у бокса на
            // плоскости контактных сфер четыре, и повтор в цикле давал бы
            // четырёхкратное трение качения.
            if (contactThisStep) {
                // Трение качения: замедление a = Crr·g вдоль движения.
                // Crr — свойство ПАРЫ, как µ и e (2026-11-07): линейная
                // интерполяция по restitution пары между якорями
                // kRollCrr (e = 0.9, жёсткое) и kRollCrrSoft (e = 0,
                // мягкое). Чистое качение Кулон не тормозит (скорость
                // точки контакта = 0) — Crr единственный закон выбега.
                const float crr =
                    kRollCrrSoft + (kRollCrr - kRollCrrSoft) *
                                       std::min(eMin * (1.0f / 0.9f), 1.0f);
                const float g = length(w.gravity().at(tr.pos));
                const float vLen = length(vel.v);
                if (vLen > 1e-5f) {
                    const float dv = std::min(vLen, crr * g * h);
                    vel.v += vel.v * (-dv / vLen);
                }
                // Сверление: гасим только компоненту w вдоль нормали.
                const float wn = dot(rb.w, contactN);
                rb.w += contactN * (wn * (std::exp(-kSpinDamp * h) - 1.0f));

                // СТОЯНОЧНЫЙ КУЛОН — статическое трение как закон (§64в,
                // закрыт 2026-11-07). Динамический Кулон выше идёт по
                // сферам ПОСЛЕДОВАТЕЛЬНО: нормальный импульс поздней сферы
                // доворачивает тангенс, который трение уже не видит, и
                // остаток за подшаг µ-НЕЗАВИСИМ. Два замеренных следствия
                // (стенд rest + куча): порог съезда не двигался с
                // материалом (ящик съезжал с 25° при µ пары 0.73) и куча
                // держала ~12% тел в вечной дрожи 0.12–0.18 м/с — выше
                // kSleepV, сон недостижим. Закон: покой держится, пока
                // импульс полной остановки тангенса и вращения не
                // превосходит статический бюджет µ·ΣJn подшага. ОБА
                // операнда — импульсы одного подшага, h сокращается: ни
                // одной новой константы времени или скорости; µs = µk
                // (стандартное упрощение, разница 10–20% — не наш
                // порядок). Порог съезда отныне arctan(µ пары) ПО
                // ПОСТРОЕНИЮ — двигается с материалом, что и было
                // приёмкой §64в. ЧЕСТНАЯ ОГОВОРКА (замер стенда rest
                // 2026-11-07): гейт идёт ПОВЕРХ уже потраченного
                // динамического Кулона, бюджет не вычитает jt сфер —
                // эффективный статический µ до ×2 динамического, и
                // скользкий материал (пара 0.35) держит 25° там, где
                // честный порог 19°. Вычет потраченного возвращал бы лик
                // (на клампе бюджет нулевой — тело снова ползёт), так что
                // перекос принят СОЗНАТЕЛЬНО в сторону «липче»: зависимость
                // от µ живёт в пути/времени съезда (×10 между µ 0.35 и
                // 0.74), порог в градусах двигается слабее arctan(µ).
                // Пинок, толчок среды или тяга сустава
                // дают need выше бюджета — живую физику гейт не трогает.
                // ОКНО ПОЧТИ-ПОКОЯ обязательно, и это не вкус, а два
                // красных гейта world_test (2026-11-07, первая редакция
                // закона была без окна): (1) на приземлении ударный ΣJn
                // раздувает бюджет настолько, что гейт глушил КАЧЕНИЕ —
                // а у качения точка контакта и так покоится, статике там
                // делать нечего (мяч «прилипал» в момент удара, spun
                // краснел); (2) статика сопротивляется СКОЛЬЖЕНИЮ, но не
                // ОПРОКИДЫВАНИЮ — зануление w каждый подшаг было
                // храповиком, который не давал моменту опрокидывания
                // накопиться, и ящик замирал на ребре (rest < 0.60
                // краснел). Порог окна = 3·g·h — три «зерна» скорости,
                // которые гравитация даёт за подшаг: ниже этого движение
                // неотличимо от дребезга интегратора, выше — живое.
                // Вращение внутри окна не зануляется, а ГАСИТСЯ той же
                // постоянной, что сверление: момент опрокидывания
                // пробивает гашение (w* = τ/(I·kSpinDamp)), дребезг — нет.
                // Плечо углового need — ограничивающая сфера (верхняя
                // граница реального плеча, занижает need); ошибка
                // ограничена бюджетом одного подшага — микроимпульс.
                // ГРАНИЦА ЗАКОНА (куча, стенд 2026-11-07): ΣJn копится
                // ТОЛЬКО с контактов о мир — фаза пар идёт отдельно ниже,
                // и тело, лежащее НА ДРУГОМ ТЕЛЕ, бюджета не имеет: гейт
                // для него нем. Резидуал кучи ~10% тлеющих (0.2–0.9 м/с,
                // будит пара) остался — статика ПО ПАРАМ не написана
                // сознательно: ей нужны пер-тельные копилки через фазу,
                // это отдельный заход со своим замером.
                if (jnSum > 0.0f) {
                    const vec3 vt =
                        vel.v - contactN * dot(vel.v, contactN);
                    const float vStick = 3.0f * g * h;
                    const float wr = length(rb.w) *
                                     std::max(rb.radius, 1e-3f);
                    if (length(vt) < vStick && wr < vStick) {
                        const float mass =
                            1.0f / std::max(rb.invMass, 1e-6f);
                        const float inertia = rb.invInertia > 0.0f
                                                  ? 1.0f / rb.invInertia
                                                  : 0.0f;
                        const float need =
                            mass * length(vt) +
                            inertia * length(rb.w) /
                                std::max(rb.radius, 1e-3f);
                        if (need <= muMin * jnSum) {
                            vel.v += vt * -1.0f;
                            rb.w = rb.w *
                                   std::exp(-kSpinDamp * h);
                        }
                    }
                }
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
        for (int it = 0; it < kJointIters; ++it)
            for (Entity le : liveLinks) {
                solve_link(links.get<JointLink>(le), it == 0);
                ++stats.linksSolved;
            }
    }

    stats.solveMs = std::chrono::duration<float, std::milli>(
                        std::chrono::steady_clock::now() - statsSolveT0)
                        .count();

    // Сон: тихая линейка И тихое вращение (|w|·r в тех же единицах м/с), и
    // обязательно контакт с миром в этом тике — свободно падающее и ВИСЯЩЕЕ
    // (цепь на подвесе) тело не засыпает: спящему линк не даёт провиснуть,
    // а разруб не смог бы его разбудить падением.
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
        if (rb.asleep || rb.suspended) continue;
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

} // namespace giga

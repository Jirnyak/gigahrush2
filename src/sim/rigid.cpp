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
            const bool aAsleep = ra.asleep;
            const bool bAsleep = rbB ? rbB->asleep : true;
            if (aAsleep != bAsleep) {
                if (aAsleep) { ra.asleep = false; ra.sleepTicks = 0; }
                else if (rbB) { rbB->asleep = false; rbB->sleepTicks = 0; }
            }
        }
        if (ra.asleep && (!rbB || rbB->asleep)) return;

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
        // Импульс с Baumgarte-подтяжкой позиционной ошибки: β·C/h.
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
        if (rbA.asleep && rbB.asleep) return;
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

                if (rbA.asleep) { rbA.asleep = false; rbA.sleepTicks = 0; }
                if (rbB.asleep) { rbB.asleep = false; rbB.sleepTicks = 0; }
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
                if (rb.asleep) { rb.asleep = false; rb.sleepTicks = 0; }
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

    // Пробуждение внешней записью Velocity (взрыв, толчок, пинок пишут её —
    // естественный интерфейс) + сброс тик-аккумулятора касаний.
    RigidStats stats; // замер §59.11 — пишется в reg.ctx() на каждом выходе
    std::uint32_t awakeCount = 0;
    for (auto e : view) {
        ++stats.bodies;
        auto& rb = view.get<RigidBody>(e);
        rb.touchedTick = false;
        if (rb.asleep &&
            dot(view.get<Velocity>(e).v, view.get<Velocity>(e).v) >= kWakeV2) {
            rb.asleep = false;
            rb.sleepTicks = 0;
        }
        if (!rb.asleep) ++awakeCount;
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

    stats.awake = awakeCount;
    stats.agents = static_cast<std::uint32_t>(agents.size());
    stats.links = static_cast<std::uint32_t>(links.size());

    // Мир спит целиком и агентов-возмутителей нет — решать нечего:
    // установившийся этаж с тысячами пропов стоит один проход пробуждения.
    if (awakeCount == 0 && agents.empty()) {
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
            if (!view.get<RigidBody>(bodyBins.entries[j].e).asleep)
                awake = true;
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
            if (rb.asleep) continue;
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

        // Фаза линков: kJointIters проходов sequential impulses по всем
        // связям (цепь сходится итерациями, как контакты у бокса).
        for (int it = 0; it < kJointIters; ++it) {
            for (auto le : links) {
                solve_link(links.get<JointLink>(le), it == 0);
            }
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
        if (rb.asleep) continue;
        auto& vel = view.get<Velocity>(e);
        const float wr2 = dot(rb.w, rb.w) * rb.radius * rb.radius;
        const bool quiet =
            dot(vel.v, vel.v) < kSleepV2 && wr2 < kSleepV2;
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
        if (!rb.asleep) continue;
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
        ++woken;
    }
    return woken;
}

} // namespace giga

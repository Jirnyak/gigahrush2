#include "sim/rigid.h"

#include <algorithm>
#include <cmath>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "sim/drag.h"
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
};

SphereContact sphere_deepest_contact(const World& world, vec3 pos, float r) {
    SphereContact best;

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
            }
        }
    }
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
    for (auto e : view) {
        auto& rb = view.get<RigidBody>(e);
        auto& tr = view.get<Transform>(e);
        auto& vel = view.get<Velocity>(e);
        if (!stack.valid(tr.layer)) continue;
        World& w = stack.layer(tr.layer);

        if (rb.asleep) {
            // Спит = интегратор пропускает целиком. Будит только внешняя
            // запись Velocity (взрыв, толчок, пинок) — естественный интерфейс:
            // писатели импульсов уже пишут именно её.
            if (dot(vel.v, vel.v) < kWakeV2) continue;
            rb.asleep = false;
            rb.sleepTicks = 0;
        }

        bool touched = false;
        float maxApproach = 0.0f;

        for (int s = 0; s < steps; ++s) {
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
                touched = true;
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
                maxApproach = std::max(maxApproach, -vn);

                // Обобщённый нормальный импульс (sequential impulses):
                // k_n = 1/m + |r_c×n|²/I — угловая податливость контакта.
                const vec3 rxn = cross(rc, c.n);
                const float kn =
                    rb.invMass + rb.invInertia * dot(rxn, rxn);
                const float e_ =
                    (-vn > kBounceMinV) ? rb.restitution : 0.0f;
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
                    const float jtMax = rb.friction * jn;
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

        // Импакт-шов — тот же закон, что у свепт-AABB (E = m·v²/2 считает
        // потребитель): скорость сближения выше 4 м/с (пол свободной зоны
        // прыжка) публикуется как Impact.
        if (maxApproach > 4.0f) {
            Impact& im = reg.get_or_emplace<Impact>(e);
            if (maxApproach > im.speed) im.speed = maxApproach;
        }

        // Сон: тихая линейка И тихое вращение (|w|·r в тех же единицах м/с),
        // и обязательно контакт — свободно падающее тело не засыпает.
        const float wr2 = dot(rb.w, rb.w) * rb.radius * rb.radius;
        const bool quiet =
            dot(vel.v, vel.v) < kSleepV2 && wr2 < kSleepV2;
        if (quiet && touched) {
            if (++rb.sleepTicks >= kSleepAfter) {
                rb.asleep = true;
                vel.v = vec3{0.0f, 0.0f, 0.0f};
                rb.w = vec3{0.0f, 0.0f, 0.0f};
            }
        } else {
            rb.sleepTicks = 0;
        }
    }
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

} // namespace giga

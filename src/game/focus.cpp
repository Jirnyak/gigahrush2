#include "game/focus.h"

#include "ecs/components.h"    // Transform
#include "game/prop_system.h"  // Interactable
#include "world/los.h"         // sub_march — единственный субвоксельный луч
#include "world/world.h"

namespace giga::game {

namespace {

// Полураствор конуса прицеливания: цель засчитана, если её центр лежит не
// дальше kAimSlackM метров от оси взгляда. Выведено, а не назначено:
// самая мелкая цель — кнопка лифта 0.18×0.26 м (data/props.csv), и по
// центру такой в упор попасть нельзя без «липкости» примерно её половины;
// 0.35 м = радиус, при котором прицел прощает промах в полкнопки и всё ещё
// не хватает соседнюю дверь (проёмы разнесены на клетку, 2 м).
constexpr float kAimSlackM = 0.35f;

// Досягаемость дверного портала. Двери нет строки в interactables.csv (она
// материя мира, а не сущность), поэтому её reach живёт здесь — рядом с
// единственным потребителем.
constexpr float kDoorReachM = 2.6f;

struct Cand {
    float along = 0.0f; // расстояние вдоль луча
    float off = 0.0f;   // отклонение от оси
};

// Проекция точки на луч: (along, off). along < 0 — цель позади.
Cand project(const vec3& eye, const vec3& dir, const vec3& p) {
    // ПОРЯДОК АРГУМЕНТОВ: wrap_delta_f(a, b) = b - a ([core/wrap.h]), то
    // есть «от eye к p» — это (eye, p), а не (p, eye). Инверсия знака здесь
    // считала ВСЕ цели стоящими позади игрока: третья причина немого
    // прицела (первые две — своя формула взгляда и марш из материи).
    const float dx = wrap_delta_f(eye.x, p.x, kWorldExtent);
    const float dy = wrap_delta_f(eye.y, p.y, kWorldExtent);
    const float dz = wrap_delta_f(eye.z, p.z, kWorldExtent);
    Cand c;
    c.along = dx * dir.x + dy * dir.y + dz * dir.z;
    const float ox = dx - dir.x * c.along;
    const float oy = dy - dir.y * c.along;
    const float oz = dz - dir.z * c.along;
    c.off = std::sqrt(ox * ox + oy * oy + oz * oz);
    return c;
}

// Стена между глазом и целью? Марш — субвоксельный (единственный в дереве);
// касание ЗА целью не считается заслоном.
bool blocked(const World& w, const vec3& eye, const vec3& dir,
             const vec3& target, float along) {
    if (along <= 0.05f) return false;
    // Старт СМЕЩЁН вперёд на четверть метра: у sub_march «стартовый
    // субвоксель участвует» (пуля, рождённая в материи, ею и стоит), а глаз
    // стоит в клетке, где почти всегда есть материя — марш возвращал
    // касание t=0 и заслонял ВСЁ. Это и была вторая половина дефекта «двери
    // не реагируют, таблички нет».
    const vec3 from{eye.x + dir.x * 0.25f, eye.y + dir.y * 0.25f,
                    eye.z + dir.z * 0.25f};
    SubRayHit hit;
    if (!sub_march(w.grid(), from, target, hit)) return false;
    // Заслон засчитан, только если он ближе цели на полклетки — иначе марш
    // ловит саму цель (полотно двери, корпус пропа).
    const float seg = along - 0.25f;
    return hit.t * seg < seg - kCellSize * 0.5f;
}

} // namespace

Focus focus_pick(const Registry& reg, const World& w, LayerId layer,
                 const vec3& eye, const vec3& dir, const Doors& doors) {
    Focus best;
    float bestAlong = 1e9f;

    auto consider = [&](float along, float off, float reach) {
        if (along <= 0.0f || along > reach) return false; // позади или далеко
        if (off > kAimSlackM) return false;               // мимо прицела
        return along < bestAlong;
    };

    // 1. Сущности с Interactable — вид и досягаемость из таблицы.
    auto view = reg.view<const Interactable, const Transform>();
    for (auto e : view) {
        const Interactable& it = view.get<const Interactable>(e);
        if (!it.active) continue;
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const Cand c = project(eye, dir, tr.pos);
        if (!consider(c.along, c.off, it.reachM)) continue;
        if (blocked(w, eye, dir, tr.pos, c.along)) continue;
        bestAlong = c.along;
        best.what = Focus::What::Entity;
        best.entity = e;
        best.portal = kNoPortal;
        best.kind = it.kind;
        best.pos = tr.pos;
        best.dist = c.along;
    }

    // 2. Дверные порталы — механизм-створки пропускаются (ими владеет
    // машина, актор их не трогает: [game/door.h]).
    for (std::uint32_t i = 0; i < doors.list.size(); ++i) {
        const DoorPortal& p = doors.list[i];
        if (p.mechanism) continue;
        const vec3 pp{(static_cast<float>(p.cx) + 0.5f) * kCellSize,
                      (static_cast<float>(p.cy) + 0.5f) * kCellSize,
                      (static_cast<float>(p.cz) +
                       static_cast<float>(p.h) * 0.5f) * kCellSize};
        const Cand c = project(eye, dir, pp);
        if (!consider(c.along, c.off, kDoorReachM)) continue;
        if (blocked(w, eye, dir, pp, c.along)) continue;
        bestAlong = c.along;
        best.what = Focus::What::Portal;
        best.entity = entt::null;
        best.portal = i;
        best.pos = pp;
        best.dist = c.along;
    }

    return best;
}

const char* focus_prompt(const Focus& f, const World& w, const Doors& doors) {
    switch (f.what) {
    case Focus::What::Entity:
        return interact_def(f.kind).prompt; // текст — из таблицы, не литерал
    case Focus::What::Portal:
        if (f.portal >= doors.list.size()) return nullptr;
        return door_closed(w, doors.list[f.portal]) ? "OPEN DOOR"
                                                    : "CLOSE DOOR";
    default:
        return nullptr;
    }
}

} // namespace giga::game

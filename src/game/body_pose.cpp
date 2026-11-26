#include "game/body_pose.h"

#include <cmath>

#include "ecs/components.h"
#include "game/combat.h"  // Corpse — мёртвым позу не пишут
#include "game/look.h"    // Look — перёд тела

namespace giga::game {

namespace {

vec3 axis_unit(int axis, float sign) {
    vec3 v{0.0f, 0.0f, 0.0f};
    if (axis == 0) v.x = sign;
    else if (axis == 1) v.y = sign;
    else v.z = sign;
    return v;
}

float axis_of(vec3 v, int axis) {
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}

} // namespace

BodyFrame body_frame(const GravityFrame& g, vec3 look) {
    BodyFrame f;
    f.up = axis_unit(g.axis, static_cast<float>(g.upSign));
    // Проекция взгляда на плоскость ходьбы: вертикальная доля взгляда (игрок
    // смотрит под ноги) не наклоняет тело.
    const vec3 flat = look - f.up * dot(look, f.up);
    const float len = length(flat);
    f.fwd = len > 1e-3f ? flat * (1.0f / len) : axis_unit(g.tanA, 1.0f);
    f.left = cross(f.up, f.fwd);
    return f;
}

quat body_frame_quat(const BodyFrame& f) {
    return quat_from_basis(f.fwd, f.left, f.up);
}

BodyScale body_scale(const GravityFrame& g, vec3 bodyHalf) {
    BodyScale s;
    s.H = 2.0f * axis_of(bodyHalf, g.axis);
    s.W = 2.0f * std::fmax(axis_of(bodyHalf, g.tanA),
                           axis_of(bodyHalf, g.tanB));
    return s;
}

std::uint16_t form_rest_pose(FormId form, BodyScale s, const BodyFrame& f,
                             vec3 rootPos, PartPose* out) {
    const FormDef& def = form_def(form);
    const quat q = body_frame_quat(f);
    for (std::uint16_t i = 0; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        PartPose& p = out[i];
        p.pos = rootPos + f.fwd * (sd.ox * s.W) + f.left * (sd.oy * s.W) +
                f.up * (sd.oz * s.H);
        p.q = q;
        if (sd.prim == FormPrim::Sphere) {
            const float r = sd.sx * s.H;
            p.half = vec3{r, r, r};
        } else {
            p.half = vec3{sd.sx * s.W, sd.sy * s.W, sd.sz * s.H};
        }
    }
    return def.count;
}

// Ёмкость компонента ядра обязана покрывать самую длинную форму таблицы: ядро
// таблицу не видит, поэтому договор держится здесь, где видны оба числа.
static_assert(kMaxFormSegs <= kMaxBodyParts,
              "форма длиннее ёмкости BodyParts — подними kMaxBodyParts в "
              "ecs/components.h (и вывод капа BodyPass)");

PartJoint form_part_joint(FormId form, BodyScale s, std::uint16_t seg) {
    const FormDef& def = form_def(form);
    PartJoint out;
    if (seg >= def.count) return out;
    const FormSegDef& sd = kFormSegs[def.first + seg];
    if (sd.parent == kFormNoParent) return out;
    const FormSegDef& pd = kFormSegs[def.first + sd.parent];
    // Доли — от центра корня в осях кадра; ось части в покое и есть ось
    // кадра, поэтому разность долей, переведённая в метры, уже лежит в осях
    // части (и родителя) — без поворота туда и обратно через мир.
    out.inPart = vec3{(sd.jx - sd.ox) * s.W, (sd.jy - sd.oy) * s.W,
                      (sd.jz - sd.oz) * s.H};
    out.inParent = vec3{(sd.jx - pd.ox) * s.W, (sd.jy - pd.oy) * s.W,
                        (sd.jz - pd.oz) * s.H};
    return out;
}

BodyPoseTick body_parts_step(Registry& reg, const LevelStack& stack,
                             LayerId layer) {
    BodyPoseTick out;
    if (!stack.valid(layer)) return out;
    // Кадр гравитации — свойство слоя, один на проход (тот же, что у ходьбы
    // и у сборки трупа).
    const GravityFrame gf = steer_frame_of(&stack.layer(layer).gravity());
    // Хранилище позы существует ДО открытия вида: первое тело рождает
    // `BodyParts` внутри обхода (тот же довод, что у `look_step`).
    (void)reg.storage<BodyParts>();
    auto view = reg.view<const BodyPlan, const Transform, const AABB>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (reg.any_of<Corpse, CameraTag>(e)) continue;
        const Look* lk = reg.try_get<const Look>(e);
        PartPose pose[kMaxFormSegs];
        const FormId form = view.get<const BodyPlan>(e).form;
        const std::uint16_t n = form_rest_pose(
            form, body_scale(gf, view.get<const AABB>(e).half),
            body_frame(gf, lk ? lk->dir : vec3{0.0f, 0.0f, 0.0f}), tr.pos,
            pose);
        BodyParts& bp = reg.get_or_emplace<BodyParts>(e);
        const FormDef& def = form_def(form);
        bp.count = static_cast<std::uint8_t>(n);
        for (std::uint16_t i = 0; i < n; ++i) {
            BodyPart& p = bp.part[i];
            p.pos = pose[i].pos;
            p.q = pose[i].q;
            p.half = pose[i].half;
            p.sphere = kFormSegs[def.first + i].prim == FormPrim::Sphere;
        }
        ++out.posed;
        out.parts += n;
    }
    return out;
}

} // namespace giga::game

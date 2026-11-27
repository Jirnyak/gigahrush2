#include "game/body_pose.h"

#include <cmath>

#include "ecs/components.h"
#include "game/combat.h"       // Corpse — мёртвым позу не пишут
#include "game/encumbrance.h"  // kStepStrideOfHeight — длина шага от роста
#include "game/guide.h"        // kWalkSpeedMps, steer_tangent — плоскость ходьбы
#include "game/look.h"         // Look — перёд тела

namespace giga::game {

namespace {

inline constexpr float kPosePi = 3.14159265f;
inline constexpr float kPoseTwoPi = 6.28318530f;

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

// Таблица поз по словарю глаголов (kVerbCount == 20, порядок из data/verbs.csv).
// Единый источник для деяний нужды (`actions.csv` -> `kActionVerb`) и прямых
// глагольных поз (`work`, `craft`, `heal`, `strike`).
inline constexpr ActionPoseDef kVerbPoses[kVerbCount] = {
    /* sleep  */ {0.42f, 0.28f, -0.55f, 0.15f, 0.12f, 0.04f, 2.0f, PoseMotion::Cycle, 1},
    /* eat    */ {0.16f, 0.18f, -1.60f, 0.32f, 0.00f, 0.22f, 2.0f, PoseMotion::Cycle, 1},
    /* drink  */ {0.08f, -0.18f, -1.75f, 0.35f, 0.00f, 0.18f, 2.0f, PoseMotion::Cycle, 1},
    /* toilet */ {0.52f, 0.25f, -0.45f, 0.20f, -0.35f, 0.05f, 2.0f, PoseMotion::Cycle, 1},
    /* work   */ {0.22f, 0.20f, -1.15f, 0.22f, 0.00f, 0.24f, 2.5f, PoseMotion::Cycle, 1},
    /* heal   */ {0.38f, 0.30f, -1.35f, 0.38f, 0.00f, 0.20f, 2.5f, PoseMotion::Cycle, 1},
    /* trade  */ {0.08f, 0.05f, -0.85f, 0.25f, 0.00f, 0.12f, 2.0f, PoseMotion::Cycle, 1},
    /* store  */ {0.22f, 0.15f, -0.95f, 0.25f, 0.00f, 0.15f, 2.0f, PoseMotion::Cycle, 1},
    /* social */ {0.04f, -0.05f, -0.65f, 0.18f, 0.00f, 0.18f, 2.0f, PoseMotion::Cycle, 1},
    /* shelter*/ {0.45f, 0.25f, -0.90f, 0.30f, -0.25f, 0.00f, 0.0f, PoseMotion::Hold, 1},
    /* patrol */ {0.00f, 0.00f, -0.25f, 0.00f, 0.00f, 0.00f, 0.0f, PoseMotion::Hold, 1},
    /* wander */ {0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.0f, PoseMotion::Hold, 1},
    /* nest   */ {0.30f, 0.20f, -0.45f, 0.15f, -0.20f, 0.00f, 0.0f, PoseMotion::Hold, 1},
    /* hunt   */ {0.28f, -0.10f, -0.85f, 0.10f, 0.00f, 0.15f, 2.5f, PoseMotion::Cycle, 1},
    /* haul   */ {0.20f, 0.10f, -1.05f, 0.28f, 0.00f, 0.06f, 2.0f, PoseMotion::Cycle, 1},
    /* profit */ {0.15f, 0.15f, -0.95f, 0.25f, 0.00f, 0.15f, 2.0f, PoseMotion::Cycle, 1},
    /* strike */ {0.22f, 0.08f, -1.45f, 0.12f, 0.00f, 0.00f, 0.0f, PoseMotion::Strike, 0},
    /* kill   */ {0.25f, 0.10f, -1.50f, 0.15f, 0.00f, 0.00f, 0.0f, PoseMotion::Strike, 0},
    /* rob    */ {0.30f, 0.20f, -1.10f, 0.30f, 0.00f, 0.20f, 2.5f, PoseMotion::Cycle, 1},
    /* craft  */ {0.25f, 0.24f, -1.25f, 0.32f, 0.00f, 0.22f, 2.5f, PoseMotion::Cycle, 1},
};

// Боевые действия без глагола нужды (`kActionVerb[id] >= kVerbCount`).
inline constexpr ActionPoseDef kCombatActionPoses[kActionCount] = {
    /* shoot  */ {0.08f, 0.05f, -1.55f, 0.12f, 0.00f, 0.00f, 0.0f, PoseMotion::Hold, 0},
    /* reload */ {0.15f, 0.22f, -1.20f, 0.35f, 0.00f, 0.22f, 2.0f, PoseMotion::Cycle, 0},
    /* hurl   */ {0.18f, 0.05f, -1.45f, 0.10f, 0.00f, 0.00f, 0.0f, PoseMotion::Strike, 0},
    /* swing  */ {0.22f, 0.08f, -1.45f, 0.12f, 0.00f, 0.00f, 0.0f, PoseMotion::Strike, 0},
    /* maul   */ {0.24f, 0.08f, -1.45f, 0.16f, 0.00f, 0.00f, 0.0f, PoseMotion::Strike, 1},
    /* shot   */ {0.10f, 0.05f, -1.50f, 0.20f, 0.00f, 0.00f, 0.0f, PoseMotion::Hold, 1},
    /* rest   */ {},
    /* meal   */ {},
    /* sip    */ {},
    /* relief */ {},
};

inline constexpr ActionPoseDef kEmptyPose{};

struct PoseAngles {
    float torsoPitch = 0.0f;
    float headPitch = 0.0f;
    float armPitchL = 0.0f;
    float armYawL = 0.0f;
    float armPitchR = 0.0f;
    float armYawR = 0.0f;
    float legPitch = 0.0f;
};

struct DefSample {
    float torso = 0.0f;
    float head = 0.0f;
    float arm = 0.0f;
    float inward = 0.0f;
    float leg = 0.0f;
};

DefSample eval_def_at(const ActionPoseDef& def, std::uint16_t phaseE3) {
    DefSample s;
    const std::uint16_t clamped = phaseE3 > 1000u ? 1000u : phaseE3;
    const float u = static_cast<float>(clamped) * 0.001f;
    // Плавный вход/выход на краях окна [0..0.15] и [0.85..1.0]: поза в
    // начале и в конце окна сходится к покою/походке без скачка.
    const float edge = std::fmin(u, 1.0f - u);
    const float ramp = smoothstep01(0.0f, 0.15f, edge);

    switch (def.motion) {
        case PoseMotion::Hold: {
            s.torso = def.torsoPitch * ramp;
            s.head = def.headPitch * ramp;
            s.arm = def.armPitch * ramp;
            s.inward = def.armInward * ramp;
            s.leg = def.legPitch * ramp;
            break;
        }
        case PoseMotion::Cycle: {
            const float osc =
                std::sin(kPoseTwoPi * def.cycleFreq * u) * ramp;
            s.torso = def.torsoPitch * ramp + 0.20f * def.cycleAmp * osc;
            s.head = def.headPitch * ramp;
            s.arm = def.armPitch * ramp + def.cycleAmp * osc;
            s.inward = def.armInward * ramp;
            s.leg = def.legPitch * ramp;
            break;
        }
        case PoseMotion::Strike: {
            // Замах назад на первой четверти окна, бросок/удар вперёд в середине
            // и возврат к покою в конце.
            const float wave = (0.65f * std::sin(kPosePi * u) -
                                0.30f * std::sin(kPoseTwoPi * u)) *
                               ramp;
            s.torso = def.torsoPitch * wave;
            s.head = def.headPitch * wave;
            s.arm = def.armPitch * wave;
            s.inward = def.armInward * ramp;
            s.leg = def.legPitch * wave;
            break;
        }
    }
    return s;
}

PoseAngles eval_acting_angles(const ActingPoseState& act) {
    PoseAngles out;
    if (act.body.active) {
        const ActionPoseDef& def = action_pose_def(act.body.action);
        const DefSample s = eval_def_at(def, act.body.phaseE3);
        out.torsoPitch = s.torso;
        out.headPitch = s.head;
        out.legPitch = s.leg;
        if (def.bothArms != 0) {
            out.armPitchL = s.arm;
            out.armYawL = -s.inward;
            out.armPitchR = s.arm;
            out.armYawR = s.inward;
        } else {
            out.armPitchR = s.arm;
            out.armYawR = s.inward;
            out.armPitchL = -0.25f * s.arm;
        }
    }
    if (act.handL.active) {
        const ActionPoseDef& def = action_pose_def(act.handL.action);
        const DefSample s = eval_def_at(def, act.handL.phaseE3);
        out.armPitchL = s.arm;
        out.armYawL = -s.inward;
        if (!act.body.active) {
            out.torsoPitch += 0.5f * s.torso;
            out.headPitch += 0.5f * s.head;
        }
    }
    if (act.handR.active) {
        const ActionPoseDef& def = action_pose_def(act.handR.action);
        const DefSample s = eval_def_at(def, act.handR.phaseE3);
        out.armPitchR = s.arm;
        out.armYawR = s.inward;
        if (!act.body.active) {
            out.torsoPitch += 0.5f * s.torso;
            out.headPitch += 0.5f * s.head;
        }
    }
    return out;
}

std::uint16_t build_form_pose(FormId form, BodyScale s, const BodyFrame& f,
                              vec3 rootPos, const GaitState& g,
                              const PoseAngles& pa, bool hasArmL, bool hasArmR,
                              PartPose* out) {
    const FormDef& def = form_def(form);
    const quat qBody = body_frame_quat(f);
    const float amp = std::isfinite(g.amp) ? g.amp : 0.0f;
    const float phase = std::isfinite(g.phase) ? g.phase : 0.0f;
    const float swing =
        amp * gait_swing_max(form) * std::sin(kPoseTwoPi * phase);
    const float standBlend = std::fmax(0.0f, 1.0f - clamp01(amp));

    for (std::uint16_t i = 0; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        PartPose& p = out[i];
        if (sd.prim == FormPrim::Sphere) {
            const float r = sd.sx * s.H;
            p.half = vec3{r, r, r};
        } else {
            p.half = vec3{sd.sx * s.W, sd.sy * s.W, sd.sz * s.H};
        }
        if (sd.parent == kFormNoParent) {
            p.q = qBody;
            p.pos = rootPos + f.fwd * (sd.ox * s.W) + f.left * (sd.oy * s.W) +
                    f.up * (sd.oz * s.H);
            continue;
        }
        // Сторона — знак сустава поперёк: левая сторона кадра имеет jy > 0.
        const float side = sd.jy > 0.0f ? 1.0f : (sd.jy < 0.0f ? -1.0f : 0.0f);
        float pitch = 0.0f;
        float yaw = 0.0f;
        switch (sd.partRole) {
            case FormRole::Torso:
                pitch = pa.torsoPitch;
                break;
            case FormRole::Head:
                pitch = pa.headPitch;
                break;
            case FormRole::Leg:
                pitch = side * swing + pa.legPitch * standBlend;
                break;
            case FormRole::Arm:
                if (side > 0.0f) {
                    if (hasArmL) {
                        pitch = pa.armPitchL;
                        yaw = pa.armYawL;
                    } else {
                        pitch = -side * swing;
                    }
                } else if (side < 0.0f) {
                    if (hasArmR) {
                        pitch = pa.armPitchR;
                        yaw = pa.armYawR;
                    } else {
                        pitch = -side * swing;
                    }
                } else {
                    pitch = pa.armPitchR;
                    yaw = pa.armYawR;
                }
                break;
            case FormRole::Root:
            case FormRole::Chain:
            case FormRole::Count:
                break;
        }
        // Поворот вокруг оси «лево» (y части) и при необходимости сведение рук
        // вокруг оси «верх» (z части). При yaw == 0 совпадает с походкой.
        quat local{0.0f, std::sin(0.5f * pitch), 0.0f, std::cos(0.5f * pitch)};
        if (yaw != 0.0f) {
            const quat qYaw{0.0f, 0.0f, std::sin(0.5f * yaw),
                            std::cos(0.5f * yaw)};
            local = quat_mul(qYaw, local);
        }
        const PartPose& par = out[sd.parent];
        const PartJoint pj = form_part_joint(form, s, i);
        p.q = quat_normalize(quat_mul(par.q, local));
        const vec3 joint = par.pos + quat_rotate(par.q, pj.inParent);
        p.pos = joint - quat_rotate(p.q, pj.inPart);
    }
    return def.count;
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

float gait_swing_max(FormId form) {
    const FormDef& def = form_def(form);
    for (std::uint16_t i = 0; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        if (sd.partRole != FormRole::Leg) continue;
        // Длина ноги — от сустава до подошвы: полный габарит части вдоль
        // роста (сустав стоит на её верхней грани — закон силуэта таблицы).
        const float leg = 2.0f * sd.sz;
        const float half = 0.5f * kStepStrideOfHeight;
        if (leg <= half) return 0.0f;
        return std::asin(half / leg);
    }
    return 0.0f;
}

const ActionPoseDef& verb_pose_def(VerbId v) {
    return v < kVerbCount ? kVerbPoses[v] : kEmptyPose;
}

const ActionPoseDef& action_pose_def(ActionId id) {
    if (id >= kActionCount) return kEmptyPose;
    const VerbId v = kActionVerb[id];
    if (v < kVerbCount) return kVerbPoses[v];
    return kCombatActionPoses[id];
}

std::uint16_t form_action_pose(FormId form, BodyScale s, const BodyFrame& f,
                               vec3 rootPos, const GaitState& g,
                               const ActingPoseState& act, PartPose* out) {
    const PoseAngles pa = eval_acting_angles(act);
    const bool hasArmL = act.handL.active || act.body.active;
    const bool hasArmR = act.handR.active || act.body.active;
    return build_form_pose(form, s, f, rootPos, g, pa, hasArmL, hasArmR, out);
}

std::uint16_t form_verb_pose(FormId form, BodyScale s, const BodyFrame& f,
                             vec3 rootPos, const GaitState& g, VerbId verb,
                             std::uint16_t phaseE3, PartPose* out) {
    const ActionPoseDef& def = verb_pose_def(verb);
    const DefSample ds = eval_def_at(def, phaseE3);
    PoseAngles pa;
    pa.torsoPitch = ds.torso;
    pa.headPitch = ds.head;
    pa.legPitch = ds.leg;
    if (def.bothArms != 0) {
        pa.armPitchL = ds.arm;
        pa.armYawL = -ds.inward;
        pa.armPitchR = ds.arm;
        pa.armYawR = ds.inward;
    } else {
        pa.armPitchR = ds.arm;
        pa.armYawR = ds.inward;
        pa.armPitchL = -0.25f * ds.arm;
    }
    const bool active = verb < kVerbCount;
    return build_form_pose(form, s, f, rootPos, g, pa, active, active, out);
}

std::uint16_t form_gait_pose(FormId form, BodyScale s, const BodyFrame& f,
                             vec3 rootPos, const GaitState& g, PartPose* out) {
    return form_action_pose(form, s, f, rootPos, g, ActingPoseState{}, out);
}

std::uint32_t gait_step(Registry& reg, const LevelStack& stack, LayerId layer,
                        float dt) {
    std::uint32_t walked = 0;
    if (!stack.valid(layer) || dt <= 0.0f) return walked;
    const GravityFrame gf = steer_frame_of(&stack.layer(layer).gravity());
    (void)reg.storage<Gait>();
    auto view = reg.view<const BodyPlan, const Transform, const Velocity,
                         const GravityAffected>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        if (!view.get<const GravityAffected>(e).grounded) continue;
        if (reg.all_of<Corpse>(e)) continue;
        const vec3& v = view.get<const Velocity>(e).v;
        const vec3 t = steer_tangent(gf, v.x, v.y, v.z);
        const float speed = length(t);
        if (speed <= 0.0f) continue;
        reg.get_or_emplace<Gait>(e).metres += speed * dt;
        ++walked;
    }
    return walked;
}

BodyPoseTick body_parts_step(Registry& reg, const LevelStack& stack,
                             LayerId layer, std::uint64_t tick) {
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
        const BodyScale scale = body_scale(gf, view.get<const AABB>(e).half);
        // ФАЗА — из одометра, РАЗМАХ — из скорости тела на опоре (доля пешей,
        // насыщение на единице): стоящее и летящее тело — ровно поза покоя.
        GaitState gs;
        if (const Gait* gt = reg.try_get<const Gait>(e)) {
            const float stride = kStepStrideOfHeight * scale.H;
            if (stride > 0.0f) {
                const float cycles = gt->metres / (2.0f * stride);
                gs.phase = cycles - std::floor(cycles);
            }
        }
        const GravityAffected* ga = reg.try_get<const GravityAffected>(e);
        const Velocity* vel = reg.try_get<const Velocity>(e);
        if (ga && ga->grounded && vel) {
            const float sp =
                length(steer_tangent(gf, vel->v.x, vel->v.y, vel->v.z));
            gs.amp = sp >= kWalkSpeedMps ? 1.0f : sp / kWalkSpeedMps;
        }
        ActingPoseState aps;
        if (const Acting* act = reg.try_get<const Acting>(e)) {
            auto read_slot = [&](ActSlot s) -> SlotPoseInput {
                SlotPoseInput in;
                const ActWindow& w = act_slot(*act, s);
                if (tick >= w.startTick && act_busy(w, tick) &&
                    w.action < kActionCount) {
                    in.active = true;
                    in.action = w.action;
                    in.phaseE3 = acting_phase_e3(*act, s, tick);
                }
                return in;
            };
            aps.handL = read_slot(ActSlot::HandL);
            aps.handR = read_slot(ActSlot::HandR);
            aps.body = read_slot(ActSlot::Body);
        }
        const std::uint16_t n = form_action_pose(
            form, scale, body_frame(gf, lk ? lk->dir : vec3{0.0f, 0.0f, 0.0f}),
            tr.pos, gs, aps, pose);
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

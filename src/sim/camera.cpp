#include "sim/camera.h"

#include <cmath>

#include "ecs/components.h"

namespace giga {

vec3 camera_forward(float yaw, float pitch) {
    float cp = std::cos(pitch), sp = std::sin(pitch);
    return normalize(vec3{std::cos(yaw) * cp, std::sin(yaw) * cp, sp});
}

namespace {

// ЗАКОН ТОЧКИ ВЗГЛЯДА — ОДНО ВЫРАЖЕНИЕ, И ТЕПЕРЬ ОНО ОДНО. До 2026-11-06
// `tr.pos + cam.eyeOffset` стояло в двух функциях этого файла; третьим
// потребителем стала система присутствия (центры пузыря), и копия номер три
// была бы ровно тем, за что в этом дереве казнят — «одно правило, найденное
// трижды» (matwej.md §24.4 п.4).
vec3 camera_eye_of(const Transform& tr, const CameraTag& cam) {
    return tr.pos + cam.eyeOffset;
}

// ОДИН закон матриц — для монокулярной камеры и для каждого глаза стерео.
// Ближняя/дальняя плоскости и переворот Y живут здесь и только здесь: три
// строки, скопированные во вторую функцию, расходятся ровно так, как расходятся
// скопированные числа (markoaudit-systems.md §1.8 — тот же случай).
CameraMatrices camera_matrices(vec3 eye, vec3 fwd, vec3 up, float fovY,
                               float aspect) {
    CameraMatrices out;
    out.eye = eye;
    out.forward = fwd;
    out.view = mat4_lookAt(eye, eye + fwd, up);

    // Far plane covers the toroidal minimal-image window (±kWorldExtent/2
    // per axis, diagonal ~0.87·kWorldExtent). Geometry past the fog radius
    // (kWorldExtent/2) is fogged to black, so this only bounds depth
    // precision, not what's visible.
    mat4 proj = mat4_perspective(fovY, aspect > 1e-3f ? aspect : 1.0f,
                                 0.05f, kWorldExtent);
    // Vulkan clip space has +Y pointing down; flip the projection's Y so
    // world +Z-up renders upright without a negative viewport.
    proj.m[5] = -proj.m[5];
    out.proj = proj;
    out.valid = true;
    return out;
}

// Правый вектор взгляда. Вырожденный случай — взгляд ВДОЛЬ «верха» (зенит или
// надир): там cross обнуляется и разводить глаза не по чему, поэтому ось
// берётся от наименее сонаправленной мировой оси. Изотропия обязывает: «верх»
// у нас не константа, а поле гравитации слоя ([isotropy-law]).
vec3 camera_right(vec3 fwd, vec3 up) {
    vec3 axis = cross(fwd, up);
    if (dot(axis, axis) < 1e-6f) {
        const float ax = std::fabs(fwd.x), ay = std::fabs(fwd.y), az = std::fabs(fwd.z);
        const vec3 alt = (ax <= ay && ax <= az) ? vec3{1, 0, 0}
                       : (ay <= az)             ? vec3{0, 1, 0}
                                                : vec3{0, 0, 1};
        axis = cross(fwd, alt);
    }
    return normalize(axis);
}

} // namespace

CameraMatrices compute_camera(Registry& reg, float aspect, vec3 up) {
    CameraMatrices out;
    auto view = reg.view<Transform, CameraTag>();
    for (auto e : view) {
        auto& tr = view.get<Transform>(e);
        auto& cam = view.get<CameraTag>(e);
        out = camera_matrices(camera_eye_of(tr, cam),
                              camera_forward(cam.yaw, cam.pitch), up, cam.fovY,
                              aspect);
        break; // first camera wins
    }
    return out;
}

std::uint32_t camera_eyes(const Registry& reg, vec3* out, std::uint32_t cap) {
    if (out == nullptr || cap == 0) return 0;
    std::uint32_t n = 0;
    auto view = reg.view<const Transform, const CameraTag>();
    for (auto e : view) {
        if (n >= cap) break; // кап — у потребителя, он же и считает отброшенных
        out[n++] = camera_eye_of(view.get<const Transform>(e),
                                 view.get<const CameraTag>(e));
    }
    return n;
}

StereoCameraMatrices compute_stereo_camera(Registry& reg, float eyeAspect,
                                           float ipd, vec3 up) {
    StereoCameraMatrices out;
    auto view = reg.view<Transform, CameraTag>();
    for (auto e : view) {
        auto& tr = view.get<Transform>(e);
        auto& cam = view.get<CameraTag>(e);

        const vec3 eye = camera_eye_of(tr, cam);
        const vec3 fwd = camera_forward(cam.yaw, cam.pitch);
        const vec3 right = camera_right(fwd, up);
        const vec3 half = right * (ipd * 0.5f);

        // Оба глаза смотрят ПО ОДНОЙ оси: направление общее, различается
        // только точка. Свод осей на дистанцию (toe-in) дал бы вертикальный
        // параллакс по краям — стереобазу разводят сдвигом.
        out.left = camera_matrices(eye - half, fwd, up, cam.fovY, eyeAspect);
        out.right = camera_matrices(eye + half, fwd, up, cam.fovY, eyeAspect);
        out.valid = true;
        break; // first camera wins — тот же выбор аватара, что у compute_camera
    }
    return out;
}

} // namespace giga

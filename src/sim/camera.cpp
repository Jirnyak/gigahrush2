#include "sim/camera.h"

#include <cmath>

#include "ecs/components.h"

namespace giga {

vec3 camera_forward(float yaw, float pitch) {
    float cp = std::cos(pitch), sp = std::sin(pitch);
    return normalize(vec3{std::cos(yaw) * cp, std::sin(yaw) * cp, sp});
}

CameraMatrices compute_camera(Registry& reg, float aspect, vec3 up) {
    CameraMatrices out;
    auto view = reg.view<Transform, CameraTag>();
    for (auto e : view) {
        auto& tr = view.get<Transform>(e);
        auto& cam = view.get<CameraTag>(e);

        vec3 eye = tr.pos + cam.eyeOffset;
        vec3 fwd = camera_forward(cam.yaw, cam.pitch);
        out.eye = eye;
        out.forward = fwd;
        out.view = mat4_lookAt(eye, eye + fwd, up);

        // Far plane covers the toroidal minimal-image window (±kWorldExtent/2
        // per axis, diagonal ~0.87·kWorldExtent). Geometry past the fog radius
        // (kWorldExtent/2) is fogged to black, so this only bounds depth
        // precision, not what's visible.
        mat4 proj = mat4_perspective(cam.fovY, aspect > 1e-3f ? aspect : 1.0f,
                                     0.05f, kWorldExtent);
        // Vulkan clip space has +Y pointing down; flip the projection's Y so
        // world +Z-up renders upright without a negative viewport.
        proj.m[5] = -proj.m[5];
        out.proj = proj;
        out.valid = true;
        break; // first camera wins
    }
    return out;
}

StereoCameraMatrices compute_stereo_camera(Registry& reg, float eyeAspect,
                                           float ipd, vec3 up) {
    StereoCameraMatrices out;
    auto view = reg.view<Transform, CameraTag>();
    for (auto e : view) {
        auto& tr = view.get<Transform>(e);
        auto& cam = view.get<CameraTag>(e);

        vec3 eye = tr.pos + cam.eyeOffset;
        vec3 fwd = camera_forward(cam.yaw, cam.pitch);

        vec3 axis = cross(fwd, up);
        if (dot(axis, axis) < 1e-6f) {
            const float ax = std::fabs(fwd.x), ay = std::fabs(fwd.y), az = std::fabs(fwd.z);
            const vec3 alt = (ax <= ay && ax <= az) ? vec3{1, 0, 0}
                           : (ay <= az)             ? vec3{0, 1, 0}
                                                    : vec3{0, 0, 1};
            axis = cross(fwd, alt);
        }
        vec3 right = normalize(axis);

        float halfIpd = ipd * 0.5f;
        vec3 leftEye = eye - right * halfIpd;
        vec3 rightEye = eye + right * halfIpd;

        out.left.eye = leftEye;
        out.left.forward = fwd;
        out.left.view = mat4_lookAt(leftEye, leftEye + fwd, up);

        out.right.eye = rightEye;
        out.right.forward = fwd;
        out.right.view = mat4_lookAt(rightEye, rightEye + fwd, up);

        mat4 proj = mat4_perspective(cam.fovY, eyeAspect > 1e-3f ? eyeAspect : 1.0f,
                                     0.05f, kWorldExtent);
        proj.m[5] = -proj.m[5];
        out.left.proj = proj;
        out.right.proj = proj;

        out.left.valid = true;
        out.right.valid = true;
        out.valid = true;
        break; // first camera wins
    }
    return out;
}

} // namespace giga

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

} // namespace giga

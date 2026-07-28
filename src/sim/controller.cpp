#include "sim/controller.h"

#include <cmath>

#include "core/math.h"
#include "ecs/components.h"
#include "sim/camera.h"

namespace giga {

void controller_step(Registry& reg, float dt) {
    auto view = reg.view<Transform, Velocity, Controller, CameraTag>();
    for (auto e : view) {
        auto& vel = view.get<Velocity>(e);
        auto& ctl = view.get<Controller>(e);
        auto& cam = view.get<CameraTag>(e);

        float cy = std::cos(cam.yaw), sy = std::sin(cam.yaw);
        vec3 right{sy, -cy, 0.0f};
        vec3 up{0, 0, 1};

        // Forward basis. In walk mode we keep it horizontal (yaw only) so
        // looking up/down never lifts you off the ground. In fly mode forward
        // follows the full look direction (yaw + pitch) so you move freely
        // through the isotropic 3D structure, including straight up a shaft.
        vec3 fwd = ctl.fly ? camera_forward(cam.yaw, cam.pitch)
                           : vec3{cy, sy, 0.0f};

        // wishDir components: x=forward, y=right, z=up (each in [-1,1]).
        vec3 wish = fwd * ctl.wishDir.x + right * ctl.wishDir.y;
        if (ctl.fly) wish += up * ctl.wishDir.z;

        float len = length(wish);
        if (len > 1e-4f) wish = wish * (1.0f / len);
        vec3 desired = wish * ctl.moveSpeed;

        if (ctl.fly) {
            // Direct control on all axes.
            vel.v = desired;
        } else {
            // Horizontal only; leave vertical velocity to gravity/jump.
            vel.v.x = desired.x;
            vel.v.y = desired.y;
        }
    }
}

} // namespace giga

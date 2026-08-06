#include "sim/controller.h"

#include <cmath>

#include "core/math.h"
#include "ecs/components.h"
#include "sim/camera.h"

namespace giga {

namespace {
// vec3 is a plain {x,y,z} POD, so an axis index needs a selector. Local because
// nothing else needs it; `physics.cpp` has a read-only `axis_of` twin.
inline float& comp(vec3& v, int i) { return i == 0 ? v.x : (i == 1 ? v.y : v.z); }
} // namespace

void controller_step(Registry& reg, float dt, const GravityField* gravity) {
    auto view = reg.view<Transform, Velocity, Controller, CameraTag>();
    for (auto e : view) {
        auto& tr = view.get<Transform>(e);
        auto& vel = view.get<Velocity>(e);
        auto& ctl = view.get<Controller>(e);
        auto& cam = view.get<CameraTag>(e);

        // The frame is taken QUANTISED, from regime_frame, not as
        // normalize(-gravity). Two reasons. It keeps the NegZ path bit-for-bit:
        // normalize({0, 0, 9.81}) is not guaranteed to give exactly 1.0f, and a
        // float epsilon here would leak into every walking frame. And it is what
        // "which axis is vertical" actually means — a choice among six, not a
        // direction to be measured. Custom resolves through regime_from_vector,
        // as gravity_frames does it; Zero falls back to the Z frame, matching
        // regime_frame's own default.
        int tanA = 0, tanB = 1;
        float upSign = 1.0f;
        vec3 up{0.0f, 0.0f, 1.0f};
        if (gravity) {
            GravityRegime r = gravity->regime;
            if (r == GravityRegime::Custom)
                r = regime_from_vector(gravity->at(tr.pos));
            const GravityFrame f = regime_frame(r);
            tanA = f.tanA;
            tanB = f.tanB;
            upSign = static_cast<float>(f.upSign);
            up = vec3{0.0f, 0.0f, 0.0f};
            comp(up, f.axis) = upSign;
        }

        float cy = std::cos(cam.yaw), sy = std::sin(cam.yaw);

        // Walk basis, built ON the two tangent axes. This is what makes the
        // degenerate case unreachable rather than merely guarded: `right` comes
        // from the yaw angle, never from cross(fwd, up), so it cannot collapse
        // when the look direction lines up with gravity — which in fly mode is
        // an ordinary thing to do, not an edge case. It also means the wish can
        // never leak a component along `up`: the basis spans the tangent plane
        // by construction, so no re-projection of the input is needed.
        //
        // The upSign on `right` preserves right == cross(fwd, up) in every
        // regime, so strafe stays consistent with the view instead of mirroring
        // when the pull inverts. Under NegZ (axis 2, upSign +1, tanA/tanB = X/Y)
        // this reproduces the old literals exactly: fwd {cy, sy, 0} and
        // right {sy, -cy, 0}.
        vec3 fwd{0.0f, 0.0f, 0.0f};
        comp(fwd, tanA) = cy;
        comp(fwd, tanB) = sy;
        vec3 right{0.0f, 0.0f, 0.0f};
        comp(right, tanA) = sy * upSign;
        comp(right, tanB) = -cy * upSign;

        // In fly mode forward follows the full look direction (yaw + pitch) so
        // you move freely through the isotropic 3D structure, including straight
        // up a shaft. In walk mode it stays in the tangent plane, so looking
        // up/down never lifts you off the ground.
        if (ctl.fly) fwd = camera_forward(cam.yaw, cam.pitch);

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
            // Replace the component perpendicular to gravity, preserve the one
            // along it — falling and jumping belong to physics_step, which runs
            // after this and only ever accumulates (+=) along the same axis.
            // `desired` already lies in the tangent plane, so this is a
            // substitution, not a projection. Under NegZ it reduces to the old
            // two-component write exactly: desired.z is a literal 0 and
            // dot(vel.v, up) is vel.v.z.
            vel.v = desired + up * dot(vel.v, up);
        }
    }
    (void)dt;
}

} // namespace giga

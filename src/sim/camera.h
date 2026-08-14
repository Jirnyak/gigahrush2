// Camera system: derives view + projection matrices from whichever entity
// currently holds a CameraTag.
//
// The camera is not a singleton object; it is read off the ECS each frame. Move
// the CameraTag to a different entity and the view follows. Returns the first
// camera entity found, or a sane identity fallback if none exists.
#pragma once

#include "core/math.h"
#include "ecs/registry.h"

namespace giga {

struct CameraMatrices {
    mat4 view = mat4_identity();
    mat4 proj = mat4_identity();
    vec3 eye{0, 0, 0};
    vec3 forward{1, 0, 0};
    bool valid = false;
};

// aspect = drawable width / height. up = world up vector (defaults to +Z).
CameraMatrices compute_camera(Registry& reg, float aspect,
                              vec3 up = vec3{0.0f, 0.0f, 1.0f});

// Forward direction from yaw/pitch, shared by camera + input so mouselook and
// movement agree on where "forward" points.
vec3 camera_forward(float yaw, float pitch);

} // namespace giga

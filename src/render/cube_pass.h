// The world renderer: draws visible macro cells as instanced cubes.
//
// This is the concrete "we can actually see the world" pass. Each frame it
// walks the macro grid, emits one cube instance per non-empty cell whose colour
// comes from its cell type (and, if present, its fluid field), and issues a
// single instanced draw. The cube mesh is static device-local geometry; the
// per-instance data is a persistently-mapped host-visible buffer refilled each
// frame (double-buffered so we never stomp a frame still in flight).
//
// Surface culling (skipping cells fully surrounded by solid neighbours) keeps
// the instance count proportional to visible surface area, not world volume.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_renderer.h"

namespace giga {
class World;
}

namespace giga::gpu {

struct VulkanDevice;

// Matches the per-instance vertex attributes in cube.vert.
struct CubeInstance {
    vec3 origin;
    float scale;
    vec3 color;
};

// Push-constant block shared by cube.vert / cube.frag.
struct CubePush {
    mat4 viewProj;
    // 112 bytes total, deliberately under the 128-byte push-constant floor the
    // Vulkan spec guarantees (real Windows drivers report exactly 128). The
    // lighting knobs therefore ride in the otherwise-dead w lanes rather than
    // growing the block — see cube.frag and the tunables in app/main.cpp.
    vec4 sunDir;    // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;    // xyz = camera world position (fog + toroidal placement,
                    //       and the headlamp origin), w = headlamp intensity
    vec4 fog;       // x = fog start dist, y = fog end dist (fades to black),
                    // z = headlamp radius (m), w = ambient scale
};

class CubePass {
public:
    bool init(VulkanDevice& dev, VkRenderPass renderPass,
              const char* shaderDir);
    void destroy();

    // Rebuild the visible-instance list from `world` into this frame's buffer,
    // then record the instanced draw into `cmd`. `frameIndex` selects the
    // double-buffered instance buffer. `push.camPos` drives both toroidal
    // placement (each cell emitted at its nearest image around the camera, so
    // the wrapping world reads as a seamless infinite lattice) and fog.
    void record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                const World& world, const CubePush& push);

    std::uint32_t last_instance_count() const { return lastInstanceCount_; }

private:
    VulkanDevice* dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    VulkanBuffer cubeVerts_;  // static per-vertex mesh (pos + normal)
    std::uint32_t vertexCount_ = 0;

    VulkanBuffer instances_[kMaxFramesInFlight]; // host-visible, per-frame
    std::uint32_t instanceCapacity_ = 0;
    std::uint32_t lastInstanceCount_ = 0;

    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_cube_mesh();
};

} // namespace giga::gpu

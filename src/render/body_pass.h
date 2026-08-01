// The body renderer: draws every embodied entity as one lit, instanced box.
//
// Companion to CubePass. Where the cube pass draws the static voxel world, this
// pass draws the *population*: each ECS entity carrying a Transform + AABB +
// Renderable becomes one box, centred on its Transform and sized to its AABB
// half-extents (so a child record embodies short, an adult tall), tinted by the
// Renderable colour the game assigned (e.g. by faction). One instanced draw for
// the whole visible crowd.
//
// Like every pass it renders AROUND the camera: each body is emitted at its
// nearest toroidal image and fogged to black at the wrap radius, so a body on
// the far side of the torus shows in front of the player, never at the seam.
// Render is a read-only skin (sim -> render only): this pass mutates no ECS
// state and reads only core components, never the game layer. It shares
// CubePass's push-constant block and reuses cube.frag for shading.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "render/cube_pass.h"  // CubePush (shared push-constant block)
#include "render/vk_buffer.h"
#include "render/vk_renderer.h"
#include "world/level_stack.h" // LayerId

namespace giga::gpu {

struct VulkanDevice;

// Matches the per-instance attributes in body.vert: a box centred on `center`
// spanning +/- `half` on each axis, tinted `color`.
struct BodyInstance {
    vec3 center;
    vec3 half;
    vec3 color;
};

class BodyPass {
public:
    bool init(VulkanDevice& dev, VkRenderPass renderPass, const char* shaderDir,
              VkDescriptorSetLayout lightGridSetLayout = VK_NULL_HANDLE);
    void destroy();

    // Rebuild the instance list from every drawable entity on `layer` into this
    // frame's buffer, then record the instanced draw. Entities holding a
    // CameraTag (the viewer's own body) are skipped so first-person stays clear;
    // StaticPropTag entities are PropPass-only (skipped here); bodies whose
    // centre is past the fog radius (push.fog.y) are culled.
    void record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                const Registry& reg, LayerId layer, const CubePush& push,
                VkDescriptorSet lightGridSet = VK_NULL_HANDLE);

    std::uint32_t last_instance_count() const { return lastInstanceCount_; }

private:
    VulkanDevice* dev_ = nullptr;
    VkDescriptorSetLayout lightGridSetLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    VulkanBuffer cubeVerts_;   // static per-vertex unit-cube mesh (pos + normal)
    std::uint32_t vertexCount_ = 0;

    VulkanBuffer instances_[kMaxFramesInFlight]; // host-visible, per-frame
    std::uint32_t instanceCapacity_ = 0;
    std::uint32_t lastInstanceCount_ = 0;

    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_cube_mesh();
};

} // namespace giga::gpu

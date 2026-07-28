// The world renderer: draws visible macro cells as instanced cubes.
//
// This is the concrete "we can actually see the world" pass. It walks the macro
// grid, emits one cube instance per visible-surface cell whose colour comes from
// its cell type (and, if present, its fluid field), and issues a single instanced
// draw. The cube mesh is static device-local geometry; the per-instance data is a
// persistently-mapped host-visible buffer (double-buffered so we never stomp a
// frame still in flight).
//
// The instance list is CACHED, not rebuilt per frame — the grid only changes when
// a floor is generated/streamed or fluid moves, so rebuilding it every frame was
// spending 28.6 ms of a 43.6 ms frame scanning 2,097,152 cells that had not
// changed. Callers must invalidate() when the world mutates.
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
    // Ambient-occlusion input: a 27-bit occupancy mask of this cell's own 3x3x3
    // neighbourhood, bit ((dz+1)*9 + (dy+1)*3 + (dx+1)) set when that neighbour is
    // solid. The centre bit (13) is this cell and is never read.
    //
    // One uint32 is the ENTIRE cost of baked AO on the GPU side, and that is only
    // true because of a property of the shared mesh worth stating: which three
    // neighbours occlude a given vertex is a pure function of (face normal, corner
    // sign), both of which the vertex shader already has from inNormal and inPos.
    // A shared 36-vertex mesh forbids per-instance *topology*, not per-instance
    // *values* — so nothing about the mesh changes and body_pass keeps its own.
    std::uint32_t occ;
};
static_assert(sizeof(CubeInstance) == 32, "AO must cost exactly one uint32");

// Push-constant block shared by cube.vert / cube.frag / body.vert. All three
// declare it identically; body_pass reuses cube.frag, so the block and the
// varying set are a contract across the two vertex stages.
//
// 128 bytes — EXACTLY the maxPushConstantsSize the Vulkan spec guarantees, which
// is what real Windows drivers report. There is no headroom left: the next thing
// that needs to reach the shaders must go in a uniform buffer, not here. The
// lighting knobs deliberately ride in otherwise-dead w lanes for the same reason.
struct CubePush {
    mat4 viewProj;
    vec4 sunDir;    // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;    // xyz = camera world position (toroidal placement, fog,
                    //       and the headlamp origin), w = headlamp intensity
    vec4 fog;       // x = fog start dist, y = fog end dist (fades to black),
                    // z = headlamp radius (m), w = ambient scale
    vec4 torus;     // x = wrap period (kWorldExtent), y = AO strength 0..1,
                    // z,w free
};
static_assert(sizeof(CubePush) == 128,
              "CubePush must not exceed the 128-byte guaranteed push-constant "
              "size; move new parameters to a uniform buffer instead");

class CubePass {
public:
    bool init(VulkanDevice& dev, VkRenderPass renderPass,
              const char* shaderDir);
    void destroy();

    // Record the instanced draw into `cmd`. The instance list is CACHED: it is
    // rebuilt from `world` only when this pass is dirty (a different World, or an
    // explicit invalidate()), not every frame. Rebuilding it per frame cost
    // 28.6 ms of a 43.6 ms frame — a full 128^3 = 2,097,152-cell scan plus ~20 MB
    // of writes, on the main thread.
    //
    // Instance origins are ABSOLUTE grid positions; the nearest-toroidal-image
    // shift happens per-vertex in cube.vert from push.camPos. That is what makes
    // the cache possible at all — it removes the camera from the instance data.
    void record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                const World& world, const CubePush& push);

    // Mark the cached instance list stale. Call after anything that changes what
    // the pass would emit: floor (re)generation or streaming, a fluid step, or
    // any direct grid mutation. A World whose *contents* change in place cannot
    // be detected here — floor streaming recycles the same World object — so this
    // is not optional bookkeeping.
    void invalidate();

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

    // Cache state. Dirtiness is per-frame-slot: a rebuild refills each of the
    // frames-in-flight buffers the next time that slot comes round, so we never
    // write a buffer the GPU may still be reading.
    bool dirty_[kMaxFramesInFlight] = {};
    const World* cachedWorld_ = nullptr;

    // Fill one instance buffer from `world`. Returns the instance count.
    std::uint32_t build_instances(std::uint32_t frameIndex, const World& world);

    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_cube_mesh();
};

} // namespace giga::gpu

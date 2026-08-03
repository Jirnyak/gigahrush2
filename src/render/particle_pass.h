// particle_pass.h — the UNIFIED GPU PARTICLE POOL (owner's design, 2026-08-03):
// mob blood, concrete dust, bullet sparks and pipe drips are ONE pool, one
// compute sim, one billboard draw — a particle differs from another by the row
// of data/particles.csv that stamped it, never by code.
//
// The one-way law, same as wires ([wire_pass.h]): the sim lives ENTIRELY on
// the GPU (particle_sim.comp) and collides against the voxel MIRROR
// ([voxel_mirror.h] masks SSBO — the render-side copy of the grid truth), so
// the CPU tick pays exactly one thing: the spawn ring. Writers propose bursts
// in game/ ([game/particles.h]); the app packs them into GpuParticle records
// (resolving material tints — render never includes game/) and drops them
// into the pool at a wrapping cursor, overwriting the oldest. No free lists,
// no compaction: a dead particle (life <= 0) is skipped by the sim and
// clipped by the vert.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>

#include "core/math.h"
#include "render/cube_pass.h" // CubePush — the shared push-constant block
#include "render/vk_buffer.h"

namespace giga::gpu {

// One particle. Must stay in LOCKSTEP with particle_sim.comp / particle.vert:
// {vec4 posLife; vec4 velTotal; vec4 colorSize; vec4 phys} = 64 B, all
// std430-clean vec4s.
//   posLife  = xyz world metres, w = life remaining s (<= 0 -> dead)
//   velTotal = xyz m/s,          w = life total s (the vert's fade base)
//   colorSize= rgb tint,         w = billboard edge, metres
//   phys     = x gravity mul, y drag (per 60 Hz step, pow'd by dt),
//              z restitution (0 = a wall hit kills it), w = emissive 0..255
struct GpuParticle {
    vec4 posLife;
    vec4 velTotal;
    vec4 colorSize;
    vec4 phys;
};
static_assert(sizeof(GpuParticle) == 64, "four-vec4-clean layout");

inline constexpr std::uint32_t kMaxParticles = 32768;

class ParticlePass {
public:
    ParticlePass() = default;
    ~ParticlePass() { destroy(); }
    ParticlePass(const ParticlePass&) = delete;
    ParticlePass& operator=(const ParticlePass&) = delete;

    // `masksBuffer` is VoxelMirror's masks SSBO — the sim's collision truth.
    // The mirror outlives this pass (destroyed after it in main), so the raw
    // handle is safe to keep in the descriptor set.
    bool init(VulkanDevice* dev, VkRenderPass renderPass, const char* shaderDir,
              VkBuffer masksBuffer);
    void destroy();
    bool ready() const { return drawPipeline_ != VK_NULL_HANDLE; }

    // Drop `count` fresh particles at the ring cursor (wraps, overwrites the
    // oldest — cosmetics may drop, the frame must not stall). CPU-writes the
    // host-visible pool the same way WirePass::write_alive does.
    void spawn(const GpuParticle* items, std::uint32_t count);

    // The sim step. Record OUTSIDE the render pass (compute), before draw.
    void record_sim(VkCommandBuffer cmd, float dt);

    // The billboard draw. Record INSIDE the render pass, after the solid
    // passes (alpha-blended, depth-tested, no depth write).
    void record_draw(VkCommandBuffer cmd, const CubePush& push);

    std::uint32_t spawned_total() const { return spawnedTotal_; }

    // Live-particle census off the mapped pool (the sim writes life in place,
    // host-coherent). A 2 MiB scan — HUD/diagnostic cadence, not per-tick.
    std::uint32_t alive_count() const {
        if (!pool_.mapped) return 0;
        const auto* p = static_cast<const GpuParticle*>(pool_.mapped);
        std::uint32_t n = 0;
        for (std::uint32_t i = 0; i < kMaxParticles; ++i)
            if (p[i].posLife.w > 0.0f) ++n;
        return n;
    }

private:
    bool create_pipelines(VkRenderPass renderPass, const char* shaderDir);

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer pool_;                         // persistent, host-visible
    std::uint32_t cursor_ = 0;
    std::uint32_t spawnedTotal_ = 0;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;
    VkPipelineLayout simLayout_ = VK_NULL_HANDLE;
    VkPipeline simPipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout drawLayout_ = VK_NULL_HANDLE;
    VkPipeline drawPipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu

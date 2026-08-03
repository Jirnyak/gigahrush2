// wire_pass.h — GPU-verlet hanging wires (the antourage GHOST chains).
//
// The render half of the owner's one-way law: the wire sim lives ENTIRELY on
// the GPU (wire_sim.comp), bodies/the player push wires and wires push nothing
// back, so the CPU tick pays zero. Points are pulled straight from the sim
// SSBO by wire.vert as line segments — no vertex buffer, no per-frame upload
// beyond a handful of alive flags.
//
// LAYERING: render never includes game/ ([ARCHITECTURE.md]), so this pass
// speaks a POD wire format (GpuWireChain below) and the app packs it from
// game::AntourageBake at floor load.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>

#include "core/math.h"
#include "render/cube_pass.h" // CubePush — the shared push-constant block
#include "render/vk_buffer.h"

namespace giga::gpu {

// One chain on the GPU. Must stay in LOCKSTEP with wire_sim.comp / wire.vert:
// {vec4 meta; vec4 cur[8]; vec4 prev[8]} = 272 B, all std430-clean vec4s.
// meta.x = segment rest length, meta.y = alive flag, cur[i].w = inverse mass
// (0 pins the two anchor endpoints).
inline constexpr int kWireChainPoints = 8;
struct GpuWireChain {
    vec4 meta;
    vec4 cur[kWireChainPoints];
    vec4 prev[kWireChainPoints];
};
static_assert(sizeof(GpuWireChain) == 272, "three-vec4-clean layout");

inline constexpr std::uint32_t kMaxWireChains = 1024;

// Push-body cap. Every body on the active layer brushes wires and cloth —
// the player is just one of them (an NPC with a camera, owner's law). One
// vec4 per body: xyz = world pos, w = push radius.
inline constexpr std::uint32_t kMaxPushBodies = 512;

class WirePass {
public:
    WirePass() = default;
    ~WirePass() { destroy(); }
    WirePass(const WirePass&) = delete;
    WirePass& operator=(const WirePass&) = delete;

    bool init(VulkanDevice* dev, VkRenderPass renderPass, const char* shaderDir);
    void destroy();
    bool ready() const { return drawPipeline_ != VK_NULL_HANDLE; }

    // Replace the chain set (floor load / prop rebuild). Uploads rest poses;
    // the verlet state restarts from rest, which is invisible on a load.
    void upload(const GpuWireChain* chains, std::uint32_t count);

    // CPU-side aliveness (the anchor probe against the live grid): flags[i]=0
    // kills chain i this frame — one byte per chain, written into meta.y.
    void write_alive(const std::uint8_t* flags, std::uint32_t count);

    // This frame's push bodies (every Transform+AABB body on the layer, the
    // camera holder among them — nobody special). vec4 = xyz pos, w radius.
    void upload_bodies(const vec4* bodies, std::uint32_t count);

    // The verlet step. Record OUTSIDE the render pass (compute), before draw.
    void record_sim(VkCommandBuffer cmd, float dt);

    // The line draw. Record INSIDE the render pass, after the solid passes.
    void record_draw(VkCommandBuffer cmd, const CubePush& push);

    std::uint32_t chain_count() const { return chainCount_; }

private:
    bool create_pipelines(VkRenderPass renderPass, const char* shaderDir);

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer points_;                       // persistent, host-visible
    VulkanBuffer bodies_;                       // per-frame push bodies
    std::uint32_t chainCount_ = 0;
    std::uint32_t bodyCount_ = 0;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;
    VkPipelineLayout simLayout_ = VK_NULL_HANDLE;
    VkPipeline simPipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout drawLayout_ = VK_NULL_HANDLE;
    VkPipeline drawPipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu

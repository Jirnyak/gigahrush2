// gpu_particle_pass.h — GPU-native particle system (Vulkan compute + indirect draw).
//
// Architecture (GPU-first, zero CPU readback on hot path):
//
//   DEVICE_LOCAL buffers (never touched by CPU after init):
//     particleBuf_   — array of Particle structs (state: pos/vel/color/lifetime)
//     vertexBuf_     — billboard vertex output written by particles.comp
//     drawCmdBuf_    — VkDrawIndirectCommand, atomicAdd'd by compute shader
//
//   HOST_VISIBLE buffer (write-only from CPU):
//     emitBuf_       — EmitEvent ring buffer; CPU writes spawn descriptors here.
//                      GPU consumes during the compute dispatch. Ring head
//                      advances monotonically; modulo in shader handles wrapping.
//
// Frame lifecycle:
//   1. emit_burst() / emit()  — writes EmitEvents into emitBuf_ (mapped memory,
//                               no vkFlush needed — HOST_COHERENT).
//   2. record_compute()       — clears drawCmdBuf_ via vkCmdFillBuffer, then
//                               dispatches particles.comp (one invocation per slot).
//   3. Pipeline barrier       — SSBO write → vertex read (handled by caller or
//                               embedded in record_compute with a full memory barrier).
//   4. record_draw()          — binds vertex buffer, issues vkCmdDrawIndirect from
//                               drawCmdBuf_. No CPU readback, no instance upload.
//
// Push constants for the compute stage share the same VkPushConstantRange as the
// graphics stage but with a different layout (ParticlePush). The pipeline layout
// for particle_pass is SEPARATE from CubePass — we do not share push constants
// because the field semantics differ.
#pragma once

#include <cstdint>

#include <vulkan/vulkan.h>

#include "render/vk_buffer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "core/math.h"

namespace giga::gpu {

// ── GPU-side particle descriptor (must match particles.comp exactly) ──────────

static constexpr uint32_t kMaxGpuParticles = 8192;
// Max emit events queued per frame (ring buffer capacity).
static constexpr uint32_t kMaxEmitEvents   = 512;

enum class GpuParticleKind : std::uint32_t {
    Spark    = 0,
    Smoke    = 1,
    AcidDrip = 2,
    BioSpore = 3,
    DustMote = 4,
    ElecArc  = 5,
};

// Written by CPU into the mapped emit ring buffer.
// Layout must match EmitEvent in particles.comp (std430).
struct alignas(16) GpuEmitEvent {
    vec3     pos;
    float    speed;
    vec3     dir;
    float    lifetime;
    vec3     color;
    float    size;
    uint32_t kind;
    float    spreadCos;  // cos(half-angle) of emission cone; 1.0 = directional
    uint32_t pad0 = 0;
    uint32_t pad1 = 0;
};
static_assert(sizeof(GpuEmitEvent) == 64, "GpuEmitEvent size mismatch");

// Push constants for particles.comp (compute stage).
struct alignas(4) ParticleComputePush {
    float    dt;
    float    time;
    uint32_t maxParticles;
    uint32_t emitCount;
    uint32_t emitRingHead;
    float    camX, camY, camZ;
    float    fogStart, fogEnd;
};

// Push constants for particle.vert / particle.frag (graphics stage).
struct alignas(16) ParticleDrawPush {
    float    viewProj[16];
    vec3     camPos;
    float    _pad0;
    vec3     camRight;
    float    _pad1;
    vec3     camUp;
    float    _pad2;
    float    fogStart, fogEnd;
    float    _pad3[2];
};

// ── pass class ────────────────────────────────────────────────────────────────

class GpuParticlePass {
public:
    GpuParticlePass()  = default;
    ~GpuParticlePass() { destroy(); }

    GpuParticlePass(const GpuParticlePass&)            = delete;
    GpuParticlePass& operator=(const GpuParticlePass&) = delete;

    // Create all Vulkan objects. Must be called once, before any frame.
    // `shaderDir` must contain particles.comp.spv, particle.vert.spv, particle.frag.spv.
    // `renderPass` / `subpass` are the graphics render pass this draw lives in.
    bool init(VulkanDevice* dev, VkRenderPass renderPass, uint32_t subpass,
              const char* shaderDir, VkDescriptorSetLayout lightGridSetLayout = VK_NULL_HANDLE);

    // Write a one-shot burst of particles into the emit ring buffer.
    // Returns the number of events that fit (limited by kMaxEmitEvents / frame).
    uint32_t emit_burst(vec3 pos, vec3 dir, vec3 color,
                        GpuParticleKind kind,
                        int count, float speed,
                        float lifetime, float size,
                        float spreadDeg = 45.0f) noexcept;

    // Continuous emitter: call every frame with dt.
    uint32_t emit(const GpuEmitEvent& templ, float rate, float dt) noexcept;

    // Record compute dispatch (physics update + vertex generation).
    // Must be called OUTSIDE the render pass (compute commands).
    // Inserts the memory barrier before returning.
    void record_compute(VkCommandBuffer cmd, float dt, float time,
                        const vec3& camPos) noexcept;

    // Record indirect draw inside the active render pass.
    // `push` must already be bound by the caller (or call bind_draw_push()).
    void record_draw(VkCommandBuffer cmd, const ParticleDrawPush& push,
                     VkDescriptorSet lightGridSet = VK_NULL_HANDLE) noexcept;

    void destroy() noexcept;
    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

    uint32_t emit_head()   const noexcept { return emitHead_; }
    uint32_t emit_queued() const noexcept { return emitQueued_; }

private:
    bool create_compute_pipeline(const char* shaderDir) noexcept;
    bool create_graphics_pipeline(VkRenderPass rp, uint32_t subpass,
                                  const char* shaderDir) noexcept;
    bool create_descriptor_sets() noexcept;
    bool alloc_buffers() noexcept;

    VulkanDevice*    dev_ = nullptr;

    // ── GPU buffers ────────────────────────────────────────────────────────────
    // DEVICE_LOCAL: particle state, vertex output, indirect draw command
    VulkanBuffer     particleBuf_{};   // Particle[kMaxGpuParticles]
    VulkanBuffer     vertexBuf_{};     // BillVertex[kMaxGpuParticles * 6]
    VulkanBuffer     drawCmdBuf_{};    // VkDrawIndirectCommand (4 * uint32)

    // HOST_VISIBLE|HOST_COHERENT: emit ring buffer (write-combined from CPU)
    VulkanBuffer     emitBuf_{};       // GpuEmitEvent[kMaxEmitEvents]

    // ── Compute pipeline ───────────────────────────────────────────────────────
    VkDescriptorSetLayout computeDescLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout      computeLayout_     = VK_NULL_HANDLE;
    VkPipeline            computePipeline_   = VK_NULL_HANDLE;
    VkDescriptorPool      descPool_          = VK_NULL_HANDLE;
    VkDescriptorSet       computeDescSet_    = VK_NULL_HANDLE;

    // ── Graphics pipeline ──────────────────────────────────────────────────────
    VkDescriptorSetLayout lightGridSetLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout      drawLayout_        = VK_NULL_HANDLE;
    VkPipeline            drawPipeline_      = VK_NULL_HANDLE;

    // ── Emit ring buffer tracking (CPU-side) ───────────────────────────────────
    uint32_t emitHead_   = 0;  // monotonic, mod in shader
    uint32_t emitQueued_ = 0;  // events staged this frame (reset each compute)
};

} // namespace giga::gpu

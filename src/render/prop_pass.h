// prop_pass.h — GPU-instanced arbitrary mesh pass.
//
// Renders the prop shape catalog, each shape as one indirect draw over its
// RANGE of a single shared instance buffer. The fragment shader is shared
// with the world and body passes (cube.frag) so lighting, fog, and material
// shading are identical and free.
//
// Who decides what is drawn: GpuCullPass (frustum + fog + torus wrap) and
// ONLY GpuCullPass. This pass stores everything the floor submitted (up to
// the root cap) and hands ranges to the culler; it never drops by insertion
// order. The old per-shape kMaxPropInstances=4096 did exactly that — silent
// insertion-order cuts BEFORE visibility ran, so a floor with 13k instances
// lost 2.5k ceiling lamp shades at random ("light without a shade").
//
// Integration:
//   1. Call init() once after VulkanDevice and the cube pipeline layout are up.
//   2. Call add_instance() / clear_instances() to populate the scene list.
//   3. Before the render pass, call upload_instances(frame) and run
//      GpuCullPass::record_cull per shape over the returned ranges.
//   4. Inside the render pass, after the world draw, call record() with
//      the same push constants the cube pass received.
#pragma once

#include <vulkan/vulkan.h>
#include <array>
#include <cstdint>
#include <vector>

#include "render/material_textures.h"   // CubePush (shared push-constant block)
#include "render/prop_mesh.h"
#include "render/vk_buffer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h" // kMaxFramesInFlight

namespace giga::gpu {

// Root cap for prop instances — TOTAL across all shapes, not per shape.
// Owner's decision 2026-08-18 ([markoaudit/plans/light-perf.md], CANON S11
// root caps): kRootProps = 2^17. Derivation: the buffer must hold the whole
// floor's static skin (падик measures ~13k meshes + antourage), headroom to
// the owner's "на всё по 100к" round-up; buffer size follows from the cap,
// not the other way around: 131072 × sizeof(PropInstance)=48 B = 6 MiB per
// frame-in-flight copy (src + culled ⇒ 4 × 6 MiB total at 2 frames).
// Visibility is GpuCullPass's job; overflowing this cap is reported out loud
// (the light-grid overflowDropped_ pattern), never silently.
static constexpr uint32_t kRootPropInstances = 1u << 17; // 131072

class PropPass {
public:
    PropPass()  = default;
    ~PropPass() { destroy(); }
    PropPass(const PropPass&)            = delete;
    PropPass& operator=(const PropPass&) = delete;

    // `pipelineLayout` is borrowed from MaterialTextures (same push-constant block).
    // `shaderDir` must contain prop.vert.spv and prop.frag.spv (falls back to
    // cube.frag.spv when prop.frag.spv is absent).
    bool init(VulkanDevice* dev, VkPipelineLayout pipelineLayout,
              VkRenderPass renderPass, const char* shaderDir);

    // Submit instances for the next record() call. Refused only past the ROOT
    // cap (total across shapes) — and that refusal is printed, with numbers.
    void add_instance(PropShape shape, const PropInstance& inst);
    void clear_instances();

    // Cut shape ranges over the shared buffer and memcpy every shape's
    // instances into instance_buffer(frameIndex) at its range offset. Call
    // once per frame BEFORE record_cull / record(). Range starts are aligned
    // so they are legal SSBO descriptor offsets (minStorageBufferOffsetAlignment).
    void upload_instances(uint32_t frameIndex);

    // Record all prop draw calls into `cmd`. Push constants must already be
    // bound by the caller (the world pass does this;
    // the prop pass is drawn inside the same render-pass subpass so they carry
    // over without a re-push).
    void record(VkCommandBuffer cmd, uint32_t frameIndex,
                const CubePush& push, VkDescriptorSet lightGridSet = VK_NULL_HANDLE,
                VkDescriptorSet shadowSet = VK_NULL_HANDLE);

    void destroy();
    bool ready() const { return pipeline_ != VK_NULL_HANDLE; }

    uint32_t last_draw_count() const { return lastDrawCount_; }
    uint32_t instance_count(int s) const { return static_cast<uint32_t>(cpuInst_[s].size()); }
    uint32_t total_instance_count() const { return totalInst_; }
    const PropMesh& mesh(int s) const { return meshes_[s]; }

    // Shape ranges over the shared buffers, valid after upload_instances().
    uint32_t     range_count(int s) const { return rangeCount_[s]; }
    VkDeviceSize range_offset_bytes(int s) const {
        return static_cast<VkDeviceSize>(rangeBase_[s]) * sizeof(PropInstance);
    }

    VkBuffer instance_buffer(uint32_t f) const { return instBuf_[f].buffer; }
    VkBuffer culled_instance_buffer(uint32_t f) const { return culledInstBuf_[f].buffer; }
    VkBuffer indirect_cmd_buffer(int s, uint32_t f) const { return indirectCmdBufs_[s][f].buffer; }
    void set_use_gpu_culling(bool enable) { useGpuCulling_ = enable; }
    bool use_gpu_culling() const { return useGpuCulling_; }

    std::vector<vec3> get_prop_positions(PropShape shape) const {
        std::vector<vec3> positions;
        const auto& insts = cpuInst_[static_cast<std::size_t>(shape)];
        for (const auto& inst : insts) {
            positions.push_back(inst.origin);
        }
        return positions;
    }

    // get_terminal_positions REMOVED ([jirnyak.md] section 18/20).
    // Sim + HUD must use game::collect_interactable_positions /
    // game::find_nearest_interactable / game::interaction_step. PropPass is a
    // passive GPU skin -- it must not be the source of truth for terminals.

private:
    bool create_pipeline(VkPipelineLayout layout, VkRenderPass rp,
                         const char* shaderDir);
    // Recompute rangeBase_/rangeCount_ from the current cpuInst_ lists.
    void compute_ranges();

    // NOTE: tests/suite_props.inl mirrors this member prefix (through
    // cpuInst_) via a layout-compatible inspector — keep the order.
    VulkanDevice*    dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline       pipeline_ = VK_NULL_HANDLE;

    std::array<PropMesh, kPropShapeCount> meshes_;

    // CPU-side instance lists, rebuilt each frame before upload. Grouped by
    // shape (the draw needs contiguous per-shape ranges) but capped only in
    // TOTAL by kRootPropInstances.
    std::array<std::vector<PropInstance>, kPropShapeCount> cpuInst_;
    uint32_t totalInst_ = 0;
    // Instances refused because the ROOT cap was full, since the last clear.
    // Reported out loud — a silent drop reads as "the floor has this much
    // dressing" when it does not ([antourage.md] GPU ceilings). The totals go
    // out once per rebuild, on the first frame that cuts ranges.
    uint32_t overflowDropped_ = 0;
    bool overflowReported_ = false;

    // Shape ranges over the shared instance buffer, in instances.
    std::array<uint32_t, kPropShapeCount> rangeBase_{};
    std::array<uint32_t, kPropShapeCount> rangeCount_{};
    // Range starts must be legal SSBO bind offsets: multiples of
    // lcm(minStorageBufferOffsetAlignment, sizeof(PropInstance)) — expressed
    // here in instances. Computed in init() from the device limit.
    uint32_t alignInstances_ = 1;

    // ONE shared instance buffer per frame in flight (src + culled), sized by
    // kRootPropInstances. Per-shape only the 32-byte indirect commands remain.
    std::array<VulkanBuffer, kMaxFramesInFlight> instBuf_;
    std::array<VulkanBuffer, kMaxFramesInFlight> culledInstBuf_;
    std::array<std::array<VulkanBuffer, kMaxFramesInFlight>, kPropShapeCount> indirectCmdBufs_;

    uint32_t lastDrawCount_ = 0;
    bool useGpuCulling_ = false;
};

} // namespace giga::gpu

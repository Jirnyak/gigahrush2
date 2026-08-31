// verlet_pass.h — THE GPU-verlet pass for antourage: hanging wires (GHOST
// chains) and 2D cloth sheets (curtains, tarps, membranes) in one class, one
// compute shader (verlet_sim.comp), one push-body buffer. A chain is a W x 1
// lattice — at H == 1 the sheet solver degenerates into the chain solver in
// the same traversal order, so the two old passes (wire_pass/cloth_pass, 87 %
// identical) collapsed into sections of this one.
//
// SoA POOL (stage 2 of the merge, 2026-08-31): ONE point pool + ONE element
// table, banks of fixed geometry laid out back to back — wires [0..W*8), then
// cloths. Bank membership is ARITHMETIC off the bank base carried in the push
// block (plan §2.1: element sizes are compile-time constants, so an
// indirection buffer would buy nothing). The per-kind caps kMaxWireChains =
// 1024 / kMaxClothSheets = 512 died here — the ONLY cap is the canonical root
// below, and a bank is limited by pool space alone.
//
// The render half of the owner's one-way law: the verlet sim lives ENTIRELY
// on the GPU, bodies/the player push antourage and antourage pushes nothing
// back, so the CPU tick pays zero. Points are pulled straight from the sim
// SSBOs by wire.vert (line ribbons) and cloth.vert (two-sided quads) — no
// vertex buffer, no per-frame upload beyond a handful of alive flags.
//
// LAYERING: render never includes game/ ([ARCHITECTURE.md]), so this pass
// speaks POD element formats (GpuWireChain / GpuClothSheet below) as its
// UPLOAD seam — the app packs them from game::AntourageBake at floor load and
// the pass repacks into the pool. The upload PODs stayed byte-identical
// through the relayout precisely so the app and the tests never moved.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>
#include <vector>

#include "core/math.h"
#include "render/material_textures.h" // CubePush — the shared push-constant block
#include "render/vk_buffer.h"

namespace giga::gpu {

// UPLOAD POD: one chain as the app seam speaks it. meta.x = segment rest
// length, meta.y = alive flag, meta.z = massKg (the bake's honest derivation,
// parked for the damping increment), cur[i].w = inverse mass (0 pins a point).
inline constexpr int kWireChainPoints = 8;
struct GpuWireChain {
    vec4 meta;
    vec4 cur[kWireChainPoints];
    vec4 prev[kWireChainPoints];
};
static_assert(sizeof(GpuWireChain) == 272, "three-vec4-clean layout");

// UPLOAD POD: one sheet. Grid is kClothGridW x kClothGridH = 8 x 4 points,
// row-major from the TOP row. meta.x = horizontal rest, meta.y = alive,
// meta.z = vertical rest; cur[i].w = inverse mass (0 pins — top row default).
inline constexpr int kClothGridW = 8;
inline constexpr int kClothGridH = 4;
inline constexpr int kClothGridPoints = kClothGridW * kClothGridH;
struct GpuClothSheet {
    vec4 meta;
    vec4 cur[kClothGridPoints];
    vec4 prev[kClothGridPoints];
};
static_assert(sizeof(GpuClothSheet) == 1040, "vec4-clean layout");

// 7 x 3 quads x 6 vertices — cloth.vert derives the grid cell from the index.
inline constexpr std::uint32_t kClothVertsPerSheet =
    (kClothGridW - 1) * (kClothGridH - 1) * 6;

// THE root cap of the antourage system (CANON S9/S11: «антураж 2^20 =
// 1 048 576 точек, цель — плотный фон»; каждый производный буфер обязан
// считаться от корневого, не заводить своё число). Pool cost: 2^20 x 32 B =
// 32 MiB host-visible — the price of the canonical density target, paid once.
inline constexpr std::uint32_t kRootAntouragePoints = 1u << 20;

// DERIVED: the element table can never outgrow the pool divided by the
// smallest element (a chain, 8 points). The GpuHandoff-shard increment adds a
// smaller element (2–4 points) and MUST re-derive this divisor with it.
inline constexpr std::uint32_t kMaxAntourageElems =
    kRootAntouragePoints / static_cast<std::uint32_t>(kWireChainPoints);

// POOL RECORDS. Must stay in LOCKSTEP with verlet_sim.comp, wire.vert and
// cloth.vert. A point: cur.w = inverse mass (0 = pinned), prev.w spare (the
// particle region will claim it for life at the particle-merge increment).
struct VerletPoint {
    vec4 cur;
    vec4 prev;
};
static_assert(sizeof(VerletPoint) == 32, "two-vec4-clean layout");

// An element: ONE vec4 — {restX, restY, alive, massKg}. Its first point and
// its W x H are arithmetic off the bank bases (see file header), so the old
// per-element meta shrank 272/1040 B → 16 B.
struct VerletElem {
    vec4 v;
};
static_assert(sizeof(VerletElem) == 16, "one-vec4-clean layout");

// Draw-stage extra push range at offset sizeof(CubePush): the two bank
// numbers the instanced vertex shaders need to address the pool. Lives BESIDE
// CubePush (vertex-only range), never inside it — CubePush is shared by the
// whole pass family and its dead lanes stay dead.
struct VerletDrawPush {
    std::uint32_t clothPointBase;
    std::uint32_t wireElemCount;
    std::uint32_t pad0, pad1;
};
static_assert(sizeof(CubePush) + sizeof(VerletDrawPush) <= 128,
              "must fit the 128-byte guaranteed push range");

// Push-body cap. Every body on the active layer brushes wires and cloth —
// the player is just one of them (an NPC with a camera, owner's law). One
// vec4 per body: xyz = world pos, w = push radius. ONE buffer for both banks.
inline constexpr std::uint32_t kMaxPushBodies = 512;

class VerletPass {
public:
    VerletPass() = default;
    ~VerletPass() { destroy(); }
    VerletPass(const VerletPass&) = delete;
    VerletPass& operator=(const VerletPass&) = delete;

    // `masksBuffer` is VoxelMirror's masks SSBO, exactly as ParticlePass takes
    // it: the sim collides against the render-side copy of the grid, so a piece
    // that lost its last pin falls and LANDS instead of sinking through the
    // floor. The mirror outlives this pass, so the raw handle is safe to keep.
    // `renderPass` may be VK_NULL_HANDLE: compute-only mode for headless tests
    // (verlet_test) — the sim runs, the draws are never created.
    bool init(VulkanDevice* dev, VkRenderPass renderPass, const char* shaderDir,
              VkBuffer masksBuffer,
              VkDescriptorSetLayout lightGridSetLayout = VK_NULL_HANDLE);
    void destroy();
    bool ready() const {
        return wireDrawPipeline_ != VK_NULL_HANDLE &&
               clothDrawPipeline_ != VK_NULL_HANDLE;
    }
    bool sim_ready() const { return simPipeline_ != VK_NULL_HANDLE; }

    // Replace a bank (floor load / prop rebuild). Uploads rest poses; the
    // verlet state restarts from rest, which is invisible on a load. Each
    // call repacks BOTH banks into the pool (a few hundred KiB memcpy).
    void upload_wires(const GpuWireChain* chains, std::uint32_t count);
    void upload_cloths(const GpuClothSheet* sheets, std::uint32_t count);

    // CPU-side aliveness (the anchor probe against the live grid): flags[i]=0
    // kills element i this frame — written into the element table.
    void write_wire_alive(const std::uint8_t* flags, std::uint32_t count);
    void write_cloth_alive(const std::uint8_t* flags, std::uint32_t count);

    // Per-element pin mask (bit j pins point j) written into the pool's
    // inverse mass slots: pinned = 0, free = 1. This is how a SEVERED end lets
    // go without re-uploading — live verlet positions are kept, so the wire
    // whips down from where it was instead of snapping back to rest.
    void write_wire_pins(const std::uint8_t* masks, std::uint32_t count);
    void write_cloth_pins(const std::uint32_t* masks, std::uint32_t count);

    // This frame's push bodies (every Transform+AABB body on the layer, the
    // camera holder among them — nobody special). vec4 = xyz pos, w radius.
    void upload_bodies(const vec4* bodies, std::uint32_t count);

    // The verlet step: ONE pipeline, TWO dispatches (plan §2.3) — points
    // (integration + bodies + world landing, thread per point) then elements
    // (constraint relaxation, thread per element), one barrier between.
    // Record OUTSIDE the render pass, before draw. `gravity` is the layer's
    // declared acceleration VECTOR (m/s^2) — never re-derive "down".
    void record_sim(VkCommandBuffer cmd, float dt, vec3 gravity);

    // The draws — INSTANCED now (one instance per element; the old
    // vertex-index division died with the relayout). Record INSIDE the render
    // pass, after the solid passes. lightSet — сет световой сетки (set 1).
    void record_draw_wires(VkCommandBuffer cmd, const CubePush& push,
                           VkDescriptorSet lightSet);
    void record_draw_cloths(VkCommandBuffer cmd, const CubePush& push,
                            VkDescriptorSet lightSet);

    std::uint32_t chain_count() const { return wireCount_; }
    std::uint32_t sheet_count() const { return clothCount_; }

    // Reassemble one element in the UPLOAD POD view — the read seam for
    // verlet_test and the GIGA_VERLET_PIN dump (same bytes, same order as the
    // pre-relayout hash walked, so pins stay comparable across the merge).
    void gather_chain(std::uint32_t idx, GpuWireChain* out) const;
    void gather_sheet(std::uint32_t idx, GpuClothSheet* out) const;

private:
    // Pin bookkeeping per bank (sims since upload, upload ordinal, dump latch).
    struct BankPin {
        std::uint32_t simsSinceUpload = 0;
        std::uint32_t uploadEpoch = 0;
        bool pinDumped = false;
    };

    bool create_pipelines(VkRenderPass renderPass, const char* shaderDir);
    void repack();                      // stage vectors -> pool + element table
    void maybe_pin_dump(BankPin& s, const char* tag, std::uint32_t elemBase,
                        std::uint32_t pointBase, std::uint32_t count,
                        std::uint32_t pointsPer);
    std::uint32_t cloth_point_base() const {
        return wireCount_ * static_cast<std::uint32_t>(kWireChainPoints);
    }

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer points_; // persistent, host-visible: the ONE pool
    VulkanBuffer elems_;  // persistent, host-visible: the element table
    VulkanBuffer bodies_; // per-frame push bodies
    std::uint32_t bodyCount_ = 0;
    std::uint32_t wireCount_ = 0;
    std::uint32_t clothCount_ = 0;
    BankPin wirePin_;
    BankPin clothPin_;

    // Upload staging: kept so either bank can be replaced independently while
    // the pool stays packed back to back (repack cost is a small memcpy).
    std::vector<GpuWireChain> wireStage_;
    std::vector<GpuClothSheet> clothStage_;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE; // ONE set — banks share every binding
    VkPipelineLayout simLayout_ = VK_NULL_HANDLE;
    VkPipeline simPipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout drawLayout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout lightGridSetLayout_ = VK_NULL_HANDLE;
    VkPipeline wireDrawPipeline_ = VK_NULL_HANDLE;
    VkPipeline clothDrawPipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu

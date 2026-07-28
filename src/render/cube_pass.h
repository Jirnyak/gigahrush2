// The world renderer: draws visible macro cells as instanced stretched boxes.
//
// This is the concrete "we can actually see the world" pass. It walks the macro
// grid, merges adjacent cells that agree on everything the shader can observe into
// single stretched boxes, and issues a single instanced draw. The cube mesh is
// static device-local geometry; the per-instance data is a persistently-mapped
// host-visible buffer (double-buffered so we never stomp a frame still in flight).
//
// The instance list is CACHED, not rebuilt per frame — the grid only changes when
// a floor is generated/streamed or fluid moves, so rebuilding it every frame was
// spending 28.6 ms of a 43.6 ms frame scanning 2,097,152 cells that had not
// changed. Callers must invalidate() when the world mutates.
//
// Two things keep the instance count down, and they compose:
//   - surface culling: cells fully surrounded by solid neighbours are skipped, so
//     the count follows visible surface area rather than world volume;
//   - RUN MERGING: adjacent surface cells sharing a material, a colour and an
//     ambient-occlusion neighbourhood collapse into one box (render/cube_merge.h).
//     This pass is geometry-bound — measured, deleting the whole procedural surface
//     layer from cube.frag moved it +0.05 ms, i.e. upwards inside the noise — so
//     vertices are the only thing worth cutting, and a 40-cell wall was 40 boxes.
#pragma once

#include <vulkan/vulkan.h>

#include <cstddef>
#include <cstdint>
#include <vector>

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
    // Absolute grid position of the box's MINIMUM corner. Absolute, not
    // camera-relative: the nearest-toroidal-image shift happens per-vertex in
    // cube.vert, which is what makes this buffer cacheable across frames. A box
    // whose run crosses the wrap legitimately extends past kWorldExtent.
    vec3 origin;
    // Extent in CELLS along x, y, z. {1,1,1} is a single cell; a merged run has
    // exactly one entry > 1 (see render/cube_merge.h). The fourth byte is the
    // remainder of what used to be a `float scale` written unconditionally as
    // kCellSize by every instance ever emitted — four bytes of per-instance
    // constant, which is exactly the lane a merged pass needed and the reason the
    // merge cost zero extra bytes per instance. Uploaded as
    // VK_FORMAT_R8G8B8A8_UINT and read as a uvec4; cube.vert multiplies by
    // kCellSize itself, the same 2.0 m that cube.frag already hardcodes to
    // normalise its world-space uv.
    //
    // uint8 caps a run at 255 cells against a 128-cell grid, so the type is not
    // the binding constraint — cube_merge.h kMaxRunCells is, and it is a toroidal
    // seam budget rather than a storage limit.
    std::uint8_t span[3];
    std::uint8_t spanW;
    vec3 color;
    // Two things in one uint32, because there was no room for a second.
    //
    //   bits 0..26  ambient-occlusion input: the occupancy mask of this box's
    //               3x3x3 neighbourhood, bit ((dz+1)*9 + (dy+1)*3 + (dx+1)) set when
    //               that neighbour is solid. Bit 13 is the centre — this cell — and
    //               is neither written nor read.
    //   bits 27..31 the MATERIAL ID (world/materials.h), for the per-material
    //               surface families in cube.frag.
    //
    // Only the 20 bits corner_ao() in cube.vert can actually READ are written; the
    // six single-axis face offsets are masked off, because no shader looks at them
    // and a merged box has no single honest value for them (see kAoReadBits in
    // render/cube_merge.h). For a merged run every cell agrees on all 20 by
    // construction, so the word means the same thing for a 1-cell box and a 7-cell
    // one — which is the property that lets a stretched box keep exact AO.
    //
    // The material id is free. `occ` needs 27 bits and a uint32 has 32, so the top
    // five were already being paid for and thrown away; five bits hold 0..31 against
    // a kMatCount of 16, which is a full doubling of headroom. Nothing here grows:
    // CubeInstance stays 32 bytes, the vertex layout keeps its six attributes, and
    // the instance buffer keeps its size. See kMatIdShift in cube_pass.cpp.
    //
    // One uint32 is the ENTIRE cost of baked AO on the GPU side, and that is only
    // true because of a property of the shared mesh worth stating: which three
    // neighbours occlude a given vertex is a pure function of (face normal, corner
    // sign), both of which the vertex shader already has from inNormal and inPos.
    // A shared 36-vertex mesh forbids per-instance *topology*, not per-instance
    // *values* — so nothing about the mesh changes and body_pass keeps its own.
    std::uint32_t occ;
};
static_assert(sizeof(CubeInstance) == 32,
              "AO plus the material id must cost exactly one uint32 between them");
static_assert(offsetof(CubeInstance, spanW) == offsetof(CubeInstance, span) + 3,
              "the span bytes must be contiguous: one R8G8B8A8_UINT attribute "
              "covers all four");
// The spare lane is now SPENT. `span` reclaimed the four bytes the old `float scale`
// wasted on a per-instance constant, so there is no longer a free attribute lane
// here: the next thing that needs per-instance data must either shrink `color` (a
// display-referred albedo would survive R8G8B8A8_UNORM at a cost of one LSB) or grow
// CubeInstance past 32 bytes and pay the bandwidth. `spanW` is the only slack left —
// one byte, currently zero.

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

    // Per-cell classification: the surface flag plus the AO bits plus the material
    // id, one uint32 per macro cell (8 MB). Allocated once in init(), never in a
    // frame. It exists because run merging PROBES neighbours — up to three axes by
    // kMaxRunCells steps per emitted box — and recomputing a 3x3x3 occupancy mask
    // per probe means re-reading 26 x 64-byte SubMasks out of a 134 MB array. With
    // the classification precomputed, the whole 128^3 neighbourhood question is
    // answered from an array that streams, and the merge is cheaper than the scan it
    // replaced rather than three times its cost.
    //
    // Shared across frame slots and rebuilt only on invalidate(), so the SECOND
    // frame slot's refill is merge-plus-write and skips the grid sweep entirely.
    // That is what keeps an elevator ride from paying the whole cost twice.
    std::vector<std::uint32_t> cellClass_;
    bool classValid_ = false;
    // Run-merge scratch: one bit per cell marking cells already swallowed by an
    // earlier run. Needed because runs may go along y or z while the scan walks x.
    std::vector<std::uint64_t> claimed_;

    // Longest run the merge may emit, in cells. Defaults to cube_merge.h
    // kMaxRunCells; overridable once at init from GIGA_CUBE_MAXRUN so the merged and
    // unmerged paths can be A/B measured in the SAME binary. Setting it to 1 makes
    // this pass emit exactly one unit cube per surface cell, i.e. the pre-merge
    // renderer, which is the only honest way to compare a GPU time against it
    // without a second build in the comparison.
    int maxRun_ = 0;

    // Recompute cellClass_ from `world`. One sequential sweep of the sub-voxel
    // masks into two 256 KB occupancy bitmaps, then one sweep turning those into
    // per-cell AO masks.
    void classify(const World& world);
    // Fill one instance buffer from cellClass_. Returns the instance count.
    std::uint32_t build_instances(std::uint32_t frameIndex, const World& world);

    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_cube_mesh();
};

} // namespace giga::gpu

// Per-pass GPU time from VK_QUERY_TYPE_TIMESTAMP queries.
//
// WHY THIS EXISTS. The HUD's frame-time number is wall-clock time around the
// whole application: sim tick, a 400-1100 body crowd, ImGui, and the present
// wait. The swapchain presents FIFO, so that number is pinned at the vsync
// period (16.6 ms at 60 Hz) whenever the machine is keeping up — and a value
// pinned at a cap cannot detect a change *below* the cap. A commit in this
// repository claimed procedural surface detail cost "no frame-time change at
// all (16.6 ms before and after)". Both numbers were the vsync period. The
// comparison could not have detected a doubling of fragment cost, and it was
// published as a measurement. This module is what makes that mistake impossible
// to repeat: it measures the GPU itself, in the GPU's own clock, per pass.
//
// HOW A TIMESTAMP QUERY BEHAVES. vkCmdWriteTimestamp records a *command*; the
// value lands in the query pool when the GPU reaches it, which is long after the
// CPU has moved on. Reading it back in the same frame therefore means blocking
// on work that has not been submitted yet, which serialises CPU and GPU and
// inflates the very number being measured. So results are read back with a
// deliberate latency; see collect() for the exact rule.
//
// PLACEMENT RULES the caller must honour (they are Vulkan valid-usage, not
// style):
//   - frame_begin() records vkCmdResetQueryPool, which is ILLEGAL inside a
//     render pass instance. Call it after vkBeginCommandBuffer and before
//     vkCmdBeginRenderPass.
//   - pass_begin/pass_end are legal inside a render pass.
//   - frame_end() goes after vkCmdEndRenderPass, before vkEndCommandBuffer.
//   - collect() must only run once the fence for that slot's previous
//     submission has signalled.
// VulkanRenderer owns an instance and does all four itself; callers only bracket
// their own passes.
//
// WHAT THE PER-PASS NUMBERS MEAN, precisely. Both marks are written at
// BOTTOM_OF_PIPE, so each is stamped when every command before it has fully
// completed. The difference is therefore "time from the moment all preceding
// work had finished to the moment this pass's work had finished". A timestamp is
// not a barrier: it does not stop the driver overlapping two draws, so when two
// passes do overlap the earlier one's figure absorbs a little of the later
// one's. The frame total is exact regardless, and a real change in one pass's
// cost still lands in that pass's number — which is what this is for. Do not
// read the split as a hard partition of the frame.
//
// PORTABILITY. Timestamp support is not universal: a queue family may report
// timestampValidBits == 0, in which case there is nothing to query and every
// entry point here degrades to a no-op with supported() == false (the HUD prints
// "n/a"). Never fail to boot over instrumentation. On MoltenVK the counters may
// be emulated at a coarser granularity than a single draw call, so treat a
// per-pass split there as suspect until it is cross-checked against the frame
// total; the Windows/NVIDIA path is the one verified by measurement.
//
// AND THE INSTRUMENT MUST BE ABLE TO MEASURE ITSELF. GIGA_GPU_TIMER=0 disables
// the whole module at init(), which is the only way to find out what the eight
// timestamp writes and the query-pool reset cost per frame: a BOTTOM_OF_PIPE
// timestamp is an ordering point the driver has to honour, and "it is probably
// free" is an opinion. Same-binary A/B, like GIGA_CUBE_MAXRUN in cube_pass.cpp,
// because a rebuild between two numbers is how a thermally-downclocked
// "improvement" gets published.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

#include "render/vk_common.h" // kMaxFramesInFlight

namespace giga::gpu {

struct VulkanDevice;

// The GPU work we bracket, in HUD display order. Add one and the query pool
// grows automatically; nothing else needs touching.
enum class GpuPass : std::uint32_t {
    LightGrid = 0,
    VoxelFlush,
    Cull,
    SimPhysics, // wire/cloth/particle sim
    World,      // Raymarch
    Bodies,     // body_pass
    Props,      // prop_pass
    DrawPhysics, // wire/cloth/particle draw
    Hud,
    // Честные скобки для тайловых GPU (Apple/MoltenVK): таймстемп ВНУТРИ
    // рендер-пасса меряет пустоту — фрагментная работа исполняется вся на
    // vkCmdEndRenderPass. Меряем ЦЕЛЫЕ рендер-пассы: скобка вокруг
    // завершённого пасса честна и на тайлере, и на IMR. Старые пер-дров
    // скобки внутри пасса остаются — на десктопных IMR они осмысленны.
    Light,  // световой полупасс (полразрешения, свой рендер-пасс целиком)
    Raster, // главный мировой рендер-пасс целиком (begin_pass..end)
    kCount
};
inline constexpr std::uint32_t kGpuPassCount =
    static_cast<std::uint32_t>(GpuPass::kCount);

// Timestamps per frame slot: one at the top of the command buffer, one at the
// bottom, and a begin/end pair per pass.
inline constexpr std::uint32_t kGpuMarksPerFrame = 2 + 2 * kGpuPassCount;

// Samples kept per channel for the reported figure. 31 frames is ~0.5 s at
// 60 Hz — see GpuTimer::collect for why the statistic is a median over this
// window rather than a running average.
inline constexpr std::uint32_t kGpuTimerWindow = 31;

class GpuTimer {
public:
    // Cannot fail the boot: on any problem (no timestamp support, pool creation
    // refused) it logs, leaves supported() false, and every other method becomes
    // a no-op. Instrumentation must never be the reason a game does not start.
    void init(VulkanDevice& dev);
    void destroy();

    bool supported() const { return supported_; }

    // --- recording ---------------------------------------------------------
    void frame_begin(VkCommandBuffer cmd, std::uint32_t frameIndex);
    void pass_begin(VkCommandBuffer cmd, GpuPass p);
    void pass_end(VkCommandBuffer cmd, GpuPass p);
    void frame_end(VkCommandBuffer cmd);
    // Call after the frame's vkQueueSubmit SUCCEEDS. Marks the slot's queries as
    // worth reading; without it collect() would read a range the GPU never
    // wrote, whose contents are undefined.
    void frame_submitted();

    // --- readback ----------------------------------------------------------
    void collect(std::uint32_t frameIndex);

    // Smoothed milliseconds. 0 when unsupported or before the first sample.
    float pass_ms(GpuPass p) const {
        return smoothed_[static_cast<std::uint32_t>(p)];
    }
    float frame_ms() const { return smoothed_[kGpuPassCount]; }

    // WORST frame in the same window, and it is not redundant with the median.
    //
    // The median exists to be steady (see push_sample) and a median is *designed*
    // to discard outliers: it takes 16 slow frames out of 31 to move it. That is
    // the right default readout and the wrong tool for a stutter — a change that
    // costs 5 ms on one frame in six does not move pass_ms() at all, and a
    // one-frame-in-six hitch is exactly what a geometry or upload change
    // introduces. The pair is the point: the median says what the frame usually
    // costs, the peak says whether "usually" is the whole story. Free to compute
    // — the window is already insertion-sorted to find the median, so the maximum
    // is the last element of a buffer that has already been sorted.
    float pass_ms_max(GpuPass p) const {
        return peak_[static_cast<std::uint32_t>(p)];
    }
    float frame_ms_max() const { return peak_[kGpuPassCount]; }

    // Samples thrown away since boot because vkGetQueryPoolResults answered
    // VK_NOT_READY (or failed). collect() never stalls, so a dropped sample is
    // the correct behaviour — but it USED TO BE SILENT, and a silent drop means
    // the median on screen was computed over an older window than the reader
    // thinks. A number that is not growing means the readout is live; one that is
    // growing means every figure here is stale and a 0.05 ms delta means nothing.
    // Read it before believing a small difference.
    std::uint32_t dropped() const { return dropped_; }

    // Device facts, for the boot log and for anyone who wants to know how much
    // resolution the numbers actually have.
    float period_ns() const { return periodNs_; }
    std::uint32_t valid_bits() const { return validBits_; }
    // Ticks -> ms with this device's period. One tick is periodNs_ nanoseconds,
    // which is NOT 1 on all hardware.
    float ticks_to_ms(std::uint64_t ticks) const {
        return static_cast<float>(static_cast<double>(ticks) * periodNs_ * 1e-6);
    }

private:
    static constexpr std::uint32_t kChannels = kGpuPassCount + 1; // + frame

    VulkanDevice* dev_ = nullptr;
    VkQueryPool pool_ = VK_NULL_HANDLE;
    bool supported_ = false;

    float periodNs_ = 1.0f;
    std::uint32_t validBits_ = 0;
    std::uint64_t mask_ = ~0ull;

    std::uint32_t active_ = 0; // slot currently being recorded
    bool pending_[kMaxFramesInFlight] = {};

    // Ring of raw samples per channel + the median and the maximum over the
    // filled portion.
    float ring_[kChannels][kGpuTimerWindow] = {};
    std::uint32_t ringHead_ = 0;
    std::uint32_t ringCount_ = 0;
    float smoothed_[kChannels] = {};
    float peak_[kChannels] = {};
    std::uint32_t dropped_ = 0;

    void push_sample(const float ms[kChannels]);
};

} // namespace giga::gpu

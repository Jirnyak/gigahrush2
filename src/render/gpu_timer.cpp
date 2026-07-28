#include "render/gpu_timer.h"

#include "render/vk_device.h"

namespace giga::gpu {

namespace {

// Median of the first `n` entries of `src`. Copies into a fixed stack buffer and
// insertion-sorts it: n is 31, so this is ~240 compares once per frame, and it
// allocates nothing (hot-path rule in AGENTS.md).
float median_of(const float* src, std::uint32_t n) {
    if (n == 0) return 0.0f;
    float buf[kGpuTimerWindow];
    if (n > kGpuTimerWindow) n = kGpuTimerWindow;
    for (std::uint32_t i = 0; i < n; ++i) buf[i] = src[i];
    for (std::uint32_t i = 1; i < n; ++i) {
        const float v = buf[i];
        std::uint32_t j = i;
        while (j > 0 && buf[j - 1] > v) { buf[j] = buf[j - 1]; --j; }
        buf[j] = v;
    }
    return buf[n / 2];
}

} // namespace

void GpuTimer::init(VulkanDevice& d) {
    dev_ = &d;

    // timestampPeriod is nanoseconds per tick and is NOT 1 everywhere. Measured
    // on this machine: 1.000 (RTX 3060 Laptop). Commonly reported elsewhere and
    // NOT measured here: ~40 on AMD (a 25 MHz counter), ~52 on Intel, whatever
    // Metal hands MoltenVK. Converting with an assumed 1 would silently scale
    // every number on most of the market, which is why it is read, not assumed.
    periodNs_ = d.props.limits.timestampPeriod;

    // The authoritative per-queue check. timestampComputeAndGraphics only tells
    // you whether ALL graphics+compute families support them uniformly; a false
    // there does not mean our family lacks support, and a true is no use if we
    // then submit on a family that has none. Logged for the record, decided on
    // validBits.
    validBits_ = d.graphicsTimestampValidBits;
    const bool uniform = d.props.limits.timestampComputeAndGraphics == VK_TRUE;

    if (validBits_ == 0 || periodNs_ <= 0.0f) {
        std::fprintf(stderr,
                     "[gpu-timer] unsupported on graphics family "
                     "(validBits=%u period=%.3f ns, computeAndGraphics=%d) — "
                     "per-pass GPU timing disabled, HUD will read n/a\n",
                     validBits_, periodNs_, static_cast<int>(uniform));
        supported_ = false;
        return;
    }

    // A family may expose fewer than 64 valid bits (36-40 is common). The unused
    // high bits are undefined, so every raw value is masked before use and the
    // difference is taken modulo 2^validBits — without that, a session running
    // long enough to wrap the counter starts producing nonsense.
    mask_ = validBits_ >= 64 ? ~0ull : ((1ull << validBits_) - 1ull);

    VkQueryPoolCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
    ci.queryType = VK_QUERY_TYPE_TIMESTAMP;
    ci.queryCount = kMaxFramesInFlight * kGpuMarksPerFrame;
    const VkResult r = vkCreateQueryPool(d.device, &ci, nullptr, &pool_);
    if (r != VK_SUCCESS) {
        std::fprintf(stderr,
                     "[gpu-timer] vkCreateQueryPool failed: %s — per-pass GPU "
                     "timing disabled\n", vk_result_str(r));
        pool_ = VK_NULL_HANDLE;
        supported_ = false;
        return;
    }

    supported_ = true;
    std::fprintf(stderr,
                 "[gpu-timer] on: %u queries, period %.3f ns/tick, %u valid "
                 "bits, %u-frame readback latency\n",
                 ci.queryCount, periodNs_, validBits_,
                 static_cast<unsigned>(kMaxFramesInFlight));
}

void GpuTimer::destroy() {
    if (pool_ && dev_) vkDestroyQueryPool(dev_->device, pool_, nullptr);
    pool_ = VK_NULL_HANDLE;
    supported_ = false;
    dev_ = nullptr;
}

void GpuTimer::frame_begin(VkCommandBuffer cmd, std::uint32_t frameIndex) {
    active_ = frameIndex;
    if (!supported_) return;
    const std::uint32_t base = frameIndex * kGpuMarksPerFrame;
    // Query results are undefined until reset, and a reset is illegal inside a
    // render pass instance — which is why this is a separate call the renderer
    // makes between vkBeginCommandBuffer and vkCmdBeginRenderPass rather than
    // something a pass could do for itself.
    vkCmdResetQueryPool(cmd, pool_, base, kGpuMarksPerFrame);
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, pool_, base);
}

void GpuTimer::pass_begin(VkCommandBuffer cmd, GpuPass p) {
    if (!supported_) return;
    const std::uint32_t base = active_ * kGpuMarksPerFrame;
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, pool_,
                        base + 1 + 2 * static_cast<std::uint32_t>(p));
}

void GpuTimer::pass_end(VkCommandBuffer cmd, GpuPass p) {
    if (!supported_) return;
    const std::uint32_t base = active_ * kGpuMarksPerFrame;
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, pool_,
                        base + 2 + 2 * static_cast<std::uint32_t>(p));
}

void GpuTimer::frame_end(VkCommandBuffer cmd) {
    if (!supported_) return;
    const std::uint32_t base = active_ * kGpuMarksPerFrame;
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, pool_,
                        base + kGpuMarksPerFrame - 1);
}

void GpuTimer::frame_submitted() {
    if (supported_) pending_[active_] = true;
}

// Read back one frame slot's timestamps.
//
// THE LATENCY, and why it is exactly kMaxFramesInFlight frames. The renderer
// waits on inFlight[slot] at the top of every frame before it reuses that
// slot's command buffer. With kMaxFramesInFlight == 2, the submission that fence
// belongs to is the one from TWO frames ago, so at the moment that wait returns,
// frame N-2's timestamps are guaranteed written and available — and the wait is
// one the renderer performs anyway to recycle the command buffer, so reading
// here costs nothing extra. That is the whole point: any shorter latency means
// blocking on GPU work that is still in flight, which serialises the pipeline
// and inflates the number being measured. Hence the call site is immediately
// after that fence wait and immediately before frame_begin() resets the same
// range. Shorten the latency and the measurement corrupts itself; lengthen it
// and the HUD lags for no gain.
void GpuTimer::collect(std::uint32_t frameIndex) {
    if (!supported_ || !pending_[frameIndex]) return;
    pending_[frameIndex] = false;

    const std::uint32_t base = frameIndex * kGpuMarksPerFrame;
    std::uint64_t raw[kGpuMarksPerFrame] = {};
    // No WAIT bit on purpose. The fence already guarantees availability, and
    // VK_QUERY_RESULT_WAIT_BIT on a range that was reset but never written
    // (a frame abandoned between begin and submit) would hang forever.
    const VkResult r = vkGetQueryPoolResults(
        dev_->device, pool_, base, kGpuMarksPerFrame, sizeof(raw), raw,
        sizeof(std::uint64_t), VK_QUERY_RESULT_64_BIT);
    if (r != VK_SUCCESS) return; // VK_NOT_READY: drop the sample, never stall

    for (std::uint32_t i = 0; i < kGpuMarksPerFrame; ++i) raw[i] &= mask_;

    float ms[kChannels];
    for (std::uint32_t p = 0; p < kGpuPassCount; ++p) {
        // Masked subtraction, so a counter that wrapped mid-frame still yields
        // the correct interval.
        ms[p] = ticks_to_ms((raw[2 + 2 * p] - raw[1 + 2 * p]) & mask_);
    }
    ms[kGpuPassCount] =
        ticks_to_ms((raw[kGpuMarksPerFrame - 1] - raw[0]) & mask_);
    push_sample(ms);
}

// Smoothing: MEDIAN over a 31-frame window, not a running average.
//
// A single frame's GPU time is genuinely noisy — the driver and the compositor
// preempt, another process takes the GPU, a shader cache warms — and that noise
// is one-sided: it only ever makes a frame slower. A mean (or an exponential
// average) folds a single 40 ms hitch into the reported figure and then takes
// tens of frames to shed it, so the HUD reads high right after any hiccup and
// the reader cannot tell a spike from a regression. A median discards outliers
// outright: it takes 16 slow frames out of 31 to move it, which no transient
// does. 31 frames is ~0.5 s at 60 Hz — long enough to be steady on screen,
// short enough that a shader edit shows up as soon as the window is looked at.
void GpuTimer::push_sample(const float ms[kChannels]) {
    for (std::uint32_t c = 0; c < kChannels; ++c) ring_[c][ringHead_] = ms[c];
    ringHead_ = (ringHead_ + 1) % kGpuTimerWindow;
    if (ringCount_ < kGpuTimerWindow) ++ringCount_;
    for (std::uint32_t c = 0; c < kChannels; ++c)
        smoothed_[c] = median_of(ring_[c], ringCount_);
}

} // namespace giga::gpu

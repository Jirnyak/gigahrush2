# Render-layer performance audit — 2026-07-29

**Every number in this file that is not a byte count, an instance count or a
quotation from an existing document is STATIC REASONING, not a measurement.** The
author could not run the binary (no build ownership, and the app needs a window
and a GPU). Byte counts and loop-iteration counts are arithmetic over the source
and are as reliable as the source; anything phrased as "expected" is a guess with
its basis stated. The two measured figures quoted below (28.6 ms rebuild,
717,638 instances / 8.0 ms world pass) are pre-existing repository claims from
[performance.md](../performance.md) and
[src/render/cube_merge.h](../src/render/cube_merge.h), reproduced, not re-verified.

Scope: all 21 files of `src/render/` plus the render section of
`src/app/main.cpp`, read complete.

---

## 0. Headline: the per-frame render path is already lean. The cost is a cache
##    invalidation policy and a measurement blind spot.

Counted from source, per frame, steady state:

| quantity | count | evidence |
|---|---|---|
| command buffers | **1** | `cmd[currentFrame]`, [vk_renderer.cpp:251](../src/render/vk_renderer.cpp) |
| render pass instances | **1** | `begin_render_pass`, [vk_renderer.cpp:276](../src/render/vk_renderer.cpp) |
| subpasses | **1** | `ci.subpassCount = 1`, [vk_renderer.cpp:101](../src/render/vk_renderer.cpp) |
| explicit `vkCmdPipelineBarrier` | **0** | only in the capture branch, [vk_renderer.cpp:318](../src/render/vk_renderer.cpp) and [:334](../src/render/vk_renderer.cpp) |
| subpass dependencies | **1** | `EXTERNAL -> 0`, [vk_renderer.cpp:85-94](../src/render/vk_renderer.cpp) |
| descriptor sets bound by our passes | **0** | both pipeline layouts declare push constants only — `lci.setLayoutCount` is left 0, [cube_pass.cpp:388](../src/render/cube_pass.cpp), [body_pass.cpp:201](../src/render/body_pass.cpp) |
| pipeline binds | **3** | cube, body, ImGui |
| push-constant uploads | **2** x 128 B | [cube_pass.cpp:541](../src/render/cube_pass.cpp), [body_pass.cpp:273](../src/render/body_pass.cpp) |
| `vkCmdDraw` from our passes | **2** | instanced |
| timestamp writes | **8** + 1 pool reset | `kGpuMarksPerFrame = 2 + 2*3`, [gpu_timer.h:75](../src/render/gpu_timer.h) |
| heap allocations on the render path | **0** | see §5 |

There is no low-hanging Vulkan fruit here. No barrier is over-broad, no
descriptor set is rebound, nothing is re-uploaded that did not change **in the
default `FloorStack` mode**, and the query readback does not stall (§4). Items
1 and 2 below are where the actual time is.

---

## 1. `invalidate()` throws away the geometry classification when only COLOUR changed
### rank 1 — biggest win, demonstrable from the code, NOT in this lane's files

**File:** [src/render/cube_pass.cpp:421-424](../src/render/cube_pass.cpp) —
`CubePass::invalidate()`.

```cpp
void CubePass::invalidate() {
    for (int i = 0; i < kMaxFramesInFlight; ++i) dirty_[i] = true;
    classValid_ = false;          // <-- this line is the cost
}
```

**Mechanism.** `cellClass_` is a pure function of two things and only two things:
the sub-voxel masks `g.masks()` and the cell types `g.types()`
([cube_pass.cpp:434-451](../src/render/cube_pass.cpp)). A fluid step touches
*neither*. Fluid enters the pass exactly twice, both times as **colour**: `tint()`
at [cube_pass.cpp:476-483](../src/render/cube_pass.cpp) and the lerp in `emit()`
at [:496-501](../src/render/cube_pass.cpp) (plus `same_colour` as a merge
predicate, [:481](../src/render/cube_pass.cpp)). The comment at
[cube_pass.cpp:502-505](../src/render/cube_pass.cpp) states the invariant
explicitly: *"The fluid tint above deliberately does NOT change the surface
family."* So on a fluid step the 8 MB classification is still exactly correct,
and `classValid_ = false` discards it anyway.

What that discard costs, per invalidation, counted from the loops:

- `build_occ_bits` ([cube_pass.cpp:175-186](../src/render/cube_pass.cpp)) reads
  `g.masks()` — `kMacroCells` = 2,097,152 entries x 64 B = **134,217,728 bytes**,
  sequentially.
- the `classify` triple loop ([:439-449](../src/render/cube_pass.cpp)) runs
  2,097,152 iterations; each surface cell additionally runs `ao_mask`, which is 27
  iterations of which 20 call `neighbour_index` -> 3 x `wrap_macro`
  ([:205-215](../src/render/cube_pass.cpp)). That is 60 modulo-ish wraps and 20
  scattered bit reads per surface cell.
- two `std::vector` allocations of `kClaimWords` x 8 B = **262,144 bytes** each,
  because `OccBits occ` is a *local* at [cube_pass.cpp:436](../src/render/cube_pass.cpp)
  while `cellClass_`/`claimed_` are members allocated once in `init()`
  ([:266-267](../src/render/cube_pass.cpp)). The header claims the rebuild scratch
  is "allocated once in init(), never in a frame"
  ([cube_pass.h:176-186](../src/render/cube_pass.h)); `OccBits` is the exception
  to that claim.

`merge_surface_runs` must still re-run (the colour genuinely changed and merge
runs depend on colour), so the win is the classify half, not the whole rebuild.

**Fix (for the lead — `cube_pass.*` belongs to the texture lane this wave):** split
the invalidation into two levels.

```cpp
void CubePass::invalidate() {          // geometry changed
    for (int i = 0; i < kMaxFramesInFlight; ++i) dirty_[i] = true;
    classValid_ = false;
}
void CubePass::invalidate_colours() {  // only per-cell colour changed
    for (int i = 0; i < kMaxFramesInFlight; ++i) dirty_[i] = true;
}
```

and call `invalidate_colours()` from the fluid site
([main.cpp:1362](../src/app/main.cpp)) while the two ride sites
([main.cpp:822](../src/app/main.cpp), [main.cpp:1816](../src/app/main.cpp)) keep
the full `invalidate()`. Both ride sites are genuine geometry changes — the
streamer recycles `World` objects in place, so identity cannot detect them
([cube_pass.cpp:519-522](../src/render/cube_pass.cpp)) — and both are necessary.
**All three current callers are correct; one is simply stronger than it needs to
be.**

**Expected magnitude: GUESS, with a stated basis.** performance.md records a full
rebuild at **28.6 ms** for 717,638 instances. This change removes the classify
sweep from that, not the merge. The classify sweep is the half that touches
134 MB while the merge re-reads an 8 MB array, so on a bandwidth argument alone
the classify is the larger half — but the merge does 3-axis probing with a
predicate call per step, so it is not obviously the smaller half in instruction
count. **I would not put a number on the split without a profiler.** Direction of
the change is certain; magnitude is not.

**Risk: low, but not zero.** The correctness condition is exactly "no caller of
`invalidate_colours()` may change masks or types". Fluid satisfies it today. A
future fluid that carves cells would not, and the failure mode is stale AO/material
on the flooded cells — visible, not corrupting.

---

## 2. The fluid invalidation is not "regular", it is ~31 Hz — the cache is DEFEATED in maze mode
### rank 2 — the brief asked me to verify this claim; it is literally true and materially misleading

The claim under audit, [main.cpp:1359-1361](../src/app/main.cpp):

> *"Fluid tints cell colours, so the cached instance list is stale. This is the
> one place the cache rebuilds regularly — and only in maze mode, where fluid
> exists."*

**Verdict: accurate as written, misleading as read.** "the one place" is correct —
the three `invalidate()` callers are the two floor rides and this. "regularly" is
doing a lot of work, and the arithmetic is:

- `fluidStepEvery = 4` sim steps ([main.cpp:704](../src/app/main.cpp)),
- `kSimHz = 125`, so the fluid steps **31.25 times per second**
  ([main.cpp:1355-1363](../src/app/main.cpp)),
- render is FIFO-vsynced at 60 Hz (§3), and `invalidate()` dirties **both** frame
  slots while `record()` clears only the current one
  ([cube_pass.cpp:422](../src/render/cube_pass.cpp) vs
  [:534](../src/render/cube_pass.cpp)).

At 31 invalidations against 60 frames, **roughly every frame finds its slot
dirty**. In maze mode the instance cache — the change performance.md credits with
43.6 ms -> 16.3 ms — is doing approximately nothing. The slider
([main.cpp:1691](../src/app/main.cpp)) goes down to 1, i.e. 125 Hz, which is
strictly worse.

**This is a test-bed-only path.** The default is `WorldGenMode::FloorStack`
([main.cpp:387](../src/app/main.cpp)); maze is opt-in via argv
([main.cpp:403](../src/app/main.cpp)) and the fluid branch is gated on it
([main.cpp:1355](../src/app/main.cpp)). So **the shipping configuration does not
pay this** and performance.md's steady-state claim is not contradicted. But the
maze *is* the fluid test bed, so it is the mode anyone measuring fluid will be
in — and in that mode the cube-pass CPU figure the HUD prints
([main.cpp:1381](../src/app/main.cpp)) is a rebuild cost every frame, not the
0.01 ms performance.md quotes.

**Two independent fixes, both for the lead:**

**(a) Do not invalidate when the fluid did not move.** `fluid_step` is called
unconditionally and `invalidate()` follows it unconditionally
([main.cpp:1357-1362](../src/app/main.cpp)). A settled puddle re-triggers the
entire rebuild forever. Have `fluid_step` return whether any cell changed and gate
the invalidation on it. Expected magnitude on a settled world: the rebuild cost
goes to zero, which is the whole cost. On an actively-moving world: nothing. **The
"did it change" bit is free** — the fluid step already visits every cell it could
change.

**(b) Fix the printf storm.** [cube_pass.cpp:528-534](../src/render/cube_pass.cpp)
does an unbuffered `fprintf(stderr, ...)` per rebuild. At ~31 invalidations x up to
2 slots that is up to **62 unbuffered stderr writes per second** in maze mode.
`stderr` is unbuffered by the C standard, so each is a syscall, and on a Windows
console each is expensive enough to matter at that rate — and it also renders the
log unreadable, which is the worse harm. The comment says "Two lines per
invalidate ..., not per frame"; in maze mode those are the same thing. Suggest
rate-limiting to one line per N ms, or suppressing it while the colour-only path
(§1) is what fired.

---

## 3. FIFO-only present mode makes the CPU side unmeasurable
### rank 3 — the biggest MEASUREMENT win; blocks the rest of this lane's own job

**File:** [src/render/vk_swapchain.cpp:78](../src/render/vk_swapchain.cpp) —
`ci.presentMode = VK_PRESENT_MODE_FIFO_KHR; // vsync; always available`.

There is no way to turn vsync off. [gpu_timer.h:3-12](../src/render/gpu_timer.h)
argues at length — correctly — that *"a value pinned at a cap cannot detect a
change below the cap"*, and that is precisely why the GPU timer exists. The same
argument applies to **CPU** work, and there the GPU timer does not help: nothing
in this build can see a 5 ms CPU saving while FIFO holds the frame at 16.6 ms. The
owner's ask was "squeeze the C++ **and** the Vulkan"; today only the Vulkan half
is observable.

**Fix (drop-in, no helper needed, `vk_swapchain.cpp` is not in this lane's files):**

```cpp
// Present mode. FIFO is the only mode the spec guarantees, and it is the right
// default: it is tear-free and it caps the frame rate. But a frame pinned at the
// vsync period cannot show a CPU saving (the argument gpu_timer.h makes for GPU
// work applies to CPU work, and there the timestamps do not help), so the cap is
// liftable for measurement. GIGA_PRESENT_MODE=immediate|mailbox|fifo, read once.
ci.presentMode = VK_PRESENT_MODE_FIFO_KHR;
if (const char* pm = std::getenv("GIGA_PRESENT_MODE")) {
    VkPresentModeKHR want = VK_PRESENT_MODE_FIFO_KHR;
    if (std::strcmp(pm, "immediate") == 0) want = VK_PRESENT_MODE_IMMEDIATE_KHR;
    else if (std::strcmp(pm, "mailbox") == 0) want = VK_PRESENT_MODE_MAILBOX_KHR;
    std::uint32_t pn = 0;
    vkGetPhysicalDeviceSurfacePresentModesKHR(d.physical, d.surface, &pn, nullptr);
    std::vector<VkPresentModeKHR> avail(pn);
    vkGetPhysicalDeviceSurfacePresentModesKHR(d.physical, d.surface, &pn,
                                              avail.data());
    for (VkPresentModeKHR m : avail)
        if (m == want) { ci.presentMode = want; break; }
    std::fprintf(stderr, "[vk] GIGA_PRESENT_MODE=%s -> present mode %d\n", pm,
                 static_cast<int>(ci.presentMode));
}
```

Needs `#include <cstring>` and `#include <cstdlib>` in that file (`<vector>` is
already there). **Must be queried, never assumed** — only FIFO is guaranteed
present, and requesting an unsupported mode is invalid usage.

**Expected magnitude: zero for the shipped default** (byte-identical path when the
variable is unset), and it is the enabling change for measuring everything else.
**Risk: low.** Tearing when opted in, which is the point.

---

## 4. The GPU timer does NOT stall the frame — verified by reading, no change needed
### rank n/a — a negative result the brief specifically asked for

[gpu_timer.cpp:151-153](../src/render/gpu_timer.cpp) passes
`VK_QUERY_RESULT_64_BIT` and **not** `VK_QUERY_RESULT_WAIT_BIT`, and the readback
sits immediately after the `vkWaitForFences` the renderer performs anyway to
recycle the slot's command buffer ([vk_renderer.cpp:222-230](../src/render/vk_renderer.cpp)).
With `kMaxFramesInFlight == 2` that fence belongs to the submission from two
frames ago, so the data is already written when the wait returns and the read
costs nothing extra. `VK_NOT_READY` drops the sample rather than blocking. **This
is correct as written and I changed none of it.**

One adjacent suspicion I chased and can rule out: the frame-total channel
(`raw[kGpuMarksPerFrame-1] - raw[0]`) does **not** absorb the swapchain acquire
wait. The submission waits on `imageAvailable` at
`VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT`
([vk_renderer.cpp:344](../src/render/vk_renderer.cpp)), and a semaphore wait gates
the named stages *and every stage logically later than them*.
`VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT` — where every mark is written
([gpu_timer.cpp:100](../src/render/gpu_timer.cpp)) — is logically later than
`COLOR_ATTACHMENT_OUTPUT`, so `raw[0]` cannot be stamped before the image is
acquired. `frame_ms` is therefore honest GPU-side frame time and does not inherit
the vsync-pinning defect the module was built to escape. Static spec reasoning,
not a measurement.

What the timer *did* lack is in §6.

---

## 5. No allocation and no map lookup on the per-frame render path
### rank n/a — another negative result, stated because the brief asked

- [vk_renderer.cpp](../src/render/vk_renderer.cpp) `begin_frame`/`end_frame`:
  every Vulkan struct is a stack local; the only `std::vector` members
  (`framebuffers_`, `renderFinished`, `imagesInFlight`) are sized at
  swapchain creation and only indexed per frame.
- [body_pass.cpp:234-280](../src/render/body_pass.cpp) `record()`: writes straight
  into the persistently-mapped buffer, no container touched. The
  `reg.all_of<CameraTag>(e)` probe at [:253](../src/render/body_pass.cpp) is one
  sparse-set lookup per body — at the documented 400-1100 bodies that is not worth
  hoisting, and hoisting it would need the pass to know the camera entity, which
  costs it its independence from the game layer.
- [cube_pass.cpp:540-547](../src/render/cube_pass.cpp) `record()` steady state:
  bind, push, bind, draw. Nothing else.
- The two allocation/lookup sites inside the render passes are both
  **rebuild-only, not per-frame**: `OccBits`'s two 256 KB vectors (§1) and the
  string-keyed `fields().find<float>("fluid")` at
  [cube_pass.cpp:466-467](../src/render/cube_pass.cpp), which is a `std::map`
  lookup on a `std::string` key ([field.h:86](../src/world/field.h)). Both cost
  nothing at 60 Hz in `FloorStack` mode and both fire ~31 times a second in maze
  mode (§2). Hoisting the field pointer is a 3-line change in `cube_pass.cpp` if
  the lead is in there anyway; it is not worth a visit of its own.

**The one genuinely dead per-frame map lookup is in `main.cpp`, not in the
renderer**, and the compiler already knows:

```
main.cpp(934): warning C4189: 'danger':      local variable is initialised but not referenced
main.cpp(935): warning C4189: 'activeGrid':  local variable is initialised but not referenced
```

[main.cpp:933-935](../src/app/main.cpp) fetches `activeWorld.fields().find<float>("danger")`
once per frame — a `std::map` traversal with `std::string` compares — and nothing
consumes it. `activeGrid` is a reference bind and free; `danger` is not. The
comment above it still describes a consumer ("The embodied AI steers against the
live floor's baked danger field"), so this is almost certainly a *live* casualty of
the concurrent AI/diffusion lane rather than old rot, and the fix is to restore the
consumer or delete the fetch — not to silence the warning. Flagging it because
`/W4` makes it a warning in the real build and AGENTS.md §Build requires zero
warnings; **it is not caused by anything in this lane's diff** (which is confined
to `gpu_timer.*`, `vk_buffer.*`, `vk_common.*`, none of which `danger` touches).
Observed by compiling `src/app/main.cpp` with the flags CMake recorded; the two
warnings are the only ones that TU emits.

---

## 6. The instrument could not answer three questions it is now asked
### rank 4 — implemented in this lane, `src/render/gpu_timer.{h,cpp}`

Not a speed win. This is the "make the instrument good enough to answer" half of
the lane, and each item is a hole a perf session falls into.

**(a) The reported statistic is a median, and a median is designed to hide
spikes.** [gpu_timer.cpp:213-228](../src/render/gpu_timer.cpp) explains why, and
the reasoning is right for a steady-state readout: *"it takes 16 slow frames out
of 31 to move it."* But that also means a regression that costs 5 ms on one frame
in six is **invisible** — and a stutter is exactly the kind of regression a
geometry or upload change introduces. Added `pass_ms_max()` / `frame_ms_max()`,
the maximum over the same 31-frame window. **Cost: zero.** The window is already
insertion-sorted to find the median, so the maximum is the last element of a
buffer that has already been sorted.

**(b) Dropped samples were silent.** `collect()` returned on any non-`VK_SUCCESS`
and the sample was gone with no trace
([gpu_timer.cpp:191-198](../src/render/gpu_timer.cpp)). If that happens often the
displayed median is computed over an old window and the reader cannot tell.
Added a `dropped()` counter. A non-zero, *growing* value means the numbers on
screen are stale — which is a thing you must be able to see before you trust a
0.05 ms delta.

**(c) The timer had no off switch.** 8 `vkCmdWriteTimestamp` plus one
`vkCmdResetQueryPool` are recorded unconditionally every frame, and a
`BOTTOM_OF_PIPE` timestamp is an ordering point the driver must honour. Whether
that costs anything on this hardware is **unknown and was unmeasurable**, because
there was no way to build the same binary without it. Added `GIGA_GPU_TIMER=0`,
read once at `init()`, following the house pattern `GIGA_CUBE_MAXRUN` set at
[cube_pass.cpp:275](../src/render/cube_pass.cpp) — same-binary A/B, so no rebuild
sits between the two numbers. **My honest expectation is that it costs
approximately nothing on NVIDIA and is worth checking anyway, once, so the
question is closed rather than assumed.**

**(a) and (b) ARE NOT WIRED YET — read this before quoting §6 as done.** Verified
by `rg`: `pass_ms_max()`, `frame_ms_max()` and `dropped()` have **zero callers in
the tree**. The values are computed correctly every frame and no line of output
anywhere displays them, so today they are reachable only from a debugger. Both
display sites are in `src/app/main.cpp`, which this lane may not edit — the HUD
`ImGui::Text` at [main.cpp:1393-1398](../src/app/main.cpp) and the `--shot`
stderr line at [main.cpp:1849-1857](../src/app/main.cpp). Until the lead applies
those two edits, §6(a) and §6(b) are *instrument capability*, not *instrument
output*, and the only part of §6 an operator can actually observe is (c), which
prints its own line at `init()`. Stated here rather than left implied, because a
counter nobody can read is the same failure as a module nobody calls.

---

## 7. `find_mem` could bind the wrong memory type and report success
### rank 5 — a latent correctness bug, not a perf win; fixed in this lane

**File:** [src/render/vk_buffer.cpp](../src/render/vk_buffer.cpp), `find_mem`.

It returned `0` when no memory type matched the requested properties — and 0 is
also a perfectly valid type index, so the caller could not tell. `make_buffer` fed
it straight to `vkAllocateMemory`, which succeeds, `vkBindBufferMemory` succeeds,
and `create_device_local` returns **true** having bound memory with the wrong
properties. `create_host_visible` would then fail one line later at `vkMapMemory`
with no useful message. The sibling helper `find_memory` in
[screenshot.cpp:108-117](../src/render/screenshot.cpp) already gets this right —
it returns `UINT32_MAX` and the caller checks. Made the two agree, and the failure
now names the properties it could not satisfy.

Not hot: `vkGetPhysicalDeviceMemoryProperties` is queried once per buffer
creation, and there are 8 buffer creations in the whole process
(2 meshes x 2 buffers each for the staging pair, plus 4 instance buffers). Caching
it would be measuring nothing. **Explicitly not "optimised".**

---

## 8. 132.5 MB of host-visible memory is allocated at boot and its placement was invisible
### rank 6 — visibility added in this lane; the sizing decision belongs to the lead

Arithmetic, not measurement:

| buffer | count | bytes each | total |
|---|---|---|---|
| cube instances, `kMacroCells` x `sizeof(CubeInstance)` = 2,097,152 x 32 | 2 slots | 67,108,864 | **128 MiB** |
| body instances, `kMaxBodies` x `sizeof(BodyInstance)` = 65,536 x 36 | 2 slots | 2,359,296 | **4.5 MiB** |
| cube + body meshes, 36 x 24 B | 2 | 864 | 1.7 KiB |

Sources: [cube_pass.cpp:256-262](../src/render/cube_pass.cpp),
[body_pass.cpp:21](../src/render/body_pass.cpp) and
[:88-94](../src/render/body_pass.cpp), the `sizeof(CubeInstance) == 32`
static_assert at [cube_pass.h:95](../src/render/cube_pass.h).

Against that, the largest instance count this repository has ever recorded is
**717,638** ([cube_merge.h:6-7](../src/render/cube_merge.h)) — 23 MB, i.e. the
allocation is 2.9x the measured worst case, **and that figure predates run
merging**, which cut it further. The comment says sizing for the worst case means
the buffer "never reallocates mid-run"
([cube_pass.cpp:253-255](../src/render/cube_pass.cpp)), which is a good reason;
whether it needs the *absolute* worst case (one instance per cell, which requires
every cell to be a non-mergeable surface cell — geometrically impossible, since a
surface cell needs a non-solid neighbour) is a judgement call for the lead.

Why it might matter beyond RAM: `create_host_visible` takes the **first** memory
type with `HOST_VISIBLE | HOST_COHERENT`
([vk_buffer.cpp:16-20](../src/render/vk_buffer.cpp)). On a resizable-BAR system
that can be a `DEVICE_LOCAL | HOST_VISIBLE` type, in which case those 128 MiB come
out of a 6 GB VRAM budget and every instance write crosses PCIe. It can equally be
plain system RAM, in which case the GPU reads it over PCIe instead. **Which one
happens on this machine was not discoverable from the logs at all.** I added a
one-line-per-buffer boot log naming the chosen memory type index, its property
flags and its heap size, so the question is answerable by reading stderr.

**I deliberately did not change the selection heuristic.** Which placement is
faster depends on the CPU-write to GPU-read ratio for this specific access
pattern, that is a measurement I cannot make, and silently moving 128 MiB between
heaps is exactly the kind of change that regresses on someone else's hardware. If
the lead wants the A/B after reading the log, the smallest honest version is a
preference argument on `create_host_visible` plus an env knob at the two call
sites — 15 lines, and it should be written *after* the log has been read, not
before.

---

## 9. Things I looked at and found already correct — do not "fix" these
### rank n/a

- **Depth attachment `storeOp = DONT_CARE`** ([vk_renderer.cpp:69](../src/render/vk_renderer.cpp)).
  Correct and already the cheap choice: nothing reads depth after the pass, so the
  tile store is skipped. Do not change it to STORE for a screenshot; the capture
  copies colour only.
- **The subpass dependency is minimal.** `srcAccessMask = 0`
  ([vk_renderer.cpp:92](../src/render/vk_renderer.cpp)) makes it an
  execution-only dependency, which is the correct minimal form for "wait for the
  previous user of this image". Broadening it to `ALL_COMMANDS`/`MEMORY_READ`
  would be a real regression; narrowing it further is not possible.
- **The capture-path barriers are tight**: exact subresource range (1 mip,
  1 layer), `COLOR_ATTACHMENT_OUTPUT -> TRANSFER` then
  `TRANSFER -> BOTTOM_OF_PIPE` with `dstAccessMask = 0` because the present
  semaphore carries the rest ([vk_renderer.cpp:307-337](../src/render/vk_renderer.cpp)).
  They also fire once per process, not per frame.
- **`kMaxFramesInFlight = 2`** ([vk_common.h:18](../src/render/vk_common.h)). Under
  FIFO, raising it to 3 buys throughput the vsync cap will not let you have and
  costs a frame of input latency. It is also the divisor the GPU timer's readback
  latency is derived from ([gpu_timer.cpp:165-178](../src/render/gpu_timer.cpp)),
  so changing it is not local.
- **Instance origins are absolute, with the toroidal shift in `cube.vert`.** This
  is what makes the cache possible at all
  ([cube_pass.h:44-48](../src/render/cube_pass.h)). Any change that reintroduces
  the camera into instance data destroys §1 and §2 along with it.
- **Median-over-31 as the *displayed* statistic.** Right call, kept; §6(a) adds a
  companion, it does not replace it.

---

## 10. Where I would look next, with no code to show for it
### honest dead ends and unfinished threads

- **`cube.frag` is not the cost and the repo already knows it.** Deleting the
  entire procedural surface layer moved the world pass **+0.05 ms**
  ([cube_merge.h:6-9](../src/render/cube_merge.h)). The pass is geometry-bound at
  717,638 instances x 36 vertices = 25.8 M vertices. **The concurrent texture lane
  is adding fragment work to a pass that has fragment headroom, which is the right
  place to spend it** — but it will also add a descriptor set to a pipeline that
  currently binds zero (§0), and that is the thing to watch, not the shader maths.
- **The remaining geometry win is a real mesher, not a bigger run cap.**
  `kMaxRunCells = 8` is a toroidal-seam budget with the trade-off worked out
  ([cube_merge.h:61-73](../src/render/cube_merge.h)); raising it trades visible
  artefacts for vertices. The 1-D run merge leaves the second and third dimension
  on the table — a 2-D greedy quad mesher on the six face directions would cut
  vertices again, and *also* cut them by not emitting the five hidden faces of
  every box. That is architectural, it is the lead's call, and it is the only
  remaining large lever on the world pass.
- **`vkCmdDraw` with 717,638 instances x 36 vertices, no index buffer.** An
  indexed cube (24 unique vertices, 36 indices) would cut vertex *fetch* by a
  third; whether it cuts vertex *shading* depends on post-transform cache
  behaviour with per-instance attributes, which I cannot predict and would not
  guess at. Cheap to test, in `cube_pass.cpp`, not this lane's file.
- **Nothing in `src/render/` is threaded.** One command buffer on one thread. With
  a single render pass and two draws there is nothing to parallelise; the
  parallelism opportunity is the *rebuild* (§1), which is a 2 M-cell sweep that
  would shard cleanly by z-slab. That is a `cube_pass.cpp` change and it should
  come after §1 and §2(a), which may make it unnecessary.

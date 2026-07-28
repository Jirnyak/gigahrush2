#include "game/ai.h"

#include <cstddef>

#include "game/embody.h"   // NpcRef — the embodied identity back to the pool row
#include "game/npc_pool.h" // NpcPool::attrs (STR/AGI/INT reserve scaling)

namespace giga::game {

namespace {

// Clamp a reserve back into its band after decay. A reserve only decreases, so
// only the floor can bite, but clamp both ends for safety (cheap, predictable).
constexpr float clamp_need(float x) {
    if (x < kNeedMin) return kNeedMin;
    if (x > kNeedMax) return kNeedMax;
    return x;
}

// Digest up to `amount` from a pending pool into its pressure need, clamped at
// kNeedMax — the reference's `dp = min(pending, rate*dt); need += dp; pending -=
// dp`. Pressures rise ONLY while their pool is non-empty, so a fresh gut (empty
// pool) holds pee/poo flat until the eat intent (#12b) fills it.
inline void digest(float& level, float& pending, float amount) {
    if (pending <= 0.0f || amount <= 0.0f) return;
    const float dp = pending < amount ? pending : amount;
    level += dp;
    if (level > kNeedMax) level = kNeedMax;
    pending -= dp;
}

} // namespace

void needs_step(Registry& reg, NpcPool& pool, float dt) {
    // One linear pass over the packed (NpcRef, Needs) columns ([ai.md]
    // §Data-oriented): EnTT stores each component contiguously, so this is a
    // straight sweep of memory — no per-object dispatch, no search.
    auto view = reg.view<NpcRef, Needs>();
    for (auto e : view) {
        const NpcId id = view.get<NpcRef>(e).id;
        auto& needs = view.get<Needs>(e);
        const auto& attrs = pool.attrs(id);

        // Reserves decay unconditionally, each slowed by its governing attribute:
        // rate /= (1 + perPoint * stat) (reference needs.ts: STR slows food, AGI
        // water, INT sleep). A zeroed stat leaves the base rate untouched.
        for (std::uint8_t n = 0; n < kFirstPressure; ++n) {
            float rate = kNeedRatePerSec[n];
            const int slot = kNeedAttrSlot[n];
            if (slot >= 0) {
                const float stat =
                    static_cast<float>(attrs[static_cast<std::size_t>(slot)]);
                rate /= (1.0f + kNeedAttrPerPoint * stat);
            }
            needs.v[n] = clamp_need(needs.v[n] - rate * dt);
        }

        // Pressures rise ONLY by digesting their pending pool (attribute-neutral,
        // per the reference). Empty pools hold pee/poo flat until something eats.
        digest(needs.v[NeedPee], needs.pendingPee, kNeedRatePerSec[NeedPee] * dt);
        digest(needs.v[NeedPoo], needs.pendingPoo, kNeedRatePerSec[NeedPoo] * dt);
    }
}

} // namespace giga::game

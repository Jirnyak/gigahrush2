// Floor streaming — keep only ONE floor's World + population live at a time, and
// fold everyone else into the cold NpcPool ([npcs.md], master_prompt #9).
//
// A giant building is 2^20 people across a deep stack of floors, but only a
// handful of them can be live ECS entities at once (the sim tick is O(n) in
// LIVE entities — performance.md). So a floor is *streamed*:
//   * ENTER a floor  = allocate a physical LevelStack slot, generate_floor its
//     geometry into it (deterministic — floor_gen.h — so nothing is persisted),
//     and embody its crowd of cold records as ECS entities.
//   * LEAVE a floor  = fold every embodied body back into its cold pool record
//     (position/state persist in the row), free the physical slot, and evict it.
//
// The load-bearing subtlety (master_prompt #9): re-entering a floor must
// re-embody the SAME records, never seed new ones — otherwise the population
// grows every visit. Each module therefore seeds its crowd exactly ONCE into a
// contiguous pool id range [firstId, firstId+count); every later load
// re-embodies that same range, whose positions were frozen back on the way out.
//
// FloorRegistry owns the number <-> module <-> layer indirection; this owns the
// module *content* (how to build it, and the cold crowd it re-materializes) plus
// a small pool of recyclable physical layers. Pure game-layer logic over
// LevelStack + FloorRegistry + Registry + NpcPool: no SDL/Vulkan, headless-tested.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "ecs/registry.h"        // giga::Registry, giga::Entity, entt::null
#include "game/elevator.h"       // giga::game::RideResult, ride_elevator
#include "game/floor_registry.h" // giga::game::FloorRegistry, ModuleId
#include "game/floor_spec.h"     // giga::game::FloorKind
#include "game/npc_pool.h"       // giga::game::NpcPool, NpcId
#include "world/level_stack.h"   // giga::LevelStack, LayerId
#include "world/nav.h"           // giga::nav::CoarseGraph, FineNav

namespace giga::game {

// The baked navigation for one live floor: the coarse next-hop graph (L1) and
// the 64 per-node flow fields + nearest-node field (L2). Baked once when a floor
// is streamed in (ensure_loaded) from its freshly regenerated geometry, and
// freed when it is evicted, so nav is resident ONLY for live floors (~130 MiB
// each — performance.md "bake at load, tick in O(1)"; RAM is the generous
// budget, the tick is the scarce one). The movement AI (#12) steers by querying
// this with nav::route_step — no per-agent search on the tick.
struct FloorNav {
    nav::CoarseGraph coarse;
    nav::FineNav fine;
};

// Per-module streaming content, one entry per ModuleId. The FloorRegistry holds
// the (mutable) number label and the (streamed) residency; this holds the fixed
// recipe for the module plus the cold crowd it owns.
struct FloorModule {
    bool used = false;                    // a real module was registered here
    int number = FloorRegistry::kNoFloor; // logical label (drives gen + seed)
    FloorKind kind = FloorKind::Residential;
    std::uint32_t seed = 0;               // base seed; geometry + population derive

    // The cold crowd: the contiguous pool id range this module seeded ONCE. Every
    // load re-embodies exactly this range, so population never grows per visit.
    bool seeded = false;
    NpcId firstId = kInvalidNpc;
    std::uint32_t count = 0;
    NpcId candidate = kInvalidNpc;        // the seed's player-candidate record

    // Live set while loaded (empty when cold): the entities embodied for this
    // module, so unload folds exactly them back.
    std::vector<Entity> bodies;
};

// Result of a load: the resident layer, and — only when this load embodied the
// player (the first ever load, before any player exists) — that new entity.
struct LoadResult {
    LayerId layer = kInvalidLayer;
    Entity player = entt::null; // non-null only when this call created the player
};

class FloorStreamer {
public:
    // Reserve the recyclable physical layers this streamer will cycle floors
    // through. Peak residency during a ride is 2*keepRadius + 2 (the kept window
    // plus the just-loaded destination before the trailing floor is pruned), so
    // exactly that many layers are pushed onto `stack`. Call once, before use.
    void init(LevelStack& stack, int keepRadius = 0);

    // Opt in to on-disk nav memoization (C.2b): baked nav is read from / written
    // to `dir` keyed on each floor's (number, kind, seed). Empty (the default)
    // disables it — every load bakes from scratch. Set once, before loading.
    void set_nav_cache_dir(const std::string& dir) { navCacheDir_ = dir; }

    // Register a floor module: assign `number -> module` in `reg` and record how
    // to build it. Does NOT load it. Returns the new ModuleId, or kInvalidModule
    // if the module table is full.
    ModuleId add_module(FloorRegistry& reg, int number, FloorKind kind,
                        std::uint32_t seed);

    // Load floor `number` if it is cold: allocate a physical layer, generate its
    // geometry, mark it resident, and embody its crowd (seeding the crowd once on
    // the first ever load). Records already embodied — e.g. the player standing on
    // another floor — are skipped, so no one is duplicated. When `playerId` is
    // kInvalidNpc this designates the module's candidate as the player, embodies
    // it with a camera, and writes it back through `playerId` (+ LoadResult).
    // No-op returning the existing layer if already loaded; kInvalidLayer if
    // `number` maps to no registered module.
    LoadResult ensure_loaded(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                             NpcPool& pool, int number, NpcId& playerId);

    // Unload floor `number`: fold every embodied body back into the cold pool
    // (positions persist), free its physical layer, and evict it from `reg`.
    // No-op if the floor is not loaded.
    void unload(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                NpcPool& pool, int number);

    // Unload every loaded floor outside [activeNumber - radius, activeNumber +
    // radius], so at rest only the kept window stays live. Never unloads the
    // active floor.
    void keep_only(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                   NpcPool& pool, int activeNumber);

    // Ride from `fromFloor` by `dir` (+1 up / -1 down), loading the destination on
    // demand first, then folding the departed crowd (keep_only). Wraps
    // ride_elevator, and adopts its freshly-embodied player body into the
    // destination module so a later unload folds it correctly. Returns a no-op
    // RideResult if the destination floor maps to no registered module.
    RideResult travel(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                      NpcPool& pool, Entity player, int fromFloor, int dir,
                      std::uint8_t arrivalZ, NpcId& playerId);

    // True when floor `number` currently has a resident layer.
    bool loaded(const FloorRegistry& reg, int number) const {
        return reg.layer_at(number) != kInvalidLayer;
    }

    // The baked navigation for floor `number`, or nullptr when that floor is not
    // currently resident (nav lives only while the floor is loaded — ensure_loaded
    // bakes it, unload frees it). The pointer stays valid until `number` unloads.
    const FloorNav* nav_at(const FloorRegistry& reg, int number) const;

    int keep_radius() const { return keepRadius_; }

private:
    // Population uses a seed offset from the geometry seed so a floor's crowd
    // layout and its walls don't correlate.
    static constexpr std::uint32_t kPopSeedSalt = 0x51ed270bu;

    LayerId alloc_slot();
    void free_slot(LayerId slot);

    // Embody a module's cold crowd onto `layer`. See ensure_loaded for the
    // player-designation and skip-already-embodied rules.
    void embody_crowd(Registry& ecs, NpcPool& pool, FloorModule& fm, LayerId layer,
                      NpcId& playerId, Entity& outPlayer);

    FloorModule modules_[kMaxModules];
    // Per-module baked nav, resident only while the module is loaded. Heap-held
    // because each FineNav is ~130 MiB — keeping them out of line keeps the
    // FloorStreamer object (a stack local in app + tests) tiny. ensure_loaded
    // bakes into nav_[m]; unload resets it back to null.
    std::unique_ptr<FloorNav> nav_[kMaxModules];
    ModuleId next_ = 0; // bump allocator for ModuleId
    std::vector<LayerId> freeSlots_;
    int keepRadius_ = 0;
    std::string navCacheDir_; // empty = on-disk nav cache disabled
};

} // namespace giga::game

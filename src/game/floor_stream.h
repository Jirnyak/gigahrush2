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
// re-embody records, never seed new ones — otherwise the population grows every
// visit. Each module therefore seeds its crowd exactly ONCE, labelling every
// seeded record with the floor's number; every later load re-embodies whoever is
// CURRENTLY labelled with that number (pool.floor_bucket — the per-floor index in
// npc_pool.h), whose positions were frozen back on the way out. Keying on the
// live label rather than a frozen id range is what lets the macro sim migrate a
// resident between floors (master_prompt #10b) and have the destination
// re-embody them on arrival.
//
// FloorRegistry owns the number <-> module <-> layer indirection; this owns the
// module *content* (how to build it, and the cold crowd it re-materializes) plus
// a small pool of recyclable physical layers. Pure game-layer logic over
// LevelStack + FloorRegistry + Registry + NpcPool: no SDL/Vulkan, headless-tested.
#pragma once

#include <cstdint>
#include <functional>   // std::function — the floor-restore hook
#include <memory>
#include <string>
#include <vector>

#include "ecs/registry.h"        // giga::Registry, giga::Entity, entt::null
#include "game/elevator.h"       // giga::game::RideResult, ride_elevator
#include "game/floor_registry.h" // giga::game::FloorRegistry, ModuleId
#include "game/floor_spec.h"     // giga::game::FloorKind
#include "game/nav_cache.h"      // giga::game::MultiFloorNavCache
#include "game/npc_pool.h"       // giga::game::NpcPool, NpcId
#include "world/level_stack.h"   // giga::LevelStack, LayerId
#include "world/nav.h"           // giga::nav::CoarseGraph, FineNav, VerticalWaypointLink
#include "game/antourage/antourage.h" // AntourageBake — per-floor baked dressing


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

    // The cold crowd is seeded ONCE (the first load), which labels every seeded
    // record with this floor's number; from then on the crowd IS whoever is in
    // pool.floor_bucket(number). No frozen id range to remember — the label is the
    // membership, so a migration in/out of this floor is reflected on next load.
    bool seeded = false;

    // The module's player-designate: the record `ensure_loaded` hands the camera to on
    // the first ever load, before any player exists.
    //
    // An NpcHandle — (generation, id) — and NOT a bare NpcId, because this reference is
    // held for the WHOLE SESSION: written once when the crowd is seeded, compared on a
    // first load that may come hours later or never. That is exactly the shape slot
    // recycling breaks, and [npc_pool.h] names this field as one of the six bare-id
    // stores that had to move before `set_recycling(true)` could ship. It HAS shipped:
    // [src/app/main.cpp] now calls `pool.set_recycling(true)` and lists this field as one
    // of the DONE prerequisites, so the paragraph below is the live configuration and not
    // a future one. Armed, the designate can die in a macro sweep, its slot be handed to a
    // newborn, and a bare `id == candidate` then match a DIFFERENT person who reads as
    // perfectly alive — the camera goes to a stranger, and nothing logs it.
    // `pool.handle_valid` fails on the bumped generation whether or not the slot was
    // reused, so it catches a plain DEATH too, which is the half that would still matter
    // if the flag were ever disarmed again.
    //
    // FREE in space: an id is 20 bits (kNpcPoolBits) so the 12-bit generation shares the
    // same 32-bit word — see the static_assert under this struct. sizeof(FloorModule)
    // does not move, and neither does anything else's layout.
    //
    // FREE on the wire, because there is no wire: nothing serializes this struct. [save.h]
    // excludes the NPC pool from the format outright (`seed_floor_population` reproduces
    // it) and the module table is rebuilt by main's `add_module` calls, not loaded. The
    // only field of a FloorModule that reaches a file is `number`/`kind`/`seed` as the nav
    // cache's key ([nav_cache.h]), and this is not one of them. So no `kXxxWire`
    // static_assert or byte count moves — and it would not anyway, NpcHandle being the
    // same uint32 an `ar.u32(...)` already wrote.
    NpcHandle candidate = kInvalidHandle; // the seed's player-designate (gen-checked)

    // Live set while loaded (empty when cold): the entities embodied for this
    // module, so unload folds exactly them back.
    std::vector<Entity> bodies;
};

// What makes `candidate` a free upgrade: a handle is the same WIDTH as the id it
// replaced, so the field's offset and the struct's size are both unchanged. Assert the
// widths and not `sizeof(FloorModule)` — that one also carries a std::vector's ABI, which
// legitimately differs between toolchains, and pinning it here would fail for a reason
// that is not a bug. [tests/suite_saveload.inl] candidate_slot_recycled prints the
// measured figure for the host it runs on.
static_assert(sizeof(NpcHandle) == sizeof(NpcId),
              "FloorModule::candidate became a generation-checked handle IN PLACE: the "
              "two must stay the same width or this struct's layout moves");

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

    // How a VISITED floor gets its saved geometry back.
    //
    // Called by `ensure_loaded` immediately after `generate_floor` and before the
    // dressing bake, the props, the doors and the nav — so that everything which
    // attaches itself to geometry sees the FINAL geometry. Return true if the
    // world was restored, false to leave the fresh generation standing (no file
    // yet, unreadable file, first visit).
    //
    // A hook rather than a direct call because reading `floor_<N>.sav` is file
    // I/O, and giga_game does none by design ([save.h]) — the app owns the bytes,
    // this owns the ordering. Stamping late is what put lamps in mid-air over
    // their own holes; [problems.md] §42.
    void set_floor_restore(std::function<bool(World&, int)> fn) {
        restore_ = std::move(fn);
    }

    // Own a per-floor nav bake at all. **Default OFF, and that is the fix.**
    //
    // `ensure_loaded` used to bake `bake_coarse` + `bake_fine` unconditionally on
    // every floor entry — the measured ~1.9 s + ~1.8 s and ~130 MiB that
    // [world/nav_async.h] calls "the worst thing the player feels" — and the app
    // read the result NEVER: `nav_at` has no caller outside the tests, while the
    // crowd steers off `main.cpp`'s own `nav::AsyncBake`. So every ride paid a
    // multi-second BLOCKING bake whose product was freed unread, on top of the
    // async bake that actually feeds the game. [problems.md] §26.
    //
    // Not deleted, because it is a real feature with real coverage: the resident
    // FloorNav is what `suite_navcache` and `test_floor_streamer_nav` assert
    // against, and it is the only thing that exercises the on-disk nav cache.
    // Turning it off by default gives the app the seconds back while leaving the
    // feature — and its tests — intact. Setting a cache dir implies it, because
    // memoizing a bake you never make is meaningless.
    void set_nav_bake(bool on) { navBake_ = on; }
    bool nav_bake() const { return navBake_ || !navCacheDir_.empty(); }

    // Register a floor module: assign `number -> module` in `reg` and record how
    // to build it. Does NOT load it. Returns the new ModuleId, or kInvalidModule
    // if the module table is full.
    ModuleId add_module(FloorRegistry& reg, int number, FloorKind kind,
                        std::uint32_t seed);

    // Seed the COLD crowd of every registered module that has not been seeded yet,
    // without loading geometry and without embodying anybody. Returns how many
    // records were created.
    //
    // WHY THIS EXISTS. `ensure_loaded` seeds a module's crowd on its FIRST LOAD, which
    // means the population only comes into existence where the player has already
    // been. Measured before this: a fresh run had 420 records in the pool — one
    // floor's worth — while the stack registers ten. Every macro pass in
    // [macro_sim.h] operates on COLD records only (migration and the social sweep both
    // skip `pool.embodied`), so with a single loaded floor every record was embodied
    // and the macro society had literally nothing to work on: births, deaths,
    // departures and arrivals were all structurally zero, not merely quiet.
    //
    // Calling this at startup is what makes "the world lives whether or not the player
    // is looking" true rather than aspirational: the other nine floors are now
    // populated, cold, and therefore eligible to age, die, give birth and migrate
    // before anyone has ever visited them.
    //
    // Cheap: it is the same `seed_floor_from_spec` the first load would have run, just
    // earlier, and it allocates no layer and touches no ECS. The demo stack costs
    // ~4,200 records against a 2^20 pool.
    std::uint32_t seed_all_modules(NpcPool& pool);

    // THE seed of floor `number` — the one its module was registered with and
    // its geometry was generated from. Everything that must agree with the
    // generator (door_build via floor_doorways, nav cache keys, population)
    // derives from THIS value, never from a second constant: a parallel "door
    // seed" put the doorway plan and the wall plan in two different buildings,
    // and 95% of the padic floor's doors silently failed door_build's
    // grid-agreement check. Returns 0 for an unregistered number — callers on
    // the ride/load paths always hold a registered floor.
    std::uint32_t floor_seed_of(const FloorRegistry& reg, int number) const;

    // Load floor `number` if it is cold: allocate a physical layer, generate its
    // geometry, mark it resident, and embody its crowd (seeding the crowd once on
    // the first ever load). Records already embodied — e.g. the player standing on
    // another floor — are skipped, so no one is duplicated. When `playerId` is
    // kInvalidNpc this designates the module's candidate as the player, embodies
    // it with a camera, and writes it back through `playerId` (+ LoadResult).
    // No-op returning the existing layer if already loaded; kInvalidLayer if
    // `number` maps to no registered module.
    //
    // The designate is resolved through `FloorModule::candidate`'s GENERATION, so a
    // designate that died between seeding and this load is re-picked from the floor's
    // current live roster instead of resolving to whoever inherited its slot. A
    // designate that is alive but no longer a resident of this floor (migrated away),
    // or one that is already embodied, still designates nobody — unchanged. See
    // embody_crowd in the .cpp for the full rule and why each branch is what it is.
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
    // `dir` is a DIRECTION, not an offset: the destination is the nearest labelled
    // floor beyond `fromFloor` on that side, found through `next_labelled_floor`.
    //
    // This used to compute `fromFloor + dir` and no-op when that landed on nothing,
    // which silently made the elevator unusable on any sparse stack — and a sparse
    // stack is legal by design, since floor numbers are mutable labels rather than
    // indices. The bug only appears when the numbers stop being contiguous, so it sat
    // dormant while the demo stack happened to be 0..4.
    RideResult travel(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                      NpcPool& pool, Entity player, int fromFloor, int dir,
                      std::uint8_t arrivalCoord, NpcId& playerId);

    // Jump straight to floor `toFloor` — the console's teleport, and the shared
    // tail travel() resolves into. Loads the destination on demand, moves the
    // player across (ride_elevator with the resolved delta — the same fold/
    // re-embody path, so nothing about the body's state is lost), adopts the
    // fresh body into the destination module, and prunes back to the kept
    // window. No-op RideResult when `toFloor` == `fromFloor` or maps to no
    // registered module. Unlike travel(), `toFloor` is an ABSOLUTE label — any
    // registered floor, not the adjacent one.
    //
    // `landHub` (default -1): when in [0, 16), plants the rider on that planar
    // lattice cabin on arrival — fast-travel landing ([elevators.md] §24). The
    // debug console `teleport` leaves this at -1 (mirrored x/y); `fasttravel`
    // passes the boarding hub so destination == source cabin.
    RideResult teleport(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                        NpcPool& pool, Entity player, int fromFloor, int toFloor,
                        std::uint8_t arrivalCoord, NpcId& playerId,
                        int landHub = -1);

    // True when floor `number` currently has a resident layer.
    bool loaded(const FloorRegistry& reg, int number) const {
        return reg.layer_at(number) != kInvalidLayer;
    }

    // The baked navigation for floor `number`, or nullptr when that floor is not
    // currently resident (nav lives only while the floor is loaded — ensure_loaded
    // bakes it, unload frees it). The pointer stays valid until `number` unloads.
    const FloorNav* nav_at(const FloorRegistry& reg, int number) const;

    // The resident floor's antourage bake (wire chains etc.), or null when the
    // floor is cold. Render-side consumers only.
    const AntourageBake* antourage_at(const FloorRegistry& reg, int number) const;
    // Same, keyed by the RESIDENT layer — what a render feeder that only knows
    // its LayerId asks.
    const AntourageBake* antourage_at_layer(const FloorRegistry& reg,
                                            LayerId layer) const;

    // Multi-floor navigation cache accessors.
    const MultiFloorNavCache& multi_floor_cache() const { return multiFloorNavCache_; }
    MultiFloorNavCache& multi_floor_cache() { return multiFloorNavCache_; }

    // Vertical transit links across registered and active floors.
    const std::vector<nav::VerticalWaypointLink>& vertical_links() const { return verticalLinks_; }
    std::vector<nav::VerticalWaypointLink> vertical_links_for_floor(int floorNumber) const;
    void refresh_vertical_links(const FloorRegistry& reg);

    // Multi-floor cross-boundary routing query: resolves next step toward target on another floor.
    nav::MultiFloorPathStep query_entity_route(const FloorRegistry& reg, int fromFloor,
                                               ivec3 fromCell, int toFloor, ivec3 toCell) const;

    // Seamless streaming re-embodiment when entities travel between active and cached floors.
    RideResult reembody_entity_transit(LevelStack& stack, FloorRegistry& reg,
                                       Registry& ecs, NpcPool& pool, Entity entity,
                                       int fromFloor, int toFloor,
                                       std::uint8_t arrivalCoord, NpcId& playerId,
                                       int landHub = -1);

    int keep_radius() const { return keepRadius_; }

private:
    // Population uses a seed offset from the geometry seed so a floor's crowd
    // layout and its walls don't correlate.
    static constexpr std::uint32_t kPopSeedSalt = 0x51ed270bu;

    LayerId alloc_slot();
    void free_slot(LayerId slot);

    // Embody a module's cold crowd onto `layer`. See ensure_loaded for the
    // player-designation and skip-already-embodied rules.
    void embody_crowd(Registry& ecs, NpcPool& pool, const World& world,
                      FloorModule& fm, LayerId layer,
                      NpcId& playerId, Entity& outPlayer);

    FloorModule modules_[kMaxModules];
    // Per-module baked nav, resident only while the module is loaded. Heap-held
    // because each FineNav is ~130 MiB — keeping them out of line keeps the
    // FloorStreamer object (a stack local in app + tests) tiny. ensure_loaded
    // bakes into nav_[m]; unload resets it back to null.
    std::unique_ptr<FloorNav> nav_[kMaxModules];
    // Per-module antourage bake (the GHOST half: wire chains for the render
    // backend; the solid half lives in the grid itself). Same lifetime as nav_.
    std::unique_ptr<AntourageBake> antourage_[kMaxModules];
    ModuleId next_ = 0; // bump allocator for ModuleId
    std::vector<LayerId> freeSlots_;
    int keepRadius_ = 0;
    std::string navCacheDir_; // empty = on-disk nav cache disabled
    bool navBake_ = false;    // see set_nav_bake: OFF for the app, on for tests
    std::function<bool(World&, int)> restore_;  // see set_floor_restore
    MultiFloorNavCache multiFloorNavCache_;
    std::vector<nav::VerticalWaypointLink> verticalLinks_;
};

} // namespace giga::game


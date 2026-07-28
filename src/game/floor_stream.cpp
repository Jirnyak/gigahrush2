#include "game/floor_stream.h"

#include "ecs/components.h"   // giga::Transform
#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef
#include "game/floor_gen.h"   // generate_floor
#include "game/nav_cache.h"   // nav_cache_name, save/load_nav_cache
#include "game/population.h"  // seed_floor_from_spec

namespace giga::game {

void FloorStreamer::init(LevelStack& stack, int keepRadius) {
    keepRadius_ = keepRadius < 0 ? 0 : keepRadius;
    // Peak residency during a ride = the kept window (2R+1) plus the destination
    // loaded before the trailing floor is pruned (+1). Reserve exactly that many
    // recyclable physical layers up front; floors cycle through them.
    const int slots = 2 * keepRadius_ + 2;
    freeSlots_.clear();
    for (int i = 0; i < slots; ++i) freeSlots_.push_back(stack.push_layer());
}

ModuleId FloorStreamer::add_module(FloorRegistry& reg, int number, FloorKind kind,
                                   std::uint32_t seed) {
    if (next_ >= kMaxModules) return kInvalidModule;
    ModuleId m = next_++;
    FloorModule& fm = modules_[m];
    fm.used = true;
    fm.number = number;
    fm.kind = kind;
    fm.seed = seed;
    reg.assign(number, m);
    return m;
}

LayerId FloorStreamer::alloc_slot() {
    if (freeSlots_.empty()) return kInvalidLayer;
    LayerId s = freeSlots_.back();
    freeSlots_.pop_back();
    return s;
}

void FloorStreamer::free_slot(LayerId slot) {
    if (slot != kInvalidLayer) freeSlots_.push_back(slot);
}

void FloorStreamer::embody_crowd(Registry& ecs, NpcPool& pool, FloorModule& fm,
                                 LayerId layer, NpcId& playerId,
                                 Entity& outPlayer) {
    for (NpcId id = fm.firstId; id < fm.firstId + fm.count; ++id) {
        // Skip the dead, and skip anyone already embodied (e.g. the player, who
        // may live in this module's range but is currently standing on another
        // floor) — that is what prevents a duplicate body.
        if (!pool.alive(id) || pool.embodied(id)) continue;
        if (playerId == kInvalidNpc && id == fm.candidate) {
            Entity e = embody_as_player(ecs, pool, id, layer);
            playerId = id;
            outPlayer = e;
            fm.bodies.push_back(e);
        } else {
            fm.bodies.push_back(embody(ecs, pool, id, layer));
        }
    }
}

LoadResult FloorStreamer::ensure_loaded(LevelStack& stack, FloorRegistry& reg,
                                        Registry& ecs, NpcPool& pool, int number,
                                        NpcId& playerId) {
    LoadResult out;
    ModuleId m = reg.module_at(number);
    if (m == kInvalidModule || !modules_[m].used) return out; // no such module
    FloorModule& fm = modules_[m];

    // Already resident: hand back its layer, touch nothing.
    LayerId existing = reg.layer_of(m);
    if (existing != kInvalidLayer) {
        out.layer = existing;
        return out;
    }

    // Seed the cold crowd exactly once, on the first ever load. The pool bump-
    // allocates, so the crowd occupies a contiguous id range we remember; every
    // later load re-embodies THAT range rather than seeding new records, so the
    // population never grows per visit (master_prompt #9).
    if (!fm.seeded) {
        const FloorSpec& spec = floor_spec(fm.kind);
        NpcId before = pool.count();
        fm.candidate = seed_floor_from_spec(pool,
                                            static_cast<std::uint16_t>(fm.number),
                                            spec, fm.seed ^ kPopSeedSalt);
        fm.firstId = before;
        fm.count = pool.count() - before;
        fm.seeded = true;
    }

    // Take a recyclable physical layer and rebuild the floor's geometry into it.
    // generate_floor clears to air first, so a recycled slot regenerates the
    // floor bit-for-bit (floor_gen.h) — no layout is ever persisted.
    LayerId slot = alloc_slot();
    if (slot == kInvalidLayer) return out; // slot pool exhausted (should not happen)
    generate_floor(stack.layer(slot), fm.number, floor_spec(fm.kind), fm.seed);
    reg.set_resident(m, slot);

    // Bring up this floor's navigation into a per-module holder that lives only
    // while the floor is resident (performance.md "bake at load, tick in O(1)").
    // The geometry was just rebuilt deterministically above, so this is the
    // freeze -> bake -> resume seam: the coarse next-hop graph plus the 64 flow
    // fields + nearest-node field, ~130 MiB, all freed again in unload. With a
    // cache dir set (C.2b) we first try the memoized bake keyed on this floor's
    // (number, kind, seed) — a pure fn of the geometry — and only bake + write
    // the cache on a miss.
    auto fn = std::make_unique<FloorNav>();
    std::string cachePath;
    bool haveNav = false;
    if (!navCacheDir_.empty()) {
        cachePath = navCacheDir_ + "/" + nav_cache_name(fm.number, fm.kind, fm.seed);
        haveNav = load_nav_cache(cachePath, fm.number, fm.kind, fm.seed, fn->coarse,
                                 fn->fine);
    }
    if (!haveNav) {
        nav::bake_coarse(stack.layer(slot).grid(), fn->coarse);
        nav::bake_fine(stack.layer(slot).grid(), fn->fine);
        if (!cachePath.empty())
            save_nav_cache(cachePath, fm.number, fm.kind, fm.seed, fn->coarse,
                           fn->fine);
    }
    nav_[m] = std::move(fn);

    fm.bodies.clear();
    embody_crowd(ecs, pool, fm, slot, playerId, out.player);
    out.layer = slot;
    return out;
}

void FloorStreamer::unload(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                           NpcPool& pool, int number) {
    ModuleId m = reg.module_at(number);
    if (m == kInvalidModule || !modules_[m].used) return;
    FloorModule& fm = modules_[m];
    LayerId layer = reg.layer_of(m);
    if (layer == kInvalidLayer) return; // already cold

    // Fold every live body back into its cold record (position persists in the
    // row). A handle may already be invalid — e.g. the player's old body, which a
    // ride destroyed when it moved the player to another floor — and fold_back is
    // a clean no-op on an invalid handle.
    for (Entity e : fm.bodies) {
        if (!ecs.valid(e)) continue;
        NpcId id = kInvalidNpc;
        if (auto* ref = ecs.try_get<NpcRef>(e)) id = ref->id;
        if (id != kInvalidNpc) fold_back(ecs, pool, id, e);
        else ecs.destroy(e);
    }
    fm.bodies.clear();

    // Free the floor's baked nav — resident only while the floor is live, so a
    // cold floor costs no nav RAM (~130 MiB reclaimed here); a later reload rebakes
    // it from the deterministically regenerated geometry.
    nav_[m].reset();

    // Recycle the physical layer (its World stays allocated in the stack, ready to
    // be regenerated for the next floor — dense over sparse, performance.md) and
    // break the module's residency.
    free_slot(layer);
    reg.evict(m);
    (void)stack;
}

const FloorNav* FloorStreamer::nav_at(const FloorRegistry& reg, int number) const {
    ModuleId m = reg.module_at(number);
    if (m == kInvalidModule) return nullptr;
    return nav_[m].get();
}

void FloorStreamer::keep_only(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                              NpcPool& pool, int activeNumber) {
    for (ModuleId m = 0; m < next_; ++m) {
        FloorModule& fm = modules_[m];
        if (!fm.used) continue;
        if (reg.layer_of(m) == kInvalidLayer) continue; // already cold
        int d = fm.number - activeNumber;
        if (d < 0) d = -d;
        if (d > keepRadius_) unload(stack, reg, ecs, pool, fm.number);
    }
}

RideResult FloorStreamer::travel(LevelStack& stack, FloorRegistry& reg,
                                 Registry& ecs, NpcPool& pool, Entity player,
                                 int fromFloor, int dir, std::uint8_t arrivalZ,
                                 NpcId& playerId) {
    RideResult r;
    r.player = player;
    r.floor = fromFloor;
    if (auto* tr = ecs.try_get<Transform>(player)) r.layer = tr->layer;

    const int dstFloor = fromFloor + dir;
    if (reg.module_at(dstFloor) == kInvalidModule) return r; // no such floor -> no-op

    // Load the destination on demand. playerId is valid here, so its crowd is
    // embodied as plain bodies and the player (embodied on the source) is skipped;
    // then the elevator moves the player across.
    ensure_loaded(stack, reg, ecs, pool, dstFloor, playerId);
    RideResult ride = ride_elevator(ecs, pool, reg, player, fromFloor, dir, arrivalZ);
    if (!ride.moved) return ride;

    // The ride built a fresh player body on the destination; adopt it into the
    // destination module so a later unload folds it, then prune to the kept window
    // — which folds the whole departed crowd back into the cold pool.
    ModuleId dm = reg.module_at(dstFloor);
    if (dm != kInvalidModule) modules_[dm].bodies.push_back(ride.player);
    keep_only(stack, reg, ecs, pool, dstFloor);
    return ride;
}

} // namespace giga::game

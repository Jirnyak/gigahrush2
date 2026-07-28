#include "game/floor_stream.h"

#include "ecs/components.h"   // giga::Transform
#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef
#include "game/floor_gen.h"   // generate_floor
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
        // fm.number goes through UNCAST. This used to be
        // static_cast<std::uint16_t>(fm.number), which is the exact line that wrote
        // the demo stack's negative labels into the pool as garbage: floor -50 became
        // 65486, -36 became 65500, -8 became 65528. Every floor below the hub was
        // stored wrong and nothing in src/ ever read pool.floor() back, so it was a
        // silent corruption waiting for master_prompt #10's per-floor bucket index —
        // the first reader — to inherit it. The label is signed all the way through
        // now (FloorRegistry kMinFloor -127 .. kMaxFloor +127, NpcPool::floor()
        // std::int16_t), so the cast has nothing left to do.
        fm.candidate = seed_floor_from_spec(pool, fm.number, spec,
                                            fm.seed ^ kPopSeedSalt);
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

    // Sweep whatever ELSE still lives on this layer.
    //
    // Folding fm.bodies only covers the embodied crowd. Entity kinds created outside
    // it — pickups dropped by loot_dead_mobs, in-flight projectiles, containers —
    // kept Transform.layer pointing at a slot about to be recycled, and nothing ever
    // destroyed them. LevelStack never pops, so stack.valid(layer) stayed true and
    // physics_step kept paying a full swept-AABB step per orphan for the rest of the
    // session. Worse: with keepRadius 0 the free list holds two slots, so the second
    // ride handed this slot straight back, generate_floor rewrote the geometry around
    // the orphans, and body_pass drew floor N's gold on floor N+2 where pickup_step
    // would bank it — an economy bug, not only a tick-budget one. floors.md "nothing
    // is persisted floor-to-floor except the folded-back records themselves" and
    // main.cpp's "exactly one floor's worth is ever simulated" were both false in
    // writing until this swept.
    //
    // Reuses fm.bodies as scratch: it was just cleared and keeps its capacity, so
    // this costs no allocation. Two-phase because destroying inside a view
    // invalidates the iterator. The CameraTag holder is exempt — unload() is public
    // API and must never evict the body the player is looking through.
    auto onLayer = ecs.view<const Transform>();
    for (auto e : onLayer) {
        if (onLayer.get<const Transform>(e).layer != layer) continue;
        if (ecs.all_of<CameraTag>(e)) continue;
        fm.bodies.push_back(e);
    }
    for (Entity e : fm.bodies) {
        if (ecs.valid(e)) ecs.destroy(e);
    }
    fm.bodies.clear();

    // Recycle the physical layer (its World stays allocated in the stack, ready to
    // be regenerated for the next floor — dense over sparse, performance.md) and
    // break the module's residency.
    free_slot(layer);
    reg.evict(m);
    (void)stack;
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

    // The nearest labelled floor on that side, NOT fromFloor + dir. A sparse stack
    // is legal (floor numbers are mutable labels, not indices) and `+dir` lands on
    // nothing for most of one. [floor_registry.h next_labelled_floor]
    const int dstFloor = next_labelled_floor(reg, fromFloor, dir);
    if (dstFloor == fromFloor) return r;                     // end of the stack
    if (reg.module_at(dstFloor) == kInvalidModule) return r; // no such floor -> no-op

    // Load the destination on demand. playerId is valid here, so its crowd is
    // embodied as plain bodies and the player (embodied on the source) is skipped;
    // then the elevator moves the player across.
    ensure_loaded(stack, reg, ecs, pool, dstFloor, playerId);
    // Hand the elevator the resolved delta so it agrees with the module that
    // was just loaded. Passing the raw dir would move the player to a floor
    // whose geometry is not resident.
    RideResult ride = ride_elevator(ecs, pool, reg, player, fromFloor,
                                    dstFloor - fromFloor, arrivalZ);
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

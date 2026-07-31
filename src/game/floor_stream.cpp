#include "game/floor_stream.h"

#include "ecs/components.h"   // giga::Transform
#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef
#include "game/floor_gen.h"   // generate_floor
#include "game/nav_cache.h"   // nav_cache_name, save/load_nav_cache
#include "game/population.h"  // seed_floor_from_spec

namespace giga::game {

namespace {

// Turn the id `seed_floor_from_spec` designated into the handle FloorModule stores.
//
// The kInvalidNpc branch is LOAD-BEARING, not a defensive nicety. `pool.handle(id)`
// packs `id & kNpcIdMask`, so handing it kInvalidNpc (0xFFFFFFFF) masks down to id
// 0xFFFFF — 1,048,575, a perfectly legal slot (kNpcPoolSize - 1) — and pairs it with
// whatever generation that slot reports. The result is a handle that is not
// kInvalidHandle and names a real, in-range row, so no bounds check anywhere catches it.
// Both answers `handle_valid` can then give are wrong, and the second is the worse one:
//   * On a pool below the high-water mark it reads STALE (0xFFFFF >= count_), which routes
//     into the replacement scan below and designates the floor's HIGHEST-id resident —
//     silently converting "this module has no designate" into "it designates somebody".
//   * Exhausted reserve is the case that actually PRODUCES kInvalidNpc here, and there
//     count_ == kNpcPoolSize, so 0xFFFFF is in range, alive, and at whatever generation
//     it holds. handle_valid can then answer TRUE and designate slot 1,048,575 — a total
//     stranger, no scan involved and nothing anomalous to see.
// The two states have to stay distinguishable, so the only handle meaning "nobody" is
// kInvalidHandle. [tests/suite_saveload.inl] candidate_slot_recycled asserts the packing
// arithmetic directly rather than leaving this paragraph as the only record of it.
//
// seed_floor_from_spec returns kInvalidNpc when it placed nobody — a spec with
// population 0, or a pool whose reserve is exhausted.
NpcHandle mint_candidate(const NpcPool& pool, NpcId id) {
    return id == kInvalidNpc ? kInvalidHandle : pool.handle(id);
}

} // namespace

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

std::uint32_t FloorStreamer::seed_all_modules(NpcPool& pool) {
    // Exactly the seeding half of ensure_loaded, hoisted so it can run before anybody
    // has visited anything. No layer, no geometry, no ECS entity: the records are
    // created COLD, which is the state every macro_sim pass requires (migration and the
    // social sweep both skip pool.embodied, so an embodied record is invisible to them).
    //
    // `fm.candidate` is written here rather than discarded because ensure_loaded reads
    // it to pick the module's player-designate on a first load, and that first load is
    // no longer the thing that seeds. Dropping it would make floor 0's player selection
    // depend on whether this ran.
    const NpcId before = pool.count();
    for (ModuleId m = 0; m < next_; ++m) {
        FloorModule& fm = modules_[m];
        if (!fm.used || fm.seeded) continue;
        const FloorSpec& spec = floor_spec(fm.kind);
        const NpcId cand =
            seed_floor_from_spec(pool, fm.number, spec, fm.seed ^ kPopSeedSalt);
        fm.candidate = mint_candidate(pool, cand);
        fm.seeded = true;
    }
    return static_cast<std::uint32_t>(pool.count() - before);
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
    // Snapshot whoever is CURRENTLY labelled with this floor's number — the live
    // per-floor bucket (npc_pool.h), not a frozen seed range, so a macro migration
    // that relabelled a record onto this floor is picked up on the next load.
    // Copied because embody() could in principle re-label a record (it does not
    // today, but a snapshot keeps this loop correct regardless — set_floor would
    // swap-remove from the very bucket we walk). This is floor-load, not tick, work
    // and the copy is free beside the ~130 MiB nav bake next to it.
    // int16_t, not uint16_t: floor labels are SIGNED and this stack really does go
    // negative (-8 .. -50). `floor_bucket` takes std::int16_t, so the old uint16_t
    // cast turned floor -50 into 65486 and only got -50 back out of the implicit
    // narrowing by modular wraparound. Correct by accident is not correct.
    const std::vector<NpcId> crowd =
        pool.floor_bucket(static_cast<std::int16_t>(fm.number));

    // Resolve WHO gets the camera before embodying anybody, because a stale designate
    // has to be replaced from a scan of the whole bucket and the loop below consumes it
    // one record at a time. Only ever runs on a load with no player yet — one load per
    // session — so every later load pays nothing at all for this.
    //
    // `fm.candidate` is a generation-checked handle, so there are four cases and each one
    // is a different answer:
    //
    //   1. VALID handle -> the designate is still the same living person; use its id.
    //      This is the only path that existed, and its behaviour is unchanged.
    //   2. kInvalidHandle -> the module never designated anybody (population 0, or a
    //      reserve-exhausted seed). Nobody gets the camera, exactly as the old
    //      `id == kInvalidNpc` compare could never match. Kept distinguishable from
    //      case 3 by mint_candidate above; conflating them designates a stranger.
    //   3. STALE handle -> the record died (kill() bumps the generation whether or not
    //      the slot is recycled). RE-DESIGNATE from the floor's current live roster:
    //      leaving the player unembodied on the floor they are entering would be a
    //      second bug, and resolving the bare id would hand the camera to whoever
    //      inherited the slot.
    //   4. VALID handle whose record is not in this bucket (migrated off the floor) or
    //      is already embodied (standing on another floor) -> nobody, which is what
    //      happens today: the loop simply never meets that id. Preserved on purpose —
    //      "the designate lives somewhere else" is not this lane's defect, and a
    //      migrated designate genuinely is not a resident to embody here.
    //
    // The replacement picks the live, non-embodied resident whose id is NEAREST the
    // stale one, ties to the lower id. Both properties are deliberate:
    //   * Nearest-id, not first-in-bucket: `floor_bucket`'s order is explicitly
    //     unspecified (swap-remove churns it), so indexing it would make the player's
    //     identity depend on the order deaths and migrations happened to splice the
    //     roster. Nearest-id is a pure function of the SET, and the lower-id tie-break is
    //     what keeps it single-valued — without it the two records either side of the
    //     hole are equidistant and bucket order decides again.
    //   * Nearest, not lowest, because ids are dealt to rooms round-robin
    //     (population.cpp: `room = i % kRoomCount`), so an id next to the designate's is
    //     a room next to the designate's room. That preserves the reason the designate
    //     was `first + placed/2` in the first place — "lands in an interior room rather
    //     than a corner" — where the lowest live id is room 0, a corner.
    //
    // The stale id's own SLOT is excluded from the scan. That is the assertion the
    // generation check exists to make: the slot whose occupant changed is precisely the
    // one the failed check just disqualified, and re-picking it would reproduce the bare-
    // id outcome byte for byte — the newborn who took a dead resident's slot would get
    // the camera anyway, and the check would be unobservable. Recycling IS armed in the
    // shipping build ([src/app/main.cpp] `pool.set_recycling(true)`), so this exclusion is
    // live policy rather than insurance; with it disarmed it would cost nothing at all,
    // since a corpse is then in no bucket (kill() relabels it kNoFloorLabel) and the
    // skipped id could never come up. The one case it gives up on is a floor whose only
    // live non-embodied resident IS that recycled slot, which then designates nobody —
    // same as case 2, and a floor with one resident is not the scenario this guard is for.
    // Asserted, not assumed: [tests/suite_saveload.inl] candidate_slot_recycled case 5.
    //
    // The replacement is stamped back into fm.candidate so the designation is decided
    // once rather than re-derived against a roster that keeps moving.
    NpcId designate = kInvalidNpc;
    if (playerId == kInvalidNpc && fm.candidate != kInvalidHandle) {
        const NpcId stale = npc_handle_id(fm.candidate);
        if (pool.handle_valid(fm.candidate)) {
            designate = stale;
        } else {
            std::uint32_t best = 0xFFFFFFFFu;
            for (NpcId id : crowd) {
                if (id == stale) continue;      // the disqualified slot — see above
                if (pool.embodied(id)) continue;
                const std::uint32_t d = id > stale ? id - stale : stale - id;
                if (d < best || (d == best && id < designate)) {
                    best = d;
                    designate = id;
                }
            }
            if (designate != kInvalidNpc) fm.candidate = pool.handle(designate);
        }
    }

    for (NpcId id : crowd) {
        // Bucket residents are alive by construction (kill/leave drop them). Skip
        // anyone already embodied — e.g. the player, labelled with this floor but
        // currently standing on another — which is what prevents a duplicate body.
        if (pool.embodied(id)) continue;
        if (playerId == kInvalidNpc && id == designate) {
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
        // fm.number goes through UNCAST. This used to be
        // static_cast<std::uint16_t>(fm.number), which is the exact line that wrote
        // the demo stack's negative labels into the pool as garbage: floor -50 became
        // 65486, -36 became 65500, -8 became 65528. Every floor below the hub was
        // stored wrong and nothing in src/ ever read pool.floor() back, so it was a
        // silent corruption waiting for master_prompt #10's per-floor bucket index —
        // the first reader — to inherit it. The label is signed all the way through
        // now (FloorRegistry kMinFloor -127 .. kMaxFloor +127, NpcPool::floor()
        // std::int16_t), so the cast has nothing left to do.
        fm.candidate = mint_candidate(
            pool, seed_floor_from_spec(pool, fm.number, spec, fm.seed ^ kPopSeedSalt));
        // No firstId/count recorded any more: FloorModule dropped them because the
        // crowd IS pool.floor_bucket(number) once seed_floor_from_spec has labelled
        // every record it spawned. A frozen [firstId, count) range could not express a
        // record migrating in or out of this floor; the label can, and macro_sim
        // migration is exactly that operation. A `NpcId before = pool.count()` also
        // survived here, feeding a delta that was deleted with those fields — dead
        // since, and a C4189 the zero-warning standard should have caught.
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

    // The nearest labelled floor on that side, NOT fromFloor + dir. A sparse stack
    // is legal (floor numbers are mutable labels, not indices) and `+dir` lands on
    // nothing for most of one. [floor_registry.h next_labelled_floor]
    const int dstFloor = next_labelled_floor(reg, fromFloor, dir);
    if (dstFloor == fromFloor) return r; // end of the stack
    return teleport(stack, reg, ecs, pool, player, fromFloor, dstFloor, arrivalZ,
                    playerId);
}

RideResult FloorStreamer::teleport(LevelStack& stack, FloorRegistry& reg,
                                   Registry& ecs, NpcPool& pool, Entity player,
                                   int fromFloor, int toFloor,
                                   std::uint8_t arrivalZ, NpcId& playerId) {
    RideResult r;
    r.player = player;
    r.floor = fromFloor;
    if (auto* tr = ecs.try_get<Transform>(player)) r.layer = tr->layer;

    if (toFloor == fromFloor) return r;                     // already there
    if (reg.module_at(toFloor) == kInvalidModule) return r; // no such floor -> no-op

    // Load the destination on demand. playerId is valid here, so its crowd is
    // embodied as plain bodies and the player (embodied on the source) is skipped;
    // then the elevator moves the player across.
    ensure_loaded(stack, reg, ecs, pool, toFloor, playerId);
    // Hand the elevator the resolved delta so it agrees with the module that
    // was just loaded. Passing a raw direction would move the player to a floor
    // whose geometry is not resident.
    RideResult ride = ride_elevator(ecs, pool, reg, player, fromFloor,
                                    toFloor - fromFloor, arrivalZ);
    if (!ride.moved) return ride;

    // The ride built a fresh player body on the destination; adopt it into the
    // destination module so a later unload folds it, then prune to the kept window
    // — which folds the whole departed crowd back into the cold pool.
    ModuleId dm = reg.module_at(toFloor);
    if (dm != kInvalidModule) modules_[dm].bodies.push_back(ride.player);
    keep_only(stack, reg, ecs, pool, toFloor);
    return ride;
}

} // namespace giga::game

#include "game/floor_stream.h"

#include <chrono>   // the floor-entry timings printed below
#include <cstdio>

#include "ecs/components.h"   // giga::Transform
#include "game/ai.h"          // ai_release on unload (MotionOwner token)
#include "game/combat.h"      // PlayerRanged, PlayerMelee
#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef
#include "game/fast_travel.h" // on_fast_hub, fast_hub_cell, kFastHubsPerFloor
#include "game/floor_gen.h"   // generate_floor, floor_gravity_regime
#include "game/nav_cache.h"   // nav_cache_name, save/load_nav_cache
#include "game/population.h"  // seed_floor_from_spec
#include "game/rpg.h"         // RpgStats
#include "game/save.h"        // place_body_safely — blind-seeded cells resolve here
#include "game/sector_layout.h" // SectorLayout, 5 Vertical Biomes, Fuzzy Boundaries
#include "game/status.h"      // StatusSet


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
    multiFloorNavCache_.set_cache_dir(navCacheDir_);
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
    fm.seed = (seed != 0) ? seed : compute_sector_seed(worldSeed_, number);
    fm.sectorLayout = generate_sector_layout(number, worldSeed_);
    reg.assign(number, m);
    refresh_vertical_links(reg);
    if (!navCacheDir_.empty()) {
        nav::CoarseGraph cg{};
        multiFloorNavCache_.ensure_coarse(NavCacheKey{number, kind, fm.seed}, cg);
    }
    return m;
}

const SectorLayout* FloorStreamer::sector_layout_at(const FloorRegistry& reg,
                                                    int number) const {
    const ModuleId m = reg.module_at(number);
    if (m == kInvalidModule || !modules_[m].used) return nullptr;
    return &modules_[m].sectorLayout;
}

std::uint32_t FloorStreamer::floor_seed_of(const FloorRegistry& reg,
                                           int number) const {
    const ModuleId m = reg.module_at(number);
    if (m == kInvalidModule) return 0;
    return modules_[m].seed;
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

void FloorStreamer::embody_crowd(Registry& ecs, NpcPool& pool, const World& world,
                                 FloorModule& fm, LayerId layer, NpcId& playerId,
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
        // currently standing on another.
        if (pool.embodied(id)) continue;
        // ...and skip the record the CALLER is going to embody as the player
        // itself. The `embodied` test above cannot cover it across a save:
        // `NpcPool::save_rows` deliberately strips `NpcEmbodied` ("bodies never
        // survive a save") and `load_rows` strips it again, so on the F9 path the
        // player's row reads NOT embodied. With a valid `playerId` passed in, the
        // designate branch below is skipped, this loop embodied the player's row
        // as an ordinary resident, and main then called `embody_as_player` on the
        // SAME id — `embody()` creates unconditionally, so the run came back with
        // a camera-less clone sharing the player's pool row (damage to it drained
        // the player's HP). Only bites when the saved floor equals the row's own
        // floor label, i.e. F9 on the starting floor. [problems.md] §25.
        //
        // Deliberately NOT also guarding inside `embody()`: making it return null
        // for an already-embodied id would turn this duplicate into a NULL player
        // at main.cpp's unguarded `reg.get<Transform>(player)` (§28.1) — a crash
        // in place of a clone. The skip belongs where the caller's intent is known.
        if (id == playerId) continue;
        Entity e;
        if (playerId == kInvalidNpc && id == designate) {
            e = embody_as_player(ecs, pool, id, layer);
            playerId = id;
            outPlayer = e;
        } else {
            e = embody(ecs, pool, id, layer);
        }
        // Cold records are seeded BLIND across the whole height axis (no storey
        // is privileged on the torus — [population.cpp]); the stored cell may be
        // inside a slab or a wall, and THIS is the one seam every embodiment
        // passes through, so the resolve lives here rather than in embody().
        place_body_safely(ecs, world, e);
        fm.bodies.push_back(e);
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
    // A FLOOR ENTRY IS THREE STEPS ([floor_gen.h]), and the middle one is a FORK.
    //
    //   1. LAWS      — always. The module says what kind of place this is:
    //                  gravity frame, registries. Not in the snapshot, because
    //                  it is a property of the MODULE, not of the saved bytes.
    //   2. GEOMETRY  — restored from the floor's snapshot if it was ever
    //                  visited, generated from (seed, number) if it was not.
    //                  One or the other, never both.
    //   3. RULES     — always, on top of whichever geometry step ran: fluids and
    //                  seeded content, so a revisited floor gets its water back
    //                  even though the snapshot carries geometry only.
    //
    // Generation and rules used to be fused inside the module generator, which is
    // what forced a visited floor to be BUILT before its snapshot could be laid
    // over it — 126 ms of voxels written and immediately overwritten, and worse,
    // the ordering bug that hung lamps in mid-air ([problems.md] §42). Now the
    // fork is literal: a visited floor is its snapshot plus its module's rules.
    //
    // Timings are printed because which half costs what was folklore until it was
    // measured: generate ~130 ms against a ~6.4 s snapshot read on this floor.
    const auto t0 = std::chrono::steady_clock::now();
    floor_declare_rules(stack.layer(slot), fm.number, floor_spec(fm.kind), fm.seed);

    const auto t1 = std::chrono::steady_clock::now();
    const bool restored = restore_ && restore_(stack.layer(slot), fm.number);
    const auto t2 = std::chrono::steady_clock::now();
    if (!restored) {
        generate_floor(stack.layer(slot), fm.number, floor_spec(fm.kind), fm.seed);
        apply_sector_fuzzy_boundaries(stack.layer(slot), fm.number, fm.seed, fm.sectorLayout.biome);
    }
    const auto t3 = std::chrono::steady_clock::now();

    floor_apply_rules(stack.layer(slot), fm.number, floor_spec(fm.kind), fm.seed);
    const auto t4 = std::chrono::steady_clock::now();
    {
        auto ms = [](auto a, auto b) {
            return std::chrono::duration<double, std::milli>(b - a).count();
        };
        std::fprintf(stderr,
                     "[floor] %d (%s | %s): laws %.1f ms | %s %.1f ms | rules %.1f ms\n",
                     fm.number, vertical_biome_name(fm.sectorLayout.biome),
                     floor_spec(fm.kind).name, ms(t0, t1),
                     restored ? "RESTORED" : "generated",
                     restored ? ms(t1, t2) : ms(t2, t3), ms(t3, t4));
    }

    // Antourage AFTER the geometry: it READS the finished grid as context and
    // never writes it ([antourage.md] — the dressing is mesh on anchors, so
    // nav has nothing to route around and does not care where in the load this
    // runs). Deterministic in (grid, number, seed) — a recycled slot re-bakes
    // bit-for-bit like the geometry itself, which is why nothing is persisted.
    auto ab = std::make_unique<AntourageBake>();
    bake_antourage(stack.layer(slot), fm.number, fm.seed, *ab);
    antourage_[m] = std::move(ab);
    reg.set_resident(m, slot);

    // Bring up this floor's navigation into a per-module holder that lives only
    // while the floor is resident (performance.md "bake at load, tick in O(1)").
    // The geometry was just rebuilt deterministically above, so this is the
    // freeze -> bake -> resume seam: the coarse next-hop graph plus the 64 flow
    // fields + nearest-node field, ~130 MiB, all freed again in unload. With a
    // cache dir set (C.2b) we first try the memoized bake keyed on this floor's
    // (number, kind, seed) — a pure fn of the geometry — and only bake + write
    // the cache on a miss.
    //
    // GATED, and OFF by default (`set_nav_bake`): the shipping app steers off its
    // own `nav::AsyncBake` and never reads `nav_at`, so doing this here bought a
    // multi-second blocking stall per floor entry and 130 MiB, then freed the
    // result unread. [problems.md] §26.
    if (nav_bake()) {
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
    multiFloorNavCache_.store_coarse(fm.number, fn->coarse);
    nav_[m] = std::move(fn);
    }


    fm.bodies.clear();
    embody_crowd(ecs, pool, stack.layer(slot), fm, slot, playerId, out.player);
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

    // Hand MotionOwner::Ai tokens back BEFORE fold_back destroys the bodies.
    // fold_back destroys the entity (AiBrain dies with it), but ai_release is the
    // documented unload contract ([ai.h]): if a body were kept alive across a
    // layer recycle without destroy, wander_step would skip it forever. Cheap,
    // idempotent, and the stderr line is the gameplay proof AIMEM needs.
    {
        const std::uint32_t released = ai_release(ecs, layer);
        std::fprintf(stderr,
                     "[aimem] RELEASE floor=%d layer=%u bodies=%u released=%u\n",
                     number, static_cast<unsigned>(layer),
                     static_cast<unsigned>(fm.bodies.size()), released);
    }

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
    antourage_[m].reset();

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

const AntourageBake* FloorStreamer::antourage_at(const FloorRegistry& reg,
                                                 int number) const {
    ModuleId m = reg.module_at(number);
    if (m == kInvalidModule) return nullptr;
    return antourage_[m].get();
}

const AntourageBake* FloorStreamer::antourage_at_layer(const FloorRegistry& reg,
                                                       LayerId layer) const {
    if (layer == kInvalidLayer) return nullptr;
    for (ModuleId m = 0; m < kMaxModules; ++m)
        if (reg.layer_of(m) == layer) return antourage_[m].get();
    return nullptr;
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
                                 int fromFloor, int dir, std::uint8_t arrivalCoord,
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
    return teleport(stack, reg, ecs, pool, player, fromFloor, dstFloor, arrivalCoord,
                    playerId);
}

RideResult FloorStreamer::teleport(LevelStack& stack, FloorRegistry& reg,
                                   Registry& ecs, NpcPool& pool, Entity player,
                                   int fromFloor, int toFloor,
                                   std::uint8_t arrivalCoord, NpcId& playerId,
                                   int landHub) {
    RideResult r;
    r.player = player;
    r.floor = fromFloor;
    if (auto* tr = ecs.try_get<Transform>(player)) r.layer = tr->layer;

    if (toFloor == fromFloor) return r;                     // already there
    if (reg.module_at(toFloor) == kInvalidModule) return r; // no such floor -> no-op

    // Seamless streaming re-embodiment preserving all entity components across floor transition
    RideResult ride = reembody_entity_transit(stack, reg, ecs, pool, player, fromFloor,
                                             toFloor, arrivalCoord, playerId, landHub);
    if (!ride.moved) return ride;

    keep_only(stack, reg, ecs, pool, toFloor);
    return ride;
}

void FloorStreamer::refresh_vertical_links(const FloorRegistry& reg) {
    verticalLinks_.clear();
    for (ModuleId m = 0; m < next_; ++m) {
        const FloorModule& fm = modules_[m];
        if (!fm.used) continue;

        const int upFloor = next_labelled_floor(reg, fm.number, 1);
        if (upFloor != fm.number) {
            nav::generate_shaft_waypoint_links(fm.number, upFloor, verticalLinks_);
        }
        const int downFloor = next_labelled_floor(reg, fm.number, -1);
        if (downFloor != fm.number) {
            nav::generate_shaft_waypoint_links(fm.number, downFloor, verticalLinks_);
        }
    }
}

std::vector<nav::VerticalWaypointLink> FloorStreamer::vertical_links_for_floor(int floorNumber) const {
    std::vector<nav::VerticalWaypointLink> res;
    for (const auto& lk : verticalLinks_) {
        if (lk.fromFloor == floorNumber) {
            res.push_back(lk);
        }
    }
    return res;
}

nav::MultiFloorPathStep FloorStreamer::query_entity_route(const FloorRegistry& reg,
                                                         int fromFloor, ivec3 fromCell,
                                                         int toFloor, ivec3 toCell) const {
    nav::MultiFloorPathStep res;
    const FloorNav* fn = nav_at(reg, fromFloor);
    if (fn != nullptr) {
        return nav::multi_floor_route_step(fn->coarse, fn->fine, fromFloor, fromCell,
                                           toFloor, toCell, verticalLinks_);
    }

    const nav::CoarseGraph* cg = multiFloorNavCache_.coarse_for(fromFloor);
    if (cg != nullptr) {
        nav::FineNav emptyFine;
        return nav::multi_floor_route_step(*cg, emptyFine, fromFloor, fromCell,
                                           toFloor, toCell, verticalLinks_);
    }

    res.dir = nav::kFlowNone;
    res.crossFloor = (fromFloor != toFloor);
    res.targetFloor = toFloor;
    return res;
}

RideResult FloorStreamer::reembody_entity_transit(LevelStack& stack, FloorRegistry& reg,
                                                  Registry& ecs, NpcPool& pool,
                                                  Entity entity, int fromFloor,
                                                  int toFloor, std::uint8_t arrivalCoord,
                                                  NpcId& playerId, int landHub) {
    RideResult r;
    r.player = entity;
    r.floor = fromFloor;
    if (auto* tr = ecs.try_get<Transform>(entity)) r.layer = tr->layer;

    if (toFloor == fromFloor) return r;
    ModuleId dm = reg.module_at(toFloor);
    if (dm == kInvalidModule || !modules_[dm].used) return r;

    NpcId id = kInvalidNpc;
    if (auto* ref = ecs.try_get<NpcRef>(entity)) id = ref->id;

    float yaw = 0.0f, pitch = 0.0f, fovY = 1.2f;
    vec3 eyeOffset{0.0f, 0.0f, 0.7f};
    const bool isPlayer = ecs.all_of<CameraTag>(entity);
    if (auto* cam = ecs.try_get<CameraTag>(entity)) {
        yaw = cam->yaw;
        pitch = cam->pitch;
        fovY = cam->fovY;
        eyeOffset = cam->eyeOffset;
    }
    bool fly = false;
    float moveSpeed = 6.0f;
    vec3 wishDir{0.0f, 0.0f, 0.0f};
    if (auto* ctl = ecs.try_get<Controller>(entity)) {
        fly = ctl->fly;
        moveSpeed = ctl->moveSpeed;
        wishDir = ctl->wishDir;
    }

    const bool hadRanged = ecs.all_of<PlayerRanged>(entity);
    PlayerRanged ranged{};
    if (hadRanged) ranged = ecs.get<PlayerRanged>(entity);

    const bool hadMelee = ecs.all_of<PlayerMelee>(entity);
    PlayerMelee melee{};
    if (hadMelee) melee = ecs.get<PlayerMelee>(entity);

    const bool hadRpg = ecs.all_of<RpgStats>(entity);
    RpgStats rpg{};
    if (hadRpg) rpg = ecs.get<RpgStats>(entity);

    const bool hadAi = ecs.all_of<AiBrain>(entity);
    AiBrain aiBrain{};
    if (hadAi) aiBrain = ecs.get<AiBrain>(entity);

    const bool hadStatus = ecs.all_of<StatusSet>(entity);
    StatusSet statusSet{};
    if (hadStatus) statusSet = ecs.get<StatusSet>(entity);

    const bool hadObserver = ecs.all_of<ObserverTag>(entity);
    const bool hadNoClip = ecs.all_of<NoClip>(entity);

    ensure_loaded(stack, reg, ecs, pool, toFloor, playerId);
    const LayerId dstLayer = reg.layer_at(toFloor);
    if (dstLayer == kInvalidLayer) return r;

    // Erase the departing entity from source module bodies to prevent dangling entity leakage
    const ModuleId fm = reg.module_at(fromFloor);
    if (fm != kInvalidModule && modules_[fm].used) {
        auto& fromBodies = modules_[fm].bodies;
        fromBodies.erase(std::remove(fromBodies.begin(), fromBodies.end(), entity), fromBodies.end());
    }

    if (id != kInvalidNpc) {
        fold_back(ecs, pool, id, entity);
    } else {
        ecs.destroy(entity);
    }

    const CellStep down = regime_down(floor_gravity_regime());
    if (id != kInvalidNpc) {
        // Officially register NPC on the destination floor in the pool bucket index
        pool.set_floor(id, static_cast<std::int16_t>(toFloor));

        if (down.x != 0) pool.cx(id) = arrivalCoord;
        else if (down.y != 0) pool.cy(id) = arrivalCoord;
        else if (down.z != 0) pool.cz(id) = arrivalCoord;

        if (landHub >= 0 && landHub < kFastHubsPerFloor) {
            if (down.x != 0) fast_hub_cell(landHub, pool.cy(id), pool.cz(id));
            else if (down.y != 0) fast_hub_cell(landHub, pool.cx(id), pool.cz(id));
            else fast_hub_cell(landHub, pool.cx(id), pool.cy(id));
        }
    }

    Entity ne = entt::null;
    if (id != kInvalidNpc) {
        if (isPlayer || id == playerId) {
            ne = embody_as_player(ecs, pool, id, dstLayer);
            playerId = id;
        } else {
            ne = embody(ecs, pool, id, dstLayer);
        }
    }

    if (ne == entt::null) {
        return r;
    }

    place_body_safely(ecs, stack.layer(dstLayer), ne);

    if (auto* cam = ecs.try_get<CameraTag>(ne)) {
        cam->yaw = yaw;
        cam->pitch = pitch;
        cam->fovY = fovY;
        cam->eyeOffset = eyeOffset;
    }
    if (auto* ctl = ecs.try_get<Controller>(ne)) {
        ctl->fly = fly;
        ctl->moveSpeed = moveSpeed;
        ctl->wishDir = wishDir;
    }
    if (hadRanged) ecs.emplace_or_replace<PlayerRanged>(ne, ranged);
    if (hadMelee) ecs.emplace_or_replace<PlayerMelee>(ne, melee);
    if (hadRpg) ecs.emplace_or_replace<RpgStats>(ne, rpg);
    if (hadAi) ecs.emplace_or_replace<AiBrain>(ne, aiBrain);
    if (hadStatus) ecs.emplace_or_replace<StatusSet>(ne, statusSet);
    if (hadObserver) ecs.emplace_or_replace<ObserverTag>(ne);
    if (hadNoClip) ecs.emplace_or_replace<NoClip>(ne);

    modules_[dm].bodies.push_back(ne);

    keep_only(stack, reg, ecs, pool, toFloor);

    r.player = ne;
    r.layer = reg.layer_at(toFloor);
    r.floor = toFloor;
    r.moved = true;
    return r;
}

} // namespace giga::game


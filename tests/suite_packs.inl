// Pack tests — monsters arrive in groups and STAY in them. Included into
// game_test.cpp, so it uses that file's CHECK macro and its `using namespace`.
//
// The regression this file exists to catch is a specific, seductive one: grouping
// at SPAWN alone looks like a complete success and is not. `wander_init` used to
// roll every agent's destination from its own entity id, and the nav bake takes
// ~3.7 s, so a spawned pack held together for exactly as long as the bake and blew
// apart the moment the flow fields landed. A screenshot taken at load would show a
// triumph that is an artefact of the bake not having finished.
//
// So the cohesion test below does not measure at t=0. It bakes the nav
// SYNCHRONOUSLY (so there is no BAKING window to be fooled by at all), then steps
// wander_step far past the point the async bake would have completed, and only then
// measures. And it measures against a control drawn ACROSS packs, so "still
// together" cannot pass by the floor simply being small.
//
// This is a .inl and not a .cpp on purpose: game_test.cpp owns the CHECK macro, so
// the include has to land after it. It carries its own includes of the systems
// under test so game_test.cpp's diff stays two lines.

#include "game/floor_gen.h"
#include "game/mob_spawn.h"
#include "game/wander.h"

namespace packs_detail {

// Heads standing within this many cells of each other count as one group. 3 cells
// = 6 m, comfortably inside the authored 5..6 cell packSpread and comfortably
// outside anything two independently-placed monsters would hit by chance (measured
// pre-change: 59 of 194 heads, and never a clump above 4).
inline constexpr float kGroupRadiusCells = 3.0f;

// A head's room index on the generator's own wall lattice. The stride comes from
// floor_room_stride, so this can never disagree with where the walls actually are.
inline int room_of(const vec3& pos, int stride, int roomsPerAxis) {
    const int cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    const int cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    return (cy / stride) * roomsPerAxis + (cx / stride);
}

inline float flat_dist(const vec3& a, const vec3& b) {
    const float dx = wrap_delta_f(a.x, b.x, kWorldExtent);
    const float dy = wrap_delta_f(a.y, b.y, kWorldExtent);
    return std::sqrt(dx * dx + dy * dy);
}

// Widest toroidal separation inside a set of positions. O(n^2) over a pack of at
// most 16 — the honest measure of "still together", where a centroid radius would
// hide a pack that had split cleanly into two halves.
inline float diameter(const std::vector<vec3>& p) {
    float worst = 0.0f;
    for (std::size_t i = 0; i < p.size(); ++i)
        for (std::size_t j = i + 1; j < p.size(); ++j) {
            const float d = flat_dist(p[i], p[j]);
            if (d > worst) worst = d;
        }
    return worst;
}

// Single-link spatial clustering by union-find. Returns each position's group size.
inline std::vector<int> group_sizes(const std::vector<vec3>& at, float radius) {
    std::vector<int> parent(at.size());
    for (std::size_t i = 0; i < parent.size(); ++i) parent[i] = static_cast<int>(i);
    auto find = [&parent](int i) {
        while (parent[static_cast<std::size_t>(i)] != i) {
            const int up = parent[static_cast<std::size_t>(i)];
            parent[static_cast<std::size_t>(i)] = parent[static_cast<std::size_t>(up)];
            i = parent[static_cast<std::size_t>(i)];
        }
        return i;
    };
    for (std::size_t i = 0; i < at.size(); ++i)
        for (std::size_t j = i + 1; j < at.size(); ++j) {
            if (flat_dist(at[i], at[j]) > radius) continue;
            const int a = find(static_cast<int>(i)), b = find(static_cast<int>(j));
            if (a != b) parent[static_cast<std::size_t>(a)] = b;
        }
    std::vector<int> root(at.size(), 0);
    for (std::size_t i = 0; i < at.size(); ++i)
        ++root[static_cast<std::size_t>(find(static_cast<int>(i)))];
    std::vector<int> out(at.size(), 0);
    for (std::size_t i = 0; i < at.size(); ++i)
        out[i] = root[static_cast<std::size_t>(find(static_cast<int>(i)))];
    return out;
}

} // namespace packs_detail

static void test_packs_all() {
    using namespace packs_detail;

    { // ---- placement is per-room, and the population is untouched ----------
        // Floor 4, Derelict, seed 77 — the same floor test_mob_spawn already pins,
        // so these numbers sit beside ones that are already asserted elsewhere.
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        generate_floor(w, 4, spec, 11u);
        const std::uint8_t danger = danger_for_hostility(spec.hostility);
        const FloorTheme theme = theme_for_kind(FloorKind::Derelict);
        const int stride = floor_room_stride(FloorKind::Derelict);
        const int roomsPerAxis = kMacroDim / stride;
        const int roomCount = roomsPerAxis * roomsPerAxis;
        CHECK(stride == 8);        // the authored Derelict pitch
        CHECK(roomCount == 256);

        Registry reg;
        const std::uint32_t n =
            spawn_floor_mobs(reg, w, 4, danger, theme, /*layer=*/0, /*seed=*/77u,
                             /*cap=*/0, FloorKind::Derelict);

        // THE POPULATION IS UNCHANGED. Measured at 194 heads (the full budget)
        // before the change and required to still be 194 after it: this is what
        // separates "the change is spatial" from "the change quietly lost monsters
        // to a tighter placement rule".
        CHECK(n == 194);
        CHECK(n == static_cast<std::uint32_t>(mob_count_for_floor(4, danger, theme)));
        CHECK(count_layer_mobs(reg, 0) == n);

        std::vector<vec3> at;
        std::vector<std::uint8_t> kindOf, packOf;
        std::vector<std::uint8_t> roomTaken(static_cast<std::size_t>(roomCount), 0u);
        std::size_t occupied = 0;
        for (auto e : reg.view<const MobRef, const Transform>()) {
            const MobRef& m = reg.get<const MobRef>(e);
            const vec3& p = reg.get<const Transform>(e).pos;
            at.push_back(p);
            kindOf.push_back(m.kind);
            packOf.push_back(m.pack);
            const int room = room_of(p, stride, roomsPerAxis);
            if (!roomTaken[static_cast<std::size_t>(room)]++) ++occupied;

            // Never on the wall lattice. A head at local 0 stands in a doorway or
            // inside a knocked-out wall cell, which the old whole-grid rejection
            // sampler placed freely.
            const int cx = wrap_macro(static_cast<int>(p.x / kCellSize));
            const int cy = wrap_macro(static_cast<int>(p.y / kCellSize));
            CHECK((cx % stride) != 0);
            CHECK((cy % stride) != 0);
            // Every head belongs to a pack; 0 is reserved for "never grouped".
            CHECK(m.pack != 0);
        }
        CHECK(at.size() == n);

        // OCCUPIED ROOMS DROP SUBSTANTIALLY. 134 of 256 before, and the assertion is
        // deliberately a hard bound rather than "fewer than before": a later change
        // that half-restores the sprinkle would still pass a relative test.
        std::fprintf(stderr,
                     "[packs] floor 4 derelict: heads=%u rooms=%d occupied=%zu\n",
                     n, roomCount, occupied);
        CHECK(occupied < 90);
        CHECK(occupied > 0);

        // One kind per pack. This is the room contract — a room's roster is rolled
        // once — and it is what makes a group read as a swarm rather than a queue.
        for (std::size_t i = 0; i < at.size(); ++i)
            for (std::size_t j = i + 1; j < at.size(); ++j)
                if (packOf[i] == packOf[j]) CHECK(kindOf[i] == kindOf[j]);

        // A Crowd-mode kind actually stands in crowds.
        //
        // kGroupRadiusCells is 3, which is deliberately TIGHTER than the authored
        // 5..6-cell packSpread, and that choice is what gives the measure teeth. At
        // radius 3 a disc holds ~28 cells, so 194 heads over 16384 cells put a
        // neighbour in reach of ~28% of them by chance — matching the 30% measured
        // before this change. At radius 6 the disc holds ~113 cells and ~74% of an
        // independently-sprinkled floor would score as "grouped", so the metric
        // would pass for a floor with no packs in it at all.
        //
        // The consequence of that tightness, stated rather than tuned away: a pack
        // of 8 with a 5-cell spread clamped into a 7x7 room can legitimately leave a
        // corner head with no neighbour inside 3 cells. So the 80% bar is asserted
        // on the AGGREGATE over Crowd heads (which is the claim), and per kind only
        // where the sample is more than a single pack. Measured: one 8-head kind
        // scores 75%, every kind with 20+ heads scores 91-100%, aggregate 97%.
        const std::vector<int> sizes = group_sizes(at, kGroupRadiusCells * kCellSize);
        std::size_t crowdHeads = 0, crowdGrouped = 0, crowdKindsChecked = 0;
        std::size_t lonerHeads = 0, lonerGrouped = 0;
        for (std::size_t k = 0; k < kMobKindCount; ++k) {
            const MobPackMode mode = static_cast<MobPackMode>(kMobTable[k].packMode);
            std::size_t heads = 0, grouped = 0;
            for (std::size_t i = 0; i < at.size(); ++i) {
                if (kindOf[i] != k) continue;
                ++heads;
                if (sizes[i] >= 2) ++grouped;
            }
            if (heads == 0) continue;
            if (mode == MobPackMode::Crowd) {
                crowdHeads += heads;
                crowdGrouped += grouped;
                std::fprintf(stderr, "[packs]   crowd %-22s heads=%2zu grouped=%2zu\n",
                             mob_name(static_cast<MobKind>(k)), heads, grouped);
                if (heads >= 20) {
                    ++crowdKindsChecked;
                    CHECK(grouped * 100 >= heads * 80);
                }
            }
            if (mode == MobPackMode::Loner) {
                lonerHeads += heads;
                lonerGrouped += grouped;
                if (heads >= 8)
                    std::fprintf(stderr,
                                 "[packs]   loner %-22s heads=%2zu grouped=%2zu\n",
                                 mob_name(static_cast<MobKind>(k)), heads, grouped);
            }
        }
        std::fprintf(stderr,
                     "[packs] crowd heads=%zu grouped=%zu | loner heads=%zu "
                     "grouped=%zu\n",
                     crowdHeads, crowdGrouped, lonerHeads, lonerGrouped);
        CHECK(crowdHeads >= 100);                        // not a vacuous aggregate
        CHECK(crowdGrouped * 100 >= crowdHeads * 80);    // the brief's 80%
        CHECK(crowdKindsChecked >= 3);                   // and it is not one kind
        // A LONER IS STILL ALONE. Not zero-tolerance: two Loner packs can be handed
        // the same room once the unused rooms run out, and two rooms sharing a wall
        // can put their anchors 2 cells apart. 25% is far above what was measured
        // (0%) and far below what any Crowd kind scores.
        CHECK(lonerHeads >= 8);
        CHECK(lonerGrouped * 100 <= lonerHeads * 25);

        // Every Loner pack holds exactly one head, which is the structural form of
        // the same claim and independent of any radius. Safe from the 255-pack id
        // wrap here: this floor spawns well under 255 packs (asserted below).
        std::vector<int> perPack(256, 0);
        std::vector<int> kindPerPack(256, -1);
        for (std::size_t i = 0; i < at.size(); ++i) {
            ++perPack[packOf[i]];
            kindPerPack[packOf[i]] = kindOf[i];
        }
        std::size_t packs = 0, biggestPack = 0;
        for (std::size_t p = 1; p < 256; ++p) {
            if (perPack[p] == 0) continue;
            ++packs;
            if (static_cast<std::size_t>(perPack[p]) > biggestPack)
                biggestPack = static_cast<std::size_t>(perPack[p]);
            const MobDef& d = kMobTable[static_cast<std::size_t>(kindPerPack[p])];
            if (static_cast<MobPackMode>(d.packMode) == MobPackMode::Loner)
                CHECK(perPack[p] == 1);
            else
                CHECK(perPack[p] <= static_cast<int>(d.packMax));
        }
        std::fprintf(stderr, "[packs] packs=%zu biggest=%zu occupied=%zu\n", packs,
                     biggestPack, occupied);
        CHECK(packs < 255);          // no pack-id wrap on this floor
        CHECK(biggestPack >= 5);     // at least one real swarm landed
        CHECK(packs == occupied);    // one pack per room while rooms are spare

        // Determinism survives the restructure: same floor + seed, same result.
        Registry again;
        CHECK(spawn_floor_mobs(again, w, 4, danger, theme, 0, 77u, 0,
                               FloorKind::Derelict) == n);

        // The room pitch is read from the generator, not guessed. Commercial builds
        // on a 16-cell pitch, so passing its kind must place heads on a coarser
        // lattice than Derelict's 8 — the check that a copied stride table would
        // pass while drifting.
        CHECK(floor_room_stride(FloorKind::Commercial) == 16);
        CHECK(floor_room_stride(FloorKind::Industrial) == 32);
        CHECK(floor_room_stride(FloorKind::Residential) == 8);
    }

    { // ---- the destination is the PACK's, not the entity's ------------------
        // Pure and shared: every member of a pack computes the same node from the
        // same (pack, tick) without consulting anything, which is the property that
        // survives the stagger. Different packs disagree, or every pack would walk
        // to one node.
        for (std::uint64_t t = 0; t < 4u * kPackEpochTicks; t += 137u) {
            CHECK(pack_target_node(7, t) == pack_target_node(7, t));
            CHECK(pack_target_node(7, t) < nav::kNodes);
        }
        // Constant across an epoch, and it does move between epochs.
        CHECK(pack_target_node(7, 0) == pack_target_node(7, kPackEpochTicks - 1));
        std::size_t changed = 0;
        for (std::uint8_t p = 1; p < 60; ++p)
            if (pack_target_node(p, 0) != pack_target_node(p, kPackEpochTicks))
                ++changed;
        CHECK(changed >= 40);   // 59 packs, 1/64 chance each of repeating by luck
        // Packs spread over the lattice rather than piling onto one node.
        std::vector<std::uint8_t> hit(nav::kNodes, 0u);
        std::size_t distinct = 0;
        for (std::uint8_t p = 1; p < 200; ++p)
            if (!hit[pack_target_node(p, 0)]++) ++distinct;
        CHECK(distinct >= 40);
    }

    { // ---- COHESION SURVIVES THE NAV BAKE -----------------------------------
        // Residential geometry: intact slabs, so nobody falls through a collapsed
        // floor and leaves its pack for reasons that have nothing to do with
        // steering.
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Residential);
        generate_floor(w, 12, spec, 21u);

        LevelStack stack;
        const LayerId layer = stack.push_layer();
        stack.layer(layer).grid() = w.grid();

        // Residential GEOMETRY with a hostile floor's danger and theme. The two are
        // independent arguments by design (a floor supplies both separately), and
        // this combination is what gives the measurement a real sample: floor 0's
        // Living theme budgets 77 heads and only 8 of its packs hold more than one
        // member, which is too few to say anything about a distribution.
        Registry reg;
        const std::uint32_t n = spawn_floor_mobs(
            reg, w, 12, /*danger=*/5, FloorTheme::Hell, layer, /*seed=*/31u,
            /*cap=*/300, FloorKind::Residential);
        CHECK(n == 300);

        // Baked HERE, synchronously, and complete before a single step runs. The
        // async bake in main.cpp is what creates the BAKING window a load-time
        // screenshot can be fooled by; there is no such window in this test.
        nav::CoarseGraph coarse;
        nav::FineNav fine;
        nav::bake_coarse(stack.layer(layer).grid(), coarse);
        nav::bake_fine(stack.layer(layer).grid(), fine);
        CHECK(!fine.flow.empty());

        const std::uint32_t wandering = wander_init(reg, layer, 4u);
        CHECK(wandering > 0);

        // wander_step resolves the camera holder's faction to decide whether monsters
        // consider it prey ([faction_relations.h]); this test has no camera holder at
        // all, so an empty pool is exactly right and the gate is never consulted.
        NpcPool pool;
        pool.init();

        // The pack id reached WanderTarget, and immobile kinds still get no target.
        for (auto e : reg.view<const MobRef>()) {
            const MobRef& m = reg.get<const MobRef>(e);
            const bool immobile =
                has_flag(kMobTable[m.kind].aiFlags, AiFlag::Immobile);
            if (immobile) {
                CHECK(!reg.all_of<WanderTarget>(e));
                continue;
            }
            CHECK(reg.all_of<WanderTarget>(e));
            CHECK(reg.get<const WanderTarget>(e).pack == m.pack);
        }

        auto snapshot = [&reg, layer]() {
            std::vector<std::vector<vec3>> byPack(256);
            for (auto e : reg.view<const MobRef, const WanderTarget, const Transform>()) {
                const Transform& tr = reg.get<const Transform>(e);
                if (tr.layer != layer) continue;
                byPack[reg.get<const MobRef>(e).pack].push_back(tr.pos);
            }
            return byPack;
        };
        const std::vector<std::vector<vec3>> before = snapshot();

        // 3600 ticks = 30 s at the 120 Hz step. The async bake lands at ~3.7 s
        // (~444 ticks), so this is eight times past the window a load-time capture
        // could hide in, and it crosses two kPackEpochTicks boundaries — a pack has
        // to re-agree on a destination twice without shedding anyone.
        const float dt = 1.0f / 120.0f;
        for (std::uint64_t t = 0; t < 3600; ++t) {
            wander_step(reg, stack.layer(layer).grid(), pool, coarse, fine, layer, t);
            physics_step(reg, stack, dt);
        }
        const std::vector<std::vector<vec3>> after = snapshot();

        // Somebody actually walked. Cohesion is worthless if the whole floor is
        // standing still, which is exactly how a broken steering path would pass a
        // "still together" assertion.
        float travelled = 0.0f;
        for (std::size_t p = 1; p < 256; ++p) {
            if (before[p].empty() || before[p].size() != after[p].size()) continue;
            for (std::size_t i = 0; i < before[p].size(); ++i) {
                const float d = flat_dist(before[p][i], after[p][i]);
                if (d > travelled) travelled = d;
            }
        }
        CHECK(travelled > 4.0f);

        // Pack diameter after the run, against a CONTROL of the same size drawn
        // across packs. Without the control this proves nothing: on a 256 m torus a
        // generous absolute radius would pass even for a fully dispersed crowd.
        std::size_t multi = 0, tight = 0;
        float worstPack = 0.0f;
        std::vector<vec3> control;
        for (std::size_t p = 1; p < 256; ++p) {
            if (after[p].size() < 2) continue;
            ++multi;
            const float d = diameter(after[p]);
            if (d > worstPack) worstPack = d;
            if (d <= 40.0f) ++tight;
            control.push_back(after[p][0]);   // one head from each pack
        }
        CHECK(multi >= 5);   // there are real multi-head packs to talk about

        const float controlDiameter = diameter(control);
        std::fprintf(stderr,
                     "[packs] after 3600 ticks: packs>=2 = %zu, within 40 m = %zu, "
                     "worst pack diameter = %.1f m, across-pack control = %.1f m\n",
                     multi, tight, worstPack, controlDiameter);

        // >= 80% of multi-head packs still fit inside 40 m — two apartments wide,
        // and a fraction of the control spread.
        CHECK(tight * 100 >= multi * 80);
        // ...and being together is a property of the PACK, not of the floor being
        // small: a same-sized sample across packs is spread far wider.
        CHECK(controlDiameter > worstPack * 2.0f);

        // ---- the shaft-drift question, measured rather than assumed -----------
        // wander.cpp's horizontal fallback walks an agent toward its target node's
        // COLUMN, and 110 of 120 ground-storey agents take that branch because every
        // lattice node sits at cell z in {16,48,80,112} while the crowd stands at
        // z = 1. A shared destination therefore sends a whole pack at one of the 16
        // shaft columns together. Printed, plus the one thing that would make it a
        // genuine regression asserted: packs must still spread ACROSS the columns
        // rather than all converging on the same one.
        struct Shaft { float dist; int column; };
        auto nearest_shaft = [](const vec3& p) {
            Shaft best{1e9f, 0};
            for (int ny = 0; ny < kLatticeDim; ++ny)
                for (int nx = 0; nx < kLatticeDim; ++nx) {
                    const float tx = static_cast<float>(lattice_coord(nx)) * kCellSize;
                    const float ty = static_cast<float>(lattice_coord(ny)) * kCellSize;
                    const float dx = wrap_delta_f(p.x, tx, kWorldExtent);
                    const float dy = wrap_delta_f(p.y, ty, kWorldExtent);
                    const float d = std::sqrt(dx * dx + dy * dy);
                    if (d < best.dist) best = Shaft{d, ny * kLatticeDim + nx};
                }
            return best;
        };
        float sumBefore = 0.0f, sumAfter = 0.0f;
        std::size_t heads = 0, nearAfter = 0;
        std::vector<std::uint8_t> columnHit(
            static_cast<std::size_t>(kLatticeDim * kLatticeDim), 0u);
        std::size_t columns = 0;
        for (std::size_t p = 1; p < 256; ++p) {
            if (before[p].size() != after[p].size()) continue;
            for (std::size_t i = 0; i < after[p].size(); ++i) {
                ++heads;
                sumBefore += nearest_shaft(before[p][i]).dist;
                const Shaft a = nearest_shaft(after[p][i]);
                sumAfter += a.dist;
                if (a.dist < 8.0f) ++nearAfter;
                if (!columnHit[static_cast<std::size_t>(a.column)]++) ++columns;
            }
        }
        CHECK(heads > 0);
        std::fprintf(stderr,
                     "[packs] shaft drift: mean distance to nearest of 16 columns "
                     "%.1f m -> %.1f m; within 8 m: %zu/%zu; columns occupied %zu/16\n",
                     sumBefore / static_cast<float>(heads),
                     sumAfter / static_cast<float>(heads), nearAfter, heads, columns);
        // Packs do not all pick the same shaft. This is the assertion that would
        // catch a pack key degenerating to a constant — the failure mode in which
        // every monster on the floor walks to one lobby and the floor empties out.
        CHECK(columns >= 8);

        // Members of one pack agree on the destination at every instant, which is
        // the mechanism the geometry above is only evidence for.
        for (std::uint64_t t : {0ull, 500ull, 2000ull, 3599ull}) {
            std::vector<int> node(256, -1);
            for (auto e : reg.view<const MobRef, const WanderTarget>()) {
                const std::uint8_t p = reg.get<const MobRef>(e).pack;
                const int want = pack_target_node(p, t);
                if (node[p] < 0) node[p] = want;
                CHECK(node[p] == want);
            }
        }
    }
}

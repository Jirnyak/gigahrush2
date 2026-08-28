// A dense 128^3 walkability bitset — the bake's snapshot of the world.
//
// A heavy bake reads the world through ONE precomputed per-cell predicate,
// so the world state its worker needs is not the 132 MiB MacroGrid — it is
// one bit per cell: 2M bits = 256 KiB, copyable in ~50 us. That is what lets
// the async-rebake scheduler hand a worker a SNAPSHOT by value instead of a
// raw pointer into the live grid, and with it retire the whole `doors.frozen`
// freeze-the-world protocol (markoaudit/plans/async-rebake.md §0, §3).
//
// Сегодняшний единственный потребитель — телесный битсет комнат (`bodyOpen`,
// [game/body_walk.cpp]). Нав из этого файла УШЁЛ (эпик occupancy 2026-08-26,
// §60): его закон стал гранным, не поклеточным, и его снапшот — само поле
// клиренса ([world/clearance.h], та же схема «оракул по значению», 4 МиБ).
//
// GENERIC ON PURPOSE. Predicates live in their systems' layers and world must
// not see game. So this struct knows nothing about SubMask or walkability
// laws: the caller injects the predicate into `build`, and each system owns
// its one-bit patch helper next to its predicate (game::patch_body_walk_bit)
// so the law and its incremental form cannot drift apart in two files.
//
// Bit convention: SET = open (the cell can be occupied), CLEAR = blocked —
// every patch site stays a plain `set(i, predicate(mask))` with no negation
// to get backwards.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/jobs.h"    // parallel_for — build is bake-time, peg the cores
#include "world/types.h"  // kMacroDim, kMacroCells, macro_index

namespace giga {

struct WalkBits {
    // 128^3 = 2,097,152 cells / 64 = 32,768 words = 256 KiB. The division is
    // exact, so there is no ragged last word and word ops never need a tail
    // mask — asserted rather than assumed, because kMacroDim is a tunable
    // ([world/types.h] "flipping kSubDim/kMacroDim is a one-line change").
    static_assert(kMacroCells % 64 == 0, "no ragged last word");
    static constexpr std::size_t kWords = kMacroCells / 64;

    // A vector rather than a C array so an unbuilt WalkBits costs 24 bytes,
    // and the snapshot copy the scheduler takes is a plain vector copy.
    std::vector<std::uint64_t> words;

    bool built() const { return !words.empty(); }

    // `i` is a macro_index — the SAME flat index the grid, the flow fields and
    // CarveResult::dirtyCells all speak, so a dirty-cell drain patches with the
    // number it already holds, no coordinate unpacking.
    bool at(std::size_t i) const {
        return (words[i >> 6] >> (i & 63)) & 1u;
    }
    void set(std::size_t i, bool open) {
        const std::uint64_t bit = std::uint64_t{1} << (i & 63);
        if (open) words[i >> 6] |= bit;
        else      words[i >> 6] &= ~bit;
    }

    // Evaluate `open(x, y, z)` once for every cell. Parallel across z-slices,
    // and that is safe by ALIGNMENT, not by luck: one slice is
    // kMacroDim^2 = 16,384 cells, a multiple of 64, so no word straddles two
    // slices and each worker owns its words outright — the disjoint-writes
    // contract [core/jobs.h] demands for a bit-identical result. The predicate
    // must be a pure function of the cell (both walkability laws are: each
    // reads only the cell's own SubMask), or the parallelism would make the
    // answer depend on scheduling.
    template <class Pred>
    void build(Pred&& open) {
        words.assign(kWords, 0u);
        std::uint64_t* w = words.data();
        parallel_for(kMacroDim, [&open, w](int z) {
            // Assemble each word in a register and store it once: x runs
            // fastest in macro_index, so 64 consecutive x-cells ARE one word.
            std::size_t wi = (static_cast<std::size_t>(z) * kMacroDim * kMacroDim) / 64;
            for (int y = 0; y < kMacroDim; ++y) {
                for (int x0 = 0; x0 < kMacroDim; x0 += 64, ++wi) {
                    std::uint64_t word = 0;
                    for (int b = 0; b < 64; ++b)
                        if (open(x0 + b, y, z))
                            word |= std::uint64_t{1} << b;
                    w[wi] = word;
                }
            }
        });
    }
};

} // namespace giga

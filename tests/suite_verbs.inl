// Verb vocabulary (CANON S12.2-S12.3, rooms-object increment A) — structural
// pins on the generated table, not on tunable data. The numbers themselves are
// data and get retuned; what this suite protects is the SHAPE the canon states
// as law:
//   * shelter tolerates nothing (S13.5: «укрыться 0 — не терпит вовсе») — the
//     flee/panic verb must always be allowed to interrupt;
//   * wander is never urgent (S13.5: «шататься» = the idle floor of demand);
//   * every patience is a real 0..1000 fixed-point, every verb has a display
//     name and a CSV token — the sibling generators key on the tokens.
// Count-vs-CSV drift is the `source_rules` ctest, not this suite.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/verb_table.h"

static void test_verbs_canon_shape() {
    CHECK(kVerbCount > 0);
    // The two ends of the patience scale the canon names as LAW, not tuning.
    CHECK(kVerbPatienceE3[kVerbShelter] == 0);
    CHECK(kVerbPatienceE3[kVerbWander] == 1000);
    bool sawZero = false, sawTop = false;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        CHECK(kVerbPatienceE3[v] <= 1000);
        CHECK(kVerbIds[v] != nullptr && kVerbIds[v][0] != '\0');
        CHECK(kVerbNames[v] != nullptr && kVerbNames[v][0] != '\0');
        sawZero = sawZero || kVerbPatienceE3[v] == 0;
        sawTop = sawTop || kVerbPatienceE3[v] >= 900;
    }
    // The distribution has both a "drop everything" end and a "whenever" end —
    // the reference's shape test (room-balance) reduced to its invariant core.
    CHECK(sawZero);
    CHECK(sawTop);
}

static void test_verbs_tokens_unique() {
    // Ordinals are the save ABI; two rows with one token would alias every
    // verb-indexed vector. The generator refuses duplicates — this pins the
    // same law against a hand-edit of the committed header.
    for (std::size_t a = 0; a < kVerbCount; ++a)
        for (std::size_t b = a + 1; b < kVerbCount; ++b)
            CHECK(std::string_view(kVerbIds[a]) != std::string_view(kVerbIds[b]));
}

static void test_verbs_all() {
    test_verbs_canon_shape();
    test_verbs_tokens_unique();
}

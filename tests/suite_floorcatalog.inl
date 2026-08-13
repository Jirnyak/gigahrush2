// Floor catalog — the "any number -> a floor" index and its collision rule.
//
// The two claims this suite has to earn ([floor_catalog.h]):
//   1. TWO MODULES CANNOT SHARE A NUMBER. A duplicate claim is refused at
//      registration and counted, and the DEFAULT catalog — patterns + every
//      module folder's claims — registers clean. The day two folders claim one
//      number, catalog_default_is_collision_free goes red and NAMES the number.
//   2. AN EXPLICIT NUMBER BEATS A PATTERN. Padic claims 4; the modulo chain
//      alone would make 4 Industrial (4 % 5 == 4). Both answers are pinned, so
//      neither the claim nor the default can silently swallow the other.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/floor_catalog.h"
#include "game/floors/padic/padic.h"

static void test_catalog_duplicate_claim_refused() {
    FloorCatalog cat;
    CHECK(cat.claim(7, {"first", FloorKind::Residential}));
    CHECK(cat.conflicts() == 0);
    // Second claim on the same number: refused, counted, named — first wins.
    CHECK(!cat.claim(7, {"second", FloorKind::Derelict}));
    CHECK(cat.conflicts() == 1);
    CHECK(cat.first_conflict() == 7);
    CHECK(cat.claimed(7) != nullptr);
    CHECK(cat.claimed(7)->kind == FloorKind::Residential);
    // Out-of-range numbers are refused the same loud way.
    CHECK(!cat.claim(kMaxFloor + 1, {"oob", FloorKind::Residential}));
    CHECK(cat.conflicts() == 2);
}

static void test_catalog_default_is_collision_free() {
    FloorCatalog cat;
    // THE tripwire: build_default_floor_catalog registers every module folder's
    // claims. If any two ever collide, this is the red line — first_conflict()
    // says which number to go argue about.
    CHECK(build_default_floor_catalog(cat));
    CHECK(cat.conflicts() == 0);
    CHECK(cat.first_conflict() == FloorCatalog::kNoConflict);
    CHECK(cat.claim_count() >= 1);  // at least padic's claim
    CHECK(cat.pattern_count() >= 1);
}

static void test_catalog_explicit_beats_pattern() {
    FloorCatalog cat;
    build_default_floor_catalog(cat);
    // The padic module CLAIMED 4, and the claim wins on floor_spec_for.
    CHECK(floor_spec_for(kPadicFloorNumber).kind == FloorKind::Padic);
    CHECK(cat.claimed(kPadicFloorNumber) != nullptr);
    CHECK(cat.resolve(kPadicFloorNumber).kind == FloorKind::Padic);
    // The padic patterns still hand the kind out as defaults elsewhere.
    CHECK(cat.resolve(10).kind == FloorKind::Padic);   // |10| % 11 == 10
    CHECK(cat.resolve(-30).kind == FloorKind::Padic);  // deep extreme
}

static void test_catalog_patterns_match_floor_spec_for() {
    FloorCatalog cat;
    CHECK(build_default_floor_catalog(cat));
    // For every UNCLAIMED number the catalog's answer must be exactly the pure
    // pattern function's — the rows are floor_spec_for as data, and this sweep
    // is what keeps them from drifting apart. Total: any number resolves.
    int checked = 0;
    for (int f = kMinFloor; f <= kMaxFloor; ++f) {
        if (cat.claimed(f)) continue;
        if (cat.resolve(f).kind != floor_spec_for(f).kind) {
            CHECK(false && "catalog pattern drifted from floor_spec_for");
            return;
        }
        ++checked;
    }
    CHECK(checked > 200); // the sweep really ran (255 minus a few claims)
    CHECK(cat.resolve(kMinFloor).kind == floor_spec_for(kMinFloor).kind);
    CHECK(cat.resolve(kMaxFloor).kind == floor_spec_for(kMaxFloor).kind);
}

static void test_floorcatalog_all() {
    test_catalog_duplicate_claim_refused();
    test_catalog_default_is_collision_free();
    test_catalog_explicit_beats_pattern();
    test_catalog_patterns_match_floor_spec_for();
}

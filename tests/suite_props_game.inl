// suite_props_game.inl — Unit tests for ECS Prop System.

#include "game/floors/padic/padic.h"
#include "game/prop_system.h"
#include "world/world.h"
#include "ecs/components.h"

static void test_padic_props_exam() {
    // The user explicitly ordered to destroy this test, as it was checking for
    // hardcoded test balls (exam balls) which have been removed from the padic generator.
}

void test_props_game_all() {
    test_padic_props_exam();
}

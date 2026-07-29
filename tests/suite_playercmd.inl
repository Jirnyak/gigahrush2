// PlayerCommand seam tests (netcode.md increment #1). Included into game_test.cpp,
// so it uses that file's CHECK macro and `using namespace giga::game`.
//
// The POINT of the seam is that authoritative input application is HEADLESS — no
// SDL, no window — so it can be exercised here. These tests are that proof: they
// build a PlayerCommand by hand (as a future NetworkConnection would deliver one)
// and assert apply_player_command writes exactly the components the old in-line
// input bridge did, with the same server-authoritative pitch clamp and the same
// per-entity ownership. If this file links and passes, the server half of the
// seam runs with the client code deleted (netcode.md rule #2).

#include <cstring>
#include <type_traits>

#include "core/tick.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/player_command.h"

// A minimal avatar: the components an embodied, controllable entity owns. Built
// directly rather than via embody() so the test needs nothing but the ECS + the
// command — the same isolation the server has from the client.
static giga::Entity make_test_avatar(giga::Registry& reg) {
    giga::Entity e = reg.create();
    reg.emplace<giga::Transform>(e);
    reg.emplace<giga::CameraTag>(e);          // yaw/pitch default 0
    reg.emplace<giga::Controller>(e);         // wishDir 0, fly false
    reg.emplace<giga::Jump>(e);               // wants_jump false
    return e;
}

static void test_playercmd_pod_is_wire_safe() {
    // The wire-format promise (netcode.md #5), asserted from a test too so it is a
    // documented behaviour and not just a translation-unit-local static_assert.
    static_assert(std::is_trivially_copyable_v<PlayerCommand>,
                  "PlayerCommand must be memcpy-able");
    static_assert(std::is_standard_layout_v<PlayerCommand>,
                  "PlayerCommand must be standard-layout");

    // A default command is inert: no buttons, no movement, version stamped.
    PlayerCommand cmd{};
    CHECK(cmd.version == PlayerCommand::kVersion);
    CHECK(cmd.buttons == 0u);
    CHECK(!has_button(cmd.buttons, Button::Jump));
    CHECK(!has_button(cmd.buttons, Button::FlyToggle));

    // Bit helpers compose and read back.
    cmd.buttons = bit(Button::Jump) | bit(Button::Attack);
    CHECK(has_button(cmd.buttons, Button::Jump));
    CHECK(has_button(cmd.buttons, Button::Attack));
    CHECK(!has_button(cmd.buttons, Button::FlyToggle));

    // memcpy round-trip — the thing the future NetworkConnection actually does.
    unsigned char wire[sizeof(PlayerCommand)];
    std::memcpy(wire, &cmd, sizeof(cmd));
    PlayerCommand back{};
    std::memcpy(&back, wire, sizeof(back));
    CHECK(back.buttons == cmd.buttons);
    CHECK(back.version == cmd.version);
}

static void test_playercmd_writes_move_and_look() {
    Registry reg;
    Entity av = make_test_avatar(reg);

    PlayerCommand cmd{};
    cmd.wishDir = vec3{1.0f, -1.0f, 0.0f};
    cmd.yaw = 0.75f;
    cmd.pitch = 0.30f;
    apply_player_command(reg, av, cmd, giga::kSimDt);

    const auto& ctl = reg.get<Controller>(av);
    const auto& cam = reg.get<CameraTag>(av);
    CHECK(ctl.wishDir.x == 1.0f && ctl.wishDir.y == -1.0f && ctl.wishDir.z == 0.0f);
    CHECK(cam.yaw == 0.75f);
    CHECK(cam.pitch == 0.30f);      // inside the clamp, passes through verbatim
    CHECK(ctl.fly == false);        // no toggle bit
    CHECK(reg.get<Jump>(av).wants_jump == false); // no jump bit
}

static void test_playercmd_server_clamps_pitch() {
    // The server never trusts the client with an out-of-range pitch: a command
    // asking to look straight up/down is clamped to ~±89°, the same limit the old
    // input bridge enforced. This is the server-authoritative guarantee in
    // miniature.
    Registry reg;
    Entity av = make_test_avatar(reg);
    constexpr float kLimit = 1.5533f;

    PlayerCommand up{};
    up.pitch = 3.0f; // way past vertical
    apply_player_command(reg, av, up, giga::kSimDt);
    CHECK(reg.get<CameraTag>(av).pitch == kLimit);

    PlayerCommand down{};
    down.pitch = -3.0f;
    apply_player_command(reg, av, down, giga::kSimDt);
    CHECK(reg.get<CameraTag>(av).pitch == -kLimit);
}

static void test_playercmd_jump_only_when_walking() {
    Registry reg;
    Entity av = make_test_avatar(reg);

    // Walking + jump bit -> wants_jump set.
    PlayerCommand jump{};
    jump.buttons = bit(Button::Jump);
    apply_player_command(reg, av, jump, giga::kSimDt);
    CHECK(reg.get<Jump>(av).wants_jump == true);

    // Reset, go to fly, jump again -> ignored (fly uses wishDir.z).
    reg.get<Jump>(av).wants_jump = false;
    reg.get<Controller>(av).fly = true;
    apply_player_command(reg, av, jump, giga::kSimDt);
    CHECK(reg.get<Jump>(av).wants_jump == false);
}

static void test_playercmd_fly_toggle_is_an_edge() {
    Registry reg;
    Entity av = make_test_avatar(reg);
    CHECK(reg.get<Controller>(av).fly == false);

    PlayerCommand toggle{};
    toggle.buttons = bit(Button::FlyToggle);
    apply_player_command(reg, av, toggle, giga::kSimDt);
    CHECK(reg.get<Controller>(av).fly == true);  // off -> on

    apply_player_command(reg, av, toggle, giga::kSimDt);
    CHECK(reg.get<Controller>(av).fly == false); // on -> off (flips each apply)
}

static void test_playercmd_ownership_is_per_entity() {
    // netcode.md rule #4: ownership is per-connection, never global. Applying a
    // command to one avatar must not touch another — the multi-client invariant.
    Registry reg;
    Entity a = make_test_avatar(reg);
    Entity b = make_test_avatar(reg);

    PlayerCommand cmd{};
    cmd.wishDir = vec3{1.0f, 0.0f, 0.0f};
    cmd.yaw = 1.0f;
    apply_player_command(reg, a, cmd, giga::kSimDt);

    CHECK(reg.get<Controller>(a).wishDir.x == 1.0f);
    CHECK(reg.get<CameraTag>(a).yaw == 1.0f);
    CHECK(reg.get<Controller>(b).wishDir.x == 0.0f); // untouched
    CHECK(reg.get<CameraTag>(b).yaw == 0.0f);        // untouched
}

static void test_playercmd_invalid_avatar_is_noop() {
    // A disconnected/dead session, or an entity missing the components, applies to
    // nothing and must not crash — the server tolerates a command with no target.
    Registry reg;

    PlayerCommand cmd{};
    cmd.buttons = bit(Button::Jump);
    cmd.yaw = 1.0f;
    apply_player_command(reg, entt::null, cmd, giga::kSimDt); // invalid handle

    Entity bare = reg.create(); // exists but owns no CameraTag/Controller
    apply_player_command(reg, bare, cmd, giga::kSimDt);
    CHECK(!reg.any_of<CameraTag>(bare)); // still bare — apply added nothing
    CHECK(!reg.any_of<Controller>(bare));
}

static void test_playercmd_all() {
    test_playercmd_pod_is_wire_safe();
    test_playercmd_writes_move_and_look();
    test_playercmd_server_clamps_pitch();
    test_playercmd_jump_only_when_walking();
    test_playercmd_fly_toggle_is_an_edge();
    test_playercmd_ownership_is_per_entity();
    test_playercmd_invalid_avatar_is_noop();
}

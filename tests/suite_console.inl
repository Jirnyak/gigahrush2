// Debug console — registry, parsing, contextual completion, default commands.
//
// The console's contract ([console.h]): commands are DATA rows (duplicate
// registration refused, first wins — the same rule as FloorCatalog::claim);
// arguments complete from the live tables (kMobTokens, the FloorRegistry), so
// a CSV row or a registered floor shows up with no console edit; cross-floor
// effects are REQUESTS (requestFloor), never direct mutations. All headless —
// the ImGui overlay in main.cpp is a shell this suite never needs.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/console.h"

static bool consoletest_ran = false;
static bool consoletest_cmd(ConsoleContext&, int argc, const char* const* argv,
                            char* out, std::size_t cap) {
    consoletest_ran = true;
    std::snprintf(out, cap, "argc=%d last=%s", argc,
                  argc > 1 ? argv[argc - 1] : "-");
    return true;
}

static void test_console_registry_rules() {
    Console con;
    CHECK(con.add({"probe", "probe", "test row", consoletest_cmd, nullptr}));
    // Duplicate name: refused, first registration wins — a typo'd double
    // registration is a red test, not a silent shadow.
    CHECK(!con.add({"probe", "probe2", "usurper", consoletest_cmd, nullptr}));
    CHECK(con.count() == 1);
    CHECK(!con.add({"", "", "no name", consoletest_cmd, nullptr}));
    CHECK(!con.add({"norun", "norun", "no handler", nullptr, nullptr}));
    CHECK(con.find("probe") != nullptr);
    CHECK(con.find("absent") == nullptr);

    // The default set registers clean — and stays clean when someone adds a
    // command whose name collides, because THIS line goes red.
    Console defaults;
    CHECK(console_register_defaults(defaults));
    CHECK(defaults.find("spawn") != nullptr);
    CHECK(defaults.find("god") != nullptr);
    CHECK(defaults.find("noclip") != nullptr);
    CHECK(defaults.find("teleport") != nullptr);
    CHECK(defaults.find("tp") != nullptr);
    CHECK(defaults.find("help") != nullptr);
    CHECK(defaults.find("ride") != nullptr);
    CHECK(defaults.find("fly") != nullptr);
    CHECK(defaults.find("save") != nullptr);
    CHECK(defaults.find("menu") != nullptr);
    CHECK(defaults.find("interact") != nullptr);
}

static void test_console_requests() {
    // Request rows never mutate anything — they set ONE bit each and the app
    // performs the effect at its safe point ([console.h] ConsoleRequest, the
    // generic sibling of requestFloor). No context wiring needed: the rows are
    // pure by construction, which is what lets a bound key fire them safely
    // from the event loop.
    Console con;
    CHECK(console_register_defaults(con));
    ConsoleContext ctx;
    char out[128];

    CHECK(con.exec(ctx, "fly", out, sizeof out));
    CHECK(ctx.requestBits == request_bit(ConsoleRequest::Fly));
    CHECK(con.exec(ctx, "save", out, sizeof out));
    CHECK(con.exec(ctx, "menu", out, sizeof out));
    CHECK(ctx.requestBits == (request_bit(ConsoleRequest::Fly) |
                              request_bit(ConsoleRequest::Save) |
                              request_bit(ConsoleRequest::Menu)));
    // take_requests drains: once handed to the app, the bits are gone.
    CHECK(ctx.take_requests() == (request_bit(ConsoleRequest::Fly) |
                                  request_bit(ConsoleRequest::Save) |
                                  request_bit(ConsoleRequest::Menu)));
    CHECK(ctx.requestBits == 0);
    CHECK(ctx.take_requests() == 0);

    // ride <up|down> -> one direction bit; anything else refused, bits clean.
    CHECK(con.exec(ctx, "ride up", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::FloorUp));
    CHECK(con.exec(ctx, "ride down", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::FloorDown));
    CHECK(!con.exec(ctx, "ride sideways", out, sizeof out));
    CHECK(!con.exec(ctx, "ride", out, sizeof out));
    CHECK(ctx.take_requests() == 0);

    // Completion knows the two directions.
    const char* cands[8];
    CHECK(con.complete(ctx, "ride ", cands, 8) == 2);
    CHECK(con.complete(ctx, "ride u", cands, 8) == 1);
    CHECK(std::strcmp(cands[0], "up") == 0);
}

static void test_console_exec_and_parse() {
    Console con;
    CHECK(con.add({"probe", "probe", "test row", consoletest_cmd, nullptr}));
    ConsoleContext ctx;
    char out[128];
    consoletest_ran = false;
    CHECK(con.exec(ctx, "  probe  one   two ", out, sizeof out));
    CHECK(consoletest_ran);
    CHECK(std::strcmp(out, "argc=3 last=two") == 0);
    // Unknown command and empty line: refused with a message, never a crash.
    CHECK(!con.exec(ctx, "warp 5", out, sizeof out));
    CHECK(out[0] != '\0');
    CHECK(!con.exec(ctx, "   ", out, sizeof out));
}

static void test_console_mob_tokens() {
    // The generated latin tokens round-trip: every row's token resolves back to
    // its own kind, ASCII-case-insensitively, and garbage resolves to Count.
    for (std::size_t i = 0; i < kMobKindCount; ++i)
        CHECK(mob_kind_from_token(kMobTokens[i]) == static_cast<MobKind>(i));
    CHECK(mob_kind_from_token("SBORKA") == MobKind::Sborka);
    CHECK(mob_kind_from_token("no_such_mob") == MobKind::Count);
    CHECK(mob_kind_from_token("") == MobKind::Count);
    CHECK(mob_kind_from_token(nullptr) == MobKind::Count);
}

static void test_console_completion() {
    Console con;
    CHECK(console_register_defaults(con));
    ConsoleContext ctx;
    const char* cands[32];

    // First word -> command names.
    std::uint32_t n = con.complete(ctx, "sp", cands, 32);
    CHECK(n == 1);
    CHECK(std::strcmp(cands[0], "spawn") == 0);

    // spawn's first argument -> mob tokens from the generated table.
    n = con.complete(ctx, "spawn sbork", cands, 32);
    CHECK(n == 1);
    CHECK(std::strcmp(cands[0], "sborka") == 0);
    n = con.complete(ctx, "spawn s", cands, 32);
    CHECK(n > 1); // sborka, shadow, spirit, ...

    // teleport's floor list is CONTEXTUAL: it enumerates the registry, so an
    // empty context completes to nothing and a wired one to what is registered.
    n = con.complete(ctx, "teleport ", cands, 32);
    CHECK(n == 0);
    FloorRegistry freg;
    freg.assign(5, 0);
    freg.assign(-26, 1);
    ctx.floors = &freg;
    n = con.complete(ctx, "teleport ", cands, 32);
    CHECK(n == 2);
    n = con.complete(ctx, "teleport -", cands, 32);
    CHECK(n == 1);
    CHECK(std::strcmp(cands[0], "-26") == 0);
}

static void test_console_spawn_god_noclip() {
    Registry ecs;
    NpcPool pool;
    // A live "player": Transform mid-floor is all spawn/god/noclip read.
    Entity player = ecs.create();
    Transform tr;
    tr.pos = vec3{64.0f, 64.0f, 8.0f};
    tr.layer = 0;
    ecs.emplace<Transform>(player, tr);
    ecs.emplace<Controller>(player);

    Console con;
    CHECK(console_register_defaults(con));
    ConsoleContext ctx;
    ctx.ecs = &ecs;
    ctx.pool = &pool;
    ctx.player = player;
    ctx.currentFloor = -26;
    char out[192];

    // spawn <mob> [count] spawns real, full-component mobs on the player's layer.
    CHECK(count_layer_mobs(ecs, 0) == 0);
    CHECK(con.exec(ctx, "spawn sborka 3", out, sizeof out));
    CHECK(count_layer_mobs(ecs, 0) == 3);
    // Level comes from the floor's V-shape tier, not a hardcoded 1.
    {
        const std::uint8_t want =
            static_cast<std::uint8_t>(floor_mob_tier(ctx.currentFloor));
        bool levelled = true;
        for (auto e : ecs.view<const MobRef>())
            levelled &= ecs.get<const MobRef>(e).level == want;
        CHECK(levelled);
    }
    CHECK(!con.exec(ctx, "spawn nosuchmob", out, sizeof out));
    CHECK(!con.exec(ctx, "spawn", out, sizeof out)); // usage, not a crash

    // god: toggles the tag, and the tag really stops THE damage entry point.
    CHECK(!ecs.all_of<GodMode>(player));
    CHECK(con.exec(ctx, "god", out, sizeof out));
    CHECK(ecs.all_of<GodMode>(player));
    {
        Entity mob = *ecs.view<const MobRef>().begin();
        ecs.emplace<GodMode>(mob);
        const std::int16_t before = ecs.get<MobRef>(mob).hp;
        apply_damage(ecs, pool, mob, 10, DamageChannel::Kinetic, entt::null,
                     nullptr);
        CHECK(ecs.get<MobRef>(mob).hp == before); // untouchable
        ecs.remove<GodMode>(mob);
    }
    CHECK(con.exec(ctx, "god", out, sizeof out));
    CHECK(!ecs.all_of<GodMode>(player));

    // noclip: tag + fly follow each other on and off.
    CHECK(con.exec(ctx, "noclip", out, sizeof out));
    CHECK(ecs.all_of<NoClip>(player));
    CHECK(ecs.get<Controller>(player).fly);
    CHECK(con.exec(ctx, "noclip", out, sizeof out));
    CHECK(!ecs.all_of<NoClip>(player));
    CHECK(!ecs.get<Controller>(player).fly);

    // Commands check their context instead of crashing without one.
    ConsoleContext bare;
    CHECK(!con.exec(bare, "spawn sborka", out, sizeof out));
    CHECK(!con.exec(bare, "god", out, sizeof out));
}

static void test_console_teleport_request() {
    Console con;
    CHECK(console_register_defaults(con));
    FloorRegistry freg;
    freg.assign(5, 0);
    ConsoleContext ctx;
    ctx.floors = &freg;
    ctx.currentFloor = 0;
    char out[128];

    // A registered floor becomes a REQUEST — the console never moves the world
    // itself ([console.h] client proposes, server disposes).
    CHECK(con.exec(ctx, "teleport 5", out, sizeof out));
    CHECK(ctx.requestFloor == 5);
    ctx.requestFloor = ConsoleContext::kNoRequest;

    // Unregistered floors and non-numbers are refused, request untouched.
    CHECK(!con.exec(ctx, "teleport 99", out, sizeof out));
    CHECK(ctx.requestFloor == ConsoleContext::kNoRequest);
    CHECK(!con.exec(ctx, "teleport up", out, sizeof out));
    CHECK(!con.exec(ctx, "teleport", out, sizeof out));
    // `tp` is the same row under a second name.
    CHECK(con.exec(ctx, "tp 5", out, sizeof out));
    CHECK(ctx.requestFloor == 5);
}

static void test_console_all() {
    test_console_registry_rules();
    test_console_requests();
    test_console_exec_and_parse();
    test_console_mob_tokens();
    test_console_completion();
    test_console_spawn_god_noclip();
    test_console_teleport_request();
}

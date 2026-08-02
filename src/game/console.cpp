#include "game/console.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "ecs/components.h"      // Transform, Controller, NoClip, Velocity, AABB
#include "game/combat.h"         // GodMode
#include "game/floor_registry.h" // registered-floor enumeration for teleport

#include "game/floor_spec.h"     // floor_mob_tier — spawn at the floor's level
#include "game/mob_spawn.h"      // spawn_mob_at
#include "game/mob_table.h"      // kMobTokens, mob_kind_from_token
#include "world/types.h"         // kCellSize, wrap_macro

namespace giga::game {

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

namespace {

char ascii_lower(char c) { return (c >= 'A' && c <= 'Z') ? char(c - 'A' + 'a') : c; }

bool ieq(const char* a, const char* b) {
    for (; *a && *b; ++a, ++b)
        if (ascii_lower(*a) != ascii_lower(*b)) return false;
    return *a == *b;
}

bool iprefix(const char* prefix, const char* s) {
    for (; *prefix; ++prefix, ++s)
        if (!*s || ascii_lower(*prefix) != ascii_lower(*s)) return false;
    return true;
}

void put(char* out, std::size_t cap, const char* msg) {
    if (!out || cap == 0) return;
    std::snprintf(out, cap, "%s", msg);
}

} // namespace

// Declared in mob_table.h; here because mob_table.cpp is generated and must
// stay hand-edit-free. Linear over 69 rows, runs on a typed command only.
MobKind mob_kind_from_token(const char* token) {
    if (!token || !*token) return MobKind::Count;
    for (std::size_t i = 0; i < kMobKindCount; ++i)
        if (ieq(token, kMobTokens[i])) return static_cast<MobKind>(i);
    return MobKind::Count;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

bool Console::add(const ConsoleCommand& cmd) {
    if (!cmd.name || !*cmd.name || !cmd.run) return false;
    if (count_ >= kMaxCommands) return false;
    if (find(cmd.name)) return false; // first registration wins, duplicate is loud
    commands_[count_++] = cmd;
    return true;
}

const ConsoleCommand* Console::find(const char* name) const {
    if (!name) return nullptr;
    for (std::size_t i = 0; i < count_; ++i)
        if (std::strcmp(commands_[i].name, name) == 0) return &commands_[i];
    return nullptr;
}

bool Console::exec(ConsoleContext& ctx, const char* line, char* out,
                   std::size_t cap) {
    put(out, cap, "");
    if (!line) return false;

    // Tokenize a bounded copy in place. No quoting: arguments are table tokens
    // and numbers by design, and a fixed buffer keeps exec allocation-free.
    char buf[256];
    std::snprintf(buf, sizeof buf, "%s", line);

    const char* argv[kConsoleMaxArgs];
    int argc = 0;
    for (char* p = buf; *p && argc < static_cast<int>(kConsoleMaxArgs);) {
        while (*p == ' ' || *p == '\t') ++p;
        if (!*p) break;
        argv[argc++] = p;
        while (*p && *p != ' ' && *p != '\t') ++p;
        if (*p) *p++ = '\0';
    }
    if (argc == 0) {
        put(out, cap, "(empty)");
        return false;
    }

    const ConsoleCommand* cmd = find(argv[0]);
    if (!cmd) {
        if (out && cap)
            std::snprintf(out, cap, "unknown command '%s' — see `help`", argv[0]);
        return false;
    }
    return cmd->run(ctx, argc, argv, out, cap);
}

std::uint32_t Console::complete(const ConsoleContext& ctx, const char* line,
                                const char** out, std::uint32_t cap) const {
    if (!line || !out || cap == 0) return 0;

    // Split "everything before the word being typed" from that word. A line
    // ending in a space starts a fresh (empty-prefix) word.
    const char* wordStart = line;
    int wordsBefore = 0;
    bool inWord = false;
    for (const char* p = line; *p; ++p) {
        if (*p == ' ' || *p == '\t') {
            if (inWord) ++wordsBefore;
            inWord = false;
        } else {
            if (!inWord) wordStart = p;
            inWord = true;
        }
    }
    if (!inWord) wordStart = line + std::strlen(line); // fresh word, empty prefix

    if (wordsBefore == 0) { // completing the command name itself
        std::uint32_t n = 0;
        for (std::size_t i = 0; i < count_ && n < cap; ++i)
            if (iprefix(wordStart, commands_[i].name)) out[n++] = commands_[i].name;
        return n;
    }

    // Completing an argument: the command is the first word.
    char name[64];
    std::size_t len = 0;
    for (const char* p = line; *p && *p != ' ' && *p != '\t' && len + 1 < sizeof name; ++p)
        name[len++] = *p;
    name[len] = '\0';
    const ConsoleCommand* cmd = find(name);
    if (!cmd || !cmd->complete) return 0;
    return cmd->complete(ctx, wordsBefore, wordStart, out, cap);
}

// ---------------------------------------------------------------------------
// Default commands — each one a data row over the live tables
// ---------------------------------------------------------------------------

namespace {

bool cmd_help(ConsoleContext&, int, const char* const*, char* out,
              std::size_t cap) {
    // The overlay prints per-command usage from the registry itself; this row
    // only has to say so, keeping help output in ONE place (the table).
    put(out, cap, "commands are listed below — <> required, [] optional");
    return true;
}

// --- spawn <mob> [count] ---------------------------------------------------

bool cmd_spawn(ConsoleContext& ctx, int argc, const char* const* argv,
               char* out, std::size_t cap) {
    if (argc < 2) {
        put(out, cap, "usage: spawn <mob> [count] — Tab lists mob tokens");
        return false;
    }
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        put(out, cap, "spawn: no live player to spawn beside");
        return false;
    }
    const MobKind kind = mob_kind_from_token(argv[1]);
    if (kind == MobKind::Count) {
        if (out && cap)
            std::snprintf(out, cap, "spawn: unknown mob '%s' — Tab lists tokens",
                          argv[1]);
        return false;
    }
    long count = argc >= 3 ? std::strtol(argv[2], nullptr, 10) : 1;
    if (count < 1) count = 1;
    if (count > 64) count = 64; // one command must not detonate the frame
    const auto& tr = ctx.ecs->get<Transform>(ctx.player);
    const int cx = static_cast<int>(tr.pos.x / kCellSize);
    const int cy = static_cast<int>(tr.pos.y / kCellSize);
    const std::uint8_t level =
        static_cast<std::uint8_t>(floor_mob_tier(ctx.currentFloor));
    std::uint32_t spawned = 0;
    for (long i = 0; i < count; ++i) {
        // Ring the player at 2..3 cells so a crowd does not stack in one column.
        const int dx = 2 + static_cast<int>(i % 2);
        const int dy = static_cast<int>(i % 5) - 2;
        const Entity e = spawn_mob_at(
            *ctx.ecs, tr.layer, kind, level, wrap_macro(cx + dx),
            wrap_macro(cy + dy), static_cast<std::uint32_t>(i) * 0x9e3779b9u + 1u);
        if (e != entt::null) ++spawned;
    }
    if (out && cap)
        std::snprintf(out, cap, "spawned %u x %s (%s) at L%u", spawned,
                      mob_token(kind), mob_name(kind), level);
    return spawned > 0;
}

std::uint32_t complete_spawn(const ConsoleContext&, int argIndex,
                             const char* prefix, const char** out,
                             std::uint32_t cap) {
    if (argIndex != 1) return 0; // count completes to nothing
    std::uint32_t n = 0;
    for (std::size_t i = 0; i < kMobKindCount && n < cap; ++i)
        if (iprefix(prefix, kMobTokens[i])) out[n++] = kMobTokens[i];
    return n;
}

// --- god / noclip ----------------------------------------------------------

bool cmd_god(ConsoleContext& ctx, int, const char* const*, char* out,
             std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        put(out, cap, "god: no live player");
        return false;
    }
    if (ctx.ecs->all_of<GodMode>(ctx.player)) {
        ctx.ecs->remove<GodMode>(ctx.player);
        put(out, cap, "god OFF");
    } else {
        ctx.ecs->emplace<GodMode>(ctx.player);
        put(out, cap, "god ON");
    }
    return true;
}

bool cmd_noclip(ConsoleContext& ctx, int, const char* const*, char* out,
                std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        put(out, cap, "noclip: no live player");
        return false;
    }
    const bool on = !ctx.ecs->all_of<NoClip>(ctx.player);
    if (on)
        ctx.ecs->emplace<NoClip>(ctx.player);
    else
        ctx.ecs->remove<NoClip>(ctx.player);
    // Fly follows noclip: a wall-phasing walker would fall through the world.
    if (auto* ctl = ctx.ecs->try_get<Controller>(ctx.player)) ctl->fly = on;
    put(out, cap, on ? "noclip ON (fly)" : "noclip OFF (walk)");
    return true;
}

// --- teleport <floor> ------------------------------------------------------

bool cmd_teleport(ConsoleContext& ctx, int argc, const char* const* argv,
                  char* out, std::size_t cap) {
    if (argc < 2) {
        put(out, cap, "usage: teleport <floor> — Tab lists registered floors");
        return false;
    }
    if (!ctx.floors) {
        put(out, cap, "teleport: no floor registry wired");
        return false;
    }
    char* end = nullptr;
    const long f = std::strtol(argv[1], &end, 10);
    if (end == argv[1] || (end && *end)) {
        if (out && cap)
            std::snprintf(out, cap, "teleport: '%s' is not a floor number", argv[1]);
        return false;
    }
    const int floor = static_cast<int>(f);
    if (ctx.floors->module_at(floor) == kInvalidModule) {
        if (out && cap)
            std::snprintf(out, cap,
                          "teleport: floor %d is not registered — Tab lists them",
                          floor);
        return false;
    }
    if (floor == ctx.currentFloor) {
        put(out, cap, "teleport: already there");
        return true;
    }
    // A REQUEST, not a mutation: the app rides the streamer at its safe point
    // in the frame ([console.h] client proposes, server disposes).
    ctx.requestFloor = floor;
    if (out && cap) std::snprintf(out, cap, "teleporting to floor %d...", floor);
    return true;
}

std::uint32_t complete_teleport(const ConsoleContext& ctx, int argIndex,
                                const char* prefix, const char** out,
                                std::uint32_t cap) {
    if (argIndex != 1 || !ctx.floors) return 0;
    // Registered floor numbers as strings. Static scratch: the completion list
    // is consumed before the next call (single console, single thread).
    static char scratch[kFloorSlots][8];
    std::uint32_t n = 0;
    for (int f = kMinFloor; f <= kMaxFloor && n < cap; ++f) {
        if (ctx.floors->module_at(f) == kInvalidModule) continue;
        std::snprintf(scratch[n], sizeof scratch[n], "%d", f);
        if (!iprefix(prefix, scratch[n])) continue;
        out[n] = scratch[n];
        ++n;
    }
    return n;
}

// --- request rows: one bit each, the app performs the effect -----------------
// One handler serves every row: argv[0] IS the row name, so adding an action is
// one table entry here + one bit in ConsoleRequest — no new function.

struct RequestRow {
    const char* name;
    const char* help;
    ConsoleRequest req;
};

constexpr RequestRow kRequestRows[] = {
    {"menu", "toggle the pause menu", ConsoleRequest::Menu},
    {"quit", "quit to desktop", ConsoleRequest::Quit},
    {"hud", "toggle the HUD overlay", ConsoleRequest::Hud},
    {"console", "toggle this console", ConsoleRequest::Console},
    {"mouselook", "toggle mouse look", ConsoleRequest::Mouselook},
    {"fly", "toggle fly mode", ConsoleRequest::Fly},
    {"save", "save the run", ConsoleRequest::Save},
    {"load", "load the saved run", ConsoleRequest::Load},
    {"heal", "use the best medkit", ConsoleRequest::Heal},
    {"eat", "eat the best food carried", ConsoleRequest::Eat},
    {"drink", "drink the best water carried", ConsoleRequest::Drink},
    {"door", "work the nearest door", ConsoleRequest::Door},
    {"possess", "project into the nearest survivor", ConsoleRequest::Possess},
    {"interact", "take the offered job / use what is in front",
     ConsoleRequest::Interact},
    {"sell", "sell the haul (on the extraction pad)", ConsoleRequest::Sell},
    {"vendor", "toggle the trader window", ConsoleRequest::Vendor},
    {"resupply", "buy the resupply package", ConsoleRequest::Resupply},
    {"craft", "toggle the crafting window", ConsoleRequest::Craft},
    {"scrap", "scrap the cheapest junk carried", ConsoleRequest::Scrap},
    // ATTR1 bits are set by cmd_attr (multi-word), not bare request rows.
};

// ATTR1: `attr str|agi|int` — spend one unspent point. The app drains the
// matching ConsoleRequest bit and calls spend_attr_point with pool HP ptrs.
bool cmd_attr(ConsoleContext& ctx, int argc, const char* const* argv,
              char* out, std::size_t cap) {
    if (argc < 2 || !argv[1] || !argv[1][0]) {
        if (out && cap) std::snprintf(out, cap, "usage: attr <str|agi|int>");
        return false;
    }
    ConsoleRequest bit = ConsoleRequest::Count;
    const char* a = argv[1];
    if (std::strcmp(a, "str") == 0 || std::strcmp(a, "STR") == 0)
        bit = ConsoleRequest::AttrStr;
    else if (std::strcmp(a, "agi") == 0 || std::strcmp(a, "AGI") == 0)
        bit = ConsoleRequest::AttrAgi;
    else if (std::strcmp(a, "int") == 0 || std::strcmp(a, "INT") == 0)
        bit = ConsoleRequest::AttrInt;
    else {
        if (out && cap) std::snprintf(out, cap, "attr: want str|agi|int, got %s", a);
        return false;
    }
    ctx.requestBits |= request_bit(bit);
    if (out && cap) std::snprintf(out, cap, "attr %s: requested", a);
    return true;
}

std::uint32_t complete_attr(const ConsoleContext&,
                            int argIndex, const char* prefix,
                            const char** out, std::uint32_t cap) {
    if (argIndex != 1 || !out || cap == 0) return 0;
    static constexpr const char* kOpts[] = {"str", "agi", "int"};
    std::uint32_t n = 0;
    const std::size_t plen = prefix ? std::strlen(prefix) : 0;
    for (const char* o : kOpts) {
        if (plen && std::strncmp(o, prefix, plen) != 0) continue;
        if (n >= cap) break;
        out[n++] = o;
    }
    return n;
}

bool cmd_request(ConsoleContext& ctx, int, const char* const* argv, char* out,
                 std::size_t cap) {
    for (const RequestRow& row : kRequestRows) {
        if (!ieq(argv[0], row.name)) continue;
        ctx.requestBits |= request_bit(row.req);
        if (out && cap) std::snprintf(out, cap, "%s: requested", row.name);
        return true;
    }
    put(out, cap, "request: unknown row"); // unreachable via a registered name
    return false;
}

// --- ride <up|down> --------------------------------------------------------

bool cmd_ride(ConsoleContext& ctx, int argc, const char* const* argv, char* out,
              std::size_t cap) {
    if (argc < 2) {
        put(out, cap, "usage: ride <up|down>");
        return false;
    }
    if (ieq(argv[1], "up")) {
        ctx.requestBits |= request_bit(ConsoleRequest::FloorUp);
        put(out, cap, "riding up...");
        return true;
    }
    if (ieq(argv[1], "down")) {
        ctx.requestBits |= request_bit(ConsoleRequest::FloorDown);
        put(out, cap, "riding down...");
        return true;
    }
    if (out && cap)
        std::snprintf(out, cap, "ride: '%s' is not up or down", argv[1]);
    return false;
}

std::uint32_t complete_ride(const ConsoleContext&, int argIndex,
                            const char* prefix, const char** out,
                            std::uint32_t cap) {
    if (argIndex != 1) return 0;
    static const char* kDirs[] = {"up", "down"};
    std::uint32_t n = 0;
    for (const char* d : kDirs)
        if (n < cap && iprefix(prefix, d)) out[n++] = d;
    return n;
}

// --- carve [radius] [power] -------------------------------------------------
// The universal destruction op ([world/destruct.h]) as a console row. The
// command only PROPOSES a sphere (radius, power); the app aims it ahead of the
// camera and performs it at its safe point — the same client-proposes/
// server-disposes seam every other world mutation rides.

bool cmd_carve(ConsoleContext& ctx, int argc, const char* const* argv,
               char* out, std::size_t cap) {
    float radius = 1.0f;
    long power = 256; // one certain concrete voxel per roll at the centre
    if (argc >= 2) {
        char* end = nullptr;
        radius = std::strtof(argv[1], &end);
        if (end == argv[1] || !(radius > 0.0f)) {
            if (out && cap)
                std::snprintf(out, cap, "carve: '%s' is not a radius (metres)",
                              argv[1]);
            return false;
        }
    }
    if (argc >= 3) {
        char* end = nullptr;
        power = std::strtol(argv[2], &end, 10);
        if (end == argv[2] || power <= 0 || power > 0xFFFF) {
            if (out && cap)
                std::snprintf(out, cap,
                              "carve: '%s' is not a power (1..65535)", argv[2]);
            return false;
        }
    }
    if (radius > 8.0f) radius = 8.0f; // one carve, not a demolition service
    ctx.carveRadius = radius;
    ctx.carvePower = static_cast<std::uint32_t>(power);
    if (out && cap)
        std::snprintf(out, cap, "carve: r=%.2f m, power=%ld — queued", radius,
                      power);
    return true;
}

// --- spawn_ball -------------------------------------------------------------
// Free body on the live physics/render path: Transform + AABB + Renderable
// (BodyPass) and Transform + Velocity + GravityAffected (physics_step).
// AngularVelocity/Rotation are integrated by physics_step when present, but
// spawn_ball does not attach them — tumbling is for RagdollRoll props.

bool cmd_spawn_ball(ConsoleContext& ctx, int argc, const char* const* argv,
                    char* out, std::size_t cap) {
    (void)argc;
    (void)argv;
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "spawn_ball: player or ecs missing");
        return false;
    }
    const auto* tr = ctx.ecs->try_get<Transform>(ctx.player);
    if (!tr) {
        if (out && cap) put(out, cap, "spawn_ball: player has no transform");
        return false;
    }
    // 2 m ahead of look yaw (Z-up), +0.8 m up so it drops into view clear of
    // the player's own AABB instead of embedding in a wall at the feet.
    vec3 offset{2.0f, 0.0f, 0.8f};
    if (const auto* cam = ctx.ecs->try_get<CameraTag>(ctx.player)) {
        const float c = std::cos(cam->yaw);
        const float s = std::sin(cam->yaw);
        offset = vec3{c * 2.0f, s * 2.0f, 0.8f};
    }
    const vec3 spawnPos = tr->pos + offset;

    Entity ball = ctx.ecs->create();
    ctx.ecs->emplace<Transform>(ball, Transform{spawnPos, tr->layer});
    ctx.ecs->emplace<AABB>(ball, AABB{vec3{0.35f, 0.35f, 0.35f}});
    ctx.ecs->emplace<GravityAffected>(ball);
    // Canonical form — same as combat.cpp projectiles. Bare vec3 is not the
    // house style and has been a footgun when aggregate paren-init drifts.
    ctx.ecs->emplace<Velocity>(ball, Velocity{vec3{offset.x * 0.5f, offset.y * 0.5f, 0.0f}});
    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});
    // BodyPass / physics free-body filter ([jirnyak.md] section 18).
    ctx.ecs->emplace<DynamicBodyTag>(ball);

    if (out && cap)
        std::snprintf(out, cap,
                      "spawn_ball: body at (%.1f, %.1f, %.1f) layer %u",
                      spawnPos.x, spawnPos.y, spawnPos.z,
                      static_cast<unsigned>(tr->layer));
    return true;
}

} // namespace

bool console_register_defaults(Console& con) {
    bool ok = true;
    ok &= con.add({"help", "help", "list every command", cmd_help, nullptr});
    ok &= con.add({"spawn", "spawn <mob> [count]",
                   "spawn monsters from the mob table beside the player",
                   cmd_spawn, complete_spawn});
    ok &= con.add({"god", "god", "toggle player invulnerability", cmd_god,
                   nullptr});
    ok &= con.add({"noclip", "noclip", "toggle fly-through-walls", cmd_noclip,
                   nullptr});
    ok &= con.add({"teleport", "teleport <floor>",
                   "jump to any registered floor", cmd_teleport,
                   complete_teleport});
    ok &= con.add({"tp", "tp <floor>", "alias of teleport", cmd_teleport,
                   complete_teleport});
    ok &= con.add({"ride", "ride <up|down>", "ride one floor up or down",
                   cmd_ride, complete_ride});
    ok &= con.add({"carve", "carve [radius] [power]",
                   "blast a sphere out of the world ahead of the camera",
                   cmd_carve, nullptr});
    ok &= con.add({"spawn_ball", "spawn_ball",
                   "spawn a rolling test ball (Type A) beside player",
                   cmd_spawn_ball, nullptr});
    ok &= con.add({"spawn_test_ball", "spawn_test_ball",
                   "alias for spawn_ball",
                   cmd_spawn_ball, nullptr});
    // Every request row shares one handler — argv[0] selects the bit.
    for (const RequestRow& row : kRequestRows)
        ok &= con.add({row.name, row.name, row.help, cmd_request, nullptr});
    // ATTR1 multi-word spender (keybind emits `attr str` etc.).
    ok &= con.add({"attr", "attr <str|agi|int>",
                   "spend one unspent attribute point",
                   cmd_attr, complete_attr});
    return ok;
}

} // namespace giga::game

#include "game/console.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "ecs/components.h"      // Transform, Controller, NoClip, Velocity, AABB
#include "game/combat.h"         // GodMode
#include "game/embody.h"         // NpcRef — hub boarding reads pool cells via body
#include "game/fast_travel.h"    // FastTravelState, fast_travel_gate (§24)
#include "game/floor_registry.h" // registered-floor enumeration for teleport
#include "game/floor_spec.h"     // floor_mob_tier — spawn at the floor's level
#include "game/mob_spawn.h"      // spawn_mob_at
#include "game/mob_table.h"      // kMobTokens, mob_kind_from_token
#include "game/npc_pool.h"       // NpcPool cx/cy for hub boarding
#include "game/prop_system.h"    // SubVoxelAnchor — якорь подвеса spawn_chain
#include "game/prop_table.h"     // prop_id_by_string — cmd_prop, проп из таблицы
#include "sim/camera.h"          // camera_forward — куда ставить проп
#include "sim/rigid.h"           // form_from_box — spawn_box контактные сферы
#include "core/wrap.h"           // wrapf — подвес цепи заворачивается тором
#include "world/anchor.h"        // anchor_face_pack/anchor_alive — подвес
#include "world/material_props.h" // kMatDensity/kMatHardness — spawn_ball derives
#include "world/surface.h"       // surface_face_at — честный якорь cmd_prop
#include "world/materials.h"     // material_id_by_name — cmd_sphere
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
    const int cz = static_cast<int>(tr.pos.z / kCellSize); // the caller's storey
    const std::uint8_t level =
        static_cast<std::uint8_t>(floor_mob_tier(ctx.currentFloor));
    std::uint32_t spawned = 0;
    for (long i = 0; i < count; ++i) {
        // Ring the player at 2..3 cells so a crowd does not stack in one column.
        const int dx = 2 + static_cast<int>(i % 2);
        const int dy = static_cast<int>(i % 5) - 2;
        const Entity e = spawn_mob_at(
            *ctx.ecs, tr.layer, kind, level, wrap_macro(cx + dx),
            wrap_macro(cy + dy), wrap_macro(cz),
            static_cast<std::uint32_t>(i) * 0x9e3779b9u + 1u);
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
    {"relief", "consciously relieve bladder and bowel", ConsoleRequest::Relief},
    {"eat", "eat the best food carried", ConsoleRequest::Eat},
    {"drink", "drink the best water carried", ConsoleRequest::Drink},
    {"door", "work the nearest door", ConsoleRequest::Door},
    {"possess", "project into the nearest survivor", ConsoleRequest::Possess},
    {"interact", "take the offered job / use what is in front",
     ConsoleRequest::Interact},
    {"grenade", "pull the pin on the best grenade carried", ConsoleRequest::Throw},
    {"elevator", "toggle the elevator menu (stand in a shaft)",
     ConsoleRequest::Elevator},
    {"craft", "toggle the crafting window", ConsoleRequest::Craft},
    {"scrap", "scrap the cheapest junk carried", ConsoleRequest::Scrap},
    {"inventory", "toggle the inventory grid", ConsoleRequest::Inventory},
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

// --- fasttravel <floor> / ft <floor> ---------------------------------------
// Lattice-hub jump to an unlocked floor ([elevators.md] §24). Unlike debug
// teleport (any registered floor, keep x/y), this gates on hub boarding + the
// discovery unlock set and lands on the SAME hub index on the destination.

bool cmd_fasttravel(ConsoleContext& ctx, int argc, const char* const* argv,
                    char* out, std::size_t cap) {
    if (argc < 2) {
        put(out, cap,
            "usage: fasttravel <floor> — stand on a lattice hub; Tab lists unlocked");
        return false;
    }
    if (!ctx.fastTravel) {
        put(out, cap, "fasttravel: unlock state not wired");
        return false;
    }
    if (!ctx.floors) {
        put(out, cap, "fasttravel: no floor registry wired");
        return false;
    }
    if (!ctx.pool || !ctx.ecs || ctx.player == entt::null ||
        !ctx.ecs->valid(ctx.player)) {
        put(out, cap, "fasttravel: no live player");
        return false;
    }
    const auto* nr = ctx.ecs->try_get<NpcRef>(ctx.player);
    if (!nr || !ctx.pool->valid(nr->id)) {
        put(out, cap, "fasttravel: player has no pool body");
        return false;
    }
    char* end = nullptr;
    const long f = std::strtol(argv[1], &end, 10);
    if (end == argv[1] || (end && *end)) {
        if (out && cap)
            std::snprintf(out, cap, "fasttravel: '%s' is not a floor number",
                          argv[1]);
        return false;
    }
    const int toFloor = static_cast<int>(f);
    const int cx = static_cast<int>(ctx.pool->cx(nr->id));
    const int cy = static_cast<int>(ctx.pool->cy(nr->id));
    int hub = -1;
    const FastTravelGate gate =
        fast_travel_gate(*ctx.fastTravel, *ctx.floors, ctx.currentFloor, toFloor,
                         cx, cy, &hub);
    switch (gate) {
    case FastTravelGate::Ok:
        break;
    case FastTravelGate::SameFloor:
        put(out, cap, "fasttravel: already there");
        return true;
    case FastTravelGate::NotInCabin:
        put(out, cap,
            "fasttravel: not in a lift cabin (lifts sit on the 2x2 even "
            "lattice nodes)");
        return false;
    case FastTravelGate::Locked:
        if (out && cap)
            std::snprintf(out, cap,
                          "fasttravel: floor %d is locked — board a hub there first",
                          toFloor);
        return false;
    case FastTravelGate::NoFloor:
        if (out && cap)
            std::snprintf(out, cap, "fasttravel: floor %d is not registered",
                          toFloor);
        return false;
    }
    // Boarding a hub discovers THIS floor for the network (elevators.md).
    ctx.fastTravel->unlock(ctx.currentFloor);
    // REQUEST: app drains requestFloor + requestLandHub at frame top.
    ctx.requestFloor = toFloor;
    ctx.requestLandHub = hub;
    if (out && cap)
        std::snprintf(out, cap, "fast-travelling to floor %d via hub %d...",
                      toFloor, hub);
    return true;
}

std::uint32_t complete_fasttravel(const ConsoleContext& ctx, int argIndex,
                                  const char* prefix, const char** out,
                                  std::uint32_t cap) {
    if (argIndex != 1 || !ctx.floors || !ctx.fastTravel) return 0;
    // Unlocked + registered floors only — locked destinations never complete.
    static char scratch[kFloorSlots][8];
    std::uint32_t n = 0;
    for (int f = kMinFloor; f <= kMaxFloor && n < cap; ++f) {
        if (ctx.floors->module_at(f) == kInvalidModule) continue;
        if (!ctx.fastTravel->unlocked(f)) continue;
        std::snprintf(scratch[n], sizeof scratch[n], "%d", f);
        if (!iprefix(prefix, scratch[n])) continue;
        out[n] = scratch[n];
        ++n;
    }
    return n;
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
        std::snprintf(out, cap, "carve: r=%.2f m, power=%ld — next tick", radius,
                      power);
    return true;
}

// --- sphere <material> [radius_m] -------------------------------------------
// ЕДИНЫЙ спавн материи шаром впереди камеры (решение владельца 2026-08-24:
// вместо зоопарка `neon`/`glass` — одна команда, материал ИЗ ТАБЛИЦЫ по
// CSV-имени; новый материал = строка materials.csv, команда узнаёт его без
// правки кода). Зеркало карва: тот же субвоксельный масштаб, тот же
// последующий путь (патч поля светоматериалов -> статик-таблица -> бейк
// видимости). Родился как `neon` для проверки стабильности слотов ламп,
// `sphere glass` проверяет прозрачность для света (neon-topology.md).
bool cmd_sphere(ConsoleContext& ctx, int argc, const char* const* argv,
                char* out, std::size_t cap) {
    if (argc < 2) {
        if (out && cap)
            std::snprintf(out, cap,
                          "sphere <material> [radius_m] — names are "
                          "data/materials.csv rows (water, air, neon_tube, "
                          "...); air = шар воздуха тем же законом");
        return false;
    }
    const CellType mat = material_id_by_name(argv[1]);
    if (mat >= kMatCount) {
        if (out && cap)
            std::snprintf(out, cap, "sphere: unknown material '%s' "
                          "(names are data/materials.csv rows)", argv[1]);
        return false;
    }
    float radius = 0.6f;
    if (argc >= 3) {
        char* end = nullptr;
        radius = std::strtof(argv[2], &end);
        if (end == argv[2] || !(radius > 0.0f)) {
            if (out && cap)
                std::snprintf(out, cap, "sphere: '%s' is not a radius (metres)",
                              argv[2]);
            return false;
        }
    }
    if (radius > 2.0f) radius = 2.0f; // кисть, а не заливка этажа
    ctx.paintRadius = radius;
    ctx.paintMat = mat;
    if (out && cap)
        std::snprintf(out, cap, "sphere: %s r=%.2f m — next tick", argv[1],
                      radius);
    return true;
}

// --- spawn_ball [radius_m] ---------------------------------------------------
// Испытательный стенд рагдолл-ядра ([markoaudit/plans/ragdoll.md] инкремент 1):
// шар на импульсном твердотеле — RigidBody + SelfIntegrating (physics_step его
// НЕ двигает; интегратор — rigid_body_step, сфера↔субвоксель, отскок, трение,
// сон). Бросается вперёд по взгляду, чтобы качение/отскок были видны сразу.
//
// Параметры ВЫВЕДЕНЫ из материала (S11), не назначены: шар — стальной
// (kMatPipeMetal): масса = плотность × (4/3)πr³, инерция сферы = 0.4·m·r².
// Отскок/трение — грубая шкала от hardness до инкремента 2 (пары материалов
// по контакту); числа крутятся глазами владельца — метод эпика.

bool cmd_spawn_ball(ConsoleContext& ctx, int argc, const char* const* argv,
                    char* out, std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "spawn_ball: player or ecs missing");
        return false;
    }
    const auto* tr = ctx.ecs->try_get<Transform>(ctx.player);
    if (!tr) {
        if (out && cap) put(out, cap, "spawn_ball: player has no transform");
        return false;
    }
    // Радиус аргументом; дефолт 0.35 м (прежний габарит стенда). Пол — один
    // субвоксель: шар мельче 0.25/2 проваливается в контактную сетку взгляда.
    float radius = 0.35f;
    if (argc >= 2) {
        radius = std::clamp(static_cast<float>(std::atof(argv[1])),
                            kVoxelSize * 0.5f, 1.0f);
    }
    // Плотность аргументом: дефолт — сталь (7800), и стальной шар r=0.35 —
    // это 1.4 ТОННЫ: игрок (70 кг) честно отлетает от него, а не он от
    // игрока (фидбек владельца 2026-08-21 — это вес, не баг). Полый мяч —
    // spawn_ball 0.35 100 (18 кг, пинается).
    float density = kMatDensity[kMatPipeMetal];
    if (argc >= 3) {
        density = std::clamp(static_cast<float>(std::atof(argv[2])),
                             10.0f, 20000.0f);
    }
    // 2 m ahead of look yaw (Z-up), +0.8 m up so it drops into view clear of
    // the player's own AABB instead of embedding in a wall at the feet.
    vec3 offset{2.0f, 0.0f, 0.8f};
    vec3 fwd{1.0f, 0.0f, 0.0f};
    if (const auto* cam = ctx.ecs->try_get<CameraTag>(ctx.player)) {
        const float c = std::cos(cam->yaw);
        const float s = std::sin(cam->yaw);
        offset = vec3{c * 2.0f, s * 2.0f, 0.8f};
        fwd = vec3{c, s, 0.0f};
    }
    const vec3 spawnPos = tr->pos + offset;

    // Вывод из материала: масса из плотности и объёма; e/μ — общие шкалы
    // от твёрдости ([sim/rigid.h]); сборка — общий rigid_attach_sphere.
    const float mass =
        density * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;
    const float hardness =
        static_cast<float>(kMatHardness[kMatPipeMetal]);           // 180

    Entity ball = ctx.ecs->create();
    ctx.ecs->emplace<Transform>(ball, Transform{spawnPos, tr->layer});
    // AABB — рендер-габарит (BodyPass рисует сферу, вписанную в него).
    ctx.ecs->emplace<AABB>(ball, AABB{vec3{radius, radius, radius}});
    // Canonical form — same as combat.cpp projectiles. Bare vec3 is not the
    // house style and has been a footgun when aggregate paren-init drifts.
    // Бросок 6 м/с вперёд: качение и отскок видны с первого спавна.
    ctx.ecs->emplace<Velocity>(ball, Velocity{fwd * 6.0f});
    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});
    // BodyPass / physics free-body filter ([jirnyak.md] section 18).
    ctx.ecs->emplace<DynamicBodyTag>(ball);
    rigid_attach_sphere(*ctx.ecs, ball, radius, mass,
                        restitution_from_hardness(hardness),
                        friction_from_hardness(hardness));

    if (out && cap)
        std::snprintf(out, cap,
                      "spawn_ball: r=%.2f m, %.0f kg at (%.1f, %.1f, %.1f) L%u",
                      static_cast<double>(radius), static_cast<double>(mass),
                      static_cast<double>(spawnPos.x),
                      static_cast<double>(spawnPos.y),
                      static_cast<double>(spawnPos.z),
                      static_cast<unsigned>(tr->layer));
    return true;
}

// --- equip / unequip / gear — the player's HAND on the decision cells --------
// Экипировка — решение ([equip.h]); у игрока решает не проход ИИ, а этот ввод.
// The trio is the player-side writer of Equipped, the exact counterpart of
// ai_equip_step for AiBrain bodies.

// --- spawn_box [hx hy hz] ----------------------------------------------------
// Стенд формы ([markoaudit/plans/ragdoll.md] инкремент 2): деревянный ящик на
// том же рагдолл-ядре. Автор задаёт БОКС, солвер получает контактные сферы
// (form_from_box: 8 углов + 6 граней) — единственная контактная процедура
// ядра остаётся сферической. Бросается вперёд с подкруткой, чтобы кувырок и
// укладка плашмя были видны сразу.
//
// Вывод параметров (S11): дерево (kMatParquet, 700 кг/м³): масса = плотность ×
// объём бокса; скалярная инерция — среднее диагонали тензора бокса
// I_avg = m·(dx²+dy²+dz²)/18; отскок/трение — та же шкала hardness, что у
// spawn_ball (паркет 48 → e≈0.09, μ≈0.9: падает и ложится, почти не скачет).

bool cmd_spawn_box(ConsoleContext& ctx, int argc, const char* const* argv,
                   char* out, std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "spawn_box: player or ecs missing");
        return false;
    }
    const auto* tr = ctx.ecs->try_get<Transform>(ctx.player);
    if (!tr) {
        if (out && cap) put(out, cap, "spawn_box: player has no transform");
        return false;
    }
    // Полугабариты аргументами; дефолт — пропорции ящика (S14 supply_crate
    // 1.1×1.1×0.9 м / 2). Пол по тонкой стороне — субвоксель.
    vec3 half{0.55f, 0.55f, 0.45f};
    if (argc >= 4) {
        half.x = std::clamp(static_cast<float>(std::atof(argv[1])),
                            kVoxelSize, 1.5f);
        half.y = std::clamp(static_cast<float>(std::atof(argv[2])),
                            kVoxelSize, 1.5f);
        half.z = std::clamp(static_cast<float>(std::atof(argv[3])),
                            kVoxelSize, 1.5f);
    }
    vec3 offset{2.0f, 0.0f, 0.8f};
    vec3 fwd{1.0f, 0.0f, 0.0f};
    if (const auto* cam = ctx.ecs->try_get<CameraTag>(ctx.player)) {
        const float c = std::cos(cam->yaw);
        const float s = std::sin(cam->yaw);
        offset = vec3{c * 2.0f, s * 2.0f, 0.8f};
        fwd = vec3{c, s, 0.0f};
    }
    const vec3 spawnPos = tr->pos + offset;

    const float density = kMatDensity[kMatParquet]; // 700 кг/м³, дерево
    const float dx = half.x * 2.0f, dy = half.y * 2.0f, dz = half.z * 2.0f;
    const float mass = density * dx * dy * dz;
    const float hardness = static_cast<float>(kMatHardness[kMatParquet]);

    Entity box = ctx.ecs->create();
    ctx.ecs->emplace<Transform>(box, Transform{spawnPos, tr->layer});
    // AABB = авторский бокс: BodyPass рисует ровно форму (с кватернионом).
    ctx.ecs->emplace<AABB>(box, AABB{half});
    // Бросок с подкруткой: кувырок виден с первого спавна.
    ctx.ecs->emplace<Velocity>(box, Velocity{fwd * 5.0f});
    ctx.ecs->emplace<Renderable>(box, Renderable{vec3{0.75f, 0.55f, 0.20f}});
    ctx.ecs->emplace<DynamicBodyTag>(box);
    rigid_attach_box(*ctx.ecs, box, half, mass,
                     restitution_from_hardness(hardness),
                     friction_from_hardness(hardness));
    ctx.ecs->get<RigidBody>(box).w =
        vec3{fwd.y * 4.0f, -fwd.x * 4.0f, 0.0f}; // кувырок вперёд

    if (out && cap)
        std::snprintf(out, cap,
                      "spawn_box: %.2fx%.2fx%.2f m, %.0f kg, %u spheres L%u",
                      static_cast<double>(dx), static_cast<double>(dy),
                      static_cast<double>(dz), static_cast<double>(mass),
                      static_cast<unsigned>(
                          ctx.ecs->get<ContactForm>(box).count),
                      static_cast<unsigned>(tr->layer));
    return true;
}

// --- spawn_chain [n] [free|rope] ---------------------------------------------
// Стенд линков ([markoaudit/plans/ragdoll.md] инкремент 3): «шарики на цепях»
// буквально — n стальных шаров, связанных JointLink-СУЩНОСТЯМИ (разрубание =
// destroy линка, cut_link ниже). По умолчанию цепь ПОДВЕШЕНА на мировой якорь
// (линк с b = null) перед игроком — висит и мотается; free — без подвеса,
// падает цепью; rope — связи только тянут (верёвка).
//
// Шаг цепи выведен: restLen = 3r — касание звеньев (2r) плюс зазор в радиус.

bool cmd_spawn_chain(ConsoleContext& ctx, int argc, const char* const* argv,
                     char* out, std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "spawn_chain: player or ecs missing");
        return false;
    }
    const auto* tr = ctx.ecs->try_get<Transform>(ctx.player);
    if (!tr) {
        if (out && cap) put(out, cap, "spawn_chain: player has no transform");
        return false;
    }
    int n = 5;
    if (argc >= 2) n = std::clamp(std::atoi(argv[1]), 2, 12);
    bool anchored = true;
    // Цепь по умолчанию — ВЕРЁВОЧНАЯ (звено только тянет): жёсткое звено
    // толкает тоже, и разрубленная цепь не падает, а стоит колонной на
    // нижнем шаре — честная физика стержней, но не цепи. rod — для стержней
    // (позвоночник трупа, сцепка).
    bool rope = true;
    if (argc >= 3) {
        if (ieq(argv[2], "free")) anchored = false;
        else if (ieq(argv[2], "rod")) rope = false;
    }

    vec3 fwd{1.0f, 0.0f, 0.0f};
    if (const auto* cam = ctx.ecs->try_get<CameraTag>(ctx.player)) {
        fwd = vec3{std::cos(cam->yaw), std::sin(cam->yaw), 0.0f};
    }

    // Подвес — через ЕДИНУЮ якорную систему ([world/anchor.h], S2, решение
    // владельца 2026-08-21: «линк к миру через якоря, как провода»): скан
    // вверх от головы цепи до первого субвокселя с живой колонкой; его нижняя
    // грань — якорь, и карв опоры рвёт линк (anchor_validate_step). Точка в
    // воздухе запрещена: цепь без потолка спавнится свободной, вслух.
    vec3 anchor = tr->pos + fwd * 2.5f + vec3{0.0f, 0.0f, 1.2f};
    anchor.x = wrapf(anchor.x, kWorldExtent);
    anchor.y = wrapf(anchor.y, kWorldExtent);
    anchor.z = wrapf(anchor.z, kWorldExtent);
    SubVoxelAnchor sva{};
    const bool wantAnchor = anchored;
    bool haveSupport = false;
    if (anchored && ctx.stack && ctx.stack->valid(tr->layer)) {
        const World& w = ctx.stack->layer(tr->layer);
        const std::uint8_t face = anchor_face_pack(2, -1); // вещь ПОД опорой
        const int vx = static_cast<int>(anchor.x / kVoxelSize);
        const int vy = static_cast<int>(anchor.y / kVoxelSize);
        const int vz0 = static_cast<int>(anchor.z / kVoxelSize);
        // Скан 3 клетки (6 м) вверх: выше подвес стенда уже не читается.
        for (int vz = vz0; vz < vz0 + 3 * kSubDim; ++vz) {
            const int cx = wrap_macro(vx / kSubDim);
            const int cy = wrap_macro(vy / kSubDim);
            const int cz = wrap_macro(vz / kSubDim);
            const int sx = vx % kSubDim;
            const int sy = vy % kSubDim;
            const int sz = vz % kSubDim;
            const SubMask& mask = w.grid().mask(cx, cy, cz);
            if (!(mask.words[sz] & (1ULL << (sy * kSubDim + sx)))) continue;
            // Гейт = проба живости (один вопрос со спавном пропов): колонка
            // у грани крепления должна жить, иначе якорь умрёт первым карвом.
            const AnchorUV uv = anchor_face_uv(face, sx, sy, sz);
            if (!anchor_alive(w, cx, cy, cz, face, uv.u, uv.v))
                continue;
            anchor = vec3{(static_cast<float>(vx) + 0.5f) * kVoxelSize,
                          (static_cast<float>(vy) + 0.5f) * kVoxelSize,
                          static_cast<float>(vz) * kVoxelSize};
            sva = SubVoxelAnchor{cx, cy, cz,
                                 static_cast<std::uint8_t>(sx),
                                 static_cast<std::uint8_t>(sy),
                                 static_cast<std::uint8_t>(sz), face};
            haveSupport = true;
            break;
        }
    }
    if (anchored && !haveSupport) anchored = false;

    const float radius = 0.15f;
    const float restLen = 3.0f * radius;
    const float density = kMatDensity[kMatPipeMetal];
    const float mass =
        density * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;
    const float hardness = static_cast<float>(kMatHardness[kMatPipeMetal]);

    Entity prev = entt::null;
    for (int i = 0; i < n; ++i) {
        // Лёгкий сдвиг на звено: идеально вертикальная цепь с шар-шар
        // контактом складывается в устойчивую башню (вырожденная симметрия).
        const vec3 pos = anchor +
            fwd * (0.03f * static_cast<float>(i)) -
            vec3{0.0f, 0.0f, restLen * static_cast<float>(i + 1)};
        Entity ball = ctx.ecs->create();
        ctx.ecs->emplace<Transform>(ball, Transform{pos, tr->layer});
        ctx.ecs->emplace<AABB>(ball, AABB{vec3{radius, radius, radius}});
        ctx.ecs->emplace<Velocity>(ball, Velocity{vec3{0.0f, 0.0f, 0.0f}});
        ctx.ecs->emplace<Renderable>(ball,
                                     Renderable{vec3{0.65f, 0.68f, 0.72f}});
        ctx.ecs->emplace<DynamicBodyTag>(ball);
        rigid_attach_sphere(*ctx.ecs, ball, radius, mass,
                            restitution_from_hardness(hardness),
                            friction_from_hardness(hardness));

        // Линк — отдельная сущность: разрубание = её destroy (cut_link).
        if (i == 0) {
            // Глагол якорения (S20.3): мировая точка солвера ВЫВОДИТСЯ из
            // записи якоря внутри link_attach_world — ручной пары
            // «anchorB + запись» здесь больше нет.
            if (anchored)
                link_attach_world(*ctx.ecs, ball, vec3{}, sva, restLen, rope);
        } else {
            link_attach(*ctx.ecs, ball, prev, vec3{}, vec3{}, restLen, rope);
        }
        prev = ball;
    }

    if (out && cap)
        std::snprintf(out, cap, "spawn_chain: %d balls %s%s, cut with cut_link",
                      n,
                      anchored ? "anchored to ceiling"
                               : (wantAnchor ? "free (no ceiling)" : "free"),
                      rope ? "" : " (rod)");
    return true;
}

// --- carry [throw_speed] -----------------------------------------------------
// Переноска ([markoaudit/plans/ragdoll.md] инкремент 9): тоггл — пусты руки,
// берём ближайшее тело; несём — бросаем вперёд. Путь ОДИН на всех носителей
// (S7): NPC и монстры позовут те же две функции, когда AI дорастёт.
// Скорость броска по умолчанию 6 м/с — та же, что у стендового спавна.

bool cmd_carry(ConsoleContext& ctx, int argc, const char* const* argv,
               char* out, std::size_t cap) {
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "carry: player or ecs missing");
        return false;
    }
    float throwSpeed = 6.0f;
    if (argc >= 2)
        throwSpeed = std::clamp(static_cast<float>(std::atof(argv[1])),
                                0.0f, 30.0f);
    vec3 fwd{1.0f, 0.0f, 0.0f};
    if (const auto* cam = ctx.ecs->try_get<CameraTag>(ctx.player)) {
        // Бросок по взгляду, включая наклон: вверх кинуть тоже надо.
        const float cp = std::cos(cam->pitch);
        fwd = vec3{std::cos(cam->yaw) * cp, std::sin(cam->yaw) * cp,
                   std::sin(cam->pitch)};
    }
    const std::uint32_t thrown =
        drop_carried(*ctx.ecs, ctx.player, fwd, throwSpeed);
    if (thrown > 0) {
        if (out && cap)
            std::snprintf(out, cap, "carry: threw %u at %.1f m/s", thrown,
                          static_cast<double>(throwSpeed));
        return true;
    }
    // Дотянуться на 2.5 м — та же дистанция, что у обычной интеракции.
    const Entity taken = carry_nearest_body(*ctx.ecs, ctx.player, fwd, 2.5f);
    if (taken == entt::null) {
        if (out && cap) put(out, cap, "carry: nothing within reach");
        return false;
    }
    if (out && cap) put(out, cap, "carry: picked up (carry again to toss it)");
    return true;
}

// --- cut_link ----------------------------------------------------------------
// Разрубание связи — механика фундамента §8: уничтожить ближайшую
// JointLink-сущность в пределах досягаемости. Обе стороны будятся — обрубок
// обязан упасть, а не висеть замороженным сном в воздухе.

bool cmd_cut_link(ConsoleContext& ctx, int argc, const char* const* argv,
                  char* out, std::size_t cap) {
    (void)argc;
    (void)argv;
    if (!ctx.ecs || ctx.player == entt::null || !ctx.ecs->valid(ctx.player)) {
        if (out && cap) put(out, cap, "cut_link: player or ecs missing");
        return false;
    }
    const auto* tr = ctx.ecs->try_get<Transform>(ctx.player);
    if (!tr) {
        if (out && cap) put(out, cap, "cut_link: player has no transform");
        return false;
    }
    constexpr float kReach = 5.0f; // стенд: дотянуться до подвешенной цепи
    Entity bestLink = entt::null;
    float bestD2 = kReach * kReach;
    auto links = ctx.ecs->view<JointLink>();
    for (auto le : links) {
        const auto& jl = links.get<JointLink>(le);
        vec3 pa{0.0f, 0.0f, 0.0f};
        if (jl.a == entt::null || !ctx.ecs->valid(jl.a) ||
            !ctx.ecs->all_of<Transform>(jl.a))
            continue;
        pa = ctx.ecs->get<Transform>(jl.a).pos;
        vec3 pb = jl.anchorB;
        if (jl.b != entt::null) {
            if (!ctx.ecs->valid(jl.b) || !ctx.ecs->all_of<Transform>(jl.b))
                continue;
            pb = ctx.ecs->get<Transform>(jl.b).pos;
        }
        const vec3 mid = (pa + pb) * 0.5f;
        const vec3 d = mid - tr->pos;
        const float d2 = dot(d, d);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestLink = le;
        }
    }
    if (bestLink == entt::null) {
        if (out && cap) put(out, cap, "cut_link: no link within reach");
        return false;
    }
    // Разбудить обе стороны ДО разруба — обрубок падает, не спит в воздухе.
    const auto jl = ctx.ecs->get<JointLink>(bestLink);
    for (Entity side : {jl.a, jl.b}) {
        if (side != entt::null && ctx.ecs->valid(side) &&
            ctx.ecs->all_of<RigidBody>(side)) {
            auto& rb = ctx.ecs->get<RigidBody>(side);
            rb.asleep = false;
            rb.sleepTicks = 0;
        }
    }
    ctx.ecs->destroy(bestLink);
    if (out && cap) put(out, cap, "cut_link: severed");
    return true;
}

// Shared preamble: the player's pool row id, or false with a put() message.
bool equip_ctx(ConsoleContext& ctx, const char* who, char* out, std::size_t cap,
               NpcId* id) {
    if (!ctx.pool || !ctx.ecs || ctx.player == entt::null ||
        !ctx.ecs->valid(ctx.player)) {
        if (out && cap) std::snprintf(out, cap, "%s: no live player", who);
        return false;
    }
    const auto* nr = ctx.ecs->try_get<NpcRef>(ctx.player);
    if (!nr || !ctx.pool->valid(nr->id)) {
        if (out && cap) std::snprintf(out, cap, "%s: player has no pool body", who);
        return false;
    }
    *id = nr->id;
    return true;
}

bool cmd_equip(ConsoleContext& ctx, int argc, const char* const* argv,
               char* out, std::size_t cap) {
    NpcId id{};
    if (!equip_ctx(ctx, "equip", out, cap, &id)) return false;
    if (argc < 2) {
        put(out, cap, "usage: equip <item id|slot 0..63> (see `gear`)");
        return false;
    }
    const Inventory& inv = ctx.pool->inventory(id);
    // Номер слота ИЛИ имя предмета — тем же словарём, что give: владелец на
    // плейтесте 2026-08-19 написал `equip flashlight` и получил «not a slot
    // 0..63», при том что фонарик лежал в рюкзаке, а give понимает имена.
    // Команды одной консоли обязаны говорить на одном языке.
    char* end = nullptr;
    long idx = std::strtol(argv[1], &end, 10);
    if (end == argv[1] || (end && *end)) {
        idx = -1;
        const ItemId item = item_by_string(argv[1]);
        if (item != kInvalidItem)
            for (int i = 0; i < kInvSlots; ++i)
                if (inv.slots[i].item == item && inv.slots[i].count > 0) {
                    idx = i;
                    break;
                }
        if (idx < 0) {
            if (out && cap)
                std::snprintf(out, cap,
                              "equip: '%s' is neither a slot 0..63 nor an item "
                              "in the backpack",
                              argv[1]);
            return false;
        }
    }
    if (idx < 0 || idx >= kInvSlots) {
        if (out && cap)
            std::snprintf(out, cap, "equip: '%s' is not a slot 0..63", argv[1]);
        return false;
    }
    Equipped& eq = ctx.ecs->get_or_emplace<Equipped>(ctx.player);
    if (!equip_item(inv, eq, static_cast<std::uint8_t>(idx))) {
        if (out && cap)
            std::snprintf(out, cap, "equip: slot %ld is empty or not wearable",
                          idx);
        return false;
    }
    // A changed choice of ARMOUR must reach the Armour component now, same
    // contract as every inventory mutation site. [combat.h] sync_armour
    sync_armour(*ctx.ecs, *ctx.pool, ctx.player);
    if (out && cap)
        std::snprintf(out, cap, "equipped: %s (slot %ld)",
                      item_name(inv.slots[idx].item), idx);
    return true;
}

bool cmd_unequip(ConsoleContext& ctx, int argc, const char* const* argv,
                 char* out, std::size_t cap) {
    NpcId id{};
    if (!equip_ctx(ctx, "unequip", out, cap, &id)) return false;
    EquipSlot slot = EquipSlot::None;
    if (argc >= 2) {
        if (std::strcmp(argv[1], "weapon") == 0) slot = EquipSlot::Weapon;
        else if (std::strcmp(argv[1], "armor") == 0) slot = EquipSlot::Armor;
        else if (std::strcmp(argv[1], "tool") == 0) slot = EquipSlot::Tool;
    }
    if (slot == EquipSlot::None) {
        put(out, cap, "usage: unequip <weapon|armor|tool>");
        return false;
    }
    Equipped& eq = ctx.ecs->get_or_emplace<Equipped>(ctx.player);
    unequip_slot(eq, slot);
    sync_armour(*ctx.ecs, *ctx.pool, ctx.player);
    if (out && cap) std::snprintf(out, cap, "unequipped %s", argv[1]);
    return true;
}

// give <item id|номер строки> [count] — предмет из таблицы в рюкзак игрока.
// Универсально по построению: любой id из data/items.csv, никакого списка
// «разрешённых». Кладёт THE transfer primitive ([item_table.h]
// inventory_give) — та же стековая математика, что у лута и наград.
bool cmd_give(ConsoleContext& ctx, int argc, const char* const* argv,
              char* out, std::size_t cap) {
    NpcId id{};
    if (!equip_ctx(ctx, "give", out, cap, &id)) return false;
    if (argc < 2) {
        put(out, cap, "usage: give <item id|row#> [count] (data/items.csv)");
        return false;
    }
    ItemId item = item_by_string(argv[1]);
    if (item == kInvalidItem) {
        char* end = nullptr;
        const long v = std::strtol(argv[1], &end, 10);
        if (end != argv[1] && end && !*end && v >= 1 &&
            v <= static_cast<long>(kItemCount))
            item = static_cast<ItemId>(v);
    }
    if (item == kInvalidItem) {
        if (out && cap)
            std::snprintf(out, cap, "give: unknown item '%s'", argv[1]);
        return false;
    }
    long count = 1;
    if (argc >= 3) {
        char* end = nullptr;
        count = std::strtol(argv[2], &end, 10);
        if (end == argv[2] || (end && *end) || count < 1 || count > 65535) {
            put(out, cap, "give: count must be 1..65535");
            return false;
        }
    }
    Inventory& inv = ctx.pool->inventory(id);
    const std::uint16_t rest =
        inventory_give(inv, item, static_cast<std::uint16_t>(count));
    if (out && cap)
        std::snprintf(out, cap, "given: %s x%ld%s", item_name(item),
                      count - rest, rest ? " (pack full, remainder dropped)" : "");
    return rest < count;
}

// prop <prop id|row#> — якорный проп из data/props.csv в двух метрах перед
// взглядом, якорь — верх первой твёрдой клетки под точкой. Универсально по
// построению, как give: любой id таблицы, никакого белого списка — бочка-
// заряд, ящик, лампа из пола проверяются в игре одной командой (S10:
// «лампочки из пола — да пожалуйста»).
bool cmd_prop(ConsoleContext& ctx, int argc, const char* const* argv,
              char* out, std::size_t cap) {
    if (!ctx.ecs || !ctx.stack || ctx.player == entt::null ||
        !ctx.ecs->valid(ctx.player) || !ctx.ecs->all_of<Transform>(ctx.player)) {
        put(out, cap, "prop: no embodied player");
        return false;
    }
    if (argc < 2) {
        put(out, cap, "usage: prop <prop id|row#> (data/props.csv)");
        return false;
    }
    PropId id = prop_id_by_string(argv[1]);
    if (!prop_valid(id)) {
        char* end = nullptr;
        const long v = std::strtol(argv[1], &end, 10);
        if (end != argv[1] && end && !*end && v >= 0 &&
            v < static_cast<long>(kPropCount))
            id = static_cast<PropId>(v);
    }
    if (!prop_valid(id)) {
        if (out && cap)
            std::snprintf(out, cap, "prop: unknown prop '%s'", argv[1]);
        return false;
    }
    const Transform& tr = ctx.ecs->get<Transform>(ctx.player);
    const CameraTag* cam = ctx.ecs->try_get<CameraTag>(ctx.player);
    // Горизонтальная проекция взгляда — проп ставится на пол, не в потолок.
    vec3 fwd = cam ? camera_forward(cam->yaw, 0.0f) : vec3{1.0f, 0.0f, 0.0f};
    const vec3 at{tr.pos.x + fwd.x * 2.0f, tr.pos.y + fwd.y * 2.0f, tr.pos.z};

    const World& w = ctx.stack->layer(tr.layer);
    const int cx = wrap_macro(static_cast<int>(std::floor(at.x / kCellSize)));
    const int cy = wrap_macro(static_cast<int>(std::floor(at.y / kCellSize)));
    const int cz0 = static_cast<int>(std::floor(at.z / kCellSize));
    int ground = -1;
    // Скан вниз врапает по Z, как всё на торе (прежний `cz0 - dz >= 0`
    // обрезал поиск у нулевой клетки).
    for (int dz = 0; dz < 8; ++dz) {
        const int czq = wrap_macro(cz0 - dz);
        if (w.grid().cell(cx, cy, czq) != kCellAir) {
            ground = czq;
            break;
        }
    }
    if (ground < 0) {
        put(out, cap, "prop: no floor below the aim point");
        return false;
    }
    // Честный якорь пола: грань Z+ (вещь СТОИТ на опоре — шаг от опоры к
    // вещи вверх), точка — из примитива поверхностей. Прежний face=0 был
    // гранью X+ у вещи, стоящей на полу: проба сканировала не ту колонку.
    const std::uint8_t face = anchor_face_pack(2, 1);
    const SurfaceFace sf = surface_face_at(w.grid(), cx, cy, ground, face);
    if (sf.columns == 0) {
        put(out, cap, "prop: floor has no exposed top face");
        return false;
    }
    SubVoxelAnchor sva{};
    sva.cx = sf.cx;
    sva.cy = sf.cy;
    sva.cz = sf.cz;
    sva.subX = sf.su;
    sva.subY = sf.sv;
    sva.subZ = sf.layer;
    sva.face = face;
    const PropDef& d = prop_def(id);
    const vec3 pos{(static_cast<float>(cx) + 0.5f) * kCellSize,
                   (static_cast<float>(cy) + 0.5f) * kCellSize,
                   static_cast<float>(wrap_macro(ground + 1)) * kCellSize +
                       static_cast<float>(d.sizeZMm) * 0.0005f};
    Entity e = spawn_prop_from_id(*ctx.ecs, w, pos, sva, id, tr.layer);
    if (e == entt::null) {
        put(out, cap, "prop: spawn refused");
        return false;
    }
    // RagdollRoll-строка — ЖИВОЕ тело по канону S3 («катается, толкается»),
    // не якорная мебель: немедленный детач переводит её в рагдолл-ядро тем
    // же законом, что отрыв (масса/габарит/материал строки). Закон владельца
    // 2026-08-22: «prop ball» обязан равняться spawn_ball — путь создания
    // не меняет физику. SimpleFall/GpuHandoff остаются якорной статикой.
    if (static_cast<PropFallMode>(d.fallMode) == PropFallMode::RagdollRoll &&
        ctx.bus != nullptr)
        prop_make_dynamic(*ctx.ecs, e, *ctx.bus);
    ctx.propsChanged = true; // статичная шкура PropPass обязана перестроиться
    if (out && cap)
        std::snprintf(out, cap, "prop: %s at cell (%d,%d,%d)%s",
                      prop_id_str(id), cx, cy, ground + 1,
                      prop_is_charge(d) ? " [CHARGE]" : "");
    return true;
}

bool cmd_gear(ConsoleContext& ctx, int, const char* const*, char* out,
              std::size_t cap) {
    NpcId id{};
    if (!equip_ctx(ctx, "gear", out, cap, &id)) return false;
    const Inventory& inv = ctx.pool->inventory(id);
    const Equipped* eq = ctx.ecs->try_get<Equipped>(ctx.player);
    const Equipped none{};
    if (!eq) eq = &none;
    const ItemId w = equipped_item(inv, *eq, EquipSlot::Weapon);
    const ItemId a = equipped_item(inv, *eq, EquipSlot::Armor);
    // One line of decisions, then every wearable slot — the number printed in
    // brackets is exactly the argument `equip` takes.
    int n = std::snprintf(out, cap, "weapon: %s | armor: %s |",
                          w != kInvalidItem ? item_name(w) : "fists",
                          a != kInvalidItem ? item_name(a) : "none");
    for (int i = 0; i < kInvSlots && n > 0 && static_cast<std::size_t>(n) < cap;
         ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) continue;
        if (item_def(s.item).equipSlot ==
            static_cast<std::uint8_t>(EquipSlot::None)) continue;
        n += std::snprintf(out + n, cap - static_cast<std::size_t>(n),
                           " [%d]=%s", i, item_name(s.item));
    }
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
    ok &= con.add({"fasttravel", "fasttravel <floor>",
                   "hub jump to an unlocked floor (lattice cabin boarding)",
                   cmd_fasttravel, complete_fasttravel});
    ok &= con.add({"ft", "ft <floor>", "alias of fasttravel", cmd_fasttravel,
                   complete_fasttravel});
    ok &= con.add({"ride", "ride <up|down>", "ride one floor up or down",
                   cmd_ride, complete_ride});

    ok &= con.add({"carve", "carve [radius] [power]",
                   "blast a sphere out of the world ahead of the camera",
                   cmd_carve, nullptr});
    ok &= con.add({"sphere", "sphere <material> [radius_m]",
                   "spawn a sphere of any materials.csv row ahead of the camera",
                   cmd_sphere, nullptr});
    ok &= con.add({"spawn_ball", "spawn_ball [radius_m] [density]",
                   "spawn a rigid-core test ball (default steel, 100=hollow)",
                   cmd_spawn_ball, nullptr});
    ok &= con.add({"spawn_box", "spawn_box [hx hy hz]",
                   "spawn a tumbling rigid-core box (contact spheres)",
                   cmd_spawn_box, nullptr});
    ok &= con.add({"spawn_chain", "spawn_chain [n] [free|rod]",
                   "spawn rope-linked balls; anchored overhead by default",
                   cmd_spawn_chain, nullptr});
    ok &= con.add({"cut_link", "cut_link",
                   "sever the nearest joint link within reach",
                   cmd_cut_link, nullptr});
    ok &= con.add({"carry", "carry [toss_speed]",
                   "pick up the nearest body; carry again to toss it",
                   cmd_carry, nullptr});
    ok &= con.add({"prop", "prop <id|row#>",
                   "spawn a props.csv prop on the floor ahead (charge rows too)",
                   cmd_prop, nullptr});
    ok &= con.add({"give", "give <item> [count]",
                   "spawn an item from data/items.csv into the pack",
                   cmd_give, nullptr});
    ok &= con.add({"gear", "gear",
                   "show equipped decisions and wearable inventory slots",
                   cmd_gear, nullptr});
    ok &= con.add({"equip", "equip <slot 0..63>",
                   "equip the item in an inventory slot (see `gear`)",
                   cmd_equip, nullptr});
    ok &= con.add({"unequip", "unequip <weapon|armor|tool>",
                   "clear an equip decision back to fists/none",
                   cmd_unequip, nullptr});
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

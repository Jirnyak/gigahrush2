// Debug console — the data-driven command registry behind the ~ overlay.
//
// The console is TWO pieces on the render/sim seam ([ARCHITECTURE.md] §L3):
//   * THIS — the registry, parser, completion and the default command set. Pure
//     game layer: no SDL/Vulkan/ImGui, headless-tested in game_test.
//   * the ImGui overlay in src/app/main.cpp — a thin shell that feeds typed
//     lines in and prints what comes back. Remove it and the console still
//     works (a dedicated-server stdin could drive the same exec()).
//
// DATA-DRIVEN, in both directions:
//   * a command is a ROW (name, usage, help, run, complete) — registering a
//     duplicate name is refused, mirroring FloorCatalog's claim rule;
//   * arguments complete from the live tables, not from hardcoded lists:
//     `spawn` enumerates kMobTokens (generated from data/mobs.csv), `teleport`
//     enumerates the floors actually registered in the FloorRegistry. Add a CSV
//     row or register a floor and the console knows it — no console edit.
//
// CLIENT PROPOSES, SERVER DISPOSES ([netcode-seam]): a command must not yank
// the app's world mid-frame, so cross-floor effects are REQUESTS written into
// the ConsoleContext (requestFloor); the app performs them at its own safe
// point in the frame, exactly like a PlayerCommand.
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/registry.h" // Registry, Entity, entt::null

namespace giga {
class LevelStack;
}

namespace giga::game {

class FloorRegistry;
class FloorCatalog;
class NpcPool;
class EventBus;
struct FastTravelState;

// One-shot actions a command may REQUEST of the app — the generic sibling of
// requestFloor, and the seam the keybinding table ([keybind.h]) dispatches
// through: a bound key, a pause-menu button and a typed console line all set
// the same bit, and the app performs the effect at its safe point in the
// frame. A bit, not a call, because most of these touch app-owned state (the
// pause flag, ImGui windows, the input bridge) the game layer must not see.
enum class ConsoleRequest : std::uint32_t {
    Menu,      // toggle the pause menu
    Quit,      // quit to desktop
    Hud,       // toggle the HUD overlay
    Console,   // toggle the console overlay
    Mouselook, // toggle mouse look
    Fly,       // toggle fly — routed through the input bridge so it stays a
               // PlayerCommand button ([netcode-seam]), unlike noclip
    FloorUp,   // ride one floor up (the `ride` command)
    FloorDown, // ride one floor down
    Save,      // save the run
    Load,      // load the run
    Heal, Eat, Drink,        // survival one-shots
    Relief,    // осознанное облегчение (клавиша P — решение владельца
               // 2026-08-28: «оба канала + спец-клавиша»); невольный канал —
               // автоматика давления в needs, не запрос
    Door, Possess, Interact, // world interaction one-shots
    Throw,     // throw the best grenade in the bag ([combat.h] player_throw_step)
    // (Sell/Vendor/Resupply died with the pad shop — торговля стала сделкой
    // с телом на экране обыска, [conversation.md].)
    Elevator,  // toggle the shaft menu: the three KINDS of transition the manifesto
               // asks for (fast-travel / procedural down / procedural up) offered by
               // ONE set of 16 columns rather than three sets of 16 ([fast_travel.h])
    Craft, Scrap,            // crafting window / scrap cheapest junk
    AttrStr, AttrAgi, AttrInt, // ATTR1: spend one unspent point on STR/AGI/INT
    Inventory, // toggle the inventory grid ([inventory.md] — the ONE cell
               // widget; торговля уже сложилась в него deal-политикой)
    Count
};

constexpr std::uint32_t request_bit(ConsoleRequest r) {
    return 1u << static_cast<std::uint32_t>(r);
}

// Everything a command may act on. Any pointer may be null — a command checks
// what it needs and reports instead of crashing, so the same registry runs
// headless in tests with only the pieces under test wired.
struct ConsoleContext {
    static constexpr int kNoRequest = 0x7fffffff;

    Registry* ecs = nullptr;
    NpcPool* pool = nullptr;
    LevelStack* stack = nullptr;
    FloorRegistry* floors = nullptr;
    const FloorCatalog* catalog = nullptr;
    Entity player = entt::null;
    int currentFloor = 0;

    // Fast-travel unlock bitset ([fast_travel.h] §24). Null in headless tests
    // that never touch `fasttravel`/`ft`. The app owns the state and points
    // this at it each frame via refresh_console_ctx.
    FastTravelState* fastTravel = nullptr;

    // Шина событий — для cmd_prop (перевод RagdollRoll-строки в живое тело
    // публикует PropDetached тем же швом, что честный отрыв).
    EventBus* bus = nullptr;

    // Out: a cross-floor move the APP must perform (see header note). Reset to
    // kNoRequest by the app once handled.
    int requestFloor = kNoRequest;

    // Out: команда заспавнила ЯКОРНЫЙ проп (cmd_prop) — статичная шкура
    // PropPass живёт по флагу propPassNeedsRebuild кадра, и без этого сигнала
    // проп существует в симе, но невидим до чужого ребилда (пойман владельцем
    // на fuel_barrel 2026-08-22). Тот же шов, что requestFloor: консоль
    // просит, приложение исполняет в своей безопасной точке.
    bool propsChanged = false;

    // Out: planar lattice hub (0..15) to land on when requestFloor is a fast
    // travel. -1 means keep mirrored x/y (debug `teleport` / ±1 ride). The app
    // drains this together with requestFloor at its safe point.
    int requestLandHub = -1;

    // Out: a pending sphere carve ([world/destruct.h]) — the command proposes
    // size and power only; the app aims it from the camera and performs it on
    // the NEXT sim tick. Бейк-гейта НЕТ и очереди за воркером НЕТ: воркер
    // читает снапшот, никогда грид, дыра режется тем же тиком (прежняя
    // проза «stays queued until the bake lands» устарела вместе с гейтом и
    // запутала владельца 2026-08-22). radius in metres; <= 0 = none pending.
    float carveRadius = 0.0f;
    std::uint32_t carvePower = 0;

    // СПАВН МАТЕРИИ ШАРОМ (команды `neon` 2026-08-23 и `glass` 2026-08-24):
    // родить шар материала впереди камеры — симметрия карва, тот же
    // субвоксельный масштаб и тот же путь пересветки. Появился ради проверки
    // стабильности слотов ламп (нужен способ РОЖДАТЬ и УБИВАТЬ лампы по
    // команде); стекло — проверка прозрачности для света. Радиус в метрах,
    // <= 0 = ничего не ждёт; материал — id строки materials.csv.
    float paintRadius = 0.0f;
    std::uint16_t paintMat = 0;

    // Out: one-shot action requests (ConsoleRequest bits). The app drains them
    // once per frame with take_requests() at its safe point.
    std::uint32_t requestBits = 0;

    std::uint32_t take_requests() {
        const std::uint32_t bits = requestBits;
        requestBits = 0;
        return bits;
    }
};

inline constexpr std::size_t kConsoleMaxArgs = 8;

// Execute the command: argv[0] is the command name, argv[1..argc-1] the args.
// Write a human-readable result into out (always NUL-terminated by exec) and
// return false for "understood but failed" (bad arg, missing context).
using ConsoleRunFn = bool (*)(ConsoleContext& ctx, int argc,
                              const char* const* argv, char* out,
                              std::size_t cap);

// Enumerate completions for argument `argIndex` (1 = first arg after the name)
// that start with `prefix`, writing up to `cap` STATIC strings into out[] and
// returning the count. Static lifetime is the contract — candidates come from
// tables (kMobTokens) or per-call scratch owned by the provider.
using ConsoleCompleteFn = std::uint32_t (*)(const ConsoleContext& ctx,
                                            int argIndex, const char* prefix,
                                            const char** out, std::uint32_t cap);

// One command row. `complete` may be null (no argument completion).
struct ConsoleCommand {
    const char* name = "";
    const char* usage = "";
    const char* help = "";
    ConsoleRunFn run = nullptr;
    ConsoleCompleteFn complete = nullptr;
};

class Console {
public:
    static constexpr std::size_t kMaxCommands = 64;

    // Register a row. Refused (false) on a duplicate name, a null run, or a
    // full table — the same first-wins rule as FloorCatalog::claim, so a typo'd
    // double registration is a red test, not a silent shadow.
    bool add(const ConsoleCommand& cmd);

    // The row named `name` (case-sensitive), or nullptr.
    const ConsoleCommand* find(const char* name) const;

    // Tokenize `line` (spaces separate; no quoting — commands take numbers and
    // table tokens) and dispatch. Unknown commands and empty lines are false
    // with a message in `out`. `out` is always written and NUL-terminated.
    bool exec(ConsoleContext& ctx, const char* line, char* out, std::size_t cap);

    // Contextual completion for a partial `line`:
    //   * completing the FIRST word -> command names with that prefix;
    //   * completing a later word   -> that command's complete() provider.
    // Returns how many candidates were written into out[].
    std::uint32_t complete(const ConsoleContext& ctx, const char* line,
                           const char** out, std::uint32_t cap) const;

    std::size_t count() const { return count_; }
    const ConsoleCommand& at(std::size_t i) const { return commands_[i]; }

private:
    ConsoleCommand commands_[kMaxCommands] = {};
    std::size_t count_ = 0;
};

// Register the universal command set: help, spawn <mob> [count], god, noclip,
// teleport <floor>, ride <up|down>, plus one request row per ConsoleRequest
// action (fly, save, load, heal, eat, drink, door, possess, interact, sell,
// vendor, resupply, craft, scrap, attr str/agi/int, hud, menu, console,
// mouselook, quit).
// Returns false if any row was refused (a duplicate — pinned green by the
// test suite).
bool console_register_defaults(Console& con);

} // namespace giga::game

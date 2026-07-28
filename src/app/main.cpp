// gigahrush2 entry point.
//
// Brings up an SDL3 window + Vulkan, builds the level stack, seeds an alife
// population and embodies one of its records as the player (who owns the
// CameraTag + Controller — the "player is just an embodied record" model,
// [npcs.md]), and runs a fixed-timestep sim loop against a variable-rate render
// loop with an ImGui HUD.
//
// The default world is the floor-MODULE stack: several distinct 128^3 floors,
// each themed by its FloorKind (floor_gen.h / floors.md) and wired through a
// FloorRegistry. Only the ACTIVE floor is kept live — its World is generated and
// its crowd embodied on entry, and folded back into the cold pool on exit
// (streaming, floor_stream.h / master_prompt #9). `[` and `]` ride down/up a
// floor. `gigahrush2 maze` selects the single-world labyrinth test bed instead.
//
// Controls: WASD move, mouse look (hold right mouse / press Tab to toggle),
// Space jump, F toggles fly, [ / ] change floor, Esc quits.
#include <SDL3/SDL.h>
#include <SDL3/SDL_vulkan.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "imgui.h"
#include "imgui_impl_sdl3.h"

#include "app/worldgen.h"
#include "core/math.h"
#include "game/mob_table.h"
#include "core/tick.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"
#include "game/elevator.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/mob_spawn.h"
#include "game/needs.h"
#include "game/rumour.h"
#include "game/samosbor.h"
#include "game/contract.h"
#include "game/vendor.h"
#include "game/container.h"
#include "game/combat.h"
#include "game/extraction.h"
#include "game/faction_relations.h"
#include "game/loot.h"
#include "game/weapon_table.h"
#include "game/event_bus.h"
#include "game/wander.h"
#include "game/npc_pool.h"
#include "game/population.h"
#include "input/input.h"
#include "render/body_pass.h"
#include "render/cube_pass.h"
#include "render/gpu_timer.h"
#include "render/imgui_layer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "render/vk_swapchain.h"
#include "render/screenshot.h"
#include "sim/camera.h"
#include "sim/controller.h"
#include "sim/fluid.h"
#include "sim/physics.h"
#include "world/level_stack.h"
#include "world/nav.h"
#include "world/nav_async.h"

using namespace giga;

namespace {

constexpr int kWinW = 1280;
constexpr int kWinH = 720;

// Fixed sim step (seconds). Physics + controller run at this rate; rendering is
// uncapped and interpolation is skipped for simplicity (the step is small).
// The sim tick rate now lives in core/tick.h so the tests can see the same number.
// See that header for why it is 125 and not 120.

// Lighting tunables, packed into the dead lanes of CubePush (see cube.frag).
// The floors are windowless interiors, so the headlamp the player carries is the
// primary light and ambient is deliberately near-black; raise kAmbient and the
// world flattens back into an evenly-lit mosaic.
constexpr float kLampIntensity = 2.2f;  // camPos.w
constexpr float kLampRadius = 14.0f;    // fog.z, metres (7 macro cells)
constexpr float kFillStrength = 0.10f;  // sunDir.w, weak non-black backstop
constexpr float kAmbient = 0.35f;       // fog.w, scales the hemispheric term
// How much of the DIRECT light (headlamp + fill) baked AO is allowed to occlude.
// Ambient is always fully occluded; this is the share of the lamp, and it is a dial
// because occluding a direct light is not physical — it is a legibility choice. At
// 0 AO is nearly invisible in this scene, because ambient is only ~8% of the image
// here (see cube.frag). 0.65 reads as contact shadow without making corridors feel
// like caves.
constexpr float kAoDirect = 0.65f;
// How far the world closes in at the peak of a samosbor, as a fraction of the normal
// fog end. The fog is the ONLY visual the hazard has right now, and it is deliberately
// a range squeeze rather than a colour: fog mixes to BLACK and the encode satisfies
// f(0) == 0, which is what hides the toroidal wrap seam ([cube.frag]). Tinting the fog
// would break that unless the clear colour moved with it, and a visible seam is the
// worst failure this renderer has. Pulling the range IN is strictly safe — more fog
// hides the seam harder, never less.
constexpr float kSamosborFogSqueeze = 0.34f;

// The player's unencumbered walk speed. Named here because the survival clock now
// scales it every tick, so the base value has to live somewhere that is not the
// Controller it overwrites — otherwise the first exhausted tick would halve the
// speed and the second would halve the already-halved value, decaying to zero.
// Matches Controller::moveSpeed's own default ([components.h]).
// What one R press spends on supplies. A fixed budget rather than a shopping UI: the
// interesting decision is HOW MUCH of the run to convert back into survival, not which
// of 446 items to click. [vendor.h]
constexpr std::int32_t kResupplyBudget = 600;

constexpr float kPlayerWalkSpeed = 6.0f;       // fog.w, scales the hemispheric term

// The demo floor stack: one row per floor MODULE. Numbers are the in-game labels
// the FloorRegistry assigns (floors.md); kinds are picked to show every geometry
// family side by side. Floor 0 is the residential hub the player starts on.
struct DemoFloor {
    int number;
    game::FloorKind kind;
};
//
// The numbers are DEEP on purpose, and this is a correction rather than content.
// The stack used to be 0..4, and every depth budget in the game keys off |z|:
//
//   * `anchor_for_floor` snaps anything within a few floors of 0 to FloorBit::Z0, so
//     all five floors drew from the same habitat slice of the 69-kind roster.
//   * `samosbor_duty01` at |z| <= 4 is ~2%, so the depth gradient the samosbor clock
//     exists to produce was invisible — one duty figure, five floors.
//   * `economy_band` put every floor in E0, capping loot at 90 roubles, so the
//     extraction loop's entire risk/reward curve was flat.
//
// Three shipped systems were therefore unobservable, and no test would have said so
// because each of them is correct in isolation. The anchors the mob ecology actually
// authors are {-50, -36, -26, 0, +14, +30}, so the stack now reaches them: the hub,
// two shallow floors, then the four descending anchors and the two above.
constexpr DemoFloor kDemoFloors[] = {
    {0, game::FloorKind::Residential},   // start / hub — E0, samosbor ~2% duty
    {1, game::FloorKind::Commercial},
    {2, game::FloorKind::Industrial},
    {-8, game::FloorKind::Derelict},     // E1
    {-14, game::FloorKind::Industrial},  // E2
    {-26, game::FloorKind::Derelict},    // anchor ZMinus26 — E3
    {-36, game::FloorKind::Industrial},  // anchor ZMinus36
    {-50, game::FloorKind::Derelict},    // anchor ZMinus50 — E4, samosbor ~94% duty
    {14, game::FloorKind::Commercial},   // anchor ZPlus14 — up is depth too
    {30, game::FloorKind::Residential},  // anchor ZPlus30
};

// How far the world has closed in, as a multiplier on the fog range.
//
// The fog is the only visual a samosbor has right now. It ramps IN over the first
// fifth of the Active phase and eases back OUT across the Aftermath, so one number —
// `samosbor_phase01` — produces both halves with no extra state to keep in sync.
//
// A squeeze and NOT a tint, deliberately: fog mixes to black and the encode satisfies
// f(0) == 0, which is what hides the toroidal wrap seam ([cube.frag]). Tinting would
// break that unless the clear colour moved with it, and a visible seam is the worst
// failure this renderer has. Pulling the range in is strictly safe — more fog hides
// the seam harder, never less.
float samosbor_fog_scale(const game::SamosborState& st) {
    const float p = game::samosbor_phase01(st);
    if (st.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active)) {
        const float in_ = p < 0.2f ? p / 0.2f : 1.0f;
        return 1.0f - (1.0f - kSamosborFogSqueeze) * in_;
    }
    if (st.phase == static_cast<std::uint8_t>(game::SamosborPhase::Aftermath))
        return kSamosborFogSqueeze + (1.0f - kSamosborFogSqueeze) * p;
    return 1.0f;
}

// Point the fresh player's camera somewhere interesting and start in fly mode
// (F toggles) so the view is free to explore.
void aim_player(Registry& reg, Entity player) {
    auto& cam = reg.get<CameraTag>(player);
    cam.yaw = 0.8f;
    cam.pitch = -0.5f;
    reg.get<Controller>(player).fly = true;
}

// Maze test bed: seed a plain crowd on one layer, pin the player to an open maze
// cell (the labyrinth has no apartment lattice), and return the player entity.
Entity setup_maze(game::NpcPool& pool, Registry& reg, LayerId layer) {
    game::NpcId playerId =
        game::seed_floor_population(pool, /*floor=*/0, /*n=*/64, /*seed=*/1337u);
    if (playerId == game::kInvalidNpc) return entt::null;

    vec3 mazeCell{30.0f, 30.0f, 90.0f};
    pool.cx(playerId) = static_cast<std::uint8_t>(mazeCell.x);
    pool.cy(playerId) = static_cast<std::uint8_t>(mazeCell.y);
    pool.cz(playerId) = static_cast<std::uint8_t>(mazeCell.z);

    Entity player = entt::null;
    for (game::NpcId id = 0; id < pool.count(); ++id) {
        if (!pool.alive(id)) continue;
        if (id == playerId)
            player = game::embody_as_player(reg, pool, id, layer);
        else
            game::embody(reg, pool, id, layer);
    }
    if (player != entt::null) aim_player(reg, player);
    return player;
}

// Look up the rule-set for a demo floor by its in-game number.
const game::FloorSpec* spec_for_floor(int number) {
    for (const DemoFloor& f : kDemoFloors)
        if (f.number == number) return &game::floor_spec(f.kind);
    return nullptr;
}
const DemoFloor* demo_floor(int number) {
    for (const DemoFloor& f : kDemoFloors)
        if (f.number == number) return &f;
    return nullptr;
}

// Ceiling on how many monsters one floor may add. The V-shape budget saturates
// at 4096 on the deepest floors, which shares a pool with the embodied crowd and
// would be a large one-frame allocation; the demo floors (|number| <= 4) are far
// below this anyway, so it is a guard rail rather than a live limit.
constexpr std::uint32_t kMobSpawnCap = 600;

// Repopulate the active floor's monsters: clear whatever was on the layer, then
// spawn this floor's roster from the global table ([monsters.md]). Mobs are not
// alife records — they do not fold back, they are simply destroyed and remade,
// deterministically per (floor, seed).
// Containers are placed on the same trigger as monsters and with the same
// determinism, so a floor you leave and return to holds the same crates in the same
// rooms. Kept separate from refresh_floor_mobs because an emptied container is world
// state a save must eventually keep, while a monster is not ([container.h]).
std::uint32_t refresh_floor_containers(Registry& reg, const World& world,
                                      int floorNumber, LayerId layer) {
    // Clear whatever the previous occupant of this layer slot left behind.
    std::vector<Entity> old_;
    for (auto e : reg.view<const game::Container, const Transform>())
        if (reg.get<const Transform>(e).layer == layer) old_.push_back(e);
    for (Entity e : old_) reg.destroy(e);

    const DemoFloor* df = demo_floor(floorNumber);
    if (!df) return 0;
    return game::spawn_floor_containers(
        reg, world, floorNumber, df->kind, layer,
        /*seed=*/0xC0FFEEu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        /*cap=*/64);
}

std::uint32_t refresh_floor_mobs(Registry& reg, const World& world, int floorNumber,
                                 LayerId layer) {
    game::despawn_layer_mobs(reg, layer);
    const DemoFloor* df = demo_floor(floorNumber);
    if (!df) return 0;
    const game::FloorSpec& spec = game::floor_spec(df->kind);
    // `df->kind` twice, deliberately: the theme drives the head-count multiplier and
    // the kind drives the ROOM PITCH that packs are placed by. theme_for_kind is not
    // invertible, so the spawner cannot recover the second from the first.
    return game::spawn_floor_mobs(
        reg, world, floorNumber, game::danger_for_hostility(spec.hostility),
        game::theme_for_kind(df->kind), layer,
        /*seed=*/0xB0B5EEDu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        kMobSpawnCap, df->kind);
}

// Kick off this floor's navigation bake on a worker thread.
//
// This used to block: coarse ~1.9 s + fine ~1.8 s, measured, so every elevator ride
// froze the frame for ~3.7 s. The bake is not naive — it is already fanned across
// all 20 hardware threads by core/jobs.h — it is simply a lot of work (128 wrapped
// BFS over a 128^3 grid). performance.md declares load time unbounded, so the
// freeze was within contract and still the worst thing the player felt.
//
// Now the player moves, looks, fights and loots immediately; the floor's crowd
// stands still until the bake lands, because wander_step no-ops on an empty flow
// field. That degradation is automatic rather than special-cased.
void begin_floor_nav(const World& world, nav::AsyncBake& bake) {
    bake.start(world.grid());
}

// Called once the bake has landed: hand the new floor's inhabitants somewhere to
// walk. Separate from begin_floor_nav because it can only run after the swap.
std::uint32_t finish_floor_nav(Registry& reg, LayerId layer, std::uint32_t seed,
                               const nav::AsyncBake& bake) {
    std::uint32_t n = game::wander_init(reg, layer, seed);
    std::fprintf(stderr,
                 "[nav] bake coarse %.0f ms | fine %.0f ms | %u agents wandering "
                 "(async, off the main thread)\n",
                 bake.last_coarse_ms(), bake.last_fine_ms(), n);
    return n;
}

// Wake up in someone else's body.
//
// There is no player singleton: the player IS whichever entity holds a CameraTag
// plus a Controller ([npcs.md], embody.h). So death is not a special case needing
// a save-game — it is losing those two components and gaining them somewhere else.
// This picks a living resident already embodied on the floor and hangs the camera
// on it. The building carries on; you are just someone new in it.
//
// Returns entt::null when the floor has nobody left to be, which is the honest
// end state and the caller must handle it.
Entity possess_a_survivor(Registry& reg, game::NpcPool& pool, LayerId layer) {
    // Choose first, mutate after: adding a component while a view is being
    // iterated can dangle that view if EnTT has to grow its pool container. The
    // pools involved here already exist, so this is insurance rather than a fix —
    // but it is the same rule combat.cpp had to learn the hard way.
    Entity chosen = entt::null;
    game::NpcId chosenId = game::kInvalidNpc;
    for (auto e : reg.view<const game::NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;      // already the player
        const game::NpcId id = reg.get<const game::NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;
        chosen = e;
        chosenId = id;
        break;
    }
    if (chosen == entt::null) return entt::null;

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    std::fprintf(stderr, "[death] possessed record %u\n", chosenId);
    return chosen;
}

} // namespace

int main(int argc, char** argv) {
    // World select: `gigahrush2 maze` for the labyrinth test bed, otherwise the
    // floor-module stack (default).
    WorldGenMode genMode = WorldGenMode::FloorStack;
    // --shot FILE [--frames N] [--ride N]: render, capture, exit.
    //
    // Visual work has to be looked at, and grabbing the window through the compositor
    // proved unreliable — another window can come to the front between focusing the
    // game and copying the pixels, and then the "proof" is a screenshot of a browser.
    // This reads the presented swapchain image directly and quits, so the window is up
    // for a couple of seconds instead of indefinitely. [screenshot.h]
    const char* shotPath = nullptr;
    int shotFrames = 600;    // ~10 s at 60 Hz: long enough for the first nav bake
    int shotRide = 0;        // floors to descend before capturing
    int shotFramesSeen = 0;
    int shotRideDone = 0;
    gpu::Capture shotCap{};
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "maze") genMode = WorldGenMode::Maze;
        else if (a == "floors" || a == "stack") genMode = WorldGenMode::FloorStack;
        else if (a == "--shot" && i + 1 < argc) shotPath = argv[++i];
        else if (a == "--frames" && i + 1 < argc) shotFrames = std::atoi(argv[++i]);
        else if (a == "--ride" && i + 1 < argc) shotRide = std::atoi(argv[++i]);
    }

    if (!SDL_Init(SDL_INIT_VIDEO)) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }

    SDL_Window* window = SDL_CreateWindow(
        "gigahrush2 — voxel core", kWinW, kWinH,
        SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE);
    if (!window) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    gpu::VulkanDevice device;
#ifdef NDEBUG
    const bool wantValidation = false;
#else
    const bool wantValidation = true;
#endif
    if (!device.init(window, wantValidation)) {
        std::fprintf(stderr, "Vulkan device init failed\n");
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    gpu::VulkanRenderer renderer;
    if (!renderer.init(device, window)) {
        std::fprintf(stderr, "Renderer init failed\n");
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    gpu::CubePass cubePass;
    if (!cubePass.init(device, renderer.renderPass, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "Cube pass init failed\n");
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // Draws the population: one instanced, lit box per embodied entity, sharing
    // the world pass's render pass + depth so bodies and voxels occlude cleanly.
    gpu::BodyPass bodyPass;
    if (!bodyPass.init(device, renderer.renderPass, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "Body pass init failed\n");
        cubePass.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    gpu::ImGuiLayer hud;
    if (!hud.init(device, window, renderer.renderPass,
                  static_cast<std::uint32_t>(renderer.swap().images.size()))) {
        std::fprintf(stderr, "ImGui init failed\n");
        bodyPass.destroy();
        cubePass.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // --- World + ECS setup -------------------------------------------------
    // Build the world population-first, then embody the player from it ([npcs.md]).
    LevelStack stack;
    Registry reg;
    // Navigation for the ONE live floor. Re-baked on every floor entry; ~128 MiB
    // for the flow fields, which is affordable precisely because streaming keeps
    // a single floor resident (performance.md).
    // Baked asynchronously; owns both the live graph the tick reads and the
    // pending one a worker fills (world/nav_async.h).
    nav::AsyncBake nav;
    game::NpcPool pool;
    pool.init();
    // Transient event ring ([events.md]). Combat publishes deaths into it; it is
    // cleared once per frame, so a listener must consume within the frame or use
    // the opt-in log.
    game::EventBus bus;
    bus.init();
    game::FloorRegistry registry;

    // Streaming keeps only the ACTIVE floor's World + crowd live; every other
    // floor folds into the cold pool (floor_stream.h, master_prompt #9). This is
    // what makes a deep 2^20-person building affordable: the sim tick is O(live
    // entities), so exactly one floor's worth is ever simulated.
    game::FloorStreamer streamer;

    int currentFloor = 0;                         // in-game label of the live floor
    const game::FloorSpec* currentSpec = nullptr; // its rule-set (HUD only)

    Entity player = entt::null;

    if (genMode == WorldGenMode::Maze) {
        LayerId ground = stack.push_layer();
        generate_demo_world(stack.layer(ground), 1337u, genMode);
        player = setup_maze(pool, reg, ground);
    } else {
        // Register every floor MODULE (number -> module + build recipe), then
        // load ONLY floor 0. The rest stay cold until the elevator enters them,
        // and leaving a floor folds its crowd back — re-entry re-embodies the same
        // records, so the population never grows per visit.
        streamer.init(stack, /*keepRadius=*/0);
        for (const DemoFloor& f : kDemoFloors) {
            // Vary the seed per floor so same-kind floors still differ.
            std::uint32_t fseed =
                1337u ^ (static_cast<std::uint32_t>(f.number) * 0x9e3779b9u);
            streamer.add_module(registry, f.number, f.kind, fseed);
        }

        game::NpcId playerId = game::kInvalidNpc;
        game::LoadResult start =
            streamer.ensure_loaded(stack, registry, reg, pool, 0, playerId);
        player = start.player;
        currentFloor = 0;
        currentSpec = spec_for_floor(0);
        if (player != entt::null) {
            aim_player(reg, player);
            LayerId l0 = reg.get<Transform>(player).layer;
            refresh_floor_mobs(reg, stack.layer(l0), 0, l0);
            refresh_floor_containers(reg, stack.layer(l0), 0, l0);
            begin_floor_nav(stack.layer(l0), nav);
        }
    }

    if (player == entt::null) {
        std::fprintf(stderr, "population seeding failed to embody a player\n");
        hud.destroy();
        bodyPass.destroy();
        cubePass.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    InputState input;
    // Start with mouse-look on so the camera rotates immediately. Tab toggles
    // it (freeing the cursor for the HUD); holding the right mouse button also
    // engages look while held.
    input.set_mouselook(true);
    SDL_SetWindowRelativeMouseMode(window, true);

    bool running = true;
    bool paused = false; // Esc pause menu: freezes the sim + frees the cursor
    bool fluidPaused = false;
    float simAccum = 0.0f;
    std::uint64_t prevTicks = SDL_GetPerformanceCounter();
    const double freq = static_cast<double>(SDL_GetPerformanceFrequency());

    // CPU time spent inside each pass's record(), reported in the HUD. The HUD is
    // built before the passes run, so these carry last frame's figures — which is
    // what you want anyway when reading a steady-state number. This exists so
    // "the renderer is slow" is a measurement and not a guess: it separates the
    // CPU instance-build cost from GPU fill/present cost, which need opposite
    // fixes.
    float cubeMs = 0.0f;
    float bodyMs = 0.0f;

    // Sim tick index. Drives the wander stagger, which spreads the crowd's
    // steering across kWanderPeriod ticks with no per-agent scheduling state.
    std::uint64_t simTick = 0;
    std::uint32_t meleeHits = 0;   // cumulative, for the HUD
    // The samosbor clock. One per live floor; the demo keeps one floor live, so one
    // clock, re-armed on arrival ([samosbor.h]).
    game::SamosborRng sbRng{0x5A303B0Du};
    game::SamosborState samosbor = game::samosbor_new_game(sbRng);
    std::uint32_t samosborCycles = 0;
    std::int16_t samosborDamage = 0;
    // The last thing overheard, and when. Held rather than recomputed per frame
    // because a rumour is something you were TOLD — it should stay on screen after you
    // walk away, not vanish the moment the speaker is out of range.
    // The job on offer from whoever is nearest, and the book of taken ones.
    game::ContractBook contracts;
    game::Contract offer{};
    char offerLine[200] = {};
    char rumourLine[160] = {};
    std::uint64_t rumourAt = 0;
    game::NeedsTick needs{};   // last step's report, for the HUD
    int needsHpLost = 0;       // running total, so the HUD is not one tick
    std::uint32_t shots = 0;   // rounds the player has fired
    game::RunLedger ledger;
    std::int32_t banked = 0;
    std::int32_t containerTake = 0;   // roubles pulled out of crates
    std::int32_t contractPaid = 0;    // roubles paid by finished jobs
    std::int32_t sold = 0;            // roubles taken for the haul
    std::int32_t spent = 0;           // roubles spent on supplies
    // Who buys on this floor. The dominant faction sets the sell rate, which gives the
    // faction matrix a second live consumer and makes the territory rumour worth
    // acting on rather than being colour. [vendor.h]
    game::VendorKind vendorKind = game::VendorKind::Citizen;
    std::uint32_t deaths = 0;
    std::uint32_t kills = 0;       // carried across possession
    bool attackHeld = false;
    bool healWanted = false;
    bool sellWanted = false;      // B, consumed by one sim step
    bool buyWanted = false;       // R, consumed by one sim step       // set by H, consumed by one sim step
    std::int32_t loot = 0;         // roubles swept up this run
    std::int32_t healed = 0;
    int fluidStepEvery = 4; // sim steps between fluid updates
    int fluidCounter = 0;

    while (running) {
        std::uint64_t now = SDL_GetPerformanceCounter();
        float frameDt = static_cast<float>((now - prevTicks) / freq);
        prevTicks = now;

        // Events are transient by design ([events.md]): whatever was published
        // last frame has had its chance to be consumed. Clearing here rather than
        // at the end means a consumer added later sees a full frame's batch.
        // Drain the bus BEFORE clearing it. `finalize_deaths` publishes NpcDied with
        // the victim's pool id and the mob kind, which is exactly what a Hunt job needs
        // to count and what a giver's death needs to fail a contract — so both hook the
        // same event the kill feed does rather than inventing a second notion of death.
        for (std::uint32_t i = 0; i < bus.size(); ++i) {
            const game::Event& ev = bus.events()[i];
            if (ev.type != game::EventType::NpcDied) continue;
            // `b` is the mob kind, 0xFF when the dead thing was not a monster.
            if (ev.b != 0xFFu)
                game::contract_on_kill(contracts, static_cast<std::uint8_t>(ev.b));
            // `a` is the pool id, kInvalidNpc when the dead thing had no record. A
            // monster has no record, so this only ever fires for a real person.
            if (ev.a != game::kInvalidNpc)
                game::contract_on_giver_died(contracts, ev.a);
        }
        bus.clear();

        // Hand over a finished nav bake. Cheap every frame; true only on the frame
        // the swap happens, which is when the floor's crowd can start walking.
        if (nav.poll()) {
            const LayerId l = reg.valid(player)
                                  ? reg.get<Transform>(player).layer
                                  : LayerId{0};
            finish_floor_nav(reg, l, 0xA11FEu, nav);
        }
        if (frameDt > 0.1f) frameDt = 0.1f; // clamp after a stall

        // --- events --------------------------------------------------------
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            hud.process_event(e);
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
                // Esc toggles the pause menu (it no longer quits directly — quit
                // is a button in that menu). Pausing frees the mouse cursor so the
                // menu is clickable and the OS window can be moved / minimised.
                if (e.key.scancode == SDL_SCANCODE_ESCAPE) {
                    paused = !paused;
                    input.set_mouselook(!paused);
                    SDL_SetWindowRelativeMouseMode(window, !paused);
                }
                if (!paused && e.key.scancode == SDL_SCANCODE_TAB) {
                    bool on = !input.mouselook();
                    input.set_mouselook(on);
                    SDL_SetWindowRelativeMouseMode(window, on);
                }
                // Floor travel (#8/#9): [ down a floor, ] up a floor. Streams the
                // destination in on demand and folds the departed floor's crowd
                // back into the cold pool, so only ONE floor is ever live. Resolved
                // by floor NUMBER through the FloorRegistry. Cell z=2 is air on
                // every kind's ground storey; the player keeps x/y and fly frees
                // them if boxed in. No-op at the ends of the stack (no module).
                if (!paused && (e.key.scancode == SDL_SCANCODE_LEFTBRACKET ||
                                e.key.scancode == SDL_SCANCODE_RIGHTBRACKET)) {
                    const int dir =
                        e.key.scancode == SDL_SCANCODE_RIGHTBRACKET ? +1 : -1;
                    // Pass the player's durable record id so the destination crowd
                    // skips it instead of spawning a second player.
                    game::NpcId pid = reg.valid(player)
                                          ? reg.get<game::NpcRef>(player).id
                                          : game::kInvalidNpc;
                    game::RideResult ride = streamer.travel(
                        stack, registry, reg, pool, player, currentFloor, dir,
                        /*arrivalZ=*/2, pid);
                    if (ride.moved) {
                        player = ride.player;
                        currentFloor = ride.floor;
                        // Deepest point reached, for the run score. |z|, because
                        // depth is bidirectional: the roof is as far from safety as
                        // the basement. [extraction.h]
                        game::record_floor(ledger, currentFloor);
                        // A new floor gets its own clock at its own depth. Not
                        // carried over: the cooldown is a function of |z|, so
                        // inheriting a 30-minute surface gap into the void would
                        // silently cancel the entire depth gradient.
                        samosbor = game::samosbor_new_game(sbRng);
                        // A rumour is about a FLOOR, so carrying one across a ride
                        // makes it false. Caught on a capture: the line read
                        // "самосбор здесь часто (17.2%)" while the HUD's own duty for
                        // the floor underfoot said 35.0% — the number was true of the
                        // floor the speaker was standing on, two rides ago. The whole
                        // premise of this system is that a rumour is checkable, so a
                        // stale one is worse than none. [rumour.h]
                        rumourLine[0] = 0;
                        rumourAt = 0;
                        currentSpec = spec_for_floor(currentFloor);
                        // Streaming recycles World objects in place, so the cube
                        // pass cannot detect the new geometry by identity.
                        cubePass.invalidate();
                        // Mobs belong to the floor, not to the player: the
                        // departed layer's are destroyed and the arrival's are
                        // spawned fresh (deterministically, so a floor looks the
                        // same every visit).
                        LayerId nl = reg.get<Transform>(player).layer;
                        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
                        refresh_floor_containers(reg, stack.layer(nl),
                                                 currentFloor, nl);
                        begin_floor_nav(stack.layer(nl), nav);
                    }
                }
            }
            // While the pause menu is up, ignore all look/move input: ImGui owns
            // the cursor and the game is frozen.
            if (!paused) {
                // Hold right mouse button to look, release to free the cursor.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_H) {
                    healWanted = true;
                }
                // B sells the haul, R re-supplies. Recorded as INTENT here and acted
                // on in the sim loop, the same shape `healWanted` uses — the event loop
                // has no `activeLayer` in scope, and more importantly a trade is a
                // world mutation and belongs on the sim's clock, not the window's.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_B)
                    sellWanted = true;
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_R)
                    buyWanted = true;
                // E takes the job on offer. The only interaction bind in the game, and
                // it exists because a contract is the one thing the player has to
                // actively agree to — everything else is walked into.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_E) {
                    if (game::contract_accept(contracts, offer, ledger)) {
                        offer = game::Contract{};
                        offerLine[0] = 0;
                    }
                }
                if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN &&
                    e.button.button == SDL_BUTTON_LEFT) {
                    attackHeld = true;
                } else if (e.type == SDL_EVENT_MOUSE_BUTTON_UP &&
                           e.button.button == SDL_BUTTON_LEFT) {
                    attackHeld = false;
                }
                if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN &&
                    e.button.button == SDL_BUTTON_RIGHT) {
                    input.set_mouselook(true);
                    SDL_SetWindowRelativeMouseMode(window, true);
                }
                if (e.type == SDL_EVENT_MOUSE_BUTTON_UP &&
                    e.button.button == SDL_BUTTON_RIGHT) {
                    input.set_mouselook(false);
                    SDL_SetWindowRelativeMouseMode(window, false);
                }
                // Feed movement/look events unless the HUD wants the cursor (only
                // relevant when look is off — relative mode hides the cursor).
                if (input.mouselook() || !ImGui::GetIO().WantCaptureMouse)
                    input.handle_event(e);
            }
        }

        // The layer the player is currently on drives sim + render below.
        LayerId activeLayer = reg.get<Transform>(player).layer;

        // --- fixed-step simulation ----------------------------------------
        // Frozen while the pause menu is up; drop accumulated time so resuming
        // does not fast-forward the missed interval.
        if (paused) {
            simAccum = 0.0f;
        } else {
            simAccum += frameDt;
            int guard = 0;
            while (simAccum >= kSimDt && guard++ < 8) {
                input.apply(reg, kSimDt);
                controller_step(reg, kSimDt);
                // Steer the crowd BEFORE physics: wander writes horizontal
                // velocity, physics integrates it and resolves collision.
                // Samosbor advances HERE — after controller_step, before
                // wander_step — for the three reasons in [samosbor.h]: the seal can
                // kill and must precede finalize_deaths by a whole tick; behaviour
                // systems must never read a stale phase; and anything spawned on a
                // transition needs physics in the same tick.
                {
                    const game::SamosborTransition tr_ =
                        game::samosbor_step(samosbor,
                                            static_cast<std::uint32_t>(
                                                kSimDt * 1000.0f + 0.5f),
                                            currentFloor, sbRng);
                    if (tr_.cycleEnded) ++samosborCycles;
                    // The seal is ONE SHOT, not a per-tick drain. Modelled as a DoT a
                    // 15-minute samosbor at |z|=50 would deal 3600 damage instead of
                    // 4 — the correction that mattered most in the port.
                    if (tr_.sealed && reg.valid(player)) {
                        // No shelter model yet, so everyone is caught outside. That is
                        // the honest placeholder: the cost is real and small, and it
                        // starts meaning something the day shelter exists.
                        const game::DamageResult dr_ = game::apply_damage(
                            reg, pool, player, game::kSamosborUnshelteredHp,
                            game::DamageChannel::Kinetic, player);
                        samosborDamage =
                            static_cast<std::int16_t>(samosborDamage + dr_.applied);
                    }
                }
                // Exhaustion costs movement speed, not HP — three stacking HP
                // drains is a death spiral with no decision in it. Applied to the
                // live Controller each tick rather than baked into it, so recovering
                // sleep restores the speed with nothing to remember. [needs.h]
                if (reg.valid(player))
                    if (auto* ctl_ = reg.try_get<Controller>(player))
                        ctl_->moveSpeed = kPlayerWalkSpeed * needs.speedScale;
                game::wander_step(reg, stack.layer(activeLayer).grid(), pool,
                                  nav.coarse(),
                                  nav.fine(), activeLayer, simTick);
                physics_step(reg, stack, kSimDt);
                // Melee resolves AFTER physics, so reach is tested against where
                // bodies actually ended up this step rather than where they
                // intended to go.
                // The player swings first on a tick, so trading blows is a trade
                // rather than a guaranteed loss to whoever the view yields first.
                // Left mouse routes by loadout: a gun shoots, a fist swings. One
                // button, because there is no weapon-selection UI yet and adding a
                // second bind for a system with no way to choose a weapon would be a
                // control for a choice the player cannot make.
                //
                // `player_ranged_step` is called unconditionally so its cooldown and
                // reload timers advance even on ticks the trigger is not held —
                // gating the whole call on `attackHeld` would freeze a reload the
                // moment you let go.
                bool haveGun = false;
                if (reg.valid(player))
                    if (const auto* nrg = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrg->id))
                            haveGun = game::equipped_ranged(
                                          pool.inventory(nrg->id)) !=
                                      game::kInvalidItem;
                shots += game::player_ranged_step(reg, pool, activeLayer,
                                                  haveGun && attackHeld && !paused,
                                                  kSimDt, simTick);
                game::player_melee_step(reg, pool, bus, activeLayer, kSimDt,
                                        !haveGun && attackHeld && !paused, simTick);
                meleeHits += game::mob_attack_step(reg,
                                   stack.layer(activeLayer).grid(),
                                   pool, bus, activeLayer,
                                                   kSimDt, simTick);
                // Shots resolve AFTER the pass that launched them, so a
                // projectile never lands on the frame it is fired.
                meleeHits += game::projectile_step(
                    reg, pool, bus, stack, activeLayer, kSimDt, simTick);
                // The survival clock is a damage source, so it goes LAST among
                // them and still before finalize_deaths: a monster's blow lands
                // first, and if that already killed you apply_damage refuses the
                // target, so you cannot be billed for starving after you are dead.
                // [needs.h]
                // Overhear the nearest body, at most once every kOverhearCooldownTicks.
                // Without the cooldown, standing in a crowd would replace the line
                // every frame and none of them would be readable — a flicker instead
                // of information. [rumour.h]
                if (simTick - rumourAt >= game::kOverhearCooldownTicks) {
                    const game::NpcId sp = game::nearest_speaker(reg, activeLayer);
                    if (sp != game::kInvalidNpc) {
                        const game::Rumour ru = game::rumour_for(
                            reg, pool, sp, activeLayer, currentFloor);
                        if (game::rumour_text(ru, rumourLine, sizeof(rumourLine)))
                            rumourAt = simTick;
                        // The same body may also be hiring. One proximity sweep, two
                        // payloads — a contract is a thing you walk into, because there
                        // is no talk verb and building one to deliver a sentence would
                        // be the expensive way round. [contract.h]
                        const game::Contract off = game::contract_offer(
                            pool, sp, currentFloor, 0x9E37u);
                        if (off.giver != game::kInvalidNpc &&
                            game::contract_text(off, offerLine, sizeof(offerLine))) {
                            offer = off;
                        }
                    }
                }
                needs = game::needs_step(reg, pool, activeLayer, kSimDt);
                needsHpLost += needs.hpLost;
                // Corpses pay out BEFORE they are destroyed. The gap between
                // "hp hit zero" and "gone" is precisely what the Dead tag exists
                // to create (combat.h defect 2) — the reference's P0 was culling
                // an entity before its loot hook ran.
                // Remember which pool row is the player BEFORE the death point,
                // because after it the entity is gone and the row is the only way
                // back to what was being carried.
                game::NpcId deadRow = game::kInvalidNpc;
                if (reg.valid(player))
                    if (const auto* nr0 = reg.try_get<game::NpcRef>(player))
                        deadRow = nr0->id;
                game::loot_dead_mobs(reg, activeLayer, currentFloor,
                                     static_cast<std::uint32_t>(simTick));
                // ONE death point per tick, after everything that can deal damage
                // (combat.h). Nothing else in the tree destroys a damaged entity.
                deaths += game::finalize_deaths(reg, pool, bus, simTick);
                // Containers first, then loose pickups: a crate emptied this tick
                // should be sweepable in the same tick if the inventory overflowed
                // onto the floor. [container.h]
                const std::int32_t fromBox =
                    game::loot_containers_step(reg, pool, activeLayer);
                if (fromBox != 0) {
                    loot += fromBox;
                    containerTake += fromBox;
                    game::sync_armour(reg, pool, player);
                }
                const std::int32_t got =
                    game::pickup_step(reg, pool, bus, activeLayer, simTick);
                if (got != 0) {
                    loot += got;
                    // Picking a vest up must actually protect you.
                    game::sync_armour(reg, pool, player);
                }
                // Extraction. The pad is the bank: stand on it and the haul
                // becomes permanently yours. Runs every tick, deposits nothing
                // almost every tick, and that is fine — it is a handful of slot
                // reads. [extraction.h]
                if (reg.valid(player)) {
                    const Transform& ptr_ = reg.get<Transform>(player);
                    if (game::on_extraction_pad(
                            stack.layer(activeLayer).grid(), ptr_.pos)) {
                        if (const auto* nrx = reg.try_get<game::NpcRef>(player))
                            if (pool.valid(nrx->id))
                                banked += game::deposit_valuables(
                                    pool.inventory(nrx->id), ledger);
                    }
                }
                // The pad is the shop, and only the pad. A vendor reachable from
                // anywhere would make the walk home pointless, and the walk home IS
                // the extraction loop. [vendor.h]
                if ((sellWanted || buyWanted) && reg.valid(player)) {
                    const Transform& vt = reg.get<Transform>(player);
                    if (game::on_extraction_pad(stack.layer(activeLayer).grid(),
                                                vt.pos)) {
                        if (const auto* nrv = reg.try_get<game::NpcRef>(player))
                            if (pool.valid(nrv->id)) {
                                game::Inventory& vi = pool.inventory(nrv->id);
                                if (sellWanted)
                                    sold += game::vendor_sell_all(vi, ledger,
                                                                 vendorKind);
                                if (buyWanted)
                                    spent += game::vendor_resupply(vi, ledger,
                                                                   kResupplyBudget);
                            }
                    }
                    sellWanted = false;
                    buyWanted = false;
                }
                // Contracts advance and pay AFTER the extraction step, so a Fetch
                // job completes at the pad — the same moment the loop's own payoff
                // lands, which is what makes the errand feel like part of the trip
                // rather than a parallel accounting system. [contract.h]
                if (reg.valid(player))
                    if (const auto* nrc = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrc->id))
                            contractPaid += game::contract_step(
                                contracts, pool, pool.inventory(nrc->id), ledger);
                if (healWanted) {
                    healed += game::use_best_heal(reg, pool, bus, activeLayer,
                                                  simTick);
                    healWanted = false;
                }
                // The player is not exempt: if it died it no longer exists, and
                // everything below reads through it. Take another body now.
                if (!reg.valid(player)) {
                    // Bill the death before taking a new body. The dead pool row
                    // keeps its inventory forever (the pool never reclaims a slot),
                    // so those items are already gone in the only sense that
                    // matters — no living body can reach them. All that was missing
                    // was counting it. [extraction.h]
                    if (pool.valid(deadRow))
                        game::record_death(ledger, pool.inventory(deadRow));
                    // The PlayerMelee component dies with the body; the tally of
                    // what that person killed does not.
                    player = possess_a_survivor(reg, pool, activeLayer);
                    if (player == entt::null) { running = false; break; }
                    aim_player(reg, player);
                    reg.emplace_or_replace<game::PlayerMelee>(
                        player, game::PlayerMelee{0, kills});
                }
                ++simTick;
                // Fluid only lives in the maze test bed (the floor modules seed no
                // puddles yet); step it on the active layer there.
                if (genMode == WorldGenMode::Maze && !fluidPaused &&
                    ++fluidCounter >= fluidStepEvery) {
                    fluid_step(stack.layer(activeLayer));
                    fluidCounter = 0;
                    // Fluid tints cell colours, so the cached instance list is
                    // stale. This is the one place the cache rebuilds regularly —
                    // and only in maze mode, where fluid exists.
                    cubePass.invalidate();
                }
                simAccum -= kSimDt;
            }
        }

        // --- render --------------------------------------------------------
        int fbw = 0, fbh = 0;
        SDL_GetWindowSizeInPixels(window, &fbw, &fbh);
        float aspect = fbh > 0 ? static_cast<float>(fbw) / fbh : 1.0f;
        CameraMatrices camMat = compute_camera(reg, aspect);

        hud.begin_frame();
        {
            ImGui::SetNextWindowPos(ImVec2(10, 10), ImGuiCond_FirstUseEver);
            ImGui::Begin("gigahrush2");
            ImGui::Text("%.1f FPS (%.2f ms)", frameDt > 0 ? 1.0f / frameDt : 0.0f,
                        frameDt * 1000.0f);
            ImGui::Text("cpu record: cube %.2f ms | body %.2f ms", cubeMs, bodyMs);
            // Real GPU time, per pass, from timestamp queries — NOT the frame
            // time above. The frame time is wall-clock around sim + crowd + HUD
            // + the FIFO present wait, so it sits pinned at the vsync period
            // whenever the machine keeps up and cannot see a change below the
            // cap. This line can: it is the GPU's own clock across each pass's
            // draws. Median of 31 frames, and two frames stale by construction
            // (gpu_timer.h). Read it before claiming a shader change is free.
            // Three decimals, not two: the body and HUD passes land in the single
            // microseconds, and printing those as "0.00" reads as "not measured"
            // — the exact false-confidence this whole module exists to remove.
            if (renderer.timer.supported())
                ImGui::Text("gpu: world %.3f | bodies %.3f | hud %.3f | "
                            "frame %.3f ms",
                            renderer.timer.pass_ms(gpu::GpuPass::World),
                            renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms());
            else
                ImGui::TextUnformatted(
                    "gpu: n/a (queue family writes no timestamps)");
            auto& tr = reg.get<Transform>(player);
            auto& ctl = reg.get<Controller>(player);
            auto& ga = reg.get<GravityAffected>(player);
            ImGui::Text("pos  %.1f %.1f %.1f (layer %u)", tr.pos.x, tr.pos.y,
                        tr.pos.z, tr.layer);
            ImGui::Text("mode %s%s", ctl.fly ? "fly" : "walk",
                        ga.grounded ? " (grounded)" : "");
            ImGui::Text("instances drawn: %u / %zu cells",
                        cubePass.last_instance_count(), kMacroCells);
            std::int16_t php = 0, pmax = 0;
            if (game::entity_health(reg, pool, player, php, pmax))
                ImGui::Text("HP %d / %d%s", php, pmax, php <= 0 ? "  DEAD" : "");
            if (reg.valid(player))
                if (const auto* pm = reg.try_get<game::PlayerMelee>(player))
                    kills = pm->kills;
            ImGui::Text("hits taken: %u | deaths: %u | kills: %u", meleeHits,
                        deaths, kills);
            {
                std::int32_t carried = 0;
                int slots = 0;
                const game::NpcRef* nr = reg.valid(player)
                                             ? reg.try_get<game::NpcRef>(player)
                                             : nullptr;
                if (nr && pool.valid(nr->id)) {
                    const game::Inventory& inv = pool.inventory(nr->id);
                    carried = game::inventory_value(inv);
                    for (const auto& sl : inv.slots)
                        if (sl.item != 0) ++slots;

                    const game::ItemId wpn = game::equipped_melee(inv);
                    const game::ItemId arm = game::equipped_armour(inv);
                    const game::MeleeDef* md = game::melee_for_item(wpn);
                    if (!md) md = &game::unarmed_melee();
                    // The firearm, when there is one. Named separately from the
                    // melee line because they are different loadout slots, not two
                    // spellings of the same one.
                    if (const game::ItemId g_ = game::equipped_ranged(inv)) {
                        const game::RangedDef* rd = game::ranged_for_item(g_);
                        const auto* prs = reg.try_get<game::PlayerRanged>(player);
                        if (rd)
                            ImGui::Text("gun: %s  %u x%u dmg  %u/%u mag  "
                                        "%u shots %u hits",
                                        game::item_name(g_), rd->dmg, rd->pellets,
                                        prs ? prs->magCount : 0, rd->magazine,
                                        prs ? prs->shots : 0, prs ? prs->hits : 0);
                    }
                    ImGui::Text("weapon: %s (%u dmg) | armour: %s",
                                wpn == game::kInvalidItem ? "fists"
                                                          : game::item_name(wpn),
                                md->dmg,
                                arm == game::kInvalidItem ? "none"
                                                          : game::item_name(arm));
                }
                {
                    const float share = game::risk_share(ledger, carried);
                    ImGui::Text("BANKED %lld rub | at risk %d (%.0f%% of the run)",
                                static_cast<long long>(ledger.banked), carried,
                                share * 100.0f);
                    ImGui::Text("lost to death %lld | best haul %d | deepest %d (E%u)",
                                static_cast<long long>(ledger.lostToDeath),
                                ledger.bestHaul, ledger.deepestFloor,
                                ledger.deepestBand);
                }
                // Which body you are wearing, and whether the floor wants to eat
                // it. Printed because the mechanic is invisible otherwise: a cultist
                // simply is not attacked, and with no readout that looks like the
                // monsters are broken rather than like safety.
                if (nr && pool.valid(nr->id)) {
                    const auto f = static_cast<game::Faction>(
                        pool.faction(nr->id) % game::kFactionCount);
                    if (game::mob_hostile_to(pool, nr->id))
                        ImGui::Text("body: %s  (hunted)", game::faction_name(f));
                    else
                        ImGui::TextColored(ImVec4(0.29f, 0.75f, 0.57f, 1.0f),
                                           "body: %s  (monsters ignore you)",
                                           game::faction_name(f));
                }
                if (reg.valid(player)) {
                    const Transform& vt2 = reg.get<Transform>(player);
                    if (game::on_extraction_pad(stack.layer(activeLayer).grid(),
                                                vt2.pos))
                        ImGui::TextColored(ImVec4(0.29f, 0.75f, 0.57f, 1.0f),
                                           "PAD: banking | B sell haul | R resupply "
                                           "(%d rub) | sold %d spent %d",
                                           kResupplyBudget, sold, spent);
                }
                {
                    int shut = 0, open = 0;
                    for (auto ce : reg.view<const game::Container, const Transform>()) {
                        if (reg.get<const Transform>(ce).layer != activeLayer) continue;
                        if (reg.get<const game::Container>(ce).opened) ++open;
                        else ++shut;
                    }
                    ImGui::Text("crates %d unopened / %d emptied | took %d rub",
                                shut, open, containerTake);
                }
                ImGui::Text("loot %d rub (%d/%d slots) | healed %d | band E%u",
                            carried, slots, game::kInvSlots, healed,
                            game::economy_band(currentFloor));
            }
            // Nearest monster, by name. Doubles as the proof that the Cyrillic font
            // actually loaded: every one of the 69 names is Russian.
            {
                const char* threat = nullptr;
                float bestD2 = 1e30f;
                std::int16_t thp = 0, tmax = 0;
                if (reg.valid(player)) {
                    const vec3 me = reg.get<Transform>(player).pos;
                    for (auto me_ : reg.view<const game::MobRef, const Transform>()) {
                        const Transform& t = reg.get<const Transform>(me_);
                        if (t.layer != activeLayer) continue;
                        const float dx = wrap_delta_f(me.x, t.pos.x, kWorldExtent);
                        const float dy = wrap_delta_f(me.y, t.pos.y, kWorldExtent);
                        const float dz = wrap_delta_f(me.z, t.pos.z, kWorldExtent);
                        const float d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 >= bestD2) continue;
                        bestD2 = d2;
                        const game::MobRef& m = reg.get<const game::MobRef>(me_);
                        threat = game::mob_name(static_cast<game::MobKind>(m.kind));
                        thp = m.hp;
                        tmax = m.maxHp;
                    }
                }
                if (threat)
                    ImGui::Text("nearest: %s  %d/%d hp  %.1f m", threat, thp, tmax,
                                std::sqrt(bestD2));
                else
                    ImGui::TextUnformatted("nearest: -");
            }
            {
                const auto ph = static_cast<game::SamosborPhase>(samosbor.phase);
                const float fogScale = samosbor_fog_scale(samosbor);
                const bool danger =
                    ph == game::SamosborPhase::Warning ||
                    ph == game::SamosborPhase::Active;
                // Red only for the two phases that actually threaten you. The colour
                // is reserved for danger ([faction.h]) and spending it on Idle would
                // spend it on nothing.
                if (danger)
                    ImGui::TextColored(ImVec4(0.90f, 0.31f, 0.36f, 1.0f),
                                       "SAMOSBOR %s  %s  %.0f%%  (%.1f s left)",
                                       game::samosbor_phase_name(ph),
                                       game::samosbor_variant_name(
                                           static_cast<game::SamosborVariant>(
                                               samosbor.variant)),
                                       game::samosbor_phase01(samosbor) * 100.0f,
                                       samosbor.phaseMs * 0.001f);
                else
                    // "to warning" is only true of Idle. In Aftermath phaseMs is the
                    // aftermath's own remainder and the warning is a whole cooldown
                    // away, so labelling both the same way printed a wrong number —
                    // caught by reading my own HUD in a screenshot, not by a test.
                    ImGui::Text("samosbor %s  (%.0f s %s)",
                                game::samosbor_phase_name(ph),
                                samosbor.phaseMs * 0.001f,
                                ph == game::SamosborPhase::Idle ? "to warning"
                                                                : "left");
                ImGui::Text("duty here %.1f%% | cycles %u | fog x%.2f | took %d hp",
                            game::samosbor_duty01(currentFloor) * 100.0f,
                            samosborCycles, fogScale, samosborDamage);
            }
            {
                const game::Needs& nd = [&]() -> const game::Needs& {
                    static game::Needs blank{};
                    if (reg.valid(player))
                        if (const auto* nr_ = reg.try_get<game::NpcRef>(player))
                            if (pool.valid(nr_->id)) return pool.needs(nr_->id);
                    return blank;
                }();
                // Minutes, not percent: the decision this clock exists to force is
                // "do I have time for one more floor", and that is asked in minutes.
                const float toDmg = game::needs_seconds_to_damage(nd);
                const bool warn = needs.warned != 0 || needs.failed != 0;
                if (warn)
                    ImGui::TextColored(ImVec4(0.90f, 0.31f, 0.36f, 1.0f),
                                       "NEEDS food %.0f water %.0f sleep %.0f"
                                       "  | %.1f min to damage%s",
                                       nd.food, nd.water, nd.sleep, toDmg / 60.0f,
                                       needs.failed ? "  BLEEDING" : "");
                else
                    ImGui::Text("needs food %.0f water %.0f sleep %.0f"
                                "  | %.1f min to damage",
                                nd.food, nd.water, nd.sleep, toDmg / 60.0f);
                ImGui::Text("pressure pee %.0f poo %.0f | speed x%.2f | starved %d hp",
                            nd.pee, nd.poo, needs.speedScale, needsHpLost);
            }
            {
                int active = 0;
                for (int i = 0; i < game::kMaxContracts; ++i) {
                    const game::Contract& c = contracts.slot[i];
                    if (c.state != static_cast<std::uint8_t>(
                                      game::ContractState::Active))
                        continue;
                    ++active;
                    char line[200];
                    if (game::contract_text(c, line, sizeof(line)))
                        ImGui::Text("  job: %s  [%d/%d]", line,
                                    static_cast<int>(c.progress),
                                    static_cast<int>(c.target));
                }
                if (offerLine[0])
                    ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f),
                                       "OFFER (E to take): %s", offerLine);
                ImGui::Text("jobs %d active | %u done | %u failed | paid %d rub",
                            active, contracts.completed, contracts.failed,
                            contractPaid);
            }
            if (rumourLine[0])
                ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "\"%s\"",
                                   rumourLine);
            ImGui::Text("nav: %s  (last bake %.0f + %.0f ms, async)",
                        nav.baking() ? "BAKING - crowd idle"
                                     : (nav.ready() ? "ready" : "none"),
                        nav.last_coarse_ms(), nav.last_fine_ms());
            ImGui::Text("mobs: %u live on this floor",
                        game::count_layer_mobs(reg, activeLayer));
            // `alive`, not `count`: count() is the high-water mark of slots ever
            // handed out and cannot decrease, so it was reporting a population that
            // never fell no matter how many died.
            ImGui::Text("bodies drawn: %u  (pop %u alive / %u ever / %u slots)",
                        bodyPass.last_instance_count(), pool.alive(), pool.count(),
                        pool.capacity());
            ImGui::Text("floor %d: %s (target pop %u)", currentFloor,
                        currentSpec ? currentSpec->name : "maze",
                        currentSpec ? currentSpec->population : 64u);
            if (genMode == WorldGenMode::Maze) {
                ImGui::Checkbox("pause fluid", &fluidPaused);
                ImGui::SliderInt("fluid step every", &fluidStepEvery, 1, 30);
            }
            ImGui::TextUnformatted(
                "WASD move | mouse look | Tab toggle look | Space jump | "
                "F fly | [ / ] floor down/up | Esc menu");
            ImGui::End();
        }

        // Pause menu (Esc). A proper, extensible overlay: the sim is frozen and
        // the cursor is free, so this is the home for quit and future items
        // (settings, save/load, floor jump). Labels are ASCII — the default ImGui
        // font ships no Cyrillic glyphs.
        if (paused) {
            ImGuiIO& io = ImGui::GetIO();
            ImGui::SetNextWindowPos(
                ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::Begin("Menu", nullptr,
                         ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings);
            ImGui::TextUnformatted("Paused");
            ImGui::Separator();
            const ImVec2 btn(220.0f, 0.0f);
            if (ImGui::Button("Resume", btn)) {
                paused = false;
                input.set_mouselook(true);
                SDL_SetWindowRelativeMouseMode(window, true);
            }
            // --- future menu items go here (settings, save/load, floor jump) ---
            ImGui::Spacing();
            if (ImGui::Button("Quit", btn)) running = false;
            ImGui::End();
        }

        // Clear to black so fogged-out geometry blends into the void seamlessly
        // (fog fades to black at the toroidal render radius).
        if (renderer.begin_frame(window, 0.0f, 0.0f, 0.0f)) {
            VkCommandBuffer cmd = renderer.current_cmd();
            gpu::CubePush push{};
            push.viewProj = mat4_mul(camMat.proj, camMat.view);
            push.sunDir = vec4{0.4f, 0.3f, 0.85f, kFillStrength};
            push.camPos = vec4{camMat.eye.x, camMat.eye.y, camMat.eye.z,
                               kLampIntensity};
            // Fog fades to black between 0.30 and 0.50 of the torus period. The
            // end (kWorldExtent/2 = 64 cells) is the minimal-image radius, so
            // the wrap seam is always hidden inside full-black fog.
            const float fogScale = samosbor_fog_scale(samosbor);
            push.fog = vec4{kWorldExtent * 0.30f * fogScale,
                            kWorldExtent * 0.50f * fogScale,
                            kLampRadius, kAmbient};
            // The wrap period, so cube.vert can place each cell at its nearest
            // toroidal image itself. Instance origins are absolute, which is what
            // makes the cube pass's instance cache possible.
            push.torus = vec4{kWorldExtent, kAoDirect, 0.0f, 0.0f};
            // Each pass is bracketed by GPU timestamps as well as by the CPU
            // clock: the two answer different questions and need opposite fixes.
            // The CPU figure is time spent building instance data on this thread;
            // the GPU figure is what the hardware then spent rasterising it.
            std::uint64_t t0 = SDL_GetPerformanceCounter();
            renderer.timer.pass_begin(cmd, gpu::GpuPass::World);
            cubePass.record(cmd, renderer.currentFrame,
                            stack.layer(activeLayer), push);
            renderer.timer.pass_end(cmd, gpu::GpuPass::World);
            std::uint64_t t1 = SDL_GetPerformanceCounter();
            // Draw the embodied population on the active layer (shared depth).
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Bodies);
            bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push);
            renderer.timer.pass_end(cmd, gpu::GpuPass::Bodies);
            std::uint64_t t2 = SDL_GetPerformanceCounter();
            cubeMs = static_cast<float>((t1 - t0) / freq * 1000.0);
            bodyMs = static_cast<float>((t2 - t1) / freq * 1000.0);
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Hud);
            hud.render(cmd);
            renderer.timer.pass_end(cmd, gpu::GpuPass::Hud);
            renderer.end_frame(window);

            // --shot: count presented frames, then capture and quit. Counted here
            // rather than in the event loop so a skipped frame (swapchain out of
            // date, window minimised) does not count toward the budget — otherwise a
            // capture on a machine that drops frames would fire before the nav bake
            // and photograph a world with no crowd in it.
            if (shotPath) {
                ++shotFramesSeen;
                if (shotRideDone < shotRide && shotFramesSeen % 420 == 0) {
                    // One floor down every ~7 s: long enough for the async nav bake
                    // (measured 2.5 s + 2.4 s) to finish before the next ride.
                    game::NpcId pid = reg.valid(player)
                                          ? reg.get<game::NpcRef>(player).id
                                          : game::kInvalidNpc;
                    game::RideResult r = streamer.travel(
                        stack, registry, reg, pool, player, currentFloor, -1,
                        /*arrivalZ=*/2, pid);
                    if (r.moved) {
                        player = r.player;
                        currentFloor = r.floor;
                        game::record_floor(ledger, currentFloor);
                        samosbor = game::samosbor_new_game(sbRng);
                        aim_player(reg, player);
                        LayerId nl = reg.get<Transform>(player).layer;
                        activeLayer = nl;
                        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
                        refresh_floor_containers(reg, stack.layer(nl),
                                                 currentFloor, nl);
                        begin_floor_nav(stack.layer(nl), nav);
                        cubePass.invalidate();
                        // Same clear as the keyboard ride path. There are TWO travel
                        // sites and the first fix only touched one, so a --shot
                        // capture kept reporting a rumour about the floor it started
                        // on. A duplicated code path is a duplicated bug; this is the
                        // second one and the reason to be suspicious of the shape.
                        rumourLine[0] = 0;
                        rumourAt = 0;
                    }
                    ++shotRideDone;
                }
                // Two frames, because the copy is recorded INSIDE end_frame — the
                // only window in which the swapchain image legally belongs to the
                // application. Request on the target frame, save on the next.
                // [screenshot.h]
                if (shotFramesSeen == shotFrames) {
                    gpu::capture_request(device, renderer, shotCap);
                } else if (shotFramesSeen > shotFrames) {
                    const bool ok =
                        gpu::capture_save(device, renderer, shotCap, shotPath);
                    std::fprintf(stderr, "shot: %s -> %s (floor %d, %d frames)\n",
                                 ok ? "saved" : "FAILED", shotPath, currentFloor,
                                 shotFramesSeen);
                    // The same GPU figures the HUD is showing, on stderr, so an
                    // unattended capture leaves a machine-readable measurement
                    // beside the pixels instead of only a number to squint at.
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms: world %.3f bodies %.3f hud %.3f "
                                     "frame %.3f  (instances %u, bodies %u)\n",
                                     renderer.timer.pass_ms(gpu::GpuPass::World),
                                     renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms(gpu::GpuPass::Hud),
                                     renderer.timer.frame_ms(),
                                     cubePass.last_instance_count(),
                                     bodyPass.last_instance_count());
                    else
                        std::fprintf(stderr, "gpu-ms: n/a (no timestamps)\n");
                    running = false;
                }
            }
        }
    }

    // --- teardown (reverse order) -----------------------------------------
    hud.destroy();
    bodyPass.destroy();
    cubePass.destroy();
    renderer.destroy();
    device.destroy();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}

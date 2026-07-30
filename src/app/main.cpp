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
// Space jump, F toggles fly, Q works the nearest door, [ / ] change floor, Esc quits.
#include <SDL3/SDL.h>
#include <SDL3/SDL_vulkan.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "imgui.h"
#include "imgui_impl_sdl3.h"

#include "app/worldgen.h"
#include "core/math.h"
#include "game/mob_table.h"
#include "core/tick.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"       // the utility AI — adapted, wired, and dormant by default
#include "game/embody.h"
#include "game/elevator.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/macro_sim.h"
#include "game/mob_spawn.h"
#include "game/needs.h"
#include "game/rumour.h"
#include "game/speech.h"
#include "game/samosbor.h"
#include "game/contract.h"
#include "game/vendor.h"
#include "game/craft.h"
#include "game/quest.h"
#include "game/container.h"
#include "game/door.h"
#include "game/combat.h"
#include "game/rpg.h"
#include "game/extraction.h"
#include "game/save.h"
#include "game/faction_relations.h"
#include "game/loot.h"
#include "game/weapon_table.h"
#include "game/event_bus.h"
#include "game/investigate.h"
#include "game/noise.h"
#include "game/wander.h"
#include "game/npc_pool.h"
#include "game/population.h"
#include "game/macro_sim.h"
#include "input/input.h"
#include "render/body_pass.h"
#include "render/cube_pass.h"
#include "render/prop_pass.h"
#include "render/prop_placer.h"

#include "render/gpu_timer.h"
#include "render/gpu_light_grid.h"
#include "render/gpu_particle_pass.h"
#include "render/gpu_cull_pass.h"
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

static void collect_scene_lights(gpu::GpuLightGrid& grid, const vec3& camPos,
                                 float timeSec, const game::SamosborState& samosbor,
                                 const Registry& reg, LayerId activeLayer) {
    grid.clear_lights();

    // 1. Player Headlamp
    grid.add_light(camPos, kLampRadius, vec3{0.95f, 0.92f, 0.85f}, kLampIntensity);

    // 2. Samosbor Alarm Hazard Light
    const game::SamosborAlarm alarm = game::samosbor_alarm(samosbor);
    const float alarmPulse = alarm.pulse;
    if (alarmPulse > 0.01f) {
        vec3 alarmColor{0.95f, 0.20f, 0.85f}; // Purple default
        switch (static_cast<game::SamosborVariant>(samosbor.variant)) {
            case game::SamosborVariant::Wet:      alarmColor = vec3{0.15f, 0.85f, 0.95f}; break;
            case game::SamosborVariant::Electric: alarmColor = vec3{0.95f, 0.15f, 0.95f}; break;
            case game::SamosborVariant::Meat:     alarmColor = vec3{0.95f, 0.15f, 0.15f}; break;
            case game::SamosborVariant::Maronary: alarmColor = vec3{0.95f, 0.55f, 0.15f}; break;
            case game::SamosborVariant::Istotit:  alarmColor = vec3{0.95f, 0.95f, 0.45f}; break;
            case game::SamosborVariant::Veretar:  alarmColor = vec3{0.85f, 0.85f, 0.95f}; break;
            default: break;
        }
        grid.add_light(camPos + vec3{0.0f, 3.0f, 0.0f}, 48.0f, alarmColor, alarmPulse * 3.5f);
    }

    // 3. Mob Emitters (Lampovy & Lampoglaz)
    for (auto e : reg.view<const game::MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::MobRef& m = reg.get<const game::MobRef>(e);
        const auto kind = static_cast<game::MobKind>(m.kind);

        float dx = wrap_delta_f(camPos.x, tr.pos.x, kWorldExtent);
        float dy = camPos.y - tr.pos.y;
        float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz > 48.0f * 48.0f) continue;

        if (kind == game::MobKind::Lampovy) {
            grid.add_light(tr.pos + vec3{0.0f, 1.2f, 0.0f}, 12.0f, vec3{1.0f, 0.88f, 0.65f}, 2.0f);
        } else if (kind == game::MobKind::Lampoglaz) {
            grid.add_light(tr.pos + vec3{0.0f, 1.5f, 0.0f}, 16.0f, vec3{0.70f, 0.95f, 1.0f}, 2.8f);
        }
    }

    // 4. Emissive Loot Containers & Supply Crates
    for (auto e : reg.view<const game::Container, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::Container& cnt = reg.get<const game::Container>(e);
        if (!cnt.opened) {
            float dx = wrap_delta_f(camPos.x, tr.pos.x, kWorldExtent);
            float dy = camPos.y - tr.pos.y;
            float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz < 32.0f * 32.0f) {
                grid.add_light(tr.pos + vec3{0.0f, 0.5f, 0.0f}, 6.0f, vec3{0.30f, 0.90f, 0.50f}, 1.2f);
            }
        }
    }

    // 5. Flying Tracer & Plasma Projectile Light Emitters
    for (auto e : reg.view<const game::Projectile, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::Projectile& proj = reg.get<const game::Projectile>(e);
        if (proj.ttlMs == 0) continue;

        float dx = wrap_delta_f(camPos.x, tr.pos.x, kWorldExtent);
        float dy = camPos.y - tr.pos.y;
        float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz < 48.0f * 48.0f) {
            vec3 pcol = (proj.team == 1) ? vec3{1.0f, 0.85f, 0.40f} : vec3{0.95f, 0.20f, 0.40f};
            grid.add_light(tr.pos, 10.0f, pcol, 2.5f);
        }
    }
}

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

// Where a run lives on disk. `giga_game` does no file I/O by design — it links
// giga_core and nothing platform-shaped ([AGENTS.md]) — so the fopen is HERE and the
// format is over there ([game/save.h]). save_write/save_read take a byte buffer and
// never touch a FILE*, which is also what makes them testable headlessly.
constexpr const char* kSavePath = "gigahrush2.sav";

bool write_run(const game::SaveState& st, const char* path) {
    std::vector<std::uint8_t> bytes;
    game::save_write(st, bytes);
    std::FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    const std::size_t n = std::fwrite(bytes.data(), 1, bytes.size(), f);
    const bool ok = (n == bytes.size());
    std::fclose(f);
    return ok;
}

// False when there is no save, when it cannot be read, or when the format refuses it.
// `err` says which, and `game::save_error_text` turns that into a sentence for the
// player. An absent file leaves `err` at None, which is how "first run" is told apart
// from "your save is from an older build" — the two need different words.
bool read_run(game::SaveState& st, const char* path, game::SaveError& err) {
    err = game::SaveError::None;
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::vector<std::uint8_t> bytes;
    std::uint8_t chunk[1024];
    for (;;) {
        const std::size_t got = std::fread(chunk, 1, sizeof(chunk), f);
        if (got == 0) break;
        bytes.insert(bytes.end(), chunk, chunk + got);
    }
    std::fclose(f);
    // An empty file yields bytes.data() == nullptr, which save_read reports as TooShort
    // rather than dereferencing.
    return game::save_read(bytes.data(), bytes.size(), st, &err);
}

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
    std::uint32_t aiCount = game::ai_init(reg, layer);
    std::fprintf(stderr,
                 "[nav] bake coarse %.0f ms | fine %.0f ms | %u agents wandering | %u AI brains attached "
                 "(async, off the main thread)\n",
                 bake.last_coarse_ms(), bake.last_fine_ms(), n, aiCount);
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

    gpu::GpuLightGrid lightGrid;
    if (!lightGrid.init(&device, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[light-grid] pass init failed\n");
    }

    gpu::CubePass cubePass;
    if (!cubePass.init(device, renderer.renderPass, GIGA_SHADER_DIR, lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "Cube pass init failed\n");
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // Draws the population: one instanced, lit box per embodied entity, sharing
    // the world pass's render pass + depth so bodies and voxels occlude cleanly.
    gpu::BodyPass bodyPass;
    if (!bodyPass.init(device, renderer.renderPass, GIGA_SHADER_DIR, lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "Body pass init failed\n");
        cubePass.destroy();
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // GPU-instanced arbitrary prop meshes (cylinders, arches, barrels, pipes).
    // Shares CubePass's pipeline layout and cube.frag so props receive identical
    // PBR lighting, fog, and material shading as the voxel world.
    gpu::PropPass propPass;
    if (!propPass.init(&device, cubePass.pipeline_layout(),
                       renderer.renderPass, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[prop] pass init failed (continuing without props)\n");
        // Non-fatal: the game runs fine without props.
    }

    gpu::GpuParticlePass particlePass;
    if (!particlePass.init(&device, renderer.renderPass, 0, GIGA_SHADER_DIR, lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "[particle] pass init failed (continuing without particles)\n");
    }

    gpu::GpuCullPass cullPass;
    if (!cullPass.init(&device, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[cull] pass init failed (continuing without GPU culling)\n");
    }

    gpu::PropPlacer propPlacer;

    // Populate initial decorative props. These are placed relative to world
    // origin (0,0,0) and visible once the first floor is generated nearby.
    // In a full game, a prop placement pass would populate these from world
    // data (room type, samosbor wave, etc.); here they demonstrate all shapes.
    if (particlePass.ready()) {
        particlePass.emit_burst(vec3{64.0f, 4.0f, 64.0f}, vec3{0.0f, 1.0f, 0.0f}, vec3{0.85f, 0.80f, 0.70f}, gpu::GpuParticleKind::DustMote, 128, 2.0f, 8.0f, 0.35f, 180.0f);
        particlePass.emit_destruction_burst(vec3{64.0f, 2.0f, 64.0f}, 1, 64);
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
    // SLOT RECYCLING IS DELIBERATELY NOT ARMED HERE, and the line is left in place
    // rather than omitted so the gate travels with it. Armed, a dead slot returns to an
    // intrusive free list and a birth stops being a one-way draw on a finite reserve:
    // measured in suite_npcpool.inl, 101,000 births cost 1,000 slots armed against
    // 101,000 unarmed, and over 250 macro ticks against a 60-slot reserve the population
    // holds at 3002 with 0 births refused instead of decaying to 2336 with 1197 refused.
    //
    // ARMED. A recycled id is a REUSED id, so every place that holds a bare NpcId ACROSS
    // TIME had to become generation-checked first. All of them now are, and the count is
    // written out because "fix one and declare victory" is how this would have shipped
    // broken — I made that mistake twice and was corrected twice:
    //   DONE  MacroSim::Journey::id  — stamps the departing generation, compares on landing.
    //   DONE  Contract::giver        — an NpcHandle; contract_step polls handle_valid().
    //                                  Measured A/B: with a bare id the job paid 700 rub to
    //                                  a newborn who never offered it and read Complete;
    //                                  with the handle it pays 0 and Fails.
    //   DONE  QuestProgress::giver   — the identical defect, same fix, quest.cpp now polls
    //                                  handle_valid(p.giver).
    //   DONE  Relationship::target   — the generation went into the dead `pad` field, so
    //                                  rel_ (128 B/row, 128.0 MiB at capacity) gained
    //                                  nothing. social_edge_target() returns kInvalidNpc for
    //                                  a stale edge, so the line callers already wrote for
    //                                  empty slots makes staleness safe by construction.
    //   DONE  FloorModule::candidate — an NpcHandle in the same 32 bits (a 20-bit id leaves
    //                                  room for the 12-bit generation). A stale designate
    //                                  RE-DESIGNATES from the floor's live roster instead of
    //                                  handing the camera to whoever inherited the slot.
    //   SAFE  NpcRef::id — the sixth store [npc_pool.h] names, and the ONE that needed no
    //                      change. Its lifetime is COUPLED, not merely short: the macro
    //                      demographic sweep skips `pool.embodied(id)` before it can reach
    //                      either kill() (macro_sim.cpp), so a macro death can never touch
    //                      an embodied body; and the only other pool.kill() caller anywhere
    //                      in src/ is combat.cpp, which kills the record at :138 and
    //                      destroys the entity at :148 in the same loop. So no entity can
    //                      outlive the record its NpcRef names. That is an argument from
    //                      the call graph rather than a generation check — if a third
    //                      pool.kill() caller ever appears, this line is what it invalidates.
    pool.set_recycling(true);
    //
    // The demo seeds ~1,930 records into 2^20, so the reserve is not the binding
    // constraint at this size — this matters at design scale, not in the test bed.
    // The macro society: the whole cold population — aging, old-age mortality,
    // births, bounded migration — advancing on its own coarse clock, decoupled from
    // the 125 Hz sim and from the render loop. This is the piece that makes the
    // world live whether or not anyone is looking at it. [macrosim.md]
    //
    // Declared beside the pool because both live the whole session. `init()` must
    // precede `set_floors_from`. The birth target latches on the FIRST `step()` and
    // deliberately not here: main seeds the world between this line and the first
    // macro tick, so latching now would read a living count of 0 and no birth would
    // ever happen.
    game::MacroSim macroSim;
    game::MacroParams macroParams;  // targetPopulation 0 -> hold the seeded size
    game::MacroStats macroStats{};  // last macro tick's tallies, for the HUD
    macroSim.init();
    // Who hates whom — and it MOVES. `relations_drain_deaths` bends this matrix by
    // who killed whom, so ten dead citizens push the Citizens row across the
    // hostility boundary and `faction_feud_step` turns the building's crowd on you.
    // Until this line `kBaseFactionMatrix` had no caller anywhere in src/, which
    // made six faction functions dead code. [faction_relations.h]
    game::FactionRelations factionRel = game::kBaseFactionMatrix;
    game::RelationTick relTick{};   // last drain's tallies, for the HUD
    std::uint32_t feudHits = 0;     // running total of NPC-vs-NPC hits that landed
    // Transient event ring ([events.md]). Combat publishes deaths into it; it is
    // cleared once per frame, so a listener must consume within the frame or use
    // the opt-in log.
    game::EventBus bus;
    bus.init();
    // Recent noises, fading ([noise.h]). A sibling of the bus, not a part of it: the
    // bus is "this happened" and is wiped every tick, this is "this happened HERE and
    // is still fading". No init() — it is a 2 KB POD with no allocation anywhere.
    game::NoiseField noiseField;
    game::FloorRegistry registry;

    // Streaming keeps only the ACTIVE floor's World + crowd live; every other
    // floor folds into the cold pool (floor_stream.h, master_prompt #9). This is
    // what makes a deep 2^20-person building affordable: the sim tick is O(live
    // entities), so exactly one floor's worth is ever simulated.
    game::FloorStreamer streamer;

    int currentFloor = 0;                         // in-game label of the live floor
    const game::FloorSpec* currentSpec = nullptr; // its rule-set (HUD only)

    // Every door on the live floor. Rebuilt per arrival like mobs and containers,
    // because a door belongs to the floor and not to the player — and because the
    // dense cell->door index is sized for exactly ONE layer ([door.h]).
    //
    // Declared up here rather than beside the ledger because the FIRST floor is set
    // up above the ledger, and a DoorSet declared later compiled as "undeclared
    // identifier" at the very site that has to build the starting floor's doors.
    game::DoorSet doors;
    game::DoorTick doorTick{};      // last step's report, for the HUD
    std::uint32_t doorsBuilt = 0;   // on this floor, so the HUD can say "0 doors"
    bool doorWanted = false;        // Q, consumed by one sim step
    bool interactWanted = false;    // E, consumed by one sim step (Terminal / ControlPanel interact)
    char elevDiagLine[160] = {};
    std::uint64_t elevDiagAt = 0;
    // One seed for every floor's doors. door_build is deterministic in it, so a floor
    // gets the same doors on every visit, the same way its mobs and crates do.
    constexpr unsigned kDoorSeed = 0xD00D5u;

    Entity player = entt::null;

    if (genMode == WorldGenMode::Maze) {
        LayerId ground = stack.push_layer();
        generate_demo_world(stack.layer(ground), 1337u, genMode);
        player = setup_maze(pool, reg, ground);
        if (propPass.ready()) {
            propPlacer.populate(stack.layer(ground).grid(), propPass, 1337u);
        }
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
        // Migration destinations are the REGISTERED floor set, never a [lo,hi] band.
        // This stack is legitimately sparse — {0,1,2,-8,-14,-26,-36,-50,14,30} — so a
        // uniform draw over [-50,30] would send 71 of every 81 travellers to a floor
        // that does not exist. Must run after the add_module loop above (the registry
        // is the authoritative live set) and before the first `step()`. Re-call after
        // any renumber. In Maze mode this branch is never taken, so fewer than two
        // labels are registered and migration correctly stays off. [macro_sim.h]
        macroSim.set_floors_from(registry);
        // POPULATE THE WHOLE BUILDING, not just the floor about to be loaded.
        //
        // Measured before this line existed: a fresh run held 420 records — one floor's
        // worth — because `ensure_loaded` seeds a module's crowd on its FIRST LOAD, so
        // the population only came into existence where the player had already been.
        // That made every macro counter structurally zero rather than merely quiet:
        // migration and the social sweep both skip `pool.embodied` ([macro_sim.h] works
        // on COLD records only), and with a single loaded floor every existing record was
        // embodied, so there were no eligible candidates at all.
        //
        // Seeding here gives the other nine floors a cold population that ages, dies,
        // gives birth and migrates before anyone has ever visited them — which is the
        // difference between a world that lives when unobserved and one that only exists
        // where the camera has been. Costs ~4,200 records against a 2^20 pool and touches
        // no layer, no geometry and no ECS entity.
        const std::uint32_t seeded = streamer.seed_all_modules(pool);
        std::fprintf(stderr, "[pop] seeded %u cold records across %u registered floors\n",
                     seeded, macroSim.floor_count());

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
            // Doors BEFORE the bake, and frozen for its duration: door_build leaves
            // every door open so the bake sees all-open geometry (an upper bound on
            // connectivity), and AsyncBake holds a raw pointer to the live MacroGrid
            // that must not be mutated until ready(). [door.h]
            if (currentSpec)
                doorsBuilt = game::door_build(stack.layer(l0), doors, 0,
                                              *currentSpec, kDoorSeed);
            doors.frozen = true;
            begin_floor_nav(stack.layer(l0), nav);
            game::ai_init(reg, l0);
            if (propPass.ready()) {
                std::uint32_t fseed = 1337u ^ (static_cast<std::uint32_t>(currentFloor) * 0x9e3779b9u);
                propPlacer.populate(stack.layer(l0).grid(), propPass, fseed);
            }
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
    // Monotonic sim-time (seconds), advanced one kSimDt per fixed step. The AI
    // re-plan stagger ([ai.md] #12c) schedules each agent's next decision against
    // an absolute deadline on this clock; it is frozen with the sim while paused.
    // [[maybe_unused]]: its only consumer is the PARKED ai_step call below (ai.cpp
    // is in tools/branch_port_pending/ pending adaptation to main's tables). Kept —
    // it is advanced correctly every tick, ready for ai_step's return. MSVC did not
    // warn; Clang -Wunused-but-set-variable does.
    [[maybe_unused]] double simNow = 0.0;
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
    // Mobs steered by SOUND on the last sim tick ([investigate.h]). Not cumulative: the
    // point of the readout is "is anything investigating right now", and a running
    // total would answer a different question badly.
    std::uint32_t heardMobs = 0;
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
    // The whole run in ONE struct, because that is exactly what gets written to disk.
    // `contracts` and `ledger` below are REFERENCES into it, not copies: every one of
    // the ~30 existing use sites keeps working untouched, and there is no "which copy is
    // authoritative at save time" question — the answer that bug always gives is "the
    // stale one". A load is then `runState = in;` and both references see it. [save.h]
    game::SaveState runState;
    game::ContractBook& contracts = runState.book;
    game::Contract offer{};
    char offerLine[200] = {};
    // Quest offer from the same proximity sweep that feeds contract_offer. One
    // body can carry both a procedural contract AND an authored quest, and both
    // are displayed side-by-side — E takes whichever is pending. Contract is
    // preferred when both land simultaneously (walk-in economy vs authored story);
    // in practice the 8% quest share keeps collisions rare. [quest.h]
    game::QuestId questOffer = game::kInvalidQuest;
    game::NpcId questOfferGiver = game::kInvalidNpc;
    char questOfferLine[320] = {};
    char rumourLine[160] = {};
    std::uint64_t rumourAt = 0;
    // The murmur, next to the rumour and deliberately separate from it: a rumour is a
    // FACT the player can go and check, speech is what the nearest body sounds like.
    // Different clock, different colour, no shared state. rumour.h states its own rule in
    // capitals — a rumour must be TRUE and CHECKABLE — which a bark is not, and that is
    // why this is a sibling rather than an extension. [speech.h]
    //
    // A const char*, not a char buffer: kSpeechText holds static-duration literals, so
    // there is nothing to copy and nothing to truncate.
    const char* speechLine = nullptr;
    game::SpeechSituation speechSit = game::SpeechSituation::Ambient;
    game::SpeechMemory speechMem;
    std::uint64_t speechAt = 0;
    game::NeedsTick needs{};   // last step's report, for the HUD
    int needsHpLost = 0;       // running total, so the HUD is not one tick
    // [[maybe_unused]]: superseded by PlayerRanged::shots (read straight from the
    // component in the HUD) during the branch merge, but the `shots += ...` RHS is a
    // side-effecting call (it fires the gun), so the accumulator is kept rather than
    // rewriting the statement. MSVC did not warn; Clang -Wunused-but-set-variable does.
    [[maybe_unused]] std::uint32_t shots = 0;   // rounds the player has fired
    game::RunLedger& ledger = runState.ledger;
    // F5 saves, F9 loads. Recorded as intent and acted on in the sim loop, the same
    // shape sellWanted/buyWanted use: a load rewrites world state and belongs on the
    // sim's clock, not the window's.
    bool saveWanted = false;
    bool loadWanted = false;
    // What the last save or load actually said. A save that fails silently is a save the
    // player only finds out about by losing a run.
    char saveLine[96] = {};
    std::uint64_t saveLineAt = 0;
    // [[maybe_unused]]: superseded by RunLedger::banked (the HUD reads ledger.banked)
    // during the branch merge; the `banked += deposit_valuables(...)` RHS still must
    // run, so the local is kept. MSVC did not warn; Clang does.
    [[maybe_unused]] std::int32_t banked = 0;
    std::int32_t containerTake = 0;   // roubles pulled out of crates
    std::int32_t contractPaid = 0;    // roubles paid by finished jobs
    game::QuestLog& quests = runState.quests;  // lives in SaveState; F5/F9 persists it
    std::int32_t questPaid = 0;       // roubles paid by finished quests
    std::int32_t sold = 0;            // roubles taken for the haul
    std::int32_t spent = 0;           // roubles spent on supplies
    // Who buys on this floor. The dominant faction sets the sell rate, which gives the
    // faction matrix a second live consumer and makes the territory rumour worth
    // acting on rather than being colour. [vendor.h]
    game::VendorKind vendorKind = game::VendorKind::Citizen;
    std::uint32_t deaths = 0;
    std::uint32_t kills = 0;       // carried across possession
    // The character sheet, carried across possession for the same reason `kills`
    // is: a death takes the body, not the person's progression. Seeded level 1 so
    // the very first embodiment (which happens below, before any death) has
    // something valid to fall back to; embody_as_player overwrites it with the
    // record's own rolled build.
    game::RpgStats carriedRpg = game::fresh_rpg(1);
    bool attackHeld = false;
    bool healWanted = false;
    bool eatWanted = false;       // G, consumed by one sim step
    bool drinkWanted = false;     // T, consumed by one sim step
    bool sellWanted = false;      // B, consumed by one sim step
    bool buyWanted = false;       // R, consumed by one sim step       // set by H, consumed by one sim step
    bool craftWanted = false;     // C, consumed by one sim step
    bool scrapWanted = false;     // X, consumed by one sim step
    // Run state, not world state, so it lives beside the ledger. CraftingState is a
    // 96-byte POD ([craft.h]) — nothing to own, nothing to free. craft_init zeroes the
    // material bank, sets tier 0 and marks the nine default-known recipes.
    //
    // This is the first reader the nine authored craft_* columns in data/items.csv have
    // ever had: 446 items carried them and item_table.h:17 said in as many words
    // "crafting is not implemented".
    // The utility AI's config and last-tick report. `enabled` defaults FALSE ([ai.h]):
    // the system is wired, tested and dormant, and flipping this one bool is the whole
    // switch — but read the note at the ai_step call site first, because it also needs
    // ai_init to attach AiBrain and ai_release to clear the token safely.
    game::AiConfig aiCfg;
    aiCfg.enabled = true;
    game::AiTick aiTick{};
    game::CraftingState crafting{};
    game::craft_init(crafting);
    std::uint32_t crafted = 0, scrapped = 0, recipesLearned = 0;
    // [[maybe_unused]]: the HUD prints `carried` (live inventory value), not this
    // run-total, after the branch merge — but `loot += ...` wraps the container/pickup
    // hooks that actually move the roubles, so the accumulator is kept. Clang warns,
    // MSVC did not.
    [[maybe_unused]] std::int32_t loot = 0;         // roubles swept up this run
    std::int32_t healed = 0;
    float ateFood = 0.0f;      // food points that LANDED, for the HUD
    float drankWater = 0.0f;
    std::int32_t consumeHpCost = 0;   // HP paid for risky food, running total
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
            if (ev.type == game::EventType::NpcDied) {
                // `b` is the mob kind, 0xFF when the dead thing was not a monster.
                if (ev.b != 0xFFu)
                    game::contract_on_kill(contracts, static_cast<std::uint8_t>(ev.b));
                // `a` is the pool id, kInvalidNpc when the dead thing had no record.
                if (ev.a != game::kInvalidNpc)
                    game::contract_on_giver_died(contracts, ev.a);

                if (particlePass.ready()) {
                    vec3 deathPos = reg.valid(player) ? reg.get<Transform>(player).pos : vec3{64.0f, 4.0f, 64.0f};
                    if (ev.a != game::kInvalidNpc) {
                        reg.view<game::NpcRef, Transform>().each([&](entt::entity, const game::NpcRef& nr, const Transform& tr) {
                            if (nr.id == ev.a) deathPos = tr.pos;
                        });
                    }
                    particlePass.emit_burst(deathPos + vec3{0.0f, 0.8f, 0.0f},
                                            vec3{0.0f, 1.5f, 0.0f},
                                            vec3{0.95f, 0.20f, 0.15f},
                                            gpu::GpuParticleKind::Spark,
                                            48, 5.0f, 1.5f, 0.25f, 180.0f);
                    particlePass.emit_destruction_burst(deathPos + vec3{0.0f, 0.5f, 0.0f}, 1, 32);
                }
            }
        }
        // Diplomacy reads the same ring, in the same frame-top drain, and for the same
        // reason: one notion of death, not three. Deliberately here and NOT beside
        // `finalize_deaths` in the substep — a frame can run several substeps, each
        // publishing NpcDied, and a per-substep drain would re-read the earlier
        // substeps' events and bill those kills again. `relations_drain_deaths` is only
        // snapshot-bounded WITHIN one call. Draining once per frame, immediately before
        // `bus.clear()`, is exactly the contract the header asks for and is
        // double-count-free. [faction_relations.h]
        relTick = game::relations_drain_deaths(factionRel, reg, pool, bus, simTick);
        bus.clear();

        // Hand over a finished nav bake. Cheap every frame; true only on the frame
        // the swap happens, which is when the floor's crowd can start walking.
        if (nav.poll()) {
            const LayerId l = reg.valid(player)
                                  ? reg.get<Transform>(player).layer
                                  : LayerId{0};
            finish_floor_nav(reg, l, 0xA11FEu, nav);
            // The bake has released the grid, so doors may move again. Until this
            // point every mutator refused, which is why a door cannot be worked
            // during the ~3.7 s bake rather than corrupting it. [door.h]
            doors.frozen = false;
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
                    // Opened crates are world state, not a free respawn. Capture the
                    // leaving floor BEFORE travel: the streamer may recycle the LayerId
                    // and refresh_floor_containers destroys every crate on the arrival
                    // slot. Without this, loot → leave → return refills every emptied
                    // box. F5 already does the same; travel was the missing call site.
                    // [save.h]
                    {
                        const LayerId leaveLayer =
                            reg.valid(player) ? reg.get<Transform>(player).layer
                                              : static_cast<LayerId>(0);
                        game::refresh_opened_containers(reg, leaveLayer, currentFloor,
                                                        runState.opened);
                    }
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
                        // A gunshot on the floor you just left must not be audible to
                        // the crowd on the one you arrived at. The streamer RECYCLES
                        // LayerId slots, so a surviving record would not merely be
                        // stale — it would match the new floor's layer id and be heard
                        // there. [noise.h]
                        game::noise_clear(noiseField);
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
                        // Re-empty crates already looted on a prior visit to this
                        // floor. Deterministic spawn would otherwise refill them —
                        // the brick this pair closes. Same seam as F9 apply. [save.h]
                        game::apply_opened_containers(
                            reg, nl, currentFloor, runState.opened.data(),
                            runState.opened.size());
                        // Doors before the bake, frozen for its duration. [door.h]
                        if (currentSpec)
                            doorsBuilt = game::door_build(
                                stack.layer(nl), doors, currentFloor,
                                *currentSpec, kDoorSeed);
                        doors.frozen = true;
                        begin_floor_nav(stack.layer(nl), nav);
                        if (propPass.ready()) {
                            std::uint32_t fseed = 1337u ^ (static_cast<std::uint32_t>(currentFloor) * 0x9e3779b9u);
                            propPlacer.populate(stack.layer(nl).grid(), propPass, fseed);
                        }
                        // ride_elevator keeps x/y and plants z=kArrivalZ. ~1-in-5
                        // Residential columns are solid at that z, so without this
                        // the body freezes in a wall forever (physics backs out
                        // every tick). F9 already calls place_body_at_cell;
                        // keyboard/--shot did not. [save.h]
                        game::place_body_safely(reg, stack.layer(nl), player);
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
                // G eats, T drinks. Recorded as INTENT for the same reason H is: the
                // event loop has no `activeLayer` in scope, and consuming an item
                // mutates a pool row, which belongs on the sim clock. Until this
                // existed `use_best_food` and `use_best_drink` had ZERO call sites,
                // so food/water/sleep fell monotonically and every run was a
                // fixed-length death timer with no way to restore a reserve.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_G)
                    eatWanted = true;
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_T)
                    drinkWanted = true;
                // Q works the nearest door. Recorded as intent for the same reason
                // as the trades below: a door moves solid geometry, so it belongs on
                // the sim's clock, not the window's, and the event loop has no
                // `activeLayer` in scope.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_Q)
                    doorWanted = true;
                // F5 saves the run, F9 loads it.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_F5)
                    saveWanted = true;
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_F9)
                    loadWanted = true;
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
                // C crafts (or reads a blueprint), X strips the cheapest junk in the bag.
                // Both keys were free: an rg for SDL_SCANCODE_C and _X across src/ found
                // nothing, and G eats / T drinks already.
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_C)
                    craftWanted = true;
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_X)
                    scrapWanted = true;
                // E takes the job on offer — contract first, then quest if no
                // contract is pending. Both clear on take so a second press is
                // harmless. Quest accept refuses a dead giver or a chain gate;
                // contract_accept refuses the same. [quest.h, contract.h]
                if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat &&
                    e.key.scancode == SDL_SCANCODE_E) {
                    interactWanted = true;
                    if (game::contract_accept(contracts, offer, ledger)) {
                        offer = game::Contract{};
                        offerLine[0] = 0;
                    } else if (game::quest_valid(questOffer) &&
                               questOfferGiver != game::kInvalidNpc &&
                               game::quest_accept(quests, pool, questOffer,
                                                  questOfferGiver,
                                                  currentFloor, ledger)) {
                        questOffer = game::kInvalidQuest;
                        questOfferGiver = game::kInvalidNpc;
                        questOfferLine[0] = 0;
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
            // The embodied AI steers against the live floor's baked danger field
            // ([diffusion.md]); it is null when the floor seeds none -> threat reads
            // 0 and no one flees, the scorer's stubbed-input stance ([ai.md]).
            // Fetched once per frame: the fixed loop below never (re)creates it.
            World& activeWorld = stack.layer(activeLayer);
            // [[maybe_unused]]: danger + activeGrid are the arguments to the PARKED
            // ai_step call below (line ~920). ai.cpp sits in tools/branch_port_pending/
            // until adapted to main's mob_table, so its inputs are fetched-but-unread
            // for now. Kept so the wiring is one uncomment away. MSVC did not warn;
            // Clang -Wunused-variable does.
            [[maybe_unused]] const Field<float>* danger = activeWorld.fields().find<float>("danger");
            [[maybe_unused]] const MacroGrid& activeGrid = activeWorld.grid();
            int guard = 0;
            while (simAccum >= kSimDt && guard++ < 8) {
                // Age the noise field ONCE per tick, at the top ([noise.h]). Everything
                // published later in this tick therefore gets a full tick of life before
                // it can expire, and investigate_step below reads a field that nothing has yet
                // mutated this tick — so a gunshot fired on tick N is investigated on
                // tick N+1 rather than racing the pass that fired it.
                game::noise_step(noiseField,
                                 static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f));
                input.apply(reg, kSimDt);
                // Embodied crowd (#12): needs decay, then the utility brain
                // re-plans (identity-staggered) and steers each NON-player body's
                // Velocity — BEFORE the controller/physics that integrate it, the
                // same locomotion path as the player ([ai.md], [npcs.md]).
                // PARKED: game::needs_step(reg, pool, kSimDt);  <- branch 3-arg call
                // main already steps the clock at line ~1043 with the layer-scoped
                // 4-arg signature and keeps its NeedsTick report for the HUD. The branch
                // call operated on its per-entity Needs COMPONENT; main keeps the
                // survival clock in the pool row, because the elevator destroys the body
                // and a component would reset the clock on every floor ride.
                // THE UTILITY AI, UNPARKED — and dormant, which is not the same as absent.
                //
                // It sat commented out because two systems writing Velocity fight every
                // tick. That is now settled by a TOKEN rather than by hope: `AiBrain::motion`
                // decides per body, and both foreign writers — wander_step and
                // faction_feud_step — carry `if (ai_owns_motion(reg, e)) continue;`.
                // MEASURED over 200 ticks x 24 bodies: ai_step wrote Velocity 2400 times,
                // wander_step 300, and BOTH in one tick ZERO times; wander wrote 0 times
                // while the token was held and 600 once delegated. [ai.h]
                //
                // `aiCfg.enabled` is FALSE, so this is one branch per tick — ai.cpp returns
                // before it even takes the view. The call is live anyway, deliberately: it
                // makes the wiring real instead of a comment, it consumes `danger` and
                // `activeGrid` (which were live C4189 warnings for exactly as long as this
                // stayed parked), and it reduces switching the AI on to editing ONE bool
                // rather than re-deriving a call signature months from now.
                //
                // Before flipping it: `ai_init` must attach AiBrain to the floor's bodies
                // (see the load path), and `ai_release` must run when clearing the flag on a
                // live floor — the token is persistent state, so a body left holding
                // MotionOwner::Ai would be skipped by wander_step forever and stand still.
                // NOTE the `activeLayer` argument: the parked call was
                // `ai_step(reg, pool, danger, activeGrid, simNow, kSimDt)` against an older
                // SIX-argument signature with no layer, so it would not even have compiled
                // if anyone had uncommented it. That is what "parked until adapted" was
                // really hiding — a commented-out call is not a call, and nothing checks it.
                aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,
                                       kSimDt, aiCfg);
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
                // Sound overrides sight's absence: a mob with no visible prey that
                // heard something recently walks at the sound instead of at a random
                // lattice node. Purely additive on top of wander_step and it returns
                // before touching an entity when the field is quiet, which is almost
                // every tick. [investigate.h]
                heardMobs = game::investigate_step(reg, noiseField, pool, activeLayer,
                                            simTick);
                // NPC-vs-NPC: bodies holding a staggered fight licence steer at their
                // nearest enemy and swing when it is in reach. Placed AFTER wander_step
                // and investigate_step so it overrides both for the licensed handful —
                // the same override wander.cpp already performs internally on aggro —
                // and BEFORE physics_step so reach is tested against pre-integration
                // positions: a 1 cm error at a 1.35 m/s walk over one 8 ms step, three
                // orders of magnitude inside the 1.9 m unarmed reach.
                //
                // A feud can never kill a crowd body — damage to anyone but the camera
                // holder is floored at hp-1, because nothing in this game heals a
                // resident and a lethal feud would be a one-way population drain with
                // no counterplay. The camera holder IS killable: the player has
                // healing, resupply and possession-on-death. [faction_relations.h]
                feudHits += game::faction_feud_step(reg, pool, factionRel, activeLayer,
                                                    simTick);
                physics_step(reg, stack, kSimDt);
                // Doors resolve AFTER physics for the same reason melee does: contact
                // is tested by ADJACENCY against where bodies actually ended up this
                // step, not where they intended to go. Costs nothing while no door is
                // shut — door_step early-outs on doors.shut == 0. [door.h]
                doorTick = game::door_step(reg, stack.layer(activeLayer), doors,
                                           activeLayer, kSimDt, simTick);
                // Q, consumed once. The player works a door with a keypress; leaning
                // on one is how MONSTERS open it, and door_step skips the camera
                // holder precisely so the two cannot be confused.
                if (doorWanted) {
                    doorWanted = false;
                    if (reg.valid(player))
                        game::door_toggle_near(stack.layer(activeLayer), doors, reg,
                                               activeLayer,
                                               reg.get<Transform>(player).pos);
                }
                if (interactWanted) {
                    interactWanted = false;
                    if (reg.valid(player) && propPass.ready()) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        std::vector<vec3> terms = propPass.get_terminal_positions();
                        game::TerminalInteractResult tres = game::embody_interact_terminal(
                            reg, stack.layer(activeLayer), doors, activeLayer, ppos, 4.0f, terms);
                        if (tres.interacted) {
                            std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                          "ELEVATOR DIAGNOSTIC: FLOOR %d TERMINAL LINKED | DOORS %s (%u TOGGLED)",
                                          currentFloor, tres.doorsLocked ? "LOCKED" : "UNLOCKED", tres.doorsToggled);
                            elevDiagAt = simTick;
                            if (particlePass.ready()) {
                                particlePass.emit_burst(tres.propPos + vec3{0.0f, 1.0f, 0.0f},
                                                        vec3{0.0f, 1.0f, 0.0f}, vec3{0.35f, 0.85f, 1.0f},
                                                        gpu::GpuParticleKind::ElecArc,
                                                        64, 5.5f, 0.6f, 0.15f, 180.0f);
                            }
                        }
                    }
                }
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
                                                  kSimDt, simTick, &noiseField);
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
                // The crowd's own voice, on its own slower clock. It runs its OWN
                // nearest_speaker sweep rather than sharing the rumour one below: the
                // sweep is O(bodies on the layer) and fires at most once per 3 s, which
                // is far cheaper than entangling two channels that must not tick
                // together. [speech.h]
                if (simTick - speechAt >= game::kSpeechCooldownTicks) {
                    const game::NpcId talker = game::nearest_speaker(reg, activeLayer);
                    if (talker != game::kInvalidNpc) {
                        const game::SpeechContext sc =
                            game::speech_context(reg, pool, talker, samosbor.phase);
                        // The seed is the UTTERANCE COUNTER — the reference's
                        // `repeatIndex: Math.floor(time)`. Identity is already folded in
                        // by speech_line_index, so this is the only term that has to move
                        // for the same body to say something new.
                        speechLine = game::speech_say(
                            speechMem, pool, talker, sc,
                            static_cast<std::uint32_t>(simTick /
                                                       game::kSpeechCooldownTicks),
                            &speechSit);
                        speechAt = simTick;
                    }
                }
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
                        // The same body may also carry an authored quest. Seed
                        // 0xB4C3 is distinct from the contract seed (0x9E37) so the
                        // two hashes land in different equivalence classes and a body
                        // hired for a contract does not automatically offer a quest
                        // with the same random-chain outcome. [quest.h]
                        const game::QuestId qid = game::quest_offer(
                            pool, quests, sp, currentFloor, 0xB4C3u);
                        if (game::quest_valid(qid) &&
                            game::quest_offer_text(qid, questOfferLine,
                                                   sizeof(questOfferLine))) {
                            questOffer = qid;
                            questOfferGiver = sp;
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
                // The character sheet, for the same reason and at the same point:
                // after the death point there is no component left to read, and a
                // fresh body would otherwise arrive at level 1. `finalize_deaths`
                // may also LEVEL this up on the killing blow, so the snapshot is
                // taken before it runs and re-taken below when the body survives.
                if (reg.valid(player))
                    if (const auto* rs0 = reg.try_get<game::RpgStats>(player))
                        carriedRpg = *rs0;
                game::loot_dead_mobs(reg, activeLayer, currentFloor,
                                     static_cast<std::uint32_t>(simTick));
                // ONE death point per tick, after everything that can deal damage
                // (combat.h). Nothing else in the tree destroys a damaged entity.
                deaths += game::finalize_deaths(reg, pool, bus, simTick,
                                                &noiseField);
                // Containers first, then loose pickups: a crate emptied this tick
                // should be sweepable in the same tick if the inventory overflowed
                // onto the floor. [container.h]
                const std::int32_t fromBox =
                    game::loot_containers_step(reg, pool, activeLayer, &noiseField);
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
                // Save and load. Both are world mutations, so they sit on the sim's
                // clock beside the other intent flags rather than in the event loop.
                if (saveWanted) {
                    saveWanted = false;
                    const game::NpcRef* nrs = reg.valid(player)
                                                  ? reg.try_get<game::NpcRef>(player)
                                                  : nullptr;
                    if (nrs && pool.valid(nrs->id)) {
                        const vec3& sp = reg.get<Transform>(player).pos;
                        runState.player.clock = pool.needs(nrs->id);
                        runState.player.inv = pool.inventory(nrs->id);
                        runState.player.hp = pool.hp(nrs->id);
                        runState.player.maxHp = pool.max_hp(nrs->id);
                        // The SIGNED floor, explicitly: NpcPool::floor() is unsigned
                        // (floor -50 stores as 65486) and LayerId is a storage slot that
                        // means nothing across a restart. [save.h]
                        runState.player.floorNumber = currentFloor;
                        runState.player.cx = static_cast<std::uint8_t>(
                            wrap_macro(static_cast<int>(sp.x / kCellSize)));
                        runState.player.cy = static_cast<std::uint8_t>(
                            wrap_macro(static_cast<int>(sp.y / kCellSize)));
                        runState.player.cz = static_cast<std::uint8_t>(
                            wrap_macro(static_cast<int>(sp.z / kCellSize)));
                        // REFRESH, not append and not clear: only one floor is ever
                        // resident, so every other floor's opened crates exist nowhere
                        // but in this list. Appending would duplicate the live floor on
                        // every save; clearing would forget the other nine. [save.h]
                        game::refresh_opened_containers(reg, activeLayer, currentFloor,
                                                        runState.opened);
                        if (write_run(runState, kSavePath))
                            std::snprintf(saveLine, sizeof(saveLine),
                                          "saved: floor %d, %u rub, %u crates",
                                          currentFloor,
                                          static_cast<unsigned>(ledger.banked),
                                          static_cast<unsigned>(runState.opened.size()));
                        else
                            std::snprintf(saveLine, sizeof(saveLine),
                                          "SAVE FAILED: could not write %s", kSavePath);
                        saveLineAt = simTick;
                    }
                }
                // F9 full load: run + floor + cell + armour. APIs live in save.h;
                // this was the only call site that still did a partial field copy and
                // admitted it would not restore position. [save.h]
                if (loadWanted) {
                    // Travel regenerates Worlds; AsyncBake holds a raw MacroGrid* for
                    // ~seconds. Multi-hop while baking frees the slot the worker still
                    // reads — refuse and retry next frame. [save.h, nav_async.h]
                    if (nav.baking()) {
                        // leave loadWanted set; quiet until the bake ends
                    } else {
                        loadWanted = false;
                        game::SaveState in;
                        game::SaveError err = game::SaveError::None;
                        if (!read_run(in, kSavePath, err)) {
                            // No file and a refused file need different words: one is a
                            // first run, the other is a save the build can no longer read.
                            if (err == game::SaveError::None)
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "no save file (%s)", kSavePath);
                            else
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "load refused: %s",
                                              game::save_error_text(err));
                        } else {
                            // `ledger` and `contracts` are references INTO runState, so
                            // this one assignment republishes both without touching a
                            // use site.
                            runState = in;
                            const int savedFloor = runState.player.floorNumber;
                            const std::uint8_t scx = runState.player.cx;
                            const std::uint8_t scy = runState.player.cy;
                            const std::uint8_t scz = runState.player.cz;

                            bool floorMoved = false;
                            bool arrived = (savedFloor == currentFloor);
                            bool travelRefused = false;
                            std::size_t reopened = 0;

                            if (savedFloor != currentFloor) {
                                const game::LoadTravel lt = game::travel_to_saved_floor(
                                    stack, registry, reg, pool, streamer, player,
                                    currentFloor, savedFloor, game::kArrivalZ);
                                if (lt.moved) {
                                    player = lt.player;
                                    currentFloor = lt.floor;
                                    floorMoved = true;
                                    arrived = lt.arrived;
                                    // Same post-ride bookkeeping as keyboard / --shot.
                                    game::record_floor(ledger, currentFloor);
                                    samosbor = game::samosbor_new_game(sbRng);
                                    rumourLine[0] = 0;
                                    rumourAt = 0;
                                    game::noise_clear(noiseField);
                                    currentSpec = spec_for_floor(currentFloor);
                                    cubePass.invalidate();
                                    const LayerId nl =
                                        reg.valid(player)
                                            ? reg.get<Transform>(player).layer
                                            : activeLayer;
                                    activeLayer = nl;
                                    // Arrival order is load-path law, not a suggestion:
                                    // containers before re-open, mobs, doors, freeze,
                                    // bake, then placement. [save.h]
                                    refresh_floor_containers(reg, stack.layer(nl),
                                                             currentFloor, nl);
                                    reopened = game::apply_opened_containers(
                                        reg, nl, currentFloor, runState.opened.data(),
                                        runState.opened.size());
                                    refresh_floor_mobs(reg, stack.layer(nl),
                                                       currentFloor, nl);
                                    if (currentSpec)
                                        doorsBuilt = game::door_build(
                                            stack.layer(nl), doors, currentFloor,
                                            *currentSpec, kDoorSeed);
                                    doors.frozen = true;
                                    begin_floor_nav(stack.layer(nl), nav);
                                    if (propPass.ready()) {
                                        std::uint32_t fseed =
                                            1337u ^
                                            (static_cast<std::uint32_t>(currentFloor) *
                                             0x9e3779b9u);
                                        propPlacer.populate(stack.layer(nl).grid(),
                                                            propPass, fseed);
                                    }
                                } else {
                                    // Unknown floor label or missing NpcRef — run
                                    // still restores in place; body stays put.
                                    travelRefused = true;
                                    arrived = false;
                                }
                            }

                            // Pool row first: needs/inv/hp/maxHp survive a body swap
                            // and must land before armour is re-derived from inv.
                            const game::NpcRef* nrl =
                                reg.valid(player) ? reg.try_get<game::NpcRef>(player)
                                                  : nullptr;
                            if (nrl && pool.valid(nrl->id)) {
                                game::apply_player_snapshot(pool, nrl->id,
                                                            runState.player);
                                game::sync_armour(reg, pool, player);
                            }

                            // Same-floor load never rebuilt crates; re-empty looted
                            // ones against the live layer. Cross-floor already did.
                            if (!floorMoved) {
                                reopened = game::apply_opened_containers(
                                    reg, activeLayer, currentFloor,
                                    runState.opened.data(), runState.opened.size());
                            }

                            game::PlacedCell placed{};
                            if (reg.valid(player)) {
                                const LayerId pl = reg.get<Transform>(player).layer;
                                activeLayer = pl;
                                placed = game::place_body_at_cell(
                                    reg, stack.layer(pl), player, scx, scy, scz);
                                aim_player(reg, player);
                            }

                            // Honest HUD: refuse / partial ride / place slip / ok.
                            if (travelRefused) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded %u rub; floor %d unreachable (on %d)",
                                    static_cast<unsigned>(ledger.banked), savedFloor,
                                    currentFloor);
                            } else if (!arrived) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded %u rub; rode to %d (saved %d), %s",
                                    static_cast<unsigned>(ledger.banked), currentFloor,
                                    savedFloor,
                                    placed.ok
                                        ? (placed.moved ? "placed nearby" : "placed")
                                        : "place refused");
                            } else if (!placed.ok) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded %u rub floor %d; place refused, %u crates",
                                    static_cast<unsigned>(ledger.banked), currentFloor,
                                    static_cast<unsigned>(reopened));
                            } else if (placed.moved) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded: floor %d, %u rub, placed nearby, %u crates",
                                    currentFloor,
                                    static_cast<unsigned>(ledger.banked),
                                    static_cast<unsigned>(reopened));
                            } else {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded: floor %d @%u,%u,%u, %u rub, %u crates",
                                    currentFloor, static_cast<unsigned>(scx),
                                    static_cast<unsigned>(scy),
                                    static_cast<unsigned>(scz),
                                    static_cast<unsigned>(ledger.banked),
                                    static_cast<unsigned>(reopened));
                            }
                        }
                        saveLineAt = simTick;
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
                // CRAFTING. The extraction pad is the only bench in the game today, and
                // that is a measured limitation rather than a placeholder: 259 of the 446
                // recipes (22 `Any` + 237 Workbench) are reachable there, and the other
                // 187 (92 lathe / 77 lab / 18 net_terminal) wait on station placement in
                // floor_gen. Off the pad the player has bare hands, which satisfies the
                // 22 `Any` recipes and nothing else. Disassembly is workbench-only by the
                // reference's rule, so it is pad-only too. [craft.h]
                if ((craftWanted || scrapWanted) && reg.valid(player)) {
                    const Transform& ct = reg.get<Transform>(player);
                    bool nearTerm = false;
                    if (propPass.ready()) {
                        for (const vec3& tp : propPass.get_terminal_positions()) {
                            float dx = tp.x - ct.pos.x, dy = tp.y - ct.pos.y, dz = tp.z - ct.pos.z;
                            if (dx * dx + dy * dy + dz * dz < 16.0f) { nearTerm = true; break; }
                        }
                    }
                    const game::CraftStation bench =
                        game::on_extraction_pad(stack.layer(activeLayer).grid(), ct.pos)
                            ? game::CraftStation::Workbench
                            : (nearTerm ? game::CraftStation::NetTerminal : game::CraftStation::Any);
                    bool invChanged = false;
                    if (const auto* nrk = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrk->id)) {
                            game::Inventory& ci = pool.inventory(nrk->id);
                            if (craftWanted) {
                                if (particlePass.ready()) {
                                    particlePass.emit_burst(ct.pos + vec3{0.0f, 1.2f, 0.0f}, vec3{0.0f, 1.0f, 0.0f},
                                                            vec3{0.20f, 0.90f, 1.00f}, gpu::GpuParticleKind::ElecArc, 16, 4.0f, 1.2f, 0.25f, 90.0f);
                                }
                                const game::LearnResult lr =
                                    game::craft_learn_from_carried(crafting, ci);
                                recipesLearned += lr.learned;
                                if (lr.consumed) invChanged = true;
                                if (lr.learned == 0) {
                                    // kInvalidItem is a safe argument here: craft_item
                                    // answers UnknownItem rather than indexing on it.
                                    const game::ItemId pick =
                                        game::craft_best_available(crafting, ci, bench);
                                    if (game::craft_item(crafting, ci, pick, bench).fail ==
                                        game::CraftFail::None) {
                                        ++crafted;
                                        invChanged = true;
                                    }
                                }
                            }
                            if (scrapWanted) {
                                const int slot = game::craft_scrap_slot(ci);
                                // rollKey is uint32_t and simTick is uint64_t, so the
                                // narrowing is explicit. Truncation is harmless and in
                                // fact wanted: this only salts the 50% schematic roll, so
                                // the low bits are the entropy and wrapping every ~4.3e9
                                // ticks (~1.1 sim years at 125 Hz) changes nothing.
                                if (game::craft_disassemble(
                                        crafting, ci, slot, bench,
                                        static_cast<std::uint32_t>(simTick))
                                        .fail == game::CraftFail::None) {
                                    ++scrapped;
                                    invChanged = true;
                                }
                            }
                        }
                    // combat.h: "call after anything that changes the inventory". Crafting
                    // a better vest changes what equipped_armour resolves to, so skipping
                    // this would leave the body wearing the old one.
                    if (invChanged) game::sync_armour(reg, pool, player);
                    craftWanted = false;
                    scrapWanted = false;
                }
                // Contracts advance and pay AFTER the extraction step, so a Fetch
                // job completes at the pad — the same moment the loop's own payoff
                // lands, which is what makes the errand feel like part of the trip
                // rather than a parallel accounting system. [contract.h]
                if (reg.valid(player))
                    if (const auto* nrc = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrc->id)) {
                            contractPaid += game::contract_step(
                                contracts, pool, pool.inventory(nrc->id), ledger);
                            questPaid += game::quest_step(
                                quests, pool, pool.inventory(nrc->id), ledger,
                                static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f));
                        }
                // Eating and drinking sit beside healing and AFTER pickup_step, so a
                // ration picked up this tick can be eaten this tick. Both refuse a
                // full bar, so a mistimed press costs nothing; both also fill
                // pendingPee / pendingPoo, which is the ONLY producer the pressure
                // metering has. [needs.h]
                //
                // hpCost is routed through apply_damage rather than dropped:
                // `apply_consumable` deliberately does NOT touch HP and reports the
                // cost for the caller to bill ([needs.h]), clamped so bad food
                // floors at 1 HP. Discarding it would make risky food free, and a
                // gamble with no downside is not a gamble.
                if (eatWanted || drinkWanted) {
                    game::ConsumeResult cr{};
                    if (eatWanted) {
                        cr = game::use_best_food(reg, pool, bus, activeLayer,
                                                 simTick);
                        ateFood += cr.food;
                        eatWanted = false;
                    } else {
                        cr = game::use_best_drink(reg, pool, bus, activeLayer,
                                                  simTick);
                        drankWater += cr.water;
                        drinkWanted = false;
                    }
                    if (cr.used && cr.hpCost > 0 && reg.valid(player)) {
                        game::apply_damage(reg, pool, player, cr.hpCost,
                                           game::DamageChannel::Kinetic, player);
                        consumeHpCost += cr.hpCost;
                    }
                }
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
                    //
                    // Neither does the character sheet. `embody_as_player` rolls a
                    // fresh RpgStats from the new record, which is right for a
                    // possession but wrong across a DEATH — losing every level to a
                    // bad corridor is not the reference's rule, and the kill tally
                    // beside it already survives for the same reason. Captured
                    // before the possess (the old body is already gone by then, so
                    // this reads the value saved off at the top of the death path).
                    player = possess_a_survivor(reg, pool, activeLayer);
                    if (player == entt::null) { running = false; break; }
                    aim_player(reg, player);
                    reg.emplace_or_replace<game::PlayerMelee>(
                        player, game::PlayerMelee{0, kills});
                    reg.emplace_or_replace<game::RpgStats>(player, carriedRpg);
                } else if (const auto* rsLive = reg.try_get<game::RpgStats>(player)) {
                    // The body SURVIVED the tick. Refresh the snapshot, because
                    // finalize_deaths above may have just awarded XP and levelled it
                    // — without this, a level earned by the killing blow would be
                    // rolled back by the next death.
                    carriedRpg = *rsLive;
                }
                ++simTick;
                // THE MACRO CLOCK. kMacroPeriodTicks = kSimHz*2 = 250, which is
                // exactly 2.000 s at 125 Hz — kSimStepMs is exactly 8 ms, so the
                // period is lossless and cannot drift. Placed after ++simTick so the
                // first fire is tick 250 and not tick 0, before the world is embodied.
                // The coarse clock (tick_/dayTenths_) lives inside MacroSim, so main
                // holds no accumulator of its own.
                //
                // The live `factionRel` is lent, never copied: the social pass is the
                // only reader and it stays gated off while socialFormRatePerYear is 0
                // (that pass demands a 128 MiB rel_ column — see [npc_pool.h] — and
                // nothing renders the graph yet). Passing the real matrix now means
                // that when social is switched on it reads the one true source of
                // attitudes instead of a second, silently diverging copy. [macrosim.md]
                if (genMode != WorldGenMode::Maze && simTick % game::kMacroPeriodTicks == 0) {
                    macroStats = macroSim.step(pool, macroParams, &factionRel);
                    // The world lives whether or not anyone is looking, and this line
                    // is the proof: a headless run shows the population moving with no
                    // HUD and no window. One line per macro tick, so ~30/minute.
                    std::fprintf(stderr,
                                 "[macro] tick=%llu day=%.1f living=%u births=%u "
                                 "deaths=%u blocked=%u depart=%u arrive=%u "
                                 "transit=%u reserve=%u\n",
                                 static_cast<unsigned long long>(macroStats.tick),
                                 macroSim.day(), macroStats.living, macroStats.births,
                                 macroStats.deaths, macroStats.birthsBlocked,
                                 macroStats.departures, macroStats.arrivals,
                                 macroStats.inTransit, macroStats.reserveRemaining);
                }
                // Fluid only lives in the maze test bed (the floor modules seed no
                // puddles yet); step it on the active layer there.
                if (genMode == WorldGenMode::Maze && !fluidPaused &&
                    ++fluidCounter >= fluidStepEvery) {
                    fluid_step(activeWorld);
                    fluidCounter = 0;
                    // Fluid tints cell colours, so the cached instance list is
                    // stale. This is the one place the cache rebuilds regularly —
                    // and only in maze mode, where fluid exists.
                    cubePass.invalidate();
                }
                simNow += kSimDt;
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
            if (renderer.timer.supported()) {
                ImGui::Text("gpu: world %.3f | bodies %.3f | hud %.3f | "
                            "frame %.3f ms",
                            renderer.timer.pass_ms(gpu::GpuPass::World),
                            renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms());
                // The median above is DESIGNED to hide spikes — it takes 16 slow frames
                // out of 31 to move it — so it cannot see a hitch. This line is the WORST
                // frame in the same window. A peak that moved while the median did not is
                // a stutter; both moving together is a real cost change. `drop` must stay
                // at 0: a growing value means every figure above is computed over a stale
                // window and none of them mean anything. [gpu_timer.h]
                ImGui::Text("gpu peak: world %.3f | bodies %.3f | hud %.3f | "
                            "frame %.3f ms | drop %u",
                            renderer.timer.pass_ms_max(gpu::GpuPass::World),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms_max(), renderer.timer.dropped());
            } else {
                // Deliberately no longer "queue family writes no timestamps": supported()
                // is now ALSO false when the timer was switched off with GIGA_GPU_TIMER=0,
                // and blaming the queue family in that case would be a lie.
                ImGui::TextUnformatted(
                    "gpu: n/a (no timestamps, or GIGA_GPU_TIMER=0)");
            }
            auto& tr = reg.get<Transform>(player);
            auto& ctl = reg.get<Controller>(player);
            auto& ga = reg.get<GravityAffected>(player);
            ImGui::Text("pos  %.1f %.1f %.1f (layer %u)", tr.pos.x, tr.pos.y,
                        tr.pos.z, tr.layer);
            ImGui::Text("mode %s%s", ctl.fly ? "fly" : "walk",
                        ga.grounded ? " (grounded)" : "");
            ImGui::Text("instances drawn: %u / %zu cells | props %u | cull %s | particles %s",
                        cubePass.last_instance_count(), kMacroCells,
                        propPass.last_draw_count(),
                        cullPass.ready() ? "GPU-ready" : "off",
                        particlePass.ready() ? "on" : "off");
            std::int16_t php = 0, pmax = 0;
            if (game::entity_health(reg, pool, player, php, pmax))
                ImGui::Text("HP %d / %d%s", php, pmax, php <= 0 ? "  DEAD" : "");
            if (reg.valid(player))
                if (const auto* pm = reg.try_get<game::PlayerMelee>(player))
                    kills = pm->kills;
            ImGui::Text("hits taken: %u | deaths: %u | kills: %u", meleeHits,
                        deaths, kills);
            // Character sheet. ASCII only, like every other printf/ImGui string in
            // this file — the Windows console is CP1251 and Cyrillic here mojibakes.
            if (reg.valid(player))
                if (const auto* rs = reg.try_get<game::RpgStats>(player)) {
                    const std::uint32_t need =
                        rs->level < game::kRpgLevelCap
                            ? game::xp_for_level(
                                  static_cast<std::uint8_t>(rs->level + 1))
                            : 0u;
                    if (need > 0)
                        ImGui::Text("LVL %u  XP %u / %u", rs->level, rs->xp, need);
                    else
                        ImGui::Text("LVL %u  (MAX)", rs->level);
                    ImGui::Text("STR %u  AGI %u  INT %u%s",
                                rs->attr[0], rs->attr[1], rs->attr[2],
                                rs->attrPoints > 0 ? "   [+pts]" : "");
                    ImGui::Text("PSI %u / %u", rs->psi, game::max_psi(*rs));
                }
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
                // Doors: built/shut/broken, plus how many bodies are leaning on one
                // right now. `pressing` is the number that makes a shut door read as
                // a consumable resource rather than a wall — you can watch it fall.
                // What the last save or load said, for ~6 s. A save that fails silently
                // is a save the player only finds out about by losing a run.
                if (saveLine[0] && simTick - saveLineAt < 6u * kSimHz)
                    ImGui::TextUnformatted(saveLine);
                ImGui::Text("doors %u built | %u shut | %u broken | %u pressing%s",
                            doorsBuilt, doors.shut, doors.broken, doorTick.pressing,
                            doors.frozen ? "  (frozen: nav baking)" : "");
                ImGui::Text("loot %d rub (%d/%d slots) | healed %d | band E%u",
                            carried, slots, game::kInvSlots, healed,
                            game::economy_band(currentFloor));
                // Crafting, on screen: C builds or reads, X strips. `bank` is the 9-axis
                // material vector summed, because nine numbers on the HUD would be noise
                // — the per-axis detail is what the craft menu is for when one exists.
                // Tier only rises by reading a blueprint, so it is the one number here
                // that reports progression rather than activity.
                std::uint32_t bankTotal = 0;
                for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi)
                    bankTotal += crafting.mat[mi];
                ImGui::Text("craft T%u | %u made / %u stripped / %u learned | %u units "
                            "banked  (C build, X strip)",
                            static_cast<unsigned>(crafting.tier), crafted, scrapped,
                            recipesLearned, bankTotal);
                // The macro society, on screen. `living` is the WHOLE cold population,
                // not the handful embodied on this floor, so this number moving is the
                // visible proof that the world runs on its own clock. It updates once
                // every kMacroPeriodTicks (2.000 s), so it deliberately does not track
                // the frame.
                ImGui::Text("society %u alive | +%u births / -%u deaths | %u in transit"
                            "%s",
                            macroStats.living, macroStats.births, macroStats.deaths,
                            macroStats.inTransit,
                            macroStats.birthsBlocked != 0
                                ? "  (RESERVE FLOOR: births refused)"
                                : "");
                ImGui::Text("day %.1f | macro tick %llu | feud hits %u | "
                            "relations %u kills / %u shifts",
                            macroSim.day(),
                            static_cast<unsigned long long>(macroStats.tick), feudHits,
                            relTick.kills, relTick.changes);
                // The utility AI, and it reads ZERO on purpose while aiCfg.enabled is false
                // — a dormant system that shows nothing is indistinguishable from a missing
                // one, which is how the parked call rotted unnoticed for weeks. `ai/wander`
                // is the single-writer split: those two must never both be non-zero for the
                // same body on the same tick, and that is what suite_utilai measures. [ai.h]
                ImGui::Text("ai %s | %u seen / %u replan / %u switch | own ai %u / wander %u"
                            " | mem %u recall / %u filed / %u fled",
                            aiCfg.enabled ? "ON" : "off (dormant)", aiTick.considered,
                            aiTick.replanned, aiTick.switches, aiTick.aiOwned,
                            aiTick.wanderOwned, aiTick.recalled, aiTick.remembered,
                            aiTick.memoryFled);
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
            // The loudest recent noise, and how far away it is. Without this the whole
            // system is invisible: a monster walking toward a gunshot looks exactly
            // like a monster wandering, and "a change nobody can see" is
            // indistinguishable from a no-op. Reported from the PLAYER's ear with no
            // hearing bonus and no severity floor, so it shows what is actually in the
            // field rather than what a monster would bother with. [noise.h]
            {
                float nd = 0.0f;
                const game::Noise* ln = reg.valid(player)
                    ? game::loudest_heard(noiseField, activeLayer,
                                          reg.get<Transform>(player).pos,
                                          /*hearingMult=*/1.0f, /*minSeverity=*/0,
                                          /*ignoreActor=*/0, &nd)
                    : nullptr;
                if (ln)
                    ImGui::TextColored(ImVec4(0.98f, 0.79f, 0.55f, 1.0f),
                                       "NOISE %s sev%u  %.1f m of %.0f  %.2f s left"
                                       "  | %u live, %u investigating",
                                       game::noise_source_name(
                                           static_cast<game::NoiseSource>(ln->source)),
                                       ln->severity, nd, ln->radius,
                                       ln->ttlMs * 0.001f,
                                       static_cast<unsigned>(noiseField.live()),
                                       heardMobs);
                else
                    ImGui::Text("noise: - (%u live, %u dropped)",
                                static_cast<unsigned>(noiseField.live()),
                                noiseField.dropped);
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
                if (elevDiagLine[0] && simTick - elevDiagAt < 8u * kSimHz)
                    ImGui::TextColored(ImVec4(0.35f, 0.85f, 1.0f, 1.0f), "%s", elevDiagLine);
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
                // The PENDING queues, not just the bars: pee/poo have no autonomous
                // growth, so without the queue on screen the pressure numbers look
                // frozen when they are in fact many minutes of metering from 100.
                ImGui::Text("ate %.0f food %.0f water | pending pee %.0f poo %.0f | risky -%d hp",
                            ateFood, drankWater, nd.pendingPee, nd.pendingPoo,
                            consumeHpCost);
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
                if (questOfferLine[0])
                    ImGui::TextColored(ImVec4(0.70f, 0.98f, 0.60f, 1.0f),
                                       "QUEST (E to take): %s", questOfferLine);
                ImGui::Text("jobs %d active | %u done | %u failed | paid %d rub",
                            active, contracts.completed, contracts.failed,
                            contractPaid);
                // Active quests — each row reports title + progress + time left.
                const int qActive = game::quest_active_count(quests);
                if (qActive > 0) {
                    ImGui::Separator();
                    ImGui::Text("quests %d active | paid %d rub", qActive, questPaid);
                    for (int qi = 1; qi <= static_cast<int>(game::kQuestCount); ++qi) {
                        char qline[320];
                        const game::QuestId qid = static_cast<game::QuestId>(qi);
                        if (game::quest_line(quests, qid, qline, sizeof(qline)))
                            ImGui::TextColored(ImVec4(0.70f, 0.98f, 0.60f, 1.0f),
                                               "  quest: %s", qline);
                    }
                }
            }
            if (rumourLine[0])
                ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "\"%s\"",
                                   rumourLine);
            // Tan, NOT rumour's cyan, and prefixed with the situation so the two channels
            // are distinguishable at a glance. #cca is the reference's own authored bark
            // colour, and keeping them different is what stops a murmur from reading as a
            // checkable fact. [speech.h]
            if (speechLine != nullptr)
                ImGui::TextColored(ImVec4(0.80f, 0.80f, 0.67f, 1.0f), "[%s] %s",
                                   game::speech_situation_name(speechSit), speechLine);
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
            // The coarse society tick's last report ([macro_sim.h]). Off in maze mode
            // (no registered floor set). `macroSim.tick()` is 0 until the first step
            // lands ~2 s in, so this reads "warming up" rather than a row of zeroes
            // that looks broken. births/deaths are this step's tallies; in-transit is
            // the live migration backlog; reserve is the birth headroom the pool will
            // never reclaim (the design-scale wall lives here, macro_sim.h banner).
            if (genMode != WorldGenMode::Maze) {
                if (macroSim.tick() == 0)
                    ImGui::Text("society: warming up (first macro tick at %.1f s)",
                                static_cast<float>(game::kMacroPeriodTicks) *
                                    kSimDt);
                else
                    ImGui::Text("society: %u living  +%u/-%u  %u in transit  "
                                "| reserve %u  (t%llu, day %.1f)",
                                macroStats.living, macroStats.births,
                                macroStats.deaths, macroStats.inTransit,
                                macroStats.reserveRemaining,
                                static_cast<unsigned long long>(macroStats.tick),
                                macroSim.day());
            }
            if (genMode == WorldGenMode::Maze) {
                ImGui::Checkbox("pause fluid", &fluidPaused);
                ImGui::SliderInt("fluid step every", &fluidStepEvery, 1, 30);
            }
            ImGui::TextUnformatted(
                "WASD move | mouse look | Tab toggle look | Space jump | "
                "F fly | Q door | G eat | T drink | F5/F9 save/load | [ / ] floor | Esc menu");
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

        // Begin command recording & compute pass before graphics render pass
        if (renderer.begin_frame_cmd(window)) {
            VkCommandBuffer cmd = renderer.current_cmd();
            float currentTimeSec = static_cast<float>(SDL_GetTicks()) / 1000.0f;

            if (lightGrid.ready()) {
                collect_scene_lights(lightGrid, camMat.eye, currentTimeSec, samosbor, reg, activeLayer);
                lightGrid.update_and_dispatch(cmd, currentTimeSec, camMat.eye);
            }

            if (particlePass.ready()) {
                particlePass.emit_burst(camMat.eye + vec3{0.0f, 0.5f, 0.0f},
                                        vec3{0.0f, 0.2f, 0.0f},
                                        vec3{0.85f, 0.80f, 0.70f},
                                        gpu::GpuParticleKind::DustMote,
                                        3, 0.8f, 4.0f, 0.15f, 180.0f);
                particlePass.record_compute(cmd, kSimDt, currentTimeSec, camMat.eye);
            }

            if (cullPass.ready() && propPass.ready()) {
                propPass.set_use_gpu_culling(true);
                const mat4 vp = mat4_mul(camMat.proj, camMat.view);
                const uint32_t fIdx = renderer.currentFrame;
                const float fogEnd = kWorldExtent * 0.50f * samosbor_fog_scale(samosbor);
                const float torusPeriod = kWorldExtent;
                for (int s = 0; s < gpu::kPropShapeCount; ++s) {
                    uint32_t count = propPass.instance_count(s);
                    if (count == 0) continue;
                    vec3 bMin{-1.0f, -1.0f, -1.0f}, bMax{1.0f, 2.0f, 1.0f};
                    gpu::GpuCullPass::get_shape_aabb(static_cast<gpu::PropShape>(s), bMin, bMax);
                    cullPass.record_cull(
                        cmd, vp, camMat.eye, fogEnd, torusPeriod,
                        propPass.instance_buffer(s, fIdx), count,
                        propPass.mesh(s).indexCount, 0, 0, 0,
                        bMin, bMax,
                        propPass.culled_instance_buffer(s, fIdx),
                        propPass.indirect_cmd_buffer(s, fIdx));
                }
            } else if (propPass.ready()) {
                propPass.set_use_gpu_culling(false);
            }

            renderer.begin_pass(0.0f, 0.0f, 0.0f);

            gpu::CubePush push{};
            push.viewProj = mat4_mul(camMat.proj, camMat.view);
            push.sunDir = vec4{0.4f, 0.3f, 0.85f, kFillStrength};
            push.camPos = vec4{camMat.eye.x, camMat.eye.y, camMat.eye.z,
                               kLampIntensity};
            const float fogScale = samosbor_fog_scale(samosbor);
            const float samosborPulse = std::clamp((1.0f - fogScale) / (1.0f - kSamosborFogSqueeze), 0.0f, 1.0f);
            push.fog = vec4{kWorldExtent * 0.30f * fogScale,
                            kWorldExtent * 0.50f * fogScale,
                            kLampRadius, kAmbient};
            // The wrap period, so cube.vert can place each cell at its nearest
            // toroidal image itself. Instance origins are absolute, which is what
            // makes the cube pass's instance cache possible.
            push.torus = vec4{kWorldExtent, kAoDirect, samosborPulse, currentTimeSec};
            // Each pass is bracketed by GPU timestamps as well as by the CPU
            // clock: the two answer different questions and need opposite fixes.
            // The CPU figure is time spent building instance data on this thread;
            // the GPU figure is what the hardware then spent rasterising it.
            std::uint64_t t0 = SDL_GetPerformanceCounter();
            renderer.timer.pass_begin(cmd, gpu::GpuPass::World);
            cubePass.record(cmd, renderer.currentFrame,
                            stack.layer(activeLayer), push, lightGrid.descriptor_set());
            renderer.timer.pass_end(cmd, gpu::GpuPass::World);
            std::uint64_t t1 = SDL_GetPerformanceCounter();
            // Draw the embodied population on the active layer (shared depth).
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Bodies);
            bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push, lightGrid.descriptor_set());
            renderer.timer.pass_end(cmd, gpu::GpuPass::Bodies);
            // Props: GPU-instanced arbitrary-mesh pass, same depth buffer.
            if (propPass.ready())
                propPass.record(cmd, renderer.currentFrame, push, lightGrid.descriptor_set());
            if (particlePass.ready()) {
                gpu::ParticleDrawPush particlePush{};
                mat4 vp = mat4_mul(camMat.proj, camMat.view);
                std::memcpy(particlePush.viewProj, &vp, sizeof(vp));
                particlePush.camPos = camMat.eye;
                particlePush.camRight = vec3{camMat.view.m[0], camMat.view.m[4], camMat.view.m[8]};
                particlePush.camUp = vec3{camMat.view.m[1], camMat.view.m[5], camMat.view.m[9]};
                particlePush.fogStart = kWorldExtent * 0.30f * fogScale;
                particlePush.fogEnd = kWorldExtent * 0.50f * fogScale;
                particlePass.record_draw(cmd, particlePush, lightGrid.descriptor_set());
            }

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
                    // Same capture as the keyboard ride path. Two travel sites;
                    // without this, --shot loot -> ride -> return refills crates.
                    // [save.h]
                    {
                        const LayerId leaveLayer =
                            reg.valid(player) ? reg.get<Transform>(player).layer
                                              : static_cast<LayerId>(0);
                        game::refresh_opened_containers(reg, leaveLayer, currentFloor,
                                                        runState.opened);
                    }
                    game::RideResult r = streamer.travel(
                        stack, registry, reg, pool, player, currentFloor, -1,
                        /*arrivalZ=*/2, pid);
                    if (r.moved) {
                        player = r.player;
                        currentFloor = r.floor;
                        game::record_floor(ledger, currentFloor);
                        // currentSpec was "(HUD only)" until door_build started reading
                        // it, and only the KEYBOARD ride path maintained it — so a
                        // --shot ride built floor -36's doors against floor 0's
                        // Residential spec and produced ZERO doors. Caught by running
                        // the game, not by a test: the HUD read "doors 0 built" on a
                        // floor where the keyboard path builds thousands.
                        //
                        // This is the two-travel-sites trap this file already warns
                        // about, hit again by promoting a display variable to a source
                        // of truth. Both sites now set it.
                        currentSpec = spec_for_floor(currentFloor);
                        samosbor = game::samosbor_new_game(sbRng);
                        aim_player(reg, player);
                        LayerId nl = reg.get<Transform>(player).layer;
                        activeLayer = nl;
                        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
                        refresh_floor_containers(reg, stack.layer(nl),
                                                 currentFloor, nl);
                        // Re-empty crates already looted on a prior visit.
                        // Same seam as keyboard ride + F9 apply. [save.h]
                        game::apply_opened_containers(
                            reg, nl, currentFloor, runState.opened.data(),
                            runState.opened.size());
                        // Doors before the bake, frozen for its duration. [door.h]
                        // This is the SECOND travel site — see the note below; a fix
                        // that touches only the keyboard path leaves --shot without
                        // doors and the capture then proves nothing about them.
                        if (currentSpec)
                            doorsBuilt = game::door_build(
                                stack.layer(nl), doors, currentFloor,
                                *currentSpec, kDoorSeed);
                        doors.frozen = true;
                        begin_floor_nav(stack.layer(nl), nav);
                        cubePass.invalidate();
                        if (propPass.ready()) {
                            std::uint32_t fseed = 1337u ^ (static_cast<std::uint32_t>(currentFloor) * 0x9e3779b9u);
                            propPlacer.populate(stack.layer(nl).grid(), propPass, fseed);
                        }
                        // Same clear as the keyboard ride path. There are TWO travel
                        // sites and the first fix only touched one, so a --shot
                        // capture kept reporting a rumour about the floor it started
                        // on. A duplicated code path is a duplicated bug; this is the
                        // second one and the reason to be suspicious of the shape.
                        rumourLine[0] = 0;
                        rumourAt = 0;
                        // A gunshot on the floor you just left must not be audible to
                        // the crowd on the one you arrived at. The streamer RECYCLES
                        // LayerId slots, so a surviving record would not merely be
                        // stale — it would match the new floor's layer id and be heard
                        // there. [noise.h]
                        game::noise_clear(noiseField);
                        // Same place_body_safely as the keyboard ride path. Two travel
                        // sites; a fix that touches only one leaves --shot soft-locked
                        // in a wall. [save.h]
                        game::place_body_safely(reg, stack.layer(nl), player);
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
                    // The peak beside the median, for the same reason the HUD carries
                    // both: an unattended capture that records only a median cannot
                    // distinguish "this got slower" from "this got spikier", and a
                    // non-zero drop count invalidates every median in the line above.
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms-peak: world %.3f bodies %.3f hud %.3f "
                                     "frame %.3f  (dropped %u)\n",
                                     renderer.timer.pass_ms_max(gpu::GpuPass::World),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Hud),
                                     renderer.timer.frame_ms_max(),
                                     renderer.timer.dropped());
                    if (!renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms: n/a (no timestamps, or "
                                     "GIGA_GPU_TIMER=0)\n");
                    running = false;
                }
            }
        }
    }

    // --- teardown (reverse order) -----------------------------------------
    hud.destroy();
    particlePass.destroy();
    cullPass.destroy();
    propPass.destroy();
    bodyPass.destroy();
    cubePass.destroy();
    lightGrid.destroy();
    renderer.destroy();
    device.destroy();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}

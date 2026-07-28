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

#include <cstdint>
#include <cstdio>
#include <string>

#include "imgui.h"
#include "imgui_impl_sdl3.h"

#include "app/worldgen.h"
#include "core/math.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"
#include "game/elevator.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/npc_pool.h"
#include "game/population.h"
#include "input/input.h"
#include "render/body_pass.h"
#include "render/cube_pass.h"
#include "render/imgui_layer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "render/vk_swapchain.h"
#include "sim/camera.h"
#include "sim/controller.h"
#include "sim/fluid.h"
#include "sim/physics.h"
#include "world/level_stack.h"

using namespace giga;

namespace {

constexpr int kWinW = 1280;
constexpr int kWinH = 720;

// Fixed sim step (seconds). Physics + controller run at this rate; rendering is
// uncapped and interpolation is skipped for simplicity (the step is small).
constexpr float kSimDt = 1.0f / 120.0f;

// Lighting tunables, packed into the dead lanes of CubePush (see cube.frag).
// The floors are windowless interiors, so the headlamp the player carries is the
// primary light and ambient is deliberately near-black; raise kAmbient and the
// world flattens back into an evenly-lit mosaic.
constexpr float kLampIntensity = 2.2f;  // camPos.w
constexpr float kLampRadius = 14.0f;    // fog.z, metres (7 macro cells)
constexpr float kFillStrength = 0.10f;  // sunDir.w, weak non-black backstop
constexpr float kAmbient = 0.35f;       // fog.w, scales the hemispheric term

// The demo floor stack: one row per floor MODULE. Numbers are the in-game labels
// the FloorRegistry assigns (floors.md); kinds are picked to show every geometry
// family side by side. Floor 0 is the residential hub the player starts on.
struct DemoFloor {
    int number;
    game::FloorKind kind;
};
constexpr DemoFloor kDemoFloors[] = {
    {0, game::FloorKind::Residential}, // start / hub
    {1, game::FloorKind::Commercial},
    {2, game::FloorKind::Industrial},
    {3, game::FloorKind::Derelict},
    {4, game::FloorKind::Residential},
};

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

// Look up the rule-set for a demo floor by its in-game number (HUD only).
const game::FloorSpec* spec_for_floor(int number) {
    for (const DemoFloor& f : kDemoFloors)
        if (f.number == number) return &game::floor_spec(f.kind);
    return nullptr;
}

} // namespace

int main(int argc, char** argv) {
    // World select: `gigahrush2 maze` for the labyrinth test bed, otherwise the
    // floor-module stack (default).
    WorldGenMode genMode = WorldGenMode::FloorStack;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "maze") genMode = WorldGenMode::Maze;
        else if (a == "floors" || a == "stack") genMode = WorldGenMode::FloorStack;
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
    game::NpcPool pool;
    pool.init();
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
        if (player != entt::null) aim_player(reg, player);
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
    int fluidStepEvery = 4; // sim steps between fluid updates
    int fluidCounter = 0;

    while (running) {
        std::uint64_t now = SDL_GetPerformanceCounter();
        float frameDt = static_cast<float>((now - prevTicks) / freq);
        prevTicks = now;
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
                        currentSpec = spec_for_floor(currentFloor);
                        // Streaming recycles World objects in place, so the cube
                        // pass cannot detect the new geometry by identity.
                        cubePass.invalidate();
                    }
                }
            }
            // While the pause menu is up, ignore all look/move input: ImGui owns
            // the cursor and the game is frozen.
            if (!paused) {
                // Hold right mouse button to look, release to free the cursor.
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
                physics_step(reg, stack, kSimDt);
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
            auto& tr = reg.get<Transform>(player);
            auto& ctl = reg.get<Controller>(player);
            auto& ga = reg.get<GravityAffected>(player);
            ImGui::Text("pos  %.1f %.1f %.1f (layer %u)", tr.pos.x, tr.pos.y,
                        tr.pos.z, tr.layer);
            ImGui::Text("mode %s%s", ctl.fly ? "fly" : "walk",
                        ga.grounded ? " (grounded)" : "");
            ImGui::Text("instances drawn: %u / %zu cells",
                        cubePass.last_instance_count(), kMacroCells);
            ImGui::Text("bodies drawn: %u  (pop %u alive / %u slots)",
                        bodyPass.last_instance_count(), pool.count(),
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
            push.fog = vec4{kWorldExtent * 0.30f, kWorldExtent * 0.50f,
                            kLampRadius, kAmbient};
            // The wrap period, so cube.vert can place each cell at its nearest
            // toroidal image itself. Instance origins are absolute, which is what
            // makes the cube pass's instance cache possible.
            push.torus = vec4{kWorldExtent, 0.0f, 0.0f, 0.0f};
            std::uint64_t t0 = SDL_GetPerformanceCounter();
            cubePass.record(cmd, renderer.currentFrame,
                            stack.layer(activeLayer), push);
            std::uint64_t t1 = SDL_GetPerformanceCounter();
            // Draw the embodied population on the active layer (shared depth).
            bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push);
            std::uint64_t t2 = SDL_GetPerformanceCounter();
            cubeMs = static_cast<float>((t1 - t0) / freq * 1000.0);
            bodyMs = static_cast<float>((t2 - t1) / freq * 1000.0);
            hud.render(cmd);
            renderer.end_frame(window);
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

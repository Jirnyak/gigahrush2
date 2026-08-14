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
// floor.
//
// Controls are DATA, not code: every key lives in the KeybindTable
// ([keybind.h]) as a row mapping a scancode to a console command
// ([console.h]), rebindable in the pause menu (Esc) and persisted to
// gigahrush2.keys. Defaults: WASD move, mouse look (hold right mouse / Tab),
// Space jump, F fly, Q door, E interact, [ / ] floor travel, ~ console.
#include <SDL3/SDL.h>
#include <algorithm>
#include <SDL3/SDL_vulkan.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

#include "imgui.h"
#include "imgui_impl_sdl3.h"

#include "core/math.h"
#include "game/mob_table.h"
#include "core/tick.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"       // the utility AI — adapted, wired, and dormant by default
#include "game/day_clock.h" // DayClock — single truth of in-game diurnal time
#include "game/room_zone.h" // room affordance/recovery tables + the baked zone fields
#include "game/encumbrance.h" // carried weight -> mass, speed, fatigue, noise
#include "game/embody.h"
#include "game/impact.h"
#include "game/elevator.h"
#include "game/console.h"
#include "game/fast_travel.h" // §24 lattice hub unlock + boarding
#include "game/keybind.h"
#include "game/floor_catalog.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/macro_sim.h"
#include "game/mob_spawn.h"
#include "game/monster_traits.h"
#include "game/needs.h"
#include "game/room_stock.h"
#include "game/rumour.h"
#include "game/speech.h"
#include "game/samosbor.h"
#include "game/economy.h"
#include "game/contract.h"
#include "game/vendor.h"
#include "game/craft.h"
#include "game/quest.h"
#include "game/container.h"
#include "game/door.h"
#include "game/combat.h"
#include "game/status.h"
#include "game/rpg.h"
#include "game/extraction.h"
#include "game/save.h"
#include "game/faction_relations.h"
#include "game/loot.h"
#include "game/weapon_table.h"
#include "game/event_bus.h"
#include "game/floors/padic/padic.h"
#include "game/prop_system.h"
#include "game/investigate.h"
#include "sim/fluid.h"
#include "sim/diffusion.h"
#include "game/noise.h"
#include "game/wander.h"
#include "game/npc_pool.h"
#include "game/macro_sim.h"
#include "input/input.h"
#include "render/body_pass.h"
#include "render/cube_pass.h"
#include "render/material_table.h" // kMaterial — generated albedo table
#include "render/cloth_pass.h"
#include "render/particle_pass.h"
#include "render/wire_pass.h"
#include "render/prop_pass.h"

#include "render/gpu_timer.h"
#include "render/gpu_light_grid.h"
#include "render/gpu_gas_pass.h"

#include "render/gpu_cull_pass.h"
#include "render/imgui_layer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "render/vk_swapchain.h"
#include "render/voxel_mirror.h"
#include "render/raymarch_pass.h"
#include "render/screenshot.h"
#include "sim/camera.h"
#include "sim/controller.h"
#include "sim/fluid.h"
#include "sim/physics.h"
#include "world/destruct.h"
#include "world/stain.h"
#include "world/level_stack.h"
#include "world/nav.h"
#include "world/nav_async.h"

using namespace giga;

namespace {

// Which binary is this? NDEBUG is the one thing every optimized CMake
// configuration defines and Debug does not, so it needs no CMake cooperation.
#ifdef NDEBUG
constexpr const char* kBuildKind = "optimized";
#else
constexpr const char* kBuildKind = "DEBUG — NO OPTIMIZATION, ~10x slower sim";
#endif

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
constexpr float kFillStrength = 0.02f;  // sunDir.w, dark subterranean backstop
constexpr float kAmbient = 0.06f;       // fog.w, scales the atmospheric hemispheric term
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
                                 const Registry& reg, LayerId activeLayer,
                                 const game::NoiseField* noiseField = nullptr,
                                 const game::PowerGridState* powerGrid = nullptr) {
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
        grid.add_light(camPos + vec3{0.0f, 0.0f, 3.0f}, 48.0f, alarmColor, alarmPulse * 3.5f);
    }

    // 3. Mob Emitters (Lampovy & Lampoglaz)
    for (auto e : reg.view<const game::MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::MobRef& m = reg.get<const game::MobRef>(e);
        const auto kind = static_cast<game::MobKind>(m.kind);

        float dx = wrap_delta_f(camPos.x, tr.pos.x, kWorldExtent);
        float dy = wrap_delta_f(camPos.y, tr.pos.y, kWorldExtent);
        float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz > 48.0f * 48.0f) continue;

        if (kind == game::MobKind::Lampovy) {
            grid.add_light(tr.pos + vec3{0.0f, 0.0f, 1.2f}, 12.0f, vec3{1.0f, 0.88f, 0.65f}, 2.0f);
        } else if (kind == game::MobKind::Lampoglaz) {
            grid.add_light(tr.pos + vec3{0.0f, 0.0f, 1.5f}, 16.0f, vec3{0.70f, 0.95f, 1.0f}, 2.8f);
        }
    }

    // 4. Emissive Loot Containers & Supply Crates
    for (auto e : reg.view<const game::Container, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::Container& cnt = reg.get<const game::Container>(e);
        if (!cnt.opened) {
            float dx = wrap_delta_f(camPos.x, tr.pos.x, kWorldExtent);
            float dy = wrap_delta_f(camPos.y, tr.pos.y, kWorldExtent);
            float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz < 32.0f * 32.0f) {
                grid.add_light(tr.pos + vec3{0.0f, 0.0f, 0.5f}, 6.0f, vec3{0.30f, 0.90f, 0.50f}, 1.2f);
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
        float dy = wrap_delta_f(camPos.y, tr.pos.y, kWorldExtent);
        float dz = wrap_delta_f(camPos.z, tr.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz < 48.0f * 48.0f) {
            // One colour for every shot in the air. It used to be two, keyed on
            // `Projectile::team` — but a bullet no longer knows whose it is, and a
            // HUD that claimed otherwise would be teaching the player a rule the
            // simulation stopped having.
            vec3 pcol = vec3{1.0f, 0.85f, 0.40f};
            grid.add_light(tr.pos, 10.0f, pcol, 2.5f);
        }
    }

    // 6. Loud Game Noise Events (game::loudest_heard) -> Point Light Modulation in GpuLightGrid
    if (noiseField && !noiseField->quiet()) {
        float noiseDist = 0.0f;
        const game::Noise* loud = game::loudest_heard(*noiseField, activeLayer, camPos, 1.0f, 1, 0, &noiseDist);
        if (loud && loud->severity >= 1) {
            vec3 npos{loud->x, loud->y, loud->z};
            float lifeFrac = (loud->lifeMs > 0) ? (static_cast<float>(loud->ttlMs) / static_cast<float>(loud->lifeMs)) : 1.0f;
            float pulse = std::sin(timeSec * 30.0f + static_cast<float>(loud->id)) * 0.35f + 0.65f;
            float intensity = (static_cast<float>(loud->severity) * 2.0f) * lifeFrac * pulse;
            grid.add_light(npos + vec3{0.0f, 0.0f, 0.8f}, loud->radius * 0.8f, vec3{1.0f, 0.70f, 0.30f}, intensity);
            float acousticFlicker = 1.0f + 0.50f * (static_cast<float>(loud->severity) / 5.0f) * std::sin(timeSec * 40.0f);
            grid.add_light(camPos + vec3{0.0f, 0.0f, 1.0f}, 14.0f, vec3{0.90f, 0.80f, 0.50f}, 1.5f * acousticFlicker);
        }
    }

    // 7. Ceiling Light Bulbs (ECS LightBulb Interactables — never propPass).
    // Seeded by seed_ceiling_lights to match PropPlacer BareBulb/FloodLamp cells.
    // Suppressed when local ElectricalShield power is cut. [jirnyak.md] §18.
    {
        auto lampView = reg.view<const Transform, const game::Interactable>();
        for (auto e : lampView) {
            const Transform& tr = lampView.get<const Transform>(e);
            if (tr.layer != activeLayer) continue;
            const game::Interactable& ia = lampView.get<const game::Interactable>(e);
            if (!ia.active || ia.kind != game::Interactable::Kind::LightBulb) continue;

            const vec3& pos = tr.pos;
            if (powerGrid && powerGrid->is_power_cut(pos)) continue; // Local power cut!

            float dx = wrap_delta_f(camPos.x, pos.x, kWorldExtent);
            float dy = wrap_delta_f(camPos.y, pos.y, kWorldExtent);
            float dz = wrap_delta_f(camPos.z, pos.z, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz > 36.0f * 36.0f) continue;

            // Khrushchevka unstable power grid flickering (pure deterministic DOD math)
            float flick = std::sin(timeSec * 12.0f + pos.x * 1.7f + pos.z * 2.3f) * 0.18f;
            float microFlick = (std::fmod(timeSec * 47.0f + pos.x * 3.1f + pos.z * 5.7f, 1.0f) < 0.07f) ? -0.50f : 0.0f;
            float intensity = std::max(0.2f, 1.8f + flick + microFlick);

            grid.add_light(pos + vec3{0.0f, 0.0f, -0.2f}, 12.0f, vec3{1.00f, 0.88f, 0.65f}, intensity);
        }
    }
}

static bool contains_icase(const char* haystack, const char* needle) {
    if (!haystack || !needle || !*needle) return true;
    for (; *haystack; ++haystack) {
        const char* h = haystack;
        const char* n = needle;
        while (*h && *n && (std::tolower(static_cast<unsigned char>(*h)) == std::tolower(static_cast<unsigned char>(*n)))) {
            ++h; ++n;
        }
        if (!*n) return true;
    }
    return false;
}

static void DrawCraftingWindowUI(bool* p_open, game::CraftingState& crafting, 
                          game::Inventory& inv, game::CraftStation currentStation, 
                          std::uint64_t simTick, Registry& reg, Entity player,
                          game::NpcPool& pool, std::uint32_t& outCrafted, 
                          std::uint32_t& outScrapped, std::uint32_t& outLearned) 
{
    if (!p_open || !*p_open) return;

    ImGui::SetNextWindowSize(ImVec2(820, 560), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Workbench & Crafting Studio", p_open)) {
        ImGui::End();
        return;
    }

    static int selectedRecipeId = 1;
    static int craftQty = 1;
    static char recipeFilter[64] = "";
    static bool showOnlyKnown = false;

    const char* stationNames[] = { "Bare Hands (Any)", "Workbench", "Lathe", "Lab", "Net Terminal" };
    const char* matNames[] = { "Mech", "Elec", "Cons", "Bio", "Chem", "Metal", "Psi", "Meta" };

    ImGui::TextColored(ImVec4(0.35f, 0.85f, 1.0f, 1.0f), "Station: %s | Cert Tier: T%u",
                       stationNames[static_cast<std::size_t>(currentStation)], crafting.tier);
    ImGui::Separator();

    ImGui::Text("Material Bank:");
    ImGui::SameLine();
    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
        ImGui::Text("%s: %u", matNames[i], crafting.mat[i]);
        if (i < game::kCraftMaterials - 1) ImGui::SameLine();
    }
    ImGui::Separator();

    if (ImGui::BeginTabBar("CraftingTabs")) {
        if (ImGui::BeginTabItem("Craft Items")) {
            ImGui::BeginChild("RecipeListPane", ImVec2(340, 320), true);
            ImGui::InputText("Filter", recipeFilter, sizeof(recipeFilter));
            ImGui::Checkbox("Known Only", &showOnlyKnown);

            ImGui::Separator();
            if (ImGui::BeginListBox("##Recipes", ImVec2(-FLT_MIN, -FLT_MIN))) {
                for (game::ItemId id = 1; id <= game::kCraftRecipeCount; ++id) {
                    const bool isKnown = game::craft_known(crafting, id);
                    if (showOnlyKnown && !isKnown) continue;

                    const char* name = game::item_name(id);
                    if (recipeFilter[0] != '\0' && !contains_icase(name, recipeFilter)) continue;

                    const game::CraftFail fail = game::craft_check(crafting, inv, id, currentStation);

                    char label[128];
                    snprintf(label, sizeof(label), "%s [%s]%s", 
                             name, isKnown ? "Learned" : "Locked", 
                             fail == game::CraftFail::None ? " *" : "");

                    bool isSelected = (selectedRecipeId == static_cast<int>(id));
                    if (ImGui::Selectable(label, isSelected)) {
                        selectedRecipeId = static_cast<int>(id);
                    }
                    if (isSelected) ImGui::SetItemDefaultFocus();
                }
                ImGui::EndListBox();
            }
            ImGui::EndChild();

            ImGui::SameLine();

            ImGui::BeginChild("RecipeDetailPane", ImVec2(0, 320), true);
            if (selectedRecipeId >= 1 && selectedRecipeId <= static_cast<int>(game::kCraftRecipeCount)) {
                const auto id = static_cast<game::ItemId>(selectedRecipeId);
                const game::CraftRecipe& rec = game::craft_recipe(id);
                const char* itemName = game::item_name(id);
                const bool known = game::craft_known(crafting, id);
                const game::CraftFail checkResult = game::craft_check(crafting, inv, id, currentStation);

                ImGui::TextColored(ImVec4(1.0f, 0.9f, 0.4f, 1.0f), "%s", itemName);
                ImGui::Text("Required Tier: T%u | Required Bench: %s", rec.tier, stationNames[rec.station]);
                ImGui::Text("Knowledge Status: %s", known ? "Learned" : "Not Learned");
                ImGui::Separator();

                std::uint32_t missing[game::kCraftMaterials] = {};
                game::craft_missing(crafting, id, missing);

                ImGui::Text("Required Components:");
                if (ImGui::BeginTable("CompTable", 4, ImGuiTableFlags_BordersInnerH | ImGuiTableFlags_RowBg)) {
                    ImGui::TableSetupColumn("Material");
                    ImGui::TableSetupColumn("Required");
                    ImGui::TableSetupColumn("In Bank");
                    ImGui::TableSetupColumn("Shortfall");
                    ImGui::TableHeadersRow();

                    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
                        if (rec.comp[i] == 0) continue;
                        ImGui::TableNextRow();
                        ImGui::TableSetColumnIndex(0); ImGui::Text("%s", matNames[i]);
                        ImGui::TableSetColumnIndex(1); ImGui::Text("%u", rec.comp[i]);
                        ImGui::TableSetColumnIndex(2); ImGui::Text("%u", crafting.mat[i]);
                        ImGui::TableSetColumnIndex(3);
                        if (missing[i] > 0) {
                            ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "-%u", missing[i]);
                        } else {
                            ImGui::TextColored(ImVec4(0.3f, 1.0f, 0.3f, 1.0f), "OK");
                        }
                    }
                    ImGui::EndTable();
                }

                ImGui::Separator();
                ImGui::SliderInt("Quantity", &craftQty, 1, 10);

                const bool canCraft = (checkResult == game::CraftFail::None);
                if (!canCraft) ImGui::BeginDisabled();

                if (ImGui::Button("Craft Item(s)", ImVec2(160, 32))) {
                    for (int q = 0; q < craftQty; ++q) {
                        game::CraftResult res = game::craft_item(crafting, inv, id, currentStation);
                        if (res.fail == game::CraftFail::None) {
                            outCrafted++;
                            game::sync_armour(reg, pool, player);
                        } else {
                            break;
                        }
                    }
                }

                if (!canCraft) {
                    ImGui::EndDisabled();
                    ImGui::SameLine();
                    ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "[%s]", game::craft_fail_text(checkResult));
                }
            }
            ImGui::EndChild();

            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Disassemble Inventory")) {
            ImGui::Text("Disassemble items into base materials (Requires Workbench).");
            if (currentStation != game::CraftStation::Workbench) {
                ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "WARNING: Requires a Workbench!");
            }
            ImGui::Separator();

            if (ImGui::BeginTable("DisassemblyTable", 5, ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg, ImVec2(0, 350))) {
                ImGui::TableSetupColumn("Slot", ImGuiTableColumnFlags_WidthFixed, 40.0f);
                ImGui::TableSetupColumn("Item Name");
                ImGui::TableSetupColumn("Count", ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableSetupColumn("Est. Value");
                ImGui::TableSetupColumn("Action", ImGuiTableColumnFlags_WidthFixed, 120.0f);
                ImGui::TableHeadersRow();

                for (int slot = 0; slot < game::kInvSlots; ++slot) {
                    const game::ItemSlot& s = inv.slots[slot];
                    if (!game::item_valid(s.item) || s.count == 0) continue;

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("#%d", slot);
                    ImGui::TableSetColumnIndex(1); ImGui::Text("%s", game::item_name(s.item));
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%u", s.count);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%d rub", game::item_def(s.item).value);
                    ImGui::TableSetColumnIndex(4);

                    char btnId[32];
                    snprintf(btnId, sizeof(btnId), "Scrap##%d", slot);

                    const bool canDis = (currentStation == game::CraftStation::Workbench);
                    if (!canDis) ImGui::BeginDisabled();

                    if (ImGui::Button(btnId)) {
                        game::DisassembleResult dres = game::craft_disassemble(
                            crafting, inv, slot, currentStation, static_cast<std::uint32_t>(simTick));
                        if (dres.fail == game::CraftFail::None) {
                            outScrapped++;
                            if (dres.learned) outLearned++;
                            game::sync_armour(reg, pool, player);
                        }
                    }

                    if (!canDis) ImGui::EndDisabled();
                }
                ImGui::EndTable();
            }

            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }

    ImGui::End();
}

static void DrawVendorWindowUI(bool* p_open, game::Inventory& inv, game::RunLedger& ledger, 
                        game::VendorKind vendorKind, bool isOnPad, std::int32_t& outSold, std::int32_t& outSpent,
                        const game::RpgStats* rpg = nullptr, std::int8_t playerRelation = 0) 
{
    if (!p_open || !*p_open) return;

    ImGui::SetNextWindowSize(ImVec2(800, 560), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Trader Supply & Exchange", p_open)) {
        ImGui::End();
        return;
    }

    const char* vendorNames[] = { "Civil Citizen Trader (Buy 1.15x / Sell 0.85x)",
                                 "Scientist Outpost (Buy 1.15x / Sell 0.92x)",
                                 "Wild Zone Scavenger (Buy 1.15x / Sell 0.72x)" };

    ImGui::TextColored(ImVec4(0.4f, 0.9f, 0.4f, 1.0f), "Vendor: %s", vendorNames[static_cast<std::size_t>(vendorKind)]);
    ImGui::Text("Account Balance: %lld roubles | Standing: %d", static_cast<long long>(ledger.banked), static_cast<int>(playerRelation));
    
    if (!isOnPad) {
        ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "[OFF EXTRACTION PAD] Walk to the Extraction Pad to trade.");
        ImGui::End();
        return;
    }
    ImGui::Separator();

    if (ImGui::BeginTabBar("VendorTabs")) {
        if (ImGui::BeginTabItem("Buy Supplies")) {
            static char buyFilter[64] = "";
            static int buyQty = 1;
            ImGui::InputText("Search Stock", buyFilter, sizeof(buyFilter));
            ImGui::SliderInt("Quantity to Buy", &buyQty, 1, 50);

            if (ImGui::Button("Quick Resupply Package (600 rub)", ImVec2(240, 28))) {
                outSpent += game::vendor_resupply(inv, ledger, 600);
            }
            ImGui::SameLine();

            const game::ItemId ammoForGun = game::vendor_ammo_for(inv);
            if (ammoForGun != game::kInvalidItem) {
                char ammoBtnText[128];
                snprintf(ammoBtnText, sizeof(ammoBtnText), "Buy Ammo for Gun (%s)", game::item_name(ammoForGun));
                if (ImGui::Button(ammoBtnText, ImVec2(240, 28))) {
                    outSpent += (game::vendor_buy(inv, ledger, ammoForGun, buyQty, playerRelation) * game::vendor_buy_price(ammoForGun, playerRelation));
                }
            }

            ImGui::Separator();

            if (ImGui::BeginTable("ShopCatalogTable", 5, ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg, ImVec2(0, 340))) {
                ImGui::TableSetupColumn("Item Name");
                ImGui::TableSetupColumn("Category", ImGuiTableColumnFlags_WidthFixed, 100.0f);
                ImGui::TableSetupColumn("Stack Max", ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Unit Price", ImGuiTableColumnFlags_WidthFixed, 90.0f);
                ImGui::TableSetupColumn("Action", ImGuiTableColumnFlags_WidthFixed, 100.0f);
                ImGui::TableHeadersRow();

                for (game::ItemId id = 1; id <= game::kItemCount; ++id) {
                    if (!game::vendor_stocks_item(id)) continue;

                    const char* itemName = game::item_name(id);
                    if (buyFilter[0] != '\0' && !contains_icase(itemName, buyFilter)) continue;

                    const std::int32_t price = game::vendor_buy_price(id, playerRelation);
                    const std::int32_t totalPrice = price * buyQty;
                    const bool canAfford = (ledger.banked >= totalPrice);

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("%s", itemName);
                    ImGui::TableSetColumnIndex(1); ImGui::Text("Cat #%d", game::item_def(id).category);
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%u", game::item_def(id).stackMax);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%d rub", price);
                    ImGui::TableSetColumnIndex(4);

                    char buyBtnLabel[32];
                    snprintf(buyBtnLabel, sizeof(buyBtnLabel), "Buy##%d", id);

                    if (!canAfford) ImGui::BeginDisabled();
                    if (ImGui::Button(buyBtnLabel)) {
                        std::uint32_t bought = game::vendor_buy(inv, ledger, id, static_cast<std::uint32_t>(buyQty), playerRelation);
                        outSpent += (bought * price);
                    }
                    if (!canAfford) ImGui::EndDisabled();
                }
                ImGui::EndTable();
            }

            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Sell Inventory")) {
            if (ImGui::Button("Sell All Haul / Trash (Auto Cap)", ImVec2(240, 28))) {
                outSold += game::vendor_sell_all(inv, ledger, vendorKind, rpg, playerRelation);
            }
            ImGui::Separator();

            if (ImGui::BeginTable("SellInventoryTable", 6, ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg, ImVec2(0, 360))) {
                ImGui::TableSetupColumn("Slot", ImGuiTableColumnFlags_WidthFixed, 40.0f);
                ImGui::TableSetupColumn("Item Name");
                ImGui::TableSetupColumn("Count", ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableSetupColumn("Unit Value", ImGuiTableColumnFlags_WidthFixed, 90.0f);
                ImGui::TableSetupColumn("Total Value", ImGuiTableColumnFlags_WidthFixed, 90.0f);
                ImGui::TableSetupColumn("Action", ImGuiTableColumnFlags_WidthFixed, 140.0f);
                ImGui::TableHeadersRow();

                for (int slot = 0; slot < game::kInvSlots; ++slot) {
                    game::ItemSlot& s = inv.slots[slot];
                    if (!game::item_valid(s.item) || s.count == 0) continue;

                    const std::int32_t unitSell = game::vendor_sell_price(s.item, vendorKind, rpg, playerRelation);
                    const std::int32_t totalSell = unitSell * s.count;

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("#%d", slot);
                    ImGui::TableSetColumnIndex(1); ImGui::Text("%s", game::item_name(s.item));
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%u", s.count);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%d rub", unitSell);
                    ImGui::TableSetColumnIndex(4); ImGui::Text("%d rub", totalSell);
                    ImGui::TableSetColumnIndex(5);

                    char sellOneLabel[32], sellAllLabel[32];
                    snprintf(sellOneLabel, sizeof(sellOneLabel), "Sell 1##%d", slot);
                    snprintf(sellAllLabel, sizeof(sellAllLabel), "Sell Stack##%d", slot);

                    const bool canSell = (unitSell > 0);
                    if (!canSell) ImGui::BeginDisabled();

                    if (ImGui::Button(sellOneLabel)) {
                        ledger.banked += unitSell;
                        outSold += unitSell;
                        s.count--;
                        if (s.count == 0) s.item = game::kInvalidItem;
                    }
                    ImGui::SameLine();
                    if (ImGui::Button(sellAllLabel)) {
                        ledger.banked += totalSell;
                        outSold += totalSell;
                        s.count = 0;
                        s.item = game::kInvalidItem;
                    }

                    if (!canSell) ImGui::EndDisabled();
                }
                ImGui::EndTable();
            }

            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }

    ImGui::End();
}

// ── Debug console overlay (~) ──────────────────────────────────────────────
// Thin ImGui shell over game::Console ([console.h]): parsing, the command
// table, and contextual completion are HEADLESS game code (tested in
// game_test); this only draws a log, one input line, Tab completion and
// Up/Down history. The '`'/'~' chars are filtered so the toggle key never
// types into its own console.
struct ConsoleUiRefs {
    game::Console* con;
    const game::ConsoleContext* ctx;
    std::vector<std::string>* log;
    std::vector<std::string>* history;
    int* histPos;
};

static int ConsoleInputCallback(ImGuiInputTextCallbackData* data) {
    ConsoleUiRefs& ui = *static_cast<ConsoleUiRefs*>(data->UserData);
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCharFilter)
        return (data->EventChar == '`' || data->EventChar == '~') ? 1 : 0;
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCompletion) {
        const char* cands[16];
        const std::uint32_t n = ui.con->complete(*ui.ctx, data->Buf, cands, 16);
        if (n == 0) return 0;
        // The word under completion starts after the last space — the same
        // split rule Console::complete used to produce the candidates.
        int ws = data->BufTextLen;
        while (ws > 0 && data->Buf[ws - 1] != ' ' && data->Buf[ws - 1] != '\t')
            --ws;
        // Longest common prefix of the candidates; with one candidate that is
        // the whole token and a trailing space arms the next argument.
        char lcp[128];
        std::snprintf(lcp, sizeof lcp, "%s", cands[0]);
        for (std::uint32_t i = 1; i < n; ++i) {
            std::size_t j = 0;
            while (lcp[j] && cands[i][j] == lcp[j]) ++j;
            lcp[j] = '\0';
        }
        data->DeleteChars(ws, data->BufTextLen - ws);
        data->InsertChars(ws, lcp);
        if (n == 1) data->InsertChars(data->CursorPos, " ");
        if (n > 1) { // ambiguous: show the choices like a shell would
            std::string listed;
            for (std::uint32_t i = 0; i < n; ++i) {
                listed += cands[i];
                listed += ' ';
            }
            ui.log->push_back(listed);
        }
        return 0;
    }
    if (data->EventFlag == ImGuiInputTextFlags_CallbackHistory) {
        if (ui.history->empty()) return 0;
        int& pos = *ui.histPos;
        if (data->EventKey == ImGuiKey_UpArrow) {
            if (pos < 0) pos = static_cast<int>(ui.history->size()) - 1;
            else if (pos > 0) --pos;
        } else if (data->EventKey == ImGuiKey_DownArrow) {
            if (pos >= 0 && pos < static_cast<int>(ui.history->size()) - 1) ++pos;
            else pos = -1;
        }
        data->DeleteChars(0, data->BufTextLen);
        if (pos >= 0) data->InsertChars(0, (*ui.history)[pos].c_str());
        return 0;
    }
    return 0;
}

static void DrawConsoleUI(bool* p_open, bool* p_focus, char* inputBuf,
                          std::size_t inputCap, game::Console& con,
                          game::ConsoleContext& ctx,
                          std::vector<std::string>& log,
                          std::vector<std::string>& history, int& histPos) {
    if (!*p_open) return;
    const ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x, io.DisplaySize.y * 0.45f));
    if (!ImGui::Begin("Console", p_open,
                      ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize |
                          ImGuiWindowFlags_NoCollapse)) {
        ImGui::End();
        return;
    }
    const float footer =
        ImGui::GetStyle().ItemSpacing.y + ImGui::GetFrameHeightWithSpacing();
    ImGui::BeginChild("##console_log", ImVec2(0, -footer), true,
                      ImGuiWindowFlags_HorizontalScrollbar);
    for (const std::string& s : log) ImGui::TextUnformatted(s.c_str());
    if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 1.0f)
        ImGui::SetScrollHereY(1.0f);
    ImGui::EndChild();

    ConsoleUiRefs ui{&con, &ctx, &log, &history, &histPos};
    ImGui::SetNextItemWidth(-FLT_MIN);
    const ImGuiInputTextFlags flags =
        ImGuiInputTextFlags_EnterReturnsTrue |
        ImGuiInputTextFlags_CallbackCompletion |
        ImGuiInputTextFlags_CallbackHistory |
        ImGuiInputTextFlags_CallbackCharFilter;
    if (*p_focus) {
        ImGui::SetKeyboardFocusHere();
        *p_focus = false;
    }
    if (ImGui::InputText("##console_in", inputBuf, inputCap, flags,
                         ConsoleInputCallback, &ui)) {
        if (inputBuf[0]) {
            log.push_back(std::string("> ") + inputBuf);
            char outMsg[256];
            con.exec(ctx, inputBuf, outMsg, sizeof outMsg);
            if (outMsg[0]) log.push_back(outMsg);
            // `help` lists the registry itself, so a new command's usage/help
            // shows up here with no console edit — the table IS the docs.
            if (std::strcmp(inputBuf, "help") == 0) {
                for (std::size_t i = 0; i < con.count(); ++i) {
                    const game::ConsoleCommand& c = con.at(i);
                    log.push_back(std::string("  ") + c.usage + " — " + c.help);
                }
            }
            history.push_back(inputBuf);
            histPos = -1;
            inputBuf[0] = '\0';
        }
        *p_focus = true; // stay in the input line for the next command
    }
    ImGui::End();
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

// The floor catalog — the data-driven "ANY number -> a floor" index
// ([floor_catalog.h]). The pattern rows (the modulo V-shape defaults) and every
// module folder's explicit claim (the padic module claims 4) come from
// build_default_floor_catalog; the demo rows above are layered on as this app's
// own claims. Built once. A refused claim — two floors on one number — logs
// loudly here and is RED in tests/suite_floorcatalog.inl, so a duplicate can
// never silently shadow a module.
const game::FloorCatalog& floor_catalog() {
    static game::FloorCatalog cat;
    static const bool ok = [] {
        bool good = game::build_default_floor_catalog(cat);
        for (const DemoFloor& f : kDemoFloors)
            good &= cat.claim(f.number, {"demo", f.kind});
        if (!good)
            std::fprintf(stderr,
                         "[floors] catalog claim REFUSED: %d conflicts, first at "
                         "floor %d — two modules on one number\n",
                         cat.conflicts(), cat.first_conflict());
        return good;
    }();
    (void)ok;
    return cat;
}

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
// (the `fly` bind toggles) so the view is free to explore.
void aim_player(Registry& reg, Entity player) {
    auto& cam = reg.get<CameraTag>(player);
    cam.yaw = 0.8f;
    cam.pitch = -0.5f;
    reg.get<Controller>(player).fly = true;
}

// Kind / rule-set for ANY floor number, resolved through the catalog: an
// explicit claim when one exists, else the pattern defaults. TOTAL — pick any
// number and there is a floor there ([floor_catalog.h]), which is what lets
// teleport and streaming stop caring whether a number was hand-listed.
game::FloorKind kind_for_floor(int number) {
    return floor_catalog().resolve(number).kind;
}
const game::FloorSpec* spec_for_floor(int number) {
    return &game::floor_spec(kind_for_floor(number));
}

// Ceiling on how many monsters one floor may add. The V-shape budget saturates
// at 4096 on the deepest floors, which shares a pool with the embodied crowd and
// would be a large one-frame allocation; the demo floors (|number| <= 4) are far
// below this anyway, so it is a guard rail rather than a live limit.
constexpr std::uint32_t kMobSpawnCap = 600;

// Where a run lives on disk: a DIRECTORY PER SLOT, because the save is modular
// like the game is ([game/save.h]) and the main menu picks SLOTS, not files.
// `gigahrush2_save/slot<N>/run.sav` carries the run; each visited floor is its
// own `floor_<F>.sav` beside it, written when the player leaves that floor and
// read back whenever the floor is built again. `giga_game` does no file I/O by
// design — it links giga_core and nothing platform-shaped ([AGENTS.md]) — so
// every fopen is HERE and the formats are over there.
constexpr int kMaxSaveSlots = 8;
int g_saveSlot = 1;

void slot_dir_path(char* out, std::size_t cap, int slot) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d", slot);
}
void run_save_path(char* out, std::size_t cap) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d/run.sav", g_saveSlot);
}
void floor_save_path(int floor, char* out, std::size_t cap) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d/floor_%d.sav", g_saveSlot,
                  floor);
}
bool slot_occupied(int slot) {
    char p[128];
    std::snprintf(p, sizeof p, "gigahrush2_save/slot%d/run.sav", slot);
    if (std::FILE* f = std::fopen(p, "rb")) {
        std::fclose(f);
        return true;
    }
    return false;
}

// WRITE BESIDE, THEN RENAME OVER. Never `fopen(path, "wb")` on the real save.
//
// "wb" truncates to zero length BEFORE the first byte is written, so the window
// between the truncation and the last fwrite is a window in which the player's
// previous save no longer exists and the new one does not exist yet. Anything that
// ends the process in that window — a disk that fills, a kill, a crash in the very
// code that is serializing — leaves a zero- or half-length file where a finished run
// used to be. That is not a corrupted save the player can be warned about; it is
// their progress, gone, and produced by the button whose entire purpose is to keep it.
// This was the only defect in the 2026-08-09 audit sweep that DESTROYS work rather
// than distorting behaviour (Docs/MASTER_ROADMAP.md 0.1а), which is why it goes first.
//
// The temp file absorbs the whole window. Until the rename, the old save is the only
// thing under `path` and it is untouched; after the rename it is replaced in one
// step. rename(2) over an existing file is atomic within a filesystem, and the temp
// is deliberately created in the SAME directory so the two are never on different
// volumes — that is the one thing that would silently turn the rename into a
// copy-then-delete and hand the window back.
//
// Every save in the game goes through here — run.sav via write_run, each floor_N.sav
// via write_floor_file — so the guarantee is not per-call-site discipline.
//
// HONEST LIMIT, stated because the next reader will otherwise assume more: this
// makes the replacement atomic, not DURABLE. There is no fsync, so a power cut can
// still lose bytes the OS had only in its page cache. Closing that needs
// fsync()/_commit() behind a platform ifdef plus a directory fsync on POSIX, and it
// buys protection against a strictly rarer event than the one above. Deliberately not
// done here; when it is, it belongs in this function and nowhere else.
bool write_bytes_file(const std::vector<std::uint8_t>& bytes, const char* path) {
    std::error_code ec; // error_code overloads: the app builds -fno-exceptions
    const std::filesystem::path finalPath(path);
    std::filesystem::create_directories(finalPath.parent_path(), ec);

    std::filesystem::path tmpPath(finalPath);
    tmpPath += ".tmp";
    const std::string tmpStr = tmpPath.string();

    std::FILE* f = std::fopen(tmpStr.c_str(), "wb");
    if (!f) return false;
    const std::size_t n = std::fwrite(bytes.data(), 1, bytes.size(), f);
    // fclose can fail where fwrite succeeded: buffered bytes only reach the OS here,
    // so a full disk usually surfaces at this call and nowhere earlier. Treating a
    // failed close as success is how a truncated file gets renamed over a good one.
    const bool wrote = (n == bytes.size()) && (std::fclose(f) == 0);
    if (!wrote) {
        std::filesystem::remove(tmpPath, ec); // leave no debris; old save stands
        return false;
    }

    std::filesystem::rename(tmpPath, finalPath, ec);
    if (ec) {
        std::filesystem::remove(tmpPath, ec);
        return false;
    }
    return true;
}

bool read_bytes_file(std::vector<std::uint8_t>& bytes, const char* path) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    bytes.clear();
    std::uint8_t chunk[4096];
    for (;;) {
        const std::size_t got = std::fread(chunk, 1, sizeof(chunk), f);
        if (got == 0) break;
        bytes.insert(bytes.end(), chunk, chunk + got);
    }
    std::fclose(f);
    return true;
}

bool write_run(const game::SaveState& st, const char* path) {
    std::vector<std::uint8_t> bytes;
    game::save_write(st, bytes);
    return write_bytes_file(bytes, path);
}

// Persist one floor's exact grid to its own file. A floor transition is a load
// screen, so this is sanctioned I/O ([jirnyak.md] §6).
bool write_floor_file(const World& w, int floor) {
    std::vector<std::uint8_t> bytes;
    game::floor_file_write(w, floor, bytes);
    char path[128];
    floor_save_path(floor, path, sizeof path);
    return write_bytes_file(bytes, path);
}

// Stamp a floor's saved state over its freshly generated geometry, if a file
// exists. Absent file = pristine floor; a REFUSED file is said out loud.
bool apply_floor_file(World& w, int floor) {
    char path[128];
    floor_save_path(floor, path, sizeof path);
    std::vector<std::uint8_t> bytes;
    if (!read_bytes_file(bytes, path)) return false;
    game::SaveError err = game::SaveError::None;
    if (!game::floor_file_read(bytes.data(), bytes.size(), w, nullptr, &err)) {
        std::fprintf(stderr, "[save] %s refused: %s (floor regenerates pristine)\n",
                     path, game::save_error_text(err));
        return false;
    }
    return true;
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

    return game::spawn_floor_containers(
        reg, world, floorNumber, kind_for_floor(floorNumber), layer,
        /*seed=*/0xC0FFEEu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        /*cap=*/64);
}

std::uint32_t refresh_floor_mobs(Registry& reg, const World& world, int floorNumber,
                                 LayerId layer) {
    game::despawn_layer_mobs(reg, layer);
    const game::FloorKind kind = kind_for_floor(floorNumber);
    const game::FloorSpec& spec = game::floor_spec(kind);
    // `kind` twice, deliberately: the theme drives the head-count multiplier and
    // the kind drives the ROOM PITCH that packs are placed by. theme_for_kind is not
    // invertible, so the spawner cannot recover the second from the first.
    std::uint32_t count = game::spawn_floor_mobs(
        reg, world, floorNumber, game::danger_for_hostility(spec.hostility),
        game::theme_for_kind(kind), layer,
        /*seed=*/0xB0B5EEDu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        kMobSpawnCap, kind);

    // Sync Armour components for all spawned mobs according to monster_traits
    for (auto e : reg.view<const game::MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer == layer) {
            const game::MobRef& m = reg.get<const game::MobRef>(e);
            game::sync_monster_armour(reg, e, m.kind);
        }
    }
    return count;
}

// Floor interactive props: clear the recycled LayerId slot, seed Terminal +
// ElectricalShield + LightBulb Interactables (with PropMesh for PropPass skin),
// then padic-only corridor bulbs. [jirnyak.md] §18 — sim queries Registry;
// PropPass is filled via merge_ecs_prop_meshes.
std::uint32_t refresh_floor_props(Registry& reg, const World& world,
                                  int floorNumber, LayerId layer,
                                  unsigned padicSeed, game::EventBus& bus) {
    game::clear_layer_props(reg, layer);
    const std::uint32_t wallSeed =
        1337u ^ (static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u);
    std::uint32_t count = game::seed_wall_interactables(reg, world, layer, wallSeed);
    std::fprintf(stderr, "[props] wall devices seeded: %u\n", count);
    if (std::getenv("GIGA_ANTOURAGE_DEBUG") != nullptr) {
        int shown = 0;
        for (auto e : reg.view<const game::Interactable, const Transform>()) {
            if (reg.get<const game::Interactable>(e).kind !=
                game::InteractKind::ElectricalShield)
                continue;
            const vec3& p = reg.get<const Transform>(e).pos;
            std::fprintf(stderr, "[props] shield at (%.1f %.1f %.1f)\n", p.x,
                         p.y, p.z);
            if (++shown == 4) break;
        }
    }

    // Ceiling BareBulb/FloodLamp cosmetics are still PropPlacer-driven, but
    // LightBulb Interactables live in ECS so lighting/HUD never read propPass
    // ([jirnyak.md] §18 — last get_prop_positions sim path).
    count += game::seed_ceiling_lights(reg, world, layer, wallSeed);
    if (kind_for_floor(floorNumber) == game::FloorKind::Padic)
        count += game::seed_padic_props(reg, world, layer, floorNumber, padicSeed, bus);
    // FURNISH THE ROOMS ([room_zone.h] kRoomFurniture). Not decoration and not a
    // debug overlay: until this landed a "kitchen" was a hash of the room's
    // coordinates and NOTHING in the world said so, which meant the crowd's whole
    // errand behaviour ([problems.md] §27) could only be checked by reading stderr.
    // A stove you can see is what makes "he went to the kitchen" an observation
    // instead of a claim — and the AI seats bodies AT these same pieces, off the
    // same table, so the two cannot drift apart.
    //
    // Keyed on (kind, number) like every other room-taxonomy consumer, so it needs
    // no seed of its own and agrees with the container and mob spawners by
    // construction ([floor_gen.h]).
    {
        const std::uint32_t furniture = game::seed_room_furniture(
            reg, world, layer, kind_for_floor(floorNumber), floorNumber);
        count += furniture;
        std::fprintf(stderr, "[rooms] floor %d: %u pieces of furniture placed\n",
                     floorNumber, furniture);
    }
    return count;
}



// Upload StaticPropTag + PropMesh entities into PropPass after PropPlacer fills
// non-interactable cosmetics. Interactable shapes (Terminal, ElectricalShield,
// BareBulb, FloodLamp) are ECS-owned — PropPlacer only reserves their slots.
// [jirnyak.md] §18 PropPass passive skin.
// One rebuild = the whole scene list: ECS props PLUS the floor's baked
// antourage ([game/antourage]). Clears first — add_instance appends, and with
// real shapes in the catalog a second merge would double every mesh.
// Pack the game-side wire chains into the render pass's POD format (render
// never includes game/, so the translation lives here in the app).
static void upload_wires(gpu::WirePass& wirePass, const game::AntourageBake* ab) {
    if (!wirePass.ready()) return;
    static std::vector<gpu::GpuWireChain> packed;
    packed.clear();
    if (ab != nullptr) {
        for (const game::WireChain& c : ab->wires) {
            gpu::GpuWireChain g{};
            g.meta = vec4{c.restLen, 1.0f, c.massKg, 0.0f};
            for (int i = 0; i < gpu::kWireChainPoints; ++i) {
                const bool pinned = (c.pinMask >> i) & 1u;
                g.cur[i] = vec4{c.p[i].x, c.p[i].y, c.p[i].z,
                                pinned ? 0.0f : 1.0f};
                g.prev[i] = vec4{c.p[i].x, c.p[i].y, c.p[i].z, 0.0f};
            }
            packed.push_back(g);
        }
    }
    static const bool wireDbg = std::getenv("GIGA_WIRE_DBG") != nullptr;
    if (wireDbg)
        for (std::size_t i = 0; i < packed.size() && i < 20; ++i)
            std::fprintf(stderr, "[wire] %zu mid (%.1f %.1f %.1f)\n", i,
                         packed[i].cur[4].x, packed[i].cur[4].y,
                         packed[i].cur[4].z);
}

// Pack the game-side cloth sheets into the render pass's POD format — the
// third primitive's twin of upload_wires (render never includes game/).
static void upload_cloths(gpu::ClothPass& clothPass,
                          const game::AntourageBake* ab) {
    if (!clothPass.ready()) return;
    static std::vector<gpu::GpuClothSheet> packed;
    packed.clear();
    static_assert(gpu::kClothGridPoints == game::kClothPoints,
                  "grid shape is the CPU/GPU lockstep");
    if (ab != nullptr) {
        for (const game::ClothSheet& s : ab->cloths) {
            gpu::GpuClothSheet g{};
            g.meta = vec4{s.restX, 1.0f, s.restY, 0.0f};
            for (int i = 0; i < gpu::kClothGridPoints; ++i) {
                const bool pinned = (s.pinMask >> i) & 1u;
                g.cur[i] = vec4{s.p[i].x, s.p[i].y, s.p[i].z,
                                pinned ? 0.0f : 1.0f};
                g.prev[i] = vec4{s.p[i].x, s.p[i].y, s.p[i].z, 0.0f};
            }
            packed.push_back(g);
        }
    }
    clothPass.upload(packed.data(), static_cast<std::uint32_t>(packed.size()));
    static const bool clothDbg = std::getenv("GIGA_WIRE_DBG") != nullptr;
    if (clothDbg)
        for (std::size_t i = 0; i < packed.size() && i < 20; ++i)
            std::fprintf(stderr, "[cloth] %zu top (%.1f %.1f %.1f)\n", i,
                         packed[i].cur[3].x, packed[i].cur[3].y,
                         packed[i].cur[3].z);
}

// --- unified particle pool: the app-side packing seam -----------------------
// Render never includes game/ ([ARCHITECTURE.md]), so bursts proposed in game/
// ([game/particles.h]) become GpuParticle records HERE: the material tint is
// resolved against the generated kMaterial albedo, and velocities/lifetimes
// jitter deterministically off the burst seed (xorshift — no global RNG).
namespace {

struct ParticleRng {
    std::uint32_t s;
    // [-1, 1)
    float next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return static_cast<float>(static_cast<std::int32_t>(s)) *
               (1.0f / 2147483648.0f);
    }
};

void pack_particles(std::vector<gpu::GpuParticle>& out, const vec3& pos,
                    const vec3& dir, const game::ParticleDef& def,
                    const vec3& tint, std::uint8_t count, std::uint32_t seed) {
    ParticleRng rng{seed * 0x9e3779b9u + 1u};
    for (std::uint8_t k = 0; k < count; ++k) {
        gpu::GpuParticle p{};
        const float life = def.lifeS * (0.7f + 0.3f * (rng.next() * 0.5f + 0.5f));
        p.posLife = vec4{pos.x + rng.next() * 0.12f, pos.y + rng.next() * 0.12f,
                         pos.z + rng.next() * 0.12f, life};
        p.velTotal = vec4{(dir.x + rng.next() * 0.6f) * def.speedMps,
                          (dir.y + rng.next() * 0.6f) * def.speedMps,
                          (dir.z + rng.next() * 0.6f) * def.speedMps, life};
        p.colorSize = vec4{tint.x, tint.y, tint.z, def.sizeM};
        p.phys = vec4{def.gravityMul, def.drag, def.bounce,
                      static_cast<float>(def.emissive)};
        out.push_back(p);
    }
}

void drain_particle_bursts(gpu::ParticlePass& pass,
                           game::ParticleBurstQueue& q) {
    if (!pass.ready() || q.count == 0) {
        q.clear();
        return;
    }
    static std::vector<gpu::GpuParticle> tmp;
    tmp.clear();
    for (std::uint16_t i = 0; i < q.count; ++i) {
        const game::ParticleBurst& b = q.items[i];
        const game::ParticleDef& def = game::kParticleTable[b.kind];
        const vec3 tint = def.colorFromMaterial
                              ? kMaterial[b.matId < kMatCount ? b.matId : 0]
                              : vec3{def.r, def.g, def.b};
        pack_particles(tmp, b.pos, b.dir, def, tint, b.count, b.seed);
    }
    pass.spawn(tmp.data(), static_cast<std::uint32_t>(tmp.size()));
    q.clear();
}

// Carve → dust + debris: CarveResult already names every removed sub-voxel
// WITH its material ([world/destruct.h] CarvedVoxel), so the puff is tinted by
// the very wall it came from. Sampled with a stride — a blast stays a cloud,
// not tens of thousands of sprites.
void spawn_carve_particles(gpu::ParticlePass& pass, const CarveResult& res,
                           std::uint32_t seed) {
    if (!pass.ready()) return;
    static std::vector<gpu::GpuParticle> tmp;
    tmp.clear();
    const auto voxel_pos = [](const CarvedVoxel& v) {
        const int cx = static_cast<int>(v.cell) & 127;
        const int cy = (static_cast<int>(v.cell) >> 7) & 127;
        const int cz = (static_cast<int>(v.cell) >> 14) & 127;
        const int sx = v.bit & 7, sy = (v.bit >> 3) & 7, sz = v.bit >> 6;
        return vec3{(static_cast<float>(cx * 8 + sx) + 0.5f) * kVoxelSize,
                    (static_cast<float>(cy * 8 + sy) + 0.5f) * kVoxelSize,
                    (static_cast<float>(cz * 8 + sz) + 0.5f) * kVoxelSize};
    };
    const game::ParticleDef& dust =
        game::particle_def(game::ParticleKind::Dust);
    const std::size_t nd = res.destroyed.size();
    const std::size_t sd = nd > 48 ? nd / 48 : 1;
    for (std::size_t i = 0; i < nd; i += sd) {
        const CarvedVoxel& v = res.destroyed[i];
        const vec3 tint = kMaterial[v.mat < kMatCount ? v.mat : 0];
        pack_particles(tmp, voxel_pos(v), vec3{0.0f, 0.0f, 0.35f}, dust, tint,
                       1, seed ^ static_cast<std::uint32_t>(i));
    }
    const game::ParticleDef& debris =
        game::particle_def(game::ParticleKind::Debris);
    const std::size_t nt = res.detached.size();
    const std::size_t st = nt > 24 ? nt / 24 : 1;
    for (std::size_t i = 0; i < nt; i += st) {
        const CarvedVoxel& v = res.detached[i];
        const vec3 tint = kMaterial[v.mat < kMatCount ? v.mat : 0];
        pack_particles(tmp, voxel_pos(v), vec3{0.0f, 0.0f, -0.2f}, debris,
                       tint, 1, seed ^ 0x5bd1e995u ^
                                    static_cast<std::uint32_t>(i));
    }
    pass.spawn(tmp.data(), static_cast<std::uint32_t>(tmp.size()));
}

} // namespace

static void merge_ecs_prop_meshes(const Registry& reg, LayerId layer,
                                  gpu::PropPass& propPass,
                                  const game::AntourageBake* ab,
                                  const World& world,
                                  std::vector<vec3>* dripEmitters = nullptr,
                                  const std::vector<game::DetachedPiece>* falling =
                                      nullptr) {
    propPass.clear_instances();
    std::vector<game::PropMeshInstance> insts;
    game::collect_static_prop_mesh_instances(reg, layer, insts);
    for (const auto& m : insts) {
        if (m.shape >= static_cast<std::uint8_t>(gpu::kPropShapeCount)) continue;
        gpu::PropInstance pi{};
        pi.origin    = m.origin;
        pi.yaw       = m.yaw;
        pi.color     = m.color;
        pi.scale     = m.scale;
        pi.matId     = m.matId;
        pi.emissive  = m.emissive;
        pi.flags     = m.flags;
        pi.animPhase = m.animPhase;
        propPass.add_instance(static_cast<gpu::PropShape>(m.shape), pi);
    }
    if (ab == nullptr) return;
    // UNIVERSAL antourage instances ([game/antourage/antourage.h]): the core
    // renders whatever a module emitted — shape + transform + material +
    // anchors — with zero knowledge of what it depicts. Aliveness reads the
    // LIVE grid: carve an anchor away and the piece stops being drawn.
    static const bool antourageDebug =
        std::getenv("GIGA_ANTOURAGE_DEBUG") != nullptr;
    const MacroGrid& g = world.grid();
    if (dripEmitters) dripEmitters->clear();
    for (const game::AntourageInstance& it : ab->instances) {
        if (!game::antourage_alive(g, it)) {
            // A severed pipe piece: its anchor was carved away, so the mesh
            // stops drawing — and the stump becomes a DRIP emitter for the
            // unified particle pool (owner's design: якорь мёртв → эмиттер).
            if (dripEmitters && it.matId == kMatPipeMetal &&
                dripEmitters->size() < 96)
                dripEmitters->push_back(it.pos);
            continue;
        }
        gpu::PropInstance pi{};
        pi.origin = it.pos;
        pi.yaw = it.yaw;
        pi.scale = it.scale;
        pi.matId = it.matId;
        pi.emissive = antourageDebug ? 220 : it.emissive;
        const bool ownColor =
            it.color.x != 0.0f || it.color.y != 0.0f || it.color.z != 0.0f;
        pi.color = antourageDebug ? vec3{1.0f, 0.0f, 1.0f}
                   : ownColor     ? it.color
                                  : kMaterial[it.matId < kMatCount ? it.matId
                                                                   : 0];
        if (it.shape < static_cast<std::uint8_t>(gpu::kPropShapeCount))
            propPass.add_instance(static_cast<gpu::PropShape>(it.shape), pi);
    }

    // SEVERED pieces still in the air ([antourage.h] DetachedPiece): the same
    // shapes, drawn from the falling body's own transform instead of the bake's.
    // They live in the instance list exactly as long as they are falling, so the
    // renderer needs no second path and no second shader.
    if (falling != nullptr) {
        for (const game::DetachedPiece& d : *falling) {
            gpu::PropInstance pi{};
            pi.origin = d.pos;
            pi.yaw = d.yaw;
            pi.scale = d.scale;
            pi.matId = d.matId;
            pi.color = kMaterial[d.matId < kMatCount ? d.matId : 0];
            if (d.shape < static_cast<std::uint8_t>(gpu::kPropShapeCount))
                propPass.add_instance(static_cast<gpu::PropShape>(d.shape), pi);
        }
    }
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
void begin_floor_nav(const World& world, int floorNumber, nav::AsyncBake& bake,
                     game::RoomZones& rooms) {
    bake.start(world.grid());
    // The ROOM zones are baked here too, and synchronously, because they are three
    // multi-source BFS against the async bake's 128 — measured below in the same
    // line the nav timings print. Synchronous also means there is no second
    // ownership story to get wrong: the fields are complete before the first tick
    // that could read them, so `ai_step` never sees a half-built field.
    const game::FloorKind kind = kind_for_floor(floorNumber);
    // TIMED, and the timing is not decoration. An untimed synchronous bake once cost
    // ~25 s of load without a single line saying so, and the only symptom anyone saw
    // was the sim running 4140 ticks per 4000 frames one day and 600 the next
    // ([room_zone.cpp] bake_walkable). A bake that does not print its own cost hides
    // exactly the regression it is most likely to cause.
    const auto roomT0 = std::chrono::steady_clock::now();
    game::bake_room_zones(world.grid(), kind, floorNumber, rooms);
    const double roomMs =
        std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - roomT0).count();
    std::fprintf(stderr,
                 "[rooms] floor %d: kind=%d baked mask 0x%04X (%zu bytes resident) "
                 "in %.0f ms\n",
                 floorNumber, static_cast<int>(kind),
                 static_cast<unsigned>(rooms.baked), rooms.resident_bytes(), roomMs);
    // Nav memory AT THE START of the bake, which is the number no document carried
    // and the only moment it can be wrong. The old `start()` cleared the live flow
    // field without freeing it, so this read 130 MiB of dead bytes here while the
    // worker allocated the next 130 beside them — a 260 MiB peak, half of it
    // unreadable (`ready()` is false throughout). It now reads ~0.
    // The matching post-swap figure is on the `[nav]` line from finish_floor_nav.
    std::fprintf(stderr, "[nav] bake begins: nav holds %.1f MiB\n",
                 static_cast<double>(bake.resident_bytes()) / (1024.0 * 1024.0));
}

// Called once the bake has landed: hand the new floor's inhabitants somewhere to
// walk. Separate from begin_floor_nav because it can only run after the swap.
std::uint32_t finish_floor_nav(Registry& reg, LayerId layer, std::uint32_t seed,
                               const nav::AsyncBake& bake) {
    std::uint32_t n = game::wander_init(reg, layer, seed);
    std::uint32_t aiCount = game::ai_init(reg, layer);
    std::fprintf(stderr,
                 "[nav] bake coarse %.0f ms | fine %.0f ms | resident %.1f MiB | "
                 "%u agents wandering | %u AI brains attached "
                 "(async, off the main thread)\n",
                 bake.last_coarse_ms(), bake.last_fine_ms(),
                 static_cast<double>(bake.resident_bytes()) / (1024.0 * 1024.0),
                 n, aiCount);
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

Entity possess_nearest_survivor(Registry& reg, game::NpcPool& pool, LayerId layer, const vec3& playerPos, float reachM) {
    Entity chosen = entt::null;
    game::NpcId chosenId = game::kInvalidNpc;
    float bestD2 = reachM * reachM;

    for (auto e : reg.view<const game::NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;      // already the player
        const game::NpcId id = reg.get<const game::NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;

        const vec3& pos = reg.get<const Transform>(e).pos;
        float dx = wrap_delta_f(playerPos.x, pos.x, kWorldExtent);
        float dy = playerPos.y - pos.y;
        float dz = wrap_delta_f(playerPos.z, pos.z, kWorldExtent);
        float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
            bestD2 = d2;
            chosen = e;
            chosenId = id;
        }
    }
    if (chosen == entt::null) return entt::null;

    // Detach camera & controller from current player body. Keep the old entity
    // handle so POSRPG can move person-progression onto the new body — the old
    // body stays alive in the world (unlike death / elevator fold_back).
    Entity oldPlayer = entt::null;
    for (auto e : reg.view<CameraTag, const game::NpcRef>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const game::NpcId oldId = reg.get<const game::NpcRef>(e).id;
        oldPlayer = e;
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        pool.set_player(oldId, false);
        break;
    }

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    // POSRPG: RpgStats + kill tally + cumulative shots/hits follow the mind.
    // Chambered mag stays on oldPlayer (physical). [combat.h]
    if (oldPlayer != entt::null)
        game::transfer_player_progression(reg, oldPlayer, chosen);
    std::fprintf(stderr, "[gameplay] Voluntarily possessed resident #%u\n", chosenId);
    return chosen;
}

} // namespace

int main(int argc, char** argv) {
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
    // --floor N: ride straight to a labelled floor (up OR down — --ride only
    // descends, which made the padic floor at +4 unreachable in a --shot
    // proof). Uses the console teleport seam, so it exercises the real ride.
    int shotFloor = 0;
    bool shotFloorWanted = false;
    int shotFramesSeen = 0;
    int shotRideDone = 0;
    gpu::Capture shotCap{};
    bool hasCustomPos = false;
    vec3 customPos{89.0f, 71.0f, 2.9f};
    bool hasCustomAng = false;
    float customYaw = 0.8f, customPitch = -0.5f;
    bool shotOrbit = false;
    std::string shotAction;
    bool shotActionConsumed = false; // one-shot save/load; attack stays held
    bool showHud = true;
    // --mirror-verify: after every wholesale upload and every ~300 frames, read
    // the GPU voxel mirror back and memcmp it against the CPU grid. Diagnostic
    // (queue-idles); the proof harness for the raymarch migration's stage 1.
    bool mirrorVerify = false;
    std::uint32_t mirrorFrame = 0;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--shot" && i + 1 < argc) shotPath = argv[++i];
        else if (a == "--frames" && i + 1 < argc) shotFrames = std::atoi(argv[++i]);
        else if (a == "--ride" && i + 1 < argc) shotRide = std::atoi(argv[++i]);
        else if (a == "--floor" && i + 1 < argc) {
            shotFloor = std::atoi(argv[++i]);
            shotFloorWanted = true;
        }
        else if (a == "--no-hud" || a == "--nohud") showHud = false;
        else if (a == "--mirror-verify") mirrorVerify = true;
        else if (a == "--pos" && i + 3 < argc) {
            customPos.x = static_cast<float>(std::atof(argv[++i]));
            customPos.y = static_cast<float>(std::atof(argv[++i]));
            customPos.z = static_cast<float>(std::atof(argv[++i]));
            hasCustomPos = true;
        }
        else if (a == "--yaw" && i + 1 < argc) { customYaw = static_cast<float>(std::atof(argv[++i])); hasCustomAng = true; }
        else if (a == "--pitch" && i + 1 < argc) { customPitch = static_cast<float>(std::atof(argv[++i])); hasCustomAng = true; }
        else if (a == "--orbit") { shotOrbit = true; }
        else if (a == "--action" && i + 1 < argc) { shotAction = argv[++i]; }
    }

    // SAY WHICH BINARY THIS IS, every launch. An unoptimized tree is ~10x
    // slower on the sim (measured 2026-08-05: 62 ms/frame at -O0 against 5.9 ms
    // at -O3, same scene) — and it looks exactly like a performance regression
    // in whatever landed last, because nothing about the build says otherwise.
    // Cheap line, one whole debugging session saved. Rebuild with
    // `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release`.
    std::fprintf(stderr, "[build] %s\n", kBuildKind);

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
    if (!cubePass.init(device, lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "Cube pass init failed\n");
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // GPU mirror of the active floor's voxel truth ([render/voxel_mirror.h]) —
    // stage 1 of the raymarch migration. No pass consumes it yet; it becomes
    // the raymarcher's world in stage 2, so its plumbing boots with the rest.
    gpu::VoxelMirror voxelMirror;
    if (!voxelMirror.init(device)) {
        std::fprintf(stderr, "Voxel mirror init failed\n");
        cubePass.destroy();
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // The world renderer: a fullscreen two-level DDA over the mirror
    // ([render/raymarch_pass.h]). CubePass stays alive as the texture-array
    // owner and the body/prop pipeline-layout donor until the mesher deletion
    // lands; its record() is no longer called, so invalidate() is free.
    gpu::RaymarchPass raymarchPass;
    if (!raymarchPass.init(device, renderer.renderPass, GIGA_SHADER_DIR,
                           voxelMirror, cubePass,
                           lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "Raymarch pass init failed\n");
        voxelMirror.destroy();
        cubePass.destroy();
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
        raymarchPass.destroy();
        voxelMirror.destroy();
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

    gpu::GpuCullPass cullPass;
    if (!cullPass.init(&device, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[cull] pass init failed (continuing without GPU culling)\n");
    }

    // Hanging wires: GPU-verlet antourage chains ([render/wire_pass.h]).
    gpu::WirePass wirePass;
    if (!wirePass.init(&device, renderer.renderPass, GIGA_SHADER_DIR,
                       voxelMirror.masks_buffer())) {
        std::fprintf(stderr, "[wire] pass init failed (continuing without wires)\n");
    }

    // Cloth sheets: GPU-verlet antourage curtains ([render/cloth_pass.h]).
    gpu::ClothPass clothPass;
    if (!clothPass.init(&device, renderer.renderPass, GIGA_SHADER_DIR,
                        voxelMirror.masks_buffer())) {
        std::fprintf(stderr, "[cloth] pass init failed (continuing without cloth)\n");
    }

    // The unified particle pool: blood/dust/sparks/drips, one compute sim
    // colliding against the voxel mirror ([render/particle_pass.h]).
    gpu::ParticlePass particlePass;
    if (!particlePass.init(&device, renderer.renderPass, GIGA_SHADER_DIR,
                           voxelMirror.masks_buffer())) {
        std::fprintf(stderr,
                     "[particle] pass init failed (continuing without particles)\n");
    }

    gpu::GpuGasPass gasPass;
    if (!gasPass.init(&device, GIGA_SHADER_DIR, voxelMirror.class_buffer())) {
        std::fprintf(stderr,
                     "[gas] pass init failed (continuing without GPU gas sim)\n");
    }
    // Severed pipe stumps ([merge_ecs_prop_meshes]) — each drips on a slow
    // clock while its floor stays loaded. Refilled at every prop merge.
    std::vector<vec3> dripEmitters;
    // Antourage legs cut loose and still falling ([antourage.h] DetachedPiece).
    // Transient render/sim state, never persisted: a reloaded floor re-bakes its
    // dressing whole, so anything mid-air simply never happened.
    std::vector<game::DetachedPiece> antourageFalling;


    gpu::ImGuiLayer hud;
    if (!hud.init(device, window, renderer.renderPass,
                  static_cast<std::uint32_t>(renderer.swap().images.size()))) {
        std::fprintf(stderr, "ImGui init failed\n");
        bodyPass.destroy();
        raymarchPass.destroy();
        voxelMirror.destroy();
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
    // §22: lazy nav field rebake under frame budget after carves.
    Registry reg;
    // Navigation for the ONE live floor. Re-baked on every floor entry; ~128 MiB
    // for the flow fields, which is affordable precisely because streaming keeps
    // a single floor resident (performance.md).
    // Baked asynchronously; owns both the live graph the tick reads and the
    // pending one a worker fills (world/nav_async.h).
    nav::AsyncBake nav;
    // Room zones for the SAME one live floor ([room_zone.h]): which macro cells are
    // a kitchen / a bathroom / a flat, and the dense field a body descends to reach
    // one. ~6 MiB on a Residential floor, 0 on a floor whose room mix rolls none of
    // them. Baked SYNCHRONOUSLY inside begin_floor_nav — three multi-source BFS
    // against nav's 128, so it is a rounding error on a load the same function is
    // already spending seconds on, and a synchronous bake needs no ownership story.
    game::RoomZones roomZones;
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
    bool interactWanted = false;    // E, consumed by one sim step (Terminal / ControlPanel / Relief interact)
    bool possessWanted = false;     // P, consumed by one sim step (Voluntary Mind Projection / Body Swap)
    bool throwWanted = false;       // Z, consumed by one sim step (player_throw_step)
    char elevDiagLine[160] = {};
    std::uint64_t elevDiagAt = 0;
    game::PowerGridState powerGrid{};
    // Doors derive from THE FLOOR'S OWN SEED — streamer.floor_seed_of(), the same
    // value its geometry was generated from. There used to be a separate
    // kDoorSeed constant here, and it was a bug factory, not a knob: door_build
    // asks the grid whether each doorway is still an architectural opening, and
    // with the doorway list derived from a DIFFERENT seed than the walls, the
    // padic floor kept only the ~5% of doors that matched by coincidence
    // (measured: 1302 of ~26k). One floor, one seed, every consumer.

    Entity player = entt::null;

    {
        // Register every floor MODULE (number -> module + build recipe), then
        // load ONLY floor 0. The rest stay cold until the elevator enters them,
        // and leaving a floor folds its crowd back — re-entry re-embodies the same
        // records, so the population never grows per visit.
        streamer.init(stack, /*keepRadius=*/0);
        // The registered building = the catalog's EXPLICIT CLAIMS: the demo rows
        // plus every module folder's own number (padic's 4 arrives here without
        // this file naming it). Pattern floors stay unregistered defaults until
        // something claims or streams them.
        for (int f = game::kMinFloor; f <= game::kMaxFloor; ++f) {
            const game::FloorDef* def = floor_catalog().claimed(f);
            if (!def) continue;
            // Vary the seed per floor so same-kind floors still differ.
            std::uint32_t fseed =
                1337u ^ (static_cast<std::uint32_t>(f) * 0x9e3779b9u);
            streamer.add_module(registry, f, def->kind, fseed);
        }
        // Migration destinations are the REGISTERED floor set, never a [lo,hi] band.
        // This stack is legitimately sparse — {0,1,2,-8,-14,-26,-36,-50,14,30} — so a
        // uniform draw over [-50,30] would send 71 of every 81 travellers to a floor
        // that does not exist. Must run after the add_module loop above (the registry
        // is the authoritative live set) and before the first `step()`. Re-call after
        // any renumber. [macro_sim.h]
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
        // A visited floor IS its snapshot: hand the streamer the way to get one
        // back, and it restores immediately after generating — before the pipes
        // are routed and the lamps are hung, so nothing is ever anchored to
        // geometry that is about to change under it. [problems.md] §42
        streamer.set_floor_restore([](World& w, int floorNumber) {
            return apply_floor_file(w, floorNumber);
        });

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
            if (hasCustomPos) reg.get<Transform>(player).pos = customPos;
            if (hasCustomAng) {
                auto& cam = reg.get<CameraTag>(player);
                cam.yaw = customYaw;
                cam.pitch = customPitch;
            }
            LayerId l0 = reg.get<Transform>(player).layer;
            refresh_floor_mobs(reg, stack.layer(l0), 0, l0);
            refresh_floor_containers(reg, stack.layer(l0), 0, l0);
            refresh_floor_props(reg, stack.layer(l0), 0, l0,
                               streamer.floor_seed_of(registry, 0), bus);
            // Doors BEFORE the bake, and frozen for its duration: door_build leaves
            // every door open so the bake sees all-open geometry (an upper bound on
            // connectivity), and AsyncBake holds a raw pointer to the live MacroGrid
            // that must not be mutated until ready(). [door.h]
            if (currentSpec)
                doorsBuilt = game::door_build(stack.layer(l0), doors, 0,
                                              *currentSpec,
                                              streamer.floor_seed_of(registry, 0));
            doors.frozen = true;
            begin_floor_nav(stack.layer(l0), 0, nav, roomZones);
            game::ai_init(reg, l0);
            if (propPass.ready()) {
                merge_ecs_prop_meshes(reg, l0, propPass,
                                      streamer.antourage_at_layer(registry, l0),
                                      stack.layer(l0), &dripEmitters);
                upload_wires(wirePass, streamer.antourage_at_layer(registry, l0));
                upload_cloths(clothPass, streamer.antourage_at_layer(registry, l0));
            }
        }
    }

    if (player == entt::null) {
        std::fprintf(stderr, "population seeding failed to embody a player\n");
        hud.destroy();
        bodyPass.destroy();
        raymarchPass.destroy();
        voxelMirror.destroy();
        cubePass.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // The mirror's first full snapshot: whichever mode built the initial world,
    // its geometry (doors included) is final by here. Arrival sites re-upload;
    // carve and doors stream dirty cells from their existing seams.
    {
        World& w0 = stack.layer(reg.get<Transform>(player).layer);
        voxelMirror.upload_all(w0);
        if (mirrorVerify) voxelMirror.verify(w0);
    }

    InputState input;
    // Start with mouse-look on so the camera rotates immediately. Tab toggles
    // it (freeing the cursor for the HUD); holding the right mouse button also
    // engages look while held.
    input.set_mouselook(true);
    SDL_SetWindowRelativeMouseMode(window, true);

    bool running = true;
    bool paused = false; // Esc pause menu: freezes the sim + frees the cursor
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
    // The diurnal day clock. Single truth of in-game time of day.
    game::DayClock dayClock;
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
    // Last encumbrance report. Read by THREE consumers a frame apart — the
    // Controller's speed chain, the footstep noise radius and the HUD — which is
    // why the sweep reports instead of writing: one producer, three readers, no
    // second writer of anyone's movement.
    game::EncumbranceTick encumbrance{};
    int needsHpLost = 0;       // running total, so the HUD is not one tick
    // [[maybe_unused]]: superseded by PlayerRanged::shots (read straight from the
    // component in the HUD) during the branch merge, but the `shots += ...` RHS is a
    // side-effecting call (it fires the gun), so the accumulator is kept rather than
    // rewriting the statement. MSVC did not warn; Clang -Wunused-but-set-variable does.
    [[maybe_unused]] std::uint32_t shots = 0;   // rounds the player has fired
    game::RunLedger& ledger = runState.ledger;
    game::BankAccount bankAccount{};
    game::bank_open(bankAccount, currentFloor, streamer.floor_seed_of(registry, currentFloor));
    game::EventFeed eventFeed{};
    // F5 saves, F9 loads. Recorded as intent and acted on in the sim loop, the same
    // shape sellWanted/buyWanted use: a load rewrites world state and belongs on the
    // sim's clock, not the window's.
    bool saveWanted = false;
    bool loadWanted = false;
    // THE MAIN MENU — a separate app SCREEN, not a pause overlay. The world
    // behind it is built but frozen; the run starts (or a slot loads) only when
    // a menu row says so, which is also what makes a full v6 world restore
    // safe: it happens before the player has touched anything. --shot captures
    // skip the menu and start Playing directly, so a stray save directory can
    // never alter a deterministic capture.
    enum class AppScreen : std::uint8_t { Menu, Playing };
    AppScreen screen = shotPath ? AppScreen::Playing : AppScreen::Menu;
    int menuScreenPage = 0; // 0 root, 1 load slots, 2 new-game slots, 3 settings
    if (screen == AppScreen::Menu) {
        input.set_mouselook(false);
        SDL_SetWindowRelativeMouseMode(window, false);
    }
    auto menu_start_playing = [&]() {
        screen = AppScreen::Playing;
        menuScreenPage = 0;
        input.set_mouselook(true);
        SDL_SetWindowRelativeMouseMode(window, true);
    };
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
    // Carve scratch + result, reused across ops so a carve allocates nothing
    // after warmup ([world/destruct.h]).
    CarveScratch carveScratch;
    CarveResult carveResult;
    // Macro cells the stain layer dirtied this tick ([world/stain.h]) — the
    // same debt CarveResult::dirtyCells carries, drained into the mirror below.
    std::vector<std::uint32_t> stainDirty;
    // Combat → geometry seam ([combat.h]): bullets/melee propose, sim disposes
    // below behind the same doors.frozen gate as the console carve row.
    game::CarveProposalQueue combatCarves;
    // Combat/impact → particle seam ([game/particles.h]): blood and sparks are
    // proposed as bursts during the sim step and drained into the GPU pool.
    game::ParticleBurstQueue particleBursts;

    bool healWanted = false;
    bool eatWanted = false;       // G, consumed by one sim step
    bool drinkWanted = false;     // T, consumed by one sim step
    bool psiWanted = false;       // Y, consumed by one sim step
    bool sellWanted = false;      // B, consumed by one sim step
    bool buyWanted = false;       // R, consumed by one sim step       // set by H, consumed by one sim step
    bool craftWanted = false;     // C, consumed by one sim step
    bool scrapWanted = false;     // X, consumed by one sim step
    bool showCraftingWindow = false;
    bool showVendorWindow = false;
    bool showElevatorWindow = false;
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
    aiCfg.enabled = true;   // utility AI live; brains attached in finish_floor_nav
    aiCfg.memory = true;    // second axis: needs a real AiMemory* at ai_step
    // Demand column owned HERE ([ai.h] "No global state"). Id-indexed so an
    // elevator fold keeps the row: the cold NpcId is the key, not the body.
    // Passed to every ai_step; null would be bit-for-bit the pre-memory pass.
    game::AiMemory aiMem;
    DiffusionDriver diffusionDriver;
    game::AiTick aiTick{};
    std::uint64_t lastAimemLogTick = ~0ull;
    // Cumulative residents finished off by attrition since the run began. A running
    // total rather than a per-step count, because the failure it watches for is
    // slow: one death per second reads as noise per step and as a morgue per minute.
    std::uint32_t crowdDead = 0;
    game::CraftingState crafting{};
    game::craft_init(crafting);
    std::uint32_t crafted = 0, scrapped = 0, recipesLearned = 0;
    // [[maybe_unused]]: the HUD prints `carried` (live inventory value), not this
    // run-total, after the branch merge — but `loot += ...` wraps the container/pickup
    // hooks that actually move the roubles, so the accumulator is kept. Clang warns,
    // MSVC did not.
    [[maybe_unused]] std::int32_t loot = 0;         // roubles swept up this run
    // Content-layer statuses (zhelemish / web / spore / govnyak). Slowed is the
    // velocity CAP in combat.h; this is the authored table that decides what
    // lands and for how long. Main-owned: Inventory is POD and status must not
    // reach into it — gate checks happen at apply sites below.
    game::StatusSet playerStatus{};
    std::uint64_t lastStatusLogTick = ~0ull;
    std::int32_t healed = 0;
    float ateFood = 0.0f;      // food points that LANDED, for the HUD
    float drankWater = 0.0f;
    float restoredPsi = 0.0f;
    std::int32_t consumeHpCost = 0;   // HP paid for risky food, running total

    // ── Debug console (~) ───────────────────────────────────────────────
    // The registry + default commands are game code ([console.h]); the app owns
    // only the overlay state and the two seams: the per-frame context refresh
    // and the teleport REQUEST (client proposes, server disposes — the app
    // performs the ride at the top of a frame, never mid-draw).
    game::Console console;
    if (!game::console_register_defaults(console))
        std::fprintf(stderr, "[console] duplicate default command REFUSED\n");
    game::ConsoleContext consoleCtx;
    bool showConsole = false;
    bool consoleFocus = false;
    char consoleInput[256] = {};
    std::vector<std::string> consoleLog;
    std::vector<std::string> consoleHistory;
    int consoleHistPos = -1;
    int pendingTeleport = game::ConsoleContext::kNoRequest;
    int pendingLandHub = -1; // lattice hub for fast-travel land; -1 = keep x/y
    // §24 fast-travel unlock set. Discovery: boarding a hub unlocks THIS floor.
    // Start floor 0 unlocked so the first hub ride has somewhere to go back to.
    game::FastTravelState fastTravel;
    fastTravel.unlock(0);

    // ── Key bindings ────────────────────────────────────────────────────
    // Keys are DATA: a KeybindTable row maps a scancode to a console command
    // ([keybind.h]), so the event loop below does one lookup per keydown and
    // the old per-key `if` chain is gone. The table parses/serializes bytes;
    // the fopen lives HERE, the same split save.h uses.
    game::KeybindTable binds;
    if (!game::keybind_register_defaults(binds))
        std::fprintf(stderr, "[keybind] duplicate default bind REFUSED\n");
    constexpr const char* kBindsPath = "gigahrush2.keys";
    {
        std::FILE* f = std::fopen(kBindsPath, "rb");
        if (f) {
            char text[4096];
            const std::size_t n = std::fread(text, 1, sizeof text - 1, f);
            text[n] = '\0';
            std::fclose(f);
            binds.parse(text);
        }
    }
    input.set_move_binds(game::keybind_move_binds(binds));
    auto save_binds = [&]() {
        char text[4096];
        const std::size_t n = binds.serialize(text, sizeof text);
        std::FILE* f = std::fopen(kBindsPath, "wb");
        if (!f) return;
        std::fwrite(text, 1, n, f);
        std::fclose(f);
    };
    // The pause menu's rebind capture: index of the row waiting for a key, -1
    // when idle. menuPage 0 = main items, 1 = the key-binding editor.
    int rebindCapture = -1;
    int menuPage = 0;
    // The display name of an action's current key, for menu rows and HUD
    // prompts — so a rebind renames every hint with no further edit.
    auto bind_key = [&](const char* action) -> const char* {
        const game::KeyBind* kb = binds.find(action);
        const char* name =
            kb ? SDL_GetScancodeName(static_cast<SDL_Scancode>(kb->scancode))
               : "";
        return (name && *name) ? name : "?";
    };
    // The commands a key/menu row dispatches read the SAME context the typed
    // console does; player/floor move under it, so it is re-pointed each frame.
    auto refresh_console_ctx = [&]() {
        consoleCtx.ecs = &reg;
        consoleCtx.pool = &pool;
        consoleCtx.stack = &stack;
        consoleCtx.floors = &registry;
        consoleCtx.catalog = &floor_catalog();
        consoleCtx.player = player;
        consoleCtx.currentFloor = currentFloor;
        consoleCtx.fastTravel = &fastTravel; // §24 hub unlock bitset
    };
    auto exec_command = [&](const char* line) {
        char msg[256];
        console.exec(consoleCtx, line, msg, sizeof msg);
        if (showConsole && msg[0]) consoleLog.push_back(msg);
    };

    // THE save, one law: run.sav (the run) + the resident floor's own file
    // (its geometry). F5 calls it, and so does the autosave at the end of
    // every ride — a transition is a load screen, where I/O belongs. [save.h]
    auto save_run_now = [&]() -> bool {
        const game::NpcRef* nr =
            reg.valid(player) ? reg.try_get<game::NpcRef>(player) : nullptr;
        if (!nr || !pool.valid(nr->id)) return false;
        const vec3& sp = reg.get<Transform>(player).pos;
        const LayerId pl = reg.get<Transform>(player).layer;
        runState.player.clock = pool.needs(nr->id);
        runState.player.inv = pool.inventory(nr->id);
        runState.player.hp = pool.hp(nr->id);
        runState.player.maxHp = pool.max_hp(nr->id);
        if (const game::Equipped* eq = reg.try_get<game::Equipped>(player))
            runState.player.equipped = *eq;
        else
            runState.player.equipped = game::Equipped{};
        // The SIGNED floor, explicitly: NpcPool::floor() is the seeding label
        // and LayerId is a recycled storage slot. [save.h]
        runState.player.floorNumber = currentFloor;
        runState.player.cx = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.x / kCellSize)));
        runState.player.cy = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.y / kCellSize)));
        runState.player.cz = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.z / kCellSize)));
        // Version 7: character sheet + crafting bank. Prefer the live entity
        // component; fall back to the death-surviving carried snapshot so a
        // mid-death F5 still banks progression. [save.h] SAVRPG
        if (const game::RpgStats* rs = reg.try_get<game::RpgStats>(player))
            runState.rpg = *rs;
        else
            runState.rpg = carriedRpg;
        runState.craft = crafting;
        // Version 8 / SAVMAG: chambered mag + kill tally. Lazy-attach stays
        // lazy — only mark hasRanged when the body actually carries the
        // component (elevator rule). kills is the person-state local that
        // death-possession already stamps onto a new body.
        if (const game::PlayerRanged* pr = reg.try_get<game::PlayerRanged>(player)) {
            runState.hasRanged = 1;
            runState.ranged = *pr;
        } else {
            runState.hasRanged = 0;
            runState.ranged = game::PlayerRanged{};
        }
        runState.kills = kills;
        // Version 9 / SAVSTAT: live status effects. Local person-state — not an
        // ECS component — so capture is a direct assignment. F5 mid-haze must
        // not wipe timers on F9. [status.h]
        runState.status = playerStatus;
        // v10 / SAVCLOCK: the two run-scoped clocks. Both are plain locals in this
        // function's scope, which is exactly why they were never saved — nothing in
        // save.cpp could see them. The samosbor one is the central crisis machine,
        // and saving inside an Active phase used to hand back an Idle automaton with
        // `count` 0 on load; the fast-travel one is every hub the player has
        // discovered ([problems.md] §43). [samosbor.h] [fast_travel.h]
        runState.samosbor = samosbor;
        runState.fastTravel = fastTravel;
        // REFRESH, not append and not clear. [save.h]
        game::refresh_opened_containers(reg, pl, currentFloor, runState.opened);
        // v6: the macro world travels whole — pool table, macro clock, faction
        // matrix. The society you come back to is the one you left. [save.h]
        pool.save_rows(runState.poolBlob);
        macroSim.save_state(runState.macroBlob);
        runState.factions = factionRel;
        write_floor_file(stack.layer(pl), currentFloor);
        char runPath[128];
        run_save_path(runPath, sizeof runPath);
        return write_run(runState, runPath);
    };

    // One ride, either shape: the elevator keys ([ / ]) pass a DIRECTION, the
    // console teleport passes an ABSOLUTE registered floor. Everything after
    // the streamer call — the arrival refresh of mobs/containers/doors/nav/
    // props and the per-floor clocks — is identical, which is exactly why it
    // lives here once instead of twice.
    // `landHub` (default -1): lattice hub index for §24 fast-travel landings;
    // -1 keeps mirrored x/y (debug teleport / ±1 ride). Absolute path only.
    //
    // THE LIVE LAYER LIVES HERE, not inside the frame loop, and `do_ride` writes
    // it back before returning. It used to be declared at the top of the loop
    // body, which the lambda (defined above it) could not reach — so a ride left
    // the enclosing `activeLayer` pointing at the slot the streamer had just
    // recycled, and the REST OF THAT FRAME ran against the departed floor's
    // World: carve, door_step, the mirror flush and bodyPass.record all took the
    // wrong layer. Two of the four travel sites (F9, --shot) had each grown their
    // own `activeLayer = nl;` patch; the console teleport and the [ / ] keys had
    // not. With `keepRadius = 0` there are exactly two slots and `ensure_loaded`
    // allocates before `unload` frees, so the id alternates on EVERY ride — the
    // corruption was guaranteed, not occasional. [problems.md] §24.
    LayerId activeLayer = reg.get<Transform>(player).layer;
    auto do_ride = [&](bool absolute, int target, int landHub = -1) -> bool {
        // Pass the player's durable record id so the destination crowd skips it
        // instead of spawning a second player.
        game::NpcId pid = reg.valid(player) ? reg.get<game::NpcRef>(player).id
                                            : game::kInvalidNpc;
        // Opened crates are world state, not a free respawn. Capture the
        // leaving floor BEFORE travel: the streamer may recycle the LayerId and
        // refresh_floor_containers destroys every crate on the arrival slot.
        // Without this, loot → leave → return refills every emptied box. [save.h]
        {
            const LayerId leaveLayer = reg.valid(player)
                                           ? reg.get<Transform>(player).layer
                                           : static_cast<LayerId>(0);
            game::refresh_opened_containers(reg, leaveLayer, currentFloor,
                                            runState.opened);
            // The departing floor's exact grid goes to its own file — this is
            // THE geometry persistence: the next visit (or the next run)
            // stamps it back. A transition is a load screen; I/O is
            // sanctioned here. [save.h]
            write_floor_file(stack.layer(leaveLayer), currentFloor);
            // AIMEM: clear MotionOwner::Ai on the leaving floor before the
            // streamer recycles the layer. unload() also releases; this is the
            // keyboard/--shot leave seam so a ride without an immediate unload
            // still cannot strand tokens. Idempotent. [ai.h]
            {
                const std::uint32_t released =
                    game::ai_release(reg, leaveLayer);
                std::fprintf(stderr,
                             "[aimem] LEAVE floor=%d layer=%u released=%u "
                             "mem_rows=%u\n",
                             currentFloor, static_cast<unsigned>(leaveLayer),
                             released, aiMem.rows());
            }
        }
        game::RideResult ride =
            absolute ? streamer.teleport(stack, registry, reg, pool, player,
                                         currentFloor, target, game::kArrivalCoord,
                                         pid, landHub)
                     : streamer.travel(stack, registry, reg, pool, player,
                                       currentFloor, target, game::kArrivalCoord,
                                       pid);
        if (!ride.moved) return false;
        player = ride.player;
        currentFloor = ride.floor;
        // The vendor answers to whoever OWNS this floor — re-asked on every
        // arrival path (ride / load / floor change), because a stale kind from
        // the departure floor mispriced every trade until the next reload.
        vendorKind = game::vendor_kind_for(game::dominant_faction(pool, currentFloor));
        // §24 discovery: landing on (or via) a lattice hub unlocks THIS floor
        // for the fast-travel network. Boarding the cabin is the discover act.
        if (landHub >= 0)
            fastTravel.unlock(currentFloor);
        // Deepest point reached, for the run score. |z|, because depth is
        // bidirectional: the roof is as far from safety as the basement.
        // [extraction.h]
        game::record_floor(ledger, currentFloor);
        game::bank_open(bankAccount, currentFloor, streamer.floor_seed_of(registry, currentFloor));
        // A new floor gets its own clock at its own depth. Not carried over:
        // the cooldown is a function of |z|, so inheriting a 30-minute surface
        // gap into the void would silently cancel the entire depth gradient.
        //
        // That reasoning was right and the function was wrong, for as long as this
        // line existed. `samosbor_new_game` is the DEPTH-INDEPENDENT flat 120..180 s
        // new-game roll — its own doc says "once per RUN" — so re-arming with it did
        // the exact thing the sentence above refuses: at |z| = 50, where the authored
        // cooldown is 60 s, it handed out 2-3x the calm that floor is meant to give,
        // and riding down-and-back-up was a free reset of the depth pressure. It also
        // zeroed `count`, and `count` is what `MobDef::minSamosbor` unlocks against —
        // with a stack of demo floors the player rides constantly, so the fog roster
        // was pinned at count 0 forever and the whole `min_samosbor` column of
        // data/mobs.csv was dead data. Both defects silent. [samosbor.h] names them.
        samosbor = game::samosbor_enter_floor(samosbor, currentFloor, sbRng);
        // A rumour is about a FLOOR, so carrying one across a ride makes it
        // false. Caught on a capture: the line read "самосбор здесь часто
        // (17.2%)" while the HUD's own duty for the floor underfoot said 35.0%
        // — the number was true of the floor the speaker was standing on, two
        // rides ago. The whole premise of this system is that a rumour is
        // checkable, so a stale one is worse than none. [rumour.h]
        rumourLine[0] = 0;
        rumourAt = 0;
        // A gunshot on the floor you just left must not be audible to the crowd
        // on the one you arrived at. The streamer RECYCLES LayerId slots, so a
        // surviving record would not merely be stale — it would match the new
        // floor's layer id and be heard there. [noise.h]
        game::noise_clear(noiseField);
        currentSpec = spec_for_floor(currentFloor);
        // Mobs belong to the floor, not to the player: the departed layer's are
        // destroyed and the arrival's are spawned fresh (deterministically, so
        // a floor looks the same every visit).
        LayerId nl = reg.get<Transform>(player).layer;
        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
        refresh_floor_containers(reg, stack.layer(nl), currentFloor, nl);
        refresh_floor_props(reg, stack.layer(nl), currentFloor, nl,
                           streamer.floor_seed_of(registry, currentFloor), bus);
        // Re-empty crates already looted on a prior visit to this floor.
        // Deterministic spawn would otherwise refill them — the brick this pair
        // closes. Same seam as F9 apply. [save.h]
        game::apply_opened_containers(reg, nl, currentFloor,
                                       runState.opened.data(),
                                       runState.opened.size());
        // (The floor's own file is restored INSIDE ensure_loaded now — before the
        //  dressing bake and the props, not after them. [problems.md] §42)
        // Doors before the bake, frozen for its duration. [door.h]
        if (currentSpec)
            doorsBuilt = game::door_build(
                stack.layer(nl), doors, currentFloor, *currentSpec,
                streamer.floor_seed_of(registry, currentFloor));
        doors.frozen = true;
        begin_floor_nav(stack.layer(nl), currentFloor, nav, roomZones);
        // Arrival geometry is final (floor file + doors stamped): re-snapshot
        // the GPU voxel mirror for the recycled World object.
        voxelMirror.upload_all(stack.layer(nl));
        if (mirrorVerify) voxelMirror.verify(stack.layer(nl));
        if (propPass.ready()) {
            merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(wirePass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(clothPass, streamer.antourage_at_layer(registry, nl));
        }
        // ride_elevator keeps x/y and plants z=kArrivalCoord. ~1-in-5 Residential
        // columns are solid at that z, so without this the body freezes in a
        // wall forever (physics backs out every tick). F9 already calls
        // place_body_at_cell; keyboard/--shot did not. [save.h]
        game::place_body_safely(reg, stack.layer(nl), player);
        // Publish the new slot to the enclosing frame. ONE place, so a fifth
        // travel site cannot forget it the way two of the first four did.
        activeLayer = nl;
        // AUTOSAVE: every floor transition checkpoints the run, so a crash
        // costs at most the current floor's progress. The departed floor's
        // file is already on disk (written above, before travel).
        save_run_now();
        return true;
    };

    while (running) {
        activeLayer = reg.get<Transform>(player).layer;
        bool propPassNeedsRebuild = false;
        // SEPARATE from the instance repack above, and the separation is the fix.
        // Re-packing the prop instance list and re-uploading the verlet STATE are
        // different events that shared one flag: `upload_wires`/`upload_cloths`
        // rewrite both `cur` and `prev` from the BAKE pose, i.e. they reset every
        // chain and sheet on the floor to rest with zero velocity. Since the flag
        // is also raised every frame while any severed leg is still falling
        // (kAntourageFallSec = 8 s), one shot at a wall froze all the dressing on
        // the floor for eight seconds. Pin changes never needed it anyway —
        // `write_pins` publishes those per frame. [problems.md] section 28.4
        bool dressingSetChanged = false;

        // The dressing's half of every geometry mutation, next to the ECS-prop
        // half (anchor_validate_step): whatever emptied these cells — a blast,
        // a bullet, an opening door — the baked antourage anchored to them is
        // severed, sheds debris through the shared particle queue, and the
        // instance list owes a re-pack. True = "the GPU is drawing a lie".
        const auto antourage_carve_step_here =
            [&](const std::vector<std::uint32_t>& dirty,
                std::uint32_t seed) -> bool {
            const game::AntourageBake* ab =
                streamer.antourage_at_layer(registry, activeLayer);
            if (ab == nullptr || dirty.empty()) return false;
            return game::antourage_carve_step(stack.layer(activeLayer), *ab,
                                              dirty.data(), dirty.size(),
                                              particleBursts, seed,
                                              &antourageFalling) > 0;
        };

        // §22: amortize nav field rebake under frame budget.
        std::uint64_t now = SDL_GetPerformanceCounter();
        float frameDt = static_cast<float>((now - prevTicks) / freq);
        prevTicks = now;

        // A console teleport is executed HERE, at the top of a frame, never in
        // the ImGui callback that requested it: mid-draw the frame's layer and
        // camera state are already committed, and yanking the world under them
        // is exactly the class of bug the request seam exists to prevent.
        if (pendingTeleport != game::ConsoleContext::kNoRequest) {
            const int dst = pendingTeleport;
            const int hub = pendingLandHub;
            pendingTeleport = game::ConsoleContext::kNoRequest;
            pendingLandHub = -1;
            do_ride(/*absolute=*/true, dst, hub);
        }

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
                //
                // AND `c` IS THE KILLER, which this site ignored until 2026-08-12.
                // A Hunt job counted ANY monster death on the floor — one killed by
                // another monster, by a hazard, by a fall. [problems.md] §40 filed
                // that as sloppiness because it was nearly unobservable: monsters
                // could not hit each other, so almost every mob death really was the
                // player's doing.
                //
                // Removing `Projectile::team` the same day turned it into an
                // EXPLOIT. Monsters now shoot each other as a matter of course, so a
                // contract for eight Krysnozhka completes while the player stands
                // still and watches. That is the friendly-fire change handing the
                // player a reward system it was never meant to touch — and it is the
                // reason this is fixed in the same session rather than filed.
                //
                // The player is the CAMERA HOLDER, not a stored id: "the player is
                // not special, it is whoever holds the components" ([AGENTS.md]), so
                // a possessed body earns its own kills without a second rule.
                // XP already worked this way — `finalize_deaths` credits `d.killer`
                // — which is exactly why the two disagreed and only this one paid out
                // for a death across the room.
                if (ev.b != 0xFFu &&
                    ev.c == static_cast<std::uint32_t>(entt::to_integral(player))) {
                    game::contract_on_kill(contracts, static_cast<std::uint8_t>(ev.b));
                    game::quest_on_kill(quests, static_cast<std::uint8_t>(ev.b));
                }
                // `a` is the pool id, kInvalidNpc when the dead thing had no record.
                // Giver death fails Active contracts AND Active quests the same way.
                if (ev.a != game::kInvalidNpc) {
                    game::contract_on_giver_died(contracts, ev.a);
                    game::quest_on_giver_died(quests, ev.a);
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
        game::feed_drain(eventFeed, bus);
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
        // Keydown dispatch is ONE table lookup ([keybind.h]): the row's console
        // command runs through the same registry a typed line uses, and its
        // effect lands as a request bit drained after this loop. The old per-key
        // `if` chain is gone — adding a key action is a KeybindTable row plus a
        // ConsoleCommand row, no app edit.
        refresh_console_ctx();
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            hud.process_event(e);
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
                if (rebindCapture >= 0) {
                    // The menu is listening: this key becomes the row's binding
                    // (Esc cancels). Saved immediately — a rebind the app then
                    // crashes on would otherwise be lost.
                    if (e.key.scancode != SDL_SCANCODE_ESCAPE)
                        binds.rebind(binds.at(static_cast<std::size_t>(rebindCapture)).action,
                                     static_cast<std::uint16_t>(e.key.scancode));
                    rebindCapture = -1;
                    save_binds();
                    input.set_move_binds(game::keybind_move_binds(binds));
                } else {
                    const bool typing = ImGui::GetIO().WantTextInput;
                    const game::KeyBind* kb = binds.find_scancode(
                        static_cast<std::uint16_t>(e.key.scancode));
                    // Plain rows fire only in live play; kBindAlways rows (menu,
                    // console, hud) fire while paused, kBindTyping rows even
                    // while a text field owns the keyboard — so the toggle key
                    // can always close what it opened. This gate also stops a
                    // vendor-filter keystroke from eating rations, which the old
                    // chain happily did.
                    if (screen == AppScreen::Playing && kb &&
                        (!typing || (kb->flags & game::kBindTyping)) &&
                        (!paused || (kb->flags & game::kBindAlways)))
                        exec_command(kb->command);
                }
            }
            // While the pause menu is up, ignore all look/move input: ImGui owns
            // the cursor and the game is frozen.
            if (!paused) {
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

        // --- console requests ---------------------------------------------
        // Drain the one-shot request bits ([console.h]) that bound keys, menu
        // buttons and typed console lines all set. The app performs each effect
        // HERE, at its safe point — the same client-proposes/server-disposes
        // seam the floor teleport rides.
        {
            using game::ConsoleRequest;
            const std::uint32_t reqs = consoleCtx.take_requests();
            auto has = [&](ConsoleRequest r) {
                return (reqs & game::request_bit(r)) != 0;
            };
            if (has(ConsoleRequest::Quit)) running = false;
            if (has(ConsoleRequest::Menu) && screen == AppScreen::Playing) {
                // Pausing frees the cursor so the menu is clickable and the OS
                // window can be moved / minimised; leaving re-arms mouselook.
                paused = !paused;
                if (!paused) {
                    menuPage = 0;
                    rebindCapture = -1;
                }
                input.set_mouselook(!paused);
                SDL_SetWindowRelativeMouseMode(window, !paused);
            }
            if (has(ConsoleRequest::Hud)) showHud = !showHud;
            if (has(ConsoleRequest::Console)) {
                // Opening frees the cursor so the input line is clickable; the
                // '`' char itself is filtered in the InputText callback so the
                // toggle never types into its own console.
                showConsole = !showConsole;
                consoleFocus = showConsole;
                if (showConsole) {
                    input.set_mouselook(false);
                    SDL_SetWindowRelativeMouseMode(window, false);
                }
            }
            if (has(ConsoleRequest::Mouselook) && !paused) {
                const bool on = !input.mouselook();
                input.set_mouselook(on);
                SDL_SetWindowRelativeMouseMode(window, on);
            }
            // Floor travel (#8/#9): streams the destination in on demand and
            // folds the departed floor's crowd back into the cold pool, so only
            // ONE floor is ever live. The whole depart/arrive sequence is shared
            // with the console teleport — see do_ride above the loop.
            if (has(ConsoleRequest::FloorDown) && !paused)
                do_ride(/*absolute=*/false, -1);
            if (has(ConsoleRequest::FloorUp) && !paused)
                do_ride(/*absolute=*/false, +1);
            // Fly stays a PlayerCommand button: the bridge queues the edge and
            // the server flips the state ([netcode-seam]).
            if (has(ConsoleRequest::Fly) && !paused) input.queue_fly_toggle();
            // Survival / persistence / trade one-shots are recorded as INTENT
            // and acted on in the sim loop, exactly as before: they mutate pool
            // rows or world state, which belongs on the sim's clock, not the
            // window's. (Set even while paused so a menu button lands on the
            // first tick after resume rather than vanishing.)
            if (has(ConsoleRequest::Heal)) healWanted = true;
            if (has(ConsoleRequest::Eat)) eatWanted = true;
            if (has(ConsoleRequest::Drink)) drinkWanted = true;
            if (has(ConsoleRequest::Psi)) psiWanted = true;
            if (has(ConsoleRequest::Door)) doorWanted = true;
            if (has(ConsoleRequest::Possess)) possessWanted = true;
            if (has(ConsoleRequest::Save)) saveWanted = true;
            if (has(ConsoleRequest::Load)) loadWanted = true;
            if (has(ConsoleRequest::Sell)) sellWanted = true;
            if (has(ConsoleRequest::Resupply)) buyWanted = true;
            if (has(ConsoleRequest::Scrap)) scrapWanted = true;
            if (has(ConsoleRequest::Elevator)) {
                showElevatorWindow = !showElevatorWindow;
                if (showElevatorWindow) input.set_mouselook(false);
            }
            if (has(ConsoleRequest::Vendor)) {
                showVendorWindow = !showVendorWindow;
                if (showVendorWindow) input.set_mouselook(false);
            }
            if (has(ConsoleRequest::Craft)) {
                craftWanted = true;
                showCraftingWindow = !showCraftingWindow;
                if (showCraftingWindow) input.set_mouselook(false);
            }
            // ATTR1: spend one unspent point. HP ptrs from the pool row so
            // STR immediately credits max-HP the same way award_xp does.
            if ((has(ConsoleRequest::AttrStr) || has(ConsoleRequest::AttrAgi) ||
                 has(ConsoleRequest::AttrInt)) &&
                reg.valid(player)) {
                if (auto* rs = reg.try_get<game::RpgStats>(player)) {
                    std::int16_t* hp = nullptr;
                    std::int16_t* maxHp = nullptr;
                    if (const game::NpcRef* nr =
                            reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(nr->id)) {
                            hp = &pool.hp(nr->id);
                            maxHp = &pool.max_hp(nr->id);
                        }
                    }
                    game::Attr which = game::Attr::Str;
                    const char* tag = "str";
                    if (has(ConsoleRequest::AttrAgi)) {
                        which = game::Attr::Agi;
                        tag = "agi";
                    } else if (has(ConsoleRequest::AttrInt)) {
                        which = game::Attr::Int;
                        tag = "int";
                    }
                    const bool ok = game::spend_attr_point(*rs, which, hp, maxHp);
                    std::fprintf(stderr,
                                 "[attr] spend %s ok=%d pts_left=%u "
                                 "str=%u agi=%u int=%u\n",
                                 tag, ok ? 1 : 0, rs->attrPoints,
                                 rs->attr[0], rs->attr[1], rs->attr[2]);
                }
            }
            // Z: pull the pin. One-shot like Interact — a held key would empty the
            // bag at the weapon's own cooldown, and a grenade is not an automatic.
            if (has(ConsoleRequest::Throw)) throwWanted = true;
            // Interact takes the job on offer — contract first, then quest if
            // no contract is pending. Both clear on take so a second press is
            // harmless. Quest accept refuses a dead giver or a chain gate;
            // contract_accept refuses the same. [quest.h, contract.h]
            if (has(ConsoleRequest::Interact)) {
                interactWanted = true;
                if (game::contract_accept(contracts, offer, ledger)) {
                    offer = game::Contract{};
                    offerLine[0] = 0;
                } else if (game::quest_valid(questOffer) &&
                           questOfferGiver != game::kInvalidNpc &&
                           game::quest_accept(quests, pool, questOffer,
                                              questOfferGiver, currentFloor,
                                              ledger)) {
                    questOffer = game::kInvalidQuest;
                    questOfferGiver = game::kInvalidNpc;
                    questOfferLine[0] = 0;
                }
            }
        }

        // The layer the player is currently on drives sim + render below.
        // activeLayer already defined at frame top

        // --- fixed-step simulation ----------------------------------------
        // Frozen while the pause menu is up; drop accumulated time so resuming
        // does not fast-forward the missed interval.
        if (paused || screen == AppScreen::Menu) {
            simAccum = 0.0f;
        } else {
            simAccum += frameDt;
            // The embodied AI steers against the live floor's baked danger field
            // ([diffusion.md]); it is null when the floor seeds none -> threat reads
            // 0 and no one flees, the scorer's stubbed-input stance ([ai.md]).
            // Fetched once per frame: the fixed loop below never (re)creates it.
            World& activeWorld = stack.layer(activeLayer);
            const Field<float>* danger = activeWorld.fields().find<float>("danger");
            const MacroGrid& activeGrid = activeWorld.grid();
            int guard = 0;
            while (simAccum >= kSimDt && guard++ < 8) {
                // Age the noise field ONCE per tick, at the top ([noise.h]). Everything
                // published later in this tick therefore gets a full tick of life before
                // it can expire, and investigate_step below reads a field that nothing has yet
                // mutated this tick — so a gunshot fired on tick N is investigated on
                // tick N+1 rather than racing the pass that fired it.
                game::noise_step(noiseField,
                                 static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f));
                // While the console input line owns the keyboard, WASD is text,
                // not movement: skip the bridge and park the intent so the body
                // does not glide on the last pre-console wishDir.
                if (showConsole && ImGui::GetIO().WantTextInput) {
                    if (reg.valid(player))
                        if (auto* c = reg.try_get<Controller>(player))
                            c->wishDir = vec3{0, 0, 0};
                } else {
                    input.apply(reg, kSimDt);
                }
                // CARVE wall proof locomotion: input.apply clears wishDir from
                // keyboard (no keys in --shot), so face+walk MUST land after
                // apply and BEFORE controller_step consumes wishDir. The later
                // shotAction=="wall" block only holds attackHeld + logs.
                if (shotPath &&
                    (shotAction == "wall" || shotAction == "rpgcmbt") &&
                    reg.valid(player) &&
                    shotFramesSeen >= 30 && !doors.frozen) {
                    const Transform& ptr = reg.get<Transform>(player);
                    const MacroGrid& g = stack.layer(activeLayer).grid();
                    const float cx = ptr.pos.x;
                    const float cy = ptr.pos.y;
                    const float cz = ptr.pos.z;
                    const float eyeZ = cz + 0.7f;
                    float bestD2 = 1.0e12f;
                    float bestDx = 0.0f, bestDy = 0.0f;
                    // Wider ring than melee reach so open-room spawns still
                    // find a wall; walk closes the gap (kPlayerWalkSpeed).
                    for (int pass = 0; pass < 2 && bestD2 >= 1.0e12f; ++pass) {
                        const float sampleZ =
                            pass == 0 ? eyeZ : (eyeZ - kCellSize);
                        const int gz =
                            static_cast<int>(sampleZ / kCellSize);
                        if (gz < 0 || gz >= kMacroDim) continue;
                        for (int ox = -8; ox <= 8; ++ox) {
                            for (int oy = -8; oy <= 8; ++oy) {
                                if (ox == 0 && oy == 0) continue;
                                const float px =
                                    cx + static_cast<float>(ox) * kCellSize;
                                const float py =
                                    cy + static_cast<float>(oy) * kCellSize;
                                const int gx = wrap_macro(
                                    static_cast<int>(px / kCellSize));
                                const int gy = wrap_macro(
                                    static_cast<int>(py / kCellSize));
                                if (g.cell(gx, gy, wrap_macro(gz)) ==
                                    kCellAir)
                                    continue;
                                const float dx =
                                    wrap_delta_f(cx, px, kWorldExtent);
                                const float dy =
                                    wrap_delta_f(cy, py, kWorldExtent);
                                const float d2 = dx * dx + dy * dy;
                                if (d2 < bestD2) {
                                    bestD2 = d2;
                                    bestDx = dx;
                                    bestDy = dy;
                                }
                            }
                        }
                    }
                    if (bestD2 < 1.0e12f) {
                        auto& cam = reg.get<CameraTag>(player);
                        // camera_forward / walk fwd: yaw=atan2(dy,dx) (Z-up).
                        cam.yaw = std::atan2(bestDy, bestDx);
                        cam.pitch = 0.0f;
                        if (auto* ctl = reg.try_get<Controller>(player)) {
                            // aim_player starts fly=true; wall walk needs ground
                            // locomotion so collision/wish actually close gap.
                            ctl->fly = false;
                            // Always walk forward while out of unarmed reach
                            // (~1.9 m). wishDir.x is camera-local forward.
                            if (bestD2 > 1.2f * 1.2f)
                                ctl->wishDir = {1.0f, 0.0f, 0.0f};
                        }
                    }
                }
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
                // `aiCfg.enabled` is TRUE and `aiMem` is passed every tick. Memory is the
                // demand column owned above; null would disable recall/record bit-for-bit.
                // `ai_init` attaches brains in finish_floor_nav; `ai_release` runs on floor
                // leave (do_ride + --shot travel) and again inside FloorStreamer::unload.
                // Clearing enabled mid-run without release would strand MotionOwner::Ai
                // and freeze bodies under wander_step — that trap is what AIMEM closes.
                // NOTE the `activeLayer` argument: the parked call was
                // `ai_step(reg, pool, danger, activeGrid, simNow, kSimDt)` against an older
                // SIX-argument signature with no layer, so it would not even have compiled
                // if anyone had uncommented it. That is what "parked until adapted" was
                // really hiding — a commented-out call is not a call, and nothing checks it.
                // §23 hermetic flee: doors + activeWorld let IntentFlee steer toward
                // door_nearest_shelter (sealed apartments) before −∇danger / memory.
                // §27 legs (a)+(b): `roomZones` is what lets a winning eat/drink/
                // toilet/sleep intent actually STEER a body — without it every
                // non-flee intent hands motion straight back to wander_step and the
                // scorer is decoration (measured: own_ai=0 of 419).
                dayClock.step(kSimDt);
                game::ai_panic_publish_step(reg, pool, diffusionDriver, activeWorld, activeLayer, kSimDt, &samosbor);
                diffusion_tick(diffusionDriver, activeWorld, activeLayer, simTick);
                danger = activeWorld.fields().find<float>("danger");
                aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,
                                       kSimDt, aiCfg, &aiMem, &doors, &activeWorld,
                                       &roomZones, dayClock.minute_of_day(), &samosbor);
                // AIMEM proof trail: once nav has brains and AI is on, emit a
                // compact stderr pulse so a --shot harness can assert the store
                // is live (rows/writes/recalled) without parsing the HUD.
                if (aiCfg.enabled && (lastAimemLogTick == ~0ull ||
                                     simTick - lastAimemLogTick >= 60ull)) {
                    lastAimemLogTick = simTick;
                    std::fprintf(stderr,
                                 "[aimem] STEP tick=%llu layer=%u seen=%u replan=%u "
                                 "own_ai=%u own_wander=%u errand=%u settled=%u "
                                 "step=%u column=%u lost=%u stalled=%u meandist=%.1f "
                                 "recall=%u filed=%u fled=%u "
                                 "rows=%u writes=%u coal=%u evict=%u bytes=%zu\n",
                                 static_cast<unsigned long long>(simTick),
                                 static_cast<unsigned>(activeLayer),
                                 aiTick.considered, aiTick.replanned,
                                 aiTick.aiOwned, aiTick.wanderOwned,
                                 aiTick.roomOwned, aiTick.settled,
                                 aiTick.errandStep, aiTick.errandColumn,
                                 aiTick.errandLost, aiTick.errandStalled,
                                 (aiTick.errandStep + aiTick.errandColumn) != 0
                                     ? static_cast<double>(aiTick.errandDistCells) /
                                           static_cast<double>(aiTick.errandStep +
                                                               aiTick.errandColumn)
                                     : 0.0,
                                 aiTick.recalled, aiTick.remembered,
                                 aiTick.memoryFled, aiMem.rows(),
                                 aiMem.writes(), aiMem.coalesced(),
                                 aiMem.evictions(), aiMem.resident_bytes());
                    // THE HISTOGRAM IS THE ACCEPTANCE NUMBER, not own_ai alone.
                    // [problems.md] §27's diagnosis is that the crowd's argmax is a
                    // pure function of (faction, id) and therefore CONSTANT IN
                    // TIME; a histogram that moves between two of these lines is
                    // the evidence that the scorer became a decision. Printed on
                    // the same 60-tick cadence so a --shot harness can diff two.
                    char intents[256];
                    int at = 0;
                    for (std::uint8_t i = 0; i < game::kIntentCount; ++i) {
                        if (aiTick.byIntent[i] == 0) continue;
                        at += std::snprintf(intents + at,
                                            sizeof(intents) - static_cast<std::size_t>(at),
                                            " %s=%u", game::kIntentName[i],
                                            aiTick.byIntent[i]);
                        if (at >= static_cast<int>(sizeof(intents)) - 1) break;
                    }
                    std::fprintf(stderr, "[aimem] INTENT tick=%llu%s\n",
                                 static_cast<unsigned long long>(simTick), intents);
                }
                controller_step(reg, kSimDt, &activeWorld.gravity());
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
                    // PRINT THE NUMBER EVERY RUN ([AGENTS.md] §Measure). The central
                    // crisis mechanic printed NOTHING to stderr — not a phase change,
                    // not a variant, not the count — so "did a samosbor happen in that
                    // run?" was unanswerable outside the HUD, and every claim about the
                    // clock (including the two silent defects fixed at the ride sites)
                    // had to be argued from the source instead of read off a log. One
                    // line per TRANSITION, not per tick: transitions are rare by design
                    // (>= 45 s apart at the floor), so this cannot flood.
                    if (tr_.warningBegan || tr_.activeBegan || tr_.activeEnded ||
                        tr_.cycleEnded) {
                        std::fprintf(stderr,
                                     "[samosbor] tick=%llu floor=%d phase=%u variant=%u "
                                     "count=%u cycles=%u %s%s%s%s\n",
                                     static_cast<unsigned long long>(simTick),
                                     currentFloor,
                                     static_cast<unsigned>(samosbor.phase),
                                     static_cast<unsigned>(samosbor.variant),
                                     static_cast<unsigned>(samosbor.count),
                                     static_cast<unsigned>(samosborCycles),
                                     tr_.warningBegan ? "WARNING " : "",
                                     tr_.activeBegan ? "ACTIVE " : "",
                                     tr_.activeEnded ? "ENDED " : "",
                                     tr_.cycleEnded ? "CYCLE " : "");
                    }
                    const std::uint8_t floorDanger = static_cast<std::uint8_t>(
                        currentSpec ? game::danger_for_hostility(currentSpec->hostility) : 1);
                    const game::FogTickReport fogReport = game::samosbor_fog_tick(
                        reg, stack.layer(activeLayer), samosbor, tr_, activeLayer,
                        player, currentFloor, floorDanger, simTick);
                    if (fogReport.spawned > 0 || fogReport.despawned > 0) {
                        std::fprintf(stderr,
                                     "[fog] tick=%llu floor=%d spawned=%u despawned=%u living_fog=%u\n",
                                     static_cast<unsigned long long>(simTick),
                                     currentFloor, fogReport.spawned, fogReport.despawned,
                                     game::count_layer_fog_mobs(reg, activeLayer));
                    }
                    // The seal is ONE SHOT, not a per-tick drain. Modelled as a DoT a
                    // 15-minute samosbor at |z|=50 would deal 3600 damage instead of
                    // 4 — the correction that mattered most in the port.
                    if (tr_.sealed && reg.valid(player)) {
                        const auto& meTr = reg.get<const Transform>(player);
                        const int pcx = wrap_macro(static_cast<int>(std::floor(meTr.pos.x / kCellSize)));
                        const int pcy = wrap_macro(static_cast<int>(std::floor(meTr.pos.y / kCellSize)));
                        const int pcz = wrap_macro(static_cast<int>(std::floor(meTr.pos.z / kCellSize)));
                        bool playerSheltered = false;
                        for (const auto& d : doors.doors) {
                            if (d.hermetic && d.hp > 0 &&
                                (d.state == static_cast<std::uint8_t>(game::DoorState::Shut) ||
                                 d.state == static_cast<std::uint8_t>(game::DoorState::Locked))) {
                                const int dx = wrap_delta(pcx, static_cast<int>(d.cx), kMacroDim);
                                const int dy = wrap_delta(pcy, static_cast<int>(d.cy), kMacroDim);
                                const int dz = wrap_delta(pcz, static_cast<int>(d.cz), kMacroDim);
                                if (dx * dx + dy * dy + dz * dz <= 16) {
                                    playerSheltered = true;
                                    break;
                                }
                            }
                        }
                        if (!playerSheltered) {
                            const game::SamosborPressure sp =
                                game::samosbor_unsheltered_pressure(
                                    static_cast<game::SamosborVariant>(samosbor.variant));
                            const game::DamageResult dr_ = game::apply_damage(
                                reg, pool, player, sp.hpDamage,
                                game::kAttritionChannel, player);
                            samosborDamage =
                                static_cast<std::int16_t>(samosborDamage + dr_.applied);
                            if (auto* rpg = reg.try_get<game::RpgStats>(player)) {
                                if (sp.psiDamage > 0) {
                                    rpg->psi = rpg->psi > static_cast<std::uint16_t>(sp.psiDamage)
                                                   ? static_cast<std::uint16_t>(rpg->psi - sp.psiDamage)
                                                   : 0u;
                                }
                            }
                        }
                    }
                    // Continuous Active-phase fog pressure on ALL embodied NPC
                    // bodies — not just the player. Each unsheltered body
                    // accumulates 0.5 HP/s (+ variant drain) via Needs::hpDebt,
                    // spilled unmitigated through kAttritionChannel. The one-shot
                    // seal cost above stays exactly as authored (4 HP, player
                    // only). [samosbor.h samosbor_environmental_step]
                    game::samosbor_environmental_step(
                        reg, pool, doors, activeLayer, samosbor, kSimDt, &playerStatus);
                }
                // Exhaustion costs movement speed, not HP — three stacking HP
                // drains is a death spiral with no decision in it. Applied to the
                // live Controller each tick rather than baked into it, so recovering
                // sleep restores the speed with nothing to remember. [needs.h]
                // Status content layer: age slots, then fold move mult into the
                // Controller before controller_step's writers are overridden next
                // tick. Root forces moveSpeed 0 (Paupsina leading window).
                // Needs exhaustion and status multiply — both bite.
                if (reg.valid(player)) {
                    const std::uint32_t dtMs =
                        static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f);
                    game::status_step(playerStatus, dtMs);
                    if (auto* ctl_ = reg.try_get<Controller>(player)) {
                        float sm = game::status_move_mult_e3(playerStatus) / 1000.0f;
                        if (game::status_is_rooted(playerStatus))
                            sm = 0.0f;
                        // ENCUMBRANCE joins the SAME chain as hunger, exhaustion
                        // and status rather than becoming a second writer of
                        // moveSpeed — one place folds every movement multiplier
                        // together, which is the only reason they cannot fight.
                        ctl_->moveSpeed = kPlayerWalkSpeed * needs.speedScale * sm *
                                          encumbrance.playerEffect.speedScale;
                        // AGIMV: AGI multiplies walk speed (linear +1%/pt).
                        if (const game::RpgStats* rs =
                                reg.try_get<game::RpgStats>(player)) {
                            ctl_->moveSpeed *=
                                game::agi_move_speed_mult_e3(*rs) / 1000.0f;
                        }
                    }
                    // Periodic proof trail while anything is up.
                    if (lastStatusLogTick != simTick && (simTick % 60u) == 0u) {
                        const bool any =
                            game::status_active(playerStatus,
                                                game::StatusId::ZhelemishSkin) ||
                            game::status_active(playerStatus,
                                                game::StatusId::PaupsinaWeb) ||
                            game::status_active(playerStatus,
                                                game::StatusId::SporeHaze) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakRelief) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakCough) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakDebt);
                        if (any) {
                            lastStatusLogTick = simTick;
                            std::fprintf(
                                stderr,
                                "[status] tick move_e3=%u aim_e3=%u melee_e3=%u "
                                "rooted=%d zh=%u web=%u spore=%u\n",
                                game::status_move_mult_e3(playerStatus),
                                game::status_aim_mult_e3(playerStatus),
                                game::status_melee_mult_e3(playerStatus),
                                game::status_is_rooted(playerStatus) ? 1 : 0,
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::ZhelemishSkin)],
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::PaupsinaWeb)],
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::SporeHaze)]);
                        }
                    }
                }
                if (shotPath) {
                    if (shotOrbit && reg.valid(player)) {
                        auto& cam = reg.get<CameraTag>(player);
                        cam.yaw += 0.015f;
                    }
                    // attack stays held every tick (like LMB); interact is
                    // one-shot-per-tick like E. save/load fire ONCE after all
                    // --ride hops have landed so the snapshot is the deep floor,
                    // not the hub. shotFramesSeen is presented-frame count and
                    // lags sim ticks; rides fire at presented % 420 == 0.
                    if (shotAction == "rpgcmbt" && reg.valid(player)) {
                        // RPGCMBT-SHOT: force a loud sheet so scaled melee
                        // is visible in stderr + HUD (random_rpg is modest).
                        static bool rpgcmbtSheet = false;
                        if (!rpgcmbtSheet) {
                            game::RpgStats sheet = game::fresh_rpg(10);
                            sheet.attr[0] = 20;  // STR
                            sheet.attr[1] = 20;  // AGI
                            sheet.attr[2] = 5;   // INT
                            sheet.attrPoints = 3;
                            sheet.psi = game::max_psi(sheet);
                            reg.emplace_or_replace<game::RpgStats>(player,
                                                                   sheet);
                            // Credit STR max-HP onto the pool row.
                            if (const game::NpcRef* nr =
                                    reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const std::int16_t mh =
                                        static_cast<std::int16_t>(
                                            game::max_hp(sheet));
                                    pool.max_hp(nr->id) = mh;
                                    if (pool.hp(nr->id) < mh)
                                        pool.hp(nr->id) = mh;
                                }
                            }
                            rpgcmbtSheet = true;
                            std::fprintf(stderr,
                                         "[rpgcmbt] forced sheet "
                                         "lvl=%u str=%u agi=%u int=%u\n",
                                         sheet.level, sheet.attr[0],
                                         sheet.attr[1], sheet.attr[2]);
                        }
                        // Hold attack every tick (same as wall/attack).
                        attackHeld = true;
                    } else if (shotAction == "mag" && reg.valid(player)) {
                        // MAGSHOT: live proof that PlayerRanged.magCount survives
                        // elevator body-swap under --shot --ride. Unit pin owns the
                        // pure seam (test_elevator FOR1/MAG1); this stamps a
                        // distinctive partial mag + gun so the HUD gun line and
                        // stderr can show the same count after each hop.
                        static bool magForced = false;
                        static int magLastRideLog = -1;
                        static std::uint16_t magStamp = 7;
                        static game::ItemId magGun = game::kInvalidItem;
                        if (!magForced) {
                            game::ItemId gun = game::kInvalidItem;
                            for (game::ItemId i = 1; i <= game::kItemCount; ++i) {
                                if (const game::RangedDef* d =
                                        game::ranged_for_item(i)) {
                                    if (d->pellets == 1 && d->magazine >= 8 &&
                                        d->dmg >= 20) {
                                        gun = i;
                                        break;
                                    }
                                }
                            }
                            if (gun == game::kInvalidItem) {
                                std::fprintf(stderr, "[mag] FORCE FAIL no gun\n");
                                magForced = true;
                            } else if (const game::NpcRef* nr =
                                           reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const game::RangedDef& def =
                                        *game::ranged_for_item(gun);
                                    game::Inventory& inv = pool.inventory(nr->id);
                                    inv.slots[0] = game::ItemSlot{gun, 1};
                                    inv.slots[1] = game::ItemSlot{def.ammo, 30};
                                    game::PlayerRanged pr{};
                                    pr.cooldownMs = 0;
                                    pr.reloadMs = 0;
                                    pr.magCount = magStamp;
                                    pr.weapon = gun;
                                    pr.shots = 42;
                                    pr.hits = 13;
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, pr);
                                    magGun = gun;
                                    magForced = true;
                                    std::fprintf(stderr,
                                                 "[mag] FORCE gun=%u name=%s "
                                                 "mag=%u/%u shots=%u hits=%u\n",
                                                 static_cast<unsigned>(gun),
                                                 game::item_name(gun),
                                                 static_cast<unsigned>(pr.magCount),
                                                 static_cast<unsigned>(def.magazine),
                                                 pr.shots, pr.hits);
                                }
                            }
                        }
                        // Log once per completed ride (and once at force with done=0).
                        if (magForced && shotRideDone != magLastRideLog) {
                            magLastRideLog = shotRideDone;
                            const game::PlayerRanged* pr =
                                reg.try_get<game::PlayerRanged>(player);
                            const unsigned mag =
                                pr ? static_cast<unsigned>(pr->magCount) : 0u;
                            const unsigned wpn =
                                pr ? static_cast<unsigned>(pr->weapon) : 0u;
                            const unsigned sh = pr ? pr->shots : 0u;
                            const unsigned hi = pr ? pr->hits : 0u;
                            const int ok =
                                (pr && pr->magCount == magStamp &&
                                 pr->weapon == magGun && pr->shots == 42u &&
                                 pr->hits == 13u)
                                    ? 1
                                    : 0;
                            std::fprintf(stderr,
                                         "[mag] RIDE done=%d has=%d mag=%u "
                                         "weapon=%u shots=%u hits=%u ok=%d\n",
                                         shotRideDone, pr ? 1 : 0, mag, wpn, sh,
                                         hi, ok);
                        }
                    } else if (shotAction == "attack") {
                        attackHeld = true;
                    } else if (shotAction == "interact") {
                        interactWanted = true;
                    } else if (shotAction == "grenade" && reg.valid(player) &&
                               shotFramesSeen >= 30) {
                        // GRENSHOT — the live half of the grenade proof, and the one
                        // reading that cannot be argued with from a comment: the
                        // player throws AT HIS OWN FEET and the log has to show his
                        // own HP going down.
                        //
                        // Automates the stock and the aim only. The throw runs through
                        // the real `player_throw_step`, the flight and the blast
                        // through the real `projectile_step`, and the hole through the
                        // real `carve_sphere` — the [carve] COMBAT line a few hundred
                        // lines down prints it.
                        static bool grenForced = false;
                        static bool grenThrown = false;
                        static std::int16_t grenHpBefore = 0;
                        if (!grenForced) {
                            game::ItemId gid = game::kInvalidItem;
                            for (game::ItemId i = 1; i <= game::kItemCount; ++i)
                                if (const game::RangedDef* d =
                                        game::ranged_for_item(i))
                                    if (game::ranged_is_explosive(*d) &&
                                        game::ranged_is_thrown(i)) { gid = i; break; }
                            if (gid == game::kInvalidItem) {
                                std::fprintf(stderr, "[gren] FORCE FAIL no throwable\n");
                                grenForced = true;
                            } else if (const game::NpcRef* nrg =
                                           reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nrg->id)) {
                                    const game::RangedDef& gd =
                                        *game::ranged_for_item(gid);
                                    pool.inventory(nrg->id).slots[0] =
                                        game::ItemSlot{gid, 3};
                                    grenForced = true;
                                    std::fprintf(
                                        stderr,
                                        "[gren] FORCE item=%u name=%s dmg=%u "
                                        "blast=%.1f m fuse=%.1f s\n",
                                        static_cast<unsigned>(gid),
                                        game::item_name(gid),
                                        static_cast<unsigned>(gd.dmg),
                                        gd.blastDm * 0.1f, gd.fuseDs * 0.1f);
                                }
                            }
                        }
                        if (grenForced && !grenThrown) {
                            // Look down. "Кидай и прячься" without the second half.
                            auto& gcam = reg.get<CameraTag>(player);
                            gcam.pitch = -1.5f;
                            std::int16_t mx = 0;
                            game::entity_health(reg, pool, player, grenHpBefore, mx);
                            throwWanted = true;
                            grenThrown = true;
                            std::fprintf(stderr,
                                         "[gren] THROW at own feet, hp before=%d/%d\n",
                                         grenHpBefore, mx);
                        } else if (grenThrown) {
                            // One line per frame until the fuse ends it, so the drop
                            // is visible as a NUMBER and at a readable moment.
                            std::int16_t hp = 0, mx = 0;
                            static bool grenReported = false;
                            if (!grenReported &&
                                game::entity_health(reg, pool, player, hp, mx) &&
                                hp < grenHpBefore) {
                                grenReported = true;
                                std::fprintf(
                                    stderr,
                                    "[gren] OWN BLAST hp %d -> %d (took %d) — "
                                    "осколки бьют и владельца\n",
                                    grenHpBefore, hp,
                                    static_cast<int>(grenHpBefore - hp));
                            }
                        }
                    } else if (shotAction == "corp" && reg.valid(player) &&
                               shotFramesSeen >= 30) {
                        // CORPSHOT: face nearest live mob, hold attack
                        // (real player_melee_step), then once a Corpse is in
                        // loot reach press E (real loot_corpse_interact).
                        // Automates facing/phase only — no fake loot path.
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        bool corpseNear = false;
                        for (auto cEnt :
                             reg.view<const game::Corpse, const Transform>()) {
                            if (reg.get<const Transform>(cEnt).layer !=
                                activeLayer)
                                continue;
                            const vec3& cpos =
                                reg.get<const Transform>(cEnt).pos;
                            const float dx =
                                wrap_delta_f(ppos.x, cpos.x, kWorldExtent);
                            const float dy = ppos.y - cpos.y;
                            const float dz =
                                wrap_delta_f(ppos.z, cpos.z, kWorldExtent);
                            if (dx * dx + dy * dy + dz * dz < 2.2f * 2.2f) {
                                corpseNear = true;
                                break;
                            }
                        }
                        // One real E press after the kill. Holding interact every
                        // tick re-fires loot_corpse_interact on an empty searched
                        // corpse and floods stderr with TAKEN 0 ITEMS.
                        if (corpseNear && !shotActionConsumed) {
                            interactWanted = true;
                            std::fprintf(stderr,
                                         "[corp] corpse in reach — "
                                         "interact\n");
                            shotActionConsumed = true;
                        } else if (!corpseNear) {
                            Entity bestMob = entt::null;
                            float bestD2 = 1.0e12f;
                            vec3 bestPos{};
                            for (auto me :
                                 reg.view<const game::MobRef,
                                          const Transform>()) {
                                if (reg.all_of<game::Dead>(me)) continue;
                                const Transform& tr =
                                    reg.get<const Transform>(me);
                                if (tr.layer != activeLayer) continue;
                                const float dx = wrap_delta_f(
                                    ppos.x, tr.pos.x, kWorldExtent);
                                const float dy = ppos.y - tr.pos.y;
                                const float dz = wrap_delta_f(
                                    ppos.z, tr.pos.z, kWorldExtent);
                                const float d2 =
                                    dx * dx + dy * dy + dz * dz;
                                if (d2 < bestD2) {
                                    bestD2 = d2;
                                    bestMob = me;
                                    bestPos = tr.pos;
                                }
                            }
                            if (bestMob != entt::null) {
                                auto& cam = reg.get<CameraTag>(player);
                                const float dx = wrap_delta_f(
                                    ppos.x, bestPos.x, kWorldExtent);
                                const float dz = wrap_delta_f(
                                    ppos.z, bestPos.z, kWorldExtent);
                                cam.yaw = std::atan2(dx, dz);
                                cam.pitch = -0.15f;
                                if (bestD2 > 1.5f * 1.5f) {
                                    if (auto* ctl =
                                            reg.try_get<Controller>(player)) {
                                        const float len =
                                            std::sqrt(bestD2);
                                        if (len > 1e-3f) {
                                            ctl->wishDir = vec3{
                                                dx / len, 0.0f, dz / len};
                                        }
                                    }
                                }
                                attackHeld = true;
                                static int corpAtkLog = 0;
                                if ((corpAtkLog++ % 120) == 0) {
                                    std::fprintf(
                                        stderr,
                                        "[corp] attack mob d=%.2f "
                                        "floor=%d\n",
                                        std::sqrt(bestD2), currentFloor);
                                }
                            } else if ((simTick % 240u) == 0u) {
                                std::fprintf(stderr,
                                             "[corp] no live mob on layer "
                                             "(floor %d)\n",
                                             currentFloor);
                            }
                        }
                    } else if (shotAction == "wall" && reg.valid(player) &&
                               shotFramesSeen >= 30 && !doors.frozen) {
                        // Face+walk owned by early block (post-input.apply,
                        // pre-controller_step). Here: hold melee + log only.
                        attackHeld = true;
                        static int wallLog = 0;
                        if ((wallLog++ % 120) == 0) {
                            const Transform& ptr = reg.get<Transform>(player);
                            const MacroGrid& g =
                                stack.layer(activeLayer).grid();
                            const float cx = ptr.pos.x;
                            const float cy = ptr.pos.y;
                            const float cz = ptr.pos.z;
                            const float eyeZ = cz + 0.7f;
                            float bestD2 = 1.0e12f;
                            for (int pass = 0; pass < 2 && bestD2 >= 1.0e12f;
                                 ++pass) {
                                const float sampleZ =
                                    pass == 0 ? eyeZ : (eyeZ - kCellSize);
                                const int gz =
                                    static_cast<int>(sampleZ / kCellSize);
                                if (gz < 0 || gz >= kMacroDim) continue;
                                for (int ox = -8; ox <= 8; ++ox) {
                                    for (int oy = -8; oy <= 8; ++oy) {
                                        if (ox == 0 && oy == 0) continue;
                                        const float px =
                                            cx + static_cast<float>(ox) *
                                                     kCellSize;
                                        const float py =
                                            cy + static_cast<float>(oy) *
                                                     kCellSize;
                                        const int gx = wrap_macro(
                                            static_cast<int>(px / kCellSize));
                                        const int gy = wrap_macro(
                                            static_cast<int>(py / kCellSize));
                                        if (g.cell(gx, gy, wrap_macro(gz)) ==
                                            kCellAir)
                                            continue;
                                        const float dx = wrap_delta_f(
                                            cx, px, kWorldExtent);
                                        const float dy = wrap_delta_f(
                                            cy, py, kWorldExtent);
                                        const float d2 = dx * dx + dy * dy;
                                        if (d2 < bestD2) bestD2 = d2;
                                    }
                                }
                            }
                            const bool fly =
                                reg.all_of<Controller>(player)
                                    ? reg.get<Controller>(player).fly
                                    : false;
                            std::fprintf(
                                stderr,
                                "[wall] melee toward solid d=%.2f "
                                "floor=%d frozen=%d fly=%d\n",
                                bestD2 < 1.0e12f ? std::sqrt(bestD2)
                                                 : -1.0f,
                                currentFloor,
                                doors.frozen ? 1 : 0, fly ? 1 : 0);
                        }
                    } else if (!shotActionConsumed && shotAction == "carve" &&

                               shotFramesSeen >= 30 && !doors.frozen) {
                        // One demolition charge ahead of the camera, once the
                        // nav bake has landed — the same request path the
                        // console `carve` row sets, so the screenshot
                        // exercises the real seam ([world/destruct.h]).
                        consoleCtx.carveRadius = 1.5f;
                        consoleCtx.carvePower = 0xFFFF;
                        shotActionConsumed = true;
                    } else if (!shotActionConsumed && shotAction == "status" &&

                               shotFramesSeen >= 30) {
                        // STATUS proof: land two authored rows so move_e3 drops
                        // below 1000 and rooted becomes true for Paupsina's
                        // leading window. Real status_apply path, not a mock.
                        game::status_apply(playerStatus,
                                           game::StatusId::ZhelemishSkin,
                                           /*useAlt=*/false);
                        game::status_apply(playerStatus,
                                           game::StatusId::PaupsinaWeb,
                                           /*useAlt=*/false);
                        std::fprintf(
                            stderr,
                            "[status] APPLY zh+web move_e3=%u rooted=%d "
                            "zh_ms=%u web_ms=%u\n",
                            game::status_move_mult_e3(playerStatus),
                            game::status_is_rooted(playerStatus) ? 1 : 0,
                            playerStatus.remainMs[static_cast<std::size_t>(
                                game::StatusId::ZhelemishSkin)],
                            playerStatus.remainMs[static_cast<std::size_t>(
                                game::StatusId::PaupsinaWeb)]);
                        shotActionConsumed = true;
                    } else if (!shotActionConsumed &&
                               (shotAction == "save" || shotAction == "load") &&
                               shotRideDone >= shotRide &&
                               shotFramesSeen >= 30) {
                        // Wait for async nav bake so loadWanted is not stuck
                        if (shotAction == "save") {
                            saveWanted = true;
                            shotActionConsumed = true;
                        } else if (!nav.baking()) {
                            loadWanted = true;
                            shotActionConsumed = true;
                        }
                    }
                }
                // Patrol BEFORE wander, and the order is the arbitration: patrol
                // claims its bodies (MotionOwner::Ai) and wander's ai_owns_motion
                // guard then skips them — one Velocity writer per body per tick.
                // Runs on the same baked nav wander reads; while the bake is in
                // flight the flow is empty and patrol bodies wander like everyone.
                game::ai_patrol_step(reg, nav.coarse(), nav.fine(), activeLayer,
                                     kSimDt, &activeWorld.gravity());
                game::wander_step(reg, stack.layer(activeLayer).grid(), pool,
                                  nav.coarse(),
                                  nav.fine(), activeLayer, simTick,
                                  &activeWorld.gravity());

                // Footstep noise generation while walking or running.
                // "Walking" is speed ACROSS the floor, so the vertical component is
                // stripped using the layer's gravity vector, never a hardcoded axis
                // ([AGENTS.md]: gravity is a vector). The old x^2+z^2 sum counted
                // falling as footsteps and left motion along one real horizontal
                // axis completely silent — mobs simply could not hear you walk it.
                if (reg.valid(player)) {
                    const auto& vel = reg.get<Velocity>(player);
                    const vec3 pg =
                        stack.layer(activeLayer).gravity().at(reg.get<Transform>(player).pos);
                    const float pgLen = length(pg);
                    vec3 lat = vel.v;
                    if (pgLen > 1e-6f) {
                        const vec3 up = pg * (-1.0f / pgLen);
                        lat = lat - up * dot(lat, up);
                    }
                    const float speedSq = dot(lat, lat);
                    if (speedSq > 0.5f && (simTick % 28 == 0)) {
                        const vec3& ppos = reg.get<Transform>(player).pos;
                        // A LOADED BODY IS LOUDER. Not a penalty rule — it is what
                        // carrying things sounds like, so it is charged from the
                        // first gram and scales with the load RATIO ([encumbrance.h]
                        // kNoiseLoadGain), never with raw kilogrammes: a strong
                        // character must not be punished for the bigger budget its
                        // Strength bought.
                        game::NoiseProfile footstepNoise{
                            6.0f * encumbrance.playerEffect.noiseMult, 400, 1,
                            game::NoiseSource::Footstep};
                        game::noise_publish(noiseField, activeLayer, ppos, footstepNoise,
                                            static_cast<std::uint32_t>(entt::to_integral(player)));
                    }
                }

                // Crowd NPCs also generate footstep noise when walking/running,
                // staggered across 28 ticks so active noise is heard by Duty/Guards/monsters.
                for (auto ce : reg.view<const Velocity, const Transform, const game::NpcRef>()) {
                    if (ce == player) continue;
                    if ((simTick + static_cast<std::uint64_t>(entt::to_integral(ce))) % 28 != 0) continue;
                    const auto& tr = reg.get<const Transform>(ce);
                    if (tr.layer != activeLayer) continue;
                    const auto& vel = reg.get<const Velocity>(ce);
                    const vec3 pg = stack.layer(activeLayer).gravity().at(tr.pos);
                    const float pgLen = length(pg);
                    vec3 lat = vel.v;
                    if (pgLen > 1e-6f) {
                        const vec3 up = pg * (-1.0f / pgLen);
                        lat = lat - up * dot(lat, up);
                    }
                    const float speedSq = dot(lat, lat);
                    if (speedSq > 0.5f) {
                        game::NoiseProfile crowdNoise{5.0f, 350, 1, game::NoiseSource::Footstep};
                        game::noise_publish(noiseField, activeLayer, tr.pos, crowdNoise,
                                            static_cast<std::uint32_t>(entt::to_integral(ce)));
                    }
                }

                // Sound overrides sight's absence: a mob with no visible prey that
                // heard something recently walks at the sound instead of at a random
                // lattice node. Purely additive on top of wander_step and it returns
                // before touching an entity when the field is quiet, which is almost
                // every tick. [investigate.h]
                heardMobs = game::investigate_step(reg, noiseField, pool, activeLayer, simTick);

                // --- PER-TICK SPECIAL MONSTER TRAITS & ABILITIES ---
                const float* fluidData = giga::fluid_data(stack.layer(activeLayer));
                for (auto me_ : reg.view<game::MobRef, Transform, Velocity>()) {
                    Transform& tr = reg.get<Transform>(me_);
                    if (tr.layer != activeLayer) continue;
                    game::MobRef& mr = reg.get<game::MobRef>(me_);
                    const auto kind = static_cast<game::MobKind>(mr.kind);
                    const bool wet = game::pos_wet(fluidData, tr.pos);

                    // Trait movement pace multiplier (wet/dry terrain adaptation)
                    const float moveMult = game::trait_move_mult(mr.kind, wet);
                    if (moveMult != 1.0f) {
                        Velocity& vel = reg.get<Velocity>(me_);
                        vel.v.x *= moveMult;
                        vel.v.y *= moveMult;
                    }

                    // 1. Wet Regeneration (Lotochnik, etc.)
                    const float regenRate = game::trait_wet_regen_hps(mr.kind);
                    if (regenRate > 0.0f && (simTick % 16 == 0)) {
                        if (wet) {
                            mr.hp = std::min<std::int16_t>(mr.maxHp, mr.hp + static_cast<std::int16_t>(regenRate * 0.13f + 0.5f));
                        }
                    }

                    // 2. Lampoglaz Flash Blinding Ability
                    if (kind == game::MobKind::Lampoglaz) {
                        if ((simTick + entt::to_integral(me_)) % 250 == 0) {

                            game::NoiseProfile flashNoise{14.0f, 1800, 2, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, tr.pos, flashNoise, static_cast<std::uint32_t>(entt::to_integral(me_)));
                            if (reg.valid(player)) {
                                const vec3& ppos = reg.get<Transform>(player).pos;
                                float dx = wrap_delta_f(tr.pos.x, ppos.x, kWorldExtent);
                                float dy = tr.pos.y - ppos.y;
                                float dz = wrap_delta_f(tr.pos.z, ppos.z, kWorldExtent);
                                if (dx*dx + dy*dy + dz*dz < 14.0f * 14.0f) {
                                    game::apply_slow(reg, player, 0.40f, 1200);
                                }
                            }
                        }
                    }

                    // 3. SporeCarpet / Meat-Spore Acid Cloud Hazard Pass
                    if (kind == game::MobKind::SporeCarpet) {
                        if ((simTick + entt::to_integral(me_)) % 40 == 0) {

                            if (reg.valid(player)) {
                                const vec3& ppos = reg.get<Transform>(player).pos;
                                float dx = wrap_delta_f(tr.pos.x, ppos.x, kWorldExtent);
                                float dy = tr.pos.y - ppos.y;
                                float dz = wrap_delta_f(tr.pos.z, ppos.z, kWorldExtent);
                                if (dx*dx + dy*dy + dz*dz < 2.15f * 2.15f) {
                                    game::apply_damage(reg, pool, player, 4, game::DamageChannel::Fire, me_, &activeGrid);
                                    // Content layer: SporeHaze. Gate = ip4_gasmask
                                    // present in inventory (alt column shortens).
                                    bool hasGasmask = false;
                                    if (const auto* nr =
                                            reg.try_get<game::NpcRef>(player)) {
                                        if (pool.valid(nr->id)) {
                                            const game::Inventory& inv =
                                                pool.inventory(nr->id);
                                            const game::ItemId gate =
                                                game::status_def(
                                                    game::StatusId::SporeHaze)
                                                    .gateItem;
                                            if (gate != 0) {
                                                for (const auto& sl : inv.slots) {
                                                    if (sl.item == gate) {
                                                        hasGasmask = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    game::status_apply(playerStatus,
                                                       game::StatusId::SporeHaze,
                                                       hasGasmask);
                                }
                            }
                        }
                    }

                    // 4. Stalker / TonkayaTen Cloaking Tint Modulation.
                    // The tell is LATERAL movement, so the vertical component comes
                    // off via the gravity vector rather than a fixed axis. With the
                    // old x^2+z^2 a Ten drifting along one real horizontal axis read
                    // as motionless and stayed cloaked — the player's counterplay
                    // (spot it while it moves) silently did not exist on that axis.
                    if (kind == game::MobKind::TonkayaTen || kind == game::MobKind::GlubinnayaTen) {
                        if (Renderable* rend = reg.try_get<Renderable>(me_)) {
                            const Velocity& vel = reg.get<Velocity>(me_);
                            const vec3 tg =
                                stack.layer(activeLayer).gravity().at(reg.get<Transform>(me_).pos);
                            const float tgLen = length(tg);
                            vec3 tlat = vel.v;
                            if (tgLen > 1e-6f) {
                                const vec3 tup = tg * (-1.0f / tgLen);
                                tlat = tlat - tup * dot(tlat, tup);
                            }
                            const float spd = std::sqrt(dot(tlat, tlat));
                            const float alpha = (spd > 0.5f) ? 0.85f : 0.15f;
                            rend->color = vec3{0.20f * alpha, 0.30f * alpha, 0.40f * alpha};

                        }
                    }


                }
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
                                                    simTick, &activeWorld.gravity(),
                                                    &aiMem, simNow);
                // Slowed CAP enforcement: after every velocity writer
                // (controller / wander / investigate / feud), before integrate.
                // Was defined in combat.cpp and never called — dead path until now.
                game::slow_step(reg, activeLayer, kSimDt);
                physics_step(reg, stack, kSimDt);
                // The universal impact law, straight after the sweep that wrote
                // the reports: damage = k*m*v^2/2 over Mass — fall damage and
                // prop crashes with no per-cause constants ([game/impact.h]).
                game::impact_damage_step(reg, pool, &particleBursts);
                // Prop ragdoll settle (AngularVelocity damping bookkeeping).
                // Angular integration itself is in physics_step. [jirnyak.md] §18
                game::prop_ragdoll_step(reg, kSimDt);
                // Doors resolve AFTER physics for the same reason melee does: contact
                // is tested by ADJACENCY against where bodies actually ended up this
                // step, not where they intended to go. Costs nothing while no door is
                // shut — door_step early-outs on doors.shut == 0. [door.h]
                doorTick = game::door_step(reg, stack.layer(activeLayer), doors,
                                           activeLayer, kSimDt, simTick);
                // Door VFX: debris + noise on monster break / force-open.
                // doorTick carries the world pos of the last event this tick.
                if (doorTick.broken > 0) {
                    // Loud crash — audible across a wide radius
                    game::NoiseProfile np{18.0f, 3500, 4,
                                           game::NoiseSource::Door};
                    game::noise_publish(noiseField, activeLayer,
                                        doorTick.lastBreakPos, np, 0);
                }
                if (doorTick.opened > 0) {
                    game::NoiseProfile np{8.0f, 800, 2,
                                           game::NoiseSource::Door};
                    game::noise_publish(noiseField, activeLayer,
                                        doorTick.lastOpenPos, np, 0);
                }
                // Q, consumed once. The player works a door with a keypress; leaning
                // on one is how MONSTERS open it, and door_step skips the camera
                // holder precisely so the two cannot be confused.
                if (doorWanted) {
                    doorWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        const game::Inventory* pInv = nullptr;
                        if (const auto* nr = reg.try_get<game::NpcRef>(player)) {
                            if (pool.valid(nr->id)) pInv = &pool.inventory(nr->id);
                        }
                        std::uint32_t toggled = game::door_toggle_near(
                            stack.layer(activeLayer), doors, reg,
                            activeLayer, ppos, pInv);
                        if (toggled != game::kNoDoor) {
                            // Reconstruct door world position for particle/sound
                            const game::Door& d = doors.doors[toggled];
                            vec3 doorPos{
                                (static_cast<float>(d.cx) + 0.5f) * kCellSize,
                                (static_cast<float>(d.cy) + 0.5f) * kCellSize,
                                (static_cast<float>(d.cz) +
                                 static_cast<float>(d.h) * 0.5f) * kCellSize};

                            // Slam noise so mobs hear it
                            game::NoiseProfile np{10.0f, 1200, 2,
                                                   game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer,
                                                doorPos, np, 0);
                        }
                    }
                }
                // Universal destruction ([world/destruct.h]): the console/tools
                // PROPOSED a sphere; the sim disposes here, on its own clock,
                // and never while a nav bake owns the grid — the same freeze
                // doors honour, and the request stays queued (not dropped)
                // until the bake lands. Collision is live off the mutated
                // masks; every baked overlay's debt is exactly
                // carveResult.dirtyCells, and nav stays stale until the next
                // full bake — the accepted door.cpp debt, no new rule.
                if (consoleCtx.carveRadius > 0.0f && !doors.frozen &&
                    reg.valid(player)) {
                    const vec3 ppos = reg.get<Transform>(player).pos;
                    const auto& camTag = reg.get<CameraTag>(player);
                    const vec3 fwd = camera_forward(camTag.yaw, camTag.pitch);
                    const float reach = 1.0f + consoleCtx.carveRadius;
                    CarveOp op;
                    op.x = ppos.x + fwd.x * reach;
                    op.y = ppos.y + fwd.y * reach;
                    op.z = ppos.z + fwd.z * reach;
                    op.radius = consoleCtx.carveRadius;
                    op.power =
                        static_cast<std::uint16_t>(consoleCtx.carvePower);
                    // Seed = sim tick: the op replays bit-identically from the
                    // command stream, and the next swing is a fresh roll.
                    op.seed = static_cast<std::uint32_t>(simTick);
                    consoleCtx.carveRadius = 0.0f;
                    const std::int32_t removed =
                        carve_sphere(stack.layer(activeLayer), op,
                                     carveScratch, carveResult);
                    if (removed > 0) {
                        // No log, no bookkeeping: geometry persistence is the
                        // floor's own file, written when the player leaves
                        // ([save.h] modular layout) or on F5.
                        // The GPU mirror pays only the dirty cells — the whole
                        // point of the raymarch migration.
                        voxelMirror.mark_dirty(carveResult.dirtyCells.data(),
                                               carveResult.dirtyCells.size());
                        // Dust and debris off the blast, tinted by the carved
                        // material ([particle_pass.h]).
                        spawn_carve_particles(particlePass, carveResult,
                                              op.seed);

                        // A blast is the loudest thing after gunfire: let the
                        // crowd hear it.
                        game::NoiseProfile np{18.0f, 2200, 4,
                                              game::NoiseSource::WeaponFire};
                        game::noise_publish(noiseField, activeLayer,
                                            vec3{op.x, op.y, op.z}, np, 0);
                        // Props anchored to carved cells fall / ragdoll
                        // ([jirnyak.md] §18). dirtyCells = flat macro_index.
                        // Rebuild PropPass static skin when any prop detached —
                        // otherwise the GPU still draws the old furniture pose.
                        if (game::anchor_validate_step(reg, stack.layer(activeLayer),
                                                       bus, carveResult.dirtyCells,
                                                       &particleBursts, op.seed) > 0) {
                            propPassNeedsRebuild = true;
                        }
                        // ...and the BAKED dressing answers to the same blast
                        // ([game/antourage] antourage_carve_step): severed
                        // pipes shed debris and the instance list is re-packed
                        // so the GPU stops drawing what no longer hangs.
                        if (antourage_carve_step_here(carveResult.dirtyCells,
                                                      op.seed)) {
                            propPassNeedsRebuild = true;
                            dressingSetChanged = true;
                        }
                    }

                }
                if (interactWanted) {
                    interactWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        bool handled = false;

                        // 1. Corpse loot — gate on §18 find_nearest Kind::Corpse,
                        // then specialized loot_corpse_interact backend.
                        {
                            const game::InteractionHit corpseHit =
                                game::find_nearest_interactable(
                                    reg, player, game::Interactable::Kind::Corpse,
                        game::interact_def(game::InteractKind::Corpse).reachM);
                            if (corpseHit.hit) {
                                game::CorpseLootResult clr = game::loot_corpse_interact(
                                    reg, pool, bus, activeLayer, ppos, 2.2f, simTick);
                                if (clr.foundCorpse) {
                                    handled = true;
                                    std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                  "CORPSE LOOTED: TAKEN %u ITEMS (+%d RUB)",
                                                  clr.itemsTaken, clr.roublesGained);
                                    elevDiagAt = simTick;
                                    // Headless --shot audit trail (HUD is invisible in captures).
                                    // Log once per interact edge — not every sim tick.
                                    static std::uint64_t lastCorpseLootLogTick = ~0ull;
                                    if (lastCorpseLootLogTick != simTick) {
                                        lastCorpseLootLogTick = simTick;
                                        std::fprintf(stderr,
                                                     "[corp] CORPSE LOOTED: TAKEN %u ITEMS "
                                                     "(+%d RUB) floor=%d\n",
                                                     clr.itemsTaken, clr.roublesGained,
                                                     currentFloor);
                                    }

                                    game::NoiseProfile np{6.0f, 600, 1, game::NoiseSource::Door};
                                    game::noise_publish(noiseField, activeLayer, ppos, np, 0);
                                }
                            }
                        }

                        // 2. Terminal / ControlPanel — zero-heap nearest Interactable
                        // ([jirnyak.md] §18 interaction_step / prop_interact_step). No vector collect,
                        // no fake hit when nothing is in reach.
                        if (!handled && activeLayer != kInvalidLayer) {
                            if (game::prop_interact_step(
                                    reg, player, game::Interactable::Kind::Terminal, bus)) {
                                game::InteractionHit termHit{};
                                if (game::interaction_step(
                                        reg, player, game::Interactable::Kind::Terminal,
                                        bus, &termHit)) {
                                    game::TerminalInteractResult tres =
                                        game::embody_interact_terminal(
                                            reg, stack.layer(activeLayer), doors,
                                            activeLayer, termHit.pos);
                                    if (tres.interacted) {
                                        handled = true;
                                        std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                      "ELEVATOR DIAGNOSTIC: FLOOR %d TERMINAL LINKED | DOORS %s (%u TOGGLED)",
                                                      currentFloor, tres.doorsLocked ? "LOCKED" : "UNLOCKED", tres.doorsToggled);
                                        elevDiagAt = simTick;
                                        std::fprintf(stderr, "[gameplay] Terminal/ControlPanel interact: doors %s (%u toggled) | ElecArc burst emitted at (%.1f, %.1f, %.1f)\n",
                                                     tres.doorsLocked ? "LOCKED" : "UNLOCKED", tres.doorsToggled,
                                                     tres.propPos.x, tres.propPos.y, tres.propPos.z);

                                        game::NoiseProfile np{12.0f, 2000, 3, game::NoiseSource::Door};
                                        game::noise_publish(noiseField, activeLayer, tres.propPos, np, 0);
                                    }
                                }
                            }
                        }

                        // 3. ElectricalShield sabotage — zero-heap nearest.
                        if (!handled && activeLayer != kInvalidLayer) {
                            game::InteractionHit shieldHit{};
                            if (game::interaction_step(
                                    reg, player, game::Interactable::Kind::ElectricalShield,
                                    bus, &shieldHit)) {
                                const vec3& sp = shieldHit.pos;
                                int scx = static_cast<int>(sp.x / kCellSize);
                                int scy = static_cast<int>(sp.y / kCellSize);
                                int scz = static_cast<int>(sp.z / kCellSize);
                                if (!powerGrid.is_shield_destroyed(scx, scy, scz)) {
                                    handled = true;
                                    powerGrid.destroy_shield(scx, scy, scz);
                                    std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                  "POWER GRID SABOTAGE: ELECTRICAL SHIELD DESTROYED AT (%.1f, %.1f)",
                                                  sp.x, sp.z);
                                    elevDiagAt = simTick;

                                    game::NoiseProfile np{16.0f, 2500, 3, game::NoiseSource::Door};
                                    game::noise_publish(noiseField, activeLayer, sp, np, 0);
                                }
                            }
                        }

                        // 4. LightBulb toggle / unscrew — tactical stealth
                        if (!handled && activeLayer != kInvalidLayer) {
                            game::InteractionHit bulbHit{};
                            if (game::interaction_step(
                                    reg, player, game::Interactable::Kind::LightBulb,
                                    bus, &bulbHit)) {
                                if (reg.valid(bulbHit.entity) && reg.all_of<game::Interactable>(bulbHit.entity)) {
                                    auto& ia = reg.get<game::Interactable>(bulbHit.entity);
                                    if (ia.active) {
                                        handled = true;
                                        ia.active = false;
                                        if (auto* pm = reg.try_get<game::PropMesh>(bulbHit.entity)) {
                                            pm->emissive = 0;
                                            pm->animPhase = 0;
                                        }
                                        std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                      "LIGHT BULB UNSCREWED: ZONE DARKENED FOR STEALTH");
                                        elevDiagAt = simTick;

                                        game::NoiseProfile np{3.5f, 400, 1, game::NoiseSource::Door};
                                        game::noise_publish(noiseField, activeLayer, bulbHit.pos, np, 0);
                                    }
                                }
                            }
                        }

                        // 5. Physiological relief fallback
                        if (!handled) {
                            if (const auto* nrg = reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nrg->id)) {
                                    const int pcx = wrap_macro(static_cast<int>(std::floor(ppos.x / kCellSize)));
                                    const int pcy = wrap_macro(static_cast<int>(std::floor(ppos.y / kCellSize)));
                                    const bool inBathroom = (game::room_bit_at(roomZones.kind, roomZones.number, pcx, pcy) &
                                                             game::room_bit(game::RoomBit::Bathroom)) != 0;
                                    const float maxPee = inBathroom ? game::kToiletPeeRelief : game::kFieldPeeRelief;
                                    const float maxPoo = inBathroom ? game::kToiletPooRelief : game::kFieldPooRelief;

                                    game::ReliefResult rr = game::relieve_needs(pool.needs(nrg->id), maxPee, maxPoo);
                                    if (rr.pee > 0.0f || rr.poo > 0.0f) {
                                        game::status_apply(playerStatus, game::StatusId::GovnyakRelief, false);
                                        // The puddle: urine through the same
                                        // universal stain layer blood uses when
                                        // relieving outside a dedicated bathroom.
                                        if (!inBathroom && rr.pee > 0.0f)
                                            stain_splat(stack.layer(activeLayer),
                                                        ppos, vec3{0, 0, -1.0f},
                                                        1.4f, /*rays=*/14,
                                                        kStainUrine,
                                                        static_cast<std::uint32_t>(simTick),
                                                        stainDirty);
                                        std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                      inBathroom ? "TOILET FACILITY: SANITARY RELIEF (%.0f PEE, %.0f POO)"
                                                                 : "FIELD RELIEF: PARTIAL (%.0f PEE, %.0f POO)",
                                                      rr.pee, rr.poo);
                                        elevDiagAt = simTick;

                                        game::NoiseProfile np{inBathroom ? 2.5f : 5.0f, 500, 1, game::NoiseSource::Door};
                                        game::noise_publish(noiseField, activeLayer, ppos, np, 0);
                                    }
                                }
                            }
                        }
                    }
                }
                if (possessWanted) {
                    possessWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        Entity newPlayer = possess_nearest_survivor(reg, pool, activeLayer, ppos, 8.0f);
                        if (newPlayer != entt::null) {
                            player = newPlayer;
                            // POSRPG: keep the run-local snapshots honest so a later
                            // death path / F5 save does not restore the pre-hop sheet
                            // or a stale kill tally. transfer_player_progression
                            // already stamped the components on the new body.
                            if (const auto* pm =
                                    reg.try_get<game::PlayerMelee>(player))
                                kills = pm->kills;
                            if (const auto* rs =
                                    reg.try_get<game::RpgStats>(player))
                                carriedRpg = *rs;
                            const vec3 newPos = reg.get<Transform>(player).pos;
                            const auto* nr = reg.try_get<game::NpcRef>(player);
                            const game::NpcId newId = nr ? nr->id : 0;
                            std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                          "MIND PROJECTION: POSSESSED RESIDENT BODY #%u AT (%.1f, %.1f)",
                                          newId, newPos.x, newPos.z);
                            elevDiagAt = simTick;

                            game::NoiseProfile np{15.0f, 1500, 3, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, newPos, np, 0);
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
                // Snapshot player HP before combat for damage-taken VFX.
                std::int16_t preHp = 0, preMax = 0;
                if (reg.valid(player))
                    game::entity_health(reg, pool, player, preHp, preMax);

                bool haveGun = false;
                if (reg.valid(player))
                    if (const auto* nrg = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrg->id))
                            haveGun = game::equipped_ranged(
                                          pool.inventory(nrg->id)) !=
                                      game::kInvalidItem;
                // Combat carves: clear, fill during melee/projectiles, dispose
                // same step if !doors.frozen (v1 drops proposals during bake).
                combatCarves.clear();
                shots += game::player_ranged_step(reg, pool, activeLayer,
                                                  haveGun && attackHeld && !paused,
                                                  kSimDt, simTick, &noiseField,
                                                  &playerStatus, &bus);
                // IMMEDIATELY AFTER the firearm step and never before it: the two
                // share `PlayerRanged::cooldownMs` (one pair of hands) and the step
                // above owns its single decrement ([combat.h] player_throw_step).
                // Consumed here rather than at the request site so the throw lands on
                // a sim tick like every other action, not on a frame.
                if (throwWanted) {
                    throwWanted = false;
                    if (!paused && game::player_throw_step(reg, pool, activeLayer,
                                                           true) > 0)
                        ++shots;
                }
                game::player_melee_step(
                    reg, pool, bus, activeLayer, kSimDt,
                    !haveGun && attackHeld && !paused, simTick,
                    &stack.layer(activeLayer).grid(), &combatCarves,
                    &playerStatus, &particleBursts,
                    &stack.layer(activeLayer).gravity());
                meleeHits += game::mob_attack_step(reg,
                                   stack.layer(activeLayer).grid(),
                                   pool, bus, activeLayer,
                                                   kSimDt, simTick,
                                                   &particleBursts,
                                   &stack.layer(activeLayer).gravity(),
                                   fluidData,
                                   game::samosbor_active(samosbor));
                // Fire, acid and live grates bill EVERY embodied body, not just
                // monsters. Straight after the monster sweep so both pay on the
                // same tick and the same 1-in-16 cadence. [problems.md] §41
                game::hazard_step(reg, stack.layer(activeLayer).grid(), pool,
                                  activeLayer, simTick, &particleBursts,
                                  &stack.layer(activeLayer).gravity());
                // Shots resolve AFTER the pass that launched them, so a
                // projectile never lands on the frame it is fired.
                meleeHits += game::projectile_step(
                    reg, pool, bus, stack, activeLayer, kSimDt, simTick,
                    &playerStatus, player, &combatCarves, &stainDirty,
                    &particleBursts, &noiseField);
                // Drain combat carve proposals through the same carve_sphere
                // path the console uses. Frozen bake: drop (v1); console keeps
                // pending via carveRadius until bake lands.
                if (doors.frozen && combatCarves.count > 0) {
                    combatCarves.droppedBake += combatCarves.count;
                    combatCarves.count = 0;
                }
                // Gated like every other debug channel (GIGA_*_DBG): the counters
                // are always kept, the line only prints when asked for.
                static const bool carveDbg =
                    std::getenv("GIGA_CARVE_DBG") != nullptr;
                if (carveDbg &&
                    (combatCarves.count > 0 || combatCarves.droppedFull > 0 ||
                     combatCarves.droppedDegenerate > 0 ||
                     combatCarves.droppedBake > 0 ||
                     combatCarves.clampedRadius > 0)) {
                    std::fprintf(stderr,
                                 "[carve] proposals=%u dropped_full=%u "
                                 "dropped_degen=%u dropped_bake=%u clamped=%u\n",
                                 static_cast<unsigned>(combatCarves.count),
                                 static_cast<unsigned>(combatCarves.droppedFull),
                                 static_cast<unsigned>(combatCarves.droppedDegenerate),
                                 static_cast<unsigned>(combatCarves.droppedBake),
                                 static_cast<unsigned>(combatCarves.clampedRadius));
                }
                if (!doors.frozen && combatCarves.count > 0) {
                    for (std::uint8_t ci = 0; ci < combatCarves.count; ++ci) {
                        const game::CarveProposal& pr = combatCarves.items[ci];
                        CarveOp op;
                        op.x = pr.x;
                        op.y = pr.y;
                        op.z = pr.z;
                        op.radius = pr.radius;
                        op.power = pr.power;
                        op.seed = pr.seed;
                        const std::int32_t removed =
                            carve_sphere(stack.layer(activeLayer), op,
                                         carveScratch, carveResult);
                        if (removed > 0) {
                            voxelMirror.mark_dirty(
                                carveResult.dirtyCells.data(),
                                carveResult.dirtyCells.size());
                            spawn_carve_particles(particlePass, carveResult,
                                                  pr.seed);
                            std::fprintf(stderr,
                                         "[carve] COMBAT removed=%d power=%u "
                                         "r=%.2f at (%.1f,%.1f,%.1f)\n",
                                         removed,
                                         static_cast<unsigned>(pr.power),
                                         pr.radius, pr.x, pr.y, pr.z);

                            // Detach props whose anchor cells were carved.
                            // Rebuild PropPass static skin on any detach so the
                            // GPU drops the old furniture pose. [jirnyak.md] §18
                            if (game::anchor_validate_step(
                                    reg, stack.layer(activeLayer), bus,
                                    carveResult.dirtyCells, &particleBursts,
                                    pr.seed) > 0) {
                                propPassNeedsRebuild = true;
                            }
                            // Same duty for the baked dressing.
                            if (antourage_carve_step_here(carveResult.dirtyCells,
                                                          pr.seed))
                                propPassNeedsRebuild = true;
                        }
                    }
                    combatCarves.clear();
                }
                // Severed pipes drip on a slow clock: one drop per stump
                // roughly every 0.4 s ([game/particles.h] — the "якорь мёртв
                // → эмиттер" writer). Emitters are refilled at every prop
                // merge, so a re-carved or reloaded floor stays honest.
                if ((simTick % 50u) == 0u && !dripEmitters.empty() &&
                    particlePass.ready()) {
                    static std::vector<gpu::GpuParticle> dripTmp;
                    dripTmp.clear();
                    const game::ParticleDef& dripDef =
                        game::particle_def(game::ParticleKind::Drip);
                    for (std::size_t i = 0; i < dripEmitters.size(); ++i)
                        pack_particles(dripTmp, dripEmitters[i],
                                       vec3{0.0f, 0.0f, -0.2f}, dripDef,
                                       vec3{dripDef.r, dripDef.g, dripDef.b}, 1,
                                       static_cast<std::uint32_t>(simTick) ^
                                           static_cast<std::uint32_t>(i));
                    particlePass.spawn(dripTmp.data(),
                                       static_cast<std::uint32_t>(
                                           dripTmp.size()));
                }
                // Binary diagnostic, same law as GIGA_ANTOURAGE_DEBUG: a
                // fountain 3 m ahead of the camera answers "does the pool
                // render at all" without hunting for dust. The env VALUE picks
                // the CSV row (GIGA_PARTICLE_DBG=3 → sparks, =1 → debris...),
                // so every kind can be eyeballed in isolation.
                static const char* particleDbg =
                    std::getenv("GIGA_PARTICLE_DBG");
                if (particleDbg != nullptr && (simTick % 15u) == 0u &&
                    reg.valid(player)) {
                    int dk = std::atoi(particleDbg);
                    if (dk < 0 || dk >= game::kParticleKindCount)
                        dk = static_cast<int>(game::ParticleKind::Spark);
                    const auto& camT = reg.get<CameraTag>(player);
                    const vec3 fw = camera_forward(camT.yaw, camT.pitch);
                    const vec3 pp = reg.get<Transform>(player).pos;
                    particleBursts.push(
                        vec3{pp.x + fw.x * 3.0f, pp.y + fw.y * 3.0f,
                             pp.z + 1.2f + fw.z * 3.0f},
                        vec3{0.0f, 0.0f, 1.0f},
                        static_cast<game::ParticleKind>(dk), 12,
                        kMatElectricGrate, // debris/dust tint: loud yellow
                        static_cast<std::uint32_t>(simTick));
                }
                // Drain this tick's blood/spark proposals into the GPU pool.
                drain_particle_bursts(particlePass, particleBursts);




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
                        if (aiCfg.memory) {
                            const auto* pRef = reg.try_get<game::NpcRef>(player);
                            if (pRef && pool.valid(pRef->id)) {
                                game::ai_remember_actor(aiMem, talker, game::MemAlly, pRef->id, 1.0f, simNow);
                                game::ai_remember_actor(aiMem, pRef->id, game::MemAlly, talker, 1.0f, simNow);
                            }
                        }
                    }
                }
                if (simTick - rumourAt >= game::kOverhearCooldownTicks) {
                    const game::NpcId sp = game::nearest_speaker(reg, activeLayer);
                    if (sp != game::kInvalidNpc) {
                        // Pass the LIVE samosbor clock, not the five-argument shim.
                        // The shim substitutes a default-constructed SamosborState —
                        // phase Idle, count 0 — and four of the nine rumour kinds gate
                        // on exactly those fields, so Imminent (phase Warning), Variant
                        // (phase Active), Veteran (count > 0) and Lull (a clock that has
                        // ever been armed) were unreachable in play while being fully
                        // implemented, texted and unit-tested. `samosbor` is the same
                        // object speech_context reads a dozen lines above. [rumour.h]
                        const game::Rumour ru = game::rumour_for(
                            reg, pool, sp, activeLayer, currentFloor, samosbor);
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
                // §27 legs (c)+(d): the clock now runs for EVERY embodied body on
                // the floor, and `roomZones` is the half that keeps that from being
                // a morgue — a body in a kitchen fills, a body in a bathroom
                // empties. Passing null here would reinstate the ~14-minute
                // population wipe [needs.h] blocked the widening on.
                // ENCUMBRANCE before the needs clock, because it charges the same
                // sleep bar the clock then reads for its exhaustion penalty — a
                // load taxes you on the tick you carry it, not one tick later.
                encumbrance = game::encumbrance_step(reg, pool, activeLayer, kSimDt,
                                                     simTick, &noiseField);
                // Spec 03 §4.2: Environmental gas/smoke filter degradation & battery drain.
                // 1-in-16 staggered sweep across equipped tools on active layer.
                const auto* liveGasField = activeWorld.fields().find<float>(kGasField);
                const float* liveGasRaw = liveGasField ? liveGasField->data().data() : nullptr;
                game::fouling_step(reg, pool, activeLayer, liveGasRaw, nullptr, kSimDt, simTick);
                needs = game::needs_step(reg, pool, activeLayer, kSimDt, &roomZones,
                                         &aiMem, simNow, &playerStatus, liveGasField);
                needsHpLost += needs.hpLost;
                // Closed-loop room stock production: working citizens in Production/HQ replenish floor stock
                game::room_stock_produce_step(reg, pool, activeLayer, roomZones.stock,
                                              static_cast<std::uint8_t>(kind_for_floor(currentFloor)),
                                              currentFloor, simTick);
                // The other half of the acceptance trail. `bodies` says the clock is
                // no longer a one-body clock, `recovering` says rooms are actually
                // feeding people, and `crowdDead` is the number that would climb if
                // the ambient half were ever broken again — a silent morgue is the
                // failure mode this widening had to buy its way past ([needs.h]).
                // Cadence piggybacks on the [aimem] pulse a few hundred lines up,
                // which set `lastAimemLogTick` to `simTick` earlier in THIS tick, so
                // the two lines always describe the same frame.
                crowdDead += needs.crowdKilled;
                if (aiCfg.enabled && lastAimemLogTick == simTick)
                    std::fprintf(stderr,
                                 "[needs] tick=%llu bodies=%u recovering=%u "
                                 "crowd_dead_total=%u\n",
                                 static_cast<unsigned long long>(simTick),
                                 needs.bodies, needs.recovering, crowdDead);
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
                    // The same one-law save the transition autosave uses:
                    // run.sav + the resident floor's own file. [save.h]
                    if (save_run_now())
                        std::snprintf(saveLine, sizeof(saveLine),
                                      "saved: floor %d, %u rub, %u crates",
                                      currentFloor,
                                      static_cast<unsigned>(ledger.banked),
                                      static_cast<unsigned>(runState.opened.size()));
                    else {
                        char runPath[128];
                        run_save_path(runPath, sizeof runPath);
                        std::snprintf(saveLine, sizeof(saveLine),
                                      "SAVE FAILED: could not write %s", runPath);
                    }
                    saveLineAt = simTick;
                    // Headless --shot proof: HUD is invisible in captures
                    // without a human; stderr is the audit trail. [save.h]
                    std::fprintf(stderr, "[save] %s\n", saveLine);
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
                        char runPath[128];
                        run_save_path(runPath, sizeof runPath);
                        game::SaveState in;
                        game::SaveError err = game::SaveError::None;
                        if (!read_run(in, runPath, err)) {
                            // No file and a refused file need different words: one is a
                            // first run, the other is a save the build can no longer read.
                            if (err == game::SaveError::None)
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "no save file (%s)", runPath);
                            else
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "load refused: %s",
                                              game::save_error_text(err));
                        } else if (!spec_for_floor(in.player.floorNumber)) {
                            std::snprintf(saveLine, sizeof(saveLine),
                                          "load refused: floor %d is not registered",
                                          in.player.floorNumber);
                        } else {
                            // `ledger` and `contracts` are references INTO runState, so
                            // this one assignment republishes both without touching a
                            // use site.
                            runState = in;
                            const int savedFloor = runState.player.floorNumber;
                            const std::uint8_t scx = runState.player.cx;
                            const std::uint8_t scy = runState.player.cy;
                            const std::uint8_t scz = runState.player.cz;

                            // FULL WORLD RESTORE, boot-shaped ([save.h] v6): fold
                            // and evict the resident floor, blank the pool, load
                            // the saved SOCIETY, then build the saved floor and
                            // embody from the restored rows. No body survives the
                            // transition, so no body can hold a stale id — the
                            // same reason the main menu loads before anything is
                            // embodied.
                            streamer.unload(stack, registry, reg, pool,
                                            currentFloor);
                            pool.init();
                            if (!runState.poolBlob.empty() &&
                                pool.load_rows(runState.poolBlob.data(),
                                               runState.poolBlob.size())) {
                                // The macro clock and the society's attitudes
                                // come with it.
                                if (!runState.macroBlob.empty() &&
                                    !macroSim.load_state(
                                        runState.macroBlob.data(),
                                        runState.macroBlob.size()))
                                    std::fprintf(stderr,
                                                 "[load] macro blob refused; "
                                                 "clock restarts\n");
                                macroSim.set_floors_from(registry);
                                factionRel = runState.factions;
                            } else {
                                // A save without a society (or a refused blob):
                                // reseed from scratch and say so — the run state
                                // still loads.
                                std::fprintf(stderr,
                                             "[load] pool blob refused; "
                                             "reseeding society\n");
                                streamer.seed_all_modules(pool);
                            }
                            // The restored player ROW is the one that carries the
                            // NpcPlayer bit; the snapshot then reasserts the
                            // authoritative clock/bag/hp on top of it.
                            game::NpcId pid = game::kInvalidNpc;
                            for (game::NpcId i = 0; i < pool.count(); ++i)
                                if (pool.is_player(i) && pool.alive(i)) {
                                    pid = i;
                                    break;
                                }
                            const game::LoadResult lr = streamer.ensure_loaded(
                                stack, registry, reg, pool, savedFloor, pid);
                            currentFloor = savedFloor;
                            currentSpec = spec_for_floor(currentFloor);
                            game::bank_open(bankAccount, currentFloor, streamer.floor_seed_of(registry, currentFloor));
                            const LayerId nl = lr.layer;
                            activeLayer = nl;
                            player = pid != game::kInvalidNpc
                                         ? game::embody_as_player(reg, pool, pid,
                                                                  nl)
                                         : lr.player;
                            if (pid != game::kInvalidNpc) {
                                game::apply_player_snapshot(pool, pid,
                                                            runState.player);
                                reg.emplace_or_replace<game::Equipped>(
                                    player, runState.player.equipped);
                                game::sync_armour(reg, pool, player);
                            }
                            // Version 7: stamp the sheet onto the body and the
                            // death-surviving carried snapshot, then restore the
                            // crafting bank. embody_as_player may have rolled a
                            // fresh sheet from the record — overwrite it. [save.h]
                            carriedRpg = runState.rpg;
                            if (reg.valid(player))
                                reg.emplace_or_replace<game::RpgStats>(
                                    player, runState.rpg);
                            crafting = runState.craft;
                            // Version 8 / SAVMAG: restore chambered mag (lazy)
                            // and the cumulative kill tally so F9 does not free
                            // the ammo already debited into the magazine, and
                            // does not zero the HUD kills line. [combat.h]
                            kills = runState.kills;
                            if (reg.valid(player)) {
                                if (runState.hasRanged)
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, runState.ranged);
                                if (runState.kills != 0u)
                                    reg.emplace_or_replace<game::PlayerMelee>(
                                        player, game::PlayerMelee{0, runState.kills});
                            }
                            // Version 9 / SAVSTAT: restore live status effects so
                            // F9 mid-haze keeps the same move/aim/melee mults.
                            // Local person-state — direct assignment. [status.h]
                            playerStatus = runState.status;
                            // Version 10 / SAVCLOCK: the samosbor clock is RESTORED,
                            // not re-armed. This line used to read
                            // `samosbor = samosbor_new_game(sbRng)` under the comment
                            // "per-floor clocks reset, same as any arrival" — but a
                            // load is not an arrival, it is a RESUMPTION, and the two
                            // want opposite things. Re-arming meant the standard save
                            // button cancelled the central crisis mechanic: a player
                            // caught mid-Active at |z| = 50 loaded into Idle with the
                            // per-run `count` back at 0, which also reset the fog
                            // roster `MobDef::minSamosbor` unlocks against.
                            // The fast-travel set is restored for the same reason:
                            // discovery is progress, not per-floor channel state.
                            samosbor = runState.samosbor;
                            fastTravel = runState.fastTravel;
                            // Per-floor channels reset, same as any arrival — these
                            // ARE floor-scoped, unlike the two clocks above.
                            vendorKind = game::vendor_kind_for(
                                game::dominant_faction(pool, currentFloor));
                            rumourLine[0] = 0;
                            rumourAt = 0;
                            game::noise_clear(noiseField);
                            // Arrival order is load-path law: containers before
                            // re-open, mobs, floor file, doors, freeze, bake,
                            // then placement. [save.h]
                            refresh_floor_containers(reg, stack.layer(nl),
                                                     currentFloor, nl);
                            const std::size_t reopened =
                                game::apply_opened_containers(
                                    reg, nl, currentFloor,
                                    runState.opened.data(),
                                    runState.opened.size());
                            refresh_floor_mobs(reg, stack.layer(nl), currentFloor,
                                               nl);
                            refresh_floor_props(
                                reg, stack.layer(nl), currentFloor, nl,
                                streamer.floor_seed_of(registry, currentFloor),
                                bus);
                            if (currentSpec)
                                doorsBuilt = game::door_build(
                                    stack.layer(nl), doors, currentFloor,
                                    *currentSpec,
                                    streamer.floor_seed_of(registry,
                                                           currentFloor));
                            doors.frozen = true;
                            begin_floor_nav(stack.layer(nl), currentFloor, nav, roomZones);
                            if (propPass.ready()) {
                                merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(wirePass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(clothPass, streamer.antourage_at_layer(registry, nl));
                            }
                            voxelMirror.upload_all(stack.layer(nl));
                            if (mirrorVerify) voxelMirror.verify(stack.layer(nl));

                            game::PlacedCell placed{};
                            if (reg.valid(player)) {
                                placed = game::place_body_at_cell(
                                    reg, stack.layer(nl), player, scx, scy, scz);
                                aim_player(reg, player);
                            }

                            // Honest HUD: place slip / ok, with the society size.
                            if (!placed.ok) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded %u rub floor %d; place refused, %u crates",
                                    static_cast<unsigned>(ledger.banked), currentFloor,
                                    static_cast<unsigned>(reopened));
                            } else {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded: floor %d @%u,%u,%u, %u rub, %u alive",
                                    currentFloor, static_cast<unsigned>(scx),
                                    static_cast<unsigned>(scy),
                                    static_cast<unsigned>(scz),
                                    static_cast<unsigned>(ledger.banked),
                                    static_cast<unsigned>(pool.alive()));
                            }
                        }
                        saveLineAt = simTick;
                        // Same headless proof trail as save. [save.h]
                        std::fprintf(stderr, "[load] %s\n", saveLine);
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
                                const game::Faction vf = game::dominant_faction(pool, currentFloor);
                                const std::int8_t playerRel = factionRel.at(game::kFactionPlayerRow, static_cast<std::uint8_t>(vf));
                                if (sellWanted) {
                                    const std::int32_t s = game::vendor_sell_all(vi, ledger,
                                                                                 vendorKind, reg.try_get<game::RpgStats>(player), playerRel);
                                    sold += s;
                                    if (s > 0) game::relations_nudge_player(factionRel, vf, +1);
                                }
                                if (buyWanted) {
                                    const std::int32_t b = game::vendor_resupply(vi, ledger,
                                                                                 kResupplyBudget);
                                    spent += b;
                                    if (b > 0) game::relations_nudge_player(factionRel, vf, +1);
                                }
                                // Trade changed the bag, so the ARMOUR component
                                // has to be re-derived from it. The rule is stated
                                // in this file ("call after anything that changes
                                // the inventory") and every craft/loot path obeys
                                // it; all three vendor paths did not. Selling the
                                // vest you are wearing removed it from the bag and
                                // left the resistances on the entity — permanent
                                // free armour, paid for. [problems.md] 28.3
                                if (sellWanted || buyWanted)
                                    game::sync_armour(reg, pool, player);
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
                    // Zero-heap nearest Terminal (4 m = sqrt(16)). [jirnyak.md] §18
                    const bool nearTerm =
                        game::find_nearest_interactable(
                            reg, player, game::Interactable::Kind::Terminal,
                    game::interact_def(game::InteractKind::Terminal).reachM)
                            .hit;
                    const game::CraftStation bench =
                        game::on_extraction_pad(stack.layer(activeLayer).grid(), ct.pos)
                            ? game::CraftStation::Workbench
                            : (nearTerm ? game::CraftStation::NetTerminal : game::CraftStation::Any);
                    bool invChanged = false;
                    if (const auto* nrk = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrk->id)) {
                            game::Inventory& ci = pool.inventory(nrk->id);
                            if (craftWanted) {

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
                            // The character sheet rides in so a completed job can pay
                            // XP as well as roubles (manifest p.5). It is the LIVE
                            // component, not `carriedRpg`: `award_xp` may level the
                            // body up, and the refresh a few hundred lines below
                            // (`carriedRpg = *rsLive`) then carries that forward, so
                            // the order here is load-bearing rather than incidental.
                            // Absent sheet -> nullptr -> money only, exactly as before.
                            game::RpgStats* rsq = reg.try_get<game::RpgStats>(player);
                            const std::int32_t cBefore = contractPaid;
                            const std::int32_t qBefore = questPaid;
                            contractPaid += game::contract_step(
                                contracts, pool, pool.inventory(nrc->id), ledger, rsq);
                            questPaid += game::quest_step(
                                quests, pool, pool.inventory(nrc->id), ledger,
                                static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f),
                                rsq);
                            if (contractPaid > cBefore) {
                                const game::Faction f = game::dominant_faction(pool, currentFloor);
                                game::relations_nudge_player(factionRel, f, +2);
                            }
                            if (questPaid > qBefore) {
                                const game::Faction f = game::dominant_faction(pool, currentFloor);
                                game::relations_nudge_player(factionRel, f, +3);
                            }
                        }
                // Bank step: accrue interest on deposits and loans per interest period.
                game::bank_step(bankAccount, simTick);
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
                    if (cr.used && cr.hpCost > 0) {
                        consumeHpCost += cr.hpCost;
                    }
                }
                if (healWanted) {
                    healed += game::use_best_heal(reg, pool, bus, activeLayer,
                                                  simTick, &playerStatus);
                    healWanted = false;
                }
                if (psiWanted) {
                    const game::ConsumeResult cr =
                        game::use_best_psi(reg, pool, bus, activeLayer, simTick);
                    if (cr.used) {
                        restoredPsi += cr.psi;
                        if (cr.hpCost > 0) {
                            consumeHpCost += cr.hpCost;
                        }
                    }
                    psiWanted = false;
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
                    // fresh RpgStats from the new record — wrong across a DEATH
                    // (losing every level to a bad corridor is not the reference's
                    // rule) and wrong across voluntary possession too (POSRPG
                    // stamps via transfer_player_progression). Death cannot call
                    // that helper: the old body is already gone, so this reads the
                    // value saved off at the top of the death path (carriedRpg).
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
                if (simTick % game::kMacroPeriodTicks == 0) {
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
                // Fluid: `fluid_step` ([sim/fluid.h]) is NOT run here, and the
                // reason this comment used to give — "no floor module seeds the
                // field yet" — is FALSE. `padic_gen.cpp` (kFluidField seeding)
                // runs for every FloorKind via floor_gen.cpp's padic_apply_rules,
                // so every floor in the game seeds standing water. The consumers
                // are live and read it each tick (pos_wet below, plus wet-spawn
                // suppression in mob_spawn.cpp and crate flotation in
                // container.cpp) — they just read a field that never evolves.
                // Water is painted and frozen.
                //
                // performance mandate forbids. Owner call, not a TODO to grab.
                simNow += kSimDt;
                simAccum -= kSimDt;
            }
            // Spiral-guard clamp: if the fixed-step loop hit the guard limit
            // (8 iterations), accumulated time debt can grow unboundedly.
            // Cap simAccum so recovery is instant instead of a multi-frame
            // catch-up spiral that pegs every subsequent frame at 8 ticks.
            if (guard >= 8) {
                simAccum = std::min(simAccum, kSimDt);
            }
        }

        // --- render --------------------------------------------------------
        int fbw = 0, fbh = 0;
        SDL_GetWindowSizeInPixels(window, &fbw, &fbh);
        float aspect = fbh > 0 ? static_cast<float>(fbw) / fbh : 1.0f;
        CameraMatrices camMat = compute_camera(reg, aspect);

        hud.begin_frame();
        if (showHud)
        {
            ImGui::SetNextWindowPos(ImVec2(10, 10), ImGuiCond_FirstUseEver);
            ImGui::Begin("gigahrush2");
            ImGui::Text("%.1f FPS (%.2f ms)", frameDt > 0 ? 1.0f / frameDt : 0.0f,
                        frameDt * 1000.0f);
#ifndef NDEBUG
            // A slow frame must never be mistaken for a code regression when it
            // is really an unoptimized tree (see the [build] line at launch).
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "%s", kBuildKind);
#endif
            ImGui::Text("cpu record: cube %.2f ms | body %.2f ms", cubeMs, bodyMs);
            ImGui::Text("mirror: dirty %u | up %u cells %.1f KiB | pages %u%s",
                        voxelMirror.dirty_backlog(),
                        voxelMirror.last_flush_cells(),
                        static_cast<double>(voxelMirror.last_flush_bytes()) /
                            1024.0,
                        voxelMirror.pages_in_pool(),
                        voxelMirror.page_overflowed() ? " OVERFLOW" : "");
            // Real GPU time, per pass, from timestamp queries — NOT the frame
            // time above.
            if (renderer.timer.supported()) {
                ImGui::Text("gpu: lgrid %.3f | cull %.3f | flush %.3f | sim %.3f | gas %.3f | world %.3f | "
                            "bodies %.3f | props %.3f | drw-phys %.3f | hud %.3f | frame %.3f ms",
                            renderer.timer.pass_ms(gpu::GpuPass::LightGrid),
                            renderer.timer.pass_ms(gpu::GpuPass::Cull),
                            renderer.timer.pass_ms(gpu::GpuPass::VoxelFlush),
                            renderer.timer.pass_ms(gpu::GpuPass::SimPhysics),
                            renderer.timer.pass_ms(gpu::GpuPass::GasSim),
                            renderer.timer.pass_ms(gpu::GpuPass::World),
                            renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms(gpu::GpuPass::Props),
                            renderer.timer.pass_ms(gpu::GpuPass::DrawPhysics),
                            renderer.timer.pass_ms(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms());
                // The median above is DESIGNED to hide spikes — it takes 16 slow frames
                // out of 31 to move it — so it cannot see a hitch. This line is the WORST
                // frame in the same window. A peak that moved while the median did not is
                // a stutter; both moving together is a real cost change. `drop` must stay
                // at 0: a growing value means every figure above is computed over a stale
                // window and none of them mean anything. [gpu_timer.h]
                ImGui::Text("gpu peak: lgrid %.3f | cull %.3f | flush %.3f | sim %.3f | gas %.3f | world %.3f | "
                            "bodies %.3f | props %.3f | drw-phys %.3f | hud %.3f | frame %.3f ms | drop %u",
                            renderer.timer.pass_ms_max(gpu::GpuPass::LightGrid),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Cull),
                            renderer.timer.pass_ms_max(gpu::GpuPass::VoxelFlush),
                            renderer.timer.pass_ms_max(gpu::GpuPass::SimPhysics),
                            renderer.timer.pass_ms_max(gpu::GpuPass::GasSim),
                            renderer.timer.pass_ms_max(gpu::GpuPass::World),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Props),
                            renderer.timer.pass_ms_max(gpu::GpuPass::DrawPhysics),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms_max(), renderer.timer.dropped());
            } else {
                // Deliberately no longer "queue family writes no timestamps": supported()
                // is now ALSO false when the timer was switched off with GIGA_GPU_TIMER=0,
                // and blaming the queue family in that case would be a lie.
                ImGui::TextUnformatted(
                    "gpu: n/a (no timestamps, or GIGA_GPU_TIMER=0)");
            }
            // GUARDED, because `player` can legitimately be null HERE. When the
            // last living body on the layer dies, `possess_a_survivor` returns
            // null and the sim loop does `running = false; break;` — but that
            // `break` leaves the FIXED-STEP LOOP, not the frame, so execution
            // walks straight on into this HUD. Three unchecked `reg.get<>` on a
            // null entity followed: with -fno-exceptions and EnTT's asserts
            // compiled out in Release that is a raw out-of-bounds sparse-set
            // read, i.e. a crash at the exact moment a run ends. The other 48
            // uses of `player` in this file test validity; these did not.
            // [problems.md] §28.1
            if (reg.valid(player)) {
                const auto& tr = reg.get<Transform>(player);
                const auto& ctl = reg.get<Controller>(player);
                const auto& ga = reg.get<GravityAffected>(player);
                ImGui::Text("pos  %.1f %.1f %.1f (layer %u)", tr.pos.x, tr.pos.y,
                            tr.pos.z, tr.layer);
                ImGui::Text("mode %s%s", ctl.fly ? "fly" : "walk",
                            ga.grounded ? " (grounded)" : "");
            } else {
                ImGui::TextUnformatted("pos  -- (no body: run over)");
                ImGui::TextUnformatted("mode --");
            }
            ImGui::Text("props %u | cull %s",
                        propPass.last_draw_count(),
                        cullPass.ready() ? "GPU-ready" : "off");
            // Antourage — the binary "is it even there" line (owner's ask):
            // baked pipe legs/joints + wire chains on THIS floor, straight from
            // the resident bake. 0/0/0 = the bake did not run or was evicted.
            {
                const game::AntourageBake* hudAb =
                    streamer.antourage_at_layer(registry, activeLayer);
                ImGui::Text("antourage: %zu instances | %zu wires (gpu %u) | "
                            "%zu cloths (gpu %u)",
                            hudAb ? hudAb->instances.size() : 0,
                            hudAb ? hudAb->wires.size() : 0,
                            wirePass.chain_count(),
                            hudAb ? hudAb->cloths.size() : 0,
                            clothPass.sheet_count());
                ImGui::Text("particles: %u alive / %u spawned | %zu drip emitters",
                            particlePass.alive_count(),
                            particlePass.spawned_total(), dripEmitters.size());
            }
            std::int16_t php = 0, pmax = 0;
            if (game::entity_health(reg, pool, player, php, pmax))
                if (pmax > 0) {
                    const float frac = static_cast<float>(php) /
                                       static_cast<float>(pmax);
                    // Service-equipment status bar: hard-edged phosphor-green fill
                    // (no glow), amber when critical, dark when dead. taste.md:
                    // important status gets its own bar, not an overlay drawn over
                    // the gameplay zone.
                    if (php <= 0)
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.30f, 0.05f, 0.05f, 1.00f)); // dead
                    else if (frac <= 0.25f)
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.95f, 0.78f, 0.25f, 1.00f)); // critical amber
                    else
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.349f, 0.949f, 0.400f, 1.00f)); // phosphor
                    ImGui::ProgressBar(frac, ImVec2(220.0f, 14.0f), "");
                    ImGui::PopStyleColor();
                    ImGui::SameLine();
                    ImGui::Text("HP %d / %d%s", php, pmax, php <= 0 ? "  DEAD" : "");
                }
            {
                const std::uint16_t mv = game::status_move_mult_e3(playerStatus);
                const bool rooted = game::status_is_rooted(playerStatus);
                if (mv != 1000 || rooted ||
                    game::status_active(playerStatus, game::StatusId::SporeHaze) ||
                    game::status_active(playerStatus, game::StatusId::ZhelemishSkin) ||
                    game::status_active(playerStatus, game::StatusId::PaupsinaWeb)) {
                    ImGui::Text("status move_e3=%u aim_e3=%u rooted=%d",
                                mv, game::status_aim_mult_e3(playerStatus),
                                rooted ? 1 : 0);
                }
            }
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
                    {
                        // rs above is scoped to the character-sheet if; re-fetch
                        // here so melee HUD shows RPG-scaled damage (RPGCMBT).
                        std::uint16_t shownDmg = md->dmg;
                        if (const auto* rsHud =
                                reg.try_get<game::RpgStats>(player)) {
                            const std::int16_t scaled = game::melee_damage(
                                *rsHud, wpn,
                                static_cast<std::int16_t>(md->dmg));
                            shownDmg = static_cast<std::uint16_t>(
                                scaled > 1 ? scaled : std::int16_t{1});
                        }
                        ImGui::Text("weapon: %s (%u dmg) | armour: %s",
                                    wpn == game::kInvalidItem ? "fists"
                                                              : game::item_name(wpn),
                                    shownDmg,
                                arm == game::kInvalidItem ? "none"
                                                          : game::item_name(arm));
                    }
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
                // CARRIED WEIGHT — the reader `ItemDef::massG` exists for. Slots
                // alone never said what a load-out COSTS: sixty rifle rounds and
                // sixty documents each occupy one slot and are 0.96 kg against
                // 1.5 kg of paper.
                //
                // The budget is THIS BODY's, not a constant: 64 kg + 4 kg per point
                // of Strength ([rpg.h] carry_capacity_g). Printed with the Str that
                // produced it, because a number that moves when you level up should
                // say why on the same line.
                if (reg.valid(player)) {
                    if (const auto* pNr = reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(pNr->id)) {
                            const std::uint32_t heldG =
                                game::inventory_mass_g(pool.inventory(pNr->id));
                            // The sheet is an ECS component, not a pool column
                            // ([combat.h] "RpgStats: copy from -> to"), so a body
                            // with none reads as Str 0 rather than as no budget.
                            const game::RpgStats rs =
                                reg.all_of<game::RpgStats>(player)
                                    ? reg.get<game::RpgStats>(player)
                                    : game::RpgStats{};
                            const std::uint32_t capG = game::carry_capacity_g(rs);
                            const game::EncumbranceEffect& ee =
                                encumbrance.playerEffect;
                            // The CONSEQUENCES, not just the number. A HUD that
                            // says OVERLOADED and nothing else leaves the player
                            // guessing what it cost; these are the three live
                            // multipliers ([encumbrance.h]).
                            ImGui::Text(
                                "weight %.1f / %.0f kg (64 + 4 x STR %u) | "
                                "pace x%.2f | noise x%.2f%s",
                                static_cast<double>(heldG) / 1000.0,
                                static_cast<double>(capG) / 1000.0,
                                static_cast<unsigned>(
                                    rs.attr[static_cast<std::size_t>(game::Attr::Str)]),
                                static_cast<double>(ee.speedScale),
                                static_cast<double>(ee.noiseMult),
                                ee.overloaded ? "  OVERLOADED" : "");
                        }
                    }
                }
                // Crafting, on screen: C builds or reads, X strips. `bank` is the 8-axis
                // material vector summed, because eight numbers on the HUD would be noise
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
                        currentSpec ? currentSpec->name : "?",
                        currentSpec ? currentSpec->population : 64u);
            // The coarse society tick's last report ([macro_sim.h]).
            // `macroSim.tick()` is 0 until the first step
            // lands ~2 s in, so this reads "warming up" rather than a row of zeroes
            // that looks broken. births/deaths are this step's tallies; in-transit is
            // the live migration backlog; reserve is the birth headroom the pool will
            // never reclaim (the design-scale wall lives here, macro_sim.h banner).
            {
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
            for (std::size_t fi = 0; fi < eventFeed.live; ++fi) {
                const char* fline = game::feed_line(eventFeed, fi);
                const std::uint64_t ftick = game::feed_tick(eventFeed, fi);
                if (fline != nullptr && ftick != 0) {
                    ImGui::TextColored(ImVec4(0.9f, 0.7f, 0.3f, 0.9f), "[feed %llu] %s",
                                       static_cast<unsigned long long>(ftick), fline);
                }
            }
            ImGui::TextUnformatted(
                "WASD move | mouse look | Tab toggle look | Space jump | "
                "F fly | Q door | G eat | T drink | F5/F9 save/load | [ / ] floor | Esc menu");
            ImGui::End();
        }

        // --- Interactive ImGui Crafting Workbench & Trader Windows ---
        // ── Debug console (~) ──────────────────────────────────────────
        // Context is refreshed every frame (player/floor move under it), the
        // window draws whenever open — paused or not — and a teleport request
        // is carried out at the top of the NEXT frame (see do_ride).
        if (showConsole) {
            refresh_console_ctx();
            DrawConsoleUI(&showConsole, &consoleFocus, consoleInput,
                          sizeof consoleInput, console, consoleCtx, consoleLog,
                          consoleHistory, consoleHistPos);
        }

        // DRAINED UNCONDITIONALLY, outside the console overlay.
        //
        // This used to sit INSIDE `if (showConsole)`, so a floor request only
        // ever landed while the console happened to be open. Every other console
        // request (`requestBits`) is drained unconditionally, and this one is the
        // channel `cmd_teleport` / `cmd_fasttravel` write to — which meant a
        // KeyBind row running `ft 14`, exactly the one-row extension
        // [ARCHITECTURE.md] advertises, did NOTHING when pressed. Worse, the
        // request was not dropped but LATCHED: it sat in the context and fired
        // the next time the player opened the console for some unrelated reason,
        // teleporting them mid-thought. Same for a pause-menu MenuItem, which
        // runs `exec_command` with the console shut. [problems.md] section 28.2
        if (consoleCtx.requestFloor != game::ConsoleContext::kNoRequest) {
            pendingTeleport = consoleCtx.requestFloor;
            pendingLandHub = consoleCtx.requestLandHub;
            consoleCtx.requestFloor = game::ConsoleContext::kNoRequest;
            consoleCtx.requestLandHub = -1;
        }

        if (showCraftingWindow && reg.valid(player)) {
            const Transform& ct = reg.get<Transform>(player);
            // Zero-heap nearest Terminal ([jirnyak.md] section 18) -- same reach as craft hot path.
            const bool nearTerm =
                game::find_nearest_interactable(
                    reg, player, game::Interactable::Kind::Terminal,
                    game::interact_def(game::InteractKind::Terminal).reachM)
                    .hit;
            const game::CraftStation bench =
                game::on_extraction_pad(stack.layer(activeLayer).grid(), ct.pos)
                    ? game::CraftStation::Workbench
                    : (nearTerm ? game::CraftStation::NetTerminal : game::CraftStation::Any);

            if (const auto* nrk = reg.try_get<game::NpcRef>(player)) {
                if (pool.valid(nrk->id)) {
                    DrawCraftingWindowUI(&showCraftingWindow, crafting, pool.inventory(nrk->id), 
                                         bench, simTick, reg, player, pool, 
                                         crafted, scrapped, recipesLearned);
                }
            }
        }

        // --- THE SHAFT MENU -------------------------------------------------
        // The manifesto (p.4) asks for three KINDS of transition: a fixed
        // fast-travel grid, a procedural ride down, and a procedural ride up. It
        // spells that as three separate 4x4 sets of columns — 48 shafts. Owner's
        // decision 2026-08-12: keep ONE set of 16 and let the column offer all three,
        // which is what this window is.
        //
        // That is not only cheaper to build, it is the only version that does not
        // move `kLatticeDim` — and `nav::kNodes == kLatticeCount == kLatticeDim^3`,
        // so 5 per axis would take the fine nav bake from 128 MiB to 250 MiB and
        // break the nav-cache wire pin (`kNavCoarseWire == 13056`, sized at 64
        // nodes). Three sets of columns would have needed a second lattice constant.
        //
        // EVERY ROW IS A CONSOLE LINE, exactly like the pause menu: `ride down`,
        // `ride up`, `ft <N>` all existed before this window and are unchanged by it.
        // The menu adds a PLACE TO CHOOSE, not a mechanism — so the console, a
        // keybind and this window cannot drift, and the deferred-request drain keeps
        // the ride out of the middle of a frame.
        if (showElevatorWindow && reg.valid(player)) {
            const Transform& et = reg.get<Transform>(player);
            const int ecx = wrap_macro(static_cast<int>(et.pos.x / kCellSize));
            const int ecy = wrap_macro(static_cast<int>(et.pos.y / kCellSize));
            const int shaft = game::fast_hub_near(ecx, ecy);
            ImGui::SetNextWindowSize(ImVec2(360, 0), ImGuiCond_FirstUseEver);
            if (ImGui::Begin("ЛИФТ / ELEVATOR", &showElevatorWindow)) {
                if (shaft < 0) {
                    ImGui::TextColored(ImVec4(0.95f, 0.35f, 0.30f, 1.0f),
                                       "[NOT IN A SHAFT]");
                    ImGui::TextWrapped(
                        "Встаньте в колонну лифта — 16 шахт на решётке 4x4, "
                        "одинаково на каждом этаже.");
                } else {
                    ImGui::Text("ШАХТА %d  |  ЭТАЖ %d", shaft, currentFloor);
                    ImGui::Separator();
                    refresh_console_ctx();
                    // 1 & 2 — the procedural halves. `ride` walks to the nearest
                    // LABELLED floor on that side, which is why this says "next"
                    // and not "-1": a sparse stack is legal.
                    if (ImGui::Button("ВНИЗ  /  DESCEND", ImVec2(-FLT_MIN, 0)))
                        exec_command("ride down");
                    if (ImGui::Button("ВВЕРХ /  ASCEND", ImVec2(-FLT_MIN, 0)))
                        exec_command("ride up");
                    ImGui::Separator();
                    // 3 — fast travel, and the list IS the unlock set. A floor the
                    // player has never boarded from is simply not here, so the gate
                    // and the UI cannot disagree about what is reachable.
                    ImGui::TextUnformatted("БЫСТРЫЙ ПЕРЕХОД / FAST TRAVEL");
                    int offered = 0;
                    for (int f = game::kMinFloor; f <= game::kMaxFloor; ++f) {
                        if (f == currentFloor) continue;
                        if (!fastTravel.unlocked(f)) continue;
                        if (registry.module_at(f) == game::kInvalidModule) continue;
                        char row[64];
                        std::snprintf(row, sizeof row, "ЭТАЖ %d##ft%d", f, f);
                        if (ImGui::Button(row, ImVec2(-FLT_MIN, 0))) {
                            char cmd[32];
                            std::snprintf(cmd, sizeof cmd, "ft %d", f);
                            exec_command(cmd);
                        }
                        ++offered;
                    }
                    if (offered == 0)
                        ImGui::TextDisabled("нет открытых этажей — доберитесь пешком");
                }
            }
            ImGui::End();
        }

        if (showVendorWindow && reg.valid(player)) {
            const Transform& vt = reg.get<Transform>(player);
            const bool isOnPad = game::on_extraction_pad(stack.layer(activeLayer).grid(), vt.pos);
            if (const auto* nrv = reg.try_get<game::NpcRef>(player)) {
                if (pool.valid(nrv->id)) {
                    const std::int32_t soldBefore = sold;
                    const std::int32_t spentBefore = spent;
                    const game::Faction vf = game::dominant_faction(pool, currentFloor);
                    const std::int8_t playerRel = factionRel.at(game::kFactionPlayerRow, static_cast<std::uint8_t>(vf));
                    DrawVendorWindowUI(&showVendorWindow, pool.inventory(nrv->id), ledger, 
                                       vendorKind, isOnPad, sold, spent, reg.try_get<game::RpgStats>(player), playerRel);
                    // Same re-derive as the keyboard path. The window is not handed
                    // reg/pool/player, so the CALLER does it — the shape the
                    // crafting window already uses via its `invChanged` out-param.
                    // Either counter moving means stock crossed the bag boundary.
                    // [problems.md] 28.3
                    if (sold != soldBefore || spent != spentBefore) {
                        game::relations_nudge_player(factionRel, vf, +1);
                        game::sync_armour(reg, pool, player);
                    }
                }
            }
        }

        // ── Contextual interaction prompt ──────────────────────────────
        // A centered bottom-screen hint that appears when the player is
        // close enough to interact with a door or terminal. Rendered as a
        // borderless auto-sized ImGui window so it floats cleanly.
        if (showHud && !paused && reg.valid(player)) {
            const vec3 ppos = reg.get<Transform>(player).pos;
            const char* promptText = nullptr;
            // Prompts name the BOUND key, not a literal: rebind `door` in the
            // menu and every hint follows.
            char promptBuf[96];
            auto set_prompt = [&](const char* action, const char* what) {
                std::snprintf(promptBuf, sizeof promptBuf, "[%s]  %s",
                              bind_key(action), what);
                promptText = promptBuf;
            };

            // Door proximity (same indexed search door_toggle_near uses)
            std::uint32_t nearDoor = game::door_query_near(doors, ppos);
            if (nearDoor != game::kNoDoor) {
                const game::Door& d = doors.doors[nearDoor];
                const bool isShutOrLocked = (d.state == static_cast<std::uint8_t>(game::DoorState::Shut) ||
                                             d.state == static_cast<std::uint8_t>(game::DoorState::Locked));

                if (isShutOrLocked && d.keycardTier > 0) {
                    const game::Inventory* pInv = nullptr;
                    if (const auto* nr = reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(nr->id)) pInv = &pool.inventory(nr->id);
                    }
                    const bool hasCard = pInv && game::inventory_has_keycard(*pInv, d.keycardTier);
                    set_prompt("door", hasCard ? "UNLOCK DOOR" : "KEYCARD REQUIRED");
                } else if (isShutOrLocked) {
                    set_prompt("door", "OPEN DOOR");
                } else {
                    set_prompt("door", "CLOSE DOOR");
                }
            }

            // Terminal proximity -- zero-heap find_nearest ([jirnyak.md] section 18).
            if (!promptText && activeLayer != kInvalidLayer) {
                const game::InteractionHit termHit = game::find_nearest_interactable(
                    reg, player, game::Interactable::Kind::Terminal,
                    game::interact_def(game::InteractKind::Terminal).reachM);
                if (termHit.hit) {
                    set_prompt("interact", game::interact_def(game::InteractKind::Terminal).prompt);
                }
            }

            // ElectricalShield proximity -- zero-heap find_nearest ([jirnyak.md] section 18).
            if (!promptText && activeLayer != kInvalidLayer) {
                const game::InteractionHit shieldHit = game::find_nearest_interactable(
                    reg, player,
                    game::Interactable::Kind::ElectricalShield,
                    game::interact_def(game::InteractKind::ElectricalShield).reachM);
                if (shieldHit.hit) {
                    const vec3& sp = shieldHit.pos;
                    int scx = static_cast<int>(sp.x / kCellSize);
                    int scy = static_cast<int>(sp.y / kCellSize);
                    int scz = static_cast<int>(sp.z / kCellSize);
                    if (!powerGrid.is_shield_destroyed(scx, scy, scz)) {
                        set_prompt("interact",
                                   game::interact_def(game::InteractKind::ElectricalShield).prompt);
                    }
                }
            }

            // Corpse proximity — §18 find_nearest Kind::Corpse. Empty searched
            // corpses deactivate Interactable in loot_corpse_interact, so they
            // drop out of the query without a manual Corpse view scan.
            if (!promptText && activeLayer != kInvalidLayer) {
                const game::InteractionHit corpseHit =
                    game::find_nearest_interactable(
                        reg, player, game::Interactable::Kind::Corpse,
                        game::interact_def(game::InteractKind::Corpse).reachM);
                if (corpseHit.hit && reg.valid(corpseHit.entity)) {
                    if (const game::Corpse* corpse =
                            reg.try_get<game::Corpse>(corpseHit.entity)) {
                        set_prompt("interact",
                                   corpse->searched
                                       ? "LOOT CORPSE (REMAINDER)"
                                       : game::interact_def(game::InteractKind::Corpse).prompt);
                    } else {
                        set_prompt("interact",
                                   game::interact_def(game::InteractKind::Corpse).prompt);
                    }
                }
            }

            // Nearby resident for body possession (P key)
            if (!promptText) {
                for (auto npcEnt : reg.view<const game::NpcRef, const Transform>()) {
                    if (reg.get<const Transform>(npcEnt).layer != activeLayer) continue;
                    if (reg.all_of<CameraTag>(npcEnt)) continue; // skip self
                    const game::NpcId id = reg.get<const game::NpcRef>(npcEnt).id;
                    if (!pool.valid(id) || !pool.alive(id)) continue;
                    const vec3& npos = reg.get<const Transform>(npcEnt).pos;
                    const float dx = wrap_delta_f(ppos.x, npos.x, kWorldExtent);
                    const float dy = ppos.y - npos.y;
                    const float dz = wrap_delta_f(ppos.z, npos.z, kWorldExtent);
                    if (dx * dx + dy * dy + dz * dz < 6.0f * 6.0f) {
                        set_prompt("possess", "POSSESS SURVIVOR");
                        break;
                    }
                }
            }

            // Standing in a shaft. Ranked BELOW doors and bodies on purpose: the
            // shaft is 3x3 and never urgent, while a door you are pressed against
            // or a survivor you can take over both are.
            if (!promptText) {
                const int pcx = wrap_macro(static_cast<int>(ppos.x / kCellSize));
                const int pcy = wrap_macro(static_cast<int>(ppos.y / kCellSize));
                if (game::fast_hub_near(pcx, pcy) >= 0)
                    set_prompt("elevator", "ELEVATOR");
            }

            // Bladder/Bowel pressure relief fallback
            if (!promptText) {
                if (const auto* nrg = reg.try_get<game::NpcRef>(player)) {
                    if (pool.valid(nrg->id)) {
                        const auto& nd = pool.needs(nrg->id);
                        if (nd.pee >= 30.0f || nd.poo >= 30.0f) {
                            set_prompt("interact", "RELIEVE BLADDER/BOWEL");
                        }
                    }
                }
            }

            if (promptText) {
                ImGuiIO& io = ImGui::GetIO();
                ImGui::SetNextWindowPos(
                    ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.78f),
                    ImGuiCond_Always, ImVec2(0.5f, 0.5f));
                ImGui::SetNextWindowBgAlpha(0.55f);
                ImGui::Begin("##interact_prompt", nullptr,
                             ImGuiWindowFlags_NoDecoration |
                                 ImGuiWindowFlags_AlwaysAutoResize |
                                 ImGuiWindowFlags_NoSavedSettings |
                                 ImGuiWindowFlags_NoFocusOnAppearing |
                                 ImGuiWindowFlags_NoNav |
                                 ImGuiWindowFlags_NoMove);
                ImGui::TextColored(ImVec4(1.0f, 0.92f, 0.55f, 1.0f),
                                   "%s", promptText);
                ImGui::End();
            }
        }

        // MAIN MENU — the boot screen. Extensible BY DATA like the pause menu:
        // each entry is a row, each sub-screen a page. The character-creation
        // screen ([npcs.md]: the player IS an NPC row, so creation is an editor
        // over the same char-sheet columns the pool serializes) plugs in as one
        // more page here when it lands. Labels are ASCII — the default ImGui
        // font ships no Cyrillic glyphs.
        if (screen == AppScreen::Menu) {
            ImGuiIO& io = ImGui::GetIO();
            ImGui::SetNextWindowPos(
                ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::Begin("##mainmenu", nullptr,
                         ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoCollapse |
                             ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoTitleBar |
                             ImGuiWindowFlags_NoSavedSettings);
            const ImVec2 btn(240.0f, 0.0f);
            if (menuScreenPage == 0) {
                ImGui::TextUnformatted("G I G A H R U S H  2");
                ImGui::Separator();
                if (ImGui::Button("New Game", btn)) menuScreenPage = 2;
                if (ImGui::Button("Load Game", btn)) menuScreenPage = 1;
                if (ImGui::Button("Settings", btn)) menuScreenPage = 3;
                ImGui::Spacing();
                if (ImGui::Button("Quit", btn)) running = false;
            } else if (menuScreenPage == 1) {
                ImGui::TextUnformatted("Load Game");
                ImGui::Separator();
                bool any = false;
                for (int s = 1; s <= kMaxSaveSlots; ++s) {
                    if (!slot_occupied(s)) continue;
                    any = true;
                    char label[32];
                    std::snprintf(label, sizeof label, "Slot %d", s);
                    if (ImGui::Button(label, btn)) {
                        // The load itself runs on the sim clock next frame —
                        // and BEFORE the player has touched anything, which is
                        // what makes the full v6 world restore safe.
                        g_saveSlot = s;
                        loadWanted = true;
                        menu_start_playing();
                    }
                }
                if (!any) ImGui::TextUnformatted("(no saves yet)");
                ImGui::Spacing();
                if (ImGui::Button("Back", btn)) menuScreenPage = 0;
            } else if (menuScreenPage == 2) {
                ImGui::TextUnformatted("New Game - pick a slot");
                ImGui::Separator();
                for (int s = 1; s <= kMaxSaveSlots; ++s) {
                    char label[48];
                    std::snprintf(label, sizeof label, "Slot %d%s", s,
                                  slot_occupied(s) ? "  (overwrite)" : "");
                    if (ImGui::Button(label, btn)) {
                        g_saveSlot = s;
                        // A new game clears its slot's directory: stale floor
                        // files from the previous run in this slot must not
                        // leak into a fresh one. Player-directed, labelled.
                        char dir[128];
                        slot_dir_path(dir, sizeof dir, s);
                        std::error_code ec;
                        std::filesystem::remove_all(dir, ec);
                        menu_start_playing();
                    }
                }
                ImGui::Spacing();
                if (ImGui::Button("Back", btn)) menuScreenPage = 0;
            } else {
                ImGui::TextUnformatted("Settings");
                ImGui::Separator();
                ImGui::TextUnformatted(
                    "Key bindings: pause menu (Esc in game), persisted.");
                ImGui::TextUnformatted(
                    "Character creation lands here as its own page.");
                ImGui::Spacing();
                if (ImGui::Button("Back", btn)) menuScreenPage = 0;
            }
            ImGui::End();
        }

        // Pause menu (Esc). Extensible BY DATA: a main-page item is a label plus
        // a console line, so the same row already works from the keyboard and
        // the typed console, and a future option (settings, floor jump, ...) is
        // one table entry — never a new handler. The Key Bindings page edits the
        // KeybindTable live and persists it. Labels are ASCII — the default
        // ImGui font ships no Cyrillic glyphs.
        if (paused) {
            ImGuiIO& io = ImGui::GetIO();
            ImGui::SetNextWindowPos(
                ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::Begin("Menu", nullptr,
                         ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings);
            const ImVec2 btn(220.0f, 0.0f);
            if (menuPage == 0) {
                ImGui::TextUnformatted("Paused");
                ImGui::Separator();
                struct MenuItem {
                    const char* label;
                    const char* command; // a console row — the menu adds nothing
                };
                static constexpr MenuItem kItems[] = {
                    {"Resume", "menu"},
                    {"Save Game", "save"},
                    {"Load Game", "load"},
                };
                refresh_console_ctx();
                for (const MenuItem& item : kItems)
                    if (ImGui::Button(item.label, btn)) exec_command(item.command);
                if (ImGui::Button("Key Bindings", btn)) menuPage = 1;
                ImGui::Spacing();
                if (ImGui::Button("Quit", btn)) exec_command("quit");
            } else {
                ImGui::TextUnformatted("Key Bindings");
                ImGui::Separator();
                ImGui::BeginChild("##bind_rows", ImVec2(420.0f, 360.0f), true);
                if (ImGui::BeginTable("##binds", 3,
                                      ImGuiTableFlags_RowBg |
                                          ImGuiTableFlags_SizingStretchProp)) {
                    ImGui::TableSetupColumn("Action");
                    ImGui::TableSetupColumn("Key");
                    ImGui::TableSetupColumn("##rebind",
                                            ImGuiTableColumnFlags_WidthFixed,
                                            80.0f);
                    for (std::size_t i = 0; i < binds.count(); ++i) {
                        const game::KeyBind& b = binds.at(i);
                        ImGui::TableNextRow();
                        ImGui::TableSetColumnIndex(0);
                        ImGui::TextUnformatted(b.action);
                        ImGui::TableSetColumnIndex(1);
                        if (rebindCapture == static_cast<int>(i)) {
                            ImGui::TextColored(ImVec4(1.0f, 0.9f, 0.4f, 1.0f),
                                               "press a key...");
                        } else {
                            const char* keyName = SDL_GetScancodeName(
                                static_cast<SDL_Scancode>(b.scancode));
                            ImGui::Text("%s", (keyName && *keyName) ? keyName : "?");
                            if (binds.conflicts(b.action) > 0) {
                                ImGui::SameLine();
                                ImGui::TextColored(ImVec4(1.0f, 0.35f, 0.35f, 1.0f),
                                                   "(conflict)");
                            }
                        }
                        ImGui::TableSetColumnIndex(2);
                        char rebindId[48];
                        std::snprintf(rebindId, sizeof rebindId, "Rebind##%zu", i);
                        if (ImGui::Button(rebindId))
                            rebindCapture = static_cast<int>(i);
                    }
                    ImGui::EndTable();
                }
                ImGui::EndChild();
                if (ImGui::Button("Reset Defaults", btn)) {
                    binds.clear();
                    game::keybind_register_defaults(binds);
                    save_binds();
                    input.set_move_binds(game::keybind_move_binds(binds));
                    rebindCapture = -1;
                }
                if (ImGui::Button("Back", btn)) {
                    menuPage = 0;
                    rebindCapture = -1;
                }
            }
            ImGui::End();
        }

        // CRT / VHS full-screen overlay: scanlines, phosphor wash and tube
        // vignette drawn on top of every ImGui window (and the 3D world through
        // the transparent background), per the Soviet служебный aesthetic
        // mandate ([jirnyak.md] §19/§8.6). Must be recorded after all HUD and
        // menu windows so it sits on top of them, and before ImGui::Render().
        hud.draw_crt_overlay();

        // Begin command recording & compute pass before graphics render pass
        if (renderer.begin_frame_cmd(window)) {
            VkCommandBuffer cmd = renderer.current_cmd();
            float currentTimeSec = static_cast<float>(SDL_GetTicks()) / 1000.0f;

            // The timer bracket is OUTSIDE the ready() test on purpose, and so is
            // every other bracket this frame writes: collect() reads the whole
            // frame's query range in one call and VK_NOT_READY on ANY unwritten
            // query drops the ENTIRE sample ([gpu_timer.cpp]). A skipped pass must
            // therefore still write its pair — an adjacent begin/end reads as a
            // truthful 0.0 ms, not as a dead readout.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::LightGrid);
            if (lightGrid.ready()) {
                collect_scene_lights(lightGrid, camMat.eye, currentTimeSec, samosbor, reg, activeLayer, &noiseField, &powerGrid);
                lightGrid.update_and_dispatch(cmd, renderer.currentFrame, currentTimeSec, camMat.eye);
            }
            renderer.timer.pass_end(cmd, gpu::GpuPass::LightGrid);



            // Voxel-mirror upkeep, outside the render pass: doors publish
            // their mask edits the same way carve does ([game/door.h]
            // dirtyCells) — drain once per frame, then record this frame's
            // dirty-cell copies.
            if (!doors.dirtyCells.empty()) {
                voxelMirror.mark_dirty(doors.dirtyCells.data(),
                                       doors.dirtyCells.size());
                // Door mask edits free/occupy macro cells — detach props
                // whose anchors no longer have solid support. [jirnyak.md] s18
                // Rebuild PropPass when anything detaches so GPU drops stale skins.
                if (game::anchor_validate_step(reg, stack.layer(activeLayer), bus,
                                               doors.dirtyCells, &particleBursts,
                                               static_cast<std::uint32_t>(simTick)) > 0) {
                    propPassNeedsRebuild = true;
                }
                // A door leaf sliding away empties cells too — dressing that
                // hung off them is just as severed as by a blast.
                if (antourage_carve_step_here(doors.dirtyCells,
                                              static_cast<std::uint32_t>(simTick))) {
                    propPassNeedsRebuild = true;
                    dressingSetChanged = true;
                }
                // Same field-rebake debt carve pays: doors mutate occupancy
                // masks the nav flow fields sample.
                doors.dirtyCells.clear();
            }

            // Falling legs are integrated on the SIM's own collision predicate
            // and re-packed while any of them is still in the air — a handful of
            // bodies for a few seconds, so the repack is cheaper than a second
            // draw path would be.
            if (!antourageFalling.empty()) {
                game::antourage_detach_step(stack.layer(activeLayer),
                                            antourageFalling, frameDt);
                propPassNeedsRebuild = true;
            }
            if (propPassNeedsRebuild) {
                merge_ecs_prop_meshes(reg, activeLayer, propPass,
                                      streamer.antourage_at_layer(registry, activeLayer),
                                      stack.layer(activeLayer), &dripEmitters,
                                      &antourageFalling);
            }
            // Only when the dressing SET actually changed — never merely because
            // a rigid leg is mid-fall.
            if (dressingSetChanged) {
                upload_wires(wirePass, streamer.antourage_at_layer(registry, activeLayer));
                upload_cloths(clothPass, streamer.antourage_at_layer(registry, activeLayer));
            }

            // GIGA_NO_GPU_CULL=1 falls back to the CPU cull — the A/B switch
            // that separates "cull.comp corrupts instances" from every other
            // mesh-path suspect in one relaunch.
            static const bool noGpuCull = std::getenv("GIGA_NO_GPU_CULL") != nullptr;
            static const bool noWireSim = std::getenv("GIGA_WIRE_NOSIM") != nullptr;
            static const bool noParticleSim = std::getenv("GIGA_PARTICLE_NOSIM") != nullptr;
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Cull);
            if (!noGpuCull && cullPass.ready() && propPass.ready()) {
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
            renderer.timer.pass_end(cmd, gpu::GpuPass::Cull);

            // Push bodies for the verlet passes: EVERY body on the active
            // layer (the same set BodyPass draws, PLUS the camera holder —
            // the player is an NPC with a camera, never a special case:
            // wires and curtains answer to the whole crowd identically).
            {
                static std::vector<vec4> pushBodies;
                pushBodies.clear();
                for (auto pushEntity :
                     reg.view<const Transform, const AABB, const Renderable>()) {
                    if (reg.all_of<StaticPropTag>(pushEntity)) continue;
                    const Transform& tr = reg.get<const Transform>(pushEntity);
                    if (tr.layer != activeLayer) continue;
                    pushBodies.push_back(
                        vec4{tr.pos.x, tr.pos.y, tr.pos.z, 0.9f});
                    if (pushBodies.size() >= gpu::kMaxPushBodies) break;
                }
                wirePass.upload_bodies(pushBodies.data(),
                                       static_cast<std::uint32_t>(
                                           pushBodies.size()));
                clothPass.upload_bodies(pushBodies.data(),
                                        static_cast<std::uint32_t>(
                                            pushBodies.size()));
            }

            // Wire verlet: aliveness from the LIVE grid (anchor probe), then
            // the compute step — recorded before the render pass like the cull.
            //
            // The SimPhysics span covers wire + cloth + particle compute, and the
            // particle step is pinned AFTER the mirror flush (see below), so the
            // nested VoxelFlush bracket is a SUB-span of this one by construction:
            // subtract it to isolate pure sim cost. It closes after the particle
            // record, unconditionally — see the LightGrid note on why every
            // bracket must write its pair each frame.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::SimPhysics);
            if (wirePass.ready() && wirePass.chain_count() > 0 &&
                activeLayer != kInvalidLayer) {
                if (const game::AntourageBake* ab =
                        streamer.antourage_at_layer(registry, activeLayer)) {
                    static std::vector<std::uint8_t> wireAlive, wirePins;
                    wireAlive.clear();
                    wirePins.clear();
                    const MacroGrid& wg = stack.layer(activeLayer).grid();
                    // One probe, two answers: the live pin mask says which ends
                    // still hold, and "no pin left" starts the FALL. The chain
                    // keeps simulating unpinned for kAntourageFallSec, so it
                    // drops, lands on the floor (world_land in wire_sim.comp)
                    // and only then stops being drawn ([antourage.md]).
                    static game::FallClock wireFall;
                    if (wireFall.left.size() != ab->wires.size()) wireFall.clear();
                    for (std::size_t wi = 0; wi < ab->wires.size(); ++wi) {
                        const std::uint8_t m =
                            game::wire_live_pins(wg, ab->wires[wi]);
                        wirePins.push_back(m);
                        wireAlive.push_back(
                            wireFall.step(wi, m != 0u, frameDt) ? 1u : 0u);
                    }
                    const auto wireN =
                        static_cast<std::uint32_t>(wirePins.size());
                    wirePass.write_alive(wireAlive.data(), wireN);
                    wirePass.write_pins(wirePins.data(), wireN);
                }
                if (!noWireSim)
                    wirePass.record_sim(
                        cmd, 1.0f / 60.0f,
                        stack.layer(activeLayer).gravity().global);
            }

            // Cloth verlet: same aliveness law, same clock.
            if (clothPass.ready() && clothPass.sheet_count() > 0 &&
                activeLayer != kInvalidLayer) {
                if (const game::AntourageBake* ab =
                        streamer.antourage_at_layer(registry, activeLayer)) {
                    static std::vector<std::uint8_t> clothAlive;
                    static std::vector<std::uint32_t> clothPins;
                    clothAlive.clear();
                    clothPins.clear();
                    const MacroGrid& wg = stack.layer(activeLayer).grid();
                    static game::FallClock clothFall;
                    if (clothFall.left.size() != ab->cloths.size())
                        clothFall.clear();
                    for (std::size_t si = 0; si < ab->cloths.size(); ++si) {
                        const std::uint32_t m =
                            game::cloth_live_pins(wg, ab->cloths[si]);
                        clothPins.push_back(m);
                        clothAlive.push_back(
                            clothFall.step(si, m != 0u, frameDt) ? 1u : 0u);
                    }
                    const auto clothN =
                        static_cast<std::uint32_t>(clothPins.size());
                    clothPass.write_alive(clothAlive.data(), clothN);
                    clothPass.write_pins(clothPins.data(), clothN);
                }
                if (!noWireSim)
                    clothPass.record_sim(
                        cmd, 1.0f / 60.0f,
                        stack.layer(activeLayer).gravity().global);
            }

            if (!stainDirty.empty()) {
                voxelMirror.mark_dirty(stainDirty.data(), stainDirty.size());
                stainDirty.clear();
            }
            renderer.timer.pass_begin(cmd, gpu::GpuPass::VoxelFlush);
            voxelMirror.flush(cmd, renderer.currentFrame,
                              stack.layer(activeLayer));
            renderer.timer.pass_end(cmd, gpu::GpuPass::VoxelFlush);

            // Particle sim AFTER the mirror flush: its barrier orders the
            // masks transfer before compute reads, so a particle collides
            // with THIS frame's carve holes, not last frame's walls.
            // Gravity is the layer's declared VECTOR — the flush above already
            // dereferences activeLayer, so it is valid here.
            if (!noParticleSim)
                particlePass.record_sim(
                    cmd, 1.0f / 60.0f,
                    stack.layer(activeLayer).gravity().global);
            renderer.timer.pass_end(cmd, gpu::GpuPass::SimPhysics);
            renderer.timer.pass_begin(cmd, gpu::GpuPass::GasSim);
            if (gasPass.ready() && activeLayer != kInvalidLayer) {
                const CellStep downStep = regime_down(stack.layer(activeLayer).gravity().regime);
                gasPass.record_sim(cmd, downStep, 1.0f / 60.0f, 0.15f, 0.40f);
            }
            renderer.timer.pass_end(cmd, gpu::GpuPass::GasSim);

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
            raymarchPass.record(cmd, renderer.currentFrame, push,
                                lightGrid.descriptor_set(renderer.currentFrame));
            renderer.timer.pass_end(cmd, gpu::GpuPass::World);
            std::uint64_t t1 = SDL_GetPerformanceCounter();
            // Draw the embodied population on the active layer (shared depth).
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Bodies);
            bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push, lightGrid.descriptor_set(renderer.currentFrame));
            renderer.timer.pass_end(cmd, gpu::GpuPass::Bodies);
            // Props: GPU-instanced arbitrary-mesh pass, same depth buffer.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Props);
            if (propPass.ready())
                propPass.record(cmd, renderer.currentFrame, push, lightGrid.descriptor_set(renderer.currentFrame));
            renderer.timer.pass_end(cmd, gpu::GpuPass::Props);


            renderer.timer.pass_begin(cmd, gpu::GpuPass::DrawPhysics);
            wirePass.record_draw(cmd, push);
            clothPass.record_draw(cmd, push);
            // Particles LAST among world passes: alpha-blended sprites need
            // every opaque depth already written.
            particlePass.record_draw(cmd, push);
            renderer.timer.pass_end(cmd, gpu::GpuPass::DrawPhysics);


            std::uint64_t t2 = SDL_GetPerformanceCounter();
            cubeMs = static_cast<float>((t1 - t0) / freq * 1000.0);
            bodyMs = static_cast<float>((t2 - t1) / freq * 1000.0);
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Hud);
            hud.render(cmd);
            renderer.timer.pass_end(cmd, gpu::GpuPass::Hud);
            renderer.end_frame(window);

            // --mirror-verify heartbeat: prove the incremental dirty path (not
            // just the wholesale uploads) against the CPU truth, ~every 5 s.
            if (mirrorVerify && (++mirrorFrame % 300u) == 0u)
                voxelMirror.verify(stack.layer(activeLayer));

            // --shot: count presented frames, then capture and quit. Counted here
            // rather than in the event loop so a skipped frame (swapchain out of
            // date, window minimised) does not count toward the budget — otherwise a
            // capture on a machine that drops frames would fire before the nav bake
            // and photograph a world with no crowd in it.
            if (shotPath) {
                ++shotFramesSeen;
                // --floor: one absolute hop through the console-teleport seam,
                // at the same cadence rides use (the nav bake needs its ~5 s).
                if (shotFloorWanted && shotFramesSeen % 420 == 0) {
                    shotFloorWanted = false;
                    pendingTeleport = shotFloor;
                }
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
                        // Same departure floor-file write as the keyboard
                        // path — two travel sites, one law. [save.h]
                        write_floor_file(stack.layer(leaveLayer), currentFloor);
                        // Same AIMEM leave release as do_ride. Two travel
                        // sites; a fix that touches only one proves nothing
                        // under --shot --ride. [ai.h]
                        {
                            const std::uint32_t released =
                                game::ai_release(reg, leaveLayer);
                            std::fprintf(stderr,
                                         "[aimem] LEAVE floor=%d layer=%u "
                                         "released=%u mem_rows=%u\n",
                                         currentFloor,
                                         static_cast<unsigned>(leaveLayer),
                                         released, aiMem.rows());
                        }
                    }
                    game::RideResult r = streamer.travel(
                        stack, registry, reg, pool, player, currentFloor, -1,
                        game::kArrivalCoord, pid);
                    if (r.moved) {
                        player = r.player;
                        currentFloor = r.floor;
                        game::record_floor(ledger, currentFloor);
                        game::bank_open(bankAccount, currentFloor, streamer.floor_seed_of(registry, currentFloor));
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
                        // Same arrival law as the keyboard ride above, and it has to be
                        // the same call: this is the "two travel sites" trap the comment
                        // right above warns about, and the samosbor clock is one more
                        // thing both sites must set identically. [samosbor.h]
                        samosbor = game::samosbor_enter_floor(samosbor, currentFloor,
                                                              sbRng);
                        aim_player(reg, player);
                        LayerId nl = reg.get<Transform>(player).layer;
                        activeLayer = nl;
                        vendorKind = game::vendor_kind_for(
                            game::dominant_faction(pool, currentFloor));
                        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
                        refresh_floor_containers(reg, stack.layer(nl),
                                                 currentFloor, nl);
                        refresh_floor_props(
                            reg, stack.layer(nl), currentFloor, nl,
                            streamer.floor_seed_of(registry, currentFloor), bus);
                        // Re-empty crates already looted on a prior visit.
                        // Same seam as keyboard ride + F9 apply. [save.h]
                        game::apply_opened_containers(
                            reg, nl, currentFloor, runState.opened.data(),
                            runState.opened.size());
                        // Arrival floor file BEFORE doors, then doors before
                        // the bake, frozen for its duration — the same law as
                        // the keyboard ride path. This is the SECOND travel
                        // site; a fix that touches only one path leaves --shot
                        // proving nothing. [save.h, door.h]
                        if (currentSpec)
                            doorsBuilt = game::door_build(
                                stack.layer(nl), doors, currentFloor,
                                *currentSpec,
                                streamer.floor_seed_of(registry, currentFloor));
                        doors.frozen = true;
                        begin_floor_nav(stack.layer(nl), currentFloor, nav, roomZones);
                        voxelMirror.upload_all(stack.layer(nl));
                        if (mirrorVerify) voxelMirror.verify(stack.layer(nl));
                        // Same transition autosave as the keyboard path.
                        save_run_now();
                        if (propPass.ready()) {
                            merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(wirePass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(clothPass, streamer.antourage_at_layer(registry, nl));
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
                    if (shotAction == "mag" && reg.valid(player)) {
                        const game::PlayerRanged* pr =
                            reg.try_get<game::PlayerRanged>(player);
                        std::fprintf(stderr,
                                     "[mag] FINAL has=%d mag=%u weapon=%u "
                                     "shots=%u hits=%u rideDone=%d\n",
                                     pr ? 1 : 0,
                                     pr ? static_cast<unsigned>(pr->magCount) : 0u,
                                     pr ? static_cast<unsigned>(pr->weapon) : 0u,
                                     pr ? pr->shots : 0u, pr ? pr->hits : 0u,
                                     shotRideDone);
                        if (pr && pr->magCount == 7u && pr->shots == 42u &&
                            pr->hits == 13u)
                            std::fprintf(stderr, "[mag] PROOF=GREEN\n");
                        else
                            std::fprintf(stderr, "[mag] PROOF=RED\n");
                    }
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms: lgrid %.3f cull %.3f flush %.3f sim %.3f gas %.3f world %.3f "
                                     "bodies %.3f props %.3f drw-phys %.3f hud %.3f frame %.3f (bodies %u)\n",
                                     renderer.timer.pass_ms(gpu::GpuPass::LightGrid),
                                     renderer.timer.pass_ms(gpu::GpuPass::Cull),
                                     renderer.timer.pass_ms(gpu::GpuPass::VoxelFlush),
                                     renderer.timer.pass_ms(gpu::GpuPass::SimPhysics),
                                     renderer.timer.pass_ms(gpu::GpuPass::GasSim),
                                     renderer.timer.pass_ms(gpu::GpuPass::World),
                                     renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms(gpu::GpuPass::Props),
                                     renderer.timer.pass_ms(gpu::GpuPass::DrawPhysics),
                                     renderer.timer.pass_ms(gpu::GpuPass::Hud),
                                     renderer.timer.frame_ms(),
                                     bodyPass.last_instance_count());
                    // The peak beside the median, for the same reason the HUD carries
                    // both: an unattended capture that records only a median cannot
                    // distinguish "this got slower" from "this got spikier", and a
                    // non-zero drop count invalidates every median in the line above.
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms-peak: lgrid %.3f cull %.3f flush %.3f sim %.3f gas %.3f world %.3f "
                                     "bodies %.3f props %.3f drw-phys %.3f hud %.3f frame %.3f (dropped %u)\n",
                                     renderer.timer.pass_ms_max(gpu::GpuPass::LightGrid),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Cull),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::VoxelFlush),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::SimPhysics),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::GasSim),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::World),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Props),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::DrawPhysics),
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

    gasPass.destroy();
    particlePass.destroy();
    clothPass.destroy();
    wirePass.destroy();
    cullPass.destroy();
    propPass.destroy();
    bodyPass.destroy();
    raymarchPass.destroy();
    voxelMirror.destroy();
    cubePass.destroy();
    lightGrid.destroy();
    renderer.destroy();
    device.destroy();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}

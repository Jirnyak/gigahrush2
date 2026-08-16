# Project: GigaHrush 2 — Vulkan GPU Post-Pass CRT Shader, Cyrillic Localization, Character Creation & Dialogue/Quest Systems

## Architecture
- **Rendering Subsystem (`src/render/`)**:
  - `vk_renderer.*`: Two-pass Vulkan pipeline (`sceneRenderPass` renders linear HDR to `VK_FORMAT_R16G16B16A16_SFLOAT` offscreen attachment; `postRenderPass` executes fullscreen triangle shader `post_pass.vert` / `post_pass.frag` into swapchain).
  - `imgui_layer.*`: ImGui font atlas with extended Cyrillic + General Punctuation ranges (`0x0400..0x052F`, `0x2000..0x206F`). Zero CPU `AddLine` scanlines.
  - `shaders/`: `post_pass.vert`, `post_pass.frag` compiled via `glslc -O` to SPIR-V. Implements CRT curvature, scanline phosphor mask, chromatic aberration, vignette, and asymmetric dark adaptation.
- **Menu & Character Creation Subsystem (`src/app/`, `src/game/`)**:
  - `main.cpp` / menu state machine: Page 0 (Root), Page 1 (Load Slot), Page 2 (New Game Slot), Page 3 (Character Creation), Page 4 (Settings).
  - `role.h`, `rpg.h`, `rpg.cpp`: 5 Role archetypes (`Resident`, `Duty`, `Medic`, `Looter`, `Cultist`), base attributes (`STR`, `AGI`, `INT`), derived stats (`HP`, `Carry Capacity`, `PSI`, `Speed`, `Melee Dmg`).
  - `embody.cpp`, `npc_pool.h`: Player entity & NPC pool initialization with chosen archetype stats and starting inventory loadout.
- **Dialogue & Quest UI Subsystem (`src/app/`, `src/game/`)**:
  - `speech.h`, `speech.cpp`, `speech_table.cpp`: 13 `SpeechSituation`s, 273 authored Russian speech lines, `SpeechMemory`, 5 factions.
  - `quest.h`, `quest.cpp`, `quest_table.cpp`, `contract.h`: 19 plot quests, 3 contract slots, persistent quest log.
  - `dialogue_ui.h`, `quest_ui.h`: Interactive NPC Dialogue window (portrait, faction badge, situation, choices) and Quest Log UI (active assignments, contracts, history).
- **Build & Verification Track**:
  - CMake targets: `gigahrush2`, `world_test`, `audit_test`, `e2e_test`, `game_test`.
  - Static source rules: `tools/check_source_rules.cmake` (`GIGA_SOURCE_RULES=PASS`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Vulkan Offscreen HDR Render Target | Linear HDR color attachment (`VK_FORMAT_R16G16B16A16_SFLOAT`) and fullscreen triangle pass | M1 | ORIGINAL_REQUEST §R1 |
| 2 | GPU CRT Fragment Shader | GPU-side CRT barrel curvature, 3px scanline phosphor mask, chromatic aberration, radial vignette, green phosphor wash | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Asymmetric Dark Adaptation | Room illumination modulation with fast constriction (tau=0.15s) and slow dilation (tau=2.50s) | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Eliminate CPU ImGui Scanlines | Remove ~960 CPU `AddLine`/`PrimReserve` draw calls from `imgui_layer.cpp` | M1 | ORIGINAL_REQUEST §R1, AC |
| 5 | Cyrillic TTF Font Atlas Loading | ImGui font atlas configured with Cyrillic (`0x0400..0x052F`) and General Punctuation (`0x2000..0x206F`) | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Russian Typography & Localization | HUD, lore, faction titles, NPC speech barks, and Samosbor warnings rendered in clean Russian without mojibake | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Main Menu Navigation & Settings | Menu pages reordered (Page 0 Root, Page 1 Load, Page 2 Slot Select, Page 3 Char Creation, Page 4 Settings) | M3 | ORIGINAL_REQUEST §R3 |
| 8 | Role Archetype Selection | Interactive selection of 5 archetypes: `Resident`, `Duty`, `Medic`, `Looter`, `Cultist` | M3 | ORIGINAL_REQUEST §R3 |
| 9 | Base Attributes & Derived Stats | Allocation of STR, AGI, INT with live preview of HP, Carry Weight, PSI, Speed, Melee Dmg | M3 | ORIGINAL_REQUEST §R3 |
| 10 | Player Entity & Loadout Init | Direct injection of chosen archetype, RPG stats, and starting items into live player entity and `NpcPool` | M3 | ORIGINAL_REQUEST §R3 |
| 11 | Rich NPC Dialogue Window | Interactive dialogue UI with speaker portrait, faction badge, situation context, speech/rumours, and action choices | M4 | ORIGINAL_REQUEST §R4 |
| 12 | Interactive Quest Log UI | Multi-tab quest log displaying active assignments, objectives, timers, ruble rewards, and contract history | M4 | ORIGINAL_REQUEST §R4 |
| 13 | Build & Static Source Rules Gate | Zero warnings/errors Release build and `GIGA_SOURCE_RULES=PASS` in `check_source_rules.cmake` | M5 | ORIGINAL_REQUEST §AC |
| 14 | Regression & E2E Verification | 100% pass across `world_test` (23,396), `audit_test` (150), `e2e_test` (2,445), and screenshot validation | M5 | ORIGINAL_REQUEST §AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Vulkan Fullscreen GPU Post-Pass & CRT Shader | Offscreen HDR target, `post_pass.vert`/`frag`, CRT curvature/scanlines/aberration/vignette, dark adaptation, remove CPU AddLine | none | PLANNED |
| 2 | M2: Cyrillic TTF Font Support & Typography | ImGui font atlas Cyrillic + Punctuation glyphs, candidate TTF loader, localization audit | none | PLANNED |
| 3 | M3: Character Creation & Settings Page | Menu Page 3 Char Creation UI, Role archetypes, STR/AGI/INT allocation, derived stats, player entity/pool initialization, Page 4 Settings | none | PLANNED |
| 4 | M4: Rich Dialogue Window & Quest Log UI | Modular `dialogue_ui.h` & `quest_ui.h`, speaker portrait/badge/situation, choice dispatch, quest log tabs/timers/rewards | none | PLANNED |
| 5 | M5: E2E Integration & Verification Gate | Full Release build, static source rules check, 100% test pass (`world_test`, `audit_test`, `e2e_test`), screenshot proof | M1, M2, M3, M4 | PLANNED |

## Interface Contracts

### M1: Vulkan Post-Pass Pipeline
- Shaders: `shaders/post_pass.vert`, `shaders/post_pass.frag`
- Descriptor Set: Binding 0 = `sampler2D sSceneColor` (HDR linear offscreen texture).
- Push Constants / Uniforms: `time`, `resolution`, `darkAdaptationFactor`, `crtCurvature`, `scanlineIntensity`, `vignettePower`.
- Framebuffer: `VkFramebuffer postPassFramebuffer` presenting to swapchain image view.

### M2: ImGui Typography
- Function: `void ImGuiLayer::init_font_atlas(const char* custom_font_path = nullptr)`
- Glyph Ranges: `static const ImWchar kCyrillicWithPunctuationRanges[] = { 0x0020, 0x00FF, 0x0400, 0x052F, 0x2000, 0x206F, 0x2DE0, 0x2DFF, 0xA640, 0xA69F, 0 };`

### M3: Character Creation & Player Embodiment
- Structure: `struct CharCreationState { Role role; int str; int agi; int intell; int unallocated; };`
- Derived Formulas: `max_hp = round(level_hp(1) * (1.0f + 0.01f * str))`, `carry_g = 64000 + 4000 * str`, `max_psi = round(level_psi(1) * (1.0f + 0.01f * intell))`.
- Integration: `void apply_character_creation(Registry& reg, Entity player, NpcPool& pool, const CharCreationState& cc);`

### M4: Dialogue & Quest UI
- Function: `void draw_dialogue_window_ui(AppUIContext& ctx, const DialogueState& state, DialogueAction& outAction);`
- Function: `void draw_quest_log_ui(AppUIContext& ctx, const QuestLog& questLog, const ContractBoard& contracts);`

## Code Layout
- `src/render/vk_renderer.*` — Vulkan offscreen HDR target, render passes, and post-pass pipeline.
- `src/render/imgui_layer.*` — Font atlas configuration, Cyrillic glyphs, UI rendering.
- `shaders/post_pass.vert` / `shaders/post_pass.frag` — GPU CRT post-processing shader.
- `src/app/main.cpp` — Menu state machine, page routing, game loop.
- `src/app/dialogue_ui.h` / `dialogue_ui.cpp` — Interactive Dialogue window.
- `src/app/quest_ui.h` / `quest_ui.cpp` — Interactive Quest Log window.
- `src/game/role.*`, `src/game/rpg.*`, `src/game/embody.*` — Role archetypes, RPG stats, entity embodiment.
- `tests/` — Test suites (`world_test.cpp`, `audit_test.cpp`, `e2e_test.cpp`, `game_test.cpp`).

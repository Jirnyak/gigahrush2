# Крафт

> Центральный документ по готовой системе крафта.
>
> Роль: источник истины по player-facing crafting в коде игры: материалы, составы предметов, рецепты, источники рецептов, станции, runtime-действия, UI/save-интеграция и правила расширения. Для фактической проверки всегда сверяйся с `src/data/craft_*.ts`, `src/data/item_composition.ts`, `src/systems/crafting.ts`, `src/render/craft_ui.ts`, `src/gen/craft_stations.ts` and focused crafting tests.

Актуально на 2026-06-02. Этот файл описывает уже реализованную систему, а не план будущего апдейта. Старые параллельные prompts `kraft_0.md`..`kraft_7.md` являются архивом реализации и лежат в `../gatbage/history/batches/kraft/`.

## Статус

Крафт shipped как персональная система игрока поверх существующего предметного, interactive и save слоев.

Готово в коде:

- fixed bank из 9 крафтовых материалов в `src/data/craft_materials.ts`;
- definition-level composition для каждого `ITEMS` id в `src/data/item_composition.ts`;
- item-based recipes в `src/data/craft_recipes.ts` с id `craft_item_<item_id>`;
- источники изучения рецептов в `src/data/craft_recipe_sources.ts`;
- runtime API, sanitizer, save payload, craft/disassembly actions and menu snapshots in `src/systems/crafting.ts`;
- интерактивные станции `craft_lathe`, `disassembly_workbench`, `craft_lab_bench`, `recipe_billboard` in `src/data/interactive.ts`;
- bounded station placement profiles in `src/data/craft_station_placement.ts` and `src/gen/craft_stations.ts`;
- canvas craft/disassembly UI in `src/render/craft_ui.ts`, opened through the shared `E` interaction dispatcher;
- tests for data shape, runtime atomicity, save, recipe sources, UI and station reachability.

Крафт не заменяет `production`. `src/data/factories.ts` and `src/systems/production.ts` remain the floor/economy production path with cadence, resources, containers, access and bad batches. Crafting is a fast personal item/material path owned by the player state.

## Ownership

The layer contract is:

- `data/` owns material ids, item composition, recipe definitions, recipe sources and station placement profiles.
- `systems/crafting.ts` owns player material state, known recipes, sanitization, action atomicity, event publication and menu snapshots.
- `data/interactive.ts` and `systems/interactive.ts` own station actions and dispatch through `E`.
- `gen/` places stations once during floor generation or authored POI construction.
- `render/craft_ui.ts` draws state from `systems/crafting.ts`; it does not decide gameplay.
- `save_runtime.ts` / `save_payload.ts` persist only the compact crafting section.

Do not put craft-specific gameplay into `main.ts`, `core/world.ts`, broad AI modules or `render/webgl.ts`. `main.ts` may wire generic menu open/close and input, but rules stay in data/systems.

## Materials

The material order is an API, save and UI contract. Do not reorder it without a save-shape bump.

```txt
0 mechanics
1 electronics
2 consumables
3 bio
4 chemical
5 metal
6 cybernetics
7 psimatter
8 metamatter
```

Current UI metadata:

| Id | Name | Short | Role |
| --- | --- | --- | --- |
| `mechanics` | Механика | МЕХ | tools, repair, moving parts |
| `electronics` | Электроника | ЭЛК | wiring, boards, batteries, terminals |
| `consumables` | Расходники | РАС | paper, fabric, tape, food packaging |
| `bio` | Биомасса | БИО | tissue, slime, fungi, samples |
| `chemical` | Химикаты | ХИМ | medicine, fuel, reagents, ammo chemistry |
| `metal` | Материал | МАТ | metal, ammo bodies, weapons, production parts |
| `cybernetics` | Кибернетика | КИБ | rare NET/robotics/high-energy parts |
| `psimatter` | Псиматерия | ПСИ | PSI clots, cult/void matter |
| `metamatter` | Метаматерия | МЕТ | endgame anomaly/VOID material |

`CRAFT_MATERIALS` adds colors, rarity and economy hints. Runtime material counts are clamped to `0..999_999`.

## Item Composition

Craft composition is definition data, not item-instance data. `Item` stacks remain compact:

```ts
interface Item {
  defId: string;
  count: number;
  data?: unknown;
}
```

`src/data/item_composition.ts` derives `ITEM_COMPOSITIONS` for every current `ITEMS` id. Each vector has exactly 9 finite non-negative integers and a positive total. Tests assert that `Object.keys(ITEM_COMPOSITIONS)` exactly matches `Object.keys(ITEMS)`.

Composition uses item type, value, tags and weapon role tiers as authoring signals. It is not a runtime price formula and it is not an economy resource mapping. Rare materials are explicitly bounded through `INTENTIONAL_RARE_MATERIAL_ITEMS`; tests fail if rare material use spreads silently.

## Recipes

`src/data/craft_recipes.ts` builds `CRAFT_RECIPES` from `ITEMS` and `ITEM_COMPOSITIONS`.

Recipe contract:

- stable id format: `craft_item_<item_id>`;
- one recipe per current item id;
- `resultCount = 1`;
- `components` mirrors the item composition vector;
- station kind is one of `any`, `workbench`, `lathe`, `lab`, `net_terminal`;
- tier is `0..4`, derived from total cost and rare material gates;
- recipes are discoverable unless future data documents an exception.

Default known recipe item ids:

```txt
bread
water
bandage
wet_rag_bundle
knife
pipe
chalk
note
ammo_9mm
```

Unknown recipes are not listed in the craft UI. The menu shows only known recipes and whether current materials/station/inventory capacity allow the selected craft.

## Stations

Station kinds are semantic recipe requirements:

- `any`: simple survival/document recipes that do not need a special station.
- `workbench`: ordinary workbench crafting and the only valid disassembly station.
- `lathe`: mechanical, weapon, ammo and metal/tool crafting.
- `lab`: medical, PSI, slime/sample and reagent crafting.
- `net_terminal`: cybernetic, NET, terminal-tagged and metamatter recipes. Current ordinary station placement does not create a generic NET crafting bench; route/terminal content must supply a matching craft entry point if those recipes should be crafted in-world.

Current interactive station ids:

| Interactive id | Feature | Action | Station |
| --- | --- | --- | --- |
| `craft_lathe` | `Feature.MACHINE` | `open_craft_menu` | `lathe` |
| `disassembly_workbench` | `Feature.TABLE` | `open_disassembly_menu` | `workbench` |
| `craft_lab_bench` | `Feature.APPARATUS` | `open_craft_menu` | `lab` |
| `recipe_billboard` | `Feature.SCREEN` | `learn_recipe` | source `floor_recipe_billboard_basics` |

Station identity is stored in `world.surfaceFlags` next to the visual feature. This lets floor memory recover station behavior when the matching feature survives. Placement is generation-time bounded work, not runtime refill.

Reachable shipped paths include:

- fixed lathe/workbench pair in the LIVING expedition prep point;
- fixed lathe/workbench pair in Yakov Davidovich's lab;
- Maintenance craft-station profile with required lathe and disassembly workbench;
- design-route profiles such as `slime_nii`, `production_belt`, `bolnichny_korpus` and `turing_nursery`;
- selected procedural geometry profiles through `src/data/floor_object_placement.ts` and `src/gen/floor_object_placement.ts`.

## Runtime Actions

`src/systems/crafting.ts` is the only owner of craft action rules.

Persistent state:

```ts
interface CraftingState {
  materials: MutableCraftVector;
  knownRecipes: Record<string, true>;
  learnedCount: number;
  lastChangedAt: number;
}
```

Important APIs:

- `createCraftingState()` creates zero material counts plus default known recipes.
- `sanitizeCraftingState()` and `restoreCraftingState()` accept malformed current-shape data and return a safe current state.
- `craftingForSave()` serializes only material counts and known recipe ids.
- `learnCraftRecipe()` adds one discoverable recipe and publishes `craft_recipe_learned`.
- `learnCraftRecipesFromSource()` applies source registries.
- `addCraftMaterial()` clamps and touches state.
- `canCraftRecipe()` checks recipe, knowledge, station, materials and inventory capacity.
- `craftKnownRecipe()` atomically spends the full vector and adds the output item; if add fails after the precheck, materials are restored.
- `disassembleInventorySlot()` removes one item, grants one weighted random material from its composition, and has a 50% chance to learn the item's recipe.
- `craftMenuSnapshot()` produces render-ready entries for craft and disassembly menus.

Runtime publishes compact private events:

- `craft_recipe_learned`;
- `player_craft_item`;
- `player_disassemble_item`.

## Recipe Knowledge

Recipe knowledge sources live in `src/data/craft_recipe_sources.ts`.

Current source kinds:

- `item`: blueprint/instruction items, optionally consumed only after at least one new recipe is learned;
- `note`: note data with `craftRecipeSourceId`;
- `quest`: quest completion/event hooks;
- `terminal`: generated computer definitions with `recipeSourceIds`;
- `npc`: NPC lessons gated by plot npc id, occupation or faction;
- `floor`: floor/interactable sources such as `recipe_billboard`.

The integration points are existing systems:

- `systems/inventory.ts` detects usable recipe-source items;
- `systems/quests.ts` learns quest-tied recipe sources;
- `systems/computers.ts` learns terminal recipe sources;
- `systems/npc_interaction_options.ts` offers NPC recipe lessons;
- `systems/interactive.ts` routes `learn_recipe` actions through the shared content hook.

## UI And Input

`src/render/craft_ui.ts` draws a fullscreen canvas overlay. It is opened by the shared `E` interaction path and uses `craftMenuSnapshot()` as the source of truth.

Modes:

- `craft`: lists known recipes for the active station, shows output, description, full vector, missing materials and the player material bank.
- `disassemble`: lists inventory slots, shows item composition and weighted possible material outputs.

The UI pauses through the same menu state as inventory/container/NPC menus. Keyboard, mouse/touch selection and mobile context updates are wired in `main.ts`, but the craft/disassembly result still goes through `systems/crafting.ts`.

## Save And Load

The save section is compact:

```ts
interface CraftingSavePayload {
  materials: MutableCraftVector;
  knownRecipes: string[];
}
```

Saved facts:

- exactly 9 material counts;
- deduplicated current recipe ids, capped by the runtime known-recipe limit.

Transient facts:

- `learnedCount`;
- `lastChangedAt`;
- open menu state, cursor and filter;
- data definitions and recipe vectors.

Malformed current-shape payloads are sanitized. Unknown recipe ids are dropped. This is not legacy migration; if the save shape breaks, bump `SAVE_SHAPE_VERSION` and reject stale saves according to `save.md`.

## Samosbor

Crafting state is player persistent state and is not reset by samosbor.

Station instances are generation-time surfaces:

- they can be removed by local geometry rewrite when the cell/feature is destroyed;
- they can survive through floor memory when the cell and surface flag survive;
- they should not be silently refilled at runtime to replace destroyed stations.

New durable station behavior must declare whether it is volatile, protected, damaged, sealed or a samosbor source. Do not recreate used or destroyed persistent interactives after samosbor unless they are explicitly volatile decor.

## Validation

Focused tests:

- `tests/crafting-data.test.ts`;
- `tests/crafting-runtime.test.ts`;
- `tests/crafting-save.test.ts`;
- `tests/crafting-integration.test.ts`;
- `tests/craft-recipe-sources.test.ts`;
- `tests/craft-stations.test.ts`;
- `tests/craft-ui.test.ts`;
- station/profile coverage in floor-object and design-floor tests.

`scripts/content-audit.mjs` counts and validates craft recipes, craft recipe sources and interactive station references.

For docs-only changes to this file, `git diff --check` is enough. For data/runtime/station/UI changes, run at least `npm run check`; add browser validation for render/input/mobile changes.

## Extension Rules

When adding a new craftable item:

1. Add or update the `ItemDef` in `src/data/items.ts`.
2. Ensure tags/value/type/weapon stats express the composition and station intent.
3. Let `ITEM_COMPOSITIONS` and `CRAFT_RECIPES` include it, then update rare-material documentation if needed.
4. Add a reachable source: default known, disassembly, blueprint, note, quest, terminal, NPC, floor source or authored route content.
5. Add tests if the item creates a new material/station/tier/source pattern.

When adding a new station-like object:

1. Add a stable interactive id in `src/data/interactive.ts`.
2. Use an existing `Feature` if it is visually sufficient; add a new primitive only for a new visual class.
3. Place it through `src/gen/craft_stations.ts` or a narrow authored generator.
4. Keep placement bounded and reachable; do not add runtime refill.
5. Store durable state only if the gameplay actually needs persistence, then update save tests.

Anti-patterns:

- storing composition in `Item.data`;
- creating recipe ids from numbers or display names;
- crafting through factory production queues;
- per-frame scans to find stations;
- renderer-owned craft state;
- adding a station to `main.ts` as a one-off branch;
- changing material order without a save-shape bump.

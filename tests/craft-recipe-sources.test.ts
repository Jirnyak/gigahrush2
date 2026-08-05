import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Occupation, QuestType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import {
  CRAFT_RECIPE_SOURCES,
  craftRecipeItemId,
  craftRecipeNoteData,
  craftRecipeSourceIdFromNoteData,
  craftRecipeSourceCountsByKind,
  craftRecipeSourcesForFloor,
  getCraftRecipeSource,
} from '../src/data/craft_recipe_sources';
import { COMPUTER_DEFS } from '../src/data/computers';
import { craftRecipeById } from '../src/data/craft_recipes';
import { getInteractiveDef } from '../src/data/interactive';
import { NOTES } from '../src/data/notes';
import { PLOT_CHAIN, SIDE_QUESTS } from '../src/data/plot';
import { placeInteractiveAt } from '../src/gen/interactive_placement';
import {
  copyComputerData,
  openComputer,
  placeComputer,
} from '../src/systems/computers';
import { ensureCraftingState, learnCraftRecipesFromSource } from '../src/systems/crafting';
import {
  activateNpcCustomMenuOption,
  closeNpcInteractionInterface,
  getNpcInteractionInterfaceSnapshot,
  getNpcMenuOptions,
} from '../src/systems/npc_interaction_options';
import { countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer, addTestRoom } from './helpers';
import { checkQuests } from '../src/systems/quests';
import { useInteractive } from '../src/systems/interactive';
import { useItem } from '../src/systems/inventory';

function known(state: ReturnType<typeof makeGameState>, recipeId: string): boolean {
  return ensureCraftingState(state).knownRecipes[recipeId] === true;
}

test('craft recipe source recipe ids resolve to current item ids', () => {
  for (const source of CRAFT_RECIPE_SOURCES) {
    assert.ok(source.recipeIds.length > 0, `${source.id} should unlock at least one recipe`);
    for (const recipeId of source.recipeIds) {
      assert.ok(craftRecipeById(recipeId), `${source.id} recipe ${recipeId} must resolve to a craft recipe`);
      const itemId = craftRecipeItemId(recipeId);
      assert.ok(itemId, `${source.id} recipe ${recipeId} must use craft_item_<item_id>`);
      assert.ok(ITEMS[itemId], `${source.id} recipe ${recipeId} must resolve to item ${itemId}`);
    }
  }
});

test('craft recipe source registry covers every discovery kind', () => {
  const counts = craftRecipeSourceCountsByKind();
  assert.equal(counts.item > 0, true);
  assert.equal(counts.note > 0, true);
  assert.equal(counts.quest > 0, true);
  assert.equal(counts.terminal > 0, true);
  assert.equal(counts.npc > 0, true);
  assert.equal(counts.floor > 0, true);
  assert.equal(craftRecipeSourcesForFloor('story:living').some(source => source.id === 'floor_recipe_billboard_basics'), true);
});

test('item and terminal recipe sources point at existing registries', () => {
  for (const source of CRAFT_RECIPE_SOURCES) {
    if (source.kind === 'item') {
      assert.ok(source.itemId, `${source.id} must declare itemId`);
      assert.ok(ITEMS[source.itemId], `${source.id} itemId must exist`);
    }
    if (source.kind === 'terminal') {
      assert.ok(source.terminalId, `${source.id} must declare terminalId`);
      assert.ok(COMPUTER_DEFS[source.terminalId as keyof typeof COMPUTER_DEFS], `${source.id} terminalId must exist`);
    }
  }
});

test('quest recipe sources are attached through authored quest eventData', () => {
  const attached = new Set<string>();
  const questIds = new Set<string>();
  for (let i = 0; i < PLOT_CHAIN.length; i++) questIds.add(`plot:${i}`);
  for (const step of SIDE_QUESTS) questIds.add(step.id);
  for (const step of [...PLOT_CHAIN, ...SIDE_QUESTS]) {
    const sourceId = step.eventData?.craftRecipeSourceId;
    if (typeof sourceId === 'string') attached.add(sourceId);
  }

  for (const source of CRAFT_RECIPE_SOURCES.filter(source => source.kind === 'quest')) {
    assert.ok(source.questId, `${source.id} must declare questId`);
    assert.ok(questIds.has(source.questId), `${source.id} questId must exist`);
    assert.ok(attached.has(source.id), `${source.id} must be reachable from quest eventData`);
  }
});

test('using a consumed item recipe source learns recipes and removes one item', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'relay_diagram', count: 2 }] });
  const state = makeGameState({ time: 10 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(known(state, 'craft_item_wire_coil'), true);
  assert.equal(known(state, 'craft_item_rail_signal_lamp'), true);
  assert.equal(countInventoryItem(player, 'relay_diagram'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Рецепт изучен: Моток провода')));
});

test('duplicate consumed item source does not duplicate recipes or consume the item', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'relay_diagram', count: 2 }] });
  const state = makeGameState({ time: 11 });

  useItem(player, 0, state.msgs, state.time, state);
  const learnedCount = ensureCraftingState(state).learnedCount;
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(ensureCraftingState(state).learnedCount, learnedCount);
  assert.equal(countInventoryItem(player, 'relay_diagram'), 1);
  assert.ok(state.msgs.some(line => line.text === 'Рецепт уже известен'));
});

test('consumed source is not spent when no crafting state can be written', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'relay_diagram', count: 1 }] });
  const msgs = makeGameState({ time: 12 }).msgs;

  useItem(player, 0, msgs, 12);

  assert.equal(countInventoryItem(player, 'relay_diagram'), 1);
  assert.ok(msgs.some(line => line.text === 'Схема неполная: нужен станок или другой лист'));
});

test('non-consumed item recipe source learns recipes and keeps the item', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'junior_tech_case', count: 1 }] });
  const state = makeGameState({ time: 12.5 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(known(state, 'craft_item_sound_emitter'), true);
  assert.equal(known(state, 'craft_item_radio_jammer'), true);
  assert.equal(countInventoryItem(player, 'junior_tech_case'), 1);
});

test('note source data learns a recipe without raw text matching', () => {
  const player = makeTestPlayer({
    inventory: [{ defId: 'note', count: 1, data: craftRecipeNoteData('note_workbench_basics') }],
  });
  const state = makeGameState({ time: 13 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(known(state, 'craft_item_duct_tape'), true);
  assert.equal(known(state, 'craft_item_wire_coil'), true);
  assert.equal(countInventoryItem(player, 'note'), 1);
});

test('direct craft note sources are reachable from generic note data', () => {
  const noteSourceIds = new Set(
    NOTES.map(note => craftRecipeSourceIdFromNoteData(note)).filter((id): id is string => typeof id === 'string'),
  );

  assert.equal(noteSourceIds.has('note_workbench_basics'), true);
  assert.equal(noteSourceIds.has('note_medpost_bandage_sheet'), true);
});

test('npc teaching option learns at most one deterministic occupation-gated recipe', () => {
  closeNpcInteractionInterface();
  const state = makeGameState({ time: 13.5 });
  const player = makeTestPlayer({ id: 1 });
  const npc = makeTestNpc({ id: 2, name: 'Слесарь у щита', occupation: Occupation.MECHANIC });
  const mechanicRecipeIds = ['craft_item_wrench', 'craft_item_fuse', 'craft_item_door_kit'];

  const option = getNpcMenuOptions({ state, player, npc }).find(option => option.id === 'craft_recipe_lesson');
  assert.ok(option);
  assert.equal(option.label, 'Спросить схему');

  assert.equal(activateNpcCustomMenuOption({ state, player, npc }, 'craft_recipe_lesson'), true);
  assert.equal(mechanicRecipeIds.filter(recipeId => known(state, recipeId)).length, 1);
  assert.equal(state.msgs.filter(line => line.text.startsWith('Рецепт изучен:')).length, 1);

  const snapshot = getNpcInteractionInterfaceSnapshot();
  assert.equal(snapshot.open, true);
  assert.equal(snapshot.id, 'craft_recipe_lesson');
  assert.match(snapshot.lines[0] ?? '', /Слесарь/);

  assert.equal(getNpcMenuOptions({ state, player, npc }).some(option => option.id === 'craft_recipe_lesson'), false);
  closeNpcInteractionInterface(state);
});

test('recipe billboard learns a floor source through the generic interactive path', () => {
  const def = getInteractiveDef('recipe_billboard');
  const action = def?.actions.find(action => action.kind === 'learn_recipe');
  assert.equal(action?.recipeSourceId, 'floor_recipe_billboard_basics');

  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 6, h: 6 });
  const placed = placeInteractiveAt(world, 6, 6, 'recipe_billboard');
  assert.ok(placed);

  const player = makeTestPlayer({ id: 1, x: 6.5, y: 5.25 });
  const state = makeGameState({ time: 13.75 });
  const result = useInteractive({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6.5,
    lookY: 6.5,
    learnRecipe: request => {
      assert.equal(request.recipeSourceId, 'floor_recipe_billboard_basics');
      const source = getCraftRecipeSource(request.recipeSourceId);
      assert.ok(source);
      return learnCraftRecipesFromSource(state, source).learned.length > 0;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(known(state, 'craft_item_duct_tape'), true);
  assert.equal(known(state, 'craft_item_wire_coil'), true);
  assert.equal(known(state, 'craft_item_fuse'), true);
  assert.ok(state.msgs.some(line => line.text.includes('На доске висят схемы')));
});

test('quest completion unlocks stable recipe ids from eventData', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1 });
  const giver = makeTestNpc({ id: 2, name: 'Сержант Баринов' });
  const state = makeGameState({
    time: 14,
    quests: [{
      id: 1,
      type: QuestType.KILL,
      giverId: giver.id,
      giverName: giver.name ?? 'Сержант Баринов',
      desc: 'закрыть учебную стрельбу',
      killCount: 1,
      killNeeded: 1,
      eventData: {
        craftRecipeSourceId: 'quest_barni_range_cleanup',
        craftRecipeIds: ['craft_item_homemade_9mm'],
      },
      done: false,
    }],
  });

  checkQuests(player, world, [player, giver], state, state.msgs);

  assert.equal(state.quests[0].done, true);
  assert.equal(known(state, 'craft_item_homemade_9mm'), true);
  assert.ok(state.msgs.some(line => line.text.includes('Рецепт изучен: Кустарные 9мм')));
});

test('terminal recipe source is local and offline safe', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 6, h: 6 });
  const terminal = placeComputer(world, 6, 6, 'floor_archive');
  assert.ok(terminal);

  const player = makeTestPlayer({ id: 1, money: 0 });
  const state = makeGameState({ time: 15 });

  openComputer(state, terminal);
  assert.equal(copyComputerData(world, state, player), true);

  assert.equal(known(state, 'craft_item_track_diagram_scrap'), true);
  assert.equal(known(state, 'craft_item_relay_diagram'), true);
  assert.equal(player.money, COMPUTER_DEFS.floor_archive.stealRewardRubles);
});

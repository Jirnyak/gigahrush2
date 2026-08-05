import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { generateConcentratePress } from '../src/gen/maintenance/concentrate_press';
import { getRecentEvents } from '../src/systems/events';
import { addItem, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'experimental_concentrate';

test('experimental concentrate is a rare NII/factory food risk', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Несерийный концентрат');
  assert.equal(def.type, ItemType.FOOD);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.22);
  assert.equal(def.value, 34);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(inventoryItemCategory(def.id), 'food');
  assert.ok(RESOURCES.find(resource => resource.id === 'food')?.itemIds.includes(ITEM_ID));

  for (const tag of ['bait', 'bait_starch', 'bait_risky', 'concentrate', 'nii', 'experimental']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `experimental_concentrate registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `experimental_concentrate item must carry ${tag}`);
  }
});

test('using experimental concentrate spends a deterministic risky ration', () => {
  const player = makeTestPlayer({
    id: 154,
    hp: 30,
    maxHp: 100,
    needs: { food: 25, water: 50, sleep: 50, pee: 0, poo: 0 },
  });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 154 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state, 7);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.needs?.food, 57);
  assert.equal(player.hp, 25);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +32')));
  assert.ok(state.msgs.some(line => line.text.includes('-5 HP')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['nii', 'experimental', 'bait_risky'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 7);
});

test('experimental concentrate is reachable through NII and the concentrate press bad batch', () => {
  const nii = generateSlimeNiiDesignFloor();
  const niiColdStorage = nii.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );
  assert.ok(niiColdStorage, 'slime_nii cold storage should expose experimental concentrate as risky lab food');
  assert.equal(niiColdStorage.access, 'locked');

  const world = new World();
  const entities: Entity[] = [];
  generateConcentratePress({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });
  const quarantine = world.containers.find(container =>
    container.tags.includes('concentrate_press_quarantine')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );
  assert.ok(quarantine, 'concentrate press quarantine should expose experimental concentrate as stealable bad batch');
  assert.equal(quarantine.access, 'owner');

  const badBatch = FACTORIES
    .find(factory => factory.id === 'concentrate_press')
    ?.recipes.find(recipe => recipe.id === 'press_gray_briquettes')
    ?.badBatch;
  assert.ok(badBatch?.outputs.some(item => item.defId === ITEM_ID && item.count === 1));
  assert.ok(badBatch?.eventTags?.includes('bad_batch'));
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType } from '../src/core/types';
import { DOCUMENT_ACCESS_MARKET_VALUES } from '../src/data/documents_access';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { makeProceduralFloorSpec } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('blueprint t3 folder is a rare frozen document blueprint', () => {
  const def = ITEMS.blueprint_t3_folder;

  assert.equal(def.name, 'Папка чертежей Т3');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.equal(DOCUMENT_ACCESS_MARKET_VALUES.blueprint_t3_folder, 240);

  for (const tag of ['document', 'blueprint', 'recipe', 'tier3', 'rare', 'frozen', 'deep_route']) {
    assert.ok(def.tags?.includes(tag), `blueprint_t3_folder item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.blueprint_t3_folder?.includes(tag), `blueprint_t3_folder registry must publish ${tag} tag`);
  }
});

test('blueprint t3 folder is reachable from a deep Hladon frozen cache', () => {
  const spec = makeProceduralFloorSpec(1, -46);

  assert.equal(spec.anomalyId, 'hladon');
  assert.ok(spec.depth >= 35);
  assert.ok(spec.danger >= 4);

  const generated = generateProceduralFloor(spec);
  const stash = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'blueprint_t3_folder'),
  );

  assert.ok(stash, 'deep Hladon route floor should expose blueprint_t3_folder');
  assert.equal(stash.kind, ContainerKind.SAFE);
  assert.equal(stash.access, 'locked');
  assert.equal(stash.inventory.find(item => item.defId === 'blueprint_t3_folder')?.count, 1);
  assert.equal(stash.inventory.find(item => item.defId === 'frozen_item_shard')?.count, 1);
  for (const tag of ['hladon', 'cold_cache', 'frozen_item', 'deep_route', 'rare_recipe_unlock', 'theft']) {
    assert.ok(stash.tags.includes(tag), `frozen blueprint cache must publish ${tag} tag`);
  }
});

test('blueprint t3 folder can be spent as a black-market document choice', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'blueprint_t3_folder', count: 1 }], money: 0 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 60 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'blueprint_t3_folder'), 0);
  assert.equal(player.money, 240);
  assert.ok(state.msgs.some(line => line.text.includes('Папка чертежей Т3 продан')));
});

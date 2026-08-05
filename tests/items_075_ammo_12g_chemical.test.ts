import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('chemical 12g shell is explicit NII liquidator ammo with reagent fallback', () => {
  const def = ITEMS.ammo_12g_chemical;

  assert.equal(def.id, 'ammo_12g_chemical');
  assert.equal(def.name, 'Химический патрон 12 калибра');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');

  for (const tag of ['ammo', 'shells', 'chemical', 'nii', 'liquidator', 'reagent', 'special_shell']) {
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
    assert.ok(ITEM_TAGS.ammo_12g_chemical?.includes(tag), `registry must publish ${tag}`);
  }
});

test('chemical 12g shell can be spent as decon reagent until specialty shell selection exists', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'ammo_12g_chemical', count: 2 }] });
  const state = makeGameState({ time: 75 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'ammo_12g_chemical'), 1);
  assert.equal(countInventoryItem(player, 'decon_fluid'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Химический патрон вскрыт')));
});

test('chemical 12g shell is stealable from a Ministry liquidator issue stash', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'ammo_12g_chemical'));
  assert.ok(stash, 'liquidator archive should expose chemical shells');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator_archive'));
  assert.ok(stash.tags.includes('issue_stash'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});

test('chemical 12g shell is reachable from the slime NII quarantine post', () => {
  const gen = generateSlimeNiiDesignFloor();

  const crate = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('liquidator')
    && container.tags.includes('chemical')
    && container.inventory.some(item => item.defId === 'ammo_12g_chemical'),
  );
  assert.ok(crate, 'slime_nii should expose chemical shells through quarantine guard storage');
  assert.equal(crate.access, 'faction');
});

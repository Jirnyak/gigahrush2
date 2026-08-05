import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { WEAPON_STATS } from '../src/data/catalog';
import { generateAmmoSmelter } from '../src/gen/kvartiry/ammo_smelter';

test('homemade pistol keeps its weapon role and points at the gated 9mm route', () => {
  const def = ITEMS.homemade_pistol;
  const stats = WEAPON_STATS.homemade_pistol;

  assert.equal(def.name, 'Кустарный пистолет');
  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(stats.ammoType, 'ammo_9mm');
  assert.equal(stats.isRanged, true);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));

  for (const tag of ['homemade', 'contraband', 'craft_pistol', 'ammo_9mm']) {
    assert.ok(ITEM_TAGS.homemade_pistol?.includes(tag), `homemade_pistol must publish ${tag} tag`);
  }
});

test('homemade ammo instruction gates the illegal 9mm smelter without being consumed', () => {
  const instruction = ITEMS.homemade_ammo_instruction;
  const smelter = FACTORY_BY_ID.illegal_ammo_smelter;
  const recipe = smelter.recipes.find(row => row.id === 'recycle_pistol_rounds');

  assert.equal(instruction.type, ItemType.MISC);
  assert.equal(resourceForItem(instruction.id)?.id, 'paper');
  assert.ok(instruction.tags?.includes('contraband'));
  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [
    { defId: 'metal_sheet', count: 1 },
    { defId: 'homemade_ammo_instruction', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [
    { defId: 'ammo_9mm', count: 6 },
    { defId: 'homemade_ammo_instruction', count: 1 },
  ]);
  assert.ok(recipe.outputTags.includes('homemade'));
});

test('Kvartiry ammo smelter exposes the pistol and reusable ammo instruction', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateAmmoSmelter(world, 0, entities, { v: 1 }, 512, 512);

  assert.ok(entities.some(entity => entity.inventory?.some(item => item.defId === 'homemade_pistol')));
  assert.ok(world.containers.some(container => container.inventory.some(item => item.defId === 'homemade_ammo_instruction')));
});

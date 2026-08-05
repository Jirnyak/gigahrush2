import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const MOTOR_NODE_ID = 'slime_motor_node';

test('slime motor node is a rare NII slime aftermath sample', () => {
  const def = ITEMS[MOTOR_NODE_ID];

  assert.equal(def.id, MOTOR_NODE_ID);
  assert.equal(def.name, 'Моторный узел слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.08);
  assert.equal(getStack(def), 3);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['slime', 'sample', 'organ', 'movement', 'nii', 'aftermath', 'evidence', 'trade', 'legal_handoff']) {
    assert.ok(ITEM_TAGS[MOTOR_NODE_ID]?.includes(tag), `slime_motor_node registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `slime_motor_node item must carry ${tag}`);
  }
});

test('slime motor node is stealable from slime NII cold storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === MOTOR_NODE_ID && item.count === 1),
  );

  assert.ok(cabinet, 'slime_nii should expose slime_motor_node through locked cold storage');
  assert.equal(cabinet.access, 'locked');
});

test('slime motor node is a trade sample the player can save or risk opening', () => {
  const player = makeTestPlayer({ inventory: [{ defId: MOTOR_NODE_ID, count: 1 }] });
  const info = getInventorySlotActionInfo(player, 0);

  assert.equal(info?.category, 'trade');
  assert.equal(info?.canDrop, true);
  assert.equal(info?.canUse, true);
  assert.equal(info?.useLabel, 'Enter вскрыть пробу');
});

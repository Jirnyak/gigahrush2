import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, FloorLevel, ItemType, MonsterKind, QuestType, RoomType, type Entity } from '../src/core/types';
import { CONTRACTS } from '../src/data/contracts';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { resourceForItem } from '../src/data/resources';
import { dropMonsterRareLoot } from '../src/systems/monster_drops';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'mutant_tissue_sample';

function testMonster(kind: MonsterKind): Entity {
  return {
    id: 7,
    type: EntityType.MONSTER,
    x: 12.5,
    y: 14.5,
    angle: 0,
    pitch: 0,
    alive: false,
    speed: 0,
    sprite: 0,
    monsterKind: kind,
  };
}

test('mutant tissue sample is a non-generic ecology proof item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Образец ткани твари');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(getStack(def), 4);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['sample', 'monster', 'ecology', 'evidence', 'nii', 'trade', 'legal_handoff']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `mutant_tissue_sample registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `mutant_tissue_sample item must carry ${tag}`);
  }

  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }] });
  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.canUse, true);
  assert.equal(info?.useLabel, 'Enter вскрыть пробу');
  assert.equal(info?.canDrop, true);
});

test('mutant tissue sample is reachable through monster ecology drops', () => {
  const sourceKinds = [MonsterKind.KRYSNOZHKA, MonsterKind.POLZUN];
  for (const kind of sourceKinds) {
    const ecology = MONSTER_ECOLOGY.find(def => def.kind === kind);
    assert.ok(ecology, `${MonsterKind[kind]} ecology must exist`);
    assert.equal(ecology.rareDrops.some(drop => drop.itemId === ITEM_ID), true);
  }

  const entities: Entity[] = [];
  const nextId = { v: 100 };
  const rolls = [0.99, 0.0, 0.5, 0.5];
  const dropped = dropMonsterRareLoot(testMonster(MonsterKind.KRYSNOZHKA), entities, nextId, () => rolls.shift() ?? 0.5);

  assert.equal(dropped?.itemId, ITEM_ID);
  assert.equal(dropped?.count, 1);
  assert.equal(nextId.v, 101);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].type, EntityType.ITEM_DROP);
  assert.deepEqual(entities[0].inventory, [{ defId: ITEM_ID, count: 1 }]);
});

test('mutant tissue sample has an NII handoff contract decision', () => {
  const contract = CONTRACTS.find(def => def.id === 'exp_hunter_mutant_tissue_sample');

  assert.ok(contract);
  assert.equal(contract.type, QuestType.FETCH);
  assert.equal(contract.faction, Faction.SCIENTIST);
  assert.equal(contract.target.floor, FloorLevel.LIVING);
  assert.equal(contract.target.roomType, RoomType.CORRIDOR);
  assert.equal(contract.targetMonsterKind, MonsterKind.KRYSNOZHKA);
  assert.equal(contract.targetItem, ITEM_ID);
  assert.equal(contract.targetCount, 1);
  assert.equal(contract.rewardItem, 'nii_sample_container');
  assert.equal(contract.rewardResourceId, 'slime_samples');
  for (const tag of ['science', 'ecology', 'sample', 'monster', 'handoff']) {
    assert.ok(contract.tags.includes(tag), `contract must publish ${tag}`);
  }
});

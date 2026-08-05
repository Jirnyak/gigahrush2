import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, ItemType, QuestType, RoomType } from '../src/core/types';
import { CONTRACTS } from '../src/data/contracts';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('body bag roll is medical aftermath gear with cleanup tags', () => {
  const def = ITEMS.body_bag_roll;

  assert.equal(def.type, ItemType.MISC);
  assert.equal(def.name, 'Рулон мешков для тел');
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.MEDICAL]);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');

  for (const tag of ['cleanup', 'corpse', 'liquidator', 'evidence', 'samosbor', 'trade']) {
    assert.ok(ITEM_TAGS.body_bag_roll?.includes(tag), `body_bag_roll must publish ${tag} tag`);
  }
});

test('body bag roll supports report and hide contract decisions', () => {
  const byId = new Map(CONTRACTS.map(contract => [contract.id, contract]));
  const report = byId.get('medpost_body_bag_report');
  const hide = byId.get('hospital_body_bag_hide');

  assert.ok(report);
  assert.ok(hide);
  assert.equal(report.type, QuestType.FETCH);
  assert.equal(hide.type, QuestType.FETCH);
  assert.equal(report.targetItem, 'body_bag_roll');
  assert.equal(hide.targetItem, 'body_bag_roll');
  assert.equal(report.target.floor, FloorLevel.LIVING);
  assert.equal(hide.target.floor, FloorLevel.LIVING);
  assert.equal(report.target.roomType, RoomType.MEDICAL);
  assert.equal(hide.target.roomType, RoomType.MEDICAL);
  assert.equal(report.rewardResourceId, 'medicine');
  assert.equal(hide.rewardResourceId, 'medicine');

  assert.equal(report.faction, Faction.LIQUIDATOR);
  assert.ok(report.tags.includes('report'));
  assert.ok(report.tags.includes('evidence'));

  assert.equal(hide.faction, Faction.WILD);
  assert.ok(hide.tags.includes('hide'));
  assert.ok(hide.tags.includes('conceal'));
});

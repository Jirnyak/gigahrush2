import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('antiemetic is a medical nausea item with a bounded use effect', () => {
  const def = ITEMS.antiemetic;

  assert.ok(def);
  assert.equal(def.name, 'Противорвотное');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL]);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');

  for (const tag of ['medicine', 'nausea', 'food_safety']) {
    assert.ok(def.tags?.includes(tag), `antiemetic item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.antiemetic?.includes(tag), `antiemetic tags must publish ${tag} tag`);
  }

  const patient: Entity = { id: 1, type: EntityType.NPC, persistentNpcId: 'player', x: 0, y: 0, hp: 40, maxHp: 45 };
  assert.equal(def.use?.(patient), 'Тошноту заглушило. Лечение +8; еду пока держит внутри');
  assert.equal(patient.hp, 45);
});

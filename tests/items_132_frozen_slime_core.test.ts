import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateHladonets } from '../src/gen/maintenance/hladonets';

function itemDropIds(entities: readonly Entity[]): string[] {
  const ids: string[] = [];
  for (const entity of entities) {
    if (entity.type !== EntityType.ITEM_DROP || !entity.inventory) continue;
    for (const item of entity.inventory) ids.push(item.defId);
  }
  return ids;
}

test('frozen slime core is a cold-route NII proof sample', () => {
  const def = ITEMS.frozen_slime_core;

  assert.equal(def.id, 'frozen_slime_core');
  assert.equal(def.name, 'Замороженное ядро слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(def.spawnW > 0 && def.spawnW < 0.1, true);
  assert.equal(getStack(def), 3);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(def.use, undefined, 'frozen proof stays trade/handoff material, not an active use item');

  for (const tag of ['slime', 'sample', 'frozen', 'cold', 'calcified', 'nii', 'aftermath', 'evidence']) {
    assert.ok(ITEM_TAGS.frozen_slime_core?.includes(tag), `frozen_slime_core must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `frozen_slime_core def must carry ${tag}`);
  }
});

test('frozen slime core drops from Hladonets cold aftermath', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateHladonets({ world, entities, nextId: { v: 1 }, spawnX: 96, spawnY: 96 });

  const drops = itemDropIds(entities);
  assert.equal(drops.includes('frozen_slime_core'), true);
  assert.equal(drops.includes('frozen_item_shard'), true);
});

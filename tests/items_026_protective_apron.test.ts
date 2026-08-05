import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeSamplePost } from '../src/gen/maintenance/slime_sample_post';

test('protective apron is NII cleanup evidence with tool scarcity pressure', () => {
  const def = ITEMS.protective_apron;

  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.STORAGE]);
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['nii', 'cleanup', 'liquidator', 'acid', 'evidence', 'trade']) {
    assert.ok(ITEM_TAGS.protective_apron?.includes(tag), `protective_apron must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `protective_apron definition must carry ${tag} tag`);
  }
});

test('protective apron is reachable at the NII sample post through trade or theft', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateSlimeSamplePost({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const bokova = entities.find(entity => entity.type === EntityType.NPC && entity.plotNpcId === 'ag62_nii_bokova');
  assert.ok(bokova, 'Bokova should spawn at the NII sample post');
  assert.ok(bokova.inventory?.some(item => item.defId === 'protective_apron'), 'Bokova should offer the apron through NPC trade');

  const ownerCabinet = world.containers.find(container => container.inventory.some(item => item.defId === 'protective_apron'));
  assert.ok(ownerCabinet, 'Bokova sample cabinet should expose a stealable apron');
  assert.equal(ownerCabinet.access, 'owner');
  assert.equal(ownerCabinet.faction, Faction.SCIENTIST);
  assert.ok(ownerCabinet.tags.includes('theft'));
  assert.ok(ownerCabinet.tags.includes('nii'));
});

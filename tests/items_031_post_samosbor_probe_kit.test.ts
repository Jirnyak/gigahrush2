import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';

test('post-samosbor probe kit is high-value NII/liquidator handoff evidence', () => {
  const def = ITEMS.post_samosbor_probe_kit;

  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.MEDICAL]);
  assert.equal(def.stack, 1);
  assert.equal(def.value >= 250, true);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['samosbor', 'aftermath', 'nii', 'liquidator', 'evidence', 'handoff']) {
    assert.ok(ITEM_TAGS.post_samosbor_probe_kit?.includes(tag), `post_samosbor_probe_kit must publish ${tag} tag`);
  }
});

test('post-samosbor probe kit is reachable from the Ministry liquidator archive', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'post_samosbor_probe_kit'));
  assert.ok(stash, 'liquidator archive should expose post_samosbor_probe_kit');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator_archive'));
  assert.ok(stash.tags.includes('evidence'));
});

test('post-samosbor probe kit is reachable from the slime NII route floor', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('science')
    && container.inventory.some(item => item.defId === 'post_samosbor_probe_kit'),
  );
  assert.ok(cabinet, 'slime_nii should expose post_samosbor_probe_kit through science storage');
  assert.equal(cabinet.access, 'owner');
});

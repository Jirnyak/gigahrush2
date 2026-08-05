import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateBrownSlimeCleanup } from '../src/gen/maintenance/brown_slime_cleanup';
import { cleanupToolProfile, SLIME_SCRAPER_ID } from '../src/systems/liquidator_cleanup_items';

test('slime scraper is low-tech cleanup gear with durability and resource pressure', () => {
  const def = ITEMS[SLIME_SCRAPER_ID];

  assert.equal(def.type, ItemType.TOOL);
  assert.equal(def.durability, 64);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['cleanup', 'manual_cleanup', 'slime', 'brown_slime', 'liquidator']) {
    assert.ok(ITEM_TAGS[SLIME_SCRAPER_ID]?.includes(tag), `slime_scraper must publish ${tag} tag`);
  }
});

test('slime scraper has a bounded cleanup tool profile below the cleaning kit', () => {
  const scraper = cleanupToolProfile(SLIME_SCRAPER_ID);
  const kit = cleanupToolProfile('cleaning_kit');

  assert.ok(scraper);
  assert.ok(kit);
  assert.equal(scraper.hazardReason, 'tool');
  assert.equal(scraper.relationEvery, 0);
  assert.ok(scraper.surfaceRadius < kit.surfaceRadius);
  assert.ok(scraper.hazardRadius < kit.hazardRadius);
  assert.ok(scraper.cooldown > kit.cooldown);
});

test('slime scraper is reachable in the brown slime cleanup room', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateBrownSlimeCleanup({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const room = world.rooms.find(r => r.name === 'Сухой обход: коричневая слизь');
  assert.ok(room, 'brown slime cleanup room should be generated');

  const dropIds = entities
    .filter(e => e.type === EntityType.ITEM_DROP)
    .flatMap(e => e.inventory ?? [])
    .map(item => item.defId);
  assert.ok(dropIds.includes(SLIME_SCRAPER_ID), 'room loot should expose slime_scraper');

  const npc = entities.find(e => e.type === EntityType.NPC && e.name === 'Трофим Санобход');
  assert.ok(npc?.inventory?.some(item => item.defId === SLIME_SCRAPER_ID), 'cleanup NPC should carry slime_scraper for trade/steal');
});

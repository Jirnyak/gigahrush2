import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS } from '../src/data/items';
import { METRO_DEPOT_ROOM_NAME } from '../src/data/metro';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { generateMetroErrorLine } from '../src/gen/maintenance/metro_error_line';

const ITEM_ID = 'track_diagram_scrap';

test('track diagram scrap is a scarce rail document clue', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Обрывок схемы путей');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.CORRIDOR));
  assert.equal(def.stack, 1);
  assert.equal(def.spawnW > 0 && def.spawnW < 0.3, true);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCE_BY_ID.documents.itemIds.includes(def.id));

  for (const tag of ['rail', 'document', 'evidence', 'route']) {
    assert.ok(def.tags?.includes(tag), `track_diagram_scrap must publish ${tag}`);
  }
});

test('track diagram scrap is reachable from office filing cabinets', () => {
  const filingCabinet = CONTAINER_DEFS[ContainerKind.FILING_CABINET];
  const entry = filingCabinet.itemPool.find(item => item.defId === ITEM_ID);

  assert.ok(filingCabinet.roomTypes.includes(RoomType.OFFICE));
  assert.ok(entry, 'office filing cabinets should expose track_diagram_scrap');
  assert.equal(entry.min, 1);
  assert.equal(entry.max, 1);
  assert.equal((entry.chance ?? 1) <= 0.12, true);
});

test('track diagram scrap can be found in the maintenance metro depot', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateMetroErrorLine({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const depot = world.rooms.find(room => room?.name === METRO_DEPOT_ROOM_NAME);
  assert.ok(depot, 'metro depot room should exist');

  const source = entities.find(entity =>
    entity.type === EntityType.ITEM_DROP
    && entity.inventory?.some(item => item.defId === ITEM_ID)
    && world.roomAt(entity.x, entity.y)?.id === depot.id
  );
  assert.ok(source, 'metro depot should expose a track_diagram_scrap drop');
});

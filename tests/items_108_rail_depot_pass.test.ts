import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, EntityType, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { METRO_DEPOT_ROOM_NAME } from '../src/data/metro';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateMetroErrorLine } from '../src/gen/maintenance/metro_error_line';
import { generateDocumentGate } from '../src/gen/ministry/document_gate';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const PASS_ID = 'rail_depot_pass';

test('rail depot pass is official transport access paperwork', () => {
  const def = ITEMS[PASS_ID];

  assert.equal(def.id, PASS_ID);
  assert.equal(def.name, 'Пропуск в депо');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'permit', 'official', 'rail', 'transport', 'access', 'document_gate']) {
    assert.ok(ITEM_TAGS[PASS_ID]?.includes(tag), `rail_depot_pass must publish ${tag}`);
  }
});

test('rail depot pass is reachable in the maintenance transport depot', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateMetroErrorLine({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const depot = world.rooms.find(room => room?.name === METRO_DEPOT_ROOM_NAME);
  assert.ok(depot, 'metro depot room should exist');

  const source = entities.find(entity =>
    entity.type === EntityType.ITEM_DROP
    && entity.inventory?.some(item => item.defId === PASS_ID)
    && world.roomAt(entity.x, entity.y)?.id === depot.id
  );
  assert.ok(source, 'metro depot should expose a rail_depot_pass drop');
});

test('rail depot pass opens the Ministry N3 document gate as legal access', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateDocumentGate(world, 1, entities, { v: 1 }, 512, 512);
  const room = world.rooms.find(item => item?.name === 'Проверочный коридор N3');
  assert.ok(room, 'document gate room must exist');

  const gateDoorIdx = room.doors.find(idx => world.doors.get(idx)?.state === DoorState.LOCKED);
  assert.notEqual(gateDoorIdx, undefined, 'document gate should have a locked internal door');

  const player = makeTestPlayer({
    x: room.x + 8.5,
    y: room.y + Math.floor(room.h / 2) + 0.5,
  });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 108 });

  assert.equal(addItem(player, PASS_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');

  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, PASS_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Пропуск в депо')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', tags: ['access_granted'], limit: 1 })[0];
  assert.equal(event?.itemId, PASS_ID);
  assert.equal(event?.data?.method, 'legal');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('rail'));
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('transport'));
});

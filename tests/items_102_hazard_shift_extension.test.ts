import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateDocumentGate } from '../src/gen/ministry/document_gate';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'hazard_shift_extension';

test('hazard shift extension is a reachable production/HQ permit document', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Допуск на сверхсмену');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'permit', 'official', 'hazard', 'production', 'quarantine', 'access', 'document_gate']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `hazard_shift_extension must publish ${tag}`);
  }
});

test('hazard shift extension opens the Ministry N3 gate as risky legal access', () => {
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
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 102 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');

  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, ITEM_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Допуск на сверхсмену открыл проход')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.data?.method, 'legal');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('hazard'));
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('production'));
});

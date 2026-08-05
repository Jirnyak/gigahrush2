import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateHospitalQuarantine } from '../src/gen/living/hospital_quarantine';
import { generateDocumentGate } from '../src/gen/ministry/document_gate';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const NOTICE_ID = 'quarantine_breach_notice';

test('quarantine breach notice is reachable quarantine evidence paperwork', () => {
  const def = ITEMS[NOTICE_ID];

  assert.equal(def.id, NOTICE_ID);
  assert.equal(def.name, 'Извещение о нарушении карантина');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'quarantine', 'breach', 'evidence', 'audit']) {
    assert.ok(ITEM_TAGS[NOTICE_ID]?.includes(tag), `quarantine_breach_notice must publish ${tag}`);
  }
});

test('quarantine breach notice can be stolen from the hospital quarantine filing cabinet', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateHospitalQuarantine(world, 1, entities, { v: 1 }, 512, 512);

  const source = world.containers.find(container =>
    container.name === 'Картотека зараженных'
    && container.inventory.some(item => item.defId === NOTICE_ID)
  );

  assert.ok(source, 'hospital quarantine filing cabinet should expose quarantine_breach_notice');
  assert.equal(source.access, 'faction');
  assert.ok(source.tags.includes('documents'));
  assert.ok(source.tags.includes('violation'));
});

test('quarantine breach notice exposes a quarantine case at Ministry N3', () => {
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
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 96 });

  assert.equal(addItem(player, NOTICE_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');
  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, NOTICE_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Извещение о нарушении карантина')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', tags: ['expose', 'evidence'], limit: 1 })[0];
  assert.equal(event?.itemId, NOTICE_ID);
  assert.equal(event?.data?.method, 'expose');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('quarantine'));
});

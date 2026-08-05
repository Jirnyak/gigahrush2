import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { generateDocumentGate } from '../src/gen/ministry/document_gate';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const CARD_ID = 'labor_shift_card';

test('labor shift card is official production access paperwork', () => {
  const def = ITEMS[CARD_ID];

  assert.equal(def.id, CARD_ID);
  assert.equal(def.name, 'Карта смены');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.stack, 8);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'permit', 'official', 'labor', 'production', 'access', 'document_gate']) {
    assert.ok(ITEM_TAGS[CARD_ID]?.includes(tag), `labor_shift_card registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `labor_shift_card item must carry ${tag}`);
  }

  const player = makeTestPlayer();
  assert.equal(addItem(player, CARD_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');
});

test('labor shift card is reachable from production belt shift lockers', () => {
  const gen = generateDesignFloor('production_belt');
  const source = gen.world.containers.find(container =>
    container.name === 'Открытые шкафчики смены' &&
    container.inventory.some(item => item.defId === CARD_ID && item.count >= 2)
  );

  assert.ok(source, 'production belt shift lockers should expose labor_shift_card');
  assert.equal(source.access, 'public');
  assert.ok(source.tags.includes('shift'));
});

test('labor shift card opens the Ministry N3 gate without consuming the card', () => {
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
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 101 });

  assert.equal(addItem(player, CARD_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, CARD_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Карта смены')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', tags: ['legal'], limit: 1 })[0];
  assert.equal(event?.itemId, CARD_ID);
  assert.equal(event?.data?.method, 'legal');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('production'));
});

test('labor shift card can be sold instead of saved for access', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 102 });

  assert.equal(addItem(player, CARD_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, CARD_ID), 0);
  assert.equal(player.money, 18);

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, CARD_ID);
  assert.equal(sale?.data?.outcome, 'black_market_document_sale');
  assert.equal(sale?.data?.rewardMoney, 18);
});

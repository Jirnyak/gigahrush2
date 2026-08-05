import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeSingingVents } from '../src/gen/maintenance/slime_singing_vents';
import { getRecentEvents } from '../src/systems/events';
import { useItem } from '../src/systems/inventory';
import { getRecentNoiseRecords, resetNoiseRecords } from '../src/systems/noise';
import { addTestRoom, countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('smoke candle check is maintenance vent inspection stock', () => {
  const def = ITEMS.smoke_candle_check;

  assert.equal(def.name, 'Дымовая шашка проверки тяги');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['liquidator', 'cleanup', 'smoke', 'vent_check', 'counterplay', 'maintenance']) {
    assert.ok(ITEM_TAGS.smoke_candle_check?.includes(tag), `smoke_candle_check must publish ${tag}`);
  }
});

test('using smoke candle consumes one item and publishes a bounded vent check event', () => {
  resetNoiseRecords();
  const world = new World();
  const room = addTestRoom(world, {
    id: 3,
    type: RoomType.PRODUCTION,
    x: 20,
    y: 20,
    w: 8,
    h: 8,
    zoneId: 4,
    name: 'Тестовый вентканал',
  });
  const player = makeTestPlayer({
    x: 23.5,
    y: 23.5,
    inventory: [{ defId: 'smoke_candle_check', count: 1 }],
  });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 42 });

  useItem(player, 0, state.msgs, state.time, state, 4, world);

  assert.equal(countInventoryItem(player, 'smoke_candle_check'), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Тяга есть')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['vent_check'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.itemId, 'smoke_candle_check');
  assert.equal(event.roomId, room.id);
  assert.equal(event.zoneId, 4);
  assert.equal(event.data?.result, 'pulling_draft');
  assert.equal(event.data?.noGasSimulation, true);

  const noise = getRecentNoiseRecords(state, { source: 'decoy', limit: 1 })[0];
  assert.ok(noise);
  assert.equal(noise.itemId, 'smoke_candle_check');
  assert.equal(noise.radius <= 5, true);
  assert.equal(noise.tags.includes('vent_check'), true);
});

test('maintenance slime-singing vent stash exposes smoke candle checks', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateSlimeSingingVents({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'smoke_candle_check'));
  assert.ok(stash, 'slime-singing vent sample stash should expose smoke candles');
  assert.equal(stash.inventory.find(item => item.defId === 'smoke_candle_check')?.count, 2);
  assert.equal(stash.floor, FloorLevel.MAINTENANCE);
  assert.equal(stash.tags.includes('route_cue'), true);
  assert.equal(entities.some(entity => entity.type === EntityType.MONSTER), true);
});

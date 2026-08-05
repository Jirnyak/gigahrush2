import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Feature, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { generateHladonets } from '../src/gen/maintenance/hladonets';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { makeGameState } from './helpers';

function itemDropIds(entities: readonly Entity[]): string[] {
  const ids: string[] = [];
  for (const entity of entities) {
    if (entity.type !== EntityType.ITEM_DROP || !entity.inventory) continue;
    for (const item of entity.inventory) ids.push(item.defId);
  }
  return ids;
}

function roomHasFeature(world: World, roomId: number, feature: Feature): boolean {
  const room = world.rooms[roomId];
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === roomId && world.features[ci] === feature) return true;
    }
  }
  return false;
}

test('Monster 18 Hladonets generates a local cold pocket and steam counter event', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateHladonets({ world, entities, nextId: { v: 1 }, spawnX: 96, spawnY: 96 });

  const coldRoom = world.rooms.find(room => room.name.startsWith('Хладон:') && room.name.includes('Хладонца'));
  assert.ok(coldRoom, 'Hladonets needs an active Hladon-prefixed room');
  assert.equal(roomHasFeature(world, coldRoom.id, Feature.APPARATUS), true, 'cold room needs an interactable steam/heat control');

  const threat = entities.find(entity => entity.name === 'Хладонец');
  assert.ok(threat, 'Hladonets threat should be spawned');
  assert.equal(threat.type, EntityType.MONSTER);
  assert.equal(threat.monsterKind, MonsterKind.SHADOW);

  const drops = itemDropIds(entities);
  assert.equal(drops.includes('boiler_water'), true, 'encounter should provide boiler water counterplay');
  assert.equal(drops.includes('asbestos_cord'), true, 'encounter should leave asbestos cord trace');
  assert.equal(drops.includes('valve_tag'), true, 'encounter should leave a valve tag trace');

  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    worldEvents: createWorldEventState(),
  });
  const beforeHp = threat.hp ?? 0;
  const beforeSpeed = threat.speed;
  publishEvent(state, {
    type: 'player_use_item',
    roomId: coldRoom.id,
    zoneId: 0,
    x: threat.x,
    y: threat.y,
    actorId: 1,
    actorName: 'Вы',
    itemId: 'boiler_water',
    itemName: 'Кипяток',
    severity: 4,
    privacy: 'local',
    tags: ['player', 'anomaly', 'cold', 'hladon', 'cold_cleared'],
    data: { system: 'hladon_cold_pocket', kind: 'cleared', method: 'boiler_water' },
  });

  assert.ok((threat.hp ?? 0) < beforeHp, 'steam clear should weaken Hladonets HP');
  assert.ok(threat.speed < beforeSpeed, 'steam clear should slow Hladonets');
  const event = getRecentEvents(state, { tags: ['hladonets', 'steam_vented'], limit: 1 })[0];
  assert.ok(event, 'steam weakening should publish a Hladonets event');
  assert.equal(event.data?.phase, 'steam_vented');
});

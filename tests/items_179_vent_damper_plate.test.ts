import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ContainerKind,
  EntityType,
  Faction,
  FloorLevel,
  ItemType,
  MonsterKind,
  RoomType,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { addItem, getInventorySlotActionInfo, useItem } from '../src/systems/inventory';
import { registerSwarmNestSource, SWARM_SOURCE_STAGE } from '../src/systems/swarm_nests';
import { makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'vent_damper_plate';

function swarmSource(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    hp: 12,
    maxHp: 12,
    faction: Faction.WILD,
    monsterKind: MonsterKind.SWARM,
    monsterStage: SWARM_SOURCE_STAGE,
  };
}

test('vent damper plate is Maintenance repair stock with tool resource pressure', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Заслонка вентиляции');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR]);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['vent', 'repair', 'maintenance', 'temporary_seal', 'counterplay', 'samosbor']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `vent_damper_plate registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `vent_damper_plate item must carry ${tag}`);
  }

  assert.ok(
    CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool.some(item => item.defId === ITEM_ID),
    'Maintenance tool lockers should expose vent damper plates',
  );
});

test('vent damper plate can be spent to seal a nearby swarm vent source', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const source = swarmSource(2, 10.4, 10.2);
  const entities = [player, source];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 179 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter заклеить');

  registerSwarmNestSource(world, {
    id: 'test_vent_damper_plate',
    x: source.x,
    y: source.y,
    sourceEntityId: source.id,
  });
  rebuildEntityIndex(entities);

  useItem(player, 0, state.msgs, state.time, state, 0, world);

  assert.equal(player.inventory?.some(item => item.defId === ITEM_ID), false);
  assert.equal(source.alive, false);
  assert.ok(state.msgs.some(line => line.text.includes('Рой потерял источник')));

  const event = getRecentEvents(state, { type: 'swarm_source_sealed', tags: ['swarm', 'sealed'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.monsterKind, MonsterKind.SWARM);
  assert.equal(event?.data?.counterplay, 'seal_vent');
});

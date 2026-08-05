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
  type Msg,
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

test('hermetic tape is stackable storage/medical seal gear with resource pressure', () => {
  const def = ITEMS.hermetic_tape;

  assert.equal(def.name, 'Гермолента');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.MEDICAL]);
  assert.equal(def.stack, 8);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['temporary_seal', 'cleanup', 'technical_cleanup', 'counterplay']) {
    assert.ok(ITEM_TAGS.hermetic_tape?.includes(tag), `hermetic_tape must publish ${tag}`);
  }

  assert.ok(
    CONTAINER_DEFS[ContainerKind.MEDICAL_CABINET].itemPool.some(item => item.defId === def.id),
    'medical cabinets should expose hermetic tape',
  );
  assert.ok(
    CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool.some(item => item.defId === def.id),
    'storage tool lockers should expose hermetic tape',
  );
});

test('hermetic tape seals a nearby swarm source through the shared inventory use path', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const source = swarmSource(2, 10.6, 10.3);
  const entities = [player, source];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 5 });
  const msgs: Msg[] = [];

  assert.equal(addItem(player, 'hermetic_tape', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter заклеить');

  registerSwarmNestSource(world, {
    id: 'test_hermetic_tape',
    x: source.x,
    y: source.y,
    sourceEntityId: source.id,
  });
  rebuildEntityIndex(entities);

  useItem(player, 0, msgs, 5, state, 0, world);

  assert.equal(player.inventory?.some(item => item.defId === 'hermetic_tape'), false);
  assert.equal(source.alive, false);
  assert.ok(msgs.some(line => /Рой потерял источник/.test(line.text)));

  const event = getRecentEvents(state, { type: 'swarm_source_sealed', tags: ['swarm', 'sealed'], limit: 1 })[0];
  assert.equal(event?.itemId, 'hermetic_tape');
  assert.equal(event?.monsterKind, MonsterKind.SWARM);
});

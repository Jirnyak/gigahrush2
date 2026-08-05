import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, Occupation, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/mukhozhuk';
import { MONSTERS } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import {
  MUKHOZHUK_COMMAND_SCAN_CAP,
  commandMukhozhukNearby,
  setEntityMap,
  updateMonster,
} from '../src/systems/ai/monster';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { addTestRoom, makeGameState, makeTestContainer, makeTestNpc, makeTestPlayer } from './helpers';

function ministryWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.roomMap.fill(0);
  world.zoneMap.fill(0);
  addTestRoom(world, {
    id: 0,
    type: RoomType.HQ,
    x: 6,
    y: 6,
    w: 18,
    h: 18,
    name: 'Кабинет больного приказа',
  });
  return world;
}

function mukhozhuk(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 12,
    y: 12,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.MUKHOZHUK_HOST,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: 12, ty: 12, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  getEntityIndex().beginTelemetryFrame();
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('mukhozhuk host keeps standalone parasite registry, ecology, rumors and sprite', () => {
  const ecology = getMonsterEcology(MonsterKind.MUKHOZHUK_HOST);
  const sprite = generateSprite();
  let opaque = 0;
  let green = 0;
  let shell = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (g > r + 20 && g > b) green++;
    if (r > 25 && r < 95 && g < 90 && b < 65) shell++;
  }

  assert.equal(DEF.kind, MonsterKind.MUKHOZHUK_HOST);
  assert.equal(MONSTERS[MonsterKind.MUKHOZHUK_HOST], DEF);
  assert.deepEqual(DEF.aiFlags, ['parasiteLeader', 'foodBait']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE]);
  assert.match(DEF.counterplay ?? '', /свидетел|карантин|крика/i);
  assert.match(DEF.lootHint ?? '', /хитин|приказ|карточка/i);
  assert.equal(ecology?.rare, true);
  assert.equal(ecology?.rooms.includes(RoomType.HQ), true);
  assert.equal(ecology?.rumorIds.includes('monster_mukhozhuk_host_command'), true);
  assert.equal(RUMORS.some(r => r.id === 'ecology_mukhozhuk_quarantine'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 520, true, 'sprite should read as a full infected host');
  assert.equal(green > 0, true, 'sprite should include sick green parasite highlights');
  assert.equal(shell > 30, true, 'sprite should include dark beetle carapace');
});

test('mukhozhuk command pulse is local, capped and does not draft ordinary civilians', () => {
  const world = ministryWorld();
  const player = makeTestPlayer({ id: 1, x: 13, y: 12, hp: 100, maxHp: 100 });
  const host = mukhozhuk();
  const civilian = makeTestNpc({
    id: 3,
    x: 12.5,
    y: 12.2,
    faction: Faction.CITIZEN,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  const strongGuard = makeTestNpc({
    id: 4,
    x: 12.8,
    y: 11.8,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    hp: 180,
    maxHp: 180,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  const guards = Array.from({ length: 24 }, (_, i) => makeTestNpc({
    id: 10 + i,
    x: 11.2 + (i % 6) * 0.45,
    y: 11.2 + Math.floor(i / 6) * 0.45,
    faction: i % 5 === 0 ? Faction.CULTIST : Faction.LIQUIDATOR,
    occupation: i % 5 === 0 ? Occupation.PILGRIM : Occupation.HUNTER,
    hp: 70,
    maxHp: 70,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  }));
  const entities = [player, host, civilian, strongGuard, ...guards];
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  const commanded = commandMukhozhukNearby(world, host, player, 12, msgs, state);

  assert.equal(commanded, 4);
  assert.equal(civilian.ai?.combatTargetId, undefined);
  assert.equal(strongGuard.ai?.combatTargetId, undefined);
  assert.equal(guards.filter(g => g.ai?.combatTargetId === player.id).length, 4);
  assert.equal(getEntityIndex().getDebugStats().queries.maxResultCount <= MUKHOZHUK_COMMAND_SCAN_CAP, true);
  const event = getRecentEvents(state, { type: 'mukhozhuk_exposed', tags: ['mukhozhuk', 'command_pulse'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.commandedCount, 4);
  assert.equal(event.data?.commandScanCap, MUKHOZHUK_COMMAND_SCAN_CAP);
});

test('idle mukhozhuk spoils nearby food containers through local appetite', () => {
  const world = ministryWorld();
  const player = makeTestPlayer({ id: 1, x: 70, y: 70, hp: 100, maxHp: 100 });
  const host = mukhozhuk({ x: 12.5, y: 12.5 });
  const container = makeTestContainer({
    id: 44,
    x: 12,
    y: 12,
    floor: FloorLevel.MINISTRY,
    roomId: 0,
    zoneId: 0,
    name: 'Запас ревизии',
    inventory: [{ defId: 'liquidator_ration', count: 1 }, { defId: 'alcohol_bottle', count: 1 }],
    capacitySlots: 4,
    tags: ['food', 'audit'],
  });
  world.addContainer(container);
  const entities = [player, host];
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, host, 0.5, 20, msgs, player.id, { v: 50 }, state);

  assert.equal(container.inventory.some(item => item.defId === 'sand_spoiled_ration'), true);
  assert.equal(container.tags.includes('mukhozhuk_spoiled'), true);
  const event = getRecentEvents(state, { type: 'mukhozhuk_food_spoiled', tags: ['mukhozhuk', 'food_spoiled'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.containerId, 44);
  assert.equal(event.data?.spoiledItemId, 'liquidator_ration');
});

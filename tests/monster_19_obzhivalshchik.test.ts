import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, DoorState, EntityType, Faction, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/obzhivalshchik';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { resetNoiseRecords } from '../src/systems/noise';
import { clearRoomMemory } from '../src/systems/room_memory';
import { addTestRoom, makeGameState } from './helpers';

function makeWorld(): { world: World; homeId: number; corridorId: number } {
  const world = new World();
  world.cells.fill(Cell.WALL);
  world.zoneMap.fill(0);
  const home = addTestRoom(world, {
    id: 0,
    x: 10,
    y: 10,
    w: 6,
    h: 6,
    type: RoomType.LIVING,
    name: 'Скребущая квартира',
    zoneId: 0,
  });
  const corridor = addTestRoom(world, {
    id: 1,
    x: 17,
    y: 12,
    w: 8,
    h: 3,
    type: RoomType.CORRIDOR,
    name: 'Коридор жалоб',
    zoneId: 0,
  });
  const doorIdx = world.idx(16, 13);
  world.cells[doorIdx] = Cell.DOOR;
  world.roomMap[doorIdx] = -1;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.OPEN, roomA: home.id, roomB: corridor.id, keyId: '', timer: 0 });
  home.doors.push(doorIdx);
  corridor.doors.push(doorIdx);
  return { world, homeId: home.id, corridorId: corridor.id };
}

function player(x: number, y: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    name: 'Вы',
    faction: Faction.PLAYER,
  };
}

function obzhivalshchik(x: number, y: number): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.OBZHIVALSHCHIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[], listener: Entity): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(entity => [entity.id, entity])));
  setListenerPos(listener.x, listener.y);
}

test('Obzhivalshchik is registered as standalone room-bound monster content', () => {
  const ecology = getMonsterEcology(MonsterKind.OBZHIVALSHCHIK);
  const sprite = generateSprite();
  let opaque = 0;
  let redEyes = 0;
  let paleGrowth = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 180 && g < 60 && b < 60) redEyes++;
    if (r > 140 && g > 125 && b > 95 && Math.abs(r - g) < 28) paleGrowth++;
  }

  assert.equal(DEF.kind, MonsterKind.OBZHIVALSHCHIK);
  assert.equal(MONSTERS[MonsterKind.OBZHIVALSHCHIK], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.OBZHIVALSHCHIK], generateSprite);
  assert.deepEqual(DEF.aiFlags, ['roomBoundAberration']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.KVARTIRY].includes(MonsterKind.OBZHIVALSHCHIK), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.OBZHIVALSHCHIK), true);
  assert.equal(ecology?.rooms.includes(RoomType.LIVING), true);
  assert.equal(ecology?.rumorIds.includes('monster_obzhivalshchik_room'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'ecology_obzhivalshchik_growth'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 500, true, 'sprite should read as a hunched resident in a room shell');
  assert.equal(redEyes >= 2, true, 'sprite needs tiny red night eyes');
  assert.equal(paleGrowth > 3, true, 'sprite needs pale wall growth marks');
});

test('Obzhivalshchik keeps its room leash until anger breaches it', () => {
  resetNoiseRecords();
  clearRoomMemory();
  const { world, homeId } = makeWorld();
  const target = player(20.5, 13.5);
  const threat = obzhivalshchik(12.5, 13.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    worldEvents: createWorldEventState(),
    clock: { hour: 8, minute: 0, totalMinutes: 480 },
  });
  prime(entities, target);

  updateMonster(world, entities, threat, 0.2, 1, msgs, target.id, { v: 10 }, state);
  assert.equal(threat.ai?.homeRoomId, homeId);
  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(world.roomAt(threat.x, threat.y)?.id, homeId);
  assert.equal(getRecentEvents(state, { type: 'obzhivalshchik_breached' }).length, 0);

  threat.ai!.anger = 75;
  prime(entities, target);
  updateMonster(world, entities, threat, 0.2, 2, msgs, target.id, { v: 10 }, state);
  assert.equal(threat.ai?.breached, true);
  assert.equal(threat.ai?.combatTargetId, target.id);
  assert.equal(getRecentEvents(state, { type: 'obzhivalshchik_breached', tags: ['obzhivalshchik'] }).length, 1);
});

test('Obzhivalshchik wall growth is capped and report memory calms anger', () => {
  resetNoiseRecords();
  clearRoomMemory();
  const { world, homeId } = makeWorld();
  const target = player(20.5, 13.5);
  const threat = obzhivalshchik(12.5, 13.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    clock: { hour: 23, minute: 0, totalMinutes: 1380 },
  });
  prime(entities, target);

  for (let i = 0; i < 10; i++) {
    state.time = 10 + i * 11;
    updateMonster(world, entities, threat, 11, state.time, msgs, target.id, { v: 10 }, state);
  }

  assert.equal(threat.ai?.growthCount, 6);
  assert.equal(getRecentEvents(state, { type: 'obzhivalshchik_scratched', tags: ['growth'], limit: 12 }).length, 6);

  threat.ai!.anger = 80;
  publishEvent(state, {
    type: 'ration_coupon_reported',
    roomId: homeId,
    x: 12.5,
    y: 13.5,
    actorId: target.id,
    actorName: target.name,
    actorFaction: Faction.PLAYER,
    severity: 3,
    privacy: 'local',
    tags: ['player', 'report', 'obzhivalshchik'],
  });

  state.time += 0.1;
  updateMonster(world, entities, threat, 0.1, state.time, msgs, target.id, { v: 10 }, state);
  assert.equal((threat.ai?.anger ?? 0) < 80, true);
  assert.equal(getRecentEvents(state, { type: 'obzhivalshchik_calmed', tags: ['report'] }).length, 1);
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  DoorState,
  EntityType,
  FloorLevel,
  MonsterKind,
  ProjType,
  RoomType,
  type Entity,
  type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/lozhnyy_dukh';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { Spr } from '../src/render/sprite_index';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  getLozhnyyDukhFalsePhaseMove,
  setEntityMap,
  tryMonsterProjectileStagger,
  updateMonster,
} from '../src/systems/ai/monster';
import { UV_SPOTLIGHT_ID, useUvSpotlight } from '../src/systems/uv_spotlight';
import { makeGameState } from './helpers';

function initZone(world: World): void {
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 10,
    cy: 10,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
}

function carveFloor(world: World, x: number, y: number): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.FLOOR;
  world.zoneMap[idx] = 0;
}

function closedDoorWorld(): World {
  const world = new World();
  initZone(world);
  for (let x = 7; x <= 14; x++) {
    carveFloor(world, x, 10);
    carveFloor(world, x, 9);
    carveFloor(world, x, 11);
  }
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  return world;
}

function splitWallWorld(): World {
  const world = new World();
  initZone(world);
  for (let x = 7; x <= 9; x++) carveFloor(world, x, 10);
  for (let x = 11; x <= 14; x++) carveFloor(world, x, 10);
  return world;
}

function openUvWorld(): World {
  const world = new World();
  initZone(world);
  for (let x = 4; x <= 12; x++) {
    carveFloor(world, x, 10);
    carveFloor(world, x, 9);
    carveFloor(world, x, 11);
  }
  return world;
}

function player(x: number, y: number, angle = 0): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    name: 'Вы',
    inventory: [],
  };
}

function lozhnyyDukh(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.LOZHNYY_DUKH,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function pellet(ownerId: number): Entity {
  return {
    id: 3,
    type: EntityType.PROJECTILE,
    x: 9.2,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.PELLET,
    vx: 1,
    vy: 0,
    projDmg: 8,
    projLife: 1,
    projType: ProjType.NORMAL,
    ownerId,
  };
}

function sync(world: World, entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  setListenerPos(512, 512, world.dist2.bind(world));
}

test('Lozhnyy Dukh is standalone door-phase content', () => {
  const ecology = getMonsterEcology(MonsterKind.LOZHNYY_DUKH);

  assert.equal(DEF.kind, MonsterKind.LOZHNYY_DUKH);
  assert.equal(MONSTERS[MonsterKind.LOZHNYY_DUKH], DEF);
  assert.deepEqual(DEF.aiFlags, ['falsePhase']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID]);
  assert.equal(DEF.hp < MONSTERS[MonsterKind.SPIRIT].hp, true, 'false spirit should be lower HP than the full wall-phasing spirit');
  assert.match(DEF.counterplay ?? '', /двер|сквозняк|УФ|выход/);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY]?.includes(MonsterKind.LOZHNYY_DUKH), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING]?.includes(MonsterKind.LOZHNYY_DUKH), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.VOID]?.includes(MonsterKind.LOZHNYY_DUKH), true);
  assert.ok(ecology);
  assert.equal(ecology?.rooms.includes(RoomType.OFFICE), true);
  assert.equal(ecology?.rumorIds.includes('ecology_lozhnyy_dukh_door'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'ecology_lozhnyy_dukh_door'), true);
});

test('Lozhnyy Dukh sprite reads as a translucent side ghost with inner face', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let translucentCold = 0;
  let blackVoids = 0;
  for (const px of sprite) {
    const alpha = px >>> 24;
    if (alpha === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (alpha >= 32 && alpha <= 185 && b >= r && g >= r) translucentCold++;
    if (alpha >= 180 && r <= 24 && g <= 28 && b <= 36) blackVoids++;
  }

  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 450, true);
  assert.equal(translucentCold > 260, true, 'body should read as cold transparent mass');
  assert.equal(blackVoids >= 12, true, 'mouth and inner false face should be visible');
});

test('false phase crosses one closed door after a cold-draft telegraph', () => {
  const world = closedDoorWorld();
  const target = player(13.5, 10.5);
  const threat = lozhnyyDukh(8.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ worldEvents: createWorldEventState() });

  sync(world, entities);
  const planned = getLozhnyyDukhFalsePhaseMove(world, threat, target);
  assert.ok(planned);
  assert.equal(planned.doorIdx, world.idx(10, 10));
  assert.equal(planned.landingX > 10.5, true);

  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 4 }, state);
  assert.equal(threat.x < 10, true, 'telegraph should not cross immediately');
  assert.equal(threat.ai?.falsePhaseDoorIdx, world.idx(10, 10));
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true);
  assert.equal(msgs.some(entry => entry.text.includes('сквозняк')), true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['lozhnyy_dukh', 'cold_draft'], limit: 1 }).length, 1);

  updateMonster(world, entities, threat, 1.0, 2, msgs, target.id, { v: 4 }, state);
  assert.equal(threat.x > 10.5, true, 'phase should land on the target side of the door');
  assert.equal(world.doors.get(world.idx(10, 10))?.state, DoorState.CLOSED, 'phase must not open or destroy the door');
  assert.equal((threat.ai?.falsePhaseActive ?? 0) > 0, true);
  assert.equal((threat.ai?.falsePhaseCd ?? 0) > 5, true, 'phase cooldown prevents chaining');
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['lozhnyy_dukh', 'door_crossing'], limit: 1 }).length, 1);
});

test('false phase does not tunnel arbitrary walls', () => {
  const world = splitWallWorld();
  const target = player(13.5, 10.5);
  const threat = lozhnyyDukh(8.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ worldEvents: createWorldEventState() });

  sync(world, entities);
  assert.equal(getLozhnyyDukhFalsePhaseMove(world, threat, target), undefined);
  updateMonster(world, entities, threat, 1.0, 1, msgs, target.id, { v: 4 }, state);
  assert.equal(threat.x < 10, true);
  assert.equal(threat.ai?.falsePhaseDoorIdx, undefined);
});

test('projectile and UV hits interrupt false phase and weaken the reveal', () => {
  const world = closedDoorWorld();
  const target = player(13.5, 10.5);
  const threat = lozhnyyDukh(8.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ worldEvents: createWorldEventState() });

  sync(world, entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 4 }, state);
  const hpBefore = threat.hp ?? 0;
  assert.equal(tryMonsterProjectileStagger(world, state, threat, pellet(target.id), target.id), true);
  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.falsePhaseDoorIdx, undefined);
  assert.equal((threat.ai?.staggerTimer ?? 0) > 0, true);
  assert.equal((threat.ai?.falsePhaseCd ?? 0) > 5, true);
  assert.equal((threat.hp ?? 0) < hpBefore, true);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['lozhnyy_dukh', 'projectile'], limit: 1 }).length, 1);

  const uvWorld = openUvWorld();
  const uvPlayer = player(5.5, 10.5, 0);
  uvPlayer.tool = UV_SPOTLIGHT_ID;
  uvPlayer.inventory = [{ defId: UV_SPOTLIGHT_ID, count: 1, data: { dur: 3 } }];
  const uvThreat = lozhnyyDukh(8.5, 10.5);
  uvThreat.ai!.falsePhaseActive = 0.5;
  const uvState = makeGameState({ worldEvents: createWorldEventState(), time: 4, msgs: [] });
  const uvEntities = [uvPlayer, uvThreat];

  sync(uvWorld, uvEntities);
  const result = useUvSpotlight(uvWorld, uvEntities, uvPlayer, uvState);
  assert.equal(result?.affected, 1);
  assert.equal((uvThreat.ai?.falsePhaseActive ?? 0) > 1, true);
  assert.equal((uvThreat.ai?.staggerTimer ?? 0) > 0, true);
  assert.equal(getRecentEvents(uvState, { type: 'uv_spotlight_target_affected', tags: ['false_phase_interrupted'], limit: 1 }).length, 1);
});

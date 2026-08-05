import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  ProjType,
  RoomType,
  ZoneFaction,
  type Entity,
  type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/spore_carpet';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import {
  generateSporeCarpetCache,
  SPORE_CARPET_CACHE_ROOM_NAME,
} from '../src/gen/living/spore_carpet_cache';
import { S } from '../src/render/pixutil';
import { Spr } from '../src/render/sprite_index';
import { setEntityMap, tryMonsterProjectileStagger, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import {
  activeSporeHaze,
  applySporeHaze,
  SPORE_HAZE_AIM_SPREAD_MULT,
  SPORE_HAZE_PROTECTED_AIM_SPREAD_MULT,
  SPORE_HAZE_PROTECTED_DURATION_SEC,
  sporeHazeAimSpreadMult,
} from '../src/systems/status';
import { addTestRoom, makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 12,
    cy: 10,
    faction: ZoneFaction.CITIZEN,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  return world;
}

function player(x: number, y: number, inventory: Entity['inventory'] = []): Entity {
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
    inventory,
  };
}

function carpet(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.SPORE_CARPET,
    monsterStage: 0,
    attackCd: DEF.attackRate,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('spore carpet is standalone domestic trap content with reachable cache', () => {
  const ecology = getMonsterEcology(MonsterKind.SPORE_CARPET);
  const sprite = generateSprite();
  let opaque = 0;
  let vein = 0;
  let mold = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (g > r && g > b && g > 55) vein++;
    if (r > 150 && g > 145 && b > 95) mold++;
  }

  assert.equal(DEF.kind, MonsterKind.SPORE_CARPET);
  assert.equal(DEF.name, 'Ковер');
  assert.deepEqual(DEF.aiFlags, ['lurkingFurniture']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal(MONSTERS[MonsterKind.SPORE_CARPET], DEF);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.SPORE_CARPET), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY].includes(MonsterKind.SPORE_CARPET), true);
  assert.deepEqual(ecology?.rumorIds, ['monster_spore_carpet_lifted_corner', 'ecology_spore_carpet_fire_salt', 'lead_living_spore_carpet_cache']);
  assert.equal(RUMORS.some(r => r.id === 'lead_living_spore_carpet_cache'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 650, true, 'sprite should read as a hanging rug billboard');
  assert.equal(vein > 12, true, 'green-black veins should warn before wake');
  assert.equal(mold > 8, true, 'pale mold fringe should be readable');

  const world = new World();
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 100,
    cy: 100,
    faction: ZoneFaction.CITIZEN,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  generateSporeCarpetCache(world, 0, entities, nextId, 100, 100);

  assert.ok(world.rooms.some(room => room?.name === SPORE_CARPET_CACHE_ROOM_NAME));
  assert.equal(entities.filter(e => e.monsterKind === MonsterKind.SPORE_CARPET).length, 2);
  assert.ok(entities.every(e => e.monsterKind !== MonsterKind.SPORE_CARPET || e.monsterStage === 0));
  assert.ok(world.containers.some(container =>
    container.tags.includes('spore_carpet') &&
    container.inventory.some(item => item.defId === 'spore_print')));
  assert.ok(world.containers.some(container =>
    container.tags.includes('counterplay') &&
    container.inventory.some(item => item.defId === 'rock_salt')));
});

test('spore carpet stays idle until close, then puffs on a capped cooldown', () => {
  const world = openWorld();
  addTestRoom(world, { id: 0, x: 8, y: 8, w: 8, h: 6, type: RoomType.STORAGE });
  const target = player(40, 10);
  const threat = carpet(10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState(), time: 1 });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, threat, 0.2, 1, msgs, target.id, { v: 3 }, state);
  assert.equal(threat.monsterStage, 0);
  assert.equal(threat.ai?.goal, AIGoal.IDLE);
  assert.equal(getRecentEvents(state, { type: 'spore_carpet_woke', limit: 1 }).length, 0);

  target.x = 11.4;
  target.y = 10.5;
  prime(entities);
  updateMonster(world, entities, threat, 0.2, 2, msgs, target.id, { v: 3 }, state);
  assert.equal(threat.monsterStage, 1);
  assert.equal((threat.ai?.sporePuffCd ?? 99) <= 0.8, true);
  assert.equal(getRecentEvents(state, { type: 'spore_carpet_woke', tags: ['near'], limit: 1 })[0]?.monsterKind, MonsterKind.SPORE_CARPET);

  threat.ai!.sporePuffCd = 0;
  const hpBefore = target.hp ?? 0;
  prime(entities);
  updateMonster(world, entities, threat, 0.2, 3, msgs, target.id, { v: 3 }, state);

  assert.equal((target.hp ?? 0) < hpBefore, true);
  assert.ok(activeSporeHaze(target, 3));
  assert.equal(sporeHazeAimSpreadMult(target, 3), SPORE_HAZE_AIM_SPREAD_MULT);
  assert.equal((threat.ai?.sporePuffCd ?? 0) >= 5.8, true);
  assert.equal(getRecentEvents(state, { type: 'spore_carpet_puff', tags: ['cooldown_capped'], limit: 1 })[0]?.monsterKind, MonsterKind.SPORE_CARPET);

  const hpAfterPuff = target.hp;
  prime(entities);
  updateMonster(world, entities, threat, 0.2, 3.2, msgs, target.id, { v: 3 }, state);
  assert.equal(target.hp, hpAfterPuff, 'cooldown should prevent immediate second puff');
});

test('ip4 gasmask counts as respiratory protection against spore haze', () => {
  const target = player(10, 10, [{ defId: 'ip4_gasmask', count: 1, data: { dur: 90 } }]);
  const threat = carpet(10.8, 10);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState(), time: 7 });
  const status = applySporeHaze(target, 7, [], state, threat);

  assert.ok(Math.abs(status.expiresAt - status.startedAt - SPORE_HAZE_PROTECTED_DURATION_SEC) < 0.001);
  assert.equal(sporeHazeAimSpreadMult(target, 7), SPORE_HAZE_PROTECTED_AIM_SPREAD_MULT);
  assert.equal(getRecentEvents(state, { type: 'player_status_applied', tags: ['protected'], limit: 1 })[0]?.data?.protectedByGear, true);
});

test('nearby container opening wakes spore carpet before proximity', () => {
  const world = openWorld();
  const target = player(30, 10);
  const threat = carpet(10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState(), time: 4 });
  const msgs: Msg[] = [];

  publishEvent(state, {
    type: 'container_opened',
    x: 11,
    y: 10,
    actorId: target.id,
    actorName: target.name,
    actorFaction: target.faction,
    containerId: 77,
    severity: 2,
    privacy: 'local',
    tags: ['container', 'loot'],
  });

  prime(entities);
  updateMonster(world, entities, threat, 0.4, 4.1, msgs, target.id, { v: 3 }, state);

  assert.equal(threat.monsterStage, 1);
  const woke = getRecentEvents(state, { type: 'spore_carpet_woke', tags: ['container'], limit: 1 })[0];
  assert.ok(woke);
  assert.equal(woke.data?.reason, 'container');
});

test('fire projectile wakes spore carpet and delays the next puff', () => {
  const world = openWorld();
  const target = player(12, 10);
  const threat = carpet(10.5, 10.5);
  const flame: Entity = {
    id: 99,
    type: EntityType.PROJECTILE,
    x: threat.x,
    y: threat.y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.FLAME_BOLT,
    projType: ProjType.FLAME,
    projDmg: 3,
    ownerId: target.id,
  };
  const entities = [target, threat, flame];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState(), time: 8 });

  prime(entities);
  assert.equal(tryMonsterProjectileStagger(world, state, threat, flame, target.id), true);

  assert.equal(threat.monsterStage, 1);
  assert.equal((threat.ai?.sporeRecoilTimer ?? 0) > 2, true);
  assert.equal((threat.ai?.sporePuffCd ?? 0) > 3, true);
  const burned = getRecentEvents(state, { type: 'spore_carpet_burned', tags: ['fire'], limit: 1 })[0];
  assert.ok(burned);
  assert.equal(burned.monsterKind, MonsterKind.SPORE_CARPET);
});

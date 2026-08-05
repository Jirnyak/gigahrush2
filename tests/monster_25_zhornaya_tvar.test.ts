import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { BAIT_ATTRACTED_MONSTER_KINDS, getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/zhornaya_tvar';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  getActiveMonsterBaits,
  placeMonsterBait,
  resetMonsterBaits,
} from '../src/systems/monster_bait';
import { makeGameState, makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 12,
    cy: 10,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  return world;
}

function zhornaya(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.ZHORNAYA_TVAR,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('zhornaya tvar is standalone scent-lunge monster content', () => {
  const ecology = getMonsterEcology(MonsterKind.ZHORNAYA_TVAR);
  const sprite = generateSprite();
  let opaque = 0;
  let jawPixels = 0;
  let tendrilPixels = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      const alpha = px >>> 24;
      if (alpha !== 0) opaque++;
      if (y >= 20 && y <= 26 && x >= 24 && x <= 40 && alpha !== 0) jawPixels++;
      if (y >= 20 && y <= 32 && (x < 23 || x > 41) && alpha !== 0) tendrilPixels++;
    }
  }

  assert.equal(DEF.kind, MonsterKind.ZHORNAYA_TVAR);
  assert.equal(MONSTERS[MonsterKind.ZHORNAYA_TVAR], DEF);
  assert.deepEqual(DEF.aiFlags, ['foodBait', 'scentOvercommit']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.KVARTIRY]?.includes(MonsterKind.ZHORNAYA_TVAR), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING]?.includes(MonsterKind.ZHORNAYA_TVAR), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.HELL]?.includes(MonsterKind.ZHORNAYA_TVAR), true);
  assert.equal(BAIT_ATTRACTED_MONSTER_KINDS.includes(MonsterKind.ZHORNAYA_TVAR), true);
  assert.equal(ecology?.rooms.includes(RoomType.KITCHEN), true);
  assert.equal(ecology?.rooms.includes(RoomType.STORAGE), true);
  assert.equal(ecology?.rareDrops.some(drop => drop.itemId === 'rawmeat'), true);
  assert.equal(RUMORS.some(r => r.id === 'ecology_zhornaya_tvar_scent'), true);
  assert.equal(opaque > 900, true, 'sprite should read as a full low-shouldered predator');
  assert.equal(jawPixels > 40, true, 'sprite should expose a large scent-lock jaw');
  assert.equal(tendrilPixels > 12, true, 'sprite should show broken sniffing tendrils');
});

test('zhornaya tvar overcommits to side-thrown bait and leaves recovery', () => {
  resetMonsterBaits();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const state = makeGameState({
    time: 10,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({ id: 1, x: 14.5, y: 10.5, hp: 100, maxHp: 100 });
  const threat = zhornaya(10.5, 10.5);
  const entities = [player, threat];
  const msgs: Msg[] = [];

  assert.equal(placeMonsterBait(state, world, player, 12.5, 12.5, 'rawmeat', 1, 'drop', 50), true);
  prepare(entities);
  updateMonster(world, entities, threat, 0.2, state.time, msgs, player.id, { v: 100 }, state);

  assert.equal(getActiveMonsterBaits().length, 0);
  assert.equal(player.hp, 100);
  assert.equal((threat.ai?.staggerTimer ?? 0) > 0, true);
  assert.equal((threat.attackCd ?? 0) >= DEF.attackRate, true);
  assert.equal(msgs.some(m => m.text.includes('приманку')), true);
  const consumed = getRecentEvents(state, { type: 'monster_bait_consumed', limit: 1 })[0];
  assert.equal(consumed?.monsterKind, MonsterKind.ZHORNAYA_TVAR);
  assert.equal(consumed?.itemId, 'rawmeat');
});

test('zhornaya tvar ignores bait thrown directly on the player route', () => {
  resetMonsterBaits();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const state = makeGameState({
    time: 20,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({ id: 1, x: 14.5, y: 10.5, hp: 100, maxHp: 100 });
  const threat = zhornaya(10.5, 10.5);
  const entities = [player, threat];

  assert.equal(placeMonsterBait(state, world, player, 12.5, 10.5, 'rawmeat', 1, 'drop', 51), true);
  prepare(entities);
  updateMonster(world, entities, threat, 0.2, state.time, [], player.id, { v: 100 }, state);

  const marker = getActiveMonsterBaits()[0];
  assert.equal(marker?.itemId, 'rawmeat');
  assert.equal(marker?.attractedCount, 0);
  assert.equal(getRecentEvents(state, { type: 'monster_bait_attracted', limit: 1 }).length, 0);
  assert.equal(getRecentEvents(state, { type: 'monster_bait_consumed', limit: 1 }).length, 0);
});

test('zhornaya tvar lunges at a food carrier when no better scent is off-route', () => {
  resetMonsterBaits();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const state = makeGameState({
    time: 30,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({
    id: 1,
    x: 14.5,
    y: 10.5,
    hp: 100,
    maxHp: 100,
    inventory: [{ defId: 'rawmeat', count: 1 }],
  });
  const threat = zhornaya(10.5, 10.5);
  const entities = [player, threat];
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.2, state.time, msgs, player.id, { v: 100 }, state);

  assert.equal((player.hp ?? 100) < 100, true);
  assert.equal((threat.ai?.staggerTimer ?? 0) > 0, true);
  assert.equal(msgs.some(m => m.text.includes('запах')), true);
  const locked = getRecentEvents(state, { type: 'monster_sighted', tags: ['scent', 'carrier', 'locked'], limit: 1 })[0];
  assert.equal(locked?.monsterKind, MonsterKind.ZHORNAYA_TVAR);
});

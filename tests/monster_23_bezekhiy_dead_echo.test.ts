import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { AIGoal, Cell, DoorState, EntityType, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/bezekhiy';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { makeGameState } from './helpers';


function optionalSource(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function openDoorWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
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
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.OPEN, roomA: -1, roomB: -1, keyId: '', timer: 0 });
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
  };
}

function bezekhiy(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.BEZEKHIY,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function sync(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('Bezekhiy is standalone door-threshold content, not silent_polzun', () => {
  const ecology = getMonsterEcology(MonsterKind.BEZEKHIY);

  assert.equal(DEF.kind, MonsterKind.BEZEKHIY);
  assert.equal(MONSTERS[MonsterKind.BEZEKHIY], DEF);
  assert.deepEqual(DEF.aiFlags, ['deadEcho']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY]);
  assert.equal(DEF.hp < MONSTERS[MonsterKind.POLZUN].hp, true);
  assert.equal(DEF.dmg <= MONSTERS[MonsterKind.POLZUN].dmg, true);
  assert.match(DEF.counterplay ?? '', /косяк|двер|порог|спин/);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING]?.includes(MonsterKind.BEZEKHIY), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.KVARTIRY]?.includes(MonsterKind.BEZEKHIY), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY]?.includes(MonsterKind.BEZEKHIY), true);
  assert.equal(ecology?.rooms.includes(RoomType.CORRIDOR), true);
  assert.equal(ecology?.rumorIds.includes('monster_bezekhiy_dead_echo'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === ['variant', 'silent', 'polzun'].join('_')), false);
  assert.equal(RUMORS.some(rumor => rumor.id === 'monster_bezekhiy_dead_echo'), true);
});

test('Bezekhiy sprite reads as a flat gray crawler with door-edge fingers', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let paleEdge = 0;
  let lowBody = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      const alpha = px >>> 24;
      if (alpha === 0) continue;
      opaque++;
      const r = px & 255;
      const g = (px >>> 8) & 255;
      const b = (px >>> 16) & 255;
      if (x >= 49 && y >= 42 && r > 190 && g > 180 && b > 160) paleEdge++;
      if (y >= 43 && y <= 60 && r >= 50 && r <= 115 && Math.abs(r - g) <= 16) lowBody++;
    }
  }

  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 450, true);
  assert.equal(lowBody > 300, true, 'crawler should read as a compressed floor-strip body');
  assert.equal(paleEdge >= 8, true, 'door-side white fingers should be visible without glow');
});

test('Bezekhiy spends dead echo on a back-turned door crossing', () => {
  const world = openDoorWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(9.2, 10.5, 0);
  const threat = bezekhiy(10.5, 13.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0, 1, msgs, target.id, { v: 3 }, state);

  target.x = 11.8;
  target.y = 10.5;
  target.angle = 0;
  sync(entities);
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 3 }, state);

  assert.equal((target.hp ?? 100) < 100, true);
  assert.equal(threat.ai?.deadEchoSpent, true);
  assert.equal(threat.ai?.deadEchoRevealed, true);
  assert.equal(msgs.some(entry => entry.text.includes('косяка')), true);
  const event = getRecentEvents(state, { type: 'bezekhiy_lunge', tags: ['dead_echo'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.monsterKind, MonsterKind.BEZEKHIY);
});

test('directly looking at Bezekhiy reveals it without the lunge', () => {
  const world = openDoorWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10.5, 10.5, 0);
  const threat = bezekhiy(15, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.5, 2, msgs, target.id, { v: 3 }, state);

  assert.equal(target.hp, 100);
  assert.equal(threat.ai?.deadEchoSpent, true);
  assert.equal(threat.ai?.deadEchoRevealed, true);
  assert.equal(getRecentEvents(state, { type: 'bezekhiy_lunge', limit: 1 }).length, 0);
  assert.equal(getRecentEvents(state, { type: 'bezekhiy_revealed', tags: ['direct_look'], limit: 1 }).length, 1);
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/lishennyy';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function openDarkWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
  world.light.fill(0);
  world.zoneMap.fill(0);
  return world;
}

function player(x: number, y: number, tool = ''): Entity {
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
    tool,
    needs: { food: 70, water: 70, sleep: 70, pee: 0, poo: 0 },
  };
}

function npcTarget(x: number, y: number): Entity {
  return {
    id: 7,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.CITIZEN,
    name: 'Случайный жилец',
    needs: { food: 70, water: 70, sleep: 70, pee: 0, poo: 0 },
  };
}

function lishennyy(x: number, y: number): Entity {
  return {
    id: 12,
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
    monsterKind: MonsterKind.LISHENNYY,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function lightDrop(id: number, x: number, y: number, defId: string): Entity {
  return {
    id,
    type: EntityType.ITEM_DROP,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [{ defId, count: 1 }],
  };
}

function sync(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('Lishennyy is standalone deep light-follower content', () => {
  const ecology = getMonsterEcology(MonsterKind.LISHENNYY);
  const sprite = generateSprite();
  let opaque = 0;
  let ash = 0;
  for (const px of sprite) {
    const a = px >>> 24;
    if (a === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (a < 180 && r > 38 && g > 38 && b > 38) ash++;
  }

  assert.equal(DEF.kind, MonsterKind.LISHENNYY);
  assert.deepEqual(DEF.aiFlags, ['lightFollower']);
  assert.deepEqual(DEF.floors, [FloorLevel.HELL, FloorLevel.VOID]);
  assert.equal(MONSTERS[MonsterKind.LISHENNYY], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.LISHENNYY], generateSprite);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.HELL].includes(MonsterKind.LISHENNYY), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.VOID].includes(MonsterKind.LISHENNYY), true);
  assert.equal(ecology?.rooms.includes(RoomType.CORRIDOR), true);
  assert.deepEqual(ecology?.rumorIds, ['monster_lishennyy_light_lure', 'ecology_lishennyy_contact_decay']);
  assert.equal(RUMORS.some(r => r.id === 'monster_lishennyy_light_lure'), true);
  assert.equal(RUMORS.some(r => r.id === 'ecology_lishennyy_contact_decay'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 760, true, 'Lishennyy sprite should read as a full human absence');
  assert.equal(ash > 80, true, 'sprite needs a visible ash edge and falling powder');
});

test('Lishennyy follows a dropped light decoy instead of a dark player', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10.5, 10.5);
  const threat = lishennyy(18.5, 10.5);
  const decoy = lightDrop(3, 15.5, 10.5, 'flashlight');
  const entities = [target, threat, decoy];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.2, 1, msgs, target.id, { v: 20 }, state);

  assert.equal(threat.ai?.lightTargetId, decoy.id);
  assert.equal(threat.ai?.lightTargetKind, 'drop');
  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(getRecentEvents(state, { type: 'lishennyy_lured', tags: ['drop'], limit: 1 })[0]?.itemId, 'flashlight');
});

test('Lishennyy light search is bounded and ignores far lightmap cells', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  world.features[world.idx(240, 240)] = Feature.LAMP;
  world.light[world.idx(240, 240)] = 1;
  const target = player(10.5, 10.5);
  const threat = lishennyy(18.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.2, 2, [], target.id, { v: 20 }, state);

  assert.equal(threat.ai?.lightTargetKind, undefined);
  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(getRecentEvents(state, { type: 'lishennyy_lured', limit: 1 }).length, 0);
});

test('Lishennyy contact applies decay while the player stands in light', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10.5, 10.5);
  world.light[world.idx(10, 10)] = 0.72;
  const threat = lishennyy(11.15, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.2, 3, msgs, target.id, { v: 20 }, state);

  assert.equal((target.hp ?? 100) < 100, true);
  assert.equal(target.needs?.food, 66);
  assert.equal(target.needs?.water, 66);
  assert.equal(msgs.some(m => m.text.includes('Лишенный коснулся света')), true);
  assert.equal(getRecentEvents(state, { type: 'lishennyy_contact_decay', tags: ['contact_decay'], limit: 1 })[0]?.monsterKind, MonsterKind.LISHENNYY);
});

test('Lishennyy contact decay applies to lit NPC targets', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = npcTarget(10.5, 10.5);
  world.light[world.idx(10, 10)] = 0.72;
  const threat = lishennyy(11.15, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.2, 6, [], 1, { v: 20 }, state);

  assert.equal((target.hp ?? 100) < 100, true);
  assert.equal(target.needs?.food, 66);
  assert.equal(target.needs?.water, 66);
  const event = getRecentEvents(state, { type: 'lishennyy_contact_decay', tags: ['contact_decay'], limit: 1 })[0];
  assert.equal(event?.targetId, target.id);
  assert.equal(event?.privacy, 'witnessed');
});

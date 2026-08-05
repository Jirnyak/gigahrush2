import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/rzhavnik';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { generateRzhavnikShelf } from '../src/gen/maintenance/rzhavnik_shelf';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { publishNoise } from '../src/systems/noise';
import { setListenerPos } from '../src/systems/audio';
import { S } from '../src/render/pixutil';
import { addTestRoom, makeGameState } from './helpers';

function storageWorld(): World {
  const world = new World();
  addTestRoom(world, { id: 1, type: RoomType.STORAGE, x: 10, y: 10, w: 16, h: 10 });
  world.features[world.idx(14, 13)] = Feature.SHELF;
  world.features[world.idx(15, 13)] = Feature.SHELF;
  return world;
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
  };
}

function rzhavnik(x: number, y: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id: 32,
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
    monsterKind: MonsterKind.RZHAVNIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

function syncEntities(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('rzhavnik is standalone storage ambush content, not rust rebar', () => {
  assert.equal(DEF.kind, MonsterKind.RZHAVNIK);
  assert.deepEqual(DEF.aiFlags, ['scrapWake']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.match(DEF.counterplay ?? '', /стопк|дистанц|рывок/);
  assert.equal(MONSTERS[MonsterKind.RZHAVNIK], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.RZHAVNIK], generateSprite);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.RZHAVNIK), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE].includes(MonsterKind.RZHAVNIK), true);

  const ecology = getMonsterEcology(MonsterKind.RZHAVNIK);
  assert.ok(ecology);
  assert.equal(ecology?.rooms.includes(RoomType.STORAGE), true);
  assert.equal(ecology?.rumorIds.includes('monster_rzhavnik_scrap'), true);
});

test('rzhavnik sprite reads as straight rusty rods with oil and concrete dust', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let rust = 0;
  let oil = 0;
  let dust = 0;

  for (const px of sprite) {
    const a = px >>> 24;
    if (a === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 110 && g > 40 && g < 110 && b < 80) rust++;
    if (r < 35 && g < 30 && b < 28) oil++;
    if (r > 130 && g > 125 && b > 110 && Math.abs(r - g) < 25) dust++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 650, 'pile and unfolded walker should be readable');
  assert.ok(rust > 170, 'rusty rods should dominate the silhouette');
  assert.ok(oil > 35, 'black oil shadow should stay visible');
  assert.ok(dust > 12, 'concrete dust flakes should break up the rods');
});

test('dormant rzhavnik idles as scrap, wakes close, leaps once, then becomes fragile', () => {
  const world = storageWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(16.2, 14.5);
  const threat = rzhavnik(14.5, 14.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const startMax = threat.maxHp ?? 0;

  target.x = 22.5;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 100 }, state);
  assert.equal(threat.ai?.scrapWake, 0);
  assert.equal(threat.ai?.combatTargetId, undefined);

  target.x = 16.2;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 2, msgs, target.id, { v: 100 }, state);
  assert.equal(threat.ai?.scrapWake, 1);

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.4, 2.4, msgs, target.id, { v: 100 }, state);
  assert.equal(threat.ai?.scrapWake, 2);
  assert.ok((threat.maxHp ?? startMax) < startMax, 'first leap should leave a fragile walker');
  assert.ok((target.hp ?? 100) < 100, 'close careless approach should be punished by the first leap');
  assert.equal(msgs.some(m => m.text.includes('первым рывком')), true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['rzhavnik', 'scrap_wake'], limit: 1 }).length, 1);
});

test('loud metal wakes dormant rzhavnik before close approach', () => {
  const world = storageWorld();
  const target = player(21.5, 14.5);
  const threat = rzhavnik(14.5, 14.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 5;

  syncEntities(entities);
  publishNoise(state, {
    x: 15,
    y: 14,
    radius: 10,
    ttl: 2,
    source: 'melee',
    severity: 2,
    actorId: target.id,
    itemId: 'rebar',
    tags: ['weapon', 'metal'],
  });
  updateMonster(world, entities, threat, 0.1, state.time, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.ai?.scrapWake, 1);
  assert.equal(threat.ai?.combatTargetId, target.id);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['loud_metal'], limit: 1 }).length, 1);
});

test('maintenance rzhavnik shelf creates one dormant shelf ambusher beside real scrap', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 10 };

  generateRzhavnikShelf({ world, entities, nextId, spawnX: 64, spawnY: 64 });

  const monsters = entities.filter(e => e.monsterKind === MonsterKind.RZHAVNIK);
  const drops = entities.filter(e => e.type === EntityType.ITEM_DROP).flatMap(e => e.inventory ?? []);
  assert.equal(monsters.length, 1);
  assert.equal(monsters[0].ai?.scrapWake, 0);
  assert.equal(world.roomAt(monsters[0].x, monsters[0].y)?.type, RoomType.STORAGE);
  assert.equal(drops.some(item => item.defId === 'rebar'), true);
  assert.equal(world.features.some(feature => feature === Feature.SHELF), true);
  assert.equal(world.cells.some(cell => cell === Cell.FLOOR), true);
});

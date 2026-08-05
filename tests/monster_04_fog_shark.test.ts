import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, ProjType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite, put, line, ellipse, triangle } from '../src/entities/fog_shark';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import {
  FOG_SHARK_PACK_CAP,
  setEntityMap,
  updateMonster,
  FOG_SHARK_DRY_SPEED_MULT,
  FOG_SHARK_FOG_SPEED_MULT,
  fogSharkMoveMultiplierForTests,
} from '../src/systems/ai/monster';
import { rebuildEntityIndex, getEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import {
  FOG_SHARK_IGNITION_TARGET_CAP,
} from '../src/systems/fog_shark';
import { adjustMonsterProjectileDamage, recordMonsterProjectileDeath } from '../src/systems/monster_counterplay';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';
import type { Msg } from '../src/core/types';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.roomMap.fill(0);
  world.rooms[0] = {
    id: 0,
    type: RoomType.CORRIDOR,
    x: 8,
    y: 8,
    w: 12,
    h: 8,
    doors: [],
    sealed: false,
    name: 'Тестовый туманный коридор',
    apartmentId: -1,
  };
  world.zones[0] = {
    id: 0,
    cx: 10,
    cy: 10,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  return world;
}

function fogShark(id: number, x: number, y: number, hp = DEF.hp): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.FOG_SHARK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('fog shark drawing helpers: put, line, ellipse, triangle', () => {
  const t = new Uint32Array(S * S).fill(0);

  // Test put
  put(t, 10, 10, 1234);
  assert.equal(t[10 * S + 10], 1234, 'put should draw a pixel');

  // Test out-of-bounds put
  put(t, -1, -1, 5678);
  put(t, S, S, 5678);
  assert.equal(t.includes(5678), false, 'put should drop out of bounds');

  // Test line
  t.fill(0);
  line(t, 5, 5, 5, 10, 9999);
  assert.equal(t[5 * S + 5], 9999);
  assert.equal(t[10 * S + 5], 9999);
  assert.equal(t[7 * S + 5], 9999);

  // Test line with width
  t.fill(0);
  line(t, 10, 10, 10, 10, 8888, 1);
  assert.equal(t[10 * S + 11], 8888, 'line with width should draw around center');

  // Test ellipse
  t.fill(0);
  ellipse(t, 20, 20, 2, 2, (x, y, d) => 7777);
  assert.equal(t[20 * S + 20], 7777, 'center of ellipse should be drawn');
  assert.equal(t[22 * S + 20], 7777, 'edge of ellipse should be drawn');
  assert.equal(t[23 * S + 20], 0, 'outside of ellipse should be clear');

  // Test triangle
  t.fill(0);
  triangle(t, 30, 30, 35, 30, 30, 35, 6666);
  assert.equal(t[30 * S + 30], 6666, 'corner of triangle should be drawn');
  assert.equal(t[30 * S + 34], 6666, 'edge of triangle should be drawn');
  assert.equal(t[34 * S + 30], 6666, 'edge of triangle should be drawn');

  // Test degenerate triangle
  t.fill(0);
  triangle(t, 40, 40, 40, 40, 40, 40, 5555);
  triangle(t, 40, 40, 45, 40, 50, 40, 5555);
  assert.equal(t.includes(5555), false, 'collinear points should be rejected by the area threshold');
});

test('fog shark is standalone fog-pack content with sprite, ecology, and rumors', () => {
  const ecology = getMonsterEcology(MonsterKind.FOG_SHARK);
  const sprite = generateSprite();
  let opaque = 0;
  let teeth = 0;
  let fogPixels = 0;

  for (const px of sprite) {
    const a = px >>> 24;
    if (a === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 190 && g > 190 && b > 180) teeth++;
    if (a > 25 && a < 130 && b > r - 15) fogPixels++;
  }

  assert.equal(DEF.kind, MonsterKind.FOG_SHARK);
  assert.equal(DEF.name, 'Туманная акула');
  assert.equal(DEF.hp, 18);
  assert.equal(DEF.speed, 2.85);
  assert.equal(DEF.dmg, 12);
  assert.equal(DEF.attackRate, 0.78);
  assert.equal(DEF.sprite, 0);
  assert.equal(DEF.lootHint, 'серебряный зуб, сине-черная чешуя, газовый пузырь, редкая акулья чешуя');

  assert.equal(MONSTERS[MonsterKind.FOG_SHARK], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.FOG_SHARK], generateSprite);
  assert.deepEqual(DEF.aiFlags, ['fogSwimmer']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE].includes(MonsterKind.FOG_SHARK), true);
  assert.match(DEF.counterplay ?? '', /туман|двер|огонь|взрыв/i);
  assert.equal(ecology?.rumorIds.includes('monster_fog_shark_fog'), true);
  assert.equal(ecology?.rumorIds.includes('ecology_fog_shark_fire'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'monster_fog_shark_fog'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'ecology_fog_shark_fire'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 350, true);
  assert.equal(teeth >= 10, true, 'metal teeth should read in the small sprite');
  assert.equal(fogPixels > 45, true, 'fog fringe should make the shark read airborne');
});

test('fog shark slows sharply on dry cells and regains speed in fog pressure', () => {
  const world = openWorld();
  const shark = fogShark(2, 10.5, 10.5);

  assert.equal(fogSharkMoveMultiplierForTests(world, shark), FOG_SHARK_DRY_SPEED_MULT);

  world.fog[world.idx(10, 10)] = 90;
  assert.equal(fogSharkMoveMultiplierForTests(world, shark), FOG_SHARK_FOG_SPEED_MULT);

  world.fog[world.idx(10, 10)] = 0;
  world.zones[0].fogged = true;
  assert.equal(fogSharkMoveMultiplierForTests(world, shark), FOG_SHARK_FOG_SPEED_MULT);
});

test('fog shark flame kill is lethal and ignition burst is bounded to one event', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 11.0, y: 10.5, hp: 100, maxHp: 100, faction: Faction.PLAYER });
  const npc = makeTestNpc({ id: 2, x: 11.4, y: 10.5, hp: 30, maxHp: 30, faction: Faction.CITIZEN });
  const shark = fogShark(3, 10.5, 10.5);
  const pack = Array.from({ length: 12 }, (_, i) => fogShark(10 + i, 10.65 + i * 0.03, 10.9, 6));
  const entities = [player, npc, shark, ...pack];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const projectile = {
    id: 80,
    type: EntityType.PROJECTILE,
    x: 9.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    ownerId: player.id,
    projType: ProjType.FLAME,
    projDmg: 4,
  } satisfies Entity;

  assert.equal(adjustMonsterProjectileDamage(shark, projectile, projectile.projDmg ?? 0) > DEF.hp, true);

  rebuildEntityIndex(entities);
  shark.alive = false;
  let collateralKills = 0;
  recordMonsterProjectileDeath(world, state, shark, projectile, player, target => {
    collateralKills++;
    assert.notEqual(target.id, shark.id);
  });

  const events = getRecentEvents(state, { type: 'fog_shark_ignited', tags: ['fog_shark'], limit: 4 });
  assert.equal(events.length, 1);
  const hits = Number(events[0].data?.hitCount ?? 0);
  assert.equal(hits <= FOG_SHARK_IGNITION_TARGET_CAP, true);
  assert.equal(player.hp! < 100, true, 'close player should be hurt by risky fire');
  assert.equal(npc.hp! < 30, true, 'close NPC should be hurt by the gas burst');
  assert.equal(pack.some(packmate => (packmate.hp ?? DEF.hp) < 6), true, 'nearby sharks should take burst damage');
  assert.equal(collateralKills <= FOG_SHARK_IGNITION_TARGET_CAP, true);

  assert.equal(events[0].data?.cap, FOG_SHARK_IGNITION_TARGET_CAP);
  assert.equal(events[0].data?.killCount, collateralKills);
  assert.equal(events[0].data?.sharkHits !== undefined, true);
});

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  getEntityIndex().beginTelemetryFrame();
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('fog shark shares target only through a bounded pack radius query', () => {
  const world = openWorld();
  const target = makeTestPlayer({ id: 1, x: 10, y: 10, hp: 100, maxHp: 100, faction: Faction.PLAYER });
  const caller = fogShark(2, 12, 10);
  const packmate = fogShark(3, 22, 10);
  packmate.ai!.combatScanCd = 99;
  const entities = [target, caller, packmate];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, caller, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(caller.ai?.combatTargetId, target.id);
  assert.equal(packmate.ai?.combatTargetId, target.id);
  const event = getRecentEvents(state, { type: 'fog_shark_pack_sighted', limit: 1 })[0];
  assert.ok(event);
});

test('fog shark pack share is capped and cooldown-gated', () => {
  const world = openWorld();
  const target = makeTestPlayer({ id: 1, x: 10, y: 10, hp: 100, maxHp: 100, faction: Faction.PLAYER });
  const caller = fogShark(2, 12, 10);
  caller.ai!.combatTargetId = target.id;
  caller.ai!.combatScanCd = 99;
  const pack = Array.from({ length: 18 }, (_, i) => {
    const shark = fogShark(3 + i, 12.4 + (i % 6) * 0.25, 10.4 + Math.floor(i / 6) * 0.25);
    shark.ai!.combatScanCd = 99;
    return shark;
  });
  const entities = [target, caller, ...pack];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, caller, 0.1, 5, msgs, target.id, { v: 40 }, state);

  const firstShared = pack.filter(shark => shark.ai?.combatTargetId === target.id).length;
  const event = getRecentEvents(state, { type: 'fog_shark_pack_sighted', limit: 1 })[0];
  assert.ok(event);
  assert.equal(firstShared > 0, true);
  assert.equal(firstShared <= FOG_SHARK_PACK_CAP, true);

  for (const shark of pack) shark.ai!.combatTargetId = undefined;
  prime(entities);
  updateMonster(world, entities, caller, 0.1, 5.25, msgs, target.id, { v: 40 }, state);

  assert.equal(pack.filter(shark => shark.ai?.combatTargetId === target.id).length, 0);
});

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
  type Entity,
  type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/swarm_mass';
import { MONSTERS } from '../src/entities/monster';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { generateSwarmNest } from '../src/gen/maintenance/swarm_nest';
import { monsterSpr, Spr } from '../src/render/sprite_index';
import { S } from '../src/render/pixutil';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { useItem } from '../src/systems/inventory';
import {
  createSwarmSourceEntity,
  getSwarmNestSources,
  isSwarmBodyEntity,
  isSwarmSourceEntity,
  registerSwarmNestSource,
  updateSwarmNests,
} from '../src/systems/swarm_nests';
import { adjustMonsterProjectileDamage, recordMonsterProjectileDeath } from '../src/systems/monster_counterplay';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 16,
    cy: 16,
    faction: 0,
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

function source(id: number, x: number, y: number): Entity {
  return createSwarmSourceEntity(id, x, y, 2);
}

function bodyCount(entities: readonly Entity[]): number {
  return entities.filter(e => e.alive && isSwarmBodyEntity(e)).length;
}

test('swarm is standalone source-swarm data with noisy mass sprite', () => {
  const ecology = getMonsterEcology(MonsterKind.SWARM);
  const sprite = generateSprite();
  let opaque = 0;
  let yellow = 0;
  let red = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (r > 170 && g > 150 && b < 90) yellow++;
    if (r > 110 && g < 70 && b < 60) red++;
  }

  assert.equal(DEF.kind, MonsterKind.SWARM);
  assert.equal(DEF.name, 'Рой');
  assert.deepEqual(DEF.aiFlags, ['sourceSwarm', 'foodBait']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(MONSTERS[MonsterKind.SWARM], DEF);
  assert.match(ecology?.rule ?? '', /источник|cooldown|тел/);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 520, true, 'swarm sprite should read as a dense living mass');
  assert.equal(yellow >= 8, true, 'yellow eye pixels should distinguish the mass');
  assert.equal(red >= 4, true, 'red larva dots should be present');
});

test('swarm source respects cooldown, source cap, and body ttl cleanup', () => {
  const world = openWorld();
  const target = player(12, 10);
  const queen = source(2, 10.5, 10.5);
  const entities = [target, queen];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState(), time: 1 });
  const nextId = { v: 3 };

  registerSwarmNestSource(world, {
    id: 'test_swarm_cap',
    x: queen.x,
    y: queen.y,
    sourceEntityId: queen.id,
    activationRadius: 20,
    spawnCooldown: 0.5,
    maxChildren: 3,
    childTtl: 3,
  });

  rebuildEntityIndex(entities);
  updateSwarmNests(world, entities, 0.1, 1, target, nextId, state);
  assert.equal(bodyCount(entities), 1);

  rebuildEntityIndex(entities);
  updateSwarmNests(world, entities, 0.1, 1.1, target, nextId, state);
  assert.equal(bodyCount(entities), 1, 'cooldown should prevent immediate second body');

  for (let i = 0; i < 8; i++) {
    rebuildEntityIndex(entities);
    updateSwarmNests(world, entities, 0.55, 1.7 + i * 0.55, target, nextId, state);
  }
  assert.equal(bodyCount(entities), 3, 'source cap should prevent entity explosion');

  target.x = 220;
  target.y = 220;
  rebuildEntityIndex(entities);
  updateSwarmNests(world, entities, 4, 8, target, nextId, state);
  assert.equal(bodyCount(entities), 0, 'short-lived bodies should clean up when the player leaves');

  assert.equal(getSwarmNestSources(openWorld()).length, 0, 'nest runtime should be scoped to the active World');
});

test('duct tape or sealant resolves the source without killing every body', () => {
  const world = openWorld();
  const target = player(10, 10, [{ defId: 'duct_tape', count: 1 }]);
  const queen = source(2, 10.8, 10.5);
  const entities = [target, queen];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState(), time: 2 });
  const msgs: Msg[] = [];
  const nextId = { v: 3 };

  registerSwarmNestSource(world, {
    id: 'test_swarm_seal',
    x: queen.x,
    y: queen.y,
    sourceEntityId: queen.id,
    activationRadius: 20,
    spawnCooldown: 0.1,
    maxChildren: 4,
  });
  rebuildEntityIndex(entities);
  updateSwarmNests(world, entities, 0.1, 2, target, nextId, state);
  assert.equal(bodyCount(entities), 1);

  rebuildEntityIndex(entities);
  useItem(target, 0, msgs, 2.2, state, 0, world);

  assert.equal(target.inventory?.length, 0);
  assert.equal(queen.alive, false);
  assert.equal(bodyCount(entities), 0);
  assert.ok(msgs.some(line => /Рой потерял источник/.test(line.text)));
  const sealed = getRecentEvents(state, { type: 'swarm_source_sealed', tags: ['swarm', 'sealed'], limit: 1 })[0];
  assert.ok(sealed);
  assert.equal(sealed.monsterKind, MonsterKind.SWARM);
  assert.equal(sealed.itemId, 'duct_tape');
});

test('fire kills bodies outright and burns source records', () => {
  const world = openWorld();
  const actor = player(9, 10);
  const queen = source(2, 10.5, 10.5);
  const entities = [actor, queen];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState(), time: 3 });
  const flame: Entity = {
    id: 99,
    type: EntityType.PROJECTILE,
    x: queen.x,
    y: queen.y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.FLAME_BOLT,
    projType: ProjType.FLAME,
    projDmg: 4,
    ownerId: actor.id,
  };

  registerSwarmNestSource(world, {
    id: 'test_swarm_burn',
    x: queen.x,
    y: queen.y,
    sourceEntityId: queen.id,
  });
  rebuildEntityIndex(entities);

  assert.equal(adjustMonsterProjectileDamage(queen, flame, flame.projDmg ?? 0) >= (queen.hp ?? 1), true);
  queen.hp = 0;
  queen.alive = false;
  recordMonsterProjectileDeath(world, state, queen, flame, actor);

  const burned = getRecentEvents(state, { type: 'swarm_source_burned', tags: ['swarm', 'fire'], limit: 1 })[0];
  assert.ok(burned);
  assert.equal(burned.monsterKind, MonsterKind.SWARM);
});

test('maintenance swarm nest generator registers a reachable source marker', () => {
  const world = openWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateSwarmNest({ world, entities, nextId, spawnX: 16, spawnY: 16 });

  const nests = getSwarmNestSources(world);
  assert.equal(nests.length >= 1, true);
  assert.ok(entities.some(isSwarmSourceEntity), 'authored POI should create a source marker');
  assert.ok(entities.some(e => e.monsterKind === MonsterKind.SWARM && e.sprite === monsterSpr(MonsterKind.SWARM)));
  assert.equal(nests[0].maxChildren <= 10, true);
});

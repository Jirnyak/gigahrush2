import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  EntityType,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  WORLD_EVENT_TYPES,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF } from '../src/entities/pseudolift';
import { MONSTERS } from '../src/entities/monster';
import { getRecentEvents } from '../src/systems/events';
import { getActiveMonsterBaits, placeMonsterBait, resetMonsterBaits } from '../src/systems/monster_bait';
import {
  choosePseudoliftCandidate,
  clearPseudoliftActive,
  debugForcePseudoliftNearPlayer,
  ensurePseudoliftState,
  tryUsePseudolift,
  updatePseudolifts,
} from '../src/systems/pseudolift';
import { makeGameState, makeTestPlayer } from './helpers';

function worldWithLifts(lifts: readonly { x: number; y: number; dir?: LiftDirection }[]): World {
  const world = new World();
  world.cells.fill(Cell.WALL);
  for (const lift of lifts) {
    const liftIdx = world.idx(lift.x, lift.y);
    world.cells[liftIdx] = Cell.LIFT;
    world.liftDir[liftIdx] = lift.dir ?? LiftDirection.DOWN;
    const accessIdx = world.idx(lift.x - 1, lift.y);
    world.cells[accessIdx] = Cell.FLOOR;
    world.zoneMap[liftIdx] = 2;
    world.zoneMap[accessIdx] = 2;
  }
  return world;
}

function itemDrop(id: number, x: number, y: number): Entity {
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
    inventory: [{ defId: 'bread', count: 1 }],
  };
}

test('pseudolift is a registered zero-weight route trap with explicit events', () => {
  assert.equal(MONSTERS[MonsterKind.PSEUDOLIFT], DEF);
  assert.equal(DEF.name, 'Псевдолифт');
  assert.ok(DEF.counterplay?.includes('приманку'));

  const ecology = getMonsterEcology(MonsterKind.PSEUDOLIFT);
  assert.equal(ecology?.spawnWeight, 0);
  assert.equal(ecology?.rare, true);
  assert.equal(ecology?.counterplay.includes('тамбура'), true);

  assert.equal(WORLD_EVENT_TYPES.includes('pseudolift_suspected'), true);
  assert.equal(WORLD_EVENT_TYPES.includes('pseudolift_revealed'), true);
  assert.equal(WORLD_EVENT_TYPES.includes('pseudolift_fed'), true);
});

test('pseudolift candidate selection refuses the only lift on a route', () => {
  const oneLift = worldWithLifts([{ x: 10, y: 10 }]);
  assert.equal(choosePseudoliftCandidate(oneLift, 7), null);

  const twoLifts = worldWithLifts([{ x: 10, y: 10 }, { x: 20, y: 20, dir: LiftDirection.UP }]);
  const candidate = choosePseudoliftCandidate(twoLifts, 7);
  assert.ok(candidate);
  assert.equal(twoLifts.cells[candidate.liftIdx], Cell.LIFT);
  assert.notEqual(candidate.accessX, candidate.liftX);
});

test('inspecting a pseudolift warns before the second use reveals the monster', () => {
  resetMonsterBaits();
  const world = worldWithLifts([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 12 });
  const player = makeTestPlayer({ id: 1, x: 9.5, y: 10.5, angle: 0 });
  const entities: Entity[] = [player];
  const nextEntityId = { v: 2 };

  debugForcePseudoliftNearPlayer(world, player, state);
  const site = Object.values(ensurePseudoliftState(state).sites)[0];
  const siteKey = site.key;
  assert.equal(site.status, 'dormant');

  assert.equal(tryUsePseudolift(world, entities, nextEntityId, player, state, site.liftX, site.liftY), true);
  assert.equal(ensurePseudoliftState(state).sites[siteKey].status, 'suspected');
  assert.equal(entities.some(e => e.monsterKind === MonsterKind.PSEUDOLIFT), false);
  assert.equal(getRecentEvents(state, { type: 'pseudolift_suspected', limit: 1 })[0]?.monsterKind, MonsterKind.PSEUDOLIFT);

  assert.equal(tryUsePseudolift(world, entities, nextEntityId, player, state, site.liftX, site.liftY), true);
  assert.equal(ensurePseudoliftState(state).sites[siteKey].status, 'revealed');
  const monster = entities.find(e => e.monsterKind === MonsterKind.PSEUDOLIFT);
  assert.ok(monster);
  assert.equal(monster.ai?.goal, AIGoal.HUNT);
  assert.equal(getRecentEvents(state, { type: 'pseudolift_revealed', limit: 1 })[0]?.targetName, 'Псевдолифт');
});

test('nearby bait feeds the dormant pseudolift without spawning a roaming monster', () => {
  resetMonsterBaits();
  const world = worldWithLifts([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 20 });
  const player = makeTestPlayer({ id: 1, x: 9.5, y: 10.5, angle: 0 });
  const drop = itemDrop(2, 10.5, 10.5);
  const entities: Entity[] = [player, drop];

  debugForcePseudoliftNearPlayer(world, player, state);
  const site = Object.values(ensurePseudoliftState(state).sites)[0];
  const siteKey = site.key;
  assert.equal(placeMonsterBait(state, world, player, site.liftX + 0.5, site.liftY + 0.5, 'bread', 1, 'drop', drop.id), true);

  updatePseudolifts(world, entities, player, state);

  assert.equal(ensurePseudoliftState(state).sites[siteKey].status, 'fed');
  assert.equal(getActiveMonsterBaits().length, 0);
  assert.equal(drop.alive, false);
  assert.equal(entities.some(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.PSEUDOLIFT), false);
  const fed = getRecentEvents(state, { type: 'pseudolift_fed', limit: 1 })[0];
  assert.equal(fed?.itemId, 'bread');
  assert.ok(fed?.tags.includes('baited'));
});

test('clearing an active revealed pseudolift kills its live monster when entities are provided', () => {
  resetMonsterBaits();
  const world = worldWithLifts([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 32 });
  const player = makeTestPlayer({ id: 1, x: 9.5, y: 10.5, angle: 0 });
  const entities: Entity[] = [player];
  const nextEntityId = { v: 2 };

  debugForcePseudoliftNearPlayer(world, player, state);
  const site = Object.values(ensurePseudoliftState(state).sites)[0];
  const siteKey = site.key;

  assert.equal(tryUsePseudolift(world, entities, nextEntityId, player, state, site.liftX, site.liftY), true);
  assert.equal(tryUsePseudolift(world, entities, nextEntityId, player, state, site.liftX, site.liftY), true);
  const monster = entities.find(e => e.monsterKind === MonsterKind.PSEUDOLIFT);
  assert.ok(monster);
  assert.equal(monster.alive, true);
  assert.equal(ensurePseudoliftState(state).activeSiteKey, siteKey);

  clearPseudoliftActive(state, entities);

  const clearedSite = ensurePseudoliftState(state).sites[siteKey];
  assert.equal(clearedSite.status, 'escaped');
  assert.equal(clearedSite.monsterId, undefined);
  assert.equal(ensurePseudoliftState(state).activeSiteKey, undefined);
  assert.equal(monster.alive, false);
  assert.equal(monster.hp, 0);
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { isBaitAttractedMonster } from '../src/data/monster_ecology';
import {
  MONSTER_BAIT_MAX_ACTIVE,
  MONSTER_BAIT_MAX_ATTRACTIONS_CAP,
  MONSTER_BAIT_RADIUS_CAP,
  expireMonsterBaits,
  findMonsterBaitTarget,
  getActiveMonsterBaits,
  isMonsterBaitItem,
  isMonsterBaitUseItem,
  monsterBaitPreviewForItem,
  placeMonsterBait,
  resetMonsterBaits,
} from '../src/systems/monster_bait';
import { getRecentEvents } from '../src/systems/events';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function actor(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    name: 'Вы',
  };
}

function monster(kind: MonsterKind, x: number, y: number, id = 2): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2,
    sprite: 0,
    monsterKind: kind,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('food drops and govnyak use are explicit bait inputs', () => {
  assert.equal(isMonsterBaitItem('bread'), true);
  assert.equal(isMonsterBaitItem('rawmeat'), true);
  assert.equal(isMonsterBaitItem('govnyak_roll'), true);
  assert.equal(isMonsterBaitUseItem('govnyak_roll'), true);
  assert.equal(isMonsterBaitUseItem('bread'), false);
  assert.equal(isMonsterBaitItem('water'), false);
  assert.equal(isBaitAttractedMonster(MonsterKind.KRYSNOZHKA), true);
  assert.equal(isBaitAttractedMonster(MonsterKind.SBORKA), true);
  assert.equal(isBaitAttractedMonster(MonsterKind.TUBE_EEL), true);
  assert.equal(isBaitAttractedMonster(MonsterKind.PECHATEED), true);
  assert.equal(isBaitAttractedMonster(MonsterKind.PROTOKOLNIK), true);
  assert.equal(isBaitAttractedMonster(MonsterKind.EYE), false);
});

test('dropped documents are bounded bait for document predators', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 8, currentFloor: FloorLevel.MINISTRY });

  assert.equal(isMonsterBaitItem('blank_form'), true);
  assert.equal(placeMonsterBait(state, world, actor(), 12, 10, 'blank_form', 1, 'drop', 301), true);

  const pechateed = monster(MonsterKind.PECHATEED, 10, 10);
  const pechateedBait = findMonsterBaitTarget(world, pechateed, 0.2, state.time, state);
  assert.equal(pechateedBait?.kind, 'document');
  assert.equal(pechateedBait?.itemId, 'blank_form');

  resetMonsterBaits();
  assert.equal(placeMonsterBait(state, world, actor(), 12, 10, 'blank_form', 1, 'drop', 302), true);
  const protokolnik = monster(MonsterKind.PROTOKOLNIK, 10, 10);
  const protokolnikBait = findMonsterBaitTarget(world, protokolnik, 0.2, state.time, state);
  assert.equal(protokolnikBait?.kind, 'document');
  assert.equal(protokolnikBait?.itemId, 'blank_form');
});

test('bait profile uses item tags, item cost caps, and risky event tags', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 8, currentFloor: FloorLevel.LIVING });

  assert.equal(placeMonsterBait(state, world, actor(), 11, 10, 'rawmeat', 1, 'drop', 77), true);
  const marker = getActiveMonsterBaits()[0];
  assert.equal(marker.kind, 'meat');
  assert.equal(marker.itemValue, 1);
  assert.ok(marker.baitTags.includes('bait_meat'));
  assert.ok(marker.baitTags.includes('bait_trap'));
  assert.ok(marker.risk >= 2);
  assert.ok(marker.radius <= MONSTER_BAIT_RADIUS_CAP);

  const placed = getRecentEvents(state, { type: 'monster_bait_placed', limit: 1 })[0];
  assert.ok(placed.tags.includes('risky_attraction'));
  assert.equal(placed.data?.itemValue, 1);
});

test('govnyak use bait exposes marker clarity and bounded attraction caps', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 8, currentFloor: FloorLevel.LIVING });
  const preview = monsterBaitPreviewForItem('govnyak_bad_batch', 'use', 1);

  assert.equal(preview?.kind, 'govnyak');
  assert.ok(preview?.markerLabel.includes('приманка:говняк'));
  assert.equal(preview?.activeCap, MONSTER_BAIT_MAX_ACTIVE);

  assert.equal(placeMonsterBait(state, world, actor(), 11, 10, 'govnyak_bad_batch', 1, 'use'), true);
  const marker = getActiveMonsterBaits()[0];
  assert.equal(marker.kind, 'govnyak');
  assert.ok(marker.risk >= 3);
  assert.ok(marker.maxAttractions <= MONSTER_BAIT_MAX_ATTRACTIONS_CAP);

  const placed = getRecentEvents(state, { type: 'monster_bait_placed', limit: 1 })[0];
  assert.ok(placed.tags.includes('bait_marker'));
  assert.equal(placed.data?.activeCap, MONSTER_BAIT_MAX_ACTIVE);
  assert.equal(placed.data?.activeCount, 1);
  assert.ok(String(placed.data?.markerLabel).includes('приманка:говняк'));
});

test('bait attraction prefers ecology-tagged food over a closer generic lure', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 9, currentFloor: FloorLevel.LIVING });
  const player = actor();

  assert.equal(placeMonsterBait(state, world, player, 13, 10, 'bread', 1, 'drop', 88), true);
  assert.equal(placeMonsterBait(state, world, player, 14, 10, 'rawmeat', 1, 'drop', 89), true);

  const tvar = monster(MonsterKind.TVAR, 10, 10);
  const bait = findMonsterBaitTarget(world, tvar, 0.2, state.time, state);
  assert.equal(bait?.itemId, 'rawmeat');

  const attracted = getRecentEvents(state, { type: 'monster_bait_attracted', limit: 1 })[0];
  assert.equal(attracted.monsterKind, MonsterKind.TVAR);
  assert.ok((attracted.data?.ecologyTags as string[]).includes('monster_tvar'));
  assert.ok(Number(attracted.data?.baitFit) > 1);
});

test('small monsters claim nearby bait through a capped marker scan', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 10, currentFloor: FloorLevel.LIVING });

  assert.equal(placeMonsterBait(state, world, actor(), 10, 10, 'bread', 1, 'drop', 99), true);
  const sborka = monster(MonsterKind.SBORKA, 13, 10);
  const bait = findMonsterBaitTarget(world, sborka, 0.2, state.time, state);
  assert.equal(bait?.itemId, 'bread');
  assert.equal(sborka.ai?.baitMarkerId, bait?.id);
  assert.equal(getRecentEvents(state, { type: 'monster_bait_attracted', limit: 1 })[0]?.monsterKind, MonsterKind.SBORKA);

  const eye = monster(MonsterKind.EYE, 13, 10, 3);
  assert.equal(findMonsterBaitTarget(world, eye, 0.2, state.time, state), null);
});

test('bait markers are scoped to the current route floor key, not only FloorLevel', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 10, currentFloor: FloorLevel.KVARTIRY });
  setFloorRunState(state, { runSeed: 17, currentZ: 12 }, FloorLevel.KVARTIRY);

  assert.equal(placeMonsterBait(state, world, actor(), 10, 10, 'bread', 1, 'drop', 99), true);
  setFloorRunState(state, { runSeed: 17, currentZ: 8 }, FloorLevel.KVARTIRY);

  const sborka = monster(MonsterKind.SBORKA, 13, 10);
  assert.equal(findMonsterBaitTarget(world, sborka, 0.2, state.time, state), null);
  expireMonsterBaits(state, state.time + 1);
  assert.equal(getActiveMonsterBaits().length, 0);
});

test('bait markers expire and stay under the active cap', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ time: 20, currentFloor: FloorLevel.LIVING });
  const player = actor();

  for (let i = 0; i < MONSTER_BAIT_MAX_ACTIVE + 3; i++) {
    state.time = 20 + i;
    assert.equal(placeMonsterBait(state, world, player, 20 + i, 10, 'bread', 1, 'drop', 200 + i), true);
  }
  assert.equal(getActiveMonsterBaits().length, MONSTER_BAIT_MAX_ACTIVE);

  expireMonsterBaits(state, 100);
  assert.equal(getActiveMonsterBaits().length, 0);
  const expired = getRecentEvents(state, { type: 'monster_bait_expired', limit: 1 })[0];
  assert.equal(expired?.data?.source, 'drop');
  assert.equal(expired?.data?.outcome, 'failure');
  assert.ok(expired?.tags.includes('failure'));
});

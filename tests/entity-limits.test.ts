import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityType, type Entity } from '../src/core/types';
import {
  ACTIVE_ACTOR_SOFT_LIMIT,
  ENTITY_SOFT_LIMITS,
  FLOOR_OBJECT_SOFT_LIMIT,
  MAX_ACTIVE_ACTOR_SOFT_LIMIT,
  MIN_ACTIVE_ACTOR_SOFT_LIMIT,
  activeActorCountAtDefaultSoftLimit,
  fitActiveActorCounts,
  normalizeActiveActorSoftLimit,
  setActiveActorSoftLimit,
} from '../src/data/entity_limits';
import {
  canSpawnEntityType,
  countLiveActiveActors,
  countLiveEntitiesOfType,
  countLiveFloorObjects,
  entitySpawnSlots,
  remainingActiveActorSpawnSlots,
  remainingEntitySpawnSlots,
  remainingFloorObjectSpawnSlots,
} from '../src/systems/entity_limits';

function entity(id: number, type: EntityType, alive = true): Entity {
  return {
    id,
    type,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive,
    speed: 0,
    sprite: 0,
  } as Entity;
}

test('entity soft limits are centralized by gameplay type', () => {
  assert.equal(ACTIVE_ACTOR_SOFT_LIMIT, 4_096);
  assert.equal(FLOOR_OBJECT_SOFT_LIMIT, 65_536);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.NPC], ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.MONSTER], ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.ITEM_DROP], FLOOR_OBJECT_SOFT_LIMIT);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.PROJECTILE], FLOOR_OBJECT_SOFT_LIMIT);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.BILLBOARD], FLOOR_OBJECT_SOFT_LIMIT);
  assert.equal(ENTITY_SOFT_LIMITS[EntityType.PROJECTILE], ENTITY_SOFT_LIMITS[EntityType.ITEM_DROP]);
  assert.deepEqual(fitActiveActorCounts(8_192, 2_048), { npcs: 3277, monsters: 819 });
});

test('entity spawn slots stop population spawns at the shared active actor ceiling', () => {
  const entities = Array.from({ length: ACTIVE_ACTOR_SOFT_LIMIT }, (_, i) => entity(i + 1, EntityType.NPC));
  assert.equal(countLiveEntitiesOfType(entities, EntityType.NPC), ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(countLiveActiveActors(entities), ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(remainingEntitySpawnSlots(entities, EntityType.NPC), 0);
  assert.equal(remainingEntitySpawnSlots(entities, EntityType.MONSTER), 0);
  assert.equal(remainingActiveActorSpawnSlots(entities), 0);
  assert.equal(entitySpawnSlots(entities, EntityType.NPC, 8), 0);
  assert.equal(entitySpawnSlots(entities, EntityType.MONSTER, 8), 0);
  assert.equal(canSpawnEntityType(entities, EntityType.NPC), false);
  assert.equal(canSpawnEntityType(entities, EntityType.MONSTER), false);

  entities[123].alive = false;
  assert.equal(remainingEntitySpawnSlots(entities, EntityType.NPC), 1);
  assert.equal(remainingEntitySpawnSlots(entities, EntityType.MONSTER), 1);
  assert.equal(remainingActiveActorSpawnSlots(entities), 1);
  assert.equal(entitySpawnSlots(entities, EntityType.NPC, 8), 1);
});

test('entity spawn slots ignore unrelated and dead entities', () => {
  const entities = [
    entity(1, EntityType.NPC),
    entity(2, EntityType.NPC, false),
    entity(3, EntityType.MONSTER),
    entity(4, EntityType.ITEM_DROP),
    entity(5, EntityType.BILLBOARD),
  ];
  assert.equal(countLiveEntitiesOfType(entities, EntityType.NPC), 1);
  assert.equal(entitySpawnSlots(entities, EntityType.MONSTER, 12), 12);
  assert.equal(entitySpawnSlots(entities, EntityType.ITEM_DROP, 12), 12);
  assert.equal(entitySpawnSlots(entities, EntityType.BILLBOARD, 12), 12);
});

test('monster and NPC slots share one live actor pool', () => {
  const entities = [
    ...Array.from({ length: 2_600 }, (_, i) => entity(i + 1, EntityType.NPC)),
    ...Array.from({ length: 1_200 }, (_, i) => entity(i + 10_000, EntityType.MONSTER)),
    entity(99_998, EntityType.ITEM_DROP),
  ];
  assert.equal(countLiveActiveActors(entities), 3_800);
  assert.equal(remainingActiveActorSpawnSlots(entities), 296);
  assert.equal(entitySpawnSlots(entities, EntityType.NPC, 1_000), 296);
  assert.equal(entitySpawnSlots(entities, EntityType.MONSTER, 1_000), 296);
  assert.equal(entitySpawnSlots(entities, EntityType.ITEM_DROP, 1_000), 1_000);
});

test('native player body is outside the shared actor population cap', () => {
  const playerMonster = { ...entity(42, EntityType.MONSTER), persistentNpcId: 'player' };
  const entities = [
    playerMonster,
    ...Array.from({ length: ACTIVE_ACTOR_SOFT_LIMIT }, (_, i) => entity(i + 100, EntityType.NPC)),
  ];

  assert.equal(countLiveEntitiesOfType(entities, EntityType.MONSTER), 0);
  assert.equal(countLiveActiveActors(entities), ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(remainingActiveActorSpawnSlots(entities), 0);
  entities[1].alive = false;
  assert.equal(entitySpawnSlots(entities, EntityType.MONSTER, 8), 1);
});

test('floor object slots are shared by projectiles item drops and billboards', () => {
  const limit = ENTITY_SOFT_LIMITS[EntityType.PROJECTILE] ?? 0;
  const nearLimit = [
    ...Array.from({ length: limit - 2 }, (_, i) => entity(i + 1, EntityType.ITEM_DROP)),
    entity(limit - 1, EntityType.BILLBOARD),
    entity(limit, EntityType.PROJECTILE, false),
  ];

  assert.equal(countLiveFloorObjects(nearLimit), limit - 1);
  assert.equal(remainingFloorObjectSpawnSlots(nearLimit), 1);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.PROJECTILE), 1);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.ITEM_DROP), 1);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.BILLBOARD), 1);
  assert.equal(entitySpawnSlots(nearLimit, EntityType.PROJECTILE, 16), 1);
  assert.equal(canSpawnEntityType(nearLimit, EntityType.PROJECTILE), true);

  nearLimit.push(entity(limit + 1, EntityType.PROJECTILE));
  assert.equal(countLiveFloorObjects(nearLimit), limit);
  assert.equal(remainingFloorObjectSpawnSlots(nearLimit), 0);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.PROJECTILE), 0);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.ITEM_DROP), 0);
  assert.equal(remainingEntitySpawnSlots(nearLimit, EntityType.BILLBOARD), 0);
  assert.equal(entitySpawnSlots(nearLimit, EntityType.PROJECTILE, 16), 0);
  assert.equal(canSpawnEntityType(nearLimit, EntityType.PROJECTILE), false);
});

test('active actor soft cap can be adjusted for a new run', () => {
  assert.equal(normalizeActiveActorSoftLimit(null), ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(normalizeActiveActorSoftLimit(''), ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(normalizeActiveActorSoftLimit(777), MIN_ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(normalizeActiveActorSoftLimit(99_999), MAX_ACTIVE_ACTOR_SOFT_LIMIT);
  const previous = ACTIVE_ACTOR_SOFT_LIMIT;
  try {
    assert.equal(setActiveActorSoftLimit(1_024), 1_024);
    assert.equal(activeActorCountAtDefaultSoftLimit(4_096), 1_024);
    assert.equal(activeActorCountAtDefaultSoftLimit(2_381), 595);
    const full = Array.from({ length: 1_024 }, (_, i) => entity(i + 1, EntityType.MONSTER));
    assert.equal(ENTITY_SOFT_LIMITS[EntityType.NPC], 1_024);
    assert.equal(remainingActiveActorSpawnSlots(full), 0);
    assert.equal(entitySpawnSlots(full, EntityType.NPC, 8), 0);
    full[0].alive = false;
    assert.equal(entitySpawnSlots(full, EntityType.NPC, 8), 1);
  } finally {
    setActiveActorSoftLimit(previous);
  }
});

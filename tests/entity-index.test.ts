import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityType, Faction, W, type Entity } from '../src/core/types';
import {
  ENTITY_MASK_ACTOR,
  ENTITY_MASK_BILLBOARD,
  ENTITY_MASK_MONSTER,
  ENTITY_MASK_NPC,
  ENTITY_MASK_VISIBLE,
  EntityIndex,
  ensureEntityIndex,
  markEntityIndexDirty,
  rebuildEntityIndex,
} from '../src/systems/entity_index';

function entity(id: number, type: EntityType, x: number, y: number, alive = true): Entity {
  return {
    id,
    type,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive,
    speed: 0,
    sprite: 0,
    faction: type === EntityType.NPC ? Faction.CITIZEN : undefined,
  };
}

test('entity index keeps alive byId entries and ignores dead entities', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 10, 10),
    entity(2, EntityType.MONSTER, 11, 10, false),
  ]);

  assert.equal(index.byId.get(1)?.id, 1);
  assert.equal(index.byId.has(2), false);
});

test('entity index exposes live AI actors and projectiles', () => {
  const index = new EntityIndex();
  const npc = entity(1, EntityType.NPC, 10, 10);
  npc.needs = { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 };
  const projectile = entity(2, EntityType.PROJECTILE, 11, 10);
  const drop = entity(3, EntityType.ITEM_DROP, 12, 10);
  const billboard = entity(4, EntityType.BILLBOARD, 13, 10);
  npc.ai = { goal: 0, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
  projectile.projLife = 1;
  index.rebuild([npc, projectile, drop, billboard]);

  assert.deepEqual(index.actors.map(e => e.id), [1]);
  assert.deepEqual(index.ai.map(e => e.id), [1]);
  assert.deepEqual(index.needs.map(e => e.id), [1]);
  assert.deepEqual(index.projectiles.map(e => e.id), [2]);
});

test('entity index radius queries wrap around the torus edge', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 1, 1),
    entity(2, EntityType.MONSTER, W - 2, 1),
    entity(3, EntityType.NPC, W / 2, W / 2),
  ]);

  const out: Entity[] = [];
  index.queryRadius(0, 1, 4, out, ENTITY_MASK_ACTOR);

  assert.deepEqual(out.map(e => e.id).sort((a, b) => a - b), [1, 2]);
});

test('entity index type masks filter query results', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 20, 20),
    entity(2, EntityType.MONSTER, 21, 20),
    entity(3, EntityType.ITEM_DROP, 22, 20),
  ]);

  const out: Entity[] = [];
  index.queryRadius(20, 20, 6, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), [1]);

  index.queryRadius(20, 20, 6, out, ENTITY_MASK_MONSTER);
  assert.deepEqual(out.map(e => e.id), [2]);
});

test('entity index type-specific dynamic buckets follow simulation rebuild movement', () => {
  const index = new EntityIndex();
  const npc = entity(1, EntityType.NPC, 20, 20);
  const monster = entity(2, EntityType.MONSTER, 80, 80);
  const entities = [npc, monster];
  const out: Entity[] = [];

  index.rebuildForSimulation(entities, 1);
  index.queryRadius(20, 20, 4, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), [1]);
  index.queryRadius(80, 80, 4, out, ENTITY_MASK_MONSTER);
  assert.deepEqual(out.map(e => e.id), [2]);

  npc.x = 96;
  npc.y = 96;
  monster.x = 20;
  monster.y = 20;
  index.rebuildForSimulation(entities, 2);

  index.queryRadius(20, 20, 4, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), []);
  index.queryRadius(96, 96, 4, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), [1]);
  index.queryRadius(20, 20, 4, out, ENTITY_MASK_MONSTER);
  assert.deepEqual(out.map(e => e.id), [2]);
});

test('billboard entities are visible but not actors or item drops', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 20, 20),
    entity(2, EntityType.BILLBOARD, 21, 20),
    entity(3, EntityType.ITEM_DROP, 22, 20),
  ]);

  const out: Entity[] = [];
  index.queryRadius(20, 20, 6, out, ENTITY_MASK_VISIBLE);
  assert.deepEqual(out.map(e => e.id).sort((a, b) => a - b), [1, 2, 3]);

  index.queryRadius(20, 20, 6, out, ENTITY_MASK_ACTOR);
  assert.deepEqual(out.map(e => e.id), [1]);

  index.queryRadius(20, 20, 6, out, ENTITY_MASK_BILLBOARD);
  assert.deepEqual(out.map(e => e.id), [2]);
});

test('entity index capped radius queries stop at the requested count', () => {
  const index = new EntityIndex();
  const entities: Entity[] = [];
  for (let i = 0; i < 24; i++) {
    entities.push(entity(i + 1, EntityType.NPC, 40 + (i % 4) * 0.5, 40 + ((i / 4) | 0) * 0.5));
  }
  index.rebuild(entities);

  const out: Entity[] = [];
  const count = index.queryRadiusCapped(40, 40, 8, out, ENTITY_MASK_NPC, 5);

  assert.equal(count, 5);
  assert.equal(out.length, 5);
  assert.ok(out.every(e => e.type === EntityType.NPC));
});

test('entity index capped radius query keeps nearest results instead of first bucket entries', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 41, 40),
    entity(2, EntityType.NPC, 63, 40),
    entity(3, EntityType.NPC, 40.25, 40),
  ]);

  const out: Entity[] = [];
  const count = index.queryRadiusCapped(40, 40, 32, out, ENTITY_MASK_NPC, 2);

  assert.equal(count, 2);
  assert.deepEqual(out.map(e => e.id), [3, 1]);
});

test('entity index capped radius query tie-breaks by stable id instead of storage order', () => {
  const routesA = [
    entity(30, EntityType.NPC, 42, 40),
    entity(10, EntityType.NPC, 42, 40),
    entity(20, EntityType.NPC, 42, 40),
  ];
  const routesB = [...routesA].reverse();
  const outA: Entity[] = [];
  const outB: Entity[] = [];

  const indexA = new EntityIndex();
  indexA.rebuild(routesA);
  indexA.queryRadiusCapped(40, 40, 4, outA, ENTITY_MASK_NPC, 2);

  const indexB = new EntityIndex();
  indexB.rebuild(routesB);
  indexB.queryRadiusCapped(40, 40, 4, outB, ENTITY_MASK_NPC, 2);

  assert.deepEqual(outA.map(e => e.id), [10, 20]);
  assert.deepEqual(outB.map(e => e.id), [10, 20]);
});

test('entity index capped radius pruning preserves wrapped bucket ties', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(10, EntityType.NPC, 2, 40),
    entity(1, EntityType.NPC, W - 2, 40),
  ]);

  const out: Entity[] = [];
  index.queryRadiusCapped(0, 40, 4, out, ENTITY_MASK_NPC, 1);

  assert.deepEqual(out.map(e => e.id), [1]);
});

test('entity index capped path query keeps earliest path hits instead of first bucket entries', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(20, EntityType.NPC, 72, 15),
    entity(10, EntityType.NPC, 41, 40),
  ]);

  const out: Entity[] = [];
  const count = index.queryPathRadius(40, 40, 120, 40, 25, out, ENTITY_MASK_NPC, 1);

  assert.equal(count, 1);
  assert.deepEqual(out.map(e => e.id), [10]);
});

test('entity index exposes debug version, entity counts and bucket stats', () => {
  const index = new EntityIndex();
  index.rebuild([
    entity(1, EntityType.NPC, 20, 20),
    entity(2, EntityType.MONSTER, 21, 20),
    entity(3, EntityType.ITEM_DROP, 200, 200, false),
  ], 'load');

  const stats = index.getDebugStats();
  assert.equal(stats.version, 1);
  assert.equal(stats.rebuildReason, 'load');
  assert.equal(stats.entityCount, 3);
  assert.equal(stats.liveEntityCount, 2);
  assert.equal(stats.actorCount, 2);
  assert.ok(stats.buckets.bucketCount > 0);
  assert.equal(stats.buckets.usedBucketCount, 1);
  assert.equal(stats.buckets.maxBucketSize, 2);
  assert.equal(stats.buckets.meanUsedBucketSize, 2);
});

test('planned simulation rebuild is idempotent per frame token', () => {
  const index = new EntityIndex();
  const entities = [
    entity(1, EntityType.NPC, 20, 20),
    entity(2, EntityType.MONSTER, 40, 40),
  ];

  index.rebuildForSimulation(entities, 7);
  assert.equal(index.getVersion(), 1);
  assert.equal(index.getDebugStats().simulationFrame, 7);

  index.rebuildForSimulation(entities, 7);
  assert.equal(index.getVersion(), 1);

  index.rebuildForSimulation(entities, 8);
  assert.equal(index.getVersion(), 2);
  assert.equal(index.getDebugStats().simulationFrame, 8);
});

test('runtime ensure uses the dynamic simulation path when the flat entity array grows in place', () => {
  const entities = [
    entity(1, EntityType.NPC, 20, 20),
  ];

  const first = rebuildEntityIndex(entities);
  assert.equal(first.byId.has(2), false);

  entities.push(entity(2, EntityType.MONSTER, 24, 20));
  const rebuilt = ensureEntityIndex(entities);

  assert.equal(rebuilt.byId.get(2)?.id, 2);
  assert.equal(rebuilt.getDebugStats().rebuildReason, 'simulation');
});

test('simulation rebuild preserves static visible byId entries and prunes dead ones', () => {
  const entities = [
    entity(1, EntityType.NPC, 20, 20),
    entity(2, EntityType.ITEM_DROP, 24, 20),
    entity(3, EntityType.BILLBOARD, 25, 20),
  ];

  const index = new EntityIndex();
  index.rebuildForSimulation(entities, 1);
  assert.equal(index.byId.get(2)?.id, 2);
  assert.equal(index.byId.get(3)?.id, 3);

  entities[1].alive = false;
  index.rebuildForSimulation(entities, 2);

  assert.equal(index.byId.has(2), false);
  assert.equal(index.byId.get(3)?.id, 3);
});

test('runtime dirty mark forces ensure to rebuild moved entity buckets', () => {
  const entities = [
    entity(1, EntityType.NPC, 20, 20),
  ];
  rebuildEntityIndex(entities);
  entities[0].x = 80;
  entities[0].y = 80;
  markEntityIndexDirty();

  const rebuilt = ensureEntityIndex(entities);
  const out: Entity[] = [];
  rebuilt.queryRadius(20, 20, 4, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), []);
  rebuilt.queryRadius(80, 80, 4, out, ENTITY_MASK_NPC);
  assert.deepEqual(out.map(e => e.id), [1]);
});

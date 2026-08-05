import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, EntityType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { requireSpawnedPlotNpcFromPackage } from '../src/gen/plot_npc_spawn';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { spawnMedukaMeguku } from '../src/gen/hell/madoka';
import { spawnGorlanov } from '../src/gen/kvartiry/gorlanov';
import { spawnPolkovnikStreltsov } from '../src/gen/ministry/streltsov';
import { spawnGordonFreeman } from '../src/gen/maintenance/gordon';
import { generateTraceSealProtocol } from '../src/gen/void/trace_seal_protocol';

function openTestWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.roomMap.fill(0);
  return world;
}

function withFixedRandom<T>(value: number, run: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = original;
  }
}

function plotNpc(entities: readonly Entity[], plotNpcId: string): Entity & { npcPackageId?: string } {
  const entity = entities.find(candidate => (
    candidate.type === EntityType.NPC &&
    candidate.plotNpcId === plotNpcId
  ));
  assert.ok(entity, `${plotNpcId} should spawn`);
  return entity;
}

test('strict package NPC spawn rejects missing packages', () => {
  assert.throws(
    () => requireSpawnedPlotNpcFromPackage([], { v: 1 }, 'missing_story_floor_package', 1.5, 1.5),
    /missing NPC package/,
  );
});

test('migrated Kvartiry named actor carries package id', () => {
  const entities: Entity[] = [];
  withFixedRandom(0, () => spawnGorlanov(openTestWorld(), entities, { v: 10 }));

  const gorlanov = plotNpc(entities, 'gorlanov');
  assert.equal(gorlanov.npcPackageId, 'gorlanov');
});

test('migrated Ministry named actor carries package id', () => {
  const entities: Entity[] = [];
  withFixedRandom(0, () => spawnPolkovnikStreltsov(openTestWorld(), entities, { v: 20 }));

  const streltsov = plotNpc(entities, 'polkovnik_streltsov');
  assert.equal(streltsov.npcPackageId, 'polkovnik_streltsov');
});

test('migrated Maintenance named actor carries package id', () => {
  const entities: Entity[] = [];
  withFixedRandom(0, () => spawnGordonFreeman(openTestWorld(), entities, { v: 30 }));

  const gordon = plotNpc(entities, 'gordon_freeman');
  assert.equal(gordon.npcPackageId, 'gordon_freeman');
});

test('migrated Hell named actor carries package id', () => {
  const entities: Entity[] = [];
  withFixedRandom(0, () => spawnMedukaMeguku(openTestWorld(), entities, { v: 40 }));

  const meduka = plotNpc(entities, 'meduka_meguku');
  assert.equal(meduka.npcPackageId, 'meduka_meguku');
});

test('migrated Void named actors carry package ids', () => {
  const world = openTestWorld();
  const entities: Entity[] = [];

  generateTraceSealProtocol(world, entities, { v: 50 }, 512, 512);

  const clerk = plotNpc(entities, 'floor20_void_protocol_clerk');
  const neighbor = plotNpc(entities, 'floor20_void_borrowed_neighbor');
  assert.equal(clerk.npcPackageId, 'floor20_void_protocol_clerk');
  assert.equal(neighbor.npcPackageId, 'floor20_void_borrowed_neighbor');
});

test('migrated design-floor named actors carry package ids', () => {
  const switchyard = generateDesignFloor('hyperbolic_switchyard', 707);
  const bureau = generateDesignFloor('upper_bureau', 909);

  const guide = plotNpc(switchyard.entities, 'hyperbolic_switchyard_guide_zinaida');
  const iskra = plotNpc(bureau.entities, 'bureau_madam_iskra');
  assert.equal(guide.npcPackageId, 'hyperbolic_switchyard_guide_zinaida');
  assert.equal(iskra.npcPackageId, 'bureau_madam_iskra');
});

test('NPC-free endgame design floor remains NPC-free after manifest filtering', () => {
  const gen = generateDesignFloor('darkness', 808);

  assert.equal(gen.entities.some(entity => entity.type === EntityType.NPC), false);
});

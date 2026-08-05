import test from 'node:test';
import assert from 'node:assert/strict';
import { AIGoal, Cell, EntityType, Feature, FloorLevel, W, type Entity } from '../src/core/types';
import type { World } from '../src/core/world';
import {
  HELL_POPULATION_PROFILE,
  KVARTIRY_POPULATION_PROFILE,
  PROCEDURAL_POPULATION_PROFILES,
  proceduralAnomalyPressure,
  proceduralPopulationBudget,
  proceduralPopulationProfileId,
  VOID_POPULATION_PROFILE,
} from '../src/data/population_profiles';
import {
  ACTIVE_ACTOR_SOFT_LIMIT,
  activeActorCountAtDefaultSoftLimit,
  setActiveActorSoftLimit,
} from '../src/data/entity_limits';
import { DESIGN_FLOOR_ROUTES } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import {
  PROCEDURAL_FLOOR_ZS,
  floorRunZAllowsNpcs,
  makeProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateHell } from '../src/gen/hell';
import { generateKvartiry } from '../src/gen/kvartiry';
import { generateFloor } from '../src/gen/floor_manifest';
import { updateAI } from '../src/systems/ai';
import { rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { testGenerationMatrix } from './generator_helpers';
import { makeGameState, makeTestPlayer } from './helpers';

function liveActors(entities: readonly { alive: boolean; type: EntityType; ai?: unknown }[]): readonly { ai?: unknown }[] {
  return entities.filter(e => e.alive && (e.type === EntityType.NPC || e.type === EntityType.MONSTER));
}

function liveAiActors(entities: readonly { alive: boolean; type: EntityType; ai?: unknown }[]): readonly { ai?: unknown }[] {
  return liveActors(entities).filter(e => e.ai);
}

function maxLiveActorsInArea(
  entities: readonly { alive: boolean; type: EntityType; x: number; y: number }[],
  areaSize: number,
): number {
  const side = Math.ceil(W / areaSize);
  const counts = new Int32Array(side * side);
  let max = 0;
  for (const entity of entities) {
    if (!entity.alive || (entity.type !== EntityType.NPC && entity.type !== EntityType.MONSTER)) continue;
    const bx = Math.min(side - 1, Math.max(0, Math.floor(entity.x / areaSize)));
    const by = Math.min(side - 1, Math.max(0, Math.floor(entity.y / areaSize)));
    const next = ++counts[by * side + bx];
    if (next > max) max = next;
  }
  return max;
}

function proceduralIndustrial(geometryId: string): boolean {
  return geometryId === 'collectors' || geometryId === 'workshops' || geometryId === 'service_spines';
}

function tickOneAlifeFrame(gen: { world: World; entities: Entity[]; spawnX: number; spawnY: number }, floor: FloorLevel): void {
  const player = makeTestPlayer({ id: 900_000, x: gen.spawnX, y: gen.spawnY, hp: 100, maxHp: 100 });
  gen.entities.unshift(player);
  const state = makeGameState({
    currentFloor: floor,
    time: 0,
    clock: { hour: 9, minute: 0, totalMinutes: 9 * 60 },
  });
  rebuildEntityIndexForSimulation(gen.entities, 1);
  updateAI(gen.world, gen.entities, 1 / 60, 0, state.msgs, player.id, state.clock, false, { v: 1_000_000 }, floor, state);
}

function tasklessNpcCount(entities: readonly Entity[]): number {
  let count = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.NPC || !entity.ai) continue;
    if (entity.persistentNpcId === 'player') continue;
    if (entity.ai.goal === AIGoal.IDLE && entity.ai.combatTargetId === undefined && entity.ai.npcState === undefined) count++;
  }
  return count;
}

function idleMovingMonsterCount(entities: readonly Entity[]): number {
  let count = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.MONSTER || !entity.ai) continue;
    if (entity.speed > 0 && entity.ai.goal === AIGoal.IDLE && entity.ai.combatTargetId === undefined) count++;
  }
  return count;
}

testGenerationMatrix('KVARTIRY starts as a power-of-two actor AI floor', () => {
  const gen = generateKvartiry();
  const actors = liveActors(gen.entities);
  assert.equal(actors.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(actors.length >= ACTIVE_ACTOR_SOFT_LIMIT - 128, true);
  assert.equal(liveAiActors(gen.entities).length, actors.length);
  assert.equal(gen.entities.filter(e => e.type === EntityType.NPC).length >= activeActorCountAtDefaultSoftLimit(KVARTIRY_POPULATION_PROFILE.citizens.initial), true);
  tickOneAlifeFrame(gen, FloorLevel.KVARTIRY);
  assert.equal(tasklessNpcCount(gen.entities), 0);
});

testGenerationMatrix('HELL starts as a power-of-two actor AI floor', () => {
  const gen = generateHell();
  const actors = liveActors(gen.entities);
  const monsters = gen.entities.filter(e => e.alive && e.type === EntityType.MONSTER);
  const sightlineCues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('sightline') && marker.tags.includes('fallback'));
  assert.equal(actors.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(actors.length >= ACTIVE_ACTOR_SOFT_LIMIT - 128, true);
  assert.equal(liveAiActors(gen.entities).length, actors.length);
  assert.equal(monsters.length >= activeActorCountAtDefaultSoftLimit(HELL_POPULATION_PROFILE.monsters.initial), true);
  assert.equal(maxLiveActorsInArea(gen.entities, 32) <= 24, true);
  assert.equal(sightlineCues.length >= 5, true);
  for (const cue of sightlineCues) {
    const cell = gen.world.idx(Math.floor(cue.targetX), Math.floor(cue.targetY));
    assert.equal(gen.world.cells[cell] === Cell.FLOOR || gen.world.cells[cell] === Cell.DOOR, true);
    assert.equal(gen.world.floorTex[cell] !== 0, true);
  }
  assert.equal(sightlineCues.some(cue => gen.world.features[gen.world.idx(Math.floor(cue.targetX), Math.floor(cue.targetY))] === Feature.SCREEN), true);
  tickOneAlifeFrame(gen, FloorLevel.HELL);
  assert.equal(idleMovingMonsterCount(gen.entities) <= 5, true);
});

testGenerationMatrix('VOID keeps NPC-free endgame density through monsters', () => {
  const gen = generateFloor(FloorLevel.VOID);
  const actors = liveActors(gen.entities);
  assert.equal(gen.entities.some(e => e.type === EntityType.NPC), false);
  assert.equal(actors.length >= 1000, true);
  assert.equal(liveAiActors(gen.entities).length, actors.length);
  assert.equal(gen.entities.filter(e => e.type === EntityType.MONSTER).length >= activeActorCountAtDefaultSoftLimit(VOID_POPULATION_PROFILE.guardians), true);
  assert.equal(VOID_POPULATION_PROFILE.floor, FloorLevel.VOID);
});

test('procedural population budget scales by danger anomaly pressure and route band', () => {
  const calm = proceduralPopulationBudget({
    z: 2,
    danger: 1,
    anomalyPressure: 0,
    industrial: false,
    npcAllowed: true,
    profileId: 'normal',
  });
  const dangerous = proceduralPopulationBudget({
    z: 2,
    danger: 5,
    anomalyPressure: 0,
    industrial: false,
    npcAllowed: true,
    profileId: 'normal',
  });
  const pressured = proceduralPopulationBudget({
    z: 2,
    danger: 5,
    anomalyPressure: 2,
    industrial: false,
    npcAllowed: true,
    profileId: 'normal',
  });
  const deep = proceduralPopulationBudget({
    z: 29,
    danger: 5,
    anomalyPressure: 2,
    industrial: false,
    npcAllowed: true,
    profileId: 'normal',
  });
  const capped = proceduralPopulationBudget({
    z: 29,
    danger: 99,
    anomalyPressure: 99,
    industrial: true,
    npcAllowed: true,
    profileId: 'highDensity',
  });
  const voidRoute = proceduralPopulationBudget({
    z: 37,
    danger: 5,
    anomalyPressure: 2,
    industrial: true,
    npcAllowed: false,
    profileId: 'highDensity',
  });

  assert.equal(calm.npcs < dangerous.npcs, true);
  assert.equal(dangerous.monsters < pressured.monsters, true);
  assert.equal(pressured.monsters < deep.monsters, true);
  assert.equal(capped.npcs + capped.monsters, ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(capped.npcs > capped.monsters, true);
  assert.equal(capped.npcs <= PROCEDURAL_POPULATION_PROFILES.highDensity.npcs.cap, true);
  assert.equal(capped.monsters <= PROCEDURAL_POPULATION_PROFILES.highDensity.monsters.cap, true);
  assert.equal(voidRoute.npcs, 0);
  assert.equal(voidRoute.monsters <= PROCEDURAL_POPULATION_PROFILES.highDensity.monsters.cap, true);
});

test('procedural population deck keeps random slots normal-density unless the rare high-density anomaly is chosen', () => {
  const seeds = [1, 7, 321, 999, 2468, 12345];
  const summary = {
    slots: 0,
    normal: 0,
    highDensity: 0,
    maxNormalActors: 0,
    maxHighDensityActors: 0,
    npcFreeRouteSlots: 0,
  };

  for (const seed of seeds) {
    for (const z of PROCEDURAL_FLOOR_ZS) {
      const spec = makeProceduralFloorSpec(seed, z);
      const npcAllowed = floorRunZAllowsNpcs(spec.z);
      const profileId = proceduralPopulationProfileId(spec.anomalyId);
      const budget = proceduralPopulationBudget({
        z: spec.z,
        danger: spec.danger,
        anomalyPressure: proceduralAnomalyPressure(spec.anomalyId),
        industrial: proceduralIndustrial(spec.geometryId),
        npcAllowed,
        profileId,
      });
      const actorBudget = budget.npcs + budget.monsters;
      assert.equal(actorBudget <= ACTIVE_ACTOR_SOFT_LIMIT, true);

      summary.slots++;
      assert.equal(budget.npcs <= budget.npcCap, true);
      assert.equal(budget.monsters <= budget.monsterCap, true);
      if (!npcAllowed) {
        summary.npcFreeRouteSlots++;
        assert.equal(budget.npcs, 0);
      }

      if (profileId === 'highDensity') {
        summary.highDensity++;
        summary.maxHighDensityActors = Math.max(summary.maxHighDensityActors, actorBudget);
        assert.equal(spec.anomalyId, 'zombie_apocalypse');
      } else {
        summary.normal++;
        summary.maxNormalActors = Math.max(summary.maxNormalActors, actorBudget);
        assert.notEqual(spec.anomalyId, 'zombie_apocalypse');
        assert.equal(actorBudget <= PROCEDURAL_POPULATION_PROFILES.normal.npcs.cap + PROCEDURAL_POPULATION_PROFILES.normal.monsters.cap, true);
      }
    }
  }

  assert.equal(new Set(PROCEDURAL_FLOOR_ZS).size, PROCEDURAL_FLOOR_ZS.length);
  assert.equal(summary.slots, PROCEDURAL_FLOOR_ZS.length * seeds.length);
  assert.equal(summary.highDensity > 0, true);
  assert.equal(summary.normal > summary.highDensity, true);
  assert.equal(summary.maxNormalActors < activeActorCountAtDefaultSoftLimit(KVARTIRY_POPULATION_PROFILE.citizens.initial), true);
  assert.equal(summary.maxHighDensityActors > summary.maxNormalActors, true);
  assert.equal(summary.npcFreeRouteSlots > 0, true);
});

test('actor population targets derive from the active actor soft cap', () => {
  const previous = ACTIVE_ACTOR_SOFT_LIMIT;
  try {
    setActiveActorSoftLimit(2_048);
    assert.equal(activeActorCountAtDefaultSoftLimit(4_096), 2_048);
    const procedural = proceduralPopulationBudget({
      z: 2,
      danger: 1,
      anomalyPressure: 0,
      industrial: false,
      npcAllowed: true,
      profileId: 'normal',
    });
    assert.equal(procedural.npcs, 205);
    assert.equal(procedural.monsters, 115);

    const blackMarket = DESIGN_FLOOR_ROUTES.find(route => route.id === 'black_market_88');
    assert.ok(blackMarket);
    const profile = designFloorPopulationProfile(blackMarket);
    assert.equal(profile.npcTarget, 1_100);
    assert.equal(profile.monsterTarget, 350);

    const podad = DESIGN_FLOOR_ROUTES.find(route => route.id === 'podad');
    assert.ok(podad);
    assert.equal(designFloorPopulationProfile(podad).monsterTarget, ACTIVE_ACTOR_SOFT_LIMIT);
  } finally {
    setActiveActorSoftLimit(previous);
  }
});

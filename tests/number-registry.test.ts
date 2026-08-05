import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, Feature, FloorLevel, RoomType, W, ZoneFaction, type Entity } from '../src/core/types';
import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';
import { designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { SIDE_QUESTS } from '../src/data/plot';
import { expandDesignFloorGeneration } from '../src/gen/design_floors/full_floor';
import {
  NUMBER_REGISTRY_CRT_INTERSECTIONS,
  NUMBER_REGISTRY_DECISIONS,
  NUMBER_REGISTRY_RESIDUE_LANES,
  NUMBER_REGISTRY_ROUTE_ID,
  NUMBER_REGISTRY_TERRITORY_TARGETS,
  generateNumberRegistryDesignFloor,
} from '../src/gen/design_floors/number_registry';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt } from '../src/systems/territory';

function generateNumberRegistry() {
  const route = designFloorById(NUMBER_REGISTRY_ROUTE_ID);
  assert.ok(route);
  return expandDesignFloorGeneration(generateNumberRegistryDesignFloor(), route);
}

let cachedNumberRegistry: ReturnType<typeof generateNumberRegistry> | undefined;

function numberRegistryForRead(): ReturnType<typeof generateNumberRegistry> {
  cachedNumberRegistry ??= generateNumberRegistry();
  return cachedNumberRegistry;
}

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1;
}

test('number_registry is a Ministry authored route with residue population pressure', () => {
  const route = designFloorById(NUMBER_REGISTRY_ROUTE_ID);
  assert.ok(route);
  assert.equal(route.z, 32);
  assert.equal(route.baseFloor, FloorLevel.MINISTRY);
  assert.equal(route.role.includes('модули'), true);

  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 980);
  assert.equal(profile.monsterTarget, 980);
  assert.equal(profile.npcNoun, 'регистрант');
  assert.equal(profile.monsterTags.includes('prime_corridor'), true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.roomWeights?.[RoomType.CORRIDOR] ?? 0) > 1.5, true);
});

test('number_registry generator exposes residue routes, prime risk, and composite public decisions', () => {
  const gen = numberRegistryForRead();
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));

  assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR);
  assert.equal(NUMBER_REGISTRY_RESIDUE_LANES.length, 3);
  assert.equal(NUMBER_REGISTRY_CRT_INTERSECTIONS.every(item => item.combinedResidue >= 0), true);
  assert.equal(new Set(NUMBER_REGISTRY_DECISIONS.map(item => item.route)).size, 4);

  const roomNames = new Set(gen.world.rooms.map(room => room.name));
  for (const name of [
    'Зал сверки остатков',
    'Касса модуля 7',
    'Простой рискованный коридор',
    'Составной публичный обход',
    'Китайская пересечная картотека',
  ]) {
    assert.equal(roomNames.has(name), true, `${name} room is present`);
  }

  const decisionContainers = gen.world.containers.filter(container =>
    container.tags.includes('number_registry') &&
    container.tags.some(tag => tag === 'modulus_bribe' || tag === 'prime_corridor' || tag === 'composite_path' || tag === 'crt_intersection') &&
    hasReachableAdjacentCell(gen.world, audit, gen.world.idx(container.x, container.y)));
  assert.equal(decisionContainers.length >= 4, true, 'all four decision containers should be reachable');

  const cues = getRouteCueMarkers(gen.world);
  assert.equal(cues.some(cue => cue.tags.includes('prime_corridor')), true);
  assert.equal(cues.some(cue => cue.tags.includes('composite_path')), true);
});

test('number_registry population field keeps authored actors and exact ambient targets', () => {
  const route = designFloorById(NUMBER_REGISTRY_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = numberRegistryForRead();

  const plotIds = new Set(gen.entities.map(entity => entity.plotNpcId).filter(Boolean));
  assert.equal(plotIds.has('number_registry_vera_modulus'), true);
  assert.equal(plotIds.has('number_registry_prime_guard'), true);
  assert.equal(plotIds.has('number_registry_composite_witness'), true);

  const ambientNpcs = gen.entities.filter(isAmbientNpcTemplate);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  assert.equal(ambientNpcs.length, profile.npcTarget);
  assert.equal(monsters.length, profile.monsterTarget);
});

test('number_registry expands to macro, mid, and micro geometry scale', () => {
  const gen = numberRegistryForRead();
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let floorCells = 0;
  let reachableCells = 0;
  let screens = 0;
  let lamps = 0;
  for (let i = 0; i < W * W; i++) {
    if (gen.world.cells[i] === Cell.FLOOR || gen.world.cells[i] === Cell.DOOR || gen.world.cells[i] === Cell.WATER || gen.world.cells[i] === Cell.LIFT) floorCells++;
    if (audit.reachable[i]) reachableCells++;
    if (gen.world.features[i] === Feature.SCREEN) screens++;
    if (gen.world.features[i] === Feature.LAMP) lamps++;
  }

  assert.equal(gen.world.rooms.length >= 360, true, 'registry should have a mid-scale room lattice');
  assert.equal(gen.world.doors.size >= 300, true, 'registry rooms should expose local doors');
  assert.equal(floorCells >= 180_000, true, 'floor should occupy real 1024x1024 scale');
  assert.equal(reachableCells >= 170_000, true, 'expanded registry should be reachable from spawn');
  assert.equal(screens >= 160, true, 'micro archive cells should have screens');
  assert.equal(lamps >= 60, true, 'micro rooms should carry readable fixtures');
});

test('number_registry owns cell territory from faction HQ anchors', () => {
  const gen = numberRegistryForRead();
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `owner ${ZoneFaction[owner]} should have a mini-HQ anchor`);
  }

  const counts = new Map(countTerritoryCells(gen.world, 4).map(row => [row.owner, row.cells]));
  let dominantOwner = ZoneFaction.CITIZEN;
  let dominantCells = -1;
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const cells = counts.get(owner) ?? 0;
    assert.equal(cells > 20_000, true, `owner ${ZoneFaction[owner]} should control nonzero cells`);
    if (cells > dominantCells) {
      dominantOwner = owner;
      dominantCells = cells;
    }
  }
  assert.equal(dominantOwner, ZoneFaction.SCIENTIST);

  for (const target of NUMBER_REGISTRY_TERRITORY_TARGETS) {
    const actual = (counts.get(target.owner) ?? 0) / (W * W);
    assert.equal(Math.abs(actual - target.share) <= 0.075, true, `${target.label} territory share ${actual.toFixed(3)} should approximate ${target.share}`);
  }

  let ambientOwned = 0;
  let ambientTotal = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(gen.world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal > 0, true);
  assert.equal(ambientOwned / ambientTotal >= 0.92, true, 'ambient NPC templates should prefer own faction territory');
});

test('number_registry side quests publish bribe, decode, prime, and composite hooks', () => {
  numberRegistryForRead();
  const byId = new Map(SIDE_QUESTS.map(quest => [quest.id, quest]));

  assert.equal(byId.get('number_registry_buy_modulus')?.targetRoute?.designFloorId, NUMBER_REGISTRY_ROUTE_ID);
  assert.equal(byId.get('number_registry_buy_modulus')?.eventTags?.includes('modulus_bribe'), true);
  assert.equal(byId.get('number_registry_decode_residue')?.eventTags?.includes('crt_intersection'), true);
  assert.equal(byId.get('number_registry_clear_prime_corridor')?.eventTags?.includes('prime_corridor'), true);
  assert.equal(byId.get('number_registry_file_composite_path')?.eventTags?.includes('composite_path'), true);
});

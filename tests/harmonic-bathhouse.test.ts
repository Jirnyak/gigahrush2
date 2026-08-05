import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
} from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner, territoryOwnerName } from '../src/data/factions';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import type { HarmonicBathhouseGeneration } from '../src/gen/design_floors/harmonic_bathhouse';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { getEmergencyPanels } from '../src/systems/emergency_panels';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

function weightOf<T>(items: readonly { value: T; weight: number }[], value: T): number {
  return items.find(item => item.value === value)?.weight ?? 0;
}

function hasSlowHazardNear(gen: HarmonicBathhouseGeneration, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.floor(x + dx);
      const py = Math.floor(y + dy);
      const entity = { id: -770, type: EntityType.NPC, x: px + 0.5, y: py + 0.5 } as Entity;
      if (getCellHazardMoveMultiplier(gen.world, entity) < 1) return true;
    }
  }
  return false;
}

function passableCells(gen: HarmonicBathhouseGeneration): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCellCount(gen: HarmonicBathhouseGeneration): number {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function hermeticShellCells(gen: HarmonicBathhouseGeneration, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(gen: HarmonicBathhouseGeneration, hq: Room): number {
  const supportTypes = new Set([RoomType.BATHROOM, RoomType.KITCHEN, RoomType.STORAGE, RoomType.MEDICAL, RoomType.OFFICE, RoomType.COMMON]);
  const hx = hq.x + hq.w / 2;
  const hy = hq.y + hq.h / 2;
  return gen.world.rooms.filter(room => (
    room.id !== hq.id &&
    room.type !== RoomType.HQ &&
    supportTypes.has(room.type) &&
    gen.world.dist2(hx, hy, room.x + room.w / 2, room.y + room.h / 2) <= 110 * 110
  )).length;
}

function isAmbientBathhouseNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Гармоническая баня:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined &&
    entity.faction !== Faction.PLAYER;
}

test('harmonic bathhouse route data and population profile match the pressure bathhouse brief', () => {
  const route = designFloorById('harmonic_bathhouse');
  assert.ok(route);
  assert.equal(route.z, -28);
  assert.equal(route.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route.danger, 4);

  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget >= 500 && profile.npcTarget <= 1000, true, `npc target ${profile.npcTarget}`);
  assert.equal(profile.monsterTarget >= 1500 && profile.monsterTarget <= 2300, true, `monster target ${profile.monsterTarget}`);
  assert.equal(weightOf(profile.npcFactions, Faction.LIQUIDATOR) > weightOf(profile.npcFactions, Faction.WILD), true);
  assert.equal(weightOf(profile.npcOccupations, Occupation.MECHANIC) > weightOf(profile.npcOccupations, Occupation.DOCTOR), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.TUMANNIK), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.VODYANOY_KOSHMAR), true);
});

test('harmonic bathhouse generation exposes valve, hot path, cold bypass and repair decisions', () => {
  const gen = generateDesignFloor('harmonic_bathhouse') as HarmonicBathhouseGeneration;
  const state = gen.bathhouseState;

  assert.equal(state.routeId, 'harmonic_bathhouse');
  assert.deepEqual(
    state.decisions.map(decision => decision.id).sort(),
    ['cold_flooded_bypass', 'hot_fast_path', 'repair_pressure_route', 'turn_valve'],
  );
  assert.equal(state.bands.hotFogCells >= 900, true, `hot fog cells ${state.bands.hotFogCells}`);
  assert.equal(state.bands.coldWaterCells >= 650, true, `cold water cells ${state.bands.coldWaterCells}`);
  assert.equal(state.bands.pressureCells >= 250, true, `pressure cells ${state.bands.pressureCells}`);

  const panels = getEmergencyPanels(gen.world);
  const panelDefs = new Set(panels.map(panel => panel.defId));
  for (const defId of ['panel_power', 'panel_water', 'panel_doors', 'panel_vent'] as const) {
    assert.equal(panelDefs.has(defId), true, `missing ${defId}`);
  }

  const cues = getRouteCueMarkers(gen.world);
  for (const tag of ['turn_valve', 'hot_fast_path', 'cold_flooded_bypass', 'repair_pressure_route']) {
    assert.equal(cues.some(cue => cue.tags.includes(tag)), true, `missing cue ${tag}`);
  }
  assert.equal(cues.every(cue => cue.routeGroup?.decision), true);

  const hot = state.decisions.find(decision => decision.id === 'hot_fast_path');
  const cold = state.decisions.find(decision => decision.id === 'cold_flooded_bypass');
  assert.ok(hot);
  assert.ok(cold);
  assert.equal(hasSlowHazardNear(gen, hot.x, hot.y, 58), true, 'missing hot steam hazard');
  assert.equal(hasSlowHazardNear(gen, cold.x, cold.y, 58), true, 'missing cold flood hazard');

  const waterCells = gen.world.cells.reduce((count, cell) => count + (cell === Cell.WATER ? 1 : 0), 0);
  const fogCells = gen.world.fog.reduce((count, fog) => count + (fog > 0 ? 1 : 0), 0);
  assert.equal(waterCells >= 650, true, `water cells ${waterCells}`);
  assert.equal(fogCells >= 1200, true, `fog cells ${fogCells}`);
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.BATHROOM && room.name.includes('Гармоническая купель')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('repair_pressure_route')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('hot_fast_path')), true);
});

test('harmonic bathhouse expands into route-scale bath clusters with cell-first faction territory', () => {
  const gen = generateDesignFloor('harmonic_bathhouse', 61061) as HarmonicBathhouseGeneration;
  const world = gen.world;
  const serviceNodes = world.rooms.filter(room => room.name.startsWith('Гармоническая баня: смесительный узел'));
  const microRooms = world.rooms.filter(room => room.name.startsWith('Гармоническая баня:') && !room.name.includes('смесительный узел'));
  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const targetRows = territorySharesForDesignFloor('harmonic_bathhouse');
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: TerritoryOwner): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  assert.equal(world.rooms.length >= 470, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 680, true, `doors ${world.doors.size}`);
  assert.equal(passableCells(gen) >= 290_000, true, `passable ${passableCells(gen)}`);
  assert.equal(reachableCellCount(gen) >= 290_000, true, `reachable ${reachableCellCount(gen)}`);
  assert.equal(serviceNodes.length >= 24, true, `service nodes ${serviceNodes.length}`);
  assert.equal(microRooms.length >= 360, true, `micro rooms ${microRooms.length}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${territoryOwnerName(owner)}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells for ${territoryOwnerName(owner)}`);
  }
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);

  for (const target of targetRows) {
    const actual = share(target.owner);
    assert.equal(Math.abs(actual - target.share / targetTotal) <= 0.03, true, `${territoryOwnerName(target.owner)} share ${actual.toFixed(3)}`);
  }

  for (const anchor of anchors) {
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(room.sealed, true, `sealed HQ for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(territoryRoomOwner(world, room.id), anchor.owner, `HQ owner for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(territoryOwnerAt(world, room.x + (room.w >> 1), room.y + (room.h >> 1)), anchor.owner, `HQ cell owner for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(hermeticShellCells(gen, room) > 0, true, `hermetic shell for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(nearbySupportRooms(gen, room) >= 3, true, `support rooms for ${territoryOwnerName(anchor.owner)}`);
  }

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientBathhouseNpc(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 700, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});

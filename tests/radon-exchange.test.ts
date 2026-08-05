import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Faction, FloorLevel, MonsterKind, Occupation, RoomType, W, ZoneFaction } from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  RADON_EXCHANGE_BASE_FLOOR,
  RADON_EXCHANGE_PROJECTION_KEY,
  RADON_EXCHANGE_ROOM_NAMES,
  RADON_EXCHANGE_ROUTE_ID,
  RADON_EXCHANGE_Z,
  measureRadonExchangeMetrics,
} from '../src/gen/design_floors/radon_exchange';
import { getRouteCueMarkers, routeCueCount } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

type RadonGeneration = ReturnType<typeof generateDesignFloor>;

let cached: RadonGeneration | undefined;

function radon(): RadonGeneration {
  cached ??= generateDesignFloor(RADON_EXCHANGE_ROUTE_ID);
  return cached;
}

test('radon_exchange is registered as a high Ministry route floor', () => {
  const route = designFloorById(RADON_EXCHANGE_ROUTE_ID);
  assert.equal(route?.z, RADON_EXCHANGE_Z);
  assert.equal(route?.baseFloor, RADON_EXCHANGE_BASE_FLOOR);
  assert.equal(route?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(route?.displayName, 'Радоновый обменник');
  assert.equal(route?.danger, 4);
  assert.equal(designFloorAtZ(RADON_EXCHANGE_Z)?.id, RADON_EXCHANGE_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(RADON_EXCHANGE_Z), false);

  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 48);
  assert.equal(profile.monsterTarget, 3800);
  assert.equal(profile.npcNoun, 'оператор заслонок');
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.SCIENTIST), true);
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.LIQUIDATOR), true);
  assert.equal(profile.npcOccupations.some(entry => entry.value === Occupation.ELECTRICIAN), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.SLEPOGLAZ), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.LAMPOGLAZ), true);
  assert.equal(profile.monsterTags.includes('long_sight'), true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 6, true);
});

test('radon_exchange creates scan lines, blind wedges, shutter gates and reachable lifts', () => {
  const gen = radon();
  const metrics = measureRadonExchangeMetrics(gen);
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const roomNames = new Set(gen.world.rooms.map(room => room.name));

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.rooms.length >= 360, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 300, true, `doors ${gen.world.doors.size}`);
  assert.equal(metrics.scanLineCells >= 50_000, true, `scan cells ${metrics.scanLineCells}`);
  assert.equal(metrics.serviceChordCells >= 100_000, true, `service cells ${metrics.serviceChordCells}`);
  assert.equal(metrics.blindWedgeCells >= 10_000, true, `blind wedge cells ${metrics.blindWedgeCells}`);
  assert.equal(metrics.shutterDoors >= 10, true, `shutter doors ${metrics.shutterDoors}`);
  assert.equal(metrics.projectionKeyContainers, 1);
  assert.equal(metrics.controlRooms >= 7, true, `control rooms ${metrics.controlRooms}`);
  assert.equal(metrics.coverCells >= 100, true, `cover cells ${metrics.coverCells}`);
  assert.equal(metrics.longestScanRun >= 120 && metrics.longestScanRun <= 360, true, `scan run ${metrics.longestScanRun}`);
  assert.equal(metrics.ungatedUpLiftReachable, true);
  assert.equal(metrics.ungatedDownLiftReachable, true);

  for (const name of Object.values(RADON_EXCHANGE_ROOM_NAMES)) {
    assert.equal(roomNames.has(name), true, name);
  }
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.OFFICE && room.name === RADON_EXCHANGE_ROOM_NAMES.projectionKey), true);
});

test('radon_exchange has authored cell-first faction territory and mini HQ anchors', () => {
  const gen = radon();
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;
  const share = (owner: ZoneFaction) => (counts.get(owner) ?? 0) / total;

  for (const owner of [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD]) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory ${ZoneFaction[owner]}`);
  }

  assert.equal(share(ZoneFaction.LIQUIDATOR) > share(ZoneFaction.SCIENTIST), true, `liquidator ${share(ZoneFaction.LIQUIDATOR)} scientist ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.31 && share(ZoneFaction.LIQUIDATOR) <= 0.43, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.21 && share(ZoneFaction.SCIENTIST) <= 0.32, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.11 && share(ZoneFaction.CITIZEN) <= 0.22, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.07 && share(ZoneFaction.WILD) <= 0.17, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.06 && share(ZoneFaction.CULTIST) <= 0.15, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
});

test('radon_exchange exposes projection-key, service-chord and open-scanline decisions', () => {
  const gen = radon();
  const cues = getRouteCueMarkers(gen.world);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  const lockedProjectionDoors = [...gen.world.doors.values()].filter(door => door.keyId === RADON_EXCHANGE_PROJECTION_KEY);

  assert.equal(npcs.length, 48);
  assert.equal(monsters.length, 3800);
  assert.equal(monsters.some(entity => entity.monsterKind === MonsterKind.SLEPOGLAZ), true);
  assert.equal(monsters.some(entity => entity.monsterKind === MonsterKind.LAMPOGLAZ), true);
  assert.equal(lockedProjectionDoors.length >= 2, true);
  assert.equal(lockedProjectionDoors.some(door => door.state === DoorState.LOCKED || door.state === DoorState.HERMETIC_CLOSED), true);
  assert.equal(routeCueCount(gen.world), 3);
  assert.equal(cues.some(cue => cue.tags.includes('exposed_route') && cue.tags.includes(RADON_EXCHANGE_ROUTE_ID)), true);
  assert.equal(cues.some(cue => cue.tags.includes('service_chord') && cue.tags.includes(RADON_EXCHANGE_ROUTE_ID)), true);
  assert.equal(cues.some(cue => cue.tags.includes('projection_key') && cue.tags.includes(RADON_EXCHANGE_ROUTE_ID)), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('projection_key') &&
    container.inventory.some(item => item.defId === RADON_EXCHANGE_PROJECTION_KEY)), true);
});

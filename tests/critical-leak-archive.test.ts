import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, LiftDirection, RoomType, W, ZoneFaction } from '../src/core/types';
import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';
import { designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import {
  CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
  CRITICAL_LEAK_ARCHIVE_ROOM_NAMES,
  CRITICAL_LEAK_ARCHIVE_ROUTE_ID,
  CRITICAL_LEAK_ARCHIVE_Z,
  type CriticalLeakArchiveGeneration,
} from '../src/gen/design_floors/critical_leak_archive';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

let cachedGeneration: CriticalLeakArchiveGeneration | undefined;

function generatedCriticalLeakArchive(): CriticalLeakArchiveGeneration {
  cachedGeneration ??= generateDesignFloor(CRITICAL_LEAK_ARCHIVE_ROUTE_ID) as CriticalLeakArchiveGeneration;
  return cachedGeneration;
}

test('critical_leak_archive is registered as a Ministry archive route stop', () => {
  const route = designFloorById(CRITICAL_LEAK_ARCHIVE_ROUTE_ID);
  assert.equal(route?.z, CRITICAL_LEAK_ARCHIVE_Z);
  assert.equal(route?.baseFloor, CRITICAL_LEAK_ARCHIVE_BASE_FLOOR);
  assert.equal(route?.displayName, 'Архив критической протечки');
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(CRITICAL_LEAK_ARCHIVE_Z), false);

  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 760);
  assert.equal(profile.monsterTarget, 1050);
  assert.equal(profile.monsterTags.includes('water'), true);
  assert.equal(profile.monsterTags.includes('documents'), true);
});

test('critical_leak_archive carves a wet percolation archive with bridges and route lifts', () => {
  const gen = generatedCriticalLeakArchive();
  const state = gen.criticalLeakState;
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(state.largestComponentCells >= 90, true, 'largest percolation component should be meaningful');
  assert.equal(state.bridgesAdded >= 10, true, 'route anchors should be bridge-connected to the largest component');
  assert.equal(state.wetCausewayCells >= 6_000, true, 'wet cluster should be visible as water');
  assert.equal(state.dryCausewayCells >= 6_000, true, 'dry skeleton causeways should remain playable');
  assert.equal(state.contaminatedShortcutCells >= 900, true, 'contaminated shortcut should be a real water path');
});

test('critical_leak_archive fills the macro with registry blocks, micro rooms and HQ compounds', () => {
  const gen = generatedCriticalLeakArchive();
  const state = gen.criticalLeakState;
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let passable = 0;
  let reachable = 0;
  let smallRooms = 0;
  let reachableSmallRooms = 0;

  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) passable++;
    if (audit.reachable[i]) reachable++;
  }
  for (const room of gen.world.rooms) {
    if (room.w > 14 || room.h > 10) continue;
    smallRooms++;
    let roomReachable = false;
    for (let y = 0; y < room.h && !roomReachable; y++) {
      for (let x = 0; x < room.w; x++) {
        if (audit.reachable[gen.world.idx(room.x + x, room.y + y)]) {
          roomReachable = true;
          break;
        }
      }
    }
    if (roomReachable) reachableSmallRooms++;
  }

  assert.equal(state.midArchiveBlocks >= 12, true, `mid blocks ${state.midArchiveBlocks}`);
  assert.equal(state.microArchiveRooms >= 680, true, `micro rooms ${state.microArchiveRooms}`);
  assert.equal(state.hqAnchorRooms >= 5, true, `hq rooms ${state.hqAnchorRooms}`);
  assert.equal(state.hqSupportRooms >= 15, true, `support rooms ${state.hqSupportRooms}`);
  assert.equal(gen.world.rooms.length >= 720, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 600, true, `doors ${gen.world.doors.size}`);
  assert.equal(passable >= 120_000, true, `passable ${passable}`);
  assert.equal(reachable >= 120_000, true, `reachable ${reachable}`);
  assert.equal(reachable >= passable - 16, true, `reachable ${reachable}/${passable}`);
  assert.equal(smallRooms >= 680, true, `small rooms ${smallRooms}`);
  assert.equal(reachableSmallRooms >= 660, true, `reachable small rooms ${reachableSmallRooms}`);
});

test('critical_leak_archive seeds cell-first HQ territory and target shares', () => {
  const gen = generatedCriticalLeakArchive();
  const anchors = territoryHqAnchors(gen.world);
  const byOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = byOwner.get(owner);
    assert.ok(anchor, `missing HQ anchor ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
    assert.equal(gen.world.rooms[anchor.roomId]?.type, RoomType.HQ);
    assert.equal(territoryRoomOwner(gen.world, anchor.roomId), owner);
    assert.equal(territoryOwnerAt(gen.world, anchor.x, anchor.y), owner);
  }
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      assert.equal(gen.world.dist2(anchors[i].x, anchors[i].y, anchors[j].x, anchors[j].y) > 96 * 96, true);
    }
  }

  assert.equal(share(ZoneFaction.LIQUIDATOR) > share(ZoneFaction.CITIZEN), true);
  assert.ok(share(ZoneFaction.CITIZEN) >= 0.27 && share(ZoneFaction.CITIZEN) <= 0.30, `citizen ${share(ZoneFaction.CITIZEN)}`);
  assert.ok(share(ZoneFaction.LIQUIDATOR) >= 0.325 && share(ZoneFaction.LIQUIDATOR) <= 0.355, `liquidator ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.ok(share(ZoneFaction.CULTIST) >= 0.065 && share(ZoneFaction.CULTIST) <= 0.095, `cultist ${share(ZoneFaction.CULTIST)}`);
  assert.ok(share(ZoneFaction.SCIENTIST) >= 0.165 && share(ZoneFaction.SCIENTIST) <= 0.195, `scientist ${share(ZoneFaction.SCIENTIST)}`);
  assert.ok(share(ZoneFaction.WILD) >= 0.105 && share(ZoneFaction.WILD) <= 0.135, `wild ${share(ZoneFaction.WILD)}`);
});

test('critical_leak_archive exposes dry packet, contaminated shortcut and floodgate decisions', () => {
  const gen = generatedCriticalLeakArchive();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));

  for (const name of Object.values(CRITICAL_LEAK_ARCHIVE_ROOM_NAMES)) {
    assert.equal(names.has(name), true, name);
  }

  const reachableTagged = (tag: string): number => gen.world.containers.filter(container =>
    container.tags.includes(CRITICAL_LEAK_ARCHIVE_ROUTE_ID) &&
    container.tags.includes(tag) &&
    hasReachableAdjacentCell(gen.world, audit, gen.world.idx(container.x, container.y))
  ).length;

  assert.equal(reachableTagged('dry_archive_packet') >= 2, true, 'dry document packet choices should be reachable');
  assert.equal(reachableTagged('contaminated_shortcut') >= 1, true, 'contaminated shortcut sample should be reachable');
  assert.equal(reachableTagged('raise_floodgate') >= 1, true, 'floodgate control should be reachable');

  const plotIds = new Set(gen.entities.map(entity => entity.plotNpcId).filter(Boolean));
  assert.equal(plotIds.has('critical_leak_archivist_varvara'), true);
  assert.equal(plotIds.has('critical_leak_liquidator_egor'), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.NPC), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER), true);
});

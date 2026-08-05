import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { auditReachability } from '../src/core/world';
import { Cell, EntityType, RoomType, W, ZoneFaction } from '../src/core/types';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { DESIGN_FLOOR_ID } from '../src/gen/design_floors/chthonic_attic';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';
import { assertReachableRouteLifts } from './generator_helpers';

let cachedGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function generatedChthonicAttic(): ReturnType<typeof generateDesignFloor> {
  cachedGeneration ??= generateDesignFloor(DESIGN_FLOOR_ID, 61_061);
  return cachedGeneration;
}

function passableCellCount(gen: ReturnType<typeof generateDesignFloor>): number {
  let count = 0;
  for (const cell of gen.world.cells) {
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCellCount(gen: ReturnType<typeof generateDesignFloor>): number {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function territoryShare(gen: ReturnType<typeof generateDesignFloor>, owner: ZoneFaction): number {
  const row = countTerritoryCells(gen.world).find(candidate => candidate.owner === owner);
  return (row?.cells ?? 0) / (W * W);
}

test('chthonic_attic expands the root macro into service islands and micro rooms', () => {
  const gen = generatedChthonicAttic();
  const reachable = assertReachableRouteLifts(gen, DESIGN_FLOOR_ID);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(entity => !entity.plotNpcId && !entity.persistentNpcId && entity.alifeId === undefined);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Чердак:'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);

  assert.equal(passableCellCount(gen) >= 70_000, true, 'attic playable footprint should no longer be mostly blank');
  assert.equal(reachableCellCount(gen) >= 70_000, true, 'attic service layer should stay reachable');
  assert.equal(gen.world.rooms.length >= 120, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 45, true, `doors ${gen.world.doors.size}`);
  assert.equal(gen.world.containers.filter(container => container.tags.includes('attic')).length >= 25, true);
  assert.equal(microRooms.length >= 60, true, `micro rooms ${microRooms.length}`);
  assert.equal(hqRooms.length >= 5, true, `hq rooms ${hqRooms.length}`);
  assert.equal(ambientNpcs.length, 0);
  assert.equal(npcs.length <= 40, true);
  assert.equal(monsters.length >= 3_800, true, `monsters ${monsters.length}`);

  let reachableMicroRooms = 0;
  for (const room of microRooms) {
    for (let i = 0; i < gen.world.cells.length; i++) {
      if (gen.world.roomMap[i] === room.id && reachable[i]) {
        reachableMicroRooms++;
        break;
      }
    }
  }
  assert.equal(reachableMicroRooms >= 50, true, `reachable micro rooms ${reachableMicroRooms}`);
});

test('chthonic_attic seeds cell-first faction HQs and target territory shares', () => {
  const gen = generatedChthonicAttic();
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor owner ${owner}`);
    assert.equal(territoryShare(gen, owner) > 0, true, `owner ${owner} should own cells`);
  }

  assert.equal(Math.abs(territoryShare(gen, ZoneFaction.CITIZEN) - 0.18) <= 0.025, true);
  assert.equal(Math.abs(territoryShare(gen, ZoneFaction.LIQUIDATOR) - 0.24) <= 0.025, true);
  assert.equal(Math.abs(territoryShare(gen, ZoneFaction.CULTIST) - 0.14) <= 0.025, true);
  assert.equal(Math.abs(territoryShare(gen, ZoneFaction.SCIENTIST) - 0.10) <= 0.025, true);
  assert.equal(Math.abs(territoryShare(gen, ZoneFaction.WILD) - 0.34) <= 0.025, true);
  assert.equal(territoryShare(gen, ZoneFaction.WILD) > territoryShare(gen, ZoneFaction.LIQUIDATOR), true);

  for (const anchor of anchors) {
    const room = gen.world.rooms[anchor.roomId];
    assert.equal(room?.type, RoomType.HQ, `anchor ${anchor.roomId} should be HQ`);
    assert.equal(territoryRoomOwner(gen.world, anchor.roomId), anchor.owner);
    assert.equal(territoryOwnerAt(gen.world, anchor.x, anchor.y), anchor.owner);
  }
});

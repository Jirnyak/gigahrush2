import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RoomType, W, ZoneFaction, type TerritoryOwner } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS, territoryOwnerName } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt } from '../src/systems/territory';

const UPPER_BUREAU_TARGETS: readonly { owner: TerritoryOwner; share: number }[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.42 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.26 },
  { owner: ZoneFaction.CULTIST, share: 0.08 },
  { owner: ZoneFaction.SCIENTIST, share: 0.16 },
  { owner: ZoneFaction.WILD, share: 0.08 },
];

const UPPER_BUREAU_HQ_NAMES: readonly { owner: TerritoryOwner; name: string }[] = [
  { owner: ZoneFaction.CITIZEN, name: 'Гражданский гермостол сверки очередей' },
  { owner: ZoneFaction.LIQUIDATOR, name: 'Гермокабинет аудиторской стражи' },
  { owner: ZoneFaction.CULTIST, name: 'Скрытый алтарь согласующей печати' },
  { owner: ZoneFaction.SCIENTIST, name: 'Гермолаборатория экспертизы подписи' },
  { owner: ZoneFaction.WILD, name: 'Разбитый штаб обходных тележек' },
];

function shareByOwner(world: ReturnType<typeof generateDesignFloor>['world']): Map<TerritoryOwner, number> {
  const total = W * W;
  return new Map(countTerritoryCells(world).map(row => [row.owner, row.cells / total]));
}

function roomCenterOwner(world: ReturnType<typeof generateDesignFloor>['world'], name: string): TerritoryOwner {
  const room = world.rooms.find(candidate => candidate.name === name);
  assert.ok(room, `missing room ${name}`);
  return territoryOwnerAt(world, room.x + (room.w >> 1), room.y + (room.h >> 1));
}

test('genfix 017 upper bureau has route-scale rooms and authored human territory HQs', () => {
  const gen = generateDesignFloor('upper_bureau', 61061);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachableCells = audit.reachable.reduce((sum, value) => sum + value, 0);

  assert.equal(gen.world.rooms.length >= 450, true, 'room scale');
  assert.equal(gen.world.doors.size >= 450, true, 'door scale');
  assert.equal(reachableCells >= 200_000, true, 'reachable scale');

  const shares = shareByOwner(gen.world);
  for (const target of UPPER_BUREAU_TARGETS) {
    const actual = shares.get(target.owner) ?? 0;
    assert.equal(Math.abs(actual - target.share) <= 0.03, true, `${territoryOwnerName(target.owner)} share ${actual}`);
  }
  assert.equal(shares.get(ZoneFaction.SAMOSBOR) ?? 0, 0, 'no samosbor territory in human share target');

  const anchors = territoryHqAnchors(gen.world);
  const anchoredOwners = new Set(anchors.map(anchor => anchor.owner));
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchoredOwners.has(owner), true, `${territoryOwnerName(owner)} HQ anchor`);
    assert.equal((shares.get(owner) ?? 0) > 0, true, `${territoryOwnerName(owner)} owned cells`);
  }

  for (const hq of UPPER_BUREAU_HQ_NAMES) {
    const room = gen.world.rooms.find(candidate => candidate.name === hq.name);
    assert.ok(room, `missing named HQ ${hq.name}`);
    assert.equal(room.type, RoomType.HQ, `${hq.name} room type`);
    assert.equal(roomCenterOwner(gen.world, hq.name), hq.owner, `${hq.name} owner`);
    assert.equal(gen.world.rooms.filter(candidate => candidate.name.startsWith(`${hq.name}:`)).length >= 5, true, `${hq.name} support rooms`);
  }
});

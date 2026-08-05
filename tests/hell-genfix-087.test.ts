import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, EntityType, Faction, FloorLevel, RoomType, W, ZoneFaction, type Room, type TerritoryOwner } from '../src/core/types';
import { auditReachability, type World } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner, territoryOwnerName } from '../src/data/factions';
import { generateFloor } from '../src/gen/floor_manifest';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

const HELL_TARGET_SHARES: readonly { owner: TerritoryOwner; share: number }[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.06 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.08 },
  { owner: ZoneFaction.CULTIST, share: 0.40 },
  { owner: ZoneFaction.SCIENTIST, share: 0.04 },
  { owner: ZoneFaction.WILD, share: 0.28 },
  { owner: ZoneFaction.SAMOSBOR, share: 0.14 },
];

function passableCells(world: World): number {
  let count = 0;
  for (const cell of world.cells) {
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCells(world: World, spawnX: number, spawnY: number): number {
  const audit = auditReachability(world, world.idx(Math.floor(spawnX), Math.floor(spawnY)));
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function hermeticShellCells(world: World, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

test('genfix 087 hell keeps arena macro while adding faction compounds and micro rooms', () => {
  const gen = generateFloor(FloorLevel.HELL, 61_061);
  const world = gen.world;
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const shares = new Map([...counts].map(([owner, cells]) => [owner, cells / (W * W)]));
  const anchors = territoryHqAnchors(world);
  const anchorByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const microRooms = world.rooms.filter(room => room.name.includes('микрокомната') || room.name.includes('карман'));
  const districtRooms = world.rooms.filter(room => room.name.startsWith('Мясной низ:'));

  assert.equal(world.rooms.length >= 220, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 260, true, `doors ${world.doors.size}`);
  assert.equal(passableCells(world) >= 285_000, true, `passable ${passableCells(world)}`);
  assert.equal(reachableCells(world, gen.spawnX, gen.spawnY) >= 285_000, true);
  assert.equal(microRooms.length >= 160, true, `micro rooms ${microRooms.length}`);
  assert.equal(districtRooms.length >= 160, true, `district rooms ${districtRooms.length}`);

  for (const target of HELL_TARGET_SHARES) {
    const share = shares.get(target.owner) ?? 0;
    assert.equal(
      Math.abs(share - target.share) <= 0.025,
      true,
      `${territoryOwnerName(target.owner)} share ${share.toFixed(4)}`,
    );
  }
  assert.equal(
    (counts.get(ZoneFaction.CULTIST) ?? 0) > (counts.get(ZoneFaction.WILD) ?? 0),
    true,
    'cultists remain the dominant owner',
  );

  const anchorBuckets = new Set<string>();
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = anchorByOwner.get(owner);
    assert.ok(anchor, `${territoryOwnerName(owner)} HQ anchor`);
    anchorBuckets.add(`${Math.floor(anchor.x / 128)}:${Math.floor(anchor.y / 128)}`);
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `${territoryOwnerName(owner)} HQ type`);
    assert.equal(room.sealed, true, `${territoryOwnerName(owner)} HQ sealed`);
    assert.equal(territoryRoomOwner(world, room.id), owner, `${territoryOwnerName(owner)} room owner`);
    assert.equal(territoryOwnerAt(world, anchor.x, anchor.y), owner, `${territoryOwnerName(owner)} anchor owner`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `${territoryOwnerName(owner)} hermetic shell`);
    const title = room.name.replace(': гермоядро', '');
    const supportRooms = world.rooms.filter(candidate => candidate.id !== room.id && candidate.name.startsWith(`${title}:`));
    assert.equal(supportRooms.length >= 5, true, `${territoryOwnerName(owner)} support rooms ${supportRooms.length}`);
  }
  assert.equal(anchorBuckets.size >= HUMAN_TERRITORY_OWNERS.length, true, `distinct HQ buckets ${anchorBuckets.size}`);

  let ownedFactionNpcs = 0;
  let factionNpcs = 0;
  let cultistOwned = 0;
  let cultists = 0;
  let liquidatorOwned = 0;
  let liquidators = 0;
  for (const entity of gen.entities) {
    if (entity.type !== EntityType.NPC || !entity.alive || entity.faction === undefined) continue;
    if (entity.faction !== Faction.CULTIST && entity.faction !== Faction.LIQUIDATOR) continue;
    factionNpcs++;
    const own = territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction);
    if (own) ownedFactionNpcs++;
    if (entity.faction === Faction.CULTIST) {
      cultists++;
      if (own) cultistOwned++;
    } else {
      liquidators++;
      if (own) liquidatorOwned++;
    }
  }

  assert.equal(factionNpcs >= 640, true, `hell faction NPCs ${factionNpcs}`);
  assert.equal(ownedFactionNpcs / factionNpcs >= 0.66, true, `own territory NPCs ${ownedFactionNpcs}/${factionNpcs}`);
  assert.equal(cultistOwned / cultists >= 0.68, true, `cultists own territory ${cultistOwned}/${cultists}`);
  assert.equal(liquidatorOwned / liquidators >= 0.55, true, `liquidators own territory ${liquidatorOwned}/${liquidators}`);
});

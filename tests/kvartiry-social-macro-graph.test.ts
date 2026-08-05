import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Faction, FloorLevel, RoomType, W, ZoneFaction, type TerritoryOwner } from '../src/core/types';
import { factionToTerritoryOwner } from '../src/data/factions';
import { generateFloor } from '../src/gen/floor_manifest';
import {
  getKvartirySocialMacroGraph,
  measureKvartiryArticulation,
} from '../src/gen/kvartiry/social_macro_graph';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAtIndex,
} from '../src/systems/territory';
import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';

let generated: ReturnType<typeof generateFloor> | null = null;

function kvartiry(): ReturnType<typeof generateFloor> {
  generated ??= generateFloor(FloorLevel.KVARTIRY, 20_260_530);
  return generated;
}

const KVARTIRY_TERRITORY_TARGETS: readonly { owner: TerritoryOwner; share: number }[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.66 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.12 },
  { owner: ZoneFaction.CULTIST, share: 0.06 },
  { owner: ZoneFaction.SCIENTIST, share: 0.07 },
  { owner: ZoneFaction.WILD, share: 0.09 },
];

function roomMappedCells(gen: ReturnType<typeof generateFloor>, roomId: number): number {
  let cells = 0;
  for (const id of gen.world.roomMap) {
    if (id === roomId) cells++;
  }
  return cells;
}

test('Kvartiry generation exposes a social macro graph with domain descriptors and route choices', () => {
  const gen = kvartiry();
  const graph = getKvartirySocialMacroGraph(gen.world);
  assert.ok(graph, 'Kvartiry macro graph should be registered on the generated world');

  const kinds = new Set(graph.nodes.map(node => node.kind));
  for (const kind of ['kitchen', 'water', 'ration', 'barricade', 'lift', 'print', 'apartment_cut'] as const) {
    assert.equal(kinds.has(kind), true, `missing ${kind} node`);
  }

  const routes = new Set(graph.edges.map(edge => edge.route));
  for (const route of ['crowd_route', 'apartment_cut', 'service_detour', 'risky_shortcut', 'lift_escape'] as const) {
    assert.equal(routes.has(route), true, `missing ${route} edge`);
  }

  assert.equal(graph.domains.length >= 3, true, 'Potts/Ising social domains should cover multiple factions');
  assert.equal(graph.domains.every(domain => domain.roomIds.length > 0 || domain.zoneIds.length > 0), true);
  assert.equal(graph.queueLoops >= 4, true, 'social anchors should receive braided queue loops');
  assert.equal(graph.apartmentCutDoors >= 1, true, 'apartment cut-through should open at least one extra door');

  const cueRoutes = new Set(
    getRouteCueMarkers(gen.world)
      .filter(cue => cue.tags.includes('social_macro'))
      .map(cue => cue.tags.find(tag => tag.endsWith('_route') || tag.endsWith('_cut') || tag.endsWith('_detour') || tag.endsWith('_shortcut') || tag.endsWith('_escape'))),
  );
  assert.equal(cueRoutes.has('crowd_route'), true);
  assert.equal(cueRoutes.has('apartment_cut'), true);
  assert.equal(cueRoutes.has('service_detour'), true);
  assert.equal(cueRoutes.has('risky_shortcut'), true);
});

test('Kvartiry auto shelter HQs use linked doors and do not create full-map hermoseams', () => {
  const gen = kvartiry();
  const hqRooms = gen.world.rooms.filter(room => room?.type === RoomType.HQ);
  assert.equal(hqRooms.length >= 5, true, `HQ rooms ${hqRooms.length}`);

  for (const room of hqRooms) {
    assert.equal(room.w <= 96 && room.h <= 96, true, `HQ room ${room.id} span ${room.w}x${room.h}`);
    assert.equal(room.doors.length > 0, true, `HQ room ${room.id} should have linked doors`);
    assert.equal(room.doors.length <= 12, true, `HQ room ${room.id} has too many doors: ${room.doors.length}`);
    assert.equal(room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return !!door &&
        (door.roomA === room.id || door.roomB === room.id) &&
        (door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.HERMETIC_CLOSED);
    }), true, `HQ room ${room.id} should expose a hermetic door`);
  }

  let maxColumn = 0;
  let maxRow = 0;
  for (let x = 0; x < W; x++) {
    let column = 0;
    for (let y = 0; y < W; y++) {
      const idx = gen.world.idx(x, y);
      if (gen.world.hermoWall[idx] && gen.world.cells[idx] === Cell.WALL) column++;
    }
    maxColumn = Math.max(maxColumn, column);
  }
  for (let y = 0; y < W; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const idx = gen.world.idx(x, y);
      if (gen.world.hermoWall[idx] && gen.world.cells[idx] === Cell.WALL) row++;
    }
    maxRow = Math.max(maxRow, row);
  }
  assert.equal(maxColumn < 160, true, `hermoseam column too long: ${maxColumn}`);
  assert.equal(maxRow < 160, true, `hermoseam row too long: ${maxRow}`);
});

test('Kvartiry social macro anchors stay reachable and do not leave large isolated regions', () => {
  const gen = kvartiry();
  const graph = getKvartirySocialMacroGraph(gen.world);
  assert.ok(graph);

  const startIdx = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(gen.world, startIdx);
  for (const node of graph.nodes) {
    const idx = gen.world.idx(Math.floor(node.accessX), Math.floor(node.accessY));
    assert.equal(
      !!audit.reachable[idx] || hasReachableAdjacentCell(gen.world, audit, idx),
      true,
      `${node.id} should be reachable from Kvartiry spawn`,
    );
  }

  const metric = measureKvartiryArticulation(gen.world, gen.spawnX, gen.spawnY);
  assert.equal(metric.largeIsolatedRegionCount, 0);
  assert.equal(metric.largeIsolatedRegionCells, 0);
  assert.equal(metric.largestRegionCells > 100_000, true);
  assert.equal(graph.articulation.largeIsolatedRegionCount, 0);
});

test('Kvartiry maze keeps doors sparse and linked after candidate-door pruning', () => {
  const gen = kvartiry();
  const doorCount = gen.world.doors.size;
  const linkedDoors = [...gen.world.doors.values()].filter(door => door.roomA >= 0 || door.roomB >= 0).length;
  const averageRoomDoors = gen.world.rooms.reduce((sum, room) => sum + (room?.doors.length ?? 0), 0) / gen.world.rooms.length;

  assert.equal(doorCount <= 25_000, true, `Kvartiry door count should stay sparse, got ${doorCount}`);
  assert.equal(averageRoomDoors <= 4, true, `Kvartiry average room doors should stay sparse, got ${averageRoomDoors}`);
  assert.equal(linkedDoors / Math.max(1, doorCount) >= 0.95, true, `Kvartiry room-linked door ratio should stay high, got ${linkedDoors}/${doorCount}`);
});

test('Kvartiry second-stage social rooms expose linked reachable doors', () => {
  const gen = kvartiry();
  const startIdx = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(gen.world, startIdx);
  const roomNames = [
    'Пункт выдачи талонов',
    'Водораздача у стояка',
    'Нелегальная типография',
    'Коммунальная кухня раздора',
    'Аптечный разменник',
    'Маршрутный сход Три Двери',
    'Квартира с пустым соседом',
  ];

  for (const name of roomNames) {
    const room = gen.world.rooms.find(row => row?.name === name);
    assert.ok(room, `${name} should exist`);
    assert.equal(room.doors.length > 0, true, `${name} should have a linked egress door`);
    assert.equal(room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return !!door &&
        (door.roomA === room.id || door.roomB === room.id) &&
        (!!audit.reachable[doorIdx] || hasReachableAdjacentCell(gen.world, audit, doorIdx));
    }), true, `${name} should have a reachable door`);
  }
});

test('Kvartiry keeps cell-first faction territory shares, HQ anchors, and own-land population bias', () => {
  const gen = kvartiry();
  const totalCells = gen.world.factionControl.length;
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));

  for (const target of KVARTIRY_TERRITORY_TARGETS) {
    const cells = counts.get(target.owner) ?? 0;
    assert.equal(cells > 0, true, `owner ${target.owner} should control cells`);
    assert.equal(anchorOwners.has(target.owner), true, `owner ${target.owner} should have an HQ anchor`);
    const share = cells / totalCells;
    assert.equal(Math.abs(share - target.share) <= 0.025, true, `owner ${target.owner} share ${share}`);
  }

  for (const anchor of anchors) {
    assert.equal(roomMappedCells(gen, anchor.roomId) > 0, true, `anchor room ${anchor.roomId} should own mapped cells`);
  }

  const byFaction = new Map<Faction, { total: number; own: number }>();
  for (const entity of gen.entities) {
    if (entity.type !== EntityType.NPC || entity.faction === undefined) continue;
    const row = byFaction.get(entity.faction) ?? { total: 0, own: 0 };
    row.total++;
    const owner = factionToTerritoryOwner(entity.faction);
    const idx = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    if (territoryOwnerAtIndex(gen.world, idx) === owner) row.own++;
    byFaction.set(entity.faction, row);
  }

  assert.equal((byFaction.get(Faction.CITIZEN)?.own ?? 0) / (byFaction.get(Faction.CITIZEN)?.total ?? 1) >= 0.78, true);
  assert.equal((byFaction.get(Faction.WILD)?.own ?? 0) / (byFaction.get(Faction.WILD)?.total ?? 1) >= 0.35, true);
  assert.equal((byFaction.get(Faction.LIQUIDATOR)?.own ?? 0) / (byFaction.get(Faction.LIQUIDATOR)?.total ?? 1) >= 0.35, true);
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { auditReachability } from '../src/core/world';
import {
  Cell,
  EntityType,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  HYPERBOLIC_SWITCHYARD_BASE_FLOOR,
  HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID,
  HYPERBOLIC_SWITCHYARD_ROUTE_Z,
  type HyperbolicSwitchyardGeneration,
} from '../src/gen/design_floors/hyperbolic_switchyard';
import { getEmergencyPanels } from '../src/systems/emergency_panels';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

let cachedGeneration: HyperbolicSwitchyardGeneration | undefined;

function generatedHyperbolicSwitchyard(): HyperbolicSwitchyardGeneration {
  cachedGeneration ??= generateDesignFloor(HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID) as HyperbolicSwitchyardGeneration;
  return cachedGeneration;
}

function hermeticShellCells(gen: HyperbolicSwitchyardGeneration, roomId: number): number {
  const room = gen.world.rooms[roomId];
  let cells = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = gen.world.idx(room.x + dx, room.y + dy);
      if (gen.world.hermoWall[idx]) cells++;
    }
  }
  return cells;
}

test('hyperbolic_switchyard is a maintenance authored route floor', () => {
  const route = designFloorById(HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID);
  assert.ok(route);
  assert.equal(route.z, HYPERBOLIC_SWITCHYARD_ROUTE_Z);
  assert.equal(route.baseFloor, HYPERBOLIC_SWITCHYARD_BASE_FLOOR);
  assert.equal(route.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route.displayName, 'Гиперболическая стрелочная');
  assert.equal(designFloorAtZ(HYPERBOLIC_SWITCHYARD_ROUTE_Z)?.id, HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID);
});

test('hyperbolic_switchyard exposes guide, switch family, shortcut and false-platform decisions', () => {
  const gen = generatedHyperbolicSwitchyard();
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const cues = getRouteCueMarkers(gen.world);
  const panels = getEmergencyPanels(gen.world);
  const cueTags = new Set(cues.flatMap(cue => cue.tags));
  const containerTags = new Set(gen.world.containers.flatMap(container => container.tags));

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.switchyardState.routeId, HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID);
  assert.equal(gen.switchyardState.decisionIds.length, 4);
  assert.equal(gen.switchyardState.arcs.filter(arc => arc.family === 'blue').length >= 4, true);
  assert.equal(gen.switchyardState.arcs.filter(arc => arc.family === 'red').length >= 4, true);
  assert.equal(gen.switchyardState.arcs.some(arc => arc.shortcut), true);
  assert.equal(gen.switchyardState.platforms.filter(platform => platform.name.includes('Хороцикл')).length >= 5, true);
  assert.equal(gen.switchyardState.platforms.some(platform => platform.falsePlatform), true);
  assert.equal(panels.filter(panel => panel.defId === 'panel_doors').length >= 2, true);
  assert.equal(panels.some(panel => panel.defId === 'panel_vent'), true);

  for (const tag of ['pay_guide', 'switch_family', 'geodesic_shortcut', 'false_platform', 'sabotage']) {
    assert.equal(cueTags.has(tag) || containerTags.has(tag), true, tag);
  }

  assert.equal(cues.some(cue => cue.paidRouteAdvice?.priceRubles === 45 && cue.tags.includes('pay_guide')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('switch_family') && container.tags.includes('repair')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('geodesic_shortcut') && container.tags.includes('monster_heavy')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('false_platform') && container.tags.includes('sabotage')), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.NPC && entity.plotNpcId === 'hyperbolic_switchyard_guide_zinaida'), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.PSEUDOLIFT), true);
});

test('hyperbolic_switchyard population profile is industrial and monster-heavy', () => {
  const route = designFloorById(HYPERBOLIC_SWITCHYARD_DESIGN_FLOOR_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = generatedHyperbolicSwitchyard();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  const shortcutRoom = gen.world.rooms.find(room => room.name === 'Геодезическая служебная кишка');

  assert.equal(profile.npcTarget >= 450 && profile.npcTarget <= 700, true, `npc target ${profile.npcTarget}`);
  assert.equal(profile.monsterTarget >= 2000, true, `monster target ${profile.monsterTarget}`);
  assert.equal(profile.monsterTags.includes('hyperbolic'), true);
  assert.equal(profile.monsterTags.includes('switchyard'), true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 5, true);
  assert.equal(npcs.length >= profile.npcTarget, true, `npc count ${npcs.length}`);
  assert.equal(monsters.length >= profile.monsterTarget, true, `monster count ${monsters.length}`);
  assert.ok(shortcutRoom);
  assert.equal(shortcutRoom.type, RoomType.STORAGE);
  assert.equal(gen.switchyardState.shortcutMonsterCells.length > 0, true);
});

test('hyperbolic_switchyard fills macro arcs with mid/micro rooms and cell-first territory', () => {
  const gen = generatedHyperbolicSwitchyard();
  const reachable = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))).reachable;
  const reachableCells = reachable.reduce((sum, value) => sum + value, 0);
  const hqAnchors = territoryHqAnchors(gen.world);
  const byOwner = new Map(hqAnchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const targetShares = new Map<ZoneFaction, number>([
    [ZoneFaction.CITIZEN, 0.12],
    [ZoneFaction.LIQUIDATOR, 0.44],
    [ZoneFaction.CULTIST, 0.08],
    [ZoneFaction.SCIENTIST, 0.16],
    [ZoneFaction.WILD, 0.20],
  ]);
  const microRooms = gen.world.rooms.filter(room => room.name.includes(': ') && (
    room.name.includes('кладовая стрелок') ||
    room.name.includes('санузел стрелочника') ||
    room.name.includes('кабинет расписаний') ||
    room.name.includes('мастерская привода')
  ));
  const serviceBlocks = gen.world.rooms.filter(room => room.name.includes('стрелк') || room.name.includes('дуг') || room.name.includes('двор'));

  assert.equal(gen.world.rooms.length >= 320, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 220, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachableCells >= 170_000, true, `reachable ${reachableCells}`);
  assert.equal(serviceBlocks.length >= 20, true, `service blocks ${serviceBlocks.length}`);
  assert.equal(microRooms.length >= 170, true, `micro ${microRooms.length}`);

  for (const [owner, targetShare] of targetShares) {
    const anchor = byOwner.get(owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.ok(anchor, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${ZoneFaction[owner]}`);
    assert.equal(Math.abs(share(owner) - targetShare) <= 0.025, true, `owner ${ZoneFaction[owner]} share ${share(owner)}`);
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `sealed HQ ${ZoneFaction[owner]}`);
    if (anchor && room) {
      assert.equal(territoryRoomOwner(gen.world, room.id), owner, `room owner ${ZoneFaction[owner]}`);
      assert.equal(territoryOwnerAt(gen.world, anchor.x, anchor.y), owner, `anchor owner ${ZoneFaction[owner]}`);
      assert.equal(hermeticShellCells(gen, room.id) > 0, true, `hermetic shell ${ZoneFaction[owner]}`);
    }
  }

  let dominant = ZoneFaction.CITIZEN;
  for (const [owner, cells] of counts) {
    if (owner === ZoneFaction.SAMOSBOR) continue;
    if (cells > (counts.get(dominant) ?? 0)) dominant = owner;
  }
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
});

test('hyperbolic_switchyard registers the guide payment side quest', () => {
  const ids = new Set(getSideQuestRegistrySnapshot().map(q => q.id));
  assert.equal(ids.has('hyperbolic_switchyard_pay_guide'), true);
});

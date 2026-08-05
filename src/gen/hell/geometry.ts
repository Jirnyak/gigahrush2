/* ── Hell macro geometry: arena chains, flee loops and scars ─── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W,
  Cell,
  DoorState,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  ZoneFaction,
  type Room,
  type TerritoryOwner,
} from '../../core/types';
import { World } from '../../core/world';
import { registerRouteCue } from '../../systems/route_cues';
import { protectRoom, stampRoom } from '../shared';
import type { PlacementFieldAnchor } from '../population_placement';

export interface HellGeometry {
  monsterCells: number[];
  cultistCells: number[];
  liquidatorCells: number[];
  safeCells: number[];
  sightlineCells: number[];
  populationAnchors: {
    monster: PlacementFieldAnchor[];
    cultist: PlacementFieldAnchor[];
    liquidator: PlacementFieldAnchor[];
    safe: PlacementFieldAnchor[];
  };
  chainScores: HellArenaChainScore[];
}

export interface HellArenaChainScore {
  id: string;
  entry: number;
  threat: number;
  fallback: number;
  reward: number;
  exit: number;
  sightline: number;
  total: number;
}

export interface HellPos {
  x: number;
  y: number;
}

type Pos = HellPos;

interface ChainSpec {
  id: string;
  name: string;
  entry: Pos;
  arena: Pos;
  exit: Pos;
  fallback: Pos;
  reward: Pos;
  faction: 'monster' | 'cultist' | 'liquidator';
  motif: 'meat' | 'bone' | 'vent' | 'barricade' | 'scar';
}

interface ChainPlan {
  spec: ChainSpec;
  entry: Pos;
  arena: Pos;
  exit: Pos;
  fallback: Pos;
  reward: Pos;
  sightline: Pos;
  score: HellArenaChainScore;
}

interface HellHqCompoundSpec {
  id: string;
  title: string;
  center: Pos;
  owner: TerritoryOwner;
  wallTex: Tex;
  floorTex: Tex;
  stronghold: boolean;
}

interface HellDistrictSpec {
  id: string;
  title: string;
  center: Pos;
  owner: TerritoryOwner;
  rx: number;
  ry: number;
  rooms: number;
  wallTex: Tex;
  floorTex: Tex;
}

const CHAINS: readonly ChainSpec[] = [
  {
    id: 'first_throat',
    name: 'Глотка первого жара',
    entry: { x: 18, y: -4 },
    arena: { x: 58, y: -22 },
    exit: { x: 104, y: -18 },
    fallback: { x: 58, y: 22 },
    reward: { x: 82, y: -54 },
    faction: 'cultist',
    motif: 'vent',
  },
  {
    id: 'bone_bridge',
    name: 'Костяной мост',
    entry: { x: -20, y: -18 },
    arena: { x: -76, y: -62 },
    exit: { x: -132, y: -44 },
    fallback: { x: -86, y: -16 },
    reward: { x: -110, y: -92 },
    faction: 'monster',
    motif: 'bone',
  },
  {
    id: 'cult_barricade',
    name: 'Баррикада пепельных',
    entry: { x: 32, y: 26 },
    arena: { x: 126, y: 34 },
    exit: { x: 174, y: 82 },
    fallback: { x: 112, y: 90 },
    reward: { x: 150, y: 6 },
    faction: 'cultist',
    motif: 'barricade',
  },
  {
    id: 'scar_run',
    name: 'Рваный безопасный рубец',
    entry: { x: -18, y: 24 },
    arena: { x: -82, y: 94 },
    exit: { x: -144, y: 128 },
    fallback: { x: -112, y: 42 },
    reward: { x: -118, y: 82 },
    faction: 'liquidator',
    motif: 'scar',
  },
  {
    id: 'deep_altar',
    name: 'Нижний пепельный карман',
    entry: { x: 0, y: 46 },
    arena: { x: 8, y: 158 },
    exit: { x: 54, y: 212 },
    fallback: { x: -42, y: 154 },
    reward: { x: 34, y: 188 },
    faction: 'monster',
    motif: 'meat',
  },
];

const HELL_HQ_COMPOUNDS: readonly HellHqCompoundSpec[] = [
  {
    id: 'citizen_shelter',
    title: 'Гражданский низовой штаб',
    center: { x: -252, y: -210 },
    owner: ZoneFaction.CITIZEN,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
    stronghold: false,
  },
  {
    id: 'liquidator_redoubt',
    title: 'Ликвидаторский низовой штаб',
    center: { x: 232, y: -206 },
    owner: ZoneFaction.LIQUIDATOR,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    stronghold: true,
  },
  {
    id: 'cult_lower_chancel',
    title: 'Культовый нижний штаб',
    center: { x: 138, y: 146 },
    owner: ZoneFaction.CULTIST,
    wallTex: Tex.GUT,
    floorTex: Tex.F_MEAT,
    stronghold: true,
  },
  {
    id: 'scientist_measurement',
    title: 'Научный низовой штаб',
    center: { x: -206, y: 222 },
    owner: ZoneFaction.SCIENTIST,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_TILE,
    stronghold: false,
  },
  {
    id: 'wild_bone_yard',
    title: 'Дикий низовой штаб',
    center: { x: 302, y: 248 },
    owner: ZoneFaction.WILD,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_CONCRETE,
    stronghold: false,
  },
  {
    id: 'cult_east_outpost',
    title: 'Культовый восточный придел',
    center: { x: 324, y: -24 },
    owner: ZoneFaction.CULTIST,
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    stronghold: true,
  },
  {
    id: 'cult_south_outpost',
    title: 'Культовый южный придел',
    center: { x: -74, y: 316 },
    owner: ZoneFaction.CULTIST,
    wallTex: Tex.MEAT,
    floorTex: Tex.F_MEAT,
    stronghold: false,
  },
] as const;

const HELL_DISTRICTS: readonly HellDistrictSpec[] = [
  { id: 'north_silos', title: 'северные мясные кладовые', center: { x: -352, y: -318 }, owner: ZoneFaction.WILD, rx: 58, ry: 42, rooms: 12, wallTex: Tex.MEAT, floorTex: Tex.F_MEAT },
  { id: 'north_chapel', title: 'верхний свечной двор', center: { x: 42, y: -344 }, owner: ZoneFaction.CULTIST, rx: 64, ry: 44, rooms: 14, wallTex: Tex.GUT, floorTex: Tex.F_GUT },
  { id: 'north_lab', title: 'холодная измерительная кишка', center: { x: 360, y: -310 }, owner: ZoneFaction.SCIENTIST, rx: 52, ry: 36, rooms: 10, wallTex: Tex.PANEL, floorTex: Tex.F_TILE },
  { id: 'west_barracks', title: 'западные койки зачистки', center: { x: -398, y: -38 }, owner: ZoneFaction.LIQUIDATOR, rx: 62, ry: 38, rooms: 12, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { id: 'east_market', title: 'восточный обменный рубец', center: { x: 406, y: 58 }, owner: ZoneFaction.CITIZEN, rx: 60, ry: 42, rooms: 12, wallTex: Tex.CONCRETE, floorTex: Tex.F_CONCRETE },
  { id: 'west_ash', title: 'пепельные ячейки дикарей', center: { x: -344, y: 270 }, owner: ZoneFaction.WILD, rx: 66, ry: 44, rooms: 14, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
  { id: 'south_choir', title: 'нижняя хоровая кишка', center: { x: 52, y: 408 }, owner: ZoneFaction.CULTIST, rx: 70, ry: 48, rooms: 16, wallTex: Tex.GUT, floorTex: Tex.F_MEAT },
  { id: 'south_checkpoint', title: 'южный пункт отсечения', center: { x: 382, y: 334 }, owner: ZoneFaction.LIQUIDATOR, rx: 54, ry: 40, rooms: 11, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { id: 'middle_refuge', title: 'срединная гражданская нора', center: { x: -116, y: -108 }, owner: ZoneFaction.CITIZEN, rx: 44, ry: 32, rooms: 8, wallTex: Tex.CONCRETE, floorTex: Tex.F_CONCRETE },
  { id: 'middle_altar', title: 'малый культовый желудок', center: { x: 196, y: -104 }, owner: ZoneFaction.CULTIST, rx: 50, ry: 34, rooms: 10, wallTex: Tex.GUT, floorTex: Tex.F_GUT },
  { id: 'middle_workshop', title: 'мясная мастерская НИИ', center: { x: -206, y: 72 }, owner: ZoneFaction.SCIENTIST, rx: 48, ry: 34, rooms: 9, wallTex: Tex.PANEL, floorTex: Tex.F_TILE },
  { id: 'middle_bone', title: 'костяной двор дикарей', center: { x: 252, y: 172 }, owner: ZoneFaction.WILD, rx: 52, ry: 36, rooms: 10, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
] as const;

export function imprintHellArenaValleys(field: Uint8Array): void {
  if (field.length < W * W) return;
  const origin = { x: W >> 1, y: W >> 1 };
  carveFieldDisc(field, origin, 8);

  for (const plan of planArenaChains(origin)) {
    const mainRadius = plan.score.threat > 0.7 ? 3 : 2;
    const loopRadius = plan.score.fallback > 0.7 ? 2 : 1;
    carveFieldRibbon(field, origin, plan.entry, 2);
    carveFieldRibbon(field, plan.entry, plan.arena, mainRadius);
    carveFieldRibbon(field, plan.arena, plan.exit, mainRadius);
    carveFieldRibbon(field, plan.entry, plan.fallback, loopRadius);
    carveFieldRibbon(field, plan.fallback, plan.exit, loopRadius);
    carveFieldRibbon(field, plan.fallback, plan.sightline, 1);
    carveFieldRibbon(field, plan.sightline, plan.arena, 1);
    carveFieldDisc(field, plan.arena, 10 + Math.round(plan.score.threat * 5));
    carveFieldDisc(field, plan.fallback, 5 + Math.round(plan.score.fallback * 3));
    carveFieldDisc(field, plan.reward, 4 + Math.round(plan.score.reward * 3));
  }
}

export function buildHellGeometry(world: World): HellGeometry {
  const geometry: HellGeometry = {
    monsterCells: [],
    cultistCells: [],
    liquidatorCells: [],
    safeCells: [],
    sightlineCells: [],
    populationAnchors: {
      monster: [],
      cultist: [],
      liquidator: [],
      safe: [],
    },
    chainScores: [],
  };
  const origin = { x: W >> 1, y: W >> 1 };

  carveSafeScar(world, origin, 7, 5, geometry.safeCells);
  decorateSpawnFork(world, origin);

  const exits: Pos[] = [];
  for (const plan of planArenaChains(origin)) {
    buildArenaChain(world, plan, geometry);
    exits.push(plan.exit);
  }
  for (let i = 0; i < exits.length; i++) {
    carveMeatTunnel(world, exits[i], exits[(i + 1) % exits.length], 1, Tex.F_GUT);
  }
  stampHellHqCompounds(world, origin, exits, geometry);
  stampHellMidMicroDistricts(world, origin, exits, geometry);

  return geometry;
}

export function carveHellSafeShortcut(world: World, a: HellPos, b: HellPos, radius = 1): number[] {
  const cells: number[] = [];
  const seen = new Set<number>();
  const dx = world.delta(a.x, b.x);
  const dy = world.delta(a.y, b.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const nx = dy === 0 ? 0 : -Math.sign(dy);
  const ny = dx === 0 ? 0 : Math.sign(dx);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wobble = Math.sin(t * Math.PI * 2 + (a.y - b.x) * 0.11) * 0.8;
    const x = world.wrap(Math.round(a.x + dx * t + nx * wobble));
    const y = world.wrap(Math.round(a.y + dy * t + ny * wobble));
    carveShortcutDisc(world, x, y, radius, cells, seen);
    if ((step % 11) === 0) setFeature(world, x, y, Feature.LAMP);
    if ((step % 13) === 0) paintWallRing(world, { x, y }, radius + 1, radius + 1, Tex.CONCRETE);
  }
  return cells;
}

function buildArenaChain(world: World, plan: ChainPlan, geometry: HellGeometry): void {
  const { spec, entry, arena, exit, fallback, reward, sightline, score } = plan;
  geometry.chainScores.push(score);
  registerHellPopulationAnchors(plan, geometry);

  if (spec.motif === 'bone') {
    carveBoneBridge(world, entry, arena);
  } else if (spec.motif === 'vent') {
    carveVentThroat(world, entry, arena);
  } else {
    carveMeatTunnel(world, entry, arena, 2, Tex.F_MEAT);
  }

  carveThreatPocket(world, arena, spec, geometry);
  carveMeatTunnel(world, arena, exit, 2, spec.motif === 'scar' ? Tex.F_CONCRETE : Tex.F_MEAT);
  carveFallbackLoop(world, entry, fallback, exit, spec, geometry);
  carveAlternateSightline(world, fallback, sightline, arena, spec, geometry);
  stampRitualRoom(world, reward, arena, spec);
  applyReactionDiffusionOverlay(world, plan, geometry);
  registerHellThresholdCue(world, plan, entry, fallback, reward);
  registerHellSightlineCue(world, plan, fallback, sightline, arena);

  if (spec.motif === 'barricade') {
    stampCultBarricade(world, midpoint(entry, arena), fallback, geometry);
  }
}

function registerHellThresholdCue(world: World, plan: ChainPlan, entry: Pos, fallback: Pos, reward: Pos): void {
  const { spec, score } = plan;
  setFeature(world, entry.x, entry.y, Feature.SCREEN);
  setFeature(world, reward.x, reward.y, Feature.SHELF);
  registerRouteCue(world, {
    id: `hell_threshold_${spec.id}_retreat`,
    x: entry.x + 0.5,
    y: entry.y + 0.5,
    targetX: fallback.x + 0.5,
    targetY: fallback.y + 0.5,
    floor: FloorLevel.HELL,
    label: `${spec.name}: отход`,
    hint: 'перед карманом есть петля отхода и отдельная полка награды',
    targetName: `${spec.name}: обратная петля`,
    color: spec.motif === 'scar' ? '#9cf' : spec.motif === 'barricade' ? '#fc8' : '#f88',
    tags: ['hell', 'threshold', 'retreat', 'reward', 'sightline', spec.id, spec.faction],
    toneSeed: spec.id.length * 451 + entry.x * 7 + entry.y,
    radius: 10,
    targetRadius: 4,
    cooldownSec: 48,
    heardText: `${spec.name}: у входа видна обратная петля и боковой обзор. Проверь отход до боя.`,
    followedText: `${spec.name}: петля отхода найдена. Наградная полка стоит отдельно от мясного кармана.`,
    ignoredText: `${spec.name}: порог остался без проверенного отхода.`,
    routeGroup: {
      id: `hell_chain_${spec.id}`,
      lead: `${spec.name}: порог`,
      risk: score.threat > 0.72 ? 'тяжелый мясной карман' : 'средний мясной карман',
      decision: 'зайти прямо, обойти через петлю или снять цель с бокового обзора',
      reward: 'отдельная полка после выхода из кармана',
      mapLabel: spec.name,
      mapHint: 'порог, отход, обзор и награда читаются как одна арена',
    },
  });
}

function registerHellSightlineCue(world: World, plan: ChainPlan, fallback: Pos, sightline: Pos, arena: Pos): void {
  const { spec, score } = plan;
  setFeature(world, sightline.x, sightline.y, Feature.SCREEN);
  registerRouteCue(world, {
    id: `hell_threshold_${spec.id}_sightline`,
    x: fallback.x + 0.5,
    y: fallback.y + 0.5,
    targetX: sightline.x + 0.5,
    targetY: sightline.y + 0.5,
    floor: FloorLevel.HELL,
    label: `${spec.name}: боковой обзор`,
    hint: 'узкий бетонный рубец выводит к линии обзора на арену без входа в центр',
    targetName: `${spec.name}: обзор на карман`,
    color: spec.motif === 'scar' ? '#9cf' : '#fbb',
    tags: ['hell', 'fallback', 'sightline', 'retreat', spec.id, spec.faction],
    toneSeed: spec.id.length * 911 + sightline.x * 5 + sightline.y,
    radius: 8,
    targetRadius: 3,
    cooldownSec: 38,
    heardText: `${spec.name}: из петли слышен боковой обзор. Можно проверить карман без прямого входа.`,
    followedText: `${spec.name}: боковой обзор открыт. Центр арены виден через мясной просвет.`,
    ignoredText: `${spec.name}: боковой обзор остался за спиной.`,
    routeGroup: {
      id: `hell_chain_${spec.id}_sightline`,
      lead: `${spec.name}: петля`,
      risk: 'узкий проход, но меньше прямого давления',
      decision: score.sightline > 0.7 ? 'снять угрозы с рубца или отступить к петле' : 'коротко проверить рубец и не задерживаться',
      reward: `вид на ${arena.x}:${arena.y} до входа в мясной карман`,
    },
  });
}

function carveThreatPocket(world: World, center: Pos, spec: ChainSpec, geometry: HellGeometry): void {
  const rx = spec.motif === 'barricade' ? 16 : 14;
  const ry = spec.motif === 'bone' ? 10 : 12;
  const cells = carveEllipse(world, center, rx, ry, Tex.F_MEAT, true);
  paintWallRing(world, center, rx + 2, ry + 2, spec.motif === 'bone' ? Tex.GUT : Tex.MEAT);
  for (const ci of cells) pushPressureCell(geometry, spec.faction, ci);

  setFeature(world, center.x, center.y, Feature.APPARATUS);
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    const x = world.wrap(center.x + Math.round(Math.cos(a) * (rx - 4)));
    const y = world.wrap(center.y + Math.round(Math.sin(a) * (ry - 4)));
    setFeature(world, x, y, Feature.CANDLE);
  }

  for (let i = 0; i < 7; i++) {
    const a = (Math.PI * 2 * i) / 7;
    const x = world.wrap(center.x + Math.round(Math.cos(a) * (rx - 2)));
    const y = world.wrap(center.y + Math.round(Math.sin(a) * (ry - 2)));
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 2.8, 140, 7800 + i + spec.id.length * 37, 115, 18, 24);
  }
}

function carveFallbackLoop(world: World, entry: Pos, fallback: Pos, exit: Pos, spec: ChainSpec, geometry: HellGeometry): void {
  const tex = spec.motif === 'scar' ? Tex.F_CONCRETE : Tex.F_GUT;
  carveMeatTunnel(world, entry, fallback, 1, tex);
  carveMeatTunnel(world, fallback, exit, 1, tex);
  carveSafeScar(world, fallback, 5, 3, geometry.safeCells);
  setFeature(world, fallback.x, fallback.y, spec.motif === 'scar' ? Feature.LAMP : Feature.CANDLE);
}

function carveAlternateSightline(
  world: World,
  fallback: Pos,
  sightline: Pos,
  arena: Pos,
  spec: ChainSpec,
  geometry: HellGeometry,
): void {
  const first = carveHellSafeShortcut(world, fallback, sightline, spec.motif === 'scar' ? 2 : 1);
  const edge = pointToward(sightline, arena, 8);
  const second = carveHellSafeShortcut(world, sightline, edge, 1);
  geometry.safeCells.push(...first, ...second);
  geometry.sightlineCells.push(...first, ...second);
  paintWallRing(world, sightline, 4, 3, spec.motif === 'scar' ? Tex.CONCRETE : Tex.GUT);
  setFeature(world, sightline.x, sightline.y, Feature.SCREEN);
  setFeature(world, sightline.x + 2, sightline.y, Feature.LAMP);
}

function carveBoneBridge(world: World, a: Pos, b: Pos): void {
  carveAbyssRibbon(world, a, b, 5);
  carveMeatTunnel(world, a, b, 1, Tex.F_CONCRETE);
  forEachLine(a, b, 9, (x, y, step) => {
    if ((step & 7) !== 0) return;
    setFeature(world, x, y, Feature.CANDLE);
  });
}

function carveVentThroat(world: World, a: Pos, b: Pos): void {
  carveMeatTunnel(world, a, b, 1, Tex.F_GUT);
  forEachLine(a, b, 6, (x, y, step) => {
    if ((step % 11) === 0) setFeature(world, x, y, Feature.APPARATUS);
    else if ((step % 7) === 0) setFeature(world, x, y, Feature.LAMP);
  });
}

function stampRitualRoom(world: World, center: Pos, target: Pos, spec: ChainSpec): void {
  const w = spec.motif === 'barricade' ? 17 : 13;
  const h = spec.motif === 'barricade' ? 9 : 11;
  const room = stampHellRoom(
    world,
    spec.motif === 'barricade' ? RoomType.HQ : RoomType.STORAGE,
    `${spec.name}: пороговая награда`,
    center.x - (w >> 1),
    center.y - (h >> 1),
    w,
    h,
    spec.motif === 'scar' ? Tex.CONCRETE : Tex.GUT,
    spec.motif === 'scar' ? Tex.F_CONCRETE : Tex.F_MEAT,
  );
  const door = openDoorToward(world, room, target);
  carveMeatTunnel(world, target, door.outside, 1, room.floorTex);

  setFeature(world, center.x, center.y, Feature.SHELF);
  setFeature(world, center.x - 3, center.y, Feature.CANDLE);
  setFeature(world, center.x + 3, center.y, Feature.CANDLE);
  if (spec.motif === 'vent') setFeature(world, center.x, center.y - 3, Feature.APPARATUS);
}

function stampCultBarricade(
  world: World,
  center: Pos,
  bypass: Pos,
  geometry: HellGeometry,
): void {
  const room = stampHellRoom(
    world,
    RoomType.HQ,
    'Культовая баррикада',
    center.x - 10,
    center.y - 4,
    20,
    8,
    Tex.METAL,
    Tex.F_MEAT,
  );
  const mainDoor = openDoorToward(world, room, add(center, { x: 36, y: 0 }));
  const rearDoor = openDoorToward(world, room, bypass);
  carveMeatTunnel(world, mainDoor.outside, rearDoor.outside, 1, Tex.F_GUT);
  carveMeatTunnel(world, bypass, rearDoor.outside, 1, Tex.F_GUT);

  for (let dx = -7; dx <= 7; dx += 2) {
    const ci = world.idx(center.x + dx, center.y);
    if (world.cells[ci] === Cell.FLOOR) {
      world.features[ci] = Feature.SHELF;
      geometry.cultistCells.push(ci);
    }
  }
  setFeature(world, center.x, center.y - 2, Feature.SCREEN);
}

function stampHellRoom(
  world: World,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  protectRoom(world, room.x, room.y, room.w, room.h, wallTex, floorTex);
  return room;
}

function stampHellMutableRoom(
  world: World,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
  owner: TerritoryOwner,
): Room | null {
  if (!canStampHellMutableRoom(world, x, y, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.aptMask[ci] = 0;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        if (world.roomMap[ci] !== room.id) continue;
        world.floorTex[ci] = floorTex;
        world.wallTex[ci] = 0;
        world.factionControl[ci] = owner;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
        world.factionControl[ci] = owner;
      }
    }
  }
  decorateHellOwnedRoom(world, room, owner);
  return room;
}

function canStampHellMutableRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
      if (world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function decorateHellOwnedRoom(world: World, room: Room, owner: TerritoryOwner): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, cx, cy, roomFeature(room.type, owner));
  if (room.w >= 7) {
    setFeature(world, room.x + 2, cy, room.type === RoomType.BATHROOM ? Feature.SINK : Feature.SHELF);
    setFeature(world, room.x + room.w - 3, cy, room.type === RoomType.KITCHEN ? Feature.STOVE : Feature.TABLE);
  }
  if (room.h >= 7) {
    setFeature(world, cx, room.y + 2, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
    setFeature(world, cx, room.y + room.h - 3, room.type === RoomType.OFFICE ? Feature.SCREEN : Feature.CHAIR);
  }
}

function roomFeature(type: RoomType, owner: TerritoryOwner): Feature {
  if (type === RoomType.HQ) return owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.SCREEN;
  if (type === RoomType.KITCHEN) return Feature.STOVE;
  if (type === RoomType.BATHROOM) return Feature.TOILET;
  if (type === RoomType.MEDICAL) return Feature.APPARATUS;
  if (type === RoomType.OFFICE) return Feature.DESK;
  if (type === RoomType.PRODUCTION) return Feature.MACHINE;
  if (type === RoomType.STORAGE) return Feature.SHELF;
  return owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.TABLE;
}

function paintHellOwnerDisc(world: World, center: Pos, radius: number, owner: TerritoryOwner): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const ci = world.idx(center.x + dx, center.y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.factionControl[ci] = owner;
    }
  }
}

function paintHellRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id) world.factionControl[ci] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function roomCenterPos(room: Room): Pos {
  return {
    x: wrap(room.x + (room.w >> 1)),
    y: wrap(room.y + (room.h >> 1)),
  };
}

function connectHellRooms(world: World, a: Room, b: Room, floorTex: Tex): void {
  const ac = roomCenterPos(a);
  const bc = roomCenterPos(b);
  const ad = openDoorToward(world, a, bc);
  const bd = openDoorToward(world, b, ac);
  carveMeatTunnel(world, ad.outside, bd.outside, 1, floorTex);
}

function nearestHellAnchor(world: World, from: Pos, anchors: readonly Pos[]): Pos {
  let best = anchors[0];
  let bestD2 = Infinity;
  for (const anchor of anchors) {
    const d2 = world.dist2(from.x, from.y, anchor.x, anchor.y);
    if (d2 < bestD2) {
      best = anchor;
      bestD2 = d2;
    }
  }
  return best;
}

function stampHellHqCompounds(world: World, origin: Pos, exits: readonly Pos[], geometry: HellGeometry): void {
  const anchors = [origin, ...exits];
  for (const spec of HELL_HQ_COMPOUNDS) {
    const center = add(origin, spec.center);
    const coreW = spec.stronghold ? 16 : 13;
    const coreH = spec.stronghold ? 11 : 9;
    const core = stampHellMutableRoom(
      world,
      RoomType.HQ,
      `${spec.title}: гермоядро`,
      center.x - (coreW >> 1),
      center.y - (coreH >> 1),
      coreW,
      coreH,
      spec.wallTex,
      spec.floorTex,
      spec.owner,
    );
    if (!core) continue;

    const support = stampHellCompoundSupport(world, spec, center, core);
    const hub = nearestHellAnchor(world, center, anchors);
    carveMeatTunnel(world, hub, center, spec.stronghold ? 2 : 1, spec.floorTex);
    paintHellOwnerDisc(world, center, spec.stronghold ? 36 : 28, spec.owner);
    paintHellRoomOwner(world, core, spec.owner);
    if (spec.owner === ZoneFaction.CULTIST) {
      addPopulationAnchor(geometry.populationAnchors.cultist, center, spec.stronghold ? 58 : 38, spec.stronghold ? 1.7 : 1.35);
      geometry.cultistCells.push(...roomCells(world, core));
    } else if (spec.owner === ZoneFaction.LIQUIDATOR) {
      addPopulationAnchor(geometry.populationAnchors.liquidator, center, spec.stronghold ? 52 : 36, spec.stronghold ? 1.6 : 1.25);
      geometry.liquidatorCells.push(...roomCells(world, core));
    } else {
      addPopulationAnchor(geometry.populationAnchors.safe, center, 34, 0.9);
      geometry.safeCells.push(...roomCells(world, core));
    }
    for (const room of support) {
      paintHellRoomOwner(world, room, spec.owner);
      if (spec.owner === ZoneFaction.CULTIST) geometry.cultistCells.push(...roomCells(world, room));
      else if (spec.owner === ZoneFaction.LIQUIDATOR) geometry.liquidatorCells.push(...roomCells(world, room));
      else geometry.safeCells.push(...roomCells(world, room));
    }
  }
}

function stampHellCompoundSupport(
  world: World,
  spec: HellHqCompoundSpec,
  center: Pos,
  core: Room,
): Room[] {
  const rooms: Room[] = [];
  const rows = [
    { suffix: 'кухня общего мяса', type: RoomType.KITCHEN, dx: -22, dy: -14, w: 11, h: 8 },
    { suffix: 'санузел укрытия', type: RoomType.BATHROOM, dx: 13, dy: -14, w: 9, h: 7 },
    { suffix: 'склад жестяных коробов', type: RoomType.STORAGE, dx: -24, dy: 7, w: 12, h: 8 },
    { suffix: spec.owner === ZoneFaction.SCIENTIST ? 'измерительный кабинет' : 'офис сменного', type: spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, dx: 14, dy: 8, w: 12, h: 8 },
    { suffix: 'общая комната дозора', type: RoomType.COMMON, dx: -6, dy: 22, w: 14, h: 8 },
    { suffix: spec.owner === ZoneFaction.WILD ? 'ремонтный завал' : 'мастерская поддержки', type: RoomType.PRODUCTION, dx: -7, dy: -29, w: 13, h: 7 },
  ] as const;
  for (const row of rows) {
    const room = stampHellMutableRoom(
      world,
      row.type,
      `${spec.title}: ${row.suffix}`,
      center.x + row.dx,
      center.y + row.dy,
      row.w,
      row.h,
      spec.wallTex,
      row.type === RoomType.BATHROOM || row.type === RoomType.MEDICAL ? Tex.F_TILE : spec.floorTex,
      spec.owner,
    );
    if (!room) continue;
    rooms.push(room);
    connectHellRooms(world, core, room, spec.floorTex);
  }
  return rooms;
}

function roomCells(world: World, room: Room): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id) cells.push(ci);
    }
  }
  return cells;
}

function stampHellMidMicroDistricts(world: World, origin: Pos, exits: readonly Pos[], geometry: HellGeometry): void {
  const anchors = [origin, ...exits, ...HELL_HQ_COMPOUNDS.map(spec => add(origin, spec.center))];
  for (const spec of HELL_DISTRICTS) {
    const center = add(origin, spec.center);
    const hub = nearestHellAnchor(world, center, anchors);
    carveMeatTunnel(world, hub, center, 2, spec.floorTex);
    stampHellAlcovesAlongLine(world, hub, center, spec.owner, spec.wallTex, spec.floorTex, spec.title);
    stampHellDistrict(world, spec, center, geometry);
  }
}

function stampHellDistrict(world: World, spec: HellDistrictSpec, center: Pos, geometry: HellGeometry): void {
  carveEllipse(world, center, spec.rx, spec.ry, spec.floorTex, false);
  paintWallRing(world, center, spec.rx + 3, spec.ry + 3, spec.wallTex);
  paintHellOwnerDisc(world, center, Math.max(spec.rx, spec.ry), spec.owner);
  setFeature(world, center.x, center.y, spec.owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
  addPopulationAnchor(
    spec.owner === ZoneFaction.CULTIST
      ? geometry.populationAnchors.cultist
      : spec.owner === ZoneFaction.LIQUIDATOR
        ? geometry.populationAnchors.liquidator
        : geometry.populationAnchors.safe,
    center,
    Math.max(spec.rx, spec.ry) + 24,
    spec.owner === ZoneFaction.CULTIST ? 1.45 : spec.owner === ZoneFaction.LIQUIDATOR ? 1.34 : 0.96,
  );

  for (let i = 0; i < spec.rooms; i++) {
    const a = (Math.PI * 2 * i) / spec.rooms + (hash3(center.x, center.y, i + spec.rooms) - 0.5) * 0.28;
    const w = 5 + Math.floor(hash3(center.x + i, center.y, 17) * 5);
    const h = 4 + Math.floor(hash3(center.x - i, center.y, 31) * 4);
    const r = 0.72 + hash3(center.x, center.y + i, 53) * 0.34;
    const x = wrap(center.x + Math.round(Math.cos(a) * spec.rx * r) - (w >> 1));
    const y = wrap(center.y + Math.round(Math.sin(a) * spec.ry * r) - (h >> 1));
    const type = districtRoomType(spec.owner, i);
    const room = stampHellMutableRoom(
      world,
      type,
      `Мясной низ: ${spec.title}: микрокомната ${String(i + 1).padStart(2, '0')}`,
      x,
      y,
      w,
      h,
      spec.wallTex,
      type === RoomType.BATHROOM || type === RoomType.MEDICAL ? Tex.F_TILE : spec.floorTex,
      spec.owner,
    );
    if (!room) continue;
    const door = openDoorToward(world, room, center);
    carveMeatTunnel(world, door.outside, center, 1, spec.floorTex);
    paintHellRoomOwner(world, room, spec.owner);
    const cells = roomCells(world, room);
    if (spec.owner === ZoneFaction.CULTIST) geometry.cultistCells.push(...cells);
    else if (spec.owner === ZoneFaction.LIQUIDATOR) geometry.liquidatorCells.push(...cells);
    else geometry.safeCells.push(...cells);
  }
}

function districtRoomType(owner: TerritoryOwner, serial: number): RoomType {
  if (serial % 7 === 0) return RoomType.BATHROOM;
  if (serial % 5 === 0) return owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE;
  if (serial % 3 === 0) return RoomType.STORAGE;
  if (owner === ZoneFaction.LIQUIDATOR && serial % 4 === 0) return RoomType.COMMON;
  if (owner === ZoneFaction.WILD && serial % 4 === 0) return RoomType.SMOKING;
  return RoomType.STORAGE;
}

function stampHellAlcovesAlongLine(
  world: World,
  a: Pos,
  b: Pos,
  owner: TerritoryOwner,
  wallTex: Tex,
  floorTex: Tex,
  title: string,
): void {
  const dx = shortestDelta(a.x, b.x);
  const dy = shortestDelta(a.y, b.y);
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = dy === 0 ? 0 : -Math.sign(dy);
  const ny = dx === 0 ? 0 : Math.sign(dx);
  const count = Math.max(2, Math.min(8, Math.floor(len / 56)));
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const side = (i & 1) === 0 ? 1 : -1;
    const px = wrap(Math.round(a.x + dx * t + nx * side * (7 + (i % 3) * 3)));
    const py = wrap(Math.round(a.y + dy * t + ny * side * (7 + (i % 3) * 3)));
    const w = 4 + (i % 3);
    const h = 3 + (i % 2);
    const room = stampHellMutableRoom(
      world,
      RoomType.STORAGE,
      `Мясной низ: ${title}: карман ${String(i).padStart(2, '0')}`,
      px - (w >> 1),
      py - (h >> 1),
      w,
      h,
      wallTex,
      floorTex,
      owner,
    );
    if (!room) continue;
    const door = openDoorToward(world, room, { x: wrap(Math.round(a.x + dx * t)), y: wrap(Math.round(a.y + dy * t)) });
    carveMeatTunnel(world, door.outside, { x: wrap(Math.round(a.x + dx * t)), y: wrap(Math.round(a.y + dy * t)) }, 1, floorTex);
    paintHellRoomOwner(world, room, owner);
  }
}

function openDoorToward(world: World, room: Room, target: Pos): { door: Pos; outside: Pos } {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = world.delta(cx, target.x);
  const dy = world.delta(cy, target.y);
  let door: Pos;
  let outside: Pos;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const y = world.wrap(cy);
    if (dx >= 0) {
      door = { x: world.wrap(room.x + room.w), y };
      outside = { x: world.wrap(room.x + room.w + 1), y };
    } else {
      door = { x: world.wrap(room.x - 1), y };
      outside = { x: world.wrap(room.x - 2), y };
    }
  } else {
    const x = world.wrap(cx);
    if (dy >= 0) {
      door = { x, y: world.wrap(room.y + room.h) };
      outside = { x, y: world.wrap(room.y + room.h + 1) };
    } else {
      door = { x, y: world.wrap(room.y - 1) };
      outside = { x, y: world.wrap(room.y - 2) };
    }
  }

  const ci = world.idx(door.x, door.y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.floorTex[ci] = room.floorTex;
  world.aptMask[ci] = 0;
  world.doors.set(ci, {
    idx: ci,
    state: DoorState.CLOSED,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(ci);
  carveFloor(world, outside.x, outside.y, room.floorTex);
  return { door, outside };
}

function carveSafeScar(world: World, center: Pos, rx: number, ry: number, out: number[]): void {
  const cells = carveEllipse(world, center, rx, ry, Tex.F_CONCRETE, false);
  for (const ci of cells) out.push(ci);
  paintWallRing(world, center, rx + 1, ry + 1, Tex.CONCRETE);
  setFeature(world, center.x, center.y, Feature.LAMP);
}

function decorateSpawnFork(world: World, origin: Pos): void {
  setFeature(world, origin.x - 5, origin.y, Feature.CANDLE);
  setFeature(world, origin.x + 5, origin.y, Feature.CANDLE);
  setFeature(world, origin.x, origin.y - 4, Feature.APPARATUS);
  carveVentThroat(world, add(origin, { x: 0, y: -5 }), add(origin, { x: 17, y: -4 }));
  carveMeatTunnel(world, add(origin, { x: -7, y: 0 }), add(origin, { x: -20, y: -18 }), 1, Tex.F_CONCRETE);
}

function carveMeatTunnel(world: World, a: Pos, b: Pos, radius: number, floorTex: Tex): void {
  const dx = world.delta(a.x, b.x);
  const dy = world.delta(a.y, b.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const nx = dy === 0 ? 0 : -Math.sign(dy);
  const ny = dx === 0 ? 0 : Math.sign(dx);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wobble = Math.sin(t * Math.PI * 3 + (a.x + b.y) * 0.13) * 1.8;
    const x = world.wrap(Math.round(a.x + dx * t + nx * wobble));
    const y = world.wrap(Math.round(a.y + dy * t + ny * wobble));
    carveDisc(world, x, y, radius, floorTex);
    if ((step % 13) === 0) paintWallRing(world, { x, y }, radius + 2, radius + 2, Tex.GUT);
  }
}

function carveAbyssRibbon(world: World, a: Pos, b: Pos, radius: number): void {
  forEachLine(a, b, 1, (x, y) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const ci = world.idx(x + dx, y + dy);
        if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
        world.cells[ci] = Cell.ABYSS;
        world.roomMap[ci] = -1;
        world.features[ci] = Feature.NONE;
        world.floorTex[ci] = Tex.F_ABYSS;
        world.wallTex[ci] = 0;
      }
    }
  });
}

function carveEllipse(world: World, center: Pos, rx: number, ry: number, floorTex: Tex, pressure: boolean): number[] {
  const cells: number[] = [];
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const n = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (n > 1) continue;
      const x = world.wrap(center.x + dx);
      const y = world.wrap(center.y + dy);
      const ci = world.idx(x, y);
      carveFloor(world, x, y, floorTex);
      cells.push(ci);
      if (pressure && n > 0.32 && n < 0.9 && ((dx + dy) & 1) === 0) cells.push(ci);
    }
  }
  return cells;
}

function carveDisc(world: World, x: number, y: number, radius: number, floorTex: Tex): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      carveFloor(world, x + dx, y + dy, floorTex);
    }
  }
}

function carveShortcutDisc(
  world: World,
  x: number,
  y: number,
  radius: number,
  out: number[],
  seen: Set<number>,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const cx = world.wrap(x + dx);
      const cy = world.wrap(y + dy);
      const ci = world.idx(cx, cy);
      carveFloor(world, cx, cy, Tex.F_CONCRETE);
      if (!seen.has(ci) && world.cells[ci] === Cell.FLOOR) {
        seen.add(ci);
        out.push(ci);
      }
    }
  }
}

function carveFloor(world: World, x: number, y: number, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = 0;
}

function paintWallRing(world: World, center: Pos, rx: number, ry: number, wallTex: Tex): void {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const n = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (n < 0.92 || n > 1.24) continue;
      const ci = world.idx(center.x + dx, center.y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
    }
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) return;
  world.features[ci] = feature;
}

function registerHellPopulationAnchors(plan: ChainPlan, geometry: HellGeometry): void {
  const { spec, arena, fallback, reward, sightline, score } = plan;
  addPopulationAnchor(geometry.populationAnchors.monster, arena, 42, 1.34 + score.threat * 0.34);
  addPopulationAnchor(geometry.populationAnchors.monster, reward, 18, 0.72);
  addPopulationAnchor(geometry.populationAnchors.safe, fallback, 26, 0.34 + (1 - score.fallback) * 0.14);
  addPopulationAnchor(geometry.populationAnchors.safe, sightline, 18, 0.46);
  if (spec.faction === 'cultist') addPopulationAnchor(geometry.populationAnchors.cultist, arena, 34, 1.38 + score.entry * 0.24);
  else if (spec.faction === 'liquidator') addPopulationAnchor(geometry.populationAnchors.liquidator, fallback, 30, 1.22 + score.fallback * 0.22);
}

function addPopulationAnchor(out: PlacementFieldAnchor[], pos: Pos, radius: number, weight: number): void {
  out.push({ x: pos.x + 0.5, y: pos.y + 0.5, radius, weight });
}

function applyReactionDiffusionOverlay(world: World, plan: ChainPlan, geometry: HellGeometry): void {
  stampReactionBloom(world, plan, plan.arena, 26, 19, 'threat', geometry);
  stampReactionBloom(world, plan, plan.fallback, 17, 11, 'fallback', geometry);
  stampReactionBloom(world, plan, plan.sightline, 13, 9, 'sightline', geometry);
  stampReactionBloom(world, plan, plan.reward, 12, 9, 'reward', geometry);
}

type ReactionRole = 'threat' | 'fallback' | 'sightline' | 'reward';

function stampReactionBloom(
  world: World,
  plan: ChainPlan,
  center: Pos,
  rx: number,
  ry: number,
  role: ReactionRole,
  geometry: HellGeometry,
): void {
  const seed = plan.spec.id.length * 379 + center.x * 13 + center.y * 17 + rx * 5 + ry;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const n = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (n > 1.18) continue;
      const x = wrap(center.x + dx);
      const y = wrap(center.y + dy);
      const ci = world.idx(x, y);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;

      const activator = valueNoise(x + 0.5, y + 0.5, 9 + rx * 0.25, seed);
      const inhibitor = valueNoise(x + 0.5, y + 0.5, 24 + ry * 0.4, seed + 41);
      const edge = 1 - Math.min(1, Math.sqrt(Math.max(0, n)));
      const rd = activator * 0.9 - inhibitor * 0.62 + edge * 0.52;

      if (world.cells[ci] === Cell.WALL) {
        if (rd > 0.18 || (n > 0.9 && n < 1.18)) world.wallTex[ci] = reactionWallTex(plan.spec, role, rd);
        continue;
      }
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] >= 0) continue;

      if (rd > -0.08) world.floorTex[ci] = reactionFloorTex(plan.spec, role, rd);
      if (role === 'threat' && rd > 0.22) pushPressureCell(geometry, plan.spec.faction, ci);
      else if ((role === 'fallback' || role === 'sightline') && rd > 0.08) geometry.safeCells.push(ci);

      if (world.features[ci] === Feature.NONE && rd > 0.36 && hash3(x, y, seed + 79) > 0.975) {
        world.features[ci] = reactionFeature(role);
      }
      if (rd > 0.46 && hash3(x, y, seed + 101) > 0.992) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 1.8 + edge * 1.6, 96, seed + ci, 120, 22, 28);
      }
    }
  }
}

function reactionFloorTex(spec: ChainSpec, role: ReactionRole, value: number): Tex {
  if (role === 'fallback' || role === 'sightline') return value > 0.28 || spec.motif === 'scar' ? Tex.F_CONCRETE : Tex.F_GUT;
  if (role === 'reward') return spec.motif === 'scar' ? Tex.F_CONCRETE : value > 0.32 ? Tex.F_GUT : Tex.F_MEAT;
  return value > 0.28 || spec.motif === 'vent' ? Tex.F_GUT : Tex.F_MEAT;
}

function reactionWallTex(spec: ChainSpec, role: ReactionRole, value: number): Tex {
  if (role === 'fallback' || role === 'sightline' || spec.motif === 'scar') return value > 0.24 ? Tex.CONCRETE : Tex.GUT;
  return value > 0.25 || spec.motif === 'bone' ? Tex.GUT : Tex.MEAT;
}

function reactionFeature(role: ReactionRole): Feature {
  if (role === 'threat') return Feature.CANDLE;
  if (role === 'reward') return Feature.SHELF;
  if (role === 'sightline') return Feature.SCREEN;
  return Feature.LAMP;
}

function pushPressureCell(geometry: HellGeometry, faction: ChainSpec['faction'], ci: number): void {
  geometry.monsterCells.push(ci);
  if (faction === 'cultist') geometry.cultistCells.push(ci);
  else if (faction === 'liquidator') geometry.liquidatorCells.push(ci);
}

function planArenaChains(origin: Pos): ChainPlan[] {
  return CHAINS.map(spec => {
    const entry = add(origin, spec.entry);
    const arena = add(origin, spec.arena);
    const exit = add(origin, spec.exit);
    const fallback = add(origin, spec.fallback);
    const reward = add(origin, spec.reward);
    const sightline = pointToward(arena, fallback, 20);
    const score = scoreArenaChain(spec, origin, entry, arena, exit, fallback, reward, sightline);
    return { spec, entry, arena, exit, fallback, reward, sightline, score };
  });
}

function scoreArenaChain(
  spec: ChainSpec,
  origin: Pos,
  entry: Pos,
  arena: Pos,
  exit: Pos,
  fallback: Pos,
  reward: Pos,
  sightline: Pos,
): HellArenaChainScore {
  const entryScore = scoreDistance(dist(origin, entry), 28, 78);
  const threatScore = scoreDistance(dist(entry, arena), 42, 118);
  const fallbackScore = Math.min(
    scoreDistance(dist(entry, fallback) + dist(fallback, exit), 54, 150),
    scoreDistance(dist(fallback, arena), 22, 88),
  );
  const rewardScore = Math.min(scoreDistance(dist(reward, arena), 24, 84), scoreDistance(dist(reward, exit), 16, 70));
  const exitScore = scoreDistance(dist(arena, exit), 42, 126);
  const sightlineScore = Math.min(scoreDistance(dist(fallback, sightline), 18, 78), scoreDistance(dist(sightline, arena), 12, 36));
  const total = (
    entryScore * 0.14 +
    threatScore * 0.2 +
    fallbackScore * 0.24 +
    rewardScore * 0.15 +
    exitScore * 0.14 +
    sightlineScore * 0.13
  );
  return {
    id: spec.id,
    entry: entryScore,
    threat: threatScore,
    fallback: fallbackScore,
    reward: rewardScore,
    exit: exitScore,
    sightline: sightlineScore,
    total,
  };
}

function scoreDistance(value: number, min: number, max: number): number {
  if (value <= min || value >= max) return 0.35;
  const mid = (min + max) * 0.5;
  const half = (max - min) * 0.5;
  return 0.35 + 0.65 * (1 - Math.abs(value - mid) / half);
}

function dist(a: Pos, b: Pos): number {
  const dx = shortestDelta(a.x, b.x);
  const dy = shortestDelta(a.y, b.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToward(a: Pos, b: Pos, distance: number): Pos {
  const dx = shortestDelta(a.x, b.x);
  const dy = shortestDelta(a.y, b.y);
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  return {
    x: wrap(a.x + Math.round(dx * distance / len)),
    y: wrap(a.y + Math.round(dy * distance / len)),
  };
}

function carveFieldRibbon(field: Uint8Array, a: Pos, b: Pos, radius: number): void {
  forEachLine(a, b, 1, (x, y) => carveFieldDisc(field, { x, y }, radius));
}

function carveFieldDisc(field: Uint8Array, center: Pos, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      field[wrap(center.y + dy) * W + wrap(center.x + dx)] = 1;
    }
  }
}

function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const period = Math.max(1, Math.round(W / Math.max(1, scale)));
  const actualScale = W / period;
  const gx = Math.floor(x / actualScale);
  const gy = Math.floor(y / actualScale);
  const fx = x / actualScale - gx;
  const fy = y / actualScale - gy;
  const x0 = wrap(gx);
  const y0 = wrap(gy);
  const x1 = wrap(gx + 1);
  const y1 = wrap(gy + 1);
  const sx = smooth(fx);
  const sy = smooth(fy);
  const a = lerp(hash3(x0, y0, seed), hash3(x1, y0, seed), sx);
  const b = lerp(hash3(x0, y1, seed), hash3(x1, y1, seed), sx);
  return lerp(a, b, sy);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash3(a: number, b: number, c: number): number {
  let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 0xffffffff;
}

function forEachLine(a: Pos, b: Pos, stepMul: number, visit: (x: number, y: number, step: number) => void): void {
  const dx = shortestDelta(a.x, b.x);
  const dy = shortestDelta(a.y, b.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * stepMul));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    visit(wrap(Math.round(a.x + dx * t)), wrap(Math.round(a.y + dy * t)), step);
  }
}

function add(a: Pos, b: Pos): Pos {
  return { x: wrap(a.x + b.x), y: wrap(a.y + b.y) };
}

function midpoint(a: Pos, b: Pos): Pos {
  return {
    x: wrap(a.x + Math.round(shortestDelta(a.x, b.x) * 0.5)),
    y: wrap(a.y + Math.round(shortestDelta(a.y, b.y) * 0.5)),
  };
}

function shortestDelta(a: number, b: number): number {
  let d = b - a;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

function wrap(v: number): number {
  return ((v % W) + W) % W;
}

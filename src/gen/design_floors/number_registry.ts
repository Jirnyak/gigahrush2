/* -- Design floor: number_registry / Числовой реестр ----------- */

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { syncZoneMetadataFromTerritory } from '../../systems/territory';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('number_registry');

export const NUMBER_REGISTRY_ROUTE_ID = 'number_registry' as const;
export const NUMBER_REGISTRY_Z = 32 as const;
export const NUMBER_REGISTRY_BASE_FLOOR = FloorLevel.MINISTRY;
export const NUMBER_REGISTRY_DEBUG_ENTRY = 'design_floor.number_registry' as const;

type NextId = { v: number };

interface ResidueLane {
  id: string;
  modulus: number;
  residue: number;
  axis: 'x' | 'y';
  label: string;
}

export interface NumberRegistryDecision {
  id: string;
  roomName: string;
  route: 'decode' | 'bribe' | 'prime_risk' | 'composite_public';
  itemId: string;
  eventTag: string;
  consequence: string;
}

export interface NumberRegistryCrtIntersection {
  id: string;
  modulusA: number;
  residueA: number;
  modulusB: number;
  residueB: number;
  combinedResidue: number;
  combinedModulus: number;
  label: string;
}

const RESIDUE_LANES: readonly ResidueLane[] = [
  { id: 'mod_5_r2', modulus: 5, residue: 2, axis: 'x', label: 'остаток 2 по модулю 5' },
  { id: 'mod_7_r3', modulus: 7, residue: 3, axis: 'y', label: 'остаток 3 по модулю 7' },
  { id: 'mod_11_r4', modulus: 11, residue: 4, axis: 'x', label: 'остаток 4 по модулю 11' },
];

export const NUMBER_REGISTRY_RESIDUE_LANES = RESIDUE_LANES;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function crtResidue(modA: number, resA: number, modB: number, resB: number): number {
  if (gcd(modA, modB) !== 1) return -1;
  const limit = modA * modB;
  for (let n = ((resA % modA) + modA) % modA; n < limit; n += modA) {
    if (n % modB === ((resB % modB) + modB) % modB) return n;
  }
  return -1;
}

export const NUMBER_REGISTRY_CRT_INTERSECTIONS: readonly NumberRegistryCrtIntersection[] = [
  {
    id: 'crt_5_7_window',
    modulusA: 5,
    residueA: 2,
    modulusB: 7,
    residueB: 3,
    combinedResidue: crtResidue(5, 2, 7, 3),
    combinedModulus: 35,
    label: '17 mod 35',
  },
  {
    id: 'crt_7_11_archive',
    modulusA: 7,
    residueA: 3,
    modulusB: 11,
    residueB: 4,
    combinedResidue: crtResidue(7, 3, 11, 4),
    combinedModulus: 77,
    label: '25 mod 77',
  },
  {
    id: 'crt_5_11_safe',
    modulusA: 5,
    residueA: 2,
    modulusB: 11,
    residueB: 4,
    combinedResidue: crtResidue(5, 2, 11, 4),
    combinedModulus: 55,
    label: '37 mod 55',
  },
];

export const NUMBER_REGISTRY_DECISIONS: readonly NumberRegistryDecision[] = [
  {
    id: 'decode_residue_route',
    roomName: 'Зал сверки остатков',
    route: 'decode',
    itemId: 'blank_form',
    eventTag: 'residue_decode',
    consequence: 'Сверка остатков показывает короткий путь к пересечной картотеке без драки у простого коридора.',
  },
  {
    id: 'bribe_modulus_clerk',
    roomName: 'Касса модуля 7',
    route: 'bribe',
    itemId: 'elevator_access_order',
    eventTag: 'modulus_bribe',
    consequence: 'Кассир продает модуль и маршрутный ордер; очередь считает это оплатой, а не взяткой.',
  },
  {
    id: 'prime_risky_corridor',
    roomName: 'Простой рискованный коридор',
    route: 'prime_risk',
    itemId: 'forged_stamp_sheet',
    eventTag: 'prime_corridor',
    consequence: 'Простой коридор короче, но там печатееды и параграфы реагируют на бумагу.',
  },
  {
    id: 'composite_public_path',
    roomName: 'Составной публичный обход',
    route: 'composite_public',
    itemId: 'official_permit_slip',
    eventTag: 'composite_path',
    consequence: 'Составной обход длиннее, зато его можно пройти через окно, талон и свидетеля.',
  },
];

const ROUTE_TARGET = {
  designFloorId: NUMBER_REGISTRY_ROUTE_ID,
  z: NUMBER_REGISTRY_Z,
  tags: ['number_registry', 'residue', 'modulus'],
  label: 'Числовой реестр',
  risk: 3,
} as const;

interface RegistryTerritoryTarget {
  owner: TerritoryOwner;
  share: number;
  label: string;
  hq: { x: number; y: number };
}

export const NUMBER_REGISTRY_TERRITORY_TARGETS: readonly RegistryTerritoryTarget[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.30, label: 'граждане', hq: { x: 170, y: 520 } },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.18, label: 'ликвидаторы', hq: { x: 534, y: 228 } },
  { owner: ZoneFaction.CULTIST, share: 0.10, label: 'культисты', hq: { x: 184, y: 238 } },
  { owner: ZoneFaction.SCIENTIST, share: 0.34, label: 'учёные', hq: { x: 732, y: 654 } },
  { owner: ZoneFaction.WILD, share: 0.08, label: 'дикие', hq: { x: 178, y: 812 } },
] as const;

const REGISTRAR_DEF: PlotNpcDef = {
  name: 'Вера Модульная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 110,
  maxHp: 110,
  money: 97,
  speed: 0.72,
  inventory: [
    { defId: 'elevator_access_order', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'ink_bottle', count: 1 },
  ],
  talkLines: [
    'Без модуля вы у нас просто человек в очереди. С модулем - человек в неправильном окне.',
    'Остаток пишите цифрой. Словами остатки принимают только после отбоя.',
    'Девяносто семь рублей в кассу, и я скажу, какой коридор сегодня не делает вид, что простое число.',
    'Подпись ставится после сверки. До сверки подпись считается кляксой с амбициями.',
  ],
  talkLinesPost: [
    'Ваш остаток записан. Теперь не путайте маршрутный ордер с талоном в столовую.',
    'Если коридор стал короче, проверьте, не стал ли он голоднее.',
  ],
};

const PRIME_GUARD_DEF: PlotNpcDef = {
  name: 'Федор Простой',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 210,
  maxHp: 210,
  money: 55,
  speed: 0.92,
  weapon: 'makarov',
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'forged_stamp_sheet', count: 1 },
  ],
  talkLines: [
    'Простой коридор потому и простой: лишние люди в нем не остаются.',
    'Если на бумаге семь делителей, не несите ее туда, где ходят параграфы.',
    'Я держу пост до следующего простого номера. Потом пост держит меня.',
  ],
  talkLinesPost: [
    'Коридор прочищен. Долго он чистым не будет, но пройти успеете.',
    'Не размахивайте печатью. Печатееду всё равно, настоящая она или красивая.',
  ],
};

const COMPOSITE_DEF: PlotNpcDef = {
  name: 'Семен Составной',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 125,
  maxHp: 125,
  money: 33,
  speed: 0.65,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'ration_registry_extract', count: 1 },
  ],
  talkLines: [
    'Составной путь длинный, зато свидетелей много. При свидетелях шкафы скрипят тише.',
    'Мне нужен чистый бланк. Я приложу его к общей ведомости, и дверь перестанет строить из себя экзамен.',
    'Простые любят риск. Составные любят очередь. Очередь хотя бы можно занять табуреткой.',
  ],
  talkLinesPost: [
    'Бланк подшит. Идите по публичному обходу, там ругаются, но не кусают.',
    'Если кто спросит, вы были не быстрым, а оформленным.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'number_registry_vera_modulus', REGISTRAR_DEF, [
  {
    id: 'number_registry_buy_modulus',
    giverNpcId: 'number_registry_vera_modulus',
    type: QuestType.FETCH,
    desc: 'Вера Модульная: «Заплати 97 рублей в кассу модуля. Я дам ордер и скажу, по какому остатку идти.»',
    targetItem: 'money',
    targetCount: 97,
    targetFloor: NUMBER_REGISTRY_BASE_FLOOR,
    targetRoute: ROUTE_TARGET,
    targetRoomName: 'Касса модуля 7',
    targetHint: 'Числовой реестр z=+32: касса рядом с залом сверки остатков.',
    rewardItem: 'elevator_access_order',
    rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: 7,
    xpReward: 55,
    moneyReward: 0,
    eventTargetName: 'Модуль маршрута куплен через кассу Числового реестра.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: ['number_registry', 'modulus_bribe', 'residue_route', 'documents'],
    eventData: { routeId: NUMBER_REGISTRY_ROUTE_ID, decision: 'bribe_modulus_clerk' },
  },
  {
    id: 'number_registry_decode_residue',
    giverNpcId: 'number_registry_vera_modulus',
    type: QuestType.FETCH,
    desc: 'Вера Модульная: «Принеси чистый бланк. По нему сверим остаток и откроем пересечную картотеку без лишней очереди.»',
    targetItem: 'blank_form',
    targetCount: 1,
    targetFloor: NUMBER_REGISTRY_BASE_FLOOR,
    targetRoute: ROUTE_TARGET,
    targetRoomName: 'Зал сверки остатков',
    targetHint: 'Числовой реестр: искать столы с экранами остатков у центрального зала.',
    rewardItem: 'archive_access_permit',
    rewardCount: 1,
    extraRewards: [{ defId: 'ration_registry_extract', count: 1 }],
    relationDelta: 9,
    xpReward: 65,
    moneyReward: 25,
    eventTargetName: 'Остаток маршрута расшифрован в Числовом реестре.',
    eventSeverity: 3,
    eventPrivacy: 'private',
    eventTags: ['number_registry', 'residue_decode', 'crt_intersection', 'access'],
    eventData: { routeId: NUMBER_REGISTRY_ROUTE_ID, decision: 'decode_residue_route' },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'number_registry_prime_guard', PRIME_GUARD_DEF, [
  {
    id: 'number_registry_clear_prime_corridor',
    giverNpcId: 'number_registry_prime_guard',
    type: QuestType.KILL,
    desc: 'Федор Простой: «Убей параграф в простом коридоре. Потом бери короткий ход, пока бумага не начала шевелиться.»',
    targetMonsterKind: MonsterKind.PARAGRAPH,
    killNeeded: 1,
    targetFloor: NUMBER_REGISTRY_BASE_FLOOR,
    targetRoute: ROUTE_TARGET,
    targetRoomName: 'Простой рискованный коридор',
    targetHint: 'Числовой реестр: короткий верхний коридор с красными отметками и печатеедами.',
    rewardItem: 'forged_stamp_sheet',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 10,
    xpReward: 90,
    moneyReward: 60,
    eventTargetName: 'Простой коридор Числового реестра временно очищен.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: ['number_registry', 'prime_corridor', 'combat', 'documents'],
    eventData: { routeId: NUMBER_REGISTRY_ROUTE_ID, decision: 'prime_risky_corridor' },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'number_registry_composite_witness', COMPOSITE_DEF, [
  {
    id: 'number_registry_file_composite_path',
    giverNpcId: 'number_registry_composite_witness',
    type: QuestType.FETCH,
    desc: 'Семен Составной: «Принеси бланк в публичный обход. Очередь длинная, зато с печатью и без простого коридора.»',
    targetItem: 'blank_form',
    targetCount: 1,
    targetFloor: NUMBER_REGISTRY_BASE_FLOOR,
    targetRoute: ROUTE_TARGET,
    targetRoomName: 'Составной публичный обход',
    targetHint: 'Числовой реестр: нижний коридор с лавками и свидетелями.',
    rewardItem: 'official_permit_slip',
    rewardCount: 1,
    extraRewards: [{ defId: 'passport_stub', count: 1 }],
    relationDelta: 8,
    xpReward: 60,
    moneyReward: 35,
    eventTargetName: 'Составной обход Числового реестра оформлен через свидетелей.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: ['number_registry', 'composite_path', 'public_queue', 'documents'],
    eventData: { routeId: NUMBER_REGISTRY_ROUTE_ID, decision: 'composite_public_path' },
  },
]);

function fillDefaultTextures(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.cells[i] = Cell.WALL;
    world.roomMap[i] = -1;
    world.wallTex[i] = Tex.MARBLE;
    world.floorTex[i] = Tex.F_PARQUET;
    world.features[i] = Feature.NONE;
    world.fog[i] = 0;
  }
}

function setFloorCell(world: World, x: number, y: number, floorTex: Tex, wallTex = Tex.MARBLE): void {
  const idx = world.idx(x, y);
  if (world.hermoWall[idx] || world.aptMask[idx] || world.cells[idx] === Cell.LIFT) return;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.wallTex[idx] = wallTex;
}

function carveFloorRect(world: World, x: number, y: number, w: number, h: number, floorTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) setFloorCell(world, x + dx, y + dy, floorTex);
  }
}

function carveH(world: World, x0: number, x1: number, y: number, floorTex: Tex): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a; x <= b; x++) setFloorCell(world, x, y, floorTex);
}

function carveV(world: World, x: number, y0: number, y1: number, floorTex: Tex): void {
  const a = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  for (let y = a; y <= b; y++) setFloorCell(world, x, y, floorTex);
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR) world.features[idx] = feature;
}

function stampRegistryRoom(
  world: World,
  id: number,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): Room {
  const room = stampRoom(world, id, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.WALL) world.wallTex[idx] = wallTex;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) world.floorTex[idx] = floorTex;
    }
  }
  return room;
}

function addDoor(
  world: World,
  room: Room | null,
  x: number,
  y: number,
  state = DoorState.CLOSED,
  keyId = '',
  wallTex = Tex.DOOR_WOOD,
): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = room?.id ?? -1;
  world.wallTex[idx] = wallTex;
  world.doors.set(idx, {
    idx,
    state,
    roomA: room?.id ?? -1,
    roomB: -1,
    keyId,
    timer: 0,
  });
  if (room && !room.doors.includes(idx)) room.doors.push(idx);
}

function placeLiftCell(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.roomMap[idx] = -1;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.liftDir[idx] = direction;
  const buttonIdx = world.idx(buttonX, buttonY);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function addRegistryContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: { id: number; name: string; faction: Faction },
): void {
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: NUMBER_REGISTRY_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: Math.max(8, inventory.length + 2),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction ?? Faction.CITIZEN,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: access !== 'secret',
    tags: ['number_registry', ...tags],
  });
}

function spawnNpc(
  entities: Entity[],
  nextId: NextId,
  _def: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  weapon?: string,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    canGiveQuest: true,
    weapon,
    aiTarget: { x, y },
    isTraveler: false,
  });
  return npc.id;
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const idx = world.idx(x, y);
  const zone = world.zones[world.zoneMap[idx]];
  const level = Math.max(3, zone?.level ?? 3);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    hp: scaleMonsterHp(def.hp, level),
    maxHp: scaleMonsterHp(def.hp, level),
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function decorateRegistryRooms(world: World, rooms: Record<string, Room>): void {
  const hub = rooms.hub;
  for (let dx = 4; dx < hub.w - 4; dx += 4) {
    setFeature(world, hub.x + dx, hub.y + 5, Feature.DESK);
    setFeature(world, hub.x + dx, hub.y + 7, Feature.CHAIR);
  }
  for (let dx = 6; dx < hub.w - 6; dx += 9) setFeature(world, hub.x + dx, hub.y + hub.h - 4, Feature.SCREEN);
  setFeature(world, hub.x + 3, hub.y + 3, Feature.LAMP);
  setFeature(world, hub.x + hub.w - 4, hub.y + 3, Feature.LAMP);

  for (const room of [rooms.mod5, rooms.mod7, rooms.mod11]) {
    for (let dx = 3; dx < room.w - 3; dx += 4) setFeature(world, room.x + dx, room.y + 3, Feature.DESK);
    for (let dx = 4; dx < room.w - 4; dx += 5) setFeature(world, room.x + dx, room.y + 6, Feature.SCREEN);
    setFeature(world, room.x + 2, room.y + 2, Feature.LAMP);
  }

  const prime = rooms.prime;
  for (let dx = 4; dx < prime.w - 4; dx += 11) {
    setFeature(world, prime.x + dx, prime.y + 2, Feature.SCREEN);
    setFeature(world, prime.x + dx + 2, prime.y + prime.h - 3, Feature.SHELF);
  }

  const composite = rooms.composite;
  for (let dx = 5; dx < composite.w - 5; dx += 7) {
    setFeature(world, composite.x + dx, composite.y + 4, Feature.CHAIR);
    setFeature(world, composite.x + dx, composite.y + 7, Feature.TABLE);
  }

  const crt = rooms.crt;
  for (let dy = 3; dy < crt.h - 3; dy += 3) {
    setFeature(world, crt.x + 2, crt.y + dy, Feature.SHELF);
    setFeature(world, crt.x + crt.w - 3, crt.y + dy, Feature.SHELF);
  }
  setFeature(world, crt.x + Math.floor(crt.w / 2), crt.y + 3, Feature.SCREEN);
}

interface RegistryBlockSpec {
  key: string;
  owner: TerritoryOwner;
  name: string;
  left: number;
  top: number;
  cols: number;
  rows: number;
  roomW: number;
  roomH: number;
  gapX: number;
  gapY: number;
  floorTex: Tex;
  wallTex: Tex;
  roomTypes: readonly RoomType[];
}

interface RegistryHqSpec {
  owner: TerritoryOwner;
  coreName: string;
  supportPrefix: string;
  x: number;
  y: number;
  floorTex: Tex;
  wallTex: Tex;
  supports: readonly { type: RoomType; name: string; dx: number; dy: number; w: number; h: number }[];
}

const NUMBER_REGISTRY_HQ_SPECS: readonly RegistryHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    coreName: 'граждане: Миништаб общей очереди',
    supportPrefix: 'граждане',
    x: 158,
    y: 510,
    floorTex: Tex.F_PARQUET,
    wallTex: Tex.PANEL,
    supports: [
      { type: RoomType.KITCHEN, name: 'кухня талонной очереди', dx: -36, dy: -28, w: 24, h: 14 },
      { type: RoomType.BATHROOM, name: 'санузел публичных ожиданий', dx: 32, dy: -26, w: 20, h: 12 },
      { type: RoomType.STORAGE, name: 'кладовая чистых бланков', dx: -38, dy: 30, w: 26, h: 14 },
      { type: RoomType.MEDICAL, name: 'медпункт обморочных просителей', dx: 34, dy: 30, w: 26, h: 14 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    coreName: 'ликвидаторы: Пост простого допуска',
    supportPrefix: 'ликвидаторы',
    x: 522,
    y: 220,
    floorTex: Tex.F_RED_CARPET,
    wallTex: Tex.METAL,
    supports: [
      { type: RoomType.STORAGE, name: 'оружейная простых номеров', dx: -38, dy: -26, w: 26, h: 14 },
      { type: RoomType.OFFICE, name: 'комната проверки делимости', dx: 34, dy: -26, w: 30, h: 14 },
      { type: RoomType.MEDICAL, name: 'перевязочная бумажных порезов', dx: -38, dy: 30, w: 26, h: 14 },
      { type: RoomType.PRODUCTION, name: 'мастерская пломбировочных щитов', dx: 34, dy: 30, w: 30, h: 14 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    coreName: 'культисты: Скрытая молельня неделимых',
    supportPrefix: 'культисты',
    x: 172,
    y: 230,
    floorTex: Tex.F_RED_CARPET,
    wallTex: Tex.DARK,
    supports: [
      { type: RoomType.COMMON, name: 'зал шепота простых чисел', dx: -38, dy: -28, w: 28, h: 14 },
      { type: RoomType.STORAGE, name: 'тайник списанных делителей', dx: 34, dy: -26, w: 24, h: 12 },
      { type: RoomType.SMOKING, name: 'курилка знамений остатка', dx: -36, dy: 30, w: 24, h: 12 },
      { type: RoomType.BATHROOM, name: 'омовение перед делением', dx: 34, dy: 30, w: 24, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    coreName: 'учёные: НИИ числовых остатков',
    supportPrefix: 'учёные',
    x: 720,
    y: 646,
    floorTex: Tex.F_TILE,
    wallTex: Tex.TILE_W,
    supports: [
      { type: RoomType.MEDICAL, name: 'лаборатория остаточных проб', dx: -42, dy: -30, w: 32, h: 16 },
      { type: RoomType.PRODUCTION, name: 'вычислительная мастерская модулей', dx: 34, dy: -30, w: 34, h: 16 },
      { type: RoomType.OFFICE, name: 'кабинет статистики ошибок', dx: -42, dy: 32, w: 32, h: 16 },
      { type: RoomType.STORAGE, name: 'хранилище эталонных таблиц', dx: 36, dy: 32, w: 30, h: 16 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    coreName: 'дикие: Лагерь списанных чисел',
    supportPrefix: 'дикие',
    x: 166,
    y: 804,
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.ROTTEN,
    supports: [
      { type: RoomType.STORAGE, name: 'склад рваных ведомостей', dx: -38, dy: -28, w: 28, h: 14 },
      { type: RoomType.SMOKING, name: 'курилка чужих номеров', dx: 34, dy: -26, w: 24, h: 12 },
      { type: RoomType.KITCHEN, name: 'кухня сухих пайков', dx: -36, dy: 30, w: 24, h: 14 },
      { type: RoomType.BATHROOM, name: 'ржавый умывальник лагеря', dx: 34, dy: 30, w: 22, h: 12 },
    ],
  },
];

const NUMBER_REGISTRY_BLOCKS: readonly RegistryBlockSpec[] = [
  { key: 'citizen_west_queue', owner: ZoneFaction.CITIZEN, name: 'граждане: публичная ячейка остатка', left: 68, top: 378, cols: 7, rows: 7, roomW: 18, roomH: 10, gapX: 10, gapY: 10, floorTex: Tex.F_PARQUET, wallTex: Tex.PANEL, roomTypes: [RoomType.OFFICE, RoomType.COMMON, RoomType.STORAGE, RoomType.KITCHEN] },
  { key: 'citizen_south_forms', owner: ZoneFaction.CITIZEN, name: 'граждане: нижняя очередь корешков', left: 316, top: 740, cols: 8, rows: 6, roomW: 17, roomH: 10, gapX: 9, gapY: 10, floorTex: Tex.F_GREEN_CARPET, wallTex: Tex.PANEL, roomTypes: [RoomType.COMMON, RoomType.OFFICE, RoomType.STORAGE] },
  { key: 'liquidator_prime_gate', owner: ZoneFaction.LIQUIDATOR, name: 'ликвидаторы: блок простого допуска', left: 378, top: 142, cols: 7, rows: 6, roomW: 18, roomH: 10, gapX: 10, gapY: 9, floorTex: Tex.F_RED_CARPET, wallTex: Tex.METAL, roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.HQ, RoomType.PRODUCTION] },
  { key: 'liquidator_east_posts', owner: ZoneFaction.LIQUIDATOR, name: 'ликвидаторы: восточный пост делимости', left: 800, top: 374, cols: 5, rows: 7, roomW: 18, roomH: 10, gapX: 10, gapY: 10, floorTex: Tex.F_CONCRETE, wallTex: Tex.METAL, roomTypes: [RoomType.STORAGE, RoomType.OFFICE, RoomType.CORRIDOR] },
  { key: 'cultist_hidden_numerator', owner: ZoneFaction.CULTIST, name: 'культисты: скрытая числительская келья', left: 78, top: 128, cols: 7, rows: 6, roomW: 17, roomH: 10, gapX: 9, gapY: 9, floorTex: Tex.F_RED_CARPET, wallTex: Tex.DARK, roomTypes: [RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING] },
  { key: 'wild_scrap_register', owner: ZoneFaction.WILD, name: 'дикие: списанная карточная нора', left: 86, top: 700, cols: 7, rows: 6, roomW: 17, roomH: 10, gapX: 10, gapY: 10, floorTex: Tex.F_CONCRETE, wallTex: Tex.ROTTEN, roomTypes: [RoomType.STORAGE, RoomType.SMOKING, RoomType.CORRIDOR] },
  { key: 'scientist_upper_archive', owner: ZoneFaction.SCIENTIST, name: 'учёные: верхняя лаборатория модулей', left: 636, top: 172, cols: 8, rows: 7, roomW: 18, roomH: 10, gapX: 9, gapY: 9, floorTex: Tex.F_TILE, wallTex: Tex.TILE_W, roomTypes: [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.OFFICE, RoomType.STORAGE] },
  { key: 'scientist_lower_archive', owner: ZoneFaction.SCIENTIST, name: 'учёные: нижний архив остатков', left: 612, top: 600, cols: 8, rows: 7, roomW: 18, roomH: 10, gapX: 9, gapY: 10, floorTex: Tex.F_MARBLE_TILE, wallTex: Tex.MARBLE, roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.PRODUCTION, RoomType.MEDICAL] },
  { key: 'scientist_center_tables', owner: ZoneFaction.SCIENTIST, name: 'учёные: таблица китайских пересечений', left: 300, top: 306, cols: 6, rows: 5, roomW: 17, roomH: 10, gapX: 10, gapY: 10, floorTex: Tex.F_MARBLE_TILE, wallTex: Tex.MARBLE, roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON] },
];

function canStampRegistryRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT) return false;
      if (world.roomMap[idx] >= 0 || world.doors.has(idx) || world.containerMap.has(idx)) return false;
    }
  }
  return true;
}

function tryStampRegistryRoom(
  world: World,
  id: number,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex: Tex,
): Room | null {
  if (!canStampRegistryRoom(world, x, y, w, h)) return null;
  return stampRegistryRoom(world, id, type, name, x, y, w, h, floorTex, wallTex);
}

function carveHWidth(world: World, x0: number, x1: number, y: number, width: number, floorTex: Tex, wallTex = Tex.MARBLE): void {
  const half = Math.max(0, Math.floor(width / 2));
  for (let oy = -half; oy <= half; oy++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) setFloorCell(world, x, y + oy, floorTex, wallTex);
  }
}

function carveVWidth(world: World, x: number, y0: number, y1: number, width: number, floorTex: Tex, wallTex = Tex.MARBLE): void {
  const half = Math.max(0, Math.floor(width / 2));
  for (let ox = -half; ox <= half; ox++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) setFloorCell(world, x + ox, y, floorTex, wallTex);
  }
}

function carveOrthogonalWidth(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex, wallTex = Tex.MARBLE): void {
  carveHWidth(world, ax, bx, ay, width, floorTex, wallTex);
  carveVWidth(world, bx, ay, by, width, floorTex, wallTex);
}

function addRoomDoor(
  world: World,
  room: Room,
  side: 'north' | 'south' | 'west' | 'east',
  offset: number,
  state = DoorState.CLOSED,
  keyId = '',
  wallTex = Tex.DOOR_WOOD,
): void {
  let x = room.x;
  let y = room.y;
  let ox = room.x;
  let oy = room.y;
  if (side === 'north') {
    x += Math.max(1, Math.min(room.w - 2, offset));
    y -= 1;
    ox = x;
    oy = y - 1;
  } else if (side === 'south') {
    x += Math.max(1, Math.min(room.w - 2, offset));
    y += room.h;
    ox = x;
    oy = y + 1;
  } else if (side === 'west') {
    x -= 1;
    y += Math.max(1, Math.min(room.h - 2, offset));
    ox = x - 1;
    oy = y;
  } else {
    x += room.w;
    y += Math.max(1, Math.min(room.h - 2, offset));
    ox = x + 1;
    oy = y;
  }
  setFloorCell(world, ox, oy, room.floorTex, room.wallTex);
  addDoor(world, room, x, y, state, keyId, wallTex);
  world.hermoWall[world.idx(x, y)] = 0;
}

function decorateMicroRegistryRoom(world: World, room: Room, serial: number): void {
  const type = room.type;
  const step = type === RoomType.STORAGE ? 3 : type === RoomType.PRODUCTION ? 4 : 5;
  for (let x = room.x + 2; x < room.x + room.w - 2; x += step) {
    const y = room.y + 2 + ((x + serial) % Math.max(1, room.h - 4));
    const feature = type === RoomType.STORAGE
      ? Feature.SHELF
      : type === RoomType.PRODUCTION
        ? Feature.MACHINE
        : type === RoomType.MEDICAL
          ? Feature.APPARATUS
          : type === RoomType.BATHROOM
            ? Feature.SINK
            : type === RoomType.KITCHEN
              ? Feature.STOVE
              : (serial + x) % 3 === 0 ? Feature.SCREEN : Feature.DESK;
    setFeature(world, x, y, feature);
  }
  if (room.w > 10 && room.h > 7) setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function hardenHqCore(world: World, room: Room): void {
  room.sealed = true;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] !== Cell.WALL) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function stampMiniHq(world: World, spec: RegistryHqSpec, nextRoomId: number): number {
  const core = tryStampRegistryRoom(world, nextRoomId, RoomType.HQ, spec.coreName, spec.x, spec.y, 24, 18, spec.floorTex, spec.wallTex);
  if (!core) return nextRoomId;
  nextRoomId++;
  hardenHqCore(world, core);
  addRoomDoor(world, core, 'south', 12, DoorState.HERMETIC_CLOSED, '', Tex.DOOR_METAL);
  carveHWidth(world, core.x - 42, core.x + core.w + 48, core.y + core.h + 2, 3, spec.floorTex, spec.wallTex);
  carveVWidth(world, core.x + (core.w >> 1), core.y - 34, core.y + core.h + 46, 3, spec.floorTex, spec.wallTex);
  decorateMicroRegistryRoom(world, core, nextRoomId);

  for (let i = 0; i < spec.supports.length; i++) {
    const support = spec.supports[i];
    const room = tryStampRegistryRoom(
      world,
      nextRoomId,
      support.type,
      `${spec.supportPrefix}: ${support.name}`,
      spec.x + support.dx,
      spec.y + support.dy,
      support.w,
      support.h,
      spec.floorTex,
      spec.wallTex,
    );
    if (!room) continue;
    nextRoomId++;
    const side = support.dy < 0 ? 'south' : support.dx < 0 ? 'east' : 'west';
    addRoomDoor(world, room, side, side === 'south' ? room.w >> 1 : room.h >> 1);
    decorateMicroRegistryRoom(world, room, nextRoomId + i);
  }
  return nextRoomId;
}

function stampRegistryBlock(world: World, spec: RegistryBlockSpec, nextRoomId: number, rng: () => number): number {
  const blockRight = spec.left + spec.cols * (spec.roomW + spec.gapX);
  const blockBottom = spec.top + spec.rows * (spec.roomH + spec.gapY);
  for (let row = 0; row < spec.rows; row++) {
    const y = spec.top + row * (spec.roomH + spec.gapY);
    carveHWidth(world, spec.left - 6, blockRight + 6, y - 3, 3, spec.floorTex, spec.wallTex);
  }
  carveHWidth(world, spec.left - 6, blockRight + 6, blockBottom + 3, 3, spec.floorTex, spec.wallTex);
  for (let col = 0; col <= spec.cols; col++) {
    const x = spec.left + col * (spec.roomW + spec.gapX) - 5;
    carveVWidth(world, x, spec.top - 8, blockBottom + 8, 3, spec.floorTex, spec.wallTex);
  }

  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const serial = row * spec.cols + col;
      const x = spec.left + col * (spec.roomW + spec.gapX) + (rng() < 0.5 ? 0 : 1);
      const y = spec.top + row * (spec.roomH + spec.gapY);
      const roomType = spec.roomTypes[serial % spec.roomTypes.length];
      const room = tryStampRegistryRoom(
        world,
        nextRoomId,
        roomType,
        `${spec.name} ${serial + 1}`,
        x,
        y,
        spec.roomW + (serial % 3 === 0 ? 2 : 0),
        spec.roomH + (serial % 4 === 0 ? 2 : 0),
        spec.floorTex,
        spec.wallTex,
      );
      if (!room) continue;
      nextRoomId++;
      addRoomDoor(world, room, 'north', room.w >> 1);
      if ((serial + spec.key.length) % 5 === 0) addRoomDoor(world, room, 'east', room.h >> 1);
      decorateMicroRegistryRoom(world, room, serial);
    }
  }

  carveOrthogonalWidth(world, spec.left + ((blockRight - spec.left) >> 1), spec.top - 3, W >> 1, W >> 1, 3, spec.floorTex, spec.wallTex);
  return nextRoomId;
}

function carveRegistryQueueCourt(world: World, x: number, y: number, w: number, h: number, floorTex: Tex, wallTex: Tex, feature: Feature): void {
  carveFloorRect(world, x, y, w, h, floorTex);
  for (let yy = y + 5; yy < y + h - 4; yy += 10) {
    carveHWidth(world, x + 4, x + w - 5, yy, 1, floorTex, wallTex);
    for (let xx = x + 8; xx < x + w - 8; xx += 14) {
      setFeature(world, xx, yy, feature);
      if ((xx + yy) % 3 === 0) setFeature(world, xx + 2, yy + 2, Feature.CHAIR);
    }
  }
  for (let xx = x + 10; xx < x + w - 10; xx += 24) {
    setFloorCell(world, xx, y - 1, floorTex, wallTex);
    setFloorCell(world, xx, y + h, floorTex, wallTex);
  }
}

function retuneZoneMap(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
    const primeBand = Math.abs(zone.cy - 466) <= 76 && zone.cx >= 520 && zone.cx <= 850;
    const compositeBand = Math.abs(zone.cy - 566) <= 84 && zone.cx >= 520 && zone.cx <= 870;
    const residueLanes = RESIDUE_LANES.some(lane => {
      const v = lane.axis === 'x' ? zone.cx : zone.cy;
      return v % lane.modulus === lane.residue && (v % 64 <= 7 || v % 64 >= 57);
    });
    zone.level = Math.max(2, Math.min(5, Math.round(2 + d / 360)));
    zone.faction = ZoneFaction.CITIZEN;
    if (primeBand) {
      zone.faction = zone.id % 3 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
      zone.level = Math.max(zone.level, 4);
    } else if (compositeBand) {
      zone.faction = zone.id % 4 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
      zone.level = Math.max(zone.level, 3);
    } else if (residueLanes) {
      zone.faction = zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    }
    zone.fogged = false;
  }
  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? ZoneFaction.CITIZEN;
  }
}

export function retuneNumberRegistryZones(world: World): void {
  retuneZoneMap(world);
  applyNumberRegistryTerritory(world);
  syncZoneMetadataFromTerritory(world);
}

function isNumberRegistryAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function numberRegistryTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const target of NUMBER_REGISTRY_TERRITORY_TARGETS) cells.set(target.owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = world.factionControl[i] as TerritoryOwner;
    const list = cells.get(owner);
    if (!list) continue;
    list.push(i);
  }
  return cells;
}

export function alignNumberRegistryAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = numberRegistryTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isNumberRegistryAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 97 + offset * 389) % list.length];
    entity.x = (cell % W) + 0.5;
    entity.y = ((cell / W) | 0) + 0.5;
    entity.assignedRoomId = world.roomMap[cell] >= 0 ? world.roomMap[cell] : -1;
    if (entity.ai) {
      entity.ai.tx = cell % W;
      entity.ai.ty = (cell / W) | 0;
      entity.ai.path = [];
      entity.ai.pi = 0;
      entity.ai.stuck = 0;
    }
  }
}

function targetIndexForOwner(owner: TerritoryOwner): number {
  const index = NUMBER_REGISTRY_TERRITORY_TARGETS.findIndex(target => target.owner === owner);
  return index >= 0 ? index : 0;
}

function roomNameOwnerHint(room: Room): TerritoryOwner | undefined {
  for (const target of NUMBER_REGISTRY_TERRITORY_TARGETS) {
    if (room.name.startsWith(`${target.label}:`)) return target.owner;
  }
  return undefined;
}

function ownerControlAnchors(owner: TerritoryOwner): readonly { x: number; y: number; weight: number }[] {
  switch (owner) {
    case ZoneFaction.CITIZEN:
      return [
        { x: 170, y: 520, weight: 1.0 },
        { x: 402, y: 788, weight: 0.92 },
        { x: 246, y: 410, weight: 0.84 },
      ];
    case ZoneFaction.LIQUIDATOR:
      return [
        { x: 534, y: 228, weight: 1.05 },
        { x: 852, y: 426, weight: 0.88 },
        { x: 712, y: 326, weight: 0.76 },
      ];
    case ZoneFaction.CULTIST:
      return [
        { x: 184, y: 238, weight: 1.0 },
        { x: 302, y: 306, weight: 0.78 },
      ];
    case ZoneFaction.SCIENTIST:
      return [
        { x: 732, y: 654, weight: 1.08 },
        { x: 706, y: 240, weight: 0.98 },
        { x: 820, y: 486, weight: 0.9 },
        { x: 424, y: 386, weight: 0.7 },
      ];
    case ZoneFaction.WILD:
      return [
        { x: 178, y: 812, weight: 1.0 },
        { x: 92, y: 636, weight: 0.76 },
      ];
    default:
      return [{ x: W >> 1, y: W >> 1, weight: 1.0 }];
  }
}

function chunkyTerritoryNoise(x: number, y: number, salt: number): number {
  let n = Math.imul((x >> 5) + 0x9e37 + salt * 37, 0x85ebca6b);
  n ^= Math.imul((y >> 5) + 0xc2b2 + salt * 53, 0x27d4eb2d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x2c1b3c6d);
  n ^= n >>> 12;
  return ((n >>> 0) / 0xffffffff) - 0.5;
}

function territoryScore(world: World, x: number, y: number, target: RegistryTerritoryTarget, bias: number, salt: number): number {
  let best = -Infinity;
  for (const anchor of ownerControlAnchors(target.owner)) {
    const d2 = world.dist2(x, y, anchor.x, anchor.y);
    const score = anchor.weight - d2 / (270 * 270);
    if (score > best) best = score;
  }
  const idx = world.idx(x, y);
  const roomId = world.roomMap[idx];
  if (roomId >= 0) {
    const room = world.rooms[roomId];
    const hinted = room ? roomNameOwnerHint(room) : undefined;
    if (hinted === target.owner) best += 0.9;
  }
  return best + bias + chunkyTerritoryNoise(x, y, salt) * 0.09;
}

function assignNumberRegistryTerritory(world: World, biases: Float64Array, counts?: Uint32Array): void {
  if (counts) counts.fill(0);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < NUMBER_REGISTRY_TERRITORY_TARGETS.length; i++) {
        const target = NUMBER_REGISTRY_TERRITORY_TARGETS[i];
        const score = territoryScore(world, x, y, target, biases[i] ?? 0, i + 1);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const owner = NUMBER_REGISTRY_TERRITORY_TARGETS[bestIndex].owner;
      world.factionControl[world.idx(x, y)] = owner;
      if (counts) counts[bestIndex]++;
    }
  }
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[idx]) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function reinforceNamedRoomTerritory(world: World): void {
  for (const room of world.rooms) {
    if (!room) continue;
    const hinted = roomNameOwnerHint(room);
    if (hinted !== undefined) paintRoomTerritory(world, room, hinted);
  }
}

function applyNumberRegistryTerritory(world: World): void {
  const biases = new Float64Array(NUMBER_REGISTRY_TERRITORY_TARGETS.length);
  const counts = new Uint32Array(NUMBER_REGISTRY_TERRITORY_TARGETS.length);
  const total = W * W;
  for (let pass = 0; pass < 7; pass++) {
    assignNumberRegistryTerritory(world, biases, counts);
    for (let i = 0; i < NUMBER_REGISTRY_TERRITORY_TARGETS.length; i++) {
      const share = counts[i] / total;
      biases[i] += (NUMBER_REGISTRY_TERRITORY_TARGETS[i].share - share) * 2.4;
    }
  }
  assignNumberRegistryTerritory(world, biases);
  reinforceNamedRoomTerritory(world);
  for (const target of NUMBER_REGISTRY_TERRITORY_TARGETS) {
    const i = targetIndexForOwner(target.owner);
    const hq = NUMBER_REGISTRY_HQ_SPECS.find(spec => spec.owner === target.owner);
    if (!hq) continue;
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        if (dx * dx + dy * dy > 56) continue;
        const idx = world.idx(target.hq.x + dx, target.hq.y + dy);
        world.factionControl[idx] = NUMBER_REGISTRY_TERRITORY_TARGETS[i].owner;
      }
    }
  }
}

function registerNumberRegistryRouteCues(world: World, rooms: Record<string, Room>): void {
  registerRouteCue(world, {
    id: 'number_registry_prime_corridor',
    x: rooms.hub.x + rooms.hub.w - 3.5,
    y: rooms.hub.y + 9.5,
    targetX: rooms.prime.x + rooms.prime.w - 6.5,
    targetY: rooms.prime.y + 5.5,
    floor: NUMBER_REGISTRY_BASE_FLOOR,
    roomId: rooms.hub.id,
    targetRoomId: rooms.prime.id,
    zoneId: world.zoneMap[world.idx(rooms.hub.x + rooms.hub.w - 4, rooms.hub.y + 9)],
    label: 'простой короткий ход',
    hint: 'остатки сходятся в короткий коридор с бумажным шумом',
    targetName: 'Простой рискованный коридор',
    color: '#ffb35c',
    tags: ['number_registry', 'prime_corridor', 'warning', 'documents'],
    toneSeed: 240017,
    radius: 9,
    targetRadius: 4,
    cooldownSec: 28,
    heardText: 'Табло остатков щелкает: простой коридор короче, но за ним шуршит живая бумага.',
    followedText: 'Простой ход выбран. Держи оружие выше бланков и не стой у полок.',
    ignoredText: 'Простой коридор остался сбоку. Очередь длиннее, зато не стреляет печатями.',
    routeGroup: {
      id: 'number_registry_choice',
      lead: 'Числовой реестр делит маршрут на остатки.',
      risk: 'Простой коридор короткий и опасный.',
      decision: 'идти простым риском или составной очередью',
      reward: 'короткий доступ к пересечной картотеке',
      mapLabel: 'числовой выбор',
      mapHint: 'простой риск / составной обход',
    },
  });

  registerRouteCue(world, {
    id: 'number_registry_composite_path',
    x: rooms.hub.x + rooms.hub.w - 3.5,
    y: rooms.hub.y + rooms.hub.h - 8.5,
    targetX: rooms.composite.x + rooms.composite.w - 7.5,
    targetY: rooms.composite.y + 9.5,
    floor: NUMBER_REGISTRY_BASE_FLOOR,
    roomId: rooms.hub.id,
    targetRoomId: rooms.composite.id,
    zoneId: world.zoneMap[world.idx(rooms.hub.x + rooms.hub.w - 4, rooms.hub.y + rooms.hub.h - 8)],
    label: 'составной публичный обход',
    hint: 'нижний путь через очередь, бланк и свидетеля',
    targetName: 'Составной публичный обход',
    color: '#ffe082',
    tags: ['number_registry', 'composite_path', 'public_queue', 'documents'],
    toneSeed: 240071,
    radius: 9,
    targetRadius: 4,
    cooldownSec: 28,
    heardText: 'Снизу гудит очередь: составной обход длинный, но оформленный.',
    followedText: 'Составной обход выбран. Покажи бланк у окна и не лезь в простой коридор.',
    ignoredText: 'Публичный обход остался позади. Без свидетелей спорить придется с коридором.',
  });
}

function residuePositions(lane: ResidueLane): number[] {
  const out: number[] = [];
  const base = lane.modulus === 5 ? 18 : lane.modulus === 7 ? 12 : 8;
  const step = lane.modulus === 5 ? 37 : lane.modulus === 7 ? 28 : 17;
  for (let n = 0; n < 6; n++) {
    const v = lane.residue + lane.modulus * (base + n * step);
    if (v > 24 && v < W - 24) out.push(v);
  }
  return out;
}

function carveResidueLattice(world: World): void {
  for (const lane of RESIDUE_LANES) {
    const positions = residuePositions(lane);
    for (const pos of positions) {
      if (lane.axis === 'x') {
        for (let y = 0; y < W; y++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = world.idx(pos + dx, y);
            if (world.roomMap[idx] >= 0) continue;
            setFloorCell(world, pos + dx, y, Tex.F_MARBLE_TILE);
          }
        }
      } else {
        for (let x = 0; x < W; x++) {
          for (let dy = -1; dy <= 1; dy++) {
            const idx = world.idx(x, pos + dy);
            if (world.roomMap[idx] >= 0) continue;
            setFloorCell(world, x, pos + dy, Tex.F_PARQUET);
          }
        }
      }
    }
  }
}

function carvePrimeGapCorridor(world: World): number {
  const primes = [101, 107, 113, 127, 131, 137, 149, 157, 163, 173, 179, 191, 193, 197, 199, 211, 223, 227, 229, 233];
  let y = 338;
  let turns = 0;
  let lastX = 96;
  for (let i = 0; i < primes.length; i++) {
    const x = 96 + ((primes[i] * 7) % 812);
    carveHWidth(world, lastX, x, y, 3, Tex.F_RED_CARPET, Tex.METAL);
    const gap = i === 0 ? 6 : primes[i] - primes[i - 1];
    const nextY = Math.max(300, Math.min(466, y + (gap % 3 === 0 ? 17 : gap % 4 === 0 ? -13 : 9)));
    carveVWidth(world, x, y, nextY, 3, Tex.F_RED_CARPET, Tex.METAL);
    if (nextY !== y) turns++;
    y = nextY;
    lastX = x;
  }
  carveHWidth(world, lastX, 866, y, 3, Tex.F_RED_CARPET, Tex.METAL);
  return turns;
}

function tryStampMacroRoom(
  world: World,
  id: number,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
): Room | null {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return null;
  const room = tryStampRegistryRoom(world, id, type, name, x, y, w, h, Tex.F_MARBLE_TILE, Tex.MARBLE);
  if (!room) return null;
  for (let dx = 3; dx < w - 3; dx += 5) setFeature(world, x + dx, y + 3, Feature.SCREEN);
  for (let dx = 4; dx < w - 4; dx += 6) setFeature(world, x + dx, y + h - 4, Feature.SHELF);
  addDoor(world, room, x + Math.floor(w / 2), y + h, DoorState.CLOSED, '', Tex.DOOR_WOOD);
  setFloorCell(world, x + Math.floor(w / 2), y + h + 1, Tex.F_MARBLE_TILE);
  return room;
}

export function expandNumberRegistryGeometry(world: World, rng: () => number): void {
  carveResidueLattice(world);
  carveRegistryQueueCourt(world, 356, 418, 232, 72, Tex.F_PARQUET, Tex.MARBLE, Feature.DESK);
  carveRegistryQueueCourt(world, 524, 584, 188, 62, Tex.F_GREEN_CARPET, Tex.PANEL, Feature.CHAIR);
  carveRegistryQueueCourt(world, 238, 620, 180, 58, Tex.F_MARBLE_TILE, Tex.MARBLE, Feature.SHELF);
  carveHWidth(world, 84, 938, 512, 5, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveVWidth(world, 512, 92, 932, 5, Tex.F_PARQUET, Tex.MARBLE);
  carveHWidth(world, 100, 926, 690, 3, Tex.F_GREEN_CARPET, Tex.PANEL);
  carveVWidth(world, 704, 124, 884, 3, Tex.F_TILE, Tex.TILE_W);

  let nextRoom = world.rooms.length;
  while (world.rooms[nextRoom]) nextRoom++;
  for (const spec of NUMBER_REGISTRY_HQ_SPECS) nextRoom = stampMiniHq(world, spec, nextRoom);
  for (const spec of NUMBER_REGISTRY_BLOCKS) nextRoom = stampRegistryBlock(world, spec, nextRoom, rng);

  const primeTurns = carvePrimeGapCorridor(world);
  while (world.rooms[nextRoom]) nextRoom++;
  const points = [
    { x: 166, y: 254, name: `Пересечение остатков ${NUMBER_REGISTRY_CRT_INTERSECTIONS[0].label}` },
    { x: 642, y: 258, name: `Пересечение остатков ${NUMBER_REGISTRY_CRT_INTERSECTIONS[1].label}` },
    { x: 268, y: 742, name: `Пересечение остатков ${NUMBER_REGISTRY_CRT_INTERSECTIONS[2].label}` },
    { x: 746, y: 742, name: 'Сверочная комната составных корешков' },
  ];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const roomId = nextRoom;
    const room = tryStampMacroRoom(
      world,
      roomId,
      i === 3 ? RoomType.COMMON : RoomType.STORAGE,
      p.x + Math.floor(rng() * 9) - 4,
      p.y + Math.floor(rng() * 9) - 4,
      i === 3 ? 34 : 28,
      i === 3 ? 18 : 16,
      p.name,
    );
    if (!room) continue;
    nextRoom++;
    const cX = room.x + Math.floor(room.w / 2);
    const cY = room.y + Math.floor(room.h / 2);
    carveH(world, cX, W >> 1, cY, Tex.F_MARBLE_TILE);
    carveV(world, W >> 1, cY, W >> 1, Tex.F_MARBLE_TILE);
  }
  for (let x = 90; x <= 930; x += 37) {
    const y = 337 + ((x * 13 + primeTurns * 7) % 126);
    if (world.cells[world.idx(x, y)] === Cell.FLOOR) world.features[world.idx(x, y)] = x % 2 === 0 ? Feature.SCREEN : Feature.SHELF;
  }
  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function carveNumberRegistryCorridors(world: World, rooms: Record<string, Room>): void {
  carveH(world, rooms.mod5.x + rooms.mod5.w, rooms.hub.x - 1, rooms.mod5.y + 9, Tex.F_PARQUET);
  carveH(world, rooms.mod7.x + rooms.mod7.w, rooms.hub.x - 1, rooms.mod7.y + 8, Tex.F_GREEN_CARPET);
  carveH(world, rooms.hub.x + rooms.hub.w, rooms.prime.x - 1, rooms.prime.y + 9, Tex.F_RED_CARPET);
  carveH(world, rooms.hub.x + rooms.hub.w, rooms.composite.x - 1, rooms.composite.y + 12, Tex.F_GREEN_CARPET);
  carveH(world, rooms.prime.x + rooms.prime.w, rooms.crt.x - 1, rooms.prime.y + 9, Tex.F_RED_CARPET);
  carveV(world, rooms.crt.x + 12, rooms.prime.y + 9, rooms.crt.y - 1, Tex.F_RED_CARPET);
  carveH(world, rooms.composite.x + rooms.composite.w, rooms.crt.x - 1, rooms.composite.y + 12, Tex.F_GREEN_CARPET);
  carveV(world, rooms.crt.x + 10, rooms.crt.y + rooms.crt.h, rooms.safe.y + 7, Tex.F_MARBLE_TILE);
  carveH(world, rooms.crt.x + rooms.crt.w, rooms.safe.x - 1, rooms.safe.y + 9, Tex.F_MARBLE_TILE);
  carveFloorRect(world, 476, 510, 4, 4, Tex.F_PARQUET);
  carveFloorRect(world, 544, 509, 12, 3, Tex.F_RED_CARPET);
  carveFloorRect(world, 544, 543, 12, 3, Tex.F_GREEN_CARPET);
}

function addNumberRegistryDoors(world: World, rooms: Record<string, Room>): void {
  addDoor(world, rooms.mod5, rooms.mod5.x + rooms.mod5.w, rooms.mod5.y + 9);
  addDoor(world, rooms.mod7, rooms.mod7.x + rooms.mod7.w, rooms.mod7.y + 8);
  addDoor(world, rooms.hub, rooms.hub.x - 1, rooms.mod5.y + 9);
  addDoor(world, rooms.hub, rooms.hub.x - 1, rooms.mod7.y + 8);
  addDoor(world, rooms.hub, rooms.hub.x + rooms.hub.w, rooms.prime.y + 9, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, rooms.hub, rooms.hub.x + rooms.hub.w, rooms.composite.y + 12);
  addDoor(world, rooms.prime, rooms.prime.x + rooms.prime.w, rooms.prime.y + 9, DoorState.LOCKED, 'key', Tex.DOOR_METAL);
  addDoor(world, rooms.composite, rooms.composite.x + rooms.composite.w, rooms.composite.y + 12);
  addDoor(world, rooms.crt, rooms.crt.x + rooms.crt.w, rooms.safe.y + 9, DoorState.LOCKED, 'archive_access_permit', Tex.DOOR_METAL);
}

function populateNumberRegistry(world: World, entities: Entity[], nextId: NextId, rooms: Record<string, Room>): void {
  const registrarId = spawnNpc(
    entities,
    nextId,
    REGISTRAR_DEF,
    'number_registry_vera_modulus',
    rooms.mod7.x + 5,
    rooms.mod7.y + 5,
  );
  const guardId = spawnNpc(
    entities,
    nextId,
    PRIME_GUARD_DEF,
    'number_registry_prime_guard',
    rooms.prime.x + 8,
    rooms.prime.y + 5,
    'makarov',
  );
  const compositeId = spawnNpc(
    entities,
    nextId,
    COMPOSITE_DEF,
    'number_registry_composite_witness',
    rooms.composite.x + 9,
    rooms.composite.y + 9,
  );

  spawnMonster(world, entities, nextId, MonsterKind.PARAGRAPH, rooms.prime.x + 42, rooms.prime.y + 7);
  spawnMonster(world, entities, nextId, MonsterKind.PECHATEED, rooms.prime.x + 67, rooms.prime.y + 6);
  spawnMonster(world, entities, nextId, MonsterKind.KONTORSHCHIK, rooms.safe.x + 11, rooms.safe.y + 8);

  addRegistryContainer(
    world,
    rooms.mod7,
    rooms.mod7.x + rooms.mod7.w - 4,
    rooms.mod7.y + 5,
    ContainerKind.CASHBOX,
    'Касса модуля 7',
    'owner',
    [
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'blank_form', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    ['modulus_bribe', 'decode', 'cashbox'],
    { id: registrarId, name: REGISTRAR_DEF.name, faction: Faction.CITIZEN },
  );
  addRegistryContainer(
    world,
    rooms.prime,
    rooms.prime.x + rooms.prime.w - 8,
    rooms.prime.y + 5,
    ContainerKind.FILING_CABINET,
    'Ящик простого коридора',
    'locked',
    [
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'denunciation', count: 1 },
      { defId: 'ammo_9mm', count: 6 },
    ],
    ['prime_corridor', 'risky_shortcut', 'theft'],
    { id: guardId, name: PRIME_GUARD_DEF.name, faction: Faction.LIQUIDATOR },
  );
  addRegistryContainer(
    world,
    rooms.composite,
    rooms.composite.x + rooms.composite.w - 9,
    rooms.composite.y + 8,
    ContainerKind.FILING_CABINET,
    'Составная папка публичного обхода',
    'public',
    [
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'ration_registry_extract', count: 1 },
      { defId: 'passport_stub', count: 1 },
    ],
    ['composite_path', 'public_queue', 'witnessed'],
    { id: compositeId, name: COMPOSITE_DEF.name, faction: Faction.CITIZEN },
  );
  addRegistryContainer(
    world,
    rooms.crt,
    rooms.crt.x + 8,
    rooms.crt.y + 7,
    ContainerKind.SAFE,
    'Пересечение китайских остатков',
    'locked',
    [
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'personal_file_copy', count: 1 },
      { defId: 'raionsovet_floor_pass', count: 1 },
    ],
    ['crt_intersection', 'residue_decode', 'locked_record'],
  );
}

export function generateNumberRegistryDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId: NextId = { v: 1 };
  let nextRoomId = 0;
  fillDefaultTextures(world);

  const rooms = {
    hub: stampRegistryRoom(world, nextRoomId++, RoomType.COMMON, 'Зал сверки остатков', 480, 492, 64, 38, Tex.F_PARQUET),
    mod5: stampRegistryRoom(world, nextRoomId++, RoomType.OFFICE, 'Окно остатка 2 mod 5', 430, 468, 36, 18, Tex.F_MARBLE_TILE),
    mod7: stampRegistryRoom(world, nextRoomId++, RoomType.OFFICE, 'Касса модуля 7', 430, 532, 36, 18, Tex.F_GREEN_CARPET),
    mod11: stampRegistryRoom(world, nextRoomId++, RoomType.OFFICE, 'Окно остатка 4 mod 11', 462, 562, 42, 18, Tex.F_MARBLE_TILE),
    prime: stampRegistryRoom(world, nextRoomId++, RoomType.CORRIDOR, 'Простой рискованный коридор', 556, 456, 94, 18, Tex.F_RED_CARPET),
    composite: stampRegistryRoom(world, nextRoomId++, RoomType.COMMON, 'Составной публичный обход', 556, 536, 102, 24, Tex.F_GREEN_CARPET),
    crt: stampRegistryRoom(world, nextRoomId++, RoomType.STORAGE, 'Китайская пересечная картотека', 674, 494, 42, 30, Tex.F_MARBLE_TILE),
    safe: stampRegistryRoom(world, nextRoomId++, RoomType.HQ, 'Сейф общего остатка', 724, 500, 24, 18, Tex.F_RED_CARPET),
  };

  carveNumberRegistryCorridors(world, rooms);
  addNumberRegistryDoors(world, rooms);

  placeLiftCell(world, 476, 512, 477, 512, LiftDirection.UP);
  placeLiftCell(world, 746, 509, 744, 509, LiftDirection.DOWN);

  decorateRegistryRooms(world, rooms);
  generateZones(world);
  retuneZoneMap(world);

  populateNumberRegistry(world, entities, nextId, rooms);

  registerNumberRegistryRouteCues(world, rooms);
  sanitizeDoors(world);
  ensureConnectivity(world, rooms.hub.x + 8, rooms.hub.y + 20);
  world.rebuildContainerMap();
  world.bakeLights();

  return {
    world,
    entities,
    spawnX: rooms.hub.x + 8.5,
    spawnY: rooms.hub.y + 20.5,
  };
}

/* ── Design floor: antenna_court / Антенный двор ─────────────── */

import {
  W, Cell, ContainerKind, DoorState, Feature, FloorLevel, LiftDirection,
  RoomType, Tex, ZoneFaction,
  type Entity, EntityType, AIGoal, Faction, Occupation, QuestType, MonsterKind,
  type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import {
  connectRoomsMST,
  ensureConnectivity,
  generateZones,
  placeDoor,
  stampRoom,
} from '../shared';
import { placeProceduralScreens, SCREEN_FRAMES } from '../procedural_screens';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('antenna_court');

export const DESIGN_FLOOR_ID = 'antenna_court' as const;
export const ANTENNA_COURT_ROUTE_Z = 42 as const;
export const ANTENNA_COURT_BASE_FLOOR = FloorLevel.MINISTRY;

const SIGNAL_FLAG_TUNED = 1 << 0;
const SIGNAL_FLAG_MARKET_JAMMED = 1 << 1;
const SIGNAL_FLAG_VOID_RECORDED = 1 << 2;
const SIGNAL_FLAG_MINISTRY_NOTICED = 1 << 3;
const SIGNAL_FLAG_BATTERY_STOLEN = 1 << 4;
const SIGNAL_FLAG_EXPOSED = 1 << 5;

const CONTAINER_ID_BASE = 320_300;
const CX = W >> 1;
const CY = W >> 1;

export type AntennaRouteId =
  | 'roof'
  | 'obzh_school'
  | 'ministry'
  | 'metro_error_line'
  | 'market_88'
  | 'void_protocol';

export interface AntennaCourtSignalState {
  signalQuality: number;       // 0..5
  jamUntilHour: number;        // total game hour, -1 when inactive
  lastTunedRouteId: AntennaRouteId | '';
  recordedAnomalyFlags: number;
}

export interface AntennaSignalResult {
  ok: boolean;
  routeId: AntennaRouteId;
  label: string;
  clue: string;
  signalQuality: number;
  eventTags: string[];
}

export const ANTENNA_COURT_ROUTE_DECISIONS = [
  {
    id: 'signal_repair',
    roomName: 'Релейная будка',
    itemId: 'circuit_board',
    eventAction: 'repair',
    outcome: 'Паша чинит реле: сигнал дает маршрутную зацепку, не полную карту.',
  },
  {
    id: 'signal_exposure',
    roomName: 'Пост сигнал-инспекции',
    itemId: 'record_exposure_notice',
    eventAction: 'expose',
    outcome: 'Круг принимает акт о незаконной записи: подсказка становится министерским следом и слухом.',
  },
  {
    id: 'market_jam',
    roomName: 'Кабина глушения',
    itemId: 'fuse',
    eventAction: 'jam',
    outcome: 'Мирра дает короткую тишину для рынка 88, но оставляет заметную подпись в эфире.',
  },
] as const;

export interface AntennaCourtGeneration extends FloorGeneration {
  routeId: typeof DESIGN_FLOOR_ID;
  z: typeof ANTENNA_COURT_ROUTE_Z;
  signalState: AntennaCourtSignalState;
  debug: string[];
}

interface SignalClueDef {
  label: string;
  minQuality: number;
  clue: string;
  faintClue: string;
  tags: string[];
}

interface AntennaHub {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  cabinName: string;
}

interface AntennaGate {
  x: number;
  y: number;
  r: number;
}

interface AntennaSignalSite {
  x: number;
  y: number;
  weight: number;
}

interface AntennaMicroBlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  owner: ZoneFaction;
  name: string;
  connectX?: number;
  connectY?: number;
}

interface AntennaMiniHqSpec {
  owner: ZoneFaction;
  x: number;
  y: number;
  name: string;
  wallTex: Tex;
  floorTex: Tex;
  support: RoomType;
}

interface AntennaTerritorySeed {
  owner: ZoneFaction;
  x: number;
  y: number;
  weight: number;
}

const ANTENNA_TERRITORY_TARGETS = [
  { owner: ZoneFaction.CITIZEN, share: 0.18 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.36 },
  { owner: ZoneFaction.CULTIST, share: 0.08 },
  { owner: ZoneFaction.SCIENTIST, share: 0.24 },
  { owner: ZoneFaction.WILD, share: 0.14 },
] as const;

const SIGNAL_CLUES: Record<AntennaRouteId, SignalClueDef> = {
  roof: {
    label: 'Крыша',
    minQuality: 4,
    clue: 'Верхний люк отвечает только после ремонта мачты; ищи сухой ход и не верь открытому небу.',
    faintClue: 'Сверху слышен ветер и стук люка, но частота срывается.',
    tags: ['roof', 'repair', 'upper_route'],
  },
  obzh_school: {
    label: 'ОБЖ',
    minQuality: 2,
    clue: 'На школьной частоте повторяют: аптечка, убежище, список, гермодверь.',
    faintClue: 'Детский голос считает пункты эвакуации, дальше помеха.',
    tags: ['living', 'obzh', 'shelter'],
  },
  ministry: {
    label: 'Министерство',
    minQuality: 3,
    clue: 'Министерская несущая шипит про проверку записей: незаконный сигнал лучше не нести через очередь.',
    faintClue: 'Слышно слово "акт", потом печать глушит эфир.',
    tags: ['ministry', 'inspection', 'papers'],
  },
  metro_error_line: {
    label: 'Ошибка метро',
    minQuality: 3,
    clue: 'Темная платформа отвечает через билет: линия ошибается чаще у экранов и аппаратов.',
    faintClue: 'Под эфиром слышен поезд без станции.',
    tags: ['metro', 'wrong_stop', 'screen'],
  },
  market_88: {
    label: 'Рынок 88',
    minQuality: 2,
    clue: 'Черный рынок считает рейды по сухим щелчкам; короткий глушитель выиграет время, но оставит подпись.',
    faintClue: 'Восемьдесят восемь щелкает кассой, потом канал режут.',
    tags: ['market_88', 'raid', 'jam'],
  },
  void_protocol: {
    label: '[ДАННЫЕ УДАЛЕНЫ]',
    minQuality: 5,
    clue: 'Сигнал записан как [ДАННЫЕ УДАЛЕНЫ]; банку не открывать рядом с зеркальным экраном.',
    faintClue: 'В тишине слышно: [ДАННЫЕ УДАЛЕНЫ].',
    tags: ['void', 'protocol', 'recording'],
  },
};

const NPC_DEFS: Record<string, PlotNpcDef> = {
  antenna_pasha_grown: {
    name: 'Паша Выросший',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.ELECTRICIAN,
    sprite: Occupation.ELECTRICIAN,
    hp: 120, maxHp: 120, money: 80, speed: 0.85,
    inventory: [
      { defId: 'radio', count: 1 },
      { defId: 'relay_diagram', count: 1 },
      { defId: 'tea', count: 1 },
    ],
    talkLines: [
      'Я был Пашей из радиокружка, пока этажи не начали отвечать взрослыми голосами.',
      'Антенный двор ловит не дальние города, а помехи с соседних этажей.',
      'Настраивать можно. Верить нельзя. Хороший сигнал дает зацепку, не карту.',
      'Частота ОБЖ ещё жива: аптечка, убежище, список, гермодверь. Нина бы одобрила.',
    ],
    talkLinesPost: [
      'Реле держится. Теперь эфир врет аккуратнее.',
      'Если услышишь свой адрес, не отвечай. Адреса тут ходят стаями.',
    ],
  },
  antenna_mirra_jammer: {
    name: 'Мирра Глушилка',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 95, maxHp: 95, money: 160, speed: 1.05,
    inventory: [
      { defId: 'wire_coil', count: 2 },
      { defId: 'cigs', count: 3 },
      { defId: 'metro_ticket', count: 1 },
    ],
    talkLines: [
      'Глушить надо коротко. Длинная тишина заметнее крика.',
      'Рынок 88 покупает минуты без рейда. Министерство продает вопросы после таких минут.',
      'Дашь проволоку и предохранители - я соберу заглушку, а ты решишь, кому станет тише.',
    ],
    talkLinesPost: [
      'Канал погас, но подпись осталась в шуме.',
      'Если инспектор спросит, ты слышал только прогноз погоды.',
    ],
  },
  antenna_captain_krug: {
    name: 'Капитан Круг',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 260, maxHp: 260, money: 95, speed: 1.05,
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 10 },
      { defId: 'official_permit_slip', count: 1 },
    ],
    talkLines: [
      'Круг, инспекция сигнала. Незаконная запись отличается от законной тем, кто первый составил акт.',
      'Батарейный шкаф под охраной. Нужна ячейка - оформляй ремонт или воруй достаточно тихо.',
      'Глушение рейдов я не слышал. Если услышу - услышу и тебя.',
    ],
    talkLinesPost: [
      'Батареи на месте или в отчете. Меня устроит любой вариант с подписью.',
      'Не носи закрытую запись через Министерство без бумаги.',
    ],
  },
  antenna_guard_frequency_sergeant: {
    name: 'Сержант Частотный',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 180, maxHp: 180, money: 35, speed: 1.0,
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 8 },
    ],
    talkLines: [
      'Батарейная стоит под охраной. Реле молчит лучше людей.',
      'Проверяй пропуск у Круга. Я проверяю руки.',
    ],
    talkLinesPost: [
      'Частота ровнее. Охрана остается.',
      'После глушения батареи считают дважды.',
    ],
  },
  antenna_guard_hz_watch: {
    name: 'Дежурный Гц',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 180, maxHp: 180, money: 35, speed: 1.0,
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 8 },
    ],
    talkLines: [
      'У инспекции один вопрос: чей это шум.',
      'Если канал пустой, значит кто-то заплатил за пустоту.',
    ],
    talkLinesPost: [
      'Круг сказал ждать. Я жду громко.',
      'Пустое место в эфире уже записано.',
    ],
  },
  antenna_echo_zhenya: {
    name: 'Эхо Женя',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.CHILD,
    sprite: Occupation.CHILD,
    hp: 70, maxHp: 70, money: 18, speed: 0.9,
    inventory: [
      { defId: 'note', count: 2 },
      { defId: 'bread', count: 1 },
    ],
    talkLines: [
      'Я повторяю не людей. Я повторяю места, когда они забывают закрыть рот.',
      'Сигнал можно записать в банку. Потом его можно продать, отдать Якову или запереть обратно в архив.',
      'Если банка дрожит без голоса, значит запись получилась.',
    ],
    talkLinesPost: [
      'Теперь у меня во рту тише. Спасибо или извини, не знаю.',
      'Яков разберет запись. Рынок просто купит банку.',
    ],
    talkQuestResponse: 'Скажи Паше: верхняя мачта не сломана, она притворяется лежачей антенной.',
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_pasha_grown', NPC_DEFS.antenna_pasha_grown, [
  {
    id: 'antenna_tune_floor',
    giverNpcId: 'antenna_pasha_grown',
    type: QuestType.VISIT,
    desc: 'Паша Выросший: «Дойди до Релейной будки и настрой школьную частоту. Награда - зацепка, не карта.»',
    targetRoomName: 'Релейная будка',
    rewardItem: 'relay_diagram', rewardCount: 1,
    extraRewards: [{ defId: 'caravan_route', count: 1 }],
    relationDelta: 12, xpReward: 45, moneyReward: 30,
  },
  {
    id: 'antenna_repair_signal',
    giverNpcId: 'antenna_pasha_grown',
    type: QuestType.FETCH,
    desc: 'Паша Выросший: «Нужна целая плата реле. Починим мачту - частота даст маршрутную зацепку без министерского акта.»',
    targetItem: 'circuit_board', targetCount: 1,
    rewardItem: 'radio', rewardCount: 1,
    extraRewards: [{ defId: 'relay_diagram', count: 1 }],
    relationDelta: 14, xpReward: 60, moneyReward: 35,
  },
  {
    id: 'antenna_tell_echo',
    giverNpcId: 'antenna_pasha_grown',
    type: QuestType.TALK,
    desc: 'Паша Выросший: «Сверься с Эхо Женей. Он повторяет этажи, когда приборы начинают льстить.»',
    targetNpcId: 'antenna_echo_zhenya',
    rewardItem: 'radio', rewardCount: 1,
    relationDelta: 8, xpReward: 30, moneyReward: 20,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_mirra_jammer', NPC_DEFS.antenna_mirra_jammer, [
  {
    id: 'antenna_jam_raid',
    giverNpcId: 'antenna_mirra_jammer',
    type: QuestType.FETCH,
    desc: 'Мирра Глушилка: «Принеси два предохранителя. Я дам короткую заглушку для рейда 88, но инспектор потом услышит пустое место.»',
    targetItem: 'fuse', targetCount: 2,
    rewardItem: 'metro_ticket', rewardCount: 1,
    extraRewards: [{ defId: 'wire_coil', count: 1 }],
    relationDelta: 10, xpReward: 50, moneyReward: 90,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_captain_krug', NPC_DEFS.antenna_captain_krug, [
  {
    id: 'antenna_battery_theft',
    giverNpcId: 'antenna_captain_krug',
    type: QuestType.FETCH,
    desc: 'Капитан Круг: «Нужны две энергоячейки из батарейного шкафа. Получишь разрешение, если не заставишь меня писать слово "кража".»',
    targetItem: 'ammo_energy', targetCount: 2,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 12, xpReward: 60, moneyReward: 50,
  },
  {
    id: 'antenna_expose_signal_log',
    giverNpcId: 'antenna_captain_krug',
    type: QuestType.FETCH,
    desc: 'Капитан Круг: «Акт о пропавшей записи превратит закрытый шёпот в министерский след. За бумагу дам законный корешок.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'denunciation', count: 1 }],
    relationDelta: 10, xpReward: 65, moneyReward: 45,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_guard_frequency_sergeant', NPC_DEFS.antenna_guard_frequency_sergeant, [], ['antenna_court', 'guard']);
registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_guard_hz_watch', NPC_DEFS.antenna_guard_hz_watch, [], ['antenna_court', 'guard']);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'antenna_echo_zhenya', NPC_DEFS.antenna_echo_zhenya, [
  {
    id: 'antenna_record_void',
    giverNpcId: 'antenna_echo_zhenya',
    type: QuestType.FETCH,
    desc: 'Эхо Женя: «Запиши голосовую аномалию в банку и реши: продать ее рынку или отдать тому, кто умеет читать записи.»',
    targetItem: 'bottled_voice', targetCount: 1,
    rewardItem: 'psi_stabilizer', rewardCount: 1,
    extraRewards: [{ defId: 'antidep', count: 1 }],
    relationDelta: 10, xpReward: 70, moneyReward: 180,
  },
]);

export function createAntennaCourtSignalState(seed = 0): AntennaCourtSignalState {
  return {
    signalQuality: 3 + (Math.abs(seed) % 2),
    jamUntilHour: -1,
    lastTunedRouteId: '',
    recordedAnomalyFlags: 0,
  };
}

export function tuneAntennaCourtSignal(
  signalState: AntennaCourtSignalState,
  routeId: AntennaRouteId,
): AntennaSignalResult {
  const def = SIGNAL_CLUES[routeId];
  const quality = clampQuality(signalState.signalQuality);
  const ok = quality >= def.minQuality;
  signalState.signalQuality = quality;
  signalState.lastTunedRouteId = routeId;
  signalState.recordedAnomalyFlags |= SIGNAL_FLAG_TUNED;
  return {
    ok,
    routeId,
    label: def.label,
    clue: ok ? def.clue : def.faintClue,
    signalQuality: quality,
    eventTags: def.tags,
  };
}

export function repairAntennaCourtSignal(signalState: AntennaCourtSignalState, amount = 1): number {
  signalState.signalQuality = clampQuality(signalState.signalQuality + Math.max(0, amount | 0));
  return signalState.signalQuality;
}

export function jamAntennaCourtSignal(
  signalState: AntennaCourtSignalState,
  nowTotalHour: number,
  durationHours = 2,
): AntennaSignalResult {
  signalState.jamUntilHour = Math.max(signalState.jamUntilHour, nowTotalHour + Math.max(1, durationHours));
  signalState.signalQuality = clampQuality(signalState.signalQuality - 1);
  signalState.recordedAnomalyFlags |= SIGNAL_FLAG_MARKET_JAMMED | SIGNAL_FLAG_MINISTRY_NOTICED;
  return tuneAntennaCourtSignal(signalState, 'market_88');
}

export function recordAntennaCourtAnomaly(
  signalState: AntennaCourtSignalState,
  routeId: Extract<AntennaRouteId, 'void_protocol' | 'metro_error_line'> = 'void_protocol',
): AntennaSignalResult {
  const result = tuneAntennaCourtSignal(signalState, routeId);
  if (result.ok) signalState.recordedAnomalyFlags |= SIGNAL_FLAG_VOID_RECORDED;
  return result;
}

export function exposeAntennaCourtSignal(
  signalState: AntennaCourtSignalState,
  routeId: Extract<AntennaRouteId, 'ministry' | 'market_88' | 'void_protocol'> = 'ministry',
): AntennaSignalResult {
  const result = tuneAntennaCourtSignal(signalState, routeId);
  signalState.recordedAnomalyFlags |= SIGNAL_FLAG_MINISTRY_NOTICED | SIGNAL_FLAG_EXPOSED;
  if (!result.ok) signalState.signalQuality = clampQuality(signalState.signalQuality - 1);
  return result;
}

export function markAntennaCourtBatteryTaken(signalState: AntennaCourtSignalState): void {
  signalState.recordedAnomalyFlags |= SIGNAL_FLAG_BATTERY_STOLEN;
}

export function publishAntennaCourtSignalEvent(
  game: GameState,
  signalState: AntennaCourtSignalState,
  action: 'tune' | 'jam' | 'record' | 'repair' | 'battery' | 'expose',
  result?: AntennaSignalResult,
): WorldEvent {
  const routeId = (result?.routeId ?? signalState.lastTunedRouteId) || undefined;
  const eventTags = result?.eventTags ?? [];
  return publishEvent(game, {
    type: 'rumor_observed',
    floor: game.currentFloor,
    severity: action === 'jam' || action === 'record' || action === 'expose' ? 4 : 3,
    privacy: action === 'jam' || action === 'expose' ? 'witnessed' : 'local',
    targetName: routeId ?? DESIGN_FLOOR_ID,
    tags: [
      DESIGN_FLOOR_ID,
      'signal',
      `antenna_${action}`,
      ...eventTags,
    ],
    data: {
      routeId,
      designFloorId: DESIGN_FLOOR_ID,
      z: ANTENNA_COURT_ROUTE_Z,
      signalQuality: signalState.signalQuality,
      jamUntilHour: signalState.jamUntilHour,
      lastTunedRouteId: signalState.lastTunedRouteId,
      recordedAnomalyFlags: signalState.recordedAnomalyFlags,
      clue: result?.clue,
      ok: result?.ok,
    },
  });
}

export function antennaCourtDebugLines(signalState: AntennaCourtSignalState): string[] {
  return [
    `route=${DESIGN_FLOOR_ID}`,
    `z=${ANTENNA_COURT_ROUTE_Z}`,
    `quality=${clampQuality(signalState.signalQuality)}/5`,
    `tuned=${signalState.lastTunedRouteId || 'none'}`,
    `jamUntilHour=${signalState.jamUntilHour}`,
    `flags=${signalState.recordedAnomalyFlags}`,
    `decisions=${ANTENNA_COURT_ROUTE_DECISIONS.length}`,
  ];
}

export function expandAntennaCourtRouteGeometry(world: World, rng: () => number): void {
  const protectedCells = buildAntennaRouteProtectedMask(world);
  const court = findAntennaRoom(world, 'Антенный двор');
  const hubX = court ? court.x + (court.w >> 1) : CX;
  const hubY = court ? court.y + (court.h >> 1) : CY;

  carveSignalYard(world, hubX - 104, hubY - 92, 208, 184, protectedCells, [
    { x: hubX, y: hubY - 92, r: 4 },
    { x: hubX + 104, y: hubY, r: 4 },
    { x: hubX, y: hubY + 92, r: 4 },
    { x: hubX - 104, y: hubY, r: 4 },
  ]);
  if (court) openCentralSignalGates(world, court, protectedCells);

  const hubs = antennaRouteHubs();
  for (const hub of hubs) {
    carveSignalYard(world, hub.x - (hub.w >> 1), hub.y - (hub.h >> 1), hub.w, hub.h, protectedCells, yardGates(hub));
  }

  for (const hub of hubs) {
    carveCableLine(world, hubX, hubY, hub.x, hub.y, hub.name.includes('диагонал') ? 2 : 3, protectedCells);
  }
  carveHubRing(world, hubs, protectedCells);
  carveBypassRings(world, protectedCells);
  drawSectorFences(world, protectedCells);
  paintWeightedAntennaCells(world, hubs, protectedCells);
  carveTensorCableSpines(world, rng, hubX, hubY, hubs, protectedCells);
  carveHoughSignalCorridors(world, hubX, hubY, protectedCells);

  for (const hub of hubs) {
    placeRepeaterTower(world, hub.x, hub.y, protectedCells);
    scatterCableReels(world, rng, hubX, hubY, hub.x, hub.y, protectedCells);
  }
  placeCentralMastCluster(world, hubX, hubY, protectedCells);
  placeMaintenanceCabins(world, rng, hubs, protectedCells);
  placeWeatherScreenWalls(world, hubs, protectedCells);
  placeAntennaFactionMiniHqs(world, rng, protectedCells);
  placeAntennaMicroRoomFabric(world, rng, hubs, protectedCells);
}

export function retuneAntennaCourtRouteZones(world: World): void {
  const hubs = antennaRouteHubs();
  for (const zone of world.zones) {
    const hubD = nearestAntennaHubDistance(world, zone.cx, zone.cy, hubs);
    const centerD = world.dist(zone.cx, zone.cy, CX, CY);
    const enclave = centerD < 170 || hubD < 96;
    zone.level = Math.max(zone.level, enclave ? 4 : 5);
    zone.fogged = false;
  }

  applyAntennaCourtTerritory(world);

  for (const room of world.rooms) {
    if (!room) continue;
    const owner = antennaRoomOwnerOverride(room);
    if (owner === undefined) continue;
    if (room.name.includes('НИИ') || room.name.includes('гермоядро')) room.sealed = true;
    paintRoomFaction(world, room, owner);
  }
  syncZoneMetadataFromTerritory(world);
}

function nearestAntennaHubDistance(world: World, x: number, y: number, hubs: readonly AntennaHub[]): number {
  let best = Infinity;
  for (const hub of hubs) best = Math.min(best, world.dist(x, y, hub.x, hub.y));
  return best;
}

function antennaRoomOwnerOverride(room: Room): ZoneFaction | undefined {
  if (room.name.includes('граждан')) return ZoneFaction.CITIZEN;
  if (room.name.includes('ликвидатор') || room.name === 'Батарейная кладовая' || room.name === 'Пост сигнал-инспекции') return ZoneFaction.LIQUIDATOR;
  if (room.name.includes('культист')) return ZoneFaction.CULTIST;
  if (room.name.includes('НИИ') || room.name.includes('учен') || room.name === 'Радиоклуб взрослых детей' || room.name === 'Релейная будка' || room.name === 'Архив мониторинга') return ZoneFaction.SCIENTIST;
  if (room.name.includes('дик') || room.name === 'Кабина глушения') return ZoneFaction.WILD;
  return undefined;
}

export function generateAntennaCourtDesignFloor(seed = 0): AntennaCourtGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  let nextContainerId = CONTAINER_ID_BASE;

  world.wallTex.fill(Tex.CONCRETE);
  world.floorTex.fill(Tex.F_CONCRETE);

  const rooms = stampAntennaCourtRooms(world);
  connectRoomsMST(world, [
    rooms.courtyard,
    rooms.radioClub,
    rooms.relay,
    rooms.archive,
    rooms.battery,
    rooms.dorm,
    rooms.jammer,
    rooms.inspection,
    rooms.entry,
    rooms.exit,
  ]);
  placeDoor(world, rooms.courtyard, rooms.radioClub, '', false);
  placeDoor(world, rooms.courtyard, rooms.relay, '', false);
  placeDoor(world, rooms.archive, rooms.battery, 'key', false);

  generateZones(world);
  retuneAntennaZones(world, rooms);
  decorateAntennaCourt(world, rooms);
  placeProceduralScreens(world, ANTENNA_COURT_BASE_FLOOR);
  placeAuthoredSignalScreens(world, rooms);

  const pasha = spawnPlotNpc(entities, nextId, 'antenna_pasha_grown', rooms.radioClub, 4, 4, 0);
  const mirra = spawnPlotNpc(entities, nextId, 'antenna_mirra_jammer', rooms.jammer, 4, 4, Math.PI / 2);
  const captain = spawnPlotNpc(entities, nextId, 'antenna_captain_krug', rooms.inspection, 5, 5, Math.PI, { weapon: 'makarov' });
  spawnPlotNpc(entities, nextId, 'antenna_echo_zhenya', rooms.dorm, 3, 3, -Math.PI / 2, { spriteScale: 0.72 });

  spawnPlotNpc(entities, nextId, 'antenna_guard_frequency_sergeant', rooms.battery, 2, 7, Math.PI / 2, { canGiveQuest: false });
  spawnPlotNpc(entities, nextId, 'antenna_guard_hz_watch', rooms.inspection, 8, 2, Math.PI / 2, { canGiveQuest: false });
  spawnSignalMonsters(world, entities, nextId, rooms);

  addContainer(world, nextContainerId++, rooms.battery, 4, 4, ContainerKind.TOOL_LOCKER, 'Батарейный шкаф антенн', 'owner', [
    { defId: 'ammo_energy', count: 3 },
    { defId: 'fuse', count: 2 },
    { defId: 'wire_coil', count: 2 },
  ], captain);
  addContainer(world, nextContainerId++, rooms.archive, 4, 4, ContainerKind.FILING_CABINET, 'Архив записанных частот', 'locked', [
    { defId: 'bottled_voice', count: 1 },
    { defId: 'note', count: 3 },
    { defId: 'record_exposure_notice', count: 1 },
  ]);
  addContainer(world, nextContainerId++, rooms.relay, 7, 4, ContainerKind.METAL_CABINET, 'Ящик релейных схем', 'room', [
    { defId: 'relay_diagram', count: 2 },
    { defId: 'circuit_board', count: 1 },
    { defId: 'lamp_bulb', count: 2 },
  ], pasha);
  addContainer(world, nextContainerId++, rooms.relay, 3, 8, ContainerKind.TOOL_LOCKER, 'Шкаф ремонта верхней мачты', 'room', [
    { defId: 'circuit_board', count: 1 },
    { defId: 'fuse', count: 2 },
    { defId: 'wire_coil', count: 1 },
  ], pasha);
  addContainer(world, nextContainerId++, rooms.inspection, 3, 8, ContainerKind.SAFE, 'Сейф экспозиции сигнала', 'faction', [
    { defId: 'record_exposure_notice', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'denunciation', count: 1 },
  ], captain);
  addContainer(world, nextContainerId++, rooms.jammer, 8, 3, ContainerKind.CASHBOX, 'Касса короткой тишины', 'owner', [
    { defId: 'metro_ticket', count: 1 },
    { defId: 'cigs', count: 2 },
    { defId: 'denunciation', count: 1 },
  ], mirra);

  dropItem(entities, nextId, rooms.entry.x + 3, rooms.entry.y + 4, 'radio', 1);
  dropItem(entities, nextId, rooms.courtyard.x + 22, rooms.courtyard.y + 25, 'wire_coil', 1);
  dropDesk(entities, nextId, rooms.radioClub.x + 6, rooms.radioClub.y + 5);
  dropDesk(entities, nextId, rooms.archive.x + 12, rooms.archive.y + 5);

  placeFixedLift(world, rooms.entry.x + 2, rooms.entry.y + 2, LiftDirection.DOWN);
  placeFixedLift(world, rooms.exit.x + rooms.exit.w - 3, rooms.exit.y + 2, LiftDirection.UP);

  const spawnX = rooms.entry.x + 5.5;
  const spawnY = rooms.entry.y + 5.5;
  ensureConnectivity(world, spawnX, spawnY);
  world.bakeLights();

  const signalState = createAntennaCourtSignalState(seed);
  return {
    world,
    entities,
    spawnX,
    spawnY,
    routeId: DESIGN_FLOOR_ID,
    z: ANTENNA_COURT_ROUTE_Z,
    signalState,
    debug: antennaCourtDebugLines(signalState),
  };
}

function antennaRouteHubs(): AntennaHub[] {
  return [
    { x: CX, y: 154, w: 128, h: 150, name: 'Северный мачтовый сектор', cabinName: 'Северная релейная кабина' },
    { x: 770, y: 254, w: 148, h: 118, name: 'Северо-восточная диагональная ферма', cabinName: 'Кабина погодного экрана' },
    { x: 870, y: CY, w: 150, h: 128, name: 'Восточный репитерный сектор', cabinName: 'Восточная ремонтная будка' },
    { x: 770, y: 770, w: 148, h: 118, name: 'Юго-восточная диагональная ферма', cabinName: 'Будка кабельного обхода' },
    { x: CX, y: 870, w: 128, h: 150, name: 'Южный мачтовый сектор', cabinName: 'Южная аккумуляторная кабина' },
    { x: 254, y: 770, w: 148, h: 118, name: 'Юго-западная диагональная ферма', cabinName: 'Будка мокрых кабелей' },
    { x: 154, y: CY, w: 150, h: 128, name: 'Западный репитерный сектор', cabinName: 'Западная релейная кабина' },
    { x: 254, y: 254, w: 148, h: 118, name: 'Северо-западная диагональная ферма', cabinName: 'Кабина глухого приема' },
  ];
}

function buildAntennaRouteProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    if (!room) continue;
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        mask[world.idx(x, y)] = 1;
      }
    }
  }
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT || world.features[i] === Feature.LIFT_BUTTON || world.aptMask[i] || world.hermoWall[i]) {
      mask[i] = 1;
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  return mask;
}

function findAntennaRoom(world: World, name: string): Room | undefined {
  return world.rooms.find(room => room?.name === name);
}

function carveSignalYard(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  protectedCells: Uint8Array,
  gates: AntennaGate[],
): void {
  for (let dy = 1; dy < h - 1; dy++) {
    for (let dx = 1; dx < w - 1; dx++) {
      setRouteFloor(world, x + dx, y + dy, Tex.F_CONCRETE, protectedCells);
    }
  }
  for (let dx = 0; dx < w; dx++) {
    setFenceOrGate(world, x + dx, y, protectedCells, gates);
    setFenceOrGate(world, x + dx, y + h - 1, protectedCells, gates);
  }
  for (let dy = 1; dy < h - 1; dy++) {
    setFenceOrGate(world, x, y + dy, protectedCells, gates);
    setFenceOrGate(world, x + w - 1, y + dy, protectedCells, gates);
  }
}

function yardGates(hub: AntennaHub): AntennaGate[] {
  const halfW = hub.w >> 1;
  const halfH = hub.h >> 1;
  return [
    { x: hub.x, y: hub.y - halfH, r: 5 },
    { x: hub.x + halfW, y: hub.y, r: 5 },
    { x: hub.x, y: hub.y + halfH, r: 5 },
    { x: hub.x - halfW, y: hub.y, r: 5 },
  ];
}

function setFenceOrGate(world: World, x: number, y: number, protectedCells: Uint8Array, gates: AntennaGate[]): void {
  if (isGateCell(world, x, y, gates)) setRouteFloor(world, x, y, Tex.F_CONCRETE, protectedCells);
  else setFenceWall(world, x, y, protectedCells);
}

function isGateCell(world: World, x: number, y: number, gates: AntennaGate[]): boolean {
  for (const gate of gates) {
    if (world.dist2(x, y, gate.x, gate.y) <= gate.r * gate.r) return true;
  }
  return false;
}

function openCentralSignalGates(world: World, court: Room, protectedCells: Uint8Array): void {
  openRoomSideGate(world, court, 0, -1, protectedCells);
  openRoomSideGate(world, court, 1, 0, protectedCells);
  openRoomSideGate(world, court, 0, 1, protectedCells);
  openRoomSideGate(world, court, -1, 0, protectedCells);
}

function openRoomSideGate(world: World, room: Room, dx: number, dy: number, protectedCells: Uint8Array): void {
  const horizontal = dy !== 0;
  const span = horizontal ? room.w : room.h;
  const mid = Math.floor(span / 2);
  for (let offset = 0; offset <= mid; offset++) {
    for (const signed of offset === 0 ? [0] : [-offset, offset]) {
      const sx = horizontal ? room.x + mid + signed : room.x + (dx > 0 ? room.w : -1);
      const sy = horizontal ? room.y + (dy > 0 ? room.h : -1) : room.y + mid + signed;
      const insideX = sx - dx;
      const insideY = sy - dy;
      const outsideX = sx + dx;
      const outsideY = sy + dy;
      const insideIdx = world.idx(insideX, insideY);
      const outsideIdx = world.idx(outsideX, outsideY);
      if (world.roomMap[insideIdx] !== room.id) continue;
      if (protectedCells[outsideIdx] || world.roomMap[outsideIdx] >= 0 || world.cells[outsideIdx] === Cell.LIFT) continue;
      placeAntennaGate(world, sx, sy, room.id, -1, '');
      carveCableDisc(world, outsideX, outsideY, 2, Tex.F_CONCRETE, protectedCells);
      return;
    }
  }
}

function carveHubRing(world: World, hubs: AntennaHub[], protectedCells: Uint8Array): void {
  for (let i = 0; i < hubs.length; i++) {
    const a = hubs[i];
    const b = hubs[(i + 1) % hubs.length];
    carveCableLine(world, a.x, a.y, b.x, b.y, 2, protectedCells);
  }
}

function carveBypassRings(world: World, protectedCells: Uint8Array): void {
  carveRectCable(world, CX - 174, CY - 174, 348, 348, 2, protectedCells);
  carveRectCable(world, CX - 304, CY - 304, 608, 608, 1, protectedCells);
  carveCableLine(world, CX - 304, CY, CX + 304, CY, 1, protectedCells);
  carveCableLine(world, CX, CY - 304, CX, CY + 304, 1, protectedCells);
}

function carveRectCable(world: World, x: number, y: number, w: number, h: number, width: number, protectedCells: Uint8Array): void {
  carveCableLine(world, x, y, x + w, y, width, protectedCells);
  carveCableLine(world, x + w, y, x + w, y + h, width, protectedCells);
  carveCableLine(world, x + w, y + h, x, y + h, width, protectedCells);
  carveCableLine(world, x, y + h, x, y, width, protectedCells);
}

function drawSectorFences(world: World, protectedCells: Uint8Array): void {
  const gateYs = [154, 254, CY - 174, CY, CY + 174, 770, 870];
  const gateXs = [154, 254, CX - 174, CX, CX + 174, 770, 870];
  drawFenceLine(world, CX - 156, 92, CX - 156, W - 92, protectedCells, gateYs.map(y => ({ x: CX - 156, y, r: 10 })));
  drawFenceLine(world, CX + 156, 92, CX + 156, W - 92, protectedCells, gateYs.map(y => ({ x: CX + 156, y, r: 10 })));
  drawFenceLine(world, 92, CY - 156, W - 92, CY - 156, protectedCells, gateXs.map(x => ({ x, y: CY - 156, r: 10 })));
  drawFenceLine(world, 92, CY + 156, W - 92, CY + 156, protectedCells, gateXs.map(x => ({ x, y: CY + 156, r: 10 })));
}

function drawFenceLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  protectedCells: Uint8Array,
  gates: AntennaGate[],
): void {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    setFenceOrGate(world, x, y, protectedCells, gates);
  }
}

function paintWeightedAntennaCells(world: World, hubs: readonly AntennaHub[], protectedCells: Uint8Array): void {
  const sites = antennaSignalSites(hubs);
  for (let y = 70; y <= W - 70; y += 2) {
    for (let x = 70; x <= W - 70; x += 2) {
      const ci = world.idx(x, y);
      if (protectedCells[ci] || world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] >= 0) continue;
      const owner = nearestSignalSite(world, x, y, sites);
      const east = nearestSignalSite(world, x + 4, y, sites);
      const south = nearestSignalSite(world, x, y + 4, sites);
      if (owner === east && owner === south) continue;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          markSignalCableCell(world, x + dx, y + dy, protectedCells, Tex.F_LINO);
        }
      }
      if (((x * 19 + y * 23 + owner * 37) & 63) === 0) {
        setFeatureIfUnprotectedFloor(world, x, y, protectedCells, owner % 2 === 0 ? Feature.APPARATUS : Feature.LAMP);
      }
    }
  }
}

function antennaSignalSites(hubs: readonly AntennaHub[]): AntennaSignalSite[] {
  return [
    { x: CX, y: CY, weight: 2.45 },
    ...hubs.map((hub, i) => ({
      x: hub.x,
      y: hub.y,
      weight: hub.name.includes('диагонал') ? 1.38 + (i % 2) * 0.08 : 1.72,
    })),
  ];
}

function nearestSignalSite(world: World, x: number, y: number, sites: readonly AntennaSignalSite[]): number {
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const score = world.dist2(x, y, site.x, site.y) / Math.max(0.1, site.weight * site.weight);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function carveTensorCableSpines(
  world: World,
  rng: () => number,
  hubX: number,
  hubY: number,
  hubs: readonly AntennaHub[],
  protectedCells: Uint8Array,
): void {
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    for (let lane = 0; lane < 2; lane++) {
      const spin = (i + lane) % 2 === 0 ? 1 : -1;
      let x = hub.x + Math.round(Math.cos((i + lane * 0.45) * Math.PI / 4) * (16 + lane * 9));
      let y = hub.y + Math.round(Math.sin((i + lane * 0.45) * Math.PI / 4) * (16 + lane * 9));
      const steps = 54 + Math.floor(rng() * 18);
      for (let step = 0; step < steps; step++) {
        const rx = world.delta(x, hubX);
        const ry = world.delta(y, hubY);
        const len = Math.max(1, Math.hypot(rx, ry));
        const radialX = rx / len;
        const radialY = ry / len;
        const curl = Math.sin((x * 0.027 + y * 0.019 + i * 0.71 + step * 0.13)) * 0.32;
        const vx = radialX * 0.72 + (-radialY * spin) * (0.42 + curl);
        const vy = radialY * 0.72 + (radialX * spin) * (0.42 - curl);
        const nextX = world.wrap(Math.round(x + vx * (6 + (step % 3))));
        const nextY = world.wrap(Math.round(y + vy * (6 + ((step + 1) % 3))));
        carveSignalCableLine(world, x, y, nextX, nextY, 1, protectedCells, Tex.F_LINO);
        if (step % 9 === 0) {
          setFeatureIfUnprotectedFloor(world, nextX, nextY, protectedCells, lane === 0 ? Feature.APPARATUS : Feature.MACHINE);
        }
        x = nextX;
        y = nextY;
      }
    }
  }
}

function carveHoughSignalCorridors(world: World, hubX: number, hubY: number, protectedCells: Uint8Array): void {
  const endpoints = [
    { x: 104, y: hubY },
    { x: W - 104, y: hubY },
    { x: hubX, y: 104 },
    { x: hubX, y: W - 104 },
    { x: 136, y: 136 },
    { x: W - 136, y: W - 136 },
    { x: 136, y: W - 136 },
    { x: W - 136, y: 136 },
    { x: 282, y: 116 },
    { x: W - 282, y: W - 116 },
    { x: 116, y: 282 },
    { x: W - 116, y: W - 282 },
  ] as const;
  for (let i = 0; i < endpoints.length; i++) {
    const end = endpoints[i];
    carveSignalCableLine(world, hubX, hubY, end.x, end.y, i < 4 ? 2 : 1, protectedCells, Tex.F_LINO);
    const steps = 7;
    for (let s = 1; s < steps; s++) {
      const x = world.wrap(Math.round(hubX + world.delta(hubX, end.x) * s / steps));
      const y = world.wrap(Math.round(hubY + world.delta(hubY, end.y) * s / steps));
      setFeatureIfUnprotectedFloor(world, x, y, protectedCells, s % 2 === 0 ? Feature.LAMP : Feature.APPARATUS);
    }
  }
}

function carveCableLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  protectedCells?: Uint8Array,
): void {
  carveSignalCableLine(world, ax, ay, bx, by, width, protectedCells, Tex.F_CONCRETE);
}

function carveSignalCableLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  protectedCells: Uint8Array | undefined,
  floorTex: Tex,
): void {
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = world.wrap(Math.round(ax + dx * t));
    const y = world.wrap(Math.round(ay + dy * t));
    carveCableDisc(world, x, y, width, floorTex, protectedCells);
  }
}

function carveCableDisc(
  world: World,
  cx: number,
  cy: number,
  r: number,
  floorTex: Tex,
  protectedCells?: Uint8Array,
): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      setRouteFloor(world, cx + dx, cy + dy, floorTex, protectedCells);
    }
  }
}

function setRouteFloor(world: World, x: number, y: number, floorTex: Tex, protectedCells?: Uint8Array): void {
  const ci = world.idx(x, y);
  if (protectedCells?.[ci] || world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  if (world.features[ci] !== Feature.SCREEN) world.features[ci] = Feature.NONE;
}

function markSignalCableCell(world: World, x: number, y: number, protectedCells: Uint8Array, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if (protectedCells[ci] || world.cells[ci] !== Cell.FLOOR || world.features[ci] === Feature.LIFT_BUTTON) return;
  world.floorTex[ci] = floorTex;
}

function setFenceWall(world: World, x: number, y: number, protectedCells: Uint8Array): void {
  const ci = world.idx(x, y);
  if (protectedCells[ci] || world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.METAL;
  world.features[ci] = Feature.NONE;
}

function placeRepeaterTower(world: World, x: number, y: number, protectedCells: Uint8Array): void {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    setFenceWall(world, x + dx, y + dy, protectedCells);
  }
  for (let a = 0; a < 8; a++) {
    const px = x + Math.round(Math.cos(a * Math.PI / 4) * 5);
    const py = y + Math.round(Math.sin(a * Math.PI / 4) * 5);
    setFeatureIfUnprotectedFloor(world, px, py, protectedCells, a % 3 === 0 ? Feature.LAMP : Feature.APPARATUS);
  }
}

function placeCentralMastCluster(world: World, x: number, y: number, protectedCells: Uint8Array): void {
  const offsets = [
    [-74, -50], [70, -48], [-84, 44], [82, 48],
    [-46, -74], [46, 74],
  ] as const;
  for (const [dx, dy] of offsets) {
    placeRepeaterTower(world, x + dx, y + dy, protectedCells);
  }
}

function scatterCableReels(
  world: World,
  rng: () => number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  protectedCells: Uint8Array,
): void {
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;
  const count = Math.max(2, Math.floor(len / 86));
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = side * (5 + Math.floor(rng() * 6));
    const x = world.wrap(Math.round(ax + dx * t + px * offset));
    const y = world.wrap(Math.round(ay + dy * t + py * offset));
    setFeatureIfUnprotectedFloor(world, x, y, protectedCells, rng() < 0.55 ? Feature.MACHINE : Feature.APPARATUS);
  }
}

function placeMaintenanceCabins(
  world: World,
  rng: () => number,
  hubs: AntennaHub[],
  protectedCells: Uint8Array,
): void {
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const w = 18 + Math.floor(rng() * 7);
    const h = 12 + Math.floor(rng() * 5);
    const sideX = hub.x < CX ? -1 : hub.x > CX ? 1 : (i % 2 === 0 ? -1 : 1);
    const sideY = hub.y < CY ? -1 : hub.y > CY ? 1 : (i % 2 === 0 ? 1 : -1);
    const options = [
      { x: hub.x + sideX * ((hub.w >> 1) - w - 10), y: hub.y + sideY * 18 },
      { x: hub.x - sideX * 18, y: hub.y + sideY * ((hub.h >> 1) - h - 8) },
      { x: hub.x + sideX * 28, y: hub.y - sideY * 24 },
    ];
    for (const option of options) {
      const rx = clampInt(option.x, 28, W - w - 28);
      const ry = clampInt(option.y, 28, W - h - 28);
      if (!canBuildRouteRoom(world, rx, ry, w, h, protectedCells)) continue;
      const niiPod = i % 4 === 0;
      const room = stampNamedRoom(
        world,
        niiPod ? RoomType.HQ : i % 3 === 0 ? RoomType.STORAGE : RoomType.PRODUCTION,
        rx,
        ry,
        w,
        h,
        niiPod ? `Гермокапсула НИИ ${i + 1}` : hub.cabinName,
        i % 2 === 0 ? Tex.METAL : Tex.PIPE,
        Tex.F_CONCRETE,
      );
      if (niiPod) markHermeticRoomShell(world, room);
      decorateRouteCabin(world, room, rng);
      openRouteRoomToPoint(world, room, hub.x, hub.y, protectedCells, niiPod ? DoorState.HERMETIC_OPEN : DoorState.CLOSED);
      break;
    }
  }
}

function canBuildRouteRoom(world: World, x: number, y: number, w: number, h: number, protectedCells: Uint8Array): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (protectedCells[ci] || world.cells[ci] === Cell.LIFT || world.doors.has(ci)) return false;
    }
  }
  return true;
}

function decorateRouteCabin(world: World, room: Room, rng: () => number): void {
  const featureCount = Math.max(3, Math.floor(room.w * room.h / 55));
  for (let i = 0; i < featureCount; i++) {
    const x = room.x + 2 + Math.floor(rng() * Math.max(1, room.w - 4));
    const y = room.y + 2 + Math.floor(rng() * Math.max(1, room.h - 4));
    setFeatureIfFloor(world, x, y, i % 5 === 0 ? Feature.LAMP : i % 2 === 0 ? Feature.APPARATUS : Feature.MACHINE);
  }
}

function openRouteRoomToPoint(
  world: World,
  room: Room,
  tx: number,
  ty: number,
  protectedCells: Uint8Array,
  doorState = DoorState.CLOSED,
): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = world.delta(cx, tx);
  const dy = world.delta(cy, ty);
  let doorX = cx;
  let doorY = cy;
  let outsideX = cx;
  let outsideY = cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    const sx = dx > 0 ? 1 : -1;
    doorX = room.x + (sx > 0 ? room.w : -1);
    doorY = cy;
    outsideX = doorX + sx;
    outsideY = doorY;
  } else {
    const sy = dy > 0 ? 1 : -1;
    doorX = cx;
    doorY = room.y + (sy > 0 ? room.h : -1);
    outsideX = doorX;
    outsideY = doorY + sy;
  }
  placeAntennaGate(world, doorX, doorY, room.id, -1, '', doorState);
  carveCableLine(world, outsideX, outsideY, tx, ty, 1, protectedCells);
}

function placeWeatherScreenWalls(world: World, hubs: AntennaHub[], protectedCells: Uint8Array): void {
  for (let x = CX - 84; x <= CX + 84; x += 12) {
    if (!protectedCells[world.idx(x, CY - 92)]) setWallScreen(world, x, CY - 92, (x >> 2) & 7);
  }
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const y = hub.y - (hub.h >> 1);
    for (let dx = -18; dx <= 18; dx += 12) {
      const x = hub.x + dx;
      if (!protectedCells[world.idx(x, y)]) setWallScreen(world, x, y, (i + dx + 64) & 7);
    }
  }
}

function antennaMiniHqSpecs(): AntennaMiniHqSpec[] {
  return [
    { owner: ZoneFaction.LIQUIDATOR, x: 556, y: 456, name: 'ликвидаторов частотной зачистки', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, support: RoomType.OFFICE },
    { owner: ZoneFaction.SCIENTIST, x: 458, y: 104, name: 'ученых эфирной НИИ', wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, support: RoomType.MEDICAL },
    { owner: ZoneFaction.CITIZEN, x: 102, y: 462, name: 'граждан радиодвора', wallTex: Tex.PANEL, floorTex: Tex.F_LINO, support: RoomType.KITCHEN },
    { owner: ZoneFaction.WILD, x: 704, y: 718, name: 'диких кабельщиков', wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, support: RoomType.SMOKING },
    { owner: ZoneFaction.CULTIST, x: 204, y: 206, name: 'культистов шепчущей мачты', wallTex: Tex.METAL, floorTex: Tex.F_CARPET, support: RoomType.COMMON },
  ];
}

function placeAntennaFactionMiniHqs(world: World, rng: () => number, protectedCells: Uint8Array): void {
  for (const spec of antennaMiniHqSpecs()) {
    placeAntennaMiniHqBlock(world, rng, spec, protectedCells);
  }

  const outposts: AntennaMicroBlockSpec[] = [
    { x: 696, y: 232, w: 74, h: 46, owner: ZoneFaction.LIQUIDATOR, name: 'Верхний ликвидаторский пост', connectX: 770, connectY: 254 },
    { x: 688, y: 500, w: 74, h: 46, owner: ZoneFaction.LIQUIDATOR, name: 'Восточный ликвидаторский пост', connectX: 870, connectY: CY },
  ];
  for (const outpost of outposts) {
    placeAntennaMicroBlock(world, rng, outpost, protectedCells, 4);
  }
}

function placeAntennaMiniHqBlock(
  world: World,
  rng: () => number,
  spec: AntennaMiniHqSpec,
  protectedCells: Uint8Array,
): void {
  const hallY = spec.y + 25;
  carveAntennaHall(world, spec.x + 3, hallY, 74, 2, protectedCells, spec.floorTex);
  const rooms = [
    { type: RoomType.HQ, x: spec.x + 6, y: spec.y + 7, w: 16, h: 12, name: `Гермоядро ${spec.name}`, side: 'south' as const, hermetic: true },
    { type: RoomType.COMMON, x: spec.x + 26, y: spec.y + 7, w: 16, h: 10, name: `Общая ${spec.name}`, side: 'south' as const },
    { type: spec.support, x: spec.x + 48, y: spec.y + 7, w: 13, h: 10, name: `Опора ${spec.name}`, side: 'south' as const },
    { type: RoomType.BATHROOM, x: spec.x + 64, y: spec.y + 7, w: 8, h: 10, name: `Санузел ${spec.name}`, side: 'south' as const },
    { type: RoomType.STORAGE, x: spec.x + 6, y: spec.y + 32, w: 13, h: 10, name: `Кладовая ${spec.name}`, side: 'north' as const },
    { type: RoomType.PRODUCTION, x: spec.x + 23, y: spec.y + 32, w: 17, h: 10, name: `Мастерская ${spec.name}`, side: 'north' as const },
    { type: RoomType.MEDICAL, x: spec.x + 44, y: spec.y + 32, w: 14, h: 10, name: `Медугол ${spec.name}`, side: 'north' as const },
    { type: RoomType.OFFICE, x: spec.x + 62, y: spec.y + 32, w: 11, h: 10, name: `Журнал ${spec.name}`, side: 'north' as const },
  ];

  for (const def of rooms) {
    const room = tryStampAntennaRoom(world, def.type, def.x, def.y, def.w, def.h, def.name, spec.wallTex, spec.floorTex, protectedCells);
    if (!room) continue;
    if (def.hermetic) markHermeticRoomShell(world, room);
    paintRoomFaction(world, room, spec.owner);
    decorateAntennaRoomByType(world, room, rng, spec.owner);
    openAntennaRoomDoor(world, room, def.side, def.hermetic ? DoorState.HERMETIC_OPEN : DoorState.CLOSED);
  }
}

function placeAntennaMicroRoomFabric(
  world: World,
  rng: () => number,
  hubs: readonly AntennaHub[],
  protectedCells: Uint8Array,
): void {
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const owner = antennaHubOwner(i);
    const spec: AntennaMicroBlockSpec = {
      x: hub.x - (hub.w >> 1) + 8,
      y: hub.y - (hub.h >> 1) + 8,
      w: hub.w - 16,
      h: hub.h - 16,
      owner,
      name: `${hub.name}: малые радиокомнаты`,
      connectX: hub.x,
      connectY: hub.y,
    };
    placeAntennaMicroBlock(world, rng, spec, protectedCells, 18);
  }

  const innerBlocks: AntennaMicroBlockSpec[] = [
    { x: 346, y: 350, w: 104, h: 72, owner: ZoneFaction.SCIENTIST, name: 'Северо-западные архивные ячейки', connectX: CX, connectY: CY },
    { x: 618, y: 350, w: 104, h: 72, owner: ZoneFaction.LIQUIDATOR, name: 'Северо-восточные караульные ячейки', connectX: CX, connectY: CY },
    { x: 346, y: 612, w: 104, h: 72, owner: ZoneFaction.CITIZEN, name: 'Юго-западные бытовые ячейки', connectX: CX, connectY: CY },
    { x: 618, y: 612, w: 104, h: 72, owner: ZoneFaction.WILD, name: 'Юго-восточные кабельные ячейки', connectX: CX, connectY: CY },
    { x: 462, y: 686, w: 86, h: 76, owner: ZoneFaction.CULTIST, name: 'Нижние шепчущие ячейки', connectX: CX, connectY: CY + 174 },
    { x: 114, y: 332, w: 94, h: 62, owner: ZoneFaction.CULTIST, name: 'Западный скрытый сектор', connectX: 154, connectY: CY },
    { x: 286, y: 118, w: 94, h: 62, owner: ZoneFaction.SCIENTIST, name: 'Северный сектор измерителей', connectX: 254, connectY: 254 },
    { x: 624, y: 118, w: 94, h: 62, owner: ZoneFaction.LIQUIDATOR, name: 'Северный сектор патруля', connectX: 770, connectY: 254 },
    { x: 826, y: 332, w: 94, h: 62, owner: ZoneFaction.LIQUIDATOR, name: 'Восточный сектор досмотра', connectX: 870, connectY: CY },
    { x: 826, y: 620, w: 94, h: 62, owner: ZoneFaction.WILD, name: 'Восточный сектор растяжек', connectX: 870, connectY: CY },
    { x: 624, y: 836, w: 94, h: 62, owner: ZoneFaction.WILD, name: 'Южный сектор мокрых кабелей', connectX: 770, connectY: 770 },
    { x: 286, y: 836, w: 94, h: 62, owner: ZoneFaction.CITIZEN, name: 'Южный сектор ночлега', connectX: 254, connectY: 770 },
    { x: 114, y: 620, w: 94, h: 62, owner: ZoneFaction.CITIZEN, name: 'Западный сектор очереди', connectX: 154, connectY: CY },
    { x: 446, y: 258, w: 86, h: 62, owner: ZoneFaction.SCIENTIST, name: 'Верхние ячейки журналов', connectX: CX, connectY: 154 },
    { x: 446, y: 802, w: 86, h: 62, owner: ZoneFaction.CITIZEN, name: 'Нижние ячейки ночевки', connectX: CX, connectY: 870 },
  ];
  for (const block of innerBlocks) {
    placeAntennaMicroBlock(world, rng, block, protectedCells, 14);
  }
}

function antennaHubOwner(index: number): ZoneFaction {
  switch (index) {
    case 0: return ZoneFaction.SCIENTIST;
    case 1: return ZoneFaction.LIQUIDATOR;
    case 2: return ZoneFaction.LIQUIDATOR;
    case 3: return ZoneFaction.WILD;
    case 4: return ZoneFaction.CITIZEN;
    case 5: return ZoneFaction.WILD;
    case 6: return ZoneFaction.CITIZEN;
    case 7: return ZoneFaction.CULTIST;
    default: return ZoneFaction.LIQUIDATOR;
  }
}

function placeAntennaMicroBlock(
  world: World,
  rng: () => number,
  spec: AntennaMicroBlockSpec,
  protectedCells: Uint8Array,
  maxRooms: number,
): void {
  const hallY = spec.y + (spec.h >> 1);
  carveAntennaHall(world, spec.x + 3, hallY, Math.max(1, spec.w - 6), 1, protectedCells, Tex.F_CONCRETE);
  if (spec.connectX !== undefined && spec.connectY !== undefined) {
    carveSignalCableLine(
      world,
      spec.x + (spec.w >> 1),
      hallY,
      spec.connectX,
      spec.connectY,
      1,
      protectedCells,
      Tex.F_CONCRETE,
    );
  }
  let serial = 0;
  for (const side of ['north', 'south'] as const) {
    let cursor = spec.x + 5;
    while (serial < maxRooms && cursor < spec.x + spec.w - 8) {
      const rw = 5 + ((serial * 3 + spec.owner) % 4);
      const rh = 4 + ((serial + spec.owner) % 3);
      const y = side === 'north' ? hallY - rh - 1 : hallY + 2;
      if (cursor + rw >= spec.x + spec.w - 4 || y < spec.y + 2 || y + rh > spec.y + spec.h - 2) break;
      const type = antennaMicroRoomType(spec.owner, serial);
      const room = tryStampAntennaRoom(
        world,
        type,
        cursor,
        y,
        rw,
        rh,
        `${spec.name} ${serial + 1}`,
        antennaOwnerWallTex(spec.owner),
        antennaOwnerFloorTex(spec.owner, type),
        protectedCells,
      );
      if (room) {
        paintRoomFaction(world, room, spec.owner);
        decorateAntennaRoomByType(world, room, rng, spec.owner);
        openAntennaRoomDoor(world, room, side === 'north' ? 'south' : 'north');
      }
      cursor += rw + 3;
      serial++;
    }
  }
}

function carveAntennaHall(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  protectedCells: Uint8Array,
  floorTex: Tex,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) setRouteFloor(world, x + dx, y + dy, floorTex, protectedCells);
  }
}

function tryStampAntennaRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  protectedCells: Uint8Array,
): Room | undefined {
  if (!canStampAntennaRoom(world, x, y, w, h, protectedCells)) return undefined;
  return stampNamedRoom(world, type, x, y, w, h, name, wallTex, floorTex);
}

function canStampAntennaRoom(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  protectedCells: Uint8Array,
): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (protectedCells[ci] || world.aptMask[ci] || world.hermoWall[ci] || world.doors.has(ci)) return false;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.ABYSS) return false;
      if (world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function openAntennaRoomDoor(
  world: World,
  room: Room,
  side: 'north' | 'south' | 'west' | 'east',
  state = DoorState.CLOSED,
): boolean {
  const horizontal = side === 'north' || side === 'south';
  const span = horizontal ? room.w : room.h;
  const mid = Math.floor(span / 2);
  const sx = side === 'east' ? 1 : side === 'west' ? -1 : 0;
  const sy = side === 'south' ? 1 : side === 'north' ? -1 : 0;
  for (let offset = 0; offset <= mid; offset++) {
    for (const signed of offset === 0 ? [0] : [-offset, offset]) {
      const doorX = horizontal ? room.x + mid + signed : room.x + (sx > 0 ? room.w : -1);
      const doorY = horizontal ? room.y + (sy > 0 ? room.h : -1) : room.y + mid + signed;
      const insideX = doorX - sx;
      const insideY = doorY - sy;
      const outsideX = doorX + sx;
      const outsideY = doorY + sy;
      const insideIdx = world.idx(insideX, insideY);
      const outsideIdx = world.idx(outsideX, outsideY);
      if (world.roomMap[insideIdx] !== room.id) continue;
      if (world.cells[outsideIdx] !== Cell.FLOOR && world.cells[outsideIdx] !== Cell.WATER && world.cells[outsideIdx] !== Cell.DOOR) {
        setRouteFloor(world, outsideX, outsideY, room.floorTex);
      }
      placeAntennaGate(world, doorX, doorY, room.id, -1, '', state);
      return true;
    }
  }
  return false;
}

function markHermeticRoomShell(world: World, room: Room): void {
  room.sealed = true;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.WALL) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
}

function antennaMicroRoomType(owner: ZoneFaction, serial: number): RoomType {
  if (serial % 11 === 0) return RoomType.BATHROOM;
  if (serial % 7 === 0) return RoomType.KITCHEN;
  if (owner === ZoneFaction.SCIENTIST) return serial % 3 === 0 ? RoomType.OFFICE : RoomType.PRODUCTION;
  if (owner === ZoneFaction.LIQUIDATOR) return serial % 4 === 0 ? RoomType.HQ : serial % 2 === 0 ? RoomType.STORAGE : RoomType.OFFICE;
  if (owner === ZoneFaction.CULTIST) return serial % 3 === 0 ? RoomType.COMMON : RoomType.STORAGE;
  if (owner === ZoneFaction.WILD) return serial % 2 === 0 ? RoomType.SMOKING : RoomType.STORAGE;
  return serial % 3 === 0 ? RoomType.LIVING : RoomType.COMMON;
}

function antennaOwnerWallTex(owner: ZoneFaction): Tex {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return Tex.METAL;
    case ZoneFaction.SCIENTIST: return Tex.PIPE;
    case ZoneFaction.CULTIST: return Tex.DARK;
    case ZoneFaction.WILD: return Tex.BRICK;
    case ZoneFaction.CITIZEN:
    default: return Tex.PANEL;
  }
}

function antennaOwnerFloorTex(owner: ZoneFaction, type: RoomType): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.MEDICAL) return Tex.F_TILE;
  if (type === RoomType.KITCHEN) return Tex.F_LINO;
  if (owner === ZoneFaction.CULTIST) return Tex.F_CARPET;
  if (owner === ZoneFaction.CITIZEN) return Tex.F_LINO;
  return Tex.F_CONCRETE;
}

function decorateAntennaRoomByType(world: World, room: Room, rng: () => number, owner: ZoneFaction): void {
  const fixtures = Math.max(1, Math.min(5, Math.floor(room.w * room.h / 24)));
  for (let i = 0; i < fixtures; i++) {
    const x = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
    const y = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
    let feature = Feature.TABLE;
    switch (room.type) {
      case RoomType.KITCHEN: feature = i % 2 === 0 ? Feature.STOVE : Feature.SINK; break;
      case RoomType.BATHROOM: feature = i % 2 === 0 ? Feature.TOILET : Feature.SINK; break;
      case RoomType.STORAGE: feature = Feature.SHELF; break;
      case RoomType.MEDICAL: feature = i % 2 === 0 ? Feature.BED : Feature.APPARATUS; break;
      case RoomType.PRODUCTION: feature = i % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS; break;
      case RoomType.OFFICE: feature = i % 2 === 0 ? Feature.DESK : Feature.CHAIR; break;
      case RoomType.HQ: feature = i % 2 === 0 ? Feature.DESK : owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP; break;
      case RoomType.SMOKING: feature = i % 2 === 0 ? Feature.TABLE : Feature.CHAIR; break;
      case RoomType.LIVING: feature = i % 2 === 0 ? Feature.BED : Feature.TABLE; break;
      case RoomType.COMMON:
      case RoomType.CORRIDOR:
      default: feature = i % 3 === 0 ? Feature.LAMP : i % 2 === 0 ? Feature.TABLE : Feature.CHAIR; break;
    }
    setFeatureIfFloor(world, x, y, feature);
  }
}

function applyAntennaCourtTerritory(world: World): void {
  const seeds = antennaTerritorySeeds(world);
  for (let i = 0; i < W * W; i++) {
    const x = i % W;
    const y = (i / W) | 0;
    setTerritoryOwnerAtIndex(world, i, nearestAntennaTerritoryOwner(world, x, y, seeds));
  }
}

function antennaTerritorySeeds(world: World): AntennaTerritorySeed[] {
  const seeds: AntennaTerritorySeed[] = [
    { owner: ZoneFaction.LIQUIDATOR, x: CX + 48, y: CY - 12, weight: 1.38 },
    { owner: ZoneFaction.LIQUIDATOR, x: 760, y: 254, weight: 1.22 },
    { owner: ZoneFaction.LIQUIDATOR, x: 870, y: CY, weight: 1.2 },
    { owner: ZoneFaction.SCIENTIST, x: CX, y: 154, weight: 1.28 },
    { owner: ZoneFaction.SCIENTIST, x: 360, y: 360, weight: 1.08 },
    { owner: ZoneFaction.CITIZEN, x: 154, y: CY, weight: 1.12 },
    { owner: ZoneFaction.CITIZEN, x: CX, y: 870, weight: 1.04 },
    { owner: ZoneFaction.WILD, x: 770, y: 770, weight: 1.08 },
    { owner: ZoneFaction.WILD, x: 254, y: 770, weight: 0.98 },
    { owner: ZoneFaction.CULTIST, x: 254, y: 254, weight: 0.92 },
  ];
  for (const room of world.rooms) {
    const owner = antennaRoomOwnerOverride(room);
    if (owner === undefined) continue;
    seeds.push({
      owner,
      x: room.x + (room.w >> 1),
      y: room.y + (room.h >> 1),
      weight: room.type === RoomType.HQ ? antennaOwnerTerritoryWeight(owner) : 0.78,
    });
  }
  return seeds;
}

function nearestAntennaTerritoryOwner(world: World, x: number, y: number, seeds: readonly AntennaTerritorySeed[]): ZoneFaction {
  let best = ZoneFaction.LIQUIDATOR;
  let bestScore = Infinity;
  for (const seed of seeds) {
    const ownerTarget = ANTENNA_TERRITORY_TARGETS.find(entry => entry.owner === seed.owner)?.share ?? 0.1;
    const ownerScale = 0.72 + ownerTarget * 2.2;
    const d2 = world.dist2(x, y, seed.x, seed.y);
    const scale = Math.max(0.1, seed.weight * ownerScale);
    const wave = Math.sin((x + seed.owner * 31) * 0.019) + Math.cos((y - seed.owner * 17) * 0.017);
    const score = d2 / (scale * scale) - wave * 520;
    if (score < bestScore) {
      bestScore = score;
      best = seed.owner;
    }
  }
  return best;
}

function antennaOwnerTerritoryWeight(owner: ZoneFaction): number {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return 1.46;
    case ZoneFaction.SCIENTIST: return 1.34;
    case ZoneFaction.CITIZEN: return 1.16;
    case ZoneFaction.WILD: return 1.08;
    case ZoneFaction.CULTIST: return 0.96;
    default: return 1;
  }
}

function setFeatureIfUnprotectedFloor(
  world: World,
  x: number,
  y: number,
  protectedCells: Uint8Array,
  feature: Feature,
): void {
  const ci = world.idx(x, y);
  if (protectedCells[ci] || world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = feature;
}

function placeAntennaGate(
  world: World,
  x: number,
  y: number,
  roomA: number,
  roomB: number,
  keyId: string,
  state: DoorState = keyId ? DoorState.LOCKED : DoorState.CLOSED,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.DOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.features[ci] = Feature.NONE;
  world.doors.set(ci, {
    idx: ci,
    state,
    roomA,
    roomB,
    keyId,
    timer: 0,
  });
  const a = world.rooms[roomA];
  const b = world.rooms[roomB];
  if (a && !a.doors.includes(ci)) a.doors.push(ci);
  if (b && !b.doors.includes(ci)) b.doors.push(ci);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value | 0));
}

function clampQuality(value: number): number {
  return Math.max(0, Math.min(5, value | 0));
}

function stampAntennaCourtRooms(world: World): Record<string, Room> {
  const courtyard = stampNamedRoom(world, RoomType.COMMON, CX - 22, CY - 19, 44, 34, 'Антенный двор', Tex.PANEL, Tex.F_CONCRETE);
  return {
    courtyard,
    radioClub: stampNamedRoom(world, RoomType.PRODUCTION, CX - 38, CY - 14, 12, 12, 'Радиоклуб взрослых детей', Tex.METAL, Tex.F_CONCRETE),
    relay: stampNamedRoom(world, RoomType.PRODUCTION, CX + 26, CY - 14, 12, 12, 'Релейная будка', Tex.PIPE, Tex.F_CONCRETE),
    archive: stampNamedRoom(world, RoomType.OFFICE, CX - 10, CY - 34, 20, 10, 'Архив мониторинга', Tex.MARBLE, Tex.F_MARBLE_TILE),
    battery: stampNamedRoom(world, RoomType.STORAGE, CX + 14, CY - 34, 10, 10, 'Батарейная кладовая', Tex.METAL, Tex.F_CONCRETE),
    dorm: stampNamedRoom(world, RoomType.LIVING, CX - 10, CY + 19, 20, 9, 'Операторская спальня', Tex.PANEL, Tex.F_LINO),
    jammer: stampNamedRoom(world, RoomType.SMOKING, CX - 38, CY + 1, 12, 11, 'Кабина глушения', Tex.DARK, Tex.F_CARPET),
    inspection: stampNamedRoom(world, RoomType.OFFICE, CX + 26, CY + 1, 12, 11, 'Пост сигнал-инспекции', Tex.MARBLE, Tex.F_RED_CARPET),
    entry: stampNamedRoom(world, RoomType.CORRIDOR, CX - 24, CY + 33, 11, 8, 'Входной лифтовый тамбур', Tex.CONCRETE, Tex.F_CONCRETE),
    exit: stampNamedRoom(world, RoomType.CORRIDOR, CX - 24, CY - 44, 11, 8, 'Верхний лифтовый тамбур', Tex.CONCRETE, Tex.F_CONCRETE),
  };
}

function stampNamedRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        world.floorTex[ci] = floorTex;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
  return room;
}

function retuneAntennaZones(world: World, rooms: Record<string, Room>): void {
  world.factionControl.fill(ZoneFaction.CITIZEN);
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    zone.level = d < 70 ? 3 : 2;
    zone.faction = ZoneFaction.CITIZEN;
  }
  paintRoomFaction(world, rooms.inspection, ZoneFaction.LIQUIDATOR);
  paintRoomFaction(world, rooms.battery, ZoneFaction.LIQUIDATOR);
  paintRoomFaction(world, rooms.archive, ZoneFaction.CITIZEN);
  paintRoomFaction(world, rooms.jammer, ZoneFaction.WILD);
  paintRoomFaction(world, rooms.relay, ZoneFaction.CITIZEN);
}

function paintRoomFaction(world: World, room: Room, faction: ZoneFaction): void {
  const zid = world.zoneMap[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))];
  if (world.zones[zid]) world.zones[zid].faction = faction;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.factionControl[ci] = faction;
    }
  }
}

function decorateAntennaCourt(world: World, rooms: Record<string, Room>): void {
  const court = rooms.courtyard;
  for (let dy = 4; dy < court.h - 3; dy += 7) {
    for (let dx = 5; dx < court.w - 4; dx += 8) {
      placeAntennaMast(world, court.x + dx, court.y + dy);
    }
  }
  for (let dx = 2; dx < court.w - 2; dx += 5) setFeatureIfFloor(world, court.x + dx, court.y + 1, Feature.APPARATUS);
  for (let dx = 3; dx < court.w - 3; dx += 7) setFeatureIfFloor(world, court.x + dx, court.y + court.h - 2, Feature.LAMP);

  for (const room of [rooms.radioClub, rooms.relay, rooms.archive, rooms.jammer, rooms.inspection]) {
    setFeatureIfFloor(world, room.x + 1, room.y + 1, Feature.LAMP);
    setFeatureIfFloor(world, room.x + 2, room.y + 2, Feature.APPARATUS);
    setFeatureIfFloor(world, room.x + room.w - 3, room.y + 2, Feature.MACHINE);
    setFeatureIfFloor(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TABLE);
    setFeatureIfFloor(world, room.x + room.w - 4, room.y + room.h - 3, Feature.CHAIR);
  }

  setFeatureIfFloor(world, rooms.battery.x + 2, rooms.battery.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, rooms.battery.x + 6, rooms.battery.y + 3, Feature.MACHINE);
  setFeatureIfFloor(world, rooms.dorm.x + 3, rooms.dorm.y + 4, Feature.BED);
  setFeatureIfFloor(world, rooms.dorm.x + 9, rooms.dorm.y + 4, Feature.TABLE);
  setFeatureIfFloor(world, rooms.entry.x + 5, rooms.entry.y + 2, Feature.LAMP);
  setFeatureIfFloor(world, rooms.exit.x + 5, rooms.exit.y + 2, Feature.LAMP);
}

function placeAntennaMast(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.METAL;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    setFeatureIfFloor(world, x + dx, y + dy, Feature.APPARATUS);
  }
}

function setFeatureIfFloor(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function placeAuthoredSignalScreens(world: World, rooms: Record<string, Room>): void {
  setWallScreen(world, rooms.courtyard.x + 7, rooms.courtyard.y - 1, 3);
  setWallScreen(world, rooms.courtyard.x + 18, rooms.courtyard.y - 1, 4);
  setWallScreen(world, rooms.courtyard.x + 29, rooms.courtyard.y - 1, 7);
  setWallScreen(world, rooms.radioClub.x + 4, rooms.radioClub.y - 1, 0);
  setWallScreen(world, rooms.relay.x + rooms.relay.w, rooms.relay.y + 4, 6);
  setWallScreen(world, rooms.archive.x + 8, rooms.archive.y + rooms.archive.h, 7);
  setWallScreen(world, rooms.jammer.x + 5, rooms.jammer.y - 1, 2);
}

function setWallScreen(world: World, x: number, y: number, variant: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.WALL) return;
  const frame = Math.abs((x * 17 + y * 31 + variant * 7) | 0) % SCREEN_FRAMES;
  world.wallTex[ci] = (Tex.SCREEN_BASE + variant * SCREEN_FRAMES + frame) as Tex;
  world.features[ci] = Feature.SCREEN;
  if (!world.screenCells.includes(ci)) world.screenCells.push(ci);
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  room: Room,
  dx: number,
  dy: number,
  angle: number,
  extra?: Partial<Entity>,
): Entity {
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, room.x + dx + 0.5, room.y + dy + 0.5, {
    angle,
    extra,
  });
}

function spawnSignalMonsters(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  rooms: Record<string, Room>,
): void {
  spawnMonster(world, entities, nextId, MonsterKind.EYE, rooms.courtyard.x + 21, rooms.courtyard.y + 8);
  spawnMonster(world, entities, nextId, MonsterKind.EYE, rooms.courtyard.x + 29, rooms.courtyard.y + 22);
  spawnMonster(world, entities, nextId, MonsterKind.REBAR, rooms.relay.x + 3, rooms.relay.y + 7);
  spawnMonster(world, entities, nextId, MonsterKind.SHADOW, rooms.archive.x + 16, rooms.archive.y + 6);
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp: def.hp,
    maxHp: def.hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: CX, ty: CY, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

function addContainer(
  world: World,
  id: number,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  owner?: Entity,
): void {
  const x = room.x + dx;
  const y = room.y + dy;
  const ci = world.idx(x, y);
  world.addContainer({
    id,
    x,
    y,
    floor: ANTENNA_COURT_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory,
    capacitySlots: 10,
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction,
    access,
    lockDifficulty: access === 'locked' || access === 'owner' ? 3 : undefined,
    discovered: true,
    tags: [DESIGN_FLOOR_ID, 'signal', 'radio', access === 'owner' ? 'theft' : 'loot'],
  });
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count: number): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function dropDesk(entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.BILLBOARD,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.DESK,
    spriteScale: 0.55,
  });
}

function placeFixedLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  const bi = world.idx(x + 1, y);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

export const ANTENNA_COURT_DEBUG_ENTRY = {
  routeId: DESIGN_FLOOR_ID,
  z: ANTENNA_COURT_ROUTE_Z,
  generator: 'generateAntennaCourtDesignFloor',
} as const;

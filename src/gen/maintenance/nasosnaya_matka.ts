/* ── Monster_10: Насосная Матка — local water-pressure boss room ─ */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex, msg,
  type Entity, type GameState, type Room, type WorldContainer,
  type WorldEvent, type WorldEventSeverity,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { changeResourceStock } from '../../systems/economy';
import { getRecentEvents, publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature, setWater,
  spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

export const NASOSNAYA_MATKA_ID = 'nasosnaya_matka';

const OUTCOME_TAG = 'nasosnaya_outcome';
const ROOM_PREFIX = 'Насосная Матка';
const CORE_NAME = 'Насосная Матка';
const WATCHER_ID = 'monster_10_nasosnaya_kira';
const VALVE_QUEST_ID = 'monster_10_nasosnaya_close_valves';
const CORE_QUEST_ID = 'monster_10_nasosnaya_kill_core';
const ROOM_W = 43;
const ROOM_H = 25;
const ADD_CAP = 5;

const KIRA_DEF: PlotNpcDef = {
  name: 'Кира Манометр',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 125,
  maxHp: 125,
  money: 85,
  speed: 0.95,
  inventory: [
    { defId: 'manometer', count: 1 },
    { defId: 'ammo_harpoon', count: 2 },
    { defId: 'wrench', count: 1 },
  ],
  talkLines: [
    'Кира Манометр. Здесь насос дышит не воздухом, а угрями.',
    'Иди по сухому краю. Три бирки с вентилей — потом стреляй в Матку, не раньше.',
    'Гарпун держит воду честнее пули. Электрика тоже помогает, если не стоять в лотке.',
  ],
  talkLinesPost: [
    'Сухой край выдержал. Давление уже не командует ногами.',
    'Если стрелка снова дрогнет - считай бирки, а не чужие советы.',
  ],
};

registerSideQuest(WATCHER_ID, KIRA_DEF, [
  {
    id: VALVE_QUEST_ID,
    giverNpcId: WATCHER_ID,
    type: QuestType.FETCH,
    desc: 'Кира Манометр: «Сними три бирки с вентилей по сухому периметру. Давление уйдет в лотки, а не в тебя.»',
    targetItem: 'valve_tag',
    targetCount: 3,
    rewardItem: 'ammo_harpoon',
    rewardCount: 3,
    extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'wrench', count: 1 }],
    relationDelta: 12,
    xpReward: 80,
    moneyReward: 55,
    eventSeverity: 4,
    eventTags: [NASOSNAYA_MATKA_ID, 'pump', 'water', 'boss', 'pressure', 'valve'],
    eventData: { system: NASOSNAYA_MATKA_ID, valvesNeeded: 3 },
  },
  {
    id: CORE_QUEST_ID,
    giverNpcId: WATCHER_ID,
    type: QuestType.KILL,
    desc: 'Кира Манометр: «После трех вентилей добей Насосную Матку. До этого она только учит воду кусаться.»',
    targetMonsterKind: MonsterKind.MATKA,
    killNeeded: 1,
    rewardItem: 'manometer',
    rewardCount: 1,
    extraRewards: [{ defId: 'pipe', count: 1 }, { defId: 'filtered_water', count: 2 }],
    relationDelta: 18,
    xpReward: 150,
    moneyReward: 120,
    requiresSideQuestDone: VALVE_QUEST_ID,
    eventSeverity: 5,
    eventTags: [NASOSNAYA_MATKA_ID, 'monster', 'pump', 'water', 'boss', 'pressure'],
    eventData: { system: NASOSNAYA_MATKA_ID, rewardResourceId: 'drink_water' },
  },
]);

interface MonsterOptions {
  name?: string;
  hpMult?: number;
  speedMult?: number;
  waterOnly?: boolean;
  matkaCore?: boolean;
}

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): void {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
}

function setPipeBlock(ctx: MaintContentCtx, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.world.cells[ci] = Cell.WALL;
  ctx.world.wallTex[ci] = Tex.PIPE;
  ctx.world.features[ci] = Feature.NONE;
  ctx.world.roomMap[ci] = -1;
}

function restoreRoomMap(ctx: MaintContentCtx, room: Room): void {
  for (let ly = 1; ly < room.h - 1; ly++) {
    for (let lx = 1; lx < room.w - 1; lx++) {
      const ci = ctx.world.idx(room.x + lx, room.y + ly);
      if (ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) ctx.world.roomMap[ci] = room.id;
    }
  }
}

function openInterior(ctx: MaintContentCtx, room: Room): void {
  for (let ly = 1; ly < room.h - 1; ly++) {
    for (let lx = 1; lx < room.w - 1; lx++) {
      const x = room.x + lx;
      const y = room.y + ly;
      openTile(ctx.world, x, y, Tex.F_CONCRETE);
      const ci = ctx.world.idx(x, y);
      ctx.world.roomMap[ci] = room.id;
      ctx.world.features[ci] = Feature.NONE;
      ctx.world.fog[ci] = 0;
    }
  }
}

function dryLocal(lx: number, ly: number): boolean {
  if (lx <= 2 || lx >= ROOM_W - 3 || ly <= 2 || ly >= ROOM_H - 3) return true;
  if (ly >= 11 && ly <= 13) return true;
  if (lx >= 5 && lx <= 7) return true;
  if (lx >= ROOM_W - 8 && lx <= ROOM_W - 6) return true;
  if (lx >= 18 && lx <= 24 && ly >= 9 && ly <= 15) return true;
  return false;
}

function waterLaneLocal(lx: number, ly: number): boolean {
  const horizontalLane = (ly >= 6 && ly <= 8) || (ly >= 16 && ly <= 18);
  const verticalLane = lx >= 20 && lx <= 22 && ly >= 4 && ly <= 20;
  return (horizontalLane || verticalLane) && !dryLocal(lx, ly);
}

function applyWaterLanes(ctx: MaintContentCtx, room: Room): void {
  let fogChanged = false;
  for (let ly = 1; ly < room.h - 1; ly++) {
    for (let lx = 1; lx < room.w - 1; lx++) {
      if (!waterLaneLocal(lx, ly)) continue;
      const x = room.x + lx;
      const y = room.y + ly;
      setWater(ctx.world, x, y);
      const ci = ctx.world.idx(x, y);
      ctx.world.roomMap[ci] = room.id;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 18);
      fogChanged = true;
    }
  }
  if (fogChanged) ctx.world.markFogDirty();
}

function addPipeBaffles(ctx: MaintContentCtx, room: Room): void {
  for (let y = room.y + 5; y <= room.y + 9; y++) {
    if (y !== room.y + 7) setPipeBlock(ctx, room.x + 15, y);
    if (y !== room.y + 7) setPipeBlock(ctx, room.x + 28, y);
  }
  for (let y = room.y + 15; y <= room.y + 19; y++) {
    if (y !== room.y + 17) setPipeBlock(ctx, room.x + 13, y);
    if (y !== room.y + 17) setPipeBlock(ctx, room.x + 30, y);
  }
  for (let x = room.x + 17; x <= room.x + 25; x++) {
    if (x !== room.x + 21) setPipeBlock(ctx, x, room.y + 10);
    if (x !== room.x + 21) setPipeBlock(ctx, x, room.y + 14);
  }
}

function decoratePumpRoom(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 10; dx <= 32; dx += 4) {
    setFeature(ctx.world, room.x + dx, room.y + 3, Feature.MACHINE);
    setFeature(ctx.world, room.x + dx, room.y + ROOM_H - 4, Feature.APPARATUS);
  }
  for (const [lx, ly] of [
    [10, 12], [15, 12], [28, 12], [33, 12],
    [21, 5], [21, 19],
  ] as const) {
    setFeature(ctx.world, room.x + lx, room.y + ly, Feature.LAMP);
  }
  setFeature(ctx.world, room.x + 21, room.y + 3, Feature.SCREEN);
  stampSurfaceSplat(ctx.world, room.x + 21, room.y + 3, 0.5, 0.5, 1.4, 120, room.id * 911 + 10, 30, 170, 190, true);
  stampSurfaceSplat(ctx.world, room.x + 21, room.y + 12, 0.5, 0.5, 4.8, 90, room.id * 911 + 11, 10, 60, 72);
  for (let i = 0; i < 3; i++) {
    stampSurfaceSplat(ctx.world, room.x + 16 + i * 5, room.y + 12, 0.5, 0.5, 1.6, 125, room.id * 911 + i, 80, 25, 35);
  }
}

function addValveControl(
  ctx: MaintContentCtx,
  room: Room,
  valveNo: number,
  lx: number,
  ly: number,
  label: string,
): void {
  const x = room.x + lx;
  const y = room.y + ly;
  setFeature(ctx.world, x, y, Feature.APPARATUS);
  setFeature(ctx.world, x + (lx < ROOM_W / 2 ? 1 : -1), y, Feature.MACHINE);
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.42, 150, room.id * 1200 + valveNo, 125, 170, 120, true);
  addContainer(ctx, room, x, y, {
    kind: ContainerKind.EMERGENCY_BOX,
    name: `Вентиль ${valveNo}: ${label}`,
    inventory: [
      { defId: 'valve_tag', count: 1 },
      { defId: valveNo === 2 ? 'manometer' : 'wrench', count: 1 },
    ],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: [NASOSNAYA_MATKA_ID, 'valve', 'pressure', 'pump', 'water', 'boss', `valve_${valveNo}`],
  });
}

function addRewardLocker(ctx: MaintContentCtx, room: Room): void {
  const x = room.x + 23;
  const y = room.y + 12;
  setFeature(ctx.world, x, y, Feature.SHELF);
  addContainer(ctx, room, x, y, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Сухой шкаф Насосной Матки',
    inventory: [
      { defId: 'manometer', count: 1 },
      { defId: 'valve_tag', count: 1 },
      { defId: 'pipe', count: 1 },
      { defId: 'filtered_water', count: 3 },
      { defId: 'ammo_harpoon', count: 3 },
      { defId: 'ammo_energy', count: 1 },
    ],
    capacitySlots: 8,
    access: 'public',
    discovered: true,
    tags: [NASOSNAYA_MATKA_ID, 'reward', 'pressure', 'pump', 'water', 'boss'],
  });
}

function zoneLevelAt(ctx: MaintContentCtx, x: number, y: number): number {
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  return (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 6) : 6;
}

function spawnNasosnayaMonster(
  ctx: MaintContentCtx,
  kind: MonsterKind,
  x: number,
  y: number,
  options: MonsterOptions = {},
): Entity | null {
  const ci = ctx.world.idx(x, y);
  if (options.waterOnly ? ctx.world.cells[ci] !== Cell.WATER : ctx.world.solid(x, y)) return null;

  const def = MONSTERS[kind];
  if (!def) return null;
  const level = zoneLevelAt(ctx, x, y);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level) * (options.hpMult ?? 1)));
  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level) * (options.speedMult ?? 1),
    sprite: def.sprite,
    hp,
    maxHp: hp,
    name: options.name,
    isFemale: options.matkaCore ? true : undefined,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    matkaTimer: options.matkaCore ? Number.POSITIVE_INFINITY : undefined,
  };
  ctx.entities.push(monster);
  return monster;
}

function observedValveEvents(state: GameState): number {
  let count = 0;
  for (const event of getRecentEvents(state, { limit: 96 })) {
    if (!event.tags.includes(OUTCOME_TAG)) continue;
    if (!event.tags.includes(NASOSNAYA_MATKA_ID) || !event.tags.includes('valve_closed')) continue;
    count++;
  }
  return Math.min(3, count);
}

function valvesClosed(state: GameState): number {
  if (state.quests.some(q => q.sideQuestId === VALVE_QUEST_ID && q.done && !q.failed)) return 3;
  return observedValveEvents(state);
}

function publishValveChange(
  state: GameState,
  event: WorldEvent,
  closed: number,
  severity: WorldEventSeverity,
): void {
  const pressure = Math.max(0, 3 - closed);
  publishEvent(state, {
    type: 'player_use_item',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    itemId: 'valve_tag',
    itemName: 'Бирка вентиля',
    itemCount: closed,
    severity,
    privacy: 'local',
    tags: [OUTCOME_TAG, NASOSNAYA_MATKA_ID, 'monster', 'pump', 'water', 'boss', 'pressure', 'valve_closed'],
    data: {
      system: NASOSNAYA_MATKA_ID,
      action: 'valve_closed',
      pressure,
      valvesClosed: closed,
      sourceEventId: event.id,
      sourceContainerName: event.data?.containerName,
    },
  });
}

function publishCoreOutcome(state: GameState, event: WorldEvent): void {
  const closed = valvesClosed(state);
  const drained = closed >= 3;
  if (drained) {
    const stockChanged = changeResourceStock(state, 'drink_water', 6, event.floor);
    state.msgs.push(msg('Насосная Матка захлебнулась. Шкаф на сухом острове можно разобрать спокойно.', state.time, '#6cf'));
    publishEvent(state, {
      type: 'room_produced_items',
      floor: event.floor,
      zoneId: event.zoneId,
      roomId: event.roomId,
      x: event.x,
      y: event.y,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetId: event.targetId,
      targetName: 'Насосная Матка осушена',
      itemId: 'filtered_water',
      itemName: 'Вода фильтрованная',
      itemCount: 3,
      monsterKind: MonsterKind.MATKA,
      severity: 5,
      privacy: 'local',
      tags: [OUTCOME_TAG, NASOSNAYA_MATKA_ID, 'monster', 'pump', 'water', 'boss', 'pressure', 'cleared'],
      data: {
        system: NASOSNAYA_MATKA_ID,
        valvesClosed: closed,
        sourceEventId: event.id,
        resourceId: 'drink_water',
        resourceDelta: 6,
        stockChanged,
      },
    });
    return;
  }

  state.msgs.push(msg('Матка умерла, но давление не сброшено: вода в лотках осталась злой.', state.time, '#f84'));
  publishEvent(state, {
    type: 'room_lacked_resources',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: 'Насосная Матка сорвала давление',
    itemId: 'water',
    itemName: 'питьевая вода',
    monsterKind: MonsterKind.MATKA,
    severity: 4,
    privacy: 'local',
    tags: [OUTCOME_TAG, NASOSNAYA_MATKA_ID, 'monster', 'pump', 'water', 'boss', 'pressure', 'failure'],
    data: {
      system: NASOSNAYA_MATKA_ID,
      valvesClosed: closed,
      pressure: 3 - closed,
      sourceEventId: event.id,
      failure: 'core_killed_before_drain',
    },
  });
}

function handleNasosnayaEvents(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(OUTCOME_TAG)) return;

  const valveTake = (event.type === 'container_opened' || event.type === 'item_stolen') &&
    event.itemId === 'valve_tag' &&
    event.tags.includes(NASOSNAYA_MATKA_ID);
  if (valveTake) {
    const previous = observedValveEvents(state);
    if (previous >= 3) return;
    const closed = Math.min(3, previous + 1);
    state.msgs.push(msg(
      closed >= 3
        ? 'Третий вентиль снят с давления. Сухой периметр держит бой.'
        : `Вентиль ${closed}/3 сорван с напора. Угри стучат тише.`,
      state.time,
      closed >= 3 ? '#6cf' : '#8cf',
    ));
    publishValveChange(state, event, closed, closed >= 3 ? 4 : 3);
    return;
  }

  if (event.type === 'quest_completed' && event.data?.sideQuestId === VALVE_QUEST_ID && observedValveEvents(state) < 3) {
    state.msgs.push(msg('Кира приняла три бирки: давление Насосной Матки сброшено по акту.', state.time, '#6cf'));
    publishValveChange(state, event, 3, 4);
    return;
  }

  if (event.type === 'player_kill_monster' && event.monsterKind === MonsterKind.MATKA && event.targetName === CORE_NAME) {
    publishCoreOutcome(state, event);
  }
}

registerWorldEventObserver(handleNasosnayaEvents);

export function generateNasosnayaMatka(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, ROOM_W + 2, ROOM_H + 2, 150, 310);

  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    pos.x,
    pos.y,
    ROOM_W,
    ROOM_H,
    `${ROOM_PREFIX}: давление 3/3 клапаны открыты`,
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  openInterior(ctx, room);
  applyWaterLanes(ctx, room);
  addPipeBaffles(ctx, room);
  decoratePumpRoom(ctx, room);

  addValveControl(ctx, room, 1, 4, 3, 'левый сухой периметр');
  addValveControl(ctx, room, 2, ROOM_W - 5, 3, 'правый сухой периметр');
  addValveControl(ctx, room, 3, 4, ROOM_H - 4, 'нижний обратный ход');
  addRewardLocker(ctx, room);

  spawnPlotNpc(ctx, WATCHER_ID, KIRA_DEF, room.x + 7, room.y + 2, Math.PI / 2, {
    weapon: 'harpoon_gun',
  });

  spawnNasosnayaMonster(ctx, MonsterKind.MATKA, room.x + 20, room.y + 12, {
    name: CORE_NAME,
    hpMult: 1.15,
    speedMult: 0.8,
    matkaCore: true,
  });

  const addPlacements = [
    [MonsterKind.TUBE_EEL, room.x + 10, room.y + 7, true, 'Напорный трубный угорь'],
    [MonsterKind.TUBE_EEL, room.x + 32, room.y + 7, true, 'Напорный трубный угорь'],
    [MonsterKind.TUBE_EEL, room.x + 13, room.y + 17, true, 'Напорный трубный угорь'],
    [MonsterKind.TUBE_EEL, room.x + 30, room.y + 17, true, 'Напорный трубный угорь'],
    [MonsterKind.POLZUN, room.x + 35, room.y + 12, false, 'Ползун у сухого края'],
  ] as const;
  for (let i = 0; i < Math.min(ADD_CAP, addPlacements.length); i++) {
    const [kind, x, y, waterOnly, name] = addPlacements[i];
    spawnNasosnayaMonster(ctx, kind, x, y, {
      name,
      waterOnly,
      hpMult: kind === MonsterKind.POLZUN ? 0.95 : 0.9,
      speedMult: kind === MonsterKind.TUBE_EEL ? 1.05 : 1,
    });
  }

  restoreRoomMap(ctx, room);
}

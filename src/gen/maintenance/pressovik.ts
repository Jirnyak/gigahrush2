/* ── Monster_09 Pressovik — production-line timing room ──────── */

import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  msg,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { registerCellHazardSite, cleanCellHazardsNear } from '../../systems/cell_hazards';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { placeDoor } from '../shared';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const CONTENT_TAG = 'pressovik';
const STOP_TAG = 'pressovik_stop';
const OUTPUT_TAG = 'pressovik_output';
const OUTCOME_TAG = 'pressovik_outcome';
const STOP_QUEST_ID = 'pressovik_manual_stop';
const STOP_ITEMS = new Set(['gear', 'spring', 'fuse']);

const MASTER_DEF: PlotNpcDef = {
  name: 'Нина Стопорная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 130,
  maxHp: 130,
  money: 70,
  speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'spring', count: 1 },
    { defId: 'relay_diagram', count: 1 },
  ],
  talkLines: [
    'Нина Стопорная. Прессовик давит не людей, а спешку. Люди просто часто похожи на спешку.',
    'Смотри на лампы и красный пол: один удар, одна пауза, один шаг в белую дорожку.',
    'Шестерня в стопор — и плита встанет. Без шестерни иди по обходу, но не веди за собой арматуру.',
  ],
  talkLinesPost: [
    'Прессовик молчит. Теперь линия опасна только тем, что начальство услышит тишину.',
    'Листы и пружины забирай на выходе, пока смена пишет акт задним числом.',
  ],
};

registerSideQuest('pressovik_stop_master', MASTER_DEF, [{
  id: STOP_QUEST_ID,
  giverNpcId: 'pressovik_stop_master',
  type: QuestType.FETCH,
  desc: 'Нина: «Одна шестерня в стопор Прессовика. Переждёшь удар, подойдёшь к пульту и линия встанет без похорон.»',
  targetItem: 'gear',
  targetCount: 1,
  rewardItem: 'metal_sheet',
  rewardCount: 2,
  extraRewards: [{ defId: 'spring', count: 1 }],
  relationDelta: 9,
  xpReward: 65,
  moneyReward: 45,
  eventSeverity: 4,
  eventTags: [CONTENT_TAG, 'monster', 'press', 'timing', 'production', 'stopped'],
  eventData: {
    pressovikAction: 'manual_stop',
    roomRule: 'timing_safe_lane',
  },
}]);

interface PressovikRuntime {
  line: Room;
  bypass: Room;
  dangerCells: number[];
  centerX: number;
  centerY: number;
  radius: number;
  stopped: boolean;
  crossed: boolean;
  worldRef: MaintContentCtx['world'];
}

let latestRuntime: PressovikRuntime | null = null;
const runtimeByContainerId = new Map<number, PressovikRuntime>();

function eventDataString(event: WorldEvent, key: string): string | undefined {
  const value = event.data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function pressTags(extra: readonly string[] = []): string[] {
  const tags = [CONTENT_TAG, 'monster', 'press', 'timing', 'production'];
  for (const tag of extra) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

function runtimeForEvent(event: WorldEvent): PressovikRuntime | null {
  if (event.containerId !== undefined) {
    const byContainer = runtimeByContainerId.get(event.containerId);
    if (byContainer) return byContainer;
  }
  if (latestRuntime && (event.roomId === latestRuntime.line.id || event.roomId === latestRuntime.bypass.id)) return latestRuntime;
  return latestRuntime;
}

function stopRuntime(state: Parameters<typeof publishEvent>[0], event: WorldEvent, reason: string): void {
  const runtime = runtimeForEvent(event);
  if (!runtime || runtime.stopped) return;
  runtime.stopped = true;

  const cleaned = cleanCellHazardsNear(
    runtime.worldRef,
    runtime.centerX,
    runtime.centerY,
    runtime.radius,
    state,
    undefined,
    'tool',
  );
  runtime.line.name = 'Прессовик: линия остановлена аварийным стопом';
  runtime.bypass.name = 'Прессовик: сервисный обход после стопа';
  for (const ci of runtime.dangerCells) {
    runtime.worldRef.fog[ci] = Math.min(runtime.worldRef.fog[ci], 18);
  }
  runtime.worldRef.markFogDirty();
  state.msgs.push(msg('Прессовик встал на стоп. Красные плиты больше не держат шаг.', state.time, '#fd6'));

  publishEvent(state, {
    type: 'room_blocked_production',
    zoneId: event.zoneId,
    roomId: runtime.line.id,
    x: runtime.centerX,
    y: runtime.centerY,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    itemId: event.itemId ?? 'gear',
    itemName: event.itemName ?? 'Шестерня',
    severity: 4,
    privacy: 'local',
    tags: pressTags([OUTCOME_TAG, 'stopped', reason]),
    data: {
      blockedReason: 'manual_stop',
      pressovikAction: 'machine_stopped',
      cleanedCells: cleaned,
      sourceEventId: event.id,
    },
  });
}

function publishCrossed(state: Parameters<typeof publishEvent>[0], event: WorldEvent): void {
  const runtime = runtimeForEvent(event);
  if (!runtime || runtime.crossed) return;
  runtime.crossed = true;
  state.msgs.push(msg('Прессовик пройден: выходная кассета отдала металл и пружины.', state.time, '#9cf'));
  publishEvent(state, {
    type: 'room_produced_items',
    zoneId: event.zoneId,
    roomId: runtime.line.id,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    itemId: 'metal_sheet',
    itemName: 'Лист металла',
    itemCount: 2,
    severity: 3,
    privacy: 'local',
    tags: pressTags([OUTCOME_TAG, 'crossed', OUTPUT_TAG]),
    data: {
      pressovikAction: 'safe_lane_crossed',
      stoppedBeforeCrossing: runtime.stopped,
      sourceEventId: event.id,
    },
  });
}

registerWorldEventObserver((state, event) => {
  if (event.tags.includes(OUTCOME_TAG)) return;

  const sideQuestId = eventDataString(event, 'sideQuestId');
  if (event.type === 'quest_completed' && sideQuestId === STOP_QUEST_ID) {
    stopRuntime(state, event, 'quest_stop');
    return;
  }

  if (
    event.type === 'item_deposited' &&
    event.tags.includes(STOP_TAG) &&
    event.itemId !== undefined &&
    STOP_ITEMS.has(event.itemId)
  ) {
    stopRuntime(state, event, 'manual_deposit');
    return;
  }

  if (
    (event.type === 'container_opened' || event.type === 'item_stolen') &&
    event.tags.includes(OUTPUT_TAG)
  ) {
    publishCrossed(state, event);
  }
});

function nextContainerId(ctx: MaintContentCtx): number {
  let max = 0;
  for (const c of ctx.world.containers) {
    if (c.id > max) max = c.id;
  }
  return Math.max(ctx.world.containers.length, max) + 1;
}

function addContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): WorldContainer {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  const full: WorldContainer = {
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  };
  ctx.world.addContainer(full);
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return full;
}

function setDoorMetal(ctx: MaintContentCtx, rooms: Room[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (ctx.world.cells[doorIdx] !== undefined) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
    }
  }
}

function markSafeLane(ctx: MaintContentCtx, x: number, y: number, seed: number): void {
  const ci = ctx.world.idx(x, y);
  ctx.world.floorTex[ci] = Tex.F_TILE;
  if (ctx.world.fog[ci] > 20) ctx.world.fog[ci] = 20;
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.2, MarkType.BULLET, seed, 230, 215, 120, 115);
}

function markDangerPlate(ctx: MaintContentCtx, x: number, y: number, seed: number): void {
  const ci = ctx.world.idx(x, y);
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 82);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.42, MarkType.SCORCH, seed, 155, 28, 12, 175);
  if ((x + y) % 3 === 0) stampMark(ctx.world, x, y, 0.45, 0.55, 0.16, MarkType.SPLAT, seed + 77, 210, 160, 35, 135);
}

function addPressLanes(ctx: MaintContentCtx, line: Room): number[] {
  const dangerCells: number[] = [];
  const safeRows = [
    line.y + 4,
    line.y + 8,
    line.y + 12,
  ];
  const gates = [
    { x0: line.x + 6, gapY: safeRows[0] },
    { x0: line.x + 14, gapY: safeRows[1] },
    { x0: line.x + 22, gapY: safeRows[2] },
  ];

  for (let x = line.x + 2; x < line.x + line.w - 2; x++) {
    for (const y of safeRows) markSafeLane(ctx, x, y, line.id * 1009 + x * 13 + y);
  }

  for (let n = 0; n < gates.length; n++) {
    const gate = gates[n];
    for (let dx = 0; dx < 3; dx++) {
      for (let y = line.y + 2; y < line.y + line.h - 2; y++) {
        if (Math.abs(y - gate.gapY) <= 1) continue;
        const x = gate.x0 + dx;
        const ci = ctx.world.idx(x, y);
        dangerCells.push(ci);
        markDangerPlate(ctx, x, y, line.id * 2003 + n * 97 + dx * 11 + y);
      }
    }
    setFeature(ctx.world, gate.x0 + 1, line.y + 1, Feature.LAMP);
    setFeature(ctx.world, gate.x0 + 1, line.y + line.h - 2, Feature.LAMP);
    setFeature(ctx.world, gate.x0 + 1, line.y + Math.floor(line.h / 2), Feature.MACHINE);
  }

  for (let x = line.x + 3; x < line.x + line.w - 3; x += 5) {
    setFeature(ctx.world, x, line.y + 2, Feature.APPARATUS);
    setFeature(ctx.world, x + 1, line.y + line.h - 3, Feature.APPARATUS);
  }
  setFeature(ctx.world, line.x + 2, line.y + 7, Feature.SCREEN);
  setFeature(ctx.world, line.x + line.w - 3, line.y + 9, Feature.SCREEN);
  ctx.world.markFogDirty();
  ctx.world.markFloorTexDirty();
  return dangerCells;
}

function addPressHazard(ctx: MaintContentCtx, line: Room, dangerCells: number[]): void {
  const zoneId = ctx.world.zoneMap[ctx.world.idx(line.x + Math.floor(line.w / 2), line.y + Math.floor(line.h / 2))];
  registerCellHazardSite(ctx.world, {
    id: `${CONTENT_TAG}_${line.id}`,
    kind: 'pressovik_press',
    displayName: 'Прессовик: ход плиты',
    cells: dangerCells,
    tags: pressTags(['hazard', 'safe_lane']),
    slowMult: 0.28,
    trappedMult: 0.08,
    stickAfter: 0.35,
    escapeSeconds: 1.6,
    npcEscapeSeconds: 2.8,
    roomId: line.id,
    zoneId,
    centerX: line.x + line.w / 2,
    centerY: line.y + line.h / 2,
    warning: 'Красный ход плиты. Ждите свет, уходите в белую дорожку или остановите Прессовик у пульта.',
  });
}

function dressBypass(ctx: MaintContentCtx, bypass: Room): void {
  for (let x = bypass.x + 2; x < bypass.x + bypass.w - 2; x += 4) {
    setFeature(ctx.world, x, bypass.y + 1, Feature.MACHINE);
    markSafeLane(ctx, x, bypass.y + 2, bypass.id * 503 + x);
  }
  setFeature(ctx.world, bypass.x + Math.floor(bypass.w / 2), bypass.y + 2, Feature.SCREEN);
  setFeature(ctx.world, bypass.x + bypass.w - 3, bypass.y + 2, Feature.LAMP);
}

function addPressContainers(ctx: MaintContentCtx, bypass: Room, output: Room, ownerId: number): { stop: WorldContainer; output: WorldContainer } {
  const stop = addContainer(ctx, bypass, bypass.x + Math.floor(bypass.w / 2), bypass.y + 2, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Пульт ручного стопа Прессовика',
    inventory: [
      { defId: 'relay_diagram', count: 1 },
      { defId: 'fuse', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId: ownerId,
    ownerName: MASTER_DEF.name,
    faction: Faction.CITIZEN,
    access: 'room',
    discovered: true,
    tags: pressTags([STOP_TAG, 'bypass', 'repair', 'tool']),
  });

  const out = addContainer(ctx, output, output.x + output.w - 3, output.y + 2, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Выходная кассета Прессовика',
    inventory: [
      { defId: 'gear', count: 1 },
      { defId: 'spring', count: 1 },
      { defId: 'metal_sheet', count: 2 },
    ],
    capacitySlots: 8,
    ownerNpcId: ownerId,
    ownerName: MASTER_DEF.name,
    faction: Faction.CITIZEN,
    access: 'room',
    discovered: true,
    factoryId: 'concentrate_press',
    tags: pressTags([OUTPUT_TAG, 'production_output', 'tools', 'reward']),
  });
  return { stop, output: out };
}

export function generatePressovik(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 52, 25, 95, 245);

  const entry = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x, pos.y + 5, 8, 8,
    'Прессовик: вход перед тактом',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const line = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 9, pos.y, 30, 17,
    'Прессовик: брикетная линия такт 1-2-3',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const output = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 40, pos.y + 5, 9, 8,
    'Прессовик: выходная кассета после плит',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const bypass = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 9, pos.y + 18, 30, 5,
    'Прессовик: сервисный обход и пульт стопа',
    Tex.PANEL, Tex.F_TILE,
  );

  placeDoor(ctx.world, entry, line, '', false);
  placeDoor(ctx.world, line, output, '', false);
  placeDoor(ctx.world, entry, bypass, '', false);
  placeDoor(ctx.world, bypass, output, '', false);
  placeDoor(ctx.world, line, bypass, '', false);
  setDoorMetal(ctx, [entry, line, output, bypass]);

  for (let y = entry.y + 1; y < entry.y + entry.h - 1; y++) {
    setFeature(ctx.world, entry.x + 1, y, Feature.SHELF);
  }
  setFeature(ctx.world, entry.x + entry.w - 2, entry.y + 2, Feature.SCREEN);
  setFeature(ctx.world, entry.x + entry.w - 2, entry.y + entry.h - 3, Feature.LAMP);

  const dangerCells = addPressLanes(ctx, line);
  addPressHazard(ctx, line, dangerCells);
  dressBypass(ctx, bypass);

  for (let y = output.y + 1; y < output.y + output.h - 1; y += 2) {
    setFeature(ctx.world, output.x + 2, y, Feature.SHELF);
  }
  setFeature(ctx.world, output.x + output.w - 2, output.y + output.h - 2, Feature.LAMP);
  stampMark(ctx.world, output.x + 4, output.y + 4, 0.5, 0.5, 1.4, MarkType.SCORCH, output.id * 881, 60, 44, 30, 120);

  const ownerId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'pressovik_stop_master', MASTER_DEF, bypass.x + 4, bypass.y + 2, 0);
  const containers = addPressContainers(ctx, bypass, output, ownerId);

  dropItems(ctx, entry, ['note', 'concentrate_coupon', 'fuse']);
  dropItems(ctx, line, ['gear', 'spring', 'grey_briquette']);
  dropItems(ctx, output, ['metal_sheet', 'spring', 'gear']);

  spawnMonstersNear(ctx, line.x + line.w - 5, line.y + 8, [
    MonsterKind.SBORKA, MonsterKind.REBAR, MonsterKind.ROBOT,
  ], 4, 9);

  latestRuntime = {
    line,
    bypass,
    dangerCells,
    centerX: line.x + line.w / 2,
    centerY: line.y + line.h / 2,
    radius: Math.max(line.w, line.h),
    stopped: false,
    crossed: false,
    worldRef: ctx.world,
  };
  runtimeByContainerId.set(containers.stop.id, latestRuntime);
  runtimeByContainerId.set(containers.output.id, latestRuntime);
}

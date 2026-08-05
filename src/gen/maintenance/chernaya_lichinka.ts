/* -- MONSTER_12: Черная Личинка, local black-slime cleanup pressure -- */

import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel, W,
  MonsterKind, Occupation, RoomType, Tex, msg,
  type Entity, type GameState, type Item, type Room, type WorldContainer,
  type WorldEvent, type WorldEventSeverity, type WorldEventType,
} from '../../core/types';
import type { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { cleanCellHazardsNear, registerCellHazardSite } from '../../systems/cell_hazards';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature,
  spawnAmbientNpc, stampMaintRoom,
} from './content_helpers';

const TAG_SITE = 'chernaya_lichinka';
const TAG_SLIME = 'slime_black';
const TAG_UV = 'uv';
const TAG_CLEANUP = 'cleanup';
const TAG_SEAL = 'seal';
const TAG_SAMPLE = 'sample';
const TAG_HARVEST = 'harvest';
const TAG_WITNESS = 'cult_witness';
const HAZARD_KIND = 'black_slime_larva';
const SAMPLE_ITEM = 'slime_sample_black';
const MAX_CONTEXTS = 8;
const MAX_THREATS = 3;
const CHAMBER_W = 24;
const CHAMBER_H = 14;
const ENTRY_W = 8;
const ENTRY_H = 7;

type LichinkaPhase = 'sealed' | 'burned' | 'sampled' | 'awakened' | 'uv_suppressed' | 'witness_removed';

interface LichinkaContext {
  world: World;
  entities: Entity[];
  roomId: number;
  centerX: number;
  centerY: number;
  hazardId: string;
  residueCells: number[];
  sampleContainerId: number;
  sealContainerId: number;
  kitContainerId: number;
  witnessId: number;
  threatIds: number[];
  awakened: boolean;
  sealed: boolean;
  burned: boolean;
  uvSuppressed: boolean;
  sampled: boolean;
  witnessRemoved: boolean;
  rewardDropped: boolean;
}

const contexts: LichinkaContext[] = [];

function registerLichinkaContext(ctx: LichinkaContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.residueCells = ctx.residueCells;
    existing.sampleContainerId = ctx.sampleContainerId;
    existing.sealContainerId = ctx.sealContainerId;
    existing.kitContainerId = ctx.kitContainerId;
    existing.witnessId = ctx.witnessId;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > MAX_CONTEXTS) contexts.splice(0, contexts.length - MAX_CONTEXTS);
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const c of world.containers) id = Math.max(id, c.id + 1);
  for (const cid of world.containerById.keys()) id = Math.max(id, cid + 1);
  return id;
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const e of entities) id = Math.max(id, e.id + 1);
  return id;
}

function zoneAt(ctx: LichinkaContext): number {
  return ctx.world.zoneMap[ctx.world.idx(Math.floor(ctx.centerX), Math.floor(ctx.centerY))];
}

function addLichinkaContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  name: string,
  kind: ContainerKind,
  inventory: Item[],
  tags: string[],
): number {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const id = nextContainerId(ctx.world);
  const container: WorldContainer = {
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(wx, wy)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(4, inventory.length + 1),
    access: 'public',
    discovered: true,
    tags: [TAG_SITE, ...tags],
  };
  ctx.world.addContainer(container);
  setFeature(ctx.world, wx, wy, kind === ContainerKind.EMERGENCY_BOX ? Feature.APPARATUS : Feature.SHELF);
  return id;
}

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string, count = 1, data?: unknown): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.entities.push({
    id: ctx.nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
  });
}

function dropRuntimeItem(ctx: LichinkaContext, defId: string, count: number, dx = 1): void {
  const x = Math.floor(ctx.centerX) + dx;
  const y = Math.floor(ctx.centerY);
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.entities.push({
    id: nextEntityId(ctx.entities), type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function publishLichinkaEvent(
  state: GameState,
  ctx: LichinkaContext,
  source: WorldEvent,
  phase: LichinkaPhase,
  line: string,
  severity: WorldEventSeverity,
  data: Record<string, unknown> = {},
): void {
  const room = ctx.world.rooms[ctx.roomId];
  publishEvent(state, {
    type: `chernaya_lichinka_${phase}` as WorldEventType,
    floor: FloorLevel.MAINTENANCE,
    zoneId: source.zoneId ?? zoneAt(ctx),
    roomId: ctx.roomId,
    x: source.x ?? ctx.centerX,
    y: source.y ?? ctx.centerY,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetId: source.targetId,
    targetName: source.targetName,
    targetFaction: source.targetFaction,
    monsterKind: source.monsterKind,
    itemId: source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    itemValue: source.itemValue,
    containerId: source.containerId,
    severity,
    privacy: 'local',
    tags: [TAG_SITE, 'monster', TAG_SLIME, TAG_UV, TAG_CLEANUP, phase, phase === 'witness_removed' ? TAG_WITNESS : 'maintenance', 'slime'],
    data: {
      sourceEventId: source.id,
      roomName: room?.name,
      hazardId: ctx.hazardId,
      sealed: ctx.sealed,
      burned: ctx.burned,
      uvSuppressed: ctx.uvSuppressed,
      sampled: ctx.sampled,
      awakened: ctx.awakened,
      threatCount: ctx.threatIds.length,
      witnessRemoved: ctx.witnessRemoved,
      rumorIds: ['slime_black_uv_sample'],
      ...data,
    },
  });
  state.msgs.push(msg(line, state.time, severity >= 4 ? '#f8c' : '#8cf'));
}

function findByContainer(event: WorldEvent): LichinkaContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (
      ctx.sampleContainerId === event.containerId ||
      ctx.sealContainerId === event.containerId ||
      ctx.kitContainerId === event.containerId
    ) return ctx;
  }
  return undefined;
}

function findByThreat(event: WorldEvent): LichinkaContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].threatIds.includes(event.targetId)) return contexts[i];
  }
  return undefined;
}

function findByWitness(event: WorldEvent): LichinkaContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].witnessId === event.targetId) return contexts[i];
  }
  return undefined;
}

function findByHazard(event: WorldEvent): LichinkaContext | undefined {
  const hazardId = typeof event.data?.hazardId === 'string' ? event.data.hazardId : '';
  if (!hazardId) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].hazardId === hazardId) return contexts[i];
  }
  return undefined;
}

function findByUv(event: WorldEvent): LichinkaContext | undefined {
  const threatCtx = findByThreat(event);
  if (threatCtx) return threatCtx;
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return undefined;
  const x = event.x ?? 0;
  const y = event.y ?? 0;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.world.dist2(x, y, ctx.centerX, ctx.centerY) <= 8 * 8) return ctx;
  }
  return undefined;
}

function isWitnessAlive(ctx: LichinkaContext): boolean {
  return !ctx.witnessRemoved && ctx.entities.some(e => e.id === ctx.witnessId && e.alive);
}

function killSpawnedThreats(ctx: LichinkaContext): number {
  let killed = 0;
  if (ctx.threatIds.length === 0) return 0;

  const entityMap = new Map();
  for (const entity of ctx.entities) {
    entityMap.set(entity.id, entity);
  }

  for (const id of ctx.threatIds) {
    const threat = entityMap.get(id);
    if (!threat?.alive) continue;
    threat.alive = false;
    threat.hp = 0;
    killed++;
  }
  return killed;
}

function residueSpawnCell(ctx: LichinkaContext, slot: number, seed: number): { x: number; y: number } | null {
  if (ctx.residueCells.length === 0) {
    return { x: Math.floor(ctx.centerX), y: Math.floor(ctx.centerY) };
  }
  for (let attempt = 0; attempt < Math.max(1, ctx.residueCells.length); attempt++) {
    const cell = ctx.residueCells[(slot * 5 + seed + attempt) % ctx.residueCells.length];
    const x = cell % W;
    const y = (cell / W) | 0;
    const ci = ctx.world.idx(x, y);
    if (ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) return { x, y };
  }
  const x = Math.floor(ctx.centerX);
  const y = Math.floor(ctx.centerY);
  return { x, y };
}

function spawnLichinkaThreats(ctx: LichinkaContext, source: WorldEvent, count: number, witnessAlive: boolean): number {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return 0;
  let nextId = nextEntityId(ctx.entities);
  let spawned = 0;
  const capped = Math.max(0, Math.min(MAX_THREATS - ctx.threatIds.length, count));

  for (let i = 0; i < capped; i++) {
    const kind = witnessAlive && i === capped - 1 ? MonsterKind.EYE : MonsterKind.SBORKA;
    const pos = residueSpawnCell(ctx, i, source.id + ctx.roomId);
    if (!pos) continue;
    const def = MONSTERS[kind];
    const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ctx.world.idx(pos.x, pos.y)]]?.level ?? 4;
    const hpMult = kind === MonsterKind.EYE ? 0.5 : 0.85;
    const speedMult = kind === MonsterKind.EYE ? 0.72 : 0.92;
    const hp = Math.max(5, Math.round(scaleMonsterHp(def.hp, zoneLevel) * hpMult));
    const monster: Entity = {
      id: nextId++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.atan2(ctx.centerY - pos.y, ctx.centerX - pos.x),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel) * speedMult,
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      name: kind === MonsterKind.EYE ? 'Глаз Черной Личинки' : 'Черная Личинка',
      monsterKind: kind,
      monsterDmgMult: kind === MonsterKind.EYE ? 0.65 : 0.8,
      attackCd: 0.35 + i * 0.18,
      ai: { goal: AIGoal.WANDER, tx: room.x + room.w - 3, ty: room.y + Math.floor(room.h / 2), path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
      spriteScale: kind === MonsterKind.EYE ? 0.58 : 0.52,
    };
    ctx.entities.push(monster);
    ctx.threatIds.push(monster.id);
    spawned++;
  }

  return spawned;
}

function awakenLichinka(state: GameState, ctx: LichinkaContext, source: WorldEvent, reason: 'harvest' | 'step'): void {
  if (ctx.awakened || ctx.sealed || ctx.burned || ctx.uvSuppressed) return;
  ctx.awakened = true;
  const witnessAlive = isWitnessAlive(ctx);
  const base = reason === 'step' ? 1 : 2;
  const pressure = Math.max(1, base + (witnessAlive ? 1 : 0) - (ctx.witnessRemoved ? 1 : 0));
  const spawned = spawnLichinkaThreats(ctx, source, pressure, witnessAlive);
  publishLichinkaEvent(
    state,
    ctx,
    source,
    'awakened',
    spawned > 0
      ? 'Черная Личинка защелкала и подняла глазки из остатка.'
      : 'Черная Личинка дернулась, но остаток уже не смог подняться.',
    spawned > 0 ? 4 : 3,
    { reason, spawned, cap: MAX_THREATS, cultWitnessAlive: witnessAlive },
  );
}

function sealLichinka(state: GameState, ctx: LichinkaContext, source: WorldEvent): void {
  if (ctx.sealed) {
    state.msgs.push(msg('Пломба уже держит Черную Личинку.', state.time, '#888'));
    return;
  }
  if (ctx.burned) {
    state.msgs.push(msg('Черная Личинка уже выжжена: пломбировать нечего.', state.time, '#888'));
    return;
  }
  ctx.sealed = true;
  const room = ctx.world.rooms[ctx.roomId];
  if (room) room.sealed = true;
  const cleaned = cleanCellHazardsNear(ctx.world, ctx.centerX, ctx.centerY, 3.8, state, undefined, 'tool');
  const killed = killSpawnedThreats(ctx);
  publishLichinkaEvent(
    state,
    ctx,
    source,
    'sealed',
    killed > 0
      ? 'Герметик схватил личинку вместе с глазками. Остаток стал плоским.'
      : 'Черная Личинка запечатана до пробуждения.',
    killed > 0 ? 4 : 3,
    { cleanedCells: cleaned, killedThreats: killed, method: 'sealant_tube' },
  );
}

function burnLichinka(state: GameState, ctx: LichinkaContext, source: WorldEvent): void {
  if (ctx.burned || ctx.sealed) return;
  ctx.burned = true;
  const killed = killSpawnedThreats(ctx);
  if (!ctx.rewardDropped) {
    ctx.rewardDropped = true;
    dropRuntimeItem(ctx, 'psi_dust', 1, 1);
  }
  publishLichinkaEvent(
    state,
    ctx,
    source,
    'burned',
    killed > 0
      ? 'Огонь свернул Черную Личинку в ПСИ-пепел.'
      : 'Огонь высушил черный остаток. В золе мерцает ПСИ-пыль.',
    4,
    { killedThreats: killed, rewardItem: 'psi_dust', cleanupReason: source.data?.reason ?? 'fire' },
  );
}

function suppressWithUv(state: GameState, ctx: LichinkaContext, source: WorldEvent): void {
  if (ctx.uvSuppressed || ctx.sealed || ctx.burned) return;
  ctx.uvSuppressed = true;
  const cleaned = cleanCellHazardsNear(ctx.world, ctx.centerX, ctx.centerY, 3.2, state, undefined, 'tool');
  publishLichinkaEvent(
    state,
    ctx,
    source,
    'uv_suppressed',
    cleaned > 0
      ? 'УФ проявил глазки и высушил личинку до безопасной пленки.'
      : 'УФ выбил мокрый щелчок из черного остатка.',
    3,
    { cleanedCells: cleaned, uvEffect: source.data?.effect ?? 'uv_spotlight' },
  );
}

function sampleLichinka(state: GameState, ctx: LichinkaContext, source: WorldEvent): void {
  if (ctx.sampled) return;
  ctx.sampled = true;

  const prepared = ctx.sealed || ctx.burned || ctx.uvSuppressed;
  publishLichinkaEvent(
    state,
    ctx,
    source,
    'sampled',
    prepared
      ? 'Проба черной слизи взята после обработки. Банка не стучит.'
      : 'Проба черной слизи взята сырой. Банка щелкает изнутри.',
    prepared ? 3 : 4,
    { sampleItemId: source.itemId ?? SAMPLE_ITEM, preparedBy: ctx.sealed ? 'seal' : ctx.burned ? 'fire' : ctx.uvSuppressed ? 'uv' : 'none' },
  );

  if (!prepared) awakenLichinka(state, ctx, source, 'harvest');
}

function handleContainerEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  const ctx = findByContainer(event);
  if (!ctx) return;

  if (event.containerId === ctx.sealContainerId) {
    sealLichinka(state, ctx, event);
    return;
  }
  if (event.containerId === ctx.sampleContainerId) {
    sampleLichinka(state, ctx, event);
  }
}

function handleHazardEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'hazard_trapped' && event.type !== 'hazard_cleaned') return;
  const ctx = findByHazard(event);
  if (!ctx) return;
  if (event.type === 'hazard_trapped') {
    awakenLichinka(state, ctx, event, 'step');
    return;
  }
  if (event.data?.reason === 'fire') burnLichinka(state, ctx, event);
}

function handleUvEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'uv_spotlight_target_affected') return;
  if (!event.tags.includes('uv_spotlight')) return;
  const ctx = findByUv(event);
  if (!ctx) return;
  suppressWithUv(state, ctx, event);
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type === 'player_kill_npc') {
    const ctx = findByWitness(event);
    if (!ctx || ctx.witnessRemoved) return;
    ctx.witnessRemoved = true;
    publishLichinkaEvent(
      state,
      ctx,
      event,
      'witness_removed',
      'Культовый свидетель убран. Черная Личинка осталась без хора.',
      4,
      { cultWitnessId: event.targetId },
    );
    return;
  }

  if (event.type !== 'player_kill_monster') return;
  const ctx = findByThreat(event);
  if (!ctx) return;
  const remaining = ctx.threatIds.filter(id => ctx.entities.some(e => e.id === id && e.alive)).length;
  if (remaining === 0 && ctx.awakened && !ctx.sealed && !ctx.burned) {
    state.msgs.push(msg('Черная Личинка замолчала, но пятно осталось брать только с УФ или пломбой.', state.time, '#8cf'));
  }
}

function handleLichinkaEvents(state: GameState, event: WorldEvent): void {
  handleContainerEvent(state, event);
  handleHazardEvent(state, event);
  handleUvEvent(state, event);
  handleKillEvent(state, event);
}

registerWorldEventObserver(handleLichinkaEvents);

function connectRooms(ctx: MaintContentCtx, entry: Room, chamber: Room): void {
  const y = entry.y + Math.floor(entry.h / 2);
  for (let x = entry.x + entry.w - 1; x <= chamber.x + 1; x++) openTile(ctx.world, x, y, Tex.F_CONCRETE);
  const targetY = chamber.y + Math.floor(chamber.h / 2);
  for (let y2 = Math.min(y, targetY); y2 <= Math.max(y, targetY); y2++) {
    openTile(ctx.world, chamber.x + 1, y2, Tex.F_CONCRETE);
  }
}

function addResidue(ctx: MaintContentCtx, room: Room, cells: number[], x: number, y: number, seed: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) return;
  if (!cells.includes(ci)) cells.push(ci);
  ctx.world.roomMap[ci] = room.id;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 36);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.58, MarkType.POOL, seed, 3, 5, 8, 230);
  stampMark(ctx.world, x, y, 0.42, 0.55, 0.27, MarkType.SPLAT, seed + 41, 16, 11, 24, 185);
}

function decorateSite(ctx: MaintContentCtx, entry: Room, chamber: Room): number[] {
  for (let dx = 1; dx < entry.w - 1; dx++) {
    if (dx % 2 === 1) setFeature(ctx.world, entry.x + dx, entry.y + 1, Feature.LAMP);
    if (dx % 3 === 0) setFeature(ctx.world, entry.x + dx, entry.y + entry.h - 2, Feature.SHELF);
  }
  setFeature(ctx.world, entry.x + 2, entry.y + 3, Feature.SCREEN);
  setFeature(ctx.world, entry.x + entry.w - 2, entry.y + 3, Feature.APPARATUS);

  for (let dx = 2; dx < chamber.w - 2; dx += 5) {
    setFeature(ctx.world, chamber.x + dx, chamber.y + 1, Feature.LAMP);
    setFeature(ctx.world, chamber.x + dx, chamber.y + chamber.h - 2, Feature.SHELF);
  }
  setFeature(ctx.world, chamber.x + chamber.w - 4, chamber.y + 2, Feature.DESK);
  setFeature(ctx.world, chamber.x + chamber.w - 5, chamber.y + 2, Feature.CHAIR);
  setFeature(ctx.world, chamber.x + 3, chamber.y + chamber.h - 3, Feature.MACHINE);

  const cx = chamber.x + 10;
  const cy = chamber.y + 7;
  const residueCells: number[] = [];
  const offsets = [
    [-4, -2], [-2, -2], [0, -2], [2, -2],
    [-5, -1], [-3, -1], [-1, -1], [1, -1], [3, -1],
    [-4, 0], [-2, 0], [0, 0], [2, 0], [4, 0],
    [-3, 1], [-1, 1], [1, 1], [3, 1],
    [-2, 2], [0, 2], [2, 2],
  ] as const;
  offsets.forEach(([dx, dy], i) => addResidue(ctx, chamber, residueCells, cx + dx, cy + dy, chamber.id * 997 + i * 37));

  stampMark(ctx.world, cx - 5, cy - 4, 0.5, 0.5, 1.1, MarkType.BLACK_HAND, chamber.id * 123 + 1, 25, 5, 8, 180);
  stampMark(ctx.world, cx + 5, cy + 3, 0.5, 0.5, 0.9, MarkType.PSI, chamber.id * 123 + 2, 34, 20, 90, 155);
  ctx.world.markFogDirty();
  return residueCells;
}

export function generateChernayaLichinka(ctx: MaintContentCtx): void {
  const pos = findMaintArea(
    ctx.world,
    Math.floor(ctx.spawnX),
    Math.floor(ctx.spawnY),
    ENTRY_W + CHAMBER_W + 5,
    CHAMBER_H + 2,
    135,
    260,
  );

  const entry = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y + 4, ENTRY_W, ENTRY_H,
    'Саншлюз Черной Личинки: УФ огонь пломба',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const chamber = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + ENTRY_W + 3, pos.y, CHAMBER_W, CHAMBER_H,
    'Черная Личинка: мокрый щелчок в образце',
    Tex.DARK, Tex.F_CONCRETE,
  );
  connectRooms(ctx, entry, chamber);
  const residueCells = decorateSite(ctx, entry, chamber);

  const kitContainerId = addLichinkaContainer(
    ctx,
    entry,
    entry.x + 2,
    entry.y + 3,
    'Аварийный ящик: УФ и огонь',
    ContainerKind.EMERGENCY_BOX,
    [
      { defId: 'uv_spotlight', count: 1 },
      { defId: 'flamethrower', count: 1 },
      { defId: 'ammo_fuel', count: 2 },
      { defId: 'flashlight', count: 1 },
    ],
    [TAG_SLIME, TAG_UV, TAG_CLEANUP, 'fire'],
  );
  const sealContainerId = addLichinkaContainer(
    ctx,
    entry,
    entry.x + entry.w - 2,
    entry.y + 3,
    'Пломба для живого остатка',
    ContainerKind.TOOL_LOCKER,
    [
      { defId: 'sealant_tube', count: 1 },
      { defId: 'hermo_gasket', count: 1 },
    ],
    [TAG_SLIME, TAG_SEAL, TAG_CLEANUP],
  );
  const sampleContainerId = addLichinkaContainer(
    ctx,
    chamber,
    chamber.x + chamber.w - 4,
    chamber.y + Math.floor(chamber.h / 2),
    'НИИ банка: Черная Личинка',
    ContainerKind.SECRET_STASH,
    [{ defId: SAMPLE_ITEM, count: 1 }],
    [TAG_SLIME, TAG_SAMPLE, TAG_HARVEST],
  );

  const witnessId = ctx.nextId.v;
  spawnAmbientNpc(
    ctx,
    'Безглазый свидетель',
    Faction.CULTIST,
    Occupation.PILGRIM,
    chamber.x + chamber.w - 6,
    chamber.y + chamber.h - 3,
    [{ defId: 'psi_dust', count: 1 }, { defId: 'meat_rune', count: 1 }],
  );

  dropAt(ctx, entry.x + 4, entry.y + entry.h - 2, 'note', 1,
    'Памятка ликвидатора: Черная Личинка не обязана нападать. УФ сушит глазки, огонь оставляет ПСИ-пыль, пломба делает пробу безопасной. Если культовый свидетель поет рядом, сырая банка просыпается.');
  dropAt(ctx, chamber.x + 3, chamber.y + 3, 'sealant_tube');
  dropAt(ctx, chamber.x + 4, chamber.y + 3, 'ammo_fuel');

  const hazardId = `chernaya_lichinka_${chamber.id}`;
  registerCellHazardSite(ctx.world, {
    id: hazardId,
    kind: HAZARD_KIND,
    displayName: 'Черная Личинка',
    cells: residueCells,
    tags: [TAG_SITE, TAG_SLIME, 'slime', 'black_slime', TAG_CLEANUP, 'monster'],
    slowMult: 0.58,
    trappedMult: 0.18,
    stickAfter: 0.85,
    escapeSeconds: 2.1,
    npcEscapeSeconds: 4.4,
    roomId: chamber.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(chamber.x + 10, chamber.y + 7)],
    centerX: chamber.x + 10.5,
    centerY: chamber.y + 7.5,
    warning: 'Мокро щелкает под ногами. Обойдите по краю, светите УФ, жгите огнем или пломбируйте пробу.',
  });

  registerLichinkaContext({
    world: ctx.world,
    entities: ctx.entities,
    roomId: chamber.id,
    centerX: chamber.x + 10.5,
    centerY: chamber.y + 7.5,
    hazardId,
    residueCells,
    sampleContainerId,
    sealContainerId,
    kitContainerId,
    witnessId,
    threatIds: [],
    awakened: false,
    sealed: false,
    burned: false,
    uvSuppressed: false,
    sampled: false,
    witnessRemoved: false,
    rewardDropped: false,
  });
}

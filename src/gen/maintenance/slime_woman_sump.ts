/* ── Slime woman sump: wet/dry sample predator POI ───────────── */

import {
  AIGoal,
  ContainerKind,
  EntityType,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  type Entity,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  findMaintArea,
  setFeature,
  setWater,
  stampMaintRoom,
  type MaintContentCtx,
} from './content_helpers';

const ROOM_W = 20;
const ROOM_H = 13;
const SAMPLE_ITEM = 'slime_sample_green';
const TAG_SITE = 'slime_woman_sump';
const TAG_SAMPLE = 'slime_woman_sample';

interface SlimeWomanSumpContext {
  world: MaintContentCtx['world'];
  entities: Entity[];
  roomId: number;
  sampleContainerId: number;
  womanId: number;
  sampled: boolean;
}

const contexts: SlimeWomanSumpContext[] = [];

function nextContainerId(world: MaintContentCtx['world']): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function addContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  name: string,
  kind: ContainerKind,
  inventory: WorldContainer['inventory'],
  tags: string[],
): number {
  const id = nextContainerId(ctx.world);
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  ctx.world.addContainer({
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
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return id;
}

function dropNote(ctx: MaintContentCtx, x: number, y: number, text: string): void {
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId: 'note', count: 1, data: text }],
  });
}

function registerContext(ctx: SlimeWomanSumpContext): void {
  contexts.push(ctx);
  if (contexts.length > 6) contexts.splice(0, contexts.length - 6);
}

function contextForEvent(event: WorldEvent): SlimeWomanSumpContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].sampleContainerId === event.containerId) return contexts[i];
  }
  return undefined;
}

function handleSlimeWomanSumpEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (event.itemId !== SAMPLE_ITEM || !event.tags.includes(TAG_SITE) || !event.tags.includes(TAG_SAMPLE)) return;
  const ctx = contextForEvent(event);
  if (!ctx || ctx.sampled) return;
  ctx.sampled = true;
  const womanAlive = ctx.entities.some(entity => entity.id === ctx.womanId && entity.alive);
  publishEvent(state, {
    type: 'slime_humanoid_sampled',
    zoneId: event.zoneId,
    roomId: ctx.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: ctx.womanId,
    targetName: MONSTERS[MonsterKind.SLIME_WOMAN].name,
    monsterKind: MonsterKind.SLIME_WOMAN,
    itemId: SAMPLE_ITEM,
    itemName: event.itemName,
    itemCount: event.itemCount,
    itemValue: event.itemValue,
    containerId: event.containerId,
    severity: womanAlive ? 4 : 3,
    privacy: 'local',
    tags: ['monster', 'slime_woman', 'slime', 'sample', womanAlive ? 'risked' : 'secured'],
    data: {
      sourceEventId: event.id,
      roomName: ctx.world.rooms[ctx.roomId]?.name,
      womanAlive,
      counterplay: 'dry_edge_uv_cleaning_kit_then_sample_container',
      rumorIds: ['lead_maint_slime_woman_sump', 'ecology_slime_woman_dry_edge'],
    },
  });
}

registerWorldEventObserver(handleSlimeWomanSumpEvent);

function spawnSlimeWoman(ctx: MaintContentCtx, room: Room, x: number, y: number): number {
  const def = MONSTERS[MonsterKind.SLIME_WOMAN];
  const ci = ctx.world.idx(x, y);
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const id = ctx.nextId.v++;
  ctx.entities.push({
    id,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.SLIME_WOMAN),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SLIME_WOMAN,
    attackCd: 0.7,
    ai: { goal: AIGoal.WANDER, tx: room.x + Math.floor(room.w / 2), ty: room.y + Math.floor(room.h / 2), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
  return id;
}

export function generateSlimeWomanSump(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, ROOM_W + 2, ROOM_H + 2, 155, 305);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    pos.x,
    pos.y,
    ROOM_W,
    ROOM_H,
    'Жижевой отстойник НИИ',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  const wetCells: number[] = [];
  for (let y = room.y + 4; y < room.y + room.h - 2; y++) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x++) {
      const rim = x === room.x + 3 || x === room.x + room.w - 4 || y === room.y + 4;
      if (rim || (x + y) % 5 === 0) continue;
      setWater(ctx.world, x, y);
      wetCells.push(ctx.world.idx(x, y));
    }
  }

  for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) {
    setFeature(ctx.world, x, room.y + 2, Feature.LAMP);
  }
  setFeature(ctx.world, room.x + 3, room.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 4, room.y + 2, Feature.MACHINE);
  setFeature(ctx.world, room.x + 2, room.y + room.h - 3, Feature.SINK);

  registerCellHazardSite(ctx.world, {
    id: `slime_woman_sump_${room.id}`,
    kind: 'slime_woman_sump',
    displayName: 'Жижевой отстойник',
    cells: wetCells,
    tags: ['slime', 'toxic', 'water', 'slime_woman', 'green_slime'],
    sticky: false,
    cleanable: false,
    slowMult: 0.82,
    playerDamagePerSecond: 0.35,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(room.x + 5, room.y + 6)],
    centerX: room.x + room.w / 2,
    centerY: room.y + 7,
    warning: 'Жижевой отстойник мокрый и токсичный. Держитесь сухого освещенного края.',
    warningColor: '#4f8',
  });

  addContainer(
    ctx,
    room,
    room.x + 2,
    room.y + 2,
    'Сухой ящик НИИ: УФ соль тара',
    ContainerKind.TOOL_LOCKER,
    [
      { defId: 'uv_spotlight', count: 1 },
      { defId: 'cleaning_kit', count: 1 },
      { defId: 'rock_salt', count: 2 },
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'filter_layer', count: 1 },
    ],
    ['counterplay', 'uv_spotlight', 'cleaning', 'sample_container'],
  );
  const sampleContainerId = addContainer(
    ctx,
    room,
    room.x + room.w - 3,
    room.y + 2,
    'Опломбированная зелёная проба жижевого тела',
    ContainerKind.SECRET_STASH,
    [{ defId: SAMPLE_ITEM, count: 1 }],
    [TAG_SAMPLE, 'slime', 'sample', 'science'],
  );

  dropNote(ctx, room.x + 4, room.y + 2, 'Отстойник: не стрелять из воды. Сухой светлый край, УФ-импульс, чистящий комплект. Проба только в тару НИИ; «Жижа-тян» в журнал не писать.');
  const womanId = spawnSlimeWoman(ctx, room, room.x + Math.floor(room.w / 2), room.y + room.h - 4);
  registerContext({ world: ctx.world, entities: ctx.entities, roomId: room.id, sampleContainerId, womanId, sampled: false });
}

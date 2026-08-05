/* ── Мясомер: local post-samosbor noise discipline encounter ─── */

import {
  AIGoal,
  Cell,
  ContainerKind,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  W,
  msg,
  type Entity,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS } from '../../data/catalog';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { isPlayerEntity } from '../../systems/player_actor';

const MYASOMER_ID = 'myasomer';
const MYASOMER_NAME = 'Мясомер';
const ROOM_NAME = 'Коридор Мясомера';
const ROOM_W = 25;
const ROOM_H = 11;
const EVENT_TAG = 'myasomer_event';
const RADIUS = 16;
const RADIUS2 = RADIUS * RADIUS;
const MAX_THREATS = 3;
const COUNTERPLAY_THREATS = 2;
const FULL_COUNTERPLAY_THREATS = 1;

interface MyasomerSite {
  floor: FloorLevel;
  roomId: number;
  zoneId: number;
  x: number;
  y: number;
  baitX: number;
  baitY: number;
  veinX: number;
  veinY: number;
  quietContainerId: number;
  shardContainerId: number;
  triggers: number;
  baited: boolean;
  fireSeared: boolean;
  spawned: number;
  quietCleared: boolean;
  loudCleared: boolean;
  coverCells: number;
  veinCells: number;
  threatIds: number[];
}

interface MyasomerLayout {
  coverCells: number;
  veinCells: number;
  veinX: number;
  veinY: number;
}

let activeWorld: World | null = null;
let activeEntities: Entity[] | null = null;
let activeSite: MyasomerSite | null = null;

registerWorldEventObserver(handleMyasomerEvent);

export function generateMyasomer(world: World, entities: Entity[], nextId: { v: number }): void {
  activeWorld = world;
  activeEntities = entities;
  activeSite = null;

  const origin = findMyasomerOrigin(world);
  if (!origin) return;

  const room = stampRoom(world, world.rooms.length, RoomType.CORRIDOR, origin.x, origin.y, ROOM_W, ROOM_H, -1);
  room.name = ROOM_NAME;
  room.wallTex = Tex.GUT;
  room.floorTex = Tex.F_MEAT;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.GUT, Tex.F_MEAT);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  forceMyasomerConnection(world, room);
  const layout = decorateMyasomerRoom(world, room);

  const quietContainerId = addQuietCache(world, room);
  const shardContainerId = addShardCache(world, room);
  const bait = dropWarningBait(world, entities, nextId, room);

  const cx = world.wrap(room.x + (room.w >> 1));
  const cy = world.wrap(room.y + (room.h >> 1));
  const ci = world.idx(cx, cy);
  activeSite = {
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    x: cx + 0.5,
    y: cy + 0.5,
    baitX: (bait?.x ?? cx) + 0.5,
    baitY: (bait?.y ?? world.wrap(room.y + room.h - 2)) + 0.5,
    veinX: layout.veinX,
    veinY: layout.veinY,
    quietContainerId,
    shardContainerId,
    triggers: 0,
    baited: false,
    fireSeared: false,
    spawned: 0,
    quietCleared: false,
    loudCleared: false,
    coverCells: layout.coverCells,
    veinCells: layout.veinCells,
    threatIds: [],
  };

  genLog(`[MONSTER_11] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
}

export function getMyasomerDebugSite(): MyasomerSite | null {
  return activeSite ? { ...activeSite, threatIds: [...activeSite.threatIds] } : null;
}

export function resetMyasomerForTests(): void {
  activeWorld = null;
  activeEntities = null;
  activeSite = null;
}

function findMyasomerOrigin(world: World): { x: number; y: number } | null {
  const direct = findClearArea(world, W >> 1, W >> 1, ROOM_W, ROOM_H, 120, 310);
  if (direct && canReserve(world, direct.x, direct.y)) return direct;

  for (let attempt = 0; attempt < 1800; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 100 + Math.random() * 360;
    const x = world.wrap((W >> 1) + Math.round(Math.cos(angle) * dist) - (ROOM_W >> 1));
    const y = world.wrap((W >> 1) + Math.round(Math.sin(angle) * dist) - (ROOM_H >> 1));
    if (canReserve(world, x, y)) return { x, y };
  }

  return null;
}

function canReserve(world: World, x: number, y: number): boolean {
  for (let dy = -2; dy <= ROOM_H + 2; dy++) {
    for (let dx = -2; dx <= ROOM_W + 2; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.roomMap[ci] >= 0 || world.cells[ci] === Cell.LIFT) return false;
      if (dx >= -1 && dx <= ROOM_W && dy >= -1 && dy <= ROOM_H && world.cells[ci] !== Cell.WALL) return false;
    }
  }
  return true;
}

function forceMyasomerConnection(world: World, room: Room): void {
  if (hasExternalOpening(world, room)) return;

  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  const probes: readonly [number, number, number, number][] = [
    [midX, room.y - 1, 0, -1],
    [midX, room.y + room.h, 0, 1],
    [room.x - 1, midY, -1, 0],
    [room.x + room.w, midY, 1, 0],
  ];
  let bestPath: number[] | null = null;

  for (const [sx, sy, dx, dy] of probes) {
    const path: number[] = [];
    let x = world.wrap(sx);
    let y = world.wrap(sy);
    for (let step = 0; step < 112; step++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.LIFT || world.aptMask[ci]) break;
      if (step > 0 && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.WATER)) {
        if (!bestPath || path.length < bestPath.length) bestPath = [...path];
        break;
      }
      path.push(ci);
      x = world.wrap(x + dx);
      y = world.wrap(y + dy);
    }
  }

  if (!bestPath) return;
  for (const ci of bestPath) {
    if (world.cells[ci] === Cell.LIFT) continue;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = Tex.F_MEAT;
    world.wallTex[ci] = 0;
    world.aptMask[ci] = 0;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
  }
}

function hasExternalOpening(world: World, room: Room): boolean {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
      if (world.aptMask[ci]) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (world.roomMap[world.idx(room.x + dx + ox, room.y + dy + oy)] === room.id) return true;
      }
    }
  }
  return false;
}

function decorateMyasomerRoom(world: World, room: Room): MyasomerLayout {
  const rx = room.x;
  const ry = room.y;
  const cx = rx + (room.w >> 1);
  const cy = ry + (room.h >> 1);
  let coverCells = 0;

  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (((dx * 23 + dy * 17) & 5) === 0) world.floorTex[ci] = Tex.F_GUT;
    }
  }

  for (const x of [rx + 5, rx + 9, rx + 15, rx + 19]) {
    for (let y = ry + 2; y <= ry + room.h - 3; y++) {
      if ((x < cx && y === cy - 1) || (x > cx && y === cy + 1)) continue;
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.MEAT;
      world.roomMap[ci] = -1;
      coverCells++;
    }
  }

  setFeature(world, rx + 3, cy, Feature.SHELF, 4);
  setFeature(world, rx + room.w - 4, cy, Feature.APPARATUS, 6);
  setFeature(world, cx, ry + 2, Feature.CANDLE, 5);
  setFeature(world, cx, ry + room.h - 3, Feature.CANDLE, 5);

  const heartWall = world.idx(rx + room.w - 2, cy);
  if (world.cells[heartWall] === Cell.FLOOR) {
    world.cells[heartWall] = Cell.WALL;
    world.roomMap[heartWall] = -1;
  }
  world.wallTex[heartWall] = Tex.ICON;

  for (let i = 0; i < 10; i++) {
    const x = rx + 2 + (i * 7) % (room.w - 4);
    const y = ry + 2 + (i * 5) % (room.h - 4);
    stampMark(world, x, y, 0.5, 0.5, 0.34 + (i % 3) * 0.08, MarkType.DRIP, 11011 + i, 130, 24, 38, 170);
  }
  stampMark(world, rx + room.w - 4, cy, 0.5, 0.5, 1.4, MarkType.POOL, 11140, 115, 18, 32, 190);
  const vein = registerMyasomerVein(world, room);
  return { coverCells, ...vein };
}

function registerMyasomerVein(world: World, room: Room): Pick<MyasomerLayout, 'veinCells' | 'veinX' | 'veinY'> {
  const cx = world.wrap(room.x + (room.w >> 1));
  const cy = world.wrap(room.y + (room.h >> 1));
  const cells: number[] = [];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) === 3 && dy !== 0) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      cells.push(ci);
      world.floorTex[ci] = Tex.F_GUT;
    }
  }

  registerCellHazardSite(world, {
    id: `${MYASOMER_ID}_listening_vein_${room.id}`,
    kind: 'myasomer_vein',
    displayName: 'Слуховая мясная жила',
    cells,
    tags: [MYASOMER_ID, 'counterplay', 'route'],
    slowMult: 0.5,
    trappedMult: 0.16,
    stickAfter: 1.1,
    escapeSeconds: 1.25,
    npcEscapeSeconds: 3.5,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(cx, cy)],
    centerX: cx + 0.5,
    centerY: cy + 0.5,
    warning: 'Центральная жила реагирует на шум. Идите краем, бросьте хлеб в ямку или выжгите жилу.',
  });

  stampMark(world, cx, cy, 0.5, 0.5, 1.05, MarkType.POOL, 11177, 150, 18, 45, 180);
  return { veinCells: cells.length, veinX: cx + 0.5, veinY: cy + 0.5 };
}

function setFeature(world: World, x: number, y: number, feature: Feature, lightRadius: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = feature;
  addLocalLight(world, x, y, lightRadius);
}

function addLocalLight(world: World, lx: number, ly: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const ci = world.idx(lx + dx, ly + dy);
      const brightness = 0.75 * (1 - Math.sqrt(d2) / radius);
      if (brightness > world.light[ci]) world.light[ci] = brightness;
    }
  }
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function addQuietCache(world: World, room: Room): number {
  const x = world.wrap(room.x + 3);
  const y = world.wrap(room.y + (room.h >> 1));
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.TRASH_BIN,
    name: 'Тихая мясная ниша',
    inventory: [
      { defId: 'note', count: 1, data: 'Мясомер реагирует на шум в центре. Иди по краю, хлеб бросай в мясную ямку, жилу жги только без лишнего лута рядом.' },
      { defId: 'rawmeat', count: 2 },
      { defId: 'bandage', count: 1 },
      { defId: 'water', count: 1 },
    ],
    capacitySlots: 6,
    access: 'public',
    discovered: true,
    tags: [MYASOMER_ID, 'monster', 'noise', 'samosbor_aftermath', 'meat', 'quiet_reward', 'quiet_route', 'counterplay'],
  };
  world.addContainer(container);
  return container.id;
}

function addShardCache(world: World, room: Room): number {
  const x = world.wrap(room.x + room.w - 4);
  const y = world.wrap(room.y + (room.h >> 1));
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name: 'Осколок сирены на жестяной жиле',
    inventory: [
      { defId: 'siren_shard', count: 1 },
      { defId: 'rawmeat', count: 1 },
    ],
    capacitySlots: 4,
    faction: Faction.CULTIST,
    access: 'faction',
    discovered: true,
    tags: [MYASOMER_ID, 'monster', 'noise', 'samosbor_aftermath', 'meat', 'siren_shard', 'loud_trigger', 'loud_route'],
  };
  world.addContainer(container);
  return container.id;
}

function dropWarningBait(world: World, entities: Entity[], nextId: { v: number }, room: Room): { x: number; y: number } | null {
  const x = world.wrap(room.x + (room.w >> 1));
  const y = world.wrap(room.y + room.h - 2);
  if (world.cells[world.idx(x, y)] !== Cell.FLOOR) return null;
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
    inventory: [{ defId: 'bread', count: 1 }],
    name: 'черствый шумовой ломоть',
  });
  return { x, y };
}

function handleMyasomerEvent(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(EVENT_TAG)) return;
  const site = activeSite;
  const world = activeWorld;
  const entities = activeEntities;
  if (!site || !world || !entities || state.currentFloor !== site.floor || event.floor !== site.floor) return;

  if (event.type === 'monster_bait_placed' && eventInsideSite(world, site, event)) {
    markBaited(state, site, event);
    return;
  }

  if (event.type === 'hazard_cleaned' && eventInsideSite(world, site, event) && event.data?.reason === 'fire') {
    markFireSeared(state, site, event);
    return;
  }

  if (event.type === 'burn_cleanup' && eventInsideSite(world, site, event)) {
    markFireSeared(state, site, event);
    return;
  }

  if (event.type === 'hazard_escaped' && eventInsideSite(world, site, event) && event.data?.noisy === true) {
    handleLoudTrigger(state, world, entities, site, event, 'vein_escape');
    return;
  }

  if (event.containerId === site.quietContainerId && !site.quietCleared && site.triggers === 0) {
    site.quietCleared = true;
    pushLine(state, 'Если идти по мягкому краю, жила только дергается. Мясомер не проснулся.', '#9d8');
    publishMyasomerOutcome(state, site, 'quiet_clear', 3, event, {
      containerId: site.quietContainerId,
      reward: 'rawmeat',
    });
    return;
  }

  if (event.containerId === site.shardContainerId) {
    handleLoudTrigger(state, world, entities, site, event, 'siren_shard_loot');
    return;
  }

  if (event.type === 'collateral_damage' && eventInsideSite(world, site, event)) {
    handleLoudTrigger(state, world, entities, site, event, 'local_blast');
    return;
  }

  if ((event.type === 'player_kill_monster' || event.type === 'npc_kill_monster') && event.targetId !== undefined) {
    maybePublishLoudClear(state, entities, site, event);
  }
}

function markBaited(state: GameState, site: MyasomerSite, event: WorldEvent): void {
  if (site.baited) return;
  site.baited = true;
  pushLine(state, 'Приманка упала в мясную ямку. Следующий рывок уйдет туда.', '#c8f');
  publishMyasomerOutcome(state, site, 'baited', 2, event, {
    baitEventId: event.id,
    counterplay: 'noise_bait',
  });
}

function markFireSeared(state: GameState, site: MyasomerSite, event: WorldEvent): void {
  if (site.fireSeared) return;
  const priorTriggers = site.triggers;
  site.fireSeared = true;
  site.triggers = Math.max(0, site.triggers - 1);
  pushLine(state, 'Огонь подсушил слуховую жилу. Один шум можно списать.', '#fc4');
  publishMyasomerOutcome(state, site, 'fire_seared', 3, event, {
    counterplay: 'fire',
    triggerRelief: priorTriggers - site.triggers,
    threatCap: myasomerThreatCap(site),
  });
}

function handleLoudTrigger(
  state: GameState,
  world: World,
  entities: Entity[],
  site: MyasomerSite,
  event: WorldEvent,
  reason: string,
): void {
  site.triggers++;

  if (site.triggers === 1) {
    pushLine(state, 'В стене начался частый пульс. Еще один громкий шаг поднимет тени.', '#f9a');
    publishMyasomerOutcome(state, site, 'warned', 3, event, { reason, triggers: site.triggers });
    return;
  }

  if (site.triggers === 2) {
    pushLine(state, 'Мясомер засек второй шум. Следующий шум выпустит тень и сборки.', '#f84');
    publishMyasomerOutcome(state, site, 'triggered', 4, event, { reason, triggers: site.triggers });
    return;
  }

  const threatCap = myasomerThreatCap(site);
  if (site.spawned < threatCap) {
    const spawned = spawnMyasomerPressure(world, entities, site);
    if (spawned > 0) {
      pushLine(state, site.fireSeared
        ? 'Мясомер сорвался, но выжженная жила выпустила только сборки.'
        : site.baited
        ? 'Мясомер сорвался, но приманка увела первую тень в сторону.'
        : 'Мясомер сорвался на шум. Из стены вышли тень и сборки.', '#f55');
    }
  }

  publishMyasomerOutcome(state, site, 'triggered', 5, event, {
    reason,
    triggers: site.triggers,
    spawned: site.spawned,
    threatCap,
    baited: site.baited,
    fireSeared: site.fireSeared,
  });
}

function eventInsideSite(world: World, site: MyasomerSite, event: WorldEvent): boolean {
  if (event.roomId === site.roomId) return true;
  if (event.x === undefined || event.y === undefined) return false;
  return world.dist2(event.x, event.y, site.x, site.y) <= RADIUS2;
}

function publishMyasomerOutcome(
  state: GameState,
  site: MyasomerSite,
  outcome: 'warned' | 'triggered' | 'quiet_clear' | 'loud_clear' | 'baited' | 'fire_seared',
  severity: 2 | 3 | 4 | 5,
  source: WorldEvent,
  data: Record<string, unknown>,
): void {
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.x,
    y: site.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetName: `${MYASOMER_NAME}: ${outcome}`,
    itemId: source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    containerId: source.containerId,
    severity,
    privacy: 'local',
    tags: [
      EVENT_TAG,
      MYASOMER_ID,
      `myasomer_${outcome}`,
      'monster',
      'noise',
      'samosbor_aftermath',
      'meat',
      'aftermath',
    ],
    data: {
      sourceEventId: source.id,
      outcome,
      ruName: MYASOMER_NAME,
      warning: myasomerWarningText(outcome, data),
      ...data,
    },
  });
}

type OutcomeType = 'warned' | 'triggered' | 'quiet_clear' | 'loud_clear' | 'baited' | 'fire_seared';

const WARNING_TEXT_STRATEGIES: Record<OutcomeType, (data: Record<string, unknown>) => string> = {
  quiet_clear: () => 'Мясомер не проснулся: тихий край дал награду без теней.',
  loud_clear: () => 'Мясомер сбит: шумовой коридор больше не держит угрозу.',
  baited: () => 'Мясомер отвлечен приманкой: следующий шум даст меньше давления.',
  fire_seared: () => 'Мясная жила выжжена: шум списан, потолок угрозы ниже.',
  warned: (data) => `Мясомер услышал шум ${Number(data.triggers) || 1}/3: уходи краем, брось приманку или жги жилу.`,
  triggered: (data) => `Мясомер сорвался на шум: угроз ${Number(data.spawned) || 0}/${Number(data.threatCap) || MAX_THREATS}, отход по краям.`,
};

function myasomerWarningText(outcome: OutcomeType, data: Record<string, unknown>): string {
  return WARNING_TEXT_STRATEGIES[outcome](data);
}

function pushLine(state: GameState, text: string, color: string): void {
  state.msgs.push(msg(text, state.time, color));
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function findPlayer(entities: readonly Entity[]): Entity | null {
  for (const entity of entities) {
    if (isPlayerEntity(entity) && entity.alive) return entity;
  }
  return null;
}

function myasomerThreatCap(site: MyasomerSite): number {
  if (site.baited && site.fireSeared) return FULL_COUNTERPLAY_THREATS;
  if (site.baited || site.fireSeared) return COUNTERPLAY_THREATS;
  return MAX_THREATS;
}

function spawnMyasomerPressure(world: World, entities: Entity[], site: MyasomerSite): number {
  const player = findPlayer(entities);
  const spawnPlan: MonsterKind[] = site.fireSeared
    ? [MonsterKind.SBORKA, MonsterKind.SBORKA]
    : site.baited
    ? [MonsterKind.SBORKA, MonsterKind.SBORKA]
    : [MonsterKind.SHADOW, MonsterKind.SBORKA, MonsterKind.SBORKA];
  let spawned = 0;
  const threatCap = myasomerThreatCap(site);

  for (const kind of spawnPlan) {
    if (site.spawned >= threatCap) break;
    const pos = findThreatSpawn(world, site, spawned);
    if (!pos) break;
    const id = nextEntityId(entities);
    const def = MONSTERS[kind];
    const zoneLevel = world.zones[site.zoneId]?.level ?? 10;
    const level = zoneLevel + (kind === MonsterKind.SHADOW ? 3 : 1);
    const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level)));
    const targetX = Math.floor(player?.x ?? site.x);
    const targetY = Math.floor(player?.y ?? site.y);
    const monster: Entity = {
      id,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.atan2(site.y - pos.y - 0.5, site.x - pos.x - 0.5),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, level),
      sprite: monsterSpr(kind),
      name: kind === MonsterKind.SHADOW ? 'Мясомерная тень' : 'Сборка на мясной слух',
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.HUNT, tx: targetX, ty: targetY, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(level),
    };
    entities.push(monster);
    site.threatIds.push(id);
    site.spawned++;
    spawned++;
  }

  return spawned;
}

function findThreatSpawn(world: World, site: MyasomerSite, order: number): { x: number; y: number } | null {
  const centerX = Math.floor(site.x);
  const centerY = Math.floor(site.y);
  const ring = [
    [-9, -3], [-9, 3], [9, -3], [9, 3], [-4, -4], [4, 4],
  ] as const;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ring.length; i++) {
      const [dx, dy] = ring[(i + order + pass * 2) % ring.length];
      const x = world.wrap(centerX + dx);
      const y = world.wrap(centerY + dy);
      if (world.roomMap[world.idx(x, y)] === site.roomId && world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y };
    }
  }
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -11; dx <= 11; dx++) {
      const x = world.wrap(centerX + dx);
      const y = world.wrap(centerY + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === site.roomId && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  return null;
}

function maybePublishLoudClear(state: GameState, entities: readonly Entity[], site: MyasomerSite, event: WorldEvent): void {
  if (site.loudCleared || site.spawned <= 0 || !site.threatIds.includes(event.targetId ?? -1)) return;
  const entityMap = new Map<number, Entity>();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    entityMap.set(e.id, e);
  }
  for (const id of site.threatIds) {
    const threat = entityMap.get(id);
    if (threat?.alive) return;
  }
  site.loudCleared = true;
  pushLine(state, 'Мясомер сбит. Больше он не реагирует на шум в этом коридоре.', '#fc4');
  publishMyasomerOutcome(state, site, 'loud_clear', 3, event, {
    clearedThreats: site.threatIds.length,
    rewardTrace: ITEMS.siren_shard?.name ?? 'siren_shard',
  });
}

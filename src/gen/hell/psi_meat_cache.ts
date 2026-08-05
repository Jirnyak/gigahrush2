/* ── Hell PSI meat cache: finite cult trade/theft/fight POI ───── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W, Cell, ContainerKind, Feature, FloorLevel, RoomType, Tex,
  type Entity, EntityType, AIGoal, Faction, Occupation, MonsterKind, QuestType,
  msg,
  type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, rng, stampRoom } from '../shared';
import { isPlayerEntity } from '../../systems/player_actor';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const ROOM_W = 15;
const ROOM_H = 11;
const KEEPER_ID = 'ag54_psi_cache_keeper';
const CACHE_EVENT_TAG = 'ag54_psi_cache_bargain';
const CACHE_RADIUS = 14;
const CACHE_RADIUS2 = CACHE_RADIUS * CACHE_RADIUS;

export const AG54_PSI_CACHE_BACKLASH_CAP = 4;

type PsiCacheBranch = 'pay' | 'refuse' | 'fight' | 'steal';

interface PsiCacheBranchSpec {
  label: string;
  message: string;
  color: string;
  psiLoss: number;
  hpPerMissingPsi: number;
  severity: 3 | 4 | 5;
  threats: readonly MonsterKind[];
}

interface PsiCacheSite {
  floor: FloorLevel;
  roomId: number;
  zoneId: number;
  x: number;
  y: number;
  keeperId: number;
  safeId: number;
  refusalContainerId: number;
  branches: Record<PsiCacheBranch, boolean>;
  backlashSpawned: number;
  backlashIds: number[];
}

const BRANCH_SPECS: Record<PsiCacheBranch, PsiCacheBranchSpec> = {
  pay: {
    label: 'десятина принята',
    message: 'Мясной ПСИ-склад принял мясо. Стабилизатор выдан, Федот отметил вас как плательщика.',
    color: '#dca',
    psiLoss: 2,
    hpPerMissingPsi: 0,
    severity: 3,
    threats: [],
  },
  refuse: {
    label: 'торг отвергнут',
    message: 'Отказной лоток выдал медицину без десятины. Культ заметил пустую кассу; рядом появится Тень.',
    color: '#fa8',
    psiLoss: 4,
    hpPerMissingPsi: 1,
    severity: 4,
    threats: [MonsterKind.SHADOW],
  },
  fight: {
    label: 'склад взят силой',
    message: 'Сторож упал. Склад отвечает ПСИ-ударом и выпускает тварь с тенью.',
    color: '#f66',
    psiLoss: 6,
    hpPerMissingPsi: 1,
    severity: 5,
    threats: [MonsterKind.TVAR, MonsterKind.SHADOW],
  },
  steal: {
    label: 'сейф вскрыт',
    message: 'Влажный сейф открыт. Запас ваш, но банка с голосом вызвала ползуна, духа и тень.',
    color: '#f84',
    psiLoss: 8,
    hpPerMissingPsi: 1,
    severity: 5,
    threats: [MonsterKind.SHADOW, MonsterKind.POLZUN, MonsterKind.SPIRIT],
  },
};

let activeWorld: World | null = null;
let activeEntities: Entity[] | null = null;
let activeSite: PsiCacheSite | null = null;

const KEEPER_DEF: PlotNpcDef = {
  name: 'Федот Мясопев',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 360, maxHp: 360, money: 140, speed: 0.75,
  inventory: [
    { defId: 'psi_meat_hook', count: 1 },
    { defId: 'psi_dust', count: 1 },
    { defId: 'rawmeat', count: 2 },
  ],
  talkLines: [
    'Не трогай подвешенное мясо. Это счетчик кассы: возьмешь лишнее - сторожа встанут.',
    'ПСИ тут не растёт. Его выжимают, закрывают и тратят один раз.',
    'Хочешь честно — принеси сырое мясо для хора. Хочешь быстро — ящик рядом.',
    'Кражу увидит мокрый пол: следы ведут от ящика прямо к тебе.',
  ],
  talkLinesPost: [
    'Склад похудел. Значит, кто-то выбрал вылазку вместо запасов.',
    'Голос в банке не открывай здесь. Банка зовет сторожей со склада.',
    'ПСИ кончилось — возвращайся с мясом, не с просьбой.',
  ],
};

registerSideQuest(KEEPER_ID, KEEPER_DEF, [
  {
    id: 'ag54_keeper_raw_meat_tithe',
    giverNpcId: KEEPER_ID,
    type: QuestType.FETCH,
    desc: 'Федот Мясопев: «Принеси четыре куска сырого мяса. За честный вклад дам стабилизатор, но не запас на новую жизнь.»',
    targetItem: 'rawmeat', targetCount: 4,
    rewardItem: 'psi_stabilizer', rewardCount: 1,
    extraRewards: [{ defId: 'psi_dust', count: 1 }],
    relationDelta: 8, xpReward: 65, moneyReward: 25,
  },
]);

registerWorldEventObserver(handlePsiMeatCacheEvent);

export function generatePsiMeatCache(
  world: World,
  entities: Entity[],
  nextId: { v: number },
): void {
  activeWorld = world;
  activeEntities = entities;
  activeSite = null;

  const origin = findCacheOrigin(world);
  const room = stampCacheRoom(world, origin.x, origin.y);
  decorateCacheRoom(world, room);

  const keeperId = spawnKeeper(world, entities, nextId, room);
  spawnGuard(world, entities, nextId, room, 3, ROOM_H - 3, 'Сторож Жил', 'rebar');
  spawnGuard(world, entities, nextId, room, ROOM_W - 4, ROOM_H - 3, 'Сторож Сухожил', 'psi_strike');

  const safeId = addCacheContainer(world, room, keeperId);
  const refusalContainerId = addRefusalTray(world, room);
  dropCacheFloorItems(world, entities, nextId, room);
  spawnMonsterPressure(world, entities, nextId, room);

  const cx = world.wrap(room.x + (room.w >> 1));
  const cy = world.wrap(room.y + (room.h >> 1));
  activeSite = {
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(cx, cy)],
    x: cx + 0.5,
    y: cy + 0.5,
    keeperId,
    safeId,
    refusalContainerId,
    branches: { pay: false, refuse: false, fight: false, steal: false },
    backlashSpawned: 0,
    backlashIds: [],
  };
}

export function getPsiMeatCacheDebugSite(): PsiCacheSite | null {
  return activeSite ? {
    ...activeSite,
    branches: { ...activeSite.branches },
    backlashIds: [...activeSite.backlashIds],
  } : null;
}

export function resetPsiMeatCacheForTests(): void {
  activeWorld = null;
  activeEntities = null;
  activeSite = null;
}

function handlePsiMeatCacheEvent(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(CACHE_EVENT_TAG)) return;
  const site = activeSite;
  const world = activeWorld;
  if (!site || !world || state.currentFloor !== site.floor || event.floor !== site.floor) return;

  if (event.type === 'quest_completed' && event.data?.sideQuestId === 'ag54_keeper_raw_meat_tithe') {
    applyPsiCacheBranch(state, event, 'pay');
    return;
  }
  if (event.type === 'item_deposited' && event.containerId === site.safeId && event.itemId === 'rawmeat') {
    applyPsiCacheBranch(state, event, 'pay');
    return;
  }
  if (event.type === 'item_stolen' && event.containerId === site.safeId) {
    applyPsiCacheBranch(state, event, 'steal');
    return;
  }
  if (event.type === 'container_opened' && event.containerId === site.refusalContainerId) {
    applyPsiCacheBranch(state, event, 'refuse');
    return;
  }
  if ((event.type === 'player_hurt_npc' || event.type === 'player_kill_npc')
    && (event.targetId === site.keeperId || event.targetFaction === Faction.CULTIST)
    && eventInsideCacheSite(world, site, event)) {
    applyPsiCacheBranch(state, event, 'fight');
  }
}

function eventInsideCacheSite(world: World, site: PsiCacheSite, event: WorldEvent): boolean {
  if (event.roomId === site.roomId) return true;
  if (event.x === undefined || event.y === undefined) return false;
  return world.dist2(event.x, event.y, site.x, site.y) <= CACHE_RADIUS2;
}

function applyPsiCacheBranch(state: GameState, source: WorldEvent, branch: PsiCacheBranch): void {
  const site = activeSite;
  const world = activeWorld;
  const entities = activeEntities;
  if (!site || !world || !entities || site.branches[branch]) return;

  site.branches[branch] = true;
  const spec = BRANCH_SPECS[branch];
  const drain = drainPlayerForCache(entities, spec.psiLoss, spec.hpPerMissingPsi);
  const spawned = spawnCacheBranchBacklash(world, entities, site, spec.threats);
  const warning = psiCacheWarningText(spec, drain, spawned);
  state.msgs.push(msg(spec.message, state.time, spec.color));

  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.x,
    y: site.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetName: `Мясной ПСИ-склад: ${spec.label}`,
    itemId: source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    containerId: source.containerId,
    severity: spec.severity,
    privacy: 'local',
    tags: [CACHE_EVENT_TAG, 'hell_psi_cache', `cache_${branch}`, 'cult_attention', branch, 'psi', 'meat', 'backlash'],
    data: {
      sourceEventId: source.id,
      branch,
      warning,
      psiLost: drain.psiLost,
      hpLost: drain.hpLost,
      spawned,
      backlashCap: AG54_PSI_CACHE_BACKLASH_CAP,
    },
  });
}

function psiCacheWarningText(
  spec: PsiCacheBranchSpec,
  drain: { psiLost: number; hpLost: number },
  spawned: number,
): string {
  const psi = drain.psiLost > 0 ? `ПСИ -${drain.psiLost}` : 'ПСИ не ушло';
  const hp = drain.hpLost > 0 ? `, HP -${drain.hpLost}` : '';
  const guards = spawned > 0 ? `, сторожа ${spawned}` : ', сторожа не вышли';
  return `Мясной ПСИ-склад: ${spec.label}; ${psi}${hp}${guards}. Отход через вход.`;
}

function drainPlayerForCache(
  entities: readonly Entity[],
  psiLoss: number,
  hpPerMissingPsi: number,
): { psiLost: number; hpLost: number } {
  const player = entities.find(entity => isPlayerEntity(entity) && entity.alive);
  if (!player) return { psiLost: 0, hpLost: 0 };

  let psiLost = 0;
  if (player.rpg && psiLoss > 0) {
    const before = player.rpg.psi;
    player.rpg.psi = Math.max(0, player.rpg.psi - psiLoss);
    psiLost = Math.round((before - player.rpg.psi) * 10) / 10;
  }

  let hpLost = 0;
  const missingPsi = Math.max(0, psiLoss - psiLost);
  if (missingPsi > 0 && hpPerMissingPsi > 0 && player.hp !== undefined) {
    hpLost = Math.min(Math.max(0, player.hp - 1), Math.ceil(missingPsi * hpPerMissingPsi));
    player.hp = Math.max(1, player.hp - hpLost);
  }
  return { psiLost, hpLost };
}

function spawnCacheBranchBacklash(
  world: World,
  entities: Entity[],
  site: PsiCacheSite,
  kinds: readonly MonsterKind[],
): number {
  let spawned = 0;
  const player = entities.find(entity => isPlayerEntity(entity) && entity.alive);
  for (const kind of kinds) {
    if (site.backlashSpawned >= AG54_PSI_CACHE_BACKLASH_CAP) break;
    const pos = findCacheBranchSpawn(world, site, site.backlashSpawned + spawned);
    if (!pos) break;
    const id = nextEntityId(entities);
    const def = MONSTERS[kind];
    const zoneLevel = world.zones[site.zoneId]?.level ?? 10;
    const level = zoneLevel + (kind === MonsterKind.POLZUN ? 3 : 2);
    const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level)));
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
      name: kind === MonsterKind.SPIRIT ? 'Дух вскрытого голоса' : kind === MonsterKind.POLZUN ? 'Ползун складской недостачи' : 'Тень мясного склада',
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: def.attackRate,
      ai: { goal: player ? AIGoal.HUNT : AIGoal.WANDER, tx: player?.x ?? site.x, ty: player?.y ?? site.y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(level),
      phasing: kind === MonsterKind.SPIRIT,
    };
    entities.push(monster);
    site.backlashSpawned++;
    site.backlashIds.push(id);
    spawned++;
  }
  return spawned;
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function findCacheBranchSpawn(world: World, site: PsiCacheSite, order: number): { x: number; y: number } | null {
  const room = world.rooms[site.roomId];
  if (!room) return null;
  const ring = [
    [-5, -3], [5, -3], [-5, 3], [5, 3], [0, -4], [0, 4],
  ] as const;
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ring.length; i++) {
      const [dx, dy] = ring[(i + order + pass * 2) % ring.length];
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  return null;
}

function findCacheOrigin(world: World): { x: number; y: number } {
  const cx = W >> 1;
  const cy = W >> 1;
  const clear = findClearArea(world, cx, cy, ROOM_W, ROOM_H, 120, 260);
  if (clear) return clear;

  for (let attempt = 0; attempt < 2400; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = rng(90, 260);
    const x = world.wrap(cx + Math.round(Math.cos(angle) * dist));
    const y = world.wrap(cy + Math.round(Math.sin(angle) * dist));
    if (canReserve(world, x, y)) return { x, y };
  }

  return { x: world.wrap(cx + 170), y: world.wrap(cy - 130) };
}

function canReserve(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function stampCacheRoom(world: World, x: number, y: number): Room {
  const room = stampRoom(world, world.rooms.length, RoomType.STORAGE, x, y, ROOM_W, ROOM_H, -1);
  room.name = 'Мясной ПСИ-склад';
  room.wallTex = Tex.GUT;
  room.floorTex = Tex.F_MEAT;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.GUT, Tex.F_MEAT);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  forceCacheConnection(world, room);
  return room;
}

function forceCacheConnection(world: World, room: Room): void {
  if (hasExternalOpening(world, room)) return;

  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  const probes: [number, number, number, number][] = [
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
    for (let step = 0; step < 128; step++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.LIFT) break;
      if (step > 0 && world.aptMask[ci]) break;
      const walkable = world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.WATER;
      if (step > 0 && walkable && world.roomMap[ci] !== room.id) {
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
    world.floorTex[ci] = Tex.F_GUT;
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
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
      if (world.aptMask[ci]) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (world.roomMap[world.idx(x + ox, y + oy)] === room.id) return true;
      }
    }
  }
  return false;
}

function decorateCacheRoom(world: World, room: Room): void {
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (((dx * 17 + dy * 11) & 3) === 0) world.floorTex[ci] = Tex.F_GUT;
    }
  }

  placeFeature(world, room.x + 2, room.y + 2, Feature.CANDLE);
  placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.CANDLE);
  placeFeature(world, room.x + Math.floor(room.w / 2), room.y + 2, Feature.LAMP);
  placeFeature(world, room.x + 3, room.y + 5, Feature.SHELF);
  placeFeature(world, room.x + room.w - 4, room.y + 5, Feature.SHELF);
  placeFeature(world, room.x + Math.floor(room.w / 2), room.y + 5, Feature.APPARATUS);
  placeFeature(world, room.x + 5, room.y + room.h - 3, Feature.TABLE);
  placeFeature(world, room.x + room.w - 6, room.y + room.h - 3, Feature.TABLE);

  stampSurfaceSplat(world, room.x + 7, room.y + 5, 0.5, 0.5, 5, 150, 54054, 120, 20, 105, false);
}

function placeFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function spawnKeeper(world: World, entities: Entity[], nextId: { v: number }, room: Room): number {
  const x = world.wrap(room.x + Math.floor(room.w / 2));
  const y = world.wrap(room.y + room.h - 4);
  const keeper = requireSpawnedPlotNpcFromPackage(entities, nextId, KEEPER_ID, x + 0.5, y + 0.5, {
    angle: -Math.PI / 2,
    tool: 'psi_meat_hook',
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra: {
      rpg: { level: 9, xp: 0, attrPoints: 0, str: 5, agi: 4, int: 9, psi: 109, maxPsi: 109 },
    },
  });
  return keeper.id;
}

function spawnGuard(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  dx: number,
  dy: number,
  name: string,
  weapon: string,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const psiTool = weapon === 'psi_strike' ? weapon : undefined;
  const weaponId = psiTool ? 'knife' : weapon;
  const inventory = psiTool
    ? [{ defId: 'psi_strike', count: 1 }, { defId: 'knife', count: 1 }]
    : [{ defId: weapon, count: 1 }, { defId: 'meat_rune', count: 1 }];
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.0,
    sprite: Occupation.PILGRIM,
    name,
    needs: freshNeeds(),
    hp: 210,
    maxHp: 210,
    money: 8,
    ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory,
    weapon: weaponId,
    tool: psiTool,
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    questId: -1,
    rpg: { level: 7, xp: 0, attrPoints: 0, str: 5, agi: 3, int: 6, psi: 112, maxPsi: 112 },
  });
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addCacheContainer(world: World, room: Room, ownerNpcId: number): number {
  const x = world.wrap(room.x + Math.floor(room.w / 2));
  const y = world.wrap(room.y + 5);
  const inventory: WorldContainer['inventory'] = [
    { defId: 'bottled_voice', count: 1 },
    { defId: 'psi_dust', count: 1 },
    { defId: 'meat_rune', count: 1 },
    { defId: 'antidep', count: 1 },
    { defId: 'holy_water', count: 1 },
  ];
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SAFE,
    name: 'Влажный сейф мясного хора',
    inventory,
    capacitySlots: 8,
    ownerNpcId,
    ownerName: KEEPER_DEF.name,
    faction: Faction.CULTIST,
    access: 'owner',
    lockDifficulty: 4,
    discovered: true,
    tags: ['hell_psi_cache', 'psi', 'meat', 'voice', 'owner', 'pay_or_steal'],
  });
  return id;
}

function addRefusalTray(world: World, room: Room): number {
  const x = world.wrap(room.x + 2);
  const y = world.wrap(room.y + 5);
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Отказной лоток ПСИ-склада',
    inventory: [
      {
        defId: 'note',
        count: 1,
        data: 'Отказной лоток: берешь медицину без десятины - получаешь ПСИ-удар и тень у двери.',
      },
      { defId: 'bandage', count: 1 },
    ],
    capacitySlots: 4,
    ownerName: KEEPER_DEF.name,
    faction: Faction.CULTIST,
    access: 'public',
    discovered: true,
    tags: ['hell_psi_cache', 'refuse', 'medicine', 'cult_attention'],
  });
  return id;
}

function dropCacheFloorItems(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
): void {
  dropItem(world, entities, nextId, room.x + 2, room.y + room.h - 3, 'rawmeat', 2);
  dropItem(world, entities, nextId, room.x + room.w - 3, room.y + room.h - 3, 'bandage', 1);
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: world.wrap(room.x + room.w - 4) + 0.5,
    y: world.wrap(room.y + 2) + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{
      defId: 'note',
      count: 1,
      data: 'Накладная: стабилизатор за четыре куска сырого мяса; голос в банке выдавать только при краже.',
    }],
  });
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count: number,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnMonsterPressure(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const kinds = [MonsterKind.SHADOW, MonsterKind.POLZUN, MonsterKind.TVAR, MonsterKind.SPIRIT];
  for (let i = 0; i < kinds.length; i++) {
    const pos = findPressureCell(world, room, cx, cy, i, kinds.length);
    if (!pos) continue;
    const kind = kinds[i];
    const def = MONSTERS[kind];
    if (!def) continue;
    const ci = world.idx(pos.x, pos.y);
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 10) : 10;
    const hp = scaleMonsterHp(def.hp, zoneLevel + 1);
    entities.push({
      id: nextId.v++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.atan2(cy - pos.y, cx - pos.x),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: def.sprite,
      name: kind === MonsterKind.SHADOW ? 'Тень у сейфа' : undefined,
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: cx, ty: cy, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel + 1),
      phasing: kind === MonsterKind.SPIRIT,
    });
  }
}

function findPressureCell(
  world: World,
  room: Room,
  cx: number,
  cy: number,
  idx: number,
  total: number,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 80; attempt++) {
    const angle = (Math.PI * 2 * (idx + attempt / 17)) / total;
    const dist = rng(5, 12);
    const x = world.wrap(cx + Math.round(Math.cos(angle) * dist));
    const y = world.wrap(cy + Math.round(Math.sin(angle) * dist));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    if (world.roomMap[ci] === room.id) continue;
    return { x, y };
  }
  return null;
}

/* ── Ministry admin content helpers ───────────────────────────── */

import {
  W, Cell, Tex, Feature, RoomType, EntityType, AIGoal, Faction, Occupation,
  type Room, type Entity, type MonsterKind,
} from '../core/types';
import { World } from '../core/world';
import { freshNeeds } from '../data/catalog';
import { type PlotNpcDef } from '../data/plot';
import { stampRoom, protectRoom, connectProtectedRoom, findClearArea } from './shared';
import { Spr, monsterSpr } from '../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../systems/rpg';
import { MONSTERS } from '../entities/monster';
import { requireSpawnedPlotNpcFromPackage } from './plot_npc_spawn';

export type NextId = { v: number };

export interface AdminRoomSpec {
  type: RoomType;
  name: string;
  w: number;
  h: number;
  minDist: number;
  maxDist: number;
  wallTex?: Tex;
  floorTex?: Tex;
}

function adminFallbackAreaScore(world: World, x: number, y: number, w: number, h: number): number {
  let score = 0;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.hermoWall[ci] || world.cells[ci] === Cell.LIFT || world.containerMap.has(ci)) return Infinity;
      if (world.cells[ci] === Cell.ABYSS) return Infinity;
      if (world.cells[ci] !== Cell.WALL) score += 4;
      if (world.roomMap[ci] >= 0) score += 3;
      if (world.features[ci] !== Feature.NONE) score += 2;
    }
  }
  return score;
}

function findAdminFallbackArea(
  world: World,
  cx: number,
  cy: number,
  w: number,
  h: number,
  minDist: number,
  maxDist: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  const maxR = Math.max(maxDist, Math.floor(W / 2));
  const startR = Math.max(0, Math.min(minDist, maxR));
  for (let r = startR; r <= maxR; r += 8) {
    for (let side = 0; side < 4; side++) {
      for (let step = -r; step <= r; step += 8) {
        const ox = side < 2 ? step : (side === 2 ? -r : r);
        const oy = side < 2 ? (side === 0 ? -r : r) : step;
        const x = world.wrap(cx + ox);
        const y = world.wrap(cy + oy);
        const score = adminFallbackAreaScore(world, x, y, w, h);
        if (!Number.isFinite(score)) continue;
        if (!best || score < best.score) best = { x, y, score };
        if (score === 0) return { x, y };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function createAdminRoom(
  world: World, nextRoomId: number, spawnX: number, spawnY: number, spec: AdminRoomSpec,
): Room | null {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);
  const pos = findClearArea(world, cx, cy, spec.w, spec.h, spec.minDist, spec.maxDist)
    ?? findClearArea(world, cx, cy, spec.w, spec.h, 0, Math.floor(world.dist(0, 0, 512, 512)))
    ?? findAdminFallbackArea(world, cx, cy, spec.w, spec.h, spec.minDist, spec.maxDist);
  if (!pos) {
    console.warn(`[MINISTRY_ADMIN] failed to place ${spec.name}`);
    return null;
  }

  const wallTex = spec.wallTex ?? Tex.MARBLE;
  const floorTex = spec.floorTex ?? Tex.F_PARQUET;
  const room = stampRoom(world, nextRoomId, spec.type, pos.x, pos.y, spec.w, spec.h, -1);
  room.name = spec.name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  protectRoom(world, room.x, room.y, room.w, room.h, wallTex, floorTex);

  const liftCells: number[] = [];
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT) liftCells.push(i);
  }
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  for (const ci of liftCells) {
    if (world.cells[ci] !== Cell.LIFT) world.cells[ci] = Cell.LIFT;
  }

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.floorTex[ci] = floorTex;
      world.wallTex[ci] = wallTex;
    }
  }
  return room;
}

export function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

export function addItemDrop(
  entities: Entity[], nextId: NextId, x: number, y: number, defId: string, count = 1,
): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

export function spawnAdminNpc(
  entities: Entity[], nextId: NextId, _def: PlotNpcDef, plotNpcId: string,
  x: number, y: number, canGiveQuest = true, weapon?: string,
): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    weapon,
    canGiveQuest,
    isTraveler: false,
  });
}

export function spawnNamedCivilian(
  entities: Entity[], nextId: NextId, name: string, isFemale: boolean,
  x: number, y: number, occupation = Occupation.SECRETARY,
  faction = Faction.CITIZEN, inventory = [{ defId: 'note', count: 1 }], weapon?: string,
): void {
  entities.push({
    id: nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: 0.8, sprite: occupation,
    name, isFemale,
    needs: freshNeeds(), hp: 70, maxHp: 70, money: 15,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: inventory.map(i => ({ ...i })),
    weapon,
    faction, occupation,
    questId: -1,
  });
}

export function spawnAdminMonster(
  world: World, entities: Entity[], nextId: NextId,
  x: number, y: number, kind: MonsterKind,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 1) : 1;
  const rpg = randomRPG(zoneLevel);
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(kind),
    hp, maxHp: hp,
    monsterKind: kind, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
  };
  entities.push(monster);
}

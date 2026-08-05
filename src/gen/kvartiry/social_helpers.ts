/* ── Kvartiry social POI helpers ─────────────────────────────── */

import {
  W, Cell, Tex, Feature, RoomType, DoorState,
  type Room, type Entity,
  EntityType, AIGoal, Faction, Occupation,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { type PlotNpcDef } from '../../data/plot';
import { findClearArea, protectRoom, stampRoom, connectProtectedRoom, rng } from '../shared';
import { Spr } from '../../render/sprite_index';
import { registerKvSocialPressurePoi } from './social_pressure';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

export interface SocialPoiRoom {
  room: Room;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type KvSocialMapCueKind = 'repair' | 'bribe' | 'fight' | 'detour';

export interface KvSocialMapCue {
  id: string;
  kind: KvSocialMapCueKind;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  label: string;
  shortLabel: string;
  color: string;
  doorIdx?: number;
}

const socialMapCues = new WeakMap<World, KvSocialMapCue[]>();

export function registerKvSocialMapCue(world: World, cue: KvSocialMapCue): void {
  const cues = socialMapCues.get(world) ?? [];
  const existing = cues.findIndex(c => c.id === cue.id);
  if (existing >= 0) cues[existing] = cue;
  else cues.push(cue);
  socialMapCues.set(world, cues);
}

export function getKvSocialMapCues(world: World): readonly KvSocialMapCue[] {
  return socialMapCues.get(world) ?? [];
}

function socialPoiAreaScore(world: World, x: number, y: number, w: number, h: number): number {
  let score = 0;
  let interiorFloor = 0;
  const interior = w * h;
  const perimeter = (w + 2) * (h + 2) - interior;

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.hermoWall[ci]) return -Infinity;
      if (world.cells[ci] === Cell.LIFT || world.features[ci] === Feature.LIFT_BUTTON) return -Infinity;
      const border = dx < 0 || dx >= w || dy < 0 || dy >= h;
      const cell = world.cells[ci] as Cell;
      if (border) {
        if (cell === Cell.WALL) score += 5;
        else if (cell === Cell.DOOR) score += 2;
        else if (cell === Cell.FLOOR) score -= 3;
        else score -= 12;
        continue;
      }
      if (cell === Cell.FLOOR || cell === Cell.DOOR) {
        interiorFloor++;
        score += cell === Cell.FLOOR ? 3 : 1;
      } else if (cell === Cell.WALL) {
        score += 1;
      } else {
        score -= 12;
      }
      if (world.features[ci] !== Feature.NONE) score -= 2;
    }
  }
  if (interiorFloor < Math.max(4, Math.floor(interior * 0.28))) return -Infinity;
  return score + Math.min(perimeter, interiorFloor);
}

function findSocialPoiArea(
  world: World,
  cx: number,
  cy: number,
  w: number,
  h: number,
  minDist: number,
  maxDist: number,
): { x: number; y: number } | null {
  const minD2 = minDist * minDist;
  const maxD2 = maxDist * maxDist;
  const baseX = Math.floor(cx);
  const baseY = Math.floor(cy);
  let best: { x: number; y: number; score: number } | null = null;

  for (let radius = minDist; radius <= maxDist; radius += 8) {
    const samples = Math.max(32, Math.floor(radius / 3));
    for (let s = 0; s < samples; s++) {
      const angle = (s / samples) * Math.PI * 2 + radius * 0.017;
      const tx = world.wrap(baseX + Math.round(Math.cos(angle) * radius) - (w >> 1));
      const ty = world.wrap(baseY + Math.round(Math.sin(angle) * radius) - (h >> 1));
      const d2 = world.dist2(baseX, baseY, tx + w / 2, ty + h / 2);
      if (d2 < minD2 || d2 > maxD2) continue;
      const score = socialPoiAreaScore(world, tx, ty, w, h);
      if (!Number.isFinite(score)) continue;
      if (!best || score > best.score) best = { x: tx, y: ty, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function createSocialPoiRoom(
  world: World,
  nextRoomId: number,
  nearX: number,
  nearY: number,
  name: string,
  type: RoomType,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
  minDist: number,
  maxDist: number,
  pressure = 1,
): SocialPoiRoom | null {
  const pos = findClearArea(world, Math.floor(nearX), Math.floor(nearY), w, h, minDist, maxDist)
    ?? findSocialPoiArea(world, nearX, nearY, w, h, minDist, maxDist);
  if (!pos) return null;

  const room = stampRoom(world, nextRoomId, type, pos.x, pos.y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  protectRoom(world, room.x, room.y, w, h, wallTex, floorTex);
  connectProtectedRoom(world, room.x, room.y, w, h);
  ensureSocialPoiDoor(world, room);
  registerKvSocialPressurePoi(room.x + w / 2, room.y + h / 2, Math.max(w, h) + 8, pressure);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.FLOOR) world.floorTex[ci] = floorTex;
    }
  }

  return { room, x: room.x, y: room.y, w, h };
}

function ensureSocialPoiDoor(world: World, room: Room): void {
  let best: { idx: number; roomB: number } | null = null;

  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const idx = world.idx(x, y);
      if (world.hermoWall[idx]) continue;
      const cell = world.cells[idx];
      if (cell !== Cell.FLOOR && cell !== Cell.DOOR && cell !== Cell.WALL) continue;

      let touchesRoom = false;
      let hasExternalWalkable = false;
      let roomB = -1;
      for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(x + ox, y + oy);
        const rid = world.roomMap[ni];
        if (rid === room.id) {
          touchesRoom = true;
          continue;
        }
        const nc = world.cells[ni];
        if ((nc === Cell.FLOOR || nc === Cell.DOOR || nc === Cell.WATER) && !world.aptMask[ni]) {
          hasExternalWalkable = true;
          if (rid >= 0) roomB = rid;
        }
      }
      if (!touchesRoom || !hasExternalWalkable) continue;
      if (cell === Cell.DOOR) {
        linkSocialPoiDoor(world, room, idx, roomB);
        return;
      }
      const score = cell === Cell.FLOOR ? 0 : 1;
      if (!best || score < (world.cells[best.idx] === Cell.FLOOR ? 0 : 1)) best = { idx, roomB };
    }
  }

  if (!best) return;
  world.cells[best.idx] = Cell.DOOR;
  world.aptMask[best.idx] = 0;
  world.wallTex[best.idx] = Tex.DOOR_WOOD;
  linkSocialPoiDoor(world, room, best.idx, best.roomB);
}

function linkSocialPoiDoor(world: World, room: Room, idx: number, roomB: number): void {
  const existing = world.doors.get(idx);
  if (existing) {
    existing.roomA = existing.roomA === room.id || existing.roomA >= 0 ? existing.roomA : room.id;
    if (existing.roomA !== room.id && existing.roomB !== room.id) existing.roomB = room.id;
    if (existing.roomB < 0 && roomB >= 0 && existing.roomA !== roomB) existing.roomB = roomB;
  } else {
    world.doors.set(idx, { idx, state: DoorState.CLOSED, roomA: room.id, roomB, keyId: '', timer: 0 });
  }
  if (!room.doors.includes(idx)) room.doors.push(idx);
  const otherRoom = roomB >= 0 ? world.rooms[roomB] : undefined;
  if (otherRoom && !otherRoom.doors.includes(idx)) otherRoom.doors.push(idx);
}

export function setFeatureIfFloor(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

export function placeDropNear(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: SocialPoiRoom,
  defId: string,
  count = 1,
): void {
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = room.x + rng(1, Math.max(1, room.w - 2));
    const y = room.y + rng(1, Math.max(1, room.h - 2));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: x + 0.5, y: y + 0.5,
      angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId, count }],
    });
    return;
  }
}

export function spawnSocialNpc(
  entities: Entity[],
  nextId: { v: number },
  _npc: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  opts: { weapon?: string; spriteScale?: number; traveler?: boolean; goal?: AIGoal } = {},
): void {
  const px = x + 0.5;
  const py = y + 0.5;
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, px, py, {
    angle: Math.random() * Math.PI * 2,
    weapon: opts.weapon,
    isTraveler: opts.traveler,
    aiTarget: { x: px, y: py },
    extra: {
      spriteScale: opts.spriteScale,
      ...(opts.goal ? { ai: { goal: opts.goal, tx: px, ty: py, path: [], pi: 0, stuck: 0, timer: 0 } } : {}),
    },
  });
}

export function spawnAmbientNpc(
  entities: Entity[],
  nextId: { v: number },
  name: string,
  faction: Faction,
  occupation: Occupation,
  x: number,
  y: number,
  inventory: { defId: string; count: number }[] = [],
  weapon?: string,
): void {
  entities.push({
    id: nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: occupation === Occupation.CHILD ? 0.8 : 1.0,
    sprite: occupation,
    spriteScale: occupation === Occupation.CHILD ? 0.6 : undefined,
    name,
    needs: freshNeeds(), hp: occupation === Occupation.CHILD ? 35 : 85, maxHp: occupation === Occupation.CHILD ? 35 : 85,
    money: rng(0, 20),
    ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: inventory.map(i => ({ ...i })),
    weapon,
    faction, occupation,
    questId: -1,
    isTraveler: false,
  });
}

export function roomCell(room: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } {
  return { x: (room.x + dx + W) % W, y: (room.y + dy + W) % W };
}

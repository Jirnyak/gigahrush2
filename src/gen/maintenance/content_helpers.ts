/* ── AG04 maintenance content helpers ───────────────────────────

Safe insertion point documentation:
1. Base maintenance phases 1-7 carve the DFS tunnel grid, rooms, canals,
   spawn point, and lifts.
2. Phase 8 assigns zones and zone levels. AG04 monster packs need this
   data, so POIs are inserted after phase 14d, where existing story POIs
   already live, and before phase 15 `ensureConnectivity()`.
3. AG04 rooms prefer clear wall pockets. If the coarse tunnel grid leaves no
   large pocket, they reserve a no-lift/no-protected rectangle, stamp there,
   connect locally, and let the existing final connectivity pass repair the
   surrounding network. No shared generator code, cell enums, renderer code,
   status systems, economy systems, or event systems are required.
4. Heat/pressure/steam are static content fakes: room names, pipe textures,
   water cells, lamps, machines, apparatus, and NPC lines. There is no
   per-frame pressure or steam simulation.
*/

import {
  W, Cell, Tex, Feature, RoomType,
  type Room, type Entity,
  EntityType, AIGoal, Faction, Occupation, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { type PlotNpcDef } from '../../data/plot';
import {
  canPlaceRoom, connectProtectedRoom, connectToNetwork, findClearArea,
  protectRoom, rng, stampRoom,
} from '../shared';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

export interface MaintContentCtx {
  world: World;
  entities: Entity[];
  nextId: { v: number };
  spawnX: number;
  spawnY: number;
}

export function findMaintArea(
  world: World, cx: number, cy: number, w: number, h: number,
  minDist: number, maxDist: number,
): { x: number; y: number } {
  function canReserve(x: number, y: number): boolean {
    for (let dy = -1; dy <= h; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const ci = world.idx(x + dx, y + dy);
        if (world.cells[ci] === Cell.LIFT || world.aptMask[ci]) return false;
      }
    }
    return true;
  }

  const direct = findClearArea(world, cx, cy, w, h, minDist, maxDist);
  if (direct) return direct;

  for (let i = 0; i < 2400; i++) {
    const x = rng(8, W - w - 8);
    const y = rng(8, W - h - 8);
    if (canPlaceRoom(world, x, y, w, h)) return { x, y };
  }

  for (let y = 8; y < W - h - 8; y += 7) {
    for (let x = 8; x < W - w - 8; x += 7) {
      if (canPlaceRoom(world, x, y, w, h)) return { x, y };
    }
  }

  for (let i = 0; i < 2400; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rng(minDist, maxDist);
    const x = world.wrap(cx + Math.round(Math.cos(a) * d));
    const y = world.wrap(cy + Math.round(Math.sin(a) * d));
    if (canReserve(x, y)) return { x, y };
  }

  for (let y = 8; y < W - h - 8; y += 11) {
    for (let x = 8; x < W - w - 8; x += 11) {
      if (canReserve(x, y)) return { x, y };
    }
  }

  return { x: world.wrap(cx + maxDist), y: world.wrap(cy + maxDist) };
}

export function stampMaintRoom(
  world: World, roomId: number, type: RoomType,
  x: number, y: number, w: number, h: number,
  name: string, wallTex: Tex, floorTex: Tex,
): Room {
  const room = stampRoom(world, roomId, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  protectRoom(world, room.x, room.y, room.w, room.h, wallTex, floorTex);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  connectToNetwork(world, room);
  forceConnectRoom(world, room, floorTex);
  return room;
}

function forceConnectRoom(world: World, room: Room, floorTex: Tex): void {
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

    for (let step = 0; step < 80; step++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.LIFT) break;

      const isForeignProtected = world.aptMask[ci] && world.roomMap[ci] !== room.id;
      if (step > 0 && isForeignProtected) break;

      const walkable = world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.WATER;
      if (step > 0 && walkable && world.roomMap[ci] !== room.id && !world.aptMask[ci]) {
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
    world.floorTex[ci] = floorTex;
    world.aptMask[ci] = 0;
    if (world.roomMap[ci] !== room.id) world.roomMap[ci] = -1;
  }
}

export function openTile(world: World, x: number, y: number, floorTex = Tex.F_CONCRETE): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
}

export function setWater(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
}

export function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) return;
  world.features[ci] = feature;
}

export function dropItems(ctx: MaintContentCtx, room: Room, itemIds: string[]): void {
  for (const defId of itemIds) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = room.x + rng(1, Math.max(1, room.w - 2));
      const y = room.y + rng(1, Math.max(1, room.h - 2));
      const ci = ctx.world.idx(x, y);
      if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER) continue;
      ctx.entities.push({
        id: ctx.nextId.v++, type: EntityType.ITEM_DROP,
        x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
        alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId, count: 1 }],
      });
      break;
    }
  }
}

export function spawnPlotNpc(
  ctx: MaintContentCtx, npcId: string, _def: PlotNpcDef,
  x: number, y: number, angle = 0,
  extra?: Partial<Entity>,
): void {
  const px = x + 0.5;
  const py = y + 0.5;
  requireSpawnedPlotNpcFromPackage(ctx.entities, ctx.nextId, npcId, px, py, {
    angle,
    aiTarget: { x: px, y: py },
    extra,
  });
}

export function spawnAmbientNpc(
  ctx: MaintContentCtx, name: string, faction: Faction, occupation: Occupation,
  x: number, y: number, inventory: { defId: string; count: number }[],
): void {
  ctx.entities.push({
    id: ctx.nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5, angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: 1.0, sprite: occupation,
    name, isFemale: name.endsWith('а') || name.endsWith('я'),
    needs: freshNeeds(), hp: 90, maxHp: 90, money: rng(5, 35),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory,
    faction, occupation, questId: -1,
  });
}

export function spawnMonstersNear(
  ctx: MaintContentCtx, x: number, y: number, kinds: MonsterKind[],
  radiusMin = 4, radiusMax = 10,
): number {
  let spawned = 0;
  for (let i = 0; i < kinds.length; i++) {
    let mx = -1;
    let my = -1;
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = (Math.PI * 2 * (i + attempt / 13)) / kinds.length;
      const d = rng(radiusMin, radiusMax);
      const tx = ctx.world.wrap(x + Math.round(Math.cos(a) * d));
      const ty = ctx.world.wrap(y + Math.round(Math.sin(a) * d));
      if (ctx.world.cells[ctx.world.idx(tx, ty)] === Cell.FLOOR) {
        mx = tx;
        my = ty;
        break;
      }
    }
    if (mx < 0 || my < 0) continue;

    const kind = kinds[i];
    const def = MONSTERS[kind];
    if (!def) continue;

    const ci = ctx.world.idx(mx, my);
    const zid = ctx.world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
    const hp = scaleMonsterHp(def.hp, zoneLevel);

    const monster: Entity = {
      id: ctx.nextId.v++, type: EntityType.MONSTER,
      x: mx + 0.5, y: my + 0.5,
      angle: Math.atan2(y - my, x - mx), pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: def.sprite,
      hp, maxHp: hp,
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
    };
    ctx.entities.push(monster);
    spawned++;
  }
  return spawned;
}

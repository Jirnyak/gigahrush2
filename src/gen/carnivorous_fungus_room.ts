/* ── Corpse-fed carnivorous fungus room dressing ──────────────── */

import { stampSurfaceSplat } from '../systems/surface_marks';
import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
  type Entity, type Room,
} from '../core/types';
import { World } from '../core/world';
import { MONSTERS } from '../entities/monster';
import { monsterSpr, Spr } from '../render/sprite_index';

export const CARNIVOROUS_FUNGUS_ROOM_PREFIX = 'Плотоядная грибница';

export interface CarnivorousFungusOptions {
  seed: number;
  withCounterplayDrops?: boolean;
  withGuardMonster?: boolean;
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
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
    inventory: [{ defId, count, data }],
  });
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function stampFungus(world: World, x: number, y: number, radius: number, seed: number, red = false): void {
  stampSurfaceSplat(world,
    x, y,
    0.5, 0.5,
    radius,
    red ? 170 : 150,
    113_000 + seed,
    red ? 116 : 45,
    red ? 24 : 105,
    red ? 32 : 52,
    false,
  );
}

function spawnGuardMonster(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const def = MONSTERS[MonsterKind.ZOMBIE];
  const x = room.x + room.w - 3;
  const y = room.y + room.h - 3;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: def.speed * 0.82,
    sprite: monsterSpr(MonsterKind.ZOMBIE),
    hp: 24,
    maxHp: 24,
    monsterKind: MonsterKind.ZOMBIE,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: room.x + 2, ty: room.y + 2, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

export function decorateCarnivorousFungusRoom(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  options: CarnivorousFungusOptions,
): void {
  room.name = `${CARNIVOROUS_FUNGUS_ROOM_PREFIX}: костяная сушилка`;
  room.type = RoomType.STORAGE;
  room.wallTex = Tex.ROTTEN;
  room.floorTex = Tex.F_TILE;

  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = room.x + dx;
      const y = room.y + dy;
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.ROTTEN;
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      world.floorTex[ci] = Tex.F_TILE;
      if (Math.abs(dx - Math.floor(room.w / 2)) <= 2 && Math.abs(dy - Math.floor(room.h / 2)) <= 2) {
        world.floorTex[ci] = Tex.F_GUT;
        world.fog[ci] = Math.max(world.fog[ci], 55);
      }
    }
  }

  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [room.w - 2, 1, Feature.LAMP],
    [cx - room.x, cy - room.y, Feature.APPARATUS],
    [cx - room.x - 1, cy - room.y, Feature.MACHINE],
    [cx - room.x + 1, cy - room.y, Feature.MACHINE],
    [2, room.h - 3, Feature.SHELF],
    [room.w - 3, 2, Feature.SHELF],
    [room.w - 4, room.h - 4, Feature.TABLE],
  ] as const) {
    setFeature(world, room.x + dx, room.y + dy, feature);
  }

  world.wallTex[world.idx(cx, room.y - 1)] = Tex.POSTER_BASE + ((options.seed + room.id) % 48);
  world.wallTex[world.idx(room.x - 1, cy)] = Tex.ROTTEN;
  stampFungus(world, cx, cy, 2.9, options.seed, false);
  stampFungus(world, cx - 3, cy + 1, 1.5, options.seed + 1, true);
  stampFungus(world, cx + 3, cy - 1, 1.3, options.seed + 2, true);
  stampFungus(world, room.x + 2, room.y + room.h - 3, 0.8, options.seed + 3, true);
  world.markFogDirty();
  world.markFloorTexDirty();

  dropItem(world, entities, nextId, room.x + 2, room.y + 1, 'note', 1,
    'Плотоядная грибница кормится трупами. Соль гасит, огонь открывает проход, сырой желемыш режут только если готовы платить кожей.');
  if (options.withCounterplayDrops) {
    dropItem(world, entities, nextId, room.x + 3, room.y + 1, 'rock_salt', 2);
    dropItem(world, entities, nextId, room.x + 4, room.y + 1, 'antifungal_ointment', 1);
    dropItem(world, entities, nextId, room.x + room.w - 3, room.y + 1, 'ammo_fuel', 8);
  }

  dropItem(world, entities, nextId, cx - 1, cy - 3, 'mushroom_mass', 1);
  dropItem(world, entities, nextId, room.x + room.w - 4, room.y + room.h - 4, 'zhelemish_raw', 1);

  if (options.withGuardMonster) spawnGuardMonster(world, entities, nextId, room);
}

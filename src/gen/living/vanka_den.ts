/* ── Комната Ваньки Банчиного — испуганный сосед в культовой зоне ─ */
/*   Комната 6×5, облезлые стены, бетонный пол.                   */
/*   Генерируется в ближайшей зоне культистов (100–200 клеток)   */
/*   от спавна. Защищена aptMask.                                  */

import {
  W, Cell, RoomType, Feature, ZoneFaction, MonsterKind,
  type Room, type Entity,
  EntityType, AIGoal,
} from '../../core/types';
import { World } from '../../core/world';
import { PLOT_ROOMS } from '../../data/plot_rooms';
import { MONSTERS } from '../../entities/monster';
import { stampRoom, protectRoom, findClearArea } from '../shared';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';

const DEN_MIN_DIST = 100;
const DEN_MAX_DIST = 200;

export function generateVankaDen(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  spawnX: number, spawnY: number,
): { room: Room; nextRoomId: number } {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);
  const spec = PLOT_ROOMS['vanka_den'];

  // Find cultist zones sorted by distance from spawn
  const cultistZones = world.zones
    .filter(z => z.faction === ZoneFaction.CULTIST)
    .map(z => ({ z, d: world.dist(cx, cy, z.cx, z.cy) }))
    .filter(zd => zd.d >= DEN_MIN_DIST && zd.d <= DEN_MAX_DIST)
    .sort((a, b) => a.d - b.d);

  let room: Room;

  // Strategy A: find existing LIVING room in a cultist zone
  for (const { z } of cultistZones) {
    const candidates = world.rooms.filter(r => {
      if (!r || r.w < 4 || r.h < 4) return false;
      if (r.apartmentId >= 0) return false;
      if (r.type !== RoomType.LIVING && r.type !== RoomType.COMMON && r.type !== RoomType.STORAGE) return false;
      const rmx = r.x + Math.floor(r.w / 2);
      const rmy = r.y + Math.floor(r.h / 2);
      const rZone = world.zoneMap[world.idx(rmx, rmy)];
      return rZone === z.id;
    });
    if (candidates.length > 0) {
      room = candidates[Math.floor(Math.random() * candidates.length)];
      room.name = spec.name;
      room.wallTex = spec.wallTex;
      room.floorTex = spec.floorTex;
      room.type = spec.roomType;
      protectRoom(world, room.x, room.y, room.w, room.h, spec.wallTex, spec.floorTex);
      world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))] = Feature.LAMP;
      spawnVanka(world, room, entities, nextId);
      return { room, nextRoomId };
    }
  }

  // Strategy B: stamp a new room near a cultist zone center
  const targetZone = cultistZones.length > 0 ? cultistZones[0].z : null;
  const tcx = targetZone ? targetZone.cx : (cx + DEN_MIN_DIST) % W;
  const tcy = targetZone ? targetZone.cy : (cy + DEN_MIN_DIST) % W;

  const pos = findClearArea(world, tcx, tcy, spec.w, spec.h, 5, 30);
  const labX = pos ? pos.x : (tcx + 20) % W;
  const labY = pos ? pos.y : (tcy + 20) % W;

  room = stampRoom(world, nextRoomId++, spec.roomType, labX, labY, spec.w, spec.h, -1);
  room.name = spec.name;
  room.wallTex = spec.wallTex;
  room.floorTex = spec.floorTex;
  protectRoom(world, labX, labY, spec.w, spec.h, spec.wallTex, spec.floorTex);

  world.features[world.idx(labX + Math.floor(spec.w / 2), labY + Math.floor(spec.h / 2))] = Feature.LAMP;
  // Sparse furniture — bed and shelf
  world.features[world.idx(labX + 1, labY + 1)] = Feature.BED;
  world.features[world.idx(labX + spec.w - 2, labY + 1)] = Feature.SHELF;

  spawnVanka(world, room, entities, nextId);
  return { room, nextRoomId };
}

function spawnVanka(_world: World, room: Room, entities: Entity[], nextId: { v: number }): void {
  const rcx = room.x + Math.floor(room.w / 2);
  const rcy = room.y + Math.floor(room.h / 2);
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'vanka', rcx + 0.5, rcy + 0.5, { angle: Math.PI });
}

/** Scatter shadow monsters around Vanka's den — must be called AFTER volatile maze exists. */
export function spawnVankaShadows(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  // Find Vanka's room by plotNpcId
  const vanka = entities.find(e => e.plotNpcId === 'vanka');
  if (!vanka) return;
  const denCx = Math.floor(vanka.x);
  const denCy = Math.floor(vanka.y);

  const def = MONSTERS[MonsterKind.SHADOW];
  for (let i = 0, placed = 0; i < 2000 && placed < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 40;
    const mx = (denCx + Math.round(Math.cos(angle) * dist) + W) % W;
    const my = (denCy + Math.round(Math.sin(angle) * dist) + W) % W;
    if (world.cells[world.idx(mx, my)] !== Cell.FLOOR) continue;
    const zoneLevel = Math.max(1, world.zoneMap[world.idx(mx, my)] + 1);
    const rpg = randomRPG(zoneLevel);
    const hp = scaleMonsterHp(def.hp, zoneLevel);
    entities.push({
      id: nextId.v++, type: EntityType.MONSTER,
      x: mx + 0.5, y: my + 0.5,
      angle: Math.random() * Math.PI * 2, pitch: 0,
      alive: true, speed: scaleMonsterSpeed(def.speed, zoneLevel), sprite: def.sprite,
      hp, maxHp: hp,
      monsterKind: MonsterKind.SHADOW, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg,
    });
    placed++;
  }
}

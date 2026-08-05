/* ── Mancobus Room — boss arena on maintenance floor ──────────── */
/*   Large dark room housing the Mancobus boss monster.          */
/*   Protected by aptMask. 40-100 cells from maintenance spawn.  */

import {
  W, Cell, Tex, Feature, MonsterKind,
  type Room, type Entity,
  EntityType, AIGoal,
} from '../../core/types';
import { World } from '../../core/world';

import { stampRoom, protectRoom, connectProtectedRoom, findClearArea } from '../shared';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';

const ROOM_W = 11;
const ROOM_H = 11;
const MIN_DIST = 40;
const MAX_DIST = 100;

export function generateMancobusRoom(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  spawnX: number, spawnY: number,
): { room: Room; nextRoomId: number } {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);

  // Find a clear area for the boss room
  const pos = findClearArea(world, cx, cy, ROOM_W, ROOM_H, MIN_DIST, MAX_DIST);
  const roomX = pos ? pos.x : (cx + 70) % W;
  const roomY = pos ? pos.y : (cy + 70) % W;

  const room = stampRoom(world, nextRoomId++, 5 /* COMMON */, roomX, roomY, ROOM_W, ROOM_H, -1);
  room.name = 'Логово Манкобуса';
  room.wallTex = Tex.MEAT;
  room.floorTex = Tex.F_MEAT;
  protectRoom(world, roomX, roomY, ROOM_W, ROOM_H, Tex.MEAT, Tex.F_MEAT);
  connectProtectedRoom(world, roomX, roomY, ROOM_W, ROOM_H);

  // Dark lamps — minimal lighting
  const rcx = roomX + Math.floor(ROOM_W / 2);
  const rcy = roomY + Math.floor(ROOM_H / 2);
  world.features[world.idx(rcx, rcy)] = Feature.LAMP;
  world.features[world.idx(roomX + 1, roomY + 1)] = Feature.LAMP;
  world.features[world.idx(roomX + ROOM_W - 2, roomY + ROOM_H - 2)] = Feature.LAMP;

  // Spawn Mancobus boss
  const mdef = MONSTERS[MonsterKind.MANCOBUS];
  const zid = world.zoneMap[world.idx(rcx, rcy)];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 8) : 8;
  const rpg = randomRPG(zoneLevel + 5);
  const hp = Math.round(scaleMonsterHp(mdef.hp, zoneLevel + 5));

  entities.push({
    id: nextId.v++, type: EntityType.MONSTER,
    x: rcx + 0.5, y: rcy + 0.5,
    angle: 0, pitch: 0, alive: true,
    speed: scaleMonsterSpeed(mdef.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.MANCOBUS),
    name: 'Манкобус',
    hp, maxHp: hp,
    monsterKind: MonsterKind.MANCOBUS, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
  });

  // 10 random guardian monsters around the boss
  const guardPool: MonsterKind[] = [
    MonsterKind.TVAR, MonsterKind.SHADOW, MonsterKind.POLZUN,
    MonsterKind.ZOMBIE, MonsterKind.SBORKA, MonsterKind.EYE,
    MonsterKind.NIGHTMARE, MonsterKind.REBAR, MonsterKind.BETONNIK,
  ];
  for (let g = 0; g < 10; g++) {
    let gx = -1, gy = -1;
    for (let attempt = 0; attempt < 30; attempt++) {
      const tx = roomX + 1 + Math.floor(Math.random() * (ROOM_W - 2));
      const ty = roomY + 1 + Math.floor(Math.random() * (ROOM_H - 2));
      // Avoid center where boss is
      if (Math.abs(tx - rcx) <= 1 && Math.abs(ty - rcy) <= 1) continue;
      const ci = world.idx(tx, ty);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      gx = tx; gy = ty; break;
    }
    if (gx < 0) continue;
    const gKind = guardPool[Math.floor(Math.random() * guardPool.length)];
    const gdef = MONSTERS[gKind];
    if (!gdef) continue;
    const gRpg = randomRPG(zoneLevel + 3);
    const gHp = Math.round(scaleMonsterHp(gdef.hp, zoneLevel + 3));
    entities.push({
      id: nextId.v++, type: EntityType.MONSTER,
      x: gx + 0.5, y: gy + 0.5,
      angle: Math.random() * Math.PI * 2, pitch: 0, alive: true,
      speed: scaleMonsterSpeed(gdef.speed, zoneLevel + 2),
      sprite: monsterSpr(gKind),
      hp: gHp, maxHp: gHp,
      monsterKind: gKind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: gRpg,
    });
  }

  return { room, nextRoomId };
}

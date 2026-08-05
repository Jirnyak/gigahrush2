/* ── Intro Atrium — Актовый зал + Оружейная (Стрельбище) ───────── */
/*   Self-contained content module:                               */
/*     • Актовый зал — briefing room with slides & desks          */
/*     • Оружейная — armory / shooting range with targets          */
/*     • NPCs: Ольга Дмитриевна (tutor), Сержант Баринов (armory)           */
/*     • Quest chain: Ольга→сержант Баринов→Ольга                           */
/*     • Item drops: makarov, ammo, supplies near counters         */
/*     • Keybind hint textures for tutorial room walls             */
/*                                                                 */
/*   To add a new hand-crafted room, create a similar file and     */
/*   call it from the living/index.ts orchestrator.                */

import {
  W, Cell, ContainerKind, DoorState, FloorLevel, Tex, RoomType, Feature,
  type Room, type Entity,
  type Item, type WorldContainer,
  EntityType,
} from '../../core/types';
import { World } from '../../core/world';
import { stampRoom, protectRoom } from '../shared';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { Spr } from '../../render/sprite_index';

function protectTutorialWallsAsHermetic(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx !== -1 && dx !== w && dy !== -1 && dy !== h) continue;
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.WALL) world.hermoWall[idx] = 1;
    }
  }
}

const STARTER_LOCKER_LOOT: readonly Item[] = [
  { defId: 'water', count: 1 },
  { defId: 'bread', count: 1 },
  { defId: 'bandage', count: 1 },
];

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function starterLockerLoot(): Item[] {
  return STARTER_LOCKER_LOOT.map(item => ({ ...item }));
}

function addStarterLocker(world: World, room: Room, x: number, y: number): WorldContainer {
  const idx = world.idx(x, y);
  world.features[idx] = Feature.SHELF;
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[idx],
    kind: ContainerKind.EMERGENCY_BOX,
    name: 'Учебный шкафчик вылазки',
    inventory: starterLockerLoot(),
    capacitySlots: 6,
    access: 'public',
    discovered: true,
    tags: ['tutorial', 'starter', 'public', 'low_level_loot'],
  };
  world.addContainer(container);
  return container;
}

export function generateTutorRoom(world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, isTutorial: boolean = false): { room: Room, spawnX: number, spawnY: number, nextRoomId: number } {

  /* ================================================================
   *  A. Актовый зал (briefing hall) — existing tutorial room
   * ================================================================ */
  const hallW = 11, hallH = 9;
  const armW = 7, armH = 14;
  const cafeW = 8, cafeH = 8;
  const bathW = 5, bathH = 5;

  // Find clear position near center — never overwrite apartments (aptMask)
  let hallX = 512 - Math.floor(hallW / 2);
  let hallY = 512 - Math.floor(hallH / 2);
  function areaClear(bx: number, by: number, fw: number, fh: number): boolean {
    for (let dy = -1; dy <= fh; dy++)
      for (let dx = -1; dx <= fw; dx++)
        if (world.aptMask[world.idx((bx + dx + W) % W, (by + dy + W) % W)]) return false;
    return true;
  }
  if (!areaClear(hallX, hallY, hallW + 1 + armW, Math.max(hallH, armH + 1) + cafeH + bathH)) {
    // Spiral search outward from center for a clear spot
    let found = false;
    for (let r = 1; r < 200 && !found; r++)
      for (let dy = -r; dy <= r && !found; dy++)
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = (512 - Math.floor(hallW / 2) + dx + W) % W;
          const ty = (512 - Math.floor(hallH / 2) + dy + W) % W;
          if (areaClear(tx, ty, hallW + 1 + armW, Math.max(hallH, armH + 1) + cafeH + bathH)) {
            hallX = tx; hallY = ty; found = true;
          }
        }
  }

  const room = stampRoom(world, nextRoomId++, RoomType.COMMON, hallX, hallY, hallW, hallH, -1);
  room.name = 'Актовый зал';
  room.wallTex = Tex.TILE_W;
  room.floorTex = Tex.F_TILE;
  room.sealed = false; // Must be false so ensureConnectivity punches an exit to the maze!
  protectRoom(world, hallX, hallY, hallW, hallH, Tex.TILE_W, Tex.F_TILE);
  protectTutorialWallsAsHermetic(world, hallX, hallY, hallW, hallH);

  // Desks: feature layer props, not live entity billboards.
  for (let dy = 2; dy <= hallH - 3; dy += 2)
    for (let dx = 1; dx < hallW - 1; dx++)
      if (dx % 2 === 1) {
        world.features[world.idx(hallX + dx, hallY + dy)] = Feature.DESK;
      }

  // Slide walls: 2 cells on the north wall
  const slideX1 = hallX + Math.floor(hallW / 2) - 1;
  const slideX2 = hallX + Math.floor(hallW / 2);
  const slideY = hallY - 1;
  for (const sx of [slideX1, slideX2]) {
    const si = world.idx(sx, slideY);
    world.wallTex[si] = Tex.SLIDE_1;
    world.features[si] = Feature.SLIDE;
    world.slideCells.push(si);
  }

  // Keybind hint posters: west wall now, east wall after armory (protectRoom overwrites)
  {
    let hi = 0;
    // West wall of hall: x = hallX - 1 (5 textures on dy=0,2,4,6,8)
    for (let dy = 0; dy < hallH && hi < 7; dy += 2) {
      world.wallTex[world.idx(hallX - 1, hallY + dy)] = Tex.HINT_1 + hi;
      hi++;
    }
    // East wall hints are placed after armory section below
  }

  // Lamps
  world.features[world.idx(hallX + Math.floor(hallW / 2), hallY + Math.floor(hallH / 2))] = Feature.LAMP;
  world.features[world.idx(hallX + 2, hallY + 2)] = Feature.LAMP;
  world.features[world.idx(hallX + hallW - 3, hallY + 2)] = Feature.LAMP;
  addStarterLocker(world, room, hallX + 1, hallY + hallH - 2);

  requireSpawnedPlotNpcFromPackage(entities, nextId, 'olga',
    hallX + Math.floor(hallW / 2) + 0.5,
    hallY + 1.5,
    {
      angle: Math.PI / 2,
      spriteSeed: 90,
    });

  /* ================================================================
   *  C. Cafeteria + Bathroom (tutorial steps)
   * ================================================================ */
  const cafeX = hallX + Math.floor(hallW / 2) - Math.floor(cafeW / 2);
  const cafeY = hallY - cafeH - 1;
  const cafeteria = stampRoom(world, nextRoomId++, RoomType.COMMON, cafeX, cafeY, cafeW, cafeH, -1);
  cafeteria.name = 'Столовая';
  cafeteria.wallTex = Tex.TILE_W;
  cafeteria.floorTex = Tex.F_LINO;
  cafeteria.sealed = true;
  protectRoom(world, cafeX, cafeY, cafeW, cafeH, Tex.TILE_W, Tex.F_LINO);
  protectTutorialWallsAsHermetic(world, cafeX, cafeY, cafeW, cafeH);
  
  if (isTutorial) {
    world.features[world.idx(cafeX + 1, cafeY + 1)] = Feature.SINK;
  }

  // Door to cafeteria starts locked. Move it to the side so it doesn't overlap the slide.
  const hallCafeDoor = world.idx(hallX + Math.floor(hallW / 2) - 2, hallY - 1);
  world.cells[hallCafeDoor] = Cell.DOOR;
  world.wallTex[hallCafeDoor] = Tex.DOOR_METAL;
  world.floorTex[hallCafeDoor] = Tex.F_LINO;
  world.aptMask[hallCafeDoor] = 1;
  world.hermoWall[hallCafeDoor] = 1;
  world.doors.set(hallCafeDoor, {
    idx: hallCafeDoor,
    state: DoorState.LOCKED,
    roomA: room.id,
    roomB: cafeteria.id,
    keyId: 'tut_cafe_key',
    timer: 0,
  });
  room.doors.push(hallCafeDoor);
  cafeteria.doors.push(hallCafeDoor);
  world.aptMask[world.idx(hallX + Math.floor(hallW / 2) - 3, hallY - 1)] = 1;
  world.aptMask[world.idx(hallX + Math.floor(hallW / 2) - 1, hallY - 1)] = 1;

  const bathX = cafeX - bathW - 1;
  const bathY = cafeY;
  const bathroom = stampRoom(world, nextRoomId++, RoomType.BATHROOM, bathX, bathY, bathW, bathH, -1);
  bathroom.name = 'Уборная';
  bathroom.wallTex = Tex.TILE_W;
  bathroom.floorTex = Tex.F_TILE;
  bathroom.sealed = true;
  protectRoom(world, bathX, bathY, bathW, bathH, Tex.TILE_W, Tex.F_TILE);
  protectTutorialWallsAsHermetic(world, bathX, bathY, bathW, bathH);

  const cafeBathDoor = world.idx(cafeX - 1, cafeY + Math.floor(bathH / 2));
  world.cells[cafeBathDoor] = Cell.DOOR;
  world.wallTex[cafeBathDoor] = Tex.DOOR_WOOD;
  world.floorTex[cafeBathDoor] = Tex.F_LINO;
  world.aptMask[cafeBathDoor] = 1;
  world.hermoWall[cafeBathDoor] = 1;
  world.doors.set(cafeBathDoor, {
    idx: cafeBathDoor,
    state: DoorState.HERMETIC_OPEN,
    roomA: cafeteria.id,
    roomB: bathroom.id,
    keyId: '',
    timer: 0,
  });
  cafeteria.doors.push(cafeBathDoor);
  bathroom.doors.push(cafeBathDoor);
  world.aptMask[world.idx(cafeX - 1, cafeY + Math.floor(bathH / 2) - 1)] = 1;
  world.aptMask[world.idx(cafeX - 1, cafeY + Math.floor(bathH / 2) + 1)] = 1;

  world.features[world.idx(bathX + Math.floor(bathW / 2), bathY + bathH - 2)] = Feature.TOILET;
  if (isTutorial) {
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: bathX + Math.floor(bathW / 2) + 0.5,
      y: bathY + Math.floor(bathH / 2) + 0.5,
      angle: 0, pitch: 0,
      alive: true, speed: 0,
      sprite: Spr.ITEM_DROP, spriteScale: 1.0,
      inventory: [{ defId: 'tut_cafe_key', count: 1 }],
    });
  }

  /* ================================================================
   *  B. Оружейная / Стрельбище (armory + shooting range)
   * ================================================================ */
  const armX = hallX + hallW + 1;
  const armY = hallY + 1;

  const armory = stampRoom(world, nextRoomId++, RoomType.PRODUCTION, armX, armY, armW, armH, -1);
  armory.name = 'Оружейная';
  armory.wallTex = Tex.METAL;
  armory.floorTex = Tex.F_CONCRETE;
  armory.sealed = true;
  protectRoom(world, armX, armY, armW, armH, Tex.METAL, Tex.F_CONCRETE);
  protectTutorialWallsAsHermetic(world, armX, armY, armW, armH);

  // ── Connecting corridor (2 cells between halls) + door ──
  const doorY = hallY + Math.floor(hallH / 2);
  const gapX = hallX + hallW;
  const hallArmoryDoor = world.idx(gapX, doorY);
  world.cells[hallArmoryDoor] = Cell.DOOR;
  world.wallTex[hallArmoryDoor] = Tex.DOOR_METAL;
  world.floorTex[hallArmoryDoor] = Tex.F_LINO;
  world.aptMask[hallArmoryDoor] = 1;
  world.hermoWall[hallArmoryDoor] = 1;
  world.doors.set(hallArmoryDoor, {
    idx: hallArmoryDoor,
    state: DoorState.LOCKED,
    roomA: room.id,
    roomB: armory.id,
    keyId: 'tut_cafe_key',
    timer: 0,
  });
  room.doors.push(hallArmoryDoor);
  armory.doors.push(hallArmoryDoor);
  world.aptMask[world.idx(gapX, doorY - 1)] = 1;
  world.aptMask[world.idx(gapX, doorY + 1)] = 1;

  // ── Targets on far (south) wall ──
  for (let dx = 0; dx < armW; dx++) {
    const ci = world.idx(armX + dx, armY + armH);
    if (world.cells[ci] === Cell.WALL) {
      world.wallTex[ci] = Tex.TARGET;
    }
  }

  // ── Counter/barrier line at y offset 3 ──
  const counterY = armY + 3;
  for (let dx = 1; dx < armW - 1; dx++) {
    world.features[world.idx(armX + dx, counterY)] = Feature.DESK;
  }

  // ── Lamps in armory ──
  world.features[world.idx(armX + Math.floor(armW / 2), armY + 1)] = Feature.LAMP;
  world.features[world.idx(armX + Math.floor(armW / 2), armY + armH - 3)] = Feature.LAMP;
  world.features[world.idx(armX + 1, armY + 7)] = Feature.LAMP;
  world.features[world.idx(armX + armW - 2, armY + 7)] = Feature.LAMP;

  // ── Item drops: ammo on counter ──
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: armX + 3 + 0.5, y: armY + 1 + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0,
    sprite: Spr.ITEM_DROP, spriteScale: 1.0,
    inventory: [{ defId: 'ammo_9mm', count: 8 }],
  });

  requireSpawnedPlotNpcFromPackage(entities, nextId, 'barni', armX + 2.5, armY + 1.5, { 
    angle: Math.PI,
  });

  // ── East wall hint posters ──
  {
    const doorDy = Math.floor(hallH / 2);
    let hi = 5;
    for (let dy = hallH - 1; dy >= 0 && hi < 7; dy -= 2) {
      if (dy === doorDy) continue;
      world.wallTex[world.idx(hallX + hallW, hallY + dy)] = Tex.HINT_1 + hi;
      hi++;
    }
  }

  // ── Lore poster on south wall (center) ──
  world.wallTex[world.idx(hallX + Math.floor(hallW / 2), hallY + hallH)] = Tex.HINT_LORE;

  // ── Re-apply slide textures to guarantee they are never overwritten ──
  for (const sx of [slideX1, slideX2]) {
    const si = world.idx(sx, slideY);
    world.wallTex[si] = Tex.SLIDE_1;
    world.features[si] = Feature.SLIDE;
  }

  // ── Player spawn ──
  const spawnX = isTutorial ? cafeX + Math.floor(cafeW / 2) + 0.5 : hallX + Math.floor(hallW / 2) + 0.5;
  const spawnY = isTutorial ? cafeY + Math.floor(cafeH / 2) + 0.5 : hallY + hallH - 2 + 0.5;

  return { room, spawnX, spawnY, nextRoomId };
}

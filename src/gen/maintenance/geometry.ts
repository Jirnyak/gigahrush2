/* -- Collector macro-geometry: water routes, dry ledges, locks. -- */

import { Cell, Tex, RoomType, Feature, type Room } from '../../core/types';
import { World } from '../../core/world';
import { placeEmergencyPanel } from '../../systems/emergency_panels';

const PIPE_WALL = Tex.PIPE;
const DRY_FLOOR = Tex.F_CONCRETE;
const WATER_FLOOR = Tex.F_WATER;
const PANEL_POWER_ROOM = 'Щитовая хорда: световой автомат';
const PANEL_WATER_ROOM = 'Щитовая хорда: водяной байпас';
const PANEL_DOORS_ROOM = 'Щитовая хорда: дверной обход';
const PANEL_VENT_ROOM = 'Щитовая хорда: вентиляционный сброс';
const REPAIR_CHORD_ROOM = 'Ремонтная обходная хорда: сухой склад';

type Dir = 'n' | 's' | 'w' | 'e';
type PanelId = 'panel_power' | 'panel_water' | 'panel_doors' | 'panel_vent';

export function applyCollectorMacroGeometry(
  world: World,
  rooms: Room[],
  nextRoomId: number,
  centerX: number,
  centerY: number,
): number {
  carveServiceSpineLayer(world, centerX, centerY);
  carvePipeLabyrinthLayer(world, centerX, centerY);
  carveDrainageProxyLayer(world, centerX, centerY);

  nextRoomId = stampPumpStation(world, rooms, nextRoomId, centerX - 12, centerY - 9);
  nextRoomId = stampValveCross(world, rooms, nextRoomId, centerX + 72, centerY - 74);
  nextRoomId = stampFloodedBasin(world, rooms, nextRoomId, centerX - 166, centerY + 96);
  nextRoomId = stampDrainageProxyField(world, rooms, nextRoomId, centerX - 284, centerY - 10);
  nextRoomId = stampHeatlineBridge(world, rooms, nextRoomId, centerX + 120, centerY + 104);
  nextRoomId = stampOutpostMouth(world, rooms, nextRoomId, centerX - 178, centerY - 128);
  nextRoomId = stampServiceDuctChord(world, rooms, nextRoomId, centerX + 196, centerY - 188);
  nextRoomId = stampEmergencyPanelChordLayer(world, rooms, nextRoomId, centerX, centerY);

  const locks: [number, number, boolean, string][] = [
    [centerX - 118, centerY + 7, true, 'Шлюз давления: западный сброс'],
    [centerX + 156, centerY + 7, true, 'Шлюз давления: восточный сброс'],
    [centerX - 20, centerY - 148, false, 'Шлюз давления: северный стояк'],
    [centerX - 20, centerY + 164, false, 'Шлюз давления: нижний стояк'],
    [centerX + 166, centerY - 70, true, 'Шлюз давления: верхняя перемычка'],
    [centerX + 68, centerY + 154, false, 'Шлюз давления: обратный ход'],
  ];
  for (const [x, y, horizontal, name] of locks) {
    nextRoomId = stampPressureLock(world, rooms, nextRoomId, x, y, horizontal, name);
  }

  return nextRoomId;
}

export function placeCollectorMacroPanels(world: World, _centerX: number, _centerY: number): number {
  const placements: readonly { roomName: string; dx: number; dy: number; panelId: PanelId; seed: number }[] = [
    { roomName: PANEL_POWER_ROOM, dx: 3, dy: 3, panelId: 'panel_power', seed: 0x4d01 },
    { roomName: PANEL_WATER_ROOM, dx: 8, dy: 3, panelId: 'panel_water', seed: 0x4d02 },
    { roomName: PANEL_DOORS_ROOM, dx: 7, dy: 3, panelId: 'panel_doors', seed: 0x4d03 },
    { roomName: PANEL_VENT_ROOM, dx: 4, dy: 3, panelId: 'panel_vent', seed: 0x4d04 },
  ];

  let placed = 0;
  for (const item of placements) {
    const room = roomsByName(world, item.roomName);
    if (!room) continue;
    const x = world.wrap(room.x + Math.max(1, Math.min(room.w - 2, item.dx)));
    const y = world.wrap(room.y + Math.max(1, Math.min(room.h - 2, item.dy)));
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) setFloor(world, x, y, room.id);
    if (placeEmergencyPanel(world, x, y, item.panelId, item.seed ^ room.id * 197)) placed++;
  }
  return placed;
}

function roomsByName(world: World, name: string): Room | undefined {
  return world.rooms.find(room => room?.name === name);
}

function stampMacroRoom(
  world: World,
  rooms: Room[],
  id: number,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
): Room {
  const room: Room = {
    id,
    type,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: PIPE_WALL,
    floorTex: DRY_FLOOR,
  };

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.features[ci] = Feature.NONE;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = DRY_FLOOR;
        world.wallTex[ci] = PIPE_WALL;
        world.roomMap[ci] = id;
      } else {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = PIPE_WALL;
        world.roomMap[ci] = -1;
      }
    }
  }

  world.rooms[id] = room;
  rooms.push(room);
  return room;
}

function setFloor(world: World, x: number, y: number, roomId = -2): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = DRY_FLOOR;
  if (roomId !== -2) world.roomMap[ci] = roomId;
}

function setWater(world: World, x: number, y: number, roomId = -2): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = WATER_FLOOR;
  world.features[ci] = Feature.NONE;
  if (roomId !== -2) world.roomMap[ci] = roomId;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL) setFloor(world, x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.features[ci] = feature;
}

function carveDryH(world: World, x0: number, x1: number, y: number, halfWidth = 0): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) {
    for (let dy = -halfWidth; dy <= halfWidth; dy++) setFloor(world, x, y + dy);
  }
}

function carveDryV(world: World, x: number, y0: number, y1: number, halfWidth = 0): void {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let y = lo; y <= hi; y++) {
    for (let dx = -halfWidth; dx <= halfWidth; dx++) setFloor(world, x + dx, y);
  }
}

function carveWaterH(world: World, x0: number, x1: number, y: number, halfWidth = 1): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) {
    for (let dy = -halfWidth; dy <= halfWidth; dy++) setWater(world, x, y + dy);
  }
  carveDryH(world, lo, hi, y - halfWidth - 2);
  carveDryH(world, lo, hi, y + halfWidth + 2);
}

function carveWaterV(world: World, x: number, y0: number, y1: number, halfWidth = 1): void {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let y = lo; y <= hi; y++) {
    for (let dx = -halfWidth; dx <= halfWidth; dx++) setWater(world, x + dx, y);
  }
  carveDryV(world, x - halfWidth - 2, lo, hi);
  carveDryV(world, x + halfWidth + 2, lo, hi);
}

function carveServiceSpineLayer(world: World, cx: number, cy: number): void {
  carveDryH(world, cx - 220, cx + 230, cy, 1);
  carveDryV(world, cx, cy - 210, cy + 230, 1);
  carveDryH(world, cx - 212, cx - 46, cy - 42, 1);
  carveDryV(world, cx - 212, cy - 42, cy + 126, 1);
  carveDryH(world, cx + 38, cx + 230, cy + 58, 1);
  carveDryV(world, cx + 230, cy - 90, cy + 58, 1);
  carveDryH(world, cx - 316, cx - 96, cy - 104, 0);
  carveDryV(world, cx - 316, cy - 104, cy + 42, 0);
  carveDryH(world, cx + 112, cx + 304, cy - 142, 0);
  carveDryV(world, cx + 304, cy - 142, cy + 92, 0);
  carveDryH(world, cx - 20, cx + 304, cy + 92, 0);

  for (const [x, y] of [
    [cx - 80, cy],
    [cx + 88, cy],
    [cx, cy - 86],
    [cx, cy + 96],
    [cx - 212, cy + 42],
    [cx + 230, cy - 22],
    [cx - 316, cy - 32],
    [cx + 304, cy + 38],
  ] as const) {
    setFeature(world, x, y, Feature.LAMP);
    setFeature(world, x + 2, y, Feature.MACHINE);
  }
}

function carvePipeLabyrinthLayer(world: World, cx: number, cy: number): void {
  carveWaterH(world, cx - 278, cx + 286, cy + 11, 1);
  carveWaterV(world, cx - 12, cy - 278, cy + 286, 1);
  carveWaterH(world, cx - 236, cx + 238, cy - 66, 1);
  carveWaterV(world, cx + 74, cy - 220, cy + 238, 1);
  carveWaterH(world, cx - 238, cx + 156, cy + 172, 1);
  carveDoglegDuct(world, cx - 154, cy - 172, cx - 70, cy - 66, false);
  carveDoglegDuct(world, cx + 74, cy - 18, cx + 184, cy + 58, true);
  carveDoglegDuct(world, cx - 12, cy + 116, cx - 134, cy + 172, true);
  carveDoglegDuct(world, cx + 166, cy - 66, cx + 232, cy - 18, false);

  for (const [x, y] of [
    [cx - 190, cy + 11],
    [cx - 52, cy + 11],
    [cx + 58, cy + 11],
    [cx + 202, cy + 11],
    [cx - 12, cy - 196],
    [cx - 12, cy - 88],
    [cx - 12, cy + 104],
    [cx - 12, cy + 214],
    [cx + 74, cy - 142],
    [cx + 74, cy + 84],
  ] as const) {
    carveBridge(world, x, y);
  }
}

function carveDoglegDuct(world: World, x0: number, y0: number, x1: number, y1: number, waterFirst: boolean): void {
  const mx = Math.round((x0 + x1) / 2);
  if (waterFirst) {
    carveWaterH(world, x0, mx, y0, 0);
    carveDryV(world, mx, y0, y1, 0);
    carveWaterH(world, mx, x1, y1, 0);
  } else {
    carveDryH(world, x0, mx, y0, 0);
    carveWaterV(world, mx, y0, y1, 0);
    carveDryH(world, mx, x1, y1, 0);
  }
  setFeature(world, mx, y0, Feature.APPARATUS);
  setFeature(world, mx, y1, Feature.LAMP);
}

function carveBridge(world: World, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
      setFloor(world, x + dx, y + dy);
    }
  }
  setFeature(world, x - 2, y - 2, Feature.LAMP);
  setFeature(world, x + 2, y + 2, Feature.APPARATUS);
}

function carveDrainageProxyLayer(world: World, cx: number, cy: number): void {
  carveBentWater(world, cx - 250, cy + 11, cx - 212, cy - 42);
  carveBentWater(world, cx - 146, cy + 172, cx - 212, cy + 126);
  carveBentWater(world, cx + 74, cy - 202, cx + 166, cy - 66);
  carveBentWater(world, cx + 230, cy + 58, cx + 286, cy + 11);
  carveBentWater(world, cx + 74, cy + 198, cx + 156, cy + 172);
  carveBentWater(world, cx - 12, cy - 250, cx - 108, cy - 66);
  carveBentWater(world, cx - 238, cy + 172, cx - 166, cy + 120);
  carveBentWater(world, cx + 120, cy + 104, cx + 74, cy + 154);
  carveDrainageFan(world, cx - 304, cy + 46, 54, 34);
  carveDrainageFan(world, cx + 178, cy - 196, 48, 30);
}

function carveDrainageFan(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const edge = dy === 0 || dy === h - 1 || dx === 0 || dx === w - 1;
      const dryRail = dx % 9 === 4 || dy % 8 === 3;
      if (edge || dryRail) setFloor(world, x + dx, y + dy);
      else setWater(world, x + dx, y + dy);
    }
  }
  carveDryH(world, x, x + w, y + Math.floor(h / 2), 0);
  carveDryV(world, x + Math.floor(w / 2), y, y + h, 0);
  setFeature(world, x + 2, y + 2, Feature.LAMP);
  setFeature(world, x + w - 3, y + h - 3, Feature.APPARATUS);
}

function carveBentWater(world: World, x0: number, y0: number, x1: number, y1: number): void {
  const bendX = x1;
  const sx = x0 <= bendX ? 1 : -1;
  for (let x = x0; x !== bendX; x += sx) setWater(world, x, y0);
  const sy = y0 <= y1 ? 1 : -1;
  for (let y = y0; y !== y1; y += sy) setWater(world, bendX, y);
  setWater(world, x1, y1);

  for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) === 1) setFloor(world, x + dx, y + dy);
      }
    }
    setFeature(world, x + 1, y + 1, Feature.LAMP);
  }
}

function openGate(world: World, room: Room, dir: Dir, offset: number, width: number, water: boolean): void {
  for (let i = 0; i < width; i++) {
    const o = offset + i;
    let x = room.x;
    let y = room.y;
    if (dir === 'w') {
      x = room.x - 1;
      y = room.y + o;
    } else if (dir === 'e') {
      x = room.x + room.w;
      y = room.y + o;
    } else if (dir === 'n') {
      x = room.x + o;
      y = room.y - 1;
    } else {
      x = room.x + o;
      y = room.y + room.h;
    }
    if (water) setWater(world, x, y);
    else setFloor(world, x, y);
  }
}

function stampPumpStation(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.PRODUCTION, x, y, 25, 19, 'Главная насосная: сухой остров');
  const midY = room.y + Math.floor(room.h / 2);
  const midX = room.x + Math.floor(room.w / 2);

  for (let dx = 2; dx < room.w - 2; dx++) {
    if (dx >= 9 && dx <= 15) continue;
    setWater(world, room.x + dx, midY + 4, room.id);
  }
  for (let dx = 3; dx < room.w - 3; dx += 4) {
    setFeature(world, room.x + dx, room.y + 3, Feature.MACHINE);
    setFeature(world, room.x + dx + 1, room.y + room.h - 4, Feature.APPARATUS);
  }
  setFeature(world, midX - 2, midY - 1, Feature.SCREEN);
  setFeature(world, midX + 2, midY - 1, Feature.LIFT_BUTTON);
  setFeature(world, midX, midY + 2, Feature.LAMP);
  openGate(world, room, 'w', Math.floor(room.h / 2), 3, false);
  openGate(world, room, 'e', Math.floor(room.h / 2), 3, false);
  openGate(world, room, 'n', Math.floor(room.w / 2), 3, false);
  openGate(world, room, 's', Math.floor(room.w / 2), 3, false);
  return id + 1;
}

function stampValveCross(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.PRODUCTION, x, y, 21, 21, 'Крест вентилей: четыре давления');
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx++) {
    if (Math.abs(room.x + dx - cx) > 1) setWater(world, room.x + dx, cy, room.id);
  }
  for (let dy = 2; dy < room.h - 2; dy++) {
    if (Math.abs(room.y + dy - cy) > 1) setWater(world, cx, room.y + dy, room.id);
  }
  for (const [dx, dy] of [[4, 4], [16, 4], [4, 16], [16, 16]] as const) {
    setFeature(world, room.x + dx, room.y + dy, Feature.MACHINE);
  }
  setFeature(world, cx, cy, Feature.LIFT_BUTTON);
  setFeature(world, cx - 2, cy - 2, Feature.LAMP);
  setFeature(world, cx + 2, cy + 2, Feature.LAMP);
  openGate(world, room, 'w', 10, 3, true);
  openGate(world, room, 'e', 10, 3, true);
  openGate(world, room, 'n', 10, 3, true);
  openGate(world, room, 's', 10, 3, true);
  carveDryH(world, room.x - 58, room.x, cy - 4, 1);
  carveDryV(world, cx + 4, room.y + room.h, room.y + room.h + 58, 1);
  return id + 1;
}

function stampFloodedBasin(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.COMMON, x, y, 38, 26, 'Затопленный бассейн: сухие кромки');
  for (let dy = 3; dy < room.h - 3; dy++) {
    for (let dx = 3; dx < room.w - 3; dx++) {
      const island = (dy === 12 && dx >= 9 && dx <= 15) || (dy === 8 && dx >= 24 && dx <= 29);
      if (!island) setWater(world, room.x + dx, room.y + dy, room.id);
    }
  }
  for (let dx = 1; dx < room.w - 1; dx += 6) {
    setFeature(world, room.x + dx, room.y + 1, Feature.LAMP);
    setFeature(world, room.x + dx, room.y + room.h - 2, Feature.SHELF);
  }
  setFeature(world, room.x + 10, room.y + 12, Feature.APPARATUS);
  setFeature(world, room.x + 27, room.y + 8, Feature.MACHINE);
  openGate(world, room, 'e', 12, 3, false);
  openGate(world, room, 'n', 18, 3, true);
  carveDryH(world, room.x + room.w, room.x + room.w + 62, room.y + 12, 1);
  carveWaterV(world, room.x + 18, room.y - 58, room.y, 1);
  return id + 1;
}

function stampDrainageProxyField(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.COMMON, x, y, 32, 18, 'Дренажное поле: сухие рейки');
  for (let dy = 2; dy < room.h - 2; dy++) {
    for (let dx = 2; dx < room.w - 2; dx++) {
      const dryRail = dx === 8 || dx === 19 || dy === 7 || dy === 12;
      if (dryRail) setFloor(world, room.x + dx, room.y + dy, room.id);
      else setWater(world, room.x + dx, room.y + dy, room.id);
    }
  }
  for (let dx = 3; dx < room.w - 3; dx += 7) {
    setFeature(world, room.x + dx, room.y + 2, Feature.LAMP);
    setFeature(world, room.x + dx + 1, room.y + room.h - 3, Feature.APPARATUS);
  }
  openGate(world, room, 'e', 8, 3, false);
  openGate(world, room, 's', 15, 3, true);
  carveDryH(world, room.x + room.w, room.x + room.w + 78, room.y + 8, 1);
  carveWaterV(world, room.x + 15, room.y + room.h, room.y + room.h + 62, 1);
  return id + 1;
}

function stampHeatlineBridge(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.CORRIDOR, x, y, 44, 15, 'Теплотрасса: мост давления');
  const bridgeY = room.y + 7;
  for (let dx = 1; dx < room.w - 1; dx++) {
    setWater(world, room.x + dx, bridgeY - 4, room.id);
    setWater(world, room.x + dx, bridgeY + 4, room.id);
    if (dx % 4 !== 0) setFloor(world, room.x + dx, bridgeY, room.id);
  }
  for (let dx = 4; dx < room.w - 4; dx += 7) {
    setFeature(world, room.x + dx, bridgeY - 2, Feature.MACHINE);
    setFeature(world, room.x + dx + 2, bridgeY + 2, Feature.APPARATUS);
  }
  setFeature(world, room.x + 3, bridgeY, Feature.LAMP);
  setFeature(world, room.x + room.w - 4, bridgeY, Feature.LAMP);
  openGate(world, room, 'w', 7, 3, false);
  openGate(world, room, 'e', 7, 3, false);
  carveDryH(world, room.x - 72, room.x, bridgeY, 1);
  carveDryH(world, room.x + room.w, room.x + room.w + 58, bridgeY, 1);
  return id + 1;
}

function stampOutpostMouth(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.HQ, x, y, 22, 15, 'Пост обходчиков: устье коллекторов');
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setFeature(world, room.x + dx, room.y + 2, Feature.SHELF);
    setFeature(world, room.x + dx + 1, room.y + room.h - 3, Feature.DESK);
  }
  setFeature(world, room.x + 4, room.y + 7, Feature.LAMP);
  setFeature(world, room.x + room.w - 5, room.y + 7, Feature.SCREEN);
  openGate(world, room, 'e', 7, 3, false);
  openGate(world, room, 's', 11, 3, true);
  carveDryH(world, room.x + room.w, room.x + room.w + 84, room.y + 7, 1);
  carveWaterV(world, room.x + 11, room.y + room.h, room.y + room.h + 76, 1);
  return id + 1;
}

function stampServiceDuctChord(world: World, rooms: Room[], id: number, x: number, y: number): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.CORRIDOR, x, y, 48, 9, 'Сервисный воздуховод: сухой обход');
  const cy = room.y + 4;
  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx % 6 === 0) setFeature(world, room.x + dx, cy - 2, Feature.APPARATUS);
    if (dx % 9 === 2) setFeature(world, room.x + dx, cy + 2, Feature.LAMP);
    if (dx % 11 === 5) setWater(world, room.x + dx, cy + 1, room.id);
  }
  openGate(world, room, 'w', 4, 3, false);
  openGate(world, room, 'e', 4, 3, false);
  openGate(world, room, 's', 24, 3, false);
  carveDryH(world, room.x - 96, room.x, cy, 0);
  carveDryH(world, room.x + room.w, room.x + room.w + 88, cy, 0);
  carveDryV(world, room.x + 24, cy, cy + 104, 0);
  return id + 1;
}

function stampEmergencyPanelChordLayer(world: World, rooms: Room[], id: number, cx: number, cy: number): number {
  carveDryH(world, cx - 108, cx + 178, cy + 36, 1);
  carveDryV(world, cx + 34, cy - 130, cy + 152, 1);

  id = stampPanelChordRoom(world, rooms, id, cx - 118, cy + 26, PANEL_POWER_ROOM, 'w');
  id = stampPanelChordRoom(world, rooms, id, cx - 22, cy + 26, PANEL_WATER_ROOM, 's');
  id = stampPanelChordRoom(world, rooms, id, cx + 74, cy + 26, PANEL_DOORS_ROOM, 'n');
  id = stampPanelChordRoom(world, rooms, id, cx + 162, cy + 26, PANEL_VENT_ROOM, 'e');

  const repair = stampMacroRoom(world, rooms, id, RoomType.STORAGE, cx + 20, cy + 134, 28, 11, REPAIR_CHORD_ROOM);
  for (let dx = 2; dx < repair.w - 2; dx += 5) {
    setFeature(world, repair.x + dx, repair.y + 2, Feature.SHELF);
    setFeature(world, repair.x + dx + 1, repair.y + repair.h - 3, Feature.MACHINE);
  }
  openGate(world, repair, 'n', 14, 3, false);
  openGate(world, repair, 'w', 5, 3, false);
  carveDryV(world, repair.x + 14, repair.y - 72, repair.y, 1);
  carveDryH(world, repair.x - 64, repair.x, repair.y + 5, 0);
  return id + 1;
}

function stampPanelChordRoom(
  world: World,
  rooms: Room[],
  id: number,
  x: number,
  y: number,
  name: string,
  gate: Dir,
): number {
  const room = stampMacroRoom(world, rooms, id, RoomType.PRODUCTION, x, y, 13, 7, name);
  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(world, room.x + dx, room.y + 2, Feature.APPARATUS);
    setFeature(world, room.x + dx, room.y + 4, Feature.MACHINE);
  }
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + 1, Feature.SCREEN);
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + room.h - 2, Feature.LAMP);
  openGate(world, room, gate, gate === 'n' || gate === 's' ? 6 : 3, 3, false);
  if (gate !== 'w') openGate(world, room, 'w', 3, 2, false);
  if (gate !== 'e') openGate(world, room, 'e', 3, 2, false);
  return id + 1;
}

function stampPressureLock(
  world: World,
  rooms: Room[],
  id: number,
  x: number,
  y: number,
  horizontal: boolean,
  name: string,
): number {
  const w = horizontal ? 17 : 11;
  const h = horizontal ? 11 : 17;
  const room = stampMacroRoom(world, rooms, id, RoomType.PRODUCTION, x, y, w, h, name);
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);

  if (horizontal) {
    for (let dx = 1; dx < room.w - 1; dx++) setWater(world, room.x + dx, cy, room.id);
    setFloor(world, cx, cy, room.id);
    for (let dx = 2; dx < room.w - 2; dx += 4) {
      setFeature(world, room.x + dx, cy - 3, Feature.MACHINE);
      setFeature(world, room.x + dx + 1, cy + 3, Feature.APPARATUS);
    }
    openGate(world, room, 'w', Math.floor(room.h / 2), 3, true);
    openGate(world, room, 'e', Math.floor(room.h / 2), 3, true);
    openGate(world, room, 'n', Math.floor(room.w / 2), 3, false);
    openGate(world, room, 's', Math.floor(room.w / 2), 3, false);
  } else {
    for (let dy = 1; dy < room.h - 1; dy++) setWater(world, cx, room.y + dy, room.id);
    setFloor(world, cx, cy, room.id);
    for (let dy = 2; dy < room.h - 2; dy += 4) {
      setFeature(world, cx - 3, room.y + dy, Feature.MACHINE);
      setFeature(world, cx + 3, room.y + dy + 1, Feature.APPARATUS);
    }
    openGate(world, room, 'n', Math.floor(room.w / 2), 3, true);
    openGate(world, room, 's', Math.floor(room.w / 2), 3, true);
    openGate(world, room, 'w', Math.floor(room.h / 2), 3, false);
    openGate(world, room, 'e', Math.floor(room.h / 2), 3, false);
  }

  setFeature(world, cx, cy, Feature.LIFT_BUTTON);
  setFeature(world, cx - 1, cy - 1, Feature.LAMP);
  setFeature(world, cx + 1, cy + 1, Feature.LAMP);
  return id + 1;
}

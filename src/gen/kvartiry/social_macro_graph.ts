/* ── Kvartiry social macro graph and braided route cuts ───────── */

import {
  Cell,
  DoorState,
  Feature,
  FloorLevel,
  LiftDirection,
  RoomType,
  Tex,
  W,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { registerRouteCue } from '../../systems/route_cues';
import { recordPoiGenerationMetadata } from '../content_manifest_utils';
import { isConnectivityWalkable } from '../shared';

export type KvSocialMacroNodeKind =
  | 'kitchen'
  | 'water'
  | 'ration'
  | 'barricade'
  | 'lift'
  | 'print'
  | 'apartment_cut'
  | 'shortcut';

export type KvSocialRouteKind =
  | 'crowd_route'
  | 'apartment_cut'
  | 'service_detour'
  | 'risky_shortcut'
  | 'lift_escape';

export type KvSocialDomainId =
  | 'citizen_queue'
  | 'liquidator_order'
  | 'wild_pressure'
  | 'mixed_front';

export interface KvSocialDomainDescriptor {
  id: KvSocialDomainId;
  label: string;
  pottsState: number;
  isingSpin: -1 | 0 | 1;
  tags: readonly string[];
  roomIds: readonly number[];
  zoneIds: readonly number[];
  tension: number;
}

export interface KvSocialMacroNode {
  id: string;
  kind: KvSocialMacroNodeKind;
  label: string;
  x: number;
  y: number;
  accessX: number;
  accessY: number;
  roomId?: number;
  zoneId: number;
  domainId: KvSocialDomainId;
  pressure: number;
  tags: readonly string[];
}

export interface KvSocialMacroEdge {
  id: string;
  from: string;
  to: string;
  route: KvSocialRouteKind;
  label: string;
  carvedCells: number;
  tags: readonly string[];
}

export interface KvartiryArticulationMetric {
  walkableCells: number;
  regionCount: number;
  largeRegionCount: number;
  largestRegionCells: number;
  largeIsolatedRegionCount: number;
  largeIsolatedRegionCells: number;
  narrowGateCells: number;
}

export interface KvartirySocialMacroGraph {
  nodes: readonly KvSocialMacroNode[];
  edges: readonly KvSocialMacroEdge[];
  domains: readonly KvSocialDomainDescriptor[];
  queueLoops: number;
  carvedCells: number;
  apartmentCutDoors: number;
  articulation: KvartiryArticulationMetric;
}

const graphByWorld = new WeakMap<World, KvartirySocialMacroGraph>();

const DOMAIN_BASE: Record<KvSocialDomainId, Omit<KvSocialDomainDescriptor, 'roomIds' | 'zoneIds' | 'tension'>> = {
  citizen_queue: {
    id: 'citizen_queue',
    label: 'жильцы держат очередь',
    pottsState: 1,
    isingSpin: 1,
    tags: ['citizens', 'queue', 'ration', 'water'],
  },
  liquidator_order: {
    id: 'liquidator_order',
    label: 'ликвидаторы удерживают проход',
    pottsState: 2,
    isingSpin: 1,
    tags: ['liquidators', 'order', 'barricade', 'lift'],
  },
  wild_pressure: {
    id: 'wild_pressure',
    label: 'дикие ищут короткий ход',
    pottsState: 3,
    isingSpin: -1,
    tags: ['wild', 'shortcut', 'paper', 'black_market'],
  },
  mixed_front: {
    id: 'mixed_front',
    label: 'смешанный фронт кухни и пролёта',
    pottsState: 4,
    isingSpin: 0,
    tags: ['mixed', 'front', 'food', 'witness'],
  },
};

const ROUTE_LABELS: Record<KvSocialRouteKind, { label: string; hint: string; color: string }> = {
  crowd_route: {
    label: 'толповый ход',
    hint: 'очередь ведёт через воду и кухню',
    color: '#fa4',
  },
  apartment_cut: {
    label: 'квартирный срез',
    hint: 'можно проскочить через комнату, но соседи всё видят',
    color: '#9cf',
  },
  service_detour: {
    label: 'служебный обход',
    hint: 'баррикада даёт ремонт, взятку, бой или нижний обход',
    color: '#6cf',
  },
  risky_shortcut: {
    label: 'рискованный срез',
    hint: 'типография и дикие дают быстрый, шумный путь',
    color: '#f66',
  },
  lift_escape: {
    label: 'ход к лифтам',
    hint: 'давление толпы выводит к шахтам',
    color: '#fc6',
  },
};

export function getKvartirySocialMacroGraph(world: World): KvartirySocialMacroGraph | null {
  return graphByWorld.get(world) ?? null;
}

export function buildKvartirySocialMacroGraph(
  world: World,
  spawnX: number,
  spawnY: number,
): KvartirySocialMacroGraph {
  const nodes = collectSocialNodes(world, spawnX, spawnY);
  let carvedCells = 0;
  let queueLoops = 0;

  for (const node of nodes) {
    if (node.kind === 'ration' || node.kind === 'water' || node.kind === 'kitchen' || node.kind === 'print') {
      const carved = carveQueueLoop(world, node);
      if (carved > 0) {
        carvedCells += carved;
        queueLoops++;
      }
    }
  }

  let apartmentCutDoors = 0;
  const cutNode = nodes.find(n => n.kind === 'apartment_cut');
  const cutRoom = cutNode?.roomId !== undefined ? world.rooms[cutNode.roomId] : undefined;
  if (cutRoom) apartmentCutDoors = openApartmentCutThrough(world, cutRoom);

  const edges = connectSocialRoutes(world, nodes);
  carvedCells += edges.reduce((sum, edge) => sum + edge.carvedCells, 0);

  if (carvedCells > 0 || apartmentCutDoors > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }

  const graph: KvartirySocialMacroGraph = {
    nodes,
    edges,
    domains: buildDomainDescriptors(nodes),
    queueLoops,
    carvedCells,
    apartmentCutDoors,
    articulation: measureKvartiryArticulation(world, spawnX, spawnY),
  };
  graphByWorld.set(world, graph);
  recordPoiGenerationMetadata(world, {
    id: 'kvartiry_social_macro_graph',
    floor: 'kvartiry',
    debugLabel: 'Квартиры: социальный макрограф очередей, кухонь, воды, баррикады, лифтов и типографии',
    roomIds: nodes.map(n => n.roomId).filter((id): id is number => id !== undefined),
    decisionHooks: [
      { kind: 'reroute', id: 'kv_social_crowd_route', label: 'идти через толпу' },
      { kind: 'hide', id: 'kv_social_apartment_cut', label: 'срезать через комнату' },
      { kind: 'repair', id: 'kv_social_service_detour', label: 'обойти через баррикаду' },
      { kind: 'flee', id: 'kv_social_risky_shortcut', label: 'рискнуть коротким ходом' },
    ],
  });
  return graph;
}

export function measureKvartiryArticulation(
  world: World,
  startX = W / 2 + 0.5,
  startY = W / 2 + 0.5,
  largeRegionThreshold = 2048,
): KvartiryArticulationMetric {
  const visited = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let regionCount = 0;
  let largeRegionCount = 0;
  let largestRegionCells = 0;
  let largeIsolatedRegionCells = 0;
  let walkableCells = 0;
  let startRegion = -1;
  const startIdx = nearestWalkableCell(world, Math.floor(startX), Math.floor(startY), 80);

  for (let cell = 0; cell < W * W; cell++) {
    if (visited[cell] || !isConnectivityWalkable(world, cell)) continue;
    const regionId = regionCount++;
    let head = 0;
    let tail = 0;
    let size = 0;
    visited[cell] = 1;
    queue[tail++] = cell;

    while (head < tail) {
      const ci = queue[head++];
      size++;
      if (ci === startIdx) startRegion = regionId;
      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of CARDINAL_DIRS) {
        const ni = world.idx(x + dx, y + dy);
        if (visited[ni] || !isConnectivityWalkable(world, ni)) continue;
        visited[ni] = 1;
        queue[tail++] = ni;
      }
    }

    walkableCells += size;
    if (size > largestRegionCells) largestRegionCells = size;
    if (size >= largeRegionThreshold) {
      largeRegionCount++;
      if (regionId !== startRegion && startRegion >= 0) largeIsolatedRegionCells += size;
    }
  }

  if (startRegion < 0 && largestRegionCells >= largeRegionThreshold) {
    largeIsolatedRegionCells = Math.max(0, walkableCells - largestRegionCells);
  }

  return {
    walkableCells,
    regionCount,
    largeRegionCount,
    largestRegionCells,
    largeIsolatedRegionCount: largeIsolatedRegionCells > 0 ? 1 : 0,
    largeIsolatedRegionCells,
    narrowGateCells: countNarrowGateCells(world),
  };
}

const CARDINAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function collectSocialNodes(world: World, spawnX: number, spawnY: number): KvSocialMacroNode[] {
  const nodes: KvSocialMacroNode[] = [];
  const usedRooms = new Set<number>();

  const addRoom = (
    id: string,
    kind: KvSocialMacroNodeKind,
    room: Room | undefined,
    domainId: KvSocialDomainId,
    pressure: number,
    tags: readonly string[],
  ): KvSocialMacroNode | undefined => {
    if (!room || usedRooms.has(room.id)) return undefined;
    usedRooms.add(room.id);
    const center = roomCenter(world, room);
    const access = nearestUnprotectedWalkableCell(world, center.x, center.y, 24) ?? center;
    const node: KvSocialMacroNode = {
      id,
      kind,
      label: room.name,
      x: center.x + 0.5,
      y: center.y + 0.5,
      accessX: access.x + 0.5,
      accessY: access.y + 0.5,
      roomId: room.id,
      zoneId: world.zoneMap[world.idx(access.x, access.y)],
      domainId,
      pressure,
      tags,
    };
    nodes.push(node);
    return node;
  };

  addRoom('ration_queue', 'ration', findRoomByName(world, 'Пункт выдачи талонов'), 'citizen_queue', 1.5, ['ration', 'queue', 'food']);
  addRoom('water_point', 'water', findRoomByName(world, 'Водораздача у стояка'), 'citizen_queue', 2.2, ['water', 'queue', 'shortage']);
  addRoom('communal_kitchen', 'kitchen', findRoomByName(world, 'Коммунальная кухня раздора'), 'mixed_front', 2.1, ['kitchen', 'food', 'witness']);
  addRoom('barricade', 'barricade', findRoomByName(world, 'Баррикадированный пролёт'), 'liquidator_order', 2.0, ['barricade', 'service', 'detour']);
  addRoom('print_room', 'print', findRoomByName(world, 'Нелегальная типография'), 'wild_pressure', 1.6, ['print', 'paper', 'shortcut']);

  const kitchenRooms = sortedRoomsNear(world, spawnX, spawnY, room => room.type === RoomType.KITCHEN && !usedRooms.has(room.id));
  for (let i = 0; i < Math.min(3, kitchenRooms.length); i++) {
    addRoom(`kitchen_${i + 1}`, 'kitchen', kitchenRooms[i], 'citizen_queue', 1.0, ['kitchen', 'queue']);
  }

  const waterRooms = sortedRoomsNear(world, spawnX, spawnY, room => room.type === RoomType.BATHROOM && !usedRooms.has(room.id));
  for (let i = 0; i < Math.min(2, waterRooms.length); i++) {
    addRoom(`water_${i + 1}`, 'water', waterRooms[i], 'citizen_queue', 1.1, ['bathroom', 'water']);
  }

  const apartmentCut = findCutThroughRoom(world, nodes);
  addRoom('apartment_cut', 'apartment_cut', apartmentCut, 'citizen_queue', 0.8, ['apartment', 'cut_through', 'witness']);

  const shortcut = sortedRoomsNear(world, spawnX, spawnY, room => (
    !usedRooms.has(room.id) && (room.type === RoomType.SMOKING || room.type === RoomType.STORAGE || room.type === RoomType.COMMON)
  ))[0];
  addRoom('risky_shortcut', 'shortcut', shortcut, 'wild_pressure', 1.4, ['shortcut', 'risk', 'wild']);

  addLiftNode(world, nodes, LiftDirection.UP, 'lift_up', spawnX, spawnY);
  addLiftNode(world, nodes, LiftDirection.DOWN, 'lift_down', spawnX, spawnY);

  return nodes;
}

function connectSocialRoutes(world: World, nodes: readonly KvSocialMacroNode[]): KvSocialMacroEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges: KvSocialMacroEdge[] = [];
  const add = (id: string, fromId: string, toId: string, route: KvSocialRouteKind): void => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) return;
    const carvedCells = route === 'crowd_route' || route === 'apartment_cut'
      ? carveBraidBetween(world, from, to, route)
      : 0;
    const routeLabel = ROUTE_LABELS[route];
    edges.push({
      id,
      from: from.id,
      to: to.id,
      route,
      label: routeLabel.label,
      carvedCells,
      tags: ['kvartiry', 'social_macro', route, ...from.tags, ...to.tags].slice(0, 10),
    });
    registerRouteCue(world, {
      id: `kv_social_${id}`,
      x: from.accessX,
      y: from.accessY,
      targetX: to.accessX,
      targetY: to.accessY,
      floor: FloorLevel.KVARTIRY,
      roomId: from.roomId,
      targetRoomId: to.roomId,
      zoneId: from.zoneId,
      label: routeLabel.label,
      hint: routeLabel.hint,
      targetName: to.label,
      color: routeLabel.color,
      tags: ['kvartiry', 'social_macro', route, 'route_choice'],
      toneSeed: from.zoneId * 131 + to.zoneId * 17 + id.length,
      radius: 10,
      targetRadius: 3,
      cooldownSec: 35,
      heardText: `Квартиры шепчут маршрут: ${routeLabel.hint}.`,
      followedText: `Вы прошли ${routeLabel.label}.`,
      ignoredText: `Вы оставили ${routeLabel.label} за стеной.`,
    });
  };

  add('ration_to_water', 'ration_queue', 'water_point', 'crowd_route');
  add('water_to_kitchen', 'water_point', 'communal_kitchen', 'crowd_route');
  add('ration_apartment_cut', 'ration_queue', 'apartment_cut', 'apartment_cut');
  add('apartment_cut_kitchen', 'apartment_cut', 'communal_kitchen', 'apartment_cut');
  add('kitchen_barricade_detour', 'communal_kitchen', 'barricade', 'service_detour');
  add('print_barricade_shortcut', 'print_room', 'barricade', 'risky_shortcut');
  add('barricade_lift_escape', 'barricade', 'lift_down', 'lift_escape');

  return edges;
}

function buildDomainDescriptors(nodes: readonly KvSocialMacroNode[]): KvSocialDomainDescriptor[] {
  return (Object.keys(DOMAIN_BASE) as KvSocialDomainId[]).map(id => {
    const domainNodes = nodes.filter(node => node.domainId === id);
    const roomIds = uniqueNumbers(domainNodes.map(node => node.roomId).filter((roomId): roomId is number => roomId !== undefined));
    const zoneIds = uniqueNumbers(domainNodes.map(node => node.zoneId).filter(zoneId => zoneId >= 0));
    const tension = domainNodes.length === 0
      ? 0
      : Math.round(domainNodes.reduce((sum, node) => sum + node.pressure, 0) / domainNodes.length * 100) / 100;
    return { ...DOMAIN_BASE[id], roomIds, zoneIds, tension };
  }).filter(domain => domain.roomIds.length > 0 || domain.zoneIds.length > 0);
}

function addLiftNode(
  world: World,
  nodes: KvSocialMacroNode[],
  direction: LiftDirection,
  id: string,
  refX: number,
  refY: number,
): void {
  let best = -1;
  let bestAccess: { x: number; y: number } | null = null;
  let bestD2 = Infinity;
  for (let cell = 0; cell < W * W; cell++) {
    if (world.cells[cell] !== Cell.LIFT || world.liftDir[cell] !== direction) continue;
    const x = cell % W;
    const y = (cell / W) | 0;
    const access = nearestUnprotectedWalkableCell(world, x, y, 6);
    if (!access) continue;
    const d2 = world.dist2(refX, refY, access.x + 0.5, access.y + 0.5);
    if (d2 < bestD2) {
      best = cell;
      bestAccess = access;
      bestD2 = d2;
    }
  }
  if (best < 0 || !bestAccess) return;
  const x = best % W;
  const y = (best / W) | 0;
  nodes.push({
    id,
    kind: 'lift',
    label: direction === LiftDirection.UP ? 'верхние лифты' : 'нижние лифты',
    x: x + 0.5,
    y: y + 0.5,
    accessX: bestAccess.x + 0.5,
    accessY: bestAccess.y + 0.5,
    zoneId: world.zoneMap[world.idx(bestAccess.x, bestAccess.y)],
    domainId: 'liquidator_order',
    pressure: 1.2,
    tags: ['lift', direction === LiftDirection.UP ? 'up' : 'down'],
  });
}

function carveQueueLoop(world: World, node: KvSocialMacroNode): number {
  const base = nearestUnprotectedWalkableCell(world, Math.floor(node.accessX), Math.floor(node.accessY), 16);
  if (!base) return 0;
  const rx = node.kind === 'water' ? 5 : 7;
  const ry = node.kind === 'print' ? 4 : 5;
  const corners = [
    { x: world.wrap(base.x - rx), y: world.wrap(base.y - ry) },
    { x: world.wrap(base.x + rx), y: world.wrap(base.y - ry) },
    { x: world.wrap(base.x + rx), y: world.wrap(base.y + ry) },
    { x: world.wrap(base.x - rx), y: world.wrap(base.y + ry) },
  ];
  const changed = new Set<number>();
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    carveSegment(world, a.x, a.y, b.x, b.y, Tex.F_LINO, changed);
  }
  let n = 0;
  for (const cell of changed) {
    if (n++ % 7 !== 0) continue;
    if (world.cells[cell] === Cell.FLOOR && world.features[cell] === Feature.NONE) {
      world.features[cell] = node.kind === 'water' ? Feature.CHAIR : Feature.TABLE;
    }
  }
  return changed.size;
}

function carveBraidBetween(
  world: World,
  from: KvSocialMacroNode,
  to: KvSocialMacroNode,
  route: KvSocialRouteKind,
): number {
  const dist = world.dist(from.accessX, from.accessY, to.accessX, to.accessY);
  if (dist > 190) return 0;
  const sx = Math.floor(from.accessX);
  const sy = Math.floor(from.accessY);
  const tx = Math.floor(to.accessX);
  const ty = Math.floor(to.accessY);
  const dx = world.delta(sx, tx);
  const dy = world.delta(sy, ty);
  const bend = route === 'apartment_cut' ? 10 : 14;
  const midX = world.wrap(Math.round(sx + dx / 2 + (dy >= 0 ? bend : -bend)));
  const midY = world.wrap(Math.round(sy + dy / 2 + (dx >= 0 ? -bend : bend)));
  const changed = new Set<number>();
  carveSegment(world, sx, sy, midX, midY, Tex.F_LINO, changed);
  carveSegment(world, midX, midY, tx, ty, Tex.F_LINO, changed);
  return changed.size;
}

function carveSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  floorTex: Tex,
  changed: Set<number>,
): void {
  let cx = world.wrap(ax);
  let cy = world.wrap(ay);
  const dx = world.delta(cx, world.wrap(bx));
  const dy = world.delta(cy, world.wrap(by));
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  for (let i = 0; i <= nx; i++) {
    carveMacroCell(world, cx, cy, floorTex, changed);
    if (i < nx) cx = world.wrap(cx + stepX);
  }
  for (let i = 0; i <= ny; i++) {
    carveMacroCell(world, cx, cy, floorTex, changed);
    if (i < ny) cy = world.wrap(cy + stepY);
  }
}

function carveMacroCell(world: World, x: number, y: number, floorTex: Tex, changed: Set<number>): void {
  const ci = world.idx(x, y);
  if (world.aptMask[ci] || world.hermoWall[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.ABYSS) return;
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER || world.cells[ci] === Cell.DOOR) return;
  if (world.cells[ci] !== Cell.WALL) return;
  const adjacentRoom = adjacentRoomId(world, x, y);
  if (adjacentRoom >= 0) {
    world.cells[ci] = Cell.DOOR;
    world.wallTex[ci] = Tex.DOOR_WOOD;
    if (!world.doors.has(ci)) {
      world.doors.set(ci, { idx: ci, state: DoorState.CLOSED, roomA: adjacentRoom, roomB: -1, keyId: '', timer: 0 });
      const room = world.rooms[adjacentRoom];
      if (room && !room.doors.includes(ci)) room.doors.push(ci);
    }
  } else {
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
    world.floorTex[ci] = floorTex;
  }
  world.features[ci] = Feature.NONE;
  changed.add(ci);
}

type RoomSide = 'west' | 'east' | 'north' | 'south';

function openApartmentCutThrough(world: World, room: Room): number {
  const horizontal = room.w >= room.h;
  const primarySides: RoomSide[] = horizontal ? ['west', 'east'] : ['north', 'south'];
  const allSides: RoomSide[] = ['west', 'east', 'north', 'south'];
  const sides = [
    ...primarySides,
    ...allSides.filter(side => !primarySides.includes(side)),
  ];
  let opened = 0;
  const openedCells = new Set<number>();
  for (const side of sides) {
    const door = openRoomSide(world, room, side);
    if (door >= 0 && !openedCells.has(door)) {
      openedCells.add(door);
      opened++;
    }
    if (opened >= 2) break;
  }
  return opened;
}

function openRoomSide(world: World, room: Room, side: RoomSide): number {
  const dir = side === 'west'
    ? { dx: -1, dy: 0 }
    : side === 'east'
      ? { dx: 1, dy: 0 }
      : side === 'north'
        ? { dx: 0, dy: -1 }
        : { dx: 0, dy: 1 };
  const centerX = room.x + Math.floor(room.w / 2);
  const centerY = room.y + Math.floor(room.h / 2);
  const candidates: { wallIdx: number; outsideX: number; outsideY: number; score: number }[] = [];

  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      const wx = world.wrap(x + dir.dx);
      const wy = world.wrap(y + dir.dy);
      const wi = world.idx(wx, wy);
      if (world.aptMask[wi] || world.hermoWall[wi] || world.cells[wi] !== Cell.WALL) continue;
      const axisScore = dir.dx !== 0 ? Math.abs(y - centerY) : Math.abs(x - centerX);
      const sideScore = dir.dx < 0 ? Math.abs(x - room.x)
        : dir.dx > 0 ? Math.abs(x - (room.x + room.w - 1))
          : dir.dy < 0 ? Math.abs(y - room.y)
            : Math.abs(y - (room.y + room.h - 1));
      candidates.push({
        wallIdx: wi,
        outsideX: world.wrap(wx + dir.dx),
        outsideY: world.wrap(wy + dir.dy),
        score: sideScore * 100 + axisScore,
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    const outside = nearestExternalWalkableCell(world, candidate.outsideX, candidate.outsideY, room.id, 28);
    if (!outside) continue;
    const wi = candidate.wallIdx;
    world.cells[wi] = Cell.DOOR;
    world.wallTex[wi] = Tex.DOOR_WOOD;
    if (!world.doors.has(wi)) {
      const roomB = world.roomMap[world.idx(candidate.outsideX, candidate.outsideY)] === room.id
        ? -1
        : world.roomMap[world.idx(candidate.outsideX, candidate.outsideY)];
      world.doors.set(wi, { idx: wi, state: DoorState.CLOSED, roomA: room.id, roomB, keyId: '', timer: 0 });
      if (!room.doors.includes(wi)) room.doors.push(wi);
      const otherRoom = roomB >= 0 ? world.rooms[roomB] : undefined;
      if (otherRoom && !otherRoom.doors.includes(wi)) otherRoom.doors.push(wi);
    }
    const changed = new Set<number>([wi]);
    carveSegment(world, candidate.outsideX, candidate.outsideY, outside.x, outside.y, Tex.F_LINO, changed);
    return wi;
  }
  return -1;
}

function nearestExternalWalkableCell(
  world: World,
  sx: number,
  sy: number,
  sourceRoomId: number,
  radius: number,
): { x: number; y: number } | null {
  const startX = world.wrap(Math.floor(sx));
  const startY = world.wrap(Math.floor(sy));
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(startX + dx);
        const y = world.wrap(startY + dy);
        const ci = world.idx(x, y);
        if (world.aptMask[ci] || world.roomMap[ci] === sourceRoomId || !isConnectivityWalkable(world, ci)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function findCutThroughRoom(world: World, nodes: readonly KvSocialMacroNode[]): Room | undefined {
  const ration = nodes.find(n => n.kind === 'ration');
  const water = nodes.find(n => n.kind === 'water');
  if (!ration || !water) return undefined;
  let best: { room: Room; score: number } | undefined;
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.LIVING || room.w > 14 || room.h > 14) continue;
    const center = roomCenter(world, room);
    const d = world.dist(center.x, center.y, ration.accessX, ration.accessY)
      + world.dist(center.x, center.y, water.accessX, water.accessY);
    const direct = world.dist(ration.accessX, ration.accessY, water.accessX, water.accessY);
    const score = Math.abs(d - direct) + Math.max(room.w, room.h) * 0.25;
    if (!best || score < best.score) best = { room, score };
  }
  return best?.room;
}

function findRoomByName(world: World, name: string): Room | undefined {
  return world.rooms.find(room => room?.name === name);
}

function sortedRoomsNear(world: World, x: number, y: number, filter: (room: Room) => boolean): Room[] {
  return world.rooms
    .filter((room): room is Room => !!room && filter(room))
    .sort((a, b) => {
      const ac = roomCenter(world, a);
      const bc = roomCenter(world, b);
      return world.dist2(x, y, ac.x, ac.y) - world.dist2(x, y, bc.x, bc.y);
    });
}

function roomCenter(world: World, room: Room): { x: number; y: number } {
  return {
    x: world.wrap(room.x + Math.floor(room.w / 2)),
    y: world.wrap(room.y + Math.floor(room.h / 2)),
  };
}

function nearestWalkableCell(world: World, sx: number, sy: number, radius: number): number {
  const local = nearestUnprotectedWalkableCell(world, sx, sy, radius);
  if (local) return world.idx(local.x, local.y);
  for (let cell = 0; cell < W * W; cell++) {
    if (isConnectivityWalkable(world, cell)) return cell;
  }
  return -1;
}

function nearestUnprotectedWalkableCell(world: World, sx: number, sy: number, radius: number): { x: number; y: number } | null {
  const startX = world.wrap(Math.floor(sx));
  const startY = world.wrap(Math.floor(sy));
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(startX + dx);
        const y = world.wrap(startY + dy);
        const ci = world.idx(x, y);
        if (world.aptMask[ci] || !isConnectivityWalkable(world, ci)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function adjacentRoomId(world: World, x: number, y: number): number {
  let roomId = -1;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const rid = world.roomMap[world.idx(x + dx, y + dy)];
    if (rid < 0) continue;
    if (roomId >= 0 && roomId !== rid) return -1;
    roomId = rid;
  }
  return roomId;
}

function countNarrowGateCells(world: World): number {
  let count = 0;
  for (let cell = 0; cell < W * W; cell++) {
    if (!isConnectivityWalkable(world, cell)) continue;
    const x = cell % W;
    const y = (cell / W) | 0;
    let degree = 0;
    for (const [dx, dy] of CARDINAL_DIRS) {
      if (isConnectivityWalkable(world, world.idx(x + dx, y + dy))) degree++;
    }
    if (degree <= 2) count++;
  }
  return count;
}

function uniqueNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

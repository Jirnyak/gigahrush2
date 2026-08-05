/* ── Тонкая стена — Hell phasing encounter ───────────────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex, W,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { stampBlackHandTrail } from '../../systems/surface_marks';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const CHAPEL_NAME = 'Пост тонкой стены';
const BLACK_HAND_SCOUT_ID = 'ag78_black_hand_scout';
const BLACK_HAND_REPORT_QUEST_ID = 'ag78_black_hand_report';
const BLACK_HAND_REPORT_EVENT_TAG = 'ag78_black_hand_reported';

interface CellPos {
  x: number;
  y: number;
}

const SCOUT_DEF: PlotNpcDef = {
  name: 'Сержант Коптев',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 190, maxHp: 190, money: 42, speed: 0.95,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
    { defId: 'cleaning_kit', count: 1 },
  ],
  talkLines: [
    'На полу черная ладонь. Не масло, не копоть. Маршрут, если верить пустым биркам у стены.',
    'Можно обойти, можно пройти по следу, можно стереть знак. Мне нужна отметка на карте, а не красивый труп.',
    'В конце обычно тайник. Чужой. Поэтому тихий только до первой украденной вещи.',
  ],
  talkLinesPost: [
    'Ладонь внесена в журнал. Без вывода, без богословия.',
    'Если будешь стирать знак, держи воду и комплект. С первого раза ладонь часто не сходит.',
  ],
};

registerSideQuest(BLACK_HAND_SCOUT_ID, SCOUT_DEF, [
  {
    id: BLACK_HAND_REPORT_QUEST_ID,
    giverNpcId: BLACK_HAND_SCOUT_ID,
    type: QuestType.VISIT,
    desc: 'Коптев: «Черная ладонь ведет к тонкой стене {dir}. Дойди до конца следа, отметь место и реши сам: обходить, чистить или брать тайник.»',
    targetRoomName: CHAPEL_NAME,
    rewardItem: 'cleaning_kit',
    rewardCount: 1,
    extraRewards: [{ defId: 'holy_water', count: 1 }],
    relationDelta: 8,
    xpReward: 80,
    moneyReward: 45,
  },
]);

registerWorldEventObserver(handleBlackHandReport);

function handleBlackHandReport(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed' || event.tags.includes(BLACK_HAND_REPORT_EVENT_TAG)) return;
  if (event.data?.sideQuestId !== BLACK_HAND_REPORT_QUEST_ID) return;
  publishEvent(state, {
    type: 'quest_completed',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: 'Черная ладонь внесена в маршрутный журнал.',
    severity: 4,
    privacy: 'local',
    tags: [BLACK_HAND_REPORT_EVENT_TAG, 'black_hand', 'cult', 'report'],
    data: {
      sideQuestId: BLACK_HAND_REPORT_QUEST_ID,
      sourceEventId: event.id,
      markKind: 'black_hand',
    },
  });
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnSpirit(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.SPIRIT];
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 12) : 12;
  const hp = scaleMonsterHp(def.hp, zoneLevel + 2);
  const spirit: Entity = {
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.SPIRIT),
    name: 'Дух тонкой стены',
    hp, maxHp: hp,
    monsterKind: MonsterKind.SPIRIT,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel + 1),
    phasing: true,
  };
  entities.push(spirit);
}

function walkable(world: World, x: number, y: number): boolean {
  const cell = world.cells[world.idx(x, y)];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER;
}

function addTrailCell(world: World, out: CellPos[], x: number, y: number): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (!walkable(world, wx, wy)) return;
  for (const cell of out) if (cell.x === wx && cell.y === wy) return;
  out.push({ x: wx, y: wy });
}

function findChapelEntry(world: World, room: Room): { outside: CellPos; inside: CellPos; ring: CellPos } | null {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      if (!walkable(world, x, y)) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const insideX = world.wrap(x + ox);
        const insideY = world.wrap(y + oy);
        if (world.roomMap[world.idx(insideX, insideY)] !== room.id) continue;
        const outsideX = world.wrap(x - ox);
        const outsideY = world.wrap(y - oy);
        const outside = walkable(world, outsideX, outsideY) && world.roomMap[world.idx(outsideX, outsideY)] !== room.id
          ? { x: outsideX, y: outsideY }
          : { x, y };
        return { outside, inside: { x: insideX, y: insideY }, ring: { x, y } };
      }
    }
  }
  return null;
}

function findScoutCell(world: World, origin: CellPos, room: Room): CellPos {
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(origin.x + dx);
        const y = world.wrap(origin.y + dy);
        const ci = world.idx(x, y);
        if (world.roomMap[ci] === room.id || !walkable(world, x, y)) continue;
        return { x, y };
      }
    }
  }
  return origin;
}

function buildBlackHandTrail(world: World, room: Room): { marks: CellPos[]; scout: CellPos } {
  const entry = findChapelEntry(world, room);
  const marks: CellPos[] = [];
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  if (entry) {
    addTrailCell(world, marks, entry.outside.x, entry.outside.y);
    addTrailCell(world, marks, entry.ring.x, entry.ring.y);
    addTrailCell(world, marks, entry.inside.x, entry.inside.y);
  }
  addTrailCell(world, marks, cx, room.y + 2);
  addTrailCell(world, marks, cx, cy - 2);
  addTrailCell(world, marks, cx, cy);
  addTrailCell(world, marks, cx, cy + 2);
  const scout = findScoutCell(world, entry?.outside ?? { x: room.x + 1, y: room.y + 1 }, room);
  return { marks, scout };
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function addBlackHandCache(world: World, room: Room): void {
  const x = room.x + Math.floor(room.w / 2) + 1;
  const y = room.y + Math.floor(room.h / 2) + 2;
  if (!walkable(world, x, y)) return;
  const ci = world.idx(x, y);
  world.features[ci] = Feature.SHELF;
  const cache: WorldContainer = {
    id: nextContainerId(world),
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name: 'Тайник черной ладони',
    inventory: [
      { defId: 'idol_chernobog', count: 1 },
      { defId: 'psi_dust', count: 1 },
      { defId: 'note', count: 1 },
    ],
    capacitySlots: 6,
    faction: Faction.CULTIST,
    access: 'faction',
    discovered: true,
    tags: ['black_hand', 'cult', 'hell', 'trail', 'theft'],
  };
  world.addContainer(cache);
}

function spawnScout(entities: Entity[], nextId: { v: number }, pos: CellPos, face: CellPos): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, BLACK_HAND_SCOUT_ID, pos.x + 0.5, pos.y + 0.5, {
    angle: Math.atan2(face.y - pos.y, face.x - pos.x),
    weapon: 'makarov',
    canGiveQuest: true,
    aiTarget: { x: pos.x, y: pos.y },
  });
}

function decorateChapel(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  const cx = rx + Math.floor(room.w / 2);
  const cy = ry + Math.floor(room.h / 2);
  for (const [x, y, feature] of [
    [cx, cy, Feature.CANDLE],
    [rx + 1, ry + 1, Feature.CANDLE],
    [rx + room.w - 2, ry + 1, Feature.CANDLE],
    [rx + 1, ry + room.h - 2, Feature.CANDLE],
    [rx + room.w - 2, ry + room.h - 2, Feature.CANDLE],
    [cx, ry + room.h - 2, Feature.APPARATUS],
  ] as const) {
    world.features[world.idx(x, y)] = feature;
  }

  for (let dx = 2; dx < room.w - 2; dx++) {
    if (Math.abs((rx + dx) - cx) <= 1) continue;
    const ci = world.idx(rx + dx, cy);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.GUT;
    world.roomMap[ci] = -1;
  }

  world.wallTex[world.idx(cx, ry - 1)] = Tex.ICON;
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 5, 0.5, 35038, 180, 180, 190, false);
}

export function generateThinWallChapel(world: World, entities: Entity[], nextId: { v: number }): void {
  const pos = findClearArea(world, W >> 1, W >> 1, 13, 9, 80, 230);
  const x = pos ? pos.x : world.wrap((W >> 1) + 96);
  const y = pos ? pos.y : world.wrap((W >> 1) + 96);
  const room = stampRoom(world, world.rooms.length, RoomType.HQ, x, y, 13, 9, -1);
  room.name = CHAPEL_NAME;
  room.wallTex = Tex.MEAT;
  room.floorTex = Tex.F_GUT;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.MEAT, Tex.F_GUT);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);

  decorateChapel(world, room);
  const trail = buildBlackHandTrail(world, room);
  const marksPlaced = stampBlackHandTrail(world, trail.marks, room.id * 7919 + 78, 7);
  spawnScout(entities, nextId, trail.scout, { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) });
  addBlackHandCache(world, room);

  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  dropItem(entities, nextId, room.x + 1, room.y + room.h - 2, 'holy_water', 1);
  dropItem(entities, nextId, room.x + room.w - 2, room.y + room.h - 2, 'psi_dust', 1);
  spawnSpirit(world, entities, nextId, cx, cy - 2);

  genLog(`[AG35/AG78] ${room.name} at (${room.x}, ${room.y}) room #${room.id}; black-hand marks ${marksPlaced}`);
}

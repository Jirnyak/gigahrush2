/* -- AG03 Round 2: laundry breach + house committee -------------- */
/* Zone 39 is an unsafe no-door laundry: bad shelter during sirens.  */
/* Zone 46 is a protected household institution with a closable door. */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, DoorState, Feature, Faction, MonsterKind, Occupation,
  QuestType, RoomType, Tex,
  type Entity, EntityType, AIGoal, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { learnRumor } from '../../systems/npc_memory';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

type PoiKey = 'laundry' | 'domkom';

interface PoiPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  roomId: number;
  zoneHudId: number;
}

interface NpcSpawn {
  id: string;
  poi: PoiKey;
  dx: number;
  dy: number;
  angle: number;
  weapon?: string;
}

const LAUNDRY_ZONE = 39;
const DOMKOM_ZONE = 46;
const POI: Partial<Record<PoiKey, PoiPlacement>> = {};

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag03r2_zoya_laundry: {
    name: 'Зоя Прачечная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 80, maxHp: 80, money: 18, speed: 0.75,
    inventory: [
      { defId: 'cloth_roll', count: 2 },
      { defId: 'cleaning_kit', count: 1 },
      { defId: 'filtered_water', count: 1 },
    ],
    talkLines: [
      'Прачечная продувается насквозь. В сирену тут не прячутся, тут исчезают чистыми.',
      'Если зашипит слив, уходи. Ползун сначала делает вид, что он труба.',
      'Мне нужна ткань для мокрых щелей. Не спасет, но даст минуту.',
      'Чужое белье не бери. В карманах квитанции, а по квитанциям потом находят руки.',
      'Домком говорит закрываться у них. У прачечной двери нет, а слив шумит громче сирены.',
    ],
    talkLinesPost: [
      'Щель перевязана. Теперь хотя бы видно, откуда дует.',
      'Если сирена начнется, беги к домкому. Я побегу следом, если пол отпустит.',
      'Чистота здесь временная. Как и жильцы.',
    ],
  },

  ag03r2_lev_signal: {
    name: 'Лев Сиренный',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.ELECTRICIAN,
    sprite: Occupation.ELECTRICIAN,
    hp: 95, maxHp: 95, money: 42, speed: 0.8,
    inventory: [
      { defId: 'fuse', count: 2 },
      { defId: 'siren_instruction', count: 2 },
      { defId: 'fog_detector', count: 1 },
    ],
    talkLines: [
      'Я слушаю не сирену, а паузу перед ней. Там иногда называют номер зоны.',
      'Предохранители выбивает до сирены, если линия намокла у прачечной.',
      'Два целых предохранителя — и я верну лампам честное мигание.',
      'Прачечная опасна тем, что честная. Двери нет, значит прятаться нечем.',
      'Если детектор пискнул возле сухого пола, проверь шов у слива. Сухой линолеум тоже ведет воду снизу.',
    ],
    talkLinesPost: [
      'Сигнал ровнее. Плохие новости теперь приходят без кашля.',
      'Лампы моргнули три раза. По инструкции это проверка линии, по опыту - пора к двери.',
      'Слушай не потолок, а щиток. Он первым скажет, где выбило.',
    ],
  },

  ag03r2_nina_domkom: {
    name: 'Нина Домком',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.DIRECTOR,
    sprite: Occupation.DIRECTOR,
    hp: 120, maxHp: 120, money: 65, speed: 0.65,
    inventory: [
      { defId: 'neighbor_complaint', count: 3 },
      { defId: 'blank_form', count: 2 },
      { defId: 'tea', count: 2 },
    ],
    talkLines: [
      'Домком открыт до сирены. После сирены он закрыт даже для правды.',
      'Жалоба соседа — это не бумага. Это маленькая дверь в чужую комнату.',
      'Принеси две жалобы. Я решу, кого спасать первым и кого проверять потом.',
      'Можешь донести донос. Можешь не доносить. Но бумага все равно найдет стол.',
      'У нас дверь закрывается. Поэтому люди считают нас добрыми.',
    ],
    talkLinesPost: [
      'Протокол принят. Чай выдают тем, кто не шумит.',
      'Если прачечная воет, не геройствуй. Входи и закрывай дверь.',
      'Блок держится на списках, ключах и тех, кто помнит, кому нужен чай без сахара.',
    ],
  },

  ag03r2_arsen_gasket: {
    name: 'Арсен Уплотнитель',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 150, maxHp: 150, money: 52, speed: 0.85,
    inventory: [
      { defId: 'hermo_gasket', count: 1 },
      { defId: 'sealant_tube', count: 2 },
      { defId: 'wrench', count: 1 },
    ],
    talkLines: [
      'Хорошая дверь не обещает спасения. Она просто держит зазор, пока люди успевают закрыться.',
      'Мне нужен гермоуплотнитель. Домкомовская дверь старая, а сирена молодая.',
      'Прачечную не запечатаешь. У нее характер коридора.',
      'Если хочешь прятаться здесь, сначала уважай петли.',
      'Слышу шаги за закрытой дверью. Это нормально. Ненормально, когда дверь не держит зазор.',
    ],
    talkLinesPost: [
      'Уплотнитель встал. Дверь теперь ругается тише.',
      'Закрывай за собой. Вежливость иногда равна броне.',
      'Прачечной я не верю. Она слишком легко проветривается.',
    ],
  },
};

registerSideQuest('ag03r2_zoya_laundry', NPC_DEFS.ag03r2_zoya_laundry, [
  {
    id: 'ag03r2_zoya_cloth',
    giverNpcId: 'ag03r2_zoya_laundry',
    type: QuestType.FETCH,
    desc: 'Зоя Прачечная: «Принеси два рулона ткани. Перевяжем мокрые щели до сирены.»',
    targetItem: 'cloth_roll', targetCount: 2,
    rewardItem: 'filtered_water', rewardCount: 2,
    extraRewards: [{ defId: 'cleaning_kit', count: 1 }],
    relationDelta: 12, xpReward: 35, moneyReward: 18,
  },
  {
    id: 'ag03r2_zoya_polzun',
    giverNpcId: 'ag03r2_zoya_laundry',
    type: QuestType.KILL,
    desc: 'Зоя Прачечная: «Ползун сидит под сливом. Убей его или не стой на плитке.»',
    targetMonsterKind: MonsterKind.POLZUN,
    killNeeded: 1,
    rewardItem: 'gasmask_filter', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 16, xpReward: 55, moneyReward: 30,
  },
]);

registerSideQuest('ag03r2_lev_signal', NPC_DEFS.ag03r2_lev_signal, [
  {
    id: 'ag03r2_lev_fuses',
    giverNpcId: 'ag03r2_lev_signal',
    type: QuestType.FETCH,
    desc: 'Лев Сиренный: «Два предохранителя — и сирена перестанет кашлять перед бедой.»',
    targetItem: 'fuse', targetCount: 2,
    rewardItem: 'fog_detector', rewardCount: 1,
    extraRewards: [{ defId: 'siren_instruction', count: 2 }],
    relationDelta: 15, xpReward: 50, moneyReward: 35,
  },
]);

registerSideQuest('ag03r2_nina_domkom', NPC_DEFS.ag03r2_nina_domkom, [
  {
    id: 'ag03r2_nina_complaints',
    giverNpcId: 'ag03r2_nina_domkom',
    type: QuestType.FETCH,
    desc: 'Нина Домком: «Две жалобы соседей. Без бумаги я не могу отличить помощь от паники.»',
    targetItem: 'neighbor_complaint', targetCount: 2,
    rewardItem: 'tea', rewardCount: 3,
    extraRewards: [{ defId: 'key', count: 1 }],
    relationDelta: 14, xpReward: 40, moneyReward: 25,
  },
  {
    id: 'ag03r2_nina_denunciation',
    giverNpcId: 'ag03r2_nina_domkom',
    type: QuestType.FETCH,
    desc: 'Нина Домком: «Принесешь донос — решим, кого выставлять из укрытия последним.»',
    targetItem: 'denunciation', targetCount: 1,
    rewardItem: 'blank_form', rewardCount: 2,
    extraRewards: [{ defId: 'water_coupon', count: 2 }],
    relationDelta: 10, xpReward: 35, moneyReward: 20,
  },
]);

registerSideQuest('ag03r2_arsen_gasket', NPC_DEFS.ag03r2_arsen_gasket, [
  {
    id: 'ag03r2_arsen_gasket',
    giverNpcId: 'ag03r2_arsen_gasket',
    type: QuestType.FETCH,
    desc: 'Арсен Уплотнитель: «Найди гермоуплотнитель. Без него домком — просто красивая кладовка.»',
    targetItem: 'hermo_gasket', targetCount: 1,
    rewardItem: 'door_kit', rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 2 }, { defId: 'wrench', count: 1 }],
    relationDelta: 18, xpReward: 50, moneyReward: 30,
  },
]);

const NPC_SPAWNS: readonly NpcSpawn[] = [
  { id: 'ag03r2_zoya_laundry', poi: 'laundry', dx: 2, dy: 2, angle: Math.PI / 2 },
  { id: 'ag03r2_lev_signal', poi: 'laundry', dx: 7, dy: 2, angle: Math.PI, weapon: 'wrench' },
  { id: 'ag03r2_nina_domkom', poi: 'domkom', dx: 3, dy: 2, angle: Math.PI / 2 },
  { id: 'ag03r2_arsen_gasket', poi: 'domkom', dx: 8, dy: 4, angle: Math.PI, weapon: 'wrench' },
];

function hasPlotNpc(entities: Entity[], plotNpcId: string): boolean {
  return entities.some(e => e.alive && e.plotNpcId === plotNpcId);
}

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number, w: number, h: number, salt: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(w / 2);
  const baseY = zcy - Math.floor(h / 2);
  for (let r = 0; r <= 64; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = ((k + salt) / 16) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, w, h)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveBox(
  world: World,
  roomId: number,
  type: RoomType,
  name: string,
  rx: number,
  ry: number,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = wallTex;
      world.floorTex[ci] = floorTex;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type,
    x: rx,
    y: ry,
    w,
    h,
    name,
    wallTex,
    floorTex,
    doors: [],
    sealed: false,
    apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.roomMap[ci] = roomId;
    }
  }
  protectRoom(world, rx, ry, w, h, wallTex, floorTex);
  return room;
}

function connectToMaze(world: World, room: Room, floorTex: Tex, door: boolean): void {
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  const probes = [
    { x: midX, y: room.y - 1, dx: 0, dy: -1 },
    { x: midX, y: room.y + room.h, dx: 0, dy: 1 },
    { x: room.x - 1, y: midY, dx: -1, dy: 0 },
    { x: room.x + room.w, y: midY, dx: 1, dy: 0 },
  ];
  let best: number[] = [];
  let bestLen = Infinity;

  for (const p of probes) {
    const path: number[] = [];
    let blocked = false;
    let cx = world.wrap(p.x);
    let cy = world.wrap(p.y);
    for (let s = 0; s < 72; s++) {
      const ci = world.idx(cx, cy);
      if (world.cells[ci] === Cell.LIFT || (s > 0 && world.aptMask[ci])) {
        blocked = true;
        break;
      }
      if (s > 0 && world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) {
        if (path.length < bestLen) {
          best = path;
          bestLen = path.length;
        }
        break;
      }
      path.push(ci);
      cx = world.wrap(cx + p.dx);
      cy = world.wrap(cy + p.dy);
    }
    if (!blocked && path.length > 0 && path.length < bestLen) {
      best = path;
      bestLen = path.length + 72;
    }
  }

  if (best.length === 0) return;

  const threshold = best[0];
  if (door) {
    world.cells[threshold] = Cell.DOOR;
    world.doors.set(threshold, {
      idx: threshold,
      state: DoorState.CLOSED,
      roomA: room.id,
      roomB: -1,
      keyId: '',
      timer: 0,
    });
    room.doors.push(threshold);
  } else {
    world.cells[threshold] = Cell.FLOOR;
    world.roomMap[threshold] = -1;
    world.floorTex[threshold] = floorTex;
  }
  world.aptMask[threshold] = 1;

  for (let i = 1; i < best.length; i++) {
    const ci = best[i];
    if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = floorTex;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
  }
}

function registerPoi(key: PoiKey, room: Room, zoneHudId: number): void {
  POI[key] = { x: room.x, y: room.y, w: room.w, h: room.h, roomId: room.id, zoneHudId };
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
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
    inventory: [{ defId, count }],
  });
}

function dropDesk(entities: Entity[], nextId: { v: number }, x: number, y: number, scale = 0.55): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.BILLBOARD,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.DESK,
    spriteScale: scale,
  });
}

function spawnMonster(entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number): void {
  const def = MONSTERS[kind];
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(kind),
    hp: def.hp,
    maxHp: def.hp,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

function seedRumorMemory(npc: Entity, poi: PoiPlacement): void {
  learnRumor(npc, poi.zoneHudId === LAUNDRY_ZONE ? 'samosbor_doors_lie' : 'samosbor_airlock_truth', 0);
}

function findSpawnSpot(world: World, spawn: NpcSpawn): { x: number; y: number; poi?: PoiPlacement } {
  const poi = POI[spawn.poi];
  if (poi) {
    const x = world.wrap(poi.x + Math.min(poi.w - 1, spawn.dx));
    const y = world.wrap(poi.y + Math.min(poi.h - 1, spawn.dy));
    if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y, poi };
  }

  const zoneHudId = spawn.poi === 'domkom' ? DOMKOM_ZONE : LAUNDRY_ZONE;
  const zone = world.zones[zoneHudId - 1];
  const cx = zone?.cx ?? 512;
  const cy = zone?.cy ?? 512;
  for (let r = 0; r < 48; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y, poi };
      }
    }
  }
  return { x: world.wrap(cx), y: world.wrap(cy), poi };
}

function pushNpc(world: World, entities: Entity[], nextId: { v: number }, spawn: NpcSpawn): void {
  if (hasPlotNpc(entities, spawn.id)) return;
  const spot = findSpawnSpot(world, spawn);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, spawn.id, spot.x + 0.5, spot.y + 0.5, {
    angle: spawn.angle,
    weapon: spawn.weapon,
    canGiveQuest: true,
  });
  if (spot.poi) seedRumorMemory(npc, spot.poi);
}

function spawnPoiNpcs(world: World, entities: Entity[], nextId: { v: number }, poi: PoiKey): void {
  for (const spawn of NPC_SPAWNS) {
    if (spawn.poi === poi) pushNpc(world, entities, nextId, spawn);
  }
}

function generateLaundry(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const WID = 11;
  const HEI = 7;
  const pos = findOrigin(world, zcx, zcy, WID, HEI, 3);
  const room = carveBox(world, nextRoomId++, RoomType.PRODUCTION, 'Продувочная прачечная', pos.x, pos.y, WID, HEI, Tex.TILE_W, Tex.F_TILE);
  registerPoi('laundry', room, LAUNDRY_ZONE);
  connectToMaze(world, room, Tex.F_TILE, false);

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 3, pos.y + 2)] = Feature.MACHINE;
  world.features[world.idx(pos.x + 4, pos.y + 2)] = Feature.SINK;
  world.features[world.idx(pos.x + 7, pos.y + 2)] = Feature.APPARATUS;
  world.features[world.idx(pos.x + 9, pos.y + 1)] = Feature.SHELF;
  world.features[world.idx(pos.x + 2, pos.y + 5)] = Feature.SHELF;
  world.wallTex[world.idx(pos.x + 5, pos.y - 1)] = Tex.PIPE;
  world.wallTex[world.idx(pos.x + 6, pos.y - 1)] = Tex.PIPE;
  stampSurfaceSplat(world, pos.x + 5, pos.y + 5, 0.5, 0.5, 4, 0.45, 3903, 35, 65, 80, false);

  dropDesk(entities, nextId, pos.x + 7, pos.y + 2, 0.45);
  dropItem(entities, nextId, pos.x + 2, pos.y + 5, 'cloth_roll', 1);
  dropItem(entities, nextId, pos.x + 9, pos.y + 5, 'metal_water', 1);
  dropItem(entities, nextId, pos.x + 8, pos.y + 1, 'siren_instruction', 1);
  spawnMonster(entities, nextId, MonsterKind.POLZUN, pos.x + 5, pos.y + 5);
  spawnPoiNpcs(world, entities, nextId, 'laundry');
  genLog(`[AG03R2] Продувочная прачечная at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

function generateDomkom(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const WID = 12;
  const HEI = 8;
  const pos = findOrigin(world, zcx, zcy, WID, HEI, 9);
  const room = carveBox(world, nextRoomId++, RoomType.OFFICE, 'Комната домкома', pos.x, pos.y, WID, HEI, Tex.PANEL, Tex.F_PARQUET);
  registerPoi('domkom', room, DOMKOM_ZONE);
  connectToMaze(world, room, Tex.F_LINO, true);

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + WID - 2, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 3, pos.y + 2)] = Feature.DESK;
  world.features[world.idx(pos.x + 3, pos.y + 3)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 6, pos.y + 2)] = Feature.TABLE;
  world.features[world.idx(pos.x + 8, pos.y + 2)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 10, pos.y + 2)] = Feature.SHELF;
  world.features[world.idx(pos.x + 10, pos.y + 5)] = Feature.SHELF;
  world.wallTex[world.idx(pos.x + 2, pos.y - 1)] = Tex.POSTER_BASE + 18;
  world.wallTex[world.idx(pos.x + 8, pos.y - 1)] = Tex.POSTER_BASE + 44;

  dropDesk(entities, nextId, pos.x + 3, pos.y + 2);
  dropDesk(entities, nextId, pos.x + 6, pos.y + 2, 0.5);
  dropItem(entities, nextId, pos.x + 10, pos.y + 5, 'neighbor_complaint', 1);
  dropItem(entities, nextId, pos.x + 9, pos.y + 6, 'hermo_gasket', 1);
  dropItem(entities, nextId, pos.x + 2, pos.y + 6, 'tea', 1);
  spawnPoiNpcs(world, entities, nextId, 'domkom');
  genLog(`[AG03R2] Комната домкома at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

export function spawnDomkomLaundryPackNpcs(
  world: World,
  entities: Entity[],
  nextId: { v: number },
): void {
  for (const spawn of NPC_SPAWNS) pushNpc(world, entities, nextId, spawn);
}

registerZoneContent(LAUNDRY_ZONE, 'Продувочная прачечная', generateLaundry);
registerZoneContent(DOMKOM_ZONE, 'Комната домкома', generateDomkom);

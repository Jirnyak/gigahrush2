/* -- OBZh school evacuation cluster (AG16) ---------------------- */
/* One classroom, one shelter, five NPCs, and a repairable gap     */
/* that becomes meaningful when samosbor fog reaches the school.   */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, DoorState, Tex, Feature, RoomType,
  type Room, type Entity, EntityType, Faction, Occupation, QuestType, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CLASSROOM_NAME = 'Кабинет ОБЖ';
const SHELTER_NAME = 'Спортзал-убежище ОБЖ';
const CONTENT_TAG = 'obzh_school';
const QUEST_ESCORT_GROUP = 'ag16_obzh_parent_escort';
const QUEST_PROTECT_DOOR = 'ag16_obzh_protect_door';
const QUEST_REPAIR_GAP = 'ag16_obzh_repair_gap';

const SCHOOL_W = 26;
const SCHOOL_H = 11;
const CLASS_W = 13;
const CLASS_H = 9;
const SHELTER_W = 12;
const SHELTER_H = 9;

interface NpcSpawn {
  id: string;
  room: 'classroom' | 'shelter';
  dx: number;
  dy: number;
  angle: number;
  canGiveQuest?: boolean;
  weapon?: string;
  scale?: number;
}

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag16_nina_obzh: {
    name: 'Нина ОБЖ',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 120, maxHp: 120, money: 42, speed: 0.85,
    inventory: [
      { defId: 'bandage', count: 2 },
      { defId: 'water', count: 2 },
      { defId: 'note', count: 1 },
    ],
    talkLines: [
      'Головы считаем вслух. Кто сбился - начинает заново, без стыда.',
      'От двери отошли. Руки на стол, мел в коробку, глаза не в глазок.',
      'Если из проема зовут мамой, не отвечаем. Сначала сто, потом журнал, потом взрослый.',
      'Сначала аптечка. Потом убежище. Потом список. Потом дверь. Урок короткий, потому что сирена длинная.',
      'У сорванной гермодвери не геройствуют. Ее чинят или уводят людей в другое место.',
    ],
    talkLinesPost: [
      'Комплект двери не трогай без взрослого. Взрослый сегодня ты.',
      'Во время самосбора дети слушают правила. Взрослые чаще торгуются с правилами.',
      'Журнал эвакуации не успокаивает. Он просто не дает забыть, кого еще искать.',
    ],
  },

  ag16_pupil_mira: {
    name: 'Мира из второго ряда',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.CHILD,
    sprite: Occupation.CHILD,
    hp: 55, maxHp: 55, money: 2, speed: 0.95,
    inventory: [{ defId: 'bread', count: 1 }],
    talkLines: [
      'Я знаю правило: не бежать. Но ноги иногда читают не тот плакат.',
      'Если дверь поставят, я сяду под парту и буду считать вдохи до ста.',
      'У меня мел был белый, а стрелка получилась к убежищу. Я не специально.',
      'Нам сказали: если мама зовет из двери, надо считать до ста и не отвечать.',
    ],
    talkLinesPost: [
      'Я запомнила, где убежище. Только бы стрелку мелом не стерли до сирены.',
      'Учительница сказала держать руки занятыми. Я держу хлеб и не плачу громко.',
    ],
  },

  ag16_parent_lida: {
    name: 'Лида из родкома',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 85, maxHp: 85, money: 18, speed: 0.9,
    inventory: [
      { defId: 'water', count: 1 },
      { defId: 'kasha', count: 1 },
    ],
    talkLines: [
      'Я заберу своего ребенка до приказа. Приказ потом извиняться не будет.',
      'Паек один. Учитель говорит делить по списку. Я говорю - сначала маленьким, потом спорить.',
      'Не надо мне красивых слов. Скажите, где убежище, и кто идет последним.',
    ],
    talkLinesPost: [
      'Если дверь закрыта, я подожду. Если открыта - я не обещаю.',
      'Нина считает головы лучше меня. Я считаю свою, а потом стыжусь и считаю остальных.',
    ],
  },

  ag16_guard_roman: {
    name: 'Роман Дежурный',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 190, maxHp: 190, money: 35, speed: 1.0,
    inventory: [
      { defId: 'pipe', count: 1 },
      { defId: 'ammo_9mm', count: 6 },
    ],
    talkLines: [
      'Я держу коридор, пока он держится коридором.',
      'Гермодверь сорвана. Поставишь комплект - туман упрется в железо.',
      'Если кто-то стучит детским голосом из проема, отвечаю я. Трубой.',
      'Не пускай детей к глазку. Даже если там обещают родителей и свет.',
    ],
    talkLinesPost: [
      'Если сирена началась, не спорь у порога. Закрывай.',
      'Отвлечь голос можно шумом. Защитить детей - только расстоянием и дверью.',
    ],
  },

  ag16_vadim_monitor: {
    name: 'Вадим Монитор',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.CHILD,
    sprite: Occupation.CHILD,
    hp: 60, maxHp: 60, money: 4, speed: 0.85,
    inventory: [{ defId: 'note', count: 1 }],
    talkLines: [
      'Пункт первый: не паниковать. Пункт второй: если паника уже есть, записать ее в журнал.',
      'Без списка никто не входит в убежище. Даже если в коридоре уже стучат.',
      'Я считаю головы. Если голова спорит, считаю еще раз.',
      'В глазок не смотрю. Там иногда раньше видно то, чего еще нет.',
    ],
    talkLinesPost: [
      'Я отметил тебя в журнале как условно полезного взрослого.',
      'Карта детей лежит в журнале. Она неправильная, но лучше взрослых указателей.',
    ],
    talkQuestResponse: 'Список у меня. Скажи Нине ОБЖ: трое идут в убежище, один остается у двери, родком спорит, но идет.',
  },
};

registerSideQuest('ag16_nina_obzh', NPC_DEFS.ag16_nina_obzh, [
  {
    id: 'ag16_obzh_fetch_kit',
    giverNpcId: 'ag16_nina_obzh',
    type: QuestType.FETCH,
    desc: 'Нина ОБЖ: «Нужны два бинта в учебную аптечку. Без аптечки эвакуация превращается в беготню.»',
    targetItem: 'bandage', targetCount: 2,
    rewardItem: 'water', rewardCount: 2,
    extraRewards: [{ defId: 'bread', count: 1 }],
    relationDelta: 10, xpReward: 25, moneyReward: 10,
    eventTags: [CONTENT_TAG, 'school', 'medkit', 'supply'],
    eventData: { outcome: 'medkit_stocked', rumorIds: ['room_obzh_school_gap'] },
  },
  {
    id: 'ag16_obzh_visit_shelter',
    giverNpcId: 'ag16_nina_obzh',
    type: QuestType.VISIT,
    desc: `Нина ОБЖ: «Проверь ${SHELTER_NAME}. Маршрут должен быть в ногах до сирены, не в разговорах.»`,
    targetRoomName: SHELTER_NAME,
    rewardItem: 'flashlight', rewardCount: 1,
    extraRewards: [{ defId: 'note', count: 1 }],
    relationDelta: 10, xpReward: 30, moneyReward: 10,
    eventTags: [CONTENT_TAG, 'shelter', 'route_checked'],
    eventData: { outcome: 'shelter_route_checked', rumorIds: ['samosbor_obzh_shelter'] },
  },
  {
    id: 'ag16_obzh_talk_monitor',
    giverNpcId: 'ag16_nina_obzh',
    type: QuestType.TALK,
    desc: 'Нина ОБЖ: «Сверься с Вадимом Монитором. Он знает список лучше взрослых.»',
    targetNpcId: 'ag16_vadim_monitor',
    rewardItem: 'kompot', rewardCount: 1,
    relationDelta: 8, xpReward: 20, moneyReward: 5,
    eventTags: [CONTENT_TAG, 'journal', 'children_counted'],
    eventData: { outcome: 'evacuation_journal_checked', rumorIds: ['player_obzh_escort_group'] },
  },
  {
    id: QUEST_REPAIR_GAP,
    giverNpcId: 'ag16_nina_obzh',
    type: QuestType.FETCH,
    desc: 'Нина ОБЖ: «Принеси гаечный ключ к сорванной гермодвери. Комплект выдам тебе: поставишь дверь здесь или унесешь - это твое решение.»',
    targetItem: 'wrench', targetCount: 1,
    rewardItem: 'door_kit', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 14, xpReward: 45, moneyReward: 25,
    eventTags: [CONTENT_TAG, 'repair', 'door_kit', 'shelter_gap'],
    eventData: { outcome: 'door_kit_issued', rumorIds: ['player_obzh_door_kit', 'lead_living_obzh_door_kit'] },
  },
]);

registerSideQuest('ag16_pupil_mira', NPC_DEFS.ag16_pupil_mira, []);
registerSideQuest('ag16_parent_lida', NPC_DEFS.ag16_parent_lida, [
  {
    id: QUEST_ESCORT_GROUP,
    giverNpcId: 'ag16_parent_lida',
    type: QuestType.VISIT,
    desc: `Лида из родкома: «Проведи нас до ${SHELTER_NAME}. Я не спорю, я иду последней и считаю головы.»`,
    targetRoomName: SHELTER_NAME,
    rewardItem: 'water', rewardCount: 2,
    extraRewards: [{ defId: 'child_map', count: 1 }],
    relationDelta: 12, xpReward: 35, moneyReward: 15,
    failOnNpcDeathPlotId: 'ag16_pupil_mira',
    eventTags: [CONTENT_TAG, 'escort', 'shelter', 'children'],
    eventData: { outcome: 'group_escorted', rumorIds: ['player_obzh_escort_group', 'samosbor_obzh_shelter'] },
  },
]);
registerSideQuest('ag16_guard_roman', NPC_DEFS.ag16_guard_roman, [
  {
    id: QUEST_PROTECT_DOOR,
    giverNpcId: 'ag16_guard_roman',
    type: QuestType.KILL,
    desc: 'Роман Дежурный: «Отвлеки тварь от сорванной двери. Не у проема дерись: уведи шум на себя, потом бей.»',
    targetMonsterKind: MonsterKind.TVAR,
    killNeeded: 1,
    rewardItem: 'ammo_9mm', rewardCount: 10,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 10, xpReward: 45, moneyReward: 20,
    spawnMonstersOnAccept: 1,
    failOnNpcDeathPlotId: 'ag16_pupil_mira',
    eventTags: [CONTENT_TAG, 'protect', 'distract', 'shelter_gap'],
    eventData: { outcome: 'door_voice_distracted', rumorIds: ['player_obzh_protected_door', 'samosbor_obzh_shelter'] },
  },
]);
registerSideQuest('ag16_vadim_monitor', NPC_DEFS.ag16_vadim_monitor, []);

const NPC_SPAWNS: NpcSpawn[] = [
  { id: 'ag16_nina_obzh', room: 'classroom', dx: 6, dy: 1, angle: Math.PI / 2, canGiveQuest: true },
  { id: 'ag16_pupil_mira', room: 'classroom', dx: 3, dy: 6, angle: -Math.PI / 2, scale: 0.65 },
  { id: 'ag16_parent_lida', room: 'classroom', dx: 10, dy: 6, angle: Math.PI, canGiveQuest: true },
  { id: 'ag16_guard_roman', room: 'classroom', dx: 2, dy: 8, angle: -Math.PI / 2, weapon: 'pipe', canGiveQuest: true },
  { id: 'ag16_vadim_monitor', room: 'shelter', dx: 2, dy: 3, angle: 0, scale: 0.72 },
];

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(SCHOOL_W / 2);
  const baseY = zcy - Math.floor(SCHOOL_H / 2);
  for (let r = 0; r <= 72; r += 4) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 + 0.31;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, SCHOOL_W, SCHOOL_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(
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
      if (world.aptMask[ci]) continue;
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
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.roomMap[ci] = roomId;
    }
  }
  protectRoom(world, rx, ry, w, h, wallTex, floorTex);
  return room;
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

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  spawn: NpcSpawn,
  classRoom: Room,
  shelter: Room,
): void {
  if (entities.some(e => e.alive && e.plotNpcId === spawn.id)) return;
  const room = spawn.room === 'classroom' ? classRoom : shelter;
  requireSpawnedPlotNpcFromPackage(entities, nextId, spawn.id, room.x + spawn.dx + 0.5, room.y + spawn.dy + 0.5, {
    angle: spawn.angle,
    weapon: spawn.weapon,
    canGiveQuest: spawn.canGiveQuest === true,
    extra: { spriteScale: spawn.scale },
  });
}

function placeShelterDoor(world: World, classroom: Room, shelter: Room): void {
  const doorX = world.wrap(classroom.x + classroom.w);
  const doorY = world.wrap(classroom.y + Math.floor(classroom.h / 2));
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.wallTex[doorI] = Tex.HERMO_WALL;
  world.floorTex[doorI] = Tex.F_CONCRETE;
  world.features[doorI] = Feature.NONE;
  world.doors.set(doorI, {
    idx: doorI,
    state: DoorState.HERMETIC_OPEN,
    roomA: classroom.id,
    roomB: shelter.id,
    keyId: '',
    timer: 0,
  });
  classroom.doors.push(doorI);
  shelter.doors.push(doorI);
}

function carveBrokenEntrance(world: World, classroom: Room): void {
  const gapX = world.wrap(classroom.x + 2);
  const gapY = world.wrap(classroom.y + classroom.h);
  const gapI = world.idx(gapX, gapY);
  world.cells[gapI] = Cell.FLOOR;
  world.floorTex[gapI] = Tex.F_LINO;
  world.roomMap[gapI] = -1;
  world.features[gapI] = Feature.NONE;
  world.aptMask[gapI] = 0;
  world.hermoWall[gapI] = 0;

  let cy = world.wrap(gapY + 1);
  for (let s = 0; s < 70; s++) {
    const ci = world.idx(gapX, cy);
    if (s > 0 && world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function decorateClassroom(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  world.features[world.idx(rx + 6, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + 1, ry + 1)] = Feature.TABLE;
  world.features[world.idx(rx + 11, ry + 1)] = Feature.SHELF;
  world.wallTex[world.idx(rx + 4, ry - 1)] = Tex.POSTER_BASE + 27;
  world.wallTex[world.idx(rx + 7, ry - 1)] = Tex.POSTER_BASE + 28;
  world.wallTex[world.idx(rx + 10, ry - 1)] = Tex.SLIDE_3;
  world.features[world.idx(rx + 10, ry - 1)] = Feature.SLIDE;
  world.slideCells.push(world.idx(rx + 10, ry - 1));

  for (let row = 0; row < 3; row++) {
    const y = ry + 3 + row * 2;
    for (let col = 0; col < 4; col++) {
      dropDesk(entities, nextId, rx + 2 + col * 3, y);
    }
  }
  dropItem(entities, nextId, rx + 11, ry + 2, 'bandage', 1);
  dropItem(entities, nextId, rx + 10, ry + 6, 'water', 1);
  dropItem(entities, nextId, rx + 1, ry + 7, 'wrench', 1);
  stampSurfaceSplat(world, rx + 2, ry + CLASS_H - 1, 0.5, 0.5, 5, 0.5, 16016, 95, 44, 52, false);
}

function decorateShelter(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  world.features[world.idx(rx + 2, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + 9, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + 2, ry + 6)] = Feature.SHELF;
  world.features[world.idx(rx + 9, ry + 6)] = Feature.SHELF;
  world.wallTex[world.idx(rx + 5, ry - 1)] = Tex.POSTER_BASE + 29;
  world.wallTex[world.idx(rx + 8, ry - 1)] = Tex.HERMO_WALL;
  for (let x = 2; x < SHELTER_W - 2; x += 2) {
    dropDesk(entities, nextId, rx + x, ry + 4, 0.48);
  }
  dropItem(entities, nextId, rx + 2, ry + 6, 'bread', 1);
  dropItem(entities, nextId, rx + 9, ry + 6, 'kasha', 1);
  dropItem(entities, nextId, rx + 10, ry + 2, 'note', 1);
}

function generateObzhSchool(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const classroom = carveRoom(
    world,
    nextRoomId++,
    RoomType.CLASSROOM,
    CLASSROOM_NAME,
    pos.x,
    pos.y,
    CLASS_W,
    CLASS_H,
    Tex.PANEL,
    Tex.F_LINO,
  );
  const shelter = carveRoom(
    world,
    nextRoomId++,
    RoomType.COMMON,
    SHELTER_NAME,
    world.wrap(pos.x + CLASS_W + 1),
    pos.y,
    SHELTER_W,
    SHELTER_H,
    Tex.HERMO_WALL,
    Tex.F_CONCRETE,
  );

  placeShelterDoor(world, classroom, shelter);
  carveBrokenEntrance(world, classroom);
  decorateClassroom(world, entities, nextId, classroom);
  decorateShelter(world, entities, nextId, shelter);
  for (const spawn of NPC_SPAWNS) spawnNpc(entities, nextId, spawn, classroom, shelter);

  genLog(`[AG16] ${CLASSROOM_NAME} at (${pos.x}, ${pos.y}) rooms #${classroom.id}/${shelter.id}`);
  return { nextRoomId };
}

registerZoneContent(42, 'Школа ОБЖ и убежище', generateObzhSchool);

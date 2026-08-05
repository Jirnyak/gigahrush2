/* -- Soviet housing horror content pack (AG03) ------------------ */
/* Fixed-zone living POIs: concierge, radio club, lost-and-found,  */
/* hermodoor repair alcove, and common kitchen argument site.      */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, Tex, Feature, RoomType,
  type Room, type Entity, EntityType, AIGoal, Faction, Occupation, QuestType, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

type PoiKey = 'concierge' | 'radio' | 'lostFound' | 'repair' | 'kitchen';

interface PoiPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
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

const POI: Partial<Record<PoiKey, PoiPlacement>> = {};

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag03_pasha_concierge: {
    name: 'Дядя Паша Вахтер',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 90, maxHp: 90, money: 32, speed: 0.65,
    inventory: [
      { defId: 'tea', count: 2 },
      { defId: 'note', count: 2 },
      { defId: 'key', count: 1 },
    ],
    talkLines: [
      'Записывайся в журнал. Даже если был тут вчера: без строки я тебя не видел.',
      'Консьержная держится, потому что я не сплю. Сон тут сразу становится пропуском для чужих.',
      'После сирены не стой у стекла. Раму повело, а осколки всё ещё в подоконнике.',
      'Журнал посетителей пропал. Без журнала я не знаю, кто настоящий жилец.',
      'Радиокружок опять шипит ночью. Там мальцы ловят не Москву, а что-то между стенами.',
      'Если найдешь чужую записку с печатью вахты, не читай вслух.',
    ],
    talkLinesPost: [
      'Журнал снова у меня. Половина фамилий шевелится, но это уже порядок.',
      'Проходи. Сегодня ты похож на жильца.',
      'Чай остыл. Значит, ночь была настоящая.',
    ],
    talkQuestResponse: 'Повариха опять жалуется? Передай ей: я подложу тряпку под дверь, а она пусть не ставит суп на журнал.',
  },

  ag03_gleb_radio: {
    name: 'Глеб Паяльник',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.ELECTRICIAN,
    sprite: Occupation.ELECTRICIAN,
    hp: 85, maxHp: 85, money: 44, speed: 0.85,
    inventory: [
      { defId: 'ammo_energy', count: 1 },
      { defId: 'flashlight', count: 1 },
      { defId: 'book', count: 2 },
    ],
    talkLines: [
      'Тише. Приемник ловит цифры через несущую стену. Похоже на помехи, но слишком ровно.',
      'Радиокружок официально детский. Неофициально дети ушли, а приемник остался главным.',
      'Мне нужна энергоячейка. Не для оружия. Для того, чтобы услышать конец фразы.',
      'Глаз залетел из вентиляции и сел на частоту. Теперь моргает в такт азбуке.',
      'Если услышишь в эфире свой адрес, не отвечай. Запиши время и выключи питание.',
      'Я паял антенну из ложек. Теперь кухню слышно лучше, чем диспетчера.',
    ],
    talkLinesPost: [
      'Частота стала чище. Теперь слышно трубу и диспетчера, без моргания из вентиляции.',
      'Энергоячейка держит сигнал. Плохо то, что батарея сядет раньше конца сообщения.',
      'Передам, если эфир снова назовет твою комнату.',
    ],
  },

  ag03_rita_lostfound: {
    name: 'Рита Находкина',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 75, maxHp: 75, money: 28, speed: 0.75,
    inventory: [
      { defId: 'bread', count: 2 },
      { defId: 'book', count: 4 },
      { defId: 'toiletpaper', count: 3 },
    ],
    talkLines: [
      'Комната потерянных вещей ничего не теряет. Она только ждет, пока хозяин перестанет спорить.',
      'Вчера принесли левый ботинок. Сегодня пришёл жилец без правого: значит, учет работает.',
      'Еда исчезает быстрее заявлений. Принеси хлеба, я выдам честную компенсацию.',
      'Не трогай красный шкаф. Там лежат вещи тех, кто еще не потерялся.',
      'Если найдешь предмет со своим именем, оставь его мне. Сначала сверим бирку и дату.',
      'Семен из ремонтной опять утащил мой ящик с бирками. Говорит, гермодвери тоже теряются.',
    ],
    talkLinesPost: [
      'Полки полные. Сегодня хоть видно, что пропало.',
      'За хлеб спасибо. Я не спрашиваю, чей он был.',
      'Если что-то потеряешь, приходи сразу. Потом вещь уйдет по чужой квитанции.',
    ],
  },

  ag03_semen_hermo: {
    name: 'Семен Гермошов',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 140, maxHp: 140, money: 55, speed: 0.9,
    inventory: [
      { defId: 'wrench', count: 1 },
      { defId: 'door_kit', count: 1 },
      { defId: 'bandage', count: 1 },
    ],
    talkLines: [
      'Гермодверь не спасает. Спасает привычка проверить уплотнитель до сирены.',
      'Мне нужен бинт. Не для людей. Для пальцев, которые дверь забрала на проверке.',
      'Рита думает, я ворую бирки. Я беру только те, что уже висят на сломанных дверях.',
      'Слышишь хлопок без двери? Значит, створку сорвало с петли, ищи сквозняк.',
      'Я чиню железо, а железо забирает пальцы. Поэтому хожу медленно.',
      'Во время самосбора не стой в ремонтном коридоре. Там нет гермы, только сквозняк и ящик с болтами.',
    ],
    talkLinesPost: [
      'Медицина помогла. Теперь руки дрожат по расписанию.',
      'Если за дверью говорят твоим голосом, бей по петлям и не открывай створку.',
      'Ремонтная жива. Коридор снаружи пусть сам себя чинит.',
    ],
  },

  ag03_tamara_kitchen: {
    name: 'Тамара Кипяток',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.COOK,
    sprite: Occupation.COOK,
    hp: 110, maxHp: 110, money: 36, speed: 0.8,
    inventory: [
      { defId: 'kasha', count: 5 },
      { defId: 'kompot', count: 3 },
      { defId: 'knife', count: 1 },
    ],
    talkLines: [
      'На общей кухне спорят даже кастрюли. Сегодня победила пустая.',
      'Каша нормальная. Если сверху пленка, снимай ложкой и не спорь.',
      'Сходи к Паше и скажи, чтобы перестал хлопать дверью. От этого суп летит на журнал.',
      'Тут кто-то опрокинул табурет и ушел через запасной ход. Я записала это как прогул.',
      'Когда сирена воет, кухня остается кухней. Только коридор снаружи становится чужим.',
      'Не бери нож с раковины. Он числится за кухней, а не за тобой.',
    ],
    talkLinesPost: [
      'Паша услышал? Хорошо. Значит, завтра суп не уйдет в журнал вместо обеда.',
      'Компот держи крепче. Стаканы тут любят падать перед сиреной.',
      'Если у кастрюли опять вспучит крышку, я позову ликвидаторов.',
    ],
  },

  ag03_kirill_runner: {
    name: 'Кирилл Бегунок',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 70, maxHp: 70, money: 12, speed: 1.25,
    inventory: [
      { defId: 'cigs', count: 1 },
      { defId: 'note', count: 1 },
    ],
    talkLines: [
      'Я бегаю между вахтой и кухней. Если идти медленно, коридор успевает передумать.',
      'Глеб просил не трогать приемник. Я тронул. Теперь он записал мой день рождения в журнал помех.',
      'Рита говорит, что я потерял куртку. Я в ней стою. Она говорит: пока да.',
      'Семен дал мне гайку на удачу. Гайка тяжелее удачи.',
      'Если Паша спрашивал, меня тут не было. Если не спрашивал, тем более.',
      'На кухне пятно похоже на карту. Я видел там наш блок и слив, который надо закрыть.',
    ],
    talkLinesPost: [
      'Я передал. Или меня передали. Разницы мало.',
      'Бегать стало легче. Коридор сегодня ленивый.',
      'Если найдешь мою куртку до того, как я ее потеряю, не отдавай.',
    ],
  },
};

registerSideQuest('ag03_pasha_concierge', NPC_DEFS.ag03_pasha_concierge, [
  {
    id: 'ag03_pasha_logbook',
    giverNpcId: 'ag03_pasha_concierge',
    type: QuestType.FETCH,
    desc: 'Дядя Паша: «Принеси любую записку. Я вклею ее в журнал посетителей, пока настоящий журнал не вернулся.»',
    targetItem: 'note', targetCount: 1,
    rewardItem: 'tea', rewardCount: 2,
    extraRewards: [{ defId: 'key', count: 1 }],
    relationDelta: 12, xpReward: 25, moneyReward: 15,
  },
]);

registerSideQuest('ag03_gleb_radio', NPC_DEFS.ag03_gleb_radio, [
  {
    id: 'ag03_gleb_energy_cell',
    giverNpcId: 'ag03_gleb_radio',
    type: QuestType.FETCH,
    desc: 'Глеб Паяльник: «Нужна энергоячейка. Приемник почти поймал конец сообщения.»',
    targetItem: 'ammo_energy', targetCount: 1,
    rewardItem: 'flashlight', rewardCount: 1,
    extraRewards: [{ defId: 'psi_strike', count: 1 }],
    relationDelta: 15, xpReward: 45, moneyReward: 30,
  },
  {
    id: 'ag03_gleb_eye',
    giverNpcId: 'ag03_gleb_radio',
    type: QuestType.KILL,
    desc: 'Глеб Паяльник: «Сбей глаз из радиокружка. Он моргает на моей частоте.»',
    targetMonsterKind: MonsterKind.EYE,
    killNeeded: 1,
    rewardItem: 'ammo_energy', rewardCount: 2,
    relationDelta: 18, xpReward: 55, moneyReward: 35,
  },
]);

registerSideQuest('ag03_rita_lostfound', NPC_DEFS.ag03_rita_lostfound, [
  {
    id: 'ag03_rita_food',
    giverNpcId: 'ag03_rita_lostfound',
    type: QuestType.FETCH,
    desc: 'Рита Находкина: «Принеси хлеб. Потерянные вещи сегодня требуют паек.»',
    targetItem: 'bread', targetCount: 1,
    rewardItem: 'book', rewardCount: 2,
    extraRewards: [{ defId: 'toiletpaper', count: 2 }, { defId: 'canned', count: 1 }],
    relationDelta: 14, xpReward: 30, moneyReward: 20,
  },
]);

registerSideQuest('ag03_semen_hermo', NPC_DEFS.ag03_semen_hermo, [
  {
    id: 'ag03_semen_medicine',
    giverNpcId: 'ag03_semen_hermo',
    type: QuestType.FETCH,
    desc: 'Семен Гермошов: «Принеси бинт. Дверь прикусила руку, а я прикусил мат.»',
    targetItem: 'bandage', targetCount: 1,
    rewardItem: 'door_kit', rewardCount: 1,
    extraRewards: [{ defId: 'wrench', count: 1 }],
    relationDelta: 16, xpReward: 40, moneyReward: 25,
  },
]);

registerSideQuest('ag03_tamara_kitchen', NPC_DEFS.ag03_tamara_kitchen, [
  {
    id: 'ag03_tamara_to_pasha',
    giverNpcId: 'ag03_tamara_kitchen',
    type: QuestType.TALK,
    desc: 'Тамара Кипяток: «Скажи Паше, чтобы не хлопал дверью. Суп летит на журнал и потом все ругаются.»',
    targetNpcId: 'ag03_pasha_concierge',
    rewardItem: 'kompot', rewardCount: 2,
    relationDelta: 10, xpReward: 20, moneyReward: 10,
  },
  {
    id: 'ag03_tamara_visit_kitchen',
    giverNpcId: 'ag03_tamara_kitchen',
    type: QuestType.VISIT,
    desc: 'Тамара Кипяток: «Зайди на общую кухню и посмотри, откуда тянет мокрое пятно у слива.»',
    targetRoomType: RoomType.KITCHEN,
    rewardItem: 'kasha', rewardCount: 3,
    relationDelta: 10, xpReward: 20, moneyReward: 10,
  },
]);

registerSideQuest('ag03_kirill_runner', NPC_DEFS.ag03_kirill_runner, [
  {
    id: 'ag03_kirill_message',
    giverNpcId: 'ag03_kirill_runner',
    type: QuestType.TALK,
    desc: 'Кирилл Бегунок: «Передай Рите, что куртка еще на мне. Пусть не оформляет как потерянную.»',
    targetNpcId: 'ag03_rita_lostfound',
    rewardItem: 'cigs', rewardCount: 2,
    relationDelta: 8, xpReward: 15, moneyReward: 5,
  },
]);

const NPC_SPAWNS: NpcSpawn[] = [
  { id: 'ag03_pasha_concierge', poi: 'concierge', dx: 3, dy: 2, angle: Math.PI },
  { id: 'ag03_gleb_radio', poi: 'radio', dx: 4, dy: 3, angle: Math.PI / 2 },
  { id: 'ag03_rita_lostfound', poi: 'lostFound', dx: 3, dy: 3, angle: 0 },
  { id: 'ag03_semen_hermo', poi: 'repair', dx: 3, dy: 2, angle: Math.PI, weapon: 'wrench' },
  { id: 'ag03_tamara_kitchen', poi: 'kitchen', dx: 4, dy: 3, angle: Math.PI / 2, weapon: 'knife' },
  { id: 'ag03_kirill_runner', poi: 'kitchen', dx: 7, dy: 5, angle: -Math.PI / 2 },
];

function hasPlotNpc(entities: Entity[], plotNpcId: string): boolean {
  return entities.some(e => e.alive && e.plotNpcId === plotNpcId);
}

function pushNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawn: NpcSpawn,
): void {
  if (hasPlotNpc(entities, spawn.id)) return;
  const spot = findSpawnSpot(world, spawn);
  requireSpawnedPlotNpcFromPackage(entities, nextId, spawn.id, spot.x + 0.5, spot.y + 0.5, {
    angle: spawn.angle,
    weapon: spawn.weapon,
    canGiveQuest: true,
  });
}

function findSpawnSpot(world: World, spawn: NpcSpawn): { x: number; y: number } {
  const poi = POI[spawn.poi];
  if (poi) {
    const x = world.wrap(poi.x + Math.min(poi.w - 1, spawn.dx));
    const y = world.wrap(poi.y + Math.min(poi.h - 1, spawn.dy));
    if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y };
  }

  const zoneHudId = poi?.zoneHudId ?? 18;
  const zone = world.zones[zoneHudId - 1];
  const cx = zone?.cx ?? 512;
  const cy = zone?.cy ?? 512;
  for (let r = 0; r < 48; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y };
      }
    }
  }
  return { x: world.wrap(cx), y: world.wrap(cy) };
}

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number, w: number, h: number, salt: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(w / 2);
  const baseY = zcy - Math.floor(h / 2);
  for (let r = 0; r <= 56; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = ((k + salt) / 16) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, w, h)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveBox(world: World, roomId: number, type: RoomType, name: string, rx: number, ry: number, w: number, h: number, wallTex: Tex, floorTex: Tex): Room {
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

function connectSouth(world: World, room: Room, floorTex: Tex, maxLen = 64): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.FLOOR;
  world.floorTex[doorI] = floorTex;
  world.roomMap[doorI] = -1;

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < maxLen; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
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

function dropDesk(entities: Entity[], nextId: { v: number }, x: number, y: number): void {
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
    spriteScale: 0.55,
  });
}

function spawnRadioEye(_world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const kind = MonsterKind.EYE;
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

function registerPoi(key: PoiKey, room: Room, zoneHudId: number): void {
  POI[key] = { x: room.x, y: room.y, w: room.w, h: room.h, zoneHudId };
}

function spawnPoiNpcs(world: World, entities: Entity[], nextId: { v: number }, poi: PoiKey): void {
  for (const spawn of NPC_SPAWNS) {
    if (spawn.poi === poi) pushNpc(world, entities, nextId, spawn);
  }
}

function generateConcierge(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const WID = 7, HEI = 6;
  const pos = findOrigin(world, zcx, zcy, WID, HEI, 1);
  const room = carveBox(world, nextRoomId++, RoomType.OFFICE, 'Консьержная', pos.x, pos.y, WID, HEI, Tex.PANEL, Tex.F_LINO);
  registerPoi('concierge', room, 18);
  connectSouth(world, room, Tex.F_LINO);

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 2, pos.y + 2)] = Feature.DESK;
  world.features[world.idx(pos.x + 3, pos.y + 2)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 5, pos.y + 1)] = Feature.SHELF;
  world.wallTex[world.idx(pos.x + Math.floor(WID / 2), pos.y - 1)] = Tex.POSTER_BASE + 11;
  dropDesk(entities, nextId, pos.x + 2, pos.y + 2);
  dropItem(entities, nextId, pos.x + 5, pos.y + 4, 'note', 1);
  spawnPoiNpcs(world, entities, nextId, 'concierge');
  genLog(`[AG03] Консьержная at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

function generateRadioClub(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const WID = 9, HEI = 7;
  const pos = findOrigin(world, zcx, zcy, WID, HEI, 4);
  const room = carveBox(world, nextRoomId++, RoomType.PRODUCTION, 'Радиокружок', pos.x, pos.y, WID, HEI, Tex.METAL, Tex.F_CONCRETE);
  registerPoi('radio', room, 24);
  connectSouth(world, room, Tex.F_CONCRETE);

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 2, pos.y + 2)] = Feature.APPARATUS;
  world.features[world.idx(pos.x + 3, pos.y + 2)] = Feature.MACHINE;
  world.features[world.idx(pos.x + 6, pos.y + 2)] = Feature.TABLE;
  world.features[world.idx(pos.x + 6, pos.y + 3)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 7, pos.y + 5)] = Feature.SHELF;
  world.wallTex[world.idx(pos.x + 4, pos.y - 1)] = Tex.HINT_4;
  dropDesk(entities, nextId, pos.x + 6, pos.y + 2);
  dropItem(entities, nextId, pos.x + 7, pos.y + 5, 'book', 1);
  spawnRadioEye(world, entities, nextId, pos.x + 4, pos.y + 5);
  spawnPoiNpcs(world, entities, nextId, 'radio');
  genLog(`[AG03] Радиокружок at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

function generateLostAndRepair(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const LOST_W = 7, H = 6, REPAIR_W = 7;
  const pos = findOrigin(world, zcx, zcy, LOST_W + REPAIR_W + 2, H, 8);
  const lost = carveBox(world, nextRoomId++, RoomType.STORAGE, 'Комната потерянных вещей', pos.x, pos.y, LOST_W, H, Tex.ROTTEN, Tex.F_CARPET);
  const repairX = world.wrap(pos.x + LOST_W + 2);
  const repair = carveBox(world, nextRoomId++, RoomType.PRODUCTION, 'Ниша ремонта гермодверей', repairX, pos.y, REPAIR_W, H, Tex.HERMO_WALL, Tex.F_CONCRETE);
  registerPoi('lostFound', lost, 25);
  registerPoi('repair', repair, 25);
  connectSouth(world, lost, Tex.F_LINO);
  connectSouth(world, repair, Tex.F_CONCRETE);

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 1, pos.y + 3)] = Feature.SHELF;
  world.features[world.idx(pos.x + 5, pos.y + 2)] = Feature.SHELF;
  world.features[world.idx(pos.x + 3, pos.y + 4)] = Feature.TABLE;
  world.features[world.idx(repairX + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(repairX + 2, pos.y + 2)] = Feature.MACHINE;
  world.features[world.idx(repairX + 4, pos.y + 2)] = Feature.APPARATUS;
  world.features[world.idx(repairX + 5, pos.y + 4)] = Feature.SHELF;
  world.wallTex[world.idx(repairX + Math.floor(REPAIR_W / 2), pos.y - 1)] = Tex.HERMO_WALL;
  dropItem(entities, nextId, pos.x + 2, pos.y + 4, 'bread', 1);
  dropItem(entities, nextId, repairX + 5, pos.y + 4, 'bandage', 1);
  spawnPoiNpcs(world, entities, nextId, 'lostFound');
  spawnPoiNpcs(world, entities, nextId, 'repair');
  genLog(`[AG03] Lost-and-found/repair at (${pos.x}, ${pos.y}) rooms #${lost.id}/#${repair.id}`);
  return { nextRoomId };
}

function generateCommonKitchen(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const WID = 10, HEI = 8;
  const pos = findOrigin(world, zcx, zcy, WID, HEI, 12);
  const room = carveBox(world, nextRoomId++, RoomType.KITCHEN, 'Общая кухня: спорная', pos.x, pos.y, WID, HEI, Tex.TILE_W, Tex.F_TILE);
  registerPoi('kitchen', room, 31);
  connectSouth(world, room, Tex.F_LINO); // corridor intentionally volatile: unsafe during samosbor.

  world.features[world.idx(pos.x + 1, pos.y + 1)] = Feature.LAMP;
  world.features[world.idx(pos.x + 2, pos.y + 1)] = Feature.STOVE;
  world.features[world.idx(pos.x + 3, pos.y + 1)] = Feature.SINK;
  world.features[world.idx(pos.x + 5, pos.y + 3)] = Feature.TABLE;
  world.features[world.idx(pos.x + 4, pos.y + 3)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 6, pos.y + 4)] = Feature.CHAIR;
  world.features[world.idx(pos.x + 8, pos.y + 1)] = Feature.SHELF;
  world.wallTex[world.idx(pos.x + 1, pos.y - 1)] = Tex.POSTER_BASE + 23;
  stampSurfaceSplat(world, pos.x + 5, pos.y + 5, 0.5, 0.5, 5, 0.6, 3103, 120, 42, 28, false);
  dropDesk(entities, nextId, pos.x + 5, pos.y + 3);
  dropItem(entities, nextId, pos.x + 8, pos.y + 6, 'kasha', 1);
  dropItem(entities, nextId, pos.x + 2, pos.y + 5, 'knife', 1);
  spawnPoiNpcs(world, entities, nextId, 'kitchen');
  genLog(`[AG03] Общая кухня at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

export function spawnSovietHousingPackNpcs(
  world: World,
  entities: Entity[],
  nextId: { v: number },
): void {
  for (const spawn of NPC_SPAWNS) pushNpc(world, entities, nextId, spawn);
}

registerZoneContent(18, 'Консьержная', generateConcierge);
registerZoneContent(24, 'Радиокружок', generateRadioClub);
registerZoneContent(25, 'Потерянные вещи и гермодвери', generateLostAndRepair);
registerZoneContent(31, 'Общая кухня: спорная', generateCommonKitchen);

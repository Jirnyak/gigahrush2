/* ── Инспекционный архив — Ministry access-control POI ───────── */

import {
  Cell,
  ContainerKind,
  DoorState,
  Tex,
  Feature,
  FloorLevel,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  MonsterKind,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  type NextId, createAdminRoom, setFeature, addItemDrop, spawnAdminNpc, spawnAdminMonster,
} from '../admin_common';
import { genLog } from '../log';

const INSPECTION_ARCHIVE_ROUTE_TAGS = [
  'archive',
  'inspection_archive',
  'archive_route',
  'raionsovet_archive',
  'liquidator_archive',
  'evidence',
  'evidence_drop',
  'audit',
  'patrol',
  'theft',
];

const NINA_DEF: PlotNpcDef = {
  name: 'Нина Досмотрова',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 150, maxHp: 150, money: 130, speed: 0.85,
  inventory: [
    { defId: 'temp_pass', count: 1 },
    { defId: 'blank_form', count: 3 },
    { defId: 'zhek_seal', count: 1 },
  ],
  talkLines: [
    'Инспекционный архив. Руки на стол, документы на край, страх отдельно.',
    'Я Нина Досмотрова. Проверяю не людей, а совпадение людей с бумагой.',
    'Временный пропуск лежит за решёткой картотеки. Формально он ваш, если вы сумеете выйти с ним.',
    'Маршрутный ящик у задней решётки ведёт дальше: карточка райсовета, акт пропажи, дело Л-47.',
    'Законный путь: ключ, подпись, ожидание. Быстрый путь: тише дышать у шкафов.',
    'Пустые бланки опаснее оружия. На них ещё ничего не запрещено.',
    'Если печатеед сожрёт дело, виноват будет последний, кто видел папку целой.',
  ],
  talkLinesPost: [
    'Ваш допуск пока не отозван. Это редкий вид тишины.',
    'Архив отметил вас карандашом. Карандаш стирается хуже сургуча.',
    'Следующая проверка уже назначена, но дата ещё боится проявиться.',
  ],
};

const EVSEY_DEF: PlotNpcDef = {
  name: 'Евсей Засов',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 120, maxHp: 120, money: 95, speed: 0.7,
  inventory: [
    { defId: 'denunciation', count: 2 },
    { defId: 'book', count: 2 },
    { defId: 'water_coupon', count: 1 },
  ],
  talkLines: [
    'Не трогайте верхний ящик. На пыли видны пальцы поштучно.',
    'Я Евсей Засов. Запираю всё, что ещё можно назвать имуществом.',
    'Донос без номера портит полку. Три доноса уже делают статистику.',
    'Жалобы принимают у окна, а последствия хранят у меня.',
    'Ключ есть у тех, кто не спрашивает о ключе. Остальные получают квитанцию.',
  ],
  talkLinesPost: [
    'Доносы подшиты. Фамилии ушли в папку, не в коридор.',
    'Можете пройти, но не задерживайтесь между шкафами.',
    'Если ящик открылся сам, считайте это отказом.',
  ],
};

const MARFA_DEF: PlotNpcDef = {
  name: 'Марфа Жалобная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 85, maxHp: 85, money: 35, speed: 0.8,
  inventory: [
    { defId: 'neighbor_complaint', count: 2 },
    { defId: 'water_coupon', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Окно жалоб закрыто, но я всё равно стою. Это уже форма участия.',
    'Сосед стучит по батарее азбукой. Архив говорит, что батареи неграмотны.',
    'Принесите две жалобы. Одной не верят, две уже создают отдел.',
    'Если вашу жалобу приняли без печати, значит её приняли против вас.',
    'Очередь двигается только тогда, когда кто-нибудь исчезает из списка.',
  ],
  talkLinesPost: [
    'Жалобы есть. Теперь у меня входящий номер, а не разговор у стены.',
    'Берите талон. Он мокрый, но очередь любит мокрые доказательства.',
    'Я постою ещё немного. Вдруг дежурный вернётся и откроет журнал.',
  ],
};

const YURI_DEF: PlotNpcDef = {
  name: 'Юрий Дверцов',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 360, maxHp: 360, money: 180, speed: 1.0,
  inventory: [
    { defId: 'tt_pistol', count: 1 },
    { defId: 'ammo_762tt', count: 18 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'К двери не прислоняться. Она открывается в сторону подозреваемого.',
    'Юрий Дверцов, ликвидатор при архиве. Мой приказ простой: никто не выносит проход без отметки.',
    'В задней картотеке завёлся печатеед. Жрёт пропуска, потом смотрит как проверяющий.',
    'Патруль сверяет маршрутные ящики после отбоя. Украли сейчас — ревизия найдёт пустое место потом.',
    'Убейте его, пока он не научился расписываться за начальство.',
    'Фальшивый пропуск лучше сразу сдать мне. Так дешевле, чем объяснять стене.',
  ],
  talkLinesPost: [
    'Печатеед списан. Архив снова врёт человеческим голосом.',
    'Дверь сегодня спокойная. Не провоцируйте её бумагой.',
    'Ваш номер я не записал. Считайте это благодарностью.',
  ],
};

registerSideQuest('nina_dosmotrova', NINA_DEF, [
  {
    id: 'inspection_temp_pass_retrieval',
    giverNpcId: 'nina_dosmotrova',
    type: QuestType.FETCH,
    desc: 'Нина Досмотрова: «Принесите временный пропуск из задней картотеки. Ключ желателен, тишина обязательна.»',
    targetItem: 'temp_pass', targetCount: 1,
    rewardItem: 'permanent_pass', rewardCount: 1,
    extraRewards: [{ defId: 'zhek_seal', count: 1 }],
    relationDelta: 18, xpReward: 90, moneyReward: 150,
  },
  {
    id: 'inspection_blank_forms',
    giverNpcId: 'nina_dosmotrova',
    type: QuestType.FETCH,
    desc: 'Нина Досмотрова: «Четыре пустых бланка. До самосбора они должны получить смысл.»',
    targetItem: 'blank_form', targetCount: 4,
    rewardItem: 'fake_pass', rewardCount: 1,
    extraRewards: [{ defId: 'ink_bottle', count: 2 }],
    relationDelta: 12, xpReward: 65, moneyReward: 80,
  },
]);

registerSideQuest('evsey_zasov', EVSEY_DEF, [
  {
    id: 'archive_denunciation_index',
    giverNpcId: 'evsey_zasov',
    type: QuestType.FETCH,
    desc: 'Евсей Засов: «Три доноса для индекса. Без индекса донос становится разговором.»',
    targetItem: 'denunciation', targetCount: 3,
    rewardItem: 'book', rewardCount: 2,
    extraRewards: [{ defId: 'water_coupon', count: 2 }],
    relationDelta: 10, xpReward: 60, moneyReward: 70,
  },
]);

registerSideQuest('marfa_zhalobnaya', MARFA_DEF, [
  {
    id: 'complaint_window_double',
    giverNpcId: 'marfa_zhalobnaya',
    type: QuestType.FETCH,
    desc: 'Марфа Жалобная: «Две соседские жалобы. Одну архив считает настроением.»',
    targetItem: 'neighbor_complaint', targetCount: 2,
    rewardItem: 'water_coupon', rewardCount: 3,
    extraRewards: [{ defId: 'bread', count: 2 }],
    relationDelta: 12, xpReward: 55, moneyReward: 45,
  },
]);

registerSideQuest('yuri_dvertsov', YURI_DEF, [
  {
    id: 'inspection_paper_eater',
    giverNpcId: 'yuri_dvertsov',
    type: QuestType.KILL,
    desc: 'Юрий Дверцов: «Убейте печатееда в задней картотеке, пока он не съел пропуска.»',
    targetMonsterKind: MonsterKind.PECHATEED,
    killNeeded: 1,
    rewardItem: 'liquidator_token', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_762tt', count: 12 }],
    relationDelta: 18, xpReward: 95, moneyReward: 140,
  },
]);

function addLockedArchiveGate(world: World, roomId: number, gateX: number, topY: number, bottomY: number, doorY: number): void {
  for (let y = topY; y <= bottomY; y++) {
    const ci = world.idx(gateX, y);
    world.features[ci] = Feature.NONE;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
  }

  const doorIdx = world.idx(gateX, doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.LOCKED,
    roomA: roomId,
    roomB: roomId,
    keyId: 'key',
    timer: 0,
  });
  const room = world.rooms[roomId];
  if (room && !room.doors.includes(doorIdx)) room.doors.push(doorIdx);
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function addInspectionEvidenceContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  inventory: WorldContainer['inventory'],
): void {
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.FILING_CABINET,
    name: 'Маршрутный ящик ревизии: досмотр, райсовет, Л-47',
    inventory,
    capacitySlots: 10,
    faction: Faction.LIQUIDATOR,
    ownerName: 'Инспекционный архив',
    access: 'faction',
    discovered: true,
    tags: [...INSPECTION_ARCHIVE_ROUTE_TAGS],
  });
}

export function generateInspectionArchive(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Инспекционный архив',
    w: 13, h: 9,
    minDist: 60, maxDist: 150,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const serviceY = room.y + 3;
  const gateX = room.x + room.w - 4;
  addLockedArchiveGate(world, room.id, gateX, room.y + 1, room.y + room.h - 2, cy);

  for (let dx = 2; dx < room.w - 5; dx++) setFeature(world, room.x + dx, serviceY, Feature.DESK);
  for (let dx = 2; dx < room.w - 5; dx += 2) setFeature(world, room.x + dx, serviceY + 1, Feature.CHAIR);
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(world, cx - 2, room.y + 1, Feature.LAMP);
  setFeature(world, room.x + room.w - 2, room.y + room.h - 2, Feature.LAMP);
  world.wallTex[world.idx(cx, room.y - 1)] = Tex.POSTER_BASE + 11;
  world.wallTex[world.idx(room.x + room.w, cy)] = Tex.PORTRAIT_BASE + 18;

  addItemDrop(entities, nextId, room.x + 2, room.y + room.h - 2, 'neighbor_complaint', 1);
  addItemDrop(entities, nextId, room.x + 4, room.y + room.h - 2, 'denunciation', 1);
  addItemDrop(entities, nextId, gateX + 1, room.y + 2, 'temp_pass', 1);
  addItemDrop(entities, nextId, gateX + 2, room.y + 3, 'blank_form', 2);
  addItemDrop(entities, nextId, gateX + 1, room.y + room.h - 3, 'unsigned_order', 1);
  addItemDrop(entities, nextId, gateX + 2, room.y + room.h - 2, 'fake_pass', 1);

  addInspectionEvidenceContainer(
    world,
    room.id,
    gateX + 1,
    serviceY + 2,
    [
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'denunciation', count: 2 },
      { defId: 'temp_pass', count: 1 },
    ],
  );

  spawnAdminNpc(entities, nextId, NINA_DEF, 'nina_dosmotrova', cx - 1, serviceY - 1);
  spawnAdminNpc(entities, nextId, EVSEY_DEF, 'evsey_zasov', room.x + 2, room.y + 2);
  spawnAdminNpc(entities, nextId, MARFA_DEF, 'marfa_zhalobnaya', room.x + 3, room.y + room.h - 3);
  spawnAdminNpc(entities, nextId, YURI_DEF, 'yuri_dvertsov', gateX - 1, cy, true, 'tt_pistol');
  spawnAdminMonster(world, entities, nextId, gateX + 2, cy, MonsterKind.PECHATEED);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

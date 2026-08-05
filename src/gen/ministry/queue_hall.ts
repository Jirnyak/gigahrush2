/* ── Зал невозможной очереди — Ministry admin POI ─────────────── */

import {
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  ContainerKind,
  FloorLevel,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import {
  type NextId, createAdminRoom, setFeature, addItemDrop, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const PERMIT_CHOICE_IDS = [
  'permit_wait_queue',
  'permit_pay_accelerator',
  'permit_forge_slip',
  'permit_threaten_window',
  'queue_water',
] as const;

function otherPermitChoices(id: string): string[] {
  return PERMIT_CHOICE_IDS.filter(choiceId => choiceId !== id);
}

interface QueueCivilianSpec {
  id: string;
  name: string;
  isFemale: boolean;
  dx: number;
  dy: number;
  occupation: Occupation;
}

const QUEUE_CIVILIANS: readonly QueueCivilianSpec[] = [
  { id: 'queue_hall_platon_bezokoshechny', name: 'Платон Безокошечный', isFemale: false, dx: 5, dy: 5, occupation: Occupation.SECRETARY },
  { id: 'queue_hall_nina_vtoraya_sleva', name: 'Нина Вторая-Слева', isFemale: true, dx: 8, dy: 6, occupation: Occupation.DOCTOR },
  { id: 'queue_hall_egor_nomernoy', name: 'Егор Номерной', isFemale: false, dx: 11, dy: 5, occupation: Occupation.STOREKEEPER },
  { id: 'queue_hall_tamara_beztalonnaya', name: 'Тамара Безталонная', isFemale: true, dx: 6, dy: 8, occupation: Occupation.COOK },
  { id: 'queue_hall_saveliy_konets_stroki', name: 'Савелий Конец-Строки', isFemale: false, dx: 12, dy: 8, occupation: Occupation.LOCKSMITH },
];

function queueCivilianDef(spec: QueueCivilianSpec): PlotNpcDef {
  return {
    name: spec.name,
    isFemale: spec.isFemale,
    faction: Faction.CITIZEN,
    occupation: spec.occupation,
    sprite: spec.occupation,
    hp: 70, maxHp: 70, money: 15, speed: 0.8,
    inventory: [{ defId: 'note', count: 1 }],
    talkLines: [
      'Очередь идет, но место не двигается.',
      'Если назовут мой номер, скажите, что я уже был человеком.',
    ],
    talkLinesPost: [
      'Номер услышал себя и снова замолчал.',
    ],
  };
}

const OSIP_DEF: PlotNpcDef = {
  name: 'Осип Карточный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 150, maxHp: 150, money: 110, speed: 0.7,
  inventory: [
    { defId: 'book', count: 4 },
    { defId: 'note', count: 6 },
    { defId: 'key', count: 1 },
  ],
  talkLines: [
    'Картотека принимает только тихие фамилии. Громкие фамилии будят шкафы.',
    'Я Осип Карточный. Веду учет тех, кто стоял в очереди, стоит и будет стоять задним числом.',
    'У каждой карточки есть лицо. У некоторых лиц карточек слишком много.',
    'Если вам нужен пропуск, принесите книги. Толстая обложка держит архивный укус.',
    'Не открывайте зеленый ящик. Он считает пальцы до выдачи и после.',
    'Печать Зои? Значит, один из ящиков сегодня признан реальным. Редкий случай.',
    'Картотека не хранит прошлое. Она хранит варианты, которые пока не запретили.',
    'Справка без карточки является слухом. Слухи у нас стоят в отдельной очереди.',
  ],
  talkLinesPost: [
    'Карточки подшиты. Очередь укоротилась на одного человека и удлинилась на два дела.',
    'Ваш номер лежит между пустым местом и жалобой.',
    'Когда шкафы шепчут алфавит, уходите на букве Ж.',
  ],
  talkQuestResponse: 'Печать дошла. Скажите Зое, что ящик принял ее и не скрипнул.',
};

const KLAVDIYA_DEF: PlotNpcDef = {
  name: 'Клавдия Очередная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90, maxHp: 90, money: 25, speed: 0.85,
  inventory: [
    { defId: 'bread', count: 1 },
    { defId: 'water', count: 1 },
    { defId: 'toiletpaper', count: 1 },
  ],
  talkLines: [
    'Я стою здесь с утра. Не этого утра. Просто с утра.',
    'Мой номер называли три раза, но каждый раз другим голосом и из другой стены.',
    'Если дойдете до окна, не верьте табличке. Таблички меняются местами, когда моргаешь.',
    'У меня украли воду и сказали, что это ускорение обслуживания.',
    'Принесите воды. Я уступлю вам место, которое еще не родилось.',
    'Мужчина передо мной ушёл домой, но его пальто продолжает занимать номер.',
    'Девочка у окна выросла на две головы, пока ждала подпись.',
    'Когда сирена звучит, очередь не разбегается. Она просто становится плотнее.',
  ],
  talkLinesPost: [
    'Вода есть. Теперь можно ждать медленнее.',
    'Берите мое место. Оно третье после того, кто без лица.',
    'Очередь вас запомнила. Это плохо, но полезно.',
  ],
};

registerSideQuest('osip_kartochny', OSIP_DEF, [
  {
    id: 'archive_card_books',
    giverNpcId: 'osip_kartochny',
    type: QuestType.FETCH,
    desc: 'Осип Карточный: «Четыре книги для картотеки. Обложки держат архивный укус.»',
    targetItem: 'book', targetCount: 4,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'note', count: 3 }],
    relationDelta: 16, xpReward: 85, moneyReward: 130,
  },
  {
    id: 'min_coupon_forgery_report',
    giverNpcId: 'osip_kartochny',
    type: QuestType.FETCH,
    desc: 'Осип Карточный: «Принесите поддельную пайковую карточку. Не продавайте её: чужой ужин потом ищет свидетеля.»',
    targetItem: 'forged_ration_card', targetCount: 1,
    rewardItem: 'ration_registry_extract', rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 2 }],
    relationDelta: 14, xpReward: 70, moneyReward: 80,
  },
]);

registerSideQuest('klavdiya_ocherednaya', KLAVDIYA_DEF, [
  {
    id: 'queue_water',
    giverNpcId: 'klavdiya_ocherednaya',
    type: QuestType.FETCH,
    desc: 'Клавдия Очередная: «Две бутылки воды. Я уступлю место у пропускного окна, пока очередь не заметила милосердие.»',
    targetItem: 'water', targetCount: 2,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'toiletpaper', count: 2 }, { defId: 'bread', count: 2 }],
    relationDelta: 14, xpReward: 55, moneyReward: 20,
    eventTargetName: 'Место у пропускного окна получено через помощь человеку в очереди.',
    eventTags: ['ministry', 'permit_office', 'queue', 'help', 'relief'],
    eventData: { permitOutcome: 'help', permitDocument: 'official_permit_slip', helpedNpc: 'klavdiya_ocherednaya' },
    abandonsSideQuestIds: otherPermitChoices('queue_water'),
    blockedBySideQuestIds: otherPermitChoices('queue_water'),
  },
]);

for (const spec of QUEUE_CIVILIANS) {
  registerAuthoredNpc({
    id: spec.id,
    npc: queueCivilianDef(spec),
    homeFloorKey: HOME_FLOOR_KEY,
    tags: ['ministry', 'queue_hall', 'queue'],
  });
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const c of world.containers) if (c.id >= id) id = c.id + 1;
  return id;
}

function addQueueAuditCabinet(
  world: World,
  roomId: number,
  x: number,
  y: number,
  ownerId: number,
): void {
  const inventory: WorldContainer['inventory'] = [
    { defId: 'ration_registry_extract', count: 2 },
    { defId: 'ration_stamp_pad', count: 1 },
    { defId: 'water_coupon', count: 2 },
    { defId: 'concentrate_coupon', count: 1 },
    { defId: 'forged_ration_card', count: 1 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Аудиторская картотека талонов',
    inventory,
    capacitySlots: 8,
    ownerNpcId: ownerId,
    ownerName: OSIP_DEF.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: ['queue_hall', 'ration_coupon_audit', 'paper', 'theft'],
  });
}

export function generateQueueHall(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.COMMON,
    name: 'Зал невозможной очереди',
    w: 15, h: 10,
    minDist: 25, maxDist: 110,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_GREEN_CARPET,
  });
  if (!room) return { nextRoomId };

  const serviceY = room.y + 2;
  for (let dx = 2; dx < room.w - 2; dx++) setFeature(world, room.x + dx, serviceY, Feature.DESK);
  for (let dx = 2; dx < room.w - 2; dx += 3) setFeature(world, room.x + dx, serviceY + 1, Feature.CHAIR);
  for (let dy = 4; dy < room.h - 1; dy += 2) {
    for (let dx = 2; dx < room.w - 2; dx += 3) {
      setFeature(world, room.x + dx, room.y + dy, Feature.CHAIR);
    }
  }
  for (let dx = 1; dx < room.w - 1; dx += 4) {
    setFeature(world, room.x + dx, room.y + 1, Feature.LAMP);
  }
  setFeature(world, room.x + 1, room.y + room.h - 2, Feature.SHELF);
  setFeature(world, room.x + room.w - 2, room.y + room.h - 2, Feature.SHELF);
  world.wallTex[world.idx(room.x + Math.floor(room.w / 2), room.y - 1)] = Tex.POSTER_BASE + 3;

  addItemDrop(entities, nextId, room.x + 2, room.y + room.h - 2, 'water', 1);
  addItemDrop(entities, nextId, room.x + room.w - 3, room.y + room.h - 2, 'book', 1);
  addItemDrop(entities, nextId, room.x + 2, serviceY + 1, 'ration_registry_extract', 1);
  const osipId = nextId.v;
  spawnAdminNpc(entities, nextId, OSIP_DEF, 'osip_kartochny', room.x + Math.floor(room.w / 2), serviceY - 1);
  spawnAdminNpc(entities, nextId, KLAVDIYA_DEF, 'klavdiya_ocherednaya', room.x + 3, room.y + room.h - 3);
  addQueueAuditCabinet(world, room.id, room.x + room.w - 2, room.y + room.h - 2, osipId);

  for (const spec of QUEUE_CIVILIANS) {
    spawnAdminNpc(entities, nextId, queueCivilianDef(spec), spec.id, room.x + spec.dx, room.y + spec.dy, false);
  }

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

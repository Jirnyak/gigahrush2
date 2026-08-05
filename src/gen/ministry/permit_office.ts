/* ── Пропускное бюро — Ministry admin POI ─────────────────────── */

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
import { type PlotNpcDef, registerAuthoredNpc, registerFloorSideQuest, storyNpcFloorKey } from '../../data/plot';
import {
  type NextId, createAdminRoom, setFeature, addItemDrop, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const ROOM_NAME = 'Пропускное бюро';
const PERMIT_CHOICE_IDS = [
  'permit_wait_queue',
  'permit_pay_accelerator',
  'permit_forge_slip',
  'permit_threaten_window',
  'queue_water',
] as const;
const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const WITNESS_DUSYA_ID = 'permit_office_witness_dusya';
const WITNESS_ARKADY_ID = 'permit_office_witness_arkady';

function otherPermitChoices(id: string): string[] {
  return PERMIT_CHOICE_IDS.filter(choiceId => choiceId !== id);
}

const VERA_DEF: PlotNpcDef = {
  name: 'Вера Пропускова',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 130, maxHp: 130, money: 90, speed: 0.9,
  inventory: [
    { defId: 'ballot', count: 3 },
    { defId: 'note', count: 4 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Пропускное бюро слушает. Не стойте на линии ковра без основания.',
    'Пропуск выдается тем, кто уже имеет право на пропуск. Так отделяет порядок от коридора.',
    'Сначала заявление, потом печать, потом архивная карточка. В обратном порядке люди исчезают чаще.',
    'Если вам сказали, что окно закрыто, уточните: какое именно окно. У нас их нет, но формально они работают.',
    'Принесите бюллетени. Я выдам контрольный ключ, пока ваш номер не ушел в нижний журнал.',
    'Не спорьте с очередью. Очередь старше министра.',
    'Если коридор потребует подпись, пишите печатными буквами. Он плохо читает дрожащие руки.',
    'Я видела пропуск без владельца. Он прошёл проверку быстрее всех.',
    'Путь один только на плакате. На деле ждут, платят, подделывают, давят, помогают или лезут в шкаф.',
  ],
  talkLinesPost: [
    'Корешок готов. На первом посту держите его печатью вверх.',
    'Ваше дело пока живое. Это не право, это отсрочка.',
    'Следующее окно примет вас вчера.',
  ],
  talkQuestResponse: 'Передайте, что пропуск без печати является просьбой о допросе.',
};

const WAIT_REGISTRAR_DEF: PlotNpcDef = {
  name: 'Назар Секундомеров',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 110, maxHp: 110, money: 35, speed: 0.65,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Ожидание - самый дешевый сбор. Встаньте в зал невозможной очереди и не пытайтесь ускорить минуту.',
    'Очередь выдает корешки тем, кто достаточно долго похож на мебель.',
    'Если вас назовут вчерашним номером, отвечайте спокойно. Вчера тут обслуживают быстрее.',
  ],
  talkLinesPost: [
    'Вы дождались. Это почти подозрительно.',
    'Корешок выдан законно: очередь сама устала вас держать.',
  ],
};

const PAY_CLERK_DEF: PlotNpcDef = {
  name: 'Римма Ускорительная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 105, maxHp: 105, money: 160, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'voluntary_receipt', count: 1 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Ускорительный сбор не взятка. Взятка стесняется квитанции.',
    'Девяносто рублей, и я ставлю отметку, будто вы стояли с утра.',
    'Деньги не открывают дверь. Они дают бумагу, которую охрана боится читать вслух.',
  ],
  talkLinesPost: [
    'Сбор прошел. Не спрашивайте, через какую статью.',
    'Квитанция тише пропуска, но иногда важнее.',
  ],
};

const FORGER_DEF: PlotNpcDef = {
  name: 'Федя Кальковый',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 95, maxHp: 95, money: 55, speed: 0.9,
  inventory: [
    { defId: 'forged_permit_slip', count: 1 },
    { defId: 'ink_bottle', count: 2 },
    { defId: 'blank_form', count: 1 },
  ],
  talkLines: [
    'Я не подделываю. Я ставлю подпись туда, где ее давно ждут.',
    'Лист с поддельной печатью принесете - будет корешок. Не официальный, зато быстрый.',
    'Настоящая печать оставляет ожог на сургуче. Моя просто пачкает пальцы.',
  ],
  talkLinesPost: [
    'Кованый корешок готов. Держите его подальше от честных ламп.',
    'Если аудит спросит, мы с вами незнакомы даже по алфавиту.',
  ],
};

const THREAT_CLERK_DEF: PlotNpcDef = {
  name: 'Глеб Прижимной',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 190, maxHp: 190, money: 30, speed: 0.9,
  weapon: 'pipe',
  inventory: [
    { defId: 'pipe', count: 1 },
    { defId: 'unsigned_order', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Очередь уважает бумагу, которая звучит как приказ.',
    'Принесите приказ без подписи. Я положу его на стол так, что окно само найдет печать.',
    'После такого корешок будет настоящий, а отношение к вам - нет.',
  ],
  talkLinesPost: [
    'Дежурный испугался правильно. Теперь уходите, пока он не позвал свидетелей.',
    'Корешок есть. Улыбаться не надо: очередь запоминает зубы.',
  ],
};

const WITNESS_DUSYA_DEF: PlotNpcDef = {
  name: 'Свидетельница Дуся Третья',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'sealed_complaint', count: 1 },
    { defId: 'water', count: 1 },
  ],
  talkLines: [
    'Я третья свидетельница, потому что первые две ушли в разные окна.',
    'Жалоба запечатана. Если ее открыть, очередь станет личной.',
  ],
  talkLinesPost: [
    'Окно видело меня. Я видела окно. Этого достаточно для протокола.',
  ],
};

const WITNESS_ARKADY_DEF: PlotNpcDef = {
  name: 'Понятой Аркадий Крайний',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'note', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Крайний всегда понятой. Так очередь экономит людей.',
    'Я подписываю только то, где уже не осталось места для правды.',
  ],
  talkLinesPost: [
    'Подпись поставлена с краю. Середина пусть отвечает сама.',
  ],
};

registerFloorSideQuest(HOME_FLOOR_KEY, 'vera_propuskova', VERA_DEF, [
  {
    id: 'permit_ballot_blanks',
    giverNpcId: 'vera_propuskova',
    type: QuestType.FETCH,
    desc: 'Вера Пропускова: «Принесите три бюллетеня. Выдам контрольный ключ для первого поста.»',
    targetItem: 'ballot', targetCount: 3,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 2 }],
    relationDelta: 14, xpReward: 70, moneyReward: 90,
  },
  {
    id: 'permit_stamp_route',
    giverNpcId: 'vera_propuskova',
    type: QuestType.TALK,
    desc: 'Вера Пропускова: «Передайте Зое Сургучной в комнату печатей, что корешок без ее отметки охрана завернет у первого поста.»',
    targetNpcId: 'zoya_surguchnaya',
    rewardItem: 'note', rewardCount: 2,
    relationDelta: 10, xpReward: 35, moneyReward: 40,
  },
]);

registerFloorSideQuest(HOME_FLOOR_KEY, 'permit_wait_registrar', WAIT_REGISTRAR_DEF, [
  {
    id: 'permit_wait_queue',
    giverNpcId: 'permit_wait_registrar',
    type: QuestType.VISIT,
    desc: 'Назар Секундомеров: «Законный путь простой: стойте в Зале невозможной очереди {dir}. Когда табель дойдет до вашей фамилии, получите корешок.»',
    targetRoomName: 'Зал невозможной очереди',
    targetFloor: FloorLevel.MINISTRY,
    targetHint: 'Министерство: Зал невозможной очереди с рядами стульев и картотекой Осипа.',
    rewardItem: 'official_permit_slip', rewardCount: 1,
    relationDelta: 3, xpReward: 30, moneyReward: 0,
    eventTargetName: 'Пропуск получен через ожидание в министерской очереди.',
    eventTags: ['ministry', 'permit_office', 'queue', 'wait', 'legal'],
    eventData: { permitOutcome: 'wait', permitDocument: 'official_permit_slip' },
    abandonsSideQuestIds: otherPermitChoices('permit_wait_queue'),
    blockedBySideQuestIds: otherPermitChoices('permit_wait_queue'),
  },
]);

registerFloorSideQuest(HOME_FLOOR_KEY, 'permit_pay_clerk', PAY_CLERK_DEF, [
  {
    id: 'permit_pay_accelerator',
    giverNpcId: 'permit_pay_clerk',
    type: QuestType.FETCH,
    desc: 'Римма Ускорительная: «Девяносто рублей ускорительного сбора. Окно выдаст корешок, а расписка пройдет N3 как тихая взятка с ревизионным хвостом.»',
    targetItem: 'money', targetCount: 90,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'voluntary_receipt', count: 1 }],
    relationDelta: 1, xpReward: 35, moneyReward: 0,
    eventTargetName: 'Пропускное бюро оформило корешок через ускорительный сбор.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['ministry', 'permit_office', 'bribe', 'receipt', 'document_gate', 'audit_risk', 'money', 'pay'],
    eventData: {
      permitOutcome: 'bribe',
      amount: 90,
      permitDocument: 'official_permit_slip',
      bribeDocument: 'voluntary_receipt',
      gateMethod: 'bribe',
      auditRisk: 'accelerator_fee_without_case',
    },
    abandonsSideQuestIds: otherPermitChoices('permit_pay_accelerator'),
    blockedBySideQuestIds: otherPermitChoices('permit_pay_accelerator'),
  },
]);

registerFloorSideQuest(HOME_FLOOR_KEY, 'permit_forger_fedya', FORGER_DEF, [
  {
    id: 'permit_forge_slip',
    giverNpcId: 'permit_forger_fedya',
    type: QuestType.FETCH,
    desc: 'Федя Кальковый: «Лист с поддельной печатью сюда. Сделаю поддельный корешок: охрана пропустит, а аудит потом будет искать чужой почерк.»',
    targetItem: 'forged_stamp_sheet', targetCount: 1,
    rewardItem: 'forged_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: -4, xpReward: 45, moneyReward: 0,
    eventTargetName: 'В пропускном бюро изготовлен поддельный корешок пропуска.',
    eventSeverity: 5,
    eventPrivacy: 'secret',
    eventTags: ['ministry', 'permit_office', 'forgery', 'audit_risk', 'document_gate', 'document', 'risk'],
    eventData: {
      permitOutcome: 'forge',
      permitDocument: 'forged_permit_slip',
      gateMethod: 'forged',
      auditRisk: 'stamp_shape_and_ink_time_mismatch',
      heat: 3,
    },
    abandonsSideQuestIds: otherPermitChoices('permit_forge_slip'),
    blockedBySideQuestIds: otherPermitChoices('permit_forge_slip'),
  },
]);

registerFloorSideQuest(HOME_FLOOR_KEY, 'permit_threat_gleb', THREAT_CLERK_DEF, [
  {
    id: 'permit_threaten_window',
    giverNpcId: 'permit_threat_gleb',
    type: QuestType.FETCH,
    desc: 'Глеб Прижимной: «Нужен приказ без подписи. Положим его на окно, и дежурный выдаст корешок, пока не понял, кому звонить.»',
    targetItem: 'unsigned_order', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    relationDelta: -8, xpReward: 40, moneyReward: 0,
    eventTargetName: 'Пропускное окно выдало корешок после давления приказом без подписи.',
    eventSeverity: 5,
    eventPrivacy: 'witnessed',
    eventTags: ['ministry', 'permit_office', 'threat', 'coercion', 'document'],
    eventData: { permitOutcome: 'threaten', permitDocument: 'official_permit_slip', relationRisk: 'citizen' },
    abandonsSideQuestIds: otherPermitChoices('permit_threaten_window'),
    blockedBySideQuestIds: otherPermitChoices('permit_threaten_window'),
  },
]);

registerAuthoredNpc({
  id: WITNESS_DUSYA_ID,
  npc: WITNESS_DUSYA_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'permit_office', 'witness'],
});

registerAuthoredNpc({
  id: WITNESS_ARKADY_ID,
  npc: WITNESS_ARKADY_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'permit_office', 'witness'],
});

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addPermitIssueTray(
  world: World,
  roomId: number,
  x: number,
  y: number,
  ownerNpcId: number,
): void {
  const inventory: WorldContainer['inventory'] = [
    { defId: 'official_permit_slip', count: 2 },
    { defId: 'forged_permit_slip', count: 1 },
    { defId: 'archive_access_permit', count: 1 },
    { defId: 'raionsovet_floor_pass', count: 1 },
    { defId: 'ministry_clean_stamp', count: 1 },
    { defId: 'blank_form', count: 2 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Лоток готовых корешков',
    inventory,
    capacitySlots: 8,
    ownerNpcId,
    ownerName: VERA_DEF.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: ['permit_office', 'permit_choice', 'steal', 'document', 'paper', 'audit', 'theft'],
  });
}

export function generatePermitOffice(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: ROOM_NAME,
    w: 15, h: 10,
    minDist: 30, maxDist: 95,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_GREEN_CARPET,
  });
  if (!room) return { nextRoomId };

  const deskY = room.y + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx++) {
    setFeature(world, room.x + dx, deskY, Feature.DESK);
  }
  for (let dx = 2; dx < room.w - 2; dx += 2) {
    setFeature(world, room.x + dx, deskY + 1, Feature.CHAIR);
  }
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + 1, Feature.LAMP);
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + room.h - 2, Feature.LAMP);

  addItemDrop(entities, nextId, room.x + 2, room.y + 2, 'ballot', 1);
  addItemDrop(entities, nextId, room.x + room.w - 3, room.y + 2, 'note', 1);
  addItemDrop(entities, nextId, room.x + 3, room.y + room.h - 2, 'blank_form', 1);

  const veraId = nextId.v;
  spawnAdminNpc(entities, nextId, VERA_DEF, 'vera_propuskova', room.x + Math.floor(room.w / 2), deskY - 1);
  spawnAdminNpc(entities, nextId, WAIT_REGISTRAR_DEF, 'permit_wait_registrar', room.x + 3, deskY - 1);
  spawnAdminNpc(entities, nextId, PAY_CLERK_DEF, 'permit_pay_clerk', room.x + 5, deskY - 1);
  spawnAdminNpc(entities, nextId, FORGER_DEF, 'permit_forger_fedya', room.x + room.w - 6, deskY - 1);
  spawnAdminNpc(
    entities, nextId, THREAT_CLERK_DEF, 'permit_threat_gleb',
    room.x + room.w - 4, deskY - 1, true, THREAT_CLERK_DEF.weapon,
  );
  spawnAdminNpc(entities, nextId, WITNESS_DUSYA_DEF, WITNESS_DUSYA_ID, room.x + 3, room.y + room.h - 3, false);
  spawnAdminNpc(entities, nextId, WITNESS_ARKADY_DEF, WITNESS_ARKADY_ID, room.x + room.w - 4, room.y + room.h - 3, false);

  const trayX = room.x + room.w - 2;
  const trayY = room.y + room.h - 2;
  setFeature(world, trayX, trayY, Feature.SHELF);
  addPermitIssueTray(world, room.id, trayX, trayY, veraId);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

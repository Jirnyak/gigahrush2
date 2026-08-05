/* ── Живой архив райсовета — Ministry archive/access POI ─────── */

import {
  ContainerKind,
  Feature,
  FloorLevel,
  Faction,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const POSTOVOY_FORMULYAR_ID = 'raionsovet_archive_postovoy_formulyar';

const MARFA_DEF: PlotNpcDef = {
  name: 'Марфа Паспортная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 80, speed: 0.75,
  inventory: [
    { defId: 'blank_form', count: 3 },
    { defId: 'archive_access_permit', count: 1 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Паспортный стол принимает живых, числящихся живыми.',
    'Два пустых бланка, и я выдам допуск к карточкам без ночной очереди.',
    'Пустой бланк не подписывайте. Подпись тут быстрее заявителя.',
    'Фальшивую печать архив слышит по скрипу. Иногда делает вид, что не слышит.',
    'Краденая карточка открывает ящик быстрее, чем закрывает дело.',
  ],
  talkLinesPost: [
    'Допуск выдан. Не сгибайте его у дверей.',
    'Если карточка пахнет мокрым бетоном, не называйте ее своей.',
  ],
};

const POSTOVOY_FORMULYAR_DEF: PlotNpcDef = {
  name: 'Постовой Формуляр',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'makarov',
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'denunciation', count: 1 },
  ],
  talkLines: [
    'Формуляр на посту. Руки держите поверх дела.',
    'Архив любит тишину, а я люблю, когда архив не зовет меня внутрь.',
  ],
  talkLinesPost: [
    'Дело закрыто? Тогда идите, пока оно не открылось заново.',
  ],
};

const IPPOLIT_DEF: PlotNpcDef = {
  name: 'Ипполит Подштампов',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 110, maxHp: 110, money: 55, speed: 0.7,
  inventory: [
    { defId: 'ink_bottle', count: 2 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'fake_pass', count: 1 },
  ],
  talkLines: [
    'Я не подделываю. Я уточняю печать до нужной правды.',
    'Чернила принесете — будет лист с печатью. Риск ваш, почерк мой.',
    'Охрана смотрит на цвет. Архив смотрит на страх.',
    'Липовый корешок годится до первого печатееда. Он нюхает не законность, а клей.',
  ],
  talkLinesPost: [
    'Печать похожа. Слишком похожа, поэтому не улыбайтесь.',
    'Если вас спросят, где взяли лист, скажите: он сам лег в папку.',
  ],
};

const KIRA_DEF: PlotNpcDef = {
  name: 'Кира Картотечная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 95, maxHp: 95, money: 35, speed: 0.85,
  inventory: [
    { defId: 'personal_file_copy', count: 1 },
    { defId: 'note', count: 3 },
  ],
  talkLines: [
    'Мне нужна карточка из служебного ящика. Не спрашивайте, чья.',
    'Если возьмете ее из картотеки без допуска, журнал назовет это кражей. Журнал любит точность.',
    'Вернете карточку — получите копию личного дела. Она иногда важнее ключа.',
    'Краденую карточку не читайте у полки. Полка может решить, что вы и есть приложение.',
  ],
  talkLinesPost: [
    'Карточка у меня. Теперь архив не знает, кого потерял.',
    'Копия дела ваша. Оригинал уже спорит со шкафом.',
  ],
};

const TIMUR_DEF: PlotNpcDef = {
  name: 'Тимур Недостача',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 240, maxHp: 240, money: 120, speed: 1.0,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'denunciation', count: 1 },
  ],
  talkLines: [
    'Я проверяю дела, которые пропали официально.',
    'Найдете пропавшее дело — вернете. Найдете акт о пропаже — покажете всем.',
    'Подделка ускоряет доступ. Потом ускоряет обыск.',
    'Дело живое, но без обложки не принимается. В руки берите обложкой наружу.',
  ],
  talkLinesPost: [
    'Недостача оформлена. Теперь виноват не коридор, а конкретный шкаф.',
    'Документы полезны, пока их не начали читать вслух.',
  ],
};

registerSideQuest('marfa_pasportnaya', MARFA_DEF, [
  {
    id: 'archive_obtain_permit',
    giverNpcId: 'marfa_pasportnaya',
    type: QuestType.FETCH,
    desc: 'Марфа Паспортная: «Два пустых бланка. Выдам допуск к архивной карточке без ночной очереди. Пустое не подписывать.»',
    targetItem: 'blank_form', targetCount: 2,
    rewardItem: 'archive_access_permit', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 1 }],
    relationDelta: 12, xpReward: 55, moneyReward: 65,
  },
]);

registerSideQuest('ippolit_podshtampov', IPPOLIT_DEF, [
  {
    id: 'archive_forge_stamp',
    giverNpcId: 'ippolit_podshtampov',
    type: QuestType.FETCH,
    desc: 'Ипполит Подштампов: «Две чернильницы. Сделаю лист с печатью, который почти не дрожит.»',
    targetItem: 'ink_bottle', targetCount: 2,
    rewardItem: 'forged_stamp_sheet', rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: 8, xpReward: 65, moneyReward: 45,
  },
]);

registerSideQuest('kira_kartotechnaya', KIRA_DEF, [
  {
    id: 'archive_steal_card',
    giverNpcId: 'kira_kartotechnaya',
    type: QuestType.FETCH,
    desc: 'Кира Картотечная: «Принесите краденую архивную карточку из служебной картотеки. Журнал заметит, зато полка перестанет выбирать владельца сама.»',
    targetItem: 'stolen_archive_card', targetCount: 1,
    rewardItem: 'personal_file_copy', rewardCount: 1,
    extraRewards: [{ defId: 'temp_pass', count: 1 }],
    relationDelta: 10, xpReward: 70, moneyReward: 90,
  },
]);

registerSideQuest('timur_nedostacha', TIMUR_DEF, [
  {
    id: 'archive_return_file',
    giverNpcId: 'timur_nedostacha',
    type: QuestType.FETCH,
    desc: 'Тимур Недостача: «Верните пропавшее личное дело. Пока оно пропало, виноват я, а шкаф ищет следующего.»',
    targetItem: 'missing_record_file', targetCount: 1,
    rewardItem: 'passport_stub', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 12, xpReward: 80, moneyReward: 110,
  },
  {
    id: 'archive_expose_missing_record',
    giverNpcId: 'timur_nedostacha',
    type: QuestType.FETCH,
    desc: 'Тимур Недостача: «Найдите акт о пропавшей записи. Пусть шкаф отвечает публично.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    rewardItem: 'permanent_pass', rewardCount: 1,
    relationDelta: 16, xpReward: 90, moneyReward: 140,
  },
]);

registerAuthoredNpc({
  id: POSTOVOY_FORMULYAR_ID,
  npc: POSTOVOY_FORMULYAR_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'raionsovet_archive', 'guard'],
});

function addArchiveContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
): void {
  const zoneId = world.zoneMap[world.idx(x, y)];
  world.addContainer({
    id: world.containers.length + 1,
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId,
    kind,
    name,
    inventory,
    capacitySlots: 8,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: true,
    tags,
  });
}

export function generateRaionsovetArchive(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Живой архив райсовета',
    w: 16, h: 11,
    minDist: 55, maxDist: 135,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_PARQUET,
  });
  if (!room) return { nextRoomId };

  const deskY = room.y + 3;
  const midX = room.x + Math.floor(room.w / 2);
  for (let dx = 2; dx < room.w - 2; dx++) setFeature(world, room.x + dx, deskY, Feature.DESK);
  for (let dx = 2; dx < room.w - 2; dx += 3) setFeature(world, room.x + dx, deskY + 1, Feature.CHAIR);
  for (let dy = 1; dy < room.h - 1; dy++) {
    if (dy === 3 || dy === 4) continue;
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  for (let dx = 4; dx < room.w - 3; dx += 4) {
    setFeature(world, room.x + dx, room.y + room.h - 3, Feature.SHELF);
  }
  setFeature(world, midX, room.y + 1, Feature.LAMP);
  setFeature(world, midX - 4, room.y + room.h - 2, Feature.LAMP);
  setFeature(world, midX + 4, room.y + room.h - 2, Feature.LAMP);
  world.wallTex[world.idx(midX, room.y - 1)] = Tex.POSTER_BASE + 2;
  world.wallTex[world.idx(room.x + room.w, deskY)] = Tex.PORTRAIT_BASE + 1;

  addItemDrop(entities, nextId, room.x + 2, room.y + 2, 'blank_form', 1);
  addItemDrop(entities, nextId, room.x + room.w - 3, room.y + 2, 'ink_bottle', 1);
  addItemDrop(entities, nextId, room.x + 3, room.y + room.h - 2, 'note', 1);

  spawnAdminNpc(entities, nextId, MARFA_DEF, 'marfa_pasportnaya', midX - 4, deskY - 1);
  spawnAdminNpc(entities, nextId, IPPOLIT_DEF, 'ippolit_podshtampov', midX - 1, deskY - 1);
  spawnAdminNpc(entities, nextId, KIRA_DEF, 'kira_kartotechnaya', midX + 2, deskY - 1);
  spawnAdminNpc(entities, nextId, TIMUR_DEF, 'timur_nedostacha', midX + 5, deskY - 1, true, 'makarov');
  spawnAdminNpc(entities, nextId, POSTOVOY_FORMULYAR_DEF, POSTOVOY_FORMULYAR_ID, room.x + room.w - 3, room.y + room.h - 2, false, 'makarov');

  addArchiveContainer(
    world, room.id, room.x + 1, room.y + 2,
    ContainerKind.FILING_CABINET,
    'Служебная картотека райсовета',
    'faction',
    [
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'missing_record_file', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
    ],
    [
      'archive',
      'archive_route',
      'inspection_archive',
      'raionsovet_archive',
      'liquidator_archive',
      'paper',
      'evidence',
      'audit',
      'theft',
    ],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, room.id, room.x + room.w - 2, room.y + 2,
    ContainerKind.SAFE,
    'Сейф паспортного стола',
    'locked',
    [
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'passport_stub', count: 1 },
      { defId: 'permanent_pass', count: 1 },
    ],
    ['archive', 'archive_route', 'raionsovet_archive', 'locked', 'permit'],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, room.id, room.x + room.w - 2, room.y + room.h - 3,
    ContainerKind.SECRET_STASH,
    'Тайник под мертвой буквой',
    'secret',
    [
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'fake_pass', count: 1 },
    ],
    ['archive', 'archive_route', 'raionsovet_archive', 'secret', 'forgery'],
  );

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

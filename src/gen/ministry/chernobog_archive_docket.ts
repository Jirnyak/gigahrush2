/* ── Досье ЧБ — Ministry Chernobog archive decisions ─────────── */

import { Faction, Occupation, QuestType, type Entity, type Room } from '../../core/types';
import { chernobogDocketQuestEventTags, chernobogDocketQuestRumorIds } from '../../data/chernobog_docket';
import { type PlotNpcDef, registerSideQuest, registerSideQuestSteps } from '../../data/plot';
import { type NextId, spawnAdminNpc } from '../admin_common';

function docketEvent(
  questId: string,
  itemId: string,
  branch: string,
  eventTargetName: string,
  eventPrivacy: 'public' | 'local' | 'secret' = 'local',
) {
  return {
    eventSeverity: 4 as const,
    eventPrivacy,
    eventTargetName,
    eventTags: chernobogDocketQuestEventTags(questId, itemId),
    eventData: { branch, rumorIds: chernobogDocketQuestRumorIds(questId, itemId) },
  };
}

const REGISTRAR_DEF: PlotNpcDef = {
  name: 'Валентина Входящая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 110, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'ЧБ - это не вера, это входящий номер. Вера у нас идет отдельной папкой.',
    'Сдайте схему ячеек официально. После этого свидетели станут строками, строки - тише.',
    'Центральная ячейка в форме есть. В здании ее никто не видел, и это очень удобно.',
  ],
  talkLinesPost: [
    'Дело принято. Теперь оно страшнее, потому что лежит правильно.',
    'Свидетели будут вызваны, если останутся свидетелями после правки.',
  ],
};

const COPYIST_DEF: PlotNpcDef = {
  name: 'Павел Копирочный',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 95, maxHp: 95, money: 90, speed: 0.8,
  inventory: [
    { defId: 'ink_bottle', count: 2 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Я не вру в документах. Я делаю им удобную походку.',
    'Правка показаний хороша тем, что уже призналась в правке.',
    'Принесите лист ЧБ, и свидетель увидит ровно то, что выдержит печать.',
  ],
  talkLinesPost: [
    'Копия готова. Оригинал теперь выглядит нервнее.',
    'Если спросят, кто правил, скажите: правку приняли по нижнему журналу.',
  ],
};

const BUYER_DEF: PlotNpcDef = {
  name: 'Семен Макулатурный',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 105, maxHp: 105, money: 260, speed: 0.75,
  inventory: [
    { defId: 'cigs', count: 3 },
    { defId: 'water_coupon', count: 1 },
    { defId: 'fake_pass', count: 1 },
  ],
  talkLines: [
    'Покупаю страшную бумагу как обычную. Доплата за живые фамилии.',
    'Акт изъятия ценится дороже идола: идол молчит, акт показывает, кто пришел за ним.',
    'Продадите - адреса уйдут туда, где очередь не спрашивает печать.',
  ],
  talkLinesPost: [
    'Сделка закрыта. Бумага теперь не ваша, зато слух уже ваш.',
    'Если акт начнет искать хозяина, я вас не видел.',
  ],
};

const KEEPER_DEF: PlotNpcDef = {
  name: 'Лидия Несвидетель',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90, maxHp: 90, money: 35, speed: 0.8,
  inventory: [
    { defId: 'emergency_roster', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Я прячу не культ. Я прячу людей, которых культ и архив делят по строкам.',
    'Индекс внешней ячейки нельзя читать в очереди. Очередь сразу ищет лишних.',
    'Отдадите мне - часть фамилий станет обычными фамилиями хотя бы до сирены.',
  ],
  talkLinesPost: [
    'Индекс спрятан. Теперь пусть ищут по фамилиям, а фамилии тут записаны как попало.',
    'Если меня спросят, я не свидетель. У меня даже справка есть.',
  ],
};

const LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Ротмистр Чистопис',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 280, maxHp: 280, money: 150, speed: 0.95,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 16 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'Памятку ЧБ сюда. Мы не спорим, существует ли причина. Мы проверяем адрес.',
    'Внешняя ячейка - это когда сосед еще сосед, но дверь уже пишет рапорт.',
    'Покажете memo - ликвидаторы пойдут по строкам. Это не всегда спасает строки.',
  ],
  talkLinesPost: [
    'Памятка принята. Адреса получили очередь на зачистку.',
    'Если кто спросит про Чернобога, ответ один: приказ не содержит бога.',
  ],
};

const CULT_CONTACT_DEF: PlotNpcDef = {
  name: 'Тихон Подстрочный',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PILGRIM,
  sprite: Occupation.PILGRIM,
  hp: 130, maxHp: 130, money: 40, speed: 0.9,
  inventory: [
    { defId: 'idol_chernobog', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Красные вымарывания иногда честнее черных. В красном еще видно, кто боялся.',
    'Центральная записка ничего не доказывает. Хорошие записки вообще ничего не доказывают.',
    'Покажите ее нам, и внешние перестанут ждать ответа от архива.',
  ],
  talkLinesPost: [
    'Записка услышана. Не прочитана - услышана.',
    'Теперь у внешних будет меньше вопросов и больше маршрутов.',
  ],
};

registerSideQuest('chernobog_docket_registrar', REGISTRAR_DEF, [
  {
    id: 'chernobog_submit_cell_map',
    giverNpcId: 'chernobog_docket_registrar',
    type: QuestType.FETCH,
    desc: 'Валентина Входящая: «Сдайте схему ячеек ЧБ-0 официально. Архив любит карту сильнее свидетеля.»',
    targetItem: 'chernobog_cell_map', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 1 }],
    relationDelta: 10, xpReward: 80, moneyReward: 160,
    ...docketEvent(
      'chernobog_submit_cell_map',
      'chernobog_cell_map',
      'ministry_submit',
      'Схема ячеек ЧБ-0 сдана в Министерство; свидетели стали приложением к делу.',
      'public',
    ),
  },
]);

registerSideQuest('chernobog_docket_copyist', COPYIST_DEF, [
  {
    id: 'chernobog_forge_witness_correction',
    giverNpcId: 'chernobog_docket_copyist',
    type: QuestType.FETCH,
    desc: 'Павел Копирочный: «Дайте правку показаний ЧБ. Сделаю копию, где свидетель боится по форме.»',
    targetItem: 'chernobog_witness_correction', targetCount: 1,
    rewardItem: 'forged_stamp_sheet', rewardCount: 1,
    extraRewards: [{ defId: 'ink_bottle', count: 1 }],
    relationDelta: 8, xpReward: 75, moneyReward: 80,
    ...docketEvent(
      'chernobog_forge_witness_correction',
      'chernobog_witness_correction',
      'witness_forged',
      'Правка показаний ЧБ ушла в подделку; свидетель теперь боится по форме.',
      'secret',
    ),
  },
]);

registerSideQuest('chernobog_docket_buyer', BUYER_DEF, [
  {
    id: 'chernobog_sell_confiscation_act',
    giverNpcId: 'chernobog_docket_buyer',
    type: QuestType.FETCH,
    desc: 'Семен Макулатурный: «Продайте акт изъятия черной ладони. Бумага уйдет на рынок, адреса - следом.»',
    targetItem: 'chernobog_confiscation_act', targetCount: 1,
    rewardItem: 'fake_pass', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: 10, xpReward: 70, moneyReward: 260,
    ...docketEvent(
      'chernobog_sell_confiscation_act',
      'chernobog_confiscation_act',
      'black_market_sale',
      'Акт изъятия черной ладони продан; адреса пошли по рынку без печати.',
    ),
  },
]);

registerSideQuest('chernobog_docket_keeper', KEEPER_DEF, [
  {
    id: 'chernobog_hide_external_index',
    giverNpcId: 'chernobog_docket_keeper',
    type: QuestType.FETCH,
    desc: 'Лидия Несвидетель: «Спрячьте индекс внешней ячейки у меня. Пусть фамилии поживут без графы.»',
    targetItem: 'chernobog_external_cell_index', targetCount: 1,
    rewardItem: 'emergency_roster', rewardCount: 1,
    extraRewards: [{ defId: 'bread', count: 2 }],
    relationDelta: 16, xpReward: 90, moneyReward: 55,
    ...docketEvent(
      'chernobog_hide_external_index',
      'chernobog_external_cell_index',
      'witness_hide',
      'Индекс внешней ячейки спрятан; часть фамилий исчезла из учетной опасности.',
      'secret',
    ),
  },
]);

registerSideQuest('chernobog_docket_liquidator', LIQUIDATOR_DEF, [
  {
    id: 'chernobog_show_liquidator_memo',
    giverNpcId: 'chernobog_docket_liquidator',
    type: QuestType.FETCH,
    desc: 'Ротмистр Чистопис: «Покажите памятку ликвидатора ЧБ. Адреса должны стать приказом, а не слухом.»',
    targetItem: 'chernobog_liquidator_memo', targetCount: 1,
    rewardItem: 'liquidator_token', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
    relationDelta: 18, xpReward: 95, moneyReward: 120,
    ...docketEvent(
      'chernobog_show_liquidator_memo',
      'chernobog_liquidator_memo',
      'liquidator_show',
      'Памятка ЧБ показана ликвидаторам; внешние адреса получили маршрут зачистки.',
    ),
  },
]);

registerSideQuest('chernobog_docket_cult_contact', CULT_CONTACT_DEF, [
  {
    id: 'chernobog_show_cult_contact',
    giverNpcId: 'chernobog_docket_cult_contact',
    type: QuestType.FETCH,
    desc: 'Тихон Подстрочный: «Покажите центральную записку. Не доказательство - направление взгляда.»',
    targetItem: 'chernobog_redacted_central_note', targetCount: 1,
    rewardItem: 'idol_chernobog', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: 18, xpReward: 90, moneyReward: 35,
    ...docketEvent(
      'chernobog_show_cult_contact',
      'chernobog_redacted_central_note',
      'cult_contact_show',
      'Центральная записка ЧБ показана культовому контакту; внешние получили новый маршрут.',
      'secret',
    ),
  },
]);

registerSideQuestSteps([
  {
    id: 'chernobog_show_yakov_redaction',
    giverNpcId: 'yakov',
    type: QuestType.FETCH,
    desc: 'Яков Давидович: «Покажите красную центральную записку ЧБ. Меня интересует не бог, а почему форма повторяет страх.»',
    targetItem: 'chernobog_redacted_central_note', targetCount: 1,
    rewardItem: 'psi_stabilizer', rewardCount: 1,
    extraRewards: [{ defId: 'antidep', count: 1 }],
    relationDelta: 14, xpReward: 110, moneyReward: 90,
    requiresPlotStepDone: 2,
    ...docketEvent(
      'chernobog_show_yakov_redaction',
      'chernobog_redacted_central_note',
      'yakov_show',
      'Яков получил красную центральную записку ЧБ и сравнил форму страха с приборами.',
    ),
  },
]);

export function spawnChernobogDocketHandlers(
  entities: Entity[],
  nextId: NextId,
  room: Room,
  gateX: number,
  cy: number,
): void {
  spawnAdminNpc(entities, nextId, REGISTRAR_DEF, 'chernobog_docket_registrar', room.x + 6, room.y + 1);
  spawnAdminNpc(entities, nextId, COPYIST_DEF, 'chernobog_docket_copyist', room.x + 6, cy + 2);
  spawnAdminNpc(entities, nextId, LIQUIDATOR_DEF, 'chernobog_docket_liquidator', gateX + 2, room.y + 1, true, 'makarov');
  spawnAdminNpc(entities, nextId, BUYER_DEF, 'chernobog_docket_buyer', gateX + 5, room.y + 1);
  spawnAdminNpc(entities, nextId, KEEPER_DEF, 'chernobog_docket_keeper', gateX + 2, room.y + room.h - 2);
  spawnAdminNpc(entities, nextId, CULT_CONTACT_DEF, 'chernobog_docket_cult_contact', gateX + 5, room.y + room.h - 2);
}

/* ── AG62 NII slime sample post: field containers and liability ─ */

import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { genLog } from '../log';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const ROOM_NAME = 'Полевой пост НИИ: тара и ответственность';
const CONTENT_TAG = 'ag62_nii_sample_post';
const SAMPLE_ITEM = 'slime_sample_brown';
const BROWN_LABEL_ITEM = 'slime_age_label_brown';
const GREEN_SAMPLE_ITEM = 'slime_sample_green';
const RED_SAMPLE_ITEM = 'slime_sample_red';
const BLUE_SAMPLE_ITEM = 'slime_sample_blue';
const SILVER_SAMPLE_ITEM = 'slime_sample_silver';
const CONTAMINATED_SAMPLE_ITEM = 'slime_sample_contaminated';
const EMPTY_CONTAINER_ITEM = 'nii_sample_container';
const CLEANUP_ACT_ITEM = 'brown_slime_cleanup_act';
const PROTECTIVE_APRON_ITEM = 'protective_apron';
const BROWN_CLEANUP_LEAD_QUEST = 'ag84_nii_brown_cleanup_lead';
const SCIENCE_QUEST = 'ag62_nii_science_return';
const LIQUIDATOR_QUEST = 'ag62_nii_liquidator_burn';
const MARKET_QUEST = 'ag62_nii_market_sale';
const REPORT_QUEST = 'ag62_nii_report_unsealed';
const HIDE_QUEST = 'ag62_nii_hide_unsealed';
const RETURN_EVENT_TAG = 'ag62_sample_return';

const SAMPLE_BRANCH_QUESTS = [SCIENCE_QUEST, LIQUIDATOR_QUEST, MARKET_QUEST, REPORT_QUEST, HIDE_QUEST] as const;

function branchBlockers(current: string): string[] {
  return SAMPLE_BRANCH_QUESTS.filter(id => id !== current);
}

const BOKOVA_ID = 'ag62_nii_bokova';
const LIQUIDATOR_ID = 'ag62_nii_sereda';
const MARKET_ID = 'ag62_nii_senya';

const BOKOVA_DEF: PlotNpcDef = {
  name: 'Инженер Бокова',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 120, maxHp: 120, money: 95, speed: 0.95,
  inventory: [
    { defId: EMPTY_CONTAINER_ITEM, count: 2 },
    { defId: PROTECTIVE_APRON_ITEM, count: 1 },
    { defId: 'filter_layer', count: 2 },
    { defId: 'seal_wax', count: 1 },
  ],
  talkLines: [
    'Инженер Бокова, НИИ слизи. Пост полевой, поэтому чистым считается всё, что ещё подписывается.',
    'Пустую тару продаю по журналу и форме 728/01-Д. Бесплатная банка бывает только с ответственностью за содержимое.',
    'Коричневую пробу сдаёшь мне - НИИ получает факт. Отдаёшь ликвидаторам - факт горит. Несёшь на рынок - факт дорожает.',
    'Доступ согласован завинститутом: ни одна банка не открывается в жилой зоне, даже если она прозрачная и выглядит пустой.',
    'Сорванную пломбу не чинят словами. Её либо сдаёшь рапортом, либо прячешь и живёшь с тем, что запах записал тебя первым.',
  ],
  talkLinesPost: [
    'Проба принята. Если она начнёт пахнуть фамилией, это уже не моя смена.',
    'Следующую тару не вскрывай в коридоре. Коридор не указан как лаборатория.',
  ],
};

const SEREDA_DEF: PlotNpcDef = {
  name: 'Сержант Середа',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 170, maxHp: 170, money: 70, speed: 1.05,
  inventory: [
    { defId: 'ammo_fuel', count: 2 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'makarov', count: 1 },
  ],
  talkLines: [
    'Середа. Приставлен к НИИ, чтобы наука не перепутала любопытство с эвакуацией.',
    'Проба нужна? Нужна. Но если она шевелится, я голосую горелкой, а не протоколом.',
    'Черная масса не одна проба, сколько бы банок Бокова ни поставила на стол.',
    'Сдашь пломбу мне — получишь фильтр и топливо. Учёные обидятся бумажно, рынок обидится денежно.',
    'Красная липнет, зелёная ест, голубая светит, чёрная множится. Всё это хорошо смотрится только из печи.',
  ],
  talkLinesPost: [
    'Пломбу списали под прожиг. Если НИИ спросит, я видел только нарушение хранения.',
    'Банки не жалко. Людей жалко, когда они начинают банкам верить.',
  ],
};

const SENYA_DEF: PlotNpcDef = {
  name: 'Сеня Пробирка',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 95, maxHp: 95, money: 180, speed: 1.0,
  inventory: [
    { defId: 'cigs', count: 5 },
    { defId: 'forged_permit_slip', count: 1 },
    { defId: EMPTY_CONTAINER_ITEM, count: 1 },
  ],
  talkLines: [
    'Сеня Пробирка. Я тут не рынок, я временное окно без вывески.',
    'Запечатанная проба стоит дороже, пока её не назвали уликой. Пломбу не трогай, цену не порть.',
    'Учёным достанется вывод, ликвидаторам дым, а тебе могут достаться деньги. Риск входит в тару.',
    'Кривую пробу можно спрятать под актом. Только не называй это хранением, а то акт обидится и найдёт свидетеля.',
  ],
  talkLinesPost: [
    'Проба ушла без накладной. Значит, накладная никого не предала.',
    'Если спросят, мы торговали пустыми банками и плохими советами.',
  ],
};

registerSideQuest(BOKOVA_ID, BOKOVA_DEF, [
  {
    id: BROWN_CLEANUP_LEAD_QUEST,
    giverNpcId: BOKOVA_ID,
    type: QuestType.FETCH,
    desc: 'Бокова: «Начни с сухого обхода: принеси акт зачистки токсичной коричневой слизи. Там же возьми пломбированную пробу, если решишь спорить с наукой, печью или рынком.»',
    targetItem: CLEANUP_ACT_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.PRODUCTION,
    targetZoneTag: 'brown_slime_cleanup',
    targetHint: 'Коллекторы: сухой обход с коричневым налётом. Акт лежит рядом с комплектом зачистки; проба нужна для сдачи, прожига или тихой продажи.',
    rewardItem: EMPTY_CONTAINER_ITEM, rewardCount: 1,
    extraRewards: [{ defId: 'filter_layer', count: 1 }, { defId: 'seal_wax', count: 1 }],
    relationDelta: 8, xpReward: 55, moneyReward: 45,
    eventTargetName: 'Акт зачистки слизи принят на посту НИИ',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['slime_chain', 'nii', 'cleanup', 'brown_slime', 'sample_lead', 'seal'],
    eventData: {
      route: 'post_cleanup_sample_branch',
      nextItems: [SAMPLE_ITEM, EMPTY_CONTAINER_ITEM],
      branch: ['science', 'liquidator_burn', 'black_market'],
    },
  },
  {
    id: SCIENCE_QUEST,
    giverNpcId: BOKOVA_ID,
    type: QuestType.FETCH,
    desc: 'Бокова: «Теперь принеси коричневую пробу в пломбе и не вскрывай банку в жилой зоне. НИИ запишет её как факт, а тебя как ответственного за факт.»',
    targetItem: SAMPLE_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'nii_sample_post',
    targetHint: 'Коллекторы: коричневая проба из сухого обхода или выданной тары. Не вскрывать пломбу до поста НИИ.',
    rewardItem: EMPTY_CONTAINER_ITEM, rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 1 }],
    relationDelta: 12, xpReward: 70, moneyReward: 90,
    requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
    blockedBySideQuestIds: branchBlockers(SCIENCE_QUEST),
    abandonsSideQuestIds: branchBlockers(SCIENCE_QUEST),
    eventTags: ['slime_chain', 'nii', 'science', 'sample_return', 'sealed', 'brown_slime'],
    eventData: { branch: 'deliver_to_nii', sealed: true, rumorIds: ['nii_sample_choice_route'] },
  },
  {
    id: REPORT_QUEST,
    giverNpcId: BOKOVA_ID,
    type: QuestType.FETCH,
    desc: 'Бокова: «Если пломба уже кривая, несите заражённую пробу как нарушение хранения. Награда меньше, зато НИИ пишет рапорт, а не розыск банки.»',
    targetItem: CONTAMINATED_SAMPLE_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'nii_sample_post',
    targetHint: 'Коллекторы: полевой пост НИИ. Криво запечатанную пробу сдавать Боковой по рапорту, не продавать как чистую.',
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'seal_wax', count: 1 }],
    relationDelta: 7, xpReward: 55, moneyReward: 55,
    requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
    blockedBySideQuestIds: branchBlockers(REPORT_QUEST),
    abandonsSideQuestIds: branchBlockers(REPORT_QUEST),
    eventTags: ['slime_chain', 'nii', 'report', 'sample_return', 'unsealed', 'contaminated'],
    eventData: { branch: 'report_unsealed', sealed: false, rumorIds: ['nii_sample_hide_or_report'] },
  },
]);

registerSideQuest(LIQUIDATOR_ID, SEREDA_DEF, [{
  id: LIQUIDATOR_QUEST,
  giverNpcId: LIQUIDATOR_ID,
  type: QuestType.FETCH,
  desc: 'Середа: «Ту же коричневую пробу отдашь мне. Запишем как опасный остаток и сожжём без научной гордости.»',
  targetItem: SAMPLE_ITEM, targetCount: 1,
  targetFloor: FloorLevel.MAINTENANCE,
  targetRoomType: RoomType.MEDICAL,
  targetZoneTag: 'nii_sample_post',
  targetHint: 'Коллекторы: после акта зачистки забери коричневую пробу и отдай ликвидатору на посту НИИ или неси дальше к печи.',
  rewardItem: 'ammo_fuel', rewardCount: 2,
  extraRewards: [{ defId: 'gasmask_filter', count: 1 }],
  requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
  blockedBySideQuestIds: branchBlockers(LIQUIDATOR_QUEST),
  abandonsSideQuestIds: branchBlockers(LIQUIDATOR_QUEST),
  relationDelta: 10, xpReward: 65, moneyReward: 70,
  eventTags: ['slime_chain', 'liquidator', 'burn', 'sample_return', 'brown_slime'],
  eventData: { branch: 'burn_liquidator', sealed: true, rumorIds: ['nii_sample_choice_route'] },
}]);

registerSideQuest(MARKET_ID, SENYA_DEF, [
  {
    id: MARKET_QUEST,
    giverNpcId: MARKET_ID,
    type: QuestType.FETCH,
    desc: 'Сеня: «Пробу мне, пломбу целой. В журнале будет недостача, у тебя — деньги и лишний повод не задерживаться.»',
    targetItem: SAMPLE_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'nii_sample_post',
    targetHint: 'Коллекторы: коричневая проба после сухого обхода. Для рынка важна целая пломба и отсутствие лишних свидетелей.',
    rewardItem: 'forged_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 4 }],
    requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
    blockedBySideQuestIds: branchBlockers(MARKET_QUEST),
    abandonsSideQuestIds: branchBlockers(MARKET_QUEST),
    relationDelta: 6, xpReward: 60, moneyReward: 140,
    eventTags: ['slime_chain', 'black_market', 'sell', 'sample_return', 'brown_slime', 'contraband'],
    eventData: { branch: 'sell_black_market', sealed: true, rumorIds: ['nii_sample_choice_route'] },
  },
  {
    id: HIDE_QUEST,
    giverNpcId: MARKET_ID,
    type: QuestType.FETCH,
    desc: 'Сеня: «Кривую пробу можно не продавать, а спрятать под липовым актом. Денег меньше, зато НИИ ищет бумагу, а не тебя.»',
    targetItem: CONTAMINATED_SAMPLE_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'nii_sample_post',
    targetHint: 'Коллекторы: криво запечатанную пробу можно скрыть у Сени на полевом посту, если не хочешь рапорт Боковой.',
    rewardItem: 'nii_forged_audit', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
    blockedBySideQuestIds: branchBlockers(HIDE_QUEST),
    abandonsSideQuestIds: branchBlockers(HIDE_QUEST),
    relationDelta: 3, xpReward: 45, moneyReward: 80,
    eventTags: ['slime_chain', 'black_market', 'hide', 'concealment', 'sample_return', 'unsealed', 'contaminated'],
    eventData: { branch: 'hide_unsealed', sealed: false, rumorIds: ['nii_sample_hide_or_report'] },
  },
]);

const RETURN_ENDPOINTS: Record<string, { endpoint: string; label: string; faction: Faction; item: string }> = {
  [SCIENCE_QUEST]: {
    endpoint: 'science',
    label: 'Проба сдана НИИ по журналу',
    faction: Faction.SCIENTIST,
    item: SAMPLE_ITEM,
  },
  [LIQUIDATOR_QUEST]: {
    endpoint: 'liquidator',
    label: 'Проба передана ликвидаторам под прожиг',
    faction: Faction.LIQUIDATOR,
    item: SAMPLE_ITEM,
  },
  [MARKET_QUEST]: {
    endpoint: 'black_market',
    label: 'Проба ушла на рынок без накладной',
    faction: Faction.WILD,
    item: SAMPLE_ITEM,
  },
  [REPORT_QUEST]: {
    endpoint: 'report',
    label: 'Кривая пломба ушла в рапорт НИИ',
    faction: Faction.SCIENTIST,
    item: CONTAMINATED_SAMPLE_ITEM,
  },
  [HIDE_QUEST]: {
    endpoint: 'hide',
    label: 'Кривая проба скрыта под липовым актом',
    faction: Faction.WILD,
    item: CONTAMINATED_SAMPLE_ITEM,
  },
};

function handleSampleReturn(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed' || event.tags.includes(RETURN_EVENT_TAG)) return;
  const sideQuestId = event.data?.sideQuestId;
  if (typeof sideQuestId !== 'string') return;
  const endpoint = RETURN_ENDPOINTS[sideQuestId];
  if (!endpoint) return;

  publishEvent(state, {
    type: 'quest_completed',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: endpoint.faction,
    targetName: endpoint.label,
    itemId: endpoint.item,
    itemCount: 1,
    severity: 4,
    privacy: 'local',
    tags: [RETURN_EVENT_TAG, CONTENT_TAG, 'nii', 'slime', 'sample', 'returned', endpoint.endpoint],
    data: {
      sideQuestId,
      endpoint: endpoint.endpoint,
      sourceEventId: event.id,
      sampleItem: endpoint.item,
    },
  });
}

registerWorldEventObserver(handleSampleReturn);

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id)) id++;
  return id;
}

function addContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): void {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  openTile(ctx.world, wx, wy, room.floorTex);
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
}

function dressPost(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(ctx.world, room.x + dx, room.y + 2, Feature.APPARATUS);
  }
  for (let dx = 3; dx < room.w - 3; dx += 4) {
    setFeature(ctx.world, room.x + dx, room.y + room.h - 3, Feature.CHAIR);
  }
  setFeature(ctx.world, room.x + 3, room.y + 5, Feature.DESK);
  setFeature(ctx.world, room.x + 4, room.y + 5, Feature.SCREEN);
  setFeature(ctx.world, room.x + 8, room.y + 6, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 6, room.y + 4, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 4, room.y + room.h - 4, Feature.MACHINE);
  setWater(ctx.world, room.x + 1, room.y + room.h - 2);
  setWater(ctx.world, room.x + room.w - 2, room.y + room.h - 2);
}

function addSampleContainers(ctx: MaintContentCtx, room: Room, ownerNpcId: number): void {
  addContainer(ctx, room, room.x + 2, room.y + room.h - 4, {
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Выдачный ящик порожней тары НИИ',
    inventory: [
      { defId: EMPTY_CONTAINER_ITEM, count: 1 },
      { defId: SAMPLE_ITEM, count: 1 },
      { defId: 'filter_layer', count: 1 },
    ],
    capacitySlots: 7,
    faction: Faction.SCIENTIST,
    access: 'public',
    discovered: true,
    tags: [CONTENT_TAG, 'nii', 'slime', 'sample', 'equipment', 'public', 'issue'],
  });

  addContainer(ctx, room, room.x + room.w - 3, room.y + 3, {
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Шкаф проб Боковой, форма 728/01-Д',
    inventory: [
      { defId: GREEN_SAMPLE_ITEM, count: 1 },
      { defId: RED_SAMPLE_ITEM, count: 1 },
      { defId: BLUE_SAMPLE_ITEM, count: 1 },
      { defId: SILVER_SAMPLE_ITEM, count: 1 },
      { defId: CONTAMINATED_SAMPLE_ITEM, count: 1 },
      { defId: BROWN_LABEL_ITEM, count: 3 },
      { defId: EMPTY_CONTAINER_ITEM, count: 1 },
      { defId: PROTECTIVE_APRON_ITEM, count: 1 },
      { defId: 'seal_wax', count: 2 },
    ],
    capacitySlots: 10,
    ownerNpcId,
    ownerName: BOKOVA_DEF.name,
    faction: Faction.SCIENTIST,
    access: 'owner',
    discovered: true,
    tags: [CONTENT_TAG, 'nii', 'slime', 'sample', 'equipment', 'theft', 'science', 'contraband', 'unsealed_risk'],
  });
}

export function generateSlimeSamplePost(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 28, 15, 85, 210);
  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.MEDICAL,
    pos.x, pos.y, 25, 13,
    ROOM_NAME,
    Tex.METAL, Tex.F_TILE,
  );

  for (const doorIdx of room.doors) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
  dressPost(ctx, room);

  const bokovaId = ctx.nextId.v;
  spawnPlotNpc(ctx, BOKOVA_ID, BOKOVA_DEF, room.x + 5, room.y + 7, Math.PI);
  spawnPlotNpc(ctx, LIQUIDATOR_ID, SEREDA_DEF, room.x + 17, room.y + 5, -Math.PI / 2, {
    weapon: 'makarov',
  });
  spawnPlotNpc(ctx, MARKET_ID, SENYA_DEF, room.x + 19, room.y + 9, Math.PI / 2);

  addSampleContainers(ctx, room, bokovaId);
  dropItems(ctx, room, ['sealant_tube', 'inspection_mirror', 'water', 'note']);

  genLog(`[AG62_NII_SAMPLE] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
}

/* -- AG81 compromised liquidator: proof route and faction choice -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  msg,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { publishEvent, getRecentEvents, registerWorldEventObserver } from '../../systems/events';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const DEFECTOR_ID = 'ag81_mitya_defector';
const DUTY_ID = 'ag81_rogozha_duty';
const RADIO_ID = 'ag81_lida_wire';
const CULT_ID = 'ag81_senya_blackhand';
const HARDLINER_ID = 'ag81_terekh_hardliner';

const ROUTE_QUEST = 'ag81_find_hidden_supply';
const PROTECT_QUEST = 'ag81_protect_defector';
const REPORT_QUEST = 'ag81_report_defector';
const INFORMANT_QUEST = 'ag81_recruit_informant';
const CULT_QUEST = 'ag81_hand_to_cult';
const KILL_QUEST = 'ag81_kill_and_loot';
const BRANCH_QUEST_IDS = [PROTECT_QUEST, REPORT_QUEST, INFORMANT_QUEST, CULT_QUEST, KILL_QUEST];
const RESOLUTION_TAG = 'ag81_defector_resolved';
const HIDDEN_ROOM = 'Срывной тайник ликвидатора: приказ без подписи';
const DEADLINE_HOURS = 18 * 60;
const BRANCH_HOURS = 12 * 60;

const DEFECTOR_DEF: PlotNpcDef = {
  name: 'Митька Сорванный',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 190, maxHp: 190, money: 24, speed: 1.05,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'liquidator_token', count: 1 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Митька. Ликвидатор. Приказ был простой, пока в нем не проступила чужая ладонь.',
    'В тайнике лежит сорванный запас. Я не помню, спрятал его от культа или для культа.',
    'Если доложишь Рогоже, я вернусь в строй или в подвал. Если промолчишь, я хотя бы посплю без рации.',
  ],
  talkLinesPost: [
    'Руки дрожат меньше. Это не значит, что я чистый.',
    'Если услышишь мой позывной в тумане, не отвечай сразу.',
  ],
};

const DUTY_DEF: PlotNpcDef = {
  name: 'Старшина Рогожа',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 230, maxHp: 230, money: 85, speed: 0.95,
  inventory: [
    { defId: 'ammo_762tt', count: 12 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Рогожа. Людей в строй возвращают рапортом, а не жалостью.',
    'Черная ладонь на приказе - это не мистика. Это повод вскрыть чей-то шкаф.',
  ],
  talkLinesPost: [
    'Сомнение принято к учету. Дальше им займется караул.',
  ],
};

const RADIO_DEF: PlotNpcDef = {
  name: 'Лида Проволочная',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.ELECTRICIAN,
  sprite: Occupation.ELECTRICIAN,
  hp: 120, maxHp: 120, money: 40, speed: 1.0,
  inventory: [
    { defId: 'radio', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ],
  talkLines: [
    'Я слышала Митькин позывной на культовой частоте. Он не молился. Он просил, чтобы ему приказали обратно.',
    'Жетон с царапиной можно пустить в эфир как крючок. Живой информатор полезнее мертвого рапорта.',
  ],
  talkLinesPost: [
    'Канал шипит его дыханием. Значит, пока он наш, а не их.',
  ],
};

const CULT_DEF: PlotNpcDef = {
  name: 'Сеня Черноладный',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PILGRIM,
  sprite: Occupation.PILGRIM,
  hp: 135, maxHp: 135, money: 33, speed: 1.0,
  inventory: [
    { defId: 'holy_water', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Не кричи. Уставшие лучше слышат Чернобога, потому что уже перестали слушать начальство.',
    'Дай мне его жетон. Мы не заберем Митьку силой. Мы дадим ему причину не возвращаться.',
  ],
  talkLinesPost: [
    'Ладонь закрылась. Теперь приказ будет искать другую руку.',
  ],
};

const HARDLINER_DEF: PlotNpcDef = {
  name: 'Терех Зачистной',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 210, maxHp: 210, money: 58, speed: 1.1,
  inventory: [
    { defId: 'tt_pistol', count: 1 },
    { defId: 'ammo_762tt', count: 10 },
  ],
  talkLines: [
    'Компромисс с культом кончается дырой в спине. Митька устал - значит, стал дырой.',
    'Если он уже меченый, жетон снимешь с тела. Лишних слов не надо.',
  ],
  talkLinesPost: [
    'Зачистка тише рапорта. Иногда это вся разница.',
  ],
};

function branchBlockers(id: string): string[] {
  return BRANCH_QUEST_IDS.filter(qid => qid !== id);
}

registerSideQuest(DEFECTOR_ID, DEFECTOR_DEF, [
  {
    id: ROUTE_QUEST,
    giverNpcId: DEFECTOR_ID,
    type: QuestType.VISIT,
    desc: 'Митька: «Проверь мой срывной тайник {dir}. Там приказ, пайка и знак ладони. Если не вернешься до смены караула, меня заберут без тебя.»',
    targetRoomName: HIDDEN_ROOM,
    rewardItem: 'note', rewardCount: 1,
    extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
    relationDelta: 2, xpReward: 35, moneyReward: 20,
    failOnNpcDeathPlotId: DEFECTOR_ID,
    timeLimitMinutes: DEADLINE_HOURS,
    eventTargetName: 'Найден срывной тайник ликвидатора с черной ладонью и сорванным приказом.',
    eventSeverity: 4,
    eventTags: ['ag81', 'defector', 'hidden_supply', 'black_hand'],
    eventData: { ag81: true, route: 'hidden_supply', rumorIds: ['faction_chernobog_archive_evidence'] },
  },
  {
    id: PROTECT_QUEST,
    giverNpcId: DEFECTOR_ID,
    type: QuestType.FETCH,
    desc: 'Митька: «Верни мне жетон из тайника. Я спрячу царапину и выйду в караул сам, пока Рогожа не прочитал приказ.»',
    targetItem: 'liquidator_token', targetCount: 1,
    rewardItem: 'bandage', rewardCount: 2,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: -3, xpReward: 65, moneyReward: 30,
    requiresSideQuestDone: ROUTE_QUEST,
    blockedBySideQuestIds: BRANCH_QUEST_IDS,
    abandonsSideQuestIds: branchBlockers(PROTECT_QUEST),
    failOnNpcDeathPlotId: DEFECTOR_ID,
    timeLimitMinutes: BRANCH_HOURS,
    eventTargetName: 'Компрометирующий жетон возвращен Митьке; сомнение скрыто от караула.',
    eventSeverity: 4,
    eventTags: ['ag81', 'defector', 'protect', 'concealment'],
    eventData: { ag81Outcome: 'protect', rumorIds: ['faction_liquidator_patrol'] },
  },
]);

registerSideQuest(DUTY_ID, DUTY_DEF, [{
  id: REPORT_QUEST,
  giverNpcId: DUTY_ID,
  type: QuestType.FETCH,
  desc: 'Рогожа: «Неси жетон с царапиной. Вернем Митьку в строй под надзором, а культовый след - в отдельный ящик.»',
  targetItem: 'liquidator_token', targetCount: 1,
  rewardItem: 'ammo_9mm', rewardCount: 14,
  extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
  relationDelta: 12, xpReward: 75, moneyReward: 90,
  requiresSideQuestDone: ROUTE_QUEST,
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(REPORT_QUEST),
  failOnNpcDeathPlotId: DEFECTOR_ID,
  timeLimitMinutes: BRANCH_HOURS,
  eventTargetName: 'Митьку Сорванного вернули в строй под ликвидаторский надзор.',
  eventSeverity: 4,
  eventPrivacy: 'public',
  eventTags: ['ag81', 'defector', 'report', 'liquidator'],
  eventData: { ag81Outcome: 'report', rumorIds: ['faction_liquidator_ammo'] },
}]);

registerSideQuest(RADIO_ID, RADIO_DEF, [{
  id: INFORMANT_QUEST,
  giverNpcId: RADIO_ID,
  type: QuestType.FETCH,
  desc: 'Лида: «Отдай жетон мне. Я заведу Митьку как живой провод: пусть культ думает, что он уже их человек.»',
  targetItem: 'liquidator_token', targetCount: 1,
  rewardItem: 'radio', rewardCount: 1,
  extraRewards: [{ defId: 'gasmask_filter', count: 1 }],
  relationDelta: 10, xpReward: 90, moneyReward: 40,
  requiresSideQuestDone: ROUTE_QUEST,
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(INFORMANT_QUEST),
  failOnNpcDeathPlotId: DEFECTOR_ID,
  timeLimitMinutes: BRANCH_HOURS,
  eventTargetName: 'Митька завербован как живой информатор против чернобожников.',
  eventSeverity: 4,
  eventTags: ['ag81', 'defector', 'informant', 'cult'],
  eventData: { ag81Outcome: 'informant', rumorIds: ['faction_chernobog_recruitment'] },
}]);

registerSideQuest(CULT_ID, CULT_DEF, [{
  id: CULT_QUEST,
  giverNpcId: CULT_ID,
  type: QuestType.FETCH,
  desc: 'Сеня: «Жетон сдай мне. Митька сам решит, как уходить, но дорогу к нему больше не найдет караул.»',
  targetItem: 'liquidator_token', targetCount: 1,
  rewardItem: 'holy_water', rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 3 }],
  relationDelta: 14, xpReward: 85, moneyReward: 55,
  requiresSideQuestDone: ROUTE_QUEST,
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(CULT_QUEST),
  failOnNpcDeathPlotId: DEFECTOR_ID,
  timeLimitMinutes: BRANCH_HOURS,
  eventTargetName: 'Жетон Митьки передан внешней ячейке чернобожников.',
  eventSeverity: 4,
  eventPrivacy: 'secret',
  eventTags: ['ag81', 'defector', 'cult', 'handoff'],
  eventData: { ag81Outcome: 'cult_handoff', rumorIds: ['faction_cultist_after_fog'] },
}]);

registerSideQuest(HARDLINER_ID, HARDLINER_DEF, [{
  id: KILL_QUEST,
  giverNpcId: HARDLINER_ID,
  type: QuestType.KILL,
  desc: 'Терех: «Убей Митьку и забери, что выпадет. Если человек уже слушает ладонь, рапорт только пачкает стол.»',
  targetPlotNpcId: DEFECTOR_ID,
  killNeeded: 1,
  rewardItem: 'ammo_762tt', rewardCount: 12,
  extraRewards: [{ defId: 'bandage', count: 1 }],
  relationDelta: 6, xpReward: 80, moneyReward: 70,
  requiresSideQuestDone: ROUTE_QUEST,
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(KILL_QUEST),
  timeLimitMinutes: BRANCH_HOURS,
  eventTargetName: 'Митька Сорванный убит; его жетон и пайка остались добычей.',
  eventSeverity: 4,
  eventPrivacy: 'local',
  eventTags: ['ag81', 'defector', 'kill', 'loot'],
  eventData: { ag81Outcome: 'kill_loot', rumorIds: ['player_kills_monsters'] },
}]);

interface OutcomeEffect {
  id: string;
  message: string;
  tags: string[];
  rumorIds: string[];
  deltas: { faction: Faction; delta: number }[];
}

const OUTCOMES: Partial<Record<string, OutcomeEffect>> = {
  [PROTECT_QUEST]: {
    id: 'protected',
    message: 'Митька остался в строю без рапорта. Ликвидаторы недосчитались правды, жильцы получили должника.',
    tags: ['protect', 'concealment'],
    rumorIds: ['faction_liquidator_patrol'],
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: -8 },
      { faction: Faction.CITIZEN, delta: 5 },
      { faction: Faction.CULTIST, delta: -4 },
    ],
  },
  [REPORT_QUEST]: {
    id: 'reported',
    message: 'Рогожа забрал жетон. Митьку вернули на пост под надзором, культовый след ушел в ликвидаторский ящик.',
    tags: ['report', 'liquidator'],
    rumorIds: ['faction_liquidator_ammo'],
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: 8 },
      { faction: Faction.CULTIST, delta: -8 },
    ],
  },
  [INFORMANT_QUEST]: {
    id: 'informant',
    message: 'Лида пустила Митькин страх в эфир. Теперь он информатор, а не тело в рапорте.',
    tags: ['informant', 'wire'],
    rumorIds: ['faction_chernobog_recruitment'],
    deltas: [
      { faction: Faction.SCIENTIST, delta: 8 },
      { faction: Faction.LIQUIDATOR, delta: 3 },
      { faction: Faction.CULTIST, delta: -10 },
    ],
  },
  [CULT_QUEST]: {
    id: 'cult_handoff',
    message: 'Сеня унес жетон к чернобожникам. Митьке оставили не свободу, а другой повод подчиняться.',
    tags: ['cult', 'handoff'],
    rumorIds: ['faction_cultist_after_fog'],
    deltas: [
      { faction: Faction.CULTIST, delta: 10 },
      { faction: Faction.LIQUIDATOR, delta: -12 },
      { faction: Faction.SCIENTIST, delta: -4 },
    ],
  },
  [KILL_QUEST]: {
    id: 'kill_loot',
    message: 'Терех получил тишину вместо ответа. Митькин запас теперь добыча, а сомнение списано пулей.',
    tags: ['kill', 'loot'],
    rumorIds: ['faction_liquidator_patrol'],
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: -4 },
      { faction: Faction.CULTIST, delta: 2 },
    ],
  },
};

const DELAY_OUTCOME: OutcomeEffect = {
  id: 'delayed',
  message: 'Смена караула прошла без решения. Митьку увели, а черная ладонь осталась в слухах.',
  tags: ['delay', 'failure'],
  rumorIds: ['faction_chernobog_archive_evidence'],
  deltas: [
    { faction: Faction.LIQUIDATOR, delta: -5 },
    { faction: Faction.CULTIST, delta: 4 },
  ],
};

const VIOLENCE_OUTCOME: OutcomeEffect = {
  id: 'uncommissioned_kill',
  message: 'Митьку убили без решения. Его вещи можно забрать, но караул запомнил не только жетон.',
  tags: ['kill', 'violence'],
  rumorIds: ['faction_liquidator_patrol'],
  deltas: [
    { faction: Faction.LIQUIDATOR, delta: -12 },
    { faction: Faction.CULTIST, delta: 4 },
  ],
};

function relationDeltas(effect: OutcomeEffect): Record<string, number> {
  const out: Record<string, number> = {};
  for (const delta of effect.deltas) out[Faction[delta.faction]] = delta.delta;
  return out;
}

function hasResolution(state: GameState, currentSideQuestId?: string): boolean {
  if (getRecentEvents(state, { tags: [RESOLUTION_TAG], limit: 1 }).length > 0) return true;
  return state.quests.some(q => (
    q.sideQuestId !== undefined &&
    q.sideQuestId !== currentSideQuestId &&
    OUTCOMES[q.sideQuestId] !== undefined &&
    q.done &&
    !q.failed
  ));
}

function applyOutcome(state: GameState, effect: OutcomeEffect, sideQuestId?: string): void {
  if (hasResolution(state, sideQuestId)) return;
  for (const delta of effect.deltas) addFactionRelMutual(Faction.PLAYER, delta.faction, delta.delta);
  publishEvent(state, {
    type: 'faction_relation_changed',
    actorName: 'Развилка Митьки',
    actorFaction: Faction.LIQUIDATOR,
    targetName: effect.message,
    severity: 4,
    privacy: effect.id === 'cult_handoff' ? 'secret' : 'local',
    tags: ['ag81', 'defector', 'outcome', RESOLUTION_TAG, 'faction_event', ...effect.tags].slice(0, 8),
    data: {
      sideQuestId,
      outcomeId: effect.id,
      rumorIds: effect.rumorIds,
      relationDeltas: relationDeltas(effect),
    },
  });
  state.msgs.push(msg(effect.message, state.time, '#d8a'));
}

function handleAg81Event(state: GameState, event: WorldEvent): void {
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : undefined;
  if (event.type === 'quest_completed' && sideQuestId) {
    const outcome = OUTCOMES[sideQuestId];
    if (outcome) applyOutcome(state, outcome, sideQuestId);
    return;
  }
  if (event.type === 'quest_failed' && sideQuestId === ROUTE_QUEST) {
    applyOutcome(state, DELAY_OUTCOME, sideQuestId);
    return;
  }
  if (event.type !== 'player_kill_npc' || event.targetName !== DEFECTOR_DEF.name) return;
  const formalKillActive = state.quests.some(q => q.sideQuestId === KILL_QUEST && !q.done);
  if (!formalKillActive) applyOutcome(state, VIOLENCE_OUTCOME);
}

registerWorldEventObserver(handleAg81Event);

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
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
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
}

function connectAg81Rooms(ctx: MaintContentCtx, watch: Room, stash: Room, wire: Room, alcove: Room): void {
  const watchY = watch.y + 4;
  for (let x = watch.x + watch.w - 1; x <= stash.x + 1; x++) openTile(ctx.world, x, watchY);
  for (let y = watchY; y <= wire.y + 2; y++) openTile(ctx.world, watch.x + 3, y);
  for (let x = watch.x + 3; x <= wire.x + 2; x++) openTile(ctx.world, x, wire.y + 2);
  for (let x = watch.x + 3; x >= alcove.x + alcove.w - 2; x--) openTile(ctx.world, x, alcove.y + 3);
}

function dressAg81Room(ctx: MaintContentCtx, room: Room, feature: Feature): void {
  setFeature(ctx.world, room.x + 1, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 2, room.y + 1, feature);
  setFeature(ctx.world, room.x + 2, room.y + room.h - 2, Feature.SHELF);
}

function stampBlackHandSmear(ctx: MaintContentCtx, room: Room): void {
  const x = room.x + Math.floor(room.w / 2);
  const y = room.y + Math.floor(room.h / 2);
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.45, 0.45, 180, room.id * 997 + 81, 8, 6, 5, true);
  stampSurfaceSplat(ctx.world, x - 1, y, 0.7, 0.5, 0.22, 135, room.id * 997 + 82, 12, 7, 6, true);
  stampSurfaceSplat(ctx.world, x + 1, y - 1, 0.35, 0.65, 0.18, 120, room.id * 997 + 83, 12, 7, 6, true);
}

export function generateDefectorLiquidator(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 42, 20, 85, 185);

  const watch = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.HQ,
    pos.x + 1, pos.y + 2, 14, 8,
    'Сломанный пост караула: Митькина смена',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const stash = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 19, pos.y + 3, 11, 7,
    HIDDEN_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const wire = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.OFFICE,
    pos.x + 17, pos.y + 13, 16, 6,
    'Проволочная прослушка: живой информатор',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const alcove = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.SMOKING,
    pos.x + 2, pos.y + 13, 11, 6,
    'Курилка черной ладони: внешний шепот',
    Tex.CONCRETE, Tex.F_CONCRETE,
  );

  connectAg81Rooms(ctx, watch, stash, wire, alcove);
  dressAg81Room(ctx, watch, Feature.DESK);
  dressAg81Room(ctx, stash, Feature.SHELF);
  dressAg81Room(ctx, wire, Feature.SCREEN);
  dressAg81Room(ctx, alcove, Feature.CANDLE);
  setFeature(ctx.world, watch.x + 6, watch.y + 2, Feature.TABLE);
  setFeature(ctx.world, stash.x + 5, stash.y + 3, Feature.SHELF);
  setFeature(ctx.world, wire.x + 7, wire.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, alcove.x + 5, alcove.y + 3, Feature.CANDLE);
  stampBlackHandSmear(ctx, stash);

  spawnPlotNpc(ctx, DEFECTOR_ID, DEFECTOR_DEF, watch.x + 4, watch.y + 4, 0, { weapon: 'makarov' });
  spawnPlotNpc(ctx, DUTY_ID, DUTY_DEF, watch.x + 10, watch.y + 4, Math.PI);
  spawnPlotNpc(ctx, HARDLINER_ID, HARDLINER_DEF, watch.x + 7, watch.y + 6, -Math.PI / 2, { weapon: 'tt_pistol' });
  spawnPlotNpc(ctx, RADIO_ID, RADIO_DEF, wire.x + 4, wire.y + 3, Math.PI / 2);
  spawnPlotNpc(ctx, CULT_ID, CULT_DEF, alcove.x + 5, alcove.y + 3, Math.PI);

  addContainer(ctx, stash, stash.x + 5, stash.y + 3, {
    kind: ContainerKind.SECRET_STASH,
    name: 'Срывной мешок Митьки',
    inventory: [
      { defId: 'liquidator_token', count: 1 },
      { defId: 'idol_chernobog', count: 1 },
      { defId: 'liquidator_ration', count: 1 },
      { defId: 'ammo_9mm', count: 12 },
      { defId: 'bandage', count: 1 },
      { defId: 'note', count: 1 },
    ],
    capacitySlots: 8,
    ownerName: DEFECTOR_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'secret',
    discovered: true,
    tags: ['ag81', 'defector', 'hidden_supply', 'black_hand', 'proof'],
  });

  dropItems(ctx, watch, ['ammo_9mm', 'liquidator_ration']);
  dropItems(ctx, wire, ['gasmask_filter', 'note']);
  dropItems(ctx, alcove, ['cigs', 'holy_water']);
  spawnMonstersNear(ctx, stash.x + 5, stash.y + 3, [
    MonsterKind.SHADOW, MonsterKind.NELYUD,
  ], 5, 11);
}

/* ── Оставшийся Ликвидатор: armed post-cleanup non-kill encounter ── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell,
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
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
import { getRecentEvents, publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile,
  setFeature, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const LOST_ID = 'ostavshiysya_likvidator';
const REPORTER_ID = 'ostliq_vyuga_report';
const MECHANIC_ID = 'ostliq_titov_witness';

const AID_QUEST = 'ostliq_aid_broken_respirator';
const REPORT_QUEST = 'ostliq_report_wrong_code';
const DISARM_QUEST = 'ostliq_disarm_by_token';
const BRANCH_QUEST_IDS = [AID_QUEST, REPORT_QUEST, DISARM_QUEST];
const RESOLUTION_TAG = 'ostliq_resolved';

const CHECKPOINT_ROOM = 'Проваленный пост зачистки: неверный код';

const LOST_DEF: PlotNpcDef = {
  name: 'Оставшийся Ликвидатор',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 165, maxHp: 165, money: 18, speed: 0.88,
  inventory: [
    { defId: 'shotgun', count: 1 },
    { defId: 'ammo_shells', count: 4 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'liquidator_token', count: 1 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Код зачистки? Нет. Не этот. Маска шипит, рация врёт, ствол держится ровнее руки.',
    'Не подходи рывком. Бинт брось на пол, корешок покажи издалека, жетон не трогай без свидетеля.',
    'После отбоя здесь остался не пост. Остался я, дробовик и приказ с номером, который мне больше не подходит.',
  ],
  talkLinesPost: [
    'Я помню меньше, чем должен. Зато уже не стреляю в тень по уставу.',
    'Если Вьюга спросит код, скажи: двадцать первый был лишним.',
  ],
};

const REPORTER_DEF: PlotNpcDef = {
  name: 'Постовая Вьюга',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 155, maxHp: 155, money: 55, speed: 0.95,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Вьюга на радиоточке. Если у него неверный код, не спорь с дробовиком. Неси ведомость, я сниму пост с маршрута.',
    'Живой рапорт лучше мёртвого тела. У мёртвого тела обычно ещё и патроны пропадают.',
  ],
  talkLinesPost: [
    'Рапорт принят. Теперь у этого угла есть причина не стрелять первым.',
  ],
};

const MECHANIC_DEF: PlotNpcDef = {
  name: 'Слесарь Титов',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 110, maxHp: 110, money: 24, speed: 1.0,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'bandage', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Он не бандит. Бандит так ровно не перезаряжается. Найди жетон смены и покажи ему номер до следующего выстрела.',
    'За стойкой есть бетон. После выстрела у него длинная пауза: тогда можно говорить, а не лезть грудью.',
  ],
  talkLinesPost: [
    'Жетон сработал. Плохо, что человеку иногда нужен металл, чтобы вспомнить имя.',
  ],
};

function branchBlockers(id: string): string[] {
  return BRANCH_QUEST_IDS.filter(qid => qid !== id);
}

registerSideQuest(LOST_ID, LOST_DEF, [{
  id: AID_QUEST,
  giverNpcId: LOST_ID,
  type: QuestType.FETCH,
  desc: 'Оставшийся Ликвидатор: «Бинт. Не к рукам - к маске. Подойдёшь медленно, я отведу ствол и отдам запасной фильтр.»',
  targetItem: 'bandage', targetCount: 1,
  rewardItem: 'gasmask_filter', rewardCount: 1,
  extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
  relationDelta: 4, xpReward: 55, moneyReward: 20,
  targetFloor: FloorLevel.MAINTENANCE,
  targetRoomName: CHECKPOINT_ROOM,
  targetHint: 'Коллекторы: сломанный пост зачистки с неверным кодом и дробовиком за бетонной стойкой.',
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(AID_QUEST),
  failOnNpcDeathPlotId: LOST_ID,
  timeLimitMinutes: 12 * 60,
  eventTargetName: 'Оставшемуся Ликвидатору помогли бинтом и фильтром после проваленной зачистки.',
  eventSeverity: 4,
  eventPrivacy: 'local',
  eventTags: ['monster', 'liquidator', 'aftermath', 'nonkill', 'aid'],
  eventData: {
    ostliqOutcome: 'aided',
    rumorIds: ['faction_liquidator_ammo', 'rare_bandage_med'],
  },
}]);

registerSideQuest(REPORTER_ID, REPORTER_DEF, [{
  id: REPORT_QUEST,
  giverNpcId: REPORTER_ID,
  type: QuestType.FETCH,
  desc: 'Вьюга: «На столе должна быть ведомость самосборов. Принесёшь её - я сниму с него маршрут и запишу не как тварь, а как срыв поста.»',
  targetItem: 'samosbor_tally', targetCount: 1,
  rewardItem: 'ammo_9mm', rewardCount: 12,
  extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
  relationDelta: 8, xpReward: 65, moneyReward: 70,
  targetFloor: FloorLevel.MAINTENANCE,
  targetRoomName: CHECKPOINT_ROOM,
  targetHint: 'Коллекторы: ведомость лежит у проваленного поста зачистки рядом с экраном неверного кода.',
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(REPORT_QUEST),
  failOnNpcDeathPlotId: LOST_ID,
  timeLimitMinutes: 12 * 60,
  eventTargetName: 'Неверный код зачистки доложен Вьюге; пост снят без расстрела.',
  eventSeverity: 4,
  eventPrivacy: 'public',
  eventTags: ['monster', 'liquidator', 'aftermath', 'nonkill', 'report'],
  eventData: {
    ostliqOutcome: 'reported',
    rumorIds: ['faction_liquidator_patrol', 'faction_liquidator_ammo'],
  },
}]);

registerSideQuest(MECHANIC_ID, MECHANIC_DEF, [{
  id: DISARM_QUEST,
  giverNpcId: MECHANIC_ID,
  type: QuestType.FETCH,
  desc: 'Титов: «Принеси жетон смены из ящика. Не украсть - показать. Когда он назовёт свой номер, дробовик станет тяжелее приказа.»',
  targetItem: 'liquidator_token', targetCount: 1,
  rewardItem: 'liquidator_token', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_shells', count: 2 }],
  relationDelta: 6, xpReward: 60, moneyReward: 25,
  targetFloor: FloorLevel.MAINTENANCE,
  targetRoomName: CHECKPOINT_ROOM,
  targetHint: 'Коллекторы: жетон смены спрятан в ящике проваленного поста; бетонные стойки дают паузу после выстрела.',
  blockedBySideQuestIds: BRANCH_QUEST_IDS,
  abandonsSideQuestIds: branchBlockers(DISARM_QUEST),
  failOnNpcDeathPlotId: LOST_ID,
  timeLimitMinutes: 12 * 60,
  eventTargetName: 'Оставшегося Ликвидатора разоружили через жетон смены и свидетеля.',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTags: ['monster', 'liquidator', 'aftermath', 'nonkill', 'disarm'],
  eventData: {
    ostliqOutcome: 'disarmed',
    rumorIds: ['faction_liquidator_patrol'],
  },
}]);

interface OutcomeEffect {
  id: string;
  message: string;
  tags: string[];
  rumorIds: string[];
  privacy: WorldEvent['privacy'];
  deltas: { faction: Faction; delta: number }[];
}

const OUTCOMES: Partial<Record<string, OutcomeEffect>> = {
  [AID_QUEST]: {
    id: 'aided',
    message: 'Оставшийся Ликвидатор получил помощь. В коридоре остался должник с дробовиком, а не трофей.',
    tags: ['aid', 'nonkill'],
    rumorIds: ['faction_liquidator_ammo', 'rare_bandage_med'],
    privacy: 'local',
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: 5 },
      { faction: Faction.CITIZEN, delta: 2 },
    ],
  },
  [REPORT_QUEST]: {
    id: 'reported',
    message: 'Вьюга приняла рапорт по неверному коду. Ликвидаторы сняли пост без публичной расправы.',
    tags: ['report', 'nonkill'],
    rumorIds: ['faction_liquidator_patrol', 'faction_liquidator_ammo'],
    privacy: 'public',
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: 8 },
      { faction: Faction.CITIZEN, delta: 1 },
    ],
  },
  [DISARM_QUEST]: {
    id: 'disarmed',
    message: 'Жетон смены вернул человеку номер. Дробовик опустили без выстрела, но ящик поста это запомнил.',
    tags: ['disarm', 'nonkill'],
    rumorIds: ['faction_liquidator_patrol'],
    privacy: 'witnessed',
    deltas: [
      { faction: Faction.LIQUIDATOR, delta: 3 },
      { faction: Faction.CITIZEN, delta: 5 },
    ],
  },
};

const KILL_OUTCOME: OutcomeEffect = {
  id: 'killed',
  message: 'Оставшегося Ликвидатора добили. Фильтр и дробь полезны, но караул теперь остался без человека.',
  tags: ['kill', 'loot'],
  rumorIds: ['faction_liquidator_patrol'],
  privacy: 'witnessed',
  deltas: [
    { faction: Faction.LIQUIDATOR, delta: -16 },
    { faction: Faction.CITIZEN, delta: -3 },
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
    actorName: 'Проваленный пост зачистки',
    actorFaction: Faction.LIQUIDATOR,
    targetName: effect.message,
    severity: 4,
    privacy: effect.privacy,
    tags: [
      'monster',
      'liquidator',
      'aftermath',
      effect.id === 'killed' ? 'kill' : 'nonkill',
      RESOLUTION_TAG,
      ...effect.tags,
    ].slice(0, 8),
    data: {
      sideQuestId,
      outcomeId: effect.id,
      rumorIds: effect.rumorIds,
      relationDeltas: relationDeltas(effect),
    },
  });
  state.msgs.push(msg(effect.message, state.time, effect.id === 'killed' ? '#f86' : '#adf'));
}

function handleOstliqEvent(state: GameState, event: WorldEvent): void {
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : undefined;
  if (event.type === 'quest_completed' && sideQuestId) {
    const outcome = OUTCOMES[sideQuestId];
    if (outcome) applyOutcome(state, outcome, sideQuestId);
    return;
  }

  if (event.type !== 'player_kill_npc' || event.targetName !== LOST_DEF.name) return;
  applyOutcome(state, KILL_OUTCOME);
}

registerWorldEventObserver(handleOstliqEvent);

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

function setCoverBlock(ctx: MaintContentCtx, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = ctx.world.idx(x + dx, y + dy);
      if (ctx.world.cells[ci] === Cell.LIFT) continue;
      ctx.world.cells[ci] = Cell.WALL;
      ctx.world.wallTex[ci] = Tex.CONCRETE;
      ctx.world.features[ci] = Feature.NONE;
    }
  }
}

function connectOstliqRooms(ctx: MaintContentCtx, post: Room, stash: Room, radio: Room, witness: Room): void {
  const postY = post.y + 4;
  for (let x = post.x + post.w - 1; x <= stash.x + 1; x++) openTile(ctx.world, x, postY);
  for (let y = postY; y <= radio.y + 3; y++) openTile(ctx.world, stash.x + 3, y);
  for (let x = stash.x + 3; x <= radio.x + 2; x++) openTile(ctx.world, x, radio.y + 3);
  for (let y = postY; y <= witness.y + 2; y++) openTile(ctx.world, post.x + 3, y);
  for (let x = post.x + 3; x <= witness.x + witness.w - 2; x++) openTile(ctx.world, x, witness.y + 2);
}

function dressOstliqRooms(ctx: MaintContentCtx, post: Room, stash: Room, radio: Room, witness: Room): void {
  setFeature(ctx.world, post.x + 2, post.y + 1, Feature.SCREEN);
  setFeature(ctx.world, post.x + 5, post.y + 2, Feature.TABLE);
  setFeature(ctx.world, post.x + 5, post.y + 5, Feature.TABLE);
  setFeature(ctx.world, post.x + 13, post.y + 2, Feature.LAMP);
  setFeature(ctx.world, post.x + 13, post.y + 6, Feature.SHELF);
  setCoverBlock(ctx, post.x + 7, post.y + 2, 1, 2);
  setCoverBlock(ctx, post.x + 7, post.y + 5, 1, 2);
  ctx.world.wallTex[ctx.world.idx(post.x + 2, post.y - 1)] = Tex.SCREEN_BASE + 21;

  setFeature(ctx.world, stash.x + 2, stash.y + 2, Feature.SHELF);
  setFeature(ctx.world, stash.x + 6, stash.y + 2, Feature.SHELF);
  setFeature(ctx.world, stash.x + 7, stash.y + 5, Feature.LAMP);
  stampSurfaceSplat(ctx.world, stash.x + 5, stash.y + 3, 0.55, 0.45, 0.35, 160, stash.id * 997 + 21, 8, 7, 5, true);

  setFeature(ctx.world, radio.x + 2, radio.y + 2, Feature.DESK);
  setFeature(ctx.world, radio.x + 3, radio.y + 2, Feature.SCREEN);
  setFeature(ctx.world, radio.x + 8, radio.y + 3, Feature.APPARATUS);
  setFeature(ctx.world, radio.x + 10, radio.y + 5, Feature.LAMP);

  setFeature(ctx.world, witness.x + 2, witness.y + 2, Feature.TABLE);
  setFeature(ctx.world, witness.x + 4, witness.y + 2, Feature.CHAIR);
  setFeature(ctx.world, witness.x + 8, witness.y + 3, Feature.MACHINE);
  setFeature(ctx.world, witness.x + 10, witness.y + 1, Feature.LAMP);
}

export function generateOstavshiysyaLikvidator(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 40, 24, 48, 170);

  const post = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.HQ,
    pos.x + 1, pos.y + 2, 16, 9,
    CHECKPOINT_ROOM,
    Tex.METAL, Tex.F_CONCRETE,
  );
  const stash = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 22, pos.y + 3, 11, 7,
    'Ящик смены: жетон, дробь и сорванный фильтр',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const radio = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.OFFICE,
    pos.x + 22, pos.y + 14, 15, 7,
    'Радиоточка Вьюги: доклад после отбоя',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const witness = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 2, pos.y + 15, 13, 6,
    'Слесарная ниша: бетон перед дробью',
    Tex.CONCRETE, Tex.F_CONCRETE,
  );

  connectOstliqRooms(ctx, post, stash, radio, witness);
  dressOstliqRooms(ctx, post, stash, radio, witness);

  spawnPlotNpc(ctx, LOST_ID, LOST_DEF, post.x + 12, post.y + 4, Math.PI, {
    weapon: 'shotgun',
    attackCd: 3.5,
  });
  spawnPlotNpc(ctx, REPORTER_ID, REPORTER_DEF, radio.x + 4, radio.y + 3, Math.PI / 2, {
    weapon: 'makarov',
  });
  spawnPlotNpc(ctx, MECHANIC_ID, MECHANIC_DEF, witness.x + 4, witness.y + 3, 0);

  addContainer(ctx, stash, stash.x + 5, stash.y + 3, {
    kind: ContainerKind.WEAPON_CRATE,
    name: 'Ящик смены оставшегося ликвидатора',
    inventory: [
      { defId: 'liquidator_token', count: 1 },
      { defId: 'samosbor_tally', count: 1 },
      { defId: 'liquidator_rake', count: 1 },
      { defId: 'ammo_shells', count: 4 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'ip4_gasmask', count: 1 },
      { defId: 'unsigned_order', count: 1 },
    ],
    capacitySlots: 8,
    ownerName: LOST_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'faction',
    discovered: true,
    tags: ['ostliq', 'liquidator', 'aftermath', 'nonkill', 'weapon', 'proof', 'theft'],
  });

  dropItems(ctx, post, ['samosbor_tally']);
  dropItems(ctx, witness, ['bandage']);
  dropItems(ctx, radio, ['note']);
}

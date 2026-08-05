/* ── Пустой Сосед: verifiable false-neighbor encounter ───────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, EntityType, Faction, Feature, FloorLevel, MonsterKind, Occupation, QuestType,
  RoomType, Tex, type Entity, type GameState, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  createSocialPoiRoom,
  setFeatureIfFloor,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const CONTENT_ID = 'pustoy_sosed';
const WITNESS_ID = 'pustoy_sosed_liza_sverka';
const COMPLAINANT_ID = 'pustoy_sosed_kostya_dvernoj';
const LIQUIDATOR_ID = 'pustoy_sosed_mercaev';
const OUTCOME_TAG = 'pustoy_sosed_outcome';
export const PUSTOY_SOSED_ROOM_NAME = 'Квартира с пустым соседом';
export const PUSTOY_SOSED_REFLECTION_RUMOR_ID = 'lead_kvartiry_pustoy_sosed_reflection';
const PUSTOY_SOSED_RUMOR_IDS = [
  'ecology_nelyud_close',
  'lead_kvartiry_false_neighbor_nelyud',
  PUSTOY_SOSED_REFLECTION_RUMOR_ID,
] as const;

const ROOM_W = 18;
const ROOM_H = 10;

export const PUSTOY_SOSED_QUEST_IDS = {
  checkPapers: 'pustoy_sosed_check_papers',
  reportLiquidator: 'pustoy_sosed_report_liquidator',
  keepDistance: 'pustoy_sosed_keep_distance',
  closeReveal: 'pustoy_sosed_close_reveal',
} as const;

const EXPOSE_BLOCKERS = [
  PUSTOY_SOSED_QUEST_IDS.keepDistance,
  PUSTOY_SOSED_QUEST_IDS.closeReveal,
];
const FLEE_BLOCKERS = [
  PUSTOY_SOSED_QUEST_IDS.checkPapers,
  PUSTOY_SOSED_QUEST_IDS.reportLiquidator,
  PUSTOY_SOSED_QUEST_IDS.closeReveal,
];
const FIGHT_BLOCKERS = [
  PUSTOY_SOSED_QUEST_IDS.checkPapers,
  PUSTOY_SOSED_QUEST_IDS.reportLiquidator,
  PUSTOY_SOSED_QUEST_IDS.keepDistance,
];

interface OutcomeDef {
  outcome: 'exposed' | 'ignored' | 'revealed';
  targetName: string;
  severity: 2 | 3 | 4;
  privacy: 'local' | 'witnessed' | 'public';
  tags: string[];
  rumorIds: string[];
  relationDeltas: { faction: Faction; delta: number }[];
}

const OUTCOMES: Record<string, OutcomeDef> = {
  [PUSTOY_SOSED_QUEST_IDS.checkPapers]: {
    outcome: 'exposed',
    targetName: 'Пустой Сосед вскрыт сверкой пропуска и номера квартиры',
    severity: 4,
    privacy: 'witnessed',
    tags: ['exposed', 'document_check'],
    rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
    relationDeltas: [
      { faction: Faction.CITIZEN, delta: 5 },
      { faction: Faction.LIQUIDATOR, delta: 3 },
    ],
  },
  [PUSTOY_SOSED_QUEST_IDS.reportLiquidator]: {
    outcome: 'exposed',
    targetName: 'Свидетельские показания о Пустом Соседе ушли ликвидаторам',
    severity: 4,
    privacy: 'public',
    tags: ['exposed', 'liquidator_report', 'denunciation'],
    rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
    relationDeltas: [
      { faction: Faction.LIQUIDATOR, delta: 10 },
      { faction: Faction.CULTIST, delta: -4 },
    ],
  },
  [PUSTOY_SOSED_QUEST_IDS.keepDistance]: {
    outcome: 'ignored',
    targetName: 'Жалобу забрали, а к Пустому Соседу не подошли',
    severity: 2,
    privacy: 'local',
    tags: ['ignored', 'avoided'],
    rumorIds: ['ecology_nelyud_close', PUSTOY_SOSED_REFLECTION_RUMOR_ID],
    relationDeltas: [{ faction: Faction.CITIZEN, delta: 2 }],
  },
  [PUSTOY_SOSED_QUEST_IDS.closeReveal]: {
    outcome: 'revealed',
    targetName: 'Пустой Сосед раскрылся вблизи и оставил черную слизь',
    severity: 4,
    privacy: 'witnessed',
    tags: ['revealed', 'black_slime'],
    rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
    relationDeltas: [
      { faction: Faction.LIQUIDATOR, delta: 5 },
      { faction: Faction.CITIZEN, delta: 3 },
    ],
  },
};

registerWorldEventObserver(handlePustoySosedOutcome);

const WITNESS: PlotNpcDef = {
  name: 'Лиза Сверка',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 80, maxHp: 80, money: 16, speed: 0.85,
  inventory: [{ defId: 'inspection_mirror', count: 1 }, { defId: 'neighbor_complaint', count: 1 }],
  talkLines: [
    'Он назвался Аркадием из сорок второй, а дверь тут тридцать седьмая. На табличке цифры не менялись.',
    'На экране у шкафа отражаются все, кроме него. Пятно есть, человека нет.',
    'Пропуск лежит на столе у входа. Возьмите бумагу оттуда, не подходите к нему за подписью.',
    'Если хотите не стрелять - несите бумагу сержанту Баринову. Ликвидаторы любят свидетелей больше громких покойников.',
  ],
  talkLinesPost: [
    'Теперь у нас есть бумага и имя, которое не совпадает с дверью.',
    'Соседи снова говорят шепотом. Это лучше, чем вообще не говорить.',
  ],
};

const COMPLAINANT: PlotNpcDef = {
  name: 'Костя Дверной',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 95, maxHp: 95, money: 9, speed: 0.9,
  inventory: [{ defId: 'bread', count: 1 }, { defId: 'neighbor_complaint', count: 1 }],
  talkLines: [
    'Я жалобу писал не на шум. На тишину. У него тишина ходит по комнате.',
    'Если берете жалобу, берите и уходите. Пусть он стоит там один, пока не придет обход.',
    'Ближе шкафа не ходите. Там уже чернеет линолеум.',
  ],
  talkLinesPost: [
    'Жалоба ушла из комнаты, и мне этого пока достаточно.',
    'Тридцать седьмая снова моя дверь. Почти.',
  ],
};

const LIQUIDATOR: PlotNpcDef = {
  name: 'Сержант Мерцаев',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 145, maxHp: 145, money: 28, speed: 1.0,
  inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 8 }, { defId: 'liquidator_ration', count: 1 }],
  talkLines: [
    'Нелюдь не раскрывается, пока человек сам не сократит дистанцию. Это его вежливость.',
    'Хотите проверить боем - ведите его к лампе и столам. В темном углу он быстрее.',
    'Документ и свидетель экономят патроны. Патроны экономят гордость.',
  ],
  talkLinesPost: [
    'След черный, кровь человеческой не стала. Значит, сосед был пустой.',
    'Запишите номер квартиры. Такие ошибки любят возвращаться через реестр.',
  ],
};

registerSideQuest(WITNESS_ID, WITNESS, [
  {
    id: PUSTOY_SOSED_QUEST_IDS.checkPapers,
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Пустой Сосед: Лиза просит сверить пропуск на столе у входа, не подходя к молчаливому жильцу в дальнем углу.',
    targetItem: 'fake_pass',
    targetCount: 1,
    rewardItem: 'neighbor_complaint',
    rewardCount: 1,
    extraRewards: [{ defId: 'inspection_mirror', count: 1 }],
    relationDelta: 8,
    xpReward: 45,
    moneyReward: 18,
    blockedBySideQuestIds: EXPOSE_BLOCKERS,
    abandonsSideQuestIds: EXPOSE_BLOCKERS,
    targetFloor: FloorLevel.KVARTIRY,
    targetRoomType: RoomType.LIVING,
    targetRoomName: PUSTOY_SOSED_ROOM_NAME,
    targetHint: 'заберите фальшивый пропуск с ближнего стола и держите дистанцию от дальнего жильца',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTargetName: 'Фальшивый пропуск Пустого Соседа сверили при свидетеле.',
    eventTags: ['monster', 'false_neighbor', 'witness', 'infected', 'exposed', 'expose_choice', 'denunciation'],
    eventData: {
      monsterId: CONTENT_ID,
      ruName: 'Пустой Сосед',
      clue: 'wrong_apartment_number_and_missing_screen_reflection',
      counterplay: 'document_check_before_close_reveal',
      rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
    },
  },
  {
    id: PUSTOY_SOSED_QUEST_IDS.reportLiquidator,
    giverNpcId: WITNESS_ID,
    type: QuestType.TALK,
    desc: 'Пустой Сосед: Лиза готова быть свидетелем. Сообщите сержанту Баринову про пропуск, номер квартиры и пустое отражение.',
    targetPlotNpcId: 'barni',
    rewardItem: 'unpeople_detector',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 10,
    xpReward: 65,
    moneyReward: 35,
    requiresSideQuestDone: PUSTOY_SOSED_QUEST_IDS.checkPapers,
    blockedBySideQuestIds: EXPOSE_BLOCKERS,
    abandonsSideQuestIds: EXPOSE_BLOCKERS,
    eventSeverity: 4,
    eventPrivacy: 'public',
    eventTargetName: 'Пустого Соседа передали ликвидаторам до близкого раскрытия.',
    eventTags: ['monster', 'false_neighbor', 'witness', 'infected', 'exposed', 'expose_choice', 'denunciation'],
    eventData: {
      monsterId: CONTENT_ID,
      ruName: 'Пустой Сосед',
      counterplay: 'witness_report_to_liquidator',
      revealPrevented: true,
      rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
    },
  },
]);

registerSideQuest(COMPLAINANT_ID, COMPLAINANT, [{
  id: PUSTOY_SOSED_QUEST_IDS.keepDistance,
  giverNpcId: COMPLAINANT_ID,
  type: QuestType.FETCH,
  desc: 'Пустой Сосед: Костя просит забрать жалобу у порога и не проверять дальнего жильца лицом.',
  targetItem: 'neighbor_complaint',
  targetCount: 1,
  rewardItem: 'filtered_water',
  rewardCount: 1,
  extraRewards: [{ defId: 'bread', count: 1 }],
  relationDelta: 4,
  xpReward: 25,
  moneyReward: 10,
  blockedBySideQuestIds: FLEE_BLOCKERS,
  abandonsSideQuestIds: FLEE_BLOCKERS,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.LIVING,
  targetRoomName: PUSTOY_SOSED_ROOM_NAME,
  targetHint: 'возьмите жалобу у входа и уходите, если не готовы к близкому раскрытию',
  eventSeverity: 2,
  eventPrivacy: 'local',
  eventTargetName: 'Пустого Соседа обошли: жалоба забрана без сближения.',
  eventTags: ['monster', 'false_neighbor', 'witness', 'infected', 'ignored', 'flee_choice'],
  eventData: {
    monsterId: CONTENT_ID,
    ruName: 'Пустой Сосед',
    counterplay: 'keep_distance_and_leave_with_complaint',
    revealAvoided: true,
    rumorIds: ['ecology_nelyud_close', PUSTOY_SOSED_REFLECTION_RUMOR_ID],
  },
}]);

registerSideQuest(LIQUIDATOR_ID, LIQUIDATOR, [{
  id: PUSTOY_SOSED_QUEST_IDS.closeReveal,
  giverNpcId: LIQUIDATOR_ID,
  type: QuestType.KILL,
  desc: 'Пустой Сосед: Мерцаев предупреждает - если полезете близко, он раскроется. Ведите нелюдь к свету и убейте.',
  targetMonsterKind: MonsterKind.NELYUD,
  killNeeded: 1,
  rewardItem: 'fake_pass',
  rewardCount: 1,
  extraRewards: [{ defId: 'liquidator_ration', count: 1 }, { defId: 'ammo_9mm', count: 10 }],
  relationDelta: 10,
  xpReward: 75,
  moneyReward: 45,
  blockedBySideQuestIds: FIGHT_BLOCKERS,
  abandonsSideQuestIds: FIGHT_BLOCKERS,
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Пустой Сосед раскрылся вблизи и был ликвидирован.',
  eventTags: ['monster', 'false_neighbor', 'witness', 'infected', 'revealed', 'fight_choice'],
  eventData: {
    monsterId: CONTENT_ID,
    ruName: 'Пустой Сосед',
    failureCondition: 'close_distance_reveal',
    trace: 'black_slime',
    rumorIds: [...PUSTOY_SOSED_RUMOR_IDS],
  },
}]);

function handlePustoySosedOutcome(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = OUTCOMES[sideQuestId];
  if (!outcome) return;

  for (const rel of outcome.relationDeltas) {
    addFactionRelMutual(Faction.PLAYER, rel.faction, rel.delta);
  }

  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.KVARTIRY,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_TAG, 'faction_event', 'monster', 'false_neighbor', 'witness', 'infected', outcome.outcome],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      monsterId: CONTENT_ID,
      ruName: 'Пустой Сосед',
      outcome: outcome.outcome,
      outcomeTags: outcome.tags,
      localTrace: outcome.outcome === 'revealed' ? 'black_slime' : 'neighbor_complaint',
      rumorIds: outcome.rumorIds,
    },
  });
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
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

function zoneLevelAt(world: World, x: number, y: number): number {
  const zid = world.zoneMap[world.idx(x, y)];
  return (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
}

function spawnPustoySosed(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): Entity {
  const def = MONSTERS[MonsterKind.NELYUD];
  const level = zoneLevelAt(world, x, y);
  const hp = Math.max(45, Math.round(scaleMonsterHp(def.hp, level) * 0.82));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level) * 0.92,
    sprite: monsterSpr(MonsterKind.NELYUD),
    name: 'Пустой Сосед',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.NELYUD,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  };
  entities.push(monster);
  return monster;
}

function stampBlackSlime(world: World, x: number, y: number): void {
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 2.1, 0.58, 44004, 4, 5, 5, false);
  stampSurfaceSplat(world, x - 1, y, 0.5, 0.5, 1.2, 0.45, 44005, 2, 8, 7, false);
  stampSurfaceSplat(world, x, y - 1, 0.5, 0.5, 0.8, 0.38, 44006, 8, 5, 5, false);
}

function placeScreenCue(world: World, poi: SocialPoiRoom): void {
  const screen = world.idx(poi.x + 8, poi.y - 1);
  world.wallTex[screen] = (Tex.SCREEN_BASE + 7) as Tex;
  if (!world.screenCells.includes(screen)) world.screenCells.push(screen);
  setFeatureIfFloor(world, poi.x + 8, poi.y + 1, Feature.SCREEN);
}

function decorateRoom(world: World, poi: SocialPoiRoom): void {
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 4, poi.y + 1, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 5, poi.y + 1, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 5, Feature.DESK);
  setFeatureIfFloor(world, poi.x + 6, poi.y + 5, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 7, poi.y + 5, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + ROOM_W - 4, poi.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + ROOM_W - 3, poi.y + ROOM_H - 3, Feature.BED);
  setFeatureIfFloor(world, poi.x + ROOM_W - 2, poi.y + ROOM_H - 2, Feature.LAMP);
  world.wallTex[world.idx(poi.x + 2, poi.y - 1)] = Tex.POSTER_BASE + 31;
  placeScreenCue(world, poi);
}

export function generatePustoySosedRoom(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): number {
  const poi = createSocialPoiRoom(
    world,
    nextRoomId,
    spawnX,
    spawnY,
    PUSTOY_SOSED_ROOM_NAME,
    RoomType.LIVING,
    ROOM_W,
    ROOM_H,
    Tex.PANEL,
    Tex.F_LINO,
    100,
    250,
    1.9,
  );
  if (!poi) return nextRoomId;

  decorateRoom(world, poi);
  spawnSocialNpc(entities, nextId, WITNESS, WITNESS_ID, poi.x + 2, poi.y + 2);
  spawnSocialNpc(entities, nextId, COMPLAINANT, COMPLAINANT_ID, poi.x + 2, poi.y + 6);
  spawnSocialNpc(entities, nextId, LIQUIDATOR, LIQUIDATOR_ID, poi.x + 5, poi.y + 7, { weapon: 'makarov' });

  dropItem(world, entities, nextId, poi.x + 4, poi.y + 2, 'fake_pass');
  dropItem(world, entities, nextId, poi.x + 2, poi.y + 5, 'neighbor_complaint');
  dropItem(world, entities, nextId, poi.x + 5, poi.y + 2, 'inspection_mirror');

  const sx = poi.x + ROOM_W - 3;
  const sy = poi.y + ROOM_H - 3;
  spawnPustoySosed(world, entities, nextId, sx, sy);
  stampBlackSlime(world, sx, sy);

  return poi.room.id + 1;
}

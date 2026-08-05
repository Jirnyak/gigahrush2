/* ── Чернобожий Свод: cult false-shelter room anchor ─────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex, ZoneFaction, msg,
  type Entity, type GameState, type Item, type WorldContainer, type WorldEvent,
  type WorldEventPrivacy, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { FALSE_SAFE_BLOCK_ROOM_PREFIX, FALSE_SAFE_BLOCK_TAG } from '../../data/procedural_floors';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

export const CHERNOBOZHIY_SVOD_TAG = 'chernobozhiy_svod';

const OUTCOME_TAG = 'chernobozhiy_svod_outcome';
const ROOM_NAME = `${FALSE_SAFE_BLOCK_ROOM_PREFIX}: Чернобожий Свод`;
const LIQUIDATOR_ID = 'svod_liquidator_belik';
const WITNESS_ID = 'svod_witness_anya';
const CUSTODIAN_ID = 'svod_custodian_efrem';

const EXPOSE_QUEST = 'svod_expose_black_hand_marker';
const SEAL_QUEST = 'svod_seal_false_shelter';
const SABOTAGE_QUEST = 'svod_ruin_cult_supply';
const DESTROY_QUEST = 'svod_destroy_room_anchor';

const RUMOR_IDS = ['faction_black_hand_marks', 'faction_chernobog_recruitment'] as const;
const CORE_TAGS = [CHERNOBOZHIY_SVOD_TAG, 'monster', 'cult', 'chernobog', FALSE_SAFE_BLOCK_TAG] as const;

type RelationDelta = readonly [Faction, number];

interface SvodQuestOutcome {
  kind: 'exposed' | 'sealed' | 'sabotaged' | 'destroyed';
  type: WorldEventType;
  targetName: string;
  message: string;
  severity: 3 | 4 | 5;
  privacy: WorldEventPrivacy;
  relationDeltas: readonly RelationDelta[];
  tags: readonly string[];
  color: string;
  itemId?: string;
  itemName?: string;
}

const QUEST_OUTCOMES: Record<string, SvodQuestOutcome> = {
  [EXPOSE_QUEST]: {
    kind: 'exposed',
    type: 'faction_relation_changed',
    targetName: 'Чернобожий Свод предъявлен ликвидаторам как адрес ячейки.',
    message: 'Ликвидаторы получили акт черной ладони. Тихий блок перестал быть просто слухом.',
    severity: 4,
    privacy: 'public',
    relationDeltas: [[Faction.LIQUIDATOR, 8], [Faction.CULTIST, -10]],
    tags: ['exposed', 'report', 'evidence'],
    color: '#8cf',
    itemId: 'chernobog_confiscation_act',
    itemName: 'Акт изъятия черной ладони',
  },
  [SEAL_QUEST]: {
    kind: 'sealed',
    type: 'faction_relation_changed',
    targetName: 'Черная ладонь Свода замазана чистящим комплектом.',
    message: 'Метка Свода закрыта бытовой химией и протоколом. Комната шумит как обычная.',
    severity: 4,
    privacy: 'local',
    relationDeltas: [[Faction.LIQUIDATOR, 6], [Faction.CULTIST, -8]],
    tags: ['sealed', 'black_hand', 'counterplay'],
    color: '#8cf',
    itemId: 'cleaning_kit',
    itemName: 'Чистящий комплект',
  },
  [SABOTAGE_QUEST]: {
    kind: 'sabotaged',
    type: 'room_blocked_production',
    targetName: 'Запас Чернобожьего Свода разнесен по соседям вместо ячейки.',
    message: 'Список снабжения ушел жильцам. У Свода осталась ладонь, но не пайки.',
    severity: 4,
    privacy: 'public',
    relationDeltas: [[Faction.CITIZEN, 10], [Faction.CULTIST, -8]],
    tags: ['sabotaged', 'supply', 'neighbor'],
    color: '#6cf',
    itemId: 'cult_supply_list',
    itemName: 'Кухонный список ячейки',
  },
  [DESTROY_QUEST]: {
    kind: 'destroyed',
    type: 'faction_relation_changed',
    targetName: 'Комнатный идол Свода разбит после раскрытия правила комнаты.',
    message: 'Идол Свода больше не держит тихое укрытие. Черная ладонь осталась только следом.',
    severity: 5,
    privacy: 'public',
    relationDeltas: [[Faction.LIQUIDATOR, 10], [Faction.CITIZEN, 6], [Faction.CULTIST, -14]],
    tags: ['destroyed', 'idol', 'anchor'],
    color: '#fa6',
    itemId: 'idol_chernobog',
    itemName: 'Идол Чернобога',
  },
};

const LIQUIDATOR: PlotNpcDef = {
  name: 'Белик Сухой Акт',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 135,
  maxHp: 135,
  money: 74,
  speed: 1.0,
  inventory: [
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'cleaning_kit', count: 1 },
  ],
  talkLines: [
    'В этой комнате не бог. В этой комнате порядок чужих пайков, тишина сирены и ладонь на стене.',
    'Нашел акт черной ладони - не махай им в коридоре. Принеси мне, и адрес станет протоколом.',
    'Метка держится на сажи, лаке и страхе. Чистящий комплект иногда сильнее молитвы.',
    'Идол бей только после того, как понял комнату. До этого ты воюешь с мебелью.',
  ],
  talkLinesPost: [
    'Свод уже не выглядит случайностью. Это почти победа.',
    'Если комната снова станет тихой, ищи не чудо, а кладовую.',
  ],
};

const WITNESS: PlotNpcDef = {
  name: 'Аня Из Списка',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 75,
  maxHp: 75,
  money: 11,
  speed: 0.9,
  inventory: [
    { defId: 'siren_instruction', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Меня вписали в укрытие, где мест меньше, чем фамилий. Это не забота, это очередь в чужую ладонь.',
    'У них должен быть кухонный список. Заберешь его - соседи хотя бы поймут, куда пропал хлеб.',
    'Не ложись на их койку во время сирены. Свод сначала считает тех, кто поверил.',
  ],
  talkLinesPost: [
    'Список ушел по соседям. Теперь тишина у них не бесплатная.',
    'Если сирена молчит только в одной комнате, это не удача.',
  ],
};

const CUSTODIAN: PlotNpcDef = {
  name: 'Ефрем Сводный',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 150,
  maxHp: 150,
  money: 33,
  speed: 0.85,
  inventory: [
    { defId: 'meat_rune', count: 1 },
    { defId: 'emergency_roster', count: 1 },
  ],
  talkLines: [
    'Свод не прячет людей. Свод запоминает, кто сам пришел прятаться.',
    'У нас нет заклятий. Есть список, пайки, тихая сирена и соседи, которые не задают вопрос второй раз.',
    'Не трогай аварийный запас. Он чужой ровно до той минуты, когда ты решил ему поверить.',
  ],
  talkLinesPost: [
    'Ладонь можно стереть. Адрес от этого не сразу забывает.',
    'Кто принес протокол, тот тоже вошел в порядок. Просто с другой стороны.',
  ],
};

registerSideQuest(LIQUIDATOR_ID, LIQUIDATOR, [
  {
    id: EXPOSE_QUEST,
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Белик Сухой Акт: «Принеси акт черной ладони из Свода. Комната должна стать адресом, а не чудом.»',
    targetItem: 'chernobog_confiscation_act',
    targetCount: 1,
    rewardItem: 'filtered_water',
    rewardCount: 2,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'siren_instruction', count: 1 }],
    relationDelta: 12,
    xpReward: 80,
    moneyReward: 45,
    targetFloor: FloorLevel.KVARTIRY,
    targetRoomType: RoomType.COMMON,
    targetHint: 'Квартиры: тихий культовый блок с черными ладонями и аварийным экраном.',
    eventTags: [...CORE_TAGS, 'exposed'],
    eventData: { svodOutcome: 'exposed', rumorIds: RUMOR_IDS },
    eventTargetName: 'Акт черной ладони вынесен из Чернобожьего Свода.',
  },
  {
    id: SEAL_QUEST,
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Белик Сухой Акт: «Дай чистящий комплект. Ладонь надо замазать так, чтобы укрытие снова слышало сирену.»',
    targetItem: 'cleaning_kit',
    targetCount: 1,
    rewardItem: 'liquidator_ration',
    rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 10,
    xpReward: 70,
    moneyReward: 40,
    targetFloor: FloorLevel.KVARTIRY,
    targetRoomType: RoomType.COMMON,
    targetHint: 'Квартиры: отметь и сотри черную ладонь в тихом блоке.',
    eventTags: [...CORE_TAGS, 'sealed'],
    eventData: { svodOutcome: 'sealed', rumorIds: RUMOR_IDS },
    eventTargetName: 'Метка Чернобожьего Свода запечатана бытовым способом.',
  },
  {
    id: DESTROY_QUEST,
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.KILL,
    desc: 'Белик Сухой Акт: «Когда поймешь, где ладонь держит комнату, разбей идол Свода. Не раньше.»',
    targetMonsterKind: MonsterKind.IDOL,
    killNeeded: 1,
    rewardItem: 'meat_rune',
    rewardCount: 1,
    extraRewards: [{ defId: 'holy_water', count: 1 }],
    relationDelta: 14,
    xpReward: 110,
    moneyReward: 70,
    targetFloor: FloorLevel.KVARTIRY,
    targetRoomType: RoomType.COMMON,
    targetHint: 'Квартиры: идол стоит внутри отмеченного тихого блока.',
    eventTags: [...CORE_TAGS, 'destroyed'],
    eventData: { svodOutcome: 'destroyed', rumorIds: RUMOR_IDS },
    eventTargetName: 'Идол-якорь Чернобожьего Свода уничтожен.',
  },
]);

registerSideQuest(WITNESS_ID, WITNESS, [{
  id: SABOTAGE_QUEST,
  giverNpcId: WITNESS_ID,
  type: QuestType.FETCH,
  desc: 'Аня Из Списка: «Укради кухонный список Свода. Хлеб надо вернуть в соседей, а не в ладонь.»',
  targetItem: 'cult_supply_list',
  targetCount: 1,
  rewardItem: 'bread',
  rewardCount: 3,
  extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'neighbor_complaint', count: 1 }],
  relationDelta: 14,
  xpReward: 65,
  moneyReward: 22,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.COMMON,
  targetHint: 'Квартиры: организованный культовый запас рядом с черными ладонями.',
  eventTags: [...CORE_TAGS, 'sabotaged'],
  eventData: { svodOutcome: 'sabotaged', rumorIds: RUMOR_IDS },
  eventTargetName: 'Список снабжения Чернобожьего Свода вынесен к соседям.',
}]);

registerSideQuest(CUSTODIAN_ID, CUSTODIAN, []);

registerWorldEventObserver(handleSvodEvents);

function handleSvodEvents(state: GameState, event: WorldEvent): void {
  if (event.type === 'quest_completed') {
    const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
    const outcome = QUEST_OUTCOMES[sideQuestId];
    if (outcome) publishQuestOutcome(state, event, sideQuestId, outcome);
    return;
  }

  if (event.type !== 'item_stolen' || !event.tags.includes(CHERNOBOZHIY_SVOD_TAG)) return;
  addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -6);
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetFaction: Faction.CULTIST,
    targetName: 'Запас Чернобожьего Свода взят как чужое укрытие.',
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    containerFaction: event.containerFaction,
    severity: 4,
    privacy: event.privacy === 'witnessed' ? 'witnessed' : 'local',
    tags: [OUTCOME_TAG, CHERNOBOZHIY_SVOD_TAG, 'monster', 'cult', 'chernobog', FALSE_SAFE_BLOCK_TAG, 'robbed', 'awakened'],
    data: {
      sourceEventId: event.id,
      outcome: 'robbed',
      roomName: ROOM_NAME,
      containerName: event.data?.containerName,
      witnessCount: event.data?.witnessCount,
      rumorIds: RUMOR_IDS,
    },
  });
  state.msgs.push(msg('Свод запомнил кражу: тишина стала похожа на засаду.', state.time, '#f84'));
}

function publishQuestOutcome(
  state: GameState,
  event: WorldEvent,
  sideQuestId: string,
  outcome: SvodQuestOutcome,
): void {
  for (const [faction, delta] of outcome.relationDeltas) addFactionRelMutual(Faction.PLAYER, faction, delta);
  publishEvent(state, {
    type: outcome.type,
    floor: FloorLevel.KVARTIRY,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetFaction: Faction.CULTIST,
    targetName: outcome.targetName,
    itemId: outcome.itemId,
    itemName: outcome.itemName,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_TAG, CHERNOBOZHIY_SVOD_TAG, 'monster', 'cult', 'chernobog', FALSE_SAFE_BLOCK_TAG, outcome.kind, 'black_hand'],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.kind,
      roomName: ROOM_NAME,
      outcomeTags: outcome.tags,
      rumorIds: RUMOR_IDS,
    },
  });
  state.msgs.push(msg(outcome.message, state.time, outcome.color));
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function findRoomFloorCell(world: World, poi: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } | null {
  const preferred = roomCell(poi, dx, dy);
  if (world.cells[world.idx(preferred.x, preferred.y)] === Cell.FLOOR) return preferred;
  for (let y = 1; y < poi.h - 1; y++) {
    for (let x = 1; x < poi.w - 1; x++) {
      const wx = world.wrap(poi.x + x);
      const wy = world.wrap(poi.y + y);
      const ci = world.idx(wx, wy);
      if (world.roomMap[ci] === poi.room.id && world.cells[ci] === Cell.FLOOR) return { x: wx, y: wy };
    }
  }
  return null;
}

function addSvodContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  access: WorldContainer['access'],
  inventory: Item[],
  opts: { ownerId?: number; ownerName?: string; faction?: Faction; tags: string[]; capacitySlots?: number },
): void {
  const pos = findRoomFloorCell(world, poi, dx, dy);
  if (!pos) return;
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: opts.capacitySlots ?? Math.max(8, inventory.length + 3),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: opts.tags,
  });
  const ci = world.idx(pos.x, pos.y);
  if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = Feature.SHELF;
}

function claimRoomForCult(world: World, poi: SocialPoiRoom): void {
  const center = roomCell(poi, Math.floor(poi.w / 2), Math.floor(poi.h / 2));
  const zoneId = world.zoneMap[world.idx(center.x, center.y)];
  const zone = world.zones[zoneId];
  if (zone) {
    zone.faction = ZoneFaction.CULTIST;
    zone.level = Math.max(zone.level, 3);
  }
  for (let dy = 0; dy < poi.h; dy++) {
    for (let dx = 0; dx < poi.w; dx++) {
      const ci = world.idx(poi.x + dx, poi.y + dy);
      if (world.roomMap[ci] !== poi.room.id) continue;
      if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR) world.factionControl[ci] = ZoneFaction.CULTIST;
    }
  }
}

function paintBlackHandMarks(world: World, poi: SocialPoiRoom): void {
  const marks = [
    { dx: 2, dy: 1, r: 0.28, seed: 11, wall: true },
    { dx: 5, dy: 3, r: 0.22, seed: 17, wall: false },
    { dx: 8, dy: 5, r: 0.42, seed: 23, wall: false },
    { dx: 11, dy: 3, r: 0.22, seed: 31, wall: false },
    { dx: 14, dy: 1, r: 0.28, seed: 43, wall: true },
    { dx: 14, dy: 8, r: 0.34, seed: 53, wall: false },
  ] as const;
  for (const mark of marks) {
    stampSurfaceSplat(world,
      world.wrap(poi.x + mark.dx),
      world.wrap(poi.y + mark.dy),
      0.5,
      0.5,
      mark.r,
      210,
      poi.room.id * 97 + mark.seed,
      2,
      2,
      2,
      mark.wall,
    );
  }
}

function tintFalseShelter(world: World, poi: SocialPoiRoom): void {
  let touched = false;
  for (let dy = 0; dy < poi.h; dy++) {
    for (let dx = 0; dx < poi.w; dx++) {
      const ci = world.idx(poi.x + dx, poi.y + dy);
      if (world.roomMap[ci] !== poi.room.id || world.cells[ci] !== Cell.FLOOR) continue;
      world.fog[ci] = Math.max(world.fog[ci], dx < 6 ? 18 : 10);
      touched = true;
    }
  }
  if (touched) world.markFogDirty();
}

function decorateSvodRoom(world: World, poi: SocialPoiRoom): void {
  for (let dx = 1; dx <= 5; dx += 2) {
    setFeatureIfFloor(world, poi.x + dx, poi.y + poi.h - 3, Feature.BED);
  }
  setFeatureIfFloor(world, poi.x + 2, poi.y + 1, Feature.SCREEN);
  setFeatureIfFloor(world, poi.x + 4, poi.y + 2, Feature.DESK);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 1, poi.y + poi.h - 2, Feature.CANDLE);

  const anchorX = poi.x + Math.floor(poi.w / 2);
  const anchorY = poi.y + Math.floor(poi.h / 2);
  setFeatureIfFloor(world, anchorX, anchorY, Feature.APPARATUS);
  setFeatureIfFloor(world, anchorX - 1, anchorY, Feature.CANDLE);
  setFeatureIfFloor(world, anchorX + 1, anchorY, Feature.CANDLE);
  setFeatureIfFloor(world, anchorX, anchorY - 2, Feature.TABLE);
  setFeatureIfFloor(world, anchorX, anchorY + 2, Feature.TABLE);

  for (let dx = poi.w - 5; dx < poi.w - 1; dx += 2) {
    setFeatureIfFloor(world, poi.x + dx, poi.y + 2, Feature.SHELF);
    setFeatureIfFloor(world, poi.x + dx, poi.y + poi.h - 3, Feature.SHELF);
  }
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.CANDLE);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + poi.h - 2, Feature.LAMP);

  paintBlackHandMarks(world, poi);
  tintFalseShelter(world, poi);
}

function spawnSvodMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  poi: SocialPoiRoom,
  kind: MonsterKind,
  dx: number,
  dy: number,
  levelBonus: number,
  name?: string,
): void {
  const pos = findRoomFloorCell(world, poi, dx, dy);
  if (!pos) return;
  const ci = world.idx(pos.x, pos.y);
  const def = MONSTERS[kind];
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 3;
  const level = Math.max(1, zoneLevel + levelBonus);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level)));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: pos.x + 0.5, ty: pos.y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  };
  entities.push(monster);
}

function seedSvodContainers(world: World, poi: SocialPoiRoom, custodianId: number): void {
  const ownedTags = [CHERNOBOZHIY_SVOD_TAG, FALSE_SAFE_BLOCK_TAG, 'cult', 'chernobog', 'black_hand', 'shelter'];
  addSvodContainer(
    world,
    poi,
    3,
    poi.h - 3,
    'Чужой аварийный запас Свода',
    ContainerKind.EMERGENCY_BOX,
    'faction',
    [
      { defId: 'water', count: 2 },
      { defId: 'bread', count: 2 },
      { defId: 'bandage', count: 1 },
      { defId: 'siren_instruction', count: 1 },
      { defId: 'emergency_roster', count: 1 },
    ],
    { ownerId: custodianId, ownerName: CUSTODIAN.name, faction: Faction.CULTIST, tags: ownedTags, capacitySlots: 10 },
  );
  addSvodContainer(
    world,
    poi,
    poi.w - 4,
    2,
    'Шкаф доказательств черной ладони',
    ContainerKind.FILING_CABINET,
    'room',
    [
      { defId: 'chernobog_confiscation_act', count: 1 },
      { defId: 'cult_supply_list', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'container_key_label', count: 1 },
    ],
    { faction: Faction.LIQUIDATOR, tags: [CHERNOBOZHIY_SVOD_TAG, 'evidence', 'black_hand', 'proof'], capacitySlots: 9 },
  );
  addSvodContainer(
    world,
    poi,
    poi.w - 4,
    poi.h - 3,
    'Тайник под ладонью Свода',
    ContainerKind.SECRET_STASH,
    'faction',
    [
      { defId: 'idol_chernobog', count: 1 },
      { defId: 'meat_rune', count: 1 },
      { defId: 'psi_dust', count: 1 },
      { defId: 'holy_water', count: 1 },
    ],
    { ownerId: custodianId, ownerName: CUSTODIAN.name, faction: Faction.CULTIST, tags: ownedTags, capacitySlots: 8 },
  );
}

export function generateChernobozhiySvod(
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
    ROOM_NAME,
    RoomType.COMMON,
    17,
    11,
    Tex.DARK,
    Tex.F_CONCRETE,
    135,
    340,
    2.5,
  );
  if (!poi) return nextRoomId;

  claimRoomForCult(world, poi);
  decorateSvodRoom(world, poi);

  spawnSocialNpc(entities, nextId, LIQUIDATOR, LIQUIDATOR_ID, poi.x + 2, poi.y + 3, { weapon: 'makarov' });
  spawnSocialNpc(entities, nextId, WITNESS, WITNESS_ID, poi.x + 5, poi.y + poi.h - 3);
  const custodianId = nextId.v;
  spawnSocialNpc(entities, nextId, CUSTODIAN, CUSTODIAN_ID, poi.x + poi.w - 4, poi.y + 4, { weapon: 'knife' });
  spawnAmbientNpc(entities, nextId, 'Черноременный у койки', Faction.CULTIST, Occupation.PILGRIM, poi.x + 3, poi.y + 7, [{ defId: 'bread', count: 1 }], 'pipe');
  spawnAmbientNpc(entities, nextId, 'Сосед без места', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 6, poi.y + 2, [{ defId: 'siren_instruction', count: 1 }]);

  seedSvodContainers(world, poi, custodianId);
  spawnSvodMonster(world, entities, nextId, poi, MonsterKind.IDOL, Math.floor(poi.w / 2), Math.floor(poi.h / 2) + 1, 1, 'Идол-якорь Свода');
  spawnSvodMonster(world, entities, nextId, poi, MonsterKind.SHADOW, poi.w - 3, poi.h - 3, 1, 'Тень у чужого запаса');

  for (const defId of [
    'siren_instruction',
    'emergency_roster',
    'cleaning_kit',
    'cult_supply_list',
    'meat_rune',
    'bread',
  ]) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}

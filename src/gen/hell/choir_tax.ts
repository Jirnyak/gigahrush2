/* ── Hell choir tax: capped PSI combat/trade/extraction POI ───── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W, Cell, ContainerKind, DoorState, EntityType, AIGoal, Faction, Feature,
  FloorLevel, MonsterKind, Occupation, QuestType, RoomType, Tex,
  msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  connectProtectedRoom, connectToNetwork, findClearArea, protectRoom, rng, stampRoom,
} from '../shared';
import { genLog } from '../log';
import { isPlayerEntity } from '../../systems/player_actor';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const ROOM_W = 31;
const ROOM_H = 25;
const ROUTE_MAX = 96;

const GUIDE_ID = 'hell18_burned_guide_arseny';
const TAXMAN_ID = 'hell18_cult_taxman';
const LIQUIDATOR_ID = 'hell18_last_liquidator';
const OUTCOME_EVENT_TAG = 'hell18_outcome';
const BRANCH_EVENT_TAG = 'hell18_bargain';
const BRANCH_RADIUS = 18;
const BRANCH_RADIUS2 = BRANCH_RADIUS * BRANCH_RADIUS;

export const HELL18_CHOIR_MONSTER_CAP = 8;
export const HELL18_CHOIR_CULTIST_CAP = 3;
export const HELL18_CHOIR_REWARD_CLAIM_CAP = 5;
export const HELL18_CHOIR_BACKLASH_CAP = 4;

type ChoirBranch = 'pay' | 'refuse' | 'fight' | 'steal';

interface ChoirBranchSpec {
  label: string;
  message: string;
  color: string;
  psiLoss: number;
  hpPerMissingPsi: number;
  severity: 3 | 4 | 5;
  threats: readonly MonsterKind[];
}

interface ChoirSite {
  floor: FloorLevel;
  roomId: number;
  zoneId: number;
  x: number;
  y: number;
  taxmanId: number;
  cashboxId: number;
  refusalContainerId: number;
  branches: Record<ChoirBranch, boolean>;
  backlashSpawned: number;
  backlashIds: number[];
}

const BRANCH_SPECS: Record<ChoirBranch, ChoirBranchSpec> = {
  pay: {
    label: 'налог уплачен',
    message: 'Касса приняла мясо. ПСИ-давление упало, но Пахом запомнил вашу сдачу.',
    color: '#dca',
    psiLoss: 2,
    hpPerMissingPsi: 0,
    severity: 3,
    threats: [],
  },
  refuse: {
    label: 'налог отвергнут',
    message: 'Отказная плита щелкнула. Мясо осталось при вас, зато рядом поднимается Тень.',
    color: '#fa8',
    psiLoss: 4,
    hpPerMissingPsi: 1,
    severity: 4,
    threats: [MonsterKind.SHADOW],
  },
  fight: {
    label: 'сигнал сбит силой',
    message: 'Идол сбит. Получаете ПСИ-удар; из стен идут Глаз и Тень.',
    color: '#f66',
    psiLoss: 6,
    hpPerMissingPsi: 1,
    severity: 5,
    threats: [MonsterKind.EYE, MonsterKind.SHADOW],
  },
  steal: {
    label: 'касса вскрыта',
    message: 'Касса вскрыта. Содержимое ваше, но недоимка вызвала Тварь, Глаз и Тень.',
    color: '#f84',
    psiLoss: 8,
    hpPerMissingPsi: 1,
    severity: 5,
    threats: [MonsterKind.SHADOW, MonsterKind.TVAR, MonsterKind.EYE],
  },
};

let activeWorld: World | null = null;
let activeEntities: Entity[] | null = null;
let activeSite: ChoirSite | null = null;

const GUIDE_DEF: PlotNpcDef = {
  name: 'Арсений Обгорелый',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 260, maxHp: 260, money: 35, speed: 0.9,
  inventory: [
    { defId: 'holy_water', count: 1 },
    { defId: 'bandage', count: 1 },
  ],
  talkLines: [
    'Не стой под хором. Там плиты считают шаги; выход дешевле открыть мясом.',
    'Две лампы подряд - мой ход наружу. Третья уже врёт, там пепельная плита.',
    'Можно платить мясом. Можно бить идол. Можно унести раненого. Нельзя ждать.',
  ],
  talkLinesPost: [
    'Если хор стих, не стой на месте. После паузы из боковой стены лезут тени.',
    'Ликвидатора вывели по слову. Теперь быстро: горячий ход долго открытым не бывает.',
  ],
  talkQuestResponse: 'Принял. Веду его по горячему ходу, пока хор занят тобой.',
};

const TAXMAN_DEF: PlotNpcDef = {
  name: 'Пахом Мясной Налог',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 420, maxHp: 420, money: 210, speed: 0.75,
  inventory: [
    { defId: 'psi_meat_hook', count: 1 },
    { defId: 'meat_rune', count: 1 },
    { defId: 'rawmeat', count: 2 },
  ],
  talkLines: [
    'Три куска мяса в кассу - и проходишь без драки.',
    'Голос в банке можно сдать мне за стабилизатор. Оставишь себе - будешь отбиваться сам.',
    'Касса рядом. Воруй аккуратно: пол мокрый, следы остаются.',
  ],
  talkLinesPost: [
    'Налог закрыт. Дальше беги к горячему ходу, пока плиты не включились снова.',
    'Не открывай банку при идоле. Сработает новая ведомость, и опять полезут сторожа.',
  ],
};

const LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Капрал Шрамко',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 160, maxHp: 160, money: 18, speed: 0.55,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 5 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Группа кончилась. Я выжил, потому что меня завалило под ребрами и не добили.',
    'Арсений знает горячий ход. Передай ему, что я живой, пока не доказано обратное.',
    'Идол держит сигнал на кассе. Сломай его - наверху поверят, что мы не просто пропали.',
  ],
  talkLinesPost: [
    'Если выберусь, скажу наверху: внизу берут мясом, патронами и людьми.',
    'На табличке уже пишут наши фамилии по слогам. Пора уходить.',
  ],
};

registerSideQuest(GUIDE_ID, GUIDE_DEF, [
  {
    id: 'hell18_break_altar_signal',
    giverNpcId: GUIDE_ID,
    type: QuestType.KILL,
    desc: 'Арсений Обгорелый: «Сломай сигнальный идол мясного хора. Один идол, один выход, без второй волны.»',
    targetMonsterKind: MonsterKind.IDOL,
    killNeeded: 1,
    rewardItem: 'holy_water',
    rewardCount: 1,
    extraRewards: [{ defId: 'psi_dust', count: 1 }],
    relationDelta: 8,
    xpReward: 140,
    moneyReward: 55,
  },
]);

registerSideQuest(TAXMAN_ID, TAXMAN_DEF, [
  {
    id: 'hell18_pay_cult_tax',
    giverNpcId: TAXMAN_ID,
    type: QuestType.FETCH,
    desc: 'Пахом Мясной Налог: «Три куска сырого мяса в кассу хора. Заплатишь мясом - сбережёшь патроны.»',
    targetItem: 'rawmeat',
    targetCount: 3,
    rewardItem: 'meat_rune',
    rewardCount: 1,
    extraRewards: [{ defId: 'psi_dust', count: 1 }],
    relationDelta: 6,
    xpReward: 80,
    moneyReward: 0,
  },
  {
    id: 'hell18_take_psi_cache',
    giverNpcId: TAXMAN_ID,
    type: QuestType.FETCH,
    desc: 'Пахом Мясной Налог: «Принеси голос в банке из кассы. Себе оставишь - будет награда без меня, отдашь - стабилизатор.»',
    targetItem: 'bottled_voice',
    targetCount: 1,
    rewardItem: 'psi_stabilizer',
    rewardCount: 1,
    extraRewards: [{ defId: 'holy_water', count: 1 }],
    relationDelta: 4,
    xpReward: 95,
    moneyReward: 30,
  },
]);

registerSideQuest(LIQUIDATOR_ID, LIQUIDATOR_DEF, [
  {
    id: 'hell18_extract_last_liquidator',
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.TALK,
    desc: 'Капрал Шрамко: «Дай Арсению знак на выход. Он {dir}. Не задерживайся: это эвакуация, не зачистка.»',
    targetNpcId: GUIDE_ID,
    rewardItem: 'liquidator_ration',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_762', count: 10 }],
    relationDelta: 10,
    xpReward: 120,
    moneyReward: 70,
  },
]);

const OUTCOME_BY_QUEST: Record<string, { name: string; tags: string[]; severity: 3 | 4 | 5 }> = {
  hell18_break_altar_signal: {
    name: 'Доказательство снизу: сигнальная плита мясного хора сломана.',
    tags: ['hell18', 'ritual_break', 'cult_signal', 'proof'],
    severity: 5,
  },
  hell18_extract_last_liquidator: {
    name: 'Исход снизу: последний ликвидатор получил путь к выходу.',
    tags: ['hell18', 'extraction', 'liquidator', 'proof'],
    severity: 4,
  },
  hell18_pay_cult_tax: {
    name: 'Исход снизу: мясной налог уплачен, бой отложен.',
    tags: ['hell18', 'cult_tax', 'resource_sacrifice'],
    severity: 3,
  },
  hell18_take_psi_cache: {
    name: 'Доказательство снизу: голос из ПСИ-кассы вынесен из хора.',
    tags: ['hell18', 'psi_cache', 'proof'],
    severity: 4,
  },
};

registerWorldEventObserver(handleHell18QuestOutcome);

export function generateHell18ChoirTax(world: World, entities: Entity[], nextId: { v: number }): void {
  activeWorld = world;
  activeEntities = entities;
  activeSite = null;

  const site = findChoirSite(world);
  const room = stampRoom(world, world.rooms.length, RoomType.HQ, site.x, site.y, ROOM_W, ROOM_H, -1);
  room.name = 'Налоговый хор мясного порога';
  room.wallTex = Tex.GUT;
  room.floorTex = Tex.F_MEAT;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.GUT, Tex.F_MEAT);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  connectToNetwork(world, room);
  forceChoirConnection(world, room);
  addFleeExit(world, room);

  decorateChoir(world, room);
  const taxmanId = spawnQuestNpc(world, entities, nextId, room, TAXMAN_ID, TAXMAN_DEF, 4, 12, 0, 'psi_meat_hook');
  spawnQuestNpc(world, entities, nextId, room, GUIDE_ID, GUIDE_DEF, ROOM_W - 5, ROOM_H - 4, Math.PI, 'knife');
  spawnQuestNpc(world, entities, nextId, room, LIQUIDATOR_ID, LIQUIDATOR_DEF, ROOM_W - 7, 5, Math.PI / 2, 'makarov');

  spawnChoirCultists(world, room, entities, nextId);
  spawnChoirMonsters(world, room, entities, nextId);
  const cashboxId = addChoirCache(world, room, taxmanId);
  const refusalContainerId = addChoirRefusalLedger(world, room);
  dropChoirTraces(world, room, entities, nextId);

  const cx = world.wrap(room.x + (room.w >> 1));
  const cy = world.wrap(room.y + (room.h >> 1));
  activeSite = {
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(cx, cy)],
    x: cx + 0.5,
    y: cy + 0.5,
    taxmanId,
    cashboxId,
    refusalContainerId,
    branches: { pay: false, refuse: false, fight: false, steal: false },
    backlashSpawned: 0,
    backlashIds: [],
  };

  genLog(`[FLOOR18_HELL] ${room.name} at (${room.x}, ${room.y}) room #${room.id}; enemies ${HELL18_CHOIR_MONSTER_CAP + HELL18_CHOIR_CULTIST_CAP}, reward claims ${HELL18_CHOIR_REWARD_CLAIM_CAP}`);
}

export function getHell18ChoirTaxDebugSite(): ChoirSite | null {
  return activeSite ? {
    ...activeSite,
    branches: { ...activeSite.branches },
    backlashIds: [...activeSite.backlashIds],
  } : null;
}

export function resetHell18ChoirTaxForTests(): void {
  activeWorld = null;
  activeEntities = null;
  activeSite = null;
}

function handleHell18QuestOutcome(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(BRANCH_EVENT_TAG)) return;
  if (event.type === 'quest_completed' && !event.tags.includes(OUTCOME_EVENT_TAG)) {
    const sideQuestId = event.data?.sideQuestId;
    if (typeof sideQuestId === 'string') {
      const outcome = OUTCOME_BY_QUEST[sideQuestId];
      if (outcome) {
        publishEvent(state, {
          type: 'quest_completed',
          floor: event.floor,
          actorId: event.actorId,
          actorName: event.actorName,
          actorFaction: event.actorFaction,
          targetName: outcome.name,
          severity: outcome.severity,
          privacy: 'local',
          tags: [OUTCOME_EVENT_TAG, ...outcome.tags],
          data: {
            sideQuestId,
            sourceEventId: event.id,
            cappedMonsters: HELL18_CHOIR_MONSTER_CAP,
            cappedCultists: HELL18_CHOIR_CULTIST_CAP,
            cappedRewardClaims: HELL18_CHOIR_REWARD_CLAIM_CAP,
          },
        });
      }
      const branch = branchForHell18Quest(sideQuestId);
      if (branch) applyHell18Branch(state, event, branch);
    }
  }
  handleHell18BranchEvent(state, event);
}

function branchForHell18Quest(sideQuestId: string): ChoirBranch | null {
  if (sideQuestId === 'hell18_pay_cult_tax') return 'pay';
  if (sideQuestId === 'hell18_break_altar_signal') return 'fight';
  if (sideQuestId === 'hell18_take_psi_cache') return 'steal';
  return null;
}

function handleHell18BranchEvent(state: GameState, event: WorldEvent): void {
  const site = activeSite;
  const world = activeWorld;
  if (!site || !world || state.currentFloor !== site.floor || event.floor !== site.floor) return;

  if (event.type === 'item_deposited' && event.containerId === site.cashboxId && event.itemId === 'rawmeat') {
    applyHell18Branch(state, event, 'pay');
    return;
  }
  if (event.type === 'item_stolen' && event.containerId === site.cashboxId) {
    applyHell18Branch(state, event, 'steal');
    return;
  }
  if (event.type === 'container_opened' && event.containerId === site.refusalContainerId) {
    applyHell18Branch(state, event, 'refuse');
    return;
  }
  if ((event.type === 'player_kill_monster' || event.type === 'npc_kill_monster')
    && event.monsterKind === MonsterKind.IDOL && eventInsideChoirSite(world, site, event)) {
    applyHell18Branch(state, event, 'fight');
    return;
  }
  if ((event.type === 'player_hurt_npc' || event.type === 'player_kill_npc')
    && (event.targetId === site.taxmanId || event.targetFaction === Faction.CULTIST)
    && eventInsideChoirSite(world, site, event)) {
    applyHell18Branch(state, event, 'fight');
  }
}

function eventInsideChoirSite(world: World, site: ChoirSite, event: WorldEvent): boolean {
  if (event.roomId === site.roomId) return true;
  if (event.x === undefined || event.y === undefined) return false;
  return world.dist2(event.x, event.y, site.x, site.y) <= BRANCH_RADIUS2;
}

function applyHell18Branch(state: GameState, source: WorldEvent, branch: ChoirBranch): void {
  const site = activeSite;
  const world = activeWorld;
  const entities = activeEntities;
  if (!site || !world || !entities || site.branches[branch]) return;

  site.branches[branch] = true;
  const spec = BRANCH_SPECS[branch];
  const drain = drainPlayerForChoir(entities, spec.psiLoss, spec.hpPerMissingPsi);
  const spawned = spawnChoirBranchBacklash(world, entities, site, spec.threats);
  state.msgs.push(msg(spec.message, state.time, spec.color));

  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.x,
    y: site.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetName: `Мясной хор: ${spec.label}`,
    itemId: source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    containerId: source.containerId,
    severity: spec.severity,
    privacy: 'local',
    tags: [BRANCH_EVENT_TAG, 'hell18', `choir_${branch}`, 'cult_attention', branch, 'psi', 'medicine', 'backlash'],
    data: {
      sourceEventId: source.id,
      branch,
      psiLost: drain.psiLost,
      hpLost: drain.hpLost,
      spawned,
      backlashCap: HELL18_CHOIR_BACKLASH_CAP,
    },
  });
}

function drainPlayerForChoir(
  entities: readonly Entity[],
  psiLoss: number,
  hpPerMissingPsi: number,
): { psiLost: number; hpLost: number } {
  const player = entities.find(entity => isPlayerEntity(entity) && entity.alive);
  if (!player) return { psiLost: 0, hpLost: 0 };

  let psiLost = 0;
  if (player.rpg && psiLoss > 0) {
    const before = player.rpg.psi;
    player.rpg.psi = Math.max(0, player.rpg.psi - psiLoss);
    psiLost = Math.round((before - player.rpg.psi) * 10) / 10;
  }

  let hpLost = 0;
  const missingPsi = Math.max(0, psiLoss - psiLost);
  if (missingPsi > 0 && hpPerMissingPsi > 0 && player.hp !== undefined) {
    hpLost = Math.min(Math.max(0, player.hp - 1), Math.ceil(missingPsi * hpPerMissingPsi));
    player.hp = Math.max(1, player.hp - hpLost);
  }
  return { psiLost, hpLost };
}

function spawnChoirBranchBacklash(
  world: World,
  entities: Entity[],
  site: ChoirSite,
  kinds: readonly MonsterKind[],
): number {
  let spawned = 0;
  const player = entities.find(entity => isPlayerEntity(entity) && entity.alive);
  for (const kind of kinds) {
    if (site.backlashSpawned >= HELL18_CHOIR_BACKLASH_CAP) break;
    const pos = findChoirBranchSpawn(world, site, site.backlashSpawned + spawned);
    if (!pos) break;
    const id = nextEntityId(entities);
    const def = MONSTERS[kind];
    const zoneLevel = world.zones[site.zoneId]?.level ?? 12;
    const level = zoneLevel + (kind === MonsterKind.EYE ? 3 : 2);
    const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level)));
    const monster: Entity = {
      id,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.atan2(site.y - pos.y - 0.5, site.x - pos.x - 0.5),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, level),
      sprite: monsterSpr(kind),
      name: kind === MonsterKind.EYE ? 'Глаз у кассы' : kind === MonsterKind.SHADOW ? 'Тень у отказной плиты' : 'Тварь мясной недоимки',
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: def.attackRate,
      ai: { goal: player ? AIGoal.HUNT : AIGoal.WANDER, tx: player?.x ?? site.x, ty: player?.y ?? site.y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(level),
    };
    entities.push(monster);
    site.backlashSpawned++;
    site.backlashIds.push(id);
    spawned++;
  }
  return spawned;
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function findChoirBranchSpawn(world: World, site: ChoirSite, order: number): { x: number; y: number } | null {
  const room = world.rooms[site.roomId];
  if (!room) return null;
  const ring = [
    [-8, -5], [8, -5], [-8, 5], [8, 5], [0, -7], [0, 7], [-11, 0], [11, 0],
  ] as const;
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ring.length; i++) {
      const [dx, dy] = ring[(i + order + pass * 3) % ring.length];
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  for (let dy = 2; dy < room.h - 2; dy++) {
    for (let dx = 2; dx < room.w - 2; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  return null;
}

function findChoirSite(world: World): { x: number; y: number } {
  const cx = W >> 1;
  const cy = W >> 1;
  const clear = findClearArea(world, cx, cy, ROOM_W, ROOM_H, 180, 360);
  if (clear) return clear;

  for (let attempt = 0; attempt < 2600; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = rng(150, 380);
    const x = world.wrap(cx + Math.round(Math.cos(angle) * dist) - (ROOM_W >> 1));
    const y = world.wrap(cy + Math.round(Math.sin(angle) * dist) - (ROOM_H >> 1));
    if (canReserveChoir(world, x, y)) return { x, y };
  }

  for (let attempt = 0; attempt < 1800; attempt++) {
    const x = rng(8, W - ROOM_W - 8);
    const y = rng(8, W - ROOM_H - 8);
    if (canReserveChoir(world, x, y)) return { x, y };
  }

  return { x: world.wrap(cx + 230), y: world.wrap(cy - 190) };
}

function canReserveChoir(world: World, x: number, y: number): boolean {
  for (let dy = -3; dy <= ROOM_H + 3; dy++) {
    for (let dx = -3; dx <= ROOM_W + 3; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function forceChoirConnection(world: World, room: Room): void {
  if (hasExternalOpening(world, room)) return;
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  const probes: [number, number, number, number][] = [
    [midX, room.y - 1, 0, -1],
    [midX, room.y + room.h, 0, 1],
    [room.x - 1, midY, -1, 0],
    [room.x + room.w, midY, 1, 0],
  ];
  let bestPath: number[] | null = null;

  for (const [sx, sy, dx, dy] of probes) {
    const path: number[] = [];
    let x = world.wrap(sx);
    let y = world.wrap(sy);
    for (let step = 0; step < ROUTE_MAX; step++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.LIFT || (step > 0 && world.aptMask[ci])) break;
      const walkable = world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.WATER;
      if (step > 0 && walkable && world.roomMap[ci] !== room.id) {
        if (!bestPath || path.length < bestPath.length) bestPath = [...path];
        break;
      }
      path.push(ci);
      x = world.wrap(x + dx);
      y = world.wrap(y + dy);
    }
  }

  if (!bestPath) return;
  for (const ci of bestPath) carveRouteCell(world, ci, Tex.F_MEAT);
}

function hasExternalOpening(world: World, room: Room): boolean {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
      if (world.aptMask[ci]) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (world.roomMap[world.idx(room.x + dx + ox, room.y + dy + oy)] === room.id) return true;
      }
    }
  }
  return false;
}

function addFleeExit(world: World, room: Room): void {
  const doorX = world.wrap(room.x + room.w);
  const doorY = world.wrap(room.y + room.h - 5);
  const doorI = world.idx(doorX, doorY);
  world.aptMask[doorI] = 0;
  world.cells[doorI] = Cell.DOOR;
  world.wallTex[doorI] = Tex.DOOR_METAL;
  world.doors.set(doorI, {
    idx: doorI,
    state: DoorState.CLOSED,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  if (!room.doors.includes(doorI)) room.doors.push(doorI);

  for (let step = 1; step <= ROUTE_MAX; step++) {
    let touchesOpenFloor = false;
    const x = room.x + room.w + step;
    for (let side = -1; side <= 1; side++) {
      const y = doorY + side;
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.LIFT || world.aptMask[ci] || world.roomMap[ci] >= 0) continue;
      if (step > 3 && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR)) touchesOpenFloor = true;
      carveRouteCell(world, ci, Tex.F_MEAT);
      if (side === 0 && (step === 3 || step === 9 || step === 15)) {
        world.features[ci] = Feature.LAMP;
        addLocalLight(world, x, y, 6);
      }
    }
    if (touchesOpenFloor) return;
  }
}

function carveRouteCell(world: World, ci: number, floorTex: Tex): void {
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = 0;
  world.aptMask[ci] = 0;
  world.roomMap[ci] = -1;
  world.features[ci] = Feature.NONE;
}

function decorateChoir(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  const cx = rx + Math.floor(room.w / 2);
  const cy = ry + Math.floor(room.h / 2);

  for (let dy = 2; dy < room.h - 2; dy++) {
    const gap = Math.abs(dy - Math.floor(room.h / 2)) <= 2;
    if (gap) continue;
    makeInteriorWall(world, rx + 10, ry + dy);
    makeInteriorWall(world, rx + 21, ry + dy);
  }

  for (let dx = 11; dx <= 20; dx++) {
    if (dx === 15) continue;
    const ci = world.idx(rx + dx, cy + 4);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    world.floorTex[ci] = Tex.F_GUT;
  }

  placeFeature(world, cx, cy, Feature.APPARATUS, 7);
  placeFeature(world, rx + 4, ry + 4, Feature.SHELF, 4);
  placeFeature(world, rx + 5, ry + 12, Feature.TABLE, 4);
  placeFeature(world, rx + room.w - 5, ry + room.h - 5, Feature.LAMP, 8);
  placeFeature(world, rx + room.w - 7, ry + 5, Feature.TABLE, 5);
  placeFeature(world, rx + room.w - 4, ry + room.h - 7, Feature.SCREEN, 5);

  for (const [dx, dy] of [[0, -6], [5, -4], [6, 0], [5, 4], [0, 6], [-5, 4], [-6, 0], [-5, -4]] as const) {
    placeFeature(world, cx + dx, cy + dy, Feature.CANDLE, 5);
  }

  world.wallTex[world.idx(cx, room.y - 1)] = Tex.ICON;
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 6, 0.55, 18180, 150, 24, 70, false);
  stampSurfaceSplat(world, rx + room.w - 5, ry + room.h - 5, 0.5, 0.5, 4, 0.35, 18181, 220, 120, 35, false);
}

function makeInteriorWall(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.GUT;
  world.floorTex[ci] = 0;
  world.roomMap[ci] = -1;
  world.features[ci] = Feature.NONE;
}

function placeFeature(world: World, x: number, y: number, feature: Feature, lightRadius: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = feature;
  addLocalLight(world, x, y, lightRadius);
}

function addLocalLight(world: World, lx: number, ly: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const ci = world.idx(lx + dx, ly + dy);
      const brightness = 1 - Math.sqrt(d2) / radius;
      if (brightness > world.light[ci]) world.light[ci] = brightness;
    }
  }
}

function spawnQuestNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  plotNpcId: string,
  _def: PlotNpcDef,
  dx: number,
  dy: number,
  angle: number,
  weapon: string,
): number {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra: {
      rpg: randomRPG(plotNpcId === TAXMAN_ID ? 9 : 7),
    },
  });
  return npc.id;
}

function spawnChoirCultists(world: World, room: Room, entities: Entity[], nextId: { v: number }): void {
  const placements: readonly [number, number, string, string][] = [
    [12, 6, 'Певчий налога', 'rebar'],
    [18, 6, 'Певчий выхода', 'psi_strike'],
    [15, 18, 'Певчий сдачи', 'psi_meat_hook'],
  ];
  for (const [dx, dy, name, weapon] of placements) {
    const x = world.wrap(room.x + dx);
    const y = world.wrap(room.y + dy);
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: 1.05,
      sprite: Occupation.PILGRIM,
      name,
      needs: freshNeeds(),
      hp: 210,
      maxHp: 210,
      money: 12,
      ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
      inventory: [{ defId: weapon, count: 1 }],
      weapon,
      faction: Faction.CULTIST,
      occupation: Occupation.PILGRIM,
      questId: -1,
      canGiveQuest: false,
      rpg: randomRPG(8),
    });
  }
}

function spawnChoirMonsters(world: World, room: Room, entities: Entity[], nextId: { v: number }): void {
  const placements: readonly { kind: MonsterKind; dx: number; dy: number; bonus: number; name?: string; phasing?: boolean }[] = [
    { kind: MonsterKind.IDOL, dx: 15, dy: 12, bonus: 5, name: 'Сигнальный идол хора' },
    { kind: MonsterKind.EYE, dx: 13, dy: 8, bonus: 3, name: 'Глаз у кассы' },
    { kind: MonsterKind.EYE, dx: 17, dy: 8, bonus: 3, name: 'Глаз у выхода' },
    { kind: MonsterKind.SHADOW, dx: 12, dy: 16, bonus: 2 },
    { kind: MonsterKind.SHADOW, dx: 18, dy: 16, bonus: 2 },
    { kind: MonsterKind.TVAR, dx: 11, dy: 12, bonus: 1 },
    { kind: MonsterKind.KHOROVAYA_MATKA, dx: 19, dy: 12, bonus: 5, name: 'Хоровая Матка мясного порога' },
    { kind: MonsterKind.POLZUN, dx: 15, dy: 20, bonus: 2, name: 'Ползун под кассой' },
  ];
  for (const p of placements) spawnChoirMonster(world, room, entities, nextId, p);
}

function spawnChoirMonster(
  world: World,
  room: Room,
  entities: Entity[],
  nextId: { v: number },
  placement: { kind: MonsterKind; dx: number; dy: number; bonus: number; name?: string; phasing?: boolean },
): void {
  const x = world.wrap(room.x + placement.dx);
  const y = world.wrap(room.y + placement.dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  const def = MONSTERS[placement.kind];
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 12;
  const level = zoneLevel + placement.bonus;
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level)));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(placement.kind),
    name: placement.name,
    hp,
    maxHp: hp,
    monsterKind: placement.kind,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: placement.phasing,
  };
  entities.push(monster);
}

function addChoirCache(world: World, room: Room, ownerNpcId: number): number {
  const x = world.wrap(room.x + 4);
  const y = world.wrap(room.y + 4);
  const inventory: WorldContainer['inventory'] = [
    { defId: 'bottled_voice', count: 1 },
    { defId: 'psi_dust', count: 1 },
    { defId: 'holy_water', count: 1 },
    { defId: 'ammo_energy', count: 1 },
    { defId: 'meat_rune', count: 1 },
    { defId: 'bandage', count: 1 },
  ];
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.CASHBOX,
    name: 'Касса мясного хора',
    inventory,
    capacitySlots: 8,
    ownerNpcId,
    ownerName: TAXMAN_DEF.name,
    faction: Faction.CULTIST,
    access: 'owner',
    lockDifficulty: 5,
    discovered: true,
    tags: ['hell18', 'choir_tax', 'psi_cache', 'owner', 'one_shot', 'pay_or_steal'],
  });
  return id;
}

function addChoirRefusalLedger(world: World, room: Room): number {
  const x = world.wrap(room.x + room.w - 7);
  const y = world.wrap(room.y + 6);
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x,
    y,
    floor: FloorLevel.HELL,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Плита отказа от мясного налога',
    inventory: [
      {
        defId: 'note',
        count: 1,
        data: 'Отказная плита: не платишь мясом - получаешь ПСИ-удар и тень у выхода. Подпись не нужна.',
      },
      { defId: 'bandage', count: 1 },
    ],
    capacitySlots: 4,
    ownerName: TAXMAN_DEF.name,
    faction: Faction.CULTIST,
    access: 'public',
    discovered: true,
    tags: ['hell18', 'choir_tax', 'refuse', 'cult_attention', 'medicine'],
  });
  return id;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function dropChoirTraces(world: World, room: Room, entities: Entity[], nextId: { v: number }): void {
  dropItem(world, entities, nextId, room.x + 6, room.y + 15, 'rawmeat', 2);
  dropNote(world, entities, nextId, room.x + room.w - 6, room.y + room.h - 7,
    'Уголь Арсения: две лампы подряд ведут к выходу. Если слышишь третью, ты снова у пепельной плиты.');
  dropNote(world, entities, nextId, room.x + 14, room.y + 5,
    'Ведомость мясного хора: 3 куска сырого мяса открывают проход без боя. Банку с голосом не вскрывать у идола.');
  dropNote(world, entities, nextId, room.x + room.w - 8, room.y + 6,
    'Журнал Шрамко: группа списана, патроны почти списаны, но доказательство снизу ещё можно вынести наверх.');
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count: number,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function dropNote(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  data: string,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId: 'note', count: 1, data }],
  });
}

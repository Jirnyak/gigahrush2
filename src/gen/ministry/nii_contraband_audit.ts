/* ── Ревизия НИИ: пробы уходят на рынок ─────────────────────── */

import {
  Cell,
  ContainerKind,
  DoorState,
  Faction,
  Feature,
  FloorLevel,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const ROOM_NAME = 'Ревизионная НИИ: утечка проб';
const QUEST_FIND_ROOM = 'nii_audit_find_room';
const QUEST_EXPOSE = 'nii_audit_expose_chain';
const QUEST_SELL = 'nii_audit_sell_sample';
const QUEST_CONCEAL = 'nii_audit_conceal_forgery';
const CONTENT_TAGS = ['nii', 'sample', 'contraband', 'ministry'] as const;
const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const INTERN_ID = 'nii_audit_intern_without_clearance';

const RUNNER_DEF: PlotNpcDef = {
  name: 'Курьер с нулевой накладной',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 95, maxHp: 95, money: 25, speed: 1.05,
  inventory: [
    { defId: 'nii_sample_container', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Ищете ревизию НИИ? Идите на запах мокрой печати и дорогой пустой тары.',
    'У меня накладная нулевая: груз есть, а по документам он уже исчез.',
    'Дойдёте до ревизионной комнаты - поймёте, кому выгодна пустая пробирка.',
  ],
  talkLinesPost: [
    'Комнату нашли. Теперь главное - не стать приложением к ведомости.',
    'Нулевые накладные любят тех, кто не спрашивает второй экземпляр.',
  ],
};

const IRINA_DEF: PlotNpcDef = {
  name: 'Ирина Нулевая',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 130, maxHp: 130, money: 110, speed: 0.82,
  inventory: [
    { defId: 'nii_sample_container', count: 1 },
    { defId: 'nii_forged_audit', count: 1 },
    { defId: 'psi_dust', count: 1 },
  ],
  talkLines: [
    'Ревизия НИИ. Не трогайте пробирки голыми формулировками.',
    'Серебристая проба по акту пустая. Если акт правильный, проба перестаёт существовать для всех, кроме рынка.',
    'Подложный акт лучше скандала: НИИ сохранит лицо, а вы получите доступ к чистой карантинной бумаге.',
    'Ликвидаторы любят слово "контрабанда". Они произносят его как выстрел.',
  ],
  talkLinesPost: [
    'Ревизия закрыта в допустимую сторону.',
    'Пробирки молчат. Это редкий лабораторный результат.',
  ],
};

const MAXIM_DEF: PlotNpcDef = {
  name: 'Максим Опечаткин',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 240, maxHp: 240, money: 150, speed: 0.95,
  inventory: [
    { defId: 'liquidator_token', count: 1 },
    { defId: 'ammo_9mm', count: 16 },
    { defId: 'denunciation', count: 1 },
  ],
  talkLines: [
    'Максим Опечаткин. Если НИИ продаёт пробы налево, значит справа уже лежит труп.',
    'Нужна ведомость утечки. Не слух, не пробирка, а бумага с цепочкой шкафов.',
    'Принесёте ведомость - я подниму опись. Учёные будут злиться, зато рынок потеряет адрес.',
  ],
  talkLinesPost: [
    'Цепочка подшита. Теперь по каждому шкафу видно, где НИИ, а где рынок.',
    'Хорошее доказательство пахнет не правдой, а страхом тех, кто подписывал.',
  ],
};

const SENYA_DEF: PlotNpcDef = {
  name: 'Сеня Безнакладной',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 105, maxHp: 105, money: 260, speed: 0.88,
  inventory: [
    { defId: 'nii_market_receipt', count: 1 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'cigs', count: 3 },
  ],
  talkLines: [
    'Я не рынок. Я человек, которому рынок носит остатки, когда не хочет светиться сам.',
    'Серебристая проба стоит дороже правды, потому что правду нельзя курить, мазать и перепродать.',
    'Принесёте пробу - получите деньги и лист с печатью. Бумага потом скажет, что вас здесь не было.',
  ],
  talkLinesPost: [
    'Проба ушла тихо. Тихо - это когда все знают и никто не называет.',
    'Если ликвидатор спросит, я продавал только пустую тару.',
  ],
};

const INTERN_DEF: PlotNpcDef = {
  name: 'Практикантка без допуска',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'nii_sample_container', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Мне сказали не заходить за клетку. Значит, самое важное лежит за клеткой.',
    'Допуска нет, зато есть пробирка, которая всем мешает.',
  ],
  talkLinesPost: [
    'Если меня спросят, я была в коридоре и ничего не поняла.',
  ],
};

registerSideQuest('nii_audit_runner', RUNNER_DEF, [
  {
    id: QUEST_FIND_ROOM,
    giverNpcId: 'nii_audit_runner',
    type: QuestType.VISIT,
    desc: 'Курьер с нулевой накладной: «Найдите ревизионную НИИ {dir}. Там пробирки исчезают только на бумаге.»',
    targetRoomName: ROOM_NAME,
    rewardItem: 'nii_sample_container', rewardCount: 1,
    relationDelta: 4, xpReward: 30, moneyReward: 20,
  },
]);

registerSideQuest('nii_auditor_irina', IRINA_DEF, [
  {
    id: QUEST_CONCEAL,
    giverNpcId: 'nii_auditor_irina',
    type: QuestType.FETCH,
    desc: 'Ирина Нулевая: «Принесите подложный акт НИИ. Утечка станет ошибкой учёта, а не преступлением.»',
    targetItem: 'nii_forged_audit', targetCount: 1,
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'psi_dust', count: 1 }],
    relationDelta: 12, xpReward: 80, moneyReward: 90,
  },
]);

registerSideQuest('nii_liquidator_maxim', MAXIM_DEF, [
  {
    id: QUEST_EXPOSE,
    giverNpcId: 'nii_liquidator_maxim',
    type: QuestType.FETCH,
    desc: 'Максим Опечаткин: «Ведомость утечки НИИ. С ней я закрою цепочку проб от шкафа до рынка.»',
    targetItem: 'nii_contraband_manifest', targetCount: 1,
    rewardItem: 'liquidator_token', rewardCount: 1,
    extraRewards: [{ defId: 'official_permit_slip', count: 1 }, { defId: 'ammo_9mm', count: 10 }],
    relationDelta: 12, xpReward: 90, moneyReward: 120,
  },
]);

registerSideQuest('nii_market_senya', SENYA_DEF, [
  {
    id: QUEST_SELL,
    giverNpcId: 'nii_market_senya',
    type: QuestType.FETCH,
    desc: 'Сеня Безнакладной: «Серебристую пробу НИИ - мне. Остальное пусть спорит в протоколах.»',
    targetItem: 'slime_sample_silver', targetCount: 1,
    rewardItem: 'forged_stamp_sheet', rewardCount: 1,
    extraRewards: [{ defId: 'nii_market_receipt', count: 1 }],
    relationDelta: 8, xpReward: 70, moneyReward: 260,
  },
]);

registerAuthoredNpc({
  id: INTERN_ID,
  npc: INTERN_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'nii', 'sample', 'intern'],
});

interface OutcomeDef {
  label: string;
  itemId: string;
  branchTag: string;
  color: string;
  line: string;
  primaryFaction: Faction;
  relationDeltas: readonly { faction: Faction; delta: number }[];
  privacy: 'local' | 'secret';
}

const OUTCOMES: Record<string, OutcomeDef> = {
  [QUEST_EXPOSE]: {
    label: 'Цепочка НИИ раскрыта',
    itemId: 'nii_contraband_manifest',
    branchTag: 'expose',
    color: '#8cf',
    line: 'Ведомость НИИ ушла ликвидаторам: рынок теряет адрес, учёные теряют лицо.',
    primaryFaction: Faction.LIQUIDATOR,
    relationDeltas: [
      { faction: Faction.LIQUIDATOR, delta: 5 },
      { faction: Faction.CITIZEN, delta: 2 },
      { faction: Faction.SCIENTIST, delta: -4 },
      { faction: Faction.WILD, delta: -5 },
    ],
    privacy: 'local',
  },
  [QUEST_SELL]: {
    label: 'Проба НИИ продана',
    itemId: 'slime_sample_silver',
    branchTag: 'sell',
    color: '#fc6',
    line: 'Серебристая проба ушла посреднику: рынок платит сейчас, ревизия придёт позже.',
    primaryFaction: Faction.WILD,
    relationDeltas: [
      { faction: Faction.WILD, delta: 5 },
      { faction: Faction.SCIENTIST, delta: -3 },
      { faction: Faction.LIQUIDATOR, delta: -3 },
    ],
    privacy: 'secret',
  },
  [QUEST_CONCEAL]: {
    label: 'Утечка НИИ закрыта актом',
    itemId: 'nii_forged_audit',
    branchTag: 'conceal',
    color: '#c8f',
    line: 'Подложный акт лёг в дело: НИИ благодарит, а ликвидаторская опись теряет зуб.',
    primaryFaction: Faction.SCIENTIST,
    relationDeltas: [
      { faction: Faction.SCIENTIST, delta: 5 },
      { faction: Faction.LIQUIDATOR, delta: -4 },
      { faction: Faction.WILD, delta: 2 },
    ],
    privacy: 'secret',
  },
};

function handleNiiAuditOutcome(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = event.data?.sideQuestId;
  if (typeof sideQuestId !== 'string') return;
  const outcome = OUTCOMES[sideQuestId];
  if (!outcome) return;

  for (const change of outcome.relationDeltas) {
    addFactionRelMutual(Faction.PLAYER, change.faction, change.delta);
  }

  publishEvent(state, {
    type: 'faction_relation_changed',
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetFaction: outcome.primaryFaction,
    targetName: outcome.label,
    itemId: outcome.itemId,
    severity: outcome.privacy === 'local' ? 4 : 3,
    privacy: outcome.privacy,
    tags: ['nii', 'sample', 'contraband', 'ministry', 'evidence', outcome.branchTag, 'faction'],
    data: {
      sideQuestId,
      sourceEventId: event.id,
      relationDeltas: outcome.relationDeltas.map(d => `${Faction[d.faction]}:${d.delta}`),
    },
  });
  state.msgs.push(msg(outcome.line, state.time, outcome.color));
}

registerWorldEventObserver(handleNiiAuditOutcome);

function addLockedEvidenceGate(world: World, room: Room, gateX: number, doorY: number): void {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    const ci = world.idx(gateX, y);
    world.features[ci] = Feature.NONE;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
  }

  const doorIdx = world.idx(gateX, doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_METAL;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.LOCKED,
    roomA: room.id,
    roomB: room.id,
    keyId: 'key',
    timer: 0,
  });
  if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addAuditContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ci = world.idx(wx, wy);
  world.addContainer({
    id: nextContainerId(world),
    x: wx,
    y: wy,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory,
    capacitySlots: 8,
    ownerNpcId,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 5 : undefined,
    discovered: true,
    tags,
  });
  setFeature(world, wx, wy, kind === ContainerKind.SAFE ? Feature.APPARATUS : Feature.SHELF);
}

function addAuditContainers(world: World, room: Room, gateX: number, irinaId: number, senyaId: number): void {
  const baseTags = [...CONTENT_TAGS];
  addAuditContainer(
    world, room, room.x + 2, room.y + 2,
    ContainerKind.CASHBOX,
    'Журнал ключей ревизии НИИ',
    'owner',
    [
      { defId: 'key', count: 1 },
      { defId: 'nii_market_receipt', count: 1 },
      { defId: 'note', count: 1, data: 'Ключ от клетки выдавать только тому, кто не знает слова "рынок".' },
    ],
    [...baseTags, 'key', 'audit'],
    Faction.SCIENTIST,
    irinaId,
    IRINA_DEF.name,
  );

  addAuditContainer(
    world, room, gateX + 2, room.y + 2,
    ContainerKind.SAFE,
    'Клетка серебристых проб НИИ',
    'faction',
    [
      { defId: 'slime_sample_silver', count: 1 },
      { defId: 'slime_sample_black', count: 1 },
      { defId: 'nii_contraband_manifest', count: 1 },
      { defId: 'note', count: 1, data: 'Серебристая проба списана как пустая тара. Курьер расписался номером чужого шкафа.' },
    ],
    [...baseTags, 'evidence', 'theft', 'audit'],
    Faction.SCIENTIST,
  );

  addAuditContainer(
    world, room, gateX + 3, room.y + room.h - 3,
    ContainerKind.FILING_CABINET,
    'Картотека списанных проб',
    'faction',
    [
      { defId: 'nii_forged_audit', count: 1 },
      { defId: 'nii_market_receipt', count: 1 },
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'blank_form', count: 2 },
    ],
    [...baseTags, 'forgery', 'paper', 'audit'],
    Faction.SCIENTIST,
  );

  addAuditContainer(
    world, room, room.x + 7, room.y + room.h - 3,
    ContainerKind.SECRET_STASH,
    'Конверт без накладной',
    'owner',
    [
      { defId: 'nii_market_receipt', count: 1 },
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    [...baseTags, 'receipt', 'market'],
    Faction.WILD,
    senyaId,
    SENYA_DEF.name,
  );
}

function findGuideSpot(world: World, spawnX: number, spawnY: number, roomId: number): { x: number; y: number } | null {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  for (let r = 2; r <= 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(sx + dx);
        const y = world.wrap(sy + dy);
        const ci = world.idx(x, y);
        if (world.cells[ci] !== Cell.FLOOR) continue;
        if (world.roomMap[ci] === roomId) continue;
        return { x, y };
      }
    }
  }
  return null;
}

export function generateNiiContrabandAudit(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: ROOM_NAME,
    w: 18, h: 12,
    minDist: 50, maxDist: 145,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const deskY = room.y + 4;
  const cy = room.y + Math.floor(room.h / 2);
  const gateX = room.x + room.w - 6;
  addLockedEvidenceGate(world, room, gateX, cy);

  for (let dx = 2; dx < gateX - room.x - 1; dx++) setFeature(world, room.x + dx, deskY, Feature.DESK);
  for (let dx = 2; dx < gateX - room.x - 1; dx += 2) setFeature(world, room.x + dx, deskY + 1, Feature.CHAIR);
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  for (let dy = 2; dy < room.h - 2; dy += 3) setFeature(world, gateX + 1, room.y + dy, Feature.APPARATUS);
  setFeature(world, room.x + 4, room.y + 2, Feature.LAMP);
  setFeature(world, gateX + 3, cy, Feature.LAMP);
  setFeature(world, room.x + 6, room.y + 2, Feature.SCREEN);
  world.wallTex[world.idx(room.x + Math.floor(room.w / 2), room.y - 1)] = Tex.POSTER_BASE + 10;
  world.wallTex[world.idx(room.x + room.w, cy)] = Tex.PORTRAIT_BASE + 14;

  const irinaId = nextId.v;
  spawnAdminNpc(entities, nextId, IRINA_DEF, 'nii_auditor_irina', room.x + 4, deskY - 1);
  spawnAdminNpc(entities, nextId, MAXIM_DEF, 'nii_liquidator_maxim', gateX - 1, cy, true, 'makarov');
  const senyaId = nextId.v;
  spawnAdminNpc(entities, nextId, SENYA_DEF, 'nii_market_senya', room.x + 7, room.y + room.h - 3);
  spawnAdminNpc(entities, nextId, INTERN_DEF, INTERN_ID, room.x + 2, room.y + room.h - 3, false);
  const guideSpot = findGuideSpot(world, spawnX, spawnY, room.id);
  if (guideSpot) spawnAdminNpc(entities, nextId, RUNNER_DEF, 'nii_audit_runner', guideSpot.x, guideSpot.y);

  addAuditContainers(world, room, gateX, irinaId, senyaId);
  addItemDrop(entities, nextId, gateX - 2, room.y + 2, 'nii_sample_container', 1);
  addItemDrop(entities, nextId, room.x + 3, room.y + room.h - 2, 'nii_market_receipt', 1);
  addItemDrop(entities, nextId, room.x + 5, room.y + room.h - 2, 'blank_form', 1);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}; AG74 NII contraband audit`);
  return { nextRoomId: room.id + 1 };
}

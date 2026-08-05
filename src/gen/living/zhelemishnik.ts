/* -- MONSTER_14: Желемышник, local zhelemish guardian ---------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS, entityDisplayName } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'monster14_zhelemishnik';
const ZONE_HUD_ID = 34;
const ROOM_W = 18;
const ROOM_H = 13;
const GUARDIAN_NAME = 'Желемышник';
const SCIENTIST_ID = 'monster14_varvara_glass';
const BUYER_ID = 'monster14_yegor_edgebuyer';

const QUEST_SAFE_PROCESS = 'monster14_safe_process_zhelemish';
const QUEST_SURRENDER_SAMPLE = 'monster14_surrender_raw_sample';
const QUEST_RISKY_SALE = 'monster14_risky_raw_sale';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [SCIENTIST_ID]: {
    name: 'Варвара Стекольная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    sprite: Occupation.SCIENTIST,
    hp: 95,
    maxHp: 95,
    money: 64,
    speed: 0.76,
    inventory: [
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'rock_salt', count: 1 },
      { defId: 'antifungal_ointment', count: 1 },
    ],
    talkLines: [
      'Кожу у стен видите? Это не штукатурка. Желемышник рядом с сырой сердцевиной.',
      'Сухой край можно снять почти честно. Сырое ядро будит голодное тело под ванной.',
      'Хотите науку - несите сырой комок в тару. Хотите еду - солите и варите, а не кладите в рот первым.',
      'Сушёный кусок можно бросить в сторону. Ползун верит еде быстрее, чем человеку.',
    ],
    talkLinesPost: [
      'Образец ушёл в акт. Погреб всё равно пахнет, но теперь пахнет доказательством.',
      'Не называйте варку лечением. Это только способ не будить кожу сразу.',
    ],
  },
  [BUYER_ID]: {
    name: 'Егор Крайпятак',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 120,
    maxHp: 120,
    money: 118,
    speed: 0.84,
    inventory: [
      { defId: 'fake_pass', count: 1 },
      { defId: 'zhelemish_dried', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    talkLines: [
      'Сырой беру дороже. Пока он холодный, Левин зовёт это курсом и молчит про подвал.',
      'Мне не нужен ваш геройский бой. Мне нужен комок без лишней фамилии.',
      'Если Желемышник встал, кидайте сушёный край. Он старую еду помнит лучше новой руки.',
    ],
    talkLinesPost: [
      'Партия ушла. Если кто-то чесаться начнёт, я скажу: сами просили дешевле.',
      'Деньги не лечат кожу. Зато быстро кончают разговор.',
    ],
  },
};

registerSideQuest(SCIENTIST_ID, NPC_DEFS[SCIENTIST_ID], [
  {
    id: QUEST_SAFE_PROCESS,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.FETCH,
    desc: 'Варвара Стекольная: «Принесите каменную соль. Обведём внешний край, сварим безопасную долю и не полезем в сырое ядро.»',
    targetItem: 'rock_salt',
    targetCount: 1,
    rewardItem: 'zhelemish_boiled',
    rewardCount: 1,
    extraRewards: [{ defId: 'zhelemish_dried', count: 1 }],
    relationDelta: 9,
    xpReward: 42,
    moneyReward: 12,
    eventTargetName: 'Внешний край желемыша обработан солью; сырое ядро оставили Желемышнику.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['monster', 'zhelemish', 'food', 'medicine_counterfeit', 'safe_processing', 'salt', 'zhelemishnik'],
    eventData: { outcome: 'safe_processing', guardianAvoided: true, rumorIds: ['rare_zhelemish_dried_ration'] },
  },
  {
    id: QUEST_SURRENDER_SAMPLE,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.FETCH,
    desc: 'Варвара Стекольная: «Сдайте сырой желемыш в банку. Не ешьте и не продавайте: свежесть нужна до первой чужой кожи.»',
    targetItem: 'zhelemish_raw',
    targetCount: 1,
    rewardItem: 'slime_sample_brown',
    rewardCount: 1,
    extraRewards: [{ defId: 'antifungal_ointment', count: 1 }],
    relationDelta: 12,
    xpReward: 48,
    moneyReward: 28,
    eventTargetName: 'Сырой желемыш сдан как грязный научный образец вместо еды или продажи.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['monster', 'zhelemish', 'food', 'medicine_counterfeit', 'sample', 'science', 'zhelemishnik'],
    eventData: { outcome: 'science_sample', rumorIds: ['faction_scientist_zhelemish_sample', 'slime_brown_cleanup'] },
  },
]);

registerSideQuest(BUYER_ID, NPC_DEFS[BUYER_ID], [
  {
    id: QUEST_RISKY_SALE,
    giverNpcId: BUYER_ID,
    type: QuestType.FETCH,
    desc: 'Егор Крайпятак: «Сырой желемыш мне. Я продам как мазь, а вам дам деньги и сухой кусок без вопросов.»',
    targetItem: 'zhelemish_raw',
    targetCount: 1,
    rewardItem: 'zhelemish_dried',
    rewardCount: 1,
    relationDelta: -7,
    xpReward: 30,
    moneyReward: 72,
    eventTargetName: 'Сырой желемыш продан в серый медугол; липовая мазь получит новую партию.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['monster', 'zhelemish', 'food', 'medicine_counterfeit', 'black_market', 'risky_sale', 'zhelemishnik'],
    eventData: { outcome: 'risky_sale', trustCost: true, rumorIds: ['economy_zhelemish_bad_medicine'] },
  },
]);

function sourceSideQuestId(event: WorldEvent): string {
  const id = event.data?.sideQuestId;
  return typeof id === 'string' ? id : '';
}

function eventContainerTags(event: WorldEvent): string[] {
  const tags = event.data?.containerTags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === 'string');
}

function publishQuestOutcome(state: Parameters<typeof publishEvent>[0], event: WorldEvent, outcome: string): void {
  const sale = outcome === 'risky_sale';
  const science = outcome === 'science_sample';
  publishEvent(state, {
    type: sale ? 'player_sell_item' : science ? 'player_handoff_item' : 'hazard_cleaned',
    actorName: 'Вы',
    targetId: event.actorId,
    targetName: event.actorName,
    targetFaction: event.actorFaction,
    itemId: science || sale ? 'zhelemish_raw' : 'rock_salt',
    itemName: science || sale ? 'Сырой желемыш' : 'Каменная соль',
    itemCount: 1,
    itemValue: sale ? 72 : science ? 35 : 4,
    severity: 4,
    privacy: sale ? 'local' : 'private',
    tags: ['monster', 'zhelemish', 'food', 'medicine_counterfeit', 'zhelemishnik', outcome],
    data: {
      sourceQuestId: sourceSideQuestId(event),
      outcome,
      hazardName: 'Погреб Желемышника',
      cleanedCells: 0,
      guardianTiedToPatch: true,
    },
  });
}

registerWorldEventObserver((state, event) => {
  if (event.type === 'quest_completed') {
    const sideQuestId = sourceSideQuestId(event);
    if (sideQuestId === QUEST_SAFE_PROCESS) publishQuestOutcome(state, event, 'safe_processing');
    else if (sideQuestId === QUEST_SURRENDER_SAMPLE) publishQuestOutcome(state, event, 'science_sample');
    else if (sideQuestId === QUEST_RISKY_SALE) publishQuestOutcome(state, event, 'risky_sale');
    return;
  }

  const guardedHarvestItem = event.itemId === 'zhelemish_raw' || event.itemId === 'slime_sample_brown';
  if ((event.type === 'container_opened' || event.type === 'item_stolen') && guardedHarvestItem) {
    const tags = eventContainerTags(event);
    if (!tags.includes(CONTENT_TAG) || !tags.includes('guarded_core')) return;
    publishEvent(state, {
      type: 'monster_sighted',
      zoneId: event.zoneId,
      roomId: event.roomId,
      x: event.x,
      y: event.y,
      actorName: GUARDIAN_NAME,
      targetId: event.actorId,
      targetName: event.actorName,
      targetFaction: event.actorFaction,
      itemId: event.itemId,
      itemName: event.itemName,
      itemCount: event.itemCount,
      monsterKind: MonsterKind.POLZUN,
      severity: 4,
      privacy: 'local',
      tags: ['monster', 'living_fungal_loop', 'zhelemish', 'slime', 'medicine_counterfeit', 'zhelemishnik', 'guardian'],
      data: {
        outcome: 'guardian_awakened',
        counterplay: ['dried_bait', 'leave_raw_patch', 'salt', 'fire'],
        routeItem: event.itemId,
        patchSpoiled: event.type === 'item_stolen' || event.itemId === 'zhelemish_raw',
      },
    });
    return;
  }

  if (event.type === 'player_kill_monster' && event.targetName === GUARDIAN_NAME) {
    publishEvent(state, {
      type: 'hazard_cleaned',
      zoneId: event.zoneId,
      roomId: event.roomId,
      x: event.x,
      y: event.y,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetId: event.targetId,
      targetName: `${GUARDIAN_NAME} убит; сырой погреб стал тише, но не чище`,
      monsterKind: MonsterKind.POLZUN,
      severity: 4,
      privacy: 'local',
      tags: ['monster', 'zhelemish', 'food', 'medicine_counterfeit', 'zhelemishnik', 'guardian_cleared'],
      data: {
        outcome: 'guardian_cleared',
        hazardName: 'Желемышник',
        cleanedCells: 0,
        stillUnsafeRawUse: true,
      },
    });
  }
});

function areaClear(world: World, rx: number, ry: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 84; r += 4) {
    for (let k = 0; k < 28; k++) {
      const a = ((k + 9) / 28) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(world: World, roomId: number, rx: number, ry: number): Room {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.ROTTEN;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
      world.fog[ci] = Math.max(world.fog[ci], 18);
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.STORAGE,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: 'Погреб Желемышника',
    apartmentId: -1,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_TILE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
      world.fog[ci] = Math.max(world.fog[ci], dx > 6 && dy > 5 ? 44 : 24);
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.ROTTEN, Tex.F_TILE);
  connectProtectedRoom(world, rx, ry, ROOM_W, ROOM_H);
  world.markFogDirty();
  return room;
}

function setFeature(world: World, room: Room, dx: number, dy: number, feature: Feature): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function setWater(world: World, room: Room, dx: number, dy: number): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
  world.roomMap[ci] = room.id;
}

function decorateRoom(world: World, room: Room): void {
  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [4, 2, Feature.SHELF],
    [6, 2, Feature.SHELF],
    [11, 2, Feature.APPARATUS],
    [13, 2, Feature.TABLE],
    [14, 2, Feature.CHAIR],
    [2, 5, Feature.SINK],
    [5, 6, Feature.CANDLE],
    [9, 7, Feature.MACHINE],
    [10, 7, Feature.MACHINE],
    [15, 10, Feature.LAMP],
  ] as const) {
    setFeature(world, room, dx, dy, feature);
  }

  for (const [dx, dy] of [[7, 8], [8, 8], [9, 8], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9]] as const) {
    setWater(world, room, dx, dy);
  }

  const coreX = room.x + 9;
  const coreY = room.y + 8;
  world.wallTex[world.idx(room.x + Math.floor(ROOM_W / 2), room.y - 1)] = Tex.POSTER_BASE + 45;
  stampSurfaceSplat(world, room.x + 4, room.y + 4, 0.5, 0.5, 3.2, 0.55, 14001, 80, 118, 52, false);
  stampSurfaceSplat(world, coreX, coreY, 0.5, 0.5, 5.0, 0.72, 14002, 86, 64, 42, false);
  stampSurfaceSplat(world, room.x + 14, room.y + 10, 0.5, 0.5, 2.1, 0.5, 14003, 46, 35, 26, false);
  world.markFloorTexDirty();
  world.markWallTexDirty();
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: Entity,
  faction?: Faction,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'living_fungal_loop', 'zhelemish', 'food', 'medicine_counterfeit', ...tags],
  });
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  angle: number,
  weapon?: string,
): Entity {
  const existing = entities.find(e => e.alive && e.plotNpcId === plotNpcId);
  if (existing) return existing;
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra: { isTraveler: false },
  });
}

function dropNote(entities: Entity[], nextId: { v: number }, x: number, y: number): void {
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
    inventory: [{
      defId: 'note',
      count: 1,
      data: 'Погреб Желемышника: сухой край можно снять, сырое ядро лучше сдать, сварить через соль или оставить. Коричневую пробу для Ольги берут из ядра и несут через прачечную, не через желудок.',
    }],
  });
}

function spawnGuardian(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const def = MONSTERS[MonsterKind.POLZUN];
  const x = room.x + 10;
  const y = room.y + 10;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: -Math.PI / 2,
    pitch: 0,
    alive: true,
    speed: def.speed * 0.55,
    sprite: monsterSpr(MonsterKind.POLZUN),
    spriteSeed: 14014,
    spriteScale: 1.08,
    hp: 92,
    maxHp: 92,
    name: GUARDIAN_NAME,
    monsterKind: MonsterKind.POLZUN,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: room.x + 9, ty: room.y + 8, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

function seedContainers(world: World, room: Room, scientist: Entity, buyer: Entity): void {
  addContainer(
    world,
    room,
    4,
    4,
    ContainerKind.WOODEN_CHEST,
    'Сухой внешний край желемыша',
    'public',
    [{ defId: 'zhelemish_dried', count: 1 }],
    ['safe_harvest', 'outer_patch', 'dried_bait'],
  );
  addContainer(
    world,
    room,
    9,
    8,
    ContainerKind.SECRET_STASH,
    'Сырое ядро под кожей',
    'public',
    [
      { defId: 'zhelemish_raw', count: 2 },
      { defId: 'slime_sample_brown', count: 1 },
    ],
    ['guarded_core', 'raw_harvest', 'patch_spoil', 'sample'],
  );
  addContainer(
    world,
    room,
    13,
    2,
    ContainerKind.MEDICAL_CABINET,
    'Стол отбора Варвары',
    'faction',
    [],
    ['science', 'surrender_sample', 'safe_sample'],
    scientist,
    Faction.SCIENTIST,
  );
  addContainer(
    world,
    room,
    15,
    10,
    ContainerKind.TRASH_BIN,
    'Жаровня соли и бензина',
    'public',
    [],
    ['safe_processing', 'salt', 'fire', 'boil'],
  );
  addContainer(
    world,
    room,
    2,
    3,
    ContainerKind.CASHBOX,
    'Скупочный пакет Крайпятака',
    'owner',
    [{ defId: 'cigs', count: 1 }],
    ['black_market', 'risky_sale', 'theft'],
    buyer,
    Faction.WILD,
  );
}

function generateZhelemishnik(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveRoom(world, nextRoomId++, pos.x, pos.y);
  decorateRoom(world, room);

  const scientist = spawnNpc(entities, nextId, SCIENTIST_ID, room.x + 13, room.y + 3, Math.PI, 'makarov');
  const buyer = spawnNpc(entities, nextId, BUYER_ID, room.x + 2, room.y + 5, 0, 'knife');
  seedContainers(world, room, scientist, buyer);
  dropNote(entities, nextId, room.x + 3, room.y + 2);
  spawnGuardian(world, entities, nextId, room);

  world.bakeLights();
  genLog(`[MONSTER_14] Желемышник cellar at (${room.x}, ${room.y}) room #${room.id}; guardian=${entityDisplayName({ name: GUARDIAN_NAME, monsterKind: MonsterKind.POLZUN })}`);
  return { nextRoomId };
}

registerZoneContent(ZONE_HUD_ID, 'Погреб Желемышника', generateZhelemishnik);

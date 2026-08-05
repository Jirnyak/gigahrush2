/* ── Бюро оружейных разрешений — Ministry permit/ammo POI ─────── */

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

const CONTENT_TAG = 'weapon_permit_bureau';
const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const WITNESS_LIDIYA_ID = 'weapon_permit_witness_lidiya';

const GALINA_DEF: PlotNpcDef = {
  name: 'Галина Короткоствольная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 130, maxHp: 130, money: 85, speed: 0.75,
  inventory: [
    { defId: 'blank_form', count: 2 },
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Бюро оружейных разрешений. Ствол сначала должен стать бумагой.',
    'Макаров без корешка считается железом с намерением.',
    'Два пустых бланка, и я выдам разрешение только на короткий пистолетный случай.',
    'Разрешение не пистолет. За сам ствол платят отдельно у Степана, по журналу.',
    'Автомат через это окно не проходит. Окно боится очередей, но не настолько.',
    'Ордер на патроны живет один раз. Потом шкаф требует новый повод.',
    'Если берете из шкафа без подписи, журнал назовет это не смелостью, а недостачей.',
  ],
  talkLinesPost: [
    'Разрешение выдано. Оно не делает выстрел законным, только проверяемым.',
    'Патронный ордер не мочить и не показывать тому, кто улыбается без лица.',
  ],
};

const BORIS_DEF: PlotNpcDef = {
  name: 'Борис Подчисткин',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 100, maxHp: 100, money: 45, speed: 0.8,
  inventory: [
    { defId: 'ink_bottle', count: 2 },
    { defId: 'weapon_permit_forged', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Я не подделываю оружейные бумаги. Я ставлю подпись туда, где ее не будут долго искать.',
    'Лист с фальшивой печатью сюда, и будет разрешение, которое лучше не читать вслух.',
    'Охрана видит цвет печати. Аудит видит время, место и вашу спину.',
    'Липовая бумага открывает не шкаф, а разговор с тем, кто потом спросит, откуда она.',
  ],
  talkLinesPost: [
    'Разрешение почти настоящее. Не держите его рядом с настоящим человеком.',
    'Если шкаф щелкнет после вас, значит бумага прошла раньше вас.',
  ],
};

const STEPAN_DEF: PlotNpcDef = {
  name: 'Степан Патронов',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 260, maxHp: 260, money: 120, speed: 0.95,
  inventory: [
    { defId: 'karkarov_pistol', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'Показывайте бумагу, не пистолет.',
    'Я выдаю только малый запас. Кто просит ящик патронов, тот уже в рапорте.',
    'Законный путь: оформленный журнал, семьдесят рублей за Каркаров или одноразовый патронный ордер.',
    'Незаконный путь стоит ближе к шкафу. Потом ближе к протоколу.',
    'Липовое оружейное разрешение сдаете сюда. Не за патроны, за то, чтобы фамилия легла в правильную папку.',
  ],
  talkLinesPost: [
    'Выдано по минимуму. Этого хватит уйти, если не начинать войну.',
    'Следующий патрон бюро будет считать уже с вашим именем.',
  ],
};

const WITNESS_LIDIYA_DEF: PlotNpcDef = {
  name: 'Понятая Лидия Сейфовая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'note', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
  ],
  talkLines: [
    'Я понятая. Сейф открывался при мне, но не для меня.',
    'Бумага у оружейного окна тяжелее пистолета.',
  ],
  talkLinesPost: [
    'Подпись поставлена. Теперь главное не узнать, под чем.',
  ],
};

registerSideQuest('galina_korotkostvolnaya', GALINA_DEF, [
  {
    id: 'weapon_permit_legal_forms',
    giverNpcId: 'galina_korotkostvolnaya',
    type: QuestType.FETCH,
    desc: 'Галина Короткоствольная: «Два пустых бланка, и оформим разрешение на короткоствол без ночного шкафа.»',
    targetItem: 'blank_form', targetCount: 2,
    rewardItem: 'weapon_permit_signed', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_issue_order', count: 1 }],
    relationDelta: 12, xpReward: 70, moneyReward: 45,
    eventTargetName: 'Бюро оружейных разрешений оформило законный короткоствольный пакет.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['weapon_permit', 'ministry', 'legal', 'short_sidearm', 'ammo_order'],
    eventData: { permitGate: 'signed_sidearm', ammoOrderCount: 1, rumorIds: ['rare_weapon_permit_signed'] },
  },
]);

registerSideQuest('boris_podchistkin', BORIS_DEF, [
  {
    id: 'weapon_permit_forged_stamp',
    giverNpcId: 'boris_podchistkin',
    type: QuestType.FETCH,
    desc: 'Борис Подчисткин: «Принесите лист с поддельной печатью. Сделаю разрешение, которое лучше не греть в ладони.»',
    targetItem: 'forged_stamp_sheet', targetCount: 1,
    rewardItem: 'weapon_permit_forged', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 4 }],
    relationDelta: 4, xpReward: 55, moneyReward: 20,
    eventTargetName: 'В бюро появилась липовая оружейная бумага; аудит запомнил ровную печать.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: ['weapon_permit', 'ministry', 'forgery', 'contraband', 'audit'],
    eventData: { permitGate: 'forged_sidearm', contrabandRisk: 2, rumorIds: ['container_weapon_permit_audit'] },
  },
]);

registerSideQuest('stepan_patronov', STEPAN_DEF, [
  {
    id: 'weapon_permit_sidearm_issue',
    giverNpcId: 'stepan_patronov',
    type: QuestType.FETCH,
    desc: 'Степан Патронов: «Разрешение уже в журнале. Семьдесят рублей за служебный Каркаров; патроны только по отдельному ордеру.»',
    targetItem: 'money', targetCount: 70,
    rewardItem: 'karkarov_pistol', rewardCount: 1,
    relationDelta: 7, xpReward: 50, moneyReward: 0,
    requiresSideQuestDone: 'weapon_permit_legal_forms',
    eventTargetName: 'Короткоствол куплен по журналу бюро; патроны остались отдельным дефицитом.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['weapon_permit', 'ministry', 'legal_purchase', 'sidearm', 'ammo_scarcity'],
    eventData: { permitGate: 'paid_sidearm', price: 70, ammoIncluded: 0, rumorIds: ['rare_weapon_permit_signed'] },
  },
  {
    id: 'weapon_permit_ammo_order',
    giverNpcId: 'stepan_patronov',
    type: QuestType.FETCH,
    desc: 'Степан Патронов: «Патронный ордер принимаю один раз. Дам десяток девятки, остальное ищите живыми.»',
    targetItem: 'ammo_issue_order', targetCount: 1,
    rewardItem: 'ammo_9mm', rewardCount: 10,
    relationDelta: 6, xpReward: 40, moneyReward: 0,
    eventTargetName: 'Одноразовый патронный ордер погашен на десять девяток.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: ['weapon_permit', 'ministry', 'ammo_order', 'single_use', 'ammo_scarcity'],
    eventData: { permitGate: 'ammo_order_redeemed', ammoCount: 10, rumorIds: ['faction_liquidator_ammo'] },
  },
  {
    id: 'weapon_permit_forged_confiscation',
    giverNpcId: 'stepan_patronov',
    type: QuestType.FETCH,
    desc: 'Степан Патронов: «Липовое оружейное разрешение сюда. Конфискую без патронов, но с отметкой, что вы пришли сами.»',
    targetItem: 'weapon_permit_forged', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    relationDelta: 11, xpReward: 55, moneyReward: 25,
    eventTargetName: 'Липовое оружейное разрешение сдано ликвидаторам как конфискат.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: ['weapon_permit', 'ministry', 'contraband', 'confiscation', 'liquidator'],
    eventData: { permitGate: 'forgery_confiscated', rewardAmmo: 0, rumorIds: ['container_weapon_permit_audit', 'faction_liquidator_ammo'] },
  },
]);

registerAuthoredNpc({
  id: WITNESS_LIDIYA_ID,
  npc: WITNESS_LIDIYA_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', CONTENT_TAG, 'witness'],
});

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addPermitContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  ownerNpcId: number,
): void {
  const inventory: WorldContainer['inventory'] = [
    { defId: 'weapon_permit_signed', count: 1 },
    { defId: 'weapon_permit_forged', count: 1 },
    { defId: 'ammo_issue_order', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'karkarov_pistol', count: 1 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.WEAPON_CRATE,
    name: 'Шкаф оружейных разрешений',
    inventory,
    capacitySlots: 8,
    ownerNpcId,
    ownerName: STEPAN_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'owner',
    lockDifficulty: 3,
    discovered: true,
    tags: [CONTENT_TAG, 'ministry', 'weapon_permit', 'weapon', 'ammo', 'audit', 'theft'],
  });
}

export function generateWeaponPermitBureau(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Бюро оружейных разрешений',
    w: 13, h: 9,
    minDist: 40, maxDist: 120,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const midX = room.x + Math.floor(room.w / 2);
  const deskY = room.y + 3;
  const cy = room.y + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx++) setFeature(world, room.x + dx, deskY, Feature.DESK);
  for (let dx = 2; dx < room.w - 2; dx += 3) setFeature(world, room.x + dx, deskY + 1, Feature.CHAIR);
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setFeature(world, room.x + dx, room.y + room.h - 2, Feature.CHAIR);
  }
  setFeature(world, midX, room.y + 1, Feature.LAMP);
  setFeature(world, midX - 4, room.y + room.h - 2, Feature.LAMP);
  setFeature(world, midX + 4, room.y + room.h - 2, Feature.LAMP);
  world.wallTex[world.idx(midX, room.y - 1)] = Tex.POSTER_BASE + 8;
  world.wallTex[world.idx(room.x + room.w, cy)] = Tex.PORTRAIT_BASE + 4;

  addItemDrop(entities, nextId, room.x + 2, room.y + 2, 'blank_form', 1);
  addItemDrop(entities, nextId, room.x + 3, room.y + room.h - 2, 'ink_bottle', 1);
  addItemDrop(entities, nextId, room.x + room.w - 3, room.y + 2, 'note', 1);

  spawnAdminNpc(entities, nextId, GALINA_DEF, 'galina_korotkostvolnaya', midX - 3, deskY - 1);
  spawnAdminNpc(entities, nextId, BORIS_DEF, 'boris_podchistkin', midX + 1, deskY - 1);
  const guardId = nextId.v;
  spawnAdminNpc(entities, nextId, STEPAN_DEF, 'stepan_patronov', room.x + room.w - 3, room.y + room.h - 3, true, 'karkarov_pistol');
  spawnAdminNpc(entities, nextId, WITNESS_LIDIYA_DEF, WITNESS_LIDIYA_ID, room.x + 2, room.y + room.h - 3, false);

  const lockerX = room.x + room.w - 2;
  const lockerY = cy;
  setFeature(world, lockerX, lockerY, Feature.SHELF);
  addPermitContainer(world, room.id, lockerX, lockerY, guardId);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

/* ── Архив ликвидаторских дел — contract records POI ─────────── */

import {
  Cell,
  ContainerKind,
  DoorState,
  Feature,
  FloorLevel,
  Faction,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  msg,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS } from '../../data/catalog';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { changeResourceStock } from '../../systems/economy';
import { publishEvent } from '../../systems/events';
import { addItem, registerInventoryUseHandler, removeItem, type InventoryUseHandlerContext } from '../../systems/inventory';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const LIQUIDATOR_ISSUE_CARD = 'liquidator_issue_card';
const LIQUIDATOR_ISSUE_RADIUS = 2.4;
const LIQUIDATOR_ISSUE_RADIUS2 = LIQUIDATOR_ISSUE_RADIUS * LIQUIDATOR_ISSUE_RADIUS;
const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const LADA_OPIS_ID = 'liquidator_archive_lada_opis';
const INTENDANT_L47_ID = 'liquidator_archive_intendant_l47';
const POSTOVOY_NEVYNOS_ID = 'liquidator_archive_postovoy_nevynos';
const LIQUIDATOR_FIELD_KIT = [
  { defId: 'filter_canister', count: 1 },
  { defId: 'decon_fluid', count: 1 },
  { defId: 'sterile_bandage', count: 1 },
  { defId: 'liquidator_ration', count: 1 },
] as const;

const LADA_OPIS_DEF: PlotNpcDef = {
  name: 'Лада Опись',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'blank_form', count: 2 },
    { defId: 'unsigned_order', count: 1 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Опись Л-47 ведется в двух экземплярах: бумажном и испуганном.',
    'Карточка выдачи работает только у шкафа. В кармане она просто красная вина.',
  ],
  talkLinesPost: [
    'Выдача прошла по строке. Строка пока не спорит.',
  ],
};

const INTENDANT_L47_DEF: PlotNpcDef = {
  name: 'Интендант Л-47',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'tt_pistol',
  inventory: [
    { defId: 'tt_pistol', count: 1 },
    { defId: 'ammo_762tt', count: 14 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'Л-47 выдает комплект только тем, кто принес карточку, а не историю.',
    'Жетон из описи считается живым, пока не лег в чужой карман.',
  ],
  talkLinesPost: [
    'Снаряжение списано. Теперь несите себя обратно целиком.',
  ],
};

const POSTOVOY_NEVYNOS_DEF: PlotNpcDef = {
  name: 'Постовой Невынос',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'makarov',
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'liquidator_ration', count: 1 },
  ],
  talkLines: [
    'Дверь в опись не тяжелая. Тяжелое начинается после нее.',
    'Параграф внутри не кусает бумагу. Он кусает того, кто ее несет.',
  ],
  talkLinesPost: [
    'Проход видели, выход не обещали.',
  ],
};

registerAuthoredNpc({
  id: LADA_OPIS_ID,
  npc: LADA_OPIS_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'liquidator_archive', 'secretary', 'issue_card'],
});

registerAuthoredNpc({
  id: INTENDANT_L47_ID,
  npc: INTENDANT_L47_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'liquidator_archive', 'liquidator', 'issue_card'],
});

registerAuthoredNpc({
  id: POSTOVOY_NEVYNOS_ID,
  npc: POSTOVOY_NEVYNOS_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'liquidator_archive', 'guard'],
});

function nextContainerId(world: World): number {
  return world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
}

function addLiquidatorContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction = Faction.LIQUIDATOR,
): void {
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: Math.max(10, inventory.length),
    faction,
    access,
    discovered: true,
    tags,
  });
}

function addRecordsGate(world: World, roomId: number, gateX: number, topY: number, bottomY: number, doorY: number): void {
  for (let y = topY; y <= bottomY; y++) {
    const ci = world.idx(gateX, y);
    world.features[ci] = Feature.NONE;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
  }

  const doorIdx = world.idx(gateX, doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.LOCKED,
    roomA: roomId,
    roomB: roomId,
    keyId: 'key',
    timer: 0,
  });
  const room = world.rooms[roomId];
  if (room && !room.doors.includes(doorIdx)) room.doors.push(doorIdx);
}

function spawnNamedThreat(
  world: World,
  entities: Entity[],
  nextId: NextId,
  x: number,
  y: number,
  kind: MonsterKind,
  name: string,
): void {
  const before = entities.length;
  spawnAdminMonster(world, entities, nextId, x, y, kind);
  if (entities.length > before) entities[entities.length - 1].name = name;
}

function addContainerTag(container: WorldContainer, tag: string): void {
  if (!container.tags.includes(tag)) container.tags.push(tag);
}

function findNearbyIssueStash(ctx: InventoryUseHandlerContext): WorldContainer | undefined {
  const world = ctx.world;
  if (!world) return undefined;
  const px = Math.floor(ctx.actor.x);
  const py = Math.floor(ctx.actor.y);
  const r = Math.ceil(LIQUIDATOR_ISSUE_RADIUS);
  let best: WorldContainer | undefined;
  let bestD2 = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = world.wrap(px + dx);
      const y = world.wrap(py + dy);
      for (const container of world.containersAt(x, y)) {
        if (!container.tags.includes('liquidator_archive') || !container.tags.includes('issue_stash')) continue;
        const d2 = world.dist2(ctx.actor.x, ctx.actor.y, container.x + 0.5, container.y + 0.5);
        if (d2 > LIQUIDATOR_ISSUE_RADIUS2 || d2 >= bestD2) continue;
        best = container;
        bestD2 = d2;
      }
    }
  }
  return best;
}

function canFitIssuedFieldKit(actor: Entity): boolean {
  const probe: Entity = {
    ...actor,
    inventory: (actor.inventory ?? []).map(item => ({ ...item })),
  };
  if (!removeItem(probe, LIQUIDATOR_ISSUE_CARD, 1)) return false;
  for (const item of LIQUIDATOR_FIELD_KIT) {
    if (!addItem(probe, item.defId, item.count)) return false;
  }
  return true;
}

function handleLiquidatorIssueCardUse(ctx: InventoryUseHandlerContext): boolean {
  if (ctx.def.id !== LIQUIDATOR_ISSUE_CARD) return false;
  if (ctx.actor.faction !== Faction.PLAYER) {
    ctx.msgs.push(msg('Карточку выдачи принимает только окно игрока, не чужой карман.', ctx.time, '#aa8'));
    return true;
  }
  if (!ctx.state || !ctx.world || ctx.state.currentFloor !== FloorLevel.MINISTRY) {
    ctx.msgs.push(msg('Карточку выдачи гасят у ликвидаторского шкафа Л-47 в Министерстве.', ctx.time, '#aa8'));
    return true;
  }

  const stash = findNearbyIssueStash(ctx);
  if (!stash) {
    ctx.msgs.push(msg('Поднесите карточку к шкафу боевой описи Л-47: там выдадут один полевой комплект.', ctx.time, '#aa8'));
    return true;
  }
  if (!canFitIssuedFieldKit(ctx.actor)) {
    ctx.msgs.push(msg('Полевой комплект некуда положить. Освободите место перед выдачей.', ctx.time, '#aa8'));
    return true;
  }
  if (!removeItem(ctx.actor, LIQUIDATOR_ISSUE_CARD, 1)) return true;
  for (const item of LIQUIDATOR_FIELD_KIT) addItem(ctx.actor, item.defId, item.count);

  addContainerTag(stash, 'issue_card_stamped');
  addContainerTag(stash, 'field_kit_issued');
  stash.lastOpenedBy = ctx.actor.id;
  stash.lastOpenedAt = ctx.state.time;
  changeResourceStock(ctx.state, 'documents', 1, FloorLevel.MINISTRY, {
    zoneId: stash.zoneId,
    roomId: stash.roomId,
    reason: 'liquidator_issue_card_stamped',
    tags: ['liquidator', 'issue_card', 'field_kit'],
  });
  changeResourceStock(ctx.state, 'tools', -2, FloorLevel.MINISTRY, {
    zoneId: stash.zoneId,
    roomId: stash.roomId,
    reason: 'liquidator_field_kit_issued',
    tags: ['liquidator', 'field_kit'],
  });
  changeResourceStock(ctx.state, 'medicine', -1, FloorLevel.MINISTRY, {
    zoneId: stash.zoneId,
    roomId: stash.roomId,
    reason: 'liquidator_field_kit_issued',
    tags: ['liquidator', 'field_kit'],
  });
  changeResourceStock(ctx.state, 'food', -1, FloorLevel.MINISTRY, {
    zoneId: stash.zoneId,
    roomId: stash.roomId,
    reason: 'liquidator_field_kit_issued',
    tags: ['liquidator', 'field_kit'],
  });

  ctx.msgs.push(msg('Карточку Л-47 погасили: фильтр, обеззараживание, бинт и сухпай выданы под учет.', ctx.time, '#8f8'));
  publishEvent(ctx.state, {
    type: 'player_use_item',
    floor: FloorLevel.MINISTRY,
    zoneId: stash.zoneId,
    roomId: stash.roomId,
    x: stash.x + 0.5,
    y: stash.y + 0.5,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name ?? 'Вы',
    actorFaction: ctx.actor.faction,
    targetName: stash.name,
    targetFaction: stash.faction,
    itemId: LIQUIDATOR_ISSUE_CARD,
    itemName: ITEMS[LIQUIDATOR_ISSUE_CARD]?.name ?? LIQUIDATOR_ISSUE_CARD,
    itemCount: 1,
    itemValue: ITEMS[LIQUIDATOR_ISSUE_CARD]?.value ?? 0,
    containerId: stash.id,
    containerFaction: stash.faction,
    severity: 3,
    privacy: 'private',
    tags: ['player', 'inventory', 'document', 'liquidator', 'issue_card', 'field_kit', 'single_use', 'access_granted', 'legal'],
    data: {
      outcome: 'liquidator_field_kit_issued',
      containerName: stash.name,
      outputItems: LIQUIDATOR_FIELD_KIT.map(item => ({ ...item })),
      resourceDeltas: { documents: 1, tools: -2, medicine: -1, food: -1 },
    },
  });
  return true;
}

registerInventoryUseHandler(handleLiquidatorIssueCardUse);

export function generateLiquidatorArchive(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Архив ликвидаторских дел',
    w: 17, h: 10,
    minDist: 85, maxDist: 185,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const rx = room.x;
  const ry = room.y;
  const cy = ry + Math.floor(room.h / 2);
  const gateX = rx + room.w - 6;
  const deskY = ry + 3;
  addRecordsGate(world, room.id, gateX, ry + 1, ry + room.h - 2, cy);

  for (let dx = 2; dx < room.w - 7; dx++) setFeature(world, rx + dx, deskY, Feature.DESK);
  for (let dx = 2; dx < room.w - 7; dx += 2) setFeature(world, rx + dx, deskY + 1, Feature.CHAIR);
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, rx + 1, ry + dy, Feature.SHELF);
    setFeature(world, rx + room.w - 2, ry + dy, Feature.SHELF);
  }
  for (let dy = 2; dy < room.h - 2; dy += 2) setFeature(world, gateX + 2, ry + dy, Feature.SHELF);
  setFeature(world, rx + 3, ry + 1, Feature.LAMP);
  setFeature(world, gateX - 1, cy, Feature.SCREEN);
  setFeature(world, gateX + 3, ry + room.h - 2, Feature.LAMP);
  world.wallTex[world.idx(rx + Math.floor(room.w / 2), ry - 1)] = Tex.POSTER_BASE + 31;
  world.wallTex[world.idx(rx + room.w, cy)] = Tex.SCREEN_BASE + 9;

  addItemDrop(entities, nextId, rx + 2, ry + room.h - 2, 'unsigned_order', 1);
  addItemDrop(entities, nextId, rx + 4, ry + room.h - 2, 'samosbor_tally', 1);
  addItemDrop(entities, nextId, gateX + 1, ry + 2, 'denunciation', 1);

  spawnAdminNpc(entities, nextId, LADA_OPIS_DEF, LADA_OPIS_ID, rx + 4, deskY - 1, true);
  spawnAdminNpc(entities, nextId, INTENDANT_L47_DEF, INTENDANT_L47_ID, rx + 7, deskY - 1, true, 'tt_pistol');
  spawnAdminNpc(entities, nextId, POSTOVOY_NEVYNOS_DEF, POSTOVOY_NEVYNOS_ID, gateX - 1, cy, false, 'makarov');

  addLiquidatorContainer(
    world, room.id, gateX + 2, ry + 2,
    ContainerKind.FILING_CABINET,
    'Картотека Л-47: жетоны и выезды',
    'faction',
    [
      { defId: 'liquidator_token', count: 1 },
      { defId: 'missing_record_file', count: 1 },
      { defId: 'chernobog_liquidator_memo', count: 1 },
      { defId: 'denunciation', count: 2 },
      { defId: 'samosbor_tally', count: 1 },
      { defId: 'post_samosbor_probe_kit', count: 1 },
      { defId: 'liquidator_issue_card', count: 1 },
      { defId: 'confiscation_tag', count: 1 },
    ],
    [
      'evidence',
      'evidence_drop',
      'cult',
      'archive',
      'archive_route',
      'inspection_archive',
      'raionsovet_archive',
      'chernobog',
      'liquidator_archive',
      'audit',
    ],
  );
  addLiquidatorContainer(
    world, room.id, gateX + 3, ry + room.h - 3,
    ContainerKind.FILING_CABINET,
    'Запечатанная полка рапортов',
    'owner',
    [
      { defId: 'sealed_complaint', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'chernobog_confiscation_act', count: 1 },
      { defId: 'void_archive_warrant', count: 1 },
    ],
    [
      'evidence',
      'evidence_drop',
      'cult',
      'archive',
      'archive_route',
      'inspection_archive',
      'raionsovet_archive',
      'chernobog',
      'sealed',
      'audit',
    ],
  );
  addLiquidatorContainer(
    world, room.id, rx + 2, ry + 2,
    ContainerKind.WEAPON_CRATE,
    'Шкаф боевой описи Л-47',
    'faction',
    [
      { defId: 'liquidator_axe', count: 1 },
      { defId: 'uv_spotlight', count: 1 },
      { defId: 'shock_baton', count: 1 },
      { defId: 'chizh3_shotgun', count: 1 },
      { defId: 'rb91_auto_shotgun', count: 1 },
      { defId: 'chest_failsafe_charge', count: 1 },
      { defId: 'slyoznev_pps41', count: 1 },
      { defId: 'eralashnikov_auto', count: 1 },
      { defId: 'zatychkin_pistol', count: 1 },
      { defId: 'roks47_flamethrower', count: 1 },
      { defId: 'rubber_club', count: 1 },
      { defId: 'bayonet', count: 1 },
      { defId: 'rake_bayonet', count: 1 },
      { defId: 'foam_grenade_6p10', count: 2 },
      { defId: 'weapon_checkout_tag', count: 1 },
      { defId: 'ammo_shells', count: 12 },
      { defId: 'ammo_12g_slug', count: 4 },
      { defId: 'ammo_12g_chemical', count: 2 },
      { defId: 'ammo_12g_incendiary', count: 2 },
      { defId: 'ammo_762tt', count: 12 },
      { defId: 'ammo_762', count: 18 },
      { defId: 'ammo_9mm', count: 18 },
      { defId: 'napalm_mix', count: 2 },
      { defId: 'decon_fluid', count: 1 },
      { defId: 'bandage', count: 2 },
      { defId: 'liquidator_ration', count: 1 },
    ],
    ['liquidator', 'liquidator_archive', 'archive_route', 'recruit_stash', 'issue_stash', 'patrol', 'combat', 'control', 'ammo', 'shotgun', 'flame', 'napalm', 'explosive', 'failsafe', 'officer', 'ovb', 'theft'],
  );

  spawnNamedThreat(world, entities, nextId, gateX + 3, cy, MonsterKind.PARAGRAPH, 'Параграф Л-47');
  spawnNamedThreat(world, entities, nextId, gateX + 1, ry + room.h - 2, MonsterKind.PECHATEED, 'Печатеед описи');

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

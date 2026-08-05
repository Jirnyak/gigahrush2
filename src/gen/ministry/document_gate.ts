/* ── Проверочный коридор документов — Ministry document gate ─── */

import {
  W, Cell, ContainerKind, DoorState, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  msg,
  type Door, type Entity, type GameState, type ItemDef, type Room, type WorldContainer, type WorldEvent,
  type WorldEventPrivacy, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import { ITEMS } from '../../data/catalog';
import { DOCUMENT_MINISTRY_GATE_ACCESS_DEFS } from '../../data/documents_access';
import { ITEM_TAGS } from '../../data/items';
import { getPermitDef, type PermitAccessTag } from '../../data/permits';
import { chernobogDocketGateItems } from '../../data/chernobog_docket';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { registerInventoryUseHandler, type InventoryUseHandlerContext } from '../../systems/inventory';
import { recordPermitAccess, recordPermitExposure } from '../../systems/permits';
import { setDoorState } from '../../systems/door_state';
import {
  type NextId, addItemDrop, setFeature, spawnAdminMonster, spawnAdminNpc,
} from '../admin_common';
import { carveCorridor, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { spawnChernobogDocketHandlers } from './chernobog_archive_docket';
import { isPlayerEntity } from '../../systems/player_actor';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const GATE_ROOM_NAME = 'Проверочный коридор N3';
const GATE_W = 19;
const GATE_H = 9;
const CONTENT_TAG = 'document_gate';
const ACCESS_SCAN_RADIUS = 10;
const ACCESS_SCAN_RADIUS2 = ACCESS_SCAN_RADIUS * ACCESS_SCAN_RADIUS;
const MAX_CONTEXTS = 4;
const GATE_GUARD_ID = 'document_gate_inspector_sukhar';
const GATE_WITNESS_ID = 'document_gate_zina_ochevidnaya';

type DocumentGateAccessMethod = 'legal' | 'forged' | 'stolen' | 'bribe' | 'debt' | 'expose' | 'key' | 'violent';
type DocumentGateAccessOutcome = 'success' | 'failure' | 'theft';

interface DocumentGateAccessDef {
  itemId: string;
  method: DocumentGateAccessMethod;
  legal: boolean;
  severity: 3 | 4 | 5;
  privacy: WorldEventPrivacy;
  line: string;
}

interface DocumentGateTarget {
  world: World;
  room: Room;
  door: Door;
  doorIdx: number;
  ctx?: DocumentGateContext;
}

interface DocumentGateContext {
  world: World;
  roomId: number;
  gateDoorIdx: number;
  guardId: number;
  containerId: number;
  violentHandled: boolean;
  theftEventIds: number[];
}

export const DOCUMENT_GATE_ACCESS_ITEMS: readonly DocumentGateAccessDef[] = [
  {
    itemId: 'official_permit_slip',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Окно N3 приняло официальный корешок. Дверь открылась без лишней записи.',
  },
  {
    itemId: 'archive_access_permit',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Архивный допуск прошел как старший документ. Коридор уступил.',
  },
  {
    itemId: 'part_ticket',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Партбилет приняли без улыбки. Коридор открылся, будто это его идея.',
  },
  {
    itemId: 'rail_depot_pass',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Пропуск в депо прошел как транспортный доступ. N3 уступил старой линии.',
  },
  {
    itemId: 'forged_permit_slip',
    method: 'forged',
    legal: false,
    severity: 4,
    privacy: 'local',
    line: 'Кованый корешок дрогнул под печатью, но N3 открылся. Журнал записал слишком ровную строку.',
  },
  {
    itemId: 'fake_pass',
    method: 'forged',
    legal: false,
    severity: 4,
    privacy: 'local',
    line: 'Фальшивый пропуск совпал цветом с чужой ошибкой. Дверь открылась шумнее бумаги.',
  },
  {
    itemId: 'stolen_archive_card',
    method: 'stolen',
    legal: false,
    severity: 4,
    privacy: 'witnessed',
    line: 'Краденая карточка открыла N3 чужим делом. Пальцы попали в журнал.',
  },
  {
    itemId: 'raionsovet_floor_pass',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Пропуск райсовета прошел как старшая бумага. N3 уступил архивной линии.',
  },
  {
    itemId: 'forged_raionsovet_pass',
    method: 'forged',
    legal: false,
    severity: 4,
    privacy: 'local',
    line: 'Липовый пропуск райсовета дрогнул, но дверь решила не спорить при очереди.',
  },
  {
    itemId: 'bank_debt_paper',
    method: 'debt',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Долговая бумага стала основанием для прохода: долг тоже документ.',
  },
  {
    itemId: 'forged_bank_debt_paper',
    method: 'forged',
    legal: false,
    severity: 5,
    privacy: 'witnessed',
    line: 'Липовая долговая бумага прошла, но очередь услышала, как в ней скрипит чужая фамилия.',
  },
  {
    itemId: 'debt_settlement_receipt',
    method: 'debt',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Квитанция о погашении закрыла вопрос быстрее печати.',
  },
  {
    itemId: 'confiscation_warrant',
    method: 'expose',
    legal: true,
    severity: 4,
    privacy: 'witnessed',
    line: 'Ордер на изъятие заставил N3 открыть проход для ревизии.',
  },
  {
    itemId: 'cleanup_order_stub',
    method: 'expose',
    legal: true,
    severity: 4,
    privacy: 'witnessed',
    line: 'Корешок приказа на зачистку прошёл как основание для служебного изъятия.',
  },
  {
    itemId: 'voluntary_receipt',
    method: 'bribe',
    legal: false,
    severity: 4,
    privacy: 'local',
    line: 'Расписка об ускорительном сборе легла вместо дела. N3 открылся, а кассовый журнал оставил строку без фамилии.',
  },
  {
    itemId: 'record_exposure_notice',
    method: 'expose',
    legal: true,
    severity: 4,
    privacy: 'witnessed',
    line: 'Акт о пропавшей записи заставил пост искать виновного в архиве. N3 открылся, чтобы спор ушел выше.',
  },
  {
    itemId: 'quarantine_breach_notice',
    method: 'expose',
    legal: true,
    severity: 4,
    privacy: 'witnessed',
    line: 'Извещение о нарушении карантина заставило N3 пропустить санитарный акт выше.',
  },
  {
    itemId: 'labor_shift_card',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Карта смены совпала с производственным списком. N3 пропустил рабочего.',
  },
  {
    itemId: 'key',
    method: 'key',
    legal: false,
    severity: 4,
    privacy: 'local',
    line: 'Контрольный ключ обошел бумагу. Для двери это проход, для очереди - шум.',
  },
  ...DOCUMENT_MINISTRY_GATE_ACCESS_DEFS.filter(def =>
    def.itemId === 'hazard_shift_extension' || def.itemId === 'rail_switch_order' || def.itemId === 'ovb_search_warrant'
  ),
];

const DOCUMENT_GATE_ACCESS_BY_ITEM = new Map(DOCUMENT_GATE_ACCESS_ITEMS.map(def => [def.itemId, def]));
const DOCUMENT_GATE_REJECT_HINT_TAGS = new Set([
  'document', 'documents', 'permit', 'pass', 'access', 'archive', 'ministry', 'ministry_access',
  'document_gate', 'quarantine', 'weapon_permit',
]);
const documentGateContexts: DocumentGateContext[] = [];

const GALINA_DEF: PlotNpcDef = {
  name: 'Галина Окошечная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 75, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'note', count: 3 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Окно N3 принимает живых по документу, мертвых по акту.',
    'Официальный корешок пропуска кладите сухой стороной вверх.',
    'С документом проход тихий. Без документа проход тоже бывает, но потом шумит журнал.',
    'Если у вас подделка, не показывайте ее мне. Я вижу старый сургуч по краю.',
    'Расписка, краденая карточка и акт о пропаже тоже проходят. Просто потом идут не туда, куда вы.',
  ],
  talkLinesPost: [
    'Коридор признал вас временно проходящим.',
    'Ключ не право. Ключ - это просьба двери не спорить.',
  ],
};

const ARKADIY_DEF: PlotNpcDef = {
  name: 'Аркадий Подложный',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 95, maxHp: 95, money: 45, speed: 0.85,
  inventory: [
    { defId: 'forged_permit_slip', count: 1 },
    { defId: 'fake_pass', count: 1 },
    { defId: 'ink_bottle', count: 1 },
  ],
  talkLines: [
    'Я не открываю дверь. Я помогаю двери ошибиться.',
    'Кованый корешок подойдет, если держать его уверенно и не давать печатееду нюхать.',
    'Поддельная бумага дешевле очереди, но дороже тишины после нее.',
  ],
  talkLinesPost: [
    'Если спросят, кто вас пропустил, называйте стену.',
    'Бумага прошла. Теперь главное - чтобы вы прошли быстрее бумаги.',
  ],
};

const BORIS_DEF: PlotNpcDef = {
  name: 'Борис Безчековый',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 160, maxHp: 160, money: 160, speed: 0.7,
  inventory: [
    { defId: 'ration_stamp_pad', count: 1 },
    { defId: 'container_key_label', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Никаких взяток. Только ускорительный сбор без квитанции.',
    'Сто двадцать рублей делают очередь короче ровно на одну расписку.',
    'Деньги не заменяют документ. Они становятся документом, который стесняется дела.',
  ],
  talkLinesPost: [
    'Сбор принят. Если кто спросит, расписка стояла здесь вчера.',
    'Дверь любит наличные меньше бумаги, но расписку читает быстрее.',
  ],
};

const GATE_GUARD_DEF: PlotNpcDef = {
  name: 'Инспектор Сухарь',
  isFemale: false,
  sex: 'male',
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'makarov',
  inventory: [
    { defId: 'key', count: 1 },
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
    { defId: 'official_permit_slip', count: 1 },
  ],
  talkLines: [
    'Сухарь смотрит на корешок так, будто бумага может напасть первой.',
  ],
  talkLinesPost: [
    'Сухарь молча закрывает журнал ладонью.',
  ],
};

const GATE_WITNESS_DEF: PlotNpcDef = {
  name: 'Зина Очевидная',
  isFemale: true,
  sex: 'female',
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 80, maxHp: 80, money: 12, speed: 0.75,
  inventory: [{ defId: 'neighbor_complaint', count: 1 }, { defId: 'bread', count: 1 }],
  talkLines: [
    'Зина всё видела, но сначала проверяет, кто стоит ближе к двери.',
  ],
  talkLinesPost: [
    'Зина шепчет жалобу так тихо, что ее слышит только журнал.',
  ],
};

registerSideQuest('galina_okoshechnaya', GALINA_DEF, [
  {
    id: 'document_gate_official_slip',
    giverNpcId: 'galina_okoshechnaya',
    type: QuestType.FETCH,
    desc: 'Галина Окошечная: «Официальный корешок пропуска - и проверочный коридор N3 откроется без записи в журнале.»',
    targetItem: 'official_permit_slip', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 1 }],
    relationDelta: 14, xpReward: 70, moneyReward: 35,
  },
]);

registerSideQuest('arkadiy_podlozhny', ARKADIY_DEF, [
  {
    id: 'document_gate_forged_slip',
    giverNpcId: 'arkadiy_podlozhny',
    type: QuestType.FETCH,
    desc: 'Аркадий Подложный: «Кованый корешок пропуска проведет через N3, если не кормить им печатееда.»',
    targetItem: 'forged_permit_slip', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: -4, xpReward: 65, moneyReward: 20,
  },
]);

registerSideQuest('boris_bezchekovy', BORIS_DEF, [
  {
    id: 'document_gate_quiet_bribe',
    giverNpcId: 'boris_bezchekovy',
    type: QuestType.FETCH,
    desc: 'Борис Безчековый: «Сто двадцать рублей ускорительного сбора - и получите расписку, которую N3 постесняется читать вслух.»',
    targetItem: 'money', targetCount: 120,
    rewardItem: 'voluntary_receipt', rewardCount: 1,
    relationDelta: -6, xpReward: 45, moneyReward: 0,
    eventTargetName: 'Касса N3 приняла ускорительный сбор; расписка стала проходом с ревизионным хвостом.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['ministry', 'document_gate', 'bribe', 'receipt', 'audit_risk', 'access'],
    eventData: {
      permitOutcome: 'bribe',
      permitDocument: 'voluntary_receipt',
      gateMethod: 'bribe',
      auditRisk: 'accelerator_fee_without_case',
      rumorIds: ['ministry_document_gate_n3'],
    },
  },
]);

registerAuthoredNpc({
  id: GATE_GUARD_ID,
  npc: GATE_GUARD_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.MINISTRY),
  tags: ['ministry', 'document_gate', 'guard'],
});

registerAuthoredNpc({
  id: GATE_WITNESS_ID,
  npc: GATE_WITNESS_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.MINISTRY),
  tags: ['ministry', 'document_gate', 'witness'],
});

function registerDocumentGateContext(ctx: DocumentGateContext): void {
  const existing = documentGateContexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.gateDoorIdx = ctx.gateDoorIdx;
    existing.guardId = ctx.guardId;
    existing.containerId = ctx.containerId;
    existing.violentHandled = false;
    existing.theftEventIds = [];
    return;
  }
  documentGateContexts.push(ctx);
  if (documentGateContexts.length > MAX_CONTEXTS) documentGateContexts.splice(0, documentGateContexts.length - MAX_CONTEXTS);
}

function doorX(idx: number): number {
  return idx % W;
}

function doorY(idx: number): number {
  return (idx / W) | 0;
}

function contextByDoor(world: World, doorIdx: number): DocumentGateContext | undefined {
  return documentGateContexts.find(ctx => ctx.world === world && ctx.gateDoorIdx === doorIdx);
}

function contextByContainer(containerId: number | undefined): DocumentGateContext | undefined {
  if (containerId === undefined) return undefined;
  return documentGateContexts.find(ctx => ctx.containerId === containerId);
}

function contextByGuard(targetId: number | undefined): DocumentGateContext | undefined {
  return documentGateContexts.find(ctx => ctx.guardId === targetId);
}

function isGateRoom(room: Room | null | undefined): room is Room {
  return !!room && room.name === GATE_ROOM_NAME;
}

function gateRoomForDoor(world: World, door: Door): Room | null {
  const roomA = door.roomA >= 0 ? world.rooms[door.roomA] : undefined;
  if (isGateRoom(roomA)) return roomA;
  const roomB = door.roomB >= 0 ? world.rooms[door.roomB] : undefined;
  return isGateRoom(roomB) ? roomB : null;
}

function isDocumentGateDoor(world: World, idx: number, door: Door): boolean {
  if (world.cells[idx] !== Cell.DOOR) return false;
  if (door.roomA !== door.roomB) return false;
  return isGateRoom(gateRoomForDoor(world, door));
}

function targetFromDoor(world: World, doorIdx: number, door: Door): DocumentGateTarget | null {
  if (!isDocumentGateDoor(world, doorIdx, door)) return null;
  const room = gateRoomForDoor(world, door);
  if (!room) return null;
  return { world, room, door, doorIdx, ctx: contextByDoor(world, doorIdx) };
}

function findDocumentGateTarget(world: World, actor: Entity): DocumentGateTarget | null {
  const actorRoom = world.roomAt(actor.x, actor.y);
  if (isGateRoom(actorRoom)) {
    for (const doorIdx of actorRoom.doors) {
      const door = world.doors.get(doorIdx);
      if (!door) continue;
      const target = targetFromDoor(world, doorIdx, door);
      if (target) return target;
    }
  }

  const px = Math.floor(actor.x);
  const py = Math.floor(actor.y);
  let best: DocumentGateTarget | null = null;
  let bestD2 = Infinity;
  for (let dy = -ACCESS_SCAN_RADIUS; dy <= ACCESS_SCAN_RADIUS; dy++) {
    for (let dx = -ACCESS_SCAN_RADIUS; dx <= ACCESS_SCAN_RADIUS; dx++) {
      const x = world.wrap(px + dx);
      const y = world.wrap(py + dy);
      const d2 = world.dist2(actor.x, actor.y, x + 0.5, y + 0.5);
      if (d2 > ACCESS_SCAN_RADIUS2 || d2 >= bestD2) continue;
      const door = world.doors.get(world.idx(x, y));
      if (!door) continue;
      const target = targetFromDoor(world, door.idx, door);
      if (!target) continue;
      best = target;
      bestD2 = d2;
    }
  }
  return best;
}

function openDocumentGateDoor(target: DocumentGateTarget): boolean {
  if (target.door.state === DoorState.OPEN) return false;
  setDoorState(target.world, target.door, DoorState.OPEN);
  target.door.timer = 0;
  return true;
}

function itemTags(defId: string, def?: ItemDef): string[] {
  const tags: string[] = [];
  for (const tag of ITEM_TAGS[defId] ?? []) if (!tags.includes(tag)) tags.push(tag);
  for (const tag of def?.tags ?? []) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

function isRelevantRejectedDocument(defId: string, def: ItemDef): boolean {
  if (DOCUMENT_GATE_ACCESS_BY_ITEM.has(defId)) return true;
  if (defId.includes('pass') || defId.includes('permit') || defId.includes('clearance') || defId.includes('order')) return true;
  return itemTags(defId, def).some(tag => DOCUMENT_GATE_REJECT_HINT_TAGS.has(tag));
}

function methodIsLegal(method: DocumentGateAccessMethod): boolean {
  return method === 'legal' || method === 'debt' || method === 'expose';
}

function auditRiskForMethod(method: DocumentGateAccessMethod): string | undefined {
  switch (method) {
    case 'forged': return 'stamp_shape_and_ink_time_mismatch';
    case 'stolen': return 'card_owner_and_fingerprint_mismatch';
    case 'bribe': return 'accelerator_fee_without_case';
    case 'key': return 'control_key_without_attached_file';
    case 'violent': return 'guard_absence_and_open_gate';
    default: return undefined;
  }
}

function tagsForMethod(method: DocumentGateAccessMethod): string[] {
  switch (method) {
    case 'forged': return ['forgery', 'audit_risk'];
    case 'stolen': return ['audit_risk'];
    case 'bribe': return ['bribe', 'audit_risk'];
    case 'debt': return ['debt', 'banking'];
    case 'expose': return ['expose', 'evidence'];
    case 'key': return ['audit_risk'];
    case 'violent': return ['violent', 'audit_risk'];
    default: return [];
  }
}

function rumorIdsForMethod(method: DocumentGateAccessMethod): string[] {
  if (method === 'forged') return ['player_forged_stamp_risk', 'ministry_document_gate_n3'];
  if (method === 'stolen') return ['player_stole_archive_card', 'ministry_document_gate_n3'];
  if (method === 'debt') return ['smoking_debt_notebook', 'ministry_document_gate_n3'];
  return ['ministry_document_gate_n3'];
}

function permitAccessTagForGate(itemId: string, method: DocumentGateAccessMethod): PermitAccessTag {
  if (itemId.includes('raionsovet')) return 'raionsovet';
  if (itemId.includes('debt')) return 'bank_debt';
  if (itemId === 'confiscation_warrant') return 'bank_vault';
  if (itemId === 'cleanup_order_stub') return 'archive';
  if (itemId.includes('archive') || method === 'stolen') return 'archive';
  return 'ministry_n3';
}

function publishDocumentGateAccessEvent(
  state: GameState,
  target: DocumentGateTarget,
  outcome: DocumentGateAccessOutcome,
  method: DocumentGateAccessMethod,
  severity: 2 | 3 | 4 | 5,
  privacy: WorldEventPrivacy,
  data: Record<string, unknown> = {},
  actor?: Entity,
  sourceEvent?: WorldEvent,
  itemId?: string,
): void {
  const itemName = itemId ? ITEMS[itemId]?.name ?? itemId : undefined;
  const auditRisk = data.auditRisk ?? auditRiskForMethod(method);
  publishEvent(state, {
    type: `document_gate_access_${outcome}` as WorldEventType,
    floor: FloorLevel.MINISTRY,
    zoneId: target.world.zoneMap[target.doorIdx],
    roomId: target.room.id,
    x: doorX(target.doorIdx) + 0.5,
    y: doorY(target.doorIdx) + 0.5,
    actorId: actor?.id ?? sourceEvent?.actorId,
    actorName: actor?.name ?? sourceEvent?.actorName,
    actorFaction: actor?.faction ?? sourceEvent?.actorFaction,
    targetId: sourceEvent?.targetId ?? target.ctx?.guardId,
    targetName: sourceEvent?.targetName ?? 'проверочный коридор N3',
    targetFaction: sourceEvent?.targetFaction ?? Faction.CITIZEN,
    itemId,
    itemName,
    severity,
    privacy,
    tags: [
      'ministry',
      CONTENT_TAG,
      'access',
      outcome === 'success' ? 'access_granted' : outcome === 'failure' ? 'access_denied' : 'theft',
      method,
      ...tagsForMethod(method),
    ],
    data: {
      roomName: GATE_ROOM_NAME,
      gateDoorIdx: target.doorIdx,
      method,
      legal: methodIsLegal(method),
      sourceEventId: sourceEvent?.id,
      requiredItems: DOCUMENT_GATE_ACCESS_ITEMS.map(def => def.itemId),
      rumorIds: rumorIdsForMethod(method),
      auditRisk,
      auditConsequence: auditRisk ? 'event_log_and_ministry_context_fact' : undefined,
      ...data,
    },
  });
}

function handleDocumentGateUse(ctx: InventoryUseHandlerContext): boolean {
  if (!ctx.state || !ctx.world || !isPlayerEntity(ctx.actor)) return false;
  if (ctx.state.currentFloor !== FloorLevel.MINISTRY) return false;
  const target = findDocumentGateTarget(ctx.world, ctx.actor);
  if (!target) return false;

  const access = DOCUMENT_GATE_ACCESS_BY_ITEM.get(ctx.def.id);
  if (!access) {
    if (!isRelevantRejectedDocument(ctx.def.id, ctx.def)) return false;
    ctx.msgs.push(msg(
      `${GATE_ROOM_NAME} отверг ${ctx.def.name}: нужен корешок, допуск, подделка, краденая карточка, расписка, акт разоблачения или контрольный ключ.`,
      ctx.time,
      '#f84',
    ));
    publishDocumentGateAccessEvent(ctx.state, target, 'failure', 'legal', 3, 'local', {
      rejectedItemId: ctx.def.id,
      rejectedItemName: ctx.def.name,
      reason: 'wrong_document',
    }, ctx.actor, undefined, ctx.def.id);
    return true;
  }

  if (target.door.state === DoorState.OPEN) {
    ctx.msgs.push(msg(`${GATE_ROOM_NAME} уже пропустил вас. Бумага может отдохнуть.`, ctx.time, '#aaa'));
    return true;
  }

  openDocumentGateDoor(target);
  ctx.msgs.push(msg(access.line, ctx.time, access.method === 'legal' ? '#8f8' : access.method === 'stolen' ? '#fa8' : '#fc8'));
  publishDocumentGateAccessEvent(
    ctx.state,
    target,
    access.method === 'stolen' ? 'theft' : 'success',
    access.method,
    access.severity,
    access.privacy,
    { itemTags: itemTags(access.itemId, ctx.def), legal: access.legal },
    ctx.actor,
    undefined,
    access.itemId,
  );
  const permit = getPermitDef(access.itemId);
  if (permit) {
    recordPermitAccess(ctx.state, ctx.actor, ctx.world, permit, GATE_ROOM_NAME, permitAccessTagForGate(access.itemId, access.method), undefined);
    if (access.method === 'expose') {
      recordPermitExposure(ctx.state, ctx.actor, ctx.world, permit, GATE_ROOM_NAME, 'document_gate_exposure', undefined);
    }
  }
  return true;
}

function handleDocumentGateTheftEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'item_stolen' || state.currentFloor !== FloorLevel.MINISTRY) return;
  if (!event.itemId || !DOCUMENT_GATE_ACCESS_BY_ITEM.has(event.itemId)) return;
  const ctx = contextByContainer(event.containerId);
  if (!ctx || ctx.theftEventIds.includes(event.id)) return;
  ctx.theftEventIds.push(event.id);
  if (ctx.theftEventIds.length > 8) ctx.theftEventIds.splice(0, ctx.theftEventIds.length - 8);
  const door = ctx.world.doors.get(ctx.gateDoorIdx);
  if (!door) return;
  const target = targetFromDoor(ctx.world, ctx.gateDoorIdx, door);
  if (!target) return;
  state.msgs.push(msg('В N3 пропал документ доступа. Очередь делает вид, что не знает, чьи это пальцы.', state.time, '#fa8'));
  publishDocumentGateAccessEvent(state, target, 'theft', DOCUMENT_GATE_ACCESS_BY_ITEM.get(event.itemId)?.method ?? 'stolen', 4, 'witnessed', {
    preparedByTheft: true,
    containerId: event.containerId,
    sourceEventId: event.id,
  }, undefined, event, event.itemId);
}

function handleDocumentGateGuardKill(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_npc' || state.currentFloor !== FloorLevel.MINISTRY) return;
  const ctx = contextByGuard(event.targetId);
  if (!ctx || ctx.violentHandled) return;
  const door = ctx.world.doors.get(ctx.gateDoorIdx);
  if (!door) return;
  const target = targetFromDoor(ctx.world, ctx.gateDoorIdx, door);
  if (!target) return;
  ctx.violentHandled = true;
  openDocumentGateDoor(target);
  state.msgs.push(msg('Инспектор Сухарь упал. N3 открылся без документа и запомнил это как силовой проход.', state.time, '#f84'));
  publishDocumentGateAccessEvent(state, target, 'success', 'violent', 5, 'witnessed', {
    sourceEventId: event.id,
    guardId: ctx.guardId,
    reason: 'guard_killed',
  }, undefined, event);
}

function handleDocumentGateEvents(state: GameState, event: WorldEvent): void {
  handleDocumentGateTheftEvent(state, event);
  handleDocumentGateGuardKill(state, event);
}

registerInventoryUseHandler(handleDocumentGateUse);
registerWorldEventObserver(handleDocumentGateEvents);

function createGateRoom(world: World, nextRoomId: number, spawnX: number, spawnY: number): Room | null {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);
  const pos = findClearArea(world, cx, cy, GATE_W, GATE_H, 35, 130)
    ?? findClearArea(world, cx, cy, GATE_W, GATE_H, 0, Math.floor(W / 4));
  if (!pos) {
    console.warn(`[DOCUMENT_GATE] failed to place ${GATE_ROOM_NAME}`);
    return null;
  }

  const liftCells: number[] = [];
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT) liftCells.push(i);
  }

  const room = stampRoom(world, nextRoomId, RoomType.OFFICE, pos.x, pos.y, GATE_W, GATE_H, -1);
  room.name = GATE_ROOM_NAME;
  room.wallTex = Tex.MARBLE;
  room.floorTex = Tex.F_MARBLE_TILE;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.MARBLE, Tex.F_MARBLE_TILE);

  for (const ci of liftCells) {
    if (world.cells[ci] !== Cell.LIFT) world.cells[ci] = Cell.LIFT;
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.floorTex[ci] = Tex.F_MARBLE_TILE;
      world.wallTex[ci] = Tex.MARBLE;
    }
  }
  return room;
}

function findNearbyFloor(world: World, sx: number, sy: number, roomId: number): { x: number; y: number } | null {
  for (let r = 5; r <= 70; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(sx + dx);
        const y = world.wrap(sy + dy);
        const ci = world.idx(x, y);
        if (world.cells[ci] !== Cell.FLOOR) continue;
        if (world.aptMask[ci] || world.roomMap[ci] === roomId) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function addExteriorDoor(world: World, room: Room, side: 'west' | 'east', y: number): void {
  const dx = side === 'west' ? -1 : 1;
  const doorX = side === 'west' ? room.x - 1 : room.x + room.w;
  const outsideX = world.wrap(doorX + dx);
  const doorIdx = world.idx(doorX, y);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_WOOD;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.CLOSED,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);

  const outIdx = world.idx(outsideX, y);
  world.cells[outIdx] = Cell.FLOOR;
  world.floorTex[outIdx] = Tex.F_MARBLE_TILE;
  world.roomMap[outIdx] = -1;
  world.aptMask[outIdx] = 0;

  const target = findNearbyFloor(world, outsideX, y, room.id);
  if (target) carveCorridor(world, outsideX, y, target.x, target.y);
}

function addLockedCheckGate(world: World, room: Room, gateX: number, doorY: number): number {
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
  return doorIdx;
}

function addGateContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  ownerNpcId: number,
  ownerName: string,
): number {
  const id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  const container: WorldContainer = {
    id,
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.CASHBOX,
    name: 'Касса ускорительного сбора N3',
    inventory: [
      { defId: 'key', count: 1 },
      { defId: 'forged_permit_slip', count: 1 },
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      ...chernobogDocketGateItems(),
    ],
    capacitySlots: 7,
    ownerNpcId,
    ownerName,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: ['evidence', 'cult', 'archive', 'chernobog', 'witness', 'ministry', 'document_gate', 'theft'],
  };
  world.addContainer(container);
  return id;
}

function spawnGateGuard(entities: Entity[], nextId: NextId, x: number, y: number): number {
  const guardId = nextId.v;
  requireSpawnedPlotNpcFromPackage(entities, nextId, GATE_GUARD_ID, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    weapon: 'makarov',
    canGiveQuest: false,
  });
  return guardId;
}

function spawnQueueWitness(entities: Entity[], nextId: NextId, x: number, y: number): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, GATE_WITNESS_ID, x + 0.5, y + 0.5, {
    angle: Math.PI,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    canGiveQuest: false,
  });
}

export function generateDocumentGate(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createGateRoom(world, nextRoomId, spawnX, spawnY);
  if (!room) return { nextRoomId };

  const cy = room.y + Math.floor(room.h / 2);
  const gateX = room.x + 10;
  addExteriorDoor(world, room, 'west', cy);
  addExteriorDoor(world, room, 'east', cy);
  const gateDoorIdx = addLockedCheckGate(world, room, gateX, cy);

  for (let dx = 2; dx < gateX - room.x - 2; dx++) {
    setFeature(world, room.x + dx, room.y + 2, Feature.DESK);
  }
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(world, room.x + 3, cy + 2, Feature.CHAIR);
  setFeature(world, room.x + 6, cy + 2, Feature.CHAIR);
  setFeature(world, gateX - 1, cy - 1, Feature.LAMP);
  setFeature(world, gateX + 3, cy - 2, Feature.LAMP);
  world.wallTex[world.idx(room.x + 5, room.y - 1)] = Tex.POSTER_BASE + 17;
  world.wallTex[world.idx(gateX + 4, room.y + room.h)] = Tex.PORTRAIT_BASE + 27;

  addItemDrop(entities, nextId, room.x + 2, room.y + room.h - 2, 'blank_form', 1);
  addItemDrop(entities, nextId, room.x + 4, room.y + room.h - 2, 'note', 1);
  addItemDrop(entities, nextId, room.x + 6, room.y + room.h - 2, 'record_exposure_notice', 1);
  addItemDrop(entities, nextId, gateX + 2, room.y + 2, 'temp_pass', 1);
  addItemDrop(entities, nextId, gateX + 4, room.y + 2, 'elevator_access_order', 1);
  addItemDrop(entities, nextId, gateX + 2, room.y + room.h - 3, 'chernobog_external_cell_index', 1);
  addItemDrop(entities, nextId, gateX + 4, room.y + room.h - 3, 'chernobog_redacted_central_note', 1);

  spawnAdminNpc(entities, nextId, GALINA_DEF, 'galina_okoshechnaya', room.x + 3, room.y + 1);
  spawnAdminNpc(entities, nextId, ARKADIY_DEF, 'arkadiy_podlozhny', room.x + 4, cy + 2);
  spawnAdminNpc(entities, nextId, BORIS_DEF, 'boris_bezchekovy', gateX - 2, room.y + 1);
  spawnChernobogDocketHandlers(entities, nextId, room, gateX, cy);
  const guardId = spawnGateGuard(entities, nextId, gateX - 1, cy + 2);
  spawnQueueWitness(entities, nextId, room.x + 2, cy + 2);

  const containerId = addGateContainer(world, room, gateX - 2, cy + 2, guardId, 'Инспектор Сухарь');
  registerDocumentGateContext({
    world,
    roomId: room.id,
    gateDoorIdx,
    guardId,
    containerId,
    violentHandled: false,
    theftEventIds: [],
  });
  spawnAdminMonster(world, entities, nextId, gateX + 4, cy + 2, MonsterKind.PARAGRAPH);

  genLog(`[DOCUMENT_GATE] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

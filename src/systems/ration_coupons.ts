import {
  Faction,
  FloorLevel,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Msg,
  type WorldEvent,
} from '../core/types';
import { type World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { getStack } from '../data/items';
import { addFactionRelMutual } from '../data/relations';
import { changeResourceStock } from './economy';
import { getRecentEvents, publishEvent, registerWorldEventObserver } from './events';
import { isPlayerEntity } from './player_actor';

export const RATION_COUPON_ITEM_IDS = [
  'water_coupon',
  'concentrate_coupon',
  'ration_registry_extract',
  'forged_ration_card',
  'ration_stamp_pad',
] as const;

const COUPON_ITEM_IDS = new Set<string>(RATION_COUPON_ITEM_IDS);
const REPORT_SIDE_QUEST_IDS = new Set(['min_coupon_forgery_report', 'kv_coupon_audit_registry']);
const QUEUE_ROOM_TAGS = ['ration_queue', 'ocherednik'] as const;
const QUEUE_TRADE_TAG = 'ration_queue_trade';
const QUEUE_TRADE_WINDOW_SEC = 180;
const MAX_QUEUE_TRADES_PER_ROOM = 3;

type RationUseResult = {
  handled: boolean;
};

interface QueueRoomContext {
  roomId: number;
  zoneId: number;
  x: number;
  y: number;
  sourceTag: string;
}

export function isRationCouponItem(defId: string): boolean {
  return COUPON_ITEM_IDS.has(defId);
}

function itemName(defId: string): string {
  return ITEMS[defId]?.name ?? defId;
}

function actorName(actor: Entity): string {
  return actor.name ?? (isPlayerEntity(actor) ? 'Вы' : '???');
}

function inventoryCount(actor: Entity, defId: string): number {
  let n = 0;
  for (const item of actor.inventory ?? []) if (item.defId === defId) n += item.count;
  return n;
}

function canStack(a: Item, defId: string): boolean {
  const def = ITEMS[defId];
  return !!def && a.defId === defId && a.count < getStack(def) && a.data === undefined;
}

function hasRoomFor(actor: Entity, defId: string, selectedSlotWillFree = false): boolean {
  const inv = actor.inventory ?? [];
  if (inv.some(item => canStack(item, defId))) return true;
  return inv.length < MAX_INVENTORY_SLOTS || selectedSlotWillFree;
}

function addItemToActor(actor: Entity, defId: string, count = 1): boolean {
  const def = ITEMS[defId];
  if (!def) return false;
  if (!actor.inventory) actor.inventory = [];
  let remaining = count;
  for (const item of actor.inventory) {
    if (!canStack(item, defId)) continue;
    const add = Math.min(remaining, getStack(def) - item.count);
    item.count += add;
    remaining -= add;
    if (remaining <= 0) return true;
  }
  while (remaining > 0 && actor.inventory.length < MAX_INVENTORY_SLOTS) {
    const add = Math.min(remaining, getStack(def));
    actor.inventory.push({ defId, count: add });
    remaining -= add;
  }
  return remaining <= 0;
}

function consumeSlot(actor: Entity, slotIdx: number, count = 1): boolean {
  const inv = actor.inventory;
  if (!inv) return false;
  const slot = inv[slotIdx];
  if (!slot || slot.count < count) return false;
  slot.count -= count;
  if (slot.count <= 0) inv.splice(slotIdx, 1);
  return true;
}

function consumeItem(actor: Entity, defId: string, count = 1): boolean {
  const inv = actor.inventory;
  if (!inv) return false;
  let remaining = count;
  for (let i = inv.length - 1; i >= 0; i--) {
    const slot = inv[i];
    if (slot.defId !== defId) continue;
    const take = Math.min(remaining, slot.count);
    slot.count -= take;
    remaining -= take;
    if (slot.count <= 0) inv.splice(i, 1);
    if (remaining <= 0) return true;
  }
  return false;
}

function publishPlayerCouponEvent(
  state: GameState | undefined,
  actor: Entity,
  type: 'ration_coupon_spent' | 'ration_coupon_forged' | 'ration_coupon_reported' | 'ration_audit_resolved',
  itemId: string,
  tags: string[],
  data: Record<string, unknown>,
  severity: 3 | 4 | 5 = 4,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  publishEvent(state, {
    type,
    actorId: actor.id,
    actorName: actorName(actor),
    actorFaction: actor.faction,
    itemId,
    itemName: itemName(itemId),
    itemCount: 1,
    itemValue: ITEMS[itemId]?.value ?? 0,
    severity,
    privacy: severity >= 4 ? 'local' : 'private',
    tags: ['player', 'inventory', 'ration_coupon', 'ration_coupon_audit', ...tags],
    data,
  });
}

function applyFairSpendEconomy(state: GameState | undefined, resourceId: string): void {
  if (!state) return;
  changeResourceStock(state, resourceId, -1);
  addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 1);
}

function rationQueueContext(actor: Entity, zoneId: number | undefined, world: World | undefined): QueueRoomContext | null {
  if (!world || !isPlayerEntity(actor)) return null;
  const x = Math.floor(actor.x);
  const y = Math.floor(actor.y);
  const ci = world.idx(x, y);
  const roomId = world.roomMap[ci];
  if (roomId < 0) return null;
  for (const container of world.containers) {
    if (container.roomId !== roomId) continue;
    const sourceTag = QUEUE_ROOM_TAGS.find(tag => container.tags.includes(tag));
    if (!sourceTag) continue;
    return { roomId, zoneId: zoneId ?? world.zoneMap[ci], x, y, sourceTag };
  }
  return null;
}

function recentQueueTradeCount(state: GameState | undefined, actor: Entity, roomId: number): number {
  if (!state) return 0;
  let count = 0;
  for (const event of getRecentEvents(state, { tags: [QUEUE_TRADE_TAG], limit: 16 })) {
    if (event.actorId !== actor.id || event.roomId !== roomId) continue;
    if (state.time - event.time > QUEUE_TRADE_WINDOW_SEC) continue;
    count++;
  }
  return count;
}

function publishQueueTradeEvent(
  state: GameState | undefined,
  actor: Entity,
  context: QueueRoomContext,
  inputItemId: 'water' | 'bread',
  outputItemId: 'bread' | 'water_coupon',
  risk: boolean,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: context.zoneId,
    roomId: context.roomId,
    x: context.x,
    y: context.y,
    actorId: actor.id,
    actorName: actorName(actor),
    actorFaction: actor.faction,
    itemId: inputItemId,
    itemName: itemName(inputItemId),
    itemCount: 1,
    itemValue: ITEMS[inputItemId]?.value ?? 0,
    severity: risk ? 4 : 3,
    privacy: 'local',
    tags: risk
      ? ['player', 'inventory', 'ration_queue', QUEUE_TRADE_TAG, 'queue_jump', 'crowd_risk', 'ration_coupon_audit']
      : ['player', 'inventory', 'ration_queue', QUEUE_TRADE_TAG, 'water_for_place', 'crowd_relief', 'ration_coupon_audit'],
    data: {
      source: context.sourceTag,
      inputItemId,
      outputItemId,
      outcome: risk ? 'queue_jump_for_coupon' : 'water_for_place_trade',
      kvartiryWaterDelta: risk ? -1 : 1,
      kvartiryFoodDelta: risk ? 1 : -1,
      rumorIds: risk
        ? ['kvartiry_queue_unrest', 'ration_coupon_black_market']
        : ['lead_kvartiry_ration_queue_registry', 'player_trade_fair'],
    },
  });
}

function tradeQueuePlace(
  actor: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): RationUseResult {
  const slot = actor.inventory?.[slotIdx];
  if (!slot || (slot.defId !== 'water' && slot.defId !== 'bread')) return { handled: false };
  const context = rationQueueContext(actor, zoneId, world);
  if (!context) return { handled: false };

  if (recentQueueTradeCount(state, actor, context.roomId) >= MAX_QUEUE_TRADES_PER_ROOM) {
    msgs.push(msg('Очередь перестала менять места: слишком много рук потянулось к одному окну. Отойдите, если хотите просто поесть или попить.', time, '#aa8'));
    return { handled: true };
  }

  const outputItemId = slot.defId === 'water' ? 'bread' : 'water_coupon';
  const selectedWillFree = slot.count <= 1;
  if (!hasRoomFor(actor, outputItemId, selectedWillFree)) {
    msgs.push(msg('Некуда спрятать плату за место. Очередь не держит чужие карманы.', time, '#aa8'));
    return { handled: true };
  }

  if (!consumeSlot(actor, slotIdx, 1)) return { handled: true };
  addItemToActor(actor, outputItemId, 1);

  if (state) {
    if (slot.defId === 'water') {
      changeResourceStock(state, 'drink_water', 1, FloorLevel.KVARTIRY);
      changeResourceStock(state, 'food', -1, FloorLevel.KVARTIRY);
      addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 1);
    } else {
      changeResourceStock(state, 'food', 1, FloorLevel.KVARTIRY);
      changeResourceStock(state, 'drink_water', -1, FloorLevel.KVARTIRY);
      addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -1);
      addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
    }
  }

  if (slot.defId === 'water') {
    msgs.push(msg('Вода ушла за место в очереди. Толпа подвинулась на один вдох; в руку сунули хлеб.', time, '#8cf'));
    publishQueueTradeEvent(state, actor, context, 'water', 'bread', false);
  } else {
    msgs.push(msg('Хлебом куплено место у водного окна. Получен талон, но локти вокруг запомнили прыжок.', time, '#fa6'));
    publishQueueTradeEvent(state, actor, context, 'bread', 'water_coupon', true);
  }
  return { handled: true };
}

function spendCoupon(
  actor: Entity,
  slotIdx: number,
  couponId: 'water_coupon' | 'concentrate_coupon',
  msgs: Msg[],
  time: number,
  state?: GameState,
): RationUseResult {
  const grantId = couponId === 'water_coupon' ? 'water' : 'grey_briquette';
  const resourceId = couponId === 'water_coupon' ? 'drink_water' : 'food';
  const selectedWillFree = (actor.inventory?.[slotIdx]?.count ?? 0) <= 1;
  if (!hasRoomFor(actor, grantId, selectedWillFree)) {
    msgs.push(msg('Некуда положить пайковую выдачу. Освободите место перед окном.', time, '#aa8'));
    return { handled: true };
  }
  if (!consumeSlot(actor, slotIdx, 1)) return { handled: true };
  addItemToActor(actor, grantId, 1);
  applyFairSpendEconomy(state, resourceId);
  msgs.push(msg(`${itemName(couponId)} принят: выдали ${itemName(grantId)}. Очередь это видела.`, time, '#6a6'));
  publishPlayerCouponEvent(state, actor, 'ration_coupon_spent', couponId, ['coupon_spent', 'fair_trade'], {
    resourceId,
    outputItemId: grantId,
    outcome: 'fair_spend',
    rumorIds: couponId === 'water_coupon'
      ? ['lead_maintenance_watermeter_coupon', 'player_trade_fair']
      : ['lead_maintenance_concentrate_press_coupon', 'player_trade_fair'],
  }, 3);
  return { handled: true };
}

function forgeCoupon(actor: Entity, slotIdx: number, msgs: Msg[], time: number, state?: GameState): RationUseResult {
  const sourceId = ['ration_registry_extract', 'blank_form', 'water_coupon', 'concentrate_coupon']
    .find(id => inventoryCount(actor, id) > 0);
  if (!sourceId) {
    msgs.push(msg('Штемпельная подушка сухо щёлкнула. Нужен бланк, выписка или талон, который можно испортить.', time, '#aa8'));
    return { handled: true };
  }
  if (!consumeSlot(actor, slotIdx, 1) || !consumeItem(actor, sourceId, 1)) return { handled: true };
  addItemToActor(actor, 'forged_ration_card', 1);
  if (state) {
    changeResourceStock(state, 'documents', -1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -1);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
  }
  msgs.push(msg(`Печать легла ровно. Получена поддельная пайковая карточка; ровная печать опаснее кривой.`, time, '#fa6'));
  publishPlayerCouponEvent(state, actor, 'ration_coupon_forged', 'forged_ration_card', ['coupon_forged', 'forgery', 'contraband'], {
    sourceItemId: sourceId,
    outcome: 'forged_card_created',
    ministryDocumentDelta: -1,
    rumorIds: ['ration_coupon_forgery_risk', 'player_forged_stamp_risk'],
  }, 4);
  return { handled: true };
}

function reportCouponFraud(actor: Entity, slotIdx: number, msgs: Msg[], time: number, state?: GameState): RationUseResult {
  if (inventoryCount(actor, 'forged_ration_card') <= 0) {
    msgs.push(msg('Выписка из реестра сама по себе не донос. Нужна поддельная карточка как улика.', time, '#aa8'));
    return { handled: true };
  }
  if (!consumeSlot(actor, slotIdx, 1) || !consumeItem(actor, 'forged_ration_card', 1)) return { handled: true };
  actor.money = (actor.money ?? 0) + 18;
  if (state) {
    changeResourceStock(state, 'food', 4, FloorLevel.KVARTIRY);
    changeResourceStock(state, 'drink_water', 2, FloorLevel.KVARTIRY);
    changeResourceStock(state, 'documents', 1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 3);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 2);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, -3);
  }
  msgs.push(msg('Подделка сдана по выписке. Очереди вернули часть пайка, а рынок запомнил лицо.', time, '#6cf'));
  publishPlayerCouponEvent(state, actor, 'ration_coupon_reported', 'forged_ration_card', ['coupon_reported', 'audit_report', 'evidence'], {
    outcome: 'reported_forgery',
    rewardMoney: 18,
    kvartiryFoodDelta: 4,
    kvartiryWaterDelta: 2,
    ministryDocumentDelta: 1,
    rumorIds: ['ration_coupon_audit_reported', 'lead_kvartiry_ration_queue_registry'],
  }, 4);
  publishPlayerCouponEvent(state, actor, 'ration_audit_resolved', 'ration_registry_extract', ['audit_resolved', 'reported'], {
    outcome: 'reported_forgery',
    rumorIds: ['ration_coupon_audit_reported'],
  }, 4);
  return { handled: true };
}

function sellForgedCard(actor: Entity, slotIdx: number, msgs: Msg[], time: number, state?: GameState): RationUseResult {
  if (!consumeSlot(actor, slotIdx, 1)) return { handled: true };
  actor.money = (actor.money ?? 0) + 32;
  if (state) {
    changeResourceStock(state, 'food', -3, FloorLevel.KVARTIRY);
    changeResourceStock(state, 'documents', -1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 3);
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -2);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
  }
  msgs.push(msg('Поддельная карточка ушла на чёрный рынок за 32₽. Кто-то поест без очереди; кто-то не поест вовсе.', time, '#fa6'));
  publishPlayerCouponEvent(state, actor, 'ration_audit_resolved', 'forged_ration_card', ['audit_resolved', 'black_market', 'contraband'], {
    outcome: 'black_market_sale',
    rewardMoney: 32,
    kvartiryFoodDelta: -3,
    ministryDocumentDelta: -1,
    rumorIds: ['ration_coupon_black_market', 'ration_coupon_forgery_risk'],
  }, 4);
  return { handled: true };
}

export function handleRationCouponUse(
  actor: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state?: GameState,
  zoneId?: number,
  world?: World,
): boolean {
  const slot = actor.inventory?.[slotIdx];
  if (!slot) return false;
  const queueTrade = tradeQueuePlace(actor, slotIdx, msgs, time, state, zoneId, world);
  if (queueTrade.handled) return true;
  if (slot.defId === 'water_coupon' || slot.defId === 'concentrate_coupon') {
    return spendCoupon(actor, slotIdx, slot.defId, msgs, time, state).handled;
  }
  if (slot.defId === 'ration_stamp_pad') return forgeCoupon(actor, slotIdx, msgs, time, state).handled;
  if (slot.defId === 'ration_registry_extract') return reportCouponFraud(actor, slotIdx, msgs, time, state).handled;
  if (slot.defId === 'forged_ration_card') return sellForgedCard(actor, slotIdx, msgs, time, state).handled;
  return false;
}

function publishAuditResolutionFromQuest(state: GameState, event: WorldEvent, sideQuestId: string): void {
  const source = sideQuestId === 'min_coupon_forgery_report' ? 'ministry_queue_hall' : 'kvartiry_ration_queue';
  const foodDelta = sideQuestId === 'min_coupon_forgery_report' ? 3 : 2;
  const waterDelta = sideQuestId === 'min_coupon_forgery_report' ? 1 : 2;
  changeResourceStock(state, 'food', foodDelta, FloorLevel.KVARTIRY);
  changeResourceStock(state, 'drink_water', waterDelta, FloorLevel.KVARTIRY);
  changeResourceStock(state, 'documents', 1, FloorLevel.MINISTRY);
  addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 2);
  addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 1);
  publishEvent(state, {
    type: 'ration_coupon_reported',
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: event.targetName,
    itemId: sideQuestId === 'min_coupon_forgery_report' ? 'forged_ration_card' : 'ration_registry_extract',
    itemName: sideQuestId === 'min_coupon_forgery_report' ? itemName('forged_ration_card') : itemName('ration_registry_extract'),
    severity: 4,
    privacy: 'local',
    tags: ['quest', 'ration_coupon', 'ration_coupon_audit', 'coupon_reported', source],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      source,
      kvartiryFoodDelta: foodDelta,
      kvartiryWaterDelta: waterDelta,
      ministryDocumentDelta: 1,
      rumorIds: ['ration_coupon_audit_reported', 'lead_kvartiry_ration_queue_registry'],
    },
  });
  publishEvent(state, {
    type: 'ration_audit_resolved',
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: event.targetName,
    severity: 4,
    privacy: 'local',
    tags: ['quest', 'ration_coupon', 'ration_coupon_audit', 'audit_resolved', source],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: 'quest_report',
      rumorIds: ['ration_coupon_audit_reported'],
    },
  });
}

function publishCouponStolen(state: GameState, event: WorldEvent): void {
  const itemId = event.itemId ?? '';
  const count = Math.max(1, event.itemCount ?? 1);
  if (itemId === 'water_coupon') changeResourceStock(state, 'drink_water', -count, FloorLevel.KVARTIRY);
  else changeResourceStock(state, 'food', -count, FloorLevel.KVARTIRY);
  addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -1);
  publishEvent(state, {
    type: 'ration_coupon_stolen',
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: event.targetName,
    targetFaction: event.targetFaction,
    itemId,
    itemName: event.itemName ?? itemName(itemId),
    itemCount: count,
    itemValue: event.itemValue,
    containerId: event.containerId,
    containerOwnerId: event.containerOwnerId,
    containerFaction: event.containerFaction,
    severity: event.severity >= 4 ? 5 : 4,
    privacy: event.privacy === 'private' ? 'local' : event.privacy,
    tags: ['ration_coupon', 'ration_coupon_audit', 'coupon_stolen', 'theft', ...event.tags],
    data: {
      sourceEventId: event.id,
      containerName: event.data?.containerName,
      kvartiryResourceDelta: -count,
      rumorIds: ['ration_coupon_black_market', 'container_theft_seen'],
    },
  });
}

function handleRationCouponWorldEvent(state: GameState, event: WorldEvent): void {
  if (event.type === 'item_stolen' && event.itemId && isRationCouponItem(event.itemId)) {
    publishCouponStolen(state, event);
    return;
  }
  if (event.type !== 'quest_completed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  if (!REPORT_SIDE_QUEST_IDS.has(sideQuestId)) return;
  publishAuditResolutionFromQuest(state, event, sideQuestId);
}

registerWorldEventObserver(handleRationCouponWorldEvent);

/* ── Inventory system: items, pickup, use ─────────────────────── */

import {
  type Entity, type GameState, type Item, type ItemDef, type Msg,
  type WorldEventPrivacy, type WorldEventSeverity, ItemType,
  EntityType, Faction, FloorLevel,
  msg,
} from '../core/types';
import { ITEMS, WEAPON_ROLE_LABELS, WEAPON_ROLE_TIERS, WEAPON_STATS, type WeaponStats } from '../data/catalog';
import { GOVNYAK_COURIER_CONTRACT_IDS, GOVNYAK_COURIER_PACKAGE_ITEM } from '../data/contracts';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import {
  DOCUMENT_ACCESS_ACTIONS,
  DOCUMENT_ACCESS_MARKET_VALUES,
  DOCUMENT_MINISTRY_GATE_ACCESS_DEFS,
  DOCUMENT_MINISTRY_GATE_OUTPUTS,
} from '../data/documents_access';
import { addFactionRelMutual } from '../data/relations';
import {
  getStack,
  itemEquipSlot,
  itemHasUseAction,
  itemUseTransformOutput,
  ITEM_TAGS,
  SILVER_SLIME_OPENED_ID,
  SILVER_SLIME_SEALED_ID,
  type ItemUseTransformOutput,
} from '../data/items';
import {
  craftRecipeNoteText,
  craftRecipeSourceConsumesItem,
  craftRecipeSourceIdFromNoteData,
  craftRecipeSourcePassesThroughItemUse,
  craftRecipeSourcesForItem,
  getCraftRecipeSource,
  type CraftRecipeSourceDef,
} from '../data/craft_recipe_sources';
import { getPermitDef, getPermitForgeryRecipe } from '../data/permits';
import { World } from '../core/world';
import { Spr } from '../render/sprite_index';
import { playPickup } from './audio';
import { cleanCellHazardsNear } from './cell_hazards';
import { changeResourceStock } from './economy';
import { publishEvent } from './events';
import { placeMonsterBait, removeMonsterBaitForEntity } from './monster_bait';
import { handleRationCouponUse } from './ration_coupons';
import { recordPermitAccess, recordPermitExposure, recordPermitForged } from './permits';
import {
  govnyakAimSpreadMult,
  isGovnyakItem,
  updateGovnyakConditions,
  useGovnyakItem,
} from './govnyak';
import { destroyMaronaryShaving } from './maronary_shaving';
import { CHALK_ITEM_ID, createChalkItemData } from './chalk';
import {
  FORGED_SHELTER_TALLY_ID,
  SHELTER_TALLY_ID,
  isShelterTallyItem,
  publishShelterTallyEvent,
} from './shelter_tally';
import {
  adjustedPsiCost,
  agiAttackSpeedMult,
  agiRangedSpreadMult,
  meleeDamage,
  strDurabilityWearMult,
  strHeavyWeaponSpeedMult,
  strMeleeDmgMult,
} from './rpg';
import {
  activeSporeHaze,
  activeZhelemishSkin,
  applyZhelemishSkinWithMessage,
  cureSporeHaze,
  cureZhelemishSkin,
  isZhelemishCureItem,
  sporeHazeAimSpreadMult,
  zhelemishHealingMult,
  zhelemishSourceForItem,
} from './status';
import { consumeNoisyDocumentDelay } from './document_scent';
import { pushNpcLogMessage } from './ai/barks';
import { logTutorialMsg, TutorialStep } from './tutorial';
import { isPlayerEntity } from './player_actor';
import {
  craftRecipeLearnedMessage,
  learnCraftRecipesFromSource,
  type CraftRecipeLearnResult,
} from './crafting';
import { controlBindingLabel } from './controls';

const GOVNYAK_COURIER_ROUTE_SET = new Set<string>(GOVNYAK_COURIER_CONTRACT_IDS);
const DIRECT_DOCUMENT_ACTION_ITEMS = new Set(['ammo_coupon_9mm', 'ammo_coupon_shells', 'fuel_issue_stamp', 'foam_grenade_act', 'water_reservoir_quota', 'shelter_seat_card', 'shelter_seat_forgery', 'concentrate_bonus_coupon']);
const DECON_FLUID_ITEM = 'decon_fluid';
const DECON_FLUID_RADIUS = 2.35;
const INCENDIARY_12G_ITEM = 'ammo_12g_incendiary';
const INCENDIARY_12G_RADIUS = 1.65;
const ANTIFUNGAL_OINTMENT_ITEM = 'antifungal_ointment';
const ANTI_SPORE_INHALER_ITEM = 'anti_spore_inhaler';
const GASMASK_FILTER_ITEM = 'gasmask_filter';
const USED_GASMASK_FILTER_ITEM = 'used_gasmask_filter';
const GREEN_ACID_COUNTERMEASURE = 'filter_layer';
const SAMPLE_HANDLING_TOOL_TAG = 'sample_handling';
const SAMPLE_HANDLING_TOOL_WEAR = 1;
const CONTAMINATED_SWAB_ITEM = 'contaminated_swab';
const CONTAMINATED_SWAB_REPORT_REWARD = 8;
const CONTAMINATED_SWAB_MARKET_REWARD = 6;
const VERETAR_UNSEALED_SAND = 'veretar_sand';
const VERETAR_SEALED_SAND = 'sealed_veretar_sand';
const VERETAR_SEAL_ITEMS = ['sealant_tube', 'seal_wax'] as const;
const VERETAR_SPOILED_FOOD = 'sand_spoiled_ration';
const VERETAR_SPOILED_DOCUMENT = 'bleached_document';
const VERETAR_FOOD_TARGETS = new Set([
  'bread', 'canned', 'kasha', 'rawmeat', 'mushroom_mass', 'grey_briquette', 'green_briquette',
  'liquidator_ration', 'pearl_barley', 'soup_cube', 'pressed_sugar', 'yeast_bread',
]);
const VERETAR_DOCUMENT_TARGETS = new Set([
  'note', 'book', 'blank_form', 'temp_pass', 'permanent_pass', 'caravan_route', 'lift_scheme',
  'archive_access_permit', 'forged_stamp_sheet', 'stolen_archive_card', 'missing_record_file',
  'record_exposure_notice', 'passport_stub', 'personal_file_copy', 'neighbor_complaint',
  'denunciation', 'unsigned_order', 'siren_instruction', 'voluntary_receipt', 'samosbor_tally',
  'sealed_complaint', 'elevator_override_form', 'pressure_logbook', 'ration_stamp_pad',
  'emergency_roster', 'official_permit_slip', 'forged_permit_slip', 'weapon_permit_signed',
  'weapon_permit_forged', 'ammo_issue_order', 'official_quarantine_clearance',
  'forged_quarantine_clearance', 'ration_registry_extract', 'forged_ration_card',
  'elevator_access_order', 'void_archive_warrant', 'ministry_audit_forgery',
  'ministry_clean_stamp', 'raionsovet_floor_pass', 'forged_raionsovet_pass',
  'bank_debt_paper', 'forged_bank_debt_paper', 'debt_settlement_receipt',
  'confiscation_warrant', 'cleanup_order_stub',
]);

const AMMO_LABELS: Record<string, string> = {
  ammo_9mm: '9мм',
  ammo_shells: 'дробь',
  ammo_nails: 'гвозди',
  ammo_762: '7.62',
  ammo_belt: 'лента',
  ammo_energy: 'энерго',
  ammo_fuel: 'бензин',
  napalm_mix: 'напалм',
  ammo_762tt: '7.62 ТТ',
  ammo_nagant: 'Наган',
  ammo_harpoon: 'гарпуны',
  rifle_bolt_pack: 'болты',
  grenade: 'граната',
  shmk_disposable: 'ШМК',
  foam_grenade_6p10: 'пена',
  pbrog1_foam_launcher: 'ПБРОГ',
  breach_charge: 'заряд',
  concrete_breaker_grenade: 'бетонка',
  chest_failsafe_charge: 'фугас',
};

const DOCUMENT_GATE_ITEMS = new Set([
  'official_permit_slip',
  'forged_permit_slip',
  'fake_pass',
  'ministry_audit_forgery',
  'stolen_archive_card',
  'raionsovet_floor_pass',
  'forged_raionsovet_pass',
  'bank_debt_paper',
  'forged_bank_debt_paper',
  'debt_settlement_receipt',
  'confiscation_warrant',
  'cleanup_order_stub',
  'labor_shift_card',
  'hazard_shift_extension',
]);
type DocumentMinistryGateAccessDef = (typeof DOCUMENT_MINISTRY_GATE_ACCESS_DEFS)[number];
const DOCUMENT_MINISTRY_GATE_ACCESS_BY_ITEM = new Map<string, DocumentMinistryGateAccessDef>(
  DOCUMENT_MINISTRY_GATE_ACCESS_DEFS.map(def => [def.itemId, def] as const),
);
const DOCUMENT_MINISTRY_GATE_OUTPUT_BY_ITEM: Record<string, string> = DOCUMENT_MINISTRY_GATE_OUTPUTS;
const DOCUMENT_MARKET_VALUES: Record<string, number> = {
  ...DOCUMENT_ACCESS_MARKET_VALUES,
  liquidator_field_roster: 48,
  weapon_checkout_tag: 28,
  scrubbed_weapon_tag: 46,
  contraband_receipt_blank: 42,
  forged_permit_slip: 38,
  fake_pass: 35,
  ministry_audit_forgery: 64,
  stolen_archive_card: 55,
  forged_raionsovet_pass: 54,
  forged_bank_debt_paper: 62,
  bank_debt_paper: 50,
  debt_settlement_receipt: 70,
  passport_stub: 34,
  hermodoor_journal: 52,
  p14_gasmask_receipt: 28,
  cleanup_order_stub: 46,
  slime_age_label_brown: 18,
};
const AUDIT_PROOF_TRADE_VALUES: Record<string, { market: number; report: number }> = {
  scrubbed_serial_plate: { market: 72, report: 54 },
};

export interface WeaponReadiness {
  id: string;
  name: string;
  role: string;
  statLabel: string;
  damage: number;
  damageLabel: string;
  range: number;
  pellets: number;
  knockback: number;
  reachLabel: string;
  controlLabel: string;
  cooldown: number;
  cooldownMax: number;
  cooldownPct: number;
  readyPct: number;
  reloadPct: number;
  reloading: boolean;
  cooldownLabel: string;
  resourceKind: 'none' | 'ammo' | 'psi' | 'durability';
  resourceName: string;
  resourceCurrent: number;
  resourceMax?: number;
  resourceCost?: number;
  resourceLabel: string;
  cannotFireReason: string;
  lowResource: boolean;
  warning: boolean;
}

export type InventoryPrepTone = 'ok' | 'warn' | 'bad' | 'muted';
export type InventoryItemCategory = 'weapon' | 'tool' | 'ammo' | 'medicine' | 'water' | 'food' | 'documents' | 'psi' | 'trade' | 'other';

export interface InventoryPrepLine {
  id: 'weapon' | 'tool' | 'ammo' | 'medicine' | 'water' | 'food' | 'documents' | 'psi';
  label: string;
  value: string;
  detail: string;
  tone: InventoryPrepTone;
}

export interface InventorySlotActionInfo {
  defId: string;
  name: string;
  count: number;
  stackMax: number;
  category: InventoryItemCategory;
  categoryLabel: string;
  equippedLabel: string;
  useLabel: string;
  dropLabel: string;
  sellLabel: string;
  canUse: boolean;
  canDrop: boolean;
  isEquippedWeapon: boolean;
  isEquippedTool: boolean;
}

export interface InventoryUseHandlerContext {
  actor: Entity;
  slotIdx: number;
  slot: Item;
  def: ItemDef;
  msgs: Msg[];
  time: number;
  state?: GameState;
  zoneId?: number;
  world?: World;
}

export type InventoryUseHandler = (ctx: InventoryUseHandlerContext) => boolean;

interface GreenAcidPickupData {
  ag64GreenAcid: true;
  organicRisk?: boolean;
  sample?: boolean;
  warned?: boolean;
}

export interface PickupDropResult {
  handled: boolean;
  pickedAny: boolean;
  depleted: boolean;
  pickedItems?: Item[];
  blockedReason?: 'empty' | 'inventory_full';
}

// Side-effect floor modules can register through import cycles before this module finishes evaluating.
var inventoryUseHandlers: InventoryUseHandler[] | undefined;

function getInventoryUseHandlers(): InventoryUseHandler[] {
  if (!inventoryUseHandlers) inventoryUseHandlers = [];
  return inventoryUseHandlers;
}

export function registerInventoryUseHandler(handler: InventoryUseHandler): void {
  const handlers = getInventoryUseHandlers();
  if (!handlers.includes(handler)) handlers.push(handler);
}

function canStackData(a: unknown, b: unknown): boolean {
  return a === undefined && b === undefined;
}

function greenAcidPickupData(data: unknown): GreenAcidPickupData | null {
  if (!data || typeof data !== 'object') return null;
  const acid = data as Partial<GreenAcidPickupData>;
  return acid.ag64GreenAcid === true ? acid as GreenAcidPickupData : null;
}

function setGreenAcidWarned(item: Item): void {
  if (!item.data || typeof item.data !== 'object') return;
  (item.data as GreenAcidPickupData).warned = true;
}

function equippedToolWithTag(actor: Entity, tag: string): string | undefined {
  const toolId = actor.tool ?? '';
  if (!toolId) return undefined;
  const def = ITEMS[toolId];
  if (!def || def.type !== ItemType.TOOL) return undefined;
  return itemHasTag(toolId, tag) ? toolId : undefined;
}

function publishGreenAcidItemEvent(
  state: GameState | undefined,
  actor: Entity,
  kind: 'exposure' | 'neutralization' | 'sample',
  defId: string,
  count: number,
  zoneId: number,
  x: number,
  y: number,
  neutralizerId?: string,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[defId];
  const eventItemId = kind === 'neutralization' ? neutralizerId ?? GREEN_ACID_COUNTERMEASURE : defId;
  const eventDef = ITEMS[eventItemId];
  const neutralizerTags = kind === 'neutralization'
    ? [...(ITEM_TAGS[eventItemId] ?? []), ...(eventDef?.tags ?? [])].filter(tag => tag === 'sample_handling' || tag === 'cleanup')
    : [];
  publishEvent(state, {
    type: kind === 'neutralization' ? 'player_use_item' : 'player_pick_item',
    zoneId,
    x,
    y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: eventItemId,
    itemName: eventDef?.name ?? eventItemId,
    itemCount: count,
    itemValue: eventDef?.value ?? 0,
    severity: kind === 'sample' ? 3 : kind === 'neutralization' ? 3 : 2,
    privacy: 'private',
    tags: ['player', 'inventory', 'slime', 'acid', 'green_acid', kind, ...neutralizerTags],
    data: {
      source: 'ag64_green_acid_room',
      affectedItemId: defId,
      affectedItemName: def?.name ?? defId,
      neutralizerId: kind === 'neutralization' ? eventItemId : undefined,
    },
  });
}

function veretarSpoilageKind(defId: string): 'food' | 'document' | undefined {
  if (VERETAR_FOOD_TARGETS.has(defId)) return 'food';
  if (VERETAR_DOCUMENT_TARGETS.has(defId)) return 'document';
  return undefined;
}

function hasUnsealedVeretarSand(actor: Entity): boolean {
  return (actor.inventory ?? []).some(slot => slot.defId === VERETAR_UNSEALED_SAND && slot.count > 0);
}

function canAddSingle(actor: Entity, defId: string): boolean {
  const def = ITEMS[defId];
  if (!def) return false;
  const inv = actor.inventory ?? [];
  return inv.some(slot => slot.defId === defId && slot.count < getStack(def) && canStackData(slot.data, undefined))
    || inv.length < MAX_INVENTORY_SLOTS;
}

function itemAddCapacityAfterConsumingSlot(e: Entity, slotIdx: number, defId: string, count: number, data?: unknown): number {
  const def = ITEMS[defId];
  if (!def || count <= 0) return 0;
  const inv = e.inventory ?? [];
  const stackMax = getStack(def);
  let capacity = 0;
  let occupiedAfter = inv.length;
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i];
    const slotCount = i === slotIdx ? slot.count - 1 : slot.count;
    if (slotCount <= 0) {
      occupiedAfter--;
      continue;
    }
    if (slot.defId === defId && slotCount < stackMax && canStackData(slot.data, data)) {
      capacity += stackMax - slotCount;
    }
  }
  capacity += Math.max(0, MAX_INVENTORY_SLOTS - occupiedAfter) * stackMax;
  return capacity;
}

function canApplyUseTransformOutput(e: Entity, slotIdx: number, output: ItemUseTransformOutput): boolean {
  return itemAddCapacityAfterConsumingSlot(e, slotIdx, output.outputId, output.count) >= output.count;
}

function decrementInventorySlot(inv: Item[], slotIdx: number): void {
  const slot = inv[slotIdx];
  if (!slot) return;
  slot.count--;
  if (slot.count <= 0) inv.splice(slotIdx, 1);
}

function findVeretarSealItem(actor: Entity): string | undefined {
  for (const id of VERETAR_SEAL_ITEMS) if (hasItem(actor, id)) return id;
  return undefined;
}

function hasRoomForSealedSand(inv: Item[], selectedSand: Item, sealItemId: string): boolean {
  const sealedDef = ITEMS[VERETAR_SEALED_SAND];
  if (!sealedDef) return false;
  if (selectedSand.count <= 1) return true;
  if (inv.some(slot => slot.defId === VERETAR_SEALED_SAND && slot.count < getStack(sealedDef) && canStackData(slot.data, undefined))) return true;
  const sealSlot = inv.find(slot => slot.defId === sealItemId);
  return inv.length < MAX_INVENTORY_SLOTS || sealSlot?.count === 1;
}

function publishVeretarSandEvent(
  state: GameState | undefined,
  actor: Entity,
  action: string,
  itemId: string,
  count: number,
  severity: 1 | 2 | 3,
  zoneId?: number,
  affectedItemId?: string,
  replacementItemId?: string,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[itemId];
  const affectedDef = affectedItemId ? ITEMS[affectedItemId] : undefined;
  publishEvent(state, {
    type: action === 'unsealed_pickup' ? 'player_pick_item' : 'player_use_item',
    zoneId,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId,
    itemName: def?.name ?? itemId,
    itemCount: count,
    itemValue: def?.value ?? 0,
    severity,
    privacy: 'private',
    tags: ['player', 'inventory', 'veretar', 'sand', action, ...(ITEM_TAGS[itemId] ?? [])].slice(0, 8),
    data: {
      action,
      affectedItemId,
      affectedItemName: affectedDef?.name,
      replacementItemId,
      replacementItemName: replacementItemId ? ITEMS[replacementItemId]?.name : undefined,
    },
  });
}

function spoilOneVeretarNeighbor(actor: Entity, preferredDefId?: string): {
  oldItemId: string;
  oldItemName: string;
  replacementItemId: string;
  replacementItemName: string;
} | null {
  const inv = actor.inventory;
  if (!inv) return null;
  let idx = preferredDefId ? inv.findIndex(slot => slot.defId === preferredDefId && veretarSpoilageKind(slot.defId)) : -1;
  if (idx < 0) idx = inv.findIndex(slot => veretarSpoilageKind(slot.defId));
  if (idx < 0) return null;

  const slot = inv[idx];
  const kind = veretarSpoilageKind(slot.defId);
  if (!kind) return null;
  const replacementItemId = kind === 'food' ? VERETAR_SPOILED_FOOD : VERETAR_SPOILED_DOCUMENT;
  if (slot.count > 1 && !canAddSingle(actor, replacementItemId)) return null;

  const oldItemId = slot.defId;
  const oldItemName = ITEMS[oldItemId]?.name ?? oldItemId;
  decrementInventorySlot(inv, idx);
  addItem(actor, replacementItemId, 1);
  return {
    oldItemId,
    oldItemName,
    replacementItemId,
    replacementItemName: ITEMS[replacementItemId]?.name ?? replacementItemId,
  };
}

function handleVeretarPickupRisk(
  actor: Entity,
  pickedDefId: string,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number,
): void {
  const pickedSand = pickedDefId === VERETAR_UNSEALED_SAND;
  const pickedVulnerable = veretarSpoilageKind(pickedDefId) !== undefined;
  if (!pickedSand && !pickedVulnerable) return;
  if (!hasUnsealedVeretarSand(actor)) return;

  const spoiled = spoilOneVeretarNeighbor(actor, pickedVulnerable ? pickedDefId : undefined);
  if (spoiled) {
    msgs.push(msg(
      `Белый песок просыпался: ${spoiled.oldItemName} испорчен. Запечатайте пробу герметиком.`,
      time, '#f4e7b0',
    ));
    publishVeretarSandEvent(state, actor, 'spoilage', VERETAR_UNSEALED_SAND, 1, 3, zoneId, spoiled.oldItemId, spoiled.replacementItemId);
    return;
  }

  if (pickedSand) {
    msgs.push(msg('Белый песок открыт: следующий пайк или бумага в сумке может испортиться. Запечатайте герметиком или держите слот свободным.', time, '#f4e7b0'));
    publishVeretarSandEvent(state, actor, 'unsealed_pickup', VERETAR_UNSEALED_SAND, 1, 2, zoneId);
  }
}

function handleVeretarSandUse(e: Entity, slotIdx: number, msgs: Msg[], time: number, state?: GameState): boolean {
  if (!e.inventory || slotIdx >= e.inventory.length) return false;
  const slot = e.inventory[slotIdx];
  if (slot.defId === VERETAR_SEALED_SAND) {
    msgs.push(msg('Гермопакет с белым песком цел. Несите его по назначению, не вскрывая.', time, '#f4e7b0'));
    publishVeretarSandEvent(state, e, 'sealed_check', VERETAR_SEALED_SAND, 1, 1);
    return true;
  }
  if (slot.defId !== VERETAR_UNSEALED_SAND) return false;

  const sealItemId = findVeretarSealItem(e);
  if (sealItemId) {
    if (!hasRoomForSealedSand(e.inventory, slot, sealItemId)) {
      msgs.push(msg('Для гермопакета нужен свободный слот или место в стопке проб.', time, '#f4e7b0'));
      publishVeretarSandEvent(state, e, 'seal_blocked', VERETAR_UNSEALED_SAND, 1, 2);
      return true;
    }
    if (slot.count <= 1) {
      slot.defId = VERETAR_SEALED_SAND;
      slot.count = 1;
      slot.data = undefined;
    } else {
      slot.count--;
      addItem(e, VERETAR_SEALED_SAND, 1);
    }
    removeItem(e, sealItemId, 1);
    msgs.push(msg(`Белый песок запечатан. Потрачен ${ITEMS[sealItemId]?.name ?? sealItemId}.`, time, '#f4e7b0'));
    publishVeretarSandEvent(state, e, 'sealed', VERETAR_SEALED_SAND, 1, 3, undefined, sealItemId);
    return true;
  }

  decrementInventorySlot(e.inventory, slotIdx);
  msgs.push(msg('Белый песок вытряхнут в щель пола. Доказательство уничтожено.', time, '#d8d4bf'));
  publishVeretarSandEvent(state, e, 'destroyed', VERETAR_UNSEALED_SAND, 1, 2);
  return true;
}

export function publishPlayerItemEvent(
  state: GameState | undefined,
  actor: Entity,
  type: 'player_pick_item' | 'player_drop_item' | 'player_use_item' | 'tool_broke' | 'ammo_consumed',
  defId: string,
  count: number,
  severity: 0 | 1 | 2 | 3,
  zoneId?: number,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[defId];
  const tags = ['player', 'inventory', def?.type !== undefined ? `item_type_${def.type}` : 'item'];
  for (const tag of ITEM_TAGS[defId] ?? []) if (!tags.includes(tag)) tags.push(tag);
  for (const tag of def?.tags ?? []) if (!tags.includes(tag)) tags.push(tag);
  const eventSeverity = defId === 'maronary_shaving' && type === 'player_pick_item' && severity < 3 ? 3 : severity;
  publishEvent(state, {
    type,
    zoneId,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: defId,
    itemName: def?.name ?? defId,
    itemCount: count,
    itemValue: def?.value ?? 0,
    severity: eventSeverity,
    privacy: defId === 'maronary_shaving' ? 'local' : 'private',
    tags,
  });
}

function openGovnyakCourierPackage(actor: Entity, msgs: Msg[], time: number, state?: GameState): boolean {
  if (!state) {
    msgs.push(msg('Пломба держит пакет закрытым. Нужен активный маршрут.', time, '#888'));
    return true;
  }

  const failedContracts: string[] = [];
  for (const q of state.quests) {
    if (q.done || !q.contractId || !GOVNYAK_COURIER_ROUTE_SET.has(q.contractId)) continue;
    q.done = true;
    q.failed = true;
    failedContracts.push(q.contractId);
    publishEvent(state, {
      type: 'contract_failed',
      actorId: q.giverId,
      actorName: q.giverName,
      actorFaction: q.contractFaction,
      targetName: q.desc,
      severity: 4,
      privacy: 'local',
      tags: ['quest', 'contract', 'failed', 'govnyak_courier', 'opened_package'],
      data: {
        questId: q.id,
        contractId: q.contractId,
        reason: 'opened_package',
        packageItem: GOVNYAK_COURIER_PACKAGE_ITEM,
      },
    });
  }

  removeItem(actor, GOVNYAK_COURIER_PACKAGE_ITEM, 1);
  msgs.push(msg(
    failedContracts.length > 0
      ? 'Пломба сорвана. Внутри серый табачный комок и бумаги. Курьерский маршрут провален.'
      : 'Пломба сорвана. Внутри почти пусто. Метка активна.',
    time,
    '#f84',
  ));
  publishEvent(state, {
    type: 'player_use_item',
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: GOVNYAK_COURIER_PACKAGE_ITEM,
    itemName: ITEMS[GOVNYAK_COURIER_PACKAGE_ITEM]?.name ?? GOVNYAK_COURIER_PACKAGE_ITEM,
    itemCount: 1,
    itemValue: ITEMS[GOVNYAK_COURIER_PACKAGE_ITEM]?.value ?? 0,
    severity: 4,
    privacy: 'private',
    tags: ['player', 'inventory', 'govnyak_courier', 'opened_package', 'contraband'],
    data: {
      failedContracts,
      reason: 'opened_package',
      suspicion: 'market_saw_broken_seal',
    },
  });
  return true;
}

function handleGasmaskFilterUse(
  actor: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
): boolean {
  const inv = actor.inventory;
  const slot = inv?.[slotIdx];
  if (!inv || !slot || slot.defId !== GASMASK_FILTER_ITEM) return false;

  if (slot.count > 1 && !canAddSingle(actor, USED_GASMASK_FILTER_ITEM)) {
    msgs.push(msg('Отработанный фильтр некуда положить. Освободите слот или сдайте старые фильтры.', time, '#c9b38a'));
    return true;
  }

  if (slot.count <= 1) {
    slot.defId = USED_GASMASK_FILTER_ITEM;
    slot.count = 1;
    slot.data = undefined;
  } else {
    slot.count--;
    addItem(actor, USED_GASMASK_FILTER_ITEM, 1);
  }

  const source = ITEMS[GASMASK_FILTER_ITEM];
  const produced = ITEMS[USED_GASMASK_FILTER_ITEM];
  msgs.push(msg('Фильтр отработал: дыхание выровнялось, в сумке осталась мокрая улика.', time, '#c9b38a'));
  if (state && isPlayerEntity(actor)) {
    publishEvent(state, {
      type: 'player_use_item',
      zoneId,
      actorId: actor.id,
      actorName: actor.name ?? 'Вы',
      actorFaction: actor.faction,
      itemId: GASMASK_FILTER_ITEM,
      itemName: source?.name ?? GASMASK_FILTER_ITEM,
      itemCount: 1,
      itemValue: source?.value ?? 0,
      severity: 3,
      privacy: 'private',
      tags: ['player', 'inventory', 'filter', 'gasmask', 'ppe', 'cleanup', 'contaminant', 'audit'],
      data: {
        action: 'spent_filter',
        producedItemId: USED_GASMASK_FILTER_ITEM,
        producedItemName: produced?.name ?? USED_GASMASK_FILTER_ITEM,
      },
    });
  }
  return true;
}

function handleDeconFluidUse(
  actor: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const inv = actor.inventory;
  const slot = inv?.[slotIdx];
  if (!inv || !slot || slot.defId !== DECON_FLUID_ITEM) return false;

  if (!state || !world) {
    msgs.push(msg('Обеззараживающая жидкость нужна на реальном пятне слизи или грибницы.', time, '#c9b38a'));
    return true;
  }

  const cleaned = cleanCellHazardsNear(world, actor.x, actor.y, DECON_FLUID_RADIUS, state, actor, 'solvent');
  if (cleaned <= 0) {
    msgs.push(msg('Рядом нет слизи или грибного налёта под раствор. Сохраните жидкость для зачистки.', time, '#aa8'));
    return true;
  }

  decrementInventorySlot(inv, slotIdx);
  const source = ITEMS[DECON_FLUID_ITEM];
  msgs.push(msg(`Обеззараживающая жидкость сняла налёт: ${cleaned} кл.`, time, '#9f8'));
  if (isPlayerEntity(actor)) {
    publishEvent(state, {
      type: 'player_use_item',
      zoneId,
      actorId: actor.id,
      actorName: actor.name ?? 'Вы',
      actorFaction: actor.faction,
      itemId: DECON_FLUID_ITEM,
      itemName: source?.name ?? DECON_FLUID_ITEM,
      itemCount: 1,
      itemValue: source?.value ?? 0,
      severity: 3,
      privacy: 'private',
      tags: ['player', 'inventory', 'cleanup', 'decon', 'slime', 'fungus', 'reagent', 'solvent'],
      data: {
        action: 'decon_cleanup',
        cleanedHazardCells: cleaned,
        radius: DECON_FLUID_RADIUS,
      },
    });
  }
  return true;
}

function handleIncendiary12gUse(
  actor: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const inv = actor.inventory;
  const slot = inv?.[slotIdx];
  if (!inv || !slot || slot.defId !== INCENDIARY_12G_ITEM) return false;

  if (!state || !world) {
    msgs.push(msg('Зажигательная дробь нужна у реального пятна слизи или грибницы.', time, '#c9b38a'));
    return true;
  }

  const cleaned = cleanCellHazardsNear(world, actor.x, actor.y, INCENDIARY_12G_RADIUS, state, actor, 'fire');
  if (cleaned <= 0) {
    msgs.push(msg('Рядом нет налёта под поджог. Сохраните зажигательную дробь для зачистки.', time, '#aa8'));
    return true;
  }

  decrementInventorySlot(inv, slotIdx);
  const source = ITEMS[INCENDIARY_12G_ITEM];
  msgs.push(msg(`Зажигательная дробь выжгла налёт: ${cleaned} кл.`, time, '#fa4'));
  if (isPlayerEntity(actor)) {
    publishEvent(state, {
      type: 'player_use_item',
      zoneId,
      actorId: actor.id,
      actorName: actor.name ?? 'Вы',
      actorFaction: actor.faction,
      itemId: INCENDIARY_12G_ITEM,
      itemName: source?.name ?? INCENDIARY_12G_ITEM,
      itemCount: 1,
      itemValue: source?.value ?? 0,
      severity: 4,
      privacy: 'local',
      tags: ['player', 'inventory', 'ammo', 'shotgun', 'fire', 'cleanup', 'slime', 'fungus'],
      data: {
        action: 'incendiary_shell_cleanup',
        cleanedHazardCells: cleaned,
        radius: INCENDIARY_12G_RADIUS,
      },
    });
  }
  return true;
}

export function publishItemTradeEvent(
  state: GameState | undefined,
  seller: Entity,
  buyer: Entity,
  defId: string,
  price: number,
  count = 1,
): void {
  if (!state) return;
  const player = isPlayerEntity(seller) ? seller : isPlayerEntity(buyer) ? buyer : undefined;
  if (!player) return;
  const other = player === seller ? buyer : seller;
  const def = ITEMS[defId];
  const govnyak = isGovnyakItem(defId);
  const playerSelling = player === seller;
  const confiscation = govnyak && playerSelling && other.faction === Faction.LIQUIDATOR;
  publishEvent(state, {
    type: playerSelling ? 'player_sell_item' : 'player_handoff_item',
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: other.id,
    targetName: other.name,
    targetFaction: other.faction,
    itemId: defId,
    itemName: def?.name ?? defId,
    itemCount: count,
    itemValue: price,
    severity: govnyak ? confiscation ? 4 : 3 : 1,
    privacy: govnyak ? 'local' : 'private',
    tags: [
      'player',
      'inventory',
      'trade',
      playerSelling ? 'sell' : 'buy',
      ...(govnyak ? ['govnyak', 'contraband'] : []),
      ...(confiscation ? ['confiscation', 'liquidator'] : []),
    ],
    data: {
      price,
      sellerId: seller.id,
      sellerName: seller.name,
      buyerId: buyer.id,
      buyerName: buyer.name,
      direction: playerSelling ? 'player_to_npc' : 'npc_to_player',
      rumorIds: govnyak ? [confiscation ? 'govnyak_confiscation' : 'govnyak_trade'] : [],
    },
  });
}

function consumeInventorySlot(e: Entity, slotIdx: number): void {
  const slot = e.inventory?.[slotIdx];
  if (!slot) return;
  slot.count--;
  if (slot.count <= 0) e.inventory?.splice(slotIdx, 1);
}

function zhelemishHealingFrictionText(e: Entity, beforeHp: number | undefined, time: number): string {
  if (beforeHp === undefined || e.hp === undefined || e.hp <= beforeHp) return '';
  const mult = zhelemishHealingMult(e, time);
  if (mult >= 1) return '';
  const rawGain = e.hp - beforeHp;
  const adjustedGain = Math.max(1, Math.round(rawGain * mult));
  e.hp = Math.min(e.maxHp ?? 100, beforeHp + adjustedGain);
  return ` Желемыш снизил лечение: +${adjustedGain}/${Math.round(rawGain)}.`;
}

function publishSilverSlimeInventoryEvent(
  state: GameState | undefined,
  actor: Entity,
  type: 'player_use_item' | 'player_destroy_item',
  defId: string,
  severity: 3 | 4,
  zoneId: number | undefined,
  outcome: string,
  rumorId: string,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[defId];
  publishEvent(state, {
    type,
    zoneId,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: defId,
    itemName: def?.name ?? defId,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity,
    privacy: 'witnessed',
    tags: ['player', 'inventory', 'slime', 'silver_slime', 'sample', outcome],
    data: { outcome, rumorIds: [rumorId] },
  });
}

function handleSilverSlimeUse(
  e: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
): boolean {
  const slot = e.inventory?.[slotIdx];
  if (!slot) return false;

  if (slot.defId === SILVER_SLIME_SEALED_ID) {
    let psiGain = 0;
    if (e.rpg) {
      const before = e.rpg.psi;
      e.rpg.psi = Math.min(e.rpg.maxPsi, e.rpg.psi + 12);
      psiGain = Math.round(e.rpg.psi - before);
    }
    if (e.needs) {
      e.needs.sleep = Math.min(100, e.needs.sleep + 25);
      e.needs.water = Math.max(0, e.needs.water - 12);
      e.needs.pendingPee = (e.needs.pendingPee ?? 0) + 6;
    }
    if (e.hp !== undefined) e.hp = Math.max(1, e.hp - 6);

    consumeInventorySlot(e, slotIdx);
    addItem(e, SILVER_SLIME_OPENED_ID, 1);

    msgs.push(msg(`Прозрачная слизь вскрыта: сон +25, ПСИ +${psiGain}, вода -12, HP -6. Пломба уже не доказательство.`, time, '#bfc'));
    publishSilverSlimeInventoryEvent(
      state,
      e,
      'player_use_item',
      SILVER_SLIME_SEALED_ID,
      4,
      zoneId,
      'silver_slime_opened',
      'silver_slime_used_suspicion',
    );
    return true;
  }

  if (slot.defId === SILVER_SLIME_OPENED_ID) {
    if (e.needs) e.needs.water = Math.max(0, e.needs.water - 4);
    if (e.hp !== undefined) e.hp = Math.max(1, e.hp - 2);
    consumeInventorySlot(e, slotIdx);
    msgs.push(msg('Открытая проба уничтожена: вода -4, HP -2. Дешевле, чем объяснять запах.', time, '#9cf'));
    publishSilverSlimeInventoryEvent(
      state,
      e,
      'player_destroy_item',
      SILVER_SLIME_OPENED_ID,
      3,
      zoneId,
      'silver_slime_destroyed',
      'silver_slime_destroyed_suspicion',
    );
    return true;
  }

  return false;
}

function itemAddCapacity(e: Entity, defId: string, count: number, data: unknown): number {
  if (count <= 0) return 0;
  const def = ITEMS[defId];
  if (!def) return 0;
  const stackMax = getStack(def);
  let capacity = 0;
  for (const slot of e.inventory ?? []) {
    if (slot.defId === defId && slot.count < stackMax && canStackData(slot.data, data)) {
      capacity += stackMax - slot.count;
      if (capacity >= count) return capacity;
    }
  }
  capacity += Math.max(0, MAX_INVENTORY_SLOTS - (e.inventory?.length ?? 0)) * stackMax;
  return capacity;
}

export function canAddItem(e: Entity, defId: string, count = 1, data?: unknown): boolean {
  if (!ITEMS[defId]) return false;
  if (count <= 0) return true;
  return itemAddCapacity(e, defId, count, data) >= count;
}

function defaultSlotData(defId: string, def: ItemDef, data: unknown): unknown {
  if (data !== undefined) return data;
  const ws = WEAPON_STATS[defId];
  if (defId === CHALK_ITEM_ID) return createChalkItemData(def.durability ?? 0);
  if (ws && !ws.isRanged && ws.durability > 0) return { dur: ws.durability };
  if (def.durability && def.durability > 0) return { dur: def.durability };
  return undefined;
}

function addItemMovedCount(e: Entity, defId: string, count = 1, data?: unknown): number {
  const def = ITEMS[defId];
  if (!def || count <= 0) return 0;
  count = Math.min(count, itemAddCapacity(e, defId, count, data));
  if (count <= 0) return 0;
  if (!e.inventory) e.inventory = [];

  const originalCount = count;
  const stackMax = getStack(def);
  // Try stacking
  for (const slot of e.inventory) {
    if (slot.defId === defId && slot.count < stackMax && canStackData(slot.data, data)) {
      const add = Math.min(count, stackMax - slot.count);
      slot.count += add;
      count -= add;
      if (count <= 0) return originalCount;
    }
  }

  // New slot — init durability for melee weapons
  while (count > 0 && e.inventory.length < MAX_INVENTORY_SLOTS) {
    const add = Math.min(count, stackMax);
    const slotData = defaultSlotData(defId, def, data);
    e.inventory.push({ defId, count: add, data: slotData });
    count -= add;
  }

  return originalCount - count;
}

/* ── Add item to entity inventory ─────────────────────────────── */
export function addItem(e: Entity, defId: string, count = 1, data?: unknown): boolean {
  if (!canAddItem(e, defId, count, data)) return false;
  return addItemMovedCount(e, defId, count, data) === Math.max(0, count);
}

/* ── Remove item from inventory ───────────────────────────────── */
export function removeItem(e: Entity, defId: string, count = 1): boolean {
  if (!e.inventory) return false;
  for (let i = e.inventory.length - 1; i >= 0; i--) {
    const slot = e.inventory[i];
    if (slot.defId === defId) {
      const rem = Math.min(count, slot.count);
      slot.count -= rem;
      count -= rem;
      if (slot.count <= 0) e.inventory.splice(i, 1);
      if (count <= 0) return true;
    }
  }
  return count <= 0;
}

/* ── Check if entity has item ─────────────────────────────────── */
export function hasItem(e: Entity, defId: string): boolean {
  return (e.inventory ?? []).some(i => i.defId === defId);
}

function inventoryCount(e: Entity, defId: string): number {
  let total = 0;
  for (const slot of e.inventory ?? []) if (slot.defId === defId) total += slot.count;
  return total;
}

function itemHasTag(defId: string, tag: string): boolean {
  const def = ITEMS[defId];
  return (ITEM_TAGS[defId]?.includes(tag) ?? false) || (def?.tags?.includes(tag) ?? false);
}

function isDocumentLike(defId: string, def: ItemDef): boolean {
  return def.type === ItemType.NOTE
    || def.type === ItemType.KEY
    || itemHasTag(defId, 'document')
    || itemHasTag(defId, 'permit')
    || itemHasTag(defId, 'coupon')
    || itemHasTag(defId, 'document_gate');
}

export function inventoryItemCategory(defId: string): InventoryItemCategory {
  const def = ITEMS[defId];
  if (!def) return 'other';
  if (defId.startsWith('psi_') || itemHasTag(defId, 'psi') || itemHasTag(defId, 'psi_restore')) return 'psi';
  if (def.type === ItemType.WEAPON) return 'weapon';
  if (def.type === ItemType.TOOL) return 'tool';
  if (def.type === ItemType.AMMO || itemHasTag(defId, 'ammo')) return 'ammo';
  if (def.type === ItemType.MEDICINE) return 'medicine';
  if (def.type === ItemType.DRINK) return 'water';
  if (def.type === ItemType.FOOD) return 'food';
  if (isDocumentLike(defId, def)) return 'documents';
  if (itemHasTag(defId, 'trade') || itemHasTag(defId, 'contraband') || itemHasTag(defId, 'evidence')) return 'trade';
  return 'other';
}

function inventoryCategoryLabel(category: InventoryItemCategory): string {
  switch (category) {
    case 'weapon': return 'оружие';
    case 'tool': return 'инструмент';
    case 'ammo': return 'боеприпас';
    case 'medicine': return 'медицина';
    case 'water': return 'вода';
    case 'food': return 'еда';
    case 'documents': return 'документ';
    case 'psi': return 'ПСИ';
    case 'trade': return 'товар';
    default: return 'прочее';
  }
}

function inventorySpecialUseLabel(defId: string, def: ItemDef, slot: Item): string {
  const accept = controlBindingLabel('gameMenu');
  if (def.type === ItemType.NOTE && slot.data) return `${accept} прочесть`;
  if (itemHasTag(defId, 'coupon') || itemHasTag(defId, 'single_use')) return `${accept} погасить`;
  if (itemHasTag(defId, 'permit') || itemHasTag(defId, 'document_gate')) return `${accept} предъявить`;
  if (defId === DECON_FLUID_ITEM) return `${accept} зачистить`;
  if (defId === INCENDIARY_12G_ITEM) return `${accept} выжечь`;
  if (defId === GASMASK_FILTER_ITEM) return `${accept} отработать`;
  if (defId === CONTAMINATED_SWAB_ITEM) return `${accept} сдать/сбыть`;
  if (itemHasTag(defId, 'temporary_seal')) return `${accept} заклеить`;
  if (defId === VERETAR_UNSEALED_SAND) return `${accept} запечатать / высыпать`;
  if (defId === VERETAR_SEALED_SAND) return `${accept} проверить пломбу`;
  if (AUDIT_PROOF_TRADE_VALUES[defId]) return `${accept} сдать/сбыть`;
  if (itemHasTag(defId, 'document') || def.type === ItemType.KEY) return `${accept} проверить`;
  if (itemHasTag(defId, 'sample')) return `${accept} вскрыть пробу`;
  if (itemHasTag(defId, 'sealed') || itemHasTag(defId, 'veretar')) return `${accept} проверить`;
  if (itemHasTag(defId, 'govnyak') || itemHasTag(defId, 'zhelemish')) return `${accept} применить`;
  if (itemHasTag(defId, 'noise')) return `${accept} применить`;
  if (craftRecipeSourcesForItem(defId).length > 0) return `${accept} изучить`;
  return '';
}

export function getInventorySlotActionInfo(e: Entity, slotIdx: number): InventorySlotActionInfo | null {
  const slot = e.inventory?.[slotIdx];
  if (!slot) return null;
  const def = ITEMS[slot.defId];
  if (!def) return null;
  const equipSlot = itemEquipSlot(def);
  const category = inventoryItemCategory(def.id);
  const isEquippedWeapon = equipSlot === 'weapon' && e.weapon === def.id;
  const isEquippedTool = equipSlot === 'tool' && e.tool === def.id;
  let useLabel = '';
  let canUse = true;

  const accept = controlBindingLabel('gameMenu');
  if (equipSlot === 'weapon') useLabel = isEquippedWeapon ? `${accept} снять` : `${accept} экипировать`;
  else if (equipSlot === 'tool') useLabel = isEquippedTool ? `${accept} снять` : `${accept} в инструмент`;
  else if (itemHasUseAction(def)) useLabel = `${accept} применить`;
  else useLabel = inventorySpecialUseLabel(def.id, def, slot);

  if (!useLabel) {
    canUse = false;
    useLabel = `${accept} нет действия`;
  }

  const value = Math.max(0, def.value ?? 0);
  return {
    defId: def.id,
    name: def.name,
    count: slot.count,
    stackMax: getStack(def),
    category,
    categoryLabel: inventoryCategoryLabel(category),
    equippedLabel: isEquippedWeapon ? 'оружие выбрано' : isEquippedTool ? 'инструмент выбран' : inventoryCategoryLabel(category),
    useLabel,
    dropLabel: def.type === ItemType.TOOL
      ? 'X выкинуть: сломать'
      : slot.count > 1
        ? `X выкинуть ×${slot.count}`
        : 'X выкинуть',
    sellLabel: value > 0
      ? `Справка: базовая цена ${value}₽${slot.count > 1 ? `/шт · ${value * slot.count}₽` : ''}`
      : 'Справка: почти даром',
    canUse,
    canDrop: true,
    isEquippedWeapon,
    isEquippedTool,
  };
}

export function getInventoryPrepSummary(e: Entity): InventoryPrepLine[] {
  const inv = e.inventory ?? [];
  let ammo = 0;
  let medicine = 0;
  let water = 0;
  let food = 0;
  let documents = 0;
  let psiReserve = 0;

  for (const slot of inv) {
    const category = inventoryItemCategory(slot.defId);
    if (category === 'ammo' || WEAPON_STATS[slot.defId]?.ammoType === slot.defId) ammo += slot.count;
    else if (category === 'medicine') medicine += slot.count;
    else if (category === 'water') water += slot.count;
    else if (category === 'food') food += slot.count;
    else if (category === 'documents') documents += slot.count;
    if (itemHasTag(slot.defId, 'psi_restore') || category === 'psi') psiReserve += slot.count;
  }

  const weapon = getWeaponReadiness(e);
  const toolDur = getEquippedToolDurability(e);
  const toolName = e.tool ? (ITEMS[e.tool]?.name ?? e.tool) : 'нет';
  const toolDetail = toolDur ? `${Math.max(0, Math.ceil(toolDur.cur))}/${toolDur.max}` : e.tool ? 'готов' : 'пусто';
  const needs = e.needs;
  const waterNeed = needs ? Math.round(needs.water) : 0;
  const foodNeed = needs ? Math.round(needs.food) : 0;
  const psi = e.rpg ? `${Math.floor(e.rpg.psi)}/${e.rpg.maxPsi}` : '--';

  return [
    {
      id: 'weapon',
      label: 'Оруж',
      value: weapon.name,
      detail: weapon.cannotFireReason || weapon.resourceLabel,
      tone: weapon.cannotFireReason ? 'bad' : weapon.lowResource || !weapon.id ? 'warn' : 'ok',
    },
    {
      id: 'tool',
      label: 'Инстр',
      value: toolName,
      detail: toolDetail,
      tone: e.tool ? 'ok' : 'muted',
    },
    {
      id: 'ammo',
      label: 'Патр',
      value: String(ammo),
      detail: weapon.resourceKind === 'ammo' ? weapon.resourceLabel : 'всего',
      tone: weapon.resourceKind === 'ammo'
        ? weapon.cannotFireReason ? 'bad' : weapon.lowResource ? 'warn' : 'ok'
        : ammo > 0 ? 'ok' : 'muted',
    },
    {
      id: 'medicine',
      label: 'Мед',
      value: String(medicine),
      detail: e.hp !== undefined && e.maxHp !== undefined ? `HP ${Math.round(e.hp)}/${Math.round(e.maxHp)}` : 'аптечка',
      tone: medicine > 0 ? 'ok' : (e.hp ?? 100) < (e.maxHp ?? 100) ? 'bad' : 'warn',
    },
    {
      id: 'water',
      label: 'Вода',
      value: String(water),
      detail: needs ? `жажда ${waterNeed}` : 'запас',
      tone: water > 0 ? 'ok' : needs && needs.water < 35 ? 'bad' : 'warn',
    },
    {
      id: 'food',
      label: 'Еда',
      value: String(food),
      detail: needs ? `сытость ${foodNeed}` : 'запас',
      tone: food > 0 ? 'ok' : needs && needs.food < 35 ? 'bad' : 'warn',
    },
    {
      id: 'documents',
      label: 'Док',
      value: String(documents),
      detail: documents > 0 ? 'доступ' : 'нет бумаг',
      tone: documents > 0 ? 'ok' : 'muted',
    },
    {
      id: 'psi',
      label: 'ПСИ',
      value: psi,
      detail: psiReserve > 0 ? `резерв ${psiReserve}` : 'резерв 0',
      tone: e.rpg ? (e.rpg.psi < Math.max(4, e.rpg.maxPsi * 0.25) && psiReserve <= 0 ? 'warn' : 'ok') : 'muted',
    },
  ];
}

function hasRoomForOutputAfterConsuming(e: Entity, outputId: string, consumedIds: readonly string[]): boolean {
  const def = ITEMS[outputId];
  if (!def) return false;
  const inv = e.inventory ?? [];
  if (inv.some(slot => slot.defId === outputId && slot.count < getStack(def) && canStackData(slot.data, undefined))) return true;

  const consumeCounts = new Map<string, number>();
  for (const id of consumedIds) consumeCounts.set(id, (consumeCounts.get(id) ?? 0) + 1);
  let freedSlots = 0;
  for (const slot of inv) {
    const consume = consumeCounts.get(slot.defId) ?? 0;
    if (consume <= 0) continue;
    const taken = Math.min(slot.count, consume);
    consumeCounts.set(slot.defId, consume - taken);
    if (taken >= slot.count) freedSlots++;
  }
  return inv.length - freedSlots < MAX_INVENTORY_SLOTS;
}

function consumeDocumentItems(e: Entity, ids: readonly string[]): boolean {
  const needed = new Map<string, number>();
  for (const id of ids) needed.set(id, (needed.get(id) ?? 0) + 1);
  for (const [id, count] of needed) if (inventoryCount(e, id) < count) return false;
  for (const [id, count] of needed) removeItem(e, id, count);
  return true;
}

function documentZoneId(e: Entity, zoneId: number | undefined, world: World | undefined): number | undefined {
  if (zoneId !== undefined) return zoneId;
  if (!world) return undefined;
  return world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
}

function documentRoomName(e: Entity, world: World | undefined): string | undefined {
  return world?.roomAt(e.x, e.y)?.name;
}

function documentActionTags(defId: string, extra: readonly string[]): string[] {
  const out = ['player', 'inventory', 'document'];
  for (const tag of extra) if (!out.includes(tag)) out.push(tag);
  for (const tag of ITEM_TAGS[defId] ?? []) if (!out.includes(tag)) out.push(tag);
  for (const tag of ITEMS[defId]?.tags ?? []) if (!out.includes(tag)) out.push(tag);
  return out.slice(0, 8);
}

function publishDocumentActionEvent(
  state: GameState | undefined,
  actor: Entity,
  type: 'player_use_item' | 'player_sell_item' | 'player_handoff_item',
  itemId: string,
  severity: WorldEventSeverity,
  privacy: WorldEventPrivacy,
  tags: readonly string[],
  data: Record<string, unknown>,
  zoneId: number | undefined,
  world: World | undefined,
  targetName?: string,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[itemId];
  publishEvent(state, {
    type,
    zoneId: documentZoneId(actor, zoneId, world),
    roomId: world?.roomAt(actor.x, actor.y)?.id,
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    targetName,
    itemId,
    itemName: def?.name ?? itemId,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity,
    privacy,
    tags: documentActionTags(itemId, tags),
    data,
  });
}

function handleDirectDocumentActionUse(
  e: Entity,
  slotIdx: number,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  if (!DIRECT_DOCUMENT_ACTION_ITEMS.has(defId)) return false;
  const action = DOCUMENT_ACCESS_ACTIONS[defId];
  if (!action) return false;
  if (action.floors && state && !action.floors.includes(state.currentFloor)) {
    msgs.push(msg(`${ITEMS[defId]?.name ?? defId}: здесь нет нужного окна выдачи.`, time, '#aa8'));
    return true;
  }

  const consume = action.consume !== false;
  const outputCount = Math.max(1, action.outputCount ?? 1);
  if (action.outputItemId && !hasRoomForOutputAfterConsuming(e, action.outputItemId, consume ? [defId] : [])) {
    msgs.push(msg('Некуда положить выдачу. Освободите слот перед окном.', time, '#aa8'));
    return true;
  }
  if (consume) decrementInventorySlot(e.inventory ?? [], slotIdx);
  if (action.outputItemId) addItem(e, action.outputItemId, outputCount);

  if (state) {
    for (const delta of action.resourceDeltas ?? []) {
      changeResourceStock(state, delta.resourceId, delta.delta, delta.floor ?? state.currentFloor);
    }
    for (const delta of action.relationDeltas ?? []) {
      addFactionRelMutual(Faction.PLAYER, delta.faction, delta.delta);
    }
  }

  msgs.push(msg(action.message, time, '#6a6'));
  publishDocumentActionEvent(
    state,
    e,
    action.eventType,
    defId,
    action.severity,
    action.privacy,
    action.tags,
    {
      ...action.data,
      outputItemId: action.outputItemId,
      outputItemName: action.outputItemId ? ITEMS[action.outputItemId]?.name ?? action.outputItemId : undefined,
      outputCount: action.outputItemId ? outputCount : undefined,
      resourceDeltas: action.resourceDeltas?.map(delta => ({
        resourceId: delta.resourceId,
        delta: delta.delta,
        floor: delta.floor ?? state?.currentFloor,
      })),
    },
    zoneId,
    world,
    action.targetName,
  );
  return true;
}

function documentGateOutput(defId: string): string {
  const documentAccessOutput = DOCUMENT_MINISTRY_GATE_OUTPUT_BY_ITEM[defId];
  if (documentAccessOutput) return documentAccessOutput;
  return defId === 'ministry_audit_forgery'
    || defId === 'stolen_archive_card'
    || defId === 'raionsovet_floor_pass'
    || defId === 'forged_raionsovet_pass'
    || defId === 'confiscation_warrant'
    || defId === 'cleanup_order_stub'
    ? 'archive_access_permit'
    : 'key';
}

function useDocumentAtMinistryGate(
  e: Entity,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const outputId = documentGateOutput(defId);
  if (!hasRoomForOutputAfterConsuming(e, outputId, [defId])) {
    msgs.push(msg('Некуда положить выданный доступ. Освободите слот перед окном.', time, '#aa8'));
    return true;
  }
  if (!consumeDocumentItems(e, [defId])) return true;
  addItem(e, outputId, 1);

  const accessDef = DOCUMENT_MINISTRY_GATE_ACCESS_BY_ITEM.get(defId);
  const permit = getPermitDef(defId);
  const stolen = permit?.method === 'stolen' || itemHasTag(defId, 'stolen');
  const forged = permit?.method === 'forged' || itemHasTag(defId, 'forged') || itemHasTag(defId, 'forgery');
  const official = accessDef?.legal ?? permit?.official ?? (itemHasTag(defId, 'official') && !stolen && !forged);
  const method = accessDef?.method ?? permit?.method ?? (official ? 'legal' : stolen ? 'stolen' : 'forged');
  const roomName = documentRoomName(e, world) ?? (outputId === 'key' ? 'Проверочный коридор N3' : 'архивное окно');
  if (official) {
    changeResourceStock(state, 'documents', 1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 1);
    msgs.push(msg(accessDef?.line ?? 'Официальная бумага принята. Доступ выдан.', time, '#8f8'));
  } else if (stolen) {
    changeResourceStock(state, 'documents', 1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 2);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, -1);
    msgs.push(msg('Краденая архивная карточка сдана как улика. Выдан архивный допуск.', time, '#8cf'));
  } else {
    changeResourceStock(state, 'documents', -1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
    msgs.push(msg(`${ITEMS[defId]?.name ?? defId} принят. Доступ выдан. Риск проверки.`, time, '#fa6'));
  }

  publishDocumentActionEvent(
    state,
    e,
    stolen ? 'player_handoff_item' : 'player_use_item',
    defId,
    accessDef?.severity ?? permit?.severity ?? (forged ? 4 : 3),
    accessDef?.privacy ?? permit?.privacy ?? (forged ? 'local' : 'private'),
    [
      outputId === 'key' ? 'document_gate' : 'archive_access',
      method,
      official ? 'official' : stolen ? 'stolen' : 'forgery',
      ...(itemHasTag(defId, 'hazard') ? ['hazard'] : []),
      ...(forged ? ['audit_risk'] : []),
      'access_granted',
    ],
    {
      outcome: outputId === 'key' ? 'gate_key_granted' : 'archive_access_granted',
      outputItemId: outputId,
      outputItemName: ITEMS[outputId]?.name ?? outputId,
      roomName,
      ministryDocumentDelta: official || stolen ? 1 : -1,
      line: accessDef?.line ?? permit?.successLine,
      rumorIds: forged ? ['player_forged_stamp_risk', 'rare_forged_permit_slip'] : ['lead_ministry_permit_office_slip'],
    },
    zoneId,
    world,
    roomName,
  );
  if (permit) {
    const tag = outputId === 'archive_access_permit' ? 'archive' : 'ministry_n3';
    recordPermitAccess(state, e, world, permit, roomName, tag, zoneId);
    if (stolen) recordPermitExposure(state, e, world, permit, roomName, 'stolen_card_reported', zoneId);
  }
  return true;
}

function forgePermitFromStampSheet(
  e: Entity,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const inputs = ['forged_stamp_sheet', 'blank_form', 'ink_bottle'] as const;
  for (const id of inputs) {
    if (!hasItem(e, id)) {
      msgs.push(msg('Для поддельного корешка нужны лист с поддельной печатью, пустой бланк и чернила.', time, '#aa8'));
      return true;
    }
  }
  if (!hasRoomForOutputAfterConsuming(e, 'forged_permit_slip', inputs)) {
    msgs.push(msg('Некуда положить поддельный корешок. Освободите слот перед печатью.', time, '#aa8'));
    return true;
  }
  if (!consumeDocumentItems(e, inputs)) return true;
  addItem(e, 'forged_permit_slip', 1);
  if (state) {
    changeResourceStock(state, 'documents', -1, FloorLevel.MINISTRY);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -1);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
  }
  msgs.push(msg('Поддельный корешок готов: бланк, чернила, поддельная печать. Несите к N3.', time, '#fa6'));
  const recipe = getPermitForgeryRecipe('forged_permit_slip');
  if (recipe) recordPermitForged(state, e, world, recipe, zoneId);
  publishDocumentActionEvent(
    state,
    e,
    'player_use_item',
    'forged_permit_slip',
    4,
    'local',
    ['forgery', 'permit_forged', 'audit_risk'],
    {
      outcome: 'forged_permit_created',
      sourceItemIds: [...inputs],
      ministryDocumentDelta: -1,
      rumorIds: ['player_forged_stamp_risk', 'rare_forged_permit_slip'],
    },
    zoneId,
    world,
    documentRoomName(e, world),
  );
  return true;
}

function sellDocumentToBlackMarket(
  e: Entity,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const price = DOCUMENT_MARKET_VALUES[defId];
  if (!price) return false;
  removeItem(e, defId, 1);
  e.money = (e.money ?? 0) + price;
  changeResourceStock(state, 'documents', -1, FloorLevel.MINISTRY);
  changeResourceStock(state, 'contraband', 1, state.currentFloor);
  addFactionRelMutual(Faction.PLAYER, Faction.WILD, 2);
  addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -1);
  msgs.push(msg(`${ITEMS[defId]?.name ?? defId} продан на рынке за ${price}₽. Доступ потерян.`, time, '#ee4'));
  publishDocumentActionEvent(
    state,
    e,
    'player_sell_item',
    defId,
    4,
    'local',
    ['black_market', 'trade', 'contraband', 'audit_risk'],
    {
      outcome: 'black_market_document_sale',
      rewardMoney: price,
      ministryDocumentDelta: -1,
      contrabandDelta: 1,
      rumorIds: ['rare_forged_permit_slip', 'contract_failed'],
    },
    zoneId,
    world,
    'чёрный рынок документов',
  );
  return true;
}

function handleContaminatedSwabUse(
  e: Entity,
  slotIdx: number,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const slot = e.inventory?.[slotIdx];
  if (!slot || slot.defId !== CONTAMINATED_SWAB_ITEM) return false;

  if (!state || !isPlayerEntity(e)) {
    msgs.push(msg(ITEMS[CONTAMINATED_SWAB_ITEM]?.desc ?? 'Грязной пробе нужен адресат.', time, '#aa8'));
    return true;
  }

  const report = state.currentFloor === FloorLevel.MINISTRY;
  const market = state.currentFloor === FloorLevel.LIVING || state.currentFloor === FloorLevel.KVARTIRY;
  if (!report && !market) {
    msgs.push(msg('Мазок ждёт адресата: отчёт в Министерстве или скупщик в жилом блоке.', time, '#aa8'));
    return true;
  }

  const reward = report ? CONTAMINATED_SWAB_REPORT_REWARD : CONTAMINATED_SWAB_MARKET_REWARD;
  decrementInventorySlot(e.inventory ?? [], slotIdx);
  e.money = (e.money ?? 0) + reward;
  if (report) {
    changeResourceStock(state, 'slime_samples', 1, FloorLevel.MINISTRY, { reason: 'contaminated_swab_report', tags: ['sample', 'evidence', 'nii'] });
    addFactionRelMutual(Faction.PLAYER, Faction.SCIENTIST, 1);
  } else {
    changeResourceStock(state, 'slime_samples', -1, state.currentFloor, { reason: 'contaminated_swab_black_market', tags: ['sample', 'black_market'] });
    changeResourceStock(state, 'contraband', 1, state.currentFloor, { reason: 'contaminated_swab_black_market', tags: ['sample', 'black_market'] });
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
    addFactionRelMutual(Faction.PLAYER, Faction.SCIENTIST, -1);
  }

  const def = ITEMS[CONTAMINATED_SWAB_ITEM];
  msgs.push(msg(
    report
      ? `Загрязнённый мазок сдан как провал отбора. +${reward}₽.`
      : `Загрязнённый мазок ушёл в рыночный слух. +${reward}₽.`,
    time,
    report ? '#8cf' : '#ee4',
  ));
  publishEvent(state, {
    type: report ? 'player_handoff_item' : 'player_sell_item',
    zoneId: documentZoneId(e, zoneId, world),
    roomId: world?.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: e.name ?? 'Вы',
    actorFaction: e.faction,
    targetName: report ? 'окно брака проб' : 'скупщик проб',
    itemId: CONTAMINATED_SWAB_ITEM,
    itemName: def?.name ?? CONTAMINATED_SWAB_ITEM,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity: report ? 2 : 3,
    privacy: report ? 'private' : 'local',
    tags: report
      ? ['player', 'inventory', 'sample', 'swab', 'failed_sample', 'evidence', 'report', 'nii']
      : ['player', 'inventory', 'sample', 'swab', 'failed_sample', 'evidence', 'black_market', 'trade'],
    data: {
      outcome: report ? 'contaminated_swab_reported' : 'contaminated_swab_sold',
      rewardMoney: reward,
      sampleStockDelta: report ? 1 : -1,
      contrabandDelta: report ? 0 : 1,
    },
  });
  return true;
}

function handleAuditProofUse(
  e: Entity,
  slotIdx: number,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  const values = AUDIT_PROOF_TRADE_VALUES[defId];
  if (!values) return false;
  const slot = e.inventory?.[slotIdx];
  if (!slot || slot.defId !== defId) return false;

  if (!state || !isPlayerEntity(e)) {
    msgs.push(msg(ITEMS[defId]?.desc ?? 'Улике нужен адресат.', time, '#aa8'));
    return true;
  }

  const report = state.currentFloor === FloorLevel.MINISTRY;
  const market = state.currentFloor === FloorLevel.LIVING || state.currentFloor === FloorLevel.KVARTIRY;
  if (!report && !market) {
    msgs.push(msg('Номерную планку примут в Министерстве как улику или в жилом блоке как рыночный риск.', time, '#aa8'));
    return true;
  }

  decrementInventorySlot(e.inventory ?? [], slotIdx);
  const reward = report ? values.report : values.market;
  e.money = (e.money ?? 0) + reward;
  const def = ITEMS[defId];

  if (report) {
    changeResourceStock(state, 'contraband', -1, state.currentFloor, { zoneId, roomId: world?.roomAt(e.x, e.y)?.id, reason: 'weapon_serial_plate_reported', tags: ['weapon', 'audit', 'evidence'] });
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 1);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, -1);
  } else {
    changeResourceStock(state, 'contraband', 1, state.currentFloor, { zoneId, roomId: world?.roomAt(e.x, e.y)?.id, reason: 'weapon_serial_plate_sold', tags: ['weapon', 'black_market', 'audit_risk'] });
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -1);
  }

  msgs.push(msg(
    report
      ? `${def?.name ?? defId} сдана как оружейная улика. +${reward}₽.`
      : `${def?.name ?? defId} продана на рынке за ${reward}₽. Риск аудита ушёл к покупателю.`,
    time,
    report ? '#8cf' : '#ee4',
  ));
  publishEvent(state, {
    type: report ? 'player_handoff_item' : 'player_sell_item',
    zoneId,
    roomId: world?.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: e.name ?? 'Вы',
    actorFaction: e.faction,
    targetName: report ? 'оружейная ревизия' : 'скупщик оружейных номеров',
    itemId: defId,
    itemName: def?.name ?? defId,
    itemCount: 1,
    itemValue: reward,
    severity: report ? 3 : 4,
    privacy: report ? 'private' : 'local',
    tags: report
      ? ['player', 'inventory', 'weapon', 'serial', 'audit', 'evidence', 'report', 'liquidator']
      : ['player', 'inventory', 'weapon', 'serial', 'evidence', 'black_market', 'audit_risk', 'contraband'],
    data: {
      outcome: report ? 'weapon_serial_plate_reported' : 'weapon_serial_plate_sold',
      rewardMoney: reward,
      contrabandDelta: report ? -1 : 1,
    },
  });
  return true;
}

function handleDocumentPaperUse(
  e: Entity,
  slotIdx: number,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
  world: World | undefined,
): boolean {
  if (defId === 'forged_stamp_sheet') return forgePermitFromStampSheet(e, msgs, time, state, zoneId, world);
  if (handleDirectDocumentActionUse(e, slotIdx, defId, msgs, time, state, zoneId, world)) return true;
  if (!DOCUMENT_GATE_ITEMS.has(defId) && DOCUMENT_MARKET_VALUES[defId] === undefined) return false;
  if (!state || !isPlayerEntity(e)) {
    msgs.push(msg(ITEMS[defId]?.desc ?? 'Бумаге нужен адресат.', time, '#aa8'));
    return true;
  }

  if (state.currentFloor === FloorLevel.MINISTRY && DOCUMENT_GATE_ITEMS.has(defId)) {
    return useDocumentAtMinistryGate(e, defId, msgs, time, state, zoneId, world);
  }
  if ((state.currentFloor === FloorLevel.LIVING || state.currentFloor === FloorLevel.KVARTIRY) && DOCUMENT_MARKET_VALUES[defId] !== undefined) {
    return sellDocumentToBlackMarket(e, defId, msgs, time, state, zoneId, world);
  }

  msgs.push(msg('Здесь адресата нет. Документы принимают в Министерстве: N3 или архивное окно; часть бумаг продаётся на рынке жилого блока.', time, '#aa8'));
  return true;
}

function handleShelterTallyUse(e: Entity, defId: string, msgs: Msg[], time: number, state?: GameState): boolean {
  if (!isShelterTallyItem(defId)) return false;
  if (!state || !isPlayerEntity(e)) {
    msgs.push(msg(ITEMS[defId]?.desc ?? 'Бумаге нужен адресат.', time, '#aa8'));
    return true;
  }

  const forged = defId === FORGED_SHELTER_TALLY_ID;
  if (!forged && hasItem(e, 'forged_stamp_sheet')) {
    removeItem(e, SHELTER_TALLY_ID, 1);
    removeItem(e, 'forged_stamp_sheet', 1);
    addItem(e, FORGED_SHELTER_TALLY_ID, 1);
    msgs.push(msg('Ведомость переписана под печать. Риск ревизии.', time, '#fa8'));
    publishShelterTallyEvent(state, e, SHELTER_TALLY_ID, 'forge');
    return true;
  }

  if (state.currentFloor === FloorLevel.MINISTRY) {
    removeItem(e, defId, 1);
    if (!forged) {
      e.money = (e.money ?? 0) + 45;
      msgs.push(msg('Ведомость укрытых сдана в Министерство. +45₽.', time, '#ee4'));
      publishShelterTallyEvent(state, e, defId, 'submit_ministry', { itemValue: 45 });
    } else {
      msgs.push(msg('Липовая ведомость сдана в Министерство. Риск проверки.', time, '#f84'));
      publishShelterTallyEvent(state, e, defId, 'submit_forged_ministry');
    }
    return true;
  }

  if (state.currentFloor === FloorLevel.LIVING || state.currentFloor === FloorLevel.KVARTIRY) {
    removeItem(e, defId, 1);
    if (forged) {
      msgs.push(msg('Жильцы нашли лишние строки в липовом списке.', time, '#f84'));
      publishShelterTallyEvent(state, e, defId, 'give_forged_residents');
    } else {
      msgs.push(msg('Старшие подъезда получили список укрытых.', time, '#8f8'));
      publishShelterTallyEvent(state, e, defId, 'give_residents');
    }
    return true;
  }

  msgs.push(msg('Ведомость принимают в Министерстве или у старших подъезда в жилом блоке/Квартирах.', time, '#aa8'));
  return true;
}

function pushCraftRecipeSourceMessages(result: CraftRecipeLearnResult, msgs: Msg[], time: number): void {
  for (const recipeId of result.learned) {
    msgs.push(msg(craftRecipeLearnedMessage(recipeId), time, '#8cf'));
  }
  if (result.learned.length === 0 && result.duplicate.length > 0) {
    msgs.push(msg('Рецепт уже известен', time, '#888'));
  } else if (result.learned.length === 0 && result.duplicate.length === 0 && result.unknown.length > 0) {
    msgs.push(msg('Схема неполная: нужен станок или другой лист', time, '#aa8'));
  }
}

function learnCraftRecipeSource(
  source: CraftRecipeSourceDef,
  state: GameState | undefined,
  msgs: Msg[],
  time: number,
): CraftRecipeLearnResult | null {
  if (!state) {
    msgs.push(msg('Схема неполная: нужен станок или другой лист', time, '#aa8'));
    return null;
  }
  const result = learnCraftRecipesFromSource(state, source);
  pushCraftRecipeSourceMessages(result, msgs, time);
  return result;
}

function handleCraftRecipeItemSourceUse(
  e: Entity,
  slotIdx: number,
  defId: string,
  msgs: Msg[],
  time: number,
  state: GameState | undefined,
  zoneId: number | undefined,
): boolean {
  const sources = craftRecipeSourcesForItem(defId);
  if (sources.length === 0) return false;
  if (
    state &&
    isPlayerEntity(e) &&
    (state.currentFloor === FloorLevel.LIVING || state.currentFloor === FloorLevel.KVARTIRY) &&
    DOCUMENT_MARKET_VALUES[defId] !== undefined
  ) {
    return false;
  }

  let learned = 0;
  let duplicate = 0;
  let unknown = 0;
  let shouldConsume = false;
  let passThrough = false;

  for (const source of sources) {
    if (craftRecipeSourcePassesThroughItemUse(source)) passThrough = true;
    const result = learnCraftRecipeSource(source, state, msgs, time);
    if (!result) continue;
    learned += result.learned.length;
    duplicate += result.duplicate.length;
    unknown += result.unknown.length;
    if (result.learned.length > 0 && craftRecipeSourceConsumesItem(source)) shouldConsume = true;
  }

  if (learned > 0 && state) {
    publishPlayerItemEvent(state, e, 'player_use_item', defId, 1, unknown > 0 ? 2 : 3, zoneId);
  }
  if (shouldConsume) decrementInventorySlot(e.inventory ?? [], slotIdx);
  return shouldConsume || !passThrough || (learned === 0 && duplicate === 0 && unknown === 0);
}

function noteText(data: unknown): string {
  return craftRecipeNoteText(data) ?? String(data);
}

function handleCraftRecipeNoteSourceUse(data: unknown, msgs: Msg[], time: number, state: GameState | undefined): void {
  const sourceId = craftRecipeSourceIdFromNoteData(data);
  if (!sourceId) return;
  const source = getCraftRecipeSource(sourceId);
  if (!source || source.kind !== 'note') {
    msgs.push(msg('Схема неполная: нужен станок или другой лист', time, '#aa8'));
    return;
  }
  learnCraftRecipeSource(source, state, msgs, time);
}

/* ── Use selected item ────────────────────────────────────────── */
export function useItem(e: Entity, slotIdx: number, msgs: Msg[], time: number, state?: GameState, zoneId?: number, world?: World): void {
  if (!e.inventory || slotIdx >= e.inventory.length) return;
  const slot = e.inventory[slotIdx];
  const def = ITEMS[slot.defId];
  if (!def) return;
  const equipSlot = itemEquipSlot(def);
  const noisyDocument = consumeNoisyDocumentDelay(slot, time);
  if (noisyDocument) {
    msgs.push(msg(`Конторская метка шумит в бумаге: ${noisyDocument.itemName}. Попробуйте еще раз через секунду.`, time, '#d9b36a'));
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
    return;
  }

  for (const handler of getInventoryUseHandlers()) {
    if (handler({ actor: e, slotIdx, slot, def, msgs, time, state, zoneId, world })) return;
  }

  if (def.id === GOVNYAK_COURIER_PACKAGE_ITEM) {
    if (openGovnyakCourierPackage(e, msgs, time, state)) return;
  }
  if (handleIncendiary12gUse(e, slotIdx, msgs, time, state, zoneId, world)) return;
  if (handleDeconFluidUse(e, slotIdx, msgs, time, state, zoneId, world)) return;
  if (handleGasmaskFilterUse(e, slotIdx, msgs, time, state, zoneId)) return;
  if (handleCraftRecipeItemSourceUse(e, slotIdx, def.id, msgs, time, state, zoneId)) return;

  if (handleContaminatedSwabUse(e, slotIdx, msgs, time, state, zoneId, world)) return;
  if (handleAuditProofUse(e, slotIdx, def.id, msgs, time, state, zoneId, world)) return;
  if (handleDocumentPaperUse(e, slotIdx, def.id, msgs, time, state, zoneId, world)) return;
  if (handleShelterTallyUse(e, def.id, msgs, time, state)) return;
  if (handleVeretarSandUse(e, slotIdx, msgs, time, state)) return;

  if (def.id === 'maronary_shaving') {
    const useText = destroyMaronaryShaving(e, state);
    msgs.push(msg(useText, time, '#fc4'));
    decrementInventorySlot(e.inventory, slotIdx);
    return;
  }

  // Weapons: equip
  if (equipSlot === 'weapon') {
    if (e.weapon === def.id) {
      e.weapon = '';
      msgs.push(msg(`Оружие снято: ${def.name}`, time, '#ccc'));
      publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
      return;
    }
    e.weapon = def.id;
    msgs.push(msg(`Экипировано: ${def.name}`, time, '#ccc'));
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
    return;
  }

  // Tools: equip to utility slot
  if (equipSlot === 'tool') {
    if (e.tool === def.id) {
      e.tool = '';
      msgs.push(msg(`Инструмент снят: ${def.name}`, time, '#8cf'));
      publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
      return;
    }
    e.tool = def.id;
    msgs.push(msg(`Инструмент: ${def.name}`, time, '#8cf'));
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
    return;
  }

  if (handleRationCouponUse(e, slotIdx, msgs, time, state, zoneId, world)) return;

  const govnyakUse = useGovnyakItem(e, def.id, state);
  if (govnyakUse) {
    msgs.push(msg(govnyakUse.text, time, govnyakUse.badBatch ? '#fa0' : '#9a6'));
    placeMonsterBait(state, world, e, e.x, e.y, def.id, 1, 'use');
    consumeInventorySlot(e, slotIdx);
    return;
  }

  if (handleSilverSlimeUse(e, slotIdx, msgs, time, state, zoneId)) return;

  const zhelemishSource = zhelemishSourceForItem(def.id);
  if (zhelemishSource) {
    const beforeHp = e.hp;
    const useText = def.use?.(e);
    if (useText) msgs.push(msg(useText + zhelemishHealingFrictionText(e, beforeHp, time), time, '#6a6'));
    applyZhelemishSkinWithMessage(e, time, msgs, zhelemishSource, state);
    consumeInventorySlot(e, slotIdx);
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 3, zoneId);
    return;
  }

  // Usable items
  if (def.use) {
    if ((def.id === ANTIFUNGAL_OINTMENT_ITEM || def.id === ANTI_SPORE_INHALER_ITEM) && activeSporeHaze(e, time)) {
      const useText = def.use(e);
      msgs.push(msg(useText, time, '#6a6'));
      cureSporeHaze(e, time, msgs, state, def.id);
      consumeInventorySlot(e, slotIdx);
      publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 3, zoneId);
      return;
    }
    if (isZhelemishCureItem(def.id) && activeZhelemishSkin(e, time)) {
      const useText = def.use(e);
      msgs.push(msg(useText, time, '#6a6'));
      cureZhelemishSkin(e, time, msgs, state, def.id);
      consumeInventorySlot(e, slotIdx);
      publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 3, zoneId);
      return;
    }
    const beforeHp = e.hp;
    const transformOutput = itemUseTransformOutput(def.id);
    if (transformOutput) {
      if (!canApplyUseTransformOutput(e, slotIdx, transformOutput)) {
        const outputName = ITEMS[transformOutput.outputId]?.name ?? transformOutput.outputId;
        msgs.push(msg(`Нет места: освободите слот или стопку под ${outputName}.`, time, '#fa0'));
        return;
      }
      consumeInventorySlot(e, slotIdx);
      const useText = def.use(e);
      msgs.push(msg(useText + zhelemishHealingFrictionText(e, beforeHp, time), time, '#6a6'));
      placeMonsterBait(state, world, e, e.x, e.y, def.id, 1, 'use');
      publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
      return;
    }
    const useText = def.use(e);
    msgs.push(msg(useText + zhelemishHealingFrictionText(e, beforeHp, time), time, '#6a6'));
    placeMonsterBait(state, world, e, e.x, e.y, def.id, 1, 'use');
    consumeInventorySlot(e, slotIdx);
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
    return;
  }

  // Notes
  if (def.type === ItemType.NOTE && slot.data) {
    msgs.push(msg(noteText(slot.data), time, '#aa8'));
    handleCraftRecipeNoteSourceUse(slot.data, msgs, time, state);
    publishPlayerItemEvent(state, e, 'player_use_item', def.id, 1, 2, zoneId);
    return;
  }

  msgs.push(msg(`${def.name}: сейчас нет прямого применения. Можно продать или выбросить.`, time, '#888'));
}

/* ── Drop item from inventory onto the ground ─────────────────── */
export function dropItem(
  player: Entity, slotIdx: number, entities: Entity[],
  msgs: Msg[], time: number, nextId: { v: number }, state?: GameState, world?: World,
): void {
  if (!player.inventory || slotIdx >= player.inventory.length) return;
  const slot = player.inventory[slotIdx];
  const def = ITEMS[slot.defId];
  if (!def) return;

  const dropCount = slot.count;
  const equipSlot = itemEquipSlot(def);

  // If dropping equipped weapon, unequip
  if (equipSlot === 'weapon' && player.weapon === def.id) {
    player.weapon = '';
  }
  if (equipSlot === 'tool' && player.tool === def.id) {
    player.tool = '';
  }

  // Place drop 3 cells in front of player (far enough to avoid auto-pickup)
  const dx = Math.cos(player.angle);
  const dy = Math.sin(player.angle);
  const dropX = player.x + dx * 3.0;
  const dropY = player.y + dy * 3.0;

  const dropId = nextId.v++;
  entities.push({
    id: dropId, type: EntityType.ITEM_DROP,
    x: dropX, y: dropY, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId: slot.defId, count: dropCount, data: slot.data }],
  });

  player.inventory.splice(slotIdx, 1);

  msgs.push(msg(`Выброшено: ${def.name}${dropCount > 1 ? ' ×' + dropCount : ''}`, time, '#aa6'));
  publishPlayerItemEvent(state, player, 'player_drop_item', def.id, dropCount, 2);
  if (placeMonsterBait(state, world, player, dropX, dropY, def.id, dropCount, 'drop', dropId)) {
    msgs.push(msg('Приманка оставлена: монстры могут учуять.', time, '#ca6'));
  }
}

function pickupDropItems(
  world: World,
  drop: Entity,
  player: Entity,
  msgs: Msg[],
  time: number,
  state?: GameState,
  onPickedDrop?: (drop: Entity, pickedItems: readonly Item[]) => void,
  manual = false,
): PickupDropResult {
  const inv = drop.inventory;
  if (!drop.alive || drop.type !== EntityType.ITEM_DROP || !inv || inv.length === 0) {
    return { handled: false, pickedAny: false, depleted: false, blockedReason: 'empty' };
  }

  let pickedAny = false;
  const pickedItems: Item[] = [];
  let handled = false;
  let blockedByCapacity = false;
  let blockedName = '';
  for (let itemIndex = 0; itemIndex < inv.length;) {
    const item = inv[itemIndex];
    const def = ITEMS[item.defId];
    const acid = greenAcidPickupData(item.data);
    const zoneId = world.zoneMap[world.idx(Math.floor(drop.x), Math.floor(drop.y))];
    const acidHandlingTool = acid?.organicRisk ? equippedToolWithTag(player, SAMPLE_HANDLING_TOOL_TAG) : undefined;
    if (acid?.organicRisk && !acidHandlingTool && !hasItem(player, GREEN_ACID_COUNTERMEASURE)) {
      handled = true;
      if (!acid.warned) {
        setGreenAcidWarned(item);
        msgs.push(msg(
          `Зелёная кислота шипит на ${def?.name ?? item.defId}. Нужен фильтрующий слой или инструмент для проб; повторная попытка испортит добычу.`,
          time, '#9f4',
        ));
        publishGreenAcidItemEvent(state, player, 'exposure', item.defId, item.count, zoneId, drop.x, drop.y);
        itemIndex++;
        continue;
      }
      const lostCount = item.count;
      msgs.push(msg(`${def?.name ?? item.defId} вспенился в кислоте. Добыча потеряна.`, time, '#bf4'));
      inv.splice(itemIndex, 1);
      pickedAny = true;
      publishGreenAcidItemEvent(state, player, 'exposure', item.defId, lostCount, zoneId, drop.x, drop.y);
      continue;
    }

    const moved = addItemMovedCount(player, item.defId, item.count, acid ? undefined : item.data);
    if (moved > 0) {
      handled = true;
      if (acid?.organicRisk) {
        if (acidHandlingTool) {
          const toolName = ITEMS[acidHandlingTool]?.name ?? acidHandlingTool;
          consumeToolDurability(player, SAMPLE_HANDLING_TOOL_WEAR, msgs, time, state);
          msgs.push(msg(`${toolName} удержали кислоту: ${def?.name ?? item.defId} сохранён.`, time, '#9f4'));
          publishGreenAcidItemEvent(state, player, 'neutralization', item.defId, moved, zoneId, drop.x, drop.y, acidHandlingTool);
        } else {
          removeItem(player, GREEN_ACID_COUNTERMEASURE, 1);
          msgs.push(msg(`Фильтрующий слой нейтрализовал кислоту: ${def?.name ?? item.defId} сохранён.`, time, '#9f4'));
          publishGreenAcidItemEvent(state, player, 'neutralization', item.defId, moved, zoneId, drop.x, drop.y);
        }
      }
      if (acid?.sample) {
        msgs.push(msg('Взята проба зелёной кислотной слизи.', time, '#9f4'));
        publishGreenAcidItemEvent(state, player, 'sample', item.defId, moved, zoneId, drop.x, drop.y);
      }
      msgs.push(msg(`Подобрано: ${def?.name ?? item.defId}`, time, '#dd4'));
      publishPlayerItemEvent(state, player, 'player_pick_item', item.defId, moved, 2, zoneId);

      if (state && state.tutorialMode && item.defId === 'tut_cafe_key' && state.tutorialStep === TutorialStep.TOILET) {
        logTutorialMsg(state, '-должно быть это ключ от двери', time + 15);
      }

      pickedItems.push({ defId: item.defId, count: moved, data: acid ? undefined : item.data });
      handleVeretarPickupRisk(player, item.defId, msgs, time, state, zoneId);
      item.count -= moved;
      if (item.count <= 0) inv.splice(itemIndex, 1);
      else itemIndex++;
      pickedAny = true;
      continue;
    }
    blockedByCapacity = true;
    if (!blockedName) blockedName = def?.name ?? item.defId;
    itemIndex++;
  }

  if (pickedAny) {
    if (inv.length === 0) {
      removeMonsterBaitForEntity(drop.id, state, time, 'picked_up');
      onPickedDrop?.(drop, pickedItems);
      drop.alive = false;
    }
    if (player.faction === Faction.PLAYER) playPickup();
  } else if (manual && blockedByCapacity) {
    handled = true;
    msgs.push(msg(`Нет места: ${blockedName}`, time, '#f84'));
  }

  return {
    handled,
    pickedAny,
    depleted: !drop.alive || inv.length === 0,
    pickedItems,
    blockedReason: blockedByCapacity && !pickedAny ? 'inventory_full' : undefined,
  };
}

export function pickupDrop(
  world: World,
  drop: Entity,
  player: Entity,
  msgs: Msg[],
  time: number,
  state?: GameState,
  onPickedDrop?: (drop: Entity, pickedItems: readonly Item[]) => void,
): PickupDropResult {
  return pickupDropItems(world, drop, player, msgs, time, state, onPickedDrop, true);
}

/* ── Pickup nearby item drops ─────────────────────────────────── */
export function pickupNearby(
  world: World,
  entities: Entity[],
  player: Entity,
  msgs: Msg[],
  time: number,
  state?: GameState,
  onPickedDrop?: (drop: Entity, pickedItems: readonly Item[]) => void,
): void {
  for (let i = entities.length - 1; i >= 0; i--) {
    const drop = entities[i];
    if (drop.type !== EntityType.ITEM_DROP || !drop.alive) continue;
    if (world.dist(player.x, player.y, drop.x, drop.y) > 1.5) continue;
    pickupDropItems(world, drop, player, msgs, time, state, onPickedDrop, false);
  }
}

function equippedPsiToolId(e: Entity): string {
  const toolId = e.tool ?? '';
  return WEAPON_STATS[toolId]?.psiCost ? toolId : '';
}

export function equippedCombatItemId(e: Entity): string {
  return (e.weapon && WEAPON_STATS[e.weapon] ? e.weapon : '') || equippedPsiToolId(e);
}

/* ── Get full weapon stats ────────────────────────────────────── */
export function getWeaponStats(e: Entity, itemId = equippedCombatItemId(e)): WeaponStats {
  const ws = WEAPON_STATS[itemId] ?? WEAPON_STATS[''];
  const govnyakSpread = govnyakAimSpreadMult(e);
  const sporeSpread = sporeHazeAimSpreadMult(e);
  if (!e.rpg && govnyakSpread === 1 && sporeSpread === 1) return ws;
  let speed = ws.speed;
  let spread = ws.spread;
  let psiCost = ws.psiCost;
  let changed = false;

  if (e.rpg && !ws.psiCost) {
    const nextSpeed = ws.speed * strHeavyWeaponSpeedMult(e.rpg, ws.speed);
    if (nextSpeed !== ws.speed) { speed = nextSpeed; changed = true; }
  }
  if (ws.isRanged && ws.spread !== undefined && ws.spread > 0) {
    const nextSpread = ws.spread * (e.rpg ? agiRangedSpreadMult(e.rpg) : 1) * govnyakSpread * sporeSpread;
    if (nextSpread !== ws.spread) { spread = nextSpread; changed = true; }
  }
  if (e.rpg && ws.psiCost !== undefined && ws.psiCost > 0) {
    psiCost = adjustedPsiCost(ws.psiCost, e.rpg);
    changed = true;
  }

  return changed ? { ...ws, speed, spread, psiCost } : ws;
}

/* ── Get current durability of equipped melee weapon ──────────── */
export function getEquippedDurability(e: Entity, itemId = e.weapon ?? ''): { cur: number; max: number } | null {
  const ws = WEAPON_STATS[itemId];
  if (!ws || ws.isRanged || ws.durability <= 0) return null;
  const slot = (e.inventory ?? []).find(s => s.defId === itemId);
  if (!slot) return null;
  const d = slot.data as { dur?: number } | undefined;
  return { cur: d?.dur ?? ws.durability, max: ws.durability };
}

/* ── Contextual weapon break exclamations ─────────────────────── */
const BREAK_EXCLAIM = [
  'Бля!', 'Блин!', 'Пацаны!', 'Плохо дело!', 'Вот чёрт!',
  'Да ну нах!', 'Твою мать!', 'Ну всё!', 'Капец!', 'Ёпта!',
  'Мда уж...', 'Ай!', 'Ну отлично!', 'Вот блин!', 'Ну ёлки!',
];
const BREAK_EXCLAIM_F = [
  'Блин!', 'Ой!', 'Ну нет!', 'Ужас!', 'Вот чёрт!',
  'Плохо дело!', 'Капец!', 'Ну отлично!', 'Батюшки!', 'Кошмар!',
];

/* ── Consume durability on melee hit. Returns true if weapon broke */
export function consumeDurability(e: Entity, msgs: Msg[], time: number, state?: GameState, itemId = e.weapon ?? ''): boolean {
  const ws = WEAPON_STATS[itemId];
  if (!ws || ws.isRanged || ws.durability <= 0) return false;
  const inv = e.inventory ?? [];
  const idx = inv.findIndex(s => s.defId === itemId);
  if (idx < 0) return false;
  const slot = inv[idx];
  const d = (slot.data ?? { dur: ws.durability }) as { dur: number };
  const wear = e.rpg && ws.durability > 1 ? strDurabilityWearMult(e.rpg) : 1;
  d.dur -= wear;
  slot.data = d;
  if (d.dur <= 0) {
    const name = ITEMS[slot.defId]?.name ?? slot.defId;
    inv.splice(idx, 1);
    if (e.weapon === itemId) e.weapon = '';
    if (e.tool === itemId) e.tool = '';
    if (e.type === EntityType.NPC && e.name) {
      const pool = e.isFemale ? BREAK_EXCLAIM_F : BREAK_EXCLAIM;
      const excl = pool[Math.floor(Math.random() * pool.length)];
      pushNpcLogMessage(e, msgs, time, `${e.name}: ${excl} ${name} ${e.isFemale ? 'сломалась' : 'сломался'}!`, '#f84');
    } else {
      msgs.push(msg(`${name} сломался!`, time, '#f84'));
    }
    publishPlayerItemEvent(state, e, 'tool_broke', slot.defId, 1, 3);
    return true;
  }
  return false;
}

/* ── Get current durability of equipped tool ──────────────────── */
export function getEquippedToolDurability(e: Entity): { cur: number; max: number } | null {
  const toolId = e.tool ?? '';
  if (!toolId) return null;
  const def = ITEMS[toolId];
  if (!def || def.type !== ItemType.TOOL || !def.durability || def.durability <= 0) return null;
  const slot = (e.inventory ?? []).find(s => s.defId === toolId);
  if (!slot) return null;
  const d = slot.data as { dur?: number } | undefined;
  return { cur: d?.dur ?? def.durability, max: def.durability };
}

/* ── Consume durability on equipped tool use ──────────────────── */
export function consumeToolDurability(e: Entity, amount: number, msgs: Msg[], time: number, state?: GameState): boolean {
  if (amount <= 0) return false;
  const toolId = e.tool ?? '';
  if (!toolId) return false;
  const def = ITEMS[toolId];
  if (!def || def.type !== ItemType.TOOL || !def.durability || def.durability <= 0) return false;
  const inv = e.inventory ?? [];
  const idx = inv.findIndex(s => s.defId === toolId);
  if (idx < 0) { e.tool = ''; return false; }
  const slot = inv[idx];
  const d = (slot.data ?? { dur: def.durability }) as { dur: number };
  const wear = e.rpg && def.durability > 1 ? amount * strDurabilityWearMult(e.rpg) : amount;
  d.dur -= wear;
  slot.data = d;
  if (d.dur <= 0) {
    const name = ITEMS[slot.defId]?.name ?? slot.defId;
    inv.splice(idx, 1);
    e.tool = '';
    msgs.push(msg(`${name} изношен и сломан!`, time, '#f84'));
    publishPlayerItemEvent(state, e, 'tool_broke', slot.defId, 1, 3);
    return true;
  }
  return false;
}

/* ── Consume ammo for ranged weapon. Returns true if ammo available */
export function consumeAmmo(e: Entity, state?: GameState, itemId = equippedCombatItemId(e)): boolean {
  const ws = WEAPON_STATS[itemId];
  if (!ws || !ws.isRanged || !ws.ammoType) return false;
  if (ws.magazineSize === Infinity) {
    const consumed = removeItem(e, ws.ammoType, 1);
    if (consumed) publishPlayerItemEvent(state, e, 'ammo_consumed', ws.ammoType, 1, 0);
    return consumed;
  }
  if ((e.currentMag ?? 0) > 0) {
    e.currentMag = (e.currentMag ?? 0) - 1;
    return true;
  }
  return false;
}

/* ── Count ammo for current ranged weapon ─────────────────────── */
export function countAmmo(e: Entity, itemId = equippedCombatItemId(e)): number {
  const ws = WEAPON_STATS[itemId];
  if (!ws || !ws.ammoType) return 0;
  let total = 0;
  for (const slot of e.inventory ?? []) {
    if (slot.defId === ws.ammoType) total += slot.count;
  }
  return total;
}

export function updateInventoryConditions(e: Entity, state: GameState): void {
  updateGovnyakConditions(e, state);
}

function compactAmmoName(ammoType: string | undefined): string {
  if (!ammoType) return 'заряд';
  const label = AMMO_LABELS[ammoType];
  if (label) return label;
  const name = ITEMS[ammoType]?.name ?? ammoType;
  return name
    .replace(/^Патроны\s+/i, '')
    .replace(/^Канистра\s+/i, '')
    .replace(/^Пулемётная\s+/i, '')
    .slice(0, 14);
}

function weaponRole(id: string, ws: WeaponStats): string {
  const roleTier = WEAPON_ROLE_TIERS[id];
  if (ws.psiCost) return ws.isRanged ? 'ПСИ-снаряд' : 'ПСИ-эффект';
  if (roleTier) return WEAPON_ROLE_LABELS[roleTier];
  if (ws.isRanged) {
    if (ws.aoeRadius) return 'взрыв';
    if (id === 'flamethrower' || ws.ammoType === 'ammo_fuel') return 'зачистка';
    if ((ws.pellets ?? 1) > 1) return 'дробь';
    if (ws.ammoType === 'ammo_energy') return 'энерго';
    if (ws.ammoType === 'ammo_nails' || ws.ammoType === 'ammo_harpoon' || ws.ammoType === 'rifle_bolt_pack') return 'индустр.';
    if (ws.speed <= 0.1) return 'авто';
    return 'огонь';
  }
  if (!id) return 'кулаки';
  if ((ws.knockback ?? 0) >= 0.45) return 'стоп-ближ.';
  if (ws.range >= 1.65) return 'длинный ближ.';
  if (ws.speed >= 0.7 || ws.dmg >= 35) return 'тяж. ближ.';
  return 'ближний';
}

function statPercent(mult: number): number {
  return Math.round((mult - 1) * 100);
}

function statReductionPercent(mult: number): number {
  return Math.round((1 - mult) * 100);
}

function weaponStatLabel(e: Entity, base: WeaponStats, effective: WeaponStats): string {
  const rpg = e.rpg;
  if (!rpg) return '';
  const parts: string[] = [];
  if (!base.isRanged && !base.psiCost && rpg.str > 0) {
    parts.push(`СИЛ урон +${statPercent(strMeleeDmgMult(rpg))}%`);
  }
  const heavyMult = strHeavyWeaponSpeedMult(rpg, base.speed);
  if (!base.psiCost && heavyMult < 1) {
    parts.push(`тяж. темп -${statReductionPercent(heavyMult)}%`);
  }
  if (rpg.agi > 0) {
    parts.push(`ЛОВ КД -${statReductionPercent(agiAttackSpeedMult(rpg))}%`);
    if (base.isRanged && (base.spread ?? 0) > 0 && effective.spread !== undefined) {
      parts.push(`разброс -${statReductionPercent(agiRangedSpreadMult(rpg))}%`);
    }
  }
  if (base.psiCost && effective.psiCost !== undefined && effective.psiCost < base.psiCost) {
    parts.push(`ИНТ ПСИ -${statReductionPercent(effective.psiCost / base.psiCost)}%`);
  }
  return parts.slice(0, 3).join('  ');
}

function weaponReachLabel(ws: WeaponStats): string {
  if (ws.isRanged || ws.psiCost) return '';
  return `дист ${ws.range.toFixed(1)}`;
}

function weaponControlLabel(ws: WeaponStats): string {
  if (ws.isRanged || ws.psiCost) return '';
  const knockback = ws.knockback ?? 0;
  return knockback >= 0.1 ? `стоп ${knockback.toFixed(1)}` : '';
}

function weaponDamageLabel(e: Entity, itemId: string, ws: WeaponStats): { damage: number; label: string } {
  if (ws.isRanged || ws.psiCost) {
    const pellets = ws.pellets ?? 1;
    return { damage: ws.dmg, label: pellets > 1 ? `${ws.dmg}x${pellets}` : String(ws.dmg) };
  }
  const damage = meleeDamage(e.rpg, itemId, ws.dmg);
  return { damage, label: String(damage) };
}

/* ── Bounded current weapon display state for HUD/inventory ───── */
export function getWeaponReadiness(e: Entity, itemId = equippedCombatItemId(e)): WeaponReadiness {
  const id = itemId;
  const baseWs = WEAPON_STATS[id] ?? WEAPON_STATS[''];
  const ws = getWeaponStats(e, id);
  const name = id ? (ITEMS[id]?.name ?? id) : 'Кулаки';
  const cooldown = Math.max(0, e.attackCd ?? 0);
  const cooldownMax = Math.max(0.05, ws.speed * (e.rpg ? agiAttackSpeedMult(e.rpg) : 1));
  const cooldownPct = Math.max(0, Math.min(1, cooldown / cooldownMax));
  const damage = weaponDamageLabel(e, id, ws);
  let resourceKind: WeaponReadiness['resourceKind'] = 'none';
  let resourceName = '';
  let resourceCurrent = 0;
  let resourceMax: number | undefined;
  let resourceCost: number | undefined;
  let resourceLabel = 'без расхода';
  let cannotFireReason = '';
  let lowResource = false;
  let reloadPct = e.reloading ? (1 - Math.max(0, e.reloadTimer ?? 0) / (ws.reloadTime || 1)) : 0;

  if (ws.psiCost) {
    const cost = ws.psiCost;
    const costLabel = Number.isInteger(cost) ? String(cost) : cost.toFixed(1);
    const psi = Math.floor(e.rpg?.psi ?? 0);
    const maxPsi = e.rpg?.maxPsi ?? 0;
    resourceKind = 'psi';
    resourceName = 'ПСИ';
    resourceCurrent = psi;
    resourceMax = maxPsi;
    resourceCost = cost;
    resourceLabel = `ПСИ ${psi}/${maxPsi} -${costLabel}`;
    if (!e.rpg || (e.rpg.psi ?? 0) < cost) cannotFireReason = 'нет ПСИ';
    lowResource = psi < cost * 2;
  } else if (ws.isRanged || ws.ammoType) {
    const ammo = countAmmo(e, id);
    resourceKind = 'ammo';
    resourceName = compactAmmoName(ws.ammoType);
    resourceCurrent = ammo;
    resourceCost = 1;
    if (ws.magazineSize === Infinity) {
      resourceLabel = `${resourceName} ${ammo}`;
      if (!ws.ammoType || ammo <= 0) cannotFireReason = 'нет патронов';
      lowResource = ammo <= 3;
    } else {
      const mag = e.currentMag ?? 0;
      resourceLabel = `${resourceName} ${mag}/${ammo}`;
      if (mag <= 0 && ammo <= 0) cannotFireReason = 'нет патронов';
      else if (mag <= 0) cannotFireReason = 'нужна перезарядка';
      lowResource = mag <= Math.ceil((ws.magazineSize ?? 1) * 0.25) || ammo <= 0;
    }
    if (e.reloading) cannotFireReason = 'ПЕРЕЗАРЯДКА';
  } else {
    const dur = getEquippedDurability(e, id);
    resourceKind = 'durability';
    resourceName = 'прочн';
    if (dur) {
      const cur = Math.max(0, Math.ceil(dur.cur));
      resourceCurrent = cur;
      resourceMax = dur.max;
      resourceLabel = `прочн ${cur}/${dur.max}`;
      if (cur <= 0) cannotFireReason = 'сломано';
      lowResource = cur / Math.max(1, dur.max) <= 0.2;
    } else {
      resourceCurrent = ws.durability > 0 ? 0 : 1;
      resourceLabel = ws.durability > 0 ? 'прочн --' : 'прочн ∞';
      if (ws.durability > 0 && id) cannotFireReason = 'нет оружия';
    }
    if (e.reloading) cannotFireReason = 'ПЕРЕЗАРЯДКА';
  }

  return {
    id,
    name,
    role: weaponRole(id, baseWs),
    statLabel: weaponStatLabel(e, baseWs, ws),
    damage: damage.damage,
    damageLabel: damage.label,
    range: ws.range,
    pellets: ws.pellets ?? 1,
    knockback: ws.knockback ?? 0,
    reachLabel: weaponReachLabel(baseWs),
    controlLabel: weaponControlLabel(baseWs),
    cooldown,
    cooldownMax,
    cooldownPct,
    readyPct: 1 - cooldownPct,
    reloadPct,
    reloading: !!e.reloading,
    cooldownLabel: cooldown > 0.05 ? `КД ${cooldown.toFixed(1)}с` : 'ГОТОВ',
    resourceKind,
    resourceName,
    resourceCurrent,
    resourceMax,
    resourceCost,
    resourceLabel,
    cannotFireReason,
    lowResource,
    warning: cannotFireReason !== '' || lowResource,
  };
}


export function equipArmor(state: GameState, e: Entity, defId: string): Msg | undefined {
  if (!e.inventory) return;
  const itemIdx = e.inventory.findIndex(i => i.defId === defId);
  if (itemIdx === -1) return;

  if (e.armorDefId) {
    if (e.inventory.length >= MAX_INVENTORY_SLOTS) {
      return msg('Инвентарь полон, некуда снять текущую броню', state.time, '#f84');
    }
    e.inventory.push({ defId: e.armorDefId, count: 1 });
  }

  e.armorDefId = defId;
  const it = e.inventory[itemIdx];
  if (it.count > 1) {
    it.count--;
  } else {
    e.inventory.splice(itemIdx, 1);
  }
  return msg(`Надета броня: ${ITEMS[defId]?.name || defId}`, state.time, '#9d9');
}

export function unequipArmor(state: GameState, e: Entity): Msg | undefined {
  if (!e.armorDefId) return;
  if (!e.inventory) e.inventory = [];
  if (e.inventory.length >= MAX_INVENTORY_SLOTS) {
    return msg('Инвентарь полон, некуда снять броню', state.time, '#f84');
  }
  e.inventory.push({ defId: e.armorDefId, count: 1 });
  const name = ITEMS[e.armorDefId]?.name || e.armorDefId;
  e.armorDefId = undefined;
  return msg(`Броня снята: ${name}`, state.time, '#9d9');
}

/* ── Needs system: food, water, sleep, pee, poo ──────────────── */

import {
  type Entity,
  type GameState,
  type Msg,
  EntityType,
  msg,
  NpcState,
  RoomType,
} from '../core/types';
import type { World } from '../core/world';
import { occupationProfile } from '../data/occupation_profiles';
import { Spr } from '../render/sprite_index';
import { recordPlayerDamage } from './damage';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive } from './debug_cheats';
import { ENTITY_MASK_NPC, ensureEntityIndex } from './entity_index';
import { entitySpawnSlots } from './entity_limits';
import { stampUrineTraceCadenced } from './urination';

// Rates per second
const FOOD_RATE  = 0.08;
const WATER_RATE = 0.12;
const SLEEP_RATE = 0.05;
const PEE_DIGEST = 0.10;   // pending → pee per second
const POO_DIGEST = 0.06;   // pending → poo per second
const HOT_NEEDS_RADIUS = 42;
const COLD_NEEDS_BUDGET = 192;
const COLD_NEEDS_MAX_DT = 30;
const NEEDS_TOUCH_MAX = 16_384;
const PASSIVE_HP_REGEN_FRACTION_PER_MINUTE = 0.06; // 0.1% max per second
const PASSIVE_HP_REGEN_FOOD_PER_MINUTE = 4;

function needFraction(value: number): number {
  return Math.max(0, Math.min(1, value / 100));
}

export interface NeedsCohortDebugSummary {
  totalNeeds: number;
  playerExact: number;
  hotExact: number;
  coldUpdated: number;
  coldSkipped: number;
  coldChecked: number;
  coldBudget: number;
  coldCursor: number;
  hotRadius: number;
  deaths: number;
  droppedItems: number;
}

const hotNeeds: Entity[] = [];
const hotNeedIds = new Set<number>();
const lastNeedsAt = new Map<number, number>();
let coldNeedsCursor = 0;
let needsDebug: NeedsCohortDebugSummary = emptyNeedsDebug();

function roundNeedDamage(amount: number): number {
  return Math.max(0, Math.round(amount * 10) / 10);
}

function needDamageDetail(parts: { label: string; amount: number }[], amount: number): string {
  if (parts.length === 1) return `${parts[0].label}: -${roundNeedDamage(amount)}`;
  return `Истощение (${parts.map(part => part.label.toLowerCase()).join(', ')}): -${roundNeedDamage(amount)}`;
}

export function updateNeeds(
  entities: Entity[],
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId?: { v: number },
  state?: GameState,
  world?: World,
  passiveHealthRegenTimeScale = 1,
): void {
  const entityIndex = ensureEntityIndex(entities);
  const needsEntities = entityIndex.needs;
  const player = entityIndex.byId.get(playerId);
  needsDebug = {
    ...emptyNeedsDebug(),
    totalNeeds: needsEntities.length,
    coldBudget: COLD_NEEDS_BUDGET,
    hotRadius: HOT_NEEDS_RADIUS,
  };

  hotNeedIds.clear();

  if (player?.alive && player.needs) {
    const result = applyNeedTick(entities, player, dt, time, msgs, playerId, nextId, state, passiveHealthRegenTimeScale);
    rememberNeedsTouch(player.id, time);
    needsDebug.playerExact = 1;
    recordNeedDebugResult(result);
  }

  if (player?.alive) {
    entityIndex.queryRadius(player.x, player.y, HOT_NEEDS_RADIUS, hotNeeds, ENTITY_MASK_NPC);
    for (const e of hotNeeds) {
      if (!e.alive || !e.needs || e.id === playerId || hotNeedIds.has(e.id)) continue;
      hotNeedIds.add(e.id);
      const elapsed = elapsedNeedsDt(e, time, dt);
      const result = applyNeedTick(entities, e, elapsed, time, msgs, playerId, nextId, state, passiveHealthRegenTimeScale);
      rememberNeedsTouch(e.id, time);
      needsDebug.hotExact++;
      recordNeedDebugResult(result);
    }
  }

  const total = needsEntities.length;
  let checked = 0;
  let budget = COLD_NEEDS_BUDGET;
  while (checked < total && budget > 0) {
    if (coldNeedsCursor >= total) coldNeedsCursor = 0;
    const e = needsEntities[coldNeedsCursor++];
    checked++;
    if (!e.alive || !e.needs || e.id === playerId || hotNeedIds.has(e.id)) continue;

    budget--;
    const elapsed = elapsedNeedsDt(e, time, dt);
    applyColdResidentCadence(e, elapsed, time, world);
    const result = applyNeedTick(entities, e, elapsed, time, msgs, playerId, nextId, state, passiveHealthRegenTimeScale);
    rememberNeedsTouch(e.id, time);
    needsDebug.coldUpdated++;
    recordNeedDebugResult(result);
  }
  needsDebug.coldChecked = checked;
  needsDebug.coldSkipped = Math.max(0, total - needsDebug.playerExact - needsDebug.hotExact - needsDebug.coldUpdated);
  needsDebug.coldCursor = total > 0 ? coldNeedsCursor % total : 0;
}

function addMsg(msgs: Msg[], text: string, time: number, color: string) {
  if (msgs.length > 0 && msgs[msgs.length - 1].text === text) return;
  msgs.push(msg(text, time, color));
}

export function getNeedsCohortDebugSummary(): NeedsCohortDebugSummary {
  return { ...needsDebug };
}

export function formatNeedsCohortDebugSummary(): string {
  const s = getNeedsCohortDebugSummary();
  return `needs total=${s.totalNeeds} player=${s.playerExact} hot=${s.hotExact} cold=${s.coldUpdated}/${s.coldBudget} skipped=${s.coldSkipped}`;
}

export function resetNeedsCohortStateForTests(): void {
  hotNeedIds.clear();
  lastNeedsAt.clear();
  coldNeedsCursor = 0;
  needsDebug = emptyNeedsDebug();
}

function applyNeedTick(
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number } | undefined,
  state: GameState | undefined,
  passiveHealthRegenTimeScale: number,
): { died: boolean; droppedItems: number } {
  const n = e.needs;
  if (!n || dt <= 0) return { died: false, droppedItems: 0 };

  // Attribute scaling: STR slows hunger, AGI slows thirst, INT slows sleep decay
  const str = e.rpg?.str ?? 0;
  const agi = e.rpg?.agi ?? 0;
  const int = e.rpg?.int ?? 0;
  const foodRate  = FOOD_RATE  / (1 + 0.1 * str);
  const waterRate = WATER_RATE / (1 + 0.1 * agi);
  const sleepRate = SLEEP_RATE / (1 + 0.1 * int);

  n.food  = Math.max(0, n.food  - foodRate  * dt);
  n.water = Math.max(0, n.water - waterRate * dt);
  n.sleep = Math.max(0, n.sleep - sleepRate * dt);

  // Passive pee/poo growth from pending digestion
  if (n.pendingPee && n.pendingPee > 0) {
    const dp = Math.min(n.pendingPee, PEE_DIGEST * dt);
    n.pee = Math.min(100, n.pee + dp);
    n.pendingPee -= dp;
  }
  if (n.pendingPoo && n.pendingPoo > 0) {
    const dp = Math.min(n.pendingPoo, POO_DIGEST * dt);
    n.poo = Math.min(100, n.poo + dp);
    n.pendingPoo -= dp;
  }

  applyPassiveHealthRegen(e, dt * passiveHealthRegenTimeScale);

  // Consequences
  if (e.hp === undefined) return { died: false, droppedItems: 0 };
  if (e.id === playerId && isDebugOnePunchManEnabled()) {
    keepDebugOnePunchManAlive(e);
    return { died: false, droppedItems: 0 };
  }

  const needHits: { label: string; amount: number }[] = [];
  if (n.food <= 0) needHits.push({ label: 'Голод', amount: 0.3 * dt });
  if (n.water <= 0) needHits.push({ label: 'Обезвоживание', amount: 0.5 * dt });
  if (n.pee >= 100) needHits.push({ label: 'Мочевой отказ', amount: 0.1 * dt });
  if (n.poo >= 100) needHits.push({ label: 'Кишечный отказ', amount: 0.1 * dt });
  if (needHits.length > 0) {
    const amount = needHits.reduce((sum, hit) => sum + hit.amount, 0);
    const before = e.hp;
    e.hp -= amount;
    if (e.id === playerId && state) {
      recordPlayerDamage(state, undefined, before - e.hp, needDamageDetail(needHits, before - e.hp), 'need');
    }
  }

  // Player warnings
  if (e.id === playerId && (!state || !state.tutorialMode)) {
    if (n.food  < 15 && Math.random() < 0.005) addMsg(msgs, 'Вы голодны...', time, '#da4');
    if (n.water < 15 && Math.random() < 0.005) addMsg(msgs, 'Хочется пить...', time, '#48c');
    if (n.sleep < 10 && Math.random() < 0.005) addMsg(msgs, 'Глаза закрываются...', time, '#a8f');
    if (n.pee   > 85 && Math.random() < 0.005) addMsg(msgs, 'Нужен туалет...', time, '#da4');
  }

  if (e.hp > 0) return { died: false, droppedItems: 0 };
  e.alive = false;
  e.hp = 0;
  return { died: true, droppedItems: dropNpcInventory(entities, e, nextId) };
}

function applyPassiveHealthRegen(e: Entity, dt: number): void {
  const n = e.needs;
  if (!n || e.hp === undefined || e.maxHp === undefined || e.hp <= 0 || e.hp >= e.maxHp) return;
  const maxHp = Math.max(1, e.maxHp);
  const foodEfficiency = needFraction(n.food);
  const healRate = maxHp * PASSIVE_HP_REGEN_FRACTION_PER_MINUTE * foodEfficiency / 60;
  const foodRate = PASSIVE_HP_REGEN_FOOD_PER_MINUTE * foodEfficiency / 60;
  if (n.food <= 0 || healRate <= 0 || foodRate <= 0) return;
  const healed = Math.min(e.maxHp - e.hp, healRate * dt, n.food * (healRate / foodRate));
  if (healed <= 0) return;
  e.hp += healed;
  n.food = Math.max(0, n.food - healed * (foodRate / healRate));
}

function dropNpcInventory(entities: Entity[], e: Entity, nextId: { v: number } | undefined): number {
  if (e.type !== EntityType.NPC || !nextId || !e.inventory || e.inventory.length === 0) return 0;
  const slots = entitySpawnSlots(entities, EntityType.ITEM_DROP, e.inventory.length);
  let dropped = 0;
  for (const item of e.inventory) {
    if (dropped >= slots) break;
    if (!item || item.count <= 0) continue;
    dropped++;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: e.x + (Math.random() - 0.5) * 0.5,
      y: e.y + (Math.random() - 0.5) * 0.5,
      angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: item.defId, count: item.count, data: item.data }],
    });
  }
  e.inventory = [];
  return dropped;
}

function elapsedNeedsDt(e: Entity, time: number, fallbackDt: number): number {
  const last = lastNeedsAt.get(e.id);
  if (last === undefined || time <= 0 || last <= 0 || time < last) return fallbackDt;
  return Math.max(fallbackDt, Math.min(COLD_NEEDS_MAX_DT, time - last));
}

function rememberNeedsTouch(id: number, time: number): void {
  lastNeedsAt.set(id, time);
  if (lastNeedsAt.size <= NEEDS_TOUCH_MAX) return;
  let removed = 0;
  for (const key of lastNeedsAt.keys()) {
    lastNeedsAt.delete(key);
    if (++removed >= 512 || lastNeedsAt.size <= NEEDS_TOUCH_MAX) break;
  }
}

function applyColdResidentCadence(e: Entity, dt: number, time: number, world: World | undefined): void {
  const n = e.needs;
  if (!n || e.type !== EntityType.NPC || dt <= 0) return;
  const room = world?.roomAt(e.x, e.y);
  if (room?.type === RoomType.KITCHEN) {
    const food = occupationProfile(e.occupation)?.kitchenFoodRestore ?? 3.5;
    n.food = Math.min(100, n.food + food * dt);
    n.water = Math.min(100, n.water + 4.5 * dt);
    n.pendingPoo = (n.pendingPoo ?? 0) + food * 0.35 * dt;
    n.pendingPee = (n.pendingPee ?? 0) + 2.1 * dt;
  } else if (room?.type === RoomType.BATHROOM) {
    n.water = Math.min(100, n.water + 2 * dt);
    if (n.pee > 5 && world) {
      stampUrineTraceCadenced(world, e, time, {
        pressure: n.pee / 100,
        streamLength: 0.6,
        intervalSeconds: 0.35,
        streamSteps: n.pee > 60 ? 12 : 8,
        width: 0.04,
        dropCount: 0,
        intensityScale: 0.8,
      });
    }
    n.pee = Math.max(0, n.pee - 12 * dt);
    n.poo = Math.max(0, n.poo - 9 * dt);
  } else if (room?.type === RoomType.MEDICAL && e.hp !== undefined && e.maxHp !== undefined) {
    e.hp = Math.min(e.maxHp, e.hp + (occupationProfile(e.occupation)?.medicalRecoveryMultiplier ?? 1) * dt);
  }

  if (e.ai?.npcState === NpcState.SLEEPING && (room?.type === RoomType.LIVING || room?.type === RoomType.OFFICE)) {
    n.sleep = Math.min(100, n.sleep + 2.8 * dt);
  }
  if (e.ai?.npcState === NpcState.LUNCH && (room?.type === RoomType.COMMON || room?.type === RoomType.KITCHEN)) {
    n.food = Math.min(100, n.food + 1.5 * dt);
    n.water = Math.min(100, n.water + 1.5 * dt);
  }
}

function recordNeedDebugResult(result: { died: boolean; droppedItems: number }): void {
  if (result.died) needsDebug.deaths++;
  needsDebug.droppedItems += result.droppedItems;
}

function emptyNeedsDebug(): NeedsCohortDebugSummary {
  return {
    totalNeeds: 0,
    playerExact: 0,
    hotExact: 0,
    coldUpdated: 0,
    coldSkipped: 0,
    coldChecked: 0,
    coldBudget: COLD_NEEDS_BUDGET,
    coldCursor: coldNeedsCursor,
    hotRadius: HOT_NEEDS_RADIUS,
    deaths: 0,
    droppedItems: 0,
  };
}

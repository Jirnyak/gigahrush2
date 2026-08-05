/* ── Govnyak pressure items: bounded relief, cough, debt ─────── */

import {
  type Entity,
  type GameState,
  type PlayerStatus,
  type PlayerStatusId,
  type PlayerStatusSource,
  type WorldEventSeverity,
} from '../core/types';
import { ITEMS } from '../data/items';
import { publishEvent } from './events';
import { monsterBaitPreviewForItem } from './monster_bait';
import { isPlayerEntity } from './player_actor';

export const GOVNYAK_ITEM_IDS = [
  'govnyak_roll',
  'govnyak_brick',
  'govnyak_sample',
  'govnyak_bad_batch',
] as const;

export type GovnyakItemId = typeof GOVNYAK_ITEM_IDS[number];

export const GOVNYAK_ACTIVE_STATUS_CAP = 3;
const GOVNYAK_STATUS_INTENSITY_CAP = 3;
const GOVNYAK_STATUS_IDS: readonly PlayerStatusId[] = ['govnyak_relief', 'govnyak_cough', 'govnyak_debt'];
const GOVNYAK_STATUS_DURATION_CAPS: Partial<Record<PlayerStatusId, number>> = {
  govnyak_relief: 70,
  govnyak_cough: 210,
  govnyak_debt: 480,
};

interface GovnyakUseDef {
  psiRelief: number;
  thirstCost: number;
  sleepCost: number;
  hpCost: number;
  attackDelay: number;
  reliefSeconds: number;
  coughSeconds: number;
  debt: number;
  debtSeconds: number;
  badChance: number;
  badMadness: number;
}

const GOVNYAK_USE: Record<GovnyakItemId, GovnyakUseDef> = {
  govnyak_roll: {
    psiRelief: 6, thirstCost: 12, sleepCost: 4, hpCost: 0, attackDelay: 0.15,
    reliefSeconds: 35, coughSeconds: 55, debt: 0.45, debtSeconds: 190, badChance: 0.07, badMadness: 0,
  },
  govnyak_brick: {
    psiRelief: 12, thirstCost: 20, sleepCost: 8, hpCost: 3, attackDelay: 0.3,
    reliefSeconds: 55, coughSeconds: 95, debt: 0.75, debtSeconds: 300, badChance: 0.12, badMadness: 2,
  },
  govnyak_sample: {
    psiRelief: 16, thirstCost: 10, sleepCost: 6, hpCost: 1, attackDelay: 0.2,
    reliefSeconds: 45, coughSeconds: 70, debt: 0.55, debtSeconds: 260, badChance: 0.04, badMadness: 2,
  },
  govnyak_bad_batch: {
    psiRelief: 8, thirstCost: 26, sleepCost: 12, hpCost: 8, attackDelay: 0.6,
    reliefSeconds: 25, coughSeconds: 150, debt: 1.15, debtSeconds: 420, badChance: 1, badMadness: 5,
  },
};

export interface GovnyakUseResult {
  text: string;
  severity: WorldEventSeverity;
  badBatch: boolean;
}

export function isGovnyakItem(defId: string): defId is GovnyakItemId {
  return (GOVNYAK_ITEM_IDS as readonly string[]).includes(defId);
}

function itemName(defId: string): string {
  return ITEMS[defId]?.name ?? defId;
}

function statusIndex(e: Entity, id: PlayerStatusId): number {
  return (e.statuses ?? []).findIndex(s => s.id === id);
}

function getStatus(e: Entity, id: PlayerStatusId): PlayerStatus | undefined {
  const idx = statusIndex(e, id);
  return idx >= 0 ? e.statuses?.[idx] : undefined;
}

function isGovnyakStatusId(id: PlayerStatusId): boolean {
  return (GOVNYAK_STATUS_IDS as readonly PlayerStatusId[]).includes(id);
}

function govnyakStatusDurationCap(id: PlayerStatusId, duration: number): number {
  return GOVNYAK_STATUS_DURATION_CAPS[id] ?? duration;
}

function capGovnyakStatuses(e: Entity, now: number): void {
  if (!e.statuses) return;
  const merged: PlayerStatus[] = [];
  const others: PlayerStatus[] = [];
  for (const status of e.statuses) {
    if (!isGovnyakStatusId(status.id)) {
      others.push(status);
      continue;
    }
    const capped: PlayerStatus = {
      ...status,
      expiresAt: Math.min(status.expiresAt, now + govnyakStatusDurationCap(status.id, status.expiresAt - now)),
      intensity: status.intensity === undefined ? undefined : Math.min(GOVNYAK_STATUS_INTENSITY_CAP, Math.max(0, status.intensity)),
    };
    const existing = merged.find(s => s.id === capped.id);
    if (!existing) {
      merged.push(capped);
      continue;
    }
    existing.startedAt = Math.min(existing.startedAt, capped.startedAt);
    existing.expiresAt = Math.max(existing.expiresAt, capped.expiresAt);
    existing.intensity = Math.max(existing.intensity ?? 0, capped.intensity ?? 0);
    existing.badReaction = existing.badReaction === true || capped.badReaction === true;
  }
  if (merged.length > GOVNYAK_ACTIVE_STATUS_CAP) {
    merged.sort((a, b) => b.expiresAt - a.expiresAt);
    merged.length = GOVNYAK_ACTIVE_STATUS_CAP;
  }
  e.statuses = others.concat(merged);
}

function upsertStatus(
  e: Entity,
  id: PlayerStatusId,
  source: PlayerStatusSource,
  now: number,
  duration: number,
  intensity: number,
  badReaction = false,
): PlayerStatus {
  if (!e.statuses) e.statuses = [];
  const idx = statusIndex(e, id);
  const prev = idx >= 0 ? e.statuses[idx] : undefined;
  const status: PlayerStatus = {
    id,
    source,
    startedAt: prev?.startedAt ?? now,
    expiresAt: Math.min(now + govnyakStatusDurationCap(id, duration), Math.max(prev?.expiresAt ?? 0, now + duration)),
    intensity: Math.min(GOVNYAK_STATUS_INTENSITY_CAP, Math.max(0, intensity)),
    badReaction: badReaction || prev?.badReaction,
  };
  if (idx >= 0) e.statuses[idx] = status;
  else e.statuses.push(status);
  capGovnyakStatuses(e, now);
  return status;
}

function statusIntensity(e: Entity, id: PlayerStatusId): number {
  return getStatus(e, id)?.intensity ?? 0;
}

function publishGovnyakStatusEvent(
  state: GameState | undefined,
  actor: Entity,
  type: 'player_status_applied' | 'player_status_expired' | 'player_status_cured' | 'player_status_bad_reaction',
  status: PlayerStatus,
  severity: WorldEventSeverity,
  tags: string[],
): void {
  if (!state || !isPlayerEntity(actor)) return;
  publishEvent(state, {
    type,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: status.source,
    itemName: itemName(status.source),
    severity,
    privacy: severity >= 4 ? 'local' : 'private',
    tags: ['player', 'govnyak', 'contraband', 'status', ...tags],
    data: {
      statusId: status.id,
      source: status.source,
      intensity: status.intensity ?? 0,
      expiresAt: status.expiresAt,
      remainingSeconds: Math.max(0, status.expiresAt - (state?.time ?? 0)),
      statusCap: GOVNYAK_ACTIVE_STATUS_CAP,
      badReaction: status.badReaction === true,
      rumorIds: tags.includes('bad_batch')
        ? ['govnyak_bad_batch']
        : tags.includes('recovery')
          ? ['govnyak_recovery']
          : ['govnyak_debt'],
    },
  });
}

export function useGovnyakItem(actor: Entity, defId: string, state?: GameState): GovnyakUseResult | undefined {
  if (!isGovnyakItem(defId)) return undefined;
  const def = GOVNYAK_USE[defId];
  const now = state?.time ?? 0;
  const source = defId as PlayerStatusSource;
  const badBatch = def.badChance >= 1 || Math.random() < def.badChance;
  const baitPreview = monsterBaitPreviewForItem(defId, 'use', 1);

  if (actor.rpg) actor.rpg.psi = Math.min(actor.rpg.maxPsi, actor.rpg.psi + def.psiRelief);
  if (actor.needs) {
    actor.needs.water = Math.max(0, actor.needs.water - def.thirstCost);
    actor.needs.sleep = Math.max(0, actor.needs.sleep - def.sleepCost);
  }
  if (def.hpCost > 0 && actor.hp !== undefined) actor.hp = Math.max(1, actor.hp - def.hpCost);
  actor.attackCd = Math.max(actor.attackCd ?? 0, def.attackDelay);
  if (badBatch && def.badMadness > 0) actor.psiMadness = Math.max(actor.psiMadness ?? 0, def.badMadness);

  const relief = upsertStatus(actor, 'govnyak_relief', source, now, def.reliefSeconds, 1);
  const cough = upsertStatus(
    actor,
    'govnyak_cough',
    source,
    now,
    badBatch ? def.coughSeconds * 1.4 : def.coughSeconds,
    Math.min(GOVNYAK_STATUS_INTENSITY_CAP, statusIntensity(actor, 'govnyak_cough') + (badBatch ? 1.1 : 0.65)),
    badBatch,
  );
  const debt = upsertStatus(
    actor,
    'govnyak_debt',
    source,
    now,
    def.debtSeconds,
    Math.min(GOVNYAK_STATUS_INTENSITY_CAP, statusIntensity(actor, 'govnyak_debt') + def.debt),
    badBatch,
  );

  if (state && isPlayerEntity(actor)) {
    publishEvent(state, {
      type: 'player_use_item',
      actorId: actor.id,
      actorName: actor.name ?? 'Вы',
      actorFaction: actor.faction,
      itemId: defId,
      itemName: itemName(defId),
      itemCount: 1,
      itemValue: ITEMS[defId]?.value ?? 0,
      severity: badBatch ? 4 : 3,
      privacy: badBatch ? 'local' : 'private',
      tags: ['player', 'inventory', 'govnyak', 'contraband', 'use', badBatch ? 'bad_batch' : 'relief', 'cough_debt', 'bait_marker'],
      data: {
        psiRelief: def.psiRelief,
        costText: `water-${def.thirstCost} sleep-${def.sleepCost}${def.hpCost > 0 ? ` hp-${def.hpCost}` : ''}`,
        debtIntensity: debt.intensity ?? 0,
        coughIntensity: cough.intensity ?? 0,
        reliefSeconds: relief.expiresAt - now,
        coughSeconds: cough.expiresAt - now,
        debtSeconds: debt.expiresAt - now,
        baitRadius: baitPreview?.radius,
        baitSeconds: baitPreview?.ttlSeconds,
        baitMaxAttractions: baitPreview?.maxAttractions,
        baitMarker: baitPreview?.markerLabel,
        rumorIds: [badBatch ? 'govnyak_bad_batch' : 'govnyak_trade'],
      },
    });
    publishGovnyakStatusEvent(state, actor, 'player_status_applied', debt, 3, ['debt']);
    if (badBatch) publishGovnyakStatusEvent(state, actor, 'player_status_bad_reaction', cough, 4, ['bad_batch', 'cough']);
  }

  const debtLabel = Math.ceil((debt.intensity ?? 0) * 10) / 10;
  const coughLabel = Math.ceil((cough.intensity ?? 0) * 10) / 10;
  const reliefSeconds = Math.ceil(relief.expiresAt - now);
  const coughSeconds = Math.ceil(cough.expiresAt - now);
  const debtSeconds = Math.ceil(debt.expiresAt - now);
  const cost = `вода -${def.thirstCost}${def.hpCost > 0 ? `, HP -${def.hpCost}` : ''}`;
  const statusText = `облегчение ${reliefSeconds}с, кашель ${coughSeconds}с x${coughLabel}, долг ${debtLabel}/3 ${debtSeconds}с`;
  const baitText = baitPreview
    ? ` Дымовая метка: ${Math.round(baitPreview.radius)}кл/${Math.ceil(baitPreview.ttlSeconds)}с, до ${baitPreview.maxAttractions}, активных <=${baitPreview.activeCap}.`
    : '';
  if (badBatch) {
    return {
      text: `Говняк сорвался: ПСИ +${def.psiRelief}, ${cost}. ${statusText}.${baitText}`,
      severity: 4,
      badBatch,
    };
  }
  return {
    text: `Говняк притушил шум: ПСИ +${def.psiRelief}, ${cost}. ${statusText}.${baitText}`,
    severity: 3,
    badBatch,
  };
}

export function govnyakAimSpreadMult(e: Entity): number {
  const cough = statusIntensity(e, 'govnyak_cough');
  const debt = statusIntensity(e, 'govnyak_debt');
  if (cough <= 0 && debt <= 0) return 1;
  return 1 + Math.min(0.75, cough * 0.16 + debt * 0.08);
}

export function updateGovnyakConditions(e: Entity, state: GameState): void {
  if (!e.statuses || e.statuses.length === 0) return;
  const now = state.time;
  const originalLength = e.statuses.length;
  let writeIdx = 0;

  for (let i = 0; i < originalLength; i++) {
    const status = e.statuses[i];
    if (status.id.startsWith('govnyak_') && status.expiresAt <= now) {
      if (status.id === 'govnyak_debt') {
        publishGovnyakStatusEvent(state, e, 'player_status_cured', status, 3, ['recovery', 'debt_clear']);
      } else if (status.id === 'govnyak_cough') {
        publishGovnyakStatusEvent(state, e, 'player_status_expired', status, 2, ['recovery', 'cough_clear']);
      }
    } else {
      if (writeIdx !== i) e.statuses[writeIdx] = status;
      writeIdx++;
    }
  }

  if (writeIdx !== originalLength) {
    e.statuses.length = writeIdx;
    if (writeIdx === 0) e.statuses = undefined;
  }
}

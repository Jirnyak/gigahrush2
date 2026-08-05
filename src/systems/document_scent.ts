/* ── Document scent: papers, forms, stamps and carried bureaucracy ── */

import { ItemType, RoomType, type Entity, type Item, type ItemDef } from '../core/types';
import { ITEMS, ITEM_TAGS } from '../data/items';

export const KONTORSHCHIK_NOISY_UNTIL_KEY = 'kontorshchikNoisyUntil';
export const KONTORSHCHIK_NOISY_BY_KEY = 'kontorshchikNoisyBy';
export const KONTORSHCHIK_NOISY_SECONDS = 4.5;

const DOCUMENT_SCENT_TAGS = [
  'document',
  'documents',
  'paper',
  'papers',
  'admin',
  'official',
  'forgery',
  'forged',
  'audit',
  'evidence',
  'permit',
  'ration',
  'coupon',
  'receipt',
  'warrant',
  'archive',
  'stamp',
] as const;

const DOCUMENT_SCENT_ID_PARTS = [
  'document',
  'paper',
  'form',
  'permit',
  'pass',
  'stamp',
  'order',
  'warrant',
  'tally',
  'receipt',
  'archive',
  'docket',
  'file',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasScentTag(defId: string, def: ItemDef): boolean {
  const tags = [...(ITEM_TAGS[defId] ?? []), ...(def.tags ?? [])];
  for (const tag of tags) {
    if ((DOCUMENT_SCENT_TAGS as readonly string[]).includes(tag)) return true;
  }
  return false;
}

function hasScentId(defId: string): boolean {
  for (const part of DOCUMENT_SCENT_ID_PARTS) {
    if (defId.includes(part)) return true;
  }
  return false;
}

export function isDocumentScentItem(defId: string, def = ITEMS[defId]): boolean {
  if (!def) return false;
  if (def.type === ItemType.NOTE) return true;
  if (hasScentTag(defId, def) || hasScentId(defId)) return true;
  return def.type === ItemType.MISC &&
    (def.spawnRooms.includes(RoomType.OFFICE) || def.spawnRooms.includes(RoomType.HQ)) &&
    !def.spawnRooms.includes(RoomType.PRODUCTION);
}

function scentWeight(defId: string, def: ItemDef): number {
  let weight = def.value >= 80 ? 1.5 : def.value >= 25 ? 1.25 : 1;
  const tags = [...(ITEM_TAGS[defId] ?? []), ...(def.tags ?? [])];
  if (tags.includes('document_gate') || tags.includes('permit') || tags.includes('warrant')) weight += 0.65;
  if (tags.includes('stamp') || tags.includes('forgery') || tags.includes('audit')) weight += 0.45;
  if (defId.includes('form') || defId.includes('file') || defId.includes('archive')) weight += 0.35;
  return weight;
}

export function documentScentStrength(entity: Entity | undefined): number {
  let strength = 0;
  for (const slot of entity?.inventory ?? []) {
    if (!slot || slot.count <= 0) continue;
    const def = ITEMS[slot.defId];
    if (!def || !isDocumentScentItem(slot.defId, def)) continue;
    strength += Math.min(4, slot.count) * scentWeight(slot.defId, def);
  }
  return Math.min(10, strength);
}

export function hasDocumentScent(entity: Entity | undefined): boolean {
  return documentScentStrength(entity) > 0;
}

export interface NoisyDocumentMark {
  itemId: string;
  itemName: string;
  until: number;
  marked: boolean;
}

export function markNoisyDocument(entity: Entity, time: number, sourceId: number): NoisyDocumentMark | undefined {
  let best: { slot: Item; def: ItemDef; score: number } | undefined;
  for (const slot of entity.inventory ?? []) {
    if (!slot || slot.count <= 0) continue;
    const def = ITEMS[slot.defId];
    if (!def || !isDocumentScentItem(slot.defId, def)) continue;
    const score = scentWeight(slot.defId, def) + Math.min(3, slot.count) * 0.2;
    if (!best || score > best.score) best = { slot, def, score };
  }
  if (!best) return undefined;

  const until = time + KONTORSHCHIK_NOISY_SECONDS;
  if (best.slot.data === undefined || isRecord(best.slot.data)) {
    const data = isRecord(best.slot.data) ? best.slot.data : {};
    data[KONTORSHCHIK_NOISY_UNTIL_KEY] = until;
    data[KONTORSHCHIK_NOISY_BY_KEY] = sourceId;
    best.slot.data = data;
    return { itemId: best.def.id, itemName: best.def.name, until, marked: true };
  }
  return { itemId: best.def.id, itemName: best.def.name, until, marked: false };
}

export function consumeNoisyDocumentDelay(slot: Item, time: number): NoisyDocumentMark | undefined {
  if (!isRecord(slot.data)) return undefined;
  const until = Number(slot.data[KONTORSHCHIK_NOISY_UNTIL_KEY]);
  if (!Number.isFinite(until)) {
    delete slot.data[KONTORSHCHIK_NOISY_UNTIL_KEY];
    delete slot.data[KONTORSHCHIK_NOISY_BY_KEY];
    if (Object.keys(slot.data).length === 0) slot.data = undefined;
    return undefined;
  }

  if (until <= time) {
    delete slot.data[KONTORSHCHIK_NOISY_UNTIL_KEY];
    delete slot.data[KONTORSHCHIK_NOISY_BY_KEY];
    if (Object.keys(slot.data).length === 0) slot.data = undefined;
    return undefined;
  }

  const def = ITEMS[slot.defId];
  return { itemId: slot.defId, itemName: def?.name ?? slot.defId, until, marked: true };
}

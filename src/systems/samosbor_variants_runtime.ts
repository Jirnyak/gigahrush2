import { FloorLevel } from '../core/types';
import {
  SAMOSBOR_VARIANTS,
  buildActiveSamosborVariant,
  getSamosborVariantWeight,
  type ActiveSamosborVariant,
  type SamosborVariantId,
} from '../data/samosbor_variants';

let activeVariant: ActiveSamosborVariant | null = null;
let forcedNextVariant: SamosborVariantId | null = null;
let lastVariant: SamosborVariantId | null = null;

function secureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] / 4294967296;
  }
  return Math.random();
}

export function chooseSamosborVariant(floor: FloorLevel): ActiveSamosborVariant {
  if (forcedNextVariant) {
    const forced = SAMOSBOR_VARIANTS.find(v => v.id === forcedNextVariant);
    forcedNextVariant = null;
    if (forced && forced.floors.includes(floor)) {
      activeVariant = buildActiveSamosborVariant(forced);
      lastVariant = activeVariant.def.id;
      return activeVariant;
    }
  }



  let total = 0;
  for (const def of SAMOSBOR_VARIANTS) total += getSamosborVariantWeight(def.id, floor);
  let roll = secureRandom() * Math.max(1, total);
  for (const def of SAMOSBOR_VARIANTS) {
    roll -= getSamosborVariantWeight(def.id, floor);
    if (roll <= 0) {
      activeVariant = buildActiveSamosborVariant(def);
      lastVariant = activeVariant.def.id;
      return activeVariant;
    }
  }

  activeVariant = buildActiveSamosborVariant(SAMOSBOR_VARIANTS[0]);
  lastVariant = activeVariant.def.id;
  return activeVariant;
}

export function getActiveSamosborVariant(): ActiveSamosborVariant | null {
  return activeVariant;
}

export function clearActiveSamosborVariant(): void {
  activeVariant = null;
}

export function forceNextSamosborVariant(id: SamosborVariantId): boolean {
  if (!SAMOSBOR_VARIANTS.some(v => v.id === id)) return false;
  forcedNextVariant = id;
  return true;
}

export function cycleForcedSamosborVariant(): SamosborVariantId {
  const ids = SAMOSBOR_VARIANTS.map(v => v.id);
  const currentIdx = forcedNextVariant ? ids.indexOf(forcedNextVariant) : -1;
  const next = ids[(currentIdx + 1) % ids.length];
  forcedNextVariant = next;
  return next;
}

export function getForcedSamosborVariant(): SamosborVariantId | null {
  return forcedNextVariant;
}

export function getLastSamosborVariant(): SamosborVariantId | null {
  return lastVariant;
}

export function setActiveSamosborVariantForTests(variant: any): void {
  activeVariant = variant;
}

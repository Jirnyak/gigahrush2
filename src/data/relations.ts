/* ── Faction-to-faction relation system ───────────────────────── */

import { Faction, Occupation } from '../core/types';
import { OCCUPATION_PROFILES } from './occupation_profiles';

/* ── Constants ────────────────────────────────────────────────── */
export const FACTION_COUNT = 6; // CITIZEN, LIQUIDATOR, CULTIST, SCIENTIST, WILD, PLAYER

/* ── Dynamic faction relation matrix — Int8Array flat ────────── */
// factionRels[a * FACTION_COUNT + b] = how faction a feels about faction b (-128..127)
const factionRels = new Int8Array(FACTION_COUNT * FACTION_COUNT);

/* ── Get / set / add faction relation ─────────────────────────── */
export function getFactionRel(a: number, b: number): number {
  return factionRels[a * FACTION_COUNT + b];
}

export function setFactionRel(a: number, b: number, v: number): void {
  factionRels[a * FACTION_COUNT + b] = Math.max(-128, Math.min(127, v | 0));
}

export function addFactionRel(a: number, b: number, delta: number): void {
  setFactionRel(a, b, getFactionRel(a, b) + delta);
}

export function addFactionRelMutual(a: number, b: number, delta: number): void {
  addFactionRel(a, b, delta);
  addFactionRel(b, a, delta);
}

/* ── Base faction attitudes (used for initialization) ─────────── */
// [row faction][col faction] = base attitude
// <=−50 hostile, −50..50 neutral, >=50 friendly
const BASE_FACTION_MATRIX: number[][] = [
  /*                CIT   LIQ   CUL   SCI   WILD  PLAYER */
  /* CITIZEN  */ [  100,   50,    0,   50,  -50,    50 ],
  /* LIQUID.  */ [   50,  100,  -50,   50,  -50,    50 ],
  /* CULTIST  */ [    0,  -50,  100,  -20,  -50,     0 ],
  /* SCIENTIST*/ [   50,   50,  -20,  100,  -50,    50 ],
  /* WILD     */ [  -50,  -50,  -50,  -50,  100,   -50 ],
  /* PLAYER   */ [   50,   50,    0,   50,  -50,   100 ],
];

/* ── Initialize dynamic faction relations from base matrix ────── */
export function initFactionRelations(): void {
  for (let a = 0; a < FACTION_COUNT; a++) {
    for (let b = 0; b < FACTION_COUNT; b++) {
      setFactionRel(a, b, BASE_FACTION_MATRIX[a][b]);
    }
  }
}



/* ── Faction names ────────────────────────────────────────────── */
export const FACTION_NAMES: Record<Faction, string> = {
  [Faction.CITIZEN]: 'Гражданин',
  [Faction.LIQUIDATOR]: 'Ликвидатор',
  [Faction.CULTIST]: 'Культист',
  [Faction.SCIENTIST]: 'Учёный',
  [Faction.WILD]: 'Дикий',
  [Faction.PLAYER]: 'Игрок',
};

/* ── Occupation names ─────────────────────────────────────────── */
export const OCCUPATION_NAMES: Record<Occupation, string> = {
  ...Object.fromEntries(Object.values(OCCUPATION_PROFILES).map(profile => [profile.occupation, profile.label])),
} as Record<Occupation, string>;

/* ── Weighted faction/occupation assignment ────────────────────── */
export function randomFaction(): Faction {
  const r = Math.random();
  if (r < 0.40) return Faction.CITIZEN;
  if (r < 0.60) return Faction.LIQUIDATOR;
  if (r < 0.75) return Faction.CULTIST;
  if (r < 0.90) return Faction.SCIENTIST;
  return Faction.WILD;
}

/* ── Weighted occupation distribution (faction-independent) ───── */
// домохозяйка 10%, слесарь 10%, секретарь 10%, электрик 10%, повар 5%,
// врач 5%, токарь 10%, механик 10%, кладовщик 10%, алкоголик 5%,
// учёный 5%, ребёнок 10%, директор 1%
const OCC_WEIGHTS: [Occupation, number][] = Object.values(OCCUPATION_PROFILES)
  .filter(profile => profile.defaultGenerationWeight > 0)
  .map(profile => [profile.occupation, profile.defaultGenerationWeight] as [Occupation, number]);
const OCC_TOTAL = OCC_WEIGHTS.reduce((s, [, w]) => s + w, 0);

export function randomOccupation(_faction: Faction): Occupation {
  let r = Math.random() * OCC_TOTAL;
  for (const [occ, w] of OCC_WEIGHTS) {
    r -= w;
    if (r <= 0) return occ;
  }
  return Occupation.HOUSEWIFE;
}

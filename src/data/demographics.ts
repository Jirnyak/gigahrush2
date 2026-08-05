import type { CharacterSex } from '../core/types';

export const CHARACTER_AGE_MIN = 1;
export const CHARACTER_AGE_MAX = 100;
export const DEFAULT_PLAYER_AGE = 25;
export const DEFAULT_PLAYER_SEX: CharacterSex = 'male';

export const CHARACTER_SEX_UNSET = 0;
export const CHARACTER_SEX_MALE = 1;
export const CHARACTER_SEX_FEMALE = 2;

export type CharacterAgeBand = 'child' | 'teen' | 'young_adult' | 'adult' | 'mature' | 'elder';

export function clampCharacterAge(value: unknown, fallback = DEFAULT_PLAYER_AGE): number {
  const base = typeof fallback === 'number' && Number.isFinite(fallback)
    ? Math.trunc(fallback)
    : DEFAULT_PLAYER_AGE;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.max(CHARACTER_AGE_MIN, Math.min(CHARACTER_AGE_MAX, base));
  }
  return Math.max(CHARACTER_AGE_MIN, Math.min(CHARACTER_AGE_MAX, Math.trunc(value)));
}

export function sanitizeCharacterSex(value: unknown, fallback: CharacterSex = DEFAULT_PLAYER_SEX): CharacterSex {
  return value === 'female' || value === 'male' ? value : fallback;
}

export function characterSexFromFemale(female: boolean): CharacterSex {
  return female ? 'female' : 'male';
}

export function characterSexCode(sex: CharacterSex): number {
  return sex === 'female' ? CHARACTER_SEX_FEMALE : CHARACTER_SEX_MALE;
}

export function characterSexFromCode(code: unknown, fallback: CharacterSex = DEFAULT_PLAYER_SEX): CharacterSex {
  return code === CHARACTER_SEX_FEMALE ? 'female' : code === CHARACTER_SEX_MALE ? 'male' : fallback;
}

export function characterSexLabelRu(sex: CharacterSex): string {
  return sex === 'female' ? 'женский' : 'мужской';
}

export function characterSexLabelEn(sex: CharacterSex): string {
  return sex === 'female' ? 'female' : 'male';
}

export function characterAgeBand(ageInput: unknown): CharacterAgeBand {
  const age = clampCharacterAge(ageInput);
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'young_adult';
  if (age < 45) return 'adult';
  if (age < 65) return 'mature';
  return 'elder';
}

export function characterAgeBandLabelRu(ageInput: unknown): string {
  switch (characterAgeBand(ageInput)) {
    case 'child': return 'ребёнок';
    case 'teen': return 'подросток';
    case 'young_adult': return 'молодой взрослый';
    case 'adult': return 'взрослый';
    case 'mature': return 'старший взрослый';
    case 'elder': return 'пожилой';
  }
}

export function characterAgeSexTags(ageInput: unknown, sexInput: unknown): readonly string[] {
  const age = clampCharacterAge(ageInput);
  const band = characterAgeBand(age);
  const sex = sanitizeCharacterSex(sexInput);
  return [`age.${band}`, `sex.${sex}`];
}

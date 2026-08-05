export const CRAFT_MATERIAL_IDS = [
  'mechanics',
  'electronics',
  'consumables',
  'bio',
  'chemical',
  'metal',
  'cybernetics',
  'psimatter',
  'metamatter',
] as const;

export type CraftMaterialId = typeof CRAFT_MATERIAL_IDS[number];
export type CraftVector = readonly [number, number, number, number, number, number, number, number, number];
export type MutableCraftVector = [number, number, number, number, number, number, number, number, number];
export type CraftMaterialRarity = 'common' | 'specific' | 'rare';
export type CraftStationKind = 'any' | 'workbench' | 'lathe' | 'lab' | 'net_terminal';
export const CRAFT_MATERIAL_COUNT = CRAFT_MATERIAL_IDS.length;

export interface CraftMaterialDef {
  id: CraftMaterialId;
  name: string;
  shortName: string;
  shortLabel?: string;
  color: string;
  rarity?: CraftMaterialRarity;
  economyHints?: readonly string[];
}

export const EMPTY_CRAFT_VECTOR: CraftVector = [0, 0, 0, 0, 0, 0, 0, 0, 0];

export function isCraftMaterialId(value: unknown): value is CraftMaterialId {
  return typeof value === 'string' && (CRAFT_MATERIAL_IDS as readonly string[]).includes(value);
}

export function craftMaterialIndex(materialId: CraftMaterialId): number {
  return CRAFT_MATERIAL_IDS.indexOf(materialId);
}

export function emptyCraftVector(): MutableCraftVector {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

export function craftVectorTotal(vector: CraftVector | MutableCraftVector): number {
  let total = 0;
  for (const value of vector) total += Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return total;
}

export const CRAFT_MATERIAL_DEFS: readonly CraftMaterialDef[] = [
  { id: 'mechanics', name: 'Механика', shortName: 'МЕХ', color: '#9fb7a6' },
  { id: 'electronics', name: 'Электроника', shortName: 'ЭЛК', color: '#68d8d2' },
  { id: 'consumables', name: 'Расходники', shortName: 'РАС', color: '#d6c07a' },
  { id: 'bio', name: 'Биомасса', shortName: 'БИО', color: '#8fce62' },
  { id: 'chemical', name: 'Химикаты', shortName: 'ХИМ', color: '#d6905a' },
  { id: 'metal', name: 'Материал', shortName: 'МАТ', color: '#a9b0b8' },
  { id: 'cybernetics', name: 'Кибернетика', shortName: 'КИБ', color: '#5ea0ff' },
  { id: 'psimatter', name: 'Псиматерия', shortName: 'ПСИ', color: '#c078ff' },
  { id: 'metamatter', name: 'Метаматерия', shortName: 'МЕТ', color: '#ff6fb0' },
];

const MATERIAL_ECONOMY_HINTS: Record<CraftMaterialId, readonly string[]> = {
  mechanics: ['tools', 'metal', 'repair'],
  electronics: ['electronics', 'tools', 'terminals'],
  consumables: ['paper', 'food', 'documents', 'survival'],
  bio: ['food', 'slime_samples', 'zhelemish', 'medicine'],
  chemical: ['medicine', 'fuel', 'ammo', 'industrial_slurry'],
  metal: ['metal', 'ammo', 'weapons', 'production'],
  cybernetics: ['rare_energy', 'net', 'robotics', 'deep_route'],
  psimatter: ['psi', 'cult', 'samosbor', 'deep_route'],
  metamatter: ['void', 'endgame', 'anomalies', 'route_gated'],
};

export const CRAFT_MATERIALS: Record<CraftMaterialId, CraftMaterialDef> = Object.fromEntries(
  CRAFT_MATERIAL_DEFS.map(def => [
    def.id,
    {
      ...def,
      shortLabel: def.shortName,
      rarity: def.id === 'cybernetics' || def.id === 'psimatter' || def.id === 'metamatter'
        ? 'rare'
        : def.id === 'bio' || def.id === 'chemical' || def.id === 'metal'
          ? 'specific'
          : 'common',
      economyHints: MATERIAL_ECONOMY_HINTS[def.id],
    },
  ]),
) as Record<CraftMaterialId, CraftMaterialDef>;

export const CRAFT_MATERIAL_INDEX: Record<CraftMaterialId, number> = Object.fromEntries(
  CRAFT_MATERIAL_IDS.map((id, index) => [id, index]),
) as Record<CraftMaterialId, number>;

export function mutableCraftVector(input: readonly unknown[] | undefined): MutableCraftVector {
  const out = emptyCraftVector();
  if (!input) return out;
  for (let i = 0; i < out.length; i++) {
    const value = Number(input[i]);
    out[i] = Number.isFinite(value) ? Math.max(0, Math.min(999_999, Math.floor(value))) : 0;
  }
  return out;
}

export function sumCraftVectors(vectors: readonly CraftVector[]): MutableCraftVector {
  const out = emptyCraftVector();
  for (const vector of vectors) {
    for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) out[i] += vector[i];
  }
  return out;
}

export function validateCraftVector(vector: readonly number[]): string[] {
  const errors: string[] = [];
  if (vector.length !== CRAFT_MATERIAL_COUNT) {
    errors.push(`length:${vector.length}`);
    return errors;
  }
  let total = 0;
  vector.forEach((value, index) => {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      errors.push(`${CRAFT_MATERIAL_IDS[index]}:${String(value)}`);
    }
    total += value;
  });
  if (total < 1) errors.push('total:0');
  return errors;
}

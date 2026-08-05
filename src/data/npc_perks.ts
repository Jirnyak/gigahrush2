import { DEMOS_TRAIT_DEFS, type DemosTraitDef } from './demos_traits';

export interface NpcPerkDef {
  id: string;
  label: string;
  kind: 'demos_trait' | 'rpg' | 'social' | 'combat' | 'routine' | 'extension';
  tags: readonly string[];
  sourceTraitId?: string;
}

const NPC_PERKS: NpcPerkDef[] = DEMOS_TRAIT_DEFS.map((trait: DemosTraitDef) => ({
  id: trait.id,
  label: trait.label,
  kind: 'demos_trait',
  tags: trait.tags,
  sourceTraitId: trait.id,
}));

const NPC_PERKS_BY_ID = new Map<string, NpcPerkDef>(NPC_PERKS.map(def => [def.id, def]));
const NPC_PERK_ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function registerNpcPerk(def: NpcPerkDef): void {
  const id = def.id.trim();
  if (!NPC_PERK_ID_RE.test(id)) throw new Error(`[NPC_PERK] invalid id "${def.id}"`);
  if (NPC_PERKS_BY_ID.has(id)) throw new Error(`[NPC_PERK] duplicate id "${id}"`);
  const checked: NpcPerkDef = {
    ...def,
    id,
    label: def.label.trim().slice(0, 64),
    tags: [...new Set(def.tags.map(tag => tag.trim()).filter(Boolean))].slice(0, 16),
  };
  NPC_PERKS.push(checked);
  NPC_PERKS_BY_ID.set(id, checked);
}

export function registerNpcPerks(defs: readonly NpcPerkDef[]): void {
  for (const def of defs) registerNpcPerk(def);
}

export function getNpcPerk(id: string): NpcPerkDef | undefined {
  return NPC_PERKS_BY_ID.get(id);
}

export function allNpcPerks(): readonly NpcPerkDef[] {
  return NPC_PERKS;
}

export function validateNpcPerks(): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of NPC_PERKS) {
    if (!NPC_PERK_ID_RE.test(def.id)) errors.push(`${def.id}:bad id`);
    if (seen.has(def.id)) errors.push(`${def.id}:duplicate`);
    seen.add(def.id);
    if (!def.label.trim()) errors.push(`${def.id}:missing label`);
  }
  return errors;
}

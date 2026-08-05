export const DEMOS_TRAIT_SLOTS = 4;
export const DEMOS_TRAIT_REGISTRY_VERSION = 1;

export type DemosTraitKind =
  | 'temper'
  | 'social'
  | 'work'
  | 'fear'
  | 'taste'
  | 'quest_bias';

export interface DemosTraitDef {
  id: string;
  kind: DemosTraitKind;
  label: string;
  tags: readonly string[];
  relationBias?: number;
  questWeightBias?: number;
  barkWeightBias?: number;
}

export const DEMOS_TRAIT_DEFS: readonly DemosTraitDef[] = [
  {
    id: 'brave',
    kind: 'temper',
    label: 'смелый',
    tags: ['trait.brave', 'temper.forward'],
    relationBias: 5,
    questWeightBias: 1,
  },
  {
    id: 'cowardly',
    kind: 'temper',
    label: 'бережёт шкуру',
    tags: ['trait.cowardly', 'temper.cautious'],
    barkWeightBias: 1,
  },
  {
    id: 'orderly',
    kind: 'temper',
    label: 'по журналу',
    tags: ['trait.orderly', 'temper.rule'],
    questWeightBias: 1,
  },
  {
    id: 'vengeful',
    kind: 'temper',
    label: 'злопамятный',
    tags: ['trait.vengeful', 'temper.grudge'],
    relationBias: -7,
    barkWeightBias: 1,
  },
  {
    id: 'helpful',
    kind: 'social',
    label: 'помогает своим',
    tags: ['trait.helpful', 'social.help'],
    relationBias: 8,
    questWeightBias: 2,
  },
  {
    id: 'greedy',
    kind: 'social',
    label: 'считает рубли',
    tags: ['trait.greedy', 'social.debt'],
    relationBias: -3,
  },
  {
    id: 'quiet_neighbor',
    kind: 'social',
    label: 'тихий сосед',
    tags: ['trait.quiet_neighbor', 'social.quiet'],
  },
  {
    id: 'work_pride',
    kind: 'work',
    label: 'гордится сменой',
    tags: ['trait.work_pride', 'work.shift'],
    questWeightBias: 1,
  },
  {
    id: 'paper_soul',
    kind: 'work',
    label: 'любит бумагу',
    tags: ['trait.paper_soul', 'work.paper'],
  },
  {
    id: 'tool_hands',
    kind: 'work',
    label: 'руки в масле',
    tags: ['trait.tool_hands', 'work.repair'],
    questWeightBias: 1,
  },
  {
    id: 'kitchen_shift',
    kind: 'work',
    label: 'дежурит у кухни',
    tags: ['trait.kitchen_shift', 'work.food'],
  },
  {
    id: 'fear_monster',
    kind: 'fear',
    label: 'боится твари',
    tags: ['trait.fear_monster', 'fear.monster'],
    barkWeightBias: 1,
  },
  {
    id: 'fear_samosbor',
    kind: 'fear',
    label: 'боится сирены',
    tags: ['trait.fear_samosbor', 'fear.samosbor'],
    barkWeightBias: 1,
  },
  {
    id: 'fear_hunger',
    kind: 'fear',
    label: 'боится пустой пайки',
    tags: ['trait.fear_hunger', 'fear.hunger'],
  },
  {
    id: 'fear_debt',
    kind: 'fear',
    label: 'боится долгов',
    tags: ['trait.fear_debt', 'fear.debt'],
  },
  {
    id: 'taste_food',
    kind: 'taste',
    label: 'держится кухни',
    tags: ['trait.taste_food', 'taste.food'],
  },
  {
    id: 'taste_tools',
    kind: 'taste',
    label: 'любит инструмент',
    tags: ['trait.taste_tools', 'taste.tools'],
  },
  {
    id: 'taste_medicine',
    kind: 'taste',
    label: 'ценит бинты',
    tags: ['trait.taste_medicine', 'taste.medicine'],
  },
  {
    id: 'taste_documents',
    kind: 'taste',
    label: 'копит справки',
    tags: ['trait.taste_documents', 'taste.documents'],
  },
  {
    id: 'quest_fetch',
    kind: 'quest_bias',
    label: 'просит принести',
    tags: ['trait.quest_fetch', 'quest.fetch'],
    questWeightBias: 1,
  },
  {
    id: 'quest_repair',
    kind: 'quest_bias',
    label: 'ищет ремонт',
    tags: ['trait.quest_repair', 'quest.repair'],
    questWeightBias: 2,
  },
  {
    id: 'quest_hunt',
    kind: 'quest_bias',
    label: 'гонит на зачистку',
    tags: ['trait.quest_hunt', 'quest.hunt'],
    questWeightBias: 1,
  },
  {
    id: 'quest_trade',
    kind: 'quest_bias',
    label: 'торгуется',
    tags: ['trait.quest_trade', 'quest.trade'],
  },
] as const;

const TRAIT_INDEX_BY_ID = new Map(DEMOS_TRAIT_DEFS.map((def, index) => [def.id, index + 1]));

export function demosTraitIndexById(id: string): number {
  return TRAIT_INDEX_BY_ID.get(id) ?? 0;
}

export function demosTraitByIndex(index: number): DemosTraitDef | undefined {
  if (!Number.isInteger(index) || index <= 0) return undefined;
  return DEMOS_TRAIT_DEFS[index - 1];
}

export function demosTraitsByKind(kind: DemosTraitKind): readonly DemosTraitDef[] {
  return DEMOS_TRAIT_DEFS.filter(def => def.kind === kind);
}

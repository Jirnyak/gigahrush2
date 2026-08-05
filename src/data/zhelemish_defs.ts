import { Faction, FloorLevel, RoomType } from '../core/types';

export type ZhelemishItemId = 'zhelemish_raw' | 'zhelemish_dried' | 'zhelemish_boiled';
export type ZhelemishForm = 'raw' | 'dried' | 'boiled';
export type ZhelemishChoice = 'eat_raw' | 'use_treated' | 'treat' | 'sell' | 'surrender' | 'burn';
export type ZhelemishTradeRole =
  | 'food'
  | 'medicine_counterfeit'
  | 'reagent'
  | 'cult_interest'
  | 'science_interest';

export interface ZhelemishDef {
  itemId: ZhelemishItemId;
  form: ZhelemishForm;
  name: string;
  tags: readonly string[];
  tradeRoles: readonly ZhelemishTradeRole[];
  preferredFactions: readonly Faction[];
  sourceFloors: readonly FloorLevel[];
  sourceRooms: readonly RoomType[];
  baseValue: number;
  choices: readonly ZhelemishChoice[];
  choiceHint: string;
  useHint: string;
  riskHint: string;
  questHooks: readonly string[];
}

const VALID_ZHELEMISH_CHOICES = new Set<ZhelemishChoice>(['eat_raw', 'use_treated', 'treat', 'sell', 'surrender', 'burn']);

export const ZHELEMISH_DEFS: readonly ZhelemishDef[] = [
  {
    itemId: 'zhelemish_raw',
    form: 'raw',
    name: 'Сырой желемыш',
    tags: ['zhelemish', 'raw', 'unsafe_use', 'folk_food', 'reagent', 'sample'],
    tradeRoles: ['food', 'reagent', 'science_interest', 'cult_interest'],
    preferredFactions: [Faction.SCIENTIST, Faction.CULTIST, Faction.WILD],
    sourceFloors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    sourceRooms: [RoomType.STORAGE, RoomType.BATHROOM],
    baseValue: 5,
    choices: ['eat_raw', 'treat', 'sell', 'surrender', 'burn'],
    choiceHint: 'Сырой комок: съесть от голода, отдать Мавре на варку, сдать Никите, продать Климу или сжечь мокрый угол.',
    useHint: 'Съесть только от голода; лучший сырой путь - свежая проба, варка или грязная продажа с последствиями.',
    riskHint: 'Сырой желемыш кормит, портит образец, сушит горло и даёт санитарный след при свидетелях.',
    questHooks: ['cellar_harvest', 'fresh_sample', 'surrender_sample', 'raw_sale', 'cult_argument'],
  },
  {
    itemId: 'zhelemish_dried',
    form: 'dried',
    name: 'Сушёный желемыш',
    tags: ['zhelemish', 'dried', 'safer_use', 'folk_food', 'bait', 'portable'],
    tradeRoles: ['food', 'reagent', 'cult_interest'],
    preferredFactions: [Faction.CITIZEN, Faction.CULTIST, Faction.WILD],
    sourceFloors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    sourceRooms: [RoomType.STORAGE, RoomType.KITCHEN],
    baseValue: 11,
    choices: ['use_treated', 'sell'],
    choiceHint: 'Сушёный: бедный сухпай для вылазки или дешёвая продажа тем, кто покупает не спрашивая пломбу.',
    useHint: 'Носить как бедный сухпай; пользоваться только понимая, что вода, ход и лечение станут хуже.',
    riskHint: 'Сушёный безопаснее сырого, но дублёная кожа всё равно оставляет запах беды и очередь держится дальше.',
    questHooks: ['ration_substitute', 'cult_bait', 'cellar_trade', 'expedition_food'],
  },
  {
    itemId: 'zhelemish_boiled',
    form: 'boiled',
    name: 'Варёный желемыш',
    tags: ['zhelemish', 'boiled', 'safer_use', 'medicine_counterfeit', 'ointment', 'trade'],
    tradeRoles: ['medicine_counterfeit', 'food', 'science_interest'],
    preferredFactions: [Faction.CITIZEN, Faction.SCIENTIST],
    sourceFloors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    sourceRooms: [RoomType.KITCHEN, RoomType.MEDICAL],
    baseValue: 16,
    choices: ['use_treated', 'sell'],
    choiceHint: 'Варёный: дешёвая припарка для себя или рискованная продажа как липовая медицина.',
    useHint: 'Использовать как дешёвую повязку-обманку, пока настоящей медицины нет, а воду ещё можно потерять.',
    riskHint: 'Варка снимает главный риск, но не делает это лекарством и не очищает продажу пациенту.',
    questHooks: ['fake_medpost', 'medicine_counterfeit', 'triage_shortage', 'nii_comparison'],
  },
];

export const ZHELEMISH_ITEM_IDS: readonly ZhelemishItemId[] = ZHELEMISH_DEFS.map(def => def.itemId);
export const ZHELEMISH_DEF_BY_ITEM_ID = Object.fromEntries(
  ZHELEMISH_DEFS.map(def => [def.itemId, def]),
) as Record<ZhelemishItemId, ZhelemishDef>;

function duplicateStrings(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

export function getZhelemishDef(itemId: string): ZhelemishDef | undefined {
  return ZHELEMISH_DEF_BY_ITEM_ID[itemId as ZhelemishItemId];
}

export function validateZhelemishDefs(): string[] {
  const problems: string[] = [];
  for (const id of duplicateStrings(ZHELEMISH_ITEM_IDS)) problems.push(`duplicate zhelemish item:${id}`);

  for (const def of ZHELEMISH_DEFS) {
    if (!def.tags.includes('zhelemish')) problems.push(`${def.itemId}:missing zhelemish tag`);
    if (!def.tags.includes(def.form)) problems.push(`${def.itemId}:missing form tag`);
    if (!Number.isInteger(def.baseValue) || def.baseValue < 1) problems.push(`${def.itemId}:baseValue:${def.baseValue}`);
    if (def.tradeRoles.length === 0) problems.push(`${def.itemId}:tradeRoles`);
    if (def.preferredFactions.length === 0) problems.push(`${def.itemId}:preferredFactions`);
    if (def.sourceFloors.length === 0) problems.push(`${def.itemId}:sourceFloors`);
    if (def.sourceRooms.length === 0) problems.push(`${def.itemId}:sourceRooms`);
    if (def.choices.length === 0) problems.push(`${def.itemId}:choices`);
    for (const choice of def.choices) {
      if (!VALID_ZHELEMISH_CHOICES.has(choice)) problems.push(`${def.itemId}:choice:${choice}`);
    }
    if (def.choiceHint.trim().length < 30) problems.push(`${def.itemId}:choiceHint`);
    if (def.useHint.trim().length < 20) problems.push(`${def.itemId}:useHint`);
    if (def.riskHint.trim().length < 20) problems.push(`${def.itemId}:riskHint`);
    if (def.questHooks.length === 0) problems.push(`${def.itemId}:questHooks`);
  }

  return problems;
}

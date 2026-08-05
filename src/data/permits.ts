import { Faction, FloorLevel, type WorldEventPrivacy, type WorldEventSeverity } from '../core/types';

export type PermitMethod = 'legal' | 'forged' | 'stolen' | 'debt' | 'expose';

export type PermitAccessTag =
  | 'ministry_n3'
  | 'general_admin'
  | 'archive'
  | 'raionsovet'
  | 'bank_debt'
  | 'bank_vault'
  | 'weapon_window'
  | 'elevator'
  | 'quarantine';

export interface PermitFactionCost {
  faction: Faction;
  delta: number;
}

export interface PermitDef {
  id: string;
  itemId: string;
  title: string;
  method: PermitMethod;
  official: boolean;
  accessTags: readonly PermitAccessTag[];
  floors: readonly FloorLevel[];
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  factionCost: readonly PermitFactionCost[];
  successLine: string;
  exposeLine?: string;
  rumorIds?: readonly string[];
}

export interface PermitForgeryRecipe {
  id: string;
  outputItemId: string;
  inputItemIds: readonly string[];
  label: string;
  eventTags: readonly string[];
  rumorIds: readonly string[];
}

export const PERMIT_DEFS: readonly PermitDef[] = [
  {
    id: 'ministry_official_slip',
    itemId: 'official_permit_slip',
    title: 'официальный корешок',
    method: 'legal',
    official: true,
    accessTags: ['ministry_n3', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 1 }],
    successLine: 'Официальный корешок принят: доступ выдан без лишней записи.',
    rumorIds: ['lead_ministry_permit_office_slip', 'ministry_document_gate_n3'],
  },
  {
    id: 'ministry_forged_slip',
    itemId: 'forged_permit_slip',
    title: 'поддельный корешок',
    method: 'forged',
    official: false,
    accessTags: ['ministry_n3', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.KVARTIRY],
    severity: 4,
    privacy: 'local',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: -2 }, { faction: Faction.WILD, delta: 1 }],
    successLine: 'Поддельный корешок сработал, но аудит получил слишком ровную строку.',
    exposeLine: 'Поддельный корешок всплыл в журнале доступа.',
    rumorIds: ['player_forged_stamp_risk', 'ministry_document_gate_n3'],
  },
  {
    id: 'fake_pass',
    itemId: 'fake_pass',
    title: 'фальшивый пропуск',
    method: 'forged',
    official: false,
    accessTags: ['ministry_n3', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.KVARTIRY],
    severity: 4,
    privacy: 'local',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: -1 }, { faction: Faction.WILD, delta: 1 }],
    successLine: 'Фальшивый пропуск совпал цветом с чужой ошибкой.',
    exposeLine: 'Фальшивый пропуск записали как повод для проверки.',
    rumorIds: ['player_forged_stamp_risk'],
  },
  {
    id: 'archive_official',
    itemId: 'archive_access_permit',
    title: 'архивный допуск',
    method: 'legal',
    official: true,
    accessTags: ['archive', 'raionsovet', 'ministry_n3'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 1 }],
    successLine: 'Архивный допуск признан: картотека уступила проход.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'archive_stolen_card',
    itemId: 'stolen_archive_card',
    title: 'краденая архивная карточка',
    method: 'stolen',
    official: false,
    accessTags: ['archive', 'raionsovet', 'ministry_n3'],
    floors: [FloorLevel.MINISTRY],
    severity: 4,
    privacy: 'witnessed',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: 1 }, { faction: Faction.WILD, delta: -1 }],
    successLine: 'Краденая карточка открыла доступ чужим делом.',
    exposeLine: 'Краденую карточку сдали как улику.',
    rumorIds: ['player_stole_archive_card', 'ministry_document_gate_n3'],
  },
  {
    id: 'raionsovet_floor_pass',
    itemId: 'raionsovet_floor_pass',
    title: 'пропуск райсовета',
    method: 'legal',
    official: true,
    accessTags: ['raionsovet', 'archive', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 1 }],
    successLine: 'Райсоветский пропуск принят: архивная линия стала короче.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'raionsovet_forged_pass',
    itemId: 'forged_raionsovet_pass',
    title: 'липовый пропуск райсовета',
    method: 'forged',
    official: false,
    accessTags: ['raionsovet', 'archive', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING],
    severity: 4,
    privacy: 'local',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: -2 }, { faction: Faction.WILD, delta: 1 }],
    successLine: 'Липовый пропуск райсовета прошел, но оставил кривую тень в журнале.',
    exposeLine: 'Липовый пропуск райсовета показали как подделку.',
    rumorIds: ['player_forged_stamp_risk'],
  },
  {
    id: 'bank_debt_paper',
    itemId: 'bank_debt_paper',
    title: 'долговая бумага банка',
    method: 'debt',
    official: true,
    accessTags: ['bank_debt', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 1 }, { faction: Faction.WILD, delta: -1 }],
    successLine: 'Долговая бумага принята как маршрут через окно учета.',
    rumorIds: ['smoking_debt_notebook', 'floor69_market88_line'],
  },
  {
    id: 'bank_forged_debt_paper',
    itemId: 'forged_bank_debt_paper',
    title: 'липовая долговая бумага',
    method: 'forged',
    official: false,
    accessTags: ['bank_debt', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING],
    severity: 5,
    privacy: 'witnessed',
    factionCost: [{ faction: Faction.CITIZEN, delta: -2 }, { faction: Faction.WILD, delta: 2 }],
    successLine: 'Липовая долговая бумага сработала как чужая строка.',
    exposeLine: 'Липовую долговую бумагу сдали до обналичивания.',
    rumorIds: ['smoking_debt_notebook', 'player_forged_stamp_risk'],
  },
  {
    id: 'bank_debt_settled',
    itemId: 'debt_settlement_receipt',
    title: 'квитанция о погашении',
    method: 'legal',
    official: true,
    accessTags: ['bank_debt', 'bank_vault', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 2 }],
    successLine: 'Квитанция о погашении закрыла долг и открыла служебную строку.',
    rumorIds: ['floor69_market88_line'],
  },
  {
    id: 'liquidator_confiscation_warrant',
    itemId: 'confiscation_warrant',
    title: 'ордер на изъятие',
    method: 'expose',
    official: true,
    accessTags: ['bank_vault', 'archive', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 4,
    privacy: 'witnessed',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: 2 }, { faction: Faction.WILD, delta: -2 }],
    successLine: 'Ордер на изъятие заставил сейф признать проверку.',
    exposeLine: 'Ордером закрыли чужой доступ и подняли ревизию.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'liquidator_cleanup_order_stub',
    itemId: 'cleanup_order_stub',
    title: 'корешок приказа на зачистку',
    method: 'expose',
    official: true,
    accessTags: ['archive', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 4,
    privacy: 'witnessed',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: 1 }, { faction: Faction.WILD, delta: -1 }],
    successLine: 'Корешок приказа признал зачистку основанием для изъятия.',
    exposeLine: 'Корешок сдали как след незаконной зачистки.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'weapon_permit_signed',
    itemId: 'weapon_permit_signed',
    title: 'оружейное разрешение',
    method: 'legal',
    official: true,
    accessTags: ['weapon_window', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    successLine: 'Оружейное разрешение принято без конфискации.',
    rumorIds: ['rare_weapon_permit_signed'],
  },
  {
    id: 'weapon_permit_forged',
    itemId: 'weapon_permit_forged',
    title: 'поддельное оружейное разрешение',
    method: 'forged',
    official: false,
    accessTags: ['weapon_window', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 4,
    privacy: 'local',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: -2 }, { faction: Faction.WILD, delta: 1 }],
    successLine: 'Поддельное оружейное разрешение прошло, но оставило повод для обыска.',
    exposeLine: 'Поддельное оружейное разрешение сдали ликвидаторам.',
    rumorIds: ['container_weapon_permit_audit'],
  },
  {
    id: 'elevator_access_order',
    itemId: 'elevator_access_order',
    title: 'лифтовой приказ допуска',
    method: 'legal',
    official: true,
    accessTags: ['elevator', 'ministry_n3', 'general_admin'],
    floors: [FloorLevel.MINISTRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.CITIZEN, delta: 1 }],
    successLine: 'Лифтовой приказ признан как служебный доступ.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'quarantine_clearance',
    itemId: 'official_quarantine_clearance',
    title: 'карантинный допуск',
    method: 'legal',
    official: true,
    accessTags: ['quarantine', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY],
    severity: 3,
    privacy: 'private',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    successLine: 'Карантинный допуск принят санитарным журналом.',
    rumorIds: ['ministry_document_gate_n3'],
  },
  {
    id: 'quarantine_forged_clearance',
    itemId: 'forged_quarantine_clearance',
    title: 'поддельный карантинный допуск',
    method: 'forged',
    official: false,
    accessTags: ['quarantine', 'general_admin'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY],
    severity: 4,
    privacy: 'local',
    factionCost: [{ faction: Faction.LIQUIDATOR, delta: -2 }, { faction: Faction.WILD, delta: 1 }],
    successLine: 'Поддельный карантинный допуск прошел через слабую смену.',
    exposeLine: 'Поддельный карантинный допуск ушел в санитарный акт.',
    rumorIds: ['player_forged_stamp_risk'],
  },
];

export const PERMIT_FORGERY_RECIPES: readonly PermitForgeryRecipe[] = [
  {
    id: 'forge_ministry_slip',
    outputItemId: 'forged_permit_slip',
    inputItemIds: ['forged_stamp_sheet', 'blank_form', 'ink_bottle'],
    label: 'поддельный корешок',
    eventTags: ['forgery', 'permit_forged', 'audit_risk'],
    rumorIds: ['player_forged_stamp_risk', 'rare_forged_permit_slip'],
  },
  {
    id: 'forge_raionsovet_pass',
    outputItemId: 'forged_raionsovet_pass',
    inputItemIds: ['raionsovet_floor_pass', 'forged_stamp_sheet', 'ink_bottle'],
    label: 'липовый пропуск райсовета',
    eventTags: ['forgery', 'permit_forged', 'raionsovet', 'audit_risk'],
    rumorIds: ['player_forged_stamp_risk'],
  },
  {
    id: 'forge_bank_debt_paper',
    outputItemId: 'forged_bank_debt_paper',
    inputItemIds: ['bank_debt_paper', 'forged_stamp_sheet', 'ink_bottle'],
    label: 'липовая долговая бумага',
    eventTags: ['forgery', 'permit_forged', 'banking', 'debt_paper'],
    rumorIds: ['smoking_debt_notebook', 'player_forged_stamp_risk'],
  },
];

const PERMIT_BY_ITEM = new Map(PERMIT_DEFS.map(def => [def.itemId, def]));
const FORGERY_RECIPE_BY_OUTPUT = new Map(PERMIT_FORGERY_RECIPES.map(recipe => [recipe.outputItemId, recipe]));

export function getPermitDef(itemId: string): PermitDef | undefined {
  return PERMIT_BY_ITEM.get(itemId);
}

export function isPermitItem(itemId: string): boolean {
  return PERMIT_BY_ITEM.has(itemId);
}

export function getPermitForgeryRecipe(outputItemId: string): PermitForgeryRecipe | undefined {
  return FORGERY_RECIPE_BY_OUTPUT.get(outputItemId);
}

export function permitDefsForAccessTag(tag: PermitAccessTag): readonly PermitDef[] {
  return PERMIT_DEFS.filter(def => def.accessTags.includes(tag));
}

function permitScore(def: PermitDef): number {
  if (def.official) return 100;
  if (def.method === 'expose') return 90;
  if (def.method === 'debt') return 80;
  if (def.method === 'stolen') return 50;
  return 40;
}

export function resolvePermitAccess(
  itemIds: readonly string[],
  tags: readonly PermitAccessTag[],
): PermitDef | undefined {
  let best: PermitDef | undefined;
  let bestScore = -1;
  for (const itemId of itemIds) {
    const def = getPermitDef(itemId);
    if (!def) continue;
    if (!tags.some(tag => def.accessTags.includes(tag))) continue;
    const score = permitScore(def);
    if (score > bestScore) {
      best = def;
      bestScore = score;
    }
  }
  return best;
}

export function permitAccessTagsFromContainerTags(tags: readonly string[]): PermitAccessTag[] {
  const out: PermitAccessTag[] = [];
  function add(tag: PermitAccessTag): void {
    if (!out.includes(tag)) out.push(tag);
  }
  if (tags.includes('quarantine')) add('quarantine');
  if (tags.includes('weapon') || tags.includes('weapon_permit') || tags.includes('ammo')) add('weapon_window');
  if (tags.includes('elevator') || tags.includes('route_permit')) add('elevator');
  if (tags.includes('archive') || tags.includes('apartment_rights') || tags.includes('personal_file')) add('archive');
  if (tags.includes('raionsovet')) add('raionsovet');
  if (tags.includes('debt') || tags.includes('debt_paper') || tags.includes('credit')) add('bank_debt');
  if (tags.includes('vault') || tags.includes('safe') || tags.includes('liquidator_audit')) add('bank_vault');
  if (tags.includes('paper') || tags.includes('permit') || tags.includes('document')) add('general_admin');
  return out;
}

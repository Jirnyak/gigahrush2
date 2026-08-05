import { ItemType, type Item, type ItemDef } from '../core/types';

export const CHERNOBOG_DOCKET_CORE_TAGS = ['evidence', 'cult', 'archive', 'chernobog', 'witness'] as const;

export const CHERNOBOG_DOCKET_ITEMS: Record<string, ItemDef> = {
  chernobog_cell_map: {
    id: 'chernobog_cell_map',
    name: 'Схема ячеек ЧБ-0',
    type: ItemType.MISC,
    desc: 'Карта центральной и внешней ячеек. Пустые адреса отмечены пустыми; рядом вписаны свидетели и время обхода.',
    spawnRooms: [],
    spawnW: 0,
    value: 180,
  },
  chernobog_witness_correction: {
    id: 'chernobog_witness_correction',
    name: 'Правка показаний ЧБ',
    type: ItemType.MISC,
    desc: 'Форма заменяет "видел" на "предположил". Поле для дрожи не предусмотрено.',
    spawnRooms: [],
    spawnW: 0,
    value: 120,
  },
  chernobog_confiscation_act: {
    id: 'chernobog_confiscation_act',
    name: 'Акт изъятия черной ладони',
    type: ItemType.MISC,
    desc: 'Изъят предмет: дощечка с черной ладонью. Свидетель записан в приложение Б.',
    spawnRooms: [],
    spawnW: 0,
    value: 150,
  },
  chernobog_liquidator_memo: {
    id: 'chernobog_liquidator_memo',
    name: 'Памятка ликвидатора ЧБ',
    type: ItemType.MISC,
    desc: 'Приказ различать культ, очередь и совпадение. Подписант оставил только номер.',
    spawnRooms: [],
    spawnW: 0,
    value: 160,
  },
  chernobog_redacted_central_note: {
    id: 'chernobog_redacted_central_note',
    name: 'Редакция центральной записки',
    type: ItemType.MISC,
    desc: 'Черные прямоугольники держатся крепче печати. Видно: "центр", "внешние", "не подтверждать".',
    spawnRooms: [],
    spawnW: 0,
    value: 240,
  },
  chernobog_external_cell_index: {
    id: 'chernobog_external_cell_index',
    name: 'Индекс внешней ячейки',
    type: ItemType.MISC,
    desc: 'Список жильцов с графой "не культ". У половины графа заполнена чужим почерком.',
    spawnRooms: [],
    spawnW: 0,
    value: 130,
  },
};

export const CHERNOBOG_DOCKET_ITEM_TAGS: Record<string, readonly string[]> = Object.fromEntries(
  Object.keys(CHERNOBOG_DOCKET_ITEMS).map(id => [id, CHERNOBOG_DOCKET_CORE_TAGS]),
);

export const CHERNOBOG_DOCKET_NOTES = [
  'Форма ЧБ-0: центральная ячейка не установлена. Внешние адреса после отбоя не обходить без ликвидатора и второго свидетеля.',
  'Свидетель исправлен: видел не культ, а совпадение жильцов с одинаковой черной ладонью.',
  'Акт изъятия: предмет холодный, молитвой не является, но очередь перед ним ведет себя организованно.',
  'Памятка Л-47: если адрес повторяется в трех делах, зачистить адрес, не вопрос.',
  'Красные вымарывания оставлены для спокойствия комиссии. Комиссия спокойствия не проявила.',
  'Индекс внешней ячейки хранить сухо. При намокании фамилии расплываются; спорные строки переписать в графу "свидетель" по акту.',
] as const;

export function chernobogDocketGateItems(): Item[] {
  return [
    { defId: 'chernobog_cell_map', count: 1 },
    { defId: 'chernobog_witness_correction', count: 1 },
  ];
}

const CHERNOBOG_DOCKET_ITEM_IDS = new Set(Object.keys(CHERNOBOG_DOCKET_ITEMS));

export function isChernobogDocketItem(itemId: string | undefined): boolean {
  return itemId !== undefined && CHERNOBOG_DOCKET_ITEM_IDS.has(itemId);
}

const QUEST_RUMORS: Record<string, { tag: string; rumor: string }> = {
  chernobog_submit_cell_map: { tag: 'submit', rumor: 'event_chernobog_docket_submitted' },
  chernobog_forge_witness_correction: { tag: 'forge', rumor: 'event_chernobog_docket_forged' },
  chernobog_sell_confiscation_act: { tag: 'sell', rumor: 'event_chernobog_docket_sold' },
  chernobog_hide_external_index: { tag: 'hide', rumor: 'event_chernobog_docket_hidden' },
  chernobog_show_liquidator_memo: { tag: 'liquidator', rumor: 'event_chernobog_docket_liquidator' },
  chernobog_show_cult_contact: { tag: 'cult_contact', rumor: 'event_chernobog_docket_cult' },
  chernobog_show_yakov_redaction: { tag: 'yakov', rumor: 'event_chernobog_docket_yakov' },
};

export function chernobogDocketQuestEventTags(sideQuestId: string | undefined, itemId: string | undefined): string[] {
  const action = sideQuestId ? QUEST_RUMORS[sideQuestId] : undefined;
  if (!action && !isChernobogDocketItem(itemId)) return [];
  return action ? [...CHERNOBOG_DOCKET_CORE_TAGS, action.tag] : [...CHERNOBOG_DOCKET_CORE_TAGS];
}

export function chernobogDocketQuestRumorIds(sideQuestId: string | undefined, itemId: string | undefined): string[] {
  const action = sideQuestId ? QUEST_RUMORS[sideQuestId] : undefined;
  if (action) return [action.rumor];
  return isChernobogDocketItem(itemId) ? ['lead_ministry_chernobog_docket'] : [];
}

export function chernobogDocketContainerEventTags(tags: readonly string[], itemId: string | undefined): string[] {
  if (!tags.includes('chernobog') && !isChernobogDocketItem(itemId)) return [];
  return [...CHERNOBOG_DOCKET_CORE_TAGS];
}

export function chernobogDocketContainerRumorIds(tags: readonly string[], itemId: string | undefined): string[] {
  if (!tags.includes('chernobog') && !isChernobogDocketItem(itemId)) return [];
  return ['lead_ministry_chernobog_docket'];
}

export function chernobogDocketItemRumorId(itemId: string | undefined): string | undefined {
  return isChernobogDocketItem(itemId) ? 'lead_ministry_chernobog_docket' : undefined;
}

import { Faction, Occupation, type Entity } from '../core/types';
import { occupationIdsWithCraftTag } from './occupation_profiles';

export type CraftRecipeSourceKind = 'item' | 'note' | 'quest' | 'terminal' | 'npc' | 'floor';

export interface CraftRecipeSourceDef {
  id: string;
  kind: CraftRecipeSourceKind;
  recipeIds: readonly string[];
  itemId?: string;
  questId?: string;
  terminalId?: string;
  npcId?: string;
  floorId?: string;
  interactiveDefId?: string;
  text: string;
  tags: readonly string[];
  /** Single-use papers are spent only after at least one new recipe is learned. */
  consume?: boolean;
  npcOccupations?: readonly Occupation[];
  npcFactions?: readonly Faction[];
}

export interface CraftRecipeSourceNoteData {
  text?: string;
  craftRecipeSourceId?: string;
  recipeSourceId?: string;
}

export interface CraftRecipeSourceApplyResult {
  source: CraftRecipeSourceDef;
  learnedRecipeIds: string[];
  alreadyKnownRecipeIds: string[];
  failedRecipeIds: string[];
}

export const CRAFT_ITEM_RECIPE_PREFIX = 'craft_item_';

export function craftRecipeIdForItem(itemId: string): string {
  return `${CRAFT_ITEM_RECIPE_PREFIX}${itemId}`;
}

const r = craftRecipeIdForItem;

export const CRAFT_RECIPE_SOURCES: readonly CraftRecipeSourceDef[] = [
  {
    id: 'item_blueprint_t1_folder',
    kind: 'item',
    itemId: 'blueprint_t1_folder',
    consume: true,
    recipeIds: [r('duct_tape'), r('fuse'), r('door_kit'), r('flashlight')],
    text: 'Папка Т1: простые схемы для полки, света и двери.',
    tags: ['blueprint', 'tier1', 'workbench', 'common'],
  },
  {
    id: 'item_blueprint_t2_folder',
    kind: 'item',
    itemId: 'blueprint_t2_folder',
    consume: true,
    recipeIds: [r('circuit_board'), r('fog_detector'), r('unpeople_detector'), r('water_filter_regulator')],
    text: 'Папка Т2: приборы, фильтр и мокрая электроника.',
    tags: ['blueprint', 'tier2', 'electronics', 'lab'],
  },
  {
    id: 'item_blueprint_t3_folder',
    kind: 'item',
    itemId: 'blueprint_t3_folder',
    consume: true,
    recipeIds: [r('psi_stabilizer'), r('ammo_energy'), r('radio_headset_liquidator'), r('gravity_beam_emitter')],
    text: 'Папка Т3: глубокие схемы, которые лучше читать при закрытой двери.',
    tags: ['blueprint', 'tier3', 'deep_route', 'energy'],
  },
  {
    id: 'item_weapon_blueprint_t2',
    kind: 'item',
    itemId: 'weapon_blueprint_t2',
    consume: true,
    recipeIds: [r('chizh3_shotgun'), r('breach_charge'), r('ammo_12g_chemical')],
    text: 'Оружейная схема: ствол, заряд и химическая дробь.',
    tags: ['blueprint', 'tier2', 'weapon', 'liquidator'],
  },
  {
    id: 'item_homemade_ammo_instruction',
    kind: 'item',
    itemId: 'homemade_ammo_instruction',
    consume: false,
    recipeIds: [r('homemade_9mm'), r('ammo_9mm'), r('homemade_pistol')],
    text: 'Инструкция по кустарным патронам: грязно, но работает.',
    tags: ['instruction', 'ammo', 'homemade', 'black_market'],
  },
  {
    id: 'item_track_diagram_scrap',
    kind: 'item',
    itemId: 'track_diagram_scrap',
    consume: false,
    recipeIds: [r('rail_signal_lamp'), r('rail_spike_pack'), r('track_diagram_scrap')],
    text: 'Обрывок депо: рельсовая мелочь и сигнальная лампа.',
    tags: ['rail', 'route', 'tier2', 'document'],
  },
  {
    id: 'item_frozen_item_shard',
    kind: 'item',
    itemId: 'frozen_item_shard',
    consume: true,
    recipeIds: [r('frozen_slime_core'), r('psi_phase')],
    text: 'Осколок оттаял в схему: холодная проба и фазовый след.',
    tags: ['frozen', 'anomaly', 'tier3', 'psi'],
  },
  {
    id: 'item_junior_tech_case',
    kind: 'item',
    itemId: 'junior_tech_case',
    consume: false,
    recipeIds: [r('sound_emitter'), r('radio_jammer')],
    text: 'Корпус показывает, куда ставить пищалку и глушилку.',
    tags: ['electronics', 'tier1', 'case'],
  },
  {
    id: 'item_relay_diagram',
    kind: 'item',
    itemId: 'relay_diagram',
    consume: true,
    recipeIds: [r('wire_coil'), r('rail_signal_lamp'), r('relay_diagram')],
    text: 'Схема реле: провод, сигнальная лампа и порядок контактов.',
    tags: ['electronics', 'relay', 'maintenance'],
  },
  {
    id: 'note_workbench_basics',
    kind: 'note',
    recipeIds: [r('duct_tape'), r('wire_coil')],
    text: 'Записка верстака: трубу режь ровно, изоленту не жалей.',
    tags: ['note', 'tier0', 'workbench'],
  },
  {
    id: 'note_medpost_bandage_sheet',
    kind: 'note',
    recipeIds: [r('bandage'), r('sterile_bandage')],
    text: 'Памятка медпункта: бинт сухой, руки чистые, спор потом.',
    tags: ['note', 'tier1', 'medicine'],
  },
  {
    id: 'quest_barni_range_cleanup',
    kind: 'quest',
    questId: 'plot:1',
    recipeIds: [r('homemade_9mm')],
    text: 'Сержант Баринов показал, как перебрать кустарный 9мм без лишней гордости.',
    tags: ['quest', 'plot', 'barni', 'ammo'],
  },
  {
    id: 'quest_yakov_field_lab',
    kind: 'quest',
    questId: 'plot:7',
    recipeIds: [r('psi_stabilizer')],
    text: 'Яков оставил сухую лабораторную схему стабилизатора.',
    tags: ['quest', 'plot', 'yakov', 'psi'],
  },
  {
    id: 'quest_idol_ministry_registration',
    kind: 'quest',
    questId: 'idol_ministry_registration',
    recipeIds: [r('blank_form'), r('seal_wax')],
    text: 'Министерское окно показало, как не испортить бланк и сургуч.',
    tags: ['quest', 'ministry', 'document'],
  },
  {
    id: 'quest_idol_liquidator_field_report',
    kind: 'quest',
    questId: 'idol_liquidator_field_report',
    recipeIds: [r('ammo_9mm'), r('gasmask_filter')],
    text: 'Ликвидаторы показали полевой порядок: патрон отдельно, фильтр сухим.',
    tags: ['quest', 'liquidator', 'ammo', 'filter'],
  },
  {
    id: 'quest_idol_hell_contact_handoff',
    kind: 'quest',
    questId: 'idol_hell_contact_handoff',
    recipeIds: [r('holy_water'), r('meat_rune')],
    text: 'Никанор объяснил, где вода, а где мясная руна.',
    tags: ['quest', 'hell', 'cult', 'tier3'],
  },
  {
    id: 'npc_mechanic_tool_lesson',
    kind: 'npc',
    npcOccupations: occupationIdsWithCraftTag('mechanic_lesson'),
    recipeIds: [r('wrench'), r('fuse'), r('door_kit')],
    text: 'Слесарь показывает одну рабочую схему из своей практики.',
    tags: ['npc', 'mechanic', 'tier1', 'workbench'],
  },
  {
    id: 'npc_scientist_lab_lesson',
    kind: 'npc',
    npcOccupations: occupationIdsWithCraftTag('lab_lesson'),
    recipeIds: [r('empty_sample_jar'), r('sterile_swab'), r('psi_stabilizer')],
    text: 'Лаборатория учит одной схеме: аккуратно, без лишней поэзии.',
    tags: ['npc', 'scientist', 'lab', 'psi'],
  },
  {
    id: 'npc_liquidator_ammo_lesson',
    kind: 'npc',
    npcFactions: [Faction.LIQUIDATOR],
    recipeIds: [r('gasmask_filter'), r('ammo_9mm'), r('breach_charge')],
    text: 'Ликвидатор коротко объясняет одну полевую схему.',
    tags: ['npc', 'liquidator', 'field', 'ammo'],
  },
  {
    id: 'npc_black_market_weapon_lesson',
    kind: 'npc',
    npcOccupations: occupationIdsWithCraftTag('market_lesson'),
    recipeIds: [r('homemade_9mm'), r('radio_jammer'), r('homemade_pistol')],
    text: 'Кладовщик шепчет одну рыночную схему без расписки.',
    tags: ['npc', 'black_market', 'homemade', 'contraband'],
  },
  {
    id: 'terminal_floor_archive_scrap_schemes',
    kind: 'terminal',
    terminalId: 'floor_archive',
    recipeIds: [r('track_diagram_scrap'), r('relay_diagram'), r('chalk'), r('lift_scheme')],
    text: 'Архив выдал схемы маршрута, мела и рельсового обрывка.',
    tags: ['terminal', 'archive', 'route', 'offline'],
  },
  {
    id: 'terminal_dispatch_net_relay',
    kind: 'terminal',
    terminalId: 'dispatch_terminal',
    recipeIds: [r('relay_diagram'), r('circuit_board'), r('field_radio_battery')],
    text: 'Диспетчерский кэш отдал релейную схему, плату и батарею.',
    tags: ['terminal', 'dispatch', 'electronics', 'offline'],
  },
  {
    id: 'floor_recipe_billboard_basics',
    kind: 'floor',
    floorId: 'story:living',
    interactiveDefId: 'recipe_billboard',
    recipeIds: [r('duct_tape'), r('wire_coil'), r('fuse')],
    text: 'Доска верстака: изолента, провод и предохранитель идут первыми.',
    tags: ['floor', 'billboard', 'tier0', 'workbench'],
  },
] as const;

const SOURCES_BY_ID = new Map(CRAFT_RECIPE_SOURCES.map(source => [source.id, source] as const));

for (const source of CRAFT_RECIPE_SOURCES) {
  if (!source.id || source.id.trim() !== source.id) throw new Error(`[CRAFT_RECIPE_SOURCE] invalid id "${source.id}"`);
  if (SOURCES_BY_ID.get(source.id) !== source) throw new Error(`[CRAFT_RECIPE_SOURCE] duplicate id "${source.id}"`);
  if (source.recipeIds.length === 0) throw new Error(`[CRAFT_RECIPE_SOURCE] ${source.id} has no recipes`);
}

export function allCraftRecipeSources(): readonly CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES;
}

export function getCraftRecipeSource(id: string | undefined): CraftRecipeSourceDef | undefined {
  return id ? SOURCES_BY_ID.get(id) : undefined;
}

export function craftRecipeSourcesByKind(kind: CraftRecipeSourceKind): CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES.filter(source => source.kind === kind);
}

export function craftRecipeSourcesForItem(itemId: string): CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES.filter(source => source.kind === 'item' && source.itemId === itemId);
}

export function craftRecipeSourcesForQuest(questId: string | undefined): CraftRecipeSourceDef[] {
  if (!questId) return [];
  return CRAFT_RECIPE_SOURCES.filter(source => source.kind === 'quest' && source.questId === questId);
}

export function craftRecipeSourcesForTerminal(terminalId: string): CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES.filter(source => source.kind === 'terminal' && source.terminalId === terminalId);
}

export function craftRecipeSourcesForFloor(floorId: string): CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES.filter(source => source.kind === 'floor' && source.floorId === floorId);
}

export function craftRecipeSourcesForNpc(npc: Pick<Entity, 'plotNpcId' | 'occupation' | 'faction'>): CraftRecipeSourceDef[] {
  return CRAFT_RECIPE_SOURCES.filter(source => {
    if (source.kind !== 'npc') return false;
    if (source.npcId !== undefined && source.npcId !== npc.plotNpcId) return false;
    if (source.npcOccupations !== undefined && (npc.occupation === undefined || !source.npcOccupations.includes(npc.occupation))) return false;
    if (source.npcFactions !== undefined && (npc.faction === undefined || !source.npcFactions.includes(npc.faction))) return false;
    return source.npcId !== undefined || source.npcOccupations !== undefined || source.npcFactions !== undefined;
  });
}

export function craftRecipeSourceIdFromNoteData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as CraftRecipeSourceNoteData;
  const id = record.craftRecipeSourceId ?? record.recipeSourceId;
  return typeof id === 'string' && id.trim() === id && id ? id : undefined;
}

export function craftRecipeSourceConsumesItem(source: CraftRecipeSourceDef): boolean {
  return source.consume === true || source.tags.includes('consume_item');
}

export function craftRecipeSourcePassesThroughItemUse(source: CraftRecipeSourceDef): boolean {
  return source.tags.includes('pass_through_item_use');
}

export function craftRecipeNoteData(sourceId: string, text?: string): CraftRecipeSourceNoteData {
  const source = getCraftRecipeSource(sourceId);
  return {
    craftRecipeSourceId: sourceId,
    text: text ?? source?.text,
  };
}

export function craftRecipeNoteText(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return undefined;
  const text = (data as CraftRecipeSourceNoteData).text;
  return typeof text === 'string' && text ? text : undefined;
}

export function craftRecipeItemId(recipeId: string): string | undefined {
  return recipeId.startsWith(CRAFT_ITEM_RECIPE_PREFIX) ? recipeId.slice(CRAFT_ITEM_RECIPE_PREFIX.length) : undefined;
}

export function craftRecipeSourceHasUnknownRecipe(
  source: CraftRecipeSourceDef,
  known: (recipeId: string) => boolean,
): boolean {
  return source.recipeIds.some(recipeId => !known(recipeId));
}

export function applyCraftRecipeSource(
  source: CraftRecipeSourceDef,
  learn: (recipeId: string, sourceId: string) => boolean,
  known?: (recipeId: string) => boolean,
): CraftRecipeSourceApplyResult {
  const learnedRecipeIds: string[] = [];
  const alreadyKnownRecipeIds: string[] = [];
  const failedRecipeIds: string[] = [];

  for (const recipeId of source.recipeIds) {
    if (known?.(recipeId)) {
      alreadyKnownRecipeIds.push(recipeId);
      continue;
    }
    if (learn(recipeId, source.id)) {
      learnedRecipeIds.push(recipeId);
    } else if (known?.(recipeId)) {
      alreadyKnownRecipeIds.push(recipeId);
    } else {
      failedRecipeIds.push(recipeId);
    }
  }

  return { source, learnedRecipeIds, alreadyKnownRecipeIds, failedRecipeIds };
}

export function craftRecipeSourceCountsByKind(): Record<CraftRecipeSourceKind, number> {
  return {
    item: craftRecipeSourcesByKind('item').length,
    note: craftRecipeSourcesByKind('note').length,
    quest: craftRecipeSourcesByKind('quest').length,
    terminal: craftRecipeSourcesByKind('terminal').length,
    npc: craftRecipeSourcesByKind('npc').length,
    floor: craftRecipeSourcesByKind('floor').length,
  };
}

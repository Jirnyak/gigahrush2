import { Faction, Occupation, RoomType, type ContainerAccess } from '../core/types';
import { RESOURCE_BY_ID, resourceForItem } from './resources';

export interface ResourceStack {
  id: string;
  count: number;
}

export interface ItemStackDef {
  defId: string;
  count: number;
}

export interface FactoryBadBatchDef {
  everyCycles: number;
  outputs: ItemStackDef[];
  jammedCycleSec: number;
  repairItems: ItemStackDef[];
  repairOutputs?: ItemStackDef[];
  eventTags?: string[];
}

export interface FactoryRecipeDef {
  id: string;
  name: string;
  inputs: ResourceStack[];
  inputItems?: ItemStackDef[];
  outputs: ItemStackDef[];
  outputTags: string[];
  outputAccess?: ContainerAccess;
  cycleSec: number;
  maxOutputItemCount?: number;
  eventTags?: string[];
  badBatch?: FactoryBadBatchDef;
}

export interface FactoryDef {
  id: string;
  name: string;
  roomTypes: RoomType[];
  roomNameHints: string[];
  workerOccupations: Occupation[];
  ownerFaction?: Faction;
  outputTags: string[];
  recipes: FactoryRecipeDef[];
}

export type ProductionRouteGoal = 'visit' | 'guard' | 'steal' | 'repair';

function addUnique<T>(out: T[], value: T | undefined): void {
  if (value !== undefined && !out.includes(value)) out.push(value);
}

function factoryRecipeTags(factory: FactoryDef, recipe: FactoryRecipeDef): string[] {
  const out: string[] = [];
  for (const tag of [...factory.outputTags, ...recipe.outputTags, ...(recipe.eventTags ?? [])]) {
    addUnique(out, tag);
  }
  return out;
}

export function productionItemRewardTag(defId: string): string {
  return `prod_item_${defId}`;
}

export function productionResourceRewardTag(resourceId: string): string {
  return `prod_res_${resourceId}`;
}

export function productionRouteGoalTags(factory: FactoryDef, recipe: FactoryRecipeDef): string[] {
  return productionRouteGoals(factory, recipe).map(goal => `prod_goal_${goal}`);
}

export function productionOutputResourceIds(factory: FactoryDef, recipe: FactoryRecipeDef): string[] {
  const out: string[] = [];
  for (const output of recipe.outputs) addUnique(out, resourceForItem(output.defId)?.id);
  for (const tag of factoryRecipeTags(factory, recipe)) {
    if (RESOURCE_BY_ID[tag]) addUnique(out, tag);
  }
  return out;
}

export function productionRewardTargetTags(factory: FactoryDef, recipe: FactoryRecipeDef): string[] {
  const tags: string[] = [];
  for (const output of recipe.outputs) addUnique(tags, productionItemRewardTag(output.defId));
  for (const resourceId of productionOutputResourceIds(factory, recipe)) addUnique(tags, productionResourceRewardTag(resourceId));
  for (const tag of productionRouteGoalTags(factory, recipe)) addUnique(tags, tag);
  return tags;
}

export function productionRouteGoals(factory: FactoryDef, recipe: FactoryRecipeDef): ProductionRouteGoal[] {
  const tags = factoryRecipeTags(factory, recipe);
  const goals: ProductionRouteGoal[] = [];
  if (recipe.outputAccess === 'public' || tags.includes('public')) addUnique(goals, 'visit');
  if (
    factory.ownerFaction !== undefined
    || recipe.outputAccess === 'faction'
    || recipe.outputAccess === 'owner'
    || recipe.outputAccess === 'locked'
    || tags.includes('faction')
    || tags.includes('locked')
  ) addUnique(goals, 'guard');
  if (
    recipe.outputAccess === 'faction'
    || recipe.outputAccess === 'owner'
    || recipe.outputAccess === 'locked'
    || recipe.outputAccess === 'secret'
    || tags.includes('illegal')
    || tags.includes('weapon')
    || tags.includes('ammo')
    || tags.includes('contested_output')
  ) addUnique(goals, 'steal');
  if (
    (recipe.inputItems?.length ?? 0) > 0
    || recipe.badBatch !== undefined
    || tags.includes('repair')
    || tags.includes('repair_input')
    || tags.includes('limited_output')
  ) addUnique(goals, 'repair');
  if (goals.length === 0) addUnique(goals, 'visit');
  return goals;
}

export function productionRecipeImportant(factory: FactoryDef, recipe: FactoryRecipeDef): boolean {
  if (productionRouteGoals(factory, recipe).some(goal => goal !== 'visit')) return true;
  if ((recipe.eventTags?.length ?? 0) > 0 || recipe.maxOutputItemCount !== undefined) return true;
  const tags = factoryRecipeTags(factory, recipe);
  return tags.some(tag =>
    tag === 'medical'
    || tag === 'weapon'
    || tag === 'ammo'
    || tag === 'illegal'
    || tag === 'energy'
    || tag === 'cleanup'
    || tag === 'slime'
    || tag === 'quarantine'
    || tag === 'volatile_energy'
    || tag === 'authorized_output'
  );
}

export const FACTORIES: FactoryDef[] = [
  {
    id: 'communal_kitchen',
    name: 'Кухонная раздача',
    roomTypes: [RoomType.KITCHEN],
    roomNameHints: ['кух', 'буфет', 'столов'],
    workerOccupations: [Occupation.COOK, Occupation.HOUSEWIFE],
    outputTags: ['food', 'public'],
    recipes: [
      { id: 'cook_kasha', name: 'Сварить кашу', inputs: [{ id: 'drink_water', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'kasha', count: 3 }], outputTags: ['food', 'public', 'hot_meal'], outputAccess: 'public', cycleSec: 60 },
      { id: 'pack_ration', name: 'Собрать паек', inputs: [{ id: 'food', count: 2 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'bread', count: 2 }, { defId: 'canned', count: 1 }], outputTags: ['food', 'public', 'ration'], outputAccess: 'public', cycleSec: 90 },
    ],
  },
  {
    id: 'medical_post',
    name: 'Медпункт',
    roomTypes: [RoomType.MEDICAL],
    roomNameHints: ['мед', 'лаборат'],
    workerOccupations: [Occupation.DOCTOR, Occupation.SCIENTIST],
    outputTags: ['medical', 'locked'],
    recipes: [
      { id: 'roll_bandage', name: 'Скрутить бинты', inputs: [{ id: 'medicine', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'bandage', count: 2 }], outputTags: ['medical', 'first_aid'], outputAccess: 'room', cycleSec: 90 },
      { id: 'press_pills', name: 'Прессовать таблетки', inputs: [{ id: 'medicine', count: 2 }, { id: 'drink_water', count: 1 }], outputs: [{ defId: 'pills', count: 1 }], outputTags: ['medical', 'pills'], outputAccess: 'room', cycleSec: 120 },
    ],
  },
  {
    id: 'concentrate_press',
    name: 'Линия концентрата',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['концентрат', 'брикет'],
    workerOccupations: [Occupation.MECHANIC, Occupation.COOK, Occupation.STOREKEEPER],
    ownerFaction: Faction.CITIZEN,
    outputTags: ['tools', 'food', 'public'],
    recipes: [
      {
        id: 'press_gray_briquettes',
        name: 'Прессовать серые брикеты',
        inputs: [{ id: 'industrial_slurry', count: 2 }, { id: 'drink_water', count: 1 }, { id: 'labor', count: 1 }],
        outputs: [{ defId: 'grey_briquette', count: 4 }],
        outputTags: ['food', 'public', 'concentrate', 'gray_batch'],
        outputAccess: 'room',
        cycleSec: 120,
        eventTags: ['concentrate_press', 'briquette_line'],
        badBatch: {
          everyCycles: 3,
          outputs: [{ defId: 'green_briquette', count: 2 }, { defId: 'experimental_concentrate', count: 1 }, { defId: 'acid_bottle', count: 1 }],
          jammedCycleSec: 60,
          repairItems: [{ defId: 'gear', count: 1 }],
          repairOutputs: [{ defId: 'grey_briquette', count: 1 }],
          eventTags: ['concentrate_press', 'bad_batch', 'jammed'],
        },
      },
      { id: 'seal_green_briquettes', name: 'Запечатать зелёные брикеты', inputs: [{ id: 'industrial_slurry', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'green_briquette', count: 3 }, { defId: 'gasmask_filter', count: 1 }], outputTags: ['food', 'tools', 'concentrate', 'quarantine'], outputAccess: 'faction', cycleSec: 180 },
    ],
  },
  {
    id: 'slime_deactivation_furnace',
    name: 'Печь деактивации слизи',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['деактивац', 'гашен', 'слиз', 'печь'],
    workerOccupations: [Occupation.MECHANIC, Occupation.SCIENTIST, Occupation.HUNTER],
    ownerFaction: Faction.LIQUIDATOR,
    outputTags: ['cleanup', 'slime', 'tools'],
    recipes: [
      {
        id: 'burn_brown_slime_sample',
        name: 'Гасить коричневую пробу',
        inputs: [{ id: 'fuel', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
        inputItems: [{ defId: 'slime_sample_brown', count: 1 }, { defId: 'alkali_powder', count: 1 }],
        outputs: [{ defId: 'deactivated_residue', count: 2 }, { defId: 'gasmask_filter', count: 1 }, { defId: 'sealant_tube', count: 1 }, { defId: 'decon_fluid', count: 1 }],
        outputTags: ['cleanup', 'slime', 'tools', 'sample', 'repair', 'sealant', 'alkali', 'decon'],
        outputAccess: 'room',
        cycleSec: 240,
        eventTags: ['slime', 'furnace_used', 'deactivation_completed', 'sealant_issue', 'alkali'],
      },
      {
        id: 'calcine_slime_chip',
        name: 'Прокалить окаменевший скол',
        inputs: [{ id: 'fuel', count: 1 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
        inputItems: [{ defId: 'slime_calcified_chip', count: 1 }],
        outputs: [{ defId: 'deactivated_residue', count: 1 }, { defId: 'sealant_tube', count: 1 }],
        outputTags: ['cleanup', 'slime', 'sample', 'calcified', 'repair', 'sealant'],
        outputAccess: 'room',
        cycleSec: 180,
        eventTags: ['slime', 'furnace_used', 'calcified_chip', 'sealant_issue'],
      },
    ],
  },
  {
    id: 'illegal_ammo_smelter',
    name: 'Гильзоплавка',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['гильз', 'плавиль', 'патрон'],
    workerOccupations: [Occupation.TURNER, Occupation.LOCKSMITH, Occupation.MECHANIC],
    ownerFaction: Faction.WILD,
    outputTags: ['ammo', 'weapon', 'illegal'],
    recipes: [
      {
        id: 'recycle_pistol_rounds',
        name: 'Переплавить патронный лом',
        inputs: [{ id: 'ammo', count: 2 }, { id: 'metal', count: 2 }, { id: 'labor', count: 1 }],
        inputItems: [{ defId: 'metal_sheet', count: 1 }, { defId: 'homemade_ammo_instruction', count: 1 }],
        outputs: [{ defId: 'ammo_9mm', count: 6 }, { defId: 'homemade_ammo_instruction', count: 1 }],
        outputTags: ['ammo', 'weapon', 'illegal', 'homemade'],
        outputAccess: 'faction',
        cycleSec: 420,
        eventTags: ['illegal_ammo_smelter', 'repair_input', 'contested_output', 'homemade'],
      },
    ],
  },
  {
    id: 'metal_shop',
    name: 'Цех металла',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['цех', 'мастер', 'насосн', 'стан'],
    workerOccupations: [Occupation.LOCKSMITH, Occupation.TURNER, Occupation.MECHANIC],
    outputTags: ['tools', 'faction'],
    recipes: [
      { id: 'cut_pipe', name: 'Нарезать трубы', inputs: [{ id: 'metal', count: 2 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'pipe', count: 1 }], outputTags: ['tools', 'pipe'], outputAccess: 'room', cycleSec: 120 },
      { id: 'assemble_door_kit', name: 'Собрать дверь-комплект', inputs: [{ id: 'metal', count: 4 }, { id: 'tools', count: 1 }], outputs: [{ defId: 'door_kit', count: 1 }], outputTags: ['tools', 'door_kit'], outputAccess: 'room', cycleSec: 180 },
    ],
  },
  {
    id: 'armory_bench',
    name: 'Оружейная мастерская',
    roomTypes: [RoomType.STORAGE, RoomType.HQ, RoomType.PRODUCTION],
    roomNameHints: ['оруж', 'штаб', 'арсенал'],
    workerOccupations: [Occupation.HUNTER, Occupation.MECHANIC],
    ownerFaction: Faction.LIQUIDATOR,
    outputTags: ['weapon', 'locked'],
    recipes: [
      { id: 'load_9mm', name: 'Снарядить 9мм', inputs: [{ id: 'ammo', count: 2 }, { id: 'metal', count: 1 }], outputs: [{ defId: 'ammo_9mm', count: 24 }], outputTags: ['ammo', 'weapon', 'locked'], outputAccess: 'faction', cycleSec: 90 },
      { id: 'cast_12g_slugs', name: 'Отлить пули 12 калибра', inputs: [{ id: 'ammo', count: 1 }, { id: 'metal', count: 2 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'ammo_12g_slug', count: 4 }], outputTags: ['ammo', 'weapon', 'shotgun', 'locked', 'precision'], outputAccess: 'faction', cycleSec: 180, eventTags: ['armory_bench', 'ammo_12g_slug', 'authorized_output'] },
      { id: 'load_incendiary_12g', name: 'Снарядить зажигательную дробь', inputs: [{ id: 'ammo', count: 1 }, { id: 'fuel', count: 1 }, { id: 'labor', count: 1 }], inputItems: [{ defId: 'ammo_shells', count: 2 }], outputs: [{ defId: 'ammo_12g_incendiary', count: 2 }], outputTags: ['ammo', 'weapon', 'fire', 'cleanup', 'locked'], outputAccess: 'faction', cycleSec: 180, eventTags: ['armory_bench', 'incendiary_shells', 'slime_counterplay', 'authorized_output'] },
      { id: 'repair_makarov', name: 'Восстановить Макаров', inputs: [{ id: 'metal', count: 4 }, { id: 'tools', count: 2 }], outputs: [{ defId: 'makarov', count: 1 }], outputTags: ['weapon', 'locked', 'repair'], outputAccess: 'faction', cycleSec: 240 },
      { id: 'fit_liquidator_rake', name: 'Собрать грабли 0Г15', inputs: [{ id: 'metal', count: 3 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }], inputItems: [{ defId: 'rusty_rake', count: 1 }], outputs: [{ defId: 'liquidator_rake', count: 1 }], outputTags: ['weapon', 'cleanup', 'locked', 'repair_input'], outputAccess: 'faction', cycleSec: 180 },
      { id: 'assemble_chizh3', name: 'Собрать ЧИЖ-3', inputs: [{ id: 'metal', count: 5 }, { id: 'tools', count: 2 }, { id: 'ammo', count: 1 }], inputItems: [{ defId: 'weapon_blueprint_t2', count: 1 }, { defId: 'barrel_part', count: 1 }, { defId: 'magazine_part', count: 1 }], outputs: [{ defId: 'chizh3_shotgun', count: 1 }], outputTags: ['weapon', 'shotgun', 'blueprint', 'tier2', 'locked', 'authorized_output'], outputAccess: 'faction', cycleSec: 360, eventTags: ['armory_bench', 'weapon_blueprint_t2', 'recipe_unlock', 'authorized_output'] },
      { id: 'recondition_eralashnikov', name: 'Перебрать Ералашникова', inputs: [{ id: 'metal', count: 6 }, { id: 'tools', count: 3 }, { id: 'ammo', count: 2 }], inputItems: [{ defId: 'barrel_part', count: 1 }, { defId: 'magazine_part', count: 1 }], outputs: [{ defId: 'eralashnikov_auto', count: 1 }], outputTags: ['weapon', 'rifle', 'locked', 'authorized_output'], outputAccess: 'owner', cycleSec: 540, maxOutputItemCount: 1 },
      { id: 'fill_roks_tank', name: 'Заправить бак РОКС', inputs: [{ id: 'fuel', count: 3 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }], inputItems: [{ defId: 'empty_roks_tank', count: 1 }], outputs: [{ defId: 'napalm_mix', count: 4 }], outputTags: ['ammo', 'fuel', 'cleanup', 'locked'], outputAccess: 'faction', cycleSec: 240, eventTags: ['armory_bench', 'napalm', 'cleanup', 'authorized_output'] },
      { id: 'assemble_breach_charge', name: 'Собрать пробивной заряд', inputs: [{ id: 'ammo', count: 2 }, { id: 'metal', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'breach_charge', count: 1 }], outputTags: ['ammo', 'weapon', 'breach', 'engineer', 'locked'], outputAccess: 'faction', cycleSec: 300, eventTags: ['armory_bench', 'breach_charge', 'collateral', 'authorized_output'] },
    ],
  },
  {
    id: 'office_press',
    name: 'Бумажное производство',
    roomTypes: [RoomType.OFFICE, RoomType.STORAGE],
    roomNameHints: ['архив', 'кабинет', 'типограф', 'картотек'],
    workerOccupations: [Occupation.SECRETARY, Occupation.DIRECTOR, Occupation.STOREKEEPER],
    outputTags: ['paper', 'bureaucracy'],
    recipes: [
      { id: 'copy_bulletins', name: 'Размножить бюллетени', inputs: [{ id: 'paper', count: 2 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'ballot', count: 3 }], outputTags: ['paper', 'bureaucracy', 'ballot'], outputAccess: 'room', cycleSec: 120 },
      { id: 'sort_notes', name: 'Сортировать записки', inputs: [{ id: 'documents', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'note', count: 2 }], outputTags: ['paper', 'bureaucracy', 'notes'], outputAccess: 'room', cycleSec: 60 },
    ],
  },
  {
    id: 'mushroom_cellar',
    name: 'Грибная смена',
    roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.KITCHEN],
    roomNameHints: ['гриб', 'плесен', 'прачеч'],
    workerOccupations: [Occupation.STOREKEEPER, Occupation.COOK, Occupation.MECHANIC],
    ownerFaction: Faction.CITIZEN,
    outputTags: ['food', 'fungal'],
    recipes: [
      { id: 'grow_cellar_mushrooms', name: 'Вырастить грибную массу', inputs: [{ id: 'fungal_inputs', count: 1 }, { id: 'drink_water', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'mushroom_mass', count: 3 }, { defId: 'infected_mushroom', count: 1 }], outputTags: ['food', 'fungal', 'mushroom'], outputAccess: 'room', cycleSec: 240 },
    ],
  },
  {
    id: 'charge_cage_089',
    name: 'Зарядная клеть 089',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['зарядк', 'ящик 089'],
    workerOccupations: [Occupation.STOREKEEPER, Occupation.ELECTRICIAN],
    ownerFaction: Faction.LIQUIDATOR,
    outputTags: ['charge_cage_089', 'ag41_charge_cage', 'energy', 'utility'],
    recipes: [
      {
        id: 'charge_cells_089',
        name: 'Зарядить учетную ячейку',
        inputs: [{ id: 'electronics', count: 2 }, { id: 'labor', count: 1 }],
        outputs: [{ defId: 'ammo_energy', count: 1 }],
        outputTags: ['charge_cage_089', 'energy', 'limited_output', 'volatile_energy'],
        outputAccess: 'owner',
        cycleSec: 240,
        maxOutputItemCount: 2,
        eventTags: ['charge_cage_089', 'energy', 'limited_output', 'volatile_energy', 'authorized_output'],
      },
    ],
  },
  {
    id: 'automation_cage',
    name: 'Клеть автоматики',
    roomTypes: [RoomType.PRODUCTION],
    roomNameHints: ['автоматик', 'плазмен'],
    workerOccupations: [Occupation.ELECTRICIAN, Occupation.MECHANIC],
    ownerFaction: Faction.LIQUIDATOR,
    outputTags: ['automation_cage', 'plasma_post', 'energy', 'repair_input'],
    recipes: [
      {
        id: 'repair_plasma_cell',
        name: 'Поднять плазменную кассету',
        inputs: [{ id: 'electronics', count: 1 }, { id: 'tools', count: 1 }],
        inputItems: [{ defId: 'fuse', count: 1 }],
        outputs: [{ defId: 'ammo_energy', count: 1 }],
        outputTags: ['automation_cage', 'plasma_post', 'repair', 'energy', 'limited_output'],
        outputAccess: 'room',
        cycleSec: 240,
        maxOutputItemCount: 1,
        eventTags: ['automation_cage', 'plasma_post', 'repair', 'energy', 'limited_output', 'volatile_energy', 'authorized_output'],
      },
    ],
  },
  {
    id: 'utility_room',
    name: 'Техническая кладовая',
    roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION],
    roomNameHints: ['клад', 'склад', 'диспетчер'],
    workerOccupations: [Occupation.STOREKEEPER, Occupation.ELECTRICIAN],
    outputTags: ['utility', 'room'],
    recipes: [
      { id: 'charge_cells', name: 'Зарядить ячейки', inputs: [{ id: 'electronics', count: 2 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'ammo_energy', count: 1 }], outputTags: ['utility', 'electronics', 'energy_cell'], outputAccess: 'room', cycleSec: 180 },
      { id: 'fill_fuel', name: 'Разлить топливо', inputs: [{ id: 'fuel', count: 2 }, { id: 'tools', count: 1 }], outputs: [{ defId: 'ammo_fuel', count: 2 }], outputTags: ['utility', 'fuel'], outputAccess: 'room', cycleSec: 120 },
      { id: 'wind_asbestos_cord', name: 'Намотать асбестовую верёвку', inputs: [{ id: 'industrial_slurry', count: 1 }, { id: 'labor', count: 1 }], outputs: [{ defId: 'asbestos_cord', count: 2 }], outputTags: ['utility', 'tools', 'repair_input', 'hermetic'], outputAccess: 'room', cycleSec: 150 },
    ],
  },
];

function appendFactoryRecipes(packs: Record<string, readonly FactoryRecipeDef[]>): void {
  for (const [factoryId, recipes] of Object.entries(packs)) {
    const factory = FACTORIES.find(f => f.id === factoryId);
    if (!factory) continue;
    for (const recipe of recipes) {
      if (!factory.recipes.some(existing => existing.id === recipe.id)) factory.recipes.push(recipe);
    }
  }
}

const WORKSHOP_SCAVENGE_FACTORY_RECIPES: Record<string, readonly FactoryRecipeDef[]> = {
  illegal_ammo_smelter: [
    {
      id: 'cast_black_market_shells',
      name: 'Снарядить чёрную дробь',
      inputs: [{ id: 'ammo', count: 1 }, { id: 'metal', count: 2 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'homemade_ammo_instruction', count: 1 }],
      outputs: [{ defId: 'black_market_shells', count: 2 }],
      outputTags: ['ammo', 'weapon', 'illegal', 'contested_output'],
      outputAccess: 'faction',
      cycleSec: 420,
      eventTags: ['illegal_ammo_smelter', 'black_market_shells', 'audit_risk'],
    },
    {
      id: 'scrub_weapon_serials',
      name: 'Сбить номера с планок',
      inputs: [{ id: 'metal', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'weapon_checkout_tag', count: 1 }],
      outputs: [{ defId: 'scrubbed_serial_plate', count: 2 }],
      outputTags: ['weapon', 'illegal', 'evidence', 'contested_output'],
      outputAccess: 'secret',
      cycleSec: 300,
      eventTags: ['illegal_ammo_smelter', 'scrubbed_serials', 'audit_risk'],
    },
  ],
  metal_shop: [
    {
      id: 'press_rail_repair_pack',
      name: 'Выбить путевой ремонтный набор',
      inputs: [{ id: 'metal', count: 4 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      outputs: [{ defId: 'rail_spike_pack', count: 2 }, { defId: 'rail_switch_handle', count: 1 }],
      outputTags: ['rail', 'repair', 'transport', 'faction'],
      outputAccess: 'room',
      cycleSec: 240,
      eventTags: ['metal_shop', 'rail_repair', 'transport'],
    },
    {
      id: 'assemble_t1_door_kit',
      name: 'Собрать дверь по чертежам Т1',
      inputs: [{ id: 'metal', count: 3 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'blueprint_t1_folder', count: 1 }],
      outputs: [{ defId: 'door_kit', count: 1 }, { defId: 'blueprint_t1_folder', count: 1 }],
      outputTags: ['tools', 'door_kit', 'blueprint', 'tier1', 'repair_input'],
      outputAccess: 'room',
      cycleSec: 210,
      eventTags: ['metal_shop', 'blueprint_t1', 'recipe_unlock'],
    },
    {
      id: 'weld_emergency_door_kit',
      name: 'Заварить аварийный дверной комплект',
      inputs: [{ id: 'metal', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'electrode_pack', count: 1 }],
      outputs: [{ defId: 'door_kit', count: 1 }],
      outputTags: ['tools', 'door_kit', 'repair', 'welding', 'repair_input'],
      outputAccess: 'room',
      cycleSec: 180,
      eventTags: ['metal_shop', 'electrode_pack', 'repair_input'],
    },
  ],
  utility_room: [
    {
      id: 'strip_terminal_units',
      name: 'Разобрать терминальный донор',
      inputs: [{ id: 'electronics', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'circuit_board', count: 1 }],
      outputs: [{ defId: 'keyboard_unit', count: 1 }, { defId: 'screen_unit', count: 1 }, { defId: 'krona_battery', count: 1 }],
      outputTags: ['utility', 'electronics', 'terminal', 'repair'],
      outputAccess: 'room',
      cycleSec: 210,
      eventTags: ['utility_room', 'terminal_scrap', 'electronics'],
    },
    {
      id: 'assemble_sound_emitter',
      name: 'Собрать звукоизлучатель',
      inputs: [{ id: 'electronics', count: 1 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'junior_tech_case', count: 1 }, { defId: 'krona_battery', count: 1 }],
      outputs: [{ defId: 'sound_emitter', count: 1 }],
      outputTags: ['utility', 'electronics', 'noise', 'repair'],
      outputAccess: 'room',
      cycleSec: 160,
      eventTags: ['utility_room', 'sound_emitter', 'electronics'],
    },
    {
      id: 'assemble_contraband_shocker',
      name: 'Собрать подпольный шокер',
      inputs: [{ id: 'electronics', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'contraband_shocker_parts', count: 1 }, { defId: 'krona_battery', count: 1 }],
      outputs: [{ defId: 'shock_baton', count: 1 }],
      outputTags: ['utility', 'electronics', 'weapon', 'illegal', 'contested_output', 'repair_input'],
      outputAccess: 'secret',
      cycleSec: 360,
      eventTags: ['utility_room', 'contraband_shocker_parts', 'shock_baton', 'audit_risk'],
    },
    {
      id: 'decode_fibrous_t2_blueprint',
      name: 'Считать Т2 из фиброзной капсулы',
      inputs: [{ id: 'electronics', count: 1 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'fibrous_capsule_cut', count: 1 }],
      outputs: [{ defId: 'blueprint_t2_folder', count: 1 }],
      outputTags: ['utility', 'terminal', 'blueprint', 'recipe', 'limited_output'],
      outputAccess: 'locked',
      cycleSec: 360,
      maxOutputItemCount: 1,
      eventTags: ['utility_room', 'fibrous_capsule', 'blueprint_t2_folder'],
    },
    {
      id: 'service_water_filter',
      name: 'Собрать узел фильтра воды',
      inputs: [{ id: 'tools', count: 2 }, { id: 'metal', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'pump_passport', count: 1 }],
      outputs: [{ defId: 'water_filter_regulator', count: 1 }, { defId: 'pump_impeller', count: 1 }],
      outputTags: ['utility', 'water', 'repair', 'limited_output'],
      outputAccess: 'room',
      cycleSec: 260,
      eventTags: ['utility_room', 'water_filter', 'repair_input'],
    },
  ],
  communal_kitchen: [
    {
      id: 'start_braga_bucket',
      name: 'Поставить ведро браги',
      inputs: [{ id: 'food', count: 2 }, { id: 'drink_water', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'sugar_pack', count: 1 }, { defId: 'bottle_empty', count: 1 }, { defId: 'rubber_tube', count: 1 }],
      outputs: [{ defId: 'braga_bucket', count: 1 }],
      outputTags: ['food', 'brewing', 'illegal', 'contested_output'],
      outputAccess: 'owner',
      cycleSec: 480,
      eventTags: ['communal_kitchen', 'brewing', 'audit_risk'],
    },
  ],
};

appendFactoryRecipes(WORKSHOP_SCAVENGE_FACTORY_RECIPES);

const FROZEN_SLIME_FACTORY_RECIPES: Record<string, readonly FactoryRecipeDef[]> = {
  communal_kitchen: [
    {
      id: 'thaw_frozen_slime_core',
      name: 'Отогреть замороженную пробу',
      inputs: [{ id: 'drink_water', count: 1 }, { id: 'electronics', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'heating_element', count: 1 }, { defId: 'frozen_slime_core', count: 1 }],
      outputs: [{ defId: 'boiled_slime_residue', count: 1 }],
      outputTags: ['cleanup', 'slime', 'heat', 'thaw', 'kitchen', 'limited_output'],
      outputAccess: 'room',
      cycleSec: 300,
      eventTags: ['communal_kitchen', 'heating_element', 'frozen_slime_core', 'heat_counter'],
    },
  ],
};

appendFactoryRecipes(FROZEN_SLIME_FACTORY_RECIPES);

const FROZEN_BLUEPRINT_FACTORY_RECIPES: Record<string, readonly FactoryRecipeDef[]> = {
  utility_room: [
    {
      id: 'decode_frozen_t3_blueprint',
      name: 'Считать Т3 из ледяного осколка',
      inputs: [{ id: 'electronics', count: 2 }, { id: 'tools', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'frozen_item_shard', count: 1 }],
      outputs: [{ defId: 'blueprint_t3_folder', count: 1 }],
      outputTags: ['utility', 'terminal', 'blueprint', 'recipe', 'tier3', 'frozen', 'limited_output'],
      outputAccess: 'locked',
      cycleSec: 480,
      maxOutputItemCount: 1,
      eventTags: ['utility_room', 'frozen_item_shard', 'blueprint_t3_folder', 'rare_recipe_unlock'],
    },
  ],
};

appendFactoryRecipes(FROZEN_BLUEPRINT_FACTORY_RECIPES);

const HOMEMADE_AMMO_FACTORY_RECIPES: Record<string, readonly FactoryRecipeDef[]> = {
  illegal_ammo_smelter: [
    {
      id: 'cast_homemade_9mm',
      name: 'Лить кустарные 9мм',
      inputs: [{ id: 'ammo', count: 1 }, { id: 'metal', count: 1 }, { id: 'labor', count: 1 }],
      inputItems: [{ defId: 'homemade_ammo_instruction', count: 1 }],
      outputs: [{ defId: 'homemade_9mm', count: 3 }, { defId: 'homemade_ammo_instruction', count: 1 }],
      outputTags: ['ammo', 'weapon', 'illegal', 'homemade', 'contested_output'],
      outputAccess: 'faction',
      cycleSec: 300,
      eventTags: ['illegal_ammo_smelter', 'homemade_9mm', 'audit_risk'],
    },
  ],
};

appendFactoryRecipes(HOMEMADE_AMMO_FACTORY_RECIPES);

export const FACTORY_BY_ID: Record<string, FactoryDef> = Object.fromEntries(FACTORIES.map(f => [f.id, f]));

export function factoryForRoom(roomType: RoomType, roomName: string): FactoryDef | undefined {
  const name = roomName.toLowerCase();
  return FACTORIES.find(f => f.roomTypes.includes(roomType) && (f.roomNameHints.length === 0 || f.roomNameHints.some(h => name.includes(h))))
    ?? FACTORIES.find(f => f.roomTypes.includes(roomType));
}

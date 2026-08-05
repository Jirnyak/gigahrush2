import { type Faction } from '../core/types';

export type CorporationId = string;

export const MAX_CORPORATION_BASE_PRICE = 99999;

export interface CorporationDef {
  id: CorporationId;
  name: string;
  ticker: string;
  desc: string;
  sector: string;
  basePrice: number;
  volatility: number;
  resourceIds: readonly string[];
  factoryIds: readonly string[];
  positiveEventTags: readonly string[];
  negativeEventTags: readonly string[];
  factionBias?: Partial<Record<Faction, number>>;
  rumorTags: readonly string[];
}

export interface StockSignalDef {
  corporationId: CorporationId;
  direction: 'positive' | 'negative';
  eventTags: readonly string[];
  weight: number;
}

export const CORPORATIONS: readonly CorporationDef[] = [
  {
    id: 'toha_heavy_industries',
    name: 'ТОХА Heavy Industries',
    ticker: 'TOHA',
    desc: 'Тяжелые узлы, арматурные автоматы и цеховые роботы для этажей, где бетон еще спорит с металлом.',
    sector: 'heavy_industry',
    basePrice: 180,
    volatility: 0.11,
    resourceIds: ['metal', 'tools', 'electronics'],
    factoryIds: ['metal_shop', 'armory_bench', 'utility_room'],
    positiveEventTags: ['monster_robot', 'monster_rebar', 'monster_kostorez', 'metal_shop', 'weapon', 'tools'],
    negativeEventTags: ['shortage', 'blocked', 'container_full', 'metal_missing', 'tools_missing'],
    rumorTags: ['heavy_industry', 'robot', 'rebar', 'factory'],
  },
  {
    id: 'gigakhrush_panel_trust',
    name: 'Трест ГИГАХРУЩ-Панель',
    ticker: 'GKP',
    desc: 'Панели, стены, гермошвы и учет бетонных пустот под нужды жилищного массива.',
    sector: 'construction',
    basePrice: 96,
    volatility: 0.07,
    resourceIds: ['industrial_slurry', 'metal', 'labor'],
    factoryIds: ['concentrate_press', 'metal_shop'],
    positiveEventTags: ['room_regrown', 'door_sealed', 'concentrate_press', 'production'],
    negativeEventTags: ['burn_cleanup', 'door_opened', 'blocked', 'industrial_slurry_missing'],
    rumorTags: ['concrete', 'panel', 'housing'],
  },
  {
    id: 'zavod_serp_i_beton',
    name: 'Завод «Серп и Бетон»',
    ticker: 'SIB',
    desc: 'Коммунальный завод грубой массы, брикетов, листа и всего, что можно выдать за план.',
    sector: 'factory',
    basePrice: 74,
    volatility: 0.09,
    resourceIds: ['industrial_slurry', 'metal', 'labor'],
    factoryIds: ['concentrate_press', 'metal_shop'],
    positiveEventTags: ['concentrate_press', 'metal_shop', 'output', 'production'],
    negativeEventTags: ['shortage', 'blocked', 'industrial_slurry_missing', 'labor_missing'],
    rumorTags: ['factory', 'briquette', 'metal'],
  },
  {
    id: 'oktyabrskaya_truba',
    name: 'Октябрьская Труба',
    ticker: 'TRUB',
    desc: 'Трубы, манометры, сухие обходы и мокрые обещания нижних коммуникаций.',
    sector: 'infrastructure',
    basePrice: 88,
    volatility: 0.1,
    resourceIds: ['drink_water', 'metal', 'tools'],
    factoryIds: ['metal_shop', 'utility_room'],
    positiveEventTags: ['paritel_bridge_crossed', 'paritel_valve_changed', 'tube', 'utility_room', 'metal_shop'],
    negativeEventTags: ['paritel_steam_injury', 'room_lacked_resources', 'drink_water_missing', 'tools_missing'],
    rumorTags: ['pipe', 'water', 'maintenance'],
  },
  {
    id: 'nii_slizi_i_biologii',
    name: 'НИИ Слизи и Прикладной Биологии',
    ticker: 'NII',
    desc: 'Опломбированные банки, прикладная слизь, полевые пробы и биология, которую не стоит греть в кармане.',
    sector: 'science',
    basePrice: 132,
    volatility: 0.14,
    resourceIds: ['slime_samples', 'medicine', 'psi'],
    factoryIds: ['slime_deactivation_furnace', 'medical_post'],
    positiveEventTags: ['slime', 'sample', 'science', 'nii', 'medical_post', 'deactivation_completed'],
    negativeEventTags: ['contaminated', 'opened', 'quarantine', 'slime_samples_missing', 'medicine_missing'],
    rumorTags: ['science', 'slime', 'sample'],
  },
  {
    id: 'podzemvodstroy',
    name: 'Подземводстрой',
    ticker: 'PVOD',
    desc: 'Вода, фильтры, лотки и аварийные перемычки между тем, что течет, и тем, что числится сухим.',
    sector: 'infrastructure',
    basePrice: 69,
    volatility: 0.08,
    resourceIds: ['drink_water', 'tools', 'industrial_slurry'],
    factoryIds: ['utility_room', 'concentrate_press'],
    positiveEventTags: ['filtered_water', 'pressure', 'utility_room', 'paritel_valve_changed'],
    negativeEventTags: ['drink_water_missing', 'flood', 'blocked', 'shortage'],
    rumorTags: ['water', 'filter', 'pressure'],
  },
  {
    id: 'metallopetlya_kombinat',
    name: 'Комбинат «Металлопетля»',
    ticker: 'MPL',
    desc: 'Патронный лом, дверные петли, бронелист и металл, который возвращается в оборот с зубами.',
    sector: 'metallurgy',
    basePrice: 118,
    volatility: 0.12,
    resourceIds: ['metal', 'ammo', 'tools'],
    factoryIds: ['illegal_ammo_smelter', 'metal_shop', 'armory_bench'],
    positiveEventTags: ['illegal_ammo_smelter', 'armory_bench', 'ammo', 'monster_rebar', 'monster_kostorez'],
    negativeEventTags: ['ammo_missing', 'metal_missing', 'blocked', 'confiscation'],
    rumorTags: ['ammo', 'metal', 'contraband'],
  },
  {
    id: 'zhelemish_pischeprom',
    name: 'Желемыш-Пищепром',
    ticker: 'ZHEL',
    desc: 'Грибной субстрат, желемышные партии и пищевое производство, которое лучше проверять дважды.',
    sector: 'food_biotech',
    basePrice: 57,
    volatility: 0.13,
    resourceIds: ['zhelemish', 'food', 'fungal_inputs'],
    factoryIds: ['mushroom_cellar', 'communal_kitchen'],
    positiveEventTags: ['zhelemish', 'mushroom_cellar', 'communal_kitchen', 'food', 'sample'],
    negativeEventTags: ['infected', 'contaminated', 'fungal_inputs_missing', 'food_missing', 'shortage'],
    rumorTags: ['zhelemish', 'food', 'mushroom'],
  },
  {
    id: 'net_obmen_kontora',
    name: 'НЕТ-Обмен Контора',
    ticker: 'NET',
    desc: 'Обменные окна, сетевые квитанции, слухи терминалов и рубли, которые помнят никнейм.',
    sector: 'exchange',
    basePrice: 155,
    volatility: 0.16,
    resourceIds: ['documents', 'electronics', 'contraband'],
    factoryIds: ['office_press', 'utility_room'],
    positiveEventTags: ['net_sphere', 'net_terminal', 'online', 'online_exchange', 'office_press', 'trade'],
    negativeEventTags: ['offline', 'blocked', 'documents_missing', 'electronics_missing'],
    rumorTags: ['net', 'exchange', 'documents'],
  },
  {
    id: 'krasnyy_koridor_logistics',
    name: 'Красный Коридор Логистика',
    ticker: 'KKL',
    desc: 'Маршруты караванов, тарифные окна, подъемники и коридоры, где доставляют даже плохие новости.',
    sector: 'logistics',
    basePrice: 103,
    volatility: 0.1,
    resourceIds: ['documents', 'fuel', 'labor', 'contraband'],
    factoryIds: ['office_press', 'utility_room'],
    positiveEventTags: ['caravan', 'caravan_route', 'tariff', 'contract_completed', 'metro_route_taken'],
    negativeEventTags: ['contract_failed', 'metro_wrong_stop', 'blocked', 'fuel_missing', 'tax', 'tariff'],
    rumorTags: ['logistics', 'caravan', 'tariff'],
  },
];

export const STOCK_SIGNALS: readonly StockSignalDef[] = CORPORATIONS.flatMap(corp => {
  const signals: StockSignalDef[] = [];
  if (corp.positiveEventTags.length > 0) {
    signals.push({
      corporationId: corp.id,
      direction: 'positive',
      eventTags: corp.positiveEventTags.slice(0, 4),
      weight: Math.max(1, Math.round(corp.volatility * 100)),
    });
  }
  if (corp.negativeEventTags.length > 0) {
    signals.push({
      corporationId: corp.id,
      direction: 'negative',
      eventTags: corp.negativeEventTags.slice(0, 4),
      weight: Math.max(1, Math.round(corp.volatility * 80)),
    });
  }
  return signals;
});

export const CORPORATION_BY_ID: Record<CorporationId, CorporationDef> = Object.fromEntries(
  CORPORATIONS.map(corp => [corp.id, corp]),
);

export const CORPORATION_BY_TICKER: Record<string, CorporationDef> = Object.fromEntries(
  CORPORATIONS.map(corp => [corp.ticker, corp]),
);


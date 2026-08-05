import { Faction, FloorLevel, Occupation } from '../core/types';

export interface CaravanResourceDelta {
  resourceId: string;
  count: number;
}

export interface CaravanLaneDef {
  id: string;
  name: string;
  fromFloor: FloorLevel;
  toFloor: FloorLevel;
  fromFloorKeys?: readonly string[];
  toFloorKeys?: readonly string[];
  resourceDeltas: readonly CaravanResourceDelta[];
  tariffResourceIds: readonly string[];
  feeRubles: number;
  riskTags: readonly string[];
  corpIds?: readonly string[];
  faction: Faction;
  startsOpen?: boolean;
}

export type SmallCaravanRole = 'porters' | 'repair' | 'smugglers' | 'clerks' | 'signalers';

export interface SmallCaravanTemplateDef {
  id: string;
  laneId: string;
  name: string;
  role: SmallCaravanRole;
  originTags: readonly string[];
  destinationTags: readonly string[];
  cargo: readonly CaravanResourceDelta[];
  risk: number;
  memberCount: number;
  memberNames: readonly string[];
  faction: Faction;
  occupation: Occupation;
  escortContractId?: string;
  raidContractId?: string;
  rerouteContractId?: string;
  seatFeeRubles?: number;
}




export const CARAVAN_LANES: readonly CaravanLaneDef[] = [
  {
    id: 'kvartiry_living_food_water',
    name: 'Квартиры -> Жилая: еда и вода',
    fromFloor: FloorLevel.KVARTIRY,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['story:kvartiry'],
    toFloorKeys: ['story:living'],
    resourceDeltas: [{ resourceId: 'food', count: 6 }, { resourceId: 'drink_water', count: 5 }],
    tariffResourceIds: ['food', 'drink_water'],
    feeRubles: 18,
    riskTags: ['riot', 'queue', 'residential'],
    faction: Faction.CITIZEN,
  },
  {
    id: 'maintenance_living_tools',
    name: 'Коллекторы -> Жилая: металл и инструмент',
    fromFloor: FloorLevel.MAINTENANCE,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['story:maintenance'],
    toFloorKeys: ['story:living'],
    resourceDeltas: [{ resourceId: 'metal', count: 5 }, { resourceId: 'tools', count: 3 }],
    tariffResourceIds: ['metal', 'tools'],
    feeRubles: 24,
    riskTags: ['pressure', 'repair', 'pipes'],
    faction: Faction.CITIZEN,
  },
  {
    id: 'production_black_market_88',
    name: 'Производственный пояс -> рынок 88',
    fromFloor: FloorLevel.MAINTENANCE,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['design:production_belt'],
    toFloorKeys: ['design:black_market_88'],
    resourceDeltas: [{ resourceId: 'contraband', count: 3 }, { resourceId: 'ammo', count: 4 }],
    tariffResourceIds: ['contraband', 'ammo'],
    feeRubles: 36,
    riskTags: ['black_market', 'audit', 'ambush'],
    corpIds: ['market88'],
    faction: Faction.WILD,
  },
  {
    id: 'ministry_market_docs',
    name: 'Министерство -> Жилая: бумаги и бланки',
    fromFloor: FloorLevel.MINISTRY,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['story:ministry'],
    toFloorKeys: ['story:living'],
    resourceDeltas: [{ resourceId: 'documents', count: 5 }, { resourceId: 'paper', count: 4 }],
    tariffResourceIds: ['documents', 'paper'],
    feeRubles: 30,
    riskTags: ['stamp', 'audit', 'permit'],
    corpIds: ['ministry_registry'],
    faction: Faction.LIQUIDATOR,
  },
  {
    id: 'hell_cult_psi_goods',
    name: 'Мясной низ -> культовые ПСИ-грузы',
    fromFloor: FloorLevel.HELL,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['story:hell'],
    toFloorKeys: ['story:living'],
    resourceDeltas: [{ resourceId: 'psi', count: 2 }, { resourceId: 'contraband', count: 2 }],
    tariffResourceIds: ['psi', 'contraband'],
    feeRubles: 42,
    riskTags: ['cult', 'meat', 'psi'],
    faction: Faction.CULTIST,
  },
  {
    id: 'net_exchange_data',
    name: 'Министерство -> Жилая: НЕТ-схемы и бумаги',
    fromFloor: FloorLevel.MINISTRY,
    toFloor: FloorLevel.LIVING,
    fromFloorKeys: ['design:silicon_net_well'],
    toFloorKeys: ['story:living'],
    resourceDeltas: [{ resourceId: 'electronics', count: 3 }, { resourceId: 'documents', count: 2 }],
    tariffResourceIds: ['electronics', 'documents'],
    feeRubles: 28,
    riskTags: ['net', 'terminal', 'signal'],
    corpIds: ['net_sphere'],
    faction: Faction.SCIENTIST,
    startsOpen: false,
  },
];

export const CARAVAN_LANE_BY_ID: Record<string, CaravanLaneDef> = Object.fromEntries(
  CARAVAN_LANES.map(lane => [lane.id, lane]),
);

export const SMALL_CARAVAN_TEMPLATES: readonly SmallCaravanTemplateDef[] = [
  {
    id: 'queue_lift_porters',
    laneId: 'kvartiry_living_food_water',
    name: 'малый караван очередников',
    role: 'porters',
    originTags: ['ration_queue', 'kitchen', 'lift'],
    destinationTags: ['caravan_exchange', 'living_market', 'shelter'],
    cargo: [{ resourceId: 'food', count: 2 }, { resourceId: 'drink_water', count: 2 }],
    risk: 2,
    memberCount: 3,
    memberNames: ['Носильщик с хлебным мешком', 'Очередница с бидоном', 'Счетчик талонов'],
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    escortContractId: 'caravan_escort_queue_porters',
    raidContractId: 'caravan_raid_queue_cargo',
    seatFeeRubles: 24,
  },
  {
    id: 'repair_lift_crew',
    laneId: 'maintenance_living_tools',
    name: 'ремонтная тройка лифтовиков',
    role: 'repair',
    originTags: ['service_node', 'lift_repair_shaft', 'production'],
    destinationTags: ['hermodoor', 'living_service', 'market'],
    cargo: [{ resourceId: 'metal', count: 2 }, { resourceId: 'tools', count: 2 }],
    risk: 3,
    memberCount: 3,
    memberNames: ['Слесарь с катушкой', 'Лифтовик без каски', 'Молчаливый сварщик'],
    faction: Faction.CITIZEN,
    occupation: Occupation.MECHANIC,
    escortContractId: 'caravan_escort_repair_crew',
    rerouteContractId: 'caravan_reroute_repair_crew',
    seatFeeRubles: 32,
  },
  {
    id: 'market88_smugglers',
    laneId: 'production_black_market_88',
    name: 'контрабандный малый караван 88',
    role: 'smugglers',
    originTags: ['production_belt', 'black_market', 'service_hatch'],
    destinationTags: ['black_market_88', 'smoking', 'debt_window'],
    cargo: [{ resourceId: 'contraband', count: 2 }, { resourceId: 'ammo', count: 2 }],
    risk: 4,
    memberCount: 2,
    memberNames: ['Серый проводник 88', 'Мешочник с глухим тюком'],
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    raidContractId: 'caravan_raid_market88_smugglers',
    rerouteContractId: 'caravan_report_market88_smugglers',
    seatFeeRubles: 44,
  },
  {
    id: 'ministry_form_carriers',
    laneId: 'ministry_market_docs',
    name: 'бумажный караван канцелярии',
    role: 'clerks',
    originTags: ['archive', 'permit_window', 'lift'],
    destinationTags: ['market_docs', 'caravan_exchange', 'bank_window'],
    cargo: [{ resourceId: 'documents', count: 2 }, { resourceId: 'paper', count: 2 }],
    risk: 3,
    memberCount: 3,
    memberNames: ['Курьер с красной папкой', 'Канцелярская носильщица', 'Охранник описи'],
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.SECRETARY,
    escortContractId: 'caravan_escort_ministry_forms',
    rerouteContractId: 'caravan_reroute_ministry_forms',
    seatFeeRubles: 36,
  },
  {
    id: 'net_signalers',
    laneId: 'net_exchange_data',
    name: 'сигнальный караван НЕТ-терминала',
    role: 'signalers',
    originTags: ['net_terminal', 'archive', 'signal'],
    destinationTags: ['caravan_exchange', 'terminal_bank', 'living_market'],
    cargo: [{ resourceId: 'electronics', count: 2 }, { resourceId: 'documents', count: 1 }],
    risk: 3,
    memberCount: 2,
    memberNames: ['Идущий с антенной', 'НЕТ-счетчица задержек'],
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    escortContractId: 'caravan_escort_net_signalers',
    rerouteContractId: 'caravan_reroute_net_signalers',
    seatFeeRubles: 40,
  },
];

export const SMALL_CARAVAN_TEMPLATE_BY_ID: Record<string, SmallCaravanTemplateDef> = Object.fromEntries(
  SMALL_CARAVAN_TEMPLATES.map(template => [template.id, template]),
);



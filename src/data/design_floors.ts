import { FloorLevel } from '../core/types';

export type DesignFloorId =
  | 'roof'
  | 'chthonic_attic'
  | 'radon_exchange'
  | 'antenna_court'
  | 'spetspriemnik'
  | 'upper_bureau'
  | 'cayley_byuro'
  | 'number_registry'
  | 'istinniy_labirint'
  | 'bank_floor'
  | 'critical_leak_archive'
  | 'raionsovet_archive'
  | 'markov_stairwell'
  | 'registry_morgue'
  | 'bolnichny_korpus'
  | 'slime_nii'
  | 'turing_nursery'
  | 'manhattan_crossroads'
  | 'voronoi_quarantine'
  | 'communal_ring'
  | 'moebius_podezd'
  | 'pioneer_camp'
  | 'oranzhereya_betona'
  | 'floor_69'
  | 'obschezhitie_smeny'
  | 'penrose_laundry'
  | 'black_market_88'
  | 'production_belt'
  | 'service_floor'
  | 'silicon_net_well'
  | 'shahta_atrium'
  | 'hyperbolic_switchyard'
  | 'harmonic_bathhouse'
  | 'hilbert_depot'
  | 'dark_metro'
  | 'attractor_dvor'
  | 'underhell'
  | 'podad'
  | 'spectral_chasovnya'
  | 'cantor_pustoty'
  | 'darkness'
  | 'liquidatorbase'
  | 'horrorfloor';

export interface DesignFloorRouteDef {
  id: DesignFloorId;
  z: number;
  displayName: string;
  /**
   * Low-level engine save/instance bucket: which of the 6 story `FloorLevel`
   * classes this design floor occupies for `state.currentFloor`, save payload,
   * floor-instance state and VOID endgame checks. This is an implementation
   * detail of the runtime, NOT the floor's content identity.
   *
   * Content identity (visual palette, population mix, monster/economy mood) is
   * the floor's own `themeClass` below, so a design floor can look and play
   * unlike its save bucket without a save-shape change.
   */
  baseFloor: FloorLevel;
  /**
   * Content/visual/population class this design floor declares for itself.
   * Drives the visual palette tags, NPC density/faction/occupation mix and
   * economy mood through `FloorThemeProfile.themeClass`. Defaults to
   * `baseFloor` when omitted, so each floor owns its look/feel independently of
   * the engine save bucket. Set this to make a floor present as a different
   * class than its `baseFloor` save bucket.
   */
  themeClass?: FloorLevel;
  color: string;
  role: string;
  danger: 1 | 2 | 3 | 4 | 5;
}

/**
 * The content/visual/population class a design floor declares for itself,
 * falling back to its engine save bucket (`baseFloor`) when not overridden.
 */
export function designFloorThemeClass(route: DesignFloorRouteDef): FloorLevel {
  return route.themeClass ?? route.baseFloor;
}

export const DESIGN_FLOOR_ROUTES: readonly DesignFloorRouteDef[] = [
  { id: 'roof', z: 50, displayName: 'Крыша', baseFloor: FloorLevel.MINISTRY, color: '#9cf', role: 'воздух, антенны, видимость', danger: 2 },
  { id: 'chthonic_attic', z: 46, displayName: 'Чердак техслужб', baseFloor: FloorLevel.MINISTRY, color: '#c8f', role: 'техчердак, тайники, старые шахты', danger: 3 },
  { id: 'radon_exchange', z: 44, displayName: 'Радоновый обменник', baseFloor: FloorLevel.MINISTRY, color: '#bdf', role: 'скан-линии, заслонки, проекционный ключ', danger: 4 },
  { id: 'antenna_court', z: 42, displayName: 'Антенный двор', baseFloor: FloorLevel.MINISTRY, color: '#8ff', role: 'связь, наружный ветер, обзор', danger: 2 },
  { id: 'spetspriemnik', z: 40, displayName: 'Спецприёмник', baseFloor: FloorLevel.MINISTRY, color: '#f9b', role: 'задержанные, ключи, решетки и бунт', danger: 3 },
  { id: 'pioneer_camp', z: 38, displayName: 'Пионерлагерь', baseFloor: FloorLevel.LIVING, color: '#6d8', role: 'социальный лагерь, детские запасы', danger: 2 },
  { id: 'cayley_byuro', z: 36, displayName: 'Бюро Кэли', baseFloor: FloorLevel.MINISTRY, color: '#f6c957', role: 'порядок форм, генераторные двери, факторный обход', danger: 3 },
  { id: 'upper_bureau', z: 34, displayName: 'Верхнее бюро', baseFloor: FloorLevel.MINISTRY, color: '#fc4', role: 'документы и доступ', danger: 3 },
  { id: 'number_registry', z: 32, displayName: 'Числовой реестр', baseFloor: FloorLevel.MINISTRY, color: '#fe8', role: 'остатки, модули, простые коридоры', danger: 3 },
  { id: 'istinniy_labirint', z: 28, displayName: 'Истинный лабиринт', baseFloor: FloorLevel.MINISTRY, color: '#edc', role: 'путь, метки, отступление', danger: 4 },
  { id: 'bank_floor', z: 26, displayName: 'Банковский этаж', baseFloor: FloorLevel.MINISTRY, color: '#fd6', role: 'деньги, долги, сейфы', danger: 3 },
  { id: 'critical_leak_archive', z: 24, displayName: 'Архив критической протечки', baseFloor: FloorLevel.MINISTRY, color: '#7bc', role: 'вода, документы, шлюзы', danger: 4 },
  { id: 'raionsovet_archive', z: 22, displayName: 'Райсовет и архив картотек', baseFloor: FloorLevel.MINISTRY, color: '#fc4', role: 'архивы, картотеки, пропуска', danger: 3 },
  { id: 'markov_stairwell', z: 20, displayName: 'Марковская лестница', baseFloor: FloorLevel.MINISTRY, color: '#dda', role: 'лестничная цепь, вероятные комнаты, срез', danger: 3 },
  { id: 'registry_morgue', z: 18, displayName: 'Морг регистраций', baseFloor: FloorLevel.MINISTRY, color: '#ccc', role: 'мертвые записи и проверки', danger: 4 },
  { id: 'bolnichny_korpus', z: 16, displayName: 'Больничный корпус', baseFloor: FloorLevel.KVARTIRY, color: '#8fd', role: 'медицина, карантин, палаты и допуски', danger: 4 },
  { id: 'slime_nii', z: 12, displayName: 'НИИ слизи', baseFloor: FloorLevel.KVARTIRY, color: '#7fdc8a', role: 'биолаборатории, карантин, камеры со слизью', danger: 4 },
  { id: 'turing_nursery', z: 10, displayName: 'Ясли Тьюринга', baseFloor: FloorLevel.KVARTIRY, color: '#69d7b1', role: 'реакционно-диффузионные ясли, чаши, слизевые мосты', danger: 4 },
  { id: 'manhattan_crossroads', z: 8, displayName: 'Перекрестки', baseFloor: FloorLevel.KVARTIRY, color: '#fa4', role: 'городской обход и развилки', danger: 3 },
  { id: 'voronoi_quarantine', z: 6, displayName: 'Вороной-карантин', baseFloor: FloorLevel.KVARTIRY, color: '#9ed', role: 'карантинные ячейки, пропуска, рёбра снабжения', danger: 4 },
  { id: 'communal_ring', z: 4, displayName: 'Коммунальное кольцо', baseFloor: FloorLevel.KVARTIRY, color: '#fa4', role: 'социальный обход', danger: 2 },
  { id: 'moebius_podezd', z: 2, displayName: 'Мёбиус-подъезд', baseFloor: FloorLevel.KVARTIRY, color: '#fb6', role: 'ориентация, зеркальные квартиры, паритетный шов', danger: 2 },
  { id: 'oranzhereya_betona', z: -2, displayName: 'Оранжерея бетона', baseFloor: FloorLevel.LIVING, color: '#8d6', role: 'еда, вода, споры и дефицит', danger: 3 },
  { id: 'floor_69', z: -4, displayName: 'Этаж 69', baseFloor: FloorLevel.MAINTENANCE, themeClass: FloorLevel.LIVING, color: '#f8a', role: 'населенный сбой, сделки, слухи', danger: 3 },
  { id: 'obschezhitie_smeny', z: -6, displayName: 'Общежитие смены', baseFloor: FloorLevel.LIVING, color: '#d6b37a', role: 'сон, тихая кража, свидетели и укрытие', danger: 2 },
  { id: 'penrose_laundry', z: -8, displayName: 'Прачечная Пенроуза', baseFloor: FloorLevel.LIVING, color: '#9ef', role: 'апериодичная прачечная, пар, тайники', danger: 3 },
  { id: 'black_market_88', z: -10, displayName: 'Черный рынок 88', baseFloor: FloorLevel.LIVING, color: '#fd4', role: 'торговля, контрабанда, долги', danger: 3 },
  { id: 'production_belt', z: -14, displayName: 'Производственный пояс', baseFloor: FloorLevel.MAINTENANCE, color: '#fd6', role: 'хабар и ремонт', danger: 4 },
  { id: 'service_floor', z: -18, displayName: 'Служебный этаж', baseFloor: FloorLevel.MAINTENANCE, color: '#8cf', role: 'служебный обход и ремонт', danger: 3 },
  { id: 'hyperbolic_switchyard', z: -20, displayName: 'Гиперболическая стрелочная', baseFloor: FloorLevel.MAINTENANCE, color: '#7ff0b8', role: 'дуги, ложные платформы, стрелочные семейства', danger: 4 },
  { id: 'silicon_net_well', z: -22, displayName: 'Кремниевый НЕТ-колодец', baseFloor: FloorLevel.MAINTENANCE, color: '#63f6ff', role: 'НЕТ-доступ, кремниевая жизнь, редкое оружие', danger: 4 },
  { id: 'shahta_atrium', z: -24, displayName: 'Шахта-атриум', baseFloor: FloorLevel.MAINTENANCE, color: '#9fd6ff', role: 'вертикальный провал, мосты, сервисный обод', danger: 4 },
  { id: 'harmonic_bathhouse', z: -28, displayName: 'Гармоническая баня', baseFloor: FloorLevel.MAINTENANCE, color: '#79c8ff', role: 'пар, давление, горячий и холодный обход', danger: 4 },
  { id: 'hilbert_depot', z: -30, displayName: 'Склад Гильберта', baseFloor: FloorLevel.MAINTENANCE, color: '#b7f08a', role: 'индексный склад, короткие хорды, добыча', danger: 4 },
  { id: 'dark_metro', z: -32, displayName: 'Темная пересадка', baseFloor: FloorLevel.MAINTENANCE, color: '#79f', role: 'опасный короткий ход', danger: 4 },
  { id: 'attractor_dvor', z: -34, displayName: 'Аттракторный двор', baseFloor: FloorLevel.MAINTENANCE, color: '#6af', role: 'потоки, щитки, патрульные петли', danger: 4 },
  { id: 'underhell', z: -38, displayName: 'Нижний пропускник', baseFloor: FloorLevel.HELL, color: '#f44', role: 'боевой порог мясного низа', danger: 5 },
  { id: 'podad', z: -40, displayName: 'Подад', baseFloor: FloorLevel.HELL, color: '#d34', role: 'живые тоннели, двигающиеся стены, нижний порог', danger: 5 },
  { id: 'spectral_chasovnya', z: -42, displayName: 'Спектральная часовня', baseFloor: FloorLevel.HELL, color: '#d6a64b', role: 'звук, культ, слуховая геометрия', danger: 5 },
  { id: 'cantor_pustoty', z: -44, displayName: 'Кантор пустоты', baseFloor: FloorLevel.VOID, color: '#9cf', role: 'рекурсивные разрывы, мосты и пыльные острова', danger: 5 },
  { id: 'liquidatorbase', z: -16, displayName: 'База Ликвидаторов', baseFloor: FloorLevel.MAINTENANCE, color: '#f66', role: 'штаб, торговля, ликвидаторы', danger: 4 },
  { id: 'darkness', z: -48, displayName: 'Темный отсек', baseFloor: FloorLevel.VOID, color: '#88f', role: 'позднее давление', danger: 5 },
  { id: 'horrorfloor', z: -46, displayName: 'Хоррор-этаж', baseFloor: FloorLevel.VOID, color: '#222', role: 'лабиринт, прятки', danger: 5 },
];

export const DESIGN_FLOOR_ZS: readonly number[] = DESIGN_FLOOR_ROUTES.map(def => def.z);

export function designFloorById(id: string): DesignFloorRouteDef | undefined {
  return DESIGN_FLOOR_ROUTES.find(def => def.id === id);
}

export function designFloorAtZ(z: number): DesignFloorRouteDef | undefined {
  return DESIGN_FLOOR_ROUTES.find(def => def.z === z);
}

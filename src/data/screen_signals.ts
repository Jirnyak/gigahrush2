/* ── Procedural screen signal definitions ─────────────────────── */

import { FloorLevel, RoomType, Tex, ZoneFaction, type WorldEventType } from '../core/types';

export type ScreenSignalId =
  | 'samosbor_warning'
  | 'economy_shortage'
  | 'faction_control'
  | 'elevator_anomaly'
  | 'ministry_queue'
  | 'maintenance_pressure'
  | 'void_protocol';

export interface ScreenSignalDef {
  id: ScreenSignalId;
  label: string;
  textureVariants: readonly number[];
  weight: number;
  floors: readonly FloorLevel[];
  roomTypes?: readonly RoomType[];
  zoneFactions?: readonly ZoneFaction[];
  eventTypes: readonly WorldEventType[];
  rumorIds: readonly string[];
  tags: readonly string[];
}

const CIVIL_FLOORS = [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING] as const;
export const SCREEN_SIGNAL_VARIANTS = 8;
export const SCREEN_SIGNAL_FRAMES = 4;
const ALL_SIGNAL_FLOORS = [
  FloorLevel.MINISTRY,
  FloorLevel.KVARTIRY,
  FloorLevel.LIVING,
  FloorLevel.MAINTENANCE,
  FloorLevel.HELL,
  FloorLevel.VOID,
] as const;

export const SCREEN_SIGNAL_DEFS: readonly ScreenSignalDef[] = [
  {
    id: 'samosbor_warning',
    label: 'САМОСБОР',
    textureVariants: [0],
    weight: 5,
    floors: ALL_SIGNAL_FLOORS,
    eventTypes: ['samosbor_warning', 'samosbor_started', 'samosbor_zone_captured'],
    rumorIds: ['samosbor_vent_first', 'samosbor_zone_lamps', 'samosbor_airlock_truth'],
    tags: ['screen_signal', 'samosbor', 'warning', 'airlock'],
  },
  {
    id: 'economy_shortage',
    label: 'ПАЙК',
    textureVariants: [1, 5],
    weight: 4,
    floors: CIVIL_FLOORS,
    roomTypes: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.COMMON, RoomType.LIVING, RoomType.OFFICE],
    zoneFactions: [ZoneFaction.CITIZEN, ZoneFaction.WILD, ZoneFaction.SAMOSBOR],
    eventTypes: ['room_lacked_resources', 'room_produced_items', 'rumor_observed'],
    rumorIds: ['faction_citizen_food', 'room_kitchen_empty', 'rare_bandage_med', 'rare_pills_trade', 'ecology_krysnozhka_bait', 'ecology_sborka_swarm'],
    tags: ['screen_signal', 'economy', 'shortage', 'ration'],
  },
  {
    id: 'faction_control',
    label: 'ЗОНА',
    textureVariants: [2],
    weight: 4,
    floors: ALL_SIGNAL_FLOORS,
    roomTypes: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.OFFICE, RoomType.HQ, RoomType.STORAGE],
    zoneFactions: [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.WILD, ZoneFaction.SAMOSBOR],
    eventTypes: ['faction_patrol_clash', 'samosbor_zone_captured', 'rumor_observed'],
    rumorIds: ['faction_zone_border', 'faction_hq_storage', 'faction_liquidator_patrol', 'faction_cultist_after_fog', 'ecology_nelyud_close', 'ecology_rebar_still', 'ecology_tvar_wall'],
    tags: ['screen_signal', 'faction', 'territory', 'zone'],
  },
  {
    id: 'elevator_anomaly',
    label: 'ЛИФТ',
    textureVariants: [3],
    weight: 2,
    floors: ALL_SIGNAL_FLOORS,
    roomTypes: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.OFFICE, RoomType.MEDICAL],
    eventTypes: ['floor_transition', 'rumor_observed'],
    rumorIds: ['room_lift_wrong', 'floor_lift_smell', 'floor_pocket_rooms'],
    tags: ['screen_signal', 'lift', 'floor', 'anomaly'],
  },
  {
    id: 'ministry_queue',
    label: 'ОЧЕРЕДЬ',
    textureVariants: [4],
    weight: 7,
    floors: [FloorLevel.MINISTRY],
    roomTypes: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.OFFICE],
    eventTypes: ['quest_created', 'quest_completed', 'rumor_observed'],
    rumorIds: ['faction_ministry_papers', 'floor_ministry_paper', 'rare_key_office', 'ecology_pechateed_docs', 'ecology_paragraph_clause'],
    tags: ['screen_signal', 'ministry', 'queue', 'papers'],
  },
  {
    id: 'maintenance_pressure',
    label: 'ДАВЛЕНИЕ',
    textureVariants: [6],
    weight: 7,
    floors: [FloorLevel.MAINTENANCE],
    roomTypes: [RoomType.PRODUCTION, RoomType.OFFICE, RoomType.MEDICAL, RoomType.COMMON],
    eventTypes: ['room_blocked_production', 'room_lacked_resources', 'rumor_observed'],
    rumorIds: ['floor_maintenance_water', 'samosbor_wet_variant', 'samosbor_electric_variant', 'ecology_eel_water', 'ecology_lampovy_light', 'ecology_robot_plasma', 'ecology_eye_line'],
    tags: ['screen_signal', 'maintenance', 'pressure', 'water'],
  },
  {
    id: 'void_protocol',
    label: 'ПРОТОКОЛ',
    textureVariants: [7],
    weight: 7,
    floors: [FloorLevel.HELL, FloorLevel.VOID],
    eventTypes: ['fog_boss_spawned', 'fog_boss_killed', 'rumor_observed'],
    rumorIds: ['floor_void_listens', 'floor_hell_meat', 'samosbor_meat_variant', 'monster_matka_spawn', 'ecology_shadow_afterimage', 'ecology_herald_ceiling', 'ecology_creator_white', 'ecology_paragraph_clause'],
    tags: ['screen_signal', 'void', 'hell', 'protocol'],
  },
];

export function screenSignalForVariant(variant: number): ScreenSignalDef | undefined {
  for (const def of SCREEN_SIGNAL_DEFS) {
    if (def.textureVariants.includes(variant)) return def;
  }
  return undefined;
}

export function screenSignalForTexture(tex: number): ScreenSignalDef | undefined {
  const first = Tex.SCREEN_BASE;
  const last = first + SCREEN_SIGNAL_VARIANTS * SCREEN_SIGNAL_FRAMES;
  if (tex < first || tex >= last) return undefined;
  return screenSignalForVariant(Math.floor((tex - first) / SCREEN_SIGNAL_FRAMES));
}

export function screenSignalById(id: ScreenSignalId): ScreenSignalDef {
  const def = SCREEN_SIGNAL_DEFS.find(s => s.id === id);
  if (!def) throw new Error(`Unknown screen signal: ${id}`);
  return def;
}

export function screenSignalEligible(
  def: ScreenSignalDef,
  floor: FloorLevel,
  roomType: RoomType | undefined,
  zoneFaction: ZoneFaction | undefined,
): boolean {
  if (!def.floors.includes(floor)) return false;
  if (def.roomTypes && (roomType === undefined || !def.roomTypes.includes(roomType))) return false;
  if (def.zoneFactions && zoneFaction !== undefined && !def.zoneFactions.includes(zoneFaction)) return false;
  return true;
}

/* ── Emergency maintenance panel definitions ─────────────────── */

import { RoomType } from '../core/types';
import type { FloorGeometryId } from './procedural_floors';

export type EmergencyPanelId = 'panel_power' | 'panel_water' | 'panel_doors' | 'panel_vent';
export type EmergencyPanelDomain = 'power' | 'water' | 'doors' | 'vent';
export type EmergencyPanelActionId = 'repair' | 'shutdown' | 'force' | 'overload' | 'leave';

export interface EmergencyPanelCost {
  itemId: string;
  count: number;
}

export interface EmergencyPanelDef {
  id: EmergencyPanelId;
  name: string;
  shortName: string;
  domain: EmergencyPanelDomain;
  color: string;
  weight: number;
  geometryWeights: Partial<Record<FloorGeometryId, number>>;
  roomTypes: readonly RoomType[];
  repairCost: readonly EmergencyPanelCost[];
  tags: readonly string[];
  actionLabels: Readonly<Record<Exclude<EmergencyPanelActionId, 'leave'>, string>>;
}

export const EMERGENCY_PANEL_DEFS: readonly EmergencyPanelDef[] = [
  {
    id: 'panel_power',
    name: 'Аварийный щиток света',
    shortName: 'свет',
    domain: 'power',
    color: '#f6d66a',
    weight: 34,
    geometryWeights: { service_spines: 3.2, workshops: 2.8, collectors: 1.4, attic_weatherworks: 1.8 },
    roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.OFFICE],
    repairCost: [{ itemId: 'fuse', count: 1 }, { itemId: 'wire_coil', count: 1 }],
    tags: ['power', 'light', 'service', 'maintenance'],
    actionLabels: {
      repair: 'Починить линию света',
      shutdown: 'Обесточить комнату',
      force: 'Вскрыть сервисную линию',
      overload: 'Перегрузить свет',
    },
  },
  {
    id: 'panel_water',
    name: 'Аварийный щиток воды',
    shortName: 'вода',
    domain: 'water',
    color: '#79c8ff',
    weight: 30,
    geometryWeights: { collectors: 3.4, sump_causeways: 3.2, workshops: 1.8, service_spines: 1.5 },
    roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.BATHROOM],
    repairCost: [{ itemId: 'valve_tag', count: 1 }, { itemId: 'sealant_tube', count: 1 }],
    tags: ['water', 'pipes', 'pressure', 'maintenance'],
    actionLabels: {
      repair: 'Починить водяной контур',
      shutdown: 'Перекрыть воду',
      force: 'Сорвать пломбу стояка',
      overload: 'Дать обратный напор',
    },
  },
  {
    id: 'panel_doors',
    name: 'Аварийный щиток дверей',
    shortName: 'двери',
    domain: 'doors',
    color: '#b7d0c0',
    weight: 24,
    geometryWeights: { service_spines: 2.4, workshops: 2.8, collectors: 1.2 },
    roomTypes: [RoomType.CORRIDOR, RoomType.STORAGE, RoomType.PRODUCTION, RoomType.OFFICE],
    repairCost: [{ itemId: 'door_kit', count: 1 }, { itemId: 'hermo_gasket', count: 1 }],
    tags: ['doors', 'access', 'shortcut', 'maintenance'],
    actionLabels: {
      repair: 'Починить гермоконтур дверей',
      shutdown: 'Закрыть местные двери',
      force: 'Открыть двери аварийно',
      overload: 'Перегрузить замки',
    },
  },
  {
    id: 'panel_vent',
    name: 'Аварийный щиток вентиляции',
    shortName: 'вентиляция',
    domain: 'vent',
    color: '#9ee6c4',
    weight: 28,
    geometryWeights: { service_spines: 3.0, collectors: 2.1, workshops: 1.7, attic_weatherworks: 3.6 },
    roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.COMMON],
    repairCost: [{ itemId: 'gasmask_filter', count: 1 }, { itemId: 'relay_diagram', count: 1 }],
    tags: ['vent', 'fog', 'air', 'maintenance'],
    actionLabels: {
      repair: 'Починить вытяжку',
      shutdown: 'Остановить вентиляцию',
      force: 'Вскрыть вентканал',
      overload: 'Загнать туман в комнату',
    },
  },
];

export function getEmergencyPanelDef(id: EmergencyPanelId | string): EmergencyPanelDef | undefined {
  return EMERGENCY_PANEL_DEFS.find(def => def.id === id);
}

export function emergencyPanelDefsForGeometry(geometryId: FloorGeometryId): readonly EmergencyPanelDef[] {
  return EMERGENCY_PANEL_DEFS.filter(def => (def.geometryWeights[geometryId] ?? 0) > 0);
}

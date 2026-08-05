import { FloorLevel } from '../core/types';
import { RESOURCES } from './resources';

export interface ResourceStock {
  stock: number;
  target: number;
  lastDelta: number;
}

export interface EconomyFloorState {
  floor: FloorLevel;
  resources: Record<string, ResourceStock>;
  lastTickAt: number;
}

export interface EconomyRouteState {
  routeId: string;
  heat: number;
  trust: number;
  debt: number;
  demand: Record<string, number>;
  lastDecisionAt: number;
  lastDecisionId?: string;
  lastSamosborCount: number;
  lastSamosborVariant?: string;
  decisionCounts: Record<string, number>;
}

export interface EconomyState {
  floors: Partial<Record<FloorLevel, EconomyFloorState>>;
  routes: Record<string, EconomyRouteState>;
  priceVersion: number;
}

export const ECONOMY_ROUTE_STATE_CAP = 128;

const ECONOMY_FLOORS = new Set<FloorLevel>([
  FloorLevel.MINISTRY,
  FloorLevel.KVARTIRY,
  FloorLevel.LIVING,
  FloorLevel.MAINTENANCE,
  FloorLevel.HELL,
  FloorLevel.VOID,
]);

export function createEconomyState(): EconomyState {
  return { floors: {}, routes: {}, priceVersion: 1 };
}

export function createEconomyFloorState(floor: FloorLevel): EconomyFloorState {
  const resources: Record<string, ResourceStock> = {};
  for (const r of RESOURCES) resources[r.id] = { stock: r.baseStock, target: r.baseStock, lastDelta: 0 };
  return { floor, resources, lastTickAt: 0 };
}

export function createEconomyRouteState(routeId: string): EconomyRouteState {
  return {
    routeId,
    heat: 18,
    trust: 0,
    debt: 0,
    demand: {},
    lastDecisionAt: 0,
    lastSamosborCount: -1,
    decisionCounts: {},
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function cleanId(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9_.:-]{1,48}$/.test(value) ? value : fallback;
}

function normalizeNumberMap(value: unknown, min: number, max: number, cap: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object') return out;
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= cap) break;
    const key = cleanId(rawKey, '');
    if (!key) continue;
    out[key] = clamp(finiteOr(rawValue as number | undefined, 1), min, max);
    count++;
  }
  return out;
}

function normalizeEconomyRouteState(routeId: string, value: unknown): EconomyRouteState {
  const src = (value && typeof value === 'object') ? value as Partial<EconomyRouteState> : {};
  const out = createEconomyRouteState(routeId);
  out.heat = clamp(finiteOr(src.heat, out.heat), 0, 100);
  out.trust = clamp(finiteOr(src.trust, out.trust), -5, 5);
  out.debt = clamp(finiteOr(src.debt, out.debt), 0, 300);
  out.demand = normalizeNumberMap(src.demand, 0.65, 2.5, 32);
  out.lastDecisionAt = Math.max(0, finiteOr(src.lastDecisionAt, 0));
  out.lastDecisionId = cleanId(src.lastDecisionId, '');
  if (!out.lastDecisionId) out.lastDecisionId = undefined;
  out.lastSamosborCount = Math.floor(clamp(finiteOr(src.lastSamosborCount, -1), -1, 1_000_000));
  out.lastSamosborVariant = cleanId(src.lastSamosborVariant, '');
  if (!out.lastSamosborVariant) out.lastSamosborVariant = undefined;
  out.decisionCounts = normalizeNumberMap(src.decisionCounts, 0, 1_000_000, 32);
  return out;
}

export function normalizeEconomyState(value: unknown): EconomyState {
  const src = (value && typeof value === 'object') ? value as Partial<EconomyState> : {};
  const out = createEconomyState();
  out.priceVersion = Math.max(1, Math.floor(finiteOr(src.priceVersion, 1)));
  if (src.floors) {
    for (const k of Object.keys(src.floors)) {
      const floorNumber = Number(k);
      if (!Number.isInteger(floorNumber) || !ECONOMY_FLOORS.has(floorNumber as FloorLevel)) continue;
      const floor = floorNumber as FloorLevel;
      const existing = src.floors[floor];
      const normalized = createEconomyFloorState(floor);
      if (existing?.resources) {
        for (const r of RESOURCES) {
          const v = existing.resources[r.id];
          if (v) {
            const target = clamp(finiteOr(v.target, r.baseStock), 1, r.baseStock * 4);
            normalized.resources[r.id] = {
              stock: clamp(finiteOr(v.stock, r.baseStock), 0, target * 2),
              target,
              lastDelta: clamp(finiteOr(v.lastDelta, 0), -target, target),
            };
          }
        }
      }
      normalized.lastTickAt = existing?.lastTickAt ?? 0;
      out.floors[floor] = normalized;
    }
  }
  if (src.routes && typeof src.routes === 'object') {
    let routeCount = 0;
    for (const [routeId, routeState] of Object.entries(src.routes)) {
      if (routeCount >= ECONOMY_ROUTE_STATE_CAP) break;
      const cleanRouteId = cleanId(routeId, '');
      if (!cleanRouteId) continue;
      out.routes[cleanRouteId] = normalizeEconomyRouteState(cleanRouteId, routeState);
      routeCount++;
    }
  }
  return out;
}

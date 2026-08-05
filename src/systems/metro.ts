/* ── Metro Error Line interaction-time routing ───────────────── */

import { W, Feature, FloorLevel, type Entity, type GameState } from '../core/types';
import { type World } from '../core/world';
import {
  metroRouteForPanel,
  type MetroDestination,
  type MetroRouteDef,
} from '../data/metro';
import { hasItem, removeItem } from './inventory';
import { publishEvent } from './events';

export interface MetroUseResult {
  route: MetroRouteDef;
  destination?: MetroDestination;
  wrongStop: boolean;
  message: string;
  color: string;
}

let nextMetroUseAt = 0;

function isRoutePanel(feature: Feature): boolean {
  return feature === Feature.SCREEN || feature === Feature.APPARATUS;
}

function localDelta(from: number, to: number): number {
  return (to - from + W) % W;
}

function routeAtLookCell(world: World, lookX: number, lookY: number): MetroRouteDef | undefined {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (!isRoutePanel(world.features[ci] as Feature)) return undefined;

  const roomId = world.roomMap[ci];
  if (roomId < 0) return undefined;
  const room = world.rooms[roomId];
  if (!room) return undefined;

  const lx = localDelta(room.x, x);
  const ly = localDelta(room.y, y);
  if (lx >= room.w || ly >= room.h) return undefined;

  const panelSlot = Math.max(0, Math.min(3, Math.round((lx - 2) / 3)));
  return metroRouteForPanel(room.name, panelSlot);
}

function pickWrongStop(route: MetroRouteDef): MetroDestination {
  return route.wrongStops[Math.floor(Math.random() * route.wrongStops.length)] ?? route.destination;
}

function adjustedWrongChance(route: MetroRouteDef, player: Entity, state: GameState): number {
  if (route.safeReturn) return 0;
  let chance = route.wrongStopChance;
  if (hasItem(player, 'lift_scheme')) chance *= 0.55;
  if (hasItem(player, 'clean_health_cert')) chance *= 0.8;
  if (state.samosborActive) chance = Math.min(0.85, chance + 0.18);
  return chance;
}

function destinationData(destination: MetroDestination): Record<string, unknown> {
  const data = destination.kind === 'floor'
    ? { destinationKind: 'floor', destinationFloor: destination.floor, destinationLabel: destination.label }
    : { destinationKind: 'local', destinationRoomName: destination.roomName, destinationLabel: destination.label };
  return {
    ...data,
    returnRouteId: destination.returnRouteId,
    returnHint: destination.returnHint,
  };
}

function eventTags(route: MetroRouteDef, wrongStop: boolean): string[] {
  const tags = ['metro', 'route', route.id, wrongStop ? 'wrong_stop' : route.safeReturn ? 'safe_return' : 'arrival'];
  for (const tag of route.tags) {
    if (tags.length >= 8) break;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function publishMetroEvent(
  world: World,
  player: Entity,
  state: GameState,
  route: MetroRouteDef,
  destination: MetroDestination,
  wrongStop: boolean,
  wrongChance: number,
): void {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const zoneId = world.zoneMap[world.idx(px, py)];
  publishEvent(state, {
    type: wrongStop ? 'metro_wrong_stop' : 'metro_route_taken',
    zoneId: zoneId >= 0 ? zoneId : undefined,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity: wrongStop ? 4 : 3,
    privacy: 'local',
    tags: eventTags(route, wrongStop),
    data: {
      routeId: route.id,
      routeLabel: route.label,
      routeClue: route.clue,
      wrongStop,
      wrongChance,
      safeReturn: route.safeReturn === true,
      rumorIds: route.rumorIds,
      ...destinationData(destination),
    },
  });
}

function routeMessage(route: MetroRouteDef, destination: MetroDestination, wrongStop: boolean): string {
  const hint = destination.returnHint ? ` ${destination.returnHint}` : '';
  if (wrongStop) {
    const line = route.wrongStopLine ?? `Объявление сбилось: ${route.label} стала остановкой «${destination.label}».`;
    return `${line}${hint}`.trim();
  }
  if (route.safeReturn) return route.departLine ?? `Обратная петля вернула маршрут: ${route.label} -> ${destination.label}.`;
  const line = route.departLine ?? `Состав принял маршрут: ${route.label} -> ${destination.label}.`;
  return `${line}${hint}`.trim();
}

export function tryUseMetroRoute(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): MetroUseResult | null {
  const route = routeAtLookCell(world, lookX, lookY);
  if (!route) return null;

  if (state.currentFloor !== FloorLevel.MAINTENANCE) {
    return {
      route,
      wrongStop: false,
      message: `${route.unavailableLine ?? 'Табло щелкает, но линия здесь не принимает посадку.'} ${route.clue}`,
      color: '#888',
    };
  }

  if (state.time < nextMetroUseAt) {
    return {
      route,
      wrongStop: false,
      message: 'Турникет остывает после прошлой ошибки.',
      color: '#888',
    };
  }

  if (route.requiredItem && !hasItem(player, route.requiredItem)) {
    return {
      route,
      wrongStop: false,
      message: `${route.noTicketLine ?? 'Турникет требует билет метро.'} ${route.clue}`,
      color: '#fa4',
    };
  }

  if (route.requiredItem) removeItem(player, route.requiredItem, 1);

  const wrongChance = adjustedWrongChance(route, player, state);
  const wrongStop = route.wrongStops.length > 0 && Math.random() < wrongChance;
  const destination = wrongStop ? pickWrongStop(route) : route.destination;
  const transferHold = wrongStop && destination.kind === 'local' ? 8 : wrongStop ? 24 : 0;
  nextMetroUseAt = state.time + route.cooldownSec + transferHold;

  publishMetroEvent(world, player, state, route, destination, wrongStop, wrongChance);

  return {
    route,
    destination,
    wrongStop,
    message: routeMessage(route, destination, wrongStop),
    color: wrongStop ? '#f84' : '#6cf',
  };
}

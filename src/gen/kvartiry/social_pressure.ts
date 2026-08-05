/* ── Bounded social pressure hooks for Kvartiry POIs ─────────── */

import { type Entity, EntityType, Faction, AIGoal, FloorLevel, type GameState, msg } from '../../core/types';
import { World } from '../../core/world';
import { publishEvent } from '../../systems/events';

export type KvSocialPressurePoiId =
  | 'generic'
  | 'ration_queue'
  | 'water_riot'
  | 'barricade'
  | 'print_room'
  | 'communal_kitchen';

interface PressurePoiMeta {
  id: KvSocialPressurePoiId;
  label: string;
  tags: string[];
  radiusCap: number;
  minCitizens: number;
  maxConverted: number;
  maxResponders: number;
  cooldownSeconds: number;
  chanceBase: number;
  chancePerPressure: number;
  message: string;
  outcome: string;
}

interface PressurePoi {
  id: KvSocialPressurePoiId;
  label: string;
  x: number;
  y: number;
  radius: number;
  pressure: number;
  tags: string[];
  radiusCap: number;
  minCitizens: number;
  maxConverted: number;
  maxResponders: number;
  cooldownSeconds: number;
  chanceBase: number;
  chancePerPressure: number;
  message: string;
  outcome: string;
  cooldownUntil: number;
  triggerCount: number;
}

export interface KvSocialPressureUprisingResult {
  poiId: KvSocialPressurePoiId;
  label: string;
  x: number;
  y: number;
  zoneId: number;
  roomId: number;
  radius: number;
  converted: number;
  responders: number;
  cooldownSeconds: number;
  tags: string[];
  message: string;
  outcome: string;
}

const KV_SOCIAL_PRESSURE_POIS: PressurePoi[] = [];
const MAX_POI_CHECKS_PER_TICK = 4;
const GLOBAL_UPRISING_COOLDOWN = 75;

const DEFAULT_POI_META: PressurePoiMeta = {
  id: 'generic',
  label: 'социальная точка',
  tags: ['generic'],
  radiusCap: 18,
  minCitizens: 4,
  maxConverted: 2,
  maxResponders: 1,
  cooldownSeconds: 300,
  chanceBase: 0.02,
  chancePerPressure: 0.055,
  message: 'В соседней очереди пошёл шёпот: кто-то уже держит трубу не как инструмент.',
  outcome: 'generic_scuffle',
};

const POI_META: Record<KvSocialPressurePoiId, PressurePoiMeta> = {
  generic: DEFAULT_POI_META,
  ration_queue: {
    id: 'ration_queue',
    label: 'Пункт выдачи талонов',
    tags: ['ration', 'shortage', 'queue'],
    radiusCap: 18,
    minCitizens: 5,
    maxConverted: 3,
    maxResponders: 1,
    cooldownSeconds: 300,
    chanceBase: 0.025,
    chancePerPressure: 0.06,
    message: 'У пайковой очереди сорвался край: несколько жильцов пошли давить к кассе.',
    outcome: 'ration_line_breach',
  },
  water_riot: {
    id: 'water_riot',
    label: 'Водораздача у стояка',
    tags: ['water', 'shortage', 'queue'],
    radiusCap: 22,
    minCitizens: 6,
    maxConverted: 5,
    maxResponders: 2,
    cooldownSeconds: 330,
    chanceBase: 0.03,
    chancePerPressure: 0.07,
    message: 'У стояка стало тесно: сухие канистры загремели как оружие.',
    outcome: 'water_queue_push',
  },
  barricade: {
    id: 'barricade',
    label: 'Баррикадированный пролёт',
    tags: ['barricade', 'passage', 'stairs'],
    radiusCap: 20,
    minCitizens: 4,
    maxConverted: 4,
    maxResponders: 3,
    cooldownSeconds: 360,
    chanceBase: 0.025,
    chancePerPressure: 0.06,
    message: 'Баррикада заскрипела: проход отстаивают уже не словами.',
    outcome: 'barricade_shove',
  },
  print_room: {
    id: 'print_room',
    label: 'Нелегальная типография',
    tags: ['print', 'paper', 'witness'],
    radiusCap: 16,
    minCitizens: 3,
    maxConverted: 2,
    maxResponders: 1,
    cooldownSeconds: 420,
    chanceBase: 0.02,
    chancePerPressure: 0.05,
    message: 'Из типографии вынесло мокрый слух: свидетели разбежались, двое остались с ножами.',
    outcome: 'print_room_exposure',
  },
  communal_kitchen: {
    id: 'communal_kitchen',
    label: 'Коммунальная кухня раздора',
    tags: ['kitchen', 'food', 'gas'],
    radiusCap: 20,
    minCitizens: 5,
    maxConverted: 4,
    maxResponders: 2,
    cooldownSeconds: 330,
    chanceBase: 0.025,
    chancePerPressure: 0.065,
    message: 'На коммунальной кухне спор перешёл в железо: держитесь стены.',
    outcome: 'kitchen_brawl',
  },
};

let kvSocialPressureTime = 0;
let nextGlobalUprisingAt = 0;

export function resetKvSocialPressurePois(): void {
  KV_SOCIAL_PRESSURE_POIS.length = 0;
  kvSocialPressureTime = 0;
  nextGlobalUprisingAt = 0;
}

export function registerKvSocialPressurePoi(x: number, y: number, radius: number, pressure: number): void {
  KV_SOCIAL_PRESSURE_POIS.push(createPressurePoi(DEFAULT_POI_META, x, y, radius, pressure));
}

export function kvSocialPressurePoiCount(): number {
  return KV_SOCIAL_PRESSURE_POIS.length;
}

export function tagKvSocialPressurePoisSince(startIndex: number, id: KvSocialPressurePoiId): void {
  const meta = POI_META[id];
  const start = Math.max(0, Math.min(KV_SOCIAL_PRESSURE_POIS.length, startIndex));
  for (let i = start; i < KV_SOCIAL_PRESSURE_POIS.length; i++) {
    const poi = KV_SOCIAL_PRESSURE_POIS[i];
    applyPressureMeta(poi, meta);
  }
}

export function tryKvSocialPressureUprising(
  world: World,
  entities: Entity[],
  elapsedSeconds = 0,
): KvSocialPressureUprisingResult | null {
  if (KV_SOCIAL_PRESSURE_POIS.length === 0) return null;
  kvSocialPressureTime += Math.max(0, elapsedSeconds);
  if (kvSocialPressureTime < nextGlobalUprisingAt) return null;

  const len = KV_SOCIAL_PRESSURE_POIS.length;
  const start = (Math.random() * len) | 0;
  const checks = Math.min(len, MAX_POI_CHECKS_PER_TICK);
  for (let i = 0; i < checks; i++) {
    const poi = KV_SOCIAL_PRESSURE_POIS[(start + i) % len];
    if (poi.cooldownUntil > kvSocialPressureTime) continue;
    const localCitizens = countConvertibleCitizens(world, entities, poi);
    if (localCitizens < poi.minCitizens) continue;
    const chance = Math.min(0.38, poi.chanceBase + poi.pressure * poi.chancePerPressure + localCitizens * 0.004);
    if (Math.random() > chance) continue;
    const result = triggerPoiUprising(world, entities, poi, localCitizens);
    if (result) {
      poi.cooldownUntil = kvSocialPressureTime + poi.cooldownSeconds;
      poi.triggerCount++;
      nextGlobalUprisingAt = kvSocialPressureTime + GLOBAL_UPRISING_COOLDOWN;
      return result;
    }
  }
  return null;
}

export function publishKvSocialPressureUprising(state: GameState, result: KvSocialPressureUprisingResult): void {
  publishEvent(state, {
    type: 'faction_patrol_clash',
    floor: FloorLevel.KVARTIRY,
    zoneId: result.zoneId,
    roomId: result.roomId >= 0 ? result.roomId : undefined,
    x: result.x,
    y: result.y,
    actorName: result.label,
    actorFaction: Faction.CITIZEN,
    targetFaction: Faction.LIQUIDATOR,
    severity: result.converted >= 4 ? 4 : 3,
    privacy: 'local',
    tags: ['kvartiry', 'social_pressure', 'uprising', 'faction_event', ...result.tags],
    data: {
      poiId: result.poiId,
      name: `Толпа: ${result.label}`,
      text: result.message,
      outcome: result.outcome,
      converted: result.converted,
      responders: result.responders,
      radius: result.radius,
      cooldownSeconds: result.cooldownSeconds,
    },
  });
  state.msgs.push(msg(result.message, state.time, '#fa4'));
}

function createPressurePoi(meta: PressurePoiMeta, x: number, y: number, radius: number, pressure: number): PressurePoi {
  const poi: PressurePoi = {
    id: meta.id,
    label: meta.label,
    x,
    y,
    radius: Math.max(4, Math.min(meta.radiusCap, radius)),
    pressure: Math.max(0.1, Math.min(3, pressure)),
    tags: meta.tags.slice(),
    radiusCap: meta.radiusCap,
    minCitizens: meta.minCitizens,
    maxConverted: meta.maxConverted,
    maxResponders: meta.maxResponders,
    cooldownSeconds: meta.cooldownSeconds,
    chanceBase: meta.chanceBase,
    chancePerPressure: meta.chancePerPressure,
    message: meta.message,
    outcome: meta.outcome,
    cooldownUntil: 0,
    triggerCount: 0,
  };
  return poi;
}

function applyPressureMeta(poi: PressurePoi, meta: PressurePoiMeta): void {
  poi.id = meta.id;
  poi.label = meta.label;
  poi.tags = meta.tags.slice();
  poi.radiusCap = meta.radiusCap;
  poi.radius = Math.max(4, Math.min(meta.radiusCap, poi.radius));
  poi.minCitizens = meta.minCitizens;
  poi.maxConverted = meta.maxConverted;
  poi.maxResponders = meta.maxResponders;
  poi.cooldownSeconds = meta.cooldownSeconds;
  poi.chanceBase = meta.chanceBase;
  poi.chancePerPressure = meta.chancePerPressure;
  poi.message = meta.message;
  poi.outcome = meta.outcome;
}

function countConvertibleCitizens(world: World, entities: Entity[], poi: PressurePoi): number {
  let count = 0;
  const r2 = poi.radius * poi.radius;
  for (const e of entities) {
    if (!isConvertibleCitizen(e)) continue;
    if (world.dist2(e.x, e.y, poi.x, poi.y) <= r2) count++;
  }
  return count;
}

function triggerPoiUprising(
  world: World,
  entities: Entity[],
  poi: PressurePoi,
  localCitizens: number,
): KvSocialPressureUprisingResult | null {
  let converted = 0;
  const maxConverted = Math.min(poi.maxConverted, Math.max(1, localCitizens >> 1));
  const r2 = poi.radius * poi.radius;
  for (const e of entities) {
    if (converted >= maxConverted) break;
    if (!isConvertibleCitizen(e)) continue;
    if (world.dist2(e.x, e.y, poi.x, poi.y) > r2) continue;
    e.faction = Faction.WILD;
    if (e.ai) {
      e.ai.goal = AIGoal.GOTO;
      e.ai.tx = world.wrap(poi.x + (Math.random() - 0.5) * Math.min(8, poi.radius));
      e.ai.ty = world.wrap(poi.y + (Math.random() - 0.5) * Math.min(8, poi.radius));
    }
    converted++;
  }
  if (converted === 0) return null;

  let responders = 0;
  const responseRadius = Math.min(36, poi.radius + 18);
  const responseR2 = responseRadius * responseRadius;
  for (const e of entities) {
    if (responders >= poi.maxResponders) break;
    if (e.type !== EntityType.NPC || !e.alive || e.faction !== Faction.LIQUIDATOR) continue;
    if (world.dist2(e.x, e.y, poi.x, poi.y) > responseR2) continue;
    if (e.ai) {
      e.ai.goal = AIGoal.GOTO;
      e.ai.tx = world.wrap(poi.x + (Math.random() - 0.5) * 10);
      e.ai.ty = world.wrap(poi.y + (Math.random() - 0.5) * 10);
    }
    responders++;
  }

  const ci = world.idx(Math.floor(poi.x), Math.floor(poi.y));
  return {
    poiId: poi.id,
    label: poi.label,
    x: poi.x,
    y: poi.y,
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci],
    radius: poi.radius,
    converted,
    responders,
    cooldownSeconds: poi.cooldownSeconds,
    tags: poi.tags,
    message: poi.message,
    outcome: poi.outcome,
  };
}

function isConvertibleCitizen(e: Entity): boolean {
  return e.type === EntityType.NPC && e.alive && e.faction === Faction.CITIZEN && !e.plotNpcId;
}

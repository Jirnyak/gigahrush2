import {
  type Entity,
  type GameState,
  type Msg,
  type PlayerStatus,
  type PlayerStatusId,
  type PlayerStatusSource,
  type WorldEventType,
  msg,
} from '../core/types';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

export const ZHELEMISH_SKIN_ID: PlayerStatusId = 'zhelemish_skin';
export const ZHELEMISH_RAW_ITEM = 'zhelemish_raw';
const ZHELEMISH_TREATED_ITEMS = new Set(['zhelemish_dried', 'zhelemish_boiled']);

const RAW_DURATION = 180;
const TREATED_DURATION = 150;
const DEBUG_DURATION = 90;
const RAW_BAD_REACTION_CHANCE = 0.22;
const MELEE_DAMAGE_MULT = 0.7;
const MOVE_MULT = 0.82;
const HEAL_MULT = 0.55;
const WATER_DRAIN = 0.045;
const BAD_WATER_DRAIN = 0.075;
const RAW_USE_RUMOR_ID = 'zhelemish_raw_use_reaction';
const TREATED_USE_RUMOR_ID = 'zhelemish_treated_use_tradeoff';
const GOVNYAK_STATUS_IDS = new Set<PlayerStatusId>(['govnyak_relief', 'govnyak_cough', 'govnyak_debt']);
const GOVNYAK_STATUS_SOURCES = new Set<PlayerStatusSource>([
  'govnyak_roll',
  'govnyak_brick',
  'govnyak_sample',
  'govnyak_bad_batch',
]);
const PLAYER_STATUS_RESTORE_CAP = 12;
export const PAUPSINA_WEB_ID: PlayerStatusId = 'paupsina_web';
export const PAUPSINA_WEB_DURATION_SEC = 4.2;
export const PAUPSINA_WEB_ROOT_SEC = 0.65;
export const PAUPSINA_WEB_MOVE_MULT = 0.54;
export const PAUPSINA_WEB_ROOT_MULT = 0.22;
const PAUPSINA_WEB_CUT_REDUCTION_SEC = 2.6;
const PAUPSINA_WEB_FIRE_REDUCTION_SEC = 3.8;
const PAUPSINA_WEB_CUT_WEAPONS = new Set(['knife', 'axe', 'liquidator_axe', 'chainsaw', 'fire_hook', 'bayonet', 'entrenching_spade']);
export const SPORE_HAZE_ID: PlayerStatusId = 'spore_haze';
export const SPORE_HAZE_DURATION_SEC = 4.8;
export const SPORE_HAZE_PROTECTED_DURATION_SEC = 2.2;
export const SPORE_HAZE_AIM_SPREAD_MULT = 1.65;
export const SPORE_HAZE_PROTECTED_AIM_SPREAD_MULT = 1.18;
export const IP4_GASMASK_ID = 'ip4_gasmask';
const AIRBORNE_HAZARD_PROTECTION_ITEMS = new Set([
  IP4_GASMASK_ID,
  'gasmask_filter',
  'filter_layer',
  'antifungal_ointment',
]);

export interface ZhelemishApplyResult {
  status: PlayerStatus;
  refreshed: boolean;
  badReaction: boolean;
}

function zhelemishDuration(source: PlayerStatusSource): number {
  if (source === 'zhelemish_raw') return RAW_DURATION;
  if (source === 'zhelemish_treated') return TREATED_DURATION;
  return DEBUG_DURATION;
}

function sourceLabel(source: PlayerStatusSource): string {
  if (source === 'zhelemish_raw') return 'сырой';
  if (source === 'zhelemish_treated') return 'дубленый';
  return 'отладочный';
}

function sourceTags(source: PlayerStatusSource): string[] {
  if (source === 'zhelemish_raw') return ['raw_use', 'sample_spoiled'];
  if (source === 'zhelemish_treated') return ['treated_use', 'survival_tradeoff'];
  return ['debug'];
}

function useRumorIds(source: PlayerStatusSource): string[] {
  return source === 'zhelemish_raw' ? [RAW_USE_RUMOR_ID] : [TREATED_USE_RUMOR_ID];
}

function statusEvent(
  state: GameState | undefined,
  actor: Entity,
  type: WorldEventType,
  severity: 0 | 1 | 2 | 3 | 4 | 5,
  privacy: 'private' | 'witnessed',
  data?: Record<string, unknown>,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const source = typeof data?.source === 'string' ? data.source as PlayerStatusSource : undefined;
  const tags = ['player', 'status', 'zhelemish', 'condition'];
  if (source) tags.push(...sourceTags(source));
  if (data?.npcReaction) tags.push('npc_reaction');
  publishEvent(state, {
    type,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    severity,
    privacy,
    tags,
    data: { statusId: ZHELEMISH_SKIN_ID, ...data },
  });
}

export function normalizePlayerStatuses(input: unknown): PlayerStatus[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: PlayerStatus[] = [];
  for (const raw of input.slice(-PLAYER_STATUS_RESTORE_CAP)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Partial<PlayerStatus>;
    if (rec.id !== ZHELEMISH_SKIN_ID && rec.id !== PAUPSINA_WEB_ID && rec.id !== SPORE_HAZE_ID && !GOVNYAK_STATUS_IDS.has(rec.id as PlayerStatusId)) continue;
    const source = rec.id === ZHELEMISH_SKIN_ID
      ? rec.source === 'zhelemish_raw' || rec.source === 'zhelemish_treated' || rec.source === 'debug'
        ? rec.source
        : 'zhelemish_raw'
      : rec.id === PAUPSINA_WEB_ID
        ? 'paupsina_web'
        : rec.id === SPORE_HAZE_ID
          ? 'spore_carpet'
          : GOVNYAK_STATUS_SOURCES.has(rec.source as PlayerStatusSource)
            ? rec.source as PlayerStatusSource
            : 'govnyak_roll';
    const startedAt = Number.isFinite(rec.startedAt) ? Number(rec.startedAt) : 0;
    const expiresAt = Number.isFinite(rec.expiresAt) ? Number(rec.expiresAt) : 0;
    if (expiresAt <= startedAt) continue;
    const id = rec.id === ZHELEMISH_SKIN_ID
      ? ZHELEMISH_SKIN_ID
      : rec.id === PAUPSINA_WEB_ID
        ? PAUPSINA_WEB_ID
        : rec.id === SPORE_HAZE_ID
          ? SPORE_HAZE_ID
          : rec.id as PlayerStatusId;
    const cappedExpiresAt = id === PAUPSINA_WEB_ID
      ? Math.min(expiresAt, startedAt + PAUPSINA_WEB_DURATION_SEC)
      : id === SPORE_HAZE_ID
        ? Math.min(expiresAt, startedAt + SPORE_HAZE_DURATION_SEC)
      : expiresAt;
    out.push({
      id,
      source,
      startedAt,
      expiresAt: cappedExpiresAt,
      intensity: Number.isFinite(rec.intensity) ? Number(rec.intensity) : undefined,
      badReaction: rec.badReaction === true,
    });
  }
  return out.length > 0 ? out : undefined;
}

export function activeZhelemishSkin(entity: Entity, time: number): PlayerStatus | undefined {
  for (const status of entity.statuses ?? []) {
    if (status.id === ZHELEMISH_SKIN_ID && status.expiresAt > time) return status;
  }
  return undefined;
}

export function activePaupsinaWeb(entity: Entity, time: number): PlayerStatus | undefined {
  for (const status of entity.statuses ?? []) {
    if (status.id === PAUPSINA_WEB_ID && status.expiresAt > time) return status;
  }
  return undefined;
}

export function activeSporeHaze(entity: Entity, time: number): PlayerStatus | undefined {
  for (const status of entity.statuses ?? []) {
    if (status.id === SPORE_HAZE_ID && status.expiresAt > time) return status;
  }
  return undefined;
}

export function hasAirborneHazardProtection(entity: Entity): boolean {
  if (entity.tool === IP4_GASMASK_ID) return true;
  for (const item of entity.inventory ?? []) {
    if (item.count <= 0) continue;
    if (AIRBORNE_HAZARD_PROTECTION_ITEMS.has(item.defId)) return true;
  }
  return false;
}

export function hasSporeHazeProtection(entity: Entity): boolean {
  return hasAirborneHazardProtection(entity);
}

export function applySporeHaze(
  entity: Entity,
  time: number,
  msgs?: Msg[],
  state?: GameState,
  source?: Entity,
): PlayerStatus {
  const protectedByGear = hasAirborneHazardProtection(entity);
  const duration = protectedByGear ? SPORE_HAZE_PROTECTED_DURATION_SEC : SPORE_HAZE_DURATION_SEC;
  if (!entity.statuses) entity.statuses = [];
  const existing = entity.statuses.find(s => s.id === SPORE_HAZE_ID);
  const status: PlayerStatus = {
    id: SPORE_HAZE_ID,
    source: 'spore_carpet',
    startedAt: time,
    expiresAt: time + duration,
    intensity: protectedByGear ? 0.35 : 1,
  };
  if (existing) Object.assign(existing, status);
  else entity.statuses.push(status);

  if (msgs && isPlayerEntity(entity)) {
    msgs.push(msg(
      protectedByGear
        ? 'Фильтр поймал споры ковра: прицел мутнеет ненадолго.'
        : 'Ковер выдохнул споры: глаза слезятся, прицел плывет.',
      time,
      protectedByGear ? '#9cf' : '#bf8',
    ));
  }
  if (state && isPlayerEntity(entity)) {
    publishEvent(state, {
      type: 'player_status_applied',
      actorId: source?.id,
      actorName: source?.name,
      actorFaction: source?.faction,
      targetId: entity.id,
      targetName: entity.name ?? 'Вы',
      targetFaction: entity.faction,
      monsterKind: source?.monsterKind,
      severity: protectedByGear ? 2 : 4,
      privacy: 'local',
      tags: ['player', 'monster', 'spore_carpet', 'spores', 'status', protectedByGear ? 'protected' : 'haze'],
      data: {
        statusId: SPORE_HAZE_ID,
        duration,
        protectedByGear,
        aimSpreadMult: protectedByGear ? SPORE_HAZE_PROTECTED_AIM_SPREAD_MULT : SPORE_HAZE_AIM_SPREAD_MULT,
        rumorIds: ['monster_spore_carpet_lifted_corner', 'ecology_spore_carpet_fire_salt'],
      },
    });
  }
  return existing ?? status;
}

export function applyPaupsinaWeb(
  entity: Entity,
  time: number,
  msgs?: Msg[],
  state?: GameState,
  source?: Entity,
): PlayerStatus {
  if (!entity.statuses) entity.statuses = [];
  const existing = entity.statuses.find(s => s.id === PAUPSINA_WEB_ID);
  const status: PlayerStatus = {
    id: PAUPSINA_WEB_ID,
    source: 'paupsina_web',
    startedAt: time,
    expiresAt: time + PAUPSINA_WEB_DURATION_SEC,
    intensity: 1,
  };
  if (existing) Object.assign(existing, status);
  else entity.statuses.push(status);

  if (msgs && isPlayerEntity(entity)) {
    msgs.push(msg('Паупсина плюнула сетью: ноги липнут, но нож или огонь быстро рвут путы.', time, '#ddd'));
  }
  if (state) {
    publishEvent(state, {
      type: 'paupsina_webbed',
      actorId: source?.id,
      actorName: source?.name,
      actorFaction: source?.faction,
      targetId: entity.id,
      targetName: entity.name ?? (isPlayerEntity(entity) ? 'Вы' : undefined),
      targetFaction: entity.faction,
      monsterKind: source?.monsterKind,
      severity: isPlayerEntity(entity) ? 4 : 3,
      privacy: isPlayerEntity(entity) ? 'local' : 'witnessed',
      tags: ['monster', 'paupsina', 'web', 'status', 'control'],
      data: {
        statusId: PAUPSINA_WEB_ID,
        duration: PAUPSINA_WEB_DURATION_SEC,
        rootSec: PAUPSINA_WEB_ROOT_SEC,
        moveMult: PAUPSINA_WEB_MOVE_MULT,
        counterplay: 'cut_or_burn_web_break_line_of_sight',
        rumorIds: ['monster_paupsina_web', 'ecology_paupsina_cut_fire'],
      },
    });
  }
  return existing ?? status;
}

export function isPaupsinaWebCuttingWeapon(weaponId: string | undefined): boolean {
  return !!weaponId && PAUPSINA_WEB_CUT_WEAPONS.has(weaponId);
}

export function reducePaupsinaWeb(
  entity: Entity,
  time: number,
  msgs?: Msg[],
  state?: GameState,
  actor?: Entity,
  method: 'cut' | 'fire' = 'cut',
): boolean {
  const status = activePaupsinaWeb(entity, time);
  if (!status) return false;
  const reduction = method === 'fire' ? PAUPSINA_WEB_FIRE_REDUCTION_SEC : PAUPSINA_WEB_CUT_REDUCTION_SEC;
  const before = status.expiresAt;
  status.expiresAt = Math.min(status.expiresAt, time + Math.max(0, before - time - reduction));
  const freed = status.expiresAt <= time + 0.15;
  if (freed && entity.statuses) {
    const idx = entity.statuses.indexOf(status);
    if (idx >= 0) entity.statuses.splice(idx, 1);
    if (entity.statuses.length === 0) delete entity.statuses;
  }
  if (msgs && isPlayerEntity(entity)) {
    msgs.push(msg(method === 'fire' ? 'Огонь схватил паутину: липкая сеть спала.' : 'Лезвие режет паутину: сеть уже не держит.', time, '#8cf'));
  }
  if (state) {
    publishEvent(state, {
      type: 'paupsina_web_cut',
      actorId: actor?.id,
      actorName: actor?.name ?? (actor?.id === entity.id && isPlayerEntity(entity) ? 'Вы' : undefined),
      actorFaction: actor?.faction,
      targetId: entity.id,
      targetName: entity.name ?? (isPlayerEntity(entity) ? 'Вы' : undefined),
      targetFaction: entity.faction,
      severity: 3,
      privacy: isPlayerEntity(entity) ? 'local' : 'witnessed',
      tags: ['monster', 'paupsina', 'web', method, freed ? 'freed' : 'reduced'],
      data: {
        statusId: PAUPSINA_WEB_ID,
        method,
        reduction,
        remaining: freed ? 0 : Math.max(0, status.expiresAt - time),
      },
    });
  }
  return true;
}

export function paupsinaWebMoveMult(entity: Entity, time: number): number {
  const status = activePaupsinaWeb(entity, time);
  if (!status) return 1;
  return time - status.startedAt < PAUPSINA_WEB_ROOT_SEC ? PAUPSINA_WEB_ROOT_MULT : PAUPSINA_WEB_MOVE_MULT;
}

export function isZhelemishSkinItem(itemId: string): boolean {
  return itemId === ZHELEMISH_RAW_ITEM || ZHELEMISH_TREATED_ITEMS.has(itemId);
}

export function zhelemishSourceForItem(itemId: string): PlayerStatusSource | null {
  if (itemId === ZHELEMISH_RAW_ITEM) return 'zhelemish_raw';
  if (ZHELEMISH_TREATED_ITEMS.has(itemId)) return 'zhelemish_treated';
  return null;
}

export function isZhelemishCureItem(itemId: string): boolean {
  return itemId === 'antifungal_ointment' || itemId === 'antibiotic';
}

export function applyZhelemishSkin(
  entity: Entity,
  time: number,
  source: PlayerStatusSource,
  state?: GameState,
  rng: () => number = Math.random,
): ZhelemishApplyResult {
  const duration = zhelemishDuration(source);
  const badReaction = source === 'zhelemish_raw' && rng() < RAW_BAD_REACTION_CHANCE;
  if (!entity.statuses) entity.statuses = [];
  const existing = entity.statuses.find(s => s.id === ZHELEMISH_SKIN_ID);
  const refreshed = existing !== undefined;
  const status: PlayerStatus = {
    id: ZHELEMISH_SKIN_ID,
    source,
    startedAt: time,
    expiresAt: time + duration,
    badReaction,
  };
  if (existing) Object.assign(existing, status);
  else entity.statuses.push(status);

  if (badReaction) {
    if (entity.needs) entity.needs.water = Math.max(0, entity.needs.water - 8);
    if (entity.rpg) entity.rpg.psi = Math.max(0, entity.rpg.psi - 2);
  }

  statusEvent(state, entity, 'player_status_applied', 3, 'private', {
    source,
    duration,
    refreshed,
    incomingMeleeDamageMult: MELEE_DAMAGE_MULT,
    moveMult: MOVE_MULT,
    healMult: HEAL_MULT,
    waterDrainPerSecond: WATER_DRAIN,
    badWaterDrainPerSecond: BAD_WATER_DRAIN,
    outcome: source === 'zhelemish_raw' ? 'raw_eaten_sample_spoiled' : 'treated_survival_use',
    bounded: true,
    rumorIds: useRumorIds(source),
  });
  if (badReaction) {
    statusEvent(state, entity, 'player_status_bad_reaction', 4, 'witnessed', {
      source,
      waterLoss: 8,
      psiLoss: 2,
      outcome: 'raw_bad_reaction',
      npcReaction: 'sanitary_witness',
      rumorIds: [RAW_USE_RUMOR_ID],
    });
  }
  return { status: existing ?? status, refreshed, badReaction };
}

export function applyZhelemishSkinWithMessage(
  entity: Entity,
  time: number,
  msgs: Msg[],
  source: PlayerStatusSource,
  state?: GameState,
  rng?: () => number,
): ZhelemishApplyResult {
  const result = applyZhelemishSkin(entity, time, source, state, rng);
  const verb = result.refreshed ? 'обновился' : 'сел на кожу';
  const tradeoff = source === 'zhelemish_raw'
    ? 'еда сейчас, проба испорчена'
    : 'обработанный запас, но не настоящее лечение';
  msgs.push(msg(
    `Желемыш ${sourceLabel(source)} ${verb}: ${tradeoff}; ход вязнет, лечение хуже, вода уходит.`,
    time,
    '#9c6',
  ));
  if (result.badReaction) {
    msgs.push(msg('Плохая реакция: сушит горло, ПСИ шумит, от вас отворачиваются.', time, '#d68'));
  }
  return result;
}

export function cureZhelemishSkin(
  entity: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
  reason = 'medicine',
): boolean {
  const statuses = entity.statuses;
  if (!statuses) return false;
  const idx = statuses.findIndex(s => s.id === ZHELEMISH_SKIN_ID && s.expiresAt > time);
  if (idx < 0) return false;
  const [removed] = statuses.splice(idx, 1);
  if (statuses.length === 0) delete entity.statuses;
  msgs.push(msg('Желемышная кожа сошла. Тело снова лечится обычно.', time, '#8cf'));
  statusEvent(state, entity, 'player_status_cured', 3, 'private', {
    source: removed.source,
    reason,
    remaining: Math.max(0, removed.expiresAt - time),
  });
  return true;
}

export function cureSporeHaze(
  entity: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
  reason = 'medicine',
): boolean {
  const statuses = entity.statuses;
  if (!statuses) return false;
  const idx = statuses.findIndex(s => s.id === SPORE_HAZE_ID && s.expiresAt > time);
  if (idx < 0) return false;
  const [removed] = statuses.splice(idx, 1);
  if (statuses.length === 0) delete entity.statuses;
  msgs.push(msg(
    reason === 'anti_spore_inhaler'
      ? 'Ингалятор выбил споры из дыхания. Прицел снова слушается.'
      : 'Мазь связала споры. Прицел снова слушается.',
    time,
    '#8cf',
  ));
  if (state && isPlayerEntity(entity)) {
    publishEvent(state, {
      type: 'player_status_cured',
      actorId: entity.id,
      actorName: entity.name ?? 'Вы',
      actorFaction: entity.faction,
      severity: 3,
      privacy: 'private',
      tags: ['player', 'status', 'spore_carpet', 'spores', 'fungus', 'cured'],
      data: {
        statusId: SPORE_HAZE_ID,
        source: removed.source,
        reason,
        remaining: Math.max(0, removed.expiresAt - time),
      },
    });
  }
  return true;
}

export function updateZhelemishSkinStatus(entity: Entity, state: GameState, dt: number): void {
  const statuses = entity.statuses;
  if (!statuses) return;
  for (let i = statuses.length - 1; i >= 0; i--) {
    const status = statuses[i];
    if (status.id === PAUPSINA_WEB_ID) {
      if (status.expiresAt <= state.time) {
        statuses.splice(i, 1);
        if (isPlayerEntity(entity)) state.msgs.push(msg('Паутинные путы осыпались сухой ниткой.', state.time, '#8cf'));
      }
      continue;
    }
    if (status.id === SPORE_HAZE_ID) {
      if (status.expiresAt <= state.time) {
        statuses.splice(i, 1);
        if (isPlayerEntity(entity)) state.msgs.push(msg('Споровая муть выветрилась.', state.time, '#8cf'));
      }
      continue;
    }
    if (status.id !== ZHELEMISH_SKIN_ID) continue;
    if (status.expiresAt <= state.time) {
      statuses.splice(i, 1);
      state.msgs.push(msg('Желемышная кожа высохла и отвалилась.', state.time, '#8cf'));
      statusEvent(state, entity, 'player_status_expired', 2, 'private', { source: status.source });
    } else if (entity.needs) {
      const drain = (status.badReaction ? BAD_WATER_DRAIN : WATER_DRAIN) * dt;
      entity.needs.water = Math.max(0, entity.needs.water - drain);
    }
  }
  if (statuses.length === 0) delete entity.statuses;
}

export function zhelemishMoveMult(entity: Entity, time: number): number {
  return (activeZhelemishSkin(entity, time) ? MOVE_MULT : 1) * paupsinaWebMoveMult(entity, time);
}

export function sporeHazeAimSpreadMult(entity: Entity, time = 0): number {
  const status = activeSporeHaze(entity, time);
  if (!status) return 1;
  return (status.intensity ?? 1) < 0.5 ? SPORE_HAZE_PROTECTED_AIM_SPREAD_MULT : SPORE_HAZE_AIM_SPREAD_MULT;
}

export function zhelemishHealingMult(entity: Entity, time: number): number {
  return activeZhelemishSkin(entity, time) ? HEAL_MULT : 1;
}

export function zhelemishIncomingMeleeDamage(entity: Entity, time: number, damage: number): number {
  if (!activeZhelemishSkin(entity, time)) return damage;
  return Math.max(1, Math.round(damage * MELEE_DAMAGE_MULT));
}

export function zhelemishHudLine(entity: Entity, time: number): string | null {
  const web = activePaupsinaWeb(entity, time);
  if (web) {
    const left = Math.max(0, Math.ceil(web.expiresAt - time));
    return `ПАУТИНА ${left}s  ход -${Math.round((1 - paupsinaWebMoveMult(entity, time)) * 100)}%  нож/огонь`;
  }
  const haze = activeSporeHaze(entity, time);
  if (haze) {
    const left = Math.max(0, Math.ceil(haze.expiresAt - time));
    return `СПОРЫ ${left}s  прицел x${sporeHazeAimSpreadMult(entity, time).toFixed(1)}  фильтр/соль`;
  }
  const status = activeZhelemishSkin(entity, time);
  if (!status) return null;
  const left = Math.max(0, Math.ceil(status.expiresAt - time));
  const raw = status.source === 'zhelemish_raw' ? 'сыр' : 'дуб';
  const bad = status.badReaction ? '!' : '';
  return `ЖЕЛЕМЫШ${bad} ${raw} ${left}s  вход.удар -30%  ход -18%  вода`;
}

export function zhelemishStatsLine(entity: Entity, time: number): string | null {
  const web = activePaupsinaWeb(entity, time);
  if (web) {
    const left = Math.max(0, Math.ceil(web.expiresAt - time));
    return `Паупсина сеть: ${left}s из ${PAUPSINA_WEB_DURATION_SEC}s, короткий корень и ход -${Math.round((1 - PAUPSINA_WEB_MOVE_MULT) * 100)}%; нож, багор, топор, бензопила или огонь снимают быстрее`;
  }
  const haze = activeSporeHaze(entity, time);
  if (haze) {
    const left = Math.max(0, Math.ceil(haze.expiresAt - time));
    return `Споры ковра: ${left}s, разброс x${sporeHazeAimSpreadMult(entity, time).toFixed(2)}; фильтр, соль или огонь сокращают риск`;
  }
  const status = activeZhelemishSkin(entity, time);
  if (!status) return null;
  const left = Math.max(0, Math.ceil(status.expiresAt - time));
  const reaction = status.badReaction ? ' реакция: вода/ПСИ хуже' : '';
  return `Желемыш ${sourceLabel(status.source)}: ${left}s из ${zhelemishDuration(status.source)}s, входящий удар -30%, ход -18%, лечение -45%, вода уходит${reaction}`;
}

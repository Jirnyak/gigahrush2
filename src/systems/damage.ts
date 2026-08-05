import { EntityType, MonsterKind, type Entity, type GameState, type PlayerDamageRecord, type PlayerDamageSourceKind } from '../core/types';
import { isNoClipActive } from './psi';
import type { World } from '../core/world';
import { isPlayerEntity } from './player_actor';
import { MONSTERS, entityDisplayName } from '../entities/monster';

const DEATH_CAUSE_LOOKBACK_SEC = 4;
const DEATH_CAUSE_LOOKAHEAD_SEC = 1.5;

function roundDamage(amount: number): number {
  return Math.max(0, Math.round(amount * 10) / 10);
}

function formatDamageAmount(amount: number): string {
  const rounded = roundDamage(amount);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function normalizeDamageDetail(detail: string, amount: number): string {
  const raw = String(amount);
  const formatted = formatDamageAmount(amount);
  if (raw === formatted) return detail;
  return detail.split(`-${raw}`).join(`-${formatted}`).split(`+${raw}`).join(`+${formatted}`);
}

function damageSourceKind(source: Entity | undefined): PlayerDamageSourceKind {
  if (!source) return 'unknown';
  if (source.type === EntityType.MONSTER) return 'monster';
  if (source.type === EntityType.NPC) return 'npc';
  if (source.type === EntityType.PROJECTILE) return 'projectile';
  return 'unknown';
}

function sourceName(source: Entity | undefined, kind: PlayerDamageSourceKind): string {
  switch (kind) {
    case 'monster':
    case 'npc':
      if (source) return entityDisplayName(source);
      return kind === 'monster' ? 'монстр' : 'жилец';
    case 'projectile':
      return source?.name ?? 'снаряд';
    case 'hazard': return 'опасная зона';
    case 'need': return 'истощение';
    case 'samosbor': return 'самосбор';
    case 'void': return 'правило Пустоты';
    default: return 'неизвестный источник';
  }
}

function explicitFailureDetail(source: Entity | undefined, amount: number): string | undefined {
  if (source?.monsterKind === undefined) return undefined;
  const cause = MONSTERS[source.monsterKind]?.boss?.deathCause;
  return cause ? `${cause}: -${formatDamageAmount(amount)}` : undefined;
}

export function recordPlayerDamage(
  state: GameState | undefined,
  source: Entity | undefined,
  amount: number,
  detail?: string,
  sourceKind: PlayerDamageSourceKind = damageSourceKind(source),
): void {
  if (!state || !Number.isFinite(amount) || amount <= 0) return;
  const rounded = roundDamage(amount);
  const amountLabel = formatDamageAmount(rounded);
  const name = sourceName(source, sourceKind);
  const failureDetail = explicitFailureDetail(source, rounded);
  state.lastDamage = {
    time: state.time,
    tick: state.tick,
    amount: rounded,
    sourceKind,
    sourceId: source?.id,
    sourceName: name,
    monsterKind: source?.monsterKind,
    weaponId: source?.weapon,
    detail: failureDetail ?? (detail && detail.length > 0 ? normalizeDamageDetail(detail, amount) : `${name}: -${amountLabel}`),
  };
}

export function formatLastPlayerDamageCause(
  state: GameState,
  deathTime: number,
): string | undefined {
  const last: PlayerDamageRecord | undefined = state.lastDamage;
  if (!last) return undefined;
  if (last.time < deathTime - DEATH_CAUSE_LOOKBACK_SEC || last.time > deathTime + DEATH_CAUSE_LOOKAHEAD_SEC) return undefined;
  return last.detail || `${last.sourceName}: -${last.amount}`;
}

export function hasFreshPlayerDamageRecord(state: GameState, tick: number, time: number): boolean {
  const last = state.lastDamage;
  return !!last && last.tick === tick && Math.abs(last.time - time) <= 0.05;
}

export function updateBlockCrushDamage(
  world: World,
  entities: readonly Entity[],
  state: GameState,
  dt: number,
): void {
  const DAMAGE_PER_SECOND = 10;
  for (const e of entities) {
    if (!e.alive) continue;
    if (e.type !== EntityType.NPC && e.type !== EntityType.MONSTER && !isPlayerEntity(e)) continue;

    // Skip noclippers and entities in phasing state
    if (e.phasing) continue;
    if (isPlayerEntity(e) && isNoClipActive()) continue;
    if (e.monsterKind === MonsterKind.LOZHNYY_DUKH && (e.ai?.falsePhaseActive ?? 0) > 0) continue;

    if (world.solid(Math.floor(e.x), Math.floor(e.y))) {
      const dmg = DAMAGE_PER_SECOND * dt;
      if (isPlayerEntity(e)) {
        e.hp = Math.max(1, (e.hp ?? 1) - dmg);
        if (Math.random() < dt * 2) {
          state.dmgFlash = Math.max(state.dmgFlash ?? 0, 0.15);
        }
        recordPlayerDamage(state, undefined, dmg, 'Раздавлен в структуре', 'hazard');
      } else {
        if (typeof e.hp === 'number' && e.hp > 0) {
          e.hp -= dmg;
          if (e.hp <= 0) {
            e.alive = false;
          }
        }
      }
    }
  }
}


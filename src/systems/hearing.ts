import type { Entity } from '../core/types';
import {
  DEFAULT_HEARING_RADIUS_METERS,
  HEARING_TOOL_BONUS_METERS,
  MAX_HEARING_RADIUS_METERS,
} from '../data/hearing_tools';

function finiteRadius(value: number | undefined): number {
  return Number.isFinite(value) ? value! : DEFAULT_HEARING_RADIUS_METERS;
}

export function hearingRadiusMetersForActor(actor: Pick<Entity, 'tool'> | undefined, baseRadius?: number): number {
  const base = finiteRadius(baseRadius);
  const bonus = actor?.tool ? HEARING_TOOL_BONUS_METERS[actor.tool] ?? 0 : 0;
  return Math.max(0, Math.min(MAX_HEARING_RADIUS_METERS, Math.round(base + bonus)));
}

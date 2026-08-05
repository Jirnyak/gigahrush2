import type { Entity, GameState } from '../../core/types';
import type { World } from '../../core/world';

export const BAD_APPLE_EXPERIMENT_ENABLED = false;
export const BAD_APPLE_WIDTH = 144;
export const BAD_APPLE_HEIGHT = 108;
export const BAD_APPLE_FRAME_COUNT = 6470;
const BAD_APPLE_PROJECTOR_SOUND_MARGIN = 32;
export const BAD_APPLE_PROJECTOR_SOUND_RADIUS = Math.ceil(Math.hypot(BAD_APPLE_WIDTH, BAD_APPLE_HEIGHT) * 0.5 + BAD_APPLE_PROJECTOR_SOUND_MARGIN);

export interface BadApplePlacement {
  roomId: number;
  x: number;
  y: number;
  projectorX: number;
  projectorY: number;
}

export function badAppleScreenSoundPosition(screen: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return {
    x: screen.x + screen.w * 0.5,
    y: screen.y + screen.h * 0.5,
  };
}

export function badAppleSiteScore(_world: World, _x: number, _y: number, _protectedX: number, _protectedY: number): number {
  return Number.POSITIVE_INFINITY;
}

export function findBadAppleSiteNear(world: World, centerX: number, centerY: number): { x: number; y: number } {
  return { x: world.wrap(Math.floor(centerX)), y: world.wrap(Math.floor(centerY)) };
}

export function stampBadAppleWorld(world: World, x: number, y: number, _connectFrom?: { x: number; y: number }): BadApplePlacement {
  return {
    roomId: -1,
    x: world.wrap(Math.floor(x)),
    y: world.wrap(Math.floor(y)),
    projectorX: -1,
    projectorY: -1,
  };
}

export function updateBadAppleWorldAnomaly(_world: World, _player: Entity, _state: GameState, _dt: number): void {
}

export function badAppleWorldInteractionTargetId(_world: World, _lookX: number, _lookY: number): number | null {
  return null;
}

export function tryUseBadAppleWorldAnomaly(_world: World, _player: Entity, _state: GameState, _lookX: number, _lookY: number): boolean {
  return false;
}

export function debugSpawnBadAppleWorld(_world: World, _player: Entity, _state: GameState): string[] {
  return ['Bad Apple experiment is disabled in main builds; source data is retained outside the shipped path.'];
}

export function relightBadAppleWorld(_world: World): void {
}

export function summarizeBadAppleWorld(_world: World): string[] {
  return [];
}

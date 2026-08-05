import { crittersEnabled } from '../systems/ui_orchestrator';

/**
 * Returns whether critters (and small particles like flies/roaches) should be rendered.
 * Automatically disables them on mobile devices (maxTouchPoints > 0) or if the UI toggle is disabled.
 * A runtime FPS check can optionally be passed to disable them below 30 FPS.
 */
export function getCritterRenderEnabled(fps?: number): boolean {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
    return false;
  }
  if (fps !== undefined && fps < 30) {
    return false;
  }
  return crittersEnabled();
}

/* ── Universal input intent layer ─────────────────────────────────
 *
 * Pure runtime types/functions that sit between input devices (keyboard,
 * mouse, touch, physical gamepad, future virtual gamepad overlay) and the
 * existing `InputState` consumers in `main.ts`/menus. Adapters write into an
 * `InputFrame` each tick; `resolveInputFrameToInputState()` folds it into the
 * legacy `InputState` shape without altering keyboard/mouse semantics.
 *
 * This module does not touch the DOM, Gamepad API, save/load, gameplay or
 * render. See `xinput.md` for the design contract.
 */

import { type InputState } from '../core/types';
import {
  CONTROL_ACTIONS,
  type ControlActionId,
} from './controls';

export type InputDeviceKind = 'keyboard_mouse' | 'gamepad' | 'touch';

export type InputAxisId = 'moveX' | 'moveY' | 'lookX' | 'lookY';

export type MenuNavId = 'up' | 'down' | 'left' | 'right';

export interface InputFrame {
  axes: { moveX: number; moveY: number; lookX: number; lookY: number };
  heldActions: Set<ControlActionId>;
  pressedActions: Set<ControlActionId>;
  releasedActions: Set<ControlActionId>;
  menuNav: { up: boolean; down: boolean; left: boolean; right: boolean };
  activeDevice: InputDeviceKind;
  hardware: {
    gamepadConnected: boolean;
    gamepadMappingStandard: boolean;
    gamepadLabel: string;
  };
}

export function createInputFrame(): InputFrame {
  return {
    axes: { moveX: 0, moveY: 0, lookX: 0, lookY: 0 },
    heldActions: new Set(),
    pressedActions: new Set(),
    releasedActions: new Set(),
    menuNav: { up: false, down: false, left: false, right: false },
    activeDevice: 'keyboard_mouse',
    hardware: { gamepadConnected: false, gamepadMappingStandard: false, gamepadLabel: '' },
  };
}

export function beginInputFrame(frame: InputFrame): void {
  frame.axes.moveX = 0;
  frame.axes.moveY = 0;
  frame.axes.lookX = 0;
  frame.axes.lookY = 0;
  frame.heldActions.clear();
  frame.pressedActions.clear();
  frame.releasedActions.clear();
  frame.menuNav.up = false;
  frame.menuNav.down = false;
  frame.menuNav.left = false;
  frame.menuNav.right = false;
}

function clamp1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

export function mergeAxis(frame: InputFrame, axis: InputAxisId, value: number): void {
  if (!Number.isFinite(value) || value === 0) return;
  const cur = frame.axes[axis];
  frame.axes[axis] = clamp1(cur + value);
}

export function setActionHeld(frame: InputFrame, actionId: ControlActionId, held: boolean): void {
  if (held) frame.heldActions.add(actionId);
}

export function pressAction(frame: InputFrame, actionId: ControlActionId): void {
  frame.pressedActions.add(actionId);
  frame.heldActions.add(actionId);
}

export function releaseAction(frame: InputFrame, actionId: ControlActionId): void {
  frame.releasedActions.add(actionId);
}

export function setMenuNav(frame: InputFrame, nav: MenuNavId, on: boolean): void {
  if (!on) return;
  frame.menuNav[nav] = true;
}

export function setActiveDevice(frame: InputFrame, device: InputDeviceKind): void {
  frame.activeDevice = device;
}

/* ── Math helpers used by physical gamepad and virtual overlay ──── */

export function applyStickDeadzone(
  x: number,
  y: number,
  deadzone: number,
  exponent: number,
): { x: number; y: number } {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  const len = Math.hypot(ax, ay);
  if (len <= deadzone || len <= 0) return { x: 0, y: 0 };
  const t = Math.min(1, (len - deadzone) / Math.max(1e-6, 1 - deadzone));
  const scaled = Math.pow(t, Math.max(0.01, exponent)) / len;
  return { x: clamp1(ax * scaled), y: clamp1(ay * scaled) };
}

export function applyTriggerCurve(
  value: number,
  held: number,
  edge: number,
): { held: boolean; pressed: boolean; analog: number } {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const analog = v > held ? (v - held) / Math.max(1e-6, 1 - held) : 0;
  return { held: v >= held, pressed: v >= edge, analog: clamp1(analog) };
}

/* ── Compatibility resolver ────────────────────────────────────── */

/**
 * Map the action-side of an `InputFrame` back into the existing `InputState`.
 *
 * Axes are NOT written into `input.touch.*` because the touch DOM adapter
 * sets those fields directly to its stick values. Mixing additive gamepad
 * contributions with direct touch writes leads to either accumulation or
 * cancellation; instead, `main.ts` reads `frame.axes` alongside
 * `input.touch.*` when composing movement and look.
 */
export interface ResolverContext {
  writeMenuEdgesFromActions: boolean;
}

const ACTION_INPUT_LOOKUP: Map<ControlActionId, Extract<keyof InputState, string>> = (() => {
  const map = new Map<ControlActionId, Extract<keyof InputState, string>>();
  for (const def of CONTROL_ACTIONS) {
    const inputKey = (def as { input?: string }).input;
    if (typeof inputKey === 'string') {
      map.set(def.id as ControlActionId, inputKey as Extract<keyof InputState, string>);
    }
  }
  return map;
})();

export function resolveInputFrameToInputState(
  frame: InputFrame,
  input: InputState,
  ctx: ResolverContext,
): void {
  for (const actionId of frame.heldActions) {
    if (actionId === 'interact') continue;
    const inputKey = ACTION_INPUT_LOOKUP.get(actionId);
    if (!inputKey) continue;
    (input as unknown as Record<string, boolean>)[inputKey] = true;
  }

  for (const actionId of frame.pressedActions) {
    if (actionId === 'interact') {
      input.interact = true;
      input.interactHeld = true;
    }
  }

  for (const actionId of frame.releasedActions) {
    if (actionId === 'interact') {
      input.interactHeld = false;
      continue;
    }
    if (frame.heldActions.has(actionId)) continue;
    const inputKey = ACTION_INPUT_LOOKUP.get(actionId);
    if (!inputKey) continue;
    (input as unknown as Record<string, boolean>)[inputKey] = false;
  }

  if (frame.menuNav.up) input.invUp = true;
  if (frame.menuNav.down) input.invDn = true;
  if (frame.menuNav.left) input.invLeft = true;
  if (frame.menuNav.right) input.invRight = true;

  if (ctx.writeMenuEdgesFromActions) {
    if (frame.pressedActions.has('gameMenu')) input.menuAccept = true;
    if (frame.pressedActions.has('menuClose')) input.menuClose = true;
  }
}

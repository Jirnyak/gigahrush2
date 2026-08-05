import { safeParseJson } from '../core/json';

/* ── Gamepad settings (browser-local, not part of save) ──────────
 *
 * Persistent, sanitized configuration for physical gamepad input. Stored
 * under its own `localStorage` key separate from `gigahrush_save` and
 * `gigahrush_control_bindings_v7`. No save shape bump, no migration
 * scaffolding: unknown payload → defaults. See `xinput.md`.
 */

export type GamepadProfileId = 'standard_xinput';

export interface GamepadSettings {
  version: 1;
  enabled: boolean;
  profile: GamepadProfileId;
  invertLookY: boolean;
  moveDeadzone: number;
  lookDeadzone: number;
  triggerThreshold: number;
  moveCurve: number;
  lookCurve: number;
  lookSensitivity: number;
  haptics: boolean;
  virtualGamepad: {
    enabled: boolean;
    layout: 'compact' | 'full';
    opacity: number;
  };
}

export const GAMEPAD_SETTINGS_KEY = 'gigahrush_gamepad_settings_v1';

const KNOWN_PROFILES: readonly GamepadProfileId[] = ['standard_xinput'];
const KNOWN_LAYOUTS = ['compact', 'full'] as const;

export function defaultGamepadSettings(): GamepadSettings {
  return {
    version: 1,
    enabled: true,
    profile: 'standard_xinput',
    invertLookY: false,
    moveDeadzone: 0.18,
    lookDeadzone: 0.16,
    triggerThreshold: 0.35,
    moveCurve: 1.15,
    lookCurve: 1.65,
    lookSensitivity: 1.0,
    haptics: true,
    virtualGamepad: {
      enabled: false,
      layout: 'compact',
      opacity: 0.6,
    },
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function sanitizeGamepadSettings(raw: unknown): GamepadSettings {
  const d = defaultGamepadSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const src = raw as Record<string, unknown>;
  if (src.version !== 1) return d;
  const vg = (src.virtualGamepad && typeof src.virtualGamepad === 'object' && !Array.isArray(src.virtualGamepad))
    ? (src.virtualGamepad as Record<string, unknown>)
    : {};
  return {
    version: 1,
    enabled: boolOr(src.enabled, d.enabled),
    profile: pickEnum(src.profile, KNOWN_PROFILES, d.profile),
    invertLookY: boolOr(src.invertLookY, d.invertLookY),
    moveDeadzone: clamp(src.moveDeadzone, 0, 0.6, d.moveDeadzone),
    lookDeadzone: clamp(src.lookDeadzone, 0, 0.6, d.lookDeadzone),
    triggerThreshold: clamp(src.triggerThreshold, 0.05, 0.95, d.triggerThreshold),
    moveCurve: clamp(src.moveCurve, 0.5, 4, d.moveCurve),
    lookCurve: clamp(src.lookCurve, 0.5, 4, d.lookCurve),
    lookSensitivity: clamp(src.lookSensitivity, 0.1, 4, d.lookSensitivity),
    haptics: boolOr(src.haptics, d.haptics),
    virtualGamepad: {
      enabled: boolOr(vg.enabled, d.virtualGamepad.enabled),
      layout: pickEnum(vg.layout, KNOWN_LAYOUTS, d.virtualGamepad.layout),
      opacity: clamp(vg.opacity, 0.1, 1, d.virtualGamepad.opacity),
    },
  };
}

let cached: GamepadSettings | null = null;

export function loadGamepadSettings(): GamepadSettings {
  if (cached) return cached;
  const s = storage();
  if (!s) {
    cached = defaultGamepadSettings();
    return cached;
  }
  try {
    const raw = s.getItem(GAMEPAD_SETTINGS_KEY);
    cached = sanitizeGamepadSettings(raw == null ? null : safeParseJson(raw));
  } catch {
    cached = defaultGamepadSettings();
  }
  return cached;
}

export function saveGamepadSettings(next: GamepadSettings): void {
  const sane = sanitizeGamepadSettings(next);
  cached = sane;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(GAMEPAD_SETTINGS_KEY, JSON.stringify(sane));
  } catch {
    // Local storage can be blocked. In-memory cache still applies.
  }
}

export function updateGamepadSettings(patch: Partial<GamepadSettings>): GamepadSettings {
  const merged: GamepadSettings = { ...loadGamepadSettings(), ...patch };
  if (patch.virtualGamepad) {
    merged.virtualGamepad = { ...loadGamepadSettings().virtualGamepad, ...patch.virtualGamepad };
  }
  saveGamepadSettings(merged);
  return loadGamepadSettings();
}

export function resetGamepadSettings(): void {
  cached = null;
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(GAMEPAD_SETTINGS_KEY);
  } catch {
    // ignore — defaults will still apply on next load.
  }
}

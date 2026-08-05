import { type Entity } from '../core/types';
import { SURFACE_FLAG_CHALK_MAP, type World } from '../core/world';
import { paintSurfacePixel } from './surface_marks';

export const CHALK_ITEM_ID = 'chalk';
const CHALK_PIXEL_ALPHA = 235;

export interface ChalkItemData {
  dur?: number;
  rgb?: [number, number, number];
}

function colorByte(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(255, Math.floor(n)));
}

function randomVisibleByte(): number {
  return 32 + Math.floor(Math.random() * 224);
}

export function randomChalkRgb(): [number, number, number] {
  return [randomVisibleByte(), randomVisibleByte(), randomVisibleByte()];
}

export function chalkRgbFromData(data: unknown): [number, number, number] | null {
  if (!data || typeof data !== 'object') return null;
  const rgb = (data as Partial<ChalkItemData>).rgb;
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  const r = colorByte(rgb[0]);
  const g = colorByte(rgb[1]);
  const b = colorByte(rgb[2]);
  return r === null || g === null || b === null ? null : [r, g, b];
}

export function createChalkItemData(maxDurability: number): ChalkItemData {
  return {
    dur: Math.max(0, Math.floor(maxDurability)),
    rgb: randomChalkRgb(),
  };
}

export function ensureChalkItemData(slot: { data?: unknown }, maxDurability: number): ChalkItemData {
  const src = slot.data && typeof slot.data === 'object' ? slot.data as Partial<ChalkItemData> : {};
  const dur = Number.isFinite(Number(src.dur))
    ? Math.max(0, Math.min(maxDurability, Number(src.dur)))
    : Math.max(0, Math.floor(maxDurability));
  const rgb = chalkRgbFromData(src) ?? randomChalkRgb();
  const data: ChalkItemData = { dur, rgb };
  slot.data = data;
  return data;
}

export function drawEquippedChalkPixel(world: World, player: Entity, maxDurability: number): boolean {
  const slot = (player.inventory ?? []).find(item => item.defId === CHALK_ITEM_ID);
  if (!slot) return false;
  const data = ensureChalkItemData(slot, maxDurability);
  const [r, g, b] = data.rgb ?? randomChalkRgb();
  if (!paintSurfacePixel(world, player.x, player.y, r, g, b, CHALK_PIXEL_ALPHA)) return false;
  const ci = world.idx(Math.floor(player.x), Math.floor(player.y));
  world.surfaceFlags[ci] |= SURFACE_FLAG_CHALK_MAP;
  return true;
}

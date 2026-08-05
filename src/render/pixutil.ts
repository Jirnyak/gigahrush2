/* ── Shared pixel utilities for procedural sprites & textures ── */

import { TEX } from '../core/types';

export const S = TEX;

/** Pack RGBA into little-endian uint32 (0xAABBGGRR) */
export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Fast deterministic hash noise in [0,1] */
export function noise(x: number, y: number, s: number): number {
  let n = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  n = (n ^ (n >> 13)) * 1103515245; n = n ^ (n >> 16);
  return (n & 0x7fff) / 0x7fff;
}

/** Clamp value to 0..255 */
export const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;

/** Transparent pixel */
export const CLEAR = rgba(0, 0, 0, 0);


/** Add a 1px border around non-transparent pixels */
export function outline(t: Uint32Array, color: number, alphaThreshold = 0) {
  const edges: number[] = [];
  const size = Math.sqrt(t.length) | 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const alpha = (t[idx] >>> 24) & 0xff;
      if (alpha <= alphaThreshold) {
        let nearSolid = false;
        if (x > 0 && ((t[idx - 1] >>> 24) & 0xff) > alphaThreshold) nearSolid = true;
        else if (x < size - 1 && ((t[idx + 1] >>> 24) & 0xff) > alphaThreshold) nearSolid = true;
        else if (y > 0 && ((t[idx - size] >>> 24) & 0xff) > alphaThreshold) nearSolid = true;
        else if (y < size - 1 && ((t[idx + size] >>> 24) & 0xff) > alphaThreshold) nearSolid = true;
        if (nearSolid) edges.push(idx);
      }
    }
  }
  for (let i = 0; i < edges.length; i++) {
    t[edges[i]] = color;
  }
}

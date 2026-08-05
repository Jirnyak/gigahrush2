import { Tex } from '../core/types';

export const SCREEN_VARIANTS = 8;
export const SCREEN_FRAMES = 4;
export const SCREEN_TEX_COUNT = SCREEN_VARIANTS * SCREEN_FRAMES;

export function proceduralScreenTex(variant: number, frame: number): Tex {
  return (Tex.SCREEN_BASE + variant * SCREEN_FRAMES + frame) as Tex;
}

export function isProceduralScreenTex(tex: number): boolean {
  return tex >= Tex.SCREEN_BASE && tex < Tex.SCREEN_BASE + SCREEN_TEX_COUNT;
}

export function proceduralScreenHash01(x: number, y: number, s: number): number {
  let n = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  n = (n ^ (n >> 13)) * 1103515245;
  n = n ^ (n >> 16);
  return (n & 0x7fff) / 0x7fff;
}

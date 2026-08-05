import { EntityType, Faction, MonsterKind, Occupation, type Entity } from '../core/types';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';
import { MONSTER_SPRITES } from './monster';
import { generateIdolSprite } from './idol';
import { generateKantselyarskiyIdolSprite } from './kantselyarskiy_idol';
import { generateNightmareSprite } from './nightmare';
import { generateProtokolnikSprite } from './protokolnik';
import { generateRobotSprite } from './robot';
import { generateBlackLiquidatorSprite } from './black_liquidator';
import { HEAD_SLUG_DETACHED_STAGE, generateSlugSprite } from './head_slug';
import {
  AUTHORED_NPC_SPRITE_GENERATORS,
  NPC_SPRITE_GENERATORS,
  generateTravelerSprite,
  generatePilgrimSprite,
  generateHunterSprite,
  generatePriestSprite,
  generatePerformerSprite,
} from './npc';
import {
  generateNpcVisualSprite,
  isFloor69FemaleSprite,
  isNpcSpecialSprite,
  NPC_VISUAL_FLOOR69_FEMALE,
  npcVisualTextureKey,
  npcVisualUsesDynamicTexture,
  npcVisualWorldSpriteScale,
} from './npc_visuals';
import { authoredNpcSpriteGeneratorOffset } from '../render/sprite_index';
import { resolveNpcArtVisualId } from '../data/npc_art_visuals';

export { isFloor69FemaleSprite } from './npc_visuals';

type RGB = readonly [number, number, number];

const SKIN: readonly RGB[] = [
  [168, 128, 104], [184, 148, 122], [198, 166, 138],
  [142, 104, 86], [214, 188, 160], [120, 86, 70],
];
const HAIR: readonly RGB[] = [
  [34, 24, 18], [64, 42, 24], [92, 66, 38], [140, 122, 84],
  [176, 172, 162], [120, 34, 30], [36, 36, 42],
];
const CIVILIAN_TOPS: readonly RGB[] = [
  [132, 76, 88], [82, 106, 126], [112, 112, 82], [138, 126, 82],
  [86, 88, 112], [128, 86, 58], [90, 118, 96], [146, 138, 128],
];
const CIVILIAN_PANTS: readonly RGB[] = [
  [54, 52, 58], [62, 56, 46], [48, 62, 82], [74, 66, 58], [36, 42, 52],
];
function mix32(v: number): number {
  v >>>= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b) >>> 0;
  v ^= v >>> 16;
  return v >>> 0;
}

function hashText(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rnd(seed: number, salt: number): number {
  return mix32((seed + Math.imul(salt, 0x9e3779b9)) >>> 0) / 0x100000000;
}

function isOccupationSpriteHint(spriteHint: number | undefined): spriteHint is Occupation {
  return spriteHint !== undefined && typeof Occupation[spriteHint as Occupation] === 'string';
}

function rgbJitter(c: RGB, seed: number, salt: number, amp: number): RGB {
  const a = Math.floor((rnd(seed, salt) - 0.5) * amp);
  const b = Math.floor((rnd(seed, salt + 1) - 0.5) * amp);
  const d = Math.floor((rnd(seed, salt + 2) - 0.5) * amp);
  return [clamp(c[0] + a), clamp(c[1] + b), clamp(c[2] + d)];
}

function pickRgb(list: readonly RGB[], seed: number, salt: number): RGB {
  return list[Math.floor(rnd(seed, salt) * list.length) % list.length];
}

function col(c: RGB, n = 0, a = 255): number {
  return rgba(clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n), a);
}

function paintEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (d: number, x: number, y: number) => number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 1) t[y * S + x] = color(Math.sqrt(d2), x, y);
  }
}

function paintRect(t: Uint32Array, x0: number, y0: number, w: number, h: number, c: RGB, seed: number, alpha = 255): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || x >= S || y < 0 || y >= S) continue;
    const n = Math.floor((noise(x, y, seed) - 0.5) * 18);
    t[y * S + x] = col(c, n, alpha);
  }
}

function paintLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: RGB, seed: number, width = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || px >= S || py < 0 || py >= S) continue;
      const n = Math.floor((noise(px, py, seed) - 0.5) * 12);
      t[py * S + px] = col(c, n);
    }
  }
}

function inferOccupation(occupation: Occupation | undefined, spriteHint: number | undefined): Occupation {
  if (occupation !== undefined) return occupation;
  if (isOccupationSpriteHint(spriteHint)) return spriteHint;
  return Occupation.TRAVELER;
}

function npcPalette(occupation: Occupation, faction: Faction | undefined, seed: number): { top: RGB; pants: RGB; accent: RGB } {
  if (faction === Faction.LIQUIDATOR || occupation === Occupation.HUNTER) {
    return { top: rgbJitter([68, 84, 54], seed, 10, 24), pants: rgbJitter([48, 56, 44], seed, 20, 18), accent: [112, 128, 86] };
  }
  if (faction === Faction.CULTIST || occupation === Occupation.PILGRIM || occupation === Occupation.PRIEST) {
    return { top: rgbJitter([32, 26, 42], seed, 30, 22), pants: rgbJitter([24, 22, 30], seed, 40, 14), accent: [154, 114, 46] };
  }
  if (faction === Faction.SCIENTIST || occupation === Occupation.SCIENTIST || occupation === Occupation.DOCTOR) {
    return { top: rgbJitter([210, 216, 210], seed, 50, 20), pants: rgbJitter([50, 54, 68], seed, 60, 14), accent: [120, 166, 188] };
  }
  if (faction === Faction.WILD) {
    return { top: rgbJitter([82, 68, 58], seed, 70, 36), pants: rgbJitter([56, 48, 42], seed, 80, 28), accent: [130, 58, 48] };
  }

  switch (occupation) {
    case Occupation.LOCKSMITH:
    case Occupation.ELECTRICIAN:
    case Occupation.MECHANIC:
    case Occupation.TURNER:
    case Occupation.CLEANER:
      return { top: rgbJitter([70, 88, 112], seed, 90, 26), pants: rgbJitter([52, 56, 64], seed, 100, 16), accent: [204, 156, 42] };
    case Occupation.COOK:
      return { top: rgbJitter([224, 224, 216], seed, 110, 18), pants: rgbJitter([58, 58, 64], seed, 120, 12), accent: [238, 238, 228] };
    case Occupation.STOREKEEPER:
      return { top: rgbJitter([118, 94, 58], seed, 130, 28), pants: rgbJitter([58, 48, 38], seed, 140, 18), accent: [156, 132, 74] };
    case Occupation.DIRECTOR:
      return { top: rgbJitter([42, 42, 54], seed, 150, 14), pants: rgbJitter([30, 32, 42], seed, 160, 10), accent: [160, 36, 36] };
    case Occupation.CHILD:
      return { top: rgbJitter(pickRgb(CIVILIAN_TOPS, seed, 170), seed, 171, 30), pants: rgbJitter([72, 74, 106], seed, 180, 18), accent: [210, 154, 78] };
    case Occupation.PERFORMER:
    case Occupation.WORKER69:
      return { top: rgbJitter([128, 48, 84], seed, 185, 26), pants: rgbJitter([38, 34, 48], seed, 186, 16), accent: [218, 164, 72] };
    default:
      return { top: rgbJitter(pickRgb(CIVILIAN_TOPS, seed, 190), seed, 191, 34), pants: rgbJitter(pickRgb(CIVILIAN_PANTS, seed, 200), seed, 201, 18), accent: rgbJitter([174, 126, 72], seed, 210, 34) };
  }
}

function paintLegs(t: Uint32Array, cx: number, bodyBot: number, legBot: number, pants: RGB, seed: number, skirt: boolean): void {
  if (skirt) {
    for (let y = bodyBot - 2; y < Math.min(legBot - 6, bodyBot + 12); y++) {
      const hw = 6 + Math.floor((y - bodyBot + 2) * 0.35);
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = col(pants, Math.floor((noise(x, y, seed + 4) - 0.5) * 12));
      }
    }
  }
  for (let y = bodyBot; y < legBot; y++) {
    for (const side of [-1, 1]) {
      const sway = Math.floor((rnd(seed, 220 + y + side) - 0.5) * 2);
      for (let x = cx + side * 3 - 2 + sway; x <= cx + side * 3 + 2 + sway; x++) {
        if (x < 0 || x >= S || y < 0 || y >= S) continue;
        t[y * S + x] = col(pants, Math.floor((noise(x, y, seed + 5) - 0.5) * 14));
      }
    }
  }
}

function paintTorso(t: Uint32Array, cx: number, top: number, bot: number, c: RGB, seed: number, robe: boolean): void {
  for (let y = top; y < bot; y++) {
    const k = (y - top) / Math.max(1, bot - top);
    const hw = robe ? Math.floor(7 + k * 6) : Math.floor(7 + Math.min(3, k * 8));
    for (let x = cx - hw; x <= cx + hw; x++) {
      if (x < 0 || x >= S || y < 0 || y >= S) continue;
      const side = Math.abs(x - cx) / Math.max(1, hw);
      const n = Math.floor((noise(x, y, seed + 6) - 0.5) * 18 - side * 12);
      t[y * S + x] = col(c, n);
    }
  }
}

interface NpcHeadOptions {
  t: Uint32Array;
  cx: number;
  headTop: number;
  headBot: number;
  skin: RGB;
  hair: RGB;
  seed: number;
  covered: boolean;
  female: boolean;
}

function addNpcHead(options: NpcHeadOptions): void {
  const { t, cx, headTop, headBot, skin, hair, seed, covered, female } = options;
  const cy = Math.floor((headTop + headBot) / 2);
  const rx = Math.max(5, Math.floor((headBot - headTop) * (0.42 + rnd(seed, 230) * 0.08)));
  const ry = Math.max(6, Math.floor((headBot - headTop) * 0.52));
  paintEllipse(t, cx, cy, rx, ry, (d, x, y) => col(skin, Math.floor((noise(x, y, seed + 7) - 0.45) * 18 - d * 8)));
  if (!covered) {
    const hairTop = headTop - 2 - Math.floor(rnd(seed, 240) * 2);
    const hairBot = headTop + 4 + Math.floor(rnd(seed, 241) * (female ? 5 : 2));
    for (let y = hairTop; y <= hairBot; y++) {
      const k = (y - hairTop) / Math.max(1, hairBot - hairTop);
      const hw = Math.floor(rx + 1 - k * (female ? 1 : 3));
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x < 0 || x >= S || y < 0 || y >= S) continue;
        if (noise(x, y, seed + 8) > 0.18) t[y * S + x] = col(hair, Math.floor((noise(x, y, seed + 9) - 0.5) * 14));
      }
    }
    if (female || rnd(seed, 242) > 0.62) {
      for (const side of [-1, 1]) for (let y = headTop + 2; y < headBot + 5; y++) {
        const x = cx + side * (rx + Math.floor(rnd(seed, 243 + y) * 2));
        if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = col(hair, Math.floor((noise(x, y, seed + 10) - 0.5) * 10));
      }
    }
  }
  const eyeY = cy;
  t[eyeY * S + cx - 2] = rgba(18, 18, 18);
  t[eyeY * S + cx + 2] = rgba(18, 18, 18);
  if (rnd(seed, 244) > 0.72) t[(eyeY + 3) * S + cx] = rgba(clamp(skin[0] - 36), clamp(skin[1] - 34), clamp(skin[2] - 30));
}

function addNpcEquipment(
  t: Uint32Array,
  occupation: Occupation,
  faction: Faction | undefined,
  cx: number,
  headTop: number,
  headBot: number,
  bodyTop: number,
  bodyBot: number,
  accent: RGB,
  seed: number,
): void {
  const cult = faction === Faction.CULTIST || occupation === Occupation.PILGRIM || occupation === Occupation.PRIEST;
  const hunter = faction === Faction.LIQUIDATOR || occupation === Occupation.HUNTER;
  if (cult) {
    for (let y = headTop - 5; y < headBot + 1; y++) {
      const k = (y - headTop + 5) / Math.max(1, headBot - headTop + 6);
      const hw = Math.floor(1 + k * 9);
      for (let x = cx - hw; x <= cx + hw; x++) {
        if (x < 0 || x >= S || y < 0 || y >= S) continue;
        t[y * S + x] = col([24, 20, 34], Math.floor((noise(x, y, seed + 11) - 0.5) * 12));
      }
    }
    t[Math.floor((headTop + headBot) / 2) * S + cx - 2] = rgba(126, 52, 156);
    t[Math.floor((headTop + headBot) / 2) * S + cx + 2] = rgba(126, 52, 156);
    if (occupation === Occupation.PRIEST) {
      for (let y = bodyTop + 4; y < bodyTop + 16; y++) t[y * S + cx] = col(accent);
      for (let x = cx - 3; x <= cx + 3; x++) t[(bodyTop + 8) * S + x] = col(accent);
    }
  }
  if (hunter) {
    paintRect(t, cx - 7, headTop - 3, 14, 5, [62, 72, 48], seed + 12);
    paintEllipse(t, cx, Math.floor((headTop + headBot) / 2), 6, 6, (d, x, y) => col([42, 48, 38], Math.floor((noise(x, y, seed + 13) - 0.5) * 10 - d * 6)));
    t[(headTop + 6) * S + cx - 3] = rgba(82, 128, 108);
    t[(headTop + 6) * S + cx + 3] = rgba(82, 128, 108);
    paintRect(t, cx - 2, headBot - 3, 5, 4, [54, 56, 44], seed + 14);
  }
  if (occupation === Occupation.COOK) {
    paintRect(t, cx - 6, headTop - 6, 12, 5, [232, 232, 224], seed + 15);
    paintRect(t, cx - 5, bodyTop + 3, 10, bodyBot - bodyTop - 4, [226, 226, 216], seed + 16);
  } else if (occupation === Occupation.LOCKSMITH || occupation === Occupation.ELECTRICIAN) {
    paintRect(t, cx - 7, headTop - 4, 14, 4, occupation === Occupation.ELECTRICIAN ? [222, 142, 30] : [208, 184, 42], seed + 17);
  } else if (occupation === Occupation.DOCTOR || occupation === Occupation.SCIENTIST) {
    const ey = Math.floor((headTop + headBot) / 2);
    paintRect(t, cx - 5, ey - 1, 4, 3, [126, 158, 176], seed + 18, 235);
    paintRect(t, cx + 1, ey - 1, 4, 3, [126, 158, 176], seed + 19, 235);
    t[ey * S + cx] = rgba(40, 40, 42);
  } else if (occupation === Occupation.DIRECTOR) {
    for (let y = bodyTop + 1; y < bodyTop + 14; y++) t[y * S + cx] = col(accent);
  } else if (occupation === Occupation.TRAVELER || rnd(seed, 250) > 0.84) {
    paintRect(t, cx + 8, bodyTop + 3, 5, 15, [76, 64, 48], seed + 20);
  } else if (occupation === Occupation.ALCOHOLIC) {
    t[(headBot - 4) * S + cx] = rgba(204, 62, 62);
  } else if (occupation === Occupation.HOUSEWIFE && rnd(seed, 251) > 0.35) {
    paintRect(t, cx - 5, bodyTop + 5, 10, bodyBot - bodyTop - 4, [214, 204, 182], seed + 21);
  }
}

function isCultVisualOccupation(occupation: Occupation): boolean {
  return occupation === Occupation.PILGRIM || occupation === Occupation.PRIEST;
}

function npcBaseSpriteForOccupation(occupation: Occupation): Uint32Array {
  const generator = occupation >= 0 && occupation < NPC_SPRITE_GENERATORS.length
    ? NPC_SPRITE_GENERATORS[occupation]
    : undefined;
  if (generator) return generator();
  switch (occupation) {
    case Occupation.TRAVELER: return generateTravelerSprite();
    case Occupation.PILGRIM: return generatePilgrimSprite();
    case Occupation.HUNTER: return generateHunterSprite();
    case Occupation.PRIEST: return generatePriestSprite();
    case Occupation.PERFORMER: return generatePerformerSprite();
    default: return generateTravelerSprite();
  }
}

function pixelRgb(c: number): RGB {
  return [component(c, 0), component(c, 8), component(c, 16)];
}

function blendRgb(a: RGB, b: RGB, k: number): RGB {
  return [
    clamp(a[0] * (1 - k) + b[0] * k),
    clamp(a[1] * (1 - k) + b[1] * k),
    clamp(a[2] * (1 - k) + b[2] * k),
  ];
}

function npcZoneTint(y: number, seed: number, occupation: Occupation, faction: Faction | undefined): { tint: RGB; strength: number } {
  const pal = npcPalette(occupation, faction, seed);
  if (y < 22) return { tint: rgbJitter(pickRgb(SKIN, seed, 812), seed, 813, 18), strength: 0.08 };
  if (y < 44) return { tint: pal.top, strength: 0.16 };
  return { tint: pal.pants, strength: 0.12 };
}

function paintMaskedRect(t: Uint32Array, x0: number, y0: number, w: number, h: number, c: RGB, seed: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || x >= S || y < 0 || y >= S) continue;
    const i = y * S + x;
    if (t[i] === CLEAR) continue;
    const n = Math.floor((noise(x, y, seed) - 0.5) * 14);
    t[i] = col(c, n);
  }
}

function isNpcFaceFeaturePixel(c: number, occupation: Occupation): boolean {
  const [r, g, b] = pixelRgb(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 48) return true;
  if (occupation === Occupation.SCIENTIST && b >= 190 && g >= 185 && r >= 160 && b - r >= 20) return true;
  if (occupation === Occupation.ALCOHOLIC && r >= 180 && g <= 120 && b <= 120) return true;
  return max - min > 65 && max <= 120;
}

function restoreNpcFaceFeatures(t: Uint32Array, base: Uint32Array, occupation: Occupation): void {
  for (let y = 0; y < 22; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const c = base[i];
    if ((c >>> 24) === 0) continue;
    if (isNpcFaceFeaturePixel(c, occupation)) t[i] = c;
  }
}

function addNpcSpriteDetails(t: Uint32Array, occupation: Occupation, seed: number, female: boolean): void {
  const accent = rgbJitter([174, 126, 72], seed, 830, 36);
  if (female && occupation !== Occupation.HUNTER && rnd(seed, 831) > 0.45) {
    paintMaskedRect(t, 25, 23, 14, 3, accent, seed + 832);
  }
  if (occupation === Occupation.TRAVELER && rnd(seed, 835) > 0.5) {
    paintMaskedRect(t, 41, 25, 4, 14, [76, 64, 48], seed + 836);
  } else if (occupation === Occupation.HUNTER) {
    paintMaskedRect(t, 25, 25, 13, 2, [92, 82, 52], seed + 837);
  } else if (occupation === Occupation.PERFORMER) {
    paintMaskedRect(t, 24, 25, 16, 2, [218, 164, 72], seed + 838);
  }
  if (rnd(seed, 839) > 0.62) paintMaskedRect(t, 27, 42, 10, 2, accent, seed + 840);
}

function generateOccupationNpcSprite(
  seed: number,
  occupation: Occupation,
  faction: Faction | undefined,
  isFemale: boolean | undefined,
): Uint32Array {
  const base = npcBaseSpriteForOccupation(occupation);
  const out = new Uint32Array(S * S).fill(CLEAR);
  const female = isFemale ?? rnd(seed, 811) > 0.56;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const c = base[i];
    const a = c >>> 24;
    if (a === 0) continue;
    const { tint, strength } = npcZoneTint(y, seed, occupation, faction);
    const mixed = blendRgb(pixelRgb(c), tint, strength);
    const n = Math.floor((noise(x, y, seed + 850) - 0.5) * 10);
    out[i] = col(mixed, n, a);
  }

  addNpcSpriteDetails(out, occupation, seed, female);
  restoreNpcFaceFeatures(out, base, occupation);
  return out;
}

function generateDetailedNpcSprite(
  seed: number,
  occupation: Occupation | undefined,
  faction: Faction | undefined,
  isFemale: boolean | undefined,
  spriteHint: number | undefined,
): Uint32Array {
  const occ = inferOccupation(occupation, spriteHint);
  const female = isFemale ?? rnd(seed, 1) > 0.56;
  const child = occ === Occupation.CHILD;
  const cult = faction === Faction.CULTIST || occ === Occupation.PILGRIM || occ === Occupation.PRIEST;
  const hunter = faction === Faction.LIQUIDATOR || occ === Occupation.HUNTER;
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32 + Math.floor((rnd(seed, 2) - 0.5) * 3);
  const headTop = child ? 19 : 8 + Math.floor(rnd(seed, 3) * 3);
  const headBot = child ? 32 : 21 + Math.floor(rnd(seed, 4) * 3);
  const bodyTop = headBot;
  const bodyBot = child ? 46 : 43 + Math.floor(rnd(seed, 5) * 4);
  const legBot = child ? 56 : 58 + Math.floor(rnd(seed, 6) * 2);
  const skin = rgbJitter(pickRgb(SKIN, seed, 7), seed, 8, 24);
  const hair = rgbJitter(pickRgb(HAIR, seed, 9), seed, 10, 22);
  const pal = npcPalette(occ, faction, seed);
  const skirt = female && !cult && !hunter && occ !== Occupation.CHILD && rnd(seed, 11) > 0.52;

  paintLegs(t, cx, bodyBot, legBot, skirt ? pal.top : pal.pants, seed, skirt);
  paintTorso(t, cx, bodyTop, bodyBot, pal.top, seed, cult);
  for (let y = bodyTop + 2; y < bodyBot - 1; y++) {
    const spread = Math.floor((y - bodyTop) * (cult ? 0.18 : 0.28));
    for (const side of [-1, 1]) {
      const x = cx + side * (9 + spread);
      if (x >= 0 && x < S) t[y * S + x] = col(cult ? pal.top : skin, Math.floor((noise(x, y, seed + 30) - 0.5) * 14));
    }
  }
  addNpcHead({
    t,
    cx,
    headTop,
    headBot,
    skin,
    hair,
    seed,
    covered: cult || hunter,
    female
  });
  addNpcEquipment(t, occ, faction, cx, headTop, headBot, bodyTop, bodyBot, pal.accent, seed);

  for (let i = 0; i < 3 + Math.floor(rnd(seed, 300) * 5); i++) {
    const sx = cx - 7 + Math.floor(rnd(seed, 301 + i) * 14);
    const sy = bodyTop + 4 + Math.floor(rnd(seed, 321 + i) * Math.max(1, bodyBot - bodyTop - 6));
    if (sx >= 0 && sx < S && sy >= 0 && sy < S && t[sy * S + sx] !== CLEAR) {
      t[sy * S + sx] = col(pal.accent, Math.floor((rnd(seed, 340 + i) - 0.5) * 18));
    }
  }

  return t;
}

export function generateProceduralNpcSprite(
  seed: number,
  occupation: Occupation | undefined,
  faction: Faction | undefined,
  isFemale: boolean | undefined,
  spriteHint: number | undefined,
): Uint32Array {
  const occ = inferOccupation(occupation, spriteHint);
  return isCultVisualOccupation(occ)
    ? generateDetailedNpcSprite(seed, occupation, faction, isFemale, spriteHint)
    : generateOccupationNpcSprite(seed, occ, faction, isFemale);
}

export function generateNpcProfileSprite(
  seed: number,
  occupation: Occupation | undefined,
  faction: Faction | undefined,
  isFemale: boolean | undefined,
  spriteHint: number | undefined,
  npcVisualId?: string,
  age?: number,
): Uint32Array {
  const special = generateNpcVisualSprite(npcVisualId, { seed, occupation, faction, isFemale, age, sprite: spriteHint });
  if (special) return special;
  if (spriteHint !== undefined) {
    const authoredOffset = authoredNpcSpriteGeneratorOffset(spriteHint);
    const authored = authoredOffset >= 0 ? AUTHORED_NPC_SPRITE_GENERATORS[authoredOffset] : undefined;
    if (authored) return authored.generate();
  }
  if (spriteHint !== undefined && isFloor69FemaleSprite(spriteHint)) {
    return generateNpcVisualSprite(NPC_VISUAL_FLOOR69_FEMALE, { seed, occupation, faction, isFemale, age, sprite: spriteHint })
      ?? generateProceduralNpcSprite(seed, occupation, faction, isFemale, spriteHint);
  }
  const artVisualId = resolveNpcArtVisualId({ faction, occupation, isFemale, age });
  const art = generateNpcVisualSprite(artVisualId, { seed, occupation, faction, isFemale, age, sprite: spriteHint });
  if (art) return art;
  return generateProceduralNpcSprite(seed, occupation, faction, isFemale, spriteHint);
}

function component(c: number, shift: number): number {
  return (c >>> shift) & 0xff;
}

function monsterTint(kind: MonsterKind, seed: number): RGB {
  const variantSeed = seed;
  const palettes: Partial<Record<MonsterKind, readonly RGB[]>> = {
    [MonsterKind.SBORKA]: [[118, 48, 62], [84, 60, 92], [110, 78, 48]],
    [MonsterKind.TVAR]: [[86, 54, 68], [92, 70, 46], [58, 78, 82]],
    [MonsterKind.POLZUN]: [[82, 70, 58], [94, 54, 46], [58, 72, 66]],
    [MonsterKind.BETONNIK]: [[118, 116, 108], [92, 102, 112], [118, 96, 84]],
    [MonsterKind.BETONOED]: [[168, 160, 132], [138, 132, 116], [194, 178, 146]],
    [MonsterKind.ZOMBIE]: [[82, 100, 78], [108, 86, 74], [76, 84, 92]],
    [MonsterKind.DIKIY_MERTVYAK]: [[132, 72, 58], [94, 96, 78], [116, 88, 92]],
    [MonsterKind.EYE]: [[170, 62, 64], [110, 82, 154], [198, 132, 72]],
    [MonsterKind.LAMPOGLAZ]: [[218, 174, 54], [84, 178, 78], [210, 202, 168]],
    [MonsterKind.SHADOW]: [[18, 18, 24], [24, 20, 34], [16, 26, 28]],
    [MonsterKind.REBAR]: [[118, 72, 48], [92, 90, 84], [132, 58, 42]],
    [MonsterKind.RZHAVNIK]: [[146, 72, 32], [96, 58, 36], [158, 104, 78]],
    [MonsterKind.ZAKALENNAYA_ARMATURA]: [[42, 48, 52], [92, 88, 78], [160, 66, 32]],
    [MonsterKind.SLIME_WOMAN]: [[12, 82, 58], [24, 116, 92], [92, 48, 132]],
    [MonsterKind.KHOROVAYA_MATKA]: [[118, 26, 34], [86, 70, 72], [172, 148, 136]],
    [MonsterKind.SPIRIT]: [[128, 166, 186], [136, 118, 184], [188, 196, 202]],
    [MonsterKind.KOSTOREZ]: [[136, 92, 78], [120, 116, 102], [148, 68, 58]],
    [MonsterKind.SAFEGUARD]: [[214, 224, 232], [184, 202, 214], [240, 242, 238]],
  };
  const list = palettes[kind] ?? [[110, 72, 78], [78, 88, 96], [112, 104, 74]];
  return rgbJitter(pickRgb(list, variantSeed, 1), variantSeed, 2, 34);
}

function mutateMonsterSprite(base: Uint32Array, kind: MonsterKind, seed: number): Uint32Array {
  const out = new Uint32Array(S * S).fill(CLEAR);
  const tint = monsterTint(kind, seed);
  const strength = 0.18 + rnd(seed, 401) * 0.28;
  const alphaMul = kind === MonsterKind.SPIRIT ? 0.62 + rnd(seed, 402) * 0.22 : 1;
  const dark = kind === MonsterKind.SHADOW ? 0.48 : 1;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = base[y * S + x];
    const a = c >>> 24;
    if (a === 0) continue;
    const pock = noise(x * 2, y * 2, seed + 31);
    if (pock > 0.985 && kind !== MonsterKind.SPIRIT) continue;
    const n = Math.floor((noise(x, y, seed + 32) - 0.5) * 34);
    const vein = noise(x * 3 + seed, y * 2, seed + 33) > 0.9 ? 24 : 0;
    const r = component(c, 0);
    const g = component(c, 8);
    const b = component(c, 16);
    out[y * S + x] = rgba(
      clamp((r * (1 - strength) + tint[0] * strength + n + vein) * dark),
      clamp((g * (1 - strength) + tint[1] * strength + n - vein * 0.35) * dark),
      clamp((b * (1 - strength) + tint[2] * strength + n - vein * 0.45) * dark),
      clamp(a * alphaMul),
    );
  }
  return out;
}

function addFalseHumanEyes(t: Uint32Array, seed: number): void {
  const eyeColor: RGB = [235, 54, 42];
  const count = 1 + Math.floor(rnd(seed, 500) * 4);

  for (let i = 0; i < count; i++) {
    const ex = 22 + Math.floor(rnd(seed, 501 + i) * 21);
    const ey = 12 + Math.floor(rnd(seed, 521 + i) * 28);
    const rx = 1 + Math.floor(rnd(seed, 541 + i) * 3);
    const ry = 1 + Math.floor(rnd(seed, 561 + i) * 3);
    paintEllipse(t, ex, ey, rx + 1, ry + 1, (d) => rgba(eyeColor[0], eyeColor[1], eyeColor[2], clamp(120 * (1 - d))));
    paintEllipse(t, ex, ey, rx, ry, (d) => d < 0.45 ? rgba(10, 4, 4) : col(eyeColor));
  }
}

function addMonsterMarks(t: Uint32Array, kind: MonsterKind, seed: number): void {
  const mark: RGB | undefined =
    kind === MonsterKind.BETONNIK || kind === MonsterKind.BETONOED || kind === MonsterKind.REBAR || kind === MonsterKind.RZHAVNIK || kind === MonsterKind.ZAKALENNAYA_ARMATURA ? [40, 34, 30] :
    kind === MonsterKind.ROBOT ? [210, 160, 72] :
    kind === MonsterKind.SPIRIT ? [210, 236, 246] :
    undefined;

  if (!mark) return;

  const lines = 2 + Math.floor(rnd(seed, 600) * 5);
  for (let i = 0; i < lines; i++) {
    const x0 = 18 + Math.floor(rnd(seed, 601 + i) * 28);
    const y0 = 15 + Math.floor(rnd(seed, 621 + i) * 34);
    const x1 = x0 + Math.floor((rnd(seed, 641 + i) - 0.5) * 18);
    const y1 = y0 + Math.floor(rnd(seed, 661 + i) * 18);
    paintLine(t, x0, y0, x1, y1, mark, seed + 680 + i, rnd(seed, 700 + i) > 0.78 ? 1 : 0);
  }
}

const ZAK_ARMOR_MAX_STACKS = 3;

function addZakalennayaArmorChips(t: Uint32Array, seed: number, armorStacks: number | undefined): void {
  const stacks = armorStacks ?? ZAK_ARMOR_MAX_STACKS;
  const lost = Math.max(0, ZAK_ARMOR_MAX_STACKS - Math.max(0, Math.min(ZAK_ARMOR_MAX_STACKS, stacks)));
  if (lost <= 0) return;

  for (let i = 0; i < lost; i++) {
    const sx = 18 + Math.floor(rnd(seed, 720 + i) * 28);
    const sy = 15 + Math.floor(rnd(seed, 740 + i) * 34);
    paintLine(t, sx, sy, sx + 7 + i * 2, sy + 2 + i * 3, [190, 184, 160], seed + 760 + i, 1);
    paintLine(t, sx + 2, sy + 2, sx + 10, sy + 7, [24, 22, 20], seed + 780 + i, 0);
    paintEllipse(t, sx + 5, sy + 5, 2 + i, 2, (d, x, y) => col([92, 88, 78], Math.floor((1 - d) * 22 + noise(x, y, seed + 790 + i) * 8)));
  }
}

function corruptFalseHuman(seed: number): Uint32Array {
  const t = generateProceduralNpcSprite(seed, Occupation.TRAVELER, Faction.WILD, rnd(seed, 710) > 0.5, Occupation.TRAVELER);
  addFalseHumanEyes(t, seed ^ 0xa771);
  paintLine(t, 28, 16, 36 + Math.floor(rnd(seed, 711) * 8), 42, [130, 20, 34], seed + 712, 0);
  paintLine(t, 36, 17, 24 - Math.floor(rnd(seed, 713) * 6), 39, [90, 16, 24], seed + 714, 0);
  return t;
}

export function generateProceduralMonsterSprite(kind: MonsterKind, seed: number, pressureTier = 0, armorStacks?: number): Uint32Array {
  if (kind === MonsterKind.NELYUD) return corruptFalseHuman(seed);

  const special = kind === MonsterKind.NIGHTMARE ? generateNightmareSprite(seed)
    : kind === MonsterKind.ROBOT ? generateRobotSprite(seed)
    : kind === MonsterKind.IDOL ? generateIdolSprite(seed)
    : kind === MonsterKind.KANTSELYARSKIY_IDOL ? generateKantselyarskiyIdolSprite(seed)
    : kind === MonsterKind.PROTOKOLNIK ? generateProtokolnikSprite(seed, pressureTier)
    : kind === MonsterKind.BLACK_LIQUIDATOR ? generateBlackLiquidatorSprite(seed % 12)
    : undefined;
  if (special) return special;

  const gen = MONSTER_SPRITES[kind] ?? MONSTER_SPRITES[MonsterKind.SBORKA];
  const out = mutateMonsterSprite(special ?? gen(), kind, seed);
  addMonsterMarks(out, kind, seed);
  if (kind === MonsterKind.ZAKALENNAYA_ARMATURA) addZakalennayaArmorChips(out, seed, armorStacks);
  return out;
}

export function entityUsesProceduralSprite(e: Entity): boolean {
  if (e.type === EntityType.MONSTER) return true;
  if (e.type !== EntityType.NPC) return false;
  if (npcVisualUsesDynamicTexture(e.npcVisualId)) return true;
  if (isNpcSpecialSprite(e.sprite)) return false;
  return isOccupationSpriteHint(e.sprite);
}

function deriveEntitySpriteSeed(e: Entity): number {
  let h = e.spriteSeed ?? 0;
  if (h === 0) {
    h = mix32(e.id ^ Math.imul(Math.floor(e.x * 16), 0x45d9f3b) ^ Math.imul(Math.floor(e.y * 16), 0x119de1f3));
    if (e.name) h = hashText(e.name, h);
    if (e.plotNpcId) h = hashText(e.plotNpcId, h);
  }
  return h || 1;
}

export function ensureProceduralSpriteSeed(e: Entity): void {
  if (entityUsesProceduralSprite(e) && e.spriteSeed === undefined) e.spriteSeed = deriveEntitySpriteSeed(e);
}

export function ensureProceduralSpriteSeeds(entities: Entity[]): void {
  for (const e of entities) ensureProceduralSpriteSeed(e);
}

export function proceduralEntitySpriteKey(e: Entity): number {
  ensureProceduralSpriteSeed(e);
  const kind = e.monsterKind ?? 0;
  const occ = e.occupation ?? inferOccupation(undefined, e.sprite);
  let h = deriveEntitySpriteSeed(e);
  if (e.type === EntityType.NPC) {
    const visualId = e.npcVisualId ?? resolveNpcArtVisualId({
      faction: e.faction,
      occupation: e.occupation,
      isFemale: e.isFemale,
      age: e.age,
    });
    const key = npcVisualTextureKey(visualId, {
      seed: h,
      occupation: e.occupation,
      faction: e.faction,
      isFemale: e.isFemale,
      age: e.age,
      sprite: e.sprite,
    });
    if (key) return hashText(`npc_visual:${key}`, 0x6a09e667) || 1;
  }
  if (e.monsterKind === MonsterKind.PROTOKOLNIK) h = mix32(h ^ Math.imul((e.protocolPressureTier ?? 0) + 1, 0x6d2b79f5));
  if (e.monsterKind === MonsterKind.ZAKALENNAYA_ARMATURA) h = mix32(h ^ Math.imul((e.monsterArmorStacks ?? ZAK_ARMOR_MAX_STACKS) + 1, 0x7feb352d));
  h = mix32(h ^ Math.imul(e.type, 0x9e3779b1) ^ Math.imul(kind + 1, 0x85ebca6b) ^ Math.imul(occ + 1, 0xc2b2ae35));
  h = mix32(h ^ Math.imul((e.sprite ?? 0) + 1, 0x165667b1));
  if (e.npcVisualId) h = hashText(e.npcVisualId, h);
  if (e.isFemale) h = mix32(h ^ 0x51ed270b);
  if (e.faction !== undefined) h = mix32(h ^ Math.imul(e.faction + 1, 0x27d4eb2d));
  return h || 1;
}

function npcEntityVisualId(e: Entity): string | undefined {
  return e.npcVisualId ?? resolveNpcArtVisualId({
    faction: e.faction,
    occupation: e.occupation,
    isFemale: e.isFemale,
    age: e.age,
  });
}

export function proceduralEntityDefaultSpriteScale(e: Entity): number | undefined {
  if (e.type !== EntityType.NPC) return undefined;
  const visualId = npcEntityVisualId(e);
  if (!visualId) return undefined;
  if (!e.npcVisualId && !entityUsesProceduralSprite(e)) return undefined;
  return npcVisualWorldSpriteScale(visualId);
}

export function entityWorldSpriteScale(e: Entity): number {
  const visualScale = proceduralEntityDefaultSpriteScale(e);
  const baseScale = (e.spriteScale ?? 1) * (e.height !== undefined ? e.height / 1.8 : 1);
  if (visualScale !== undefined) return baseScale * visualScale;
  return baseScale;
}

export function generateProceduralEntitySprite(e: Entity): Uint32Array | null {
  const seed = proceduralEntitySpriteKey(e);
  if (e.type === EntityType.NPC && entityUsesProceduralSprite(e)) {
    const visualId = e.npcVisualId ?? resolveNpcArtVisualId({
      faction: e.faction,
      occupation: e.occupation,
      isFemale: e.isFemale,
      age: e.age,
    });
    const visualSeed = npcVisualTextureKey(visualId, {
      seed: deriveEntitySpriteSeed(e),
      occupation: e.occupation,
      faction: e.faction,
      isFemale: e.isFemale,
      age: e.age,
      sprite: e.sprite,
    })
      ? deriveEntitySpriteSeed(e)
      : seed;
    const special = generateNpcVisualSprite(visualId, {
      seed: visualSeed,
      occupation: e.occupation,
      faction: e.faction,
      isFemale: e.isFemale,
      age: e.age,
      sprite: e.sprite,
    });
    if (special) return special;
    return generateProceduralNpcSprite(seed, e.occupation, e.faction, e.isFemale, e.sprite);
  }
  if (e.type === EntityType.MONSTER) {
    if (e.monsterKind === MonsterKind.HEAD_SLUG && e.monsterStage === HEAD_SLUG_DETACHED_STAGE) {
      return generateSlugSprite();
    }
    return generateProceduralMonsterSprite(e.monsterKind ?? MonsterKind.SBORKA, seed, e.protocolPressureTier, e.monsterArmorStacks);
  }
  return null;
}

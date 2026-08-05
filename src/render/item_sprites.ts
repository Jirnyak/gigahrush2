/* -- Procedural item sprites: world drops and inventory icons ------ */

import { ItemType, type ItemDef } from '../core/types';
import { ITEMS, ITEM_TAGS } from '../data/items';
import { S, rgba, noise, clamp, CLEAR } from './pixutil';
import { fitText } from './ui_text';

export type ItemSpriteData = Uint32Array;

type VisualKind =
  | 'food'
  | 'drink'
  | 'medicine'
  | 'weapon'
  | 'ammo'
  | 'document'
  | 'key'
  | 'sample'
  | 'tool'
  | 'electronics'
  | 'artifact'
  | 'repair'
  | 'misc';

interface Palette {
  body: [number, number, number];
  dark: [number, number, number];
  light: [number, number, number];
  accent: [number, number, number];
  glow: [number, number, number];
}

const ICON_CANVAS_CACHE_MAX = 512;
const ICON_CANVAS_CACHE_TARGET = 448;
const ICON_CANVAS_CACHE = new Map<string, HTMLCanvasElement>();

function trimItemIconCanvasCache(): void {
  if (ICON_CANVAS_CACHE.size <= ICON_CANVAS_CACHE_MAX) return;
  for (const key of ICON_CANVAS_CACHE.keys()) {
    ICON_CANVAS_CACHE.delete(key);
    if (ICON_CANVAS_CACHE.size <= ICON_CANVAS_CACHE_TARGET) break;
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tagSet(defId: string, def: ItemDef | undefined): readonly string[] {
  const local = def?.tags ?? [];
  const registered = ITEM_TAGS[defId] ?? (def?.id && def.id !== defId ? ITEM_TAGS[def.id] : undefined) ?? [];
  if (local.length === 0) return registered;
  if (registered.length === 0 || registered.every(tag => local.includes(tag))) return local;
  return [...local, ...registered.filter(tag => !local.includes(tag))];
}

function has(tags: readonly string[], value: string): boolean {
  return tags.includes(value);
}

function hasAny(tags: readonly string[], values: readonly string[]): boolean {
  for (const value of values) if (tags.includes(value)) return true;
  return false;
}

function isEvidenceDocumentVisual(defId: string): boolean {
  return defId === 'contaminated_sample_act' || defId === 'contaminated_swab';
}

function isSlimeAgeLabel(defId: string): boolean {
  return defId === 'slime_age_label_brown'
    || defId === 'slime_age_label_orange'
    || defId === 'slime_age_label_violet';
}

function itemVisualKind(defId: string, def: ItemDef | undefined): VisualKind {
  const tags = tagSet(defId, def);
  if (defId === 'import_toiletpaper' || defId === 'toiletpaper') return 'misc';
  if (defId === 'permanganate_vial') return 'medicine';
  if (defId === 'sterile_swab') return 'medicine';
  if (defId === 'stolen_archive_card') return 'document';
  if (defId === 'sand_spoiled_ration') return 'food';
  if (defId === 'zhelemish_raw' || defId === 'zhelemish_dried') return 'food';
  if (defId === 'zhelemish_boiled') return 'medicine';
  if (defId === 'void_archive_warrant') return 'document';
  if (defId === 'water_reservoir_sample') return 'drink';
  if (def?.type === ItemType.AMMO || has(tags, 'ammo') || defId.includes('ammo')) return 'ammo';
  if (has(tags, 'water_container')) return 'drink';
  if (defId === 'technical_spirit') return 'drink';
  if (isEvidenceDocumentVisual(defId)) return 'document';
  if (defId === 'sample_chain_form') return 'document';
  if (defId === 'shelter_tally' || defId === 'forged_shelter_tally') return 'document';
  if (defId === 'nii_sample_container' || defId === 'nii_sample_label') return 'document';
  if (defId === 'resident_identity_stub') return 'document';
  if (isSlimeAgeLabel(defId)) return 'document';
  if (hasAny(tags, ['slime', 'sample', 'sampleware', 'reagent', 'zhelemish', 'govnyak', 'veretar']) || defId.includes('sample')) return 'sample';
  if (defId === 'psi_stabilizer') return 'medicine';
  if (
    def?.type === ItemType.WEAPON
    && (defId === 'psi_beam'
      || defId === 'psi_brainburn'
      || defId === 'psi_concrete_splinter'
      || defId === 'psi_control'
      || defId === 'psi_madness'
      || defId === 'psi_shield'
      || defId === 'psi_possession')
  ) return 'weapon';
  if (hasAny(tags, ['psi', 'void', 'rare_trophy', 'cult', 'istotit', 'maronary']) || defId.includes('psi_') || defId.includes('void')) return 'artifact';
  if (def?.type === ItemType.WEAPON || has(tags, 'weapon')) return 'weapon';
  if (def?.type === ItemType.FOOD || hasAny(tags, ['bait', 'concentrate', 'ration'])) return 'food';
  if (def?.type === ItemType.DRINK || hasAny(tags, ['water', 'brewing'])) return 'drink';
  if (def?.type === ItemType.MEDICINE || hasAny(tags, ['medicine', 'medical'])) return 'medicine';
  if (def?.type === ItemType.KEY) return 'key';
  if (
    def?.type === ItemType.NOTE ||
    hasAny(tags, ['document', 'permit', 'forgery', 'audit', 'receipt', 'coupon', 'order', 'registry', 'stamp', 'blueprint', 'paper'])
  ) return 'document';
  if (def?.type === ItemType.TOOL || hasAny(tags, ['tool', 'cleanup', 'counterplay'])) return 'tool';
  if (hasAny(tags, ['electronics', 'battery', 'terminal', 'radio', 'lamp', 'screen'])) return 'electronics';
  if (hasAny(tags, ['repair', 'metal', 'rubber', 'seal', 'production', 'factory_input'])) return 'repair';
  return 'misc';
}

function paletteFor(kind: VisualKind, seed: number, defId: string): Palette {
  const accentSlot = seed % 6;
  const accent: [number, number, number] =
    accentSlot === 0 ? [210, 64, 54] :
    accentSlot === 1 ? [208, 158, 67] :
    accentSlot === 2 ? [80, 154, 116] :
    accentSlot === 3 ? [88, 158, 190] :
    accentSlot === 4 ? [142, 96, 186] :
    [190, 190, 132];

  switch (kind) {
    case 'food':
      return { body: [126, 92, 52], dark: [54, 42, 28], light: [190, 162, 96], accent, glow: [180, 70, 45] };
    case 'drink':
      return { body: [56, 90, 100], dark: [24, 36, 42], light: [150, 190, 186], accent, glow: [76, 190, 214] };
    case 'medicine':
      return { body: [176, 176, 154], dark: [72, 78, 74], light: [230, 224, 190], accent: [184, 48, 52], glow: [120, 220, 180] };
    case 'weapon':
      return { body: [92, 88, 76], dark: [26, 28, 28], light: [166, 158, 132], accent, glow: [220, 120, 46] };
    case 'ammo':
      return { body: [150, 120, 58], dark: [58, 44, 30], light: [218, 176, 76], accent, glow: [230, 150, 50] };
    case 'document':
      return { body: [174, 164, 132], dark: [72, 64, 48], light: [218, 208, 168], accent, glow: [210, 62, 50] };
    case 'key':
      return { body: [172, 136, 56], dark: [84, 62, 30], light: [230, 190, 88], accent, glow: [224, 190, 72] };
    case 'sample':
      return { body: [80, 94, 92], dark: [24, 32, 34], light: [150, 176, 164], accent, glow: sampleGlow(defId, seed) };
    case 'tool':
      return { body: [92, 100, 98], dark: [34, 40, 40], light: [174, 180, 168], accent, glow: [150, 210, 190] };
    case 'electronics':
      return { body: [46, 68, 70], dark: [14, 22, 24], light: [92, 138, 134], accent, glow: [80, 230, 198] };
    case 'artifact':
      return { body: [70, 54, 88], dark: [18, 12, 26], light: [150, 120, 190], accent, glow: [184, 92, 230] };
    case 'repair':
      return { body: [108, 98, 82], dark: [42, 38, 34], light: [178, 168, 136], accent, glow: [210, 156, 82] };
    default:
      return { body: [112, 104, 90], dark: [38, 36, 32], light: [178, 170, 140], accent, glow: [170, 130, 70] };
  }
}

function sampleGlow(defId: string, seed: number): [number, number, number] {
  if (defId.includes('green')) return [88, 220, 80];
  if (defId.includes('blue')) return [78, 190, 250];
  if (defId.includes('red') || defId.includes('blood')) return [230, 58, 62];
  if (defId.includes('black')) return [74, 52, 94];
  if (defId.includes('white') || defId.includes('silver')) return [218, 226, 210];
  return (seed & 1) === 0 ? [144, 218, 110] : [178, 96, 220];
}

function px(t: Uint32Array, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  t[y * S + x] = c;
}

function mixColor(base: [number, number, number], noiseValue: number, shade = 0, a = 255): number {
  return rgba(
    clamp(base[0] + noiseValue + shade),
    clamp(base[1] + noiseValue + shade),
    clamp(base[2] + noiseValue + shade),
    a,
  );
}

function rect(
  t: Uint32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
  seed = 0,
  a = 255,
): void {
  const lx = Math.max(0, Math.floor(x0));
  const rx = Math.min(S - 1, Math.floor(x1));
  const ty = Math.max(0, Math.floor(y0));
  const by = Math.min(S - 1, Math.floor(y1));
  for (let y = ty; y <= by; y++) for (let x = lx; x <= rx; x++) {
    const n = seed ? noise(x, y, seed) * 16 - 8 : 0;
    t[y * S + x] = mixColor(color, n, 0, a);
  }
}

function ellipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: [number, number, number],
  seed = 0,
  a = 255,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const d = dx * dx + dy * dy;
    if (d > 1) continue;
    const n = seed ? noise(x, y, seed) * 14 - 7 : 0;
    const shade = -Math.sqrt(d) * 18;
    t[y * S + x] = mixColor(color, n, shade, a);
  }
}

function line(
  t: Uint32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: [number, number, number],
  seed = 0,
  a = 255,
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    ellipse(t, x, y, width, width, color, seed + i, a);
  }
}

function arcLine(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  end: number,
  width: number,
  color: [number, number, number],
  seed: number,
  a = 255,
  steps = 14,
): void {
  let prevX = cx + Math.cos(start) * rx;
  let prevY = cy + Math.sin(start) * ry;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const ang = start + (end - start) * f;
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry;
    line(t, prevX, prevY, x, y, width, color, seed + i, a);
    prevX = x;
    prevY = y;
  }
}

function outlineRect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: [number, number, number]): void {
  rect(t, x0, y0, x1, y0 + 1, color);
  rect(t, x0, y1 - 1, x1, y1, color);
  rect(t, x0, y0, x0 + 1, y1, color);
  rect(t, x1 - 1, y0, x1, y1, color);
}

function drawDropShadow(t: Uint32Array): void {
  ellipse(t, 32, 52, 18, 5, [0, 0, 0], 17, 82);
}

function drawNoiseDust(t: Uint32Array, seed: number, color: [number, number, number], count: number): void {
  for (let i = 0; i < count; i++) {
    const x = 12 + Math.floor(noise(i, 1, seed) * 40);
    const y = 12 + Math.floor(noise(i, 2, seed) * 38);
    if (noise(x, y, seed + 3) > 0.55) px(t, x, y, rgba(color[0], color[1], color[2], 130));
  }
}

function drawStamp(t: Uint32Array, seed: number, p: Palette): void {
  const x = 38 + (seed % 5);
  const y = 28 + ((seed >>> 3) % 8);
  rect(t, x, y, x + 10, y + 2, p.accent, seed + 200, 230);
  rect(t, x + 1, y + 4, x + 9, y + 5, p.accent, seed + 201, 210);
  rect(t, x + 2, y + 8, x + 8, y + 9, p.accent, seed + 202, 190);
}

function drawEye(t: Uint32Array, cx: number, cy: number, seed: number, p: Palette, scale = 1): void {
  ellipse(t, cx, cy, 7 * scale, 4 * scale, [220, 214, 188], seed + 310, 240);
  ellipse(t, cx, cy, 3.2 * scale, 3.2 * scale, p.glow, seed + 311, 255);
  line(t, cx, cy - 3 * scale, cx, cy + 3 * scale, Math.max(0.8, 1 * scale), [4, 5, 4], seed + 312, 255);
}

function drawVoidArchiveWarrantSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 178, 112];
  const paperLight: [number, number, number] = [228, 212, 142];
  const ink: [number, number, number] = [18, 16, 18];
  const stamp: [number, number, number] = [174, 30, 40];
  const damp: [number, number, number] = [64, 78, 82];
  const violet: [number, number, number] = [94, 58, 160];
  const blue: [number, number, number] = [66, 136, 202];
  const rust: [number, number, number] = [116, 58, 36];

  ellipse(t, 34, 34, 22, 18, violet, seed + 2740, 34);
  ellipse(t, 33, 53, 15, 3.5, [8, 8, 10], seed + 2741, 88);
  rect(t, 16, 11, 49, 53, paper, seed + 2742, 248);
  rect(t, 20, 14, 45, 19, paperLight, seed + 2743, 218);
  outlineRect(t, 16, 11, 49, 53, ink);
  clearRect(t, 16, 11, 20, 14);
  clearRect(t, 47, 12, 49, 17);
  clearRect(t, 17, 50, 21, 53);
  rect(t, 16, 43, 49, 53, damp, seed + 2744, 112);
  rect(t, 16, 11, 20, 53, damp, seed + 2745, 118);
  line(t, 19, 15, 46, 50, 0.8, damp, seed + 2746, 112);
  for (let y = 23; y <= 42; y += 5) {
    rect(t, 22, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 158);
    rect(t, 43, y, 46, y + 1, blue, seed + y, 165);
  }
  rect(t, 23, 20, 39, 21, ink, 0, 160);
  ellipse(t, 40, 35, 8.2, 5.8, stamp, seed + 2747, 222);
  ellipse(t, 40, 35, 4.6, 2.7, paper, seed + 2748, 224);
  line(t, 34, 35, 46, 35, 0.8, stamp, seed + 2749, 235);
  drawEye(t, 29, 30, seed + 2750, { body: paper, dark: ink, light: paperLight, accent: stamp, glow: blue }, 0.42);
  rect(t, 30, 46, 39, 49, stamp, seed + 2751, 178);
  drawNoiseDust(t, seed + 2752, rust, 12);
  drawNoiseDust(t, seed + 2753, blue, 8);
}

function drawVoidSpikeSprite(t: Uint32Array, seed: number): void {
  const black: [number, number, number] = [7, 8, 13];
  const voidBlue: [number, number, number] = [26, 52, 92];
  const violet: [number, number, number] = [94, 48, 170];
  const violetLight: [number, number, number] = [168, 94, 226];
  const cyan: [number, number, number] = [92, 212, 226];
  const enamel: [number, number, number] = [192, 194, 170];
  const rust: [number, number, number] = [104, 50, 36];

  ellipse(t, 34, 34, 23, 17, violet, seed + 2760, 42);
  ellipse(t, 34, 34, 17, 11, voidBlue, seed + 2761, 36);
  line(t, 13, 49, 55, 13, 7.0, black, seed + 2762, 252);
  line(t, 17, 46, 52, 16, 4.2, voidBlue, seed + 2763, 250);
  line(t, 21, 43, 53, 15, 1.8, violetLight, seed + 2764, 235);
  line(t, 27, 35, 58, 9, 1.0, cyan, seed + 2765, 210);
  line(t, 19, 48, 31, 39, 1.4, enamel, seed + 2766, 205);
  ellipse(t, 40, 26, 6.8, 4.0, enamel, seed + 2767, 224);
  ellipse(t, 40, 26, 2.7, 2.7, violet, seed + 2768, 250);
  line(t, 40, 23, 40, 29, 0.8, black, seed + 2769, 245);
  rect(t, 22, 42, 31, 45, rust, seed + 2770, 160);
  line(t, 24, 45, 47, 21, 0.8, rust, seed + 2771, 128);
  drawNoiseDust(t, seed + 2772, cyan, 12);
  drawNoiseDust(t, seed + 2773, violetLight, 10);
  clearRect(t, 13, 48, 16, 51);
  clearRect(t, 54, 11, 58, 15);
}

function drawVoluntaryReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 186, 114];
  const paperLight: [number, number, number] = [238, 218, 146];
  const ink: [number, number, number] = [22, 20, 18];
  const stamp: [number, number, number] = [176, 34, 34];
  const ochre: [number, number, number] = [184, 126, 48];
  const damp: [number, number, number] = [70, 84, 74];
  const rust: [number, number, number] = [124, 62, 34];

  ellipse(t, 32, 52, 17, 4, [12, 10, 8], seed + 2780, 82);
  rect(t, 13, 22, 52, 47, paper, seed + 2781, 248);
  rect(t, 16, 24, 49, 28, paperLight, seed + 2782, 220);
  outlineRect(t, 13, 22, 52, 47, ink);
  clearRect(t, 13, 22, 17, 25);
  clearRect(t, 50, 23, 52, 28);
  clearRect(t, 14, 44, 18, 47);
  rect(t, 13, 40, 52, 47, damp, seed + 2783, 104);
  for (let y = 31; y <= 41; y += 4) rect(t, 18, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 145);
  rect(t, 19, 29, 32, 30, ink, 0, 155);
  rect(t, 38, 25, 49, 28, stamp, seed + 2784, 205);
  ellipse(t, 39, 37, 8.5, 5.4, stamp, seed + 2785, 216);
  ellipse(t, 39, 37, 4.5, 2.4, paper, seed + 2786, 222);
  line(t, 33, 37, 46, 37, 0.8, stamp, seed + 2787, 230);
  rect(t, 18, 42, 30, 45, ochre, seed + 2788, 178);
  line(t, 15, 45, 49, 27, 0.8, rust, seed + 2789, 122);
  drawNoiseDust(t, seed + 2790, rust, 10);
}

function drawWaterCouponSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 194, 124];
  const paperLight: [number, number, number] = [242, 224, 152];
  const ink: [number, number, number] = [22, 22, 18];
  const cyan: [number, number, number] = [58, 160, 180];
  const cyanLight: [number, number, number] = [132, 226, 218];
  const red: [number, number, number] = [170, 38, 34];
  const green: [number, number, number] = [72, 120, 70];
  const damp: [number, number, number] = [64, 82, 72];

  ellipse(t, 33, 53, 17, 4, [10, 10, 8], seed + 2800, 78);
  rect(t, 14, 23, 52, 45, paper, seed + 2801, 248);
  rect(t, 17, 25, 49, 28, paperLight, seed + 2802, 218);
  outlineRect(t, 14, 23, 52, 45, ink);
  clearRect(t, 14, 23, 17, 26);
  clearRect(t, 50, 24, 52, 28);
  clearRect(t, 15, 42, 18, 45);
  rect(t, 14, 39, 52, 45, damp, seed + 2803, 96);
  ellipse(t, 25, 34, 6.5, 8.2, cyan, seed + 2804, 232);
  ellipse(t, 25, 32, 3.8, 3.8, cyanLight, seed + 2805, 150);
  clearRect(t, 19, 24, 23, 29);
  for (let y = 31; y <= 40; y += 4) rect(t, 34, y, 47 - ((seed + y) & 3), y + 1, ink, 0, 145);
  rect(t, 35, 27, 47, 29, red, seed + 2806, 205);
  rect(t, 31, 41, 48, 43, green, seed + 2807, 155);
  line(t, 16, 42, 49, 28, 0.8, damp, seed + 2808, 118);
  drawNoiseDust(t, seed + 2809, cyanLight, 10);
}

function drawWaterReservoirQuotaSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [200, 184, 118];
  const paperLight: [number, number, number] = [234, 216, 146];
  const ink: [number, number, number] = [22, 20, 18];
  const cyan: [number, number, number] = [64, 150, 176];
  const cyanLight: [number, number, number] = [132, 220, 212];
  const red: [number, number, number] = [170, 34, 36];
  const official: [number, number, number] = [54, 92, 74];
  const rust: [number, number, number] = [122, 62, 36];

  ellipse(t, 33, 53, 16, 4, [10, 10, 8], seed + 2820, 82);
  rect(t, 17, 12, 48, 53, paper, seed + 2821, 248);
  rect(t, 20, 15, 45, 20, paperLight, seed + 2822, 220);
  outlineRect(t, 17, 12, 48, 53, ink);
  clearRect(t, 17, 12, 20, 15);
  clearRect(t, 46, 13, 48, 18);
  clearRect(t, 18, 50, 22, 53);
  rect(t, 17, 45, 48, 53, official, seed + 2823, 96);
  rect(t, 22, 24, 31, 43, cyan, seed + 2824, 210);
  ellipse(t, 26.5, 24, 5.5, 2.7, cyanLight, seed + 2825, 175);
  ellipse(t, 26.5, 43, 5.5, 2.5, ink, seed + 2826, 110);
  line(t, 24, 26, 24, 41, 0.8, cyanLight, seed + 2827, 170);
  for (let y = 25; y <= 41; y += 4) rect(t, 34, y, 43 - ((seed + y) & 3), y + 1, ink, 0, 138);
  rect(t, 34, 21, 44, 23, red, seed + 2828, 205);
  ellipse(t, 38, 37, 6.8, 4.8, red, seed + 2829, 212);
  ellipse(t, 38, 37, 3.5, 2.1, paper, seed + 2830, 222);
  rect(t, 28, 47, 40, 50, cyanLight, seed + 2831, 118);
  line(t, 20, 49, 43, 18, 0.8, rust, seed + 2832, 112);
  drawNoiseDust(t, seed + 2833, rust, 9);
}

function drawWaterBottleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [78, 118, 114];
  const glassLight: [number, number, number] = [164, 216, 202];
  const glassDark: [number, number, number] = [24, 42, 40];
  const water: [number, number, number] = [58, 166, 190];
  const waterLight: [number, number, number] = [128, 230, 224];
  const label: [number, number, number] = [192, 174, 104];
  const red: [number, number, number] = [158, 44, 40];
  const damp: [number, number, number] = [42, 66, 60];
  const rust: [number, number, number] = [118, 64, 38];

  ellipse(t, 33, 53, 13, 3.3, damp, seed + 2840, 84);
  rect(t, 29, 10, 36, 15, glassDark, seed + 2841, 244);
  rect(t, 30, 15, 35, 24, glassLight, seed + 2842, 170);
  ellipse(t, 32.5, 24, 11.5, 5, glassLight, seed + 2843, 184);
  rect(t, 22, 25, 43, 51, glass, seed + 2844, 150);
  outlineRect(t, 22, 25, 43, 51, glassDark);
  ellipse(t, 32.5, 51, 11, 4, glassDark, seed + 2845, 130);
  rect(t, 24, 35, 41, 49, water, seed + 2846, 214);
  line(t, 24, 35, 41, 33, 1.1, waterLight, seed + 2847, 196);
  ellipse(t, 31, 41, 7.8, 3.4, waterLight, seed + 2848, 90);
  line(t, 27, 27, 26, 48, 0.8, glassLight, seed + 2849, 142);
  line(t, 38, 23, 40, 48, 0.8, glassDark, seed + 2850, 130);
  rect(t, 25, 28, 40, 34, label, seed + 2851, 232);
  rect(t, 27, 30, 36, 31, glassDark, seed + 2852, 130);
  rect(t, 36, 32, 40, 33, red, seed + 2853, 180);
  rect(t, 25, 43, 41, 45, waterLight, seed + 2854, 108);
  drawNoiseDust(t, seed + 2855, rust, 7);
  drawNoiseDust(t, seed + 2856, waterLight, 10);
  px(t, 31, 12, rgba(218, 238, 216, 180));
  px(t, 25, 45, rgba(160, 238, 226, 160));
  px(t, 42, 26, CLEAR);
  px(t, 43, 26, CLEAR);
}

function drawWaterFilterRegulatorSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [92, 108, 102];
  const metalLight: [number, number, number] = [164, 176, 158];
  const metalDark: [number, number, number] = [28, 38, 36];
  const rubber: [number, number, number] = [32, 44, 42];
  const cyan: [number, number, number] = [70, 176, 184];
  const cyanLight: [number, number, number] = [140, 232, 218];
  const red: [number, number, number] = [162, 42, 36];
  const rust: [number, number, number] = [126, 66, 34];

  ellipse(t, 33, 53, 17, 4, [8, 10, 9], seed + 2860, 82);
  line(t, 14, 40, 51, 31, 5.4, rubber, seed + 2861, 238);
  line(t, 16, 40, 49, 32, 2.8, metal, seed + 2862, 238);
  ellipse(t, 32, 32, 15, 15, metalDark, seed + 2863, 248);
  ellipse(t, 32, 32, 12, 12, metal, seed + 2864, 252);
  ellipse(t, 32, 32, 5.2, 5.2, cyan, seed + 2865, 230);
  ellipse(t, 32, 32, 2.6, 2.6, cyanLight, seed + 2866, 180);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.25;
    line(t, 32, 32, 32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12, 1.0, metalLight, seed + 2867 + i, 192);
  }
  rect(t, 21, 42, 43, 48, metalDark, seed + 2873, 230);
  rect(t, 24, 43, 40, 46, metalLight, seed + 2874, 220);
  rect(t, 25, 44, 30, 45, red, seed + 2875, 190);
  line(t, 19, 25, 46, 45, 0.9, rust, seed + 2876, 128);
  ellipse(t, 46, 40, 5.5, 3.2, cyan, seed + 2877, 140);
  ellipse(t, 47, 39, 2.5, 1.6, cyanLight, seed + 2878, 145);
  drawNoiseDust(t, seed + 2879, rust, 10);
  drawNoiseDust(t, seed + 2880, cyanLight, 8);
}

function drawWaterReservoirSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [72, 104, 104];
  const glassLight: [number, number, number] = [142, 194, 184];
  const glassDark: [number, number, number] = [22, 34, 36];
  const water: [number, number, number] = [66, 144, 150];
  const waterLight: [number, number, number] = [124, 220, 202];
  const label: [number, number, number] = [198, 178, 110];
  const rust: [number, number, number] = [132, 68, 34];
  const red: [number, number, number] = [164, 40, 38];
  const sludge: [number, number, number] = [54, 72, 50];

  ellipse(t, 33, 53, 14, 3.5, [8, 10, 9], seed + 2890, 86);
  ellipse(t, 33, 36, 22, 18, waterLight, seed + 2891, 24);
  rect(t, 28, 9, 38, 15, glassDark, seed + 2892, 246);
  rect(t, 26, 14, 40, 20, rust, seed + 2893, 226);
  rect(t, 22, 22, 44, 51, glass, seed + 2894, 148);
  ellipse(t, 33, 22, 12, 5, glassLight, seed + 2895, 160);
  ellipse(t, 33, 51, 12, 4, glassDark, seed + 2896, 142);
  outlineRect(t, 22, 22, 44, 51, glassDark);
  rect(t, 24, 35, 42, 49, water, seed + 2897, 210);
  line(t, 24, 35, 42, 33, 1.1, waterLight, seed + 2898, 185);
  ellipse(t, 31, 43, 8, 3.3, sludge, seed + 2899, 150);
  rect(t, 25, 27, 41, 34, label, seed + 2900, 228);
  rect(t, 27, 29, 37, 30, glassDark, seed + 2901, 132);
  rect(t, 35, 32, 40, 33, red, seed + 2902, 188);
  line(t, 26, 24, 25, 48, 0.8, glassLight, seed + 2903, 135);
  line(t, 39, 21, 41, 49, 0.8, glassDark, seed + 2904, 130);
  for (let i = 0; i < 10; i++) {
    const x = 24 + Math.floor(noise(i, 2905, seed) * 18);
    const y = 33 + Math.floor(noise(i, 2906, seed) * 15);
    ellipse(t, x, y, 1.1, 0.9, (i & 1) === 0 ? rust : sludge, seed + 2907 + i, 120);
  }
  drawNoiseDust(t, seed + 2918, waterLight, 12);
  drawNoiseDust(t, seed + 2919, rust, 8);
  px(t, 31, 12, rgba(210, 230, 202, 180));
  px(t, 42, 23, CLEAR);
  px(t, 43, 23, CLEAR);
}










function clearRect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number): void {
  const lx = Math.max(0, Math.floor(x0));
  const rx = Math.min(S - 1, Math.floor(x1));
  const ty = Math.max(0, Math.floor(y0));
  const by = Math.min(S - 1, Math.floor(y1));
  for (let y = ty; y <= by; y++) for (let x = lx; x <= rx; x++) t[y * S + x] = CLEAR;
}

function drawPaintAuditDocumentSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 184, 94];
  const paperLight: [number, number, number] = [226, 210, 128];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [172, 36, 34];
  const damp: [number, number, number] = [92, 102, 96];
  rect(t, 17, 11, 48, 53, paper, seed + 410);
  rect(t, 20, 14, 45, 18, paperLight, seed + 411, 215);
  outlineRect(t, 17, 11, 48, 53, ink);
  rect(t, 17, 11, 21, 53, damp, seed + 412, 115);
  rect(t, 17, 47, 48, 53, damp, seed + 413, 105);
  clearRect(t, 17, 11, 20, 14);
  clearRect(t, 46, 12, 48, 16);
  clearRect(t, 18, 50, 20, 53);
  line(t, 18, 16, 20, 49, 0.9, damp, seed + 414, 170);
  for (let y = 23; y <= 42; y += 5) {
    rect(t, 22, y, 42 - ((y + seed) & 5), y + 1, ink, 0, 180);
  }
  rect(t, 24, 20, 37, 21, ink, 0, 150);
  ellipse(t, 39, 35, 7, 5, red, seed + 415, 210);
  ellipse(t, 39, 35, 4, 2.5, paper, seed + 416, 225);
  line(t, 34, 35, 44, 35, 0.8, red, seed + 417, 230);
  rect(t, 30, 44, 36, 47, red, seed + 418, 190);
  px(t, 33, 48, rgba(red[0], red[1], red[2], 150));
}

function drawNiiContrabandManifestSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 184, 112];
  const light: [number, number, number] = [236, 218, 146];
  const ink: [number, number, number] = [18, 18, 16];
  const red: [number, number, number] = [178, 34, 32];
  const damp: [number, number, number] = [66, 86, 78];
  const green: [number, number, number] = [58, 128, 82];
  const rust: [number, number, number] = [124, 62, 34];

  rect(t, 16, 10, 49, 54, paper, seed + 1950, 248);
  rect(t, 19, 13, 46, 18, light, seed + 1951, 218);
  outlineRect(t, 16, 10, 49, 54, ink);
  clearRect(t, 16, 10, 20, 14);
  clearRect(t, 47, 11, 49, 17);
  clearRect(t, 17, 51, 21, 54);
  rect(t, 16, 43, 49, 54, damp, seed + 1952, 108);
  rect(t, 16, 10, 20, 54, damp, seed + 1953, 118);
  for (let y = 22; y <= 41; y += 5) {
    rect(t, 23, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 166);
    rect(t, 43, y, 46, y + 1, green, seed + y, 185);
  }
  rect(t, 24, 19, 38, 20, ink, 0, 150);
  line(t, 22, 45, 45, 31, 1.1, red, seed + 1954, 170);
  ellipse(t, 39, 34, 8, 5.7, red, seed + 1955, 220);
  ellipse(t, 39, 34, 4.4, 2.8, paper, seed + 1956, 225);
  line(t, 33, 34, 45, 34, 0.8, red, seed + 1957, 235);
  rect(t, 30, 47, 39, 50, red, seed + 1958, 178);
  drawNoiseDust(t, seed + 1959, rust, 12);
}

function drawNiiForgedAuditSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 100];
  const light: [number, number, number] = [232, 210, 132];
  const ink: [number, number, number] = [20, 18, 16];
  const red: [number, number, number] = [184, 32, 30];
  const damp: [number, number, number] = [76, 88, 82];
  const violet: [number, number, number] = [108, 82, 132];
  const rust: [number, number, number] = [128, 64, 34];

  rect(t, 15, 12, 50, 53, paper, seed + 1970, 248);
  rect(t, 18, 15, 47, 20, light, seed + 1971, 218);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 20, 53);
  rect(t, 15, 45, 50, 53, damp, seed + 1972, 104);
  line(t, 19, 16, 46, 49, 0.9, damp, seed + 1973, 112);
  for (let y = 23; y <= 42; y += 5) {
    rect(t, 22, y, 41 - ((seed + y) & 7), y + 1, ink, 0, 158);
    rect(t, 22, y + 2, 29, y + 2, ink, 0, 118);
  }
  rect(t, 38, 21, 46, 24, red, seed + 1974, 210);
  ellipse(t, 40, 36, 8, 5.6, red, seed + 1975, 222);
  ellipse(t, 40, 36, 4.2, 2.8, paper, seed + 1976, 225);
  line(t, 34, 36, 46, 36, 0.8, red, seed + 1977, 232);
  line(t, 21, 44, 44, 26, 1.2, violet, seed + 1978, 150);
  line(t, 23, 27, 45, 45, 1.1, red, seed + 1979, 160);
  rect(t, 29, 46, 39, 49, red, seed + 1980, 180);
  drawNoiseDust(t, seed + 1981, rust, 13);
}

function drawNiiMarketReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [210, 190, 118];
  const light: [number, number, number] = [238, 218, 146];
  const ink: [number, number, number] = [18, 18, 16];
  const red: [number, number, number] = [176, 36, 34];
  const market: [number, number, number] = [48, 62, 66];
  const blue: [number, number, number] = [62, 116, 144];
  const rust: [number, number, number] = [124, 66, 36];

  rect(t, 12, 21, 53, 46, paper, seed + 1990, 248);
  rect(t, 15, 23, 50, 27, light, seed + 1991, 220);
  outlineRect(t, 12, 21, 53, 46, ink);
  clearRect(t, 12, 21, 16, 24);
  clearRect(t, 51, 22, 53, 27);
  clearRect(t, 13, 43, 17, 46);
  rect(t, 12, 39, 53, 46, market, seed + 1992, 118);
  rect(t, 17, 29, 28, 39, blue, seed + 1993, 215);
  for (let y = 30; y <= 40; y += 4) rect(t, 31, y, 48 - ((seed + y) & 5), y + 1, ink, 0, 150);
  rect(t, 20, 32, 25, 35, light, seed + 1994, 190);
  rect(t, 37, 24, 50, 26, market, seed + 1995, 190);
  ellipse(t, 42, 35, 7.2, 5.1, red, seed + 1996, 218);
  ellipse(t, 42, 35, 3.9, 2.4, paper, seed + 1997, 224);
  line(t, 36, 35, 48, 35, 0.8, red, seed + 1998, 232);
  line(t, 17, 42, 48, 28, 0.9, rust, seed + 1999, 138);
  drawNoiseDust(t, seed + 2000, rust, 10);
}

function drawNiiSampleContainerSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 178, 112];
  const light: [number, number, number] = [230, 212, 144];
  const ink: [number, number, number] = [20, 20, 18];
  const red: [number, number, number] = [176, 38, 34];
  const glass: [number, number, number] = [96, 138, 132];
  const glassLight: [number, number, number] = [188, 226, 208];
  const seal: [number, number, number] = [68, 98, 84];
  const rust: [number, number, number] = [124, 66, 38];

  rect(t, 14, 16, 49, 50, paper, seed + 2010, 246);
  rect(t, 17, 18, 46, 23, light, seed + 2011, 218);
  outlineRect(t, 14, 16, 49, 50, ink);
  clearRect(t, 14, 16, 18, 19);
  clearRect(t, 47, 17, 49, 22);
  clearRect(t, 15, 47, 19, 50);
  for (let y = 26; y <= 42; y += 5) rect(t, 18, y, 31 - ((seed + y) & 3), y + 1, ink, 0, 140);
  rect(t, 17, 43, 48, 50, seal, seed + 2012, 88);

  rect(t, 33, 18, 41, 22, ink, seed + 2013, 230);
  rect(t, 31, 22, 43, 43, glass, seed + 2014, 128);
  ellipse(t, 37, 22, 7, 3.2, glassLight, seed + 2015, 150);
  ellipse(t, 37, 43, 7, 2.8, ink, seed + 2016, 112);
  rect(t, 32, 29, 42, 35, light, seed + 2017, 225);
  rect(t, 34, 31, 40, 32, ink, 0, 120);
  rect(t, 35, 34, 41, 35, red, seed + 2018, 188);
  line(t, 30, 22, 29, 42, 0.8, glassLight, seed + 2019, 145);
  line(t, 42, 21, 44, 42, 0.8, ink, seed + 2020, 115);
  ellipse(t, 39, 25, 4.5, 2.4, seal, seed + 2021, 170);
  rect(t, 38, 17, 44, 20, red, seed + 2022, 190);
  drawNoiseDust(t, seed + 2023, rust, 10);
}

function drawNiiSampleLabelSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [218, 202, 134];
  const light: [number, number, number] = [244, 226, 154];
  const ink: [number, number, number] = [22, 22, 18];
  const red: [number, number, number] = [178, 38, 34];
  const green: [number, number, number] = [74, 188, 112];
  const cyan: [number, number, number] = [84, 214, 196];
  const glue: [number, number, number] = [82, 104, 88];
  const rust: [number, number, number] = [124, 66, 36];

  ellipse(t, 34, 35, 22, 15, green, seed + 2030, 34);
  ellipse(t, 34, 36, 17, 10, cyan, seed + 2031, 28);
  rect(t, 15, 24, 51, 44, paper, seed + 2032, 248);
  rect(t, 18, 26, 48, 30, light, seed + 2033, 220);
  outlineRect(t, 15, 24, 51, 44, ink);
  clearRect(t, 15, 24, 18, 27);
  clearRect(t, 49, 25, 51, 30);
  clearRect(t, 16, 41, 19, 44);
  rect(t, 15, 39, 51, 44, glue, seed + 2034, 102);
  rect(t, 19, 32, 28, 38, green, seed + 2035, 210);
  for (let y = 32; y <= 39; y += 3) rect(t, 31, y, 46 - ((seed + y) & 3), y + 1, ink, 0, 135);
  rect(t, 39, 27, 48, 29, red, seed + 2036, 190);
  ellipse(t, 25, 35, 4.6, 3.2, cyan, seed + 2037, 165);
  line(t, 17, 42, 49, 27, 0.8, rust, seed + 2038, 128);
  drawNoiseDust(t, seed + 2039, cyan, 16);
  drawNoiseDust(t, seed + 2040, rust, 8);
}

function drawNoteSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 188, 122];
  const light: [number, number, number] = [238, 220, 152];
  const ink: [number, number, number] = [22, 20, 18];
  const red: [number, number, number] = [164, 42, 36];
  const damp: [number, number, number] = [78, 92, 78];
  const rust: [number, number, number] = [124, 68, 38];

  rect(t, 18, 14, 47, 51, paper, seed + 2050, 246);
  rect(t, 21, 17, 44, 22, light, seed + 2051, 220);
  outlineRect(t, 18, 14, 47, 51, ink);
  clearRect(t, 18, 14, 22, 17);
  clearRect(t, 45, 14, 47, 19);
  clearRect(t, 19, 48, 22, 51);
  line(t, 19, 19, 46, 47, 0.8, damp, seed + 2052, 100);
  rect(t, 18, 43, 47, 51, damp, seed + 2053, 92);
  for (let y = 25; y <= 41; y += 5) {
    line(t, 23, y, 41 - ((seed + y) & 5), y - 1 + ((y & 4) ? 1 : 0), 0.8, ink, seed + y, 145);
  }
  line(t, 24, 44, 42, 42, 0.8, red, seed + 2054, 140);
  rect(t, 37, 24, 44, 27, red, seed + 2055, 150);
  drawNoiseDust(t, seed + 2056, rust, 9);
}

function drawBankDebtPaperSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 180, 104];
  const paperLight: [number, number, number] = [232, 212, 132];
  const ink: [number, number, number] = [22, 20, 17];
  const red: [number, number, number] = [174, 34, 30];
  const damp: [number, number, number] = [84, 92, 86];
  const fold: [number, number, number] = [156, 136, 82];

  rect(t, 16, 11, 49, 53, paper, seed + 430, 246);
  rect(t, 20, 15, 45, 20, paperLight, seed + 431, 218);
  outlineRect(t, 16, 11, 49, 53, ink);
  clearRect(t, 16, 11, 19, 14);
  clearRect(t, 47, 12, 49, 17);
  clearRect(t, 17, 50, 20, 53);
  rect(t, 16, 12, 20, 53, damp, seed + 432, 116);
  rect(t, 16, 47, 49, 53, damp, seed + 433, 98);
  line(t, 18, 17, 22, 49, 0.8, damp, seed + 434, 170);
  line(t, 43, 12, 49, 18, 0.9, fold, seed + 435, 190);
  rect(t, 43, 12, 48, 17, paperLight, seed + 436, 165);

  rect(t, 22, 22, 37, 23, ink, 0, 170);
  rect(t, 39, 22, 45, 24, red, seed + 437, 205);
  for (let y = 27; y <= 42; y += 5) {
    const right = 42 - ((seed + y) & 5);
    rect(t, 22, y, right, y + 1, ink, 0, 180);
    rect(t, 22, y + 2, 27, y + 2, ink, 0, 120);
  }

  ellipse(t, 39, 36, 7.2, 5.8, red, seed + 438, 218);
  ellipse(t, 39, 36, 4.3, 2.9, paper, seed + 439, 222);
  line(t, 34, 36, 44, 36, 0.8, red, seed + 440, 232);
  rect(t, 31, 44, 38, 47, red, seed + 441, 182);
  line(t, 23, 45, 42, 46, 0.7, ink, seed + 442, 120);
  drawNoiseDust(t, seed + 443, [112, 76, 44], 12);
}

function drawForgedBankDebtPaperSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 174, 96];
  const light: [number, number, number] = [230, 208, 126];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [178, 32, 30];
  const damp: [number, number, number] = [82, 94, 88];
  const rust: [number, number, number] = [122, 60, 34];

  rect(t, 15, 12, 50, 53, paper, seed + 844, 248);
  rect(t, 19, 15, 46, 20, light, seed + 845, 218);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 19, 53);
  rect(t, 15, 12, 19, 53, damp, seed + 846, 118);
  rect(t, 15, 47, 50, 53, damp, seed + 847, 102);
  line(t, 19, 15, 46, 51, 0.8, damp, seed + 848, 88);
  line(t, 22, 44, 44, 39, 1.1, ink, seed + 849, 96);

  rect(t, 22, 22, 37, 23, ink, 0, 165);
  rect(t, 39, 21, 45, 24, red, seed + 850, 210);
  for (let y = 27; y <= 42; y += 5) {
    rect(t, 22, y, 42 - ((seed + y) & 7), y + 1, ink, 0, 175);
    rect(t, 22, y + 2, 28, y + 2, ink, 0, 122);
  }
  ellipse(t, 40, 36, 7.6, 5.7, red, seed + 851, 220);
  ellipse(t, 40, 36, 4.1, 2.7, paper, seed + 852, 224);
  line(t, 34, 36, 46, 36, 0.8, red, seed + 853, 232);
  line(t, 29, 46, 38, 43, 1.2, red, seed + 854, 185);
  line(t, 31, 43, 41, 47, 0.8, ink, seed + 855, 115);
  drawNoiseDust(t, seed + 856, rust, 13);
}

function drawForgedPermitSlipSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 178, 108];
  const light: [number, number, number] = [232, 212, 138];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 36, 32];
  const damp: [number, number, number] = [82, 92, 84];
  const green: [number, number, number] = [70, 118, 80];

  rect(t, 13, 20, 51, 46, paper, seed + 864, 248);
  rect(t, 16, 22, 48, 26, light, seed + 865, 220);
  outlineRect(t, 13, 20, 51, 46, ink);
  clearRect(t, 13, 20, 17, 23);
  clearRect(t, 49, 20, 51, 24);
  clearRect(t, 14, 44, 17, 46);
  rect(t, 13, 40, 51, 46, damp, seed + 866, 98);
  for (let y = 24; y <= 42; y += 5) rect(t, 18, y, 20, y + 1, ink, 0, 120);
  for (let x = 23; x <= 45; x += 5) rect(t, x, 20, x + 1, 45, ink, seed + 867 + x, 35);
  rect(t, 23, 28, 40, 29, ink, 0, 170);
  rect(t, 23, 33, 37, 34, ink, 0, 145);
  rect(t, 23, 38, 34, 39, ink, 0, 125);
  rect(t, 40, 25, 48, 29, green, seed + 868, 185);
  ellipse(t, 42, 36, 7.2, 5.2, red, seed + 869, 220);
  ellipse(t, 42, 36, 4.0, 2.5, paper, seed + 870, 224);
  line(t, 36, 36, 48, 36, 0.8, red, seed + 871, 230);
  rect(t, 28, 42, 39, 44, red, seed + 872, 176);
  drawNoiseDust(t, seed + 873, [120, 64, 34], 10);
}

function drawForgedQuarantineClearanceSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 188, 122];
  const light: [number, number, number] = [236, 220, 154];
  const ink: [number, number, number] = [28, 24, 20];
  const red: [number, number, number] = [184, 34, 38];
  const iodine: [number, number, number] = [118, 96, 38];
  const green: [number, number, number] = [72, 132, 86];
  const smoke: [number, number, number] = [74, 86, 84];

  rect(t, 17, 10, 48, 54, paper, seed + 884, 248);
  rect(t, 20, 13, 45, 19, light, seed + 885, 222);
  outlineRect(t, 17, 10, 48, 54, ink);
  clearRect(t, 17, 10, 20, 13);
  clearRect(t, 46, 11, 48, 16);
  clearRect(t, 18, 51, 21, 54);
  rect(t, 17, 46, 48, 54, smoke, seed + 886, 102);
  line(t, 18, 15, 47, 51, 0.8, smoke, seed + 887, 84);

  rect(t, 29, 22, 35, 38, red, seed + 888, 238);
  rect(t, 22, 28, 42, 34, red, seed + 889, 238);
  rect(t, 23, 42, 43, 43, ink, 0, 142);
  rect(t, 23, 47, 37, 48, ink, 0, 122);
  for (let y = 23; y <= 48; y += 6) rect(t, 22, y, 41 - ((seed + y) & 5), y + 1, ink, 0, y === 29 ? 70 : 120);
  ellipse(t, 40, 36, 7.8, 5.6, red, seed + 890, 218);
  ellipse(t, 40, 36, 4.4, 2.8, paper, seed + 891, 224);
  rect(t, 37, 39, 46, 41, green, seed + 892, 180);
  ellipse(t, 24, 47, 6, 3.2, iodine, seed + 893, 132);
  drawNoiseDust(t, seed + 894, iodine, 12);
  drawNoiseDust(t, seed + 895, smoke, 8);
}

function drawForgedRaionsovetPassSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 178, 98];
  const light: [number, number, number] = [232, 208, 126];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [172, 34, 32];
  const archiveGreen: [number, number, number] = [62, 116, 84];
  const damp: [number, number, number] = [82, 96, 90];
  const rust: [number, number, number] = [122, 62, 34];

  rect(t, 12, 18, 52, 47, paper, seed + 904, 248);
  rect(t, 15, 20, 49, 24, light, seed + 905, 220);
  outlineRect(t, 12, 18, 52, 47, ink);
  clearRect(t, 12, 18, 16, 21);
  clearRect(t, 50, 18, 52, 23);
  clearRect(t, 13, 44, 16, 47);
  rect(t, 12, 21, 16, 45, damp, seed + 906, 110);
  rect(t, 13, 41, 51, 47, damp, seed + 907, 95);
  rect(t, 18, 26, 25, 42, archiveGreen, seed + 908, 212);
  rect(t, 20, 29, 23, 33, light, seed + 909, 145);
  rect(t, 29, 26, 44, 27, ink, 0, 168);
  for (let y = 31; y <= 40; y += 4) rect(t, 28, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 145);
  ellipse(t, 43, 34, 7.6, 5.4, red, seed + 910, 218);
  ellipse(t, 43, 34, 4.2, 2.7, paper, seed + 911, 224);
  rect(t, 37, 34, 49, 35, red, seed + 912, 230);
  line(t, 24, 43, 48, 24, 0.8, ink, seed + 913, 88);
  drawNoiseDust(t, seed + 914, rust, 12);
}

function drawForgedShelterTallySprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 180, 108];
  const light: [number, number, number] = [230, 212, 140];
  const ink: [number, number, number] = [22, 20, 18];
  const red: [number, number, number] = [176, 34, 34];
  const damp: [number, number, number] = [78, 92, 86];
  const violet: [number, number, number] = [112, 80, 142];

  rect(t, 16, 9, 49, 55, paper, seed + 924, 248);
  rect(t, 19, 12, 46, 17, light, seed + 925, 220);
  outlineRect(t, 16, 9, 49, 55, ink);
  clearRect(t, 16, 9, 19, 12);
  clearRect(t, 47, 10, 49, 15);
  clearRect(t, 17, 52, 20, 55);
  rect(t, 16, 47, 49, 55, damp, seed + 926, 104);
  line(t, 18, 13, 20, 52, 0.8, damp, seed + 927, 158);
  ellipse(t, 33, 36, 15, 16, violet, seed + 928, 42);

  for (let y = 21; y <= 44; y += 4) {
    rect(t, 22, y, 41 - ((seed + y) & 3), y + 1, ink, 0, 132);
    rect(t, 43, y, 46, y + 1, (y & 8) === 0 ? red : ink, 0, (y & 8) === 0 ? 168 : 110);
  }
  line(t, 23, 27, 40, 26, 0.7, red, seed + 929, 145);
  line(t, 24, 39, 44, 42, 0.8, red, seed + 930, 155);
  ellipse(t, 39, 33, 7.0, 5.0, red, seed + 931, 210);
  ellipse(t, 39, 33, 3.8, 2.4, paper, seed + 932, 218);
  drawNoiseDust(t, seed + 933, violet, 10);
}

function drawForgedStampSheetSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 184, 108];
  const light: [number, number, number] = [232, 214, 138];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [184, 32, 30];
  const damp: [number, number, number] = [82, 94, 86];
  const rust: [number, number, number] = [124, 64, 34];

  rect(t, 17, 10, 48, 54, paper, seed + 944, 248);
  rect(t, 20, 13, 45, 18, light, seed + 945, 220);
  outlineRect(t, 17, 10, 48, 54, ink);
  clearRect(t, 17, 10, 20, 13);
  clearRect(t, 46, 11, 48, 16);
  clearRect(t, 18, 51, 21, 54);
  rect(t, 17, 46, 48, 54, damp, seed + 946, 102);
  for (let y = 22; y <= 43; y += 6) rect(t, 22, y, 40 - ((seed + y) & 3), y + 1, ink, 0, 122);

  ellipse(t, 35, 32, 13, 9, red, seed + 947, 220);
  ellipse(t, 35, 32, 7.4, 4.8, paper, seed + 948, 224);
  line(t, 24, 32, 46, 32, 1.0, red, seed + 949, 232);
  rect(t, 27, 25, 43, 27, red, seed + 950, 190);
  rect(t, 26, 37, 44, 40, red, seed + 951, 185);
  rect(t, 25, 45, 40, 48, red, seed + 952, 178);
  line(t, 22, 49, 46, 20, 0.7, ink, seed + 953, 82);
  drawNoiseDust(t, seed + 954, rust, 12);
}

function drawMinistryAuditForgerySprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 96];
  const light: [number, number, number] = [232, 212, 132];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [184, 30, 32];
  const damp: [number, number, number] = [78, 92, 86];
  const violet: [number, number, number] = [112, 80, 146];
  const rust: [number, number, number] = [120, 60, 34];

  rect(t, 14, 11, 50, 54, paper, seed + 956, 248);
  rect(t, 18, 14, 47, 20, light, seed + 957, 220);
  outlineRect(t, 14, 11, 50, 54, ink);
  clearRect(t, 14, 11, 18, 14);
  clearRect(t, 48, 12, 50, 17);
  clearRect(t, 15, 51, 19, 54);
  rect(t, 14, 46, 50, 54, damp, seed + 958, 108);
  rect(t, 14, 11, 18, 52, damp, seed + 959, 88);
  line(t, 17, 14, 48, 50, 0.8, damp, seed + 960, 82);

  rect(t, 22, 23, 42, 24, ink, 0, 174);
  rect(t, 22, 28, 39, 29, ink, 0, 156);
  rect(t, 22, 33, 43, 34, ink, 0, 136);
  rect(t, 22, 38, 34, 39, ink, 0, 116);
  rect(t, 38, 21, 46, 25, violet, seed + 961, 178);
  rect(t, 39, 22, 45, 23, light, seed + 962, 120);

  ellipse(t, 39, 38, 9, 6.2, red, seed + 963, 226);
  ellipse(t, 39, 38, 5.4, 3.2, paper, seed + 964, 224);
  line(t, 32, 38, 46, 38, 0.9, red, seed + 965, 235);
  rect(t, 29, 45, 42, 48, red, seed + 966, 190);
  line(t, 24, 47, 45, 25, 0.9, ink, seed + 967, 122);
  line(t, 25, 48, 46, 26, 0.7, red, seed + 968, 138);
  drawNoiseDust(t, seed + 969, rust, 13);
}

function drawMinistryCleanStampSprite(t: Uint32Array, seed: number): void {
  const wax: [number, number, number] = [182, 30, 28];
  const waxDark: [number, number, number] = [82, 22, 24];
  const waxLight: [number, number, number] = [224, 76, 52];
  const paper: [number, number, number] = [194, 174, 112];
  const ink: [number, number, number] = [24, 22, 18];
  const damp: [number, number, number] = [78, 90, 84];
  const gold: [number, number, number] = [214, 164, 72];
  const rust: [number, number, number] = [118, 58, 34];

  rect(t, 18, 17, 47, 45, paper, seed + 970, 226);
  outlineRect(t, 18, 17, 47, 45, ink);
  clearRect(t, 18, 17, 21, 20);
  clearRect(t, 45, 18, 47, 23);
  rect(t, 18, 39, 47, 45, damp, seed + 971, 98);
  for (let y = 23; y <= 36; y += 5) rect(t, 23, y, 42 - ((seed + y) & 3), y + 1, ink, 0, 112);

  ellipse(t, 33, 34, 15, 13, waxDark, seed + 972, 226);
  ellipse(t, 33, 34, 12, 10, wax, seed + 973, 248);
  ellipse(t, 33, 34, 7, 5, waxLight, seed + 974, 128);
  line(t, 23, 34, 43, 34, 1.0, gold, seed + 975, 228);
  line(t, 33, 24, 33, 44, 1.0, gold, seed + 976, 210);
  rect(t, 27, 30, 39, 32, ink, seed + 977, 112);
  rect(t, 27, 37, 39, 39, ink, seed + 978, 96);
  ellipse(t, 23, 43, 5, 3, wax, seed + 979, 210);
  ellipse(t, 44, 27, 4, 3, wax, seed + 980, 190);
  drawNoiseDust(t, seed + 981, rust, 10);
}

function drawDebtSettlementReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 188, 118];
  const light: [number, number, number] = [236, 218, 148];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 38, 34];
  const bankGreen: [number, number, number] = [64, 126, 92];
  const damp: [number, number, number] = [82, 92, 84];
  const rust: [number, number, number] = [118, 66, 38];

  rect(t, 15, 18, 51, 47, paper, seed + 444, 248);
  rect(t, 18, 21, 48, 25, light, seed + 445, 220);
  outlineRect(t, 15, 18, 51, 47, ink);
  clearRect(t, 15, 18, 18, 21);
  clearRect(t, 49, 19, 51, 23);
  clearRect(t, 16, 45, 19, 47);
  rect(t, 15, 41, 51, 47, damp, seed + 446, 104);
  line(t, 17, 20, 49, 45, 0.8, damp, seed + 447, 94);

  rect(t, 21, 28, 37, 29, ink, 0, 170);
  rect(t, 21, 33, 42, 34, ink, 0, 136);
  rect(t, 21, 38, 34, 39, ink, 0, 118);
  rect(t, 41, 27, 47, 38, bankGreen, seed + 448, 220);
  rect(t, 43, 29, 45, 36, paper, seed + 449, 230);
  rect(t, 39, 39, 48, 42, bankGreen, seed + 450, 185);

  ellipse(t, 35, 36, 8.2, 6, red, seed + 451, 220);
  ellipse(t, 35, 36, 4.8, 3.0, paper, seed + 452, 224);
  line(t, 28, 36, 42, 36, 0.8, red, seed + 453, 235);
  line(t, 25, 43, 46, 27, 1.1, bankGreen, seed + 454, 210);
  line(t, 26, 44, 47, 28, 0.7, ink, seed + 455, 125);
  rect(t, 21, 23, 33, 24, bankGreen, seed + 456, 170);
  drawNoiseDust(t, seed + 457, rust, 10);
  drawNoiseDust(t, seed + 458, bankGreen, 7);
}

function drawBlueprintT1FolderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 180, 88];
  const paperLight: [number, number, number] = [232, 210, 126];
  const paperDark: [number, number, number] = [48, 42, 30];
  const damp: [number, number, number] = [86, 98, 92];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [174, 38, 34];
  const rust: [number, number, number] = [126, 66, 34];

  rect(t, 19, 10, 46, 49, paperLight, seed + 450, 238);
  outlineRect(t, 19, 10, 46, 49, paperDark);
  rect(t, 17, 18, 34, 25, paperLight, seed + 451, 248);
  rect(t, 15, 23, 50, 53, paper, seed + 452, 250);
  outlineRect(t, 15, 23, 50, 53, paperDark);
  line(t, 16, 28, 49, 23, 0.8, paperDark, seed + 453, 125);

  rect(t, 15, 23, 19, 53, damp, seed + 454, 118);
  rect(t, 16, 48, 50, 53, damp, seed + 455, 104);
  line(t, 18, 24, 20, 51, 0.8, damp, seed + 456, 175);

  for (let y = 29; y <= 44; y += 5) {
    rect(t, 23, y, 40 - ((seed + y) & 3), y + 1, ink, 0, 172);
  }
  rect(t, 24, 17, 38, 18, ink, 0, 140);
  rect(t, 24, 35, 29, 40, ink, 0, 135);
  line(t, 29, 38, 37, 31, 0.7, ink, seed + 457, 150);
  line(t, 37, 31, 43, 37, 0.7, ink, seed + 458, 150);
  rect(t, 36, 42, 43, 43, ink, 0, 150);

  ellipse(t, 40, 36, 7, 5, red, seed + 459, 215);
  ellipse(t, 40, 36, 3.8, 2.3, paper, seed + 460, 225);
  line(t, 35, 36, 45, 36, 0.8, red, seed + 461, 235);
  rect(t, 31, 46, 38, 49, red, seed + 462, 185);

  clearRect(t, 19, 10, 22, 13);
  clearRect(t, 44, 10, 46, 15);
  clearRect(t, 15, 50, 18, 53);
  px(t, 49, 24, CLEAR);
  px(t, 50, 25, CLEAR);
  drawNoiseDust(t, seed + 463, rust, 11);
}

function drawBlueprintT2FolderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 88];
  const paperLight: [number, number, number] = [228, 210, 118];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [172, 38, 36];
  const damp: [number, number, number] = [86, 96, 88];
  const rust: [number, number, number] = [126, 64, 34];
  const cyan: [number, number, number] = [74, 206, 224];

  ellipse(t, 34, 33, 22, 20, cyan, seed + 470, 32);
  rect(t, 16, 15, 50, 51, paper, seed + 471, 246);
  rect(t, 18, 10, 43, 18, paperLight, seed + 472, 242);
  rect(t, 28, 12, 50, 18, paper, seed + 473, 246);
  outlineRect(t, 16, 15, 50, 51, ink);
  line(t, 18, 18, 48, 49, 0.8, damp, seed + 474, 112);
  rect(t, 16, 43, 50, 51, damp, seed + 475, 105);
  rect(t, 16, 15, 20, 51, damp, seed + 476, 92);
  clearRect(t, 16, 15, 19, 18);
  clearRect(t, 48, 16, 50, 21);
  clearRect(t, 17, 48, 19, 51);

  for (let y = 23; y <= 39; y += 5) {
    rect(t, 22, y, 43 - ((y + seed) & 3), y + 1, ink, 0, 175);
  }
  rect(t, 23, 20, 34, 21, ink, 0, 155);
  line(t, 23, 43, 43, 33, 0.9, ink, seed + 477, 110);
  line(t, 25, 42, 33, 35, 0.8, cyan, seed + 478, 165);
  line(t, 34, 35, 43, 35, 0.8, cyan, seed + 479, 150);

  ellipse(t, 40, 31, 7, 5, red, seed + 480, 222);
  ellipse(t, 40, 31, 4, 2.5, paper, seed + 481, 224);
  rect(t, 36, 30, 45, 31, red, seed + 482, 230);
  rect(t, 31, 44, 38, 47, red, seed + 483, 190);
  rect(t, 42, 45, 47, 48, rust, seed + 484, 155);
  drawNoiseDust(t, seed + 485, rust, 10);
  drawNoiseDust(t, seed + 486, cyan, 12);
}

function drawBlueprintT3FolderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 166, 84];
  const paperLight: [number, number, number] = [230, 204, 124];
  const ink: [number, number, number] = [28, 24, 20];
  const red: [number, number, number] = [166, 34, 34];
  const damp: [number, number, number] = [82, 98, 96];
  const frost: [number, number, number] = [112, 154, 166];
  const rust: [number, number, number] = [116, 62, 36];

  rect(t, 20, 10, 47, 48, paperLight, seed + 450, 218);
  rect(t, 23, 13, 44, 17, [236, 218, 152], seed + 451, 190);
  outlineRect(t, 20, 10, 47, 48, ink);

  rect(t, 14, 18, 50, 52, paper, seed + 452, 246);
  rect(t, 18, 13, 34, 20, paper, seed + 453, 246);
  rect(t, 34, 17, 50, 21, paperLight, seed + 454, 224);
  outlineRect(t, 14, 18, 50, 52, ink);
  rect(t, 18, 13, 34, 15, paperLight, seed + 455, 218);
  rect(t, 18, 13, 34, 20, ink, seed + 456, 70);

  clearRect(t, 14, 18, 18, 21);
  clearRect(t, 48, 19, 50, 23);
  clearRect(t, 15, 49, 18, 52);
  rect(t, 14, 44, 50, 52, damp, seed + 457, 112);
  line(t, 16, 22, 17, 47, 1, damp, seed + 458, 172);
  line(t, 18, 51, 47, 49, 0.9, rust, seed + 459, 145);

  for (let y = 25; y <= 40; y += 5) {
    rect(t, 21, y, 44 - ((seed + y) & 5), y + 1, ink, 0, 172);
  }
  line(t, 23, 44, 42, 29, 0.8, ink, seed + 460, 138);
  line(t, 25, 30, 44, 45, 0.8, ink, seed + 461, 120);
  rect(t, 25, 34, 33, 36, ink, 0, 120);
  rect(t, 36, 38, 43, 40, ink, 0, 120);

  ellipse(t, 38, 31, 7.5, 5.5, red, seed + 462, 214);
  ellipse(t, 38, 31, 4.3, 2.7, paper, seed + 463, 224);
  line(t, 32, 31, 44, 31, 0.8, red, seed + 464, 235);
  rect(t, 30, 46, 42, 48, red, seed + 465, 185);

  ellipse(t, 23, 45, 8, 5, frost, seed + 466, 115);
  ellipse(t, 45, 23, 5, 4, frost, seed + 467, 92);
  drawNoiseDust(t, seed + 468, rust, 12);
  drawNoiseDust(t, seed + 469, frost, 10);
}

function isPaintAuditDocument(defId: string, def: ItemDef | undefined): boolean {
  const tags = tagSet(defId, def);
  return defId === 'aerosol_paint_maiden' || (has(tags, 'paint') && has(tags, 'mark') && has(tags, 'audit'));
}

function isOfficialBankDebtPaper(defId: string, def: ItemDef | undefined): boolean {
  const tags = tagSet(defId, def);
  return defId === 'bank_debt_paper'
    || (has(tags, 'banking') && has(tags, 'debt_paper') && has(tags, 'official') && !hasAny(tags, ['forged', 'forgery']));
}

function isOfficialArchivePermit(defId: string, def: ItemDef | undefined): boolean {
  const tags = tagSet(defId, def);
  return has(tags, 'archive') && has(tags, 'permit') && has(tags, 'official') && has(tags, 'ministry') && !has(tags, 'forged');
}

function drawArchiveAccessPermitSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 181, 94];
  const paperLight: [number, number, number] = [230, 210, 128];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [166, 34, 32];
  const damp: [number, number, number] = [88, 98, 92];
  const rust: [number, number, number] = [122, 62, 34];

  rect(t, 12, 18, 52, 46, paper, seed + 470);
  rect(t, 15, 20, 49, 24, paperLight, seed + 471, 215);
  rect(t, 20, 41, 48, 44, paperLight, seed + 482, 185);
  outlineRect(t, 12, 18, 52, 46, ink);
  clearRect(t, 12, 18, 15, 20);
  clearRect(t, 50, 18, 52, 21);
  clearRect(t, 12, 44, 15, 46);
  clearRect(t, 49, 44, 52, 46);

  rect(t, 12, 21, 16, 43, damp, seed + 472, 116);
  rect(t, 13, 40, 50, 46, damp, seed + 473, 96);
  rect(t, 19, 41, 38, 44, paper, seed + 482, 230);
  line(t, 15, 22, 16, 43, 0.8, damp, seed + 474, 176);
  ellipse(t, 17, 29, 1.8, 1.8, ink, seed + 475, 178);
  ellipse(t, 17, 37, 1.8, 1.8, ink, seed + 476, 164);

  rect(t, 20, 25, 40, 26, ink, 0, 174);
  for (let y = 30; y <= 39; y += 4) {
    rect(t, 21, y, 37 - ((y + seed) & 5), y + 1, ink, 0, 150);
  }

  ellipse(t, 43, 34, 7.5, 5.2, red, seed + 477, 216);
  ellipse(t, 43, 34, 4.4, 2.7, paper, seed + 478, 225);
  line(t, 37, 34, 49, 34, 0.9, red, seed + 479, 232);
  rect(t, 37, 39, 47, 41, red, seed + 480, 176);

  for (let i = 0; i < 8; i++) {
    const x = 14 + Math.floor(noise(i, 29, seed) * 35);
    const y = 20 + Math.floor(noise(i, 30, seed) * 24);
    ellipse(t, x, y, 1.1, 1.1, (i & 1) === 0 ? rust : damp, seed + 481 + i, (i & 1) === 0 ? 150 : 105);
  }
}

function drawOfficialPermitSlipSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 186, 104];
  const light: [number, number, number] = [238, 218, 136];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [178, 34, 32];
  const damp: [number, number, number] = [78, 94, 86];
  const officeGreen: [number, number, number] = [68, 126, 86];
  const rust: [number, number, number] = [124, 62, 34];

  rect(t, 12, 21, 53, 46, paper, seed + 1200, 248);
  rect(t, 15, 23, 50, 27, light, seed + 1201, 222);
  outlineRect(t, 12, 21, 53, 46, ink);
  clearRect(t, 12, 21, 16, 24);
  clearRect(t, 51, 21, 53, 25);
  clearRect(t, 13, 44, 16, 46);
  rect(t, 12, 40, 53, 46, damp, seed + 1202, 104);
  line(t, 16, 22, 18, 45, 0.8, damp, seed + 1203, 170);
  for (let x = 21; x <= 47; x += 6) rect(t, x, 22, x + 1, 45, ink, seed + 1204 + x, 32);
  for (let y = 29; y <= 39; y += 5) rect(t, 20, y, 40 - ((seed + y) & 5), y + 1, ink, 0, 160);
  rect(t, 43, 28, 50, 33, officeGreen, seed + 1205, 205);
  rect(t, 45, 29, 49, 30, light, seed + 1206, 210);
  ellipse(t, 39, 35, 7.8, 5.4, red, seed + 1207, 220);
  ellipse(t, 39, 35, 4.2, 2.6, paper, seed + 1208, 224);
  line(t, 33, 35, 45, 35, 0.8, red, seed + 1209, 235);
  rect(t, 27, 42, 40, 44, red, seed + 1210, 184);
  drawNoiseDust(t, seed + 1211, rust, 10);
  drawNoiseDust(t, seed + 1212, damp, 8);
}

function drawRailSwitchOrderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 180, 96];
  const light: [number, number, number] = [232, 210, 132];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [178, 36, 32];
  const rail: [number, number, number] = [48, 58, 58];
  const switchGreen: [number, number, number] = [62, 126, 84];
  const damp: [number, number, number] = [80, 92, 86];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 15, 12, 50, 53, paper, seed + 1213, 248);
  rect(t, 18, 15, 47, 20, light, seed + 1214, 220);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 20, 53);
  rect(t, 15, 46, 50, 53, damp, seed + 1215, 104);
  rect(t, 15, 12, 19, 53, damp, seed + 1216, 88);
  for (let y = 23; y <= 43; y += 5) rect(t, 23, y, 39 - ((seed + y) & 5), y + 1, ink, 0, 136);

  line(t, 24, 44, 44, 25, 1.15, rail, seed + 1217, 230);
  line(t, 28, 44, 48, 25, 1.15, rail, seed + 1218, 220);
  line(t, 37, 32, 49, 38, 1.1, rail, seed + 1219, 210);
  line(t, 35, 34, 46, 45, 1.0, switchGreen, seed + 1220, 216);
  rect(t, 37, 21, 47, 24, switchGreen, seed + 1221, 195);
  ellipse(t, 40, 35, 8, 5.5, red, seed + 1222, 220);
  ellipse(t, 40, 35, 4.4, 2.6, paper, seed + 1223, 224);
  line(t, 34, 35, 46, 35, 0.8, red, seed + 1224, 235);
  rect(t, 28, 47, 40, 49, red, seed + 1225, 184);
  drawNoiseDust(t, seed + 1226, rust, 11);
  drawNoiseDust(t, seed + 1227, switchGreen, 7);
}

function drawRaionsovetFloorPassSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 190, 116];
  const light: [number, number, number] = [238, 218, 146];
  const ink: [number, number, number] = [24, 22, 18];
  const archiveGreen: [number, number, number] = [58, 118, 84];
  const red: [number, number, number] = [176, 34, 32];
  const damp: [number, number, number] = [80, 94, 88];
  const rust: [number, number, number] = [122, 62, 34];

  rect(t, 11, 19, 53, 47, paper, seed + 1228, 248);
  rect(t, 14, 21, 50, 25, light, seed + 1229, 222);
  outlineRect(t, 11, 19, 53, 47, ink);
  clearRect(t, 11, 19, 15, 22);
  clearRect(t, 51, 20, 53, 24);
  clearRect(t, 12, 44, 16, 47);
  rect(t, 11, 41, 53, 47, damp, seed + 1230, 96);
  rect(t, 17, 27, 28, 42, archiveGreen, seed + 1231, 224);
  rect(t, 20, 29, 25, 33, light, seed + 1232, 150);
  rect(t, 20, 35, 25, 40, ink, seed + 1233, 120);
  rect(t, 31, 27, 47, 28, ink, 0, 165);
  for (let y = 32; y <= 40; y += 4) rect(t, 31, y, 45 - ((seed + y) & 5), y + 1, ink, 0, 140);
  ellipse(t, 43, 35, 7.8, 5.2, red, seed + 1234, 220);
  ellipse(t, 43, 35, 4.3, 2.5, paper, seed + 1235, 224);
  line(t, 37, 35, 49, 35, 0.8, red, seed + 1236, 235);
  rect(t, 36, 22, 49, 24, archiveGreen, seed + 1237, 170);
  rect(t, 27, 43, 43, 45, red, seed + 1238, 174);
  line(t, 16, 44, 50, 24, 0.8, rust, seed + 1239, 120);
  drawNoiseDust(t, seed + 1240, rust, 11);
  drawNoiseDust(t, seed + 1241, archiveGreen, 8);
}

function drawOvbSearchWarrantSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 176, 102];
  const light: [number, number, number] = [228, 210, 136];
  const ink: [number, number, number] = [20, 18, 16];
  const red: [number, number, number] = [178, 30, 30];
  const slate: [number, number, number] = [52, 60, 62];
  const damp: [number, number, number] = [76, 88, 82];
  const rust: [number, number, number] = [124, 62, 34];

  rect(t, 16, 10, 49, 55, paper, seed + 1220, 248);
  rect(t, 19, 13, 46, 19, light, seed + 1221, 218);
  outlineRect(t, 16, 10, 49, 55, ink);
  clearRect(t, 16, 10, 20, 13);
  clearRect(t, 47, 11, 49, 16);
  clearRect(t, 17, 52, 20, 55);
  rect(t, 16, 10, 20, 55, slate, seed + 1222, 138);
  rect(t, 16, 47, 49, 55, damp, seed + 1223, 105);
  line(t, 18, 15, 47, 52, 0.8, damp, seed + 1224, 90);
  rect(t, 23, 22, 42, 23, ink, 0, 178);
  for (let y = 28; y <= 43; y += 5) rect(t, 23, y, 43 - ((seed + y) & 7), y + 1, ink, 0, 148);
  line(t, 21, 49, 47, 24, 1.3, red, seed + 1225, 215);
  line(t, 22, 50, 48, 25, 0.7, ink, seed + 1226, 105);
  ellipse(t, 38, 35, 8.5, 6.2, red, seed + 1227, 222);
  ellipse(t, 38, 35, 4.6, 3.0, paper, seed + 1228, 224);
  rect(t, 31, 34, 45, 35, red, seed + 1229, 235);
  rect(t, 28, 45, 41, 48, red, seed + 1230, 186);
  rect(t, 24, 25, 33, 28, slate, seed + 1231, 178);
  drawNoiseDust(t, seed + 1232, rust, 13);
}

function drawP14GasmaskReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 184, 116];
  const light: [number, number, number] = [236, 218, 146];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 36, 34];
  const rubber: [number, number, number] = [42, 54, 48];
  const glass: [number, number, number] = [110, 160, 150];
  const damp: [number, number, number] = [78, 92, 84];
  const rust: [number, number, number] = [118, 64, 36];

  rect(t, 13, 18, 52, 48, paper, seed + 1240, 248);
  rect(t, 16, 20, 49, 24, light, seed + 1241, 220);
  outlineRect(t, 13, 18, 52, 48, ink);
  clearRect(t, 13, 18, 17, 21);
  clearRect(t, 50, 19, 52, 23);
  clearRect(t, 14, 45, 17, 48);
  rect(t, 13, 42, 52, 48, damp, seed + 1242, 102);
  line(t, 17, 20, 18, 46, 0.8, damp, seed + 1243, 168);
  ellipse(t, 27, 34, 7, 6, rubber, seed + 1244, 230);
  ellipse(t, 37, 34, 7, 6, rubber, seed + 1245, 228);
  ellipse(t, 27, 34, 3.4, 3.2, glass, seed + 1246, 210);
  ellipse(t, 37, 34, 3.4, 3.2, glass, seed + 1247, 210);
  rect(t, 29, 39, 36, 44, rubber, seed + 1248, 225);
  rect(t, 24, 28, 40, 29, ink, 0, 118);
  for (let y = 26; y <= 42; y += 5) rect(t, 43, y, 49 - ((seed + y) & 3), y + 1, ink, 0, 135);
  ellipse(t, 43, 37, 7, 4.8, red, seed + 1249, 210);
  ellipse(t, 43, 37, 3.8, 2.4, paper, seed + 1250, 224);
  rect(t, 35, 44, 45, 46, red, seed + 1251, 180);
  drawNoiseDust(t, seed + 1252, rust, 10);
  drawNoiseDust(t, seed + 1253, glass, 8);
}

function drawPartTicketSprite(t: Uint32Array, seed: number): void {
  const red: [number, number, number] = [146, 28, 30];
  const redLight: [number, number, number] = [196, 56, 48];
  const gold: [number, number, number] = [218, 174, 76];
  const paper: [number, number, number] = [226, 204, 138];
  const ink: [number, number, number] = [22, 20, 16];
  const damp: [number, number, number] = [68, 76, 66];
  const rust: [number, number, number] = [116, 58, 34];

  rect(t, 17, 11, 48, 54, red, seed + 1260, 248);
  rect(t, 20, 14, 45, 20, redLight, seed + 1261, 218);
  outlineRect(t, 17, 11, 48, 54, ink);
  clearRect(t, 17, 11, 20, 14);
  clearRect(t, 46, 12, 48, 17);
  clearRect(t, 18, 51, 21, 54);
  rect(t, 17, 46, 48, 54, damp, seed + 1262, 92);
  rect(t, 22, 25, 43, 41, paper, seed + 1263, 232);
  outlineRect(t, 22, 25, 43, 41, ink);
  for (let y = 29; y <= 38; y += 4) rect(t, 26, y, 39 - ((seed + y) & 3), y + 1, ink, 0, 135);
  line(t, 32, 17, 34, 25, 1.1, gold, seed + 1264, 235);
  line(t, 28, 21, 38, 21, 1.1, gold, seed + 1265, 235);
  line(t, 29, 18, 37, 24, 0.9, gold, seed + 1266, 230);
  line(t, 37, 18, 29, 24, 0.9, gold, seed + 1267, 230);
  ellipse(t, 39, 43, 7.0, 4.7, gold, seed + 1268, 210);
  ellipse(t, 39, 43, 3.8, 2.3, red, seed + 1269, 218);
  line(t, 24, 48, 45, 17, 0.7, ink, seed + 1270, 85);
  drawNoiseDust(t, seed + 1271, rust, 12);
  drawNoiseDust(t, seed + 1272, gold, 8);
}

function drawCleanHealthCertSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [210, 194, 134];
  const paperLight: [number, number, number] = [236, 222, 164];
  const ink: [number, number, number] = [34, 30, 24];
  const red: [number, number, number] = [184, 38, 42];
  const damp: [number, number, number] = [82, 94, 86];
  const green: [number, number, number] = [72, 134, 96];
  const rust: [number, number, number] = [128, 66, 36];

  rect(t, 16, 10, 49, 53, paper, seed + 487, 246);
  rect(t, 19, 13, 46, 19, paperLight, seed + 488, 225);
  outlineRect(t, 16, 10, 49, 53, ink);
  clearRect(t, 16, 10, 19, 13);
  clearRect(t, 47, 11, 49, 16);
  clearRect(t, 16, 50, 19, 53);
  line(t, 17, 18, 47, 49, 0.8, damp, seed + 489, 82);
  rect(t, 16, 44, 49, 53, damp, seed + 490, 96);
  rect(t, 17, 12, 20, 50, damp, seed + 491, 92);

  rect(t, 29, 21, 35, 38, red, seed + 492, 242);
  rect(t, 22, 28, 42, 34, red, seed + 493, 242);
  rect(t, 24, 41, 42, 43, ink, 0, 145);
  for (let y = 24; y <= 47; y += 5) rect(t, 22, y, 39 - ((seed + y) & 3), y + 1, ink, 0, y === 29 ? 70 : 135);

  ellipse(t, 41, 35, 7.8, 5.8, red, seed + 494, 218);
  ellipse(t, 41, 35, 4.6, 3.0, paper, seed + 495, 224);
  line(t, 35, 35, 47, 35, 0.8, red, seed + 496, 232);
  rect(t, 38, 37, 45, 39, green, seed + 497, 188);
  rect(t, 37, 46, 45, 48, rust, seed + 498, 145);
  drawNoiseDust(t, seed + 499, rust, 10);
  drawNoiseDust(t, seed + 500, green, 8);
}

function drawCleanupOrderStubSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 98];
  const light: [number, number, number] = [232, 210, 130];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 38, 34];
  const damp: [number, number, number] = [82, 96, 86];
  const rust: [number, number, number] = [120, 64, 36];

  rect(t, 13, 20, 50, 47, paper, seed + 501, 248);
  rect(t, 16, 15, 45, 23, light, seed + 502, 238);
  outlineRect(t, 13, 20, 50, 47, ink);
  clearRect(t, 13, 20, 17, 23);
  clearRect(t, 48, 20, 50, 24);
  clearRect(t, 13, 44, 16, 47);
  rect(t, 13, 20, 18, 47, damp, seed + 503, 112);
  rect(t, 14, 42, 49, 47, damp, seed + 504, 95);
  line(t, 18, 20, 20, 46, 0.8, damp, seed + 505, 172);

  for (let x = 21; x <= 43; x += 5) line(t, x, 17, x + 2, 21, 0.7, ink, seed + 506 + x, 130);
  rect(t, 22, 25, 42, 26, ink, 0, 176);
  for (let y = 30; y <= 40; y += 4) rect(t, 21, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 155);

  ellipse(t, 39, 35, 7.5, 5.2, red, seed + 511, 218);
  ellipse(t, 39, 35, 4.1, 2.5, paper, seed + 512, 224);
  line(t, 34, 35, 44, 35, 0.8, red, seed + 513, 232);
  rect(t, 27, 41, 37, 44, red, seed + 514, 184);
  rect(t, 29, 42, 35, 43, ink, 0, 110);
  drawNoiseDust(t, seed + 515, rust, 10);
}

function drawDeconCompletionStampSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 184, 124];
  const light: [number, number, number] = [232, 216, 150];
  const ink: [number, number, number] = [26, 24, 20];
  const wetRed: [number, number, number] = [180, 38, 38];
  const deconGreen: [number, number, number] = [78, 154, 112];
  const damp: [number, number, number] = [74, 92, 84];
  const rust: [number, number, number] = [124, 66, 38];

  rect(t, 16, 12, 49, 53, paper, seed + 516, 246);
  rect(t, 19, 15, 46, 20, light, seed + 517, 224);
  outlineRect(t, 16, 12, 49, 53, ink);
  clearRect(t, 16, 12, 19, 15);
  clearRect(t, 47, 13, 49, 18);
  clearRect(t, 17, 50, 20, 53);
  rect(t, 16, 43, 49, 53, damp, seed + 518, 108);
  rect(t, 16, 12, 20, 52, damp, seed + 519, 88);
  line(t, 18, 18, 48, 49, 0.8, damp, seed + 520, 92);

  for (let y = 24; y <= 42; y += 5) rect(t, 22, y, 42 - ((seed + y) & 3), y + 1, ink, 0, 130);
  ellipse(t, 34, 35, 12.2, 9.2, wetRed, seed + 521, 218);
  ellipse(t, 34, 35, 8.2, 5.8, paper, seed + 522, 220);
  rect(t, 24, 34, 45, 36, wetRed, seed + 523, 232);
  rect(t, 27, 39, 42, 42, wetRed, seed + 524, 188);
  rect(t, 29, 31, 37, 39, deconGreen, seed + 525, 220);
  rect(t, 31, 27, 35, 43, deconGreen, seed + 526, 225);
  ellipse(t, 43, 47, 7, 3.2, deconGreen, seed + 527, 116);
  rect(t, 39, 20, 46, 23, rust, seed + 528, 140);
  drawNoiseDust(t, seed + 529, deconGreen, 11);
  drawNoiseDust(t, seed + 530, rust, 9);
}

function drawConfiscationTagSprite(t: Uint32Array, seed: number): void {
  const red: [number, number, number] = [168, 36, 34];
  const redLight: [number, number, number] = [214, 68, 54];
  const paper: [number, number, number] = [214, 190, 122];
  const ink: [number, number, number] = [24, 22, 18];
  const string: [number, number, number] = [110, 102, 78];
  const damp: [number, number, number] = [76, 88, 78];

  line(t, 28, 12, 22, 20, 1.2, string, seed + 521, 210);
  line(t, 28, 12, 35, 19, 1.2, string, seed + 522, 205);
  ellipse(t, 28, 12, 3.6, 3.6, string, seed + 523, 220);
  ellipse(t, 28, 12, 1.6, 1.6, [0, 0, 0], 0, 0);

  rect(t, 18, 19, 46, 51, red, seed + 524, 248);
  rect(t, 21, 22, 43, 29, redLight, seed + 525, 226);
  outlineRect(t, 18, 19, 46, 51, ink);
  clearRect(t, 18, 19, 21, 22);
  clearRect(t, 44, 19, 46, 24);
  clearRect(t, 18, 48, 21, 51);
  line(t, 20, 49, 45, 46, 0.9, damp, seed + 526, 128);

  rect(t, 22, 32, 42, 42, paper, seed + 527, 235);
  outlineRect(t, 22, 32, 42, 42, ink);
  rect(t, 25, 35, 39, 36, ink, 0, 150);
  rect(t, 25, 39, 35, 40, ink, 0, 125);
  rect(t, 31, 22, 36, 48, ink, seed + 528, 48);
  line(t, 23, 25, 42, 46, 0.8, ink, seed + 529, 80);
  drawNoiseDust(t, seed + 530, damp, 12);
}

function drawConfiscationWarrantSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 180, 100];
  const light: [number, number, number] = [232, 212, 132];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 34, 34];
  const damp: [number, number, number] = [80, 92, 84];
  const rust: [number, number, number] = [126, 66, 34];

  rect(t, 17, 10, 48, 54, paper, seed + 531, 247);
  rect(t, 20, 13, 45, 19, light, seed + 532, 224);
  outlineRect(t, 17, 10, 48, 54, ink);
  clearRect(t, 17, 10, 20, 13);
  clearRect(t, 46, 11, 48, 17);
  clearRect(t, 18, 51, 21, 54);
  rect(t, 17, 46, 48, 54, damp, seed + 533, 104);
  line(t, 19, 14, 46, 52, 0.8, damp, seed + 534, 88);

  rect(t, 22, 22, 41, 23, ink, 0, 174);
  rect(t, 22, 27, 36, 28, ink, 0, 145);
  for (let y = 32; y <= 44; y += 4) rect(t, 22, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 132);
  line(t, 21, 48, 44, 25, 1.2, red, seed + 535, 205);
  line(t, 22, 49, 45, 26, 0.7, ink, seed + 536, 100);

  ellipse(t, 39, 35, 8.2, 6.2, red, seed + 537, 224);
  ellipse(t, 39, 35, 4.8, 3.1, paper, seed + 538, 224);
  rect(t, 33, 34, 45, 35, red, seed + 539, 232);
  rect(t, 29, 46, 39, 49, red, seed + 540, 185);
  drawNoiseDust(t, seed + 541, rust, 11);
}

function drawFakePassSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 178, 104];
  const light: [number, number, number] = [232, 214, 136];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 36, 34];
  const damp: [number, number, number] = [78, 90, 82];
  const photo: [number, number, number] = [56, 62, 60];
  const blue: [number, number, number] = [64, 116, 142];
  const rust: [number, number, number] = [124, 66, 38];

  rect(t, 13, 19, 51, 46, paper, seed + 542, 248);
  rect(t, 16, 21, 48, 25, light, seed + 543, 220);
  outlineRect(t, 13, 19, 51, 46, ink);
  clearRect(t, 13, 19, 16, 22);
  clearRect(t, 49, 19, 51, 23);
  clearRect(t, 14, 44, 17, 46);
  rect(t, 13, 40, 51, 46, damp, seed + 544, 104);
  line(t, 15, 21, 49, 43, 0.8, damp, seed + 545, 92);

  rect(t, 18, 28, 29, 40, photo, seed + 546, 238);
  ellipse(t, 23, 32, 3.2, 3.2, ink, seed + 547, 220);
  rect(t, 20, 36, 27, 39, ink, seed + 548, 175);
  rect(t, 21, 29, 28, 31, blue, seed + 549, 175);
  for (let y = 28; y <= 39; y += 4) rect(t, 32, y, 47 - ((seed + y) & 5), y + 1, ink, 0, 145);

  ellipse(t, 42, 34, 8, 5.5, red, seed + 550, 218);
  ellipse(t, 42, 34, 4.4, 2.7, paper, seed + 551, 225);
  line(t, 36, 34, 48, 34, 0.8, red, seed + 552, 232);
  rect(t, 32, 42, 43, 44, red, seed + 553, 178);
  rect(t, 39, 22, 49, 25, red, seed + 554, 190);
  rect(t, 41, 23, 47, 24, light, seed + 555, 215);
  line(t, 33, 27, 49, 39, 0.8, red, seed + 556, 125);
  drawNoiseDust(t, seed + 557, rust, 10);
}

function drawContaminatedGlovesSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [190, 186, 146];
  const rubberLight: [number, number, number] = [226, 218, 168];
  const cuff: [number, number, number] = [98, 106, 92];
  const ink: [number, number, number] = [28, 26, 22];
  const stain: [number, number, number] = [80, 116, 70];
  const brown: [number, number, number] = [104, 58, 34];
  const red: [number, number, number] = [170, 38, 34];

  ellipse(t, 25, 37, 10, 12, rubber, seed + 542, 246);
  ellipse(t, 39, 35, 10, 12, rubberLight, seed + 543, 238);
  rect(t, 17, 43, 30, 51, cuff, seed + 544, 218);
  rect(t, 35, 41, 48, 49, cuff, seed + 545, 210);
  for (let i = 0; i < 4; i++) {
    line(t, 17 + i * 3, 34, 15 + i * 3, 19 + i, 2.0, rubber, seed + 546 + i, 238);
    line(t, 34 + i * 3, 32, 35 + i * 3, 17 + i, 2.0, rubberLight, seed + 550 + i, 230);
  }
  line(t, 27, 35, 34, 21, 2.1, rubber, seed + 554, 235);
  line(t, 46, 33, 51, 22, 2.0, rubberLight, seed + 555, 225);
  ellipse(t, 24, 38, 7, 4, stain, seed + 556, 170);
  ellipse(t, 41, 31, 5, 4, brown, seed + 557, 155);
  line(t, 20, 49, 47, 46, 0.9, ink, seed + 558, 140);
  rect(t, 30, 48, 45, 53, red, seed + 559, 200);
  rect(t, 33, 50, 42, 51, rubberLight, seed + 560, 210);
  drawNoiseDust(t, seed + 561, stain, 16);
  drawNoiseDust(t, seed + 562, brown, 12);
}

function drawContaminatedSampleActSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 178, 104];
  const light: [number, number, number] = [232, 212, 134];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 36, 34];
  const damp: [number, number, number] = [82, 96, 88];
  const slime: [number, number, number] = [82, 154, 92];
  const glow: [number, number, number] = [112, 224, 120];

  rect(t, 16, 10, 49, 54, paper, seed + 563, 246);
  rect(t, 19, 13, 45, 19, light, seed + 564, 222);
  outlineRect(t, 16, 10, 49, 54, ink);
  clearRect(t, 16, 10, 19, 13);
  clearRect(t, 47, 11, 49, 17);
  clearRect(t, 17, 51, 20, 54);
  rect(t, 16, 45, 49, 54, damp, seed + 565, 104);
  rect(t, 16, 12, 20, 51, damp, seed + 566, 96);
  for (let y = 23; y <= 42; y += 5) {
    rect(t, 22, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 158);
  }
  rect(t, 22, 20, 35, 21, ink, 0, 168);
  ellipse(t, 38, 33, 8.3, 6, red, seed + 567, 218);
  ellipse(t, 38, 33, 4.8, 3.1, paper, seed + 568, 224);
  line(t, 32, 33, 44, 33, 0.8, red, seed + 569, 235);
  rect(t, 28, 46, 41, 49, red, seed + 570, 182);
  ellipse(t, 27, 44, 9, 6, slime, seed + 571, 172);
  ellipse(t, 25, 42, 4, 3, glow, seed + 572, 96);
  line(t, 20, 17, 47, 50, 0.8, damp, seed + 573, 96);
  drawNoiseDust(t, seed + 574, slime, 13);
}

function drawContaminatedSwabSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 184, 116];
  const light: [number, number, number] = [234, 218, 146];
  const ink: [number, number, number] = [28, 24, 18];
  const red: [number, number, number] = [170, 38, 34];
  const stick: [number, number, number] = [214, 192, 132];
  const cotton: [number, number, number] = [218, 216, 184];
  const slime: [number, number, number] = [78, 136, 70];
  const brown: [number, number, number] = [106, 58, 36];

  rect(t, 14, 17, 50, 49, paper, seed + 575, 242);
  rect(t, 17, 14, 42, 21, light, seed + 576, 230);
  outlineRect(t, 14, 17, 50, 49, ink);
  clearRect(t, 14, 17, 17, 20);
  clearRect(t, 48, 18, 50, 22);
  clearRect(t, 15, 46, 18, 49);
  for (let y = 25; y <= 42; y += 5) rect(t, 20, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 105);
  line(t, 18, 42, 48, 22, 1.2, stick, seed + 577, 238);
  line(t, 19, 43, 49, 23, 0.65, ink, seed + 578, 95);
  ellipse(t, 47, 22, 6.8, 4.4, cotton, seed + 579, 238);
  ellipse(t, 45, 23, 4.4, 3.1, slime, seed + 580, 178);
  ellipse(t, 49, 20, 2.8, 2.2, brown, seed + 581, 158);
  ellipse(t, 26, 43, 8, 4.2, slime, seed + 582, 96);
  rect(t, 20, 20, 31, 23, red, seed + 583, 205);
  rect(t, 22, 21, 29, 22, paper, seed + 584, 220);
  drawNoiseDust(t, seed + 585, brown, 12);
  drawNoiseDust(t, seed + 586, slime, 8);
}

function drawContrabandReceiptBlankSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 188, 124];
  const light: [number, number, number] = [236, 220, 152];
  const ink: [number, number, number] = [28, 24, 18];
  const red: [number, number, number] = [174, 36, 34];
  const damp: [number, number, number] = [82, 92, 80];
  const ochre: [number, number, number] = [186, 128, 52];

  rect(t, 18, 10, 47, 54, paper, seed + 587, 246);
  rect(t, 21, 13, 44, 18, light, seed + 588, 222);
  outlineRect(t, 18, 10, 47, 54, ink);
  clearRect(t, 18, 10, 21, 13);
  clearRect(t, 45, 11, 47, 17);
  clearRect(t, 19, 51, 22, 54);
  rect(t, 18, 49, 47, 54, damp, seed + 589, 94);
  rect(t, 22, 24, 42, 34, light, seed + 590, 150);
  outlineRect(t, 22, 24, 42, 34, ink);
  rect(t, 22, 35, 43, 37, paper, seed + 597, 230);
  rect(t, 23, 20, 38, 21, ink, 0, 145);
  for (let y = 38; y <= 47; y += 4) rect(t, 23, y, 40 - ((seed + y) & 5), y + 1, ink, 0, 120);
  line(t, 20, 50, 45, 15, 1.2, red, seed + 591, 212);
  line(t, 21, 51, 46, 16, 0.7, ink, seed + 592, 90);
  rect(t, 35, 39, 45, 44, red, seed + 593, 188);
  rect(t, 37, 41, 43, 42, paper, seed + 594, 218);
  rect(t, 14, 25, 20, 32, ochre, seed + 595, 222);
  rect(t, 16, 28, 20, 29, ink, 0, 115);
  drawNoiseDust(t, seed + 596, ochre, 12);
}

function drawCorpseNumberTagSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [146, 150, 134];
  const light: [number, number, number] = [204, 204, 176];
  const dark: [number, number, number] = [42, 44, 40];
  const rust: [number, number, number] = [126, 62, 34];
  const blood: [number, number, number] = [128, 28, 28];
  const string: [number, number, number] = [112, 104, 78];

  line(t, 21, 12, 30, 23, 1.2, string, seed + 597, 205);
  line(t, 21, 12, 43, 25, 1.0, string, seed + 598, 180);
  rect(t, 17, 21, 49, 46, metal, seed + 599, 246);
  rect(t, 20, 24, 46, 29, light, seed + 600, 190);
  outlineRect(t, 17, 21, 49, 46, dark);
  clearRect(t, 17, 21, 20, 24);
  clearRect(t, 47, 21, 49, 25);
  clearRect(t, 18, 44, 21, 46);
  ellipse(t, 23, 26, 3.2, 3.2, dark, seed + 601, 235);
  ellipse(t, 23, 26, 1.4, 1.4, [0, 0, 0], 0, 0);
  rect(t, 29, 31, 33, 40, dark, seed + 602, 210);
  rect(t, 37, 31, 42, 40, dark, seed + 603, 210);
  rect(t, 34, 35, 38, 38, dark, seed + 604, 210);
  rect(t, 30, 32, 32, 34, metal, seed + 605, 230);
  rect(t, 38, 33, 40, 35, metal, seed + 606, 230);
  line(t, 19, 44, 48, 42, 0.8, rust, seed + 607, 140);
  ellipse(t, 42, 42, 5, 3, blood, seed + 608, 118);
  drawNoiseDust(t, seed + 609, rust, 15);
}

function drawFoamGrenadeActSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 98];
  const paperLight: [number, number, number] = [232, 212, 132];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 38, 34];
  const damp: [number, number, number] = [82, 94, 88];
  const foam: [number, number, number] = [104, 194, 172];
  const foamLight: [number, number, number] = [178, 238, 210];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 16, 12, 49, 53, paper, seed + 542, 247);
  rect(t, 19, 15, 46, 20, paperLight, seed + 543, 222);
  outlineRect(t, 16, 12, 49, 53, ink);
  clearRect(t, 16, 12, 19, 15);
  clearRect(t, 47, 13, 49, 18);
  clearRect(t, 17, 50, 20, 53);
  rect(t, 16, 45, 49, 53, damp, seed + 544, 104);
  line(t, 18, 15, 47, 50, 0.8, damp, seed + 545, 88);

  rect(t, 22, 23, 43, 24, ink, 0, 175);
  for (let y = 29; y <= 41; y += 4) rect(t, 22, y, 40 - ((seed + y) & 5), y + 1, ink, 0, 140);
  ellipse(t, 39, 34, 8.2, 5.8, red, seed + 546, 220);
  ellipse(t, 39, 34, 4.8, 3.0, paper, seed + 547, 226);
  rect(t, 34, 33, 45, 35, red, seed + 548, 230);
  rect(t, 29, 45, 40, 48, red, seed + 549, 182);

  ellipse(t, 27, 37, 6.2, 7.6, foam, seed + 550, 214);
  ellipse(t, 27, 37, 3.2, 4.3, foamLight, seed + 551, 178);
  rect(t, 24, 30, 31, 33, ink, seed + 552, 178);
  line(t, 30, 30, 38, 27, 0.9, ink, seed + 553, 170);
  rect(t, 21, 42, 35, 44, foam, seed + 554, 150);
  drawNoiseDust(t, seed + 555, rust, 11);
  drawNoiseDust(t, seed + 556, foamLight, 8);
}

function drawFuelIssueStampSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 178, 100];
  const paperLight: [number, number, number] = [232, 208, 128];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 34, 30];
  const oil: [number, number, number] = [60, 58, 42];
  const damp: [number, number, number] = [82, 96, 88];
  const fuel: [number, number, number] = [218, 126, 44];
  const rust: [number, number, number] = [132, 66, 34];

  rect(t, 15, 13, 50, 51, paper, seed + 557, 247);
  rect(t, 18, 16, 46, 21, paperLight, seed + 558, 220);
  outlineRect(t, 15, 13, 50, 51, ink);
  clearRect(t, 15, 13, 18, 16);
  clearRect(t, 48, 14, 50, 19);
  clearRect(t, 16, 48, 19, 51);
  rect(t, 15, 42, 50, 51, damp, seed + 559, 96);
  rect(t, 16, 13, 20, 49, damp, seed + 560, 104);
  line(t, 18, 17, 47, 48, 0.8, damp, seed + 561, 92);
  rect(t, 20, 22, 42, 41, paper, seed + 574, 238);

  rect(t, 22, 23, 40, 24, ink, 0, 172);
  for (let y = 28; y <= 40; y += 4) rect(t, 22, y, 38 - ((seed + y) & 3), y + 1, ink, 0, 136);
  rect(t, 21, 39, 36, 42, paper, seed + 575, 232);
  rect(t, 42, 23, 48, 35, oil, seed + 562, 205);
  rect(t, 43, 25, 47, 32, fuel, seed + 563, 212);
  rect(t, 44, 26, 46, 28, paperLight, seed + 564, 142);
  line(t, 43, 35, 49, 42, 1.1, fuel, seed + 565, 165);
  ellipse(t, 49, 42, 3.6, 2.8, oil, seed + 566, 130);

  ellipse(t, 37, 36, 8, 5.5, red, seed + 567, 222);
  ellipse(t, 37, 36, 4.4, 2.7, paper, seed + 568, 224);
  rect(t, 31, 35, 43, 36, red, seed + 569, 235);
  rect(t, 27, 45, 39, 48, red, seed + 570, 188);
  line(t, 21, 47, 45, 45, 0.9, oil, seed + 571, 145);
  drawNoiseDust(t, seed + 572, rust, 12);
  drawNoiseDust(t, seed + 573, fuel, 8);
}

function drawElevatorAccessOrderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [190, 174, 118];
  const light: [number, number, number] = [226, 210, 154];
  const ink: [number, number, number] = [30, 28, 23];
  const red: [number, number, number] = [176, 38, 34];
  const blue: [number, number, number] = [58, 112, 142];
  const damp: [number, number, number] = [72, 86, 74];
  const brass: [number, number, number] = [184, 132, 48];

  rect(t, 16, 9, 49, 54, paper, seed + 574, 246);
  rect(t, 19, 12, 46, 18, light, seed + 575, 226);
  outlineRect(t, 16, 9, 49, 54, ink);
  clearRect(t, 16, 9, 19, 12);
  clearRect(t, 47, 10, 49, 16);
  clearRect(t, 17, 51, 20, 54);
  rect(t, 16, 47, 49, 54, damp, seed + 576, 92);
  rect(t, 25, 22, 40, 43, ink, seed + 577, 185);
  rect(t, 28, 24, 37, 41, paper, seed + 578, 245);
  line(t, 32, 25, 32, 39, 0.9, blue, seed + 579, 230);
  line(t, 29, 30, 35, 24, 1.0, blue, seed + 580, 230);
  line(t, 35, 24, 38, 30, 1.0, blue, seed + 581, 230);
  line(t, 29, 35, 35, 41, 1.0, blue, seed + 582, 215);
  line(t, 35, 41, 38, 35, 1.0, blue, seed + 583, 215);
  rect(t, 20, 22, 24, 25, brass, seed + 584, 220);
  rect(t, 41, 32, 46, 36, brass, seed + 585, 210);
  for (let y = 22; y <= 44; y += 5) rect(t, 20, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 105);
  ellipse(t, 39, 37, 7, 5, red, seed + 586, 220);
  ellipse(t, 39, 37, 3.8, 2.3, paper, seed + 587, 226);
  line(t, 34, 37, 44, 37, 0.8, red, seed + 588, 235);
  rect(t, 28, 47, 43, 50, red, seed + 589, 170);
  drawNoiseDust(t, seed + 590, damp, 13);
  drawNoiseDust(t, seed + 591, red, 7);
}

function drawGuslIndexPageSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 184, 106];
  const light: [number, number, number] = [232, 214, 140];
  const ink: [number, number, number] = [20, 22, 20];
  const red: [number, number, number] = [174, 38, 34];
  const damp: [number, number, number] = [76, 88, 82];
  const blue: [number, number, number] = [64, 104, 124];
  const rust: [number, number, number] = [126, 66, 34];

  rect(t, 17, 9, 49, 55, paper, seed + 592, 247);
  rect(t, 20, 12, 46, 17, light, seed + 593, 226);
  outlineRect(t, 17, 9, 49, 55, ink);
  clearRect(t, 17, 9, 20, 12);
  clearRect(t, 47, 10, 49, 16);
  clearRect(t, 18, 52, 21, 55);
  rect(t, 17, 46, 49, 55, damp, seed + 594, 96);
  rect(t, 17, 9, 21, 53, damp, seed + 595, 86);
  line(t, 19, 15, 47, 52, 0.8, damp, seed + 596, 86);
  rect(t, 24, 20, 42, 21, ink, 0, 174);
  for (let y = 25; y <= 43; y += 5) rect(t, 22, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 144);
  line(t, 24, 38, 41, 29, 1.1, blue, seed + 597, 210);
  line(t, 37, 30, 45, 34, 1.0, ink, seed + 598, 160);
  rect(t, 23, 33, 30, 36, blue, seed + 599, 170);
  ellipse(t, 40, 38, 8, 5.6, red, seed + 600, 220);
  ellipse(t, 40, 38, 4.6, 2.9, paper, seed + 601, 225);
  line(t, 34, 38, 46, 38, 0.8, red, seed + 602, 232);
  rect(t, 28, 47, 39, 49, red, seed + 603, 182);
  drawNoiseDust(t, seed + 604, rust, 10);
  drawNoiseDust(t, seed + 605, blue, 6);
}

function drawHazardShiftExtensionSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 178, 90];
  const light: [number, number, number] = [232, 206, 118];
  const ink: [number, number, number] = [22, 22, 18];
  const red: [number, number, number] = [182, 36, 32];
  const yellow: [number, number, number] = [216, 152, 40];
  const damp: [number, number, number] = [70, 86, 78];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 14, 16, 52, 49, paper, seed + 606, 248);
  rect(t, 17, 18, 49, 23, light, seed + 607, 226);
  outlineRect(t, 14, 16, 52, 49, ink);
  clearRect(t, 14, 16, 17, 19);
  clearRect(t, 50, 16, 52, 21);
  clearRect(t, 15, 46, 18, 49);
  rect(t, 14, 42, 52, 49, damp, seed + 608, 98);
  rect(t, 14, 16, 18, 47, damp, seed + 609, 82);
  rect(t, 19, 25, 48, 29, yellow, seed + 610, 238);
  for (let x = 20; x <= 45; x += 6) line(t, x, 25, x + 4, 29, 0.9, ink, seed + 611 + x, 190);
  rect(t, 22, 33, 43, 34, ink, 0, 162);
  rect(t, 22, 37, 38, 38, ink, 0, 132);
  rect(t, 22, 40, 45, 41, ink, 0, 116);
  line(t, 20, 45, 47, 20, 1.1, red, seed + 612, 165);
  ellipse(t, 42, 36, 8, 5.7, red, seed + 613, 220);
  ellipse(t, 42, 36, 4.4, 2.6, paper, seed + 614, 225);
  rect(t, 35, 35, 49, 36, red, seed + 615, 232);
  rect(t, 26, 20, 34, 22, red, seed + 616, 200);
  rect(t, 29, 44, 41, 47, red, seed + 617, 168);
  drawNoiseDust(t, seed + 618, rust, 12);
}

function drawHermodoorJournalSprite(t: Uint32Array, seed: number): void {
  const cover: [number, number, number] = [60, 72, 66];
  const coverLight: [number, number, number] = [104, 118, 106];
  const paper: [number, number, number] = [202, 184, 118];
  const ink: [number, number, number] = [22, 20, 18];
  const red: [number, number, number] = [172, 38, 34];
  const blue: [number, number, number] = [58, 124, 164];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 18, 13, 51, 54, paper, seed + 619, 235);
  rect(t, 15, 10, 45, 51, cover, seed + 620, 250);
  rect(t, 18, 13, 42, 19, coverLight, seed + 621, 210);
  outlineRect(t, 15, 10, 45, 51, ink);
  clearRect(t, 15, 10, 18, 13);
  clearRect(t, 43, 11, 45, 16);
  clearRect(t, 16, 48, 19, 51);
  rect(t, 15, 10, 20, 51, ink, seed + 622, 108);
  for (let y = 24; y <= 42; y += 5) rect(t, 23, y, 39 - ((seed + y) & 3), y + 1, ink, 0, 135);
  rect(t, 27, 29, 38, 39, blue, seed + 623, 210);
  clearRect(t, 30, 32, 35, 36);
  outlineRect(t, 27, 29, 38, 39, ink);
  rect(t, 35, 20, 44, 24, red, seed + 624, 188);
  rect(t, 31, 45, 43, 48, red, seed + 625, 170);
  rect(t, 25, 18, 51, 52, [222, 206, 148], seed + 626, 246);
  rect(t, 28, 20, 48, 25, [232, 216, 160], seed + 627, 228);
  for (let y = 28; y <= 46; y += 5) rect(t, 29, y, 48 - ((seed + y) & 3), y + 1, ink, 0, 145);
  rect(t, 15, 10, 24, 51, ink, seed + 628, 170);
  rect(t, 17, 13, 22, 47, cover, seed + 629, 210);
  rect(t, 36, 20, 46, 25, red, seed + 630, 208);
  drawNoiseDust(t, seed + 626, rust, 13);
}

function drawHolyWaterSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [160, 214, 218];
  const water: [number, number, number] = [58, 160, 192];
  const waterLight: [number, number, number] = [154, 236, 226];
  const cork: [number, number, number] = [132, 82, 42];
  const paper: [number, number, number] = [222, 206, 150];
  const red: [number, number, number] = [176, 38, 42];
  const ink: [number, number, number] = [24, 22, 20];
  const glow: [number, number, number] = [128, 220, 230];

  ellipse(t, 33, 34, 18, 23, glow, seed + 627, 42);
  rect(t, 27, 11, 39, 20, glass, seed + 628, 210);
  rect(t, 29, 8, 37, 13, cork, seed + 629, 230);
  rect(t, 22, 19, 45, 52, glass, seed + 630, 226);
  ellipse(t, 33.5, 19, 11.5, 5.0, glass, seed + 631, 220);
  ellipse(t, 33.5, 52, 11.5, 5.0, water, seed + 632, 232);
  rect(t, 24, 31, 43, 51, water, seed + 633, 218);
  rect(t, 27, 24, 40, 34, paper, seed + 634, 236);
  rect(t, 32, 25, 35, 33, red, seed + 635, 240);
  rect(t, 29, 28, 38, 31, red, seed + 636, 240);
  rect(t, 26, 22, 29, 48, waterLight, seed + 637, 112);
  outlineRect(t, 22, 19, 45, 52, ink);
  clearRect(t, 22, 19, 25, 22);
  clearRect(t, 43, 20, 45, 25);
  drawNoiseDust(t, seed + 638, waterLight, 10);
}

function drawHomemadePistolSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [24, 28, 28];
  const metal: [number, number, number] = [80, 88, 82];
  const steel: [number, number, number] = [142, 146, 132];
  const wood: [number, number, number] = [116, 64, 34];
  const tape: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [128, 64, 32];

  line(t, 13, 31, 49, 22, 5.2, dark, seed + 639, 252);
  line(t, 16, 30, 47, 23, 3.1, metal, seed + 640, 246);
  rect(t, 19, 29, 43, 37, dark, seed + 641, 248);
  rect(t, 22, 30, 40, 34, metal, seed + 642, 235);
  rect(t, 46, 21, 54, 25, steel, seed + 643, 232);
  rect(t, 18, 36, 26, 43, dark, seed + 644, 242);
  line(t, 25, 38, 34, 52, 5.8, dark, seed + 645, 245);
  line(t, 27, 39, 34, 51, 3.8, wood, seed + 646, 242);
  rect(t, 28, 42, 35, 46, tape, seed + 647, 220);
  line(t, 23, 35, 31, 36, 1.0, steel, seed + 648, 190);
  ellipse(t, 46, 29, 3.5, 4.8, dark, seed + 649, 220);
  drawNoiseDust(t, seed + 650, rust, 12);
}

function drawHomemade9mmSprite(t: Uint32Array, seed: number): void {
  const brass: [number, number, number] = [166, 118, 46];
  const brassLight: [number, number, number] = [216, 166, 66];
  const lead: [number, number, number] = [76, 78, 72];
  const black: [number, number, number] = [26, 24, 20];
  const red: [number, number, number] = [158, 38, 34];
  const paper: [number, number, number] = [180, 154, 92];
  const rust: [number, number, number] = [118, 58, 30];

  rect(t, 19, 36, 49, 48, black, seed + 651, 200);
  rect(t, 20, 30, 48, 45, paper, seed + 652, 210);
  for (let i = 0; i < 7; i++) {
    const x = 16 + i * 5;
    const y = 20 + ((seed + i) & 5);
    rect(t, x, y + 6, x + 4, 44, brass, seed + 653 + i, 238);
    rect(t, x, y + 3, x + 4, y + 9, lead, seed + 660 + i, 232);
    rect(t, x + 1, y + 10, x + 3, 41, brassLight, seed + 667 + i, 180);
    rect(t, x, 41, x + 4, 45, black, seed + 674 + i, 205);
  }
  rect(t, 16, 24, 50, 29, brass, seed + 680, 220);
  rect(t, 20, 30, 49, 33, red, seed + 681, 212);
  rect(t, 24, 45, 43, 47, red, seed + 682, 160);
  drawNoiseDust(t, seed + 683, rust, 10);
}

function drawHomemadeAmmoInstructionSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 178, 100];
  const light: [number, number, number] = [232, 210, 132];
  const ink: [number, number, number] = [24, 22, 18];
  const soot: [number, number, number] = [42, 40, 34];
  const red: [number, number, number] = [170, 36, 34];
  const brass: [number, number, number] = [196, 142, 54];
  const processGreen: [number, number, number] = [64, 132, 88];
  const damp: [number, number, number] = [78, 90, 82];

  rect(t, 15, 12, 50, 53, paper, seed + 684, 248);
  rect(t, 18, 15, 47, 20, light, seed + 685, 220);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 18, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 19, 53);
  rect(t, 15, 44, 50, 53, damp, seed + 686, 96);
  rect(t, 21, 24, 42, 25, ink, 0, 170);
  for (let y = 29; y <= 45; y += 3) rect(t, 20, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 158);
  rect(t, 28, 27, 39, 45, brass, seed + 687, 226);
  rect(t, 31, 24, 36, 30, soot, seed + 688, 230);
  rect(t, 22, 35, 47, 38, brass, seed + 689, 210);
  rect(t, 22, 39, 45, 42, soot, seed + 690, 186);
  rect(t, 23, 42, 44, 48, processGreen, seed + 691, 214);
  rect(t, 46, 43, 49, 44, ink, 0, 132);
  line(t, 24, 43, 42, 47, 0.8, ink, seed + 692, 140);
  line(t, 25, 45, 43, 27, 0.9, red, seed + 693, 185);
  ellipse(t, 41, 37, 7.6, 5.2, red, seed + 694, 214);
  ellipse(t, 41, 37, 4.2, 2.6, paper, seed + 695, 224);
  drawNoiseDust(t, seed + 696, soot, 14);
}

function drawHermeticTapeSprite(t: Uint32Array, seed: number): void {
  const tapeDark: [number, number, number] = [28, 34, 34];
  const tape: [number, number, number] = [72, 92, 88];
  const tapeLight: [number, number, number] = [128, 150, 138];
  const pale: [number, number, number] = [204, 190, 134];
  const sealGreen: [number, number, number] = [76, 134, 98];
  const glue: [number, number, number] = [184, 166, 108];
  const red: [number, number, number] = [174, 40, 36];
  const rust: [number, number, number] = [118, 60, 34];

  ellipse(t, 30, 34, 16.5, 14.5, tapeDark, seed + 693, 250);
  ellipse(t, 30, 34, 11.0, 9.4, tape, seed + 694, 246);
  ellipse(t, 30, 34, 5.2, 4.5, [6, 8, 8], 0, 0);
  rect(t, 33, 29, 54, 39, tape, seed + 695, 236);
  rect(t, 34, 31, 53, 34, tapeLight, seed + 696, 176);
  rect(t, 35, 30, 53, 35, pale, seed + 701, 220);
  rect(t, 45, 35, 55, 39, glue, seed + 697, 200);
  rect(t, 34, 36, 48, 41, sealGreen, seed + 702, 196);
  rect(t, 39, 27, 48, 30, red, seed + 698, 210);
  line(t, 22, 48, 51, 33, 0.9, rust, seed + 699, 120);
  drawNoiseDust(t, seed + 700, rust, 9);
}

function drawHermoGasketSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [28, 32, 30];
  const rubberLight: [number, number, number] = [78, 88, 78];
  const chalk: [number, number, number] = [202, 190, 128];
  const red: [number, number, number] = [174, 38, 34];
  const rust: [number, number, number] = [118, 60, 34];

  ellipse(t, 33, 34, 21.5, 18.5, rubber, seed + 701, 250);
  ellipse(t, 33, 34, 14, 11, rubberLight, seed + 702, 242);
  ellipse(t, 33, 34, 8, 6.5, [6, 8, 7], 0, 0);
  rect(t, 20, 19, 44, 24, rubber, seed + 703, 230);
  rect(t, 22, 20, 40, 23, chalk, seed + 704, 190);
  rect(t, 25, 45, 42, 47, chalk, seed + 705, 170);
  rect(t, 39, 22, 54, 33, red, seed + 706, 224);
  rect(t, 43, 25, 51, 29, chalk, seed + 707, 160);
  line(t, 19, 46, 47, 22, 0.9, rust, seed + 708, 128);
  drawNoiseDust(t, seed + 709, chalk, 8);
}

function drawIdolChernobogSprite(t: Uint32Array, seed: number): void {
  const stone: [number, number, number] = [26, 26, 30];
  const stoneLight: [number, number, number] = [64, 64, 70];
  const red: [number, number, number] = [184, 28, 34];
  const ash: [number, number, number] = [118, 110, 92];
  const cyan: [number, number, number] = [68, 168, 176];
  const violet: [number, number, number] = [104, 72, 148];

  ellipse(t, 32, 52, 18, 5, [8, 8, 8], seed + 708, 115);
  rect(t, 25, 23, 40, 51, stone, seed + 709, 250);
  rect(t, 29, 14, 36, 25, stone, seed + 710, 250);
  line(t, 25, 25, 18, 16, 3.2, stone, seed + 711, 245);
  line(t, 40, 25, 47, 16, 3.2, stone, seed + 712, 245);
  line(t, 27, 49, 22, 57, 3.2, stone, seed + 713, 235);
  line(t, 38, 49, 43, 57, 3.2, stone, seed + 714, 235);
  rect(t, 27, 28, 38, 31, stoneLight, seed + 715, 150);
  ellipse(t, 30, 21, 3.6, 2.8, red, seed + 716, 235);
  ellipse(t, 36, 21, 3.6, 2.8, red, seed + 717, 235);
  rect(t, 25, 36, 40, 39, red, seed + 718, 168);
  rect(t, 31, 34, 35, 43, cyan, seed + 719, 118);
  rect(t, 28, 31, 39, 35, violet, seed + 720, 205);
  rect(t, 30, 40, 39, 44, violet, seed + 721, 185);
  line(t, 27, 31, 39, 45, 1.4, violet, seed + 722, 210);
  line(t, 38, 30, 27, 44, 1.1, violet, seed + 723, 188);
  line(t, 23, 53, 43, 28, 0.9, ash, seed + 724, 90);
  drawNoiseDust(t, seed + 725, ash, 12);
  line(t, 30, 34, 36, 43, 1.0, cyan, seed + 726, 172);
  rect(t, 31, 36, 35, 42, cyan, seed + 727, 150);
}

function drawImportToiletpaperSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [224, 220, 198];
  const paperLight: [number, number, number] = [248, 246, 226];
  const shadow: [number, number, number] = [118, 120, 110];
  const blue: [number, number, number] = [54, 114, 176];
  const red: [number, number, number] = [184, 40, 36];
  const ink: [number, number, number] = [24, 24, 22];
  const damp: [number, number, number] = [86, 96, 88];

  ellipse(t, 31, 34, 17, 16, paper, seed + 721, 246);
  ellipse(t, 31, 34, 10, 9, paperLight, seed + 722, 238);
  ellipse(t, 31, 34, 5.2, 4.5, shadow, seed + 723, 230);
  ellipse(t, 31, 34, 2.8, 2.3, [0, 0, 0], 0, 0);
  rect(t, 28, 20, 49, 46, paper, seed + 724, 235);
  rect(t, 31, 23, 51, 31, blue, seed + 725, 215);
  rect(t, 33, 34, 50, 40, red, seed + 726, 210);
  for (let x = 36; x <= 47; x += 3) rect(t, x, 24, x + 1, 30, ink, 0, 190);
  rect(t, 36, 36, 47, 37, paperLight, seed + 727, 230);
  line(t, 22, 48, 48, 26, 0.8, damp, seed + 728, 110);
  drawNoiseDust(t, seed + 729, shadow, 8);
}

function drawToiletpaperSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [168, 166, 148];
  const light: [number, number, number] = [214, 208, 184];
  const core: [number, number, number] = [84, 76, 58];
  const damp: [number, number, number] = [70, 94, 78];
  const twine: [number, number, number] = [112, 82, 44];
  const red: [number, number, number] = [154, 42, 34];
  const ink: [number, number, number] = [22, 22, 18];

  ellipse(t, 30, 35, 17, 16, paper, seed + 730, 246);
  ellipse(t, 30, 35, 10, 9, light, seed + 731, 220);
  ellipse(t, 30, 35, 5.3, 4.5, core, seed + 732, 230);
  ellipse(t, 30, 35, 2.5, 2.1, [0, 0, 0], 0, 0);
  rect(t, 28, 21, 46, 48, paper, seed + 733, 226);
  rect(t, 31, 22, 43, 31, light, seed + 734, 150);
  line(t, 18, 43, 45, 24, 0.8, damp, seed + 735, 116);
  line(t, 21, 27, 43, 45, 0.8, twine, seed + 736, 130);
  rect(t, 37, 37, 47, 42, damp, seed + 737, 150);
  rect(t, 39, 38, 45, 39, red, seed + 738, 170);
  for (let x = 33; x <= 42; x += 3) rect(t, x, 25, x + 1, 30, ink, 0, 90);
  drawNoiseDust(t, seed + 739, core, 13);
}

function drawPassportStubSprite(t: Uint32Array, seed: number): void {
  const cover: [number, number, number] = [72, 34, 38];
  const coverLight: [number, number, number] = [128, 54, 50];
  const paper: [number, number, number] = [206, 190, 126];
  const paperLight: [number, number, number] = [232, 216, 148];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [178, 36, 34];
  const damp: [number, number, number] = [76, 88, 82];
  const rust: [number, number, number] = [116, 58, 34];

  rect(t, 19, 14, 47, 53, cover, seed + 1146, 248);
  rect(t, 22, 17, 44, 50, coverLight, seed + 1147, 145);
  outlineRect(t, 19, 14, 47, 53, ink);
  clearRect(t, 41, 14, 47, 22);
  clearRect(t, 38, 22, 47, 34);
  clearRect(t, 35, 34, 47, 53);
  rect(t, 17, 24, 43, 50, paper, seed + 1148, 246);
  rect(t, 20, 27, 40, 31, paperLight, seed + 1149, 214);
  outlineRect(t, 17, 24, 43, 50, ink);
  clearRect(t, 17, 24, 20, 27);
  clearRect(t, 40, 24, 43, 30);
  clearRect(t, 17, 47, 20, 50);
  rect(t, 17, 44, 43, 50, damp, seed + 1150, 100);
  for (let y = 33; y <= 43; y += 4) rect(t, 22, y, 38 - ((seed + y) & 3), y + 1, ink, 0, 145);
  rect(t, 23, 34, 31, 42, [132, 122, 96], seed + 1151, 170);
  rect(t, 24, 35, 30, 37, paperLight, seed + 1152, 135);
  ellipse(t, 36, 38, 6.4, 5, red, seed + 1153, 212);
  ellipse(t, 36, 38, 3.7, 2.4, paper, seed + 1154, 220);
  rect(t, 30, 46, 39, 49, red, seed + 1155, 168);
  line(t, 20, 48, 42, 28, 0.8, rust, seed + 1156, 130);
  drawNoiseDust(t, seed + 1157, rust, 10);
}

function drawPermanentPassSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [88, 126, 82];
  const cardLight: [number, number, number] = [154, 178, 116];
  const paper: [number, number, number] = [216, 202, 144];
  const ink: [number, number, number] = [20, 22, 18];
  const red: [number, number, number] = [180, 38, 34];
  const brass: [number, number, number] = [194, 142, 56];
  const damp: [number, number, number] = [66, 84, 72];
  const rust: [number, number, number] = [120, 62, 36];

  rect(t, 12, 20, 52, 46, card, seed + 1158, 248);
  rect(t, 15, 22, 49, 27, cardLight, seed + 1159, 210);
  outlineRect(t, 12, 20, 52, 46, ink);
  clearRect(t, 12, 20, 16, 23);
  clearRect(t, 50, 20, 52, 25);
  clearRect(t, 13, 44, 17, 46);
  rect(t, 15, 39, 51, 46, damp, seed + 1160, 96);
  rect(t, 18, 26, 31, 42, paper, seed + 1161, 230);
  rect(t, 21, 28, 28, 34, [88, 78, 64], seed + 1162, 170);
  rect(t, 20, 36, 29, 38, ink, 0, 120);
  rect(t, 34, 27, 47, 28, ink, 0, 160);
  for (let y = 32; y <= 40; y += 4) rect(t, 34, y, 46 - ((seed + y) & 3), y + 1, ink, 0, 135);
  ellipse(t, 46, 34, 7.2, 5.2, red, seed + 1163, 218);
  ellipse(t, 46, 34, 4.0, 2.5, card, seed + 1164, 222);
  line(t, 40, 34, 52, 34, 0.8, red, seed + 1165, 232);
  rect(t, 31, 21, 38, 46, brass, seed + 1166, 135);
  rect(t, 36, 42, 50, 45, red, seed + 1167, 165);
  line(t, 15, 44, 50, 25, 0.8, rust, seed + 1168, 126);
  drawNoiseDust(t, seed + 1169, rust, 11);
}

function drawTempPassSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 174, 98];
  const light: [number, number, number] = [232, 208, 128];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [178, 34, 32];
  const damp: [number, number, number] = [78, 92, 86];
  const grey: [number, number, number] = [106, 112, 102];
  const rust: [number, number, number] = [124, 64, 34];

  rect(t, 13, 21, 52, 45, paper, seed + 1183, 248);
  rect(t, 16, 23, 49, 27, light, seed + 1184, 218);
  outlineRect(t, 13, 21, 52, 45, ink);
  clearRect(t, 13, 21, 17, 24);
  clearRect(t, 50, 22, 52, 27);
  clearRect(t, 14, 42, 17, 45);
  rect(t, 13, 39, 52, 45, damp, seed + 1185, 102);
  rect(t, 17, 28, 25, 40, grey, seed + 1186, 188);
  rect(t, 19, 30, 23, 34, light, seed + 1187, 120);
  rect(t, 28, 28, 44, 29, ink, 0, 160);
  for (let y = 32; y <= 39; y += 4) rect(t, 28, y, 45 - ((seed + y) & 5), y + 1, ink, 0, 132);
  line(t, 20, 42, 48, 24, 0.8, rust, seed + 1188, 125);
  ellipse(t, 43, 35, 7.0, 5.2, red, seed + 1189, 218);
  ellipse(t, 43, 35, 3.7, 2.5, paper, seed + 1190, 224);
  line(t, 37, 35, 49, 35, 0.8, red, seed + 1191, 232);
  rect(t, 31, 41, 43, 43, red, seed + 1192, 178);
  drawNoiseDust(t, seed + 1193, rust, 12);
}

function drawPersonalFileCopyDocumentSprite(t: Uint32Array, seed: number): void {
  const folder: [number, number, number] = [146, 118, 64];
  const folderLight: [number, number, number] = [206, 176, 96];
  const paper: [number, number, number] = [208, 196, 142];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [170, 38, 34];
  const portrait: [number, number, number] = [82, 84, 78];
  const damp: [number, number, number] = [76, 88, 76];
  const rust: [number, number, number] = [118, 64, 34];

  rect(t, 19, 11, 45, 49, paper, seed + 1170, 238);
  rect(t, 22, 14, 42, 19, folderLight, seed + 1171, 200);
  rect(t, 15, 22, 51, 53, folder, seed + 1172, 250);
  rect(t, 18, 20, 32, 27, folderLight, seed + 1173, 238);
  outlineRect(t, 15, 22, 51, 53, ink);
  clearRect(t, 15, 22, 18, 25);
  clearRect(t, 49, 23, 51, 28);
  clearRect(t, 16, 50, 19, 53);
  rect(t, 16, 47, 51, 53, damp, seed + 1174, 96);
  rect(t, 22, 31, 32, 43, portrait, seed + 1175, 220);
  ellipse(t, 27, 34, 3.8, 3.2, paper, seed + 1176, 155);
  rect(t, 24, 38, 30, 42, ink, seed + 1177, 90);
  for (let y = 31; y <= 44; y += 4) rect(t, 36, y, 48 - ((seed + y) & 5), y + 1, ink, 0, 132);
  rect(t, 36, 26, 47, 28, red, seed + 1178, 190);
  ellipse(t, 43, 38, 6.8, 4.8, red, seed + 1179, 190);
  ellipse(t, 43, 38, 3.8, 2.4, folder, seed + 1180, 200);
  line(t, 19, 49, 48, 27, 0.8, rust, seed + 1181, 130);
  drawNoiseDust(t, seed + 1182, rust, 12);
}

function drawLiquidatorFieldRosterSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 180, 112];
  const light: [number, number, number] = [230, 214, 146];
  const ink: [number, number, number] = [22, 22, 18];
  const red: [number, number, number] = [178, 38, 32];
  const route: [number, number, number] = [58, 122, 86];
  const damp: [number, number, number] = [78, 92, 86];
  const rust: [number, number, number] = [126, 64, 36];

  rect(t, 15, 10, 50, 54, paper, seed + 1190, 248);
  rect(t, 19, 13, 46, 18, light, seed + 1191, 222);
  outlineRect(t, 15, 10, 50, 54, ink);
  clearRect(t, 15, 10, 19, 13);
  clearRect(t, 48, 11, 50, 16);
  clearRect(t, 16, 51, 20, 54);
  rect(t, 15, 47, 50, 54, damp, seed + 1192, 105);
  rect(t, 15, 10, 19, 54, damp, seed + 1193, 98);
  line(t, 18, 14, 21, 51, 0.8, damp, seed + 1194, 150);

  rect(t, 23, 22, 40, 23, ink, 0, 176);
  rect(t, 42, 21, 47, 24, route, seed + 1195, 205);
  for (let y = 28; y <= 43; y += 5) {
    rect(t, 22, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 148);
    rect(t, 22, y + 2, 25, y + 3, route, seed + y, 158);
  }
  line(t, 27, 45, 43, 31, 1.2, route, seed + 1196, 208);
  line(t, 27, 45, 32, 37, 0.8, ink, seed + 1197, 135);
  ellipse(t, 40, 37, 7.8, 5.4, red, seed + 1198, 218);
  ellipse(t, 40, 37, 4.3, 2.6, paper, seed + 1199, 224);
  line(t, 34, 37, 46, 37, 0.8, red, seed + 1200, 230);
  rect(t, 31, 45, 39, 48, red, seed + 1201, 182);
  drawNoiseDust(t, seed + 1202, rust, 12);
}

function drawLiquidatorIssueCardSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [202, 184, 112];
  const light: [number, number, number] = [232, 214, 142];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [184, 38, 34];
  const issueBlue: [number, number, number] = [58, 86, 110];
  const damp: [number, number, number] = [84, 94, 86];
  const rust: [number, number, number] = [126, 64, 36];

  rect(t, 12, 20, 52, 47, card, seed + 1210, 248);
  rect(t, 15, 22, 49, 26, light, seed + 1211, 222);
  outlineRect(t, 12, 20, 52, 47, ink);
  clearRect(t, 12, 20, 16, 23);
  clearRect(t, 50, 20, 52, 24);
  clearRect(t, 13, 45, 16, 47);
  rect(t, 12, 40, 52, 47, damp, seed + 1212, 98);
  rect(t, 15, 26, 21, 42, red, seed + 1213, 220);
  ellipse(t, 18, 30, 2.8, 2.8, ink, seed + 1214, 210);
  ellipse(t, 18, 30, 1.2, 1.2, card, seed + 1215, 225);

  for (let y = 29; y <= 39; y += 5) {
    rect(t, 25, y, 45 - ((seed + y) & 4), y + 1, ink, 0, 155);
    rect(t, 46, y - 1, 49, y + 2, issueBlue, seed + y, 165);
  }
  rect(t, 25, 25, 38, 26, ink, 0, 160);
  rect(t, 39, 25, 47, 27, red, seed + 1216, 200);
  ellipse(t, 39, 37, 7.2, 5.1, red, seed + 1217, 218);
  ellipse(t, 39, 37, 3.8, 2.4, card, seed + 1218, 224);
  line(t, 33, 37, 45, 37, 0.8, red, seed + 1219, 232);
  line(t, 24, 43, 48, 24, 0.8, ink, seed + 1220, 94);
  drawNoiseDust(t, seed + 1221, rust, 10);
}

function drawMailInterceptSlipSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 184, 104];
  const light: [number, number, number] = [236, 214, 136];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [176, 36, 34];
  const postalBlue: [number, number, number] = [54, 94, 126];
  const damp: [number, number, number] = [78, 92, 84];
  const rust: [number, number, number] = [124, 64, 34];

  rect(t, 15, 14, 50, 51, paper, seed + 1222, 248);
  rect(t, 18, 17, 47, 22, light, seed + 1223, 224);
  outlineRect(t, 15, 14, 50, 51, ink);
  clearRect(t, 15, 14, 18, 17);
  clearRect(t, 48, 15, 50, 20);
  clearRect(t, 16, 48, 19, 51);
  rect(t, 15, 44, 50, 51, damp, seed + 1224, 96);
  rect(t, 15, 14, 19, 50, damp, seed + 1225, 86);
  for (let y = 26; y <= 42; y += 5) rect(t, 22, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 150);
  rect(t, 24, 20, 38, 21, ink, 0, 160);
  line(t, 21, 36, 36, 28, 1.1, postalBlue, seed + 1226, 210);
  line(t, 36, 28, 44, 33, 1.1, postalBlue, seed + 1227, 210);
  rect(t, 39, 29, 45, 35, postalBlue, seed + 1228, 90);
  ellipse(t, 39, 36, 8.2, 5.8, red, seed + 1229, 220);
  ellipse(t, 39, 36, 4.7, 2.9, paper, seed + 1230, 224);
  line(t, 33, 36, 45, 36, 0.8, red, seed + 1231, 232);
  rect(t, 28, 45, 41, 48, red, seed + 1232, 178);
  line(t, 18, 18, 49, 49, 0.8, damp, seed + 1233, 96);
  drawNoiseDust(t, seed + 1234, rust, 11);
  drawNoiseDust(t, seed + 1235, postalBlue, 7);
}

function drawPneumomailCapsuleSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [22, 18, 14];
  const brass: [number, number, number] = [164, 118, 48];
  const brassLight: [number, number, number] = [230, 182, 78];
  const paper: [number, number, number] = [214, 196, 126];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [178, 34, 30];
  const damp: [number, number, number] = [72, 86, 78];
  const rust: [number, number, number] = [120, 62, 34];

  ellipse(t, 33, 53, 17, 4, [8, 8, 7], seed + 2236, 80);
  line(t, 12, 40, 53, 27, 8.2, dark, seed + 2237, 242);
  line(t, 14, 39, 51, 28, 5.8, brass, seed + 2238, 252);
  line(t, 16, 36, 48, 27, 1.1, brassLight, seed + 2239, 210);
  ellipse(t, 13, 40, 6.2, 4.8, dark, seed + 2240, 244);
  ellipse(t, 15, 39, 3.8, 2.8, brassLight, seed + 2241, 215);
  ellipse(t, 52, 27, 5.8, 4.2, dark, seed + 2242, 242);
  ellipse(t, 51, 28, 3.3, 2.3, brassLight, seed + 2243, 205);
  rect(t, 25, 32, 42, 38, paper, seed + 2244, 238);
  outlineRect(t, 25, 32, 42, 38, ink);
  rect(t, 28, 34, 38, 35, ink, 0, 145);
  rect(t, 29, 37, 39, 38, damp, seed + 2245, 105);
  ellipse(t, 41, 31, 6.8, 5.2, red, seed + 2246, 220);
  ellipse(t, 41, 31, 3.4, 2.4, brass, seed + 2247, 205);
  line(t, 36, 31, 47, 31, 0.8, red, seed + 2248, 230);
  line(t, 19, 39, 48, 29, 0.9, rust, seed + 2249, 132);
  rect(t, 17, 42, 25, 45, rust, seed + 2250, 155);
  drawNoiseDust(t, seed + 2251, rust, 10);
}

function drawScrubbedWeaponTagSprite(t: Uint32Array, seed: number): void {
  const tag: [number, number, number] = [182, 172, 132];
  const tagLight: [number, number, number] = [222, 210, 160];
  const metal: [number, number, number] = [122, 128, 120];
  const dark: [number, number, number] = [28, 30, 28];
  const red: [number, number, number] = [174, 34, 32];
  const rust: [number, number, number] = [132, 68, 36];
  const string: [number, number, number] = [112, 96, 70];

  line(t, 22, 13, 31, 22, 1.2, string, seed + 2400, 205);
  line(t, 31, 22, 45, 14, 1.0, string, seed + 2401, 190);
  rect(t, 16, 22, 49, 48, tag, seed + 2402, 246);
  rect(t, 19, 25, 46, 30, tagLight, seed + 2403, 212);
  outlineRect(t, 16, 22, 49, 48, dark);
  clearRect(t, 16, 22, 20, 25);
  clearRect(t, 47, 23, 49, 28);
  clearRect(t, 17, 45, 21, 48);
  ellipse(t, 24, 28, 3.4, 3.4, dark, seed + 2404, 225);
  ellipse(t, 24, 28, 1.5, 1.5, [0, 0, 0], 0, 0);

  rect(t, 27, 31, 43, 38, metal, seed + 2405, 226);
  line(t, 28, 33, 43, 31, 1.0, tagLight, seed + 2406, 175);
  line(t, 29, 36, 43, 34, 1.0, dark, seed + 2407, 145);
  for (let y = 32; y <= 43; y += 4) rect(t, 21, y, 37 - ((seed + y) & 5), y + 1, dark, 0, 125);
  line(t, 20, 45, 47, 27, 1.0, red, seed + 2408, 170);
  ellipse(t, 41, 39, 7, 4.8, red, seed + 2409, 210);
  ellipse(t, 41, 39, 3.8, 2.3, tag, seed + 2410, 220);
  rect(t, 29, 45, 42, 47, red, seed + 2411, 175);
  drawNoiseDust(t, seed + 2412, rust, 12);
}

function drawLaborShiftCardSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [202, 178, 96];
  const light: [number, number, number] = [236, 212, 126];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [178, 36, 32];
  const production: [number, number, number] = [72, 118, 88];
  const metal: [number, number, number] = [104, 116, 108];
  const damp: [number, number, number] = [74, 88, 80];
  const rust: [number, number, number] = [124, 64, 34];

  rect(t, 12, 20, 53, 47, card, seed + 1236, 248);
  rect(t, 15, 22, 50, 26, light, seed + 1237, 222);
  outlineRect(t, 12, 20, 53, 47, ink);
  clearRect(t, 12, 20, 16, 23);
  clearRect(t, 51, 20, 53, 25);
  clearRect(t, 13, 45, 16, 47);
  rect(t, 12, 40, 53, 47, damp, seed + 1238, 100);
  rect(t, 16, 28, 24, 43, production, seed + 1239, 218);
  rect(t, 18, 30, 22, 34, metal, seed + 1240, 210);
  rect(t, 18, 37, 22, 40, light, seed + 1241, 185);
  for (let y = 29; y <= 39; y += 4) {
    rect(t, 28, y, 47 - ((seed + y) & 5), y + 1, ink, 0, 150);
  }
  rect(t, 34, 23, 43, 25, red, seed + 1242, 205);
  ellipse(t, 43, 35, 7.6, 5.2, red, seed + 1243, 218);
  ellipse(t, 43, 35, 4.1, 2.5, card, seed + 1244, 224);
  line(t, 37, 35, 49, 35, 0.8, red, seed + 1245, 234);
  rect(t, 29, 43, 43, 45, red, seed + 1246, 170);
  line(t, 18, 45, 50, 25, 0.8, rust, seed + 1247, 125);
  drawNoiseDust(t, seed + 1248, rust, 12);
  drawNoiseDust(t, seed + 1249, production, 8);
}

function drawShelterSeatCardSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [208, 188, 102];
  const light: [number, number, number] = [238, 218, 138];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [180, 34, 32];
  const damp: [number, number, number] = [78, 94, 88];
  const blue: [number, number, number] = [74, 118, 166];
  const violet: [number, number, number] = [110, 78, 150];
  const rust: [number, number, number] = [122, 62, 34];

  ellipse(t, 34, 34, 22, 14, violet, seed + 1300, 30);
  rect(t, 12, 18, 53, 47, paper, seed + 1301, 248);
  rect(t, 15, 21, 50, 25, light, seed + 1302, 222);
  outlineRect(t, 12, 18, 53, 47, ink);
  clearRect(t, 12, 18, 16, 21);
  clearRect(t, 51, 18, 53, 23);
  clearRect(t, 13, 44, 17, 47);
  rect(t, 12, 40, 53, 47, damp, seed + 1303, 104);
  line(t, 16, 19, 18, 45, 0.8, damp, seed + 1304, 160);
  rect(t, 19, 28, 28, 40, blue, seed + 1305, 212);
  rect(t, 21, 30, 26, 34, light, seed + 1306, 160);
  rect(t, 21, 36, 26, 38, ink, 0, 110);
  for (let y = 28; y <= 38; y += 4) rect(t, 31, y, 46 - ((seed + y) & 5), y + 1, ink, 0, 150);
  rect(t, 35, 22, 48, 24, red, seed + 1307, 205);
  ellipse(t, 43, 35, 7.6, 5.2, red, seed + 1308, 218);
  ellipse(t, 43, 35, 4.0, 2.5, paper, seed + 1309, 224);
  line(t, 37, 35, 49, 35, 0.8, red, seed + 1310, 235);
  rect(t, 29, 42, 43, 45, red, seed + 1311, 176);
  drawNoiseDust(t, seed + 1312, rust, 10);
  drawNoiseDust(t, seed + 1313, violet, 8);
}

function drawShelterSeatForgerySprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 96];
  const light: [number, number, number] = [230, 208, 128];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [184, 32, 30];
  const damp: [number, number, number] = [80, 92, 86];
  const violet: [number, number, number] = [114, 80, 150];
  const rust: [number, number, number] = [126, 58, 34];

  rect(t, 15, 16, 51, 50, paper, seed + 1320, 248);
  rect(t, 18, 19, 47, 23, light, seed + 1321, 216);
  outlineRect(t, 15, 16, 51, 50, ink);
  clearRect(t, 15, 16, 19, 19);
  clearRect(t, 49, 17, 51, 23);
  clearRect(t, 16, 47, 20, 50);
  rect(t, 15, 43, 51, 50, damp, seed + 1322, 104);
  line(t, 17, 18, 50, 48, 0.9, damp, seed + 1323, 96);
  ellipse(t, 34, 36, 13.5, 8.0, violet, seed + 1324, 118);
  rect(t, 25, 34, 48, 41, violet, seed + 1325, 132);
  line(t, 20, 44, 46, 24, 1.2, violet, seed + 1324, 158);
  line(t, 22, 27, 47, 45, 0.9, red, seed + 1325, 154);
  for (let y = 27; y <= 39; y += 4) {
    rect(t, 22, y, 42 - ((seed + y) & 7), y + 1, ink, 0, 142);
    rect(t, 44, y, 47, y + 1, red, 0, 132);
  }
  rect(t, 37, 22, 47, 25, red, seed + 1326, 210);
  ellipse(t, 39, 36, 8.0, 5.6, red, seed + 1327, 222);
  ellipse(t, 39, 36, 4.1, 2.6, paper, seed + 1328, 224);
  rect(t, 30, 45, 40, 48, red, seed + 1329, 178);
  drawNoiseDust(t, seed + 1330, rust, 13);
  drawNoiseDust(t, seed + 1331, violet, 10);
}

function drawShelterTallySprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 186, 112];
  const light: [number, number, number] = [236, 218, 146];
  const ink: [number, number, number] = [22, 20, 18];
  const red: [number, number, number] = [176, 36, 34];
  const damp: [number, number, number] = [78, 94, 88];
  const green: [number, number, number] = [66, 126, 86];
  const violet: [number, number, number] = [112, 80, 144];
  const rust: [number, number, number] = [122, 64, 36];

  rect(t, 15, 9, 50, 55, paper, seed + 1340, 248);
  rect(t, 18, 12, 47, 17, light, seed + 1341, 220);
  outlineRect(t, 15, 9, 50, 55, ink);
  clearRect(t, 15, 9, 19, 12);
  clearRect(t, 48, 10, 50, 15);
  clearRect(t, 16, 52, 20, 55);
  rect(t, 15, 47, 50, 55, damp, seed + 1342, 105);
  rect(t, 15, 9, 19, 55, damp, seed + 1343, 90);
  for (let y = 21; y <= 43; y += 4) {
    rect(t, 22, y, 41 - ((seed + y) & 3), y + 1, ink, 0, 135);
    rect(t, 43, y, 46, y + 1, (y & 8) === 0 ? green : red, seed + y, 160);
  }
  line(t, 22, 24, 46, 24, 0.8, ink, seed + 1344, 120);
  line(t, 22, 36, 45, 37, 0.8, violet, seed + 1345, 122);
  ellipse(t, 39, 34, 7.6, 5.2, red, seed + 1346, 215);
  ellipse(t, 39, 34, 4.0, 2.5, paper, seed + 1347, 222);
  rect(t, 29, 45, 42, 48, red, seed + 1348, 178);
  drawNoiseDust(t, seed + 1349, rust, 12);
  drawNoiseDust(t, seed + 1350, violet, 7);
  rect(t, 42, 21, 47, 22, green, seed + 1351, 170);
  rect(t, 42, 33, 47, 34, green, seed + 1352, 170);
  line(t, 42, 42, 47, 39, 0.8, green, seed + 1353, 170);
}

function drawResidentIdentityStubSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 194, 120];
  const light: [number, number, number] = [238, 220, 146];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [178, 36, 34];
  const green: [number, number, number] = [72, 116, 82];
  const damp: [number, number, number] = [78, 92, 84];
  const rust: [number, number, number] = [124, 64, 36];

  rect(t, 13, 22, 52, 46, paper, seed + 1250, 248);
  rect(t, 16, 24, 49, 28, light, seed + 1251, 220);
  outlineRect(t, 13, 22, 52, 46, ink);
  clearRect(t, 13, 22, 17, 25);
  clearRect(t, 50, 23, 52, 28);
  clearRect(t, 14, 43, 17, 46);
  rect(t, 13, 39, 52, 46, damp, seed + 1252, 96);
  line(t, 19, 23, 20, 45, 0.8, damp, seed + 1253, 160);

  rect(t, 18, 29, 30, 42, green, seed + 1254, 210);
  ellipse(t, 24, 33, 3.2, 3.0, paper, seed + 1255, 155);
  rect(t, 20, 37, 28, 40, ink, seed + 1256, 105);
  rect(t, 34, 29, 48, 30, ink, 0, 155);
  for (let y = 34; y <= 40; y += 3) rect(t, 34, y, 47 - ((seed + y) & 3), y + 1, ink, 0, 132);

  ellipse(t, 44, 36, 7.5, 5.2, red, seed + 1257, 220);
  ellipse(t, 44, 36, 4.1, 2.5, paper, seed + 1258, 224);
  line(t, 38, 36, 50, 36, 0.8, red, seed + 1259, 232);
  rect(t, 29, 43, 42, 45, red, seed + 1260, 168);
  line(t, 16, 44, 50, 25, 0.8, rust, seed + 1261, 122);
  drawNoiseDust(t, seed + 1262, rust, 10);
}

function drawSamosborAlarmScheduleSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 188, 126];
  const paperLight: [number, number, number] = [232, 220, 158];
  const ink: [number, number, number] = [28, 26, 22];
  const red: [number, number, number] = [178, 38, 38];
  const damp: [number, number, number] = [82, 94, 90];
  const blue: [number, number, number] = [74, 136, 190];
  const violet: [number, number, number] = [118, 72, 174];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 33, 53, 17, 4, [10, 10, 10], seed + 1250, 78);
  rect(t, 17, 10, 48, 53, paper, seed + 1251, 248);
  rect(t, 20, 14, 45, 19, paperLight, seed + 1252, 210);
  outlineRect(t, 17, 10, 48, 53, ink);
  clearRect(t, 17, 10, 20, 13);
  clearRect(t, 46, 11, 48, 16);
  rect(t, 17, 47, 48, 53, damp, seed + 1253, 92);
  for (let y = 23; y <= 43; y += 5) rect(t, 21, y, 44, y, ink, 0, 110);
  for (let x = 24; x <= 42; x += 6) rect(t, x, 21, x, 45, ink, 0, 72);
  line(t, 22, 41, 29, 33, 1.0, red, seed + 1254, 225);
  line(t, 29, 33, 36, 38, 1.0, red, seed + 1255, 225);
  line(t, 36, 38, 44, 25, 1.0, red, seed + 1256, 225);
  ellipse(t, 32, 16, 5.5, 4.2, red, seed + 1257, 224);
  rect(t, 28, 18, 36, 21, red, seed + 1258, 220);
  rect(t, 26, 22, 39, 23, ink, 0, 125);
  line(t, 26, 14, 23, 10, 0.7, blue, seed + 1259, 140);
  line(t, 38, 14, 43, 10, 0.7, violet, seed + 1260, 132);
  ellipse(t, 42, 28, 9, 12, blue, seed + 1261, 34);
  ellipse(t, 23, 39, 7, 9, violet, seed + 1262, 28);
  drawNoiseDust(t, seed + 1263, rust, 9);
  drawNoiseDust(t, seed + 1264, blue, 8);
  rect(t, 18, 16, 21, 46, paperLight, seed + 1265, 206);
  rect(t, 45, 17, 47, 45, paperLight, seed + 1266, 198);
}

function drawSampleChainFormSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 198, 140];
  const paperLight: [number, number, number] = [238, 226, 174];
  const ink: [number, number, number] = [30, 30, 26];
  const red: [number, number, number] = [170, 38, 38];
  const blue: [number, number, number] = [52, 94, 132];
  const damp: [number, number, number] = [82, 96, 90];
  const rust: [number, number, number] = [126, 68, 38];

  ellipse(t, 32, 53, 16, 4, [10, 10, 10], seed + 1265, 76);
  rect(t, 18, 9, 47, 53, paper, seed + 1266, 248);
  rect(t, 21, 13, 44, 18, paperLight, seed + 1267, 215);
  outlineRect(t, 18, 9, 47, 53, ink);
  clearRect(t, 18, 9, 21, 12);
  clearRect(t, 45, 10, 47, 15);
  rect(t, 20, 20, 45, 25, blue, seed + 1268, 190);
  rect(t, 22, 22, 39, 23, paperLight, 0, 135);
  for (let i = 0; i < 4; i++) {
    const y = 30 + i * 5;
    rect(t, 23, y - 2, 27, y + 2, paperLight, seed + 1269 + i, 220);
    outlineRect(t, 23, y - 2, 27, y + 2, ink);
    rect(t, 31, y - 1, 43 - (i & 1) * 3, y, ink, 0, 120);
    if (i > 0) line(t, 25, y - 7, 25, y - 3, 0.8, blue, seed + 1274 + i, 180);
  }
  line(t, 29, 31, 36, 39, 1.0, blue, seed + 1279, 165);
  line(t, 36, 39, 43, 35, 1.0, blue, seed + 1280, 155);
  rect(t, 34, 43, 45, 48, red, seed + 1281, 205);
  rect(t, 36, 45, 43, 46, paperLight, 0, 142);
  rect(t, 18, 47, 47, 53, damp, seed + 1282, 76);
  drawNoiseDust(t, seed + 1283, rust, 9);
}

function drawPushkinShotgunSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [10, 16, 18];
  const blueMetal: [number, number, number] = [34, 52, 62];
  const wornEdge: [number, number, number] = [120, 136, 136];
  const polymer: [number, number, number] = [38, 36, 32];
  const grip: [number, number, number] = [24, 28, 28];
  const warning: [number, number, number] = [214, 158, 48];
  const red: [number, number, number] = [184, 42, 36];
  const rust: [number, number, number] = [128, 66, 38];

  ellipse(t, 35, 53, 21, 4, [8, 9, 8], seed + 2500, 84);
  line(t, 11, 46, 31, 37, 6.2, blackMetal, seed + 2501, 248);
  line(t, 13, 45, 29, 38, 4.0, polymer, seed + 2502, 245);
  ellipse(t, 13, 46, 5.0, 5.4, polymer, seed + 2503, 232);
  line(t, 28, 38, 35, 50, 2.4, grip, seed + 2504, 235);
  rect(t, 30, 43, 38, 50, grip, seed + 2505, 232);
  line(t, 18, 40, 58, 22, 5.8, blackMetal, seed + 2506, 255);
  line(t, 21, 39, 56, 23, 3.5, blueMetal, seed + 2507, 252);
  line(t, 24, 36, 59, 20, 1.6, blackMetal, seed + 2508, 248);
  line(t, 27, 35, 57, 21, 0.9, wornEdge, seed + 2509, 218);
  line(t, 31, 41, 49, 32, 3.3, polymer, seed + 2510, 238);
  for (let i = 0; i < 4; i++) line(t, 33 + i * 4, 38 - i * 1.8, 39 + i * 4, 36 - i * 1.8, 0.7, blackMetal, seed + 2511 + i, 170);
  rect(t, 31, 31, 47, 39, blackMetal, seed + 2515, 248);
  rect(t, 34, 32, 45, 36, blueMetal, seed + 2516, 248);
  rect(t, 36, 33, 44, 34, warning, seed + 2517, 222);
  rect(t, 42, 29, 48, 32, red, seed + 2518, 210);
  rect(t, 38, 36, 47, 37, warning, seed + 2519, 220);
  rect(t, 45, 31, 51, 33, red, seed + 2520, 210);
  rect(t, 35, 35, 45, 37, warning, 0, 236);
  rect(t, 25, 42, 35, 45, red, 0, 208);
  rect(t, 35, 26, 45, 29, blackMetal, seed + 2519, 236);
  rect(t, 37, 25, 43, 26, wornEdge, seed + 2520, 180);
  ellipse(t, 58, 22, 4.2, 2.2, blackMetal, seed + 2521, 238);
  ellipse(t, 60, 21, 1.8, 1.1, wornEdge, seed + 2522, 188);
  line(t, 22, 42, 51, 28, 0.9, rust, seed + 2523, 132);
  rect(t, 24, 43, 32, 45, rust, seed + 2524, 148);
  drawNoiseDust(t, seed + 2525, rust, 10);
}

function drawQuarantineBreachNoticeSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 182, 104];
  const light: [number, number, number] = [236, 214, 136];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [184, 34, 34];
  const damp: [number, number, number] = [78, 94, 86];
  const rust: [number, number, number] = [124, 62, 36];

  rect(t, 15, 11, 50, 54, paper, seed + 2530, 248);
  rect(t, 18, 14, 47, 19, light, seed + 2531, 220);
  outlineRect(t, 15, 11, 50, 54, ink);
  clearRect(t, 15, 11, 19, 14);
  clearRect(t, 48, 12, 50, 17);
  clearRect(t, 16, 51, 20, 54);
  rect(t, 15, 45, 50, 54, damp, seed + 2532, 106);
  rect(t, 15, 11, 20, 54, red, seed + 2533, 190);
  line(t, 20, 15, 48, 49, 1.1, damp, seed + 2534, 88);
  line(t, 21, 48, 47, 22, 1.3, red, seed + 2535, 180);
  for (let y = 24; y <= 41; y += 5) rect(t, 24, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 154);
  rect(t, 25, 21, 39, 22, ink, 0, 165);
  ellipse(t, 40, 34, 8.6, 5.8, red, seed + 2536, 224);
  ellipse(t, 40, 34, 4.6, 2.8, paper, seed + 2537, 226);
  rect(t, 33, 33, 46, 35, red, seed + 2538, 232);
  rect(t, 29, 46, 42, 49, red, seed + 2539, 180);
  drawNoiseDust(t, seed + 2540, rust, 12);
  rect(t, 22, 24, 24, 43, light, seed + 2541, 205);
  rect(t, 26, 24, 27, 43, light, seed + 2542, 198);
  rect(t, 44, 20, 47, 43, light, seed + 2543, 196);
}

function drawQuarantineMedcardSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [214, 204, 160];
  const light: [number, number, number] = [238, 230, 184];
  const ink: [number, number, number] = [30, 28, 24];
  const red: [number, number, number] = [184, 38, 42];
  const green: [number, number, number] = [80, 142, 104];
  const glass: [number, number, number] = [126, 186, 164];
  const damp: [number, number, number] = [82, 96, 88];
  const rust: [number, number, number] = [120, 66, 38];

  rect(t, 12, 21, 52, 47, card, seed + 2545, 248);
  rect(t, 15, 23, 49, 27, light, seed + 2546, 224);
  outlineRect(t, 12, 21, 52, 47, ink);
  clearRect(t, 12, 21, 16, 24);
  clearRect(t, 50, 22, 52, 27);
  clearRect(t, 13, 44, 17, 47);
  rect(t, 12, 40, 52, 47, damp, seed + 2547, 92);
  rect(t, 12, 21, 17, 47, red, seed + 2548, 205);
  rect(t, 30, 26, 36, 40, red, seed + 2549, 238);
  rect(t, 24, 31, 42, 36, red, seed + 2550, 238);
  rect(t, 40, 24, 49, 30, green, seed + 2551, 205);
  rect(t, 42, 26, 47, 27, light, seed + 2552, 180);
  rect(t, 19, 38, 34, 41, glass, seed + 2553, 188);
  for (let y = 29; y <= 42; y += 5) rect(t, 21, y, 47 - ((seed + y) & 4), y + 1, ink, 0, 120);
  line(t, 17, 45, 49, 25, 0.8, rust, seed + 2554, 115);
  drawNoiseDust(t, seed + 2555, rust, 9);
  drawNoiseDust(t, seed + 2556, green, 8);
  rect(t, 18, 24, 28, 30, light, seed + 2557, 196);
  rect(t, 43, 31, 49, 39, light, seed + 2558, 188);
  rect(t, 18, 37, 28, 44, light, seed + 2559, 184);
  rect(t, 18, 31, 23, 36, light, seed + 2560, 188);
  rect(t, 29, 42, 49, 46, light, seed + 2561, 184);
  rect(t, 38, 40, 49, 41, light, seed + 2562, 184);
}

function drawRadioSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 18, 18];
  const bakelite: [number, number, number] = [34, 48, 48];
  const rubber: [number, number, number] = [20, 26, 26];
  const metal: [number, number, number] = [138, 146, 130];
  const cyan: [number, number, number] = [74, 214, 194];
  const yellow: [number, number, number] = [212, 158, 50];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 32, 53, 17, 4, [8, 10, 10], seed + 2560, 82);
  line(t, 25, 19, 18, 8, 1.4, metal, seed + 2561, 220);
  ellipse(t, 18, 8, 2.2, 1.8, metal, seed + 2562, 210);
  rect(t, 19, 18, 45, 50, dark, seed + 2563, 248);
  rect(t, 21, 20, 43, 48, bakelite, seed + 2564, 250);
  outlineRect(t, 19, 18, 45, 50, dark);
  clearRect(t, 19, 18, 22, 21);
  clearRect(t, 43, 19, 45, 24);
  clearRect(t, 20, 47, 24, 50);
  rect(t, 24, 24, 40, 31, metal, seed + 2565, 168);
  for (let y = 34; y <= 42; y += 3) for (let x = 25; x <= 39; x += 4) px(t, x, y, rgba(dark[0], dark[1], dark[2], 210));
  rect(t, 25, 45, 39, 47, rubber, seed + 2566, 210);
  rect(t, 35, 22, 42, 25, yellow, seed + 2567, 215);
  for (let x = 27; x <= 39; x += 4) px(t, x, 27, rgba(cyan[0], cyan[1], cyan[2], 225));
  line(t, 21, 22, 43, 48, 0.8, metal, seed + 2568, 94);
  rect(t, 40, 35, 49, 39, rust, seed + 2569, 145);
  drawNoiseDust(t, seed + 2570, rust, 9);
  drawNoiseDust(t, seed + 2571, cyan, 8);
  rect(t, 27, 27, 40, 28, cyan, seed + 2572, 205);
  rect(t, 36, 34, 39, 36, cyan, seed + 2573, 175);
}

function drawRadioHeadsetLiquidatorSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [8, 14, 16];
  const rubber: [number, number, number] = [24, 34, 34];
  const metal: [number, number, number] = [80, 100, 96];
  const cyan: [number, number, number] = [72, 226, 206];
  const red: [number, number, number] = [184, 42, 36];
  const yellow: [number, number, number] = [214, 164, 54];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 2575, 82);
  line(t, 20, 36, 24, 19, 2.5, dark, seed + 2576, 245);
  line(t, 24, 19, 41, 18, 2.3, metal, seed + 2577, 230);
  line(t, 41, 18, 47, 34, 2.5, dark, seed + 2578, 245);
  line(t, 22, 34, 28, 20, 1.1, cyan, seed + 2579, 175);
  line(t, 39, 20, 45, 34, 1.0, cyan, seed + 2580, 155);
  ellipse(t, 20, 38, 7, 9, rubber, seed + 2581, 248);
  ellipse(t, 46, 36, 7, 9, rubber, seed + 2582, 246);
  ellipse(t, 20, 38, 3.8, 5, metal, seed + 2583, 210);
  ellipse(t, 46, 36, 3.8, 5, metal, seed + 2584, 205);
  line(t, 45, 41, 56, 47, 1.5, metal, seed + 2585, 225);
  ellipse(t, 57, 48, 3.4, 2.2, cyan, seed + 2586, 222);
  line(t, 23, 46, 41, 50, 1.2, dark, seed + 2587, 195);
  rect(t, 25, 45, 39, 50, dark, seed + 2588, 218);
  rect(t, 27, 46, 37, 47, yellow, seed + 2589, 200);
  rect(t, 34, 43, 43, 46, red, seed + 2590, 185);
  ellipse(t, 33, 33, 18, 15, cyan, seed + 2591, 34);
  drawNoiseDust(t, seed + 2592, rust, 9);
  drawNoiseDust(t, seed + 2593, cyan, 14);
  rect(t, 27, 46, 37, 47, yellow, seed + 2594, 204);
  rect(t, 34, 43, 43, 46, red, seed + 2595, 188);
  rect(t, 51, 45, 58, 49, cyan, seed + 2596, 142);
  line(t, 23, 20, 44, 34, 0.8, cyan, seed + 2597, 120);
}

function drawRadioJammerSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 16, 18];
  const casing: [number, number, number] = [44, 58, 58];
  const metal: [number, number, number] = [132, 142, 128];
  const cyan: [number, number, number] = [70, 220, 198];
  const red: [number, number, number] = [192, 38, 34];
  const yellow: [number, number, number] = [218, 160, 48];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 32, 53, 14, 4, [8, 10, 10], seed + 2598, 80);
  line(t, 24, 22, 18, 9, 1.1, metal, seed + 2599, 220);
  line(t, 41, 22, 47, 10, 1.1, metal, seed + 2600, 220);
  rect(t, 20, 22, 45, 49, dark, seed + 2601, 248);
  rect(t, 22, 20, 43, 47, casing, seed + 2602, 250);
  outlineRect(t, 20, 22, 45, 49, dark);
  clearRect(t, 20, 22, 23, 25);
  clearRect(t, 43, 22, 45, 27);
  rect(t, 25, 26, 40, 31, red, seed + 2603, 228);
  rect(t, 27, 28, 38, 29, yellow, seed + 2604, 205);
  for (let y = 35; y <= 43; y += 4) {
    rect(t, 25, y, 39, y + 1, dark, 0, 165);
    px(t, 41, y, rgba(cyan[0], cyan[1], cyan[2], 225));
  }
  line(t, 13, 31, 19, 35, 0.9, cyan, seed + 2605, 160);
  line(t, 12, 37, 19, 38, 0.9, red, seed + 2606, 155);
  line(t, 47, 34, 55, 30, 0.9, cyan, seed + 2607, 165);
  line(t, 47, 40, 56, 42, 0.9, red, seed + 2608, 150);
  line(t, 23, 45, 44, 26, 0.8, metal, seed + 2609, 96);
  line(t, 21, 48, 45, 45, 0.9, rust, seed + 2610, 135);
  drawNoiseDust(t, seed + 2611, cyan, 10);
  drawNoiseDust(t, seed + 2612, rust, 8);
}

function drawRailDepotPassSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [198, 176, 96];
  const light: [number, number, number] = [232, 210, 130];
  const ink: [number, number, number] = [22, 20, 18];
  const red: [number, number, number] = [176, 36, 34];
  const rail: [number, number, number] = [72, 86, 86];
  const blue: [number, number, number] = [62, 112, 144];
  const damp: [number, number, number] = [78, 92, 84];
  const rust: [number, number, number] = [124, 66, 38];

  rect(t, 12, 20, 53, 47, card, seed + 2615, 248);
  rect(t, 15, 22, 50, 26, light, seed + 2616, 222);
  outlineRect(t, 12, 20, 53, 47, ink);
  clearRect(t, 12, 20, 16, 23);
  clearRect(t, 51, 20, 53, 25);
  clearRect(t, 13, 45, 16, 47);
  rect(t, 12, 41, 53, 47, damp, seed + 2617, 102);
  rect(t, 17, 27, 25, 43, blue, seed + 2618, 210);
  line(t, 19, 29, 23, 42, 0.8, light, seed + 2619, 175);
  line(t, 31, 28, 47, 42, 1.2, rail, seed + 2620, 210);
  line(t, 36, 27, 51, 40, 1.2, rail, seed + 2621, 210);
  for (let i = 0; i < 4; i++) line(t, 31 + i * 5, 31 + i * 3, 39 + i * 5, 28 + i * 3, 0.8, ink, seed + 2622 + i, 160);
  for (let y = 29; y <= 39; y += 4) rect(t, 27, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 126);
  ellipse(t, 43, 34, 7.8, 5.3, red, seed + 2626, 220);
  ellipse(t, 43, 34, 4.2, 2.6, card, seed + 2627, 224);
  rect(t, 37, 34, 49, 35, red, seed + 2628, 232);
  rect(t, 29, 43, 43, 45, red, seed + 2629, 176);
  line(t, 18, 45, 51, 24, 0.8, rust, seed + 2630, 120);
  drawNoiseDust(t, seed + 2631, rust, 11);
  drawNoiseDust(t, seed + 2632, blue, 7);
  rect(t, 27, 27, 49, 28, light, seed + 2638, 194);
  rect(t, 16, 31, 25, 32, light, seed + 2639, 184);
  rect(t, 26, 27, 29, 42, light, seed + 2633, 198);
  rect(t, 30, 38, 36, 43, light, seed + 2636, 190);
  rect(t, 37, 40, 42, 43, light, seed + 2637, 188);
  rect(t, 49, 27, 52, 39, light, seed + 2634, 190);
  rect(t, 18, 44, 28, 46, light, seed + 2635, 184);
}

function drawRailSignalLampSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 16, 18];
  const bakelite: [number, number, number] = [32, 48, 48];
  const casing: [number, number, number] = [172, 178, 160];
  const casingLight: [number, number, number] = [226, 226, 192];
  const red: [number, number, number] = [202, 38, 34];
  const redLight: [number, number, number] = [238, 78, 58];
  const cyan: [number, number, number] = [72, 224, 202];
  const brass: [number, number, number] = [190, 150, 64];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 53, 16, 4, [8, 10, 10], seed + 2635, 82);
  line(t, 19, 44, 13, 52, 2.6, dark, seed + 2636, 232);
  line(t, 44, 43, 52, 51, 2.6, dark, seed + 2637, 232);
  rect(t, 18, 18, 47, 47, dark, seed + 2638, 248);
  rect(t, 20, 16, 45, 45, casing, seed + 2639, 250);
  outlineRect(t, 18, 18, 47, 47, dark);
  clearRect(t, 18, 18, 21, 21);
  clearRect(t, 45, 18, 47, 23);
  rect(t, 24, 10, 41, 17, brass, seed + 2640, 230);
  rect(t, 26, 12, 39, 14, casingLight, seed + 2641, 160);
  ellipse(t, 33, 31, 12, 12, red, seed + 2642, 244);
  ellipse(t, 33, 31, 7, 7, redLight, seed + 2643, 180);
  ellipse(t, 33, 31, 15, 15, red, seed + 2644, 52);
  rect(t, 22, 40, 43, 43, bakelite, seed + 2645, 220);
  for (let x = 24; x <= 41; x += 5) px(t, x, 41, rgba(cyan[0], cyan[1], cyan[2], 225));
  rect(t, 39, 22, 47, 26, red, seed + 2646, 210);
  rect(t, 41, 23, 45, 24, casingLight, seed + 2647, 165);
  line(t, 21, 20, 45, 44, 0.8, casingLight, seed + 2648, 92);
  line(t, 20, 46, 47, 43, 0.9, rust, seed + 2649, 130);
  ellipse(t, 46, 33, 6, 8, cyan, seed + 2650, 88);
  drawNoiseDust(t, seed + 2651, rust, 10);
  drawNoiseDust(t, seed + 2652, cyan, 11);
  rect(t, 20, 22, 25, 39, casingLight, seed + 2653, 184);
  rect(t, 41, 27, 45, 39, casingLight, seed + 2654, 184);
  rect(t, 24, 16, 41, 20, casing, seed + 2655, 198);
  ellipse(t, 33, 31, 10, 10, red, seed + 2656, 224);
  ellipse(t, 33, 31, 5, 5, redLight, seed + 2657, 190);
  rect(t, 24, 41, 41, 42, cyan, seed + 2658, 155);
}

function drawUsedGasmaskFilterSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [176, 162, 112];
  const paperLight: [number, number, number] = [218, 204, 150];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 36, 34];
  const damp: [number, number, number] = [72, 92, 78];
  const rubber: [number, number, number] = [16, 22, 22];
  const metal: [number, number, number] = [78, 92, 84];
  const smog: [number, number, number] = [64, 100, 76];
  const rust: [number, number, number] = [128, 70, 40];

  rect(t, 13, 15, 52, 51, paper, seed + 3090, 242);
  rect(t, 16, 18, 49, 22, paperLight, seed + 3091, 218);
  outlineRect(t, 13, 15, 52, 51, ink);
  clearRect(t, 13, 15, 17, 18);
  clearRect(t, 50, 16, 52, 21);
  clearRect(t, 14, 48, 18, 51);
  rect(t, 13, 43, 52, 51, damp, seed + 3092, 100);
  for (let y = 25; y <= 40; y += 5) rect(t, 18, y, 34 - ((seed + y) & 4), y + 1, ink, 0, 135);
  ellipse(t, 39, 33, 11, 10, rubber, seed + 3093, 246);
  ellipse(t, 39, 33, 8, 7.5, metal, seed + 3094, 248);
  ellipse(t, 39, 33, 5, 4.6, rubber, seed + 3095, 245);
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    line(t, 39, 33, 39 + Math.cos(ang) * 7, 33 + Math.sin(ang) * 6, 0.7, ink, seed + 3096 + a, 160);
  }
  rect(t, 36, 45, 50, 48, red, seed + 3103, 210);
  rect(t, 38, 46, 48, 47, paperLight, seed + 3104, 160);
  ellipse(t, 44, 40, 7, 3, smog, seed + 3105, 118);
  line(t, 16, 48, 50, 22, 0.8, rust, seed + 3106, 120);
  drawNoiseDust(t, seed + 3107, rust, 10);
  drawNoiseDust(t, seed + 3108, smog, 9);
}

function drawSlimeAgeLabelSprite(t: Uint32Array, seed: number, defId: string): void {
  const paper: [number, number, number] = [198, 178, 116];
  const paperLight: [number, number, number] = [230, 212, 150];
  const ink: [number, number, number] = [24, 24, 20];
  const red: [number, number, number] = [174, 38, 34];
  const damp: [number, number, number] = [74, 84, 70];
  const rust: [number, number, number] = [126, 66, 38];
  const slime: [number, number, number] = defId.endsWith('_orange')
    ? [226, 104, 36]
    : defId.endsWith('_violet')
      ? [142, 76, 204]
      : [120, 78, 42];
  const slimeLight: [number, number, number] = defId.endsWith('_orange')
    ? [244, 158, 56]
    : defId.endsWith('_violet')
      ? [198, 118, 238]
      : [174, 118, 64];

  ellipse(t, 32, 53, 16, 4, [16, 12, 8], seed + 2680, 76);
  rect(t, 15, 15, 49, 51, paper, seed + 2681, 246);
  rect(t, 18, 12, 45, 21, paperLight, seed + 2682, 230);
  outlineRect(t, 15, 15, 49, 51, ink);
  clearRect(t, 15, 15, 19, 19);
  clearRect(t, 46, 15, 49, 23);
  clearRect(t, 16, 47, 21, 51);

  rect(t, 18, 43, 49, 51, damp, seed + 2683, 94);
  rect(t, 19, 20, 23, 44, slime, seed + 2684, 230);
  rect(t, 20, 21, 22, 42, slimeLight, seed + 2685, 154);
  for (let y = 24; y <= 40; y += 5) rect(t, 28, y, 44 - ((seed + y) & 5), y + 1, ink, 0, 135);
  rect(t, 27, 16, 43, 20, red, seed + 2686, 205);
  rect(t, 31, 17, 41, 18, paperLight, seed + 2687, 170);
  ellipse(t, 38, 39, 7, 5, red, seed + 2688, 178);
  ellipse(t, 39, 39, 3.2, 2.2, paper, seed + 2689, 170);
  ellipse(t, 42, 46, 8, 3, slime, seed + 2690, 135);
  line(t, 18, 49, 48, 18, 0.8, damp, seed + 2691, 118);
  drawNoiseDust(t, seed + 2692, rust, 11);
  drawNoiseDust(t, seed + 2693, slimeLight, 10);
}


function drawWeaponPermitForgedSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [192, 166, 92];
  const light: [number, number, number] = [226, 204, 128];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [182, 32, 30];
  const violet: [number, number, number] = [110, 74, 138];
  const damp: [number, number, number] = [72, 90, 82];
  const rust: [number, number, number] = [124, 62, 34];

  rect(t, 14, 17, 52, 48, paper, seed + 2670, 248);
  rect(t, 17, 20, 49, 24, light, seed + 2671, 220);
  outlineRect(t, 14, 17, 52, 48, ink);
  clearRect(t, 14, 17, 18, 20);
  clearRect(t, 50, 18, 52, 23);
  clearRect(t, 15, 45, 18, 48);
  rect(t, 14, 41, 52, 48, damp, seed + 2672, 105);
  line(t, 17, 20, 50, 46, 0.8, damp, seed + 2673, 112);
  for (let y = 27; y <= 39; y += 5) rect(t, 21, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 148);
  line(t, 22, 43, 46, 25, 1.3, violet, seed + 2674, 190);
  line(t, 23, 27, 47, 44, 1.0, red, seed + 2675, 155);
  ellipse(t, 41, 34, 8, 5.5, red, seed + 2676, 222);
  ellipse(t, 41, 34, 4.2, 2.6, paper, seed + 2677, 224);
  line(t, 35, 34, 47, 34, 0.8, red, seed + 2678, 235);
  rect(t, 27, 43, 40, 45, red, seed + 2679, 180);
  rect(t, 39, 21, 49, 24, violet, seed + 2680, 165);
  drawNoiseDust(t, seed + 2681, rust, 13);
}

function drawWeaponPermitSignedSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [208, 188, 112];
  const light: [number, number, number] = [240, 220, 146];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 34, 32];
  const green: [number, number, number] = [58, 128, 86];
  const metal: [number, number, number] = [42, 54, 58];
  const damp: [number, number, number] = [78, 94, 86];
  const rust: [number, number, number] = [122, 62, 34];

  rect(t, 12, 19, 53, 47, paper, seed + 2690, 248);
  rect(t, 15, 21, 50, 25, light, seed + 2691, 222);
  outlineRect(t, 12, 19, 53, 47, ink);
  clearRect(t, 12, 19, 16, 22);
  clearRect(t, 51, 19, 53, 24);
  clearRect(t, 13, 44, 16, 47);
  rect(t, 12, 41, 53, 47, damp, seed + 2692, 94);
  rect(t, 43, 27, 50, 33, green, seed + 2693, 214);
  rect(t, 45, 29, 49, 30, light, seed + 2694, 200);
  for (let y = 29; y <= 39; y += 5) rect(t, 20, y, 38 - ((seed + y) & 5), y + 1, ink, 0, 152);
  line(t, 21, 36, 39, 30, 2.0, ink, seed + 2695, 218);
  line(t, 35, 30, 43, 27, 1.1, metal, seed + 2696, 220);
  rect(t, 25, 36, 33, 40, metal, seed + 2697, 205);
  ellipse(t, 39, 35, 7.8, 5.4, red, seed + 2698, 220);
  ellipse(t, 39, 35, 4.2, 2.6, paper, seed + 2699, 224);
  line(t, 33, 35, 45, 35, 0.8, red, seed + 2700, 235);
  rect(t, 27, 42, 40, 44, red, seed + 2701, 184);
  drawNoiseDust(t, seed + 2702, rust, 10);
  drawNoiseDust(t, seed + 2703, green, 8);
}

function drawStolenTerminalStampSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 180, 96];
  const light: [number, number, number] = [232, 212, 132];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [178, 34, 32];
  const damp: [number, number, number] = [72, 92, 88];
  const terminal: [number, number, number] = [34, 50, 52];
  const cyan: [number, number, number] = [68, 196, 214];
  const rust: [number, number, number] = [122, 62, 34];

  ellipse(t, 34, 34, 24, 19, cyan, seed + 2694, 36);
  rect(t, 15, 14, 50, 52, paper, seed + 2695, 248);
  rect(t, 18, 17, 47, 22, light, seed + 2696, 220);
  outlineRect(t, 15, 14, 50, 52, ink);
  clearRect(t, 15, 14, 18, 17);
  clearRect(t, 48, 15, 50, 20);
  clearRect(t, 16, 49, 19, 52);
  rect(t, 15, 43, 50, 52, damp, seed + 2697, 105);
  rect(t, 15, 14, 19, 50, damp, seed + 2698, 112);

  rect(t, 21, 24, 29, 42, terminal, seed + 2699, 218);
  rect(t, 23, 27, 27, 34, cyan, seed + 2700, 112);
  rect(t, 22, 37, 28, 38, cyan, seed + 2701, 180);
  for (let y = 24; y <= 42; y += 5) rect(t, 33, y, 45 - ((seed + y) & 5), y + 1, ink, 0, 160);
  rect(t, 31, 19, 44, 20, ink, 0, 140);
  ellipse(t, 40, 35, 8.5, 6.0, red, seed + 2702, 226);
  ellipse(t, 40, 35, 4.8, 2.8, paper, seed + 2703, 224);
  line(t, 33, 35, 47, 35, 0.8, red, seed + 2704, 238);
  rect(t, 31, 45, 42, 48, red, seed + 2705, 188);
  line(t, 20, 48, 47, 21, 0.8, rust, seed + 2706, 122);
  drawNoiseDust(t, seed + 2707, rust, 11);
  drawNoiseDust(t, seed + 2708, cyan, 10);
}

function drawStolenArchiveCardSprite(t: Uint32Array, seed: number): void {
  const card: [number, number, number] = [194, 168, 96];
  const cardLight: [number, number, number] = [232, 208, 132];
  const ink: [number, number, number] = [22, 20, 16];
  const red: [number, number, number] = [180, 34, 32];
  const damp: [number, number, number] = [76, 88, 82];
  const tab: [number, number, number] = [126, 92, 48];
  const grime: [number, number, number] = [122, 66, 36];

  ellipse(t, 33, 53, 18, 4, [10, 9, 8], seed + 2744, 80);
  rect(t, 14, 20, 51, 47, card, seed + 2745, 248);
  rect(t, 19, 14, 39, 22, tab, seed + 2746, 236);
  rect(t, 17, 22, 48, 27, cardLight, seed + 2747, 206);
  outlineRect(t, 14, 20, 51, 47, ink);
  clearRect(t, 14, 20, 17, 23);
  clearRect(t, 49, 21, 51, 26);
  clearRect(t, 15, 44, 19, 47);
  rect(t, 14, 41, 51, 47, damp, seed + 2748, 100);
  line(t, 16, 43, 50, 25, 0.9, grime, seed + 2749, 126);
  for (let y = 29; y <= 40; y += 4) {
    rect(t, 20, y, 44 - ((seed + y) & 5), y + 1, ink, 0, 155);
  }
  rect(t, 19, 28, 47, 30, cardLight, seed + 2758, 160);
  for (let x = 22; x <= 42; x += 7) rect(t, x, 20, x + 1, 45, ink, seed + x, 35);
  rect(t, 38, 18, 50, 23, red, seed + 2750, 208);
  rect(t, 40, 20, 48, 21, cardLight, seed + 2751, 172);
  ellipse(t, 39, 36, 8.2, 5.6, red, seed + 2752, 218);
  ellipse(t, 39, 36, 4.2, 2.7, card, seed + 2753, 222);
  line(t, 33, 36, 45, 36, 0.8, red, seed + 2754, 232);
  rect(t, 23, 43, 38, 45, red, seed + 2755, 166);
  drawNoiseDust(t, seed + 2756, grime, 12);
  drawNoiseDust(t, seed + 2757, red, 7);
}

function drawStolenFilterPackSprite(t: Uint32Array, seed: number): void {
  const pack: [number, number, number] = [164, 152, 118];
  const packLight: [number, number, number] = [214, 204, 164];
  const dark: [number, number, number] = [28, 34, 32];
  const filter: [number, number, number] = [132, 148, 136];
  const filterLight: [number, number, number] = [196, 210, 188];
  const cyan: [number, number, number] = [72, 196, 178];
  const red: [number, number, number] = [178, 36, 34];
  const grime: [number, number, number] = [112, 68, 42];

  ellipse(t, 33, 53, 19, 4, [10, 11, 10], seed + 2760, 82);
  rect(t, 15, 25, 50, 47, dark, seed + 2761, 226);
  rect(t, 17, 21, 48, 43, pack, seed + 2762, 248);
  rect(t, 20, 18, 46, 25, packLight, seed + 2763, 222);
  outlineRect(t, 17, 21, 48, 43, dark);
  clearRect(t, 17, 21, 20, 24);
  clearRect(t, 46, 21, 48, 26);
  clearRect(t, 18, 40, 22, 43);

  ellipse(t, 25, 35, 8.5, 8.5, dark, seed + 2764, 232);
  ellipse(t, 25, 35, 6.4, 6.4, filter, seed + 2765, 238);
  ellipse(t, 25, 35, 3.2, 3.2, filterLight, seed + 2766, 188);
  ellipse(t, 40, 34, 8.2, 8.2, dark, seed + 2767, 228);
  ellipse(t, 40, 34, 6.1, 6.1, filter, seed + 2768, 238);
  ellipse(t, 40, 34, 3.1, 3.1, filterLight, seed + 2769, 188);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    line(t, 25, 35, 25 + Math.cos(a) * 6, 35 + Math.sin(a) * 6, 0.6, dark, seed + 2770 + i, 130);
    line(t, 40, 34, 40 + Math.cos(a) * 6, 34 + Math.sin(a) * 6, 0.6, dark, seed + 2778 + i, 125);
  }
  rect(t, 17, 40, 49, 45, red, seed + 2786, 196);
  rect(t, 22, 41, 40, 42, packLight, seed + 2787, 174);
  rect(t, 36, 23, 48, 27, red, seed + 2788, 210);
  rect(t, 38, 24, 46, 25, packLight, seed + 2789, 165);
  line(t, 18, 43, 49, 25, 0.8, grime, seed + 2790, 128);
  ellipse(t, 48, 33, 6, 7, cyan, seed + 2791, 112);
  drawNoiseDust(t, seed + 2792, grime, 11);
  drawNoiseDust(t, seed + 2793, cyan, 9);
}

function drawTerminalOrderReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 198, 138];
  const light: [number, number, number] = [242, 226, 160];
  const ink: [number, number, number] = [18, 20, 20];
  const red: [number, number, number] = [176, 36, 34];
  const cyan: [number, number, number] = [68, 214, 220];
  const terminal: [number, number, number] = [40, 62, 64];
  const rust: [number, number, number] = [122, 66, 36];

  ellipse(t, 34, 34, 24, 18, cyan, seed + 2709, 32);
  rect(t, 21, 8, 44, 55, paper, seed + 2710, 248);
  rect(t, 24, 11, 41, 16, light, seed + 2711, 220);
  outlineRect(t, 21, 8, 44, 55, ink);
  clearRect(t, 21, 8, 24, 12);
  clearRect(t, 41, 8, 44, 14);
  clearRect(t, 22, 52, 25, 55);
  rect(t, 21, 48, 44, 55, terminal, seed + 2712, 104);
  rect(t, 24, 19, 41, 25, terminal, seed + 2713, 215);
  rect(t, 27, 21, 38, 23, cyan, seed + 2714, 220);
  for (let y = 29; y <= 43; y += 4) {
    rect(t, 25, y, 39 - ((seed + y) & 5), y + 1, ink, 0, 150);
    rect(t, 25, y + 2, 31, y + 2, ink, 0, 90);
  }
  for (let x = 24; x <= 41; x += 4) rect(t, x, 53, x + 1, 55, ink, 0, 95);
  ellipse(t, 39, 40, 6.4, 4.8, red, seed + 2715, 210);
  ellipse(t, 39, 40, 3.5, 2.3, paper, seed + 2716, 218);
  line(t, 24, 50, 42, 16, 0.8, rust, seed + 2717, 118);
  drawNoiseDust(t, seed + 2718, cyan, 14);
  drawNoiseDust(t, seed + 2719, rust, 8);
}

function drawTrackDiagramScrapSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 178, 108];
  const light: [number, number, number] = [228, 210, 136];
  const ink: [number, number, number] = [20, 20, 18];
  const rail: [number, number, number] = [50, 74, 78];
  const red: [number, number, number] = [170, 38, 34];
  const damp: [number, number, number] = [78, 92, 86];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 14, 17, 51, 49, paper, seed + 2720, 248);
  rect(t, 17, 20, 48, 24, light, seed + 2721, 214);
  outlineRect(t, 14, 17, 51, 49, ink);
  clearRect(t, 14, 17, 20, 21);
  clearRect(t, 45, 17, 51, 25);
  clearRect(t, 15, 43, 21, 49);
  clearRect(t, 47, 44, 51, 49);
  rect(t, 14, 42, 51, 49, damp, seed + 2722, 98);
  line(t, 20, 39, 43, 24, 1.4, rail, seed + 2723, 230);
  line(t, 23, 44, 44, 30, 1.2, rail, seed + 2724, 215);
  line(t, 28, 27, 47, 38, 1.1, rail, seed + 2725, 190);
  for (let i = 0; i < 5; i++) {
    const x = 22 + i * 5;
    line(t, x, 38 - i * 3, x + 5, 42 - i * 3, 0.7, ink, seed + 2726 + i, 145);
  }
  ellipse(t, 39, 37, 6.2, 4.7, red, seed + 2731, 198);
  ellipse(t, 39, 37, 3.4, 2.2, paper, seed + 2732, 205);
  line(t, 18, 45, 47, 22, 0.8, rust, seed + 2733, 128);
  drawNoiseDust(t, seed + 2734, rust, 12);
}

type DocumentSpriteRenderer = (t: Uint32Array, seed: number) => void;

const documentSpriteRenderers: Record<string, DocumentSpriteRenderer> = {
  'terminal_order_receipt': drawTerminalOrderReceiptSprite,
  'track_diagram_scrap': drawTrackDiagramScrapSprite,
  'temp_pass': drawTempPassSprite,
  'void_archive_warrant': drawVoidArchiveWarrantSprite,
  'stolen_archive_card': drawStolenArchiveCardSprite,
  'stolen_filter_pack': drawStolenFilterPackSprite,
  'used_gasmask_filter': drawUsedGasmaskFilterSprite,
  'stolen_terminal_stamp': drawStolenTerminalStampSprite,
  'weapon_permit_forged': drawWeaponPermitForgedSprite,
  'weapon_permit_signed': drawWeaponPermitSignedSprite,
  'quarantine_breach_notice': drawQuarantineBreachNoticeSprite,
  'rail_depot_pass': drawRailDepotPassSprite,
  'shelter_seat_card': drawShelterSeatCardSprite,
  'shelter_seat_forgery': drawShelterSeatForgerySprite,
  'shelter_tally': drawShelterTallySprite,
  'samosbor_alarm_schedule': drawSamosborAlarmScheduleSprite,
  'sample_chain_form': drawSampleChainFormSprite,
  'resident_identity_stub': drawResidentIdentityStubSprite,
  'note': drawNoteSprite,
  'nii_contraband_manifest': drawNiiContrabandManifestSprite,
  'nii_forged_audit': drawNiiForgedAuditSprite,
  'nii_market_receipt': drawNiiMarketReceiptSprite,
  'nii_sample_container': drawNiiSampleContainerSprite,
  'nii_sample_label': drawNiiSampleLabelSprite,
  'liquidator_field_roster': drawLiquidatorFieldRosterSprite,
  'liquidator_issue_card': drawLiquidatorIssueCardSprite,
  'passport_stub': drawPassportStubSprite,
  'permanent_pass': drawPermanentPassSprite,
  'cardboard_stack': drawCardboardStackSprite,
  'fuel_issue_stamp': drawFuelIssueStampSprite,
  'elevator_access_order': drawElevatorAccessOrderSprite,
  'gusl_index_page': drawGuslIndexPageSprite,
  'hazard_shift_extension': drawHazardShiftExtensionSprite,
  'blueprint_t1_folder': drawBlueprintT1FolderSprite,
  'blueprint_t2_folder': drawBlueprintT2FolderSprite,
  'blueprint_t3_folder': drawBlueprintT3FolderSprite,
  'forged_bank_debt_paper': drawForgedBankDebtPaperSprite,
  'forged_permit_slip': drawForgedPermitSlipSprite,
  'forged_quarantine_clearance': drawForgedQuarantineClearanceSprite,
  'forged_raionsovet_pass': drawForgedRaionsovetPassSprite,
  'forged_shelter_tally': drawForgedShelterTallySprite,
  'forged_stamp_sheet': drawForgedStampSheetSprite,
  'ministry_audit_forgery': drawMinistryAuditForgerySprite,
  'ministry_clean_stamp': drawMinistryCleanStampSprite,
  'debt_settlement_receipt': drawDebtSettlementReceiptSprite,
  'official_permit_slip': drawOfficialPermitSlipSprite,
  'rail_switch_order': drawRailSwitchOrderSprite,
  'raionsovet_floor_pass': drawRaionsovetFloorPassSprite,
  'ovb_search_warrant': drawOvbSearchWarrantSprite,
  'p14_gasmask_receipt': drawP14GasmaskReceiptSprite,
  'part_ticket': drawPartTicketSprite,
  'clean_health_cert': drawCleanHealthCertSprite,
  'hermodoor_journal': drawHermodoorJournalSprite,
  'cleanup_order_stub': drawCleanupOrderStubSprite,
  'decon_completion_stamp': drawDeconCompletionStampSprite,
  'confiscation_tag': drawConfiscationTagSprite,
  'confiscation_warrant': drawConfiscationWarrantSprite,
  'contaminated_gloves': drawContaminatedGlovesSprite,
  'contaminated_sample_act': drawContaminatedSampleActSprite,
  'contaminated_swab': drawContaminatedSwabSprite,
  'contraband_receipt_blank': drawContrabandReceiptBlankSprite,
  'corpse_number_tag': drawCorpseNumberTagSprite,
  'fake_pass': drawFakePassSprite,
  'foam_grenade_act': drawFoamGrenadeActSprite,
  'mail_intercept_slip': drawMailInterceptSlipSprite,
  'pneumomail_capsule': drawPneumomailCapsuleSprite,
  'scrubbed_weapon_tag': drawScrubbedWeaponTagSprite,
  'labor_shift_card': drawLaborShiftCardSprite,
};

function drawDocumentSprite(t: Uint32Array, seed: number, p: Palette, defId: string, def?: ItemDef): void {
  const renderer = documentSpriteRenderers[defId];
  if (renderer) {
    renderer(t, seed);
    return;
  }
  if (isSlimeAgeLabel(defId)) {
    drawSlimeAgeLabelSprite(t, seed, defId);
    return;
  }
  if (isPaintAuditDocument(defId, def)) {
    drawPaintAuditDocumentSprite(t, seed);
    return;
  }
  if (isOfficialBankDebtPaper(defId, def)) {
    drawBankDebtPaperSprite(t, seed);
    return;
  }
  if (isOfficialArchivePermit(defId, def)) {
    drawArchiveAccessPermitSprite(t, seed);
    return;
  }
  const tags = tagSet(defId, def);
  const card = defId.includes('card') || defId.includes('coupon') || defId.includes('ticket');
  rect(t, card ? 16 : 17, card ? 13 : 10, card ? 48 : 47, card ? 48 : 53, p.body, seed + 1);
  outlineRect(t, card ? 16 : 17, card ? 13 : 10, card ? 48 : 47, card ? 48 : 53, p.dark);
  for (let y = card ? 22 : 18; y <= (card ? 38 : 42); y += 6) {
    rect(t, 22, y, 42 - ((y + seed) & 3), y + 1, p.dark, 0, 150);
  }
  if (defId.includes('forged') || defId.includes('fake') || defId.includes('audit') || hasAny(tags, ['permit', 'official', 'stamp', 'document_gate'])) drawStamp(t, seed, p);
  if (defId.includes('samosbor') || defId.includes('void')) drawEye(t, 31, 28, seed, p, 0.8);
}

function drawBreadSprite(t: Uint32Array, seed: number): void {
  const crust: [number, number, number] = [126, 76, 38];
  const crustDark: [number, number, number] = [58, 38, 24];
  const crumb: [number, number, number] = [196, 154, 82];
  const crumbLight: [number, number, number] = [230, 192, 112];
  const paper: [number, number, number] = [168, 156, 108];
  const staleGreen: [number, number, number] = [80, 114, 70];
  const stamp: [number, number, number] = [166, 42, 34];

  ellipse(t, 31, 52, 17, 4, [24, 18, 12], seed + 660, 82);
  ellipse(t, 31, 35, 20, 13, crustDark, seed + 661, 248);
  ellipse(t, 31, 33, 18, 12, crust, seed + 662, 252);
  clearRect(t, 13, 34, 17, 40);
  clearRect(t, 45, 23, 49, 29);
  rect(t, 17, 34, 46, 48, crumb, seed + 663, 248);
  line(t, 17, 34, 46, 34, 1.2, crustDark, seed + 664, 170);
  line(t, 18, 46, 45, 48, 1.3, crustDark, seed + 665, 135);
  ellipse(t, 29, 36, 11, 6, crumbLight, seed + 666, 165);

  line(t, 20, 41, 40, 36, 1.2, crustDark, seed + 667, 145);
  line(t, 25, 28, 27, 38, 1.1, crustDark, seed + 668, 120);
  line(t, 34, 25, 37, 38, 1.1, crustDark, seed + 669, 115);
  rect(t, 38, 40, 50, 45, paper, seed + 670, 210);
  rect(t, 41, 42, 47, 43, stamp, seed + 671, 205);
  ellipse(t, 21, 45, 3.6, 2.6, staleGreen, seed + 672, 135);
  drawNoiseDust(t, seed + 673, [88, 54, 32], 12);
  drawNoiseDust(t, seed + 674, staleGreen, 8);
}

function drawYeastBreadSprite(t: Uint32Array, seed: number): void {
  const crustDark: [number, number, number] = [62, 36, 22];
  const crust: [number, number, number] = [142, 84, 38];
  const crustLight: [number, number, number] = [204, 132, 62];
  const crumb: [number, number, number] = [222, 176, 94];
  const crumbLight: [number, number, number] = [246, 210, 128];
  const paper: [number, number, number] = [172, 154, 100];
  const green: [number, number, number] = [78, 120, 66];
  const red: [number, number, number] = [164, 42, 34];
  const damp: [number, number, number] = [72, 76, 54];

  ellipse(t, 33, 53, 18, 4, [18, 14, 10], seed + 681, 84);
  ellipse(t, 31, 34, 20, 17, crustDark, seed + 682, 248);
  ellipse(t, 32, 31, 18, 15, crust, seed + 683, 252);
  ellipse(t, 28, 28, 10, 6.5, crustLight, seed + 684, 172);
  clearRect(t, 12, 35, 17, 43);
  clearRect(t, 47, 22, 52, 31);
  rect(t, 16, 37, 48, 50, crumb, seed + 685, 248);
  ellipse(t, 30, 39, 12, 6, crumbLight, seed + 686, 155);
  line(t, 17, 38, 48, 37, 1.2, crustDark, seed + 687, 170);
  line(t, 18, 49, 47, 50, 1.2, crustDark, seed + 688, 132);
  for (const [x, y, rx, ry] of [[23, 32, 2.7, 1.9], [32, 27, 3.0, 2.2], [40, 33, 2.4, 1.8], [27, 44, 2.0, 1.5]] as const) {
    ellipse(t, x, y, rx, ry, crumbLight, seed + x + y, 180);
  }
  line(t, 21, 43, 44, 36, 1.1, crustDark, seed + 689, 142);
  line(t, 25, 25, 27, 38, 1.1, crustDark, seed + 690, 120);
  line(t, 36, 23, 39, 38, 1.1, crustDark, seed + 691, 112);
  rect(t, 38, 39, 53, 46, paper, seed + 692, 214);
  rect(t, 42, 41, 49, 42, red, seed + 693, 204);
  ellipse(t, 20, 47, 4.5, 2.8, green, seed + 694, 145);
  ellipse(t, 45, 47, 5.4, 3.0, damp, seed + 695, 116);
  drawNoiseDust(t, seed + 696, [98, 58, 30], 13);
  drawNoiseDust(t, seed + 697, green, 8);
}

function drawCannedFoodSprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [102, 114, 108];
  const steelLight: [number, number, number] = [170, 180, 166];
  const steelDark: [number, number, number] = [38, 48, 46];
  const label: [number, number, number] = [156, 54, 42];
  const labelLight: [number, number, number] = [214, 126, 64];
  const meat: [number, number, number] = [118, 46, 34];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 52, 16, 4, [18, 16, 14], seed + 690, 86);
  rect(t, 18, 22, 47, 48, steel, seed + 691, 252);
  ellipse(t, 32.5, 22, 15, 5.5, steelLight, seed + 692, 250);
  ellipse(t, 32.5, 48, 15, 5, steelDark, seed + 693, 175);
  outlineRect(t, 18, 22, 47, 48, steelDark);
  line(t, 20, 25, 20, 46, 0.8, steelLight, seed + 694, 135);
  line(t, 45, 24, 46, 46, 0.8, steelDark, seed + 695, 160);

  rect(t, 20, 31, 45, 41, label, seed + 696, 240);
  rect(t, 24, 34, 39, 36, labelLight, seed + 697, 220);
  rect(t, 26, 38, 41, 40, steelDark, seed + 698, 125);
  ellipse(t, 34, 22, 6, 2.2, steelDark, seed + 699, 165);
  line(t, 34, 22, 42, 19, 1.1, steelDark, seed + 700, 190);
  ellipse(t, 43, 19, 3.2, 2.2, steelLight, seed + 701, 205);
  ellipse(t, 24, 46, 5, 2.6, meat, seed + 702, 135);
  rect(t, 42, 25, 49, 28, rust, seed + 703, 155);
  rect(t, 19, 44, 27, 47, rust, seed + 704, 130);
  drawNoiseDust(t, seed + 705, rust, 12);
}

function drawPearlBarleySprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [92, 104, 98];
  const steelLight: [number, number, number] = [164, 174, 158];
  const steelDark: [number, number, number] = [34, 42, 40];
  const label: [number, number, number] = [170, 142, 78];
  const labelLight: [number, number, number] = [218, 190, 112];
  const grain: [number, number, number] = [212, 194, 132];
  const grainDark: [number, number, number] = [124, 98, 52];
  const green: [number, number, number] = [74, 118, 66];
  const red: [number, number, number] = [168, 42, 34];
  const rust: [number, number, number] = [126, 66, 34];

  ellipse(t, 32, 52, 16, 4, [18, 16, 14], seed + 1183, 84);
  rect(t, 18, 22, 47, 49, steel, seed + 1184, 252);
  ellipse(t, 32.5, 22, 15, 5.5, steelLight, seed + 1185, 250);
  ellipse(t, 32.5, 49, 15, 4.5, steelDark, seed + 1186, 175);
  outlineRect(t, 18, 22, 47, 49, steelDark);
  rect(t, 20, 31, 45, 42, label, seed + 1187, 238);
  rect(t, 23, 33, 36, 36, labelLight, seed + 1188, 210);
  rect(t, 36, 34, 43, 38, green, seed + 1189, 215);
  rect(t, 37, 35, 41, 36, grain, seed + 1190, 180);
  clearRect(t, 20, 31, 26, 35);
  for (let i = 0; i < 16; i++) {
    const x = 22 + Math.floor(noise(i, 82, seed) * 19);
    const y = 30 + Math.floor(noise(i, 83, seed) * 13);
    ellipse(t, x, y, 1.8, 1.2, (i & 1) === 0 ? grain : grainDark, seed + 1191 + i, 205);
  }
  line(t, 20, 25, 20, 47, 0.8, steelLight, seed + 1210, 120);
  line(t, 45, 24, 46, 47, 0.8, steelDark, seed + 1211, 150);
  rect(t, 39, 25, 48, 28, rust, seed + 1212, 150);
  rect(t, 24, 41, 36, 44, red, seed + 1213, 165);
  line(t, 21, 44, 47, 31, 0.8, rust, seed + 1214, 130);
  drawNoiseDust(t, seed + 1215, rust, 12);
  drawNoiseDust(t, seed + 1216, grain, 10);
}

function drawConcentrateCouponSprite(t: Uint32Array, seed: number, bonus: boolean): void {
  const paper: [number, number, number] = bonus ? [196, 174, 86] : [184, 164, 100];
  const light: [number, number, number] = bonus ? [232, 210, 112] : [218, 198, 132];
  const ink: [number, number, number] = [34, 30, 22];
  const red: [number, number, number] = bonus ? [190, 42, 38] : [164, 48, 40];
  const green: [number, number, number] = bonus ? [72, 152, 72] : [82, 126, 74];
  const briquette: [number, number, number] = bonus ? [94, 142, 66] : [116, 92, 58];
  const ochre: [number, number, number] = [150, 102, 44];
  const damp: [number, number, number] = [76, 84, 66];

  rect(t, 14, 18, 51, 46, paper, seed + 706, 248);
  rect(t, 17, 20, 48, 24, light, seed + 707, 220);
  outlineRect(t, 14, 18, 51, 46, ink);
  clearRect(t, 14, 18, 17, 21);
  clearRect(t, 49, 18, 51, 23);
  clearRect(t, 15, 44, 18, 46);
  rect(t, 14, 40, 51, 46, damp, seed + 708, 96);

  rect(t, 20, 28, 36, 38, briquette, seed + 709, 236);
  rect(t, 21, 29, 35, 31, light, seed + 710, 115);
  line(t, 22, 36, 35, 31, 0.8, ink, seed + 711, 110);
  rect(t, 38, 28, 46, 37, bonus ? green : red, seed + 712, 222);
  rect(t, 40, 31, 44, 33, light, seed + 713, 190);
  if (bonus) {
    rect(t, 39, 18, 47, 21, red, seed + 714, 220);
    rect(t, 26, 41, 44, 44, green, seed + 715, 180);
  } else {
    rect(t, 23, 41, 38, 43, red, seed + 716, 170);
  }

  for (let y = 24; y <= 38; y += 5) rect(t, 18, y, 32 - ((seed + y) & 3), y + 1, ink, 0, 115);
  ellipse(t, 42, 35, 6.2, 4.6, red, seed + 717, bonus ? 205 : 175);
  ellipse(t, 42, 35, 3.4, 2.2, paper, seed + 718, 215);
  drawNoiseDust(t, seed + 719, ochre, 10);
}

function drawForgedRationCardSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [190, 166, 94];
  const light: [number, number, number] = [226, 204, 128];
  const ink: [number, number, number] = [30, 26, 20];
  const red: [number, number, number] = [176, 36, 34];
  const green: [number, number, number] = [74, 128, 74];
  const briquette: [number, number, number] = [112, 92, 56];
  const damp: [number, number, number] = [74, 84, 70];
  const ochre: [number, number, number] = [136, 82, 36];

  rect(t, 13, 18, 51, 47, paper, seed + 738, 248);
  rect(t, 16, 20, 48, 24, light, seed + 739, 220);
  outlineRect(t, 13, 18, 51, 47, ink);
  clearRect(t, 13, 18, 17, 21);
  clearRect(t, 49, 18, 51, 23);
  clearRect(t, 14, 45, 17, 47);
  rect(t, 13, 41, 51, 47, damp, seed + 740, 96);

  rect(t, 19, 29, 33, 40, briquette, seed + 741, 236);
  rect(t, 20, 30, 32, 32, light, seed + 742, 118);
  line(t, 21, 38, 32, 32, 0.8, ink, seed + 743, 108);
  for (let x = 36; x <= 46; x += 5) for (let y = 28; y <= 39; y += 5) {
    rect(t, x, y, x + 2, y + 2, ((x + y + seed) & 1) !== 0 ? green : ink, seed + x + y, ((x + y) & 1) !== 0 ? 170 : 108);
  }
  rect(t, 22, 24, 39, 25, ink, 0, 135);
  rect(t, 39, 21, 48, 24, red, seed + 744, 190);
  ellipse(t, 42, 35, 6.8, 4.8, red, seed + 745, 210);
  ellipse(t, 42, 35, 3.6, 2.2, paper, seed + 746, 218);
  rect(t, 24, 43, 39, 45, red, seed + 747, 168);
  drawNoiseDust(t, seed + 748, ochre, 12);
  drawNoiseDust(t, seed + 749, green, 7);
}

function drawExperimentalConcentrateSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [156, 122, 62];
  const wrapperLight: [number, number, number] = [214, 176, 92];
  const wrapperDark: [number, number, number] = [58, 44, 30];
  const ration: [number, number, number] = [84, 124, 58];
  const rationLight: [number, number, number] = [142, 184, 72];
  const red: [number, number, number] = [186, 42, 38];
  const niiPaper: [number, number, number] = [210, 198, 142];
  const stain: [number, number, number] = [54, 70, 48];
  const rust: [number, number, number] = [128, 66, 34];

  ellipse(t, 33, 52, 17, 4, stain, seed + 720, 78);
  rect(t, 17, 26, 48, 49, wrapperDark, seed + 721, 230);
  rect(t, 18, 22, 47, 46, wrapper, seed + 722, 248);
  rect(t, 21, 18, 45, 27, wrapperLight, seed + 723, 236);
  outlineRect(t, 18, 22, 47, 46, wrapperDark);
  clearRect(t, 18, 22, 21, 25);
  clearRect(t, 45, 22, 47, 27);
  clearRect(t, 18, 44, 21, 46);

  rect(t, 22, 30, 43, 43, ration, seed + 724, 246);
  rect(t, 23, 31, 42, 33, rationLight, seed + 725, 170);
  line(t, 24, 41, 42, 32, 1.0, wrapperDark, seed + 726, 145);
  line(t, 23, 34, 42, 39, 0.8, rationLight, seed + 727, 135);

  rect(t, 31, 20, 46, 29, niiPaper, seed + 728, 235);
  rect(t, 34, 23, 43, 24, wrapperDark, 0, 145);
  rect(t, 35, 26, 44, 27, red, seed + 729, 212);
  rect(t, 18, 38, 48, 43, red, seed + 730, 188);
  rect(t, 22, 39, 35, 41, niiPaper, seed + 731, 205);
  line(t, 20, 24, 46, 45, 0.8, stain, seed + 732, 92);
  ellipse(t, 43, 45, 7, 4, stain, seed + 733, 120);
  drawNoiseDust(t, seed + 734, rust, 11);
  drawNoiseDust(t, seed + 735, rationLight, 8);
}

function drawGreenBriquetteSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [176, 158, 96];
  const paperLight: [number, number, number] = [218, 204, 132];
  const paperDark: [number, number, number] = [50, 46, 34];
  const green: [number, number, number] = [72, 132, 66];
  const greenLight: [number, number, number] = [122, 178, 84];
  const red: [number, number, number] = [168, 42, 36];
  const damp: [number, number, number] = [58, 82, 54];
  const rust: [number, number, number] = [126, 72, 34];

  rect(t, 16, 20, 50, 48, paper, seed + 736, 248);
  rect(t, 19, 16, 43, 24, paperLight, seed + 737, 238);
  outlineRect(t, 16, 20, 50, 48, paperDark);
  clearRect(t, 16, 20, 19, 23);
  clearRect(t, 48, 20, 50, 25);
  clearRect(t, 17, 45, 20, 48);

  rect(t, 21, 26, 45, 44, green, seed + 738, 246);
  rect(t, 23, 28, 43, 31, greenLight, seed + 739, 160);
  line(t, 22, 42, 44, 31, 1.0, paperDark, seed + 740, 125);
  line(t, 19, 24, 48, 47, 0.8, damp, seed + 741, 100);
  rect(t, 31, 20, 36, 47, paperDark, seed + 742, 72);
  rect(t, 23, 34, 42, 38, paperLight, seed + 743, 210);
  rect(t, 26, 35, 38, 36, paperDark, 0, 130);
  rect(t, 38, 27, 45, 31, red, seed + 744, 210);
  rect(t, 39, 29, 43, 30, paperLight, seed + 745, 185);
  rect(t, 17, 42, 49, 48, damp, seed + 746, 86);
  drawNoiseDust(t, seed + 747, rust, 11);
  drawNoiseDust(t, seed + 748, greenLight, 12);
}

function drawGreyBriquetteSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [174, 166, 126];
  const paperLight: [number, number, number] = [218, 210, 164];
  const paperDark: [number, number, number] = [58, 54, 42];
  const ration: [number, number, number] = [174, 176, 160];
  const rationLight: [number, number, number] = [226, 226, 202];
  const red: [number, number, number] = [166, 42, 36];
  const green: [number, number, number] = [70, 114, 76];
  const damp: [number, number, number] = [76, 82, 66];
  const rust: [number, number, number] = [124, 68, 38];

  rect(t, 15, 23, 50, 49, paper, seed + 764, 248);
  rect(t, 18, 18, 44, 27, paperLight, seed + 765, 235);
  outlineRect(t, 15, 23, 50, 49, paperDark);
  clearRect(t, 15, 23, 18, 26);
  clearRect(t, 48, 23, 50, 28);
  clearRect(t, 16, 46, 19, 49);

  rect(t, 20, 30, 46, 45, ration, seed + 766, 246);
  rect(t, 22, 31, 44, 34, rationLight, seed + 767, 170);
  line(t, 21, 43, 45, 34, 1.0, paperDark, seed + 768, 135);
  rect(t, 21, 25, 31, 30, paperDark, seed + 769, 84);
  rect(t, 34, 24, 47, 30, red, seed + 770, 205);
  rect(t, 37, 26, 45, 27, paperLight, seed + 771, 180);
  rect(t, 17, 43, 50, 49, damp, seed + 772, 92);
  ellipse(t, 25, 42, 6.5, 3.5, green, seed + 773, 116);
  rect(t, 25, 35, 39, 37, paperLight, seed + 774, 185);
  rect(t, 28, 36, 36, 36, paperDark, 0, 130);
  drawNoiseDust(t, seed + 775, rust, 11);
  drawNoiseDust(t, seed + 776, green, 8);
}

function drawEasterEggSprite(t: Uint32Array, seed: number): void {
  const shell: [number, number, number] = [202, 186, 126];
  const light: [number, number, number] = [236, 222, 164];
  const green: [number, number, number] = [72, 132, 86];
  const red: [number, number, number] = [172, 46, 42];
  const blue: [number, number, number] = [68, 126, 156];
  const crack: [number, number, number] = [40, 32, 24];
  const damp: [number, number, number] = [72, 82, 64];
  const ochre: [number, number, number] = [180, 124, 48];

  ellipse(t, 32, 52, 15, 4, damp, seed + 749, 88);
  ellipse(t, 32, 34, 17, 23, shell, seed + 750, 252);
  ellipse(t, 27, 26, 8, 10, light, seed + 751, 118);
  line(t, 18, 31, 46, 25, 2.0, red, seed + 752, 214);
  line(t, 20, 39, 47, 33, 2.0, green, seed + 753, 214);
  line(t, 23, 47, 42, 42, 1.6, blue, seed + 754, 190);
  line(t, 25, 18, 29, 26, 1.0, red, seed + 755, 170);
  line(t, 36, 19, 41, 27, 1.0, green, seed + 756, 170);
  line(t, 30, 21, 34, 30, 1.1, crack, seed + 757, 230);
  line(t, 34, 30, 30, 37, 1.0, crack, seed + 758, 225);
  line(t, 30, 37, 36, 46, 1.0, crack, seed + 759, 220);
  rect(t, 30, 30, 36, 35, [190, 92, 64], seed + 760, 94);
  ellipse(t, 43, 43, 4.2, 3.2, damp, seed + 761, 116);
  drawNoiseDust(t, seed + 762, ochre, 13);
  drawNoiseDust(t, seed + 763, red, 6);
}

function drawInfectedMushroomSprite(t: Uint32Array, seed: number): void {
  const capDark: [number, number, number] = [56, 70, 42];
  const cap: [number, number, number] = [112, 126, 64];
  const capLight: [number, number, number] = [166, 154, 82];
  const stem: [number, number, number] = [128, 104, 78];
  const stemLight: [number, number, number] = [184, 160, 116];
  const spore: [number, number, number] = [88, 178, 92];
  const red: [number, number, number] = [172, 42, 38];
  const slime: [number, number, number] = [62, 116, 70];
  const rot: [number, number, number] = [72, 48, 36];

  ellipse(t, 32, 52, 16, 4, [14, 18, 12], seed + 764, 86);
  rect(t, 27, 28, 39, 49, stem, seed + 765, 246);
  ellipse(t, 33, 49, 9, 4.2, stemLight, seed + 766, 220);
  line(t, 30, 29, 29, 47, 0.9, stemLight, seed + 767, 132);
  line(t, 37, 30, 38, 47, 0.8, rot, seed + 768, 128);

  ellipse(t, 32, 27, 21, 9.5, capDark, seed + 769, 250);
  ellipse(t, 31, 24, 18, 8.5, cap, seed + 770, 252);
  ellipse(t, 28, 22, 9, 3.2, capLight, seed + 771, 160);
  clearRect(t, 12, 27, 17, 32);
  clearRect(t, 48, 27, 52, 31);

  for (const [x, y, r] of [[22, 25, 2.8], [29, 20, 2.2], [36, 23, 2.6], [43, 27, 2.0]] as const) {
    ellipse(t, x, y, r, r * 0.75, (x + seed) & 1 ? red : spore, seed + 772 + x, 218);
  }
  line(t, 16, 31, 48, 29, 1.0, rot, seed + 780, 115);
  ellipse(t, 23, 47, 7, 3.2, slime, seed + 781, 120);
  line(t, 22, 42, 42, 50, 0.9, slime, seed + 782, 125);
  drawNoiseDust(t, seed + 783, spore, 16);
  drawNoiseDust(t, seed + 784, red, 8);
}

function drawMushroomMassSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [150, 122, 72];
  const paperLight: [number, number, number] = [204, 170, 96];
  const paperDark: [number, number, number] = [54, 42, 30];
  const fungus: [number, number, number] = [98, 128, 64];
  const fungusLight: [number, number, number] = [154, 174, 92];
  const stem: [number, number, number] = [134, 112, 82];
  const wet: [number, number, number] = [54, 128, 86];
  const red: [number, number, number] = [154, 42, 34];
  const rot: [number, number, number] = [64, 44, 34];

  ellipse(t, 33, 52, 18, 4, [16, 18, 12], seed + 812, 84);
  rect(t, 15, 33, 50, 49, paperDark, seed + 813, 215);
  rect(t, 17, 27, 48, 45, paper, seed + 814, 245);
  rect(t, 20, 23, 45, 31, paperLight, seed + 815, 230);
  outlineRect(t, 17, 27, 48, 45, paperDark);
  clearRect(t, 17, 27, 20, 30);
  clearRect(t, 46, 27, 48, 32);
  clearRect(t, 18, 42, 21, 45);

  for (const [cx, cy, rx, ry] of [[23, 34, 8, 5], [32, 31, 10, 6], [41, 36, 8, 5], [29, 41, 9, 5]] as const) {
    ellipse(t, cx, cy, rx, ry, fungus, seed + cx + cy, 238);
    ellipse(t, cx - 2, cy - 2, rx * 0.45, ry * 0.34, fungusLight, seed + cx * 3, 160);
    rect(t, cx - 2, cy + 2, cx + 2, cy + 9, stem, seed + cy * 5, 205);
  }
  line(t, 18, 43, 48, 30, 1.0, paperDark, seed + 816, 130);
  line(t, 21, 45, 44, 48, 1.0, wet, seed + 817, 135);
  ellipse(t, 43, 48, 7, 3.2, wet, seed + 818, 120);
  rect(t, 34, 24, 46, 29, red, seed + 819, 188);
  rect(t, 37, 26, 44, 27, paperLight, seed + 820, 176);
  drawNoiseDust(t, seed + 821, wet, 17);
  drawNoiseDust(t, seed + 822, rot, 12);
}

function drawLiquidatorRationSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [28, 30, 24];
  const wrapperLight: [number, number, number] = [72, 76, 58];
  const paper: [number, number, number] = [154, 132, 76];
  const paperLight: [number, number, number] = [196, 174, 102];
  const red: [number, number, number] = [170, 38, 34];
  const green: [number, number, number] = [58, 112, 72];
  const rot: [number, number, number] = [92, 76, 42];
  const ink: [number, number, number] = [8, 10, 8];

  rect(t, 17, 25, 48, 47, wrapper, seed + 785, 252);
  rect(t, 20, 21, 45, 28, paper, seed + 786, 242);
  rect(t, 21, 29, 46, 43, wrapperLight, seed + 787, 168);
  outlineRect(t, 17, 25, 48, 47, ink);
  clearRect(t, 17, 25, 20, 28);
  clearRect(t, 46, 26, 48, 30);
  clearRect(t, 18, 44, 21, 47);
  line(t, 20, 25, 46, 43, 0.9, ink, seed + 788, 155);
  line(t, 20, 42, 45, 31, 0.9, wrapper, seed + 789, 190);
  rect(t, 23, 24, 39, 27, red, seed + 790, 220);
  rect(t, 25, 25, 36, 26, paperLight, seed + 791, 185);
  rect(t, 35, 32, 45, 37, green, seed + 792, 205);
  rect(t, 37, 34, 43, 35, paperLight, seed + 793, 180);
  rect(t, 23, 33, 34, 41, ink, seed + 794, 205);
  ellipse(t, 27, 37, 5.5, 3.6, red, seed + 795, 130);
  ellipse(t, 42, 42, 6.5, 3.0, rot, seed + 796, 128);
  drawNoiseDust(t, seed + 797, rot, 14);
  drawNoiseDust(t, seed + 798, red, 8);
}

function drawPressedSugarSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [190, 166, 94];
  const wrapperLight: [number, number, number] = [226, 204, 128];
  const paperDark: [number, number, number] = [62, 48, 32];
  const sugarRed: [number, number, number] = [166, 42, 40];
  const sugarLight: [number, number, number] = [222, 86, 64];
  const riskGreen: [number, number, number] = [58, 110, 70];
  const stamp: [number, number, number] = [92, 30, 28];
  const damp: [number, number, number] = [76, 72, 44];

  ellipse(t, 33, 52, 17, 4, [16, 14, 10], seed + 2252, 84);
  rect(t, 16, 28, 49, 48, paperDark, seed + 2253, 218);
  rect(t, 18, 24, 47, 44, wrapper, seed + 2254, 246);
  rect(t, 20, 21, 44, 28, wrapperLight, seed + 2255, 230);
  rect(t, 12, 27, 18, 48, wrapper, seed + 2252, 218);
  rect(t, 47, 28, 53, 45, wrapperLight, seed + 2251, 205);
  outlineRect(t, 18, 24, 47, 44, paperDark);
  clearRect(t, 18, 24, 21, 27);
  clearRect(t, 45, 24, 47, 29);
  clearRect(t, 19, 41, 22, 44);
  rect(t, 23, 29, 43, 43, sugarRed, seed + 2256, 248);
  rect(t, 26, 31, 40, 34, sugarLight, seed + 2257, 168);
  line(t, 23, 37, 43, 34, 1.1, stamp, seed + 2258, 145);
  rect(t, 26, 23, 40, 26, sugarRed, seed + 2259, 220);
  rect(t, 28, 24, 37, 25, wrapperLight, seed + 2260, 175);
  rect(t, 35, 35, 45, 39, riskGreen, seed + 2261, 194);
  rect(t, 38, 36, 43, 37, wrapperLight, seed + 2262, 165);
  ellipse(t, 28, 40, 5.2, 3.2, sugarLight, seed + 2263, 120);
  ellipse(t, 43, 46, 6.4, 2.8, damp, seed + 2264, 118);
  drawNoiseDust(t, seed + 2265, damp, 13);
  drawNoiseDust(t, seed + 2266, sugarLight, 9);
}

function drawSugarPackSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [190, 172, 112];
  const wrapperLight: [number, number, number] = [230, 214, 156];
  const sugar: [number, number, number] = [238, 234, 196];
  const sugarShadow: [number, number, number] = [176, 168, 128];
  const ink: [number, number, number] = [50, 42, 32];
  const red: [number, number, number] = [170, 42, 36];
  const green: [number, number, number] = [72, 116, 76];
  const damp: [number, number, number] = [70, 78, 58];
  const rust: [number, number, number] = [122, 66, 38];

  ellipse(t, 33, 52, 17, 4, [14, 14, 10], seed + 2323, 82);
  rect(t, 16, 27, 50, 48, ink, seed + 2324, 210);
  rect(t, 18, 22, 48, 45, wrapper, seed + 2325, 248);
  rect(t, 21, 19, 45, 27, wrapperLight, seed + 2326, 230);
  outlineRect(t, 18, 22, 48, 45, ink);
  clearRect(t, 18, 22, 21, 25);
  clearRect(t, 46, 22, 48, 28);
  clearRect(t, 19, 42, 22, 45);

  rect(t, 35, 26, 47, 38, sugarShadow, seed + 2327, 230);
  ellipse(t, 40, 31, 9.0, 6.5, sugar, seed + 2328, 246);
  clearRect(t, 43, 23, 49, 29);
  line(t, 35, 27, 47, 38, 0.9, ink, seed + 2329, 135);
  rect(t, 22, 29, 34, 39, red, seed + 2330, 220);
  rect(t, 25, 31, 32, 32, wrapperLight, seed + 2331, 180);
  rect(t, 24, 36, 33, 37, wrapperLight, seed + 2332, 160);
  rect(t, 21, 40, 47, 45, damp, seed + 2333, 92);
  rect(t, 37, 41, 45, 43, green, seed + 2334, 188);
  for (let i = 0; i < 14; i++) {
    const x = 34 + Math.floor(noise(i, 96, seed) * 15);
    const y = 27 + Math.floor(noise(i, 97, seed) * 15);
    ellipse(t, x, y, 1.1, 1.1, sugar, seed + 2335 + i, 190);
  }
  line(t, 19, 43, 47, 25, 0.8, rust, seed + 2350, 118);
  drawNoiseDust(t, seed + 2351, sugar, 11);
  drawNoiseDust(t, seed + 2352, rust, 8);
}

function drawProteinMoldCakeSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [168, 138, 78];
  const wrapperLight: [number, number, number] = [218, 184, 106];
  const dark: [number, number, number] = [54, 42, 30];
  const cake: [number, number, number] = [88, 122, 58];
  const cakeLight: [number, number, number] = [144, 174, 82];
  const mold: [number, number, number] = [78, 182, 94];
  const red: [number, number, number] = [166, 42, 36];
  const stain: [number, number, number] = [54, 76, 50];
  const rot: [number, number, number] = [92, 58, 34];

  ellipse(t, 33, 52, 17, 4, [12, 14, 10], seed + 2310, 84);
  rect(t, 15, 28, 50, 49, dark, seed + 2311, 218);
  rect(t, 17, 23, 48, 45, wrapper, seed + 2312, 248);
  rect(t, 20, 19, 46, 28, wrapperLight, seed + 2313, 232);
  outlineRect(t, 17, 23, 48, 45, dark);
  clearRect(t, 17, 23, 20, 26);
  clearRect(t, 46, 23, 48, 28);
  clearRect(t, 18, 42, 21, 45);

  rect(t, 22, 29, 44, 43, cake, seed + 2314, 248);
  rect(t, 24, 30, 42, 33, cakeLight, seed + 2315, 168);
  line(t, 22, 40, 44, 32, 1.0, dark, seed + 2316, 138);
  rect(t, 18, 38, 50, 45, stain, seed + 2317, 92);
  rect(t, 33, 22, 47, 29, red, seed + 2318, 192);
  rect(t, 36, 24, 44, 25, wrapperLight, seed + 2319, 170);
  for (const [x, y, r] of [[25, 35, 2.6], [31, 38, 2.2], [38, 34, 2.8], [42, 41, 2.0]] as const) {
    ellipse(t, x, y, r, r * 0.75, mold, seed + x + y, 210);
  }
  line(t, 20, 43, 48, 31, 0.8, rot, seed + 2320, 132);
  drawNoiseDust(t, seed + 2321, mold, 20);
  drawNoiseDust(t, seed + 2322, rot, 12);
}

function drawKashaSprite(t: Uint32Array, seed: number): void {
  const bowl: [number, number, number] = [118, 124, 112];
  const bowlLight: [number, number, number] = [184, 188, 166];
  const bowlDark: [number, number, number] = [38, 44, 40];
  const porridge: [number, number, number] = [190, 166, 98];
  const porridgeLight: [number, number, number] = [230, 204, 128];
  const spoon: [number, number, number] = [174, 178, 158];
  const red: [number, number, number] = [158, 42, 36];
  const damp: [number, number, number] = [64, 86, 60];
  const rust: [number, number, number] = [126, 68, 36];

  ellipse(t, 32, 52, 17, 4, [16, 18, 14], seed + 799, 84);
  ellipse(t, 32, 36, 19, 12, bowlDark, seed + 800, 248);
  ellipse(t, 32, 34, 18, 9, bowlLight, seed + 801, 245);
  ellipse(t, 32, 35, 15, 6.8, porridge, seed + 802, 252);
  ellipse(t, 28, 32, 8, 3.2, porridgeLight, seed + 803, 170);
  rect(t, 17, 36, 47, 48, bowl, seed + 804, 245);
  ellipse(t, 32, 48, 15, 4.8, bowlDark, seed + 805, 170);
  outlineRect(t, 17, 34, 47, 48, bowlDark);
  line(t, 21, 37, 45, 46, 0.9, bowlLight, seed + 806, 112);
  line(t, 25, 23, 37, 41, 1.2, spoon, seed + 807, 235);
  ellipse(t, 24, 22, 4.8, 2.6, spoon, seed + 808, 235);
  rect(t, 36, 42, 49, 47, red, seed + 809, 178);
  rect(t, 39, 44, 46, 45, porridgeLight, seed + 810, 190);
  ellipse(t, 23, 45, 6, 3.2, damp, seed + 811, 112);
  drawNoiseDust(t, seed + 812, rust, 10);
  drawNoiseDust(t, seed + 813, porridgeLight, 12);
}

function drawKulichSprite(t: Uint32Array, seed: number): void {
  const crust: [number, number, number] = [126, 74, 36];
  const crustLight: [number, number, number] = [190, 126, 62];
  const dark: [number, number, number] = [50, 34, 24];
  const icing: [number, number, number] = [224, 218, 178];
  const icingLight: [number, number, number] = [248, 240, 204];
  const red: [number, number, number] = [178, 42, 38];
  const green: [number, number, number] = [70, 132, 82];
  const damp: [number, number, number] = [66, 82, 56];
  const sugar: [number, number, number] = [210, 170, 86];

  ellipse(t, 33, 52, 16, 4, [16, 14, 10], seed + 814, 82);
  rect(t, 20, 28, 45, 49, crust, seed + 815, 250);
  ellipse(t, 32.5, 28, 13.5, 10.5, crustLight, seed + 816, 250);
  outlineRect(t, 20, 29, 45, 49, dark);
  clearRect(t, 20, 29, 23, 32);
  clearRect(t, 43, 30, 45, 34);
  ellipse(t, 32.5, 24, 14, 7, icing, seed + 817, 246);
  ellipse(t, 28, 22, 8, 3.8, icingLight, seed + 818, 170);
  line(t, 23, 28, 26, 36, 2.0, icing, seed + 819, 235);
  line(t, 34, 27, 35, 37, 2.0, icing, seed + 820, 230);
  line(t, 40, 28, 42, 34, 1.7, icing, seed + 821, 220);
  line(t, 31, 18, 31, 29, 1.1, red, seed + 822, 230);
  line(t, 26, 23, 36, 23, 1.1, red, seed + 823, 230);
  for (const [x, y, c] of [[24, 35, red], [30, 39, green], [39, 34, sugar], [36, 44, red], [25, 44, sugar]] as const) {
    ellipse(t, x, y, 1.8, 1.4, c, seed + x + y, 210);
  }
  ellipse(t, 43, 46, 5, 3, damp, seed + 824, 112);
  drawNoiseDust(t, seed + 825, sugar, 12);
  drawNoiseDust(t, seed + 826, damp, 8);
}

function drawSandSpoiledRationSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [152, 126, 78];
  const wrapperLight: [number, number, number] = [208, 188, 126];
  const dark: [number, number, number] = [54, 42, 30];
  const sand: [number, number, number] = [232, 230, 204];
  const sandShadow: [number, number, number] = [184, 178, 150];
  const green: [number, number, number] = [82, 132, 76];
  const red: [number, number, number] = [162, 42, 38];
  const rust: [number, number, number] = [126, 66, 34];

  ellipse(t, 33, 52, 18, 4, [12, 10, 8], seed + 827, 82);
  rect(t, 15, 25, 50, 47, wrapper, seed + 828, 248);
  rect(t, 18, 20, 47, 29, wrapperLight, seed + 829, 232);
  outlineRect(t, 15, 25, 50, 47, dark);
  clearRect(t, 15, 25, 19, 29);
  clearRect(t, 47, 25, 50, 31);
  clearRect(t, 16, 44, 20, 47);
  rect(t, 22, 30, 45, 43, sandShadow, seed + 830, 230);
  rect(t, 23, 28, 43, 39, sand, seed + 831, 238);
  ellipse(t, 31, 34, 10, 5, sand, seed + 832, 244);
  rect(t, 31, 20, 45, 27, red, seed + 833, 210);
  rect(t, 33, 22, 43, 23, sand, 0, 155);
  line(t, 18, 43, 48, 27, 1.1, dark, seed + 834, 135);
  line(t, 42, 40, 54, 50, 2.0, green, seed + 835, 148);
  ellipse(t, 52, 51, 6, 3.5, green, seed + 836, 126);
  for (let i = 0; i < 18; i++) {
    const x = 22 + Math.floor(noise(i, 88, seed) * 23);
    const y = 30 + Math.floor(noise(i, 89, seed) * 12);
    ellipse(t, x, y, 1.2, 0.9, sand, seed + 837 + i, 190);
  }
  drawNoiseDust(t, seed + 856, rust, 11);
  drawNoiseDust(t, seed + 857, sand, 10);
}

function drawRationRegistryExtractSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 96];
  const light: [number, number, number] = [232, 210, 132];
  const ink: [number, number, number] = [28, 24, 18];
  const ration: [number, number, number] = [112, 92, 54];
  const rationLight: [number, number, number] = [178, 150, 78];
  const red: [number, number, number] = [178, 38, 34];
  const green: [number, number, number] = [72, 128, 76];
  const damp: [number, number, number] = [76, 86, 70];
  const ochre: [number, number, number] = [136, 82, 36];

  rect(t, 14, 15, 51, 50, paper, seed + 858, 248);
  rect(t, 17, 18, 48, 23, light, seed + 859, 220);
  outlineRect(t, 14, 15, 51, 50, ink);
  clearRect(t, 14, 15, 18, 18);
  clearRect(t, 49, 16, 51, 21);
  clearRect(t, 15, 47, 19, 50);
  rect(t, 14, 43, 51, 50, damp, seed + 860, 94);
  rect(t, 19, 28, 33, 41, ration, seed + 861, 238);
  rect(t, 20, 29, 32, 31, rationLight, seed + 862, 155);
  line(t, 21, 39, 32, 31, 0.8, ink, seed + 863, 110);
  for (let y = 26; y <= 40; y += 4) {
    rect(t, 36, y, 47 - ((seed + y) & 5), y + 1, ink, 0, 138);
    rect(t, 22, y - 3, 32, y - 2, ink, 0, 102);
  }
  rect(t, 38, 22, 48, 25, green, seed + 864, 190);
  ellipse(t, 42, 36, 7.2, 5.0, red, seed + 865, 214);
  ellipse(t, 42, 36, 3.8, 2.3, paper, seed + 866, 222);
  rect(t, 26, 45, 42, 47, red, seed + 867, 168);
  drawNoiseDust(t, seed + 868, ochre, 12);
  drawNoiseDust(t, seed + 869, green, 7);
}

function drawRationStampPadSprite(t: Uint32Array, seed: number): void {
  const caseDark: [number, number, number] = [28, 24, 22];
  const caseBody: [number, number, number] = [88, 74, 52];
  const lid: [number, number, number] = [150, 120, 62];
  const inkRed: [number, number, number] = [148, 28, 34];
  const inkWet: [number, number, number] = [214, 58, 52];
  const paper: [number, number, number] = [210, 190, 122];
  const green: [number, number, number] = [70, 120, 72];
  const rust: [number, number, number] = [126, 64, 34];

  rect(t, 18, 19, 48, 34, lid, seed + 870, 232);
  rect(t, 21, 22, 45, 25, paper, seed + 871, 190);
  outlineRect(t, 18, 19, 48, 34, caseDark);
  rect(t, 14, 30, 51, 49, caseDark, seed + 872, 246);
  rect(t, 17, 28, 48, 46, caseBody, seed + 873, 248);
  outlineRect(t, 14, 30, 51, 49, caseDark);
  clearRect(t, 14, 30, 18, 33);
  clearRect(t, 49, 31, 51, 35);
  rect(t, 20, 32, 46, 43, inkRed, seed + 874, 246);
  rect(t, 23, 34, 43, 37, inkWet, seed + 875, 155);
  ellipse(t, 38, 38, 6.8, 3.5, inkWet, seed + 876, 126);
  rect(t, 23, 45, 42, 47, green, seed + 877, 178);
  rect(t, 26, 46, 38, 47, paper, seed + 878, 168);
  line(t, 19, 29, 48, 45, 0.8, rust, seed + 879, 118);
  drawNoiseDust(t, seed + 880, rust, 11);
  drawNoiseDust(t, seed + 881, inkWet, 8);
}

function drawRawmeatSprite(t: Uint32Array, seed: number): void {
  const darkMeat: [number, number, number] = [82, 22, 28];
  const meat: [number, number, number] = [148, 42, 46];
  const fresh: [number, number, number] = [202, 76, 68];
  const fat: [number, number, number] = [218, 166, 132];
  const sinew: [number, number, number] = [230, 132, 108];
  const green: [number, number, number] = [68, 116, 64];
  const black: [number, number, number] = [28, 18, 18];

  ellipse(t, 32, 52, 18, 4, black, seed + 882, 84);
  ellipse(t, 29, 35, 17, 11, darkMeat, seed + 883, 248);
  ellipse(t, 35, 34, 18, 12, meat, seed + 884, 252);
  ellipse(t, 24, 39, 10, 7, fresh, seed + 885, 236);
  ellipse(t, 43, 36, 8, 7, darkMeat, seed + 886, 232);
  line(t, 20, 34, 45, 40, 1.8, sinew, seed + 887, 225);
  line(t, 24, 42, 43, 30, 1.2, fat, seed + 888, 218);
  ellipse(t, 34, 36, 5.5, 3.6, fat, seed + 889, 170);
  clearRect(t, 15, 27, 19, 32);
  clearRect(t, 47, 25, 51, 30);
  ellipse(t, 21, 45, 5.2, 3.0, green, seed + 890, 128);
  ellipse(t, 45, 44, 4.8, 2.8, black, seed + 891, 118);
  rect(t, 35, 24, 44, 27, fresh, seed + 892, 174);
  drawNoiseDust(t, seed + 893, fat, 12);
  drawNoiseDust(t, seed + 894, green, 8);
}

function drawRedConcentrateSprite(t: Uint32Array, seed: number): void {
  const wrap: [number, number, number] = [218, 194, 122];
  const wrapLight: [number, number, number] = [244, 226, 158];
  const red: [number, number, number] = [176, 34, 34];
  const redLight: [number, number, number] = [230, 64, 54];
  const dark: [number, number, number] = [58, 26, 24];
  const yellow: [number, number, number] = [224, 162, 46];
  const green: [number, number, number] = [72, 124, 66];
  const rust: [number, number, number] = [126, 62, 34];

  ellipse(t, 33, 53, 17, 4, [10, 8, 6], seed + 896, 82);
  rect(t, 16, 24, 50, 47, dark, seed + 897, 230);
  rect(t, 18, 20, 48, 45, wrap, seed + 898, 246);
  outlineRect(t, 16, 24, 50, 47, dark);
  clearRect(t, 18, 20, 21, 24);
  clearRect(t, 46, 21, 48, 26);
  rect(t, 23, 25, 44, 39, red, seed + 899, 248);
  ellipse(t, 33, 25, 10.8, 4.2, redLight, seed + 900, 205);
  rect(t, 24, 31, 43, 34, redLight, seed + 901, 150);
  rect(t, 23, 39, 44, 43, dark, seed + 902, 118);
  rect(t, 20, 22, 46, 25, wrapLight, seed + 903, 178);
  rect(t, 22, 41, 44, 44, green, seed + 904, 170);
  rect(t, 25, 42, 39, 43, wrapLight, seed + 905, 165);
  rect(t, 26, 27, 41, 29, yellow, seed + 906, 214);
  line(t, 18, 24, 49, 45, 0.8, rust, seed + 907, 118);
  line(t, 21, 37, 46, 35, 0.8, dark, seed + 908, 104);
  drawNoiseDust(t, seed + 909, rust, 11);
  drawNoiseDust(t, seed + 910, redLight, 8);
}

function drawZhelemishRawSprite(t: Uint32Array, seed: number): void {
  const wetDark: [number, number, number] = [28, 58, 42];
  const wet: [number, number, number] = [76, 138, 78];
  const glow: [number, number, number] = [132, 226, 110];
  const bruise: [number, number, number] = [92, 56, 118];
  const warning: [number, number, number] = [174, 42, 36];
  const grit: [number, number, number] = [106, 80, 52];

  ellipse(t, 32, 52, 17, 4, [6, 14, 10], seed + 1760, 86);
  ellipse(t, 30, 34, 19, 13, wetDark, seed + 1761, 248);
  ellipse(t, 32, 32, 17, 10, wet, seed + 1762, 252);
  ellipse(t, 38, 38, 10, 7, bruise, seed + 1763, 202);
  ellipse(t, 27, 29, 9, 6, glow, seed + 1764, 118);
  line(t, 19, 38, 46, 30, 1.0, glow, seed + 1765, 132);
  line(t, 22, 42, 43, 39, 1.0, wetDark, seed + 1766, 170);
  rect(t, 18, 41, 29, 46, warning, seed + 1767, 168);
  rect(t, 20, 43, 27, 44, glow, seed + 1768, 110);
  for (let i = 0; i < 8; i++) {
    const x = 20 + Math.floor(noise(i, 91, seed) * 26);
    const y = 27 + Math.floor(noise(i, 92, seed) * 20);
    ellipse(t, x, y, 1.4, 1.0, i & 1 ? warning : grit, seed + 1769 + i, 155);
  }
  drawNoiseDust(t, seed + 1778, glow, 16);
  drawNoiseDust(t, seed + 1779, grit, 10);
}

function drawZhelemishDriedSprite(t: Uint32Array, seed: number): void {
  const hideDark: [number, number, number] = [54, 34, 24];
  const hide: [number, number, number] = [112, 72, 42];
  const hideLight: [number, number, number] = [178, 122, 66];
  const twine: [number, number, number] = [190, 154, 92];
  const paper: [number, number, number] = [172, 150, 98];
  const oldGreen: [number, number, number] = [70, 112, 68];
  const rust: [number, number, number] = [124, 60, 34];

  ellipse(t, 32, 52, 17, 4, [12, 8, 6], seed + 1780, 82);
  line(t, 18, 40, 43, 23, 8.4, hideDark, seed + 1781, 244);
  line(t, 19, 38, 43, 24, 6.0, hide, seed + 1782, 252);
  line(t, 23, 35, 42, 26, 1.2, hideLight, seed + 1783, 150);
  line(t, 19, 42, 47, 28, 1.0, hideDark, seed + 1784, 150);
  line(t, 24, 43, 39, 23, 1.2, twine, seed + 1785, 210);
  line(t, 31, 45, 46, 29, 1.0, twine, seed + 1786, 196);
  rect(t, 39, 37, 50, 43, paper, seed + 1787, 202);
  rect(t, 41, 39, 48, 40, hideDark, 0, 135);
  rect(t, 18, 29, 26, 33, oldGreen, seed + 1788, 126);
  line(t, 21, 44, 43, 26, 0.8, rust, seed + 1789, 145);
  clearRect(t, 13, 34, 16, 39);
  clearRect(t, 44, 20, 48, 24);
  drawNoiseDust(t, seed + 1790, hideLight, 12);
  drawNoiseDust(t, seed + 1791, rust, 11);
}

function drawSoupCubeSprite(t: Uint32Array, seed: number): void {
  const wrapper: [number, number, number] = [184, 150, 82];
  const wrapperLight: [number, number, number] = [230, 202, 126];
  const cube: [number, number, number] = [134, 88, 42];
  const cubeLight: [number, number, number] = [210, 142, 58];
  const dark: [number, number, number] = [58, 40, 24];
  const green: [number, number, number] = [72, 126, 68];
  const red: [number, number, number] = [168, 42, 36];
  const grime: [number, number, number] = [116, 62, 34];

  ellipse(t, 32, 52, 16, 4, [14, 12, 8], seed + 2794, 84);
  rect(t, 17, 28, 49, 47, dark, seed + 2795, 218);
  rect(t, 18, 24, 47, 43, wrapper, seed + 2796, 246);
  rect(t, 21, 20, 45, 29, wrapperLight, seed + 2797, 228);
  rect(t, 22, 27, 45, 31, wrapper, seed + 2809, 182);
  outlineRect(t, 18, 24, 47, 43, dark);
  clearRect(t, 18, 24, 21, 27);
  clearRect(t, 45, 24, 47, 29);
  clearRect(t, 19, 40, 22, 43);
  rect(t, 23, 21, 43, 24, wrapper, seed + 2811, 174);
  rect(t, 24, 29, 43, 42, cube, seed + 2798, 248);
  rect(t, 25, 30, 42, 33, cubeLight, seed + 2799, 170);
  rect(t, 26, 34, 44, 37, cubeLight, seed + 2810, 158);
  line(t, 24, 40, 43, 32, 1.0, dark, seed + 2800, 130);
  rect(t, 20, 25, 34, 28, red, seed + 2801, 205);
  rect(t, 22, 26, 31, 27, wrapperLight, seed + 2802, 170);
  rect(t, 36, 34, 46, 39, green, seed + 2803, 190);
  rect(t, 38, 36, 43, 37, wrapperLight, seed + 2804, 156);
  line(t, 19, 42, 47, 25, 0.8, grime, seed + 2805, 128);
  ellipse(t, 24, 41, 5.2, 2.8, green, seed + 2806, 106);
  drawNoiseDust(t, seed + 2807, grime, 12);
  drawNoiseDust(t, seed + 2808, cubeLight, 8);
}

function drawFoodSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'soup_cube') {
    drawSoupCubeSprite(t, seed);
    return;
  }
  if (defId === 'water_coupon') {
    drawWaterCouponSprite(t, seed);
    return;
  }
  if (defId === 'water_reservoir_quota') {
    drawWaterReservoirQuotaSprite(t, seed);
    return;
  }
  if (defId === 'ration_registry_extract') {
    drawRationRegistryExtractSprite(t, seed);
    return;
  }
  if (defId === 'ration_stamp_pad') {
    drawRationStampPadSprite(t, seed);
    return;
  }
  if (defId === 'rawmeat') {
    drawRawmeatSprite(t, seed);
    return;
  }
  if (defId === 'red_concentrate') {
    drawRedConcentrateSprite(t, seed);
    return;
  }
  if (defId === 'sand_spoiled_ration') {
    drawSandSpoiledRationSprite(t, seed);
    return;
  }
  if (defId === 'kasha') {
    drawKashaSprite(t, seed);
    return;
  }
  if (defId === 'kulich') {
    drawKulichSprite(t, seed);
    return;
  }
  if (defId === 'infected_mushroom') {
    drawInfectedMushroomSprite(t, seed);
    return;
  }
  if (defId === 'mushroom_mass') {
    drawMushroomMassSprite(t, seed);
    return;
  }
  if (defId === 'bread') {
    drawBreadSprite(t, seed);
    return;
  }
  if (defId === 'yeast_bread') {
    drawYeastBreadSprite(t, seed);
    return;
  }
  if (defId === 'canned') {
    drawCannedFoodSprite(t, seed);
    return;
  }
  if (defId === 'pearl_barley') {
    drawPearlBarleySprite(t, seed);
    return;
  }
  if (defId === 'concentrate_coupon' || defId === 'concentrate_bonus_coupon') {
    drawConcentrateCouponSprite(t, seed, defId === 'concentrate_bonus_coupon');
    return;
  }
  if (defId === 'forged_ration_card') {
    drawForgedRationCardSprite(t, seed);
    return;
  }
  if (defId === 'experimental_concentrate') {
    drawExperimentalConcentrateSprite(t, seed);
    return;
  }
  if (defId === 'grey_briquette') {
    drawGreyBriquetteSprite(t, seed);
    return;
  }
  if (defId === 'green_briquette') {
    drawGreenBriquetteSprite(t, seed);
    return;
  }
  if (defId === 'easter_egg') {
    drawEasterEggSprite(t, seed);
    return;
  }
  if (defId === 'liquidator_ration') {
    drawLiquidatorRationSprite(t, seed);
    return;
  }
  if (defId === 'pressed_sugar') {
    drawPressedSugarSprite(t, seed);
    return;
  }
  if (defId === 'sugar_pack') {
    drawSugarPackSprite(t, seed);
    return;
  }
  if (defId === 'protein_mold_cake') {
    drawProteinMoldCakeSprite(t, seed);
    return;
  }
  if (defId === 'zhelemish_raw') {
    drawZhelemishRawSprite(t, seed);
    return;
  }
  if (defId === 'zhelemish_dried') {
    drawZhelemishDriedSprite(t, seed);
    return;
  }
  if (defId.includes('meat') || defId.includes('red')) {
    ellipse(t, 32, 35, 16, 11, [150, 48, 46], seed + 11);
    line(t, 23, 34, 41, 39, 1.4, [220, 132, 108], seed + 12, 220);
  } else if (defId.includes('mushroom') || defId.includes('zhelemish') || defId.includes('mold')) {
    ellipse(t, 32, 28, 18, 8, [112, 132, 72], seed + 13);
    rect(t, 27, 28, 37, 48, [114, 96, 78], seed + 14);
    drawNoiseDust(t, seed + 15, p.glow, 14);
  } else if (defId.includes('canned') || defId.includes('barley')) {
    rect(t, 20, 23, 44, 49, [118, 124, 116], seed + 16);
    ellipse(t, 32, 23, 13, 5, [160, 166, 150], seed + 17);
    rect(t, 22, 33, 42, 40, p.accent, seed + 18, 235);
  } else {
    const briquette = defId.includes('concentrate') || defId.includes('briquette') || defId.includes('cube');
    rect(t, briquette ? 19 : 17, briquette ? 27 : 29, briquette ? 45 : 47, briquette ? 45 : 48, p.body, seed + 19);
    rect(t, 20, 25, 44, 29, p.light, seed + 20);
    line(t, 20, 38, 44, 35, 1.2, p.dark, seed + 21, 145);
  }
}

function drawBragaBucketSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [88, 104, 96];
  const metalLight: [number, number, number] = [156, 174, 158];
  const metalDark: [number, number, number] = [28, 38, 36];
  const brew: [number, number, number] = [82, 158, 126];
  const brewFoam: [number, number, number] = [184, 218, 170];
  const label: [number, number, number] = [174, 126, 56];
  const rust: [number, number, number] = [132, 68, 38];
  const stain: [number, number, number] = [42, 60, 48];

  ellipse(t, 32, 53, 17, 4, stain, seed + 720, 92);
  line(t, 21, 22, 31, 10, 1.3, metalLight, seed + 721, 220);
  line(t, 43, 22, 33, 10, 1.3, metalDark, seed + 722, 215);
  ellipse(t, 32, 12, 3.2, 2.3, rust, seed + 723, 220);
  rect(t, 19, 25, 45, 50, metal, seed + 724, 246);
  ellipse(t, 32, 25, 14, 5.3, metalLight, seed + 725, 252);
  ellipse(t, 32, 27, 12, 3.8, brew, seed + 726, 230);
  ellipse(t, 32, 50, 13, 4, metalDark, seed + 727, 170);
  outlineRect(t, 19, 25, 45, 50, metalDark);
  rect(t, 22, 34, 42, 42, label, seed + 728, 230);
  rect(t, 25, 36, 38, 37, metalDark, seed + 729, 145);
  rect(t, 26, 40, 36, 41, brewFoam, seed + 730, 170);
  line(t, 22, 29, 22, 47, 0.8, metalLight, seed + 731, 130);
  line(t, 43, 29, 44, 47, 0.8, metalDark, seed + 732, 135);
  ellipse(t, 38, 28, 4.5, 2.2, brewFoam, seed + 733, 160);
  ellipse(t, 26, 49, 5.5, 2.5, brew, seed + 734, 135);
  rect(t, 42, 31, 48, 35, rust, seed + 735, 150);
  drawNoiseDust(t, seed + 736, rust, 10);
  drawNoiseDust(t, seed + 737, brewFoam, 13);
}

function drawCalmBrewSprite(t: Uint32Array, seed: number): void {
  const enamel: [number, number, number] = [168, 178, 154];
  const enamelLight: [number, number, number] = [226, 226, 188];
  const enamelDark: [number, number, number] = [56, 72, 66];
  const brew: [number, number, number] = [74, 154, 110];
  const brewLight: [number, number, number] = [132, 218, 158];
  const red: [number, number, number] = [172, 44, 42];
  const rust: [number, number, number] = [128, 68, 38];
  const steam: [number, number, number] = [188, 226, 196];

  ellipse(t, 32, 52, 15, 3.5, [22, 28, 22], seed + 750, 82);
  line(t, 25, 16, 21, 8, 0.8, steam, seed + 751, 125);
  line(t, 33, 15, 35, 6, 0.8, steam, seed + 752, 135);
  line(t, 40, 17, 45, 10, 0.8, steam, seed + 753, 115);
  rect(t, 21, 25, 43, 48, enamel, seed + 754, 248);
  ellipse(t, 32, 25, 12, 5, enamelLight, seed + 755, 248);
  ellipse(t, 32, 27, 10, 3.2, brew, seed + 756, 226);
  ellipse(t, 32, 48, 11, 4, enamelDark, seed + 757, 165);
  outlineRect(t, 21, 25, 43, 48, enamelDark);
  ellipse(t, 45, 36, 7, 8, enamelDark, seed + 758, 235);
  ellipse(t, 45, 36, 4, 5, [0, 0, 0], 0, 0);
  rect(t, 25, 34, 39, 40, [202, 198, 158], seed + 759, 225);
  rect(t, 30, 32, 34, 43, red, seed + 760, 230);
  rect(t, 26, 36, 39, 39, red, seed + 761, 230);
  line(t, 23, 30, 23, 46, 0.8, enamelLight, seed + 762, 120);
  ellipse(t, 29, 28, 4, 1.7, brewLight, seed + 763, 150);
  ellipse(t, 37, 27, 3, 1.5, brewLight, seed + 764, 130);
  rect(t, 39, 43, 45, 46, rust, seed + 765, 140);
  drawNoiseDust(t, seed + 766, rust, 9);
  drawNoiseDust(t, seed + 767, brewLight, 9);
}

function drawHeatingElementSprite(t: Uint32Array, seed: number): void {
  const copper: [number, number, number] = [188, 96, 42];
  const copperLight: [number, number, number] = [238, 154, 72];
  const ceramic: [number, number, number] = [198, 190, 154];
  const ceramicDark: [number, number, number] = [72, 74, 66];
  const plug: [number, number, number] = [32, 40, 42];
  const cyan: [number, number, number] = [74, 212, 216];
  const rust: [number, number, number] = [124, 64, 34];
  const stain: [number, number, number] = [34, 48, 44];

  ellipse(t, 33, 52, 16, 4, stain, seed + 768, 84);
  rect(t, 15, 39, 27, 48, ceramic, seed + 769, 238);
  rect(t, 39, 18, 50, 27, ceramic, seed + 770, 238);
  outlineRect(t, 15, 39, 27, 48, ceramicDark);
  outlineRect(t, 39, 18, 50, 27, ceramicDark);
  rect(t, 17, 41, 25, 43, plug, seed + 771, 215);
  rect(t, 41, 22, 49, 24, plug, seed + 772, 215);

  line(t, 23, 40, 18, 30, 2.0, copper, seed + 773, 246);
  line(t, 18, 30, 25, 20, 2.0, copperLight, seed + 774, 246);
  line(t, 25, 20, 33, 32, 2.0, copper, seed + 775, 246);
  line(t, 33, 32, 41, 18, 2.0, copperLight, seed + 776, 246);
  line(t, 21, 37, 27, 28, 1.1, cyan, seed + 777, 160);
  line(t, 29, 25, 37, 31, 1.1, cyan, seed + 778, 150);
  line(t, 20, 48, 16, 54, 1.1, plug, seed + 779, 220);
  line(t, 47, 18, 55, 12, 1.1, plug, seed + 780, 215);
  ellipse(t, 31, 29, 4.5, 3.0, cyan, seed + 781, 130);
  ellipse(t, 41, 31, 3.5, 2.4, cyan, seed + 782, 105);
  rect(t, 41, 25, 49, 27, rust, seed + 783, 145);
  drawNoiseDust(t, seed + 784, rust, 10);
  drawNoiseDust(t, seed + 785, cyan, 8);
}

function drawMoonshineStillPartSprite(t: Uint32Array, seed: number): void {
  const copper: [number, number, number] = [178, 92, 42];
  const copperLight: [number, number, number] = [236, 146, 66];
  const copperDark: [number, number, number] = [76, 40, 26];
  const glass: [number, number, number] = [84, 132, 120];
  const glassLight: [number, number, number] = [172, 226, 196];
  const brew: [number, number, number] = [54, 174, 156];
  const label: [number, number, number] = [194, 164, 84];
  const red: [number, number, number] = [166, 42, 34];
  const grime: [number, number, number] = [42, 58, 44];
  const verdigris: [number, number, number] = [60, 152, 116];

  ellipse(t, 33, 53, 18, 4, grime, seed + 812, 86);
  line(t, 17, 42, 31, 25, 5.4, copperDark, seed + 813, 248);
  line(t, 19, 41, 31, 26, 3.4, copper, seed + 814, 252);
  line(t, 30, 26, 49, 28, 5.0, copperDark, seed + 815, 248);
  line(t, 31, 27, 48, 29, 3.2, copperLight, seed + 816, 245);
  ellipse(t, 30, 26, 6.2, 6.2, copperDark, seed + 817, 245);
  ellipse(t, 31, 27, 3.2, 3.2, [24, 18, 14], seed + 818, 235);
  rect(t, 44, 25, 52, 31, copper, seed + 819, 240);
  rect(t, 45, 27, 51, 28, verdigris, seed + 820, 180);

  rect(t, 22, 29, 43, 51, glass, seed + 821, 126);
  ellipse(t, 32, 29, 11, 4.5, glassLight, seed + 822, 150);
  ellipse(t, 32, 51, 11, 3.5, copperDark, seed + 823, 130);
  outlineRect(t, 22, 29, 43, 51, copperDark);
  rect(t, 24, 38, 41, 49, brew, seed + 824, 205);
  line(t, 24, 38, 40, 36, 1.1, glassLight, seed + 825, 170);
  rect(t, 24, 31, 41, 37, label, seed + 826, 224);
  rect(t, 27, 33, 38, 34, copperDark, 0, 132);
  rect(t, 29, 35, 36, 36, red, seed + 827, 198);
  line(t, 26, 30, 25, 49, 0.8, glassLight, seed + 828, 130);
  line(t, 40, 29, 42, 49, 0.8, copperDark, seed + 829, 130);
  line(t, 18, 42, 43, 30, 0.9, verdigris, seed + 830, 130);
  rect(t, 39, 46, 46, 50, copperDark, seed + 831, 150);
  drawNoiseDust(t, seed + 832, verdigris, 14);
  drawNoiseDust(t, seed + 833, copperLight, 8);
  px(t, 23, 29, CLEAR);
  px(t, 42, 50, CLEAR);
}

function drawInstantCoffeeSprite(t: Uint32Array, seed: number): void {
  const tin: [number, number, number] = [82, 86, 78];
  const tinLight: [number, number, number] = [156, 158, 134];
  const dark: [number, number, number] = [26, 20, 16];
  const coffee: [number, number, number] = [74, 44, 24];
  const label: [number, number, number] = [186, 126, 46];
  const red: [number, number, number] = [164, 40, 34];
  const paper: [number, number, number] = [212, 198, 138];
  const rust: [number, number, number] = [126, 68, 38];

  ellipse(t, 32, 52, 15, 3.5, [16, 14, 12], seed + 786, 86);
  rect(t, 22, 18, 43, 49, tin, seed + 787, 248);
  ellipse(t, 32, 18, 11, 4.5, tinLight, seed + 788, 245);
  ellipse(t, 32, 21, 9, 2.6, dark, seed + 789, 225);
  ellipse(t, 32, 49, 10, 4, [34, 38, 34], seed + 790, 190);
  outlineRect(t, 22, 18, 43, 49, dark);

  rect(t, 24, 29, 41, 40, label, seed + 791, 232);
  rect(t, 26, 31, 39, 33, paper, seed + 792, 195);
  rect(t, 28, 36, 37, 38, red, seed + 793, 218);
  for (let i = 0; i < 13; i++) {
    const x = 25 + Math.floor(noise(i, 70, seed) * 15);
    const y = 21 + Math.floor(noise(i, 71, seed) * 6);
    ellipse(t, x, y, 1.1, 0.8, coffee, seed + 794 + i, 200);
  }
  line(t, 23, 23, 42, 47, 0.8, tinLight, seed + 808, 110);
  rect(t, 38, 20, 44, 25, rust, seed + 809, 145);
  ellipse(t, 25, 47, 5, 2.8, coffee, seed + 810, 125);
  drawNoiseDust(t, seed + 811, rust, 8);
}

function drawKompotSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [96, 128, 122];
  const glassLight: [number, number, number] = [176, 216, 198];
  const glassDark: [number, number, number] = [28, 46, 42];
  const liquid: [number, number, number] = [136, 42, 52];
  const liquidLight: [number, number, number] = [210, 74, 68];
  const label: [number, number, number] = [206, 184, 108];
  const labelLight: [number, number, number] = [236, 214, 140];
  const cyan: [number, number, number] = [74, 184, 176];
  const rust: [number, number, number] = [124, 68, 38];
  const stain: [number, number, number] = [50, 70, 58];

  ellipse(t, 33, 53, 14, 3.5, stain, seed + 321, 86);
  rect(t, 28, 9, 37, 15, glassDark, seed + 322, 246);
  rect(t, 29, 14, 36, 24, glassLight, seed + 323, 172);
  ellipse(t, 32.5, 24, 12, 5, glassLight, seed + 324, 180);
  rect(t, 22, 25, 43, 51, glass, seed + 325, 145);
  rect(t, 18, 29, 23, 49, glass, seed + 320, 138);
  rect(t, 42, 30, 47, 48, glass, seed + 319, 132);
  outlineRect(t, 22, 25, 43, 51, glassDark);
  ellipse(t, 32.5, 51, 11, 4, glassDark, seed + 326, 135);
  rect(t, 24, 34, 41, 49, liquid, seed + 327, 214);
  line(t, 24, 34, 41, 32, 1.1, liquidLight, seed + 328, 190);
  ellipse(t, 34, 42, 5, 2.8, liquidLight, seed + 329, 110);
  rect(t, 24, 28, 41, 35, label, seed + 330, 236);
  rect(t, 26, 30, 37, 31, labelLight, seed + 331, 210);
  rect(t, 28, 33, 38, 34, glassDark, seed + 332, 130);
  rect(t, 38, 26, 45, 33, cyan, seed + 333, 170);
  line(t, 39, 27, 44, 32, 0.8, glassDark, seed + 334, 135);
  line(t, 27, 27, 26, 48, 0.8, glassLight, seed + 335, 145);
  line(t, 38, 23, 40, 48, 0.8, glassDark, seed + 336, 130);
  rect(t, 24, 44, 42, 46, liquidLight, seed + 337, 120);
  drawNoiseDust(t, seed + 338, rust, 8);
  drawNoiseDust(t, seed + 339, cyan, 8);
  px(t, 31, 12, rgba(226, 236, 206, 180));
  px(t, 25, 45, rgba(224, 92, 76, 165));
  px(t, 42, 26, CLEAR);
  px(t, 43, 26, CLEAR);
}

function drawPumpImpellerSprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [92, 112, 112];
  const wornSteel: [number, number, number] = [126, 138, 132];
  const steelLight: [number, number, number] = [172, 186, 172];
  const steelDark: [number, number, number] = [26, 38, 40];
  const water: [number, number, number] = [58, 172, 178];
  const cyan: [number, number, number] = [124, 226, 210];
  const rust: [number, number, number] = [132, 66, 34];
  const red: [number, number, number] = [170, 42, 34];

  ellipse(t, 33, 52, 17, 4, [8, 12, 12], seed + 820, 82);
  ellipse(t, 32, 33, 20, 18, water, seed + 821, 60);
  ellipse(t, 32, 34, 15, 13, cyan, seed + 822, 38);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const x0 = 32 + Math.cos(a) * 5.5;
    const y0 = 33 + Math.sin(a) * 5.5;
    const x1 = 32 + Math.cos(a) * 20;
    const y1 = 33 + Math.sin(a) * 15;
    line(t, x0, y0, x1, y1, 4.4, steelDark, seed + 823 + i, 246);
    line(t, x0 + Math.sin(a) * 1.6, y0 - Math.cos(a) * 1.6, x1 + Math.sin(a) * 3.0, y1 - Math.cos(a) * 2.1, 3.3, steel, seed + 831 + i, 246);
    line(t, x0 - Math.sin(a) * 1.2, y0 + Math.cos(a) * 1.2, x1 - Math.sin(a) * 1.8, y1 + Math.cos(a) * 1.5, 2.0, wornSteel, seed + 839 + i, 226);
    line(t, x0 - Math.sin(a) * 1.8, y0 + Math.cos(a) * 1.8, x1 - Math.sin(a) * 2.6, y1 + Math.cos(a) * 2.4, 0.9, steelLight, seed + 857 + i, 195);
  }
  ellipse(t, 32, 33, 8.8, 8.8, steelDark, seed + 848, 252);
  ellipse(t, 32, 33, 5.0, 5.0, steelLight, seed + 849, 238);
  ellipse(t, 32, 33, 2.2, 2.2, [8, 10, 10], seed + 850, 245);
  rect(t, 41, 41, 52, 46, red, seed + 851, 190);
  rect(t, 43, 43, 50, 44, steelLight, seed + 852, 170);
  line(t, 19, 48, 47, 18, 1.0, rust, seed + 853, 145);
  line(t, 16, 36, 49, 47, 1.1, water, seed + 854, 128);
  drawNoiseDust(t, seed + 855, rust, 13);
  drawNoiseDust(t, seed + 856, cyan, 11);
}

function drawRubberTubeSprite(t: Uint32Array, seed: number): void {
  const rubberDark: [number, number, number] = [18, 24, 22];
  const rubber: [number, number, number] = [46, 66, 58];
  const wet: [number, number, number] = [74, 190, 174];
  const wetLight: [number, number, number] = [150, 238, 208];
  const clampMetal: [number, number, number] = [132, 148, 138];
  const label: [number, number, number] = [184, 154, 82];
  const red: [number, number, number] = [164, 40, 36];
  const grime: [number, number, number] = [34, 48, 40];
  const rust: [number, number, number] = [122, 62, 34];

  ellipse(t, 32, 53, 18, 4, grime, seed + 858, 84);
  line(t, 17, 44, 18, 30, 4.4, rubberDark, seed + 859, 248);
  line(t, 18, 30, 29, 20, 4.4, rubberDark, seed + 860, 248);
  line(t, 29, 20, 41, 22, 4.4, rubberDark, seed + 861, 248);
  line(t, 41, 22, 50, 34, 4.4, rubberDark, seed + 862, 248);
  line(t, 50, 34, 46, 46, 4.4, rubberDark, seed + 863, 248);
  line(t, 18, 43, 19, 31, 2.4, rubber, seed + 864, 245);
  line(t, 20, 31, 30, 23, 2.4, rubber, seed + 865, 245);
  line(t, 30, 23, 40, 24, 2.4, rubber, seed + 866, 245);
  line(t, 40, 24, 47, 35, 2.4, rubber, seed + 867, 245);
  line(t, 47, 35, 44, 45, 2.4, rubber, seed + 868, 245);
  rect(t, 15, 41, 23, 46, clampMetal, seed + 869, 226);
  rect(t, 42, 43, 50, 48, clampMetal, seed + 870, 226);
  rect(t, 16, 43, 22, 44, red, seed + 871, 180);
  rect(t, 43, 45, 49, 46, label, seed + 872, 185);
  ellipse(t, 32, 38, 10, 7, wet, seed + 873, 128);
  ellipse(t, 32, 38, 5.5, 3.5, wetLight, seed + 874, 124);
  line(t, 22, 30, 44, 42, 1.0, wetLight, seed + 875, 130);
  line(t, 24, 22, 46, 36, 0.8, wet, seed + 876, 112);
  drawNoiseDust(t, seed + 877, rust, 9);
  drawNoiseDust(t, seed + 878, wetLight, 10);
}

function drawSirenEnergySprite(t: Uint32Array, seed: number): void {
  const can: [number, number, number] = [54, 82, 88];
  const canDark: [number, number, number] = [18, 28, 32];
  const canLight: [number, number, number] = [142, 176, 168];
  const cyan: [number, number, number] = [72, 204, 202];
  const green: [number, number, number] = [78, 170, 102];
  const red: [number, number, number] = [190, 38, 36];
  const paper: [number, number, number] = [220, 196, 120];
  const rust: [number, number, number] = [124, 68, 38];

  ellipse(t, 32, 53, 13, 3.5, [8, 12, 12], seed + 388, 86);
  rect(t, 22, 15, 43, 49, can, seed + 389, 246);
  ellipse(t, 32.5, 15, 11, 4, canLight, seed + 390, 226);
  ellipse(t, 32.5, 49, 11, 4, canDark, seed + 391, 150);
  outlineRect(t, 22, 15, 43, 49, canDark);
  rect(t, 25, 27, 40, 39, paper, seed + 392, 238);
  rect(t, 26, 29, 39, 34, red, seed + 393, 226);
  line(t, 32, 25, 32, 42, 1.0, red, seed + 394, 210);
  line(t, 26, 34, 39, 34, 1.0, red, seed + 395, 210);
  rect(t, 27, 37, 38, 38, canDark, 0, 140);
  rect(t, 24, 40, 41, 47, cyan, seed + 396, 190);
  line(t, 24, 40, 41, 38, 1.0, green, seed + 397, 170);
  ellipse(t, 35, 43, 5.8, 2.8, cyan, seed + 398, 128);
  line(t, 26, 18, 26, 47, 0.8, canLight, seed + 399, 140);
  line(t, 40, 18, 41, 47, 0.8, canDark, seed + 400, 150);
  rect(t, 28, 12, 38, 16, canDark, seed + 401, 220);
  rect(t, 30, 10, 36, 12, canLight, seed + 402, 190);
  drawNoiseDust(t, seed + 403, rust, 7);
  drawNoiseDust(t, seed + 404, cyan, 9);
}

function drawTeaSprite(t: Uint32Array, seed: number): void {
  const enamel: [number, number, number] = [174, 180, 156];
  const enamelLight: [number, number, number] = [230, 226, 186];
  const enamelDark: [number, number, number] = [54, 64, 58];
  const tea: [number, number, number] = [124, 74, 34];
  const teaLight: [number, number, number] = [188, 130, 62];
  const red: [number, number, number] = [168, 42, 38];
  const string: [number, number, number] = [210, 198, 142];
  const rust: [number, number, number] = [126, 66, 38];
  const damp: [number, number, number] = [54, 74, 60];

  ellipse(t, 32, 52, 15, 4, [14, 16, 12], seed + 421, 82);
  ellipse(t, 32, 28, 16, 6.5, enamelDark, seed + 422, 245);
  ellipse(t, 32, 27, 14, 5.0, enamelLight, seed + 423, 250);
  ellipse(t, 32, 28, 11, 3.7, tea, seed + 424, 245);
  ellipse(t, 29, 27, 5.5, 1.8, teaLight, seed + 425, 150);
  rect(t, 18, 29, 46, 48, enamel, seed + 426, 248);
  ellipse(t, 32, 48, 14, 5, enamelDark, seed + 427, 150);
  outlineRect(t, 18, 29, 46, 48, enamelDark);
  line(t, 21, 32, 21, 45, 0.9, enamelLight, seed + 428, 150);
  line(t, 44, 31, 45, 45, 0.9, enamelDark, seed + 429, 138);
  arcLine(t, 47, 37, 7.5, 8.5, -1.15, 1.12, 2.0, enamelDark, seed + 430, 235, 12);
  arcLine(t, 47, 37, 5.2, 6.0, -1.05, 1.02, 1.1, enamelLight, seed + 431, 205, 10);
  rect(t, 24, 36, 41, 42, red, seed + 432, 205);
  rect(t, 26, 38, 38, 39, enamelLight, seed + 433, 170);
  line(t, 33, 28, 42, 43, 0.8, string, seed + 434, 185);
  rect(t, 40, 43, 47, 49, string, seed + 435, 205);
  rect(t, 42, 45, 46, 46, red, seed + 436, 175);
  ellipse(t, 25, 49, 6, 3, damp, seed + 437, 110);
  drawNoiseDust(t, seed + 438, rust, 8);
  drawNoiseDust(t, seed + 439, teaLight, 10);
}

function drawTechnicalSpiritSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [78, 126, 122];
  const glassLight: [number, number, number] = [174, 230, 210];
  const glassDark: [number, number, number] = [22, 38, 38];
  const spirit: [number, number, number] = [80, 196, 202];
  const spiritLight: [number, number, number] = [158, 242, 226];
  const red: [number, number, number] = [178, 38, 34];
  const paper: [number, number, number] = [210, 192, 122];
  const seal: [number, number, number] = [42, 46, 40];
  const rust: [number, number, number] = [126, 66, 38];
  const stain: [number, number, number] = [48, 72, 64];

  ellipse(t, 33, 52, 13, 3.5, stain, seed + 440, 86);
  rect(t, 28, 8, 38, 15, seal, seed + 441, 248);
  rect(t, 30, 14, 36, 25, glassLight, seed + 442, 160);
  ellipse(t, 33, 25, 11.5, 5.0, glassLight, seed + 443, 172);
  rect(t, 22, 26, 44, 51, glass, seed + 444, 138);
  outlineRect(t, 22, 26, 44, 51, glassDark);
  ellipse(t, 33, 51, 11.5, 4.0, glassDark, seed + 445, 130);
  rect(t, 24, 34, 42, 49, spirit, seed + 446, 205);
  line(t, 24, 34, 42, 32, 1.1, spiritLight, seed + 447, 205);
  line(t, 27, 27, 26, 48, 0.8, glassLight, seed + 448, 145);
  line(t, 39, 24, 41, 48, 0.8, glassDark, seed + 449, 135);
  rect(t, 24, 28, 42, 36, paper, seed + 450, 232);
  rect(t, 29, 29, 35, 35, red, seed + 451, 235);
  rect(t, 25, 32, 41, 33, red, seed + 452, 220);
  rect(t, 38, 23, 46, 30, red, seed + 453, 180);
  rect(t, 39, 25, 45, 26, paper, seed + 454, 172);
  line(t, 22, 47, 43, 30, 0.8, rust, seed + 455, 122);
  ellipse(t, 44, 47, 5.5, 2.5, spiritLight, seed + 456, 108);
  drawNoiseDust(t, seed + 457, rust, 8);
  drawNoiseDust(t, seed + 458, spiritLight, 12);
  px(t, 32, 11, rgba(220, 242, 220, 180));
  px(t, 25, 45, rgba(168, 242, 226, 155));
}

function drawDrinkSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'water') {
    drawWaterBottleSprite(t, seed);
    return;
  }
  if (defId === 'water_filter_regulator') {
    drawWaterFilterRegulatorSprite(t, seed);
    return;
  }
  if (defId === 'water_reservoir_sample') {
    drawWaterReservoirSampleSprite(t, seed);
    return;
  }
  if (defId === 'tea') {
    drawTeaSprite(t, seed);
    return;
  }
  if (defId === 'technical_spirit') {
    drawTechnicalSpiritSprite(t, seed);
    return;
  }
  if (defId === 'siren_energy') {
    drawSirenEnergySprite(t, seed);
    return;
  }
  if (defId === 'rubber_tube') {
    drawRubberTubeSprite(t, seed);
    return;
  }
  if (defId === 'pump_impeller') {
    drawPumpImpellerSprite(t, seed);
    return;
  }
  if (defId === 'kompot') {
    drawKompotSprite(t, seed);
    return;
  }
  if (defId === 'instant_coffee') {
    drawInstantCoffeeSprite(t, seed);
    return;
  }
  if (defId === 'boiler_water') {
    drawBoilerWaterSprite(t, seed);
    return;
  }
  if (defId === 'metal_water') {
    drawMetalWaterSprite(t, seed);
    return;
  }
  if (defId === 'filtered_water') {
    drawFilteredWaterSprite(t, seed);
    return;
  }
  if (defId === 'bottle_empty') {
    drawEmptyBottleSprite(t, seed);
    return;
  }
  if (defId === 'braga_bucket') {
    drawBragaBucketSprite(t, seed);
    return;
  }
  if (defId === 'calm_brew') {
    drawCalmBrewSprite(t, seed);
    return;
  }
  if (defId === 'heating_element') {
    drawHeatingElementSprite(t, seed);
    return;
  }
  if (defId === 'moonshine_still_part') {
    drawMoonshineStillPartSprite(t, seed);
    return;
  }
  const can = defId.includes('coffee') || defId.includes('energy') || defId.includes('kompot');
  if (can) {
    rect(t, 23, 16, 41, 50, p.body, seed + 31);
    ellipse(t, 32, 16, 10, 4, p.light, seed + 32);
    rect(t, 25, 28, 39, 37, p.accent, seed + 33);
  } else {
    rect(t, 27, 13, 37, 23, p.light, seed + 34, 210);
    rect(t, 23, 23, 41, 51, p.body, seed + 35, 218);
    ellipse(t, 32, 24, 10, 4, p.light, seed + 36, 225);
    rect(t, 25, 32, 39, 39, p.accent, seed + 37, 190);
  }
}

function drawBoilerWaterSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [78, 108, 100];
  const glassLight: [number, number, number] = [152, 190, 176];
  const glassDark: [number, number, number] = [30, 42, 38];
  const hotWater: [number, number, number] = [62, 166, 178];
  const hotWaterLight: [number, number, number] = [128, 222, 208];
  const label: [number, number, number] = [176, 62, 42];
  const limescale: [number, number, number] = [208, 196, 132];
  const rust: [number, number, number] = [132, 66, 36];
  const steam: [number, number, number] = [200, 226, 210];
  const stain: [number, number, number] = [42, 62, 54];

  ellipse(t, 33, 52, 13, 3, stain, seed + 31, 95);
  line(t, 25, 15, 22, 8, 0.8, steam, seed + 32, 135);
  line(t, 33, 14, 35, 6, 0.8, steam, seed + 33, 145);
  line(t, 40, 16, 44, 9, 0.8, steam, seed + 34, 120);

  rect(t, 29, 10, 36, 15, glassDark, seed + 35, 250);
  rect(t, 30, 15, 35, 24, glassLight, seed + 36, 210);
  ellipse(t, 32, 24, 12, 5, glassLight, seed + 37, 214);
  rect(t, 22, 25, 43, 51, glass, seed + 38, 224);
  outlineRect(t, 22, 25, 43, 51, glassDark);
  ellipse(t, 32, 51, 11, 4, glassDark, seed + 39, 150);

  rect(t, 24, 36, 41, 49, hotWater, seed + 40, 205);
  line(t, 24, 36, 41, 34, 1.1, hotWaterLight, seed + 41, 190);
  line(t, 27, 27, 26, 48, 0.8, glassLight, seed + 42, 130);
  line(t, 38, 23, 40, 48, 0.8, glassDark, seed + 43, 120);

  rect(t, 25, 28, 40, 34, label, seed + 44, 238);
  rect(t, 28, 30, 36, 31, limescale, seed + 45, 220);
  rect(t, 28, 33, 38, 34, glassDark, seed + 46, 145);
  rect(t, 37, 22, 44, 30, limescale, seed + 47, 220);
  line(t, 36, 22, 42, 29, 0.8, glassDark, seed + 48, 145);
  line(t, 41, 32, 40, 48, 0.9, stain, seed + 49, 115);

  for (let i = 0; i < 9; i++) {
    const x = 23 + Math.floor(noise(i, 51, seed) * 20);
    const y = 24 + Math.floor(noise(i, 52, seed) * 25);
    const c = (i & 1) === 0 ? rust : limescale;
    ellipse(t, x, y, 1, 1, c, seed + 50 + i, (i & 1) === 0 ? 150 : 130);
  }
  px(t, 31, 12, rgba(226, 220, 168, 180));
  px(t, 25, 45, rgba(166, 232, 214, 170));
  px(t, 42, 26, CLEAR);
  px(t, 43, 26, CLEAR);
  px(t, 43, 27, CLEAR);
}

function drawEmptyBottleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [82, 126, 116];
  const glassLight: [number, number, number] = [168, 220, 198];
  const glassDark: [number, number, number] = [28, 48, 44];
  const label: [number, number, number] = [174, 132, 62];
  const labelLight: [number, number, number] = [216, 180, 102];
  const red: [number, number, number] = [154, 48, 42];
  const grime: [number, number, number] = [54, 78, 62];
  const rust: [number, number, number] = [124, 70, 38];

  ellipse(t, 32, 52, 12, 3, grime, seed + 78, 86);
  rect(t, 29, 9, 36, 15, glassDark, seed + 79, 238);
  rect(t, 30, 14, 35, 25, glassLight, seed + 80, 148);
  ellipse(t, 32, 25, 11, 5, glassLight, seed + 81, 148);
  rect(t, 22, 26, 42, 51, glass, seed + 82, 126);
  outlineRect(t, 22, 26, 42, 51, glassDark);
  ellipse(t, 32, 51, 11, 4, glassDark, seed + 83, 130);
  line(t, 26, 27, 25, 49, 0.8, glassLight, seed + 84, 150);
  line(t, 37, 23, 40, 49, 0.8, glassDark, seed + 85, 130);
  line(t, 29, 18, 35, 18, 0.8, glassLight, seed + 86, 140);

  rect(t, 24, 33, 40, 41, label, seed + 87, 228);
  rect(t, 26, 35, 35, 36, labelLight, seed + 88, 210);
  rect(t, 28, 39, 38, 40, glassDark, seed + 89, 135);
  line(t, 24, 33, 40, 41, 0.7, red, seed + 90, 155);
  rect(t, 38, 27, 45, 34, label, seed + 91, 205);
  rect(t, 39, 30, 43, 31, red, seed + 92, 185);
  line(t, 28, 30, 36, 38, 0.75, glassLight, seed + 93, 150);
  line(t, 35, 31, 28, 43, 0.75, glassLight, seed + 94, 130);
  line(t, 23, 45, 41, 47, 0.9, grime, seed + 95, 118);

  for (let i = 0; i < 7; i++) {
    const x = 23 + Math.floor(noise(i, 61, seed) * 20);
    const y = 25 + Math.floor(noise(i, 62, seed) * 25);
    px(t, x, y, CLEAR);
  }
  drawNoiseDust(t, seed + 96, rust, 7);
  drawNoiseDust(t, seed + 97, grime, 12);
  px(t, 31, 12, rgba(220, 240, 210, 180));
  px(t, 25, 45, rgba(188, 230, 204, 155));
  px(t, 42, 27, CLEAR);
  px(t, 43, 27, CLEAR);
}

function drawFilteredWaterSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [86, 126, 122];
  const glassLight: [number, number, number] = [176, 222, 208];
  const glassDark: [number, number, number] = [24, 42, 42];
  const water: [number, number, number] = [62, 176, 188];
  const waterLight: [number, number, number] = [138, 232, 222];
  const label: [number, number, number] = [194, 178, 116];
  const red: [number, number, number] = [164, 48, 42];
  const filterGrey: [number, number, number] = [122, 132, 124];
  const rust: [number, number, number] = [118, 66, 38];
  const damp: [number, number, number] = [48, 72, 66];

  ellipse(t, 33, 53, 14, 3.5, damp, seed + 98, 86);
  rect(t, 29, 9, 36, 15, glassDark, seed + 99, 245);
  rect(t, 30, 14, 35, 24, glassLight, seed + 100, 180);
  ellipse(t, 32.5, 24, 12, 5, glassLight, seed + 101, 190);
  rect(t, 22, 25, 43, 51, glass, seed + 102, 145);
  outlineRect(t, 22, 25, 43, 51, glassDark);
  ellipse(t, 32.5, 51, 11, 4, glassDark, seed + 103, 130);

  rect(t, 24, 34, 41, 49, water, seed + 104, 210);
  line(t, 24, 34, 41, 32, 1.1, waterLight, seed + 105, 205);
  ellipse(t, 31, 39, 8, 3.6, waterLight, seed + 106, 105);
  line(t, 27, 27, 26, 48, 0.8, glassLight, seed + 107, 140);
  line(t, 38, 23, 41, 48, 0.8, glassDark, seed + 108, 135);

  rect(t, 24, 28, 41, 35, label, seed + 109, 232);
  rect(t, 26, 30, 37, 31, glassDark, seed + 110, 138);
  rect(t, 28, 33, 38, 34, red, seed + 111, 196);
  rect(t, 38, 25, 46, 32, filterGrey, seed + 112, 214);
  line(t, 38, 25, 45, 31, 0.8, glassDark, seed + 113, 155);
  line(t, 40, 33, 40, 48, 0.8, damp, seed + 114, 125);
  rect(t, 24, 43, 42, 45, waterLight, seed + 115, 116);
  drawNoiseDust(t, seed + 116, rust, 8);
  drawNoiseDust(t, seed + 117, waterLight, 13);
  px(t, 31, 12, rgba(220, 240, 218, 180));
  px(t, 25, 45, rgba(176, 240, 226, 165));
  px(t, 42, 26, CLEAR);
  px(t, 43, 26, CLEAR);
}

function drawMetalWaterSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [76, 104, 108];
  const glassLight: [number, number, number] = [138, 184, 188];
  const glassDark: [number, number, number] = [24, 36, 40];
  const water: [number, number, number] = [64, 150, 154];
  const waterLight: [number, number, number] = [110, 214, 196];
  const metal: [number, number, number] = [118, 126, 120];
  const rust: [number, number, number] = [132, 68, 34];
  const red: [number, number, number] = [158, 42, 38];
  const stain: [number, number, number] = [38, 58, 54];

  ellipse(t, 33, 53, 14, 3.5, stain, seed + 124, 90);
  rect(t, 28, 9, 37, 15, glassDark, seed + 125, 246);
  rect(t, 29, 14, 36, 24, glassLight, seed + 126, 178);
  ellipse(t, 32.5, 24, 12, 5, glassLight, seed + 127, 188);
  rect(t, 22, 25, 43, 51, glass, seed + 128, 156);
  outlineRect(t, 22, 25, 43, 51, glassDark);
  ellipse(t, 32.5, 51, 11, 4, glassDark, seed + 129, 140);

  rect(t, 24, 35, 41, 49, water, seed + 130, 214);
  line(t, 24, 35, 41, 33, 1.2, waterLight, seed + 131, 200);
  ellipse(t, 31, 41, 8, 3.5, waterLight, seed + 132, 80);
  line(t, 27, 27, 26, 49, 0.8, glassLight, seed + 133, 138);
  line(t, 38, 24, 40, 49, 0.8, glassDark, seed + 134, 130);

  rect(t, 24, 28, 41, 34, metal, seed + 135, 228);
  rect(t, 26, 30, 34, 31, glassDark, seed + 136, 140);
  rect(t, 35, 29, 40, 33, red, seed + 137, 190);
  line(t, 24, 34, 41, 28, 0.7, rust, seed + 138, 130);
  rect(t, 38, 21, 44, 28, rust, seed + 139, 178);
  line(t, 38, 22, 43, 27, 0.8, glassDark, seed + 140, 150);

  for (let i = 0; i < 11; i++) {
    const x = 23 + Math.floor(noise(i, 71, seed) * 20);
    const y = 26 + Math.floor(noise(i, 72, seed) * 24);
    const c = (i & 1) === 0 ? rust : metal;
    ellipse(t, x, y, 1, 1, c, seed + 141 + i, (i & 1) === 0 ? 160 : 120);
  }
  px(t, 31, 12, rgba(198, 226, 206, 180));
  px(t, 25, 45, rgba(132, 226, 200, 165));
  px(t, 42, 26, CLEAR);
  px(t, 43, 26, CLEAR);
  drawNoiseDust(t, seed + 153, rust, 8);
}

function drawAntibioticSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 194, 166];
  const paperLight: [number, number, number] = [232, 226, 190];
  const edge: [number, number, number] = [58, 68, 62];
  const red: [number, number, number] = [184, 42, 46];
  const green: [number, number, number] = [82, 154, 118];
  const greenLight: [number, number, number] = [136, 218, 164];
  const stain: [number, number, number] = [70, 92, 78];
  const rust: [number, number, number] = [128, 70, 38];

  rect(t, 18, 19, 47, 50, paper, seed + 41, 245);
  rect(t, 20, 14, 45, 21, paperLight, seed + 42, 238);
  outlineRect(t, 18, 19, 47, 50, edge);
  rect(t, 19, 22, 46, 23, edge, seed + 43, 95);
  clearRect(t, 18, 19, 21, 22);
  clearRect(t, 45, 19, 47, 23);
  clearRect(t, 18, 48, 20, 50);

  rect(t, 28, 16, 36, 18, red, seed + 44, 235);
  rect(t, 31, 13, 33, 21, red, seed + 45, 235);
  rect(t, 23, 26, 42, 32, [208, 210, 186], seed + 46, 230);
  rect(t, 24, 27, 41, 28, edge, seed + 47, 105);
  rect(t, 24, 31, 39, 32, edge, seed + 48, 95);

  for (let i = 0; i < 3; i++) {
    const cx = 25 + i * 7;
    ellipse(t, cx, 41, 4.4, 7.2, green, seed + 50 + i, 225);
    ellipse(t, cx - 1, 38, 1.4, 2.8, greenLight, seed + 54 + i, 205);
    line(t, cx - 3, 41, cx + 3, 41, 0.7, edge, seed + 58 + i, 105);
  }

  ellipse(t, 22, 46, 7, 4, stain, seed + 62, 120);
  line(t, 19, 20, 45, 49, 0.8, edge, seed + 63, 80);
  rect(t, 39, 45, 45, 47, rust, seed + 64, 150);
  drawNoiseDust(t, seed + 65, rust, 9);
}

function drawAntidepSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 200, 176];
  const paperLight: [number, number, number] = [232, 228, 196];
  const edge: [number, number, number] = [56, 66, 62];
  const red: [number, number, number] = [176, 38, 44];
  const glass: [number, number, number] = [82, 148, 122];
  const glassLight: [number, number, number] = [138, 204, 168];
  const stain: [number, number, number] = [72, 90, 80];
  const rust: [number, number, number] = [126, 70, 40];

  rect(t, 16, 20, 50, 49, paper, seed + 66, 246);
  rect(t, 19, 16, 47, 24, paperLight, seed + 67, 238);
  outlineRect(t, 16, 20, 50, 49, edge);
  clearRect(t, 16, 20, 19, 23);
  clearRect(t, 48, 20, 50, 24);
  clearRect(t, 17, 47, 19, 49);
  line(t, 18, 25, 48, 45, 0.8, edge, seed + 68, 75);
  line(t, 18, 48, 50, 48, 1.1, stain, seed + 69, 115);

  rect(t, 21, 22, 32, 29, red, seed + 70, 232);
  rect(t, 25, 23, 28, 28, paperLight, 0, 245);
  rect(t, 23, 25, 30, 26, paperLight, 0, 245);

  const blisters = [
    [25, 35], [32, 34], [39, 35],
    [25, 43], [32, 42], [39, 43],
  ] as const;
  for (let i = 0; i < blisters.length; i++) {
    const [cx, cy] = blisters[i];
    ellipse(t, cx, cy, 4.6, 3.6, edge, seed + 71 + i, 150);
    if (i === 4) {
      ellipse(t, cx, cy, 3.1, 2.3, paperLight, seed + 80 + i, 135);
      continue;
    }
    ellipse(t, cx, cy, 3.2, 2.4, glass, seed + 80 + i, 230);
    px(t, cx - 1, cy - 1, rgba(glassLight[0], glassLight[1], glassLight[2], 185));
  }

  rect(t, 43, 26, 46, 40, glass, seed + 88, 150);
  rect(t, 44, 28, 45, 37, glassLight, seed + 89, 140);
  rect(t, 38, 46, 45, 48, rust, seed + 90, 145);
  drawNoiseDust(t, seed + 91, stain, 16);
}

function drawAntiSporeInhalerSprite(t: Uint32Array, seed: number): void {
  const body: [number, number, number] = [206, 208, 184];
  const bodyLight: [number, number, number] = [238, 232, 198];
  const bodyDark: [number, number, number] = [78, 86, 78];
  const red: [number, number, number] = [188, 42, 42];
  const glass: [number, number, number] = [98, 166, 128];
  const glassLight: [number, number, number] = [154, 226, 178];
  const stain: [number, number, number] = [58, 84, 68];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 52, 17, 4, stain, seed + 39, 72);
  rect(t, 19, 25, 48, 46, body, seed + 40, 246);
  ellipse(t, 19, 35, 5, 10, body, seed + 41, 238);
  ellipse(t, 48, 35, 5, 10, bodyDark, seed + 42, 238);
  outlineRect(t, 19, 25, 48, 46, bodyDark);

  rect(t, 25, 15, 40, 28, bodyLight, seed + 43, 245);
  rect(t, 28, 11, 37, 16, bodyDark, seed + 44, 255);
  rect(t, 30, 8, 35, 12, red, seed + 45, 245);
  line(t, 26, 15, 39, 15, 0.8, bodyDark, seed + 46, 170);

  rect(t, 47, 30, 56, 38, bodyDark, seed + 47, 250);
  rect(t, 52, 32, 59, 36, body, seed + 48, 238);
  ellipse(t, 58, 34, 2, 2, glassLight, seed + 49, 190);

  rect(t, 25, 31, 37, 41, glass, seed + 50, 220);
  rect(t, 27, 32, 35, 34, glassLight, seed + 51, 210);
  rect(t, 30, 36, 42, 39, red, seed + 52, 236);
  rect(t, 34, 32, 38, 43, red, seed + 53, 236);
  line(t, 22, 44, 46, 27, 0.8, stain, seed + 54, 105);
  line(t, 24, 26, 49, 44, 0.7, bodyLight, seed + 55, 92);

  for (let i = 0; i < 12; i++) {
    const x = 21 + Math.floor(noise(i, 41, seed) * 28);
    const y = 24 + Math.floor(noise(i, 42, seed) * 23);
    const c = (i & 1) === 0 ? stain : rust;
    px(t, x, y, rgba(c[0], c[1], c[2], (i & 1) === 0 ? 116 : 150));
  }
}

function drawAntiemeticSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 200, 170];
  const paperLight: [number, number, number] = [232, 226, 194];
  const paperDark: [number, number, number] = [68, 76, 68];
  const medicalRed: [number, number, number] = [184, 42, 44];
  const nauseaGreen: [number, number, number] = [70, 154, 104];
  const glassGreen: [number, number, number] = [118, 196, 150];
  const dampStain: [number, number, number] = [86, 118, 82];
  const rust: [number, number, number] = [128, 70, 42];

  rect(t, 16, 18, 48, 50, paper, seed + 600, 246);
  rect(t, 18, 14, 46, 21, paperLight, seed + 601, 238);
  outlineRect(t, 16, 18, 48, 50, paperDark);
  line(t, 18, 22, 46, 18, 0.8, paperDark, seed + 602, 110);
  line(t, 18, 47, 47, 43, 0.8, paperDark, seed + 603, 95);

  clearRect(t, 16, 18, 18, 20);
  clearRect(t, 46, 18, 48, 22);
  clearRect(t, 16, 47, 19, 50);
  px(t, 47, 49, CLEAR);
  px(t, 48, 48, CLEAR);

  rect(t, 29, 23, 34, 39, medicalRed, seed + 604, 244);
  rect(t, 23, 29, 41, 34, medicalRed, seed + 605, 244);
  rect(t, 24, 37, 35, 38, paperDark, seed + 606, 150);
  rect(t, 22, 42, 37, 43, paperDark, seed + 607, 135);

  ellipse(t, 42, 41, 5, 7, glassGreen, seed + 608, 212);
  ellipse(t, 43, 41, 2, 4, nauseaGreen, seed + 609, 235);
  line(t, 37, 24, 43, 27, 1.1, nauseaGreen, seed + 610, 220);
  line(t, 43, 27, 38, 30, 1.1, nauseaGreen, seed + 611, 215);
  line(t, 38, 30, 45, 33, 1.1, nauseaGreen, seed + 612, 210);

  ellipse(t, 43, 49, 9, 3, dampStain, seed + 613, 116);
  rect(t, 20, 17, 27, 19, rust, seed + 614, 130);
  drawNoiseDust(t, seed + 615, dampStain, 16);
  drawNoiseDust(t, seed + 616, rust, 6);
  px(t, 22, 23, rgba(246, 240, 204, 180));
  px(t, 31, 18, rgba(246, 240, 204, 160));
}

function drawAntifungalOintmentSprite(t: Uint32Array, seed: number): void {
  const tubeDark: [number, number, number] = [56, 66, 58];
  const tube: [number, number, number] = [186, 184, 156];
  const tubeLight: [number, number, number] = [230, 226, 190];
  const red: [number, number, number] = [184, 42, 46];
  const green: [number, number, number] = [72, 146, 92];
  const greenLight: [number, number, number] = [126, 214, 132];
  const damp: [number, number, number] = [74, 98, 78];
  const rust: [number, number, number] = [132, 72, 38];

  line(t, 14, 43, 43, 25, 8.4, tubeDark, seed + 620, 238);
  line(t, 16, 41, 42, 25, 6.4, tube, seed + 621, 250);
  line(t, 18, 38, 37, 26, 1.1, tubeLight, seed + 622, 190);
  line(t, 18, 44, 42, 29, 1.1, damp, seed + 623, 120);

  rect(t, 24, 30, 39, 41, [210, 208, 178], seed + 624, 236);
  rect(t, 29, 32, 34, 39, red, seed + 625, 244);
  rect(t, 26, 34, 37, 37, red, seed + 626, 244);
  rect(t, 25, 39, 37, 40, damp, seed + 627, 105);

  line(t, 41, 26, 52, 21, 5.0, tubeDark, seed + 628, 238);
  line(t, 42, 26, 52, 21, 3.7, green, seed + 629, 250);
  rect(t, 45, 18, 54, 23, green, seed + 630, 238);
  rect(t, 46, 19, 53, 20, greenLight, seed + 631, 190);
  line(t, 44, 25, 53, 22, 0.8, tubeDark, seed + 632, 165);

  line(t, 20, 45, 42, 32, 1.1, green, seed + 633, 152);
  ellipse(t, 22, 46, 3.8, 2.2, greenLight, seed + 634, 142);
  ellipse(t, 39, 32, 3.2, 1.8, greenLight, seed + 635, 132);
  ellipse(t, 17, 42, 2.2, 1.7, damp, seed + 636, 126);
  rect(t, 17, 36, 23, 38, rust, seed + 637, 132);
  rect(t, 38, 27, 42, 29, rust, seed + 638, 118);

  clearRect(t, 13, 40, 16, 43);
  clearRect(t, 48, 17, 54, 18);
  clearRect(t, 52, 23, 54, 25);
  px(t, 22, 32, CLEAR);
  px(t, 23, 31, CLEAR);
  px(t, 41, 37, rgba(greenLight[0], greenLight[1], greenLight[2], 170));
  drawNoiseDust(t, seed + 639, rust, 8);
  drawNoiseDust(t, seed + 640, damp, 8);
  rect(t, 29, 32, 34, 39, red, seed + 641, 244);
  rect(t, 26, 34, 37, 37, red, seed + 642, 244);
}

function drawBodyBagRollSprite(t: Uint32Array, seed: number): void {
  const vinyl: [number, number, number] = [194, 194, 172];
  const vinylLight: [number, number, number] = [232, 226, 190];
  const vinylDark: [number, number, number] = [66, 74, 70];
  const foldShadow: [number, number, number] = [112, 122, 108];
  const medicalRed: [number, number, number] = [178, 38, 42];
  const dampGreen: [number, number, number] = [66, 114, 82];
  const rust: [number, number, number] = [126, 70, 40];

  ellipse(t, 32, 52, 17, 4, [20, 24, 22], seed + 650, 78);
  ellipse(t, 24, 35, 9, 14, vinylDark, seed + 651, 246);
  rect(t, 23, 21, 45, 49, vinyl, seed + 652, 248);
  ellipse(t, 45, 35, 10, 14, vinylLight, seed + 653, 248);
  ellipse(t, 45, 35, 5, 8, [36, 42, 38], seed + 654, 248);
  ellipse(t, 45, 35, 2.5, 4.2, [116, 124, 108], seed + 655, 180);
  line(t, 23, 22, 45, 21, 0.9, vinylLight, seed + 656, 150);
  line(t, 23, 49, 45, 48, 0.9, vinylDark, seed + 657, 145);

  for (let i = 0; i < 4; i++) {
    const x = 27 + i * 4;
    line(t, x, 24, x + 3, 47, 0.75, foldShadow, seed + 658 + i, 120);
  }

  rect(t, 25, 30, 43, 39, [214, 208, 176], seed + 664, 232);
  rect(t, 31, 27, 36, 42, medicalRed, seed + 665, 244);
  rect(t, 25, 33, 42, 37, medicalRed, seed + 666, 244);
  rect(t, 27, 43, 40, 45, medicalRed, seed + 667, 188);
  rect(t, 28, 44, 38, 45, vinylDark, seed + 668, 138);

  line(t, 17, 28, 22, 38, 1.1, vinylDark, seed + 669, 220);
  line(t, 17, 42, 23, 48, 1.1, vinylDark, seed + 670, 215);
  rect(t, 16, 30, 22, 35, vinyl, seed + 671, 235);
  rect(t, 16, 41, 23, 45, vinyl, seed + 672, 230);
  ellipse(t, 21, 46, 4, 2.4, dampGreen, seed + 673, 118);
  line(t, 25, 48, 48, 45, 1.1, dampGreen, seed + 674, 112);
  rect(t, 38, 22, 44, 24, rust, seed + 675, 130);
  drawNoiseDust(t, seed + 676, rust, 7);
  drawNoiseDust(t, seed + 677, dampGreen, 12);
  px(t, 27, 23, rgba(242, 238, 204, 175));
  px(t, 47, 27, rgba(246, 240, 204, 185));
}

function drawBandageSprite(t: Uint32Array, seed: number): void {
  const cloth: [number, number, number] = [206, 202, 174];
  const clothLight: [number, number, number] = [238, 232, 198];
  const clothDark: [number, number, number] = [76, 82, 76];
  const red: [number, number, number] = [182, 38, 42];
  const damp: [number, number, number] = [72, 100, 78];
  const rust: [number, number, number] = [124, 68, 38];

  ellipse(t, 32, 52, 17, 4, [16, 18, 16], seed + 680, 74);
  rect(t, 28, 27, 51, 40, cloth, seed + 681, 246);
  rect(t, 31, 29, 48, 33, clothLight, seed + 682, 220);
  outlineRect(t, 28, 27, 51, 40, clothDark);
  clearRect(t, 49, 27, 51, 29);
  clearRect(t, 28, 38, 31, 40);

  ellipse(t, 24, 36, 14, 13, cloth, seed + 683, 252);
  ellipse(t, 24, 36, 8, 7, clothLight, seed + 684, 242);
  ellipse(t, 24, 36, 4, 3.2, clothDark, seed + 685, 232);
  ellipse(t, 24, 36, 3.4, 2.7, [40, 44, 40], seed + 700, 242);
  ellipse(t, 24, 36, 1.7, 1.2, [18, 20, 18], seed + 701, 245);
  ellipse(t, 25, 36, 1.8, 1.4, [34, 38, 34], seed + 686, 235);

  line(t, 13, 33, 37, 28, 0.9, clothDark, seed + 687, 130);
  line(t, 13, 39, 39, 34, 0.9, clothDark, seed + 688, 120);
  line(t, 17, 27, 35, 45, 0.8, clothDark, seed + 689, 100);
  line(t, 19, 45, 46, 40, 0.9, damp, seed + 690, 118);
  ellipse(t, 24, 36, 5.4, 4.1, [52, 58, 52], seed + 702, 224);
  ellipse(t, 25, 36, 2.2, 1.5, [18, 20, 18], seed + 703, 238);

  rect(t, 39, 29, 43, 38, red, seed + 691, 242);
  rect(t, 34, 32, 49, 35, red, seed + 692, 242);
  rect(t, 37, 41, 48, 43, red, seed + 693, 178);
  rect(t, 38, 42, 46, 43, clothDark, seed + 694, 118);

  ellipse(t, 17, 43, 5, 3.2, damp, seed + 695, 116);
  rect(t, 13, 31, 20, 33, rust, seed + 696, 132);
  rect(t, 42, 25, 48, 27, rust, seed + 697, 118);
  drawNoiseDust(t, seed + 698, rust, 9);
  drawNoiseDust(t, seed + 699, damp, 12);
  px(t, 21, 28, rgba(246, 240, 204, 175));
  px(t, 45, 31, rgba(246, 240, 204, 160));
}

function drawBurnGelSprite(t: Uint32Array, seed: number): void {
  const tube: [number, number, number] = [190, 192, 166];
  const tubeLight: [number, number, number] = [236, 230, 194];
  const tubeDark: [number, number, number] = [62, 74, 70];
  const red: [number, number, number] = [184, 42, 46];
  const gel: [number, number, number] = [76, 190, 178];
  const gelLight: [number, number, number] = [134, 232, 212];
  const cap: [number, number, number] = [48, 76, 76];
  const rust: [number, number, number] = [128, 68, 40];
  const stain: [number, number, number] = [60, 92, 82];

  ellipse(t, 33, 53, 17, 4, [18, 22, 20], seed + 780, 76);
  line(t, 13, 44, 42, 25, 8.2, tubeDark, seed + 781, 238);
  line(t, 15, 42, 41, 25, 6.2, tube, seed + 782, 250);
  line(t, 18, 39, 37, 27, 1.2, tubeLight, seed + 783, 185);
  line(t, 17, 45, 42, 29, 1.1, stain, seed + 784, 120);

  rect(t, 22, 31, 39, 42, [214, 210, 178], seed + 785, 235);
  rect(t, 28, 32, 33, 41, red, seed + 786, 244);
  rect(t, 24, 35, 38, 38, red, seed + 787, 244);
  rect(t, 24, 40, 37, 41, tubeDark, seed + 788, 115);

  line(t, 40, 25, 53, 19, 5.2, cap, seed + 789, 245);
  rect(t, 47, 17, 55, 22, gel, seed + 790, 232);
  rect(t, 48, 18, 54, 19, gelLight, seed + 791, 190);
  line(t, 43, 24, 53, 20, 0.8, tubeDark, seed + 792, 170);
  line(t, 19, 44, 44, 30, 1.2, gel, seed + 793, 150);
  ellipse(t, 22, 45, 4, 2.4, gelLight, seed + 794, 145);
  ellipse(t, 41, 31, 3.4, 1.9, gelLight, seed + 795, 132);
  rect(t, 18, 37, 24, 39, rust, seed + 796, 132);
  rect(t, 38, 27, 43, 29, rust, seed + 797, 118);
  clearRect(t, 13, 41, 16, 44);
  clearRect(t, 50, 16, 55, 17);
  clearRect(t, 53, 22, 55, 24);
  drawNoiseDust(t, seed + 798, rust, 8);
  drawNoiseDust(t, seed + 799, gelLight, 10);
}

function drawCleanupTongsSprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [124, 134, 128];
  const steelLight: [number, number, number] = [196, 206, 188];
  const steelDark: [number, number, number] = [42, 52, 50];
  const red: [number, number, number] = [178, 42, 44];
  const green: [number, number, number] = [72, 154, 116];
  const glass: [number, number, number] = [126, 210, 168];
  const rust: [number, number, number] = [126, 68, 38];
  const stain: [number, number, number] = [58, 78, 66];

  ellipse(t, 33, 52, 18, 4, [14, 18, 16], seed + 800, 80);
  line(t, 16, 48, 43, 17, 2.2, steelDark, seed + 801, 250);
  line(t, 19, 49, 47, 19, 2.2, steelDark, seed + 802, 245);
  line(t, 17, 47, 42, 18, 1.1, steelLight, seed + 803, 225);
  line(t, 20, 48, 46, 20, 1.0, steel, seed + 804, 245);
  ellipse(t, 24, 39, 4.5, 4.5, steelDark, seed + 805, 235);
  ellipse(t, 24, 39, 2.1, 2.1, steelLight, seed + 806, 220);
  rect(t, 13, 44, 23, 51, red, seed + 807, 236);
  rect(t, 15, 46, 21, 47, steelLight, seed + 808, 130);

  line(t, 42, 17, 51, 14, 1.3, steelLight, seed + 809, 245);
  line(t, 46, 19, 54, 18, 1.3, steelLight, seed + 810, 245);
  ellipse(t, 51, 16, 3.4, 2.2, glass, seed + 811, 205);
  ellipse(t, 50, 16, 1.4, 1.2, green, seed + 812, 235);
  rect(t, 35, 26, 42, 29, green, seed + 813, 210);
  rect(t, 37, 27, 41, 27, glass, seed + 814, 190);
  line(t, 18, 45, 44, 20, 0.8, rust, seed + 815, 145);
  ellipse(t, 22, 49, 4, 2.5, stain, seed + 816, 120);
  drawNoiseDust(t, seed + 817, rust, 8);
}

function drawClothRollSprite(t: Uint32Array, seed: number): void {
  const cloth: [number, number, number] = [148, 148, 134];
  const clothLight: [number, number, number] = [206, 202, 174];
  const clothDark: [number, number, number] = [62, 68, 64];
  const damp: [number, number, number] = [58, 84, 74];
  const rust: [number, number, number] = [118, 70, 42];
  const blueGlow: [number, number, number] = [82, 148, 220];
  const violetGlow: [number, number, number] = [142, 88, 196];

  ellipse(t, 32, 52, 18, 4, [16, 18, 16], seed + 820, 78);
  ellipse(t, 24, 35, 11, 14, clothDark, seed + 821, 246);
  rect(t, 24, 22, 45, 49, cloth, seed + 822, 250);
  ellipse(t, 45, 35, 10, 14, clothLight, seed + 823, 248);
  ellipse(t, 45, 35, 5, 8, clothDark, seed + 824, 235);
  ellipse(t, 45, 35, 2.4, 4.2, [24, 28, 26], seed + 825, 230);
  line(t, 24, 23, 45, 22, 0.9, clothLight, seed + 826, 150);
  line(t, 24, 48, 45, 49, 1.0, clothDark, seed + 827, 145);

  for (let i = 0; i < 5; i++) line(t, 27 + i * 4, 24, 30 + i * 3, 47, 0.8, clothDark, seed + 828 + i, 102);
  line(t, 17, 42, 36, 31, 3.8, clothDark, seed + 833, 228);
  line(t, 17, 41, 35, 31, 2.2, clothLight, seed + 834, 215);
  rect(t, 20, 38, 33, 42, damp, seed + 835, 116);

  ellipse(t, 24, 45, 6.5, 3.4, blueGlow, seed + 836, 112);
  ellipse(t, 40, 28, 4.5, 2.8, violetGlow, seed + 837, 88);
  rect(t, 37, 23, 44, 25, rust, seed + 838, 130);
  drawNoiseDust(t, seed + 839, rust, 9);
  drawNoiseDust(t, seed + 840, blueGlow, 8);
}

function drawCottonWoolSprite(t: Uint32Array, seed: number): void {
  const cotton: [number, number, number] = [210, 210, 184];
  const cottonLight: [number, number, number] = [238, 236, 206];
  const cottonGrey: [number, number, number] = [138, 146, 136];
  const dark: [number, number, number] = [62, 72, 66];
  const green: [number, number, number] = [82, 126, 94];
  const red: [number, number, number] = [180, 42, 44];
  const rust: [number, number, number] = [118, 68, 42];

  ellipse(t, 32, 52, 17, 4, [14, 16, 14], seed + 841, 76);
  ellipse(t, 27, 36, 12, 10, cotton, seed + 842, 238);
  ellipse(t, 36, 34, 13, 11, cottonLight, seed + 843, 236);
  ellipse(t, 41, 42, 10, 8, cotton, seed + 844, 232);
  ellipse(t, 24, 43, 9, 7, cottonGrey, seed + 845, 210);
  ellipse(t, 32, 39, 15, 9, cottonLight, seed + 846, 225);
  for (let i = 0; i < 7; i++) {
    const x0 = 21 + Math.floor(noise(i, 61, seed) * 19);
    const y0 = 30 + Math.floor(noise(i, 62, seed) * 17);
    line(t, x0, y0, x0 + 11, y0 + 4 - (i & 3), 0.65, dark, seed + 847 + i, 76);
  }
  rect(t, 39, 25, 49, 31, red, seed + 855, 215);
  rect(t, 42, 26, 46, 30, cottonLight, 0, 238);
  rect(t, 40, 28, 48, 28, cottonLight, 0, 238);
  ellipse(t, 23, 47, 7, 3.8, green, seed + 856, 110);
  line(t, 20, 47, 46, 45, 0.9, rust, seed + 857, 118);
  drawNoiseDust(t, seed + 858, rust, 8);
  drawNoiseDust(t, seed + 859, green, 7);
}

function drawPermanganateVialSprite(t: Uint32Array, seed: number): void {
  const glassDark: [number, number, number] = [42, 54, 56];
  const glass: [number, number, number] = [116, 172, 146];
  const glassLight: [number, number, number] = [178, 230, 188];
  const purple: [number, number, number] = [116, 42, 142];
  const purpleLight: [number, number, number] = [188, 82, 214];
  const paper: [number, number, number] = [212, 206, 170];
  const red: [number, number, number] = [184, 42, 46];
  const rust: [number, number, number] = [124, 68, 38];
  const stain: [number, number, number] = [72, 90, 76];

  ellipse(t, 32, 53, 15, 4, [14, 16, 14], seed + 1900, 78);
  rect(t, 25, 17, 40, 50, glassDark, seed + 1901, 230);
  rect(t, 27, 15, 38, 49, glass, seed + 1902, 178);
  rect(t, 28, 27, 37, 48, purple, seed + 1903, 232);
  rect(t, 29, 29, 35, 36, purpleLight, seed + 1904, 205);
  rect(t, 29, 17, 36, 22, glassLight, seed + 1905, 165);
  rect(t, 27, 11, 38, 17, glassDark, seed + 1906, 248);
  rect(t, 29, 9, 36, 13, red, seed + 1907, 236);
  rect(t, 24, 30, 41, 39, paper, seed + 1908, 236);
  rect(t, 29, 31, 36, 38, red, 0, 246);
  rect(t, 26, 33, 39, 36, red, 0, 246);
  rect(t, 26, 39, 39, 40, glassDark, seed + 1911, 115);
  line(t, 28, 19, 28, 46, 0.8, glassLight, seed + 1912, 160);
  ellipse(t, 42, 45, 7, 3.5, purpleLight, seed + 1913, 165);
  line(t, 22, 47, 43, 43, 0.9, stain, seed + 1914, 116);
  rect(t, 36, 22, 42, 25, rust, seed + 1915, 132);
  drawNoiseDust(t, seed + 1916, rust, 8);
  drawNoiseDust(t, seed + 1917, purpleLight, 13);
  px(t, 30, 18, rgba(226, 246, 210, 170));
  px(t, 34, 30, rgba(226, 116, 242, 180));
}

function drawPillsSprite(t: Uint32Array, seed: number): void {
  const foil: [number, number, number] = [188, 190, 170];
  const foilLight: [number, number, number] = [232, 226, 196];
  const foilDark: [number, number, number] = [66, 76, 72];
  const tablet: [number, number, number] = [224, 220, 188];
  const tabletBlue: [number, number, number] = [126, 176, 188];
  const red: [number, number, number] = [182, 42, 46];
  const green: [number, number, number] = [78, 134, 92];
  const rust: [number, number, number] = [126, 70, 40];
  const stain: [number, number, number] = [70, 92, 78];

  rect(t, 16, 18, 49, 49, foil, seed + 1920, 246);
  rect(t, 19, 15, 46, 22, foilLight, seed + 1921, 238);
  outlineRect(t, 16, 18, 49, 49, foilDark);
  clearRect(t, 16, 18, 19, 21);
  clearRect(t, 47, 19, 49, 24);
  clearRect(t, 17, 47, 20, 49);
  rect(t, 18, 43, 49, 49, stain, seed + 1922, 92);
  rect(t, 22, 23, 31, 29, red, seed + 1923, 232);
  rect(t, 25, 21, 28, 31, red, seed + 1924, 232);

  const blisters = [
    [25, 36], [33, 35], [41, 36],
    [25, 44], [33, 43], [41, 44],
  ] as const;
  for (let i = 0; i < blisters.length; i++) {
    const [cx, cy] = blisters[i];
    ellipse(t, cx, cy, 4.6, 3.4, foilDark, seed + 1925 + i, 130);
    ellipse(t, cx, cy, 3.2, 2.3, (i & 1) === 0 ? tablet : tabletBlue, seed + 1932 + i, 238);
    line(t, cx - 2, cy, cx + 2, cy, 0.55, foilDark, seed + 1939 + i, 100);
  }
  rect(t, 37, 23, 45, 29, green, seed + 1946, 205);
  rect(t, 39, 25, 43, 26, tablet, seed + 1947, 170);
  line(t, 19, 20, 47, 48, 0.8, foilDark, seed + 1948, 75);
  rect(t, 39, 46, 46, 48, rust, seed + 1949, 142);
  drawNoiseDust(t, seed + 1950, rust, 8);
  drawNoiseDust(t, seed + 1951, stain, 10);
}

function drawIodineSprite(t: Uint32Array, seed: number): void {
  const glassDark: [number, number, number] = [48, 30, 18];
  const glass: [number, number, number] = [146, 82, 30];
  const glassLight: [number, number, number] = [226, 150, 52];
  const cap: [number, number, number] = [58, 66, 60];
  const label: [number, number, number] = [218, 208, 170];
  const red: [number, number, number] = [178, 38, 42];
  const stain: [number, number, number] = [94, 70, 36];
  const rust: [number, number, number] = [126, 66, 34];

  ellipse(t, 32, 52, 13, 3.5, [20, 16, 12], seed + 860, 78);
  rect(t, 28, 12, 37, 18, cap, seed + 861, 245);
  rect(t, 25, 18, 41, 26, glassDark, seed + 862, 246);
  rect(t, 22, 25, 44, 50, glass, seed + 863, 232);
  ellipse(t, 33, 25, 11, 4.5, glassLight, seed + 864, 180);
  ellipse(t, 33, 50, 11, 4, glassDark, seed + 865, 175);
  outlineRect(t, 22, 25, 44, 50, glassDark);

  rect(t, 24, 32, 42, 42, label, seed + 866, 232);
  rect(t, 31, 29, 35, 45, red, seed + 867, 244);
  rect(t, 26, 35, 40, 39, red, seed + 868, 244);
  rect(t, 23, 28, 26, 47, glass, seed + 867, 225);
  rect(t, 40, 28, 43, 47, glass, seed + 868, 220);
  rect(t, 25, 43, 39, 45, glassDark, seed + 869, 120);
  line(t, 25, 27, 42, 48, 0.8, glassLight, seed + 870, 95);
  ellipse(t, 24, 48, 6, 3.2, stain, seed + 871, 118);
  rect(t, 37, 23, 45, 27, rust, seed + 872, 132);
  drawNoiseDust(t, seed + 873, rust, 8);
}

function drawIstotitCandleSprite(t: Uint32Array, seed: number): void {
  const wax: [number, number, number] = [216, 196, 132];
  const waxLight: [number, number, number] = [246, 228, 164];
  const waxDark: [number, number, number] = [112, 86, 44];
  const gold: [number, number, number] = [224, 170, 54];
  const violet: [number, number, number] = [138, 82, 190];
  const flame: [number, number, number] = [238, 146, 54];
  const red: [number, number, number] = [156, 38, 42];
  const ash: [number, number, number] = [34, 28, 24];

  ellipse(t, 33, 35, 20, 20, violet, seed + 874, 34);
  ellipse(t, 33, 52, 12, 3.5, [18, 14, 12], seed + 875, 82);
  rect(t, 28, 20, 37, 50, wax, seed + 876, 248);
  ellipse(t, 32, 20, 5, 2.4, waxLight, seed + 877, 235);
  ellipse(t, 32, 50, 6, 2.6, waxDark, seed + 878, 190);
  line(t, 31, 22, 31, 48, 0.8, waxLight, seed + 879, 150);
  line(t, 36, 23, 36, 48, 0.8, waxDark, seed + 880, 125);
  rect(t, 27, 35, 38, 39, gold, seed + 881, 222);
  rect(t, 28, 37, 37, 38, red, seed + 882, 180);
  ellipse(t, 25, 38, 4.2, 5.4, violet, seed + 881, 116);
  ellipse(t, 40, 40, 4.0, 4.8, violet, seed + 882, 108);
  line(t, 32, 18, 32, 13, 0.8, ash, seed + 883, 230);
  ellipse(t, 32, 11, 4.5, 6.5, flame, seed + 884, 225);
  ellipse(t, 32, 12, 2.2, 3.2, waxLight, seed + 885, 230);
  ellipse(t, 28, 44, 3.8, 5.8, gold, seed + 886, 172);
  ellipse(t, 38, 47, 4.5, 3.0, waxDark, seed + 887, 118);
  drawNoiseDust(t, seed + 888, gold, 8);
  drawNoiseDust(t, seed + 889, violet, 7);
}

function drawOfficialQuarantineClearanceSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [214, 204, 158];
  const light: [number, number, number] = [244, 236, 190];
  const ink: [number, number, number] = [30, 28, 22];
  const red: [number, number, number] = [184, 38, 44];
  const green: [number, number, number] = [74, 146, 102];
  const glass: [number, number, number] = [124, 190, 166];
  const damp: [number, number, number] = [82, 96, 88];
  const iodine: [number, number, number] = [122, 88, 38];

  rect(t, 16, 10, 49, 54, paper, seed + 1278, 248);
  rect(t, 19, 13, 46, 19, light, seed + 1279, 226);
  outlineRect(t, 16, 10, 49, 54, ink);
  clearRect(t, 16, 10, 20, 13);
  clearRect(t, 47, 11, 49, 17);
  clearRect(t, 17, 51, 20, 54);
  rect(t, 16, 47, 49, 54, damp, seed + 1280, 92);
  rect(t, 28, 22, 36, 41, red, seed + 1281, 238);
  rect(t, 21, 29, 43, 36, red, seed + 1282, 238);
  rect(t, 23, 43, 39, 44, ink, 0, 130);
  rect(t, 23, 48, 34, 49, ink, 0, 112);
  ellipse(t, 41, 36, 7.8, 5.4, green, seed + 1283, 218);
  line(t, 37, 36, 40, 39, 1.1, light, seed + 1284, 230);
  line(t, 40, 39, 47, 31, 1.1, light, seed + 1285, 230);
  rect(t, 22, 21, 29, 27, glass, seed + 1286, 190);
  rect(t, 24, 19, 27, 22, ink, seed + 1287, 200);
  ellipse(t, 25, 47, 6.5, 3.2, iodine, seed + 1288, 118);
  drawNoiseDust(t, seed + 1289, iodine, 9);
  drawNoiseDust(t, seed + 1290, green, 8);
}

function drawPainkillerPackSprite(t: Uint32Array, seed: number): void {
  const foil: [number, number, number] = [186, 188, 172];
  const foilLight: [number, number, number] = [232, 230, 200];
  const ink: [number, number, number] = [40, 38, 34];
  const red: [number, number, number] = [178, 38, 42];
  const pill: [number, number, number] = [232, 222, 178];
  const green: [number, number, number] = [82, 154, 112];
  const grime: [number, number, number] = [90, 84, 68];

  rect(t, 15, 20, 51, 48, foil, seed + 1296, 248);
  rect(t, 18, 22, 48, 26, foilLight, seed + 1297, 220);
  outlineRect(t, 15, 20, 51, 48, ink);
  clearRect(t, 15, 20, 18, 23);
  clearRect(t, 49, 21, 51, 25);
  clearRect(t, 16, 45, 19, 48);
  for (let x = 22; x <= 43; x += 10) {
    for (let y = 31; y <= 42; y += 8) {
      ellipse(t, x, y, 4.2, 3.2, pill, seed + 1298 + x + y, 238);
      ellipse(t, x, y, 2.1, 1.6, foilLight, seed + 1299 + x + y, 110);
    }
  }
  rect(t, 19, 26, 47, 31, red, seed + 1300, 222);
  rect(t, 29, 23, 35, 45, red, seed + 1301, 216);
  rect(t, 40, 27, 48, 30, green, seed + 1302, 170);
  line(t, 18, 46, 49, 23, 0.9, grime, seed + 1303, 92);
  drawNoiseDust(t, seed + 1304, grime, 12);
  drawNoiseDust(t, seed + 1305, green, 7);
}

function drawLiceShampooSprite(t: Uint32Array, seed: number): void {
  const plastic: [number, number, number] = [178, 188, 164];
  const plasticLight: [number, number, number] = [226, 232, 196];
  const green: [number, number, number] = [78, 150, 106];
  const dark: [number, number, number] = [34, 48, 44];
  const red: [number, number, number] = [184, 38, 44];
  const grime: [number, number, number] = [82, 78, 58];

  ellipse(t, 32, 52, 12, 3.5, [24, 28, 22], seed + 1310, 78);
  rect(t, 25, 13, 39, 20, dark, seed + 1311, 246);
  rect(t, 27, 9, 37, 15, green, seed + 1312, 238);
  rect(t, 22, 20, 43, 51, plastic, seed + 1313, 248);
  ellipse(t, 32.5, 20, 10.5, 4.5, plasticLight, seed + 1314, 218);
  ellipse(t, 32.5, 51, 10.5, 4.0, dark, seed + 1315, 135);
  outlineRect(t, 22, 20, 43, 51, dark);
  clearRect(t, 22, 20, 25, 23);
  clearRect(t, 41, 21, 43, 25);
  clearRect(t, 23, 48, 26, 51);

  rect(t, 24, 29, 41, 43, plasticLight, seed + 1316, 232);
  rect(t, 31, 31, 35, 41, red, seed + 1317, 236);
  rect(t, 27, 34, 39, 38, red, seed + 1318, 236);
  rect(t, 26, 44, 39, 46, dark, seed + 1319, 135);
  for (let i = 0; i < 5; i++) {
    const x = 25 + i * 4;
    const y = 25 + ((seed >>> i) & 5);
    ellipse(t, x, y, 1.5, 1.2, dark, seed + 1320 + i, 175);
    line(t, x - 2, y + 2, x + 2, y - 2, 0.45, dark, seed + 1325 + i, 130);
  }
  rect(t, 37, 27, 45, 32, green, seed + 1330, 178);
  line(t, 24, 21, 41, 49, 0.8, plasticLight, seed + 1331, 128);
  line(t, 23, 48, 42, 32, 0.8, grime, seed + 1332, 100);
  drawNoiseDust(t, seed + 1333, grime, 10);
  drawNoiseDust(t, seed + 1334, green, 6);
}

function drawMorphineAmpouleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [104, 158, 158];
  const glassLight: [number, number, number] = [214, 236, 224];
  const glassDark: [number, number, number] = [24, 42, 44];
  const medicine: [number, number, number] = [102, 204, 164];
  const medicineLight: [number, number, number] = [156, 236, 192];
  const paper: [number, number, number] = [214, 206, 164];
  const red: [number, number, number] = [184, 40, 44];
  const grime: [number, number, number] = [78, 68, 48];

  ellipse(t, 33, 52, 14, 3.5, [12, 18, 16], seed + 1340, 74);
  line(t, 21, 47, 42, 14, 5.6, glassDark, seed + 1341, 236);
  line(t, 22, 46, 41, 15, 3.8, glass, seed + 1342, 184);
  line(t, 24, 43, 39, 18, 2.0, medicine, seed + 1343, 232);
  line(t, 26, 39, 37, 21, 0.8, medicineLight, seed + 1344, 210);
  ellipse(t, 42, 13, 4.0, 2.2, glassLight, seed + 1345, 190);
  ellipse(t, 21, 48, 4.6, 2.4, glassDark, seed + 1346, 170);

  line(t, 28, 35, 38, 20, 5.2, paper, seed + 1347, 238);
  line(t, 29, 34, 37, 21, 0.9, glassDark, seed + 1348, 120);
  rect(t, 31, 28, 34, 38, red, seed + 1349, 232);
  rect(t, 27, 31, 38, 34, red, seed + 1350, 232);
  rect(t, 34, 23, 41, 26, red, seed + 1351, 172);
  line(t, 22, 45, 29, 35, 3.0, medicineLight, seed + 1358, 232);
  line(t, 36, 27, 42, 16, 2.8, medicine, seed + 1359, 224);
  ellipse(t, 24, 43, 3.2, 1.6, medicineLight, 0, 226);
  ellipse(t, 40, 18, 2.6, 1.4, medicine, 0, 220);
  rect(t, 17, 45, 27, 49, paper, seed + 1352, 226);
  rect(t, 19, 46, 25, 47, glassDark, seed + 1353, 130);
  line(t, 19, 47, 40, 18, 0.7, glassLight, seed + 1354, 152);
  line(t, 22, 47, 40, 16, 0.7, grime, seed + 1355, 90);
  drawNoiseDust(t, seed + 1356, grime, 8);
  drawNoiseDust(t, seed + 1357, medicineLight, 8);
}

function drawPsiStabilizerSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [96, 142, 142];
  const glassLight: [number, number, number] = [196, 230, 214];
  const glassDark: [number, number, number] = [24, 42, 44];
  const med: [number, number, number] = [104, 214, 176];
  const cyan: [number, number, number] = [120, 232, 220];
  const violet: [number, number, number] = [144, 82, 210];
  const paper: [number, number, number] = [218, 210, 166];
  const red: [number, number, number] = [184, 38, 48];
  const grime: [number, number, number] = [80, 72, 52];

  ellipse(t, 34, 35, 21, 18, violet, seed + 1360, 34);
  ellipse(t, 32, 52, 15, 3.5, [10, 16, 16], seed + 1361, 76);
  line(t, 18, 47, 40, 14, 6.2, glassDark, seed + 1362, 238);
  line(t, 20, 45, 39, 15, 4.1, glass, seed + 1363, 198);
  line(t, 23, 42, 37, 19, 2.4, med, seed + 1364, 238);
  line(t, 25, 39, 36, 21, 0.8, cyan, seed + 1365, 224);
  ellipse(t, 41, 13, 4.8, 2.4, glassLight, seed + 1366, 205);
  ellipse(t, 18, 48, 5.2, 2.7, glassDark, seed + 1367, 180);

  line(t, 27, 35, 38, 20, 5.5, paper, seed + 1368, 242);
  rect(t, 30, 27, 34, 38, red, seed + 1369, 240);
  rect(t, 26, 31, 38, 34, red, seed + 1370, 240);
  rect(t, 36, 22, 44, 25, red, seed + 1371, 170);
  line(t, 19, 47, 40, 17, 0.8, glassLight, seed + 1372, 150);
  line(t, 21, 48, 40, 18, 0.7, grime, seed + 1373, 95);
  ellipse(t, 23, 43, 3.2, 1.8, cyan, seed + 1374, 210);
  ellipse(t, 37, 19, 2.8, 1.5, med, seed + 1375, 210);
  line(t, 23, 43, 37, 20, 1.2, cyan, seed + 1378, 218);
  ellipse(t, 30, 32, 3.6, 2.0, med, seed + 1379, 214);
  drawNoiseDust(t, seed + 1376, grime, 8);
  drawNoiseDust(t, seed + 1377, cyan, 10);
}

function drawSanitaryKitSprite(t: Uint32Array, seed: number): void {
  const pouch: [number, number, number] = [176, 174, 148];
  const pouchLight: [number, number, number] = [226, 218, 178];
  const dark: [number, number, number] = [64, 70, 64];
  const red: [number, number, number] = [178, 38, 42];
  const green: [number, number, number] = [74, 156, 118];
  const glass: [number, number, number] = [142, 214, 180];
  const paper: [number, number, number] = [210, 198, 150];
  const grime: [number, number, number] = [82, 82, 62];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 18, 4, [16, 16, 14], seed + 1378, 78);
  rect(t, 17, 22, 48, 49, pouch, seed + 1379, 248);
  rect(t, 20, 17, 45, 25, pouchLight, seed + 1380, 230);
  outlineRect(t, 17, 22, 48, 49, dark);
  clearRect(t, 17, 22, 20, 25);
  clearRect(t, 46, 22, 48, 27);
  rect(t, 29, 25, 35, 43, red, seed + 1381, 238);
  rect(t, 22, 31, 42, 37, red, seed + 1382, 238);
  rect(t, 36, 18, 44, 37, green, seed + 1383, 218);
  rect(t, 38, 17, 43, 22, dark, seed + 1384, 238);
  rect(t, 37, 26, 43, 36, glass, seed + 1385, 190);
  ellipse(t, 40, 28, 3.2, 1.8, [210, 244, 210], seed + 1386, 136);
  rect(t, 20, 40, 34, 47, paper, seed + 1387, 220);
  rect(t, 22, 42, 32, 43, dark, 0, 120);
  line(t, 18, 47, 48, 22, 0.9, grime, seed + 1388, 105);
  rect(t, 43, 36, 50, 42, rust, seed + 1389, 128);
  drawNoiseDust(t, seed + 1390, grime, 12);
  drawNoiseDust(t, seed + 1391, glass, 8);
}

function drawTourniquetSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [88, 42, 34];
  const rubberLight: [number, number, number] = [152, 64, 46];
  const dark: [number, number, number] = [24, 20, 18];
  const paper: [number, number, number] = [214, 208, 178];
  const red: [number, number, number] = [184, 36, 38];
  const green: [number, number, number] = [78, 132, 88];
  const metal: [number, number, number] = [154, 150, 128];
  const grime: [number, number, number] = [78, 78, 64];

  ellipse(t, 33, 52, 18, 4, [10, 8, 7], seed + 1392, 76);
  arcLine(t, 32, 34, 18, 13, Math.PI * 0.12, Math.PI * 1.86, 3.2, rubber, seed + 1393, 246, 26);
  arcLine(t, 32, 34, 12, 8, Math.PI * 0.18, Math.PI * 1.80, 1.6, rubberLight, seed + 1394, 220, 24);
  line(t, 19, 42, 43, 21, 3.0, rubber, seed + 1395, 238);
  line(t, 23, 39, 42, 23, 1.4, rubberLight, seed + 1396, 215);
  rect(t, 41, 20, 51, 29, metal, seed + 1397, 230);
  rect(t, 44, 22, 48, 27, dark, seed + 1398, 226);
  rect(t, 18, 37, 34, 46, paper, seed + 1399, 230);
  outlineRect(t, 18, 37, 34, 46, dark);
  rect(t, 25, 39, 28, 45, red, 0, 240);
  rect(t, 21, 41, 32, 43, red, 0, 240);
  rect(t, 19, 45, 31, 46, green, seed + 1400, 128);
  line(t, 20, 46, 49, 23, 0.8, grime, seed + 1401, 120);
  drawNoiseDust(t, seed + 1402, grime, 12);
}


function drawSleepingPillsSprite(t: Uint32Array, seed: number): void {
  const foil: [number, number, number] = [176, 184, 174];
  const foilLight: [number, number, number] = [226, 226, 204];
  const foilDark: [number, number, number] = [64, 72, 68];
  const red: [number, number, number] = [176, 40, 44];
  const green: [number, number, number] = [72, 154, 118];
  const pill: [number, number, number] = [226, 216, 186];
  const missing: [number, number, number] = [42, 48, 46];
  const damp: [number, number, number] = [68, 88, 76];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [16, 16, 14], seed + 1392, 78);
  rect(t, 16, 20, 50, 49, foil, seed + 1393, 246);
  rect(t, 19, 15, 47, 24, foilLight, seed + 1394, 238);
  outlineRect(t, 16, 20, 50, 49, foilDark);
  clearRect(t, 16, 20, 19, 23);
  clearRect(t, 48, 20, 50, 24);
  clearRect(t, 17, 47, 21, 49);

  rect(t, 20, 23, 47, 28, red, seed + 1395, 224);
  rect(t, 23, 25, 43, 26, foilLight, seed + 1396, 168);
  rect(t, 42, 30, 46, 43, green, seed + 1397, 160);
  rect(t, 43, 32, 45, 40, [126, 216, 160], seed + 1398, 150);
  const blisters = [
    [25, 34], [32, 33], [39, 34],
    [25, 43], [32, 42], [39, 43],
  ] as const;
  for (let i = 0; i < blisters.length; i++) {
    const [cx, cy] = blisters[i];
    ellipse(t, cx, cy, 4.8, 3.6, foilDark, seed + 1399 + i, 132);
    ellipse(t, cx, cy, 3.2, 2.4, i === 2 ? missing : pill, seed + 1406 + i, i === 2 ? 155 : 232);
    if (i !== 2) px(t, cx - 1, cy - 1, rgba(248, 238, 198, 180));
  }
  line(t, 18, 48, 49, 22, 0.8, damp, seed + 1413, 105);
  rect(t, 36, 46, 46, 48, rust, seed + 1414, 142);
  drawNoiseDust(t, seed + 1415, damp, 13);
  drawNoiseDust(t, seed + 1416, rust, 7);
}



function drawZhelemishBoiledSprite(t: Uint32Array, seed: number): void {
  const clothDark: [number, number, number] = [74, 76, 62];
  const cloth: [number, number, number] = [176, 168, 128];
  const clothLight: [number, number, number] = [226, 214, 164];
  const slime: [number, number, number] = [104, 190, 120];
  const slimeGlow: [number, number, number] = [164, 232, 158];
  const red: [number, number, number] = [180, 44, 44];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 33, 52, 17, 4, [10, 12, 8], seed + 1792, 82);
  rect(t, 16, 22, 49, 48, cloth, seed + 1793, 248);
  rect(t, 19, 24, 46, 29, clothLight, seed + 1794, 190);
  outlineRect(t, 16, 22, 49, 48, clothDark);
  clearRect(t, 16, 22, 20, 25);
  clearRect(t, 47, 23, 49, 28);
  clearRect(t, 17, 45, 21, 48);
  ellipse(t, 32, 37, 12, 8, slime, seed + 1795, 198);
  ellipse(t, 30, 35, 7, 4, slimeGlow, seed + 1796, 150);
  rect(t, 29, 26, 35, 44, red, seed + 1797, 234);
  rect(t, 22, 32, 42, 38, red, seed + 1798, 234);
  line(t, 17, 46, 47, 26, 0.9, rust, seed + 1799, 128);
  for (let i = 0; i < 7; i++) {
    const x = 21 + Math.floor(noise(i, 93, seed) * 23);
    const y = 30 + Math.floor(noise(i, 94, seed) * 14);
    ellipse(t, x, y, 1.1, 0.9, slimeGlow, seed + 1800 + i, 150);
  }
  drawNoiseDust(t, seed + 1808, rust, 10);
  drawNoiseDust(t, seed + 1809, slimeGlow, 9);
}

function drawEmptySyringeSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [170, 218, 206];
  const glassDark: [number, number, number] = [42, 66, 64];
  const plunger: [number, number, number] = [214, 214, 180];
  const plungerDark: [number, number, number] = [86, 86, 74];
  const needle: [number, number, number] = [176, 188, 176];
  const red: [number, number, number] = [178, 42, 38];
  const green: [number, number, number] = [70, 146, 104];
  const rust: [number, number, number] = [124, 64, 38];

  ellipse(t, 33, 52, 17, 4, [10, 12, 10], seed + 490, 74);
  line(t, 15, 46, 31, 32, 2.2, plungerDark, seed + 491, 230);
  line(t, 17, 44, 32, 31, 1.1, plunger, seed + 492, 220);
  line(t, 13, 48, 19, 42, 2.0, plunger, seed + 493, 230);
  line(t, 21, 52, 15, 45, 2.0, plunger, seed + 494, 220);

  line(t, 28, 36, 48, 18, 6.0, glassDark, seed + 495, 215);
  line(t, 29, 35, 47, 19, 3.8, glass, seed + 496, 178);
  line(t, 32, 33, 45, 21, 0.9, [230, 246, 226], seed + 497, 170);
  for (let i = 0; i < 5; i++) {
    const x = 33 + i * 3;
    const y = 32 - i * 3;
    line(t, x - 2, y - 1, x + 1, y + 2, 0.6, glassDark, seed + 498 + i, 150);
  }
  rect(t, 30, 36, 36, 40, red, seed + 503, 205);
  rect(t, 31, 37, 35, 38, glass, seed + 504, 150);
  rect(t, 40, 23, 46, 26, green, seed + 505, 178);
  line(t, 45, 20, 55, 11, 1.1, needle, seed + 506, 235);
  line(t, 55, 11, 59, 8, 0.6, needle, seed + 507, 215);
  px(t, 59, 8, rgba(needle[0], needle[1], needle[2], 220));
  line(t, 21, 47, 47, 22, 0.8, rust, seed + 508, 112);
  drawNoiseDust(t, seed + 509, rust, 8);
  drawNoiseDust(t, seed + 510, glass, 9);
}

function drawSterileBandageSprite(t: Uint32Array, seed: number): void {
  const pouch: [number, number, number] = [206, 210, 188];
  const pouchLight: [number, number, number] = [242, 238, 206];
  const edge: [number, number, number] = [64, 74, 70];
  const cloth: [number, number, number] = [226, 224, 198];
  const clothShadow: [number, number, number] = [124, 138, 126];
  const red: [number, number, number] = [188, 38, 42];
  const green: [number, number, number] = [78, 150, 116];
  const grime: [number, number, number] = [112, 72, 42];

  ellipse(t, 33, 53, 17, 4, [12, 14, 12], seed + 2810, 76);
  rect(t, 15, 18, 51, 49, pouch, seed + 2811, 236);
  rect(t, 18, 15, 48, 22, pouchLight, seed + 2812, 222);
  outlineRect(t, 15, 18, 51, 49, edge);
  clearRect(t, 15, 18, 18, 21);
  clearRect(t, 49, 19, 51, 24);
  clearRect(t, 16, 46, 20, 49);
  line(t, 18, 22, 49, 47, 0.8, edge, seed + 2813, 82);
  rect(t, 17, 43, 51, 49, green, seed + 2814, 76);
  ellipse(t, 27, 35, 10, 9, clothShadow, seed + 2815, 220);
  ellipse(t, 27, 35, 7, 6, cloth, seed + 2816, 236);
  ellipse(t, 27, 35, 3.0, 2.3, edge, seed + 2817, 210);
  rect(t, 33, 28, 47, 41, cloth, seed + 2818, 232);
  rect(t, 36, 30, 44, 33, pouchLight, seed + 2819, 160);
  outlineRect(t, 33, 28, 47, 41, edge);
  rect(t, 39, 25, 44, 44, red, seed + 2820, 235);
  rect(t, 31, 32, 50, 37, red, seed + 2821, 235);
  rect(t, 22, 21, 36, 24, green, seed + 2822, 168);
  rect(t, 24, 22, 33, 23, pouchLight, seed + 2823, 150);
  line(t, 19, 46, 49, 43, 0.9, grime, seed + 2824, 112);
  drawNoiseDust(t, seed + 2825, grime, 8);
  drawNoiseDust(t, seed + 2826, pouchLight, 8);
}

function drawSterileSwabSprite(t: Uint32Array, seed: number): void {
  const pouch: [number, number, number] = [198, 210, 196];
  const pouchLight: [number, number, number] = [236, 242, 214];
  const edge: [number, number, number] = [58, 74, 70];
  const stick: [number, number, number] = [214, 206, 166];
  const cotton: [number, number, number] = [232, 232, 208];
  const green: [number, number, number] = [70, 172, 124];
  const cyan: [number, number, number] = [86, 224, 198];
  const red: [number, number, number] = [184, 38, 44];
  const grime: [number, number, number] = [104, 72, 44];

  ellipse(t, 33, 53, 18, 4, [10, 12, 10], seed + 2830, 76);
  rect(t, 13, 22, 52, 46, pouch, seed + 2831, 206);
  rect(t, 16, 19, 49, 25, pouchLight, seed + 2832, 188);
  outlineRect(t, 13, 22, 52, 46, edge);
  clearRect(t, 13, 22, 17, 25);
  clearRect(t, 50, 23, 52, 28);
  clearRect(t, 14, 43, 18, 46);
  line(t, 15, 44, 51, 24, 0.8, grime, seed + 2833, 100);
  line(t, 17, 41, 47, 25, 2.0, stick, seed + 2834, 235);
  line(t, 18, 40, 46, 25, 0.8, edge, seed + 2835, 120);
  ellipse(t, 17, 41, 4.8, 3.4, cotton, seed + 2836, 238);
  ellipse(t, 45, 26, 4.6, 3.0, cotton, seed + 2837, 226);
  rect(t, 29, 25, 43, 39, green, seed + 2838, 190);
  rect(t, 31, 27, 41, 29, pouchLight, seed + 2839, 145);
  rect(t, 31, 33, 42, 35, red, seed + 2840, 185);
  ellipse(t, 40, 38, 7.5, 4.2, cyan, seed + 2841, 108);
  ellipse(t, 44, 30, 7.5, 7.5, cyan, seed + 2842, 112);
  drawNoiseDust(t, seed + 2843, cyan, 12);
  drawNoiseDust(t, seed + 2844, grime, 8);
}

function drawMedicineSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'tourniquet') {
    drawTourniquetSprite(t, seed);
    return;
  }
  if (defId === 'sterile_bandage') {
    drawSterileBandageSprite(t, seed);
    return;
  }
  if (defId === 'sterile_swab') {
    drawSterileSwabSprite(t, seed);
    return;
  }
  if (defId === 'syringe_empty') {
    drawEmptySyringeSprite(t, seed);
    return;
  }
  if (defId === 'sleeping_pills') {
    drawSleepingPillsSprite(t, seed);
    return;
  }
  if (defId === 'quarantine_medcard') {
    drawQuarantineMedcardSprite(t, seed);
    return;
  }
  if (defId === 'sanitary_kit') {
    drawSanitaryKitSprite(t, seed);
    return;
  }
  if (defId === 'psi_stabilizer') {
    drawPsiStabilizerSprite(t, seed);
    return;
  }
  if (defId === 'morphine_ampoule') {
    drawMorphineAmpouleSprite(t, seed);
    return;
  }
  if (defId === 'pills') {
    drawPillsSprite(t, seed);
    return;
  }
  if (defId === 'permanganate_vial') {
    drawPermanganateVialSprite(t, seed);
    return;
  }
  if (defId === 'lice_shampoo') {
    drawLiceShampooSprite(t, seed);
    return;
  }
  if (defId === 'official_quarantine_clearance') {
    drawOfficialQuarantineClearanceSprite(t, seed);
    return;
  }
  if (defId === 'painkiller_pack') {
    drawPainkillerPackSprite(t, seed);
    return;
  }
  if (defId === 'iodine') {
    drawIodineSprite(t, seed);
    return;
  }
  if (defId === 'burn_gel') {
    drawBurnGelSprite(t, seed);
    return;
  }
  if (defId === 'bandage') {
    drawBandageSprite(t, seed);
    return;
  }
  if (defId === 'antidep') {
    drawAntidepSprite(t, seed);
    return;
  }
  if (defId === 'antifungal_ointment') {
    drawAntifungalOintmentSprite(t, seed);
    return;
  }
  if (defId === 'anti_spore_inhaler') {
    drawAntiSporeInhalerSprite(t, seed);
    return;
  }
  if (defId === 'antibiotic') {
    drawAntibioticSprite(t, seed);
    return;
  }
  if (defId === 'antiemetic') {
    drawAntiemeticSprite(t, seed);
    return;
  }
  if (defId === 'body_bag_roll') {
    drawBodyBagRollSprite(t, seed);
    return;
  }
  if (defId === 'cleanup_tongs') {
    drawCleanupTongsSprite(t, seed);
    return;
  }
  if (defId === 'cloth_roll') {
    drawClothRollSprite(t, seed);
    return;
  }
  if (defId === 'cotton_wool') {
    drawCottonWoolSprite(t, seed);
    return;
  }
  if (defId === 'holy_water') {
    drawHolyWaterSprite(t, seed);
    return;
  }
  if (defId === 'zhelemish_boiled') {
    drawZhelemishBoiledSprite(t, seed);
    return;
  }
  if (defId.includes('ampoule') || defId.includes('vial') || defId.includes('inhaler')) {
    rect(t, 26, 14, 38, 48, p.light, seed + 41, 210);
    rect(t, 28, 26, 36, 47, p.glow, seed + 42, 190);
    rect(t, 27, 12, 37, 16, p.dark, seed + 43);
  } else if (defId.includes('bandage') || defId.includes('wool')) {
    ellipse(t, 32, 35, 17, 11, p.light, seed + 44);
    ellipse(t, 32, 35, 8, 5, p.body, seed + 45);
    line(t, 19, 35, 45, 35, 1.2, p.dark, seed + 46, 130);
  } else {
    rect(t, 18, 22, 46, 48, p.body, seed + 47);
    outlineRect(t, 18, 22, 46, 48, p.dark);
    rect(t, 29, 27, 35, 43, p.accent, 0, 245);
    rect(t, 23, 33, 41, 38, p.accent, 0, 245);
  }
}

function drawAgniaA130Sprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [38, 48, 56];
  const dark: [number, number, number] = [10, 14, 18];
  const light: [number, number, number] = [104, 124, 132];
  const rust: [number, number, number] = [126, 66, 34];
  const warning: [number, number, number] = [214, 162, 48];
  const red: [number, number, number] = [196, 54, 38];

  line(t, 15, 46, 38, 35, 6.2, dark, seed + 61, 238);
  line(t, 17, 45, 37, 36, 4.6, metal, seed + 62, 248);
  line(t, 23, 42, 30, 39, 2.6, warning, seed + 63, 245);
  rect(t, 31, 34, 39, 37, red, seed + 64, 220);
  ellipse(t, 17, 45, 4, 5, light, seed + 65, 214);
  ellipse(t, 38, 35, 3, 4, dark, seed + 66, 230);

  line(t, 17, 42, 51, 24, 3, dark, seed + 67, 255);
  line(t, 22, 39, 49, 25, 1.5, light, seed + 68, 245);
  line(t, 40, 29, 55, 21, 2.4, dark, seed + 69, 255);
  line(t, 43, 28, 53, 22, 1.2, metal, seed + 70, 250);
  ellipse(t, 54, 21, 4.2, 2.4, red, seed + 71, 230);
  ellipse(t, 56, 20, 2.4, 1.5, [230, 98, 42], seed + 72, 190);

  rect(t, 19, 42, 27, 50, [70, 44, 30], seed + 73, 245);
  line(t, 28, 39, 33, 47, 1.5, dark, seed + 74, 230);
  line(t, 21, 38, 43, 28, 1.1, rust, seed + 75, 210);

  for (let i = 0; i < 10; i++) {
    const x = 18 + Math.floor(noise(i, 30, seed) * 25);
    const y = 31 + Math.floor(noise(i, 31, seed) * 17);
    const c = (i & 1) === 0 ? rust : light;
    ellipse(t, x, y, 1.1, 1.1, c, seed + 80 + i, (i & 1) === 0 ? 160 : 120);
  }
}

function drawAk47Sprite(t: Uint32Array, seed: number, p: Palette): void {
  const blackMetal: [number, number, number] = [20, 25, 27];
  const blueMetal: [number, number, number] = [58, 70, 74];
  const wornEdge: [number, number, number] = [122, 132, 124];
  const oldWood: [number, number, number] = [96, 57, 32];
  const rust: [number, number, number] = [148, 63, 35];
  const serviceMark: [number, number, number] = [211, 159, 58];

  line(t, 13, 45, 28, 37, 3.8, oldWood, seed + 501);
  ellipse(t, 13, 46, 4.2, 5.4, oldWood, seed + 502);
  line(t, 22, 35, 55, 21, 1.8, blackMetal, seed + 503);
  line(t, 26, 34, 51, 23, 1.1, wornEdge, seed + 504, 205);
  line(t, 28, 37, 43, 30, 4.1, blueMetal, seed + 505);
  line(t, 27, 39, 41, 33, 2.2, oldWood, seed + 506, 235);
  line(t, 30, 38, 27, 48, 2.7, oldWood, seed + 507);
  line(t, 35, 37, 35, 47, 3.4, blackMetal, seed + 508);
  line(t, 38, 37, 41, 48, 3.0, blueMetal, seed + 509);
  ellipse(t, 40, 49, 4, 2.2, blackMetal, seed + 510);
  rect(t, 43, 27, 47, 29, blackMetal, seed + 511);
  line(t, 50, 23, 57, 20, 1.1, blackMetal, seed + 512);
  px(t, 57, 20, rgba(serviceMark[0], serviceMark[1], serviceMark[2], 225));
  rect(t, 33, 35, 37, 37, serviceMark, seed + 513, 220);
  rect(t, 23, 39, 28, 41, rust, seed + 514, 190);
  rect(t, 41, 30, 44, 31, rust, seed + 515, 180);
  drawNoiseDust(t, seed + 516, rust, 7);
  drawNoiseDust(t, seed + 517, p.dark, 5);
}

function drawBayonetSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 17, 20];
  const blueMetal: [number, number, number] = [42, 58, 66];
  const wornEdge: [number, number, number] = [132, 148, 146];
  const grip: [number, number, number] = [54, 42, 32];
  const rust: [number, number, number] = [142, 68, 34];
  const serviceYellow: [number, number, number] = [214, 158, 48];
  const redStamp: [number, number, number] = [172, 44, 36];

  line(t, 13, 52, 24, 42, 3.8, blackMetal, seed + 520, 246);
  line(t, 15, 51, 24, 43, 2.1, grip, seed + 521, 238);
  line(t, 20, 45, 30, 54, 1.6, blackMetal, seed + 522, 245);
  line(t, 21, 45, 29, 52, 0.8, serviceYellow, seed + 523, 230);

  line(t, 22, 43, 51, 13, 3.1, blackMetal, seed + 524, 255);
  line(t, 24, 41, 49, 15, 2.0, blueMetal, seed + 525, 252);
  line(t, 26, 39, 49, 15, 0.85, wornEdge, seed + 526, 235);
  line(t, 20, 46, 47, 18, 0.85, blackMetal, seed + 527, 190);
  line(t, 46, 17, 55, 8, 1.5, wornEdge, seed + 528, 248);
  line(t, 47, 17, 53, 10, 0.8, blackMetal, seed + 529, 190);
  px(t, 55, 8, rgba(wornEdge[0], wornEdge[1], wornEdge[2], 220));

  rect(t, 25, 40, 31, 43, serviceYellow, seed + 530, 235);
  rect(t, 28, 37, 35, 39, redStamp, seed + 531, 214);
  line(t, 23, 43, 30, 36, 0.8, rust, seed + 532, 160);
  rect(t, 37, 25, 40, 26, rust, seed + 533, 170);
  rect(t, 44, 18, 46, 19, rust, seed + 534, 155);
  drawNoiseDust(t, seed + 535, rust, 7);
}

function drawRakeBayonetSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [10, 16, 18];
  const blueMetal: [number, number, number] = [38, 56, 64];
  const wornEdge: [number, number, number] = [138, 150, 144];
  const grip: [number, number, number] = [56, 42, 30];
  const serviceYellow: [number, number, number] = [216, 158, 48];
  const red: [number, number, number] = [176, 42, 36];
  const rust: [number, number, number] = [142, 66, 34];

  line(t, 13, 52, 26, 43, 4.0, blackMetal, seed + 536, 248);
  line(t, 15, 51, 25, 44, 2.2, grip, seed + 537, 240);
  rect(t, 22, 42, 31, 45, serviceYellow, seed + 538, 230);
  rect(t, 26, 39, 34, 41, red, seed + 539, 214);

  line(t, 24, 43, 51, 17, 3.4, blackMetal, seed + 540, 255);
  line(t, 26, 41, 49, 18, 2.0, blueMetal, seed + 541, 252);
  line(t, 28, 39, 49, 18, 0.9, wornEdge, seed + 542, 238);
  line(t, 22, 46, 48, 20, 0.9, blackMetal, seed + 543, 190);

  line(t, 48, 18, 57, 12, 1.45, wornEdge, seed + 544, 248);
  line(t, 50, 19, 59, 17, 1.25, wornEdge, seed + 545, 246);
  line(t, 51, 21, 57, 25, 1.2, wornEdge, seed + 546, 240);
  line(t, 47, 19, 54, 10, 0.75, blackMetal, seed + 547, 185);
  line(t, 49, 20, 59, 16, 0.7, blackMetal, seed + 548, 180);
  line(t, 50, 22, 57, 25, 0.7, blackMetal, seed + 549, 175);

  line(t, 22, 44, 31, 36, 0.8, rust, seed + 550, 160);
  rect(t, 38, 27, 41, 28, rust, seed + 551, 172);
  rect(t, 44, 21, 47, 22, rust, seed + 552, 160);
  drawNoiseDust(t, seed + 553, rust, 9);
}

function drawBfgSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [9, 13, 16];
  const blueMetal: [number, number, number] = [36, 52, 61];
  const wornEdge: [number, number, number] = [104, 126, 130];
  const rust: [number, number, number] = [132, 61, 31];
  const warning: [number, number, number] = [216, 162, 46];
  const redSeal: [number, number, number] = [184, 45, 36];
  const charge: [number, number, number] = [104, 240, 84];

  line(t, 11, 47, 35, 35, 7.2, blackMetal, seed + 561, 248);
  line(t, 14, 46, 35, 36, 5.2, blueMetal, seed + 562, 248);
  ellipse(t, 18, 45, 6.2, 5.4, wornEdge, seed + 563, 190);
  rect(t, 19, 42, 29, 51, [48, 38, 30], seed + 564, 248);
  line(t, 30, 38, 35, 48, 2.4, blackMetal, seed + 565, 245);

  line(t, 20, 40, 43, 29, 8.2, blackMetal, seed + 566, 255);
  line(t, 23, 39, 42, 30, 5.6, blueMetal, seed + 567, 250);
  line(t, 25, 37, 43, 29, 1.5, wornEdge, seed + 568, 220);
  rect(t, 30, 33, 43, 39, blackMetal, seed + 569, 248);
  rect(t, 31, 34, 42, 37, blueMetal, seed + 570, 248);

  ellipse(t, 40, 32, 8.2, 6.2, blackMetal, seed + 571, 248);
  ellipse(t, 40, 32, 5.4, 4.1, charge, seed + 572, 225);
  ellipse(t, 40, 32, 2.2, 1.7, [210, 255, 170], seed + 573, 205);
  line(t, 33, 31, 47, 33, 0.8, wornEdge, seed + 574, 185);
  line(t, 35, 27, 45, 38, 0.8, blackMetal, seed + 575, 160);

  line(t, 39, 30, 57, 21, 4.5, blackMetal, seed + 576, 255);
  line(t, 42, 29, 55, 22, 2.5, wornEdge, seed + 577, 230);
  line(t, 42, 35, 58, 27, 3.4, blackMetal, seed + 578, 250);
  line(t, 44, 34, 56, 28, 1.6, blueMetal, seed + 579, 238);
  ellipse(t, 57, 21, 3.6, 2.4, charge, seed + 580, 185);
  ellipse(t, 58, 27, 2.8, 1.8, charge, seed + 581, 155);

  rect(t, 22, 40, 32, 42, warning, seed + 582, 235);
  rect(t, 34, 35, 38, 37, redSeal, seed + 583, 220);
  rect(t, 45, 26, 49, 28, rust, seed + 584, 170);
  line(t, 21, 43, 43, 31, 1.1, rust, seed + 585, 132);
  drawNoiseDust(t, seed + 586, rust, 9);
  drawNoiseDust(t, seed + 587, wornEdge, 5);
}

function drawAto41AtomicFlamerSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 16, 18];
  const blueMetal: [number, number, number] = [38, 54, 62];
  const wornEdge: [number, number, number] = [98, 118, 120];
  const rubber: [number, number, number] = [42, 33, 27];
  const rust: [number, number, number] = [132, 62, 32];
  const warning: [number, number, number] = [214, 158, 48];
  const redSeal: [number, number, number] = [188, 46, 36];
  const hotNozzle: [number, number, number] = [232, 94, 38];

  line(t, 12, 47, 29, 39, 5.4, blackMetal, seed + 531, 245);
  line(t, 14, 46, 27, 40, 3.2, rubber, seed + 532, 238);
  rect(t, 21, 42, 29, 51, rubber, seed + 533, 245);
  line(t, 29, 39, 34, 47, 1.6, blackMetal, seed + 534, 230);

  line(t, 18, 41, 44, 28, 5.4, blackMetal, seed + 535, 255);
  line(t, 20, 40, 42, 29, 3.7, blueMetal, seed + 536, 250);
  line(t, 22, 47, 49, 33, 5.1, blackMetal, seed + 537, 255);
  line(t, 24, 46, 47, 34, 3.5, blueMetal, seed + 538, 250);
  ellipse(t, 19, 41, 3.2, 4.1, wornEdge, seed + 539, 205);
  ellipse(t, 24, 47, 3, 3.8, wornEdge, seed + 540, 205);
  ellipse(t, 44, 28, 3.4, 3.6, blackMetal, seed + 541, 235);
  ellipse(t, 49, 33, 3.2, 3.4, blackMetal, seed + 542, 235);

  line(t, 30, 35, 34, 43, 1.7, warning, seed + 543, 245);
  line(t, 36, 32, 40, 40, 1.5, redSeal, seed + 544, 235);
  rect(t, 33, 35, 41, 38, redSeal, seed + 545, 218);
  rect(t, 35, 36, 39, 37, warning, seed + 546, 218);

  line(t, 39, 30, 55, 21, 2.9, blackMetal, seed + 547, 255);
  line(t, 41, 29, 54, 22, 1.5, wornEdge, seed + 548, 235);
  line(t, 49, 25, 57, 20, 1.8, blackMetal, seed + 549, 255);
  ellipse(t, 56, 20, 4.1, 2.5, redSeal, seed + 550, 235);
  ellipse(t, 58, 19, 2.3, 1.5, hotNozzle, seed + 551, 205);

  line(t, 25, 44, 47, 33, 0.9, wornEdge, seed + 552, 150);
  line(t, 22, 39, 43, 29, 0.9, wornEdge, seed + 553, 145);
  line(t, 20, 43, 45, 30, 1, rust, seed + 554, 130);
  rect(t, 27, 43, 31, 45, rust, seed + 555, 180);
  rect(t, 43, 31, 47, 33, rust, seed + 556, 168);
  px(t, 36, 34, rgba(236, 210, 92, 205));
  px(t, 38, 36, rgba(236, 210, 92, 195));
  drawNoiseDust(t, seed + 557, rust, 9);
}

function drawAxeSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [16, 21, 24];
  const blueMetal: [number, number, number] = [50, 64, 70];
  const cuttingEdge: [number, number, number] = [154, 170, 164];
  const handle: [number, number, number] = [62, 43, 30];
  const redPaint: [number, number, number] = [186, 42, 34];
  const serviceYellow: [number, number, number] = [216, 154, 46];
  const rust: [number, number, number] = [132, 66, 36];

  line(t, 16, 51, 42, 20, 4.2, blackMetal, seed + 560, 248);
  line(t, 18, 49, 40, 23, 2.6, handle, seed + 561, 245);
  rect(t, 20, 43, 27, 50, redPaint, seed + 562, 220);
  line(t, 24, 43, 29, 49, 0.8, serviceYellow, seed + 563, 210);

  ellipse(t, 42, 20, 9.5, 6.5, blueMetal, seed + 564, 250);
  ellipse(t, 48, 21, 7, 4.6, cuttingEdge, seed + 565, 248);
  ellipse(t, 39, 19, 4, 3, blackMetal, seed + 566, 220);
  line(t, 38, 18, 54, 13, 1.8, cuttingEdge, seed + 567, 245);
  line(t, 38, 19, 48, 29, 2, blueMetal, seed + 568, 240);
  line(t, 35, 24, 46, 18, 1.3, blackMetal, seed + 569, 210);
  rect(t, 40, 21, 47, 24, redPaint, seed + 570, 210);

  line(t, 35, 25, 49, 18, 0.9, rust, seed + 571, 175);
  rect(t, 44, 26, 50, 28, rust, seed + 572, 160);
  rect(t, 33, 29, 37, 31, serviceYellow, seed + 573, 185);
  drawNoiseDust(t, seed + 574, rust, 7);
}

function drawLiquidatorAxeSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 20];
  const blueMetal: [number, number, number] = [42, 58, 64];
  const edge: [number, number, number] = [154, 174, 168];
  const haft: [number, number, number] = [50, 42, 34];
  const red: [number, number, number] = [190, 42, 34];
  const yellow: [number, number, number] = [218, 158, 48];
  const rust: [number, number, number] = [136, 66, 36];
  const slime: [number, number, number] = [78, 150, 92];

  ellipse(t, 33, 53, 16, 4, [10, 11, 10], seed + 575, 82);
  line(t, 14, 52, 43, 20, 5.2, blackMetal, seed + 576, 250);
  line(t, 16, 50, 41, 23, 3.3, haft, seed + 577, 248);
  rect(t, 18, 45, 29, 52, red, seed + 578, 218);
  rect(t, 21, 46, 28, 48, yellow, seed + 579, 196);

  ellipse(t, 43, 20, 12.5, 8.5, blackMetal, seed + 580, 250);
  ellipse(t, 48, 21, 9.2, 6.4, edge, seed + 581, 246);
  ellipse(t, 38, 20, 6.2, 5.2, blueMetal, seed + 582, 245);
  line(t, 35, 18, 56, 11, 2.3, edge, seed + 583, 245);
  line(t, 36, 19, 49, 31, 2.5, blueMetal, seed + 584, 240);
  line(t, 33, 25, 47, 17, 1.4, blackMetal, seed + 585, 215);
  rect(t, 39, 22, 49, 26, red, seed + 586, 215);
  rect(t, 42, 23, 48, 24, yellow, seed + 587, 205);
  line(t, 33, 28, 52, 16, 1.0, rust, seed + 588, 175);
  rect(t, 44, 28, 51, 30, rust, seed + 589, 166);
  rect(t, 35, 31, 40, 33, slime, seed + 590, 155);
  drawNoiseDust(t, seed + 591, rust, 8);
  drawNoiseDust(t, seed + 592, slime, 6);
}

function drawRustyRakeSprite(t: Uint32Array, seed: number): void {
  const wood: [number, number, number] = [92, 58, 34];
  const woodLight: [number, number, number] = [142, 92, 48];
  const blackMetal: [number, number, number] = [26, 30, 28];
  const rustyMetal: [number, number, number] = [132, 66, 34];
  const rustLight: [number, number, number] = [190, 96, 42];
  const edge: [number, number, number] = [132, 138, 120];
  const rag: [number, number, number] = [150, 34, 32];
  const grime: [number, number, number] = [30, 34, 28];

  ellipse(t, 32, 53, 18, 4, [10, 10, 8], seed + 613, 78);
  line(t, 12, 52, 44, 20, 4.2, grime, seed + 614, 242);
  line(t, 14, 50, 43, 21, 2.5, wood, seed + 615, 250);
  line(t, 18, 47, 39, 25, 0.8, woodLight, seed + 616, 160);
  rect(t, 17, 45, 29, 50, rag, seed + 617, 175);
  rect(t, 19, 46, 27, 47, woodLight, seed + 618, 125);
  line(t, 39, 20, 56, 13, 4.0, blackMetal, seed + 619, 248);
  line(t, 40, 20, 55, 14, 2.3, rustyMetal, seed + 620, 248);
  for (let i = 0; i < 6; i++) {
    const x = 39 + i * 3;
    const y = 18 - i * 0.7;
    line(t, x, y, x + 3, y + 13, 1.0, i & 1 ? rustyMetal : edge, seed + 621 + i, 232);
    px(t, x + 3, Math.round(y + 13), rgba(blackMetal[0], blackMetal[1], blackMetal[2], 230));
  }
  rect(t, 38, 22, 48, 25, rustyMetal, seed + 628, 205);
  line(t, 44, 17, 52, 14, 0.8, rustLight, seed + 629, 154);
  line(t, 24, 40, 49, 20, 0.9, rustyMetal, seed + 630, 145);
  rect(t, 47, 26, 53, 29, rustLight, seed + 631, 122);
  drawNoiseDust(t, seed + 632, rustyMetal, 13);
  drawNoiseDust(t, seed + 633, edge, 6);
}

function drawLiquidatorRakeSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [16, 22, 22];
  const blueMetal: [number, number, number] = [48, 64, 68];
  const edge: [number, number, number] = [132, 150, 142];
  const pole: [number, number, number] = [74, 54, 36];
  const red: [number, number, number] = [180, 42, 34];
  const yellow: [number, number, number] = [214, 154, 46];
  const slime: [number, number, number] = [74, 154, 86];
  const rust: [number, number, number] = [132, 66, 36];

  ellipse(t, 32, 53, 18, 4, [10, 12, 10], seed + 593, 78);
  line(t, 12, 51, 47, 18, 4.8, blackMetal, seed + 594, 246);
  line(t, 15, 49, 45, 20, 2.9, pole, seed + 595, 250);
  rect(t, 18, 45, 29, 51, red, seed + 596, 218);
  rect(t, 21, 46, 28, 47, yellow, seed + 597, 190);

  line(t, 42, 18, 57, 12, 4.0, blackMetal, seed + 598, 250);
  line(t, 43, 18, 56, 13, 2.2, blueMetal, seed + 599, 246);
  for (let i = 0; i < 6; i++) {
    const x = 42 + i * 3;
    line(t, x, 16 - i * 0.8, x + 2, 28 - i * 0.8, 1.1, edge, seed + 600 + i, 235);
    px(t, x + 2, Math.round(28 - i * 0.8), rgba(blackMetal[0], blackMetal[1], blackMetal[2], 230));
  }
  rect(t, 39, 20, 49, 24, red, seed + 606, 200);
  rect(t, 42, 21, 48, 22, yellow, seed + 607, 182);
  line(t, 18, 48, 48, 20, 0.9, rust, seed + 608, 145);
  rect(t, 45, 27, 53, 30, slime, seed + 609, 160);
  ellipse(t, 51, 31, 5.5, 2.8, slime, seed + 610, 135);
  drawNoiseDust(t, seed + 611, rust, 8);
  drawNoiseDust(t, seed + 612, slime, 10);
}

function drawChainSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [16, 20, 20];
  const blueMetal: [number, number, number] = [58, 68, 68];
  const wornEdge: [number, number, number] = [138, 138, 122];
  const rust: [number, number, number] = [142, 66, 34];
  const warning: [number, number, number] = [208, 146, 44];
  const redRag: [number, number, number] = [172, 42, 36];

  line(t, 14, 49, 52, 16, 3.8, blackMetal, seed + 575, 218);
  for (let i = 0; i < 8; i++) {
    const cx = 16 + i * 5.1;
    const cy = 48 - i * 4.5 + ((i & 1) ? 1.2 : -0.6);
    ellipse(t, cx, cy, 4.7, 3.3, blackMetal, seed + 576 + i, 250);
    ellipse(t, cx, cy, 3.5, 2.3, (i & 1) === 0 ? blueMetal : rust, seed + 586 + i, 238);
    ellipse(t, cx, cy, 1.5, 0.9, [0, 0, 0], 0, 0);
    if ((i & 1) === 0) line(t, cx - 2, cy + 2, cx + 3, cy - 2, 0.65, wornEdge, seed + 596 + i, 145);
  }
  rect(t, 21, 43, 30, 47, redRag, seed + 604, 205);
  rect(t, 23, 44, 28, 45, warning, seed + 605, 185);
  rect(t, 38, 27, 43, 29, rust, seed + 606, 180);
  rect(t, 47, 18, 51, 20, rust, seed + 607, 170);
  drawNoiseDust(t, seed + 608, rust, 12);
}

function drawChainsawSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 16, 18];
  const blueMetal: [number, number, number] = [46, 58, 62];
  const wornEdge: [number, number, number] = [146, 154, 142];
  const casing: [number, number, number] = [174, 58, 38];
  const casingDark: [number, number, number] = [92, 40, 32];
  const warning: [number, number, number] = [218, 158, 46];
  const rubber: [number, number, number] = [26, 24, 20];
  const rust: [number, number, number] = [138, 66, 34];

  line(t, 25, 37, 57, 20, 6.2, blackMetal, seed + 620, 250);
  line(t, 28, 36, 55, 21, 3.5, wornEdge, seed + 621, 248);
  line(t, 29, 39, 57, 24, 1.2, blueMetal, seed + 622, 230);
  for (let i = 0; i < 7; i++) {
    const x = 31 + i * 4;
    const y = 34 - i * 2;
    rect(t, x, y, x + 2, y + 1, blackMetal, seed + 623 + i, 235);
    px(t, x + 1, y - 1, rgba(wornEdge[0], wornEdge[1], wornEdge[2], 210));
  }

  ellipse(t, 24, 41, 13, 9, casingDark, seed + 632, 250);
  rect(t, 16, 32, 35, 47, casing, seed + 633, 248);
  outlineRect(t, 16, 32, 35, 47, blackMetal);
  rect(t, 20, 35, 31, 39, warning, seed + 634, 225);
  rect(t, 20, 40, 31, 44, blueMetal, seed + 635, 214);
  line(t, 13, 35, 28, 25, 4.2, rubber, seed + 636, 245);
  line(t, 14, 46, 29, 52, 3.8, rubber, seed + 637, 235);
  ellipse(t, 27, 38, 4.5, 4.1, blackMetal, seed + 638, 220);
  ellipse(t, 27, 38, 2.2, 1.8, casing, seed + 639, 220);
  rect(t, 34, 33, 39, 37, rust, seed + 640, 170);
  line(t, 17, 46, 54, 25, 0.9, rust, seed + 641, 145);
  drawNoiseDust(t, seed + 642, rust, 12);
}

function drawChestFailsafeChargeSprite(t: Uint32Array, seed: number): void {
  const armor: [number, number, number] = [34, 42, 48];
  const armorLight: [number, number, number] = [82, 96, 102];
  const seal: [number, number, number] = [194, 44, 38];
  const warning: [number, number, number] = [218, 160, 46];
  const rubber: [number, number, number] = [16, 18, 18];
  const charge: [number, number, number] = [88, 72, 58];
  const rust: [number, number, number] = [138, 66, 34];

  ellipse(t, 32, 52, 17, 4, [8, 9, 8], seed + 575, 86);
  ellipse(t, 32, 34, 16, 19, rubber, seed + 576, 238);
  rect(t, 21, 19, 43, 48, armor, seed + 577, 248);
  clearRect(t, 21, 19, 24, 22);
  clearRect(t, 41, 20, 43, 24);
  clearRect(t, 22, 46, 25, 48);
  outlineRect(t, 21, 19, 43, 48, rubber);
  rect(t, 24, 22, 40, 34, charge, seed + 578, 248);
  rect(t, 25, 24, 39, 26, armorLight, seed + 579, 162);
  rect(t, 24, 35, 40, 44, charge, seed + 580, 235);
  rect(t, 27, 37, 37, 40, seal, seed + 581, 238);
  rect(t, 29, 21, 34, 47, warning, seed + 582, 226);
  line(t, 19, 15, 28, 23, 1.4, seal, seed + 583, 235);
  ellipse(t, 18, 14, 3.2, 3.2, seal, seed + 584, 232);
  line(t, 39, 17, 49, 13, 1.2, armorLight, seed + 585, 220);
  ellipse(t, 49, 13, 3.4, 2.1, warning, seed + 586, 215);
  line(t, 23, 46, 42, 28, 0.9, rust, seed + 587, 154);
  rect(t, 20, 30, 44, 32, rubber, seed + 588, 120);
  rect(t, 23, 49, 31, 51, seal, seed + 589, 180);
  drawNoiseDust(t, seed + 590, rust, 14);
}

function drawChizh3ShotgunSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 18, 20];
  const blueMetal: [number, number, number] = [44, 58, 64];
  const wornEdge: [number, number, number] = [126, 138, 132];
  const stock: [number, number, number] = [72, 48, 32];
  const pump: [number, number, number] = [86, 62, 38];
  const rust: [number, number, number] = [138, 66, 34];
  const yellow: [number, number, number] = [216, 158, 46];
  const red: [number, number, number] = [184, 44, 36];

  line(t, 12, 47, 27, 39, 5.4, blackMetal, seed + 591, 248);
  line(t, 14, 46, 26, 40, 3.4, stock, seed + 592, 248);
  ellipse(t, 13, 48, 4.5, 5.2, stock, seed + 593, 232);
  line(t, 25, 39, 31, 48, 1.7, blackMetal, seed + 594, 232);

  line(t, 20, 41, 58, 23, 4.6, blackMetal, seed + 612, 218);
  line(t, 20, 40, 56, 23, 3.1, blackMetal, seed + 595, 255);
  line(t, 23, 39, 54, 24, 1.8, blueMetal, seed + 596, 252);
  line(t, 25, 36, 58, 21, 1.5, blackMetal, seed + 597, 248);
  line(t, 28, 35, 56, 22, 0.8, wornEdge, seed + 598, 220);
  line(t, 29, 42, 48, 33, 3.6, pump, seed + 599, 245);
  for (let i = 0; i < 4; i++) line(t, 31 + i * 4, 39 - i * 1.8, 36 + i * 4, 37 - i * 1.8, 0.7, blackMetal, seed + 600 + i, 175);

  rect(t, 33, 34, 42, 39, blueMetal, seed + 604, 245);
  rect(t, 35, 35, 39, 36, yellow, seed + 605, 225);
  rect(t, 43, 30, 47, 32, red, seed + 606, 210);
  ellipse(t, 56, 22, 4.2, 2.2, blackMetal, seed + 607, 240);
  ellipse(t, 58, 21, 2, 1.2, wornEdge, seed + 608, 190);
  line(t, 22, 42, 49, 30, 0.9, rust, seed + 609, 140);
  rect(t, 27, 43, 33, 45, rust, seed + 610, 160);
  drawNoiseDust(t, seed + 611, rust, 9);
}

function drawConscriptsDoublebarrelSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [16, 20, 22];
  const blueMetal: [number, number, number] = [42, 58, 66];
  const wornEdge: [number, number, number] = [132, 138, 126];
  const wood: [number, number, number] = [86, 54, 34];
  const woodLight: [number, number, number] = [128, 82, 42];
  const rust: [number, number, number] = [138, 66, 34];
  const yellow: [number, number, number] = [210, 150, 44];
  const red: [number, number, number] = [174, 42, 36];

  line(t, 11, 47, 26, 39, 5.2, blackMetal, seed + 612, 242);
  line(t, 13, 46, 27, 39, 3.5, wood, seed + 613, 248);
  ellipse(t, 12, 48, 5.0, 5.0, wood, seed + 614, 235);
  line(t, 14, 44, 26, 39, 1.0, woodLight, seed + 615, 190);
  line(t, 25, 39, 32, 48, 1.7, blackMetal, seed + 616, 226);

  line(t, 21, 41, 56, 22, 5.0, blackMetal, seed + 617, 204);
  line(t, 24, 38, 58, 19, 2.1, blueMetal, seed + 618, 252);
  line(t, 22, 42, 56, 23, 2.1, blueMetal, seed + 619, 252);
  line(t, 25, 37, 58, 18, 0.75, wornEdge, seed + 620, 230);
  line(t, 23, 41, 56, 22, 0.75, wornEdge, seed + 621, 220);
  rect(t, 31, 34, 40, 39, blueMetal, seed + 622, 242);
  rect(t, 34, 35, 38, 37, yellow, seed + 623, 222);
  rect(t, 41, 30, 46, 33, red, seed + 624, 205);
  ellipse(t, 56, 20, 3.8, 1.9, blackMetal, seed + 625, 240);
  ellipse(t, 55, 23, 3.8, 1.9, blackMetal, seed + 626, 238);
  px(t, 57, 20, rgba(wornEdge[0], wornEdge[1], wornEdge[2], 185));
  px(t, 56, 23, rgba(wornEdge[0], wornEdge[1], wornEdge[2], 175));
  line(t, 22, 42, 49, 28, 0.9, rust, seed + 627, 135);
  rect(t, 25, 43, 32, 45, rust, seed + 628, 150);
  drawNoiseDust(t, seed + 629, rust, 10);
}

function drawBreachChargeSprite(t: Uint32Array, seed: number): void {
  const casing: [number, number, number] = [38, 46, 48];
  const casingLight: [number, number, number] = [92, 110, 110];
  const dark: [number, number, number] = [10, 14, 15];
  const clay: [number, number, number] = [92, 78, 58];
  const warning: [number, number, number] = [214, 154, 44];
  const red: [number, number, number] = [190, 46, 36];
  const wire: [number, number, number] = [70, 190, 154];
  const rust: [number, number, number] = [132, 66, 34];

  ellipse(t, 32, 52, 15, 4, [10, 10, 8], seed + 800, 82);
  ellipse(t, 31, 36, 15, 16, dark, seed + 801, 248);
  ellipse(t, 31, 36, 12, 13, casing, seed + 802, 252);
  rect(t, 22, 31, 40, 42, clay, seed + 803, 228);
  rect(t, 24, 33, 38, 35, warning, seed + 804, 235);
  rect(t, 25, 39, 37, 41, red, seed + 805, 225);
  ellipse(t, 31, 26, 7, 4.5, casingLight, seed + 806, 225);
  rect(t, 28, 18, 36, 26, dark, seed + 807, 248);
  rect(t, 30, 20, 34, 24, red, seed + 808, 230);
  line(t, 35, 20, 46, 16, 1.4, casingLight, seed + 809, 230);
  line(t, 40, 18, 50, 25, 1.2, wire, seed + 810, 210);
  ellipse(t, 50, 25, 3, 2.5, red, seed + 811, 220);
  line(t, 21, 35, 42, 29, 0.9, casingLight, seed + 812, 135);
  line(t, 21, 43, 42, 47, 0.9, rust, seed + 813, 140);
  rect(t, 17, 36, 23, 39, rust, seed + 814, 150);
  drawNoiseDust(t, seed + 815, rust, 11);
}

function drawBrt2FoamProjectorSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [13, 18, 20];
  const blueMetal: [number, number, number] = [42, 58, 64];
  const wornEdge: [number, number, number] = [116, 134, 130];
  const foam: [number, number, number] = [104, 196, 174];
  const foamLight: [number, number, number] = [178, 238, 210];
  const warning: [number, number, number] = [214, 158, 48];
  const redValve: [number, number, number] = [188, 48, 38];
  const rust: [number, number, number] = [132, 66, 34];
  const hose: [number, number, number] = [32, 34, 30];

  ellipse(t, 35, 53, 18, 4, [8, 9, 8], seed + 830, 84);
  line(t, 12, 47, 31, 38, 5.4, blackMetal, seed + 831, 245);
  line(t, 15, 46, 30, 39, 3.4, [58, 44, 34], seed + 832, 238);
  rect(t, 21, 42, 30, 51, [42, 32, 26], seed + 833, 245);
  line(t, 29, 39, 35, 47, 1.8, blackMetal, seed + 834, 230);

  line(t, 19, 40, 46, 28, 6.0, blackMetal, seed + 835, 255);
  line(t, 22, 39, 44, 29, 4.0, blueMetal, seed + 836, 250);
  line(t, 24, 37, 43, 29, 1.2, wornEdge, seed + 837, 220);
  ellipse(t, 28, 36, 8.5, 7, foam, seed + 838, 238);
  ellipse(t, 28, 36, 4.5, 3.6, foamLight, seed + 839, 190);
  rect(t, 21, 35, 35, 39, warning, seed + 840, 220);
  line(t, 34, 34, 47, 43, 2.2, hose, seed + 841, 230);

  line(t, 42, 29, 57, 22, 4.2, blackMetal, seed + 842, 255);
  line(t, 44, 28, 55, 23, 2.2, wornEdge, seed + 843, 232);
  ellipse(t, 57, 22, 4.5, 2.8, foam, seed + 844, 210);
  ellipse(t, 59, 21, 2.2, 1.4, foamLight, seed + 845, 180);
  rect(t, 36, 31, 41, 34, redValve, seed + 846, 222);
  rect(t, 43, 26, 48, 28, rust, seed + 847, 160);
  line(t, 21, 43, 45, 31, 1.0, rust, seed + 848, 128);
  drawNoiseDust(t, seed + 849, rust, 8);
  drawNoiseDust(t, seed + 850, foamLight, 12);
}

function drawPbrog1FoamLauncherSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 17, 18];
  const blueMetal: [number, number, number] = [38, 54, 60];
  const wornEdge: [number, number, number] = [112, 132, 128];
  const foam: [number, number, number] = [112, 204, 178];
  const foamLight: [number, number, number] = [188, 240, 212];
  const yellow: [number, number, number] = [216, 160, 46];
  const red: [number, number, number] = [184, 46, 38];
  const paper: [number, number, number] = [202, 188, 132];
  const rust: [number, number, number] = [130, 66, 36];

  ellipse(t, 34, 52, 18, 4, [8, 9, 8], seed + 1952, 82);
  line(t, 12, 47, 27, 39, 4.8, blackMetal, seed + 1953, 246);
  line(t, 15, 46, 27, 40, 2.8, [54, 42, 32], seed + 1954, 236);
  rect(t, 20, 42, 29, 50, [38, 30, 24], seed + 1955, 238);
  line(t, 28, 39, 34, 47, 1.7, blackMetal, seed + 1956, 220);
  line(t, 19, 40, 49, 27, 5.6, blackMetal, seed + 1957, 255);
  line(t, 22, 39, 47, 28, 3.6, blueMetal, seed + 1958, 250);
  line(t, 25, 37, 46, 28, 1.1, wornEdge, seed + 1959, 220);
  rect(t, 29, 33, 43, 40, foam, seed + 1960, 232);
  rect(t, 31, 34, 41, 36, foamLight, seed + 1961, 190);
  rect(t, 21, 36, 32, 39, yellow, seed + 1962, 220);
  for (let x = 23; x <= 30; x += 4) line(t, x, 36, x + 2, 39, 0.65, blackMetal, seed + 1963 + x, 170);
  rect(t, 35, 41, 44, 44, paper, seed + 1970, 200);
  rect(t, 37, 42, 43, 43, red, seed + 1971, 188);
  line(t, 44, 28, 57, 21, 3.4, blackMetal, seed + 1972, 255);
  line(t, 46, 27, 55, 22, 1.6, wornEdge, seed + 1973, 232);
  ellipse(t, 57, 21, 4.2, 2.6, foam, seed + 1974, 198);
  ellipse(t, 59, 20, 2.0, 1.2, foamLight, seed + 1975, 170);
  rect(t, 42, 26, 48, 28, rust, seed + 1976, 155);
  line(t, 22, 43, 48, 30, 0.9, rust, seed + 1977, 132);
  drawNoiseDust(t, seed + 1978, rust, 8);
  drawNoiseDust(t, seed + 1979, foamLight, 13);
}

function drawConcreteBreakerGrenadeSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [58, 70, 74];
  const dark: [number, number, number] = [16, 20, 22];
  const edge: [number, number, number] = [126, 142, 136];
  const yellow: [number, number, number] = [216, 158, 44];
  const red: [number, number, number] = [186, 42, 36];
  const concrete: [number, number, number] = [138, 134, 116];
  const rust: [number, number, number] = [132, 64, 34];

  ellipse(t, 32, 52, 15, 4, [10, 12, 12], seed + 851, 86);
  ellipse(t, 31, 35, 13, 16, dark, seed + 852, 252);
  ellipse(t, 32, 35, 10, 14, metal, seed + 853, 252);
  rect(t, 25, 21, 38, 29, dark, seed + 854, 248);
  rect(t, 27, 18, 36, 23, edge, seed + 855, 230);
  line(t, 35, 20, 48, 15, 1.6, edge, seed + 856, 238);
  ellipse(t, 48, 15, 4.5, 3.2, dark, seed + 857, 230);
  ellipse(t, 48, 15, 2.2, 1.4, [0, 0, 0], 0, 0);

  rect(t, 22, 31, 42, 36, yellow, seed + 858, 235);
  for (let x = 24; x <= 39; x += 6) line(t, x, 31, x + 3, 36, 0.8, dark, seed + 859 + x, 185);
  rect(t, 27, 42, 38, 45, red, seed + 866, 215);
  rect(t, 29, 43, 36, 44, concrete, seed + 867, 190);
  line(t, 23, 27, 41, 46, 0.9, edge, seed + 868, 135);
  line(t, 24, 46, 42, 25, 0.8, dark, seed + 869, 120);

  rect(t, 41, 38, 50, 43, concrete, seed + 870, 170);
  line(t, 41, 39, 50, 43, 0.8, red, seed + 871, 170);
  drawNoiseDust(t, seed + 872, rust, 13);
  drawNoiseDust(t, seed + 873, concrete, 9);
  px(t, 29, 25, rgba(edge[0], edge[1], edge[2], 170));
}

function drawG41GrenadeLauncherSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 16, 18];
  const blueMetal: [number, number, number] = [42, 56, 62];
  const wornEdge: [number, number, number] = [124, 138, 132];
  const tripod: [number, number, number] = [54, 48, 38];
  const warning: [number, number, number] = [216, 158, 48];
  const redSeal: [number, number, number] = [184, 42, 36];
  const rust: [number, number, number] = [132, 66, 34];

  ellipse(t, 34, 53, 20, 4, [8, 9, 8], seed + 874, 86);
  line(t, 13, 42, 54, 24, 6.6, blackMetal, seed + 875, 255);
  line(t, 16, 41, 52, 25, 4.2, blueMetal, seed + 876, 252);
  line(t, 20, 38, 50, 25, 1.3, wornEdge, seed + 877, 220);
  line(t, 29, 42, 57, 30, 4.4, blackMetal, seed + 878, 250);
  line(t, 32, 41, 55, 31, 2.3, wornEdge, seed + 879, 225);
  ellipse(t, 57, 30, 4.6, 2.9, blackMetal, seed + 880, 240);
  ellipse(t, 59, 29, 2.4, 1.6, wornEdge, seed + 881, 190);

  rect(t, 18, 36, 33, 46, tripod, seed + 882, 240);
  rect(t, 20, 38, 31, 40, warning, seed + 883, 220);
  rect(t, 23, 43, 30, 45, redSeal, seed + 884, 205);
  line(t, 27, 45, 16, 55, 2.0, blackMetal, seed + 885, 235);
  line(t, 30, 45, 31, 56, 2.0, blackMetal, seed + 886, 235);
  line(t, 33, 44, 47, 55, 2.0, blackMetal, seed + 887, 235);
  line(t, 27, 46, 17, 54, 0.9, wornEdge, seed + 888, 155);
  line(t, 33, 45, 46, 54, 0.9, wornEdge, seed + 889, 150);

  rect(t, 36, 30, 44, 34, redSeal, seed + 890, 218);
  rect(t, 38, 31, 42, 32, warning, seed + 891, 218);
  line(t, 18, 43, 50, 28, 1.1, rust, seed + 892, 140);
  rect(t, 46, 24, 51, 26, rust, seed + 893, 170);
  drawNoiseDust(t, seed + 894, rust, 11);
  drawNoiseDust(t, seed + 895, wornEdge, 7);
}

function drawPartyMightLauncherSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [10, 14, 16];
  const blueMetal: [number, number, number] = [36, 50, 58];
  const wornEdge: [number, number, number] = [112, 128, 126];
  const grip: [number, number, number] = [48, 38, 30];
  const red: [number, number, number] = [188, 42, 34];
  const yellow: [number, number, number] = [218, 160, 46];
  const brass: [number, number, number] = [186, 128, 48];
  const rust: [number, number, number] = [132, 64, 34];

  ellipse(t, 34, 52, 18, 4, [8, 8, 8], seed + 1980, 86);
  line(t, 14, 47, 30, 39, 5.0, blackMetal, seed + 1981, 248);
  line(t, 16, 46, 29, 40, 2.9, grip, seed + 1982, 238);
  rect(t, 22, 42, 31, 50, grip, seed + 1983, 245);
  line(t, 30, 39, 35, 48, 1.7, blackMetal, seed + 1984, 230);
  line(t, 19, 40, 55, 24, 6.8, blackMetal, seed + 1985, 255);
  line(t, 22, 39, 53, 25, 4.4, blueMetal, seed + 1986, 252);
  line(t, 25, 36, 51, 25, 1.3, wornEdge, seed + 1987, 220);
  line(t, 31, 44, 58, 32, 4.6, blackMetal, seed + 1988, 250);
  line(t, 34, 43, 56, 33, 2.4, wornEdge, seed + 1989, 225);
  ellipse(t, 58, 32, 4.8, 3.0, blackMetal, seed + 1990, 240);
  ellipse(t, 60, 31, 2.4, 1.5, brass, seed + 1991, 190);
  rect(t, 26, 36, 41, 41, yellow, seed + 1992, 218);
  for (let x = 28; x <= 38; x += 4) line(t, x, 36, x + 2, 41, 0.7, blackMetal, seed + 1993 + x, 170);
  rect(t, 41, 29, 47, 33, red, seed + 2000, 216);
  ellipse(t, 22, 38, 4.8, 4.0, brass, seed + 2001, 190);
  line(t, 22, 43, 51, 28, 1.0, rust, seed + 2002, 140);
  rect(t, 47, 25, 52, 27, rust, seed + 2003, 165);
  drawNoiseDust(t, seed + 2004, rust, 10);
  drawNoiseDust(t, seed + 2005, wornEdge, 6);
}

function drawGaussRifleSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [10, 15, 18];
  const blueMetal: [number, number, number] = [36, 56, 68];
  const wornEdge: [number, number, number] = [116, 142, 144];
  const stock: [number, number, number] = [48, 40, 32];
  const charge: [number, number, number] = [76, 214, 198];
  const chargeLight: [number, number, number] = [136, 246, 230];
  const redSeal: [number, number, number] = [184, 48, 40];
  const rust: [number, number, number] = [128, 64, 34];

  ellipse(t, 34, 53, 18, 4, [6, 8, 8], seed + 896, 82);
  line(t, 12, 47, 29, 39, 4.8, blackMetal, seed + 897, 248);
  line(t, 14, 46, 28, 40, 2.9, stock, seed + 898, 240);
  ellipse(t, 13, 48, 4.2, 5.0, stock, seed + 899, 230);
  line(t, 28, 39, 35, 48, 1.8, blackMetal, seed + 900, 230);

  line(t, 20, 40, 58, 21, 3.2, blackMetal, seed + 901, 255);
  line(t, 22, 38, 57, 19, 1.3, wornEdge, seed + 902, 238);
  line(t, 23, 43, 59, 25, 2.2, blackMetal, seed + 903, 250);
  line(t, 25, 42, 57, 26, 0.9, blueMetal, seed + 904, 232);
  line(t, 28, 34, 53, 22, 1.2, charge, seed + 905, 210);
  line(t, 32, 45, 55, 33, 1.0, charge, seed + 906, 190);
  rect(t, 31, 33, 43, 39, blueMetal, seed + 907, 245);
  rect(t, 34, 34, 40, 37, charge, seed + 908, 224);
  ellipse(t, 37, 35.5, 3.8, 2.6, chargeLight, seed + 909, 195);
  rect(t, 42, 28, 47, 31, redSeal, seed + 910, 215);
  ellipse(t, 58, 20, 3.5, 1.8, chargeLight, seed + 911, 192);
  ellipse(t, 59, 25, 3.0, 1.5, charge, seed + 912, 160);

  line(t, 23, 42, 51, 27, 0.9, rust, seed + 913, 135);
  rect(t, 25, 42, 31, 44, rust, seed + 914, 160);
  drawNoiseDust(t, seed + 915, rust, 8);
  drawNoiseDust(t, seed + 916, chargeLight, 10);
}

function drawCrowbarSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 20, 24];
  const blueMetal: [number, number, number] = [50, 68, 76];
  const edge: [number, number, number] = [126, 148, 146];
  const rust: [number, number, number] = [142, 66, 34];
  const yellow: [number, number, number] = [214, 158, 48];
  const redPaint: [number, number, number] = [172, 42, 36];

  ellipse(t, 33, 53, 18, 4, [8, 10, 10], seed + 874, 82);
  line(t, 15, 49, 49, 17, 4.5, blackMetal, seed + 875, 255);
  line(t, 17, 48, 47, 18, 2.8, blueMetal, seed + 876, 252);
  line(t, 20, 45, 45, 20, 0.9, edge, seed + 877, 190);
  line(t, 18, 50, 49, 18, 0.9, rust, seed + 878, 165);

  line(t, 46, 18, 56, 10, 3.2, blackMetal, seed + 879, 250);
  line(t, 49, 17, 57, 17, 2.4, blueMetal, seed + 880, 244);
  line(t, 54, 10, 58, 17, 1.5, edge, seed + 881, 225);
  px(t, 58, 17, rgba(edge[0], edge[1], edge[2], 210));

  line(t, 14, 49, 9, 41, 3.0, blackMetal, seed + 882, 248);
  line(t, 10, 41, 16, 38, 2.2, blueMetal, seed + 883, 244);
  line(t, 11, 40, 14, 36, 1.3, edge, seed + 884, 220);

  rect(t, 24, 40, 34, 43, yellow, seed + 885, 220);
  rect(t, 31, 35, 38, 38, redPaint, seed + 886, 210);
  rect(t, 43, 20, 49, 22, rust, seed + 887, 175);
  rect(t, 19, 44, 25, 46, rust, seed + 888, 170);
  drawNoiseDust(t, seed + 889, rust, 13);
}

function drawEntrenchingSpadeSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [15, 19, 20];
  const blueMetal: [number, number, number] = [54, 68, 70];
  const wornEdge: [number, number, number] = [146, 154, 138];
  const wood: [number, number, number] = [72, 48, 30];
  const red: [number, number, number] = [178, 42, 36];
  const yellow: [number, number, number] = [212, 156, 46];
  const rust: [number, number, number] = [136, 66, 34];

  ellipse(t, 32, 52, 16, 4, [10, 10, 8], seed + 900, 78);
  line(t, 18, 51, 40, 29, 4.2, blackMetal, seed + 901, 248);
  line(t, 20, 49, 39, 30, 2.5, wood, seed + 902, 246);
  ellipse(t, 18, 51, 4.8, 3.6, wood, seed + 903, 238);
  rect(t, 22, 44, 31, 50, red, seed + 904, 210);
  rect(t, 24, 45, 29, 46, yellow, seed + 905, 205);

  ellipse(t, 42, 24, 10.5, 13, blackMetal, seed + 906, 245);
  ellipse(t, 42, 24, 8.4, 10.5, blueMetal, seed + 907, 250);
  ellipse(t, 45, 22, 5.4, 8.4, wornEdge, seed + 908, 214);
  clearRect(t, 34, 12, 39, 17);
  clearRect(t, 49, 18, 54, 25);
  clearRect(t, 37, 35, 43, 38);
  line(t, 35, 17, 50, 31, 1.2, blackMetal, seed + 909, 180);
  line(t, 37, 16, 50, 28, 0.8, wornEdge, seed + 910, 185);
  rect(t, 37, 30, 45, 34, red, seed + 911, 185);
  line(t, 27, 43, 47, 21, 0.9, rust, seed + 912, 165);
  rect(t, 43, 17, 49, 19, rust, seed + 913, 170);
  drawNoiseDust(t, seed + 914, rust, 8);
}

function drawEralashnikovAutoSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 17, 20];
  const blueMetal: [number, number, number] = [38, 55, 62];
  const wornEdge: [number, number, number] = [106, 126, 128];
  const rubber: [number, number, number] = [36, 32, 28];
  const red: [number, number, number] = [184, 44, 36];
  const yellow: [number, number, number] = [214, 158, 48];
  const rust: [number, number, number] = [132, 62, 32];

  line(t, 12, 47, 30, 39, 4.8, blackMetal, seed + 930, 248);
  line(t, 15, 46, 29, 40, 2.8, rubber, seed + 931, 240);
  rect(t, 20, 42, 29, 51, rubber, seed + 932, 242);
  line(t, 28, 39, 34, 48, 1.7, blackMetal, seed + 933, 230);

  line(t, 19, 39, 56, 22, 4.2, blackMetal, seed + 934, 255);
  line(t, 22, 38, 54, 23, 2.5, blueMetal, seed + 935, 250);
  line(t, 25, 35, 57, 20, 1.4, blackMetal, seed + 936, 248);
  line(t, 27, 34, 53, 22, 0.8, wornEdge, seed + 937, 220);
  rect(t, 31, 34, 44, 39, blueMetal, seed + 938, 246);
  rect(t, 33, 35, 42, 36, yellow, seed + 939, 212);
  rect(t, 43, 30, 48, 33, red, seed + 940, 218);

  line(t, 37, 38, 42, 51, 3.0, blackMetal, seed + 941, 245);
  line(t, 39, 38, 45, 50, 2.0, blueMetal, seed + 942, 242);
  ellipse(t, 45, 51, 4.8, 2.4, blackMetal, seed + 943, 232);
  line(t, 51, 23, 60, 19, 1.5, blackMetal, seed + 944, 250);
  ellipse(t, 59, 19, 2.7, 1.5, wornEdge, seed + 945, 180);
  rect(t, 25, 40, 32, 42, red, seed + 946, 188);
  line(t, 22, 42, 49, 29, 0.9, rust, seed + 947, 140);
  rect(t, 48, 25, 52, 27, rust, seed + 948, 165);
  drawNoiseDust(t, seed + 949, rust, 8);
  drawNoiseDust(t, seed + 950, wornEdge, 5);
}

function drawFireHookSprite(t: Uint32Array, seed: number): void {
  const poleDark: [number, number, number] = [42, 36, 30];
  const pole: [number, number, number] = [96, 58, 34];
  const redPaint: [number, number, number] = [176, 44, 34];
  const metal: [number, number, number] = [58, 72, 76];
  const metalLight: [number, number, number] = [142, 154, 144];
  const rust: [number, number, number] = [138, 66, 34];
  const serviceYellow: [number, number, number] = [214, 154, 46];

  ellipse(t, 32, 53, 18, 4, [18, 14, 12], seed + 951, 78);
  line(t, 13, 50, 48, 18, 5.0, poleDark, seed + 952, 246);
  line(t, 15, 49, 47, 19, 3.1, pole, seed + 953, 250);
  line(t, 17, 47, 45, 21, 0.9, serviceYellow, seed + 954, 135);
  rect(t, 17, 45, 26, 51, redPaint, seed + 955, 220);
  rect(t, 20, 46, 24, 48, serviceYellow, seed + 956, 180);

  line(t, 42, 21, 56, 13, 3.0, metal, seed + 957, 250);
  line(t, 43, 20, 55, 14, 1.5, metalLight, seed + 958, 232);
  line(t, 47, 18, 57, 26, 2.2, metal, seed + 959, 245);
  line(t, 55, 25, 48, 31, 2.0, metalLight, seed + 960, 226);
  ellipse(t, 56, 25, 3.0, 2.0, metal, seed + 961, 235);
  rect(t, 39, 23, 46, 27, redPaint, seed + 962, 198);
  line(t, 18, 48, 48, 19, 0.9, rust, seed + 963, 150);
  rect(t, 36, 28, 42, 30, rust, seed + 964, 170);
  rect(t, 47, 16, 52, 18, rust, seed + 965, 160);
  drawNoiseDust(t, seed + 966, rust, 9);
}

function drawFlamethrowerSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 17, 18];
  const blueMetal: [number, number, number] = [42, 58, 62];
  const wornEdge: [number, number, number] = [118, 134, 130];
  const tank: [number, number, number] = [72, 82, 62];
  const warning: [number, number, number] = [214, 156, 44];
  const redValve: [number, number, number] = [190, 48, 36];
  const flame: [number, number, number] = [230, 92, 38];
  const rust: [number, number, number] = [134, 64, 34];
  const hose: [number, number, number] = [28, 30, 26];

  ellipse(t, 35, 53, 19, 4, [8, 9, 8], seed + 967, 84);
  line(t, 13, 47, 30, 39, 5.2, blackMetal, seed + 968, 246);
  line(t, 15, 46, 29, 40, 3.1, [58, 42, 30], seed + 969, 238);
  rect(t, 21, 42, 30, 51, [42, 32, 26], seed + 970, 245);
  line(t, 29, 39, 35, 47, 1.7, blackMetal, seed + 971, 230);

  ellipse(t, 24, 34, 10, 13, blackMetal, seed + 972, 246);
  ellipse(t, 25, 34, 7, 10, tank, seed + 973, 250);
  line(t, 20, 27, 32, 42, 0.9, wornEdge, seed + 974, 150);
  rect(t, 19, 34, 32, 38, warning, seed + 975, 218);
  rect(t, 21, 36, 30, 37, blackMetal, seed + 976, 120);

  line(t, 24, 39, 45, 28, 6.0, blackMetal, seed + 977, 255);
  line(t, 26, 38, 43, 29, 3.8, blueMetal, seed + 978, 250);
  line(t, 29, 36, 43, 29, 1.1, wornEdge, seed + 979, 210);
  line(t, 36, 32, 48, 41, 1.8, hose, seed + 980, 220);
  rect(t, 35, 31, 41, 34, redValve, seed + 981, 222);

  line(t, 41, 29, 57, 21, 4.0, blackMetal, seed + 982, 255);
  line(t, 43, 28, 55, 22, 2.0, wornEdge, seed + 983, 232);
  ellipse(t, 57, 21, 4.4, 2.7, redValve, seed + 984, 220);
  ellipse(t, 59, 20, 2.3, 1.5, flame, seed + 985, 190);
  line(t, 23, 43, 44, 31, 1.0, rust, seed + 986, 135);
  rect(t, 44, 26, 49, 28, rust, seed + 987, 162);
  drawNoiseDust(t, seed + 988, rust, 10);
  drawNoiseDust(t, seed + 989, flame, 8);
}

function drawO15MultijetFlamerSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [10, 15, 17];
  const blueMetal: [number, number, number] = [36, 54, 62];
  const wornEdge: [number, number, number] = [118, 138, 132];
  const rubber: [number, number, number] = [38, 31, 27];
  const tank: [number, number, number] = [74, 86, 66];
  const warning: [number, number, number] = [218, 158, 44];
  const redValve: [number, number, number] = [188, 44, 36];
  const flame: [number, number, number] = [232, 92, 36];
  const rust: [number, number, number] = [134, 64, 34];
  const hose: [number, number, number] = [22, 25, 23];

  ellipse(t, 35, 53, 20, 4, [7, 8, 8], seed + 2060, 86);
  line(t, 11, 47, 30, 39, 5.4, blackMetal, seed + 2061, 248);
  line(t, 14, 46, 28, 40, 3.2, rubber, seed + 2062, 242);
  rect(t, 20, 42, 31, 51, rubber, seed + 2063, 244);
  line(t, 30, 39, 36, 48, 1.9, blackMetal, seed + 2064, 232);

  ellipse(t, 23, 34, 10.5, 13, blackMetal, seed + 2065, 246);
  ellipse(t, 24, 34, 7.4, 10, tank, seed + 2066, 250);
  line(t, 19, 27, 32, 42, 0.9, wornEdge, seed + 2067, 150);
  rect(t, 18, 32, 32, 36, warning, seed + 2068, 220);
  rect(t, 20, 35, 30, 36, blackMetal, seed + 2069, 128);
  rect(t, 23, 25, 30, 28, redValve, seed + 2070, 205);

  line(t, 24, 39, 46, 28, 7.0, blackMetal, seed + 2071, 255);
  line(t, 27, 38, 44, 29, 4.4, blueMetal, seed + 2072, 252);
  line(t, 29, 36, 44, 29, 1.2, wornEdge, seed + 2073, 216);
  line(t, 33, 33, 49, 42, 1.8, hose, seed + 2074, 220);
  rect(t, 35, 31, 42, 35, redValve, seed + 2075, 222);
  rect(t, 27, 40, 37, 43, warning, seed + 2076, 210);

  line(t, 41, 28, 57, 20, 5.0, blackMetal, seed + 2077, 255);
  line(t, 43, 27, 55, 21, 2.7, wornEdge, seed + 2078, 232);
  for (let i = 0; i < 3; i++) {
    const ox = i * 2;
    const oy = i - 1;
    line(t, 49, 22 + oy, 59 + ox, 17 + oy, 1.5, blackMetal, seed + 2079 + i, 245);
    ellipse(t, 58 + ox, 17 + oy, 2.6, 1.6, flame, seed + 2083 + i, 198);
    px(t, 60 + ox, 16 + oy, rgba(245, 158, 56, 180));
  }

  line(t, 22, 43, 45, 31, 1.0, rust, seed + 2087, 138);
  rect(t, 43, 26, 49, 28, rust, seed + 2088, 165);
  drawNoiseDust(t, seed + 2089, rust, 11);
  drawNoiseDust(t, seed + 2090, flame, 13);
}

function drawFoamGrenade6p10Sprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [54, 66, 70];
  const metalDark: [number, number, number] = [16, 20, 22];
  const metalLight: [number, number, number] = [126, 142, 136];
  const foam: [number, number, number] = [102, 194, 174];
  const foamLight: [number, number, number] = [178, 238, 210];
  const warning: [number, number, number] = [216, 158, 44];
  const red: [number, number, number] = [184, 42, 36];
  const rust: [number, number, number] = [130, 66, 36];

  ellipse(t, 32, 52, 15, 4, [8, 10, 10], seed + 990, 86);
  ellipse(t, 31, 35, 13, 16, metalDark, seed + 991, 252);
  ellipse(t, 32, 35, 10, 14, metal, seed + 992, 252);
  rect(t, 25, 20, 38, 28, metalDark, seed + 993, 248);
  rect(t, 27, 17, 36, 22, metalLight, seed + 994, 230);
  line(t, 35, 19, 47, 14, 1.6, metalLight, seed + 995, 238);
  ellipse(t, 47, 14, 4.2, 3.0, metalDark, seed + 996, 230);
  ellipse(t, 47, 14, 2.0, 1.3, [0, 0, 0], 0, 0);

  rect(t, 22, 30, 42, 36, foam, seed + 997, 238);
  rect(t, 23, 31, 41, 32, foamLight, seed + 998, 184);
  rect(t, 24, 39, 40, 45, warning, seed + 999, 232);
  for (let x = 25; x <= 37; x += 5) line(t, x, 39, x + 3, 45, 0.7, metalDark, seed + 1000 + x, 180);
  rect(t, 27, 46, 38, 48, red, seed + 1006, 198);
  rect(t, 29, 47, 36, 48, foamLight, seed + 1007, 178);
  line(t, 23, 26, 41, 47, 0.9, metalLight, seed + 1008, 135);
  rect(t, 39, 35, 49, 40, foam, seed + 1009, 160);
  line(t, 39, 36, 49, 40, 0.8, red, seed + 1010, 170);
  drawNoiseDust(t, seed + 1011, rust, 12);
  drawNoiseDust(t, seed + 1012, foamLight, 12);
}

function drawGranit4uBeltShotgunSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 16, 18];
  const blueMetal: [number, number, number] = [42, 56, 62];
  const wornEdge: [number, number, number] = [126, 138, 132];
  const stock: [number, number, number] = [58, 42, 30];
  const brass: [number, number, number] = [198, 142, 58];
  const shellRed: [number, number, number] = [164, 44, 36];
  const warning: [number, number, number] = [218, 158, 48];
  const rust: [number, number, number] = [132, 66, 34];

  ellipse(t, 34, 53, 20, 4, [8, 9, 8], seed + 1013, 82);
  line(t, 11, 46, 31, 37, 6.0, blackMetal, seed + 1014, 250);
  line(t, 13, 45, 29, 38, 3.7, stock, seed + 1015, 242);
  ellipse(t, 13, 46, 5.2, 5.4, stock, seed + 1016, 235);
  line(t, 30, 37, 37, 49, 2.1, blackMetal, seed + 1017, 230);
  line(t, 20, 40, 58, 22, 5.4, blackMetal, seed + 1018, 255);
  line(t, 23, 39, 56, 23, 3.3, blueMetal, seed + 1019, 252);
  line(t, 26, 36, 58, 20, 1.4, wornEdge, seed + 1020, 225);
  line(t, 39, 31, 59, 21, 2.0, blackMetal, seed + 1021, 248);
  ellipse(t, 58, 21, 4.0, 2.2, blackMetal, seed + 1022, 230);
  rect(t, 30, 32, 44, 40, blackMetal, seed + 1023, 248);
  rect(t, 32, 33, 42, 37, blueMetal, seed + 1024, 248);
  rect(t, 34, 34, 42, 36, warning, seed + 1025, 220);
  rect(t, 42, 29, 47, 32, shellRed, seed + 1026, 208);

  line(t, 19, 26, 48, 43, 2.3, blackMetal, seed + 1027, 218);
  for (let i = 0; i < 6; i++) {
    const x = 19 + i * 5;
    const y = 25 + i * 3;
    ellipse(t, x, y, 3.2, 4.6, brass, seed + 1028 + i, 235);
    rect(t, x - 2, y - 1, x + 2, y + 3, shellRed, seed + 1034 + i, 228);
    rect(t, x - 2, y + 3, x + 2, y + 5, brass, seed + 1040 + i, 226);
  }

  line(t, 22, 41, 49, 28, 1.0, rust, seed + 1046, 130);
  rect(t, 48, 25, 53, 27, rust, seed + 1047, 170);
  drawNoiseDust(t, seed + 1048, rust, 9);
}

function drawGravityBeamEmitterSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [8, 12, 16];
  const blueMetal: [number, number, number] = [34, 50, 60];
  const wornEdge: [number, number, number] = [106, 130, 136];
  const grip: [number, number, number] = [42, 36, 30];
  const cyan: [number, number, number] = [72, 224, 226];
  const cyanLight: [number, number, number] = [166, 252, 238];
  const redSeal: [number, number, number] = [178, 42, 38];
  const rust: [number, number, number] = [128, 62, 34];

  ellipse(t, 34, 53, 19, 4, [5, 8, 8], seed + 1050, 82);
  line(t, 12, 47, 28, 39, 5.0, blackMetal, seed + 1051, 248);
  line(t, 14, 46, 27, 40, 2.9, grip, seed + 1052, 240);
  ellipse(t, 13, 48, 4.4, 5.1, grip, seed + 1053, 230);
  line(t, 28, 39, 35, 48, 1.8, blackMetal, seed + 1054, 230);
  line(t, 20, 40, 58, 21, 4.4, blackMetal, seed + 1055, 255);
  line(t, 22, 39, 56, 22, 2.4, blueMetal, seed + 1056, 250);
  line(t, 24, 37, 55, 21, 1.0, wornEdge, seed + 1057, 210);
  line(t, 23, 43, 57, 26, 2.2, blackMetal, seed + 1058, 248);
  line(t, 25, 42, 55, 27, 0.9, cyan, seed + 1059, 160);
  rect(t, 31, 32, 45, 40, blueMetal, seed + 1060, 248);
  rect(t, 33, 34, 42, 38, cyan, seed + 1061, 218);
  ellipse(t, 38, 35.5, 4.6, 3.0, cyanLight, seed + 1062, 190);
  for (let i = 0; i < 4; i++) line(t, 31 + i * 4, 32, 34 + i * 4, 41, 0.8, cyanLight, seed + 1063 + i, 145);

  ellipse(t, 53, 23, 7.8, 5.0, blackMetal, seed + 1068, 245);
  ellipse(t, 53, 23, 5.0, 3.2, cyan, seed + 1069, 205);
  ellipse(t, 55, 22, 2.4, 1.6, cyanLight, seed + 1070, 190);
  ellipse(t, 59, 21, 5.2, 3.2, cyan, seed + 1071, 105);
  line(t, 47, 21, 61, 17, 1.4, cyanLight, seed + 1072, 150);
  line(t, 47, 26, 61, 31, 1.2, cyan, seed + 1073, 125);
  rect(t, 42, 29, 47, 32, redSeal, seed + 1074, 220);
  line(t, 23, 42, 51, 28, 0.9, rust, seed + 1075, 132);
  rect(t, 25, 42, 31, 44, rust, seed + 1076, 160);
  drawNoiseDust(t, seed + 1077, rust, 8);
  drawNoiseDust(t, seed + 1078, cyanLight, 15);
}

function drawGrenadeSprite(t: Uint32Array, seed: number): void {
  const body: [number, number, number] = [50, 82, 54];
  const bodyDark: [number, number, number] = [18, 28, 22];
  const edge: [number, number, number] = [92, 118, 82];
  const metal: [number, number, number] = [118, 128, 112];
  const red: [number, number, number] = [168, 42, 36];
  const yellow: [number, number, number] = [210, 154, 54];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 52, 15, 4, [8, 10, 8], seed + 1080, 86);
  ellipse(t, 31, 36, 13.5, 16, bodyDark, seed + 1081, 252);
  ellipse(t, 32, 36, 11.5, 14.5, body, seed + 1082, 252);
  for (let x = 24; x <= 40; x += 5) line(t, x, 25, x + 1, 47, 0.8, bodyDark, seed + 1083 + x, 150);
  for (let y = 30; y <= 43; y += 5) line(t, 22, y, 43, y, 0.8, bodyDark, seed + 1100 + y, 145);
  ellipse(t, 28, 30, 5.5, 5, edge, seed + 1110, 110);
  rect(t, 27, 18, 37, 27, bodyDark, seed + 1111, 246);
  rect(t, 29, 15, 36, 20, metal, seed + 1112, 230);
  line(t, 35, 17, 47, 13, 1.4, metal, seed + 1113, 238);
  ellipse(t, 47, 13, 4.4, 3.0, bodyDark, seed + 1114, 230);
  ellipse(t, 47, 13, 2.3, 1.5, [0, 0, 0], 0, 0);
  rect(t, 25, 35, 41, 38, red, seed + 1115, 212);
  rect(t, 27, 36, 38, 37, yellow, seed + 1116, 185);
  line(t, 24, 27, 41, 46, 0.8, edge, seed + 1117, 125);
  drawNoiseDust(t, seed + 1118, rust, 10);
}

function drawGrn420GravizhernovSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [9, 14, 17];
  const blueMetal: [number, number, number] = [34, 54, 64];
  const wornEdge: [number, number, number] = [110, 138, 142];
  const cyan: [number, number, number] = [72, 222, 222];
  const cyanLight: [number, number, number] = [142, 250, 238];
  const yellow: [number, number, number] = [218, 158, 44];
  const red: [number, number, number] = [184, 42, 36];
  const rust: [number, number, number] = [132, 64, 34];

  ellipse(t, 35, 53, 20, 4, [4, 7, 8], seed + 1119, 86);
  line(t, 10, 47, 30, 40, 6.2, blackMetal, seed + 1120, 248);
  line(t, 13, 46, 29, 41, 3.8, [46, 38, 30], seed + 1121, 240);
  rect(t, 20, 42, 31, 52, blackMetal, seed + 1122, 242);
  line(t, 30, 40, 36, 50, 2.0, blackMetal, seed + 1123, 230);

  line(t, 17, 40, 55, 23, 8.4, blackMetal, seed + 1124, 255);
  line(t, 20, 39, 52, 24, 5.6, blueMetal, seed + 1125, 252);
  line(t, 23, 36, 52, 23, 1.4, wornEdge, seed + 1126, 220);
  ellipse(t, 34, 34, 12, 8, blackMetal, seed + 1127, 250);
  ellipse(t, 35, 34, 8.5, 5.6, blueMetal, seed + 1128, 250);
  ellipse(t, 35, 34, 5.6, 3.6, cyan, seed + 1129, 230);
  ellipse(t, 35, 34, 2.8, 1.8, cyanLight, seed + 1130, 190);
  line(t, 26, 40, 45, 30, 1.2, cyan, seed + 1131, 190);
  line(t, 30, 31, 50, 21, 1.0, cyanLight, seed + 1132, 155);

  line(t, 47, 24, 60, 18, 5.2, blackMetal, seed + 1133, 255);
  line(t, 49, 23, 58, 19, 2.4, wornEdge, seed + 1134, 232);
  ellipse(t, 59, 18, 4.2, 2.5, cyan, seed + 1135, 170);
  rect(t, 22, 34, 39, 38, yellow, seed + 1136, 214);
  for (let x = 24; x <= 36; x += 5) line(t, x, 34, x + 3, 38, 0.7, blackMetal, seed + 1137 + x, 170);
  rect(t, 41, 27, 47, 31, red, seed + 1144, 212);
  line(t, 20, 43, 50, 27, 0.9, rust, seed + 1145, 138);
  rect(t, 49, 24, 54, 26, rust, seed + 1146, 165);
  drawNoiseDust(t, seed + 1147, rust, 9);
  drawNoiseDust(t, seed + 1148, cyanLight, 12);
}

function drawTrackedZhernovSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 14, 16];
  const metal: [number, number, number] = [54, 68, 70];
  const edge: [number, number, number] = [138, 150, 138];
  const yellow: [number, number, number] = [214, 154, 44];
  const red: [number, number, number] = [184, 42, 36];
  const rust: [number, number, number] = [132, 64, 34];

  ellipse(t, 33, 53, 22, 4, [4, 6, 6], seed + 1149, 90);
  rect(t, 12, 39, 53, 50, dark, seed + 1150, 250);
  rect(t, 15, 36, 50, 44, metal, seed + 1151, 245);
  for (let x = 14; x <= 51; x += 5) ellipse(t, x, 47, 3.2, 3.0, edge, seed + 1152 + x, 210);
  for (let x = 15; x <= 50; x += 6) rect(t, x, 39, x + 3, 42, yellow, seed + 1160 + x, 190);
  ellipse(t, 33, 31, 13, 13, dark, seed + 1168, 248);
  ellipse(t, 33, 31, 10, 10, metal, seed + 1169, 248);
  ellipse(t, 33, 31, 5.6, 5.6, edge, seed + 1170, 220);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(t, 33, 31, 33 + Math.cos(a) * 12, 31 + Math.sin(a) * 12, 0.9, edge, seed + 1171 + i, 170);
  }
  line(t, 18, 38, 47, 25, 4.2, dark, seed + 1180, 235);
  line(t, 21, 37, 44, 27, 2.0, edge, seed + 1181, 210);
  rect(t, 42, 29, 50, 36, red, seed + 1182, 216);
  rect(t, 44, 31, 49, 33, yellow, seed + 1183, 185);
  line(t, 17, 50, 48, 25, 0.9, rust, seed + 1184, 140);
  drawNoiseDust(t, seed + 1185, rust, 12);
}

function drawGuslIndexFragmentSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 174, 104];
  const light: [number, number, number] = [226, 208, 136];
  const ink: [number, number, number] = [22, 24, 22];
  const red: [number, number, number] = [172, 38, 34];
  const blue: [number, number, number] = [58, 90, 110];
  const damp: [number, number, number] = [72, 84, 76];
  const rust: [number, number, number] = [128, 66, 34];

  rect(t, 17, 17, 48, 50, paper, seed + 1149, 246);
  rect(t, 20, 14, 42, 22, light, seed + 1150, 230);
  outlineRect(t, 17, 17, 48, 50, ink);
  clearRect(t, 17, 17, 22, 22);
  clearRect(t, 44, 17, 48, 27);
  clearRect(t, 18, 46, 25, 50);
  rect(t, 17, 43, 48, 50, damp, seed + 1151, 92);
  line(t, 19, 19, 46, 48, 0.8, damp, seed + 1152, 95);
  for (let y = 23; y <= 39; y += 5) rect(t, 22, y, 40 - ((seed + y) & 5), y + 1, ink, 0, 135);
  line(t, 20, 40, 45, 27, 1.5, blue, seed + 1153, 220);
  line(t, 38, 29, 47, 33, 1.2, ink, seed + 1154, 180);
  rect(t, 23, 35, 31, 39, blue, seed + 1155, 165);
  rect(t, 32, 18, 47, 23, red, seed + 1156, 190);
  rect(t, 35, 20, 44, 21, light, seed + 1157, 170);
  ellipse(t, 42, 40, 5.8, 3.8, red, seed + 1158, 170);
  drawNoiseDust(t, seed + 1159, rust, 11);
}

function drawHammerSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [18, 22, 22];
  const blueMetal: [number, number, number] = [62, 76, 78];
  const edge: [number, number, number] = [142, 150, 138];
  const wood: [number, number, number] = [92, 56, 32];
  const red: [number, number, number] = [176, 42, 34];
  const yellow: [number, number, number] = [210, 150, 44];
  const rust: [number, number, number] = [138, 66, 34];

  ellipse(t, 32, 53, 17, 4, [16, 12, 10], seed + 1160, 78);
  line(t, 17, 50, 42, 25, 4.2, blackMetal, seed + 1161, 245);
  line(t, 19, 48, 41, 26, 2.6, wood, seed + 1162, 248);
  rect(t, 20, 43, 29, 50, red, seed + 1163, 210);
  rect(t, 22, 45, 27, 46, yellow, seed + 1164, 185);

  line(t, 33, 22, 53, 28, 7.0, blackMetal, seed + 1165, 252);
  line(t, 35, 22, 51, 27, 4.6, blueMetal, seed + 1166, 250);
  line(t, 36, 20, 50, 25, 1.2, edge, seed + 1167, 215);
  rect(t, 38, 27, 45, 32, blackMetal, seed + 1168, 235);
  line(t, 49, 27, 56, 20, 2.2, blackMetal, seed + 1169, 232);
  line(t, 51, 27, 57, 29, 2.0, edge, seed + 1170, 220);
  rect(t, 42, 24, 47, 26, rust, seed + 1171, 164);
  line(t, 21, 47, 44, 25, 0.8, rust, seed + 1172, 145);
  drawNoiseDust(t, seed + 1173, rust, 9);
}

function drawSledgehammerSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 20];
  const blueMetal: [number, number, number] = [48, 64, 70];
  const edge: [number, number, number] = [142, 154, 144];
  const wood: [number, number, number] = [82, 50, 30];
  const woodLight: [number, number, number] = [138, 84, 42];
  const red: [number, number, number] = [176, 42, 34];
  const yellow: [number, number, number] = [214, 154, 44];
  const rust: [number, number, number] = [142, 66, 34];

  ellipse(t, 32, 54, 20, 4, [12, 10, 8], seed + 1174, 84);
  line(t, 13, 53, 47, 18, 5.4, blackMetal, seed + 1175, 248);
  line(t, 15, 51, 45, 20, 3.4, wood, seed + 1176, 250);
  line(t, 18, 48, 43, 22, 0.9, woodLight, seed + 1177, 160);
  rect(t, 17, 46, 29, 53, red, seed + 1178, 218);
  rect(t, 20, 48, 28, 49, yellow, seed + 1179, 190);

  line(t, 35, 17, 57, 28, 9.4, blackMetal, seed + 1180, 255);
  line(t, 37, 17, 55, 27, 6.8, blueMetal, seed + 1181, 252);
  line(t, 40, 15, 53, 22, 1.3, edge, seed + 1182, 220);
  line(t, 33, 24, 54, 34, 4.0, blackMetal, seed + 1183, 248);
  line(t, 36, 24, 52, 32, 2.0, edge, seed + 1184, 224);
  rect(t, 41, 21, 50, 26, rust, seed + 1185, 174);
  rect(t, 48, 27, 56, 31, rust, seed + 1186, 160);
  line(t, 21, 48, 51, 23, 0.9, rust, seed + 1187, 150);
  drawNoiseDust(t, seed + 1188, rust, 12);
  drawNoiseDust(t, seed + 1189, edge, 7);
}

function drawHarpoonGunSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 20];
  const blueMetal: [number, number, number] = [38, 62, 72];
  const edge: [number, number, number] = [132, 152, 148];
  const tank: [number, number, number] = [56, 86, 88];
  const cyan: [number, number, number] = [76, 184, 194];
  const red: [number, number, number] = [182, 42, 36];
  const yellow: [number, number, number] = [214, 154, 44];
  const rust: [number, number, number] = [130, 66, 34];

  ellipse(t, 35, 53, 19, 4, [8, 10, 10], seed + 1174, 84);
  line(t, 12, 46, 31, 39, 5.0, blackMetal, seed + 1175, 245);
  line(t, 15, 45, 30, 40, 3.0, [54, 42, 34], seed + 1176, 238);
  rect(t, 21, 42, 31, 51, blackMetal, seed + 1177, 238);
  line(t, 31, 39, 36, 48, 1.7, blackMetal, seed + 1178, 220);

  line(t, 18, 39, 58, 20, 4.4, blackMetal, seed + 1179, 255);
  line(t, 21, 38, 55, 21, 2.5, blueMetal, seed + 1180, 250);
  line(t, 24, 35, 59, 19, 1.1, edge, seed + 1181, 230);
  line(t, 50, 22, 62, 13, 1.7, edge, seed + 1182, 238);
  line(t, 56, 18, 62, 21, 1.1, edge, seed + 1183, 220);
  line(t, 56, 18, 58, 12, 1.0, edge, seed + 1184, 210);

  ellipse(t, 29, 36, 8, 7, tank, seed + 1185, 225);
  ellipse(t, 30, 36, 4.5, 3.8, cyan, seed + 1186, 150);
  rect(t, 22, 36, 37, 40, yellow, seed + 1187, 198);
  rect(t, 39, 29, 46, 33, red, seed + 1188, 210);
  line(t, 33, 41, 49, 49, 1.5, blackMetal, seed + 1189, 220);
  line(t, 33, 41, 48, 48, 0.7, cyan, seed + 1190, 165);
  line(t, 21, 43, 50, 27, 0.9, rust, seed + 1191, 140);
  rect(t, 47, 23, 53, 25, rust, seed + 1192, 165);
  drawNoiseDust(t, seed + 1193, rust, 10);
  drawNoiseDust(t, seed + 1194, cyan, 8);
}

function drawNosinRifleSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 18, 20];
  const blueMetal: [number, number, number] = [42, 58, 62];
  const wornEdge: [number, number, number] = [132, 140, 126];
  const oldWood: [number, number, number] = [92, 54, 30];
  const woodLight: [number, number, number] = [142, 82, 42];
  const brass: [number, number, number] = [190, 132, 48];
  const red: [number, number, number] = [168, 44, 36];
  const rust: [number, number, number] = [136, 64, 34];

  ellipse(t, 34, 53, 19, 4, [10, 10, 8], seed + 2095, 80);
  line(t, 12, 47, 30, 38, 5.0, blackMetal, seed + 2096, 245);
  line(t, 14, 46, 29, 39, 3.1, oldWood, seed + 2097, 248);
  ellipse(t, 12, 47, 4.6, 5.8, oldWood, seed + 2098, 236);
  line(t, 15, 44, 29, 39, 0.9, woodLight, seed + 2099, 170);

  line(t, 21, 38, 59, 20, 2.8, blackMetal, seed + 2100, 255);
  line(t, 24, 37, 56, 21, 1.4, wornEdge, seed + 2101, 235);
  line(t, 23, 42, 48, 30, 2.4, oldWood, seed + 2102, 246);
  line(t, 27, 40, 46, 31, 0.8, woodLight, seed + 2103, 185);
  rect(t, 33, 32, 43, 37, blueMetal, seed + 2104, 246);
  rect(t, 35, 33, 42, 34, wornEdge, seed + 2105, 190);
  line(t, 42, 35, 49, 41, 1.4, blackMetal, seed + 2106, 230);
  ellipse(t, 49, 41, 2.4, 1.8, brass, seed + 2107, 210);

  line(t, 50, 24, 61, 19, 1.1, blackMetal, seed + 2108, 245);
  ellipse(t, 60, 19, 2.4, 1.3, wornEdge, seed + 2109, 180);
  rect(t, 24, 39, 31, 42, red, seed + 2110, 175);
  rect(t, 43, 28, 48, 30, rust, seed + 2111, 165);
  line(t, 22, 43, 47, 29, 0.9, rust, seed + 2112, 130);
  drawNoiseDust(t, seed + 2113, rust, 8);
  drawNoiseDust(t, seed + 2114, wornEdge, 5);
}

function drawMoskvinRifleSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 20];
  const blueMetal: [number, number, number] = [40, 58, 66];
  const wornEdge: [number, number, number] = [124, 142, 138];
  const stock: [number, number, number] = [82, 50, 30];
  const stockLight: [number, number, number] = [132, 82, 42];
  const brass: [number, number, number] = [186, 128, 48];
  const red: [number, number, number] = [170, 42, 36];
  const rust: [number, number, number] = [126, 62, 36];

  ellipse(t, 34, 53, 19, 4, [8, 9, 8], seed + 2115, 82);
  line(t, 11, 48, 30, 38, 5.3, blackMetal, seed + 2116, 246);
  line(t, 13, 47, 29, 39, 3.4, stock, seed + 2117, 248);
  ellipse(t, 12, 48, 4.8, 6.0, stock, seed + 2118, 236);
  line(t, 15, 45, 28, 39, 0.9, stockLight, seed + 2119, 176);

  line(t, 20, 38, 61, 18, 3.0, blackMetal, seed + 2120, 255);
  line(t, 23, 37, 58, 19, 1.2, wornEdge, seed + 2121, 235);
  line(t, 22, 42, 51, 28, 2.5, stock, seed + 2122, 246);
  line(t, 26, 40, 49, 29, 0.8, stockLight, seed + 2123, 184);
  rect(t, 32, 31, 45, 37, blueMetal, seed + 2124, 248);
  outlineRect(t, 32, 31, 45, 37, blackMetal);
  rect(t, 36, 32, 43, 33, wornEdge, seed + 2125, 185);
  line(t, 39, 29, 51, 24, 1.5, blackMetal, seed + 2126, 230);
  rect(t, 24, 39, 32, 42, red, seed + 2127, 180);
  rect(t, 46, 25, 52, 28, brass, seed + 2128, 180);
  line(t, 22, 43, 50, 29, 0.9, rust, seed + 2129, 135);
  rect(t, 53, 21, 60, 22, rust, seed + 2130, 160);
  drawNoiseDust(t, seed + 2131, rust, 10);
  drawNoiseDust(t, seed + 2132, wornEdge, 5);
}

function drawNagantSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 18, 20];
  const blueMetal: [number, number, number] = [42, 56, 62];
  const wornEdge: [number, number, number] = [128, 142, 136];
  const grip: [number, number, number] = [82, 48, 30];
  const gripLight: [number, number, number] = [134, 78, 42];
  const brass: [number, number, number] = [184, 126, 48];
  const red: [number, number, number] = [164, 42, 36];
  const rust: [number, number, number] = [124, 62, 34];

  ellipse(t, 33, 52, 14, 3.5, [8, 8, 8], seed + 2133, 78);
  line(t, 28, 35, 56, 23, 3.4, blackMetal, seed + 2134, 248);
  line(t, 31, 34, 55, 24, 1.4, wornEdge, seed + 2135, 228);
  rect(t, 49, 22, 58, 25, blueMetal, seed + 2136, 240);
  ellipse(t, 33, 36, 8.0, 8.6, blackMetal, seed + 2137, 248);
  ellipse(t, 33, 36, 5.5, 6.0, blueMetal, seed + 2138, 246);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ellipse(t, 33 + Math.cos(a) * 3.0, 36 + Math.sin(a) * 3.0, 0.9, 0.9, brass, seed + 2139 + i, 180);
  }
  line(t, 29, 39, 20, 52, 5.0, blackMetal, seed + 2145, 244);
  line(t, 28, 40, 21, 51, 3.2, grip, seed + 2146, 238);
  line(t, 22, 44, 27, 50, 0.7, gripLight, seed + 2147, 165);
  ellipse(t, 30, 43, 5.2, 3.6, blackMetal, seed + 2148, 230);
  clearRect(t, 29, 40, 33, 43);
  line(t, 35, 39, 42, 44, 1.1, blackMetal, seed + 2149, 210);
  rect(t, 24, 46, 31, 49, red, seed + 2150, 170);
  line(t, 29, 38, 52, 25, 0.8, rust, seed + 2151, 130);
  drawNoiseDust(t, seed + 2152, rust, 8);
}

function drawNailgunSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 24, 24];
  const metal: [number, number, number] = [70, 88, 92];
  const metalLight: [number, number, number] = [150, 162, 152];
  const yellow: [number, number, number] = [202, 150, 48];
  const wornYellow: [number, number, number] = [142, 102, 42];
  const red: [number, number, number] = [180, 42, 36];
  const cyan: [number, number, number] = [84, 186, 172];
  const rust: [number, number, number] = [130, 66, 36];

  ellipse(t, 34, 53, 16, 4, [8, 9, 8], seed + 2153, 84);
  rect(t, 21, 27, 46, 41, dark, seed + 2154, 248);
  rect(t, 24, 25, 47, 38, yellow, seed + 2155, 246);
  outlineRect(t, 24, 25, 47, 38, dark);
  rect(t, 29, 28, 42, 33, wornYellow, seed + 2156, 220);
  rect(t, 40, 27, 55, 31, metal, seed + 2157, 246);
  rect(t, 49, 25, 59, 29, metalLight, seed + 2158, 232);
  rect(t, 55, 24, 60, 27, dark, seed + 2159, 230);
  line(t, 31, 39, 24, 53, 5.0, dark, seed + 2160, 242);
  line(t, 32, 39, 25, 52, 3.0, yellow, seed + 2161, 226);
  rect(t, 36, 38, 42, 49, dark, seed + 2162, 230);
  rect(t, 37, 40, 40, 48, red, seed + 2163, 205);
  line(t, 43, 41, 52, 54, 2.3, metal, seed + 2164, 230);
  for (let i = 0; i < 6; i++) {
    const y = 42 + i * 2;
    rect(t, 44, y, 52, y, metalLight, seed + 2165 + i, 205);
  }
  ellipse(t, 29, 25, 3.5, 3.0, cyan, seed + 2171, 175);
  rect(t, 19, 31, 24, 36, red, seed + 2172, 172);
  line(t, 23, 38, 50, 28, 0.9, rust, seed + 2173, 135);
  drawNoiseDust(t, seed + 2174, rust, 11);
  drawNoiseDust(t, seed + 2175, cyan, 6);
}

function drawMetalChairSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [76, 92, 100];
  const metalLight: [number, number, number] = [154, 166, 160];
  const metalDark: [number, number, number] = [24, 30, 34];
  const rust: [number, number, number] = [132, 62, 34];
  const yellow: [number, number, number] = [210, 154, 58];
  const red: [number, number, number] = [164, 42, 34];

  ellipse(t, 33, 54, 18, 4, [0, 0, 0], seed + 1196, 82);
  rect(t, 36, 12, 51, 29, metal, seed + 1197, 242);
  outlineRect(t, 36, 12, 51, 29, metalDark);
  rect(t, 39, 15, 48, 18, metalLight, seed + 1198, 148);
  rect(t, 39, 23, 48, 25, yellow, seed + 1199, 190);
  clearRect(t, 49, 12, 51, 16);

  rect(t, 22, 32, 42, 43, metal, seed + 1200, 248);
  outlineRect(t, 22, 32, 42, 43, metalDark);
  rect(t, 25, 34, 39, 36, metalLight, seed + 1201, 130);
  line(t, 37, 29, 41, 33, 2.0, metalDark, seed + 1202, 230);
  line(t, 35, 30, 40, 34, 1.2, metalLight, seed + 1203, 190);

  line(t, 25, 42, 16, 55, 1.8, metalDark, seed + 1204, 236);
  line(t, 39, 42, 52, 54, 1.8, metalDark, seed + 1205, 236);
  line(t, 27, 42, 25, 56, 1.2, metalLight, seed + 1206, 208);
  line(t, 37, 42, 38, 55, 1.2, metalLight, seed + 1207, 208);
  line(t, 18, 52, 51, 53, 0.8, rust, seed + 1208, 160);
  line(t, 21, 45, 48, 19, 1.0, rust, seed + 1209, 128);
  rect(t, 42, 25, 51, 28, red, seed + 1210, 150);
  drawNoiseDust(t, seed + 1211, rust, 12);
}

function drawLosyashRifleSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 22];
  const blueMetal: [number, number, number] = [42, 64, 78];
  const edge: [number, number, number] = [126, 150, 146];
  const polymer: [number, number, number] = [72, 154, 170];
  const stock: [number, number, number] = [62, 48, 38];
  const red: [number, number, number] = [178, 42, 36];
  const yellow: [number, number, number] = [212, 154, 48];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 35, 53, 18, 4, [6, 8, 8], seed + 1230, 82);
  line(t, 10, 45, 30, 39, 5.2, blackMetal, seed + 1231, 245);
  line(t, 13, 44, 29, 39, 3.2, stock, seed + 1232, 238);
  line(t, 22, 39, 60, 18, 3.4, blackMetal, seed + 1233, 255);
  line(t, 25, 38, 57, 19, 1.8, blueMetal, seed + 1234, 250);
  line(t, 30, 35, 62, 17, 0.9, edge, seed + 1235, 232);
  line(t, 50, 22, 62, 16, 1.0, edge, seed + 1236, 230);
  rect(t, 26, 34, 42, 41, blackMetal, seed + 1237, 242);
  rect(t, 29, 35, 39, 38, blueMetal, seed + 1238, 230);
  rect(t, 35, 30, 47, 33, blackMetal, seed + 1239, 238);
  rect(t, 38, 28, 44, 30, edge, seed + 1240, 205);
  rect(t, 40, 39, 46, 47, polymer, seed + 1241, 220);
  line(t, 32, 41, 48, 49, 1.2, blackMetal, seed + 1242, 210);
  rect(t, 45, 23, 51, 26, red, seed + 1243, 200);
  rect(t, 24, 42, 33, 45, yellow, seed + 1244, 175);
  line(t, 22, 43, 51, 27, 0.8, rust, seed + 1245, 132);
  drawNoiseDust(t, seed + 1246, rust, 10);
  drawNoiseDust(t, seed + 1247, polymer, 7);
}

function drawMachinegunSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 18, 18];
  const blueMetal: [number, number, number] = [48, 62, 66];
  const edge: [number, number, number] = [126, 132, 118];
  const wood: [number, number, number] = [82, 52, 34];
  const brass: [number, number, number] = [188, 136, 50];
  const red: [number, number, number] = [166, 38, 34];
  const rust: [number, number, number] = [130, 66, 34];

  ellipse(t, 34, 54, 21, 4, [5, 5, 5], seed + 1248, 86);
  line(t, 10, 44, 28, 39, 5.6, blackMetal, seed + 1249, 245);
  line(t, 13, 43, 28, 39, 3.2, wood, seed + 1250, 230);
  line(t, 21, 38, 58, 24, 4.2, blackMetal, seed + 1251, 255);
  line(t, 25, 37, 55, 25, 2.2, blueMetal, seed + 1252, 248);
  line(t, 48, 26, 63, 22, 1.3, edge, seed + 1253, 232);
  rect(t, 24, 35, 45, 44, blackMetal, seed + 1254, 248);
  rect(t, 27, 36, 42, 40, blueMetal, seed + 1255, 238);
  rect(t, 42, 40, 49, 47, blackMetal, seed + 1256, 222);
  for (let i = 0; i < 8; i++) {
    const x = 18 + i * 4;
    const y = 47 + (i & 1);
    rect(t, x, y, x + 3, y + 3, brass, seed + 1257 + i, 224);
    rect(t, x, y + 3, x + 3, y + 4, blackMetal, seed + 1265 + i, 160);
  }
  line(t, 38, 44, 31, 56, 1.2, edge, seed + 1273, 205);
  line(t, 45, 42, 55, 54, 1.2, edge, seed + 1274, 205);
  rect(t, 34, 30, 43, 33, red, seed + 1275, 190);
  rect(t, 29, 41, 37, 43, brass, seed + 1276, 180);
  line(t, 22, 43, 52, 27, 0.9, rust, seed + 1277, 138);
  drawNoiseDust(t, seed + 1278, rust, 12);
}

function drawMakarovSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [16, 20, 20];
  const blueMetal: [number, number, number] = [54, 68, 72];
  const edge: [number, number, number] = [136, 144, 132];
  const grip: [number, number, number] = [58, 42, 34];
  const red: [number, number, number] = [172, 40, 36];
  const yellow: [number, number, number] = [210, 150, 44];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 52, 14, 3.5, [8, 8, 8], seed + 1279, 82);
  line(t, 14, 34, 48, 25, 5.0, blackMetal, seed + 1280, 250);
  line(t, 17, 33, 46, 26, 2.8, blueMetal, seed + 1281, 246);
  rect(t, 19, 32, 43, 38, blackMetal, seed + 1282, 246);
  rect(t, 23, 33, 40, 35, edge, seed + 1283, 170);
  rect(t, 45, 24, 54, 27, edge, seed + 1284, 218);
  line(t, 28, 38, 35, 51, 5.2, blackMetal, seed + 1285, 240);
  line(t, 30, 39, 36, 50, 3.2, grip, seed + 1286, 236);
  ellipse(t, 44, 36, 3.8, 5.0, blackMetal, seed + 1287, 205);
  rect(t, 35, 30, 39, 32, red, seed + 1288, 185);
  rect(t, 23, 36, 30, 38, yellow, seed + 1289, 150);
  line(t, 20, 37, 43, 29, 0.8, rust, seed + 1290, 120);
  drawNoiseDust(t, seed + 1291, rust, 8);
}

function drawTtPistolSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [14, 18, 20];
  const blueMetal: [number, number, number] = [46, 62, 70];
  const edge: [number, number, number] = [138, 150, 142];
  const grip: [number, number, number] = [76, 48, 34];
  const red: [number, number, number] = [174, 40, 36];
  const brass: [number, number, number] = [198, 146, 54];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 52, 14, 3.5, [8, 8, 8], seed + 1306, 80);
  line(t, 12, 34, 51, 24, 4.4, blackMetal, seed + 1307, 250);
  line(t, 15, 33, 49, 25, 2.4, blueMetal, seed + 1308, 246);
  rect(t, 18, 32, 45, 38, blackMetal, seed + 1309, 246);
  rect(t, 22, 33, 42, 35, edge, seed + 1310, 165);
  rect(t, 48, 23, 56, 26, edge, seed + 1311, 218);
  line(t, 29, 38, 36, 51, 5.0, blackMetal, seed + 1312, 240);
  line(t, 31, 39, 38, 50, 3.0, grip, seed + 1313, 236);
  ellipse(t, 46, 36, 3.5, 4.7, blackMetal, seed + 1314, 205);
  rect(t, 37, 29, 42, 31, red, seed + 1315, 188);
  rect(t, 24, 36, 31, 38, brass, seed + 1316, 150);
  line(t, 19, 37, 45, 29, 0.8, rust, seed + 1317, 122);
  drawNoiseDust(t, seed + 1318, rust, 9);
}

function drawKarkarovPistolSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 22, 24];
  const blueMetal: [number, number, number] = [42, 58, 64];
  const edge: [number, number, number] = [132, 146, 140];
  const grip: [number, number, number] = [62, 48, 40];
  const yellow: [number, number, number] = [214, 156, 52];
  const red: [number, number, number] = [170, 42, 36];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 52, 13, 3.4, [8, 8, 8], seed + 1292, 80);
  line(t, 14, 35, 45, 26, 4.4, dark, seed + 1293, 250);
  line(t, 17, 34, 43, 27, 2.4, blueMetal, seed + 1294, 246);
  rect(t, 19, 32, 40, 38, dark, seed + 1295, 246);
  rect(t, 22, 33, 37, 35, edge, seed + 1296, 165);
  rect(t, 42, 25, 50, 28, edge, seed + 1297, 218);
  line(t, 27, 38, 33, 50, 5.0, dark, seed + 1298, 238);
  line(t, 29, 39, 35, 49, 3.0, grip, seed + 1299, 235);
  ellipse(t, 42, 36, 3.5, 4.8, dark, seed + 1300, 205);
  rect(t, 23, 36, 30, 38, yellow, seed + 1301, 170);
  rect(t, 34, 30, 38, 32, red, seed + 1302, 190);
  rect(t, 15, 37, 22, 39, yellow, seed + 1303, 135);
  line(t, 20, 37, 42, 29, 0.8, rust, seed + 1304, 125);
  drawNoiseDust(t, seed + 1305, rust, 9);
}

function drawZatychkinPistolSprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 22];
  const blueMetal: [number, number, number] = [32, 58, 72];
  const coldEdge: [number, number, number] = [122, 148, 152];
  const grip: [number, number, number] = [52, 42, 38];
  const gripLight: [number, number, number] = [100, 72, 50];
  const yellow: [number, number, number] = [214, 154, 44];
  const red: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [128, 62, 34];

  ellipse(t, 32, 52, 14, 3.5, [6, 8, 8], seed + 3060, 82);
  line(t, 13, 36, 51, 23, 5.2, blackMetal, seed + 3061, 252);
  line(t, 17, 34, 49, 24, 2.6, blueMetal, seed + 3062, 248);
  for (let x = 26; x <= 43; x += 5) line(t, x, 28, x + 5, 26, 0.8, coldEdge, seed + 3063 + x, 178);
  rect(t, 18, 32, 43, 39, blackMetal, seed + 3070, 248);
  rect(t, 22, 33, 40, 35, coldEdge, seed + 3071, 156);
  rect(t, 47, 22, 56, 25, coldEdge, seed + 3072, 220);
  rect(t, 49, 24, 57, 27, blackMetal, seed + 3073, 230);
  line(t, 28, 39, 36, 52, 5.4, blackMetal, seed + 3074, 242);
  line(t, 31, 40, 38, 51, 3.4, grip, seed + 3075, 238);
  line(t, 32, 42, 37, 49, 0.8, gripLight, seed + 3076, 165);
  ellipse(t, 43, 37, 4.2, 5.2, blackMetal, seed + 3077, 210);
  rect(t, 20, 37, 31, 40, yellow, seed + 3078, 188);
  rect(t, 34, 29, 40, 32, red, seed + 3079, 202);
  rect(t, 43, 27, 49, 29, yellow, seed + 3080, 150);
  line(t, 18, 39, 48, 27, 0.8, rust, seed + 3081, 130);
  drawNoiseDust(t, seed + 3082, rust, 10);
  drawNoiseDust(t, seed + 3083, coldEdge, 7);
}

function drawKnifeSprite(t: Uint32Array, seed: number): void {
  const blade: [number, number, number] = [174, 184, 170];
  const bladeLight: [number, number, number] = [226, 232, 210];
  const bladeDark: [number, number, number] = [48, 58, 58];
  const handle: [number, number, number] = [86, 48, 34];
  const handleLight: [number, number, number] = [136, 76, 42];
  const red: [number, number, number] = [156, 36, 34];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 31, 53, 15, 3.4, [10, 10, 8], seed + 1306, 76);
  line(t, 18, 47, 43, 20, 4.0, bladeDark, seed + 1307, 238);
  line(t, 22, 43, 45, 18, 2.5, blade, seed + 1308, 248);
  line(t, 25, 40, 47, 17, 1.0, bladeLight, seed + 1309, 230);
  line(t, 17, 48, 29, 37, 5.0, handle, seed + 1310, 242);
  line(t, 18, 47, 29, 38, 2.4, handleLight, seed + 1311, 226);
  rect(t, 25, 38, 31, 43, bladeDark, seed + 1312, 230);
  rect(t, 17, 45, 22, 50, red, seed + 1313, 190);
  line(t, 30, 39, 43, 24, 0.8, rust, seed + 1314, 120);
  line(t, 21, 45, 30, 40, 0.8, bladeDark, seed + 1315, 135);
  drawNoiseDust(t, seed + 1316, rust, 8);
}

function drawP41HeavyMgSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [42, 54, 60];
  const metalLight: [number, number, number] = [108, 124, 124];
  const dark: [number, number, number] = [16, 18, 18];
  const brass: [number, number, number] = [188, 138, 58];
  const red: [number, number, number] = [178, 42, 34];
  const yellow: [number, number, number] = [214, 156, 62];
  const rust: [number, number, number] = [120, 58, 34];

  line(t, 12, 41, 52, 22, 2.9, dark, seed + 1310, 248);
  line(t, 20, 37, 56, 20, 2.0, metalLight, seed + 1311, 236);
  rect(t, 25, 32, 43, 42, metal, seed + 1312, 248);
  outlineRect(t, 25, 32, 43, 42, dark);
  rect(t, 18, 39, 30, 48, [92, 58, 36], seed + 1313, 235);
  rect(t, 35, 39, 46, 48, dark, seed + 1314, 228);
  line(t, 40, 43, 50, 55, 1.3, metalLight, seed + 1315, 220);
  line(t, 39, 43, 30, 55, 1.2, metalLight, seed + 1316, 210);
  line(t, 45, 39, 55, 52, 1.0, dark, seed + 1317, 205);
  for (let i = 0; i < 7; i++) {
    const x = 17 + i * 4;
    const y = 45 + ((i & 1) * 2);
    rect(t, x, y, x + 3, y + 5, brass, seed + 1318 + i, 230);
    rect(t, x, y + 4, x + 3, y + 5, dark, seed + 1325 + i, 160);
  }
  rect(t, 30, 28, 41, 32, yellow, seed + 1332, 205);
  rect(t, 45, 23, 53, 25, red, seed + 1333, 210);
  ellipse(t, 54, 20, 4.8, 2.5, red, seed + 1334, 130);
  line(t, 26, 33, 42, 23, 0.8, rust, seed + 1335, 140);
  drawNoiseDust(t, seed + 1336, rust, 14);
  drawNoiseDust(t, seed + 1337, brass, 8);
}

function drawPipeSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 18, 20];
  const metal: [number, number, number] = [50, 66, 72];
  const edge: [number, number, number] = [132, 146, 138];
  const rust: [number, number, number] = [142, 66, 34];
  const yellow: [number, number, number] = [210, 152, 46];
  const red: [number, number, number] = [162, 38, 34];

  ellipse(t, 32, 53, 18, 4, [6, 8, 8], seed + 1338, 82);
  line(t, 13, 48, 53, 17, 7.0, dark, seed + 1339, 248);
  line(t, 15, 47, 51, 18, 4.6, metal, seed + 1340, 252);
  line(t, 18, 44, 49, 19, 1.2, edge, seed + 1341, 220);
  line(t, 17, 49, 50, 24, 1.0, dark, seed + 1342, 150);
  ellipse(t, 14, 48, 5.8, 4.2, dark, seed + 1343, 248);
  ellipse(t, 15, 47, 3.0, 2.1, [4, 6, 6], seed + 1344, 245);
  ellipse(t, 53, 17, 5.2, 3.4, dark, seed + 1345, 245);
  ellipse(t, 52, 18, 2.7, 1.7, [5, 6, 6], seed + 1346, 238);
  rect(t, 27, 34, 36, 38, yellow, seed + 1347, 220);
  rect(t, 31, 35, 37, 37, red, seed + 1348, 198);
  line(t, 21, 43, 48, 23, 1.1, rust, seed + 1349, 165);
  rect(t, 39, 25, 45, 28, rust, seed + 1350, 175);
  rect(t, 19, 43, 25, 46, rust, seed + 1351, 160);
  drawNoiseDust(t, seed + 1352, rust, 13);
}

function drawRb91AutoShotgunSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 15, 18];
  const metal: [number, number, number] = [38, 54, 62];
  const edge: [number, number, number] = [116, 134, 132];
  const stock: [number, number, number] = [58, 44, 34];
  const redShell: [number, number, number] = [172, 38, 34];
  const redLight: [number, number, number] = [226, 64, 52];
  const brass: [number, number, number] = [198, 142, 54];
  const yellow: [number, number, number] = [218, 158, 48];
  const rust: [number, number, number] = [130, 62, 34];

  ellipse(t, 34, 53, 19, 4, [6, 7, 7], seed + 2400, 84);
  line(t, 11, 47, 29, 39, 5.6, dark, seed + 2401, 248);
  line(t, 14, 46, 28, 40, 3.5, stock, seed + 2402, 240);
  ellipse(t, 11, 48, 4.8, 5.2, stock, seed + 2403, 232);
  line(t, 27, 39, 34, 49, 1.8, dark, seed + 2404, 220);
  line(t, 20, 40, 60, 21, 5.6, dark, seed + 2405, 255);
  line(t, 23, 39, 57, 22, 3.1, metal, seed + 2406, 250);
  line(t, 26, 37, 57, 22, 1.0, edge, seed + 2407, 220);
  line(t, 38, 29, 62, 18, 2.4, dark, seed + 2408, 250);
  line(t, 41, 28, 60, 19, 1.1, edge, seed + 2409, 215);
  rect(t, 28, 34, 45, 41, dark, seed + 2410, 246);
  rect(t, 31, 35, 42, 38, metal, seed + 2411, 236);
  rect(t, 31, 41, 39, 50, dark, seed + 2412, 230);
  for (let i = 0; i < 5; i++) {
    const x = 34 + i * 4;
    const y = 31 - i * 2;
    rect(t, x, y, x + 1, y + 1, edge, seed + 2413 + i, 172);
  }
  for (let i = 0; i < 4; i++) {
    const x = 22 + i * 4;
    const y = 45 - i;
    rect(t, x, y, x + 2, y + 5, redShell, seed + 2420 + i, 220);
    rect(t, x, y + 5, x + 2, y + 6, brass, seed + 2424 + i, 210);
  }
  rect(t, 40, 31, 49, 34, redShell, seed + 2428, 205);
  rect(t, 42, 32, 48, 33, yellow, seed + 2429, 178);
  ellipse(t, 59, 20, 3.8, 2.1, redLight, seed + 2430, 145);
  line(t, 22, 42, 52, 27, 0.9, rust, seed + 2431, 135);
  drawNoiseDust(t, seed + 2432, rust, 11);
  drawNoiseDust(t, seed + 2433, edge, 6);
}

function drawRebarSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [24, 24, 22];
  const steel: [number, number, number] = [92, 98, 92];
  const edge: [number, number, number] = [148, 148, 124];
  const rust: [number, number, number] = [138, 66, 34];
  const rustLight: [number, number, number] = [188, 92, 46];
  const breakMetal: [number, number, number] = [178, 166, 126];
  const redRag: [number, number, number] = [164, 38, 34];
  const yellow: [number, number, number] = [214, 154, 48];

  ellipse(t, 33, 53, 18, 4, [8, 8, 7], seed + 2440, 80);
  line(t, 14, 49, 53, 16, 7.0, dark, seed + 2441, 245);
  line(t, 16, 48, 51, 18, 4.5, steel, seed + 2442, 252);
  line(t, 19, 45, 49, 19, 1.1, edge, seed + 2443, 218);
  line(t, 18, 50, 52, 23, 1.0, rust, seed + 2444, 180);
  for (let i = 0; i < 9; i++) {
    const x = 17 + i * 4;
    const y = 46 - i * 3;
    line(t, x - 1, y + 2, x + 4, y - 2, 1.0, rustLight, seed + 2445 + i, 190);
    line(t, x, y + 3, x + 5, y - 1, 0.7, dark, seed + 2454 + i, 135);
  }
  ellipse(t, 14, 49, 4.6, 3.3, breakMetal, seed + 2463, 235);
  ellipse(t, 53, 16, 4.8, 3.5, breakMetal, seed + 2464, 235);
  rect(t, 27, 34, 36, 40, redRag, seed + 2465, 222);
  rect(t, 29, 36, 37, 38, yellow, seed + 2466, 170);
  line(t, 27, 39, 38, 33, 0.8, dark, seed + 2467, 140);
  rect(t, 42, 23, 49, 27, rust, seed + 2468, 160);
  rect(t, 18, 43, 25, 47, rust, seed + 2469, 158);
  drawNoiseDust(t, seed + 2470, rust, 15);
  drawNoiseDust(t, seed + 2471, edge, 6);
}

function drawPistolGrenadeLauncherSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 17, 18];
  const metal: [number, number, number] = [44, 58, 64];
  const edge: [number, number, number] = [130, 142, 132];
  const grip: [number, number, number] = [62, 44, 32];
  const red: [number, number, number] = [184, 42, 34];
  const yellow: [number, number, number] = [218, 158, 46];
  const rust: [number, number, number] = [132, 62, 34];

  ellipse(t, 33, 53, 15, 3.5, [7, 8, 8], seed + 1353, 78);
  line(t, 13, 41, 35, 34, 5.6, dark, seed + 1354, 248);
  line(t, 16, 40, 35, 35, 3.4, metal, seed + 1355, 245);
  rect(t, 24, 34, 41, 40, dark, seed + 1356, 248);
  rect(t, 27, 35, 39, 37, edge, seed + 1357, 172);
  line(t, 28, 40, 22, 53, 5.2, dark, seed + 1358, 240);
  line(t, 29, 41, 23, 52, 3.2, grip, seed + 1359, 235);
  ellipse(t, 40, 33, 8.8, 6.6, dark, seed + 1360, 250);
  ellipse(t, 41, 33, 6.2, 4.6, metal, seed + 1361, 246);
  line(t, 38, 32, 55, 25, 5.0, dark, seed + 1362, 255);
  line(t, 41, 31, 53, 26, 2.7, edge, seed + 1363, 235);
  ellipse(t, 54, 25, 5.2, 3.2, dark, seed + 1364, 245);
  ellipse(t, 55, 25, 2.9, 1.7, [5, 6, 6], seed + 1365, 235);
  rect(t, 35, 29, 44, 33, yellow, seed + 1366, 225);
  rect(t, 39, 30, 45, 32, red, seed + 1367, 215);
  line(t, 20, 43, 47, 29, 0.9, rust, seed + 1368, 138);
  rect(t, 29, 43, 35, 45, rust, seed + 1369, 150);
  drawNoiseDust(t, seed + 1370, rust, 9);
}

function drawPlasmaSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [8, 12, 16];
  const metal: [number, number, number] = [36, 54, 66];
  const edge: [number, number, number] = [104, 130, 138];
  const cyan: [number, number, number] = [72, 230, 216];
  const violet: [number, number, number] = [144, 82, 210];
  const yellow: [number, number, number] = [212, 158, 54];
  const red: [number, number, number] = [174, 40, 38];
  const rust: [number, number, number] = [118, 62, 40];

  ellipse(t, 34, 53, 18, 4, [5, 7, 8], seed + 1371, 82);
  line(t, 12, 46, 31, 39, 5.2, dark, seed + 1372, 245);
  line(t, 15, 45, 30, 40, 2.9, [52, 40, 34], seed + 1373, 228);
  rect(t, 21, 42, 31, 51, dark, seed + 1374, 232);
  line(t, 30, 39, 36, 48, 1.6, edge, seed + 1375, 210);

  line(t, 18, 39, 58, 20, 5.2, dark, seed + 1376, 255);
  line(t, 21, 38, 55, 21, 3.0, metal, seed + 1377, 250);
  line(t, 24, 36, 55, 21, 1.1, edge, seed + 1378, 220);
  ellipse(t, 33, 34, 9.5, 7.4, dark, seed + 1379, 248);
  ellipse(t, 34, 34, 6.2, 4.8, cyan, seed + 1380, 160);
  ellipse(t, 34, 34, 3.2, 2.4, violet, seed + 1381, 190);
  for (let i = 0; i < 5; i++) {
    const x = 27 + i * 5;
    line(t, x, 36 - i * 1.8, x + 4, 40 - i * 1.8, 0.9, cyan, seed + 1382 + i, 200);
  }
  line(t, 48, 24, 62, 16, 2.0, edge, seed + 1387, 235);
  ellipse(t, 59, 18, 5.5, 3.0, cyan, seed + 1388, 165);
  ellipse(t, 61, 17, 8.5, 4.2, violet, seed + 1389, 52);
  rect(t, 24, 41, 33, 44, yellow, seed + 1390, 190);
  rect(t, 40, 28, 47, 31, red, seed + 1391, 185);
  line(t, 22, 43, 50, 27, 0.9, rust, seed + 1392, 120);
  drawNoiseDust(t, seed + 1393, cyan, 9);
  drawNoiseDust(t, seed + 1394, rust, 9);
}

function drawPpshSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 17, 18];
  const metal: [number, number, number] = [42, 56, 62];
  const edge: [number, number, number] = [124, 138, 130];
  const wood: [number, number, number] = [92, 54, 32];
  const woodLight: [number, number, number] = [138, 78, 38];
  const brass: [number, number, number] = [188, 132, 48];
  const red: [number, number, number] = [170, 42, 36];
  const rust: [number, number, number] = [128, 62, 34];

  ellipse(t, 34, 53, 19, 4, [7, 7, 7], seed + 1395, 82);
  line(t, 11, 47, 30, 38, 5.2, dark, seed + 1396, 246);
  line(t, 13, 46, 30, 39, 3.3, wood, seed + 1397, 246);
  ellipse(t, 12, 48, 4.8, 5.5, wood, seed + 1398, 232);
  line(t, 16, 44, 29, 39, 0.9, woodLight, seed + 1399, 180);
  line(t, 21, 38, 59, 20, 3.0, dark, seed + 1400, 255);
  line(t, 24, 37, 56, 21, 1.4, edge, seed + 1401, 228);
  line(t, 43, 27, 62, 18, 2.2, metal, seed + 1402, 245);
  for (let i = 0; i < 6; i++) {
    const x = 45 + i * 3;
    const y = 27 - i * 1.5;
    px(t, x, Math.round(y), rgba(dark[0], dark[1], dark[2], 220));
  }
  rect(t, 28, 33, 43, 39, metal, seed + 1408, 246);
  rect(t, 31, 34, 40, 35, edge, seed + 1409, 160);
  ellipse(t, 34, 43, 9.6, 8.2, dark, seed + 1410, 248);
  ellipse(t, 35, 43, 6.8, 5.7, metal, seed + 1411, 238);
  ellipse(t, 35, 43, 2.2, 1.9, brass, seed + 1412, 170);
  line(t, 40, 39, 49, 47, 1.2, dark, seed + 1413, 215);
  rect(t, 25, 40, 32, 43, red, seed + 1414, 170);
  line(t, 22, 43, 51, 27, 0.9, rust, seed + 1415, 132);
  rect(t, 45, 25, 51, 27, rust, seed + 1416, 160);
  drawNoiseDust(t, seed + 1417, rust, 9);
}

function drawSlyoznevPps41Sprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 16, 18];
  const metal: [number, number, number] = [38, 56, 62];
  const edge: [number, number, number] = [128, 146, 138];
  const stock: [number, number, number] = [58, 48, 38];
  const stockLight: [number, number, number] = [108, 70, 42];
  const red: [number, number, number] = [178, 42, 36];
  const yellow: [number, number, number] = [218, 158, 48];
  const heat: [number, number, number] = [226, 86, 42];
  const rust: [number, number, number] = [128, 64, 38];

  ellipse(t, 34, 53, 18, 4, [6, 7, 7], seed + 2642, 82);
  line(t, 13, 47, 30, 38, 4.8, dark, seed + 2643, 246);
  line(t, 15, 46, 30, 39, 2.7, stock, seed + 2644, 240);
  ellipse(t, 13, 48, 4.2, 4.8, stock, seed + 2645, 224);
  line(t, 17, 44, 29, 39, 0.8, stockLight, seed + 2646, 155);

  line(t, 21, 38, 58, 21, 5.2, dark, seed + 2647, 255);
  line(t, 24, 37, 55, 22, 2.9, metal, seed + 2648, 250);
  line(t, 27, 35, 55, 22, 1.0, edge, seed + 2649, 220);
  line(t, 43, 28, 62, 19, 1.8, dark, seed + 2650, 248);
  line(t, 47, 26, 60, 20, 0.9, edge, seed + 2651, 220);
  for (let i = 0; i < 5; i++) {
    const x = 43 + i * 3;
    const y = Math.round(29 - i * 1.3);
    px(t, x, y, rgba(edge[0], edge[1], edge[2], 150));
  }

  rect(t, 27, 33, 43, 40, dark, seed + 2652, 248);
  rect(t, 30, 34, 41, 36, metal, seed + 2653, 238);
  rect(t, 35, 39, 42, 53, dark, seed + 2654, 238);
  rect(t, 36, 40, 40, 51, metal, seed + 2655, 228);
  rect(t, 37, 42, 39, 49, edge, seed + 2656, 118);
  line(t, 26, 41, 35, 52, 1.3, dark, seed + 2657, 210);
  rect(t, 25, 40, 33, 43, red, seed + 2658, 190);
  rect(t, 28, 41, 33, 42, yellow, seed + 2659, 170);
  rect(t, 42, 27, 50, 30, red, seed + 2660, 188);
  ellipse(t, 59, 20, 3.8, 2.0, heat, seed + 2661, 155);
  line(t, 22, 43, 51, 27, 0.9, rust, seed + 2662, 138);
  drawNoiseDust(t, seed + 2663, rust, 11);
  drawNoiseDust(t, seed + 2664, edge, 6);
}

function drawPtrsLiquidatorSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [8, 12, 14];
  const metal: [number, number, number] = [34, 54, 62];
  const edge: [number, number, number] = [118, 142, 140];
  const stock: [number, number, number] = [58, 44, 34];
  const red: [number, number, number] = [176, 38, 34];
  const yellow: [number, number, number] = [218, 158, 52];
  const rust: [number, number, number] = [128, 62, 34];
  const harpoon: [number, number, number] = [174, 188, 174];

  ellipse(t, 34, 53, 20, 4, [6, 7, 7], seed + 1418, 84);
  line(t, 7, 49, 28, 38, 6.2, dark, seed + 1419, 248);
  line(t, 10, 47, 29, 39, 4.0, stock, seed + 1420, 242);
  ellipse(t, 10, 48, 5.4, 5.0, stock, seed + 1421, 232);

  line(t, 22, 38, 61, 18, 6.0, dark, seed + 1422, 255);
  line(t, 25, 37, 58, 20, 3.2, metal, seed + 1423, 248);
  line(t, 29, 35, 60, 19, 1.1, edge, seed + 1424, 226);
  line(t, 44, 25, 63, 15, 1.4, harpoon, seed + 1425, 230);
  line(t, 47, 24, 63, 18, 0.8, dark, seed + 1426, 185);
  rect(t, 27, 34, 45, 43, dark, seed + 1427, 248);
  rect(t, 30, 35, 42, 38, metal, seed + 1428, 238);
  rect(t, 41, 28, 51, 34, dark, seed + 1429, 245);
  rect(t, 44, 29, 49, 31, yellow, seed + 1430, 215);
  rect(t, 31, 41, 38, 51, dark, seed + 1431, 238);
  line(t, 38, 43, 48, 56, 1.3, edge, seed + 1432, 210);
  line(t, 37, 43, 28, 56, 1.1, edge, seed + 1433, 205);
  rect(t, 28, 31, 39, 34, red, seed + 1434, 214);
  rect(t, 30, 32, 37, 33, yellow, seed + 1435, 185);
  ellipse(t, 57, 20, 4.8, 2.6, red, seed + 1436, 122);
  line(t, 19, 43, 51, 27, 0.9, rust, seed + 1437, 140);
  rect(t, 51, 20, 57, 22, rust, seed + 1438, 155);
  drawNoiseDust(t, seed + 1439, rust, 13);
  drawNoiseDust(t, seed + 1440, harpoon, 7);
}

function drawRpl23LmgSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 16, 18];
  const metal: [number, number, number] = [38, 52, 58];
  const edge: [number, number, number] = [126, 142, 134];
  const brass: [number, number, number] = [188, 132, 48];
  const yellow: [number, number, number] = [218, 158, 46];
  const red: [number, number, number] = [174, 42, 36];
  const rust: [number, number, number] = [126, 62, 34];

  ellipse(t, 34, 53, 20, 4, [7, 8, 8], seed + 2320, 82);
  line(t, 11, 45, 31, 38, 6.0, dark, seed + 2321, 248);
  line(t, 14, 44, 31, 39, 3.2, metal, seed + 2322, 242);
  rect(t, 28, 33, 47, 42, dark, seed + 2323, 248);
  rect(t, 31, 34, 45, 38, metal, seed + 2324, 248);
  rect(t, 33, 35, 43, 36, edge, seed + 2325, 155);
  line(t, 43, 32, 62, 19, 3.0, dark, seed + 2326, 250);
  line(t, 45, 31, 59, 21, 1.4, edge, seed + 2327, 225);
  ellipse(t, 60, 20, 3.6, 2.4, dark, seed + 2328, 245);
  rect(t, 19, 43, 31, 50, dark, seed + 2329, 232);
  rect(t, 21, 44, 29, 47, yellow, seed + 2330, 208);

  for (let i = 0; i < 7; i++) {
    const x = 25 + i * 4;
    const y = 43 + ((i & 1) ? 2 : 0);
    rect(t, x, y, x + 2, y + 7, brass, seed + 2331 + i, 238);
    rect(t, x, y + 3, x + 2, y + 5, dark, seed + 2340 + i, 210);
  }
  line(t, 25, 43, 51, 48, 1.1, dark, seed + 2350, 210);
  rect(t, 43, 29, 51, 32, red, seed + 2351, 205);
  line(t, 20, 43, 51, 28, 0.9, rust, seed + 2352, 132);
  drawNoiseDust(t, seed + 2353, rust, 10);
}

function drawRoks47FlamethrowerSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [9, 14, 15];
  const metal: [number, number, number] = [38, 54, 58];
  const edge: [number, number, number] = [122, 142, 134];
  const tank: [number, number, number] = [68, 80, 70];
  const yellow: [number, number, number] = [220, 158, 44];
  const red: [number, number, number] = [188, 42, 34];
  const fire: [number, number, number] = [232, 88, 34];
  const rust: [number, number, number] = [128, 62, 34];

  ellipse(t, 33, 53, 19, 4, [7, 8, 8], seed + 2360, 84);
  rect(t, 13, 35, 27, 52, dark, seed + 2361, 240);
  rect(t, 15, 32, 29, 49, tank, seed + 2362, 248);
  ellipse(t, 22, 32, 7.2, 3.8, edge, seed + 2363, 190);
  outlineRect(t, 15, 32, 29, 49, dark);
  rect(t, 17, 38, 27, 42, red, seed + 2364, 210);
  rect(t, 19, 39, 26, 40, yellow, seed + 2365, 200);
  line(t, 25, 37, 35, 31, 1.4, edge, seed + 2366, 220);
  line(t, 27, 44, 42, 33, 1.2, dark, seed + 2367, 220);

  line(t, 24, 39, 58, 20, 4.8, dark, seed + 2368, 255);
  line(t, 27, 38, 55, 21, 2.5, metal, seed + 2369, 248);
  line(t, 31, 36, 54, 22, 0.9, edge, seed + 2370, 210);
  ellipse(t, 42, 30, 7.5, 5.4, dark, seed + 2371, 242);
  ellipse(t, 43, 30, 4.8, 3.2, metal, seed + 2372, 230);
  ellipse(t, 58, 20, 4.8, 3.0, dark, seed + 2373, 245);
  ellipse(t, 60, 19, 3.6, 2.2, fire, seed + 2374, 220);
  ellipse(t, 61, 19, 7.5, 3.6, fire, seed + 2375, 72);
  rect(t, 34, 34, 44, 37, yellow, seed + 2376, 195);
  rect(t, 38, 35, 45, 36, red, seed + 2377, 210);
  line(t, 23, 46, 50, 27, 0.9, rust, seed + 2378, 132);
  drawNoiseDust(t, seed + 2379, rust, 10);
  drawNoiseDust(t, seed + 2380, fire, 7);
  rect(t, 50, 23, 58, 25, yellow, seed + 2381, 214);
  rect(t, 55, 17, 63, 20, yellow, seed + 2382, 180);
}

function drawRubberClubSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [10, 14, 14];
  const rubberLight: [number, number, number] = [54, 64, 62];
  const grip: [number, number, number] = [26, 34, 32];
  const yellow: [number, number, number] = [214, 156, 48];
  const red: [number, number, number] = [164, 40, 34];
  const wear: [number, number, number] = [128, 138, 122];
  const grime: [number, number, number] = [62, 76, 64];

  ellipse(t, 32, 53, 16, 4, [7, 8, 8], seed + 2381, 80);
  line(t, 18, 48, 47, 18, 7.2, rubber, seed + 2382, 250);
  line(t, 20, 46, 45, 20, 4.4, rubberLight, seed + 2383, 190);
  line(t, 23, 44, 43, 22, 1.0, wear, seed + 2384, 135);
  ellipse(t, 47, 18, 4.8, 4.0, rubber, seed + 2385, 248);
  ellipse(t, 18, 48, 5.2, 4.2, rubber, seed + 2386, 248);
  line(t, 15, 51, 25, 41, 5.0, grip, seed + 2387, 248);
  for (let i = 0; i < 5; i++) line(t, 17 + i * 2, 49 - i * 2, 20 + i * 2, 52 - i * 2, 0.8, rubber, seed + 2388 + i, 220);
  rect(t, 27, 36, 36, 39, yellow, seed + 2393, 205);
  rect(t, 31, 37, 37, 38, red, seed + 2394, 205);
  line(t, 23, 44, 45, 22, 0.8, grime, seed + 2395, 120);
  drawNoiseDust(t, seed + 2396, wear, 8);
}



function psiWeaponGlow(defId: string): {
  glow: [number, number, number];
  glow2: [number, number, number];
  accent: [number, number, number];
} {
  if (defId === 'psi_beam') return { glow: [74, 202, 238], glow2: [154, 92, 230], accent: [220, 160, 58] };
  if (defId === 'psi_brainburn') return { glow: [218, 54, 76], glow2: [166, 78, 224], accent: [232, 190, 82] };
  if (defId === 'psi_concrete_splinter') return { glow: [126, 180, 194], glow2: [194, 194, 176], accent: [184, 74, 52] };
  if (defId === 'psi_control') return { glow: [78, 216, 134], glow2: [82, 172, 228], accent: [210, 164, 62] };
  if (defId === 'psi_madness') return { glow: [206, 72, 218], glow2: [230, 68, 64], accent: [226, 174, 62] };
  if (defId === 'psi_shield') return { glow: [94, 214, 238], glow2: [128, 98, 230], accent: [232, 196, 82] };
  if (defId === 'psi_possession') return { glow: [82, 226, 154], glow2: [198, 72, 230], accent: [222, 172, 70] };
  return { glow: [142, 92, 224], glow2: [80, 182, 230], accent: [210, 154, 54] };
}

function drawPsiWeaponSprite(t: Uint32Array, seed: number, defId: string): void {
  if (isPsiBundle032Clot(defId)) {
    drawPsiBundle032ClotSprite(t, seed, defId);
    return;
  }
  const dark: [number, number, number] = [14, 18, 24];
  const metal: [number, number, number] = [42, 58, 68];
  const rust: [number, number, number] = [126, 58, 42];
  const seal: [number, number, number] = [172, 38, 40];
  const concrete: [number, number, number] = [122, 128, 116];
  const concreteLight: [number, number, number] = [186, 190, 164];
  const { glow, glow2, accent } = psiWeaponGlow(defId);

  ellipse(t, 33, 53, 18, 4, [5, 6, 8], seed + 2400, 84);
  line(t, 13, 47, 32, 38, 5.4, dark, seed + 2401, 245);
  line(t, 15, 46, 31, 39, 2.8, metal, seed + 2402, 236);
  rect(t, 21, 42, 32, 52, dark, seed + 2403, 232);
  rect(t, 23, 45, 30, 47, seal, seed + 2404, 190);
  line(t, 20, 45, 51, 27, 0.8, rust, seed + 2405, 128);

  if (defId === 'psi_beam') {
    line(t, 20, 40, 56, 20, 5.0, dark, seed + 2410, 252);
    line(t, 23, 39, 54, 21, 2.4, glow, seed + 2411, 238);
    line(t, 32, 34, 60, 16, 1.4, glow2, seed + 2412, 220);
    ellipse(t, 56, 19, 6.5, 3.6, glow, seed + 2413, 178);
    rect(t, 32, 32, 42, 35, accent, seed + 2414, 190);
  } else if (defId === 'psi_brainburn') {
    line(t, 20, 40, 47, 28, 4.4, dark, seed + 2420, 248);
    ellipse(t, 41, 27, 11, 8.5, glow2, seed + 2421, 135);
    ellipse(t, 36, 30, 9.5, 8.0, glow, seed + 2422, 214);
    ellipse(t, 44, 28, 8.4, 7.2, glow, seed + 2423, 198);
    line(t, 33, 29, 47, 29, 0.8, dark, seed + 2424, 170);
    line(t, 36, 24, 38, 36, 0.8, dark, seed + 2425, 150);
    rect(t, 48, 27, 55, 31, seal, seed + 2426, 180);
  } else if (defId === 'psi_concrete_splinter') {
    line(t, 16, 47, 53, 17, 6.2, dark, seed + 2430, 238);
    line(t, 19, 45, 51, 18, 4.4, concrete, seed + 2431, 248);
    line(t, 24, 42, 48, 20, 1.2, concreteLight, seed + 2432, 206);
    line(t, 29, 39, 39, 47, 1.1, glow, seed + 2433, 190);
    line(t, 36, 30, 48, 37, 0.9, glow2, seed + 2434, 180);
    rect(t, 42, 20, 52, 25, rust, seed + 2435, 160);
    clearRect(t, 53, 14, 56, 18);
    clearRect(t, 15, 47, 18, 51);
  } else if (defId === 'psi_control') {
    line(t, 17, 45, 47, 29, 4.8, dark, seed + 2440, 250);
    ellipse(t, 40, 29, 14, 10, glow2, seed + 2441, 80);
    ellipse(t, 40, 29, 10, 7, glow, seed + 2442, 204);
    ellipse(t, 40, 29, 5.2, 3.4, [222, 226, 188], seed + 2443, 230);
    ellipse(t, 40, 29, 2.6, 2.6, glow2, seed + 2444, 245);
    line(t, 40, 26, 40, 32, 0.8, dark, seed + 2445, 235);
    for (let i = 0; i < 3; i++) {
      line(t, 25 + i * 5, 37 - i * 2, 31 + i * 6, 42 - i, 0.8, glow, seed + 2446 + i, 180);
    }
    rect(t, 24, 40, 35, 43, accent, seed + 2449, 165);
  } else if (defId === 'psi_madness') {
    line(t, 18, 44, 47, 31, 4.8, dark, seed + 2450, 248);
    ellipse(t, 38, 30, 13, 12, glow2, seed + 2451, 74);
    ellipse(t, 39, 30, 9.5, 9.0, glow, seed + 2452, 212);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + (seed & 15) * 0.03;
      line(t, 39, 30, 39 + Math.cos(a) * 15, 30 + Math.sin(a) * 13, 1.1, i & 1 ? glow2 : glow, seed + 2453 + i, 185);
    }
    line(t, 31, 23, 47, 38, 0.9, dark, seed + 2460, 190);
    line(t, 47, 23, 31, 39, 0.9, seal, seed + 2461, 185);
    rect(t, 22, 42, 33, 45, accent, seed + 2462, 168);
  } else if (defId === 'psi_shield') {
    line(t, 18, 45, 44, 30, 4.8, dark, seed + 2464, 248);
    ellipse(t, 39, 30, 15, 15, glow, seed + 2465, 74);
    arcLine(t, 39, 30, 12, 12, Math.PI * 0.12, Math.PI * 1.88, 2.4, glow, seed + 2466, 236, 22);
    arcLine(t, 39, 30, 8, 8, Math.PI * 0.2, Math.PI * 1.8, 1.4, glow2, seed + 2467, 224, 18);
    ellipse(t, 39, 30, 4.6, 4.6, [222, 238, 242], seed + 2468, 210);
    rect(t, 23, 41, 34, 44, accent, seed + 2469, 168);
  } else if (defId === 'psi_possession') {
    line(t, 17, 45, 47, 29, 4.8, dark, seed + 2473, 250);
    ellipse(t, 34, 31, 13, 10, glow2, seed + 2474, 88);
    ellipse(t, 45, 25, 9, 7, glow, seed + 2475, 190);
    ellipse(t, 31, 33, 5.2, 3.4, [222, 226, 188], seed + 2476, 230);
    ellipse(t, 46, 25, 3.8, 2.6, [222, 226, 188], seed + 2477, 225);
    line(t, 34, 31, 45, 25, 1.3, accent, seed + 2478, 210);
    line(t, 25, 39, 42, 22, 0.9, glow, seed + 2479, 190);
  } else {
    line(t, 19, 42, 52, 24, 4.8, dark, seed + 2470, 248);
    ellipse(t, 40, 29, 10, 8, glow, seed + 2471, 210);
    ellipse(t, 40, 29, 5, 4, glow2, seed + 2472, 230);
  }

  drawNoiseDust(t, seed + 2480, glow, 11);
  drawNoiseDust(t, seed + 2481, rust, 10);
}

function drawShmkDisposableSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [22, 26, 28];
  const metal: [number, number, number] = [68, 86, 88];
  const edge: [number, number, number] = [136, 154, 144];
  const yellow: [number, number, number] = [214, 158, 58];
  const red: [number, number, number] = [184, 42, 34];
  const flame: [number, number, number] = [232, 86, 38];
  const rust: [number, number, number] = [122, 62, 34];

  ellipse(t, 33, 53, 18, 4, [7, 7, 7], seed + 1500, 82);
  line(t, 12, 43, 43, 28, 6.5, dark, seed + 1501, 250);
  line(t, 14, 42, 42, 29, 4.2, metal, seed + 1502, 248);
  rect(t, 18, 35, 36, 46, metal, seed + 1503, 244);
  rect(t, 20, 37, 34, 40, yellow, seed + 1504, 215);
  rect(t, 22, 42, 33, 44, red, seed + 1505, 205);
  rect(t, 35, 25, 50, 33, dark, seed + 1506, 248);
  rect(t, 38, 26, 48, 29, edge, seed + 1507, 188);
  line(t, 43, 26, 57, 19, 2.4, dark, seed + 1508, 246);
  line(t, 47, 24, 58, 19, 1.1, flame, seed + 1509, 220);
  ellipse(t, 54, 20, 5.5, 3.2, flame, seed + 1510, 170);
  rect(t, 16, 43, 25, 50, dark, seed + 1511, 230);
  rect(t, 19, 46, 27, 49, yellow, seed + 1512, 190);
  line(t, 18, 46, 48, 28, 0.9, rust, seed + 1513, 128);
  drawNoiseDust(t, seed + 1514, rust, 11);
  drawNoiseDust(t, seed + 1515, yellow, 7);
}

function drawShockBatonSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 22, 24];
  const rubber: [number, number, number] = [38, 48, 52];
  const metal: [number, number, number] = [100, 124, 122];
  const cyan: [number, number, number] = [72, 218, 226];
  const red: [number, number, number] = [178, 42, 36];
  const yellow: [number, number, number] = [210, 152, 56];
  const rust: [number, number, number] = [114, 62, 36];

  ellipse(t, 33, 53, 16, 4, [6, 8, 8], seed + 1520, 82);
  line(t, 17, 48, 50, 15, 4.3, dark, seed + 1521, 250);
  line(t, 19, 46, 48, 17, 2.6, rubber, seed + 1522, 250);
  for (let i = 0; i < 4; i++) {
    const x = 24 + i * 6;
    const y = 41 - i * 6;
    ellipse(t, x, y, 3.4, 3.4, metal, seed + 1523 + i, 220);
    ellipse(t, x, y, 1.7, 1.7, cyan, seed + 1527 + i, 235);
  }
  line(t, 25, 41, 45, 20, 0.9, cyan, seed + 1531, 180);
  line(t, 29, 44, 49, 24, 0.7, cyan, seed + 1532, 140);
  line(t, 22, 37, 42, 17, 0.7, cyan, seed + 1533, 115);
  rect(t, 13, 45, 25, 52, dark, seed + 1534, 248);
  rect(t, 15, 47, 23, 49, red, seed + 1535, 180);
  rect(t, 40, 18, 48, 21, yellow, seed + 1536, 170);
  drawNoiseDust(t, seed + 1537, rust, 8);
  drawNoiseDust(t, seed + 1538, cyan, 12);
}

function drawSawedOffShotgunSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [20, 24, 26];
  const metal: [number, number, number] = [72, 92, 98];
  const edge: [number, number, number] = [150, 156, 140];
  const wood: [number, number, number] = [112, 64, 34];
  const woodLight: [number, number, number] = [162, 94, 48];
  const red: [number, number, number] = [166, 44, 36];
  const brass: [number, number, number] = [202, 142, 58];
  const rust: [number, number, number] = [120, 58, 34];

  ellipse(t, 33, 53, 18, 4, [7, 7, 7], seed + 1540, 82);
  line(t, 15, 44, 31, 36, 5.2, dark, seed + 1541, 248);
  line(t, 16, 43, 31, 36, 3.1, wood, seed + 1542, 246);
  ellipse(t, 14, 45, 4.5, 5.2, wood, seed + 1543, 232);
  line(t, 17, 41, 30, 36, 0.9, woodLight, seed + 1544, 178);
  line(t, 27, 34, 56, 20, 3.2, dark, seed + 1545, 255);
  line(t, 29, 32, 58, 18, 1.5, metal, seed + 1546, 244);
  line(t, 30, 36, 59, 22, 1.5, metal, seed + 1547, 244);
  line(t, 31, 31, 57, 19, 0.7, edge, seed + 1548, 160);
  rect(t, 29, 34, 42, 40, dark, seed + 1549, 248);
  rect(t, 31, 35, 39, 36, edge, seed + 1550, 150);
  rect(t, 24, 39, 34, 43, brass, seed + 1551, 160);
  rect(t, 22, 41, 30, 44, red, seed + 1552, 150);
  line(t, 21, 43, 51, 27, 0.9, rust, seed + 1553, 132);
  drawNoiseDust(t, seed + 1554, rust, 9);
}

function drawTozShotgunSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 22, 24];
  const metal: [number, number, number] = [66, 88, 96];
  const edge: [number, number, number] = [150, 160, 146];
  const wood: [number, number, number] = [112, 62, 34];
  const woodLight: [number, number, number] = [164, 94, 46];
  const brass: [number, number, number] = [204, 150, 60];
  const red: [number, number, number] = [166, 42, 36];
  const rust: [number, number, number] = [122, 62, 34];

  ellipse(t, 34, 53, 20, 4, [7, 7, 7], seed + 1555, 82);
  line(t, 9, 47, 31, 37, 5.4, dark, seed + 1556, 248);
  line(t, 11, 46, 29, 38, 3.4, wood, seed + 1557, 246);
  ellipse(t, 10, 48, 5.0, 5.7, wood, seed + 1558, 230);
  line(t, 14, 44, 30, 38, 0.9, woodLight, seed + 1559, 180);
  line(t, 27, 34, 60, 18, 3.0, dark, seed + 1560, 255);
  line(t, 29, 32, 61, 16, 1.25, metal, seed + 1561, 246);
  line(t, 30, 36, 61, 21, 1.25, metal, seed + 1562, 246);
  line(t, 31, 31, 59, 17, 0.75, edge, seed + 1563, 170);
  line(t, 32, 36, 59, 22, 0.75, edge, seed + 1564, 155);
  rect(t, 28, 33, 43, 40, dark, seed + 1565, 248);
  rect(t, 31, 34, 40, 36, edge, seed + 1566, 150);
  rect(t, 23, 39, 35, 43, brass, seed + 1567, 150);
  rect(t, 38, 30, 44, 33, red, seed + 1568, 170);
  line(t, 19, 44, 54, 25, 0.9, rust, seed + 1569, 130);
  drawNoiseDust(t, seed + 1570, rust, 10);
}

function drawScrubbedSerialPlateSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [132, 136, 128];
  const light: [number, number, number] = [204, 204, 188];
  const dark: [number, number, number] = [32, 36, 36];
  const grime: [number, number, number] = [70, 78, 72];
  const rust: [number, number, number] = [132, 62, 34];
  const red: [number, number, number] = [174, 34, 38];
  const yellow: [number, number, number] = [206, 168, 74];

  ellipse(t, 34, 47, 23, 4, [8, 8, 8], seed + 2560, 80);
  rect(t, 11, 23, 55, 42, dark, seed + 2561, 238);
  rect(t, 13, 21, 53, 40, metal, seed + 2562, 248);
  rect(t, 16, 24, 50, 28, light, seed + 2563, 150);
  rect(t, 16, 32, 50, 35, grime, seed + 2564, 170);
  clearRect(t, 13, 21, 17, 24);
  clearRect(t, 50, 21, 53, 25);
  clearRect(t, 13, 37, 17, 40);
  clearRect(t, 50, 36, 53, 40);
  outlineRect(t, 13, 21, 53, 40, dark);
  for (let x = 18; x <= 44; x += 7) {
    rect(t, x, 30, x + 4, 31, dark, 0, 130);
    line(t, x + 1, 24, x + 6, 38, 0.8, light, seed + 2565 + x, 165);
  }
  line(t, 18, 39, 50, 22, 1.4, red, seed + 2570, 225);
  line(t, 20, 22, 48, 40, 1.0, rust, seed + 2571, 200);
  ellipse(t, 17, 26, 3.0, 3.0, dark, seed + 2572, 210);
  ellipse(t, 49, 36, 3.0, 3.0, dark, seed + 2573, 210);
  ellipse(t, 17, 26, 1.4, 1.4, yellow, seed + 2574, 205);
  ellipse(t, 49, 36, 1.4, 1.4, yellow, seed + 2575, 205);
  drawNoiseDust(t, seed + 2576, rust, 13);
  drawNoiseDust(t, seed + 2577, grime, 8);
  rect(t, 18, 25, 49, 27, light, seed + 2578, 166);
  rect(t, 20, 36, 47, 38, metal, seed + 2579, 196);
  rect(t, 28, 29, 38, 29, metal, seed + 2580, 190);
}

function drawWeaponBlueprintT2Sprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 176, 98];
  const light: [number, number, number] = [232, 214, 132];
  const ink: [number, number, number] = [20, 22, 20];
  const blue: [number, number, number] = [54, 126, 148];
  const cyan: [number, number, number] = [78, 214, 222];
  const red: [number, number, number] = [176, 38, 34];
  const rust: [number, number, number] = [126, 64, 34];
  const damp: [number, number, number] = [78, 96, 88];

  ellipse(t, 34, 34, 22, 18, cyan, seed + 2581, 30);
  rect(t, 14, 16, 51, 49, paper, seed + 2582, 248);
  rect(t, 17, 13, 44, 21, light, seed + 2583, 236);
  rect(t, 31, 16, 52, 22, paper, seed + 2584, 246);
  outlineRect(t, 14, 16, 51, 49, ink);
  clearRect(t, 14, 16, 18, 19);
  clearRect(t, 49, 17, 51, 22);
  clearRect(t, 15, 46, 18, 49);
  rect(t, 14, 42, 51, 49, damp, seed + 2585, 92);
  for (let y = 24; y <= 38; y += 5) rect(t, 21, y, 44 - ((seed + y) & 5), y + 1, blue, 0, 170);
  line(t, 22, 26, 44, 26, 0.7, cyan, seed + 2596, 170);
  line(t, 24, 36, 41, 35, 0.7, cyan, seed + 2597, 150);
  line(t, 19, 43, 45, 30, 2.2, ink, seed + 2586, 220);
  line(t, 22, 42, 42, 32, 1.2, cyan, seed + 2587, 185);
  rect(t, 27, 38, 36, 43, ink, seed + 2588, 190);
  line(t, 38, 32, 50, 27, 1.0, ink, seed + 2589, 210);
  rect(t, 40, 29, 49, 31, red, seed + 2590, 202);
  ellipse(t, 41, 34, 7.2, 5.0, red, seed + 2591, 210);
  ellipse(t, 41, 34, 3.9, 2.4, paper, seed + 2592, 220);
  rect(t, 28, 44, 39, 47, red, seed + 2593, 180);
  drawNoiseDust(t, seed + 2594, rust, 11);
  drawNoiseDust(t, seed + 2595, cyan, 10);
}

function drawWeaponCheckoutTagSprite(t: Uint32Array, seed: number): void {
  const tag: [number, number, number] = [174, 118, 58];
  const tagLight: [number, number, number] = [216, 166, 84];
  const ink: [number, number, number] = [18, 18, 16];
  const string: [number, number, number] = [156, 148, 106];
  const red: [number, number, number] = [178, 38, 34];
  const metal: [number, number, number] = [52, 64, 68];
  const yellow: [number, number, number] = [216, 158, 46];
  const damp: [number, number, number] = [76, 86, 72];
  const rust: [number, number, number] = [128, 64, 34];

  line(t, 29, 10, 20, 20, 1.1, string, seed + 2596, 210);
  line(t, 29, 10, 38, 20, 1.1, string, seed + 2597, 205);
  ellipse(t, 29, 10, 3.2, 3.2, string, seed + 2598, 222);
  ellipse(t, 29, 10, 1.2, 1.2, [0, 0, 0], 0, 0);
  rect(t, 17, 18, 48, 51, tag, seed + 2599, 248);
  rect(t, 20, 21, 45, 27, tagLight, seed + 2600, 222);
  outlineRect(t, 17, 18, 48, 51, ink);
  clearRect(t, 17, 18, 20, 21);
  clearRect(t, 46, 19, 48, 24);
  clearRect(t, 18, 48, 21, 51);
  rect(t, 17, 44, 48, 51, damp, seed + 2601, 98);
  ellipse(t, 29, 23, 3.8, 3.0, ink, seed + 2602, 210);
  ellipse(t, 29, 23, 1.8, 1.4, [0, 0, 0], 0, 0);
  line(t, 22, 37, 40, 31, 2.1, ink, seed + 2603, 216);
  line(t, 37, 31, 45, 28, 1.0, metal, seed + 2604, 218);
  rect(t, 26, 38, 35, 42, metal, seed + 2605, 194);
  for (let y = 31; y <= 43; y += 4) rect(t, 22, y, 36 - ((seed + y) & 3), y + 1, ink, 0, 124);
  rect(t, 36, 22, 46, 25, red, seed + 2606, 205);
  rect(t, 38, 23, 44, 24, yellow, seed + 2607, 184);
  line(t, 21, 49, 47, 26, 0.8, rust, seed + 2608, 126);
  drawNoiseDust(t, seed + 2609, rust, 11);
}

function drawWrenchSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 24, 24];
  const steel: [number, number, number] = [90, 106, 108];
  const edge: [number, number, number] = [168, 178, 166];
  const red: [number, number, number] = [178, 42, 34];
  const yellow: [number, number, number] = [214, 156, 48];
  const rust: [number, number, number] = [134, 66, 36];
  const grime: [number, number, number] = [48, 58, 52];

  ellipse(t, 33, 53, 18, 4, [8, 9, 8], seed + 2610, 82);
  line(t, 15, 49, 44, 23, 7.0, dark, seed + 2611, 248);
  line(t, 17, 47, 43, 24, 4.5, steel, seed + 2612, 250);
  line(t, 20, 44, 41, 25, 1.2, edge, seed + 2613, 190);
  ellipse(t, 17, 49, 6.0, 4.6, dark, seed + 2614, 248);
  ellipse(t, 17, 49, 3.0, 2.0, [0, 0, 0], 0, 0);
  rect(t, 24, 40, 34, 45, red, seed + 2615, 205);
  rect(t, 26, 41, 32, 42, yellow, seed + 2616, 190);
  ellipse(t, 45, 22, 11, 8, dark, seed + 2617, 250);
  ellipse(t, 48, 20, 7.2, 5.8, edge, seed + 2618, 246);
  ellipse(t, 49, 21, 4.5, 3.2, [0, 0, 0], 0, 0);
  clearRect(t, 48, 11, 57, 19);
  line(t, 39, 24, 54, 16, 2.2, edge, seed + 2619, 238);
  line(t, 38, 25, 50, 31, 2.0, steel, seed + 2620, 238);
  rect(t, 40, 25, 49, 28, red, seed + 2621, 176);
  line(t, 20, 47, 48, 22, 0.9, rust, seed + 2622, 138);
  rect(t, 38, 30, 45, 32, rust, seed + 2623, 160);
  ellipse(t, 46, 41, 5.2, 3.0, grime, seed + 2624, 122);
  drawNoiseDust(t, seed + 2625, rust, 11);
  drawNoiseDust(t, seed + 2626, edge, 7);
}

function drawTanevSvt40Sprite(t: Uint32Array, seed: number): void {
  const blackMetal: [number, number, number] = [12, 18, 22];
  const blueMetal: [number, number, number] = [42, 58, 66];
  const edge: [number, number, number] = [132, 144, 134];
  const wood: [number, number, number] = [104, 62, 34];
  const woodLight: [number, number, number] = [150, 92, 46];
  const brass: [number, number, number] = [202, 154, 62];
  const red: [number, number, number] = [178, 42, 36];
  const rust: [number, number, number] = [132, 66, 34];

  ellipse(t, 34, 53, 20, 4, [8, 8, 7], seed + 2627, 82);
  line(t, 10, 48, 31, 37, 5.6, blackMetal, seed + 2628, 250);
  line(t, 12, 47, 30, 38, 3.6, wood, seed + 2629, 246);
  ellipse(t, 12, 48, 5.4, 5.6, wood, seed + 2630, 235);
  line(t, 16, 43, 31, 36, 1.0, woodLight, seed + 2631, 175);
  line(t, 20, 40, 59, 20, 3.8, blackMetal, seed + 2632, 255);
  line(t, 23, 39, 56, 22, 2.0, blueMetal, seed + 2633, 252);
  line(t, 25, 37, 56, 22, 0.8, edge, seed + 2634, 225);
  line(t, 48, 24, 61, 18, 1.4, blackMetal, seed + 2635, 245);
  px(t, 61, 18, rgba(edge[0], edge[1], edge[2], 220));
  rect(t, 29, 33, 42, 39, blueMetal, seed + 2636, 248);
  rect(t, 32, 35, 39, 37, brass, seed + 2637, 214);
  line(t, 28, 39, 47, 30, 2.6, wood, seed + 2638, 240);
  line(t, 30, 38, 44, 31, 1.2, woodLight, seed + 2639, 180);
  line(t, 31, 39, 36, 49, 2.8, blackMetal, seed + 2640, 230);
  line(t, 34, 40, 38, 49, 1.8, blueMetal, seed + 2641, 225);
  rect(t, 42, 27, 47, 30, red, seed + 2642, 205);
  rect(t, 49, 22, 55, 24, brass, seed + 2643, 180);
  line(t, 17, 47, 51, 25, 0.8, rust, seed + 2644, 128);
  rect(t, 23, 42, 29, 44, rust, seed + 2645, 160);
  rect(t, 36, 31, 42, 32, rust, seed + 2646, 145);
  drawNoiseDust(t, seed + 2647, rust, 9);
  drawNoiseDust(t, seed + 2648, edge, 7);
}

type WeaponSpriteHandler = (t: Uint32Array, seed: number, p: Palette, defId: string) => void;
const WEAPON_SPRITE_HANDLERS: Record<string, WeaponSpriteHandler> = {
  'tanev_svt40': drawTanevSvt40Sprite,
  'weapon_blueprint_t2': drawWeaponBlueprintT2Sprite,
  'weapon_checkout_tag': drawWeaponCheckoutTagSprite,
  'wrench': drawWrenchSprite,
  'scrubbed_serial_plate': drawScrubbedSerialPlateSprite,
  'shmk_disposable': drawShmkDisposableSprite,
  'shock_baton': drawShockBatonSprite,
  'shotgun': drawSawedOffShotgunSprite,
  'toz_shotgun': drawTozShotgunSprite,
  'pushkin_shotgun': drawPushkinShotgunSprite,
  'ptrs_liquidator': drawPtrsLiquidatorSprite,
  'rpl23_lmg': drawRpl23LmgSprite,
  'roks47_flamethrower': drawRoks47FlamethrowerSprite,
  'rubber_club': drawRubberClubSprite,
  'rb91_auto_shotgun': drawRb91AutoShotgunSprite,
  'rebar': drawRebarSprite,
  'p41_heavy_mg': drawP41HeavyMgSprite,
  'agnia_a130': drawAgniaA130Sprite,
  'ato41_atomic_flamer': drawAto41AtomicFlamerSprite,
  'ak47': drawAk47Sprite,
  'axe': drawAxeSprite,
  'liquidator_axe': drawLiquidatorAxeSprite,
  'rusty_rake': drawRustyRakeSprite,
  'liquidator_rake': drawLiquidatorRakeSprite,
  'bayonet': drawBayonetSprite,
  'rake_bayonet': drawRakeBayonetSprite,
  'bfg': drawBfgSprite,
  'chain': drawChainSprite,
  'chainsaw': drawChainsawSprite,
  'chest_failsafe_charge': drawChestFailsafeChargeSprite,
  'chizh3_shotgun': drawChizh3ShotgunSprite,
  'conscripts_doublebarrel': drawConscriptsDoublebarrelSprite,
  'breach_charge': drawBreachChargeSprite,
  'brt2_foam_projector': drawBrt2FoamProjectorSprite,
  'pbrog1_foam_launcher': drawPbrog1FoamLauncherSprite,
  'party_might_launcher': drawPartyMightLauncherSprite,
  'concrete_breaker_grenade': drawConcreteBreakerGrenadeSprite,
  'crowbar': drawCrowbarSprite,
  'entrenching_spade': drawEntrenchingSpadeSprite,
  'eralashnikov_auto': drawEralashnikovAutoSprite,
  'fire_hook': drawFireHookSprite,
  'nosin_rifle': drawNosinRifleSprite,
  'moskvin_rifle': drawMoskvinRifleSprite,
  'nagant': drawNagantSprite,
  'nailgun': drawNailgunSprite,
  'o15_multijet_flamer': drawO15MultijetFlamerSprite,
  'flamethrower': drawFlamethrowerSprite,
  'foam_grenade_6p10': drawFoamGrenade6p10Sprite,
  'g41_grenade_launcher': drawG41GrenadeLauncherSprite,
  'gauss': drawGaussRifleSprite,
  'homemade_pistol': drawHomemadePistolSprite,
  'granit4u_belt_shotgun': drawGranit4uBeltShotgunSprite,
  'gravity_beam_emitter': drawGravityBeamEmitterSprite,
  'grn420_gravizhernov': drawGrn420GravizhernovSprite,
  'tracked_zhernov': drawTrackedZhernovSprite,
  'gusl_index_fragment': drawGuslIndexFragmentSprite,
  'grenade': drawGrenadeSprite,
  'hammer': drawHammerSprite,
  'sledgehammer': drawSledgehammerSprite,
  'harpoon_gun': drawHarpoonGunSprite,
  'losyash_rifle': drawLosyashRifleSprite,
  'machinegun': drawMachinegunSprite,
  'makarov': drawMakarovSprite,
  'tt_pistol': drawTtPistolSprite,
  'karkarov_pistol': drawKarkarovPistolSprite,
  'zatychkin_pistol': drawZatychkinPistolSprite,
  'knife': drawKnifeSprite,
  'metal_chair': drawMetalChairSprite,
  'pipe': drawPipeSprite,
  'pistol_grenade_launcher': drawPistolGrenadeLauncherSprite,
  'plasma': drawPlasmaSprite,
  'ppsh': drawPpshSprite,
  'slyoznev_pps41': drawSlyoznevPps41Sprite,
};

function drawWeaponSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  const handler = WEAPON_SPRITE_HANDLERS[defId];
  if (handler) {
    handler(t, seed, p, defId);
    return;
  }
  if (defId.startsWith('psi_')) {
    drawPsiWeaponSprite(t, seed, defId);
    return;
  }
  if (defId.includes('grenade') || defId.includes('charge')) {
    ellipse(t, 31, 36, 12, 15, p.body, seed + 51);
    rect(t, 28, 18, 36, 25, p.dark, seed + 52);
    line(t, 35, 20, 45, 16, 1.3, p.light, seed + 53);
    return;
  }
  if (defId.includes('rake') || defId.includes('axe') || defId.includes('bayonet') || defId.includes('club') || defId.includes('zhernov')) {
    line(t, 20, 48, 44, 17, 2.1, p.body, seed + 54);
    line(t, 40, 16, 49, 23, 2.1, p.light, seed + 55);
    line(t, 39, 18, 47, 14, 1.2, p.dark, seed + 56);
    return;
  }
  line(t, 15, 41, 49, 24, 2.2, p.dark, seed + 57);
  line(t, 24, 36, 53, 22, 1.5, p.light, seed + 58);
  rect(t, 20, 39, 31, 47, [92, 58, 36], seed + 59);
  rect(t, 33, 30, 42, 36, p.body, seed + 60);
  if (defId.includes('flame') || defId.includes('roks') || defId.includes('agnia')) ellipse(t, 49, 22, 5, 3, [230, 92, 38], seed + 61, 220);
}


function drawChemicalShellSprite(t: Uint32Array, seed: number, p: Palette): void {
  const hull: [number, number, number] = [32, 52, 42];
  const decon: [number, number, number] = [82, 178, 104];
  const warning: [number, number, number] = [226, 112, 42];
  const redSeal: [number, number, number] = [172, 42, 38];

  for (let i = 0; i < 3; i++) {
    const x = 20 + i * 9 + (i === 1 ? 1 : 0);
    const y0 = 18 + (i === 1 ? -2 : i === 2 ? 2 : 0);
    const y1 = 49 + (i === 1 ? -1 : 0);
    rect(t, x, y0 + 5, x + 5, y1 - 4, hull, seed + 68 + i);
    rect(t, x, y0 + 2, x + 5, y0 + 7, p.light, seed + 72 + i);
    rect(t, x - 1, y1 - 6, x + 6, y1, p.body, seed + 76 + i);
    rect(t, x, y0 + 15, x + 5, y0 + 20, decon, seed + 80 + i, 235);
    rect(t, x, y0 + 22, x + 5, y0 + 24, warning, seed + 84 + i, 240);
    line(t, x + 3, y0 + 8, x + 3, y1 - 8, 0.6, p.dark, seed + 88 + i, 150);
  }

  rect(t, 43, 25, 50, 28, redSeal, seed + 92, 235);
  rect(t, 44, 31, 49, 32, redSeal, seed + 93, 210);
  line(t, 17, 50, 48, 48, 1.2, decon, seed + 94, 125);
  drawNoiseDust(t, seed + 95, decon, 18);
}

function drawAmmoCouponSprite(t: Uint32Array, seed: number, defId: string): void {
  const shells = defId.includes('shell');
  const rifle = defId.includes('rifle') || defId.includes('762');
  const paper: [number, number, number] = [166, 154, 112];
  const paperLight: [number, number, number] = [218, 202, 146];
  const paperDark: [number, number, number] = [48, 42, 32];
  const damp: [number, number, number] = [68, 84, 68];
  const brass: [number, number, number] = [176, 126, 54];
  const brassLight: [number, number, number] = [236, 184, 82];
  const caseDark: [number, number, number] = [46, 38, 30];
  const red: [number, number, number] = [180, 44, 36];
  const green: [number, number, number] = [62, 146, 86];
  const orange: [number, number, number] = [214, 122, 42];
  const code: [number, number, number] = defId.includes('9mm') ? green : shells ? red : rifle ? orange : green;

  rect(t, 14, 14, 50, 51, paper, seed + 63, 238);
  rect(t, 17, 17, 47, 22, paperLight, seed + 64, 220);
  outlineRect(t, 14, 14, 50, 51, paperDark);
  clearRect(t, 14, 14, 17, 17);
  clearRect(t, 48, 15, 50, 19);
  clearRect(t, 15, 48, 18, 51);
  rect(t, 16, 44, 48, 51, damp, seed + 65, 92);
  rect(t, 17, 24, 20, 44, code, seed + 66, 225);
  rect(t, 15, 44, 48, 48, paperLight, seed + 161, 168);
  rect(t, 23, 19, 43, 20, paperDark, 0, 120);
  for (let y = 28; y <= 42; y += 5) rect(t, 23, y, 39 - ((seed + y) & 3), y + 1, paperDark, 0, 116);
  rect(t, 37, 25, 48, 38, code, seed + 67, 205);
  rect(t, 39, 28, 41, 35, paper, seed + 68, 225);
  rect(t, 43, 28, 45, 35, paper, seed + 69, 225);
  rect(t, 43, 34, 48, 36, paper, seed + 70, 225);

  const count = shells ? 3 : defId.includes('9mm') ? 5 : 4;
  for (let i = 0; i < count; i++) {
    const x = shells ? 24 + i * 8 : defId.includes('9mm') ? 20 + i * 5 : 20 + i * 7;
    const top = shells ? 25 + (i & 1) * 2 : 18 + (i & 1) * 2;
    const bottom = shells ? 48 - (i === 1 ? 2 : 0) : 48 - (i === 2 ? 2 : 0);
    const w = shells ? 5 : 3;
    const band: [number, number, number] = i === 0 ? code : i === 1 ? red : i === 2 ? orange : green;
    rect(t, x - 1, top + 5, x + w + 1, bottom, caseDark, seed + 80 + i, 230);
    rect(t, x, top + 5, x + w, bottom - 2, shells ? code : brass, seed + 90 + i, 252);
    rect(t, x + 1, top + 6, x + 1, bottom - 5, shells ? paperLight : brassLight, seed + 100 + i, 160);
    rect(t, x, top + 2, x + w, top + 6, shells ? brass : caseDark, seed + 120 + i, 238);
    ellipse(t, x + w * 0.5, top + 1.5, shells ? 2.7 : 2.2, shells ? 2.2 : 2.8, shells ? brassLight : [116, 78, 46], seed + 130 + i, 235);
    rect(t, x, bottom - 12, x + w, bottom - 9, band, seed + 140 + i, 245);
    ellipse(t, x + w * 0.5, bottom, shells ? 3.1 : 2.8, 2, caseDark, seed + 150 + i, 230);
  }

  if (shells) {
    for (let i = 0; i < 6; i++) {
      const x = 18 + (i % 3) * 3 + ((i / 3) | 0);
      const y = 32 + ((i / 3) | 0) * 4 + (i & 1);
      ellipse(t, x, y, 1.1, 1.1, brassLight, seed + 156 + i, 170);
    }
    rect(t, 21, 38, 29, 40, code, seed + 162, 175);
  }

  if (rifle) {
    rect(t, 18, 22, 22, 25, red, seed + 163, 230);
    rect(t, 18, 28, 22, 31, green, seed + 164, 220);
  }

  line(t, 22, 42, 47, 37, 0.8, paperDark, seed + 155, 130);
  drawNoiseDust(t, seed + 160, [106, 72, 48], 14);
}

function drawAmmoIssueOrderSprite(t: Uint32Array, seed: number, defId = 'ammo_issue_order'): void {
  if (defId !== 'ammo_issue_order') {
    drawAmmoCouponSprite(t, seed, defId);
    return;
  }
  const paper: [number, number, number] = [178, 166, 118];
  const paperLight: [number, number, number] = [222, 208, 150];
  const paperDark: [number, number, number] = [54, 48, 36];
  const damp: [number, number, number] = [76, 88, 74];
  const brass: [number, number, number] = [176, 126, 54];
  const brassLight: [number, number, number] = [236, 184, 82];
  const caseDark: [number, number, number] = [48, 42, 34];
  const red: [number, number, number] = [180, 44, 36];
  const green: [number, number, number] = [62, 146, 86];
  const orange: [number, number, number] = [214, 122, 42];

  rect(t, 14, 13, 50, 52, paper, seed + 63, 238);
  rect(t, 17, 16, 47, 22, paperLight, seed + 64, 220);
  outlineRect(t, 14, 13, 50, 52, paperDark);
  clearRect(t, 14, 13, 17, 16);
  clearRect(t, 48, 14, 50, 18);
  clearRect(t, 15, 49, 18, 52);
  rect(t, 16, 44, 48, 52, damp, seed + 65, 96);
  line(t, 16, 24, 47, 19, 0.7, paperDark, seed + 66, 105);
  for (let y = 27; y <= 43; y += 5) rect(t, 18, y, 37 - ((seed + y) & 3), y + 1, paperDark, 0, 125);
  rect(t, 37, 26, 48, 39, red, seed + 67, 210);
  rect(t, 39, 29, 41, 36, paper, seed + 68, 225);
  rect(t, 43, 29, 45, 36, paper, seed + 69, 225);
  rect(t, 43, 35, 48, 37, paper, seed + 70, 225);
  rect(t, 37, 41, 47, 44, orange, seed + 71, 180);

  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 7;
    const top = 17 + (i & 1) * 2;
    const bottom = 48 - (i === 2 ? 2 : 0);
    const band: [number, number, number] = i === 0 ? red : i === 1 ? green : i === 2 ? orange : [92, 104, 96];
    rect(t, x - 1, top + 5, x + 4, bottom, caseDark, seed + 80 + i, 230);
    rect(t, x, top + 5, x + 3, bottom - 2, brass, seed + 90 + i, 252);
    rect(t, x + 1, top + 6, x + 1, bottom - 5, brassLight, seed + 100 + i, 165);
    ellipse(t, x + 1.5, top + 4, 2.5, 4, brassLight, seed + 110 + i, 245);
    rect(t, x, top + 2, x + 3, top + 6, caseDark, seed + 120 + i, 238);
    ellipse(t, x + 1.5, top + 1.5, 2.2, 2.8, [116, 78, 46], seed + 130 + i, 235);
    rect(t, x, bottom - 12, x + 3, bottom - 9, band, seed + 140 + i, 245);
    ellipse(t, x + 1.5, bottom, 2.8, 2, caseDark, seed + 150 + i, 230);
  }

  drawNoiseDust(t, seed + 160, [106, 72, 48], 15);
}

function drawBlackMarketShellsSprite(t: Uint32Array, seed: number): void {
  const hull: [number, number, number] = [30, 42, 48];
  const hullLight: [number, number, number] = [72, 86, 92];
  const brass: [number, number, number] = [166, 118, 48];
  const brassLight: [number, number, number] = [224, 166, 66];
  const redSeal: [number, number, number] = [176, 42, 36];
  const warning: [number, number, number] = [214, 154, 44];
  const rust: [number, number, number] = [114, 58, 34];
  const ink: [number, number, number] = [14, 16, 16];

  rect(t, 15, 42, 49, 50, [34, 30, 26], seed + 161, 215);
  rect(t, 17, 39, 47, 45, [62, 48, 32], seed + 162, 205);

  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 7 + (i === 3 ? 1 : 0);
    const top = 18 + (i & 1) * 2;
    const bottom = 43 + ((i + 1) & 1) * 2;
    rect(t, x - 1, top + 6, x + 5, bottom, ink, seed + 170 + i, 230);
    rect(t, x, top + 6, x + 4, bottom - 2, hull, seed + 180 + i, 252);
    rect(t, x + 1, top + 8, x + 2, bottom - 6, hullLight, seed + 190 + i, 150);
    rect(t, x, bottom - 8, x + 4, bottom - 4, brass, seed + 200 + i, 245);
    ellipse(t, x + 2, bottom - 3, 3.2, 2.2, brassLight, seed + 210 + i, 238);
    ellipse(t, x + 2, top + 5, 2.8, 4, [18, 22, 24], seed + 220 + i, 245);
    rect(t, x, top + 16, x + 4, top + 18, i === 1 ? warning : redSeal, seed + 230 + i, 238);
    line(t, x - 1, top + 11, x + 5, top + 9, 0.7, rust, seed + 240 + i, 160);
  }

  rect(t, 36, 21, 49, 26, redSeal, seed + 250, 230);
  rect(t, 38, 22, 47, 23, warning, seed + 251, 225);
  line(t, 36, 26, 49, 20, 0.8, ink, seed + 252, 190);
  line(t, 39, 30, 51, 28, 0.9, rust, seed + 253, 160);
  drawNoiseDust(t, seed + 254, rust, 16);
}

function drawNagantAmmoSprite(t: Uint32Array, seed: number): void {
  const brass: [number, number, number] = [154, 112, 48];
  const brassDark: [number, number, number] = [62, 42, 26];
  const brassLight: [number, number, number] = [222, 170, 76];
  const copper: [number, number, number] = [166, 82, 42];
  const red: [number, number, number] = [174, 44, 36];
  const green: [number, number, number] = [70, 130, 82];
  const packet: [number, number, number] = [54, 48, 38];
  const rust: [number, number, number] = [112, 58, 32];

  rect(t, 16, 39, 49, 50, packet, seed + 240, 220);
  rect(t, 19, 36, 47, 42, [82, 66, 40], seed + 241, 150);
  line(t, 17, 42, 48, 38, 1, brassDark, seed + 242, 155);

  const xs = [18, 24, 30, 36, 42];
  const heights = [22, 26, 29, 25, 21];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const h = heights[i];
    const top = 43 - h;
    const bottom = 47 - (i & 1);
    const cx = x + 2;
    const band = i === 1 ? red : i === 3 ? green : copper;

    rect(t, x - 1, top + 4, x + 4, bottom, brassDark, seed + 250 + i, 230);
    ellipse(t, cx, top + 3, 2.5, 4, copper, seed + 260 + i, 245);
    rect(t, x, top + 6, x + 3, bottom - 3, brass, seed + 270 + i, 248);
    line(t, x + 1, top + 7, x + 1, bottom - 4, 0.7, brassLight, seed + 280 + i, 145);
    rect(t, x, bottom - 13, x + 3, bottom - 10, band, seed + 290 + i, 235);
    rect(t, x - 1, bottom - 4, x + 4, bottom, brassDark, seed + 300 + i, 245);
    ellipse(t, cx, bottom, 2.2, 1.1, brassLight, seed + 310 + i, 170);
  }

  rect(t, 22, 45, 28, 46, red, seed + 320, 180);
  rect(t, 34, 44, 41, 45, green, seed + 321, 170);
  for (let i = 0; i < 11; i++) {
    const x = 17 + Math.floor(noise(i, 40, seed) * 31);
    const y = 23 + Math.floor(noise(i, 41, seed) * 25);
    ellipse(t, x, y, 1, 1, rust, seed + 330 + i, 120);
  }
}

function drawHarpoonAmmoSprite(t: Uint32Array, seed: number): void {
  const shaft: [number, number, number] = [52, 62, 58];
  const shaftLight: [number, number, number] = [114, 126, 112];
  const brass: [number, number, number] = [176, 126, 52];
  const brassLight: [number, number, number] = [226, 174, 76];
  const tip: [number, number, number] = [196, 202, 176];
  const rust: [number, number, number] = [118, 62, 34];
  const wetGreen: [number, number, number] = [62, 138, 98];
  const redCode: [number, number, number] = [190, 52, 42];
  const xs = [18, 27, 36, 45];

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y0 = 17 + (i & 1) * 3;
    const y1 = 50 - ((i + 1) & 1) * 2;
    line(t, x + 1, y0, x + 1, y1, 2.4, [24, 28, 26], seed + 320 + i, 235);
    rect(t, x, y0 + 8, x + 4, y1 - 3, shaft, seed + 330 + i, 248);
    rect(t, x + 1, y0 + 9, x + 1, y1 - 5, shaftLight, seed + 340 + i, 115);

    rect(t, x - 1, y1 - 7, x + 5, y1 - 2, brass, seed + 350 + i, 250);
    rect(t, x, y1 - 7, x + 4, y1 - 6, brassLight, seed + 360 + i, 190);
    const band = (i & 1) === 0 ? wetGreen : redCode;
    rect(t, x - 1, y0 + 18, x + 5, y0 + 21, band, seed + 370 + i, 235);

    line(t, x + 2, y0 - 5, x + 2, y0 + 8, 1.5, tip, seed + 380 + i, 250);
    line(t, x - 1, y0 + 4, x + 2, y0 + 8, 0.9, tip, seed + 390 + i, 225);
    line(t, x + 5, y0 + 4, x + 2, y0 + 8, 0.9, tip, seed + 400 + i, 225);
    px(t, x + 2, y0 - 6, rgba(tip[0], tip[1], tip[2], 230));
  }

  line(t, 16, 47, 48, 51, 1.2, wetGreen, seed + 410, 105);
  drawNoiseDust(t, seed + 411, rust, 13);
}

function drawAmmoNailsSprite(t: Uint32Array, seed: number, p: Palette): void {
  const steel: [number, number, number] = [132, 136, 128];
  const steelLight: [number, number, number] = [198, 198, 176];
  const rust: [number, number, number] = [116, 58, 32];
  const paper: [number, number, number] = [96, 76, 54];
  const warning: [number, number, number] = [196, 68, 42];

  ellipse(t, 32, 51, 16, 4, [12, 12, 10], seed + 91, 72);
  rect(t, 18, 31, 46, 43, paper, seed + 92, 215);
  rect(t, 20, 34, 44, 38, warning, seed + 93, 225);
  line(t, 19, 31, 46, 43, 1.2, p.dark, seed + 94, 150);
  line(t, 20, 43, 45, 31, 1, p.light, seed + 95, 115);

  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 6;
    const lean = (i - 2) * 0.9;
    line(t, x + lean, 16 + (i & 1), x - 1 + lean, 50 - (i & 1), 1.2, p.dark, seed + 96 + i, 235);
    line(t, x + lean + 1, 17 + (i & 1), x + lean, 48 - (i & 1), 0.8, steel, seed + 101 + i, 250);
    line(t, x + lean + 2, 18 + (i & 1), x + lean + 1, 37, 0.45, steelLight, seed + 106 + i, 190);
    ellipse(t, x + lean + 1, 15 + (i & 1), 3.3, 1.8, steelLight, seed + 111 + i, 235);
    px(t, Math.round(x - 1 + lean), 51 - (i & 1), rgba(56, 52, 42, 240));
    px(t, Math.round(x + lean), 52 - (i & 1), rgba(56, 52, 42, 210));
  }

  rect(t, 22, 35, 25, 37, p.accent, seed + 116, 225);
  rect(t, 36, 35, 39, 37, p.accent, seed + 117, 210);
  for (let i = 0; i < 10; i++) {
    const x = 20 + Math.floor(noise(i, 37, seed) * 25);
    const y = 21 + Math.floor(noise(i, 38, seed) * 25);
    if (noise(x, y, seed + 118) > 0.45) px(t, x, y, rgba(rust[0], rust[1], rust[2], 150));
  }
}

function drawAmmoShellsSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [32, 24, 22];
  const tray: [number, number, number] = [78, 56, 38];
  const hullA: [number, number, number] = [124, 42, 34];
  const hullB: [number, number, number] = [78, 44, 34];
  const brass: [number, number, number] = [178, 122, 50];
  const brassLight: [number, number, number] = [228, 174, 78];
  const greenBand: [number, number, number] = [68, 142, 84];
  const orangeBand: [number, number, number] = [212, 104, 42];
  const stain: [number, number, number] = [58, 70, 52];

  ellipse(t, 32, 51, 18, 4, [18, 16, 14], seed + 82, 90);
  rect(t, 17, 43, 49, 49, tray, seed + 83, 225);
  rect(t, 19, 46, 47, 50, dark, seed + 84, 180);

  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 8;
    const y0 = 16 + (i & 1) * 3;
    const y1 = 45 + ((i + 1) & 1) * 2;
    const hull = (i & 1) === 0 ? hullA : hullB;
    rect(t, x, y0 + 3, x + 5, y1 - 5, hull, seed + 85 + i);
    outlineRect(t, x, y0 + 3, x + 5, y1 - 5, dark);
    ellipse(t, x + 2.5, y0 + 3, 3.1, 2.2, hull, seed + 89 + i, 245);
    rect(t, x, y1 - 7, x + 5, y1, brass, seed + 93 + i);
    ellipse(t, x + 2.5, y1 - 7, 3, 1.7, brassLight, seed + 97 + i, 235);
    rect(t, x + 1, y0 + 8, x + 4, y0 + 10, i === 1 ? greenBand : orangeBand, seed + 101 + i, 232);
    line(t, x + 1, y0 + 5, x + 1, y1 - 8, 0.7, brassLight, seed + 105 + i, 85);
  }

  for (let i = 0; i < 7; i++) {
    const x = 43 + Math.floor(noise(i, 7, seed) * 8);
    const y = 36 + Math.floor(noise(i, 8, seed) * 9);
    ellipse(t, x, y, 1.2, 1.2, brassLight, seed + 110 + i, 155);
  }
  drawNoiseDust(t, seed + 118, stain, 12);
}

function drawIncendiaryShellSprite(t: Uint32Array, seed: number, p: Palette): void {
  ellipse(t, 34, 31, 22, 15, [78, 138, 82], seed + 124, 42);
  ellipse(t, 39, 27, 8, 12, [230, 72, 34], seed + 125, 78);
  const body: [number, number, number] = [80, 42, 34];
  const brass: [number, number, number] = [184, 132, 52];
  const fire: [number, number, number] = [224, 72, 32];
  const slime: [number, number, number] = [82, 178, 92];
  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 8;
    const top = 18 + ((seed >>> (i + 1)) & 3) + (i & 1) * 2;
    const bottom = 48 - (i & 1) * 2;
    rect(t, x - 1, top + 1, x + 5, bottom + 1, p.dark, seed + 126 + i, 230);
    rect(t, x, top + 5, x + 4, bottom - 5, body, seed + 130 + i);
    rect(t, x, top, x + 4, top + 5, p.light, seed + 134 + i);
    rect(t, x, bottom - 5, x + 4, bottom, brass, seed + 138 + i);
    rect(t, x + 1, top + 9, x + 4, top + 12, fire, seed + 142 + i, 245);
    rect(t, x + 1, top + 15, x + 3, top + 16, slime, seed + 146 + i, 205);
    line(t, x + 4, top + 7, x + 4, bottom - 6, 0.7, p.dark, seed + 150 + i, 150);
  }
  line(t, 17, 35, 48, 27, 1.1, slime, seed + 155, 155);
  line(t, 38, 18, 43, 9, 1.1, fire, seed + 156, 190);
  rect(t, 29, 43, 38, 45, [92, 58, 38], seed + 157, 145);
  drawNoiseDust(t, seed + 158, p.dark, 12);
}

function drawFuelCanisterSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [78, 86, 66];
  const metalDark: [number, number, number] = [26, 30, 24];
  const metalLight: [number, number, number] = [142, 144, 96];
  const warning: [number, number, number] = [190, 56, 36];
  const fuel: [number, number, number] = [228, 126, 42];
  const rust: [number, number, number] = [126, 66, 34];
  const oil: [number, number, number] = [36, 34, 26];

  rect(t, 25, 14, 42, 22, metalDark, seed + 430, 245);
  rect(t, 27, 15, 40, 20, metal, seed + 431, 235);
  clearRect(t, 30, 17, 38, 20);
  rect(t, 40, 18, 47, 23, metalLight, seed + 432, 230);
  rect(t, 42, 20, 48, 24, warning, seed + 433, 205);

  rect(t, 19, 26, 47, 51, metalDark, seed + 434, 245);
  rect(t, 21, 24, 45, 51, metal, seed + 435, 250);
  clearRect(t, 19, 24, 21, 26);
  clearRect(t, 44, 24, 47, 26);
  line(t, 21, 26, 26, 22, 1.5, metalLight, seed + 436, 220);
  line(t, 45, 26, 40, 22, 1.5, metalDark, seed + 437, 230);
  line(t, 24, 31, 42, 47, 1.3, metalDark, seed + 438, 150);
  line(t, 42, 31, 24, 47, 1.1, metalLight, seed + 439, 95);
  line(t, 32, 26, 32, 50, 0.8, metalDark, seed + 440, 80);

  rect(t, 25, 35, 41, 40, warning, seed + 441, 230);
  rect(t, 27, 37, 38, 38, fuel, seed + 442, 220);
  ellipse(t, 44, 28, 3.5, 5.5, fuel, seed + 443, 118);
  ellipse(t, 25, 49, 5, 3, oil, seed + 444, 120);
  drawNoiseDust(t, seed + 445, rust, 14);
}

function drawNapalmMixSprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [56, 66, 60];
  const steelLight: [number, number, number] = [128, 142, 126];
  const dark: [number, number, number] = [18, 22, 20];
  const fuel: [number, number, number] = [230, 96, 34];
  const fuelLight: [number, number, number] = [244, 160, 48];
  const red: [number, number, number] = [184, 42, 36];
  const yellow: [number, number, number] = [224, 162, 44];
  const rust: [number, number, number] = [126, 62, 36];

  ellipse(t, 33, 53, 15, 4, [10, 10, 8], seed + 446, 82);
  rect(t, 20, 18, 45, 48, steel, seed + 447, 246);
  ellipse(t, 32.5, 18, 12.5, 4.5, steelLight, seed + 448, 225);
  ellipse(t, 32.5, 48, 12.5, 4.0, dark, seed + 449, 135);
  outlineRect(t, 20, 18, 45, 48, dark);
  clearRect(t, 20, 18, 23, 22);
  clearRect(t, 42, 18, 45, 22);
  rect(t, 27, 10, 38, 17, dark, seed + 450, 242);
  rect(t, 29, 8, 36, 12, steelLight, seed + 451, 232);

  rect(t, 23, 29, 42, 44, fuel, seed + 452, 225);
  ellipse(t, 32, 29, 9.5, 4.0, fuelLight, seed + 453, 190);
  rect(t, 22, 23, 43, 28, red, seed + 454, 230);
  rect(t, 25, 24, 40, 25, yellow, seed + 455, 210);
  for (let i = 0; i < 3; i++) {
    const x = 28 + i * 4;
    line(t, x, 36, x + 3, 30, 0.9, yellow, seed + 456 + i, 170);
    ellipse(t, x + 2, 38, 1.4, 2.4, fuelLight, seed + 459 + i, 145);
  }
  line(t, 22, 47, 44, 28, 0.9, rust, seed + 462, 138);
  rect(t, 41, 35, 50, 39, fuel, seed + 463, 142);
  ellipse(t, 48, 40, 4.8, 2.4, fuelLight, seed + 464, 116);
  drawNoiseDust(t, seed + 465, rust, 12);
  drawNoiseDust(t, seed + 466, fuelLight, 7);
}

function drawRifleBoltPackSprite(t: Uint32Array, seed: number): void {
  const sleeve: [number, number, number] = [54, 62, 64];
  const sleeveLight: [number, number, number] = [112, 132, 130];
  const polymer: [number, number, number] = [78, 166, 178];
  const tip: [number, number, number] = [206, 214, 184];
  const brass: [number, number, number] = [186, 132, 52];
  const red: [number, number, number] = [184, 48, 40];
  const orange: [number, number, number] = [220, 132, 44];
  const grime: [number, number, number] = [32, 38, 36];

  rect(t, 15, 41, 50, 50, grime, seed + 560, 220);
  rect(t, 18, 38, 48, 45, sleeve, seed + 561, 228);
  rect(t, 21, 40, 46, 42, sleeveLight, seed + 562, 150);
  for (let i = 0; i < 5; i++) {
    const x = 18 + i * 7;
    const top = 13 + (i & 1) * 3;
    const bottom = 47 - ((i + 1) & 1) * 2;
    line(t, x + 2, top + 7, x + 2, bottom - 4, 2.5, [24, 30, 30], seed + 563 + i, 230);
    rect(t, x, top + 10, x + 4, bottom - 5, polymer, seed + 570 + i, 248);
    rect(t, x + 1, top + 11, x + 1, bottom - 7, [150, 214, 208], seed + 578 + i, 128);
    line(t, x + 2, top - 2, x + 2, top + 10, 1.2, tip, seed + 586 + i, 245);
    line(t, x, top + 5, x + 2, top + 10, 0.8, tip, seed + 594 + i, 220);
    line(t, x + 4, top + 5, x + 2, top + 10, 0.8, tip, seed + 602 + i, 220);
    rect(t, x - 1, bottom - 8, x + 5, bottom - 3, brass, seed + 610 + i, 245);
    rect(t, x, top + 22, x + 4, top + 24, i === 2 ? orange : red, seed + 618 + i, 232);
  }
  rect(t, 38, 22, 49, 25, orange, seed + 626, 205);
  line(t, 17, 47, 47, 41, 0.9, polymer, seed + 627, 130);
  drawNoiseDust(t, seed + 628, brass, 9);
}





function drawEnergyAmmoSprite(t: Uint32Array, seed: number, p: Palette): void {
  const graphite: [number, number, number] = [34, 42, 38];
  const graphiteLight: [number, number, number] = [74, 86, 76];
  const brass: [number, number, number] = [186, 142, 58];
  const brassLight: [number, number, number] = [230, 184, 82];
  const charge: [number, number, number] = [68, 186, 132];
  const chargeLight: [number, number, number] = [108, 226, 166];
  const sealRed: [number, number, number] = [188, 52, 42];

  rect(t, 28, 13, 39, 18, brassLight, seed + 70);
  rect(t, 25, 18, 42, 47, graphite, seed + 71);
  ellipse(t, 33.5, 18, 9, 4, graphiteLight, seed + 72);
  ellipse(t, 33.5, 47, 9, 4, brass, seed + 73);
  outlineRect(t, 25, 18, 42, 47, p.dark);
  rect(t, 30, 22, 37, 41, charge, seed + 74, 235);
  rect(t, 31, 24, 35, 38, chargeLight, seed + 75, 210);
  line(t, 39, 22, 43, 26, 1.1, brass, seed + 76, 210);
  line(t, 39, 39, 44, 43, 1.1, brass, seed + 77, 210);
  rect(t, 24, 29, 43, 33, sealRed, seed + 78, 218);
  rect(t, 27, 35, 40, 37, brass, seed + 79, 180);
  drawNoiseDust(t, seed + 80, [126, 78, 42], 12);
  px(t, 27, 20, rgba(224, 206, 120, 150));
  px(t, 37, 15, rgba(120, 236, 174, 140));
}

function draw762AmmoSprite(t: Uint32Array, seed: number): void {
  const brass: [number, number, number] = [170, 126, 54];
  const brassLight: [number, number, number] = [232, 182, 78];
  const darkCase: [number, number, number] = [64, 52, 34];
  const copper: [number, number, number] = [136, 62, 42];
  const codeRed: [number, number, number] = [178, 54, 46];
  const codeGreen: [number, number, number] = [70, 128, 76];
  const codeOrange: [number, number, number] = [210, 124, 44];
  rect(t, 18, 23, 47, 50, [18, 16, 14], seed + 68, 72);
  rect(t, 21, 43, 45, 45, codeOrange, 0, 210);
  for (let i = 0; i < 4; i++) {
    const x = 19 + i * 7;
    const y = 14 + (i & 1) * 2;
    const bottom = 49 - (i & 1) * 2;
    line(t, x + 3, y + 9, x + 3, bottom - 3, 3.1, darkCase, seed + 69 + i, 235);
    ellipse(t, x + 3, y + 8, 2.8, 5.6, copper, seed + 73 + i);
    rect(t, x + 1, y + 13, x + 5, bottom - 4, brass, seed + 77 + i);
    rect(t, x + 2, y + 13, x + 2, bottom - 5, brassLight, seed + 81 + i, 230);
    rect(t, x + 1, bottom - 4, x + 5, bottom - 1, darkCase, seed + 85 + i);
    rect(t, x + 1, y + 27, x + 5, y + 29, (i & 1) === 0 ? codeRed : codeGreen);
  }
  rect(t, 22, 18, 27, 19, darkCase, 0, 190);
  rect(t, 38, 20, 44, 21, darkCase, 0, 170);
  drawNoiseDust(t, seed + 90, [82, 54, 36], 10);
}

function draw9mmAmmoSprite(t: Uint32Array, seed: number, p: Palette): void {
  rect(t, 17, 42, 49, 48, [58, 42, 30], seed + 56, 230);
  rect(t, 19, 40, 47, 45, [92, 70, 42], seed + 57, 225);
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 6;
    const y0 = 18 + (i & 1);
    const y1 = 42 + ((i + 1) & 1);
    rect(t, x, y0 + 3, x + 3, y1, [154, 104, 54], seed + 58 + i);
    rect(t, x, y0, x + 3, y0 + 4, [220, 172, 82], seed + 63 + i);
    rect(t, x + 1, y0 + 5, x + 2, y1 - 5, [112, 78, 44], seed + 68 + i, 160);
    rect(t, x, y1 - 2, x + 3, y1, [48, 36, 28], seed + 73 + i, 230);
  }
  rect(t, 18, 46, 47, 48, p.dark, seed + 78, 190);
  rect(t, 23, 25, 40, 27, [176, 48, 42], seed + 79, 210);
  rect(t, 27, 30, 36, 31, [70, 126, 82], seed + 80, 160);
  drawNoiseDust(t, seed + 81, [86, 66, 44], 10);
}

function draw762ttAmmoSprite(t: Uint32Array, seed: number): void {
  rect(t, 17, 37, 48, 50, [50, 40, 32], seed + 62, 215);
  rect(t, 20, 40, 45, 44, [118, 48, 38], seed + 63, 230);
  rect(t, 21, 46, 43, 47, [64, 88, 58], seed + 64, 205);
  for (let i = 0; i < 4; i++) {
    const x = 21 + i * 6;
    const top = 21 + (i & 1) * 2;
    const bottom = 46 + ((i + 1) & 1);
    rect(t, x, top + 7, x + 3, bottom, [168, 122, 54], seed + 65 + i);
    rect(t, x + 1, top + 8, x + 1, bottom - 2, [226, 176, 82], seed + 69 + i, 210);
    ellipse(t, x + 1.5, top + 6, 2.1, 3.6, [48, 48, 42], seed + 73 + i);
    rect(t, x, top + 18, x + 3, top + 20, [154, 44, 38], seed + 77 + i, 235);
    rect(t, x, bottom - 2, x + 3, bottom, [76, 54, 32], seed + 81 + i);
  }
  line(t, 19, 28, 45, 25, 0.8, [36, 30, 26], seed + 86, 140);
}

function drawSlugSprite(t: Uint32Array, seed: number, p: Palette): void {
  const hull: [number, number, number] = [54, 46, 40];
  const brass: [number, number, number] = [174, 128, 58];
  const brassLight: [number, number, number] = [224, 174, 82];
  const band: [number, number, number] = [188, 58, 42];
  rect(t, 23, 20, 41, 49, hull, seed + 63);
  outlineRect(t, 23, 20, 41, 49, p.dark);
  ellipse(t, 32, 20, 9, 5, brassLight, seed + 64);
  rect(t, 24, 18, 40, 23, brass, seed + 65);
  ellipse(t, 32, 18, 7, 4, brassLight, seed + 66);
  rect(t, 25, 35, 39, 40, band, seed + 67, 245);
  rect(t, 27, 42, 37, 47, brass, seed + 68);
  line(t, 25, 24, 39, 24, 0.9, p.light, seed + 69, 130);
  line(t, 28, 28, 28, 46, 0.8, p.light, seed + 71, 95);
  for (let i = 0; i < 5; i++) {
    const x = 27 + i * 2;
    rect(t, x, 37, x, 38, p.light, 0, 145);
  }
  drawNoiseDust(t, seed + 72, [118, 78, 48], 9);
}

function drawAmmoBeltSprite(t: Uint32Array, seed: number, p: Palette): void {
  line(t, 15, 30, 49, 35, 2.2, [34, 32, 28], seed + 73, 230);
  line(t, 15, 37, 49, 42, 1.4, p.dark, seed + 74, 210);
  for (let i = 0; i < 5; i++) {
    const x = 17 + i * 7;
    const y = 18 + (i & 1) * 2;
    rect(t, x, y + 8, x + 4, y + 32, p.body, seed + 75 + i);
    ellipse(t, x + 2, y + 7, 2.7, 4.2, p.light, seed + 85 + i);
    rect(t, x, y + 15, x + 4, y + 18, p.accent, seed + 95 + i, 230);
    rect(t, x - 1, y + 23, x + 5, y + 27, p.dark, seed + 105 + i, 215);
    rect(t, x + 1, y + 30, x + 3, y + 33, [70, 48, 32], seed + 115 + i);
  }
  drawNoiseDust(t, seed + 125, [88, 58, 34], 12);
}

function drawAmmoSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'rifle_bolt_pack') {
    drawRifleBoltPackSprite(t, seed);
    return;
  }
  if (defId === 'ammo_nails') {
    drawAmmoNailsSprite(t, seed, p);
    return;
  }
  if (defId === 'napalm_mix') {
    drawNapalmMixSprite(t, seed);
    return;
  }
  if (defId === 'ammo_fuel') {
    drawFuelCanisterSprite(t, seed);
    return;
  }
  if (defId === 'ammo_issue_order' || defId.includes('coupon')) {
    drawAmmoIssueOrderSprite(t, seed, defId);
    return;
  }
  if (defId === 'black_market_shells') {
    drawBlackMarketShellsSprite(t, seed);
    return;
  }
  if (defId === 'ammo_shells') {
    drawAmmoShellsSprite(t, seed);
    return;
  }
  if (defId === 'ammo_nagant') {
    drawNagantAmmoSprite(t, seed);
    return;
  }
  if (defId === 'ammo_harpoon') {
    drawHarpoonAmmoSprite(t, seed);
    return;
  }
  if (defId === 'ammo_12g_incendiary') {
    drawIncendiaryShellSprite(t, seed, p);
    return;
  }
  if (defId === 'homemade_9mm') {
    drawHomemade9mmSprite(t, seed);
    return;
  }
  if (defId === 'homemade_ammo_instruction') {
    drawHomemadeAmmoInstructionSprite(t, seed);
    return;
  }
  if (defId.includes('chemical') || defId.includes('decon') || defId.includes('reagent')) {
    drawChemicalShellSprite(t, seed, p);
    return;
  }
  if (defId === 'ammo_energy') {
    drawEnergyAmmoSprite(t, seed, p);
    return;
  }

  if (defId === 'ammo_762') {
    draw762AmmoSprite(t, seed);
    return;
  }

  if (defId === 'ammo_9mm') {
    draw9mmAmmoSprite(t, seed, p);
    return;
  }
  if (defId === 'ammo_762tt') {
    draw762ttAmmoSprite(t, seed);
    return;
  }
  if (defId.includes('slug')) {
    drawSlugSprite(t, seed, p);
    return;
  }
  if (defId === 'ammo_belt') {
    drawAmmoBeltSprite(t, seed, p);
    return;
  }
  const shells = defId.includes('shell') || defId.includes('12g');
  for (let i = 0; i < (shells ? 4 : 5); i++) {
    const x = 20 + i * (shells ? 7 : 5);
    const h = shells ? 18 : 24;
    rect(t, x, 42 - h + (i & 1) * 3, x + (shells ? 4 : 3), 42 + (i & 1) * 3, shells ? p.accent : p.body, seed + 70 + i);
    rect(t, x, 42 - h + (i & 1) * 3, x + (shells ? 4 : 3), 45 - h + (i & 1) * 3, p.light, seed + 80 + i);
  }
  if (defId.includes('fuel') || defId.includes('napalm')) ellipse(t, 41, 31, 6, 8, [210, 64, 40], seed + 91, 210);
}

function drawChalkSprite(t: Uint32Array, seed: number): void {
  const dust: [number, number, number] = [220, 216, 188];
  const dustDark: [number, number, number] = [92, 96, 86];
  const yellow: [number, number, number] = [218, 184, 82];
  const cyan: [number, number, number] = [82, 174, 166];
  const red: [number, number, number] = [176, 64, 58];
  const grime: [number, number, number] = [46, 54, 48];

  ellipse(t, 31, 51, 17, 4, grime, seed + 655, 86);
  line(t, 14, 45, 39, 29, 5.0, dustDark, seed + 656, 230);
  line(t, 16, 44, 40, 29, 3.1, dust, seed + 657, 248);
  line(t, 23, 51, 50, 35, 4.2, [34, 78, 78], seed + 658, 224);
  line(t, 25, 50, 50, 36, 2.5, cyan, seed + 659, 242);
  line(t, 13, 33, 34, 21, 4.0, [118, 92, 44], seed + 660, 220);
  line(t, 15, 32, 35, 21, 2.4, yellow, seed + 661, 238);
  rect(t, 37, 31, 43, 35, red, seed + 662, 210);
  rect(t, 39, 32, 42, 33, dust, seed + 663, 185);
  for (let i = 0; i < 18; i++) {
    const x = 16 + Math.floor(noise(i, 54, seed) * 34);
    const y = 27 + Math.floor(noise(i, 55, seed) * 23);
    const c = i % 3 === 0 ? cyan : i % 3 === 1 ? yellow : dust;
    ellipse(t, x, y, 1.0, 1.0, c, seed + 664 + i, 110);
  }
  line(t, 20, 39, 41, 43, 0.8, dust, seed + 682, 125);
}

function drawCleaningKitSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [26, 32, 32];
  const metal: [number, number, number] = [86, 100, 98];
  const metalLight: [number, number, number] = [162, 172, 158];
  const cyan: [number, number, number] = [70, 178, 188];
  const yellow: [number, number, number] = [214, 164, 50];
  const red: [number, number, number] = [174, 46, 40];
  const grime: [number, number, number] = [54, 68, 58];
  const rust: [number, number, number] = [128, 70, 38];

  ellipse(t, 32, 53, 19, 4, [12, 14, 12], seed + 683, 78);
  rect(t, 17, 31, 48, 48, metal, seed + 684, 248);
  outlineRect(t, 17, 31, 48, 48, rubber);
  rect(t, 21, 26, 43, 33, rubber, seed + 685, 246);
  rect(t, 24, 24, 40, 28, metalLight, seed + 686, 224);
  line(t, 22, 26, 41, 26, 0.9, cyan, seed + 687, 210);
  rect(t, 20, 36, 32, 43, yellow, seed + 688, 232);
  rect(t, 23, 38, 30, 39, grime, seed + 689, 120);

  rect(t, 36, 18, 44, 43, cyan, seed + 690, 222);
  rect(t, 37, 15, 43, 20, metalLight, seed + 691, 232);
  rect(t, 38, 12, 42, 15, red, seed + 692, 235);
  rect(t, 37, 30, 43, 36, metalLight, seed + 693, 200);
  rect(t, 38, 32, 42, 33, rubber, seed + 694, 135);

  line(t, 13, 49, 35, 27, 3.4, rubber, seed + 695, 240);
  line(t, 15, 48, 34, 29, 1.8, metalLight, seed + 696, 220);
  ellipse(t, 13, 49, 4, 3, yellow, seed + 697, 225);
  line(t, 18, 45, 46, 33, 0.9, rust, seed + 698, 140);
  ellipse(t, 46, 46, 6, 3.5, grime, seed + 699, 120);
  drawNoiseDust(t, seed + 700, rust, 10);
  drawNoiseDust(t, seed + 701, cyan, 8);
}

function drawDoorKitSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [24, 30, 30];
  const metal: [number, number, number] = [82, 92, 88];
  const metalLight: [number, number, number] = [154, 164, 152];
  const yellow: [number, number, number] = [214, 158, 46];
  const cyan: [number, number, number] = [70, 176, 184];
  const red: [number, number, number] = [166, 44, 38];
  const rust: [number, number, number] = [130, 68, 36];
  const damp: [number, number, number] = [56, 70, 64];

  ellipse(t, 33, 53, 19, 4, [14, 16, 14], seed + 702, 84);
  rect(t, 20, 15, 46, 48, metal, seed + 703, 248);
  rect(t, 23, 18, 43, 44, metalLight, seed + 704, 186);
  outlineRect(t, 20, 15, 46, 48, rubber);
  line(t, 32, 16, 32, 47, 1.0, rubber, seed + 705, 145);
  rect(t, 23, 20, 29, 44, [62, 70, 68], seed + 706, 180);
  rect(t, 37, 21, 42, 25, yellow, seed + 707, 230);
  rect(t, 37, 36, 42, 40, yellow, seed + 708, 210);
  ellipse(t, 36, 32, 3.4, 3.0, red, seed + 709, 230);
  line(t, 18, 48, 31, 39, 4.0, rubber, seed + 710, 240);
  line(t, 20, 47, 32, 40, 2.0, metalLight, seed + 711, 210);
  line(t, 46, 23, 55, 17, 1.3, cyan, seed + 712, 215);
  line(t, 51, 18, 56, 22, 1.0, yellow, seed + 713, 205);
  rect(t, 24, 28, 43, 31, cyan, seed + 714, 190);
  for (let x = 25; x <= 40; x += 5) line(t, x, 28, x + 3, 31, 0.8, rubber, seed + 715 + x, 185);
  rect(t, 18, 41, 25, 47, damp, seed + 716, 130);
  rect(t, 41, 15, 48, 19, rust, seed + 717, 150);
  clearRect(t, 20, 15, 23, 18);
  clearRect(t, 44, 16, 46, 21);
  drawNoiseDust(t, seed + 718, rust, 12);
  drawNoiseDust(t, seed + 719, cyan, 7);
}

function drawFeltDoorPadSprite(t: Uint32Array, seed: number): void {
  const felt: [number, number, number] = [108, 112, 102];
  const feltLight: [number, number, number] = [170, 170, 148];
  const feltDark: [number, number, number] = [46, 52, 48];
  const adhesive: [number, number, number] = [218, 188, 92];
  const paper: [number, number, number] = [202, 190, 132];
  const cyan: [number, number, number] = [72, 174, 184];
  const rust: [number, number, number] = [126, 68, 40];
  const stain: [number, number, number] = [58, 78, 66];

  ellipse(t, 32, 52, 17, 4, [16, 18, 16], seed + 720, 76);
  rect(t, 18, 26, 49, 39, feltDark, seed + 721, 226);
  rect(t, 16, 23, 47, 36, felt, seed + 722, 246);
  clearRect(t, 16, 23, 19, 26);
  clearRect(t, 45, 23, 47, 28);
  outlineRect(t, 16, 23, 47, 36, feltDark);
  line(t, 18, 26, 45, 26, 0.8, feltLight, seed + 723, 150);
  line(t, 18, 34, 45, 32, 0.9, feltDark, seed + 724, 135);
  for (let x = 21; x <= 42; x += 5) line(t, x, 24, x + 3, 36, 0.7, feltLight, seed + 725 + x, 95);

  rect(t, 24, 39, 43, 47, adhesive, seed + 726, 225);
  rect(t, 26, 41, 40, 43, paper, seed + 727, 210);
  line(t, 24, 39, 43, 47, 0.8, feltDark, seed + 728, 120);
  line(t, 14, 42, 26, 35, 2.4, feltDark, seed + 729, 220);
  line(t, 15, 41, 27, 35, 1.3, feltLight, seed + 730, 195);
  rect(t, 40, 28, 50, 32, cyan, seed + 731, 185);
  rect(t, 43, 29, 49, 30, paper, seed + 732, 170);
  ellipse(t, 45, 47, 7, 3, stain, seed + 733, 116);
  drawNoiseDust(t, seed + 734, rust, 8);
  drawNoiseDust(t, seed + 735, feltLight, 10);
}

function drawFilterCanisterSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [78, 92, 88];
  const metalLight: [number, number, number] = [142, 158, 146];
  const metalDark: [number, number, number] = [24, 32, 32];
  const rubber: [number, number, number] = [18, 24, 24];
  const yellow: [number, number, number] = [214, 158, 48];
  const cyan: [number, number, number] = [74, 178, 184];
  const rust: [number, number, number] = [132, 68, 38];
  const smog: [number, number, number] = [54, 82, 72];

  ellipse(t, 33, 53, 18, 4, [10, 12, 12], seed + 736, 84);
  rect(t, 24, 12, 42, 20, metalDark, seed + 737, 248);
  rect(t, 27, 13, 39, 18, metal, seed + 738, 238);
  clearRect(t, 30, 15, 37, 18);
  line(t, 40, 17, 50, 23, 1.5, metalLight, seed + 739, 220);
  rect(t, 46, 21, 53, 25, yellow, seed + 740, 215);

  rect(t, 18, 25, 47, 51, metalDark, seed + 741, 245);
  rect(t, 20, 23, 45, 50, metal, seed + 742, 250);
  clearRect(t, 20, 23, 23, 26);
  clearRect(t, 43, 23, 45, 28);
  outlineRect(t, 20, 23, 45, 50, metalDark);
  line(t, 23, 27, 42, 46, 1.1, metalDark, seed + 743, 135);
  line(t, 42, 27, 24, 47, 1.0, metalLight, seed + 744, 95);

  rect(t, 24, 31, 42, 39, rubber, seed + 745, 230);
  for (let x = 26; x <= 39; x += 4) line(t, x, 32, x, 38, 0.8, cyan, seed + 746 + x, 185);
  rect(t, 25, 42, 41, 45, yellow, seed + 747, 220);
  rect(t, 28, 43, 38, 44, metalDark, seed + 748, 150);
  ellipse(t, 44, 30, 3.8, 6.2, cyan, seed + 749, 110);
  ellipse(t, 25, 49, 5.5, 3.0, smog, seed + 750, 130);
  rect(t, 39, 24, 47, 28, rust, seed + 751, 155);
  drawNoiseDust(t, seed + 752, rust, 12);
  drawNoiseDust(t, seed + 753, cyan, 8);
}

function drawGasmaskFilterSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [14, 20, 20];
  const metal: [number, number, number] = [74, 92, 82];
  const metalLight: [number, number, number] = [142, 160, 136];
  const charcoal: [number, number, number] = [30, 42, 38];
  const iodine: [number, number, number] = [218, 158, 44];
  const red: [number, number, number] = [174, 42, 38];
  const smog: [number, number, number] = [60, 90, 72];
  const rust: [number, number, number] = [128, 70, 38];

  ellipse(t, 32, 53, 18, 4, [8, 10, 9], seed + 754, 84);
  rect(t, 20, 19, 47, 48, rubber, seed + 755, 248);
  rect(t, 22, 17, 45, 46, metal, seed + 756, 250);
  ellipse(t, 33.5, 17, 12, 5, metalLight, seed + 757, 232);
  ellipse(t, 33.5, 46, 12, 4, rubber, seed + 758, 220);
  outlineRect(t, 22, 17, 45, 46, rubber);

  rect(t, 24, 24, 43, 39, charcoal, seed + 759, 232);
  for (let y = 27; y <= 36; y += 4) {
    for (let x = 27; x <= 40; x += 4) ellipse(t, x, y, 1.3, 1.3, rubber, seed + 760 + x + y, 245);
  }
  rect(t, 20, 22, 24, 45, metalLight, seed + 800, 210);
  rect(t, 43, 24, 47, 43, metal, seed + 801, 214);
  rect(t, 25, 41, 42, 45, iodine, seed + 790, 224);
  rect(t, 27, 42, 40, 43, charcoal, seed + 791, 142);
  rect(t, 38, 18, 46, 23, red, seed + 792, 205);
  line(t, 23, 20, 44, 45, 0.9, metalLight, seed + 793, 116);
  line(t, 44, 20, 23, 45, 0.8, rubber, seed + 794, 120);
  ellipse(t, 43, 35, 5.5, 7.5, smog, seed + 795, 118);
  ellipse(t, 25, 47, 7, 3, smog, seed + 796, 105);
  rect(t, 39, 22, 47, 26, rust, seed + 797, 150);
  drawNoiseDust(t, seed + 798, rust, 12);
  drawNoiseDust(t, seed + 799, smog, 10);
}

function drawFlashlightSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [14, 18, 18];
  const metal: [number, number, number] = [58, 72, 72];
  const metalLight: [number, number, number] = [154, 166, 150];
  const lens: [number, number, number] = [224, 196, 84];
  const glow: [number, number, number] = [248, 232, 136];
  const red: [number, number, number] = [172, 42, 36];
  const rust: [number, number, number] = [126, 64, 34];
  const damp: [number, number, number] = [42, 58, 54];

  ellipse(t, 33, 52, 18, 4, [8, 10, 10], seed + 800, 82);
  line(t, 15, 40, 42, 32, 7.0, rubber, seed + 801, 248);
  line(t, 17, 39, 40, 33, 4.4, metal, seed + 802, 250);
  line(t, 19, 37, 39, 32, 1.2, metalLight, seed + 803, 210);
  for (let x = 20; x <= 35; x += 5) line(t, x, 34, x + 2, 43, 0.8, rubber, seed + 804 + x, 170);
  rect(t, 20, 43, 31, 46, red, seed + 808, 188);

  line(t, 39, 32, 52, 28, 6.4, rubber, seed + 809, 250);
  line(t, 41, 31, 51, 28, 4.0, metalLight, seed + 810, 232);
  ellipse(t, 53, 28, 7.2, 5.2, rubber, seed + 811, 245);
  ellipse(t, 54, 28, 4.8, 3.4, lens, seed + 812, 238);
  ellipse(t, 56, 27, 2.7, 1.8, glow, seed + 813, 210);
  ellipse(t, 58, 27, 7.5, 4.0, glow, seed + 814, 72);
  line(t, 41, 33, 54, 28, 0.9, rust, seed + 815, 132);
  rect(t, 29, 31, 37, 34, damp, seed + 816, 160);
  drawNoiseDust(t, seed + 817, rust, 8);
}

function drawFogDetectorSprite(t: Uint32Array, seed: number): void {
  const caseDark: [number, number, number] = [14, 20, 22];
  const caseBody: [number, number, number] = [52, 68, 68];
  const caseLight: [number, number, number] = [118, 136, 126];
  const screen: [number, number, number] = [62, 184, 194];
  const screenLight: [number, number, number] = [148, 236, 222];
  const yellow: [number, number, number] = [218, 160, 44];
  const red: [number, number, number] = [182, 42, 36];
  const rust: [number, number, number] = [124, 64, 34];
  const smog: [number, number, number] = [62, 92, 82];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 818, 82);
  rect(t, 20, 19, 46, 50, caseDark, seed + 819, 248);
  rect(t, 22, 17, 44, 48, caseBody, seed + 820, 250);
  outlineRect(t, 20, 19, 46, 50, caseDark);
  clearRect(t, 20, 19, 23, 22);
  clearRect(t, 43, 18, 46, 24);
  rect(t, 25, 23, 41, 34, screen, seed + 821, 232);
  rect(t, 27, 25, 39, 27, screenLight, seed + 822, 205);
  line(t, 26, 32, 40, 27, 0.8, caseDark, seed + 823, 145);
  rect(t, 25, 38, 41, 42, yellow, seed + 824, 222);
  for (let x = 27; x <= 37; x += 5) line(t, x, 38, x + 3, 42, 0.8, caseDark, seed + 825 + x, 175);
  ellipse(t, 36, 45, 3.8, 3.4, red, seed + 830, 230);
  rect(t, 25, 43, 30, 47, caseLight, seed + 831, 215);

  line(t, 33, 18, 29, 8, 1.4, caseLight, seed + 832, 230);
  ellipse(t, 28, 7, 3.2, 2.2, screenLight, seed + 833, 190);
  line(t, 44, 24, 55, 17, 1.3, caseLight, seed + 834, 218);
  ellipse(t, 56, 17, 3.0, 2.0, screen, seed + 835, 180);
  ellipse(t, 47, 31, 7.5, 9.0, smog, seed + 836, 92);
  line(t, 22, 47, 45, 24, 0.9, rust, seed + 837, 132);
  drawNoiseDust(t, seed + 838, screenLight, 10);
  drawNoiseDust(t, seed + 839, rust, 8);
}

function drawUnpeopleDetectorSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [14, 20, 20];
  const caseBody: [number, number, number] = [58, 70, 68];
  const caseLight: [number, number, number] = [128, 142, 132];
  const screen: [number, number, number] = [66, 184, 188];
  const cyan: [number, number, number] = [128, 236, 224];
  const yellow: [number, number, number] = [216, 160, 46];
  const red: [number, number, number] = [180, 42, 36];
  const rubber: [number, number, number] = [20, 26, 26];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 3000, 84);
  rect(t, 18, 22, 46, 49, dark, seed + 3001, 248);
  rect(t, 20, 19, 44, 47, caseBody, seed + 3002, 250);
  outlineRect(t, 18, 22, 46, 49, dark);
  clearRect(t, 18, 22, 21, 25);
  clearRect(t, 43, 20, 46, 26);
  rect(t, 24, 24, 40, 34, screen, seed + 3003, 235);
  rect(t, 26, 26, 38, 27, cyan, seed + 3004, 215);
  rect(t, 26, 31, 33, 32, dark, 0, 150);
  rect(t, 25, 38, 41, 42, yellow, seed + 3005, 228);
  for (let x = 27; x <= 38; x += 5) line(t, x, 38, x + 3, 42, 0.8, dark, seed + 3006 + x, 175);
  ellipse(t, 37, 45, 3.4, 3.0, red, seed + 3010, 230);

  line(t, 24, 20, 17, 9, 1.4, caseLight, seed + 3011, 230);
  ellipse(t, 16, 8, 2.6, 1.8, cyan, seed + 3012, 185);
  line(t, 44, 27, 55, 19, 1.2, caseLight, seed + 3013, 220);
  ellipse(t, 56, 18, 2.8, 1.8, red, seed + 3014, 190);
  line(t, 14, 47, 28, 38, 2.5, rubber, seed + 3015, 235);
  line(t, 15, 46, 29, 38, 1.1, caseLight, seed + 3016, 205);
  line(t, 22, 47, 44, 24, 0.8, rust, seed + 3017, 125);
  drawNoiseDust(t, seed + 3018, rust, 9);
  drawNoiseDust(t, seed + 3019, cyan, 8);
}

function drawUvSpotlightSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 18, 22];
  const metal: [number, number, number] = [50, 64, 70];
  const metalLight: [number, number, number] = [124, 138, 132];
  const violet: [number, number, number] = [142, 74, 214];
  const uv: [number, number, number] = [102, 218, 236];
  const yellow: [number, number, number] = [220, 160, 48];
  const red: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 34, 53, 19, 4, [8, 10, 12], seed + 3020, 84);
  line(t, 18, 45, 29, 33, 4.2, dark, seed + 3021, 238);
  line(t, 20, 43, 30, 34, 2.0, metalLight, seed + 3022, 218);
  rect(t, 16, 43, 28, 51, dark, seed + 3023, 244);
  rect(t, 19, 44, 27, 47, yellow, seed + 3024, 215);
  rect(t, 21, 48, 27, 50, red, seed + 3025, 190);

  ellipse(t, 42, 29, 16, 13, dark, seed + 3026, 252);
  ellipse(t, 43, 29, 12, 9, metal, seed + 3027, 250);
  ellipse(t, 46, 28, 8, 6, violet, seed + 3028, 238);
  ellipse(t, 48, 27, 4, 3, uv, seed + 3029, 222);
  ellipse(t, 53, 27, 12, 6.2, uv, seed + 3030, 125);
  rect(t, 30, 34, 46, 39, red, seed + 3031, 205);
  rect(t, 32, 35, 43, 36, yellow, seed + 3032, 195);
  rect(t, 30, 17, 48, 21, yellow, seed + 3033, 195);
  rect(t, 33, 18, 45, 19, dark, seed + 3034, 120);
  line(t, 27, 34, 45, 38, 1.1, dark, seed + 3035, 175);
  line(t, 24, 45, 49, 25, 0.9, rust, seed + 3036, 135);
  drawNoiseDust(t, seed + 3037, uv, 11);
  drawNoiseDust(t, seed + 3038, rust, 9);
}

function drawVacuumSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [14, 20, 20];
  const body: [number, number, number] = [80, 94, 88];
  const bodyLight: [number, number, number] = [154, 164, 144];
  const bag: [number, number, number] = [122, 102, 72];
  const hose: [number, number, number] = [20, 26, 24];
  const yellow: [number, number, number] = [214, 158, 46];
  const red: [number, number, number] = [178, 42, 36];
  const cyan: [number, number, number] = [74, 190, 186];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 20, 4, [8, 10, 10], seed + 3040, 84);
  ellipse(t, 33, 35, 17, 13, dark, seed + 3041, 248);
  ellipse(t, 33, 34, 14, 10, body, seed + 3042, 250);
  rect(t, 22, 33, 45, 48, body, seed + 3043, 246);
  ellipse(t, 33, 48, 12, 4, dark, seed + 3044, 180);
  outlineRect(t, 22, 33, 45, 48, dark);
  rect(t, 25, 37, 42, 42, yellow, seed + 3045, 220);
  rect(t, 28, 38, 39, 39, hose, 0, 130);
  rect(t, 38, 30, 49, 38, bag, seed + 3046, 220);
  rect(t, 41, 32, 48, 34, red, seed + 3047, 195);
  ellipse(t, 24, 48, 4.5, 3.2, bodyLight, seed + 3048, 220);
  ellipse(t, 43, 48, 4.5, 3.2, bodyLight, seed + 3049, 220);

  arcLine(t, 25, 31, 16, 12, Math.PI * 0.95, Math.PI * 1.95, 2.4, hose, seed + 3050, 235, 16);
  line(t, 13, 35, 22, 41, 3.3, hose, seed + 3051, 235);
  line(t, 11, 36, 18, 42, 1.2, bodyLight, seed + 3052, 205);
  line(t, 17, 42, 8, 50, 3.5, hose, seed + 3053, 238);
  line(t, 9, 50, 17, 51, 1.2, cyan, seed + 3054, 190);
  ellipse(t, 47, 29, 8, 7, cyan, seed + 3055, 68);
  line(t, 22, 47, 46, 33, 0.8, rust, seed + 3056, 130);
  drawNoiseDust(t, seed + 3057, rust, 11);
  drawNoiseDust(t, seed + 3058, cyan, 10);
}

function drawVentDamperPlateSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 24, 24];
  const metal: [number, number, number] = [92, 104, 98];
  const metalLight: [number, number, number] = [170, 176, 154];
  const soot: [number, number, number] = [30, 34, 32];
  const violet: [number, number, number] = [132, 86, 204];
  const blue: [number, number, number] = [70, 166, 214];
  const yellow: [number, number, number] = [214, 156, 46];
  const rust: [number, number, number] = [130, 66, 38];

  ellipse(t, 33, 53, 18, 4, [8, 10, 10], seed + 3060, 84);
  rect(t, 17, 18, 49, 49, dark, seed + 3061, 246);
  rect(t, 19, 16, 47, 47, metal, seed + 3062, 250);
  outlineRect(t, 17, 18, 49, 49, dark);
  clearRect(t, 17, 18, 20, 21);
  clearRect(t, 47, 19, 49, 24);
  clearRect(t, 18, 46, 21, 49);
  for (let y = 23; y <= 40; y += 5) {
    line(t, 22, y + 2, 44, y - 2, 2.0, soot, seed + 3063 + y, 235);
    line(t, 23, y + 1, 43, y - 2, 0.9, metalLight, seed + 3070 + y, 185);
  }
  rect(t, 19, 17, 24, 46, metalLight, seed + 3074, 178);
  rect(t, 42, 17, 47, 46, metalLight, seed + 3075, 176);
  rect(t, 20, 17, 46, 20, metalLight, seed + 3076, 170);
  rect(t, 20, 44, 46, 47, metalLight, seed + 3077, 166);
  rect(t, 23, 18, 43, 22, metalLight, seed + 3078, 192);
  rect(t, 38, 41, 48, 46, rust, seed + 3079, 160);
  rect(t, 21, 42, 33, 45, yellow, seed + 3080, 170);
  rect(t, 23, 43, 31, 44, dark, seed + 3081, 125);
  ellipse(t, 32, 34, 16, 14, violet, seed + 3082, 54);
  ellipse(t, 35, 33, 11, 9, blue, seed + 3083, 44);
  rect(t, 19, 17, 24, 46, metalLight, seed + 3087, 176);
  rect(t, 42, 17, 47, 46, metalLight, seed + 3088, 174);
  rect(t, 20, 17, 46, 20, metalLight, seed + 3089, 168);
  rect(t, 20, 44, 46, 47, metalLight, seed + 3090, 164);
  for (let y = 23; y <= 40; y += 5) {
    line(t, 22, y + 2, 44, y - 2, 1.8, soot, seed + 3091 + y, 232);
  }
  line(t, 20, 47, 45, 20, 0.9, rust, seed + 3084, 130);
  drawNoiseDust(t, seed + 3085, blue, 9);
  drawNoiseDust(t, seed + 3086, rust, 11);
}

function drawIp4GasmaskSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [14, 20, 20];
  const rubberLight: [number, number, number] = [48, 64, 58];
  const glass: [number, number, number] = [102, 164, 158];
  const glassLight: [number, number, number] = [172, 232, 218];
  const metal: [number, number, number] = [82, 96, 88];
  const yellow: [number, number, number] = [216, 158, 46];
  const red: [number, number, number] = [166, 42, 38];
  const smog: [number, number, number] = [54, 86, 70];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 18, 4, [8, 10, 10], seed + 840, 86);
  ellipse(t, 32, 30, 18, 17, rubber, seed + 841, 248);
  ellipse(t, 32, 31, 14, 14, rubberLight, seed + 842, 205);
  clearRect(t, 15, 12, 21, 19);
  clearRect(t, 45, 12, 50, 19);
  line(t, 17, 21, 25, 14, 2.0, rubber, seed + 843, 230);
  line(t, 47, 21, 39, 14, 2.0, rubber, seed + 844, 230);

  ellipse(t, 25, 27, 6.5, 5.3, metal, seed + 845, 245);
  ellipse(t, 39, 27, 6.5, 5.3, metal, seed + 846, 245);
  ellipse(t, 25, 27, 4.2, 3.4, glass, seed + 847, 230);
  ellipse(t, 39, 27, 4.2, 3.4, glass, seed + 848, 230);
  px(t, 23, 25, rgba(glassLight[0], glassLight[1], glassLight[2], 190));
  px(t, 37, 25, rgba(glassLight[0], glassLight[1], glassLight[2], 190));
  rect(t, 29, 33, 36, 43, rubber, seed + 849, 245);
  rect(t, 30, 36, 35, 41, metal, seed + 850, 215);

  line(t, 39, 42, 50, 48, 2.8, rubber, seed + 851, 235);
  rect(t, 47, 39, 55, 52, metal, seed + 852, 236);
  rect(t, 49, 41, 54, 49, rubber, seed + 853, 220);
  for (let y = 42; y <= 48; y += 3) rect(t, 48, y, 55, y, yellow, seed + 854 + y, 190);
  rect(t, 20, 41, 29, 46, red, seed + 855, 180);
  ellipse(t, 45, 33, 7.5, 9, smog, seed + 856, 98);
  line(t, 18, 45, 46, 22, 0.8, rust, seed + 857, 122);
  drawNoiseDust(t, seed + 858, rust, 11);
  drawNoiseDust(t, seed + 859, glassLight, 8);
}

function drawJackhammerSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [20, 24, 24];
  const steel: [number, number, number] = [98, 108, 104];
  const steelLight: [number, number, number] = [174, 184, 168];
  const rubber: [number, number, number] = [28, 32, 30];
  const yellow: [number, number, number] = [216, 158, 46];
  const red: [number, number, number] = [166, 44, 38];
  const rust: [number, number, number] = [132, 70, 38];
  const dust: [number, number, number] = [132, 126, 104];

  ellipse(t, 33, 53, 18, 4, [12, 12, 10], seed + 860, 84);
  line(t, 18, 46, 40, 25, 7.0, dark, seed + 861, 245);
  line(t, 20, 44, 39, 26, 4.8, steel, seed + 862, 248);
  line(t, 22, 42, 36, 28, 1.2, steelLight, seed + 863, 190);
  rect(t, 24, 38, 38, 49, rubber, seed + 864, 236);
  rect(t, 27, 39, 36, 42, yellow, seed + 865, 224);

  rect(t, 32, 18, 47, 34, dark, seed + 866, 246);
  rect(t, 34, 20, 45, 32, steel, seed + 867, 248);
  outlineRect(t, 32, 18, 47, 34, dark);
  rect(t, 35, 22, 44, 25, yellow, seed + 868, 225);
  rect(t, 37, 29, 45, 32, red, seed + 869, 195);
  line(t, 39, 20, 52, 11, 2.0, steelLight, seed + 870, 235);
  line(t, 45, 14, 55, 10, 1.0, dark, seed + 871, 225);
  line(t, 42, 33, 51, 49, 2.2, steel, seed + 872, 238);
  line(t, 50, 48, 53, 55, 1.1, steelLight, seed + 873, 230);
  line(t, 20, 47, 45, 22, 0.9, rust, seed + 874, 130);
  ellipse(t, 52, 51, 7, 3, dust, seed + 875, 115);
  drawNoiseDust(t, seed + 876, rust, 10);
  drawNoiseDust(t, seed + 877, dust, 8);
}

function drawLiquidatorFlashlampSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [12, 18, 20];
  const metal: [number, number, number] = [52, 68, 70];
  const metalLight: [number, number, number] = [120, 136, 126];
  const lens: [number, number, number] = [214, 188, 96];
  const lensLight: [number, number, number] = [246, 232, 154];
  const red: [number, number, number] = [184, 42, 34];
  const yellow: [number, number, number] = [216, 158, 46];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 34, 53, 19, 4, [8, 10, 10], seed + 878, 84);
  rect(t, 18, 37, 39, 50, dark, seed + 879, 246);
  rect(t, 20, 38, 37, 47, metal, seed + 880, 248);
  rect(t, 23, 40, 34, 43, yellow, seed + 881, 218);
  rect(t, 24, 44, 36, 47, red, seed + 882, 198);
  line(t, 17, 38, 28, 27, 4.2, dark, seed + 883, 235);
  line(t, 19, 37, 28, 29, 2.2, metalLight, seed + 884, 215);

  ellipse(t, 41, 28, 15, 13, dark, seed + 885, 250);
  ellipse(t, 43, 28, 11.5, 9.2, metal, seed + 886, 250);
  ellipse(t, 46, 27, 8.2, 6.4, lens, seed + 887, 242);
  ellipse(t, 48, 26, 4.0, 3.0, lensLight, seed + 888, 222);
  ellipse(t, 52, 27, 9.5, 5.2, lensLight, seed + 889, 76);
  clearRect(t, 29, 15, 35, 20);
  clearRect(t, 54, 20, 58, 28);
  line(t, 30, 17, 47, 38, 1.5, dark, seed + 890, 180);
  rect(t, 34, 34, 45, 38, red, seed + 891, 205);
  rect(t, 36, 35, 43, 36, yellow, seed + 892, 195);
  line(t, 24, 45, 48, 25, 0.9, rust, seed + 893, 135);
  rect(t, 42, 18, 50, 20, rust, seed + 894, 155);
  drawNoiseDust(t, seed + 895, rust, 9);
  drawNoiseDust(t, seed + 896, lensLight, 8);
}

function drawNoiseCanSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [92, 104, 100];
  const metalLight: [number, number, number] = [168, 178, 164];
  const metalDark: [number, number, number] = [30, 38, 38];
  const label: [number, number, number] = [198, 154, 54];
  const red: [number, number, number] = [168, 42, 34];
  const string: [number, number, number] = [182, 172, 126];
  const bolt: [number, number, number] = [54, 58, 56];
  const rust: [number, number, number] = [136, 68, 38];

  ellipse(t, 32, 53, 16, 4, [10, 12, 10], seed + 2118, 84);
  line(t, 18, 20, 28, 10, 1.0, string, seed + 2119, 210);
  line(t, 28, 10, 40, 19, 1.0, string, seed + 2120, 205);
  ellipse(t, 18, 20, 2.5, 2.0, bolt, seed + 2121, 235);
  ellipse(t, 40, 19, 2.5, 2.0, bolt, seed + 2122, 235);

  rect(t, 20, 24, 45, 50, metal, seed + 2123, 248);
  ellipse(t, 32.5, 24, 13, 5, metalLight, seed + 2124, 252);
  ellipse(t, 32.5, 50, 13, 4, metalDark, seed + 2125, 170);
  outlineRect(t, 20, 24, 45, 50, metalDark);
  clearRect(t, 20, 24, 23, 27);
  clearRect(t, 43, 24, 45, 29);
  rect(t, 23, 33, 42, 41, label, seed + 2126, 226);
  rect(t, 25, 35, 38, 36, metalDark, 0, 120);
  rect(t, 27, 39, 40, 40, red, seed + 2127, 186);
  line(t, 24, 25, 23, 48, 0.8, metalLight, seed + 2128, 130);
  line(t, 41, 24, 44, 47, 0.8, metalDark, seed + 2129, 128);
  line(t, 15, 35, 20, 31, 0.9, string, seed + 2130, 190);
  line(t, 45, 31, 53, 27, 0.9, string, seed + 2131, 190);
  ellipse(t, 14, 36, 2.5, 2.0, bolt, seed + 2132, 228);
  ellipse(t, 54, 27, 2.5, 2.0, bolt, seed + 2133, 228);
  line(t, 12, 24, 18, 18, 0.8, red, seed + 2134, 132);
  line(t, 48, 17, 56, 13, 0.8, red, seed + 2135, 128);
  drawNoiseDust(t, seed + 2136, rust, 11);
}

function drawManometerSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 24, 24];
  const steel: [number, number, number] = [86, 100, 98];
  const steelLight: [number, number, number] = [166, 176, 162];
  const face: [number, number, number] = [202, 194, 152];
  const ink: [number, number, number] = [28, 26, 22];
  const red: [number, number, number] = [176, 38, 34];
  const yellow: [number, number, number] = [214, 156, 48];
  const rust: [number, number, number] = [126, 64, 34];

  ellipse(t, 32, 53, 15, 4, [10, 10, 8], seed + 2137, 82);
  line(t, 22, 45, 13, 54, 3.2, dark, seed + 2138, 230);
  line(t, 22, 45, 15, 54, 1.5, steelLight, seed + 2139, 205);
  line(t, 43, 43, 55, 51, 3.0, dark, seed + 2140, 220);
  line(t, 43, 43, 54, 50, 1.3, rust, seed + 2141, 200);
  ellipse(t, 33, 31, 18, 18, dark, seed + 2142, 252);
  ellipse(t, 33, 31, 14.2, 14.2, steel, seed + 2143, 248);
  ellipse(t, 33, 31, 10.5, 10.5, face, seed + 2144, 246);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 1.35 + Math.PI * 0.82;
    const x = 33 + Math.cos(a) * 8;
    const y = 31 + Math.sin(a) * 8;
    rect(t, x - 0.6, y - 0.6, x + 0.6, y + 0.6, ink, 0, 170);
  }
  line(t, 33, 31, 43, 26, 2.2, red, seed + 2145, 246);
  ellipse(t, 42, 27, 1.8, 1.8, red, seed + 2146, 238);
  ellipse(t, 33, 31, 2.2, 2.2, ink, seed + 2147, 238);
  rect(t, 26, 17, 41, 20, yellow, seed + 2148, 190);
  rect(t, 29, 18, 38, 19, steelLight, seed + 2149, 160);
  line(t, 24, 44, 46, 21, 0.8, rust, seed + 2150, 118);
  drawNoiseDust(t, seed + 2151, rust, 10);
  drawNoiseDust(t, seed + 2152, steelLight, 6);
}

function drawPostSamosborProbeKitSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [14, 20, 22];
  const metal: [number, number, number] = [76, 92, 94];
  const metalLight: [number, number, number] = [152, 166, 156];
  const rubber: [number, number, number] = [30, 34, 32];
  const yellow: [number, number, number] = [214, 158, 48];
  const red: [number, number, number] = [176, 40, 36];
  const cyan: [number, number, number] = [74, 214, 204];
  const violet: [number, number, number] = [142, 90, 210];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 19, 4, [10, 12, 12], seed + 2287, 84);
  rect(t, 17, 30, 49, 50, dark, seed + 2288, 246);
  rect(t, 19, 27, 47, 47, metal, seed + 2289, 250);
  outlineRect(t, 17, 30, 49, 50, dark);
  clearRect(t, 17, 30, 20, 33);
  clearRect(t, 47, 29, 49, 34);
  rect(t, 22, 24, 44, 30, rubber, seed + 2290, 240);
  rect(t, 25, 22, 41, 25, metalLight, seed + 2291, 220);
  rect(t, 22, 34, 44, 39, yellow, seed + 2292, 220);
  rect(t, 24, 35, 41, 36, dark, seed + 2293, 120);
  rect(t, 24, 41, 33, 45, red, seed + 2294, 205);
  rect(t, 36, 41, 44, 45, cyan, seed + 2295, 190);
  line(t, 13, 49, 31, 35, 2.8, rubber, seed + 2296, 238);
  line(t, 15, 48, 32, 35, 1.3, metalLight, seed + 2297, 220);
  line(t, 44, 30, 57, 16, 1.5, metalLight, seed + 2298, 230);
  ellipse(t, 57, 16, 3.2, 2.2, cyan, seed + 2299, 210);
  line(t, 38, 30, 51, 13, 1.2, cyan, seed + 2300, 190);
  ellipse(t, 51, 13, 2.8, 2.0, violet, seed + 2301, 205);
  ellipse(t, 48, 24, 8.5, 7.0, violet, seed + 2302, 62);
  line(t, 21, 46, 46, 31, 0.9, rust, seed + 2303, 132);
  rect(t, 42, 28, 50, 31, rust, seed + 2304, 152);
  drawNoiseDust(t, seed + 2305, cyan, 9);
  drawNoiseDust(t, seed + 2306, rust, 10);
}

function drawSealantTubeSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [24, 30, 30];
  const metal: [number, number, number] = [118, 126, 120];
  const metalLight: [number, number, number] = [206, 208, 184];
  const rubber: [number, number, number] = [42, 54, 50];
  const sealant: [number, number, number] = [188, 190, 172];
  const yellow: [number, number, number] = [210, 154, 48];
  const cyan: [number, number, number] = [72, 190, 186];
  const red: [number, number, number] = [178, 42, 36];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 2383, 82);
  line(t, 16, 45, 43, 20, 8.0, dark, seed + 2384, 238);
  line(t, 18, 43, 42, 21, 5.6, metal, seed + 2385, 248);
  line(t, 21, 40, 39, 23, 1.2, metalLight, seed + 2386, 190);
  rect(t, 22, 34, 38, 43, sealant, seed + 2387, 222);
  rect(t, 24, 36, 36, 37, rubber, seed + 2388, 140);
  rect(t, 26, 39, 36, 41, red, seed + 2389, 200);
  line(t, 42, 20, 55, 13, 2.2, metalLight, seed + 2390, 230);
  line(t, 53, 13, 59, 12, 1.0, cyan, seed + 2391, 210);
  rect(t, 14, 43, 24, 51, rubber, seed + 2392, 232);
  rect(t, 17, 45, 23, 47, yellow, seed + 2393, 214);
  rect(t, 37, 25, 45, 31, yellow, seed + 2394, 205);
  rect(t, 39, 27, 44, 28, dark, seed + 2395, 128);
  ellipse(t, 43, 36, 5, 3, cyan, seed + 2396, 112);
  line(t, 18, 49, 47, 24, 0.9, rust, seed + 2397, 132);
  rect(t, 45, 17, 51, 20, rust, seed + 2398, 150);
  drawNoiseDust(t, seed + 2399, rust, 10);
  drawNoiseDust(t, seed + 2400, cyan, 8);
}

function drawProtectiveApronSprite(t: Uint32Array, seed: number): void {
  const rubberDark: [number, number, number] = [22, 34, 30];
  const rubber: [number, number, number] = [58, 96, 74];
  const rubberLight: [number, number, number] = [116, 150, 104];
  const acid: [number, number, number] = [196, 184, 58];
  const cyan: [number, number, number] = [74, 196, 184];
  const red: [number, number, number] = [174, 42, 38];
  const tag: [number, number, number] = [202, 182, 116];
  const grime: [number, number, number] = [68, 58, 38];

  ellipse(t, 32, 53, 17, 4, [8, 10, 8], seed + 2324, 82);
  line(t, 24, 13, 18, 27, 1.6, rubberDark, seed + 2325, 235);
  line(t, 40, 13, 47, 27, 1.6, rubberDark, seed + 2326, 235);
  rect(t, 24, 14, 41, 29, rubber, seed + 2327, 248);
  rect(t, 18, 27, 48, 50, rubber, seed + 2328, 252);
  outlineRect(t, 18, 27, 48, 50, rubberDark);
  outlineRect(t, 24, 14, 41, 29, rubberDark);
  clearRect(t, 18, 27, 21, 31);
  clearRect(t, 46, 27, 48, 33);
  clearRect(t, 19, 47, 22, 50);
  rect(t, 26, 17, 39, 22, rubberLight, seed + 2329, 145);
  line(t, 23, 29, 22, 49, 0.8, rubberLight, seed + 2330, 150);
  line(t, 42, 29, 44, 49, 0.8, rubberDark, seed + 2331, 160);
  rect(t, 37, 31, 48, 38, tag, seed + 2332, 220);
  rect(t, 39, 33, 46, 34, rubberDark, 0, 128);
  rect(t, 40, 36, 47, 37, red, seed + 2333, 185);
  ellipse(t, 28, 37, 7.2, 4.8, acid, seed + 2334, 170);
  line(t, 27, 38, 38, 47, 1.0, acid, seed + 2335, 175);
  ellipse(t, 36, 28, 5.5, 3.0, cyan, seed + 2336, 135);
  rect(t, 21, 44, 34, 47, red, seed + 2337, 150);
  line(t, 20, 48, 45, 30, 0.8, grime, seed + 2338, 128);
  drawNoiseDust(t, seed + 2339, acid, 14);
  drawNoiseDust(t, seed + 2340, grime, 11);
}

function drawRubberDoorWedgeSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [14, 20, 20];
  const rubberLight: [number, number, number] = [58, 72, 68];
  const edge: [number, number, number] = [132, 144, 126];
  const yellow: [number, number, number] = [218, 158, 46];
  const red: [number, number, number] = [176, 42, 36];
  const cyan: [number, number, number] = [74, 186, 184];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 2534, 82);
  line(t, 17, 46, 49, 31, 8.5, rubber, seed + 2535, 248);
  line(t, 20, 44, 47, 32, 5.8, rubberLight, seed + 2536, 238);
  line(t, 23, 42, 45, 33, 1.1, edge, seed + 2537, 150);
  rect(t, 16, 42, 32, 52, rubber, seed + 2538, 250);
  rect(t, 18, 43, 30, 48, yellow, seed + 2539, 210);
  rect(t, 20, 45, 29, 46, red, seed + 2540, 205);
  rect(t, 35, 30, 51, 35, cyan, seed + 2541, 170);
  line(t, 36, 31, 50, 34, 0.8, rubber, seed + 2542, 150);
  line(t, 27, 41, 48, 31, 0.9, rust, seed + 2543, 128);
  for (let i = 0; i < 4; i++) line(t, 20 + i * 5, 45 + i, 30 + i * 5, 40 + i, 0.8, rubber, seed + 2544 + i, 155);
  drawNoiseDust(t, seed + 2548, edge, 8);
}

function drawSmokeCandleCheckSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [24, 30, 30];
  const metal: [number, number, number] = [94, 104, 96];
  const metalLight: [number, number, number] = [172, 180, 158];
  const smoke: [number, number, number] = [170, 178, 166];
  const yellow: [number, number, number] = [218, 158, 46];
  const red: [number, number, number] = [176, 42, 36];
  const cyan: [number, number, number] = [78, 188, 188];
  const rust: [number, number, number] = [128, 66, 38];

  ellipse(t, 32, 53, 15, 4, [8, 10, 10], seed + 2670, 82);
  line(t, 24, 14, 20, 8, 0.9, smoke, seed + 2671, 105);
  line(t, 30, 15, 35, 7, 0.8, smoke, seed + 2672, 96);
  line(t, 38, 18, 45, 10, 0.8, smoke, seed + 2673, 88);
  ellipse(t, 22, 10, 4.8, 2.5, smoke, seed + 2674, 60);
  ellipse(t, 36, 8, 5.5, 2.8, smoke, seed + 2675, 54);
  ellipse(t, 46, 11, 4.5, 2.4, smoke, seed + 2676, 50);

  rect(t, 23, 24, 43, 50, dark, seed + 2677, 244);
  rect(t, 25, 20, 41, 47, metal, seed + 2678, 250);
  ellipse(t, 33, 20, 8.5, 3.8, metalLight, seed + 2679, 224);
  ellipse(t, 33, 47, 8.5, 3.2, dark, seed + 2680, 148);
  outlineRect(t, 25, 20, 41, 47, dark);
  clearRect(t, 25, 20, 28, 23);
  clearRect(t, 39, 21, 41, 25);
  rect(t, 24, 29, 42, 36, yellow, seed + 2681, 224);
  rect(t, 27, 31, 39, 32, dark, 0, 135);
  rect(t, 27, 35, 39, 38, red, seed + 2682, 205);
  rect(t, 28, 40, 38, 42, cyan, seed + 2683, 190);
  rect(t, 30, 16, 37, 21, dark, seed + 2684, 236);
  rect(t, 31, 14, 36, 17, yellow, seed + 2685, 220);
  line(t, 26, 45, 42, 26, 0.8, rust, seed + 2686, 130);
  drawNoiseDust(t, seed + 2687, smoke, 12);
  drawNoiseDust(t, seed + 2688, rust, 10);
}

function drawWetRagBundleSprite(t: Uint32Array, seed: number): void {
  const wetDark: [number, number, number] = [34, 54, 58];
  const wet: [number, number, number] = [76, 116, 116];
  const wetLight: [number, number, number] = [142, 180, 168];
  const cloth: [number, number, number] = [154, 150, 122];
  const string: [number, number, number] = [116, 96, 62];
  const smog: [number, number, number] = [66, 122, 82];
  const red: [number, number, number] = [166, 42, 36];
  const rust: [number, number, number] = [118, 62, 36];
  const cyan: [number, number, number] = [88, 210, 202];

  ellipse(t, 32, 52, 18, 4, [10, 14, 14], seed + 2549, 78);
  ellipse(t, 29, 35, 17, 12, wetDark, seed + 2550, 242);
  ellipse(t, 35, 34, 18, 13, wet, seed + 2551, 248);
  rect(t, 17, 35, 49, 49, wet, seed + 2552, 245);
  clearRect(t, 14, 28, 18, 35);
  clearRect(t, 47, 24, 52, 31);
  line(t, 19, 37, 47, 34, 1.3, wetLight, seed + 2553, 160);
  line(t, 20, 44, 45, 39, 1.1, wetDark, seed + 2554, 170);
  line(t, 24, 26, 25, 47, 1.2, cloth, seed + 2555, 176);
  line(t, 36, 24, 40, 47, 1.2, cloth, seed + 2556, 164);
  line(t, 18, 40, 48, 38, 1.4, string, seed + 2557, 218);
  rect(t, 30, 35, 38, 42, string, seed + 2558, 190);
  rect(t, 36, 40, 50, 45, smog, seed + 2559, 142);
  rect(t, 39, 42, 47, 43, red, seed + 2560, 168);
  for (const [x, y, rx, ry] of [[22, 45, 2.4, 1.5], [32, 30, 2.0, 1.4], [44, 34, 2.2, 1.5]] as const) {
    ellipse(t, x, y, rx, ry, cyan, seed + x + y, 150);
  }
  drawNoiseDust(t, seed + 2561, cyan, 10);
  drawNoiseDust(t, seed + 2562, rust, 9);
}

function drawWireCoilSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [16, 24, 24];
  const wire: [number, number, number] = [42, 82, 82];
  const cyan: [number, number, number] = [74, 220, 212];
  const copper: [number, number, number] = [196, 106, 48];
  const yellow: [number, number, number] = [218, 166, 58];
  const red: [number, number, number] = [178, 42, 36];
  const steel: [number, number, number] = [126, 142, 132];
  const rust: [number, number, number] = [124, 64, 36];

  ellipse(t, 33, 52, 18, 4, [8, 10, 10], seed + 2563, 80);
  ellipse(t, 32, 34, 18, 13, rubber, seed + 2564, 232);
  for (let r = 17; r >= 7; r -= 3) {
    arcLine(t, 32, 34, r, r * 0.66, Math.PI * 0.08, Math.PI * 1.92, 1.3, (r & 1) === 0 ? cyan : wire, seed + 2565 + r, 232, 26);
  }
  ellipse(t, 32, 34, 6.0, 4.0, [0, 0, 0], 0, 0);
  line(t, 19, 43, 11, 52, 1.6, cyan, seed + 2578, 225);
  line(t, 12, 52, 17, 56, 1.1, copper, seed + 2579, 230);
  line(t, 44, 27, 56, 20, 1.5, wire, seed + 2580, 220);
  line(t, 55, 20, 61, 20, 1.1, copper, seed + 2581, 226);
  rect(t, 25, 21, 38, 25, yellow, seed + 2582, 192);
  rect(t, 28, 22, 36, 23, rubber, seed + 2583, 128);
  rect(t, 39, 42, 48, 46, red, seed + 2584, 160);
  line(t, 18, 45, 48, 26, 0.8, steel, seed + 2585, 110);
  drawNoiseDust(t, seed + 2586, cyan, 16);
  drawNoiseDust(t, seed + 2587, rust, 10);
}

function drawToolSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'wet_rag_bundle') {
    drawWetRagBundleSprite(t, seed);
    return;
  }
  if (defId === 'wire_coil') {
    drawWireCoilSprite(t, seed);
    return;
  }
  if (defId === 'smoke_candle_check') {
    drawSmokeCandleCheckSprite(t, seed);
    return;
  }
  if (defId === 'unpeople_detector') {
    drawUnpeopleDetectorSprite(t, seed);
    return;
  }
  if (defId === 'uv_spotlight') {
    drawUvSpotlightSprite(t, seed);
    return;
  }
  if (defId === 'vacuum') {
    drawVacuumSprite(t, seed);
    return;
  }
  if (defId === 'vent_damper_plate') {
    drawVentDamperPlateSprite(t, seed);
    return;
  }
  if (defId === 'rubber_door_wedge') {
    drawRubberDoorWedgeSprite(t, seed);
    return;
  }
  if (defId === 'radio') {
    drawRadioSprite(t, seed);
    return;
  }
  if (defId === 'radio_headset_liquidator') {
    drawRadioHeadsetLiquidatorSprite(t, seed);
    return;
  }
  if (defId === 'radio_jammer') {
    drawRadioJammerSprite(t, seed);
    return;
  }
  if (defId === 'protective_apron') {
    drawProtectiveApronSprite(t, seed);
    return;
  }
  if (defId === 'sealant_tube') {
    drawSealantTubeSprite(t, seed);
    return;
  }
  if (defId === 'noise_can') {
    drawNoiseCanSprite(t, seed);
    return;
  }
  if (defId === 'manometer') {
    drawManometerSprite(t, seed);
    return;
  }
  if (defId === 'liquidator_flashlamp') {
    drawLiquidatorFlashlampSprite(t, seed);
    return;
  }
  if (defId === 'ip4_gasmask') {
    drawIp4GasmaskSprite(t, seed);
    return;
  }
  if (defId === 'jackhammer') {
    drawJackhammerSprite(t, seed);
    return;
  }
  if (defId === 'hermetic_tape') {
    drawHermeticTapeSprite(t, seed);
    return;
  }
  if (defId === 'hermo_gasket') {
    drawHermoGasketSprite(t, seed);
    return;
  }
  if (defId === 'chalk') {
    drawChalkSprite(t, seed);
    return;
  }
  if (defId === 'block_kit') {
    drawBlockKitSprite(t, seed);
    return;
  }
  if (defId === 'cleaning_kit') {
    drawCleaningKitSprite(t, seed);
    return;
  }
  if (defId === 'door_kit') {
    drawDoorKitSprite(t, seed);
    return;
  }
  if (defId === 'felt_door_pad') {
    drawFeltDoorPadSprite(t, seed);
    return;
  }
  if (defId === 'filter_canister') {
    drawFilterCanisterSprite(t, seed);
    return;
  }
  if (defId === 'gasmask_filter') {
    drawGasmaskFilterSprite(t, seed);
    return;
  }
  if (defId === 'flashlight') {
    drawFlashlightSprite(t, seed);
    return;
  }
  if (defId === 'fog_detector') {
    drawFogDetectorSprite(t, seed);
    return;
  }
  if (defId === 'post_samosbor_probe_kit') {
    drawPostSamosborProbeKitSprite(t, seed);
    return;
  }
  if (defId.includes('flash') || defId.includes('spotlight') || defId.includes('lamp')) {
    rect(t, 20, 30, 42, 42, p.body, seed + 101);
    ellipse(t, 45, 36, 8, 7, p.light, seed + 102);
    ellipse(t, 48, 36, 4, 4, p.glow, seed + 103, 230);
    line(t, 13, 36, 20, 36, 2, p.dark, seed + 104);
    return;
  }
  if (defId.includes('coil') || defId.includes('wire')) {
    for (let r = 13; r >= 5; r -= 4) ellipse(t, 32, 34, r, r * 0.65, p.body, seed + 105 + r, 170);
    line(t, 20, 45, 14, 51, 1.4, p.accent, seed + 110);
    return;
  }
  line(t, 20, 47, 45, 20, 3, p.body, seed + 111);
  ellipse(t, 46, 18, 7, 5, p.light, seed + 112);
  ellipse(t, 46, 18, 3, 2, CLEAR_RGB(), 0, 255);
}

function drawBlockKitSprite(t: Uint32Array, seed: number): void {
  const concrete: [number, number, number] = [116, 122, 114];
  const concreteLight: [number, number, number] = [166, 172, 158];
  const concreteDark: [number, number, number] = [48, 56, 54];
  const metal: [number, number, number] = [76, 88, 88];
  const rubber: [number, number, number] = [24, 30, 30];
  const yellow: [number, number, number] = [216, 158, 46];
  const cyan: [number, number, number] = [72, 176, 184];
  const rust: [number, number, number] = [132, 68, 38];
  const damp: [number, number, number] = [62, 76, 66];

  rect(t, 20, 16, 47, 24, concreteLight, seed + 220, 245);
  rect(t, 17, 22, 43, 46, concrete, seed + 221, 252);
  rect(t, 43, 24, 49, 42, concreteDark, seed + 222, 235);
  outlineRect(t, 17, 22, 43, 46, concreteDark);
  line(t, 20, 16, 47, 16, 1, concreteDark, seed + 223, 230);
  line(t, 47, 17, 49, 42, 1, concreteDark, seed + 224, 230);
  line(t, 28, 21, 26, 44, 0.8, concreteDark, seed + 225, 118);
  line(t, 38, 20, 36, 44, 0.8, concreteDark, seed + 226, 105);
  line(t, 19, 32, 43, 31, 0.9, concreteDark, seed + 227, 120);

  rect(t, 22, 24, 42, 27, yellow, seed + 228, 235);
  for (let x = 24; x <= 39; x += 6) line(t, x, 24, x + 3, 27, 0.9, concreteDark, seed + 229 + x, 190);
  rect(t, 23, 37, 33, 40, cyan, seed + 240, 220);
  rect(t, 25, 38, 31, 38, concreteDark, seed + 241, 140);

  line(t, 13, 50, 30, 36, 4.6, rubber, seed + 230, 245);
  line(t, 16, 48, 31, 36, 2.4, metal, seed + 231, 230);
  rect(t, 20, 42, 29, 50, rubber, seed + 232, 235);
  rect(t, 23, 40, 30, 43, metal, seed + 233, 235);
  line(t, 43, 41, 53, 49, 1.4, cyan, seed + 234, 210);
  line(t, 52, 48, 56, 45, 1.1, yellow, seed + 235, 205);

  ellipse(t, 22, 43, 5, 4, damp, seed + 236, 130);
  rect(t, 39, 41, 46, 44, rust, seed + 237, 155);
  drawNoiseDust(t, seed + 238, rust, 12);
  clearRect(t, 17, 22, 20, 24);
  clearRect(t, 45, 17, 47, 20);
  px(t, 41, 45, CLEAR);
  px(t, 42, 46, CLEAR);
}

function CLEAR_RGB(): [number, number, number] {
  return [0, 0, 0];
}

function drawFieldRadioBatterySprite(t: Uint32Array, seed: number): void {
  const bakelite: [number, number, number] = [30, 42, 42];
  const bakeliteLight: [number, number, number] = [74, 94, 88];
  const dark: [number, number, number] = [10, 16, 16];
  const contacts: [number, number, number] = [190, 174, 118];
  const cyan: [number, number, number] = [78, 226, 198];
  const red: [number, number, number] = [186, 42, 38];
  const paper: [number, number, number] = [194, 184, 132];
  const rust: [number, number, number] = [126, 68, 40];

  ellipse(t, 33, 53, 16, 4, [8, 12, 12], seed + 754, 80);
  rect(t, 21, 16, 45, 51, dark, seed + 755, 248);
  rect(t, 23, 18, 43, 49, bakelite, seed + 756, 250);
  outlineRect(t, 21, 16, 45, 51, dark);
  clearRect(t, 21, 16, 24, 19);
  clearRect(t, 43, 17, 45, 22);
  clearRect(t, 22, 48, 25, 51);
  rect(t, 26, 12, 32, 17, contacts, seed + 757, 235);
  rect(t, 35, 12, 41, 17, contacts, seed + 758, 235);
  rect(t, 27, 13, 31, 14, [226, 214, 154], seed + 759, 200);
  rect(t, 36, 13, 40, 14, [226, 214, 154], seed + 760, 200);

  rect(t, 25, 25, 41, 35, paper, seed + 761, 225);
  rect(t, 27, 28, 38, 29, dark, 0, 140);
  rect(t, 28, 32, 39, 33, red, seed + 762, 218);
  rect(t, 25, 39, 41, 43, bakeliteLight, seed + 763, 215);
  for (let x = 27; x <= 39; x += 4) rect(t, x, 40, x + 1, 42, cyan, seed + 764 + x, 230);
  line(t, 24, 20, 42, 48, 0.9, bakeliteLight, seed + 765, 92);
  line(t, 22, 47, 44, 45, 0.9, rust, seed + 766, 145);
  ellipse(t, 44, 33, 4.8, 8, cyan, seed + 767, 58);
  drawNoiseDust(t, seed + 768, rust, 9);
  drawNoiseDust(t, seed + 769, cyan, 12);
}

function drawContrabandShockerPartsSprite(t: Uint32Array, seed: number): void {
  const bakelite: [number, number, number] = [28, 38, 40];
  const bakeliteLight: [number, number, number] = [72, 92, 86];
  const dark: [number, number, number] = [8, 12, 12];
  const steel: [number, number, number] = [150, 158, 144];
  const brass: [number, number, number] = [188, 144, 64];
  const cyan: [number, number, number] = [68, 230, 204];
  const red: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 32, 53, 17, 4, [8, 10, 10], seed + 770, 80);
  rect(t, 18, 35, 44, 49, dark, seed + 771, 244);
  rect(t, 20, 33, 42, 47, bakelite, seed + 772, 248);
  outlineRect(t, 18, 35, 44, 49, dark);
  rect(t, 28, 17, 43, 36, bakeliteLight, seed + 773, 235);
  outlineRect(t, 28, 17, 43, 36, dark);
  line(t, 34, 17, 34, 36, 1.1, cyan, seed + 774, 205);
  for (let y = 20; y <= 32; y += 4) line(t, 28, y, 43, y + 1, 0.9, brass, seed + 775 + y, 220);
  line(t, 19, 37, 33, 28, 1.2, steel, seed + 776, 215);
  line(t, 20, 44, 40, 25, 1.0, cyan, seed + 777, 160);
  line(t, 41, 18, 53, 12, 1.5, steel, seed + 778, 230);
  line(t, 44, 21, 55, 17, 1.5, steel, seed + 779, 230);
  ellipse(t, 53, 12, 2.5, 1.7, cyan, seed + 780, 220);
  ellipse(t, 55, 17, 2.5, 1.7, cyan, seed + 781, 220);
  rect(t, 22, 38, 38, 42, red, seed + 782, 190);
  rect(t, 24, 39, 35, 40, bakeliteLight, seed + 783, 175);
  ellipse(t, 37, 28, 12, 12, cyan, seed + 784, 44);
  rect(t, 29, 21, 43, 22, brass, seed + 788, 220);
  rect(t, 29, 27, 43, 28, brass, seed + 789, 214);
  rect(t, 29, 32, 42, 33, brass, seed + 790, 208);
  line(t, 20, 48, 45, 45, 0.9, rust, seed + 785, 140);
  drawNoiseDust(t, seed + 786, cyan, 12);
  drawNoiseDust(t, seed + 787, rust, 10);
}

function drawJuniorTechCaseSprite(t: Uint32Array, seed: number): void {
  const plastic: [number, number, number] = [164, 166, 146];
  const plasticLight: [number, number, number] = [220, 216, 184];
  const bakelite: [number, number, number] = [24, 34, 34];
  const dark: [number, number, number] = [8, 12, 12];
  const cyan: [number, number, number] = [74, 222, 198];
  const solder: [number, number, number] = [190, 162, 82];
  const red: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [122, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 788, 82);
  rect(t, 17, 17, 49, 49, dark, seed + 789, 248);
  rect(t, 19, 15, 47, 47, plastic, seed + 790, 250);
  outlineRect(t, 17, 17, 49, 49, dark);
  clearRect(t, 17, 17, 20, 20);
  clearRect(t, 47, 17, 49, 22);
  clearRect(t, 18, 46, 21, 49);

  rect(t, 23, 23, 43, 38, bakelite, seed + 791, 238);
  rect(t, 25, 25, 41, 29, plasticLight, seed + 792, 138);
  rect(t, 27, 33, 39, 35, red, seed + 793, 222);
  for (let x = 23; x <= 43; x += 5) {
    line(t, x, 39, x + 2, 46, 0.8, solder, seed + 794 + x, 208);
  }
  for (let i = 0; i < 8; i++) {
    const x = 24 + Math.floor(noise(i, 80, seed) * 18);
    const y = 24 + Math.floor(noise(i, 81, seed) * 13);
    px(t, x, y, rgba(cyan[0], cyan[1], cyan[2], 210));
  }
  line(t, 21, 20, 45, 45, 0.8, plasticLight, seed + 802, 100);
  line(t, 20, 47, 47, 44, 0.9, rust, seed + 803, 130);
  ellipse(t, 43, 31, 7, 8, cyan, seed + 804, 122);
  drawNoiseDust(t, seed + 805, rust, 9);
  drawNoiseDust(t, seed + 806, cyan, 10);
}

function drawKeyboardUnitSprite(t: Uint32Array, seed: number): void {
  const casing: [number, number, number] = [152, 158, 144];
  const casingLight: [number, number, number] = [214, 214, 184];
  const dark: [number, number, number] = [18, 24, 24];
  const keyDark: [number, number, number] = [42, 54, 54];
  const cyan: [number, number, number] = [74, 226, 202];
  const red: [number, number, number] = [184, 42, 38];
  const rust: [number, number, number] = [124, 66, 38];
  const grime: [number, number, number] = [66, 82, 70];

  ellipse(t, 33, 53, 18, 4, [8, 10, 10], seed + 807, 82);
  rect(t, 12, 27, 52, 49, dark, seed + 808, 248);
  rect(t, 14, 24, 50, 46, casing, seed + 809, 250);
  rect(t, 17, 26, 47, 31, casingLight, seed + 810, 160);
  outlineRect(t, 12, 27, 52, 49, dark);
  clearRect(t, 12, 27, 16, 30);
  clearRect(t, 50, 28, 52, 33);
  clearRect(t, 13, 46, 16, 49);
  for (let y = 34; y <= 42; y += 4) {
    for (let x = 18; x <= 45; x += 5) {
      rect(t, x, y, x + 3, y + 2, keyDark, seed + x + y, 215);
      if (((x + y + seed) & 7) === 0) px(t, x + 1, y + 1, rgba(cyan[0], cyan[1], cyan[2], 220));
    }
  }
  rect(t, 23, 44, 42, 46, keyDark, seed + 811, 210);
  rect(t, 37, 28, 47, 31, red, seed + 812, 208);
  rect(t, 39, 29, 45, 30, casingLight, seed + 813, 190);
  line(t, 15, 27, 50, 46, 0.8, grime, seed + 814, 102);
  ellipse(t, 47, 36, 7, 8, cyan, seed + 815, 138);
  drawNoiseDust(t, seed + 816, rust, 9);
  drawNoiseDust(t, seed + 817, cyan, 11);
}

function drawKronaBatterySprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [16, 22, 22];
  const body: [number, number, number] = [52, 68, 64];
  const bodyLight: [number, number, number] = [96, 118, 104];
  const paper: [number, number, number] = [204, 190, 128];
  const brass: [number, number, number] = [206, 168, 78];
  const cyan: [number, number, number] = [74, 226, 202];
  const red: [number, number, number] = [186, 42, 38];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 53, 15, 4, [8, 10, 10], seed + 818, 80);
  rect(t, 22, 17, 44, 51, dark, seed + 819, 248);
  rect(t, 24, 19, 42, 49, body, seed + 820, 250);
  outlineRect(t, 22, 17, 44, 51, dark);
  clearRect(t, 22, 17, 25, 20);
  clearRect(t, 42, 18, 44, 23);
  clearRect(t, 23, 48, 26, 51);
  rect(t, 26, 12, 31, 18, brass, seed + 821, 238);
  ellipse(t, 28.5, 12, 3.0, 1.8, brass, seed + 822, 230);
  rect(t, 36, 12, 41, 18, brass, seed + 823, 238);
  ellipse(t, 38.5, 12, 2.1, 1.4, dark, seed + 824, 230);
  rect(t, 26, 25, 40, 36, paper, seed + 825, 226);
  rect(t, 28, 28, 38, 29, dark, 0, 145);
  rect(t, 28, 33, 39, 34, red, seed + 826, 215);
  rect(t, 26, 40, 40, 44, bodyLight, seed + 827, 210);
  for (let x = 28; x <= 38; x += 4) rect(t, x, 41, x + 1, 43, cyan, seed + 828 + x, 220);
  line(t, 25, 21, 41, 48, 0.8, bodyLight, seed + 829, 94);
  rect(t, 39, 23, 47, 30, rust, seed + 830, 150);
  drawNoiseDust(t, seed + 831, rust, 10);
  drawNoiseDust(t, seed + 832, cyan, 9);
}

function drawPlasticSheetSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [14, 20, 22];
  const plastic: [number, number, number] = [166, 174, 164];
  const plasticLight: [number, number, number] = [226, 226, 196];
  const smoke: [number, number, number] = [78, 98, 94];
  const cyan: [number, number, number] = [72, 218, 202];
  const red: [number, number, number] = [182, 42, 38];
  const rust: [number, number, number] = [122, 66, 38];

  ellipse(t, 33, 53, 18, 4, [8, 10, 10], seed + 2307, 80);
  rect(t, 16, 25, 48, 46, dark, seed + 2308, 220);
  rect(t, 14, 21, 46, 42, plastic, seed + 2309, 238);
  rect(t, 18, 17, 50, 38, plasticLight, seed + 2310, 215);
  outlineRect(t, 18, 17, 50, 38, dark);
  outlineRect(t, 14, 21, 46, 42, smoke);
  clearRect(t, 18, 17, 22, 20);
  clearRect(t, 48, 17, 50, 23);
  clearRect(t, 15, 39, 19, 42);
  line(t, 20, 18, 48, 38, 0.9, smoke, seed + 2311, 110);
  line(t, 17, 28, 45, 24, 0.8, plasticLight, seed + 2312, 105);
  rect(t, 24, 24, 42, 31, smoke, seed + 2313, 115);
  rect(t, 20, 18, 49, 22, plasticLight, seed + 2320, 222);
  rect(t, 15, 24, 23, 40, plasticLight, seed + 2321, 202);
  rect(t, 24, 23, 42, 26, plasticLight, seed + 2323, 206);
  rect(t, 20, 38, 45, 42, plastic, seed + 2322, 210);
  for (let i = 0; i < 10; i++) {
    const x = 24 + Math.floor(noise(i, 90, seed) * 17);
    const y = 23 + Math.floor(noise(i, 91, seed) * 13);
    px(t, x, y, rgba(cyan[0], cyan[1], cyan[2], 210));
  }
  rect(t, 35, 34, 48, 37, red, seed + 2314, 205);
  rect(t, 38, 35, 45, 36, plasticLight, seed + 2315, 170);
  ellipse(t, 47, 31, 6, 7, cyan, seed + 2316, 132);
  line(t, 18, 43, 47, 39, 0.9, rust, seed + 2317, 128);
  drawNoiseDust(t, seed + 2318, rust, 9);
  drawNoiseDust(t, seed + 2319, cyan, 10);
}

function drawPortableSirenKeySprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [10, 16, 18];
  const bakelite: [number, number, number] = [34, 50, 50];
  const bakeliteLight: [number, number, number] = [82, 106, 96];
  const brass: [number, number, number] = [190, 152, 72];
  const cyan: [number, number, number] = [74, 226, 202];
  const red: [number, number, number] = [194, 38, 34];
  const yellow: [number, number, number] = [218, 164, 48];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 53, 16, 4, [8, 10, 10], seed + 2320, 82);
  rect(t, 19, 20, 45, 48, dark, seed + 2321, 248);
  rect(t, 21, 18, 43, 46, bakelite, seed + 2322, 250);
  outlineRect(t, 19, 20, 45, 48, dark);
  clearRect(t, 19, 20, 22, 23);
  clearRect(t, 43, 20, 45, 25);
  ellipse(t, 32, 24, 7.5, 6.2, dark, seed + 2323, 230);
  ellipse(t, 32, 24, 4.2, 3.4, [4, 8, 8], seed + 2324, 238);
  rect(t, 24, 32, 40, 38, red, seed + 2325, 230);
  rect(t, 26, 34, 38, 35, yellow, seed + 2326, 195);
  rect(t, 25, 40, 41, 44, bakeliteLight, seed + 2327, 195);
  for (let x = 27; x <= 38; x += 4) px(t, x, 42, rgba(cyan[0], cyan[1], cyan[2], 225));
  line(t, 42, 35, 58, 29, 2.8, brass, seed + 2328, 235);
  rect(t, 52, 25, 60, 28, brass, seed + 2329, 230);
  rect(t, 53, 31, 59, 33, brass, seed + 2330, 220);
  line(t, 21, 47, 44, 22, 0.8, bakeliteLight, seed + 2331, 102);
  line(t, 22, 46, 51, 31, 0.9, rust, seed + 2332, 132);
  ellipse(t, 43, 34, 7, 7, cyan, seed + 2333, 60);
  drawNoiseDust(t, seed + 2334, cyan, 10);
  drawNoiseDust(t, seed + 2335, rust, 9);
}

function drawScreenUnitSprite(t: Uint32Array, seed: number): void {
  const bakelite: [number, number, number] = [14, 24, 24];
  const casing: [number, number, number] = [164, 168, 150];
  const casingLight: [number, number, number] = [224, 220, 190];
  const glass: [number, number, number] = [34, 76, 78];
  const cyan: [number, number, number] = [76, 230, 204];
  const red: [number, number, number] = [188, 38, 34];
  const brass: [number, number, number] = [204, 164, 78];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 2350, 82);
  rect(t, 16, 17, 49, 49, bakelite, seed + 2351, 248);
  rect(t, 19, 15, 47, 47, casing, seed + 2352, 248);
  outlineRect(t, 16, 17, 49, 49, bakelite);
  clearRect(t, 16, 17, 20, 20);
  clearRect(t, 47, 18, 49, 23);
  clearRect(t, 17, 46, 21, 49);
  rect(t, 22, 20, 44, 38, bakelite, seed + 2353, 245);
  rect(t, 24, 22, 42, 36, glass, seed + 2354, 220);
  rect(t, 25, 23, 41, 26, cyan, seed + 2355, 75);
  for (let y = 26; y <= 35; y += 4) line(t, 25, y, 41 - ((seed + y) & 5), y, 0.8, cyan, seed + y, 195);
  for (let i = 0; i < 11; i++) {
    const x = 25 + Math.floor(noise(i, 92, seed) * 16);
    const y = 24 + Math.floor(noise(i, 93, seed) * 12);
    px(t, x, y, rgba(cyan[0], cyan[1], cyan[2], 160 + ((i & 1) * 55)));
  }
  rect(t, 27, 40, 40, 44, casingLight, seed + 2356, 210);
  for (let x = 24; x <= 43; x += 5) rect(t, x, 49, x + 2, 54, brass, seed + 2357 + x, 220);
  rect(t, 35, 18, 46, 21, red, seed + 2358, 205);
  rect(t, 38, 19, 44, 20, casingLight, seed + 2359, 160);
  line(t, 20, 46, 47, 22, 0.9, rust, seed + 2360, 128);
  ellipse(t, 43, 32, 8, 9, cyan, seed + 2361, 62);
  drawNoiseDust(t, seed + 2362, rust, 9);
  drawNoiseDust(t, seed + 2363, cyan, 10);
  rect(t, 22, 27, 24, 38, bakelite, seed + 2364, 238);
  rect(t, 42, 27, 44, 38, bakelite, seed + 2365, 238);
  rect(t, 47, 24, 50, 38, cyan, seed + 2366, 136);
  rect(t, 25, 41, 42, 42, cyan, seed + 2367, 148);
}

function drawSoundEmitterSprite(t: Uint32Array, seed: number): void {
  const bakelite: [number, number, number] = [18, 26, 26];
  const shell: [number, number, number] = [190, 188, 162];
  const shellLight: [number, number, number] = [232, 224, 188];
  const cyan: [number, number, number] = [76, 232, 204];
  const red: [number, number, number] = [190, 36, 32];
  const brass: [number, number, number] = [204, 166, 82];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 53, 17, 4, [6, 9, 9], seed + 2850, 82);
  rect(t, 17, 20, 49, 48, bakelite, seed + 2851, 248);
  rect(t, 20, 17, 47, 45, shell, seed + 2852, 238);
  outlineRect(t, 17, 20, 49, 48, bakelite);
  clearRect(t, 17, 20, 20, 23);
  clearRect(t, 47, 21, 49, 26);
  clearRect(t, 18, 45, 22, 48);
  rect(t, 23, 22, 44, 34, bakelite, seed + 2853, 238);
  ellipse(t, 34, 31, 12.5, 5.2, cyan, seed + 2864, 112);
  rect(t, 25, 24, 42, 28, shellLight, seed + 2854, 116);
  for (let x = 25; x <= 42; x += 5) rect(t, x, 30, x + 2, 33, cyan, seed + 2855 + x, 230);
  rect(t, 24, 38, 43, 42, red, seed + 2860, 225);
  rect(t, 27, 39, 40, 40, shellLight, seed + 2861, 162);
  line(t, 22, 44, 48, 23, 0.8, rust, seed + 2862, 118);
  for (let x = 21; x <= 45; x += 8) line(t, x, 47, x + 2, 55, 0.9, brass, seed + 2863 + x, 218);
  for (let i = 0; i < 4; i++) {
    arcLine(t, 32, 33, 10 + i * 4, 7 + i * 3, -0.55, 0.55, 0.7, cyan, seed + 2870 + i, 74, 10);
  }
  ellipse(t, 46, 35, 7, 8, cyan, seed + 2875, 74);
  drawNoiseDust(t, seed + 2876, rust, 9);
  drawNoiseDust(t, seed + 2877, cyan, 12);
}

function drawElectronicsSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'sound_emitter') {
    drawSoundEmitterSprite(t, seed);
    return;
  }
  if (defId === 'rail_signal_lamp') {
    drawRailSignalLampSprite(t, seed);
    return;
  }
  if (defId === 'screen_unit') {
    drawScreenUnitSprite(t, seed);
    return;
  }
  if (defId === 'keyboard_unit') {
    drawKeyboardUnitSprite(t, seed);
    return;
  }
  if (defId === 'krona_battery') {
    drawKronaBatterySprite(t, seed);
    return;
  }
  if (defId === 'junior_tech_case') {
    drawJuniorTechCaseSprite(t, seed);
    return;
  }
  if (defId === 'field_radio_battery') {
    drawFieldRadioBatterySprite(t, seed);
    return;
  }
  if (defId === 'contraband_shocker_parts') {
    drawContrabandShockerPartsSprite(t, seed);
    return;
  }
  if (defId === 'plastic_sheet') {
    drawPlasticSheetSprite(t, seed);
    return;
  }
  if (defId === 'portable_siren_key') {
    drawPortableSirenKeySprite(t, seed);
    return;
  }
  if (defId.includes('battery')) {
    rect(t, 23, 17, 41, 49, p.body, seed + 121);
    rect(t, 28, 13, 36, 17, p.light, seed + 122);
  } else {
    rect(t, 18, 20, 46, 48, p.body, seed + 123);
    outlineRect(t, 18, 20, 46, 48, p.dark);
    for (let i = 0; i < 4; i++) line(t, 22, 27 + i * 5, 42, 25 + i * 3, 0.8, p.glow, seed + 124 + i, 185);
  }
  ellipse(t, 32, 33, 4, 4, p.glow, seed + 130, 225);
}

function drawBlueGlowSealedSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [118, 158, 170];
  const glassLight: [number, number, number] = [184, 224, 224];
  const glassDark: [number, number, number] = [22, 38, 48];
  const blue: [number, number, number] = [44, 150, 226];
  const blueLight: [number, number, number] = [104, 220, 252];
  const label: [number, number, number] = [206, 188, 126];
  const seal: [number, number, number] = [174, 42, 54];
  const rust: [number, number, number] = [124, 70, 42];

  ellipse(t, 33, 52, 13, 3, [0, 12, 20], seed + 131, 100);
  rect(t, 28, 8, 37, 13, glassDark, seed + 132, 245);
  rect(t, 26, 12, 40, 17, [70, 88, 90], seed + 133, 230);
  rect(t, 22, 17, 43, 49, glass, seed + 134, 135);
  ellipse(t, 32, 17, 11, 4.5, glassLight, seed + 135, 155);
  ellipse(t, 32, 49, 11, 4, glassDark, seed + 136, 135);
  outlineRect(t, 22, 17, 43, 49, glassDark);

  rect(t, 25, 27, 40, 46, blue, seed + 137, 218);
  ellipse(t, 32, 28, 8, 4, blueLight, seed + 138, 190);
  ellipse(t, 32, 43, 7, 4, [24, 76, 142], seed + 139, 190);
  line(t, 27, 20, 27, 46, 0.8, glassLight, seed + 140, 150);
  line(t, 39, 18, 41, 47, 0.8, glassDark, seed + 141, 135);

  rect(t, 23, 30, 42, 37, label, seed + 142, 238);
  rect(t, 24, 31, 41, 32, glassDark, seed + 143, 150);
  rect(t, 25, 35, 36, 36, seal, seed + 144, 230);
  rect(t, 29, 13, 35, 15, seal, seed + 145, 245);
  ellipse(t, 41, 18, 4, 4, seal, seed + 146, 230);
  line(t, 36, 15, 41, 18, 0.9, glassDark, seed + 147, 180);

  rect(t, 26, 38, 39, 47, blue, seed + 155, 232);
  ellipse(t, 33, 40, 5.6, 3.8, [210, 226, 218], seed + 148, 230);
  ellipse(t, 33, 40, 2.4, 2.4, blueLight, seed + 149, 245);
  line(t, 33, 37, 33, 43, 0.7, [4, 12, 18], seed + 150, 245);

  line(t, 23, 21, 42, 20, 0.8, rust, seed + 151, 135);
  line(t, 24, 47, 40, 48, 0.8, rust, seed + 152, 120);
  drawNoiseDust(t, seed + 153, rust, 9);
  drawNoiseDust(t, seed + 154, blueLight, 11);
  px(t, 22, 18, CLEAR);
  px(t, 23, 18, CLEAR);
  px(t, 42, 48, CLEAR);
  px(t, 43, 47, CLEAR);
}

function drawBlueGlowOpenSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [92, 138, 152];
  const glassLight: [number, number, number] = [174, 218, 220];
  const glassDark: [number, number, number] = [16, 30, 40];
  const blue: [number, number, number] = [38, 132, 214];
  const blueLight: [number, number, number] = [102, 212, 248];
  const label: [number, number, number] = [184, 158, 94];
  const stain: [number, number, number] = [28, 80, 104];
  const rust: [number, number, number] = [126, 66, 38];
  const warning: [number, number, number] = [164, 48, 54];

  ellipse(t, 33, 52, 16, 4, stain, seed + 155, 95);
  rect(t, 22, 22, 43, 49, glass, seed + 156, 126);
  ellipse(t, 32, 22, 11, 4.5, glassDark, seed + 157, 245);
  ellipse(t, 32, 23, 8, 2.4, [6, 14, 22], seed + 158, 250);
  ellipse(t, 32, 49, 11, 4, glassDark, seed + 159, 128);
  outlineRect(t, 22, 22, 43, 49, glassDark);

  rect(t, 24, 35, 40, 48, blue, seed + 160, 214);
  line(t, 25, 35, 39, 33, 1.1, blueLight, seed + 161, 206);
  ellipse(t, 31, 42, 9, 6, blue, seed + 162, 206);
  line(t, 27, 25, 27, 47, 0.8, glassLight, seed + 163, 142);
  line(t, 39, 24, 41, 47, 0.8, glassDark, seed + 164, 145);

  rect(t, 23, 29, 37, 34, label, seed + 165, 224);
  rect(t, 24, 30, 36, 30, glassDark, seed + 166, 130);
  rect(t, 25, 33, 31, 34, warning, seed + 167, 210);
  clearRect(t, 36, 29, 39, 31);

  line(t, 24, 20, 17, 15, 1, glassLight, seed + 168, 210);
  line(t, 38, 20, 47, 16, 1, glassLight, seed + 169, 198);
  line(t, 23, 22, 42, 21, 0.8, rust, seed + 170, 130);
  rect(t, 26, 14, 34, 17, glassDark, seed + 171, 220);
  rect(t, 28, 15, 32, 15, warning, seed + 172, 210);

  ellipse(t, 34, 42, 5.5, 3.6, [212, 226, 216], seed + 173, 225);
  ellipse(t, 34, 42, 2.3, 2.3, blueLight, seed + 174, 242);
  line(t, 34, 39, 34, 45, 0.7, [2, 8, 14], seed + 175, 244);

  ellipse(t, 45, 50, 8, 3, blue, seed + 176, 138);
  line(t, 40, 46, 53, 52, 1.2, blueLight, seed + 177, 126);
  drawNoiseDust(t, seed + 178, rust, 11);
  drawNoiseDust(t, seed + 179, blueLight, 9);
  px(t, 22, 22, CLEAR);
  px(t, 23, 22, CLEAR);
  px(t, 42, 48, CLEAR);
  px(t, 43, 47, CLEAR);
}

function drawBoiledSlimeResidueSprite(t: Uint32Array, seed: number, p: Palette): void {
  const glass: [number, number, number] = [96, 116, 112];
  const glassLight: [number, number, number] = [174, 202, 188];
  const glassDark: [number, number, number] = [28, 38, 38];
  const crust: [number, number, number] = [122, 70, 36];
  const crustDark: [number, number, number] = [48, 28, 22];
  const crustLight: [number, number, number] = [204, 134, 58];
  const label: [number, number, number] = [186, 170, 112];
  const violet: [number, number, number] = [154, 78, 198];
  const acid: [number, number, number] = [112, 228, 92];
  const blue: [number, number, number] = [72, 170, 220];
  const rust: [number, number, number] = [134, 66, 34];

  ellipse(t, 33, 53, 14, 3.5, [0, 0, 0], seed + 155, 92);
  rect(t, 28, 9, 37, 14, glassDark, seed + 156, 245);
  rect(t, 26, 14, 40, 18, [66, 78, 76], seed + 157, 230);
  rect(t, 21, 20, 44, 50, glass, seed + 158, 138);
  ellipse(t, 32, 20, 12, 5, glassLight, seed + 159, 158);
  ellipse(t, 32, 50, 12, 4, glassDark, seed + 160, 150);
  outlineRect(t, 21, 20, 44, 50, glassDark);
  line(t, 25, 21, 24, 48, 0.8, glassLight, seed + 161, 145);
  line(t, 39, 19, 42, 48, 0.8, glassDark, seed + 162, 132);

  rect(t, 24, 36, 41, 47, crust, seed + 163, 228);
  ellipse(t, 32, 37, 9, 4, crustLight, seed + 164, 190);
  ellipse(t, 31, 45, 8, 4, crustDark, seed + 165, 205);
  line(t, 25, 39, 40, 43, 1.2, crustDark, seed + 166, 175);
  line(t, 26, 45, 39, 38, 0.8, crustLight, seed + 167, 135);

  rect(t, 23, 27, 43, 34, label, seed + 168, 236);
  rect(t, 24, 28, 41, 29, glassDark, seed + 169, 150);
  rect(t, 26, 32, 38, 33, rust, seed + 170, 215);
  rect(t, 38, 29, 42, 34, violet, seed + 171, 190);
  rect(t, 29, 14, 36, 16, rust, seed + 172, 235);

  ellipse(t, 33, 40, 5.8, 3.6, [214, 224, 196], seed + 173, 226);
  ellipse(t, 33, 40, 2.3, 2.3, acid, seed + 174, 245);
  line(t, 33, 37, 33, 43, 0.7, [5, 10, 8], seed + 175, 245);
  ellipse(t, 36, 42, 2.6, 1.8, violet, seed + 176, 174);
  line(t, 25, 46, 43, 45, 1, acid, seed + 177, 120);
  line(t, 27, 37, 41, 40, 0.8, blue, seed + 178, 122);
  drawNoiseDust(t, seed + 179, acid, 12);
  drawNoiseDust(t, seed + 180, blue, 8);
  drawNoiseDust(t, seed + 181, rust, 11);
  drawNoiseDust(t, seed + 182, p.accent, 5);

  px(t, 21, 20, CLEAR);
  px(t, 22, 20, CLEAR);
  px(t, 43, 49, CLEAR);
  px(t, 44, 48, CLEAR);
  px(t, 22, 48, rgba(crustDark[0], crustDark[1], crustDark[2], 170));
}

function drawBleachedDocumentSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [134, 166, 164];
  const glassLight: [number, number, number] = [218, 234, 224];
  const glassDark: [number, number, number] = [34, 48, 52];
  const paper: [number, number, number] = [218, 214, 184];
  const paperBleach: [number, number, number] = [236, 238, 216];
  const sand: [number, number, number] = [214, 224, 196];
  const deadInk: [number, number, number] = [70, 72, 62];
  const greenGlow: [number, number, number] = [126, 232, 136];
  const blueGlow: [number, number, number] = [78, 188, 226];
  const violet: [number, number, number] = [146, 78, 188];
  const rust: [number, number, number] = [122, 70, 44];

  ellipse(t, 33, 38, 18, 18, greenGlow, seed + 151, 42);
  ellipse(t, 33, 52, 14, 4, [24, 38, 34], seed + 152, 90);
  rect(t, 27, 9, 38, 14, glassDark, seed + 153, 250);
  rect(t, 25, 13, 40, 18, [78, 88, 82], seed + 154, 238);
  rect(t, 21, 18, 44, 51, glass, seed + 155, 112);
  ellipse(t, 32.5, 18, 12, 5, glassLight, seed + 156, 150);
  ellipse(t, 32.5, 51, 12, 4, glassDark, seed + 157, 120);

  rect(t, 24, 25, 41, 45, paper, seed + 158, 242);
  rect(t, 26, 26, 39, 43, paperBleach, seed + 159, 235);
  clearRect(t, 24, 25, 27, 28);
  clearRect(t, 39, 25, 41, 30);
  clearRect(t, 24, 42, 27, 45);
  line(t, 25, 29, 39, 43, 0.7, sand, seed + 160, 145);
  for (let y = 31; y <= 39; y += 4) rect(t, 28, y, 38 - ((seed + y) & 3), y, deadInk, 0, 68);

  rect(t, 23, 41, 42, 49, sand, seed + 161, 210);
  ellipse(t, 32, 42, 11, 5, paperBleach, seed + 162, 150);
  ellipse(t, 34, 37, 6.2, 4, [220, 232, 214], seed + 163, 230);
  ellipse(t, 34, 37, 2.6, 2.6, greenGlow, seed + 164, 245);
  line(t, 34, 34, 34, 40, 0.7, [18, 34, 28], seed + 165, 235);

  outlineRect(t, 21, 18, 44, 51, glassDark);
  line(t, 26, 19, 26, 48, 0.8, glassLight, seed + 166, 150);
  line(t, 39, 18, 41, 48, 0.8, glassDark, seed + 167, 135);
  rect(t, 23, 28, 43, 32, violet, seed + 168, 118);
  rect(t, 30, 13, 36, 15, violet, seed + 169, 235);
  rect(t, 42, 22, 48, 29, rust, seed + 170, 210);
  rect(t, 43, 24, 47, 25, blueGlow, seed + 171, 190);
  line(t, 23, 48, 41, 49, 0.8, rust, seed + 172, 120);
  drawNoiseDust(t, seed + 173, greenGlow, 18);
  drawNoiseDust(t, seed + 174, blueGlow, 8);
  rect(t, 28, 33, 37, 33, deadInk, 0, 82);
  rect(t, 29, 38, 36, 38, deadInk, 0, 76);
  px(t, 21, 19, CLEAR);
  px(t, 22, 18, CLEAR);
  px(t, 43, 50, CLEAR);
  px(t, 44, 49, CLEAR);
}

function drawCrackedSampleJarSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [104, 138, 134];
  const glassLight: [number, number, number] = [186, 222, 210];
  const glassDark: [number, number, number] = [26, 42, 44];
  const slime: [number, number, number] = [112, 210, 86];
  const violet: [number, number, number] = [156, 82, 190];
  const tape: [number, number, number] = [190, 168, 112];
  const rust: [number, number, number] = [126, 68, 38];
  const stain: [number, number, number] = [38, 78, 62];

  ellipse(t, 33, 53, 14, 3.5, stain, seed + 183, 90);
  rect(t, 28, 8, 37, 13, glassDark, seed + 184, 245);
  rect(t, 26, 13, 40, 17, [70, 82, 78], seed + 185, 232);
  rect(t, 21, 19, 44, 50, glass, seed + 186, 118);
  ellipse(t, 32, 19, 12, 5, glassLight, seed + 187, 146);
  ellipse(t, 32, 50, 12, 4, glassDark, seed + 188, 136);
  outlineRect(t, 21, 19, 44, 50, glassDark);
  line(t, 25, 20, 24, 48, 0.8, glassLight, seed + 189, 145);
  line(t, 39, 18, 42, 48, 0.8, glassDark, seed + 190, 138);

  rect(t, 24, 34, 41, 47, slime, seed + 191, 210);
  ellipse(t, 32, 35, 9, 4.2, [166, 232, 108], seed + 192, 170);
  ellipse(t, 31, 43, 7, 4, violet, seed + 193, 168);
  rect(t, 22, 28, 43, 34, tape, seed + 194, 222);
  rect(t, 24, 30, 40, 31, glassDark, seed + 195, 140);
  rect(t, 28, 14, 37, 16, tape, seed + 196, 230);

  line(t, 36, 20, 30, 31, 0.7, glassLight, seed + 197, 205);
  line(t, 30, 31, 36, 39, 0.7, glassLight, seed + 198, 198);
  line(t, 36, 39, 31, 49, 0.7, glassLight, seed + 199, 185);
  line(t, 24, 44, 43, 47, 1.0, rust, seed + 200, 132);
  ellipse(t, 34, 41, 5.4, 3.3, [218, 226, 198], seed + 201, 218);
  ellipse(t, 34, 41, 2.1, 2.1, slime, seed + 202, 242);
  line(t, 34, 38, 34, 44, 0.7, [4, 10, 7], seed + 203, 238);
  drawNoiseDust(t, seed + 204, rust, 12);
  drawNoiseDust(t, seed + 205, slime, 10);
  px(t, 21, 19, CLEAR);
  px(t, 22, 19, CLEAR);
  px(t, 43, 49, CLEAR);
  px(t, 44, 48, CLEAR);
}

function drawDeactivatedResidueSprite(t: Uint32Array, seed: number): void {
  const tin: [number, number, number] = [88, 98, 94];
  const tinLight: [number, number, number] = [154, 166, 154];
  const tinDark: [number, number, number] = [28, 34, 32];
  const ash: [number, number, number] = [126, 124, 112];
  const ashLight: [number, number, number] = [184, 180, 156];
  const scorch: [number, number, number] = [58, 38, 28];
  const rust: [number, number, number] = [132, 66, 34];
  const deadGlow: [number, number, number] = [82, 142, 116];

  ellipse(t, 33, 52, 16, 4, [10, 11, 10], seed + 206, 88);
  rect(t, 20, 30, 46, 48, tin, seed + 207, 242);
  ellipse(t, 33, 30, 14, 5.4, tinLight, seed + 208, 245);
  ellipse(t, 33, 32, 12, 3.5, ash, seed + 209, 235);
  ellipse(t, 33, 48, 13, 4, tinDark, seed + 210, 155);
  outlineRect(t, 20, 30, 46, 48, tinDark);
  rect(t, 22, 38, 44, 46, ash, seed + 211, 235);
  ellipse(t, 31, 39, 11, 4, ashLight, seed + 212, 140);
  line(t, 23, 41, 44, 35, 1.3, scorch, seed + 213, 165);
  line(t, 24, 46, 42, 42, 0.9, scorch, seed + 214, 145);
  ellipse(t, 34, 38, 4.7, 2.8, ashLight, seed + 215, 190);
  ellipse(t, 34, 38, 1.7, 1.5, deadGlow, seed + 216, 205);
  rect(t, 23, 27, 43, 32, [176, 162, 106], seed + 217, 210);
  rect(t, 25, 29, 39, 30, tinDark, seed + 218, 130);
  rect(t, 40, 31, 48, 36, rust, seed + 219, 155);
  rect(t, 18, 43, 26, 47, rust, seed + 220, 138);
  drawNoiseDust(t, seed + 221, scorch, 18);
  drawNoiseDust(t, seed + 222, deadGlow, 7);
}

function drawFrozenItemShardSprite(t: Uint32Array, seed: number): void {
  const ice: [number, number, number] = [96, 176, 214];
  const iceLight: [number, number, number] = [184, 232, 244];
  const iceDark: [number, number, number] = [34, 76, 94];
  const embedded: [number, number, number] = [40, 42, 38];
  const rust: [number, number, number] = [132, 70, 36];

  ellipse(t, 33, 52, 15, 4, [8, 24, 30], seed + 223, 84);
  ellipse(t, 32, 34, 21, 17, ice, seed + 224, 58);
  line(t, 21, 47, 31, 13, 5.4, iceDark, seed + 225, 188);
  line(t, 23, 45, 32, 15, 3.7, ice, seed + 226, 222);
  line(t, 32, 15, 49, 42, 5.0, iceLight, seed + 227, 178);
  line(t, 22, 45, 49, 42, 4.0, ice, seed + 228, 210);
  line(t, 27, 26, 45, 38, 2.0, iceDark, seed + 229, 160);
  line(t, 28, 16, 22, 46, 0.9, iceLight, seed + 230, 210);
  line(t, 35, 20, 47, 42, 0.9, iceDark, seed + 231, 155);
  line(t, 24, 44, 45, 29, 0.9, iceLight, seed + 232, 170);

  rect(t, 27, 32, 39, 39, embedded, seed + 233, 210);
  line(t, 27, 33, 40, 38, 1.0, rust, seed + 234, 170);
  rect(t, 32, 28, 43, 31, iceLight, seed + 235, 110);
  rect(t, 18, 43, 28, 47, iceDark, seed + 236, 135);
  drawNoiseDust(t, seed + 237, iceLight, 18);
  drawNoiseDust(t, seed + 238, rust, 7);
  clearRect(t, 18, 13, 21, 18);
  clearRect(t, 48, 42, 51, 47);
}

function drawFrozenSlimeCoreSprite(t: Uint32Array, seed: number): void {
  const ice: [number, number, number] = [88, 168, 210];
  const iceLight: [number, number, number] = [180, 232, 238];
  const iceDark: [number, number, number] = [24, 58, 74];
  const slime: [number, number, number] = [82, 188, 94];
  const slimeLight: [number, number, number] = [154, 238, 128];
  const calcified: [number, number, number] = [178, 184, 164];
  const label: [number, number, number] = [188, 168, 112];
  const rust: [number, number, number] = [124, 64, 34];

  ellipse(t, 33, 53, 15, 4, [8, 20, 22], seed + 252, 88);
  rect(t, 28, 9, 37, 14, iceDark, seed + 253, 245);
  rect(t, 25, 15, 41, 19, [66, 92, 96], seed + 254, 224);
  rect(t, 21, 21, 44, 50, ice, seed + 255, 136);
  ellipse(t, 32, 21, 12, 5, iceLight, seed + 256, 152);
  ellipse(t, 32, 50, 12, 4, iceDark, seed + 257, 150);
  outlineRect(t, 21, 21, 44, 50, iceDark);
  line(t, 25, 22, 24, 48, 0.8, iceLight, seed + 258, 154);
  line(t, 39, 20, 42, 48, 0.8, iceDark, seed + 259, 140);

  ellipse(t, 32, 39, 10, 8, slime, seed + 260, 226);
  ellipse(t, 31, 37, 7, 5, slimeLight, seed + 261, 182);
  ellipse(t, 35, 42, 4, 3, calcified, seed + 262, 216);
  ellipse(t, 28, 42, 3, 2.4, iceLight, seed + 263, 160);
  rect(t, 23, 29, 43, 34, label, seed + 264, 226);
  rect(t, 25, 31, 40, 32, iceDark, seed + 265, 135);
  rect(t, 28, 14, 37, 16, rust, seed + 266, 218);
  line(t, 25, 47, 43, 45, 1.0, iceLight, seed + 267, 130);
  line(t, 27, 25, 41, 43, 0.8, iceLight, seed + 268, 150);
  drawNoiseDust(t, seed + 269, slimeLight, 10);
  drawNoiseDust(t, seed + 270, iceLight, 12);
  drawNoiseDust(t, seed + 271, rust, 7);
  px(t, 21, 21, CLEAR);
  px(t, 22, 21, CLEAR);
  px(t, 43, 49, CLEAR);
  px(t, 44, 48, CLEAR);
}

function drawDeconFluidSprite(t: Uint32Array, seed: number): void {
  const plastic: [number, number, number] = [82, 116, 98];
  const plasticLight: [number, number, number] = [152, 194, 156];
  const plasticDark: [number, number, number] = [24, 42, 36];
  const fluid: [number, number, number] = [88, 224, 112];
  const blue: [number, number, number] = [72, 174, 210];
  const label: [number, number, number] = [214, 196, 126];
  const red: [number, number, number] = [178, 44, 38];
  const rust: [number, number, number] = [126, 68, 38];

  ellipse(t, 33, 53, 16, 4, [8, 16, 12], seed + 223, 88);
  rect(t, 28, 10, 39, 18, plasticDark, seed + 224, 248);
  rect(t, 30, 7, 37, 12, plasticLight, seed + 225, 236);
  rect(t, 22, 20, 46, 50, plastic, seed + 226, 246);
  ellipse(t, 34, 20, 13, 5, plasticLight, seed + 227, 235);
  ellipse(t, 34, 50, 12, 4, plasticDark, seed + 228, 160);
  outlineRect(t, 22, 20, 46, 50, plasticDark);
  rect(t, 24, 35, 44, 48, fluid, seed + 229, 210);
  line(t, 24, 35, 44, 33, 1.1, [154, 244, 138], seed + 230, 190);
  rect(t, 24, 27, 43, 34, label, seed + 231, 230);
  rect(t, 26, 29, 41, 30, plasticDark, seed + 232, 140);
  rect(t, 30, 31, 37, 33, red, seed + 233, 210);
  rect(t, 29, 26, 34, 41, red, seed + 234, 236);
  rect(t, 25, 31, 40, 36, red, seed + 235, 236);
  line(t, 25, 22, 25, 48, 0.8, plasticLight, seed + 236, 140);
  line(t, 43, 21, 45, 48, 0.8, plasticDark, seed + 237, 145);
  ellipse(t, 45, 47, 8, 3.5, fluid, seed + 238, 130);
  line(t, 40, 45, 52, 51, 1.1, blue, seed + 239, 124);
  rect(t, 41, 21, 49, 26, rust, seed + 240, 145);
  drawNoiseDust(t, seed + 241, fluid, 16);
  drawNoiseDust(t, seed + 242, blue, 8);
}

function drawGovnyakSprite(t: Uint32Array, seed: number, defId: string): void {
  const paper: [number, number, number] = [172, 150, 96];
  const paperLight: [number, number, number] = [218, 198, 132];
  const paperDark: [number, number, number] = [48, 38, 28];
  const brown: [number, number, number] = [110, 70, 36];
  const brownLight: [number, number, number] = [158, 104, 50];
  const green: [number, number, number] = [72, 132, 74];
  const greenGlow: [number, number, number] = [118, 210, 96];
  const red: [number, number, number] = [176, 42, 36];
  const smoke: [number, number, number] = [158, 166, 138];
  const glass: [number, number, number] = [112, 148, 138];
  const glassLight: [number, number, number] = [184, 220, 202];
  const rust: [number, number, number] = [126, 66, 34];

  if (defId === 'govnyak_sample') {
    rect(t, 28, 10, 37, 17, paperDark, seed + 320, 245);
    rect(t, 30, 16, 35, 22, glassLight, seed + 321, 170);
    rect(t, 22, 21, 43, 51, glass, seed + 322, 150);
    outlineRect(t, 22, 21, 43, 51, paperDark);
    rect(t, 24, 31, 41, 47, green, seed + 323, 214);
    ellipse(t, 33, 39, 8.5, 7, brown, seed + 324, 225);
    rect(t, 24, 29, 41, 36, paper, seed + 325, 225);
    rect(t, 27, 31, 38, 32, paperDark, 0, 130);
    rect(t, 29, 35, 39, 36, red, seed + 326, 205);
    rect(t, 25, 19, 41, 22, red, seed + 327, 218);
    line(t, 24, 23, 41, 49, 0.8, glassLight, seed + 328, 120);
    drawNoiseDust(t, seed + 329, greenGlow, 16);
    drawNoiseDust(t, seed + 330, rust, 7);
    return;
  }

  if (defId === 'govnyak_roll') {
    line(t, 17, 40, 45, 28, 4.3, paper, seed + 331, 245);
    line(t, 20, 39, 43, 29, 2.2, brown, seed + 332, 220);
    ellipse(t, 17, 40, 4.8, 4.0, paperLight, seed + 333, 238);
    ellipse(t, 45, 28, 4.8, 3.6, red, seed + 334, 230);
    ellipse(t, 47, 27, 2.2, 1.8, [226, 126, 54], seed + 335, 190);
    line(t, 24, 35, 35, 31, 0.8, paperDark, seed + 336, 135);
    line(t, 29, 33, 39, 29, 0.8, green, seed + 337, 145);
    line(t, 20, 20, 17, 11, 0.7, smoke, seed + 338, 100);
    line(t, 27, 19, 29, 9, 0.7, smoke, seed + 339, 110);
    line(t, 35, 20, 41, 12, 0.7, smoke, seed + 340, 92);
    drawNoiseDust(t, seed + 341, rust, 7);
    return;
  }

  if (defId === 'govnyak_bad_batch') {
    rect(t, 17, 23, 49, 47, paper, seed + 342, 242);
    rect(t, 20, 18, 45, 27, paperLight, seed + 343, 230);
    outlineRect(t, 17, 23, 49, 47, paperDark);
    clearRect(t, 17, 23, 21, 27);
    clearRect(t, 46, 24, 49, 29);
    clearRect(t, 18, 44, 21, 47);
    rect(t, 22, 29, 43, 43, brown, seed + 344, 238);
    rect(t, 24, 30, 41, 32, brownLight, seed + 345, 140);
    line(t, 19, 43, 47, 27, 1.0, paperDark, seed + 346, 120);
    rect(t, 35, 22, 46, 31, red, seed + 347, 220);
    line(t, 36, 24, 44, 29, 0.8, paperLight, seed + 348, 150);
    line(t, 44, 45, 53, 50, 2.1, greenGlow, seed + 349, 150);
    ellipse(t, 52, 51, 6.5, 3.5, greenGlow, seed + 350, 125);
    line(t, 23, 20, 20, 10, 0.7, smoke, seed + 351, 95);
    line(t, 31, 19, 33, 9, 0.7, smoke, seed + 352, 104);
    drawNoiseDust(t, seed + 353, rust, 11);
    drawNoiseDust(t, seed + 354, red, 8);
    return;
  }

  if (defId === 'govnyak_brick') {
    rect(t, 14, 25, 51, 47, brown, seed + 355, 248);
    rect(t, 17, 22, 48, 31, paper, seed + 356, 226);
    outlineRect(t, 14, 25, 51, 47, paperDark);
    clearRect(t, 14, 25, 18, 28);
    clearRect(t, 48, 25, 51, 30);
    clearRect(t, 15, 44, 19, 47);
    rect(t, 18, 30, 47, 43, brownLight, seed + 357, 188);
    rect(t, 18, 36, 48, 38, green, seed + 358, 180);
    line(t, 17, 43, 49, 28, 1.1, paperDark, seed + 359, 142);
    rect(t, 32, 22, 45, 28, red, seed + 360, 190);
    rect(t, 34, 24, 42, 25, paperLight, seed + 361, 160);
    rect(t, 24, 40, 41, 43, paper, seed + 362, 170);
    drawNoiseDust(t, seed + 363, rust, 12);
    return;
  }

  rect(t, 18, 24, 48, 47, brown, seed + 355, 248);
  rect(t, 21, 20, 45, 28, paper, seed + 356, 238);
  outlineRect(t, 18, 24, 48, 47, paperDark);
  clearRect(t, 18, 24, 21, 27);
  clearRect(t, 46, 25, 48, 30);
  clearRect(t, 19, 44, 22, 47);
  rect(t, 22, 29, 44, 42, brownLight, seed + 357, 120);
  rect(t, 23, 34, 43, 36, green, seed + 358, 148);
  line(t, 21, 43, 45, 29, 1.0, paperDark, seed + 359, 126);
  rect(t, 32, 21, 43, 27, red, seed + 360, 190);
  rect(t, 34, 23, 41, 24, paperLight, seed + 361, 160);
  rect(t, 24, 38, 39, 41, paper, seed + 362, 190);
  drawNoiseDust(t, seed + 363, rust, 12);
}

function drawGasSampleAmpouleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [104, 150, 142];
  const glassLight: [number, number, number] = [188, 232, 212];
  const glassDark: [number, number, number] = [18, 34, 38];
  const gasGreen: [number, number, number] = [104, 230, 92];
  const gasViolet: [number, number, number] = [168, 78, 220];
  const label: [number, number, number] = [202, 184, 118];
  const red: [number, number, number] = [174, 42, 46];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 38, 18, 18, gasViolet, seed + 364, 42);
  ellipse(t, 33, 39, 15, 15, gasGreen, seed + 365, 34);
  ellipse(t, 33, 53, 14, 3.5, [0, 0, 0], seed + 366, 92);
  rect(t, 29, 8, 37, 14, glassDark, seed + 367, 248);
  rect(t, 27, 13, 39, 18, [66, 82, 78], seed + 368, 235);
  rect(t, 23, 19, 43, 50, glass, seed + 369, 132);
  ellipse(t, 33, 19, 10.5, 4.5, glassLight, seed + 370, 150);
  ellipse(t, 33, 50, 10.5, 4, glassDark, seed + 371, 138);
  outlineRect(t, 23, 19, 43, 50, glassDark);

  rect(t, 25, 29, 41, 46, gasGreen, seed + 372, 206);
  ellipse(t, 33, 31, 8.5, 4.8, gasViolet, seed + 373, 170);
  ellipse(t, 35, 40, 6.5, 5.2, [216, 226, 202], seed + 374, 222);
  ellipse(t, 35, 40, 2.7, 2.7, gasViolet, seed + 375, 240);
  line(t, 35, 37, 35, 43, 0.7, [6, 12, 10], seed + 376, 240);
  rect(t, 24, 30, 42, 36, label, seed + 377, 232);
  rect(t, 25, 31, 40, 32, glassDark, 0, 130);
  rect(t, 28, 35, 38, 36, red, seed + 378, 205);
  rect(t, 29, 14, 37, 16, red, seed + 379, 224);
  rect(t, 25, 37, 31, 47, gasGreen, seed + 385, 214);
  rect(t, 38, 37, 41, 47, gasGreen, seed + 386, 206);
  ellipse(t, 31, 42, 6.2, 4.8, gasGreen, seed + 387, 198);
  line(t, 27, 20, 26, 48, 0.8, glassLight, seed + 380, 145);
  line(t, 39, 18, 42, 47, 0.8, glassDark, seed + 381, 135);
  drawNoiseDust(t, seed + 382, gasGreen, 15);
  drawNoiseDust(t, seed + 383, gasViolet, 10);
  drawNoiseDust(t, seed + 384, rust, 8);
  px(t, 23, 19, CLEAR);
  px(t, 24, 19, CLEAR);
  px(t, 42, 49, CLEAR);
  px(t, 43, 48, CLEAR);
}

function drawEmptyGlassAmpouleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [120, 164, 154];
  const glassLight: [number, number, number] = [210, 238, 220];
  const glassDark: [number, number, number] = [28, 48, 48];
  const red: [number, number, number] = [178, 42, 46];
  const label: [number, number, number] = [210, 202, 168];
  const damp: [number, number, number] = [64, 86, 76];
  const rust: [number, number, number] = [126, 70, 40];

  ellipse(t, 32, 52, 12, 3, [10, 14, 12], seed + 385, 74);
  rect(t, 29, 9, 36, 14, glassDark, seed + 386, 238);
  rect(t, 28, 14, 37, 22, glassLight, seed + 387, 118);
  rect(t, 24, 22, 41, 50, glass, seed + 388, 92);
  ellipse(t, 32.5, 22, 9, 4.4, glassLight, seed + 389, 132);
  ellipse(t, 32.5, 50, 9, 3.5, glassDark, seed + 390, 112);
  outlineRect(t, 24, 22, 41, 50, glassDark);
  line(t, 28, 22, 27, 48, 0.8, glassLight, seed + 391, 150);
  line(t, 37, 20, 40, 48, 0.8, glassDark, seed + 392, 130);
  rect(t, 25, 33, 40, 39, label, seed + 393, 212);
  rect(t, 31, 30, 35, 43, red, seed + 394, 220);
  rect(t, 27, 35, 39, 38, red, seed + 395, 220);
  rect(t, 27, 38, 38, 39, damp, seed + 396, 120);
  for (let i = 0; i < 8; i++) {
    const x = 25 + Math.floor(noise(i, 56, seed) * 16);
    const y = 24 + Math.floor(noise(i, 57, seed) * 24);
    px(t, x, y, CLEAR);
  }
  rect(t, 39, 23, 47, 29, glassLight, seed + 397, 110);
  line(t, 39, 23, 47, 29, 0.7, glassDark, seed + 398, 125);
  drawNoiseDust(t, seed + 399, rust, 7);
  px(t, 31, 12, rgba(glassLight[0], glassLight[1], glassLight[2], 165));
  px(t, 27, 45, rgba(glassLight[0], glassLight[1], glassLight[2], 135));
}

function drawEmptySampleJarSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [110, 146, 140];
  const glassLight: [number, number, number] = [206, 232, 214];
  const glassDark: [number, number, number] = [28, 46, 46];
  const cap: [number, number, number] = [70, 76, 70];
  const label: [number, number, number] = [204, 190, 128];
  const red: [number, number, number] = [166, 42, 38];
  const stain: [number, number, number] = [58, 78, 66];
  const rust: [number, number, number] = [124, 68, 40];

  ellipse(t, 33, 52, 13, 3.5, stain, seed + 400, 82);
  rect(t, 27, 10, 38, 15, glassDark, seed + 401, 235);
  rect(t, 25, 14, 40, 19, cap, seed + 402, 238);
  rect(t, 22, 21, 44, 50, glass, seed + 403, 96);
  ellipse(t, 33, 21, 12, 5, glassLight, seed + 404, 132);
  ellipse(t, 33, 50, 12, 4, glassDark, seed + 405, 115);
  outlineRect(t, 22, 21, 44, 50, glassDark);
  line(t, 27, 22, 26, 48, 0.8, glassLight, seed + 406, 155);
  line(t, 39, 20, 42, 48, 0.8, glassDark, seed + 407, 132);
  rect(t, 24, 31, 42, 38, label, seed + 408, 226);
  rect(t, 25, 32, 40, 33, glassDark, 0, 125);
  rect(t, 27, 36, 36, 37, red, seed + 409, 188);
  line(t, 25, 43, 41, 41, 0.8, glassLight, seed + 410, 112);
  ellipse(t, 34, 44, 4.5, 2.4, [212, 224, 204], seed + 411, 74);
  for (let i = 0; i < 8; i++) {
    const x = 24 + Math.floor(noise(i, 58, seed) * 18);
    const y = 23 + Math.floor(noise(i, 59, seed) * 24);
    px(t, x, y, CLEAR);
  }
  drawNoiseDust(t, seed + 412, rust, 7);
  px(t, 31, 12, rgba(glassLight[0], glassLight[1], glassLight[2], 170));
  px(t, 27, 45, rgba(glassLight[0], glassLight[1], glassLight[2], 145));
  px(t, 22, 21, CLEAR);
  px(t, 23, 21, CLEAR);
}

function drawFibrousCapsuleCutSprite(t: Uint32Array, seed: number): void {
  const meat: [number, number, number] = [126, 50, 48];
  const meatDark: [number, number, number] = [54, 24, 24];
  const fiber: [number, number, number] = [206, 128, 106];
  const membrane: [number, number, number] = [168, 92, 146];
  const violet: [number, number, number] = [154, 74, 214];
  const blue: [number, number, number] = [68, 156, 220];
  const green: [number, number, number] = [98, 216, 112];
  const paper: [number, number, number] = [184, 168, 112];
  const rust: [number, number, number] = [128, 64, 36];

  ellipse(t, 33, 51, 18, 4, [14, 10, 12], seed + 413, 90);
  ellipse(t, 32, 34, 20, 15, violet, seed + 414, 42);
  ellipse(t, 32, 35, 17, 12, meatDark, seed + 415, 248);
  ellipse(t, 33, 34, 15, 10, meat, seed + 416, 252);
  ellipse(t, 33, 34, 10, 6.5, membrane, seed + 417, 232);
  ellipse(t, 34, 34, 5.8, 3.8, [226, 210, 188], seed + 418, 224);
  ellipse(t, 34, 34, 2.7, 2.7, violet, seed + 419, 242);
  line(t, 34, 31, 34, 37, 0.7, [8, 6, 10], seed + 420, 244);
  for (let i = 0; i < 6; i++) {
    const y = 27 + i * 3;
    line(t, 20 + (i & 1), y, 45 - (i & 1) * 2, y + ((i & 1) ? 3 : -2), 0.8, fiber, seed + 421 + i, 135);
  }
  line(t, 18, 39, 47, 28, 1.0, green, seed + 428, 130);
  line(t, 22, 44, 47, 39, 0.9, blue, seed + 429, 118);
  rect(t, 42, 42, 52, 48, paper, seed + 430, 205);
  rect(t, 44, 44, 50, 45, meatDark, 0, 130);
  rect(t, 18, 23, 26, 26, rust, seed + 431, 160);
  drawNoiseDust(t, seed + 432, green, 9);
  drawNoiseDust(t, seed + 433, blue, 8);
  drawNoiseDust(t, seed + 434, rust, 10);
}

function drawOverexposedPhotoSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [232, 226, 198];
  const white: [number, number, number] = [246, 246, 226];
  const black: [number, number, number] = [20, 24, 26];
  const blue: [number, number, number] = [122, 190, 224];
  const violet: [number, number, number] = [152, 100, 206];
  const grey: [number, number, number] = [92, 106, 110];
  const rust: [number, number, number] = [118, 62, 38];

  rect(t, 14, 13, 51, 53, paper, seed + 1340, 248);
  rect(t, 17, 16, 48, 43, white, seed + 1341, 244);
  outlineRect(t, 14, 13, 51, 53, black);
  clearRect(t, 14, 13, 18, 16);
  clearRect(t, 49, 14, 51, 19);
  clearRect(t, 15, 50, 18, 53);
  ellipse(t, 32, 30, 17, 13, white, seed + 1342, 190);
  ellipse(t, 34, 30, 12, 8, blue, seed + 1343, 55);
  ellipse(t, 28, 34, 9, 6, violet, seed + 1344, 60);
  line(t, 20, 37, 45, 24, 0.9, grey, seed + 1345, 105);
  line(t, 22, 25, 46, 38, 0.8, blue, seed + 1346, 130);
  rect(t, 18, 45, 44, 49, grey, seed + 1347, 95);
  rect(t, 19, 46, 32, 47, black, 0, 85);
  line(t, 15, 51, 49, 18, 0.8, violet, seed + 1348, 118);
  for (let i = 0; i < 11; i++) {
    const x = 18 + Math.floor(noise(i, 77, seed) * 28);
    const y = 19 + Math.floor(noise(i, 78, seed) * 22);
    px(t, x, y, rgba(255, 255, 235, 210));
  }
  drawNoiseDust(t, seed + 1349, rust, 9);
  drawNoiseDust(t, seed + 1350, blue, 12);
}

function drawLimeBucketSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [96, 106, 98];
  const metalDark: [number, number, number] = [34, 42, 40];
  const metalLight: [number, number, number] = [164, 174, 158];
  const lime: [number, number, number] = [218, 224, 190];
  const limeGlow: [number, number, number] = [132, 224, 126];
  const red: [number, number, number] = [176, 38, 34];
  const rust: [number, number, number] = [126, 66, 36];
  const damp: [number, number, number] = [58, 78, 62];

  ellipse(t, 32, 52, 17, 4.2, [10, 12, 10], seed + 1351, 84);
  ellipse(t, 32, 22, 17, 6.4, metalDark, seed + 1352, 238);
  rect(t, 17, 22, 47, 49, metal, seed + 1353, 246);
  ellipse(t, 32, 49, 15, 5.4, metalDark, seed + 1354, 140);
  outlineRect(t, 17, 22, 47, 49, metalDark);
  clearRect(t, 17, 22, 21, 25);
  clearRect(t, 44, 22, 47, 26);
  rect(t, 20, 25, 44, 32, lime, seed + 1355, 246);
  ellipse(t, 32, 29, 13.5, 5.5, lime, seed + 1356, 242);
  ellipse(t, 34, 29, 8, 3.2, limeGlow, seed + 1357, 106);
  line(t, 21, 24, 43, 24, 1.0, metalLight, seed + 1358, 178);
  line(t, 21, 47, 46, 24, 0.9, rust, seed + 1359, 135);

  line(t, 18, 23, 24, 12, 1.8, metalLight, seed + 1360, 225);
  line(t, 24, 12, 40, 12, 1.6, metalLight, seed + 1361, 225);
  line(t, 40, 12, 46, 23, 1.8, metalLight, seed + 1362, 225);
  rect(t, 34, 36, 45, 43, red, seed + 1363, 205);
  rect(t, 36, 38, 43, 39, lime, seed + 1364, 170);
  ellipse(t, 20, 45, 7.5, 3.5, damp, seed + 1365, 122);
  drawNoiseDust(t, seed + 1366, limeGlow, 26);
  drawNoiseDust(t, seed + 1367, rust, 12);
}

function drawZincSlimeBucketSprite(t: Uint32Array, seed: number): void {
  const zinc: [number, number, number] = [104, 120, 118];
  const zincDark: [number, number, number] = [30, 40, 42];
  const zincLight: [number, number, number] = [178, 194, 184];
  const slime: [number, number, number] = [70, 206, 122];
  const glow: [number, number, number] = [126, 116, 230];
  const seal: [number, number, number] = [184, 38, 42];
  const yellow: [number, number, number] = [216, 158, 48];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 32, 52, 18, 4.2, [8, 10, 10], seed + 3090, 84);
  ellipse(t, 32, 21, 18, 6.6, zincDark, seed + 3091, 240);
  rect(t, 16, 22, 48, 50, zinc, seed + 3092, 246);
  ellipse(t, 32, 50, 16, 5.4, zincDark, seed + 3093, 145);
  outlineRect(t, 16, 22, 48, 50, zincDark);
  clearRect(t, 16, 22, 20, 25);
  clearRect(t, 45, 22, 48, 26);
  ellipse(t, 32, 25, 14, 5, slime, seed + 3094, 235);
  ellipse(t, 34, 24, 8.5, 3.2, glow, seed + 3095, 102);
  rect(t, 20, 27, 45, 34, slime, seed + 3096, 224);
  line(t, 20, 23, 25, 12, 1.9, zincLight, seed + 3097, 225);
  line(t, 25, 12, 41, 12, 1.7, zincLight, seed + 3098, 225);
  line(t, 41, 12, 47, 23, 1.9, zincLight, seed + 3099, 225);
  rect(t, 33, 36, 46, 44, seal, seed + 3100, 215);
  rect(t, 35, 38, 44, 39, yellow, seed + 3101, 182);
  line(t, 19, 47, 47, 25, 0.9, rust, seed + 3102, 140);
  ellipse(t, 20, 45, 6.8, 3.2, glow, seed + 3103, 86);
  drawNoiseDust(t, seed + 3104, glow, 15);
  drawNoiseDust(t, seed + 3105, slime, 16);
  drawNoiseDust(t, seed + 3106, rust, 11);
}

function drawMutantTissueSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [92, 142, 140];
  const glassLight: [number, number, number] = [198, 230, 214];
  const glassDark: [number, number, number] = [24, 42, 44];
  const tissue: [number, number, number] = [142, 46, 66];
  const tissueLight: [number, number, number] = [206, 78, 96];
  const violet: [number, number, number] = [132, 68, 174];
  const acid: [number, number, number] = [118, 220, 92];
  const paper: [number, number, number] = [198, 184, 124];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 37, 18, 18, acid, seed + 1368, 34);
  ellipse(t, 33, 53, 15, 4, [10, 14, 12], seed + 1369, 86);
  rect(t, 27, 9, 38, 14, glassDark, seed + 1370, 245);
  rect(t, 24, 14, 41, 19, [70, 82, 78], seed + 1371, 235);
  rect(t, 20, 19, 45, 51, glass, seed + 1372, 116);
  ellipse(t, 32.5, 19, 12.5, 5, glassLight, seed + 1373, 152);
  ellipse(t, 32.5, 51, 12.5, 4, glassDark, seed + 1374, 132);
  outlineRect(t, 20, 19, 45, 51, glassDark);
  line(t, 24, 20, 23, 48, 0.8, glassLight, seed + 1375, 140);
  line(t, 39, 19, 42, 48, 0.8, glassDark, seed + 1376, 132);

  rect(t, 23, 35, 42, 47, tissue, seed + 1377, 220);
  ellipse(t, 32, 36, 10, 4.5, tissueLight, seed + 1378, 182);
  ellipse(t, 29, 43, 6.4, 3.8, violet, seed + 1379, 175);
  ellipse(t, 36, 42, 6.2, 4.0, tissueLight, seed + 1380, 186);
  line(t, 24, 41, 42, 37, 1.0, [84, 28, 48], seed + 1381, 170);

  rect(t, 22, 27, 43, 34, paper, seed + 1382, 224);
  rect(t, 24, 29, 39, 30, glassDark, seed + 1383, 140);
  rect(t, 30, 14, 37, 16, rust, seed + 1384, 226);
  ellipse(t, 35, 41, 5.8, 3.7, [218, 224, 196], seed + 1385, 225);
  ellipse(t, 35, 41, 2.2, 2.2, acid, seed + 1386, 245);
  line(t, 35, 38, 35, 44, 0.7, [6, 12, 8], seed + 1387, 240);
  line(t, 24, 48, 42, 49, 1.0, acid, seed + 1388, 118);
  rect(t, 42, 31, 49, 37, rust, seed + 1389, 165);
  drawNoiseDust(t, seed + 1390, acid, 12);
  drawNoiseDust(t, seed + 1391, tissueLight, 8);
  drawNoiseDust(t, seed + 1392, rust, 10);
}

function drawSealedVeretarSandSprite(t: Uint32Array, seed: number): void {
  const pouch: [number, number, number] = [116, 158, 158];
  const pouchLight: [number, number, number] = [212, 232, 218];
  const pouchDark: [number, number, number] = [24, 42, 44];
  const sand: [number, number, number] = [220, 224, 198];
  const sandLight: [number, number, number] = [246, 246, 224];
  const seal: [number, number, number] = [72, 100, 92];
  const red: [number, number, number] = [178, 42, 38];
  const cyan: [number, number, number] = [82, 198, 214];
  const rust: [number, number, number] = [122, 70, 44];

  ellipse(t, 33, 53, 15, 3.5, [8, 12, 12], seed + 2364, 82);
  rect(t, 18, 17, 47, 50, pouch, seed + 2365, 118);
  rect(t, 20, 14, 45, 21, pouchLight, seed + 2366, 160);
  outlineRect(t, 18, 17, 47, 50, pouchDark);
  clearRect(t, 18, 17, 22, 20);
  clearRect(t, 45, 18, 47, 24);
  clearRect(t, 19, 47, 23, 50);
  rect(t, 21, 35, 44, 48, sand, seed + 2367, 235);
  ellipse(t, 32, 35, 12, 5, sandLight, seed + 2368, 178);
  ellipse(t, 33, 40, 13, 7, sand, seed + 2369, 225);
  line(t, 20, 31, 45, 29, 1.1, sandLight, seed + 2370, 120);
  line(t, 22, 18, 21, 48, 0.8, pouchLight, seed + 2371, 145);
  line(t, 43, 18, 46, 48, 0.8, pouchDark, seed + 2372, 132);
  rect(t, 21, 22, 45, 28, seal, seed + 2373, 210);
  rect(t, 24, 24, 40, 25, pouchDark, seed + 2374, 138);
  rect(t, 29, 14, 37, 17, red, seed + 2375, 220);
  rect(t, 39, 27, 47, 34, rust, seed + 2376, 150);
  ellipse(t, 34, 39, 5.5, 3.5, sandLight, seed + 2377, 225);
  ellipse(t, 34, 39, 2.2, 2.2, cyan, seed + 2378, 210);
  line(t, 34, 36, 34, 42, 0.7, pouchDark, seed + 2379, 210);
  drawNoiseDust(t, seed + 2380, sandLight, 18);
  drawNoiseDust(t, seed + 2381, cyan, 9);
  drawNoiseDust(t, seed + 2382, rust, 8);
}

function drawVeretarSandSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [126, 124, 108];
  const paperLight: [number, number, number] = [194, 188, 150];
  const paperDark: [number, number, number] = [52, 54, 48];
  const sand: [number, number, number] = [222, 224, 200];
  const sandLight: [number, number, number] = [248, 248, 226];
  const cyan: [number, number, number] = [86, 206, 222];
  const violet: [number, number, number] = [140, 92, 206];
  const red: [number, number, number] = [176, 42, 38];
  const rust: [number, number, number] = [122, 70, 44];

  ellipse(t, 33, 53, 17, 4, [8, 10, 10], seed + 3110, 82);
  rect(t, 18, 23, 46, 50, paper, seed + 3111, 238);
  rect(t, 20, 19, 44, 28, paperLight, seed + 3112, 216);
  outlineRect(t, 18, 23, 46, 50, paperDark);
  clearRect(t, 18, 23, 22, 27);
  clearRect(t, 43, 20, 46, 29);
  clearRect(t, 19, 47, 23, 50);
  rect(t, 20, 34, 45, 48, sand, seed + 3113, 240);
  ellipse(t, 32, 34, 13, 5, sandLight, seed + 3114, 190);
  ellipse(t, 31, 43, 14, 7, sand, seed + 3115, 230);
  line(t, 21, 31, 45, 28, 1.0, sandLight, seed + 3116, 130);
  line(t, 17, 49, 51, 45, 2.4, sand, seed + 3117, 210);
  ellipse(t, 50, 45, 7.5, 3.5, sandLight, seed + 3118, 175);
  for (let i = 0; i < 18; i++) {
    const x = 20 + Math.floor(noise(i, 95, seed) * 31);
    const y = 30 + Math.floor(noise(i, 96, seed) * 18);
    ellipse(t, x, y, 0.9, 0.8, (i & 1) === 0 ? sandLight : sand, seed + 3119 + i, 150);
  }
  ellipse(t, 35, 39, 5.8, 3.6, sandLight, seed + 3140, 224);
  ellipse(t, 35, 39, 2.3, 2.2, cyan, seed + 3141, 205);
  line(t, 35, 36, 35, 42, 0.7, paperDark, seed + 3142, 205);
  rect(t, 22, 23, 42, 29, [74, 96, 88], seed + 3143, 155);
  rect(t, 24, 25, 38, 26, paperDark, seed + 3144, 110);
  rect(t, 38, 28, 48, 34, red, seed + 3145, 155);
  line(t, 20, 47, 45, 24, 0.8, rust, seed + 3146, 120);
  drawNoiseDust(t, seed + 3147, cyan, 10);
  drawNoiseDust(t, seed + 3148, violet, 5);
  drawNoiseDust(t, seed + 3149, rust, 8);
}

function drawSampleCorkSealSprite(t: Uint32Array, seed: number): void {
  const cork: [number, number, number] = [150, 110, 62];
  const corkLight: [number, number, number] = [214, 168, 92];
  const corkDark: [number, number, number] = [72, 50, 28];
  const wax: [number, number, number] = [166, 34, 36];
  const waxLight: [number, number, number] = [226, 72, 58];
  const glass: [number, number, number] = [106, 154, 144];
  const glassLight: [number, number, number] = [194, 232, 210];
  const green: [number, number, number] = [94, 190, 116];
  const grime: [number, number, number] = [44, 58, 46];

  ellipse(t, 32, 52, 14, 3.5, [10, 12, 10], seed + 2383, 78);
  rect(t, 23, 21, 42, 50, glass, seed + 2384, 74);
  ellipse(t, 32, 21, 10, 4, glassLight, seed + 2385, 105);
  outlineRect(t, 23, 21, 42, 50, grime);
  line(t, 26, 23, 25, 47, 0.8, glassLight, seed + 2386, 112);
  rect(t, 26, 36, 39, 47, green, seed + 2387, 138);
  ellipse(t, 32, 38, 7, 3.5, [150, 228, 136], seed + 2388, 100);
  rect(t, 22, 15, 43, 28, cork, seed + 2389, 248);
  ellipse(t, 32, 15, 11, 4.5, corkLight, seed + 2390, 245);
  ellipse(t, 32, 28, 10.5, 4, corkDark, seed + 2391, 165);
  outlineRect(t, 22, 15, 43, 28, corkDark);
  rect(t, 20, 27, 45, 33, wax, seed + 2392, 236);
  ellipse(t, 32, 30, 13, 4.3, waxLight, seed + 2393, 188);
  rect(t, 25, 29, 39, 31, corkDark, 0, 115);
  line(t, 24, 18, 40, 25, 0.8, corkDark, seed + 2394, 120);
  line(t, 27, 15, 35, 28, 0.7, corkDark, seed + 2395, 108);
  ellipse(t, 43, 34, 5, 3, wax, seed + 2396, 142);
  drawNoiseDust(t, seed + 2397, corkDark, 13);
  drawNoiseDust(t, seed + 2398, green, 7);
  px(t, 23, 21, CLEAR);
  px(t, 42, 49, CLEAR);
}

function drawSilverSlimeSampleSprite(t: Uint32Array, seed: number, opened: boolean): void {
  const glass: [number, number, number] = [104, 150, 148];
  const glassLight: [number, number, number] = [210, 236, 220];
  const glassDark: [number, number, number] = [22, 38, 40];
  const silver: [number, number, number] = [196, 206, 196];
  const silverDark: [number, number, number] = [96, 104, 104];
  const slime: [number, number, number] = [204, 218, 202];
  const slimeGlow: [number, number, number] = [230, 242, 218];
  const seal: [number, number, number] = opened ? [118, 58, 44] : [172, 38, 42];
  const label: [number, number, number] = [206, 190, 128];
  const rust: [number, number, number] = [126, 70, 44];

  ellipse(t, 33, 53, 15, 3.5, [8, 10, 10], seed + 2543, 80);
  ellipse(t, 34, 35, 21, 18, slimeGlow, seed + 2544, opened ? 26 : 34);
  rect(t, 21, 18, 44, 50, glass, seed + 2545, opened ? 88 : 108);
  ellipse(t, 32.5, 18, 11.5, 4.2, glassLight, seed + 2546, opened ? 96 : 134);
  outlineRect(t, 21, 18, 44, 50, glassDark);
  line(t, 25, 20, 24, 48, 0.8, glassLight, seed + 2547, 135);
  line(t, 42, 21, 44, 48, 0.8, glassDark, seed + 2548, 130);

  rect(t, 24, opened ? 35 : 31, 41, 47, slime, seed + 2549, opened ? 170 : 206);
  ellipse(t, 32, opened ? 35 : 31, 9.5, 4.3, slimeGlow, seed + 2550, opened ? 170 : 218);
  ellipse(t, 33, 40, 7.4, 4.6, silver, seed + 2551, opened ? 168 : 198);
  line(t, 25, 45, 42, 40, 1.0, slimeGlow, seed + 2552, 115);

  rect(t, 22, 13, 43, 20, opened ? glassDark : silverDark, seed + 2553, 238);
  if (opened) {
    clearRect(t, 27, 12, 37, 17);
    rect(t, 20, 15, 27, 20, glassLight, seed + 2554, 178);
    rect(t, 37, 13, 46, 18, glassLight, seed + 2555, 152);
    ellipse(t, 46, 47, 7.2, 3.4, slime, seed + 2556, 122);
    line(t, 39, 45, 53, 49, 1.1, slimeGlow, seed + 2557, 118);
    rect(t, 39, 23, 48, 28, rust, seed + 2558, 160);
  } else {
    rect(t, 20, 19, 45, 25, silver, seed + 2554, 225);
    rect(t, 25, 21, 40, 22, glassDark, 0, 118);
    rect(t, 29, 10, 37, 15, seal, seed + 2555, 232);
    rect(t, 38, 18, 47, 22, seal, seed + 2556, 204);
  }
  rect(t, 23, 27, 42, 34, label, seed + 2559, 210);
  rect(t, 26, 29, 38, 30, glassDark, seed + 2560, 132);
  rect(t, 35, 32, 42, 33, seal, seed + 2561, 168);
  ellipse(t, 34, 40, 5.4, 3.2, slimeGlow, seed + 2562, 212);
  ellipse(t, 34, 40, 1.8, 1.8, silverDark, seed + 2563, 210);
  line(t, 34, 38, 34, 42, 0.65, glassDark, seed + 2564, 205);
  drawNoiseDust(t, seed + 2565, slimeGlow, opened ? 16 : 10);
  drawNoiseDust(t, seed + 2566, rust, opened ? 13 : 8);
  px(t, 21, 18, CLEAR);
  px(t, 44, 49, CLEAR);
}

function drawWhiteSlimeSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [146, 166, 162];
  const glassLight: [number, number, number] = [232, 236, 218];
  const glassDark: [number, number, number] = [34, 44, 44];
  const white: [number, number, number] = [226, 226, 204];
  const whiteShade: [number, number, number] = [170, 178, 164];
  const violet: [number, number, number] = [132, 82, 178];
  const red: [number, number, number] = [174, 42, 42];
  const label: [number, number, number] = [198, 184, 126];
  const rust: [number, number, number] = [122, 68, 44];

  ellipse(t, 32, 53, 14, 3.5, [8, 10, 10], seed + 2580, 78);
  ellipse(t, 32, 34, 20, 18, white, seed + 2581, 28);
  rect(t, 24, 13, 41, 50, glass, seed + 2582, 92);
  ellipse(t, 32.5, 13, 8.5, 3.8, glassLight, seed + 2583, 125);
  outlineRect(t, 24, 13, 41, 50, glassDark);
  line(t, 28, 15, 27, 47, 0.8, glassLight, seed + 2584, 124);
  line(t, 39, 16, 41, 47, 0.8, glassDark, seed + 2585, 120);
  rect(t, 27, 31, 39, 47, white, seed + 2586, 238);
  ellipse(t, 33, 31, 6.5, 3.7, glassLight, seed + 2587, 196);
  ellipse(t, 31, 39, 5.2, 5.0, whiteShade, seed + 2588, 150);
  rect(t, 23, 22, 42, 29, label, seed + 2589, 210);
  rect(t, 26, 24, 37, 25, glassDark, seed + 2590, 126);
  rect(t, 23, 11, 42, 16, glassDark, seed + 2591, 238);
  rect(t, 27, 9, 38, 12, whiteShade, seed + 2592, 222);
  ellipse(t, 33, 38, 5.8, 3.5, glassLight, seed + 2593, 220);
  ellipse(t, 33, 38, 2.2, 2.2, violet, seed + 2594, 220);
  line(t, 28, 33, 40, 45, 1.2, red, seed + 2595, 205);
  line(t, 40, 33, 28, 45, 1.2, red, seed + 2596, 205);
  line(t, 20, 48, 43, 27, 0.8, rust, seed + 2597, 128);
  drawNoiseDust(t, seed + 2598, white, 18);
  drawNoiseDust(t, seed + 2599, violet, 8);
}

function drawSlimeScraperSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [132, 138, 126];
  const metalLight: [number, number, number] = [206, 208, 180];
  const metalDark: [number, number, number] = [38, 46, 44];
  const handle: [number, number, number] = [52, 58, 52];
  const tape: [number, number, number] = [210, 154, 46];
  const red: [number, number, number] = [170, 42, 36];
  const slime: [number, number, number] = [102, 62, 38];
  const slimeLight: [number, number, number] = [166, 110, 54];
  const reagent: [number, number, number] = [92, 190, 128];

  ellipse(t, 32, 53, 17, 4, [8, 9, 8], seed + 2600, 82);
  line(t, 18, 49, 41, 24, 5.6, metalDark, seed + 2601, 245);
  line(t, 20, 48, 41, 25, 3.6, handle, seed + 2602, 238);
  line(t, 24, 43, 38, 28, 0.9, metalLight, seed + 2603, 130);
  rect(t, 18, 44, 31, 51, handle, seed + 2604, 238);
  rect(t, 21, 45, 29, 47, tape, seed + 2605, 218);
  rect(t, 24, 47, 31, 49, red, seed + 2606, 178);

  line(t, 37, 26, 53, 14, 8.0, metalDark, seed + 2607, 245);
  line(t, 38, 26, 52, 15, 5.4, metal, seed + 2608, 248);
  line(t, 40, 24, 52, 15, 1.3, metalLight, seed + 2609, 220);
  line(t, 34, 29, 49, 19, 1.1, metalDark, seed + 2610, 150);
  rect(t, 41, 22, 55, 28, metal, seed + 2611, 230);
  line(t, 43, 24, 56, 28, 0.8, metalLight, seed + 2612, 160);
  ellipse(t, 46, 31, 7.6, 4.0, slime, seed + 2613, 190);
  line(t, 37, 31, 54, 35, 1.2, slimeLight, seed + 2614, 155);
  ellipse(t, 30, 45, 5.5, 3.5, slime, seed + 2615, 128);
  line(t, 33, 41, 49, 30, 0.9, reagent, seed + 2616, 118);
  drawNoiseDust(t, seed + 2617, slimeLight, 12);
  drawNoiseDust(t, seed + 2618, metalLight, 8);
}

function drawSlimeSenseNodeSprite(t: Uint32Array, seed: number): void {
  const dish: [number, number, number] = [96, 122, 118];
  const dishLight: [number, number, number] = [188, 218, 200];
  const dishDark: [number, number, number] = [22, 34, 34];
  const organ: [number, number, number] = [142, 84, 112];
  const organLight: [number, number, number] = [218, 132, 150];
  const slime: [number, number, number] = [104, 190, 128];
  const cyan: [number, number, number] = [84, 210, 210];
  const label: [number, number, number] = [198, 184, 120];
  const rust: [number, number, number] = [122, 66, 42];

  ellipse(t, 33, 53, 16, 4, [8, 10, 10], seed + 2620, 84);
  ellipse(t, 32, 37, 21, 16, cyan, seed + 2621, 28);
  rect(t, 19, 30, 47, 49, dish, seed + 2622, 132);
  ellipse(t, 33, 30, 15, 6, dishLight, seed + 2623, 170);
  ellipse(t, 33, 49, 14, 4, dishDark, seed + 2624, 126);
  outlineRect(t, 19, 30, 47, 49, dishDark);
  clearRect(t, 19, 30, 22, 33);
  clearRect(t, 45, 31, 47, 36);

  ellipse(t, 33, 35, 12, 8, organ, seed + 2625, 235);
  ellipse(t, 30, 34, 5.5, 4.4, organLight, seed + 2626, 205);
  ellipse(t, 38, 38, 6.0, 4.8, organ, seed + 2627, 230);
  line(t, 24, 38, 42, 32, 1.0, [82, 42, 72], seed + 2628, 170);
  line(t, 25, 41, 45, 43, 1.1, slime, seed + 2629, 150);
  ellipse(t, 33, 35, 5.4, 3.2, [224, 214, 190], seed + 2630, 222);
  ellipse(t, 33, 35, 2.2, 1.5, dishDark, seed + 2631, 225);
  line(t, 29, 35, 37, 35, 0.8, dishDark, seed + 2632, 210);

  rect(t, 38, 22, 50, 29, label, seed + 2633, 220);
  rect(t, 40, 24, 47, 25, dishDark, 0, 128);
  rect(t, 43, 27, 50, 28, organLight, seed + 2634, 156);
  for (let i = 0; i < 4; i++) {
    arcLine(t, 33, 35, 14 + i * 3, 8 + i * 2, -0.6, 0.9, 0.55, cyan, seed + 2635 + i, 92, 7);
  }
  drawNoiseDust(t, seed + 2640, slime, 12);
  drawNoiseDust(t, seed + 2641, rust, 8);
}

function drawRedMoldSampleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [94, 150, 146];
  const glassLight: [number, number, number] = [194, 232, 210];
  const glassDark: [number, number, number] = [28, 44, 44];
  const mold: [number, number, number] = [152, 30, 36];
  const moldLight: [number, number, number] = [218, 62, 54];
  const glow: [number, number, number] = [82, 214, 150];
  const violet: [number, number, number] = [146, 82, 188];
  const label: [number, number, number] = [218, 194, 130];
  const rust: [number, number, number] = [128, 66, 38];

  ellipse(t, 32, 52, 15, 3.5, [8, 10, 10], seed + 2522, 80);
  rect(t, 22, 18, 43, 50, glass, seed + 2523, 70);
  ellipse(t, 32.5, 18, 10.5, 4.2, glassLight, seed + 2524, 105);
  outlineRect(t, 22, 18, 43, 50, glassDark);
  line(t, 25, 20, 24, 48, 0.8, glassLight, seed + 2525, 115);
  line(t, 41, 22, 42, 47, 0.8, glassDark, seed + 2526, 128);
  rect(t, 24, 33, 41, 47, mold, seed + 2527, 198);
  ellipse(t, 31, 35, 8.8, 5.6, moldLight, seed + 2528, 215);
  ellipse(t, 35, 42, 6.8, 4.8, mold, seed + 2529, 232);
  ellipse(t, 28, 42, 4.5, 3.2, violet, seed + 2530, 126);
  ellipse(t, 34, 39, 5.8, 3.7, [224, 220, 184], seed + 2531, 224);
  ellipse(t, 34, 39, 2.2, 2.2, glow, seed + 2532, 240);
  line(t, 34, 36, 34, 42, 0.7, glassDark, seed + 2533, 230);
  rect(t, 21, 13, 44, 21, rust, seed + 2534, 236);
  ellipse(t, 32.5, 13, 11.5, 3.8, [182, 132, 58], seed + 2535, 232);
  rect(t, 22, 27, 43, 33, label, seed + 2536, 205);
  rect(t, 26, 29, 37, 30, glassDark, seed + 2537, 138);
  rect(t, 40, 34, 49, 40, moldLight, seed + 2538, 126);
  ellipse(t, 47, 42, 5.8, 2.8, glow, seed + 2539, 82);
  drawNoiseDust(t, seed + 2540, moldLight, 13);
  drawNoiseDust(t, seed + 2541, glow, 8);
  drawNoiseDust(t, seed + 2542, rust, 9);
  px(t, 22, 18, CLEAR);
  px(t, 43, 49, CLEAR);
}

function drawZhelemishSampleSprite(t: Uint32Array, seed: number, sealed: boolean): void {
  const glass: [number, number, number] = [92, 144, 138];
  const glassLight: [number, number, number] = [190, 230, 210];
  const glassDark: [number, number, number] = [22, 40, 42];
  const slime: [number, number, number] = sealed ? [96, 210, 112] : [86, 138, 62];
  const glow: [number, number, number] = sealed ? [142, 236, 142] : [154, 82, 188];
  const paper: [number, number, number] = [204, 186, 124];
  const seal: [number, number, number] = [184, 38, 42];
  const grime: [number, number, number] = sealed ? [120, 66, 36] : [80, 58, 42];
  const dust: [number, number, number] = [42, 32, 28];

  ellipse(t, 33, 53, 14, 3.5, sealed ? [6, 14, 10] : [14, 10, 8], seed + 3110, 86);
  rect(t, 28, sealed ? 8 : 12, 37, 15, glassDark, seed + 3111, sealed ? 245 : 150);
  rect(t, 25, 16, 41, 20, sealed ? [64, 82, 78] : grime, seed + 3112, sealed ? 232 : 190);
  rect(t, 21, 20, 44, 50, glass, seed + 3113, 118);
  ellipse(t, 32, 20, 12, 5, glassLight, seed + 3114, 142);
  ellipse(t, 32, 50, 12, 4, glassDark, seed + 3115, 135);
  outlineRect(t, 21, 20, 44, 50, glassDark);
  rect(t, 24, 34, 41, 47, slime, seed + 3116, 212);
  ellipse(t, 32, 35, 9, 4.2, glow, seed + 3117, sealed ? 132 : 150);
  rect(t, 24, 28, 42, 34, paper, seed + 3118, 220);
  rect(t, 26, 30, 40, 31, glassDark, 0, 135);
  line(t, 25, 21, 24, 48, 0.8, glassLight, seed + 3119, 145);
  line(t, 39, 20, 42, 48, 0.8, glassDark, seed + 3120, 138);

  if (sealed) {
    rect(t, 27, 14, 38, 17, seal, seed + 3121, 238);
    rect(t, 29, 11, 37, 13, seal, seed + 3122, 226);
    ellipse(t, 40, 18, 4.2, 3.4, seal, seed + 3123, 215);
    rect(t, 35, 39, 43, 42, seal, seed + 3124, 190);
    rect(t, 36, 40, 42, 41, paper, 0, 135);
  } else {
    clearRect(t, 29, 8, 38, 14);
    line(t, 36, 14, 50, 10, 1.7, glassDark, seed + 3125, 210);
    ellipse(t, 50, 10, 4.2, 2.3, glassDark, seed + 3126, 195);
    drawEye(t, 34, 41, seed + 3127, { body: slime, dark: glassDark, light: glassLight, accent: seal, glow }, 0.62);
    ellipse(t, 28, 43, 6.8, 4.4, grime, seed + 3137, 218);
    line(t, 24, 47, 39, 35, 1.6, grime, seed + 3138, 205);
    ellipse(t, 39, 43, 4.8, 3.2, glow, seed + 3135, 190);
    for (let i = 0; i < 10; i++) {
      const x = 23 + Math.floor(noise(i, 95, seed) * 19);
      const y = 25 + Math.floor(noise(i, 96, seed) * 22);
      ellipse(t, x, y, 1.1, 0.9, i & 1 ? dust : grime, seed + 3128 + i, 165);
    }
    line(t, 23, 48, 44, 38, 1.0, grime, seed + 3136, 152);
  }
  drawNoiseDust(t, seed + 3139, sealed ? glow : grime, sealed ? 12 : 16);
}

interface SlimeSampleVisual {
  liquid: [number, number, number];
  liquidDark: [number, number, number];
  liquidLight: [number, number, number];
  glow: [number, number, number];
  label: [number, number, number];
  seal: [number, number, number];
  mark: 'black' | 'blue' | 'brown' | 'contaminated' | 'fake' | 'green' | 'red' | 'seroburmaline';
  glowAlpha: number;
}

function slimeSampleVisual(defId: string): SlimeSampleVisual | null {
  switch (defId) {
    case 'slime_sample_black':
      return {
        liquid: [22, 18, 30],
        liquidDark: [5, 6, 10],
        liquidLight: [84, 58, 118],
        glow: [92, 54, 134],
        label: [188, 172, 110],
        seal: [92, 54, 132],
        mark: 'black',
        glowAlpha: 36,
      };
    case 'slime_sample_blue':
      return {
        liquid: [40, 142, 220],
        liquidDark: [16, 54, 108],
        liquidLight: [118, 224, 250],
        glow: [72, 190, 248],
        label: [194, 178, 118],
        seal: [54, 116, 170],
        mark: 'blue',
        glowAlpha: 42,
      };
    case 'slime_sample_brown':
      return {
        liquid: [106, 64, 36],
        liquidDark: [44, 26, 18],
        liquidLight: [168, 104, 54],
        glow: [106, 198, 84],
        label: [180, 164, 106],
        seal: [112, 70, 42],
        mark: 'brown',
        glowAlpha: 18,
      };
    case 'slime_sample_contaminated':
      return {
        liquid: [86, 92, 70],
        liquidDark: [30, 34, 28],
        liquidLight: [142, 158, 82],
        glow: [110, 116, 74],
        label: [176, 154, 96],
        seal: [172, 38, 42],
        mark: 'contaminated',
        glowAlpha: 0,
      };
    case 'slime_sample_fake':
      return {
        liquid: [144, 94, 42],
        liquidDark: [70, 42, 24],
        liquidLight: [218, 164, 82],
        glow: [154, 110, 54],
        label: [222, 202, 136],
        seal: [188, 42, 36],
        mark: 'fake',
        glowAlpha: 0,
      };
    case 'slime_sample_green':
      return {
        liquid: [80, 206, 70],
        liquidDark: [28, 82, 34],
        liquidLight: [154, 244, 98],
        glow: [112, 230, 92],
        label: [194, 180, 118],
        seal: [64, 154, 82],
        mark: 'green',
        glowAlpha: 36,
      };
    case 'slime_sample_red':
      return {
        liquid: [166, 36, 42],
        liquidDark: [66, 18, 24],
        liquidLight: [232, 72, 58],
        glow: [210, 56, 74],
        label: [190, 170, 108],
        seal: [164, 36, 42],
        mark: 'red',
        glowAlpha: 24,
      };
    case 'slime_sample_seroburmaline':
      return {
        liquid: [112, 88, 118],
        liquidDark: [36, 32, 46],
        liquidLight: [108, 190, 220],
        glow: [132, 92, 220],
        label: [166, 164, 132],
        seal: [88, 70, 122],
        mark: 'seroburmaline',
        glowAlpha: 38,
      };
    default:
      return null;
  }
}

function drawSlimeSampleSprite(t: Uint32Array, seed: number, visual: SlimeSampleVisual): void {
  const glass: [number, number, number] = visual.mark === 'fake' ? [118, 146, 136] : [94, 142, 140];
  const glassLight: [number, number, number] = [194, 232, 214];
  const glassDark: [number, number, number] = [24, 42, 44];
  const rust: [number, number, number] = [126, 68, 38];
  const warning: [number, number, number] = [186, 38, 36];
  const acid: [number, number, number] = [104, 230, 106];
  const blue: [number, number, number] = [84, 196, 238];
  const violet: [number, number, number] = [144, 82, 208];

  if (visual.glowAlpha > 0) {
    ellipse(t, 32, 36, 22, 18, visual.glow, seed + 2543, visual.glowAlpha);
  }
  ellipse(t, 33, 53, 15, 3.8, visual.liquidDark, seed + 2544, 84);
  rect(t, 27, 9, 38, 14, glassDark, seed + 2545, 245);
  rect(t, 25, 14, 41, 19, visual.mark === 'fake' ? [92, 80, 58] : [70, 84, 80], seed + 2546, 235);
  rect(t, 21, 20, 44, 50, glass, seed + 2547, 116);
  ellipse(t, 32.5, 20, 12, 5, glassLight, seed + 2548, 150);
  ellipse(t, 32.5, 50, 12, 4, glassDark, seed + 2549, 132);
  outlineRect(t, 21, 20, 44, 50, glassDark);
  line(t, 25, 21, 24, 48, 0.8, glassLight, seed + 2550, 150);
  line(t, 39, 20, 42, 48, 0.8, glassDark, seed + 2551, 132);

  rect(t, 24, 34, 41, 47, visual.liquid, seed + 2552, visual.mark === 'black' ? 245 : 218);
  ellipse(t, 32, 35, 9.5, 4.5, visual.liquidLight, seed + 2553, 178);
  ellipse(t, 31, 43, 8, 4.7, visual.liquidDark, seed + 2554, 184);
  line(t, 25, 39, 41, 36, 0.9, visual.liquidLight, seed + 2555, 135);
  line(t, 25, 46, 41, 44, 0.8, visual.liquidDark, seed + 2556, 145);

  rect(t, 22, 27, 43, 34, visual.label, seed + 2557, 230);
  rect(t, 25, 29, 39, 30, glassDark, seed + 2558, 140);
  rect(t, 29, 14, 37, 16, visual.seal, seed + 2559, 224);

  switch (visual.mark) {
    case 'black':
      rect(t, 23, 24, 44, 27, [18, 15, 22], seed + 2560, 180);
      rect(t, 32, 31, 42, 34, violet, seed + 2561, 190);
      drawEye(t, 34, 40, seed + 2562, {
        body: visual.liquid,
        dark: visual.liquidDark,
        light: visual.liquidLight,
        accent: visual.seal,
        glow: violet,
      }, 0.62);
      line(t, 24, 48, 42, 47, 1.1, visual.liquidDark, seed + 2563, 185);
      break;
    case 'blue':
      for (let i = 0; i < 4; i++) {
        line(t, 26 + i * 4, 44 - i * 4, 34 + i * 3, 33 - i * 3, 0.8, blue, seed + 2564 + i, 205);
      }
      ellipse(t, 34, 40, 4.8, 3.1, [220, 228, 214], seed + 2568, 210);
      ellipse(t, 34, 40, 1.9, 1.9, blue, seed + 2569, 240);
      drawNoiseDust(t, seed + 2570, blue, 14);
      break;
    case 'brown':
      rect(t, 25, 31, 40, 33, [72, 88, 48], seed + 2571, 150);
      ellipse(t, 28, 43, 4.2, 3.2, [56, 34, 22], seed + 2572, 205);
      line(t, 23, 49, 43, 47, 1.0, [70, 46, 28], seed + 2573, 180);
      drawNoiseDust(t, seed + 2574, acid, 8);
      break;
    case 'contaminated':
      line(t, 21, 21, 46, 49, 1.0, glassLight, seed + 2575, 190);
      line(t, 28, 16, 41, 23, 1.2, warning, seed + 2576, 225);
      rect(t, 37, 31, 44, 35, warning, seed + 2577, 216);
      ellipse(t, 45, 50, 8, 3, visual.liquid, seed + 2578, 125);
      line(t, 40, 47, 53, 52, 1.2, visual.liquidLight, seed + 2579, 120);
      clearRect(t, 39, 17, 45, 20);
      break;
    case 'fake':
      rect(t, 25, 36, 40, 48, [174, 112, 48], seed + 2579, 218);
      ellipse(t, 32, 38, 8.2, 3.8, [226, 166, 78], seed + 2580, 175);
      rect(t, 24, 28, 42, 35, [228, 208, 138], seed + 2580, 242);
      rect(t, 26, 31, 38, 32, glassDark, seed + 2581, 132);
      line(t, 23, 46, 42, 28, 1.1, warning, seed + 2582, 185);
      line(t, 42, 46, 24, 29, 1.0, warning, seed + 2583, 155);
      ellipse(t, 30, 42, 4.8, 3.0, [224, 174, 82], seed + 2584, 155);
      break;
    case 'green':
      rect(t, 39, 33, 48, 39, acid, seed + 2585, 120);
      ellipse(t, 47, 42, 6, 2.8, acid, seed + 2586, 110);
      line(t, 24, 47, 43, 45, 1.1, acid, seed + 2587, 135);
      drawNoiseDust(t, seed + 2588, acid, 18);
      break;
    case 'red':
      for (let i = 0; i < 3; i++) {
        line(t, 24 + i * 5, 36 + i * 2, 44 + i * 2, 47 - i * 4, 1.1, visual.liquidLight, seed + 2589 + i, 160);
      }
      line(t, 21, 51, 46, 49, 1.2, visual.liquid, seed + 2592, 130);
      rect(t, 37, 28, 43, 34, warning, seed + 2593, 170);
      break;
    case 'seroburmaline':
      rect(t, 24, 35, 41, 39, violet, seed + 2594, 178);
      rect(t, 25, 40, 41, 44, blue, seed + 2595, 164);
      rect(t, 34, 30, 43, 34, [72, 72, 76], seed + 2596, 210);
      drawEye(t, 33, 39, seed + 2597, {
        body: visual.liquid,
        dark: visual.liquidDark,
        light: visual.liquidLight,
        accent: blue,
        glow: violet,
      }, 0.68);
      line(t, 23, 25, 44, 49, 0.8, blue, seed + 2598, 130);
      drawNoiseDust(t, seed + 2599, blue, 10);
      drawNoiseDust(t, seed + 2600, violet, 10);
      break;
  }

  drawNoiseDust(t, seed + 2601, rust, visual.mark === 'fake' ? 6 : 10);
  drawNoiseDust(t, seed + 2602, visual.liquidLight, visual.mark === 'fake' ? 4 : 8);
  px(t, 21, 20, CLEAR);
  px(t, 22, 20, CLEAR);
  px(t, 43, 49, CLEAR);
  px(t, 44, 48, CLEAR);
}

function drawRockSaltSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [132, 136, 128];
  const paperLight: [number, number, number] = [188, 194, 178];
  const paperDark: [number, number, number] = [54, 60, 56];
  const salt: [number, number, number] = [220, 224, 204];
  const blue: [number, number, number] = [86, 132, 144];
  const red: [number, number, number] = [164, 46, 38];
  const damp: [number, number, number] = [62, 82, 70];

  ellipse(t, 32, 53, 16, 4, [10, 12, 10], seed + 2490, 82);
  rect(t, 18, 18, 48, 50, paperDark, seed + 2491, 238);
  rect(t, 20, 15, 46, 47, paper, seed + 2492, 248);
  rect(t, 23, 18, 43, 24, paperLight, seed + 2493, 210);
  outlineRect(t, 20, 15, 46, 47, paperDark);
  clearRect(t, 20, 15, 23, 18);
  clearRect(t, 44, 16, 46, 21);
  clearRect(t, 21, 44, 24, 47);
  rect(t, 22, 28, 44, 40, salt, seed + 2494, 228);
  ellipse(t, 33, 29, 11, 4.2, paperLight, seed + 2495, 190);
  rect(t, 24, 31, 41, 33, blue, seed + 2496, 190);
  rect(t, 27, 35, 39, 37, red, seed + 2497, 170);
  for (let i = 0; i < 18; i++) {
    const x = 23 + Math.floor(noise(i, 80, seed) * 21);
    const y = 26 + Math.floor(noise(i, 81, seed) * 17);
    ellipse(t, x, y, 1.0, 1.0, i & 1 ? salt : paperLight, seed + 2498 + i, 155);
  }
  line(t, 21, 43, 45, 19, 0.8, damp, seed + 2518, 118);
  rect(t, 20, 41, 46, 47, damp, seed + 2519, 92);
  drawNoiseDust(t, seed + 2520, salt, 11);
}

function drawSlimeCalcifiedChipSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [104, 138, 132];
  const glassLight: [number, number, number] = [194, 224, 206];
  const glassDark: [number, number, number] = [26, 42, 42];
  const calc: [number, number, number] = [176, 184, 164];
  const calcLight: [number, number, number] = [226, 226, 194];
  const deadGreen: [number, number, number] = [92, 176, 92];
  const violet: [number, number, number] = [156, 86, 206];
  const label: [number, number, number] = [194, 174, 112];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 53, 15, 4, [10, 13, 11], seed + 2521, 86);
  rect(t, 27, 9, 38, 14, glassDark, seed + 2522, 245);
  rect(t, 25, 14, 40, 19, [68, 82, 78], seed + 2523, 232);
  rect(t, 21, 20, 44, 50, glass, seed + 2524, 126);
  ellipse(t, 32.5, 20, 12, 5, glassLight, seed + 2525, 150);
  ellipse(t, 32.5, 50, 12, 4, glassDark, seed + 2526, 138);
  outlineRect(t, 21, 20, 44, 50, glassDark);
  line(t, 25, 21, 24, 48, 0.8, glassLight, seed + 2527, 145);
  line(t, 39, 19, 42, 48, 0.8, glassDark, seed + 2528, 135);

  line(t, 26, 44, 34, 29, 6.0, calc, seed + 2529, 242);
  line(t, 29, 43, 37, 30, 3.2, calcLight, seed + 2530, 218);
  line(t, 34, 29, 41, 43, 5.4, calc, seed + 2531, 232);
  line(t, 36, 31, 41, 42, 2.2, [118, 126, 116], seed + 2532, 220);
  rect(t, 23, 28, 43, 35, label, seed + 2533, 228);
  rect(t, 25, 30, 40, 31, glassDark, seed + 2534, 130);
  rect(t, 29, 34, 39, 35, rust, seed + 2535, 205);
  rect(t, 30, 14, 37, 16, rust, seed + 2536, 225);
  ellipse(t, 35, 40, 4.6, 3.0, deadGreen, seed + 2537, 196);
  ellipse(t, 30, 37, 3.8, 2.5, violet, seed + 2538, 160);
  line(t, 24, 47, 43, 45, 0.9, deadGreen, seed + 2539, 120);
  drawNoiseDust(t, seed + 2540, calcLight, 13);
  drawNoiseDust(t, seed + 2541, deadGreen, 10);
  drawNoiseDust(t, seed + 2542, rust, 8);
  px(t, 21, 20, CLEAR);
  px(t, 22, 20, CLEAR);
  px(t, 43, 49, CLEAR);
  px(t, 44, 48, CLEAR);
}

function drawSlimeMotorNodeSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [92, 132, 132];
  const glassLight: [number, number, number] = [188, 226, 214];
  const glassDark: [number, number, number] = [22, 38, 42];
  const organ: [number, number, number] = [136, 42, 72];
  const organLight: [number, number, number] = [218, 74, 104];
  const violet: [number, number, number] = [158, 72, 210];
  const cyan: [number, number, number] = [78, 206, 214];
  const label: [number, number, number] = [192, 168, 108];
  const rust: [number, number, number] = [126, 66, 38];

  ellipse(t, 33, 37, 18, 18, violet, seed + 2543, 34);
  ellipse(t, 33, 53, 15, 4, [10, 13, 13], seed + 2544, 86);
  rect(t, 27, 9, 38, 14, glassDark, seed + 2545, 245);
  rect(t, 25, 14, 40, 19, [68, 82, 80], seed + 2546, 232);
  rect(t, 20, 20, 45, 51, glass, seed + 2547, 120);
  ellipse(t, 32.5, 20, 12.5, 5, glassLight, seed + 2548, 148);
  ellipse(t, 32.5, 51, 12.5, 4, glassDark, seed + 2549, 138);
  outlineRect(t, 20, 20, 45, 51, glassDark);
  line(t, 24, 21, 23, 49, 0.8, glassLight, seed + 2550, 140);
  line(t, 39, 19, 42, 49, 0.8, glassDark, seed + 2551, 135);

  ellipse(t, 32, 39, 10.5, 8.5, organ, seed + 2552, 236);
  ellipse(t, 31, 36, 6.2, 4.5, organLight, seed + 2553, 185);
  ellipse(t, 36, 41, 4.8, 3.6, violet, seed + 2554, 190);
  line(t, 23, 39, 42, 37, 1.2, cyan, seed + 2555, 178);
  line(t, 26, 45, 39, 31, 1.0, cyan, seed + 2556, 165);
  line(t, 27, 34, 41, 46, 0.9, glassDark, seed + 2557, 160);
  rect(t, 22, 28, 43, 35, label, seed + 2558, 226);
  rect(t, 24, 30, 40, 31, glassDark, seed + 2559, 130);
  rect(t, 34, 33, 42, 35, rust, seed + 2560, 190);
  rect(t, 30, 14, 37, 16, rust, seed + 2561, 225);
  ellipse(t, 29, 40, 7.5, 5.6, organ, seed + 2568, 238);
  ellipse(t, 37, 42, 6.0, 4.7, organLight, seed + 2569, 205);
  line(t, 27, 45, 40, 35, 1.1, organ, seed + 2570, 190);
  ellipse(t, 31, 47, 7.0, 3.6, organ, seed + 2573, 218);
  ellipse(t, 25, 37, 4.6, 4.4, organLight, seed + 2574, 188);
  line(t, 24, 44, 37, 47, 1.0, organLight, seed + 2575, 168);
  ellipse(t, 34, 39, 4.8, 3.3, [226, 218, 188], seed + 2562, 222);
  ellipse(t, 34, 39, 2.0, 2.0, violet, seed + 2563, 240);
  line(t, 34, 36, 34, 42, 0.7, [8, 8, 10], seed + 2564, 238);
  line(t, 23, 39, 42, 37, 0.9, cyan, seed + 2571, 170);
  line(t, 26, 45, 39, 31, 0.8, cyan, seed + 2572, 156);
  drawNoiseDust(t, seed + 2565, cyan, 14);
  drawNoiseDust(t, seed + 2566, organLight, 8);
  drawNoiseDust(t, seed + 2567, rust, 9);
  px(t, 20, 20, CLEAR);
  px(t, 21, 20, CLEAR);
  px(t, 44, 50, CLEAR);
  px(t, 45, 49, CLEAR);
}

function drawSampleSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'slime_calcified_chip') {
    drawSlimeCalcifiedChipSprite(t, seed);
    return;
  }
  if (defId === 'slime_motor_node') {
    drawSlimeMotorNodeSprite(t, seed);
    return;
  }
  const slimeVisual = slimeSampleVisual(defId);
  if (slimeVisual) {
    drawSlimeSampleSprite(t, seed, slimeVisual);
    return;
  }
  if (defId === 'rock_salt') {
    drawRockSaltSprite(t, seed);
    return;
  }
  if (defId === 'sealed_veretar_sand') {
    drawSealedVeretarSandSprite(t, seed);
    return;
  }
  if (defId === 'veretar_sand') {
    drawVeretarSandSprite(t, seed);
    return;
  }
  if (defId === 'red_mold_sample') {
    drawRedMoldSampleSprite(t, seed);
    return;
  }
  if (defId === 'zhelemish_sample_sealed' || defId === 'zhelemish_sample_contaminated') {
    drawZhelemishSampleSprite(t, seed, defId === 'zhelemish_sample_sealed');
    return;
  }
  if (defId === 'lime_bucket') {
    drawLimeBucketSprite(t, seed);
    return;
  }
  if (defId === 'zinc_slime_bucket') {
    drawZincSlimeBucketSprite(t, seed);
    return;
  }
  if (defId === 'mutant_tissue_sample') {
    drawMutantTissueSampleSprite(t, seed);
    return;
  }
  if (defId === 'overexposed_photo') {
    drawOverexposedPhotoSprite(t, seed);
    return;
  }
  if (defId === 'govnyak_roll' || defId === 'govnyak_brick' || defId === 'govnyak_sample' || defId === 'govnyak_bad_batch') {
    drawGovnyakSprite(t, seed, defId);
    return;
  }
  if (defId === 'gas_sample_ampoule') {
    drawGasSampleAmpouleSprite(t, seed);
    return;
  }
  if (defId === 'glass_ampoule_empty') {
    drawEmptyGlassAmpouleSprite(t, seed);
    return;
  }
  if (defId === 'empty_sample_jar') {
    drawEmptySampleJarSprite(t, seed);
    return;
  }
  if (defId === 'fibrous_capsule_cut') {
    drawFibrousCapsuleCutSprite(t, seed);
    return;
  }
  if (defId === 'cracked_sample_jar') {
    drawCrackedSampleJarSprite(t, seed);
    return;
  }
  if (defId === 'boiled_slime_residue') {
    drawBoiledSlimeResidueSprite(t, seed, p);
    return;
  }
  if (defId === 'deactivated_residue') {
    drawDeactivatedResidueSprite(t, seed);
    return;
  }
  if (defId === 'decon_fluid') {
    drawDeconFluidSprite(t, seed);
    return;
  }
  if (defId === 'frozen_item_shard') {
    drawFrozenItemShardSprite(t, seed);
    return;
  }
  if (defId === 'frozen_slime_core') {
    drawFrozenSlimeCoreSprite(t, seed);
    return;
  }
  if (defId === 'bleached_document') {
    drawBleachedDocumentSprite(t, seed);
    return;
  }
  if (defId === 'blue_glow_sample_sealed') {
    drawBlueGlowSealedSampleSprite(t, seed);
    return;
  }
  if (defId === 'blue_glow_sample_open') {
    drawBlueGlowOpenSampleSprite(t, seed);
    return;
  }
  if (defId === 'alkali_powder') {
    drawAlkaliPowderSprite(t, seed, p);
    return;
  }
  if (defId === 'sample_cork_seal') {
    drawSampleCorkSealSprite(t, seed);
    return;
  }
  if (defId === 'slime_sample_silver') {
    drawSilverSlimeSampleSprite(t, seed, false);
    return;
  }
  if (defId === 'slime_sample_silver_open') {
    drawSilverSlimeSampleSprite(t, seed, true);
    return;
  }
  if (defId === 'slime_sample_white') {
    drawWhiteSlimeSampleSprite(t, seed);
    return;
  }
  if (defId === 'slime_scraper') {
    drawSlimeScraperSprite(t, seed);
    return;
  }
  if (defId === 'slime_sense_node') {
    drawSlimeSenseNodeSprite(t, seed);
    return;
  }
  const ampoule = defId.includes('ampoule') || defId.includes('vial');
  rect(t, ampoule ? 27 : 22, 13, ampoule ? 37 : 42, 50, p.light, seed + 141, 170);
  rect(t, ampoule ? 28 : 24, 27, ampoule ? 36 : 40, 48, p.glow, seed + 142, 195);
  ellipse(t, ampoule ? 32 : 32, 34, ampoule ? 5 : 11, ampoule ? 9 : 10, p.glow, seed + 143, 210);
  rect(t, ampoule ? 28 : 24, 11, ampoule ? 36 : 40, 16, p.dark, seed + 144);
  if (defId.includes('eye') || defId.includes('seroburmaline') || (seed & 7) === 3) drawEye(t, 32, 34, seed, p, 0.72);
}

function drawAlkaliPowderSprite(t: Uint32Array, seed: number, p: Palette): void {
  const paper: [number, number, number] = [132, 134, 126];
  const paperLight: [number, number, number] = [184, 188, 174];
  const paperDark: [number, number, number] = [56, 60, 56];
  const slimeBrown: [number, number, number] = [102, 62, 38];
  const alkaliGlow: [number, number, number] = [116, 230, 132];
  const alkaliBlue: [number, number, number] = [74, 178, 214];

  rect(t, 18, 20, 45, 50, paper, seed + 141, 245);
  rect(t, 20, 16, 43, 23, paperLight, seed + 142, 240);
  outlineRect(t, 18, 20, 45, 50, paperDark);
  for (let y = 24; y <= 46; y += 6) line(t, 20, y, 43, y - 3, 0.7, paperDark, seed + 143 + y, 92);
  line(t, 20, 18, 44, 48, 1.1, paperDark, seed + 170, 95);

  rect(t, 24, 29, 38, 35, [74, 92, 82], seed + 144, 235);
  rect(t, 25, 30, 37, 31, alkaliGlow, seed + 145, 220);
  rect(t, 25, 34, 36, 35, alkaliBlue, seed + 146, 170);
  rect(t, 36, 41, 48, 45, alkaliGlow, seed + 147, 170);
  ellipse(t, 48, 46, 8, 4, alkaliGlow, seed + 148, 155);
  drawNoiseDust(t, seed + 149, alkaliGlow, 28);

  ellipse(t, 23, 42, 7, 5, slimeBrown, seed + 150, 205);
  ellipse(t, 25, 42, 3, 2, [54, 28, 20], seed + 151, 220);
  rect(t, 21, 25, 38, 27, p.accent, seed + 152, 200);
  rect(t, 23, 38, 33, 39, [42, 52, 46], seed + 153, 150);
  px(t, 42, 20, CLEAR);
  px(t, 43, 20, CLEAR);
  px(t, 44, 21, CLEAR);
  px(t, 45, 22, CLEAR);
}

function drawPsiStrikeSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 12, 28];
  const violet: [number, number, number] = [136, 72, 210];
  const blue: [number, number, number] = [72, 150, 236];
  const cyan: [number, number, number] = [112, 228, 220];
  const enamel: [number, number, number] = [218, 218, 188];
  const red: [number, number, number] = [168, 38, 58];
  const rust: [number, number, number] = [118, 58, 36];

  ellipse(t, 32, 35, 20, 18, violet, seed + 2300, 46);
  line(t, 16, 47, 48, 16, 4.4, dark, seed + 2301, 246);
  line(t, 18, 45, 46, 18, 2.8, violet, seed + 2302, 248);
  line(t, 22, 42, 43, 21, 1.4, cyan, seed + 2303, 232);
  line(t, 27, 31, 48, 22, 1.2, blue, seed + 2304, 210);
  line(t, 19, 46, 30, 35, 1.2, enamel, seed + 2305, 218);
  ellipse(t, 34, 32, 6.4, 4.2, enamel, seed + 2306, 228);
  ellipse(t, 34, 32, 2.7, 2.7, violet, seed + 2307, 248);
  line(t, 34, 29, 34, 35, 0.8, [4, 5, 8], seed + 2308, 245);
  rect(t, 25, 40, 32, 43, red, seed + 2309, 185);
  rect(t, 37, 23, 44, 25, blue, seed + 2310, 160);
  line(t, 20, 47, 42, 22, 0.8, rust, seed + 2311, 125);
  drawNoiseDust(t, seed + 2312, cyan, 12);
  drawNoiseDust(t, seed + 2313, rust, 8);
}

function drawPsiStormSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [20, 12, 30];
  const violet: [number, number, number] = [132, 72, 218];
  const blue: [number, number, number] = [62, 132, 230];
  const cyan: [number, number, number] = [112, 226, 224];
  const red: [number, number, number] = [170, 38, 58];
  const yellow: [number, number, number] = [214, 154, 54];
  const rust: [number, number, number] = [118, 58, 36];

  ellipse(t, 32, 34, 22, 20, violet, seed + 2320, 48);
  ellipse(t, 32, 34, 17, 15, blue, seed + 2321, 40);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const cx = 32 + Math.cos(a) * (9 + (i & 1) * 2);
    const cy = 34 + Math.sin(a) * (8 + ((i + 1) & 1) * 2);
    ellipse(t, cx, cy, 6.2, 4.8, (i & 1) === 0 ? violet : blue, seed + 2322 + i, 220);
    ellipse(t, cx + 1, cy - 1, 2.5, 2.0, cyan, seed + 2330 + i, 150);
  }
  for (let i = 0; i < 5; i++) {
    const x0 = 15 + i * 8;
    line(t, x0, 42 - (i & 1) * 10, x0 + 10, 23 + (i & 1) * 8, 1.0, cyan, seed + 2340 + i, 205);
  }
  ellipse(t, 32, 34, 7.6, 5.0, [220, 216, 190], seed + 2346, 218);
  ellipse(t, 32, 34, 3.2, 3.2, violet, seed + 2347, 248);
  line(t, 32, 30, 32, 38, 0.8, dark, seed + 2348, 245);
  rect(t, 22, 45, 42, 48, red, seed + 2349, 170);
  rect(t, 26, 46, 38, 47, yellow, seed + 2350, 158);
  line(t, 18, 48, 47, 20, 0.8, rust, seed + 2351, 115);
  drawNoiseDust(t, seed + 2352, cyan, 20);
  drawNoiseDust(t, seed + 2353, rust, 8);
}

function drawPsiVoidNeedleSprite(t: Uint32Array, seed: number): void {
  const black: [number, number, number] = [6, 8, 14];
  const voidBlue: [number, number, number] = [36, 60, 96];
  const violet: [number, number, number] = [96, 58, 174];
  const cyan: [number, number, number] = [104, 226, 232];
  const edge: [number, number, number] = [190, 206, 206];
  const red: [number, number, number] = [158, 34, 58];
  const rust: [number, number, number] = [104, 52, 38];

  ellipse(t, 33, 35, 21, 16, violet, seed + 2360, 32);
  line(t, 13, 48, 55, 13, 5.2, black, seed + 2361, 252);
  line(t, 17, 45, 53, 15, 2.6, voidBlue, seed + 2362, 248);
  line(t, 21, 42, 53, 15, 0.9, edge, seed + 2363, 232);
  line(t, 27, 34, 59, 10, 1.1, cyan, seed + 2364, 220);
  line(t, 20, 47, 34, 36, 1.2, violet, seed + 2365, 210);
  ellipse(t, 45, 21, 6.4, 3.6, black, seed + 2366, 230);
  ellipse(t, 45, 21, 2.5, 2.1, cyan, seed + 2367, 210);
  rect(t, 23, 39, 31, 42, red, seed + 2368, 165);
  line(t, 28, 40, 46, 22, 0.8, rust, seed + 2369, 125);
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 7;
    line(t, x, 46 - i * 5, x + 4, 39 - i * 5, 0.7, cyan, seed + 2370 + i, 155);
  }
  drawNoiseDust(t, seed + 2376, cyan, 9);
  drawNoiseDust(t, seed + 2377, rust, 6);
  clearRect(t, 13, 48, 15, 50);
  clearRect(t, 55, 10, 58, 14);
}

function drawPsiDustSprite(t: Uint32Array, seed: number): void {
  const violet: [number, number, number] = [158, 82, 228];
  const blue: [number, number, number] = [78, 158, 236];
  const cyan: [number, number, number] = [108, 224, 218];
  const enamel: [number, number, number] = [194, 194, 164];
  const concrete: [number, number, number] = [92, 98, 90];
  const dark: [number, number, number] = [18, 14, 24];
  const seal: [number, number, number] = [166, 38, 52];
  const rust: [number, number, number] = [116, 56, 38];

  ellipse(t, 33, 35, 23, 18, violet, seed + 2490, 44);
  ellipse(t, 33, 35, 17, 13, blue, seed + 2491, 36);
  ellipse(t, 33, 53, 14, 3, [4, 5, 7], seed + 2492, 84);
  rect(t, 20, 31, 45, 47, concrete, seed + 2493, 220);
  ellipse(t, 32, 31, 14, 6, enamel, seed + 2494, 220);
  ellipse(t, 32, 47, 13, 4, dark, seed + 2495, 130);
  outlineRect(t, 20, 31, 45, 47, dark);
  clearRect(t, 20, 31, 23, 34);
  clearRect(t, 43, 31, 45, 35);
  rect(t, 23, 37, 43, 41, violet, seed + 2496, 184);
  ellipse(t, 32, 36, 7.8, 4.6, enamel, seed + 2497, 224);
  ellipse(t, 32, 36, 3.2, 3.2, violet, seed + 2498, 252);
  line(t, 32, 32, 32, 40, 0.8, dark, seed + 2499, 245);
  rect(t, 38, 27, 50, 32, seal, seed + 2500, 168);
  line(t, 18, 46, 47, 28, 0.8, rust, seed + 2501, 120);
  for (let i = 0; i < 26; i++) {
    const x = 13 + Math.floor(noise(i, 91, seed) * 41);
    const y = 15 + Math.floor(noise(i, 92, seed) * 36);
    const c = i % 3 === 0 ? cyan : i % 3 === 1 ? blue : violet;
    ellipse(t, x, y, 1.0 + noise(i, 93, seed) * 0.9, 0.8, c, seed + 2502 + i, 120 + Math.floor(noise(i, 94, seed) * 90));
  }
  drawNoiseDust(t, seed + 2530, cyan, 14);
  drawNoiseDust(t, seed + 2531, rust, 8);
}

function drawSharkScaleSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 34, 42];
  const blue: [number, number, number] = [54, 128, 150];
  const cyan: [number, number, number] = [112, 214, 218];
  const pearl: [number, number, number] = [210, 226, 210];
  const wet: [number, number, number] = [42, 82, 96];
  const rust: [number, number, number] = [126, 62, 36];
  const red: [number, number, number] = [174, 34, 42];

  ellipse(t, 33, 52, 18, 4, [6, 10, 12], seed + 2580, 78);
  ellipse(t, 32, 34, 20, 17, dark, seed + 2581, 238);
  ellipse(t, 34, 31, 18, 14, blue, seed + 2582, 248);
  ellipse(t, 37, 27, 11, 8, cyan, seed + 2583, 178);
  ellipse(t, 31, 31, 8, 6, pearl, seed + 2584, 150);
  clearRect(t, 13, 17, 22, 32);
  clearRect(t, 44, 40, 56, 49);
  line(t, 19, 43, 52, 18, 1.4, dark, seed + 2585, 220);
  line(t, 23, 40, 46, 21, 0.9, pearl, seed + 2586, 185);
  for (let i = 0; i < 5; i++) {
    line(t, 23 + i * 5, 39 - i * 3, 25 + i * 5, 24 - i, 0.8, wet, seed + 2587 + i, 165);
  }
  rect(t, 40, 37, 52, 42, red, seed + 2593, 180);
  rect(t, 42, 39, 50, 40, pearl, 0, 135);
  line(t, 18, 45, 48, 22, 0.8, rust, seed + 2594, 138);
  drawNoiseDust(t, seed + 2595, cyan, 11);
  drawNoiseDust(t, seed + 2596, rust, 7);
}

function drawSirenShardSprite(t: Uint32Array, seed: number): void {
  const black: [number, number, number] = [18, 12, 20];
  const red: [number, number, number] = [162, 34, 42];
  const redLight: [number, number, number] = [224, 70, 64];
  const enamel: [number, number, number] = [204, 202, 174];
  const violet: [number, number, number] = [144, 78, 218];
  const blue: [number, number, number] = [74, 156, 234];
  const psiBlue: [number, number, number] = [104, 146, 252];
  const psiViolet: [number, number, number] = [166, 88, 238];
  const rust: [number, number, number] = [120, 58, 36];

  ellipse(t, 32, 34, 21, 18, violet, seed + 2597, 76);
  ellipse(t, 34, 32, 16, 13, blue, seed + 2598, 68);
  line(t, 14, 48, 50, 17, 6.0, black, seed + 2599, 248);
  line(t, 17, 46, 48, 19, 4.2, red, seed + 2600, 250);
  line(t, 21, 43, 43, 23, 1.4, redLight, seed + 2601, 216);
  line(t, 25, 39, 52, 28, 5.0, black, seed + 2602, 238);
  line(t, 27, 38, 50, 29, 3.2, red, seed + 2603, 242);
  line(t, 26, 41, 41, 25, 1.1, enamel, seed + 2604, 210);
  rect(t, 25, 40, 36, 44, [92, 28, 36], seed + 2605, 216);
  rect(t, 36, 26, 45, 29, enamel, seed + 2606, 185);
  ellipse(t, 34, 34, 6.2, 4.2, enamel, seed + 2607, 228);
  ellipse(t, 34, 34, 2.5, 2.5, violet, seed + 2608, 246);
  line(t, 34, 31, 34, 37, 0.7, black, seed + 2609, 244);
  line(t, 19, 46, 45, 22, 0.8, rust, seed + 2610, 135);
  rect(t, 45, 25, 53, 29, rust, seed + 2611, 150);
  line(t, 15, 49, 28, 39, 1.4, psiBlue, seed + 2615, 166);
  line(t, 42, 24, 53, 17, 1.2, psiViolet, seed + 2616, 162);
  line(t, 39, 32, 51, 28, 0.9, psiBlue, seed + 2617, 150);
  drawNoiseDust(t, seed + 2612, blue, 11);
  drawNoiseDust(t, seed + 2613, violet, 10);
  drawNoiseDust(t, seed + 2614, rust, 8);
  clearRect(t, 13, 48, 15, 51);
  clearRect(t, 51, 16, 54, 20);
}

function drawArtifactSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'void_spike') {
    drawVoidSpikeSprite(t, seed);
    return;
  }
  if (defId === 'siren_shard') {
    drawSirenShardSprite(t, seed);
    return;
  }
  if (defId === 'shark_scale') {
    drawSharkScaleSprite(t, seed);
    return;
  }
  if (defId === 'psi_dust') {
    drawPsiDustSprite(t, seed);
    return;
  }
  if (defId === 'psi_strike') {
    drawPsiStrikeSprite(t, seed);
    return;
  }
  if (defId === 'psi_storm') {
    drawPsiStormSprite(t, seed);
    return;
  }
  if (defId === 'psi_void_needle') {
    drawPsiVoidNeedleSprite(t, seed);
    return;
  }
  if (defId === 'istotit_candle') {
    drawIstotitCandleSprite(t, seed);
    return;
  }
  if (defId === 'maronary_shaving') {
    drawMaronaryShavingSprite(t, seed);
    return;
  }
  if (defId === 'bottled_voice') {
    drawBottledVoiceSprite(t, seed);
    return;
  }
  if (defId === 'idol_chernobog') {
    drawIdolChernobogSprite(t, seed);
    return;
  }
  if (defId.startsWith('chernobog_')) {
    drawChernobogDocketSprite(t, seed, defId);
    return;
  }
  if (isPsiBundle032Clot(defId)) {
    drawPsiBundle032ClotSprite(t, seed, defId);
    return;
  }
  ellipse(t, 32, 33, 19, 19, p.glow, seed + 151, 50);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + (seed % 31) * 0.01;
    line(t, 32, 32, 32 + Math.cos(a) * (11 + (i & 1) * 6), 32 + Math.sin(a) * (12 + (i & 1) * 5), 1.4, p.body, seed + 152 + i, 220);
  }
  ellipse(t, 32, 34, 8, 13, p.light, seed + 160, 230);
  if (!defId.includes('candle')) drawEye(t, 32, 32, seed, p, 0.9);
  else line(t, 32, 17, 32, 47, 3, p.light, seed + 161);
}

function isPsiBundle032Clot(defId: string): boolean {
  return defId === 'psi_mark'
    || defId === 'psi_meat_hook'
    || defId === 'psi_order_seal'
    || defId === 'psi_phase'
    || defId === 'psi_recall'
    || defId === 'psi_rupture'
    || defId === 'psi_shadow_lance'
    || defId === 'psi_siren_pulse';
}

function drawPsiClotCore(
  t: Uint32Array,
  seed: number,
  body: [number, number, number],
  glow: [number, number, number],
  light: [number, number, number],
  rx = 15,
  ry = 13,
): void {
  ellipse(t, 32, 34, rx + 7, ry + 6, glow, seed + 2200, 42);
  ellipse(t, 32, 34, rx + 1, ry + 1, [14, 10, 24], seed + 2201, 246);
  ellipse(t, 32, 34, rx, ry, body, seed + 2202, 250);
  ellipse(t, 28, 29, Math.max(3, rx * 0.32), Math.max(2, ry * 0.25), light, seed + 2203, 128);
  line(t, 21, 44, 43, 24, 0.8, [10, 8, 16], seed + 2204, 118);
}

function drawPsiBundle032ClotSprite(t: Uint32Array, seed: number, defId: string): void {
  const dark: [number, number, number] = [12, 9, 18];
  const violet: [number, number, number] = [102, 58, 168];
  const violetLight: [number, number, number] = [178, 120, 232];
  const blue: [number, number, number] = [58, 132, 210];
  const cyan: [number, number, number] = [80, 224, 216];
  const red: [number, number, number] = [182, 38, 54];
  const redLight: [number, number, number] = [228, 78, 76];
  const meat: [number, number, number] = [128, 42, 52];
  const fat: [number, number, number] = [210, 176, 126];
  const yellow: [number, number, number] = [218, 164, 62];

  if (defId === 'psi_shadow_lance') {
    line(t, 14, 48, 52, 16, 6.5, blue, seed + 2300, 42);
    line(t, 16, 47, 50, 18, 4.2, dark, seed + 2301, 250);
    line(t, 20, 44, 53, 16, 2.0, violetLight, seed + 2302, 235);
    line(t, 43, 23, 58, 11, 3.2, dark, seed + 2303, 250);
    line(t, 46, 22, 57, 12, 1.2, cyan, seed + 2304, 215);
    rect(t, 18, 42, 27, 48, [58, 30, 86], seed + 2305, 230);
    rect(t, 20, 44, 26, 45, red, seed + 2306, 205);
    drawNoiseDust(t, seed + 2307, violetLight, 13);
    return;
  }

  if (defId === 'psi_meat_hook') {
    ellipse(t, 33, 35, 22, 19, red, seed + 2310, 40);
    arcLine(t, 33, 34, 16, 14, Math.PI * 0.72, Math.PI * 2.28, 4.5, dark, seed + 2311, 248, 18);
    arcLine(t, 33, 34, 13, 11, Math.PI * 0.78, Math.PI * 2.18, 3.0, meat, seed + 2312, 252, 18);
    arcLine(t, 33, 34, 9, 7, Math.PI * 0.90, Math.PI * 1.90, 1.4, fat, seed + 2313, 205, 12);
    line(t, 42, 20, 52, 12, 2.8, dark, seed + 2314, 248);
    line(t, 44, 20, 52, 12, 1.2, redLight, seed + 2315, 230);
    ellipse(t, 27, 39, 5, 3, fat, seed + 2316, 170);
    rect(t, 22, 45, 30, 47, yellow, seed + 2317, 155);
    drawNoiseDust(t, seed + 2318, redLight, 16);
    return;
  }

  if (defId === 'psi_phase') {
    ellipse(t, 27, 34, 15, 14, blue, seed + 2320, 92);
    ellipse(t, 38, 31, 15, 14, violet, seed + 2321, 130);
    drawPsiClotCore(t, seed, [54, 44, 96], blue, cyan, 13, 13);
    line(t, 22, 47, 45, 17, 2.0, cyan, seed + 2322, 224);
    line(t, 27, 48, 50, 18, 1.1, violetLight, seed + 2323, 184);
    line(t, 17, 35, 47, 34, 0.9, dark, seed + 2324, 150);
    clearRect(t, 31, 17, 35, 50);
    line(t, 31, 18, 35, 49, 0.9, cyan, seed + 2325, 150);
    return;
  }

  if (defId === 'psi_order_seal') {
    drawPsiClotCore(t, seed, [64, 48, 92], violet, [194, 170, 210], 14, 13);
    rect(t, 22, 23, 43, 43, red, seed + 2330, 230);
    rect(t, 25, 26, 40, 40, [118, 22, 38], seed + 2331, 245);
    outlineRect(t, 22, 23, 43, 43, dark);
    rect(t, 27, 30, 38, 32, yellow, seed + 2332, 205);
    rect(t, 28, 35, 37, 36, yellow, seed + 2333, 175);
    line(t, 22, 23, 43, 43, 0.8, violetLight, seed + 2334, 130);
    line(t, 24, 43, 43, 24, 0.8, cyan, seed + 2335, 120);
    drawNoiseDust(t, seed + 2336, yellow, 10);
    return;
  }

  if (defId === 'psi_mark') {
    drawPsiClotCore(t, seed, [58, 50, 110], blue, violetLight, 14, 13);
    ellipse(t, 32, 34, 9, 9, red, seed + 2340, 228);
    ellipse(t, 32, 34, 5, 5, [40, 34, 78], seed + 2341, 248);
    line(t, 21, 34, 43, 34, 1.0, redLight, seed + 2342, 235);
    line(t, 32, 23, 32, 45, 1.0, redLight, seed + 2343, 235);
    rect(t, 43, 28, 49, 32, yellow, seed + 2344, 190);
    drawEye(t, 32, 34, seed + 2345, { body: violet, dark, light: violetLight, accent: red, glow: cyan }, 0.45);
    return;
  }

  if (defId === 'psi_recall') {
    drawPsiClotCore(t, seed, [50, 58, 106], cyan, violetLight, 14, 13);
    arcLine(t, 32, 34, 15, 12, Math.PI * 0.15, Math.PI * 1.73, 2.2, cyan, seed + 2350, 235, 18);
    line(t, 18, 36, 25, 41, 1.6, cyan, seed + 2351, 235);
    line(t, 18, 36, 25, 31, 1.6, cyan, seed + 2352, 235);
    line(t, 24, 44, 43, 24, 1.1, violetLight, seed + 2353, 180);
    ellipse(t, 39, 28, 4, 3, red, seed + 2354, 190);
    rect(t, 24, 41, 31, 44, yellow, seed + 2355, 150);
    return;
  }

  if (defId === 'psi_rupture') {
    drawPsiClotCore(t, seed, [86, 36, 86], red, violetLight, 15, 14);
    line(t, 24, 21, 31, 33, 1.7, redLight, seed + 2360, 245);
    line(t, 31, 33, 24, 48, 1.3, redLight, seed + 2361, 230);
    line(t, 34, 25, 42, 18, 1.2, cyan, seed + 2362, 195);
    line(t, 34, 35, 48, 41, 1.5, yellow, seed + 2363, 205);
    ellipse(t, 32, 34, 4, 4, dark, seed + 2364, 235);
    drawNoiseDust(t, seed + 2365, redLight, 18);
    return;
  }

  drawPsiClotCore(t, seed, [50, 48, 102], blue, cyan, 15, 13);
  rect(t, 22, 25, 42, 37, red, seed + 2370, 220);
  rect(t, 25, 28, 39, 33, [120, 22, 42], seed + 2371, 235);
  arcLine(t, 32, 33, 18, 15, Math.PI * 0.05, Math.PI * 0.42, 1.6, cyan, seed + 2372, 220, 8);
  arcLine(t, 32, 33, 22, 19, Math.PI * 0.02, Math.PI * 0.38, 1.2, cyan, seed + 2373, 190, 8);
  arcLine(t, 32, 33, 18, 15, Math.PI * 0.58, Math.PI * 0.95, 1.6, cyan, seed + 2374, 220, 8);
  arcLine(t, 32, 33, 22, 19, Math.PI * 0.62, Math.PI * 0.98, 1.2, cyan, seed + 2375, 190, 8);
  rect(t, 27, 20, 37, 24, yellow, seed + 2376, 190);
  drawNoiseDust(t, seed + 2377, cyan, 13);
}

function drawMaronaryShavingSprite(t: Uint32Array, seed: number): void {
  const greenDark: [number, number, number] = [26, 68, 44];
  const green: [number, number, number] = [72, 164, 86];
  const greenLight: [number, number, number] = [138, 232, 112];
  const enamel: [number, number, number] = [190, 210, 154];
  const violet: [number, number, number] = [118, 72, 184];
  const blue: [number, number, number] = [72, 138, 220];
  const rust: [number, number, number] = [118, 58, 34];
  const ink: [number, number, number] = [16, 12, 20];

  ellipse(t, 32, 52, 13, 3, [0, 0, 0], seed + 162, 72);
  line(t, 16, 47, 48, 17, 3.7, greenDark, seed + 163, 246);
  line(t, 18, 45, 46, 19, 2.8, green, seed + 164, 248);
  line(t, 22, 42, 42, 22, 1.6, greenLight, seed + 165, 228);
  line(t, 22, 46, 34, 31, 1.1, enamel, seed + 166, 220);
  line(t, 31, 29, 45, 18, 1.0, blue, seed + 167, 210);
  line(t, 26, 40, 43, 23, 0.8, violet, seed + 168, 210);
  clearRect(t, 14, 45, 17, 49);
  clearRect(t, 47, 14, 50, 19);
  clearRect(t, 19, 48, 22, 51);

  ellipse(t, 32, 33, 5.8, 3.6, enamel, seed + 169, 230);
  ellipse(t, 32, 33, 2.4, 2.4, violet, seed + 170, 250);
  line(t, 32, 30, 32, 36, 0.8, ink, seed + 171, 240);
  rect(t, 21, 43, 28, 45, rust, seed + 172, 122);
  rect(t, 37, 21, 43, 23, blue, seed + 173, 160);
  for (let i = 0; i < 9; i++) {
    const x = 18 + Math.floor(noise(i, 80, seed) * 28);
    const y = 18 + Math.floor(noise(i, 81, seed) * 30);
    if (Math.abs((x + y) - 63) < 18) ellipse(t, x, y, 1.0, 0.8, (i & 1) === 0 ? greenLight : violet, seed + 174 + i, 150);
  }
  drawNoiseDust(t, seed + 184, rust, 8);
}

function drawBottledVoiceSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [90, 118, 126];
  const glassLight: [number, number, number] = [170, 214, 220];
  const glassDark: [number, number, number] = [24, 34, 44];
  const cap: [number, number, number] = [72, 62, 70];
  const enamel: [number, number, number] = [214, 206, 176];
  const violet: [number, number, number] = [168, 78, 230];
  const blue: [number, number, number] = [76, 166, 238];
  const cyan: [number, number, number] = [112, 232, 224];
  const redSeal: [number, number, number] = [168, 42, 58];
  const rust: [number, number, number] = [126, 62, 38];

  ellipse(t, 33, 36, 22, 20, violet, seed + 151, 48);
  ellipse(t, 33, 37, 17, 17, blue, seed + 152, 34);
  ellipse(t, 33, 53, 14, 3, [0, 0, 0], seed + 153, 92);
  rect(t, 27, 9, 38, 14, glassDark, seed + 154, 246);
  rect(t, 25, 13, 40, 19, cap, seed + 155, 246);
  rect(t, 28, 14, 37, 16, redSeal, seed + 156, 225);
  rect(t, 22, 21, 44, 51, glass, seed + 157, 134);
  ellipse(t, 33, 21, 12, 5, glassLight, seed + 158, 154);
  ellipse(t, 33, 51, 12, 4, glassDark, seed + 159, 142);
  outlineRect(t, 22, 21, 44, 51, glassDark);
  line(t, 26, 22, 25, 48, 0.8, glassLight, seed + 160, 150);
  line(t, 39, 20, 41, 49, 0.8, glassDark, seed + 161, 132);

  rect(t, 24, 31, 42, 38, enamel, seed + 162, 226);
  rect(t, 25, 33, 40, 34, glassDark, seed + 163, 120);
  rect(t, 26, 36, 38, 37, redSeal, seed + 164, 190);
  line(t, 25, 31, 42, 38, 0.7, rust, seed + 165, 130);

  ellipse(t, 33, 41, 6.4, 4.2, [218, 226, 216], seed + 166, 230);
  ellipse(t, 33, 41, 2.7, 2.7, violet, seed + 167, 248);
  line(t, 33, 38, 33, 44, 0.7, [6, 8, 16], seed + 168, 245);
  line(t, 27, 28, 38, 26, 0.9, cyan, seed + 169, 176);
  line(t, 28, 27, 41, 31, 0.9, blue, seed + 170, 168);
  line(t, 27, 45, 41, 46, 1.0, cyan, seed + 171, 142);
  line(t, 25, 25, 41, 47, 0.8, violet, seed + 172, 118);
  drawNoiseDust(t, seed + 173, cyan, 15);
  drawNoiseDust(t, seed + 174, violet, 11);
  drawNoiseDust(t, seed + 175, rust, 8);
  px(t, 22, 21, CLEAR);
  px(t, 23, 21, CLEAR);
  px(t, 43, 50, CLEAR);
  px(t, 44, 49, CLEAR);
}

function drawChernobogDocketSprite(t: Uint32Array, seed: number, defId: string): void {
  const concrete: [number, number, number] = [92, 88, 84];
  const enamel: [number, number, number] = [190, 178, 138];
  const paper: [number, number, number] = [178, 162, 112];
  const ink: [number, number, number] = [12, 10, 12];
  const violet: [number, number, number] = [104, 66, 154];
  const blue: [number, number, number] = [68, 134, 182];
  const red: [number, number, number] = [168, 38, 42];
  const rust: [number, number, number] = [126, 64, 36];
  const damp: [number, number, number] = [50, 62, 58];

  ellipse(t, 32, 52, 17, 4, damp, seed + 162, 92);
  rect(t, 18, 12, 48, 52, concrete, seed + 163, 242);
  rect(t, 20, 15, 46, 49, paper, seed + 164, 245);
  outlineRect(t, 18, 12, 48, 52, ink);
  clearRect(t, 18, 12, 21, 15);
  clearRect(t, 46, 13, 48, 18);
  clearRect(t, 18, 49, 21, 52);
  rect(t, 18, 43, 48, 52, damp, seed + 165, 106);
  line(t, 19, 16, 46, 49, 0.8, concrete, seed + 166, 120);

  if (defId === 'chernobog_cell_map') {
    rect(t, 22, 18, 44, 42, [48, 54, 58], seed + 167, 218);
    rect(t, 24, 20, 42, 40, enamel, seed + 168, 210);
    for (let x = 27; x <= 40; x += 4) line(t, x, 20, x, 40, 0.7, ink, seed + 169 + x, 120);
    for (let y = 23; y <= 38; y += 4) line(t, 24, y, 42, y, 0.7, ink, seed + 170 + y, 120);
    rect(t, 28, 24, 31, 27, violet, seed + 171, 205);
    rect(t, 36, 32, 40, 36, blue, seed + 172, 190);
    line(t, 25, 21, 43, 39, 1.0, red, seed + 173, 212);
    line(t, 25, 39, 42, 21, 0.8, blue, seed + 174, 172);
    drawEye(t, 34, 31, seed, { body: concrete, dark: ink, light: enamel, accent: red, glow: violet }, 0.42);
  } else if (defId === 'chernobog_confiscation_act') {
    rect(t, 22, 18, 43, 24, enamel, seed + 167, 218);
    rect(t, 23, 26, 42, 41, [44, 36, 30], seed + 168, 206);
    ellipse(t, 32, 34, 5.4, 5.0, ink, seed + 169, 240);
    for (let i = 0; i < 5; i++) {
      const x = 25 + i * 3.4;
      line(t, x, 29 - (i === 2 ? 2 : 0), x + 1.6, 21 + (i & 1), 1.2, ink, seed + 170 + i, 238);
    }
    line(t, 31, 38, 27, 45, 1.3, ink, seed + 176, 225);
    line(t, 34, 38, 40, 44, 1.3, ink, seed + 177, 225);
    rect(t, 35, 20, 45, 25, red, seed + 178, 210);
    rect(t, 37, 22, 43, 23, enamel, seed + 179, 220);
    line(t, 21, 42, 45, 28, 0.9, violet, seed + 180, 155);
  } else if (defId === 'chernobog_external_cell_index') {
    rect(t, 21, 17, 45, 45, enamel, seed + 167, 220);
    rect(t, 22, 19, 27, 45, [68, 58, 48], seed + 168, 230);
    for (let y = 22; y <= 41; y += 4) {
      rect(t, 29, y, 42 - ((seed + y) & 3), y + 1, ink, 0, 150);
      rect(t, 23, y, 26, y + 1, (y & 4) === 0 ? violet : blue, seed + 169 + y, 205);
    }
    rect(t, 33, 24, 43, 28, ink, 0, 204);
    rect(t, 35, 34, 44, 38, violet, seed + 180, 188);
    rect(t, 37, 35, 42, 36, enamel, seed + 181, 205);
    line(t, 22, 45, 46, 44, 0.9, blue, seed + 182, 160);
    drawEye(t, 26, 18, seed, { body: concrete, dark: ink, light: enamel, accent: red, glow: blue }, 0.34);
  } else if (defId === 'chernobog_liquidator_memo') {
    rect(t, 22, 17, 43, 22, enamel, seed + 167, 224);
    rect(t, 23, 24, 26, 43, red, seed + 168, 232);
    for (let y = 27; y <= 41; y += 5) rect(t, 30, y, 42 - ((seed + y) & 3), y + 1, ink, 0, 150);
    rect(t, 34, 36, 43, 39, violet, seed + 169, 190);
    drawEye(t, 39, 31, seed, { body: concrete, dark: ink, light: enamel, accent: red, glow: blue }, 0.45);
  } else if (defId === 'chernobog_redacted_central_note') {
    rect(t, 22, 18, 43, 20, ink, 0, 190);
    rect(t, 23, 25, 45, 30, ink, 0, 242);
    rect(t, 22, 34, 40, 39, ink, 0, 238);
    rect(t, 24, 44, 45, 46, ink, 0, 210);
    line(t, 24, 31, 43, 31, 0.8, blue, seed + 170, 185);
    line(t, 25, 41, 42, 42, 0.8, violet, seed + 171, 170);
    rect(t, 38, 22, 45, 24, red, seed + 172, 190);
  } else {
    for (let y = 21; y <= 42; y += 5) rect(t, 23, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 145);
    line(t, 22, 25, 46, 20, 1.3, red, seed + 173, 230);
    line(t, 23, 35, 43, 29, 1.2, red, seed + 174, 220);
    rect(t, 36, 40, 44, 44, violet, seed + 175, 195);
    rect(t, 24, 44, 31, 46, blue, seed + 176, 172);
  }

  rect(t, 31, 48, 39, 50, rust, seed + 177, 145);
  drawNoiseDust(t, seed + 178, rust, 11);
  drawNoiseDust(t, seed + 179, violet, 8);
}

function drawBarrelPartSprite(t: Uint32Array, seed: number): void {
  const darkSteel: [number, number, number] = [30, 34, 32];
  const steel: [number, number, number] = [82, 88, 80];
  const wornEdge: [number, number, number] = [156, 150, 122];
  const rust: [number, number, number] = [142, 65, 34];
  const ochre: [number, number, number] = [184, 132, 48];
  const grime: [number, number, number] = [58, 56, 44];

  ellipse(t, 34, 53, 18, 4, grime, seed + 160, 90);
  line(t, 13, 43, 51, 24, 5.8, darkSteel, seed + 161, 252);
  line(t, 16, 42, 49, 25, 3.8, steel, seed + 162, 248);
  line(t, 20, 39, 45, 27, 1.2, wornEdge, seed + 163, 220);
  line(t, 21, 44, 48, 30, 1.1, darkSteel, seed + 164, 190);

  ellipse(t, 13, 43, 5.4, 4.2, rust, seed + 165, 245);
  ellipse(t, 13, 43, 2.6, 1.9, [8, 9, 8], 0, 235);
  ellipse(t, 51, 24, 4.7, 3.4, darkSteel, seed + 166, 235);
  ellipse(t, 51, 24, 2.3, 1.4, [5, 6, 5], 0, 230);

  rect(t, 26, 34, 37, 39, ochre, seed + 167, 220);
  line(t, 27, 35, 36, 38, 0.8, darkSteel, seed + 168, 145);
  line(t, 34, 31, 45, 25, 1.2, rust, seed + 169, 200);
  line(t, 17, 45, 26, 49, 1.1, rust, seed + 170, 185);

  for (let i = 0; i < 18; i++) {
    const x = 13 + Math.floor(noise(i, 52, seed) * 39);
    const y = 23 + Math.floor(noise(i, 53, seed) * 26);
    const color = (i & 1) === 0 ? rust : wornEdge;
    ellipse(t, x, y, 1.1, 1.1, color, seed + 171 + i, (i & 1) === 0 ? 165 : 105);
  }
  drawNoiseDust(t, seed + 190, [118, 110, 88], 16);
}

function drawAsbestosCordSprite(t: Uint32Array, seed: number): void {
  const asbestosDark: [number, number, number] = [70, 66, 54];
  const asbestosBody: [number, number, number] = [150, 142, 112];
  const asbestosLight: [number, number, number] = [214, 204, 166];
  const rust: [number, number, number] = [148, 70, 36];
  const stamp: [number, number, number] = [196, 146, 62];
  const damp: [number, number, number] = [46, 54, 46];

  ellipse(t, 31, 38, 19, 11, damp, seed + 215, 92);
  ellipse(t, 30, 35, 18, 14, asbestosDark, seed + 216, 238);
  ellipse(t, 30, 35, 15, 11, asbestosBody, seed + 217, 248);
  ellipse(t, 30, 35, 8, 5, damp, seed + 218, 235);
  ellipse(t, 30, 35, 5, 3, [24, 28, 24], seed + 219, 230);

  line(t, 15, 35, 46, 31, 1.6, asbestosLight, seed + 220, 170);
  line(t, 17, 42, 43, 38, 1.2, asbestosDark, seed + 221, 135);
  line(t, 21, 25, 41, 44, 1.1, asbestosLight, seed + 222, 120);
  line(t, 18, 45, 42, 24, 1.0, asbestosDark, seed + 223, 120);

  line(t, 40, 31, 55, 24, 4.0, asbestosDark, seed + 224, 235);
  line(t, 40, 30, 54, 24, 2.5, asbestosBody, seed + 225, 252);
  line(t, 45, 27, 53, 23, 1.0, asbestosLight, seed + 226, 170);
  rect(t, 45, 25, 53, 31, rust, seed + 227, 235);
  rect(t, 46, 27, 52, 28, stamp, seed + 228, 210);
  rect(t, 48, 31, 51, 33, asbestosDark, seed + 229, 190);

  line(t, 17, 38, 10, 43, 2.0, asbestosDark, seed + 230, 220);
  line(t, 17, 38, 11, 42, 1.1, asbestosLight, seed + 231, 180);
  px(t, 10, 43, rgba(asbestosLight[0], asbestosLight[1], asbestosLight[2], 180));
  px(t, 12, 44, rgba(rust[0], rust[1], rust[2], 150));

  for (let i = 0; i < 13; i++) {
    const x = 16 + Math.floor(noise(i, 43, seed) * 34);
    const y = 24 + Math.floor(noise(i, 44, seed) * 22);
    const c = (i & 1) === 0 ? asbestosLight : rust;
    ellipse(t, x, y, 1.0, 1.0, c, seed + 232 + i, (i & 1) === 0 ? 115 : 145);
  }
}

function drawCeramicShardsPackSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [126, 96, 62];
  const paperLight: [number, number, number] = [174, 130, 72];
  const paperDark: [number, number, number] = [58, 42, 30];
  const ceramic: [number, number, number] = [214, 218, 202];
  const ceramicBlue: [number, number, number] = [126, 154, 168];
  const ceramicDark: [number, number, number] = [78, 86, 82];
  const rust: [number, number, number] = [140, 66, 34];
  const stamp: [number, number, number] = [176, 52, 42];

  ellipse(t, 33, 52, 18, 4, [24, 24, 20], seed + 245, 82);
  rect(t, 17, 28, 48, 51, paperDark, seed + 246, 230);
  rect(t, 19, 24, 46, 49, paper, seed + 247, 244);
  clearRect(t, 19, 24, 22, 28);
  clearRect(t, 43, 24, 46, 29);
  line(t, 19, 31, 46, 27, 1.0, paperLight, seed + 248, 170);
  line(t, 21, 48, 45, 26, 0.9, paperDark, seed + 249, 135);
  rect(t, 25, 38, 43, 44, stamp, seed + 250, 205);
  rect(t, 28, 40, 40, 41, ceramic, seed + 251, 220);

  const xs = [20, 27, 33, 40, 47];
  const ys = [24, 17, 22, 15, 26];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    line(t, x, y + 13, x + 6, y + 1, 2.8, ceramicDark, seed + 252 + i, 215);
    line(t, x + 1, y + 12, x + 6, y + 2, 1.8, i === 2 ? ceramicBlue : ceramic, seed + 260 + i, 246);
    rect(t, x + 1, y + 9, x + 4, y + 11, i === 1 ? ceramicBlue : ceramic, seed + 270 + i, 228);
    px(t, x + 6, y + 1, rgba(ceramic[0], ceramic[1], ceramic[2], 220));
  }
  rect(t, 37, 20, 49, 23, rust, seed + 276, 180);
  drawNoiseDust(t, seed + 277, rust, 12);
  drawNoiseDust(t, seed + 278, ceramic, 11);
}

function drawElectrodePackSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [156, 126, 72];
  const paperLight: [number, number, number] = [212, 174, 92];
  const paperDark: [number, number, number] = [58, 42, 30];
  const steel: [number, number, number] = [126, 136, 126];
  const steelLight: [number, number, number] = [202, 208, 186];
  const red: [number, number, number] = [166, 42, 36];
  const cyan: [number, number, number] = [70, 176, 184];
  const rust: [number, number, number] = [132, 68, 36];

  ellipse(t, 33, 53, 18, 4, [20, 18, 16], seed + 279, 84);
  for (let i = 0; i < 6; i++) {
    const y = 19 + i * 3;
    line(t, 17, y + 14, 48, y, 1.2, steel, seed + 280 + i, 235);
    line(t, 19, y + 13, 47, y, 0.55, steelLight, seed + 290 + i, 200);
    px(t, 48, y, rgba(cyan[0], cyan[1], cyan[2], 180));
  }
  rect(t, 17, 31, 50, 49, paperDark, seed + 300, 225);
  rect(t, 19, 27, 48, 46, paper, seed + 301, 245);
  rect(t, 22, 25, 45, 31, paperLight, seed + 302, 230);
  outlineRect(t, 19, 27, 48, 46, paperDark);
  clearRect(t, 19, 27, 22, 30);
  clearRect(t, 46, 27, 48, 32);
  rect(t, 23, 35, 44, 41, red, seed + 303, 218);
  rect(t, 26, 37, 41, 38, steelLight, seed + 304, 210);
  rect(t, 20, 43, 48, 46, rust, seed + 305, 110);
  for (let i = 0; i < 5; i++) {
    const y = 19 + i * 2.4;
    line(t, 15, y + 11, 47, y, 1.0, steel, seed + 311 + i, 225);
    line(t, 17, y + 10, 46, y, 0.45, steelLight, seed + 316 + i, 210);
    px(t, 48, Math.round(y), rgba(cyan[0], cyan[1], cyan[2], 210));
  }
  line(t, 21, 31, 47, 45, 0.8, paperDark, seed + 306, 120);
  line(t, 28, 27, 28, 45, 0.8, paperDark, seed + 307, 95);
  for (let i = 0; i < 4; i++) {
    const y = 17 + i * 3;
    line(t, 24, y + 11, 50, y, 1.0, steel, seed + 311 + i, 220);
    rect(t, 47, y, 51, y + 2, cyan, seed + 315 + i, 205);
  }
  rect(t, 18, 43, 49, 48, paper, seed + 319, 238);
  rect(t, 23, 36, 44, 40, paperLight, seed + 320, 222);
  rect(t, 41, 22, 51, 25, rust, seed + 308, 160);
  drawNoiseDust(t, seed + 309, rust, 12);
  drawNoiseDust(t, seed + 310, steelLight, 10);
}

function drawOzkPatchSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [66, 88, 58];
  const rubberLight: [number, number, number] = [104, 132, 82];
  const dark: [number, number, number] = [24, 34, 26];
  const adhesive: [number, number, number] = [182, 164, 104];
  const ochre: [number, number, number] = [176, 118, 46];
  const rust: [number, number, number] = [118, 62, 34];

  rect(t, 15, 20, 49, 48, rubber, seed + 1360, 248);
  rect(t, 19, 23, 45, 45, rubberLight, seed + 1361, 160);
  outlineRect(t, 15, 20, 49, 48, dark);
  clearRect(t, 15, 20, 19, 23);
  clearRect(t, 47, 21, 49, 25);
  clearRect(t, 16, 45, 19, 48);
  rect(t, 13, 18, 51, 22, adhesive, seed + 1362, 215);
  rect(t, 13, 46, 51, 50, adhesive, seed + 1363, 202);
  for (let x = 20; x <= 44; x += 5) {
    px(t, x, 22, rgba(dark[0], dark[1], dark[2], 140));
    px(t, x, 46, rgba(dark[0], dark[1], dark[2], 140));
  }
  line(t, 20, 25, 43, 43, 0.9, dark, seed + 1364, 120);
  line(t, 23, 43, 44, 26, 0.8, ochre, seed + 1365, 145);
  rect(t, 24, 31, 39, 37, ochre, seed + 1366, 135);
  rect(t, 26, 33, 37, 35, adhesive, seed + 1367, 165);
  drawNoiseDust(t, seed + 1368, rust, 13);
  drawNoiseDust(t, seed + 1369, adhesive, 8);
}

function drawMagazinePartSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [18, 22, 22];
  const steel: [number, number, number] = [88, 98, 96];
  const steelLight: [number, number, number] = [164, 172, 158];
  const spring: [number, number, number] = [190, 186, 142];
  const red: [number, number, number] = [166, 42, 34];
  const rust: [number, number, number] = [130, 66, 34];
  const ochre: [number, number, number] = [190, 132, 52];

  ellipse(t, 33, 53, 18, 4, [12, 12, 10], seed + 1370, 82);
  rect(t, 18, 31, 36, 50, dark, seed + 1371, 238);
  rect(t, 21, 29, 39, 47, steel, seed + 1372, 246);
  rect(t, 24, 31, 36, 35, steelLight, seed + 1373, 175);
  outlineRect(t, 21, 29, 39, 47, dark);
  clearRect(t, 21, 29, 24, 32);
  clearRect(t, 37, 29, 39, 34);
  line(t, 23, 46, 38, 31, 0.9, rust, seed + 1374, 135);
  line(t, 37, 20, 47, 18, 1.8, steelLight, seed + 1375, 228);
  line(t, 38, 24, 49, 22, 1.8, steelLight, seed + 1376, 228);
  rect(t, 45, 17, 51, 24, dark, seed + 1377, 160);
  for (let i = 0; i < 6; i++) {
    const x0 = 17 + i * 5;
    const y0 = 21 + (i & 1) * 4;
    line(t, x0, y0, x0 + 5, y0 + ((i & 1) ? -4 : 4), 0.9, spring, seed + 1378 + i, 218);
  }
  rect(t, 15, 21, 22, 24, red, seed + 1385, 200);
  rect(t, 29, 23, 43, 26, ochre, seed + 1386, 160);
  drawNoiseDust(t, seed + 1387, rust, 13);
  drawNoiseDust(t, seed + 1388, steelLight, 8);
}

function drawRailSpikePackSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [150, 124, 74];
  const paperLight: [number, number, number] = [204, 174, 104];
  const oil: [number, number, number] = [46, 46, 34];
  const steel: [number, number, number] = [112, 118, 108];
  const steelLight: [number, number, number] = [178, 180, 158];
  const rust: [number, number, number] = [136, 64, 34];
  const red: [number, number, number] = [166, 42, 36];

  rect(t, 15, 27, 50, 47, paper, seed + 1389, 246);
  rect(t, 18, 22, 47, 31, paperLight, seed + 1390, 226);
  outlineRect(t, 15, 27, 50, 47, oil);
  clearRect(t, 15, 27, 19, 30);
  clearRect(t, 48, 28, 50, 33);
  clearRect(t, 16, 44, 20, 47);
  rect(t, 17, 40, 49, 47, oil, seed + 1391, 82);
  line(t, 18, 30, 48, 44, 0.8, oil, seed + 1392, 128);

  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 6;
    const y0 = 16 + (i & 1) * 3;
    const y1 = 47 - ((i + 1) & 1) * 2;
    line(t, x + 1, y0, x + 4, y1, 1.45, oil, seed + 1393 + i, 220);
    line(t, x + 2, y0 + 1, x + 5, y1 - 2, 0.95, steel, seed + 1398 + i, 245);
    rect(t, x - 1, y0, x + 6, y0 + 2, steelLight, seed + 1403 + i, 230);
    px(t, x + 5, y1, rgba(oil[0], oil[1], oil[2], 230));
    if ((i & 1) === 0) rect(t, x + 1, y0 + 12, x + 4, y0 + 14, rust, seed + 1408 + i, 190);
  }

  rect(t, 32, 34, 45, 37, red, seed + 1413, 182);
  rect(t, 35, 35, 43, 36, paperLight, seed + 1414, 175);
  drawNoiseDust(t, seed + 1415, rust, 14);
  drawNoiseDust(t, seed + 1416, steelLight, 8);
}

function drawRailSwitchHandleSprite(t: Uint32Array, seed: number): void {
  const metalDark: [number, number, number] = [24, 30, 30];
  const metal: [number, number, number] = [78, 86, 78];
  const metalLight: [number, number, number] = [150, 154, 132];
  const yellow: [number, number, number] = [218, 158, 48];
  const yellowLight: [number, number, number] = [238, 190, 74];
  const red: [number, number, number] = [176, 42, 34];
  const rust: [number, number, number] = [138, 66, 34];

  ellipse(t, 23, 47, 10, 8, metalDark, seed + 1417, 246);
  ellipse(t, 24, 46, 6.8, 5.2, metal, seed + 1418, 238);
  ellipse(t, 24, 46, 2.6, 2.2, metalLight, seed + 1419, 170);
  line(t, 24, 44, 41, 24, 5.0, metalDark, seed + 1420, 248);
  line(t, 26, 42, 40, 25, 3.0, metal, seed + 1421, 246);
  line(t, 29, 39, 40, 25, 1.0, metalLight, seed + 1422, 190);
  line(t, 38, 24, 52, 14, 5.2, yellow, seed + 1423, 246);
  line(t, 39, 23, 51, 15, 2.1, yellowLight, seed + 1424, 185);
  rect(t, 43, 15, 53, 20, red, seed + 1425, 190);
  rect(t, 20, 42, 31, 45, red, seed + 1426, 160);
  line(t, 18, 50, 39, 28, 0.9, rust, seed + 1427, 140);
  rect(t, 33, 29, 38, 31, rust, seed + 1428, 168);
  drawNoiseDust(t, seed + 1429, rust, 11);
  drawNoiseDust(t, seed + 1430, yellowLight, 7);
}

function drawRollerBrushSprite(t: Uint32Array, seed: number): void {
  const handle: [number, number, number] = [86, 54, 34];
  const handleLight: [number, number, number] = [142, 88, 42];
  const metal: [number, number, number] = [96, 108, 104];
  const metalLight: [number, number, number] = [174, 180, 162];
  const nap: [number, number, number] = [184, 176, 132];
  const paint: [number, number, number] = [182, 42, 36];
  const ochre: [number, number, number] = [218, 158, 48];
  const grime: [number, number, number] = [44, 50, 44];
  const rust: [number, number, number] = [128, 66, 38];

  ellipse(t, 33, 53, 17, 4, [12, 10, 8], seed + 2521, 82);
  line(t, 19, 50, 33, 35, 4.4, grime, seed + 2522, 240);
  line(t, 20, 49, 33, 36, 2.6, handle, seed + 2523, 238);
  line(t, 21, 47, 31, 37, 0.9, handleLight, seed + 2524, 180);
  line(t, 33, 35, 43, 27, 2.2, metal, seed + 2525, 230);
  line(t, 36, 34, 44, 28, 0.8, metalLight, seed + 2526, 210);
  rect(t, 24, 19, 49, 29, grime, seed + 2527, 230);
  rect(t, 20, 16, 47, 27, nap, seed + 2528, 250);
  outlineRect(t, 20, 16, 47, 27, grime);
  clearRect(t, 20, 16, 23, 19);
  clearRect(t, 45, 17, 47, 21);
  for (let x = 22; x <= 45; x += 4) line(t, x, 17, x + 2, 27, 0.7, [232, 218, 168], seed + x, 98);
  rect(t, 22, 22, 45, 27, paint, seed + 2529, 205);
  rect(t, 24, 23, 42, 24, ochre, seed + 2530, 145);
  ellipse(t, 47, 31, 5.5, 3.0, paint, seed + 2531, 132);
  line(t, 22, 29, 44, 25, 0.9, rust, seed + 2532, 130);
  drawNoiseDust(t, seed + 2533, rust, 9);
}

function drawRepairSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId === 'roller_brush') {
    drawRollerBrushSprite(t, seed);
    return;
  }
  if (defId === 'rail_spike_pack') {
    drawRailSpikePackSprite(t, seed);
    return;
  }
  if (defId === 'rail_switch_handle') {
    drawRailSwitchHandleSprite(t, seed);
    return;
  }
  if (defId === 'ozk_patch') {
    drawOzkPatchSprite(t, seed);
    return;
  }
  if (defId === 'magazine_part') {
    drawMagazinePartSprite(t, seed);
    return;
  }
  if (defId === 'ceramic_shards_pack') {
    drawCeramicShardsPackSprite(t, seed);
    return;
  }
  if (defId === 'barrel_part') {
    drawBarrelPartSprite(t, seed);
    return;
  }
  if (defId === 'asbestos_cord') {
    drawAsbestosCordSprite(t, seed);
    return;
  }
  if (defId === 'electrode_pack') {
    drawElectrodePackSprite(t, seed);
    return;
  }
  if (defId.includes('tape') || defId.includes('cord') || defId.includes('tube')) {
    ellipse(t, 31, 35, 14, 11, p.body, seed + 171);
    ellipse(t, 31, 35, 7, 5, p.dark, seed + 172);
    rect(t, 35, 31, 49, 39, p.light, seed + 173);
    return;
  }
  rect(t, 19, 31, 45, 44, p.body, seed + 174);
  line(t, 22, 28, 42, 50, 2.4, p.dark, seed + 175);
  line(t, 42, 18, 23, 47, 1.7, p.light, seed + 176);
}

function drawKeySprite(t: Uint32Array, seed: number, p: Palette): void {
  const brass: [number, number, number] = [176, 130, 48];
  const brassLight: [number, number, number] = [232, 186, 84];
  const brassDark: [number, number, number] = [78, 54, 26];
  const tag: [number, number, number] = [196, 174, 108];
  const red: [number, number, number] = [154, 42, 36];
  const rust: [number, number, number] = [126, 66, 36];
  const grime: [number, number, number] = [62, 74, 58];

  ellipse(t, 33, 53, 15, 3, [18, 16, 12], seed + 181, 78);
  ellipse(t, 22, 31, 9, 9, brass, seed + 182, 250);
  ellipse(t, 22, 31, 4.5, 4.5, [4, 5, 4], 0, 240);
  line(t, 29, 32, 51, 32, 2.7, brassLight, seed + 183, 248);
  line(t, 29, 34, 51, 34, 1.2, brassDark, seed + 184, 205);
  rect(t, 43, 32, 47, 41, brass, seed + 185, 248);
  rect(t, 49, 32, 53, 37, brass, seed + 186, 248);
  rect(t, 44, 39, 49, 42, brassDark, seed + 187, 210);
  rect(t, 27, 23, 39, 28, tag, seed + 188, 220);
  rect(t, 30, 25, 37, 26, p.dark, 0, 118);
  rect(t, 35, 23, 42, 26, red, seed + 189, 165);
  line(t, 20, 40, 45, 31, 0.8, grime, seed + 190, 110);
  drawNoiseDust(t, seed + 191, rust, 8);
}

function drawBookSprite(t: Uint32Array, seed: number): void {
  const cover: [number, number, number] = [124, 58, 42];
  const coverLight: [number, number, number] = [168, 82, 52];
  const coverDark: [number, number, number] = [42, 28, 24];
  const paper: [number, number, number] = [190, 174, 126];
  const paperLight: [number, number, number] = [226, 210, 160];
  const ochre: [number, number, number] = [186, 130, 50];
  const damp: [number, number, number] = [58, 76, 64];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 52, 17, 4, [20, 18, 16], seed + 181, 84);
  rect(t, 17, 15, 48, 52, coverDark, seed + 182, 246);
  rect(t, 20, 12, 50, 48, paper, seed + 183, 236);
  rect(t, 23, 15, 47, 44, paperLight, seed + 184, 206);
  outlineRect(t, 20, 12, 50, 48, coverDark);
  rect(t, 16, 17, 24, 53, cover, seed + 185, 250);
  rect(t, 20, 18, 46, 52, coverLight, seed + 186, 244);
  outlineRect(t, 16, 17, 46, 53, coverDark);
  line(t, 24, 18, 24, 52, 1.2, coverDark, seed + 187, 150);
  line(t, 18, 20, 21, 50, 0.8, ochre, seed + 188, 180);

  for (let y = 23; y <= 43; y += 5) {
    rect(t, 28, y, 43 - ((seed + y) & 4), y + 1, coverDark, 0, 115);
  }
  rect(t, 29, 30, 41, 37, ochre, seed + 189, 215);
  rect(t, 31, 32, 39, 33, paperLight, seed + 190, 190);
  line(t, 20, 51, 46, 48, 0.9, damp, seed + 191, 125);
  clearRect(t, 20, 12, 23, 14);
  clearRect(t, 48, 13, 50, 17);
  clearRect(t, 16, 50, 19, 53);
  drawNoiseDust(t, seed + 192, rust, 10);
  drawNoiseDust(t, seed + 193, damp, 12);
  px(t, 45, 19, rgba(226, 194, 112, 165));
}

function drawBorrowedKitchenKeySprite(t: Uint32Array, seed: number): void {
  const brass: [number, number, number] = [174, 128, 48];
  const brassLight: [number, number, number] = [232, 184, 82];
  const brassDark: [number, number, number] = [78, 54, 26];
  const tag: [number, number, number] = [188, 174, 120];
  const tagLight: [number, number, number] = [226, 210, 154];
  const red: [number, number, number] = [154, 44, 38];
  const grime: [number, number, number] = [62, 78, 64];
  const rust: [number, number, number] = [130, 68, 36];

  ellipse(t, 34, 53, 15, 3, [18, 18, 14], seed + 198, 80);
  ellipse(t, 20, 31, 8.8, 8.8, brass, seed + 199, 248);
  ellipse(t, 20, 31, 4.6, 4.6, [4, 5, 4], 0, 238);
  line(t, 27, 32, 51, 32, 2.4, brassLight, seed + 200, 246);
  line(t, 27, 34, 51, 34, 1.2, brassDark, seed + 201, 200);
  rect(t, 44, 32, 47, 41, brass, seed + 202, 246);
  rect(t, 49, 32, 53, 38, brass, seed + 203, 246);
  rect(t, 45, 39, 49, 42, brassDark, seed + 204, 205);
  px(t, 52, 37, rgba(brassLight[0], brassLight[1], brassLight[2], 210));

  line(t, 22, 35, 28, 43, 0.8, brassDark, seed + 205, 180);
  rect(t, 24, 42, 41, 55, tag, seed + 206, 238);
  rect(t, 26, 44, 39, 48, tagLight, seed + 207, 205);
  outlineRect(t, 24, 42, 41, 55, brassDark);
  clearRect(t, 24, 42, 26, 44);
  clearRect(t, 39, 42, 41, 45);
  rect(t, 28, 50, 37, 51, red, seed + 208, 210);
  rect(t, 28, 52, 35, 53, grime, seed + 209, 150);
  line(t, 25, 42, 40, 55, 0.7, grime, seed + 210, 105);

  rect(t, 32, 29, 42, 31, red, seed + 211, 165);
  drawNoiseDust(t, seed + 212, rust, 8);
  drawNoiseDust(t, seed + 213, grime, 8);
}

function drawContainerKeyLabelSprite(t: Uint32Array, seed: number): void {
  const tag: [number, number, number] = [190, 174, 112];
  const tagLight: [number, number, number] = [228, 210, 142];
  const ink: [number, number, number] = [42, 34, 24];
  const string: [number, number, number] = [104, 94, 68];
  const red: [number, number, number] = [166, 42, 36];
  const damp: [number, number, number] = [68, 82, 66];
  const rust: [number, number, number] = [122, 66, 36];

  line(t, 28, 13, 22, 24, 1.2, string, seed + 214, 205);
  line(t, 28, 13, 37, 24, 1.0, string, seed + 215, 190);
  ellipse(t, 28, 13, 3.6, 3.6, string, seed + 216, 210);
  ellipse(t, 28, 13, 1.5, 1.5, [0, 0, 0], 0, 0);
  rect(t, 18, 23, 47, 51, tag, seed + 217, 246);
  rect(t, 21, 26, 44, 31, tagLight, seed + 218, 220);
  outlineRect(t, 18, 23, 47, 51, ink);
  clearRect(t, 18, 23, 21, 26);
  clearRect(t, 45, 23, 47, 27);
  clearRect(t, 19, 48, 22, 51);
  ellipse(t, 25, 29, 3.6, 3.6, ink, seed + 219, 225);
  ellipse(t, 25, 29, 1.6, 1.6, [0, 0, 0], 0, 0);
  for (let y = 34; y <= 43; y += 4) rect(t, 27, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 128);
  rect(t, 31, 45, 43, 48, red, seed + 220, 190);
  rect(t, 33, 46, 40, 47, tagLight, seed + 221, 215);
  ellipse(t, 22, 48, 7, 3.4, damp, seed + 222, 95);
  line(t, 20, 50, 46, 47, 0.8, rust, seed + 223, 124);
  drawNoiseDust(t, seed + 224, rust, 10);
}

function drawAlcoholBottleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [118, 128, 110];
  const glassLight: [number, number, number] = [184, 190, 158];
  const glassDark: [number, number, number] = [42, 50, 42];
  const dullRed: [number, number, number] = [158, 48, 42];
  const ochre: [number, number, number] = [188, 132, 52];
  const stain: [number, number, number] = [54, 62, 48];

  ellipse(t, 32, 52, 11, 3, stain, seed + 184, 95);
  rect(t, 30, 12, 35, 18, glassDark, seed + 185);
  rect(t, 29, 18, 36, 27, glassLight, seed + 186, 205);
  ellipse(t, 32, 27, 12, 5, glassLight, seed + 187, 215);
  rect(t, 22, 27, 42, 50, glass, seed + 188, 222);
  ellipse(t, 32, 50, 11, 4, glassDark, seed + 189, 170);
  outlineRect(t, 22, 27, 42, 50, glassDark);
  line(t, 26, 27, 26, 48, 0.8, glassLight, seed + 190, 130);
  line(t, 36, 23, 38, 48, 0.8, glassDark, seed + 191, 120);

  rect(t, 24, 32, 41, 41, dullRed, seed + 192, 230);
  rect(t, 28, 35, 37, 36, ochre, seed + 193, 220);
  rect(t, 28, 38, 35, 39, glassDark, seed + 194, 150);
  rect(t, 38, 25, 44, 33, ochre, seed + 195, 230);
  line(t, 37, 25, 42, 31, 0.8, glassDark, seed + 196, 150);

  ellipse(t, 24, 38, 2.1, 3.1, [0, 0, 0], 0, 0);
  px(t, 31, 15, rgba(220, 216, 178, 190));
  px(t, 26, 45, rgba(228, 212, 152, 170));
  drawNoiseDust(t, seed + 197, ochre, 11);
}

function drawAcidBottleSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [106, 112, 94];
  const glassLight: [number, number, number] = [174, 178, 140];
  const glassDark: [number, number, number] = [38, 44, 34];
  const acid: [number, number, number] = [150, 132, 52];
  const acidLight: [number, number, number] = [196, 168, 70];
  const dullRed: [number, number, number] = [142, 46, 42];
  const ochre: [number, number, number] = [176, 142, 62];
  const stain: [number, number, number] = [62, 74, 42];

  ellipse(t, 34, 52, 13, 3, stain, seed + 198, 100);
  rect(t, 28, 10, 36, 15, glassDark, seed + 199);
  rect(t, 29, 14, 35, 24, glassLight, seed + 200, 210);
  ellipse(t, 32, 25, 11, 5, glassLight, seed + 201, 200);
  rect(t, 21, 26, 43, 51, glass, seed + 202, 222);
  outlineRect(t, 21, 26, 43, 51, glassDark);
  rect(t, 24, 36, 40, 49, acid, seed + 203, 215);
  line(t, 24, 36, 40, 35, 1.1, acidLight, seed + 204, 210);
  line(t, 28, 27, 27, 48, 0.8, glassLight, seed + 205, 135);
  line(t, 37, 23, 39, 48, 0.8, glassDark, seed + 206, 130);

  rect(t, 25, 28, 39, 34, dullRed, seed + 207, 235);
  line(t, 28, 33, 36, 29, 0.9, [50, 28, 24], seed + 208, 220);
  line(t, 30, 29, 37, 33, 0.9, [50, 28, 24], seed + 209, 210);
  line(t, 36, 21, 47, 24, 0.8, glassDark, seed + 210, 190);
  rect(t, 45, 22, 51, 28, ochre, seed + 211, 230);
  rect(t, 46, 24, 50, 25, dullRed, seed + 212, 210);
  line(t, 41, 31, 39, 48, 1, [88, 116, 70], seed + 213, 120);

  for (let i = 0; i < 6; i++) {
    const x = 22 + Math.floor(noise(i, 21, seed) * 20);
    const y = 24 + Math.floor(noise(i, 22, seed) * 25);
    px(t, x, y, CLEAR);
  }
  px(t, 31, 14, rgba(220, 216, 170, 180));
  px(t, 25, 45, rgba(216, 188, 82, 175));
  drawNoiseDust(t, seed + 214, ochre, 10);
}

function drawBallotSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [188, 174, 126];
  const paperLight: [number, number, number] = [224, 210, 164];
  const edge: [number, number, number] = [50, 46, 36];
  const ink: [number, number, number] = [32, 30, 24];
  const red: [number, number, number] = [166, 42, 36];
  const ochre: [number, number, number] = [184, 126, 44];
  const damp: [number, number, number] = [70, 84, 70];
  const concrete: [number, number, number] = [96, 94, 82];

  rect(t, 16, 9, 48, 54, paper, seed + 215, 246);
  rect(t, 19, 12, 45, 18, paperLight, seed + 216, 228);
  outlineRect(t, 16, 9, 48, 54, edge);

  clearRect(t, 16, 9, 19, 12);
  clearRect(t, 46, 10, 48, 16);
  clearRect(t, 16, 50, 19, 54);
  line(t, 44, 10, 48, 16, 0.8, edge, seed + 217, 190);
  rect(t, 43, 13, 47, 17, paperLight, seed + 218, 205);

  rect(t, 48, 22, 53, 31, ochre, seed + 219, 232);
  rect(t, 49, 25, 53, 26, edge, 0, 125);
  line(t, 47, 22, 53, 31, 0.65, edge, seed + 220, 150);

  rect(t, 21, 22, 31, 33, paperLight, seed + 221, 218);
  outlineRect(t, 21, 22, 31, 33, edge);
  line(t, 23, 28, 26, 32, 1.1, red, seed + 222, 245);
  line(t, 26, 32, 35, 22, 1.1, red, seed + 223, 245);

  rect(t, 34, 24, 43, 25, ink, 0, 125);
  rect(t, 34, 29, 42, 30, ink, 0, 105);
  for (let y = 38; y <= 48; y += 4) {
    rect(t, 21, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 115);
  }
  rect(t, 32, 42, 46, 47, red, seed + 224, 190);
  rect(t, 35, 44, 43, 45, paper, seed + 225, 225);

  ellipse(t, 26, 49, 11, 5, damp, seed + 226, 116);
  line(t, 18, 15, 46, 51, 0.75, concrete, seed + 227, 82);
  drawNoiseDust(t, seed + 228, concrete, 16);
  drawNoiseDust(t, seed + 229, red, 8);
  px(t, 23, 10, CLEAR);
  px(t, 24, 10, CLEAR);
  px(t, 45, 53, CLEAR);
}

function drawBlankFormSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [188, 174, 128];
  const paperLight: [number, number, number] = [224, 210, 164];
  const edge: [number, number, number] = [54, 48, 38];
  const ink: [number, number, number] = [36, 34, 28];
  const damp: [number, number, number] = [70, 84, 70];
  const ochre: [number, number, number] = [180, 126, 48];
  const stamp: [number, number, number] = [156, 42, 36];
  const concrete: [number, number, number] = [96, 96, 82];

  rect(t, 16, 10, 49, 54, paper, seed + 215, 245);
  rect(t, 19, 13, 45, 18, paperLight, seed + 216, 225);
  outlineRect(t, 16, 10, 49, 54, edge);

  clearRect(t, 16, 10, 19, 13);
  clearRect(t, 47, 11, 49, 17);
  clearRect(t, 16, 50, 19, 54);
  line(t, 45, 11, 49, 17, 0.8, edge, seed + 217, 200);
  rect(t, 43, 14, 47, 18, paperLight, seed + 218, 210);

  rect(t, 21, 22, 43, 33, paperLight, seed + 219, 190);
  outlineRect(t, 21, 22, 43, 33, edge);
  for (let y = 38; y <= 47; y += 4) {
    rect(t, 21, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 120);
  }
  rect(t, 22, 25, 34, 26, ink, 0, 95);
  rect(t, 22, 30, 38, 31, ink, 0, 80);

  rect(t, 33, 38, 46, 44, stamp, seed + 220, 210);
  rect(t, 36, 40, 43, 42, paper, seed + 221, 230);
  line(t, 33, 38, 46, 44, 0.7, stamp, seed + 222, 180);
  rect(t, 15, 21, 21, 29, ochre, seed + 223, 230);
  rect(t, 17, 24, 21, 25, edge, 0, 120);

  ellipse(t, 25, 48, 10, 5, damp, seed + 224, 118);
  line(t, 18, 14, 46, 51, 0.75, concrete, seed + 225, 86);
  drawNoiseDust(t, seed + 226, concrete, 15);
  drawNoiseDust(t, seed + 227, stamp, 7);
  px(t, 23, 11, CLEAR);
  px(t, 24, 11, CLEAR);
  px(t, 45, 53, CLEAR);
}

function drawCardDeckSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [206, 194, 154];
  const paperDark: [number, number, number] = [64, 54, 42];
  const back: [number, number, number] = [18, 42, 36];
  const backLight: [number, number, number] = [38, 82, 66];
  const red: [number, number, number] = [174, 42, 36];
  const ochre: [number, number, number] = [190, 142, 56];
  const grime: [number, number, number] = [46, 58, 48];

  rect(t, 18, 18, 40, 45, paperDark, seed + 260, 235);
  rect(t, 20, 16, 42, 43, paper, seed + 261, 242);
  rect(t, 22, 18, 44, 45, paperDark, seed + 262, 235);
  rect(t, 23, 19, 45, 46, back, seed + 263, 248);
  outlineRect(t, 23, 19, 45, 46, paperDark);
  rect(t, 26, 22, 42, 43, backLight, seed + 264, 210);
  for (let x = 29; x <= 40; x += 5) line(t, x, 22, x, 43, 0.65, back, seed + 265 + x, 180);
  for (let y = 26; y <= 39; y += 5) line(t, 26, y, 42, y, 0.65, back, seed + 266 + y, 180);
  ellipse(t, 34, 32, 6.3, 4.4, paper, seed + 272, 232);
  drawEye(t, 34, 32, seed + 267, { body: back, dark: paperDark, light: paper, accent: red, glow: ochre }, 0.54);
  ellipse(t, 34, 32, 6.0, 3.9, paper, seed + 272, 225);
  ellipse(t, 34, 32, 2.8, 1.7, ochre, seed + 273, 235);
  rect(t, 33, 31, 35, 33, paperDark, seed + 274, 210);
  rect(t, 29, 28, 39, 36, paper, 0, 188);
  rect(t, 32, 30, 36, 34, paperDark, 0, 225);
  line(t, 29, 32, 39, 32, 0.7, ochre, seed + 275, 220);
  rect(t, 24, 20, 28, 23, red, seed + 268, 220);
  rect(t, 40, 42, 44, 45, red, seed + 269, 190);
  ellipse(t, 24, 43, 8, 4, grime, seed + 270, 108);
  drawNoiseDust(t, seed + 271, ochre, 9);
}

function drawCardboardStackSprite(t: Uint32Array, seed: number): void {
  const cardboard: [number, number, number] = [136, 96, 54];
  const light: [number, number, number] = [190, 142, 74];
  const dark: [number, number, number] = [56, 42, 30];
  const damp: [number, number, number] = [62, 78, 60];
  const tag: [number, number, number] = [214, 190, 118];
  const stamp: [number, number, number] = [160, 44, 36];

  rect(t, 18, 35, 49, 49, dark, seed + 280, 210);
  rect(t, 16, 31, 47, 45, cardboard, seed + 281, 244);
  rect(t, 19, 26, 50, 40, light, seed + 282, 235);
  rect(t, 15, 21, 46, 35, cardboard, seed + 283, 246);
  outlineRect(t, 15, 21, 46, 35, dark);
  line(t, 16, 27, 47, 32, 0.8, dark, seed + 284, 130);
  line(t, 17, 32, 48, 37, 0.8, dark, seed + 285, 120);
  for (let y = 25; y <= 34; y += 3) line(t, 19, y, 43, y + 4, 0.65, [104, 72, 42], seed + 286 + y, 125);
  rect(t, 36, 25, 48, 33, tag, seed + 290, 235);
  rect(t, 39, 28, 46, 29, stamp, seed + 291, 210);
  ellipse(t, 24, 40, 11, 5, damp, seed + 292, 108);
  clearRect(t, 15, 21, 18, 24);
  clearRect(t, 44, 21, 46, 26);
  drawNoiseDust(t, seed + 293, dark, 13);
  drawNoiseDust(t, seed + 294, stamp, 5);
}

function drawChildMapSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [188, 170, 112];
  const paperLight: [number, number, number] = [224, 204, 142];
  const pencil: [number, number, number] = [40, 38, 34];
  const red: [number, number, number] = [176, 44, 38];
  const blue: [number, number, number] = [64, 126, 154];
  const damp: [number, number, number] = [70, 82, 66];
  const ochre: [number, number, number] = [180, 124, 48];

  rect(t, 15, 16, 50, 49, paper, seed + 230, 246);
  rect(t, 18, 12, 43, 20, paperLight, seed + 231, 236);
  rect(t, 28, 14, 50, 22, paper, seed + 232, 246);
  outlineRect(t, 15, 16, 50, 49, pencil);
  clearRect(t, 15, 16, 18, 19);
  clearRect(t, 48, 17, 50, 22);
  clearRect(t, 16, 46, 19, 49);
  line(t, 27, 15, 25, 49, 0.8, pencil, seed + 233, 95);
  line(t, 38, 17, 35, 48, 0.8, damp, seed + 234, 110);
  line(t, 17, 36, 49, 30, 0.9, pencil, seed + 235, 120);
  line(t, 21, 44, 45, 20, 1.1, blue, seed + 236, 170);
  line(t, 20, 27, 34, 24, 0.9, pencil, seed + 237, 145);
  line(t, 34, 24, 43, 34, 0.9, pencil, seed + 238, 135);
  line(t, 23, 41, 29, 35, 0.9, pencil, seed + 239, 138);
  line(t, 32, 39, 43, 43, 0.8, pencil, seed + 240, 128);
  line(t, 39, 26, 47, 22, 0.8, ochre, seed + 241, 150);
  line(t, 42, 21, 47, 26, 1.1, red, seed + 242, 235);
  line(t, 47, 21, 42, 26, 1.1, red, seed + 243, 235);
  ellipse(t, 24, 31, 2.1, 2.1, blue, seed + 244, 200);
  ellipse(t, 33, 28, 1.8, 1.8, red, seed + 245, 205);
  rect(t, 15, 43, 50, 49, damp, seed + 246, 86);
  drawNoiseDust(t, seed + 247, ochre, 12);
}

function drawCigsSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [212, 198, 154];
  const paperLight: [number, number, number] = [238, 228, 184];
  const red: [number, number, number] = [172, 42, 36];
  const ink: [number, number, number] = [28, 24, 20];
  const filter: [number, number, number] = [190, 134, 58];
  const ash: [number, number, number] = [138, 144, 130];
  const stain: [number, number, number] = [68, 72, 58];

  rect(t, 18, 22, 46, 50, paper, seed + 248, 248);
  rect(t, 20, 18, 44, 25, paperLight, seed + 249, 238);
  outlineRect(t, 18, 22, 46, 50, ink);
  clearRect(t, 18, 22, 21, 24);
  clearRect(t, 44, 22, 46, 26);
  rect(t, 20, 31, 44, 42, red, seed + 250, 238);
  rect(t, 23, 35, 39, 36, paperLight, seed + 251, 220);
  rect(t, 25, 39, 36, 40, ink, 0, 125);
  rect(t, 33, 17, 37, 47, filter, seed + 252, 230);
  rect(t, 25, 18, 29, 47, paperLight, seed + 253, 235);
  rect(t, 29, 18, 33, 47, paperLight, seed + 254, 230);
  rect(t, 37, 18, 41, 47, paperLight, seed + 255, 225);
  rect(t, 25, 17, 41, 20, ash, seed + 256, 218);
  line(t, 21, 48, 45, 45, 0.9, stain, seed + 257, 115);
  line(t, 43, 17, 50, 12, 0.8, ash, seed + 258, 130);
  line(t, 45, 16, 52, 14, 0.7, ash, seed + 259, 105);
  drawNoiseDust(t, seed + 260, stain, 10);
}

function drawCircuitBoardSprite(t: Uint32Array, seed: number): void {
  const board: [number, number, number] = [34, 92, 70];
  const boardLight: [number, number, number] = [62, 138, 96];
  const trace: [number, number, number] = [196, 158, 70];
  const solder: [number, number, number] = [164, 174, 150];
  const chip: [number, number, number] = [18, 24, 24];
  const red: [number, number, number] = [174, 46, 40];
  const rust: [number, number, number] = [118, 62, 34];

  rect(t, 17, 18, 49, 48, board, seed + 261, 248);
  rect(t, 20, 15, 45, 22, boardLight, seed + 262, 238);
  outlineRect(t, 17, 18, 49, 48, chip);
  clearRect(t, 17, 18, 20, 20);
  clearRect(t, 47, 18, 49, 23);
  clearRect(t, 17, 45, 20, 48);
  rect(t, 26, 27, 39, 38, chip, seed + 263, 248);
  for (let x = 28; x <= 37; x += 3) {
    rect(t, x, 25, x + 1, 27, solder, seed + 264 + x, 215);
    rect(t, x, 38, x + 1, 40, solder, seed + 270 + x, 205);
  }
  line(t, 20, 25, 26, 29, 0.9, trace, seed + 265, 215);
  line(t, 20, 36, 26, 34, 0.9, trace, seed + 266, 205);
  line(t, 39, 31, 46, 24, 0.9, trace, seed + 267, 215);
  line(t, 39, 36, 46, 43, 0.9, trace, seed + 268, 205);
  line(t, 23, 43, 45, 43, 0.8, trace, seed + 269, 180);
  ellipse(t, 22, 25, 2.4, 2.4, solder, seed + 280, 222);
  ellipse(t, 22, 36, 2.2, 2.2, solder, seed + 281, 214);
  ellipse(t, 46, 24, 2.4, 2.4, red, seed + 282, 220);
  ellipse(t, 46, 43, 2.2, 2.2, solder, seed + 283, 205);
  rect(t, 41, 29, 46, 35, red, seed + 284, 205);
  drawNoiseDust(t, seed + 285, rust, 12);
  drawNoiseDust(t, seed + 286, trace, 8);
}

function drawBrownSlimeCleanupActSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [190, 170, 118];
  const paperLight: [number, number, number] = [224, 204, 148];
  const ink: [number, number, number] = [34, 30, 24];
  const red: [number, number, number] = [166, 42, 34];
  const slime: [number, number, number] = [98, 58, 34];
  const slimeLight: [number, number, number] = [166, 108, 54];
  const damp: [number, number, number] = [68, 82, 72];
  const alkali: [number, number, number] = [110, 184, 128];

  rect(t, 16, 10, 49, 54, paper, seed + 860, 246);
  rect(t, 19, 13, 45, 18, paperLight, seed + 861, 220);
  outlineRect(t, 16, 10, 49, 54, ink);
  clearRect(t, 16, 10, 19, 13);
  clearRect(t, 47, 11, 49, 17);
  clearRect(t, 16, 50, 19, 54);
  rect(t, 16, 45, 49, 54, damp, seed + 862, 100);
  line(t, 18, 15, 47, 51, 0.8, damp, seed + 863, 92);
  for (let y = 23; y <= 42; y += 5) {
    rect(t, 22, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 135);
  }
  ellipse(t, 38, 34, 8, 5.6, red, seed + 864, 218);
  ellipse(t, 38, 34, 4.3, 2.8, paper, seed + 865, 226);
  line(t, 32, 34, 44, 34, 0.8, red, seed + 866, 232);
  rect(t, 29, 45, 39, 48, red, seed + 867, 176);

  ellipse(t, 23, 43, 8.5, 6.2, slime, seed + 868, 214);
  ellipse(t, 26, 42, 3.5, 2.4, [54, 28, 20], seed + 869, 205);
  line(t, 21, 45, 43, 48, 1.2, slimeLight, seed + 870, 135);
  line(t, 23, 39, 48, 44, 0.8, alkali, seed + 871, 118);
  rect(t, 42, 22, 48, 27, slime, seed + 872, 150);
  drawNoiseDust(t, seed + 873, slimeLight, 12);
  drawNoiseDust(t, seed + 874, alkali, 8);
}

function drawCaravanRouteSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [174, 158, 110];
  const paperLight: [number, number, number] = [218, 198, 136];
  const ink: [number, number, number] = [28, 26, 22];
  const red: [number, number, number] = [176, 42, 36];
  const blue: [number, number, number] = [70, 126, 150];
  const ochre: [number, number, number] = [190, 132, 50];
  const damp: [number, number, number] = [68, 84, 72];
  const rust: [number, number, number] = [124, 64, 36];

  rect(t, 13, 17, 51, 48, paper, seed + 890, 242);
  rect(t, 16, 14, 34, 21, paperLight, seed + 891, 234);
  rect(t, 34, 16, 50, 23, paper, seed + 892, 240);
  outlineRect(t, 13, 17, 51, 48, ink);
  clearRect(t, 13, 17, 16, 20);
  clearRect(t, 49, 18, 51, 22);
  clearRect(t, 14, 46, 17, 48);
  line(t, 24, 16, 22, 48, 0.8, ink, seed + 893, 95);
  line(t, 36, 17, 39, 48, 0.8, ink, seed + 894, 92);
  rect(t, 13, 42, 51, 48, damp, seed + 895, 86);

  rect(t, 18, 24, 23, 29, ink, seed + 896, 175);
  rect(t, 31, 20, 36, 25, blue, seed + 897, 205);
  rect(t, 42, 32, 47, 37, ink, seed + 898, 155);
  line(t, 21, 27, 33, 23, 1.3, red, seed + 899, 238);
  line(t, 33, 23, 44, 35, 1.3, red, seed + 900, 238);
  line(t, 23, 38, 44, 35, 1.0, ochre, seed + 901, 205);
  ellipse(t, 21, 27, 2.5, 2.5, red, seed + 902, 235);
  ellipse(t, 33, 23, 2.4, 2.4, red, seed + 903, 235);
  ellipse(t, 44, 35, 2.6, 2.6, red, seed + 904, 235);
  rect(t, 44, 20, 54, 26, ochre, seed + 905, 224);
  rect(t, 47, 22, 52, 23, ink, 0, 125);
  line(t, 43, 20, 54, 26, 0.7, ink, seed + 906, 145);
  line(t, 17, 44, 49, 45, 0.8, rust, seed + 907, 116);
  drawNoiseDust(t, seed + 908, rust, 12);
  drawNoiseDust(t, seed + 909, blue, 6);
}

function drawCultSupplyListSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [186, 166, 108];
  const light: [number, number, number] = [224, 204, 142];
  const ink: [number, number, number] = [30, 28, 22];
  const red: [number, number, number] = [166, 42, 36];
  const pot: [number, number, number] = [72, 82, 76];
  const steam: [number, number, number] = [174, 196, 176];
  const damp: [number, number, number] = [70, 86, 70];
  const ochre: [number, number, number] = [184, 128, 48];

  rect(t, 15, 14, 49, 52, paper, seed + 910, 246);
  rect(t, 18, 17, 46, 22, light, seed + 911, 220);
  outlineRect(t, 15, 14, 49, 52, ink);
  clearRect(t, 15, 14, 18, 17);
  clearRect(t, 47, 15, 49, 19);
  clearRect(t, 16, 49, 19, 52);
  rect(t, 15, 44, 49, 52, damp, seed + 912, 95);
  line(t, 18, 18, 47, 49, 0.8, damp, seed + 913, 86);

  for (let y = 25; y <= 41; y += 5) rect(t, 23, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 135);
  rect(t, 20, 24, 22, 26, red, seed + 914, 215);
  rect(t, 20, 29, 22, 31, red, seed + 915, 200);
  rect(t, 20, 34, 22, 36, red, seed + 916, 190);
  rect(t, 20, 39, 22, 41, red, seed + 917, 180);

  ellipse(t, 37, 39, 8.5, 5.5, pot, seed + 918, 228);
  rect(t, 29, 35, 45, 41, pot, seed + 919, 230);
  line(t, 29, 35, 45, 35, 0.9, light, seed + 920, 160);
  line(t, 30, 33, 27, 29, 0.7, steam, seed + 921, 118);
  line(t, 36, 32, 37, 27, 0.7, steam, seed + 922, 126);
  line(t, 43, 33, 47, 28, 0.7, steam, seed + 923, 112);
  rect(t, 40, 20, 50, 26, ochre, seed + 924, 220);
  rect(t, 43, 22, 48, 23, red, seed + 925, 190);
  line(t, 40, 20, 50, 26, 0.7, ink, seed + 926, 132);
  drawNoiseDust(t, seed + 927, ochre, 11);
}

function drawDenunciationSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 176, 118];
  const light: [number, number, number] = [230, 210, 150];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [174, 34, 32];
  const smoke: [number, number, number] = [70, 68, 58];
  const damp: [number, number, number] = [74, 84, 70];
  const ochre: [number, number, number] = [180, 126, 48];

  rect(t, 16, 12, 49, 54, paper, seed + 928, 246);
  rect(t, 19, 15, 46, 20, light, seed + 929, 220);
  outlineRect(t, 16, 12, 49, 54, ink);
  clearRect(t, 16, 12, 19, 15);
  clearRect(t, 47, 13, 49, 18);
  clearRect(t, 16, 50, 19, 54);
  line(t, 45, 14, 49, 20, 0.8, ink, seed + 930, 175);
  rect(t, 44, 16, 48, 20, light, seed + 931, 196);
  rect(t, 16, 45, 49, 54, damp, seed + 932, 96);
  line(t, 18, 17, 47, 51, 0.8, smoke, seed + 933, 92);

  rect(t, 22, 24, 40, 25, ink, 0, 165);
  rect(t, 22, 30, 44, 31, ink, 0, 145);
  rect(t, 22, 36, 37, 37, ink, 0, 130);
  rect(t, 22, 42, 42, 43, ink, 0, 122);
  line(t, 20, 47, 44, 26, 1.1, red, seed + 934, 220);
  line(t, 21, 48, 45, 27, 0.7, ink, seed + 935, 110);
  ellipse(t, 38, 35, 8.5, 6, red, seed + 936, 210);
  ellipse(t, 38, 35, 4.5, 2.8, paper, seed + 937, 225);
  rect(t, 32, 34, 44, 35, red, seed + 938, 230);
  ellipse(t, 23, 48, 6.5, 3.5, smoke, seed + 939, 125);
  rect(t, 39, 45, 47, 48, ochre, seed + 940, 140);
  drawNoiseDust(t, seed + 941, smoke, 16);
  drawNoiseDust(t, seed + 942, red, 8);
}

function drawDiceBoneSprite(t: Uint32Array, seed: number): void {
  const bone: [number, number, number] = [210, 198, 160];
  const boneLight: [number, number, number] = [240, 228, 188];
  const boneDark: [number, number, number] = [76, 66, 52];
  const greenFelt: [number, number, number] = [42, 98, 70];
  const red: [number, number, number] = [166, 40, 36];
  const grime: [number, number, number] = [70, 84, 62];

  ellipse(t, 32, 52, 17, 4, [16, 18, 14], seed + 943, 82);
  rect(t, 18, 36, 49, 48, greenFelt, seed + 944, 195);
  line(t, 18, 36, 49, 48, 0.8, boneDark, seed + 945, 105);

  rect(t, 18, 22, 35, 39, bone, seed + 946, 248);
  rect(t, 21, 19, 37, 35, boneLight, seed + 947, 242);
  outlineRect(t, 18, 22, 35, 39, boneDark);
  outlineRect(t, 21, 19, 37, 35, boneDark);
  clearRect(t, 18, 22, 20, 24);
  clearRect(t, 35, 19, 37, 22);
  ellipse(t, 26, 28, 1.6, 1.6, boneDark, seed + 948, 240);
  ellipse(t, 31, 23, 1.5, 1.5, boneDark, seed + 949, 235);
  ellipse(t, 32, 33, 1.5, 1.5, boneDark, seed + 950, 230);

  rect(t, 31, 31, 48, 48, bone, seed + 951, 248);
  rect(t, 34, 28, 50, 44, boneLight, seed + 952, 242);
  outlineRect(t, 31, 31, 48, 48, boneDark);
  outlineRect(t, 34, 28, 50, 44, boneDark);
  clearRect(t, 31, 31, 33, 33);
  clearRect(t, 48, 28, 50, 31);
  for (const [x, y] of [[39, 33], [45, 33], [39, 39], [45, 39], [42, 36]]) {
    ellipse(t, x, y, 1.4, 1.4, boneDark, seed + x + y, 238);
  }
  rect(t, 18, 42, 27, 45, red, seed + 953, 160);
  drawNoiseDust(t, seed + 954, grime, 11);
}

function drawCheckersBoardSprite(t: Uint32Array, seed: number): void {
  const boardDark: [number, number, number] = [36, 42, 38];
  const boardLight: [number, number, number] = [186, 154, 94];
  const boardWood: [number, number, number] = [120, 80, 50];
  const pieceDark: [number, number, number] = [110, 116, 110];
  const pieceLight: [number, number, number] = [210, 180, 120];
  const string: [number, number, number] = [200, 70, 60];
  const grime: [number, number, number] = [62, 70, 54];

  ellipse(t, 33, 53, 20, 4.5, [14, 15, 13], seed + 1000, 86);
  rect(t, 14, 16, 52, 50, boardWood, seed + 1001, 240);
  outlineRect(t, 14, 16, 52, 50, [24, 20, 18]);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const c = (x + y) % 2 === 1 ? boardDark : boardLight;
      rect(t, 16 + x * 4, 17 + y * 4, 19 + x * 4, 20 + y * 4, c, seed + x + y, 220);
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = 24 + Math.floor(noise(i, 8, seed) * 18);
    const y = 24 + Math.floor(noise(i, 9, seed) * 18);
    ellipse(t, x, y, 4, 2.5, i % 2 === 0 ? pieceDark : pieceLight, seed + 1005 + i, 240);
    ellipse(t, x, y, 2.5, 1.5, [40, 40, 40], seed + 1015 + i, 100);
  }
  line(t, 12, 28, 54, 38, 1.5, string, seed + 1008, 180);
  line(t, 12, 36, 54, 28, 1.5, string, seed + 1009, 180);
  drawNoiseDust(t, seed + 1010, grime, 15);
}

function drawDominoBoxSprite(t: Uint32Array, seed: number): void {
  const box: [number, number, number] = [96, 42, 32];
  const boxLight: [number, number, number] = [154, 70, 48];
  const boxDark: [number, number, number] = [46, 24, 22];
  const ivory: [number, number, number] = [226, 216, 184];
  const ivoryLight: [number, number, number] = [246, 236, 202];
  const ink: [number, number, number] = [18, 18, 16];
  const gold: [number, number, number] = [204, 154, 62];
  const grime: [number, number, number] = [62, 70, 54];

  ellipse(t, 33, 53, 18, 4.2, [14, 15, 13], seed + 964, 86);
  rect(t, 15, 26, 51, 49, box, seed + 965, 244);
  rect(t, 18, 22, 54, 44, boxLight, seed + 966, 236);
  outlineRect(t, 15, 26, 51, 49, boxDark);
  outlineRect(t, 18, 22, 54, 44, boxDark);
  clearRect(t, 15, 26, 18, 29);
  clearRect(t, 51, 22, 54, 26);
  rect(t, 22, 27, 48, 31, gold, seed + 967, 195);
  rect(t, 24, 35, 46, 37, boxDark, seed + 968, 150);
  line(t, 18, 43, 51, 26, 0.8, boxDark, seed + 969, 115);

  rect(t, 17, 14, 34, 27, ivory, seed + 970, 248);
  rect(t, 19, 12, 36, 25, ivoryLight, seed + 971, 240);
  outlineRect(t, 17, 14, 34, 27, ink);
  outlineRect(t, 19, 12, 36, 25, ink);
  rect(t, 26, 14, 27, 25, ink, 0, 210);
  for (const [x, y] of [[23, 17], [31, 21], [23, 22]]) ellipse(t, x, y, 1.2, 1.2, ink, seed + x + y, 235);

  rect(t, 36, 31, 53, 44, ivory, seed + 972, 248);
  rect(t, 38, 29, 55, 42, ivoryLight, seed + 973, 240);
  outlineRect(t, 36, 31, 53, 44, ink);
  outlineRect(t, 38, 29, 55, 42, ink);
  rect(t, 45, 31, 46, 42, ink, 0, 210);
  for (const [x, y] of [[41, 34], [50, 34], [41, 39], [50, 39]]) ellipse(t, x, y, 1.15, 1.15, ink, seed + x + y, 235);

  rect(t, 20, 46, 31, 49, ivory, seed + 974, 210);
  line(t, 20, 46, 31, 49, 0.8, ink, seed + 975, 155);
  drawNoiseDust(t, seed + 976, grime, 12);
  drawNoiseDust(t, seed + 977, gold, 6);
}

function drawDiverRouteTagSprite(t: Uint32Array, seed: number): void {
  const brass: [number, number, number] = [176, 124, 48];
  const brassLight: [number, number, number] = [232, 184, 84];
  const brassDark: [number, number, number] = [72, 50, 26];
  const blue: [number, number, number] = [56, 126, 154];
  const red: [number, number, number] = [162, 42, 36];
  const verdigris: [number, number, number] = [56, 124, 96];
  const damp: [number, number, number] = [46, 62, 58];

  ellipse(t, 33, 52, 17, 4, damp, seed + 955, 88);
  line(t, 21, 18, 11, 12, 1.1, red, seed + 956, 190);
  line(t, 21, 18, 16, 8, 1.1, red, seed + 957, 180);
  ellipse(t, 32, 34, 20, 14, brassDark, seed + 958, 245);
  ellipse(t, 32, 32, 18, 12, brass, seed + 959, 252);
  ellipse(t, 23, 29, 4.4, 4.4, brassDark, seed + 960, 235);
  ellipse(t, 23, 29, 2.2, 2.2, [4, 5, 4], 0, 235);
  line(t, 18, 37, 47, 30, 1.4, blue, seed + 961, 220);
  line(t, 20, 40, 45, 42, 0.9, verdigris, seed + 962, 160);
  rect(t, 30, 24, 43, 26, brassLight, seed + 963, 165);
  for (let x = 30; x <= 44; x += 4) line(t, x, 31, x + 1, 38, 0.8, brassDark, seed + 964 + x, 170);
  rect(t, 34, 36, 47, 40, red, seed + 980, 196);
  rect(t, 37, 37, 45, 38, brassLight, seed + 981, 180);
  clearRect(t, 49, 29, 52, 34);
  clearRect(t, 43, 20, 47, 24);
  rect(t, 19, 40, 31, 44, verdigris, seed + 982, 118);
  drawNoiseDust(t, seed + 983, verdigris, 14);
  drawNoiseDust(t, seed + 984, brassLight, 9);
}

function drawDuctTapeSprite(t: Uint32Array, seed: number): void {
  const tape: [number, number, number] = [28, 36, 38];
  const tapeLight: [number, number, number] = [82, 96, 98];
  const tapeDark: [number, number, number] = [8, 12, 12];
  const paper: [number, number, number] = [126, 112, 82];
  const glue: [number, number, number] = [174, 154, 94];
  const blue: [number, number, number] = [54, 112, 138];
  const rust: [number, number, number] = [112, 58, 34];

  ellipse(t, 31, 52, 17, 4, [12, 14, 12], seed + 985, 82);
  ellipse(t, 29, 34, 17, 13, tapeDark, seed + 986, 245);
  ellipse(t, 30, 32, 15, 11, tape, seed + 987, 252);
  ellipse(t, 30, 32, 8, 6, tapeLight, seed + 988, 220);
  ellipse(t, 30, 32, 5, 3.5, [4, 5, 4], seed + 989, 230);
  line(t, 38, 34, 53, 42, 4.0, tapeDark, seed + 990, 238);
  line(t, 39, 34, 52, 41, 2.4, tapeLight, seed + 991, 220);
  rect(t, 45, 37, 55, 43, glue, seed + 992, 216);
  rect(t, 47, 39, 53, 40, tapeDark, 0, 120);
  line(t, 17, 29, 43, 39, 0.9, blue, seed + 993, 145);
  rect(t, 21, 43, 35, 47, paper, seed + 994, 170);
  rect(t, 24, 44, 33, 45, tapeDark, 0, 115);
  drawNoiseDust(t, seed + 995, rust, 10);
  drawNoiseDust(t, seed + 996, blue, 8);
}

function drawElevatorOverrideFormSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [188, 170, 118];
  const light: [number, number, number] = [226, 208, 150];
  const ink: [number, number, number] = [32, 30, 24];
  const red: [number, number, number] = [164, 44, 38];
  const blue: [number, number, number] = [58, 120, 150];
  const ochre: [number, number, number] = [190, 128, 44];
  const damp: [number, number, number] = [70, 82, 72];

  rect(t, 15, 13, 50, 52, paper, seed + 997, 246);
  rect(t, 18, 16, 47, 22, light, seed + 998, 220);
  outlineRect(t, 15, 13, 50, 52, ink);
  clearRect(t, 15, 13, 18, 16);
  clearRect(t, 48, 14, 50, 20);
  clearRect(t, 16, 49, 19, 52);
  rect(t, 15, 44, 50, 52, damp, seed + 999, 92);
  rect(t, 22, 26, 29, 34, paper, seed + 1000, 230);
  outlineRect(t, 22, 26, 29, 34, ink);
  rect(t, 23, 29, 28, 31, blue, seed + 1001, 205);
  rect(t, 35, 25, 42, 43, ink, seed + 1002, 170);
  rect(t, 37, 27, 40, 41, paper, seed + 1003, 238);
  line(t, 23, 39, 35, 30, 1.2, red, seed + 1004, 230);
  line(t, 35, 30, 45, 39, 1.2, red, seed + 1005, 225);
  line(t, 45, 39, 42, 34, 1.0, red, seed + 1006, 225);
  line(t, 45, 39, 39, 40, 1.0, red, seed + 1007, 225);
  rect(t, 20, 21, 45, 22, ink, 0, 125);
  for (let y = 36; y <= 47; y += 4) rect(t, 20, y, 40 - ((seed + y) & 5), y + 1, ink, 0, 110);
  rect(t, 41, 18, 52, 24, ochre, seed + 1008, 220);
  rect(t, 44, 20, 50, 21, ink, 0, 115);
  drawNoiseDust(t, seed + 1009, damp, 12);
  drawNoiseDust(t, seed + 1010, red, 7);
}

function drawEmergencyRosterSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 182, 130];
  const light: [number, number, number] = [230, 216, 160];
  const ink: [number, number, number] = [30, 28, 24];
  const red: [number, number, number] = [178, 42, 36];
  const blue: [number, number, number] = [58, 112, 138];
  const damp: [number, number, number] = [68, 84, 72];
  const ochre: [number, number, number] = [180, 122, 44];

  rect(t, 18, 11, 49, 54, paper, seed + 1011, 246);
  rect(t, 21, 14, 46, 19, light, seed + 1012, 220);
  outlineRect(t, 18, 11, 49, 54, ink);
  clearRect(t, 18, 11, 21, 14);
  clearRect(t, 47, 12, 49, 18);
  clearRect(t, 19, 51, 22, 54);
  rect(t, 18, 46, 49, 54, damp, seed + 1013, 96);
  rect(t, 14, 18, 24, 26, red, seed + 1014, 225);
  rect(t, 17, 20, 21, 24, light, seed + 1015, 210);
  for (let y = 24; y <= 45; y += 4) {
    rect(t, 24, y, 45 - ((seed + y) & 5), y + 1, ink, 0, 136);
    rect(t, 20, y, 21, y + 1, y % 8 === 0 ? red : blue, seed + 1016 + y, 190);
  }
  line(t, 22, 24, 47, 45, 0.8, red, seed + 1025, 150);
  line(t, 22, 45, 47, 24, 0.8, red, seed + 1026, 126);
  rect(t, 35, 49, 48, 52, ochre, seed + 1027, 170);
  drawNoiseDust(t, seed + 1028, damp, 12);
  drawNoiseDust(t, seed + 1029, ochre, 8);
}

function drawEmptyRoksTankSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [88, 96, 90];
  const metalLight: [number, number, number] = [158, 166, 150];
  const metalDark: [number, number, number] = [26, 32, 32];
  const red: [number, number, number] = [172, 42, 34];
  const yellow: [number, number, number] = [210, 150, 42];
  const rubber: [number, number, number] = [18, 22, 22];
  const rust: [number, number, number] = [132, 68, 36];
  const damp: [number, number, number] = [48, 62, 54];

  ellipse(t, 33, 53, 18, 4, [12, 14, 12], seed + 1030, 86);
  rect(t, 23, 17, 44, 49, metal, seed + 1031, 248);
  ellipse(t, 33.5, 17, 11, 5, metalLight, seed + 1032, 242);
  ellipse(t, 33.5, 49, 11, 4.5, metalDark, seed + 1033, 180);
  outlineRect(t, 23, 17, 44, 49, metalDark);
  rect(t, 24, 28, 43, 34, red, seed + 1034, 228);
  rect(t, 28, 30, 39, 31, yellow, seed + 1035, 210);
  line(t, 20, 21, 18, 48, 2.2, rubber, seed + 1036, 232);
  line(t, 47, 20, 50, 48, 2.2, rubber, seed + 1037, 232);
  line(t, 20, 25, 46, 24, 1.0, rubber, seed + 1038, 185);
  line(t, 21, 43, 48, 42, 1.0, rubber, seed + 1039, 175);
  rect(t, 30, 11, 38, 16, metalDark, seed + 1040, 238);
  rect(t, 32, 8, 36, 12, yellow, seed + 1041, 220);
  line(t, 42, 18, 54, 13, 1.3, rubber, seed + 1042, 210);
  ellipse(t, 55, 13, 3.2, 2.2, metalLight, seed + 1043, 205);
  ellipse(t, 36, 39, 4.8, 4.8, metalLight, seed + 1044, 220);
  ellipse(t, 36, 39, 2.3, 2.3, damp, seed + 1045, 230);
  line(t, 36, 39, 39, 36, 0.8, red, seed + 1046, 220);
  rect(t, 41, 44, 48, 49, rust, seed + 1047, 145);
  drawNoiseDust(t, seed + 1048, rust, 12);
  drawNoiseDust(t, seed + 1049, metalLight, 9);
}

function drawGovnyakCourierPackageSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [168, 144, 92];
  const paperLight: [number, number, number] = [214, 190, 122];
  const paperDark: [number, number, number] = [48, 38, 28];
  const twine: [number, number, number] = [72, 58, 36];
  const seal: [number, number, number] = [174, 38, 34];
  const tag: [number, number, number] = [202, 188, 132];
  const stain: [number, number, number] = [56, 68, 46];
  const rust: [number, number, number] = [126, 66, 34];

  rect(t, 13, 23, 51, 48, paperDark, seed + 1050, 220);
  rect(t, 15, 18, 49, 45, paper, seed + 1051, 248);
  rect(t, 18, 20, 46, 25, paperLight, seed + 1052, 210);
  outlineRect(t, 15, 18, 49, 45, paperDark);
  clearRect(t, 15, 18, 18, 21);
  clearRect(t, 47, 19, 49, 24);
  clearRect(t, 16, 42, 19, 45);
  line(t, 15, 31, 49, 31, 1.2, twine, seed + 1053, 210);
  line(t, 31, 18, 33, 45, 1.2, twine, seed + 1054, 205);
  line(t, 16, 44, 48, 23, 0.9, stain, seed + 1055, 100);
  rect(t, 38, 23, 49, 32, tag, seed + 1056, 232);
  rect(t, 40, 26, 47, 27, paperDark, 0, 130);
  rect(t, 41, 29, 47, 30, paperDark, 0, 115);
  ellipse(t, 31, 31, 6.2, 5.2, seal, seed + 1057, 225);
  ellipse(t, 31, 31, 3.4, 2.6, paper, seed + 1058, 215);
  rect(t, 24, 39, 41, 42, seal, seed + 1059, 160);
  line(t, 20, 23, 44, 43, 0.8, rust, seed + 1060, 130);
  drawNoiseDust(t, seed + 1061, rust, 11);
  drawNoiseDust(t, seed + 1062, stain, 9);
}

function drawFuseSprite(t: Uint32Array, seed: number): void {
  const ceramic: [number, number, number] = [214, 204, 162];
  const ceramicLight: [number, number, number] = [240, 230, 188];
  const brass: [number, number, number] = [190, 136, 48];
  const brassDark: [number, number, number] = [92, 64, 28];
  const wire: [number, number, number] = [64, 72, 66];
  const red: [number, number, number] = [174, 40, 36];
  const green: [number, number, number] = [76, 150, 96];
  const scorch: [number, number, number] = [54, 44, 34];

  ellipse(t, 32, 52, 15, 3.5, [12, 12, 10], seed + 1063, 76);
  line(t, 15, 35, 51, 28, 5.4, brassDark, seed + 1064, 238);
  line(t, 18, 34, 48, 29, 3.6, ceramic, seed + 1065, 248);
  line(t, 21, 32, 45, 29, 1.1, ceramicLight, seed + 1066, 190);
  ellipse(t, 16, 35, 5.3, 4.2, brass, seed + 1067, 238);
  ellipse(t, 51, 28, 5.3, 4.2, brass, seed + 1068, 238);
  ellipse(t, 16, 35, 2.1, 1.7, brassDark, seed + 1069, 180);
  ellipse(t, 51, 28, 2.1, 1.7, brassDark, seed + 1070, 180);
  line(t, 24, 35, 43, 31, 0.9, wire, seed + 1071, 200);
  line(t, 27, 34, 38, 41, 1.0, red, seed + 1072, 220);
  rect(t, 29, 37, 39, 43, red, seed + 1073, 185);
  rect(t, 31, 39, 37, 40, ceramicLight, seed + 1074, 176);
  rect(t, 25, 24, 34, 27, green, seed + 1075, 195);
  rect(t, 36, 23, 44, 26, red, seed + 1076, 188);
  ellipse(t, 38, 36, 5, 3.2, scorch, seed + 1077, 118);
  line(t, 18, 36, 50, 29, 0.8, brassDark, seed + 1078, 128);
  drawNoiseDust(t, seed + 1079, scorch, 10);
}

function drawGearSprite(t: Uint32Array, seed: number): void {
  const metalDark: [number, number, number] = [34, 38, 36];
  const metal: [number, number, number] = [106, 112, 102];
  const metalLight: [number, number, number] = [172, 174, 150];
  const yellow: [number, number, number] = [202, 146, 48];
  const rust: [number, number, number] = [128, 66, 34];
  const oil: [number, number, number] = [38, 44, 34];

  ellipse(t, 32, 52, 16, 4, [10, 11, 10], seed + 1080, 84);
  rect(t, 28, 12, 36, 22, metalDark, seed + 1081, 242);
  rect(t, 28, 42, 36, 52, metalDark, seed + 1082, 238);
  rect(t, 12, 28, 22, 36, metalDark, seed + 1083, 238);
  rect(t, 42, 28, 52, 36, metalDark, seed + 1084, 238);
  line(t, 19, 19, 25, 25, 3.4, metalDark, seed + 1085, 240);
  line(t, 45, 19, 39, 25, 3.4, metalDark, seed + 1086, 240);
  line(t, 19, 45, 25, 39, 3.4, metalDark, seed + 1087, 240);
  line(t, 45, 45, 39, 39, 3.4, metalDark, seed + 1088, 240);
  rect(t, 29, 14, 35, 22, metal, seed + 1106, 226);
  rect(t, 29, 42, 35, 50, metal, seed + 1107, 218);
  rect(t, 14, 29, 22, 35, metal, seed + 1108, 218);
  rect(t, 42, 29, 50, 35, metal, seed + 1109, 218);
  line(t, 20, 20, 25, 25, 2.0, metal, seed + 1110, 215);
  line(t, 44, 20, 39, 25, 2.0, metal, seed + 1111, 215);
  line(t, 20, 44, 25, 39, 2.0, metal, seed + 1112, 210);
  line(t, 44, 44, 39, 39, 2.0, metal, seed + 1113, 210);

  ellipse(t, 32, 32, 18, 18, metalDark, seed + 1089, 252);
  ellipse(t, 32, 32, 15, 15, metal, seed + 1090, 252);
  ellipse(t, 32, 32, 9, 9, metalLight, seed + 1091, 196);
  ellipse(t, 32, 32, 5, 5, [0, 0, 0], 0, 0);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const x0 = 32 + Math.cos(a) * 8;
    const y0 = 32 + Math.sin(a) * 8;
    const x1 = 32 + Math.cos(a) * 16;
    const y1 = 32 + Math.sin(a) * 16;
    line(t, x0, y0, x1, y1, 0.9, metalDark, seed + 1092 + i, 135);
  }
  rect(t, 28, 49, 39, 52, rust, seed + 1100, 170);
  line(t, 22, 42, 44, 23, 0.9, rust, seed + 1101, 150);
  ellipse(t, 39, 39, 5.5, 3.2, oil, seed + 1102, 120);
  rect(t, 22, 25, 30, 27, yellow, seed + 1103, 160);
  drawNoiseDust(t, seed + 1104, rust, 14);
  drawNoiseDust(t, seed + 1105, metalLight, 7);
  ellipse(t, 32, 32, 5.5, 5.5, [0, 0, 0], 0, 0);
}

function drawGlassShardSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [116, 174, 178];
  const glassLight: [number, number, number] = [210, 244, 232];
  const glassDark: [number, number, number] = [36, 62, 66];
  const blood: [number, number, number] = [146, 34, 36];
  const dust: [number, number, number] = [86, 94, 82];

  ellipse(t, 33, 53, 17, 3.5, [10, 12, 12], seed + 1106, 70);
  line(t, 18, 48, 31, 15, 4.2, glass, seed + 1107, 118);
  line(t, 31, 15, 47, 45, 4.2, glass, seed + 1108, 112);
  line(t, 47, 45, 18, 48, 3.6, glass, seed + 1109, 105);
  line(t, 21, 45, 31, 18, 1.0, glassLight, seed + 1110, 205);
  line(t, 31, 18, 44, 43, 0.9, glassLight, seed + 1111, 190);
  line(t, 45, 45, 20, 48, 0.8, glassDark, seed + 1112, 155);
  line(t, 27, 28, 40, 44, 0.7, glassDark, seed + 1113, 130);

  line(t, 14, 35, 26, 25, 2.8, glass, seed + 1114, 105);
  line(t, 26, 25, 28, 44, 2.8, glass, seed + 1115, 100);
  line(t, 28, 44, 14, 35, 2.2, glass, seed + 1116, 96);
  line(t, 16, 35, 26, 26, 0.8, glassLight, seed + 1117, 178);

  line(t, 38, 24, 52, 16, 2.8, glass, seed + 1118, 104);
  line(t, 52, 16, 49, 34, 2.7, glass, seed + 1119, 100);
  line(t, 49, 34, 38, 24, 2.0, glass, seed + 1120, 96);
  line(t, 41, 24, 51, 18, 0.8, glassLight, seed + 1121, 174);

  rect(t, 28, 46, 39, 48, blood, seed + 1122, 138);
  ellipse(t, 22, 50, 4.8, 2.5, dust, seed + 1123, 108);
  drawNoiseDust(t, seed + 1124, glassLight, 12);
  drawNoiseDust(t, seed + 1125, dust, 9);
  px(t, 31, 16, rgba(glassLight[0], glassLight[1], glassLight[2], 220));
  px(t, 52, 17, rgba(glassLight[0], glassLight[1], glassLight[2], 205));
}

function drawGunstockSprite(t: Uint32Array, seed: number): void {
  const woodDark: [number, number, number] = [50, 34, 24];
  const wood: [number, number, number] = [104, 62, 34];
  const woodLight: [number, number, number] = [160, 100, 48];
  const metal: [number, number, number] = [78, 86, 82];
  const metalLight: [number, number, number] = [150, 154, 138];
  const red: [number, number, number] = [172, 42, 34];
  const ochre: [number, number, number] = [206, 150, 52];
  const rust: [number, number, number] = [132, 66, 34];

  ellipse(t, 32, 53, 18, 4, [14, 10, 8], seed + 1063, 82);
  line(t, 16, 47, 43, 25, 9.0, woodDark, seed + 1064, 242);
  line(t, 17, 45, 42, 26, 6.8, wood, seed + 1065, 252);
  ellipse(t, 18, 46, 8.5, 8.0, wood, seed + 1066, 246);
  ellipse(t, 16, 47, 5.5, 5.8, woodDark, seed + 1067, 228);
  line(t, 21, 42, 39, 28, 1.2, woodLight, seed + 1068, 160);
  line(t, 19, 49, 43, 27, 0.9, rust, seed + 1069, 142);
  rect(t, 40, 22, 50, 29, metal, seed + 1070, 238);
  rect(t, 42, 23, 49, 25, metalLight, seed + 1071, 200);
  rect(t, 21, 41, 31, 47, red, seed + 1072, 182);
  rect(t, 24, 43, 29, 44, ochre, seed + 1073, 170);
  rect(t, 32, 31, 39, 34, woodDark, seed + 1074, 118);
  clearRect(t, 10, 38, 14, 43);
  clearRect(t, 46, 30, 51, 34);
  drawNoiseDust(t, seed + 1075, rust, 11);
  drawNoiseDust(t, seed + 1076, woodLight, 8);
}

function drawFilterLayerSprite(t: Uint32Array, seed: number): void {
  const feltDark: [number, number, number] = [38, 44, 42];
  const felt: [number, number, number] = [104, 112, 106];
  const feltLight: [number, number, number] = [166, 170, 148];
  const charcoal: [number, number, number] = [22, 28, 26];
  const cyan: [number, number, number] = [72, 176, 176];
  const ochre: [number, number, number] = [208, 154, 48];
  const red: [number, number, number] = [166, 44, 38];
  const stain: [number, number, number] = [58, 78, 66];
  const rust: [number, number, number] = [124, 66, 38];

  ellipse(t, 33, 52, 18, 4, [12, 14, 12], seed + 1077, 80);
  rect(t, 17, 24, 49, 43, feltDark, seed + 1078, 226);
  rect(t, 15, 21, 47, 40, felt, seed + 1079, 248);
  clearRect(t, 15, 21, 19, 25);
  clearRect(t, 45, 21, 47, 27);
  clearRect(t, 16, 37, 20, 40);
  outlineRect(t, 15, 21, 47, 40, feltDark);
  for (let x = 20; x <= 43; x += 5) line(t, x, 22, x + 4, 40, 0.7, feltLight, seed + 1080 + x, 105);
  for (let y = 26; y <= 37; y += 4) line(t, 17, y, 46, y - 1, 0.8, charcoal, seed + 1105 + y, 120);
  rect(t, 20, 30, 43, 34, charcoal, seed + 1110, 178);
  for (let x = 24; x <= 39; x += 4) ellipse(t, x, 32, 1.1, 1.1, cyan, seed + 1111 + x, 150);
  rect(t, 35, 38, 49, 46, ochre, seed + 1120, 228);
  rect(t, 38, 40, 47, 41, charcoal, 0, 128);
  rect(t, 24, 41, 34, 45, red, seed + 1121, 160);
  ellipse(t, 43, 24, 6.5, 4.0, stain, seed + 1122, 118);
  line(t, 18, 39, 46, 25, 0.9, rust, seed + 1123, 128);
  drawNoiseDust(t, seed + 1124, feltLight, 14);
  drawNoiseDust(t, seed + 1125, rust, 9);
}

function drawFilterReceiptSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [194, 176, 116];
  const paperLight: [number, number, number] = [230, 212, 150];
  const ink: [number, number, number] = [28, 28, 24];
  const red: [number, number, number] = [174, 42, 36];
  const cyan: [number, number, number] = [64, 166, 174];
  const grey: [number, number, number] = [98, 112, 104];
  const damp: [number, number, number] = [64, 78, 70];
  const rust: [number, number, number] = [124, 64, 36];

  rect(t, 19, 13, 47, 52, paper, seed + 1126, 246);
  rect(t, 22, 16, 44, 21, paperLight, seed + 1127, 220);
  outlineRect(t, 19, 13, 47, 52, ink);
  clearRect(t, 19, 13, 22, 16);
  clearRect(t, 45, 14, 47, 20);
  clearRect(t, 20, 49, 23, 52);
  rect(t, 19, 45, 47, 52, damp, seed + 1128, 88);
  rect(t, 24, 24, 42, 30, grey, seed + 1129, 206);
  rect(t, 26, 25, 40, 26, cyan, seed + 1130, 210);
  for (let y = 32; y <= 44; y += 4) rect(t, 23, y, 43 - ((seed + y) & 5), y + 1, ink, 0, 132);
  for (let y = 24; y <= 42; y += 6) rect(t, 22, y, 24, y + 1, red, seed + 1131 + y, 180);
  ellipse(t, 39, 38, 7.0, 5.0, red, seed + 1140, 182);
  ellipse(t, 39, 38, 4.2, 2.8, paper, seed + 1141, 168);
  rect(t, 31, 49, 44, 52, red, seed + 1142, 150);
  line(t, 21, 48, 46, 22, 0.8, rust, seed + 1143, 126);
  drawNoiseDust(t, seed + 1144, rust, 10);
  drawNoiseDust(t, seed + 1145, cyan, 7);
}

function drawInkBottleSprite(t: Uint32Array, seed: number): void {
  const glassDark: [number, number, number] = [12, 16, 24];
  const glass: [number, number, number] = [34, 44, 62];
  const glassLight: [number, number, number] = [112, 132, 150];
  const ink: [number, number, number] = [6, 8, 14];
  const label: [number, number, number] = [198, 178, 118];
  const red: [number, number, number] = [166, 38, 36];
  const cork: [number, number, number] = [126, 82, 42];
  const stain: [number, number, number] = [30, 34, 48];

  ellipse(t, 32, 53, 14, 3.5, stain, seed + 1146, 92);
  rect(t, 28, 11, 37, 18, cork, seed + 1147, 240);
  rect(t, 26, 17, 40, 24, glassDark, seed + 1148, 248);
  rect(t, 20, 24, 46, 50, glass, seed + 1149, 180);
  ellipse(t, 33, 24, 14, 5.0, glassLight, seed + 1150, 122);
  ellipse(t, 33, 50, 13, 4.2, ink, seed + 1151, 220);
  outlineRect(t, 20, 24, 46, 50, glassDark);
  rect(t, 23, 32, 43, 41, label, seed + 1152, 225);
  rect(t, 25, 34, 41, 35, ink, seed + 1153, 150);
  rect(t, 27, 38, 38, 39, red, seed + 1154, 205);
  line(t, 23, 26, 42, 48, 0.8, glassLight, seed + 1155, 110);
  ellipse(t, 45, 49, 8, 3, ink, seed + 1156, 145);
  for (let i = 0; i < 7; i++) {
    const x = 18 + Math.floor(noise(i, 82, seed) * 32);
    const y = 44 + Math.floor(noise(i, 83, seed) * 10);
    ellipse(t, x, y, 1.3, 0.9, ink, seed + 1157 + i, 160);
  }
  drawNoiseDust(t, seed + 1165, red, 6);
}

function drawInspectionMirrorSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [106, 118, 116];
  const metalLight: [number, number, number] = [198, 208, 196];
  const dark: [number, number, number] = [28, 34, 34];
  const glass: [number, number, number] = [118, 174, 184];
  const glassLight: [number, number, number] = [216, 238, 224];
  const handle: [number, number, number] = [76, 62, 42];
  const red: [number, number, number] = [164, 42, 36];
  const rust: [number, number, number] = [126, 68, 38];

  ellipse(t, 33, 53, 16, 3.5, [12, 14, 12], seed + 1166, 82);
  line(t, 19, 49, 35, 36, 4.0, dark, seed + 1167, 238);
  line(t, 20, 48, 36, 36, 2.2, handle, seed + 1168, 232);
  rect(t, 17, 46, 26, 52, red, seed + 1169, 206);
  rect(t, 19, 47, 24, 48, metalLight, seed + 1170, 140);

  ellipse(t, 40, 26, 15, 11, dark, seed + 1171, 246);
  ellipse(t, 39, 25, 12, 8.5, metal, seed + 1172, 245);
  ellipse(t, 39, 25, 9, 6.2, glass, seed + 1173, 222);
  ellipse(t, 36, 22, 5, 2.2, glassLight, seed + 1174, 184);
  line(t, 32, 30, 47, 19, 0.9, glassLight, seed + 1175, 190);
  line(t, 31, 32, 49, 30, 0.8, rust, seed + 1176, 132);
  clearRect(t, 49, 17, 53, 21);
  clearRect(t, 25, 34, 29, 38);
  drawNoiseDust(t, seed + 1177, rust, 9);
  drawNoiseDust(t, seed + 1178, glassLight, 8);
}

function drawPartyPortraitPinSprite(t: Uint32Array, seed: number): void {
  const enamelDark: [number, number, number] = [82, 26, 30];
  const enamel: [number, number, number] = [154, 42, 38];
  const brass: [number, number, number] = [206, 152, 58];
  const brassLight: [number, number, number] = [236, 198, 92];
  const portrait: [number, number, number] = [216, 188, 128];
  const ink: [number, number, number] = [32, 24, 20];
  const green: [number, number, number] = [72, 116, 76];
  const rust: [number, number, number] = [128, 64, 34];

  ellipse(t, 32, 52, 13, 3.5, [18, 14, 12], seed + 2006, 84);
  ellipse(t, 32, 34, 17, 17, brass, seed + 2007, 252);
  ellipse(t, 32, 34, 13, 13, enamelDark, seed + 2008, 252);
  ellipse(t, 32, 34, 11.5, 11.5, enamel, seed + 2009, 238);
  rect(t, 21, 30, 27, 42, enamel, seed + 2004, 238);
  rect(t, 37, 29, 43, 41, enamel, seed + 2005, 238);
  ellipse(t, 32, 44, 9, 3.2, enamel, seed + 2019, 234);
  ellipse(t, 31, 29, 4.2, 4.8, portrait, seed + 2010, 220);
  rect(t, 26, 34, 37, 42, portrait, seed + 2011, 200);
  line(t, 27, 31, 35, 27, 0.8, ink, seed + 2012, 170);
  line(t, 29, 38, 36, 34, 0.8, ink, seed + 2013, 150);
  rect(t, 23, 44, 42, 48, green, seed + 2014, 205);
  rect(t, 26, 45, 39, 46, brassLight, seed + 2015, 190);
  line(t, 18, 24, 46, 47, 0.9, brassLight, seed + 2016, 145);
  line(t, 21, 47, 44, 21, 0.8, rust, seed + 2017, 130);
  rect(t, 41, 31, 48, 35, rust, seed + 2018, 145);
  drawNoiseDust(t, seed + 2019, rust, 8);
  drawNoiseDust(t, seed + 2020, brassLight, 7);
  px(t, 28, 25, rgba(248, 224, 112, 175));
}

function drawLampBulbSprite(t: Uint32Array, seed: number): void {
  const glass: [number, number, number] = [198, 202, 176];
  const glassLight: [number, number, number] = [236, 234, 198];
  const cap: [number, number, number] = [86, 92, 86];
  const capDark: [number, number, number] = [36, 42, 40];
  const filament: [number, number, number] = [210, 132, 56];
  const red: [number, number, number] = [174, 42, 36];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 32, 53, 13, 3.5, [12, 12, 10], seed + 2021, 82);
  ellipse(t, 32, 28, 16.5, 18.5, glass, seed + 2022, 118);
  ellipse(t, 30, 24, 8.2, 10.2, glassLight, seed + 2023, 108);
  ellipse(t, 32, 28, 10.8, 12.8, [112, 118, 100], seed + 2024, 86);
  line(t, 26, 31, 38, 31, 1.0, filament, seed + 2025, 215);
  line(t, 28, 31, 30, 27, 0.8, filament, seed + 2026, 210);
  line(t, 36, 31, 34, 27, 0.8, filament, seed + 2027, 210);
  line(t, 29, 27, 35, 27, 0.8, filament, seed + 2028, 185);
  rect(t, 24, 42, 40, 50, cap, seed + 2029, 248);
  outlineRect(t, 24, 42, 40, 50, capDark);
  for (let y = 43; y <= 48; y += 2) line(t, 24, y, 40, y - 2, 0.7, capDark, seed + 2030 + y, 138);
  rect(t, 38, 39, 46, 44, red, seed + 2036, 195);
  rect(t, 40, 41, 45, 42, glassLight, seed + 2037, 140);
  line(t, 23, 44, 39, 25, 0.9, rust, seed + 2038, 125);
  px(t, 27, 19, rgba(248, 244, 198, 190));
  px(t, 28, 20, rgba(248, 244, 198, 175));
  drawNoiseDust(t, seed + 2039, rust, 8);
}

function drawLiftSchemeSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [196, 178, 112];
  const paperLight: [number, number, number] = [226, 210, 142];
  const ink: [number, number, number] = [24, 24, 20];
  const routeBlue: [number, number, number] = [52, 88, 122];
  const red: [number, number, number] = [178, 38, 34];
  const green: [number, number, number] = [62, 126, 86];
  const damp: [number, number, number] = [78, 92, 86];
  const rust: [number, number, number] = [122, 64, 36];

  rect(t, 15, 12, 50, 53, paper, seed + 2040, 248);
  rect(t, 18, 15, 47, 20, paperLight, seed + 2041, 218);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 20, 53);
  rect(t, 15, 46, 50, 53, damp, seed + 2042, 94);
  line(t, 18, 16, 47, 49, 0.8, damp, seed + 2043, 96);

  for (let x = 24; x <= 42; x += 9) line(t, x, 23, x, 45, 1.2, routeBlue, seed + 2044 + x, 218);
  for (let y = 25; y <= 43; y += 6) line(t, 21, y, 45, y, 0.8, ink, seed + 2050 + y, 95);
  line(t, 24, 42, 33, 35, 1.4, red, seed + 2057, 230);
  line(t, 33, 35, 42, 25, 1.4, red, seed + 2058, 230);
  for (let y = 24; y <= 42; y += 9) {
    rect(t, 21, y, 27, y + 4, green, seed + 2060 + y, 178);
    rect(t, 38, y + 2, 45, y + 5, routeBlue, seed + 2070 + y, 178);
  }
  ellipse(t, 40, 36, 6.5, 4.6, red, seed + 2080, 198);
  ellipse(t, 40, 36, 3.5, 2.2, paper, seed + 2081, 210);
  rect(t, 22, 21, 34, 22, ink, 0, 145);
  rect(t, 22, 48, 38, 49, ink, 0, 115);
  drawNoiseDust(t, seed + 2082, rust, 11);
}

function drawLiquidatorTokenSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [118, 124, 112];
  const metalLight: [number, number, number] = [190, 194, 168];
  const dark: [number, number, number] = [30, 34, 32];
  const red: [number, number, number] = [170, 38, 34];
  const yellow: [number, number, number] = [212, 158, 56];
  const rust: [number, number, number] = [126, 62, 34];
  const string: [number, number, number] = [118, 104, 74];

  line(t, 21, 13, 31, 23, 1.1, string, seed + 2083, 210);
  line(t, 31, 23, 45, 15, 1.1, string, seed + 2084, 205);
  rect(t, 17, 22, 49, 47, metal, seed + 2085, 248);
  rect(t, 20, 25, 46, 30, metalLight, seed + 2086, 190);
  outlineRect(t, 17, 22, 49, 47, dark);
  clearRect(t, 17, 22, 20, 25);
  clearRect(t, 47, 23, 49, 28);
  clearRect(t, 18, 44, 21, 47);
  ellipse(t, 23, 27, 3.3, 3.3, dark, seed + 2087, 235);
  ellipse(t, 23, 27, 1.5, 1.5, [0, 0, 0], 0, 0);
  rect(t, 31, 32, 35, 41, dark, seed + 2088, 205);
  rect(t, 39, 32, 43, 41, dark, seed + 2089, 205);
  rect(t, 35, 35, 39, 38, dark, seed + 2090, 205);
  rect(t, 32, 33, 34, 35, metal, seed + 2091, 225);
  rect(t, 40, 34, 42, 36, metal, seed + 2092, 225);
  rect(t, 26, 42, 44, 45, red, seed + 2093, 190);
  rect(t, 29, 43, 40, 44, yellow, seed + 2094, 170);
  line(t, 20, 45, 48, 28, 0.9, rust, seed + 2095, 130);
  drawNoiseDust(t, seed + 2096, rust, 12);
  drawNoiseDust(t, seed + 2097, metalLight, 7);
}

function drawMarketWeightScaleSprite(t: Uint32Array, seed: number): void {
  const enamel: [number, number, number] = [68, 112, 82];
  const enamelLight: [number, number, number] = [126, 154, 102];
  const steel: [number, number, number] = [106, 116, 108];
  const steelLight: [number, number, number] = [188, 190, 166];
  const dark: [number, number, number] = [24, 30, 28];
  const brass: [number, number, number] = [192, 138, 52];
  const red: [number, number, number] = [168, 42, 34];
  const rust: [number, number, number] = [126, 62, 34];

  ellipse(t, 32, 53, 18, 4, [10, 12, 10], seed + 2098, 82);
  rect(t, 20, 38, 46, 49, enamel, seed + 2099, 248);
  rect(t, 23, 40, 43, 44, enamelLight, seed + 2100, 178);
  outlineRect(t, 20, 38, 46, 49, dark);
  ellipse(t, 33, 31, 13.5, 11.5, steel, seed + 2101, 245);
  ellipse(t, 33, 31, 9.5, 7.8, steelLight, seed + 2102, 232);
  line(t, 33, 31, 39, 27, 0.9, red, seed + 2103, 230);
  ellipse(t, 33, 31, 2, 2, dark, seed + 2104, 225);
  rect(t, 23, 19, 44, 24, steel, seed + 2105, 235);
  ellipse(t, 33.5, 19, 11, 4.5, steelLight, seed + 2106, 230);
  line(t, 18, 33, 49, 21, 1.0, steelLight, seed + 2107, 210);
  rect(t, 47, 31, 54, 41, brass, seed + 2108, 226);
  rect(t, 49, 29, 52, 32, brass, seed + 2109, 232);
  rect(t, 49, 37, 52, 41, dark, seed + 2110, 118);
  rect(t, 24, 45, 38, 48, red, seed + 2111, 165);
  line(t, 22, 48, 48, 24, 0.9, rust, seed + 2112, 125);
  drawNoiseDust(t, seed + 2113, rust, 12);
  drawNoiseDust(t, seed + 2114, brass, 8);
}

function drawMeatRuneSprite(t: Uint32Array, seed: number): void {
  const flesh: [number, number, number] = [150, 58, 50];
  const fleshLight: [number, number, number] = [206, 104, 82];
  const dark: [number, number, number] = [54, 24, 22];
  const fat: [number, number, number] = [214, 178, 126];
  const ochre: [number, number, number] = [170, 118, 48];
  const tag: [number, number, number] = [198, 176, 104];
  const rust: [number, number, number] = [116, 48, 30];

  ellipse(t, 32, 52, 16, 4, [0, 0, 0], seed + 2115, 80);
  rect(t, 19, 21, 45, 47, flesh, seed + 2116, 246);
  ellipse(t, 32, 21, 14, 6, fleshLight, seed + 2117, 232);
  ellipse(t, 32, 47, 13, 5, dark, seed + 2118, 178);
  outlineRect(t, 19, 21, 45, 47, dark);
  clearRect(t, 19, 21, 22, 24);
  clearRect(t, 43, 21, 45, 25);
  clearRect(t, 20, 45, 23, 47);
  rect(t, 24, 24, 41, 28, fat, seed + 2119, 122);
  line(t, 24, 31, 41, 27, 1.2, fat, seed + 2120, 160);
  line(t, 23, 42, 40, 35, 1.2, dark, seed + 2121, 172);
  line(t, 30, 27, 29, 41, 1.1, dark, seed + 2122, 186);
  line(t, 29, 41, 37, 36, 1.0, dark, seed + 2123, 186);
  line(t, 24, 33, 36, 33, 0.9, ochre, seed + 2124, 150);
  rect(t, 39, 18, 48, 24, tag, seed + 2125, 226);
  rect(t, 41, 20, 46, 21, dark, seed + 2126, 135);
  rect(t, 43, 22, 47, 24, ochre, seed + 2127, 150);
  drawNoiseDust(t, seed + 2128, rust, 12);
}

function drawMetalSheetSprite(t: Uint32Array, seed: number): void {
  const metal: [number, number, number] = [102, 112, 112];
  const light: [number, number, number] = [170, 178, 164];
  const dark: [number, number, number] = [34, 40, 42];
  const rust: [number, number, number] = [132, 66, 34];
  const yellow: [number, number, number] = [198, 144, 50];
  const red: [number, number, number] = [156, 40, 34];

  ellipse(t, 33, 52, 18, 4, [0, 0, 0], seed + 2129, 80);
  rect(t, 16, 18, 49, 49, metal, seed + 2130, 246);
  outlineRect(t, 16, 18, 49, 49, dark);
  clearRect(t, 16, 18, 20, 21);
  clearRect(t, 47, 19, 49, 24);
  clearRect(t, 17, 46, 21, 49);
  rect(t, 19, 21, 45, 25, light, seed + 2131, 118);
  line(t, 18, 27, 48, 21, 0.9, light, seed + 2132, 140);
  line(t, 18, 44, 47, 31, 1.0, dark, seed + 2133, 112);
  line(t, 25, 18, 21, 49, 0.8, dark, seed + 2134, 95);
  rect(t, 37, 24, 47, 29, rust, seed + 2135, 160);
  rect(t, 21, 39, 32, 43, yellow, seed + 2136, 178);
  rect(t, 23, 40, 30, 41, dark, seed + 2137, 120);
  rect(t, 41, 43, 49, 47, red, seed + 2138, 132);
  for (let i = 0; i < 14; i++) {
    const x = 18 + Math.floor(noise(i, 82, seed) * 29);
    const y = 20 + Math.floor(noise(i, 83, seed) * 27);
    px(t, x, y, rgba(rust[0], rust[1], rust[2], 130));
  }
}

function drawMetroTicketSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 174, 82];
  const light: [number, number, number] = [238, 210, 122];
  const ink: [number, number, number] = [22, 20, 18];
  const blue: [number, number, number] = [54, 100, 150];
  const red: [number, number, number] = [168, 42, 36];
  const damp: [number, number, number] = [74, 86, 80];
  const rust: [number, number, number] = [116, 58, 34];

  rect(t, 14, 24, 51, 44, paper, seed + 2139, 248);
  rect(t, 17, 26, 48, 30, light, seed + 2140, 220);
  outlineRect(t, 14, 24, 51, 44, ink);
  clearRect(t, 14, 24, 17, 27);
  clearRect(t, 49, 25, 51, 29);
  clearRect(t, 15, 42, 18, 44);
  rect(t, 14, 39, 51, 44, damp, seed + 2141, 92);
  rect(t, 18, 32, 31, 36, blue, seed + 2142, 214);
  line(t, 20, 36, 29, 32, 0.8, light, seed + 2143, 164);
  rect(t, 35, 31, 47, 32, ink, 0, 158);
  rect(t, 35, 36, 44, 37, ink, 0, 124);
  ellipse(t, 24, 25, 2.4, 2.4, [0, 0, 0], 0, 0);
  ellipse(t, 42, 43, 2.2, 2.2, [0, 0, 0], 0, 0);
  ellipse(t, 43, 35, 6.4, 4.8, red, seed + 2144, 210);
  ellipse(t, 43, 35, 3.6, 2.2, paper, seed + 2145, 218);
  line(t, 38, 35, 48, 35, 0.8, red, seed + 2146, 225);
  line(t, 17, 42, 50, 25, 0.7, rust, seed + 2147, 118);
  drawNoiseDust(t, seed + 2148, rust, 10);
}

function drawMissingRecordFileSprite(t: Uint32Array, seed: number): void {
  const folder: [number, number, number] = [176, 144, 72];
  const folderLight: [number, number, number] = [220, 188, 104];
  const folderDark: [number, number, number] = [62, 46, 28];
  const paper: [number, number, number] = [204, 190, 138];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [168, 42, 36];
  const damp: [number, number, number] = [78, 88, 78];
  const rust: [number, number, number] = [118, 62, 34];

  ellipse(t, 33, 53, 18, 4, [0, 0, 0], seed + 2149, 82);
  rect(t, 20, 13, 44, 47, paper, seed + 2150, 236);
  outlineRect(t, 20, 13, 44, 47, ink);
  rect(t, 17, 21, 36, 28, folderLight, seed + 2151, 246);
  rect(t, 15, 27, 50, 53, folder, seed + 2152, 250);
  outlineRect(t, 15, 27, 50, 53, folderDark);
  line(t, 16, 31, 49, 27, 0.8, folderDark, seed + 2153, 128);
  rect(t, 15, 47, 50, 53, damp, seed + 2154, 96);
  rect(t, 15, 27, 20, 53, damp, seed + 2155, 106);
  clearRect(t, 15, 27, 18, 30);
  clearRect(t, 48, 28, 50, 33);
  clearRect(t, 16, 50, 19, 53);

  rect(t, 24, 20, 38, 21, ink, 0, 138);
  for (let y = 33; y <= 43; y += 5) rect(t, 23, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 140);
  rect(t, 29, 35, 39, 43, paper, seed + 2156, 160);
  line(t, 29, 35, 40, 43, 1.1, folderDark, seed + 2157, 150);
  line(t, 40, 35, 29, 43, 1.0, folderDark, seed + 2158, 150);
  rect(t, 37, 44, 45, 47, red, seed + 2159, 182);
  line(t, 21, 43, 50, 27, 0.9, rust, seed + 2160, 140);
  rect(t, 47, 23, 53, 25, rust, seed + 2161, 165);
  drawNoiseDust(t, seed + 2162, rust, 10);
}

function drawNeighborComplaintSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [218, 204, 156];
  const paperLight: [number, number, number] = [238, 226, 184];
  const ink: [number, number, number] = [38, 36, 30];
  const red: [number, number, number] = [178, 38, 34];
  const blue: [number, number, number] = [70, 96, 130];
  const grime: [number, number, number] = [92, 76, 48];
  const stampDark: [number, number, number] = [102, 30, 28];

  rect(t, 16, 10, 50, 53, paper, seed + 2163, 248);
  rect(t, 19, 13, 47, 49, paperLight, seed + 2164, 224);
  rect(t, 21, 11, 46, 15, paperLight, seed + 2187, 230);
  rect(t, 13, 16, 18, 50, paper, seed + 2162, 226);
  rect(t, 48, 18, 54, 47, paperLight, seed + 2161, 212);
  outlineRect(t, 16, 10, 50, 53, ink);
  line(t, 13, 18, 13, 48, 0.8, ink, seed + 2160, 130);
  line(t, 54, 20, 54, 45, 0.8, ink, seed + 2159, 130);
  clearRect(t, 16, 10, 20, 14);
  clearRect(t, 47, 11, 50, 17);
  clearRect(t, 17, 50, 21, 53);
  rect(t, 18, 48, 49, 53, grime, seed + 2165, 82);
  rect(t, 18, 40, 33, 45, paperLight, seed + 2165, 176);

  rect(t, 21, 16, 45, 19, ink, seed + 2166, 142);
  for (let y = 24; y <= 42; y += 5) {
    const short = ((seed + y) & 3) * 2;
    line(t, 21, y, 43 - short, y + ((y >> 1) & 1), 0.8, ink, seed + 2167 + y, 136);
  }
  rect(t, 22, 21, 33, 29, blue, seed + 2175, 174);
  rect(t, 24, 23, 31, 25, paperLight, seed + 2176, 150);
  rect(t, 25, 26, 30, 28, ink, seed + 2177, 110);

  rect(t, 33, 25, 50, 40, red, seed + 2178, 214);
  rect(t, 37, 29, 46, 30, paperLight, seed + 2179, 168);
  rect(t, 41, 31, 43, 37, paperLight, seed + 2180, 185);
  rect(t, 37, 34, 46, 35, paperLight, seed + 2181, 168);
  ellipse(t, 41, 33, 8.5, 6.5, stampDark, seed + 2182, 60);
  rect(t, 23, 46, 43, 48, red, seed + 2183, 172);
  rect(t, 17, 40, 33, 47, paperLight, seed + 2188, 218);
  line(t, 18, 51, 48, 20, 0.8, grime, seed + 2184, 108);
  drawNoiseDust(t, seed + 2185, grime, 12);
  drawNoiseDust(t, seed + 2186, red, 6);
}

function drawPsychiatristReferralSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [216, 204, 158];
  const paperLight: [number, number, number] = [240, 228, 184];
  const ink: [number, number, number] = [34, 30, 24];
  const red: [number, number, number] = [178, 38, 44];
  const blue: [number, number, number] = [58, 96, 132];
  const green: [number, number, number] = [70, 130, 92];
  const grime: [number, number, number] = [92, 76, 50];

  rect(t, 16, 10, 50, 53, paper, seed + 2190, 248);
  rect(t, 19, 13, 47, 18, paperLight, seed + 2191, 222);
  outlineRect(t, 16, 10, 50, 53, ink);
  clearRect(t, 16, 10, 20, 14);
  clearRect(t, 48, 11, 50, 17);
  clearRect(t, 17, 50, 21, 53);
  rect(t, 16, 46, 50, 53, grime, seed + 2192, 92);
  line(t, 18, 15, 48, 50, 0.8, grime, seed + 2193, 94);

  rect(t, 22, 21, 43, 22, ink, 0, 168);
  for (let y = 27; y <= 43; y += 5) rect(t, 22, y, 41 - ((seed + y) & 5), y + 1, ink, 0, 132);
  rect(t, 22, 25, 32, 35, blue, seed + 2194, 205);
  ellipse(t, 27, 29, 3.2, 3.2, paperLight, seed + 2195, 185);
  rect(t, 24, 33, 30, 34, paperLight, seed + 2196, 160);
  rect(t, 35, 26, 43, 31, green, seed + 2197, 165);
  rect(t, 38, 25, 41, 37, red, seed + 2198, 232);
  rect(t, 34, 30, 45, 33, red, seed + 2199, 232);
  ellipse(t, 39, 39, 7.5, 5.2, red, seed + 2200, 215);
  ellipse(t, 39, 39, 4.0, 2.4, paper, seed + 2201, 222);
  line(t, 33, 39, 45, 39, 0.8, red, seed + 2202, 230);
  rect(t, 25, 47, 42, 49, red, seed + 2203, 165);
  drawNoiseDust(t, seed + 2204, grime, 11);
  drawNoiseDust(t, seed + 2205, green, 6);
}

function drawPumpPassportSprite(t: Uint32Array, seed: number): void {
  const cover: [number, number, number] = [82, 96, 86];
  const coverLight: [number, number, number] = [126, 144, 124];
  const paper: [number, number, number] = [206, 188, 128];
  const ink: [number, number, number] = [24, 22, 18];
  const blue: [number, number, number] = [58, 116, 146];
  const red: [number, number, number] = [176, 38, 34];
  const rust: [number, number, number] = [126, 66, 36];
  const water: [number, number, number] = [74, 174, 166];

  rect(t, 19, 13, 48, 53, paper, seed + 2210, 226);
  rect(t, 15, 10, 45, 50, cover, seed + 2211, 250);
  rect(t, 18, 13, 42, 18, coverLight, seed + 2212, 210);
  outlineRect(t, 15, 10, 45, 50, ink);
  clearRect(t, 15, 10, 18, 13);
  clearRect(t, 43, 11, 45, 16);
  clearRect(t, 16, 47, 19, 50);
  rect(t, 15, 10, 20, 50, ink, seed + 2213, 118);
  rect(t, 24, 23, 39, 39, blue, seed + 2214, 210);
  ellipse(t, 31, 31, 7.5, 7.5, water, seed + 2215, 110);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    line(t, 31, 31, 31 + Math.cos(a) * 8, 31 + Math.sin(a) * 6, 0.9, paper, seed + 2216 + i, 190);
  }
  rect(t, 23, 19, 38, 20, ink, 0, 136);
  for (let y = 42; y <= 47; y += 3) rect(t, 22, y, 39 - ((seed + y) & 5), y + 1, ink, 0, 118);
  ellipse(t, 39, 36, 7.2, 5.0, red, seed + 2223, 212);
  ellipse(t, 39, 36, 3.8, 2.3, cover, seed + 2224, 222);
  rect(t, 31, 45, 43, 48, red, seed + 2225, 176);
  line(t, 18, 48, 43, 18, 0.8, rust, seed + 2226, 120);
  drawNoiseDust(t, seed + 2227, rust, 12);
  drawNoiseDust(t, seed + 2228, water, 8);
}

function drawPressureLogbookSprite(t: Uint32Array, seed: number): void {
  const cover: [number, number, number] = [150, 120, 68];
  const coverLight: [number, number, number] = [196, 166, 94];
  const paper: [number, number, number] = [214, 196, 134];
  const ink: [number, number, number] = [28, 24, 18];
  const damp: [number, number, number] = [62, 88, 80];
  const face: [number, number, number] = [198, 190, 150];
  const red: [number, number, number] = [178, 38, 34];
  const rust: [number, number, number] = [124, 62, 36];

  ellipse(t, 33, 53, 18, 4, [12, 10, 8], seed + 2532, 84);
  rect(t, 15, 13, 50, 53, cover, seed + 2533, 248);
  rect(t, 18, 16, 47, 22, coverLight, seed + 2534, 210);
  outlineRect(t, 15, 13, 50, 53, ink);
  clearRect(t, 15, 13, 18, 16);
  clearRect(t, 48, 14, 50, 19);
  clearRect(t, 16, 50, 19, 53);
  rect(t, 15, 13, 20, 53, damp, seed + 2535, 128);
  rect(t, 15, 45, 50, 53, damp, seed + 2536, 98);
  line(t, 19, 17, 21, 50, 0.9, ink, seed + 2537, 100);
  rect(t, 24, 22, 42, 24, ink, 0, 160);
  for (let y = 29; y <= 43; y += 5) {
    rect(t, 24, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 145);
  }
  ellipse(t, 40, 36, 8.0, 8.0, ink, seed + 2538, 225);
  ellipse(t, 40, 36, 5.8, 5.8, face, seed + 2539, 236);
  line(t, 40, 36, 45, 32, 1.5, red, seed + 2540, 238);
  ellipse(t, 40, 36, 1.8, 1.8, ink, seed + 2541, 220);
  rect(t, 31, 46, 43, 49, red, seed + 2542, 178);
  rect(t, 33, 47, 41, 48, paper, seed + 2543, 160);
  line(t, 18, 49, 48, 23, 0.8, rust, seed + 2544, 130);
  drawNoiseDust(t, seed + 2545, rust, 12);
  drawNoiseDust(t, seed + 2546, damp, 9);
}

function drawSamosborTallySprite(t: Uint32Array, seed: number): void {
  const board: [number, number, number] = [112, 92, 58];
  const paper: [number, number, number] = [194, 176, 118];
  const paperLight: [number, number, number] = [224, 206, 146];
  const ink: [number, number, number] = [30, 28, 22];
  const red: [number, number, number] = [176, 36, 36];
  const blue: [number, number, number] = [54, 84, 118];
  const damp: [number, number, number] = [76, 88, 82];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 33, 53, 18, 4, [10, 10, 8], seed + 2293, 78);
  rect(t, 16, 16, 49, 52, board, seed + 2294, 230);
  rect(t, 18, 12, 47, 49, paper, seed + 2295, 248);
  rect(t, 21, 15, 44, 20, paperLight, seed + 2296, 210);
  outlineRect(t, 18, 12, 47, 49, ink);
  clearRect(t, 18, 12, 21, 15);
  clearRect(t, 45, 13, 47, 18);
  rect(t, 18, 43, 47, 49, damp, seed + 2297, 86);
  for (let y = 24; y <= 40; y += 5) {
    rect(t, 22, y, 40 - ((seed + y) & 3), y + 1, ink, 0, 125);
    rect(t, 42, y, 45, y + 1, red, seed + 2298 + y, 190);
  }
  line(t, 22, 40, 44, 25, 1.3, red, seed + 2305, 220);
  line(t, 24, 27, 43, 40, 1.0, red, seed + 2306, 205);
  rect(t, 31, 10, 36, 16, blue, seed + 2307, 225);
  ellipse(t, 33, 11, 5.0, 2.5, ink, seed + 2308, 135);
  rect(t, 37, 32, 51, 37, red, seed + 2309, 190);
  rect(t, 39, 34, 48, 35, paperLight, 0, 140);
  drawNoiseDust(t, seed + 2310, rust, 10);
  drawNoiseDust(t, seed + 2311, red, 6);
}

function drawSirenInstructionSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [202, 184, 112];
  const light: [number, number, number] = [236, 216, 144];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [188, 36, 34];
  const violet: [number, number, number] = [112, 74, 150];
  const damp: [number, number, number] = [78, 92, 86];
  const rust: [number, number, number] = [124, 64, 34];

  rect(t, 15, 12, 50, 53, paper, seed + 2320, 248);
  rect(t, 18, 15, 47, 20, light, seed + 2321, 220);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 18);
  clearRect(t, 16, 50, 20, 53);
  rect(t, 15, 45, 50, 53, damp, seed + 2322, 100);
  line(t, 17, 17, 48, 50, 0.8, damp, seed + 2323, 92);
  rect(t, 21, 23, 32, 35, red, seed + 2324, 224);
  line(t, 31, 28, 42, 22, 2.2, red, seed + 2325, 215);
  line(t, 31, 30, 43, 36, 1.6, red, seed + 2326, 190);
  rect(t, 23, 26, 29, 32, light, seed + 2327, 150);
  for (let y = 24; y <= 42; y += 5) rect(t, 36, y, 47 - ((seed + y) & 5), y + 1, ink, 0, 135);
  rect(t, 22, 39, 47, 43, violet, seed + 2328, 188);
  line(t, 22, 41, 46, 39, 1.1, violet, seed + 2329, 210);
  rect(t, 31, 47, 42, 50, red, seed + 2330, 168);
  drawNoiseDust(t, seed + 2331, rust, 10);
  drawNoiseDust(t, seed + 2332, violet, 10);
}

function drawSealWaxSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [68, 16, 18];
  const red: [number, number, number] = [170, 34, 42];
  const light: [number, number, number] = [224, 74, 58];
  const brown: [number, number, number] = [104, 52, 34];
  const ash: [number, number, number] = [42, 34, 30];
  const paper: [number, number, number] = [202, 184, 124];

  ellipse(t, 33, 52, 18, 4, [9, 5, 5], seed + 2597, 84);
  ellipse(t, 31, 36, 17, 12, dark, seed + 2598, 238);
  ellipse(t, 31, 33, 15, 10, red, seed + 2599, 248);
  ellipse(t, 25, 40, 7, 6, red, seed + 2600, 238);
  ellipse(t, 39, 40, 8, 5, red, seed + 2601, 238);
  ellipse(t, 30, 29, 8, 4, light, seed + 2602, 170);
  ellipse(t, 34, 34, 5, 3, paper, seed + 2603, 140);
  line(t, 17, 45, 47, 28, 0.9, brown, seed + 2604, 160);
  rect(t, 41, 25, 49, 30, ash, seed + 2605, 185);
  rect(t, 43, 26, 47, 27, paper, seed + 2606, 130);
  drawNoiseDust(t, seed + 2607, light, 9);
  drawNoiseDust(t, seed + 2608, brown, 9);
}

function drawSealedComplaintSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 182, 128];
  const paperLight: [number, number, number] = [226, 210, 150];
  const ink: [number, number, number] = [34, 30, 24];
  const red: [number, number, number] = [178, 36, 42];
  const darkRed: [number, number, number] = [90, 18, 22];
  const damp: [number, number, number] = [74, 88, 78];
  const rust: [number, number, number] = [120, 62, 36];

  ellipse(t, 33, 53, 18, 4, [10, 8, 6], seed + 2609, 82);
  rect(t, 15, 16, 50, 49, paper, seed + 2610, 248);
  rect(t, 18, 18, 47, 23, paperLight, seed + 2611, 200);
  outlineRect(t, 15, 16, 50, 49, ink);
  clearRect(t, 15, 16, 18, 19);
  clearRect(t, 47, 16, 50, 20);
  clearRect(t, 16, 46, 19, 49);
  line(t, 15, 17, 32, 35, 1.0, ink, seed + 2612, 95);
  line(t, 50, 17, 32, 35, 1.0, ink, seed + 2613, 95);
  line(t, 18, 29, 46, 29, 0.7, ink, seed + 2614, 120);
  for (let y = 34; y <= 42; y += 4) rect(t, 20, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 130);
  ellipse(t, 33, 35, 8.4, 8.0, darkRed, seed + 2615, 235);
  ellipse(t, 33, 35, 6.2, 5.8, red, seed + 2616, 248);
  rect(t, 29, 33, 37, 36, red, seed + 2617, 230);
  rect(t, 15, 43, 50, 49, damp, seed + 2618, 78);
  line(t, 17, 48, 48, 23, 0.9, rust, seed + 2619, 126);
  drawNoiseDust(t, seed + 2620, rust, 10);
  drawNoiseDust(t, seed + 2621, red, 8);
}

function drawRecordExposureNoticeSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [212, 188, 120];
  const paperLight: [number, number, number] = [244, 226, 164];
  const ink: [number, number, number] = [28, 24, 20];
  const voidCard: [number, number, number] = [8, 8, 10];
  const red: [number, number, number] = [176, 36, 34];
  const blue: [number, number, number] = [62, 112, 146];
  const rust: [number, number, number] = [126, 66, 36];

  rect(t, 18, 11, 49, 53, paper, seed + 2622, 248);
  rect(t, 21, 14, 46, 19, paperLight, seed + 2623, 220);
  outlineRect(t, 18, 11, 49, 53, ink);
  clearRect(t, 18, 11, 21, 14);
  clearRect(t, 47, 12, 49, 17);
  clearRect(t, 19, 50, 22, 53);
  rect(t, 23, 22, 41, 32, voidCard, seed + 2624, 238);
  rect(t, 27, 25, 37, 27, paper, seed + 2625, 62);
  line(t, 23, 32, 41, 22, 0.9, rust, seed + 2626, 145);
  rect(t, 22, 37, 43, 38, ink, 0, 145);
  rect(t, 22, 42, 39, 43, ink, 0, 130);
  rect(t, 22, 46, 44, 47, ink, 0, 118);
  rect(t, 37, 28, 48, 34, red, seed + 2627, 208);
  ellipse(t, 42, 41, 8, 5.2, red, seed + 2628, 216);
  ellipse(t, 42, 41, 4.3, 2.5, paper, seed + 2629, 225);
  rect(t, 35, 41, 49, 42, red, seed + 2630, 226);
  rect(t, 22, 16, 37, 18, blue, seed + 2631, 160);
  line(t, 19, 47, 47, 17, 0.8, rust, seed + 2632, 122);
  drawNoiseDust(t, seed + 2633, rust, 12);
  drawNoiseDust(t, seed + 2634, voidCard, 8);
}

function drawRelayDiagramSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [204, 190, 132];
  const paperLight: [number, number, number] = [238, 226, 172];
  const ink: [number, number, number] = [24, 26, 24];
  const blue: [number, number, number] = [54, 130, 168];
  const green: [number, number, number] = [70, 154, 98];
  const red: [number, number, number] = [174, 40, 34];
  const brass: [number, number, number] = [198, 152, 58];
  const grime: [number, number, number] = [86, 76, 48];

  rect(t, 17, 13, 49, 52, paper, seed + 2638, 246);
  rect(t, 20, 16, 46, 22, paperLight, seed + 2639, 210);
  outlineRect(t, 17, 13, 49, 52, ink);
  clearRect(t, 17, 13, 20, 16);
  clearRect(t, 47, 14, 49, 19);
  line(t, 33, 13, 31, 52, 0.9, grime, seed + 2640, 118);
  line(t, 18, 31, 48, 29, 0.8, grime, seed + 2641, 104);
  for (let y = 20; y <= 46; y += 6) rect(t, 22, y, 42 - ((seed + y) & 5), y + 1, ink, 0, 112);
  for (let i = 0; i < 5; i++) {
    const x = 23 + i * 5;
    const y = 37 - ((i & 1) * 5);
    ellipse(t, x, y, 2.6, 2.3, i & 1 ? green : blue, seed + 2642 + i, 222);
    if (i > 0) line(t, x - 5, 37 - (((i - 1) & 1) * 5), x, y, 1.0, i & 1 ? blue : green, seed + 2647 + i, 194);
  }
  rect(t, 39, 24, 48, 33, brass, seed + 2653, 222);
  outlineRect(t, 39, 24, 48, 33, ink);
  line(t, 40, 28, 47, 28, 0.8, red, seed + 2654, 205);
  rect(t, 25, 45, 42, 48, red, seed + 2655, 156);
  drawNoiseDust(t, seed + 2656, grime, 11);
  drawNoiseDust(t, seed + 2657, blue, 7);
}

function drawResidentTrinketBoxSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [28, 26, 22];
  const box: [number, number, number] = [58, 92, 66];
  const boxLight: [number, number, number] = [96, 138, 82];
  const lid: [number, number, number] = [42, 70, 54];
  const brass: [number, number, number] = [204, 154, 60];
  const brassLight: [number, number, number] = [236, 198, 94];
  const red: [number, number, number] = [166, 42, 34];
  const paper: [number, number, number] = [216, 194, 132];
  const rust: [number, number, number] = [120, 66, 38];

  ellipse(t, 33, 53, 18, 4, [8, 8, 7], seed + 2660, 82);
  rect(t, 16, 20, 50, 36, lid, seed + 2661, 242);
  rect(t, 19, 23, 47, 26, boxLight, seed + 2662, 172);
  outlineRect(t, 16, 20, 50, 36, dark);
  rect(t, 13, 33, 52, 50, dark, seed + 2663, 242);
  rect(t, 16, 30, 49, 48, box, seed + 2664, 250);
  outlineRect(t, 13, 33, 52, 50, dark);
  clearRect(t, 13, 33, 17, 36);
  clearRect(t, 50, 34, 52, 38);
  rect(t, 29, 32, 37, 39, brass, seed + 2665, 235);
  rect(t, 31, 33, 35, 36, brassLight, seed + 2666, 210);
  ellipse(t, 23, 36, 4.2, 4.0, brassLight, seed + 2667, 220);
  ellipse(t, 43, 36, 4.0, 4.0, brass, seed + 2668, 218);
  line(t, 19, 43, 36, 34, 1.4, brassLight, seed + 2669, 210);
  ellipse(t, 19, 44, 2.5, 2.2, brass, seed + 2670, 210);
  rect(t, 38, 40, 47, 45, red, seed + 2671, 190);
  rect(t, 40, 42, 46, 43, paper, seed + 2672, 160);
  rect(t, 18, 45, 44, 47, rust, seed + 2673, 108);
  line(t, 17, 31, 49, 48, 0.8, rust, seed + 2674, 122);
  drawNoiseDust(t, seed + 2675, rust, 12);
  drawNoiseDust(t, seed + 2676, brassLight, 7);
}

function drawRubberStripSprite(t: Uint32Array, seed: number): void {
  const rubber: [number, number, number] = [14, 18, 18];
  const rubberLight: [number, number, number] = [52, 64, 60];
  const chalk: [number, number, number] = [160, 166, 142];
  const ochre: [number, number, number] = [210, 150, 46];
  const red: [number, number, number] = [170, 42, 34];
  const grime: [number, number, number] = [78, 62, 38];

  ellipse(t, 33, 53, 18, 4, [8, 8, 7], seed + 2680, 82);
  arcLine(t, 33, 34, 18, 14, Math.PI * 0.15, Math.PI * 1.65, 5.5, rubber, seed + 2681, 246, 22);
  arcLine(t, 33, 34, 13, 9, Math.PI * 0.18, Math.PI * 1.58, 2.5, rubberLight, seed + 2704, 220, 22);
  line(t, 43, 24, 54, 33, 4.8, rubber, seed + 2727, 244);
  line(t, 44, 25, 52, 32, 1.5, chalk, seed + 2728, 140);
  line(t, 20, 42, 11, 50, 5.0, rubber, seed + 2729, 244);
  line(t, 20, 42, 12, 49, 1.3, chalk, seed + 2730, 130);
  rect(t, 26, 25, 38, 31, ochre, seed + 2731, 210);
  rect(t, 28, 27, 37, 28, red, seed + 2732, 190);
  rect(t, 36, 40, 49, 44, ochre, seed + 2733, 185);
  rect(t, 38, 41, 47, 42, rubber, seed + 2734, 135);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.33 + i * 0.23);
    const x = 33 + Math.cos(a) * 16;
    const y = 34 + Math.sin(a) * 12;
    line(t, x - 2, y - 2, x + 3, y + 2, 0.7, chalk, seed + 2735 + i, 118);
  }
  line(t, 19, 49, 49, 25, 0.8, grime, seed + 2741, 126);
  drawNoiseDust(t, seed + 2742, grime, 12);
  drawNoiseDust(t, seed + 2743, chalk, 8);
}

function drawZhekSealSprite(t: Uint32Array, seed: number): void {
  const rubberDark: [number, number, number] = [78, 26, 24];
  const rubber: [number, number, number] = [148, 42, 36];
  const inkWet: [number, number, number] = [190, 46, 40];
  const handle: [number, number, number] = [92, 62, 38];
  const handleLight: [number, number, number] = [154, 104, 56];
  const brass: [number, number, number] = [196, 148, 56];
  const tag: [number, number, number] = [198, 178, 112];
  const ink: [number, number, number] = [28, 24, 20];
  const rust: [number, number, number] = [126, 66, 36];

  ellipse(t, 32, 52, 17, 4, [10, 7, 6], seed + 3140, 82);
  ellipse(t, 32, 23, 12, 10, handle, seed + 3141, 242);
  ellipse(t, 31, 20, 8.5, 5.2, handleLight, seed + 3142, 205);
  rect(t, 25, 30, 40, 38, handle, seed + 3143, 240);
  rect(t, 27, 31, 38, 34, handleLight, seed + 3144, 160);
  rect(t, 22, 37, 44, 43, brass, seed + 3145, 224);
  rect(t, 17, 42, 50, 50, rubberDark, seed + 3146, 248);
  rect(t, 20, 40, 47, 47, rubber, seed + 3147, 250);
  rect(t, 23, 42, 44, 44, inkWet, seed + 3148, 220);
  rect(t, 15, 47, 52, 51, inkWet, seed + 3149, 118);
  rect(t, 41, 23, 52, 30, tag, seed + 3150, 210);
  rect(t, 43, 25, 50, 26, ink, 0, 130);
  rect(t, 44, 28, 51, 29, inkWet, seed + 3151, 160);
  line(t, 20, 49, 48, 31, 0.8, rust, seed + 3152, 130);
  line(t, 25, 44, 44, 44, 0.8, tag, seed + 3153, 150);
  drawNoiseDust(t, seed + 3154, rust, 10);
  drawNoiseDust(t, seed + 3155, inkWet, 8);
}

function drawSoap72Sprite(t: Uint32Array, seed: number): void {
  const soap: [number, number, number] = [202, 156, 72];
  const soapLight: [number, number, number] = [236, 198, 104];
  const soapDark: [number, number, number] = [106, 74, 38];
  const stamp: [number, number, number] = [82, 58, 34];
  const paper: [number, number, number] = [206, 194, 136];
  const green: [number, number, number] = [78, 116, 74];
  const red: [number, number, number] = [164, 42, 36];
  const grime: [number, number, number] = [66, 74, 58];

  ellipse(t, 32, 53, 17, 4, [12, 12, 9], seed + 2744, 76);
  rect(t, 17, 27, 49, 48, soapDark, seed + 2745, 228);
  rect(t, 15, 23, 47, 44, soap, seed + 2746, 252);
  rect(t, 18, 20, 44, 27, soapLight, seed + 2747, 240);
  outlineRect(t, 15, 23, 47, 44, soapDark);
  clearRect(t, 15, 23, 18, 26);
  clearRect(t, 45, 23, 47, 29);
  clearRect(t, 16, 41, 19, 44);
  ellipse(t, 31, 33, 11, 5.5, soapLight, seed + 2748, 126);
  rect(t, 24, 31, 39, 33, stamp, seed + 2749, 155);
  rect(t, 28, 35, 36, 37, stamp, seed + 2750, 136);
  rect(t, 36, 25, 50, 32, paper, seed + 2751, 218);
  rect(t, 39, 27, 47, 28, green, seed + 2752, 180);
  rect(t, 43, 30, 50, 31, red, seed + 2753, 160);
  line(t, 18, 42, 47, 27, 0.8, grime, seed + 2754, 118);
  ellipse(t, 23, 43, 6.5, 3.0, grime, seed + 2755, 92);
  for (let i = 0; i < 10; i++) {
    const x = 21 + Math.floor(noise(i, 88, seed) * 20);
    const y = 27 + Math.floor(noise(i, 89, seed) * 15);
    ellipse(t, x, y, 0.9, 0.8, soapLight, seed + 2756 + i, 105);
  }
  drawNoiseDust(t, seed + 2766, grime, 11);
}

function drawUnsignedOrderSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [184, 166, 112];
  const paperLight: [number, number, number] = [226, 208, 148];
  const ink: [number, number, number] = [24, 22, 18];
  const red: [number, number, number] = [176, 36, 34];
  const damp: [number, number, number] = [76, 86, 72];
  const ochre: [number, number, number] = [202, 144, 48];
  const rust: [number, number, number] = [126, 66, 38];

  rect(t, 15, 12, 50, 53, paper, seed + 3150, 246);
  rect(t, 18, 15, 47, 20, paperLight, seed + 3151, 224);
  outlineRect(t, 15, 12, 50, 53, ink);
  clearRect(t, 15, 12, 19, 15);
  clearRect(t, 48, 13, 50, 19);
  clearRect(t, 16, 50, 20, 53);
  rect(t, 15, 46, 50, 53, damp, seed + 3152, 96);
  rect(t, 20, 22, 43, 24, ink, 0, 145);
  for (let y = 29; y <= 41; y += 5) rect(t, 20, y, 42 - ((seed + y) & 4), y + 1, ink, 0, 128);
  rect(t, 31, 43, 46, 46, red, seed + 3153, 185);
  rect(t, 34, 44, 44, 45, paperLight, seed + 3154, 145);
  line(t, 31, 39, 47, 50, 1.2, red, seed + 3155, 200);
  rect(t, 39, 25, 49, 31, ochre, seed + 3156, 168);
  rect(t, 41, 27, 47, 28, paperLight, seed + 3157, 150);
  line(t, 19, 49, 47, 17, 0.8, damp, seed + 3158, 120);
  drawNoiseDust(t, seed + 3159, rust, 10);
}

function drawValveTagSprite(t: Uint32Array, seed: number): void {
  const dark: [number, number, number] = [20, 24, 24];
  const metal: [number, number, number] = [122, 128, 112];
  const metalLight: [number, number, number] = [202, 198, 166];
  const red: [number, number, number] = [176, 38, 34];
  const yellow: [number, number, number] = [218, 158, 46];
  const rust: [number, number, number] = [134, 66, 34];
  const grime: [number, number, number] = [58, 66, 58];

  ellipse(t, 33, 53, 16, 4, [10, 10, 8], seed + 3160, 82);
  line(t, 23, 19, 16, 11, 1.1, metalLight, seed + 3161, 200);
  ellipse(t, 16, 11, 2.6, 2.0, dark, seed + 3162, 220);
  rect(t, 18, 21, 50, 44, dark, seed + 3163, 238);
  rect(t, 20, 18, 48, 42, metal, seed + 3164, 250);
  outlineRect(t, 18, 21, 50, 44, dark);
  clearRect(t, 18, 21, 22, 24);
  clearRect(t, 47, 19, 50, 25);
  ellipse(t, 26, 27, 5, 4.5, dark, seed + 3165, 245);
  ellipse(t, 26, 27, 2.3, 2.2, [4, 5, 4], 0, 245);
  rect(t, 31, 24, 46, 28, red, seed + 3166, 218);
  rect(t, 33, 25, 44, 26, metalLight, seed + 3167, 170);
  rect(t, 28, 33, 46, 37, yellow, seed + 3168, 205);
  rect(t, 30, 34, 43, 35, dark, 0, 130);
  line(t, 23, 41, 47, 20, 0.9, rust, seed + 3169, 135);
  rect(t, 43, 39, 51, 43, rust, seed + 3170, 160);
  ellipse(t, 22, 42, 6, 3, grime, seed + 3171, 120);
  drawNoiseDust(t, seed + 3172, rust, 11);
  drawNoiseDust(t, seed + 3173, metalLight, 6);
}

function drawSporePrintSprite(t: Uint32Array, seed: number): void {
  const paper: [number, number, number] = [198, 180, 126];
  const paperLight: [number, number, number] = [232, 216, 158];
  const ink: [number, number, number] = [26, 24, 20];
  const spore: [number, number, number] = [38, 50, 34];
  const green: [number, number, number] = [68, 138, 76];
  const tag: [number, number, number] = [176, 42, 36];
  const grime: [number, number, number] = [112, 66, 38];

  ellipse(t, 33, 53, 17, 4, [10, 9, 8], seed + 2880, 82);
  rect(t, 16, 14, 49, 52, paper, seed + 2881, 246);
  rect(t, 19, 17, 46, 22, paperLight, seed + 2882, 196);
  outlineRect(t, 16, 14, 49, 52, ink);
  clearRect(t, 16, 14, 20, 17);
  clearRect(t, 47, 15, 49, 20);
  clearRect(t, 17, 49, 21, 52);
  rect(t, 16, 45, 49, 52, green, seed + 2883, 118);
  ellipse(t, 32, 34, 14, 10, spore, seed + 2884, 198);
  ellipse(t, 32, 34, 10, 7, paper, seed + 2885, 65);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.1;
    line(t, 32, 34, 32 + Math.cos(a) * 14, 34 + Math.sin(a) * 9, 0.7, spore, seed + 2886 + i, 170);
  }
  for (let y = 26; y <= 42; y += 4) rect(t, 22, y, 43 - ((seed + y) & 5), y, ink, 0, 92);
  rect(t, 37, 18, 49, 25, tag, seed + 2898, 185);
  rect(t, 40, 20, 47, 21, paperLight, seed + 2899, 148);
  line(t, 18, 48, 48, 22, 0.8, grime, seed + 2900, 118);
  drawNoiseDust(t, seed + 2901, green, 12);
  drawNoiseDust(t, seed + 2902, grime, 10);
}

function drawSpringSprite(t: Uint32Array, seed: number): void {
  const steel: [number, number, number] = [164, 170, 150];
  const steelLight: [number, number, number] = [226, 226, 190];
  const steelDark: [number, number, number] = [44, 52, 50];
  const rust: [number, number, number] = [132, 66, 34];
  const tag: [number, number, number] = [198, 156, 76];
  const red: [number, number, number] = [168, 42, 36];

  ellipse(t, 33, 53, 18, 4, [10, 10, 9], seed + 2910, 82);
  for (let i = 0; i < 7; i++) {
    const y = 18 + i * 5;
    arcLine(t, 32, y, 15, 5, Math.PI * 0.08, Math.PI * 1.18, 2.0, steelDark, seed + 2911 + i, 228, 14);
    arcLine(t, 32, y, 13, 4, Math.PI * 0.08, Math.PI * 1.18, 1.0, steelLight, seed + 2921 + i, 210, 14);
  }
  line(t, 18, 20, 19, 48, 1.1, steel, seed + 2930, 210);
  line(t, 45, 18, 46, 45, 1.1, steel, seed + 2931, 205);
  line(t, 20, 49, 48, 23, 0.9, rust, seed + 2932, 132);
  rect(t, 37, 39, 51, 46, tag, seed + 2933, 204);
  rect(t, 40, 41, 48, 42, steelDark, seed + 2934, 135);
  rect(t, 41, 44, 49, 45, red, seed + 2935, 160);
  rect(t, 20, 45, 31, 48, rust, seed + 2936, 150);
  for (let i = 0; i < 13; i++) {
    const x = 18 + Math.floor(noise(i, 120, seed) * 29);
    const y = 17 + Math.floor(noise(i, 121, seed) * 31);
    px(t, x, y, rgba(rust[0], rust[1], rust[2], 130));
  }
  drawNoiseDust(t, seed + 2937, steelLight, 8);
}

function drawStrangeClotSprite(t: Uint32Array, seed: number): void {
  const jarGlass: [number, number, number] = [76, 104, 96];
  const jarLight: [number, number, number] = [160, 198, 174];
  const jarDark: [number, number, number] = [26, 36, 34];
  const clot: [number, number, number] = [118, 34, 44];
  const clotLight: [number, number, number] = [184, 58, 66];
  const clotDark: [number, number, number] = [46, 16, 24];
  const tag: [number, number, number] = [204, 180, 112];
  const red: [number, number, number] = [156, 36, 34];
  const rust: [number, number, number] = [124, 62, 36];

  ellipse(t, 33, 52, 15, 4, [10, 10, 8], seed + 3174, 78);
  rect(t, 25, 12, 41, 18, jarDark, seed + 3175, 240);
  rect(t, 27, 14, 39, 17, rust, seed + 3176, 220);
  rect(t, 21, 21, 45, 51, jarGlass, seed + 3177, 120);
  ellipse(t, 33, 21, 12, 5, jarLight, seed + 3178, 145);
  ellipse(t, 33, 51, 12, 4, jarDark, seed + 3179, 125);
  outlineRect(t, 21, 21, 45, 51, jarDark);
  ellipse(t, 32, 36, 12, 10, clotDark, seed + 3180, 242);
  ellipse(t, 33, 35, 10, 8, clot, seed + 3181, 248);
  ellipse(t, 29, 32, 4.4, 3.2, clotLight, seed + 3182, 180);
  ellipse(t, 37, 39, 4.8, 3.8, clotLight, seed + 3183, 140);
  line(t, 26, 36, 39, 31, 1.1, clotDark, seed + 3184, 155);
  line(t, 35, 36, 27, 42, 1.0, clotDark, seed + 3185, 145);
  rect(t, 38, 29, 50, 38, tag, seed + 3186, 215);
  outlineRect(t, 38, 29, 50, 38, jarDark);
  rect(t, 40, 32, 48, 33, red, seed + 3187, 168);
  line(t, 22, 25, 43, 48, 0.8, jarLight, seed + 3188, 120);
  line(t, 43, 23, 23, 49, 0.8, jarDark, seed + 3189, 110);
  drawNoiseDust(t, seed + 3190, clotLight, 12);
  drawNoiseDust(t, seed + 3191, rust, 9);
}

function drawSubstrateSackSprite(t: Uint32Array, seed: number): void {
  const sack: [number, number, number] = [132, 104, 64];
  const sackLight: [number, number, number] = [188, 154, 88];
  const sackDark: [number, number, number] = [56, 42, 28];
  const rot: [number, number, number] = [64, 92, 54];
  const rotLight: [number, number, number] = [104, 136, 72];
  const string: [number, number, number] = [214, 186, 110];
  const red: [number, number, number] = [152, 44, 36];
  const damp: [number, number, number] = [54, 72, 48];

  ellipse(t, 33, 53, 17, 4, [12, 10, 8], seed + 3192, 82);
  rect(t, 21, 18, 44, 28, sackDark, seed + 3193, 228);
  line(t, 23, 20, 43, 20, 1.2, string, seed + 3194, 225);
  line(t, 26, 18, 28, 27, 0.9, string, seed + 3195, 190);
  line(t, 39, 18, 37, 28, 0.9, string, seed + 3196, 190);
  rect(t, 16, 28, 50, 49, sackDark, seed + 3197, 230);
  rect(t, 18, 25, 48, 47, sack, seed + 3198, 250);
  ellipse(t, 33, 25, 15, 5, sackLight, seed + 3199, 230);
  outlineRect(t, 18, 25, 48, 47, sackDark);
  clearRect(t, 18, 25, 21, 28);
  clearRect(t, 46, 25, 48, 31);
  clearRect(t, 19, 44, 22, 47);
  rect(t, 21, 35, 46, 47, rot, seed + 3200, 145);
  ellipse(t, 28, 36, 9, 5, rotLight, seed + 3201, 130);
  rect(t, 25, 31, 41, 36, string, seed + 3202, 200);
  rect(t, 28, 33, 38, 34, sackDark, seed + 3203, 130);
  rect(t, 38, 25, 49, 31, red, seed + 3204, 175);
  rect(t, 40, 27, 47, 28, sackLight, seed + 3205, 150);
  line(t, 20, 46, 48, 29, 0.9, damp, seed + 3206, 125);
  for (let i = 0; i < 16; i++) {
    const x = 21 + Math.floor(noise(i, 98, seed) * 24);
    const y = 28 + Math.floor(noise(i, 99, seed) * 18);
    ellipse(t, x, y, 1.0, 1.0, (i & 1) === 0 ? rotLight : sackLight, seed + 3207 + i, 120);
  }
  drawNoiseDust(t, seed + 3224, damp, 12);
}

function drawMiscSprite(t: Uint32Array, seed: number, p: Palette, defId: string): void {
  if (defId.includes('card_deck')) {
    drawCardDeckSprite(t, seed);
    return;
  }
  switch (defId) {
    case 'strange_clot':
      drawStrangeClotSprite(t, seed);
      return;
    case 'substrate_sack':
      drawSubstrateSackSprite(t, seed);
      return;
    case 'unsigned_order':
      drawUnsignedOrderSprite(t, seed);
      return;
    case 'valve_tag':
      drawValveTagSprite(t, seed);
      return;
    case 'spore_print':
      drawSporePrintSprite(t, seed);
      return;
    case 'spring':
      drawSpringSprite(t, seed);
      return;
    case 'zhek_seal':
      drawZhekSealSprite(t, seed);
      return;
    case 'voluntary_receipt':
      drawVoluntaryReceiptSprite(t, seed);
      return;
    case 'soap_72':
      drawSoap72Sprite(t, seed);
      return;
    case 'rubber_strip':
      drawRubberStripSprite(t, seed);
      return;
    case 'seal_wax':
      drawSealWaxSprite(t, seed);
      return;
    case 'sealed_complaint':
      drawSealedComplaintSprite(t, seed);
      return;
    case 'siren_instruction':
      drawSirenInstructionSprite(t, seed);
      return;
    case 'pressure_logbook':
      drawPressureLogbookSprite(t, seed);
      return;
    case 'samosbor_tally':
      drawSamosborTallySprite(t, seed);
      return;
    case 'record_exposure_notice':
      drawRecordExposureNoticeSprite(t, seed);
      return;
    case 'relay_diagram':
      drawRelayDiagramSprite(t, seed);
      return;
    case 'resident_trinket_box':
      drawResidentTrinketBoxSprite(t, seed);
      return;
    case 'psychiatrist_referral':
      drawPsychiatristReferralSprite(t, seed);
      return;
    case 'pump_passport':
      drawPumpPassportSprite(t, seed);
      return;
    case 'neighbor_complaint':
      drawNeighborComplaintSprite(t, seed);
      return;
    case 'meat_rune':
      drawMeatRuneSprite(t, seed);
      return;
    case 'metal_sheet':
      drawMetalSheetSprite(t, seed);
      return;
    case 'metro_ticket':
      drawMetroTicketSprite(t, seed);
      return;
    case 'missing_record_file':
      drawMissingRecordFileSprite(t, seed);
      return;
    case 'liquidator_token':
      drawLiquidatorTokenSprite(t, seed);
      return;
    case 'market_weight_scale':
      drawMarketWeightScaleSprite(t, seed);
      return;
    case 'lamp_bulb':
      drawLampBulbSprite(t, seed);
      return;
    case 'lift_scheme':
      drawLiftSchemeSprite(t, seed);
      return;
    case 'party_portrait_pin':
      drawPartyPortraitPinSprite(t, seed);
      return;
    case 'personal_file_copy':
      drawPersonalFileCopyDocumentSprite(t, seed);
      return;
    case 'ink_bottle':
      drawInkBottleSprite(t, seed);
      return;
    case 'inspection_mirror':
      drawInspectionMirrorSprite(t, seed);
      return;
    case 'alcohol_bottle':
      drawAlcoholBottleSprite(t, seed);
      return;
    case 'acid_bottle':
      drawAcidBottleSprite(t, seed);
      return;
    case 'book':
      drawBookSprite(t, seed);
      return;
    case 'borrowed_kitchen_key':
      drawBorrowedKitchenKeySprite(t, seed);
      return;
    case 'container_key_label':
      drawContainerKeyLabelSprite(t, seed);
      return;
    case 'ballot':
      drawBallotSprite(t, seed);
      return;
    case 'blank_form':
      drawBlankFormSprite(t, seed);
      return;
    case 'brown_slime_cleanup_act':
      drawBrownSlimeCleanupActSprite(t, seed);
      return;
    case 'caravan_route':
      drawCaravanRouteSprite(t, seed);
      return;
    case 'cult_supply_list':
      drawCultSupplyListSprite(t, seed);
      return;
    case 'denunciation':
      drawDenunciationSprite(t, seed);
      return;
    case 'dice_bone':
      drawDiceBoneSprite(t, seed);
      return;
    case 'checkers_board':
      drawCheckersBoardSprite(t, seed);
      return;
    case 'domino_box':
      drawDominoBoxSprite(t, seed);
      return;
    case 'fuse':
      drawFuseSprite(t, seed);
      return;
    case 'gear':
      drawGearSprite(t, seed);
      return;
    case 'glass_shard':
      drawGlassShardSprite(t, seed);
      return;
    case 'child_map':
      drawChildMapSprite(t, seed);
      return;
    case 'cigs':
      drawCigsSprite(t, seed);
      return;
    case 'circuit_board':
      drawCircuitBoardSprite(t, seed);
      return;
    case 'govnyak_courier_package':
      drawGovnyakCourierPackageSprite(t, seed);
      return;
    case 'gunstock':
      drawGunstockSprite(t, seed);
      return;
    case 'filter_layer':
      drawFilterLayerSprite(t, seed);
      return;
    case 'filter_receipt':
      drawFilterReceiptSprite(t, seed);
      return;
    case 'idol_chernobog':
      drawIdolChernobogSprite(t, seed);
      return;
    case 'import_toiletpaper':
      drawImportToiletpaperSprite(t, seed);
      return;
    case 'toiletpaper':
      drawToiletpaperSprite(t, seed);
      return;
    case 'diver_route_tag':
      drawDiverRouteTagSprite(t, seed);
      return;
    case 'duct_tape':
      drawDuctTapeSprite(t, seed);
      return;
    case 'elevator_override_form':
      drawElevatorOverrideFormSprite(t, seed);
      return;
    case 'emergency_roster':
      drawEmergencyRosterSprite(t, seed);
      return;
    case 'empty_roks_tank':
      drawEmptyRoksTankSprite(t, seed);
      return;
  }
  rect(t, 18, 25, 46, 49, p.body, seed + 193);
  rect(t, 21, 19, 43, 27, p.light, seed + 194);
  outlineRect(t, 18, 25, 46, 49, p.dark);
  rect(t, 24, 33, 40, 38, p.accent, seed + 195, 205);
}

function applyIdentityMarks(t: Uint32Array, seed: number, p: Palette, kind: VisualKind): void {
  const count = 2 + (seed % 4);
  for (let i = 0; i < count; i++) {
    const x = 15 + Math.floor(noise(i, 10, seed) * 34);
    const y = 15 + Math.floor(noise(i, 11, seed) * 34);
    const c = ((seed >>> (i * 3)) & 1) === 0 ? p.accent : p.light;
    if (kind === 'document') rect(t, x, y, x + 2, y, c, 0, 170);
    else if (kind === 'ammo') rect(t, x, y, x + 1, y + 1, c, 0, 160);
    else ellipse(t, x, y, 1.2, 1.2, c, seed + i, 140);
  }
}

export function itemSpriteKey(defId: string): string {
  return defId;
}

export function itemDropDefId(e: { inventory?: readonly { defId: string; count: number }[] } | null | undefined): string | null {
  const item = e?.inventory?.find(slot => slot && slot.count > 0 && typeof slot.defId === 'string');
  return item?.defId ?? null;
}

export function generateItemSprite(defId: string, def: ItemDef | undefined = ITEMS[defId]): ItemSpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const seed = hashString(defId);
  const kind = itemVisualKind(defId, def);
  const palette = paletteFor(kind, seed, defId);
  drawDropShadow(t);

  switch (kind) {
    case 'food': drawFoodSprite(t, seed, palette, defId); break;
    case 'drink': drawDrinkSprite(t, seed, palette, defId); break;
    case 'medicine': drawMedicineSprite(t, seed, palette, defId); break;
    case 'weapon': drawWeaponSprite(t, seed, palette, defId); break;
    case 'ammo': drawAmmoSprite(t, seed, palette, defId); break;
    case 'document': drawDocumentSprite(t, seed, palette, defId, def); break;
    case 'key': drawKeySprite(t, seed, palette); break;
    case 'sample': drawSampleSprite(t, seed, palette, defId); break;
    case 'tool': drawToolSprite(t, seed, palette, defId); break;
    case 'electronics': drawElectronicsSprite(t, seed, palette, defId); break;
    case 'artifact': drawArtifactSprite(t, seed, palette, defId); break;
    case 'repair': drawRepairSprite(t, seed, palette, defId); break;
    default: drawMiscSprite(t, seed, palette, defId); break;
  }

  applyIdentityMarks(t, seed, palette, kind);
  return t;
}

function imageDataForSprite(ctx: CanvasRenderingContext2D, sprite: Uint32Array): ImageData {
  const img = ctx.createImageData(S, S);
  const data = img.data;
  for (let i = 0; i < sprite.length; i++) {
    const p = sprite[i];
    const o = i * 4;
    data[o] = p & 255;
    data[o + 1] = (p >>> 8) & 255;
    data[o + 2] = (p >>> 16) & 255;
    data[o + 3] = (p >>> 24) & 255;
  }
  return img;
}

function canvasForItem(defId: string, ctx: CanvasRenderingContext2D): HTMLCanvasElement | null {
  const key = itemSpriteKey(defId);
  const cached = ICON_CANVAS_CACHE.get(key);
  if (cached) {
    ICON_CANVAS_CACHE.delete(key);
    ICON_CANVAS_CACHE.set(key, cached);
    return cached;
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const iconCtx = canvas.getContext('2d');
  if (!iconCtx) return null;
  iconCtx.putImageData(imageDataForSprite(ctx, generateItemSprite(defId)), 0, 0);
  ICON_CANVAS_CACHE.set(key, canvas);
  trimItemIconCanvasCache();
  return canvas;
}

export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  defId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
): void {
  const canvas = canvasForItem(defId, ctx);
  if (!canvas) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const oldSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.imageSmoothingEnabled = oldSmoothing;
  ctx.restore();
}

export function drawItemGridIcon(
  ctx: CanvasRenderingContext2D,
  defId: string,
  name: string,
  x: number,
  y: number,
  cellSize: number,
  sx: number,
  sy: number,
  selected = false,
  alpha = 1,
  options: { nameYUnits?: number; iconTopUnits?: number; bottomReserveUnits?: number; maxIconUnits?: number } = {},
): void {
  const nameY = y + (options.nameYUnits ?? 5.4) * sy;
  const iconTop = y + (options.iconTopUnits ?? 6.4) * sy;
  const bottomReserve = (options.bottomReserveUnits ?? 5.2) * sy;
  const maxIcon = Math.max(8 * sx, cellSize - (iconTop - y) - bottomReserve);
  const iconSize = Math.max(8 * sx, Math.min(maxIcon, (options.maxIconUnits ?? 13) * sx));
  const iconX = x + (cellSize - iconSize) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2 * sx, y + 2 * sy, Math.max(1, cellSize - 6 * sx), Math.max(1, cellSize - 7 * sy));
  ctx.clip();
  ctx.font = `${4.8 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = selected ? '#0fa' : '#b8c8c8';
  ctx.fillText(fitText(ctx, name, cellSize - 6 * sx), x + cellSize / 2 - sx, nameY);
  ctx.restore();

  drawItemIcon(ctx, defId, iconX, iconTop, iconSize, iconSize, alpha);
}

export function clearItemIconCanvasCache(): void {
  ICON_CANVAS_CACHE.clear();
}

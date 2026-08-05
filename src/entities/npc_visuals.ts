import { Faction, Occupation } from '../core/types';
import {
  ART_SPRITE_MANIFEST,
  NPC_VISUAL_CULTIST_MALE,
  NPC_VISUAL_LIQUIDATOR_MALE,
  NPC_VISUAL_OLGA_DMITRIEVNA,
  NPC_VISUAL_SCIENTIST_FEMALE,
  NPC_VISUAL_SCIENTIST_MALE,
  NPC_VISUAL_WILD_MALE,
  NPC_VISUAL_WORKER69,
  NPC_VISUAL_CITIZEN_MALE,
  NPC_VISUAL_CITIZEN_FEMALE,
  NPC_VISUAL_CITIZEN_OLD_MALE,
  NPC_VISUAL_CITIZEN_OLD_FEMALE,
  NPC_VISUAL_CITIZEN_CHILD_MALE,
  NPC_VISUAL_CITIZEN_CHILD_FEMALE,
  NPC_VISUAL_CIVIL_DEFENSE_MALE,
  artSpriteManifestRow,
} from '../data/art_sprite_manifest';
import { NPC_VISUAL_FLOOR69_FEMALE_ID } from '../data/design_floor_profiles';
import { generateFloor69FemaleNpcSprite } from '../render/art_sprites';
import { getGeneratedArtSprite } from '../render/generated_art_sprites';
import { S, CLEAR, clamp, noise, rgba } from '../render/pixutil';
import { Spr, authoredNpcSpriteGeneratorOffset } from '../render/sprite_index';

export const NPC_VISUAL_FLOOR69_FEMALE = NPC_VISUAL_FLOOR69_FEMALE_ID;
export const NPC_VISUAL_LIQUIDATOR_MASKED = 'liquidator_masked';
export const NPC_VISUAL_CULT_HOOD = 'cult_hood';
export const NPC_VISUAL_SERVICE_WORKER = 'service_worker';
export const NPC_VISUAL_SCIENTIST_LAB = 'scientist_lab';
export const NPC_VISUAL_MARKET_GUARD = 'market_guard';
export const NPC_VISUAL_WOUNDED_RESIDENT = 'wounded_resident';
export const NPC_VISUAL_INFECTED_NEIGHBOR = 'infected_neighbor';
export const NPC_VISUAL_NET_OPERATOR = 'net_operator';
export const NPC_READABILITY_VISUAL_IDS = [
  NPC_VISUAL_LIQUIDATOR_MASKED,
  NPC_VISUAL_CULT_HOOD,
  NPC_VISUAL_SERVICE_WORKER,
  NPC_VISUAL_SCIENTIST_LAB,
  NPC_VISUAL_MARKET_GUARD,
  NPC_VISUAL_WOUNDED_RESIDENT,
  NPC_VISUAL_INFECTED_NEIGHBOR,
  NPC_VISUAL_NET_OPERATOR,
] as const;
export {
  NPC_VISUAL_CULTIST_MALE,
  NPC_VISUAL_LIQUIDATOR_MALE,
  NPC_VISUAL_OLGA_DMITRIEVNA,
  NPC_VISUAL_SCIENTIST_FEMALE,
  NPC_VISUAL_SCIENTIST_MALE,
  NPC_VISUAL_WILD_MALE,
  NPC_VISUAL_WORKER69,
  NPC_VISUAL_CITIZEN_MALE,
  NPC_VISUAL_CITIZEN_FEMALE,
  NPC_VISUAL_CITIZEN_OLD_MALE,
  NPC_VISUAL_CITIZEN_OLD_FEMALE,
  NPC_VISUAL_CITIZEN_CHILD_MALE,
  NPC_VISUAL_CITIZEN_CHILD_FEMALE,
  NPC_VISUAL_CIVIL_DEFENSE_MALE,
};

export interface NpcVisualContext {
  seed: number;
  sprite?: number;
  occupation?: Occupation;
  faction?: Faction;
  isFemale?: boolean;
  age?: number;
}

export type NpcVisualSource = 'procedural' | 'first_party_art' | 'community_art';

export interface NpcVisualFamily {
  id: string;
  source: NpcVisualSource;
  usesDynamicTexture: boolean;
  worldSpriteScale?: number;
  procedural?: boolean;
  generate(ctx: NpcVisualContext): Uint32Array;
  textureKey?(ctx: NpcVisualContext): string;
}

export const FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE = 0.65;

function mix32(v: number): number {
  v >>>= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b) >>> 0;
  v ^= v >>> 16;
  return v >>> 0;
}

export function isFloor69FemaleSprite(sprite: number): boolean {
  return sprite >= Spr.F69_FEMALE_NPC_BASE && sprite <= Spr.F69_FEMALE_NPC_7;
}

function floor69Variant(ctx: NpcVisualContext): number {
  const atlasVariant = ctx.sprite !== undefined && isFloor69FemaleSprite(ctx.sprite)
    ? ctx.sprite - Spr.F69_FEMALE_NPC_BASE
    : 0;
  return mix32((ctx.seed || 1) ^ Math.imul(atlasVariant + 1, 0x69f69f));
}

function firstPartyNpcArt(manifestId: string): Uint32Array | undefined {
  const row = artSpriteManifestRow(manifestId);
  if (!row || row.kind !== 'npc' || row.source !== 'first_party_art') return undefined;
  return getGeneratedArtSprite(row.id);
}

const manifestFamilies: Record<string, string[]> = {};
for (const row of ART_SPRITE_MANIFEST) {
  for (const mapping of row.intendedMappings) {
    if (mapping.type === 'npc_exact' || mapping.type === 'npc_family') {
      if (!manifestFamilies[mapping.visualId]) {
        manifestFamilies[mapping.visualId] = [];
      }
      manifestFamilies[mapping.visualId].push(row.id);
    }
  }
}

const GENERATED_ART_FAMILIES: NpcVisualFamily[] = Object.entries(manifestFamilies)
  .filter(([visualId]) => visualId !== NPC_VISUAL_WORKER69)
  .map(([visualId, manifestIds]) => ({
    id: visualId,
    source: 'first_party_art',
    usesDynamicTexture: true,
    worldSpriteScale: FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE,
    procedural: false,
    generate: ctx => {
      const seed = mix32((ctx.seed || 1) ^ Math.imul((ctx.sprite ?? 0) + 1, 0x51ed270b));
      const manifestId = manifestIds[seed % manifestIds.length];
      return firstPartyNpcArt(manifestId) ?? new Uint32Array(0);
    },
    textureKey: ctx => {
      const seed = mix32((ctx.seed || 1) ^ Math.imul((ctx.sprite ?? 0) + 1, 0x51ed270b));
      const manifestId = manifestIds[seed % manifestIds.length];
      return `first_party_art:${manifestId}`;
    },
  }));

const worker69MaleIds: string[] = [];
const worker69FemaleIds: string[] = [];
for (const id of manifestFamilies[NPC_VISUAL_WORKER69] || []) {
  const row = artSpriteManifestRow(id);
  const mapping = row?.intendedMappings.find(m => m.type === 'npc_family' && m.visualId === NPC_VISUAL_WORKER69);
  if (mapping && 'sex' in mapping && mapping.sex === 'male') {
    worker69MaleIds.push(id);
  } else {
    worker69FemaleIds.push(id);
  }
}

const worker69Family: NpcVisualFamily = {
  id: NPC_VISUAL_WORKER69,
  source: 'first_party_art',
  usesDynamicTexture: true,
  worldSpriteScale: FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE,
  procedural: true,
  generate: ctx => {
    const seed = mix32((ctx.seed || 1) ^ Math.imul((ctx.sprite ?? 0) + 1, 0x51ed270b));
    if (ctx.isFemale === false) {
      const manifestId = worker69MaleIds[seed % Math.max(1, worker69MaleIds.length)];
      if (manifestId) return firstPartyNpcArt(manifestId) ?? new Uint32Array(0);
      return new Uint32Array(0);
    }
    const choice = seed % 10;
    if (choice < 4 && worker69FemaleIds.length > 0) {
      const manifestId = worker69FemaleIds[choice % worker69FemaleIds.length];
      return firstPartyNpcArt(manifestId) ?? generateFloor69FemaleNpcSprite(floor69Variant(ctx));
    }
    return generateFloor69FemaleNpcSprite(floor69Variant(ctx));
  },
  textureKey: ctx => {
    const seed = mix32((ctx.seed || 1) ^ Math.imul((ctx.sprite ?? 0) + 1, 0x51ed270b));
    if (ctx.isFemale === false) {
      const manifestId = worker69MaleIds[seed % Math.max(1, worker69MaleIds.length)];
      if (manifestId) return `first_party_art:${manifestId}`;
      return `empty`;
    }
    const choice = seed % 10;
    if (choice < 4 && worker69FemaleIds.length > 0) {
      const manifestId = worker69FemaleIds[choice % worker69FemaleIds.length];
      return `first_party_art:${manifestId}`;
    }
    return `procedural_f69:${floor69Variant(ctx)}`;
  }
};

type Rgb = readonly [number, number, number];

interface RoleNpcVisualProfile {
  id: typeof NPC_READABILITY_VISUAL_IDS[number];
  coat: Rgb;
  pants: Rgb;
  skin: Rgb;
  accent: Rgb;
  head: 'mask' | 'hood' | 'cap' | 'hair' | 'visor';
  stance: 'straight' | 'bent' | 'wide';
  detail: 'filter' | 'cord' | 'tool' | 'lab' | 'guard' | 'bandage' | 'infection' | 'net';
}

const ROLE_NPC_VISUALS: readonly RoleNpcVisualProfile[] = [
  { id: NPC_VISUAL_LIQUIDATOR_MASKED, coat: [60, 76, 54], pants: [36, 44, 38], skin: [130, 112, 92], accent: [118, 152, 112], head: 'mask', stance: 'wide', detail: 'filter' },
  { id: NPC_VISUAL_CULT_HOOD, coat: [28, 24, 38], pants: [20, 18, 26], skin: [126, 96, 82], accent: [152, 76, 188], head: 'hood', stance: 'straight', detail: 'cord' },
  { id: NPC_VISUAL_SERVICE_WORKER, coat: [64, 84, 104], pants: [44, 54, 64], skin: [172, 132, 104], accent: [220, 164, 52], head: 'cap', stance: 'straight', detail: 'tool' },
  { id: NPC_VISUAL_SCIENTIST_LAB, coat: [214, 218, 208], pants: [52, 56, 70], skin: [184, 148, 118], accent: [92, 166, 188], head: 'hair', stance: 'straight', detail: 'lab' },
  { id: NPC_VISUAL_MARKET_GUARD, coat: [78, 72, 48], pants: [44, 48, 42], skin: [160, 122, 96], accent: [178, 42, 38], head: 'cap', stance: 'wide', detail: 'guard' },
  { id: NPC_VISUAL_WOUNDED_RESIDENT, coat: [118, 82, 86], pants: [58, 58, 68], skin: [178, 134, 108], accent: [220, 214, 192], head: 'hair', stance: 'bent', detail: 'bandage' },
  { id: NPC_VISUAL_INFECTED_NEIGHBOR, coat: [82, 100, 74], pants: [54, 58, 46], skin: [118, 154, 104], accent: [152, 44, 72], head: 'hair', stance: 'bent', detail: 'infection' },
  { id: NPC_VISUAL_NET_OPERATOR, coat: [34, 44, 54], pants: [26, 32, 40], skin: [152, 126, 104], accent: [54, 214, 200], head: 'visor', stance: 'straight', detail: 'net' },
];

function roleShade(c: Rgb, x: number, y: number, seed: number, amp = 16, a = 255): number {
  const n = noise(x, y, seed) * amp - amp * 0.45;
  return rgba(clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n), a);
}

function roleRect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: Rgb, seed: number, a = 255): void {
  for (let y = Math.max(0, y0); y <= Math.min(S - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(S - 1, x1); x++) {
    t[y * S + x] = roleShade(c, x, y, seed, 18, a);
  }
}

function roleEllipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, c: Rgb, seed: number, a = 255): void {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(S - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(S - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      t[y * S + x] = roleShade(c, x, y, seed, 16, clamp(a - d * 36));
    }
  }
}

function roleLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: Rgb, seed: number, width = 0, a = 255): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || px >= S || py < 0 || py >= S) continue;
      t[py * S + px] = roleShade(c, px, py, seed, 10, a);
    }
  }
}

function generateRoleNpcVisual(profile: RoleNpcVisualProfile, ctx: NpcVisualContext): Uint32Array {
  const seed = mix32((ctx.seed || 1) ^ Math.imul(profile.id.length + 1, 0x45d9f3b));
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32 + Math.floor((noise(seed & 63, profile.id.length, 881) - 0.5) * 2);
  const bent = profile.stance === 'bent';
  const wide = profile.stance === 'wide';
  const headCy = bent ? 18 : 16;
  const bodyTop = bent ? 25 : 24;
  const bodyBot = bent ? 46 : 45;
  const lean = bent ? 4 : 0;

  roleRect(t, cx - (wide ? 7 : 5) - lean, bodyBot - 1, cx - (wide ? 2 : 1) - lean, 58, profile.pants, seed + 10);
  roleRect(t, cx + (wide ? 2 : 1) - lean, bodyBot - 1, cx + (wide ? 7 : 5) - lean, 58, profile.pants, seed + 11);
  roleEllipse(t, cx - lean, bodyTop + 10, wide ? 13 : 11, 15, profile.coat, seed + 12);
  roleRect(t, cx - 8 - lean, bodyTop + 2, cx + 8 - lean, bodyBot, profile.coat, seed + 13);
  roleLine(t, cx - 10 - lean, bodyTop + 5, cx - 15 - lean, bodyBot - 4, profile.coat, seed + 14, 1);
  roleLine(t, cx + 10 - lean, bodyTop + 5, cx + 15 - lean, bodyBot - 4, profile.coat, seed + 15, 1);

  if (profile.head === 'hood') {
    roleEllipse(t, cx - lean, headCy + 2, 10, 12, profile.coat, seed + 20);
    roleEllipse(t, cx - lean, headCy + 4, 5, 6, profile.skin, seed + 21, 235);
  } else if (profile.head === 'mask') {
    roleEllipse(t, cx - lean, headCy + 2, 8, 10, [38, 44, 38], seed + 22);
    roleEllipse(t, cx - 3 - lean, headCy + 1, 3, 3, profile.accent, seed + 23, 230);
    roleEllipse(t, cx + 3 - lean, headCy + 1, 3, 3, profile.accent, seed + 24, 230);
    roleRect(t, cx - 2 - lean, headCy + 5, cx + 2 - lean, headCy + 10, [26, 30, 28], seed + 25);
  } else if (profile.head === 'visor') {
    roleEllipse(t, cx - lean, headCy + 2, 8, 10, profile.skin, seed + 26);
    roleRect(t, cx - 7 - lean, headCy, cx + 7 - lean, headCy + 4, [18, 42, 46], seed + 27);
    roleRect(t, cx - 5 - lean, headCy + 1, cx + 5 - lean, headCy + 2, profile.accent, seed + 28, 240);
  } else {
    roleEllipse(t, cx - lean, headCy + 2, 8, 10, profile.skin, seed + 29);
    const headwear: Rgb = profile.head === 'cap' ? profile.coat : [46, 36, 28];
    roleRect(t, cx - 8 - lean, headCy - 7, cx + 8 - lean, headCy - 2, headwear, seed + 30);
  }

  switch (profile.detail) {
    case 'filter':
      roleLine(t, cx - 4 - lean, headCy + 8, cx - 13 - lean, bodyTop + 14, [34, 34, 30], seed + 40, 1);
      roleRect(t, cx - 18 - lean, bodyTop + 14, cx - 12 - lean, bodyTop + 22, [42, 54, 46], seed + 41);
      break;
    case 'cord':
      roleLine(t, cx - lean, bodyTop + 2, cx - lean, bodyBot - 2, profile.accent, seed + 42);
      roleLine(t, cx - 4 - lean, bodyTop + 13, cx + 4 - lean, bodyTop + 13, profile.accent, seed + 43);
      break;
    case 'tool':
      roleRect(t, cx - 9 - lean, bodyBot - 6, cx + 9 - lean, bodyBot - 4, profile.accent, seed + 44);
      roleLine(t, cx + 15 - lean, bodyTop + 11, cx + 23 - lean, bodyTop + 21, [166, 166, 142], seed + 45, 1);
      break;
    case 'lab':
      roleRect(t, cx - 10 - lean, bodyTop + 1, cx + 10 - lean, bodyBot, [224, 226, 218], seed + 46, 210);
      roleRect(t, cx + 10 - lean, bodyTop + 13, cx + 13 - lean, bodyTop + 20, profile.accent, seed + 47);
      break;
    case 'guard':
      roleRect(t, cx - 11 - lean, bodyTop + 7, cx + 11 - lean, bodyTop + 10, profile.accent, seed + 48);
      roleLine(t, cx + 16 - lean, bodyTop + 4, cx + 24 - lean, bodyBot - 2, [76, 52, 34], seed + 49, 1);
      break;
    case 'bandage':
      roleRect(t, cx - 8 - lean, headCy - 2, cx + 7 - lean, headCy + 1, profile.accent, seed + 50);
      roleLine(t, cx + 9 - lean, bodyTop + 7, cx + 15 - lean, bodyTop + 19, [148, 34, 42], seed + 51, 1);
      break;
    case 'infection':
      roleLine(t, cx - 5 - lean, headCy + 8, cx + 7 - lean, bodyTop + 18, profile.accent, seed + 52, 1);
      roleEllipse(t, cx + 6 - lean, bodyTop + 15, 3, 4, [80, 180, 112], seed + 53, 220);
      break;
    case 'net':
      roleLine(t, cx + 8 - lean, headCy + 3, cx + 21 - lean, bodyTop + 2, profile.accent, seed + 54);
      roleRect(t, cx - 11 - lean, bodyTop + 14, cx + 11 - lean, bodyTop + 17, [22, 62, 68], seed + 55);
      break;
  }

  return t;
}

export const NPC_VISUAL_FAMILIES: readonly NpcVisualFamily[] = [
  {
    id: NPC_VISUAL_FLOOR69_FEMALE,
    source: 'procedural',
    usesDynamicTexture: true,
    procedural: true,
    generate: ctx => generateFloor69FemaleNpcSprite(floor69Variant(ctx)),
  },
  worker69Family,
  ...GENERATED_ART_FAMILIES,
  ...ROLE_NPC_VISUALS.map(profile => ({
    id: profile.id,
    source: 'procedural' as const,
    usesDynamicTexture: true,
    procedural: true,
    generate: (ctx: NpcVisualContext) => generateRoleNpcVisual(profile, ctx),
  })),
] as const;

export function npcVisualFamily(id: string | undefined): NpcVisualFamily | undefined {
  if (!id) return undefined;
  return NPC_VISUAL_FAMILIES.find(family => family.id === id);
}

export function npcVisualUsesDynamicTexture(id: string | undefined): boolean {
  return npcVisualFamily(id)?.usesDynamicTexture === true;
}

export function npcVisualWorldSpriteScale(id: string | undefined): number | undefined {
  return npcVisualFamily(id)?.worldSpriteScale;
}

export function npcVisualUsesProceduralSprite(id: string | undefined): boolean {
  return npcVisualUsesDynamicTexture(id);
}

export function generateNpcVisualSprite(id: string | undefined, ctx: NpcVisualContext): Uint32Array | undefined {
  const family = npcVisualFamily(id);
  const sprite = family?.generate(ctx);
  return sprite && (sprite.length === S * S || sprite.length === 128 * 128) ? sprite : undefined;
}

export function npcVisualTextureKey(id: string | undefined, ctx: NpcVisualContext): string | undefined {
  return npcVisualFamily(id)?.textureKey?.(ctx);
}

export function isNpcSpecialSprite(sprite: number | undefined): boolean {
  if (sprite === undefined) return false;
  return authoredNpcSpriteGeneratorOffset(sprite) >= 0 || isFloor69FemaleSprite(sprite);
}

export function sanitizeNpcVisualId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const id = input.trim();
  if (!id || !/^[a-z0-9_:.-]+$/.test(id)) return undefined;
  return id.slice(0, 64);
}

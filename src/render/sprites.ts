/* ── Procedural sprite generator ──────────────────────────────── */

import {
  AUTHORED_NPC_SPRITE_GENERATORS,
  NPC_SPRITE_GENERATORS,
  generateTravelerSprite,
  generatePilgrimSprite,
  generateHunterSprite,
  generatePriestSprite,
  generatePerformerSprite } from '../entities/npc';
import { MONSTERS,
  MONSTER_SPRITES,
  EYE_BOLT_SPRITE } from '../entities/monster';
import { monsterProjectileFamily, type MonsterProjectileFamily } from '../data/monster_visuals';
import { ContainerKind,
  Feature,
} from '../core/types';
import { S, rgba, noise, clamp, CLEAR } from './pixutil';
import { Spr, monsterSpr, SPRITE_CONTAINER_KINDS, SPRITE_FEATURES, SPRITE_MONSTER_KINDS } from './sprite_index';
import { ART_NUDE_VARIANTS, F69_FEMALE_NPC_VARIANTS, generateArtNudeSprite, generateFloor69FemaleNpcSprite } from './art_sprites';

export type SpriteData = Uint32Array; // S*S RGBA with alpha

/* ── Sprite sheet — indices computed automatically by sprite_index.ts ── */
export function generateSprites(): SpriteData[] {
  const sprites: SpriteData[] = [];
  // Occupation NPCs
  for (const gen of NPC_SPRITE_GENERATORS) {
    sprites.push(gen());
  }
  // Travelers: Путник, Паломник, Охотник
  sprites.push(generateTravelerSprite());
  sprites.push(generatePilgrimSprite());
  sprites.push(generateHunterSprite());
  // Priest: Батюшка
  sprites.push(generatePriestSprite());
  // Performer: Перформер
  sprites.push(generatePerformerSprite());
  for (const def of AUTHORED_NPC_SPRITE_GENERATORS) sprites.push(def.generate());
  // Item drop
  sprites.push(gen_itemDrop());
  // Monsters (keyed by MonsterKind — auto-indexed)
  for (const kind of SPRITE_MONSTER_KINDS) {
    sprites.push(MONSTER_SPRITES[kind]());
  }
  // Auto-assign sprite indices on MonsterDefs so spawn code stays simple
  for (const kind of SPRITE_MONSTER_KINDS) {
    const def = MONSTERS[kind];
    def.sprite = monsterSpr(kind);
    // Auto-assign projSprite for ranged monsters
    if (def.isRanged && (def.projSprite === undefined || def.projSprite === 0)) def.projSprite = projectileSpriteForFamily(monsterProjectileFamily(kind));
  }
  // Eye bolt projectile
  sprites.push(EYE_BOLT_SPRITE());
  sprites.push(gen_paragraphBoltSprite());
  sprites.push(gen_webBoltSprite());
  sprites.push(gen_wetLineBoltSprite());
  // Desk
  sprites.push(gen_deskSprite());
  for (const feature of SPRITE_FEATURES) sprites.push(gen_featureSprite(feature));
  for (const kind of SPRITE_CONTAINER_KINDS) sprites.push(gen_containerSprite(kind));
  // Projectiles
  sprites.push(gen_bulletSprite());
  sprites.push(gen_pelletSprite());
  sprites.push(gen_nailSprite());
  // PSI bolt
  sprites.push(gen_psiBoltSprite());
  sprites.push(gen_plasmaBoltSprite());
  // Hostile projectile variants
  sprites.push(gen_hostileBulletSprite());
  sprites.push(gen_hostilePelletSprite());
  sprites.push(gen_hostileNailSprite());
  sprites.push(gen_hostilePsiBoltSprite());
  sprites.push(gen_hostilePlasmaBoltSprite());
  sprites.push(gen_hostileFlameBoltSprite());
  // New projectiles
  sprites.push(gen_gaussBoltSprite());
  sprites.push(gen_bfgBoltSprite());
  sprites.push(gen_flameBoltSprite());
  sprites.push(gen_grenadeSprite());
  sprites.push(gen_trainCarSprite());
  for (let i = 0; i < ART_NUDE_VARIANTS; i++) {
    sprites.push(generateArtNudeSprite(i));
  }
  for (let i = 0; i < F69_FEMALE_NPC_VARIANTS; i++) {
    sprites.push(generateFloor69FemaleNpcSprite(i));
  }
  return sprites;
}

function projectileSpriteForFamily(family: MonsterProjectileFamily | undefined): number {
  switch (family) {
    case 'eye_bolt': return Spr.EYE_BOLT;
    case 'protocol_clause': return Spr.PARAGRAPH_BOLT;
    case 'web_lash': return Spr.WEB_BOLT;
    case 'wet_line_shot': return Spr.WET_LINE_BOLT;
    case 'flame_bloom': return Spr.HOSTILE_FLAME_BOLT;
    case 'plasma_core': return Spr.HOSTILE_PLASMA_BOLT;
    case 'psi_pulse':
    default: return Spr.HOSTILE_PSI_BOLT;
  }
}

/* ── Desk: Soviet school desk (green top, metal legs) ─────────── */
function gen_deskSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  // Desk appears in lower half of sprite (it's a table, not full height)
  const topY = 20;  // desk surface top edge
  const botY = 44;  // desk legs bottom
  const leftX = 6;
  const rightX = S - 7;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 777) * 10;
    if (x >= leftX && x <= rightX) {
      if (y >= topY && y <= topY + 4) {
        // Desk surface — Soviet green
        const shade = Math.sin(x * 0.3) * 4;
        t[y * S + x] = rgba(
          clamp(55 + shade + n),
          clamp(90 + shade + n),
          clamp(60 + n / 2),
        );
      } else if (y > topY + 4 && y <= topY + 6) {
        // Front apron — dark wood edge
        t[y * S + x] = rgba(clamp(70 + n), clamp(55 + n), clamp(30 + n));
      } else if (y > topY + 6 && y <= botY) {
        // Legs region: two metal legs
        const leg1 = x >= leftX + 2 && x <= leftX + 4;
        const leg2 = x >= rightX - 4 && x <= rightX - 2;
        if (leg1 || leg2) {
          t[y * S + x] = rgba(clamp(75 + n), clamp(78 + n), clamp(82 + n));
        }
      }
    }
  }
  return t;
}

function rect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, seed = 0, a = 255): void {
  const lx = Math.max(0, Math.floor(x0));
  const rx = Math.min(S - 1, Math.floor(x1));
  const ty = Math.max(0, Math.floor(y0));
  const by = Math.min(S - 1, Math.floor(y1));
  for (let y = ty; y <= by; y++) for (let x = lx; x <= rx; x++) {
    const n = seed === 0 ? 0 : noise(x, y, seed) * 16 - 8;
    t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n), a);
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed = 0, a = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const n = seed === 0 ? 0 : noise(x, y, seed) * 14 - 7;
    t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n), a);
  }
}

function outlineBox(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  rect(t, x0, y0, x1, y0 + 1, r, g, b);
  rect(t, x0, y1 - 1, x1, y1, r, g, b);
  rect(t, x0, y0, x0 + 1, y1, r, g, b);
  rect(t, x1 - 1, y0, x1, y1, r, g, b);
}

function gen_featureSprite(feature: Feature): SpriteData {
  if (feature === Feature.DESK) return gen_deskSprite();
  const t = new Uint32Array(S * S).fill(CLEAR);
  switch (feature) {
    case Feature.LAMP:
      rect(t, 30, 17, 34, 50, 76, 78, 70, 101);
      ellipse(t, 32, 17, 12, 7, 220, 176, 86, 102, 230);
      ellipse(t, 32, 16, 5, 3, 255, 230, 130, 103, 255);
      rect(t, 24, 50, 40, 54, 60, 62, 58, 104);
      break;
    case Feature.CANDLE:
      rect(t, 28, 28, 36, 53, 214, 204, 162, 111);
      ellipse(t, 32, 25, 7, 10, 255, 170, 45, 112, 235);
      ellipse(t, 32, 23, 3, 5, 255, 246, 160, 113, 255);
      break;
    case Feature.TABLE:
      rect(t, 8, 24, 56, 31, 112, 76, 42, 121);
      rect(t, 10, 31, 54, 35, 72, 48, 30, 122);
      rect(t, 13, 35, 17, 52, 70, 52, 36, 123);
      rect(t, 47, 35, 51, 52, 70, 52, 36, 124);
      break;
    case Feature.CHAIR:
      rect(t, 18, 18, 24, 48, 86, 62, 42, 131);
      rect(t, 24, 31, 47, 38, 108, 76, 48, 132);
      rect(t, 28, 38, 32, 52, 74, 58, 44, 133);
      rect(t, 43, 38, 47, 52, 74, 58, 44, 134);
      break;
    case Feature.BED:
      rect(t, 7, 26, 57, 47, 72, 78, 92, 141);
      rect(t, 10, 21, 26, 32, 182, 188, 174, 142);
      rect(t, 7, 44, 57, 53, 55, 42, 34, 143);
      break;
    case Feature.STOVE:
      rect(t, 17, 18, 47, 53, 64, 66, 65, 151);
      rect(t, 20, 21, 44, 31, 34, 36, 35, 152);
      ellipse(t, 26, 26, 5, 3, 16, 17, 18);
      ellipse(t, 38, 26, 5, 3, 16, 17, 18);
      rect(t, 21, 36, 43, 48, 38, 40, 39, 153);
      break;
    case Feature.SINK:
      rect(t, 14, 27, 50, 36, 170, 181, 182, 161);
      ellipse(t, 32, 35, 16, 8, 122, 142, 145, 162);
      rect(t, 30, 17, 34, 28, 95, 100, 102);
      rect(t, 34, 17, 44, 20, 95, 100, 102);
      break;
    case Feature.TOILET:
      rect(t, 23, 17, 41, 29, 182, 188, 184, 171);
      ellipse(t, 32, 39, 14, 11, 172, 181, 179, 172);
      rect(t, 25, 48, 39, 54, 130, 137, 136, 173);
      break;
    case Feature.SHELF:
      rect(t, 14, 12, 50, 54, 88, 64, 42, 181);
      for (let y = 20; y <= 44; y += 12) rect(t, 16, y, 48, y + 2, 130, 94, 56, 182);
      rect(t, 18, 15, 24, 19, 60, 80, 86, 183);
      rect(t, 28, 27, 42, 31, 82, 68, 50, 184);
      rect(t, 20, 39, 32, 43, 86, 74, 46, 185);
      break;
    case Feature.MACHINE:
      rect(t, 12, 18, 52, 53, 58, 68, 70, 191);
      outlineBox(t, 16, 23, 48, 39, 24, 30, 32);
      ellipse(t, 26, 31, 5, 5, 78, 126, 118, 192);
      rect(t, 36, 25, 45, 29, 150, 48, 40, 193);
      rect(t, 17, 43, 47, 47, 34, 40, 42, 194);
      break;
    case Feature.APPARATUS:
      rect(t, 18, 16, 46, 53, 48, 56, 58, 201);
      rect(t, 22, 20, 42, 31, 66, 104, 92, 202);
      rect(t, 13, 35, 51, 39, 86, 76, 46, 203);
      rect(t, 26, 39, 30, 55, 50, 52, 52, 204);
      rect(t, 37, 39, 41, 55, 50, 52, 52, 205);
      break;
    case Feature.LIFT_BUTTON:
      rect(t, 24, 18, 40, 48, 52, 56, 58, 211);
      ellipse(t, 32, 28, 5, 5, 90, 230, 190, 212);
      ellipse(t, 32, 39, 4, 4, 190, 80, 70, 213);
      break;
    case Feature.SLIDE:
      rect(t, 14, 12, 50, 50, 170, 170, 152, 221);
      rect(t, 18, 16, 46, 46, 30, 42, 54, 222);
      rect(t, 21, 21, 43, 25, 150, 206, 220, 223);
      rect(t, 21, 31, 39, 35, 190, 190, 120, 224);
      break;
    case Feature.SCREEN:
      rect(t, 12, 14, 52, 44, 24, 30, 34, 231);
      rect(t, 16, 18, 48, 39, 32, 132, 142, 232);
      for (let y = 21; y <= 36; y += 5) rect(t, 19, y, 45, y + 1, 90, 220, 204, 233);
      rect(t, 29, 44, 35, 53, 58, 60, 62);
      break;
  }
  return t;
}

function gen_containerSprite(kind: ContainerKind): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  switch (kind) {
    case ContainerKind.WOODEN_CHEST:
      rect(t, 10, 29, 54, 53, 104, 62, 34, 301);
      rect(t, 12, 22, 52, 31, 124, 78, 40, 302);
      rect(t, 30, 31, 34, 45, 182, 138, 58, 303);
      outlineBox(t, 10, 24, 54, 53, 52, 32, 20);
      break;
    case ContainerKind.METAL_CABINET:
    case ContainerKind.TOOL_LOCKER:
      rect(t, 16, 10, 48, 55, kind === ContainerKind.TOOL_LOCKER ? 64 : 72, kind === ContainerKind.TOOL_LOCKER ? 82 : 80, kind === ContainerKind.TOOL_LOCKER ? 76 : 86, 311);
      rect(t, 31, 12, 33, 54, 36, 40, 42);
      rect(t, 22, 28, 26, 32, 170, 178, 164, 312);
      rect(t, 38, 28, 42, 32, 170, 178, 164, 313);
      break;
    case ContainerKind.MEDICAL_CABINET:
      rect(t, 17, 12, 47, 54, 176, 186, 178, 321);
      rect(t, 29, 23, 35, 42, 172, 42, 48);
      rect(t, 23, 29, 41, 36, 172, 42, 48);
      break;
    case ContainerKind.WEAPON_CRATE:
      rect(t, 9, 30, 55, 53, 54, 72, 46, 331);
      rect(t, 12, 25, 52, 31, 66, 86, 52, 332);
      rect(t, 18, 35, 46, 39, 26, 30, 24, 333);
      rect(t, 21, 41, 43, 44, 26, 30, 24, 334);
      break;
    case ContainerKind.FRIDGE:
      rect(t, 18, 8, 46, 56, 166, 184, 186, 341);
      rect(t, 20, 31, 44, 33, 118, 134, 136);
      rect(t, 40, 16, 43, 28, 70, 88, 92);
      rect(t, 40, 38, 43, 50, 70, 88, 92);
      break;
    case ContainerKind.SAFE:
      rect(t, 15, 18, 49, 53, 48, 50, 54, 351);
      outlineBox(t, 20, 23, 44, 48, 88, 90, 92);
      ellipse(t, 32, 35, 7, 7, 120, 122, 124, 352);
      rect(t, 31, 26, 33, 44, 42, 44, 46);
      break;
    case ContainerKind.FILING_CABINET:
      rect(t, 17, 13, 47, 55, 82, 92, 96, 361);
      for (let y = 18; y <= 42; y += 12) {
        rect(t, 20, y, 44, y + 8, 96, 106, 108, 362 + y);
        rect(t, 28, y + 3, 36, y + 4, 170, 174, 160);
      }
      break;
    case ContainerKind.CASHBOX:
      rect(t, 17, 31, 47, 52, 72, 76, 72, 371);
      rect(t, 20, 25, 44, 32, 94, 98, 92, 372);
      rect(t, 29, 35, 35, 40, 214, 168, 52, 373);
      break;
    case ContainerKind.SECRET_STASH:
      rect(t, 18, 37, 46, 50, 48, 35, 28, 381, 210);
      ellipse(t, 32, 34, 15, 5, 38, 30, 28, 382, 190);
      rect(t, 24, 31, 40, 36, 88, 68, 44, 383, 220);
      break;
    case ContainerKind.EMERGENCY_BOX:
      rect(t, 15, 19, 49, 52, 154, 42, 38, 391);
      rect(t, 29, 27, 35, 44, 230, 220, 188);
      rect(t, 22, 33, 42, 38, 230, 220, 188);
      break;
    case ContainerKind.TRASH_BIN:
      rect(t, 19, 25, 45, 54, 58, 70, 62, 401);
      rect(t, 16, 21, 48, 26, 68, 78, 70, 402);
      for (let x = 24; x <= 40; x += 8) rect(t, x, 28, x + 2, 51, 35, 44, 38);
      break;
  }
  return t;
}

/* ── Item drop: small glowing bag ─────────────────────────────── */
function gen_itemDrop(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2 + 8;
  for (let y = cy - 8; y < cy + 8; y++) for (let x = cx - 6; x < cx + 6; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx / 36 + dy * dy / 64 < 1) {
      const n = noise(x, y, 333) * 20;
      const glow = Math.sin((x + y) * 0.5) * 15;
      t[y * S + x] = rgba(clamp(200 + n + glow), clamp(180 + n), clamp(100 + n));
    }
  }
  return t;
}

/* ── Metro train car: dark steel face with lit windows ────────── */
function gen_trainCarSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const left = 6;
  const right = S - 7;
  const top = 7;
  const bottom = S - 4;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const n = noise(x, y, 1979) * 11;
    const rounded = (x < left + 3 && y < top + 4) || (x > right - 3 && y < top + 4);
    if (rounded && (x - (x < S / 2 ? left + 3 : right - 3)) ** 2 + (y - (top + 4)) ** 2 > 18) continue;
    const edge = x <= left + 1 || x >= right - 1 || y <= top + 1 || y >= bottom - 1;
    const seam = y === top + 10 || y === bottom - 10 || x === S / 2;
    if (edge || seam) {
      t[y * S + x] = rgba(clamp(30 + n), clamp(34 + n), clamp(40 + n));
    } else {
      t[y * S + x] = rgba(clamp(52 + n), clamp(56 + n), clamp(64 + n));
    }
  }

  for (let y = 15; y <= 25; y++) for (let x = 11; x <= S - 12; x++) {
    const panel = Math.floor((x - 11) / 11);
    if ((x - 11) % 11 > 7) continue;
    const n = noise(x, y, 331) * 7;
    const warm = panel % 2 === 0;
    t[y * S + x] = rgba(clamp((warm ? 142 : 86) + n), clamp(155 + n), clamp((warm ? 118 : 165) + n), 230);
  }

  for (let y = 34; y <= 52; y++) {
    for (const cx of [22, 42]) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        const d = Math.abs(x - cx) + Math.abs(y - 43);
        if (d > 10) continue;
        const glow = Math.max(0, 10 - d) * 12;
        t[y * S + x] = rgba(clamp(70 + glow), clamp(84 + glow), clamp(96 + glow));
      }
    }
  }

  for (let x = 10; x <= S - 11; x += 7) {
    const y = bottom - 4;
    t[y * S + x] = rgba(12, 10, 9);
    t[(y + 1) * S + x] = rgba(8, 7, 7);
  }
  return t;
}

/* ── Bullet: bright yellow-orange glowing orb ─────────────────── */
function gen_bulletSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - cx) * 1.65, dy = (y - cy) * 0.74;
    const d = Math.sqrt(dx * dx + dy * dy);
    const tracer = Math.abs(y - cy) < 1.5 && x < cx && x > cx - 19;
    if (d < R * 2.6 || tracer) {
      const f = tracer ? 1 - (cx - x) / 19 : 1 - d / (R * 2.6);
      const core = d < R ? 1 : 0;
      const r = clamp(Math.floor(255 * core + 245 * f * 0.82));
      const g = clamp(Math.floor(238 * core + 190 * f * 0.64));
      const b = clamp(Math.floor(118 * core + 55 * f * 0.32));
      const a = clamp(Math.floor((tracer ? 150 : 255) * f * f + 210 * core));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  rect(t, cx - 2, cy - 1, cx + 5, cy + 1, 255, 250, 210, 0, 240);
  return t;
}

/* ── Pellet: small bright orange spark ────────────────────────── */
function gen_pelletSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2) {
      const f = 1 - d / (R * 2);
      const core = d < R ? 1 : 0;
      const r = clamp(Math.floor(255 * core + 220 * f * 0.8));
      const g = clamp(Math.floor(120 * core + 80 * f * 0.5));
      const b = clamp(Math.floor(30 * core + 20 * f * 0.3));
      const a = clamp(Math.floor(255 * f * f + 200 * core));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── Nail: thin bright metallic streak ────────────────────────── */
function gen_nailSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
    // Thin vertical nail shape with glow
    if (dx < 2 && dy < 8) {
      const f = 1 - dy / 8;
      t[y * S + x] = rgba(clamp(200 + 55 * f), clamp(200 + 55 * f), clamp(220 + 35 * f));
    } else if (dx < 5 && dy < 10) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = Math.max(0, 1 - d / 10);
      const a = clamp(Math.floor(120 * f));
      if (a > 10) t[y * S + x] = rgba(180, 160, 100, a);
    }
  }
  return t;
}

/* ── Paragraph bolt: stamped paper clause with red hostile aura ─ */
function gen_paragraphBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;

  for (let y = 6; y < 58; y++) for (let x = 11; x < 53; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const shear = Math.sin(y * 0.22) * 2.4 + dy * 0.16;
    const px = dx - shear;
    const paper = Math.abs(px) < 7.5 && Math.abs(dy) < 23;
    const fold = Math.abs(px - 5.5) < 1.1 && Math.abs(dy) < 19;
    const edge = Math.abs(px) > 6.2 || Math.abs(dy) > 21;
    const aura = Math.abs(px) < 14 && Math.abs(dy) < 29 && noise(x * 2, y * 2, 6401) > 0.38;
    if (paper) {
      const n = noise(x, y, 6402) * 18 - 9;
      t[y * S + x] = edge || fold
        ? rgba(clamp(178 + n), clamp(158 + n), clamp(115 + n), 245)
        : rgba(clamp(230 + n), clamp(220 + n), clamp(175 + n), 250);
    } else if (aura) {
      const dist = Math.max(Math.abs(px) / 14, Math.abs(dy) / 29);
      const a = clamp(Math.floor((1 - dist) * 120));
      if (a > 12) t[y * S + x] = rgba(235, 36, 118, a);
    }
  }

  for (let y = 16; y <= 45; y += 6) {
    const len = 8 + Math.floor(noise(y, 1, 6403) * 8);
    const off = Math.floor(Math.sin(y * 0.22) * 2.4);
    for (let x = cx - 7; x < cx - 7 + len; x++) {
      const px = x + off;
      if (px >= 0 && px < S) t[y * S + px] = rgba(24, 20, 17, 235);
    }
  }

  for (let y = 33; y <= 45; y++) for (let x = 34; x <= 45; x++) {
    const dx = (x - 39.5) / 5.5;
    const dy = (y - 39) / 5.5;
    if (dx * dx + dy * dy < 1) {
      const rim = dx * dx + dy * dy > 0.55;
      t[y * S + x] = rim ? rgba(245, 48, 72, 240) : rgba(138, 12, 28, 220);
    }
  }

  return t;
}

/* -- Web bolt: pale slow net lash with sticky knots ------------- */
function gen_webBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const cy = S / 2;

  for (let i = 0; i < 4; i++) {
    const y0 = cy - 12 + i * 8;
    for (let x = 10; x <= 54; x++) {
      const wave = Math.sin(x * 0.28 + i * 1.7) * 4.4;
      const y = Math.round(y0 + wave);
      const f = 1 - Math.abs(x - cx) / 32;
      const a = clamp(Math.floor(64 + f * 155));
      rect(t, x - 1, y - 1, x + 1, y + 1, 214, 224, 206, 7100 + i, a);
      if (x % 11 === 0) ellipse(t, x, y, 3, 3, 184, 206, 190, 7110 + i + x, clamp(a + 30));
    }
  }

  for (let i = 0; i < 5; i++) {
    const x = 14 + i * 9;
    for (let y = 14; y <= 50; y++) {
      const bend = Math.sin(y * 0.22 + i) * 2;
      const px = Math.round(x + bend);
      const a = clamp(Math.floor(82 + (1 - Math.abs(y - cy) / 28) * 105));
      if (a > 12) rect(t, px, y, px, y, 198, 214, 196, 7160 + i, a);
    }
  }

  ellipse(t, cx, cy, 5, 5, 235, 244, 224, 7190, 245);
  ellipse(t, cx, cy, 2, 2, 108, 154, 122, 7191, 255);
  return t;
}

/* -- Wet-line bolt: cyan pipe flash and pressure ring ----------- */
function gen_wetLineBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const cy = S / 2;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const ring = Math.abs(d - 13) < 2.2 || Math.abs(d - 21) < 1.4;
    const pipe = Math.abs(dy) < 2.2 && x >= 8 && x <= 56;
    const spiral = Math.abs(Math.sin(ang * 4 + d * 0.45)) < 0.12 && d < 23;
    if (!ring && !pipe && !spiral && d > 8) continue;
    const f = Math.max(0, 1 - Math.min(1, d / 26));
    const core = d < 6 ? 1 : 0;
    const n = noise(x * 3, y * 3, 7211) * 0.36;
    const a = clamp(Math.floor((ring ? 180 : pipe ? 150 : 120) * f + core * 220));
    if (a <= 8) continue;
    t[y * S + x] = rgba(
      clamp(Math.floor(54 * core + 42 * f + n * 20)),
      clamp(Math.floor(222 * core + 208 * f + n * 42)),
      clamp(Math.floor(255 * core + 236 * f + n * 30)),
      a,
    );
  }

  rect(t, cx - 9, cy - 1, cx + 10, cy + 1, 210, 250, 255, 7222, 235);
  ellipse(t, cx, cy, 4, 4, 230, 255, 255, 7223, 255);
  return t;
}

/* ── PSI bolt: purple-violet glowing energy orb ──────────────── */
function gen_psiBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const ring = Math.abs(d - R * 1.55) < 1.8;
    const spoke = Math.abs(Math.sin(ang * 3 + d * 0.2)) < 0.13 && d < R * 2.7;
    if (d < R * 3 || ring || spoke) {
      const f = ring ? 0.78 : spoke ? 0.55 : 1 - d / (R * 3);
      const core = d < R ? 1 : 0;
      const n = noise(x, y, 77) * 0.3;
      const r = clamp(Math.floor(235 * core + 168 * f * 0.72 + n * 45));
      const g = clamp(Math.floor(142 * core + 78 * f * 0.48 + (spoke ? 42 : 0)));
      const b = clamp(Math.floor(255 * core + 248 * f * 0.92 + n * 28));
      const a = clamp(Math.floor(255 * f * f + 240 * core + (ring ? 80 : 0)));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── Plasma bolt: bright cyan-green crackling energy ─────────── */
function gen_plasmaBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2.5) {
      const f = 1 - d / (R * 2.5);
      const core = d < R ? 1 : 0;
      const n = noise(x * 3, y * 3, 42) * 0.4;
      const r = clamp(Math.floor(30 * core + 60 * f * 0.3 + n * 30));
      const g = clamp(Math.floor(255 * core + 200 * f * 0.7 + n * 40));
      const b = clamp(Math.floor(220 * core + 180 * f * 0.6 + n * 20));
      const a = clamp(Math.floor(255 * f * f + 230 * core));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── Hostile bullet: red-white tracer orb ────────────────────── */
function gen_hostileBulletSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - cx) * 1.35, dy = (y - cy) * 0.75;
    const d = Math.sqrt(dx * dx + dy * dy);
    const warningCross = (Math.abs(x - cx) < 1.2 || Math.abs(y - cy) < 1.2) && d < R * 2.7;
    if (d < R * 2.4 || warningCross) {
      const f = warningCross ? 0.7 : 1 - d / (R * 2.4);
      const core = d < R ? 1 : 0;
      const a = clamp(Math.floor((warningCross ? 180 : 255) * f * f + 210 * core));
      t[y * S + x] = rgba(
        clamp(Math.floor(255 * core + 250 * f * 0.85)),
        clamp(Math.floor(84 * core + 48 * f * 0.42)),
        clamp(Math.floor(55 * core + 35 * f * 0.3)),
        a,
      );
    }
  }
  return t;
}

/* ── Hostile pellet: small red-orange shrapnel spark ─────────── */
function gen_hostilePelletSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const cross = Math.abs(dx) < 1.3 || Math.abs(dy) < 1.3;
    if (d < R * 2 || (cross && d < R * 2.8)) {
      const f = 1 - Math.min(1, d / (R * 2.8));
      const core = d < R ? 1 : 0;
      const a = clamp(Math.floor((cross ? 210 : 150) * f * f + 200 * core));
      t[y * S + x] = rgba(
        clamp(Math.floor(255 * core + 230 * f * 0.8)),
        clamp(Math.floor(70 * core + 55 * f * 0.45)),
        clamp(Math.floor(25 * core + 20 * f * 0.25)),
        a,
      );
    }
  }
  return t;
}

/* ── Hostile nail: rusty hot metal sliver ────────────────────── */
function gen_hostileNailSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
    if (dx < 2 && dy < 10) {
      const f = 1 - dy / 10;
      t[y * S + x] = rgba(
        clamp(220 + 35 * f),
        clamp(90 + 60 * f),
        clamp(45 + 30 * f),
      );
    } else if (dx < 5 && dy < 12) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = Math.max(0, 1 - d / 12);
      const a = clamp(Math.floor(105 * f));
      if (a > 8) t[y * S + x] = rgba(160, 55, 35, a);
    }
  }
  return t;
}

/* ── Hostile PSI bolt: crimson-violet unstable knot ──────────── */
function gen_hostilePsiBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const fracture = Math.abs(Math.sin(ang * 5 - d * 0.33)) < 0.16 && d < R * 3.2;
    if (d < R * 3 || fracture) {
      const f = fracture ? 0.7 : 1 - d / (R * 3);
      const core = d < R ? 1 : 0;
      const n = noise(x * 3, y * 3, 911) * 0.45;
      const ring = Math.sin(d * 1.6 + n * 6) > 0.15 ? 1 : 0.65;
      const a = clamp(Math.floor(255 * f * f * ring + 230 * core + (fracture ? 65 : 0)));
      t[y * S + x] = rgba(
        clamp(Math.floor(255 * core + 220 * f * 0.75 + n * 40)),
        clamp(Math.floor(45 * core + 35 * f * 0.3)),
        clamp(Math.floor(150 * core + 170 * f * 0.75 + n * 45)),
        a,
      );
    }
  }
  return t;
}

/* ── Hostile plasma bolt: orange-cyan industrial arc ─────────── */
function gen_hostilePlasmaBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 9;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2.5) {
      const f = 1 - d / (R * 2.5);
      const core = d < R ? 1 : 0;
      const n = noise(x * 4, y * 4, 4242) * 0.4;
      const arc = Math.sin(Math.atan2(dy, dx) * 5 + d * 1.2 + n * 4) > 0.25 ? 1 : 0.7;
      const a = clamp(Math.floor(255 * f * f * arc + 230 * core));
      t[y * S + x] = rgba(
        clamp(Math.floor(255 * core + 230 * f * 0.8 + n * 30)),
        clamp(Math.floor(135 * core + 120 * f * 0.55 + n * 35)),
        clamp(Math.floor(45 * core + 95 * f * 0.45 + n * 40)),
        a,
      );
    }
  }
  return t;
}

/* ── Hostile flame bolt: dark red fireball with hot core ─────── */
function gen_hostileFlameBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 9;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2.6) {
      const f = 1 - d / (R * 2.6);
      const core = d < R ? 1 : 0;
      const n = noise(x * 5, y * 5, 1555) * 0.5;
      const heat = core + f * 0.75 + n * 0.45;
      const a = clamp(Math.floor(255 * f * f + 235 * core));
      t[y * S + x] = rgba(
        clamp(Math.floor(255 * Math.min(1, heat * 1.5))),
        clamp(Math.floor(120 * Math.min(1, heat * 0.9))),
        clamp(Math.floor(35 * Math.min(1, heat * 0.6))),
        a,
      );
    }
  }
  return t;
}

/* ── Gauss bolt: electric blue-white thin streak with lightning ── */
function gen_gaussBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 3) {
      const f = 1 - d / (R * 3);
      const core = d < R ? 1 : 0;
      const n = noise(x * 2 + 7, y * 2, 99) * 0.3;
      const ang = Math.atan2(dy, dx);
      const tendril = Math.sin(ang * 6 + d * 1.5) * 0.3;
      const ff = clamp(Math.floor((f + tendril) * 255));
      const r = clamp(Math.floor(200 * core + ff * 0.7 + n * 50));
      const g = clamp(Math.floor(220 * core + ff * 0.8 + n * 30));
      const b = clamp(Math.floor(255 * core + ff * 1.0));
      const a = clamp(Math.floor(255 * f * f * f + 240 * core));
      if (a > 5) t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── BFG bolt: massive green glowing orb with pulsing rings ───── */
function gen_bfgBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 14;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2.2) {
      const f = 1 - d / (R * 2.2);
      const core = d < R ? 1 : 0;
      const n = noise(x * 2, y * 2, 666) * 0.3;
      const ring = Math.sin(d * 1.2) * 0.25 + 0.75;
      const r = clamp(Math.floor(60 * core * ring + 50 * f * 0.4));
      const g = clamp(Math.floor(255 * core * ring + 240 * f * 0.9 + n * 50));
      const b = clamp(Math.floor(100 * core * ring + 80 * f * 0.5 + n * 20));
      const a = clamp(Math.floor(255 * f * f + 250 * core));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── Flame bolt: orange-yellow-red flickering fire ────────────── */
function gen_flameBoltSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R * 2.5) {
      const f = 1 - d / (R * 2.5);
      const core = d < R ? 1 : 0;
      const n = noise(x * 5, y * 5, 55) * 0.5;
      const heat = core + f * 0.7 + n * 0.4;
      const r = clamp(Math.floor(255 * Math.min(1, heat * 1.4)));
      const g = clamp(Math.floor(255 * Math.min(1, heat * 0.85)));
      const b = clamp(Math.floor(100 * Math.min(1, heat * 0.4)));
      const a = clamp(Math.floor(255 * f * f + 240 * core));
      t[y * S + x] = rgba(r, g, b, a);
    }
  }
  return t;
}

/* ── Grenade: small dark-green sphere with cross-hatch ────────── */
function gen_grenadeSprite(): SpriteData {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const R = 7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R) {
      const n = noise(x, y, 123) * 10;
      const shade = 1 - d / R * 0.4;
      const hatch = ((x + y) % 4 < 1 || (x - y + 64) % 4 < 1) ? 0.85 : 1;
      const r = clamp(Math.floor((50 + n) * shade * hatch));
      const g = clamp(Math.floor((70 + n) * shade * hatch));
      const b = clamp(Math.floor((35 + n) * shade * hatch));
      t[y * S + x] = rgba(r, g, b);
    }
  }
  for (let y = cy - R - 3; y < cy - R + 1; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    if (y >= 0 && y < S && x >= 0 && x < S) {
      t[y * S + x] = rgba(90, 85, 75);
    }
  }
  return t;
}

/* ── Procedural texture generator (64×64, retro horror style) ── */

import { Tex } from '../core/types';
import { generateSlideTextures } from '../gen/living/slides';
import { generatePosterTextures } from '../gen/living/posters';
import { generateHintTextures } from './hint_textures';
import { generateProceduralScreenTextures } from './procedural_screen_textures';
import { S, rgba, noise, clamp } from './pixutil';

export type TexData = Uint32Array; // S*S RGBA pixels (0xAABBGGRR little-endian)

/* ── Generate all game textures ───────────────────────────────── */
export function generateTextures(): TexData[] {
  const textures: TexData[] = [];
  for (let i = 0; i < Tex.COUNT; i++) textures.push(new Uint32Array(S * S));

  gen_concrete(textures[Tex.CONCRETE], 140, 140, 140, 42);
  gen_brick(textures[Tex.BRICK]);
  gen_panel(textures[Tex.PANEL]);
  gen_tile(textures[Tex.TILE_W]);
  gen_metal(textures[Tex.METAL]);
  gen_rotten(textures[Tex.ROTTEN]);
  gen_curtain(textures[Tex.CURTAIN]);
  gen_dark(textures[Tex.DARK]);
  gen_concrete(textures[Tex.F_CONCRETE], 120, 120, 118, 37);
  gen_lino(textures[Tex.F_LINO]);
  gen_floorTile(textures[Tex.F_TILE]);
  gen_wood(textures[Tex.F_WOOD]);
  gen_carpet(textures[Tex.F_CARPET]);
  gen_concrete(textures[Tex.CEIL], 80, 78, 76, 99);
  gen_doorWood(textures[Tex.DOOR_WOOD]);
  gen_doorMetal(textures[Tex.DOOR_METAL]);
  gen_abyss(textures[Tex.F_ABYSS]);
  gen_liftDoor(textures[Tex.LIFT_DOOR]);
  gen_pipe(textures[Tex.PIPE]);
  gen_water(textures[Tex.F_WATER]);
  gen_meat(textures[Tex.MEAT]);
  gen_meatFloor(textures[Tex.F_MEAT]);
  gen_desk(textures[Tex.DESK]);
  gen_target(textures[Tex.TARGET]);
  gen_hermoWall(textures[Tex.HERMO_WALL]);
  gen_gutWall(textures[Tex.GUT]);
  gen_gutFloor(textures[Tex.F_GUT]);
  gen_voidWall(textures[Tex.VOID_WALL]);
  gen_voidFloor(textures[Tex.F_VOID]);
  gen_portal(textures[Tex.PORTAL]);
  gen_cross(textures[Tex.CROSS]);
  gen_icon(textures[Tex.ICON]);
  gen_marble(textures[Tex.MARBLE]);
  gen_redCarpet(textures[Tex.F_RED_CARPET]);
  gen_greenCarpet(textures[Tex.F_GREEN_CARPET]);
  gen_marbleTile(textures[Tex.F_MARBLE_TILE]);
  gen_proceduralPortraits(textures);
  gen_parquet(textures[Tex.F_PARQUET]);
  gen_carpetEdgeVariants(textures);
  generateSlideTextures(textures);
  generateHintTextures(textures);
  generatePosterTextures(textures);
  generateProceduralScreenTextures(textures);
  gen_larvaBody(textures[Tex.LARVA_BODY]);
  gen_doorHermetic(textures[Tex.DOOR_HERMETIC]);

  return textures;
}

/* ── Individual texture generators ────────────────────────────── */

function gen_concrete(t: TexData, br: number, bg: number, bb: number, seed: number) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, seed) * 30 - 15;
    const crack = (noise(x * 3, y * 3, seed + 7) > 0.92) ? -40 : 0;
    // Moisture spots (low frequency noise)
    const moisture = (noise(Math.floor(x / 4), Math.floor(y / 4), seed + 8) > 0.7) ? -15 : 0;
    // Vertical streaks (drips/stains)
    const streak = Math.sin(y * 0.1) * noise(Math.floor(x / 2), 0, seed + 9) * 10 - 5;

    t[y * S + x] = rgba(
      clamp(br + n + crack + moisture + streak),
      clamp(bg + n + crack + moisture + streak),
      clamp(bb + n + crack + moisture + streak)
    );
  }
}

function gen_brick(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / 8);
    const offset = (row & 1) ? 16 : 0;
    const bx = (x + offset) % 32;
    const by = y % 8;
    const mortar = bx < 1 || by < 1;
    const n = noise(x, y, 11) * 20 - 10;
    if (mortar) {
      // Weathering on mortar
      const weathering = noise(x, y, 12) > 0.8 ? -15 : 0;
      t[y * S + x] = rgba(clamp(100 + n + weathering), clamp(95 + n + weathering), clamp(85 + n + weathering));
    } else {
      const shade = noise(Math.floor((x + offset) / 32), row, 33) * 30;
      // Dark spots and minor cracks on bricks
      const spot = noise(x * 2, y * 2, 34) > 0.85 ? -20 : 0;
      const streak = Math.sin(y * 0.2 + noise(x, 0, 35) * 5) * 5;
      t[y * S + x] = rgba(
        clamp(140 + shade + n + spot + streak),
        clamp(60 + shade / 2 + n + spot + streak),
        clamp(50 + shade / 3 + n + spot + streak)
      );
    }
  }
}

function gen_panel(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const seam = (x % 32 < 1 || y % 32 < 1) ? -30 : 0;
    const n = noise(x, y, 22) * 16 - 8;

    // Grime accumulation near seams
    const nearSeam = (x % 32 < 4 || x % 32 > 28 || y % 32 < 4 || y % 32 > 28);
    const grime = nearSeam ? noise(x, y, 23) * -15 : 0;

    // Subtle surface dents
    const dent = noise(x, y, 24) > 0.9 ? -20 : 0;

    t[y * S + x] = rgba(
      clamp(170 + n + seam + grime + dent),
      clamp(165 + n + seam + grime + dent),
      clamp(150 + n + seam + grime + dent)
    );
  }
}

function gen_tile(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const grout = (x % 16 < 1 || y % 16 < 1) ? -50 : 0;
    const n = noise(x, y, 33) * 10 - 5;
    t[y * S + x] = rgba(clamp(200 + n + grout), clamp(205 + n + grout), clamp(210 + n + grout));
  }
}

function gen_metal(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 44) * 25 - 12;
    const rivet = (x % 16 === 8 && y % 16 === 8) ? 40 : 0;
    // Enhanced vertical streaks (drips/liquid)
    const streak = Math.sin(y * 0.2 + noise(x, 0, 45) * 5) * 15;

    // Localized rust spots
    const rust = noise(x, y, 46) > 0.8 ? 20 : 0;

    t[y * S + x] = rgba(
      clamp(90 + n + rivet + streak + rust),
      clamp(95 + n + rivet + streak + (rust * 0.5)),
      clamp(105 + n + rivet + streak - rust)
    );
  }
}

function gen_rotten(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise(x, y, 55) * 40 - 20;
    const n2 = noise(x * 2, y * 2, 56) * 30;
    const veins = Math.sin(x * 0.3 + noise(x, y, 57) * 5) * 15;
    const r = clamp(60 + n1 + veins);
    const g = clamp(80 + n1 + n2 + veins);
    const b = clamp(40 + n1);
    t[y * S + x] = rgba(r, g, b);
  }
}

function gen_curtain(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fold = Math.sin(x * 0.4) * 25;
    const n = noise(x, y, 66) * 10;
    t[y * S + x] = rgba(clamp(120 + fold + n), clamp(20 + fold / 3 + n), clamp(25 + fold / 3 + n));
  }
}

function gen_dark(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 77) * 15;
    t[y * S + x] = rgba(clamp(30 + n), clamp(28 + n), clamp(32 + n));
  }
}

function gen_lino(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const pattern = ((x + y) % 16 < 8) ? 10 : 0;
    const n = noise(x, y, 88) * 15 - 7;
    t[y * S + x] = rgba(clamp(90 + pattern + n), clamp(100 + pattern + n), clamp(80 + pattern + n));
  }
}

function gen_floorTile(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) & 1) ? 40 : 0;
    const grout = (x % 16 < 1 || y % 16 < 1) ? -30 : 0;
    const n = noise(x, y, 99) * 8;
    t[y * S + x] = rgba(clamp(150 + checker + grout + n), clamp(155 + checker + grout + n), clamp(160 + checker + grout + n));
  }
}

function gen_wood(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const plank = Math.floor(x / 8);
    const grain = Math.sin(y * 0.8 + plank * 3.7 + noise(x, y, 101) * 3) * 15;
    const edge = (x % 8 < 1) ? -25 : 0;
    const n = noise(x, y, 100) * 12;
    t[y * S + x] = rgba(clamp(130 + grain + edge + n), clamp(95 + grain + edge + n), clamp(55 + grain / 2 + edge + n));
  }
}

function gen_carpet(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 111) * 20 - 10;
    const pattern = Math.sin(x * 0.3) * Math.sin(y * 0.3) * 15;
    t[y * S + x] = rgba(clamp(100 + pattern + n), clamp(30 + pattern / 2 + n), clamp(25 + pattern / 2 + n));
  }
}

function gen_doorWood(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const panel = (x > 8 && x < 28 && y > 8 && y < 56) ? 15 : 0;
    const panel2 = (x > 36 && x < 56 && y > 8 && y < 56) ? 15 : 0;
    const grain = Math.sin(y * 0.5 + x * 0.1) * 8;
    const n = noise(x, y, 120) * 10;
    // Handle
    const handle = (x > 29 && x < 35 && y > 28 && y < 36) ? 50 : 0;
    t[y * S + x] = rgba(
      clamp(110 + grain + panel + panel2 + handle + n),
      clamp(75 + grain + panel + panel2 + handle / 2 + n),
      clamp(40 + grain / 2 + n),
    );
  }
}

/* ── Hermetic shelter wall: reinforced steel-plated concrete ──── */
function gen_hermoWall(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 180) * 12;
    // Steel plate panels with horizontal seams every 16px
    const seam = (y % 16 < 1 || x % 32 < 1) ? -25 : 0;
    // Corner bolts on each 32×16 plate
    const bx = x % 32, by = y % 16;
    const bolt = ((bx < 3 || bx > 28) && (by < 3 || by > 12)) ? 30 : 0;
    // Slight vertical streaks (weathering)
    const streak = Math.sin(x * 0.4 + noise(x, 0, 181) * 3) * 6;
    const r = clamp(70 + n + seam + bolt + streak);
    const g = clamp(78 + n + seam + bolt + streak);
    const b = clamp(88 + n + seam + bolt + streak);
    t[y * S + x] = rgba(r, g, b);
  }
}

function gen_doorMetal(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const border = (x < 3 || x > 60 || y < 3 || y > 60) ? -20 : 0;
    const n = noise(x, y, 130) * 15;
    const lock = (x > 48 && x < 56 && y > 28 && y < 36) ? 40 : 0;
    t[y * S + x] = rgba(clamp(80 + border + n + lock), clamp(85 + border + n + lock), clamp(90 + border + n + lock));
  }
}

function gen_doorHermetic(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 135) * 15;
    // Heavy steel frame
    const frame = (x < 6 || x > S - 7 || y < 6 || y > S - 7);
    // Inner bevel
    const bevel = !frame && (x < 10 || x > S - 11 || y < 10 || y > S - 11);
    // Warning stripes on the frame
    const stripe = frame && ((x + y) % 12 < 6);
    
    // Central wheel valve
    const cx = S / 2, cy = S / 2;
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const isWheelRing = dist > 10 && dist < 14;
    const isWheelSpoke = dist <= 14 && (Math.abs(dx) < 2 || Math.abs(dy) < 2 || Math.abs(dx - dy) < 2 || Math.abs(dx + dy) < 2);
    const isWheelCenter = dist < 4;
    const valve = isWheelRing || isWheelSpoke || isWheelCenter;
    
    // Rivets on the corners of the inner panel
    const rx = Math.abs(x - cx);
    const ry = Math.abs(y - cy);
    const rivet = !frame && !bevel && ((rx === 16 && ry === 16) || (rx === 16 && ry === 8) || (rx === 8 && ry === 16));
    
    let r: number, g: number, b: number;
    if (stripe) {
      r = 180 + n; g = 150 + n; b = 20 + n; // yellow
    } else if (frame) {
      r = 30 + n; g = 30 + n; b = 35 + n; // dark frame
    } else if (bevel) {
      r = 50 + n; g = 50 + n; b = 55 + n; // transition
    } else if (valve) {
      r = 160 + n; g = 40 + n; b = 40 + n; // red valve wheel
    } else if (rivet) {
      r = 100 + n; g = 100 + n; b = 110 + n;
    } else {
      // Main heavy metal surface
      r = 65 + n; g = 70 + n; b = 75 + n;
      // Horizontal reinforced beams
      if (y > 20 && y < 24) { r -= 10; g -= 10; b -= 10; }
      if (y > S - 25 && y < S - 21) { r -= 10; g -= 10; b -= 10; }
    }
    t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
  }
}

function gen_abyss(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 200) * 8;
    const edge = noise(x * 4, y * 4, 201) > 0.85 ? 12 : 0;
    t[y * S + x] = rgba(clamp(6 + n + edge), clamp(4 + n), clamp(10 + n + edge));
  }
}

/* ── Lift door: industrial metal doors with yellow/black stripe ── */
function gen_liftDoor(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 210) * 12;
    // Two door panels
    const gap = Math.abs(x - S / 2) < 1;
    const border = x < 2 || x > S - 3 || y < 2 || y > S - 3;
    // Yellow-black hazard stripe at top
    const stripe = y < 8 && ((x + y) % 8 < 4);
    const panel = (x > 4 && x < S / 2 - 2) || (x > S / 2 + 2 && x < S - 4);
    let r: number, g: number, b: number;
    if (stripe) {
      r = 200; g = 180; b = 20;
    } else if (gap) {
      r = 15; g = 15; b = 20;
    } else if (border) {
      r = 50; g = 55; b = 60;
    } else if (panel) {
      r = 85 + Math.floor(n); g = 90 + Math.floor(n); b = 95 + Math.floor(n);
      // Vertical ribbing
      if (x % 4 === 0) { r -= 10; g -= 10; b -= 10; }
    } else {
      r = 60 + Math.floor(n); g = 65 + Math.floor(n); b = 70 + Math.floor(n);
    }
    // Buttons (call panel)
    const btnX = x > S / 2 + 8 && x < S / 2 + 14;
    const btnUp = btnX && y > 26 && y < 30;
    const btnDn = btnX && y > 32 && y < 36;
    if (btnUp) { r = 60; g = 200; b = 60; }
    if (btnDn) { r = 200; g = 60; b = 60; }
    t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
  }
}

/* ── Pipe: rusty pipe texture for maintenance tunnels ─────────── */
function gen_pipe(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 220) * 25 - 12;
    // Horizontal pipes at different heights
    const pipe1 = y > 8 && y < 18;
    const pipe2 = y > 32 && y < 42;
    const pipe3 = y > 52 && y < 58;
    const bracket = (x % 16 < 2) && (pipe1 || pipe2);
    let r: number, g: number, b: number;
    if (bracket) {
      r = 70; g = 70; b = 75;
    } else if (pipe1) {
      const shade = Math.sin((y - 13) * 0.6) * 20;
      const rust = noise(x * 2, y, 221) > 0.7 ? 30 : 0;
      r = 110 + Math.floor(shade + n + rust);
      g = 80 + Math.floor(shade + n);
      b = 50 + Math.floor(shade / 2 + n);
    } else if (pipe2) {
      const shade = Math.sin((y - 37) * 0.6) * 15;
      r = 60 + Math.floor(shade + n);
      g = 90 + Math.floor(shade + n);
      b = 60 + Math.floor(shade + n);
    } else if (pipe3) {
      const shade = Math.sin((y - 55) * 0.8) * 10;
      r = 80 + Math.floor(shade + n);
      g = 80 + Math.floor(shade + n);
      b = 90 + Math.floor(shade + n);
    } else {
      // Concrete background
      r = 65 + Math.floor(n);
      g = 63 + Math.floor(n);
      b = 60 + Math.floor(n);
    }
    t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
  }
}

/* ── Water: dark murky canal water ────────────────────────────── */
function gen_water(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wave = Math.sin(x * 0.2 + y * 0.15) * 10 + Math.sin(x * 0.4 - y * 0.3) * 5;
    const n = noise(x, y, 230) * 15;
    const foam = noise(x * 3, y * 3, 231) > 0.9 ? 25 : 0;
    const r = clamp(20 + Math.floor(n + wave));
    const g = clamp(40 + Math.floor(n + wave + foam));
    const b = clamp(55 + Math.floor(n + wave + foam));
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Meat: corrupted organic wall texture for hell ────────────── */
function gen_meat(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise(x, y, 240) * 40 - 20;
    const n2 = noise(x * 2, y * 2, 241) * 25;
    const veins = Math.sin(x * 0.15 + noise(x, y, 242) * 8) * 20;
    const pulse = Math.sin(y * 0.3 + x * 0.1) * 10;
    const r = clamp(120 + Math.floor(n1 + n2 + veins + pulse));
    const g = clamp(35 + Math.floor(n1 / 2 + pulse));
    const b = clamp(30 + Math.floor(n1 / 3));
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Meat floor: fleshy ground for hell ───────────────────────── */
function gen_meatFloor(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 250) * 30 - 15;
    const pool = noise(x * 2, y * 2, 251) > 0.8 ? -20 : 0;
    const tissue = Math.sin(x * 0.2 + y * 0.2) * 8;
    const r = clamp(90 + Math.floor(n + tissue + pool));
    const g = clamp(25 + Math.floor(n / 2 + pool));
    const b = clamp(28 + Math.floor(n / 2 + pool));
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Gut wall: intestinal folds and wet tissue bands ─────────── */
function gen_gutWall(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const foldA = Math.sin(x * 0.24 + noise(y, x, 261) * 5) * 22;
    const foldB = Math.sin(y * 0.17 + noise(x, y, 262) * 7) * 14;
    const tube = Math.sin((x + y) * 0.11 + noise(x >> 1, y >> 1, 263) * 6) * 18;
    const slime = noise(x * 2, y * 2, 264) > 0.83 ? 26 : 0;
    const bruise = noise(x >> 2, y >> 2, 265) > 0.72 ? -18 : 0;
    const n = noise(x, y, 266) * 18 - 9;
    const r = clamp(135 + foldA + foldB + tube + slime + bruise + n);
    const g = clamp(55 + foldA * 0.35 + tube * 0.2 + bruise + n);
    const b = clamp(45 + foldB * 0.22 + n * 0.5);
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Gut floor: slick membranes with pooled mucus ────────────── */
function gen_gutFloor(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const band = Math.sin(x * 0.18 + y * 0.09 + noise(x, y, 270) * 6) * 14;
    const pocket = noise(x >> 1, y >> 1, 271) > 0.76 ? 18 : -10;
    const wet = noise(x * 3, y * 3, 272) > 0.9 ? 20 : 0;
    const n = noise(x, y, 273) * 20 - 10;
    const r = clamp(108 + band + pocket + wet + n);
    const g = clamp(38 + band * 0.3 + pocket * 0.35 + n * 0.5);
    const b = clamp(34 + wet * 0.35 + n * 0.35);
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Wall-snake larva body: pale segmented wet flesh ─────────── */
function gen_larvaBody(t: TexData) {
  const cx = (S - 1) * 0.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (x - cx) / cx;
    const ny = (y - cx) / cx;
    const sideShade = -Math.abs(ny) * 24;
    const segment = Math.abs(((x + 5) % 16) - 8);
    const groove = segment < 1.7 ? -42 : segment < 3.2 ? -18 : 0;
    const fold = Math.sin(x * 0.52 + noise(y, x, 281) * 2.6) * 9;
    const vein = noise(x * 2, y * 2, 282) > 0.87 ? -24 : 0;
    const wet = noise(x, y, 283) * 18 - 7;
    const highlight = Math.max(0, 1 - (nx * nx * 1.8 + (ny + 0.28) * (ny + 0.28) * 5.2)) * 30;
    const r = clamp(214 + sideShade + groove + fold + wet + highlight + vein);
    const g = clamp(212 + sideShade + groove * 0.85 + fold * 0.4 + wet + highlight * 0.72 + vein);
    const b = clamp(194 + sideShade * 0.8 + groove * 0.6 + wet * 0.7 + highlight * 0.55 + vein * 0.45);
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Desk: school desk (wooden top, metal legs visible) ───────── */
function gen_desk(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 260) * 12;
    // Desk body is a green-brown wooden surface (Soviet school desk)
    const topH = 40; // desk surface height in texture
    if (y < 4) {
      // Top edge — darker wood trim
      const grain = Math.sin(x * 0.6) * 4;
      t[y * S + x] = rgba(clamp(60 + Math.floor(n + grain)), clamp(45 + Math.floor(n + grain)), clamp(25 + Math.floor(n)));
    } else if (y < topH) {
      // Desk surface — classic Soviet green
      const shade = Math.sin(x * 0.3 + y * 0.1) * 6;
      const seam = (x === 31 || x === 32) ? -15 : 0;
      t[y * S + x] = rgba(
        clamp(50 + Math.floor(n + shade + seam)),
        clamp(85 + Math.floor(n + shade + seam)),
        clamp(55 + Math.floor(n / 2 + seam)),
      );
    } else if (y < topH + 3) {
      // Edge/apron
      t[y * S + x] = rgba(clamp(70 + Math.floor(n)), clamp(55 + Math.floor(n)), clamp(30 + Math.floor(n)));
    } else {
      // Below desk: metal legs + dark space
      const leg = (x > 4 && x < 8) || (x > 56 && x < 60);
      if (leg) {
        t[y * S + x] = rgba(clamp(70 + Math.floor(n)), clamp(72 + Math.floor(n)), clamp(75 + Math.floor(n)));
      } else {
        t[y * S + x] = rgba(clamp(20 + Math.floor(n / 2)), clamp(18 + Math.floor(n / 2)), clamp(22 + Math.floor(n / 2)));
      }
    }
  }
}

/* ── TARGET: Soviet shooting range paper target (мишень) ──────── */
function gen_target(t: TexData) {
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 350) * 8;
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Cardboard background
    let r = 196 + n, g = 168 + n, b = 130 + n;
    // Concentric rings (black) at radii 28, 20, 12
    if (Math.abs(dist - 28) < 1.2 || Math.abs(dist - 20) < 1.2 || Math.abs(dist - 12) < 1.2) {
      r = 30 + n; g = 30 + n; b = 30 + n;
    }
    // Center bullseye — red fill within radius 5
    if (dist < 5) { r = 180 + n; g = 30 + n / 2; b = 30 + n / 2; }
    // Crosshair lines (thin)
    if ((Math.abs(dx) < 0.8 && dist < 28) || (Math.abs(dy) < 0.8 && dist < 28)) {
      r = Math.min(r, 60 + n); g = Math.min(g, 60 + n); b = Math.min(b, 60 + n);
    }
    t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
  }
}

/* ── VOID_WALL: abstract fractal green-black wall ─────────────── */
function gen_voidWall(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise(x * 3, y * 3, 900) * 0.5;
    const n2 = noise(x * 7, y * 7, 901) * 0.3;
    const n3 = noise(x * 15, y * 15, 902) * 0.2;
    const fractal = n1 + n2 + n3;
    const glow = fractal > 0.55 ? (fractal - 0.55) * 4 : 0;
    const line = (noise(x, y * 5, 903) > 0.92 || noise(x * 5, y, 904) > 0.92) ? 30 : 0;
    const r = clamp(Math.floor(5 + glow * 20 + line * 0.3));
    const g = clamp(Math.floor(15 + glow * 120 + line));
    const b = clamp(Math.floor(8 + glow * 30 + line * 0.4));
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── F_VOID: abstract fractal green-black floor ───────────────── */
function gen_voidFloor(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise(x * 2, y * 2, 910) * 0.4;
    const n2 = noise(x * 6, y * 6, 911) * 0.35;
    const n3 = noise(x * 13, y * 13, 912) * 0.25;
    const fractal = n1 + n2 + n3;
    const pulse = Math.sin(x * 0.15 + y * 0.15) * 0.15 + 0.5;
    const glow = fractal > 0.45 ? (fractal - 0.45) * 3 * pulse : 0;
    const grid = ((x % 16 === 0) || (y % 16 === 0)) ? 15 : 0;
    const r = clamp(Math.floor(3 + glow * 10 + grid * 0.2));
    const g = clamp(Math.floor(10 + glow * 80 + grid));
    const b = clamp(Math.floor(5 + glow * 15 + grid * 0.3));
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── PORTAL: swirling bright portal texture (green-white) ─────── */
function gen_portal(t: TexData) {
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const swirl = Math.sin(angle * 3 + dist * 0.3) * 0.5 + 0.5;
    const ring = Math.abs(Math.sin(dist * 0.4)) * swirl;
    const n = noise(x, y, 920) * 0.2;
    const bright = ring + n;
    if (dist > 28) {
      t[y * S + x] = rgba(10, 30, 15);
    } else {
      const r = clamp(Math.floor(bright * 180 + 40));
      const g = clamp(Math.floor(bright * 255 + 60));
      const b = clamp(Math.floor(bright * 200 + 50));
      t[y * S + x] = rgba(r, g, b);
    }
  }
}

/* ── CROSS: golden Orthodox cross on dark wall ────────────────── */
function gen_cross(t: TexData) {
  // Dark wall background
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 710) * 12;
    t[y * S + x] = rgba(clamp(30 + n), clamp(25 + n), clamp(20 + n));
  }
  const cx = S / 2;
  // Vertical beam (full height cross)
  for (let y = 8; y < 56; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    const n = noise(x, y, 711) * 15;
    t[y * S + x] = rgba(clamp(200 + n), clamp(170 + n), clamp(40 + n));
  }
  // Horizontal beam (upper)
  for (let y = 18; y < 24; y++) for (let x = cx - 12; x <= cx + 12; x++) {
    const n = noise(x, y, 712) * 15;
    t[y * S + x] = rgba(clamp(200 + n), clamp(170 + n), clamp(40 + n));
  }
  // Diagonal bottom bar (Orthodox cross slanted footrest)
  for (let y = 42; y < 46; y++) for (let x = cx - 8; x <= cx + 8; x++) {
    const slant = Math.round((x - cx) * 0.25);
    const sy = y + slant;
    if (sy >= 0 && sy < S) {
      const n = noise(x, sy, 713) * 15;
      t[sy * S + x] = rgba(clamp(200 + n), clamp(170 + n), clamp(40 + n));
    }
  }
  // Small top bar
  for (let y = 12; y < 15; y++) for (let x = cx - 5; x <= cx + 5; x++) {
    const n = noise(x, y, 714) * 15;
    t[y * S + x] = rgba(clamp(210 + n), clamp(180 + n), clamp(50 + n));
  }
}

/* ── ICON: Jesus icon with halo on dark wood background ──────── */
function gen_icon(t: TexData) {
  // Dark wood background
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const grain = Math.sin(y * 0.8 + noise(x, y, 720) * 5) * 8;
    t[y * S + x] = rgba(clamp(50 + grain), clamp(35 + grain), clamp(20 + grain));
  }
  // Gold frame border
  for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
    if (y < 4 || y >= S - 4 || x < 4 || x >= S - 4) {
      const n = noise(x, y, 721) * 10;
      t[y * S + x] = rgba(clamp(190 + n), clamp(160 + n), clamp(40 + n));
    }
  }
  // Dark inner background (old paint)
  for (let y = 5; y < S - 5; y++) for (let x = 5; x < S - 5; x++) {
    const n = noise(x, y, 722) * 10;
    t[y * S + x] = rgba(clamp(60 + n), clamp(40 + n), clamp(25 + n));
  }
  const cx = S / 2, headY = 20;
  // Halo (golden circle behind head)
  for (let y = headY - 10; y < headY + 10; y++) for (let x = cx - 10; x < cx + 10; x++) {
    const dx = x - cx, dy = y - headY;
    const d2 = dx * dx + dy * dy;
    if (d2 < 100 && d2 > 64) {
      const n = noise(x, y, 723) * 15;
      t[y * S + x] = rgba(clamp(220 + n), clamp(190 + n), clamp(50 + n));
    }
  }
  // Face (faded brown)
  for (let y = headY - 5; y < headY + 6; y++) for (let x = cx - 4; x < cx + 4; x++) {
    const dx = x - cx, dy = y - headY;
    if (dx * dx + dy * dy < 25) {
      const n = noise(x, y, 724) * 8;
      t[y * S + x] = rgba(clamp(160 + n), clamp(130 + n), clamp(90 + n));
    }
  }
  // Body/robe (dark red)
  for (let y = headY + 7; y < S - 8; y++) for (let x = cx - 8; x < cx + 8; x++) {
    const n = noise(x, y, 725) * 10;
    t[y * S + x] = rgba(clamp(120 + n), clamp(30 + n), clamp(20 + n));
  }
}

/* ── Ministry (Stalinist Empire) textures ──────────────────────── */

function gen_marble(t: TexData) {
  // White/cream marble walls with grey veining
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const base = 210;
    const n1 = noise(x, y, 800) * 20 - 10;
    const n2 = noise(x * 2.5, y * 0.8, 801) * 15;
    // Marble veins (sinuous dark streaks)
    const vein = Math.sin(x * 0.15 + noise(x * 0.5, y * 0.5, 802) * 6) * 
                 Math.cos(y * 0.12 + noise(x * 0.3, y * 0.3, 803) * 4);
    const vIntensity = vein > 0.7 ? -40 : vein > 0.5 ? -20 : 0;
    // Subtle warm tint (cream)
    const r = clamp(base + n1 + n2 + vIntensity);
    const g = clamp(base - 5 + n1 + n2 * 0.8 + vIntensity);
    const b = clamp(base - 15 + n1 + n2 * 0.6 + vIntensity);
    t[y * S + x] = rgba(r, g, b);
  }
  // Horizontal seam halfway
  for (let x = 0; x < S; x++) {
    const n = noise(x, 32, 804) * 5;
    t[32 * S + x] = rgba(clamp(160 + n), clamp(155 + n), clamp(140 + n));
  }
}

function gen_redCarpet(t: TexData) {
  // Pure red carpet center — no gold trim (edge variants handle borders)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 810) * 12 - 6;
    const weave = ((x + y) % 4 < 2) ? 5 : -5;
    t[y * S + x] = rgba(clamp(130 + n + weave), clamp(20 + n / 3), clamp(25 + n / 3));
  }
}

function gen_greenCarpet(t: TexData) {
  // Official green carpet (baize / sukno)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, 820) * 10 - 5;
    const weave = ((x + y) % 4 < 2) ? 4 : -4;
    t[y * S + x] = rgba(clamp(30 + n + weave), clamp(80 + n + weave), clamp(40 + n + weave));
  }
}

function gen_marbleTile(t: TexData) {
  // Polished marble floor tiles — cream/white with grey veining, checker grout
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const tileX = Math.floor(x / 32), tileY = Math.floor(y / 32);
    const checker = ((tileX + tileY) & 1) ? 15 : 0;
    const grout = (x % 32 < 1 || y % 32 < 1) ? -40 : 0;
    const n1 = noise(x, y, 830) * 14 - 7;
    const vein = Math.sin(x * 0.12 + noise(x * 0.4, y * 0.4, 831) * 5) *
                 Math.cos(y * 0.1 + noise(x * 0.3, y * 0.3, 832) * 3);
    const vIntensity = vein > 0.65 ? -25 : vein > 0.4 ? -12 : 0;
    const r = clamp(195 + checker + grout + n1 + vIntensity);
    const g = clamp(192 + checker + grout + n1 + vIntensity);
    const b = clamp(185 + checker + grout + n1 + vIntensity);
    t[y * S + x] = rgba(r, g, b);
  }
}

/* ── Portrait helpers ────────────────────────────────────────── */
function drawPortraitFrame(t: TexData, seed: number) {
  // Gold ornate frame — noise-varied per portrait
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const border = x < 5 || x >= S - 5 || y < 5 || y >= S - 5;
    const inner = x < 7 || x >= S - 7 || y < 7 || y >= S - 7;
    if (border) {
      const n = noise(x, y, seed) * 12;
      const ornament = Math.sin(x * 0.5 + noise(0, 0, seed + 1) * 2) * Math.sin(y * 0.5) * 8;
      t[y * S + x] = rgba(clamp(190 + n + ornament), clamp(160 + n + ornament), clamp(40 + n));
    } else if (inner && !border) {
      t[y * S + x] = rgba(clamp(160), clamp(130), clamp(30));
    }
  }
}



function drawHead(t: TexData, cx: number, cy: number, rx: number, ry: number, seed: number) {
  for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    if (x < 8 || x >= S - 8 || y < 8 || y >= S - 8) continue;
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const n = noise(x, y, seed) * 8;
    // Skin tone varies by seed
    const skinR = 160 + noise(0, 0, seed + 1) * 30;
    const skinG = 125 + noise(0, 0, seed + 2) * 30;
    const skinB = 85 + noise(0, 0, seed + 3) * 30;
    t[y * S + x] = rgba(clamp(skinR + n), clamp(skinG + n), clamp(skinB + n));
  }
}

function drawPortraitBg(t: TexData, seed: number) {
  // Background tint — noise-driven per variant
  const bgStyle = Math.floor(noise(0, 0, seed + 1) * 7);
  let bgR: number, bgG: number, bgB: number;
  switch (bgStyle) {
    case 0: bgR = 70 + noise(0, 0, seed + 2) * 30; bgG = 20; bgB = 18; break;       // red
    case 1: bgR = 40; bgG = 50 + noise(0, 0, seed + 2) * 20; bgB = 35; break;        // green military
    case 2: bgR = 35; bgG = 35; bgB = 55 + noise(0, 0, seed + 2) * 25; break;        // dark blue
    case 3: bgR = 50 + noise(0, 0, seed + 2) * 20; bgG = 38; bgB = 25; break;        // brown
    case 4: bgR = 55 + noise(0, 0, seed + 2) * 15; bgG = 45; bgB = 50; break;        // mauve
    case 5: bgR = 25; bgG = 40 + noise(0, 0, seed + 2) * 15; bgB = 45; break;        // teal
    default: bgR = 35 + noise(0, 0, seed + 2) * 15; bgG = 30; bgB = 28; break;       // dark
  }
  for (let y = 8; y < S - 8; y++) for (let x = 8; x < S - 8; x++) {
    const n = noise(x, y, seed + 10) * 8;
    t[y * S + x] = rgba(clamp(bgR + n), clamp(bgG + n), clamp(bgB + n));
  }
}

function drawPortraitHat(t: TexData, cx: number, headY: number, headRx: number, headRy: number, seed: number): number {
  // Hat (military cap, ushanka, beret, or none)
  const hatStyle = Math.floor(noise(0, 0, seed + 50) * 6);
  if (hatStyle < 3) {
    const hatTop = headY - headRy - (hatStyle === 1 ? 4 : 2);
    const hatBot = headY - headRy + 1;
    const hatW = headRx + (hatStyle === 1 ? 2 : hatStyle === 2 ? -1 : 1);
    const hatR = hatStyle === 0 ? 45 : hatStyle === 1 ? 50 : 80;
    const hatG = hatStyle === 0 ? 55 : hatStyle === 1 ? 40 : 20;
    const hatB = hatStyle === 0 ? 35 : hatStyle === 1 ? 35 : 25;
    for (let y = Math.max(8, hatTop); y < hatBot; y++) for (let x = cx - hatW; x <= cx + hatW; x++) {
      if (x >= 8 && x < S - 8) {
        const n = noise(x, y, seed + 51) * 5;
        t[y * S + x] = rgba(clamp(hatR + n), clamp(hatG + n), clamp(hatB + n));
      }
    }
    // Star or cockade on front
    if (hatStyle === 0 && hatBot - 1 >= 8) {
      t[(hatBot - 1) * S + cx] = rgba(220, 40, 40);
      if (cx - 1 >= 8) t[(hatBot - 1) * S + cx - 1] = rgba(200, 30, 30);
      if (cx + 1 < S - 8) t[(hatBot - 1) * S + cx + 1] = rgba(200, 30, 30);
    }
  }
  return hatStyle;
}

function drawPortraitHair(t: TexData, cx: number, headY: number, headRx: number, headRy: number, hatStyle: number, seed: number): { hairR: number, hairG: number, hairB: number } {
  // Hair
  const hairStyle = Math.floor(noise(0, 0, seed + 7) * 5);
  const hairR = 25 + Math.floor(noise(0, 0, seed + 8) * 50);
  const hairG = 20 + Math.floor(noise(0, 0, seed + 9) * 35);
  const hairB = 15 + Math.floor(noise(0, 0, seed + 11) * 25);
  if (hairStyle > 0 && hatStyle >= 3) {
    const hairTop = headY - headRy;
    const hairBot = headY - Math.floor(headRy * 0.2);
    const hairW = headRx + (hairStyle === 2 ? 2 : hairStyle === 3 ? -1 : 0);
    for (let y = hairTop; y < hairBot; y++) for (let x = cx - hairW; x <= cx + hairW; x++) {
      const dx2 = (x - cx) / hairW, dy2 = (y - headY + headRy * 0.5) / headRy;
      if (dx2 * dx2 + dy2 * dy2 < 0.8 + noise(x, y, seed + 30) * 0.3 && y >= 8 && x >= 8 && x < S - 8) {
        const n = noise(x, y, seed + 31) * 5;
        t[y * S + x] = rgba(clamp(hairR + n), clamp(hairG + n), clamp(hairB + n));
      }
    }
    // Sideburns for some
    if (hairStyle === 4) {
      for (let y = headY - headRy / 2; y < headY + 3; y++) for (const sx of [-1, 1]) {
        const px = cx + sx * (headRx + 1);
        if (px >= 8 && px < S - 8 && y >= 8 && y < S - 8)
          t[Math.floor(y) * S + px] = rgba(clamp(hairR), clamp(hairG), clamp(hairB));
      }
    }
  }
  return { hairR, hairG, hairB };
}

function drawPortraitEyesAndGlasses(t: TexData, cx: number, headY: number, seed: number) {
  // Eyes
  const eyeY = headY - 1 + Math.floor(noise(0, 0, seed + 60) * 2);
  const eyeSpacing = 3 + Math.floor(noise(0, 0, seed + 61) * 2);
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeSpacing;
    if (ex >= 8 && ex < S - 8 && eyeY >= 8 && eyeY < S - 8) {
      t[eyeY * S + ex] = rgba(20, 20, 20);
    }
  }

  // Glasses (some portraits)
  const hasGlasses = noise(0, 0, seed + 62) > 0.65;
  if (hasGlasses) {
    for (const sx of [-1, 1]) {
      const gx = cx + sx * eyeSpacing;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) >= 3) continue;
        const px = gx + dx, py = eyeY + dy;
        if (px >= 8 && px < S - 8 && py >= 8 && py < S - 8) {
          if (dx === 0 && dy === 0) continue; // keep pupil
          const isRim = Math.abs(dx) === 2 || Math.abs(dy) === 1;
          if (isRim) t[py * S + px] = rgba(40, 35, 30);
        }
      }
    }
    // Bridge between lenses
    if (eyeY >= 8) t[eyeY * S + cx] = rgba(40, 35, 30);
  }
}

function drawPortraitFacialHair(t: TexData, cx: number, headY: number, hairR: number, hairG: number, hairB: number, seed: number) {
  // Facial hair — moustache and/or beard
  const facialHair = noise(0, 0, seed + 12);
  if (facialHair > 0.4) {
    const mW = 2 + Math.floor(noise(0, 0, seed + 13) * 5);
    const mStyle = Math.floor(noise(0, 0, seed + 55) * 3);
    const mY = headY + 2 + Math.floor(noise(0, 0, seed + 56) * 2);
    for (let y = mY; y < mY + (mStyle === 2 ? 3 : 2); y++) for (let x = cx - mW; x <= cx + mW; x++) {
      if (x >= 8 && x < S - 8 && y >= 8 && y < S - 8) {
        if (mStyle === 1 && Math.abs(x - cx) < 2) continue; // handlebar gap
        t[y * S + x] = rgba(clamp(hairR), clamp(hairG), clamp(hairB));
      }
    }
  }
  if (facialHair > 0.7) {
    const beardLen = 3 + Math.floor(noise(0, 0, seed + 57) * 5);
    for (let y = headY + 4; y < headY + 4 + beardLen; y++) {
      const bw = Math.max(1, 4 - Math.floor((y - headY - 4) * 0.6));
      for (let x = cx - bw; x <= cx + bw; x++) {
        if (x >= 8 && x < S - 8 && y < S - 8)
          t[y * S + x] = rgba(clamp(hairR + noise(x, y, seed + 58) * 4), clamp(hairG), clamp(hairB));
      }
    }
  }
}

function drawPortraitClothing(t: TexData, cx: number, headY: number, headRy: number, seed: number) {
  // Clothing — military, suit, or worker
  const clothingStyle = Math.floor(noise(0, 0, seed + 14) * 4);
  const isMilitary = clothingStyle < 2;
  const isWorker = clothingStyle === 3;
  const suitR = isMilitary ? 45 + noise(0, 0, seed + 15) * 25 : isWorker ? 65 + noise(0, 0, seed + 15) * 15 : 30 + noise(0, 0, seed + 15) * 20;
  const suitG = isMilitary ? 50 + noise(0, 0, seed + 16) * 25 : isWorker ? 55 + noise(0, 0, seed + 16) * 15 : 30 + noise(0, 0, seed + 16) * 15;
  const suitB = isMilitary ? 35 + noise(0, 0, seed + 17) * 20 : isWorker ? 45 + noise(0, 0, seed + 17) * 15 : 35 + noise(0, 0, seed + 17) * 15;
  const bodyW = 10 + Math.floor(noise(0, 0, seed + 18) * 6);
  // Collar/lapel
  const collarY = headY + headRy + 1;
  for (let y = collarY; y < Math.min(collarY + 3, S - 8); y++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      if (x >= 8 && x < S - 8) {
        const isLapel = Math.abs(x - cx) >= 1 && Math.abs(x - cx) <= 3;
        if (isLapel) {
          const n = noise(x, y, seed + 41) * 4;
          t[y * S + x] = rgba(clamp(220 + n), clamp(215 + n), clamp(210 + n)); // white collar
        }
      }
    }
  }
  for (let y = collarY + 2; y < S - 8; y++) for (let x = cx - bodyW; x <= cx + bodyW; x++) {
    if (x < 8 || x >= S - 8) continue;
    const n = noise(x, y, seed + 40) * 8;
    const btn = (!isMilitary && Math.abs(x - cx) < 1 && y % 6 < 2) ? 20 : 0;
    t[y * S + x] = rgba(clamp(suitR + n + btn), clamp(suitG + n + btn), clamp(suitB + n));
  }

  // Military decorations
  if (isMilitary) {
    // Epaulettes
    for (const side of [-1, 1]) {
      const ex = cx + side * (bodyW - 2);
      for (let dy = 0; dy < 3; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = ex + dx, py = collarY + 3 + dy;
        if (px >= 8 && px < S - 8 && py < S - 8) t[py * S + px] = rgba(190, 160, 40);
      }
    }
    // Medals (1-3 based on seed)
    const medalCount = 1 + Math.floor(noise(0, 0, seed + 63) * 3);
    for (let m = 0; m < medalCount; m++) {
      const medalY = collarY + 8 + m * 4;
      const medalX = cx + 3 + m * 3;
      const medalColors = [[220, 190, 50], [200, 50, 50], [100, 150, 200]];
      const mc = medalColors[m % 3];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (medalX + dx < S - 8 && medalY + dy < S - 8 && medalX + dx >= 8 && medalY + dy >= 8)
          t[(medalY + dy) * S + (medalX + dx)] = rgba(mc[0], mc[1], mc[2]);
      }
    }
  } else if (!isWorker) {
    // Tie
    const tieR = 80 + Math.floor(noise(0, 0, seed + 19) * 140);
    const tieG = 10 + Math.floor(noise(0, 0, seed + 21) * 40);
    const tieB = 10 + Math.floor(noise(0, 0, seed + 22) * 40);
    for (let y = collarY + 2; y < Math.min(collarY + 18, S - 8); y++) {
      const tw = Math.max(1, 3 - Math.floor((y - collarY - 2) / 5));
      for (let dx = -tw; dx <= tw; dx++) {
        const px = cx + dx;
        if (px >= 8 && px < S - 8) t[y * S + px] = rgba(clamp(tieR), clamp(tieG), clamp(tieB));
      }
    }
  }
}

function gen_proceduralPortraits(textures: TexData[]) {
  const PORTRAIT_COUNT = 64; // 52..115 — coordinate-hash like posters
  for (let i = 0; i < PORTRAIT_COUNT; i++) {
    const t = textures[Tex.PORTRAIT_BASE + i];
    const seed = 870 + i * 37;

    drawPortraitFrame(t, seed + 100);
    drawPortraitBg(t, seed);

    const cx = S / 2;
    const headY = 20 + Math.floor(noise(0, 0, seed + 4) * 7);
    const headRx = 6 + Math.floor(noise(0, 0, seed + 5) * 5);
    const headRy = 7 + Math.floor(noise(0, 0, seed + 6) * 5);

    drawHead(t, cx, headY, headRx, headRy, seed + 20);
    const hatStyle = drawPortraitHat(t, cx, headY, headRx, headRy, seed);
    const { hairR, hairG, hairB } = drawPortraitHair(t, cx, headY, headRx, headRy, hatStyle, seed);
    drawPortraitEyesAndGlasses(t, cx, headY, seed);
    drawPortraitFacialHair(t, cx, headY, hairR, hairG, hairB, seed);
    drawPortraitClothing(t, cx, headY, headRy, seed);
  }
}

/* ── Parquet floor texture ────────────────────────────────────── */
function gen_parquet(t: TexData) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // Herringbone pattern
    const blockW = 8, blockH = 16;
    const bx = x % (blockW * 2);
    const by = y % (blockH * 2);
    const inFirstBlock = bx < blockW;
    const inFirstRow = by < blockH;
    const diagonal = (inFirstBlock === inFirstRow);
    const localX = diagonal ? (x % blockW) : (y % blockW);
    const grain = Math.sin(localX * 0.3 + noise(x, y, 950) * 4) * 12;
    const edge = (localX < 1 || (diagonal ? (y % blockH < 1) : (x % blockH < 1))) ? -20 : 0;
    const n = noise(x, y, 951) * 10 - 5;
    // Alternating light/dark planks
    const plankId = diagonal ? Math.floor(x / blockW) + Math.floor(y / blockH) : Math.floor(y / blockW) + Math.floor(x / blockH);
    const shade = (plankId & 1) ? 10 : -5;
    t[y * S + x] = rgba(
      clamp(145 + grain + edge + n + shade),
      clamp(105 + grain + edge + n + shade),
      clamp(60 + grain / 2 + edge + n + shade),
    );
  }
}

/* ── Red carpet edge-aware 16 variants ────────────────────────── */
/* Bitmask: bit0=N, bit1=E, bit2=S, bit3=W — set if gold trim on that edge */
function gen_carpetEdgeVariants(textures: TexData[]) {
  const TRIM = 4; // gold trim width in pixels
  for (let mask = 0; mask < 16; mask++) {
    const t = textures[Tex.F_CARPET_EDGE_BASE + mask];
    const trimN = !!(mask & 1), trimE = !!(mask & 2);
    const trimS = !!(mask & 4), trimW = !!(mask & 8);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const atN = trimN && y < TRIM;
      const atS = trimS && y >= S - TRIM;
      const atE = trimE && x >= S - TRIM;
      const atW = trimW && x < TRIM;
      if (atN || atS || atE || atW) {
        // Gold trim
        const bn = noise(x, y, 960 + mask) * 10;
        // Corner decoration — darker gold where two edges meet
        const isCorner = (atN || atS) && (atE || atW);
        const cornerDarken = isCorner ? -20 : 0;
        // Ornamental pattern on gold trim
        const ornament = Math.sin(x * 0.6 + y * 0.6) * 5;
        t[y * S + x] = rgba(
          clamp(185 + bn + cornerDarken + ornament),
          clamp(155 + bn + cornerDarken + ornament),
          clamp(35 + bn + cornerDarken),
        );
      } else {
        // Red carpet center
        const n = noise(x, y, 810) * 12 - 6;
        const weave = ((x + y) % 4 < 2) ? 5 : -5;
        t[y * S + x] = rgba(clamp(130 + n + weave), clamp(20 + n / 3), clamp(25 + n / 3));
      }
    }
  }
}

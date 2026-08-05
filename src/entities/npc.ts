/* ── NPC sprite generation — one per occupation ──────────────── */

import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

/* ── Base humanoid sprite generator ──────────────────────────── */
function genHumanoid(
  skinR: number, skinG: number, skinB: number,
  shirtR: number, shirtG: number, shirtB: number,
  pantsR: number, pantsG: number, pantsB: number,
  seed: number,
  headTop: number, headBot: number, bodyTop: number, bodyBot: number, legBot: number,
): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const headCy = Math.floor((headTop + headBot) / 2);
  const headRad = Math.floor((headBot - headTop) / 2);
  // Head
  for (let y = headTop; y < headBot; y++) for (let x = cx - headRad; x < cx + headRad; x++) {
    const dx = x - cx, dy = y - headCy;
    if (dx * dx + dy * dy < headRad * headRad) {
      const n = noise(x, y, seed) * 15;
      t[y * S + x] = rgba(clamp(skinR + n), clamp(skinG + n), clamp(skinB + n));
    }
  }
  // Eyes
  const eyeY = headCy;
  t[eyeY * S + (cx - 2)] = rgba(20, 20, 20);
  t[eyeY * S + (cx + 2)] = rgba(20, 20, 20);
  // Body
  for (let y = bodyTop; y < bodyBot; y++) {
    const halfW = 7 + (y < bodyTop + 8 ? (y - bodyTop) / 3 : 3);
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, seed + 10) * 10;
      t[y * S + x] = rgba(clamp(shirtR + n), clamp(shirtG + n), clamp(shirtB + n));
    }
  }
  // Legs
  for (let y = bodyBot; y < legBot; y++) {
    for (let leg = -1; leg <= 1; leg += 2) {
      for (let x = cx + leg * 2 - 3; x < cx + leg * 2 + 3; x++) {
        if (x < 0 || x >= S) continue;
        const n = noise(x, y, seed + 20) * 8;
        t[y * S + x] = rgba(clamp(pantsR + n), clamp(pantsG + n), clamp(pantsB + n));
      }
    }
  }
  return t;
}

/* ── Decoration helpers ──────────────────────────────────────── */
function addHat(t: Uint32Array, r: number, g: number, b: number, top: number) {
  const cx = S / 2;
  for (let y = top - 4; y < top + 2; y++)
    for (let x = cx - 7; x < cx + 7; x++)
      if (x >= 0 && x < S && y >= 0) {
        t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
      }
}

function addApron(t: Uint32Array, r: number, g: number, b: number, bodyTop: number, bodyBot: number) {
  const cx = S / 2;
  for (let y = bodyTop + 4; y < bodyBot; y++)
    for (let x = cx - 5; x < cx + 5; x++)
      if (x >= 0 && x < S) t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
}

function addStripe(t: Uint32Array, r: number, g: number, b: number, bodyTop: number, bodyBot: number) {
  const cx = S / 2;
  for (let y = bodyTop; y < bodyBot; y++)
    for (let x = cx - 1; x <= cx + 1; x++)
      if (x >= 0 && x < S) t[y * S + x] = rgba(clamp(r), clamp(g), clamp(b));
}

function addHair(t: Uint32Array, r: number, g: number, b: number, headTop: number, headBot: number) {
  const cx = S / 2;
  const headRad = Math.floor((headBot - headTop) / 2);
  const hairTop = headTop - 2;
  // Top volume — rounded
  for (let y = hairTop; y < headTop + 4; y++) {
    const row = y - hairTop;
    const shrink = row < 2 ? (2 - row) * 2 : 0;
    for (let x = cx - headRad - 1 + shrink; x <= cx + headRad + 1 - shrink; x++)
      if (x >= 0 && x < S && y >= 0) {
        const n = noise(x, y, 55) * 10;
        t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n));
      }
  }
  // Side locks
  for (let y = headTop + 2; y < headBot + 4; y++)
    for (let side = -1; side <= 1; side += 2)
      for (let w = 0; w < 2; w++) {
        const x = cx + side * (headRad + 1 - w);
        if (x >= 0 && x < S) {
          const n = noise(x, y, 55) * 10;
          t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n));
        }
      }
  // Right bang sweeping down over forehead
  const headCy = Math.floor((headTop + headBot) / 2);
  for (let y = headTop + 1; y < headCy + 2; y++) {
    const progress = (y - headTop - 1) / (headCy + 1 - headTop);
    const width = Math.floor(1 + progress * 3);
    for (let w = 0; w < width; w++) {
      const x = cx + headRad - 1 - w;
      if (x >= 0 && x < S) {
        const n = noise(x, y, 55) * 10;
        t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n));
      }
    }
  }
}

/* ── Occupation sprites — indexed by Occupation enum value ───── */
// Normal adult proportions: head 8-22, body 22-44, legs 44-58
const H_TOP = 8, H_BOT = 22, B_TOP = 22, B_BOT = 44, L_BOT = 58;
// Child proportions: smaller head, shorter body, shorter legs
const CH_TOP = 20, CH_BOT = 32, CB_TOP = 32, CB_BOT = 46, CL_BOT = 56;

function genHousewife(): Uint32Array {
  const t = genHumanoid(180, 155, 140, 160, 80, 100, 80, 60, 100, 0, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  addApron(t, 220, 220, 200, B_TOP, B_BOT); // light apron
  return t;
}
function genLocksmith(): Uint32Array {
  const t = genHumanoid(175, 150, 130, 80, 80, 120, 60, 60, 80, 1, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  addHat(t, 100, 100, 40, H_TOP); // yellow hard hat
  return t;
}
function genSecretary(): Uint32Array {
  return genHumanoid(185, 165, 145, 200, 200, 210, 40, 40, 60, 2, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
}
function genElectrician(): Uint32Array {
  const t = genHumanoid(170, 145, 125, 50, 80, 140, 50, 50, 70, 3, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  addHat(t, 220, 160, 30, H_TOP); // orange hard hat
  return t;
}
function genCook(): Uint32Array {
  const t = genHumanoid(180, 160, 140, 230, 230, 230, 50, 50, 60, 4, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  addHat(t, 240, 240, 240, H_TOP); // white chef hat
  addApron(t, 240, 240, 240, B_TOP, B_BOT);
  return t;
}
function genDoctor(): Uint32Array {
  const t = genHumanoid(185, 165, 150, 230, 240, 240, 60, 60, 80, 5, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  addHair(t, 100, 70, 40, H_TOP, H_BOT); // brown hair
  addStripe(t, 200, 40, 40, B_TOP, B_TOP + 10); // red cross
  return t;
}
function genTurner(): Uint32Array {
  return genHumanoid(170, 150, 130, 100, 90, 70, 70, 70, 80, 6, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
}
function genMechanic(): Uint32Array {
  const t = genHumanoid(175, 155, 135, 60, 70, 90, 60, 60, 70, 7, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  // oil stains
  for (let i = 0; i < 8; i++) {
    const sx = Math.floor(S / 2 - 5 + noise(i, 0, 700) * 10);
    const sy = B_TOP + Math.floor(noise(i, 1, 700) * (B_BOT - B_TOP));
    if (sx >= 0 && sx < S) t[sy * S + sx] = rgba(30, 25, 20);
  }
  return t;
}
function genStorekeeper(): Uint32Array {
  return genHumanoid(180, 160, 140, 120, 100, 60, 60, 50, 40, 8, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
}
function genAlcoholic(): Uint32Array {
  const t = genHumanoid(200, 150, 140, 100, 80, 80, 80, 70, 60, 9, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  // reddish nose
  const cx = S / 2;
  t[(H_BOT - 4) * S + cx] = rgba(220, 80, 80);
  return t;
}
function genScientist(): Uint32Array {
  const t = genHumanoid(180, 165, 150, 230, 230, 240, 40, 40, 50, 10, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  // glasses
  const cx = S / 2;
  const eyeY = Math.floor((H_TOP + H_BOT) / 2);
  t[eyeY * S + (cx - 3)] = rgba(180, 200, 230);
  t[eyeY * S + (cx + 3)] = rgba(180, 200, 230);
  return t;
}
function genChild(): Uint32Array {
  return genHumanoid(190, 170, 150, 200, 120, 60, 80, 80, 130, 11, CH_TOP, CH_BOT, CB_TOP, CB_BOT, CL_BOT);
}
function genDirector(): Uint32Array {
  const t = genHumanoid(180, 160, 140, 40, 40, 50, 30, 30, 40, 12, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  // tie
  const cx = S / 2;
  for (let y = B_TOP; y < B_TOP + 12; y++) t[y * S + cx] = rgba(180, 30, 30);
  return t;
}

function genPerformer(): Uint32Array {
  const t = genHumanoid(190, 155, 145, 118, 42, 72, 36, 34, 44, 17, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  addStripe(t, 215, 166, 80, B_TOP + 3, B_TOP + 14);
  for (let y = B_TOP + 5; y < B_TOP + 9; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (x >= 0 && x < S) t[y * S + x] = rgba(145, 52, 88);
    }
  }
  addHair(t, 60, 35, 28, H_TOP, H_BOT);
  return t;
}

function genPriest(): Uint32Array {
  // Black robe with golden cross on chest
  const t = genHumanoid(175, 150, 130, 20, 20, 22, 20, 20, 22, 160, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  // Golden cross on chest
  for (let y = B_TOP + 4; y < B_TOP + 16; y++) t[y * S + cx] = rgba(210, 180, 50);
  for (let x = cx - 3; x <= cx + 3; x++) t[(B_TOP + 7) * S + x] = rgba(210, 180, 50);
  // Black kamilavka (cylindrical hat)
  for (let y = H_TOP - 5; y < H_TOP; y++)
    for (let x = cx - 5; x <= cx + 5; x++)
      if (x >= 0 && x < S && y >= 0) t[y * S + x] = rgba(15, 15, 18);
  // Beard (dark brown)
  for (let y = H_BOT - 2; y < B_TOP + 3; y++)
    for (let x = cx - 4; x <= cx + 4; x++) {
      const n = noise(x, y, 161) * 10;
      t[y * S + x] = rgba(clamp(50 + n), clamp(35 + n), clamp(20 + n));
    }
  return t;
}

/** Priest sprite: Батюшка (black robe + golden cross) */
export function generatePriestSprite(): Uint32Array { return genPriest(); }

/** Performer sprite: Перформер (scene/service worker) */
export function generatePerformerSprite(): Uint32Array { return genPerformer(); }

/** Sprite generators indexed by Occupation enum value (0..12 = resident occupations) */
export const NPC_SPRITE_GENERATORS: (() => Uint32Array)[] = [
  genHousewife,   // 0  HOUSEWIFE
  genLocksmith,   // 1  LOCKSMITH
  genSecretary,   // 2  SECRETARY
  genElectrician, // 3  ELECTRICIAN
  genCook,        // 4  COOK
  genDoctor,      // 5  DOCTOR
  genTurner,      // 6  TURNER
  genMechanic,    // 7  MECHANIC
  genStorekeeper, // 8  STOREKEEPER
  genAlcoholic,   // 9  ALCOHOLIC
  genScientist,   // 10 SCIENTIST
  genChild,       // 11 CHILD
  genDirector,    // 12 DIRECTOR
];

/** Traveler sprite: Путник (citizen) — civilian with backpack */
export function generateTravelerSprite(): Uint32Array {
  const t = genHumanoid(175, 155, 135, 100, 120, 80, 60, 55, 50, 130, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  // Backpack on back (visible as side bump)
  const cx = S / 2;
  for (let y = B_TOP + 2; y < B_TOP + 14; y++) {
    for (let x = cx + 8; x < cx + 12; x++) {
      if (x < S) {
        const n = noise(x, y, 131) * 8;
        t[y * S + x] = rgba(clamp(80 + n), clamp(70 + n), clamp(50 + n));
      }
    }
  }
  return t;
}

/** Pilgrim sprite: Паломник (cultist) — hooded robe, no face visible */
export function generatePilgrimSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const headCy = Math.floor((H_TOP + H_BOT) / 2);
  const headRad = Math.floor((H_BOT - H_TOP) / 2);
  // Robe body — long flowing dark purple/black
  for (let y = H_TOP - 2; y < L_BOT; y++) {
    const robeProgress = (y - H_TOP) / (L_BOT - H_TOP);
    const halfW = y < B_TOP ? headRad + 3 : 8 + robeProgress * 3;
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 140) * 12;
      const base = y < B_TOP + 6 ? 35 : 30;
      t[y * S + x] = rgba(clamp(base + n), clamp(base - 5 + n), clamp(base + 15 + n));
    }
  }
  // Pointed hood — covers head entirely
  for (let y = H_TOP - 6; y < H_BOT + 2; y++) {
    const hoodProgress = Math.max(0, (y - (H_TOP - 6))) / ((H_BOT + 2) - (H_TOP - 6));
    const hw = Math.floor(1 + hoodProgress * (headRad + 4));
    for (let x = cx - hw; x <= cx + hw; x++) {
      if (x < 0 || x >= S || y < 0) continue;
      const n = noise(x, y, 141) * 8;
      t[y * S + x] = rgba(clamp(25 + n), clamp(20 + n), clamp(35 + n));
    }
  }
  // Dark shadow where face would be — just void
  for (let y = headCy - 2; y < H_BOT - 1; y++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      t[y * S + x] = rgba(8, 5, 12);
    }
  }
  // Faint glowing eyes deep in hood
  t[headCy * S + (cx - 2)] = rgba(120, 60, 160);
  t[headCy * S + (cx + 2)] = rgba(120, 60, 160);
  // Purple rune/symbol on chest
  for (let dy = 0; dy < 5; dy++) {
    t[(B_TOP + 4 + dy) * S + cx] = rgba(100, 40, 130);
  }
  t[(B_TOP + 6) * S + (cx - 2)] = rgba(100, 40, 130);
  t[(B_TOP + 6) * S + (cx + 2)] = rgba(100, 40, 130);
  return t;
}

/** Hunter sprite: Охотник (liquidator) — military uniform, gas mask, no face */
export function generateHunterSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const headCy = Math.floor((H_TOP + H_BOT) / 2);
  const headRad = Math.floor((H_BOT - H_TOP) / 2);
  // Head — gas mask (olive/dark rubber)
  for (let y = H_TOP; y < H_BOT; y++) for (let x = cx - headRad; x < cx + headRad; x++) {
    const dx = x - cx, dy = y - headCy;
    if (dx * dx + dy * dy < headRad * headRad) {
      const n = noise(x, y, 150) * 8;
      // Rubber gas mask — dark olive
      t[y * S + x] = rgba(clamp(45 + n), clamp(50 + n), clamp(35 + n));
    }
  }
  // Gas mask eye lenses — large, round, reflective
  const lensY = headCy - 1;
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -2; dx <= -1; dx++) {
      const x = cx + dx;
      if (x >= 0 && x < S && lensY + dy >= 0) {
        t[(lensY + dy) * S + x] = rgba(80, 120, 100);
      }
    }
    for (let dx = 1; dx <= 2; dx++) {
      const x = cx + dx;
      if (x >= 0 && x < S && lensY + dy >= 0) {
        t[(lensY + dy) * S + x] = rgba(80, 120, 100);
      }
    }
  }
  // Filter canister below (center bottom of head)
  for (let y = H_BOT - 3; y < H_BOT + 1; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x >= 0 && x < S) {
        t[y * S + x] = rgba(55, 55, 45);
      }
    }
  }
  // Helmet — military olive with strap
  for (let y = H_TOP - 3; y < H_TOP + 3; y++) {
    for (let x = cx - headRad - 1; x <= cx + headRad + 1; x++) {
      if (x >= 0 && x < S && y >= 0) {
        const n = noise(x, y, 151) * 6;
        t[y * S + x] = rgba(clamp(60 + n), clamp(70 + n), clamp(40 + n));
      }
    }
  }
  // Body — military camo (olive/dark green pattern)
  for (let y = B_TOP; y < B_BOT; y++) {
    const halfW = 7 + (y < B_TOP + 8 ? (y - B_TOP) / 3 : 3);
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 152) * 10;
      const camo = noise(x * 3, y * 3, 153) > 0.6 ? 15 : 0;
      t[y * S + x] = rgba(clamp(55 + n - camo), clamp(70 + n - camo), clamp(40 + n));
    }
  }
  // Legs — military cargo pants
  for (let y = B_BOT; y < L_BOT; y++) {
    for (let leg = -1; leg <= 1; leg += 2) {
      for (let x = cx + leg * 2 - 3; x < cx + leg * 2 + 3; x++) {
        if (x < 0 || x >= S) continue;
        const n = noise(x, y, 154) * 6;
        t[y * S + x] = rgba(clamp(50 + n), clamp(55 + n), clamp(35 + n));
      }
    }
  }
  // Ammo belt across chest
  for (let y = B_TOP + 2; y < B_TOP + 4; y++) {
    for (let x = cx - 6; x <= cx + 4; x++) {
      if (x >= 0 && x < S) {
        t[y * S + x] = rgba(70, 60, 40);
      }
    }
  }
  return t;
}

/** Veteran sprite: Ветеран Степаныч — old soldier with beret, grey beard, medals */
export function generateVeteranSprite(): Uint32Array {
  // Faded camo jacket + dark brown trousers, ruddy weathered skin
  const t = genHumanoid(195, 165, 140, 75, 85, 55, 55, 45, 35, 170, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  // Maroon paratrooper beret tilted to the side
  for (let y = H_TOP - 4; y < H_TOP + 2; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (x < 0 || x >= S || y < 0) continue;
      const n = noise(x, y, 171) * 8;
      t[y * S + x] = rgba(clamp(110 + n), clamp(35 + n), clamp(35 + n));
    }
  }
  // Beret tail/flap leaning right
  for (let y = H_TOP - 3; y < H_TOP + 1; y++) {
    for (let x = cx + 5; x < cx + 8; x++) {
      if (x < S && y >= 0) t[y * S + x] = rgba(90, 25, 25);
    }
  }
  // Grey beard
  for (let y = H_BOT - 3; y < B_TOP + 4; y++) {
    for (let x = cx - 5; x <= cx + 5; x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 172) * 12;
      t[y * S + x] = rgba(clamp(180 + n), clamp(180 + n), clamp(175 + n));
    }
  }
  // Eye patch over right eye
  const eyeY = Math.floor((H_TOP + H_BOT) / 2);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = 1; dx <= 4; dx++) {
      if (cx + dx < S) t[(eyeY + dy) * S + (cx + dx)] = rgba(15, 15, 15);
    }
  }
  // Eye patch strap
  for (let x = cx + 4; x < cx + 8; x++) if (x < S) t[eyeY * S + x] = rgba(20, 20, 20);
  // Two medals on chest (golden + red ribbon)
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    t[(B_TOP + 5 + dy) * S + (cx - 5 + dx)] = rgba(220, 180, 40);
    t[(B_TOP + 5 + dy) * S + (cx + 3 + dx)] = rgba(200, 50, 50);
  }
  // Walking cane on right side
  for (let y = B_BOT - 4; y < L_BOT; y++) {
    const cxc = cx + 9;
    if (cxc < S) t[y * S + cxc] = rgba(80, 55, 35);
  }
  return t;
}

/** Gordon sprite: orange HEV-style suit, dark glasses, brown beard */
export function generateGordonSprite(): Uint32Array {
  // Orange jumpsuit + dark grey trousers, weathered skin
  const t = genHumanoid(195, 165, 145, 215, 110, 35, 60, 60, 65, 180, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  const eyeY = Math.floor((H_TOP + H_BOT) / 2);
  // Brown hair (short)
  for (let y = H_TOP - 2; y < H_TOP + 3; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (x < 0 || x >= S || y < 0) continue;
      const n = noise(x, y, 181) * 8;
      t[y * S + x] = rgba(clamp(85 + n), clamp(55 + n), clamp(30 + n));
    }
  }
  // Brown beard
  for (let y = H_BOT - 4; y < B_TOP + 3; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 182) * 10;
      t[y * S + x] = rgba(clamp(85 + n), clamp(55 + n), clamp(30 + n));
    }
  }
  // Black-rimmed glasses (two thick rectangles)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -3; dx <= -1; dx++) t[(eyeY + dy) * S + (cx + dx)] = rgba(15, 15, 15);
    for (let dx = 1; dx <= 3; dx++)   t[(eyeY + dy) * S + (cx + dx)] = rgba(15, 15, 15);
  }
  // Reflective lens fill
  t[eyeY * S + (cx - 2)] = rgba(120, 180, 220);
  t[eyeY * S + (cx + 2)] = rgba(120, 180, 220);
  // Bridge
  t[eyeY * S + cx] = rgba(15, 15, 15);
  // HEV chest plate — light grey rectangle with cyan light
  for (let y = B_TOP + 4; y < B_TOP + 12; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (x < 0 || x >= S) continue;
      t[y * S + x] = rgba(160, 160, 165);
    }
  }
  // Cyan indicator
  t[(B_TOP + 7) * S + cx] = rgba(80, 220, 240);
  t[(B_TOP + 8) * S + cx] = rgba(80, 220, 240);
  return t;
}

/** Madoka sprite: pink-haired anime magical girl with twintails + bow + white dress */
export function generateMadokaSprite(): Uint32Array {
  // Pale skin + white dress + dark pink trim
  const t = genHumanoid(240, 220, 215, 245, 245, 250, 245, 220, 230, 190, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  const eyeY = Math.floor((H_TOP + H_BOT) / 2);
  // Big pink anime eyes (overwrite default dark eyes)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 0; dx++) t[(eyeY + dy) * S + (cx - 2 + dx)] = rgba(230, 80, 140);
    for (let dx = 0; dx <= 1; dx++)  t[(eyeY + dy) * S + (cx + 2 + dx)] = rgba(230, 80, 140);
  }
  // Eye highlights
  t[(eyeY - 1) * S + (cx - 2)] = rgba(255, 255, 255);
  t[(eyeY - 1) * S + (cx + 3)] = rgba(255, 255, 255);
  // Pink hair — bangs over forehead
  for (let y = H_TOP - 3; y < H_TOP + 5; y++) {
    for (let x = cx - 7; x <= cx + 7; x++) {
      if (x < 0 || x >= S || y < 0) continue;
      const n = noise(x, y, 191) * 10;
      t[y * S + x] = rgba(clamp(245 + n), clamp(160 + n), clamp(195 + n));
    }
  }
  // Side locks framing face
  for (let y = H_TOP + 2; y < H_BOT + 2; y++) {
    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < 2; w++) {
        const x = cx + side * (7 - w);
        if (x >= 0 && x < S) {
          const n = noise(x, y, 191) * 10;
          t[y * S + x] = rgba(clamp(245 + n), clamp(160 + n), clamp(195 + n));
        }
      }
    }
  }
  // Twin-tails bows (red ribbons on top)
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      t[(H_TOP - 4 + dy) * S + (cx - 7 + dx)] = rgba(220, 50, 70);
      t[(H_TOP - 4 + dy) * S + (cx + 7 + dx)] = rgba(220, 50, 70);
    }
  }
  // Pink trim along chest (dress collar)
  for (let x = cx - 6; x <= cx + 6; x++) {
    if (x < 0 || x >= S) continue;
    t[(B_TOP + 1) * S + x] = rgba(230, 80, 140);
    t[(B_TOP + 2) * S + x] = rgba(230, 80, 140);
  }
  // Red bow at neck
  for (let dy = 0; dy < 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    t[(B_TOP + 3 + dy) * S + (cx + dx)] = rgba(220, 50, 70);
  }
  // Dress puff sleeves (lighter pink)
  for (let y = B_TOP + 2; y < B_TOP + 8; y++) {
    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < 3; w++) {
        const x = cx + side * (8 - w);
        if (x >= 0 && x < S) {
          t[y * S + x] = rgba(255, 200, 220);
        }
      }
    }
  }
  return t;
}

/** Pakhom sprite: bald skinhead in white tank top, dirty trousers, mean expression */
export function generatePakhomSprite(): Uint32Array {
  // Pale weathered skin, dirty white tank top, brown trousers
  const t = genHumanoid(205, 175, 155, 230, 225, 215, 90, 75, 55, 200, H_TOP, H_BOT, B_TOP, B_BOT, L_BOT);
  const cx = S / 2;
  const headCy = Math.floor((H_TOP + H_BOT) / 2);
  const headRad = Math.floor((H_BOT - H_TOP) / 2);
  // Bald head — no hair, just slight shading on top
  for (let y = H_TOP; y < H_TOP + 3; y++) {
    for (let x = cx - headRad + 1; x <= cx + headRad - 1; x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 201) * 8;
      t[y * S + x] = rgba(clamp(195 + n), clamp(165 + n), clamp(145 + n));
    }
  }
  // Dark stubble shadow (chin + cheeks)
  for (let y = H_BOT - 4; y < H_BOT; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (x < 0 || x >= S) continue;
      if (noise(x, y, 202) > 0.5) {
        t[y * S + x] = rgba(70, 55, 45);
      }
    }
  }
  // Heavy brow / mean look
  for (let x = cx - 4; x <= cx + 4; x++) {
    if (x >= 0 && x < S) t[(headCy - 2) * S + x] = rgba(70, 55, 45);
  }
  // Tank-top straps (skin showing on shoulders)
  for (let y = B_TOP; y < B_TOP + 3; y++) {
    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < 2; w++) {
        const x = cx + side * (7 - w);
        if (x >= 0 && x < S) {
          const n = noise(x, y, 203) * 10;
          t[y * S + x] = rgba(clamp(205 + n), clamp(175 + n), clamp(155 + n));
        }
      }
    }
  }
  // Dirt stains on tank top
  for (let i = 0; i < 6; i++) {
    const sx = cx - 4 + Math.floor(noise(i, 0, 204) * 8);
    const sy = B_TOP + 4 + Math.floor(noise(i, 1, 204) * 12);
    if (sx >= 0 && sx < S) t[sy * S + sx] = rgba(120, 90, 60);
  }
  return t;
}

export const AUTHORED_NPC_SPRITE_GENERATORS = [
  { id: 'veteran_stepanych', generate: generateVeteranSprite },
  { id: 'gordon_freeman', generate: generateGordonSprite },
  { id: 'meduka_meguku', generate: generateMadokaSprite },
  { id: 'pahom_bratishka', generate: generatePakhomSprite },
] as const;

export type AuthoredNpcSpriteId = typeof AUTHORED_NPC_SPRITE_GENERATORS[number]['id'];

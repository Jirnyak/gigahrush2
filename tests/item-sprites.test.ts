import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, type Entity } from '../src/core/types';
import { DOCUMENT_ACCESS_ITEMS } from '../src/data/documents_access';
import { ITEMS } from '../src/data/items';
import { generateItemSprite, itemDropDefId } from '../src/render/item_sprites';
import { S } from '../src/render/pixutil';

function opaquePixels(sprite: Uint32Array): number {
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;
  return opaque;
}

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (let i = 0; i < sprite.length; i++) {
    h ^= sprite[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function countPixels(
  sprite: Uint32Array,
  predicate: ((px: number) => boolean) | ((r: number, g: number, b: number, a: number) => boolean),
): number {
  let count = 0;
  for (const px of sprite) {
    if (predicate.length <= 1) {
      if ((predicate as (px: number) => boolean)(px)) count++;
      continue;
    }
    if ((predicate as (r: number, g: number, b: number, a: number) => boolean)(
      px & 255,
      (px >>> 8) & 255,
      (px >>> 16) & 255,
      px >>> 24,
    )) count++;
  }
  return count;
}

function countPixelsIn(
  sprite: Uint32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  predicate: (r: number, g: number, b: number, a: number) => boolean,
): number {
  let count = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = sprite[y * S + x];
    const a = px >>> 24;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (predicate(r, g, b, a)) count++;
  }
  return count;
}

function rowOpaquePixels(sprite: Uint32Array, y: number): number {
  let opaque = 0;
  for (let x = 0; x < S; x++) if ((sprite[y * S + x] >>> 24) !== 0) opaque++;
  return opaque;
}

test('procedural item sprites cover the complete item registry', () => {
  const ids = Object.keys(ITEMS).sort();
  assert.equal(ids.length, 441);

  const hashes = new Set<number>();
  for (const id of ids) {
    const sprite = generateItemSprite(id);
    assert.equal(sprite.length, S * S, `${id} sprite should have atlas-sized pixels`);
    assert.ok(opaquePixels(sprite) > 70, `${id} sprite should not be blank`);
    hashes.add(spriteHash(sprite));
  }

  assert.ok(hashes.size > ids.length * 0.84, 'item sprite generator should produce item-specific silhouettes/marks');
});

test('agnia_a130 sprite reads as a sanitary corridor flamethrower', () => {
  const sprite = generateItemSprite('agnia_a130');
  const opaque = opaquePixels(sprite);
  const blueMetal = countPixels(sprite, (r, g, b, a) => a > 180 && b > r + 8 && g >= r);
  const warningPaint = countPixels(sprite, (r, g, b, a) => a > 180 && r > 170 && g > 105 && b < 80);
  const hotNozzle = countPixels(sprite, (r, g, b, a) => a > 150 && r > 180 && g < 115 && b < 90);

  assert.ok(opaque > 190, 'agnia_a130 should have a readable diagonal weapon mass');
  assert.ok(blueMetal > 45, 'agnia_a130 should use black/blue sanitary metal');
  assert.ok(warningPaint > 8, 'agnia_a130 should include a yellow/red service accent');
  assert.ok(hotNozzle > 8, 'agnia_a130 should include a small flame/nozzle accent');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('flamethrower')), 'agnia_a130 should not reuse the generic flamethrower icon');
});

test('ammo shells sprite reads as red shotgun shells in a tray', () => {
  assert.ok(ITEMS.ammo_shells, 'ammo_shells should stay registered');
  assert.equal(ITEMS.ammo_shells.name, 'Дробь');
  assert.equal(ITEMS.ammo_shells.desc, 'Дробовые патроны для коридорных стволов');

  const sprite = generateItemSprite('ammo_shells');
  const redHull = countPixels(sprite, (r, g, b, a) => a > 180 && r > 90 && r > g + 34 && r > b + 34 && g < 90);
  const brass = countPixels(sprite, (r, g, b, a) => a > 180 && r > 145 && g > 90 && g < 190 && b < 100);
  const greenCode = countPixels(sprite, (r, g, b, a) => a > 170 && g > 110 && r < 110 && b < 120);
  const orangeCode = countPixels(sprite, (r, g, b, a) => a > 170 && r > 190 && g > 75 && g < 145 && b < 90);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 220, 'ammo_shells should have a readable shell-and-tray mass');
  assert.ok(rowOpaquePixels(sprite, 46) > rowOpaquePixels(sprite, 16) + 10, 'tray row should read wider than the cartridge tops');
  assert.ok(redHull > 80, 'ammo_shells should show dark red shotgun hulls');
  assert.ok(brass > 65, 'ammo_shells should show brass bases');
  assert.ok(greenCode > 4, 'ammo_shells should include a green ammo code mark');
  assert.ok(orangeCode > 10, 'ammo_shells should include orange ammo code marks');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_9mm')), 'ammo_shells should not reuse the 9mm cartridge sprite');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('black_market_shells')), 'ammo_shells should differ from contraband shell packs');
});

test('ato41_atomic_flamer sprite reads as twin sealed atomic flamer', () => {
  assert.ok(ITEMS.ato41_atomic_flamer, 'ato41_atomic_flamer should stay registered');
  assert.equal(ITEMS.ato41_atomic_flamer.name, 'АТО-41');
  assert.equal(ITEMS.ato41_atomic_flamer.type, ItemType.WEAPON);

  const sprite = generateItemSprite('ato41_atomic_flamer');
  const hash = spriteHash(sprite);
  const blueBlackMetal = countPixels(sprite, (r, g, b, a) => a > 180 && r < 120 && g >= r && b > r + 8 && b < 150);
  const yellowServiceMarks = countPixels(sprite, (r, g, b, a) => a > 170 && r > 170 && g > 120 && b < 95);
  const redSeals = countPixels(sprite, (r, g, b, a) => a > 170 && r > 140 && g < 90 && b < 80);
  const hotNozzle = countPixelsIn(sprite, 49, 16, 61, 25, (r, g, b, a) => a > 150 && r > 180 && g < 125 && b < 90);

  assert.equal(sprite[0] >>> 24, 0, 'ato41_atomic_flamer sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 230, 'ato41_atomic_flamer should have enough visible diagonal weapon mass');
  assert.ok(blueBlackMetal > 95, 'ato41_atomic_flamer should use black/blue sealed metal');
  assert.ok(yellowServiceMarks > 8, 'ato41_atomic_flamer should include yellow service markings');
  assert.ok(redSeals > 16, 'ato41_atomic_flamer should include red sealed-section markings');
  assert.ok(hotNozzle > 5, 'ato41_atomic_flamer should include a small hot nozzle accent');
  for (const id of ['flamethrower', 'roks47_flamethrower', 'agnia_a130', 'o15_multijet_flamer']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ato41_atomic_flamer should not reuse ${id} sprite language`);
  }
});

test('ak47 sprite keeps an old-world rifle silhouette with wood, metal, and magazine read', () => {
  const sprite = generateItemSprite('ak47');
  const serviceAuto = generateItemSprite('eralashnikov_auto');

  assert.notEqual(spriteHash(sprite), spriteHash(serviceAuto), 'ak47 should not share the liquidator auto visual');
  assert.ok(opaquePixels(sprite) > 220, 'ak47 sprite should be readable at item icon size');

  const woodPixels = countPixels(sprite, (r, g, b, a) => a > 160 && r > 70 && g >= 35 && g < 85 && b < 60 && r > g + 20);
  const rustPixels = countPixels(sprite, (r, g, b, a) => a > 120 && r > 110 && g >= 35 && g < 95 && b < 70);
  const magazinePixels = countPixelsIn(sprite, 33, 36, 43, 51, (_r, _g, _b, a) => a > 120);
  const muzzlePixels = countPixelsIn(sprite, 49, 18, 58, 25, (_r, _g, _b, a) => a > 120);

  assert.ok(woodPixels > 38, 'ak47 sprite should show a worn wooden stock/handguard');
  assert.ok(rustPixels > 5, 'ak47 sprite should include rusty old-world wear');
  assert.ok(magazinePixels > 35, 'ak47 sprite should show a curved magazine under the receiver');
  assert.ok(muzzlePixels > 10, 'ak47 sprite should show a long rifle muzzle line');
});

test('axe sprite reads as a red fire axe with a cool metal head', () => {
  assert.ok(ITEMS.axe, 'axe should stay registered');
  assert.equal(ITEMS.axe.name, 'Топор');
  assert.equal(ITEMS.axe.type, ItemType.WEAPON);

  const sprite = generateItemSprite('axe');
  const coolHead = countPixelsIn(sprite, 34, 12, 55, 30, (r, g, b, a) => a > 165 && g > 55 && b > 55 && b >= r - 8 && g >= r - 10);
  const redGrip = countPixelsIn(sprite, 18, 40, 49, 51, (r, g, b, a) => a > 150 && r > 135 && g < 90 && b < 80);
  const handlePixels = countPixelsIn(sprite, 15, 23, 43, 52, (r, g, b, a) => a > 150 && r > 45 && r < 100 && g > 25 && g < 70 && b < 55 && r > g + 10);
  const rustPixels = countPixels(sprite, (r, g, b, a) => a > 100 && r > 100 && r < 170 && g > 35 && g < 95 && b < 75 && r > g + 25);

  assert.equal(sprite[0] >>> 24, 0, 'axe sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 220, 'axe should have enough visible mass for a small icon');
  assert.ok(coolHead > 70, 'axe should show a black/blue metal blade head');
  assert.ok(redGrip > 25, 'axe should include fire-tool red paint');
  assert.ok(handlePixels > 45, 'axe should keep a strong diagonal handle silhouette');
  assert.ok(rustPixels > 7, 'axe should carry rust/wear marks');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('liquidator_axe')), 'axe should not reuse the liquidator axe icon');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('fire_hook')), 'axe should not collapse into generic long fire tools');
});

test('bayonet sprite reads as a slim issued melee blade', () => {
  assert.equal(ITEMS.bayonet?.name, 'Штык');
  assert.equal(ITEMS.bayonet?.type, ItemType.WEAPON);

  const sprite = generateItemSprite('bayonet');
  const blueBlackMetal = countPixelsIn(sprite, 20, 8, 56, 46, (r, g, b, a) => a > 170 && b >= r + 8 && g >= r && r < 92);
  const wornEdge = countPixelsIn(sprite, 24, 8, 56, 42, (r, g, b, a) => a > 170 && r > 110 && g > 120 && b > 115 && Math.abs(g - b) < 28);
  const servicePaint = countPixels(sprite, (r, g, b, a) => a > 170 && r > 170 && g > 110 && g < 190 && b < 90);
  const rust = countPixels(sprite, (r, g, b, a) => a > 130 && r > 100 && r < 170 && g > 35 && g < 95 && b < 70);

  assert.equal(sprite[0] >>> 24, 0, 'bayonet sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 160, 'bayonet should have enough mass for a small world drop');
  assert.ok(blueBlackMetal > 45, 'bayonet should use blue-black service metal');
  assert.ok(wornEdge > 18, 'bayonet should expose a bright thin blade edge');
  assert.ok(servicePaint > 8, 'bayonet should include a yellow/red service mark near the hilt');
  assert.ok(rust > 8, 'bayonet should include chipped rust/noise');

  const hash = spriteHash(sprite);
  for (const id of ['rake_bayonet', 'liquidator_axe', 'rubber_club', 'knife']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `bayonet should not reuse ${id} sprite language`);
  }
});

test('bfg sprite reads as an oversized NII energy weapon', () => {
  assert.ok(ITEMS.bfg, 'bfg should stay registered');
  assert.equal(ITEMS.bfg.name, 'БФГ-9000');
  assert.equal(ITEMS.bfg.type, ItemType.WEAPON);

  const sprite = generateItemSprite('bfg');
  const hash = spriteHash(sprite);
  const blueBlackMetal = countPixels(sprite, (r, g, b, a) => a > 170 && b > r + 10 && g >= r && r < 115);
  const greenCharge = countPixels(sprite, (r, g, b, a) => a > 150 && g > 170 && r < 150 && b < 130);
  const serviceStripe = countPixels(sprite, (r, g, b, a) => a > 170 && r > 165 && g > 100 && b < 90);
  const heavyReceiver = countPixelsIn(sprite, 20, 28, 47, 43, (_r, _g, _b, a) => a > 160);
  const splitMuzzle = countPixelsIn(sprite, 48, 18, 60, 30, (_r, _g, _b, a) => a > 130);

  assert.equal(sprite[0] >>> 24, 0, 'bfg sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 300, 'bfg should have a readable heavy diagonal weapon mass');
  assert.ok(blueBlackMetal > 105, 'bfg should use black/blue experimental metal');
  assert.ok(greenCharge > 18, 'bfg should include a small green charge/muzzle cue');
  assert.ok(serviceStripe > 8, 'bfg should include a yellow or red service accent');
  assert.ok(heavyReceiver > 140, 'bfg should show a bulky central receiver');
  assert.ok(splitMuzzle > 28, 'bfg should show a heavy split muzzle');
  assert.notEqual(hash, spriteHash(generateItemSprite('gauss')), 'bfg should not reuse gauss rifle sprite language');
  assert.notEqual(hash, spriteHash(generateItemSprite('plasma')), 'bfg should not reuse plasma sprite language');
  assert.notEqual(hash, spriteHash(generateItemSprite('grn420_gravizhernov')), 'bfg should differ from another BFG-projectile weapon');
});

test('ammo_9mm sprite reads as a compact five-round cartridge cluster', () => {
  assert.equal(ITEMS.ammo_9mm?.name, 'Патроны 9мм');
  assert.equal(ITEMS.ammo_9mm?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_9mm');
  const brass = countPixelsIn(sprite, 18, 16, 51, 44, (r, g, b, a) => a > 170 && r > 135 && g > 80 && g < 190 && b < 95);
  const redStripe = countPixelsIn(sprite, 20, 22, 43, 30, (r, g, b, a) => a > 150 && r > 135 && g < 85 && b < 70);
  const darkBases = countPixelsIn(sprite, 18, 38, 51, 48, (r, g, b, a) => a > 150 && r < 95 && g < 80 && b < 65);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_9mm sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 190, 'ammo_9mm should have enough visible mass for a small icon');
  assert.ok(brass > 90, 'ammo_9mm should visibly use brass cartridge colors');
  assert.ok(redStripe > 20, 'ammo_9mm should include a red caliber stripe');
  assert.ok(darkBases > 20, 'ammo_9mm should include dark cartridge bases/tray');

  const hash = spriteHash(sprite);
  for (const id of ['ammo_762', 'ammo_762tt', 'ammo_nagant', 'ammo_shells', 'homemade_9mm']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_9mm should not reuse ${id} sprite language`);
  }
});

test('black market shells sprite reads as scrubbed contraband shotgun shells', () => {
  assert.equal(ITEMS.black_market_shells?.name, 'Чёрнорыночная дробь');
  assert.equal(ITEMS.black_market_shells?.type, ItemType.AMMO);

  const sprite = generateItemSprite('black_market_shells');
  const blackBlueHull = countPixelsIn(sprite, 15, 18, 49, 46, (r, g, b, a) => a > 170 && b >= r + 4 && g >= r && r < 90);
  const brassCaps = countPixelsIn(sprite, 16, 30, 50, 48, (r, g, b, a) => a > 150 && r > 130 && g > 80 && g < 190 && b < 90);
  const redSeal = countPixelsIn(sprite, 18, 20, 51, 42, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 80);
  const yellowMark = countPixelsIn(sprite, 18, 20, 51, 42, (r, g, b, a) => a > 150 && r > 170 && g > 110 && g < 190 && b < 90);
  const rust = countPixels(sprite, (r, g, b, a) => a > 100 && r > 80 && r < 145 && g > 35 && g < 85 && b < 60);

  assert.equal(sprite[0] >>> 24, 0, 'black_market_shells sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 900, 'black_market_shells should have a readable shell bundle silhouette');
  assert.ok(blackBlueHull > 90, 'black_market_shells should use black/blue smuggled shell hulls');
  assert.ok(brassCaps > 80, 'black_market_shells should keep shotgun brass caps visible');
  assert.ok(redSeal > 35, 'black_market_shells should include a red illegal seal');
  assert.ok(yellowMark > 20, 'black_market_shells should include a service yellow warning mark');
  assert.ok(rust > 25, 'black_market_shells should include rust/scrubbed serial grime');

  const hash = spriteHash(sprite);
  for (const id of ['ammo_shells', 'ammo_12g_slug', 'ammo_12g_chemical', 'ammo_12g_incendiary', 'ammo_nagant']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `black_market_shells should not reuse ${id} sprite language`);
  }
});

test('ammo_762 sprite reads as tall rifle cartridges with code bands', () => {
  assert.equal(ITEMS.ammo_762?.name, 'Патроны 7.62');
  assert.equal(ITEMS.ammo_762?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_762');
  const brass = countPixelsIn(sprite, 18, 13, 48, 50, (r, g, b, a) => a > 170 && r > 135 && g > 85 && g < 205 && b < 105);
  const redCode = countPixelsIn(sprite, 18, 39, 48, 46, (r, g, b, a) => a > 180 && r > 135 && g < 90 && b < 80);
  const greenCode = countPixelsIn(sprite, 18, 39, 48, 46, (r, g, b, a) => a > 180 && g > 105 && r < 110 && b < 110);
  const darkCases = countPixelsIn(sprite, 18, 17, 48, 50, (r, g, b, a) => a > 150 && r < 90 && g < 80 && b < 70);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_762 sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 260, 'ammo_762 should have enough visible mass for four rifle cartridges');
  assert.ok(brass > 150, 'ammo_762 should visibly use brass rifle cartridge bodies');
  assert.ok(redCode > 18, 'ammo_762 should include red cartridge code bands');
  assert.ok(greenCode > 18, 'ammo_762 should include green cartridge code bands');
  assert.ok(darkCases > 80, 'ammo_762 should include dark case bases/shadows');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_762tt')), 'ammo_762 should not reuse short TT pistol ammo art');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_9mm')), 'ammo_762 should not reuse compact 9mm ammo art');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_belt')), 'ammo_762 should not reuse belt ammo art');
});

test('ammo_coupon_shells sprite reads as official shotgun shell paperwork', () => {
  assert.equal(ITEMS.ammo_coupon_shells?.name, 'Талон на дробь');
  assert.equal(ITEMS.ammo_coupon_shells?.type, ItemType.MISC);

  const sprite = generateItemSprite('ammo_coupon_shells');
  const hash = spriteHash(sprite);
  const paper = countPixelsIn(sprite, 14, 14, 50, 51, (r, g, b, a) =>
    a > 150 && r > 120 && g > 100 && b > 70 && r > b + 25);
  const redCode = countPixelsIn(sprite, 16, 23, 49, 48, (r, g, b, a) =>
    a > 150 && r > 130 && g < 90 && b < 80);
  const brass = countPixelsIn(sprite, 18, 24, 48, 50, (r, g, b, a) =>
    a > 150 && r > 145 && g > 95 && b < 100);
  const shellMass = countPixelsIn(sprite, 23, 24, 48, 50, (_r, _g, _b, a) => a > 170);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_coupon_shells sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 520, 'ammo_coupon_shells should keep a readable paper-and-shell mass');
  assert.ok(paper > 260, 'ammo_coupon_shells should have a visible dirty coupon backing');
  assert.ok(redCode > 70, 'ammo_coupon_shells should use a red shotgun/ammo code stripe');
  assert.ok(brass > 35, 'ammo_coupon_shells should show brass shell caps or pellet dots');
  assert.ok(shellMass > 170, 'ammo_coupon_shells should show vertical shell silhouettes');
  for (const id of ['ammo_coupon_9mm', 'ammo_rifle_coupon', 'ammo_shells', 'black_market_shells']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_coupon_shells should not reuse ${id} sprite language`);
  }
});

test('ammo_nails sprite reads as a bundle of industrial nails', () => {
  assert.equal(ITEMS.ammo_nails?.name, 'Гвозди');
  assert.equal(ITEMS.ammo_nails?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_nails');
  const hash = spriteHash(sprite);
  const steelShafts = countPixelsIn(sprite, 16, 13, 49, 51, (r, g, b, a) =>
    a > 150 && Math.abs(r - g) < 26 && Math.abs(g - b) < 34 && r > 95 && r < 225);
  const headPixels = countPixelsIn(sprite, 15, 12, 50, 20, (r, g, b, a) =>
    a > 150 && Math.abs(r - g) < 30 && r > 120 && r < 230 && b > 95);
  const redTape = countPixelsIn(sprite, 19, 33, 45, 39, (r, g, b, a) =>
    a > 150 && r > 145 && g < 105 && b < 90);
  const darkTips = countPixelsIn(sprite, 17, 46, 48, 53, (r, g, b, a) =>
    a > 150 && r < 85 && g < 85 && b < 80);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_nails sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 260, 'ammo_nails should have enough visible mass for five nails and a tape band');
  assert.ok(steelShafts > 120, 'ammo_nails should show pale steel nail shafts');
  assert.ok(headPixels > 25, 'ammo_nails should show broad nail heads at the top');
  assert.ok(redTape > 35, 'ammo_nails should include a red/orange taped ammo-code band');
  assert.ok(darkTips > 18, 'ammo_nails should include dark pointed lower nail tips');
  for (const id of ['ammo_9mm', 'ammo_762', 'ammo_harpoon', 'rifle_bolt_pack', 'ammo_shells']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_nails should not reuse ${id} sprite language`);
  }
});

test('ammo_fuel sprite reads as a wide battered fuel canister', () => {
  assert.equal(ITEMS.ammo_fuel?.name, 'Канистра бензина');
  assert.equal(ITEMS.ammo_fuel?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_fuel');
  const hash = spriteHash(sprite);
  const canisterRow = countPixelsIn(sprite, 18, 39, 48, 39, (_r, _g, _b, a) => a > 0);
  const oliveMetal = countPixelsIn(sprite, 18, 14, 48, 52, (r, g, b, a) =>
    a > 150 && g >= r - 8 && g >= b + 5 && r > 45 && r < 150);
  const redWarning = countPixelsIn(sprite, 23, 20, 49, 41, (r, g, b, a) =>
    a > 150 && r > 140 && g < 100 && b < 90);
  const orangeFuel = countPixelsIn(sprite, 26, 27, 45, 40, (r, g, b, a) =>
    a > 100 && r > 190 && g > 85 && g < 160 && b < 85);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_fuel sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 330, 'ammo_fuel should have enough visible canister mass');
  assert.ok(canisterRow >= 24, 'ammo_fuel should read wider than a row of cartridges');
  assert.ok(oliveMetal > 250, 'ammo_fuel should show a dull green metal canister');
  assert.ok(redWarning > 25, 'ammo_fuel should include red warning paint');
  assert.ok(orangeFuel > 5, 'ammo_fuel should include a small fuel/fire color accent');
  for (const id of ['ammo_9mm', 'ammo_shells', 'ammo_energy', 'napalm_mix']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_fuel should not reuse ${id} sprite language`);
  }
});

test('ammo_762tt sprite reads as short TT pistol cartridges', () => {
  assert.equal(ITEMS.ammo_762tt?.name, 'Патроны 7.62 ТТ');
  assert.equal(ITEMS.ammo_762tt?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_762tt');
  const brass = countPixelsIn(sprite, 20, 27, 47, 48, (r, g, b, a) => a > 170 && r > 135 && g > 85 && g < 190 && b < 95);
  const redStripe = countPixelsIn(sprite, 19, 36, 46, 44, (r, g, b, a) => a > 170 && r > 120 && g < 80 && b < 80);
  const darkTips = countPixelsIn(sprite, 19, 22, 47, 31, (r, g, b, a) => a > 150 && r < 90 && g < 90 && b < 80);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_762tt sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 170, 'ammo_762tt should have enough visible mass for a small icon');
  assert.ok(brass > 70, 'ammo_762tt should visibly use brass cartridge bodies');
  assert.ok(redStripe > 18, 'ammo_762tt should include a red caliber stripe');
  assert.ok(darkTips > 12, 'ammo_762tt should include dark pistol bullet tips');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_762')), 'ammo_762tt should not reuse rifle 7.62 art');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_9mm')), 'ammo_762tt should not reuse 9mm art');
});

test('ammo_nagant sprite reads as old revolver cartridges', () => {
  assert.equal(ITEMS.ammo_nagant?.name, 'Патроны Наган');
  assert.equal(ITEMS.ammo_nagant?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_nagant');
  const hash = spriteHash(sprite);
  const brass = countPixelsIn(sprite, 16, 14, 50, 48, (r, g, b, a) => a > 160 && r > 125 && g > 78 && g < 190 && b < 105);
  const darkRims = countPixelsIn(sprite, 16, 20, 50, 50, (r, g, b, a) => a > 150 && r < 95 && g < 80 && b < 65);
  const redMark = countPixelsIn(sprite, 18, 30, 31, 47, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 75);
  const greenMark = countPixelsIn(sprite, 33, 30, 45, 47, (r, g, b, a) => a > 145 && g > 90 && r < 115 && b < 100);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_nagant sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 190, 'ammo_nagant should have enough visible mass for small inventory icons');
  assert.ok(brass > 80, 'ammo_nagant should visibly use old brass cartridge colors');
  assert.ok(darkRims > 35, 'ammo_nagant should include dark old cartridge rims and packet shadow');
  assert.ok(redMark > 8, 'ammo_nagant should keep a red revolver-ammo coding mark');
  assert.ok(greenMark > 6, 'ammo_nagant should keep a green revolver-ammo coding mark');
  for (const id of ['ammo_9mm', 'ammo_762tt', 'ammo_762', 'ammo_shells']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_nagant should not reuse ${id} sprite language`);
  }
});

test('ammo_harpoon sprite reads as long coded harpoon bolts', () => {
  assert.equal(ITEMS.ammo_harpoon?.name, 'Гарпуны');
  assert.equal(ITEMS.ammo_harpoon?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_harpoon');
  const hash = spriteHash(sprite);
  const darkShafts = countPixelsIn(sprite, 16, 20, 51, 50, (r, g, b, a) => a > 170 && r < 95 && g < 105 && b < 100);
  const brassCollars = countPixelsIn(sprite, 15, 39, 52, 51, (r, g, b, a) => a > 160 && r > 140 && g > 85 && g < 190 && b < 100);
  const paleTips = countPixelsIn(sprite, 15, 10, 52, 28, (r, g, b, a) => a > 160 && r > 150 && g > 150 && b > 120);
  const colorBands = countPixelsIn(sprite, 15, 32, 52, 43, (r, g, b, a) => a > 150 && (
    (r > 145 && g < 95 && b < 85) ||
    (g > 105 && r < 105 && b < 130)
  ));

  assert.equal(sprite[0] >>> 24, 0, 'ammo_harpoon sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 220, 'ammo_harpoon should have enough mass for four long bolts');
  assert.ok(darkShafts > 95, 'ammo_harpoon should show long dark shafts');
  assert.ok(brassCollars > 45, 'ammo_harpoon should show brass collars/bases');
  assert.ok(paleTips > 28, 'ammo_harpoon should show pale spear tips and barbs');
  assert.ok(colorBands > 18, 'ammo_harpoon should include red/green ammo-code bands');
  for (const id of ['ammo_nails', 'rifle_bolt_pack', 'ammo_762', 'ammo_belt']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_harpoon should not reuse ${id} sprite language`);
  }
});

test('ammo_belt sprite reads as a linked 7.62 feed belt', () => {
  assert.equal(ITEMS.ammo_belt?.name, 'Лента 7.62');
  assert.equal(ITEMS.ammo_belt?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_belt');
  const brass = countPixelsIn(sprite, 15, 20, 53, 52, (r, g, b, a) => a > 170 && r > 130 && g > 80 && g < 190 && b < 105);
  const linkBand = countPixelsIn(sprite, 14, 28, 51, 43, (r, g, b, a) => a > 150 && r < 95 && g < 85 && b < 75);
  const colorStripe = countPixelsIn(sprite, 16, 31, 52, 39, (r, g, b, a) => a > 150 && (
    (r > 135 && g < 100 && b < 90) ||
    (g > 115 && r < 135 && b < 130) ||
    (r > 170 && g > 95 && b < 95)
  ));

  assert.equal(sprite[0] >>> 24, 0, 'ammo_belt sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 230, 'ammo_belt should have enough mass for five linked cartridges');
  assert.ok(brass > 110, 'ammo_belt should visibly use brass cartridge colors');
  assert.ok(linkBand > 40, 'ammo_belt should show dark belt links across the rounds');
  assert.ok(colorStripe > 12, 'ammo_belt should include a small colored ammo-code stripe');

  const hash = spriteHash(sprite);
  for (const id of ['ammo_762', 'ammo_9mm', 'ammo_shells', 'ammo_12g_slug']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `ammo_belt should not reuse ${id} sprite language`);
  }
});

test('ammo_energy sprite reads as a charged energy cell', () => {
  assert.equal(ITEMS.ammo_energy?.name, 'Энергоячейка');
  assert.equal(ITEMS.ammo_energy?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_energy');
  const chargeCore = countPixelsIn(sprite, 29, 21, 38, 42, (r, g, b, a) => a > 150 && r < 130 && g > 150 && b > 95);
  const darkHousing = countPixelsIn(sprite, 24, 17, 43, 48, (r, g, b, a) => a > 170 && r < 95 && g < 105 && b < 100);
  const brassContacts = countPixelsIn(sprite, 27, 12, 44, 49, (r, g, b, a) => a > 150 && r > 150 && g > 100 && g < 205 && b < 105);
  const redSeal = countPixelsIn(sprite, 23, 28, 44, 34, (r, g, b, a) => a > 150 && r > 135 && g < 95 && b < 85);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_energy sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 230, 'ammo_energy should have enough visible mass for a small icon');
  assert.ok(chargeCore > 55, 'ammo_energy should show a green charge core');
  assert.ok(darkHousing > 100, 'ammo_energy should show a dark cell housing');
  assert.ok(brassContacts > 55, 'ammo_energy should show brass contact caps');
  assert.ok(redSeal > 30, 'ammo_energy should include a red/orange ammo code band');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_762')), 'ammo_energy should not reuse rifle cartridge language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_fuel')), 'ammo_energy should not reuse fuel ammo language');
});

test('ammo_issue_order sprite reads as a cartridge issue voucher', () => {
  assert.equal(ITEMS.ammo_issue_order?.name, 'Ордер на выдачу патронов');
  assert.equal(ITEMS.ammo_issue_order?.type, ItemType.MISC);

  const sprite = generateItemSprite('ammo_issue_order');
  const brass = countPixelsIn(sprite, 18, 16, 51, 49, (r, g, b, a) => a > 170 && r > 145 && g > 90 && g < 205 && b < 105 && r > g + 18);
  const stainedPaper = countPixelsIn(sprite, 13, 12, 51, 53, (r, g, b, a) => a > 140 && r > 145 && g > 130 && b > 80 && r > b + 35 && g > b + 25);
  const codeMarks = countPixelsIn(sprite, 19, 24, 49, 45, (r, g, b, a) => a > 170 && (
    (r > 160 && g < 90 && b < 80) ||
    (g > 115 && r < 125 && b < 120) ||
    (r > 190 && g > 90 && g < 155 && b < 90)
  ));

  assert.equal(sprite[0] >>> 24, 0, 'ammo_issue_order sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 850, 'ammo_issue_order should have a readable voucher-backed silhouette');
  assert.ok(brass > 95, 'ammo_issue_order should show multiple brass cartridges');
  assert.ok(stainedPaper > 220, 'ammo_issue_order should retain a paper order/voucher backing');
  assert.ok(codeMarks > 35, 'ammo_issue_order should include red/green/orange issue markings');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_9mm')), 'ammo_issue_order should not reuse the 9mm ammo icon');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('weapon_permit_signed')), 'ammo_issue_order should not reuse the weapon permit paper icon');
});

test('ammo_coupon_9mm sprite reads as a 9mm ammo voucher', () => {
  assert.equal(ITEMS.ammo_coupon_9mm?.name, 'Талон на 9мм');
  assert.equal(ITEMS.ammo_coupon_9mm?.type, ItemType.MISC);

  const sprite = generateItemSprite('ammo_coupon_9mm');
  const brass = countPixelsIn(sprite, 19, 17, 48, 49, (r, g, b, a) => a > 160 && r > 140 && g > 85 && g < 205 && b < 105 && r > g + 18);
  const stainedPaper = countPixelsIn(sprite, 13, 13, 51, 52, (r, g, b, a) => a > 130 && r > 130 && g > 115 && b > 75 && r > b + 30 && g > b + 20);
  const green9mmCode = countPixelsIn(sprite, 16, 23, 49, 45, (r, g, b, a) => a > 160 && g > 110 && r < 120 && b < 115);
  const darkCases = countPixelsIn(sprite, 18, 17, 49, 50, (r, g, b, a) => a > 150 && r < 90 && g < 85 && b < 75);

  assert.equal(sprite[0] >>> 24, 0, 'ammo_coupon_9mm sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 850, 'ammo_coupon_9mm should have a readable voucher-backed silhouette');
  assert.ok(brass > 120, 'ammo_coupon_9mm should show multiple brass 9mm cartridges');
  assert.ok(stainedPaper > 180, 'ammo_coupon_9mm should retain a chipped paper coupon backing');
  assert.ok(green9mmCode > 35, 'ammo_coupon_9mm should include a green 9mm code strip/stamp');
  assert.ok(darkCases > 80, 'ammo_coupon_9mm should include dark cartridge cases and ink cuts');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_9mm')), 'ammo_coupon_9mm should not reuse loose 9mm ammo art');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_coupon_shells')), 'ammo_coupon_9mm should differ from the shell coupon');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('weapon_permit_signed')), 'ammo_coupon_9mm should not reuse generic permit paper art');
});

test('12 gauge slug sprite reads as a distinct heavy shell', () => {
  const sprite = generateItemSprite('ammo_12g_slug');
  const hash = spriteHash(sprite);
  const brassCap = countPixelsIn(sprite, 24, 16, 40, 24, (r, g, b, a) => a > 180 && r > 145 && g > 95 && b < 115);
  const redBand = countPixelsIn(sprite, 25, 35, 39, 40, (r, g, b, a) => a > 180 && r > 135 && g < 100 && b < 90);

  assert.ok(opaquePixels(sprite) > 180, 'ammo_12g_slug should have a readable single-shell silhouette');
  assert.ok(brassCap > 35, 'ammo_12g_slug should show a brass slug cap');
  assert.ok(redBand > 25, 'ammo_12g_slug should show a red/orange identification band');
  assert.notEqual(hash, spriteHash(generateItemSprite('ammo_shells')), 'ammo_12g_slug should not reuse generic shells');
  assert.notEqual(hash, spriteHash(generateItemSprite('ammo_12g_chemical')), 'ammo_12g_slug should differ from chemical 12g ammo');
  assert.notEqual(hash, spriteHash(generateItemSprite('ammo_12g_incendiary')), 'ammo_12g_slug should differ from incendiary 12g ammo');
});

test('alkali powder sprite reads as a stained cleanup reagent packet', () => {
  const sprite = generateItemSprite('alkali_powder');
  const hash = spriteHash(sprite);

  assert.notEqual(hash, spriteHash(generateItemSprite('slime_sample_brown')));
  assert.notEqual(hash, spriteHash(generateItemSprite('decon_fluid')));
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 130 && g > 185 && r < 150 && b > 80) > 24, 'alkali powder needs a visible green-blue reagent glow');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 160 && r > 70 && r < 135 && g > 35 && g < 90 && b < 70) > 14, 'alkali powder needs a brown slime stain cue');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 180 && Math.abs(r - g) < 18 && Math.abs(g - b) < 30 && r > 105 && r < 205) > 120, 'alkali powder needs a readable grey paper packet body');
});

test('boiled slime residue sprite reads as a scorched anomaly sample jar', () => {
  assert.ok(ITEMS.boiled_slime_residue, 'boiled_slime_residue should stay registered');
  assert.equal(ITEMS.boiled_slime_residue.name, 'Вываренный остаток слизи');

  const sprite = generateItemSprite('boiled_slime_residue');
  const hash = spriteHash(sprite);
  const glassPixels = countPixels(sprite, (r, g, b, a) => a > 95 && a < 210 && r > 70 && r < 205 && g > r + 5 && b >= r - 4);
  const crustPixels = countPixels(sprite, (r, g, b, a) => a > 160 && r > 95 && r > g + 25 && g > 35 && g < 150 && b < 95);
  const hotGlowPixels = countPixels(sprite, (r, g, b, a) => a > 110 && (
    (g > 175 && r < 150 && b < 155) ||
    (b > 165 && r > 50 && r < 180 && g > 70 && g < 190) ||
    (r > 120 && b > 150 && g < 130)
  ));
  const eyeWhite = countPixelsIn(sprite, 27, 36, 39, 44, (r, g, b, a) => a > 170 && r > 185 && g > 185 && b > 150);
  const eyePupil = countPixelsIn(sprite, 31, 37, 35, 43, (r, g, b, a) => a > 170 && r < 40 && g < 55 && b < 45);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 430, 'boiled residue should have a readable jar silhouette');
  assert.ok(glassPixels > 95, 'boiled residue needs a translucent glass jar body');
  assert.ok(crustPixels > 95, 'boiled residue needs a dry brown scorched crust');
  assert.ok(hotGlowPixels > 22, 'boiled residue needs weak green/blue/violet anomaly glow');
  assert.ok(eyeWhite > 12, 'boiled residue should keep an eye-like bubble in the crust');
  assert.ok(eyePupil > 2, 'boiled residue should keep a dark bubble slit');
  assert.notEqual(hash, spriteHash(generateItemSprite('slime_sample_brown')), 'boiled residue should not reuse the generic brown slime sample');
  assert.notEqual(hash, spriteHash(generateItemSprite('alkali_powder')), 'boiled residue should not read as a reagent packet');
  assert.notEqual(hash, spriteHash(generateItemSprite('blue_glow_sample_sealed')), 'boiled residue should not reuse the sealed blue sample jar');
});

test('block kit sprite reads as a wall-block installer tool', () => {
  assert.ok(ITEMS.block_kit, 'block_kit should stay registered');
  assert.equal(ITEMS.block_kit.name, 'Комплект блока');
  assert.equal(ITEMS.block_kit.type, ItemType.TOOL);

  const sprite = generateItemSprite('block_kit');
  const concretePixels = countPixelsIn(sprite, 16, 15, 50, 47, (r, g, b, a) =>
    a > 170 && Math.abs(r - g) < 20 && Math.abs(g - b) < 24 && r > 80 && r < 190);
  const rubberPixels = countPixelsIn(sprite, 11, 34, 32, 52, (r, g, b, a) =>
    a > 170 && r < 70 && g < 80 && b < 80);
  const yellowStripe = countPixels(sprite, (r, g, b, a) =>
    a > 170 && r > 175 && g > 115 && g < 190 && b < 90);
  const cyanLead = countPixels(sprite, (r, g, b, a) =>
    a > 145 && g > 130 && b > 130 && b >= r + 45);

  assert.equal(sprite[0] >>> 24, 0, 'block_kit sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 280, 'block_kit should have enough visible block/tool mass');
  assert.ok(concretePixels > 170, 'block_kit should expose a grey concrete block cassette');
  assert.ok(rubberPixels > 35, 'block_kit should include a dark rubber handle');
  assert.ok(yellowStripe > 20, 'block_kit should include yellow hazard/service paint');
  assert.ok(cyanLead > 10, 'block_kit should include a cyan working cable or stamp');

  const hash = spriteHash(sprite);
  for (const id of ['door_kit', 'jackhammer', 'cleaning_kit', 'sealant_tube']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `block_kit should not reuse ${id} sprite language`);
  }
});

test('bundle 010 item sprites read as distinct cleanup, ration and confiscation objects', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['cleaning_kit', 'Чистящий комплект', ItemType.TOOL],
    ['cleanup_order_stub', 'Корешок приказа на зачистку', ItemType.MISC],
    ['cleanup_tongs', 'Санитарные щипцы', ItemType.TOOL],
    ['cloth_roll', 'Ткань', ItemType.MISC],
    ['concentrate_bonus_coupon', 'Премиальный талон концентрата', ItemType.MISC],
    ['concentrate_coupon', 'Талон на концентрат', ItemType.MISC],
    ['concrete_breaker_grenade', 'Бетонобойная граната', ItemType.WEAPON],
    ['confiscation_tag', 'Бирка конфиската', ItemType.MISC],
    ['confiscation_warrant', 'Ордер на изъятие', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 650, `${id} should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 010 sprites should not reuse each other exactly');

  const cleaningKit = generateItemSprite('cleaning_kit');
  assert.ok(countPixels(cleaningKit, (r, g, b, a) => a > 110 && b > 120 && g > 90 && b >= r + 25) > 90, 'cleaning_kit needs a cyan bottle/tool accent');
  assert.ok(countPixels(cleaningKit, (r, g, b, a) => a > 160 && r > 160 && g > 110 && g < 210 && b < 120) > 45, 'cleaning_kit needs yellow sponge/service paint');
  assert.notEqual(spriteHash(cleaningKit), spriteHash(generateItemSprite('block_kit')), 'cleaning_kit should differ from block kit tools');

  const orderStub = generateItemSprite('cleanup_order_stub');
  assert.ok(countPixels(orderStub, (r, g, b, a) => a > 160 && r > 150 && g > 125 && b > 70 && b < 170) > 360, 'cleanup_order_stub needs stained yellow paper mass');
  assert.ok(countPixels(orderStub, (r, g, b, a) => a > 160 && r > 140 && g < 90 && b < 90) > 80, 'cleanup_order_stub needs a red liquidator stamp');

  const tongs = generateItemSprite('cleanup_tongs');
  assert.ok(countPixels(tongs, (r, g, b, a) => a > 160 && Math.abs(r - g) < 22 && Math.abs(g - b) < 26 && r > 70 && r < 190) > 100, 'cleanup_tongs needs a steel tong silhouette');
  assert.ok(countPixels(tongs, (r, g, b, a) => a > 120 && g > 110 && r < 130 && b < 150) > 45, 'cleanup_tongs needs medical/sample green detail');

  const cloth = generateItemSprite('cloth_roll');
  assert.ok(countPixels(cloth, (r, g, b, a) => a > 160 && r > 130 && g > 125 && b > 105 && Math.abs(r - g) < 22) > 240, 'cloth_roll needs a grey cloth body');
  assert.ok(countPixels(cloth, (r, g, b, a) => a > 90 && b > 120 && b >= r + 25) > 35, 'cloth_roll keeps the weak blue-violet anomaly glow');

  const bonusCoupon = generateItemSprite('concentrate_bonus_coupon');
  const coupon = generateItemSprite('concentrate_coupon');
  assert.ok(countPixels(bonusCoupon, (r, g, b, a) => a > 120 && g > 110 && r < 130 && b < 150) > 120, 'bonus concentrate coupon needs green premium ration marks');
  assert.ok(countPixels(coupon, (r, g, b, a) => a > 160 && r > 140 && g < 90 && b < 90) > 90, 'ordinary concentrate coupon needs a red ration stamp');
  assert.notEqual(spriteHash(bonusCoupon), spriteHash(coupon), 'bonus and ordinary concentrate coupons should be visually separate');

  const grenade = generateItemSprite('concrete_breaker_grenade');
  assert.ok(countPixels(grenade, (r, g, b, a) => a > 160 && r < 60 && g < 70 && b < 70) > 300, 'concrete_breaker_grenade needs dark grenade mass');
  assert.ok(countPixels(grenade, (r, g, b, a) => a > 160 && r > 160 && g > 110 && g < 210 && b < 120) > 45, 'concrete_breaker_grenade needs hazard paint');
  assert.notEqual(spriteHash(grenade), spriteHash(generateItemSprite('grenade')), 'concrete_breaker_grenade should not reuse the generic grenade');

  const confiscationTag = generateItemSprite('confiscation_tag');
  const confiscationWarrant = generateItemSprite('confiscation_warrant');
  assert.ok(countPixels(confiscationTag, (r, g, b, a) => a > 160 && r > 140 && g < 90 && b < 90) > 240, 'confiscation_tag needs a red tag face');
  assert.ok(countPixels(confiscationWarrant, (r, g, b, a) => a > 160 && r > 150 && g > 125 && b > 70 && b < 170) > 440, 'confiscation_warrant needs official paper mass');
  assert.notEqual(spriteHash(orderStub), spriteHash(confiscationTag), 'liquidator paper and tag silhouettes should differ');
  assert.notEqual(spriteHash(orderStub), spriteHash(confiscationWarrant), 'cleanup order and confiscation warrant should differ');
});

test('bundle 018 item sprites read as distinct govnyak goods, green ration and weapons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['govnyak_bad_batch', 'Гремучая партия говняка', ItemType.MISC],
    ['govnyak_brick', 'Прессованный говняк', ItemType.MISC],
    ['govnyak_courier_package', 'Опечатанный пакет', ItemType.MISC],
    ['govnyak_roll', 'Говняк-самокрут', ItemType.MISC],
    ['govnyak_sample', 'Проба говняка НИИ', ItemType.MISC],
    ['granit4u_belt_shotgun', '«Гранит»-4у', ItemType.WEAPON],
    ['gravity_beam_emitter', 'Гравитационный лучевой излучатель', ItemType.WEAPON],
    ['green_briquette', 'Спецпай зелёный', ItemType.FOOD],
    ['grenade', 'Граната', ItemType.WEAPON],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 600, `${id} should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 018 sprites should not reuse each other exactly');

  const badBatch = generateItemSprite('govnyak_bad_batch');
  assert.ok(countPixels(badBatch, (r, g, b, a) => a > 140 && r > 130 && g < 95 && b < 90) > 70, 'bad govnyak batch needs red risk markings');
  assert.ok(countPixels(badBatch, (r, g, b, a) => a > 110 && g > 105 && r < 140 && b < 130) > 55, 'bad govnyak batch needs green wet bait leakage');
  assert.ok(countPixels(badBatch, (r, g, b, a) => a > 150 && r > 140 && g > 120 && b > 70 && b < 170) > 200, 'bad govnyak batch needs dirty paper wrapping');

  const brick = generateItemSprite('govnyak_brick');
  assert.ok(countPixels(brick, (r, g, b, a) => a > 150 && r > 80 && r < 180 && g > 45 && g < 125 && b < 80 && r > g + 20) > 250, 'govnyak_brick needs compressed brown briquette mass');
  assert.ok(countPixels(brick, (r, g, b, a) => a > 110 && g > 105 && r < 140 && b < 130) > 30, 'govnyak_brick needs a muted green contraband seam');

  const courierPackage = generateItemSprite('govnyak_courier_package');
  assert.ok(countPixels(courierPackage, (r, g, b, a) => a > 150 && r > 140 && g > 120 && b > 70 && b < 170) > 350, 'courier package needs a large sealed paper parcel');
  assert.ok(countPixels(courierPackage, (r, g, b, a) => a > 140 && r > 130 && g < 95 && b < 90) > 80, 'courier package needs a red seal/stamp');
  assert.ok(countPixels(courierPackage, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 250, 'courier package needs dark twine and outline pixels');

  const roll = generateItemSprite('govnyak_roll');
  assert.ok(countPixels(roll, (r, g, b, a) => a > 150 && r > 140 && g > 120 && b > 70 && b < 170) > 120, 'govnyak_roll needs dirty paper roll body');
  assert.ok(countPixels(roll, (r, g, b, a) => a > 140 && r > 130 && g < 95 && b < 90) > 25, 'govnyak_roll needs a red ember or end mark');

  const sample = generateItemSprite('govnyak_sample');
  assert.ok(countPixels(sample, (r, g, b, a) => a > 110 && g > 105 && r < 140 && b < 130) > 40, 'govnyak_sample needs green sealed sample contents');
  assert.ok(countPixels(sample, (r, g, b, a) => a > 140 && r > 130 && g < 95 && b < 90) > 50, 'govnyak_sample needs red NII seals');
  assert.ok(countPixels(sample, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 140, 'govnyak_sample needs dark cap/outline mass');

  const granit = generateItemSprite('granit4u_belt_shotgun');
  assert.ok(countPixels(granit, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 420, 'granit4u should have heavy black-blue weapon mass');
  assert.ok(countPixels(granit, (r, g, b, a) => a > 150 && r > 150 && g > 95 && g < 190 && b < 95) > 120, 'granit4u should show a visible shell belt');
  assert.ok(countPixels(granit, (r, g, b, a) => a > 140 && r > 130 && g < 95 && b < 90) > 80, 'granit4u should include red shotgun shell hulls');

  const gbe = generateItemSprite('gravity_beam_emitter');
  assert.ok(countPixels(gbe, (r, g, b, a) => a > 110 && g > 140 && b > 140 && b >= r + 40) > 150, 'gravity beam emitter needs cyan beam hardware glow');
  assert.ok(countPixels(gbe, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 250, 'gravity beam emitter needs dark NET weapon casing');
  assert.notEqual(spriteHash(gbe), spriteHash(generateItemSprite('gauss')), 'gravity beam emitter should not reuse the gauss rifle icon');

  const green = generateItemSprite('green_briquette');
  assert.ok(countPixels(green, (r, g, b, a) => a > 110 && g > 105 && r < 140 && b < 130) > 100, 'green_briquette needs a strong green ration block');
  assert.ok(countPixels(green, (r, g, b, a) => a > 150 && r > 140 && g > 120 && b > 70 && b < 170) > 250, 'green_briquette needs dirty ration wrapping');

  const grenade = generateItemSprite('grenade');
  assert.ok(countPixels(grenade, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 300, 'grenade needs compact dark segmented body');
  assert.ok(countPixels(grenade, (r, g, b, a) => a > 110 && g > 70 && g > r && b < 95) > 50, 'grenade needs green RGD body panels');
  assert.notEqual(spriteHash(grenade), spriteHash(generateItemSprite('concrete_breaker_grenade')), 'ordinary grenade should differ from concrete breaker grenade');
});

test('bundle 021 item sprites read as distinct mushroom, office, medicine and tool objects', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['infected_mushroom', 'Заражённый гриб', ItemType.FOOD],
    ['ink_bottle', 'Чернила', ItemType.MISC],
    ['inspection_mirror', 'Смотровое зеркальце', ItemType.MISC],
    ['instant_coffee', 'Кофе растворимый', ItemType.DRINK],
    ['iodine', 'Йод', ItemType.MEDICINE],
    ['ip4_gasmask', 'Противогаз ИП-4', ItemType.TOOL],
    ['istotit_candle', 'Истотитная свеча', ItemType.MEDICINE],
    ['jackhammer', 'Отбойный молоток', ItemType.TOOL],
    ['junior_tech_case', 'Корпус «Юный техник»', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 021 sprites should not reuse each other exactly');

  const mushroom = generateItemSprite('infected_mushroom');
  assert.ok(countPixels(mushroom, (r, g, b, a) => a > 130 && g > 85 && g >= r - 20 && b < 130) > 120, 'infected_mushroom needs a green fungal cap/body read');
  assert.ok(countPixels(mushroom, (r, g, b, a) => a > 130 && r > 130 && g < 95 && b < 90) > 10, 'infected_mushroom needs red risky spots');

  const ink = generateItemSprite('ink_bottle');
  assert.ok(countPixels(ink, (r, g, b, a) => a > 150 && r < 55 && g < 65 && b < 85) > 170, 'ink_bottle needs dark ink/glass mass');
  assert.ok(countPixels(ink, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 70 && b < 165) > 55, 'ink_bottle needs a dirty paper label');

  const mirror = generateItemSprite('inspection_mirror');
  assert.ok(countPixels(mirror, (r, g, b, a) => a > 140 && g > 120 && b > 120 && b >= r) > 45, 'inspection_mirror needs a cool reflective face');
  assert.ok(countPixelsIn(mirror, 14, 36, 30, 53, (r, g, b, a) => a > 150 && r > 50 && r < 110 && g > 35 && g < 90 && b < 75) > 25, 'inspection_mirror needs a visible handle');

  const coffee = generateItemSprite('instant_coffee');
  assert.ok(countPixels(coffee, (r, g, b, a) => a > 130 && r > 55 && r < 135 && g > 30 && g < 95 && b < 70) > 50, 'instant_coffee needs dark brown coffee granules');
  assert.ok(countPixels(coffee, (r, g, b, a) => a > 150 && r > 150 && g > 95 && g < 180 && b < 90) > 45, 'instant_coffee needs an ochre service label');

  const iodine = generateItemSprite('iodine');
  assert.ok(countPixels(iodine, (r, g, b, a) => a > 140 && r > 105 && g > 45 && g < 125 && b < 75) > 110, 'iodine needs an amber bottle body');
  assert.ok(countPixels(iodine, (r, g, b, a) => a > 150 && r > 140 && g < 90 && b < 90) > 60, 'iodine needs a red medical cross');

  const gasmask = generateItemSprite('ip4_gasmask');
  assert.ok(countPixels(gasmask, (r, g, b, a) => a > 150 && r < 70 && g < 85 && b < 85) > 240, 'ip4_gasmask needs dark rubber mask mass');
  assert.ok(countPixels(gasmask, (r, g, b, a) => a > 140 && g > 120 && b > 115 && b >= r + 20) > 25, 'ip4_gasmask needs readable glass lenses');

  const candle = generateItemSprite('istotit_candle');
  assert.ok(countPixels(candle, (r, g, b, a) => a > 140 && r > 170 && g > 130 && b < 120) > 70, 'istotit_candle needs wax/gold candle body');
  assert.ok(countPixels(candle, (r, g, b, a) => a > 100 && b > 130 && r > 80 && g < 130) > 20, 'istotit_candle needs weak violet ritual glow');

  const jackhammer = generateItemSprite('jackhammer');
  assert.ok(countPixels(jackhammer, (r, g, b, a) => a > 150 && Math.abs(r - g) < 24 && Math.abs(g - b) < 28 && r > 70 && r < 190) > 110, 'jackhammer needs steel tool mass');
  assert.ok(countPixels(jackhammer, (r, g, b, a) => a > 150 && r > 160 && g > 105 && g < 190 && b < 90) > 20, 'jackhammer needs yellow service paint');

  const juniorCase = generateItemSprite('junior_tech_case');
  assert.ok(countPixels(juniorCase, (r, g, b, a) => a > 150 && r > 135 && g > 130 && b > 110 && Math.abs(r - g) < 35) > 180, 'junior_tech_case needs a pale plastic electronics case');
  assert.ok(countPixels(juniorCase, (r, g, b, a) => a > 120 && g > 140 && b > 130 && b >= r + 45) > 15, 'junior_tech_case needs cyan dead pixels');
});

test('bundle 019 item sprites read as distinct ration, GUSL papers, parts and weapons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['grey_briquette', 'Концентрат-беляк', ItemType.FOOD],
    ['grn420_gravizhernov', 'Гравижернов ГРН-420', ItemType.WEAPON],
    ['gunstock', 'Приклад', ItemType.MISC],
    ['gusl_index_fragment', 'Обрывок ГУСЛ', ItemType.MISC],
    ['gusl_index_page', 'Страница индекса ГУСЛ', ItemType.NOTE],
    ['hammer', 'Молоток', ItemType.WEAPON],
    ['harpoon_gun', 'Гарпун', ItemType.WEAPON],
    ['hazard_shift_extension', 'Допуск на сверхсмену', ItemType.MISC],
    ['heating_element', 'Нагревательный элемент', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 600, `${id} should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 019 sprites should not reuse each other exactly');

  const grey = generateItemSprite('grey_briquette');
  assert.ok(countPixels(grey, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 55 && b < 180) > 300, 'grey_briquette needs dirty pale ration wrapping');
  assert.ok(countPixels(grey, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 50, 'grey_briquette needs a red ration stamp');
  assert.ok(countPixels(grey, (r, g, b, a) => a > 90 && g > 105 && r < 145 && b < 150) > 15, 'grey_briquette needs a small green damp concentrate stain');
  assert.notEqual(spriteHash(grey), spriteHash(generateItemSprite('green_briquette')), 'grey_briquette should differ from green_briquette');

  const gravizhernov = generateItemSprite('grn420_gravizhernov');
  assert.ok(countPixels(gravizhernov, (r, g, b, a) => a > 90 && g > 140 && b > 135 && r < 150) > 80, 'grn420_gravizhernov needs cyan gravity hardware glow');
  assert.ok(countPixels(gravizhernov, (r, g, b, a) => a > 140 && r < 75 && g < 90 && b < 95) > 700, 'grn420_gravizhernov needs a heavy dark weapon body');
  assert.ok(countPixels(gravizhernov, (r, g, b, a) => a > 130 && r > 160 && g > 105 && g < 190 && b < 100) > 35, 'grn420_gravizhernov needs yellow service markings');
  assert.notEqual(spriteHash(gravizhernov), spriteHash(generateItemSprite('bfg')), 'grn420_gravizhernov should not reuse the BFG icon');
  assert.notEqual(spriteHash(gravizhernov), spriteHash(generateItemSprite('gravity_beam_emitter')), 'grn420_gravizhernov should not reuse the gravity beam emitter icon');

  const stock = generateItemSprite('gunstock');
  assert.ok(countPixels(stock, (r, g, b, a) => a > 140 && r > 70 && g > 35 && g < 115 && b < 80 && r > g + 18) > 300, 'gunstock needs a wooden stock silhouette');
  assert.ok(countPixels(stock, (r, g, b, a) => a > 140 && Math.abs(r - g) < 32 && Math.abs(g - b) < 44 && r > 70 && r < 190) > 50, 'gunstock needs a metal collar');
  assert.ok(countPixels(stock, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 70, 'gunstock needs a red trade/service tag');
  assert.notEqual(spriteHash(stock), spriteHash(generateItemSprite('barrel_part')), 'gunstock should differ from the barrel part');

  const fragment = generateItemSprite('gusl_index_fragment');
  assert.ok(countPixels(fragment, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 55 && b < 180) > 280, 'gusl_index_fragment needs torn yellowed paper mass');
  assert.ok(countPixels(fragment, (r, g, b, a) => a > 120 && b > r + 18 && g >= r && r < 120) > 80, 'gusl_index_fragment needs a blue weapon schematic cue');
  assert.ok(countPixels(fragment, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 90, 'gusl_index_fragment needs a red fragment mark');

  const page = generateItemSprite('gusl_index_page');
  assert.ok(countPixels(page, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 55 && b < 180) > 450, 'gusl_index_page needs full official paper mass');
  assert.ok(countPixels(page, (r, g, b, a) => a > 120 && b > r + 18 && g >= r && r < 120) > 45, 'gusl_index_page needs a blue index schematic');
  assert.ok(countPixels(page, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 100, 'gusl_index_page needs a red archive stamp');
  assert.notEqual(spriteHash(fragment), spriteHash(page), 'GUSL fragment and full page should differ');

  const hammer = generateItemSprite('hammer');
  assert.ok(countPixels(hammer, (r, g, b, a) => a > 140 && Math.abs(r - g) < 32 && Math.abs(g - b) < 44 && r > 70 && r < 190) > 50, 'hammer needs a steel head');
  assert.ok(countPixels(hammer, (r, g, b, a) => a > 130 && r > 70 && g > 30 && g < 115 && b < 85 && r > g + 12) > 150, 'hammer needs a wooden handle');
  assert.ok(countPixels(hammer, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 70, 'hammer needs a red grip or service mark');
  assert.notEqual(spriteHash(hammer), spriteHash(generateItemSprite('sledgehammer')), 'hammer should differ from sledgehammer');
  assert.notEqual(spriteHash(hammer), spriteHash(generateItemSprite('axe')), 'hammer should differ from axe');

  const harpoon = generateItemSprite('harpoon_gun');
  assert.ok(countPixels(harpoon, (r, g, b, a) => a > 140 && r < 75 && g < 90 && b < 95) > 400, 'harpoon_gun needs a long dark weapon body');
  assert.ok(countPixels(harpoon, (r, g, b, a) => a > 90 && g > 140 && b > 135 && r < 150) > 50, 'harpoon_gun needs a cyan tank/cable cue');
  assert.ok(countPixels(harpoon, (r, g, b, a) => a > 130 && r > 160 && g > 105 && g < 190 && b < 100) > 40, 'harpoon_gun needs yellow industrial markings');
  assert.notEqual(spriteHash(harpoon), spriteHash(generateItemSprite('ammo_harpoon')), 'harpoon_gun should differ from loose harpoon ammo');

  const hazard = generateItemSprite('hazard_shift_extension');
  assert.ok(countPixels(hazard, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 55 && b < 180) > 300, 'hazard_shift_extension needs yellowed permit paper');
  assert.ok(countPixels(hazard, (r, g, b, a) => a > 130 && r > 160 && g > 105 && g < 190 && b < 100) > 220, 'hazard_shift_extension needs yellow hazard stripe mass');
  assert.ok(countPixels(hazard, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 200, 'hazard_shift_extension needs a red overwork stamp');

  const heating = generateItemSprite('heating_element');
  assert.ok(countPixels(heating, (r, g, b, a) => a > 120 && r > 160 && g > 70 && g < 175 && b < 100 && r > g + 25) > 140, 'heating_element needs copper coil loops');
  assert.ok(countPixels(heating, (r, g, b, a) => a > 90 && g > 140 && b > 135 && r < 150) > 80, 'heating_element needs a cyan heat/electric glow');
  assert.ok(countPixels(heating, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 115) > 20, 'heating_element needs pale ceramic plugs');
  assert.notEqual(spriteHash(heating), spriteHash(generateItemSprite('boiler_water')), 'heating_element should differ from boiler water');
});

test('bundle 013 item sprites read as distinct route, repair, lift and shelter objects', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['diver_route_tag', 'Бирка водолазного маршрута', ItemType.MISC],
    ['door_kit', 'Комплект двери', ItemType.TOOL],
    ['duct_tape', 'Изолента', ItemType.MISC],
    ['easter_egg', 'Пасхальное яйцо', ItemType.FOOD],
    ['electrode_pack', 'Электроды', ItemType.MISC],
    ['elevator_access_order', 'Ордер доступа к лифту', ItemType.MISC],
    ['elevator_override_form', 'Бланк обхода лифта', ItemType.MISC],
    ['emergency_roster', 'Список укрытия', ItemType.MISC],
    ['empty_roks_tank', 'Пустой ранцевый бак', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 013 sprites should not reuse each other exactly');

  const diverTag = generateItemSprite('diver_route_tag');
  assert.ok(countPixels(diverTag, (r, g, b, a) => a > 165 && r > 130 && g > 80 && g < 190 && b < 110) > 160, 'diver_route_tag needs a brass tag body');
  assert.ok(countPixels(diverTag, (r, g, b, a) => a > 130 && b > 110 && g > 90 && r < 100) > 10, 'diver_route_tag needs a wet blue route mark');

  const doorKit = generateItemSprite('door_kit');
  assert.ok(countPixels(doorKit, (r, g, b, a) => a > 160 && Math.abs(r - g) < 24 && Math.abs(g - b) < 30 && r > 70 && r < 180) > 160, 'door_kit needs a grey metal door cassette');
  assert.ok(countPixels(doorKit, (r, g, b, a) => a > 160 && r > 170 && g > 110 && g < 190 && b < 90) > 20, 'door_kit needs yellow service paint');
  assert.ok(countPixels(doorKit, (r, g, b, a) => a > 140 && g > 130 && b > 130 && b >= r + 40) > 8, 'door_kit needs a cyan work lead');
  assert.notEqual(spriteHash(doorKit), spriteHash(generateItemSprite('block_kit')), 'door_kit should differ from block_kit');

  const ductTape = generateItemSprite('duct_tape');
  assert.ok(countPixels(ductTape, (r, g, b, a) => a > 160 && r < 100 && g < 115 && b < 120) > 190, 'duct_tape needs a dark tape roll and strip');
  assert.ok(countPixelsIn(ductTape, 24, 27, 36, 37, (r, g, b, a) => a > 160 && r < 95 && g < 110 && b < 115) > 45, 'duct_tape needs a readable central roll hole');

  const egg = generateItemSprite('easter_egg');
  assert.ok(countPixels(egg, (r, g, b, a) => a > 170 && r > 160 && g > 130 && b > 80 && b < 180) > 230, 'easter_egg needs a pale painted egg body');
  assert.ok(countPixels(egg, (r, g, b, a) => a > 150 && ((r > 140 && g < 95 && b < 95) || (g > 105 && r < 110 && b < 125) || (b > 125 && g > 90 && r < 110))) > 60, 'easter_egg needs red, green and blue paint bands');
  assert.ok(countPixelsIn(egg, 28, 20, 38, 47, (r, g, b, a) => a > 170 && r < 70 && g < 60 && b < 55) > 8, 'easter_egg needs a dark cracked shell mark');

  const electrodes = generateItemSprite('electrode_pack');
  assert.ok(countPixels(electrodes, (r, g, b, a) => a > 160 && Math.abs(r - g) < 26 && Math.abs(g - b) < 32 && r > 100 && r < 220) > 100, 'electrode_pack needs exposed steel rods');
  assert.ok(countPixels(electrodes, (r, g, b, a) => a > 160 && r > 130 && g > 85 && g < 185 && b < 115) > 170, 'electrode_pack needs an ochre sleeve');
  assert.ok(countPixels(electrodes, (r, g, b, a) => a > 140 && g > 130 && b > 130 && b >= r + 35) > 5, 'electrode_pack needs small cyan welding tips');

  const accessOrder = generateItemSprite('elevator_access_order');
  assert.ok(countPixels(accessOrder, (r, g, b, a) => a > 160 && r > 150 && g > 120 && b > 70 && b < 170) > 420, 'elevator_access_order needs official yellow paper mass');
  assert.ok(countPixels(accessOrder, (r, g, b, a) => a > 160 && r > 140 && g < 90 && b < 90) > 40, 'elevator_access_order needs a red official seal');
  assert.ok(countPixels(accessOrder, (r, g, b, a) => a > 140 && b > 100 && g > 80 && r < 90) > 14, 'elevator_access_order needs a blue lift glyph');

  const overrideForm = generateItemSprite('elevator_override_form');
  assert.ok(countPixels(overrideForm, (r, g, b, a) => a > 160 && r > 150 && g > 120 && b > 70 && b < 170) > 390, 'elevator_override_form needs a stained service form');
  assert.ok(countPixels(overrideForm, (r, g, b, a) => a > 150 && r > 130 && g < 95 && b < 95) > 25, 'elevator_override_form needs a red bypass route');
  assert.notEqual(spriteHash(accessOrder), spriteHash(overrideForm), 'lift access order and bypass form should differ');

  const roster = generateItemSprite('emergency_roster');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 160 && r > 150 && g > 125 && b > 85 && b < 175) > 420, 'emergency_roster needs paper roster mass');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 120 && r < 70 && g < 70 && b < 65) > 100, 'emergency_roster needs many dark list lines');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 95) > 35, 'emergency_roster needs red shelter/emergency marks');

  const roksTank = generateItemSprite('empty_roks_tank');
  assert.ok(countPixels(roksTank, (r, g, b, a) => a > 160 && Math.abs(r - g) < 24 && Math.abs(g - b) < 30 && r > 70 && r < 180) > 180, 'empty_roks_tank needs a grey metal backpack tank');
  assert.ok(countPixels(roksTank, (r, g, b, a) => a > 150 && r > 135 && g < 90 && b < 85) > 40, 'empty_roks_tank needs a red liquidator band');
  assert.ok(countPixels(roksTank, (r, g, b, a) => a > 160 && r < 60 && g < 65 && b < 65) > 70, 'empty_roks_tank needs dark straps and hose');

  const drop: Entity = {
    id: 13013,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [{ defId: 'easter_egg', count: 2 }],
  };
  assert.equal(itemDropDefId(drop), 'easter_egg', 'bundle 013 world drops should resolve visuals from item payload');
});

test('sealed blue glow sample sprite reads as a hermetic blue anomaly ampoule', () => {
  assert.ok(ITEMS.blue_glow_sample_sealed, 'blue_glow_sample_sealed should stay registered');
  assert.equal(ITEMS.blue_glow_sample_sealed.name, 'Герметичный синий образец');
  assert.equal(ITEMS.blue_glow_sample_sealed.type, ItemType.MISC);

  const sprite = generateItemSprite('blue_glow_sample_sealed');
  const hash = spriteHash(sprite);
  const blueLiquid = countPixelsIn(sprite, 24, 26, 41, 47, (r, g, b, a) => a > 170 && b > 170 && b > r + 65 && g > 90);
  const redSeal = countPixels(sprite, (r, g, b, a) => a > 170 && r > 135 && g < 85 && b < 95);
  const paperLabel = countPixelsIn(sprite, 22, 29, 43, 38, (r, g, b, a) => a > 180 && r > 160 && g > 135 && b > 85 && b < 165);
  const eyeBubble = countPixelsIn(sprite, 27, 36, 39, 44, (r, g, b, a) => a > 180 && r > 175 && g > 190 && b > 175);

  assert.equal(sprite[0] >>> 24, 0, 'sealed sample sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 480, 'sealed sample should have a readable glass ampoule silhouette');
  assert.ok(blueLiquid > 115, 'sealed sample needs a visible blue sample core');
  assert.ok(redSeal > 24, 'sealed sample needs red hermetic seals');
  assert.ok(paperLabel > 55, 'sealed sample needs a stained NII label band');
  assert.ok(eyeBubble > 12, 'sealed sample needs a small eye-like anomaly bubble');
  assert.notEqual(hash, spriteHash(generateItemSprite('blue_glow_sample_open')), 'sealed sample should differ from the opened sample');
  assert.notEqual(hash, spriteHash(generateItemSprite('slime_sample_blue')), 'sealed sample should not reuse the blue slime sample icon');
});

test('opened blue glow sample sprite reads as a broken contaminated anomaly jar', () => {
  assert.ok(ITEMS.blue_glow_sample_open, 'blue_glow_sample_open should stay registered');
  assert.equal(ITEMS.blue_glow_sample_open.name, 'Открытый синий образец');
  assert.equal(ITEMS.blue_glow_sample_open.type, ItemType.MISC);

  const sprite = generateItemSprite('blue_glow_sample_open');
  const hash = spriteHash(sprite);
  const blueLiquid = countPixelsIn(sprite, 24, 33, 41, 49, (r, g, b, a) => a > 150 && b > 150 && b > r + 45 && g > 80);
  const darkOpenMouth = countPixelsIn(sprite, 23, 19, 42, 26, (r, g, b, a) => a > 170 && r < 45 && g < 55 && b < 75);
  const spill = countPixelsIn(sprite, 39, 45, 55, 54, (r, g, b, a) => a > 80 && b > 100 && g > 65 && b > r + 35);
  const eyeBubble = countPixelsIn(sprite, 29, 38, 39, 46, (r, g, b, a) => a > 170 && r > 170 && g > 185 && b > 170);
  const brokenGlass = countPixelsIn(sprite, 15, 13, 48, 22, (r, g, b, a) => a > 150 && g > 150 && b > 150 && Math.abs(g - b) < 55);

  assert.equal(sprite[0] >>> 24, 0, 'opened sample sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 470, 'opened sample should have a readable broken jar silhouette');
  assert.ok(blueLiquid > 105, 'opened sample needs visible blue contaminated liquid');
  assert.ok(darkOpenMouth > 45, 'opened sample needs a dark open mouth instead of a sealed cap');
  assert.ok(spill > 18, 'opened sample needs a small leaked blue stain');
  assert.ok(eyeBubble > 10, 'opened sample needs an eye-like anomaly bubble');
  assert.ok(brokenGlass > 18, 'opened sample needs chipped glass around the opened top');
  assert.notEqual(hash, spriteHash(generateItemSprite('blue_glow_sample_sealed')), 'opened sample should differ from the sealed sample');
  assert.notEqual(hash, spriteHash(generateItemSprite('slime_sample_blue')), 'opened sample should not reuse the blue slime sample icon');
});

test('sprite bundle 042 slime samples read as distinct sealed anomaly jars', () => {
  const expected: readonly [string, string][] = [
    ['slime_sample_black', 'Проба чёрной слизи'],
    ['slime_sample_blue', 'Проба голубой слизи'],
    ['slime_sample_brown', 'Проба коричневой слизи'],
    ['slime_sample_contaminated', 'Заражённая проба слизи'],
    ['slime_sample_fake', 'Поддельная проба слизи'],
    ['slime_sample_green', 'Проба зелёной слизи'],
    ['slime_sample_red', 'Проба красной слизи'],
    ['slime_sample_seroburmaline', 'Проба серобурмалиновой слизи'],
  ];
  const hashes = new Set<number>();

  for (const [id, name] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, ItemType.MISC);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 470, `${id} should have enough jar mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 042 slime samples should not share exact sprite hashes');

  const drop: Entity = {
    id: 42042,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'slime_sample_fake', count: 0 },
      { defId: 'slime_sample_blue', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'slime_sample_blue', 'bundle 042 world drops should resolve visuals from positive item payload');

  const black = generateItemSprite('slime_sample_black');
  assert.ok(countPixels(black, (r, g, b, a) => a > 150 && r < 55 && g < 55 && b < 75) > 150, 'black slime sample should show a dark mass');
  assert.ok(countPixelsIn(black, 28, 36, 40, 44, (r, g, b, a) => a > 150 && b > 100 && r > 55 && g < 115) > 12, 'black slime sample should include a purple eye-like bubble');

  const blue = generateItemSprite('slime_sample_blue');
  assert.ok(countPixels(blue, (r, g, b, a) => a > 120 && b > 165 && g > 110 && r < 145) > 115, 'blue slime sample should show cyan electric liquid');
  assert.ok(countPixels(blue, (r, g, b, a) => a > 120 && b > 170 && g > 150 && r < 125) > 20, 'blue slime sample should include bright electric marks');

  const brown = generateItemSprite('slime_sample_brown');
  assert.ok(countPixels(brown, (r, g, b, a) => a > 130 && r > 75 && r > g + 18 && g > 35 && g < 125 && b < 80) > 120, 'brown slime sample should show muddy toxic residue');
  assert.ok(countPixels(brown, (r, g, b, a) => a > 90 && g > 145 && r < 145 && b < 130) > 4, 'brown slime sample should carry a weak toxic cleanup cue');

  const contaminated = generateItemSprite('slime_sample_contaminated');
  assert.ok(countPixels(contaminated, (r, g, b, a) => a > 120 && r > 140 && g < 90 && b < 95) > 28, 'contaminated sample should show a red crooked warning seal');
  assert.ok(countPixelsIn(contaminated, 39, 45, 55, 54, (_r, _g, _b, a) => a > 70) > 20, 'contaminated sample should show a small leak/spill');

  const fake = generateItemSprite('slime_sample_fake');
  assert.ok(countPixels(fake, (r, g, b, a) => a > 130 && r > 120 && g > 65 && g < 190 && b < 105) > 120, 'fake slime sample should show tea-and-starch amber liquid');
  assert.ok(countPixels(fake, (r, g, b, a) => a > 120 && r > 145 && g < 95 && b < 95) > 40, 'fake slime sample should show counterfeit red slash marks');

  const green = generateItemSprite('slime_sample_green');
  assert.ok(countPixels(green, (r, g, b, a) => a > 110 && g > 155 && r < 160 && b < 150) > 150, 'green slime sample should show acid green liquid and spill');
  assert.ok(countPixelsIn(green, 38, 32, 49, 44, (r, g, b, a) => a > 70 && g > 150 && r < 150) > 20, 'green slime sample should include an acid bite outside the label');

  const red = generateItemSprite('slime_sample_red');
  assert.ok(countPixels(red, (r, g, b, a) => a > 115 && r > 135 && g < 100 && b < 105) > 165, 'red slime sample should show red adhesive mass');
  assert.ok(countPixelsIn(red, 21, 35, 48, 51, (r, g, b, a) => a > 90 && r > 135 && g < 105) > 90, 'red slime sample should include sticky strand marks');

  const seroburmaline = generateItemSprite('slime_sample_seroburmaline');
  assert.ok(countPixels(seroburmaline, (r, g, b, a) => a > 90 && b > 135 && r > 80 && g < 150) > 55, 'seroburmaline sample should show purple/blue void glow');
  assert.ok(countPixelsIn(seroburmaline, 28, 36, 39, 43, (_r, _g, _b, a) => a > 120) > 42, 'seroburmaline sample should keep a no-look eye-like core');
});

test('antibiotic sprite reads as a dirty medical blister packet', () => {
  assert.ok(ITEMS.antibiotic, 'antibiotic should stay registered');
  assert.equal(ITEMS.antibiotic.name, 'Антибиотик');

  const sprite = generateItemSprite('antibiotic');
  const hash = spriteHash(sprite);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 450, 'antibiotic should have a readable sealed packet silhouette');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 170 && r > 140 && g < 90 && b < 90) > 32, 'antibiotic needs a red medical mark');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 150 && g > 120 && r < 160 && b > 85 && b < 190) > 90, 'antibiotic needs green capsule/blister glass');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 170 && Math.abs(r - g) < 22 && r > 155 && r < 245 && b > 130 && b < 215) > 180, 'antibiotic needs a dirty off-white packet body');
  assert.notEqual(hash, spriteHash(generateItemSprite('pills')), 'antibiotic should not reuse the generic tablet icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('sanitary_kit')), 'antibiotic should differ from the generic triage kit icon');
});

test('bandage sprite reads as a dusty loose medical roll', () => {
  assert.ok(ITEMS.bandage, 'bandage should stay registered');
  assert.equal(ITEMS.bandage.name, 'Бинт');
  assert.equal(ITEMS.bandage.type, ItemType.MEDICINE);

  const sprite = generateItemSprite('bandage');
  const hash = spriteHash(sprite);
  const dirtyCloth = countPixels(sprite, (r, g, b, a) =>
    a > 155 && Math.abs(r - g) < 34 && Math.abs(g - b) < 48 && r > 145 && r < 248 && b > 118);
  const redCross = countPixelsIn(sprite, 33, 28, 50, 39, (r, g, b, a) =>
    a > 170 && r > 135 && g < 85 && b < 85);
  const rollCore = countPixelsIn(sprite, 18, 30, 31, 42, (r, g, b, a) =>
    a > 150 && r < 125 && g < 130 && b < 125);
  const wrapLines = countPixelsIn(sprite, 12, 27, 41, 45, (r, g, b, a) =>
    a > 75 && a < 170 && r < 120 && g < 130 && b < 120);
  const dampStain = countPixels(sprite, (r, g, b, a) =>
    a > 70 && a < 175 && g >= r - 8 && g > 70 && b < 115 && r < 135);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 430, 'bandage should have a readable loose roll and cloth strip mass');
  assert.ok(dirtyCloth > 210, 'bandage needs dirty off-white cloth pixels');
  assert.ok(redCross > 55, 'bandage needs a red medical cross on the loose strip');
  assert.ok(rollCore > 28, 'bandage needs a visible roll core');
  assert.ok(wrapLines > 20, 'bandage needs wrap seams across the cloth');
  assert.ok(dampStain > 14, 'bandage needs damp/rust survival-horror staining');
  assert.notEqual(hash, spriteHash(generateItemSprite('sterile_bandage')), 'bandage should not reuse the sterile bandage icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('cotton_wool')), 'bandage should not collapse to cotton wool');
  assert.notEqual(hash, spriteHash(generateItemSprite('body_bag_roll')), 'bandage should not reuse the body bag roll icon');
});

test('body bag roll sprite reads as a sanitary folded vinyl roll', () => {
  assert.ok(ITEMS.body_bag_roll, 'body_bag_roll should stay registered');
  assert.equal(ITEMS.body_bag_roll.name, 'Рулон мешков для тел');

  const sprite = generateItemSprite('body_bag_roll');
  const hash = spriteHash(sprite);
  const vinyl = countPixels(sprite, (r, g, b, a) => a > 160 && Math.abs(r - g) < 26 && Math.abs(g - b) < 38 && r > 145 && r < 246 && b > 125);
  const medicalMark = countPixels(sprite, (r, g, b, a) => a > 170 && r > 130 && g < 92 && b < 92);
  const darkRollCore = countPixelsIn(sprite, 40, 25, 52, 44, (r, g, b, a) => a > 170 && r < 95 && g < 102 && b < 96);
  const dampStain = countPixels(sprite, (r, g, b, a) => a > 70 && a < 175 && g >= r - 8 && g > 70 && b < 115 && r < 130);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 560, 'body_bag_roll should have a readable roll mass');
  assert.ok(vinyl > 260, 'body_bag_roll needs dirty off-white vinyl body pixels');
  assert.ok(medicalMark > 75, 'body_bag_roll needs a red medical cross/label');
  assert.ok(darkRollCore > 35, 'body_bag_roll needs a dark hollow roll core');
  assert.ok(dampStain > 20, 'body_bag_roll needs green damp cleanup staining');
  assert.notEqual(hash, spriteHash(generateItemSprite('bandage')), 'body_bag_roll should not reuse the bandage roll icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('sanitary_kit')), 'body_bag_roll should differ from the generic medical kit icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('corpse_number_tag')), 'body_bag_roll should differ from corpse paperwork');
});

test('antifungal ointment sprite reads as a dirty green-capped medicine tube', () => {
  assert.ok(ITEMS.antifungal_ointment, 'antifungal_ointment should stay registered');
  assert.equal(ITEMS.antifungal_ointment.name, 'Противогрибковая мазь');
  assert.equal(ITEMS.antifungal_ointment.type, ItemType.MEDICINE);
  assert.ok(ITEMS.antifungal_ointment.tags?.includes('fungus_counterplay'), 'antifungal_ointment should keep fungus counterplay tag');

  const sprite = generateItemSprite('antifungal_ointment');
  const hash = spriteHash(sprite);
  const redMedicalMark = countPixelsIn(sprite, 24, 30, 39, 41, (r, g, b, a) => a > 170 && r > 135 && g < 85 && b < 85);
  const greenCapAndSlime = countPixels(sprite, (r, g, b, a) => a > 120 && g > 115 && r < 155 && b < 140);
  const dirtyTube = countPixels(sprite, (r, g, b, a) => a > 170 && Math.abs(r - g) < 28 && r > 145 && r < 245 && b > 115 && b < 215);
  const diagonalTube = countPixelsIn(sprite, 13, 23, 53, 46, (_r, _g, _b, a) => a > 150);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 320, 'antifungal ointment should have a readable tube silhouette');
  assert.ok(diagonalTube > 230, 'antifungal ointment should read as a squeeze tube, not a square packet');
  assert.ok(redMedicalMark > 50, 'antifungal ointment should include a red medical mark');
  assert.ok(greenCapAndSlime > 55, 'antifungal ointment should include a green cap or antifungal slime cue');
  assert.ok(dirtyTube > 120, 'antifungal ointment should keep a dirty off-white medicine body');
  assert.notEqual(hash, spriteHash(generateItemSprite('antibiotic')), 'antifungal ointment should not reuse the antibiotic packet');
  assert.notEqual(hash, spriteHash(generateItemSprite('anti_spore_inhaler')), 'antifungal ointment should differ from the inhaler silhouette');
  assert.notEqual(hash, spriteHash(generateItemSprite('pills')), 'antifungal ointment should not collapse to generic pills');
});

test('antiemetic sprite reads as a dirty anti-nausea medicine packet', () => {
  assert.ok(ITEMS.antiemetic, 'antiemetic should stay registered');
  assert.equal(ITEMS.antiemetic.name, 'Противорвотное');
  assert.equal(ITEMS.antiemetic.type, ItemType.MEDICINE);
  assert.ok(ITEMS.antiemetic.tags?.includes('nausea'), 'antiemetic should keep its nausea tag');

  const sprite = generateItemSprite('antiemetic');
  const hash = spriteHash(sprite);
  const redCross = countPixelsIn(sprite, 22, 22, 42, 40, (r, g, b, a) => a > 170 && r > 135 && g < 85 && b < 85);
  const nauseaGreen = countPixelsIn(sprite, 36, 22, 48, 45, (r, g, b, a) => a > 145 && g > 125 && r < 145 && b > 75 && b < 170);
  const dirtyPacket = countPixels(sprite, (r, g, b, a) => a > 170 && Math.abs(r - g) < 28 && r > 150 && r < 245 && b > 120 && b < 215);
  const stains = countPixels(sprite, (r, g, b, a) => a > 80 && a < 170 && g >= r - 20 && r > 60 && r < 150 && b < 120);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 520, 'antiemetic should have a readable packet silhouette');
  assert.ok(redCross > 85, 'antiemetic should keep a clear red medical cross');
  assert.ok(nauseaGreen > 35, 'antiemetic should include a green anti-nausea cue');
  assert.ok(dirtyPacket > 220, 'antiemetic should use a dirty off-white medicine packet body');
  assert.ok(stains > 18, 'antiemetic should show damp/stained survival wear');
  assert.notEqual(hash, spriteHash(generateItemSprite('antibiotic')), 'antiemetic should not reuse the antibiotic packet');
  assert.notEqual(hash, spriteHash(generateItemSprite('anti_spore_inhaler')), 'antiemetic should not reuse the inhaler icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('pills')), 'antiemetic should not collapse to generic pills');
});

test('anti-spore inhaler sprite reads as respiratory medicine', () => {
  assert.ok(ITEMS.anti_spore_inhaler, 'anti_spore_inhaler should stay registered');
  assert.equal(ITEMS.anti_spore_inhaler.name, 'Противоспоровый ингалятор');

  const sprite = generateItemSprite('anti_spore_inhaler');
  const hash = spriteHash(sprite);
  const paleBody = countPixels(sprite, (r, g, b, a) => a > 190 && r > 170 && g > 170 && b > 145 && Math.abs(r - g) < 35);
  const redMedicalMark = countPixelsIn(sprite, 29, 31, 43, 44, (r, g, b, a) => a > 180 && r > 145 && g < 85 && b < 85);
  const greenDoseWindow = countPixelsIn(sprite, 24, 30, 38, 42, (r, g, b, a) => a > 150 && g > 130 && g > r + 30 && g > b + 10);
  const mouthpiece = countPixelsIn(sprite, 47, 30, 60, 38, (r, g, b, a) => a > 180 && r > 55 && r < 225 && g > 55 && b > 45);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 560, 'anti_spore_inhaler should have a readable inhaler mass');
  assert.ok(rowOpaquePixels(sprite, 35) > rowOpaquePixels(sprite, 15) + 16, 'body should read wider than the cap');
  assert.ok(paleBody > 280, 'anti_spore_inhaler should keep a dirty white medical body');
  assert.ok(redMedicalMark > 42, 'anti_spore_inhaler should include a red medical mark');
  assert.ok(greenDoseWindow > 36, 'anti_spore_inhaler should include a green respiratory dose window');
  assert.ok(mouthpiece > 40, 'anti_spore_inhaler should include a side mouthpiece/nozzle');
  assert.notEqual(hash, spriteHash(generateItemSprite('morphine_ampoule')), 'anti_spore_inhaler should not reuse the generic ampoule silhouette');
  assert.notEqual(hash, spriteHash(generateItemSprite('antibiotic')), 'anti_spore_inhaler should differ from packet medicine');
});

test('antidep sprite reads as a worn psi medicine blister card', () => {
  assert.ok(ITEMS.antidep, 'antidep should stay registered');
  assert.equal(ITEMS.antidep.name, 'Антидепрессант');

  const sprite = generateItemSprite('antidep');
  const hash = spriteHash(sprite);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 600, 'antidep should have a readable blister-card silhouette');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 170 && r > 135 && g < 85 && b < 85) > 35, 'antidep needs a red medical mark');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 130 && g > 120 && r < 160 && b > 85 && b < 190) > 80, 'antidep needs green tablet blisters');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 170 && Math.abs(r - g) < 26 && r > 155 && r < 245 && b > 130 && b < 220) > 220, 'antidep needs a dirty off-white medicine packet body');
  assert.notEqual(hash, spriteHash(generateItemSprite('pills')), 'antidep should not reuse the generic pills icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('antibiotic')), 'antidep should differ from the antibiotic packet');
  assert.notEqual(hash, spriteHash(generateItemSprite('anti_spore_inhaler')), 'antidep should differ from the inhaler silhouette');
});

test('bundle 029 item sprites keep distinct weapon, document, food and medicine reads', () => {
  const ids = [
    'party_might_launcher',
    'party_portrait_pin',
    'passport_stub',
    'pbrog1_foam_launcher',
    'pearl_barley',
    'permanent_pass',
    'permanganate_vial',
    'personal_file_copy',
    'pills',
  ] as const;
  for (const id of ids) {
    assert.ok(ITEMS[id], `${id} should stay registered`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have a readable icon silhouette`);
  }

  assert.equal(ITEMS.party_might_launcher.name, 'Подствольник «Мощь партии»');
  assert.equal(ITEMS.pbrog1_foam_launcher.name, 'ПБРОГ-1');
  assert.equal(ITEMS.pearl_barley.name, 'Перловка в банке');
  assert.equal(ITEMS.permanganate_vial.name, 'Марганцовка');
  assert.equal(ITEMS.pills.name, 'Таблетки');

  const hashes = ids.map(id => spriteHash(generateItemSprite(id)));
  assert.equal(new Set(hashes).size, ids.length, 'bundle 029 sprites should be item-distinct');
});

test('bundle 029 weapon sprites separate party grenade hardware from disposable foam gear', () => {
  const party = generateItemSprite('party_might_launcher');
  const foam = generateItemSprite('pbrog1_foam_launcher');

  const partyBlueMetal = countPixels(party, (r, g, b, a) => a > 170 && r < 115 && g >= r && b > r + 8);
  const partyServiceMarks = countPixels(party, (r, g, b, a) => a > 170 && r > 170 && g > 105 && b < 95);
  const partyRedSeals = countPixels(party, (r, g, b, a) => a > 170 && r > 135 && g < 90 && b < 80);
  const partyLowerTube = countPixelsIn(party, 30, 36, 61, 45, (_r, _g, _b, a) => a > 150);

  const foamCyan = countPixels(foam, (r, g, b, a) => a > 130 && g > 145 && b > 120 && r < 175);
  const foamServiceMarks = countPixels(foam, (r, g, b, a) => a > 170 && r > 170 && g > 105 && b < 95);
  const foamDisposableLabel = countPixelsIn(foam, 35, 40, 45, 45, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 80 && b < 170);

  assert.ok(opaquePixels(party) > 300, 'party_might_launcher should have a heavy diagonal launcher mass');
  assert.ok(partyBlueMetal > 85, 'party_might_launcher should use black/blue weapon metal');
  assert.ok(partyServiceMarks > 18, 'party_might_launcher should show yellow service paint');
  assert.ok(partyRedSeals > 18, 'party_might_launcher should show red party/liquidator seals');
  assert.ok(partyLowerTube > 120, 'party_might_launcher should show a second underbarrel tube');

  assert.ok(opaquePixels(foam) > 285, 'pbrog1_foam_launcher should have a readable launcher mass');
  assert.ok(foamCyan > 60, 'pbrog1_foam_launcher should show foam charge color');
  assert.ok(foamServiceMarks > 10, 'pbrog1_foam_launcher should include service paint');
  assert.ok(foamDisposableLabel > 12, 'pbrog1_foam_launcher should include a disposable paper label');

  assert.notEqual(spriteHash(party), spriteHash(foam), 'party and foam launchers should not share an icon');
  assert.notEqual(spriteHash(party), spriteHash(generateItemSprite('g41_grenade_launcher')), 'party launcher should differ from the mounted G41');
  assert.notEqual(spriteHash(foam), spriteHash(generateItemSprite('brt2_foam_projector')), 'PБРОГ-1 should differ from the reusable BRT-2');
  assert.notEqual(spriteHash(foam), spriteHash(generateItemSprite('foam_grenade_6p10')), 'PБРОГ-1 should not collapse to a foam grenade');
});

test('bundle 029 bureaucracy sprites read as pin, passport stub, permanent pass and personal file', () => {
  const pin = generateItemSprite('party_portrait_pin');
  const passport = generateItemSprite('passport_stub');
  const permanent = generateItemSprite('permanent_pass');
  const file = generateItemSprite('personal_file_copy');

  const pinRedEnamel = countPixels(pin, (r, g, b, a) => a > 170 && r > 120 && g < 85 && b < 80);
  const pinBrass = countPixels(pin, (r, g, b, a) => a > 160 && r > 165 && g > 110 && g < 215 && b < 110);
  const pinPortrait = countPixelsIn(pin, 25, 27, 38, 43, (r, g, b, a) => a > 150 && r > 170 && g > 135 && b > 80 && b < 170);

  const passportCover = countPixels(passport, (r, g, b, a) => a > 160 && r > 65 && r > g + 22 && g < 85 && b < 90);
  const passportPaper = countPixels(passport, (r, g, b, a) => a > 160 && r > 160 && g > 140 && b > 85 && b < 180);
  const passportStamp = countPixels(passport, (r, g, b, a) => a > 160 && r > 135 && g < 80 && b < 75);

  const permanentGreen = countPixels(permanent, (r, g, b, a) => a > 160 && g > r + 20 && g > b - 20 && r < 160 && b < 135);
  const permanentRed = countPixels(permanent, (r, g, b, a) => a > 160 && r > 135 && g < 85 && b < 75);
  const permanentPortrait = countPixelsIn(permanent, 18, 26, 31, 42, (r, g, b, a) => a > 140 && r > 130 && g > 110 && b > 70 && b < 170);

  const fileFolder = countPixels(file, (r, g, b, a) => a > 160 && r > 115 && g > 80 && g < 190 && b < 120);
  const filePortrait = countPixelsIn(file, 22, 31, 32, 43, (r, g, b, a) => a > 130 && r > 55 && r < 155 && g > 55 && g < 155 && b > 45 && b < 140);
  const fileRedMark = countPixels(file, (r, g, b, a) => a > 140 && r > 125 && g < 85 && b < 75);

  assert.ok(pinRedEnamel > 120, 'party_portrait_pin should be dominated by red enamel');
  assert.ok(pinBrass > 75, 'party_portrait_pin should have brass badge rim/highlights');
  assert.ok(pinPortrait > 35, 'party_portrait_pin should include a readable portrait silhouette');
  assert.ok(passportCover > 80, 'passport_stub should include a burgundy passport cover fragment');
  assert.ok(passportPaper > 160, 'passport_stub should include torn yellow paper');
  assert.ok(passportStamp > 18, 'passport_stub should include a red stamp');
  assert.ok(permanentGreen > 150, 'permanent_pass should read as a green permanent pass card');
  assert.ok(permanentRed > 18, 'permanent_pass should include red official stamp/seal');
  assert.ok(permanentPortrait > 35, 'permanent_pass should include an identity portrait block');
  assert.ok(fileFolder > 220, 'personal_file_copy should read as an ochre archive folder');
  assert.ok(filePortrait > 24, 'personal_file_copy should include a personal record portrait block');
  assert.ok(fileRedMark > 18, 'personal_file_copy should include red archive marks');

  assert.notEqual(spriteHash(pin), spriteHash(generateItemSprite('liquidator_token')), 'party pin should differ from liquidator tokens');
  assert.notEqual(spriteHash(passport), spriteHash(permanent), 'passport stub should differ from permanent pass');
  assert.notEqual(spriteHash(file), spriteHash(generateItemSprite('passport_stub')), 'personal file copy should differ from passport stub');
});

test('bundle 029 consumable sprites read as barley can, purple reagent vial and common pills', () => {
  const barley = generateItemSprite('pearl_barley');
  const permanganate = generateItemSprite('permanganate_vial');
  const pillsSprite = generateItemSprite('pills');

  const barleyMetal = countPixels(barley, (r, g, b, a) => a > 160 && Math.abs(r - g) < 26 && Math.abs(g - b) < 34 && r > 70 && r < 185);
  const barleyGrain = countPixels(barley, (r, g, b, a) => a > 145 && r > 150 && g > 115 && b > 65 && b < 165);
  const barleyGreenLabel = countPixels(barley, (r, g, b, a) => a > 150 && g > 90 && g > r - 30 && r < 135 && b < 105);

  const purpleFluid = countPixels(permanganate, (r, g, b, a) => a > 150 && b > r + 20 && r > 75 && g < 115);
  const greenGlass = countPixels(permanganate, (r, g, b, a) => a > 100 && g > 130 && b > 115 && r < 185);
  const vialRedCross = countPixelsIn(permanganate, 24, 30, 41, 39, (r, g, b, a) => a > 170 && r > 135 && g < 90 && b < 90);

  const pillFoil = countPixels(pillsSprite, (r, g, b, a) => a > 170 && Math.abs(r - g) < 30 && r > 145 && r < 245 && b > 120 && b < 220);
  const pillRedCross = countPixelsIn(pillsSprite, 21, 21, 32, 32, (r, g, b, a) => a > 170 && r > 135 && g < 90 && b < 90);
  const tabletPixels = countPixelsIn(pillsSprite, 20, 33, 45, 47, (r, g, b, a) => a > 160 && r > 120 && g > 130 && b > 110);

  assert.ok(barleyMetal > 150, 'pearl_barley should show a metal can');
  assert.ok(barleyGrain > 65, 'pearl_barley should expose pale grain through a torn label');
  assert.ok(barleyGreenLabel > 15, 'pearl_barley should include a dull green ration label');
  assert.ok(purpleFluid > 75, 'permanganate_vial should show purple medicine/reagent fluid');
  assert.ok(greenGlass > 60, 'permanganate_vial should show greenish glass');
  assert.ok(vialRedCross > 35, 'permanganate_vial should include a red medical cross label');
  assert.ok(pillFoil > 210, 'pills should show a dirty foil blister card');
  assert.ok(pillRedCross > 35, 'pills should include a red medical cross');
  assert.ok(tabletPixels > 95, 'pills should show individual tablets/blisters');

  assert.notEqual(spriteHash(barley), spriteHash(generateItemSprite('canned')), 'pearl_barley should not reuse generic canned food');
  assert.notEqual(spriteHash(permanganate), spriteHash(generateItemSprite('iodine')), 'permanganate should differ from iodine');
  assert.notEqual(spriteHash(pillsSprite), spriteHash(generateItemSprite('antidep')), 'pills should differ from antidep');
  assert.notEqual(spriteHash(pillsSprite), spriteHash(generateItemSprite('antibiotic')), 'pills should differ from antibiotic');
});

test('alcohol bottle sprite has a narrow bottle silhouette and warning label', () => {
  assert.ok(ITEMS.alcohol_bottle, 'alcohol_bottle should stay registered');
  assert.equal(ITEMS.alcohol_bottle.name, 'Спирт');

  const sprite = generateItemSprite('alcohol_bottle');
  const redLabel = countPixels(sprite, (r, g, b, a) => a > 180 && r > 120 && g < 90 && b < 90);
  const ochreTag = countPixels(sprite, (r, g, b, a) => a > 150 && r > 140 && g > 90 && g < 170 && b < 95);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 180, 'alcohol_bottle should have enough visible pixels');
  assert.ok(rowOpaquePixels(sprite, 36) > rowOpaquePixels(sprite, 16) + 8, 'body should read wider than the neck');
  assert.ok(redLabel > 60, 'alcohol_bottle should keep a dull red label block');
  assert.ok(ochreTag > 16, 'alcohol_bottle should keep an ochre tag/accent');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('rubber_strip')), 'alcohol_bottle should not collapse to a generic misc/repair silhouette');
});

test('acid bottle sprite reads as unlabeled industrial acid', () => {
  assert.ok(ITEMS.acid_bottle, 'acid_bottle should stay registered');
  assert.equal(ITEMS.acid_bottle.name, 'Кислота');

  const sprite = generateItemSprite('acid_bottle');
  const redLabel = countPixels(sprite, (r, g, b, a) => a > 170 && r > 110 && g < 90 && b < 90);
  const ochreLiquid = countPixels(sprite, (r, g, b, a) => a > 150 && r > 115 && g > 90 && g < 185 && b < 100);
  const dampStain = countPixels(sprite, (r, g, b, a) => a > 80 && a < 150 && g >= r && b < 95);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 190, 'acid_bottle should have enough visible pixels');
  assert.ok(rowOpaquePixels(sprite, 38) > rowOpaquePixels(sprite, 16) + 10, 'acid_bottle should read as a wide bottle body under a narrow neck');
  assert.ok(redLabel > 45, 'acid_bottle should keep a dull red hazard label');
  assert.ok(ochreLiquid > 70, 'acid_bottle should show dirty ochre liquid');
  assert.ok(dampStain > 12, 'acid_bottle should include a muted damp stain/slime film');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('alcohol_bottle')), 'acid_bottle should not reuse the alcohol bottle icon');
});

test('boiler water sprite reads as a hot cloudy drink bottle', () => {
  assert.ok(ITEMS.boiler_water, 'boiler_water should stay registered');
  assert.equal(ITEMS.boiler_water.name, 'Кипяток');
  assert.equal(ITEMS.boiler_water.type, ItemType.DRINK);

  const sprite = generateItemSprite('boiler_water');
  const liquid = countPixelsIn(sprite, 23, 34, 42, 50, (r, g, b, a) => a > 150 && g > 135 && b > 130 && g > r + 35 && b > r + 45);
  const hotLabel = countPixelsIn(sprite, 24, 27, 42, 35, (r, g, b, a) => a > 170 && r > 130 && g < 105 && b < 90);
  const scaleMarks = countPixels(sprite, (r, g, b, a) => a > 120 && r > 165 && g > 155 && b > 105 && b < 230);
  const steamPixels = countPixelsIn(sprite, 20, 5, 45, 17, (r, g, b, a) => a > 80 && a < 180 && r > 170 && g > 185 && b > 170);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 260, 'boiler_water should have a readable bottle mass');
  assert.ok(rowOpaquePixels(sprite, 39) > rowOpaquePixels(sprite, 15) + 10, 'boiler_water should read as a wide bottle under a narrow hot neck');
  assert.ok(liquid > 75, 'boiler_water should show cyan-green hot water through the bottle');
  assert.ok(hotLabel > 45, 'boiler_water should include a warm warning label');
  assert.ok(scaleMarks > 24, 'boiler_water should carry pale kettle-scale marks');
  assert.ok(steamPixels > 12, 'boiler_water should include light steam wisps');

  const hash = spriteHash(sprite);
  for (const id of ['water', 'filtered_water', 'metal_water', 'tea', 'kompot']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `boiler_water should not reuse ${id} drink language`);
  }
});

test('empty bottle sprite reads as reusable clear kitchen glass', () => {
  assert.ok(ITEMS.bottle_empty, 'bottle_empty should stay registered');
  assert.equal(ITEMS.bottle_empty.name, 'Бутылка');
  assert.equal(ITEMS.bottle_empty.type, ItemType.MISC);

  const sprite = generateItemSprite('bottle_empty');
  const hash = spriteHash(sprite);
  const glass = countPixelsIn(sprite, 22, 24, 43, 52, (_r, _g, _b, a) => a > 80 && a < 190);
  const highlights = countPixelsIn(sprite, 24, 10, 42, 49, (r, g, b, a) => a > 100 && r > 120 && g > 170 && b > 155);
  const label = countPixels(sprite, (r, g, b, a) => a > 150 && r > 130 && g > 90 && g < 195 && b < 120);
  const darkOutline = countPixels(sprite, (r, g, b, a) => a > 130 && r < 65 && g < 80 && b < 75);

  assert.equal(sprite[0] >>> 24, 0, 'bottle_empty sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 430, 'bottle_empty should have a readable bottle silhouette');
  assert.ok(glass > 260, 'bottle_empty should be mostly translucent glass, not a filled sample jar');
  assert.ok(highlights > 80, 'bottle_empty should show pale glass highlights');
  assert.ok(label > 80, 'bottle_empty should include a worn kitchen label');
  assert.ok(darkOutline > 90, 'bottle_empty should retain a readable dark outline');
  for (const id of ['boiler_water', 'water', 'alcohol_bottle', 'boiled_slime_residue']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `bottle_empty should not reuse ${id} sprite language`);
  }
});

test('book sprite reads as a worn red-brown trade book', () => {
  assert.ok(ITEMS.book, 'book should stay registered');
  assert.equal(ITEMS.book.name, 'Книга');

  const sprite = generateItemSprite('book');
  const hash = spriteHash(sprite);
  const cover = countPixels(sprite, (r, g, b, a) => a > 150 && r > 85 && r > g + 20 && g < 105 && b < 90);
  const pages = countPixels(sprite, (r, g, b, a) => a > 150 && r > 155 && g > 135 && b > 90 && b < 190);
  const spine = countPixelsIn(sprite, 15, 16, 25, 54, (r, g, b, a) => a > 150 && r > 80 && r > g + 20 && g < 105 && b < 90);
  const pageRows = countPixelsIn(sprite, 27, 22, 45, 45, (r, g, b, a) => a > 90 && r < 70 && g < 70 && b < 70);

  assert.equal(sprite[0] >>> 24, 0, 'book sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 900, 'book should have a readable closed-book mass');
  assert.ok(cover > 300, 'book should show a worn red-brown cover');
  assert.ok(pages > 100, 'book should show yellowed paper pages');
  assert.ok(spine > 80, 'book should have a strong side spine silhouette');
  assert.ok(pageRows > 90, 'book should include dark page/title row marks');
  for (const id of ['note', 'blank_form', 'card_deck']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `book should not reuse ${id} sprite language`);
  }
});

test('borrowed kitchen key sprite reads as a brass key with a false tag', () => {
  assert.ok(ITEMS.borrowed_kitchen_key, 'borrowed_kitchen_key should stay registered');
  assert.equal(ITEMS.borrowed_kitchen_key.name, 'Заёмный кухонный ключ');

  const sprite = generateItemSprite('borrowed_kitchen_key');
  const hash = spriteHash(sprite);
  const brass = countPixels(sprite, (r, g, b, a) => a > 150 && r > 130 && g > 85 && g < 200 && b < 100);
  const tag = countPixelsIn(sprite, 22, 39, 43, 56, (r, g, b, a) => a > 140 && r > 145 && g > 125 && b > 80 && b < 180);
  const ringHole = countPixelsIn(sprite, 15, 25, 25, 37, (r, g, b, a) => a > 170 && r < 50 && g < 55 && b < 50);
  const teeth = countPixelsIn(sprite, 43, 29, 55, 43, (_r, _g, _b, a) => a > 140);

  assert.equal(sprite[0] >>> 24, 0, 'borrowed_kitchen_key sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 520, 'borrowed_kitchen_key should have readable key-and-tag mass');
  assert.ok(brass > 180, 'borrowed_kitchen_key should show brass key metal');
  assert.ok(tag > 60, 'borrowed_kitchen_key should include a paper kitchen tag');
  assert.ok(ringHole > 25, 'borrowed_kitchen_key should keep the key ring hole readable');
  assert.ok(teeth > 60, 'borrowed_kitchen_key should show the shaft and teeth');
  for (const id of ['key', 'container_key_label', 'bottle_empty']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `borrowed_kitchen_key should not reuse ${id} sprite language`);
  }
});

test('bottled voice sprite reads as a sealed psi jar with sound inside', () => {
  assert.ok(ITEMS.bottled_voice, 'bottled_voice should stay registered');
  assert.equal(ITEMS.bottled_voice.name, 'Голос в банке');

  const sprite = generateItemSprite('bottled_voice');
  const hash = spriteHash(sprite);
  const glass = countPixels(sprite, (r, g, b, a) => a > 80 && a < 190 && g > 90 && b > 85);
  const psiGlow = countPixels(sprite, (r, g, b, a) => a > 70 && b > 145 && g > 100 && r < 190);
  const soundLines = countPixelsIn(sprite, 25, 24, 43, 47, (r, g, b, a) => a > 90 && b > 145 && g > 90 && r < 190);
  const redSeal = countPixelsIn(sprite, 25, 9, 40, 19, (r, g, b, a) => a > 170 && r > 120 && g < 90 && b < 100);
  const eyeWhite = countPixelsIn(sprite, 27, 36, 40, 45, (r, g, b, a) => a > 170 && r > 185 && g > 185 && b > 150);
  const eyePupil = countPixelsIn(sprite, 31, 38, 35, 44, (r, g, b, a) => a > 170 && r < 40 && g < 50 && b < 60);

  assert.equal(sprite[0] >>> 24, 0, 'bottled_voice sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 900, 'bottled_voice should have a readable sealed jar mass');
  assert.ok(glass > 180, 'bottled_voice should keep a translucent jar body');
  assert.ok(psiGlow > 120, 'bottled_voice should show purple-blue psi glow');
  assert.ok(soundLines > 70, 'bottled_voice should show internal sound-wave strokes');
  assert.ok(redSeal > 15, 'bottled_voice should include a sealed cap mark');
  assert.ok(eyeWhite > 20, 'bottled_voice should keep a rare eye-like motif');
  assert.ok(eyePupil > 2, 'bottled_voice should keep a dark eye slit');
  for (const id of ['siren_shard', 'void_spike', 'blue_glow_sample_sealed']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `bottled_voice should not reuse ${id} sprite language`);
  }
});

test('ballot sprite reads as a pre-marked dirty election paper', () => {
  assert.ok(ITEMS.ballot, 'ballot should stay registered');
  assert.equal(ITEMS.ballot.name, 'Бюллетень');
  assert.equal(ITEMS.ballot.type, ItemType.MISC);

  const sprite = generateItemSprite('ballot');
  const hash = spriteHash(sprite);
  const paper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 140 && r < 235 && g > 120 && g < 225 && b > 85 && b < 190 && r >= g - 12);
  const redMark = countPixelsIn(sprite, 21, 21, 47, 48, (r, g, b, a) => a > 150 && r > 125 && g < 95 && b < 85);
  const checkboxInk = countPixelsIn(sprite, 20, 21, 36, 34, (r, g, b, a) => a > 80 && r < 90 && g < 85 && b < 75);
  const ochreTag = countPixelsIn(sprite, 47, 21, 54, 32, (r, g, b, a) => a > 150 && r > 135 && g > 80 && g < 170 && b < 90);
  const dampStain = countPixelsIn(sprite, 17, 44, 37, 54, (r, g, b, a) => a > 70 && a < 150 && g >= r && b < 110);

  assert.equal(sprite[0] >>> 24, 0, 'ballot sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 760, 'ballot should have a readable torn paper silhouette');
  assert.ok(paper > 520, 'ballot should be dominated by dirty ochre paper');
  assert.ok(redMark > 38, 'ballot should include a dull red pre-mark and stamp');
  assert.ok(checkboxInk > 28, 'ballot should expose a boxed voting field');
  assert.ok(ochreTag > 20, 'ballot should include a small side tag');
  assert.ok(dampStain > 10, 'ballot should include a damp lower stain');
  assert.notEqual(hash, spriteHash(generateItemSprite('blank_form')), 'ballot should not reuse the blank form icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('note')), 'ballot should not collapse to the generic note icon');
  assert.notEqual(hash, spriteHash(generateItemSprite('forged_ration_card')), 'ballot should not reuse ration-card document language');
});

test('blank form sprite reads as an empty stamped paper form', () => {
  assert.ok(ITEMS.blank_form, 'blank_form should stay registered');
  assert.equal(ITEMS.blank_form.name, 'Пустой бланк');
  assert.equal(ITEMS.blank_form.type, ItemType.MISC);

  const sprite = generateItemSprite('blank_form');
  const paper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 145 && r < 235 && g > 125 && g < 225 && b > 90 && b < 190 && r >= g - 10);
  const redStamp = countPixelsIn(sprite, 32, 36, 47, 45, (r, g, b, a) => a > 150 && r > 120 && g < 90 && b < 80);
  const blankField = countPixelsIn(sprite, 21, 22, 43, 33, (r, g, b, a) => a > 150 && r > 160 && g > 140 && b > 100);
  const darkFormLines = countPixelsIn(sprite, 20, 21, 44, 48, (r, g, b, a) => a > 70 && r < 90 && g < 85 && b < 75);
  const ochreTag = countPixelsIn(sprite, 14, 20, 22, 30, (r, g, b, a) => a > 150 && r > 135 && g > 85 && g < 165 && b < 85);
  const dampStain = countPixelsIn(sprite, 18, 42, 36, 53, (r, g, b, a) => a > 70 && a < 150 && g >= r && b < 110);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 520, 'blank_form should have a readable paper silhouette');
  assert.ok(paper > 520, 'blank_form should be dominated by dirty ochre paper');
  assert.ok(redStamp > 20, 'blank_form should include a dull red stamp cue');
  assert.ok(blankField > 80, 'blank_form should expose an empty form field');
  assert.ok(darkFormLines > 25, 'blank_form should include form ruling and chipped edges');
  assert.ok(ochreTag > 18, 'blank_form should include a small ochre side tag');
  assert.ok(dampStain > 10, 'blank_form should include a damp stain');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('temp_pass')), 'blank_form should not reuse pass icon language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('card_deck')), 'blank_form should not collapse to card/deck icon language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('lift_scheme')), 'blank_form should not reuse route document icon language');
});

test('barrel part sprite reads as a raw rusty weapon barrel blank', () => {
  assert.ok(ITEMS.barrel_part, 'barrel_part should stay registered');
  assert.equal(ITEMS.barrel_part.name, 'Заготовка ствола');

  const sprite = generateItemSprite('barrel_part');
  const wornMetal = countPixels(sprite, (r, g, b, a) => a > 150 && Math.abs(r - g) < 28 && Math.abs(g - b) < 36 && r > 65 && r < 180);
  const rustyEdge = countPixels(sprite, (r, g, b, a) => a > 135 && r > 100 && r > g + 30 && g > 35 && g < 95 && b < 70);
  const ochreStamp = countPixels(sprite, (r, g, b, a) => a > 160 && r > 145 && g > 90 && g < 165 && b < 80);
  const boreDark = countPixels(sprite, (r, g, b, a) => a > 170 && r < 45 && g < 48 && b < 48);

  assert.equal(sprite[0] >>> 24, 0, 'barrel_part sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 220, 'barrel_part should have a readable diagonal tube mass');
  assert.ok(wornMetal > 70, 'barrel_part should visibly use worn steel colors');
  assert.ok(rustyEdge > 70, 'barrel_part should include rusty cut edges and speckling');
  assert.ok(ochreStamp > 20, 'barrel_part should include an industrial ochre inspection stamp');
  assert.ok(boreDark > 35, 'barrel_part should show dark hollow barrel openings');

  const hash = spriteHash(sprite);
  for (const id of ['magazine_part', 'metal_sheet', 'rubber_strip']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `barrel_part should not reuse ${id} repair/material sprite language`);
  }
});

test('asbestos cord sprite reads as a stiff dusty repair cord coil', () => {
  assert.ok(ITEMS.asbestos_cord, 'asbestos_cord should stay registered');
  assert.equal(ITEMS.asbestos_cord.name, 'Асбестовая верёвка');
  assert.equal(ITEMS.asbestos_cord.type, ItemType.MISC);

  const sprite = generateItemSprite('asbestos_cord');
  const dustyFiber = countPixels(sprite, (r, g, b, a) => (
    a > 150 && r > 115 && r < 230 && g > 105 && g < 220 && b > 75 && b < 190 && Math.abs(r - g) < 35
  ));
  const rustClamp = countPixels(sprite, (r, g, b, a) => (
    a > 120 && r > 110 && r > g + 30 && g > 35 && g < 115 && b < 80
  ));
  const darkCoilHole = countPixelsIn(sprite, 23, 29, 38, 41, (r, g, b, a) => a > 150 && r < 90 && g < 90 && b < 80);
  const stiffTail = countPixelsIn(sprite, 39, 21, 56, 35, (r, g, b, a) => (
    a > 140 && r > 110 && g > 90 && b < 160
  ));

  assert.equal(sprite[0] >>> 24, 0, 'asbestos_cord sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 520, 'asbestos_cord should have a readable coil-and-tail silhouette');
  assert.ok(dustyFiber > 250, 'asbestos_cord should be dominated by dusty pale fiber');
  assert.ok(rustClamp > 35, 'asbestos_cord should include a rusty repair clamp');
  assert.ok(darkCoilHole > 25, 'asbestos_cord should show the dark center of a cord coil');
  assert.ok(stiffTail > 30, 'asbestos_cord should include a stiff loose cord tail');

  const hash = spriteHash(sprite);
  for (const id of ['sealant_tube', 'hermetic_tape', 'rubber_strip', 'wire_coil']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `asbestos_cord should not reuse ${id} repair/material sprite language`);
  }
});

test('bundle 007 consumable sprites read as distinct food, drink, and medicine items', () => {
  assert.equal(ITEMS.braga_bucket?.name, 'Ведро браги');
  assert.equal(ITEMS.bread?.name, 'Хлеб');
  assert.equal(ITEMS.burn_gel?.name, 'Противоожоговый гель');
  assert.equal(ITEMS.calm_brew?.name, 'Успокоительный отвар');
  assert.equal(ITEMS.canned?.name, 'Тушёнка');
  assert.equal(ITEMS.bread?.type, ItemType.FOOD);
  assert.equal(ITEMS.canned?.type, ItemType.FOOD);
  assert.equal(ITEMS.burn_gel?.type, ItemType.MEDICINE);
  assert.equal(ITEMS.calm_brew?.type, ItemType.DRINK);

  const braga = generateItemSprite('braga_bucket');
  const bread = generateItemSprite('bread');
  const burnGel = generateItemSprite('burn_gel');
  const calmBrew = generateItemSprite('calm_brew');
  const canned = generateItemSprite('canned');

  for (const [id, sprite] of Object.entries({ braga_bucket: braga, bread, burn_gel: burnGel, calm_brew: calmBrew, canned })) {
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 850, `${id} should have enough mass for a world drop and inventory icon`);
  }

  assert.ok(
    countPixelsIn(braga, 20, 24, 46, 50, (r, g, b, a) => a > 120 && g > 130 && b > 90 && r < 135) > 90,
    'braga_bucket should expose green-cyan fermenting liquid inside a bucket',
  );
  assert.ok(
    countPixelsIn(bread, 16, 25, 48, 49, (r, g, b, a) => a > 160 && r > 100 && g > 60 && g < 180 && b < 120) > 330,
    'bread should read as an ochre stale ration loaf',
  );
  assert.ok(
    countPixelsIn(burnGel, 15, 17, 56, 46, (r, g, b, a) => a > 130 && g > 150 && b > 140 && r < 160) > 100,
    'burn_gel should show cold cyan gel',
  );
  assert.ok(
    countPixelsIn(calmBrew, 24, 32, 40, 43, (r, g, b, a) => a > 160 && r > 130 && g < 90 && b < 90) > 60,
    'calm_brew should keep a red medical mark on the mug',
  );
  assert.ok(
    countPixelsIn(canned, 18, 20, 48, 49, (r, g, b, a) => a > 160 && r > 80 && r < 190 && g > 80 && g < 195 && b > 70 && b < 180) > 200,
    'canned should read as a metal ration tin',
  );
  assert.equal(new Set([braga, bread, burnGel, calmBrew, canned].map(spriteHash)).size, 5, 'bundle 007 consumables should not reuse each other');
});

test('bundle 007 weapon sprites separate breach charge from foam projector', () => {
  assert.equal(ITEMS.breach_charge?.name, 'Пробивной заряд');
  assert.equal(ITEMS.brt2_foam_projector?.name, 'БРТ-2 бетономёт');
  assert.equal(ITEMS.breach_charge?.type, ItemType.WEAPON);
  assert.equal(ITEMS.brt2_foam_projector?.type, ItemType.WEAPON);

  const breachCharge = generateItemSprite('breach_charge');
  const foamProjector = generateItemSprite('brt2_foam_projector');
  const breachDark = countPixels(breachCharge, (r, g, b, a) => a > 160 && r < 65 && g < 75 && b < 75);
  const breachSeal = countPixels(breachCharge, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 90);
  const breachWire = countPixelsIn(breachCharge, 35, 15, 52, 27, (r, g, b, a) => a > 130 && g > 130 && b > 100 && r < 120);
  const foamMass = countPixels(foamProjector, (r, g, b, a) => a > 160 && r < 65 && g < 75 && b < 75);
  const foamPixels = countPixelsIn(foamProjector, 20, 28, 60, 42, (r, g, b, a) => a > 140 && g > 150 && b > 130 && r < 190);
  const warningPaint = countPixels(foamProjector, (r, g, b, a) => a > 160 && r > 170 && g > 110 && g < 190 && b < 95);

  assert.equal(breachCharge[0] >>> 24, 0, 'breach_charge sprite should keep transparent corners');
  assert.equal(foamProjector[0] >>> 24, 0, 'brt2_foam_projector sprite should keep transparent corners');
  assert.ok(opaquePixels(breachCharge) > 900, 'breach_charge should have compact explosive mass');
  assert.ok(opaquePixels(foamProjector) > 900, 'brt2_foam_projector should have readable diagonal weapon mass');
  assert.ok(breachDark > 300, 'breach_charge should use black/blue engineer casing');
  assert.ok(breachSeal > 60, 'breach_charge should include red sealed charge marks');
  assert.ok(breachWire > 18, 'breach_charge should include a visible wire/fuse cue');
  assert.ok(foamMass > 380, 'brt2_foam_projector should have heavy dark projector metal');
  assert.ok(foamPixels > 70, 'brt2_foam_projector should show foam tank/nozzle liquid color');
  assert.ok(warningPaint > 12, 'brt2_foam_projector should include service warning paint');
  assert.notEqual(spriteHash(breachCharge), spriteHash(generateItemSprite('chest_failsafe_charge')));
  assert.notEqual(spriteHash(foamProjector), spriteHash(generateItemSprite('foam_grenade_6p10')));
});

test('bundle 007 route and cleanup papers read as different trade documents', () => {
  assert.equal(ITEMS.brown_slime_cleanup_act?.name, 'Акт зачистки коричневой слизи');
  assert.equal(ITEMS.caravan_route?.name, 'Маршрут каравана');

  const cleanupAct = generateItemSprite('brown_slime_cleanup_act');
  const caravanRoute = generateItemSprite('caravan_route');
  const cleanupPaper = countPixels(cleanupAct, (r, g, b, a) => a > 160 && r > 150 && g > 130 && b > 85 && b < 180);
  const cleanupSlime = countPixelsIn(cleanupAct, 18, 36, 49, 50, (r, g, b, a) => (
    a > 120 && r > 85 && r > g + 20 && g > 35 && g < 125 && b < 80
  ));
  const cleanupStamp = countPixels(cleanupAct, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 90);
  const routePaper = countPixels(caravanRoute, (r, g, b, a) => a > 160 && r > 150 && g > 130 && b > 85 && b < 180);
  const routeRed = countPixelsIn(caravanRoute, 18, 20, 48, 38, (r, g, b, a) => a > 160 && r > 130 && g < 85 && b < 80);
  const routeDoors = countPixels(caravanRoute, (r, g, b, a) => a > 130 && r < 50 && g < 50 && b < 50);

  assert.equal(cleanupAct[0] >>> 24, 0, 'cleanup act sprite should keep transparent corners');
  assert.equal(caravanRoute[0] >>> 24, 0, 'caravan route sprite should keep transparent corners');
  assert.ok(cleanupPaper > 520, 'cleanup act should read as stained paper');
  assert.ok(cleanupSlime > 90, 'cleanup act should carry a brown slime stain');
  assert.ok(cleanupStamp > 90, 'cleanup act should keep a red official stamp');
  assert.ok(routePaper > 500, 'caravan route should read as folded paper');
  assert.ok(routeRed > 80, 'caravan route should show a red route path');
  assert.ok(routeDoors > 90, 'caravan route should show dark door/stop marks');
  assert.notEqual(spriteHash(cleanupAct), spriteHash(caravanRoute));
  assert.notEqual(spriteHash(cleanupAct), spriteHash(generateItemSprite('blank_form')));
  assert.notEqual(spriteHash(caravanRoute), spriteHash(generateItemSprite('child_map')));
});

test('sprite bundle 008 items have distinct cards, materials, weapons, tools, and ChB artifacts', () => {
  const ids = [
    'card_deck',
    'cardboard_stack',
    'ceramic_shards_pack',
    'chain',
    'chainsaw',
    'chalk',
    'chernobog_cell_map',
    'chernobog_confiscation_act',
    'chernobog_external_cell_index',
  ] as const;
  const hashes = new Set<number>();

  for (const id of ids) {
    assert.ok(ITEMS[id], `${id} should stay registered`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 600, `${id} should have enough visible mass for world drops and grids`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, ids.length, 'bundle 008 item sprites should not collapse to reused hashes');

  const cardDeck = generateItemSprite('card_deck');
  assert.ok(countPixelsIn(cardDeck, 22, 18, 46, 47, (r, g, b, a) => a > 160 && r < 70 && g < 95 && b < 90) > 430, 'card deck should show a dark green card back');
  assert.ok(countPixelsIn(cardDeck, 28, 26, 40, 38, (r, g, b, a) => a > 150 && r > 150 && g > 120 && b > 70) > 45, 'card deck should include a central eye/card mark');
  assert.notEqual(spriteHash(cardDeck), spriteHash(generateItemSprite('blank_form')), 'card_deck should not reuse paper-form icon language');

  const cardboard = generateItemSprite('cardboard_stack');
  assert.ok(countPixels(cardboard, (r, g, b, a) => a > 130 && r > 90 && r < 205 && g > 45 && g < 155 && b < 95) > 280, 'cardboard_stack should be dominated by brown cardboard layers');
  assert.ok(countPixelsIn(cardboard, 35, 24, 49, 34, (r, g, b, a) => a > 150 && r > 145 && g > 105 && b < 130) > 25, 'cardboard_stack should include a small paper tag/stamp cue');
  assert.notEqual(spriteHash(cardboard), spriteHash(cardDeck), 'cardboard_stack should differ from the card deck');

  const ceramic = generateItemSprite('ceramic_shards_pack');
  assert.ok(countPixels(ceramic, (r, g, b, a) => a > 150 && r > 155 && g > 145 && b > 110) > 160, 'ceramic_shards_pack should expose pale ceramic shards');
  assert.ok(countPixels(ceramic, (r, g, b, a) => a > 130 && r > 95 && r < 205 && g > 45 && g < 150 && b < 95) > 330, 'ceramic_shards_pack should keep a dirty paper sack/material base');
  assert.notEqual(spriteHash(ceramic), spriteHash(generateItemSprite('asbestos_cord')), 'ceramic_shards_pack should not reuse cord material language');

  const chain = generateItemSprite('chain');
  assert.ok(countPixels(chain, (r, g, b, a) => a > 160 && r < 85 && g < 95 && b < 95) > 240, 'chain should show dark metal chain links');
  assert.ok(countPixels(chain, (r, g, b, a) => a > 120 && r > 100 && r < 185 && g > 35 && g < 100 && b < 80) > 65, 'chain should include rusty link wear');

  const chainsaw = generateItemSprite('chainsaw');
  assert.ok(countPixelsIn(chainsaw, 15, 31, 38, 49, (r, g, b, a) => a > 150 && r > 120 && g < 90 && b < 80) > 70, 'chainsaw should have a red industrial engine casing');
  assert.ok(countPixelsIn(chainsaw, 24, 18, 59, 41, (r, g, b, a) => a > 150 && r > 105 && g > 105 && b > 90) > 75, 'chainsaw should show a pale toothed cutting bar');
  assert.notEqual(spriteHash(chainsaw), spriteHash(chain), 'chainsaw should differ from the loose chain weapon');

  const chalk = generateItemSprite('chalk');
  assert.ok(countPixels(chalk, (r, g, b, a) => a > 150 && r > 165 && g > 155 && b > 120) > 140, 'chalk should show pale chalk body pixels');
  assert.ok(countPixels(chalk, (r, g, b, a) => a > 130 && g > 120 && b > 115 && r < 130) > 80, 'chalk should include colored route-marker sticks');

  const cellMap = generateItemSprite('chernobog_cell_map');
  assert.ok(countPixelsIn(cellMap, 22, 18, 44, 42, (r, g, b, a) => a > 90 && r < 80 && g < 85 && b < 90) > 100, 'chernobog_cell_map should show dark grid/cell lines');
  assert.ok(countPixels(cellMap, (r, g, b, a) => a > 120 && b > 110 && r < 150) > 50, 'chernobog_cell_map should carry violet-blue artifact marks');

  const confiscationAct = generateItemSprite('chernobog_confiscation_act');
  assert.ok(countPixelsIn(confiscationAct, 22, 20, 43, 45, (r, g, b, a) => a > 140 && r < 65 && g < 60 && b < 60) > 130, 'chernobog_confiscation_act should show a black handprint');
  assert.ok(countPixels(confiscationAct, (r, g, b, a) => a > 130 && r > 125 && g < 90 && b < 90) > 40, 'chernobog_confiscation_act should include a red archive stamp');

  const externalIndex = generateItemSprite('chernobog_external_cell_index');
  assert.ok(countPixelsIn(externalIndex, 22, 19, 45, 45, (r, g, b, a) => a > 120 && b > 95 && r < 140) > 85, 'chernobog_external_cell_index should show violet-blue ledger marks');
  assert.ok(countPixelsIn(externalIndex, 28, 21, 44, 42, (r, g, b, a) => a > 120 && r < 75 && g < 75 && b < 75) > 60, 'chernobog_external_cell_index should keep dark registry rows');
});

test('sprite bundle 009 items have distinct readable procedural icons', () => {
  const expectedNames: Record<string, string> = {
    chernobog_liquidator_memo: 'Памятка ликвидатора ЧБ',
    chernobog_redacted_central_note: 'Редакция центральной записки',
    chernobog_witness_correction: 'Правка показаний ЧБ',
    chest_failsafe_charge: 'Фугасный нагрудный заряд',
    child_map: 'Карта детей',
    chizh3_shotgun: 'ЧИЖ-3',
    cigs: 'Сигареты',
    circuit_board: 'Микросхема',
    clean_health_cert: 'Справка об отсутствии заражения',
  };

  const hashes = new Set<number>();
  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 700, `${id} sprite should have enough visible mass for world drops and grids`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 009 item sprites should not collapse to reused hashes');

  const redacted = generateItemSprite('chernobog_redacted_central_note');
  assert.ok(countPixels(redacted, (r, g, b, a) => a > 180 && r < 45 && g < 45 && b < 50) > 430, 'redacted central note should show heavy black redaction blocks');

  const witness = generateItemSprite('chernobog_witness_correction');
  assert.ok(countPixels(witness, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 90) > 95, 'witness correction should show red correction marks');

  const charge = generateItemSprite('chest_failsafe_charge');
  assert.ok(countPixels(charge, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 90) > 85, 'failsafe charge should show a red pull seal');
  assert.ok(countPixels(charge, (r, g, b, a) => a > 150 && r > 150 && g > 110 && b < 95) > 100, 'failsafe charge should show yellow service warning paint');

  const shotgun = generateItemSprite('chizh3_shotgun');
  assert.ok(countPixelsIn(shotgun, 12, 18, 59, 50, (_r, _g, _b, a) => a > 150) > 500, 'Chizh-3 should keep a strong diagonal shotgun mass');
  assert.notEqual(spriteHash(shotgun), spriteHash(generateItemSprite('shotgun')), 'Chizh-3 should not reuse the generic shotgun icon');

  const childMap = generateItemSprite('child_map');
  assert.ok(countPixels(childMap, (r, g, b, a) => a > 145 && b > 105 && g > 90 && r < 115) > 35, 'child map should include a blue pencil route');
  assert.ok(countPixels(childMap, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 90) > 30, 'child map should include a red destination mark');

  const cigs = generateItemSprite('cigs');
  assert.ok(countPixels(cigs, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 90) > 70, 'cigs should show a dull red Prima pack band');
  assert.ok(countPixels(cigs, (r, g, b, a) => a > 150 && r > 185 && g > 170 && b > 125) > 230, 'cigs should show pale cigarette paper');

  const circuit = generateItemSprite('circuit_board');
  assert.ok(countPixels(circuit, (r, g, b, a) => a > 150 && g > 90 && g > r + 15 && b > 45 && b < 145) > 260, 'circuit board should be dominated by green board material');
  assert.ok(countPixels(circuit, (r, g, b, a) => a > 150 && r > 150 && g > 110 && b < 95) > 45, 'circuit board should show gold traces');

  const cert = generateItemSprite('clean_health_cert');
  assert.ok(countPixels(cert, (r, g, b, a) => a > 150 && r > 140 && g < 95 && b < 90) > 160, 'clean health cert should show a red medical cross/stamp');
});

test('sprite bundle 011 items have distinct readable procedural icons', () => {
  const expectedNames: Record<string, string> = {
    conscripts_doublebarrel: 'Двустволка срочника',
    container_key_label: 'Бирка от ключа',
    contaminated_gloves: 'Загрязнённые перчатки',
    contaminated_sample_act: 'Акт испорченной пробы',
    contaminated_swab: 'Загрязнённый мазок',
    contraband_receipt_blank: 'Пустая расписка контрабанды',
    contraband_shocker_parts: 'Детали шокера',
    corpse_number_tag: 'Номерок трупа',
    cotton_wool: 'Вата',
  };

  const hashes = new Set<number>();
  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have enough visible mass for drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 011 item sprites should not collapse to reused hashes');

  const doublebarrel = generateItemSprite('conscripts_doublebarrel');
  assert.ok(countPixelsIn(doublebarrel, 10, 17, 59, 51, (_r, _g, _b, a) => a > 145) > 260, 'doublebarrel should keep a readable diagonal shotgun mass');
  assert.ok(countPixels(doublebarrel, (r, g, b, a) => a > 145 && b >= r + 4 && g >= r && r < 105) > 120, 'doublebarrel should show cold dark barrel metal');
  assert.ok(countPixels(doublebarrel, (r, g, b, a) => a > 145 && r > 70 && r < 155 && g > 35 && g < 100 && b < 75 && r > g + 15) > 35, 'doublebarrel should show worn wood furniture');
  assert.ok(countPixels(doublebarrel, (r, g, b, a) => a > 135 && r > 145 && ((g > 95 && b < 90) || (g < 90 && b < 85))) > 14, 'doublebarrel should include yellow/red militia service marks');
  assert.notEqual(spriteHash(doublebarrel), spriteHash(generateItemSprite('chizh3_shotgun')), 'doublebarrel should not reuse the Chizh-3 shotgun icon');
  assert.notEqual(spriteHash(doublebarrel), spriteHash(generateItemSprite('shotgun')), 'doublebarrel should not reuse the generic shotgun icon');

  const keyLabel = generateItemSprite('container_key_label');
  assert.ok(countPixels(keyLabel, (r, g, b, a) => a > 145 && r > 150 && g > 120 && b > 70 && b < 170) > 330, 'container key label should read as a yellow paper tag');
  assert.ok(countPixelsIn(keyLabel, 20, 9, 32, 33, (r, g, b, a) => a > 135 && r < 70 && g < 65 && b < 55) > 14, 'container key label should show a punched dark hole');
  assert.ok(countPixelsIn(keyLabel, 20, 10, 40, 27, (r, g, b, a) => a > 130 && r > 65 && r < 135 && g > 55 && g < 115 && b < 95) > 18, 'container key label should keep the tying string visible');

  const gloves = generateItemSprite('contaminated_gloves');
  assert.ok(countPixels(gloves, (r, g, b, a) => a > 145 && r > 155 && g > 145 && b > 105) > 190, 'contaminated gloves should show pale rubber');
  assert.ok(countPixels(gloves, (r, g, b, a) => a > 100 && ((g > 90 && r < 130 && b < 105) || (r > 90 && r < 150 && g < 90 && b < 70))) > 45, 'contaminated gloves should show green/brown contamination');
  assert.ok(countPixels(gloves, (r, g, b, a) => a > 135 && r > 130 && g < 85 && b < 80) > 20, 'contaminated gloves should carry a red evidence tag');

  const sampleAct = generateItemSprite('contaminated_sample_act');
  assert.ok(countPixels(sampleAct, (r, g, b, a) => a > 145 && r > 150 && g > 120 && b > 55 && b < 155) > 500, 'sample act should read as yellowed official paper');
  assert.ok(countPixels(sampleAct, (r, g, b, a) => a > 130 && r > 130 && g < 90 && b < 85) > 65, 'sample act should include a red failed-sample stamp');
  assert.ok(countPixels(sampleAct, (r, g, b, a) => a > 85 && g > 115 && r < 135 && b < 135) > 30, 'sample act should include a green contaminated smear');

  const swab = generateItemSprite('contaminated_swab');
  assert.ok(countPixels(swab, (r, g, b, a) => a > 145 && r > 150 && g > 125 && b > 65 && b < 170) > 520, 'contaminated swab should keep a paper evidence-card base');
  assert.ok(countPixelsIn(swab, 17, 20, 51, 45, (r, g, b, a) => a > 140 && r > 175 && g > 155 && b > 105) > 70, 'contaminated swab should show a pale cotton stick');
  assert.ok(countPixels(swab, (r, g, b, a) => a > 95 && ((g > 105 && r < 125 && b < 110) || (r > 90 && r < 150 && g < 90 && b < 75))) > 35, 'contaminated swab should show dirty green/brown sample material');

  const blankReceipt = generateItemSprite('contraband_receipt_blank');
  assert.ok(countPixels(blankReceipt, (r, g, b, a) => a > 145 && r > 150 && g > 125 && b > 65 && b < 170) > 530, 'contraband receipt blank should read as yellow receipt paper');
  assert.ok(countPixelsIn(blankReceipt, 21, 23, 43, 35, (r, g, b, a) => a > 110 && r > 170 && g > 150 && b > 95) > 80, 'contraband receipt blank should keep the empty receipt box readable');
  assert.ok(countPixels(blankReceipt, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85) > 55, 'contraband receipt blank should show a red diagonal/stub mark');
  assert.ok(countPixels(blankReceipt, (r, g, b, a) => a > 130 && r > 140 && g > 80 && g < 160 && b < 90) > 20, 'contraband receipt blank should include an ochre side stub');

  const shocker = generateItemSprite('contraband_shocker_parts');
  assert.ok(countPixels(shocker, (r, g, b, a) => a > 130 && r < 95 && g < 115 && b < 115) > 220, 'shocker parts should show dark bakelite bodies');
  assert.ok(countPixels(shocker, (r, g, b, a) => a > 95 && g > 150 && b > 130 && r < 125) > 45, 'shocker parts should include cyan electric glow');
  assert.ok(countPixelsIn(shocker, 39, 10, 57, 22, (r, g, b, a) => a > 130 && r > 125 && g > 120 && b > 100) > 20, 'shocker parts should show steel prongs');
  assert.ok(countPixels(shocker, (r, g, b, a) => a > 130 && r > 145 && g > 95 && g < 180 && b < 100) > 24, 'shocker parts should include brass coil marks');

  const corpseTag = generateItemSprite('corpse_number_tag');
  assert.ok(countPixels(corpseTag, (r, g, b, a) => a > 145 && Math.abs(r - g) < 34 && Math.abs(g - b) < 42 && r > 100 && r < 220) > 330, 'corpse number tag should read as dull sheet metal');
  assert.ok(countPixelsIn(corpseTag, 22, 24, 43, 41, (r, g, b, a) => a > 130 && r < 75 && g < 75 && b < 70) > 45, 'corpse number tag should show dark stamped digits and hole');
  assert.ok(countPixels(corpseTag, (r, g, b, a) => a > 90 && r > 95 && r < 160 && g < 85 && b < 75) > 25, 'corpse number tag should include rust or dried blood');

  const cotton = generateItemSprite('cotton_wool');
  assert.ok(countPixels(cotton, (r, g, b, a) => a > 130 && r > 170 && g > 165 && b > 135) > 300, 'cotton wool should show off-white cotton mass');
  assert.ok(countPixels(cotton, (r, g, b, a) => a > 130 && r > 135 && g < 90 && b < 90) > 20, 'cotton wool should include a red medical cross');
  assert.ok(countPixels(cotton, (r, g, b, a) => a > 80 && ((g > 100 && r < 130 && b < 120) || (r > 90 && r < 150 && g < 95 && b < 80))) > 20, 'cotton wool should keep dirty green/rust stains');
  assert.notEqual(spriteHash(cotton), spriteHash(generateItemSprite('bandage')), 'cotton wool should not reuse bandage sprite language');
  assert.notEqual(spriteHash(cotton), spriteHash(generateItemSprite('body_bag_roll')), 'cotton wool should not reuse body bag roll sprite language');
});

test('sprite bundle 014 items have distinct jars, weapons, documents, tools, and electronics', () => {
  const expectedNames: Record<string, string> = {
    empty_sample_jar: 'Пустая банка для пробы',
    entrenching_spade: 'Саперная лопатка',
    eralashnikov_auto: 'Автомат Ералашникова',
    experimental_concentrate: 'Несерийный концентрат',
    fake_pass: 'Фальшивый пропуск',
    felt_door_pad: 'Войлочная накладка',
    fibrous_capsule_cut: 'Срез фиброзной капсулы',
    field_radio_battery: 'Батарея рации',
    filter_canister: 'Фильтр-канистра',
  };

  const hashes = new Set<number>();
  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 800, `${id} should have enough visible mass for world drops and grids`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 014 item sprites should not collapse to reused hashes');

  const jar = generateItemSprite('empty_sample_jar');
  assert.ok(countPixels(jar, (r, g, b, a) => a > 70 && g > 90 && b > 85 && r < 170) > 140, 'empty sample jar should read as pale glass');
  assert.ok(countPixelsIn(jar, 23, 30, 43, 39, (r, g, b, a) => a > 140 && r > 160 && g > 135 && b < 160) > 70, 'empty sample jar should carry a paper label');

  const spade = generateItemSprite('entrenching_spade');
  assert.ok(countPixels(spade, (r, g, b, a) => a > 150 && b >= r && g >= r && r < 130) > 190, 'entrenching spade should show blue-black shovel metal');
  assert.ok(countPixels(spade, (r, g, b, a) => a > 150 && r > 55 && r < 115 && g > 30 && g < 75 && b < 55) > 40, 'entrenching spade should show a short wooden handle');
  assert.notEqual(spriteHash(spade), spriteHash(generateItemSprite('crowbar')), 'entrenching spade should not reuse crowbar language');

  const eralash = generateItemSprite('eralashnikov_auto');
  assert.ok(countPixels(eralash, (r, g, b, a) => a > 150 && b > r + 5 && g >= r && r < 115) > 260, 'Eralashnikov should use liquidator blue-black metal');
  assert.ok(countPixelsIn(eralash, 35, 36, 47, 53, (_r, _g, _b, a) => a > 130) > 110, 'Eralashnikov should show a hanging magazine');
  assert.notEqual(spriteHash(eralash), spriteHash(generateItemSprite('ak47')), 'Eralashnikov should differ from the old AK icon');

  const concentrate = generateItemSprite('experimental_concentrate');
  assert.ok(countPixels(concentrate, (r, g, b, a) => a > 150 && g > 85 && g >= r - 40 && b < 90) > 150, 'experimental concentrate should show a green ration mass');
  assert.ok(countPixels(concentrate, (r, g, b, a) => a > 140 && r > 130 && g < 85 && b < 75) > 90, 'experimental concentrate should carry risky red NII marks');

  const pass = generateItemSprite('fake_pass');
  assert.ok(countPixels(pass, (r, g, b, a) => a > 150 && r > 150 && g > 130 && b < 150) > 240, 'fake pass should read as yellow permit card');
  assert.ok(countPixels(pass, (r, g, b, a) => a > 140 && r > 130 && g < 85 && b < 80) > 110, 'fake pass should carry a red forged stamp');
  assert.ok(countPixelsIn(pass, 17, 27, 30, 41, (r, g, b, a) => a > 150 && r < 90 && g < 95 && b < 95) > 80, 'fake pass should include a dark photo block');

  const felt = generateItemSprite('felt_door_pad');
  assert.ok(countPixels(felt, (r, g, b, a) => a > 140 && r > 75 && r < 180 && g > 75 && g < 185 && b > 65 && b < 170) > 150, 'felt pad should show gray felt material');
  assert.ok(countPixels(felt, (r, g, b, a) => a > 130 && r > 170 && g > 140 && b < 115) > 75, 'felt pad should show exposed adhesive paper');

  const capsule = generateItemSprite('fibrous_capsule_cut');
  assert.ok(countPixels(capsule, (r, g, b, a) => a > 140 && r > 90 && g < 105 && b < 110) > 120, 'fibrous capsule cut should read as meat membrane');
  assert.ok(countPixels(capsule, (r, g, b, a) => a > 100 && ((b > 140 && r < 180) || (g > 150 && r < 140))) > 90, 'fibrous capsule cut should carry small anomaly glow');
  assert.ok(countPixelsIn(capsule, 28, 29, 39, 38, (r, g, b, a) => a > 140 && r > 140 && g > 120 && b > 110) > 10, 'fibrous capsule cut should include an eye-like pale center');

  const battery = generateItemSprite('field_radio_battery');
  assert.ok(countPixels(battery, (r, g, b, a) => a > 150 && r < 85 && g < 105 && b < 105) > 350, 'radio battery should read as dark bakelite block');
  assert.ok(countPixelsIn(battery, 25, 11, 42, 18, (r, g, b, a) => a > 140 && r > 150 && g > 130 && b < 150) > 45, 'radio battery should show metal contacts');
  assert.ok(countPixels(battery, (r, g, b, a) => a > 120 && g > 150 && b > 130 && r < 120) > 18, 'radio battery should include cyan dead pixels');

  const filter = generateItemSprite('filter_canister');
  assert.ok(countPixels(filter, (r, g, b, a) => a > 150 && r > 55 && r < 170 && g > 65 && g < 180 && b > 60 && b < 170) > 220, 'filter canister should read as worn metal canister');
  assert.ok(countPixelsIn(filter, 23, 30, 43, 40, (r, g, b, a) => a > 120 && r < 60 && g < 70 && b < 70) > 90, 'filter canister should show a dark grill');
  assert.ok(countPixels(filter, (r, g, b, a) => a > 140 && r > 160 && g > 110 && b < 90) > 50, 'filter canister should show yellow service paint');
});

test('item drop visual id is derived from inventory payload only', () => {
  const drop: Entity = {
    id: 1,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'bread', count: 0 },
      { defId: 'water', count: 2 },
    ],
  };

  assert.equal(itemDropDefId(drop), 'water');
  assert.equal(itemDropDefId({ inventory: [{ defId: 'bread', count: 0 }] }), null);
  assert.equal(itemDropDefId(null), null);
});

test('chemical 12g shell has a distinct decon-coded ammo sprite', () => {
  const chemical = generateItemSprite('ammo_12g_chemical');
  const greenBandPixels = countPixels(chemical, px => {
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    return (px >>> 24) !== 0 && g >= 120 && g > r + 20 && g > b + 20;
  });
  const warningPixels = countPixels(chemical, px => {
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    return (px >>> 24) !== 0 && r >= 170 && g >= 55 && g <= 150 && b <= 90;
  });

  assert.ok(opaquePixels(chemical) > 120, 'chemical shell sprite should have a readable silhouette');
  assert.ok(greenBandPixels >= 12, 'chemical shell sprite should expose green decon bands');
  assert.ok(warningPixels >= 4, 'chemical shell sprite should expose red/orange hazard markings');
  assert.notEqual(spriteHash(chemical), spriteHash(generateItemSprite('ammo_12g_slug')));
  assert.notEqual(spriteHash(chemical), spriteHash(generateItemSprite('ammo_12g_incendiary')));
});

test('incendiary 12g shell has a fire-coded slime cleanup sprite', () => {
  assert.equal(ITEMS.ammo_12g_incendiary?.name, 'Зажигательная дробь');
  assert.equal(ITEMS.ammo_12g_incendiary?.type, ItemType.AMMO);

  const sprite = generateItemSprite('ammo_12g_incendiary');
  const fireBands = countPixelsIn(sprite, 17, 17, 50, 39, (r, g, b, a) => a > 170 && r > 170 && g >= 45 && g < 125 && b < 90);
  const brassCaps = countPixelsIn(sprite, 17, 13, 51, 49, (r, g, b, a) => a > 170 && r > 145 && g > 95 && g < 185 && b < 100);
  const slimeFilm = countPixelsIn(sprite, 16, 24, 50, 38, (r, g, b, a) => a > 110 && g > 125 && r < 130 && b < 120);
  const darkShells = countPixelsIn(sprite, 17, 18, 51, 49, (r, g, b, a) => a > 170 && r < 105 && g < 85 && b < 80);

  assert.equal(sprite[0] >>> 24, 0, 'incendiary 12g sprite should keep transparent corners');
  assert.ok(opaquePixels(sprite) > 230, 'incendiary 12g should have enough visible shell mass');
  assert.ok(fireBands > 25, 'incendiary 12g should expose red/orange fire bands');
  assert.ok(brassCaps > 55, 'incendiary 12g should retain brass shotgun shell caps');
  assert.ok(slimeFilm > 10, 'incendiary 12g should include a weak green slime cleanup cue');
  assert.ok(darkShells > 90, 'incendiary 12g should read as dark shotgun shells, not a generic glowing sample');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_shells')));
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_12g_slug')));
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_12g_chemical')));
});

test('aerosol paint maiden sprite reads as damp stamped document', () => {
  const sprite = generateItemSprite('aerosol_paint_maiden');
  const otherAuditDocument = generateItemSprite('ministry_audit_forgery');

  assert.ok(opaquePixels(sprite) > 900, 'paint audit sprite should have a readable paper silhouette');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 180 && r > 170 && g > 145 && b < 150) > 250, 'sprite should keep yellow paper mass');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 120 && r < 55 && g < 55 && b < 55) > 80, 'sprite should include black document rows');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 120 && r > 130 && g < 80 && b < 80) > 40, 'sprite should include a red stamp');
  assert.ok(countPixels(sprite, (r, g, b, a) => a > 80 && a < 190 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 65 && r < 130) > 80, 'sprite should include a grey damp edge');
  assert.notEqual(spriteHash(sprite), spriteHash(otherAuditDocument), 'paint audit sprite should differ from the generic audit document');
});

test('archive access permit sprite reads as a stamped damp archive pass', () => {
  assert.equal(ITEMS.archive_access_permit?.name, 'Допуск в архив');
  assert.equal(ITEMS.archive_access_permit?.desc, 'Короткий пропуск к картотеке райсовета.');

  const sprite = generateItemSprite('archive_access_permit');
  const yellowPaper = countPixels(sprite, (r, g, b, a) => a > 170 && r > 155 && g > 125 && b > 60 && b < 155);
  const blackRows = countPixelsIn(sprite, 18, 24, 42, 41, (r, g, b, a) => a > 120 && r < 55 && g < 55 && b < 55);
  const redStamp = countPixels(sprite, (r, g, b, a) => a > 130 && r > 125 && g < 80 && b < 75);
  const dampEdge = countPixelsIn(sprite, 11, 20, 18, 46, (r, g, b, a) =>
    a > 70 && a < 190 && Math.abs(r - g) < 35 && Math.abs(g - b) < 35 && r > 60 && r < 125);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 780, 'archive_access_permit should have a readable horizontal card silhouette');
  assert.ok(yellowPaper > 430, 'archive_access_permit should use yellowed official paper');
  assert.ok(blackRows > 45, 'archive_access_permit should include black archive rows');
  assert.ok(redStamp > 45, 'archive_access_permit should include a red access stamp');
  assert.ok(dampEdge > 35, 'archive_access_permit should include a grey damp edge');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('raionsovet_floor_pass')), 'archive pass should differ from the raionsovet floor pass');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('stolen_archive_card')), 'archive pass should differ from the stolen archive card');
});

test('sprite bundle 035 rail, archive, ration and meat items have distinct procedural icons', () => {
  const expectedNames: Record<string, string> = {
    rail_spike_pack: 'Пакет костылей',
    rail_switch_handle: 'Рукоять стрелочного перевода',
    rail_switch_order: 'Ордер стрелочного перевода',
    raionsovet_floor_pass: 'Пропуск райсовета',
    rake_bayonet: 'Штык-грабли',
    ration_registry_extract: 'Выписка из пайкового реестра',
    ration_stamp_pad: 'Пайковая штемпельная подушка',
    rawmeat: 'Сырое мясо',
  };
  const ids = Object.keys(expectedNames);
  const sprites = new Map(ids.map(id => [id, generateItemSprite(id)] as const));
  const hashes = new Set<number>();

  for (const id of ids) {
    assert.equal(ITEMS[id]?.name, expectedNames[id], `${id} source name should remain canonical`);
    const sprite = sprites.get(id)!;
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 700, `${id} sprite should have a readable 64x64 silhouette`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, ids.length, 'bundle 035 items should not share identical sprite pixels');

  const railSpikes = sprites.get('rail_spike_pack')!;
  assert.ok(countPixels(railSpikes, (r, g, b, a) => a > 150 && r > 80 && r < 190 && g > 80 && g < 190 && b > 70 && b < 170 && Math.abs(r - g) < 60) > 260, 'rail_spike_pack should show bundled steel spikes');
  assert.ok(countPixels(railSpikes, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 85) > 35, 'rail_spike_pack should include rust/service marks');

  const railHandle = sprites.get('rail_switch_handle')!;
  assert.ok(countPixels(railHandle, (r, g, b, a) => a > 150 && r > 170 && g > 110 && b < 100) > 100, 'rail_switch_handle should show yellow depot paint');
  assert.ok(countPixelsIn(railHandle, 16, 22, 44, 51, (r, g, b, a) => a > 150 && r < 95 && g < 100 && b < 95) > 120, 'rail_switch_handle should keep a heavy dark lever base');

  const railOrder = sprites.get('rail_switch_order')!;
  assert.ok(countPixels(railOrder, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 160) > 450, 'rail_switch_order should read as official yellow paper');
  assert.ok(countPixels(railOrder, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 85) > 80, 'rail_switch_order should include a red stamp');
  assert.ok(countPixelsIn(railOrder, 23, 24, 49, 46, (r, g, b, a) => a > 130 && r < 95 && g < 105 && b < 105) > 65, 'rail_switch_order should include a rail-switch diagram');

  const raionsovetPass = sprites.get('raionsovet_floor_pass')!;
  assert.ok(countPixels(raionsovetPass, (r, g, b, a) => a > 130 && g > 95 && r < 120 && b < 115) > 90, 'raionsovet_floor_pass should show archive-green pass blocks');
  assert.ok(countPixels(raionsovetPass, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 85) > 80, 'raionsovet_floor_pass should include a red approval stamp');
  assert.notEqual(spriteHash(raionsovetPass), spriteHash(generateItemSprite('archive_access_permit')), 'raionsovet_floor_pass should differ from archive access permit');
  assert.notEqual(spriteHash(raionsovetPass), spriteHash(generateItemSprite('forged_raionsovet_pass')), 'raionsovet_floor_pass should differ from forged raionsovet pass');

  const rakeBayonet = sprites.get('rake_bayonet')!;
  assert.ok(countPixelsIn(rakeBayonet, 46, 8, 61, 27, (_r, _g, _b, a) => a > 120) > 80, 'rake_bayonet should show a forked rake-bayonet tip');
  assert.ok(countPixels(rakeBayonet, (r, g, b, a) => a > 150 && r < 65 && g < 75 && b < 80) > 230, 'rake_bayonet should keep a dark metal melee silhouette');
  assert.notEqual(spriteHash(rakeBayonet), spriteHash(generateItemSprite('bayonet')), 'rake_bayonet should differ from the plain bayonet');
  assert.notEqual(spriteHash(rakeBayonet), spriteHash(generateItemSprite('liquidator_rake')), 'rake_bayonet should differ from the liquidator rake');

  const registryExtract = sprites.get('ration_registry_extract')!;
  assert.ok(countPixels(registryExtract, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 160) > 360, 'ration_registry_extract should keep yellow paper mass');
  assert.ok(countPixels(registryExtract, (r, g, b, a) => a > 130 && g > 95 && r < 120 && b < 115) > 40, 'ration_registry_extract should include ration-green marks');
  assert.notEqual(spriteHash(registryExtract), spriteHash(generateItemSprite('forged_ration_card')), 'ration_registry_extract should differ from forged ration card');

  const stampPad = sprites.get('ration_stamp_pad')!;
  assert.ok(countPixels(stampPad, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 85) > 140, 'ration_stamp_pad should expose a red ink pad');
  assert.ok(countPixels(stampPad, (r, g, b, a) => a > 150 && r < 65 && g < 65 && b < 65) > 180, 'ration_stamp_pad should have a dark stamp-pad case');
  assert.notEqual(spriteHash(stampPad), spriteHash(generateItemSprite('ministry_clean_stamp')), 'ration_stamp_pad should not reuse a stamp-sheet icon');

  const raw = sprites.get('rawmeat')!;
  assert.equal(ITEMS.rawmeat?.type, ItemType.FOOD);
  assert.ok(countPixels(raw, (r, g, b, a) => a > 150 && r > 130 && g < 90 && b < 85) > 220, 'rawmeat should read as red meat');
  assert.ok(countPixels(raw, (r, g, b, a) => a > 130 && r > 190 && g > 120 && b > 95) > 60, 'rawmeat should include pale sinew/fat');
  assert.ok(countPixels(raw, (r, g, b, a) => a > 100 && g > 90 && r < 120 && b < 110) > 25, 'rawmeat should include spoiled bait grime');
  assert.notEqual(spriteHash(raw), spriteHash(generateItemSprite('meat_rune')), 'rawmeat should differ from ritual meat objects');
});

test('bleached document sprite reads as a sealed Veretar-bleached paper sample', () => {
  assert.equal(ITEMS.bleached_document?.name, 'Выбеленная бумага');
  assert.equal(ITEMS.bleached_document?.type, ItemType.MISC);

  const sprite = generateItemSprite('bleached_document');
  const palePaper = countPixelsIn(sprite, 22, 24, 43, 50, (r, g, b, a) => (
    a > 145 && r > 185 && g > 185 && b > 155 && Math.abs(r - g) < 32 && r > b + 6
  ));
  const sampleGlass = countPixels(sprite, (r, g, b, a) => (
    a > 85 && a < 190 && g > 120 && b > 115 && Math.abs(g - b) < 55 && r < g + 25
  ));
  const anomalyGlow = countPixels(sprite, (r, g, b, a) => a > 95 && (
    (g > 175 && r < 170 && b < 180) ||
    (b > 165 && g > 120 && r < 130) ||
    (r > 115 && b > 135 && g < 130)
  ));
  const washedInk = countPixelsIn(sprite, 27, 30, 39, 40, (r, g, b, a) => (
    a > 40 && a < 130 && r < 95 && g < 95 && b < 85
  ));

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 620, 'bleached_document should have a readable jar-and-paper silhouette');
  assert.ok(palePaper > 190, 'bleached_document should show a pale washed-out paper core');
  assert.ok(sampleGlass > 120, 'bleached_document should keep a transparent sample-jar read');
  assert.ok(anomalyGlow > 28, 'bleached_document should include weak green/blue/violet anomaly glow');
  assert.ok(washedInk > 3, 'bleached_document should retain nearly erased document rows');

  const hash = spriteHash(sprite);
  for (const id of ['blank_form', 'sealed_veretar_sand', 'blue_glow_sample_sealed', 'boiled_slime_residue']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `bleached_document should not reuse ${id} sprite language`);
  }
});

test('blueprint T1 folder sprite reads as a stained shop blueprint folder', () => {
  assert.equal(ITEMS.blueprint_t1_folder?.name, 'Папка чертежей Т1');
  assert.equal(ITEMS.blueprint_t1_folder?.desc, 'Папка простых схем для слесаря: полка, корпус, дверная мелочь. Можно продать, сдать в цех или оставить под заказ.');

  const sprite = generateItemSprite('blueprint_t1_folder');
  const yellowPaper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 155 && g > 125 && b > 55 && b < 155);
  const blackRows = countPixels(sprite, (r, g, b, a) => a > 120 && r < 55 && g < 55 && b < 55);
  const redStamp = countPixels(sprite, (r, g, b, a) => a > 120 && r > 130 && g < 80 && b < 75);
  const dampEdge = countPixels(sprite, (r, g, b, a) => a > 70 && a < 190 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 65 && r < 120);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 850, 'blueprint_t1_folder should have a readable folder/sheet silhouette');
  assert.ok(yellowPaper > 520, 'blueprint_t1_folder should be dominated by yellowed blueprint paper');
  assert.ok(blackRows > 85, 'blueprint_t1_folder should include black plan rows and schematic strokes');
  assert.ok(redStamp > 45, 'blueprint_t1_folder should include a red shop stamp');
  assert.ok(dampEdge > 70, 'blueprint_t1_folder should include a grey damp edge');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('blueprint_t2_folder')), 'T1 blueprint folder should differ from T2 blueprint language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('bank_debt_paper')), 'T1 blueprint folder should differ from official debt paper');
});

test('blueprint T2 folder sprite reads as a damp stamped terminal blueprint folder', () => {
  assert.equal(ITEMS.blueprint_t2_folder?.name, 'Папка чертежей Т2');
  assert.equal(ITEMS.blueprint_t2_folder?.desc, 'Плотная папка улучшенных схем. Цех просит ресурс, рынок просит молчание, терминал читает фиброзную капсулу.');

  const sprite = generateItemSprite('blueprint_t2_folder');
  const yellowPaper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 150 && g > 120 && b > 50 && b < 155);
  const blackRows = countPixels(sprite, (r, g, b, a) => a > 110 && r < 60 && g < 60 && b < 60);
  const redStamp = countPixels(sprite, (r, g, b, a) => a > 120 && r > 125 && g < 80 && b < 80);
  const dampEdge = countPixels(sprite, (r, g, b, a) => a > 70 && a < 190 && Math.abs(r - g) < 30 && Math.abs(g - b) < 35 && r > 60 && r < 130);
  const cyanGlow = countPixels(sprite, (r, g, b, a) => a > 70 && b > 150 && g > 135 && r < 120);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 1000, 'blueprint_t2_folder should have a readable folder/sheet silhouette');
  assert.ok(yellowPaper > 520, 'blueprint_t2_folder should be dominated by yellowed blueprint paper');
  assert.ok(blackRows > 85, 'blueprint_t2_folder should include black plan rows and schematic strokes');
  assert.ok(redStamp > 50, 'blueprint_t2_folder should include a red production stamp');
  assert.ok(dampEdge > 90, 'blueprint_t2_folder should include a grey damp edge');
  assert.ok(cyanGlow > 16, 'blueprint_t2_folder should include weak cyan terminal/capsule glow');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('blueprint_t1_folder')), 'T2 blueprint folder should differ from T1 blueprint language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('blueprint_t3_folder')), 'T2 blueprint folder should differ from T3 blueprint language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('weapon_blueprint_t2')), 'T2 blueprint folder should differ from the weapon blueprint');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('bank_debt_paper')), 'T2 blueprint folder should differ from official debt paper');
});

test('blueprint T3 folder sprite reads as a cold stamped deep-route blueprint folder', () => {
  assert.equal(ITEMS.blueprint_t3_folder?.name, 'Папка чертежей Т3');
  assert.equal(ITEMS.blueprint_t3_folder?.desc, 'Редкий комплект глубоких схем с холодными пятнами на бумаге. Держите отдельно от воды и лишних свидетелей.');

  const sprite = generateItemSprite('blueprint_t3_folder');
  const yellowPaper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 150 && g > 120 && b > 50 && b < 160);
  const blackRows = countPixels(sprite, (r, g, b, a) => a > 110 && r < 60 && g < 60 && b < 60);
  const redStamp = countPixels(sprite, (r, g, b, a) => a > 120 && r > 125 && g < 80 && b < 80);
  const dampEdge = countPixels(sprite, (r, g, b, a) => a > 70 && a < 190 && Math.abs(r - g) < 30 && Math.abs(g - b) < 35 && r > 60 && r < 130);
  const coldStain = countPixels(sprite, (r, g, b, a) => a > 65 && a < 180 && b > 120 && g > 100 && r < 150);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 1200, 'blueprint_t3_folder should have a readable folder/sheet stack silhouette');
  assert.ok(yellowPaper > 360, 'blueprint_t3_folder should retain yellow blueprint paper');
  assert.ok(blackRows > 180, 'blueprint_t3_folder should include black rows and schematic strokes');
  assert.ok(redStamp > 90, 'blueprint_t3_folder should include a red deep-route stamp');
  assert.ok(dampEdge > 120, 'blueprint_t3_folder should include a grey damp edge');
  assert.ok(coldStain > 110, 'blueprint_t3_folder should include cold blue-grey stains');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('blueprint_t1_folder')), 'T3 blueprint folder should differ from T1 blueprint language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('blueprint_t2_folder')), 'T3 blueprint folder should differ from T2 blueprint language');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('weapon_blueprint_t2')), 'T3 blueprint folder should differ from the weapon blueprint');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('bank_debt_paper')), 'T3 blueprint folder should differ from official debt paper');
});

test('bank debt paper sprite reads as an official stamped debt document', () => {
  assert.equal(ITEMS.bank_debt_paper?.name, 'Долговая бумага банка');
  assert.equal(ITEMS.bank_debt_paper?.desc, 'Официальная банковская строка: сумма, подпись, срок и намек на служебный вход для должника.');

  const sprite = generateItemSprite('bank_debt_paper');
  const yellowPaper = countPixels(sprite, (r, g, b, a) => a > 180 && r > 155 && g > 125 && b > 70 && b < 155);
  const blackRows = countPixels(sprite, (r, g, b, a) => a > 120 && r < 55 && g < 55 && b < 55);
  const redSeal = countPixels(sprite, (r, g, b, a) => a > 130 && r > 130 && g < 80 && b < 75);
  const dampEdge = countPixels(sprite, (r, g, b, a) => a > 70 && a < 190 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 65 && r < 120);

  assert.equal(sprite[0] >>> 24, 0, 'corner background should stay transparent');
  assert.ok(opaquePixels(sprite) > 900, 'bank debt paper should have a readable sheet silhouette');
  assert.ok(yellowPaper > 500, 'bank debt paper should use yellow official paper');
  assert.ok(blackRows > 100, 'bank debt paper should include black ledger rows');
  assert.ok(redSeal > 65, 'bank debt paper should include a red bank stamp/seal');
  assert.ok(dampEdge > 80, 'bank debt paper should include a damp grey edge');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('forged_bank_debt_paper')), 'official debt paper should differ from the forged debt paper');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('debt_settlement_receipt')), 'debt paper should differ from the settlement receipt');
});

test('bundle 016 forged papers, ration card and frozen samples have distinct readable sprites', () => {
  const expectedNames: Record<string, string> = {
    forged_bank_debt_paper: 'Липовая долговая бумага',
    forged_permit_slip: 'Кованый корешок пропуска',
    forged_quarantine_clearance: 'Липовая карантинная справка',
    forged_raionsovet_pass: 'Липовый пропуск райсовета',
    forged_ration_card: 'Поддельная пайковая карточка',
    forged_shelter_tally: 'Липовая ведомость укрытых',
    forged_stamp_sheet: 'Лист с поддельной печатью',
    frozen_item_shard: 'Осколок замороженного предмета',
    frozen_slime_core: 'Замороженное ядро слизи',
  };
  const hashes = new Set<number>();

  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 016 sprites should not share exact sprite hashes');

  const forgedDocs = [
    'forged_bank_debt_paper',
    'forged_permit_slip',
    'forged_quarantine_clearance',
    'forged_raionsovet_pass',
    'forged_shelter_tally',
    'forged_stamp_sheet',
  ] as const;
  for (const id of forgedDocs) {
    const sprite = generateItemSprite(id);
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 160 && r > 140 && g > 115 && b > 55 && b < 170) > 250, `${id} should keep yellowed paper mass`);
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 80, `${id} should show a red forged stamp/seal`);
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 100 && r < 65 && g < 65 && b < 65) > 100, `${id} should include black document rows or strokes`);
  }

  const ration = generateItemSprite('forged_ration_card');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 160 && r > 140 && g > 115 && b > 55 && b < 170) > 300, 'forged_ration_card should read as a dirty ration card');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 90, 'forged_ration_card should include a red forged ration stamp');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 100 && g > 120 && r < 130 && b < 150) > 20, 'forged_ration_card should include a dull green ration-grid cue');
  assert.notEqual(spriteHash(ration), spriteHash(generateItemSprite('concentrate_coupon')), 'forged ration card should not reuse the regular concentrate coupon');

  const shard = generateItemSprite('frozen_item_shard');
  const core = generateItemSprite('frozen_slime_core');
  assert.ok(countPixels(shard, (r, g, b, a) => a > 80 && b > 140 && g > 110 && r < 155) > 180, 'frozen_item_shard should show a cold blue ice shard');
  assert.ok(countPixels(shard, (r, g, b, a) => a > 100 && r < 65 && g < 65 && b < 65) > 45, 'frozen_item_shard should trap a dark embedded object');
  assert.ok(countPixels(core, (r, g, b, a) => a > 80 && b > 140 && g > 110 && r < 155) > 45, 'frozen_slime_core should keep a cold glass/ice shell');
  assert.ok(countPixels(core, (r, g, b, a) => a > 100 && g > 120 && r < 130 && b < 150) > 50, 'frozen_slime_core should show a green slime core');
  assert.notEqual(spriteHash(shard), spriteHash(core), 'frozen shard and frozen slime core should differ');
  assert.notEqual(spriteHash(core), spriteHash(generateItemSprite('slime_sample_blue')), 'frozen slime core should differ from generic blue slime samples');
});

test('bundle 012 sprites cover every planned item with unique readable silhouettes', () => {
  const ids = [
    'cracked_sample_jar',
    'crowbar',
    'cult_supply_list',
    'deactivated_residue',
    'debt_settlement_receipt',
    'decon_completion_stamp',
    'decon_fluid',
    'denunciation',
    'dice_bone',
    'domino_box',
  ] as const;
  const hashes = new Set<number>();

  for (const id of ids) {
    assert.ok(ITEMS[id], `${id} should stay registered`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 850, `${id} should have enough mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(hashes.size, ids.length, 'bundle 012 sprites should not share exact sprite hashes');
});

test('crowbar sprite reads as a hooked blue-black metal lever', () => {
  assert.equal(ITEMS.crowbar?.name, 'Лом');
  assert.equal(ITEMS.crowbar?.type, ItemType.WEAPON);

  const sprite = generateItemSprite('crowbar');
  const hash = spriteHash(sprite);
  const blueBlackMetal = countPixels(sprite, (r, g, b, a) => a > 150 && b >= r + 6 && g >= r && r < 120);
  const hookHead = countPixelsIn(sprite, 45, 8, 59, 22, (_r, _g, _b, a) => a > 140);
  const heelClaw = countPixelsIn(sprite, 8, 36, 19, 51, (_r, _g, _b, a) => a > 140);
  const serviceMarks = countPixels(sprite, (r, g, b, a) => a > 140 && ((r > 160 && g > 105 && b < 85) || (r > 135 && g < 85 && b < 80)));
  const rust = countPixels(sprite, (r, g, b, a) => a > 120 && r > 100 && r < 175 && g > 35 && g < 95 && b < 80);

  assert.ok(blueBlackMetal > 300, 'crowbar should use blue-black service metal');
  assert.ok(hookHead > 45, 'crowbar should show the hooked pry head');
  assert.ok(heelClaw > 30, 'crowbar should show the lower claw end');
  assert.ok(serviceMarks > 40, 'crowbar should include yellow/red service paint');
  assert.ok(rust > 35, 'crowbar should include rust and chipped wear');
  for (const id of ['chain', 'fire_hook', 'hammer', 'sledgehammer']) {
    assert.notEqual(hash, spriteHash(generateItemSprite(id)), `crowbar should not reuse ${id} sprite language`);
  }
});

test('bundle 012 sample sprites separate cracked glass, dead residue, and decon fluid', () => {
  const cracked = generateItemSprite('cracked_sample_jar');
  const residue = generateItemSprite('deactivated_residue');
  const decon = generateItemSprite('decon_fluid');

  const crackedGlass = countPixels(cracked, (r, g, b, a) => a > 80 && a < 220 && g >= r && b >= r - 8 && r > 65);
  const crackedFluid = countPixels(cracked, (r, g, b, a) => a > 120 && g > 155 && r < 170 && b < 180);
  const crackedViolet = countPixels(cracked, (r, g, b, a) => a > 100 && b > 120 && r > 90 && g < 150);
  const deadAsh = countPixels(residue, (r, g, b, a) => a > 130 && Math.abs(r - g) < 24 && Math.abs(g - b) < 34 && r > 90 && r < 195);
  const scorch = countPixels(residue, (r, g, b, a) => a > 120 && r > 45 && r < 145 && g > 25 && g < 90 && b < 75);
  const deconGreen = countPixels(decon, (r, g, b, a) => a > 120 && g > 165 && r < 150 && b < 155);
  const deconRed = countPixels(decon, (r, g, b, a) => a > 140 && r > 135 && g < 90 && b < 80);

  assert.ok(crackedGlass > 150, 'cracked_sample_jar should retain translucent glass');
  assert.ok(crackedFluid > 90, 'cracked_sample_jar should show unstable green sample fluid');
  assert.ok(crackedViolet > 60, 'cracked_sample_jar should include violet contaminant');
  assert.ok(deadAsh > 180, 'deactivated_residue should read as grey dead residue');
  assert.ok(scorch > 110, 'deactivated_residue should include burned/scorched marks');
  assert.ok(deconGreen > 320, 'decon_fluid should show bright disinfectant fluid');
  assert.ok(deconRed > 110, 'decon_fluid should show a sanitary red label/cross');
  assert.notEqual(spriteHash(cracked), spriteHash(generateItemSprite('blue_glow_sample_sealed')));
  assert.notEqual(spriteHash(residue), spriteHash(generateItemSprite('boiled_slime_residue')));
  assert.notEqual(spriteHash(decon), spriteHash(generateItemSprite('alkali_powder')));
});

test('bundle 012 paper and trade sprites keep document and small-good reads distinct', () => {
  const cult = generateItemSprite('cult_supply_list');
  const receipt = generateItemSprite('debt_settlement_receipt');
  const stamp = generateItemSprite('decon_completion_stamp');
  const denunciation = generateItemSprite('denunciation');
  const dice = generateItemSprite('dice_bone');
  const domino = generateItemSprite('domino_box');

  const cultPot = countPixelsIn(cult, 27, 32, 47, 43, (r, g, b, a) => a > 120 && r < 110 && g < 120 && b < 110);
  const cultRedBullets = countPixelsIn(cult, 18, 22, 24, 42, (r, g, b, a) => a > 140 && r > 130 && g < 80 && b < 80);
  const receiptPaper = countPixels(receipt, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 60 && b < 175);
  const receiptGreen = countPixels(receipt, (r, g, b, a) => a > 120 && g > 105 && g > b && r < 120);
  const stampRed = countPixels(stamp, (r, g, b, a) => a > 120 && r > 130 && g < 85 && b < 80);
  const stampGreen = countPixels(stamp, (r, g, b, a) => a > 120 && g > 120 && r < 120 && b < 130);
  const denunciationSlash = countPixels(denunciation, (r, g, b, a) => a > 130 && r > 130 && g < 80 && b < 80);
  const diceBone = countPixels(dice, (r, g, b, a) => a > 150 && r > 160 && g > 145 && b > 110);
  const dicePips = countPixels(dice, (r, g, b, a) => a > 150 && r > 45 && r < 100 && g > 40 && g < 90 && b > 30 && b < 80);
  const dominoBox = countPixels(domino, (r, g, b, a) => a > 130 && r > 70 && r < 215 && g > 20 && g < 175 && b < 115);
  const dominoIvory = countPixels(domino, (r, g, b, a) => a > 145 && r > 150 && g > 140 && b > 105);
  const dominoPips = countPixels(domino, (r, g, b, a) => a > 145 && r < 65 && g < 65 && b < 65);

  assert.ok(cultPot > 45, 'cult_supply_list should include a dark kitchen pot silhouette');
  assert.ok(cultRedBullets > 8, 'cult_supply_list should include red supply marks');
  assert.ok(receiptPaper > 300, 'debt_settlement_receipt should use yellow official receipt paper');
  assert.ok(receiptGreen > 20, 'debt_settlement_receipt should include a paid/bank mark');
  assert.ok(stampRed > 160, 'decon_completion_stamp should include a large wet red stamp');
  assert.ok(stampGreen > 110, 'decon_completion_stamp should include a decon cross mark');
  assert.ok(denunciationSlash > 120, 'denunciation should show a threatening red diagonal/stamp');
  assert.ok(diceBone > 260, 'dice_bone should read as pale bone dice');
  assert.ok(dicePips > 30, 'dice_bone should include dark dice pips');
  assert.ok(dominoBox > 260, 'domino_box should include a red-brown storage box');
  assert.ok(dominoIvory > 130, 'domino_box should show ivory domino tiles');
  assert.ok(dominoPips > 25, 'domino_box should include dark domino pips and dividers');
  assert.notEqual(spriteHash(cult), spriteHash(generateItemSprite('denunciation')));
  assert.notEqual(spriteHash(receipt), spriteHash(generateItemSprite('bank_debt_paper')));
  assert.notEqual(spriteHash(stamp), spriteHash(generateItemSprite('cleanup_order_stub')));
  assert.notEqual(spriteHash(dice), spriteHash(generateItemSprite('card_deck')));
  assert.notEqual(spriteHash(domino), spriteHash(dice));
  assert.notEqual(spriteHash(domino), spriteHash(generateItemSprite('card_deck')));
});

test('bundle 017 sprites cover documents, parts, weapons, samples, filters, and glass', () => {
  const ids = [
    'fuel_issue_stamp',
    'fuse',
    'g41_grenade_launcher',
    'gas_sample_ampoule',
    'gasmask_filter',
    'gauss',
    'gear',
    'glass_ampoule_empty',
    'glass_shard',
  ] as const;
  const hashes = new Set<number>();

  for (const id of ids) {
    assert.ok(ITEMS[id], `${id} should stay registered`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 150, `${id} should have enough visible mass for drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(ITEMS.fuel_issue_stamp.name, 'Штамп выдачи топлива');
  assert.equal(ITEMS.fuse.name, 'Предохранитель');
  assert.equal(ITEMS.g41_grenade_launcher.name, '5Г41 станковый гранатомёт');
  assert.equal(ITEMS.gas_sample_ampoule.name, 'Ампула газовой пробы');
  assert.equal(ITEMS.gasmask_filter.name, 'Фильтр противогаза');
  assert.equal(ITEMS.gauss.name, 'Гаусс-винтовка');
  assert.equal(ITEMS.gear.name, 'Шестерня');
  assert.equal(ITEMS.glass_ampoule_empty.name, 'Пустая ампула');
  assert.equal(ITEMS.glass_shard.name, 'Стекло');
  assert.equal(hashes.size, ids.length, 'bundle 017 sprites should not share exact sprite hashes');

  const fuelStamp = generateItemSprite('fuel_issue_stamp');
  const fuelPaper = countPixels(fuelStamp, (r, g, b, a) => a > 150 && r > 150 && g > 115 && b > 55 && b < 165);
  const fuelRed = countPixels(fuelStamp, (r, g, b, a) => a > 130 && r > 125 && g < 90 && b < 80);
  const fuelOil = countPixels(fuelStamp, (r, g, b, a) => a > 90 && r > 35 && r < 90 && g > 35 && g < 90 && b < 65);
  assert.ok(fuelPaper > 420, 'fuel_issue_stamp should read as yellowed official paper');
  assert.ok(fuelRed > 55, 'fuel_issue_stamp should include a red issue stamp');
  assert.ok(fuelOil > 35, 'fuel_issue_stamp should include oil/fuel grime and can marks');

  const fuse = generateItemSprite('fuse');
  const fuseBrass = countPixels(fuse, (r, g, b, a) => a > 150 && r > 130 && g > 80 && g < 175 && b < 95);
  const fuseCeramic = countPixels(fuse, (r, g, b, a) => a > 160 && r > 175 && g > 165 && b > 120);
  const fuseRedGreen = countPixels(fuse, (r, g, b, a) => a > 130 && ((r > 130 && g < 90 && b < 80) || (g > 115 && r < 120 && b < 120)));
  assert.ok(fuseBrass > 45, 'fuse should show brass end caps');
  assert.ok(fuseCeramic > 45, 'fuse should show a pale ceramic body');
  assert.ok(fuseRedGreen > 30, 'fuse should include colored service tags or blown wire');

  const launcher = generateItemSprite('g41_grenade_launcher');
  const launcherMetal = countPixels(launcher, (r, g, b, a) => a > 150 && b >= r + 6 && g >= r && r < 105);
  const launcherTripod = countPixelsIn(launcher, 14, 42, 49, 56, (_r, _g, _b, a) => a > 120);
  const launcherWarnings = countPixels(launcher, (r, g, b, a) => a > 130 && ((r > 160 && g > 100 && b < 90) || (r > 130 && g < 90 && b < 80)));
  assert.ok(launcherMetal > 220, 'g41_grenade_launcher should use black/blue heavy weapon metal');
  assert.ok(launcherTripod > 95, 'g41_grenade_launcher should show a lower tripod/mount');
  assert.ok(launcherWarnings > 35, 'g41_grenade_launcher should include sealed warning paint');

  const gasSample = generateItemSprite('gas_sample_ampoule');
  const gasGreen = countPixels(gasSample, (r, g, b, a) => a > 100 && g > 165 && r < 160 && b < 170);
  const gasViolet = countPixels(gasSample, (r, g, b, a) => a > 90 && b > 135 && r > 95 && g < 150);
  const gasGlass = countPixels(gasSample, (r, g, b, a) => a > 70 && a < 190 && g > 115 && b > 105 && Math.abs(g - b) < 60);
  assert.ok(gasGreen > 120, 'gas_sample_ampoule should show green gas sample mass');
  assert.ok(gasViolet > 45, 'gas_sample_ampoule should include violet anomaly gas');
  assert.ok(gasGlass > 110, 'gas_sample_ampoule should retain translucent ampoule glass');

  const filter = generateItemSprite('gasmask_filter');
  const filterMetal = countPixels(filter, (r, g, b, a) => a > 150 && r > 55 && r < 155 && g > 65 && g < 175 && b > 55 && b < 155);
  const filterDarkGrille = countPixelsIn(filter, 22, 22, 44, 42, (r, g, b, a) => a > 130 && r < 55 && g < 65 && b < 65);
  const filterIodine = countPixels(filter, (r, g, b, a) => a > 130 && r > 160 && g > 105 && b < 90);
  assert.ok(filterMetal > 270, 'gasmask_filter should show a metal filter canister');
  assert.ok(filterDarkGrille > 70, 'gasmask_filter should show a dark perforated grille');
  assert.ok(filterIodine > 20, 'gasmask_filter should include yellow service banding');

  const gauss = generateItemSprite('gauss');
  const gaussMetal = countPixels(gauss, (r, g, b, a) => a > 150 && b >= r + 8 && g >= r && r < 105);
  const gaussCyan = countPixels(gauss, (r, g, b, a) => a > 115 && g > 165 && b > 150 && r < 140);
  const gaussRails = countPixelsIn(gauss, 26, 18, 60, 34, (_r, _g, _b, a) => a > 120);
  assert.ok(gaussMetal > 170, 'gauss should use black/blue railgun metal');
  assert.ok(gaussCyan > 35, 'gauss should include a cyan charged rail cue');
  assert.ok(gaussRails > 100, 'gauss should show a long upper rail/muzzle silhouette');

  const gear = generateItemSprite('gear');
  const gearMetal = countPixels(gear, (r, g, b, a) => a > 130 && Math.abs(r - g) < 30 && Math.abs(g - b) < 45 && r > 70 && r < 190);
  const gearTeeth = countPixelsIn(gear, 11, 11, 53, 53, (_r, _g, _b, a) => a > 150);
  const gearHole = countPixelsIn(gear, 28, 28, 36, 36, (_r, _g, _b, a) => a === 0);
  assert.ok(gearMetal > 420, 'gear should read as grey worn metal');
  assert.ok(gearTeeth > 700, 'gear should have a large cog silhouette with teeth');
  assert.ok(gearHole > 35, 'gear should keep a transparent center hole');

  const emptyAmpoule = generateItemSprite('glass_ampoule_empty');
  const emptyGlass = countPixels(emptyAmpoule, (r, g, b, a) => a > 55 && a < 180 && g > 115 && b > 110 && Math.abs(g - b) < 60);
  const emptyRedCross = countPixels(emptyAmpoule, (r, g, b, a) => a > 130 && r > 130 && g < 90 && b < 90);
  assert.ok(emptyGlass > 100, 'glass_ampoule_empty should read as mostly transparent glass');
  assert.ok(emptyRedCross > 55, 'glass_ampoule_empty should include a red medical cross label');
  assert.notEqual(spriteHash(emptyAmpoule), spriteHash(gasSample), 'empty ampoule should differ from the filled gas sample ampoule');

  const shard = generateItemSprite('glass_shard');
  const shardGlass = countPixels(shard, (r, g, b, a) => a > 60 && a < 190 && g > 120 && b > 120 && Math.abs(g - b) < 65);
  const shardHighlights = countPixels(shard, (r, g, b, a) => a > 150 && r > 170 && g > 185 && b > 175);
  const shardBlood = countPixels(shard, (r, g, b, a) => a > 80 && r > 100 && g < 70 && b < 75);
  assert.ok(shardGlass > 85, 'glass_shard should show translucent jagged glass');
  assert.ok(shardHighlights > 12, 'glass_shard should include sharp bright edge highlights');
  assert.ok(shardBlood > 5, 'glass_shard should include a small dirty red smear');
});

test('bundle 015 sprites cover every planned filter, foam, and utility item', () => {
  const entries = [
    ['filter_layer', 'Фильтрующий слой', ItemType.MISC],
    ['filter_receipt', 'Квитанция на фильтр', ItemType.MISC],
    ['filtered_water', 'Вода фильтрованная', ItemType.DRINK],
    ['fire_hook', 'Пожарный багор', ItemType.WEAPON],
    ['flamethrower', 'Огнемёт', ItemType.WEAPON],
    ['flashlight', 'Фонарик', ItemType.TOOL],
    ['foam_grenade_6p10', 'Пенобетонная граната 6П10', ItemType.WEAPON],
    ['foam_grenade_act', 'Акт выдачи 6П10', ItemType.MISC],
    ['fog_detector', 'Детектор тумана', ItemType.TOOL],
  ] as const;
  const hashes = new Set<number>();

  for (const [id, name, type] of entries) {
    assert.equal(ITEMS[id]?.name, name);
    assert.equal(ITEMS[id]?.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(hashes.size, entries.length, 'bundle 015 sprites should not share exact sprite hashes');
});

test('bundle 015 filter paperwork and filtered water sprites keep material reads distinct', () => {
  const layer = generateItemSprite('filter_layer');
  const receipt = generateItemSprite('filter_receipt');
  const water = generateItemSprite('filtered_water');

  const layerGrey = countPixels(layer, (r, g, b, a) => a > 120 && Math.abs(r - g) < 28 && Math.abs(g - b) < 32 && r > 65 && r < 180);
  const layerCharcoal = countPixels(layer, (r, g, b, a) => a > 110 && r < 55 && g < 60 && b < 60);
  const layerTags = countPixels(layer, (r, g, b, a) => a > 120 && ((r > 165 && g > 115 && b < 100) || (r > 130 && g < 90 && b < 85)));
  const receiptPaper = countPixels(receipt, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 175);
  const receiptInk = countPixels(receipt, (r, g, b, a) => a > 110 && r < 55 && g < 60 && b < 60);
  const receiptStamp = countPixels(receipt, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85);
  const receiptFilterCue = countPixels(receipt, (r, g, b, a) => a > 100 && g > 135 && b > 130 && r < 140);
  const waterCyan = countPixels(water, (r, g, b, a) => a > 100 && g > 135 && b > 130 && r < 140);
  const waterHighlight = countPixels(water, (r, g, b, a) => a > 120 && g > 170 && b > 165 && r < 150);
  const waterLabel = countPixels(water, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 175);
  const waterRedMark = countPixels(water, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85);

  assert.ok(layerGrey > 130, 'filter_layer should show grey fibrous material');
  assert.ok(layerCharcoal > 280, 'filter_layer should include charcoal/filter dark bands');
  assert.ok(layerTags > 130, 'filter_layer should include red/yellow trade tags');
  assert.ok(receiptPaper > 340, 'filter_receipt should read as yellowed receipt paper');
  assert.ok(receiptInk > 180, 'filter_receipt should include printed receipt rows');
  assert.ok(receiptStamp > 120, 'filter_receipt should include a red stamp');
  assert.ok(receiptFilterCue > 20, 'filter_receipt should include a filter-material cue');
  assert.ok(waterCyan > 180, 'filtered_water should show clean cyan water');
  assert.ok(waterHighlight > 80, 'filtered_water should include bright filtered-water highlights');
  assert.ok(waterLabel > 60, 'filtered_water should keep a paper label');
  assert.ok(waterRedMark > 15, 'filtered_water should include a red control mark');
  for (const id of ['water', 'boiler_water', 'metal_water']) {
    assert.notEqual(spriteHash(water), spriteHash(generateItemSprite(id)), `filtered_water should not reuse ${id} sprite language`);
  }
  assert.notEqual(spriteHash(layer), spriteHash(receipt), 'filter layer and filter receipt should not share sprite language');
});

test('bundle 015 weapon and detector sprites show their gameplay silhouettes', () => {
  const fireHook = generateItemSprite('fire_hook');
  const flamer = generateItemSprite('flamethrower');
  const flashlight = generateItemSprite('flashlight');
  const foamGrenade = generateItemSprite('foam_grenade_6p10');
  const act = generateItemSprite('foam_grenade_act');
  const detector = generateItemSprite('fog_detector');

  const fireHookHead = countPixelsIn(fireHook, 44, 8, 60, 28, (_r, _g, _b, a) => a > 120);
  const fireHookHandle = countPixelsIn(fireHook, 8, 38, 28, 54, (_r, _g, _b, a) => a > 120);
  const fireHookMarks = countPixels(fireHook, (r, g, b, a) => a > 120 && ((r > 165 && g > 115 && b < 100) || (r > 130 && g < 90 && b < 85)));
  const flamerDark = countPixels(flamer, (r, g, b, a) => a > 150 && r < 90 && g < 105 && b < 110);
  const flamerHot = countPixels(flamer, (r, g, b, a) => a > 120 && r > 190 && g > 60 && g < 140 && b < 70);
  const flamerTank = countPixelsIn(flamer, 8, 38, 28, 54, (_r, _g, _b, a) => a > 120);
  const flashlightBody = countPixels(flashlight, (r, g, b, a) => a > 150 && r < 90 && g < 105 && b < 110);
  const flashlightLens = countPixelsIn(flashlight, 49, 23, 61, 33, (r, g, b, a) => a > 100 && r > 180 && g > 150 && b < 150);
  const foamCyan = countPixels(foamGrenade, (r, g, b, a) => a > 120 && g > 170 && b > 165 && r < 150);
  const foamWarning = countPixels(foamGrenade, (r, g, b, a) => a > 120 && r > 165 && g > 115 && b < 100);
  const foamRed = countPixels(foamGrenade, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85);
  const actPaper = countPixels(act, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 175);
  const actStamp = countPixels(act, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85);
  const actFoam = countPixels(act, (r, g, b, a) => a > 100 && g > 135 && b > 130 && r < 140);
  const detectorScreen = countPixelsIn(detector, 24, 22, 42, 35, (r, g, b, a) => a > 100 && g > 130 && b > 130 && r < 140);
  const detectorCyan = countPixels(detector, (r, g, b, a) => a > 120 && g > 170 && b > 165 && r < 150);
  const detectorControls = countPixels(detector, (r, g, b, a) => a > 120 && ((r > 165 && g > 115 && b < 100) || (r > 130 && g < 90 && b < 85)));

  assert.ok(fireHookHead > 160, 'fire_hook should show a hooked metal head');
  assert.ok(fireHookHandle > 180, 'fire_hook should show a long lower handle');
  assert.ok(fireHookMarks > 130, 'fire_hook should include red/yellow service paint');
  assert.ok(flamerDark > 600, 'flamethrower should read as heavy dark industrial metal');
  assert.ok(flamerHot > 10, 'flamethrower should include a hot nozzle cue');
  assert.ok(flamerTank > 200, 'flamethrower should show a tank/grip mass');
  assert.ok(flashlightBody > 420, 'flashlight should have a rubberized dark body');
  assert.ok(flashlightLens > 8, 'flashlight should include a yellow lens/glow');
  assert.ok(foamCyan > 100, 'foam_grenade_6p10 should show cyan foam payload');
  assert.ok(foamWarning > 50, 'foam_grenade_6p10 should include yellow warning paint');
  assert.ok(foamRed > 25, 'foam_grenade_6p10 should include a red service mark');
  assert.ok(actPaper > 450, 'foam_grenade_act should read as official paper');
  assert.ok(actStamp > 130, 'foam_grenade_act should include red issue stamps');
  assert.ok(actFoam > 80, 'foam_grenade_act should include a cyan foam grenade cue');
  assert.ok(detectorScreen > 90, 'fog_detector should show a cyan detection screen');
  assert.ok(detectorCyan > 130, 'fog_detector should include cyan antenna/smog signal');
  assert.ok(detectorControls > 70, 'fog_detector should include warning controls');

  for (const id of ['axe', 'crowbar', 'liquidator_rake']) {
    assert.notEqual(spriteHash(fireHook), spriteHash(generateItemSprite(id)), `fire_hook should not reuse ${id} sprite language`);
  }
  assert.notEqual(spriteHash(flamer), spriteHash(generateItemSprite('agnia_a130')), 'flamethrower should differ from agnia_a130');
  assert.notEqual(spriteHash(flamer), spriteHash(generateItemSprite('roks47_flamethrower')), 'flamethrower should differ from roks47_flamethrower');
  assert.notEqual(spriteHash(flashlight), spriteHash(generateItemSprite('liquidator_flashlamp')), 'flashlight should differ from liquidator_flashlamp');
  assert.notEqual(spriteHash(foamGrenade), spriteHash(generateItemSprite('concrete_breaker_grenade')), 'foam grenade should differ from concrete breaker grenade');
  assert.notEqual(spriteHash(foamGrenade), spriteHash(generateItemSprite('grenade')), 'foam grenade should differ from generic grenade');
  assert.notEqual(spriteHash(act), spriteHash(generateItemSprite('filter_receipt')), 'foam grenade act should differ from filter receipt');
  assert.notEqual(spriteHash(detector), spriteHash(generateItemSprite('flashlight')), 'fog detector should differ from flashlight');
});

test('sprite bundle 020 items have distinct repair, document, medicine, ammo, weapon, and trade icons', () => {
  const expectedNames = {
    hermetic_tape: 'Гермолента',
    hermo_gasket: 'Гермопрокладка',
    hermodoor_journal: 'Журнал обслуживания гермодверей',
    holy_water: 'Святая вода',
    homemade_9mm: 'Кустарные 9мм',
    homemade_ammo_instruction: 'Инструкция кустарных патронов',
    homemade_pistol: 'Кустарный пистолет',
    idol_chernobog: 'Идол Чернобога',
    import_toiletpaper: 'Туалетная бумага «Импорт»',
  };
  const hashes = new Set<number>();

  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 020 sprites should not share exact sprite hashes');

  const tape = generateItemSprite('hermetic_tape');
  assert.ok(countPixels(tape, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 120) > 80, 'hermetic_tape should show pale seal tape');
  assert.ok(countPixels(tape, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 240, 'hermetic_tape should show a dark tape core');
  assert.ok(countPixels(tape, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 30, 'hermetic_tape should include a red service mark');
  assert.ok(countPixels(tape, (r, g, b, a) => a > 120 && g > 110 && r < 120 && b < 130) > 35, 'hermetic_tape should include green seal glue');

  const gasket = generateItemSprite('hermo_gasket');
  assert.ok(countPixels(gasket, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 650, 'hermo_gasket should read as a dark rubber gasket');
  assert.ok(countPixels(gasket, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 40, 'hermo_gasket should include a red repair tag');
  assert.ok(countPixels(gasket, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 120) > 25, 'hermo_gasket should show pale bolt/chalk marks');

  const journal = generateItemSprite('hermodoor_journal');
  assert.ok(countPixels(journal, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 120) > 80, 'hermodoor_journal should read as yellowed service paper');
  assert.ok(countPixels(journal, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 450, 'hermodoor_journal should include black document rows/spine');
  assert.ok(countPixels(journal, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 55, 'hermodoor_journal should include a red stamp');

  const holyWater = generateItemSprite('holy_water');
  assert.ok(countPixels(holyWater, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 170, 'holy_water should show cyan holy water');
  assert.ok(countPixels(holyWater, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 45, 'holy_water should include a red cross/seal mark');
  assert.ok(countPixels(holyWater, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 120) > 55, 'holy_water should keep a pale glass/label highlight');

  const homemadeAmmo = generateItemSprite('homemade_9mm');
  assert.ok(countPixels(homemadeAmmo, (r, g, b, a) => a > 150 && r > 145 && g > 90 && g < 190 && b < 100) > 180, 'homemade_9mm should show brass cartridge bodies');
  assert.ok(countPixels(homemadeAmmo, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 180, 'homemade_9mm should include dark soot/crimp marks');
  assert.ok(countPixels(homemadeAmmo, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 45, 'homemade_9mm should include a red contraband slash');
  assert.notEqual(spriteHash(homemadeAmmo), spriteHash(generateItemSprite('ammo_9mm')), 'homemade_9mm should not reuse factory 9mm art');

  const instruction = generateItemSprite('homemade_ammo_instruction');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 150 && r > 145 && g > 90 && g < 190 && b < 100) > 220, 'homemade_ammo_instruction should include cartridge/brass diagrams');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 280, 'homemade_ammo_instruction should include printed rows');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 100, 'homemade_ammo_instruction should include a red unsafe-production mark');

  const pistol = generateItemSprite('homemade_pistol');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 380, 'homemade_pistol should show dark homemade metal');
  assert.ok(countPixelsIn(pistol, 40, 18, 58, 29, (_r, _g, _b, a) => a > 120) > 45, 'homemade_pistol should show a short barrel/muzzle');
  assert.ok(countPixelsIn(pistol, 16, 35, 39, 51, (_r, _g, _b, a) => a > 120) > 150, 'homemade_pistol should show a crude grip');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 30, 'homemade_pistol should include a red taped repair mark');
  assert.notEqual(spriteHash(pistol), spriteHash(generateItemSprite('makarov')), 'homemade_pistol should not reuse makarov art');

  const idol = generateItemSprite('idol_chernobog');
  assert.ok(countPixels(idol, (r, g, b, a) => a > 120 && r < 70 && g < 75 && b < 80) > 480, 'idol_chernobog should read as a dark stone idol');
  assert.ok(countPixels(idol, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 20, 'idol_chernobog should include red eye/chip marks');
  assert.ok(countPixels(idol, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 20, 'idol_chernobog should include cold cult scoring');

  const importPaper = generateItemSprite('import_toiletpaper');
  assert.ok(countPixels(importPaper, (r, g, b, a) => a > 150 && r > 170 && g > 160 && b > 120) > 300, 'import_toiletpaper should read as a pale paper roll');
  assert.ok(countPixels(importPaper, (r, g, b, a) => a > 120 && b > 120 && r < 115 && g < 160) > 70, 'import_toiletpaper should include a blue import label');
  assert.ok(countPixels(importPaper, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 30, 'import_toiletpaper should include a red premium/foreign mark');
  assert.notEqual(spriteHash(importPaper), spriteHash(generateItemSprite('toiletpaper')), 'import_toiletpaper should differ from the local grey toiletpaper roll');
});

test('sprite bundle 022 items have distinct sidearm, kitchen, key, electronics, drink and labor-card icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['karkarov_pistol', 'Пистолет Каркарова', ItemType.WEAPON],
    ['kasha', 'Каша', ItemType.FOOD],
    ['key', 'Ключ', ItemType.KEY],
    ['keyboard_unit', 'Клавиатура', ItemType.MISC],
    ['knife', 'Нож', ItemType.WEAPON],
    ['kompot', 'Компот', ItemType.DRINK],
    ['krona_battery', 'Батарейка «Крона»', ItemType.MISC],
    ['kulich', 'Кулич', ItemType.FOOD],
    ['labor_shift_card', 'Карта смены', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 420, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 022 sprites should not share exact sprite hashes');

  const pistol = generateItemSprite('karkarov_pistol');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 130 && r < 80 && g < 95 && b < 105) > 230, 'Karkarov pistol should read as compact black-blue sidearm metal');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 130 && r > 155 && g > 105 && g < 195 && b < 100) > 25, 'Karkarov pistol should include yellow service paint');
  assert.notEqual(spriteHash(pistol), spriteHash(generateItemSprite('makarov')), 'Karkarov pistol should differ from Makarov');
  assert.notEqual(spriteHash(pistol), spriteHash(generateItemSprite('homemade_pistol')), 'Karkarov pistol should differ from homemade pistol');

  const kasha = generateItemSprite('kasha');
  assert.ok(countPixels(kasha, (r, g, b, a) => a > 150 && r > 150 && g > 120 && b > 70 && b < 150) > 140, 'kasha should show ochre porridge');
  assert.ok(countPixels(kasha, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 105 && r < 210) > 160, 'kasha should include a grey communal bowl and spoon');
  assert.notEqual(spriteHash(kasha), spriteHash(generateItemSprite('pearl_barley')), 'kasha should not reuse canned barley art');

  const key = generateItemSprite('key');
  assert.ok(countPixels(key, (r, g, b, a) => a > 145 && r > 130 && g > 85 && g < 200 && b < 105) > 190, 'generic key should show brass');
  assert.ok(countPixelsIn(key, 16, 25, 28, 38, (r, g, b, a) => a > 170 && r < 50 && g < 55 && b < 50) > 22, 'generic key should keep a readable ring hole');
  assert.ok(countPixelsIn(key, 42, 30, 55, 43, (_r, _g, _b, a) => a > 140) > 70, 'generic key should show teeth and shaft');
  assert.notEqual(spriteHash(key), spriteHash(generateItemSprite('borrowed_kitchen_key')), 'generic key should differ from tagged borrowed key');

  const keyboard = generateItemSprite('keyboard_unit');
  assert.ok(countPixels(keyboard, (r, g, b, a) => a > 140 && r > 120 && Math.abs(r - g) < 45 && b > 90 && b < 190) > 180, 'keyboard should show worn pale casing');
  assert.ok(countPixels(keyboard, (r, g, b, a) => a > 140 && r < 70 && g < 80 && b < 85) > 230, 'keyboard should show dark key rows');
  assert.ok(countPixels(keyboard, (r, g, b, a) => a > 120 && g > 150 && b > 130 && r < 120) > 25, 'keyboard should include cyan terminal pixels');

  const knife = generateItemSprite('knife');
  assert.ok(countPixels(knife, (r, g, b, a) => a > 145 && r > 140 && g > 145 && b > 130) > 100, 'knife should show a pale metal blade');
  assert.ok(countPixels(knife, (r, g, b, a) => a > 130 && r > 70 && r > g + 20 && g < 90 && b < 70) > 60, 'knife should show a worn brown kitchen handle');
  assert.notEqual(spriteHash(knife), spriteHash(generateItemSprite('bayonet')), 'knife should differ from bayonet');

  const kompot = generateItemSprite('kompot');
  assert.ok(countPixels(kompot, (r, g, b, a) => a > 130 && r > 115 && r > g + 40 && b > 35 && b < 105) > 100, 'kompot should show red cloudy liquid');
  assert.ok(countPixels(kompot, (r, g, b, a) => a > 80 && a < 190 && g > 100 && b > 95 && r < 140) > 100, 'kompot should keep a translucent bottle/jar body');
  assert.notEqual(spriteHash(kompot), spriteHash(generateItemSprite('water')), 'kompot should differ from water');

  const krona = generateItemSprite('krona_battery');
  assert.ok(countPixels(krona, (r, g, b, a) => a > 130 && r < 80 && g < 100 && b < 100) > 260, 'krona battery should read as dark rectangular power cell');
  assert.ok(countPixels(krona, (r, g, b, a) => a > 140 && r > 155 && g > 120 && b < 110) > 45, 'krona battery should show brass contacts');
  assert.ok(countPixels(krona, (r, g, b, a) => a > 120 && g > 150 && b > 130 && r < 120) > 14, 'krona battery should include cyan power ticks');
  assert.notEqual(spriteHash(krona), spriteHash(generateItemSprite('field_radio_battery')), 'krona battery should differ from radio battery');

  const kulich = generateItemSprite('kulich');
  assert.ok(countPixels(kulich, (r, g, b, a) => a > 145 && r > 95 && r > g + 20 && g > 45 && g < 150 && b < 95) > 180, 'kulich should show brown cake crust');
  assert.ok(countPixels(kulich, (r, g, b, a) => a > 145 && r > 190 && g > 180 && b > 140) > 90, 'kulich should show pale icing');
  assert.ok(countPixels(kulich, (r, g, b, a) => a > 130 && r > 135 && g < 95 && b < 90) > 20, 'kulich should include a red cross/sprinkles mark');
  assert.notEqual(spriteHash(kulich), spriteHash(generateItemSprite('easter_egg')), 'kulich should differ from easter egg');

  const labor = generateItemSprite('labor_shift_card');
  assert.ok(countPixels(labor, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 60 && b < 170) > 360, 'labor shift card should read as yellowed work card');
  assert.ok(countPixels(labor, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 80, 'labor shift card should include a red official stamp');
  assert.ok(countPixels(labor, (r, g, b, a) => a > 120 && g > 90 && g > r - 10 && r < 130 && b < 125) > 30, 'labor shift card should show a green production strip');
  assert.notEqual(spriteHash(labor), spriteHash(generateItemSprite('part_ticket')), 'labor shift card should differ from party ticket');
  assert.notEqual(spriteHash(labor), spriteHash(generateItemSprite('hazard_shift_extension')), 'labor shift card should differ from hazard shift extension');
});

test('sprite bundle 024 items have distinct liquidator, weapon, repair, document, and trade icons', () => {
  const expectedNames = {
    liquidator_ration: 'Черный сухпай ликвидатора',
    liquidator_token: 'Жетон ликвидатора',
    losyash_rifle: 'Винтовка Лосяша',
    machinegun: 'Пулемёт',
    magazine_part: 'Детали магазина',
    mail_intercept_slip: 'Лист перехвата почты',
    makarov: 'Макаров',
    manometer: 'Манометр',
    market_weight_scale: 'Рыночные весы',
  };
  const hashes = new Set<number>();

  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 024 sprites should not share exact sprite hashes');

  const ration = generateItemSprite('liquidator_ration');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 150 && r < 90 && g < 95 && b < 80) > 180, 'liquidator_ration should read as a black closed-issue ration');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 130 && r > 130 && g < 85 && b < 80) > 25, 'liquidator_ration should include red issue markings');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 120 && g > 90 && r < 100 && b < 100) > 20, 'liquidator_ration should include a dull green risk mark');

  const token = generateItemSprite('liquidator_token');
  assert.ok(countPixels(token, (r, g, b, a) => a > 150 && Math.abs(r - g) < 28 && Math.abs(g - b) < 42 && r > 80 && r < 215) > 220, 'liquidator_token should read as worn metal');
  assert.ok(countPixels(token, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 30, 'liquidator_token should include a red service stripe');
  assert.notEqual(spriteHash(token), spriteHash(generateItemSprite('corpse_number_tag')), 'liquidator_token should differ from corpse number tags');

  const losyash = generateItemSprite('losyash_rifle');
  const machine = generateItemSprite('machinegun');
  const makarov = generateItemSprite('makarov');
  assert.ok(countPixelsIn(losyash, 48, 12, 63, 26, (_r, _g, _b, a) => a > 120) > 30, 'losyash_rifle should show a long precision barrel');
  assert.ok(countPixels(losyash, (r, g, b, a) => a > 120 && g > 120 && b > 130 && r < 120) > 20, 'losyash_rifle should include a polymer bolt cue');
  assert.ok(countPixels(machine, (r, g, b, a) => a > 140 && r > 145 && g > 90 && g < 180 && b < 90) > 45, 'machinegun should show belt-fed brass');
  assert.ok(countPixelsIn(machine, 24, 34, 48, 47, (_r, _g, _b, a) => a > 140) > 170, 'machinegun should show a heavy receiver');
  assert.ok(countPixelsIn(makarov, 14, 24, 54, 39, (_r, _g, _b, a) => a > 140) > 230, 'makarov should show a compact pistol slide');
  assert.ok(countPixelsIn(makarov, 27, 38, 38, 52, (_r, _g, _b, a) => a > 140) > 70, 'makarov should show a short grip');
  for (const id of ['nosin_rifle', 'ptrs_liquidator', 'p41_heavy_mg']) {
    assert.notEqual(spriteHash(losyash), spriteHash(generateItemSprite(id)), `losyash_rifle should not reuse ${id} sprite language`);
  }
  assert.notEqual(spriteHash(machine), spriteHash(generateItemSprite('p41_heavy_mg')), 'machinegun should differ from the P41 heavy MG');
  assert.notEqual(spriteHash(makarov), spriteHash(generateItemSprite('homemade_pistol')), 'makarov should differ from homemade pistol');

  const magazine = generateItemSprite('magazine_part');
  assert.ok(countPixels(magazine, (r, g, b, a) => a > 140 && Math.abs(r - g) < 30 && Math.abs(g - b) < 40 && r > 75 && r < 195) > 190, 'magazine_part should show worn steel parts');
  assert.ok(countPixels(magazine, (r, g, b, a) => a > 130 && r > 150 && g > 120 && b < 110) > 25, 'magazine_part should include a visible spring');
  assert.notEqual(spriteHash(magazine), spriteHash(generateItemSprite('barrel_part')), 'magazine_part should differ from barrel part');

  const mail = generateItemSprite('mail_intercept_slip');
  assert.ok(countPixels(mail, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 65 && b < 170) > 430, 'mail_intercept_slip should read as yellow paper');
  assert.ok(countPixels(mail, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 85, 'mail_intercept_slip should include a red postal seal');
  assert.ok(countPixels(mail, (r, g, b, a) => a > 120 && b > 90 && r < 100 && g < 130) > 20, 'mail_intercept_slip should include a blue route mark');

  const gauge = generateItemSprite('manometer');
  assert.ok(countPixels(gauge, (r, g, b, a) => a > 150 && r > 150 && g > 140 && b > 100) > 180, 'manometer should show a pale pressure dial');
  assert.ok(countPixels(gauge, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 12, 'manometer should include a red needle');
  assert.ok(countPixelsIn(gauge, 16, 14, 51, 49, (_r, _g, _b, a) => a > 150) > 520, 'manometer should keep a strong round gauge silhouette');

  const scale = generateItemSprite('market_weight_scale');
  assert.ok(countPixels(scale, (r, g, b, a) => a > 130 && g > 80 && g > r && b < 120) > 90, 'market_weight_scale should show faded green enamel');
  assert.ok(countPixels(scale, (r, g, b, a) => a > 130 && r > 145 && g > 90 && g < 175 && b < 90) > 35, 'market_weight_scale should include brass weights');
  assert.ok(countPixelsIn(scale, 22, 17, 46, 43, (_r, _g, _b, a) => a > 130) > 380, 'market_weight_scale should show pan and dial mass');
});

test('sprite bundle 027 items have distinct NII paper, noise tool, rifle, and flamer icons', () => {
  const expectedNames: Record<string, string> = {
    nii_contraband_manifest: 'Ведомость утечки НИИ',
    nii_forged_audit: 'Подложный акт НИИ',
    nii_market_receipt: 'Рыночная расписка НИИ',
    nii_sample_container: 'Тара НИИ для пробы',
    nii_sample_label: 'Наклейка НИИ для пробы',
    noise_can: 'Шумовая банка',
    nosin_rifle: 'Винтовка Носина',
    note: 'Записка',
    o15_multijet_flamer: '6О15-УТТХ',
  };
  const hashes = new Set<number>();

  for (const [id, name] of Object.entries(expectedNames)) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 800, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, Object.keys(expectedNames).length, 'bundle 027 sprites should not share exact sprite hashes');

  const manifest = generateItemSprite('nii_contraband_manifest');
  assert.ok(countPixels(manifest, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 80 && b < 190) > 500, 'NII manifest should read as yellow audit paper');
  assert.ok(countPixels(manifest, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 120, 'NII manifest should carry a red audit stamp');
  assert.ok(countPixels(manifest, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 180, 'NII manifest should include black ledger rows');

  const forged = generateItemSprite('nii_forged_audit');
  assert.ok(countPixels(forged, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 180, 'forged NII audit should show heavy red corrections');
  assert.ok(countPixels(forged, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 190, 'forged NII audit should keep dark audit rows');

  const receipt = generateItemSprite('nii_market_receipt');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 80 && b < 190) > 280, 'NII market receipt should read as a narrow paper slip');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 50, 'NII market receipt should show a red borrowed stamp');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 140, 'NII market receipt should include dark market rows/strip');

  const container = generateItemSprite('nii_sample_container');
  assert.ok(countPixels(container, (r, g, b, a) => a > 80 && g > 120 && b > 110 && r < 140) > 80, 'NII sample container should include a glass jar cue');
  assert.ok(countPixels(container, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 35, 'NII sample container should include a red seal');

  const label = generateItemSprite('nii_sample_label');
  assert.ok(countPixels(label, (r, g, b, a) => a > 80 && g > 120 && b > 110 && r < 140) > 50, 'NII sample label should carry a wet cyan-green label glow');
  assert.ok(countPixels(label, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 120, 'NII sample label should keep printed black label rows');

  const noiseCan = generateItemSprite('noise_can');
  assert.ok(countPixels(noiseCan, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 250, 'noise_can should show dark can seams, bolts, and string');
  assert.ok(countPixels(noiseCan, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 45, 'noise_can should include a red noisy warning mark');

  const rifle = generateItemSprite('nosin_rifle');
  assert.ok(countPixels(rifle, (r, g, b, a) => a > 130 && r > 70 && r > g + 20 && g > 30 && g < 95 && b < 70) > 150, 'nosin_rifle should show worn wooden stock and handguard');
  assert.ok(countPixels(rifle, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 190, 'nosin_rifle should keep a long dark bolt-action barrel');
  assert.notEqual(spriteHash(rifle), spriteHash(generateItemSprite('ak47')), 'nosin_rifle should not reuse ak47 sprite language');
  assert.notEqual(spriteHash(rifle), spriteHash(generateItemSprite('moskvin_rifle')), 'nosin_rifle should differ from the liquidator precision rifle');

  const noteSprite = generateItemSprite('note');
  assert.ok(countPixels(noteSprite, (r, g, b, a) => a > 150 && r > 145 && g > 120 && b > 80 && b < 190) > 450, 'note should read as dirty loose paper');
  assert.ok(countPixels(noteSprite, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 50, 'note should include a small red mark');

  const flamer = generateItemSprite('o15_multijet_flamer');
  assert.ok(countPixels(flamer, (r, g, b, a) => a > 120 && r < 70 && g < 80 && b < 85) > 650, 'o15_multijet_flamer should read as heavy dark engineering metal');
  assert.ok(countPixelsIn(flamer, 48, 13, 63, 25, (r, g, b, a) => a > 100 && r > 180 && g > 55 && g < 170 && b < 90) > 25, 'o15_multijet_flamer should show three hot nozzle jets');
  assert.ok(countPixels(flamer, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 80, 'o15_multijet_flamer should include red valves/service seals');
  for (const id of ['flamethrower', 'roks47_flamethrower', 'ato41_atomic_flamer']) {
    assert.notEqual(spriteHash(flamer), spriteHash(generateItemSprite(id)), `o15_multijet_flamer should not reuse ${id} sprite language`);
  }
});

test('sprite bundle 028 items read as distinct permits, quarantine medicine, anomaly photo, OЗК patch and heavy gun', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['official_permit_slip', 'Официальный корешок пропуска', ItemType.MISC],
    ['official_quarantine_clearance', 'Чистая карантинная справка', ItemType.MISC],
    ['ovb_search_warrant', 'Ордер ОВБ на обыск', ItemType.MISC],
    ['overexposed_photo', 'Засвеченный кадр', ItemType.MISC],
    ['ozk_patch', 'Заплата ОЗК', ItemType.MISC],
    ['p14_gasmask_receipt', 'Квитанция 8П14', ItemType.MISC],
    ['p41_heavy_mg', '6П41 пулемёт', ItemType.WEAPON],
    ['painkiller_pack', 'Болеутоляющее', ItemType.MEDICINE],
    ['part_ticket', 'Партбилет', ItemType.MISC],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 850, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 028 sprites should not share exact sprite hashes');

  const permit = generateItemSprite('official_permit_slip');
  assert.ok(countPixels(permit, (r, g, b, a) => a > 130 && r > 140 && g > 115 && b > 70 && r > b + 20) > 250, 'official_permit_slip needs a yellowed permit body');
  assert.ok(countPixels(permit, (r, g, b, a) => a > 130 && r > 130 && g < 100 && b < 95) > 90, 'official_permit_slip needs a red live stamp');
  assert.ok(countPixels(permit, (r, g, b, a) => a > 120 && g > 110 && r < 135 && b < 150) > 18, 'official_permit_slip needs a green ministry mark');
  assert.notEqual(spriteHash(permit), spriteHash(generateItemSprite('forged_permit_slip')), 'official permit should differ from forged permit');

  const clearance = generateItemSprite('official_quarantine_clearance');
  assert.ok(countPixels(clearance, (r, g, b, a) => a > 130 && r > 130 && g < 100 && b < 95) > 160, 'quarantine clearance needs a red medical cross');
  assert.ok(countPixels(clearance, (r, g, b, a) => a > 120 && g > 110 && r < 135 && b < 150) > 70, 'quarantine clearance needs a green clean-check mark');
  assert.notEqual(spriteHash(clearance), spriteHash(generateItemSprite('forged_quarantine_clearance')), 'official quarantine clearance should differ from forged clearance');

  const warrant = generateItemSprite('ovb_search_warrant');
  assert.ok(countPixels(warrant, (r, g, b, a) => a > 130 && r > 130 && g < 100 && b < 95) > 170, 'ovb_search_warrant needs a hard red warrant slash/stamp');
  assert.ok(countPixels(warrant, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 320, 'ovb_search_warrant needs black OVB spine and ink mass');
  assert.notEqual(spriteHash(warrant), spriteHash(generateItemSprite('confiscation_warrant')), 'OVB warrant should differ from liquidator confiscation warrant');

  const photo = generateItemSprite('overexposed_photo');
  assert.ok(countPixels(photo, (r, g, b, a) => a > 160 && r > 220 && g > 215 && b > 185) > 380, 'overexposed_photo needs a blown-out white photo face');
  assert.ok(countPixels(photo, (r, g, b, a) => a > 100 && b > 125 && g > 90 && b >= r + 20) > 45, 'overexposed_photo needs blue-violet Veretar glare');
  assert.notEqual(spriteHash(photo), spriteHash(generateItemSprite('bleached_document')), 'overexposed photo should not reuse bleached document art');

  const patch = generateItemSprite('ozk_patch');
  assert.ok(countPixels(patch, (r, g, b, a) => a > 130 && g > 80 && g >= r + 8 && r < 125 && b < 100) > 260, 'ozk_patch needs dull green rubber mass');
  assert.ok(countPixels(patch, (r, g, b, a) => a > 130 && r > 155 && g > 105 && g < 200 && b < 100) > 120, 'ozk_patch needs ochre adhesive edges');
  assert.notEqual(spriteHash(patch), spriteHash(generateItemSprite('hermo_gasket')), 'ozk patch should differ from generic rubber gasket repair items');

  const receipt = generateItemSprite('p14_gasmask_receipt');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 240, 'p14_gasmask_receipt needs dark gasmask/filter shapes');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 100 && b > 125 && g > 90 && b >= r + 20) > 45, 'p14_gasmask_receipt needs green-blue goggle glass');
  assert.notEqual(spriteHash(receipt), spriteHash(generateItemSprite('filter_receipt')), '8P14 receipt should differ from ordinary filter receipt');

  const mg = generateItemSprite('p41_heavy_mg');
  assert.ok(countPixels(mg, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 250, 'p41_heavy_mg needs black-blue heavy weapon mass');
  assert.ok(countPixels(mg, (r, g, b, a) => a > 130 && r > 155 && g > 105 && g < 200 && b < 100) > 110, 'p41_heavy_mg needs visible belt brass and service paint');
  assert.notEqual(spriteHash(mg), spriteHash(generateItemSprite('machinegun')), '6P41 heavy MG should differ from generic machinegun');
  assert.notEqual(spriteHash(mg), spriteHash(generateItemSprite('g41_grenade_launcher')), '6P41 heavy MG should differ from other mounted production-belt weapons');

  const painkiller = generateItemSprite('painkiller_pack');
  assert.ok(countPixels(painkiller, (r, g, b, a) => a > 150 && Math.abs(r - g) < 28 && Math.abs(g - b) < 42 && r > 150) > 260, 'painkiller pack needs foil blister mass');
  assert.ok(countPixels(painkiller, (r, g, b, a) => a > 130 && r > 130 && g < 100 && b < 95) > 170, 'painkiller pack needs red medical striping');
  assert.notEqual(spriteHash(painkiller), spriteHash(generateItemSprite('pills')), 'painkiller pack should differ from generic pills');

  const ticket = generateItemSprite('part_ticket');
  assert.ok(countPixels(ticket, (r, g, b, a) => a > 130 && r > 120 && g < 90 && b < 90) > 300, 'part_ticket needs a red party-book cover');
  assert.ok(countPixels(ticket, (r, g, b, a) => a > 130 && r > 155 && g > 105 && g < 200 && b < 100) > 95, 'part_ticket needs gold party marks');
  assert.notEqual(spriteHash(ticket), spriteHash(generateItemSprite('official_permit_slip')), 'party ticket should differ from ordinary permit slip');
});

test('sprite bundle 030 items read as distinct pipe, launcher, plasma, service electronics, probe kit, smg, and red sugar icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['pipe', 'Труба', ItemType.WEAPON],
    ['pistol_grenade_launcher', 'Пистолет-гранатомёт', ItemType.WEAPON],
    ['plasma', 'Плазмаган', ItemType.WEAPON],
    ['plastic_sheet', 'Пластик', ItemType.MISC],
    ['pneumomail_capsule', 'Опечатанная пневмокапсула', ItemType.MISC],
    ['portable_siren_key', 'Ключ переносной сирены', ItemType.MISC],
    ['post_samosbor_probe_kit', 'Набор замера после самосбора', ItemType.MISC],
    ['ppsh', 'ППШ', ItemType.WEAPON],
    ['pressed_sugar', 'Красняк прессованный', ItemType.FOOD],
  ];

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 030 sprites should not share exact sprite hashes');

  const pipe = generateItemSprite('pipe');
  assert.ok(countPixels(pipe, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 350, 'pipe should show dark hollow steel mass');
  assert.ok(countPixels(pipe, (r, g, b, a) => a > 120 && r > 130 && g < 100 && b < 95) > 30, 'pipe should include rusty red wear and service wrap');
  assert.ok(countPixelsIn(pipe, 12, 16, 54, 49, (_r, _g, _b, a) => a > 120) > 520, 'pipe should keep a strong diagonal melee silhouette');

  const launcher = generateItemSprite('pistol_grenade_launcher');
  assert.ok(countPixels(launcher, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 420, 'pistol grenade launcher should read as black-blue militia metal');
  assert.ok(countPixels(launcher, (r, g, b, a) => a > 120 && r > 155 && g > 105 && g < 205 && b < 105) > 20, 'pistol grenade launcher should include warning paint');
  assert.ok(countPixelsIn(launcher, 38, 23, 58, 36, (_r, _g, _b, a) => a > 120) > 150, 'pistol grenade launcher should show a chunky muzzle cup');
  assert.notEqual(spriteHash(launcher), spriteHash(generateItemSprite('grenade')), 'pistol grenade launcher should not collapse to a grenade oval');

  const plasma = generateItemSprite('plasma');
  assert.ok(countPixels(plasma, (r, g, b, a) => a > 80 && g > 130 && b > 120 && r < 140) > 80, 'plasma should include a cyan charge coil and muzzle');
  assert.ok(countPixels(plasma, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 350, 'plasma should keep dark weapon casing');
  assert.notEqual(spriteHash(plasma), spriteHash(generateItemSprite('bfg')), 'plasma should differ from the oversized BFG');
  assert.notEqual(spriteHash(plasma), spriteHash(generateItemSprite('gauss')), 'plasma should differ from gauss rifle');

  const plastic = generateItemSprite('plastic_sheet');
  assert.ok(countPixels(plastic, (r, g, b, a) => a > 120 && r > 145 && g > 145 && b > 125) > 480, 'plastic_sheet should show pale stacked plastic panels');
  assert.ok(countPixels(plastic, (r, g, b, a) => a > 80 && g > 130 && b > 120 && r < 140) > 18, 'plastic_sheet should include cyan dead pixels');
  assert.ok(countPixels(plastic, (r, g, b, a) => a > 120 && r > 130 && g < 100 && b < 95) > 15, 'plastic_sheet should include a red error slit');

  const capsule = generateItemSprite('pneumomail_capsule');
  assert.ok(countPixels(capsule, (r, g, b, a) => a > 130 && r > 135 && g > 85 && g < 195 && b < 105) > 190, 'pneumomail capsule should read as a brass tube');
  assert.ok(countPixels(capsule, (r, g, b, a) => a > 120 && r > 130 && g < 100 && b < 95) > 80, 'pneumomail capsule should include a red seal');
  assert.ok(countPixels(capsule, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 300, 'pneumomail capsule should keep dark tube caps and ink');

  const sirenKey = generateItemSprite('portable_siren_key');
  assert.ok(countPixels(sirenKey, (r, g, b, a) => a > 130 && r > 135 && g > 85 && g < 195 && b < 105) > 70, 'portable_siren_key should show brass key teeth');
  assert.ok(countPixels(sirenKey, (r, g, b, a) => a > 120 && r > 130 && g < 100 && b < 95) > 40, 'portable_siren_key should include a red siren warning block');
  assert.ok(countPixels(sirenKey, (r, g, b, a) => a > 80 && g > 130 && b > 120 && r < 140) > 8, 'portable_siren_key should include cyan electronics pixels');

  const probeKit = generateItemSprite('post_samosbor_probe_kit');
  assert.ok(countPixels(probeKit, (r, g, b, a) => a > 80 && g > 130 && b > 120 && r < 140) > 100, 'post_samosbor_probe_kit should include cyan probes and sample lights');
  assert.ok(countPixels(probeKit, (r, g, b, a) => a > 120 && r > 155 && g > 105 && g < 205 && b < 105) > 35, 'post_samosbor_probe_kit should include yellow field labels');
  assert.ok(countPixels(probeKit, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 250, 'post_samosbor_probe_kit should read as a dark field case');

  const ppsh = generateItemSprite('ppsh');
  assert.ok(countPixels(ppsh, (r, g, b, a) => a > 130 && r > 70 && r > g + 20 && g > 30 && g < 95 && b < 70) > 180, 'ppsh should show a worn wooden stock');
  assert.ok(countPixelsIn(ppsh, 25, 35, 44, 51, (_r, _g, _b, a) => a > 120) > 220, 'ppsh should show a drum magazine');
  assert.ok(countPixels(ppsh, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 350, 'ppsh should keep dark SMG metal');
  assert.notEqual(spriteHash(ppsh), spriteHash(generateItemSprite('machinegun')), 'ppsh should differ from generic machinegun');

  const sugar = generateItemSprite('pressed_sugar');
  assert.ok(countPixels(sugar, (r, g, b, a) => a > 120 && r > 130 && g < 100 && b < 95) > 180, 'pressed_sugar should read as red concentrate');
  assert.ok(countPixels(sugar, (r, g, b, a) => a > 130 && g > 80 && g >= r + 8 && r < 125 && b < 100) > 20, 'pressed_sugar should include a dull green risk mark');
  assert.ok(countPixels(sugar, (r, g, b, a) => a > 130 && r > 145 && g > 120 && b > 70 && r > b + 20) > 320, 'pressed_sugar should keep dirty wrapper mass');
});

test('sprite bundle 023 items read as distinct liquidator, lift, medicine, sample, and trade icons', () => {
  const expected = [
    ['lamp_bulb', 'Лампа'],
    ['lice_shampoo', 'Шампунь от вшей'],
    ['lift_scheme', 'Схема лифтов'],
    ['lime_bucket', 'Ведро извести'],
    ['liquidator_axe', 'Топор ликвидатора'],
    ['liquidator_field_roster', 'Полевая ведомость ликвидаторов'],
    ['liquidator_flashlamp', 'Переносной прожектор'],
    ['liquidator_issue_card', 'Карточка выдачи ликвидатора'],
    ['liquidator_rake', 'Грабли ликвидатора 0Г15'],
  ];
  const hashes = new Set<number>();

  for (const [id, name] of expected) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 023 sprites should not share exact sprite hashes');

  const lamp = generateItemSprite('lamp_bulb');
  assert.ok(countPixelsIn(lamp, 22, 16, 43, 41, (_r, _g, _b, a) => a > 70) > 300, 'lamp_bulb needs a readable glass bulb');
  assert.ok(countPixelsIn(lamp, 24, 42, 40, 50, (r, g, b, a) => a > 130 && r < 115 && g < 120 && b < 115) > 85, 'lamp_bulb needs a dark metal cap');
  assert.ok(countPixels(lamp, (r, g, b, a) => a > 120 && ((r > 155 && g > 95 && g < 180 && b < 95) || (r > 130 && g < 95 && b < 90))) > 60, 'lamp_bulb needs filament and trade tag accents');

  const shampoo = generateItemSprite('lice_shampoo');
  assert.ok(countPixels(shampoo, (r, g, b, a) => a > 130 && r > 170 && g > 160 && b > 120) > 250, 'lice_shampoo needs a pale medical bottle/label');
  assert.ok(countPixels(shampoo, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 65, 'lice_shampoo needs a red medical cross');
  assert.ok(countPixels(shampoo, (r, g, b, a) => a > 100 && g > 110 && r < 140 && b < 150) > 100, 'lice_shampoo needs green sanitary plastic/liquid');

  const scheme = generateItemSprite('lift_scheme');
  assert.ok(countPixels(scheme, (r, g, b, a) => a > 100 && b > 110 && g > 80 && b >= r + 15) > 55, 'lift_scheme needs blue lift shaft marks');
  assert.ok(countPixels(scheme, (r, g, b, a) => a > 100 && g > 110 && r < 140 && b < 150) > 90, 'lift_scheme needs green cabin blocks');
  assert.ok(countPixels(scheme, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 100, 'lift_scheme needs a red route trace');

  const lime = generateItemSprite('lime_bucket');
  assert.ok(countPixelsIn(lime, 17, 22, 47, 51, (_r, _g, _b, a) => a > 120) > 650, 'lime_bucket needs a heavy bucket silhouette');
  assert.ok(countPixels(lime, (r, g, b, a) => a > 130 && r > 170 && g > 160 && b > 120) > 110, 'lime_bucket needs visible dry lime');
  assert.ok(countPixels(lime, (r, g, b, a) => a > 100 && g > 110 && r < 140 && b < 150) > 90, 'lime_bucket needs reagent dust');

  const axe = generateItemSprite('liquidator_axe');
  assert.ok(countPixelsIn(axe, 34, 10, 58, 31, (_r, _g, _b, a) => a > 120) > 400, 'liquidator_axe needs a heavy axe head');
  assert.ok(countPixels(axe, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 380, 'liquidator_axe needs black-blue service metal');
  assert.ok(countPixels(axe, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 100, 'liquidator_axe needs red liquidator paint');
  assert.notEqual(spriteHash(axe), spriteHash(generateItemSprite('axe')), 'liquidator_axe should differ from generic axe');

  const roster = generateItemSprite('liquidator_field_roster');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 280, 'liquidator_field_roster needs dark roster rows');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 120, 'liquidator_field_roster needs red stamp marks');
  assert.ok(countPixels(roster, (r, g, b, a) => a > 100 && g > 110 && r < 140 && b < 150) > 50, 'liquidator_field_roster needs route/check marks');

  const flashlamp = generateItemSprite('liquidator_flashlamp');
  assert.ok(countPixels(flashlamp, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 500, 'liquidator_flashlamp needs dark heavy lamp metal');
  assert.ok(countPixels(flashlamp, (r, g, b, a) => a > 120 && r > 155 && g > 105 && g < 210 && b < 110) > 80, 'liquidator_flashlamp needs a yellow work lens');
  assert.ok(countPixelsIn(flashlamp, 14, 32, 50, 54, (_r, _g, _b, a) => a > 120) > 500, 'liquidator_flashlamp needs bulky battery/handle mass');
  assert.notEqual(spriteHash(flashlamp), spriteHash(generateItemSprite('flashlight')), 'liquidator_flashlamp should differ from flashlight');

  const issueCard = generateItemSprite('liquidator_issue_card');
  assert.ok(countPixels(issueCard, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 170, 'liquidator_issue_card needs strong red issue strip/stamp');
  assert.ok(countPixels(issueCard, (r, g, b, a) => a > 100 && b > 110 && g > 80 && b >= r + 15) > 18, 'liquidator_issue_card needs blue issue boxes');
  assert.ok(countPixels(issueCard, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 200, 'liquidator_issue_card needs printed rows and punch detail');

  const rake = generateItemSprite('liquidator_rake');
  assert.ok(countPixelsIn(rake, 34, 10, 58, 31, (_r, _g, _b, a) => a > 120) > 350, 'liquidator_rake needs a readable tine head');
  assert.ok(countPixels(rake, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 85) > 380, 'liquidator_rake needs dark service metal');
  assert.ok(countPixels(rake, (r, g, b, a) => a > 100 && g > 110 && r < 140 && b < 150) > 180, 'liquidator_rake needs slime cleanup residue');
  assert.notEqual(spriteHash(rake), spriteHash(generateItemSprite('rusty_rake')), 'liquidator_rake should differ from rusty_rake');
});

test('sprite bundle 025 items read as distinct artifact, weapon, drink, document, and trade icons', () => {
  const expected: Array<[string, string, ItemType, number]> = [
    ['maronary_shaving', 'Зелёная стружка', ItemType.MISC, 560],
    ['meat_rune', 'Мясная руна', ItemType.MISC, 900],
    ['metal_chair', 'Металлический стул', ItemType.WEAPON, 820],
    ['metal_sheet', 'Лист металла', ItemType.MISC, 1000],
    ['metal_water', 'Вода с привкусом металла', ItemType.DRINK, 850],
    ['metro_ticket', 'Билет метро', ItemType.MISC, 850],
    ['ministry_audit_forgery', 'Липовое аудиторское предписание', ItemType.MISC, 1300],
    ['ministry_clean_stamp', 'Чистая министерская печать', ItemType.MISC, 900],
    ['missing_record_file', 'Пропавшее личное дело', ItemType.MISC, 1100],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type, minOpaque] of expected) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    assert.equal(ITEMS[id]?.type, type, `${id} item type should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > minOpaque, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 025 sprites should not share exact sprite hashes');

  const maronary = generateItemSprite('maronary_shaving');
  assert.ok(countPixels(maronary, (r, g, b, a) => a > 120 && g > 130 && r < 150 && b < 150) > 95, 'maronary_shaving needs green shaving material');
  assert.ok(countPixels(maronary, (r, g, b, a) => a > 120 && b > 120 && r < 150) > 55, 'maronary_shaving needs violet-blue anomalous seams');
  assert.ok(countPixelsIn(maronary, 25, 27, 38, 39, (_r, _g, _b, a) => a > 130) > 45, 'maronary_shaving needs a small eye/enamel core');

  const rune = generateItemSprite('meat_rune');
  assert.ok(countPixels(rune, (r, g, b, a) => a > 130 && r > 120 && g < 100 && b < 95) > 280, 'meat_rune needs a red flesh slab');
  assert.ok(countPixels(rune, (r, g, b, a) => a > 130 && r > 170 && g > 130 && b > 80 && b < 170) > 45, 'meat_rune needs fatty/tan rune cuts');
  assert.ok(countPixels(rune, (r, g, b, a) => a > 120 && r < 70 && g < 60 && b < 60) > 260, 'meat_rune needs dark carved marks');

  const chair = generateItemSprite('metal_chair');
  assert.ok(countPixels(chair, (r, g, b, a) => a > 120 && Math.abs(r - g) < 28 && Math.abs(g - b) < 36 && r > 60 && r < 190) > 220, 'metal_chair needs grey-blue metal frame mass');
  assert.ok(countPixelsIn(chair, 34, 10, 53, 31, (_r, _g, _b, a) => a > 120) > 260, 'metal_chair needs a readable chair back');
  assert.ok(countPixelsIn(chair, 15, 40, 54, 57, (_r, _g, _b, a) => a > 120) > 180, 'metal_chair needs chair legs/weapon silhouette');

  const sheet = generateItemSprite('metal_sheet');
  assert.ok(countPixels(sheet, (r, g, b, a) => a > 120 && Math.abs(r - g) < 28 && Math.abs(g - b) < 36 && r > 60 && r < 190) > 430, 'metal_sheet needs broad sheet-metal mass');
  assert.ok(countPixels(sheet, (r, g, b, a) => a > 120 && r < 70 && g < 70 && b < 70) > 150, 'metal_sheet needs dark scored edges');
  assert.ok(countPixels(sheet, (r, g, b, a) => a > 110 && r > 100 && r > g + 20 && g > 35 && b < 80) > 130, 'metal_sheet needs rust and warning-tag accents');

  const water = generateItemSprite('metal_water');
  assert.ok(countPixels(water, (r, g, b, a) => a > 120 && g > 130 && b > 130 && r < 150) > 240, 'metal_water needs cyan-green liquid through glass');
  assert.ok(countPixels(water, (r, g, b, a) => a > 110 && r > 100 && r > g + 20 && g > 35 && b < 90) > 55, 'metal_water needs rusty metal taste cues');
  assert.notEqual(spriteHash(water), spriteHash(generateItemSprite('filtered_water')), 'metal_water should differ from filtered water');

  const ticket = generateItemSprite('metro_ticket');
  assert.ok(countPixels(ticket, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 60 && b < 180) > 220, 'metro_ticket needs yellow ticket paper');
  assert.ok(countPixels(ticket, (r, g, b, a) => a > 120 && b > 110 && g > 75 && b > r + 15) > 30, 'metro_ticket needs blue route block');
  assert.ok(countPixels(ticket, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 50, 'metro_ticket needs a red punch/stamp');
  assert.notEqual(spriteHash(ticket), spriteHash(generateItemSprite('lift_scheme')), 'metro_ticket should differ from lift scheme paperwork');

  const audit = generateItemSprite('ministry_audit_forgery');
  assert.ok(countPixels(audit, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 60 && b < 180) > 500, 'ministry_audit_forgery needs yellow ministry paper');
  assert.ok(countPixels(audit, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 150, 'ministry_audit_forgery needs strong false red stamps');
  assert.ok(countPixels(audit, (r, g, b, a) => a > 120 && r < 70 && g < 70 && b < 70) > 200, 'ministry_audit_forgery needs black audit rows');

  const stamp = generateItemSprite('ministry_clean_stamp');
  assert.ok(countPixels(stamp, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 240, 'ministry_clean_stamp needs dominant red clean seal wax');
  assert.ok(countPixels(stamp, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 60 && b < 180) > 90, 'ministry_clean_stamp needs attached yellow paper backing');
  assert.notEqual(spriteHash(stamp), spriteHash(generateItemSprite('forged_stamp_sheet')), 'ministry_clean_stamp should differ from stamped sheet paperwork');

  const file = generateItemSprite('missing_record_file');
  assert.ok(countPixels(file, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 60 && b < 180) > 450, 'missing_record_file needs folder and exposed file paper');
  assert.ok(countPixels(file, (r, g, b, a) => a > 120 && r < 75 && g < 65 && b < 60) > 220, 'missing_record_file needs dark archive rows and torn-card void');
  assert.ok(countPixels(file, (r, g, b, a) => a > 110 && r > 110 && r > g + 20 && g > 35 && b < 90) > 35, 'missing_record_file needs red/rust archive marks');
  assert.notEqual(spriteHash(file), spriteHash(generateItemSprite('personal_file_copy')), 'missing_record_file should differ from ordinary personal file copy');
});

test('sprite bundle 026 items have distinct drink, medicine, weapon, food, sample, ammo, and complaint icons', () => {
  const entries = [
    ['moonshine_still_part', 'Деталь самогонного аппарата', ItemType.MISC],
    ['morphine_ampoule', 'Ампула морфина', ItemType.MEDICINE],
    ['moskvin_rifle', 'Винтовка Москвина', ItemType.WEAPON],
    ['mushroom_mass', 'Грибная масса', ItemType.FOOD],
    ['mutant_tissue_sample', 'Образец ткани твари', ItemType.MISC],
    ['nagant', 'Револьвер Наган', ItemType.WEAPON],
    ['nailgun', 'Гвоздомёт', ItemType.WEAPON],
    ['napalm_mix', 'Напалмовая смесь', ItemType.AMMO],
    ['neighbor_complaint', 'Жалоба соседа', ItemType.MISC],
  ] as const;
  const hashes = new Set<number>();

  for (const [id, name, type] of entries) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    assert.equal(ITEMS[id]?.type, type, `${id} item type should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 280, `${id} should have enough mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(hashes.size, entries.length, 'bundle 026 sprites should not share exact sprite hashes');

  const moonshine = generateItemSprite('moonshine_still_part');
  assert.ok(countPixels(moonshine, (r, g, b, a) => a > 120 && r > 115 && g > 45 && g < 150 && b < 95) > 70, 'moonshine_still_part should show copper still hardware');
  assert.ok(countPixels(moonshine, (r, g, b, a) => a > 100 && g > 120 && b > 110 && r < 130) > 25, 'moonshine_still_part should show cyan/green liquid in glass');
  assert.notEqual(spriteHash(moonshine), spriteHash(generateItemSprite('alcohol_bottle')), 'moonshine_still_part should differ from a simple alcohol bottle');

  const morphine = generateItemSprite('morphine_ampoule');
  assert.ok(countPixels(morphine, (r, g, b, a) => a > 100 && g > 150 && b > 115 && r < 160) > 30, 'morphine_ampoule should show medicinal liquid');
  assert.ok(countPixels(morphine, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 95) > 40, 'morphine_ampoule should include a red medical cross/mark');
  assert.ok(countPixelsIn(morphine, 18, 12, 44, 50, (_r, _g, _b, a) => a > 80) > 220, 'morphine_ampoule should keep a diagonal glass ampoule silhouette');

  const moskvin = generateItemSprite('moskvin_rifle');
  assert.ok(countPixelsIn(moskvin, 43, 16, 62, 30, (_r, _g, _b, a) => a > 120) > 45, 'moskvin_rifle should show a long muzzle/barrel');
  assert.ok(countPixels(moskvin, (r, g, b, a) => a > 120 && r > 70 && r < 170 && g > 35 && g < 105 && b < 80) > 90, 'moskvin_rifle should show wooden rifle furniture');
  assert.ok(countPixels(moskvin, (r, g, b, a) => a > 120 && r < 95 && g < 110 && b < 120) > 120, 'moskvin_rifle should show dark blued metal');
  assert.notEqual(spriteHash(moskvin), spriteHash(generateItemSprite('nosin_rifle')), 'moskvin_rifle should differ from nosin_rifle');

  const mushroom = generateItemSprite('mushroom_mass');
  assert.ok(countPixels(mushroom, (r, g, b, a) => a > 110 && g > 80 && r < 180 && b < 130) > 190, 'mushroom_mass should read as green fungal matter');
  assert.ok(countPixels(mushroom, (r, g, b, a) => a > 120 && r > 80 && r < 190 && g > 50 && g < 150 && b < 100) > 120, 'mushroom_mass should include brown organic caps/wet mass');
  assert.notEqual(spriteHash(mushroom), spriteHash(generateItemSprite('infected_mushroom')), 'mushroom_mass should differ from infected_mushroom');

  const tissue = generateItemSprite('mutant_tissue_sample');
  assert.ok(countPixels(tissue, (r, g, b, a) => a > 110 && r > 110 && g < 100 && b < 120) > 70, 'mutant_tissue_sample should show red organic tissue');
  assert.ok(countPixels(tissue, (r, g, b, a) => a > 90 && g > 120 && b > 110 && r < 140) > 80, 'mutant_tissue_sample should show greenish glass/sample glow');
  assert.ok(countPixelsIn(tissue, 30, 37, 40, 45, (_r, _g, _b, a) => a > 120) > 35, 'mutant_tissue_sample should include an eye-like preserved bubble');

  const nagant = generateItemSprite('nagant');
  assert.ok(countPixelsIn(nagant, 25, 28, 42, 44, (_r, _g, _b, a) => a > 120) > 130, 'nagant should show a revolver cylinder');
  assert.ok(countPixelsIn(nagant, 17, 39, 32, 54, (_r, _g, _b, a) => a > 120) > 90, 'nagant should show a compact angled grip');
  assert.ok(countPixels(nagant, (r, g, b, a) => a > 120 && r < 95 && g < 110 && b < 120) > 170, 'nagant should show dark gunmetal');
  assert.notEqual(spriteHash(nagant), spriteHash(generateItemSprite('homemade_pistol')), 'nagant should differ from homemade_pistol');

  const nailgun = generateItemSprite('nailgun');
  assert.ok(countPixels(nailgun, (r, g, b, a) => a > 120 && r > 140 && g > 85 && g < 180 && b < 85) > 130, 'nailgun should show yellow industrial housing');
  assert.ok(countPixelsIn(nailgun, 42, 40, 54, 55, (_r, _g, _b, a) => a > 120) > 85, 'nailgun should show a nail magazine');
  assert.ok(countPixels(nailgun, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 8, 'nailgun should include a cyan pressure/rivet cue');
  assert.notEqual(spriteHash(nailgun), spriteHash(generateItemSprite('ammo_nails')), 'nailgun should differ from nail ammo');

  const napalm = generateItemSprite('napalm_mix');
  assert.ok(countPixels(napalm, (r, g, b, a) => a > 110 && r > 170 && g > 55 && g < 180 && b < 90) > 120, 'napalm_mix should show orange/red fuel');
  assert.ok(countPixels(napalm, (r, g, b, a) => a > 120 && r < 150 && g < 160 && b < 150) > 280, 'napalm_mix should show a steel canister');
  assert.ok(countPixelsIn(napalm, 40, 34, 52, 42, (r, g, b, a) => a > 90 && r > 170 && g > 55 && b < 100) > 12, 'napalm_mix should include leaking fuel/spill detail');
  assert.notEqual(spriteHash(napalm), spriteHash(generateItemSprite('ammo_fuel')), 'napalm_mix should differ from ammo_fuel');

  const complaint = generateItemSprite('neighbor_complaint');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 130 && r > 160 && g > 135 && b > 90 && b < 210) > 700, 'neighbor_complaint should read as yellowed paper');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 115 && r > 130 && g < 95 && b < 90) > 130, 'neighbor_complaint should include an angry red complaint stamp');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 110 && r < 70 && g < 70 && b < 70) > 140, 'neighbor_complaint should include dark handwriting/print');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 100 && b > 100 && r < 100 && g < 130) > 20, 'neighbor_complaint should include a blue apartment/household form cue');
  assert.notEqual(spriteHash(complaint), spriteHash(generateItemSprite('denunciation')), 'neighbor_complaint should differ from denunciation');
});

test('sprite bundle 034 items have distinct shotgun, quarantine, radio and rail icons', () => {
  const entries = [
    ['pushkin_shotgun', 'Ружьё «Пушкин»', ItemType.WEAPON],
    ['quarantine_breach_notice', 'Извещение о нарушении карантина', ItemType.MISC],
    ['quarantine_medcard', 'Карантинная медкарта', ItemType.MISC],
    ['radio', 'Рация', ItemType.TOOL],
    ['radio_headset_liquidator', 'Гарнитура ликвидатора', ItemType.TOOL],
    ['radio_jammer', 'Карманная глушилка', ItemType.MISC],
    ['rail_depot_pass', 'Пропуск в депо', ItemType.MISC],
    ['rail_signal_lamp', 'Сигнальная лампа депо', ItemType.MISC],
  ] as const;
  const hashes = new Set<number>();

  for (const [id, name, type] of entries) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    assert.equal(ITEMS[id]?.type, type, `${id} item type should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, entries.length, 'bundle 034 sprites should not share exact sprite hashes');

  const pushkin = generateItemSprite('pushkin_shotgun');
  assert.ok(countPixelsIn(pushkin, 10, 19, 61, 52, (_r, _g, _b, a) => a > 120) > 330, 'Pushkin shotgun should keep a strong diagonal weapon silhouette');
  assert.ok(countPixels(pushkin, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 95) > 210, 'Pushkin shotgun should show black-blue tactical metal');
  assert.ok(countPixels(pushkin, (r, g, b, a) => a > 130 && ((r > 165 && g > 110 && b < 95) || (r > 140 && g < 90 && b < 85))) > 24, 'Pushkin shotgun should include red/yellow service marks');
  assert.notEqual(spriteHash(pushkin), spriteHash(generateItemSprite('chizh3_shotgun')), 'Pushkin shotgun should differ from Chizh-3');
  assert.notEqual(spriteHash(pushkin), spriteHash(generateItemSprite('granit4u_belt_shotgun')), 'Pushkin shotgun should differ from belt-fed Granit shotgun');

  const notice = generateItemSprite('quarantine_breach_notice');
  assert.ok(countPixels(notice, (r, g, b, a) => a > 145 && r > 145 && g > 110 && b > 60 && b < 170) > 600, 'quarantine breach notice should read as yellowed paper');
  assert.ok(countPixels(notice, (r, g, b, a) => a > 125 && r > 135 && g < 95 && b < 90) > 140, 'quarantine breach notice should show strong red quarantine marks');

  const medcard = generateItemSprite('quarantine_medcard');
  assert.ok(countPixels(medcard, (r, g, b, a) => a > 145 && r > 165 && g > 155 && b > 115) > 470, 'quarantine medcard should read as pale medical card');
  assert.ok(countPixels(medcard, (r, g, b, a) => a > 130 && r > 135 && g < 100 && b < 100) > 160, 'quarantine medcard should show red medical/quarantine cross marks');
  assert.ok(countPixels(medcard, (r, g, b, a) => a > 120 && g > 115 && r < 145 && b < 150) > 45, 'quarantine medcard should include green medical status fields');
  assert.notEqual(spriteHash(medcard), spriteHash(generateItemSprite('clean_health_cert')), 'quarantine medcard should differ from clean health certificate');

  const radio = generateItemSprite('radio');
  assert.ok(countPixels(radio, (r, g, b, a) => a > 130 && r < 85 && g < 105 && b < 105) > 330, 'radio should read as dark bakelite radio body');
  assert.ok(countPixelsIn(radio, 15, 7, 28, 22, (r, g, b, a) => a > 120 && Math.abs(r - g) < 35 && Math.abs(g - b) < 50 && r > 90) > 10, 'radio should show a raised antenna');
  assert.ok(countPixels(radio, (r, g, b, a) => a > 120 && g > 145 && b > 120 && r < 120) > 10, 'radio should include cyan working pixels');

  const headset = generateItemSprite('radio_headset_liquidator');
  assert.ok(countPixelsIn(headset, 14, 16, 52, 50, (r, g, b, a) => a > 125 && r < 90 && g < 110 && b < 110) > 210, 'liquidator headset should show dark earpads and cable body');
  assert.ok(countPixels(headset, (r, g, b, a) => a > 70 && g > 145 && b > 125 && r < 125) > 45, 'liquidator headset should include weak cyan radio glow');
  assert.ok(countPixels(headset, (r, g, b, a) => a > 120 && ((r > 145 && g < 95 && b < 90) || (r > 165 && g > 120 && b < 95))) > 15, 'liquidator headset should carry red/yellow service tags');

  const jammer = generateItemSprite('radio_jammer');
  assert.ok(countPixels(jammer, (r, g, b, a) => a > 130 && r < 95 && g < 110 && b < 110) > 300, 'radio jammer should read as compact dark transmitter');
  assert.ok(countPixels(jammer, (r, g, b, a) => a > 120 && r > 145 && g < 100 && b < 95) > 45, 'radio jammer should show red noise/error marks');
  assert.ok(countPixels(jammer, (r, g, b, a) => a > 110 && g > 145 && b > 120 && r < 125) > 16, 'radio jammer should include cyan interference ticks');
  assert.notEqual(spriteHash(jammer), spriteHash(generateItemSprite('noise_can')), 'radio jammer should differ from noise can');

  const railPass = generateItemSprite('rail_depot_pass');
  assert.ok(countPixels(railPass, (r, g, b, a) => a > 145 && r > 145 && g > 115 && b > 55 && b < 160) > 500, 'rail depot pass should read as yellow transport permit');
  assert.ok(countPixelsIn(railPass, 29, 25, 52, 43, (r, g, b, a) => a > 120 && r < 105 && g < 115 && b < 120) > 45, 'rail depot pass should include rail-track marks');
  assert.ok(countPixels(railPass, (r, g, b, a) => a > 120 && b > 105 && r < 105 && g > 70 && g < 150) > 45, 'rail depot pass should include a blue transport strip');

  const lamp = generateItemSprite('rail_signal_lamp');
  assert.ok(countPixels(lamp, (r, g, b, a) => a > 140 && Math.abs(r - g) < 45 && b > 110 && r > 120) > 300, 'rail signal lamp should show pale worn signal casing');
  assert.ok(countPixels(lamp, (r, g, b, a) => a > 100 && r > 150 && g < 95 && b < 90) > 160, 'rail signal lamp should show a red signal lens');
  assert.ok(countPixels(lamp, (r, g, b, a) => a > 100 && g > 145 && b > 120 && r < 125) > 18, 'rail signal lamp should include cyan dead pixels/glow');
  assert.notEqual(spriteHash(lamp), spriteHash(generateItemSprite('lamp_bulb')), 'rail signal lamp should differ from a loose lamp bulb');
});

test('sprite bundle 032 psi clots read as distinct weapon charges', () => {
  const entries = [
    ['psi_mark', 'Сгусток: Метка'],
    ['psi_meat_hook', 'Сгусток: Мясной крюк'],
    ['psi_order_seal', 'Сгусток: Печать порядка'],
    ['psi_phase', 'Сгусток: Фазовый сдвиг'],
    ['psi_recall', 'Сгусток: Возврат'],
    ['psi_rupture', 'Сгусток: Разрыв'],
    ['psi_shadow_lance', 'Сгусток: Теневая пика'],
    ['psi_siren_pulse', 'Сгусток: Сиренный импульс'],
  ] as const;
  const hashes = new Set<number>();
  const genericPsiHash = spriteHash(generateItemSprite('psi_strike'));

  for (const [id, name] of entries) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    assert.equal(ITEMS[id]?.type, ItemType.WEAPON, `${id} item type should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} corner background should stay transparent`);
    assert.ok(opaquePixels(sprite) > 1000, `${id} should have enough visible mass for world drops and inventory icons`);
    assert.notEqual(spriteHash(sprite), genericPsiHash, `${id} should not reuse the generic psi weapon sprite`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(hashes.size, entries.length, 'bundle 032 psi sprites should not share exact sprite hashes');

  const mark = generateItemSprite('psi_mark');
  assert.ok(countPixels(mark, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 180, 'psi_mark should include a red target mark');
  assert.ok(countPixels(mark, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 100) > 30, 'psi_mark should include a yellow service tag');

  const meatHook = generateItemSprite('psi_meat_hook');
  assert.ok(countPixels(meatHook, (r, g, b, a) => a > 120 && r < 45 && g < 45 && b < 60) > 430, 'psi_meat_hook should read as a dark hooked clot');
  assert.ok(countPixels(meatHook, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 25, 'psi_meat_hook should include red organic tissue');

  const orderSeal = generateItemSprite('psi_order_seal');
  assert.ok(countPixelsIn(orderSeal, 22, 23, 43, 43, (_r, _g, _b, a) => a > 160) > 350, 'psi_order_seal should keep a compact seal block silhouette');
  assert.ok(countPixels(orderSeal, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 100) > 28, 'psi_order_seal should include yellow office seal lines');

  const phase = generateItemSprite('psi_phase');
  assert.ok(countPixels(phase, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 180, 'psi_phase should include cyan phase-slit pixels');
  assert.ok(countPixels(phase, (r, g, b, a) => a > 100 && b > 110 && r < 190 && g < 170) > 90, 'psi_phase should keep violet-blue displaced mass');

  const recall = generateItemSprite('psi_recall');
  assert.ok(countPixels(recall, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 280, 'psi_recall should include a cyan return loop');
  assert.ok(countPixels(recall, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 25, 'psi_recall should include a red marked anchor');

  const rupture = generateItemSprite('psi_rupture');
  assert.ok(countPixels(rupture, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 70, 'psi_rupture should include red rupture cracks');
  assert.ok(countPixels(rupture, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 100) > 35, 'psi_rupture should include yellow blast stress');

  const shadowLance = generateItemSprite('psi_shadow_lance');
  assert.ok(countPixels(shadowLance, (r, g, b, a) => a > 120 && r < 45 && g < 45 && b < 60) > 260, 'psi_shadow_lance should read as a black lance');
  assert.ok(countPixelsIn(shadowLance, 42, 10, 59, 25, (_r, _g, _b, a) => a > 120) > 80, 'psi_shadow_lance should show a pointed upper tip');

  const siren = generateItemSprite('psi_siren_pulse');
  assert.ok(countPixels(siren, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 160, 'psi_siren_pulse should include a red siren block');
  assert.ok(countPixels(siren, (r, g, b, a) => a > 100 && g > 130 && b > 120 && r < 130) > 240, 'psi_siren_pulse should include cyan pulse waves');
});

test('sprite bundle 033 items read as distinct psi, liquidator, pump, and medical paperwork icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['psi_stabilizer', 'ПСИ-стабилизатор', ItemType.MEDICINE],
    ['psi_storm', 'Сгусток: Пси буря', ItemType.WEAPON],
    ['psi_strike', 'Сгусток: Пси удар', ItemType.WEAPON],
    ['psi_void_needle', 'Сгусток: Пустотная игла', ItemType.WEAPON],
    ['psychiatrist_referral', 'Направление к психиатру', ItemType.MISC],
    ['ptrs_liquidator', 'ПТРС ликвидатора', ItemType.WEAPON],
    ['pump_impeller', 'Крыльчатка насоса', ItemType.MISC],
    ['pump_passport', 'Паспорт насоса', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 033 sprites should not share exact sprite hashes');

  const stabilizer = generateItemSprite('psi_stabilizer');
  assert.ok(countPixels(stabilizer, (r, g, b, a) => a > 120 && g > 145 && b > 110 && r < 160) > 55, 'psi_stabilizer should show green-cyan medicinal liquid');
  assert.ok(countPixels(stabilizer, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 55, 'psi_stabilizer should include a red medical mark');
  assert.ok(countPixels(stabilizer, (r, g, b, a) => a > 20 && b > 145 && r > 95 && r < 190) > 80, 'psi_stabilizer should carry a faint psi glow');

  const strike = generateItemSprite('psi_strike');
  const storm = generateItemSprite('psi_storm');
  const needle = generateItemSprite('psi_void_needle');
  assert.ok(countPixels(strike, (r, g, b, a) => a > 100 && b > 130 && r > 65 && r < 180) > 130, 'psi_strike should read as violet-blue psi matter');
  assert.ok(countPixelsIn(strike, 16, 16, 49, 48, (_r, _g, _b, a) => a > 120) > 300, 'psi_strike should keep a diagonal bolt silhouette');
  assert.ok(countPixels(storm, (r, g, b, a) => a > 100 && b > 130 && r > 55 && r < 185) > 260, 'psi_storm should read as a larger clustered psi storm');
  assert.ok(countPixels(storm, (r, g, b, a) => a > 100 && g > 165 && b > 150 && r < 150) > 50, 'psi_storm should include storm cyan arcs');
  assert.ok(countPixels(needle, (r, g, b, a) => a > 120 && r < 75 && g < 90 && b < 120) > 190, 'psi_void_needle should keep a dark void needle core');
  assert.ok(countPixelsIn(needle, 24, 14, 60, 42, (r, g, b, a) => a > 100 && g > 150 && b > 150 && r < 150) > 28, 'psi_void_needle should include a sharp cyan edge');
  assert.notEqual(spriteHash(strike), spriteHash(storm), 'psi_strike and psi_storm should differ');
  assert.notEqual(spriteHash(needle), spriteHash(strike), 'psi_void_needle should differ from psi_strike');

  const referral = generateItemSprite('psychiatrist_referral');
  assert.ok(countPixels(referral, (r, g, b, a) => a > 140 && r > 155 && g > 130 && b > 90 && b < 210) > 520, 'psychiatrist_referral should read as yellowed medical paperwork');
  assert.ok(countPixels(referral, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 100, 'psychiatrist_referral should include a red medical stamp/cross');
  assert.ok(countPixels(referral, (r, g, b, a) => a > 110 && b > 100 && r < 115 && g < 150) > 45, 'psychiatrist_referral should include a blue patient block');

  const ptrs = generateItemSprite('ptrs_liquidator');
  assert.ok(countPixels(ptrs, (r, g, b, a) => a > 120 && r < 75 && g < 90 && b < 100) > 360, 'ptrs_liquidator should show dark liquidator metal');
  assert.ok(countPixelsIn(ptrs, 42, 14, 63, 25, (_r, _g, _b, a) => a > 120) > 95, 'ptrs_liquidator should show an extra-long barrel/harpoon tip');
  assert.ok(countPixels(ptrs, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 45, 'ptrs_liquidator should include red service paint');
  assert.notEqual(spriteHash(ptrs), spriteHash(generateItemSprite('losyash_rifle')), 'ptrs_liquidator should differ from Losyash precision rifle');

  const impeller = generateItemSprite('pump_impeller');
  assert.ok(countPixels(impeller, (r, g, b, a) => a > 120 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 70 && r < 200) > 420, 'pump_impeller should show worn steel blades');
  assert.ok(countPixels(impeller, (r, g, b, a) => a > 80 && g > 135 && b > 125 && r < 145) > 80, 'pump_impeller should show wet cyan water residue');
  assert.ok(countPixelsIn(impeller, 24, 24, 40, 41, (_r, _g, _b, a) => a > 150) > 180, 'pump_impeller should keep a central hub');
  assert.notEqual(spriteHash(impeller), spriteHash(generateItemSprite('water_filter_regulator')), 'pump_impeller should differ from water filter regulator');

  const passport = generateItemSprite('pump_passport');
  assert.ok(countPixels(passport, (r, g, b, a) => a > 130 && g > 95 && g >= r - 35 && r < 155 && b < 150) > 260, 'pump_passport should show a green-grey technical booklet cover');
  assert.ok(countPixels(passport, (r, g, b, a) => a > 100 && b > 105 && g > 90 && b >= r + 10) > 55, 'pump_passport should include a blue pump diagram');
  assert.ok(countPixels(passport, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 55, 'pump_passport should include a red technical stamp');
  assert.notEqual(spriteHash(passport), spriteHash(generateItemSprite('pump_impeller')), 'pump_passport should differ from the pump part');
});

test('sprite bundle 036 items read as distinct weapon, paper, food, sample, circuit, and resident-good icons', () => {
  const expectedItems: readonly [string, string, ItemType][] = [
    ['rb91_auto_shotgun', 'РБ-91', ItemType.WEAPON],
    ['rebar', 'Арматура', ItemType.WEAPON],
    ['record_exposure_notice', 'Акт о пропавшей записи', ItemType.MISC],
    ['red_concentrate', 'Красный концентрат', ItemType.FOOD],
    ['red_mold_sample', 'Проба красной плесени', ItemType.MISC],
    ['relay_diagram', 'Схема реле', ItemType.MISC],
    ['resident_trinket_box', 'Коробка жильцовых мелочей', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expectedItems) {
    assert.equal(ITEMS[id]?.name, name, `${id} Russian name should stay canonical`);
    assert.equal(ITEMS[id]?.type, type, `${id} item type should stay canonical`);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 280, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(DOCUMENT_ACCESS_ITEMS.resident_identity_stub?.name, 'Корешок удостоверения личности');
  assert.equal(DOCUMENT_ACCESS_ITEMS.resident_identity_stub?.type, ItemType.MISC);
  const identity = generateItemSprite('resident_identity_stub');
  assert.equal(identity[0] >>> 24, 0, 'resident_identity_stub sprite should keep transparent corners');
  assert.ok(opaquePixels(identity) > 280, 'resident_identity_stub should have enough visible mass for world drops and inventory icons');
  hashes.add(spriteHash(identity));

  assert.equal(hashes.size, expectedItems.length + 1, 'bundle 036 sprites should not share exact sprite hashes');

  const rb91 = generateItemSprite('rb91_auto_shotgun');
  assert.ok(countPixels(rb91, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 90) > 520, 'rb91_auto_shotgun should show a heavy dark shotgun body');
  assert.ok(countPixels(rb91, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 90, 'rb91_auto_shotgun should include red shell/service paint cues');
  assert.ok(countPixelsIn(rb91, 38, 16, 63, 30, (_r, _g, _b, a) => a > 120) > 90, 'rb91_auto_shotgun should show a forward barrel and muzzle');
  assert.notEqual(spriteHash(rb91), spriteHash(generateItemSprite('chizh3_shotgun')), 'rb91_auto_shotgun should differ from chizh3_shotgun');
  assert.notEqual(spriteHash(rb91), spriteHash(generateItemSprite('granit4u_belt_shotgun')), 'rb91_auto_shotgun should differ from granit4u_belt_shotgun');

  const rebar = generateItemSprite('rebar');
  assert.ok(countPixels(rebar, (r, g, b, a) => a > 120 && r > 115 && g < 105 && b < 90) > 120, 'rebar should show rust and a tied red rag');
  assert.ok(countPixels(rebar, (r, g, b, a) => a > 120 && r > 80 && r < 170 && g > 75 && g < 165 && b > 65 && b < 145) > 140, 'rebar should show worn ribbed steel');
  assert.ok(countPixelsIn(rebar, 13, 16, 54, 50, (_r, _g, _b, a) => a > 120) > 520, 'rebar should keep a long diagonal bar silhouette');
  assert.notEqual(spriteHash(rebar), spriteHash(generateItemSprite('pipe')), 'rebar should differ from pipe');
  assert.notEqual(spriteHash(rebar), spriteHash(generateItemSprite('crowbar')), 'rebar should differ from crowbar');

  const notice = generateItemSprite('record_exposure_notice');
  assert.ok(countPixels(notice, (r, g, b, a) => a > 130 && r > 155 && g > 130 && b > 80 && b < 210) > 450, 'record_exposure_notice should read as yellowed official paper');
  assert.ok(countPixels(notice, (r, g, b, a) => a > 120 && r < 70 && g < 70 && b < 70) > 330, 'record_exposure_notice should include missing-record ink and blackout');
  assert.ok(countPixels(notice, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 140, 'record_exposure_notice should include a red exposure stamp');
  assert.notEqual(spriteHash(notice), spriteHash(generateItemSprite('missing_record_file')), 'record_exposure_notice should differ from a missing record folder');

  const concentrate = generateItemSprite('red_concentrate');
  assert.ok(countPixels(concentrate, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 150, 'red_concentrate should show a red premium briquette');
  assert.ok(countPixels(concentrate, (r, g, b, a) => a > 130 && r > 155 && g > 130 && b > 80 && b < 210) > 300, 'red_concentrate should keep ration wrapper and stripe detail');
  assert.notEqual(spriteHash(concentrate), spriteHash(generateItemSprite('green_briquette')), 'red_concentrate should differ from green_briquette');
  assert.notEqual(spriteHash(concentrate), spriteHash(generateItemSprite('pressed_sugar')), 'red_concentrate should differ from pressed_sugar');

  const mold = generateItemSprite('red_mold_sample');
  assert.ok(countPixels(mold, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 190, 'red_mold_sample should show red mold mass');
  assert.ok(countPixels(mold, (r, g, b, a) => a > 80 && g > 120 && b > 110 && r < 160) > 50, 'red_mold_sample should show glass and green sample glow');
  assert.ok(countPixelsIn(mold, 30, 36, 39, 43, (_r, _g, _b, a) => a > 120) > 40, 'red_mold_sample should include an eye-like bubble in the jar');
  assert.notEqual(spriteHash(mold), spriteHash(generateItemSprite('slime_sample_red')), 'red_mold_sample should differ from red slime sample');
  assert.notEqual(spriteHash(mold), spriteHash(generateItemSprite('mutant_tissue_sample')), 'red_mold_sample should differ from mutant tissue sample');

  const relay = generateItemSprite('relay_diagram');
  assert.ok(countPixels(relay, (r, g, b, a) => a > 130 && r > 155 && g > 130 && b > 80 && b < 210) > 450, 'relay_diagram should read as folded technical paper');
  assert.ok(countPixels(relay, (r, g, b, a) => a > 100 && b > 100 && r < 130 && g < 170) > 65, 'relay_diagram should show blue relay wiring');
  assert.ok(countPixels(relay, (r, g, b, a) => a > 110 && g > 110 && r < 130 && b < 130) > 45, 'relay_diagram should show green circuit nodes');
  assert.notEqual(spriteHash(relay), spriteHash(generateItemSprite('lift_scheme')), 'relay_diagram should differ from lift_scheme');

  assert.ok(countPixels(identity, (r, g, b, a) => a > 130 && r > 155 && g > 130 && b > 80 && b < 210) > 240, 'resident_identity_stub should read as a yellowed ID stub');
  assert.ok(countPixels(identity, (r, g, b, a) => a > 110 && g > 110 && r < 130 && b < 130) > 70, 'resident_identity_stub should include a green resident portrait block');
  assert.ok(countPixels(identity, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 100) > 100, 'resident_identity_stub should include a red official stamp');
  assert.notEqual(spriteHash(identity), spriteHash(generateItemSprite('passport_stub')), 'resident_identity_stub should differ from passport_stub');

  const trinketBox = generateItemSprite('resident_trinket_box');
  assert.ok(countPixels(trinketBox, (r, g, b, a) => a > 110 && g > 90 && g >= r && r < 130 && b < 120) > 90, 'resident_trinket_box should show a green resident box');
  assert.ok(countPixels(trinketBox, (r, g, b, a) => a > 120 && r > 165 && g > 120 && g < 210 && b < 115) > 150, 'resident_trinket_box should include brass trinkets');
  assert.ok(countPixelsIn(trinketBox, 13, 30, 52, 50, (_r, _g, _b, a) => a > 120) > 560, 'resident_trinket_box should keep a compact open-box silhouette');
  assert.notEqual(spriteHash(trinketBox), spriteHash(generateItemSprite('party_portrait_pin')), 'resident_trinket_box should differ from party portrait pin');
});

test('sprite bundle 038 items read as distinct samosbor, sample, food, tool, and medical icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['rubber_tube', 'Резиновая трубка', ItemType.MISC],
    ['rusty_rake', 'Ржавые грабли', ItemType.WEAPON],
    ['samosbor_alarm_schedule', 'График тревог', ItemType.MISC],
    ['samosbor_tally', 'Ведомость самосборов', ItemType.MISC],
    ['sample_chain_form', 'Бланк цепочки пробы', ItemType.MISC],
    ['sample_cork_seal', 'Пробковая пломба', ItemType.MISC],
    ['sand_spoiled_ration', 'Пайка с белым песком', ItemType.FOOD],
    ['sanitary_kit', 'Санитарный набор', ItemType.MEDICINE],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 200, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 038 sprites should not share exact sprite hashes');

  const tube = generateItemSprite('rubber_tube');
  assert.ok(countPixels(tube, (r, g, b, a) => a > 140 && r < 80 && g < 95 && b < 95) > 130, 'rubber_tube should read as dark rubber hose mass');
  assert.ok(countPixels(tube, (r, g, b, a) => a > 90 && g > 135 && b > 110 && r < 155) > 45, 'rubber_tube should include wet cyan/green liquid residue');

  const rake = generateItemSprite('rusty_rake');
  assert.ok(countPixelsIn(rake, 38, 10, 58, 32, (_r, _g, _b, a) => a > 130) > 120, 'rusty_rake should show a readable rake head with teeth');
  assert.ok(countPixels(rake, (r, g, b, a) => a > 120 && r > 105 && g > 35 && g < 110 && b < 85) > 70, 'rusty_rake should carry rusty metal');
  assert.notEqual(spriteHash(rake), spriteHash(generateItemSprite('liquidator_rake')), 'rusty_rake should differ from liquidator_rake');

  const schedule = generateItemSprite('samosbor_alarm_schedule');
  assert.ok(countPixels(schedule, (r, g, b, a) => a > 150 && r > 165 && g > 145 && g < 230 && b > 90 && b < 190) > 300, 'samosbor_alarm_schedule should read as yellowed paper');
  assert.ok(countPixels(schedule, (r, g, b, a) => a > 130 && r > 135 && g < 95 && b < 100) > 65, 'samosbor_alarm_schedule should include red alarm marks');
  assert.ok(countPixels(schedule, (r, g, b, a) => a > 20 && b > 120 && r < 150) > 30, 'samosbor_alarm_schedule should include a faint blue-violet alarm glow');

  const tally = generateItemSprite('samosbor_tally');
  assert.ok(countPixels(tally, (r, g, b, a) => a > 140 && r > 140 && g > 115 && b < 175) > 380, 'samosbor_tally should read as a ledger sheet');
  assert.ok(countPixels(tally, (r, g, b, a) => a > 120 && r > 135 && g < 95 && b < 100) > 85, 'samosbor_tally should include red pencil zone marks');
  assert.notEqual(spriteHash(tally), spriteHash(schedule), 'samosbor_tally should differ from the alarm schedule document');

  const form = generateItemSprite('sample_chain_form');
  assert.ok(countPixels(form, (r, g, b, a) => a > 120 && b > 90 && r < 110 && g < 130) > 45, 'sample_chain_form should include blue chain-of-custody fields');
  assert.ok(countPixelsIn(form, 22, 28, 44, 49, (_r, _g, _b, a) => a > 130) > 190, 'sample_chain_form should keep readable checkbox rows');
  assert.notEqual(spriteHash(form), spriteHash(generateItemSprite('nii_sample_label')), 'sample_chain_form should differ from the NII sample label');

  const corkSeal = generateItemSprite('sample_cork_seal');
  assert.ok(countPixels(corkSeal, (r, g, b, a) => a > 130 && r > 120 && g > 75 && g < 180 && b < 120) > 115, 'sample_cork_seal should show cork material');
  assert.ok(countPixels(corkSeal, (r, g, b, a) => a > 120 && r > 140 && g < 90 && b < 90) > 55, 'sample_cork_seal should include a red wax ring');
  assert.ok(countPixels(corkSeal, (r, g, b, a) => a > 80 && g > 130 && b > 95 && r < 150) > 35, 'sample_cork_seal should keep a glass/sample context');

  const ration = generateItemSprite('sand_spoiled_ration');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 140 && r > 190 && g > 185 && b > 155) > 80, 'sand_spoiled_ration should show white veretar sand');
  assert.ok(countPixels(ration, (r, g, b, a) => a > 100 && g > 105 && r < 125 && b < 110) > 20, 'sand_spoiled_ration should include spoiled green smear');
  assert.notEqual(spriteHash(ration), spriteHash(generateItemSprite('liquidator_ration')), 'sand_spoiled_ration should differ from liquidator ration');

  const kit = generateItemSprite('sanitary_kit');
  assert.ok(countPixels(kit, (r, g, b, a) => a > 130 && r > 140 && g < 95 && b < 95) > 95, 'sanitary_kit should include a red medical cross');
  assert.ok(countPixels(kit, (r, g, b, a) => a > 90 && g > 125 && r < 160 && b > 95) > 35, 'sanitary_kit should include green glass/medicine detail');
  assert.notEqual(spriteHash(kit), spriteHash(generateItemSprite('antibiotic')), 'sanitary_kit should differ from antibiotic packet');
});

test('sprite bundle 039 items read as distinct screen, scrubbed evidence, seal, repair, sample, and trophy icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['screen_unit', 'Экран', ItemType.MISC],
    ['scrubbed_serial_plate', 'Сбитая номерная планка', ItemType.MISC],
    ['scrubbed_weapon_tag', 'Сбитая оружейная бирка', ItemType.MISC],
    ['seal_wax', 'Сургуч', ItemType.MISC],
    ['sealant_tube', 'Тюбик герметика', ItemType.MISC],
    ['sealed_complaint', 'Жалоба под сургучом', ItemType.MISC],
    ['sealed_veretar_sand', 'Белый песок в гермопакете', ItemType.MISC],
    ['shark_scale', 'Акулья чешуя', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 039 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 39,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'screen_unit', count: 0 },
      { defId: 'sealed_veretar_sand', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'sealed_veretar_sand', 'bundle 039 world drops should resolve visuals from positive item payload');

  const screen = generateItemSprite('screen_unit');
  assert.ok(countPixels(screen, (r, g, b, a) => a > 90 && g > 145 && b > 130 && r < 120) > 95, 'screen_unit should show cyan terminal pixels');
  assert.ok(countPixelsIn(screen, 22, 20, 44, 38, (r, g, b, a) => a > 150 && r < 70 && g < 100 && b < 100) > 200, 'screen_unit should keep a dark glass screen block');

  const plate = generateItemSprite('scrubbed_serial_plate');
  assert.ok(countPixels(plate, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 80 && r < 220) > 260, 'scrubbed_serial_plate should read as scraped metal');
  assert.ok(countPixels(plate, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85) > 25, 'scrubbed_serial_plate should include a red cancellation slash');

  const tag = generateItemSprite('scrubbed_weapon_tag');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 140 && r > 150 && g > 125 && b > 90 && b < 190) > 370, 'scrubbed_weapon_tag should read as yellowed tag paper');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 120 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 85 && r < 180) > 55, 'scrubbed_weapon_tag should include a scrubbed metal serial block');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 80) > 65, 'scrubbed_weapon_tag should include red audit/seal marks');

  const wax = generateItemSprite('seal_wax');
  assert.ok(countPixels(wax, (r, g, b, a) => a > 130 && r > 130 && g < 85 && b < 85) > 420, 'seal_wax should read as red sealing wax');
  assert.ok(countPixelsIn(wax, 40, 24, 50, 31, (r, g, b, a) => a > 120 && r < 80 && g < 80 && b < 80) > 35, 'seal_wax should include a dark broken wick or stamp remnant');

  const sealant = generateItemSprite('sealant_tube');
  assert.ok(countPixels(sealant, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 80 && r < 225) > 230, 'sealant_tube should read as grey repair tube metal');
  assert.ok(countPixels(sealant, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 90) > 30, 'sealant_tube should include yellow tool labeling');
  assert.ok(countPixels(sealant, (r, g, b, a) => a > 90 && g > 145 && b > 125 && r < 125) > 20, 'sealant_tube should include cyan wet sealant residue');

  const complaint = generateItemSprite('sealed_complaint');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 140 && r > 145 && g > 125 && b > 80 && b < 180) > 420, 'sealed_complaint should read as sealed paper');
  assert.ok(countPixels(complaint, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85) > 80, 'sealed_complaint should include a red wax seal');

  const sand = generateItemSprite('sealed_veretar_sand');
  assert.ok(countPixels(sand, (r, g, b, a) => a > 120 && r > 180 && g > 180 && b > 150) > 260, 'sealed_veretar_sand should show pale sealed sand');
  assert.ok(countPixels(sand, (r, g, b, a) => a > 60 && g > 130 && b > 125 && r < 150) > 40, 'sealed_veretar_sand should include translucent cyan pouch/glow pixels');

  const scale = generateItemSprite('shark_scale');
  assert.ok(countPixels(scale, (r, g, b, a) => a > 100 && g > 120 && b > 125 && r < 130) > 160, 'shark_scale should read as a wet blue-cyan scale');
  assert.ok(countPixels(scale, (r, g, b, a) => a > 120 && r > 135 && g < 90 && b < 90) > 40, 'shark_scale should include a red contraband tag mark');
});

test('sprite bundle 040 items read as distinct shelter, weapon, drink, and siren icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['shelter_seat_card', 'Карточка места в укрытии', ItemType.MISC],
    ['shelter_seat_forgery', 'Поддельная карточка укрытия', ItemType.MISC],
    ['shelter_tally', 'Ведомость укрытых', ItemType.MISC],
    ['shmk_disposable', 'ШМК', ItemType.WEAPON],
    ['shock_baton', 'Шоковая дубинка', ItemType.WEAPON],
    ['shotgun', 'Обрез', ItemType.WEAPON],
    ['siren_energy', 'Энергетик Сирена', ItemType.DRINK],
    ['siren_instruction', 'Инструкция при сирене', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 200, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 040 sprites should not share exact sprite hashes');

  const card = generateItemSprite('shelter_seat_card');
  assert.ok(countPixels(card, (r, g, b, a) => a > 140 && r > 145 && g > 115 && b > 55 && b < 180) > 300, 'shelter_seat_card should read as yellowed shelter card paper');
  assert.ok(countPixels(card, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 70, 'shelter_seat_card should include a red official stamp');
  assert.ok(countPixels(card, (r, g, b, a) => a > 70 && b > 110 && b >= r + 20) > 25, 'shelter_seat_card should include a weak blue-violet shelter cue');

  const forgery = generateItemSprite('shelter_seat_forgery');
  assert.ok(countPixels(forgery, (r, g, b, a) => a > 110 && b > 105 && r > 80 && g < 130) > 70, 'shelter_seat_forgery should show violet forged correction marks');
  assert.ok(countPixels(forgery, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 100, 'shelter_seat_forgery should show false red stamps');
  assert.notEqual(spriteHash(forgery), spriteHash(card), 'shelter card and shelter forgery should differ');

  const tally = generateItemSprite('shelter_tally');
  assert.ok(countPixels(tally, (r, g, b, a) => a > 140 && r > 145 && g > 115 && b > 55 && b < 180) > 400, 'shelter_tally should read as a tall yellowed ledger');
  assert.ok(countPixels(tally, (r, g, b, a) => a > 110 && r < 70 && g < 70 && b < 70) > 100, 'shelter_tally should include black roster rows');
  assert.ok(countPixels(tally, (r, g, b, a) => a > 110 && g > 105 && r < 140 && b < 150) > 20, 'shelter_tally should include green tally marks');
  assert.notEqual(spriteHash(tally), spriteHash(generateItemSprite('forged_shelter_tally')), 'shelter_tally should differ from forged_shelter_tally');

  const shmk = generateItemSprite('shmk_disposable');
  assert.ok(countPixels(shmk, (r, g, b, a) => a > 140 && r < 85 && g < 100 && b < 105) > 220, 'shmk_disposable should read as a dark disposable fire package');
  assert.ok(countPixels(shmk, (r, g, b, a) => a > 120 && r > 170 && g > 105 && b < 90) > 40, 'shmk_disposable should include yellow service paint');
  assert.ok(countPixels(shmk, (r, g, b, a) => a > 120 && r > 180 && g < 120 && b < 90) > 20, 'shmk_disposable should include a small fire/nozzle accent');

  const baton = generateItemSprite('shock_baton');
  assert.ok(countPixels(baton, (r, g, b, a) => a > 120 && r < 85 && g < 100 && b < 105) > 200, 'shock_baton should keep a dark baton silhouette');
  assert.ok(countPixels(baton, (r, g, b, a) => a > 90 && g > 150 && b > 150 && r < 130) > 45, 'shock_baton should show cyan electrical glow');
  assert.notEqual(spriteHash(baton), spriteHash(generateItemSprite('rubber_club')), 'shock_baton should differ from rubber_club');

  const obrez = generateItemSprite('shotgun');
  assert.ok(countPixels(obrez, (r, g, b, a) => a > 120 && b >= r + 4 && g >= r && r < 115) > 90, 'shotgun should show cold sawed-off barrel metal');
  assert.ok(countPixels(obrez, (r, g, b, a) => a > 120 && r > 70 && r < 170 && g > 35 && g < 110 && b < 90) > 45, 'shotgun should show worn wooden stock');
  assert.ok(countPixelsIn(obrez, 42, 16, 60, 27, (_r, _g, _b, a) => a > 120) > 55, 'shotgun should keep short double barrel mass');
  assert.notEqual(spriteHash(obrez), spriteHash(generateItemSprite('chizh3_shotgun')), 'shotgun should differ from Chizh-3 shotgun');

  const energy = generateItemSprite('siren_energy');
  assert.ok(countPixels(energy, (r, g, b, a) => a > 110 && g > 140 && b > 130 && r < 140) > 80, 'siren_energy should show cyan-green drink liquid');
  assert.ok(countPixels(energy, (r, g, b, a) => a > 120 && r > 145 && g < 95 && b < 90) > 60, 'siren_energy should show a red siren label');
  assert.notEqual(spriteHash(energy), spriteHash(generateItemSprite('instant_coffee')), 'siren_energy should differ from instant coffee');

  const instruction = generateItemSprite('siren_instruction');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 140 && r > 145 && g > 115 && b > 55 && b < 180) > 350, 'siren_instruction should read as yellowed instruction paper');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 80, 'siren_instruction should include a red siren diagram');
  assert.ok(countPixels(instruction, (r, g, b, a) => a > 100 && b > 105 && r > 80 && g < 130) > 40, 'siren_instruction should include a violet crossed-out third point');
});

test('sprite bundle 041 items read as distinct siren, heavy weapon, medicine and slime samples', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['siren_shard', 'Осколок сирены', ItemType.MISC],
    ['sledgehammer', 'Кувалда', ItemType.WEAPON],
    ['sleeping_pills', 'Снотворное «Попобава»', ItemType.MEDICINE],
    ['slime_age_label_brown', 'Бирка молодой слизи', ItemType.MISC],
    ['slime_age_label_orange', 'Бирка подростковой слизи', ItemType.MISC],
    ['slime_age_label_violet', 'Бирка взрослой слизи', ItemType.MISC],
    ['slime_calcified_chip', 'Окаменевший скол слизи', ItemType.MISC],
    ['slime_motor_node', 'Моторный узел слизи', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 041 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 41,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'siren_shard', count: 0 },
      { defId: 'slime_motor_node', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'slime_motor_node', 'bundle 041 world drops should resolve visuals from positive item payload');

  const shard = generateItemSprite('siren_shard');
  assert.ok(countPixels(shard, (r, g, b, a) => a > 120 && r > 135 && g < 90 && b < 95) > 130, 'siren_shard should show chipped red siren plastic');
  assert.ok(countPixels(shard, (r, g, b, a) => a > 60 && b > 135 && r > 70 && g < 170) > 60, 'siren_shard should show purple-blue psi glow');
  assert.ok(countPixelsIn(shard, 28, 30, 39, 39, (r, g, b, a) => a > 160 && r > 170 && g > 160 && b > 120) > 10, 'siren_shard should keep an eye-like enamel center');
  assert.notEqual(spriteHash(shard), spriteHash(generateItemSprite('bottled_voice')), 'siren_shard should differ from bottled voice');

  const sledge = generateItemSprite('sledgehammer');
  assert.ok(countPixels(sledge, (r, g, b, a) => a > 130 && b >= r + 4 && g >= r && r < 120) > 180, 'sledgehammer should show a blue-black heavy metal head');
  assert.ok(countPixels(sledge, (r, g, b, a) => a > 130 && r > 65 && g > 35 && g < 115 && b < 90 && r > g + 12) > 180, 'sledgehammer should show a long wooden handle');
  assert.ok(countPixels(sledge, (r, g, b, a) => a > 120 && (r > 150 && g < 95 && b < 90 || r > 165 && g > 105 && b < 90)) > 45, 'sledgehammer should include red/yellow service paint');
  assert.notEqual(spriteHash(sledge), spriteHash(generateItemSprite('hammer')), 'sledgehammer should differ from hammer');

  const sleep = generateItemSprite('sleeping_pills');
  assert.ok(countPixels(sleep, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 120 && r < 235) > 300, 'sleeping_pills should read as dirty silver blister foil');
  assert.ok(countPixels(sleep, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 60, 'sleeping_pills should include a red controlled-medicine strip');
  assert.ok(countPixels(sleep, (r, g, b, a) => a > 110 && g > 130 && r < 125 && b < 150) > 25, 'sleeping_pills should include greenish pharmacy glass/plastic');
  assert.notEqual(spriteHash(sleep), spriteHash(generateItemSprite('pills')), 'sleeping_pills should differ from generic pills');

  const brown = generateItemSprite('slime_age_label_brown');
  const orange = generateItemSprite('slime_age_label_orange');
  const violet = generateItemSprite('slime_age_label_violet');
  for (const [id, sprite] of [
    ['slime_age_label_brown', brown],
    ['slime_age_label_orange', orange],
    ['slime_age_label_violet', violet],
  ] as const) {
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 140 && r > 145 && g > 110 && b > 55 && b < 180) > 360, `${id} should read as yellowed sample-label paper`);
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 80, `${id} should include a red evidence stamp`);
    assert.ok(countPixels(sprite, (r, g, b, a) => a > 90 && r < 80 && g < 80 && b < 80) > 90, `${id} should include black document rows`);
  }
  assert.ok(countPixels(brown, (r, g, b, a) => a > 120 && r > 95 && r < 190 && g > 45 && g < 130 && b < 90) > 50, 'brown slime age label should show brown slime stripe');
  assert.ok(countPixels(orange, (r, g, b, a) => a > 120 && r > 190 && g > 70 && g < 170 && b < 90) > 50, 'orange slime age label should show orange slime stripe');
  assert.ok(countPixels(violet, (r, g, b, a) => a > 100 && b > 130 && r > 90 && g < 140) > 50, 'violet slime age label should show violet slime stripe');

  const chip = generateItemSprite('slime_calcified_chip');
  assert.ok(countPixels(chip, (r, g, b, a) => a > 100 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 130 && r < 235) > 180, 'slime_calcified_chip should show pale calcified sample mass');
  assert.ok(countPixels(chip, (r, g, b, a) => a > 80 && g > 120 && r < 130 && b < 150) > 25, 'slime_calcified_chip should retain weak dead green residue');
  assert.notEqual(spriteHash(chip), spriteHash(generateItemSprite('frozen_slime_core')), 'slime_calcified_chip should differ from frozen slime core');

  const node = generateItemSprite('slime_motor_node');
  assert.ok(countPixels(node, (r, g, b, a) => a > 120 && r > 110 && g < 95 && b > 60 && b < 150) > 110, 'slime_motor_node should show a red-violet organ node');
  assert.ok(countPixels(node, (r, g, b, a) => a > 90 && g > 145 && b > 135 && r < 130) > 45, 'slime_motor_node should show cyan motion traces');
  assert.notEqual(spriteHash(node), spriteHash(chip), 'slime_motor_node should differ from calcified chip');
});

test('sprite bundle 037 items read as distinct ammo, reagent, weapons, repair and rubber icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['rifle_bolt_pack', 'Полимерные болты', ItemType.AMMO],
    ['rock_salt', 'Каменная соль', ItemType.MISC],
    ['roks47_flamethrower', 'РОКС-47', ItemType.WEAPON],
    ['roller_brush', 'Валик', ItemType.MISC],
    ['rpl23_lmg', 'РПЛ-23 Лёшкинского', ItemType.WEAPON],
    ['rubber_club', 'Резиновая дубинка', ItemType.WEAPON],
    ['rubber_door_wedge', 'Резиновый клин гермодвери', ItemType.MISC],
    ['rubber_strip', 'Резина', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 037 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 37,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'rock_salt', count: 0 },
      { defId: 'rubber_door_wedge', count: 2 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'rubber_door_wedge', 'bundle 037 world drops should resolve visuals from positive item payload');

  const bolts = generateItemSprite('rifle_bolt_pack');
  assert.ok(countPixels(bolts, (r, g, b, a) => a > 120 && g > 130 && b > 120 && r < 130) > 180, 'rifle_bolt_pack should show cyan polymer bolts');
  assert.ok(countPixels(bolts, (r, g, b, a) => a > 150 && r > 145 && g > 90 && g < 190 && b < 100) > 140, 'rifle_bolt_pack should show brass collars/tray');
  assert.notEqual(spriteHash(bolts), spriteHash(generateItemSprite('ammo_762')), 'rifle_bolt_pack should not reuse ballistic cartridge icon language');

  const salt = generateItemSprite('rock_salt');
  assert.ok(countPixels(salt, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 90 && r < 220) > 300, 'rock_salt should read as grey mineral salt in a dirty packet');
  assert.ok(countPixels(salt, (r, g, b, a) => a > 130 && r > 135 && g < 95 && b < 90) > 20, 'rock_salt should include a red reagent label');
  assert.notEqual(spriteHash(salt), spriteHash(generateItemSprite('red_mold_sample')), 'rock_salt should not collapse to a sample jar');

  const roks = generateItemSprite('roks47_flamethrower');
  assert.ok(countPixels(roks, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 360, 'roks47_flamethrower should keep a dark backpack weapon mass');
  assert.ok(countPixels(roks, (r, g, b, a) => a > 120 && r > 150 && g > 95 && b < 95) > 40, 'roks47_flamethrower should include hot warning/nozzle marks');
  assert.notEqual(spriteHash(roks), spriteHash(generateItemSprite('flamethrower')), 'roks47_flamethrower should not reuse the generic flamethrower icon');

  const brush = generateItemSprite('roller_brush');
  assert.ok(countPixels(brush, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 100, 'roller_brush should show wet red paint');
  assert.ok(countPixelsIn(brush, 16, 16, 50, 31, (_r, _g, _b, a) => a > 140) > 260, 'roller_brush should keep a wide roller head silhouette');
  assert.notEqual(spriteHash(brush), spriteHash(generateItemSprite('paint_can_red')), 'roller_brush should differ from paint can icon language');

  const lmg = generateItemSprite('rpl23_lmg');
  assert.ok(countPixels(lmg, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 380, 'rpl23_lmg should have a heavy blue-black receiver silhouette');
  assert.ok(countPixels(lmg, (r, g, b, a) => a > 120 && r > 150 && g > 100 && b < 95) > 80, 'rpl23_lmg should show belt/brass service pixels');
  assert.notEqual(spriteHash(lmg), spriteHash(generateItemSprite('ak47')), 'rpl23_lmg should not reuse rifle silhouette language');

  const club = generateItemSprite('rubber_club');
  assert.ok(countPixels(club, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 500, 'rubber_club should read as dark rubber control baton');
  assert.ok(countPixels(club, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 8, 'rubber_club should include a red service band');
  assert.notEqual(spriteHash(club), spriteHash(generateItemSprite('shock_baton')), 'rubber_club should differ from electric baton icon language');

  const wedge = generateItemSprite('rubber_door_wedge');
  assert.ok(countPixels(wedge, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 500, 'rubber_door_wedge should read as a black rubber wedge');
  assert.ok(countPixels(wedge, (r, g, b, a) => a > 100 && g > 140 && b > 120 && r < 130) > 35, 'rubber_door_wedge should include cyan hermodoor seal marks');
  assert.notEqual(spriteHash(wedge), spriteHash(generateItemSprite('door_fuse')), 'rubber_door_wedge should not reuse door electronics language');

  const strip = generateItemSprite('rubber_strip');
  assert.ok(countPixels(strip, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 800, 'rubber_strip should read as a folded black gasket strip');
  assert.ok(countPixels(strip, (r, g, b, a) => a > 100 && r > 135 && g > 120 && b > 95) > 40, 'rubber_strip should include chalked worn edges');
  assert.notEqual(spriteHash(strip), spriteHash(wedge), 'rubber_strip should not reuse rubber_door_wedge geometry');
  assert.notEqual(spriteHash(strip), spriteHash(generateItemSprite('metal_sheet')), 'rubber_strip should differ from flat metal materials');
});

test('sprite bundle 046 items read as distinct documents, medicine, trade and weapon icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['temp_pass', 'Пропуск временный', ItemType.MISC],
    ['terminal_order_receipt', 'Квитанция терминального заказа', ItemType.MISC],
    ['toiletpaper', 'Туалетная бумага', ItemType.MISC],
    ['tourniquet', 'Жгут', ItemType.MEDICINE],
    ['toz_shotgun', 'ТОЗ', ItemType.WEAPON],
    ['track_diagram_scrap', 'Обрывок схемы путей', ItemType.MISC],
    ['tracked_zhernov', 'Гусеничный жернов', ItemType.WEAPON],
    ['tt_pistol', 'ТТ', ItemType.WEAPON],
  ];
  const hashes = new Set<number>();

  assert.equal(DOCUMENT_ACCESS_ITEMS.terminal_order_receipt?.name, 'Квитанция терминального заказа');
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 800, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 046 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 46,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'temp_pass', count: 0 },
      { defId: 'terminal_order_receipt', count: 2 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'terminal_order_receipt', 'bundle 046 world drops should resolve visuals from positive item payload');

  const tempPass = generateItemSprite('temp_pass');
  assert.ok(countPixels(tempPass, (r, g, b, a) => a > 140 && r > 140 && g > 115 && b > 55 && b < 190) > 250, 'temp_pass should read as yellowed pass paper');
  assert.ok(countPixels(tempPass, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 80, 'temp_pass should include red expired stamp marks');
  assert.notEqual(spriteHash(tempPass), spriteHash(generateItemSprite('permanent_pass')), 'temp_pass should differ from permanent_pass');

  const receipt = generateItemSprite('terminal_order_receipt');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 80 && g > 140 && b > 130 && r < 140) > 30, 'terminal_order_receipt should include weak cyan terminal glow');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 250, 'terminal_order_receipt should include dark receipt/terminal print');
  assert.notEqual(spriteHash(receipt), spriteHash(generateItemSprite('stolen_terminal_stamp')), 'terminal_order_receipt should differ from stolen terminal stamp paperwork');

  const toilet = generateItemSprite('toiletpaper');
  assert.ok(countPixels(toilet, (r, g, b, a) => a > 130 && Math.abs(r - g) < 28 && Math.abs(g - b) < 46 && r > 100 && r < 225) > 650, 'toiletpaper should read as a grey local paper roll');
  assert.notEqual(spriteHash(toilet), spriteHash(generateItemSprite('import_toiletpaper')), 'local toiletpaper should differ from import_toiletpaper');

  const tourniquet = generateItemSprite('tourniquet');
  assert.ok(countPixels(tourniquet, (r, g, b, a) => a > 120 && r > 110 && r > g + 25 && g < 95 && b < 80) > 160, 'tourniquet should show old red-brown rubber and medical mark');
  assert.ok(countPixels(tourniquet, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 450, 'tourniquet should keep a dark loop silhouette');
  assert.notEqual(spriteHash(tourniquet), spriteHash(generateItemSprite('bandage')), 'tourniquet should differ from bandage');

  const toz = generateItemSprite('toz_shotgun');
  assert.ok(countPixels(toz, (r, g, b, a) => a > 120 && b >= r + 4 && g >= r && r < 115) > 240, 'toz_shotgun should show long cold barrel metal');
  assert.ok(countPixels(toz, (r, g, b, a) => a > 120 && r > 145 && g > 90 && g < 190 && b < 100) > 40, 'toz_shotgun should include brass/service hardware');
  assert.notEqual(spriteHash(toz), spriteHash(generateItemSprite('shotgun')), 'toz_shotgun should differ from sawed-off shotgun');

  const trackScrap = generateItemSprite('track_diagram_scrap');
  assert.ok(countPixelsIn(trackScrap, 18, 24, 49, 44, (r, g, b, a) => a > 120 && r < 85 && g < 100 && b < 105) > 120, 'track_diagram_scrap should show dark rail diagram lines');
  assert.notEqual(spriteHash(trackScrap), spriteHash(generateItemSprite('rail_depot_pass')), 'track_diagram_scrap should differ from rail depot pass');

  const zhernov = generateItemSprite('tracked_zhernov');
  assert.ok(countPixelsIn(zhernov, 12, 36, 54, 51, (_r, _g, _b, a) => a > 120) > 550, 'tracked_zhernov should show a heavy tread chassis');
  assert.ok(countPixels(zhernov, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 500, 'tracked_zhernov should keep heavy black metal mass');
  assert.notEqual(spriteHash(zhernov), spriteHash(generateItemSprite('grn420_gravizhernov')), 'tracked_zhernov should differ from gravity zhernov gun');

  const tt = generateItemSprite('tt_pistol');
  assert.ok(countPixels(tt, (r, g, b, a) => a > 120 && r < 90 && g < 105 && b < 110) > 550, 'tt_pistol should read as a dark slim sidearm');
  assert.ok(countPixels(tt, (r, g, b, a) => a > 120 && b >= r + 4 && g >= r && r < 115) > 300, 'tt_pistol should use blue-black slide metal');
  assert.notEqual(spriteHash(tt), spriteHash(generateItemSprite('makarov')), 'tt_pistol should differ from makarov');
});

test('sprite bundle 045 items read as terminal stamp, clot jar, substrate sack, sugar, syringe, Tanev rifle, tea and spirit', () => {
  const expected = [
    ['stolen_terminal_stamp', 'Украденная печать терминала', ItemType.MISC],
    ['strange_clot', 'Странный сгусток', ItemType.MISC],
    ['substrate_sack', 'Мешок субстрата', ItemType.MISC],
    ['sugar_pack', 'Сахар', ItemType.FOOD],
    ['syringe_empty', 'Пустой шприц', ItemType.MISC],
    ['tanev_svt40', 'СВТ-40 Танева', ItemType.WEAPON],
    ['tea', 'Чай', ItemType.DRINK],
    ['technical_spirit', 'Технический спирт', ItemType.MISC],
  ] as const;

  const hashes = new Set<number>();
  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 045 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 45,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'tea', count: 0 },
      { defId: 'technical_spirit', count: 2 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'technical_spirit', 'bundle 045 world drops should resolve visuals from positive item payload');

  const stamp = generateItemSprite('stolen_terminal_stamp');
  assert.ok(countPixels(stamp, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 55 && b < 180) > 350, 'stolen terminal stamp should read as yellowed terminal paperwork');
  assert.ok(countPixels(stamp, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 70, 'stolen terminal stamp should include a red stamp mark');
  assert.ok(countPixels(stamp, (r, g, b, a) => a > 40 && g > 135 && b > 140 && r < 110) > 12, 'stolen terminal stamp should include a weak cyan terminal glow');

  const clot = generateItemSprite('strange_clot');
  assert.ok(countPixels(clot, (r, g, b, a) => a > 130 && r > 85 && r > g + 35 && b > 25 && b < 95) > 130, 'strange_clot should show a dark red organic clot');
  assert.ok(countPixels(clot, (r, g, b, a) => a > 100 && g > 80 && b > 70 && r < 185) > 90, 'strange_clot should show dirty jar glass around the clot');
  assert.ok(countPixelsIn(clot, 38, 29, 50, 38, (r, g, b, a) => a > 140 && r > 145 && g > 120 && b > 70 && b < 180) > 35, 'strange_clot should include a paper tag');

  const substrate = generateItemSprite('substrate_sack');
  assert.ok(countPixels(substrate, (r, g, b, a) => a > 140 && r > 85 && r < 210 && g > 55 && g < 170 && b < 115) > 190, 'substrate_sack should read as a damp brown sack');
  assert.ok(countPixels(substrate, (r, g, b, a) => a > 100 && g > 80 && r < 120 && b < 100) > 50, 'substrate_sack should show green damp substrate staining');
  assert.ok(countPixels(substrate, (r, g, b, a) => a > 130 && r > 160 && g > 130 && b < 130) > 35, 'substrate_sack should include string or label highlights');

  const sugar = generateItemSprite('sugar_pack');
  assert.ok(countPixels(sugar, (r, g, b, a) => a > 140 && r > 175 && g > 165 && b > 125) > 120, 'sugar_pack should expose pale sugar and torn paper');
  assert.ok(countPixels(sugar, (r, g, b, a) => a > 130 && r > 125 && g < 90 && b < 85) > 45, 'sugar_pack should include a red ration label');
  assert.notEqual(spriteHash(sugar), spriteHash(generateItemSprite('pressed_sugar')), 'sugar_pack should differ from pressed_sugar');

  const syringe = generateItemSprite('syringe_empty');
  assert.ok(countPixels(syringe, (r, g, b, a) => a > 100 && g > 150 && b > 135 && r < 210) > 70, 'syringe_empty should show greenish transparent barrel glass');
  assert.ok(countPixelsIn(syringe, 45, 8, 60, 22, (_r, _g, _b, a) => a > 120) > 20, 'syringe_empty should keep a thin needle silhouette');
  assert.ok(countPixels(syringe, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 15, 'syringe_empty should include a small medical red mark');

  const tanev = generateItemSprite('tanev_svt40');
  assert.ok(countPixels(tanev, (r, g, b, a) => a > 120 && b >= r + 8 && g >= r && r < 115) > 85, 'tanev_svt40 should show blue-black rifle metal');
  assert.ok(countPixels(tanev, (r, g, b, a) => a > 120 && r > 70 && r < 175 && g > 35 && g < 115 && b < 90) > 65, 'tanev_svt40 should show worn wooden furniture');
  assert.ok(countPixelsIn(tanev, 48, 17, 62, 25, (_r, _g, _b, a) => a > 120) > 25, 'tanev_svt40 should keep a long muzzle line');
  assert.notEqual(spriteHash(tanev), spriteHash(generateItemSprite('moskvin_rifle')), 'tanev_svt40 should differ from moskvin_rifle');
  assert.notEqual(spriteHash(tanev), spriteHash(generateItemSprite('nosin_rifle')), 'tanev_svt40 should differ from nosin_rifle');

  const teaSprite = generateItemSprite('tea');
  assert.ok(countPixels(teaSprite, (r, g, b, a) => a > 130 && r > 85 && r < 205 && g > 45 && g < 145 && b < 90) > 85, 'tea should show brown tea liquid and stains');
  assert.ok(countPixels(teaSprite, (r, g, b, a) => a > 140 && Math.abs(r - g) < 28 && r > 120 && b > 90 && b < 190) > 220, 'tea should read as a worn enamel mug');
  assert.ok(countPixelsIn(teaSprite, 43, 28, 56, 46, (_r, _g, _b, a) => a > 120) > 45, 'tea should include a mug handle and tea-tag silhouette');

  const spirit = generateItemSprite('technical_spirit');
  assert.ok(countPixels(spirit, (r, g, b, a) => a > 120 && g > 150 && b > 145 && r < 140) > 100, 'technical_spirit should show cyan clear liquid');
  assert.ok(countPixels(spirit, (r, g, b, a) => a > 130 && r > 130 && g < 95 && b < 90) > 70, 'technical_spirit should include a red hazard/medical cross label');
  assert.ok(countPixelsIn(spirit, 27, 8, 39, 16, (_r, _g, _b, a) => a > 150) > 30, 'technical_spirit should keep a dark sealed cap');
  assert.notEqual(spriteHash(spirit), spriteHash(generateItemSprite('alcohol_bottle')), 'technical_spirit should differ from ordinary alcohol bottle');
  assert.notEqual(spriteHash(spirit), spriteHash(teaSprite), 'technical_spirit should differ from tea');
});

test('sprite bundle 044 items read as distinct electronics, food, medicine, document, and trade icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['sound_emitter', 'Звукоизлучатель', ItemType.MISC],
    ['soup_cube', 'Суповой кубик', ItemType.FOOD],
    ['spore_print', 'Споровый отпечаток', ItemType.MISC],
    ['spring', 'Пружина', ItemType.MISC],
    ['sterile_bandage', 'Стерильный бинт', ItemType.MEDICINE],
    ['sterile_swab', 'Стерильный мазок', ItemType.MISC],
    ['stolen_archive_card', 'Краденая архивная карточка', ItemType.MISC],
    ['stolen_filter_pack', 'Краденая пачка фильтров', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 200, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 044 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 44,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'sound_emitter', count: 0 },
      { defId: 'sterile_swab', count: 3 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'sterile_swab', 'bundle 044 world drops should resolve visuals from positive item payload');

  const emitter = generateItemSprite('sound_emitter');
  assert.ok(countPixels(emitter, (r, g, b, a) => a > 90 && g > 145 && b > 130 && r < 120) > 85, 'sound_emitter should show cyan dead pixels and weak electric glow');
  assert.ok(countPixels(emitter, (r, g, b, a) => a > 120 && r > 140 && g < 90 && b < 85) > 25, 'sound_emitter should include a red error slit');
  assert.notEqual(spriteHash(emitter), spriteHash(generateItemSprite('field_radio_battery')), 'sound_emitter should differ from radio battery electronics');

  const soup = generateItemSprite('soup_cube');
  assert.ok(countPixels(soup, (r, g, b, a) => a > 140 && r > 120 && g > 70 && g < 180 && b < 100) > 230, 'soup_cube should read as ochre ration cube and paper wrap');
  assert.ok(countPixels(soup, (r, g, b, a) => a > 100 && g > 95 && r < 125 && b < 95) > 20, 'soup_cube should include dull green ration risk marks');
  assert.notEqual(spriteHash(soup), spriteHash(generateItemSprite('green_briquette')), 'soup_cube should not reuse briquette geometry');

  const print = generateItemSprite('spore_print');
  assert.ok(countPixelsIn(print, 18, 24, 46, 42, (r, g, b, a) => a > 100 && r < 70 && g < 80 && b < 70) > 100, 'spore_print should show a dark spore imprint on paper');
  assert.ok(countPixels(print, (r, g, b, a) => a > 100 && g > 90 && r < 105 && b < 95) > 25, 'spore_print should include damp green fungal stains');
  assert.notEqual(spriteHash(print), spriteHash(generateItemSprite('mushroom_mass')), 'spore_print should read as a paper imprint, not loose mushroom mass');

  const coil = generateItemSprite('spring');
  assert.ok(countPixels(coil, (r, g, b, a) => a > 120 && Math.abs(r - g) < 35 && Math.abs(g - b) < 50 && r > 90 && r < 240) > 180, 'spring should read as pale coiled metal');
  assert.ok(countPixels(coil, (r, g, b, a) => a > 110 && r > 110 && g < 90 && b < 80) > 25, 'spring should include rusty spots and tag marks');
  assert.notEqual(spriteHash(coil), spriteHash(generateItemSprite('wire_coil')), 'spring should not reuse wire_coil language');

  const bandage = generateItemSprite('sterile_bandage');
  assert.ok(countPixels(bandage, (r, g, b, a) => a > 130 && r > 185 && g > 180 && b > 150) > 230, 'sterile_bandage should show clean sealed cloth and pouch');
  assert.ok(countPixels(bandage, (r, g, b, a) => a > 140 && r > 140 && g < 90 && b < 90) > 70, 'sterile_bandage should include a red medical cross');
  assert.notEqual(spriteHash(bandage), spriteHash(generateItemSprite('bandage')), 'sterile_bandage should differ from the dusty bandage roll');

  const swab = generateItemSprite('sterile_swab');
  assert.ok(countPixels(swab, (r, g, b, a) => a > 100 && g > 140 && b > 120 && r < 130) > 90, 'sterile_swab should show green-cyan sterile sample marks');
  assert.ok(countPixels(swab, (r, g, b, a) => a > 120 && r > 185 && g > 180 && b > 150) > 100, 'sterile_swab should include pale cotton and sealed packet highlights');
  assert.notEqual(spriteHash(swab), spriteHash(generateItemSprite('contaminated_swab')), 'sterile_swab should differ from the contaminated swab document');

  const archive = generateItemSprite('stolen_archive_card');
  assert.ok(countPixels(archive, (r, g, b, a) => a > 140 && r > 140 && g > 105 && b < 160) > 360, 'stolen_archive_card should read as yellowed archive card stock');
  assert.ok(countPixels(archive, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 80, 'stolen_archive_card should show red stolen/archive stamps');
  assert.notEqual(spriteHash(archive), spriteHash(generateItemSprite('archive_access_permit')), 'stolen_archive_card should differ from official archive access permit');

  const filters = generateItemSprite('stolen_filter_pack');
  assert.ok(countPixels(filters, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 90 && r < 220) > 170, 'stolen_filter_pack should show grey filter discs');
  assert.ok(countPixels(filters, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 65, 'stolen_filter_pack should include red contraband audit bands');
  assert.ok(countPixels(filters, (r, g, b, a) => a > 70 && g > 135 && b > 120 && r < 130) > 20, 'stolen_filter_pack should include a weak cyan filter seal cue');
  assert.notEqual(spriteHash(filters), spriteHash(generateItemSprite('gasmask_filter')), 'stolen_filter_pack should differ from a single clean gasmask filter');
});

test('sprite bundle 049 items read as distinct weapon, permit, tool and bread icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['weapon_blueprint_t2', 'Чертёж оружия Т2', ItemType.MISC],
    ['weapon_checkout_tag', 'Оружейная бирка', ItemType.MISC],
    ['weapon_permit_forged', 'Липовое оружейное разрешение', ItemType.MISC],
    ['weapon_permit_signed', 'Разрешение на короткоствол', ItemType.MISC],
    ['wet_rag_bundle', 'Мокрые тряпки', ItemType.MISC],
    ['wire_coil', 'Моток провода', ItemType.MISC],
    ['wrench', 'Ключ гаечный', ItemType.WEAPON],
    ['yeast_bread', 'Дрожжевой хлеб', ItemType.FOOD],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 049 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 49,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'wet_rag_bundle', count: 0 },
      { defId: 'weapon_blueprint_t2', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'weapon_blueprint_t2', 'bundle 049 world drops should resolve visuals from positive item payload');

  const blueprint = generateItemSprite('weapon_blueprint_t2');
  assert.ok(countPixels(blueprint, (r, g, b, a) => a > 120 && r > 135 && g > 115 && b > 55 && b < 170) > 300, 'weapon_blueprint_t2 should show a yellowed blueprint sheet');
  assert.ok(countPixels(blueprint, (r, g, b, a) => a > 80 && g > 150 && b > 150 && r < 130) > 35, 'weapon_blueprint_t2 should include cyan blueprint lines');
  assert.ok(countPixels(blueprint, (r, g, b, a) => a > 140 && r < 70 && g < 80 && b < 80) > 60, 'weapon_blueprint_t2 should carry a dark weapon sketch');
  assert.notEqual(spriteHash(blueprint), spriteHash(generateItemSprite('blueprint_t2_folder')), 'weapon_blueprint_t2 should differ from the T2 folder');

  const tag = generateItemSprite('weapon_checkout_tag');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 130 && r > 130 && g > 80 && g < 190 && b < 100) > 300, 'weapon_checkout_tag should read as a worn armory tag');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 130 && r < 75 && g < 80 && b < 80) > 90, 'weapon_checkout_tag should include black serial ink and a sidearm mark');
  assert.ok(countPixels(tag, (r, g, b, a) => a > 120 && r > 145 && g < 95 && b < 90) > 25, 'weapon_checkout_tag should include red checkout paint');
  assert.notEqual(spriteHash(tag), spriteHash(generateItemSprite('scrubbed_weapon_tag')), 'weapon_checkout_tag should differ from scrubbed weapon tag');

  const forged = generateItemSprite('weapon_permit_forged');
  const signed = generateItemSprite('weapon_permit_signed');
  assert.ok(countPixels(forged, (r, g, b, a) => a > 120 && r > 140 && g > 110 && b > 55 && b < 165) > 300, 'weapon_permit_forged should keep a yellow permit body');
  assert.ok(countPixels(forged, (r, g, b, a) => a > 100 && b > 100 && r > 80 && g < 130) > 40, 'weapon_permit_forged should show violet forged correction marks');
  assert.ok(countPixels(forged, (r, g, b, a) => a > 120 && r > 140 && g < 95 && b < 90) > 65, 'weapon_permit_forged should show red false stamps');
  assert.ok(countPixels(signed, (r, g, b, a) => a > 120 && r > 150 && g > 125 && b > 65 && b < 175) > 320, 'weapon_permit_signed should keep an official paper body');
  assert.ok(countPixels(signed, (r, g, b, a) => a > 120 && g > 105 && r < 120 && b < 120) > 35, 'weapon_permit_signed should include green official permit blocks');
  assert.ok(countPixels(signed, (r, g, b, a) => a > 120 && r < 75 && g < 80 && b < 80) > 45, 'weapon_permit_signed should include a black short-sidearm silhouette');
  assert.notEqual(spriteHash(forged), spriteHash(signed), 'forged and signed weapon permits should differ');

  const rag = generateItemSprite('wet_rag_bundle');
  assert.ok(countPixels(rag, (r, g, b, a) => a > 120 && r < 125 && g > 85 && b > 80) > 220, 'wet_rag_bundle should read as blue-green wet cloth');
  assert.ok(countPixels(rag, (r, g, b, a) => a > 80 && g > 150 && b > 140 && r < 140) > 30, 'wet_rag_bundle should show wet/cyan highlights');
  assert.notEqual(spriteHash(rag), spriteHash(generateItemSprite('cloth_roll')), 'wet_rag_bundle should differ from dry cloth roll');

  const wire = generateItemSprite('wire_coil');
  assert.ok(countPixels(wire, (r, g, b, a) => a > 100 && g > 140 && b > 135 && r < 125) > 120, 'wire_coil should show cyan insulated loops');
  assert.ok(countPixels(wire, (r, g, b, a) => a > 120 && r > 150 && g > 70 && g < 145 && b < 80) > 20, 'wire_coil should show copper wire ends');
  assert.notEqual(spriteHash(wire), spriteHash(generateItemSprite('circuit_board')), 'wire_coil should not collapse into electronics board language');

  const wrench = generateItemSprite('wrench');
  assert.ok(countPixels(wrench, (r, g, b, a) => a > 130 && r > 65 && r < 185 && g > 75 && b > 70 && Math.abs(g - b) < 55) > 220, 'wrench should show a cold steel tool body');
  assert.ok(countPixelsIn(wrench, 36, 11, 58, 32, (_r, _g, _b, a) => a > 120) > 90, 'wrench should keep an open jaw head silhouette');
  assert.ok(countPixels(wrench, (r, g, b, a) => a > 120 && r > 115 && r < 180 && g > 35 && g < 95 && b < 80) > 15, 'wrench should include rust and chipped service wear');
  assert.notEqual(spriteHash(wrench), spriteHash(generateItemSprite('hammer')), 'wrench should differ from hammer');
  assert.notEqual(spriteHash(wrench), spriteHash(generateItemSprite('pipe')), 'wrench should differ from pipe');

  const yeast = generateItemSprite('yeast_bread');
  assert.ok(countPixels(yeast, (r, g, b, a) => a > 120 && r > 110 && g > 60 && g < 170 && b < 115) > 300, 'yeast_bread should show a swollen ochre loaf');
  assert.ok(countPixels(yeast, (r, g, b, a) => a > 100 && r > 190 && g > 140 && b < 145) > 45, 'yeast_bread should show pale crumb and yeast bubbles');
  assert.ok(countPixels(yeast, (r, g, b, a) => a > 80 && g > 95 && r < 120 && b < 110) > 12, 'yeast_bread should include stale green flecks');
  assert.notEqual(spriteHash(yeast), spriteHash(generateItemSprite('bread')), 'yeast_bread should differ from regular bread');
});

test('sprite bundle 047 items read as distinct detector, documents, cleanup tools, valve, vent and sand icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['unpeople_detector', 'Детектор нелюдей', ItemType.TOOL],
    ['unsigned_order', 'Приказ без подписи', ItemType.MISC],
    ['used_gasmask_filter', 'Отработанный фильтр', ItemType.MISC],
    ['uv_spotlight', 'УФ-прожектор ликвидатора', ItemType.TOOL],
    ['vacuum', 'Пылесос', ItemType.TOOL],
    ['valve_tag', 'Бирка вентиля', ItemType.MISC],
    ['vent_damper_plate', 'Заслонка вентиляции', ItemType.MISC],
    ['veretar_sand', 'Белый песок', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 220, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 047 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 47,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'unpeople_detector', count: 0 },
      { defId: 'uv_spotlight', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'uv_spotlight', 'bundle 047 world drops should resolve visuals from positive item payload');

  const detector = generateItemSprite('unpeople_detector');
  assert.ok(countPixels(detector, (r, g, b, a) => a > 100 && g > 140 && b > 130 && r < 150) > 35, 'unpeople_detector should show a cyan detector screen');
  assert.ok(countPixels(detector, (r, g, b, a) => a > 120 && r > 165 && g > 110 && b < 90) > 25, 'unpeople_detector should include yellow service controls');
  assert.notEqual(spriteHash(detector), spriteHash(generateItemSprite('fog_detector')), 'unpeople_detector should differ from fog_detector');

  const order = generateItemSprite('unsigned_order');
  assert.ok(countPixels(order, (r, g, b, a) => a > 140 && r > 145 && g > 115 && b > 70 && b < 185) > 430, 'unsigned_order should read as a dirty order sheet');
  assert.ok(countPixels(order, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 35, 'unsigned_order should include red missing-signature marks');
  assert.notEqual(spriteHash(order), spriteHash(generateItemSprite('ammo_issue_order')), 'unsigned_order should not reuse ammo issue order icon language');

  const usedFilter = generateItemSprite('used_gasmask_filter');
  assert.ok(countPixels(usedFilter, (r, g, b, a) => a > 140 && r > 140 && g > 115 && b > 70 && b < 180) > 350, 'used_gasmask_filter should keep an evidence-paper read');
  assert.ok(countPixelsIn(usedFilter, 30, 23, 50, 44, (_r, _g, _b, a) => a > 140) > 180, 'used_gasmask_filter should show a spent filter puck');
  assert.ok(countPixels(usedFilter, (r, g, b, a) => a > 80 && g > 80 && r < 110 && b < 100) > 20, 'used_gasmask_filter should include damp smog residue');
  assert.notEqual(spriteHash(usedFilter), spriteHash(generateItemSprite('gasmask_filter')), 'used_gasmask_filter should differ from a dry gasmask filter');

  const uv = generateItemSprite('uv_spotlight');
  assert.ok(countPixels(uv, (r, g, b, a) => a > 90 && b > 140 && r < 170 && g > 80) > 70, 'uv_spotlight should show violet/cyan ultraviolet lens pixels');
  assert.ok(countPixels(uv, (r, g, b, a) => a > 120 && r > 165 && g > 110 && b < 95) > 35, 'uv_spotlight should include yellow liquidator service paint');
  assert.notEqual(spriteHash(uv), spriteHash(generateItemSprite('liquidator_flashlamp')), 'uv_spotlight should differ from liquidator_flashlamp');

  const vacuum = generateItemSprite('vacuum');
  assert.ok(countPixels(vacuum, (r, g, b, a) => a > 120 && r < 75 && g < 85 && b < 85) > 170, 'vacuum should keep a dark hose/nozzle silhouette');
  assert.ok(countPixels(vacuum, (r, g, b, a) => a > 100 && g > 135 && b > 120 && r < 130) > 20, 'vacuum should include cyan dust/samosbor residue');
  assert.notEqual(spriteHash(vacuum), spriteHash(generateItemSprite('cleaning_kit')), 'vacuum should differ from cleaning_kit');

  const valve = generateItemSprite('valve_tag');
  assert.ok(countPixels(valve, (r, g, b, a) => a > 140 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 85 && r < 220) > 300, 'valve_tag should read as a metal tag');
  assert.ok(countPixels(valve, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 35, 'valve_tag should include red pressure marks');
  assert.ok(countPixelsIn(valve, 22, 23, 31, 31, (_r, _g, _b, a) => a > 120) > 35, 'valve_tag should show a punched tag hole');

  const damper = generateItemSprite('vent_damper_plate');
  assert.ok(countPixels(damper, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 75 && r < 210) > 360, 'vent_damper_plate should read as a soot-stained metal plate');
  assert.ok(countPixelsIn(damper, 20, 22, 45, 42, (r, g, b, a) => a > 130 && r < 85 && g < 90 && b < 90) > 90, 'vent_damper_plate should show dark louver slats');
  assert.ok(countPixels(damper, (r, g, b, a) => a > 30 && b > 120 && r < 160) > 25, 'vent_damper_plate should include a weak blue-violet vent glow');
  assert.notEqual(spriteHash(damper), spriteHash(generateItemSprite('filter_canister')), 'vent_damper_plate should differ from filter_canister');

  const sand = generateItemSprite('veretar_sand');
  assert.ok(countPixels(sand, (r, g, b, a) => a > 120 && r > 180 && g > 180 && b > 150) > 260, 'veretar_sand should show loose pale white sand');
  assert.ok(countPixels(sand, (r, g, b, a) => a > 70 && g > 140 && b > 135 && r < 150) > 15, 'veretar_sand should include a weak cyan anomalous glint');
  assert.notEqual(spriteHash(sand), spriteHash(generateItemSprite('sealed_veretar_sand')), 'veretar_sand should differ from sealed_veretar_sand');
});

test('sprite bundle 043 items read as distinct silver slime, cleanup, weapon, smoke and soap icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['slime_sample_silver', 'Прозрачная слизь, пломба', ItemType.MISC],
    ['slime_sample_silver_open', 'Прозрачная слизь, вскрыта', ItemType.MISC],
    ['slime_sample_white', 'Проба белой слизи', ItemType.MISC],
    ['slime_scraper', 'Скребок для слизи', ItemType.TOOL],
    ['slime_sense_node', 'Чувствительный узел слизи', ItemType.MISC],
    ['slyoznev_pps41', 'ППС-41 Слизнёва', ItemType.WEAPON],
    ['smoke_candle_check', 'Дымовая шашка проверки тяги', ItemType.MISC],
    ['soap_72', 'Мыло хозяйственное 72%', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 900, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 043 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 43,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'slime_sample_silver', count: 0 },
      { defId: 'soap_72', count: 2 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'soap_72', 'bundle 043 world drops should resolve visuals from positive item payload');

  const silver = generateItemSprite('slime_sample_silver');
  assert.ok(countPixels(silver, (r, g, b, a) => a > 110 && Math.abs(r - g) < 28 && Math.abs(g - b) < 34 && r > 145) > 300, 'sealed silver sample should show a silver glass rim/core');
  assert.ok(countPixels(silver, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 90, 'sealed silver sample should include a red plomb/seal');
  assert.notEqual(spriteHash(silver), spriteHash(generateItemSprite('slime_sample_silver_open')), 'sealed and opened silver samples should differ');

  const opened = generateItemSprite('slime_sample_silver_open');
  assert.ok(countPixelsIn(opened, 39, 43, 55, 54, (r, g, b, a) => a > 70 && r > 150 && g > 150 && b > 130) > 60, 'opened silver sample should show a leaked pale slime stain');
  assert.ok(countPixels(opened, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 90) > 160, 'opened silver sample should show a dark opened jar mouth');

  const white = generateItemSprite('slime_sample_white');
  assert.ok(countPixels(white, (r, g, b, a) => a > 130 && r > 185 && g > 185 && b > 160) > 90, 'white slime sample should show matte white residue');
  assert.ok(countPixels(white, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 55, 'white slime sample should include a red no-look warning slash');
  assert.notEqual(spriteHash(white), spriteHash(generateItemSprite('slime_sample_blue')), 'white sample should not reuse the blue sample icon');

  const scraper = generateItemSprite('slime_scraper');
  assert.ok(countPixels(scraper, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 90) > 350, 'slime_scraper should keep a dark handle/blade outline');
  assert.ok(countPixels(scraper, (r, g, b, a) => a > 100 && r > 90 && r < 180 && g > 40 && g < 125 && b < 85) > 80, 'slime_scraper should show brown slime residue');
  assert.ok(countPixels(scraper, (r, g, b, a) => a > 80 && g > 130 && b > 110 && r < 150) > 80, 'slime_scraper should include cleanup reagent shine');

  const node = generateItemSprite('slime_sense_node');
  assert.ok(countPixels(node, (r, g, b, a) => a > 130 && r > 130 && g > 60 && g < 150 && b > 80 && b < 170) > 80, 'slime_sense_node should read as a pink organic node');
  assert.ok(countPixels(node, (r, g, b, a) => a > 80 && g > 130 && b > 110 && r < 150) > 100, 'slime_sense_node should show wet cyan-green sensory slime');
  assert.notEqual(spriteHash(node), spriteHash(generateItemSprite('slime_motor_node')), 'slime_sense_node should differ from slime_motor_node');

  const pps = generateItemSprite('slyoznev_pps41');
  assert.ok(countPixels(pps, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 90) > 500, 'slyoznev_pps41 should keep a dark SMG silhouette');
  assert.ok(countPixels(pps, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 50, 'slyoznev_pps41 should include red liquidator paint');
  assert.notEqual(spriteHash(pps), spriteHash(generateItemSprite('ppsh')), 'slyoznev_pps41 should not reuse the PPSh drum silhouette');

  const smoke = generateItemSprite('smoke_candle_check');
  assert.ok(countPixels(smoke, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 120) > 100, 'smoke_candle_check should show yellow service labeling');
  assert.ok(countPixels(smoke, (r, g, b, a) => a > 130 && r < 75 && g < 85 && b < 90) > 250, 'smoke_candle_check should keep a dark metal candle body');
  assert.ok(countPixelsIn(smoke, 18, 7, 48, 19, (_r, _g, _b, a) => a > 40) > 40, 'smoke_candle_check should show a small smoke plume');

  const soap = generateItemSprite('soap_72');
  assert.ok(countPixels(soap, (r, g, b, a) => a > 120 && r > 160 && g > 110 && b < 120) > 350, 'soap_72 should read as yellow household soap');
  assert.ok(countPixels(soap, (r, g, b, a) => a > 100 && r > 90 && r < 180 && g > 40 && g < 125 && b < 85) > 220, 'soap_72 should include stamped grime and chipped brown edges');
  assert.notEqual(spriteHash(soap), spriteHash(generateItemSprite('toiletpaper')), 'soap_72 should differ from bathroom paper goods');
});

test('sprite bundle 050 items read as distinct weapon, seal, zhelemish and sample icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['zatychkin_pistol', 'Пистолет Затычкина', ItemType.WEAPON],
    ['zhek_seal', 'Печать ЖЭК', ItemType.MISC],
    ['zhelemish_boiled', 'Варёный желемыш', ItemType.MEDICINE],
    ['zhelemish_dried', 'Сушёный желемыш', ItemType.FOOD],
    ['zhelemish_raw', 'Сырой желемыш', ItemType.FOOD],
    ['zhelemish_sample_contaminated', 'Загрязнённый образец желемыша', ItemType.MISC],
    ['zhelemish_sample_sealed', 'Запечатанный образец желемыша', ItemType.MISC],
    ['zinc_slime_bucket', 'Цинковое ведро для слизи', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 190, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 050 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 50,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'zhelemish_raw', count: 0 },
      { defId: 'zinc_slime_bucket', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'zinc_slime_bucket', 'bundle 050 world drops should resolve visuals from positive item payload');

  const pistol = generateItemSprite('zatychkin_pistol');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 130 && r < 90 && g >= r && b > r + 8) > 120, 'zatychkin_pistol should show black/blue officer metal');
  assert.ok(countPixels(pistol, (r, g, b, a) => a > 120 && r > 145 && g > 90 && b < 90) > 40, 'zatychkin_pistol should include yellow/red service marks');
  assert.ok(countPixelsIn(pistol, 29, 38, 39, 53, (r, g, b, a) => a > 130 && r > 35 && r < 125 && g > 25 && g < 95 && b < 75) > 35, 'zatychkin_pistol should keep a readable pistol grip');
  for (const id of ['makarov', 'karkarov_pistol', 'homemade_pistol']) {
    assert.notEqual(spriteHash(pistol), spriteHash(generateItemSprite(id)), `zatychkin_pistol should not reuse ${id} sprite language`);
  }

  const seal = generateItemSprite('zhek_seal');
  assert.ok(countPixels(seal, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 85) > 150, 'zhek_seal should read as a red rubber stamp');
  assert.ok(countPixels(seal, (r, g, b, a) => a > 120 && r > 75 && r < 175 && g > 45 && g < 130 && b < 85) > 150, 'zhek_seal should include a worn wooden handle');
  assert.ok(countPixels(seal, (r, g, b, a) => a > 120 && r > 165 && g > 135 && b > 80 && b < 160) > 25, 'zhek_seal should include a small paper label');
  assert.notEqual(spriteHash(seal), spriteHash(generateItemSprite('seal_wax')), 'zhek_seal should differ from loose sealing wax');

  const raw = generateItemSprite('zhelemish_raw');
  assert.ok(countPixels(raw, (r, g, b, a) => a > 120 && g > 115 && g > r + 20 && b < 150) > 180, 'raw zhelemish should show wet green organic mass');
  assert.ok(countPixels(raw, (r, g, b, a) => a > 110 && r > 130 && g < 90 && b < 90) > 20, 'raw zhelemish should include risky red contamination marks');

  const dried = generateItemSprite('zhelemish_dried');
  assert.ok(countPixels(dried, (r, g, b, a) => a > 120 && r > 80 && r < 190 && g > 45 && g < 135 && b < 90) > 220, 'dried zhelemish should read as a brown leathery slab');
  assert.ok(countPixels(dried, (r, g, b, a) => a > 120 && r > 160 && g > 120 && b < 110) > 30, 'dried zhelemish should include twine or dry ochre highlights');
  assert.notEqual(spriteHash(dried), spriteHash(raw), 'raw and dried zhelemish should be visually distinct');

  const boiled = generateItemSprite('zhelemish_boiled');
  assert.ok(countPixels(boiled, (r, g, b, a) => a > 130 && r > 130 && g < 95 && b < 95) > 120, 'boiled zhelemish should show a red medical cross');
  assert.ok(countPixels(boiled, (r, g, b, a) => a > 120 && g > 145 && r < 180 && b > 90) > 80, 'boiled zhelemish should include green treated slime');
  assert.notEqual(spriteHash(boiled), spriteHash(raw), 'boiled zhelemish should differ from raw zhelemish');

  const sealed = generateItemSprite('zhelemish_sample_sealed');
  const contaminated = generateItemSprite('zhelemish_sample_contaminated');
  assert.ok(countPixels(sealed, (r, g, b, a) => a > 120 && g > 150 && r < 160 && b < 160) > 110, 'sealed zhelemish sample should show clean green sample mass');
  assert.ok(countPixels(sealed, (r, g, b, a) => a > 130 && r > 130 && g < 95 && b < 95) > 55, 'sealed zhelemish sample should include red plomb/seal marks');
  assert.ok(countPixels(contaminated, (r, g, b, a) => a > 120 && r > 65 && r < 130 && g > 45 && g < 110 && b < 90) > 50, 'contaminated zhelemish sample should include dirty brown contamination');
  assert.ok(countPixels(contaminated, (r, g, b, a) => a > 100 && r > 140 && b > 130 && g < 130) > 35, 'contaminated zhelemish sample should include violet unsafe sample mass');
  assert.notEqual(spriteHash(sealed), spriteHash(contaminated), 'sealed and contaminated zhelemish samples should differ');

  const bucket = generateItemSprite('zinc_slime_bucket');
  assert.ok(countPixels(bucket, (r, g, b, a) => a > 130 && Math.abs(r - g) < 35 && Math.abs(g - b) < 45 && r > 80 && r < 210) > 260, 'zinc_slime_bucket should read as zinc metal');
  assert.ok(countPixels(bucket, (r, g, b, a) => a > 100 && g > 145 && r < 150 && b < 170) > 100, 'zinc_slime_bucket should contain green slime');
  assert.ok(countPixels(bucket, (r, g, b, a) => a > 60 && b > 150 && r > 80 && g < 150) > 30, 'zinc_slime_bucket should include rare purple-blue slime glow');
  assert.notEqual(spriteHash(bucket), spriteHash(generateItemSprite('lime_bucket')), 'zinc_slime_bucket should differ from lime_bucket');
});

test('sprite bundle 031 items read as pressure records, cleanup gear, mold food and psi artifacts', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['pressure_logbook', 'Журнал давления', ItemType.MISC],
    ['protective_apron', 'Кислотный фартук', ItemType.MISC],
    ['protein_mold_cake', 'Плесневой белковый брикет', ItemType.FOOD],
    ['psi_beam', 'Сгусток: ПСИ-луч', ItemType.WEAPON],
    ['psi_brainburn', 'Сгусток: Выжиг мозга', ItemType.WEAPON],
    ['psi_concrete_splinter', 'Сгусток: Бетонный осколок', ItemType.WEAPON],
    ['psi_control', 'Сгусток: Контроль', ItemType.WEAPON],
    ['psi_dust', 'ПСИ-пыль', ItemType.MISC],
    ['psi_madness', 'Сгусток: Безумие', ItemType.WEAPON],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 180, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 031 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 31,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'pressure_logbook', count: 0 },
      { defId: 'psi_dust', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'psi_dust', 'bundle 031 world drops should resolve visuals from positive item payload');

  const logbook = generateItemSprite('pressure_logbook');
  assert.ok(countPixels(logbook, (r, g, b, a) => a > 150 && r > 120 && g > 85 && b < 125) > 450, 'pressure_logbook should read as an ochre wet logbook');
  assert.ok(countPixels(logbook, (r, g, b, a) => a > 120 && r > 125 && g < 95 && b < 90) > 25, 'pressure_logbook should include red gauge/stamp marks');
  assert.ok(countPixels(logbook, (r, g, b, a) => a > 70 && g > r && b > r && r < 100) > 35, 'pressure_logbook should include damp pipe-room staining');
  assert.notEqual(spriteHash(logbook), spriteHash(generateItemSprite('book')), 'pressure_logbook should differ from the common book icon');

  const apron = generateItemSprite('protective_apron');
  assert.ok(countPixels(apron, (r, g, b, a) => a > 130 && g > r + 10 && b >= r - 12 && r < 145) > 180, 'protective_apron should show green rubber mass');
  assert.ok(countPixels(apron, (r, g, b, a) => a > 110 && r > 155 && g > 130 && b < 95) > 35, 'protective_apron should show acid stains');
  assert.ok(countPixels(apron, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 25, 'protective_apron should include red evidence/liquidator marks');
  assert.notEqual(spriteHash(apron), spriteHash(generateItemSprite('wet_rag_bundle')), 'protective_apron should not collapse to cleanup cloth');

  const moldCake = generateItemSprite('protein_mold_cake');
  assert.ok(countPixels(moldCake, (r, g, b, a) => a > 145 && r > 115 && g > 80 && b < 125) > 180, 'protein_mold_cake should keep a dirty ochre ration wrapper');
  assert.ok(countPixels(moldCake, (r, g, b, a) => a > 135 && g > r + 24 && g > b + 18) > 70, 'protein_mold_cake should show green mold food');
  assert.ok(countPixels(moldCake, (r, g, b, a) => a > 120 && r > 130 && g < 95 && b < 90) > 25, 'protein_mold_cake should include a red risk label');
  assert.notEqual(spriteHash(moldCake), spriteHash(generateItemSprite('green_briquette')), 'protein_mold_cake should differ from green briquette rations');

  const beam = generateItemSprite('psi_beam');
  const brainburn = generateItemSprite('psi_brainburn');
  const splinter = generateItemSprite('psi_concrete_splinter');
  const control = generateItemSprite('psi_control');
  const madness = generateItemSprite('psi_madness');
  const psiWeaponHashes = new Set([beam, brainburn, splinter, control, madness].map(spriteHash));
  assert.equal(psiWeaponHashes.size, 5, 'bundle 031 psi weapons should have distinct clot silhouettes');
  assert.ok(countPixels(beam, (r, g, b, a) => a > 140 && b > 145 && g > 145 && r < 130) > 45, 'psi_beam should show a cyan beam core');
  assert.ok(countPixels(brainburn, (r, g, b, a) => a > 140 && r > 165 && g < 105 && b < 140) > 45, 'psi_brainburn should show a red brain-burn core');
  assert.ok(countPixels(splinter, (r, g, b, a) => a > 150 && Math.abs(r - g) < 36 && Math.abs(g - b) < 46 && r > 90 && r < 215) > 120, 'psi_concrete_splinter should show concrete shard mass');
  assert.ok(countPixels(control, (r, g, b, a) => a > 130 && g > 160 && r < 140 && b < 190) > 40, 'psi_control should show green control glow');
  assert.ok(countPixels(madness, (r, g, b, a) => a > 100 && r > 130 && b > 130 && g < 135) > 60, 'psi_madness should show violet-red chaotic glow');
  assert.notEqual(spriteHash(beam), spriteHash(generateItemSprite('psi_strike')), 'psi_beam should differ from baseline psi strike');

  const dust = generateItemSprite('psi_dust');
  assert.ok(countPixels(dust, (r, g, b, a) => a > 70 && b > 140 && g > 80 && r < 190) > 170, 'psi_dust should show purple-blue inner glow');
  assert.ok(countPixels(dust, (r, g, b, a) => a > 120 && Math.abs(r - g) < 34 && Math.abs(g - b) < 42 && r > 75 && r < 210) > 170, 'psi_dust should keep a concrete/enamel container read');
  assert.ok(countPixelsIn(dust, 27, 31, 38, 41, (r, g, b, a) => a > 150 && r > 135 && g > 120 && b > 100) > 25, 'psi_dust should include a small eye/enamel motif');
  assert.notEqual(spriteHash(dust), spriteHash(generateItemSprite('bottled_voice')), 'psi_dust should differ from bottled psi artifacts');
});

test('sprite bundle 048 items read as distinct void, water, and paperwork icons', () => {
  const expected: readonly [string, string, ItemType][] = [
    ['void_archive_warrant', 'Пустотный архивный ордер', ItemType.MISC],
    ['void_spike', 'Пустотный шип', ItemType.MISC],
    ['voluntary_receipt', 'Расписка о добровольном участии', ItemType.MISC],
    ['water', 'Вода', ItemType.DRINK],
    ['water_coupon', 'Талон на воду', ItemType.MISC],
    ['water_filter_regulator', 'Регулятор фильтра воды', ItemType.MISC],
    ['water_reservoir_quota', 'Квота резервуара воды', ItemType.MISC],
    ['water_reservoir_sample', 'Проба воды из резервуара', ItemType.MISC],
  ];
  const hashes = new Set<number>();

  for (const [id, name, type] of expected) {
    const def = ITEMS[id];
    assert.ok(def, `${id} should stay registered`);
    assert.equal(def.name, name);
    assert.equal(def.type, type);
    const sprite = generateItemSprite(id);
    assert.equal(sprite[0] >>> 24, 0, `${id} sprite should keep transparent corners`);
    assert.ok(opaquePixels(sprite) > 320, `${id} should have enough visible mass for world drops and inventory icons`);
    hashes.add(spriteHash(sprite));
  }
  assert.equal(hashes.size, expected.length, 'bundle 048 sprites should not share exact sprite hashes');

  const drop: Entity = {
    id: 48,
    type: EntityType.ITEM_DROP,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [
      { defId: 'void_archive_warrant', count: 0 },
      { defId: 'water_reservoir_sample', count: 1 },
    ],
  };
  assert.equal(itemDropDefId(drop), 'water_reservoir_sample', 'bundle 048 world drops should resolve visuals from positive item payload');

  const warrant = generateItemSprite('void_archive_warrant');
  assert.ok(countPixels(warrant, (r, g, b, a) => a > 150 && r > 135 && g > 115 && b > 70 && b < 180) > 430, 'void_archive_warrant should read as yellowed archive paper');
  assert.ok(countPixels(warrant, (r, g, b, a) => a > 130 && r > 125 && g < 85 && b < 90) > 70, 'void_archive_warrant should include a red warrant stamp');
  assert.ok(countPixels(warrant, (r, g, b, a) => a > 70 && b > 125 && r < 140) > 18, 'void_archive_warrant should carry a small blue-violet void cue');

  const spike = generateItemSprite('void_spike');
  assert.ok(countPixels(spike, (r, g, b, a) => a > 140 && r < 45 && g < 65 && b < 95) > 120, 'void_spike should keep a black shard silhouette');
  assert.ok(countPixels(spike, (r, g, b, a) => a > 80 && b > 135 && r < 180) > 140, 'void_spike should show purple-blue anomaly light');
  assert.notEqual(spriteHash(spike), spriteHash(generateItemSprite('psi_void_needle')), 'void_spike should not reuse psi_void_needle weapon language');

  const receipt = generateItemSprite('voluntary_receipt');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 150 && r > 145 && g > 115 && b > 65 && b < 170) > 280, 'voluntary_receipt should read as dirty receipt paper');
  assert.ok(countPixels(receipt, (r, g, b, a) => a > 120 && r > 130 && g < 90 && b < 90) > 95, 'voluntary_receipt should include a dull red consent stamp');
  assert.notEqual(spriteHash(receipt), spriteHash(generateItemSprite('unsigned_order')), 'voluntary_receipt should differ from unsigned order paperwork');

  const water = generateItemSprite('water');
  assert.ok(countPixels(water, (r, g, b, a) => a > 120 && g > 135 && b > 130 && r < 145) > 130, 'water should show cyan water through a bottle');
  assert.ok(countPixels(water, (r, g, b, a) => a > 130 && r > 145 && g > 115 && b > 70 && b < 170) > 65, 'water should keep a worn paper label');
  assert.notEqual(spriteHash(water), spriteHash(generateItemSprite('filtered_water')), 'plain water should differ from filtered water');

  const coupon = generateItemSprite('water_coupon');
  assert.ok(countPixels(coupon, (r, g, b, a) => a > 150 && r > 150 && g > 120 && b > 70 && b < 180) > 190, 'water_coupon should read as ration ticket paper');
  assert.ok(countPixels(coupon, (r, g, b, a) => a > 110 && g > 120 && b > 120 && r < 120) > 70, 'water_coupon should show a cyan water mark');
  assert.notEqual(spriteHash(coupon), spriteHash(generateItemSprite('concentrate_coupon')), 'water_coupon should differ from concentrate coupons');

  const regulator = generateItemSprite('water_filter_regulator');
  assert.ok(countPixels(regulator, (r, g, b, a) => a > 130 && Math.abs(r - g) < 38 && Math.abs(g - b) < 42 && r > 75 && r < 190) > 230, 'water_filter_regulator should read as metal regulator parts');
  assert.ok(countPixels(regulator, (r, g, b, a) => a > 90 && g > 135 && b > 125 && r < 145) > 85, 'water_filter_regulator should include wet cyan filter residue');
  assert.notEqual(spriteHash(regulator), spriteHash(generateItemSprite('pump_impeller')), 'water_filter_regulator should differ from pump impeller');

  const quota = generateItemSprite('water_reservoir_quota');
  assert.ok(countPixels(quota, (r, g, b, a) => a > 150 && r > 140 && g > 115 && b > 65 && b < 180) > 390, 'water_reservoir_quota should read as official ration paper');
  assert.ok(countPixels(quota, (r, g, b, a) => a > 110 && g > 120 && b > 120 && r < 130) > 65, 'water_reservoir_quota should show a reservoir/water gauge cue');
  assert.notEqual(spriteHash(quota), spriteHash(coupon), 'water reservoir quota should differ from water coupon');

  const sample = generateItemSprite('water_reservoir_sample');
  assert.ok(countPixels(sample, (r, g, b, a) => a > 100 && g > 120 && b > 115 && r < 145) > 180, 'water_reservoir_sample should show cloudy reservoir water');
  assert.ok(countPixels(sample, (r, g, b, a) => a > 90 && r > 95 && r < 170 && g > 40 && g < 115 && b < 90) > 70, 'water_reservoir_sample should include rusty/metal contamination marks');
  assert.notEqual(spriteHash(sample), spriteHash(water), 'water reservoir sample should differ from plain water');
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ITEMS } from '../src/data/items';
import { RUMORS } from '../src/data/rumors';
import { SAMOSBOR_MODIFIERS, SAMOSBOR_VARIANTS } from '../src/data/samosbor_variants';
import { combatWeaponHudLines, hudMessageAgeSeconds, hudMessageVisible } from '../src/render/hud';
import { fitText, fitTextStable, formatUiNumber, setUiTextTime, wrapTextLines } from '../src/render/ui_text';

const ctx = {
  font: '10px monospace',
  measureText(text: string) {
    return { width: text.length * 10 } as TextMetrics;
  },
} as CanvasRenderingContext2D;

test('overwide fitted text scrolls instead of gaining ellipsis', () => {
  const text = 'ABCDEFGHIJ';
  setUiTextTime(0);
  const first = fitText(ctx, text, 30);
  setUiTextTime(1.1);
  const moved = fitText(ctx, text, 30);

  assert.equal(first, 'ABC');
  assert.notEqual(moved, first);
  assert.equal(moved.includes('...'), false);
});

test('stable fitted text does not drift with UI time', () => {
  const text = 'ABCDEFGHIJ';
  setUiTextTime(0);
  const first = fitTextStable(ctx, text, 50);
  setUiTextTime(3);
  const later = fitTextStable(ctx, text, 50);

  assert.equal(first, 'AB...');
  assert.equal(later, first);
});

test('stable wrapping keeps utility menu lines clipped predictably', () => {
  const lines = wrapTextLines(ctx, 'alpha beta gamma delta', 50, 4, { stable: true });

  assert.deepEqual(lines, ['alpha', 'beta', 'gamma', 'delta']);
  for (const line of lines) assert.ok(ctx.measureText(line).width <= 50);
});

test('wrapped text does not append ellipsis when line budget is exhausted', () => {
  setUiTextTime(0);
  const lines = wrapTextLines(ctx, 'alpha beta gamma delta', 50, 1);

  assert.deepEqual(lines, ['alpha']);
});

test('transient HUD message age follows game time instead of UI animation time', () => {
  const messageTime = 60;
  const gameTimeAfterPausedMenu = 60;
  const uiAnimationTimeAfterPausedMenu = 95;

  assert.equal(hudMessageVisible(messageTime, gameTimeAfterPausedMenu), true);
  assert.equal(hudMessageAgeSeconds(messageTime, gameTimeAfterPausedMenu), 0);
  assert.equal(hudMessageVisible(messageTime, uiAnimationTimeAfterPausedMenu), false);
});

test('Veretar UI text stays a white external-area route with explicit choices', () => {
  const variant = SAMOSBOR_VARIANTS.find(v => v.id === 'veretar');
  assert.ok(variant, 'Veretar variant must exist');

  const routeSource = readFileSync(new URL('../src/gen/living/veretar_window_rescue.ts', import.meta.url), 'utf8');
  const veretarRumors = RUMORS.filter(rumor => rumor.id.startsWith('samosbor_veretar_'));
  const playerActionRumors = veretarRumors.filter(rumor => rumor.topic === 'player_action');
  const modifierLines = variant.modifiers.map(id => SAMOSBOR_MODIFIERS[id].warningLine);
  const text = [
    variant.displayName,
    ...variant.warningLines,
    variant.gameplaySignal,
    variant.startLine ?? '',
    ...modifierLines,
    ITEMS.veretar_sand.desc,
    ITEMS.overexposed_photo.desc,
    ...veretarRumors.flatMap(rumor => [...rumor.text, rumor.lead?.action ?? '']),
    routeSource,
  ].join('\n').toLowerCase();

  for (const required of ['белое окно', 'область', 'песок', 'засвеч', 'свидетел', 'занавес', 'герметик', 'обход']) {
    assert.ok(text.includes(required), `Veretar text should contain ${required}`);
  }
  for (const forbidden of ['зелён', 'зелен', 'свят', 'чудо', 'ангел', 'истин']) {
    assert.equal(text.includes(forbidden), false, `Veretar text must not drift into ${forbidden}`);
  }

  assert.ok(playerActionRumors.length >= 5, 'Veretar needs multiple player-action aftermath rumors');
  assert.ok(variant.fogColor.every(channel => channel < 235), 'Veretar fog tint should desaturate without blank white fill');
  assert.ok(routeSource.includes('veretar_window_sample'), 'route exposes sand sample choice');
  assert.ok(routeSource.includes('veretar_window_seal'), 'route exposes close/seal choice');
  assert.ok(routeSource.includes('cover_target'), 'route exposes cover choice');
  assert.ok(routeSource.includes('overexposed_photo'), 'route exposes photo aftermath');
  assert.ok(routeSource.includes('costly_shortcut'), 'route exposes shortcut cost');
});

test('wrapped text splits long Russian words into fitting lines', () => {
  const text = 'электрогидродинамическийпереподключатель';
  const lines = wrapTextLines(ctx, text, 80, 12);

  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), text);
  for (const line of lines) {
    assert.ok(ctx.measureText(line).width <= 80);
    assert.equal(line.includes('...'), false);
  }
});

test('wrapped Russian action phrase keeps every visible line inside bounds', () => {
  const text = '[E] перенести сверхдлинноенаименованиепредмета без потери действия';
  const lines = wrapTextLines(ctx, text, 90, 10);

  assert.ok(lines.length > 2);
  for (const line of lines) {
    assert.ok(ctx.measureText(line).width <= 90);
    assert.equal(line.includes('...'), false);
  }
});

test('UI number formatting keeps player-facing decimals compact', () => {
  assert.equal(formatUiNumber(83.333333333), '83.3');
  assert.equal(formatUiNumber(100), '100');
  assert.equal(formatUiNumber(1.239, 2), '1.24');
  assert.equal(formatUiNumber(1.239, 9), '1.24');
});

test('overwide Russian fitted text scrolls without ellipsis', () => {
  const text = 'Ржавыйэлектромагнитныйпереподключатель';
  setUiTextTime(0);
  const first = fitText(ctx, text, 90);
  setUiTextTime(1.3);
  const moved = fitText(ctx, text, 90);

  assert.ok(ctx.measureText(first).width <= 90);
  assert.ok(ctx.measureText(moved).width <= 90);
  assert.notEqual(moved, first);
  assert.equal(`${first}${moved}`.includes('...'), false);
});

test('combat weapon HUD copy keeps ammo, cooldown and pellet damage compact', () => {
  const shotgunLines = combatWeaponHudLines({
    name: 'ТОЗ-34',
    role: 'стоппер',
    damageLabel: '8x8',
    reachLabel: '',
    controlLabel: '',
    cooldownLabel: 'КД 1.6с',
    cannotFireReason: '',
    resourceKind: 'ammo',
    resourceLabel: 'дробь 12',
  });

  assert.equal(shotgunLines.fact, 'стоппер УРН 8x8');
  assert.equal(shotgunLines.resource, 'БОЕП дробь 12');
  assert.equal(shotgunLines.fact.includes('/8'), false);
  for (const line of Object.values(shotgunLines)) {
    assert.ok(ctx.measureText(line).width <= 160, `combat HUD line too wide: ${line}`);
  }

  const psiLines = combatWeaponHudLines({
    name: 'Сгусток: Разрыв',
    role: 'ПСИ-снаряд',
    damageLabel: '18',
    reachLabel: '',
    controlLabel: '',
    cooldownLabel: 'ГОТОВ',
    cannotFireReason: 'нет ПСИ',
    resourceKind: 'psi',
    resourceLabel: 'ПСИ 1/100 -8',
  });

  assert.equal(psiLines.title, 'Разрыв');
  assert.equal(psiLines.state, 'НЕТ ПСИ');
  assert.equal(psiLines.resource, 'ПСИ 1/100 -8');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityType, type Entity } from '../src/core/types';
import {
  normalizePlayerStatuses,
  applySporeHaze,
  cureSporeHaze,
  applyPaupsinaWeb,
  reducePaupsinaWeb,
  applyZhelemishSkin,
  cureZhelemishSkin,
  ZHELEMISH_SKIN_ID,
  PAUPSINA_WEB_ID,
  SPORE_HAZE_ID,
} from '../src/systems/status';

function playerEntity(): Entity {
  return {
    id: 1,
    type: EntityType.NPC,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    persistentNpcId: 'player',
  };
}

test('normalizePlayerStatuses removes invalid or expired statuses and caps durations', () => {
  const raw = [
    { id: ZHELEMISH_SKIN_ID, source: 'zhelemish_raw', startedAt: 50, expiresAt: 150 },
    { id: PAUPSINA_WEB_ID, source: 'paupsina_web', startedAt: 90, expiresAt: 200 },
    { id: 'invalid_status', source: 'debug', startedAt: 10, expiresAt: 200 },
    { id: SPORE_HAZE_ID, source: 'spore_carpet', startedAt: 20, expiresAt: 50 },
  ];

  const result = normalizePlayerStatuses(raw);
  assert.ok(result !== undefined);
  assert.equal(result.length, 3);

  const zhel = result.find(s => s.id === ZHELEMISH_SKIN_ID);
  assert.ok(zhel);
  assert.equal(zhel.source, 'zhelemish_raw');

  const paup = result.find(s => s.id === PAUPSINA_WEB_ID);
  assert.ok(paup);
  assert.equal(paup.expiresAt, 90 + 4.2); // PAUPSINA_WEB_DURATION_SEC = 4.2

  const spore = result.find(s => s.id === SPORE_HAZE_ID);
  assert.ok(spore);
});

test('applySporeHaze applies status with correct intensity depending on gear', () => {
  const e = playerEntity();

  // No gear
  applySporeHaze(e, 100);
  assert.ok(e.statuses);
  assert.equal(e.statuses.length, 1);
  assert.equal(e.statuses[0].id, SPORE_HAZE_ID);
  assert.equal(e.statuses[0].intensity, 1);
  assert.equal(e.statuses[0].expiresAt, 100 + 4.8); // SPORE_HAZE_DURATION_SEC

  // With gear
  const e2 = playerEntity();
  e2.tool = 'ip4_gasmask'; // Has IP4_GASMASK_ID
  applySporeHaze(e2, 100);
  assert.ok(e2.statuses);
  assert.equal(e2.statuses.length, 1);
  assert.equal(e2.statuses[0].intensity, 0.35);
  assert.equal(e2.statuses[0].expiresAt, 100 + 2.2); // SPORE_HAZE_PROTECTED_DURATION_SEC
});

test('cureSporeHaze removes the status', () => {
  const e = playerEntity();
  applySporeHaze(e, 100);
  const msgs: any[] = [];
  const cured = cureSporeHaze(e, 100, msgs);
  assert.equal(cured, true);
  assert.equal(e.statuses, undefined);
  assert.equal(msgs.length, 1); // Emits a message
});

test('applyPaupsinaWeb applies status', () => {
  const e = playerEntity();
  applyPaupsinaWeb(e, 100);
  assert.ok(e.statuses);
  assert.equal(e.statuses.length, 1);
  assert.equal(e.statuses[0].id, PAUPSINA_WEB_ID);
  assert.equal(e.statuses[0].expiresAt, 100 + 4.2);
});

test('reducePaupsinaWeb reduces duration and can free entity', () => {
  const e = playerEntity();
  applyPaupsinaWeb(e, 100);

  const msgs: any[] = [];
  // Cut reduces by 2.6
  reducePaupsinaWeb(e, 100, msgs, undefined, undefined, 'cut');
  assert.ok(e.statuses);
  assert.equal(e.statuses[0].expiresAt, 100 + 4.2 - 2.6);

  // Another cut frees the entity
  const result = reducePaupsinaWeb(e, 100, msgs, undefined, undefined, 'cut');
  assert.equal(result, true);
  assert.equal(e.statuses, undefined); // Freed
});

test('applyZhelemishSkin applies status and rolls bad reaction', () => {
  const e = playerEntity();

  // Force bad reaction (rng returns 0.1 < 0.22)
  const result = applyZhelemishSkin(e, 100, 'zhelemish_raw', undefined, () => 0.1);
  assert.equal(result.badReaction, true);
  assert.ok(e.statuses);
  assert.equal(e.statuses[0].id, ZHELEMISH_SKIN_ID);
  assert.equal(e.statuses[0].badReaction, true);
  assert.equal(e.statuses[0].expiresAt, 100 + 180); // RAW_DURATION = 180
});

test('cureZhelemishSkin removes the status', () => {
  const e = playerEntity();
  applyZhelemishSkin(e, 100, 'zhelemish_raw');
  const msgs: any[] = [];
  const cured = cureZhelemishSkin(e, 100, msgs);
  assert.equal(cured, true);
  assert.equal(e.statuses, undefined);
});

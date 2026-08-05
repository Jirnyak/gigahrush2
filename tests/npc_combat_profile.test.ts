import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction, Occupation } from '../src/core/types';
import { npcCombatProfile } from '../src/systems/combat_stimulus';
import { WEAPON_STATS } from '../src/data/catalog';
import { makeTestEntity } from './helpers';

test('npcCombatProfile: brave logic', async (t) => {
  await t.test('brave when psiMadness > 0', () => {
    const npc = makeTestEntity({ id: 1, type: EntityType.NPC, psiMadness: 10, faction: Faction.CITIZEN, occupation: Occupation.HOUSEWIFE });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.brave, true);
  });

  await t.test('brave when occupation has combat/patrol tag (HUNTER)', () => {
    const npc = makeTestEntity({ id: 2, type: EntityType.NPC, faction: Faction.CITIZEN, occupation: Occupation.HUNTER });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.brave, true);
  });

  await t.test('brave when faction is LIQUIDATOR, CULTIST, or WILD', () => {
    const liq = makeTestEntity({ id: 3, type: EntityType.NPC, faction: Faction.LIQUIDATOR, occupation: Occupation.HOUSEWIFE });
    assert.equal(npcCombatProfile(liq).brave, true);

    const cult = makeTestEntity({ id: 4, type: EntityType.NPC, faction: Faction.CULTIST, occupation: Occupation.HOUSEWIFE });
    assert.equal(npcCombatProfile(cult).brave, true);

    const wild = makeTestEntity({ id: 5, type: EntityType.NPC, faction: Faction.WILD, occupation: Occupation.HOUSEWIFE });
    assert.equal(npcCombatProfile(wild).brave, true);
  });

  await t.test('not brave when none of the conditions are met', () => {
    const npc = makeTestEntity({ id: 6, type: EntityType.NPC, faction: Faction.CITIZEN, occupation: Occupation.HOUSEWIFE });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.brave, false);
  });
});

test('npcCombatProfile: weapon logic (armed & ranged)', async (t) => {
  await t.test('unarmed (default bare hands)', () => {
    const npc = makeTestEntity({ id: 7, type: EntityType.NPC, weapon: '' });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.armed, false);
    assert.equal(profile.ranged, false);
  });

  await t.test('armed with basic melee (>3 dmg)', () => {
    const npc = makeTestEntity({ id: 8, type: EntityType.NPC, weapon: 'knife' });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.armed, true);
    assert.equal(profile.ranged, false);
  });

  await t.test('armed with ranged weapon', () => {
    const npc = makeTestEntity({ id: 9, type: EntityType.NPC, weapon: 'gauss' });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.armed, true);
    assert.equal(profile.ranged, true);
  });
});

test('npcCombatProfile: HP logic (hpRatio)', async (t) => {
  await t.test('hpRatio correctly calculated', () => {
    const npc = makeTestEntity({ id: 10, type: EntityType.NPC, hp: 10, maxHp: 50 });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.hpRatio, 10 / 50);
  });

  await t.test('fallback logic (20/20)', () => {
    const npc = makeTestEntity({ id: 11, type: EntityType.NPC });
    delete npc.hp;
    delete npc.maxHp;
    const profile = npcCombatProfile(npc);
    assert.equal(profile.hpRatio, 1);
  });

  await t.test('hp is bounded', () => {
    const npc = makeTestEntity({ id: 12, type: EntityType.NPC, hp: -5, maxHp: 50 });
    const profile = npcCombatProfile(npc);
    assert.equal(profile.hpRatio, 0); // Math.max(0, -5) / maxHp
  });
});

test('npcCombatProfile: threatScore logic', async (t) => {
  await t.test('threatScore calculations match expected values', () => {
    // threatScore = hp * 0.22 + weaponScore + levelScore
    // levelScore = Math.max(1, level) * 3
    // weaponScore for ranged = ws.dmg * ws.pellets * 1.6
    // weaponScore for melee = ws.dmg

    const knifeNpc = makeTestEntity({
      id: 13,
      type: EntityType.NPC,
      hp: 20,
      maxHp: 20,
      weapon: 'knife',
      rpg: { level: 2, xp: 0, attrPoints: 0, str: 1, agi: 1, int: 1, psi: 0, maxPsi: 0 }
    });
    // hp: 20 * 0.22 = 4.4
    // weapon: 'knife' dmg is 7 -> weaponScore = 7
    // levelScore: 2 * 3 = 6
    // total: 4.4 + 7 + 6 = 17.4
    const knifeProfile = npcCombatProfile(knifeNpc);
    assert.equal(knifeProfile.threatScore, 20 * 0.22 + 7 + 6);

    const gaussNpc = makeTestEntity({
      id: 14,
      type: EntityType.NPC,
      hp: 10,
      maxHp: 20,
      weapon: 'gauss',
      rpg: { level: 5, xp: 0, attrPoints: 0, str: 1, agi: 1, int: 1, psi: 0, maxPsi: 0 }
    });
    // 'gauss' stats: dmg 180, pellets 1, isRanged true
    // hp: 10 * 0.22 = 2.2
    // weaponScore: 180 * 1 * 1.6 = 288
    // levelScore: 5 * 3 = 15
    // total: 2.2 + 288 + 15 = 305.2
    const gaussProfile = npcCombatProfile(gaussNpc);
    assert.equal(gaussProfile.threatScore, 10 * 0.22 + (180 * 1 * 1.6) + 15);
  });
});

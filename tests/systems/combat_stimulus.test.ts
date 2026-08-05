import test from 'node:test';
import assert from 'node:assert';
import { npcCombatProfile } from '../../src/systems/combat_stimulus';
import { EntityType, Faction, Occupation } from '../../src/core/types';
import { Entity } from '../../src/core/types';
import { WEAPON_STATS } from '../../src/data/catalog';

test('combat_stimulus: npcCombatProfile', async (t) => {
  await t.test('calculates correct profile for cowardly unarmed NPC', () => {
    const npc = {
      id: 1,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      weapon: '',
      hp: 10,
      maxHp: 20,
      rpg: { level: 1 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.brave, false);
    assert.strictEqual(profile.armed, false);
    assert.strictEqual(profile.ranged, false);
    assert.strictEqual(profile.hpRatio, 0.5);
    assert.ok(profile.threatScore > 5);
  });

  await t.test('calculates brave profile based on faction', () => {
    const npc = {
      id: 2,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      faction: Faction.LIQUIDATOR,
      weapon: '',
      hp: 20,
      maxHp: 20,
      rpg: { level: 1 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.brave, true);
  });

  await t.test('calculates brave profile based on occupation tag', () => {
    const npc = {
      id: 3,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      occupation: Occupation.HUNTER, // This has 'combat' tag
      weapon: '',
      hp: 20,
      maxHp: 20,
      rpg: { level: 1 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.brave, true);
  });

  await t.test('calculates brave profile based on psiMadness', () => {
    const npc = {
      id: 4,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      psiMadness: 10,
      weapon: '',
      hp: 20,
      maxHp: 20,
      rpg: { level: 1 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.brave, true);
  });

  await t.test('calculates profile for ranged weapon', () => {
    const rangedWeaponId = Object.keys(WEAPON_STATS).find(key => WEAPON_STATS[key].isRanged) || 'pistol';

    const npc = {
      id: 5,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      weapon: rangedWeaponId,
      hp: 20,
      maxHp: 20,
      rpg: { level: 2 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.armed, true);
    assert.strictEqual(profile.ranged, true);

    const ws = WEAPON_STATS[rangedWeaponId];
    const expectedWeaponScore = ws.dmg * (ws.pellets ?? 1) * 1.6;
    const expectedScore = 20 * 0.22 + expectedWeaponScore + Math.max(1, 2) * 3;
    assert.strictEqual(profile.threatScore, expectedScore);
  });

  await t.test('calculates profile for high damage melee weapon', () => {
    // Find melee weapon with dmg > 3 to be 'armed'
    const meleeWeaponId = Object.keys(WEAPON_STATS).find(key => !WEAPON_STATS[key].isRanged && WEAPON_STATS[key].dmg > 3) || 'fire_axe';

    const npc = {
      id: 6,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      weapon: meleeWeaponId,
      hp: 20,
      maxHp: 20,
      rpg: { level: 1 }
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.armed, true);
    assert.strictEqual(profile.ranged, false);

    const ws = WEAPON_STATS[meleeWeaponId];
    const expectedScore = 20 * 0.22 + ws.dmg + Math.max(1, 1) * 3;
    assert.strictEqual(profile.threatScore, expectedScore);
  });

  await t.test('handles missing hp and maxHp edge cases', () => {
    const npc = {
      id: 7,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      weapon: '',
      // No hp, maxHp, rpg
    } as Entity;

    const profile = npcCombatProfile(npc);

    // Fallback: hp defaults to 20, maxHp defaults to 20
    assert.strictEqual(profile.hpRatio, 1);

    const defaultScore = 20 * 0.22 + WEAPON_STATS[''].dmg + 1 * 3; // 20*0.22 = 4.4, WEAPON_STATS[''].dmg is usually 1, + 3 = 8.4
    assert.strictEqual(profile.threatScore, defaultScore);
  });

  await t.test('handles hp = 0 edge case', () => {
    const npc = {
      id: 8,
      type: EntityType.NPC,
      alive: true,
      x: 0,
      y: 0,
      weapon: '',
      hp: 0,
      maxHp: 20,
    } as Entity;

    const profile = npcCombatProfile(npc);

    assert.strictEqual(profile.hpRatio, 0);
  });
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Occupation, RoomType } from '../src/core/types';
import {
  OCCUPATION_PROFILES,
  allOccupationProfiles,
  occupationHasAnyProfileTag,
  occupationHasProfileTag,
  occupationIdsWithCraftTag,
  occupationTradeItems,
  occupationHasTradeTag,
  occupationWorkRoomTypeWeight,
  occupationWorkRoomTypes,
  sanitizeOccupation,
} from '../src/data/occupation_profiles';
import {
  designFloorProfile,
  FLOOR_69_GUARD_ROLE_ID,
  FLOOR_69_PERFORMER_ROLE_ID,
  FLOOR_69_WORKER_ROLE_ID,
} from '../src/data/design_floor_profiles';
import { NPC_ROLE_PROFILES, npcRoleProfile, npcRoleProfilesForFloorKey, validateNpcRoleProfiles } from '../src/data/npc_role_profiles';

function occupationValues(): Occupation[] {
  return Object.values(Occupation).filter((value): value is Occupation => typeof value === 'number');
}

test('occupation profiles cover every Occupation enum value exactly once', () => {
  const values = occupationValues().sort((a, b) => a - b);
  const profiles = allOccupationProfiles().sort((a, b) => a.occupation - b.occupation);

  assert.deepEqual(profiles.map(profile => profile.occupation), values);
  for (const occupation of values) {
    const profile = OCCUPATION_PROFILES[occupation];
    assert.equal(profile.occupation, occupation);
    assert.equal(profile.id.length > 0, true);
    assert.equal(profile.label.length > 0, true);
    assert.equal(profile.demosLabel.length > 0, true);
    assert.equal(profile.workLabel.length > 0, true);
    assert.equal(profile.workRoomTypes.length > 0, true);
    assert.equal(profile.interests.length > 0, true);
    assert.equal(profile.tradeItems.length > 0, true);
    assert.equal(profile.demosTraits.work.length > 0, true);
    assert.equal(profile.demosTraits.taste.length > 0, true);
    assert.equal(profile.demosTraits.quest.length > 0, true);
  }
});

test('occupation profiles expose routine, trade and craft facts used by systems', () => {
  assert.deepEqual(occupationWorkRoomTypes(Occupation.COOK), [RoomType.KITCHEN]);
  assert.equal(occupationWorkRoomTypeWeight(Occupation.COOK, RoomType.KITCHEN), 34);
  assert.equal(occupationWorkRoomTypeWeight(Occupation.COOK, RoomType.PRODUCTION), 0);
  assert.equal(OCCUPATION_PROFILES[Occupation.DOCTOR].medicalRecoveryMultiplier, 2);
  assert.equal(OCCUPATION_PROFILES[Occupation.CHILD].sleepScoreBonus, 7);
  assert.equal(occupationTradeItems(Occupation.STOREKEEPER).includes('krona_battery'), true);
  assert.deepEqual(occupationIdsWithCraftTag('mechanic_lesson'), [
    Occupation.LOCKSMITH,
    Occupation.ELECTRICIAN,
    Occupation.TURNER,
    Occupation.MECHANIC,
    Occupation.ENGINEER,
  ]);
});

test('occupation profile tags drive cross-system matching aliases', () => {
  assert.equal(occupationHasProfileTag(Occupation.SECRETARY, 'paper'), true);
  assert.equal(occupationHasProfileTag(Occupation.DOCTOR, 'medicine'), true);
  assert.equal(occupationHasProfileTag(Occupation.HUNTER, 'monster'), true);
  assert.equal(occupationHasProfileTag(Occupation.STOREKEEPER, 'black_market'), true);
  assert.equal(occupationHasAnyProfileTag(Occupation.PERFORMER, ['admin', 'performance']), true);
  assert.equal(occupationHasProfileTag(Occupation.CLEANER, 'cleanup'), true);
  assert.equal(occupationHasProfileTag(Occupation.CHILD, 'combat'), false);
  assert.equal(sanitizeOccupation(Occupation.PERFORMER), Occupation.PERFORMER);
  assert.equal(sanitizeOccupation(999, Occupation.TRAVELER), Occupation.TRAVELER);
});

test('occupationHasTradeTag correctly identifies trade tags for occupations', () => {
  // Check known truthy values
  assert.equal(occupationHasTradeTag(Occupation.LOCKSMITH, 'tools'), true);
  assert.equal(occupationHasTradeTag(Occupation.LOCKSMITH, 'repair'), true);
  assert.equal(occupationHasTradeTag(Occupation.SECRETARY, 'documents'), true);

  // Check known falsy values (tags not on the occupation)
  assert.equal(occupationHasTradeTag(Occupation.LOCKSMITH, 'medical'), false);

  // Check undefined occupation returns false
  assert.equal(occupationHasTradeTag(undefined, 'tools'), false);
});

test('Floor 69 worker role promotes candidate jobs into systemic occupation', () => {
  const role = designFloorProfile('floor_69')?.localRoles?.find(item => item.id === FLOOR_69_WORKER_ROLE_ID);
  const registryRole = npcRoleProfile(FLOOR_69_WORKER_ROLE_ID);

  assert.ok(role);
  assert.equal(role, registryRole);
  assert.deepEqual(validateNpcRoleProfiles(), []);
  assert.deepEqual(role.baseOccupations, [Occupation.WORKER69]);
  assert.equal(role.outputOccupation, Occupation.WORKER69);
  assert.equal(OCCUPATION_PROFILES[Occupation.WORKER69].routineTags?.includes('floor_69'), true);
  assert.equal(role.candidateOccupations?.includes(Occupation.SECRETARY), true);
  assert.equal(role.candidateOccupations?.includes(Occupation.STOREKEEPER), true);
  assert.equal(role.candidateOccupations?.includes(Occupation.CHILD), false);
});

test('floor role profiles do not invent occupations except explicit systemic promotions', () => {
  const occupationProfileIds = new Set(allOccupationProfiles().map(profile => profile.id));
  const occupationEnumKeys = Object.keys(Occupation)
    .filter(key => Number.isNaN(Number(key)))
    .map(key => key.toLowerCase());
  const systemicRoleProfiles = new Set([FLOOR_69_WORKER_ROLE_ID]);

  assert.deepEqual(validateNpcRoleProfiles(), []);
  assert.deepEqual(npcRoleProfilesForFloorKey('design:floor_69').map(profile => profile.id).sort(), [
    FLOOR_69_GUARD_ROLE_ID,
    FLOOR_69_PERFORMER_ROLE_ID,
    FLOOR_69_WORKER_ROLE_ID,
  ].sort());

  for (const role of NPC_ROLE_PROFILES) {
    if (systemicRoleProfiles.has(role.id)) {
      assert.equal(role.outputOccupation, Occupation.WORKER69);
      continue;
    }
    assert.equal(occupationProfileIds.has(role.id), false, `${role.id} must remain a role profile, not an occupation profile`);
    for (const floorKey of role.floorKeys ?? []) {
      const routeToken = floorKey.replace(/^design:/, '').replace(/^story:/, '').replace(/^procedural:/, '');
      assert.equal(
        occupationEnumKeys.some(key => key.includes(routeToken)),
        false,
        `${floorKey} must stay out of Occupation enum names`,
      );
    }
  }
});

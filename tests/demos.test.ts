import test from 'node:test';
import assert from 'node:assert/strict';
import { Faction, FloorLevel, Occupation } from '../src/core/types';
import { createPrefilledAlifeState } from '../src/systems/alife';
import { Spr } from '../src/render/sprite_index';
import {
  applyDemosSearchText,
  demosRelationBand,
  findDemosCursor,
  getDemosSnapshot,
  moveDemosCursor,
} from '../src/systems/demos';
import { floorKeyForStory } from '../src/systems/floor_keys';
import { makeGameState } from './helpers';
import '../src/gen/maintenance/gordon';

function makeDemosState() {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  createPrefilledAlifeState(state, 12345, 3, {
    buckets: [{
      floorKey: floorKeyForStory(FloorLevel.LIVING),
      floor: FloorLevel.LIVING,
      targetCount: 3,
      reserved: [
        {
          name: 'Анна Демосова',
          female: true,
          faction: Faction.CITIZEN,
          occupation: Occupation.SECRETARY,
          level: 4,
          canGiveQuest: true,
        },
        {
          name: 'Сержант Поиск',
          female: false,
          faction: Faction.LIQUIDATOR,
          occupation: Occupation.HUNTER,
          level: 7,
        },
        {
          name: 'Тихий Паломник',
          female: false,
          faction: Faction.CULTIST,
          occupation: Occupation.PILGRIM,
          level: 5,
        },
      ],
    }],
  });
  return state;
}

test('Demos relation thresholds match the design bands', () => {
  assert.equal(demosRelationBand(-80).label, 'ненавидит');
  assert.equal(demosRelationBand(-60).label, 'враг');
  assert.equal(demosRelationBand(-30).label, 'недруг');
  assert.equal(demosRelationBand(-1).label, 'холодное');
  assert.equal(demosRelationBand(0).label, 'нейтрально');
  assert.equal(demosRelationBand(40).label, 'приятель');
  assert.equal(demosRelationBand(60).label, 'друг');
  assert.equal(demosRelationBand(90).label, 'любовь');
});

test('Demos edits search text as a focused canvas field', () => {
  assert.equal(applyDemosSearchText('', 'alife:2'), 'alife:2');
  assert.equal(applyDemosSearchText('Анна', '\b'), 'Анн');
  assert.equal(applyDemosSearchText('Анна', '\x7f'), '');
  assert.equal(applyDemosSearchText('', 'a'.repeat(80)).length, 48);
});

test('Demos finds NPC profiles by name and stable alife id', () => {
  const state = makeDemosState();
  state.demosSearch = 'демос';
  state.demosCursor = findDemosCursor(state, state.demosSearch, 0, 1);
  let snapshot = getDemosSnapshot(state, []);
  assert.equal(snapshot.profile?.name, 'Анна Демосова');
  assert.equal(snapshot.profile?.idLabel, 'alife:1');
  assert.equal(snapshot.profile?.questLabel, 'может дать дело');

  state.demosSearch = 'alife:2';
  state.demosCursor = findDemosCursor(state, state.demosSearch, 0, 1);
  snapshot = getDemosSnapshot(state, []);
  assert.equal(snapshot.profile?.name, 'Сержант Поиск');
  assert.equal(snapshot.profile?.factionLabel, 'Ликвидаторы');
});

test('Demos snapshot does not run full search until the cursor is confirmed', () => {
  const state = makeDemosState();
  state.demosSearch = 'паломник';
  state.demosCursor = 0;

  let snapshot = getDemosSnapshot(state, []);
  assert.equal(snapshot.profile, undefined);
  assert.equal(snapshot.notFound, true);

  state.demosCursor = findDemosCursor(state, state.demosSearch, state.demosCursor, 1);
  snapshot = getDemosSnapshot(state, []);
  assert.equal(snapshot.profile?.name, 'Тихий Паломник');
});

test('Demos resolves authored plot sprite and route floor number for reserved profiles', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: floorKeyForStory(FloorLevel.MAINTENANCE),
      floor: FloorLevel.MAINTENANCE,
      targetCount: 1,
      reserved: [{
        kind: 'plot',
        plotNpcId: 'gordon_freeman',
        name: 'Гордон Фримен',
        female: false,
        faction: Faction.SCIENTIST,
        occupation: Occupation.SCIENTIST,
      }],
    }],
  });

  state.demosSearch = 'plot:gordon';
  state.demosCursor = findDemosCursor(state, state.demosSearch, 0, 1);
  const snapshot = getDemosSnapshot(state, []);
  assert.equal(snapshot.profile?.name, 'Гордон Фримен');
  assert.equal(snapshot.profile?.sprite, Spr.GORDON);
  assert.equal(snapshot.profile?.locationLabel.includes('Этаж -26'), true);
});

test('Demos account line shows bank account rather than total pocket wealth', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: floorKeyForStory(FloorLevel.LIVING),
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        name: 'Богатый Счетов',
        female: false,
        faction: Faction.CITIZEN,
        occupation: Occupation.DIRECTOR,
        money: 10_000,
        accountRubles: 4_990_000,
      }],
    }],
  });

  state.demosSearch = 'счетов';
  state.demosCursor = findDemosCursor(state, state.demosSearch, 0, 1);
  const snapshot = getDemosSnapshot(state, []);

  assert.equal(snapshot.profile?.moneyLabel, '4990000₽');
});

test('Demos pages through profiles without storing a full profile list', () => {
  const state = makeDemosState();
  assert.equal(moveDemosCursor(state, 0, 1, ''), 1);
  assert.equal(moveDemosCursor(state, 0, -1, ''), 2);
  assert.equal(moveDemosCursor(state, 0, 1, 'паломник'), 2);
});

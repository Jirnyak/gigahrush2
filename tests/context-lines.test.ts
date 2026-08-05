import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  Occupation,
  type Entity,
  type WorldEvent,
} from '../src/core/types';

import { RUMORS, type RumorDef, type RumorReveal } from '../src/data/rumors';
import { SCREEN_SIGNAL_DEFS } from '../src/data/screen_signals';
import { buildContextSnapshot } from '../src/systems/context';
import { createWorldEventState } from '../src/systems/events';
import { getRecentRumorLead } from '../src/systems/npc_memory';
import { observeRecentRumorEventsForNpc, recordRumorEvent, selectRumorForNpc } from '../src/systems/rumor';
import { makeGameState } from './helpers';

test('recent event context flags are derived from bounded world event history', () => {
  assert.equal(snapshotFor('samosbor_warning').hasRecentSamosborWarning, true);
  assert.equal(snapshotFor('item_stolen', { actorId: 0, actorFaction: Faction.PLAYER }).hasRecentPlayerTheft, true);
  assert.equal(snapshotFor('room_lacked_resources').hasRecentProductionShortage, true);
  assert.equal(snapshotFor('elevator_anomaly').hasRecentLiftAnomaly, true);
  assert.equal(snapshotFor('faction_patrol_clash').hasRecentFactionClash, true);
  assert.equal(snapshotFor('player_kill_monster', { monsterKind: MonsterKind.TVAR }).hasRecentMonsterKill, true);
});



test('screen signal rumor pools point to gameplay surfaces', () => {
  const rumors = new Map(RUMORS.map(rumor => [rumor.id, rumor]));
  const weak: string[] = [];
  for (const signal of SCREEN_SIGNAL_DEFS) {
    for (const rumorId of signal.rumorIds) {
      const rumor = rumors.get(rumorId);
      if (!rumor || rumorHasGameplaySurface(rumor)) continue;
      weak.push(`${signal.id}:${rumorId}`);
    }
  }
  assert.deepEqual(weak, []);
});

test('runtime event rumors keep floor zone and room context in leads', () => {
  const now = 9_500;
  const npc = { ...makeNpc(), id: 9301 };
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: now });
  const snapshot = buildContextSnapshot(npc, { state, player: makePlayer(), time: now });
  assert.equal(recordRumorEvent({
    id: 9_100_001,
    type: 'room_produced_items',
    time: now - 5,
    floor: FloorLevel.MAINTENANCE,
    zoneId: 12,
    roomId: 44,
    severity: 4,
    privacy: 'public',
    tags: ['production'],
    data: {
      roomName: 'Брикетный цех: линия концентрата',
      resourceName: 'Концентрат',
    },
  }), true);

  assert.equal(observeRecentRumorEventsForNpc(npc, snapshot, now), 1);
  const line = selectRumorForNpc(npc, snapshot, now);
  assert.ok(line);
  assert.match(line, /Коллекторы/);
  assert.match(line, /зона 13/);
  assert.match(line, /Брикетный цех: линия концентрата/);
  assert.match(line, /концентрат/i);

  const lead = getRecentRumorLead(now);
  assert.equal(lead?.floor, FloorLevel.MAINTENANCE);
  assert.equal(lead?.roomName, 'Брикетный цех: линия концентрата');
});

function rumorHasGameplaySurface(rumor: RumorDef): boolean {
  if (rumor.lead) return true;
  return rumorReveals(rumor.reveals).some(revealHasGameplaySurface);
}

function rumorReveals(input: RumorDef['reveals']): readonly RumorReveal[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function revealHasGameplaySurface(reveal: RumorReveal): boolean {
  if (reveal.kind === 'danger' || reveal.kind === 'container') return true;
  if (reveal.kind === 'item' || reveal.kind === 'monster' || reveal.kind === 'floor') return reveal.confidence >= 4;
  if (reveal.kind === 'room') return reveal.confidence >= 4 && (reveal.roomName !== undefined || reveal.roomType !== undefined);
  if (reveal.kind === 'zone') return reveal.confidence >= 4 && (reveal.zoneId !== undefined || reveal.faction !== undefined);
  if (reveal.kind === 'warning') return reveal.confidence >= 4;
  return reveal.kind === 'faction' && reveal.confidence >= 4 && reveal.faction !== undefined;
}

function snapshotFor(type: WorldEvent['type'], overrides: Partial<WorldEvent> = {}) {
  const state = makeGameState({
    time: 120,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const buffer = state.worldEvents?.recentEvents;
  assert.ok(buffer);
  buffer.items[0] = {
    id: 1,
    type,
    time: 120,
    day: 0,
    hour: 8,
    minute: 0,
    floor: FloorLevel.LIVING,
    actorId: undefined,
    actorFaction: undefined,
    monsterKind: undefined,
    severity: 3,
    privacy: 'local',
    truth: 'fact',
    tags: [],
    ...overrides,
  };
  buffer.count = 1;
  return buildContextSnapshot(makeNpc(), { state, player: makePlayer(), time: state.time });
}

function makeNpc(): Entity {
  return {
    id: 9201,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Контекст',
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    needs: { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 },
    hp: 100,
    maxHp: 100,
  };
}

function makePlayer(): Entity {
  return {
    id: 0,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 11,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Игрок',
    faction: Faction.PLAYER,
  };
}

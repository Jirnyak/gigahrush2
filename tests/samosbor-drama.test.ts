import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel } from '../src/core/types';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { publishShelterTallyEvent, SHELTER_TALLY_ID } from '../src/systems/shelter_tally';
import { makeGameState, makeTestContainer, makeTestPlayer } from './helpers';

test('istotit shelter tally aftermath is visible in world log and HUD', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const actor = makeTestPlayer({ id: 1, name: 'Вы', faction: Faction.PLAYER });
  const container = makeTestContainer({
    id: 44,
    zoneId: 2,
    roomId: 17,
    name: 'Ящик у жёлтой гермы',
    faction: Faction.CITIZEN,
  });

  publishShelterTallyEvent(state, actor, SHELTER_TALLY_ID, 'give_residents', { container });

  const events = getRecentEvents(state, { type: 'shelter_tally_handled', tags: ['shelter_tally'], limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].targetName, 'старшие подъезда');
  assert.equal(events[0].containerId, 44);
  assert.equal(events[0].data?.outcome, 'give_residents');
  assert.equal(events[0].tags.includes('istotit'), true);

  const logText = state.msgLog.at(-1)?.text ?? '';
  assert.match(logText, /Ведомость укрытых передана -> старшие подъезда/);
  assert.match(logText, /кого вписали, кого забыли/);
  assert.equal(state.msgs.at(-1)?.text, logText);
});

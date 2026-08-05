import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  EntityType,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { generateMaronarySignalshchik } from '../src/gen/void/maronary_signalshchik';
import { routeCueCount } from '../src/systems/route_cues';

test('Маронарный Сигнальщик exposes a readable dark bypass and reward choice', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateMaronarySignalshchik(world, entities, { v: 1 }, 512, 512);

  const avoid = world.containers.find(container => container.tags.includes('maronary_signalshchik') && container.tags.includes('signal_avoid'));
  const disable = world.containers.find(container => container.tags.includes('maronary_signalshchik') && container.tags.includes('signal_disable'));

  assert.equal(routeCueCount(world), 1);
  assert.ok(avoid);
  assert.ok(disable);
  assert.equal(avoid.inventory.some(item => item.defId === 'overexposed_photo'), true);
  assert.equal(disable.inventory.some(item => item.defId === 'bottled_voice'), true);
  assert.ok(entities.some(entity => entity.type === EntityType.MONSTER && entity.name === 'Маронарный Сигнальщик'));
});

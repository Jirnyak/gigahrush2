import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, Occupation, type Entity } from '../src/core/types';
import { NPC_VISUAL_OLGA_DMITRIEVNA } from '../src/data/art_sprite_manifest';
import {
  allRenderAnimationClips,
  highestPriorityRenderAnimationClip,
  renderAnimationClipMatchesEntity,
  renderAnimationFrameCount,
} from '../src/render/animations';

function makeOlga(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    type: EntityType.NPC,
    x: 10,
    y: 12,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: Occupation.DOCTOR,
    npcVisualId: NPC_VISUAL_OLGA_DMITRIEVNA,
    plotNpcId: 'olga',
    occupation: Occupation.DOCTOR,
    faction: Faction.SCIENTIST,
    isFemale: true,
    ...overrides,
  };
}

test('Olga visual id matches walk and harm animation clips', () => {
  const clips = allRenderAnimationClips().filter(clip => clip.id.startsWith('olga_dmitrievna_'));
  const olga = makeOlga();

  assert.deepEqual(clips.map(clip => clip.id).sort(), [
    'olga_dmitrievna_harm',
    'olga_dmitrievna_walk',
  ]);
  for (const clip of clips) {
    assert.equal(renderAnimationClipMatchesEntity(clip, olga), true, `${clip.id} should match Olga visual id`);
  }
});

test('Olga plot NPC id fallback matches only when visual id is absent', () => {
  const clips = allRenderAnimationClips().filter(clip => clip.id.startsWith('olga_dmitrievna_'));
  const fallbackOlga = makeOlga({ npcVisualId: undefined });
  const wrongVisualOlga = makeOlga({ npcVisualId: 'other_manual_visual' });

  for (const clip of clips) {
    assert.equal(renderAnimationClipMatchesEntity(clip, fallbackOlga), true, `${clip.id} should match fallback plot id`);
    assert.equal(renderAnimationClipMatchesEntity(clip, wrongVisualOlga), false, `${clip.id} should reject wrong visual id`);
  }
});

test('Olga harm clip priority beats walk clip', () => {
  const matching = allRenderAnimationClips().filter(clip => renderAnimationClipMatchesEntity(clip, makeOlga()));
  const best = highestPriorityRenderAnimationClip(matching);

  assert.equal(best?.id, 'olga_dmitrievna_harm');
  assert.equal(best?.priority, 100);
});

test('Olga walk and harm clip frame facts match the frame pack contract', () => {
  const byId = new Map(allRenderAnimationClips().map(clip => [clip.id, clip]));
  const walk = byId.get('olga_dmitrievna_walk');
  const harm = byId.get('olga_dmitrievna_harm');

  assert.ok(walk);
  assert.ok(harm);
  assert.equal(renderAnimationFrameCount(walk), 6);
  assert.equal(renderAnimationFrameCount(harm), 3);
  assert.equal(walk.source.width, 64);
  assert.equal(walk.source.height, 64);
  assert.equal(harm.source.width, 64);
  assert.equal(harm.source.height, 64);
  assert.equal(walk.source.fallback, 'static');
  assert.equal(harm.source.fallback, 'static');
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { World } from '../../src/core/world';
import { FloorLevel } from '../../src/core/types';
import { invalidateMapEditorThumbnail, markMapEditorThumbnailDirty } from '../../src/render/map_editor_ui';

test('Map Editor Thumbnail Cache Management', async (t) => {
  await t.test('markMapEditorThumbnailDirty gracefully handles edge cases', () => {
    const world = new World(1, FloorLevel.L1);

    // empty list
    assert.doesNotThrow(() => markMapEditorThumbnailDirty(world, []));

    // single numeric index
    assert.doesNotThrow(() => markMapEditorThumbnailDirty(world, [42]));

    // single object with idx
    assert.doesNotThrow(() => markMapEditorThumbnailDirty(world, [{ x: 10, y: 10, idx: 100 }]));

    // single object without idx
    assert.doesNotThrow(() => markMapEditorThumbnailDirty(world, [{ x: 10, y: 10 }]));

    // mixed
    assert.doesNotThrow(() => markMapEditorThumbnailDirty(world, [42, { x: 5, y: 5 }, { x: 0, y: 0, idx: 0 }]));
  });

  await t.test('invalidateMapEditorThumbnail gracefully handles missing cache', () => {
    assert.doesNotThrow(() => invalidateMapEditorThumbnail());

    const world = new World(1, FloorLevel.L1);
    assert.doesNotThrow(() => invalidateMapEditorThumbnail(world));
  });
});

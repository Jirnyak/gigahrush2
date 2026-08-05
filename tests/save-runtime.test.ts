import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SAVE_SHAPE_VERSION,
  saveShapeVersionStatus,
  saveShapeVersionSupported,
} from '../src/systems/save_runtime';

test('save runtime accepts only the current shape version', () => {
  assert.equal(saveShapeVersionStatus({ version: SAVE_SHAPE_VERSION }), 'current');
  assert.equal(saveShapeVersionSupported({ version: SAVE_SHAPE_VERSION }), true);

  assert.equal(saveShapeVersionStatus({ version: 1 }), 'old');
  assert.equal(saveShapeVersionStatus({ version: 20 }), 'old');
  assert.equal(saveShapeVersionStatus({ version: SAVE_SHAPE_VERSION - 1 }), 'old');
  assert.equal(saveShapeVersionSupported({ version: SAVE_SHAPE_VERSION - 1 }), false);
  assert.equal(saveShapeVersionStatus({ version: undefined }), 'missing');
  assert.equal(saveShapeVersionStatus({}), 'missing');
  assert.equal(saveShapeVersionSupported({}), false);
  assert.equal(saveShapeVersionStatus({ version: SAVE_SHAPE_VERSION + 1 }), 'newer');
  assert.equal(saveShapeVersionSupported({ version: SAVE_SHAPE_VERSION + 1 }), false);
  assert.equal(saveShapeVersionStatus({ version: `${SAVE_SHAPE_VERSION}` }), 'invalid');
  assert.equal(saveShapeVersionSupported(null), false);
});

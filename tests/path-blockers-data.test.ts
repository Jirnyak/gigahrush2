import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ContainerKind, Feature } from '../src/core/types';
import {
  CONTAINER_PATH_BLOCKER_IDS,
  FEATURE_PATH_BLOCKER_IDS,
  PATH_BLOCKER_DEF_BY_ID,
  PATH_BLOCKER_DEFS,
  pathBlockerIdForContainerKind,
  pathBlockerIdForFeature,
} from '../src/data/path_blockers';

const ID_RE = /^[a-z][a-z0-9_]*$/;

test('path blocker defs use stable unique snake_case ids', () => {
  const ids = new Set<string>();
  for (const def of PATH_BLOCKER_DEFS) {
    assert.match(def.id, ID_RE);
    assert.equal(ids.has(def.id), false, `duplicate path blocker def ${def.id}`);
    assert.equal(PATH_BLOCKER_DEF_BY_ID.get(def.id), def);
    assert.equal(def.shapes.length > 0, true, `${def.id} must define at least one shape`);
    ids.add(def.id);
  }
});

test('feature blocker mapping resolves to existing definitions', () => {
  const required = [
    Feature.TABLE,
    Feature.DESK,
    Feature.BED,
    Feature.SHELF,
    Feature.MACHINE,
    Feature.APPARATUS,
    Feature.SINK,
    Feature.TOILET,
    Feature.STOVE,
  ];
  for (const feature of required) {
    const id = pathBlockerIdForFeature(feature);
    assert.equal(typeof id, 'string', `feature ${feature} must map to a blocker id`);
    assert.ok(id && PATH_BLOCKER_DEF_BY_ID.has(id), `feature ${feature} maps to missing ${id}`);
  }
  for (const [, id] of FEATURE_PATH_BLOCKER_IDS) {
    assert.equal(PATH_BLOCKER_DEF_BY_ID.has(id), true, `feature mapping references missing ${id}`);
  }
  assert.equal(pathBlockerIdForFeature(Feature.CHAIR), undefined, 'chairs stay non-blocking in first pass');
});

test('container blocker mapping keeps tiny containers non-blocking', () => {
  for (const [, id] of CONTAINER_PATH_BLOCKER_IDS) {
    assert.equal(PATH_BLOCKER_DEF_BY_ID.has(id), true, `container mapping references missing ${id}`);
  }
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.WOODEN_CHEST), 'crate_blocker');
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.WEAPON_CRATE), 'crate_blocker');
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.METAL_CABINET), 'cabinet_blocker');
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.TOOL_LOCKER), 'cabinet_blocker');
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.CASHBOX), undefined);
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.SECRET_STASH), undefined);
  assert.equal(pathBlockerIdForContainerKind(ContainerKind.EMERGENCY_BOX), undefined);
});

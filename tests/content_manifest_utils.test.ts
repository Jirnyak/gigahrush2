import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world';
import {
  getPoiGenerationMetadata,
  recordPoiGenerationMetadata,
  clearPoiGenerationMetadata
} from '../src/gen/content_manifest_utils';

test('getPoiGenerationMetadata returns empty array initially', () => {
  const mockWorld = {} as unknown as World;
  const result = getPoiGenerationMetadata(mockWorld);
  assert.deepEqual(result, []);
});

test('getPoiGenerationMetadata returns recorded metadata', () => {
  const mockWorld = {} as unknown as World;

  recordPoiGenerationMetadata(mockWorld, { id: 'test-poi-1' });
  recordPoiGenerationMetadata(mockWorld, { id: 'test-poi-2', floor: '12' });

  const result = getPoiGenerationMetadata(mockWorld);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'test-poi-1');
  assert.equal(result[1].id, 'test-poi-2');
  assert.equal(result[1].floor, '12');
});

test('getPoiGenerationMetadata works with cleared metadata', () => {
  const mockWorld = {} as unknown as World;

  recordPoiGenerationMetadata(mockWorld, { id: 'test-poi-1' });
  clearPoiGenerationMetadata(mockWorld);

  const result = getPoiGenerationMetadata(mockWorld);
  assert.deepEqual(result, []);
});

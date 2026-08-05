import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createZip, crc32 } from '../src/export/zip.js';

test('crc32 uses standard ZIP checksum', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('createZip writes local and central directory entries', async () => {
  const bytes = await createZip([
    { path: 'ivan_slesar/npc.json', data: '{"id":"ivan_slesar"}\n' },
    { path: 'ivan_slesar/sprite.rle.json', data: '{"format":"gigahrush_sprite_rle_v1"}\n' },
  ]);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('ivan_slesar/npc.json'));
  assert.ok(text.includes('ivan_slesar/sprite.rle.json'));
  assert.ok(text.includes('PK\u0005\u0006'));
});

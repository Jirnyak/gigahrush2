import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWebGL } from '../src/render/webgl.js';

test('initWebGL throws error when WebGL2 context creation fails', () => {
  const mockCanvas = {
    getContext: () => null
  } as unknown as HTMLCanvasElement;

  assert.throws(
    () => initWebGL(mockCanvas, [], [], {} as any),
    { message: 'WebGL2 not supported' }
  );
});

test('initWebGL handles WebGL context creation throwing error', () => {
  const mockCanvas = {
    getContext: () => { throw new Error('Simulated context error'); }
  } as unknown as HTMLCanvasElement;

  const originalConsoleError = console.error;
  let errorLogged = false;
  console.error = (msg, e) => {
    if (msg === 'WebGL context creation failed' && e.message === 'Simulated context error') {
      errorLogged = true;
    }
  };

  try {
    assert.throws(
      () => initWebGL(mockCanvas, [], [], {} as any),
      { message: 'WebGL2 not supported' }
    );
    assert.equal(errorLogged, true, 'Expected console.error to be called with context creation error');
  } finally {
    console.error = originalConsoleError;
  }
});

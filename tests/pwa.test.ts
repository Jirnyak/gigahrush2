import { test, describe, afterEach, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { registerPwaServiceWorker, isStandaloneDisplay } from '../src/pwa.js';

describe('PWA Module', () => {
  let originalNavigator: any;
  let originalWindow: any;
  let originalLocation: any;
  let errorMock: any;

  beforeEach(() => {
    // Save original globals
    originalNavigator = globalThis.navigator;
    originalWindow = globalThis.window;
    originalLocation = globalThis.location;
    errorMock = mock.method(console, 'error');
    // Suppress console.error in tests unless we are specifically testing it.
    errorMock.mock.mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore globals
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, writable: true });
    Object.defineProperty(globalThis, 'window', { value: originalWindow, writable: true });
    Object.defineProperty(globalThis, 'location', { value: originalLocation, writable: true });
    mock.restoreAll();
  });

  describe('registerPwaServiceWorker', () => {
    test('does nothing if serviceWorker is not in navigator', () => {
      let loadListenerAdded = false;
      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: () => { loadListenerAdded = true; },
          isSecureContext: true
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: {}, // no serviceWorker
        writable: true
      });

      registerPwaServiceWorker();
      assert.strictEqual(loadListenerAdded, false);
    });

    test('does not register if not secure context and not localhost', () => {
      let loadListenerAdded = false;
      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: () => { loadListenerAdded = true; },
          isSecureContext: false
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { serviceWorker: {} },
        writable: true
      });

      Object.defineProperty(globalThis, 'location', {
        value: { hostname: 'example.com' },
        writable: true
      });

      registerPwaServiceWorker();
      assert.strictEqual(loadListenerAdded, false);
    });

    test('registers service worker if secure context', async () => {
      let loadListener: Function | undefined;
      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: (event: string, callback: Function) => {
            if (event === 'load') loadListener = callback;
          },
          isSecureContext: true
        },
        writable: true
      });

      const registerMock = mock.fn(async () => {});
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          serviceWorker: {
            register: registerMock
          }
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'location', {
        value: { hostname: 'example.com' },
        writable: true
      });

      registerPwaServiceWorker();
      assert.ok(loadListener);

      await loadListener();
      assert.strictEqual(registerMock.mock.calls.length, 1);
      assert.strictEqual(registerMock.mock.calls[0].arguments[0], './sw.js');
    });

    test('registers service worker if localhost but not secure context', async () => {
      let loadListener: Function | undefined;
      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: (event: string, callback: Function) => {
            if (event === 'load') loadListener = callback;
          },
          isSecureContext: false
        },
        writable: true
      });

      const registerMock = mock.fn(async () => {});
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          serviceWorker: { register: registerMock }
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'location', {
        value: { hostname: 'localhost' },
        writable: true
      });

      registerPwaServiceWorker();
      assert.ok(loadListener);

      await loadListener();
      assert.strictEqual(registerMock.mock.calls.length, 1);
    });

    test('errors are logged to console.error', async () => {
      let loadListener: Function | undefined;

      Object.defineProperty(globalThis, 'window', {
        value: {
          addEventListener: (event: string, callback: Function) => {
            if (event === 'load') loadListener = callback;
          },
          isSecureContext: true
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          serviceWorker: {
            register: mock.fn(async () => {
              throw new Error('Registration failed');
            })
          }
        },
        writable: true
      });

      Object.defineProperty(globalThis, 'location', {
        value: { hostname: 'example.com' },
        writable: true
      });

      registerPwaServiceWorker();
      assert.ok(loadListener);

      if (loadListener) {
          await loadListener();
      }

      assert.strictEqual(errorMock.mock.calls.length, 1);
      assert.ok(errorMock.mock.calls[0].arguments[0].includes('ServiceWorker registration failed'));
    });
  });

  describe('isStandaloneDisplay', () => {
    test('returns true for fullscreen', () => {
      Object.defineProperty(globalThis, 'window', {
        value: {
          matchMedia: (query: string) => ({ matches: query === '(display-mode: fullscreen)' })
        },
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), true);
    });

    test('returns true for standalone', () => {
      Object.defineProperty(globalThis, 'window', {
        value: {
          matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' })
        },
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), true);
    });

    test('returns true for minimal-ui', () => {
      Object.defineProperty(globalThis, 'window', {
        value: {
          matchMedia: (query: string) => ({ matches: query === '(display-mode: minimal-ui)' })
        },
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), true);
    });

    test('returns true for navigator.standalone', () => {
      Object.defineProperty(globalThis, 'window', {
        value: { matchMedia: () => ({ matches: false }) },
        writable: true
      });
      Object.defineProperty(globalThis, 'navigator', {
        value: { standalone: true },
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), true);
    });

    test('returns false if none match', () => {
      Object.defineProperty(globalThis, 'window', {
        value: { matchMedia: () => ({ matches: false }) },
        writable: true
      });
      Object.defineProperty(globalThis, 'navigator', {
        value: { standalone: false },
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), false);
    });

    test('returns false if window.matchMedia is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: {}, // no matchMedia
        writable: true
      });
      Object.defineProperty(globalThis, 'navigator', {
        value: {}, // no standalone
        writable: true
      });
      assert.strictEqual(isStandaloneDisplay(), false);
    });
  });
});

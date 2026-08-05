import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUseTouchControls } from '../src/mobile';

interface MobileEnvOptions {
  userAgent: string;
  maxTouchPoints?: number;
  hasOntouchstart?: boolean;
  innerWidth?: number;
  innerHeight?: number;
}

function installMobileEnv(options: MobileEnvOptions): () => void {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const hadOntouchstart = 'ontouchstart' in globalThis;
  const previousOntouchstart = Object.getOwnPropertyDescriptor(globalThis, 'ontouchstart');

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: options.userAgent,
      maxTouchPoints: options.maxTouchPoints ?? 0,
    },
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: options.innerWidth ?? 1920,
      innerHeight: options.innerHeight ?? 1080,
    },
  });

  if (options.hasOntouchstart) {
    Object.defineProperty(globalThis, 'ontouchstart', {
      configurable: true,
      value: null,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'ontouchstart');
  }

  return () => {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');

    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');

    if (hadOntouchstart && previousOntouchstart) {
      Object.defineProperty(globalThis, 'ontouchstart', previousOntouchstart);
    } else {
      Reflect.deleteProperty(globalThis, 'ontouchstart');
    }
  };
}

test('shouldUseTouchControls: Mobile user agent always returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
    maxTouchPoints: 0,
    hasOntouchstart: false,
    innerWidth: 1920,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Android user agent returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G981B)',
    maxTouchPoints: 0,
    hasOntouchstart: false,
    innerWidth: 1920,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: iPad user agent (case-insensitive) returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (IPAD; CPU OS 13_3 like Mac OS X)',
    maxTouchPoints: 0,
    hasOntouchstart: false,
    innerWidth: 1920,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Generic mobile user agent returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Mobile; rv:78.0)',
    maxTouchPoints: 0,
    hasOntouchstart: false,
    innerWidth: 1920,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Desktop with touch and compact viewport returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 800,
    innerHeight: 600,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Desktop with touch and compact width but large height returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 800,
    innerHeight: 1200,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Desktop with touch and large width but compact height returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 1200,
    innerHeight: 800,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Desktop with touch but large viewport returns false', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 1920,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), false);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Touch capable and exact 900px boundary viewport returns false', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 900,
    innerHeight: 1080,
  });
  try {
    assert.equal(shouldUseTouchControls(), false);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Touch capable and exact 900px boundary on height returns false', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 10,
    hasOntouchstart: false,
    innerWidth: 1080,
    innerHeight: 900,
  });
  try {
    assert.equal(shouldUseTouchControls(), false);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Desktop without touch but compact viewport returns false', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 0,
    hasOntouchstart: false,
    innerWidth: 800,
    innerHeight: 600,
  });
  try {
    assert.equal(shouldUseTouchControls(), false);
  } finally {
    restore();
  }
});

test('shouldUseTouchControls: Touch capability from ontouchstart with compact viewport returns true', () => {
  const restore = installMobileEnv({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    maxTouchPoints: 0,
    hasOntouchstart: true,
    innerWidth: 800,
    innerHeight: 600,
  });
  try {
    assert.equal(shouldUseTouchControls(), true);
  } finally {
    restore();
  }
});

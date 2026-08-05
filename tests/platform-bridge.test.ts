import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GAMEPUSH_COMPACT_SAVE_THRESHOLD_BYTES,
  GAMEPUSH_RAW_SAVE_LIMIT_BYTES,
  gamePushConfigFromSearch,
  isPortalCloudSaveSizeAllowed,
  isGamePushCloudSaveSizeAllowed,
  hydratePlatformSaveFromCloud,
  loadPlatformRawGameSave,
  normalizePortalTarget,
  portalAllowsCasinoLikeContent,
  portalAllowsOptionalNetwork,
  portalBlocksDesignFloor,
  portalTargetFromSearchOrMeta,
  PORTAL_RAW_SAVE_LIMIT_BYTES,
  requestedPortalFromSearch,
  resetPlatformBridgeForTests,
  savePlatformRawGameSave,
  isPlatformAudioMuted,
  togglePlatformAudioMuted,
  initPlatformBridge,
  markPlatformReady,
  markPlatformGameplayStart,
  markPlatformGameplayStop,
} from '../src/systems/platform_bridge';
import { SAVE_SHAPE_VERSION } from '../src/systems/save_runtime';
import { createPortalCompactSavePayload, summarizeSavePayload, type SavePayload } from '../src/systems/save_payload';
import { FloorLevel, QuestType } from '../src/core/types';
import { designFloorAmbientLight, designFloorProfile, designFloorPseudoliftChance } from '../src/data/design_floor_profiles';

test('platform bridge detects explicit portal query safely', () => {
  assert.equal(requestedPortalFromSearch('?portal=yandex'), 'yandex');
  assert.equal(requestedPortalFromSearch('?x=1&portal=GamePush'), 'gamepush');
  assert.equal(requestedPortalFromSearch('?portal=pikabu-games'), 'pikabu');
  assert.equal(normalizePortalTarget('gp'), 'gamepush');
  assert.equal(requestedPortalFromSearch('not a query'), '');
  assert.equal(portalTargetFromSearchOrMeta('', 'pikabu'), 'pikabu');
  assert.equal(portalTargetFromSearchOrMeta('?portal=gamepush', 'pikabu'), 'gamepush');
  assert.deepEqual(gamePushConfigFromSearch('?gpProjectId=123&gpPublicToken=pub'), {
    projectId: '123',
    publicToken: 'pub',
  });
  assert.equal(gamePushConfigFromSearch('?gpProjectId=123'), null);
});

test('portal compact save keeps a current-shape resume profile without heavy floor memory', () => {
  const payload: SavePayload & { version: number } = {
    version: SAVE_SHAPE_VERSION,
    player: {
      x: 12,
      y: 34,
      angle: 1.5,
      inventory: [{ defId: 'bread', count: 1 }],
      money: 77,
    },
    state: {
      time: 10,
      tick: 20,
      clock: { hour: 8, minute: 30, totalMinutes: 510 },
      samosborActive: true,
      samosborCount: 3,
      samosborTimer: 5,
      quests: Array.from({ length: 90 }, (_, i) => ({
        id: i + 1,
        type: QuestType.FETCH,
        giverId: -1,
        giverName: 'Тест',
        desc: `Квест ${i}`,
        done: false,
        targetItem: 'bread',
        targetCount: 1,
      })),
      nextQuestId: 91,
      currentFloor: FloorLevel.LIVING,
      floorRun: {
        runSeed: 123,
        currentZ: -4,
        specs: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`floor_${i}`, { title: 'x'.repeat(160) }])),
        visited: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`story:${i}`, true])),
      },
      floorInstances: undefined,
      liftArachna: undefined,
      pseudolift: undefined,
      floorMemory: { version: 1, entries: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, packed: 'x'.repeat(8000) })) },
      alife: {
        version: 1,
        seed: 456,
        total: 100000,
        deadIds: Array.from({ length: 5000 }, (_, i) => i + 1),
        deadPlotNpcIds: Array.from({ length: 300 }, (_, i) => `plot_${i}`),
        overrides: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: 'x'.repeat(80), floorKey: `story:${i}` })),
      },
      netTerminalGen: undefined,
      mapEditorPatches: { patches: { huge: { ops: Array.from({ length: 200 }, () => ({ a: 'x'.repeat(100) })) } } },
      worldEvents: { facts: Array.from({ length: 200 }, (_, i) => ({ id: i, text: 'x'.repeat(100) })) },
      economy: undefined,
      banking: { accountRubles: 50, recentLedger: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })) },
      stockMarket: { portfolio: {}, quotes: {}, recentTrades: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })) },
      production: Array.from({ length: 40 }, (_, i) => ({
        floor: FloorLevel.LIVING,
        roomId: i,
        factoryId: 'unknown',
        recipeId: 'unknown',
        progressSec: 0,
        nextTickAt: 0,
        outputContainerId: i,
      })),
      containers: Array.from({ length: 80 }, (_, i) => ({
        id: i + 1,
        x: i,
        y: i,
        floor: FloorLevel.LIVING,
        roomId: 1,
        zoneId: 1,
        kind: 0,
        name: 'Ящик',
        inventory: [{ defId: 'bread', count: 1 }],
        capacitySlots: 1,
        access: 'public',
        discovered: true,
        tags: [],
      })),
    },
  };
  const compact = createPortalCompactSavePayload(payload);
  assert.equal(compact.version, SAVE_SHAPE_VERSION);
  assert.equal(compact.state.samosborActive, false);
  assert.equal(compact.state.quests.length, 64);
  assert.deepEqual(compact.state.floorMemory, { version: 1, entries: [] });
  assert.equal((compact.state.floorRun as { specs?: unknown }).specs, undefined);
  assert.equal((compact.state.alife as { deadIds: unknown[] }).deadIds.length, 1024);
  assert.equal(compact.state.containers.length, 16);
  assert.ok(summarizeSavePayload(compact).bytes < summarizeSavePayload(payload).bytes);
});

test('platform cloud save keeps the raw payload under the strictest portal limit', () => {
  assert.equal(isPortalCloudSaveSizeAllowed(PORTAL_RAW_SAVE_LIMIT_BYTES), true);
  assert.equal(isPortalCloudSaveSizeAllowed(PORTAL_RAW_SAVE_LIMIT_BYTES + 1), false);
  assert.equal(isPortalCloudSaveSizeAllowed(-1), false);
  assert.equal(isGamePushCloudSaveSizeAllowed(GAMEPUSH_RAW_SAVE_LIMIT_BYTES), true);
  assert.equal(isGamePushCloudSaveSizeAllowed(GAMEPUSH_RAW_SAVE_LIMIT_BYTES + 1), false);
});

test('platform cloud save is a no-op without an SDK', async () => {
  resetPlatformBridgeForTests();
  assert.equal(await savePlatformRawGameSave('{}', 2), 'no-sdk');
});

test('GamePush script load without callback resolves without hanging', async () => {
  resetPlatformBridgeForTests();
  const globals = globalThis as typeof globalThis & {
    document?: Document;
    location?: Location;
  };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const scripts: Array<{ onload?: () => void; onerror?: () => void; dataset: Record<string, string>; src?: string; async?: boolean }> = [];

  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=gamepush&gpProjectId=123&gpPublicToken=pub' },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector() { return null; },
      createElement() {
        const script = { dataset: {} };
        scripts.push(script);
        return script;
      },
      head: {
        appendChild(script: { onload?: () => void }) {
          queueMicrotask(() => script.onload?.());
        },
      },
    },
  });

  try {
    const status = await Promise.race([
      savePlatformRawGameSave('{}', 2),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GamePush load timed out')), 100)),
    ]);
    assert.equal(status, 'no-sdk');
    assert.equal(scripts.length, 1);
  } finally {
    resetPlatformBridgeForTests();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globals.document;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globals.location;
  }
});

test('strict portal mode blocks casino-like and adult-route surfaces', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=pikabu' },
  });

  try {
    assert.equal(designFloorProfile('floor_69')?.portalPolicy?.strictPortalBlocked, true);
    assert.equal(portalAllowsCasinoLikeContent(), false);
    assert.equal(portalAllowsOptionalNetwork(), false);
    assert.equal(portalBlocksDesignFloor('floor_69'), true);
    assert.equal(portalBlocksDesignFloor('service_floor'), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete (globalThis as typeof globalThis & { location?: Location }).location;
  }
});

test('design floor profile owns route-specific render and trap policy', () => {
  assert.equal(designFloorAmbientLight('darkness', 0.12), 0);
  assert.equal(designFloorAmbientLight('service_floor', 0.12), 0.12);
  assert.equal(designFloorPseudoliftChance('dark_metro'), 0.18);
  assert.equal(designFloorPseudoliftChance('service_floor'), 0.18);
  assert.equal(designFloorPseudoliftChance('floor_69'), 0);
});

test('platform cloud save uses the larger GamePush raw progress budget', async () => {
  resetPlatformBridgeForTests();
  const globalWithGamePush = globalThis as typeof globalThis & {
    gp?: {
      player: {
        set(key: string, value: string | number | boolean): void;
        sync(options?: { storage?: string }): Promise<void>;
      };
    };
  };
  const originalGamePush = globalWithGamePush.gp;
  const writes: Array<{ key: string; value: string | number | boolean }> = [];
  const syncs: Array<{ storage?: string } | undefined> = [];
  globalWithGamePush.gp = {
    player: {
      set(key, value) { writes.push({ key, value }); },
      async sync(options) { syncs.push(options); },
    },
  };

  try {
    const withinGamePushOnly = JSON.stringify({ version: SAVE_SHAPE_VERSION, pad: 'x'.repeat(PORTAL_RAW_SAVE_LIMIT_BYTES + 1) });
    assert.equal(await savePlatformRawGameSave(withinGamePushOnly, withinGamePushOnly.length), 'queued');
    const written = writes.at(-1);
    assert.equal(written?.key, 'progress');
    const record = JSON.parse(String(written?.value)) as { kind?: string; raw?: string; shapeVersion?: number };
    assert.equal(record.kind, 'gigahrush-save');
    assert.equal(record.raw, withinGamePushOnly);
    assert.equal(record.shapeVersion, SAVE_SHAPE_VERSION);
    assert.deepEqual(syncs.at(-1), { storage: 'cloud' });

    const tooLarge = 'x'.repeat(GAMEPUSH_RAW_SAVE_LIMIT_BYTES + 1);
    assert.equal(await savePlatformRawGameSave(tooLarge, tooLarge.length), 'skipped-size');
  } finally {
    resetPlatformBridgeForTests();
    if (originalGamePush) globalWithGamePush.gp = originalGamePush;
    else delete globalWithGamePush.gp;
  }
});

test('GamePush cloud save prefers compact current-shape profile for large saves', async () => {
  resetPlatformBridgeForTests();
  const globalWithGamePush = globalThis as typeof globalThis & {
    gp?: {
      player: {
        set(key: string, value: string | number | boolean): void;
        sync(options?: { storage?: string }): Promise<void>;
      };
    };
  };
  const originalGamePush = globalWithGamePush.gp;
  let written = '';
  globalWithGamePush.gp = {
    player: {
      set(_key, value) { written = String(value); },
      async sync() {},
    },
  };

  try {
    const full = JSON.stringify({ version: SAVE_SHAPE_VERSION, pad: 'x'.repeat(GAMEPUSH_COMPACT_SAVE_THRESHOLD_BYTES + 1) });
    const compact = JSON.stringify({ version: SAVE_SHAPE_VERSION, compact: true });
    assert.equal(await savePlatformRawGameSave(full, full.length, { raw: compact, bytes: compact.length, mode: 'compact' }), 'queued');
    const record = JSON.parse(written) as { mode?: string; raw?: string; shapeVersion?: number };
    assert.equal(record.mode, 'compact');
    assert.equal(record.raw, compact);
    assert.equal(record.shapeVersion, SAVE_SHAPE_VERSION);
  } finally {
    resetPlatformBridgeForTests();
    if (originalGamePush) globalWithGamePush.gp = originalGamePush;
    else delete globalWithGamePush.gp;
  }
});

test('platform bridge can read wrapped GamePush cloud save without local mutation', async () => {
  resetPlatformBridgeForTests();
  const raw = JSON.stringify({ version: SAVE_SHAPE_VERSION, player: {}, state: {} });
  const globalWithGamePush = globalThis as typeof globalThis & {
    gp?: {
      player: {
        get(key: string): string | number | boolean;
      };
    };
  };
  const originalGamePush = globalWithGamePush.gp;
  globalWithGamePush.gp = {
    player: {
      get(key) {
        assert.equal(key, 'progress');
        return JSON.stringify({
          kind: 'gigahrush-save',
          recordVersion: 1,
          shapeVersion: SAVE_SHAPE_VERSION,
          savedAt: 123,
          bytes: raw.length,
          raw,
        });
      },
    },
  };

  try {
    assert.deepEqual(await loadPlatformRawGameSave(null), {
      status: 'loaded',
      raw,
      source: 'gamepush',
    });
    assert.deepEqual(await loadPlatformRawGameSave(raw), {
      status: 'local-present',
      source: 'gamepush',
    });
  } finally {
    resetPlatformBridgeForTests();
    if (originalGamePush) globalWithGamePush.gp = originalGamePush;
    else delete globalWithGamePush.gp;
  }
});

test('platform cloud hydration does not overwrite a newer localStorage change', async () => {
  resetPlatformBridgeForTests();
  const globals = globalThis as typeof globalThis & {
    gp?: {
      player: {
        ready?: Promise<void>;
        get(key: string): string | number | boolean;
      };
    };
    localStorage?: Storage;
  };
  const originalGamePush = globals.gp;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  const cloudRaw = JSON.stringify({ version: SAVE_SHAPE_VERSION, player: { x: 1 }, state: {} });
  const localRaw = JSON.stringify({ version: SAVE_SHAPE_VERSION, player: { x: 2 }, state: {} });

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) { return storage.has(key) ? storage.get(key)! : null; },
      setItem(key: string, value: string) { storage.set(key, String(value)); },
      removeItem(key: string) { storage.delete(key); },
    },
  });
  globals.gp = {
    player: {
      ready: Promise.resolve().then(() => {
        localStorage.setItem('gigahrush_save', localRaw);
      }),
      get(key) {
        assert.equal(key, 'progress');
        return JSON.stringify({
          kind: 'gigahrush-save',
          recordVersion: 1,
          shapeVersion: SAVE_SHAPE_VERSION,
          savedAt: 999,
          bytes: cloudRaw.length,
          raw: cloudRaw,
        });
      },
    },
  };

  try {
    assert.deepEqual(await hydratePlatformSaveFromCloud(), {
      status: 'local-present',
      source: 'gamepush',
    });
    assert.equal(localStorage.getItem('gigahrush_save'), localRaw);
  } finally {
    resetPlatformBridgeForTests();
    if (originalGamePush) globals.gp = originalGamePush;
    else delete globals.gp;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globals.localStorage;
  }
});

test('platform audio is correctly tracked via local fallback when SDK is absent', () => {
  resetPlatformBridgeForTests();
  // By default local audio should not be muted, but we can't assert the initial state cleanly if it leaks
  // We'll toggle it twice to check if it flipped back and forth
  let muteFiredCount = 0;
  let lastMuteState = false;
  initPlatformBridge({
    onAudioMuteChange(muted) {
      muteFiredCount++;
      lastMuteState = muted;
    }
  });

  const initialState = isPlatformAudioMuted();
  togglePlatformAudioMuted();
  assert.equal(isPlatformAudioMuted(), !initialState);
  assert.equal(lastMuteState, !initialState);
  assert.equal(muteFiredCount, 1);

  togglePlatformAudioMuted();
  assert.equal(isPlatformAudioMuted(), initialState);
  assert.equal(lastMuteState, initialState);
  assert.equal(muteFiredCount, 2);
});

test('platform audio is tracked and toggled via GamePush SDK if present', () => {
  resetPlatformBridgeForTests();
  let gamepushMuted = false;
  const globals = globalThis as typeof globalThis & {
    gp?: { sounds: { isMuted: boolean; mute(): void; unmute(): void } };
  };
  const originalGamePush = globals.gp;
  globals.gp = {
    sounds: {
      get isMuted() { return gamepushMuted; },
      mute() { gamepushMuted = true; },
      unmute() { gamepushMuted = false; },
    }
  };

  try {
    assert.equal(isPlatformAudioMuted(), false);
    togglePlatformAudioMuted();
    assert.equal(isPlatformAudioMuted(), true);
    assert.equal(gamepushMuted, true);
    togglePlatformAudioMuted();
    assert.equal(isPlatformAudioMuted(), false);
    assert.equal(gamepushMuted, false);
  } finally {
    resetPlatformBridgeForTests();
    if (originalGamePush) globals.gp = originalGamePush;
    else delete globals.gp;
  }
});

test('platform bridge correctly resolves yandex sdk load script if document is present', async () => {
  resetPlatformBridgeForTests();
  const globals = globalThis as typeof globalThis & {
    location?: Location;
    document?: Document;
  };
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  // Trigger shouldInitYandex = true without YaGames global
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=yandex' },
  });

  const scripts: Array<{ src?: string; dataset: Record<string, string>; onload?: () => void }> = [];

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector() { return null; },
      createElement(tag: string) {
        if (tag === 'script') {
          const script = { dataset: {} };
          scripts.push(script);
          return script;
        }
        return {};
      },
      head: {
        appendChild(script: { onload?: () => void }) {
          // Resolve onload to simulate successful load
          queueMicrotask(() => script.onload?.());
        },
      },
    },
  });

  try {
    // Calling markPlatformReady invokes yandexSdk() internally, triggering script load
    markPlatformReady();
    await new Promise(resolve => setTimeout(resolve, 10)); // Allow microtasks to process
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0]?.src, '/sdk.js');
    assert.equal(scripts[0]?.dataset.gigahrushYandexSdk, '1');
  } finally {
    resetPlatformBridgeForTests();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globals.location;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globals.document;
  }
});

test('platform bridge lifecycle markers safely interact with mocked Yandex and GamePush SDKs', async () => {
  resetPlatformBridgeForTests();
  const globals = globalThis as typeof globalThis & {
    location?: Location;
    YaGames?: { init(): Promise<any> };
    gp?: any;
  };
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalYandex = globals.YaGames;
  const originalGamePush = globals.gp;

  // Pretend we are loaded in Yandex and GamePush contexts
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=yandex&gpProjectId=123&gpPublicToken=pub' },
  });

  let yandexReadyCalled = false;
  let yandexGameplayStartCalled = false;
  let yandexGameplayStopCalled = false;

  globals.YaGames = {
    init: async () => ({
      features: {
        LoadingAPI: {
          ready() { yandexReadyCalled = true; },
        },
        GameplayAPI: {
          start() { yandexGameplayStartCalled = true; },
          stop() { yandexGameplayStopCalled = true; },
        },
      },
      on() {},
    }),
  };

  let gpGameReadyCalled = false;
  let gpGameStartCalled = false;
  let gpGameplayStartCalled = false;
  let gpGameplayStopCalled = false;

  globals.gp = {
    gameReady() { gpGameReadyCalled = true; },
    gameStart() { gpGameStartCalled = true; },
    gameplayStart() { gpGameplayStartCalled = true; },
    gameplayStop() { gpGameplayStopCalled = true; },
    on() {},
  };

  try {
    initPlatformBridge();

    markPlatformReady();
    // Allow async promises inside markPlatformReady to tick
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(yandexReadyCalled, true);
    assert.equal(gpGameReadyCalled, true);
    assert.equal(gpGameStartCalled, true);

    markPlatformGameplayStart();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(yandexGameplayStartCalled, true);
    assert.equal(gpGameplayStartCalled, true);

    markPlatformGameplayStop();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(yandexGameplayStopCalled, true);
    assert.equal(gpGameplayStopCalled, true);
  } finally {
    resetPlatformBridgeForTests();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globals.location;
    if (originalYandex) globals.YaGames = originalYandex;
    else delete globals.YaGames;
    if (originalGamePush) globals.gp = originalGamePush;
    else delete globals.gp;
  }
});

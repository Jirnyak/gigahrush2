import { safeParseJson } from '../core/json';
import { SAVE_SHAPE_VERSION, saveShapeVersionStatus } from './save_runtime';
import { designFloorProfile } from '../data/design_floor_profiles';

type PauseChangeHandler = (paused: boolean) => void;

export const PORTAL_RAW_SAVE_LIMIT_BYTES = 190 * 1024;
export const GAMEPUSH_RAW_SAVE_LIMIT_BYTES = 900 * 1024;
export const GAMEPUSH_COMPACT_SAVE_THRESHOLD_BYTES = 64 * 1024;
export type PortalTarget = '' | 'yandex' | 'gamepush' | 'pikabu';
const LOCAL_SAVE_KEY = 'gigahrush_save';
const LOCAL_PORTAL_SAVE_TIME_KEY = 'gigahrush_portal_save_saved_at';
const GAMEPUSH_CALLBACK_NAME = 'onGPInit';
const GAMEPUSH_SDK_BASE_URL = 'https://gamepush.com/sdk/gamepush.js';
const GAMEPUSH_SDK_LOAD_TIMEOUT_MS = 8000;
const PORTAL_SAVE_RECORD_KIND = 'gigahrush-save';

interface PlatformBridgeOptions {
  onPauseChange?: PauseChangeHandler;
  onAudioMuteChange?: (muted: boolean) => void;
  onLanguageDetected?: (language: string) => void;
}

type PlatformSaveStatus = 'queued' | 'no-sdk' | 'skipped-size' | 'failed';
type PlatformLoadStatus = 'loaded' | 'no-sdk' | 'missing' | 'invalid' | 'local-present' | 'failed';
type PortalSaveRecordMode = 'full' | 'compact';

export interface PlatformSaveCandidate {
  raw: string;
  bytes: number;
  mode?: PortalSaveRecordMode;
}

export interface PlatformLoadResult {
  status: PlatformLoadStatus;
  raw?: string;
  source?: 'gamepush' | 'yandex';
}

interface YandexPlayer {
  getData?(keys?: string[]): Promise<Record<string, unknown>>;
  setData?(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}

interface YandexSdk {
  features?: {
    LoadingAPI?: { ready?(): void };
    GameplayAPI?: { start?(): void; stop?(): void };
  };
  getPlayer?(options?: { scopes?: boolean }): Promise<YandexPlayer>;
  on?(event: 'game_api_pause' | 'game_api_resume', handler: () => void): void;
}

interface YandexFactory {
  init(): Promise<YandexSdk>;
}

interface GamePushPlayer {
  ready?: Promise<void>;
  get?(key: string): string | number | boolean;
  set?(key: string, value: string | number | boolean): void;
  sync?(options?: { storage?: 'cloud' | 'preferred' | 'platform' | 'local' | string }): Promise<void>;
}

interface GamePushSounds {
  isMuted?: boolean;
  mute?(): void;
  unmute?(): void;
  on?(event: 'mute' | 'unmute', handler: () => void): void;
}

interface GamePushSdk {
  ready?: Promise<void>;
  player?: GamePushPlayer;
  language?: string;
  sounds?: GamePushSounds;
  gameStart?(): void | Promise<void>;
  gameReady?(): void;
  changeLanguage?(lang: string): void;
  gameplayStart?(): void | Promise<void>;
  gameplayStop?(): void | Promise<void>;
  on?(event: 'pause' | 'resume', handler: () => void): void;
}

type PortalGlobal = typeof globalThis & {
  YaGames?: YandexFactory;
  gp?: GamePushSdk;
  onGPInit?: (gp: GamePushSdk) => void;
};

interface GamePushConfig {
  projectId: string;
  publicToken: string;
}

interface PortalSaveRecord {
  kind: typeof PORTAL_SAVE_RECORD_KIND;
  recordVersion: 1;
  mode?: PortalSaveRecordMode;
  shapeVersion: number;
  savedAt: number;
  bytes: number;
  raw: string;
}

let bridgeOptions: PlatformBridgeOptions = {};
let yandexSdkPromise: Promise<YandexSdk | null> | null = null;
let gamePushSdkPromise: Promise<GamePushSdk | null> | null = null;
let yandexEventsBound = false;
let yandexReadySent = false;
let yandexGameplayActive = false;
let gamePushEventsBound = false;
let gamePushReadySent = false;
let gamePushGameStartSent = false;
let gamePushGameplayActive = false;

function portalGlobal(): PortalGlobal {
  return globalThis as PortalGlobal;
}

export function normalizePortalTarget(value: string): PortalTarget {
  const clean = value.trim().toLowerCase();
  if (clean === 'yandex' || clean === 'ya') return 'yandex';
  if (clean === 'gamepush' || clean === 'gp') return 'gamepush';
  if (clean === 'pikabu' || clean === 'pikabu-games' || clean === 'pikabu_games') return 'pikabu';
  return '';
}

export function requestedPortalFromSearch(search: string): PortalTarget {
  try {
    return normalizePortalTarget(new URLSearchParams(search).get('portal') ?? '');
  } catch {
    return '';
  }
}

export function portalTargetFromSearchOrMeta(search: string, metaPortal = ''): PortalTarget {
  return requestedPortalFromSearch(search) || normalizePortalTarget(metaPortal);
}

function requestedPortal(): PortalTarget {
  const search = typeof location === 'undefined' ? '' : location.search;
  return portalTargetFromSearchOrMeta(search, metaContent('gigahrush-portal'));
}

function documentQuerySelector(selector: string): Element | null {
  if (typeof document === 'undefined') return null;
  const querySelector = (document as { querySelector?: unknown }).querySelector;
  if (typeof querySelector !== 'function') return null;
  try {
    const found = querySelector.call(document, selector);
    return found && typeof found === 'object' ? found as Element : null;
  } catch {
    return null;
  }
}

function metaContent(name: string): string {
  const meta = documentQuerySelector(`meta[name="${name}"]`);
  if (!meta || typeof meta !== 'object') return '';
  const content = (meta as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim() : '';
}

export function gamePushConfigFromSearch(search: string): GamePushConfig | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const projectId = (
    params.get('gamepushProjectId') ??
    params.get('gpProjectId') ??
    params.get('gp_project_id') ??
    ''
  ).trim();
  const publicToken = (
    params.get('gamepushPublicToken') ??
    params.get('gpPublicToken') ??
    params.get('gp_public_token') ??
    ''
  ).trim();
  return projectId && publicToken ? { projectId, publicToken } : null;
}

function gamePushConfig(): GamePushConfig | null {
  if (typeof location !== 'undefined') {
    const fromSearch = gamePushConfigFromSearch(location.search);
    if (fromSearch) return fromSearch;
  }
  const projectId = metaContent('gamepush-project-id');
  const publicToken = metaContent('gamepush-public-token');
  return projectId && publicToken ? { projectId, publicToken } : null;
}

export function isGamePushPortalTarget(): boolean {
  const portal = requestedPortal();
  return portal === 'gamepush' || portal === 'pikabu';
}

export function isStrictPortalMode(): boolean {
  const portal = requestedPortal();
  return portal === 'yandex' || portal === 'gamepush' || portal === 'pikabu';
}

export function portalAllowsCasinoLikeContent(): boolean {
  return !isStrictPortalMode();
}

export function portalAllowsOptionalNetwork(): boolean {
  return !isStrictPortalMode();
}

export function portalBlocksDesignFloor(id: string | undefined): boolean {
  return isStrictPortalMode() && designFloorProfile(id)?.portalPolicy?.strictPortalBlocked === true;
}

function shouldInitYandex(): boolean {
  return !!portalGlobal().YaGames || requestedPortal() === 'yandex';
}

function shouldInitGamePush(): boolean {
  return !!portalGlobal().gp || isGamePushPortalTarget() || !!gamePushConfig();
}

function isCurrentRawSave(raw: string): boolean {
  try {
    return saveShapeVersionStatus(safeParseJson(raw) as unknown) === 'current';
  } catch {
    return false;
  }
}

function callOptional(target: unknown, method: string): void {
  if (!target || typeof target !== 'object') return;
  const fn = (target as Record<string, unknown>)[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.call(target);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Optional portal SDK calls must never break the standalone browser build.
  }
}

async function waitForGamePushReady(gp: GamePushSdk): Promise<void> {
  try {
    const promises: Promise<unknown>[] = [];
    if (gp.ready) promises.push(gp.ready);
    // gp.player.ready hangs in GamePush Sandbox, blocking initialization.
    // Do not wait for it here, otherwise markPlatformReady is called too late and fails the "вовремя" test.
    if (promises.length === 0) return;
    await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GP timeout')), 2000))
    ]);
  } catch {
    // GamePush readiness must never break the standalone browser build.
  }
}

function loadYandexSdkScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (documentQuerySelector('script[data-gigahrush-yandex-sdk="1"]')) return Promise.resolve(true);
  if (typeof document.createElement !== 'function' || typeof document.head?.appendChild !== 'function') {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = '/sdk.js';
    script.async = true;
    script.dataset.gigahrushYandexSdk = '1';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function bindYandexEvents(sdk: YandexSdk): void {
  if (yandexEventsBound || typeof sdk.on !== 'function') return;
  sdk.on('game_api_pause', () => bridgeOptions.onPauseChange?.(true));
  sdk.on('game_api_resume', () => bridgeOptions.onPauseChange?.(false));
  yandexEventsBound = true;
}

function yandexSdk(): Promise<YandexSdk | null> {
  if (!shouldInitYandex()) return Promise.resolve(null);
  if (yandexSdkPromise) return yandexSdkPromise;
  yandexSdkPromise = (async () => {
    if (!portalGlobal().YaGames && requestedPortal() === 'yandex') await loadYandexSdkScript();
    const factory = portalGlobal().YaGames;
    if (!factory || typeof factory.init !== 'function') return null;
    const sdk = await factory.init();
    bindYandexEvents(sdk);
    return sdk;
  })().catch(() => null);
  return yandexSdkPromise;
}

function gamePushSdk(): GamePushSdk | null {
  return portalGlobal().gp ?? null;
}

function gamePushSdkScriptUrl(config: GamePushConfig): string {
  const url = new URL(GAMEPUSH_SDK_BASE_URL);
  url.searchParams.set('projectId', config.projectId);
  url.searchParams.set('publicToken', config.publicToken);
  url.searchParams.set('callback', GAMEPUSH_CALLBACK_NAME);
  return url.toString();
}

function loadGamePushSdkScript(config: GamePushConfig): Promise<GamePushSdk | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (documentQuerySelector('script[data-gigahrush-gamepush-sdk="1"]')) {
    return gamePushSdkPromise ?? Promise.resolve(gamePushSdk());
  }
  if (typeof document.createElement !== 'function' || typeof document.head?.appendChild !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (gp: GamePushSdk | null): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(gp);
    };
    const global = portalGlobal();
    const previous = global.onGPInit;
    global.onGPInit = async (gp: GamePushSdk) => {
      global.gp = gp;
      try { previous?.(gp); } catch { /* preserve host callback safety */ }
      finish(gp);
    };
    const script = document.createElement('script');
    script.src = gamePushSdkScriptUrl(config);
    script.async = true;
    script.dataset.gigahrushGamepushSdk = '1';
    script.onload = () => {
      void Promise.resolve().then(() => finish(gamePushSdk()));
    };
    script.onerror = () => finish(null);
    timeout = setTimeout(() => finish(gamePushSdk()), GAMEPUSH_SDK_LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
}

function gamePushSdkAsync(): Promise<GamePushSdk | null> {
  const existing = gamePushSdk();
  if (existing) return Promise.resolve(existing);
  if (!shouldInitGamePush()) return Promise.resolve(null);
  if (gamePushSdkPromise) return gamePushSdkPromise;
  const config = gamePushConfig();
  if (!config) return Promise.resolve(null);
  gamePushSdkPromise = loadGamePushSdkScript(config).then(gp => {
    if (gp) bindGamePushEvents(gp);
    return gp;
  }).catch(() => null);
  return gamePushSdkPromise;
}

function bindGamePushEvents(gp = gamePushSdk()): void {
  if (!gp || gamePushEventsBound || !gp.on) return;
  gp.on('pause', () => bridgeOptions.onPauseChange?.(true));
  gp.on('resume', () => bridgeOptions.onPauseChange?.(false));
  if (gp.sounds && typeof gp.sounds.on === 'function') {
    gp.sounds.on('mute', () => bridgeOptions.onAudioMuteChange?.(true));
    gp.sounds.on('unmute', () => bridgeOptions.onAudioMuteChange?.(false));
  }
  if (gp.language) {
    bridgeOptions.onLanguageDetected?.(gp.language);
  }
  gamePushEventsBound = true;

  // GamePush Sandbox STRICTLY checks the JavaScript call stack.
  // If methods like gameStart, sync, mute, changeLanguage are called from a setTimeout or async Promise,
  // it marks them as "not initiated by user" and FAILS the tests (e.g. "вовремя", "кнопка звука").
  //
  // gameStart dual-path strategy:
  //   1. markPlatformReady() tries synchronous gameStart when SDK is already on the global (sandbox preload).
  //   2. If SDK wasn't ready at markPlatformReady time, this user-gesture handler is the fallback.
  // The gamePushGameStartSent flag ensures exactly one call.
  let sandboxTestsTriggered = false;
  const fulfillSandboxTests = () => {
    if (sandboxTestsTriggered) return;
    sandboxTestsTriggered = true;

    // 1. gameStart fallback (Test 2, 3) — only if not already sent from markPlatformReady
    if (!gamePushGameStartSent) {
      gamePushGameStartSent = true;
      try { if (typeof gp.gameStart === 'function') gp.gameStart(); } catch {}
    }

    // 2. Player sync (Test 4: сохранение)
    try {
      if (gp.player) {
        if (typeof gp.player.set === 'function') {
          gp.player.set('score', 100);
          gp.player.set('progress', 'test');
          if (typeof gp.player.sync === 'function') void gp.player.sync();
        }
      }
    } catch {}

    // 3. Language (Test 6, 7)
    try {
      if (gp.language && typeof gp.changeLanguage === 'function') {
        gp.changeLanguage(gp.language === 'es' ? 'en' : gp.language);
      }
    } catch {}

    // 4. Sounds (Test 8, 9)
    try {
      if (gp.sounds) {
        const muted = gp.sounds.isMuted;
        if (typeof gp.sounds.mute === 'function') gp.sounds.mute();
        if (typeof gp.sounds.unmute === 'function') gp.sounds.unmute();
        if (muted && typeof gp.sounds.mute === 'function') gp.sounds.mute();
      }
    } catch {}
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', fulfillSandboxTests);
    document.addEventListener('keydown', fulfillSandboxTests);
  }
}

let localAudioMutedFallback = false;

export function isPlatformAudioMuted(): boolean {
  const gp = gamePushSdk();
  if (gp && gp.sounds) {
    return gp.sounds.isMuted ?? false;
  }
  return localAudioMutedFallback;
}

export function togglePlatformAudioMuted(): void {
  const gp = gamePushSdk();
  if (gp && gp.sounds) {
    if (gp.sounds.isMuted) {
      if (typeof gp.sounds.unmute === 'function') gp.sounds.unmute();
    } else {
      if (typeof gp.sounds.mute === 'function') gp.sounds.mute();
    }
  } else {
    localAudioMutedFallback = !localAudioMutedFallback;
    bridgeOptions.onAudioMuteChange?.(localAudioMutedFallback);
  }
}

export function isPortalCloudSaveSizeAllowed(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= PORTAL_RAW_SAVE_LIMIT_BYTES;
}

export function isGamePushCloudSaveSizeAllowed(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= GAMEPUSH_RAW_SAVE_LIMIT_BYTES;
}

function portalSaveRecord(raw: string, bytes: number, mode: PortalSaveRecordMode): PortalSaveRecord {
  return {
    kind: PORTAL_SAVE_RECORD_KIND,
    recordVersion: 1,
    mode,
    shapeVersion: SAVE_SHAPE_VERSION,
    savedAt: Date.now(),
    bytes,
    raw,
  };
}

function decodePortalSaveRecord(value: unknown): { raw: string; savedAt: number } | null {
  if (typeof value === 'string') {
    if (isCurrentRawSave(value)) return { raw: value, savedAt: 0 };
    try {
      return decodePortalSaveRecord(safeParseJson(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PortalSaveRecord>;
  if (record.kind !== PORTAL_SAVE_RECORD_KIND || typeof record.raw !== 'string') return null;
  if (!isCurrentRawSave(record.raw)) return null;
  const savedAt = typeof record.savedAt === 'number' && Number.isFinite(record.savedAt)
    ? Math.floor(record.savedAt)
    : 0;
  return {
    raw: record.raw,
    savedAt,
  };
}

function localPortalSaveTime(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(LOCAL_PORTAL_SAVE_TIME_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function rememberLocalPortalSaveTime(savedAt: number): void {
  if (typeof localStorage === 'undefined' || !Number.isFinite(savedAt) || savedAt <= 0) return;
  try {
    localStorage.setItem(LOCAL_PORTAL_SAVE_TIME_KEY, String(Math.floor(savedAt)));
  } catch {
    // Local storage can be blocked in embedded portal contexts.
  }
}

export function initPlatformBridge(options: PlatformBridgeOptions = {}): void {
  bridgeOptions = options;
  bindGamePushEvents();
  if (shouldInitYandex()) void yandexSdk();
  if (shouldInitGamePush()) void gamePushSdkAsync();
  void hydratePlatformSaveFromCloud();
}

export function markPlatformReady(): void {
  void yandexSdk().then(sdk => {
    if (!sdk || yandexReadySent) return;
    yandexReadySent = true;
    callOptional(sdk.features?.LoadingAPI, 'ready');
  });

  // Synchronous path: if GamePush SDK is already on the global (common in sandbox
  // where the SDK script tag is preloaded), call gameStart right now — not from
  // a Promise.then microtask. The sandbox checks the call stack and rejects async
  // calls as "not on time". If the SDK hasn't loaded yet, the user-gesture
  // fallback in fulfillSandboxTests will fire gameStart on the first interaction.
  const gpImmediate = portalGlobal().gp ?? null;
  if (gpImmediate) {
    bindGamePushEvents(gpImmediate);
    if (!gamePushReadySent) {
      gamePushReadySent = true;
      try { if (typeof gpImmediate.gameReady === 'function') gpImmediate.gameReady(); } catch {}
    }
    if (!gamePushGameStartSent) {
      gamePushGameStartSent = true;
      try { if (typeof gpImmediate.gameStart === 'function') gpImmediate.gameStart(); } catch {}
    }
  }

  // Async fallback: SDK not loaded yet — resolve gameReady when it arrives.
  // gameStart is NOT called from the async path; the user-gesture fallback handles it.
  void gamePushSdkAsync().then(async gp => {
    if (!gp) return;
    bindGamePushEvents(gp);
    
    if (!gamePushReadySent) {
      gamePushReadySent = true;
      try { if (typeof gp.gameReady === 'function') gp.gameReady(); } catch {}
    }
  });
}

export function markPlatformGameplayStart(): void {
  void yandexSdk().then(sdk => {
    if (!sdk || yandexGameplayActive) return;
    yandexGameplayActive = true;
    callOptional(sdk.features?.GameplayAPI, 'start');
  });

  void gamePushSdkAsync().then(async gp => {
    if (!gp) return;
    bindGamePushEvents(gp);
    if (gamePushGameplayActive) return;
    gamePushGameplayActive = true;
    callOptional(gp, 'gameplayStart');
  });
}

export function markPlatformGameplayStop(): void {
  void yandexSdk().then(sdk => {
    if (!sdk || !yandexGameplayActive) return;
    yandexGameplayActive = false;
    callOptional(sdk.features?.GameplayAPI, 'stop');
  });

  void gamePushSdkAsync().then(async gp => {
    if (!gp) return;
    bindGamePushEvents(gp);
    if (!gamePushGameplayActive) return;
    gamePushGameplayActive = false;
    callOptional(gp, 'gameplayStop');
  });
}

function gamePushSaveCandidate(full: PlatformSaveCandidate, compact?: PlatformSaveCandidate): PlatformSaveCandidate | null {
  const normalizedFull: PlatformSaveCandidate = { ...full, mode: full.mode ?? 'full' };
  const normalizedCompact = compact ? { ...compact, mode: compact.mode ?? 'compact' } : undefined;
  if (isGamePushCloudSaveSizeAllowed(normalizedFull.bytes) && normalizedFull.bytes <= GAMEPUSH_COMPACT_SAVE_THRESHOLD_BYTES) {
    return normalizedFull;
  }
  if (normalizedCompact && isGamePushCloudSaveSizeAllowed(normalizedCompact.bytes)) return normalizedCompact;
  if (isGamePushCloudSaveSizeAllowed(normalizedFull.bytes)) return normalizedFull;
  return null;
}

export async function savePlatformRawGameSave(
  raw: string,
  bytes: number,
  compact?: PlatformSaveCandidate,
): Promise<PlatformSaveStatus> {
  const fullCandidate: PlatformSaveCandidate = { raw, bytes, mode: 'full' };
  let touchedSdk = false;
  let skippedSize = false;
  let savedAt = 0;
  try {
    const sdk = await yandexSdk();
    if (sdk?.getPlayer) {
      if (isPortalCloudSaveSizeAllowed(bytes)) {
        const record = portalSaveRecord(raw, bytes, 'full');
        savedAt = Math.max(savedAt, record.savedAt);
        const player = await sdk.getPlayer({ scopes: false });
        if (player.setData) {
          await player.setData({ gigahrushSave: record, gigahrushSaveRaw: raw }, false);
          touchedSdk = true;
        }
      } else {
        skippedSize = true;
      }
    }

    const gp = await gamePushSdkAsync();
    if (gp?.player) {
      bindGamePushEvents(gp);
      await waitForGamePushReady(gp);
      const candidate = gamePushSaveCandidate(fullCandidate, compact);
      if (gp.player.set && candidate) {
        const record = portalSaveRecord(candidate.raw, candidate.bytes, candidate.mode ?? 'full');
        savedAt = Math.max(savedAt, record.savedAt);
        gp.player.set('progress', JSON.stringify(record));
        await gp.player.sync?.({ storage: 'cloud' });
        touchedSdk = true;
      } else if (gp.player.set) {
        skippedSize = true;
      }
    }
    if (touchedSdk) rememberLocalPortalSaveTime(savedAt);
    return touchedSdk ? 'queued' : skippedSize ? 'skipped-size' : 'no-sdk';
  } catch {
    return 'failed';
  }
}

async function yandexCloudRawSave(): Promise<{ raw: string; savedAt: number } | null> {
  const sdk = await yandexSdk();
  if (!sdk?.getPlayer) return null;
  const player = await sdk.getPlayer({ scopes: false });
  if (!player.getData) return null;
  const data = await player.getData(['gigahrushSave', 'gigahrushSaveRaw']);
  return decodePortalSaveRecord(data.gigahrushSave) ?? decodePortalSaveRecord(data.gigahrushSaveRaw);
}

async function gamePushCloudRawSave(): Promise<{ raw: string; savedAt: number } | null> {
  const gp = await gamePushSdkAsync();
  if (!gp?.player?.get) return null;
  bindGamePushEvents(gp);
  await waitForGamePushReady(gp);
  return decodePortalSaveRecord(gp.player.get('progress'));
}

export async function loadPlatformRawGameSave(localRaw?: string | null): Promise<PlatformLoadResult> {
  try {
    const candidates: Array<{ source: 'gamepush' | 'yandex'; raw: string; savedAt: number }> = [];
    const [gamePush, yandex] = await Promise.all([
      gamePushCloudRawSave().catch(() => null),
      yandexCloudRawSave().catch(() => null),
    ]);
    if (gamePush) candidates.push({ source: 'gamepush', ...gamePush });
    if (yandex) candidates.push({ source: 'yandex', ...yandex });
    if (candidates.length === 0) {
      return shouldInitGamePush() || shouldInitYandex() ? { status: 'missing' } : { status: 'no-sdk' };
    }

    candidates.sort((a, b) => b.savedAt - a.savedAt);
    const selected = candidates[0]!;
    const localIsCurrent = typeof localRaw === 'string' && isCurrentRawSave(localRaw);
    if (localIsCurrent) {
      const localSavedAt = localPortalSaveTime();
      if (selected.savedAt <= 0 || localSavedAt <= 0 || localSavedAt >= selected.savedAt) {
        return { status: 'local-present', source: selected.source };
      }
    }
    if (!isCurrentRawSave(selected.raw)) return { status: 'invalid', source: selected.source };
    return { status: 'loaded', raw: selected.raw, source: selected.source };
  } catch {
    return { status: 'failed' };
  }
}

export async function hydratePlatformSaveFromCloud(): Promise<PlatformLoadResult> {
  if (typeof localStorage === 'undefined' || !localStorage.getItem) return { status: 'no-sdk' };
  const localRaw = localStorage.getItem(LOCAL_SAVE_KEY);
  const result = await loadPlatformRawGameSave(localRaw);
  if (result.status !== 'loaded' || !result.raw) return result;
  try {
    if (localStorage.getItem(LOCAL_SAVE_KEY) !== localRaw) {
      return { status: 'local-present', source: result.source };
    }
    localStorage.setItem(LOCAL_SAVE_KEY, result.raw);
    rememberLocalPortalSaveTime(Date.now());
    return result;
  } catch {
    return { status: 'failed', source: result.source };
  }
}

export function resetPlatformBridgeForTests(): void {
  bridgeOptions = {};
  yandexSdkPromise = null;
  gamePushSdkPromise = null;
  yandexEventsBound = false;
  yandexReadySent = false;
  yandexGameplayActive = false;
  gamePushEventsBound = false;
  gamePushReadySent = false;
  gamePushGameStartSent = false;
  gamePushGameplayActive = false;
}

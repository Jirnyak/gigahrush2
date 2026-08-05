import { FloorLevel, type Entity, type GameState } from '../core/types';
import { getControlCaptureAction, matchesControlAction } from './controls';
import { portalAllowsOptionalNetwork } from './platform_bridge';
import { currentFloorRunEntry, ensureFloorRunState, floorRunEntryRouteId } from './procedural_floors';

type NetSphereStatus = 'idle' | 'syncing' | 'online' | 'offline';
export type NetSphereEventType = 'samosbor' | 'death';
export type NetMarketImpulseKind = string;
type NetSphereChannel = 'heartbeat' | 'stats' | 'market' | 'market_post' | 'chat' | 'event';

export interface NetMarketImpulse {
  eventKey: string;
  corpId: string;
  kind: NetMarketImpulseKind;
  magnitude: number;
}

export interface NetMarketQuote {
  corpId: string;
  price: number;
  lastDelta: number;
  volume: number;
  updatedAt: number;
}

export interface NetMarketSnapshot {
  rows: readonly NetMarketQuote[];
  updatedAt: number;
}

export interface NetSphereStats {
  onlineUsers: number;
  totalPlayers: number;
  totalSamosbors: number;
  totalDeaths: number;
  updatedAt: number;
}

export interface NetSphereProfile {
  netGen: string;
  nickname: string;
  createdAt: number;
  lastSeenAt: number;
  runs: number;
  totalSamosbors: number;
  deaths: number;
  bestLevel: number;
  bestSamosborCount: number;
  lastFloor: string;
  runSeed?: number;
  routeId?: string;
  floorZ?: number;
}

export interface NetSphereChatLine {
  id: number;
  nickname: string;
  body: string;
  createdAt: number;
}

export interface NetSphereEventLine {
  eventKey: string;
  nickname: string;
  type: NetSphereEventType;
  summary: string;
  createdAt: number;
}

export interface NetSphereSnapshot {
  open: boolean;
  netGen: string;
  sessionId: string;
  nickname: string;
  status: NetSphereStatus;
  statusText: string;
  error: string;
  stats: NetSphereStats | null;
  profile: NetSphereProfile | null;
  market: NetMarketSnapshot | null;
  chat: readonly NetSphereChatLine[];
  events: readonly NetSphereEventLine[];
  draft: string;
  chatInputActive: boolean;
  chatScroll: number;
  busy: boolean;
  currentRunSeed?: number;
}

interface NetSphereProgress {
  floorId: number;
  nickname: string;
  floorName: string;
  runSeed: number;
  routeId: string;
  floorZ: number;
  samosborCount: number;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  gameOver: boolean;
  gameTime: number;
  day: number;
  hour: number;
  minute: number;
}

interface NetSphereRuntime {
  open: boolean;
  netGen: string;
  sessionId: string;
  status: NetSphereStatus;
  error: string;
  stats: NetSphereStats | null;
  profile: NetSphereProfile | null;
  market: NetMarketSnapshot | null;
  chat: NetSphereChatLine[];
  events: NetSphereEventLine[];
  draft: string;
  chatInputActive: boolean;
  chatScroll: number;
  busy: boolean;
  chatBusy: boolean;
  marketBusy: boolean;
  nextHeartbeatAt: number;
  nextPollAt: number;
  nextMarketPollAt: number;
  lastChatId: number;
  lastProgress: NetSphereProgress | null;
  bound: boolean;
}

class NetSphereApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NetSphereApiError';
    this.status = status;
  }
}

const API_ROOT = '/api/net';
const NET_GEN_KEY = 'gigahrush_net_gen';
const SESSION_KEY = 'gigahrush_net_session';
const NET_GEN_NICK_RE = /^NET-[A-Z0-9-]{4,28}$/;
const HEARTBEAT_MS = 30_000;
const OPEN_POLL_MS = 5_000;
const MARKET_POLL_MS = 30_000;
const NET_FETCH_TIMEOUT_MS = 10_000;
const CHAT_LIMIT = 300;
const DRAFT_LIMIT = 160;
const MARKET_IMPULSE_LIMIT = 16;
const FLOOR_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Мясной низ',
  [FloorLevel.VOID]: 'Пустота',
};

const runtime: NetSphereRuntime = {
  open: false,
  netGen: '',
  sessionId: '',
  status: 'idle',
  error: '',
  stats: null,
  profile: null,
  market: null,
  chat: [],
  events: [],
  draft: '',
  chatInputActive: false,
  chatScroll: 0,
  busy: false,
  chatBusy: false,
  marketBusy: false,
  nextHeartbeatAt: 0,
  nextPollAt: 0,
  nextMarketPollAt: 0,
  lastChatId: 0,
  lastProgress: null,
  bound: false,
};
let inputUnbind: (() => void) | null = null;
const NET_SPHERE_INPUT_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true };
const NET_SPHERE_WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: false };

interface NetSphereInputOptions {
  canOpen?: () => boolean;
}

function storageGet(storage: Storage, key: string): string {
  try {
    return storage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function storageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be disabled in private contexts; the in-memory id still works.
  }
}

function randomId(prefix: string, groups: number): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(groups * 4);
  crypto.getRandomValues(bytes);
  const parts: string[] = [];
  for (let group = 0; group < groups; group++) {
    let part = '';
    for (let i = 0; i < 4; i++) part += alphabet[bytes[group * 4 + i] % alphabet.length];
    parts.push(part);
  }
  return `${prefix}-${parts.join('-')}`;
}

function cleanNetGen(value: string): string {
  let clean = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  if (clean && !clean.startsWith('NET-')) clean = `NET-${clean}`;
  return /^NET-[A-Z0-9-]{4,28}$/.test(clean) ? clean : '';
}

function consumeNetSphereKeyboardEvent(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function consumeNetSphereClipboardEvent(e: ClipboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function consumeNetSphereWheelEvent(e: WheelEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function maxChatScroll(): number {
  return Math.max(0, runtime.chat.length - 1);
}

function setChatScroll(value: number): void {
  runtime.chatScroll = Math.max(0, Math.min(maxChatScroll(), Math.floor(value)));
}

function adjustChatScroll(delta: number): void {
  setChatScroll(runtime.chatScroll + delta);
}

function ensureIdentity(): void {
  if (!runtime.netGen) {
    runtime.netGen = cleanNetGen(storageGet(localStorage, NET_GEN_KEY)) || randomId('NET', 3);
    storageSet(localStorage, NET_GEN_KEY, runtime.netGen);
  }
  if (!runtime.sessionId) {
    runtime.sessionId = storageGet(sessionStorage, SESSION_KEY) || randomId('SES', 3);
    storageSet(sessionStorage, SESSION_KEY, runtime.sessionId);
  }
}

function cleanOutgoingText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DRAFT_LIMIT);
}

function looksLikeNetGen(value: string): boolean {
  const clean = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  return NET_GEN_NICK_RE.test(clean);
}

function cleanNickname(value: string): string {
  const clean = value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return looksLikeNetGen(clean) ? '' : clean;
}

function cleanMarketEventKey(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);
}

function cleanMarketCorpId(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 64);
  return /^[a-z0-9][a-z0-9:_-]{0,63}$/.test(clean) ? clean : '';
}

function cleanMarketKind(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 32);
  return /^[a-z][a-z0-9:_-]{0,31}$/.test(clean) ? clean : '';
}

function cleanMarketMagnitude(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const bounded = Math.max(-100, Math.min(100, value));
  return Math.round(bounded * 100) / 100;
}

function normalizeMarketImpulse(impulse: NetMarketImpulse): NetMarketImpulse | null {
  const eventKey = cleanMarketEventKey(impulse.eventKey);
  const corpId = cleanMarketCorpId(impulse.corpId);
  const kind = cleanMarketKind(impulse.kind);
  const magnitude = cleanMarketMagnitude(impulse.magnitude);
  if (!eventKey || !corpId || !kind || magnitude === null) return null;
  return { eventKey, corpId, kind, magnitude };
}

function normalizeMarketImpulses(impulses: readonly NetMarketImpulse[]): NetMarketImpulse[] {
  const clean: NetMarketImpulse[] = [];
  for (const impulse of impulses) {
    const normalized = normalizeMarketImpulse(impulse);
    if (!normalized) continue;
    const prefix = `${runtime.netGen}:`;
    clean.push({
      ...normalized,
      eventKey: normalized.eventKey.startsWith(prefix) ? normalized.eventKey : `${prefix}${normalized.eventKey}`,
    });
    if (clean.length >= MARKET_IMPULSE_LIMIT) break;
  }
  return clean;
}

function normalizeMarketSnapshot(value: unknown): NetMarketSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { rows?: unknown; updatedAt?: unknown };
  if (!Array.isArray(input.rows)) return null;
  const rows: NetMarketQuote[] = [];
  for (const row of input.rows) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Partial<NetMarketQuote>;
    if (
      typeof data.corpId !== 'string' ||
      typeof data.price !== 'number' ||
      typeof data.lastDelta !== 'number' ||
      typeof data.volume !== 'number' ||
      typeof data.updatedAt !== 'number'
    ) {
      continue;
    }
    const corpId = cleanMarketCorpId(data.corpId);
    if (!corpId) continue;
    rows.push({
      corpId,
      price: Math.max(1, Math.min(99999, data.price)),
      lastDelta: Math.max(-99999, Math.min(99999, data.lastDelta)),
      volume: Math.max(0, Math.min(1_000_000_000, data.volume)),
      updatedAt: Math.max(0, Math.floor(data.updatedAt)),
    });
  }
  return {
    rows,
    updatedAt: typeof input.updatedAt === 'number'
      ? Math.max(0, Math.floor(input.updatedAt))
      : rows.reduce((best, row) => Math.max(best, row.updatedAt), 0),
  };
}

function printableKey(key: string): string {
  if (key.length !== 1) return '';
  if (/[\u0000-\u001f\u007f<>`\\]/.test(key)) return '';
  return key;
}

function statusText(status: NetSphereStatus): string {
  if (status === 'online') return 'СВЯЗЬ ЕСТЬ';
  if (status === 'syncing') return 'ПАКЕТ В ПУТИ';
  if (status === 'offline') return 'OFFLINE';
  return 'КАНАЛ ЗАКРЫТ';
}

function netFailureText(err: unknown, channel: NetSphereChannel): string {
  const market = channel === 'market' || channel === 'market_post';
  const marketOffline = 'Маркет offline. Игра локальна.';
  if (err instanceof NetSphereApiError) {
    if (err.status === 429) return 'Слишком часто. Пакет не принят.';
    if (err.status === 404 || err.status === 502) {
      return market
        ? marketOffline
        : `API offline (${err.status}). Игра локальна.`;
    }
    if (err.status === 503) {
      return market
        ? marketOffline
        : 'Cloudflare 503: база не привязана. Игра локальна.';
    }
    if (err.status >= 500) {
      return market
        ? marketOffline
        : `Сервер ${err.status}. Канал offline, игра локальна.`;
    }
    if (channel === 'chat') return 'Сообщение не доставлено: пакет битый.';
    if (channel === 'event') return 'Событие не принято: пакет битый.';
    return 'Пакет не принят. Проверь НЕТ-ГЕН.';
  }
  if (channel === 'chat') return 'Сообщение не доставлено: маршрут ушёл в самосбор.';
  if (market) return marketOffline;
  if (channel === 'event') return 'Событие не доставлено: сервер слышит сирену.';
  return 'Канал offline. Игра локальна.';
}

function progressFromState(state: GameState, player: Entity): NetSphereProgress {
  const totalMinutes = Math.floor(state.clock.totalMinutes);
  const run = ensureFloorRunState(state);
  const entry = currentFloorRunEntry(state);
  return {
    floorId: state.currentFloor,
    nickname: cleanNickname(player.name ?? '') || 'Жилец',
    floorName: FLOOR_NAMES[state.currentFloor] ?? `Этаж ${state.currentFloor}`,
    runSeed: run.runSeed,
    routeId: floorRunEntryRouteId(entry),
    floorZ: entry.z,
    samosborCount: state.samosborCount,
    level: Math.max(1, Math.floor(player.rpg?.level ?? 1)),
    xp: Math.max(0, Math.floor(player.rpg?.xp ?? 0)),
    hp: Math.max(0, Math.floor(player.hp ?? 0)),
    maxHp: Math.max(1, Math.floor(player.maxHp ?? 100)),
    alive: player.alive,
    gameOver: state.gameOver,
    gameTime: Math.max(0, Math.floor(state.time)),
    day: Math.max(0, Math.floor(totalMinutes / 1440)),
    hour: state.clock.hour,
    minute: state.clock.minute,
  };
}

function applyServerPayload(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const data = payload as {
    stats?: NetSphereStats;
    profile?: NetSphereProfile | null;
    market?: NetMarketSnapshot | null;
    chat?: Partial<NetSphereChatLine>[];
    events?: NetSphereEventLine[];
  };
  if (data.stats) runtime.stats = data.stats;
  if (data.profile !== undefined) {
    runtime.profile = data.profile
      ? { ...data.profile, nickname: cleanNickname(data.profile.nickname) || 'Жилец' }
      : data.profile;
  }
  if (data.market !== undefined) {
    runtime.market = normalizeMarketSnapshot(data.market);
  }
  if (Array.isArray(data.chat)) {
    let added = 0;
    for (const line of data.chat) {
      if (!line || typeof line.id !== 'number' || typeof line.body !== 'string') continue;
      if (runtime.chat.some(existing => existing.id === line.id)) continue;
      runtime.chat.push({
        id: line.id,
        nickname: typeof line.nickname === 'string' ? cleanNickname(line.nickname) || 'Жилец' : 'Жилец',
        body: line.body,
        createdAt: typeof line.createdAt === 'number' ? line.createdAt : 0,
      });
      runtime.lastChatId = Math.max(runtime.lastChatId, line.id);
      added++;
    }
    if (added > 0) {
      if (runtime.chatScroll > 0) {
        runtime.chatScroll += added;
      }
      if (runtime.chat.length > CHAT_LIMIT) {
        const removed = runtime.chat.length - CHAT_LIMIT;
        runtime.chat.splice(0, removed);
      }
      setChatScroll(runtime.chatScroll);
    }
  }
  if (Array.isArray(data.events)) {
    runtime.events = data.events
      .filter(line => line && typeof line.eventKey === 'string' && typeof line.summary === 'string')
      .map(line => ({ ...line, nickname: cleanNickname(line.nickname) || 'Жилец' }))
      .slice(0, 20);
  }
}

function isServerPayload(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true;
}

function serverErrorMessage(data: unknown, fallback: string): string {
  return data && typeof data === 'object' && 'error' in data ? String(data.error) : fallback;
}

function sendFailureKeepsConnection(err: unknown): boolean {
  return err instanceof NetSphereApiError && err.status >= 400 && err.status < 500 && err.status !== 404;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (typeof AbortController === 'undefined') return fetch(input, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NET_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetchWithTimeout(`${API_ROOT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new NetSphereApiError(serverErrorMessage(data, `HTTP ${res.status}`), res.status);
  }
  if (!isServerPayload(data)) throw new NetSphereApiError('пустой пакет', 502);
  return data;
}

async function heartbeat(state: GameState, player: Entity): Promise<void> {
  if (runtime.busy) return;
  runtime.busy = true;
  runtime.status = runtime.stats ? 'online' : 'syncing';
  runtime.error = '';
  try {
    const data = await postJson('/hello', {
      netGen: runtime.netGen,
      sessionId: runtime.sessionId,
      progress: progressFromState(state, player),
      sinceChatId: runtime.lastChatId,
    });
    applyServerPayload(data);
    runtime.status = 'online';
    runtime.nextHeartbeatAt = performance.now() + HEARTBEAT_MS;
  } catch (err) {
    runtime.status = 'offline';
    runtime.error = netFailureText(err, 'heartbeat');
    runtime.nextHeartbeatAt = performance.now() + 10_000;
  } finally {
    runtime.busy = false;
  }
}

async function pollOpenStats(): Promise<void> {
  if (runtime.busy) return;
  runtime.busy = true;
  runtime.status = runtime.stats ? 'online' : 'syncing';
  runtime.error = '';
  try {
    const query = new URLSearchParams({
      netGen: runtime.netGen,
      sinceChatId: String(runtime.lastChatId),
    });
    const res = await fetchWithTimeout(`${API_ROOT}/stats?${query.toString()}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new NetSphereApiError(serverErrorMessage(data, `HTTP ${res.status}`), res.status);
    }
    if (!isServerPayload(data)) throw new NetSphereApiError('пустой пакет', 502);
    applyServerPayload(data);
    runtime.status = 'online';
    runtime.nextPollAt = performance.now() + OPEN_POLL_MS;
  } catch (err) {
    runtime.status = 'offline';
    runtime.error = netFailureText(err, 'stats');
    runtime.nextPollAt = performance.now() + 10_000;
  } finally {
    runtime.busy = false;
  }
}

async function pollMarketSnapshot(): Promise<void> {
  if (runtime.marketBusy) return;
  runtime.marketBusy = true;
  try {
    const res = await fetchWithTimeout(`${API_ROOT}/market`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new NetSphereApiError(serverErrorMessage(data, `HTTP ${res.status}`), res.status);
    }
    if (!isServerPayload(data)) throw new NetSphereApiError('пустой пакет', 502);
    applyServerPayload(data);
    runtime.status = 'online';
    runtime.nextMarketPollAt = performance.now() + MARKET_POLL_MS;
  } catch (err) {
    runtime.status = 'offline';
    if (!runtime.error || runtime.error.startsWith('Маркет')) runtime.error = netFailureText(err, 'market');
    runtime.nextMarketPollAt = performance.now() + 10_000;
  } finally {
    runtime.marketBusy = false;
  }
}

async function postMarketImpulses(impulses: readonly NetMarketImpulse[], progress: NetSphereProgress): Promise<void> {
  if (runtime.marketBusy) return;
  const cleanImpulses = normalizeMarketImpulses(impulses);
  if (cleanImpulses.length === 0) return;
  runtime.marketBusy = true;
  try {
    const data = await postJson('/market', {
      netGen: runtime.netGen,
      sessionId: runtime.sessionId,
      progress,
      impulses: cleanImpulses,
    });
    applyServerPayload(data);
    runtime.status = 'online';
    runtime.nextMarketPollAt = performance.now() + MARKET_POLL_MS;
  } catch (err) {
    runtime.status = 'offline';
    if (!runtime.error || runtime.error.startsWith('Маркет')) runtime.error = netFailureText(err, 'market_post');
  } finally {
    runtime.marketBusy = false;
  }
}

async function sendChat(body: string): Promise<void> {
  const clean = cleanOutgoingText(body);
  if (!clean || runtime.chatBusy) return;
  runtime.chatBusy = true;
  runtime.error = '';
  try {
    const data = await postJson('/chat', {
      netGen: runtime.netGen,
      sessionId: runtime.sessionId,
      body: clean,
      progress: runtime.lastProgress,
      sinceChatId: runtime.lastChatId,
    });
    applyServerPayload(data);
    runtime.status = 'online';
  } catch (err) {
    if (!sendFailureKeepsConnection(err)) runtime.status = 'offline';
    else if (runtime.stats || runtime.profile) runtime.status = 'online';
    runtime.error = netFailureText(err, 'chat');
  } finally {
    runtime.chatBusy = false;
  }
}

function submitDraft(): void {
  const draft = runtime.draft.trim();
  runtime.draft = '';
  if (!draft) return;
  if (draft.startsWith('/')) {
    const [command, ...parts] = draft.split(/\s+/);
    const arg = parts.join(' ');
    if (command === '/netgen' || command === '/ген') {
      const next = cleanNetGen(arg);
      if (!next) {
        runtime.error = 'НЕТ-ГЕН: нужен NET-XXXX-XXXX-XXXX';
        return;
      }
      runtime.netGen = next;
      runtime.profile = null;
      runtime.chat = [];
      runtime.events = [];
      runtime.chatScroll = 0;
      runtime.lastChatId = 0;
      storageSet(localStorage, NET_GEN_KEY, runtime.netGen);
      runtime.nextHeartbeatAt = 0;
      runtime.nextPollAt = 0;
      return;
    }
    if (command === '/new') {
      runtime.netGen = randomId('NET', 3);
      runtime.profile = null;
      runtime.chat = [];
      runtime.events = [];
      runtime.chatScroll = 0;
      runtime.lastChatId = 0;
      storageSet(localStorage, NET_GEN_KEY, runtime.netGen);
      runtime.nextHeartbeatAt = 0;
      runtime.nextPollAt = 0;
      return;
    }
    if (command === '/clear') {
      runtime.chat = [];
      runtime.chatScroll = 0;
      runtime.lastChatId = 0;
      return;
    }
    runtime.error = 'Команды: /netgen, /new, /clear';
    return;
  }
  void sendChat(draft);
}

export function bindNetSphereInput(options: NetSphereInputOptions = {}): () => void {
  if (!portalAllowsOptionalNetwork()) return () => {};
  if (runtime.bound && inputUnbind) return inputUnbind;
  runtime.bound = true;
  ensureIdentity();

  const onDown = (e: KeyboardEvent) => {
    if (!runtime.open) {
      if (
        !getControlCaptureAction() &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        matchesControlAction('netSphere', e.code) &&
        options.canOpen?.() !== false
      ) {
        openNetSphere();
        consumeNetSphereKeyboardEvent(e);
      }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (matchesControlAction('netSphere', e.code) && !runtime.chatInputActive) {
      closeNetSphere();
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (matchesControlAction('netClose', e.code)) {
      closeNetSphere();
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (matchesControlAction('netSubmit', e.code)) {
      if (runtime.chatInputActive) {
        submitDraft();
        runtime.chatScroll = 0;
        runtime.chatInputActive = false;
      } else {
        runtime.chatInputActive = true;
      }
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (matchesControlAction('netErase', e.code)) {
      if (runtime.chatInputActive) {
        runtime.draft = runtime.draft.slice(0, -1);
        consumeNetSphereKeyboardEvent(e);
      }
      return;
    }
    if (e.code === 'PageUp') {
      adjustChatScroll(8);
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (e.code === 'PageDown') {
      adjustChatScroll(-8);
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (e.code === 'ArrowUp') {
      adjustChatScroll(1);
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (e.code === 'ArrowDown') {
      adjustChatScroll(-1);
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (e.code === 'Home') {
      setChatScroll(maxChatScroll());
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    if (e.code === 'End') {
      runtime.chatScroll = 0;
      consumeNetSphereKeyboardEvent(e);
      return;
    }
    const char = printableKey(e.key);
    if (runtime.chatInputActive && char && runtime.draft.length < DRAFT_LIMIT) {
      runtime.draft += char;
      consumeNetSphereKeyboardEvent(e);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!runtime.open || !runtime.chatInputActive) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    runtime.draft = (runtime.draft + cleanOutgoingText(text)).slice(0, DRAFT_LIMIT);
    consumeNetSphereClipboardEvent(e);
  };

  const onWheel = (e: WheelEvent) => {
    if (!runtime.open) return;
    const dy = Number(e.deltaY);
    if (!Number.isFinite(dy) || dy === 0) {
      consumeNetSphereWheelEvent(e);
      return;
    }
    const step = Math.max(1, Math.min(8, Math.ceil(Math.abs(dy) / 80)));
    adjustChatScroll(dy < 0 ? step : -step);
    consumeNetSphereWheelEvent(e);
  };

  document.addEventListener('keydown', onDown, NET_SPHERE_INPUT_LISTENER_OPTIONS);
  document.addEventListener('paste', onPaste, NET_SPHERE_INPUT_LISTENER_OPTIONS);
  document.addEventListener('wheel', onWheel, NET_SPHERE_WHEEL_LISTENER_OPTIONS);
  inputUnbind = () => {
    if (!runtime.bound) return;
    runtime.bound = false;
    inputUnbind = null;
    document.removeEventListener('keydown', onDown, NET_SPHERE_INPUT_LISTENER_OPTIONS);
    document.removeEventListener('paste', onPaste, NET_SPHERE_INPUT_LISTENER_OPTIONS);
    document.removeEventListener('wheel', onWheel, NET_SPHERE_WHEEL_LISTENER_OPTIONS);
  };
  return inputUnbind;
}

export function isNetSphereOpen(): boolean {
  return runtime.open;
}

export function isNetSphereChatInputActive(): boolean {
  return runtime.open && runtime.chatInputActive;
}

export function openNetSphere(): void {
  if (!portalAllowsOptionalNetwork()) return;
  ensureIdentity();
  runtime.open = true;
  runtime.chatInputActive = false;
  runtime.chatScroll = 0;
  runtime.nextPollAt = 0;
  runtime.error = '';
}

export function closeNetSphere(): void {
  runtime.open = false;
  runtime.chatInputActive = false;
}

export function tickNetSphere(state: GameState, player: Entity): void {
  if (!portalAllowsOptionalNetwork()) return;
  ensureIdentity();
  runtime.lastProgress = progressFromState(state, player);
  const now = performance.now();
  if (now >= runtime.nextHeartbeatAt) void heartbeat(state, player);
  if (runtime.open && now >= runtime.nextPollAt) void pollOpenStats();
  if (runtime.open && now >= runtime.nextMarketPollAt) void pollMarketSnapshot();
}

export function pollNetMarketSnapshot(): void {
  if (!portalAllowsOptionalNetwork()) return;
  ensureIdentity();
  void pollMarketSnapshot();
}

export function getNetMarketSnapshot(): NetMarketSnapshot | null {
  return runtime.market;
}

export function sendNetMarketImpulses(
  impulses: readonly NetMarketImpulse[],
  state: GameState,
  player: Entity,
): void {
  if (!portalAllowsOptionalNetwork()) return;
  ensureIdentity();
  void postMarketImpulses(impulses, progressFromState(state, player));
}

export function reportNetSphereEvent(
  type: NetSphereEventType,
  eventKey: string,
  state: GameState,
  player: Entity,
): void {
  if (!portalAllowsOptionalNetwork()) return;
  ensureIdentity();
  const payload = {
    netGen: runtime.netGen,
    sessionId: runtime.sessionId,
    type,
    eventKey: `${runtime.netGen}:${eventKey}`,
    progress: progressFromState(state, player),
  };
  void fetchWithTimeout(`${API_ROOT}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).then(async res => {
    const data = await res.json().catch(() => null);
    if (res.ok && isServerPayload(data)) {
      applyServerPayload(data);
      runtime.status = 'online';
      runtime.error = '';
    } else if (data && typeof data === 'object' && 'error' in data) {
      if (res.status >= 500) runtime.status = 'offline';
      runtime.error = netFailureText(new NetSphereApiError(serverErrorMessage(data, `HTTP ${res.status}`), res.status), 'event');
    }
  }).catch(() => {
    runtime.status = 'offline';
    runtime.error = netFailureText(null, 'event');
  });
}

export function getNetSphereSnapshot(): NetSphereSnapshot {
  if (!portalAllowsOptionalNetwork()) {
    return {
      open: false,
      netGen: '',
      sessionId: '',
      nickname: 'Жилец',
      status: 'idle',
      statusText: statusText('idle'),
      error: '',
      stats: null,
      profile: null,
      market: null,
      chat: [],
      events: [],
      draft: '',
      chatInputActive: false,
      chatScroll: 0,
      busy: false,
    };
  }
  ensureIdentity();
  const nickname = cleanNickname(runtime.profile?.nickname ?? '') || cleanNickname(runtime.lastProgress?.nickname ?? '') || 'Жилец';
  return {
    open: runtime.open,
    netGen: runtime.netGen,
    sessionId: runtime.sessionId,
    nickname,
    status: runtime.status,
    statusText: statusText(runtime.status),
    error: runtime.error,
    stats: runtime.stats,
    profile: runtime.profile,
    market: runtime.market,
    chat: runtime.chat,
    events: runtime.events,
    draft: runtime.draft,
    chatInputActive: runtime.chatInputActive,
    chatScroll: runtime.chatScroll,
    busy: runtime.busy || runtime.chatBusy || runtime.marketBusy,
    currentRunSeed: runtime.lastProgress?.runSeed,
  };
}

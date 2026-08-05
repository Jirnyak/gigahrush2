export interface D1Result {
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  GIGA_NET?: D1Database;
}

export interface PagesContext {
  request: Request;
  env: Env;
}

export interface ProgressPayload {
  floorId: number;
  nickname: string;
  floorName: string;
  runSeed?: number;
  routeId?: string;
  floorZ?: number;
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

export interface MarketImpulsePayload {
  eventKey: string;
  corpId: string;
  kind: string;
  magnitude: number;
}

export interface MarketSnapshotRow {
  corpId: string;
  price: number;
  lastDelta: number;
  volume: number;
  updatedAt: number;
}

export interface MarketSnapshotPayload {
  rows: MarketSnapshotRow[];
  updatedAt: number;
}

const ONLINE_WINDOW_MS = 90_000;
const NET_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MARKET_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const CHAT_LIMIT = 300;
const JSON_BODY_LIMIT_BYTES = 4096;
const NET_GEN_NICK_RE = /^NET-[A-Z0-9-]{4,28}$/;
const MARKET_MAX_IMPULSES = 16;
const MARKET_MAX_ROWS = 64;
const MARKET_MAX_MAGNITUDE = 100;
const MAX_PUBLIC_ID = 2_147_483_647;
let lastPruneAttemptAt = 0;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function cleanErrorText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'bad request';
}

export function apiError(error: string, status = 400): Response {
  return json({ ok: false, error: cleanErrorText(error) }, status);
}

export function handleApiError(err: unknown): Response {
  if (err instanceof ApiError) return apiError(err.message, err.status);
  return apiError('database error', 500);
}

export function requireMethod(request: Request, method: string): Response | null {
  return request.method === method ? null : apiError('method not allowed', 405);
}

export function badRequest(message: string): never {
  throw new ApiError(message, 400);
}

export function requireDb(env: Env): D1Database | Response {
  if (!env.GIGA_NET) return apiError('D1 binding GIGA_NET is not configured', 503);
  return env.GIGA_NET;
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > JSON_BODY_LIMIT_BYTES) {
    badRequest('payload too large');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > JSON_BODY_LIMIT_BYTES) badRequest('payload too large');
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError('malformed json', 400);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError('bad request', 400);
  }
  return data as Record<string, unknown>;
}

export function cleanNetGen(value: unknown): string {
  if (typeof value !== 'string') return '';
  let clean = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  if (clean && !clean.startsWith('NET-')) clean = `NET-${clean}`;
  return /^NET-[A-Z0-9-]{4,28}$/.test(clean) ? clean : '';
}

export function cleanSessionId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  return /^SES-[A-Z0-9-]{4,28}$/.test(clean) ? clean : '';
}

export function cleanMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function cleanPublicText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function looksLikeNetGen(value: string): boolean {
  const clean = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  return NET_GEN_NICK_RE.test(clean);
}

export function cleanNickname(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return looksLikeNetGen(clean) ? '' : clean;
}

export function cleanEventType(value: unknown): 'samosbor' | 'death' | '' {
  return value === 'samosbor' || value === 'death' ? value : '';
}

export function cleanEventKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);
}

export function cleanMarketCorpId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 64);
  return /^[a-z0-9][a-z0-9:_-]{0,63}$/.test(clean) ? clean : '';
}

export function cleanMarketKind(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 32);
  return /^[a-z][a-z0-9:_-]{0,31}$/.test(clean) ? clean : '';
}

function cleanMarketMagnitude(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const bounded = Math.max(-MARKET_MAX_MAGNITUDE, Math.min(MARKET_MAX_MAGNITUDE, value));
  return Math.round(bounded * 100) / 100;
}

export function normalizeMarketImpulses(value: unknown): MarketImpulsePayload[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) badRequest('bad market impulses');
  if (value.length > MARKET_MAX_IMPULSES) badRequest('too many market impulses');
  const impulses: MarketImpulsePayload[] = [];
  for (const item of value) {
    const input = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const eventKey = cleanEventKey(input.eventKey);
    const corpId = cleanMarketCorpId(input.corpId);
    const kind = cleanMarketKind(input.kind);
    const magnitude = cleanMarketMagnitude(input.magnitude);
    if (!eventKey || !corpId || !kind || magnitude === null) badRequest('bad market impulse');
    impulses.push({ eventKey, corpId, kind, magnitude });
  }
  return impulses;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function boundedFloat(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function publicNickname(value: unknown): string {
  return cleanNickname(value) || 'Жилец';
}

function cleanRouteId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);
}

function eventDate(value: unknown): string {
  const now = typeof value === 'number' ? value : 0;
  return new Date(now).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function two(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

function progressFromStoredPayload(value: unknown): ProgressPayload | null {
  if (typeof value !== 'string' || value.length <= 2) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('floorName' in parsed) && !('day' in parsed) && !('hour' in parsed)) return null;
    return normalizeProgress(parsed);
  } catch {
    return null;
  }
}

function progressSignal(progress: ProgressPayload | null, createdAt: unknown): string {
  if (!progress) return eventDate(createdAt);
  const floor = progress.floorName || `этаж ${progress.floorId}`;
  return `${floor}, д${progress.day} ${two(progress.hour)}:${two(progress.minute)}`;
}

function cleanPublicEventIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);
}

function publicEventKeyHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

function publicEventId(row: Record<string, unknown>): string {
  const id = Number(row.id);
  if (Number.isSafeInteger(id) && id > 0) return `event:${id}`;

  const eventKey = cleanEventKey(row.event_key);
  if (eventKey) {
    const withoutNetGen = eventKey
      .replace(/^NET-[A-Z0-9-]{4,28}:/i, '')
      .replace(/NET-[A-Z0-9-]{4,28}/gi, 'NET');
    const publicPart = cleanPublicEventIdPart(withoutNetGen);
    const hash = publicEventKeyHash(eventKey);
    if (publicPart) return `event:${publicPart}:${hash}`;
    return `event:${hash}`;
  }

  return `${num(row.created_at, 0, 0, 9_999_999_999_999)}:${cleanEventType(row.type) || 'samosbor'}`;
}

export function netEventSummary(
  type: unknown,
  nickname: unknown,
  createdAt: unknown,
  progress?: ProgressPayload | null,
): string {
  const name = publicNickname(nickname);
  const signal = progressSignal(progress ?? null, createdAt);
  if (type === 'death') return `${name} умер. Последний сигнал: ${signal}.`;
  return `${name}: самосбор. Сигнал: ${signal}.`;
}

export function normalizeProgress(value: unknown): ProgressPayload {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const floorName = typeof input.floorName === 'string'
    ? input.floorName.replace(/[\u0000-\u001f\u007f<>`\\]/g, '').slice(0, 64)
    : '';
  const routeId = cleanRouteId(input.routeId);
  const runSeed = input.runSeed === undefined ? undefined : num(input.runSeed, 0, 0, 0x7fffffff);
  const floorZ = input.floorZ === undefined ? undefined : num(input.floorZ, 0, -50, 50);
  return {
    floorId: num(input.floorId, 2, 0, 999),
    nickname: cleanNickname(input.nickname),
    floorName,
    runSeed,
    routeId: routeId || undefined,
    floorZ,
    samosborCount: num(input.samosborCount, 0, 0, 1_000_000),
    level: num(input.level, 1, 1, 999),
    xp: num(input.xp, 0, 0, 2_000_000_000),
    hp: num(input.hp, 0, 0, 1_000_000),
    maxHp: num(input.maxHp, 100, 1, 1_000_000),
    alive: input.alive === true,
    gameOver: input.gameOver === true,
    gameTime: num(input.gameTime, 0, 0, 2_000_000_000),
    day: num(input.day, 0, 0, 1_000_000),
    hour: num(input.hour, 0, 0, 23),
    minute: num(input.minute, 0, 0, 59),
  };
}

async function runPrune(db: D1Database, query: string, cutoff: number): Promise<void> {
  try {
    await db.prepare(query).bind(cutoff).run();
  } catch {
    // Optional cleanup must never take Net Sphere offline.
  }
}

export async function maybePruneNetStorage(db: D1Database, now: number): Promise<void> {
  if (
    lastPruneAttemptAt > 0 &&
    now >= lastPruneAttemptAt &&
    now - lastPruneAttemptAt < NET_PRUNE_INTERVAL_MS
  ) {
    return;
  }
  lastPruneAttemptAt = now;
  await Promise.all([
    runPrune(db, 'DELETE FROM net_sessions WHERE last_seen_at < ?', now - SESSION_RETENTION_MS),
    runPrune(db, 'DELETE FROM net_events WHERE created_at < ?', now - EVENT_RETENTION_MS),
    runPrune(db, 'DELETE FROM net_market_impulses WHERE created_at < ?', now - MARKET_RETENTION_MS),
    runPrune(db, 'DELETE FROM net_market_budgets WHERE updated_at < ?', now - MARKET_RETENTION_MS),
  ]);
}

export async function upsertPresence(
  db: D1Database,
  netGen: string,
  sessionId: string,
  progress: ProgressPayload,
  now: number,
): Promise<void> {
  const existingSession = await db
    .prepare('SELECT session_id FROM net_sessions WHERE session_id = ?')
    .bind(sessionId)
    .first<{ session_id: string }>();

  await db.prepare(`
    INSERT INTO net_players (
      net_gen, nickname, created_at, last_seen_at, runs, total_samosbors, deaths,
      best_level, best_samosbor_count, last_floor, progress_json
    )
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)
    ON CONFLICT(net_gen) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE nickname END,
      last_seen_at = excluded.last_seen_at,
      best_level = max(best_level, excluded.best_level),
      best_samosbor_count = max(best_samosbor_count, excluded.best_samosbor_count),
      last_floor = CASE WHEN excluded.last_floor != '' THEN excluded.last_floor ELSE last_floor END,
      progress_json = excluded.progress_json
  `).bind(
    netGen,
    progress.nickname,
    now,
    now,
    progress.level,
    progress.samosborCount,
    progress.floorName,
    JSON.stringify(progress),
  ).run();

  await db.prepare(`
    INSERT INTO net_sessions (session_id, net_gen, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      net_gen = excluded.net_gen,
      last_seen_at = excluded.last_seen_at
  `).bind(sessionId, netGen, now).run();

  if (!existingSession) {
    await db.prepare('UPDATE net_players SET runs = runs + 1 WHERE net_gen = ?').bind(netGen).run();
  }
  await maybePruneNetStorage(db, now);
}

export async function readStats(db: D1Database, now: number): Promise<Record<string, number>> {
  const online = await db
    .prepare('SELECT COUNT(*) AS value FROM net_sessions WHERE last_seen_at >= ?')
    .bind(now - ONLINE_WINDOW_MS)
    .first<{ value: number }>();
  const players = await db.prepare('SELECT COUNT(*) AS value FROM net_players').first<{ value: number }>();
  const samosbors = await db
    .prepare('SELECT COALESCE(SUM(total_samosbors), 0) AS value FROM net_players')
    .first<{ value: number }>();
  const deaths = await db
    .prepare('SELECT COALESCE(SUM(deaths), 0) AS value FROM net_players')
    .first<{ value: number }>();
  return {
    onlineUsers: num(online?.value, 0, 0, 1_000_000_000),
    totalPlayers: num(players?.value, 0, 0, 1_000_000_000),
    totalSamosbors: num(samosbors?.value, 0, 0, 1_000_000_000),
    totalDeaths: num(deaths?.value, 0, 0, 1_000_000_000),
    updatedAt: now,
  };
}

export async function readProfile(db: D1Database, netGen: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`
    SELECT net_gen, nickname, created_at, last_seen_at, runs, total_samosbors, deaths,
           best_level, best_samosbor_count, last_floor, progress_json
    FROM net_players
    WHERE net_gen = ?
  `).bind(netGen).first<Record<string, unknown>>();
  if (!row) return null;
  const progress = progressFromStoredPayload(row.progress_json);
  return {
    netGen: cleanNetGen(row.net_gen),
    nickname: publicNickname(row.nickname),
    createdAt: num(row.created_at, 0, 0, 9_999_999_999_999),
    lastSeenAt: num(row.last_seen_at, 0, 0, 9_999_999_999_999),
    runs: num(row.runs, 0, 0, 1_000_000_000),
    totalSamosbors: num(row.total_samosbors, 0, 0, 1_000_000_000),
    deaths: num(row.deaths, 0, 0, 1_000_000_000),
    bestLevel: num(row.best_level, 1, 1, 999),
    bestSamosborCount: num(row.best_samosbor_count, 0, 0, 1_000_000),
    lastFloor: cleanPublicText(row.last_floor, 64),
    runSeed: progress?.runSeed,
    routeId: progress?.routeId,
    floorZ: progress?.floorZ,
  };
}

export async function readEvents(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`
    SELECT rowid AS id, event_key, nickname, type, summary, created_at, payload_json
    FROM net_events
    ORDER BY created_at DESC, rowid DESC
    LIMIT 20
  `).all<Record<string, unknown>>();
  return (result.results ?? []).map(row => {
    const nickname = publicNickname(row.nickname);
    const type = cleanEventType(row.type) || 'samosbor';
    const createdAt = num(row.created_at, 0, 0, 9_999_999_999_999);
    return {
      eventKey: publicEventId(row),
      nickname,
      type,
      summary: netEventSummary(type, nickname, createdAt, progressFromStoredPayload(row.payload_json)),
      createdAt,
    };
  });
}

export async function readChat(db: D1Database, sinceChatId: number): Promise<Record<string, unknown>[]> {
  const since = Number.isFinite(sinceChatId) ? Math.max(0, Math.floor(sinceChatId)) : 0;
  const result = await db.prepare(`
    SELECT c.id, COALESCE(NULLIF(p.nickname, ''), 'Жилец') AS nickname, c.body, c.created_at
    FROM net_chat c
    LEFT JOIN net_players p ON p.net_gen = c.net_gen
    WHERE c.id > ?
    ORDER BY c.id DESC
    LIMIT ?
  `).bind(since, CHAT_LIMIT).all<Record<string, unknown>>();
  return (result.results ?? []).reverse().map(row => ({
    id: num(row.id, 0, 0, MAX_PUBLIC_ID),
    nickname: publicNickname(row.nickname),
    body: cleanMessage(row.body),
    createdAt: num(row.created_at, 0, 0, 9_999_999_999_999),
  }));
}

export function sinceChatIdFromValue(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  let id: number;
  if (typeof value === 'number') {
    id = value;
  } else if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    id = Number(value);
  } else {
    badRequest('bad sinceChatId');
  }
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_PUBLIC_ID) badRequest('bad sinceChatId');
  return id;
}

export function sinceChatIdFromUrl(request: Request): number {
  return sinceChatIdFromValue(new URL(request.url).searchParams.get('sinceChatId'), 0);
}

export async function readMarketSnapshot(db: D1Database, limit = MARKET_MAX_ROWS): Promise<MarketSnapshotPayload> {
  const boundedLimit = Math.max(1, Math.min(MARKET_MAX_ROWS, Math.floor(limit)));
  const result = await db.prepare(`
    SELECT corp_id, price, last_delta, volume, updated_at
    FROM net_market_snapshots
    ORDER BY updated_at DESC, corp_id ASC
    LIMIT ?
  `).bind(boundedLimit).all<Record<string, unknown>>();
  const rows = (result.results ?? [])
    .map(row => {
      const corpId = cleanMarketCorpId(row.corp_id);
      if (!corpId) return null;
      return {
        corpId,
        price: boundedFloat(row.price, 100, 1, 99999),
        lastDelta: boundedFloat(row.last_delta, 0, -99999, 99999),
        volume: boundedFloat(row.volume, 0, 0, 1_000_000_000),
        updatedAt: num(row.updated_at, 0, 0, 9_999_999_999_999),
      };
    })
    .filter((row): row is MarketSnapshotRow => row !== null);
  return {
    rows,
    updatedAt: rows.reduce((best, row) => Math.max(best, row.updatedAt), 0),
  };
}

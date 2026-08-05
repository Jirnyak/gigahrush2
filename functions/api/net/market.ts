import {
  type D1Database,
  type MarketImpulsePayload,
  type PagesContext,
  apiError,
  cleanEventKey,
  cleanNetGen,
  cleanSessionId,
  handleApiError,
  json,
  normalizeMarketImpulses,
  normalizeProgress,
  readBody,
  readMarketSnapshot,
  requireDb,
  requireMethod,
  upsertPresence,
} from './common';

const MARKET_DELTA_SCALE = 0.25;
const MARKET_RATE_WINDOW_MS = 60_000;
const MARKET_RATE_MAX_IMPULSES = 8;
const MARKET_RATE_MAX_MAGNITUDE = 240;
const MARKET_SNAPSHOT_DELTA_CAP = 25;
const MARKET_SNAPSHOT_VOLUME_CAP = MARKET_RATE_MAX_MAGNITUDE;

interface ScopedMarketImpulse {
  impulse: MarketImpulsePayload;
  eventKey: string;
}

interface MarketBudgetResult {
  ok: boolean;
  retryAfterMs: number;
}

interface MarketAggregate {
  delta: number;
  volume: number;
}

function snapshotLimitFromUrl(request: Request): number {
  const raw = new URL(request.url).searchParams.get('limit') ?? '64';
  const limit = Number(raw);
  return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 64;
}

function basePriceForCorp(corpId: string): number {
  let hash = 0;
  for (let i = 0; i < corpId.length; i++) hash = (hash * 33 + corpId.charCodeAt(i)) >>> 0;
  return 80 + (hash % 81);
}

function clampMarketFloat(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value * 100) / 100));
}

function scopedEventKey(netGen: string, eventKey: string): string {
  const prefix = `${netGen}:`;
  return eventKey.startsWith(prefix) ? eventKey : cleanEventKey(`${prefix}${eventKey}`);
}

function impulseDelta(impulse: MarketImpulsePayload): number {
  return clampMarketFloat(impulse.magnitude * MARKET_DELTA_SCALE, -25, 25);
}

function marketBudgetIdentity(netGen: string, sessionId: string): string {
  return `${netGen}:${sessionId}`;
}

function marketBudgetWindow(now: number): number {
  return now - (now % MARKET_RATE_WINDOW_MS);
}

function marketBudgetRetryAfter(now: number): number {
  return Math.max(1, marketBudgetWindow(now) + MARKET_RATE_WINDOW_MS - now);
}

async function newMarketImpulses(
  db: D1Database,
  netGen: string,
  impulses: readonly MarketImpulsePayload[],
): Promise<ScopedMarketImpulse[]> {
  const seen = new Set<string>();
  const pending: ScopedMarketImpulse[] = [];
  for (const impulse of impulses) {
    const eventKey = scopedEventKey(netGen, impulse.eventKey);
    if (!eventKey || seen.has(eventKey)) continue;
    seen.add(eventKey);
    const existing = await db.prepare(`
      SELECT event_key
      FROM net_market_impulses
      WHERE event_key = ?
      LIMIT 1
    `).bind(eventKey).first<{ event_key: string }>();
    if (!existing) pending.push({ impulse, eventKey });
  }
  return pending;
}

async function consumeMarketBudget(
  db: D1Database,
  netGen: string,
  sessionId: string,
  impulses: readonly ScopedMarketImpulse[],
  now: number,
): Promise<MarketBudgetResult> {
  if (impulses.length === 0) return { ok: true, retryAfterMs: 0 };

  const magnitude = clampMarketFloat(
    impulses.reduce((sum, row) => sum + Math.abs(row.impulse.magnitude), 0),
    0,
    1_000_000_000,
  );
  if (impulses.length > MARKET_RATE_MAX_IMPULSES || magnitude > MARKET_RATE_MAX_MAGNITUDE) {
    return { ok: false, retryAfterMs: marketBudgetRetryAfter(now) };
  }

  const result = await db.prepare(`
    INSERT INTO net_market_budgets (
      identity_key, net_gen, session_id, window_started_at, impulse_count, magnitude_sum, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(identity_key) DO UPDATE SET
      net_gen = excluded.net_gen,
      session_id = excluded.session_id,
      window_started_at = excluded.window_started_at,
      impulse_count = CASE
        WHEN net_market_budgets.window_started_at = excluded.window_started_at
          THEN net_market_budgets.impulse_count + excluded.impulse_count
        ELSE excluded.impulse_count
      END,
      magnitude_sum = CASE
        WHEN net_market_budgets.window_started_at = excluded.window_started_at
          THEN round((net_market_budgets.magnitude_sum + excluded.magnitude_sum) * 100) / 100
        ELSE excluded.magnitude_sum
      END,
      updated_at = excluded.updated_at
    WHERE net_market_budgets.window_started_at != excluded.window_started_at
      OR (
        net_market_budgets.impulse_count + excluded.impulse_count <= ?
        AND net_market_budgets.magnitude_sum + excluded.magnitude_sum <= ?
      )
  `).bind(
    marketBudgetIdentity(netGen, sessionId),
    netGen,
    sessionId,
    marketBudgetWindow(now),
    impulses.length,
    magnitude,
    now,
    MARKET_RATE_MAX_IMPULSES,
    MARKET_RATE_MAX_MAGNITUDE,
  ).run();

  return (result.meta?.changes ?? 0) > 0
    ? { ok: true, retryAfterMs: 0 }
    : { ok: false, retryAfterMs: marketBudgetRetryAfter(now) };
}

async function applyMarketImpulses(
  db: D1Database,
  netGen: string,
  impulses: readonly ScopedMarketImpulse[],
  now: number,
): Promise<void> {
  const aggregates = new Map<string, MarketAggregate>();
  for (const { impulse, eventKey } of impulses) {
    const inserted = await db.prepare(`
      INSERT OR IGNORE INTO net_market_impulses (net_gen, corp_id, kind, magnitude, created_at, event_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(netGen, impulse.corpId, impulse.kind, impulse.magnitude, now, eventKey).run();
    if ((inserted.meta?.changes ?? 0) <= 0) continue;

    const delta = impulseDelta(impulse);
    const current = aggregates.get(impulse.corpId) ?? { delta: 0, volume: 0 };
    current.delta = clampMarketFloat(current.delta + delta, -MARKET_SNAPSHOT_DELTA_CAP, MARKET_SNAPSHOT_DELTA_CAP);
    current.volume = clampMarketFloat(current.volume + Math.abs(impulse.magnitude), 0, MARKET_SNAPSHOT_VOLUME_CAP);
    aggregates.set(impulse.corpId, current);
  }

  for (const [corpId, aggregate] of aggregates) {
    const initialPrice = clampMarketFloat(basePriceForCorp(corpId) + aggregate.delta, 1, 99999);
    await db.prepare(`
      INSERT INTO net_market_snapshots (corp_id, price, last_delta, volume, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(corp_id) DO UPDATE SET
        price = min(99999, max(1, round((net_market_snapshots.price + excluded.last_delta) * 100) / 100)),
        last_delta = excluded.last_delta,
        volume = min(1000000000, round((net_market_snapshots.volume + excluded.volume) * 100) / 100),
        updated_at = excluded.updated_at
    `).bind(corpId, initialPrice, aggregate.delta, aggregate.volume, now).run();
  }
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const methodError = requireMethod(context.request, 'GET');
  if (methodError) return methodError;

  const db = requireDb(context.env);
  if (db instanceof Response) return db;

  try {
    const market = await readMarketSnapshot(db, snapshotLimitFromUrl(context.request));
    return json({ ok: true, market });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const methodError = requireMethod(context.request, 'POST');
  if (methodError) return methodError;

  const db = requireDb(context.env);
  if (db instanceof Response) return db;

  try {
    const body = await readBody(context.request);
    const netGen = cleanNetGen(body.netGen);
    const sessionId = cleanSessionId(body.sessionId);
    if (!netGen || !sessionId) return apiError('bad identity', 400);

    const now = Date.now();
    await upsertPresence(db, netGen, sessionId, normalizeProgress(body.progress), now);
    const impulses = normalizeMarketImpulses(body.impulses);
    const pending = await newMarketImpulses(db, netGen, impulses);
    const budget = await consumeMarketBudget(db, netGen, sessionId, pending, now);
    if (!budget.ok) return json({ error: 'market rate limit', retryAfterMs: budget.retryAfterMs }, 429);
    await applyMarketImpulses(db, netGen, pending, now);

    return json({ ok: true, market: await readMarketSnapshot(db, snapshotLimitFromUrl(context.request)) });
  } catch (err) {
    return handleApiError(err);
  }
}

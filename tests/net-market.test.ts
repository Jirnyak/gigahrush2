import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FloorLevel, type GameState } from '../src/core/types';
import {
  applyRemoteStockMarketSnapshot,
  normalizeStockMarketState,
  type StockMarketState,
} from '../src/systems/stock_market';
import { type D1Database, type D1PreparedStatement } from '../functions/api/net/common';
import { onRequestGet as getMarket, onRequestPost as postMarket } from '../functions/api/net/market';
import { makeGameState } from './helpers';

interface PlayerRow {
  net_gen: string;
  nickname: string;
  created_at: number;
  last_seen_at: number;
  runs: number;
  best_level: number;
  best_samosbor_count: number;
  last_floor: string;
  progress_json: string;
}

interface SessionRow {
  session_id: string;
  net_gen: string;
  last_seen_at: number;
}

interface MarketImpulseRow {
  id: number;
  net_gen: string;
  corp_id: string;
  kind: string;
  magnitude: number;
  created_at: number;
  event_key: string;
}

interface MarketSnapshotRow {
  corp_id: string;
  price: number;
  last_delta: number;
  volume: number;
  updated_at: number;
}

interface MarketBudgetRow {
  identity_key: string;
  net_gen: string;
  session_id: string;
  window_started_at: number;
  impulse_count: number;
  magnitude_sum: number;
  updated_at: number;
}

type MarketStateHost = GameState & { stockMarket?: StockMarketState };

class FakeStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.db.first(this.query, this.values) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
    return { results: this.db.all(this.query, this.values) as T[] };
  }

  async run() {
    return this.db.run(this.query, this.values);
  }
}

class FakeD1 implements D1Database {
  players = new Map<string, PlayerRow>();
  sessions = new Map<string, SessionRow>();
  impulses = new Map<string, MarketImpulseRow>();
  budgets = new Map<string, MarketBudgetRow>();
  snapshots = new Map<string, MarketSnapshotRow>();
  nextImpulseId = 1;

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query);
  }

  first(query: string, values: unknown[]): Record<string, unknown> | null {
    if (query.includes('FROM net_sessions WHERE session_id = ?')) {
      return this.sessions.get(String(values[0])) ?? null;
    }
    if (query.includes('FROM net_market_impulses') && query.includes('WHERE event_key = ?')) {
      const eventKey = String(values[0]);
      return this.impulses.has(eventKey) ? { event_key: eventKey } : null;
    }
    throw new Error(`Unhandled fake first query: ${query}`);
  }

  all(query: string, values: unknown[]): Record<string, unknown>[] {
    if (query.includes('FROM net_market_snapshots')) {
      const limit = Number(values[0] ?? 64);
      return [...this.snapshots.values()]
        .sort((a, b) => b.updated_at - a.updated_at || a.corp_id.localeCompare(b.corp_id))
        .slice(0, limit)
        .map(row => ({ ...row }));
    }
    throw new Error(`Unhandled fake all query: ${query}`);
  }

  run(query: string, values: unknown[]) {
    if (query.includes('INSERT INTO net_players')) {
      const netGen = String(values[0]);
      const existing = this.players.get(netGen);
      const nickname = String(values[1]);
      const row: PlayerRow = existing ?? {
        net_gen: netGen,
        nickname,
        created_at: Number(values[2]),
        last_seen_at: Number(values[3]),
        runs: 0,
        best_level: Number(values[4]),
        best_samosbor_count: Number(values[5]),
        last_floor: String(values[6]),
        progress_json: String(values[7]),
      };
      row.nickname = nickname || row.nickname;
      row.last_seen_at = Number(values[3]);
      row.best_level = Math.max(row.best_level, Number(values[4]));
      row.best_samosbor_count = Math.max(row.best_samosbor_count, Number(values[5]));
      row.last_floor = String(values[6]) || row.last_floor;
      row.progress_json = String(values[7]);
      this.players.set(netGen, row);
      return { meta: { changes: 1 } };
    }
    if (query.includes('INSERT INTO net_sessions')) {
      this.sessions.set(String(values[0]), {
        session_id: String(values[0]),
        net_gen: String(values[1]),
        last_seen_at: Number(values[2]),
      });
      return { meta: { changes: 1 } };
    }
    if (query.includes('UPDATE net_players SET runs = runs + 1')) {
      const row = this.players.get(String(values[0]));
      if (row) row.runs += 1;
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (query.includes('INSERT INTO net_market_budgets')) {
      const identityKey = String(values[0]);
      const next: MarketBudgetRow = {
        identity_key: identityKey,
        net_gen: String(values[1]),
        session_id: String(values[2]),
        window_started_at: Number(values[3]),
        impulse_count: Number(values[4]),
        magnitude_sum: Number(values[5]),
        updated_at: Number(values[6]),
      };
      const maxImpulses = Number(values[7]);
      const maxMagnitude = Number(values[8]);
      const existing = this.budgets.get(identityKey);
      if (!existing || existing.window_started_at !== next.window_started_at) {
        if (next.impulse_count > maxImpulses || next.magnitude_sum > maxMagnitude) {
          return { meta: { changes: 0 } };
        }
        this.budgets.set(identityKey, next);
        return { meta: { changes: 1 } };
      }
      if (
        existing.impulse_count + next.impulse_count > maxImpulses ||
        existing.magnitude_sum + next.magnitude_sum > maxMagnitude
      ) {
        return { meta: { changes: 0 } };
      }
      existing.net_gen = next.net_gen;
      existing.session_id = next.session_id;
      existing.impulse_count += next.impulse_count;
      existing.magnitude_sum = Math.round((existing.magnitude_sum + next.magnitude_sum) * 100) / 100;
      existing.updated_at = next.updated_at;
      return { meta: { changes: 1 } };
    }
    if (query.includes('INSERT OR IGNORE INTO net_market_impulses')) {
      const eventKey = String(values[5]);
      if (this.impulses.has(eventKey)) return { meta: { changes: 0 } };
      this.impulses.set(eventKey, {
        id: this.nextImpulseId++,
        net_gen: String(values[0]),
        corp_id: String(values[1]),
        kind: String(values[2]),
        magnitude: Number(values[3]),
        created_at: Number(values[4]),
        event_key: eventKey,
      });
      return { meta: { changes: 1 } };
    }
    if (query.includes('INSERT INTO net_market_snapshots')) {
      const corpId = String(values[0]);
      const existing = this.snapshots.get(corpId);
      const delta = Number(values[2]);
      const volume = Number(values[3]);
      if (existing) {
        existing.price = Math.max(1, Math.min(99999, Math.round((existing.price + delta) * 100) / 100));
        existing.last_delta = delta;
        existing.volume = Math.min(1_000_000_000, Math.round((existing.volume + volume) * 100) / 100);
        existing.updated_at = Number(values[4]);
      } else {
        this.snapshots.set(corpId, {
          corp_id: corpId,
          price: Number(values[1]),
          last_delta: delta,
          volume,
          updated_at: Number(values[4]),
        });
      }
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled fake run query: ${query}`);
  }
}

function postRequest(body: Record<string, unknown>): Request {
  return new Request('https://game.test/api/net/market', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function identityBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    netGen: 'NET-ABCD-1234',
    sessionId: 'SES-ABCD-1234',
    progress: {
      nickname: 'Жилец',
      floorId: 2,
      floorName: 'Жилая зона',
      samosborCount: 1,
      level: 3,
      xp: 12,
      hp: 90,
      maxHp: 100,
      alive: true,
      gameOver: false,
      gameTime: 123,
      day: 2,
      hour: 8,
      minute: 30,
    },
    ...overrides,
  };
}

function tableColumns(sql: string, table: string): Set<string> {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\);`).exec(sql);
  assert.ok(match, `${table} must exist in schema`);
  return new Set(match[1]
    .split('\n')
    .map(line => /^([a-z_]+)\s/i.exec(line.trim())?.[1] ?? '')
    .filter(Boolean));
}

test('Net market schema and setup include D1 impulse and snapshot tables', () => {
  const schema = readFileSync('cloudflare/d1/net_sphere.sql', 'utf8');
  const migration = readFileSync('cloudflare/d1/net_sphere_market.sql', 'utf8');
  const setup = readFileSync('scripts/cloudflare-net-setup.mjs', 'utf8');

  assert.deepEqual([...tableColumns(schema, 'net_market_impulses')], [
    'id', 'net_gen', 'corp_id', 'kind', 'magnitude', 'created_at', 'event_key',
  ]);
  assert.deepEqual([...tableColumns(schema, 'net_market_budgets')], [
    'identity_key', 'net_gen', 'session_id', 'window_started_at', 'impulse_count', 'magnitude_sum', 'updated_at',
  ]);
  assert.deepEqual([...tableColumns(schema, 'net_market_snapshots')], [
    'corp_id', 'price', 'last_delta', 'volume', 'updated_at',
  ]);
  assert.match(schema, /idx_net_market_impulses_created/);
  assert.match(schema, /idx_net_market_impulses_corp/);
  assert.match(schema, /idx_net_market_impulses_event_key/);
  assert.match(schema, /idx_net_market_budgets_net_gen/);
  assert.match(schema, /idx_net_market_budgets_window/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS net_market_impulses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS net_market_budgets/);
  assert.match(setup, /net_sphere_market\.sql/);
});

test('Net market endpoint returns 503 when D1 binding is missing', async () => {
  const response = await getMarket({ request: new Request('https://game.test/api/net/market'), env: {} });

  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error, 'D1 binding GIGA_NET is not configured');
});

test('Net market POST rejects bad identity', async () => {
  const response = await postMarket({
    request: postRequest(identityBody({
      netGen: 'bad',
      impulses: [{ eventKey: 'evt:1', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 4 }],
    })),
    env: { GIGA_NET: new FakeD1() },
  });

  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error, 'bad identity');
});

test('Net market POST inserts impulses idempotently by event key', async () => {
  const realNow = Date.now;
  const db = new FakeD1();
  const body = identityBody({
    impulses: [{ eventKey: 'evt:1', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 10 }],
  });

  Date.now = () => 20_000;
  try {
    const first = await postMarket({ request: postRequest(body), env: { GIGA_NET: db } });
    const firstData = await responseJson(first);
    const firstMarket = firstData.market as { rows: Record<string, unknown>[] };
    const firstQuote = firstMarket.rows[0];

    const second = await postMarket({ request: postRequest(body), env: { GIGA_NET: db } });
    const secondData = await responseJson(second);
    const secondMarket = secondData.market as { rows: Record<string, unknown>[] };
    const secondQuote = secondMarket.rows[0];

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(db.impulses.size, 1);
    assert.equal(db.budgets.get('NET-ABCD-1234:SES-ABCD-1234')?.impulse_count, 1);
    assert.equal(db.budgets.get('NET-ABCD-1234:SES-ABCD-1234')?.magnitude_sum, 10);
    assert.equal(db.snapshots.get('toha_heavy_industries')?.volume, 10);
    assert.equal(firstQuote.lastDelta, 2.5);
    assert.deepEqual(secondQuote, firstQuote);
  } finally {
    Date.now = realNow;
  }
});

test('Net market POST rejects bursts above identity window budget', async () => {
  const realNow = Date.now;
  const db = new FakeD1();
  const burst = Array.from({ length: 8 }, (_, i) => ({
    eventKey: `burst:${i}`,
    corpId: `corp_${i}`,
    kind: 'buy',
    magnitude: 1,
  }));

  Date.now = () => 40_000;
  try {
    const first = await postMarket({
      request: postRequest(identityBody({ impulses: burst })),
      env: { GIGA_NET: db },
    });
    const second = await postMarket({
      request: postRequest(identityBody({
        impulses: [{ eventKey: 'burst:overflow', corpId: 'corp_overflow', kind: 'buy', magnitude: 1 }],
      })),
      env: { GIGA_NET: db },
    });
    const rejected = await responseJson(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(rejected.error, 'market rate limit');
    assert.equal(typeof rejected.retryAfterMs, 'number');
    assert.equal(db.impulses.size, 8);
    assert.equal(db.impulses.has('NET-ABCD-1234:burst:overflow'), false);

    Date.now = () => 61_000;
    const afterWindow = await postMarket({
      request: postRequest(identityBody({
        impulses: [{ eventKey: 'burst:next-window', corpId: 'corp_overflow', kind: 'buy', magnitude: 1 }],
      })),
      env: { GIGA_NET: db },
    });

    assert.equal(afterWindow.status, 200);
    assert.equal(db.impulses.size, 9);
  } finally {
    Date.now = realNow;
  }
});

test('Net market POST applies bounded aggregate quote snapshots', async () => {
  const realNow = Date.now;
  const db = new FakeD1();

  Date.now = () => 50_000;
  try {
    const response = await postMarket({
      request: postRequest(identityBody({
        impulses: [
          { eventKey: 'agg:1', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 80 },
          { eventKey: 'agg:2', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 80 },
          { eventKey: 'agg:3', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 80 },
        ],
      })),
      env: { GIGA_NET: db },
    });
    const data = await responseJson(response);
    const market = data.market as { rows: Record<string, unknown>[] };
    const quote = market.rows[0];
    const stored = db.snapshots.get('toha_heavy_industries');

    assert.equal(response.status, 200);
    assert.equal(db.impulses.size, 3);
    assert.equal(stored?.last_delta, 25);
    assert.equal(stored?.volume, 240);
    assert.equal(quote.lastDelta, 25);
    assert.equal(quote.volume, 240);
  } finally {
    Date.now = realNow;
  }
});

test('Net market GET returns bounded snapshot rows', async () => {
  const db = new FakeD1();
  for (let i = 0; i < 70; i++) {
    db.snapshots.set(`corp_${i}`, {
      corp_id: `corp_${i}`,
      price: 100 + i,
      last_delta: i % 2 === 0 ? 1 : -1,
      volume: i,
      updated_at: 1_000 + i,
    });
  }

  const response = await getMarket({
    request: new Request('https://game.test/api/net/market?limit=100'),
    env: { GIGA_NET: db },
  });
  const data = await responseJson(response);
  const market = data.market as { rows: Record<string, unknown>[]; updatedAt: number };

  assert.equal(response.status, 200);
  assert.equal(market.rows.length, 64);
  assert.equal(market.rows[0].corpId, 'corp_69');
  assert.equal(market.updatedAt, 1069);
});

test('Net market POST rejects oversized payloads', async () => {
  const response = await postMarket({
    request: postRequest(identityBody({
      padding: 'x'.repeat(5000),
      impulses: [{ eventKey: 'evt:large', corpId: 'toha_heavy_industries', kind: 'buy', magnitude: 1 }],
    })),
    env: { GIGA_NET: new FakeD1() },
  });

  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error, 'payload too large');
});

test('Net market remote snapshot softly nudges local stock quotes only once', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING }) as MarketStateHost;
  state.stockMarket = normalizeStockMarketState(undefined);
  state.stockMarket.portfolio.toha_heavy_industries = { shares: 2, avgPrice: 180 };
  const before = state.stockMarket.quotes.toha_heavy_industries.price;

  applyRemoteStockMarketSnapshot(state, {
    updatedAt: 1000,
    rows: [{
      corpId: 'toha_heavy_industries',
      price: 300,
      lastDelta: 20,
      volume: 77,
      updatedAt: 1000,
    }],
  });
  const after = state.stockMarket.quotes.toha_heavy_industries.price;

  assert.ok(after > before);
  assert.ok(after < 300);
  assert.equal(state.stockMarket.portfolio.toha_heavy_industries.shares, 2);
  assert.equal(state.stockMarket.lastRemoteUpdatedAt, 1000);

  applyRemoteStockMarketSnapshot(state, {
    updatedAt: 1000,
    rows: [{
      corpId: 'toha_heavy_industries',
      price: 999,
      lastDelta: 50,
      volume: 200,
      updatedAt: 1000,
    }],
  });
  assert.equal(state.stockMarket.quotes.toha_heavy_industries.price, after);
});

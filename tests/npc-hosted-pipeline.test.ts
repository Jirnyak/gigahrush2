import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { expectedCommunityExport, handleRequest, sha256Hex } from '../gigahrush-npc-intake/hosted/worker.mjs';

interface D1Result {
  meta?: { changes?: number };
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<D1Result>;
}

class FakeStatement implements D1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1Statement {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.db.first(this.query, this.values) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
    return { results: this.db.all(this.query, this.values) as T[] };
  }

  async run(): Promise<D1Result> {
    return this.db.run(this.query, this.values);
  }
}

class FakeD1 {
  submissions = new Map<string, Record<string, unknown>>();
  rateLimits = new Map<string, { count: number; updated_at: number }>();
  files = new Map<string, unknown>();

  prepare(query: string): D1Statement {
    return new FakeStatement(this, query);
  }

  first(query: string, values: unknown[]): Record<string, unknown> | null {
    if (query.includes('FROM npc_intake_rate_limits')) {
      const key = `${values[0]}:${values[1]}`;
      const row = this.rateLimits.get(key);
      return row ? { count: row.count } : null;
    }
    if (query.includes('FROM npc_submissions WHERE submission_id = ?')) {
      return this.submissions.get(String(values[0])) ?? null;
    }
    if (query.includes('FROM npc_submission_files')) {
      const key = `${values[0]}:${values[1]}`;
      const fileData = this.files.get(key);
      return fileData ? { file_data: fileData, mime_type: 'application/zip' } : null;
    }
    throw new Error(`Unhandled first query: ${query}`);
  }

  all(query: string): Record<string, unknown>[] {
    if (query.includes('FROM npc_submissions')) {
      return [...this.submissions.values()].sort((a, b) => Number(b.created_at) - Number(a.created_at));
    }
    throw new Error(`Unhandled all query: ${query}`);
  }

  run(query: string, values: unknown[]): D1Result {
    if (query.includes('INSERT INTO npc_intake_rate_limits')) {
      const key = `${values[0]}:${values[1]}`;
      this.rateLimits.set(key, { count: 1, updated_at: Number(values[2]) });
      return { meta: { changes: 1 } };
    }
    if (query.includes('UPDATE npc_intake_rate_limits')) {
      const key = `${values[1]}:${values[2]}`;
      const row = this.rateLimits.get(key);
      if (row) {
        row.count += 1;
        row.updated_at = Number(values[0]);
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (query.includes('INSERT INTO npc_submissions')) {
      const row = {
        submission_id: String(values[0]),
        package_id: String(values[1]),
        author_display_name: String(values[2]),
        author_contact_private: String(values[3]),
        public_credit_name: String(values[4]),
        consent_accepted_at: String(values[5]),
        status: 'submitted',
        created_at: Number(values[6]),
        updated_at: Number(values[7]),
        file_keys: String(values[8]),
        moderator_notes: '',
        package_hash: String(values[9]),
        sprite_hash: String(values[10]),
        schema_version: Number(values[11]),
        preview_json: String(values[12]),
      };
      this.submissions.set(row.submission_id, row);
      return { meta: { changes: 1 } };
    }
    if (query.includes('UPDATE npc_submissions SET status = ?')) {
      const row = this.submissions.get(String(values[3]));
      if (row) {
        row.status = String(values[0]);
        row.moderator_notes = String(values[1]);
        row.updated_at = Number(values[2]);
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (query.includes('INSERT INTO npc_submission_files')) {
      const key = `${values[0]}:${values[1]}`;
      this.files.set(key, values[3]);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run query: ${query}`);
  }
}

class FakeR2 {
  objects = new Map<string, Uint8Array>();

  async put(key: string, value: Uint8Array): Promise<void> {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const body = this.objects.get(key);
    return body ? { body } : null;
  }
}

function makeEnv() {
  return {
    NPC_DB: new FakeD1(),
    NPC_SUBMISSIONS: new FakeR2(),
    TENEVIK_REVIEW_TOKEN: 'review-secret',
  };
}

function zipBytes(size = 16): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  bytes[2] = 0x03;
  bytes[3] = 0x04;
  for (let i = 4; i < bytes.length; i++) bytes[i] = i % 251;
  return bytes;
}

async function makeMetadata(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    packageId: 'slesar_ivanov',
    authorDisplayName: 'Тестовый автор',
    authorContactPrivate: 'author@example.test',
    publicCreditName: 'Тестовый кредит',
    consentAccepted: true,
    consentAcceptedAt: '2026-06-05T12:00:00.000Z',
    schemaVersion: 1,
    packageHash: await sha256Hex(bytes),
    spriteHash: 'f'.repeat(64),
    preview: {
      publicLine: 'Слесарь с мокрым журналом смен.',
      floorLabel: 'Жилая зона',
      faction: 'citizens',
      occupation: 'worker',
      samplePost: 'Опять насос записали на мою смену.',
      sampleTalk: 'Кран закрой, потом разговаривай.',
    },
    ...overrides,
  };
}

async function submitRequest(bytes: Uint8Array, metadataOverrides: Record<string, unknown> = {}) {
  const metadata = await makeMetadata(bytes, metadataOverrides);
  const body = new FormData();
  body.set('metadataJson', JSON.stringify(metadata));
  body.set('packageZip', new Blob([bytes], { type: 'application/zip' }), 'slesar_ivanov.zip');
  return new Request('https://npc.example.test/api/submit', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.17' },
    body,
  });
}

async function submitValid(env = makeEnv(), bytes = zipBytes()) {
  const response = await handleRequest(await submitRequest(bytes), env);
  const data = await response.json() as { submissionId: string; ok: boolean; fileKeys: { packageZip: string } };
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  return { env, data };
}

test('hosted NPC intake accepts a valid ZIP submission', async () => {
  const { env, data } = await submitValid();
  assert.match(data.submissionId, /^npc_slesar_ivanov_/);
  assert.equal(env.NPC_DB.files.has(`${data.submissionId}:packageZip`), true);
  const row = env.NPC_DB.submissions.get(data.submissionId);
  assert.equal(row?.status, 'submitted');
  assert.equal(row?.author_contact_private, 'author@example.test');
});

test('hosted NPC intake rejects missing consent', async () => {
  const env = makeEnv();
  const response = await handleRequest(await submitRequest(zipBytes(), {
    consentAccepted: false,
    consentAcceptedAt: '',
  }), env);
  const data = await response.json() as { error: string };
  assert.equal(response.status, 400);
  assert.match(data.error, /consent/i);
  assert.equal(env.NPC_DB.submissions.size, 0);
});

test('hosted NPC intake rejects oversized ZIP uploads', async () => {
  const env = makeEnv();
  const response = await handleRequest(await submitRequest(zipBytes(2 * 1024 * 1024 + 1)), env);
  const data = await response.json() as { error: string };
  assert.equal(response.status, 413);
  assert.match(data.error, /too large/i);
});

test('hosted NPC intake rejects bad package hash and schema version', async () => {
  const env = makeEnv();
  const badHash = await handleRequest(await submitRequest(zipBytes(), { packageHash: '0'.repeat(64) }), env);
  assert.equal(badHash.status, 400);
  const badSchema = await handleRequest(await submitRequest(zipBytes(), { schemaVersion: 0 }), env);
  const schemaData = await badSchema.json() as { error: string };
  assert.equal(badSchema.status, 400);
  assert.match(schemaData.error, /schemaVersion/);
});

test('hosted NPC intake updates moderation status', async () => {
  const { env, data } = await submitValid();
  const response = await handleRequest(new Request(`https://npc.example.test/api/review/submissions/${data.submissionId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenevik-Review-Token': 'review-secret',
    },
    body: JSON.stringify({ status: 'accepted', moderatorNotes: 'drop-in folder reviewed' }),
  }), env);
  const body = await response.json() as { submission: { status: string; moderatorNotes: string } };
  assert.equal(response.status, 200);
  assert.equal(body.submission.status, 'accepted');
  assert.equal(body.submission.moderatorNotes, 'drop-in folder reviewed');
});

test('hosted NPC intake export shape matches community drop-in contract', async () => {
  const { env, data } = await submitValid();
  await handleRequest(new Request(`https://npc.example.test/api/review/submissions/${data.submissionId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer review-secret',
    },
    body: JSON.stringify({ status: 'accepted' }),
  }), env);
  const response = await handleRequest(new Request(`https://npc.example.test/api/review/submissions/${data.submissionId}/export`, {
    headers: { 'Authorization': 'Bearer review-secret' },
  }), env);
  const body = await response.json() as { export: { root: string; files: string[] } };
  assert.equal(response.status, 200);
  assert.deepEqual(body.export, {
    ...expectedCommunityExport('slesar_ivanov'),
    sourceZipKey: data.fileKeys.packageZip,
    instructions: [
      'Download slesar_ivanov.zip from this submission.',
      'Review-copy the four required files into src/data/npc_packages/community/slesar_ivanov/.',
      'Run the game-side importer/schema validation before committing.',
    ],
  });
});

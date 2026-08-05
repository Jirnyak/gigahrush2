const MAX_ZIP_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_SUBMISSIONS_PER_HOUR = 8;
const PACKAGE_ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const HASH_RE = /^(?:sha256:)?[a-f0-9]{64}$/i;
const REVIEW_STATUSES = new Set(['submitted', 'needs_review', 'accepted', 'rejected', 'imported']);
const ZIP_MIME_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PUBLIC_TEXT_KEYS = [
  'authorDisplayName',
  'publicCreditName',
  'publicLine',
  'floorLabel',
  'samplePost',
  'sampleTalk',
  'notes',
];
const INTERNAL_TERM_RE = /\b(1024x1024|1024\s*x\s*1024|toroid|toroidal|localstorage|save_shape_version|src\/|dist\/|world\.idx)\b|тороид/i;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function badRequest(message, status = 400) {
  throw new ApiError(message, status);
}

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function cleanContact(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function normalizeHash(value) {
  if (typeof value !== 'string') return '';
  const clean = value.trim().toLowerCase();
  if (!HASH_RE.test(clean)) return '';
  return clean.startsWith('sha256:') ? clean.slice(7) : clean;
}

function assertNoInternalTerms(label, value) {
  if (value && INTERNAL_TERM_RE.test(value)) {
    badRequest(`${label} contains internal implementation terms`);
  }
}

function parseJsonText(raw, label, limit = 8192) {
  if (typeof raw !== 'string') badRequest(`${label} is required`);
  if (raw.length > limit) badRequest(`${label} too large`);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) badRequest(`${label} must be an object`);
    return parsed;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    badRequest(`${label} is malformed`);
  }
}

function sanitizePreview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preview = {
    publicLine: cleanText(value.publicLine, 180),
    floorLabel: cleanText(value.floorLabel, 80),
    faction: cleanText(value.faction, 48),
    occupation: cleanText(value.occupation, 48),
    sex: cleanText(value.sex, 16),
    age: Number.isInteger(value.age) ? Math.max(1, Math.min(100, value.age)) : undefined,
    relationBand: cleanText(value.relationBand, 48),
    samplePost: cleanText(value.samplePost, 220),
    sampleTalk: cleanText(value.sampleTalk, 160),
  };
  for (const key of PUBLIC_TEXT_KEYS) assertNoInternalTerms(`preview.${key}`, preview[key]);
  return Object.fromEntries(Object.entries(preview).filter(([, fieldValue]) => fieldValue !== '' && fieldValue !== undefined));
}

export function expectedCommunityExport(packageId) {
  return {
    root: `src/data/npc_packages/community/${packageId}/`,
    files: ['npc.json', 'sprite.rle.json', 'README.md', 'consent.json'],
  };
}

export function validateSubmissionMetadata(raw) {
  const data = typeof raw === 'string' ? parseJsonText(raw, 'metadataJson') : raw;
  if (!data || typeof data !== 'object' || Array.isArray(data)) badRequest('metadataJson must be an object');

  const packageId = cleanText(data.packageId, 80);
  if (!PACKAGE_ID_RE.test(packageId)) badRequest('packageId must be stable snake_case');

  const schemaVersion = Number(data.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 99) {
    badRequest('schemaVersion is invalid');
  }

  const authorDisplayName = cleanText(data.authorDisplayName, 80);
  const authorContactPrivate = cleanContact(data.authorContactPrivate);
  const publicCreditName = cleanText(data.publicCreditName || data.authorDisplayName, 80);
  const consentAcceptedAt = cleanText(data.consentAcceptedAt, 40);
  const packageHash = normalizeHash(data.packageHash);
  const spriteHash = normalizeHash(data.spriteHash);
  const preview = sanitizePreview(data.preview);

  if (!authorDisplayName) badRequest('authorDisplayName is required');
  if (!authorContactPrivate) badRequest('authorContactPrivate is required');
  if (!publicCreditName) badRequest('publicCreditName is required');
  if (data.consentAccepted !== true && !consentAcceptedAt) badRequest('consent is required');
  if (consentAcceptedAt && Number.isNaN(Date.parse(consentAcceptedAt))) badRequest('consentAcceptedAt is invalid');
  if (!packageHash) badRequest('packageHash must be sha256');
  if (!spriteHash) badRequest('spriteHash must be sha256');

  for (const key of PUBLIC_TEXT_KEYS) assertNoInternalTerms(key, data[key]);
  assertNoInternalTerms('authorDisplayName', authorDisplayName);
  assertNoInternalTerms('publicCreditName', publicCreditName);

  return {
    packageId,
    authorDisplayName,
    authorContactPrivate,
    publicCreditName,
    consentAcceptedAt: consentAcceptedAt || new Date().toISOString(),
    packageHash,
    spriteHash,
    schemaVersion,
    preview,
  };
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Text(text) {
  return sha256Hex(new TextEncoder().encode(text));
}

function requireEnv(env) {
  if (!env?.NPC_DB) badRequest('D1 binding NPC_DB is not configured', 503);
}

function getFormFile(formData, name, required = false) {
  const value = formData.get(name);
  if (!value) {
    if (required) badRequest(`${name} is required`);
    return null;
  }
  if (typeof value !== 'object' || typeof value.arrayBuffer !== 'function') {
    badRequest(`${name} must be a file`);
  }
  return value;
}

async function fileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function validateZipFile(file, bytes) {
  if (bytes.byteLength > MAX_ZIP_BYTES) badRequest('package ZIP is too large', 413);
  if (file.type && !ZIP_MIME_TYPES.has(file.type)) badRequest('package ZIP MIME type is invalid');
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) badRequest('package ZIP magic is invalid');
}

async function validateOptionalImage(file, name, limit) {
  if (!file) return null;
  const bytes = await fileBytes(file);
  if (bytes.byteLength > limit) badRequest(`${name} is too large`, 413);
  if (!IMAGE_MIME_TYPES.has(file.type)) badRequest(`${name} must be an image upload`);
  return bytes;
}

function makeSubmissionId(packageId, now, hash) {
  return `npc_${packageId}_${now.toString(36)}_${hash.slice(0, 12)}`;
}

function jsonFileKeys(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowView(row) {
  const exportShape = expectedCommunityExport(row.package_id);
  return {
    submissionId: row.submission_id,
    packageId: row.package_id,
    authorDisplayName: row.author_display_name,
    authorContactPrivate: row.author_contact_private,
    publicCreditName: row.public_credit_name,
    consentAcceptedAt: row.consent_accepted_at,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    fileKeys: jsonFileKeys(row.file_keys),
    moderatorNotes: row.moderator_notes || '',
    packageHash: row.package_hash,
    spriteHash: row.sprite_hash,
    schemaVersion: Number(row.schema_version),
    preview: jsonFileKeys(row.preview_json),
    exportFolder: exportShape.root,
  };
}

async function validateTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) return { checked: false };
  if (!token) badRequest('turnstile token is required');
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) badRequest('turnstile validation failed');
  const result = await response.json();
  if (result?.success !== true) badRequest('turnstile validation failed');
  return { checked: true };
}

async function enforceRateLimit(request, env, now) {
  const ip = cleanText(request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local', 128);
  const identityHash = await sha256Text(ip || 'local');
  const windowStartedAt = Math.floor(now / 3_600_000) * 3_600_000;
  const current = await env.NPC_DB
    .prepare('SELECT count FROM npc_intake_rate_limits WHERE identity_hash = ? AND window_started_at = ?')
    .bind(identityHash, windowStartedAt)
    .first();
  const count = Number(current?.count || 0);
  if (count >= MAX_SUBMISSIONS_PER_HOUR) badRequest('rate limit exceeded', 429);
  if (current) {
    await env.NPC_DB
      .prepare('UPDATE npc_intake_rate_limits SET count = count + 1, updated_at = ? WHERE identity_hash = ? AND window_started_at = ?')
      .bind(now, identityHash, windowStartedAt)
      .run();
  } else {
    await env.NPC_DB
      .prepare('INSERT INTO npc_intake_rate_limits (identity_hash, window_started_at, count, updated_at) VALUES (?, ?, 1, ?)')
      .bind(identityHash, windowStartedAt, now)
      .run();
  }
}

async function handleSubmit(request, env) {
  requireEnv(env);
  const formData = await request.formData();
  const metadata = validateSubmissionMetadata(formData.get('metadataJson'));
  await validateTurnstile(request, env, cleanText(formData.get('turnstileToken'), 2048));
  await enforceRateLimit(request, env, Date.now());

  const zipFile = getFormFile(formData, 'packageZip', true);
  const zipBytes = await fileBytes(zipFile);
  validateZipFile(zipFile, zipBytes);
  const actualPackageHash = await sha256Hex(zipBytes);
  if (actualPackageHash !== metadata.packageHash) badRequest('packageHash does not match uploaded ZIP');

  const sourceSprite = await validateOptionalImage(getFormFile(formData, 'sourceSprite'), 'sourceSprite', MAX_IMAGE_BYTES);
  const previewPng = await validateOptionalImage(getFormFile(formData, 'previewPng'), 'previewPng', MAX_PREVIEW_BYTES);

  const now = Date.now();
  const submissionId = makeSubmissionId(metadata.packageId, now, actualPackageHash);
  const baseKey = `submissions/${submissionId}`;
  const fileKeys = {
    packageZip: `${baseKey}/${metadata.packageId}.zip`,
  };

  await env.NPC_DB.prepare(
    'INSERT INTO npc_submission_files (submission_id, file_name, mime_type, file_data) VALUES (?, ?, ?, ?)'
  ).bind(submissionId, 'packageZip', 'application/zip', zipBytes.buffer).run();

  if (sourceSprite) {
    fileKeys.sourceSprite = `${baseKey}/source_sprite`;
    await env.NPC_DB.prepare(
      'INSERT INTO npc_submission_files (submission_id, file_name, mime_type, file_data) VALUES (?, ?, ?, ?)'
    ).bind(submissionId, 'sourceSprite', 'image/png', sourceSprite.buffer).run();
  }
  if (previewPng) {
    fileKeys.previewPng = `${baseKey}/preview.png`;
    await env.NPC_DB.prepare(
      'INSERT INTO npc_submission_files (submission_id, file_name, mime_type, file_data) VALUES (?, ?, ?, ?)'
    ).bind(submissionId, 'previewPng', 'image/png', previewPng.buffer).run();
  }

  await env.NPC_DB
    .prepare(`INSERT INTO npc_submissions (
      submission_id, package_id, author_display_name, author_contact_private, public_credit_name,
      consent_accepted_at, status, created_at, updated_at, file_keys, moderator_notes,
      package_hash, sprite_hash, schema_version, preview_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, '', ?, ?, ?, ?)`)
    .bind(
      submissionId,
      metadata.packageId,
      metadata.authorDisplayName,
      metadata.authorContactPrivate,
      metadata.publicCreditName,
      metadata.consentAcceptedAt,
      now,
      now,
      JSON.stringify(fileKeys),
      metadata.packageHash,
      metadata.spriteHash,
      metadata.schemaVersion,
      JSON.stringify(metadata.preview),
    )
    .run();

  return json({
    ok: true,
    submissionId,
    packageId: metadata.packageId,
    status: 'submitted',
    fileKeys,
    exportFolder: expectedCommunityExport(metadata.packageId).root,
  });
}

function requireReviewAuth(request, env) {
  const expected = env.TENEVIK_REVIEW_TOKEN;
  if (!expected) badRequest('TENEVIK_REVIEW_TOKEN is not configured', 503);
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = request.headers.get('X-Tenevik-Review-Token') || '';
  if (bearer !== expected && header !== expected) badRequest('review authorization required', 401);
}

async function readJsonBody(request, limit = 4096) {
  const text = await request.text();
  if (text.length > limit) badRequest('payload too large', 413);
  return parseJsonText(text || '{}', 'json body', limit);
}

async function getSubmission(env, submissionId) {
  const row = await env.NPC_DB
    .prepare('SELECT * FROM npc_submissions WHERE submission_id = ?')
    .bind(submissionId)
    .first();
  if (!row) badRequest('submission not found', 404);
  return row;
}

async function listSubmissions(request, env) {
  requireReviewAuth(request, env);
  const rows = await env.NPC_DB
    .prepare('SELECT * FROM npc_submissions ORDER BY created_at DESC LIMIT 100')
    .all();
  return json({ ok: true, submissions: (rows.results || []).map(rowView) });
}

async function updateStatus(request, env, submissionId) {
  requireReviewAuth(request, env);
  const data = await readJsonBody(request);
  const status = cleanText(data.status, 24);
  if (!REVIEW_STATUSES.has(status)) badRequest('status is invalid');
  const moderatorNotes = cleanText(data.moderatorNotes, 2000);
  const now = Date.now();
  await env.NPC_DB
    .prepare('UPDATE npc_submissions SET status = ?, moderator_notes = ?, updated_at = ? WHERE submission_id = ?')
    .bind(status, moderatorNotes, now, submissionId)
    .run();
  const row = await getSubmission(env, submissionId);
  return json({ ok: true, submission: rowView(row) });
}

async function downloadSubmission(request, env, submissionId) {
  requireReviewAuth(request, env);
  const row = await getSubmission(env, submissionId);
  
  const file = await env.NPC_DB.prepare(
    'SELECT file_data, mime_type FROM npc_submission_files WHERE submission_id = ? AND file_name = ?'
  ).bind(submissionId, 'packageZip').first();

  if (!file || !file.file_data) badRequest('submission ZIP missing', 404);
  return new Response(file.file_data, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': file.mime_type || 'application/zip',
      'Content-Disposition': `attachment; filename="${row.package_id}.zip"`,
    },
  });
}

async function exportSubmission(request, env, submissionId) {
  requireReviewAuth(request, env);
  const row = await getSubmission(env, submissionId);
  if (row.status !== 'accepted' && row.status !== 'imported') {
    badRequest('only accepted submissions can be exported', 409);
  }
  const exportShape = expectedCommunityExport(row.package_id);
  return json({
    ok: true,
    packageId: row.package_id,
    submissionId: row.submission_id,
    status: row.status,
    export: {
      ...exportShape,
      sourceZipKey: jsonFileKeys(row.file_keys).packageZip,
      instructions: [
        `Download ${row.package_id}.zip from this submission.`,
        `Review-copy the four required files into ${exportShape.root}.`,
        'Run the game-side importer/schema validation before committing.',
      ],
    },
  });
}

function health() {
  return json({
    ok: true,
    service: 'gigahrush-npc-intake-hosted',
    statuses: [...REVIEW_STATUSES],
    maxZipBytes: MAX_ZIP_BYTES,
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/health' && request.method === 'GET') return health();
  if (url.pathname === '/api/submit' && request.method === 'POST') return handleSubmit(request, env);
  if (url.pathname === '/api/review/submissions' && request.method === 'GET') return listSubmissions(request, env);

  const match = url.pathname.match(/^\/api\/review\/submissions\/([^/]+)\/(status|download|export)$/);
  if (match) {
    const submissionId = cleanText(decodeURIComponent(match[1]), 160);
    const action = match[2];
    if (action === 'status' && request.method === 'POST') return updateStatus(request, env, submissionId);
    if (action === 'download' && request.method === 'GET') return downloadSubmission(request, env, submissionId);
    if (action === 'export' && request.method === 'GET') return exportSubmission(request, env, submissionId);
  }

  return json({ ok: false, error: 'not found' }, 404);
}

export async function handleRequest(request, env) {
  try {
    return await route(request, env);
  } catch (err) {
    if (err instanceof ApiError) return json({ ok: false, error: err.message }, err.status);
    return json({ ok: false, error: 'server error' }, 500);
  }
}

export default {
  fetch: handleRequest,
};

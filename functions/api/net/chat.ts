import {
  type PagesContext,
  apiError,
  cleanMessage,
  cleanNetGen,
  cleanSessionId,
  handleApiError,
  json,
  normalizeProgress,
  readBody,
  readChat,
  readEvents,
  readProfile,
  readStats,
  requireDb,
  requireMethod,
  sinceChatIdFromValue,
  sinceChatIdFromUrl,
  upsertPresence,
} from './common';

const CHAT_COOLDOWN_MS = 2500;

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const methodError = requireMethod(context.request, 'GET');
  if (methodError) return methodError;

  const db = requireDb(context.env);
  if (db instanceof Response) return db;
  try {
    return json({ ok: true, chat: await readChat(db, sinceChatIdFromUrl(context.request)) });
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
    const message = cleanMessage(body.body);
    if (!netGen || !sessionId || !message) return apiError('bad chat message', 400);

    const now = Date.now();
    await upsertPresence(db, netGen, sessionId, normalizeProgress(body.progress), now);

    const last = await db.prepare(`
      SELECT created_at
      FROM net_chat
      WHERE net_gen = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(netGen).first<{ created_at: number }>();
    if (last && now - Number(last.created_at) < CHAT_COOLDOWN_MS) {
      return apiError('слишком часто', 429);
    }

    const inserted = await db.prepare(`
      INSERT INTO net_chat (net_gen, body, created_at)
      VALUES (?, ?, ?)
    `).bind(netGen, message, now).run();

    const sinceChatId = sinceChatIdFromValue(
      body.sinceChatId,
      Math.max(0, Number(inserted.meta?.last_row_id ?? 1) - 1),
    );
    const [stats, profile, chat, events] = await Promise.all([
      readStats(db, now),
      readProfile(db, netGen),
      readChat(db, sinceChatId),
      readEvents(db),
    ]);
    return json({ ok: true, stats, profile, chat, events });
  } catch (err) {
    return handleApiError(err);
  }
}

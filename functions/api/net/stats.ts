import {
  type PagesContext,
  cleanNetGen,
  handleApiError,
  json,
  readChat,
  readEvents,
  readProfile,
  readStats,
  requireDb,
  requireMethod,
  sinceChatIdFromUrl,
} from './common';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const methodError = requireMethod(context.request, 'GET');
  if (methodError) return methodError;

  const db = requireDb(context.env);
  if (db instanceof Response) return db;

  try {
    const url = new URL(context.request.url);
    const netGen = cleanNetGen(url.searchParams.get('netGen') ?? '');
    const now = Date.now();
    const [stats, profile, chat, events] = await Promise.all([
      readStats(db, now),
      netGen ? readProfile(db, netGen) : Promise.resolve(null),
      readChat(db, sinceChatIdFromUrl(context.request)),
      readEvents(db),
    ]);
    return json({ ok: true, stats, profile, chat, events });
  } catch (err) {
    return handleApiError(err);
  }
}

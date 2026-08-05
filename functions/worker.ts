import { onRequestGet as getStats } from './api/net/stats';
import { onRequestGet as getChat, onRequestPost as postChat } from './api/net/chat';
import { onRequestPost as postEvent } from './api/net/event';
import { onRequestPost as postHello } from './api/net/hello';
import { onRequestGet as getMarket, onRequestPost as postMarket } from './api/net/market';
import { apiError, type Env as NetEnv, type PagesContext } from './api/net/common';
// @ts-ignore The hosted intake worker is a dependency-free MJS subproject.
import npcIntakeWorker from '../gigahrush-npc-intake/hosted/worker.mjs';

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv extends NetEnv {
  ASSETS: AssetBinding;
  NPC_DB?: unknown;
  NPC_SUBMISSIONS?: unknown;
  // nosemgrep
  TENEVIK_REVIEW_TOKEN?: string;
  // nosemgrep
  TURNSTILE_SECRET_KEY?: string;
}

type Handler = (context: PagesContext) => Promise<Response>;
type Method = 'GET' | 'POST';

const NET_ROUTES: Record<string, Partial<Record<Method, Handler>>> = {
  '/api/net/stats': { GET: getStats },
  '/api/net/hello': { POST: postHello },
  '/api/net/event': { POST: postEvent },
  '/api/net/chat': { GET: getChat, POST: postChat },
  '/api/net/market': { GET: getMarket, POST: postMarket },
};

function methodNotAllowed(allowed: string[]): Response {
  const response = apiError('method not allowed', 405);
  response.headers.set('Allow', allowed.join(', '));
  return response;
}

function notFound(): Response {
  return apiError('not found', 404);
}

function isNetApiPath(pathname: string): boolean {
  return pathname === '/api/net' || pathname.startsWith('/api/net/');
}

function isNpcIntakeApiPath(pathname: string): boolean {
  return pathname === '/api/npc-intake' || pathname.startsWith('/api/npc-intake/');
}

function npcIntakeRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === '/api/npc-intake/health') {
    url.pathname = '/api/health';
  } else if (url.pathname === '/api/npc-intake/submit') {
    url.pathname = '/api/submit';
  } else if (url.pathname === '/api/npc-intake/review/submissions') {
    url.pathname = '/api/review/submissions';
  } else if (url.pathname.startsWith('/api/npc-intake/review/submissions/')) {
    url.pathname = url.pathname.replace('/api/npc-intake/review/submissions/', '/api/review/submissions/');
  }
  return new Request(url, request);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (isNpcIntakeApiPath(url.pathname)) {
      return npcIntakeWorker.fetch(npcIntakeRequest(request), env);
    }
    if (isNetApiPath(url.pathname)) {
      const route = NET_ROUTES[url.pathname];
      if (!route) return notFound();
      const handler = route[request.method.toUpperCase() as Method];
      if (!handler) return methodNotAllowed(Object.keys(route).sort());
      return handler({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Db } from './db.js';
import { HttpError, Router, parseCookies, readJsonBody, sendJson, type Ctx } from './http.js';
import { SESSION_COOKIE, userFromToken } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerInvitationRoutes } from './routes/invitations.js';
import { registerUserRoutes } from './routes/users.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https://image.tmdb.org; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

export function buildRouter(db: Db): Router {
  const router = new Router();
  registerAuthRoutes(router, db);
  registerCatalogRoutes(router, db);
  registerInvitationRoutes(router, db);
  registerUserRoutes(router, db);
  return router;
}

function clientIp(req: IncomingMessage): string {
  // За обратным прокси (nginx) настройте доверие к X-Forwarded-For
  return req.socket.remoteAddress ?? 'unknown';
}

async function serveStatic(publicDir: string, pathname: string, res: ServerResponse): Promise<void> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = '/';
  }
  const root = resolve(publicDir);
  let file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  let isFile = false;
  try {
    isFile = (await stat(file)).isFile();
  } catch {
    /* нет файла */
  }
  // SPA: неизвестные пути без расширения отдаём index.html
  if (!isFile) {
    if (extname(rel)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    file = join(root, 'index.html');
  }
  const data = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=300');
  res.end(data);
}

export function createApp(db: Db, opts: { publicDir: string }): Server {
  const router = buildRouter(db);

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        await serveStatic(opts.publicDir, url.pathname, res);
      } catch (e) {
        console.error(e);
        res.statusCode = 500;
        res.end();
      }
      return;
    }

    const cookies: string[] = [];
    try {
      const m = router.match(method, url.pathname);
      if (m === null) throw new HttpError(404, 'Не найдено');
      if (m === 'method') throw new HttpError(405, 'Метод не поддерживается');

      let body: Record<string, unknown> = {};
      if (method !== 'GET' && method !== 'HEAD') {
        // Защита от CSRF: изменяющие запросы только с JSON (кросс-доменная форма так не умеет без CORS)
        const ct = req.headers['content-type'] ?? '';
        if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Нужен Content-Type: application/json');
        body = await readJsonBody(req);
      }

      const ctx: Ctx = {
        req,
        res,
        method,
        path: url.pathname,
        params: m.params,
        query: url.searchParams,
        body,
        user: userFromToken(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]),
        ip: clientIp(req),
        status: 200,
        setCookie: (c) => cookies.push(c),
      };
      const result = await m.handler(ctx);
      sendJson(res, ctx.status, result, cookies);
    } catch (e) {
      if (e instanceof HttpError) {
        sendJson(res, e.status, { error: e.message }, cookies);
      } else {
        console.error(e);
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    }
  });
}

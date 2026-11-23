import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SessionUser {
  id: number;
  role: 'user' | 'admin';
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  user: SessionUser | null;
  ip: string;
  status: number;
  setCookie(cookie: string): void;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    return this;
  }
  get(path: string, h: Handler) {
    return this.add('GET', path, h);
  }
  post(path: string, h: Handler) {
    return this.add('POST', path, h);
  }
  put(path: string, h: Handler) {
    return this.add('PUT', path, h);
  }
  patch(path: string, h: Handler) {
    return this.add('PATCH', path, h);
  }
  delete(path: string, h: Handler) {
    return this.add('DELETE', path, h);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = r.parts[i]!;
        const p = parts[i]!;
        if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(p);
        else if (rp !== p) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}

const MAX_BODY = 64 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* ниже вернём ошибку */
  }
  throw new HttpError(400, 'Тело запроса должно быть JSON-объектом');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sendJson(res: ServerResponse, status: number, data: unknown, extraHeaders: string[] = []): void {
  const body = JSON.stringify(data ?? { ok: true });
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders.length) res.setHeader('Set-Cookie', extraHeaders);
  res.end(body);
}

/** Простой лимит запросов в памяти: не больше `limit` за `windowMs` с одного ключа. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}
  check(key: string): void {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return;
    }
    h.count++;
    if (h.count > this.limit) throw new HttpError(429, 'Слишком много попыток, попробуйте позже');
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
  }
}

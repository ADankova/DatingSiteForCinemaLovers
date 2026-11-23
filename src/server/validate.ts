import { HttpError } from './http.js';

type Body = Record<string, unknown>;

export function str(
  body: Body,
  key: string,
  opts: { min?: number; max: number; required?: boolean; label?: string },
): string {
  const label = opts.label ?? key;
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new HttpError(400, `Поле «${label}» обязательно`);
    return '';
  }
  if (typeof v !== 'string') throw new HttpError(400, `Поле «${label}» должно быть строкой`);
  const s = v.trim();
  if (opts.required && s.length === 0) throw new HttpError(400, `Поле «${label}» обязательно`);
  if (opts.min !== undefined && s.length < opts.min)
    throw new HttpError(400, `Поле «${label}»: минимум ${opts.min} символов`);
  if (s.length > opts.max) throw new HttpError(400, `Поле «${label}»: максимум ${opts.max} символов`);
  return s;
}

export function int(body: Body, key: string, opts: { min: number; max: number; def?: number; label?: string }): number {
  const label = opts.label ?? key;
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.def !== undefined) return opts.def;
    throw new HttpError(400, `Поле «${label}» обязательно`);
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max)
    throw new HttpError(400, `Поле «${label}» должно быть целым числом от ${opts.min} до ${opts.max}`);
  return n;
}

export function oneOf<T extends string>(body: Body, key: string, values: readonly T[], def?: T, label?: string): T {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new HttpError(400, `Поле «${label ?? key}» обязательно`);
  }
  if (typeof v !== 'string' || !values.includes(v as T))
    throw new HttpError(400, `Недопустимое значение поля «${label ?? key}»`);
  return v as T;
}

export function isoDate(body: Body, key: string, label?: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')))
    throw new HttpError(400, `Поле «${label ?? key}» должно быть датой ГГГГ-ММ-ДД`);
  return v;
}

export function hhmm(body: Body, key: string, label?: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
    throw new HttpError(400, `Поле «${label ?? key}» должно быть временем ЧЧ:ММ`);
  return v;
}

export function idParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Не найдено');
  return n;
}

export function queryInt(q: URLSearchParams, key: string, min: number, max: number): number | undefined {
  const v = q.get(key);
  if (v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `Параметр ${key} должен быть числом`);
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function httpUrl(body: Body, key: string, label?: string): string {
  const s = str(body, key, { max: 500, label });
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    return u.toString();
  } catch {
    throw new HttpError(400, `Поле «${label ?? key}» должно быть ссылкой http(s)`);
  }
}
